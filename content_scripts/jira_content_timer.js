// content_scripts/jira_content_timer.js
// Versão com logs de diagnóstico para reset de UI
(function() {
    'use strict';
    // console.log("JIRA TIMER EXT: Content script v1.31 (Logs de Reset) carregado!");

    let onPageTimerInterval = null;
    const GLOBAL_THEME_STORAGE_KEY = 'jiraGlobalTimerTheme';
    const TEMPLATE_STORAGE_KEY_CS = 'jiraTimerTemplates';
    const CITY_FIELD_SELECTOR = 'div[data-testid="issue.views.field.single-line-text.read-view.customfield_11994"]';

    // ... (funções getIssueKeyFromURL, getIssueTitle, getCityName, getDurationFromInputs, setDurationToInputs, formatSecondsToReadableString, formatTime, applyCurrentThemeToPagePanel - sem alterações)
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


    function createTimerPanel(issueKey) {
        if (!issueKey) {
            console.warn("JIRA TIMER EXT: createTimerPanel chamado sem issueKey. Painel não será criado.");
            return;
        }
        // console.log(`CS: Criando painel do timer para ${issueKey}`);
        let panel = document.getElementById('jira-ext-timer-panel');
        if (panel) panel.remove();

        panel = document.createElement('div');
        panel.id = 'jira-ext-timer-panel';
        panel.className = 'jira-ext-timer-module';
        panel.innerHTML = `
            <div class="jira-ext-timer-input-group">
                <input type="text" id="jira-ext-timer-hours" value="0" min="0" max="23" class="jira-ext-timer-input-field" inputmode="numeric" pattern="[0-9]*">
                <span class="jira-ext-timer-separator">h</span>
                <input type="text" id="jira-ext-timer-minutes" value="30" min="0" max="59" class="jira-ext-timer-input-field" inputmode="numeric" pattern="[0-9]*">
                <span class="jira-ext-timer-separator">m</span>
                <input type="text" id="jira-ext-timer-seconds" value="0" min="0" max="59" class="jira-ext-timer-input-field" inputmode="numeric" pattern="[0-9]*">
                <span class="jira-ext-timer-separator">s</span>
            </div>
            <button id="jira-ext-timer-action-button" class="jira-ext-timer-action-button start">Iniciar</button>
            <div class="jira-ext-display-and-template-wrapper">
                 <div id="jira-ext-timer-display" class="jira-ext-timer-display-text">Timer parado</div>
            </div>
        `;

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

        chrome.storage.local.get(GLOBAL_THEME_STORAGE_KEY, (data) => {
            if (chrome.runtime.lastError) console.warn("CS: Erro ao ler tema global:", chrome.runtime.lastError.message);
            else applyCurrentThemeToPagePanel(data[GLOBAL_THEME_STORAGE_KEY] || 'light');
        });

        chrome.storage.local.get(TEMPLATE_STORAGE_KEY_CS, (data) => {
            if (chrome.runtime.lastError) { console.warn("CS: Erro ao ler templates:", chrome.runtime.lastError.message); return; }
            const templates = data[TEMPLATE_STORAGE_KEY_CS] || {};
            const displayAndTemplateWrapper = panel.querySelector('.jira-ext-display-and-template-wrapper');
            if (Object.keys(templates).length > 0 && displayAndTemplateWrapper) {
                const dropdown = document.createElement('select');
                dropdown.id = 'jira-ext-template-dropdown';
                dropdown.className = 'jira-ext-template-dropdown-select';
                const defaultOption = document.createElement('option');
                defaultOption.value = ''; defaultOption.textContent = 'Aplicar template...';
                dropdown.appendChild(defaultOption);
                Object.keys(templates).sort((a,b) => a.localeCompare(b)).forEach(name => {
                    const durationSeconds = templates[name];
                    const option = document.createElement('option');
                    option.value = durationSeconds;
                    option.textContent = `${name} (${formatSecondsToReadableString(durationSeconds)})`;
                    dropdown.appendChild(option);
                });
                dropdown.addEventListener('change', (event) => {
                    const selectedDuration = parseInt(event.target.value, 10);
                    if (!isNaN(selectedDuration) && selectedDuration > 0) {
                        const hoursInput = document.getElementById('jira-ext-timer-hours');
                        if (hoursInput && !hoursInput.disabled) setDurationToInputs(selectedDuration);
                        else event.target.value = '';
                    }
                });
                displayAndTemplateWrapper.appendChild(dropdown);
            }
        });

        const actionButton = document.getElementById('jira-ext-timer-action-button');
        const handleActionButtonClick = () => {
            const currentIssueKeyForAction = getIssueKeyFromURL();
            if (!currentIssueKeyForAction) {
                console.error("CS: Ação de timer sem issueKey!");
                alert("Erro: Não foi possível identificar o ticket.");
                return;
            }
            const isCurrentlyRunning = actionButton.classList.contains('stop');
            actionButton.disabled = true; // Disable button during processing

            if (isCurrentlyRunning) {
                chrome.runtime.sendMessage({ action: 'stopTimer', issueKey: currentIssueKeyForAction }, (response) => {
                    actionButton.disabled = false; // Re-enable button
                    if (chrome.runtime.lastError) {
                        console.error(`CS: Erro ao enviar 'stopTimer' para ${currentIssueKeyForAction}:`, chrome.runtime.lastError.message);
                        alert(`Erro ao parar o timer: ${chrome.runtime.lastError.message}. Tente recarregar a página ou a extensão.`);
                        // Fetch current state to try to sync UI
                        chrome.runtime.sendMessage({ action: 'getTimerState', issueKey: currentIssueKeyForAction }, (stateResp) => {
                            if (!chrome.runtime.lastError && stateResp) updateTimerUI(stateResp.timerData, currentIssueKeyForAction);
                        });
                        return;
                    }
                    if (response && response.success) {
                        updateTimerUI(response.timerData, currentIssueKeyForAction);
                    } else {
                        console.error(`CS: Falha ao parar timer para ${currentIssueKeyForAction}:`, response ? response.message : "Resposta inválida.");
                        alert(`Falha ao parar o timer: ${response ? response.message : "Erro desconhecido"}`);
                        // Fetch current state
                         chrome.runtime.sendMessage({ action: 'getTimerState', issueKey: currentIssueKeyForAction }, (stateResp) => {
                            if (!chrome.runtime.lastError && stateResp) updateTimerUI(stateResp.timerData, currentIssueKeyForAction);
                        });
                    }
                });
            } else { // Starting timer
                const durationSeconds = getDurationFromInputs();
                if (durationSeconds <= 0) {
                    // ... (código do modal de erro existente)
                    const modalError = document.getElementById('jiraExtErrorModal');
                    if (modalError) modalError.remove();
                    const modal = document.createElement('div');
                    modal.id = 'jiraExtErrorModal';
                    modal.innerHTML = `<div style="position:fixed; top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:2147483647;">
                                         <div style="background:var(--timer-bg-color, white); color: var(--timer-text-color, black); padding:20px;border-radius:5px;box-shadow:0 2px 10px rgba(0,0,0,0.2);">
                                           <p>Por favor, insira uma duração válida.<br>Configure pelo menos 1 segundo.</p>
                                           <button id="jiraExtErrorOkButton" style="padding:5px 10px;float:right; background: var(--timer-button-start-bg); color: var(--timer-button-text); border: none; border-radius: 3px;">OK</button>
                                         </div>
                                       </div>`;
                    document.body.appendChild(modal);
                    document.getElementById('jiraExtErrorOkButton').onclick = () => modal.remove();
                    actionButton.disabled = false; // Re-enable button
                    return;
                }
                const title = getIssueTitle();
                const cityName = getCityName();
                chrome.runtime.sendMessage({
                    action: 'startTimer', issueKey: currentIssueKeyForAction, issueTitle: title,
                    cityName: cityName, durationSeconds: durationSeconds, pageUrl: window.location.href
                }, (response) => {
                    actionButton.disabled = false; // Re-enable button
                    if (chrome.runtime.lastError) {
                        console.error(`CS: Erro ao enviar 'startTimer' para ${currentIssueKeyForAction}:`, chrome.runtime.lastError.message);
                        alert(`Erro ao iniciar o timer: ${chrome.runtime.lastError.message}. Tente recarregar.`);
                        // UI might be inconsistent, try to reset or fetch state
                        resetTimerUI(); // Revert optimistic UI if any, or set to default
                        return;
                    }
                    if (response && response.success) {
                        updateTimerUI(response.timerData, currentIssueKeyForAction);
                    } else {
                        console.error(`CS: Falha ao iniciar timer para ${currentIssueKeyForAction}:`, response ? response.message : "Resposta inválida.");
                        alert(`Falha ao iniciar o timer: ${response ? response.message : "Erro desconhecido"}`);
                        resetTimerUI(); // Revert UI
                    }
                });
            }
        };
        if (actionButton) {
            actionButton.removeEventListener('click', handleActionButtonClick);
            actionButton.addEventListener('click', handleActionButtonClick);
        }

        chrome.runtime.sendMessage({ action: 'getTimerState', issueKey: issueKey }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(`CS: Erro ao buscar estado inicial do timer para ${issueKey}:`, chrome.runtime.lastError.message);
                resetTimerUI(); return;
            }
            if (response && response.success) { // Checa 'success' da resposta do background
                updateTimerUI(response.timerData, issueKey);
            } else {
                // console.log(`CS: Nenhum dado de timer ativo para ${issueKey} no estado inicial ou falha ao buscar.`);
                resetTimerUI();
            }
        });
    }

    function updateTimerUI(timerData, issueKey) {
        // ADICIONADO Log para quando timerData é null
        if (timerData === null) {
            console.log(`CS: updateTimerUI recebido timerData NULL para ${issueKey}. Chamando resetTimerUI.`);
        } else if (timerData) {
            // console.log(`CS: updateTimerUI para ${issueKey} com timerData:`, timerData);
        }


        const displayEl = document.getElementById('jira-ext-timer-display');
        const actionButton = document.getElementById('jira-ext-timer-action-button');
        const hoursInput = document.getElementById('jira-ext-timer-hours');
        const minutesInput = document.getElementById('jira-ext-timer-minutes');
        const secondsInput = document.getElementById('jira-ext-timer-seconds');
        const templateDropdown = document.getElementById('jira-ext-template-dropdown');

        if (!displayEl || !actionButton || !hoursInput || !minutesInput || !secondsInput) {
            // console.warn("CS: Elementos da UI do timer não encontrados em updateTimerUI. O painel foi removido?");
            return;
        }

        if (onPageTimerInterval) clearInterval(onPageTimerInterval);
        onPageTimerInterval = null;

        if (timerData && timerData.status === 'running' && timerData.endTime) {
            actionButton.textContent = 'Parar';
            actionButton.classList.remove('start'); actionButton.classList.add('stop');
            hoursInput.disabled = true; minutesInput.disabled = true; secondsInput.disabled = true;
            if (templateDropdown) templateDropdown.disabled = true;
            setDurationToInputs(timerData.originalDurationSeconds || 0);
            const updateRunningDisplay = () => {
                const timeLeft = timerData.endTime - Date.now();
                if (timeLeft > 0) {
                    displayEl.innerHTML = `${formatTime(timeLeft)}`;
                } else { // Timer just expired while this interval was running
                    // console.log(`CS: Timer ${issueKey} expirou (detectado no intervalo do content script).`)
                    clearInterval(onPageTimerInterval); onPageTimerInterval = null;
                    // O background script deve enviar uma notificação 'timerExpiredNotificationDone'
                    // que chamará updateTimerUI novamente com status 'expired'.
                    // Para evitar UI piscando, podemos mostrar um estado intermediário ou apenas esperar.
                    // Por simplicidade, vamos aguardar a mensagem do background.
                    // Mas, se a mensagem demorar, a UI parecerá congelada.
                    // Alternativa: atualizar para "Expirado!" imediatamente.
                    displayEl.innerHTML = `<span class="timer-expired-notification">Expirado!</span>`;
                     // E então buscar o estado mais recente para ter o tempo excedido.
                    chrome.runtime.sendMessage({ action: 'getTimerState', issueKey: issueKey }, (response) => {
                        if (!chrome.runtime.lastError && response && response.success) {
                             updateTimerUI(response.timerData, issueKey);
                        }
                    });
                }
            };
            updateRunningDisplay();
            onPageTimerInterval = setInterval(updateRunningDisplay, 1000);
        } else if (timerData && timerData.status === 'expired' && timerData.endTime) {
            actionButton.textContent = 'Iniciar';
            actionButton.classList.remove('stop'); actionButton.classList.add('start');
            hoursInput.disabled = false; minutesInput.disabled = false; secondsInput.disabled = false;
            if (templateDropdown) templateDropdown.disabled = false;
            setDurationToInputs(timerData.originalDurationSeconds || 0);
            const updateExpiredDisplay = () => {
                const timeExceeded = Date.now() - timerData.endTime;
                displayEl.innerHTML = `<span class="timer-expired-notification">Expirado!</span> <span class="timer-exceeded-info">${formatTime(timeExceeded)}</span>`;
            };
            updateExpiredDisplay();
            // Não precisa de intervalo para tempo excedido se a mensagem do background já é o gatilho
            // No entanto, para exibir o tempo excedido atualizando, um intervalo pode ser útil.
            // Mas o onAlarm já faz isso ao chamar notifyContentScriptTimerExpired
            // if (onPageTimerInterval) clearInterval(onPageTimerInterval); // Clear any previous one
            // onPageTimerInterval = setInterval(updateExpiredDisplay, 1000); // Re-enable if live update of exceeded time is desired
        } else { // Timer está 'stopped', é null (limpo), ou estado inicial
            // console.log(`CS: updateTimerUI para ${issueKey} caindo no 'else' (parado/nulo/inicial). TimerData:`, timerData);
            resetTimerUI(); // Lida com inputs, botão, e texto de display padrão.
            if (timerData && timerData.status === 'stopped') { // Se explicitamente parado (e não nulo)
                 // console.log(`CS: Timer ${issueKey} está 'stopped'. Configurando duração original.`);
                 displayEl.textContent = 'Parado'; // Opcional, resetTimerUI já faz parecido
                 setDurationToInputs(timerData.originalDurationSeconds || 0);
            }
            // Se timerData for null, resetTimerUI já definiu para o padrão (30 min, "Timer parado")
        }
    }

    function resetTimerUI() {
        console.log("CS: resetTimerUI chamado. Resetando painel para o estado padrão.");
        const displayEl = document.getElementById('jira-ext-timer-display');
        const actionButton = document.getElementById('jira-ext-timer-action-button');
        const hoursInput = document.getElementById('jira-ext-timer-hours');
        const minutesInput = document.getElementById('jira-ext-timer-minutes');
        const secondsInput = document.getElementById('jira-ext-timer-seconds');
        const templateDropdown = document.getElementById('jira-ext-template-dropdown');

        if (displayEl) displayEl.textContent = 'Timer parado';
        if (actionButton) {
            actionButton.textContent = 'Iniciar';
            actionButton.classList.remove('stop'); actionButton.classList.add('start');
            actionButton.disabled = false; // Garantir que o botão esteja habilitado
        }
        if (hoursInput) hoursInput.disabled = false;
        if (minutesInput) minutesInput.disabled = false;
        if (secondsInput) secondsInput.disabled = false;
        if (templateDropdown) {
            templateDropdown.disabled = false;
            templateDropdown.value = '';
        }

        if (onPageTimerInterval) {
            // console.log("CS: Limpando onPageTimerInterval em resetTimerUI.");
            clearInterval(onPageTimerInterval);
            onPageTimerInterval = null;
        }
        setDurationToInputs(1800); // Default to 30 minutes
        // console.log("CS: resetTimerUI finalizado. Inputs devem ser 30:00, texto 'Timer parado'.");
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (chrome.runtime.lastError) {
            console.warn("CS: Erro ao receber mensagem:", chrome.runtime.lastError.message);
            return true; // Mantém canal aberto para outras extensões, se necessário
        }
        const currentKey = getIssueKeyFromURL();
        // console.log(`CS: Mensagem recebida: action=${request.action}, issueKey=${request.issueKey}, currentKey=${currentKey}`);

        if (request.action === 'updateTimerDisplay' || request.action === 'timerExpiredNotificationDone') {
            if (!currentKey || request.issueKey !== currentKey) {
                // console.log(`CS: Mensagem ignorada (issueKey não corresponde ou currentKey nulo). Mensagem para ${request.issueKey}, página atual ${currentKey}`);
                // Não envie resposta se a mensagem não for para esta página, para não fechar o canal para a página correta.
                return false; // Indica que não vamos enviar uma resposta assíncrona.
            }
            // console.log(`CS: Processando ${request.action} para ${request.issueKey}. Dados:`, request.timerData);
            updateTimerUI(request.timerData, request.issueKey);
            sendResponse({status: `CS UI updated for ${request.action} on ${request.issueKey}`});
        }
        return true; // Retornar true para sendResponse assíncrona se outras ações forem adicionadas
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes[GLOBAL_THEME_STORAGE_KEY]) {
                applyCurrentThemeToPagePanel(changes[GLOBAL_THEME_STORAGE_KEY].newValue || 'light');
            }
            if (changes[TEMPLATE_STORAGE_KEY_CS]) {
                const currentPanelIssueKey = getIssueKeyFromURL();
                if (currentPanelIssueKey && document.getElementById('jira-ext-timer-panel')) {
                    // console.log("CS: Templates alterados, recriando painel para atualizar dropdown.");
                    createTimerPanel(currentPanelIssueKey);
                }
            }
        }
    });

    const currentIssueKey = getIssueKeyFromURL();
    if (currentIssueKey) {
        const initPanel = () => {
            // Verifica se o painel já existe para evitar duplicatas
            // Esta verificação é crucial, especialmente com o MutationObserver
            if (!document.getElementById('jira-ext-timer-panel')) {
                // console.log(`CS: initPanel - painel não existe para ${currentIssueKey}, criando...`);
                createTimerPanel(currentIssueKey);
            } else {
                // console.log(`CS: initPanel - painel já existe para ${currentIssueKey}, não recriando.`);
                // Opcional: Se o painel existe, talvez forçar uma atualização de estado?
                // chrome.runtime.sendMessage({ action: 'getTimerState', issueKey: currentIssueKey }, (response) => {
                //     if (!chrome.runtime.lastError && response && response.success) {
                //         updateTimerUI(response.timerData, currentIssueKey);
                //     }
                // });
            }
        };
        const observer = new MutationObserver((mutationsList, obs) => {
            // Observador mais seletivo para evitar recriações desnecessárias
            // Tenta encontrar um elemento chave que indica que a UI principal do Jira carregou/mudou
            // e que nosso painel *não* está presente.
            const jiraContentAnchor = document.querySelector(activityContainerSelector) || document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]');
            if (jiraContentAnchor && !document.getElementById('jira-ext-timer-panel')) {
                // console.log("CS: MutationObserver detectou mudança e ausência do painel. Tentando (re)criar painel.");
                // Usar um debounce ou delay menor pode ser considerado se 750ms for muito.
                // Um clearTimeout em um timer de initPanel anterior pode ser útil para evitar múltiplas chamadas.
                setTimeout(initPanel, 750); // Delay para estabilização da DOM
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            // console.log("CS: Documento pronto, agendando initPanel.");
            setTimeout(initPanel, 1000); // Aumentado um pouco o delay inicial
        } else {
            window.addEventListener('load', () => {
                // console.log("CS: Evento 'load' disparado, agendando initPanel.");
                setTimeout(initPanel, 1200); // Aumentado um pouco o delay pós-load
            }, { once: true });
        }
    }
})();