/*
 * SPDX-License-Identifier: MIT
 * WriterDrip source attribution
 * Copyright (c) 2026 WriterDrip contributors
 * If you reuse substantial parts of this project, please keep credit to:
 * https://github.com/Highdrys01/WriterDrip
 */

const WRITERDRIP_RUNNER_VERSION = '2026.04.08.1';
if (globalThis.__writerdripRunnerController?.version !== WRITERDRIP_RUNNER_VERSION) {
    try {
        globalThis.__writerdripRunnerController?.dispose?.();
    } catch (error) {
        console.warn('[WriterDrip] Failed to dispose the previous runner controller.', error);
    }

    globalThis.__writerdripRunnerLoaded = true;
    globalThis.__writerdripRunnerVersion = WRITERDRIP_RUNNER_VERSION;
    const DOC_PATH_PATTERN = /^\/document\/d\/([^/]+)/;

    const RUNNER_STATES = {
        IDLE: 'idle',
        RUNNING: 'running',
        PAUSED: 'paused',
        COMPLETE: 'complete',
        ERROR: 'error'
    };

    const ISSUE_CODES = {
        ACTIVE_RUN_EXISTS: 'active-run-exists',
        EDITOR_AUTO_EDIT: 'editor-auto-edit',
        EDITOR_FOCUS_FAILED: 'editor-focus-failed',
        EDITOR_NOT_READY: 'editor-not-ready',
        INVALID_JOB: 'invalid-job',
        MANUAL_INTERACTION: 'manual-interaction',
        NO_ACTIVE_RUN: 'no-active-run',
        PAGE_CHANGED: 'page-changed',
        RUNTIME_ERROR: 'runtime-error',
        TYPING_CONTEXT_LOST: 'typing-context-lost',
        UNSUPPORTED_PAGE: 'unsupported-page',
        WRONG_DOC: 'wrong-doc'
    };

    const Shared = globalThis.WriterDripShared;
    if (!Shared) {
        throw new Error('[WriterDrip] shared.js must load before content.js.');
    }

    const {
        normalizeCorrectionIntensity,
        sanitizeDraftText,
        analyzeDraftText,
        normalizeDurationMins
    } = Shared;

    const PROFILE = {
        mistakeChance: 0.008,
        transpositionChance: 0.18,
        doubleTapChance: 0.1,
        casingErrorChance: 0.08,
        omissionChance: 0.14,
        cooldownChars: 100
    };
    const CONNECTIVE_PAUSE_WORDS = new Set([
        'although',
        'because',
        'besides',
        'finally',
        'however',
        'instead',
        'meanwhile',
        'otherwise',
        'overall',
        'perhaps',
        'rather',
        'still',
        'therefore',
        'though',
        'while'
    ]);
    const VOWEL_SLIP_MAP = Object.freeze({
        a: 'eo',
        e: 'ai',
        i: 'ou',
        o: 'iu',
        u: 'io'
    });
    const SOFT_SLIP_MAP = Object.freeze({
        c: 'sx',
        d: 'sf',
        g: 'fh',
        l: 'ko',
        m: 'n',
        n: 'm',
        p: 'o',
        r: 'et',
        t: 'ry',
        y: 'tu'
    });
    const WORD_VARIANT_MAP = createWordVariantMap([
        ['accept', 'except'],
        ['advice', 'advise'],
        ['affect', 'effect'],
        ['aisle', 'isle'],
        ['allowed', 'aloud'],
        ['alter', 'altar'],
        ['bail', 'bale'],
        ['bare', 'bear'],
        ['berry', 'bury'],
        ['board', 'bored'],
        ['born', 'borne'],
        ['brake', 'break'],
        ['breath', 'breathe'],
        ['bridal', 'bridle'],
        ['capital', 'capitol'],
        ['cell', 'sell'],
        ['ceiling', 'sealing'],
        ['cent', 'scent'],
        ['cite', 'site'],
        ['clause', 'claws'],
        ['coarse', 'course'],
        ['complement', 'compliment'],
        ['council', 'counsel'],
        ['creak', 'creek'],
        ['dear', 'deer'],
        ['descent', 'dissent'],
        ['desert', 'dessert'],
        ['device', 'devise'],
        ['discreet', 'discrete'],
        ['dual', 'duel'],
        ['elicit', 'illicit'],
        ['eminent', 'imminent'],
        ['ensure', 'insure'],
        ['fare', 'fair'],
        ['farther', 'further'],
        ['flea', 'flee'],
        ['form', 'from'],
        ['forth', 'fourth'],
        ['grate', 'great'],
        ['groan', 'grown'],
        ['hanger', 'hangar'],
        ['heard', 'herd'],
        ['heel', 'heal'],
        ['here', 'hear'],
        ['idle', 'idol'],
        ['knew', 'new'],
        ['knight', 'night'],
        ['leak', 'leek'],
        ['lesson', 'lessen'],
        ['loan', 'lone'],
        ['lose', 'loose'],
        ['made', 'maid'],
        ['mail', 'male'],
        ['main', 'mane'],
        ['meat', 'meet'],
        ['medal', 'metal'],
        ['moral', 'morale'],
        ['muscle', 'mussel'],
        ['naval', 'navel'],
        ['peace', 'piece'],
        ['peak', 'peek'],
        ['phase', 'faze'],
        ['plain', 'plane'],
        ['pore', 'pour'],
        ['practice', 'practise'],
        ['pray', 'prey'],
        ['precede', 'proceed'],
        ['principal', 'principle'],
        ['profit', 'prophet'],
        ['quite', 'quiet'],
        ['rain', 'reign'],
        ['right', 'write'],
        ['role', 'roll'],
        ['scene', 'seen'],
        ['serial', 'cereal'],
        ['sheer', 'shear'],
        ['slay', 'sleigh'],
        ['soar', 'sore'],
        ['sole', 'soul'],
        ['stair', 'stare'],
        ['stake', 'steak'],
        ['stationary', 'stationery'],
        ['steel', 'steal'],
        ['suite', 'sweet'],
        ['tail', 'tale'],
        ['than', 'then'],
        ['their', 'there'],
        ['throne', 'thrown'],
        ['trail', 'trial'],
        ['vain', 'vein'],
        ['vale', 'veil'],
        ['waist', 'waste'],
        ['wail', 'whale'],
        ['wait', 'weight'],
        ['waive', 'wave'],
        ['weak', 'week'],
        ['weather', 'whether'],
        ['were', 'where'],
        ['which', 'witch'],
        ['whole', 'hole'],
        ['wood', 'would'],
        ['yoke', 'yolk']
    ]);

    function createWordVariantMap(pairs) {
        const map = Object.create(null);
        for (const pair of pairs) {
            if (!Array.isArray(pair) || pair.length !== 2) {
                continue;
            }

            const [left, right] = pair;
            if (!left || !right || left === right) {
                continue;
            }

            map[left] = right;
            map[right] = left;
        }
        return map;
    }
    const CORRECTION_MODIFIERS = {
        low: {
            chanceScale: 0.42,
            budgetScale: 0.54,
            budgetOffset: -0.15,
            cooldownScale: 1.34,
            immediateRepairOffset: 0.11,
            wordBoundaryOffset: 0.1,
            repairDepthScale: 0.78,
            noticePauseScale: 0.92,
            realignPauseScale: 0.92,
            transpositionScale: 0.76,
            doubleTapScale: 0.74,
            casingScale: 0.72,
            omissionScale: 0.64,
            spacingScale: 1.24,
            segmentBias: -1,
            sentenceAllowanceBonus: 0,
            wordVariantScale: 0,
            maxWordVariantScale: 0,
            variantMinWordCount: 999,
            variantMinChars: 99999,
            keyboardSlipScale: 0.82,
            vowelSlipScale: 0.44,
            softSlipScale: 0.22,
            guaranteedMinChars: 420,
            repairAfterExtraScale: 0.68,
            repairHardExtraScale: 0.72,
            wordVariantDelayScale: 0.78
        },
        medium: {
            chanceScale: 1,
            budgetScale: 1,
            budgetOffset: 0,
            cooldownScale: 1,
            immediateRepairOffset: 0.01,
            wordBoundaryOffset: 0.02,
            repairDepthScale: 0.98,
            noticePauseScale: 1,
            realignPauseScale: 1,
            transpositionScale: 1,
            doubleTapScale: 1,
            casingScale: 1,
            omissionScale: 1,
            spacingScale: 1,
            segmentBias: 0,
            sentenceAllowanceBonus: 0,
            wordVariantScale: 0.55,
            maxWordVariantScale: 1,
            variantMinWordCount: 70,
            variantMinChars: 1100,
            keyboardSlipScale: 1,
            vowelSlipScale: 0.92,
            softSlipScale: 0.55,
            guaranteedMinChars: 180,
            repairAfterExtraScale: 1,
            repairHardExtraScale: 1,
            wordVariantDelayScale: 1
        },
        high: {
            chanceScale: 1.92,
            budgetScale: 1.68,
            budgetOffset: 0.85,
            cooldownScale: 0.7,
            immediateRepairOffset: -0.09,
            wordBoundaryOffset: -0.08,
            repairDepthScale: 1.34,
            noticePauseScale: 1.18,
            realignPauseScale: 1.12,
            transpositionScale: 1.22,
            doubleTapScale: 1.18,
            casingScale: 1.18,
            omissionScale: 1.28,
            spacingScale: 0.76,
            segmentBias: 1,
            sentenceAllowanceBonus: 1,
            wordVariantScale: 1.4,
            maxWordVariantScale: 1.8,
            variantMinWordCount: 24,
            variantMinChars: 260,
            keyboardSlipScale: 1.14,
            vowelSlipScale: 1.42,
            softSlipScale: 1.05,
            guaranteedMinChars: 95,
            repairAfterExtraScale: 1.32,
            repairHardExtraScale: 1.38,
            wordVariantDelayScale: 1.26
        }
    };

    let runner = createIdleRunner();

    const runtimeMessageListener = (message, sender, sendResponse) => {
        if (!message?.type) {
            return false;
        }

        handleRunnerMessage(message)
            .then((response) => sendResponse(response))
            .catch((error) => {
                console.error('[WriterDrip] Runner message failed.', error);
                sendResponse(buildRunnerError(ISSUE_CODES.RUNTIME_ERROR, error.message || 'Unknown runner error.'));
            });

        return true;
    };
    chrome.runtime.onMessage.addListener(runtimeMessageListener);

    const pageHideListener = () => {
        if (runner.runId && (runner.state === RUNNER_STATES.RUNNING || runner.state === RUNNER_STATES.PAUSED)) {
            void notifyBackground('runner:error', {
                runId: runner.runId,
                code: ISSUE_CODES.PAGE_CHANGED,
                message: 'The page changed while a drip was active.'
            });
        }
    };
    window.addEventListener('pagehide', pageHideListener);

    const interferenceEvents = [
        'keydown',
        'beforeinput',
        'input',
        'compositionstart',
        'mousedown',
        'touchstart',
        'paste'
    ];
    for (const eventName of interferenceEvents) {
        document.addEventListener(eventName, handleTrustedUserInterference, true);
    }

    async function handleRunnerMessage(message) {
        switch (message.type) {
            case 'writerdrip:start-job':
                return startOrRestoreJob(message);
            case 'writerdrip:probe-editor':
                return probeEditor(message.expectedDocKey);
            case 'writerdrip:pause-job':
                return pauseJob(message.runId);
            case 'writerdrip:resume-job':
                return resumeJob(message.runId);
            case 'writerdrip:stop-job':
                return stopJob(message.runId);
            case 'writerdrip:query-status':
                return {
                    status: 'ok',
                    runtime: buildRuntimePayload()
                };
            default:
                return {
                    ...buildRunnerError(ISSUE_CODES.RUNTIME_ERROR, `Unknown runner message: ${message.type}`)
                };
        }
    }

    async function startOrRestoreJob(message) {
        const job = normalizeJob(message.job);
        if (!job) {
            return buildRunnerError(ISSUE_CODES.INVALID_JOB, 'The requested drip is missing text or duration.');
        }

        if (!isSupportedGoogleDocPage()) {
            return buildRunnerError(ISSUE_CODES.UNSUPPORTED_PAGE, 'WriterDrip only runs on Google Docs documents.');
        }

        if (job.docKey && getCurrentDocKey() !== job.docKey) {
            return buildRunnerError(ISSUE_CODES.WRONG_DOC, 'This tab is no longer on the same Google Doc.');
        }

        if (runner.runId === message.runId && runner.state !== RUNNER_STATES.IDLE && runner.state !== RUNNER_STATES.ERROR) {
            return {
                status: 'ok',
                runtime: buildRuntimePayload()
            };
        }

        if (runner.runId && runner.runId !== message.runId && (runner.state === RUNNER_STATES.RUNNING || runner.state === RUNNER_STATES.PAUSED)) {
            return buildRunnerError(ISSUE_CODES.ACTIVE_RUN_EXISTS, 'Another drip is already active in this tab.');
        }

        const target = await locateTargetWithRetries();
        if (!target) {
            return buildRunnerError(ISSUE_CODES.EDITOR_NOT_READY, 'WriterDrip could not attach to the Google Docs editor. Click inside the document body, then try again.');
        }

        const actions = buildActionPlan(job.text, job.durationMins * 60, job.seed, job.correctionIntensity);
        const completedIndex = clamp(Math.floor(message.checkpointActionIndex || 0), 0, actions.length);
        const elapsedSeconds = sumActionDelays(actions, completedIndex);

        runner = {
            runId: message.runId,
            job,
            state: RUNNER_STATES.RUNNING,
            actions,
            cumulativeDelays: buildCumulativeDelays(actions),
            totalSeconds: 0,
            completedIndex,
            elapsedSeconds,
            timelineOriginMs: 0,
            stopRequested: false,
            paused: false,
            pauseStartedAtMs: 0,
            lockedElement: target,
            lastCompletionVerification: null,
            lastReportedAt: 0,
            loopPromise: null
        };
        runner.totalSeconds = runner.cumulativeDelays[runner.cumulativeDelays.length - 1] || 0;
        runner.elapsedSeconds = runner.cumulativeDelays[runner.completedIndex] || 0;
        runner.timelineOriginMs = Date.now() - (runner.elapsedSeconds * 1000);

        const activated = await activateTarget(target);
        if (!activated) {
            return buildRunnerError(ISSUE_CODES.EDITOR_FOCUS_FAILED, 'WriterDrip could not place the cursor in the Google Docs editor.');
        }

        await sleep(140);
        reportProgress(true);

        if (runner.actions.length === runner.completedIndex) {
            await completeRun();
            return {
                status: 'ok',
                runtime: buildRuntimePayload()
            };
        }

        runner.loopPromise = runLoop(message.runId).catch(async (error) => {
            console.error('[WriterDrip] Runner loop failed.', error);
            await failRun(ISSUE_CODES.RUNTIME_ERROR, error.message || 'The editor rejected simulated typing.');
        });

        return {
            status: 'started',
            runtime: buildRuntimePayload()
        };
    }

    async function pauseJob(runId) {
        if (!matchesActiveRun(runId)) {
            return buildRunnerError(ISSUE_CODES.NO_ACTIVE_RUN, 'No matching drip is active in this tab.');
        }

        runner.paused = true;
        runner.state = RUNNER_STATES.PAUSED;
        runner.pauseStartedAtMs = Date.now();
        await reportProgress(true);
        return {
            status: 'ok',
            runtime: buildRuntimePayload()
        };
    }

    async function resumeJob(runId) {
        if (!matchesActiveRun(runId)) {
            return buildRunnerError(ISSUE_CODES.NO_ACTIVE_RUN, 'No matching drip is active in this tab.');
        }

        if (runner.pauseStartedAtMs > 0) {
            runner.timelineOriginMs += Date.now() - runner.pauseStartedAtMs;
        }

        runner.paused = false;
        runner.state = RUNNER_STATES.RUNNING;
        runner.pauseStartedAtMs = 0;
        await reportProgress(true);
        return {
            status: 'ok',
            runtime: buildRuntimePayload()
        };
    }

    async function stopJob(runId) {
        if (!matchesActiveRun(runId)) {
            return buildRunnerError(ISSUE_CODES.NO_ACTIVE_RUN, 'No matching drip is active in this tab.');
        }

        runner.stopRequested = true;
        runner.paused = false;
        runner.pauseStartedAtMs = 0;
        runner.state = RUNNER_STATES.IDLE;

        return {
            status: 'ok',
            runtime: buildRuntimePayload()
        };
    }

    async function runLoop(expectedRunId) {
        while (runner.runId === expectedRunId && runner.completedIndex < runner.actions.length) {
            if (runner.stopRequested) {
                resetRunner();
                return;
            }

            const due = await waitUntilActionDue(expectedRunId);
            if (!due) {
                resetRunner();
                return;
            }

            const targetReady = await ensureActiveTarget();
            if (!targetReady) {
                const issue = getTypingContextIssue(runner.lockedElement);
                await failRun(issue || {
                    code: ISSUE_CODES.TYPING_CONTEXT_LOST,
                    message: 'The editor target was lost. Click back into the editor and resume.'
                });
                return;
            }

            const action = runner.actions[runner.completedIndex];
            if (action.char !== null) {
                injectChar(runner.lockedElement, action.char);
            }

            runner.completedIndex += 1;
            runner.elapsedSeconds = runner.cumulativeDelays[runner.completedIndex] || runner.totalSeconds;
            await reportProgress(false);
        }

        if (runner.runId === expectedRunId && !runner.stopRequested) {
            await completeRun();
        }
    }

    async function ensureActiveTarget() {
        if (!isCurrentJobDocument(runner.job)) {
            return false;
        }

        if (isUsableTarget(runner.lockedElement) && !getTypingContextIssue(runner.lockedElement)) {
            return true;
        }

        const target = await locateTargetWithRetries(2500);
        if (!target) {
            return false;
        }

        runner.lockedElement = target;
        if (!await activateTarget(target)) {
            return false;
        }

        return !getTypingContextIssue(target);
    }

    async function waitUntilActionDue(expectedRunId) {
        while (runner.runId === expectedRunId) {
            if (runner.runId !== expectedRunId || runner.stopRequested) {
                return false;
            }

            if (runner.paused) {
                await sleep(250);
                continue;
            }

            const dueAtMs = runner.timelineOriginMs + ((runner.cumulativeDelays[runner.completedIndex] || 0) * 1000);
            const remaining = dueAtMs - Date.now();
            if (remaining <= 0) {
                return true;
            }

            await sleep(Math.min(remaining, 250));
        }

        return false;
    }

    async function completeRun() {
        const completedRunId = runner.runId;
        const payload = {
            runId: completedRunId
        };

        runner.state = RUNNER_STATES.COMPLETE;
        runner.paused = false;
        runner.pauseStartedAtMs = 0;
        runner.stopRequested = false;
        runner.completedIndex = runner.actions.length;
        runner.elapsedSeconds = runner.totalSeconds;
        await sleep(80);
        runner.lastCompletionVerification = buildCompletionVerification();
        payload.verification = runner.lastCompletionVerification;
        await reportProgress(true);
        await notifyBackground('runner:completed', payload);
    }

    async function failRun(codeOrIssue, message = null) {
        const issue = normalizeIssue(codeOrIssue, message);
        const failedRunId = runner.runId;
        runner.state = RUNNER_STATES.ERROR;
        await reportProgress(true);
        resetRunner();
        await notifyBackground('runner:error', {
            runId: failedRunId,
            code: issue.code,
            message: issue.message
        });
    }

    async function reportProgress(force) {
        if (!runner.runId) {
            return;
        }

        const now = Date.now();
        if (!force && now - runner.lastReportedAt < 1000) {
            return;
        }

        runner.lastReportedAt = now;
        await notifyBackground('runner:progress', buildProgressPayload());
    }

    function buildProgressPayload() {
        const runtime = buildRuntimePayload();
        return {
            runId: runtime.runId,
            state: runtime.state,
            percent: runtime.percent,
            eta: runtime.eta,
            actionIndex: runtime.actionIndex,
            totalActions: runtime.totalActions
        };
    }

    function buildRuntimePayload() {
        const totalActions = runner.actions?.length || 0;
        const totalSeconds = runner.totalSeconds || 0;
        const remainingSeconds = Math.max(0, totalSeconds - (runner.elapsedSeconds || 0));
        const percent = totalSeconds > 0 ? clamp((runner.elapsedSeconds || 0) / totalSeconds, 0, 1) : 0;

        return {
            runId: runner.runId,
            state: runner.paused ? RUNNER_STATES.PAUSED : runner.state,
            actionIndex: runner.completedIndex || 0,
            totalActions,
            percent,
            eta: formatClock(remainingSeconds),
            completionVerification: runner.state === RUNNER_STATES.COMPLETE
                ? runner.lastCompletionVerification || null
                : null
        };
    }

    function buildRunnerError(code, message) {
        return {
            status: 'error',
            code,
            message
        };
    }

    function normalizeIssue(codeOrIssue, message = null) {
        if (codeOrIssue && typeof codeOrIssue === 'object') {
            return {
                code: codeOrIssue.code || ISSUE_CODES.RUNTIME_ERROR,
                message: codeOrIssue.message || message || 'WriterDrip hit an unexpected problem.'
            };
        }

        if (message) {
            return {
                code: codeOrIssue || ISSUE_CODES.RUNTIME_ERROR,
                message
            };
        }

        return {
            code: ISSUE_CODES.RUNTIME_ERROR,
            message: String(codeOrIssue || 'WriterDrip hit an unexpected problem.')
        };
    }

    async function notifyBackground(command, payload) {
        try {
            await chrome.runtime.sendMessage({
                namespace: 'writerdrip',
                command,
                payload
            });
        } catch (error) {
            console.warn('[WriterDrip] Background notification failed.', error);
        }
    }

    function normalizeJob(job) {
        if (!job || typeof job.text !== 'string') {
            return null;
        }

        const text = sanitizeDraftText(job.text);
        const durationMins = normalizeDurationMins(job.durationMins, 1);
        const docKey = typeof job.docKey === 'string' && job.docKey.trim() ? job.docKey.trim() : null;
        if (!text.trim() || !docKey || !Number.isFinite(durationMins) || durationMins <= 0) {
            return null;
        }

        return {
            ...job,
            text,
            docKey,
            durationMins,
            correctionIntensity: normalizeCorrectionIntensity(job.correctionIntensity)
        };
    }

    async function locateTargetWithRetries(timeoutMs = 4000) {
        const deadline = Date.now() + timeoutMs;
        let target = null;

        while (Date.now() < deadline) {
            target = locateTarget();
            if (isUsableTarget(target)) {
                return target;
            }

            await sleep(200);
        }

        return locateTarget();
    }

    function locateTarget() {
        if (!isSupportedGoogleDocPage()) {
            return null;
        }

        return locateGoogleDocsTarget();
    }

    function locateGoogleDocsTarget() {
        const directTarget = document.querySelector('textarea.docs-texteventtarget') ||
            document.querySelector('.docs-texteventtarget');
        if (isUsableGoogleDocsTarget(directTarget)) {
            return directTarget;
        }

        const docsIframe = document.querySelector('.docs-texteventtarget-iframe');
        if (docsIframe?.contentDocument) {
            const iframeDoc = docsIframe.contentDocument;
            if (isUsableGoogleDocsTarget(iframeDoc.body) && isVisibleElement(docsIframe)) {
                return iframeDoc.body;
            }
        }
        return null;
    }

    function isUsableTarget(element) {
        return isUsableGoogleDocsTarget(element);
    }

    function isUsableGoogleDocsTarget(element) {
        if (!element || !element.ownerDocument || !isGoogleDocsTarget(element)) {
            return false;
        }

        return element.isConnected;
    }

    async function activateTarget(target) {
        if (!isUsableGoogleDocsTarget(target)) {
            return false;
        }

        const surface = locateGoogleDocsSurface();
        if (!surface) {
            return false;
        }

        dispatchMouseClick(surface);
        await sleep(60);
        focusTarget(target);
        await sleep(80);
        return waitForTargetFocus(target);
    }

    function focusTarget(target) {
        try {
            target.focus({ preventScroll: true });
        } catch (error) {
            try {
                target.focus();
            } catch (_focusError) {
                console.warn('[WriterDrip] Target focus failed.', error);
            }
        }
    }

    function locateGoogleDocsSurface() {
        const candidates = [
            document.querySelector('.kix-page-content-wrapper'),
            document.querySelector('.kix-page-paginated .kix-page'),
            document.querySelector('.kix-canvas-tile-content'),
            document.querySelector('.kix-appview-editor'),
            document.querySelector('.docs-editor'),
            document.querySelector('.kix-page-paginated')
        ];

        return candidates.find((candidate) => isVisibleElement(candidate)) || null;
    }

    function dispatchMouseClick(target) {
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }

        const x = rect.left + Math.max(6, rect.width / 2);
        const y = rect.top + Math.max(6, rect.height / 2);
        const view = target.ownerDocument?.defaultView || window;

        target.dispatchEvent(new view.MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true, composed: true }));
        target.dispatchEvent(new view.MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true, composed: true }));
        target.dispatchEvent(new view.MouseEvent('click', { clientX: x, clientY: y, bubbles: true, composed: true }));
    }

    function injectChar(target, char) {
        const doc = target.ownerDocument || document;
        const view = doc.defaultView || window;
        const googleDocs = isGoogleDocsTarget(target);

        if (char === 'backspace') {
            dispatchKeySequence(target, {
                key: 'Backspace',
                code: 'Backspace',
                keyCode: 8,
                which: 8,
                charCode: 8
            }, googleDocs ? 'deleteContentBackward' : null);

            if (!googleDocs && typeof doc.execCommand === 'function' && doc.execCommand('delete')) {
                return;
            }

            if (target.isContentEditable) {
                const selection = view.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const startContainer = range.startContainer;
                    const startOffset = range.startOffset;

                    if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
                        range.setStart(startContainer, startOffset - 1);
                        range.deleteContents();
                    }
                }
                return;
            }

            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const start = target.selectionStart;
                const end = target.selectionEnd;
                if (Number.isInteger(start) && Number.isInteger(end) && start > 0) {
                    target.value = target.value.slice(0, start - 1) + target.value.slice(end);
                    target.setSelectionRange(start - 1, start - 1);
                    target.dispatchEvent(new view.Event('input', { bubbles: true }));
                }
            }
            return;
        }

        if (char === '\n') {
            dispatchKeySequence(target, buildKeyInit(char), 'insertParagraph', '\n');

            if (googleDocs) {
                return;
            }

            if (typeof doc.execCommand === 'function' && doc.execCommand('insertLineBreak')) {
                return;
            }

            if (target.isContentEditable) {
                const selection = view.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    const lineBreak = doc.createElement('br');
                    range.insertNode(lineBreak);
                    range.setStartAfter(lineBreak);
                    range.setEndAfter(lineBreak);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
                return;
            }

            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
                const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : target.value.length;
                target.value = target.value.slice(0, start) + '\n' + target.value.slice(end);
                target.setSelectionRange(start + 1, start + 1);
                target.dispatchEvent(new view.Event('input', { bubbles: true }));
            }
            return;
        }

        dispatchKeySequence(target, buildKeyInit(char), 'insertText', char);

        if (googleDocs) {
            return;
        }

        if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, char)) {
            return;
        }

        if (target.isContentEditable) {
            const selection = view.getSelection();
            if (selection && selection.rangeCount > 0) {
                const textNode = doc.createTextNode(char);
                const range = selection.getRangeAt(0);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);
            }
            return;
        }

        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
            const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : target.value.length;
            target.value = target.value.slice(0, start) + char + target.value.slice(end);
            target.setSelectionRange(start + 1, start + 1);
            target.dispatchEvent(new view.Event('input', { bubbles: true }));
        }
    }

    function dispatchKeySequence(target, keyInit, inputType, data = null) {
        const doc = target.ownerDocument || document;
        const view = doc.defaultView || window;

        target.dispatchEvent(new view.KeyboardEvent('keydown', {
            key: keyInit.key,
            code: keyInit.code,
            keyCode: keyInit.keyCode,
            which: keyInit.which,
            charCode: keyInit.charCode,
            shiftKey: keyInit.shiftKey,
            bubbles: true,
            cancelable: true,
            composed: true,
            repeat: false
        }));

        if (keyInit.key.length === 1) {
            target.dispatchEvent(new view.KeyboardEvent('keypress', {
                key: keyInit.key,
                code: keyInit.code,
                keyCode: keyInit.keyCode,
                which: keyInit.which,
                charCode: keyInit.charCode,
                shiftKey: keyInit.shiftKey,
                bubbles: true,
                cancelable: true,
                composed: true,
                repeat: false
            }));
        }

        if (inputType && typeof view.InputEvent === 'function') {
            target.dispatchEvent(new view.InputEvent('beforeinput', {
                data,
                inputType,
                bubbles: true,
                cancelable: true,
                composed: true
            }));

            target.dispatchEvent(new view.InputEvent('input', {
                data,
                inputType,
                bubbles: true,
                composed: true
            }));
        }

        target.dispatchEvent(new view.KeyboardEvent('keyup', {
            key: keyInit.key,
            code: keyInit.code,
            keyCode: keyInit.keyCode,
            which: keyInit.which,
            charCode: keyInit.charCode,
            shiftKey: keyInit.shiftKey,
            bubbles: true,
            composed: true,
            repeat: false
        }));
    }

    async function waitForTargetFocus(target, timeoutMs = 500) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (!isUsableGoogleDocsTarget(target)) {
                return false;
            }

            if (isTargetFocused(target) && !hasConflictingEditableFocus(target) && locateGoogleDocsSurface()) {
                return true;
            }

            await sleep(50);
        }

        return isTargetFocused(target) && !hasConflictingEditableFocus(target) && Boolean(locateGoogleDocsSurface());
    }

    function handleTrustedUserInterference(event) {
        if (!event.isTrusted || !runner.runId || runner.state !== RUNNER_STATES.RUNNING || !isCurrentJobDocument(runner.job)) {
            return;
        }

        if (event.type === 'keydown' && isModifierOnlyKey(event)) {
            return;
        }

        if (event.type === 'mousedown' || event.type === 'touchstart') {
            void failRun(ISSUE_CODES.MANUAL_INTERACTION, 'Manual interaction was detected in the Google Doc tab. Click back into the document and resume when you are ready.');
            return;
        }

        if (!eventTargetsGoogleDocsEditingContext(event.target)) {
            return;
        }

        const editorIssue = getTrustedEditorChangeIssue(event);
        if (editorIssue) {
            void failRun(editorIssue);
            return;
        }

        void failRun(ISSUE_CODES.MANUAL_INTERACTION, 'Manual interaction was detected in the Google Doc. Click back into the document and resume when you are ready.');
    }

    function getTrustedEditorChangeIssue(event) {
        if (!event) {
            return null;
        }

        if ((event.type === 'beforeinput' || event.type === 'input') && isEditorAutoEditInputType(event.inputType)) {
            return {
                code: ISSUE_CODES.EDITOR_AUTO_EDIT,
                message: 'Google Docs changed or suggested text while WriterDrip was running. Turn off Smart Compose, spelling or grammar suggestions, and substitutions in Tools > Preferences, then stop and restart the drip.'
            };
        }

        return null;
    }

    function isEditorAutoEditInputType(inputType) {
        const normalized = String(inputType || '');
        if (!normalized) {
            return false;
        }

        return normalized === 'insertReplacementText' ||
            normalized === 'insertCompositionText' ||
            normalized === 'insertFromPaste' ||
            normalized === 'insertFromDrop' ||
            normalized === 'insertFromYank' ||
            normalized === 'insertTranspose' ||
            normalized.startsWith('history');
    }

    function getTypingContextIssue(target) {
        if (!isCurrentJobDocument(runner.job)) {
            return {
                code: ISSUE_CODES.WRONG_DOC,
                message: 'This tab is no longer on the same Google Doc.'
            };
        }

        if (!isUsableGoogleDocsTarget(target)) {
            return {
                code: ISSUE_CODES.EDITOR_NOT_READY,
                message: 'The Google Docs editor is no longer ready for typing.'
            };
        }

        if (!locateGoogleDocsSurface()) {
            return {
                code: ISSUE_CODES.TYPING_CONTEXT_LOST,
                message: 'WriterDrip could not find the visible Google Docs page surface.'
            };
        }

        if (hasConflictingEditableFocus(target)) {
            return {
                code: ISSUE_CODES.TYPING_CONTEXT_LOST,
                message: 'Another editable field has focus in Google Docs. Click back into the document body and resume.'
            };
        }

        return null;
    }

    function eventTargetsGoogleDocsEditingContext(target) {
        if (!target) {
            return false;
        }

        if (isGoogleDocsTarget(target) || isGoogleDocsSurfaceNode(target)) {
            return true;
        }

        if (target.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        return Boolean(target.closest?.('.kix-appview-editor, .docs-editor, .kix-page-paginated, .kix-page, .kix-page-content-wrapper, .kix-canvas-tile-content'));
    }

    function isGoogleDocsSurfaceNode(target) {
        if (!target || target.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        return target.matches?.('.kix-appview-editor, .docs-editor, .kix-page-paginated, .kix-page, .kix-page-content-wrapper, .kix-canvas-tile-content');
    }

    function isModifierOnlyKey(event) {
        return ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key);
    }

    function hasConflictingEditableFocus(target) {
        const activeEditable = getFocusedEditableElement();
        if (!activeEditable) {
            return false;
        }

        if (isEquivalentTypingTarget(activeEditable, target)) {
            return false;
        }

        if (isGoogleDocsTarget(activeEditable) && isGoogleDocsTarget(target)) {
            return false;
        }

        return true;
    }

    function getFocusedEditableElement() {
        const outerActive = getDeepActiveElement(document);
        if (isEditableElement(outerActive)) {
            return outerActive;
        }

        const docsIframe = document.querySelector('.docs-texteventtarget-iframe');
        const iframeDoc = docsIframe?.contentDocument || null;
        const iframeActive = iframeDoc ? getDeepActiveElement(iframeDoc) : null;
        if (isEditableElement(iframeActive)) {
            return iframeActive;
        }

        return null;
    }

    function getDeepActiveElement(doc) {
        if (!doc) {
            return null;
        }

        let active = doc.activeElement || null;
        const seen = new Set();

        while (active?.tagName === 'IFRAME' && active.contentDocument && !seen.has(active.contentDocument)) {
            seen.add(active.contentDocument);
            active = active.contentDocument.activeElement || active;
        }

        return active;
    }

    function isEditableElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        if (isGoogleDocsTarget(element)) {
            return true;
        }

        if (element.isContentEditable) {
            return true;
        }

        if (element.matches('textarea')) {
            return !element.disabled && !element.readOnly;
        }

        if (!element.matches('input')) {
            return false;
        }

        const nonTextTypes = new Set([
            'button',
            'checkbox',
            'color',
            'file',
            'hidden',
            'image',
            'radio',
            'range',
            'reset',
            'submit'
        ]);

        const type = (element.getAttribute('type') || 'text').toLowerCase();
        return !element.disabled && !element.readOnly && !nonTextTypes.has(type);
    }

    function isEquivalentTypingTarget(left, right) {
        if (!left || !right) {
            return false;
        }

        if (left === right) {
            return true;
        }

        if (left.ownerDocument === right.ownerDocument && left.ownerDocument?.body === left && right.ownerDocument?.body === right) {
            return true;
        }

        return Boolean(left.contains?.(right) || right.contains?.(left));
    }

    function isTargetFocused(target) {
        if (!target?.ownerDocument) {
            return false;
        }

        const ownerDoc = target.ownerDocument;
        const active = getDeepActiveElement(ownerDoc);
        if (isEquivalentTypingTarget(active, target)) {
            return true;
        }

        if (ownerDoc.body === target && active === ownerDoc.body) {
            return true;
        }

        return false;
    }

    function isGoogleDocsTarget(target) {
        if (!target || !isSupportedGoogleDocPage()) {
            return false;
        }

        if (target.matches?.('.docs-texteventtarget, textarea.docs-texteventtarget')) {
            return true;
        }

        const docsIframe = document.querySelector('.docs-texteventtarget-iframe');
        return Boolean(docsIframe?.contentDocument && target === docsIframe.contentDocument.body);
    }

    function isVisibleElement(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') {
            return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isSupportedGoogleDocPage() {
        return window.location.hostname === 'docs.google.com' && DOC_PATH_PATTERN.test(window.location.pathname);
    }

    function getCurrentDocKey() {
        return window.location.pathname.match(DOC_PATH_PATTERN)?.[1] || null;
    }

    function isCurrentJobDocument(job) {
        return Boolean(job?.docKey && getCurrentDocKey() === job.docKey);
    }

    async function probeEditor(expectedDocKey) {
        const checks = [];

        if (!isSupportedGoogleDocPage()) {
            return {
                ...buildRunnerError(ISSUE_CODES.UNSUPPORTED_PAGE, 'WriterDrip only runs on Google Docs documents.'),
                ready: false,
                checks: [
                    buildDiagnosticCheck('page', 'Google Docs page', false, 'Open a normal editable Google Docs document page.')
                ],
                note: 'WriterDrip only attaches to editable Google Docs document pages.'
            };
        }

        const currentDocKey = getCurrentDocKey();
        const sameDoc = !expectedDocKey || currentDocKey === expectedDocKey;
        checks.push(buildDiagnosticCheck(
            'doc',
            'Same Google Doc',
            sameDoc,
            sameDoc ? 'This tab is still on the intended Google Doc.' : 'Return to the original Google Doc tab before starting.'
        ));

        if (!sameDoc) {
            return {
                ...buildRunnerError(ISSUE_CODES.WRONG_DOC, 'This tab is no longer on the same Google Doc.'),
                ready: false,
                checks,
                note: 'WriterDrip binds each run to one Google Doc tab so it does not drift into the wrong document.'
            };
        }

        const target = locateGoogleDocsTarget();
        const surface = locateGoogleDocsSurface();
        const editorReady = Boolean(target && surface);
        checks.push(buildDiagnosticCheck(
            'editor',
            'Document editor detected',
            editorReady,
            editorReady ? 'WriterDrip found the Google Docs editor surface.' : 'Wait for the document body to finish loading, then click inside it once.'
        ));

        if (!editorReady) {
            return {
                ...buildRunnerError(ISSUE_CODES.EDITOR_NOT_READY, 'Open the Google Doc body, wait for it to finish loading, and try again.'),
                ready: false,
                checks,
                note: 'If Google Docs just reloaded, give it a moment before starting the drip.'
            };
        }

        const conflictingFocus = hasConflictingEditableFocus(target);
        const bodyFocused = isTargetFocused(target);
        const typingContextReady = !conflictingFocus;
        checks.push(buildDiagnosticCheck(
            'cursor',
            'Typing context ready',
            typingContextReady,
            typingContextReady
                ? (bodyFocused
                    ? 'The typing cursor is already in the document body.'
                    : 'WriterDrip can reattach the document cursor when the run starts.')
                : 'Another editable field has focus. Close it, then click back into the document body.'
        ));

        if (!typingContextReady) {
            return {
                ...buildRunnerError(ISSUE_CODES.TYPING_CONTEXT_LOST, 'Another editable field has focus in Google Docs. Click back into the document body and try again.'),
                ready: false,
                checks,
                note: 'Starting with the cursor in the main document body helps WriterDrip stay attached to the right editor target.'
            };
        }

        return {
            status: 'ok',
            ready: true,
            docKey: currentDocKey,
            checks,
            message: 'WriterDrip is ready to start in this Google Doc.',
            note: 'Start the drip from this popup, then keep the original Google Doc tab, browser, and computer available until it finishes.'
        };
    }

    function buildDiagnosticCheck(id, label, pass, detail) {
        return {
            id,
            label,
            pass: Boolean(pass),
            detail: detail || ''
        };
    }

    function buildCompletionVerification() {
        const target = locateGoogleDocsTarget() || runner.lockedElement;
        const sameDoc = isCurrentJobDocument(runner.job);
        const surfaceReady = Boolean(locateGoogleDocsSurface());
        const targetReady = Boolean(target && isUsableGoogleDocsTarget(target));
        const contextStable = Boolean(targetReady && !hasConflictingEditableFocus(target));

        const checks = [
            buildDiagnosticCheck('plan-finished', 'Action plan finished', runner.completedIndex >= runner.actions.length, 'All planned typing and correction actions were delivered.'),
            buildDiagnosticCheck('doc', 'Same Google Doc still open', sameDoc, sameDoc ? 'The tab stayed on the original Google Doc.' : 'The document changed before WriterDrip could finish its final check.'),
            buildDiagnosticCheck('surface', 'Editor surface still available', surfaceReady && targetReady, surfaceReady && targetReady ? 'The Google Docs editor was still available after the last action.' : 'The editor surface was no longer fully available after the run ended.'),
            buildDiagnosticCheck('context', 'No competing editor focus', contextStable, contextStable ? 'No other editable field was competing with the document body at the end of the run.' : 'Another editable field or transient UI may have taken focus at the end of the run.')
        ];
        const verified = checks.every((check) => check.pass);

        return {
            verified,
            summary: verified
                ? 'WriterDrip finished and the final editor check passed.'
                : 'WriterDrip finished, but the final editor check needs review.',
            note: 'This verifies the final run state that WriterDrip can observe locally. Google Docs still controls version history grouping and suggestion systems.',
            checks
        };
    }

    function buildActionPlan(text, targetDurationSeconds, seed, correctionIntensity = 'suggested') {
        const rng = createRng(seed || 1);
        const chars = Array.from(text);
        const draftProfile = buildDraftMistakeProfile(chars, targetDurationSeconds, correctionIntensity);
        const plannerState = createMistakePlannerState(chars, draftProfile);
        const actions = [];
        let typoCountdown = 0;
        let pendingFix = null;
        let mistakenChars = 0;
        let mistakeCount = 0;
        let sentenceLength = 0;
        let guaranteedMistakeIndex = findGuaranteedMistakeIndex(chars, rng, draftProfile);

        const addRepair = (currentIndex, isEndOfText = false) => {
            const noticePause = pendingFix?.noticePause ?? (0.45 + rng() * 0.35);
            actions.push({
                char: null,
                kind: 'repair-pause',
                delay: noticePause,
                distributionWeight: 1.5
            });

            for (let count = 0; count < mistakenChars; count += 1) {
                actions.push({
                    char: 'backspace',
                    kind: 'repair-backspace',
                    delay: 0.08 + rng() * 0.08,
                    distributionWeight: 0.3
                });
            }

            if (pendingFix?.realignPause && mistakenChars > 0) {
                actions.push({
                    char: null,
                    kind: 'repair-realign',
                    delay: pendingFix.realignPause,
                    distributionWeight: 1.1
                });
            }

            const rewindIndex = pendingFix?.position ?? currentIndex;
            pendingFix = null;
            mistakenChars = 0;
            return rewindIndex;
        };

        let index = 0;
        while (index < chars.length || pendingFix) {
            if (index >= chars.length) {
                index = addRepair(index, true);
                continue;
            }

            const char = chars[index];
            const progress = index / Math.max(1, chars.length - 1);
            const fatigueMultiplier = 1 + (0.35 * (index / Math.max(1, chars.length)));
            const cadenceMultiplier = getCadenceMultiplier(progress, sentenceLength, char, rng, draftProfile.cadenceProfile);
            const baseDelay = (0.07 + rng() * 0.06) * fatigueMultiplier * cadenceMultiplier;
            const distributionWeight = getDistributionWeight(char, progress, sentenceLength, draftProfile.cadenceProfile);
            const canFixAtBoundary = char === '\n' || ['.', '!', '?', ' '].includes(char);
            const wordVariantContext = getWordVariantContext(chars, index, draftProfile, plannerState);
            const mistakeContext = wordVariantContext || getMistypeContext(chars, index);
            const eligibleMistypeTarget = Boolean(mistakeContext) && mistakeCount < draftProfile.maxMistakes;
            const canScheduleHere = eligibleMistypeTarget
                ? canScheduleMistake(chars, index, mistakeContext, draftProfile, plannerState)
                : false;

            if (char === '\n') {
                sentenceLength = 0;
            } else {
                sentenceLength += 1;
            }

            const mistakeChance = eligibleMistypeTarget
                ? getMistakeChance(mistakeContext, progress, sentenceLength, fatigueMultiplier, draftProfile, mistakeCount)
                : 0;
            let shouldMistype = typoCountdown <= 0 && !pendingFix && canScheduleHere && rng() < mistakeChance;
            const shouldUseWordVariant = Boolean(wordVariantContext) &&
                typoCountdown <= 0 &&
                !pendingFix &&
                canScheduleHere &&
                rng() < getWordVariantChance(progress, draftProfile, mistakeCount);
            if (index === guaranteedMistakeIndex && !pendingFix && typoCountdown <= 0 && canScheduleHere) {
                shouldMistype = true;
                guaranteedMistakeIndex = -1;
            }

            if (shouldUseWordVariant || shouldMistype) {
                const mistakePlan = shouldUseWordVariant
                    ? planWordVariantMistake(index, rng, baseDelay, wordVariantContext, draftProfile)
                    : planMistake(chars, index, rng, baseDelay, mistakeContext, draftProfile, plannerState);
                for (const output of mistakePlan.outputs) {
                    actions.push(output);
                }
                pendingFix = mistakePlan.pendingFix;
                mistakenChars = mistakePlan.initialMistakenChars;
                typoCountdown = mistakePlan.cooldownChars;
                mistakeCount += 1;
                noteMistakeScheduled(plannerState, index, mistakeContext, mistakePlan.pendingFix.type);
                index += mistakePlan.indexAdvance || 0;
            } else {
                actions.push({
                    char,
                    delay: baseDelay,
                    distributionWeight
                });

                if (pendingFix) {
                    mistakenChars += 1;
                    const extraCharsSinceMistake = Math.max(0, mistakenChars - (pendingFix.initialMistakenChars || 0));
                    const wordBoundaryAhead = !isWordCharacter(chars[index + 1] || '');
                    if (extraCharsSinceMistake >= pendingFix.hardExtraChars ||
                        canFixAtBoundary ||
                        (pendingFix.preferWordBoundary && wordBoundaryAhead) ||
                        extraCharsSinceMistake >= pendingFix.repairAfterExtraChars) {
                        index = addRepair(index, false);
                        continue;
                    }
                }
            }

            if (typoCountdown > 0) {
                typoCountdown -= 1;
            }
            index += 1;
        }

        const pacedActions = applyCadencePlan(actions, rng, draftProfile.cadenceProfile);
        distributeDelays(pacedActions, targetDurationSeconds);
        const validation = validateActionPlan(text, draftProfile, pacedActions);
        if (validation.ok) {
            return pacedActions;
        }

        console.warn('[WriterDrip] Mistake planner validation failed. Falling back to a safe pacing plan.', validation);
        return buildSafeActionPlan(text, targetDurationSeconds, seed, draftProfile);
    }

    function buildDraftMistakeProfile(chars, targetDurationSeconds, correctionIntensity = 'suggested') {
        const text = chars.join('');
        const analysis = analyzeDraftText(text, targetDurationSeconds / 60);
        const charCount = analysis.charCount;
        const wordCount = analysis.wordCount;
        const averageWordLength = analysis.averageWordLength;
        const secondsPerChar = analysis.secondsPerChar;
        const uppercaseRatio = analysis.uppercaseRatio;
        const punctuationRatio = analysis.punctuationRatio;
        const newlineRatio = analysis.newlineRatio;
        const symbolRatio = analysis.symbolRatio;
        const looksStructured = analysis.looksStructured;
        const suggestionScore = Number.isFinite(analysis.suggestedCorrectionScore) ? analysis.suggestedCorrectionScore : 1;

        const paceFactor = clamp(0.88 + (Math.min(secondsPerChar, 6) * 0.06), 0.88, 1.24);
        const technicalGuard = clamp(1 - Math.min((symbolRatio * 3.4) + (uppercaseRatio * 0.75), 0.4), 0.62, 1);
        const proseFactor = clamp(0.93 + Math.min((punctuationRatio * 2.8) + (newlineRatio * 5), 0.2) + (averageWordLength > 4.8 ? 0.05 : 0), 0.93, 1.18);
        const requestedIntensity = normalizeCorrectionIntensity(correctionIntensity);
        const suggestedIntensity = analysis.suggestedCorrectionIntensity;
        const resolvedIntensity = requestedIntensity === 'suggested' ? suggestedIntensity : requestedIntensity;
        const intensityProfile = CORRECTION_MODIFIERS[resolvedIntensity] || CORRECTION_MODIFIERS.medium;
        const intensityScoreCenter = resolvedIntensity === 'low' ? 0.1 : resolvedIntensity === 'medium' ? 1.45 : 2.75;
        const suggestedStrengthBias = requestedIntensity === 'suggested'
            ? clamp(1 + ((suggestionScore - intensityScoreCenter) * 0.1), 0.84, 1.22)
            : 1;

        let maxMistakes = 0;
        if (charCount >= 90 && wordCount >= 18) {
            if (charCount < 240) {
                maxMistakes = 1;
            } else if (charCount < 780) {
                maxMistakes = 2;
            } else if (charCount < 1800) {
                maxMistakes = 3;
            } else {
                maxMistakes = 4;
            }

            if (paceFactor > 1.15) {
                maxMistakes += 1;
            }
            if (technicalGuard < 0.82) {
                maxMistakes -= 1;
            }
        }

        maxMistakes = Math.round((maxMistakes * intensityProfile.budgetScale * suggestedStrengthBias) + intensityProfile.budgetOffset);
        if (looksStructured) {
            maxMistakes = Math.min(maxMistakes, 1);
        }
        if (resolvedIntensity === 'high' && charCount >= 220 && wordCount >= 34) {
            maxMistakes = Math.max(maxMistakes, 2);
        }
        maxMistakes = clamp(maxMistakes, 0, resolvedIntensity === 'high' ? 6 : 5);

        const baseMistakeChance = PROFILE.mistakeChance * paceFactor * technicalGuard * proseFactor * intensityProfile.chanceScale * suggestedStrengthBias;
        const cooldownChars = Math.round(
            PROFILE.cooldownChars *
            clamp(1.08 - ((paceFactor - 1) * 0.35) + ((technicalGuard - 0.8) * 0.2), 0.68, 1.18) *
            intensityProfile.cooldownScale /
            clamp(suggestedStrengthBias, 0.82, 1.2)
        );

        const segmentCount = clamp(
            maxMistakes <= 1
                ? 1
                : Math.min(
                    resolvedIntensity === 'high' ? 5 : 4,
                    maxMistakes + (resolvedIntensity === 'high' ? 1 : 0) + (intensityProfile.segmentBias || 0)
                ),
            1,
            5
        );
        const sentenceRepeatAllowance = clamp(
            (resolvedIntensity === 'high' && charCount >= 900 ? 2 : 1) + (intensityProfile.sentenceAllowanceBonus || 0),
            1,
            3
        );
        const baseSpacing = (resolvedIntensity === 'high' ? 42 : resolvedIntensity === 'low' ? 74 : 58) *
            technicalGuard *
            clamp(1.06 - ((paceFactor - 1) * 0.2), 0.88, 1.14) *
            (intensityProfile.spacingScale || 1) /
            clamp(suggestedStrengthBias, 0.84, 1.18);
        const canUseWordVariants = !looksStructured &&
            technicalGuard > 0.82 &&
            averageWordLength > 4.1 &&
            wordCount >= (intensityProfile.variantMinWordCount || 26) &&
            charCount >= (intensityProfile.variantMinChars || 0);
        const baseWordVariantChance = canUseWordVariants
            ? ((resolvedIntensity === 'high' ? 0.18 : resolvedIntensity === 'medium' ? 0.08 : 0.02) *
                (intensityProfile.wordVariantScale || 0) *
                clamp(suggestedStrengthBias, 0.84, 1.22))
            : 0;
        const baseMaxWordVariants = canUseWordVariants
            ? (resolvedIntensity === 'high'
                ? (charCount >= 1400 ? 2 : 1)
                : (resolvedIntensity === 'medium' && charCount >= 1300 ? 1 : 0))
            : 0;

        return {
            charCount,
            wordCount,
            averageWordLength,
            secondsPerChar,
            paceFactor,
            proseFactor,
            technicalGuard,
            requestedIntensity,
            suggestedIntensity,
            resolvedIntensity,
            suggestedStrengthBias,
            looksStructured,
            baseMistakeChance,
            cooldownChars,
            maxMistakes,
            segmentCount,
            segmentBudgets: buildSegmentBudgets(segmentCount, maxMistakes),
            minMistakeSpacingChars: Math.round(clamp(baseSpacing, 22, 108)),
            edgeGuardRatio: resolvedIntensity === 'high' ? 0.05 : resolvedIntensity === 'low' ? 0.1 : 0.075,
            sentenceRepeatAllowance,
            wordVariantChance: clamp(baseWordVariantChance, 0, resolvedIntensity === 'high' ? 0.28 : resolvedIntensity === 'medium' ? 0.12 : 0.03),
            maxWordVariantMistakes: Math.round(baseMaxWordVariants * (intensityProfile.maxWordVariantScale || 1)),
            guaranteedMistakeAllowed: maxMistakes > 0 && charCount > intensityProfile.guaranteedMinChars && !looksStructured,
            transpositionChance: clamp((PROFILE.transpositionChance + (averageWordLength > 5.4 ? 0.04 : 0) - (symbolRatio * 0.2)) * intensityProfile.transpositionScale, 0.1, 0.3),
            doubleTapChance: clamp((PROFILE.doubleTapChance + (paceFactor < 0.95 ? 0.03 : 0)) * intensityProfile.doubleTapScale, 0.06, 0.18),
            casingErrorChance: clamp((PROFILE.casingErrorChance * technicalGuard * (1 - Math.min(uppercaseRatio * 0.7, 0.5))) * intensityProfile.casingScale, 0.02, 0.1),
            omissionChance: clamp((PROFILE.omissionChance * proseFactor * clamp(averageWordLength / 5.1, 0.82, 1.12)) * intensityProfile.omissionScale, 0.07, 0.24),
            keyboardSlipChance: clamp((0.22 + (averageWordLength > 4.5 ? 0.03 : 0)) * (intensityProfile.keyboardSlipScale || 1), 0.08, 0.38),
            vowelSlipChance: clamp((0.1 + (averageWordLength > 4.8 ? 0.03 : 0) + (proseFactor > 1.02 ? 0.02 : 0)) * (intensityProfile.vowelSlipScale || 1), 0.03, 0.24),
            softSlipChance: clamp((0.06 + (wordCount >= 40 ? 0.02 : 0)) * technicalGuard * (intensityProfile.softSlipScale || 1), 0.01, 0.18),
            immediateRepairChance: clamp(0.34 - ((paceFactor - 1) * 0.18) + intensityProfile.immediateRepairOffset, 0.14, 0.44),
            preferWordBoundaryChance: clamp(0.48 + ((proseFactor - 1) * 0.5) + intensityProfile.wordBoundaryOffset, 0.36, 0.72),
            repairDepthFactor: clamp((0.45 + ((paceFactor - 1) * 0.3) + ((proseFactor - 1) * 0.4)) * intensityProfile.repairDepthScale, 0.34, 0.84),
            noticePauseFactor: clamp((0.95 + ((paceFactor - 1) * 0.45)) * intensityProfile.noticePauseScale, 0.86, 1.24),
            realignPauseFactor: clamp((0.92 + ((paceFactor - 1) * 0.28)) * intensityProfile.realignPauseScale, 0.86, 1.16),
            repairAfterExtraScale: intensityProfile.repairAfterExtraScale || 1,
            repairHardExtraScale: intensityProfile.repairHardExtraScale || 1,
            wordVariantDelayScale: intensityProfile.wordVariantDelayScale || 1,
            cadenceProfile: buildCadenceProfile(analysis, targetDurationSeconds)
        };
    }

    function buildSafeActionPlan(text, targetDurationSeconds, seed, draftProfile = null) {
        const rng = createRng((seed || 1) + 17);
        const chars = Array.from(text);
        const profile = draftProfile || buildDraftMistakeProfile(chars, targetDurationSeconds);
        const actions = [];
        let sentenceLength = 0;

        for (let index = 0; index < chars.length; index += 1) {
            const char = chars[index];
            const progress = index / Math.max(1, chars.length - 1);
            const fatigueMultiplier = 1 + (0.35 * (index / Math.max(1, chars.length)));
            const cadenceMultiplier = getCadenceMultiplier(progress, sentenceLength, char, rng, profile.cadenceProfile);
            const baseDelay = (0.07 + rng() * 0.06) * fatigueMultiplier * cadenceMultiplier;
            const distributionWeight = getDistributionWeight(char, progress, sentenceLength, profile.cadenceProfile);

            actions.push({
                char,
                delay: baseDelay,
                distributionWeight
            });

            if (char === '\n') {
                sentenceLength = 0;
            } else {
                sentenceLength += 1;
            }
        }

        const pacedActions = applyCadencePlan(actions, rng, profile.cadenceProfile);
        distributeDelays(pacedActions, targetDurationSeconds);
        return pacedActions;
    }

    function validateActionPlan(text, draftProfile, actions) {
        const replayed = replayActionPlan(actions);
        if (replayed !== text) {
            return {
                ok: false,
                reason: 'replay-mismatch'
            };
        }

        const repairSequences = countRepairSequences(actions);
        if (repairSequences > draftProfile.maxMistakes) {
            return {
                ok: false,
                reason: 'repair-budget-exceeded',
                repairSequences,
                maxMistakes: draftProfile.maxMistakes
            };
        }

        return {
            ok: true
        };
    }

    function replayActionPlan(actions) {
        const output = [];
        for (const action of actions) {
            if (!action || action.char === null) {
                continue;
            }

            if (action.char === 'backspace') {
                output.pop();
                continue;
            }

            output.push(action.char);
        }

        return output.join('');
    }

    function countRepairSequences(actions) {
        let count = 0;
        for (const action of actions) {
            if (action?.kind === 'repair-pause') {
                count += 1;
            }
        }
        return count;
    }

    function buildSegmentBudgets(segmentCount, maxMistakes) {
        const budgets = Array.from({ length: segmentCount }, () => 0);
        let remaining = maxMistakes;
        let cursor = 0;
        while (remaining > 0 && budgets.length) {
            budgets[cursor % budgets.length] += 1;
            cursor += 1;
            remaining -= 1;
        }
        return budgets;
    }

    function buildCadenceProfile(analysis, targetDurationSeconds) {
        const charCount = analysis.charCount || 0;
        const relaxedSession = analysis.secondsPerChar >= 3.2;
        const veryRelaxedSession = analysis.secondsPerChar >= 5.4;
        const paragraphHeavy = (analysis.paragraphCount || 0) >= 3 || analysis.newlineRatio >= 0.012;
        const sentenceHeavy = (analysis.sentenceCount || 0) >= 5;
        const averageSentenceWords = analysis.averageSentenceWordCount || 0;
        const punctuationDensity = analysis.punctuationRatio || 0;
        const longForm = charCount >= 900;

        return {
            warmupStrength: clamp(0.18 + (veryRelaxedSession ? 0.08 : relaxedSession ? 0.04 : 0), 0.16, 0.34),
            cooldownStrength: clamp(0.14 + (longForm ? 0.06 : 0) + (veryRelaxedSession ? 0.05 : 0), 0.14, 0.3),
            waveStrength: clamp(0.045 + (longForm ? 0.02 : 0), 0.04, 0.08),
            waveCycles: longForm ? 7 : 5,
            sentenceRampStart: averageSentenceWords >= 14 ? 12 : 16,
            sentenceRamp: clamp(0.0048 + (averageSentenceWords * 0.00018), 0.0045, 0.0092),
            sentenceRampCap: clamp(0.12 + (averageSentenceWords * 0.01), 0.12, 0.28),
            newlineBoost: paragraphHeavy ? 0.46 : 0.34,
            sentencePunctuationBoost: sentenceHeavy ? 0.2 : 0.16,
            clausePunctuationBoost: punctuationDensity >= 0.04 ? 0.1 : 0.075,
            jitterRange: relaxedSession ? 0.055 : 0.075,
            minimumMultiplier: 0.7,
            clausePauseBase: relaxedSession ? 0.34 : 0.26,
            clausePauseSpread: relaxedSession ? 0.3 : 0.22,
            clauseWeightBase: 1.25,
            burstPauseBase: veryRelaxedSession ? 0.96 : relaxedSession ? 0.82 : 0.7,
            burstPauseSpread: veryRelaxedSession ? 1.08 : 0.9,
            burstWeightBase: 2.6,
            sentencePauseBase: veryRelaxedSession ? 1.28 : relaxedSession ? 1.14 : 0.98,
            sentencePauseSpread: longForm ? 1.3 : 1.08,
            sentenceWeightBase: 3.35,
            paragraphPauseBase: paragraphHeavy ? 1.75 : 1.48,
            paragraphPauseSpread: paragraphHeavy ? 1.78 : 1.42,
            paragraphWeightBase: 4.8,
            paragraphBlockPauseBase: paragraphHeavy ? 2.65 : 2.3,
            paragraphBlockPauseSpread: paragraphHeavy ? 2.35 : 1.95,
            paragraphBlockWeightBase: 6.5,
            microPauseBase: veryRelaxedSession ? 0.22 : 0.16,
            microPauseSpread: 0.18,
            thoughtPauseBase: veryRelaxedSession ? 0.52 : 0.4,
            thoughtPauseSpread: 0.34,
            clausePauseChance: clamp(0.34 + (punctuationDensity * 2.8) + (averageSentenceWords > 14 ? 0.06 : 0), 0.26, 0.72),
            connectivePauseChance: clamp(0.18 + (relaxedSession ? 0.08 : 0) + (longForm ? 0.06 : 0), 0.14, 0.42),
            longWordPauseChance: clamp(0.08 + ((analysis.longWordRatio || 0) * 0.45) + (relaxedSession ? 0.04 : 0), 0.06, 0.24),
            sentenceDriftPauseChance: clamp(0.06 + (averageSentenceWords > 15 ? 0.06 : 0) + (veryRelaxedSession ? 0.04 : 0), 0.04, 0.22),
            longWordThreshold: analysis.averageWordLength >= 5.2 ? 7 : 8,
            afterBoundaryBurstMin: longForm ? 20 : 24,
            afterBoundaryBurstMax: relaxedSession ? 46 : 38,
            midBurstMin: relaxedSession ? 28 : 36,
            midBurstMax: veryRelaxedSession ? 86 : longForm ? 76 : 66,
            distributionSentenceLift: 0.015,
            distributionSentenceCap: 0.4,
            edgeDistributionBoost: 0.18
        };
    }

    function getDefaultCadenceProfile() {
        return {
            warmupStrength: 0.24,
            cooldownStrength: 0.18,
            waveStrength: 0.06,
            waveCycles: 6,
            sentenceRampStart: 18,
            sentenceRamp: 0.006,
            sentenceRampCap: 0.12,
            newlineBoost: 0.35,
            sentencePunctuationBoost: 0.16,
            clausePunctuationBoost: 0.08,
            jitterRange: 0.08,
            minimumMultiplier: 0.72,
            clausePauseBase: 0.28,
            clausePauseSpread: 0.24,
            clauseWeightBase: 1.2,
            burstPauseBase: 0.75,
            burstPauseSpread: 0.95,
            burstWeightBase: 2.6,
            sentencePauseBase: 1.05,
            sentencePauseSpread: 1.15,
            sentenceWeightBase: 3.3,
            paragraphPauseBase: 1.45,
            paragraphPauseSpread: 1.55,
            paragraphWeightBase: 4.7,
            paragraphBlockPauseBase: 2.35,
            paragraphBlockPauseSpread: 2.1,
            paragraphBlockWeightBase: 6.4,
            microPauseBase: 0.16,
            microPauseSpread: 0.16,
            thoughtPauseBase: 0.4,
            thoughtPauseSpread: 0.3,
            clausePauseChance: 0.55,
            connectivePauseChance: 0.22,
            longWordPauseChance: 0.12,
            sentenceDriftPauseChance: 0.08,
            longWordThreshold: 8,
            afterBoundaryBurstMin: 24,
            afterBoundaryBurstMax: 56,
            midBurstMin: 40,
            midBurstMax: 112,
            distributionSentenceLift: 0.015,
            distributionSentenceCap: 0.4,
            edgeDistributionBoost: 0.18
        };
    }

    function getClausePauseChance(cadenceProfile, sentenceChars) {
        return clamp(
            cadenceProfile.clausePauseChance + Math.min(Math.max(sentenceChars - 18, 0) * 0.007, 0.16),
            0.24,
            0.86
        );
    }

    function getWordPauseKind(word, rng, context, cadenceProfile) {
        if (!word) {
            return null;
        }

        if (CONNECTIVE_PAUSE_WORDS.has(word) && context.sentenceChars >= 10 && rng() < cadenceProfile.connectivePauseChance) {
            return 'thought';
        }

        if (word.length >= cadenceProfile.longWordThreshold &&
            context.wordsSincePause >= 3 &&
            rng() < cadenceProfile.longWordPauseChance) {
            return 'micro-word';
        }

        if (context.sentenceChars >= 26 &&
            context.wordsSincePause >= 5 &&
            rng() < cadenceProfile.sentenceDriftPauseChance) {
            return 'micro-word';
        }

        return null;
    }

    function createMistakePlannerState(chars, draftProfile) {
        const sentenceMap = buildSentenceMap(chars);
        return {
            sentenceIds: sentenceMap.ids,
            sentenceLengths: sentenceMap.lengths,
            segmentCounts: Array.from({ length: draftProfile.segmentCount || 1 }, () => 0),
            sentenceCounts: new Map(),
            lastMistakeIndex: -100000,
            recentTypes: [],
            wordVariantCount: 0
        };
    }

    function buildSentenceMap(chars) {
        const ids = [];
        const lengths = new Map();
        let sentenceId = 0;
        let sentenceLength = 0;

        for (let index = 0; index < chars.length; index += 1) {
            const char = chars[index];
            ids[index] = sentenceId;
            if (char !== ' ' && char !== '\n') {
                sentenceLength += 1;
            }

            const endsSentence = ['.', '!', '?'].includes(char) || (char === '\n' && chars[index - 1] === '\n');
            if (endsSentence) {
                lengths.set(sentenceId, Math.max(sentenceLength, lengths.get(sentenceId) || 0));
                sentenceId += 1;
                sentenceLength = 0;
            }
        }

        lengths.set(sentenceId, Math.max(sentenceLength, lengths.get(sentenceId) || 0));
        return {
            ids,
            lengths
        };
    }

    function findGuaranteedMistakeIndex(chars, rng, draftProfile) {
        if (chars.length <= 50 || !draftProfile.guaranteedMistakeAllowed) {
            return -1;
        }

        const candidates = [];
        const maxIndex = Math.floor(Math.min(chars.length * 0.35, 260));
        for (let index = 0; index < maxIndex; index += 1) {
            const context = getMistypeContext(chars, index);
            if (context && !hasSensitiveMistypeNeighbor(chars, context)) {
                candidates.push(index);
            }
        }

        if (!candidates.length) {
            return -1;
        }

        return candidates[Math.floor(rng() * candidates.length)];
    }

    function getMistypeContext(chars, index) {
        const char = chars[index] || '';
        if (!isWordCharacter(char)) {
            return null;
        }

        let start = index;
        while (start > 0 && isWordCharacter(chars[start - 1] || '')) {
            start -= 1;
        }

        let end = index + 1;
        while (end < chars.length && isWordCharacter(chars[end] || '')) {
            end += 1;
        }

        const wordLength = end - start;
        const offsetInWord = index - start;
        const remainingInWord = end - index - 1;

        if (wordLength < 4 || offsetInWord === 0 || remainingInWord === 0) {
            return null;
        }

        return {
            char,
            start,
            end,
            wordLength,
            offsetInWord,
            remainingInWord
        };
    }

    function getWordVariantContext(chars, index, draftProfile, plannerState) {
        if (!draftProfile.wordVariantChance || plannerState.wordVariantCount >= draftProfile.maxWordVariantMistakes) {
            return null;
        }

        const char = chars[index] || '';
        if (!isWordCharacter(char) || isWordCharacter(chars[index - 1] || '')) {
            return null;
        }

        let end = index;
        while (end < chars.length && isWordCharacter(chars[end] || '')) {
            end += 1;
        }

        const originalWord = chars.slice(index, end).join('');
        if (!/^[A-Za-z]+$/.test(originalWord) || originalWord.length < 4 || originalWord.length > 10) {
            return null;
        }

        const lowerWord = originalWord.toLowerCase();
        const replacementBase = WORD_VARIANT_MAP[lowerWord];
        if (!replacementBase) {
            return null;
        }

        if (originalWord !== lowerWord) {
            return null;
        }

        return {
            kind: 'word-variant',
            char,
            start: index,
            end,
            wordLength: end - index,
            offsetInWord: 0,
            remainingInWord: Math.max(0, end - index - 1),
            originalWord,
            replacementWord: replacementBase
        };
    }

    function isWordCharacter(char) {
        return /[a-z]/i.test(char || '');
    }

    function getMistakeChance(context, progress, sentenceLength, fatigueMultiplier, draftProfile, mistakeCount) {
        if (!context || !draftProfile.maxMistakes) {
            return 0;
        }

        let chance = draftProfile.baseMistakeChance * fatigueMultiplier;
        chance *= 0.9 + Math.min(context.wordLength * 0.06, 0.4);
        chance *= 0.92 + Math.min(sentenceLength * 0.012, 0.3);

        if (progress > 0.3 && progress < 0.82) {
            chance *= 1.08;
        }

        if (context.offsetInWord <= 1 || context.remainingInWord <= 1) {
            chance *= 0.85;
        }

        if (draftProfile.wordCount < 26 && progress > 0.55) {
            chance *= 0.72;
        }

        const usageRatio = mistakeCount / Math.max(1, draftProfile.maxMistakes);
        chance *= clamp(1 - (usageRatio * 0.55), 0.35, 1);

        return chance;
    }

    function getWordVariantChance(progress, draftProfile, mistakeCount) {
        if (!draftProfile.wordVariantChance) {
            return 0;
        }

        const usageRatio = mistakeCount / Math.max(1, draftProfile.maxMistakes);
        let chance = draftProfile.wordVariantChance * clamp(1 - (usageRatio * 0.4), 0.45, 1);
        if (progress > 0.18 && progress < 0.88) {
            chance *= 1.08;
        }
        return chance;
    }

    function canScheduleMistake(chars, index, context, draftProfile, plannerState) {
        if (!context || !draftProfile.maxMistakes) {
            return false;
        }

        const progress = index / Math.max(1, chars.length - 1);
        if (progress < draftProfile.edgeGuardRatio || progress > 1 - draftProfile.edgeGuardRatio) {
            return false;
        }

        if (index - plannerState.lastMistakeIndex < draftProfile.minMistakeSpacingChars) {
            return false;
        }

        if (hasSensitiveMistypeNeighbor(chars, context)) {
            return false;
        }

        const segmentIndex = getSegmentIndex(index, chars.length, draftProfile.segmentCount);
        const segmentBudget = draftProfile.segmentBudgets[segmentIndex] || 0;
        if (plannerState.segmentCounts[segmentIndex] >= segmentBudget) {
            return false;
        }

        const sentenceId = plannerState.sentenceIds[index] ?? 0;
        const sentenceLength = plannerState.sentenceLengths.get(sentenceId) || 0;
        const sentenceBudget = sentenceLength >= 140 ? draftProfile.sentenceRepeatAllowance : 1;
        if ((plannerState.sentenceCounts.get(sentenceId) || 0) >= sentenceBudget) {
            return false;
        }

        return true;
    }

    function getSegmentIndex(index, totalChars, segmentCount) {
        if (segmentCount <= 1 || totalChars <= 1) {
            return 0;
        }

        const ratio = index / Math.max(1, totalChars - 1);
        return clamp(Math.floor(ratio * segmentCount), 0, segmentCount - 1);
    }

    function hasSensitiveMistypeNeighbor(chars, context) {
        const previousChar = chars[context.start - 1] || '';
        const nextChar = chars[context.end] || '';
        if (["'", '-', '/', '@', '#'].includes(previousChar) || ["'", '-', '/', '@', '#'].includes(nextChar)) {
            return true;
        }

        if (['(', '[', '{', '"'].includes(previousChar) || [')', ']', '}', '"'].includes(nextChar)) {
            return true;
        }

        return false;
    }

    function noteMistakeScheduled(plannerState, index, context, type) {
        const sentenceId = plannerState.sentenceIds[index] ?? 0;
        const segmentIndex = getSegmentIndex(index, plannerState.sentenceIds.length || 1, plannerState.segmentCounts.length || 1);
        plannerState.segmentCounts[segmentIndex] = (plannerState.segmentCounts[segmentIndex] || 0) + 1;
        plannerState.sentenceCounts.set(sentenceId, (plannerState.sentenceCounts.get(sentenceId) || 0) + 1);
        plannerState.lastMistakeIndex = index;
        if (type === 'word-variant') {
            plannerState.wordVariantCount += 1;
        }
        plannerState.recentTypes.push(type);
        if (plannerState.recentTypes.length > 3) {
            plannerState.recentTypes.shift();
        }
    }

    function planMistake(chars, index, rng, baseDelay, context, draftProfile, plannerState) {
        const char = chars[index];
        const nextChar = chars[index + 1] || '';
        const immediateRepair = rng() < draftProfile.immediateRepairChance;
        const preferWordBoundary = !immediateRepair && context.remainingInWord > 1 && rng() < draftProfile.preferWordBoundaryChance;
        const repairSpanLimit = Math.max(1, Math.min(context.remainingInWord, Math.round(1 + (context.remainingInWord * draftProfile.repairDepthFactor))));
        const immediateRepairBase = Math.max(1, Math.round((1 + Math.floor(rng() * 2)) * draftProfile.repairAfterExtraScale));
        const boundaryRepairBase = Math.max(
            1,
            Math.round((repairSpanLimit + (rng() < 0.35 ? 1 : 0)) * draftProfile.repairAfterExtraScale)
        );
        const delayedRepairBase = Math.max(1, Math.round((2 + Math.floor(rng() * 3)) * draftProfile.repairAfterExtraScale));
        const repairAfterExtraChars = immediateRepair
            ? Math.min(repairSpanLimit, immediateRepairBase)
            : preferWordBoundary
                ? Math.max(1, Math.min(context.remainingInWord, boundaryRepairBase))
                : Math.min(repairSpanLimit, delayedRepairBase);
        const hardExtraChars = Math.max(
            repairAfterExtraChars + 1,
            Math.min(
                context.remainingInWord + 1,
                repairAfterExtraChars + 1 + Math.max(1, Math.round((1 + Math.floor(rng() * 2)) * draftProfile.repairHardExtraScale))
            )
        );
        const plan = {
            outputs: [],
            initialMistakenChars: 0,
            indexAdvance: 0,
            cooldownChars: Math.max(42, draftProfile.cooldownChars - Math.floor(context.wordLength * 2) + Math.floor(rng() * 16)),
            pendingFix: {
                position: index,
                type: 'typo',
                initialMistakenChars: 0,
                repairAfterExtraChars,
                hardExtraChars,
                preferWordBoundary,
                noticePause: (0.34 + rng() * 0.34 + Math.min(repairAfterExtraChars * 0.05, 0.18)) * draftProfile.noticePauseFactor,
                realignPause: (0.08 + rng() * 0.14 + Math.min(context.wordLength * 0.01, 0.08)) * draftProfile.realignPauseFactor
            }
        };
        const mistakeType = selectMistakeType(rng, draftProfile, char, nextChar, plannerState);

        if (mistakeType === 'trans') {
            plan.outputs.push({
                char: nextChar,
                delay: baseDelay,
                distributionWeight: 0.9
            });
            plan.outputs.push({
                char,
                delay: baseDelay * 0.8,
                distributionWeight: 0.72
            });
            plan.initialMistakenChars = 2;
            plan.indexAdvance = 1;
            plan.pendingFix.type = 'trans';
        } else if (mistakeType === 'double') {
            plan.outputs.push({
                char,
                delay: baseDelay,
                distributionWeight: 0.88
            });
            plan.outputs.push({
                char,
                delay: baseDelay * 0.52,
                distributionWeight: 0.46
            });
            plan.initialMistakenChars = 2;
            plan.pendingFix.type = 'double';
        } else if (mistakeType === 'case') {
            const wrongCase = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
            plan.outputs.push({
                char: wrongCase,
                delay: baseDelay,
                distributionWeight: 0.8
            });
            plan.initialMistakenChars = 1;
            plan.pendingFix.type = 'case';
        } else if (mistakeType === 'omit') {
            plan.pendingFix.type = 'omit';
            plan.pendingFix.noticePause += 0.08;
            plan.pendingFix.realignPause += 0.04;
        } else if (mistakeType === 'vowel') {
            plan.outputs.push({
                char: getVowelSlip(char, rng),
                delay: baseDelay,
                distributionWeight: 0.78
            });
            plan.initialMistakenChars = 1;
            plan.pendingFix.type = 'vowel';
            plan.pendingFix.noticePause += 0.03;
        } else if (mistakeType === 'soft') {
            plan.outputs.push({
                char: getSoftSlip(char, rng),
                delay: baseDelay,
                distributionWeight: 0.8
            });
            plan.initialMistakenChars = 1;
            plan.pendingFix.type = 'soft';
            plan.pendingFix.noticePause += 0.02;
        } else {
            plan.outputs.push({
                char: getAdjacentKey(char, rng),
                delay: baseDelay,
                distributionWeight: 0.8
            });
            plan.initialMistakenChars = 1;
            plan.pendingFix.type = 'key';
        }

        plan.pendingFix.initialMistakenChars = plan.initialMistakenChars;
        return plan;
    }

    function selectMistakeType(rng, draftProfile, currentChar, nextChar, plannerState) {
        const canTranspose = isWordCharacter(nextChar);
        const canCaseSwap = currentChar !== currentChar.toLowerCase() || currentChar !== currentChar.toUpperCase();
        const loweredChar = String(currentChar || '').toLowerCase();
        const weights = [];

        if (canTranspose && draftProfile.transpositionChance > 0) {
            weights.push({ type: 'trans', weight: draftProfile.transpositionChance });
        }
        if (draftProfile.doubleTapChance > 0) {
            weights.push({ type: 'double', weight: draftProfile.doubleTapChance });
        }
        if (canCaseSwap && draftProfile.casingErrorChance > 0) {
            weights.push({ type: 'case', weight: draftProfile.casingErrorChance });
        }
        if (draftProfile.omissionChance > 0) {
            weights.push({ type: 'omit', weight: draftProfile.omissionChance });
        }
        if (VOWEL_SLIP_MAP[loweredChar] && draftProfile.vowelSlipChance > 0) {
            weights.push({ type: 'vowel', weight: draftProfile.vowelSlipChance });
        }
        if (SOFT_SLIP_MAP[loweredChar] && draftProfile.softSlipChance > 0) {
            weights.push({ type: 'soft', weight: draftProfile.softSlipChance });
        }
        if (draftProfile.keyboardSlipChance > 0) {
            weights.push({ type: 'key', weight: draftProfile.keyboardSlipChance });
        }

        if (!weights.length) {
            return 'key';
        }

        let weightedPick = pickMistakeVariation(rng, plannerState) * weights.reduce((total, entry) => total + entry.weight, 0);
        for (const entry of weights) {
            weightedPick -= entry.weight;
            if (weightedPick <= 0) {
                return entry.type;
            }
        }

        return weights[weights.length - 1].type;
    }

    function planWordVariantMistake(index, rng, baseDelay, context, draftProfile) {
        const outputs = [];
        const replacementChars = Array.from(context.replacementWord);
        for (let position = 0; position < replacementChars.length; position += 1) {
            outputs.push({
                char: replacementChars[position],
                kind: 'word-variant-output',
                delay: position === 0 ? baseDelay : (baseDelay * (0.64 + (rng() * 0.24))),
                distributionWeight: position === 0 ? 0.92 : 0.78
            });
        }

        const repairAfterExtraChars = Math.min(
            Math.max(1, context.wordLength + Math.floor(rng() * 2)),
            Math.max(1, Math.round((context.wordLength + 2) * draftProfile.repairAfterExtraScale))
        );
        return {
            outputs,
            initialMistakenChars: replacementChars.length,
            indexAdvance: context.wordLength - 1,
            cooldownChars: Math.max(56, Math.round((draftProfile.cooldownChars + 12 + Math.floor(rng() * 18)) * draftProfile.wordVariantDelayScale)),
            pendingFix: {
                position: index,
                type: 'word-variant',
                repairKind: 'word-variant',
                repairMode: 'full-retype',
                initialMistakenChars: replacementChars.length,
                repairAfterExtraChars,
                hardExtraChars: repairAfterExtraChars + Math.max(1, Math.round((1 + Math.floor(rng() * 2)) * draftProfile.repairHardExtraScale)),
                preferWordBoundary: true,
                backspaceCount: replacementChars.length,
                replacementChars: Array.from(context.originalWord),
                noticePause: (0.42 + rng() * 0.4 + Math.min(context.wordLength * 0.025, 0.16)) * draftProfile.noticePauseFactor,
                realignPause: (0.14 + rng() * 0.18 + Math.min(context.wordLength * 0.018, 0.1)) * draftProfile.realignPauseFactor
            }
        };
    }

    function pickMistakeVariation(rng, plannerState) {
        const base = rng();
        const lastType = plannerState.recentTypes[plannerState.recentTypes.length - 1] || '';
        if (!lastType) {
            return base;
        }

        if ((lastType === 'trans' && base < 0.18) ||
            (lastType === 'double' && base >= 0.18 && base < 0.28) ||
            (lastType === 'case' && base >= 0.28 && base < 0.36) ||
            (lastType === 'omit' && base >= 0.36 && base < 0.5) ||
            (lastType === 'vowel' && base >= 0.5 && base < 0.68) ||
            (lastType === 'soft' && base >= 0.68 && base < 0.82) ||
            (lastType === 'key' && base >= 0.82)) {
            return clamp(base + 0.19 + (rng() * 0.21), 0, 0.99);
        }

        return base;
    }

    function distributeDelays(actions, targetDurationSeconds) {
        const currentTotal = sumActionDelays(actions, actions.length);
        const remainingSeconds = targetDurationSeconds - currentTotal;

        if (remainingSeconds > 0) {
            const totalWeight = actions.reduce((sum, action) => sum + Math.max(0.15, action.distributionWeight || 1), 0);
            if (totalWeight <= 0) {
                return;
            }

            for (const action of actions) {
                const weight = Math.max(0.15, action.distributionWeight || 1);
                action.delay += remainingSeconds * (weight / totalWeight);
            }
            return;
        }

        if (currentTotal > 0 && targetDurationSeconds > 0) {
            const scale = targetDurationSeconds / currentTotal;
            for (const action of actions) {
                action.delay *= scale;
            }
        }
    }

    function getCadenceMultiplier(progress, sentenceLength, char, rng, cadenceProfile = null) {
        const profile = cadenceProfile || getDefaultCadenceProfile();
        let multiplier = 1;

        if (progress < 0.08) {
            multiplier += profile.warmupStrength * (1 - (progress / 0.08));
        } else if (progress > 0.9) {
            multiplier += profile.cooldownStrength * ((progress - 0.9) / 0.1);
        }

        multiplier += profile.waveStrength * Math.sin(progress * Math.PI * profile.waveCycles);
        multiplier += Math.min(Math.max(sentenceLength - profile.sentenceRampStart, 0) * profile.sentenceRamp, profile.sentenceRampCap);

        if (char === '\n') {
            multiplier += profile.newlineBoost;
        } else if (['.', '!', '?'].includes(char)) {
            multiplier += profile.sentencePunctuationBoost;
        } else if ([',', ';', ':'].includes(char)) {
            multiplier += profile.clausePunctuationBoost;
        }

        multiplier += (rng() - 0.5) * profile.jitterRange;
        return Math.max(profile.minimumMultiplier, multiplier);
    }

    function applyCadencePlan(actions, rng, cadenceProfile = null) {
        if (!actions.length) {
            return actions;
        }

        const profile = cadenceProfile || getDefaultCadenceProfile();
        const paced = [];
        let burstChars = 0;
        let sentenceChars = 0;
        let lastVisibleChar = '';
        let currentWord = '';
        let wordsSincePause = 0;
        let charsSincePause = 0;
        let burstTarget = nextBurstTarget(rng, true, profile);

        for (const action of actions) {
            paced.push(action);

            if (action.char === null) {
                burstChars = 0;
                sentenceChars = Math.max(0, sentenceChars - 2);
                wordsSincePause = 0;
                charsSincePause = 0;
                burstTarget = nextBurstTarget(rng, true, profile);
                continue;
            }

            if (action.char === 'backspace') {
                burstChars = Math.max(0, burstChars - 1);
                sentenceChars = Math.max(0, sentenceChars - 1);
                charsSincePause = Math.max(0, charsSincePause - 1);
                continue;
            }

            if (action.char === '\n') {
                const pauseKind = lastVisibleChar === '\n' ? 'paragraph-block' : 'paragraph';
                paced.push(buildCadencePause(pauseKind, rng, {
                    burstChars,
                    sentenceChars,
                    wordsSincePause,
                    charsSincePause,
                    previousChar: lastVisibleChar
                }, profile));
                burstChars = 0;
                sentenceChars = 0;
                wordsSincePause = 0;
                charsSincePause = 0;
                currentWord = '';
                burstTarget = nextBurstTarget(rng, true, profile);
                lastVisibleChar = '\n';
                continue;
            }

            if (isWordCharacter(action.char)) {
                currentWord += action.char.toLowerCase();
            } else if (!((action.char === '\'' || action.char === '-') && currentWord)) {
                currentWord = '';
            }

            if (action.char !== ' ') {
                burstChars += 1;
                charsSincePause += 1;
            }
            sentenceChars += 1;

            if (['.', '!', '?'].includes(action.char)) {
                paced.push(buildCadencePause('sentence', rng, {
                    burstChars,
                    sentenceChars,
                    wordsSincePause,
                    charsSincePause,
                    previousChar: lastVisibleChar
                }, profile));
                burstChars = 0;
                sentenceChars = 0;
                wordsSincePause = 0;
                charsSincePause = 0;
                currentWord = '';
                burstTarget = nextBurstTarget(rng, true, profile);
                lastVisibleChar = action.char;
                continue;
            }

            if ([',', ';', ':'].includes(action.char) && rng() < getClausePauseChance(profile, sentenceChars)) {
                paced.push(buildCadencePause('clause', rng, {
                    burstChars,
                    sentenceChars,
                    wordsSincePause,
                    charsSincePause,
                    previousChar: lastVisibleChar
                }, profile));
                charsSincePause = 0;
                wordsSincePause = 0;
            }

            if (action.char === ' ') {
                const completedWord = currentWord;
                if (completedWord) {
                    wordsSincePause += 1;
                }

                const smartPauseKind = getWordPauseKind(completedWord, rng, {
                    sentenceChars,
                    burstChars,
                    wordsSincePause,
                    charsSincePause
                }, profile);
                if (smartPauseKind) {
                    paced.push(buildCadencePause(smartPauseKind, rng, {
                        burstChars,
                        sentenceChars,
                        wordsSincePause,
                        charsSincePause,
                        previousChar: lastVisibleChar,
                        currentWord: completedWord
                    }, profile));
                    charsSincePause = 0;
                    wordsSincePause = 0;
                } else if (burstChars >= burstTarget) {
                    paced.push(buildCadencePause('burst', rng, {
                        burstChars,
                        sentenceChars,
                        wordsSincePause,
                        charsSincePause,
                        previousChar: lastVisibleChar
                    }, profile));
                    burstChars = 0;
                    charsSincePause = 0;
                    wordsSincePause = 0;
                    burstTarget = nextBurstTarget(rng, false, profile);
                }

                currentWord = '';
            }

            lastVisibleChar = action.char;
        }

        return paced;
    }

    function buildCadencePause(kind, rng, context = {}, cadenceProfile = null) {
        const profile = cadenceProfile || getDefaultCadenceProfile();
        const burstLift = Math.min((context.burstChars || 0) * 0.006, 0.5);
        const sentenceLift = Math.min((context.sentenceChars || 0) * 0.01, 0.55);
        const wordsLift = Math.min((context.wordsSincePause || 0) * 0.025, 0.45);
        let delay = 0.24 + rng() * 0.18;
        let distributionWeight = 0.9;

        switch (kind) {
            case 'micro-word':
                delay = profile.microPauseBase + (rng() * profile.microPauseSpread) + (wordsLift * 0.16);
                distributionWeight = 1.08 + wordsLift;
                break;
            case 'thought':
                delay = profile.thoughtPauseBase + (rng() * profile.thoughtPauseSpread) + (sentenceLift * 0.28) + (wordsLift * 0.22);
                distributionWeight = 1.75 + sentenceLift + wordsLift;
                break;
            case 'clause':
                delay = profile.clausePauseBase + (rng() * profile.clausePauseSpread) + (sentenceLift * 0.25);
                distributionWeight = profile.clauseWeightBase + burstLift * 0.4;
                break;
            case 'burst':
                delay = profile.burstPauseBase + (rng() * profile.burstPauseSpread) + burstLift + (wordsLift * 0.18);
                distributionWeight = profile.burstWeightBase + burstLift;
                break;
            case 'sentence':
                delay = profile.sentencePauseBase + (rng() * profile.sentencePauseSpread) + sentenceLift;
                distributionWeight = profile.sentenceWeightBase + sentenceLift;
                break;
            case 'paragraph':
                delay = profile.paragraphPauseBase + (rng() * profile.paragraphPauseSpread) + sentenceLift + burstLift;
                distributionWeight = profile.paragraphWeightBase + sentenceLift;
                break;
            case 'paragraph-block':
                delay = profile.paragraphBlockPauseBase + (rng() * profile.paragraphBlockPauseSpread) + sentenceLift + burstLift;
                distributionWeight = profile.paragraphBlockWeightBase + burstLift;
                break;
            default:
                break;
        }

        return {
            char: null,
            kind: 'cadence-pause',
            delay,
            distributionWeight
        };
    }

    function nextBurstTarget(rng, afterBoundary, cadenceProfile = null) {
        const profile = cadenceProfile || getDefaultCadenceProfile();
        const range = afterBoundary
            ? [profile.afterBoundaryBurstMin, profile.afterBoundaryBurstMax]
            : [profile.midBurstMin, profile.midBurstMax];
        return Math.floor(range[0] + (rng() * Math.max(1, range[1] - range[0])));
    }

    function getDistributionWeight(char, progress, sentenceLength, cadenceProfile = null) {
        const profile = cadenceProfile || getDefaultCadenceProfile();
        let weight = 0.9;
        if (char === '\n') {
            weight = 5.5;
        } else if (['.', '!', '?'].includes(char)) {
            weight = 3.5;
        } else if (char === ',') {
            weight = 2.1;
        } else if (char === ' ') {
            weight = 1.7;
        }

        weight += Math.min(sentenceLength * profile.distributionSentenceLift, profile.distributionSentenceCap);
        if (progress < 0.08 || progress > 0.9) {
            weight += profile.edgeDistributionBoost;
        }
        return weight;
    }

    function getAdjacentKey(char, rng) {
        const keyboard = {
            '1': '2q',
            '2': '13w',
            '3': '24we',
            '4': '35er',
            '5': '46rt',
            '6': '57ty',
            '7': '68yu',
            '8': '79ui',
            '9': '80io',
            '0': '9-op',
            '-': '0=p[',
            '=': '-[]',
            q: '12wa',
            w: '123qase',
            e: '234wsdr',
            r: '345edft',
            t: '456rfgy',
            y: '567tghu',
            u: '678yhji',
            i: '789ujko',
            o: '890iklp',
            p: '90ol[-',
            '[': 'p-=];',
            ']': '[=\\;',
            '\\': ']',
            a: 'qwsz',
            s: 'qweadzx',
            d: 'wersfxc',
            f: 'ertdgcv',
            g: 'rtyfhvb',
            h: 'tyugjbn',
            j: 'yuikhmn',
            k: 'uiolj,m',
            l: 'iopk;,.',
            ';': 'op[l/.,',
            "'": ';]',
            z: 'asx',
            x: 'zsdc',
            c: 'xdfv',
            v: 'cfgb',
            b: 'vghn',
            n: 'bhjm',
            m: 'njk,',
            ',': 'mkl.',
            '.': ',l/;',
            '/': '.;'
        };

        const lowered = char.toLowerCase();
        const options = keyboard[lowered];
        if (!options) {
            return char;
        }

        const adjacent = options[Math.floor(rng() * options.length)];
        return char === char.toUpperCase() ? adjacent.toUpperCase() : adjacent;
    }

    function getVowelSlip(char, rng) {
        const lowered = char.toLowerCase();
        const options = VOWEL_SLIP_MAP[lowered];
        if (!options) {
            return getAdjacentKey(char, rng);
        }

        const next = options[Math.floor(rng() * options.length)];
        return char === char.toUpperCase() ? next.toUpperCase() : next;
    }

    function getSoftSlip(char, rng) {
        const lowered = char.toLowerCase();
        const options = SOFT_SLIP_MAP[lowered];
        if (!options) {
            return getAdjacentKey(char, rng);
        }

        const next = options[Math.floor(rng() * options.length)];
        return char === char.toUpperCase() ? next.toUpperCase() : next;
    }

    function createRng(seed) {
        let value = seed >>> 0;
        return () => {
            value += 0x6D2B79F5;
            let next = value;
            next = Math.imul(next ^ (next >>> 15), next | 1);
            next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
            return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
        };
    }

    function buildKeyInit(char) {
        const descriptor = getKeyDescriptor(char);
        return {
            key: descriptor.key,
            code: descriptor.code,
            keyCode: descriptor.keyCode,
            which: descriptor.keyCode,
            charCode: descriptor.charCode,
            shiftKey: descriptor.shiftKey
        };
    }

    function getKeyDescriptor(char) {
        if (char === '\n') {
            return {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                charCode: 13,
                shiftKey: false
            };
        }

        if (char === ' ') {
            return {
                key: ' ',
                code: 'Space',
                keyCode: 32,
                charCode: 32,
                shiftKey: false
            };
        }

        if (/[a-z]/.test(char)) {
            return {
                key: char,
                code: `Key${char.toUpperCase()}`,
                keyCode: char.toUpperCase().charCodeAt(0),
                charCode: char.charCodeAt(0),
                shiftKey: false
            };
        }

        if (/[A-Z]/.test(char)) {
            return {
                key: char,
                code: `Key${char}`,
                keyCode: char.charCodeAt(0),
                charCode: char.charCodeAt(0),
                shiftKey: true
            };
        }

        if (/[0-9]/.test(char)) {
            return {
                key: char,
                code: `Digit${char}`,
                keyCode: char.charCodeAt(0),
                charCode: char.charCodeAt(0),
                shiftKey: false
            };
        }

        const symbol = getSymbolKeyDescriptor(char);
        if (symbol) {
            return symbol;
        }

        const codePoint = char?.codePointAt?.(0) || 0;
        const legacyCode = char && char.length === 1 ? char.charCodeAt(0) : 0;
        return {
            key: char,
            code: '',
            keyCode: legacyCode || (codePoint <= 0xFFFF ? codePoint : 0),
            charCode: legacyCode,
            shiftKey: false
        };
    }

    function getSymbolKeyDescriptor(char) {
        const symbols = {
            '!': { code: 'Digit1', keyCode: 49, shiftKey: true },
            '@': { code: 'Digit2', keyCode: 50, shiftKey: true },
            '#': { code: 'Digit3', keyCode: 51, shiftKey: true },
            '$': { code: 'Digit4', keyCode: 52, shiftKey: true },
            '%': { code: 'Digit5', keyCode: 53, shiftKey: true },
            '^': { code: 'Digit6', keyCode: 54, shiftKey: true },
            '&': { code: 'Digit7', keyCode: 55, shiftKey: true },
            '*': { code: 'Digit8', keyCode: 56, shiftKey: true },
            '(': { code: 'Digit9', keyCode: 57, shiftKey: true },
            ')': { code: 'Digit0', keyCode: 48, shiftKey: true },
            '-': { code: 'Minus', keyCode: 189, shiftKey: false },
            '_': { code: 'Minus', keyCode: 189, shiftKey: true },
            '=': { code: 'Equal', keyCode: 187, shiftKey: false },
            '+': { code: 'Equal', keyCode: 187, shiftKey: true },
            '[': { code: 'BracketLeft', keyCode: 219, shiftKey: false },
            '{': { code: 'BracketLeft', keyCode: 219, shiftKey: true },
            ']': { code: 'BracketRight', keyCode: 221, shiftKey: false },
            '}': { code: 'BracketRight', keyCode: 221, shiftKey: true },
            '\\': { code: 'Backslash', keyCode: 220, shiftKey: false },
            '|': { code: 'Backslash', keyCode: 220, shiftKey: true },
            ';': { code: 'Semicolon', keyCode: 186, shiftKey: false },
            ':': { code: 'Semicolon', keyCode: 186, shiftKey: true },
            '\'': { code: 'Quote', keyCode: 222, shiftKey: false },
            '"': { code: 'Quote', keyCode: 222, shiftKey: true },
            ',': { code: 'Comma', keyCode: 188, shiftKey: false },
            '<': { code: 'Comma', keyCode: 188, shiftKey: true },
            '.': { code: 'Period', keyCode: 190, shiftKey: false },
            '>': { code: 'Period', keyCode: 190, shiftKey: true },
            '/': { code: 'Slash', keyCode: 191, shiftKey: false },
            '?': { code: 'Slash', keyCode: 191, shiftKey: true },
            '`': { code: 'Backquote', keyCode: 192, shiftKey: false },
            '~': { code: 'Backquote', keyCode: 192, shiftKey: true }
        };

        const meta = symbols[char];
        if (!meta) {
            return null;
        }

        return {
            key: char,
            code: meta.code,
            keyCode: meta.keyCode,
            charCode: char.charCodeAt(0),
            shiftKey: meta.shiftKey
        };
    }

    function sumActionDelays(actions, count) {
        let total = 0;
        for (let index = 0; index < Math.min(count, actions.length); index += 1) {
            total += actions[index].delay;
        }
        return total;
    }

    function buildCumulativeDelays(actions) {
        const cumulative = [0];
        for (const action of actions) {
            cumulative.push(cumulative[cumulative.length - 1] + action.delay);
        }
        return cumulative;
    }

    function createIdleRunner() {
        return {
            runId: null,
            job: null,
            state: RUNNER_STATES.IDLE,
            actions: [],
            cumulativeDelays: [0],
            totalSeconds: 0,
            completedIndex: 0,
            elapsedSeconds: 0,
            timelineOriginMs: 0,
            stopRequested: false,
            paused: false,
            pauseStartedAtMs: 0,
            lockedElement: null,
            lastCompletionVerification: null,
            lastReportedAt: 0,
            loopPromise: null
        };
    }

    function resetRunner() {
        runner = createIdleRunner();
    }

    function matchesActiveRun(runId) {
        return Boolean(runId && runner.runId === runId);
    }

    function formatClock(totalSeconds) {
        const safeSeconds = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(safeSeconds / 3600);
        const minutes = Math.floor((safeSeconds % 3600) / 60);
        const seconds = safeSeconds % 60;

        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function sleep(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function disposeRunnerController() {
        runner.stopRequested = true;
        runner.paused = false;
        runner.pauseStartedAtMs = 0;
        chrome.runtime?.onMessage?.removeListener?.(runtimeMessageListener);
        window.removeEventListener?.('pagehide', pageHideListener);
        for (const eventName of interferenceEvents) {
            document.removeEventListener?.(eventName, handleTrustedUserInterference, true);
        }
    }

    globalThis.__writerdripTestHooks = Object.freeze({
        buildActionPlan,
        buildDraftMistakeProfile,
        selectMistakeType,
        validateActionPlan,
        replayActionPlan,
        countRepairSequences,
        sumActionDelays
    });

    globalThis.__writerdripRunnerController = Object.freeze({
        version: WRITERDRIP_RUNNER_VERSION,
        dispose: disposeRunnerController
    });
}
