// content_scripts/jira_content_timer.js
// Versão Refatorada: Corrige atualização do tempo excedido e melhora UI
(function() {
    'use strict';
    // console.log("JIRA TIMER EXT: Content script v1.32 (Refatorado) carregado!");

    let onPageTimerInterval = null; // Único intervalo global para o timer da página
    const GLOBAL_THEME_STORAGE_KEY = 'jiraGlobalTimerTheme';
    const TEMPLATE_STORAGE_KEY_CS = 'jiraTimerTemplates';
    const CITY_FIELD_SELECTOR = 'div[data-testid="issue.views.field.single-line-text.read-view.customfield_11994"]';

    // --- Funções Utilitárias (sem alterações significativas) ---
    function getIssueKeyFromURL() {
        let match = window.location.pathname.match(/\/issues\/([A-Z0-9]+-[0-9]+)/);
        if (match && match[1]) return match[1];
        match = window.location.pathname.match(/\/browse\/([A-Z0-9]+-[0-9]+)/);
        if (match && match[1]) return match[1];
        return null;
    }

    function getIssueTitle() {
        const selectors = [
            'h1[id="summary-val"]',
            '[data-test-id="issue.views.issue-base.foundation.summary.heading"]',
            '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
            '#summary-val', 'h1[data-test-id*="summary"]', 'h1[class*="summary"]',
            'h1[data-testid*="summary-field"]', 'div[data-testid*="summary-field"] h1',
            '[role="presentation"] h1',
            '[data-testid="issue-field-summary.ui.issue-field-summary-inline-edit"] span',
            () => {
                const titleMatch = document.title.match(/^\[([A-Z0-9]+-[0-9]+)\]\s*(.*?)\s+-\s+/);
                return titleMatch && titleMatch[2] ? titleMatch[2].trim() : null;
            }
        ];
        for (const selector of selectors) {
            try {
                let title = null;
                if (typeof selector === 'function') title = selector();
                else {
                    const element = document.querySelector(selector);
                    if (element && element.textContent) title = element.textContent.trim();
                }
                if (title) return title;
            } catch (e) { /* ignore */ }
        }
        return 'Título Desconhecido';
    }

    function getCityName() {
        try {
            const cityElement = document.querySelector(CITY_FIELD_SELECTOR);
            if (cityElement && cityElement.textContent && cityElement.textContent.trim()) {
                return cityElement.textContent.trim();
            }
        } catch (e) {
            console.warn("JIRA TIMER EXT: Erro ao tentar encontrar o campo da cidade:", e);
        }
        return null;
    }

    function getDurationFromInputs() {
        const hoursInput = document.getElementById('jira-ext-timer-hours');
        const minutesInput = document.getElementById('jira-ext-timer-minutes');
        const secondsInput = document.getElementById('jira-ext-timer-seconds');
        let hours = parseInt(hoursInput?.value || '0', 10) || 0;
        let minutes = parseInt(minutesInput?.value || '0', 10) || 0;
        let seconds = parseInt(secondsInput?.value || '0', 10) || 0;
        // Garante que os valores estejam dentro dos limites e atualiza os inputs
        hours = Math.max(0, Math.min(23, hours));
        minutes = Math.max(0, Math.min(59, minutes));
        seconds = Math.max(0, Math.min(59, seconds));
        if (hoursInput) hoursInput.value = hours.toString();
        if (minutesInput) minutesInput.value = minutes.toString();
        if (secondsInput) secondsInput.value = seconds.toString();
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    function setDurationToInputs(totalSeconds) {
        const hoursInput = document.getElementById('jira-ext-timer-hours');
        const minutesInput = document.getElementById('jira-ext-timer-minutes');
        const secondsInput = document.getElementById('jira-ext-timer-seconds');
        if (!hoursInput || !minutesInput || !secondsInput) return;
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secondsRemainder = totalSeconds % 60;
        hoursInput.value = hours.toString();
        minutesInput.value = minutes.toString();
        secondsInput.value = secondsRemainder.toString();
    }

    function formatSecondsToReadableString(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return "Inválido";
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        let parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);
        return parts.join(' ') || "0s";
    }

    function formatTime(milliseconds, showSign = false) {
        const sign = milliseconds < 0 ? "-" : (showSign ? "+" : "");
        milliseconds = Math.abs(milliseconds);
        let totalSeconds = Math.floor(milliseconds / 1000);
        let hours = Math.floor(totalSeconds / 3600);
        totalSeconds %= 3600;
        let minutes = Math.floor(totalSeconds / 60);
        let secondsRemainder = totalSeconds % 60;
        return `${sign}${hours > 0 ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(secondsRemainder).padStart(2, '0')}`;
    }

    function applyCurrentThemeToPagePanel(theme) {
        const panel = document.getElementById('jira-ext-timer-panel');
        if (panel) {
            panel.classList.toggle('dark-theme', theme === 'dark');
        }
    }

    // --- Criação e Inserção do Painel ---
    function createTimerPanel(issueKey) {
        if (!issueKey) {
            console.warn("JIRA TIMER EXT: createTimerPanel chamado sem issueKey.");
            return;
        }
        let panel = document.getElementById('jira-ext-timer-panel');
        if (panel) panel.remove();

        panel = document.createElement('div');
        panel.id = 'jira-ext-timer-panel';
        panel.className = 'jira-ext-timer-module';
        panel.innerHTML = `
            <div class="jira-ext-timer-input-group">
                <input type="text" id="jira-ext-timer-hours" value="0" min="0" max="23" class="jira-ext-timer-input-field" inputmode="numeric" pattern="[0-9]*" title="Horas">
                <span class="jira-ext-timer-separator">h</span>
                <input type="text" id="jira-ext-timer-minutes" value="30" min="0" max="59" class="jira-ext-timer-input-field" inputmode="numeric" pattern="[0-9]*" title="Minutos">
                <span class="jira-ext-timer-separator">m</span>
                <input type="text" id="jira-ext-timer-seconds" value="0" min="0" max="59" class="jira-ext-timer-input-field" inputmode="numeric" pattern="[0-9]*" title="Segundos">
                <span class="jira-ext-timer-separator">s</span>
            </div>
            <button id="jira-ext-timer-action-button" class="jira-ext-timer-action-button start">Iniciar</button>
            <div class="jira-ext-display-and-template-wrapper">
                 <div id="jira-ext-timer-display" class="jira-ext-timer-display-text">Timer parado</div>
                 <select id="jira-ext-template-dropdown" class="jira-ext-template-dropdown-select" style="display: none;" title="Aplicar template de duração"><option value="">Aplicar template...</option></select>
            </div>
        `;

        // Lógica de inserção (mantida da versão anterior, que usava a referência do usuário)
        const activityContainerSelector = 'div[data-testid="issue.activity.comment"]';
        let activityContainer = document.querySelector(activityContainerSelector);
        if (activityContainer) {
            activityContainer.insertBefore(panel, activityContainer.firstChild);
        } else {
            const issueContentWrappers = [
                'div[data-testid="issue.views.issue-base.foundation.primary-column.content.primary-column-content-wrapper"]',
                'div[data-testid="issue.views.issue-base.foundation.primary-column"]',
                'div[class*="issue-view-layout__main-column"]',
                'article[data-testid*="issue-view-page-content"]', '#issue-content', 'main[role="main"]',
            ];
            let insertionPoint = null;
            for (const selector of issueContentWrappers) {
                insertionPoint = document.querySelector(selector);
                if (insertionPoint) {
                    insertionPoint.insertBefore(panel, insertionPoint.firstChild);
                    break;
                }
            }
            if (!insertionPoint) document.body.insertBefore(panel, document.body.firstChild);
        }

        // Aplica tema e carrega templates
        loadAndApplyTheme();
        loadAndPopulateTemplates(panel);

        // Adiciona listener ao botão de ação
        const actionButton = document.getElementById('jira-ext-timer-action-button');
        if (actionButton) {
            actionButton.addEventListener('click', handleActionButtonClick);
        }

        // Pede estado atual ao background para sincronizar a UI
        requestTimerState(issueKey);
    }

    function loadAndApplyTheme() {
        chrome.storage.local.get(GLOBAL_THEME_STORAGE_KEY, (data) => {
            if (chrome.runtime.lastError) console.warn("CS: Erro ao ler tema global:", chrome.runtime.lastError.message);
            else applyCurrentThemeToPagePanel(data[GLOBAL_THEME_STORAGE_KEY] || 'light');
        });
    }

    function loadAndPopulateTemplates(panel) {
        const dropdown = panel.querySelector('#jira-ext-template-dropdown');
        if (!dropdown) return;

        chrome.storage.local.get(TEMPLATE_STORAGE_KEY_CS, (data) => {
            if (chrome.runtime.lastError) { console.warn("CS: Erro ao ler templates:", chrome.runtime.lastError.message); return; }
            const templates = data[TEMPLATE_STORAGE_KEY_CS] || {};
            const templateNames = Object.keys(templates);

            if (templateNames.length > 0) {
                dropdown.style.display = ''; // Mostra o dropdown
                // Limpa opções antigas (exceto a primeira "Aplicar template...")
                while (dropdown.options.length > 1) {
                    dropdown.remove(1);
                }
                // Adiciona novas opções
                templateNames.sort((a, b) => a.localeCompare(b)).forEach(name => {
                    const durationSeconds = templates[name];
                    const option = document.createElement('option');
                    option.value = durationSeconds;
                    option.textContent = `${name} (${formatSecondsToReadableString(durationSeconds)})`;
                    dropdown.appendChild(option);
                });
                // Remove listener antigo e adiciona novo
                dropdown.removeEventListener('change', handleTemplateSelection);
                dropdown.addEventListener('change', handleTemplateSelection);
            } else {
                dropdown.style.display = 'none'; // Esconde se não houver templates
            }
        });
    }

    function handleTemplateSelection(event) {
        const selectedDuration = parseInt(event.target.value, 10);
        if (!isNaN(selectedDuration) && selectedDuration > 0) {
            const hoursInput = document.getElementById('jira-ext-timer-hours');
            // Aplica apenas se os inputs não estiverem desabilitados (timer não rodando)
            if (hoursInput && !hoursInput.disabled) {
                setDurationToInputs(selectedDuration);
            }
        }
        // Reseta o dropdown para a opção padrão após a seleção
        event.target.value = '';
    }

    function requestTimerState(issueKey) {
        chrome.runtime.sendMessage({ action: 'getTimerState', issueKey: issueKey }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`CS: Erro ao pedir estado do timer para ${issueKey}:`, chrome.runtime.lastError.message);
                // Tenta resetar a UI para um estado padrão seguro
                resetTimerUI();
                return;
            }
            if (response && response.success) {
                updateTimerUI(response.timerData, issueKey);
            } else {
                // Se não houver timer no background, reseta a UI
                resetTimerUI();
            }
        });
    }

    // --- Lógica de Ação do Botão Principal ---
    function handleActionButtonClick() {
        const currentIssueKey = getIssueKeyFromURL();
        if (!currentIssueKey) {
            showErrorModal("Erro: Não foi possível identificar o ticket nesta página.");
            return;
        }
        const actionButton = document.getElementById('jira-ext-timer-action-button');
        const isCurrentlyRunning = actionButton.classList.contains('stop');
        actionButton.disabled = true; // Desabilita durante a comunicação com o background

        if (isCurrentlyRunning) {
            // Parar o Timer
            chrome.runtime.sendMessage({ action: 'stopTimer', issueKey: currentIssueKey }, (response) => {
                actionButton.disabled = false; // Reabilita após resposta
                if (chrome.runtime.lastError || !response || !response.success) {
                    console.error(`CS: Falha ao parar timer para ${currentIssueKey}:`, chrome.runtime.lastError?.message, response?.message);
                    showErrorModal(`Erro ao parar o timer: ${response?.message || chrome.runtime.lastError?.message || 'Erro desconhecido'}. Tente recarregar.`);
                    // Tenta resincronizar a UI buscando o estado atual
                    requestTimerState(currentIssueKey);
                } else {
                    // A UI será atualizada pela mensagem 'updateTimerDisplay' do background
                    // console.log(`CS: Comando stopTimer enviado para ${currentIssueKey}`);
                }
            });
        } else {
            // Iniciar o Timer
            const durationSeconds = getDurationFromInputs();
            if (durationSeconds <= 0) {
                showErrorModal("Duração inválida. Configure pelo menos 1 segundo.");
                actionButton.disabled = false;
                return;
            }
            const title = getIssueTitle();
            const cityName = getCityName();
            chrome.runtime.sendMessage({
                action: 'startTimer', issueKey: currentIssueKey, issueTitle: title,
                cityName: cityName, durationSeconds: durationSeconds, pageUrl: window.location.href
            }, (response) => {
                actionButton.disabled = false; // Reabilita após resposta
                if (chrome.runtime.lastError || !response || !response.success) {
                    console.error(`CS: Falha ao iniciar timer para ${currentIssueKey}:`, chrome.runtime.lastError?.message, response?.message);
                    showErrorModal(`Erro ao iniciar o timer: ${response?.message || chrome.runtime.lastError?.message || 'Erro desconhecido'}. Tente recarregar.`);
                    // Tenta resetar a UI em caso de falha
                    resetTimerUI();
                } else {
                    // A UI será atualizada pela mensagem 'updateTimerDisplay' do background
                    // console.log(`CS: Comando startTimer enviado para ${currentIssueKey}`);
                }
            });
        }
    }

    // --- Atualização da UI do Timer ---
    function updateTimerUI(timerData, issueKey) {
        // console.log(`CS: Recebido updateTimerUI para ${issueKey}, dados:`, timerData);
        const displayEl = document.getElementById('jira-ext-timer-display');
        const actionButton = document.getElementById('jira-ext-timer-action-button');
        const hoursInput = document.getElementById('jira-ext-timer-hours');
        const minutesInput = document.getElementById('jira-ext-timer-minutes');
        const secondsInput = document.getElementById('jira-ext-timer-seconds');
        const templateDropdown = document.getElementById('jira-ext-template-dropdown');

        // Limpa o intervalo anterior antes de definir um novo estado
        if (onPageTimerInterval) {
            clearInterval(onPageTimerInterval);
            onPageTimerInterval = null;
        }

        if (!displayEl || !actionButton || !hoursInput || !minutesInput || !secondsInput || !templateDropdown) {
            // console.warn("CS: Elementos da UI não encontrados durante updateTimerUI. O painel pode ter sido removido.");
            return; // Aborta se elementos essenciais não existem
        }

        // Estado padrão: Timer parado/não existente
        let buttonText = 'Iniciar';
        let buttonClass = 'start';
        let displayHTML = 'Timer parado';
        let inputsDisabled = false;

        if (timerData) {
            // Define o estado baseado nos dados recebidos
            if (timerData.status === 'running' && timerData.endTime) {
                buttonText = 'Parar';
                buttonClass = 'stop';
                inputsDisabled = true;
                setDurationToInputs(timerData.originalDurationSeconds || 0); // Mostra duração original nos inputs

                const updateRunning = () => {
                    const timeLeft = timerData.endTime - Date.now();
                    if (timeLeft > 0) {
                        displayEl.innerHTML = `Tempo restante: ${formatTime(timeLeft)}`;
                    } else {
                        // O tempo acabou, mas o estado ainda é 'running' (esperando background atualizar)
                        // Mostra expirado e para o intervalo local.
                        displayEl.innerHTML = `<span class="timer-expired-notification">TEMPO ESGOTADO!</span>`;
                        if (onPageTimerInterval) clearInterval(onPageTimerInterval);
                        onPageTimerInterval = null;
                        // O background logo enviará o estado 'expired' oficial.
                    }
                };
                updateRunning();
                onPageTimerInterval = setInterval(updateRunning, 1000);

            } else if (timerData.status === 'expired' && timerData.endTime) {
                buttonText = 'Iniciar'; // Botão volta a ser 'Iniciar' quando expira
                buttonClass = 'start';
                inputsDisabled = false; // Permite iniciar um novo timer
                setDurationToInputs(timerData.originalDurationSeconds || 0); // Mantém a duração original nos inputs

                // **CORREÇÃO:** Inicia um intervalo para atualizar o tempo excedido
                const updateExpired = () => {
                    const timeExceeded = Date.now() - timerData.endTime;
                    displayEl.innerHTML = `<span class="timer-expired-notification">TEMPO ESGOTADO!</span>
                                         <span class="timer-exceeded-info">Excedido há: ${formatTime(timeExceeded)}</span>`;
                };
                updateExpired(); // Executa imediatamente
                onPageTimerInterval = setInterval(updateExpired, 1000); // Atualiza a cada segundo

            } else if (timerData.status === 'stopped') {
                buttonText = 'Iniciar';
                buttonClass = 'start';
                displayHTML = 'Timer parado.';
                inputsDisabled = false;
                setDurationToInputs(timerData.originalDurationSeconds || 0); // Mostra duração original
            }
        } else {
             // Se timerData é null (timer limpo), reseta para o estado inicial
             resetTimerUI();
             return; // Sai da função pois resetTimerUI já fez o necessário
        }

        // Aplica o estado à UI
        actionButton.textContent = buttonText;
        actionButton.className = `jira-ext-timer-action-button ${buttonClass}`;
        actionButton.disabled = false; // Garante que o botão esteja habilitado após a atualização
        displayEl.innerHTML = displayHTML; // Define o HTML inicial (será sobrescrito pelos intervalos se running/expired)
        hoursInput.disabled = inputsDisabled;
        minutesInput.disabled = inputsDisabled;
        secondsInput.disabled = inputsDisabled;
        templateDropdown.disabled = inputsDisabled;
        if (!inputsDisabled) {
             templateDropdown.value = ''; // Reseta seleção do dropdown se habilitado
        }
    }

    // Reseta a UI para o estado inicial (timer não existe ou foi limpo)
    function resetTimerUI() {
        // console.log("CS: Chamando resetTimerUI");
        const displayEl = document.getElementById('jira-ext-timer-display');
        const actionButton = document.getElementById('jira-ext-timer-action-button');
        const hoursInput = document.getElementById('jira-ext-timer-hours');
        const minutesInput = document.getElementById('jira-ext-timer-minutes');
        const secondsInput = document.getElementById('jira-ext-timer-seconds');
        const templateDropdown = document.getElementById('jira-ext-template-dropdown');

        if (onPageTimerInterval) {
            clearInterval(onPageTimerInterval);
            onPageTimerInterval = null;
        }

        if (displayEl) displayEl.innerHTML = 'Timer parado';
        if (actionButton) {
            actionButton.textContent = 'Iniciar';
            actionButton.className = 'jira-ext-timer-action-button start';
            actionButton.disabled = false;
        }
        if (hoursInput) hoursInput.disabled = false;
        if (minutesInput) minutesInput.disabled = false;
        if (secondsInput) secondsInput.disabled = false;
        if (templateDropdown) {
             templateDropdown.disabled = false;
             templateDropdown.value = '';
        }

        // Define um valor padrão para os inputs se estiverem vazios (ex: 30m)
        if (hoursInput && minutesInput && secondsInput &&
            hoursInput.value === '0' && minutesInput.value === '0' && secondsInput.value === '0') {
            setDurationToInputs(30 * 60); // Padrão de 30 minutos
        }
    }

    // --- Tratamento de Erros (Modal Simples) ---
    function showErrorModal(message) {
        let modal = document.getElementById('jiraExtErrorModal');
        if (modal) modal.remove(); // Remove modal anterior se existir

        modal = document.createElement('div');
        modal.id = 'jiraExtErrorModal';
        // Estilos inline para simplicidade e evitar conflitos
        modal.innerHTML = `
            <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); display:flex; justify-content:center; align-items:center; z-index:2147483647; font-family: sans-serif;">
                <div style="background: var(--timer-bg-color, #fff); color: var(--timer-text-color, #000); padding: 25px; border-radius: 5px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); max-width: 300px; text-align: center;">
                    <p style="margin: 0 0 15px 0; font-size: 14px; line-height: 1.4;">${message}</p>
                    <button id="jiraExtErrorOkButton" style="padding: 8px 15px; background: var(--timer-button-start-bg, #0052CC); color: var(--timer-button-text, #fff); border: none; border-radius: 3px; cursor: pointer; font-size: 14px;">OK</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        // Adiciona listener ao botão OK para fechar o modal
        document.getElementById('jiraExtErrorOkButton').addEventListener('click', () => modal.remove(), { once: true });
    }

    // --- Listener para Mensagens do Background ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        const currentKey = getIssueKeyFromURL();
        // Ignora mensagens que não são para o ticket atual
        if (!currentKey || request.issueKey !== currentKey) {
            // console.log(`CS: Mensagem ignorada (${request.action}) - Key mismatch. Atual: ${currentKey}, Mensagem: ${request.issueKey}`);
            return true; // Indica que não vai enviar resposta síncrona
        }

        if (request.action === 'updateTimerDisplay' || request.action === 'timerExpiredNotificationDone') {
            // console.log(`CS: Recebido ${request.action} para ${request.issueKey}`);
            updateTimerUI(request.timerData, request.issueKey);
            sendResponse({ status: `CS UI updated for ${request.action}` });
        } else {
            // Ação desconhecida ou não relevante para o content script
            sendResponse({ status: `CS ignored action ${request.action}` });
        }
        return true; // Indica que a resposta pode ser assíncrona (embora aqui seja síncrona)
    });

    // --- Listener para Mudanças no Storage (Tema e Templates) ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes[GLOBAL_THEME_STORAGE_KEY]) {
                applyCurrentThemeToPagePanel(changes[GLOBAL_THEME_STORAGE_KEY].newValue || 'light');
            }
            if (changes[TEMPLATE_STORAGE_KEY_CS]) {
                const panel = document.getElementById('jira-ext-timer-panel');
                if (panel) loadAndPopulateTemplates(panel);
            }
        }
    });

    // --- Inicialização e Observador de Mudanças na DOM ---
    function initializeTimerPanel() {
        const currentIssueKey = getIssueKeyFromURL();
        if (currentIssueKey) {
            // Tenta criar o painel. Se já existir, será removido e recriado.
            createTimerPanel(currentIssueKey);
        } else {
            // Se não estamos em uma página de issue, remove qualquer painel antigo
            const oldPanel = document.getElementById('jira-ext-timer-panel');
            if (oldPanel) oldPanel.remove();
        }
    }

    // Observador para lidar com navegação SPA no Jira
    let lastUrl = location.href;
    const observer = new MutationObserver((mutations) => {
        // Verifica se a URL mudou (indicativo de navegação SPA)
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // console.log(`CS: URL mudou para ${lastUrl}, reinicializando painel...`);
            // Dá um pequeno tempo para a nova página renderizar antes de tentar inserir
            setTimeout(initializeTimerPanel, 500);
        } else {
            // Se a URL não mudou, verifica se o painel existe e se o container principal ainda está lá
            // Isso ajuda a recriar o painel se ele for removido por alguma atualização da UI do Jira
            const panelExists = !!document.getElementById('jira-ext-timer-panel');
            const mainContainerExists = !!document.querySelector('div[data-testid="issue.activity.comment"]') || !!document.querySelector('div[data-testid="issue.views.issue-base.foundation.primary-column"]');

            if (mainContainerExists && !panelExists && getIssueKeyFromURL()) {
                 // console.log("CS: Container existe, mas painel sumiu. Tentando recriar...");
                 setTimeout(initializeTimerPanel, 300); // Tenta recriar com um delay menor
            }
        }
    });

    // Inicia observando mudanças na árvore DOM
    observer.observe(document.body, { childList: true, subtree: true });

    // Tentativa inicial de criação do painel ao carregar o script
    // Usa um timeout maior para dar chance à página do Jira carregar completamente
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initializeTimerPanel, 1500);
    } else {
        window.addEventListener('load', () => setTimeout(initializeTimerPanel, 1800), { once: true });
    }

})();

