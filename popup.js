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
    KEEP_AWAKE_ENABLED_KEY,
    RECOVERABLE_ATTENTION_CODES,
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
const keepAwakeToggle = document.getElementById('keepAwakeToggle');
const keepAwakeHint = document.getElementById('keepAwakeHint');
const activePanel = document.getElementById('activePanel');
const activeMeta = document.getElementById('activeMeta');
const activePreview = document.getElementById('activePreview');
const activeDetails = document.getElementById('activeDetails');
const statusEl = document.getElementById('status');
const statusTitleEl = document.getElementById('statusTitle');
const statusTextEl = document.getElementById('statusText');
const statusHintEl = document.getElementById('statusHint');
const debugActionsEl = document.getElementById('debugActions');
const copyDebugBtn = document.getElementById('copyDebugBtn');
const correctionPreviewPanel = document.getElementById('correctionPreviewPanel');
const correctionPreviewMetaEl = document.getElementById('correctionPreviewMeta');
const correctionPreviewSummaryEl = document.getElementById('correctionPreviewSummary');
const correctionPreviewToggleBtn = document.getElementById('correctionPreviewToggle');
const correctionPreviewBodyEl = document.getElementById('correctionPreviewBody');
const correctionPreviewListEl = document.getElementById('correctionPreviewList');
const correctionPreviewNoteEl = document.getElementById('correctionPreviewNote');
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
const recoveryChecksEl = document.getElementById('recoveryChecks');
const recoveryStepsEl = document.getElementById('recoverySteps');
const recoveryNoteEl = document.getElementById('recoveryNote');
const completionPanel = document.getElementById('completionPanel');
const completionMetaEl = document.getElementById('completionMeta');
const completionSummaryEl = document.getElementById('completionSummary');
const completionToggleBtn = document.getElementById('completionToggle');
const completionBodyEl = document.getElementById('completionBody');
const completionListEl = document.getElementById('completionList');
const completionNoteEl = document.getElementById('completionNote');
const runSummaryPanel = document.getElementById('runSummaryPanel');
const runSummaryMetaEl = document.getElementById('runSummaryMeta');
const runSummarySummaryEl = document.getElementById('runSummarySummary');
const runSummaryToggleBtn = document.getElementById('runSummaryToggle');
const runSummaryBodyEl = document.getElementById('runSummaryBody');
const runSummaryListEl = document.getElementById('runSummaryList');
const runSummaryNoteEl = document.getElementById('runSummaryNote');
const presetButtons = Array.from(document.querySelectorAll('.preset'));
const correctionButtons = Array.from(document.querySelectorAll('[data-intensity]'));

const SAFE_ATTENTION_RESUME_CODES = new Set(RECOVERABLE_ATTENTION_CODES);

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
        hint: 'WriterDrip needs text plus a duration entered in minutes that is long enough for the current draft.'
    },
    'manual-interaction': {
        title: 'Manual interaction detected',
        hint: 'Review the document, click the intended insertion point in the main document body, then press Resume.'
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
        hint: 'Close comment boxes or other fields, review the document, click back into the main document body, then press Resume.'
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
let keepAwakeEnabled = true;
let preflightState = {
    status: 'idle',
    report: null,
    requestKey: ''
};
let resumeConfidenceState = {
    status: 'idle',
    report: null,
    requestKey: ''
};
let panelState = {
    correctionPreview: { expanded: false, signature: '' },
    preflight: { expanded: false, signature: '' },
    recovery: { expanded: false, signature: '' },
    runSummary: { expanded: false, signature: '' },
    completion: { expanded: false, signature: '' }
};
let preflightTimer = null;
let preflightRequestId = 0;
let resumeConfidenceTimer = null;
let resumeConfidenceRequestId = 0;

document.addEventListener('DOMContentLoaded', async () => {
    updateTextStats();
    syncMinimumDuration(true);
    updatePresetSelection();
    updateCorrectionUi();
    syncKeepAwakeUi();
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
        lastRunSummary: null,
        pauseReason: null,
        keepAwakeRequested: false,
        ...overrides
    };
}

function bindEvents() {
    inputText.addEventListener('input', async () => {
        updateTextStats();
        syncMinimumDuration();
        updateCorrectionUi();
        syncButtons();
        renderDraftDependentPanels();
        queuePreflightRefresh();
        await saveDraft();
    });

    durationInput.addEventListener('input', async () => {
        updatePresetSelection();
        updateCorrectionUi();
        syncButtons();
        renderDraftDependentPanels();
        queuePreflightRefresh();
        await saveDraft();
    });

    durationInput.addEventListener('blur', async () => {
        normalizeDurationFieldValue({ clampToMinimum: true });
        updatePresetSelection();
        updateCorrectionUi();
        syncButtons();
        renderDraftDependentPanels();
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

    copyDebugBtn.addEventListener('click', () => {
        void copyDebugReport();
    });

    correctionPreviewToggleBtn.addEventListener('click', () => {
        togglePanel('correctionPreview');
    });

    preflightToggleBtn.addEventListener('click', () => {
        togglePanel('preflight');
    });

    recoveryToggleBtn.addEventListener('click', () => {
        togglePanel('recovery');
    });

    runSummaryToggleBtn.addEventListener('click', () => {
        togglePanel('runSummary');
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
            renderDraftDependentPanels();
            queuePreflightRefresh();
            await saveDraft();
            durationInput.focus();
        });
    });

    correctionButtons.forEach((button) => {
        button.addEventListener('click', async () => {
            selectedCorrectionIntensity = normalizeCorrectionIntensity(button.dataset.intensity);
            resetPreflightState();
            render();
            queuePreflightRefresh();
            await saveDraft();
        });
    });

    keepAwakeToggle.addEventListener('change', async () => {
        keepAwakeEnabled = Boolean(keepAwakeToggle.checked);
        syncKeepAwakeUi();
        await saveKeepAwakePreference();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[SESSION_STORAGE_KEY] && currentTabId) {
            void refreshSessionState();
        }
        if (areaName === 'local' && changes[KEEP_AWAKE_ENABLED_KEY]) {
            keepAwakeEnabled = changes[KEEP_AWAKE_ENABLED_KEY].newValue !== false;
            syncKeepAwakeUi();
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
        queueResumeConfidenceRefresh(true);
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

    const [draftText, draftDuration, storedCorrectionIntensity, storedKeepAwakeEnabled] = await Promise.all([
        readLocal(`dripText_${currentTabId}`),
        readLocal(`dripDuration_${currentTabId}`),
        readLocal(`dripCorrectionIntensity_${currentTabId}`),
        readLocal(KEEP_AWAKE_ENABLED_KEY)
    ]);

    if (typeof draftText === 'string') {
        inputText.value = draftText;
    }
    if (draftDuration) {
        durationInput.value = draftDuration;
    }
    selectedCorrectionIntensity = normalizeCorrectionIntensity(storedCorrectionIntensity);
    keepAwakeEnabled = storedKeepAwakeEnabled !== false;

    updateTextStats();
    syncMinimumDuration(true);
    updatePresetSelection();
    updateCorrectionUi();
    syncKeepAwakeUi();
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
        if (response.state && typeof response.state.keepAwakeEnabled === 'boolean') {
            keepAwakeEnabled = response.state.keepAwakeEnabled;
            syncKeepAwakeUi();
        }
    } catch (error) {
        sessionState = createDefaultSessionState({
            lastErrorCode: 'background-unavailable',
            lastError: error.message || 'Unable to connect to the background worker.'
        });
    }

    render();
    queuePreflightRefresh(true);
    queueResumeConfidenceRefresh(true);
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
        lastCompletedVerification: rawState?.lastCompletedVerification || null,
        lastRunSummary: normalizeUiRunSummary(rawState?.lastRunSummary),
        pauseReason: normalizePauseReason(rawState?.pauseReason),
        keepAwakeRequested: Boolean(rawState?.keepAwakeRequested)
    });
}

function render() {
    renderActiveJob();
    renderCorrectionPreviewPanel();
    renderPreflightPanel();
    renderRecoveryPanel();
    renderRunSummaryPanel();
    renderCompletionPanel();
    renderStatus();
    renderDebugActions();
    updateCorrectionUi();
    syncButtons();
}

function renderCorrectionPreviewPanel() {
    const draftAnalysis = getDraftAnalysis();
    const shouldShow = Boolean(draftAnalysis.trimmed) && !sessionState.activeJob;
    correctionPreviewPanel.hidden = !shouldShow;
    if (!shouldShow) {
        setPanelVisibility(correctionPreviewToggleBtn, correctionPreviewBodyEl, false, false, 'Show modes', 'Hide modes');
        return;
    }

    const preview = draftAnalysis.correctionPreview;
    const selectedMode = preview?.selectedMode || preview?.modes?.find((mode) => mode.id === normalizeCorrectionIntensity(selectedCorrectionIntensity));
    const suggestedMode = preview?.suggestedMode || preview?.modes?.find((mode) => mode.id === 'suggested');
    const selectedLabel = selectedMode?.id === 'suggested'
        ? `Suggested: ${selectedMode.adaptiveLabel || 'Adaptive'}`
        : formatCorrectionIntensity(selectedMode?.id || selectedCorrectionIntensity);

    correctionPreviewMetaEl.innerText = selectedLabel;
    correctionPreviewSummaryEl.innerText = selectedMode?.summary ||
        'WriterDrip estimates correction behavior for this draft before the run starts.';
    correctionPreviewListEl.innerHTML = renderCorrectionPreviewMarkup(preview?.modes || []);
    correctionPreviewNoteEl.innerText = suggestedMode
        ? `Suggested currently maps to ${suggestedMode.adaptiveLabel || formatCorrectionIntensity(suggestedMode.effectiveIntensity)} with ${suggestedMode.estimatedRepairs} estimated repairs. These are planning estimates; the final run summary shows what actually happened.`
        : 'These are planning estimates; the final run summary shows what actually happened.';

    const signature = [
        selectedMode?.id || 'none',
        selectedMode?.estimatedRepairs || 0,
        selectedMode?.delayedRepairs || 0,
        selectedMode?.pauseMoments || 0,
        preview?.modes?.map((mode) => `${mode.id}:${mode.estimatedRepairs}:${mode.delayedRepairs}`).join(',') || ''
    ].join('|');
    ensurePanelState('correctionPreview', signature, false);
    setPanelVisibility(correctionPreviewToggleBtn, correctionPreviewBodyEl, Boolean(preview?.modes?.length), panelState.correctionPreview.expanded, 'Show modes', 'Hide modes');
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
    const resumeIntent = Boolean(sessionState.activeJob) && (sessionState.isPaused || sessionState.state === 'attention');
    const shouldShow = resumeIntent && (Boolean(code) || resumeConfidenceState.status === 'loading' || Boolean(resumeConfidenceState.report));
    recoveryPanel.hidden = !shouldShow;
    if (!shouldShow) {
        setPanelVisibility(recoveryToggleBtn, recoveryBodyEl, false, false, 'Show steps', 'Hide steps');
        return;
    }

    const wizard = buildRecoveryWizard(code);
    const confidenceReport = resumeConfidenceState.report;
    if (!canResumeAttentionState(code)) {
        recoveryMetaEl.innerText = 'Restart required';
    } else if (resumeConfidenceState.status === 'loading') {
        recoveryMetaEl.innerText = 'Checking';
    } else if (confidenceReport) {
        recoveryMetaEl.innerText = formatRecoveryConfidence(confidenceReport);
    } else {
        recoveryMetaEl.innerText = 'Resume available';
    }

    recoverySummaryEl.innerText = sessionState.lastError || sessionState.attentionMessage || confidenceReport?.message || wizard.summary;
    recoveryChecksEl.innerHTML = renderCheckListMarkup(confidenceReport?.checks || []);
    recoveryStepsEl.innerHTML = renderStepListMarkup(wizard.steps);
    recoveryNoteEl.innerText = [confidenceReport?.note || '', wizard.note || ''].filter(Boolean).join(' ');
    const hasDetails = Boolean(
        (confidenceReport?.checks && confidenceReport.checks.length) ||
        (wizard.steps && wizard.steps.length) ||
        confidenceReport?.note ||
        wizard.note
    );
    const signature = [
        code || 'no-code',
        sessionState.lastError || '',
        sessionState.attentionMessage || '',
        confidenceReport?.confidence || 'no-confidence',
        confidenceReport?.canResume ? 'resume' : 'blocked',
        confidenceReport?.checks?.length || 0,
        wizard.steps?.length || 0,
        confidenceReport?.note || '',
        wizard.note || ''
    ].join('|');
    ensurePanelState('recovery', signature, !canResumeAttentionState(code) || Boolean(sessionState.lastError));
    setPanelVisibility(recoveryToggleBtn, recoveryBodyEl, hasDetails, panelState.recovery.expanded, 'Show steps', 'Hide steps');
}

function renderRunSummaryPanel() {
    const summary = sessionState.lastRunSummary;
    const shouldShow = Boolean(summary);
    runSummaryPanel.hidden = !shouldShow;
    if (!shouldShow) {
        setPanelVisibility(runSummaryToggleBtn, runSummaryBodyEl, false, false, 'Show stats', 'Hide stats');
        return;
    }

    const passed = summary.completionCheckPassed !== false;
    runSummaryMetaEl.innerText = passed ? 'Complete' : 'Review';
    runSummarySummaryEl.innerText = buildRunSummarySentence(summary);
    runSummaryListEl.innerHTML = renderCheckListMarkup(buildRunSummaryItems(summary));
    runSummaryNoteEl.innerText = 'Run summaries store counts and diagnostic metadata only. They do not store your draft text.';
    const signature = [
        summary.completedAt || 0,
        summary.correctionsUsed || 0,
        summary.delayedRepairs || 0,
        summary.pauseMoments || 0,
        summary.userPauses || 0,
        summary.interruptions || 0,
        String(summary.completionCheckPassed)
    ].join('|');
    ensurePanelState('runSummary', signature, summary.completionCheckPassed === false);
    setPanelVisibility(runSummaryToggleBtn, runSummaryBodyEl, true, panelState.runSummary.expanded, 'Show stats', 'Hide stats');
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
        : sessionState.state === 'starting'
            ? 'Attaching'
        : sessionState.isPaused
            ? isSafetyPause(sessionState.pauseReason) ? 'Paused safely' : 'Paused'
            : sessionState.isRunning
                ? `${Math.floor((sessionState.progress || 0) * 100)}% complete`
                : 'Preparing';
    pauseBtn.innerText = sessionState.state === 'attention' && !canResumeAttentionState(sessionState.attentionCode)
        ? 'Restart needed'
        : sessionState.state === 'starting'
            ? 'Starting...'
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
        const safetyPause = isSafetyPause(sessionState.pauseReason);
        setStatus({
            title: safetyPause ? 'Drip paused safely' : 'Drip paused',
            message: safetyPause
                ? sessionState.pauseReason.message || 'WriterDrip paused to keep the run attached to the right Google Doc cursor.'
                : `${sessionState.eta} remaining on the active run.`,
            hint: resumeConfidenceState.report?.canResume === false
                ? (resumeConfidenceState.report.note || 'Review the recovery panel before resuming this run.')
                : safetyPause
                    ? 'Click the intended insertion point in the document body, then press Resume. WriterDrip checks the Doc before continuing.'
                    : 'You can leave this paused and come back later. Reopen the same Google Doc and press Resume when you are ready.',
            tone: 'muted'
        });
        return;
    }

    if (sessionState.activeJob && sessionState.state === 'starting') {
        setStatus({
            title: 'Preparing drip',
            message: 'WriterDrip is attaching to the Google Doc editor.',
            hint: 'If this hangs, press Stop, reload the Google Doc, click inside the document body, and start again.',
            tone: 'muted'
        });
        return;
    }

    if (sessionState.activeJob && sessionState.isRunning) {
        setStatus({
            title: 'Typing in progress',
            message: `${Math.floor((sessionState.progress || 0) * 100)}% complete with ${sessionState.eta} remaining.`,
            hint: keepAwakeEnabled
                ? 'You can switch to other tabs. Keep-awake is on, so Chrome is asked to keep the system awake during this active run.'
                : 'You can switch to other tabs. Keep-awake is off, so pause first if the computer may sleep.',
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
    const selectedDuration = readDurationInputValue(NaN);

    if (draftAnalysis.trimmed && (!Number.isFinite(selectedDuration) || selectedDuration < minimumDuration)) {
        setStatus({
            title: 'Duration too short',
            message: `This draft needs at least ${formatDuration(minimumDuration)} to run cleanly. Enter the duration in minutes.`,
            hint: draftAnalysis.recommendedDurationMins > minimumDuration
                ? `The hard minimum is ${formatDuration(minimumDuration)}, but WriterDrip recommends ${formatRecommendedDuration(draftAnalysis)}. Type that number as minutes or use a quick button.`
                : 'WriterDrip uses a draft-sized minimum in minutes so it has enough time to finish the full typing process.',
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
        hint: draftAnalysis.recommendedDurationMins > minimumDuration
            ? `${draftAnalysis.recommendedDurationReason || 'WriterDrip recommends a little more room than the minimum for this draft.'} The hard minimum is still ${formatDuration(minimumDuration)}. Recommended right now: ${formatRecommendedDuration(draftAnalysis)}. Enter custom durations as minutes.`
            : 'Click inside the document body first if Google Docs just loaded. Custom durations are entered as minutes, and you can pause later if you want to continue another time.',
        tone: 'muted'
    });
}

function renderDebugActions() {
    const draftAnalysis = getDraftAnalysis();
    const preflightBlocked = preflightState.status === 'ready' &&
        Boolean(preflightState.report) &&
        !preflightState.report.ready;
    const resumeBlocked = resumeConfidenceState.status === 'ready' &&
        Boolean(resumeConfidenceState.report) &&
        !resumeConfidenceState.report.canResume;
    const localIssueCode = getLocalInputIssueCode(draftAnalysis);
    const shouldShow = Boolean(sessionState.lastError || sessionState.attentionMessage || preflightBlocked || resumeBlocked || localIssueCode);

    debugActionsEl.hidden = !shouldShow;
    copyDebugBtn.disabled = uiBusy || !shouldShow;
}

function renderDraftDependentPanels() {
    renderCorrectionPreviewPanel();
    renderDebugActions();
}

function syncButtons() {
    const draftAnalysis = getDraftAnalysis();
    const hasDraft = Boolean(draftAnalysis.trimmed);
    const durationValue = readDurationInputValue(NaN);
    const minimumDuration = draftAnalysis.minimumDurationMins;
    const validDuration = Number.isFinite(durationValue) && durationValue >= minimumDuration && durationValue <= MAX_DURATION_MINS;
    const hasActiveTab = Boolean(currentTabId);
    const hasActiveRun = Boolean(sessionState.activeJob);
    const onGoogleDoc = currentPageKind === PAGE_KINDS.GOOGLE_DOC;
    const isStarting = sessionState.state === 'starting';
    const resumeIntent = hasActiveRun && (sessionState.isPaused || sessionState.state === 'attention');
    const preflightBlockingStart = shouldShowPreflightPanel() &&
        preflightState.status === 'ready' &&
        Boolean(preflightState.report) &&
        !preflightState.report.ready;
    const resumeBlocking = shouldBlockResumeButton(resumeIntent, resumeConfidenceState);

    startBtn.disabled = uiBusy || !onGoogleDoc || !hasActiveTab || !hasDraft || !validDuration || hasActiveRun || preflightBlockingStart;
    clearBtn.disabled = uiBusy || inputText.value.length === 0;
    pauseBtn.disabled = uiBusy || !hasActiveRun || !onGoogleDoc || isStarting || (sessionState.state === 'attention' && !canResumeAttentionState(sessionState.attentionCode)) || resumeBlocking;
    stopBtn.disabled = uiBusy || !hasActiveRun;

    startBtn.innerText = uiBusy ? 'Working...' : hasActiveRun ? 'Drip active' : 'Start drip';
    if (resumeIntent && resumeConfidenceState.status === 'loading') {
        pauseBtn.innerText = 'Checking resume';
    } else if (resumeIntent && resumeConfidenceState.report && !resumeConfidenceState.report.canResume) {
        pauseBtn.innerText = 'Check resume';
    }
    durationMeta.innerText = hasDraft
        ? buildDurationMetaLabel(draftAnalysis, minimumDuration)
        : formatDurationShort(durationInput.value);
}

function shouldBlockResumeButton(resumeIntent, confidenceState = resumeConfidenceState) {
    return Boolean(resumeIntent && confidenceState?.status === 'loading');
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
        if (sessionState.isPaused || sessionState.state === 'attention') {
            const resumeReport = await refreshResumeConfidenceReport({ force: true });
            if (resumeReport && !resumeReport.canResume) {
                setStatus(buildIssueStatus(
                    resumeReport.code,
                    resumeReport.message || 'WriterDrip could not confirm that Resume is safe right now.',
                    resumeReport.note || 'Review the recovery panel before trying to resume again.',
                    'warn'
                ));
                return;
            }
        }

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

async function copyDebugReport() {
    if (uiBusy) {
        return;
    }

    await withUiBusy(async () => {
        const popupContext = buildPopupDebugContext();
        let report = buildLocalDebugReport(popupContext);

        if (currentTabId) {
            const response = await sendBackgroundMessage('ui:debug-report', {
                tabId: currentTabId,
                url: currentTabUrl,
                popup: popupContext
            });
            if (response?.ok && response.report) {
                report = response.report;
            }
        }

        const text = JSON.stringify(report, null, 2);
        try {
            if (!globalThis.navigator?.clipboard?.writeText) {
                throw new Error('Clipboard API is not available in this popup.');
            }
            await globalThis.navigator.clipboard.writeText(text);
            setStatus({
                title: 'Debug report copied',
                message: 'Copied a redacted WriterDrip debug report.',
                hint: 'It includes browser, extension, session, and Doc status metadata only; it does not include your draft text.',
                tone: 'muted'
            });
        } catch (error) {
            setStatus({
                title: 'Could not copy report',
                message: error.message || 'Clipboard access was blocked.',
                hint: 'Try reopening the popup and pressing Copy Debug Report again.',
                tone: 'warn'
            });
        }
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
            message: `Choose a duration in minutes between ${formatDuration(minimumDuration)} and ${formatDuration(MAX_DURATION_MINS)}.`,
            hint: draftAnalysis.recommendedDurationMins > minimumDuration
                ? `The hard minimum is ${formatDuration(minimumDuration)}, but WriterDrip recommends ${formatRecommendedDuration(draftAnalysis)}. Enter minutes only, not hours text.`
                : 'The minute minimum changes with draft size so WriterDrip has enough time to finish the whole typing run.',
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
    queueResumeConfidenceRefresh(true);

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
        selectedCorrectionIntensity,
        draftAnalysis.charCount,
        draftAnalysis.wordCount,
        draftAnalysis.minimumDurationMins,
        draftAnalysis.recommendedDurationMins,
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

function resetResumeConfidenceState() {
    if (resumeConfidenceTimer) {
        clearTimeout(resumeConfidenceTimer);
        resumeConfidenceTimer = null;
    }

    resumeConfidenceState = {
        status: 'idle',
        report: null,
        requestKey: ''
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

function shouldShowResumeConfidencePanel() {
    return currentPageKind === PAGE_KINDS.GOOGLE_DOC &&
        Boolean(currentTabId) &&
        Boolean(sessionState.activeJob) &&
        (sessionState.isPaused || sessionState.state === 'attention');
}

function getResumeConfidenceRequestKey() {
    return [
        currentTabId || 'no-tab',
        currentPageKind || 'no-page-kind',
        currentTabUrl || 'no-url',
        sessionState.state || 'no-state',
        sessionState.attentionCode || 'no-attention',
        sessionState.activeJob?.docKey || 'no-doc',
        sessionState.activeJob?.id || 'no-job'
    ].join('|');
}

function queueResumeConfidenceRefresh(immediate = false) {
    if (resumeConfidenceTimer) {
        clearTimeout(resumeConfidenceTimer);
        resumeConfidenceTimer = null;
    }

    if (!shouldShowResumeConfidencePanel()) {
        resetResumeConfidenceState();
        render();
        return;
    }

    if (immediate) {
        void refreshResumeConfidenceReport({ force: false });
        return;
    }

    resumeConfidenceTimer = setTimeout(() => {
        resumeConfidenceTimer = null;
        void refreshResumeConfidenceReport({ force: false });
    }, 180);
}

async function refreshResumeConfidenceReport(options = {}) {
    if (!shouldShowResumeConfidencePanel()) {
        resetResumeConfidenceState();
        render();
        return null;
    }

    const requestKey = getResumeConfidenceRequestKey();
    if (!options.force && resumeConfidenceState.status === 'ready' && resumeConfidenceState.requestKey === requestKey) {
        return resumeConfidenceState.report;
    }

    resumeConfidenceState.status = 'loading';
    resumeConfidenceState.requestKey = requestKey;
    render();

    const requestId = ++resumeConfidenceRequestId;
    const expectedRequestKey = requestKey;
    const response = await sendBackgroundMessage('ui:resume-confidence', {
        tabId: currentTabId,
        url: currentTabUrl
    });

    if (requestId !== resumeConfidenceRequestId || expectedRequestKey !== getResumeConfidenceRequestKey()) {
        return resumeConfidenceState.report;
    }

    const report = normalizeResumeConfidenceReport(response?.ok ? response.report : {
        canResume: false,
        confidence: 'low',
        code: response?.errorCode || 'background-unavailable',
        message: response?.error || 'WriterDrip could not verify whether Resume is safe right now.',
        checks: [],
        note: 'Reload the extension if Resume keeps failing to verify.'
    });

    resumeConfidenceState = {
        status: 'ready',
        report,
        requestKey
    };
    render();
    return report;
}

async function refreshPreflightReport(options = {}) {
    if (!shouldShowPreflightPanel()) {
        resetPreflightState();
        render();
        return null;
    }

    const requestKey = getPreflightRequestKey();
    if (!options.force && preflightState.status === 'ready' && preflightState.requestKey === requestKey) {
        render();
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
    const durationValue = context.durationValue === undefined
        ? readDurationInputValue(NaN)
        : Number(context.durationValue);
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
        message = `Choose a duration in minutes between ${formatDuration(draftAnalysis.minimumDurationMins)} and ${formatDuration(MAX_DURATION_MINS)}.`;
        note = 'Enter minutes only. The draft-aware minimum keeps WriterDrip from starting runs that are too short to finish cleanly.';
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
                    ? `Current duration: ${formatDuration(durationValue)} (${durationValue} minutes). Recommended: ${formatRecommendedDuration(draftAnalysis)}.`
                    : `Use at least ${formatDuration(draftAnalysis.minimumDurationMins)} for this draft, entered as minutes. Recommended: ${formatRecommendedDuration(draftAnalysis)}.`
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

function normalizeResumeConfidenceReport(report) {
    return {
        canResume: Boolean(report?.canResume),
        confidence: report?.confidence || 'low',
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

function formatRecoveryConfidence(report) {
    if (!report) {
        return 'Ready';
    }

    if (!report.canResume) {
        const code = report.code || inferIssueCode(report.message || report.note || '');
        if (code === 'wrong-doc' || code === 'page-changed') {
            return 'Doc changed';
        }
        if (code === 'editor-not-ready' || code === 'editor-focus-failed' || code === 'manual-interaction' || code === 'typing-context-lost' || code === 'tab-suspended') {
            return 'Needs click in Doc';
        }
        return 'Restart recommended';
    }

    if (report.confidence === 'high') {
        return 'Ready';
    }
    if (report.confidence === 'medium') {
        return 'Ready after check';
    }

    return 'Needs click in Doc';
}

function buildRecoveryWizard(code) {
    if (!code) {
        return {
            summary: 'WriterDrip can re-check this paused run before resuming.',
            steps: [
                'Return to the same Google Doc if you switched away from it.',
                'Wait for the document to finish loading completely.',
                'Click once inside the main document body.',
                'Press Resume when the recovery confidence looks good.'
            ],
            note: 'WriterDrip checks the same document, editor surface, and typing context again before it resumes a paused run.'
        };
    }

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

function renderCorrectionPreviewMarkup(modes) {
    if (!modes?.length) {
        return '';
    }

    return modes.map((mode) => {
        const isSelected = mode.id === normalizeCorrectionIntensity(selectedCorrectionIntensity);
        const title = `${isSelected ? 'Selected' : 'Preview'}: ${mode.label}${mode.id === 'suggested' ? ` (${mode.adaptiveLabel || 'Adaptive'})` : ''}`;
        const detail = [
            `${mode.estimatedRepairs} estimated repairs`,
            `${mode.delayedRepairs} delayed`,
            `${mode.pauseMoments} pause points`,
            mode.wordLevelRepairs ? `${mode.wordLevelRepairs} word-level` : '',
            mode.punctuationRepairs ? `${mode.punctuationRepairs} punctuation` : '',
            mode.spacingRepairs ? `${mode.spacingRepairs} spacing` : '',
            mode.pacingBehavior
        ].filter(Boolean).join(' • ');

        return `
            <div class="check-item" data-pass="true">
              <div class="item-title">${escapeHtml(title)}</div>
              <div class="item-copy">${escapeHtml(detail)}</div>
            </div>
        `;
    }).join('');
}

function buildRunSummarySentence(summary) {
    const planned = formatDuration(summary.plannedDurationMins);
    const elapsed = formatElapsedSeconds(summary.elapsedSeconds);
    const correctionLabel = summary.correctionsUsed === 1 ? '1 correction' : `${summary.correctionsUsed} corrections`;
    const delayedLabel = summary.delayedRepairs === 1 ? '1 delayed repair' : `${summary.delayedRepairs} delayed repairs`;
    const pauseLabel = summary.pauseMoments === 1 ? '1 pause point' : `${summary.pauseMoments} pause points`;
    const checkLabel = summary.completionCheckPassed === false ? 'completion check needs review' : 'completion check passed';
    return `Finished ${summary.wordCount} words with ${correctionLabel}, ${delayedLabel}, and ${pauseLabel}. Planned ${planned}; elapsed about ${elapsed}. ${checkLabel}.`;
}

function buildRunSummaryItems(summary) {
    return [
        {
            label: 'Duration used',
            pass: true,
            detail: `Planned ${formatDuration(summary.plannedDurationMins)}; elapsed about ${formatElapsedSeconds(summary.elapsedSeconds)}.`
        },
        {
            label: 'Corrections delivered',
            pass: true,
            detail: `${summary.correctionsUsed} repair sequences, ${summary.correctionBackspaces} backspaces, ${summary.repairSlipOutputs} repair slips.`
        },
        {
            label: 'Delayed repairs',
            pass: true,
            detail: `${summary.delayedRepairs} repairs were carried forward before cleanup.`
        },
        {
            label: 'Pauses and interruptions',
            pass: true,
            detail: `${summary.pauseMoments} planned pause moments, ${summary.userPauses} user pauses, ${summary.interruptions} interruptions.`
        },
        {
            label: 'Timer drift protection',
            pass: true,
            detail: summary.timerDriftAdjustments > 0
                ? `${summary.timerDriftAdjustments} pacing adjustments preserved the timeline after browser throttling or sleep, adding about ${formatElapsedSeconds(summary.delayedBySeconds)} instead of catching up in a burst.`
                : 'No browser sleep or timer-throttling adjustments were needed.'
        },
        {
            label: 'Completion check',
            pass: summary.completionCheckPassed !== false,
            detail: summary.completionCheckPassed === false
                ? 'The final local editor check asked for review.'
                : 'The final local editor check passed or did not report a failure.'
        }
    ];
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
    const duration = readDurationInputValue(NaN);
    presetButtons.forEach((button) => {
        button.dataset.selected = String(Number(button.dataset.duration) === duration);
    });
}

async function withUiBusy(task) {
    if (uiBusy) {
        return;
    }

    uiBusy = true;
    syncButtons();
    renderDebugActions();
    try {
        await task();
    } finally {
        uiBusy = false;
        syncButtons();
        renderDebugActions();
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

function formatElapsedSeconds(secondsValue) {
    const seconds = Math.max(0, Math.round(Number(secondsValue) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secondsRemainder = seconds % 60;

    if (hours > 0) {
        return `${hours} hr ${minutes} min`;
    }
    if (minutes > 0) {
        return `${minutes} min ${secondsRemainder} sec`;
    }
    return `${secondsRemainder} sec`;
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

function getLocalInputIssueCode(draftAnalysis = getDraftAnalysis()) {
    const durationValue = readDurationInputValue(NaN);

    if (!currentTabId || currentPageKind === PAGE_KINDS.MISSING) {
        return 'no-active-tab';
    }
    if (currentPageKind !== PAGE_KINDS.GOOGLE_DOC) {
        return 'unsupported-page';
    }
    if (draftAnalysis?.trimmed && (
        !Number.isFinite(durationValue) ||
        durationValue < draftAnalysis.minimumDurationMins ||
        durationValue > MAX_DURATION_MINS
    )) {
        return 'invalid-job';
    }
    return null;
}

function buildPopupDebugContext() {
    const draftAnalysis = getDraftAnalysis();
    const issueCode = sessionState.lastErrorCode ||
        sessionState.attentionCode ||
        preflightState.report?.code ||
        resumeConfidenceState.report?.code ||
        getLocalInputIssueCode(draftAnalysis) ||
        null;

    return {
        pageKind: currentPageKind,
        selectedCorrectionIntensity: normalizeCorrectionIntensity(selectedCorrectionIntensity),
        durationValue: readDurationInputValue(null),
        issueCode,
        keepAwakeEnabled: Boolean(keepAwakeEnabled),
        draft: {
            hasDraft: Boolean(draftAnalysis.trimmed),
            wordCount: draftAnalysis.wordCount,
            charCount: draftAnalysis.charCount,
            minimumDurationMins: draftAnalysis.minimumDurationMins,
            recommendedDurationMins: draftAnalysis.recommendedDurationMins
        },
        preflight: preflightState.report ? {
            ready: Boolean(preflightState.report.ready),
            code: preflightState.report.code || null,
            checks: preflightState.report.checks || []
        } : null,
        resume: resumeConfidenceState.report ? {
            canResume: Boolean(resumeConfidenceState.report.canResume),
            confidence: resumeConfidenceState.report.confidence || null,
            code: resumeConfidenceState.report.code || null,
            checks: resumeConfidenceState.report.checks || []
        } : null
    };
}

function buildLocalDebugReport(popupContext = buildPopupDebugContext()) {
    const manifest = getExtensionManifest();
    const draftSummary = popupContext?.draft || {};
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        extension: {
            name: manifest.name || 'WriterDrip',
            version: manifest.version || 'unknown',
            manifestVersion: manifest.manifest_version || 3
        },
        browser: {
            family: parseBrowserFamily(globalThis.navigator?.userAgent || ''),
            version: parseBrowserVersion(globalThis.navigator?.userAgent || '')
        },
        tab: {
            idPresent: Boolean(currentTabId),
            urlKind: currentPageKind,
            docStatus: {
                currentDocPresent: currentPageKind === PAGE_KINDS.GOOGLE_DOC,
                expectedDocPresent: Boolean(sessionState.activeJob?.docKey),
                sameAsActiveJob: sessionState.activeJob?.docKey
                    ? extractGoogleDocKey(currentTabUrl) === sessionState.activeJob.docKey
                    : null
            }
        },
        session: {
            state: sessionState.state,
            progress: sessionState.progress,
            eta: sessionState.eta,
            hasActiveJob: Boolean(sessionState.activeJob),
            issueCode: normalizeIssueCodeForDebug(popupContext.issueCode),
            keepAwakeEnabled: Boolean(keepAwakeEnabled),
            keepAwakeRequested: Boolean(sessionState.keepAwakeRequested),
            lastCompleted: {
                hasJob: Boolean(sessionState.lastCompletedJob),
                completionPassed: typeof sessionState.lastCompletedVerification?.verified === 'boolean'
                    ? sessionState.lastCompletedVerification.verified
                    : null,
                hasRunSummary: Boolean(sessionState.lastRunSummary)
            },
            lastRunSummary: normalizeUiRunSummary(sessionState.lastRunSummary)
        },
        popup: {
            pageKind: normalizePageKindForDebug(popupContext.pageKind),
            selectedCorrectionIntensity: popupContext.selectedCorrectionIntensity,
            durationValue: popupContext.durationValue,
            issueCode: normalizeIssueCodeForDebug(popupContext.issueCode),
            keepAwakeEnabled: Boolean(popupContext.keepAwakeEnabled),
            draft: {
                hasDraft: Boolean(draftSummary.hasDraft),
                wordCount: Math.max(0, Number(draftSummary.wordCount) || 0),
                charCount: Math.max(0, Number(draftSummary.charCount) || 0),
                minimumDurationMins: Math.max(0, Number(draftSummary.minimumDurationMins) || 0),
                recommendedDurationMins: Math.max(0, Number(draftSummary.recommendedDurationMins) || 0)
            },
            preflight: summarizePopupDiagnosticReport(popupContext.preflight),
            resume: summarizePopupDiagnosticReport(popupContext.resume)
        }
    };
}

function summarizePopupDiagnosticReport(report) {
    if (!report) {
        return null;
    }

    return {
        ready: typeof report.ready === 'boolean' ? report.ready : null,
        canResume: typeof report.canResume === 'boolean' ? report.canResume : null,
        confidence: report.confidence || null,
        code: normalizeIssueCodeForDebug(report.code),
        checkCount: Array.isArray(report.checks) ? report.checks.length : 0,
        failedCheckIds: Array.isArray(report.checks)
            ? report.checks.filter((check) => !check.pass).map((check) => sanitizeDebugToken(check.id, 'check')).filter(Boolean)
            : []
    };
}

function normalizeIssueCodeForDebug(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    return Object.prototype.hasOwnProperty.call(ISSUE_COPY, normalized)
        ? normalized
        : 'runtime-error';
}

function normalizePageKindForDebug(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.values(PAGE_KINDS).includes(normalized) ? normalized : null;
}

function sanitizeDebugToken(value, fallbackPrefix) {
    const normalized = String(value || '').trim().toLowerCase();
    if (/^[a-z0-9-]{1,48}$/.test(normalized)) {
        return normalized;
    }
    return normalized ? `${fallbackPrefix}-redacted` : '';
}

function getExtensionManifest() {
    try {
        return chrome.runtime?.getManifest?.() || {};
    } catch (_error) {
        return {};
    }
}

function parseBrowserVersion(userAgent) {
    const value = String(userAgent || '');
    const match = value.match(/\b(Edg|Chrome|Chromium|Firefox|Version)\/([\d.]+)/);
    if (!match) {
        return 'unknown';
    }
    return `${match[1]} ${match[2]}`;
}

function parseBrowserFamily(userAgent) {
    const version = parseBrowserVersion(userAgent);
    if (version === 'unknown') {
        return 'unknown';
    }
    return version.split(' ')[0] || 'unknown';
}

function syncMinimumDuration(forceAdjust = false) {
    const minimumDuration = getDraftAnalysis().minimumDurationMins;
    durationInput.min = String(minimumDuration);

    const currentDuration = readDurationInputValue(NaN);
    if (forceAdjust || !Number.isFinite(currentDuration) || currentDuration < minimumDuration) {
        durationInput.value = String(minimumDuration);
    }
}

function updateCorrectionUi() {
    const draftAnalysis = getDraftAnalysis();
    const normalizedSelection = normalizeCorrectionIntensity(selectedCorrectionIntensity);
    const hasDraft = Boolean(draftAnalysis.trimmed);
    const suggestedIntensity = hasDraft ? draftAnalysis.suggestedCorrectionIntensity : 'medium';
    const suggestedLabel = hasDraft ? (draftAnalysis.suggestedCorrectionLabel || formatCorrectionIntensity(suggestedIntensity)) : 'Balanced';
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
        correctionMeta.innerText = `Suggested: ${suggestedLabel}`;
        correctionHint.innerText = buildSuggestedCorrectionHint(draftAnalysis, effectiveIntensity, suggestedLabel);
        return;
    }

    correctionMeta.innerText = `Using ${formatCorrectionIntensity(effectiveIntensity)}`;
    correctionHint.innerText = `${buildCorrectionModeDescription(effectiveIntensity)} Suggested for this draft: ${suggestedLabel}. ${draftAnalysis.suggestedCorrectionReason || ''}`.trim();
}

function buildSuggestedCorrectionHint(draftAnalysis, intensity, suggestedLabel) {
    if (draftAnalysis?.suggestedCorrectionReason) {
        const score = Number.isFinite(draftAnalysis?.suggestedCorrectionNormalizedScore)
            ? `${Math.round(draftAnalysis.suggestedCorrectionNormalizedScore * 100)} / 100`
            : null;
        return `${draftAnalysis.suggestedCorrectionReason}${score ? ` Current adaptive profile: ${suggestedLabel} (${score}).` : ''}`;
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
        return 'Low keeps corrections rare, fast to repair, and mostly surface-level.';
    }
    if (intensity === 'high') {
        return 'High allows more frequent correction sequences, deeper backtracking, and stronger wording or punctuation slips when the draft can support them.';
    }
    return 'Medium keeps corrections noticeable, balanced, and more varied without pushing into the heaviest repair behavior.';
}

function syncKeepAwakeUi() {
    keepAwakeToggle.checked = Boolean(keepAwakeEnabled);
    keepAwakeHint.innerText = keepAwakeEnabled
        ? 'Recommended for longer runs. WriterDrip asks Chrome to prevent system sleep only while a drip is actively running.'
        : 'Keep-awake is off. Your normal battery or sleep settings can pause the run if the computer sleeps.';
}

function formatRecommendedDuration(draftAnalysis) {
    const minutes = draftAnalysis?.recommendedDurationMins || draftAnalysis?.minimumDurationMins || 0;
    const requestedIntensity = normalizeCorrectionIntensity(draftAnalysis?.requestedCorrectionIntensity);
    if (requestedIntensity === 'suggested') {
        return `${formatDuration(minutes)} for ${draftAnalysis?.suggestedCorrectionLabel || 'Adaptive'}`;
    }

    const intensity = draftAnalysis?.recommendedDurationIntensity || draftAnalysis?.suggestedCorrectionIntensity || 'medium';
    return `${formatDuration(minutes)} for ${formatCorrectionIntensity(intensity)}`;
}

function buildDurationMetaLabel(draftAnalysis, minimumDuration) {
    const recommended = draftAnalysis?.recommendedDurationMins || minimumDuration;
    const requestedIntensity = normalizeCorrectionIntensity(draftAnalysis?.requestedCorrectionIntensity);
    if (requestedIntensity === 'suggested') {
        return `${draftAnalysis?.suggestedCorrectionLabel || 'Adaptive'} rec. ${formatDurationShort(recommended)}`;
    }

    return `${formatCorrectionIntensity(draftAnalysis?.recommendedDurationIntensity || draftAnalysis?.suggestedCorrectionIntensity)} rec. ${formatDurationShort(recommended)}`;
}

function formatCorrectionIntensity(value) {
    const normalized = normalizeCorrectionIntensity(value);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getDraftAnalysis(text = inputText.value, durationMins = readDurationInputValue(NaN)) {
    return analyzeDraftText(text, {
        durationMins,
        correctionIntensity: selectedCorrectionIntensity
    });
}

function readDurationInputValue(fallback = null) {
    const rawValue = String(durationInput.value || '').trim();
    if (!rawValue) {
        return fallback;
    }

    const numeric = Number(rawValue);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDurationFieldValue(options = {}) {
    const draftAnalysis = getDraftAnalysis(inputText.value, readDurationInputValue(NaN));
    const normalized = normalizeDurationMins(durationInput.value, options.clampToMinimum === false ? MIN_DURATION_MINS : draftAnalysis.minimumDurationMins);
    if (normalized === null) {
        return null;
    }

    if (String(normalized) !== String(durationInput.value)) {
        durationInput.value = String(normalized);
    }
    return normalized;
}

function normalizeUiRunSummary(rawSummary) {
    if (!rawSummary || typeof rawSummary !== 'object') {
        return null;
    }

    return {
        schemaVersion: Math.max(1, Number(rawSummary.schemaVersion) || 1),
        runId: rawSummary.runId || null,
        jobId: rawSummary.jobId || null,
        completedAt: Math.max(0, Number(rawSummary.completedAt) || 0),
        plannedDurationMins: Math.max(0, Number(rawSummary.plannedDurationMins) || 0),
        elapsedSeconds: Math.max(0, Number(rawSummary.elapsedSeconds) || 0),
        wordCount: Math.max(0, Number(rawSummary.wordCount) || 0),
        charCount: Math.max(0, Number(rawSummary.charCount) || 0),
        correctionIntensity: normalizeCorrectionIntensity(rawSummary.correctionIntensity),
        correctionsUsed: Math.max(0, Number(rawSummary.correctionsUsed) || 0),
        delayedRepairs: Math.max(0, Number(rawSummary.delayedRepairs) || 0),
        pauseMoments: Math.max(0, Number(rawSummary.pauseMoments) || 0),
        userPauses: Math.max(0, Number(rawSummary.userPauses) || 0),
        interruptions: Math.max(0, Number(rawSummary.interruptions) || 0),
        correctionBackspaces: Math.max(0, Number(rawSummary.correctionBackspaces) || 0),
        wordLevelRepairs: Math.max(0, Number(rawSummary.wordLevelRepairs) || 0),
        punctuationRepairs: Math.max(0, Number(rawSummary.punctuationRepairs) || 0),
        spacingRepairs: Math.max(0, Number(rawSummary.spacingRepairs) || 0),
        repairSlipOutputs: Math.max(0, Number(rawSummary.repairSlipOutputs) || 0),
        timerDriftAdjustments: Math.max(0, Number(rawSummary.timerDriftAdjustments) || 0),
        delayedBySeconds: Math.max(0, Number(rawSummary.delayedBySeconds) || 0),
        totalActions: Math.max(0, Number(rawSummary.totalActions) || 0),
        deliveredActions: Math.max(0, Number(rawSummary.deliveredActions) || 0),
        completionCheckPassed: typeof rawSummary.completionCheckPassed === 'boolean'
            ? rawSummary.completionCheckPassed
            : null
    };
}

function normalizePauseReason(rawReason) {
    if (!rawReason || typeof rawReason !== 'object') {
        return null;
    }

    const code = String(rawReason.code || 'manual-pause').trim().toLowerCase();
    return {
        code: /^[a-z0-9-]{1,48}$/.test(code) ? code : 'manual-pause',
        message: String(rawReason.message || 'Paused.').slice(0, 240)
    };
}

function isSafetyPause(reason) {
    return Boolean(reason?.code && reason.code !== 'manual-pause');
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
    if (lower.includes('another editable field has focus') || lower.includes('visible google docs page surface') || lower.includes('selected text')) {
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

    try {
        await chrome.storage.local.set({
            [`dripText_${currentTabId}`]: inputText.value,
            [`dripDuration_${currentTabId}`]: durationInput.value,
            [`dripCorrectionIntensity_${currentTabId}`]: normalizeCorrectionIntensity(selectedCorrectionIntensity)
        });
    } catch (error) {
        console.warn('[WriterDrip] Could not save the current draft locally.', error);
        setStatus({
            title: 'Draft could not be saved locally',
            message: 'Chrome rejected the local save, usually because extension storage is full.',
            hint: 'Shorten the draft, clear the old draft, or reload the extension before starting a long run.',
            tone: 'warn'
        });
    }
}

async function saveKeepAwakePreference() {
    await chrome.storage.local.set({
        [KEEP_AWAKE_ENABLED_KEY]: Boolean(keepAwakeEnabled)
    });

    try {
        await sendBackgroundMessage('ui:sync-settings', {});
    } catch (error) {
        console.warn('[WriterDrip] Keep-awake setting will sync when the background worker wakes.', error);
    }
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
    shouldUseCompatibilityPreflight,
    normalizeResumeConfidenceReport,
    formatRecoveryConfidence,
    canResumeAttentionState,
    shouldBlockResumeButton,
    buildRecoveryWizard,
    buildLocalDebugReport,
    summarizePopupDiagnosticReport,
    readDurationInputValue,
    getLocalInputIssueCode,
    normalizeUiRunSummary,
    normalizePauseReason,
    isSafetyPause
};
