// background/background.js
// Versão Refatorada: Otimização de notificação e consistência
'use strict';

const STORAGE_KEY_TIMERS = 'jiraActiveTimers';
const ALARM_NAME_PREFIX = 'jiraTimerAlarm_';

// --- Funções de Armazenamento (Storage) ---
async function getAllTimers() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_TIMERS);
        // Não há necessidade de verificar lastError aqui, o await já lançaria exceção
        return result[STORAGE_KEY_TIMERS] || {};
    } catch (e) {
        console.error("BG: Exceção ao buscar timers (getAllTimers):", e);
        return {};
    }
}

async function saveAllTimers(timers) {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY_TIMERS]: timers });
        // Não há necessidade de verificar lastError aqui
    } catch (e) {
        console.error("BG: Exceção ao salvar todos os timers:", e);
    }
    await updateBadge(); // Atualiza o badge após qualquer salvamento
}

async function getTimer(issueKey) {
    const timers = await getAllTimers();
    return timers[issueKey];
}

async function saveTimer(issueKey, timerData) {
    const timers = await getAllTimers();
    timers[issueKey] = timerData;
    await saveAllTimers(timers);
}

async function deleteTimer(issueKey) {
    const timers = await getAllTimers();
    const timerExisted = !!timers[issueKey];
    delete timers[issueKey];
    await saveAllTimers(timers);

    // Limpa o alarme associado apenas se o timer existia
    if (timerExisted && chrome.alarms) {
        try {
            await chrome.alarms.clear(ALARM_NAME_PREFIX + issueKey);
        } catch (e) {
            // Ignora erro se o alarme não existir mais
            if (e.message && !e.message.includes("No alarm with name")) {
                 console.warn(`BG: Exceção ao limpar alarme para ${issueKey} durante deleteTimer:`, e);
            }
        }
    }
    return timerExisted; // Retorna se o timer foi realmente deletado
}

// --- Atualização do Badge da Extensão ---
async function updateBadge() {
    if (!chrome.action) return; // Verifica se a API action está disponível
    try {
        const timers = await getAllTimers();
        let runningCount = 0;
        let expiredCount = 0;

        for (const key in timers) {
            if (timers[key].status === 'running') {
                runningCount++;
            } else if (timers[key].status === 'expired') {
                expiredCount++;
            }
        }

        let badgeText = '';
        let badgeColor = '#0052CC'; // Cor padrão (azul para running)

        if (expiredCount > 0) {
            badgeText = expiredCount.toString();
            badgeColor = '#DE350B'; // Vermelho para expired
        } else if (runningCount > 0) {
            badgeText = runningCount.toString();
            // badgeColor já é azul
        }

        await chrome.action.setBadgeText({ text: badgeText });
        // Define a cor apenas se houver texto (evita erro em alguns casos)
        if (badgeText) {
            await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
        }

    } catch (e) {
        console.error("BG: Exceção ao atualizar badge:", e);
    }
}

// --- Controle de Timers ---
async function startTimer(issueKey, issueTitle, cityName, durationSeconds, pageUrl, tabId) {
    if (durationSeconds <= 0) {
        console.warn(`BG: Tentativa de iniciar timer para ${issueKey} com duração inválida: ${durationSeconds}s`);
        return { success: false, message: 'Duração inválida.', timerData: null };
    }
    const now = Date.now();
    const endTime = now + durationSeconds * 1000;
    const timerData = {
        issueKey,
        issueTitle: issueTitle || 'Título Desconhecido',
        cityName: cityName || null,
        pageUrl,
        tabId, // Armazena o tabId original
        startTime: now,
        endTime,
        originalDurationSeconds: durationSeconds,
        status: 'running'
    };

    await saveTimer(issueKey, timerData);

    // Configura o alarme
    if (chrome.alarms) {
        try {
            // Limpa qualquer alarme anterior para esta issueKey antes de criar um novo
            await chrome.alarms.clear(ALARM_NAME_PREFIX + issueKey).catch(() => {}); // Ignora erro se não existir
            await chrome.alarms.create(ALARM_NAME_PREFIX + issueKey, { when: endTime });
        } catch (e) {
            console.error(`BG: Exceção ao criar/limpar alarme para ${issueKey}:`, e);
            // Considerar se deve reverter o saveTimer ou apenas logar
            // Por enquanto, apenas loga e continua
        }
    }

    notifyContentScript(issueKey, timerData); // Notifica a aba específica
    notifyPopupAboutChanges(); // Notifica o popup
    console.log(`BG: Timer iniciado para ${issueKey} (Tab: ${tabId}) com duração ${durationSeconds}s`);
    return { success: true, timerData: timerData, message: 'Timer iniciado com sucesso.' };
}

async function stopTimer(issueKey) {
    const timerData = await getTimer(issueKey);
    if (timerData && timerData.status !== 'stopped') { // Evita parar um timer já parado
        timerData.status = 'stopped';
        // Mantém endTime e originalDurationSeconds para referência
        await saveTimer(issueKey, timerData);

        // Limpa o alarme associado
        if (chrome.alarms) {
            try {
                await chrome.alarms.clear(ALARM_NAME_PREFIX + issueKey);
            } catch (e) {
                 if (e.message && !e.message.includes("No alarm with name")) {
                    console.warn(`BG: Exceção ao limpar alarme para ${issueKey} durante stopTimer:`, e);
                 }
            }
        }

        notifyContentScript(issueKey, timerData); // Notifica a aba específica
        notifyPopupAboutChanges(); // Notifica o popup
        console.log(`BG: Timer parado para ${issueKey}`);
        return { success: true, timerData: timerData, message: 'Timer parado com sucesso.' };
    } else if (timerData && timerData.status === 'stopped') {
        return { success: true, timerData: timerData, message: 'Timer já estava parado.' };
    } else {
        console.warn(`BG: Tentativa de parar timer não existente ou já parado: ${issueKey}`);
        return { success: false, message: 'Timer não encontrado ou já parado.', timerData: null };
    }
}

// --- Tratamento de Alarmes (Timer Expirado) ---
async function onAlarm(alarm) {
    if (!alarm.name.startsWith(ALARM_NAME_PREFIX)) return;

    const issueKey = alarm.name.substring(ALARM_NAME_PREFIX.length);
    const timerData = await getTimer(issueKey);

    // Verifica se o timer ainda existe, está 'running' e realmente expirou
    if (timerData && timerData.status === 'running' && timerData.endTime <= Date.now()) {
        timerData.status = 'expired';
        await saveTimer(issueKey, timerData);

        // Cria a notificação do sistema
        let notificationMessage = timerData.issueTitle && timerData.issueTitle !== 'Título Desconhecido' ?
            `Tempo para "${timerData.issueTitle}" (${issueKey})` :
            `Tempo para o ticket ${issueKey}`;
        if (timerData.cityName) {
            notificationMessage += ` [${timerData.cityName}]`;
        }
        notificationMessage += ` acabou!`;

        let iconUrl = '';
        try { iconUrl = chrome.runtime.getURL('icons/icon128.png'); } catch (e) {}

        const notificationOptions = {
            type: 'basic',
            title: 'Jira Timer: Tempo Esgotado!',
            message: notificationMessage,
            priority: 2,
            requireInteraction: false, // Não requer interação para fechar
        };
        if (iconUrl) notificationOptions.iconUrl = iconUrl;

        try {
            // Usa um ID único para evitar sobreposição se alarmes dispararem muito próximos
            const notificationId = `jiraTimerNotif_${issueKey}_${Date.now()}`;
            await chrome.notifications.create(notificationId, notificationOptions);
        } catch (e) {
            console.error(`BG: EXCEÇÃO ao criar notificação para ${issueKey}:`, e);
        }

        // Notifica o content script e o popup
        notifyContentScriptTimerExpired(issueKey, timerData);
        notifyPopupAboutChanges();
        console.log(`BG: Timer expirado e notificação enviada para ${issueKey}`);

    } else if (timerData && timerData.status !== 'running') {
        // Alarme disparou, mas o timer não está mais 'running' (foi parado ou já expirou antes)
        // Apenas garante que o alarme seja limpo (embora stopTimer/deleteTimer já façam isso)
        if (chrome.alarms) {
            await chrome.alarms.clear(alarm.name).catch(() => {});
        }
        await updateBadge(); // Garante que o badge esteja correto
    } else if (!timerData) {
        // Alarme disparou para um timer que não existe mais
        if (chrome.alarms) {
            await chrome.alarms.clear(alarm.name).catch(() => {});
        }
        await updateBadge();
    }
}

if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(onAlarm);
}

// --- Tratamento de Clique na Notificação ---
async function handleNotificationClick(notificationId) {
    if (!notificationId.startsWith('jiraTimerNotif_')) return;

    // Extrai issueKey do ID da notificação
    const issueKeyWithTimestamp = notificationId.substring('jiraTimerNotif_'.length);
    const issueKey = issueKeyWithTimestamp.split('_')[0];
    const timerData = await getTimer(issueKey);

    if (timerData && timerData.pageUrl) {
        try {
            let targetTabId = timerData.tabId; // Tenta usar o tabId original primeiro
            let tabFoundById = false;

            // Verifica se a aba original ainda existe e tem a URL esperada
            if (targetTabId) {
                try {
                    const tab = await chrome.tabs.get(targetTabId);
                    // Verifica se a URL da aba ainda corresponde (pode ter navegado para outro lugar)
                    if (tab && tab.url && (tab.url.includes(`/browse/${issueKey}`) || tab.url.includes(`/issues/${issueKey}`))) {
                        await chrome.tabs.update(tab.id, { active: true });
                        if (tab.windowId) {
                            await chrome.windows.update(tab.windowId, { focused: true });
                        }
                        tabFoundById = true;
                    } else {
                        targetTabId = null; // tabId original não é mais válido/relevante
                    }
                } catch (getTabError) {
                    targetTabId = null; // Aba não existe mais
                }
            }

            // Se não encontrou pela ID original, busca por URL
            if (!tabFoundById) {
                const tabs = await chrome.tabs.query({ url: timerData.pageUrl });
                if (tabs && tabs.length > 0) {
                    // Foca na primeira aba encontrada com a URL
                    await chrome.tabs.update(tabs[0].id, { active: true });
                    if (tabs[0].windowId) {
                        await chrome.windows.update(tabs[0].windowId, { focused: true });
                    }
                } else {
                    // Se nenhuma aba existe, cria uma nova
                    await chrome.tabs.create({ url: timerData.pageUrl, active: true });
                }
            }
        } catch (e) {
            console.error("BG: Exceção ao tentar focar/abrir aba para notificação:", e);
        }
    } else {
        console.warn("BG: Nenhum dado de timer ou URL encontrado para notificação (handleNotificationClick):", notificationId);
    }

    // Limpa a notificação após o clique
    try {
        await chrome.notifications.clear(notificationId);
    } catch (clearError) {
        console.error("BG: Exceção ao limpar notificação (handleNotificationClick):", clearError);
    }
}

if (chrome.notifications) {
    chrome.notifications.onClicked.addListener(handleNotificationClick);
}

// --- Comunicação com Content Scripts e Popup ---

// Otimizado: Tenta enviar para tabId primeiro, depois busca por URL se falhar ou não tiver tabId
async function sendMessageToContentScript(tabId, message) {
    try {
        await chrome.tabs.sendMessage(tabId, message);
        // console.log(`BG: Mensagem ${message.action} enviada com sucesso para Tab ${tabId}`);
        return true; // Sucesso
    } catch (e) {
        // Erro comum se a aba foi fechada, content script não injetado/pronto, ou ID inválido
        // console.warn(`BG: Falha ao enviar ${message.action} para Tab ${tabId}: ${e.message || 'Erro desconhecido'}.`);
        return false; // Falha
    }
}

async function notifyRelevantContentScripts(issueKey, message) {
    const timerData = await getTimer(issueKey);
    let notifiedSpecificTab = false;

    // 1. Tenta notificar a aba original (se tivermos o ID e dados do timer)
    if (timerData && timerData.tabId) {
        notifiedSpecificTab = await sendMessageToContentScript(timerData.tabId, message);
    }

    // 2. Se não notificou a aba específica (ou não tinha ID), busca por URL
    //    Isso cobre casos onde o timer foi iniciado em uma aba que foi fechada,
    //    ou se múltiplas abas do mesmo ticket estão abertas.
    if (!notifiedSpecificTab) {
        try {
            const tabs = await chrome.tabs.query({
                 url: [
                    `*://*.atlassian.net/browse/${issueKey}*`,
                    `*://*.atlassian.net/issues/${issueKey}*`
                 ]
             });
            tabs.forEach(tab => {
                // Evita reenviar para a aba original se já tentamos e falhamos
                if (tab.id && tab.id !== timerData?.tabId) {
                    sendMessageToContentScript(tab.id, message);
                }
            });
        } catch (e) {
            console.error(`BG: Erro ao consultar abas por URL para ${issueKey} (${message.action}):`, e);
        }
    }
}

// Função específica para notificar sobre atualização de estado (running, stopped, cleared)
function notifyContentScript(issueKey, timerData) {
    const message = {
        action: 'updateTimerDisplay',
        issueKey: issueKey,
        timerData: timerData // Pode ser null se o timer foi limpo
    };
    notifyRelevantContentScripts(issueKey, message);
}

// Função específica para notificar que o timer expirou (para UI do content script)
function notifyContentScriptTimerExpired(issueKey, timerData) {
    const message = {
        action: 'timerExpiredNotificationDone',
        issueKey: issueKey,
        timerData: timerData
    };
    notifyRelevantContentScripts(issueKey, message);
}

// Notifica o popup (se estiver aberto) que os timers mudaram
function notifyPopupAboutChanges() {
    chrome.runtime.sendMessage({ action: 'timersUpdated' }).catch(() => {}); // Ignora erro se o popup não estiver aberto
}

// --- Listener Principal de Mensagens ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            let result = { success: false, message: `Ação desconhecida: ${request.action}` };

            switch (request.action) {
                case 'startTimer':
                    const tabId = sender.tab ? sender.tab.id : null;
                    if (!tabId) {
                         console.warn("BG: startTimer recebido sem sender.tab.id");
                         // Poderia tentar buscar a aba ativa, mas por ora retorna erro
                         result = { success: false, message: 'Não foi possível identificar a aba de origem.' };
                         break;
                    }
                    result = await startTimer(
                        request.issueKey, request.issueTitle, request.cityName,
                        request.durationSeconds, request.pageUrl, tabId
                    );
                    break;
                case 'stopTimer':
                    result = await stopTimer(request.issueKey);
                    break;
                case 'getTimerState':
                    const timerData = await getTimer(request.issueKey);
                    result = { timerData: timerData, success: !!timerData };
                    break;
                case 'getAllTimers':
                    const timers = await getAllTimers();
                    result = { timers: timers, success: true };
                    break;
                case 'clearTimerData':
                    const timer = await getTimer(request.issueKey);
                    if (timer && (timer.status === 'expired' || timer.status === 'stopped')) {
                        await deleteTimer(request.issueKey);
                        result = { success: true, message: 'Timer data cleared', issueKey: request.issueKey };
                        // Notifica o content script que o timer foi removido (enviando null)
                        notifyContentScript(request.issueKey, null);
                        notifyPopupAboutChanges(); // Garante que o popup atualize
                    } else {
                        result = { success: false, message: 'Timer não encontrado ou não está em estado limpável', issueKey: request.issueKey };
                    }
                    break;
            }
            sendResponse(result);
        } catch (e) {
            console.error(`BG: Exceção no listener de mensagem para ação ${request.action}:`, e);
            // Garante que uma resposta seja enviada mesmo em caso de erro inesperado
            try {
                 sendResponse({ success: false, message: `Erro interno no background script: ${e.message}`});
            } catch (sendError) { /* Ignora erro ao enviar resposta de erro */ }
        }
    })();
    return true; // Indica que a resposta será assíncrona
});

// --- Inicialização ---
// Garante que o badge seja atualizado na inicialização do service worker
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);

console.log("BG: Service Worker Jira Timer iniciado.");
updateBadge(); // Atualiza o badge imediatamente ao iniciar

