/*
 * SPDX-License-Identifier: MIT
 * WriterDrip source attribution
 * Copyright (c) 2026 WriterDrip contributors
 * If you reuse substantial parts of this project, please keep credit to:
 * https://github.com/Highdrys01/WriterDrip
 */

importScripts('shared.js');

const Shared = globalThis.WriterDripShared;
if (!Shared) {
    throw new Error('[WriterDrip] shared.js did not load in the background worker.');
}

const {
    MIN_DURATION_MINS,
    MAX_DURATION_MINS,
    normalizeCorrectionIntensity,
    sanitizeDraftText,
    getMinimumDurationMins,
    normalizeDurationMins,
    normalizeDailySchedule,
    getDailyScheduleStatus
} = Shared;

const SESSIONS_KEY = 'writerdripTabSessions';
const HEALTH_ALARM = 'writerdrip-health';
const SESSION_STATES = {
    IDLE: 'idle',
    STARTING: 'starting',
    RUNNING: 'running',
    PAUSED: 'paused',
    ATTENTION: 'attention',
    COMPLETE: 'complete'
};
const AUTO_RECOVERY_STATES = new Set([
    SESSION_STATES.STARTING,
    SESSION_STATES.RUNNING
]);
const AUTO_SCHEDULE_RECOVERY_STATES = new Set([
    SESSION_STATES.PAUSED,
    SESSION_STATES.STARTING,
    SESSION_STATES.RUNNING
]);
const ISSUE_CODES = {
    ACTIVE_RUN_EXISTS: 'active-run-exists',
    BACKGROUND_UNAVAILABLE: 'background-unavailable',
    EDITOR_AUTO_EDIT: 'editor-auto-edit',
    EDITOR_FOCUS_FAILED: 'editor-focus-failed',
    EDITOR_NOT_READY: 'editor-not-ready',
    INVALID_JOB: 'invalid-job',
    MANUAL_INTERACTION: 'manual-interaction',
    NO_ACTIVE_RUN: 'no-active-run',
    NO_ACTIVE_TAB: 'no-active-tab',
    PAGE_CHANGED: 'page-changed',
    RUNTIME_ERROR: 'runtime-error',
    TAB_SUSPENDED: 'tab-suspended',
    TYPING_CONTEXT_LOST: 'typing-context-lost',
    UNKNOWN_COMMAND: 'unknown-command',
    UNSUPPORTED_PAGE: 'unsupported-page',
    WRONG_DOC: 'wrong-doc'
};
const SAFE_ATTENTION_RESUME_CODES = new Set([
    ISSUE_CODES.EDITOR_NOT_READY,
    ISSUE_CODES.EDITOR_FOCUS_FAILED,
    ISSUE_CODES.TAB_SUSPENDED
]);

initialize().catch((error) => {
    console.error('[WriterDrip] Failed to initialize background worker.', error);
});

chrome.runtime.onInstalled.addListener(() => {
    initialize().catch((error) => {
        console.error('[WriterDrip] Install initialization failed.', error);
    });
});

chrome.runtime.onStartup.addListener(() => {
    initialize().catch((error) => {
        console.error('[WriterDrip] Startup initialization failed.', error);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.namespace !== 'writerdrip') {
        return false;
    }

    handleMessage(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => {
            console.error('[WriterDrip] Message handling failed.', error);
            sendResponse(buildErrorResponse(error.code || ISSUE_CODES.RUNTIME_ERROR, error.message || 'Unknown background error.'));
        });

    return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== HEALTH_ALARM) {
        return;
    }

    recoverActiveSessions().catch((error) => {
        console.error('[WriterDrip] Health alarm recovery failed.', error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void withSessionLock(async () => {
        const sessions = await readSessions();
        const session = sessions[String(tabId)];
        if (!session) {
            return;
        }

        if (!markSessionAwaitingTabReopen(session)) {
            delete sessions[String(tabId)];
        }

        await writeSessions(sessions);
    }).then(() => syncHealthAlarm()).catch((error) => {
        console.error('[WriterDrip] Failed to remove closed tab session.', error);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') {
        return;
    }

    recoverSessionForTab(tabId, { manual: false, url: tab?.url || changeInfo.url || '' }).catch((error) => {
        console.error('[WriterDrip] Failed to recover session after tab update.', error);
    });
});

let sessionLock = Promise.resolve();
const indicatorCache = new Map();
const discardProtectionCache = new Map();

async function initialize() {
    try {
        await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch (error) {
        console.warn('[WriterDrip] Could not restrict storage access level.', error);
    }

    const sessions = await readSessions();
    await syncHealthAlarm();
    await safeSyncActionIndicators(sessions);
    await safeSyncDiscardProtection(sessions);
}

function withSessionLock(task) {
    const nextTask = sessionLock.then(task, task);
    sessionLock = nextTask.catch(() => { });
    return nextTask;
}

async function handleMessage(message, sender) {
    switch (message.command) {
        case 'ui:get-state':
            return {
                ok: true,
                state: await getUiState(message.tabId, message.url || '')
            };
        case 'ui:preflight':
            return {
                ok: true,
                report: await handleUiPreflight(message.tabId, message.url || '', message.expectedDocKey || null)
            };
        case 'run:start':
            return handleRunStart(message.tabId, message.url || '', message.job);
        case 'runner:pause-toggle':
            return handlePauseToggle(message.tabId);
        case 'runner:stop':
            return handleStopCurrent(message.tabId);
        case 'runner:progress':
            return handleRunnerProgress(sender.tab?.id, message.payload);
        case 'runner:completed':
            return handleRunnerCompleted(sender.tab?.id, message.payload);
        case 'runner:error':
            return handleRunnerError(sender.tab?.id, message.payload);
        default:
            return buildErrorResponse(ISSUE_CODES.UNKNOWN_COMMAND, `Unknown command: ${message.command}`);
    }
}

async function handleRunStart(tabId, url, rawJob) {
    if (!tabId) {
        return buildErrorResponse(ISSUE_CODES.NO_ACTIVE_TAB, 'No active tab selected.');
    }

    const minimumDurationMins = getMinimumDurationMins(rawJob?.text);
    const job = createJob(rawJob);
    if (!job) {
        return buildErrorResponse(ISSUE_CODES.INVALID_JOB, `Enter text and choose a duration between ${formatDurationMins(minimumDurationMins)} and ${formatDurationMins(MAX_DURATION_MINS)}.`);
    }

    const scheduleStatus = getScheduleStatusForJob(job);
    if (scheduleStatus.enabled && !scheduleStatus.active) {
        let scheduledRunId = null;
        await withSessionLock(async () => {
            const sessions = await readSessions();
            const session = getSessionForTab(sessions, tabId);
            session.lastKnownUrl = url || session.lastKnownUrl || '';

            if (session.activeJob || session.activeRunId) {
                return;
            }

            session.activeJob = job;
            session.activeRunId = createId('run');
            scheduledRunId = session.activeRunId;
            session.state = SESSION_STATES.PAUSED;
            session.pauseMode = 'schedule';
            session.progress = 0;
            session.eta = durationToClock(job.durationMins * 60);
            session.checkpointActionIndex = 0;
            session.totalActions = 0;
            session.lastHeartbeatAt = 0;
            session.updatedAt = Date.now();
            session.lastError = null;
            session.lastErrorCode = null;
            session.attentionMessage = null;
            session.attentionCode = null;
            session.lastCompletedJob = null;
            session.lastCompletedVerification = null;
            session.scheduleNextStartAt = scheduleStatus.nextStartAt || null;
            await writeSessions(sessions);
        });

        if (!scheduledRunId) {
            return buildErrorResponse(ISSUE_CODES.ACTIVE_RUN_EXISTS, 'A drip is already active in this tab. Pause or stop it first.');
        }

        await syncHealthAlarm();
        return {
            ok: true,
            state: await getUiState(tabId, url)
        };
    }

    const preflightReport = await runPreflightCheck(tabId, job.docKey);
    if (!preflightReport.ready) {
        return buildErrorResponse(preflightReport.code || ISSUE_CODES.EDITOR_NOT_READY, preflightReport.message || 'Open the Google Doc, click inside the editor, and try again.');
    }

    let runPayload = null;

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const session = getSessionForTab(sessions, tabId);
        session.lastKnownUrl = url || session.lastKnownUrl || '';

        if (session.activeJob || session.activeRunId) {
            return;
        }

        session.activeJob = job;
        session.activeRunId = createId('run');
        session.state = SESSION_STATES.STARTING;
        session.pauseMode = null;
        session.progress = 0;
        session.eta = durationToClock(job.durationMins * 60);
        session.checkpointActionIndex = 0;
        session.totalActions = 0;
        session.lastHeartbeatAt = Date.now();
        session.updatedAt = Date.now();
        session.lastError = null;
        session.lastErrorCode = null;
        session.attentionMessage = null;
        session.attentionCode = null;
        session.lastCompletedJob = null;
        session.lastCompletedVerification = null;
        session.scheduleNextStartAt = null;
        runPayload = {
            runId: session.activeRunId,
            job
        };

        await writeSessions(sessions);
    });

    if (!runPayload) {
        return buildErrorResponse(ISSUE_CODES.ACTIVE_RUN_EXISTS, 'A drip is already active in this tab. Pause or stop it first.');
    }

    try {
        const response = await restoreOrStartRun(tabId, {
            runId: runPayload.runId,
            job: runPayload.job,
            checkpointActionIndex: 0
        });

        await withSessionLock(async () => {
            const sessions = await readSessions();
            const session = getSessionForTab(sessions, tabId);
            if (session.activeRunId !== runPayload.runId) {
                return;
            }

            applyRuntimeSnapshotToSession(session, response.runtime);
            await writeSessions(sessions);
        });
    } catch (error) {
        await withSessionLock(async () => {
            const sessions = await readSessions();
            const session = getSessionForTab(sessions, tabId);
            if (session.activeRunId !== runPayload.runId) {
                return;
            }

            session.state = SESSION_STATES.ATTENTION;
            session.lastError = error.message || 'Could not attach to the current Google Doc.';
            session.lastErrorCode = error.code || ISSUE_CODES.EDITOR_NOT_READY;
            session.attentionCode = error.code || ISSUE_CODES.EDITOR_NOT_READY;
            session.attentionMessage = getRecoveryHint(error.code || ISSUE_CODES.EDITOR_NOT_READY, 'Click inside the Google Doc and press Resume.');
            session.updatedAt = Date.now();
            await writeSessions(sessions);
        });
    }

    await syncHealthAlarm();
    return {
        ok: true,
        state: await getUiState(tabId, url)
    };
}

async function handlePauseToggle(tabId) {
    if (!tabId) {
        return buildErrorResponse(ISSUE_CODES.NO_ACTIVE_TAB, 'No active tab selected.');
    }

    const session = await getSessionSnapshot(tabId);
    if (!session.activeJob || !session.activeRunId) {
        return buildErrorResponse(ISSUE_CODES.NO_ACTIVE_RUN, 'Nothing is currently running in this tab.');
    }

    if (session.state === SESSION_STATES.ATTENTION || session.state === SESSION_STATES.STARTING) {
        if (!canResumeAttentionState(session.attentionCode)) {
            return buildErrorResponse(
                session.attentionCode || ISSUE_CODES.RUNTIME_ERROR,
                buildRestartRequiredMessage(session.attentionCode)
            );
        }

        await recoverSessionForTab(tabId, { manual: true });
        return {
            ok: true,
            state: await getUiState(tabId)
        };
    }

    if (session.state === SESSION_STATES.PAUSED) {
        const scheduleStatus = getScheduleStatusForJob(session.activeJob);
        if (session.pauseMode === 'schedule' && scheduleStatus.enabled && !scheduleStatus.active) {
            return {
                ok: true,
                state: await getUiState(tabId)
            };
        }

        try {
            const response = await sendRunnerCommand(tabId, { type: 'writerdrip:resume-job', runId: session.activeRunId });
            await withSessionLock(async () => {
                const sessions = await readSessions();
                const nextSession = getSessionForTab(sessions, tabId);
                if (nextSession.activeRunId !== session.activeRunId) {
                    return;
                }

                nextSession.state = response.runtime?.state || SESSION_STATES.RUNNING;
                nextSession.pauseMode = null;
                nextSession.lastError = null;
                nextSession.lastErrorCode = null;
                nextSession.attentionMessage = null;
                nextSession.attentionCode = null;
                nextSession.lastHeartbeatAt = Date.now();
                nextSession.scheduleNextStartAt = 0;
                nextSession.updatedAt = Date.now();
                await writeSessions(sessions);
            });

            await syncHealthAlarm();
            return {
                ok: true,
                state: await getUiState(tabId)
            };
        } catch (error) {
            await recoverSessionForTab(tabId, { manual: true });
            return {
                ok: true,
                state: await getUiState(tabId)
            };
        }
    }

    const response = await sendRunnerCommand(tabId, { type: 'writerdrip:pause-job', runId: session.activeRunId });

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const nextSession = getSessionForTab(sessions, tabId);
        if (nextSession.activeRunId !== session.activeRunId) {
            return;
        }

        nextSession.state = response.runtime?.state || SESSION_STATES.PAUSED;
        nextSession.pauseMode = 'manual';
        nextSession.lastError = null;
        nextSession.lastErrorCode = null;
        nextSession.attentionMessage = null;
        nextSession.attentionCode = null;
        nextSession.lastHeartbeatAt = Date.now();
        nextSession.scheduleNextStartAt = 0;
        nextSession.updatedAt = Date.now();
        await writeSessions(sessions);
    });

    await syncHealthAlarm();
    return {
        ok: true,
        state: await getUiState(tabId)
    };
}

async function handleStopCurrent(tabId) {
    if (!tabId) {
        return buildErrorResponse(ISSUE_CODES.NO_ACTIVE_TAB, 'No active tab selected.');
    }

    const session = await getSessionSnapshot(tabId);
    if (session.activeJob && session.activeRunId) {
        try {
            await sendRunnerCommand(tabId, { type: 'writerdrip:stop-job', runId: session.activeRunId });
        } catch (error) {
            if (!canClearAfterStopFailure(error?.code)) {
                console.warn('[WriterDrip] Stop command could not be confirmed.', error);
                await withSessionLock(async () => {
                    const sessions = await readSessions();
                    const nextSession = getSessionForTab(sessions, tabId);
                    if (nextSession.activeRunId !== session.activeRunId) {
                        return;
                    }

                    nextSession.state = SESSION_STATES.ATTENTION;
                    nextSession.lastErrorCode = error?.code || ISSUE_CODES.RUNTIME_ERROR;
                    nextSession.lastError = error?.message || 'WriterDrip could not confirm that the active drip stopped.';
                    nextSession.attentionCode = error?.code || ISSUE_CODES.RUNTIME_ERROR;
                    nextSession.attentionMessage = 'WriterDrip could not confirm the drip stopped. Keep the Google Doc tab open and try Stop again.';
                    nextSession.updatedAt = Date.now();
                    await writeSessions(sessions);
                });

                await syncHealthAlarm();
                return {
                    ok: true,
                    state: await getUiState(tabId)
                };
            }
        }
    }

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const nextSession = getSessionForTab(sessions, tabId);
        resetActiveRun(nextSession, SESSION_STATES.IDLE);
        await writeSessions(sessions);
    });

    await syncHealthAlarm();
    return {
        ok: true,
        state: await getUiState(tabId)
    };
}

async function handleRunnerProgress(tabId, payload) {
    if (!tabId || !payload?.runId) {
        return buildErrorResponse(ISSUE_CODES.RUNTIME_ERROR, 'Invalid progress payload.');
    }

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const session = getSessionForTab(sessions, tabId);
        if (session.activeRunId !== payload.runId) {
            return;
        }

        session.state = payload.state || session.state || SESSION_STATES.RUNNING;
        session.pauseMode = null;
        session.progress = clampNumber(payload.percent, 0, 1, session.progress);
        session.eta = payload.eta || session.eta;
        session.checkpointActionIndex = Math.max(0, payload.actionIndex || 0);
        session.totalActions = Math.max(0, payload.totalActions || session.totalActions || 0);
        session.lastHeartbeatAt = Date.now();
        session.scheduleNextStartAt = 0;
        session.updatedAt = Date.now();
        session.lastError = null;
        session.lastErrorCode = null;
        session.attentionMessage = null;
        session.attentionCode = null;
        await writeSessions(sessions);
    });

    return { ok: true };
}

async function handleRunnerCompleted(tabId, payload) {
    if (!tabId || !payload?.runId) {
        return buildErrorResponse(ISSUE_CODES.RUNTIME_ERROR, 'Invalid completion payload.');
    }

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const session = getSessionForTab(sessions, tabId);
        if (session.activeRunId !== payload.runId) {
            return;
        }

        session.lastCompletedJob = summarizeJob(session.activeJob);
        session.lastCompletedVerification = normalizeCompletionVerification(payload.verification);
        resetActiveRun(session, SESSION_STATES.COMPLETE);
        session.progress = 1;
        session.eta = '00:00';
        session.updatedAt = Date.now();
        await writeSessions(sessions);
    });

    await syncHealthAlarm();
    return { ok: true };
}

async function handleRunnerError(tabId, payload) {
    if (!tabId || !payload?.runId) {
        return buildErrorResponse(ISSUE_CODES.RUNTIME_ERROR, 'Invalid runner error payload.');
    }

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const session = getSessionForTab(sessions, tabId);
        if (session.activeRunId !== payload.runId) {
            return;
        }

        session.state = SESSION_STATES.ATTENTION;
        session.lastError = payload.message || 'The runner lost access to the editor.';
        session.lastErrorCode = payload.code || inferIssueCode(payload.message);
        session.attentionCode = payload.code || inferIssueCode(payload.message);
        session.attentionMessage = getRecoveryHint(payload.code || inferIssueCode(payload.message), payload.message || 'Click inside the editor and resume the active drip.');
        session.lastHeartbeatAt = Date.now();
        session.pauseMode = null;
        session.scheduleNextStartAt = 0;
        session.updatedAt = Date.now();
        await writeSessions(sessions);
    });

    await syncHealthAlarm();
    return { ok: true };
}

async function recoverActiveSessions() {
    const sessions = await readSessions();
    const activeTabIds = Object.keys(sessions)
        .map((tabId) => Number.parseInt(tabId, 10))
        .filter((tabId) => Number.isFinite(tabId))
        .filter((tabId) => {
            const session = sessions[String(tabId)];
            return Boolean(session?.activeJob && session?.activeRunId);
        });

    for (const tabId of activeTabIds) {
        await recoverSessionForTab(tabId, { manual: false });
    }

    await syncHealthAlarm();
}

async function recoverSessionForTab(tabId, options = {}) {
    if (options.url) {
        await withSessionLock(async () => {
            const sessions = await readSessions();
            const adopted = await adoptMatchingSessionForTab(tabId, options.url, sessions);
            if (adopted) {
                await writeSessions(sessions);
            }
        });
    }

    const session = await getSessionSnapshot(tabId);
    if (!session.activeJob || !session.activeRunId) {
        await syncHealthAlarm();
        return;
    }

    if (!options.manual && !await doesTabExist(tabId)) {
        await syncHealthAlarm();
        return;
    }

    const scheduleStatus = getScheduleStatusForJob(session.activeJob);
    if (scheduleStatus.enabled && !scheduleStatus.active) {
        await pauseSessionForSchedule(tabId, session, scheduleStatus);
        await syncHealthAlarm();
        return;
    }

    if (!options.manual && !canAutoRecoverSession(session)) {
        await syncHealthAlarm();
        return;
    }

    try {
        const response = await restoreOrStartRun(tabId, {
            runId: session.activeRunId,
            job: session.activeJob,
            checkpointActionIndex: session.checkpointActionIndex || 0
        });

        await withSessionLock(async () => {
            const sessions = await readSessions();
            const nextSession = getSessionForTab(sessions, tabId);
            if (nextSession.activeRunId !== session.activeRunId) {
                return;
            }

            applyRuntimeSnapshotToSession(nextSession, response.runtime, {
                preserveCheckpointFloor: true
            });
            nextSession.pauseMode = null;
            nextSession.scheduleNextStartAt = 0;
            await writeSessions(sessions);
        });
    } catch (error) {
        await withSessionLock(async () => {
            const sessions = await readSessions();
            const nextSession = getSessionForTab(sessions, tabId);
            if (nextSession.activeRunId !== session.activeRunId) {
                return;
            }

            nextSession.state = SESSION_STATES.ATTENTION;
            nextSession.lastError = error.message || 'The runner needs your attention.';
            nextSession.lastErrorCode = error.code || inferIssueCode(error.message);
            nextSession.attentionCode = error.code || inferIssueCode(error.message);
            nextSession.attentionMessage = getRecoveryHint(error.code || inferIssueCode(error.message), 'Open the tab, click in the editor, and press Resume to continue.');
            nextSession.updatedAt = Date.now();
            await writeSessions(sessions);
        });
    }

    await syncHealthAlarm();
}

function canAutoRecoverSession(session) {
    if (AUTO_RECOVERY_STATES.has(session.state)) {
        return true;
    }

    return session.state === SESSION_STATES.PAUSED && session.pauseMode === 'schedule';
}

async function pauseSessionForSchedule(tabId, session, scheduleStatus) {
    if (!session.activeJob || !session.activeRunId) {
        return;
    }

    if (session.state === SESSION_STATES.PAUSED && session.pauseMode === 'schedule') {
        await withSessionLock(async () => {
            const sessions = await readSessions();
            const nextSession = getSessionForTab(sessions, tabId);
            if (nextSession.activeRunId !== session.activeRunId) {
                return;
            }

            applySchedulePauseState(nextSession, scheduleStatus);
            await writeSessions(sessions);
        });
        return;
    }

    let runtime = null;
    if (session.state === SESSION_STATES.RUNNING) {
        try {
            const response = await sendRunnerCommand(tabId, { type: 'writerdrip:pause-job', runId: session.activeRunId });
            runtime = response.runtime || null;
        } catch (error) {
            console.warn('[WriterDrip] Could not pause the runner for the schedule window.', error);
        }
    }

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const nextSession = getSessionForTab(sessions, tabId);
        if (nextSession.activeRunId !== session.activeRunId) {
            return;
        }

        if (runtime) {
            applyRuntimeSnapshotToSession(nextSession, runtime, {
                preserveCheckpointFloor: true
            });
        }
        applySchedulePauseState(nextSession, scheduleStatus);
        await writeSessions(sessions);
    });
}

function applySchedulePauseState(session, scheduleStatus) {
    session.state = SESSION_STATES.PAUSED;
    session.pauseMode = 'schedule';
    session.lastError = null;
    session.lastErrorCode = null;
    session.attentionMessage = null;
    session.attentionCode = null;
    session.scheduleNextStartAt = scheduleStatus?.nextStartAt || 0;
    session.updatedAt = Date.now();
}

async function handleUiPreflight(tabId, url, expectedDocKey) {
    if (!tabId) {
        return buildPreflightReport({
            ready: false,
            code: ISSUE_CODES.NO_ACTIVE_TAB,
            message: 'No active Google Doc tab is available.',
            checks: [
                buildPreflightCheck('doc-tab', 'Google Doc tab available', false, 'Open the Google Doc you want to use and reopen WriterDrip.')
            ],
            note: 'WriterDrip runs locally in your browser, so the Google Doc tab and your computer must stay available for the run.'
        });
    }

    if (url) {
        await withSessionLock(async () => {
            const sessions = await readSessions();
            const adopted = await adoptMatchingSessionForTab(tabId, url, sessions);
            if (adopted) {
                await writeSessions(sessions);
            }
        });
    }

    return runPreflightCheck(tabId, expectedDocKey);
}

async function restoreOrStartRun(tabId, payload) {
    await waitForTabReady(tabId);
    await ensureRunnerInjected(tabId);

    const response = await sendMessageToTab(tabId, {
        type: 'writerdrip:start-job',
        runId: payload.runId,
        job: payload.job,
        checkpointActionIndex: payload.checkpointActionIndex || 0
    });

    if (!response || response.status === 'error') {
        throw createCodedError(response?.code || inferIssueCode(response?.message), response?.message || 'The runner could not start on this page.');
    }

    return response;
}

async function runPreflightCheck(tabId, expectedDocKey) {
    try {
        await waitForTabReady(tabId);
        await ensureRunnerInjected(tabId);
        const response = await sendRunnerMessageWithCompatibility(tabId, {
            type: 'writerdrip:probe-editor',
            expectedDocKey
        });

        if (!response || response.status === 'error' || !response.ready) {
            return buildPreflightReport({
                ready: false,
                code: response?.code || ISSUE_CODES.EDITOR_NOT_READY,
                message: response?.message || 'WriterDrip could not attach to the Google Docs editor.',
                checks: response?.checks || [],
                note: response?.note || 'Click inside the document body before starting so WriterDrip can lock onto the right editor target.'
            });
        }

        return buildPreflightReport({
            ready: true,
            code: null,
            message: response.message || 'WriterDrip is ready to start in this Google Doc.',
            checks: response.checks || [],
            note: response.note || 'Keep the original Google Doc tab open, keep your browser open, and keep your computer awake until the drip finishes.'
        });
    } catch (error) {
        return buildPreflightReport({
            ready: false,
            code: error.code || ISSUE_CODES.EDITOR_NOT_READY,
            message: error.message || 'WriterDrip could not attach to the Google Docs editor.',
            checks: [
                buildPreflightCheck('doc-loading', 'Google Doc is available', false, error.message || 'Wait for the document to finish loading, then try again.')
            ],
            note: 'If the browser or laptop sleeps, reopen the same Google Doc tab, let it reload, then run the start check again.'
        });
    }
}

async function ensureRunnerInjected(tabId) {
    try {
        await sendMessageToTab(tabId, { type: 'writerdrip:query-status' });
        return;
    } catch (error) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['shared.js', 'content.js']
            });
            await sleep(80);
            await sendMessageToTab(tabId, { type: 'writerdrip:query-status' });
        } catch (injectError) {
            throw createCodedError(inferIssueCode(injectError.message) || ISSUE_CODES.BACKGROUND_UNAVAILABLE, injectError.message || 'WriterDrip could not attach to this tab.');
        }
    }
}

async function sendRunnerCommand(tabId, payload) {
    await ensureRunnerInjected(tabId);
    const response = await sendRunnerMessageWithCompatibility(tabId, payload);

    if (!response || response.status === 'error') {
        throw createCodedError(response?.code || inferIssueCode(response?.message), response?.message || 'The runner did not accept the command.');
    }

    return response;
}

async function sendRunnerMessageWithCompatibility(tabId, payload) {
    const response = await sendMessageToTab(tabId, payload);
    if (shouldRefreshRunnerFromResponse(response)) {
        return {
            status: 'error',
            code: ISSUE_CODES.EDITOR_NOT_READY,
            message: 'Refresh the Google Doc tab once after reloading or updating WriterDrip, then try again.'
        };
    }
    return response;
}

function shouldRefreshRunnerFromResponse(response) {
    if (!response || response.status !== 'error') {
        return false;
    }

    return /unknown runner message/i.test(String(response.message || ''));
}

async function sendMessageToTab(tabId, message, attempt = 0) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
        const detail = String(error?.message || error);
        if (/Receiving end does not exist/i.test(detail) && attempt < 2) {
            await sleep(80 * (attempt + 1));
            return sendMessageToTab(tabId, message, attempt + 1);
        }
        throw error;
    }
}

async function waitForTabReady(tabId, timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const tab = await getTabSnapshot(tabId);
        if (tab.discarded || tab.frozen) {
            throw createCodedError(ISSUE_CODES.TAB_SUSPENDED, 'The original Google Doc tab was suspended by the browser. Open that tab again, let it reload, then resume.');
        }
        if (tab.status === 'complete') {
            return tab;
        }

        await sleep(120);
    }

    const tab = await getTabSnapshot(tabId);
    if (tab.discarded || tab.frozen) {
        throw createCodedError(ISSUE_CODES.TAB_SUSPENDED, 'The original Google Doc tab was suspended by the browser. Open that tab again, let it reload, then resume.');
    }

    if (tab.status !== 'complete') {
        throw createCodedError(ISSUE_CODES.EDITOR_NOT_READY, 'The Google Doc tab is still loading. Wait for it to finish, then resume.');
    }

    return tab;
}

async function getTabSnapshot(tabId) {
    try {
        return await chrome.tabs.get(tabId);
    } catch (error) {
        throw createCodedError(ISSUE_CODES.NO_ACTIVE_TAB, error?.message || 'The original Google Doc tab is no longer available.');
    }
}

async function readSessions() {
    const result = await chrome.storage.local.get(SESSIONS_KEY);
    const sessions = result[SESSIONS_KEY] || {};

    for (const [tabId, session] of Object.entries(sessions)) {
        sessions[tabId] = normalizeSession(Number.parseInt(tabId, 10), session);
    }

    return sessions;
}

async function writeSessions(sessions) {
    await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
    await safeSyncActionIndicators(sessions);
    await safeSyncDiscardProtection(sessions);
}

function getSessionForTab(sessions, tabId) {
    const key = String(tabId);
    if (!sessions[key]) {
        sessions[key] = normalizeSession(tabId, {});
    }
    return sessions[key];
}

async function getSessionSnapshot(tabId) {
    const sessions = await readSessions();
    return getSessionForTab(sessions, tabId);
}

function normalizeSession(tabId, rawSession) {
    return {
        tabId,
        activeJob: rawSession.activeJob || null,
        activeRunId: rawSession.activeRunId || null,
        state: rawSession.state || SESSION_STATES.IDLE,
        pauseMode: rawSession.pauseMode || null,
        progress: clampNumber(rawSession.progress, 0, 1, 0),
        eta: rawSession.eta || '00:00',
        checkpointActionIndex: Math.max(0, rawSession.checkpointActionIndex || 0),
        totalActions: Math.max(0, rawSession.totalActions || 0),
        lastHeartbeatAt: Math.max(0, rawSession.lastHeartbeatAt || 0),
        updatedAt: Math.max(0, rawSession.updatedAt || 0),
        scheduleNextStartAt: Math.max(0, rawSession.scheduleNextStartAt || 0),
        lastError: rawSession.lastError || null,
        lastErrorCode: rawSession.lastErrorCode || null,
        attentionMessage: rawSession.attentionMessage || null,
        attentionCode: rawSession.attentionCode || null,
        lastKnownUrl: rawSession.lastKnownUrl || '',
        lastCompletedJob: rawSession.lastCompletedJob || null,
        lastCompletedVerification: normalizeCompletionVerification(rawSession.lastCompletedVerification)
    };
}

function resetActiveRun(session, nextState) {
    session.activeJob = null;
    session.activeRunId = null;
    session.state = nextState;
    session.pauseMode = null;
    session.progress = nextState === SESSION_STATES.COMPLETE ? 1 : 0;
    session.eta = '00:00';
    session.checkpointActionIndex = 0;
    session.totalActions = 0;
    session.lastHeartbeatAt = 0;
    session.scheduleNextStartAt = 0;
    session.updatedAt = Date.now();
    session.lastError = null;
    session.lastErrorCode = null;
    session.attentionMessage = null;
    session.attentionCode = null;
}

function markSessionAwaitingTabReopen(session) {
    if (!session?.activeJob || !session?.activeRunId) {
        return false;
    }

    if (session.pauseMode === 'schedule') {
        const scheduleStatus = getScheduleStatusForJob(session.activeJob);
        applySchedulePauseState(session, scheduleStatus);
        return true;
    }

    session.state = SESSION_STATES.ATTENTION;
    session.lastError = null;
    session.lastErrorCode = null;
    session.attentionCode = ISSUE_CODES.TAB_SUSPENDED;
    session.attentionMessage = 'The original Google Doc tab closed or reloaded. Reopen the same document and press Resume.';
    session.updatedAt = Date.now();
    return true;
}

function applyRuntimeSnapshotToSession(session, runtime, options = {}) {
    const runtimeState = runtime?.state;
    if (runtimeState === SESSION_STATES.COMPLETE) {
        session.lastCompletedJob = summarizeJob(session.activeJob);
        session.lastCompletedVerification = normalizeCompletionVerification(runtime?.completionVerification) || session.lastCompletedVerification || null;
        resetActiveRun(session, SESSION_STATES.COMPLETE);
        session.progress = 1;
        session.eta = '00:00';
        session.updatedAt = Date.now();
        return;
    }

    session.state = runtimeState || session.state || SESSION_STATES.RUNNING;
    session.pauseMode = null;
    session.progress = clampNumber(runtime?.percent, 0, 1, session.progress);
    session.eta = runtime?.eta || session.eta;

    const actionIndex = Math.max(0, runtime?.actionIndex || 0);
    session.checkpointActionIndex = options.preserveCheckpointFloor
        ? Math.max(session.checkpointActionIndex || 0, actionIndex)
        : actionIndex;
    session.totalActions = Math.max(session.totalActions || 0, runtime?.totalActions || 0);
    session.lastHeartbeatAt = Date.now();
    session.scheduleNextStartAt = 0;
    session.updatedAt = Date.now();
    session.lastError = null;
    session.lastErrorCode = null;
    session.attentionMessage = null;
    session.attentionCode = null;
}

async function getUiState(tabId, url = '') {
    if (!tabId) {
        return {
            supported: false,
            statusTone: 'warn',
            statusText: 'No active tab found.',
            activeJob: null,
            state: SESSION_STATES.IDLE,
            progress: 0,
            eta: '00:00'
        };
    }

    await withSessionLock(async () => {
        const sessions = await readSessions();
        const adopted = await adoptMatchingSessionForTab(tabId, url, sessions);
        if (adopted) {
            await writeSessions(sessions);
        }
    });

    const session = await getSessionSnapshot(tabId);
    const scheduleStatus = buildPublicScheduleStatus(session.activeJob?.schedule);

    return {
        tabId,
        state: session.state,
        progress: session.progress,
        eta: session.eta,
        activeJob: summarizeJob(session.activeJob),
        isRunning: session.state === SESSION_STATES.RUNNING || session.state === SESSION_STATES.STARTING,
        isPaused: session.state === SESSION_STATES.PAUSED,
        pauseMode: session.pauseMode,
        scheduleStatus: scheduleStatus ? {
            ...scheduleStatus,
            nextStartAt: session.scheduleNextStartAt || scheduleStatus.nextStartAt || null
        } : null,
        attentionMessage: session.attentionMessage,
        attentionCode: session.attentionCode,
        lastError: session.lastError,
        lastErrorCode: session.lastErrorCode,
        lastCompletedJob: session.lastCompletedJob,
        lastCompletedVerification: session.lastCompletedVerification
    };
}

function createJob(rawJob) {
    const text = typeof rawJob?.text === 'string' ? sanitizeDraftText(rawJob.text).trim() : '';
    const minimumDurationMins = getMinimumDurationMins(text);
    const durationMins = normalizeDurationMins(rawJob?.durationMins, minimumDurationMins);
    const docKey = typeof rawJob?.docKey === 'string' && rawJob.docKey.trim() ? rawJob.docKey.trim() : null;
    const correctionIntensity = normalizeCorrectionIntensity(rawJob?.correctionIntensity);
    const schedule = normalizeDailySchedule(rawJob?.schedule);
    if (!text || !docKey || !Number.isFinite(durationMins) || durationMins < minimumDurationMins || durationMins > MAX_DURATION_MINS) {
        return null;
    }

    return {
        id: createId('job'),
        text,
        docKey,
        durationMins,
        preset: rawJob?.preset || null,
        correctionIntensity,
        schedule,
        createdAt: Date.now(),
        seed: Math.floor(Math.random() * 2147483647),
        wordCount: countWords(text),
        charCount: text.length,
        preview: buildPreview(text)
    };
}

function buildPreflightCheck(id, label, pass, detail) {
    return {
        id,
        label,
        pass: Boolean(pass),
        detail: detail || ''
    };
}

function buildPreflightReport(report) {
    return {
        ready: Boolean(report?.ready),
        code: report?.code || null,
        message: report?.message || '',
        checks: Array.isArray(report?.checks) ? report.checks.map((check) => buildPreflightCheck(check.id, check.label, check.pass, check.detail)) : [],
        note: report?.note || ''
    };
}

function summarizeJob(job) {
    if (!job) {
        return null;
    }

    return {
        id: job.id,
        docKey: job.docKey || null,
        durationMins: job.durationMins,
        preset: job.preset || null,
        correctionIntensity: normalizeCorrectionIntensity(job.correctionIntensity),
        schedule: normalizeDailySchedule(job.schedule),
        wordCount: job.wordCount || countWords(job.text || ''),
        charCount: job.charCount || (job.text ? job.text.length : 0),
        preview: job.preview || buildPreview(job.text || '')
    };
}

function getScheduleStatusForJob(job, nowValue = Date.now()) {
    return getDailyScheduleStatus(job?.schedule, nowValue);
}

function buildPublicScheduleStatus(schedule, nowValue = Date.now()) {
    const status = getDailyScheduleStatus(schedule, nowValue);
    if (!status.enabled) {
        return null;
    }

    return {
        enabled: true,
        active: status.active,
        startMinute: status.startMinute,
        endMinute: status.endMinute,
        nextStartAt: status.nextStartAt,
        nextEndAt: status.nextEndAt
    };
}

function normalizeCompletionVerification(rawVerification) {
    if (!rawVerification || typeof rawVerification !== 'object') {
        return null;
    }

    return {
        verified: Boolean(rawVerification.verified),
        summary: rawVerification.summary || '',
        note: rawVerification.note || '',
        checks: Array.isArray(rawVerification.checks)
            ? rawVerification.checks.map((check) => ({
                id: check.id || '',
                label: check.label || '',
                pass: Boolean(check.pass),
                detail: check.detail || ''
            }))
            : []
    };
}

function buildPreview(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= 80) {
        return compact;
    }
    return `${compact.slice(0, 77)}...`;
}

function countWords(text) {
    const compact = text.trim();
    return compact ? compact.split(/\s+/).length : 0;
}

function extractGoogleDocKeyFromUrl(url) {
    try {
        const parsed = new URL(url || '');
        if (parsed.hostname !== 'docs.google.com') {
            return null;
        }
        return parsed.pathname.match(/^\/document\/d\/([^/]+)/)?.[1] || null;
    } catch (error) {
        return null;
    }
}

async function adoptMatchingSessionForTab(tabId, url, sessions = null) {
    const targetSessions = sessions || await readSessions();
    const currentSession = getSessionForTab(targetSessions, tabId);
    if (currentSession.activeJob || currentSession.activeRunId) {
        currentSession.lastKnownUrl = url || currentSession.lastKnownUrl || '';
        return false;
    }

    const docKey = extractGoogleDocKeyFromUrl(url);
    if (!docKey) {
        return false;
    }

    for (const [sessionTabId, session] of Object.entries(targetSessions)) {
        if (sessionTabId === String(tabId)) {
            continue;
        }
        if (!session?.activeJob || !session?.activeRunId || session.activeJob.docKey !== docKey) {
            continue;
        }

        let shouldAdopt = false;
        try {
            const existingTab = await chrome.tabs.get(Number(sessionTabId));
            const existingDocKey = extractGoogleDocKeyFromUrl(existingTab?.url || '');
            shouldAdopt = existingDocKey !== docKey;
        } catch (error) {
            shouldAdopt = true;
        }

        if (!shouldAdopt) {
            continue;
        }

        targetSessions[String(tabId)] = normalizeSession(tabId, {
            ...session,
            tabId,
            lastKnownUrl: url || session.lastKnownUrl || ''
        });
        delete targetSessions[sessionTabId];
        return true;
    }

    return false;
}

function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, numeric));
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function doesTabExist(tabId) {
    try {
        await chrome.tabs.get(tabId);
        return true;
    } catch (error) {
        return false;
    }
}

function durationToClock(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationMins(minutesValue) {
    const minutes = Number(minutesValue);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return '1 min';
    }
    if (minutes % 10080 === 0) {
        const weeks = minutes / 10080;
        return `${weeks} week${weeks === 1 ? '' : 's'}`;
    }
    if (minutes % 1440 === 0) {
        const days = minutes / 1440;
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    return `${minutes} min`;
}

async function syncHealthAlarm() {
    const sessions = await readSessions();
    const hasActiveRun = Object.values(sessions).some((session) => {
        return Boolean(
            session.activeJob &&
            session.activeRunId &&
            (
                AUTO_RECOVERY_STATES.has(session.state) ||
                (session.pauseMode === 'schedule' && AUTO_SCHEDULE_RECOVERY_STATES.has(session.state))
            )
        );
    });

    const existingAlarm = await chrome.alarms.get(HEALTH_ALARM);
    if (hasActiveRun && !existingAlarm) {
        await chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 1 });
    } else if (!hasActiveRun && existingAlarm) {
        await chrome.alarms.clear(HEALTH_ALARM);
    }
}

async function syncActionIndicators(sessions) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'WriterDrip' });

    const seenTabIds = new Set();
    for (const [tabId, session] of Object.entries(sessions)) {
        const numericTabId = Number.parseInt(tabId, 10);
        if (!Number.isFinite(numericTabId)) {
            continue;
        }

        seenTabIds.add(numericTabId);

        if (session.state === SESSION_STATES.ATTENTION) {
            const title = `WriterDrip needs attention: ${session.lastError || 'Open the Google Doc and resume.'}`;
            await applyIndicatorState(numericTabId, {
                badgeText: '!',
                badgeColor: '#b84b28',
                title
            });
            continue;
        }

        await applyIndicatorState(numericTabId, {
            badgeText: '',
            badgeColor: null,
            title: 'WriterDrip'
        });
    }

    for (const tabId of Array.from(indicatorCache.keys())) {
        if (seenTabIds.has(tabId)) {
            continue;
        }

        await applyIndicatorState(tabId, {
            badgeText: '',
            badgeColor: null,
            title: 'WriterDrip'
        });
        indicatorCache.delete(tabId);
    }
}

async function safeSyncActionIndicators(sessions) {
    try {
        await syncActionIndicators(sessions);
    } catch (error) {
        console.warn('[WriterDrip] Could not refresh action indicators.', error);
    }
}

async function safeSyncDiscardProtection(sessions) {
    try {
        await syncDiscardProtection(sessions);
    } catch (error) {
        console.warn('[WriterDrip] Could not refresh discard protection.', error);
    }
}

async function syncDiscardProtection(sessions) {
    const seenTabIds = new Set();

    for (const [tabId, session] of Object.entries(sessions)) {
        const numericTabId = Number.parseInt(tabId, 10);
        if (!Number.isFinite(numericTabId)) {
            continue;
        }

        seenTabIds.add(numericTabId);
        const shouldProtect = Boolean(session.activeJob && session.activeRunId);
        await applyDiscardProtection(numericTabId, shouldProtect);
    }

    for (const [tabId, isProtected] of Array.from(discardProtectionCache.entries())) {
        if (seenTabIds.has(tabId)) {
            continue;
        }

        if (isProtected) {
            await setTabAutoDiscardable(tabId, true);
        }
        discardProtectionCache.delete(tabId);
    }
}

async function applyDiscardProtection(tabId, shouldProtect) {
    const cached = discardProtectionCache.get(tabId);
    if (cached === shouldProtect) {
        return;
    }

    await setTabAutoDiscardable(tabId, !shouldProtect);
    discardProtectionCache.set(tabId, shouldProtect);
}

async function setTabAutoDiscardable(tabId, value, attempt = 0) {
    try {
        await chrome.tabs.update(tabId, { autoDiscardable: value });
    } catch (error) {
        const detail = String(error?.message || error);
        if (/No tab with id/i.test(detail)) {
            discardProtectionCache.delete(tabId);
            return;
        }
        if (/Tabs cannot be edited right now/i.test(detail) && attempt < 2) {
            await sleep(80 * (attempt + 1));
            await setTabAutoDiscardable(tabId, value, attempt + 1);
            return;
        }
        throw error;
    }
}

async function applyIndicatorState(tabId, nextState) {
    const cached = indicatorCache.get(tabId);
    if (cached &&
        cached.badgeText === nextState.badgeText &&
        cached.badgeColor === nextState.badgeColor &&
        cached.title === nextState.title) {
        return;
    }

    try {
        await chrome.action.setBadgeText({ tabId, text: nextState.badgeText });
        if (nextState.badgeColor) {
            await chrome.action.setBadgeBackgroundColor({ tabId, color: nextState.badgeColor });
        }
        await chrome.action.setTitle({ tabId, title: nextState.title });
        indicatorCache.set(tabId, nextState);
    } catch (error) {
        const detail = String(error?.message || error);
        if (/No tab with id/i.test(detail) || /Tabs cannot be edited right now/i.test(detail)) {
            indicatorCache.delete(tabId);
            return;
        }
        throw error;
    }
}

function buildErrorResponse(code, error) {
    return {
        ok: false,
        errorCode: code,
        error
    };
}

function canResumeAttentionState(code) {
    return !code || SAFE_ATTENTION_RESUME_CODES.has(code);
}

function canClearAfterStopFailure(code) {
    return code === ISSUE_CODES.NO_ACTIVE_RUN ||
        code === ISSUE_CODES.NO_ACTIVE_TAB ||
        code === ISSUE_CODES.PAGE_CHANGED ||
        code === ISSUE_CODES.WRONG_DOC ||
        code === ISSUE_CODES.UNSUPPORTED_PAGE;
}

function buildRestartRequiredMessage(code) {
    switch (code) {
        case ISSUE_CODES.EDITOR_AUTO_EDIT:
            return 'Google Docs changed the document during the drip. Review the document, stop the current run, then start again after turning off Smart Compose, spelling or grammar suggestions, and substitutions.';
        case ISSUE_CODES.MANUAL_INTERACTION:
            return 'The document may have changed during manual interaction. Review it, stop the current run, and start again if you want to continue.';
        case ISSUE_CODES.TYPING_CONTEXT_LOST:
            return 'WriterDrip lost the original typing context. Review the document, stop the current run, and start again after clicking back into the document body.';
        case ISSUE_CODES.PAGE_CHANGED:
        case ISSUE_CODES.WRONG_DOC:
            return 'The original document context changed during the drip. Return to the intended Google Doc, stop the current run, and start again if needed.';
        default:
            return 'WriterDrip cannot safely resume from this state. Stop the current run and start again if you want to continue.';
    }
}

function createCodedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function getRecoveryHint(code, fallback) {
    switch (code) {
        case ISSUE_CODES.WRONG_DOC:
        case ISSUE_CODES.PAGE_CHANGED:
            return 'Return to the intended Google Doc, review the document, then stop the current run and start again if needed.';
        case ISSUE_CODES.TAB_SUSPENDED:
            return 'Bring the original Google Doc tab back into view, or reopen the same Google Doc if the tab closed, let it finish loading, then press Resume.';
        case ISSUE_CODES.EDITOR_AUTO_EDIT:
            return 'Turn off Smart Compose, spelling or grammar suggestions, and substitutions in Google Docs, review the document, then stop the current run and start again.';
        case ISSUE_CODES.EDITOR_NOT_READY:
        case ISSUE_CODES.EDITOR_FOCUS_FAILED:
            return 'Click inside the document body, wait for Docs to finish loading, then press Resume.';
        case ISSUE_CODES.MANUAL_INTERACTION:
            return 'If the document changed during manual interaction, review it, then stop the current run and start again.';
        case ISSUE_CODES.TYPING_CONTEXT_LOST:
            return 'Close comment boxes or other fields, review the document, then stop the current run and start again.';
        case ISSUE_CODES.BACKGROUND_UNAVAILABLE:
            return 'Reload the extension from chrome://extensions, then reopen the Google Doc tab.';
        default:
            return fallback || 'Open the Google Doc tab and try again.';
    }
}

function inferIssueCode(message = '') {
    const lower = String(message).toLowerCase();

    if (lower.includes('same google doc') || lower.includes('original google doc')) {
        return ISSUE_CODES.WRONG_DOC;
    }
    if (lower.includes('only runs on google docs')) {
        return ISSUE_CODES.UNSUPPORTED_PAGE;
    }
    if (lower.includes('manual interaction')) {
        return ISSUE_CODES.MANUAL_INTERACTION;
    }
    if (lower.includes('changed or suggested text') || lower.includes('smart compose') || lower.includes('autocorrect') || lower.includes('grammar suggestions') || lower.includes('spelling') || lower.includes('substitutions')) {
        return ISSUE_CODES.EDITOR_AUTO_EDIT;
    }
    if (lower.includes('could not attach') || lower.includes('finish loading')) {
        return ISSUE_CODES.EDITOR_NOT_READY;
    }
    if (lower.includes('suspended by the browser') || lower.includes('discarded') || lower.includes('frozen') || lower.includes('still loading')) {
        return ISSUE_CODES.TAB_SUSPENDED;
    }
    if (lower.includes('place the cursor')) {
        return ISSUE_CODES.EDITOR_FOCUS_FAILED;
    }
    if (lower.includes('page changed while a drip was active')) {
        return ISSUE_CODES.PAGE_CHANGED;
    }
    if (lower.includes('another editable field has focus') || lower.includes('visible google docs page surface')) {
        return ISSUE_CODES.TYPING_CONTEXT_LOST;
    }

    return ISSUE_CODES.RUNTIME_ERROR;
}

globalThis.__writerdripBackgroundTestHooks = Object.freeze({
    SESSION_STATES,
    createJob,
    markSessionAwaitingTabReopen,
    normalizeSession,
    applyRuntimeSnapshotToSession
});
