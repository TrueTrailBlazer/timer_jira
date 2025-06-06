// popup/popup.js
// Versão Refatorada: Remove setInterval, usa mensagens para atualização
'use strict';

const GLOBAL_THEME_STORAGE_KEY = 'jiraGlobalTimerTheme';
const TEMPLATE_STORAGE_KEY = 'jiraTimerTemplates';

// --- Funções de formatação (sem alterações) ---
function formatTime(milliseconds, showSign = false) {
    const sign = milliseconds < 0 ? "-" : (showSign ? "+" : "");
    milliseconds = Math.abs(milliseconds);
    let totalSeconds = Math.floor(milliseconds / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    return `${sign}${hours > 0 ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationForDisplay(totalSeconds) {
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

// --- Controle de Tema (sem alterações) ---
function applyPopupCurrentTheme(theme) {
    document.body.classList.toggle('dark-theme', theme === 'dark');
    const themeToggleButton = document.getElementById('popup-theme-toggle');
    if (themeToggleButton) themeToggleButton.textContent = theme === 'light' ? '🌙' : '☀️';
}

function toggleAndStorePopupTheme() {
    chrome.storage.local.get(GLOBAL_THEME_STORAGE_KEY, (data) => {
        const currentTheme = data[GLOBAL_THEME_STORAGE_KEY] || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        chrome.storage.local.set({ [GLOBAL_THEME_STORAGE_KEY]: newTheme });
        // A mudança no storage vai disparar o listener onChanged para aplicar o tema
    });
}

// --- Controle de Visualização (sem alterações) ---
function showTimersView() {
    document.getElementById('timers-view').style.display = 'block';
    document.getElementById('templates-view').style.display = 'none';
    // Carrega os timers ao mostrar a view, garantindo dados frescos
    loadTimers();
}

function showTemplatesView() {
    document.getElementById('timers-view').style.display = 'none';
    document.getElementById('templates-view').style.display = 'block';
    loadTemplates();
}

// --- Lógica de Timers Ativos ---
let activeTimerIntervals = {}; // Armazena IDs de intervalos para timers ativos

function clearAllTimerIntervals() {
    Object.values(activeTimerIntervals).forEach(clearInterval);
    activeTimerIntervals = {};
}

function renderTimers(timersData) {
    const timersList = document.getElementById('timers-list');
    const noTimersMessage = document.getElementById('no-timers-message');
    timersList.innerHTML = '';
    clearAllTimerIntervals(); // Limpa intervalos antigos antes de renderizar

    const activeTimersArray = Object.values(timersData)
        .filter(timer => timer.status === 'running' || timer.status === 'expired');

    if (activeTimersArray.length === 0) {
        noTimersMessage.style.display = 'block';
        timersList.style.display = 'none';
    } else {
        noTimersMessage.style.display = 'none';
        timersList.style.display = 'block';
    }

    activeTimersArray.sort((a, b) => {
        const aIsExpired = a.status === 'expired';
        const bIsExpired = b.status === 'expired';
        if (aIsExpired && !bIsExpired) return -1;
        if (bIsExpired && !aIsExpired) return 1;
        if (aIsExpired && bIsExpired) return (a.endTime || 0) - (b.endTime || 0);
        return (a.endTime || 0) - (b.endTime || 0);
    });

    activeTimersArray.forEach(timer => {
        const listItem = document.createElement('li');
        listItem.className = 'timer-item';
        listItem.id = `timer-item-${timer.issueKey}`; // Adiciona ID para atualização
        const title = timer.issueTitle || 'Título Desconhecido';
        const truncatedTitle = title.length > 35 ? title.substring(0, 32) + '...' : title;

        let issueKeyDisplay = `<strong class="issue-key" title="${timer.issueKey}">${timer.issueKey}</strong>`;
        if (timer.cityName) {
            issueKeyDisplay += ` <span class="timer-city-name">(${timer.cityName})</span>`;
        }

        listItem.innerHTML = `
            <div class="timer-info">
                <div class="timer-info-line1">${issueKeyDisplay}</div>
                <span class="issue-title" title="${title}">${truncatedTitle}</span>
                <div class="timer-display-popup" id="timer-display-${timer.issueKey}"></div>
            </div>
            <div class="timer-actions">
                <button class="action-button open-ticket" data-url="${timer.pageUrl}" title="Abrir ticket">Abrir</button>
                ${timer.status === 'running' ? `<button class="action-button stop-timer" data-issuekey="${timer.issueKey}" title="Parar timer">Parar</button>` : ''}
                ${(timer.status === 'expired' || timer.status === 'stopped') ? `<button class="action-button clear-timer" data-issuekey="${timer.issueKey}" title="Limpar da lista">Limpar</button>` : ''}
            </div>`;
        timersList.appendChild(listItem);

        // Atualiza o display do timer específico
        updateTimerDisplay(timer);
    });

    // Adiciona listeners aos botões após renderizar todos os itens
    addEventListenersToButtons();
}

function updateTimerDisplay(timer) {
    const displayElement = document.getElementById(`timer-display-${timer.issueKey}`);
    const listItemElement = document.getElementById(`timer-item-${timer.issueKey}`);
    if (!displayElement || !listItemElement) return;

    // Limpa intervalo anterior para este timer, se existir
    if (activeTimerIntervals[timer.issueKey]) {
        clearInterval(activeTimerIntervals[timer.issueKey]);
        delete activeTimerIntervals[timer.issueKey];
    }

    listItemElement.classList.remove('running', 'expired'); // Limpa classes de estado

    if (timer.status === 'running' && timer.endTime) {
        const update = () => {
            const timeLeft = timer.endTime - Date.now();
            if (timeLeft > 0) {
                displayElement.innerHTML = `<span>Tempo restante: ${formatTime(timeLeft)}</span>`;
                listItemElement.classList.add('running');
            } else {
                // O tempo acabou, mas o estado ainda não foi atualizado pelo background.
                // Mostra expirado temporariamente e limpa o intervalo.
                // A próxima mensagem 'timersUpdated' trará o estado 'expired' oficial.
                displayElement.innerHTML = `<span class="expired-text">TEMPO ESGOTADO!</span>`;
                listItemElement.classList.add('expired');
                if (activeTimerIntervals[timer.issueKey]) {
                    clearInterval(activeTimerIntervals[timer.issueKey]);
                    delete activeTimerIntervals[timer.issueKey];
                }
                // Solicita atualização do background para garantir estado correto
                loadTimers();
            }
        };
        update(); // Executa imediatamente
        activeTimerIntervals[timer.issueKey] = setInterval(update, 1000); // Inicia novo intervalo

    } else if (timer.status === 'expired' && timer.endTime) {
        listItemElement.classList.add('expired');
        const update = () => {
            const timeExceeded = Date.now() - timer.endTime;
            displayElement.innerHTML = `<span class="expired-text">TEMPO ESGOTADO!</span>
                                    <span class="exceeded-text">Excedido há: ${formatTime(timeExceeded)}</span>`;
        };
        update(); // Executa imediatamente
        activeTimerIntervals[timer.issueKey] = setInterval(update, 1000); // Inicia novo intervalo para tempo excedido

    } else { // Stopped or other states
        displayElement.innerHTML = '<span>Timer parado</span>';
    }
}

function addEventListenersToButtons() {
    document.querySelectorAll('.open-ticket').forEach(button => {
        button.removeEventListener('click', handleOpenTicket); // Remove listener antigo se houver
        button.addEventListener('click', handleOpenTicket);
    });
    document.querySelectorAll('.stop-timer').forEach(button => {
        button.removeEventListener('click', handleStopTimer); // Remove listener antigo se houver
        button.addEventListener('click', handleStopTimer);
    });
    document.querySelectorAll('.clear-timer').forEach(button => {
        button.removeEventListener('click', handleClearTimer); // Remove listener antigo se houver
        button.addEventListener('click', handleClearTimer);
    });
}

function handleOpenTicket(e) {
    chrome.tabs.create({ url: e.target.dataset.url, active: true });
}

function handleStopTimer(e) {
    const issueKey = e.target.dataset.issuekey;
    e.target.disabled = true; // Desabilita botão temporariamente
    chrome.runtime.sendMessage({ action: 'stopTimer', issueKey: issueKey }, (response) => {
        // A atualização da UI virá pela mensagem 'timersUpdated'
        // Apenas reabilita o botão se houver erro?
        // Por enquanto, não reabilita, a UI será redesenhada.
        if (chrome.runtime.lastError || !response || !response.success) {
             console.error("POPUP: Erro ao parar timer", chrome.runtime.lastError?.message, response?.message);
             // Poderia reabilitar o botão aqui ou mostrar um erro
        }
        // loadTimers(); // Não precisa mais, espera a mensagem
    });
}

function handleClearTimer(e) {
    const issueKey = e.target.dataset.issuekey;
    e.target.disabled = true; // Desabilita botão temporariamente
    chrome.runtime.sendMessage({ action: 'clearTimerData', issueKey: issueKey }, (response) => {
        // A atualização da UI virá pela mensagem 'timersUpdated'
        if (chrome.runtime.lastError || !response || !response.success) {
             console.error("POPUP: Erro ao limpar timer", chrome.runtime.lastError?.message, response?.message);
        }
        // loadTimers(); // Não precisa mais, espera a mensagem
    });
}

function loadTimers() {
    chrome.runtime.sendMessage({ action: 'getAllTimers' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("POPUP: Erro ao carregar timers:", chrome.runtime.lastError.message);
            const timersList = document.getElementById('timers-list');
            const noTimersMessage = document.getElementById('no-timers-message');
            if(timersList) timersList.innerHTML = '';
            clearAllTimerIntervals(); // Limpa intervalos em caso de erro
            if(noTimersMessage) {
                noTimersMessage.textContent = "Erro ao carregar timers ativos.";
                noTimersMessage.style.display = 'block';
                if (timersList) timersList.style.display = 'none';
            }
            return;
        }
        if (response && response.timers) {
            renderTimers(response.timers);
        } else {
            // Resposta inválida, renderiza estado vazio
            renderTimers({});
        }
    });
}

// --- Lógica de Gerenciamento de Templates (sem alterações significativas) ---
function renderTemplates(templatesData) {
    const templatesListEl = document.getElementById('templates-list-popup');
    const noTemplatesMessageEl = document.getElementById('no-templates-message-tpl-popup');
    templatesListEl.innerHTML = '';
    const templateNames = Object.keys(templatesData);

    if (templateNames.length === 0) {
        if (noTemplatesMessageEl) noTemplatesMessageEl.style.display = 'block';
        templatesListEl.style.display = 'none';
        return;
    }
    if (noTemplatesMessageEl) noTemplatesMessageEl.style.display = 'none';
    templatesListEl.style.display = 'block';
    templateNames.sort((a, b) => a.localeCompare(b));
    templateNames.forEach(name => {
        const durationSeconds = templatesData[name];
        const listItem = document.createElement('li');
        listItem.className = 'template-item';
        listItem.dataset.name = name;
        listItem.innerHTML = `
            <div class="template-info">
                <span class="template-name-display">${name}</span>
                <span class="template-duration-display">(${formatDurationForDisplay(durationSeconds)})</span>
            </div>
            <div class="template-actions">
                <button class="action-button delete-template-button" data-name="${name}" title="Excluir este template">Excluir</button>
            </div>`;
        templatesListEl.appendChild(listItem);
    });
    // Reatribui listeners aos botões de deletar
    document.querySelectorAll('#templates-list-popup .delete-template-button').forEach(button => {
        button.removeEventListener('click', handleDeleteTemplate); // Remove antigo
        button.addEventListener('click', handleDeleteTemplate);
    });
}

function handleDeleteTemplate(e) {
    deleteTemplate(e.target.dataset.name);
}

function loadTemplates() {
    chrome.storage.local.get(TEMPLATE_STORAGE_KEY, (data) => {
        if (chrome.runtime.lastError) {
            console.error("POPUP: Erro ao carregar templates:", chrome.runtime.lastError.message);
            renderTemplates({});
            return;
        }
        renderTemplates(data[TEMPLATE_STORAGE_KEY] || {});
    });
}

function saveTemplate() {
    const nameInput = document.getElementById('template-name');
    const hoursInput = document.getElementById('template-hours');
    const minutesInput = document.getElementById('template-minutes');
    const secondsInput = document.getElementById('template-seconds');
    const name = nameInput.value.trim();
    const hours = parseInt(hoursInput.value, 10) || 0;
    const minutes = parseInt(minutesInput.value, 10) || 0;
    const seconds = parseInt(secondsInput.value, 10) || 0;

    if (!name) {
        alert("Por favor, insira um nome para o template.");
        nameInput.focus();
        return;
    }
    const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
    if (totalSeconds <= 0) {
        alert("A duração total do template deve ser maior que 0 segundos.");
        return;
    }
    chrome.storage.local.get(TEMPLATE_STORAGE_KEY, (data) => {
        if (chrome.runtime.lastError) {
            console.error("POPUP: Erro ao ler templates para salvar:", chrome.runtime.lastError.message);
            alert("Erro ao ler templates existentes.");
            return;
        }
        const templates = data[TEMPLATE_STORAGE_KEY] || {};
        templates[name] = totalSeconds;
        chrome.storage.local.set({ [TEMPLATE_STORAGE_KEY]: templates }, () => {
            if (chrome.runtime.lastError) {
                alert("Erro ao salvar o template.");
                console.error("POPUP: Erro ao salvar template:", chrome.runtime.lastError.message);
            } else {
                nameInput.value = '';
                hoursInput.value = '0';
                minutesInput.value = '0';
                secondsInput.value = '0';
                loadTemplates(); // Recarrega a lista após salvar
            }
        });
    });
}

function deleteTemplate(templateName) {
    if (!confirm(`Tem certeza que deseja excluir o template "${templateName}"?`)) {
        return;
    }
    chrome.storage.local.get(TEMPLATE_STORAGE_KEY, (data) => {
        if (chrome.runtime.lastError) {
            console.error("POPUP: Erro ao ler templates para deletar:", chrome.runtime.lastError.message);
            alert("Erro ao ler templates existentes.");
            return;
        }
        const templates = data[TEMPLATE_STORAGE_KEY] || {};
        if (templates[templateName]) {
            delete templates[templateName];
            chrome.storage.local.set({ [TEMPLATE_STORAGE_KEY]: templates }, () => {
                if (chrome.runtime.lastError) {
                    alert("Erro ao excluir o template.");
                    console.error("POPUP: Erro ao deletar template:", chrome.runtime.lastError.message);
                } else {
                    loadTemplates(); // Recarrega a lista após deletar
                }
            });
        }
    });
}

// --- Inicialização e Event Listeners Globais ---
document.addEventListener('DOMContentLoaded', () => {
    // Carrega o tema inicial
    chrome.storage.local.get(GLOBAL_THEME_STORAGE_KEY, (data) => {
        if (chrome.runtime.lastError) {
            console.warn("POPUP: Erro ao ler tema inicial:", chrome.runtime.lastError.message);
        }
        applyPopupCurrentTheme(data[GLOBAL_THEME_STORAGE_KEY] || 'light');
    });

    // Adiciona listeners aos botões principais
    document.getElementById('popup-theme-toggle').addEventListener('click', toggleAndStorePopupTheme);
    document.getElementById('go-to-templates-button').addEventListener('click', showTemplatesView);
    document.getElementById('back-to-timers-button').addEventListener('click', showTimersView);
    document.getElementById('refresh-button').addEventListener('click', loadTimers);
    document.getElementById('save-template-button').addEventListener('click', saveTemplate);

    // Mostra a view de timers por padrão e carrega os dados
    showTimersView();
});

// Listener para mensagens do background informando que os timers foram atualizados
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'timersUpdated') {
        // console.log("POPUP: Recebido 'timersUpdated', recarregando timers...");
        // Recarrega os timers apenas se a view de timers estiver ativa
        if (document.getElementById('timers-view').style.display === 'block') {
            loadTimers();
        }
        sendResponse({status: "Popup notificado"}); // Confirma recebimento
    }
    return true; // Indica resposta assíncrona (embora não usemos aqui)
});

// Listener para mudanças no storage (tema e templates)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        // Atualiza o tema se ele mudar
        if (changes[GLOBAL_THEME_STORAGE_KEY]) {
            applyPopupCurrentTheme(changes[GLOBAL_THEME_STORAGE_KEY].newValue || 'light');
        }
        // Atualiza a lista de templates se ela mudar E a view de templates estiver visível
        if (changes[TEMPLATE_STORAGE_KEY] && document.getElementById('templates-view').style.display === 'block') {
            loadTemplates();
        }
    }
});

// Limpa intervalos ao fechar o popup
window.addEventListener('unload', () => {
    clearAllTimerIntervals();
});

