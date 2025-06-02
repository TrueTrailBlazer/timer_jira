// background/background.js
// Versão com log aprimorado em notifyContentScript
'use strict';

const STORAGE_KEY_TIMERS = 'jiraActiveTimers';
const ALARM_NAME_PREFIX = 'jiraTimerAlarm_';

// ... (restante do código de getAllTimers, saveAllTimers, getTimer, saveTimer, deleteTimer, updateBadge, startTimer, stopTimer, onAlarm, handleNotificationClick permanece o mesmo da última versão fornecida) ...
async function getAllTimers() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY_TIMERS);
        if (chrome.runtime.lastError) {
            console.error("BG: Erro ao buscar timers (getAllTimers):", chrome.runtime.lastError.message);
            return {};
        }
        return result[STORAGE_KEY_TIMERS] || {};
    } catch (e) { console.error("BG: Exceção ao buscar timers (getAllTimers):", e); return {}; }
}

async function saveAllTimers(timers) {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY_TIMERS]: timers });
        if (chrome.runtime.lastError) {
            console.error("BG: Erro ao salvar todos os timers:", chrome.runtime.lastError.message);
        }
    }
    catch (e) { console.error("BG: Exceção ao salvar todos os timers:", e); }
    await updateBadge();
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
    delete timers[issueKey];
    await saveAllTimers(timers); 
    try {
        if (chrome.alarms) {
            await chrome.alarms.clear(ALARM_NAME_PREFIX + issueKey);
            if (chrome.runtime.lastError) {
                console.warn(`BG: Erro ao limpar alarme para ${issueKey} durante deleteTimer:`, chrome.runtime.lastError.message);
            }
        }
    }
    catch (e) { console.warn(`BG: Exceção ao limpar alarme para ${issueKey} durante deleteTimer:`, e); }
}

async function updateBadge() {
    if (!chrome.action) return;
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

        if (runningCount > 0) {
            await chrome.action.setBadgeText({ text: runningCount.toString() });
            if (chrome.runtime.lastError) console.warn("BG: Erro ao setar badge text (running):", chrome.runtime.lastError.message);
            await chrome.action.setBadgeBackgroundColor({ color: '#0052CC' });
            if (chrome.runtime.lastError) console.warn("BG: Erro ao setar badge background (running):", chrome.runtime.lastError.message);
        } else if (expiredCount > 0) {
            await chrome.action.setBadgeText({ text: expiredCount.toString() });
            if (chrome.runtime.lastError) console.warn("BG: Erro ao setar badge text (expired):", chrome.runtime.lastError.message);
            await chrome.action.setBadgeBackgroundColor({ color: '#DE350B' });
            if (chrome.runtime.lastError) console.warn("BG: Erro ao setar badge background (expired):", chrome.runtime.lastError.message);
        } else {
            await chrome.action.setBadgeText({ text: '' });
            if (chrome.runtime.lastError) console.warn("BG: Erro ao limpar badge text:", chrome.runtime.lastError.message);
        }
    } catch (e) {
        console.error("BG: Exceção ao atualizar badge:", e.message, e);
    }
}

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
        tabId,
        startTime: now,
        endTime,
        originalDurationSeconds: durationSeconds,
        status: 'running'
    };

    await saveTimer(issueKey, timerData); 

    try {
        if (chrome.alarms) {
            await chrome.alarms.clear(ALARM_NAME_PREFIX + issueKey).catch(e => console.warn(`BG: Falha ao limpar alarme antigo para ${issueKey} (ignorado):`, e?.message));
            await chrome.alarms.create(ALARM_NAME_PREFIX + issueKey, { when: endTime });
            if (chrome.runtime.lastError) {
                console.error(`BG: Erro ao criar alarme para ${issueKey}:`, chrome.runtime.lastError.message);
            }
        }
    }
    catch (e) {
      console.error(`BG: Exceção ao criar alarme para ${issueKey}:`, e);
      return { success: false, message: 'Erro ao configurar alarme do timer.', timerData: timerData };
    }

    notifyContentScript(issueKey, timerData); 
    notifyPopupAboutChanges();
    console.log(`BG: Timer iniciado para ${issueKey} com duração ${durationSeconds}s`);
    return { success: true, timerData: timerData, message: 'Timer iniciado com sucesso.' };
}

async function stopTimer(issueKey) {
    const timerData = await getTimer(issueKey);
    if (timerData) {
        timerData.status = 'stopped';
        await saveTimer(issueKey, timerData); 

        try {
            if (chrome.alarms) {
                await chrome.alarms.clear(ALARM_NAME_PREFIX + issueKey);
                if (chrome.runtime.lastError) {
                    console.warn(`BG: Erro ao limpar alarme para ${issueKey} durante stopTimer:`, chrome.runtime.lastError.message);
                }
            }
        }
        catch (e) { console.warn(`BG: Exceção ao limpar alarme para ${issueKey} durante stopTimer:`, e); }

        notifyContentScript(issueKey, timerData); 
        notifyPopupAboutChanges();
        console.log(`BG: Timer parado para ${issueKey}`);
        return { success: true, timerData: timerData, message: 'Timer parado com sucesso.' };
    } else {
        console.warn(`BG: Tentativa de parar timer não existente: ${issueKey}`);
        return { success: false, message: 'Timer não encontrado.', timerData: null };
    }
}

if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        // ... (código da notificação com requireInteraction: false)
        if (chrome.runtime.lastError) {
            console.error("BG: Erro no listener onAlarm (antes de processar):", chrome.runtime.lastError.message);
            return;
        }
        if (!alarm.name.startsWith(ALARM_NAME_PREFIX)) return;

        const issueKey = alarm.name.substring(ALARM_NAME_PREFIX.length);
        const timerData = await getTimer(issueKey);

        if (timerData && timerData.status === 'running' && timerData.endTime <= Date.now()) {
            timerData.status = 'expired';
            await saveTimer(issueKey, timerData);

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
                requireInteraction: false, 
            };
            if (iconUrl) notificationOptions.iconUrl = iconUrl;

            try {
                const notificationId = `jiraTimerNotif_${issueKey}_${Date.now()}`; 
                await chrome.notifications.create(notificationId, notificationOptions);
                if (chrome.runtime.lastError) {
                     console.error(`BG: ERRO ao criar notificação para ${issueKey}:`, chrome.runtime.lastError.message);
                } 
            } catch (e) {
                console.error(`BG: EXCEÇÃO ao criar notificação para ${issueKey}:`, e.message, e);
            }

            notifyContentScriptTimerExpired(issueKey, timerData);
            notifyPopupAboutChanges();
        } else if (timerData && timerData.status !== 'running') {
            if (chrome.alarms) {
                await chrome.alarms.clear(alarm.name).catch(e => console.warn(`BG: Falha ao limpar alarme ${alarm.name} (timer não rodando):`, e?.message));
            }
            await updateBadge();
        } else if (!timerData) {
            if (chrome.alarms) {
                 await chrome.alarms.clear(alarm.name).catch(e => console.warn(`BG: Falha ao limpar alarme ${alarm.name} (timer não existe):`, e?.message));
            }
            await updateBadge();
        }
    });
}

async function handleNotificationClick(notificationId) {
    // ... (código existente)
    if (!notificationId.startsWith('jiraTimerNotif_')) return;
    const issueKeyWithTimestamp = notificationId.substring('jiraTimerNotif_'.length);
    const issueKey = issueKeyWithTimestamp.split('_')[0]; 
    const timerData = await getTimer(issueKey);

    if (timerData && timerData.pageUrl) {
        try {
            const tabs = await chrome.tabs.query({ url: timerData.pageUrl });
            if (chrome.runtime.lastError) {
                console.warn("BG: Erro ao consultar abas em handleNotificationClick:", chrome.runtime.lastError.message);
            }

            if (tabs && tabs.length > 0) {
                await chrome.tabs.update(tabs[0].id, { active: true });
                 if (chrome.runtime.lastError) console.warn("BG: Erro ao atualizar aba em handleNotificationClick:", chrome.runtime.lastError.message);
                if (tabs[0].windowId) {
                    await chrome.windows.update(tabs[0].windowId, { focused: true });
                    if (chrome.runtime.lastError) console.warn("BG: Erro ao focar janela em handleNotificationClick:", chrome.runtime.lastError.message);
                }
            } else {
                await chrome.tabs.create({ url: timerData.pageUrl, active: true });
                if (chrome.runtime.lastError) console.warn("BG: Erro ao criar nova aba em handleNotificationClick:", chrome.runtime.lastError.message);
            }
        } catch (e) {
            console.error("BG: Exceção ao tentar focar/abrir aba para notificação:", e);
        }
    } else {
        console.warn("BG: Nenhum dado de timer ou URL encontrado para notificação (handleNotificationClick):", notificationId);
    }

    try {
        await chrome.notifications.clear(notificationId);
        if (chrome.runtime.lastError) {
            console.warn("BG: Erro ao limpar notificação (handleNotificationClick):", chrome.runtime.lastError.message);
        }
    }
    catch (clearError) { console.error("BG: Exceção ao limpar notificação (handleNotificationClick):", clearError); }
}

if (chrome.notifications) {
    chrome.notifications.onClicked.addListener(handleNotificationClick);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            if (request.action === 'startTimer') {
                const tabId = sender.tab ? sender.tab.id : null;
                const result = await startTimer(
                    request.issueKey, request.issueTitle, request.cityName,
                    request.durationSeconds, request.pageUrl, tabId
                );
                sendResponse(result);
            } else if (request.action === 'stopTimer') {
                const result = await stopTimer(request.issueKey);
                sendResponse(result);
            } else if (request.action === 'getTimerState') {
                const timerData = await getTimer(request.issueKey);
                sendResponse({ timerData: timerData, success: !!timerData }); 
            } else if (request.action === 'getAllTimers') {
                const timers = await getAllTimers();
                sendResponse({ timers: timers, success: true });
            } else if (request.action === 'clearTimerData') {
                const timer = await getTimer(request.issueKey);
                if (timer && (timer.status === 'expired' || timer.status === 'stopped')) {
                    await deleteTimer(request.issueKey); 
                    sendResponse({ success: true, message: 'Timer data cleared', issueKey: request.issueKey });
                    // A notificação crucial para o content script resetar a UI:
                    console.log(`BG: Enviando notifyContentScript para ${request.issueKey} com timerData: null após clearTimerData`);
                    notifyContentScript(request.issueKey, null); 
                } else {
                    sendResponse({ success: false, message: 'Timer not found or not in a clearable state', issueKey: request.issueKey });
                }
            } else {
                sendResponse({ success: false, message: `Ação desconhecida: ${request.action}` });
            }
        } catch (e) {
            console.error(`BG: Exceção no listener de mensagem para ação ${request.action}:`, e);
            sendResponse({ success: false, message: `Erro interno no background script: ${e.message}`});
        }
    })();
    return true; 
});

async function notifyContentScript(issueKey, timerData) {
    try {
        const tabs = await chrome.tabs.query({}); // Query all tabs
        if (chrome.runtime.lastError) {
            console.warn(`BG: Erro ao consultar abas (notifyContentScript para ${issueKey}):`, chrome.runtime.lastError.message);
            return;
        }
        // console.log(`BG: Tentando notificar content scripts para ${issueKey} com timerData:`, timerData);
        tabs.forEach(tab => {
            if (tab.id && tab.url && (tab.url.includes(`/browse/${issueKey}`) || tab.url.includes(`/issues/${issueKey}`))) {
                // console.log(`BG: Enviando 'updateTimerDisplay' para aba ${tab.id} (URL: ${tab.url}) para issue ${issueKey}`);
                chrome.tabs.sendMessage(tab.id, {
                    action: 'updateTimerDisplay', 
                    issueKey: issueKey, 
                    timerData: timerData // Será null quando um timer for limpo
                }).catch(e => {
                    // Este erro é comum se a aba foi fechada ou o content script não está pronto.
                    console.warn(`BG: Falha ao enviar 'updateTimerDisplay' para aba ${tab.id} (issue ${issueKey}): ${e.message ? e.message : 'Erro desconhecido'}. A aba pode estar fechada ou o script não carregado.`);
                });
            }
        });
    } catch (e) { console.error(`BG: Exceção ao notificar content script (issue ${issueKey}):`, e); }
}

async function notifyContentScriptTimerExpired(issueKey, timerData) {
     try {
        const tabs = await chrome.tabs.query({});
        if (chrome.runtime.lastError) {
            console.warn(`BG: Erro ao consultar abas (notifyContentScriptTimerExpired para ${issueKey}):`, chrome.runtime.lastError.message);
            return;
        }
        tabs.forEach(tab => {
            if (tab.id && tab.url && (tab.url.includes(`/browse/${issueKey}`) || tab.url.includes(`/issues/${issueKey}`))) {
                // console.log(`BG: Enviando 'timerExpiredNotificationDone' para aba ${tab.id} para issue ${issueKey}`);
                chrome.tabs.sendMessage(tab.id, {
                    action: 'timerExpiredNotificationDone', 
                    issueKey: issueKey, 
                    timerData: timerData
                }).catch(e => {
                    console.warn(`BG: Falha ao enviar 'timerExpiredNotificationDone' para aba ${tab.id} (issue ${issueKey}): ${e.message ? e.message : 'Erro desconhecido'}.`);
                });
            }
        });
    } catch (e) { console.error(`BG: Exceção ao notificar content script sobre expiração (issue ${issueKey}):`, e); }
}

async function notifyPopupAboutChanges() {
    try {
        await chrome.runtime.sendMessage({ action: 'timersUpdated' });
        if (chrome.runtime.lastError) {
            // console.log("BG: Falha ao notificar popup (popup fechado?):", chrome.runtime.lastError.message);
        }
    }
    catch(e) { /* Ignora erro */ }
}

async function revalidateAlarmsAndBadge() {
    // ... (código existente, já robusto)
    if (!chrome.alarms) {
        console.warn("BG: API chrome.alarms não disponível durante revalidação.");
        await updateBadge();
        return;
    }
    try {
        const allAlarms = await chrome.alarms.getAll();
        if (chrome.runtime.lastError) {
            console.error("BG: Erro ao buscar todos os alarmes (revalidate):", chrome.runtime.lastError.message);
            await updateBadge(); return;
        }
        let activeTimers = await getAllTimers();
        let changedStatesInRevalidation = false;
        const activeTimerKeysFromStorage = new Set(Object.keys(activeTimers));
        const alarmsToClear = [];
        const alarmsToRecreateMap = new Map(); 
        for (const alarm of allAlarms) {
            if (alarm.name.startsWith(ALARM_NAME_PREFIX)) {
                const issueKey = alarm.name.substring(ALARM_NAME_PREFIX.length);
                const timer = activeTimers[issueKey];
                if (!timer || timer.status !== 'running') {
                    alarmsToClear.push(alarm.name);
                } else if (timer.endTime <= Date.now()) {
                    if (timer.status !== 'expired') { 
                        timer.status = 'expired';
                        changedStatesInRevalidation = true;
                    }
                    alarmsToClear.push(alarm.name); 
                } else if (Math.abs(alarm.scheduledTime - timer.endTime) > 5000) { 
                    alarmsToClear.push(alarm.name);
                    alarmsToRecreateMap.set(issueKey, timer.endTime);
                }
                activeTimerKeysFromStorage.delete(issueKey); 
            }
        }
        activeTimerKeysFromStorage.forEach(issueKey => {
            const timer = activeTimers[issueKey];
            if (timer && timer.status === 'running' && timer.endTime > Date.now()) {
                alarmsToRecreateMap.set(issueKey, timer.endTime); 
            }
        });
        for (const alarmName of alarmsToClear) {
            await chrome.alarms.clear(alarmName).catch(e => console.warn(`BG Reval: Falha ao limpar alarme ${alarmName}:`, e?.message));
        }
        for (const [issueKey, endTime] of alarmsToRecreateMap) {
            await chrome.alarms.create(ALARM_NAME_PREFIX + issueKey, { when: endTime })
                .catch(e => console.error(`BG Reval: Falha ao recriar alarme para ${issueKey}:`, e?.message));
        }
        if (changedStatesInRevalidation) {
            await saveAllTimers(activeTimers); 
            notifyPopupAboutChanges(); 
        } else {
            await updateBadge(); 
        }
    } catch (error) {
        console.error("BG: Exceção durante revalidateAlarmsAndBadge:", error);
        await updateBadge().catch(()=>{}); 
    }
}

if (chrome.runtime) {
    chrome.runtime.onStartup.addListener(() => {
        setTimeout(revalidateAlarmsAndBadge, 2000); 
    });
    chrome.runtime.onInstalled.addListener(details => {
        setTimeout(revalidateAlarmsAndBadge, 2000);
    });
}

setTimeout(revalidateAlarmsAndBadge, 2500);