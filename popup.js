/*
 * SPDX-License-Identifier: MIT
 * WriterDrip source attribution
 * Copyright (c) 2026 WriterDrip contributors
 * If you reuse substantial parts of this project, please keep credit to:
 * https://github.com/Highdrys01/WriterDrip
 */

const Shared = globalThis.WriterDripShared;
if (!Shared) {
    throw new Error('[WriterDrip] shared.js did not load in the popup.');
}

const {
    MIN_DURATION_MINS,
    MAX_DURATION_MINS,
    normalizeCorrectionIntensity,
    normalizeDurationMins,
    sanitizeDraftText,
    analyzeDraftText
} = Shared;

const SESSION_STORAGE_KEY = 'writerdripTabSessions';
const PAGE_KINDS = {
    MISSING: 'missing',
    RESTRICTED: 'restricted',
    UNSUPPORTED: 'unsupported',
    GOOGLE_DOC: 'google-doc'
};

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const siteBadge = document.getElementById('siteBadge');
const inputText = document.getElementById('inputText');
const durationInput = document.getElementById('duration');
const textStats = document.getElementById('textStats');
const durationMeta = document.getElementById('durationMeta');
const correctionMeta = document.getElementById('correctionMeta');
const correctionHint = document.getElementById('correctionHint');
const activePanel = document.getElementById('activePanel');
const activeMeta = document.getElementById('activeMeta');
const activePreview = document.getElementById('activePreview');
const activeDetails = document.getElementById('activeDetails');
const statusEl = document.getElementById('status');
const statusTitleEl = document.getElementById('statusTitle');
const statusTextEl = document.getElementById('statusText');
const statusHintEl = document.getElementById('statusHint');
const preflightPanel = document.getElementById('preflightPanel');
const preflightMetaEl = document.getElementById('preflightMeta');
const preflightSummaryEl = document.getElementById('preflightSummary');
const preflightToggleBtn = document.getElementById('preflightToggle');
const preflightBodyEl = document.getElementById('preflightBody');
const preflightListEl = document.getElementById('preflightList');
const preflightNoteEl = document.getElementById('preflightNote');
const recoveryPanel = document.getElementById('recoveryPanel');
const recoveryMetaEl = document.getElementById('recoveryMeta');
const recoverySummaryEl = document.getElementById('recoverySummary');
const recoveryToggleBtn = document.getElementById('recoveryToggle');
const recoveryBodyEl = document.getElementById('recoveryBody');
const recoveryStepsEl = document.getElementById('recoverySteps');
const recoveryNoteEl = document.getElementById('recoveryNote');
const completionPanel = document.getElementById('completionPanel');
const completionMetaEl = document.getElementById('completionMeta');
const completionSummaryEl = document.getElementById('completionSummary');
const completionToggleBtn = document.getElementById('completionToggle');
const completionBodyEl = document.getElementById('completionBody');
const completionListEl = document.getElementById('completionList');
const completionNoteEl = document.getElementById('completionNote');
const presetButtons = Array.from(document.querySelectorAll('.preset'));
const correctionButtons = Array.from(document.querySelectorAll('[data-intensity]'));

const SAFE_ATTENTION_RESUME_CODES = new Set([
    'editor-not-ready',
    'editor-focus-failed',
    'tab-suspended'
]);

const ISSUE_COPY = {
    'active-run-exists': {
        title: 'Drip already running',
        hint: 'Pause or stop the current drip before starting another one in this tab.'
    },
    'background-unavailable': {
        title: 'Extension connection issue',
        hint: 'Reload WriterDrip from chrome://extensions, then reopen the Google Doc tab.'
    },
    'editor-auto-edit': {
        title: 'Google Docs changed the text',
        hint: 'Turn off Smart Compose, spelling or grammar suggestions, and substitutions in Google Docs, review the document, then stop and restart the drip.'
    },
    'editor-focus-failed': {
        title: 'Cursor not ready',
        hint: 'Click inside the main document body and try again.'
    },
    'editor-not-ready': {
        title: 'Google Doc not ready',
        hint: 'Wait for Docs to finish loading, then click once inside the document body.'
    },
    'invalid-job': {
        title: 'Add a draft and duration',
        hint: 'WriterDrip needs text plus a duration that is long enough for the current draft.'
    },
    'manual-interaction': {
        title: 'Manual interaction detected',
        hint: 'Review the document, then stop and restart the drip if you want to continue.'
    },
    'no-active-run': {
        title: 'No active drip',
        hint: 'Start a drip first, then pause or stop controls will become available.'
    },
    'no-active-tab': {
        title: 'No active tab',
        hint: 'Open the Google Doc you want to use and reopen WriterDrip.'
    },
    'page-changed': {
        title: 'Document tab changed',
        hint: 'Return to the intended Google Doc, review the document, then stop and restart the drip if needed.'
    },
    'runtime-error': {
        title: 'WriterDrip needs attention',
        hint: 'Try reopening the popup. If the issue repeats, reload the extension and the Google Doc tab.'
    },
    'tab-suspended': {
        title: 'Google Doc tab suspended',
        hint: 'Open the original Google Doc tab again, let it finish loading, then press Resume.'
    },
    'typing-context-lost': {
        title: 'Typing target changed',
        hint: 'Close comment boxes or other fields, review the document, then stop and restart the drip.'
    },
    'unknown-command': {
        title: 'Unexpected extension error',
        hint: 'Reload the extension and try again.'
    },
    'unsupported-page': {
        title: 'Open a Google Doc',
        hint: 'WriterDrip only works on editable Google Docs document pages.'
    },
    'wrong-doc': {
        title: 'Wrong Google Doc',
        hint: 'Return to the original document tab that the drip started in.'
    }
};

let currentTabId = null;
let currentTabUrl = '';
let currentPageKind = PAGE_KINDS.MISSING;
let uiBusy = false;
let sessionState = createDefaultSessionState();
let selectedCorrectionIntensity = 'suggested';
let preflightState = {
    status: 'idle',
    report: null,
    requestKey: ''
};
let panelState = {
    preflight: { expanded: false, signature: '' },
    recovery: { expanded: false, signature: '' },
    completion: { expanded: false, signature: '' }
};
let preflightTimer = null;
let preflightRequestId = 0;

document.addEventListener('DOMContentLoaded', async () => {
    updateTextStats();
    syncMinimumDuration(true);
    updatePresetSelection();
    updateCorrectionUi();
    syncButtons();
    bindEvents();
    await loadActiveTab();
});

function createDefaultSessionState(overrides = {}) {
    return {
        state: 'idle',
        activeJob: null,
        progress: 0,
        eta: '00:00',
        isRunning: false,
        isPaused: false,
        attentionMessage: null,
        attentionCode: null,
        lastError: null,
        lastErrorCode: null,
        lastCompletedJob: null,
        lastCompletedVerification: null,
        ...overrides
    };
}

function bindEvents() {
    inputText.addEventListener('input', async () => {
        updateTextStats();
        syncMinimumDuration();
        updateCorrectionUi();
        syncButtons();
        queuePreflightRefresh();
        await saveDraft();
    });

    durationInput.addEventListener('input', async () => {
        updatePresetSelection();
        updateCorrectionUi();
        syncButtons();
        queuePreflightRefresh();
        await saveDraft();
    });

    durationInput.addEventListener('blur', async () => {
        normalizeDurationFieldValue({ clampToMinimum: true });
        updatePresetSelection();
        updateCorrectionUi();
        syncButtons();
        queuePreflightRefresh(true);
        await saveDraft();
    });

    inputText.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !startBtn.disabled) {
            event.preventDefault();
            void startNow();
        }
    });

    startBtn.addEventListener('click', () => {
        void startNow();
    });

    pauseBtn.addEventListener('click', () => {
        void pauseToggle();
    });

    stopBtn.addEventListener('click', () => {
        void stopCurrent();
    });

    clearBtn.addEventListener('click', () => {
        void clearDraft();
    });

    preflightToggleBtn.addEventListener('click', () => {
        togglePanel('preflight');
    });

    recoveryToggleBtn.addEventListener('click', () => {
        togglePanel('recovery');
    });

    completionToggleBtn.addEventListener('click', () => {
        togglePanel('completion');
    });

    presetButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            durationInput.value = button.dataset.duration || durationInput.value;
            updatePresetSelection();
            updateCorrectionUi();
            syncButtons();
            queuePreflightRefresh();
            await saveDraft();
            durationInput.focus();
        });
    });

    correctionButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            selectedCorrectionIntensity = normalizeCorrectionIntensity(button.dataset.intensity);
            updateCorrectionUi();
            queuePreflightRefresh();
            await saveDraft();
        });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[SESSION_STORAGE_KEY] && currentTabId) {
            void refreshSessionState();
        }
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (tabId !== currentTabId) {
            return;
        }

        if (!changeInfo.url && changeInfo.status !== 'complete') {
            return;
        }

        currentTabUrl = tab?.url || changeInfo.url || currentTabUrl;
        currentPageKind = detectPageKind(currentTabUrl);
        applyPageBadge();
        render();
        queuePreflightRefresh(true);
    });
}

async function loadActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        currentPageKind = PAGE_KINDS.MISSING;
        applyPageBadge();
        render();
        return;
    }

    currentTabId = tab.id;
    currentTabUrl = tab.url || '';
    currentPageKind = detectPageKind(currentTabUrl);
    applyPageBadge();

    const [draftText, draftDuration, storedCorrectionIntensity] = await Promise.all([
        readLocal(`dripText_${currentTabId}`),
        readLocal(`dripDuration_${currentTabId}`),
        readLocal(`dripCorrectionIntensity_${currentTabId}`)
    ]);

    if (typeof draftText === 'string') {
        inputText.value = draftText;
    }
    if (draftDuration) {
        durationInput.value = draftDuration;
    }
    selectedCorrectionIntensity = normalizeCorrectionIntensity(storedCorrectionIntensity);

    updateTextStats();
    syncMinimumDuration(true);
    updatePresetSelection();
    updateCorrectionUi();
    await refreshSessionState();
    await clearLegacyScheduleDraftState();
    queuePreflightRefresh(true);
}

async function refreshSessionState() {
    if (!currentTabId) {
        render();
        return;
    }

    try {
        const response = await sendBackgroundMessage('ui:get-state', {
            tabId: currentTabId,
            url: currentTabUrl
        });

        if (!response?.ok) {
            throw new Error(response?.error || 'Unable to load the current session state.');
        }

        sessionState = normalizeUiState(response.state);
    } catch (error) {
        sessionState = createDefaultSessionState({
            lastErrorCode: 'background-unavailable',
            lastError: error.message || 'Unable to connect to the background worker.'
        });
    }

    render();
    queuePreflightRefresh(true);
}

function normalizeUiState(rawState) {
    return createDefaultSessionState({
        state: rawState?.state || 'idle',
        activeJob: rawState?.activeJob || null,
        progress: clampNumber(rawState?.progress, 0, 1, 0),
        eta: rawState?.eta || '00:00',
        isRunning: Boolean(rawState?.isRunning),
        isPaused: Boolean(rawState?.isPaused),
        attentionMessage: rawState?.attentionMessage || null,
        attentionCode: rawState?.attentionCode || null,
        lastError: rawState?.lastError || null,
        lastErrorCode: rawState?.lastErrorCode || null,
        lastCompletedJob: rawState?.lastCompletedJob || null,
        lastCompletedVerification: rawState?.lastCompletedVerification || null
    });
}

function render() {
    renderActiveJob();
    renderPreflightPanel();
    renderRecoveryPanel();
    renderCompletionPanel();
    renderStatus();
    updateCorrectionUi();
    syncButtons();
}

function renderPreflightPanel() {
    const shouldShow = shouldShowPreflightPanel();
    preflightPanel.hidden = !shouldShow;
    if (!shouldShow) {
        setPanelVisibility(preflightToggleBtn, preflightBodyEl, false, false, 'Show details', 'Hide details');
        return;
    }

    if (preflightState.status === 'loading') {
        preflightMetaEl.innerText = 'Checking';
        preflightSummaryEl.innerText = 'Running a quick start check against the current Google Doc.';
        preflightListEl.innerHTML = '';
        preflightNoteEl.innerText = '';
        setPanelVisibility(preflightToggleBtn, preflightBodyEl, false, false, 'Show details', 'Hide details');
        return;
    }

    const report = preflightState.report;
    if (!report) {
        preflightMetaEl.innerText = 'Pending';
        preflightSummaryEl.innerText = 'Add a draft and keep this Google Doc ready to run the start check.';
        preflightListEl.innerHTML = '';
        preflightNoteEl.innerText = '';
        setPanelVisibility(preflightToggleBtn, preflightBodyEl, false, false, 'Show details', 'Hide details');
        return;
    }

    preflightMetaEl.innerText = report.ready ? 'Ready' : 'Fix before start';
    preflightSummaryEl.innerText = report.message || (report.ready ? 'WriterDrip is ready to start.' : 'WriterDrip needs one more setup step before it can start.');
    preflightListEl.innerHTML = renderCheckListMarkup(report.checks || []);
    preflightNoteEl.innerText = report.note || '';
    const hasDetails = Boolean((report.checks && report.checks.length) || report.note);
    const signature = [
        report.code || 'no-code',
        report.ready ? 'ready' : 'blocked',
        report.checks?.length || 0,
        report.note || ''
    ].join('|');
    ensurePanelState('preflight', signature, !report.ready);
    setPanelVisibility(preflightToggleBtn, preflightBodyEl, hasDetails, panelState.preflight.expanded, 'Show details', 'Hide details');
}

function renderRecoveryPanel() {
    const code = sessionState.attentionCode || sessionState.lastErrorCode;
    const shouldShow = Boolean((sessionState.attentionMessage || sessionState.lastError) && code);
    recoveryPanel.hidden = !shouldShow;
    if (!shouldShow) {
        setPanelVisibility(recoveryToggleBtn, recoveryBodyEl, false, false, 'Show steps', 'Hide steps');
        return;
    }

    const wizard = buildRecoveryWizard(code);
    recoveryMetaEl.innerText = canResumeAttentionState(code) ? 'Resume available' : 'Restart required';
    recoverySummaryEl.innerText = sessionState.lastError || sessionState.attentionMessage || wizard.summary;
    recoveryStepsEl.innerHTML = renderStepListMarkup(wizard.steps);
    recoveryNoteEl.innerText = wizard.note;
    const hasDetails = Boolean((wizard.steps && wizard.steps.length) || wizard.note);
    const signature = [
        code || 'no-code',
        sessionState.lastError || '',
        sessionState.attentionMessage || '',
        wizard.steps?.length || 0,
        wizard.note || ''
    ].join('|');
    ensurePanelState('recovery', signature, !canResumeAttentionState(code) || Boolean(sessionState.lastError));
    setPanelVisibility(recoveryToggleBtn, recoveryBodyEl, hasDetails, panelState.recovery.expanded, 'Show steps', 'Hide steps');
}

function renderCompletionPanel() {
    const verification = sessionState.lastCompletedVerification;
    const shouldShow = Boolean(sessionState.lastCompletedJob && verification);
    completionPanel.hidden = !shouldShow;
    if (!shouldShow) {
        setPanelVisibility(completionToggleBtn, completionBodyEl, false, false, 'Show details', 'Hide details');
        return;
    }

    completionMetaEl.innerText = verification.verified ? 'Verified' : 'Needs review';
    completionSummaryEl.innerText = verification.summary || 'WriterDrip finished the last run.';
    completionListEl.innerHTML = renderCheckListMarkup(verification.checks || []);
    completionNoteEl.innerText = verification.note || '';
    const hasDetails = Boolean((verification.checks && verification.checks.length) || verification.note);
    const signature = [
        verification.verified ? 'verified' : 'review',
        verification.summary || '',
        verification.checks?.length || 0,
        verification.note || ''
    ].join('|');
    ensurePanelState('completion', signature, verification.verified === false);
    setPanelVisibility(completionToggleBtn, completionBodyEl, hasDetails, panelState.completion.expanded, 'Show details', 'Hide details');
}

function renderActiveJob() {
    const activeJob = sessionState.activeJob;
    activePanel.hidden = !activeJob;

    if (!activeJob) {
        return;
    }

    activePreview.innerText = activeJob.preview || 'Untitled drip';
    const correctionLabel = activeJob.correctionIntensity
        ? ` • ${formatCorrectionIntensity(activeJob.correctionIntensity)} corrections`
        : '';
    activeDetails.innerText = `${formatDuration(activeJob.durationMins)} • ${activeJob.wordCount} words • ${activeJob.charCount} chars${correctionLabel} • ETA ${sessionState.eta}`;
    activeMeta.innerText = sessionState.state === 'attention'
        ? canResumeAttentionState(sessionState.attentionCode) ? 'Needs attention' : 'Restart required'
        : sessionState.isPaused
            ? 'Paused'
            : sessionState.isRunning
                ? `${Math.floor((sessionState.progress || 0) * 100)}% complete`
                : 'Preparing';
    pauseBtn.innerText = sessionState.state === 'attention' && !canResumeAttentionState(sessionState.attentionCode)
        ? 'Restart needed'
        : sessionState.isPaused || sessionState.state === 'attention'
            ? 'Resume'
            : 'Pause';
}

function renderStatus() {
    if (sessionState.lastError) {
        setStatus(buildIssueStatus(sessionState.lastErrorCode, sessionState.lastError, sessionState.attentionMessage, 'danger'));
        return;
    }

    if (sessionState.attentionMessage) {
        setStatus(buildIssueStatus(sessionState.attentionCode, sessionState.lastError || sessionState.attentionMessage, sessionState.attentionMessage, 'warn'));
        return;
    }

    if (sessionState.activeJob && sessionState.isPaused) {
        setStatus({
            title: 'Drip paused',
            message: `${sessionState.eta} remaining on the active run.`,
            hint: 'You can leave this paused and come back later. Reopen the same Google Doc and press Resume when you are ready.',
            tone: 'muted'
        });
        return;
    }

    if (sessionState.activeJob && sessionState.isRunning) {
        setStatus({
            title: 'Typing in progress',
            message: `${Math.floor((sessionState.progress || 0) * 100)}% complete with ${sessionState.eta} remaining.`,
            hint: 'You can switch to other tabs, or pause now and resume later from the same Google Doc.',
            tone: 'muted'
        });
        return;
    }

    if (sessionState.activeJob) {
        setStatus({
            title: 'Preparing drip',
            message: 'WriterDrip is attaching to the Google Doc editor.',
            hint: 'If this takes too long, click inside the document body once and try again.',
            tone: 'muted'
        });
        return;
    }

    if (currentPageKind !== PAGE_KINDS.GOOGLE_DOC) {
        setStatus(buildPageStatus());
        return;
    }

    const draftAnalysis = getDraftAnalysis();
    const minimumDuration = draftAnalysis.minimumDurationMins;
    const selectedDuration = Number.parseFloat(durationInput.value);

    if (draftAnalysis.trimmed && (!Number.isFinite(selectedDuration) || selectedDuration < minimumDuration)) {
        setStatus({
            title: 'Duration too short',
            message: `This draft needs at least ${formatDuration(minimumDuration)} to run cleanly.`,
            hint: 'WriterDrip uses a draft-sized minimum so it has enough time to finish the full typing process.',
            tone: 'warn'
        });
        return;
    }

    if (sessionState.lastCompletedJob) {
        const verificationSummary = sessionState.lastCompletedVerification?.summary;
        setStatus({
            title: sessionState.lastCompletedVerification?.verified === false ? 'Drip finished with review note' : 'Drip finished',
            message: verificationSummary || 'Last drip finished successfully.',
            hint: 'You can start another run in this same Google Doc tab.',
            tone: sessionState.lastCompletedVerification?.verified === false ? 'warn' : 'success'
        });
        return;
    }

    if (!draftAnalysis.trimmed) {
        setStatus({
            title: 'Add your draft',
            message: 'Paste the text you want WriterDrip to type into the current Google Doc.',
            hint: 'WriterDrip types the draft as provided and stays bound to this Doc tab while the run is active.',
            tone: 'muted'
        });
        return;
    }

    setStatus({
        title: 'Ready to start',
        message: 'WriterDrip is ready in the current Google Doc.',
        hint: 'Click inside the document body first if Google Docs just loaded. You can pause later if you want to continue another time.',
        tone: 'muted'
    });
}

function syncButtons() {
    const draftAnalysis = getDraftAnalysis();
    const hasDraft = Boolean(draftAnalysis.trimmed);
    const durationValue = Number.parseFloat(durationInput.value);
    const minimumDuration = draftAnalysis.minimumDurationMins;
    const validDuration = Number.isFinite(durationValue) && durationValue >= minimumDuration && durationValue <= MAX_DURATION_MINS;
    const hasActiveTab = Boolean(currentTabId);
    const hasActiveRun = Boolean(sessionState.activeJob);
    const onGoogleDoc = currentPageKind === PAGE_KINDS.GOOGLE_DOC;

    startBtn.disabled = uiBusy || !onGoogleDoc || !hasActiveTab || !hasDraft || !validDuration || hasActiveRun;
    clearBtn.disabled = uiBusy || inputText.value.length === 0;
    pauseBtn.disabled = uiBusy || !hasActiveRun || !onGoogleDoc || (sessionState.state === 'attention' && !canResumeAttentionState(sessionState.attentionCode));
    stopBtn.disabled = uiBusy || !hasActiveRun;

    startBtn.innerText = uiBusy ? 'Working...' : hasActiveRun ? 'Drip active' : 'Start drip';
    durationMeta.innerText = hasDraft
        ? `Min ${formatDurationShort(minimumDuration)}`
        : formatDurationShort(durationInput.value);
}

async function startNow() {
    if (uiBusy) {
        return;
    }

    const job = collectDraftJob();
    if (!job) {
        return;
    }

    await withUiBusy(async () => {
        const preflightReport = await refreshPreflightReport({ force: true });
        if (!preflightReport?.ready) {
            setStatus(buildIssueStatus(preflightReport?.code, preflightReport?.message || 'WriterDrip is not ready to start yet.', preflightReport?.note || 'Click inside the document body and run the start check again.', 'warn'));
            return;
        }

        const response = await sendBackgroundMessage('run:start', {
            tabId: currentTabId,
            url: currentTabUrl,
            job
        });

        await handleBackgroundResponse(response, 'Starting drip.');
    });
}

async function pauseToggle() {
    if (uiBusy || !currentTabId || !sessionState.activeJob) {
        return;
    }

    if (currentPageKind !== PAGE_KINDS.GOOGLE_DOC) {
        setStatus('Return to the Google Doc tab to resume the active drip.', 'warn');
        return;
    }

    await withUiBusy(async () => {
        const response = await sendBackgroundMessage('runner:pause-toggle', {
            tabId: currentTabId
        });

        await handleBackgroundResponse(response);
    });
}

async function stopCurrent() {
    if (uiBusy || !currentTabId || !sessionState.activeJob) {
        return;
    }

    await withUiBusy(async () => {
        const response = await sendBackgroundMessage('runner:stop', {
            tabId: currentTabId
        });

        await handleBackgroundResponse(response, 'Stopped the active drip.');
    });
}

async function clearDraft() {
    if (uiBusy) {
        return;
    }

    inputText.value = '';
    updateTextStats();
    syncMinimumDuration(true);
    syncButtons();
    resetPreflightState();
    render();
    await saveDraft();
    setStatus('Draft cleared for this tab.', 'muted');
    inputText.focus();
}

function collectDraftJob() {
    const draftAnalysis = getDraftAnalysis();
    const text = draftAnalysis.trimmed;
    const durationMins = normalizeDurationFieldValue({ clampToMinimum: false });
    const minimumDuration = draftAnalysis.minimumDurationMins;

    if (sessionState.activeJob) {
        setStatus('A drip is already active in this tab. Stop it before starting another.', 'warn');
        return null;
    }

    if (!text) {
        setStatus('Paste the text you want WriterDrip to type first.', 'warn');
        inputText.focus();
        return null;
    }

    if (!Number.isFinite(durationMins) || durationMins < minimumDuration || durationMins > MAX_DURATION_MINS) {
        setStatus({
            title: 'Duration too short',
            message: `Choose a duration between ${formatDuration(minimumDuration)} and ${formatDuration(MAX_DURATION_MINS)}.`,
            hint: 'The minimum changes with draft size so WriterDrip has enough time to finish the whole typing run.',
            tone: 'warn'
        });
        durationInput.focus();
        return null;
    }

    if (!currentTabId || currentPageKind !== PAGE_KINDS.GOOGLE_DOC) {
        setStatus(buildPageStatus());
        return null;
    }

    return {
        text,
        durationMins,
        preset: detectPreset(durationMins),
        docKey: extractGoogleDocKey(currentTabUrl),
        correctionIntensity: normalizeCorrectionIntensity(selectedCorrectionIntensity),
    };
}

async function handleBackgroundResponse(response, successMessage = '') {
    if (!response?.ok) {
        setStatus(buildIssueStatus(response?.errorCode, response?.error || 'The requested action failed.', '', 'danger'));
        return;
    }

    sessionState = normalizeUiState(response.state);
    render();
    queuePreflightRefresh(true);

    if (successMessage && !sessionState.lastError && !sessionState.attentionMessage && sessionState.state !== 'attention') {
        setStatus(successMessage, 'muted');
    }

    await saveDraft();
}

function shouldShowPreflightPanel() {
    return currentPageKind === PAGE_KINDS.GOOGLE_DOC &&
        Boolean(getDraftAnalysis().trimmed) &&
        !sessionState.activeJob &&
        !sessionState.attentionMessage &&
        !sessionState.lastError;
}

function getPreflightRequestKey() {
    const draftAnalysis = getDraftAnalysis();
    return [
        currentTabId || 'no-tab',
        currentPageKind || 'no-page-kind',
        extractGoogleDocKey(currentTabUrl) || 'no-doc',
        draftAnalysis.charCount,
        draftAnalysis.wordCount,
        draftAnalysis.minimumDurationMins,
        durationInput.value || ''
    ].join('|');
}

function resetPreflightState() {
    if (preflightTimer) {
        clearTimeout(preflightTimer);
        preflightTimer = null;
    }

    preflightState = {
        status: 'idle',
        report: null,
        requestKey: ''
    };
    panelState.preflight = {
        expanded: false,
        signature: ''
    };
}

function queuePreflightRefresh(immediate = false) {
    if (preflightTimer) {
        clearTimeout(preflightTimer);
        preflightTimer = null;
    }

    if (!shouldShowPreflightPanel()) {
        resetPreflightState();
        render();
        return;
    }

    if (immediate) {
        void refreshPreflightReport({ force: false });
        return;
    }

    preflightTimer = setTimeout(() => {
        preflightTimer = null;
        void refreshPreflightReport({ force: false });
    }, 180);
}

async function refreshPreflightReport(options = {}) {
    if (!shouldShowPreflightPanel()) {
        resetPreflightState();
        render();
        return null;
    }

    const requestKey = getPreflightRequestKey();
    if (!options.force && preflightState.status === 'ready' && preflightState.requestKey === requestKey) {
        return preflightState.report;
    }

    preflightState.status = 'loading';
    preflightState.requestKey = requestKey;
    render();

    const requestId = ++preflightRequestId;
    const expectedRequestKey = requestKey;
    const response = await sendBackgroundMessage('ui:preflight', {
        tabId: currentTabId,
        url: currentTabUrl,
        expectedDocKey: extractGoogleDocKey(currentTabUrl)
    });

    if (requestId !== preflightRequestId || expectedRequestKey !== getPreflightRequestKey()) {
        return preflightState.report;
    }

    const report = response?.ok
        ? normalizePreflightReport(response.report)
        : shouldUseCompatibilityPreflight(response)
            ? buildCompatibilityPreflightReport()
            : normalizePreflightReport({
                ready: false,
                code: response?.errorCode || 'background-unavailable',
                message: response?.error || 'WriterDrip could not run the start check.',
                checks: [],
                note: 'Reload WriterDrip from chrome://extensions if the start check keeps failing.'
            });

    preflightState = {
        status: 'ready',
        report,
        requestKey
    };
    render();
    return report;
}

function shouldUseCompatibilityPreflight(response) {
    if (!response || response.ok) {
        return false;
    }

    if (response.errorCode === 'unknown-command') {
        return true;
    }

    const detail = `${response.error || ''} ${response.message || ''}`.trim();
    return /unknown command:\s*ui:preflight/i.test(detail);
}

function buildCompatibilityPreflightReport(context = {}) {
    const tabId = context.tabId ?? currentTabId;
    const pageKind = context.pageKind ?? currentPageKind;
    const durationValue = Number.parseFloat(context.durationValue ?? durationInput.value);
    const draftAnalysis = context.draftAnalysis || getDraftAnalysis(context.text ?? inputText.value, durationValue);
    const hasActiveTab = Boolean(tabId);
    const onGoogleDoc = pageKind === PAGE_KINDS.GOOGLE_DOC;
    const hasDraft = Boolean(draftAnalysis.trimmed);
    const validDuration = Number.isFinite(durationValue) &&
        durationValue >= draftAnalysis.minimumDurationMins &&
        durationValue <= MAX_DURATION_MINS;

    let code = null;
    let message = 'WriterDrip is using a compatibility start check while the background worker refreshes.';
    let note = 'Press Start to run the full Google Docs attach check. If the start check stays in compatibility mode, reload WriterDrip from chrome://extensions.';

    if (!hasActiveTab) {
        code = 'no-active-tab';
        message = 'No active Google Doc tab is available.';
        note = 'Open the Google Doc you want to use and reopen WriterDrip.';
    } else if (pageKind === PAGE_KINDS.RESTRICTED) {
        code = 'unsupported-page';
        message = 'Open the Google Doc you want to use in a normal browser tab.';
        note = 'Chrome internal pages and the Web Store do not allow WriterDrip to run.';
    } else if (!onGoogleDoc) {
        code = 'unsupported-page';
        message = 'WriterDrip only works on editable Google Docs document pages.';
        note = 'Open the Google Doc you want to use, click inside the document body, then reopen WriterDrip.';
    } else if (!hasDraft) {
        code = 'invalid-job';
        message = 'Paste the text you want WriterDrip to type first.';
        note = 'Once the draft is in place, WriterDrip can run the full start check on the active Google Doc.';
    } else if (!validDuration) {
        code = 'invalid-job';
        message = `Choose a duration between ${formatDuration(draftAnalysis.minimumDurationMins)} and ${formatDuration(MAX_DURATION_MINS)}.`;
        note = 'The draft-aware minimum keeps WriterDrip from starting runs that are too short to finish cleanly.';
    }

    return normalizePreflightReport({
        ready: !code,
        code,
        message,
        checks: [
            {
                id: 'doc-tab',
                label: 'Google Doc tab available',
                pass: hasActiveTab && onGoogleDoc,
                detail: hasActiveTab && onGoogleDoc
                    ? 'WriterDrip can reach the active Google Doc tab.'
                    : 'Open the Google Doc you want to use in the current browser tab.'
            },
            {
                id: 'draft',
                label: 'Draft ready',
                pass: hasDraft,
                detail: hasDraft
                    ? 'The current draft is ready for a start check.'
                    : 'Paste the text you want WriterDrip to type before starting.'
            },
            {
                id: 'duration',
                label: 'Duration fits this draft',
                pass: validDuration,
                detail: validDuration
                    ? `Current duration: ${formatDuration(durationValue)}.`
                    : `Use at least ${formatDuration(draftAnalysis.minimumDurationMins)} for this draft.`
            },
            {
                id: 'compatibility',
                label: 'Compatibility start check active',
                pass: true,
                detail: 'The popup is using a local check until Chrome refreshes the background worker. Start still runs the full editor attach check.'
            }
        ],
        note
    });
}

function normalizePreflightReport(report) {
    return {
        ready: Boolean(report?.ready),
        code: report?.code || inferIssueCode(report?.message),
        message: report?.message || '',
        checks: Array.isArray(report?.checks)
            ? report.checks.map((check) => ({
                id: check.id || '',
                label: check.label || '',
                pass: Boolean(check.pass),
                detail: check.detail || ''
            }))
            : [],
        note: report?.note || ''
    };
}

function buildRecoveryWizard(code) {
    if (code === 'tab-suspended') {
        return {
            summary: 'The original Google Doc tab was suspended, reloaded, or closed during the run.',
            steps: [
                'Return to the original Google Doc tab, or reopen the same Google Doc if the tab closed.',
                'Wait for the document to finish reloading completely.',
                'Click once inside the main document body.',
                canResumeAttentionState(code) ? 'Reopen WriterDrip and press Resume.' : 'Reopen WriterDrip and restart the drip if needed.'
            ],
            note: 'If Chrome reopened the same Google Doc in a new tab after sleep, restore, or accidental closure, WriterDrip will try to reattach that saved session.'
        };
    }

    if (code === 'background-unavailable') {
        return {
            summary: 'WriterDrip lost its background worker connection.',
            steps: [
                'Open chrome://extensions.',
                'Reload WriterDrip.',
                'Return to the original Google Doc tab and click inside the document body.',
                'Reopen WriterDrip and continue from there.'
            ],
            note: 'This usually happens after Chrome unloads the extension worker or after an update.'
        };
    }

    if (code === 'editor-auto-edit') {
        return {
            summary: 'Google Docs changed text on its own during the run.',
            steps: [
                'Open Tools > Preferences in Google Docs.',
                'Turn off Smart Compose, spelling or grammar suggestions, and substitutions.',
                'Review the document for any rewritten text.',
                'Restart the drip from the point you want to keep.'
            ],
            note: 'WriterDrip stops here on purpose so Docs suggestions do not corrupt the rest of the run.'
        };
    }

    if (code === 'manual-interaction' || code === 'typing-context-lost') {
        return {
            summary: 'The typing context changed while the run was active.',
            steps: [
                'Review the current Google Doc content.',
                'Close comment boxes or other editable fields if they are open.',
                'Click back into the main document body.',
                canResumeAttentionState(code) ? 'Resume if the document still looks correct.' : 'Restart the drip if the document changed during the interruption.'
            ],
            note: 'WriterDrip prefers to stop instead of guessing when the cursor may have moved to the wrong place.'
        };
    }

    if (code === 'editor-not-ready' || code === 'editor-focus-failed') {
        return {
            summary: 'The Google Docs editor was not ready when WriterDrip tried to attach.',
            steps: [
                'Wait for the Google Doc to finish loading.',
                'Click once inside the main document body.',
                'Reopen WriterDrip.',
                canResumeAttentionState(code) ? 'Press Resume.' : 'Start the drip again.'
            ],
            note: 'Starting from the document body gives WriterDrip the cleanest editor target.'
        };
    }

    return {
        summary: 'WriterDrip needs a quick recovery step before it can continue.',
        steps: [
            'Return to the original Google Doc tab.',
            'Review the document and click inside the main document body.',
            canResumeAttentionState(code) ? 'Reopen WriterDrip and press Resume.' : 'Reopen WriterDrip and restart the drip if needed.'
        ],
        note: 'If the issue repeats, reload the extension and the Google Doc tab before trying again.'
    };
}

function renderCheckListMarkup(items) {
    if (!items?.length) {
        return '';
    }

    return items.map((item) => `
        <div class="check-item" data-pass="${item.pass ? 'true' : 'false'}">
          <div class="item-title">${item.pass ? 'Pass' : 'Fix'}: ${escapeHtml(item.label || '')}</div>
          <div class="item-copy">${escapeHtml(item.detail || '')}</div>
        </div>
    `).join('');
}

function togglePanel(panelKey) {
    const panel = panelState[panelKey];
    if (!panel || !panel.signature) {
        return;
    }

    panel.expanded = !panel.expanded;
    render();
}

function ensurePanelState(panelKey, signature, defaultExpanded) {
    const panel = panelState[panelKey];
    if (!panel) {
        return;
    }

    if (panel.signature !== signature) {
        panel.signature = signature;
        panel.expanded = defaultExpanded;
    }
}

function setPanelVisibility(toggleEl, bodyEl, hasDetails, expanded, collapsedLabel, expandedLabel) {
    if (!toggleEl || !bodyEl) {
        return;
    }

    toggleEl.hidden = !hasDetails;
    bodyEl.hidden = !hasDetails || !expanded;
    toggleEl.innerText = expanded ? expandedLabel : collapsedLabel;
    toggleEl.setAttribute('aria-expanded', String(Boolean(hasDetails && expanded)));
}

function renderStepListMarkup(items) {
    if (!items?.length) {
        return '';
    }

    return items.map((item, index) => `
        <div class="step-item">
          <div class="item-title"><span class="step-index">${index + 1}</span>${escapeHtml(item)}</div>
        </div>
    `).join('');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function sendBackgroundMessage(command, payload) {
    try {
        return await chrome.runtime.sendMessage({
            namespace: 'writerdrip',
            command,
            ...payload
        });
    } catch (error) {
        if (/Receiving end does not exist/i.test(error.message || '')) {
            await sleep(120);
            try {
                return await chrome.runtime.sendMessage({
                    namespace: 'writerdrip',
                    command,
                    ...payload
                });
            } catch (retryError) {
                return {
                    ok: false,
                    errorCode: 'background-unavailable',
                    error: 'WriterDrip lost its background connection. Reload the extension from chrome://extensions, then reopen the Google Doc tab.'
                };
            }
        }

        return {
            ok: false,
            errorCode: 'background-unavailable',
            error: error.message || 'Unable to reach the background worker.'
        };
    }
}

function updateTextStats() {
    const sanitized = sanitizeDraftText(inputText.value);
    const analysis = getDraftAnalysis(inputText.value);
    const chars = Array.from(sanitized).length;
    const words = analysis.wordCount;
    textStats.innerText = `${words} words • ${chars} chars`;
}

function updatePresetSelection() {
    const duration = Number.parseFloat(durationInput.value);
    presetButtons.forEach((button) => {
        button.dataset.selected = String(Number.parseFloat(button.dataset.duration) === duration);
    });
}

async function withUiBusy(task) {
    if (uiBusy) {
        return;
    }

    uiBusy = true;
    syncButtons();
    try {
        await task();
    } finally {
        uiBusy = false;
        syncButtons();
    }
}

function detectPreset(durationMins) {
    if (durationMins === 60) {
        return 'hour';
    }
    if (durationMins === 1440) {
        return 'day';
    }
    if (durationMins === 10080) {
        return 'week';
    }
    return null;
}

function formatDuration(minutesValue) {
    const minutes = Number(minutesValue);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return '0 min';
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

function formatDurationShort(minutesValue) {
    const minutes = Number(minutesValue);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return 'Minutes';
    }
    if (minutes >= 10080) {
        return `${(minutes / 10080).toFixed(minutes % 10080 === 0 ? 0 : 1)} wk`;
    }
    if (minutes >= 1440) {
        return `${(minutes / 1440).toFixed(minutes % 1440 === 0 ? 0 : 1)} day`;
    }
    if (minutes >= 60) {
        return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} hr`;
    }
    return `${minutes} min`;
}

function setStatus(message, tone = 'muted') {
    const descriptor = typeof message === 'string'
        ? {
            title: tone === 'danger' ? 'WriterDrip issue' : tone === 'warn' ? 'Attention needed' : 'WriterDrip',
            message,
            hint: '',
            tone
        }
        : {
            title: message?.title || 'WriterDrip',
            message: message?.message || '',
            hint: message?.hint || '',
            tone: message?.tone || tone
        };

    statusEl.dataset.tone = descriptor.tone;
    statusEl.setAttribute('aria-live', descriptor.tone === 'danger' || descriptor.tone === 'warn' ? 'assertive' : 'polite');
    statusTitleEl.innerText = descriptor.title;
    statusTextEl.innerText = descriptor.message;
    statusHintEl.hidden = !descriptor.hint;
    statusHintEl.innerText = descriptor.hint || '';
}

function setSiteBadge(message, tone = 'warn') {
    siteBadge.dataset.tone = tone;
    siteBadge.innerText = message;
}

function detectPageKind(url) {
    if (!url) {
        return PAGE_KINDS.MISSING;
    }
    if (isRestrictedUrl(url)) {
        return PAGE_KINDS.RESTRICTED;
    }
    return isGoogleDocUrl(url) ? PAGE_KINDS.GOOGLE_DOC : PAGE_KINDS.UNSUPPORTED;
}

function applyPageBadge() {
    if (currentPageKind === PAGE_KINDS.GOOGLE_DOC) {
        setSiteBadge('Google Doc tab', 'success');
        return;
    }

    if (currentPageKind === PAGE_KINDS.UNSUPPORTED) {
        setSiteBadge('Not a Google Doc', 'warn');
        return;
    }

    if (currentPageKind === PAGE_KINDS.RESTRICTED) {
        setSiteBadge('Open a doc tab', 'warn');
        return;
    }

    setSiteBadge('No active tab', 'warn');
}

function getPageStatusMessage() {
    if (currentPageKind === PAGE_KINDS.UNSUPPORTED) {
        return 'WriterDrip only runs on Google Docs. Open a document tab and click inside the editor.';
    }

    if (currentPageKind === PAGE_KINDS.RESTRICTED) {
        return 'Open the Google Doc you want to use, click inside it, then reopen WriterDrip.';
    }

    return 'Open a Google Doc tab, click inside the editor, and try again.';
}

function buildPageStatus() {
    if (currentPageKind === PAGE_KINDS.UNSUPPORTED) {
        return buildIssueStatus('unsupported-page', getPageStatusMessage(), 'Open the Google Doc you want to use, then click inside the document body.', 'warn');
    }

    if (currentPageKind === PAGE_KINDS.RESTRICTED) {
        return {
            title: 'Open a normal browser tab',
            message: getPageStatusMessage(),
            hint: 'Chrome internal pages and the Web Store do not allow WriterDrip to run.',
            tone: 'warn'
        };
    }

    return {
        title: 'Open a Google Doc',
        message: getPageStatusMessage(),
        hint: 'After the document loads, click once inside the body and reopen WriterDrip.',
        tone: 'warn'
    };
}

function buildIssueStatus(code, detail, hintOverride = '', tone = 'warn') {
    const resolvedCode = code || inferIssueCode(detail);
    const copy = ISSUE_COPY[resolvedCode] || ISSUE_COPY['runtime-error'];
    return {
        title: copy.title,
        message: detail || 'WriterDrip needs your attention.',
        hint: hintOverride || copy.hint,
        tone
    };
}

function syncMinimumDuration(forceAdjust = false) {
    const minimumDuration = getDraftAnalysis().minimumDurationMins;
    durationInput.min = String(minimumDuration);

    const currentDuration = Number(durationInput.value);
    if (forceAdjust || !Number.isFinite(currentDuration) || currentDuration < minimumDuration) {
        durationInput.value = String(minimumDuration);
    }
}

function updateCorrectionUi() {
    const draftAnalysis = getDraftAnalysis();
    const normalizedSelection = normalizeCorrectionIntensity(selectedCorrectionIntensity);
    const hasDraft = Boolean(draftAnalysis.trimmed);
    const suggestedIntensity = hasDraft ? draftAnalysis.suggestedCorrectionIntensity : 'medium';
    const effectiveIntensity = normalizedSelection === 'suggested'
        ? suggestedIntensity
        : normalizedSelection;

    correctionButtons.forEach((button) => {
        button.dataset.selected = String(button.dataset.intensity === normalizedSelection);
    });

    if (!hasDraft) {
        if (normalizedSelection === 'suggested') {
            correctionMeta.innerText = 'Suggested';
            correctionHint.innerText = 'Suggested adapts to draft length, structure, and pacing once you add text.';
        } else {
            correctionMeta.innerText = `Using ${formatCorrectionIntensity(effectiveIntensity)}`;
            correctionHint.innerText = `${buildCorrectionModeDescription(effectiveIntensity)} Add a draft to see the suggested level.`;
        }
        return;
    }

    if (normalizedSelection === 'suggested') {
        correctionMeta.innerText = `Suggested: ${formatCorrectionIntensity(effectiveIntensity)}`;
        correctionHint.innerText = buildSuggestedCorrectionHint(draftAnalysis, effectiveIntensity);
        return;
    }

    correctionMeta.innerText = `Using ${formatCorrectionIntensity(effectiveIntensity)}`;
    correctionHint.innerText = `${buildCorrectionModeDescription(effectiveIntensity)} Suggested for this draft: ${formatCorrectionIntensity(suggestedIntensity)}. ${draftAnalysis.suggestedCorrectionReason || ''}`.trim();
}

function buildSuggestedCorrectionHint(draftAnalysis, intensity) {
    if (draftAnalysis?.suggestedCorrectionReason) {
        return draftAnalysis.suggestedCorrectionReason;
    }

    if (intensity === 'low') {
        return 'Suggested keeps corrections subtle for short, technical, or tightly structured drafts.';
    }
    if (intensity === 'high') {
        return 'Suggested leans higher for longer prose where the planner has room for a few more recoverable corrections.';
    }
    return 'Suggested keeps correction behavior balanced for the current draft.';
}

function buildCorrectionModeDescription(intensity) {
    if (intensity === 'low') {
        return 'Low keeps corrections rare, quick, and mostly surface-level.';
    }
    if (intensity === 'high') {
        return 'High allows more correction sequences, deeper repairs, and occasional larger word-level swaps when the draft supports them.';
    }
    return 'Medium keeps corrections noticeable but still evenly spaced and controlled.';
}

function formatCorrectionIntensity(value) {
    const normalized = normalizeCorrectionIntensity(value);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getDraftAnalysis(text = inputText.value, durationMins = Number.parseFloat(durationInput.value)) {
    return analyzeDraftText(text, durationMins);
}

function normalizeDurationFieldValue(options = {}) {
    const draftAnalysis = getDraftAnalysis(inputText.value, Number(durationInput.value));
    const normalized = normalizeDurationMins(durationInput.value, options.clampToMinimum === false ? MIN_DURATION_MINS : draftAnalysis.minimumDurationMins);
    if (normalized === null) {
        return null;
    }

    if (String(normalized) !== String(durationInput.value)) {
        durationInput.value = String(normalized);
    }
    return normalized;
}

function inferIssueCode(message = '') {
    const lower = String(message).toLowerCase();

    if (lower.includes('same google doc') || lower.includes('original document tab')) {
        return 'wrong-doc';
    }
    if (lower.includes('only runs on google docs')) {
        return 'unsupported-page';
    }
    if (lower.includes('manual interaction')) {
        return 'manual-interaction';
    }
    if (lower.includes('changed or suggested text') || lower.includes('smart compose') || lower.includes('autocorrect') || lower.includes('grammar suggestions') || lower.includes('spelling') || lower.includes('substitutions')) {
        return 'editor-auto-edit';
    }
    if (lower.includes('could not attach') || lower.includes('finish loading')) {
        return 'editor-not-ready';
    }
    if (lower.includes('suspended by the browser') || lower.includes('still loading')) {
        return 'tab-suspended';
    }
    if (lower.includes('place the cursor')) {
        return 'editor-focus-failed';
    }
    if (lower.includes('another editable field has focus') || lower.includes('visible google docs page surface')) {
        return 'typing-context-lost';
    }
    if (lower.includes('page changed while a drip was active')) {
        return 'page-changed';
    }
    if (lower.includes('already active')) {
        return 'active-run-exists';
    }
    if (lower.includes('no active tab')) {
        return 'no-active-tab';
    }
    if (lower.includes('nothing is currently running') || lower.includes('no matching drip')) {
        return 'no-active-run';
    }

    return 'runtime-error';
}

function canResumeAttentionState(code) {
    return !code || SAFE_ATTENTION_RESUME_CODES.has(code);
}

function isRestrictedUrl(url) {
    return !url ||
        url.startsWith('chrome://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('chrome-search://') ||
        url.startsWith('view-source:') ||
        url.startsWith('https://chromewebstore.google.com/') ||
        url.startsWith('https://chrome.google.com/webstore');
}

function isGoogleDocUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'docs.google.com' && parsed.pathname.startsWith('/document/');
    } catch (error) {
        return false;
    }
}

function extractGoogleDocKey(url) {
    try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/^\/document\/d\/([^/]+)/);
        return match?.[1] || null;
    } catch (error) {
        return null;
    }
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

async function saveDraft() {
    if (!currentTabId) {
        return;
    }

    await chrome.storage.local.set({
        [`dripText_${currentTabId}`]: inputText.value,
        [`dripDuration_${currentTabId}`]: durationInput.value,
        [`dripCorrectionIntensity_${currentTabId}`]: normalizeCorrectionIntensity(selectedCorrectionIntensity)
    });
}

async function clearLegacyScheduleDraftState() {
    if (!currentTabId) {
        return;
    }

    await chrome.storage.local.remove([
        `dripScheduleMode_${currentTabId}`,
        `dripScheduleStart_${currentTabId}`,
        `dripScheduleEnd_${currentTabId}`
    ]);
}

async function readLocal(key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
}

globalThis.__writerdripPopupTestHooks = {
    buildCompatibilityPreflightReport,
    shouldUseCompatibilityPreflight
};
