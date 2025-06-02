// popup/popup.js
'use strict';

const GLOBAL_THEME_STORAGE_KEY = 'jiraGlobalTimerTheme';
const TEMPLATE_STORAGE_KEY = 'jiraTimerTemplates';

// --- Funções de formatação ---
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

// --- Controle de Tema ---
let intervalId = null;

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
    });
}

// --- Controle de Visualização ---
function showTimersView() {
    document.getElementById('timers-view').style.display = 'block';
    document.getElementById('templates-view').style.display = 'none';
}

function showTemplatesView() {
    document.getElementById('timers-view').style.display = 'none';
    document.getElementById('templates-view').style.display = 'block';
    loadTemplates(); 
}

// --- Lógica de Timers Ativos ---
function renderTimers(timersData) {
    const timersList = document.getElementById('timers-list');
    const noTimersMessage = document.getElementById('no-timers-message');
    timersList.innerHTML = '';

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
        const title = timer.issueTitle || 'Título Desconhecido';
        const truncatedTitle = title.length > 35 ? title.substring(0, 32) + '...' : title;
        
        // MODIFICADO: Adiciona o nome da cidade ao lado da issueKey
        let issueKeyDisplay = `<strong class="issue-key" title="${timer.issueKey}">${timer.issueKey}</strong>`;
        if (timer.cityName) {
            issueKeyDisplay += ` <span class="timer-city-name">(${timer.cityName})</span>`;
        }

        let timerDisplayHTML = '';
        if (timer.status === 'running' && timer.endTime) {
            const timeLeft = timer.endTime - Date.now();
            listItem.classList.toggle('running', timeLeft > 0);
            timerDisplayHTML = `<span>Tempo restante: ${formatTime(timeLeft)}</span>`;
        } else if (timer.status === 'expired' && timer.endTime) {
            listItem.classList.add('expired');
            const timeExceeded = Date.now() - timer.endTime;
            timerDisplayHTML = `<span class="expired-text">TEMPO ESGOTADO!</span>
                                <span class="exceeded-text">Excedido há: ${formatTime(timeExceeded)}</span>`;
        }
        listItem.innerHTML = `
            <div class="timer-info">
                <div class="timer-info-line1">${issueKeyDisplay}</div>
                <span class="issue-title" title="${title}">${truncatedTitle}</span>
                ${timerDisplayHTML}
            </div>
            <div class="timer-actions">
                <button class="action-button open-ticket" data-url="${timer.pageUrl}" title="Abrir ticket">Abrir</button>
                ${timer.status === 'running' ? `<button class="action-button stop-timer" data-issuekey="${timer.issueKey}" title="Parar timer">Parar</button>` : ''}
                ${(timer.status === 'expired' || timer.status === 'stopped') ? `<button class="action-button clear-timer" data-issuekey="${timer.issueKey}" title="Limpar da lista">Limpar</button>` : ''}
            </div>`;
        timersList.appendChild(listItem);
    });

    document.querySelectorAll('.open-ticket').forEach(button => {
        button.addEventListener('click', (e) => chrome.tabs.create({ url: e.target.dataset.url, active: true }));
    });
    document.querySelectorAll('.stop-timer').forEach(button => {
        button.addEventListener('click', (e) => chrome.runtime.sendMessage({ action: 'stopTimer', issueKey: e.target.dataset.issuekey }, loadTimers));
    });
    document.querySelectorAll('.clear-timer').forEach(button => {
        button.addEventListener('click', (e) => chrome.runtime.sendMessage({ action: 'clearTimerData', issueKey: e.target.dataset.issuekey }, loadTimers));
    });
}

function loadTimers() {
    chrome.runtime.sendMessage({ action: 'getAllTimers' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("POPUP: Erro ao carregar timers:", chrome.runtime.lastError.message);
            const timersList = document.getElementById('timers-list');
            const noTimersMessage = document.getElementById('no-timers-message');
            if(timersList) timersList.innerHTML = '';
            if(noTimersMessage) {
                noTimersMessage.textContent = "Erro ao carregar timers ativos.";
                noTimersMessage.style.display = 'block';
                if (timersList) timersList.style.display = 'none';
            }
            return;
        }
        if (response && response.timers) renderTimers(response.timers);
    });
}

// --- Lógica de Gerenciamento de Templates ---
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
    document.querySelectorAll('#templates-list-popup .delete-template-button').forEach(button => {
        button.addEventListener('click', (e) => deleteTemplate(e.target.dataset.name));
    });
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
                loadTemplates();
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
                    loadTemplates();
                }
            });
        }
    });
}

// --- Inicialização e Event Listeners Globais ---
document.addEventListener('DOMContentLoaded', () => {
    loadTimers();
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(loadTimers, 1000);

    chrome.storage.local.get(GLOBAL_THEME_STORAGE_KEY, (data) => {
        if (chrome.runtime.lastError) {
            console.warn("POPUP: Erro ao ler tema inicial:", chrome.runtime.lastError.message);
        }
        applyPopupCurrentTheme(data[GLOBAL_THEME_STORAGE_KEY] || 'light');
    });
    document.getElementById('popup-theme-toggle').addEventListener('click', toggleAndStorePopupTheme);

    document.getElementById('go-to-templates-button').addEventListener('click', showTemplatesView);
    document.getElementById('back-to-timers-button').addEventListener('click', showTimersView);
    document.getElementById('refresh-button').addEventListener('click', loadTimers);
    document.getElementById('save-template-button').addEventListener('click', saveTemplate);

    showTimersView();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'timersUpdated') {
        loadTimers();
        sendResponse({status: "Popup atualizado"});
    }
    return true;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes[GLOBAL_THEME_STORAGE_KEY]) {
            applyPopupCurrentTheme(changes[GLOBAL_THEME_STORAGE_KEY].newValue || 'light');
        }
        if (changes[TEMPLATE_STORAGE_KEY] && document.getElementById('templates-view').style.display === 'block') {
            loadTemplates();
        }
    }
});

window.addEventListener('unload', () => {
    if (intervalId) clearInterval(intervalId);
});