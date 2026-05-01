/*
 * SPDX-License-Identifier: MIT
 * WriterDrip source attribution
 * Copyright (c) 2026 WriterDrip contributors
 * If you reuse substantial parts of this project, please keep credit to:
 * https://github.com/Highdrys01/WriterDrip
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const scriptFiles = [
    'shared.js',
    'background.js',
    'content.js',
    'popup.js'
];
const attributionFiles = [
    'shared.js',
    'background.js',
    'content.js',
    'popup.js',
    'scripts/validate.mjs'
];
const ATTRIBUTION_MARKER = 'WriterDrip source attribution';
const ATTRIBUTION_REPO = 'https://github.com/Highdrys01/WriterDrip';

async function main() {
    await validateManifest();
    await validatePopupHtml();
    await validateSyntax();
    await validateRepositoryHygiene();
    await validateBackgroundRuntime();
    await validatePopupRuntime();
    await validatePlanner();
    console.log('WriterDrip validation passed.');
}

async function validateManifest() {
    const raw = await fs.readFile(path.join(rootDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(manifest.manifest_version, 3, 'Manifest must stay on MV3.');
    assert.equal(manifest.background?.service_worker, 'background.js', 'Background worker should stay on background.js.');
    assert.equal(manifest.action?.default_popup, 'popup.html', 'Popup should stay on popup.html.');
    assert.ok(manifest.permissions?.includes('power'), 'Manifest should include the power permission so active drips can prevent local system sleep.');
}

async function validatePopupHtml() {
    const popupHtml = await fs.readFile(path.join(rootDir, 'popup.html'), 'utf8');
    assert.match(
        popupHtml,
        /<script\s+src="shared\.js"><\/script>\s*<script\s+src="popup\.js"><\/script>/,
        'popup.html must load shared.js before popup.js.'
    );
    assert.match(popupHtml, /id="preflightPanel"/, 'popup.html should keep the preflight panel.');
    assert.match(popupHtml, /id="preflightToggle"/, 'popup.html should keep the preflight panel toggle.');
    assert.match(popupHtml, /id="correctionPreviewPanel"/, 'popup.html should include the correction preview panel.');
    assert.match(popupHtml, /id="correctionPreviewToggle"/, 'popup.html should include the correction preview toggle.');
    assert.match(popupHtml, /id="recoveryPanel"/, 'popup.html should keep the recovery panel.');
    assert.match(popupHtml, /id="recoveryToggle"/, 'popup.html should keep the recovery panel toggle.');
    assert.match(popupHtml, /id="recoveryChecks"/, 'popup.html should keep the recovery confidence checks list.');
    assert.match(popupHtml, /id="runSummaryPanel"/, 'popup.html should include the post-run summary panel.');
    assert.match(popupHtml, /id="runSummaryToggle"/, 'popup.html should include the run summary toggle.');
    assert.match(popupHtml, /id="completionPanel"/, 'popup.html should keep the completion panel.');
    assert.match(popupHtml, /id="completionToggle"/, 'popup.html should keep the completion panel toggle.');
    assert.match(popupHtml, /id="copyDebugBtn"/, 'popup.html should include a copy debug report button.');
    assert.match(popupHtml, /id="keepAwakeToggle"/, 'popup.html should include the keep-awake preference toggle.');
    assert.match(popupHtml, /Keep computer awake/, 'popup.html should label the keep-awake preference clearly.');
    assert.match(popupHtml, /Duration \(minutes\)/, 'popup.html should label the duration input in minutes.');
    assert.match(popupHtml, /Enter the duration as minutes/, 'popup.html should tell users to enter custom duration values as minutes.');
    assert.doesNotMatch(popupHtml, /id="scheduleGroup"/, 'popup.html should not ship the removed run window controls.');
    assert.doesNotMatch(popupHtml, /id="scheduleStart"/, 'popup.html should not keep the removed schedule start time input.');
    assert.doesNotMatch(popupHtml, /id="scheduleEnd"/, 'popup.html should not keep the removed schedule end time input.');

    const popupSource = await fs.readFile(path.join(rootDir, 'popup.js'), 'utf8');
    assert.match(popupSource, /duration in minutes/i, 'popup.js validation copy should mention duration values are entered in minutes.');
    assert.match(popupSource, /Enter minutes only/i, 'popup.js invalid-duration guidance should reject hour text and ask for minutes.');

    const backgroundSource = await fs.readFile(path.join(rootDir, 'background.js'), 'utf8');
    assert.match(
        backgroundSource,
        /files:\s*\[\s*'shared\.js'\s*,\s*'content\.js'\s*\]/,
        'background.js must inject shared.js before content.js.'
    );
    assert.match(backgroundSource, /KEEP_AWAKE_ENABLED_KEY/, 'background.js should use the shared keep-awake preference key.');
}

async function validateSyntax() {
    for (const relativePath of scriptFiles) {
        const source = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
        new vm.Script(source, { filename: relativePath });
    }
}

async function validateRepositoryHygiene() {
    for (const relativePath of attributionFiles) {
        const source = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
        assert.match(
            source,
            new RegExp(ATTRIBUTION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
            `${relativePath} should keep the WriterDrip attribution marker.`
        );
        assert.match(
            source,
            new RegExp(ATTRIBUTION_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
            `${relativePath} should keep the WriterDrip repository credit link.`
        );
    }

    const noticeSource = await fs.readFile(path.join(rootDir, 'NOTICE.md'), 'utf8');
    assert.match(noticeSource, /WriterDrip/i, 'NOTICE.md should identify WriterDrip.');
    assert.match(noticeSource, /github\.com\/Highdrys01\/WriterDrip/i, 'NOTICE.md should point to the WriterDrip repository.');

    const trackedGoogleVerificationFiles = await findFiles(rootDir, (relativePath) =>
        /^docs\/google[a-z0-9]+\.html$/i.test(relativePath) || /^google[a-z0-9]+\.html$/i.test(relativePath)
    );

    assert.equal(
        trackedGoogleVerificationFiles.length,
        0,
        'Repository should not track Search Console HTML verification files. Use the meta tag method instead.'
    );

    const textFilePaths = await findFiles(rootDir, (relativePath) => {
        if (relativePath.startsWith('.git/')) {
            return false;
        }

        const extension = path.extname(relativePath);
        return [
            '',
            '.css',
            '.html',
            '.js',
            '.json',
            '.md',
            '.txt',
            '.xml',
            '.yml',
            '.yaml'
        ].includes(extension);
    });

    const sensitivePatterns = [
        { regex: /\/Users\/[^/\s]+\/(?:Desktop|Downloads)\//, label: 'local Desktop/Downloads path' },
        { regex: /\b[A-Z0-9._%+-]+@gmail\.com\b/i, label: 'personal Gmail address' },
        { regex: /\bfile:\/\/\/Users\//i, label: 'local file URL' }
    ];

    for (const relativePath of textFilePaths) {
        const absolutePath = path.join(rootDir, relativePath);
        const source = await fs.readFile(absolutePath, 'utf8');
        for (const pattern of sensitivePatterns) {
            assert.doesNotMatch(
                source,
                pattern.regex,
                `${relativePath} should not contain a ${pattern.label}.`
            );
        }
    }
}

async function validateBackgroundRuntime() {
    const backgroundSandbox = createBackgroundSandbox();
    await evaluateScript(backgroundSandbox, 'shared.js');
    await evaluateScript(backgroundSandbox, 'background.js');
    await flushMicrotasks();

    const hooks = backgroundSandbox.__writerdripBackgroundTestHooks;
    assert.ok(hooks, 'background.js should expose background test hooks.');
    assert.deepEqual(
        [...backgroundSandbox.WriterDripShared.RECOVERABLE_ATTENTION_CODES].sort(),
        [
            'editor-focus-failed',
            'editor-not-ready',
            'manual-interaction',
            'tab-suspended',
            'typing-context-lost'
        ],
        'Shared recoverable attention codes should include every state that asks users to click the Doc and resume.'
    );
    assert.equal(hooks.canResumeAttentionState('manual-interaction'), true, 'Background should allow manual-interaction sessions to run the resume confidence check.');
    assert.equal(hooks.canResumeAttentionState('typing-context-lost'), true, 'Background should allow typing-context-lost sessions to run the resume confidence check.');

    const keepAwakeSession = hooks.normalizeSession(6, {
        activeJob: hooks.createJob({
            text: 'A running draft should request local keep-awake protection.',
            docKey: 'awake-doc',
            durationMins: 10,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_awake',
        state: hooks.SESSION_STATES.RUNNING
    });
    await hooks.syncPowerKeepAwake({ 6: keepAwakeSession });
    assert.deepEqual(
        backgroundSandbox.__powerEvents.at(-1),
        { type: 'request', level: 'system' },
        'Running local drips should request system keep-awake protection.'
    );
    await backgroundSandbox.chrome.storage.local.set({ writerdripKeepAwakeEnabled: false });
    await hooks.syncPowerKeepAwake({ 6: keepAwakeSession });
    assert.deepEqual(
        backgroundSandbox.__powerEvents.at(-1),
        { type: 'release' },
        'Turning keep-awake off during a running drip should release system keep-awake protection.'
    );
    await backgroundSandbox.chrome.storage.local.set({ writerdripKeepAwakeEnabled: true });
    await hooks.syncPowerKeepAwake({ 6: keepAwakeSession });
    keepAwakeSession.state = hooks.SESSION_STATES.PAUSED;
    await hooks.syncPowerKeepAwake({ 6: keepAwakeSession });
    assert.deepEqual(
        backgroundSandbox.__powerEvents.at(-1),
        { type: 'release' },
        'Paused drips should release keep-awake protection so WriterDrip does not drain battery while paused.'
    );
    await backgroundSandbox.chrome.storage.local.set({ writerdripKeepAwakeEnabled: false });
    keepAwakeSession.state = hooks.SESSION_STATES.RUNNING;
    await hooks.syncPowerKeepAwake({ 6: keepAwakeSession });
    assert.notDeepEqual(
        backgroundSandbox.__powerEvents.at(-1),
        { type: 'request', level: 'system' },
        'Disabled keep-awake preference should prevent new system keep-awake requests.'
    );

    const manualAttentionSession = hooks.normalizeSession(7, {
        activeJob: hooks.createJob({
            text: 'A paused draft that should be recoverable after manual interaction.',
            docKey: 'test',
            durationMins: 10,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_manual',
        state: hooks.SESSION_STATES.ATTENTION,
        attentionCode: 'manual-interaction',
        attentionMessage: 'Manual interaction was detected.'
    });
    const manualResumeReport = await hooks.runResumeConfidenceCheck(7, manualAttentionSession);
    assert.equal(manualResumeReport.canResume, true, 'Manual-interaction attention should pass resume confidence when the same Doc is ready again.');
    assert.equal(
        manualResumeReport.checks.some((check) => check.id === 'resume-state' && check.pass),
        true,
        'Manual-interaction resume confidence should pass the resume-state check.'
    );

    const typingContextSession = hooks.normalizeSession(8, {
        activeJob: hooks.createJob({
            text: 'A paused draft that should be recoverable after focus comes back.',
            docKey: 'test',
            durationMins: 10,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_context',
        state: hooks.SESSION_STATES.ATTENTION,
        attentionCode: 'typing-context-lost',
        attentionMessage: 'Typing context was lost.'
    });
    const typingResumeReport = await hooks.runResumeConfidenceCheck(8, typingContextSession);
    assert.equal(typingResumeReport.canResume, true, 'Typing-context-lost attention should pass resume confidence when the same Doc is ready again.');

    const repeatedJobSeeds = new Set();
    for (let index = 0; index < 24; index += 1) {
        const seededJob = hooks.createJob({
            text: 'A repeated draft should still get a fresh run seed each time.',
            docKey: 'seed-doc',
            durationMins: 10,
            correctionIntensity: 'high'
        });
        repeatedJobSeeds.add(seededJob.seed);
    }
    assert.ok(repeatedJobSeeds.size >= 22, 'Repeated jobs should receive fresh high-entropy seeds.');

    const session = hooks.normalizeSession(1, {
        activeJob: hooks.createJob({
            text: 'A draft that should finish cleanly.',
            docKey: 'test-doc',
            durationMins: 5,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_test',
        state: hooks.SESSION_STATES.RUNNING,
        progress: 0.72,
        checkpointActionIndex: 42,
        totalActions: 60
    });

    hooks.applyRuntimeSnapshotToSession(session, {
        state: hooks.SESSION_STATES.COMPLETE,
        percent: 1,
        eta: '00:00',
        actionIndex: 60,
        totalActions: 60,
        completionVerification: {
            verified: true,
            summary: 'Done',
            note: 'Checked',
            checks: [{ id: 'plan-finished', label: 'Action plan finished', pass: true, detail: 'All good' }]
        }
    });

    assert.equal(session.state, hooks.SESSION_STATES.COMPLETE, 'Completed runtime snapshots should move the session to complete.');
    assert.equal(session.activeJob, null, 'Completed runtime snapshots should clear the active job.');
    assert.equal(session.activeRunId, null, 'Completed runtime snapshots should clear the active run id.');
    assert.ok(session.lastCompletedJob, 'Completed runtime snapshots should preserve a summary of the completed job.');
    assert.equal(session.lastCompletedVerification?.verified, true, 'Completed runtime snapshots should preserve completion verification details.');
    assert.ok(session.lastRunSummary, 'Completed runtime snapshots should preserve a redacted run summary.');
    assert.equal(
        JSON.stringify(session.lastRunSummary).includes('draft that should finish'),
        false,
        'Run summaries should not store raw draft text.'
    );

    const safetyPausedSession = hooks.normalizeSession(12, {
        activeJob: hooks.createJob({
            text: 'A draft that should soft pause instead of erroring after harmless interaction.',
            docKey: 'pause-doc',
            durationMins: 5,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_soft_pause',
        state: hooks.SESSION_STATES.RUNNING,
        progress: 0.2
    });
    hooks.applyRuntimeSnapshotToSession(safetyPausedSession, {
        state: hooks.SESSION_STATES.PAUSED,
        percent: 0.22,
        eta: '04:12',
        actionIndex: 12,
        totalActions: 90,
        pauseReason: {
            code: 'manual-interaction',
            message: 'Paused after a document-body click.'
        }
    });
    assert.equal(safetyPausedSession.state, hooks.SESSION_STATES.PAUSED, 'Recoverable user interaction should be preserved as a paused session.');
    assert.equal(safetyPausedSession.pauseReason?.code, 'manual-interaction', 'Soft pauses should preserve a safe pause reason for the popup.');
    assert.equal(safetyPausedSession.lastError, null, 'Soft pauses should not look like runner errors.');

    const detachedSession = hooks.normalizeSession(2, {
        activeJob: hooks.createJob({
            text: 'A draft that should survive a closed tab.',
            docKey: 'reopen-doc',
            durationMins: 5,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_reopen',
        state: hooks.SESSION_STATES.RUNNING,
        progress: 0.35,
        eta: '00:12'
    });
    assert.equal(
        hooks.markSessionAwaitingTabReopen(detachedSession),
        true,
        'Active sessions should be preserved when the original tab closes.'
    );
    assert.equal(detachedSession.state, hooks.SESSION_STATES.ATTENTION, 'Closed active tabs should move into attention state.');
    assert.equal(detachedSession.attentionCode, 'tab-suspended', 'Closed active tabs should become resumable through the suspended-tab flow.');
    assert.ok(detachedSession.activeJob && detachedSession.activeRunId, 'Closed active tabs should keep the job and run id for later adoption.');

    const pausedSession = hooks.normalizeSession(3, {
        activeJob: {
            text: 'A paused draft.',
            docKey: 'paused-doc',
            durationMins: 5,
            correctionIntensity: 'high',
            schedule: { enabled: true, startTime: '09:00', endTime: '17:00' }
        },
        activeRunId: 'run_paused',
        state: hooks.SESSION_STATES.PAUSED
    });
    assert.equal(
        Object.prototype.hasOwnProperty.call(pausedSession.activeJob, 'schedule'),
        false,
        'Legacy scheduled jobs should be normalized away when an older session is reopened.'
    );
    assert.equal(
        hooks.markSessionAwaitingTabReopen(pausedSession),
        true,
        'Paused sessions should stay recoverable when the original tab closes.'
    );
    assert.equal(pausedSession.attentionCode, 'tab-suspended', 'Paused reopened sessions should guide the user back through the suspended-tab recovery flow.');

    const completionFromProgressSession = hooks.normalizeSession(4, {
        activeJob: hooks.createJob({
            text: 'A draft that finishes through the progress path.',
            docKey: 'complete-through-progress',
            durationMins: 5,
            correctionIntensity: 'medium'
        }),
        activeRunId: 'run_progress_complete',
        state: hooks.SESSION_STATES.RUNNING,
        progress: 0.94,
        checkpointActionIndex: 16,
        totalActions: 17
    });
    await hooks.writeSessions({ 4: completionFromProgressSession });
    await hooks.handleRunnerProgress(4, {
        runId: 'run_progress_complete',
        state: hooks.SESSION_STATES.COMPLETE,
        percent: 1,
        eta: '00:00',
        actionIndex: 17,
        totalActions: 17,
        verification: {
            verified: true,
            summary: 'Final verification arrived with the progress update.',
            checks: []
        }
    });
    const storedSessions = await hooks.readSessions();
    const completedFromProgress = storedSessions['4'];
    assert.equal(completedFromProgress.activeJob, null, 'Completed progress updates should clear the active job even if the final completion message is missed.');
    assert.equal(completedFromProgress.activeRunId, null, 'Completed progress updates should clear the active run id even if the final completion message is missed.');
    assert.equal(completedFromProgress.state, hooks.SESSION_STATES.COMPLETE, 'Completed progress updates should move the session into the complete state.');
    assert.equal(completedFromProgress.lastCompletedVerification?.verified, true, 'Completed progress updates should preserve completion verification details.');
    assert.ok(completedFromProgress.lastRunSummary, 'Completed progress updates should preserve a run summary.');
    assert.equal(
        JSON.stringify(completedFromProgress.lastRunSummary).includes('A draft that finishes'),
        false,
        'Progress-path run summaries should not store raw draft text.'
    );

    const sensitiveSession = hooks.normalizeSession(5, {
        activeJob: hooks.createJob({
            text: 'Secret draft phrase that must never appear in a debug report.',
            docKey: 'secret-doc',
            durationMins: 5,
            correctionIntensity: 'high'
        }),
        activeRunId: 'run_secret',
        state: hooks.SESSION_STATES.ATTENTION,
        lastErrorCode: 'editor-not-ready',
        lastError: 'Editor was not ready.'
    });
    const debugReport = hooks.buildDebugReport({
        tabId: 5,
        url: 'https://docs.google.com/document/d/secret-doc/edit',
        tab: { id: 5, status: 'complete', url: 'https://docs.google.com/document/d/secret-doc/edit', discarded: false },
        session: sensitiveSession,
        popupContext: {
            pageKind: 'google-doc',
            selectedCorrectionIntensity: 'high',
            durationValue: 5,
            issueCode: 'editor-not-ready',
            draftText: 'Secret draft phrase that must never appear in a debug report.',
            draft: {
                hasDraft: true,
                wordCount: 10,
                charCount: 60,
                minimumDurationMins: 5,
                recommendedDurationMins: 8,
                suggestedCorrectionLabel: 'Secret debug label'
            },
            preflight: {
                ready: false,
                code: 'Secret preflight issue',
                checks: [{ id: 'Secret check id with draft words', pass: false }]
            }
        }
    });
    const debugJson = JSON.stringify(debugReport);
    assert.doesNotMatch(debugJson, /Secret draft phrase/i, 'Debug reports should exclude draft text even if the popup context accidentally includes it.');
    assert.doesNotMatch(debugJson, /Secret debug label|Secret preflight|Secret check/i, 'Debug reports should redact unexpected popup diagnostic strings.');
    assert.equal(debugReport.extension.version, '1.0.2', 'Debug reports should include the extension version.');
    assert.equal(debugReport.session.issueCode, 'editor-not-ready', 'Debug reports should include the current issue code.');
    assert.equal(debugReport.tab.docStatus.sameAsActiveJob, true, 'Debug reports should include same-Doc status without exposing the Doc id.');

    const offsiteDebugReport = hooks.buildDebugReport({
        tabId: 6,
        url: 'https://mail.google.com/mail/u/0/#inbox',
        tab: { id: 6, status: 'complete', url: 'https://mail.google.com/mail/u/0/#inbox', discarded: false },
        session: hooks.normalizeSession(6, {}),
        popupContext: {
            pageKind: 'Secret page kind',
            issueCode: 'Secret issue code',
            draft: {
                hasDraft: false,
                suggestedCorrectionLabel: 'Secret label'
            }
        }
    });
    const offsiteDebugJson = JSON.stringify(offsiteDebugReport);
    assert.equal(offsiteDebugReport.tab.urlKind, 'other-web-page', 'Debug reports should classify non-Doc URLs without exposing hostnames.');
    assert.equal(offsiteDebugReport.popup.issueCode, 'runtime-error', 'Unexpected popup issue codes should be normalized.');
    assert.doesNotMatch(offsiteDebugJson, /mail\.google|Secret/i, 'Debug reports should not leak offsite hostnames or unexpected popup strings.');

    backgroundSandbox.chrome.tabs.get = async (tabId) => {
        if (tabId === 11) {
            return { id: 11, status: 'complete', url: 'https://docs.google.com/document/d/dup-doc/edit', discarded: false };
        }
        if (tabId === 21) {
            return { id: 21, status: 'complete', url: 'https://docs.google.com/document/d/other-doc/edit', discarded: false };
        }
        return { id: tabId, status: 'complete', url: 'https://docs.google.com/document/d/test/edit', discarded: false };
    };

    const duplicateDocSessions = {
        11: hooks.normalizeSession(11, {
            activeJob: hooks.createJob({
                text: 'A duplicate-run draft.',
                docKey: 'dup-doc',
                durationMins: 5,
                correctionIntensity: 'medium'
            }),
            activeRunId: 'run_dup_conflict',
            state: hooks.SESSION_STATES.RUNNING
        }),
        12: hooks.normalizeSession(12, {})
    };
    const conflictingDocRun = await hooks.findConflictingSessionForDoc(duplicateDocSessions, 12, 'dup-doc');
    assert.equal(conflictingDocRun?.tabId, 11, 'Background runtime should detect another active run already attached to the same Google Doc.');

    const staleDocSessions = {
        21: hooks.normalizeSession(21, {
            activeJob: hooks.createJob({
                text: 'A stale session that moved away from the original Doc.',
                docKey: 'dup-doc',
                durationMins: 5,
                correctionIntensity: 'medium'
            }),
            activeRunId: 'run_stale_duplicate',
            state: hooks.SESSION_STATES.RUNNING
        }),
        22: hooks.normalizeSession(22, {})
    };
    const staleConflict = await hooks.findConflictingSessionForDoc(staleDocSessions, 22, 'dup-doc');
    assert.equal(staleConflict, null, 'Background runtime should ignore sessions whose original tab is no longer on the same Google Doc.');

    let probeAttempts = 0;
    let injectionCount = 0;
    backgroundSandbox.chrome.tabs.get = async (tabId) => {
        return { id: tabId, status: 'complete', url: 'https://docs.google.com/document/d/fresh-doc/edit', discarded: false };
    };
    backgroundSandbox.chrome.tabs.sendMessage = async (_tabId, message) => {
        if (message.type === 'writerdrip:query-status') {
            return { status: 'ok', runtime: { state: 'running', percent: 0, eta: '00:10', actionIndex: 0, totalActions: 1 } };
        }
        if (message.type === 'writerdrip:probe-editor') {
            probeAttempts += 1;
            return probeAttempts === 1
                ? { status: 'error', message: 'Unknown runner message: writerdrip:probe-editor' }
                : { status: 'ok', ready: true, message: 'Ready after refresh.', checks: [] };
        }
        return { status: 'ok' };
    };
    backgroundSandbox.chrome.scripting.executeScript = async () => {
        injectionCount += 1;
    };
    const refreshedPreflight = await hooks.runPreflightCheck(99, 'fresh-doc');
    assert.equal(refreshedPreflight.ready, true, 'Preflight should recover from a stale content runner by reinjecting once.');
    assert.equal(probeAttempts, 2, 'Preflight should retry the original probe after refreshing the runner.');
    assert.equal(injectionCount, 1, 'Preflight should reinject the runner once for stale content scripts.');
}

async function validatePopupRuntime() {
    const popupSandbox = createPopupSandbox();
    await evaluateScript(popupSandbox, 'shared.js');
    await evaluateScript(popupSandbox, 'popup.js');
    await flushMicrotasks();

    const hooks = popupSandbox.__writerdripPopupTestHooks;
    assert.ok(hooks, 'popup.js should expose popup test hooks.');
    assert.equal(
        hooks.shouldUseCompatibilityPreflight({ ok: false, errorCode: 'unknown-command', error: 'Unknown command: ui:preflight' }),
        true,
        'Popup should fall back to compatibility preflight when a stale background worker does not understand ui:preflight.'
    );
    assert.equal(
        hooks.shouldUseCompatibilityPreflight({ ok: false, errorCode: 'background-unavailable', error: 'Unable to reach the background worker.' }),
        false,
        'Popup should not treat a missing background worker as a compatibility-only case.'
    );

    const compatibilityReady = hooks.buildCompatibilityPreflightReport({
        tabId: 1,
        pageKind: 'google-doc',
        text: 'A draft that is ready to start in the current Google Doc.',
        durationValue: 8
    });
    assert.equal(compatibilityReady.ready, true, 'Compatibility preflight should pass when the local popup checks are satisfied.');
    assert.match(
        compatibilityReady.note,
        /compatibility|background worker refreshes|chrome:\/\/extensions/i,
        'Compatibility preflight should explain why the local check is being used.'
    );

    const compatibilityBlocked = hooks.buildCompatibilityPreflightReport({
        tabId: 1,
        pageKind: 'google-doc',
        text: 'A much longer draft with enough text to need a longer minimum duration before it can finish cleanly.',
        durationValue: 0.5
    });
    assert.equal(compatibilityBlocked.ready, false, 'Compatibility preflight should still block invalid local draft inputs.');
    assert.equal(
        compatibilityBlocked.checks.some((check) => check.id === 'duration' && check.pass === false),
        true,
        'Compatibility preflight should surface a failed duration check when the chosen time is too short.'
    );

    const normalizedResumeConfidence = hooks.normalizeResumeConfidenceReport({
        canResume: true,
        confidence: 'high',
        message: 'Resume looks safe.',
        checks: [{ id: 'doc', label: 'Same Google Doc', pass: true, detail: 'Ready.' }]
    });
    assert.equal(normalizedResumeConfidence.canResume, true, 'Popup resume-confidence normalization should preserve the resumable state.');
    assert.equal(normalizedResumeConfidence.confidence, 'high', 'Popup resume-confidence normalization should preserve the confidence label.');
    assert.equal(normalizedResumeConfidence.checks.length, 1, 'Popup resume-confidence normalization should preserve recovery checks.');
    assert.equal(
        hooks.formatRecoveryConfidence({ canResume: true, confidence: 'high' }),
        'Ready',
        'Safe Resume should surface a clear ready state.'
    );
    assert.equal(
        hooks.formatRecoveryConfidence({ canResume: false, confidence: 'blocked', code: 'page-changed' }),
        'Doc changed',
        'Safe Resume should distinguish changed document state.'
    );
    assert.equal(
        hooks.formatRecoveryConfidence({ canResume: false, confidence: 'low', code: 'editor-not-ready' }),
        'Needs click in Doc',
        'Safe Resume should tell users when the editor needs a click.'
    );
    assert.equal(
        hooks.formatRecoveryConfidence({ canResume: false, confidence: 'low', code: 'tab-suspended' }),
        'Needs click in Doc',
        'Safe Resume should treat suspended tabs as a click/reopen recovery path.'
    );
    assert.equal(
        hooks.formatRecoveryConfidence({ canResume: false, confidence: 'low', code: 'manual-interaction' }),
        'Needs click in Doc',
        'Safe Resume should treat manual interaction as a Doc-click recovery path.'
    );
    assert.equal(hooks.canResumeAttentionState('manual-interaction'), true, 'Manual-interaction attention should be recoverable after the user reviews the Doc.');
    assert.equal(hooks.canResumeAttentionState('typing-context-lost'), true, 'Lost typing context should be recoverable after closing competing editor fields.');
    assert.match(
        hooks.buildRecoveryWizard('manual-interaction').steps.join(' '),
        /Resume if the document still looks correct/i,
        'Manual-interaction recovery steps should guide users back to Resume instead of forcing restart.'
    );
    assert.equal(
        hooks.shouldBlockResumeButton(true, { status: 'ready', report: { canResume: false, code: 'manual-interaction' } }),
        false,
        'A stale failed resume-confidence report should not disable the Resume button; clicking Resume forces a fresh check.'
    );
    assert.equal(
        hooks.shouldBlockResumeButton(true, { status: 'loading', report: null }),
        true,
        'Resume should only be disabled while the fresh resume-confidence check is actively loading.'
    );
    assert.equal(
        hooks.isSafetyPause(hooks.normalizePauseReason({ code: 'manual-interaction', message: 'Paused after a click.' })),
        true,
        'Popup should distinguish safety pauses from normal manual pauses.'
    );
    assert.equal(
        hooks.isSafetyPause(hooks.normalizePauseReason({ code: 'manual-pause', message: 'Paused from the popup.' })),
        false,
        'Popup should keep normal user pauses distinct from safety pauses.'
    );

    const durationElement = popupSandbox.document.getElementById('duration');
    durationElement.value = '12abc';
    assert.equal(hooks.readDurationInputValue(null), null, 'Popup duration parsing should reject mixed numeric/text values.');
    durationElement.value = '12.5';
    assert.equal(hooks.readDurationInputValue(null), 12.5, 'Popup duration parsing should still accept numeric decimal input before normalization.');

    const localDebugReport = hooks.buildLocalDebugReport({
        pageKind: 'google-doc',
        selectedCorrectionIntensity: 'medium',
        durationValue: 12,
        issueCode: 'editor-not-ready',
        draftText: 'Secret popup draft phrase that should not be copied.',
        draft: {
            hasDraft: true,
            wordCount: 9,
            charCount: 52,
            minimumDurationMins: 4,
            recommendedDurationMins: 7,
            suggestedCorrectionLabel: 'Secret popup label'
        },
        preflight: {
            ready: false,
            code: 'Secret popup issue',
            checks: [{ id: 'Secret popup check', pass: false }]
        }
    });
    assert.doesNotMatch(
        JSON.stringify(localDebugReport),
        /Secret popup draft phrase|Secret popup label|Secret popup issue|Secret popup check/i,
        'Popup fallback debug reports should not include draft text or unexpected diagnostic strings.'
    );
    assert.equal(localDebugReport.extension.version, '1.0.2', 'Popup fallback debug reports should include the extension version.');
    assert.equal(localDebugReport.popup.preflight.failedCheckIds[0], 'check-redacted', 'Popup fallback debug reports should redact unexpected failed check ids.');

    const normalizedSummary = hooks.normalizeUiRunSummary({
        wordCount: 12,
        timerDriftAdjustments: 2,
        delayedBySeconds: 17.4,
        text: 'Secret run summary draft',
        preview: 'Secret preview',
        completionCheckPassed: true
    });
    assert.equal(normalizedSummary.wordCount, 12, 'Popup run summary normalization should preserve safe counts.');
    assert.equal(normalizedSummary.timerDriftAdjustments, 2, 'Popup run summary normalization should preserve timer drift adjustment counts.');
    assert.equal(normalizedSummary.delayedBySeconds, 17.4, 'Popup run summary normalization should preserve timer drift delay totals.');
    assert.doesNotMatch(JSON.stringify(normalizedSummary), /Secret/i, 'Popup run summary normalization should drop unexpected text-like fields.');
}

async function validatePlanner() {
    const sandbox = createContentSandbox();
    await evaluateScript(sandbox, 'shared.js');
    await evaluateScript(sandbox, 'content.js');

    const hooks = sandbox.__writerdripTestHooks;
    assert.ok(hooks, 'content.js should expose planner test hooks.');

    const fakeToolbarTarget = {
        nodeType: 1,
        parentElement: null,
        matches() { return false; },
        closest(selector) {
            return selector.includes('.docs-toolbar') ? {} : null;
        }
    };
    const fakePageTarget = {
        nodeType: 1,
        parentElement: null,
        matches() { return false; },
        closest(selector) {
            return selector.includes('.kix-page') ? {} : null;
        }
    };
    assert.equal(hooks.eventTargetsGoogleDocsTypingSurface(fakeToolbarTarget), false, 'Clicks in Google Docs toolbar chrome should not be treated as document-body typing interference.');
    assert.equal(hooks.eventTargetsGoogleDocsTypingSurface(fakePageTarget), true, 'Clicks on the Google Docs page surface should still be treated as document-body interaction.');
    const timerStats = hooks.buildRunActionStats([], null, {
        timerDriftAdjustments: 3,
        delayedBySeconds: 22.6
    });
    assert.equal(timerStats.timerDriftAdjustments, 3, 'Run stats should preserve timer drift adjustment counts.');
    assert.equal(timerStats.delayedBySeconds, 22.6, 'Run stats should preserve timer drift delay totals.');

    const shared = sandbox.WriterDripShared;
    const scenarios = [
        {
            label: 'short-note',
            text: 'This is a short note with one paragraph and a quick ending.',
            durationMins: 6,
            intensities: ['suggested', 'low', 'medium']
        },
        {
            label: 'long-prose',
            text: [
                'The writing session opened with a small note about timing and clarity.',
                '',
                'A longer paragraph followed, with multiple sentences, commas, and pauses that gave the planner room to space work out. The draft keeps moving without turning into noise, and it still needs to resolve back to the original text every single time.',
                '',
                'By the end of the draft, the system should still know how to recover, keep corrections bounded, and finish with the exact final wording the user started with.'
            ].join('\n'),
            durationMins: 240,
            intensities: ['suggested', 'medium', 'high']
        },
        {
            label: 'technical',
            text: 'HTTP STATUS: 200 OK\nAPI_KEY=disabled\nUse the CONFIG object, not the legacy parser.',
            durationMins: 30,
            intensities: ['suggested', 'low', 'high']
        },
        {
            label: 'protected-url-email-and-quotes',
            text: 'Email test@example.com, keep https://example.com/path, quote "exact text", and leave CODE_VALUE=ready alone.',
            durationMins: 120,
            intensities: ['suggested', 'high']
        },
        {
            label: 'confusables',
            text: 'The council will advise whether the principal should affect the final outcome or alter the plan before the weather changes.',
            durationMins: 180,
            intensities: ['high']
        }
    ];

    for (const scenario of scenarios) {
        for (const intensity of scenario.intensities) {
            const seconds = scenario.durationMins * 60;
            for (let seed = 1; seed <= 40; seed += 1) {
                const actions = hooks.buildActionPlan(scenario.text, seconds, seed, intensity);
                const replayed = hooks.replayActionPlan(actions);
                assert.equal(replayed, scenario.text, `${scenario.label}:${intensity}:${seed} should replay to the original draft.`);
                const profile = hooks.buildDraftMistakeProfile(Array.from(scenario.text), seconds, intensity);
                const validation = hooks.validateActionPlan(scenario.text, profile, actions);
                assert.equal(validation.ok, true, `${scenario.label}:${intensity}:${seed} should pass planner validation.`);
            }
        }
    }

    const titleCaseText = 'Principal writers should consult the Council before the Weather changes.';
    for (let seed = 1; seed <= 80; seed += 1) {
        const actions = hooks.buildActionPlan(titleCaseText, 240 * 60, seed, 'high');
        const titleCaseWordVariants = actions.filter((action) => action?.kind === 'word-variant-output');
        assert.equal(titleCaseWordVariants.length, 0, 'TitleCase words should not trigger confusable-word substitutions.');
    }

    const alreadyMistypedDraft = 'I definately wrote this becuase the seperate goverment calender felt importent and neccessary.';
    for (let seed = 1; seed <= 80; seed += 1) {
        const actions = hooks.buildActionPlan(alreadyMistypedDraft, 240 * 60, seed, 'high');
        const replayed = hooks.replayActionPlan(actions);
        assert.equal(replayed, alreadyMistypedDraft, `Already-mistyped draft ${seed} should still replay exactly.`);
        const wordVariants = collectWordVariantOutputs(actions);
        assert.equal(wordVariants.length, 0, 'One-way misspelling variants should not type a corrected word and then repair back to a misspelling.');
    }

    const phraseVariantBase = 'everyday everyone already thought something was alright because this sentence should stay exact.';
    const phraseVariantDraft = [phraseVariantBase, phraseVariantBase, phraseVariantBase, phraseVariantBase].join(' ');
    const phraseVariantOutputs = new Set();
    for (let seed = 1; seed <= 140; seed += 1) {
        const actions = hooks.buildActionPlan(phraseVariantDraft, 300 * 60, seed, 'high');
        assert.equal(hooks.replayActionPlan(actions), phraseVariantDraft, `Phrase variant draft ${seed} should replay exactly.`);
        for (const word of collectWordVariantOutputs(actions)) {
            phraseVariantOutputs.add(word);
        }
    }
    assert.ok(
        ['every day', 'every one', 'all right', 'allready', 'somthing'].some((word) => phraseVariantOutputs.has(word)),
        `Phrase-style variants should be supported safely. Saw: ${Array.from(phraseVariantOutputs).sort().join(', ')}`
    );

    const lowercaseVariantText = 'The principal should advise the council about the weather before they alter the final effect of the plan.';
    const lowercaseVariantProfile = hooks.buildDraftMistakeProfile(Array.from(lowercaseVariantText.repeat(8)), 420 * 60, 'high');
    assert.ok(
        lowercaseVariantProfile.wordVariantChance > 0 && lowercaseVariantProfile.maxWordVariantMistakes > 0,
        'High-intensity prose should still allow lowercase word-level variants in the planner profile.'
    );

    const structuredDraftAnalysis = shared.analyzeDraftText('HTTP_STATUS=200\nCONFIG={READY:true}', 30);
    assert.equal(structuredDraftAnalysis.suggestedCorrectionIntensity, 'low', 'Structured drafts should suggest low correction intensity.');
    assert.match(structuredDraftAnalysis.suggestedCorrectionReason, /structured|technical/i, 'Structured drafts should explain why the suggestion stayed low.');
    const structuredHighDuration = shared.analyzeDraftText('HTTP_STATUS=200\nCONFIG={READY:true}', { durationMins: 30, correctionIntensity: 'high' });
    assert.match(structuredHighDuration.recommendedDurationReason, /conservative|structured text|tighter leash/i, 'Structured drafts should keep high-intensity duration messaging conservative.');

    const shortDraftAnalysis = shared.analyzeDraftText('Quick note to finish tonight.', 5);
    assert.equal(shortDraftAnalysis.suggestedCorrectionIntensity, 'low', 'Very short drafts should stay on low suggestion.');
    assert.match(shortDraftAnalysis.suggestedCorrectionReason, /short/i, 'Short drafts should explain that they are too short for stronger correction behavior.');
    assert.ok(shortDraftAnalysis.recommendedDurationMins >= shortDraftAnalysis.minimumDurationMins, 'Recommended duration should never fall below the minimum duration.');
    assert.ok(shortDraftAnalysis.suggestedCorrectionNormalizedScore >= 0 && shortDraftAnalysis.suggestedCorrectionNormalizedScore <= 1, 'Suggested correction scores should be normalized to a 0-1 range.');
    assert.ok(!/^(low|medium|high)$/i.test(shortDraftAnalysis.suggestedCorrectionLabel), 'Suggested correction labels should use adaptive wording instead of the manual presets.');
    assert.equal(shared.normalizeDurationMins('2.2', 1), 3, 'Duration normalization should round partial minutes up.');
    assert.equal(shared.normalizeDurationMins('0.2', 5), 5, 'Duration normalization should respect the current draft minimum.');
    assert.equal(shared.normalizeDurationMins('abc', 5), null, 'Duration normalization should reject invalid numeric input.');
    const accentedDraftAnalysis = shared.analyzeDraftText('Café naïve résumé. Voilà, déjà vu in plain prose.', { durationMins: 30, correctionIntensity: 'suggested' });
    assert.equal(accentedDraftAnalysis.looksStructured, false, 'Accented prose should not be misclassified as structured text.');

    const balancedDraftAnalysis = shared.analyzeDraftText(
        'This draft is long enough to feel like normal prose, but it is not massive. It has a few sentences, some commas, and a steady rhythm throughout the paragraph.',
        60
    );
    assert.equal(balancedDraftAnalysis.suggestedCorrectionIntensity, 'medium', 'Balanced prose should land on medium suggestion.');
    assert.ok(balancedDraftAnalysis.suggestedCorrectionNormalizedScore > shortDraftAnalysis.suggestedCorrectionNormalizedScore, 'Balanced prose should score higher on the adaptive suggested scale than a short note.');
    const balancedLowDuration = shared.analyzeDraftText(
        'This draft is long enough to feel like normal prose, but it is not massive. It has a few sentences, some commas, and a steady rhythm throughout the paragraph.',
        { durationMins: 60, correctionIntensity: 'low' }
    );
    const balancedMediumDuration = shared.analyzeDraftText(
        'This draft is long enough to feel like normal prose, but it is not massive. It has a few sentences, some commas, and a steady rhythm throughout the paragraph.',
        { durationMins: 60, correctionIntensity: 'medium' }
    );
    const balancedHighDuration = shared.analyzeDraftText(
        'This draft is long enough to feel like normal prose, but it is not massive. It has a few sentences, some commas, and a steady rhythm throughout the paragraph.',
        { durationMins: 60, correctionIntensity: 'high' }
    );
    assert.ok(balancedLowDuration.recommendedDurationMins < balancedMediumDuration.recommendedDurationMins, 'Balanced prose should recommend more time for medium than low correction intensity.');
    assert.ok(balancedMediumDuration.recommendedDurationMins < balancedHighDuration.recommendedDurationMins, 'Balanced prose should recommend more time for high than medium correction intensity.');
    const balancedPreviewModes = Object.fromEntries(balancedDraftAnalysis.correctionPreview.modes.map((mode) => [mode.id, mode]));
    assert.ok(balancedPreviewModes.low.estimatedRepairs < balancedPreviewModes.medium.estimatedRepairs, 'Correction preview should show medium as more active than low.');
    assert.ok(balancedPreviewModes.medium.estimatedRepairs < balancedPreviewModes.high.estimatedRepairs, 'Correction preview should show high as more active than medium.');
    assert.ok(balancedPreviewModes.high.estimatedRepairs >= balancedPreviewModes.medium.estimatedRepairs * 1.8, 'Correction preview should show high as much stronger than medium.');
    assert.ok(balancedPreviewModes.high.delayedRepairs >= balancedPreviewModes.medium.delayedRepairs, 'Correction preview should connect high mode to more delayed repairs.');
    assert.equal(balancedPreviewModes.high.repairDepth, 'intense', 'Correction preview should label high as intense depth.');
    assert.match(balancedDraftAnalysis.correctionPreview.selectedMode.summary, /repairs|pause/i, 'Correction preview should include a user-facing estimate summary.');

    const longDraftAnalysis = shared.analyzeDraftText(scenarios[1].text, scenarios[1].durationMins);
    assert.equal(longDraftAnalysis.suggestedCorrectionIntensity, 'medium', 'Long relaxed prose should stay below explicit high when suggested mode is being conservative.');
    assert.ok(longDraftAnalysis.suggestedCorrectionSignals.length > 0, 'Suggested intensity should include explanation signals for longer prose.');
    assert.ok(longDraftAnalysis.suggestedCorrectionNormalizedScore > balancedDraftAnalysis.suggestedCorrectionNormalizedScore, 'Long relaxed prose should score higher on the adaptive suggested scale than balanced prose.');
    assert.ok(longDraftAnalysis.recommendedDurationMins > longDraftAnalysis.minimumDurationMins, 'Long prose should recommend more time than the hard minimum.');
    assert.match(longDraftAnalysis.recommendedDurationReason, /recommended|room|pacing|corrections/i, 'Recommended duration should explain why extra headroom helps the draft.');
    const longTightSuggested = shared.analyzeDraftText(scenarios[1].text, { durationMins: 2, correctionIntensity: 'suggested' });
    assert.ok(longTightSuggested.suggestedCorrectionNormalizedScore < longDraftAnalysis.suggestedCorrectionNormalizedScore, 'The same long draft should get a lighter adaptive suggested score when the chosen duration is much tighter.');
    const longLowDuration = shared.analyzeDraftText(scenarios[1].text, { durationMins: scenarios[1].durationMins, correctionIntensity: 'low' });
    const longMediumDuration = shared.analyzeDraftText(scenarios[1].text, { durationMins: scenarios[1].durationMins, correctionIntensity: 'medium' });
    const longHighDuration = shared.analyzeDraftText(scenarios[1].text, { durationMins: scenarios[1].durationMins, correctionIntensity: 'high' });
    assert.equal(longHighDuration.recommendedDurationIntensity, 'high', 'The duration recommendation should reflect the selected correction intensity.');
    assert.ok(longLowDuration.recommendedDurationMins < longMediumDuration.recommendedDurationMins, 'Long prose should recommend more time for medium than low correction intensity.');
    assert.ok(longMediumDuration.recommendedDurationMins < longHighDuration.recommendedDurationMins, 'Long prose should recommend more time for high than medium correction intensity.');
    assert.ok(longHighDuration.recommendedDurationMins > shortDraftAnalysis.recommendedDurationMins, 'Long prose should recommend more time than a short note.');

    const longChars = Array.from(scenarios[1].text);
    const lowProfile = hooks.buildDraftMistakeProfile(longChars, scenarios[1].durationMins * 60, 'low');
    const mediumProfile = hooks.buildDraftMistakeProfile(longChars, scenarios[1].durationMins * 60, 'medium');
    const highProfile = hooks.buildDraftMistakeProfile(longChars, scenarios[1].durationMins * 60, 'high');

    assert.ok(lowProfile.maxMistakes < mediumProfile.maxMistakes, 'Low intensity should budget fewer mistakes than medium on long prose.');
    assert.ok(mediumProfile.maxMistakes < highProfile.maxMistakes, 'High intensity should budget more mistakes than medium on long prose.');
    assert.ok(highProfile.maxMistakes >= mediumProfile.maxMistakes * 4, 'High intensity should now have a substantially larger repair budget than medium.');
    assert.ok(lowProfile.cooldownChars > mediumProfile.cooldownChars, 'Low intensity should space mistakes farther apart than medium.');
    assert.ok(mediumProfile.cooldownChars > highProfile.cooldownChars, 'High intensity should allow tighter spacing than medium.');
    assert.ok(highProfile.minMistakeSpacingChars <= Math.round(mediumProfile.minMistakeSpacingChars * 0.45), 'High intensity should allow much tighter mistake spacing than medium.');
    assert.equal(lowProfile.wordVariantChance, 0, 'Low intensity should disable larger word-level variants.');
    assert.ok(highProfile.wordVariantChance > mediumProfile.wordVariantChance, 'High intensity should allow stronger word-level variant behavior than medium.');
    assert.ok(highProfile.wordVariantChance >= 0.35, 'High intensity should make word-level variants noticeably available on prose drafts.');
    assert.ok(highProfile.maxWordVariantMistakes >= 3, 'High intensity should allow multiple common word-level mistakes when the draft supports them.');
    assert.ok(highProfile.vowelSlipChance > mediumProfile.vowelSlipChance, 'High intensity should allow more vowel-drift mistakes than medium.');
    assert.ok(mediumProfile.vowelSlipChance > lowProfile.vowelSlipChance, 'Medium intensity should allow more vowel-drift mistakes than low.');
    assert.ok(highProfile.softSlipChance > mediumProfile.softSlipChance, 'High intensity should allow more nearby-letter slips than medium.');
    assert.ok(highProfile.keyboardSlipChance > lowProfile.keyboardSlipChance, 'High intensity should allow more keyboard-neighbor slips than low.');
    assert.ok(highProfile.punctuationSubstitutionChance > mediumProfile.punctuationSubstitutionChance, 'High intensity should allow more punctuation substitutions than medium.');
    assert.ok(mediumProfile.punctuationSubstitutionChance > lowProfile.punctuationSubstitutionChance, 'Medium intensity should allow more punctuation substitutions than low.');
    assert.ok(highProfile.multiPunctuationChance > mediumProfile.multiPunctuationChance, 'High intensity should allow more multi-punctuation bursts than medium.');
    assert.ok(mediumProfile.multiPunctuationChance >= lowProfile.multiPunctuationChance, 'Medium intensity should preserve at least as much multi-punctuation room as low.');
    assert.ok(highProfile.repairMessinessChance > mediumProfile.repairMessinessChance, 'High intensity should allow messier repairs than medium.');
    assert.ok(mediumProfile.repairMessinessChance > lowProfile.repairMessinessChance, 'Medium intensity should allow messier repairs than low.');
    assert.ok(highProfile.repairDepthFactor > mediumProfile.repairDepthFactor, 'High intensity should allow deeper repairs than medium.');
    assert.ok(mediumProfile.repairDepthFactor > lowProfile.repairDepthFactor, 'Medium intensity should allow deeper repairs than low.');
    assert.ok(highProfile.lingeringRepairChance > mediumProfile.lingeringRepairChance, 'High intensity should leave more room for later corrections than medium.');
    assert.ok(mediumProfile.lingeringRepairChance > lowProfile.lingeringRepairChance, 'Medium intensity should leave more room for later corrections than low.');
    assert.ok(highProfile.sentenceCarryChance > mediumProfile.sentenceCarryChance, 'High intensity should allow more sentence-carry repairs than medium.');
    assert.ok(mediumProfile.sentenceCarryChance >= lowProfile.sentenceCarryChance, 'Medium intensity should preserve at least as much sentence-carry room as low.');
    assert.ok(lowProfile.cadenceProfile && mediumProfile.cadenceProfile && highProfile.cadenceProfile, 'Draft profiles should carry a cadence profile.');
    assert.ok(highProfile.cadenceProfile.connectivePauseChance >= mediumProfile.cadenceProfile.connectivePauseChance, 'Richer drafts should preserve smarter cadence settings.');

    const sampledMistakeTypes = new Map();
    for (let seed = 1; seed <= 400; seed += 1) {
        const type = hooks.selectMistakeType(() => {
            let value = seed * 9301 + 49297;
            value %= 233280;
            return value / 233280;
        }, highProfile, {
            char: 'e',
            wordLength: 6,
            offsetInWord: 2,
            remainingInWord: 3,
            canCaseMistake: true,
            canLetterMistake: true,
            isSentenceStart: false,
            isStandaloneI: false
        }, 'e', 'r', { recentTypes: [], segmentCounts: [], sentenceCounts: new Map(), sentenceIds: [], lastMistakeIndex: -Infinity, wordVariantCount: 0 });
        sampledMistakeTypes.set(type, (sampledMistakeTypes.get(type) || 0) + 1);
    }

    assert.ok(sampledMistakeTypes.get('key') > 0, 'High-intensity selection should still leave room for keyboard-neighbor slips.');

    function sampleMistakeTypeCounts(currentChar, nextChar = 'r') {
        const counts = new Map();
        for (let seed = 1; seed <= 400; seed += 1) {
            const type = hooks.selectMistakeType(() => {
                let value = seed * 9301 + 49297;
                value %= 233280;
                return value / 233280;
            }, highProfile, {
                char: currentChar,
                wordLength: 6,
                offsetInWord: 2,
                remainingInWord: 3,
                canCaseMistake: true,
                canLetterMistake: true,
                isSentenceStart: false,
                isStandaloneI: false
            }, currentChar, nextChar, { recentTypes: [], segmentCounts: [], sentenceCounts: new Map(), sentenceIds: [], lastMistakeIndex: -Infinity, wordVariantCount: 0 });
            counts.set(type, (counts.get(type) || 0) + 1);
        }
        return counts;
    }

    const vowelCounts = sampleMistakeTypeCounts('e');
    const stableHomeRowCounts = sampleMistakeTypeCounts('g');
    assert.ok((vowelCounts.get('omit') || 0) > (stableHomeRowCounts.get('omit') || 0), 'Frequent vowels should bias omission mistakes more than stable home-row letters.');

    const intensityAverages = {
        low: { repairs: 0, variants: 0, backspaces: 0 },
        medium: { repairs: 0, variants: 0, backspaces: 0 },
        high: { repairs: 0, variants: 0, backspaces: 0 }
    };
    for (let seed = 1; seed <= 30; seed += 1) {
        for (const intensity of ['low', 'medium', 'high']) {
            const actions = hooks.buildActionPlan(scenarios[1].text, scenarios[1].durationMins * 60, seed, intensity);
            intensityAverages[intensity].repairs += actions.filter((action) => action?.kind === 'repair-pause').length;
            intensityAverages[intensity].variants += actions.filter((action) => action?.kind === 'word-variant-output').length;
            intensityAverages[intensity].backspaces += actions.filter((action) => action?.kind === 'repair-backspace').length;
        }
    }

    assert.ok(intensityAverages.low.repairs < intensityAverages.medium.repairs, 'Low intensity should schedule fewer repair sequences than medium.');
    assert.ok(intensityAverages.medium.repairs < intensityAverages.high.repairs, 'High intensity should schedule more repair sequences than medium.');
    assert.ok(intensityAverages.low.backspaces < intensityAverages.medium.backspaces, 'Low intensity should create shallower repairs than medium.');
    assert.ok(intensityAverages.medium.backspaces < intensityAverages.high.backspaces, 'High intensity should create deeper repairs than medium.');
    assert.ok(intensityAverages.low.repairs <= intensityAverages.medium.repairs * 0.55, 'Low intensity should remain subtle compared with medium on long prose.');
    assert.ok(intensityAverages.medium.repairs >= Math.max(30, intensityAverages.low.repairs * 2), 'Medium intensity should feel noticeably more active than low on long prose.');
    assert.ok(intensityAverages.high.repairs >= intensityAverages.medium.repairs * 1.6, 'High intensity should schedule substantially more repair sequences than medium on long prose.');
    assert.ok(intensityAverages.high.backspaces >= intensityAverages.medium.backspaces * 1.8, 'High intensity should create much deeper repairs than medium on long prose.');

    const shortContrastText = 'This is a shorter draft with a couple of sentences, a comma, and enough plain prose to see whether correction modes feel clearly different when the sample is not especially long.';
    const shortContrastAverages = {
        low: { repairs: 0, backspaces: 0 },
        medium: { repairs: 0, backspaces: 0 },
        high: { repairs: 0, backspaces: 0 }
    };
    for (let seed = 1; seed <= 60; seed += 1) {
        for (const intensity of ['low', 'medium', 'high']) {
            const actions = hooks.buildActionPlan(shortContrastText, 90 * 60, seed, intensity);
            shortContrastAverages[intensity].repairs += actions.filter((action) => action?.kind === 'repair-pause').length;
            shortContrastAverages[intensity].backspaces += actions.filter((action) => action?.kind === 'repair-backspace').length;
        }
    }

    assert.ok(shortContrastAverages.medium.repairs > shortContrastAverages.low.repairs, 'Medium intensity should still produce more correction activity than low on shorter prose.');
    assert.ok(shortContrastAverages.high.repairs >= shortContrastAverages.medium.repairs * 1.6, 'High intensity should stand apart clearly from medium even on shorter prose.');
    assert.ok(shortContrastAverages.high.backspaces >= shortContrastAverages.medium.backspaces * 1.8, 'High intensity should backtrack much more than medium on shorter prose.');

    let delayedRepairSequences = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
        const actions = hooks.buildActionPlan(scenarios[1].text, scenarios[1].durationMins * 60, seed, 'high');
        let activeMistakeIndex = -1;
        for (let index = 0; index < actions.length; index += 1) {
            const action = actions[index];
            if (action?.kind === 'mistake-output' && activeMistakeIndex === -1) {
                activeMistakeIndex = index;
                continue;
            }

            if (action?.kind === 'repair-pause' && activeMistakeIndex !== -1) {
                const carriedChars = actions
                    .slice(activeMistakeIndex + 1, index)
                    .filter((candidate) => candidate?.char && candidate.char !== 'backspace' && candidate.kind !== 'mistake-output')
                    .length;
                if (carriedChars >= 3) {
                    delayedRepairSequences += 1;
                }
                activeMistakeIndex = -1;
            }
        }
    }
    assert.ok(delayedRepairSequences > 0, 'High-intensity prose should sometimes carry a mistake forward before repairing it.');
    const variantHeavyText = `${lowercaseVariantText} ${lowercaseVariantText} ${lowercaseVariantText} ${lowercaseVariantText} ${lowercaseVariantText} ${lowercaseVariantText} ${lowercaseVariantText} ${lowercaseVariantText}`;
    const variantAverages = {
        low: 0,
        medium: 0,
        high: 0
    };
    for (let seed = 1; seed <= 30; seed += 1) {
        for (const intensity of ['low', 'medium', 'high']) {
            const actions = hooks.buildActionPlan(variantHeavyText, 420 * 60, seed, intensity);
            variantAverages[intensity] += actions.filter((action) => action?.kind === 'word-variant-output').length;
        }
    }

    assert.equal(variantAverages.low, 0, 'Low intensity should keep larger word-level variants disabled.');
    assert.ok(variantAverages.high > variantAverages.medium, 'High intensity should trigger more word-level variant outputs than medium on confusable-heavy prose.');

    const commonMistakeText = [
        'Because I definitely believe the separate government calendar is necessary, I will receive the available writing about business tomorrow.',
        'My friend at college really noticed weird grammar in the argument, and the privilege of knowledge should not affect the weather.',
        'The category and exercise notes are coming through, but the beginning still needs careful review.',
        'The team will accommodate an achievement that apparently became convenient after an embarrassing environment problem.',
        'The experience felt independent because the maintenance was occasionally successful, and the responsibility to recommend changes stayed important.',
        'An acceptable answer can acquire confidence from a brilliant colleague, a careful decision, and an efficient description.',
        'The professional schedule mentioned rhythm, science, sentences, preparation, and an unfortunate summary of the performance.'
    ].join(' ');
    const commonVariantWords = new Set();
    for (let seed = 1; seed <= 120; seed += 1) {
        const actions = hooks.buildActionPlan(commonMistakeText.repeat(3), 360 * 60, seed, 'high');
        for (const word of collectWordVariantOutputs(actions)) {
            commonVariantWords.add(word);
        }
    }

    const expectedCommonVariants = [
        'becuase',
        'definately',
        'recieve',
        'seperate',
        'goverment',
        'calender',
        'neccessary',
        'freind',
        'grammer',
        'arguement',
        'accomodate',
        'acheivement',
        'apparantly',
        'convienient',
        'embarass',
        'enviroment',
        'experiance',
        'independant',
        'maintainance',
        'ocassionally',
        'reccomend',
        'responsiblity',
        'succesful',
        'acceptible',
        'aquire',
        'briliant',
        'collegue',
        'decison',
        'efficent',
        'discription',
        'proffesional',
        'scedule',
        'rythm',
        'sceince',
        'sentance',
        'preperation',
        'unfortunatly',
        'sumary',
        'preformance'
    ];
    const matchedCommonVariants = expectedCommonVariants.filter((word) => commonVariantWords.has(word));
    assert.ok(
        matchedCommonVariants.length >= 24,
        `High intensity should draw from the expanded common-mistake dataset. Saw: ${Array.from(commonVariantWords).sort().join(', ')}`
    );

    const longVariantText = [
        'The accommodate achievement apparently required convenient maintenance.',
        'The independent environment made the experience occasionally successful.',
        'The responsibility to recommend a relevant reference was important.'
    ].join(' ');
    const longVariantWords = new Set();
    for (let seed = 1; seed <= 180; seed += 1) {
        const actions = hooks.buildActionPlan(longVariantText.repeat(4), 420 * 60, seed, 'high');
        for (const word of collectWordVariantOutputs(actions)) {
            longVariantWords.add(word);
        }
    }
    const expectedLongVariants = [
        'accomodate',
        'acheivement',
        'apparantly',
        'convienient',
        'maintainance',
        'independant',
        'enviroment',
        'experiance',
        'ocassionally',
        'succesful',
        'responsiblity',
        'reccomend',
        'relavent',
        'refrence',
        'importent'
    ];
    assert.ok(
        expectedLongVariants.filter((word) => longVariantWords.has(word)).length >= 8,
        `High intensity should support longer word-level mistakes. Saw: ${Array.from(longVariantWords).sort().join(', ')}`
    );

    const patternDiversityText = [
        commonMistakeText,
        longVariantText,
        'I am in a hurry, but I still want the typing engine to feel varied, sloppy, and self-correcting around contractions like don\'t and hyphenated words like long-term.',
        'Wait, really? I paused, then rushed back in. Stop, start, breathe, and keep going while punctuation changes and settles.',
        'The writer moved through paragraphs with commas, corrections, small pauses, and a few words that could be confused later.'
    ].join('\n\n');
    const correctionPatternSignatures = new Set();
    const correctionFamilySignatures = new Set();
    for (let seed = 201; seed <= 216; seed += 1) {
        const actions = hooks.buildActionPlan(patternDiversityText, 540 * 60, seed, 'high');
        assert.equal(hooks.replayActionPlan(actions), patternDiversityText, `Pattern diversity draft ${seed} should replay exactly.`);
        correctionPatternSignatures.add(buildCorrectionPatternSignature(actions));
        correctionFamilySignatures.add(buildCorrectionFamilySignature(actions));
    }
    assert.ok(correctionPatternSignatures.size >= 14, 'High-intensity runs should not repeat the same correction pattern across nearby seeds.');
    assert.ok(correctionFamilySignatures.size >= 6, 'High-intensity runs should vary the mix of letter, spacing, punctuation, joiner, and word-level corrections.');

    const fourLetterSmallWordDraft = 'People waited with your notes from that room while they were ready and will return with your plan.';
    let fourLetterSmallWordSkips = 0;
    for (let seed = 1; seed <= 420; seed += 1) {
        const actions = hooks.buildActionPlan(fourLetterSmallWordDraft, 300 * 60, seed, 'high');
        assert.equal(hooks.replayActionPlan(actions), fourLetterSmallWordDraft, `Four-letter small-word draft ${seed} should replay exactly.`);
        fourLetterSmallWordSkips += actions.filter((action) => action?.kind === 'repair-pause' && action.mistakeType === 'small-word-skip').length;
    }
    assert.ok(fourLetterSmallWordSkips > 0, 'High intensity should support skipped function words up to four letters, such as with/from/that/your.');

    const richMistakeText = [
        'I am in a hurry, but I still want the typing engine to feel varied, a little sloppy, and self-correcting.',
        'Because the draft is long enough, it should sometimes miss a comma, drop a space, repeat a word, or skip a small word before fixing itself.',
        'I am going to the store, and I am also trying to see whether sentence starts, the letter I, punctuation slips, and contractions like don\'t, it\'s, I\'m, and we\'re or hyphenated words like long-term get corrected later.'
    ].join(' ');
    const mistakeTypeCounts = new Map();
    let repairSlipOutputCount = 0;
    for (let seed = 1; seed <= 260; seed += 1) {
        const actions = hooks.buildActionPlan(richMistakeText, 320 * 60, seed, 'high');
        for (const action of actions) {
            if (action?.kind === 'repair-pause' && action.mistakeType) {
                mistakeTypeCounts.set(action.mistakeType, (mistakeTypeCounts.get(action.mistakeType) || 0) + 1);
            }
            if (action?.kind === 'repair-slip-output') {
                repairSlipOutputCount += 1;
            }
        }
    }

    assert.ok((mistakeTypeCounts.get('punct-omit') || 0) > 0, 'High-intensity prose should allow omitted punctuation that is corrected later.');
    assert.ok((mistakeTypeCounts.get('space-before-punct') || 0) > 0, 'High-intensity prose should allow stray spaces before punctuation that are corrected later.');
    assert.ok(((mistakeTypeCounts.get('apostrophe-omit') || 0) + (mistakeTypeCounts.get('hyphen-omit') || 0)) > 0, 'High-intensity prose should allow missed joiners like apostrophes or hyphens that are corrected later.');
    assert.ok(((mistakeTypeCounts.get('space-omit') || 0) + (mistakeTypeCounts.get('double-space') || 0)) > 0, 'High-intensity prose should allow spacing mistakes that are corrected later.');
    assert.ok((mistakeTypeCounts.get('repeat-word') || 0) > 0, 'High-intensity prose should allow repeated-word mistakes that are corrected later.');
    assert.ok((mistakeTypeCounts.get('small-word-skip') || 0) > 0, 'High-intensity prose should allow skipped small-word mistakes that are corrected later.');
    assert.ok((mistakeTypeCounts.get('case') || 0) > 0, 'The planner should still allow capitalization mistakes that are corrected later.');
    assert.ok(repairSlipOutputCount > 0, 'High-intensity prose should occasionally include messier repair slips before settling on the final correction.');

    const punctuationHeavyText = [
        'Wait, really? I paused, then rushed back in. Stop, start, breathe, and keep going!',
        'Sometimes the sentence ends quickly. Sometimes it changes, lingers, and then snaps back into place.',
        'What now? Keep typing, keep correcting, and do not let the punctuation feel flat or repetitive!'
    ].join(' ');
    const punctuationMistakeCounts = new Map();
    for (let seed = 1; seed <= 420; seed += 1) {
        const actions = hooks.buildActionPlan(punctuationHeavyText, 360 * 60, seed, 'high');
        for (const action of actions) {
            if (action?.kind === 'repair-pause' && action.mistakeType) {
                punctuationMistakeCounts.set(action.mistakeType, (punctuationMistakeCounts.get(action.mistakeType) || 0) + 1);
            }
        }
    }

    assert.ok((punctuationMistakeCounts.get('punct-substitute') || 0) > 0, 'High-intensity prose should allow punctuation substitutions that are corrected later.');
    assert.ok((punctuationMistakeCounts.get('multi-punct') || 0) > 0, 'High-intensity prose should allow occasional multi-punctuation bursts that are corrected later.');
}

function collectWordVariantOutputs(actions) {
    const outputs = [];
    let buffer = '';

    for (const action of actions) {
        if (action?.kind === 'word-variant-output') {
            buffer += action.char || '';
            continue;
        }

        if (buffer) {
            outputs.push(buffer);
            buffer = '';
        }
    }

    if (buffer) {
        outputs.push(buffer);
    }

    return outputs;
}

function buildCorrectionPatternSignature(actions) {
    const parts = [];
    let visibleChars = 0;
    for (const action of actions) {
        if (action?.kind === 'repair-pause' && action.mistakeType) {
            parts.push(`${action.mistakeType}@${Math.floor(visibleChars / 24)}`);
            continue;
        }
        if (action?.char && action.char !== 'backspace') {
            visibleChars += 1;
        }
    }
    return parts.join('|');
}

function buildCorrectionFamilySignature(actions) {
    const counts = {
        letter: 0,
        spacing: 0,
        punctuation: 0,
        joiner: 0,
        word: 0
    };
    for (const action of actions) {
        if (action?.kind !== 'repair-pause' || !action.mistakeType) {
            continue;
        }
        const family = getMistakeFamilyForTest(action.mistakeType);
        counts[family] += 1;
    }
    return Object.entries(counts)
        .map(([family, count]) => `${family}:${count}`)
        .join('|');
}

function getMistakeFamilyForTest(type) {
    if (type === 'word-variant') {
        return 'word';
    }
    if (['space-omit', 'double-space', 'repeat-word', 'small-word-skip'].includes(type)) {
        return 'spacing';
    }
    if (['punct-omit', 'space-before-punct', 'punct-substitute', 'multi-punct'].includes(type)) {
        return 'punctuation';
    }
    if (['apostrophe-omit', 'hyphen-omit'].includes(type)) {
        return 'joiner';
    }
    return 'letter';
}

function createBackgroundSandbox() {
    const storageState = Object.create(null);
    const powerEvents = [];
    const sandbox = {
        console,
        globalThis: null,
        Promise,
        Math,
        Date,
        URL,
        setTimeout,
        clearTimeout,
        navigator: {
            userAgent: 'Mozilla/5.0 Chrome/123.0.0.0'
        },
        __powerEvents: powerEvents
    };
    sandbox.globalThis = sandbox;
    sandbox.chrome = {
        runtime: {
            onInstalled: { addListener() { } },
            onStartup: { addListener() { } },
            onMessage: { addListener() { } },
            getManifest() {
                return { name: 'WriterDrip', version: '1.0.2', manifest_version: 3 };
            }
        },
        alarms: {
            onAlarm: { addListener() { } },
            async get() { return null; },
            async create() { },
            async clear() { }
        },
        tabs: {
            onRemoved: { addListener() { } },
            onUpdated: { addListener() { } },
            async sendMessage(_tabId, message) {
                if (message?.type === 'writerdrip:probe-editor') {
                    return {
                        status: 'ok',
                        ready: true,
                        docKey: 'test',
                        checks: [
                            { id: 'doc', label: 'Same Google Doc', pass: true, detail: 'Ready.' },
                            { id: 'editor', label: 'Document editor detected', pass: true, detail: 'Ready.' },
                            { id: 'cursor', label: 'Typing context ready', pass: true, detail: 'Ready.' }
                        ],
                        message: 'WriterDrip is ready to resume in this Google Doc.'
                    };
                }
                return { status: 'ok', runtime: { state: 'running', percent: 0, eta: '00:10', actionIndex: 0, totalActions: 1 } };
            },
            async get(tabId) { return { id: tabId, status: 'complete', url: 'https://docs.google.com/document/d/test/edit', discarded: false }; },
            async update() { }
        },
        power: {
            requestKeepAwake(level) {
                powerEvents.push({ type: 'request', level });
            },
            releaseKeepAwake() {
                powerEvents.push({ type: 'release' });
            }
        },
        storage: {
            onChanged: { addListener() { } },
            local: {
                async setAccessLevel() { },
                async get(key) {
                    if (typeof key === 'string') {
                        return { [key]: storageState[key] };
                    }
                    return { ...storageState };
                },
                async set(values) {
                    Object.assign(storageState, values);
                }
            }
        },
        action: {
            async setBadgeText() { },
            async setBadgeBackgroundColor() { },
            async setTitle() { }
        },
        scripting: {
            async executeScript() { }
        }
    };
    sandbox.importScripts = (...paths) => {
        for (const relativePath of paths) {
            const absolutePath = path.join(rootDir, relativePath);
            const source = readFileSyncSafe(absolutePath);
            vm.runInContext(source, sandbox, { filename: relativePath });
        }
    };
    return vm.createContext(sandbox);
}

function createPopupSandbox() {
    const elements = new Map();
    const storageState = Object.create(null);

    function createElement(id = '') {
        return {
            id,
            value: '',
            innerText: '',
            textContent: '',
            hidden: false,
            disabled: false,
            dataset: {},
            style: {},
            ariaLive: '',
            min: '',
            max: '',
            checked: false,
            focus() { },
            blur() { },
            setAttribute() { },
            getAttribute() { return ''; },
            addEventListener() { },
            removeEventListener() { }
        };
    }

    const document = {
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, createElement(id));
            }
            return elements.get(id);
        },
        querySelectorAll() {
            return [];
        },
        addEventListener() { },
        removeEventListener() { },
        body: createElement('body')
    };

    const sandbox = {
        console,
        globalThis: null,
        Promise,
        Math,
        Date,
        URL,
        setTimeout,
        clearTimeout,
        document,
        window: null,
        navigator: {
            userAgent: 'Mozilla/5.0 Chrome/123.0.0.0',
            clipboard: {
                async writeText() { }
            }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.chrome = {
        runtime: {
            async sendMessage() { return { ok: true, state: {} }; },
            getManifest() {
                return { name: 'WriterDrip', version: '1.0.2', manifest_version: 3 };
            }
        },
        storage: {
            onChanged: { addListener() { } },
            local: {
                async get(key) { return { [key]: storageState[key] }; },
                async set(values) { Object.assign(storageState, values); },
                async remove(keys) {
                    for (const key of Array.isArray(keys) ? keys : [keys]) {
                        delete storageState[key];
                    }
                }
            }
        },
        tabs: {
            onUpdated: { addListener() { } },
            async query() {
                return [{ id: 1, url: 'https://docs.google.com/document/d/test/edit' }];
            }
        }
    };
    return vm.createContext(sandbox);
}

function createContentSandbox() {
    const sandbox = {
        console,
        globalThis: null,
        Promise,
        Math,
        Date,
        URL,
        setTimeout,
        clearTimeout,
        navigator: { userAgent: 'node' },
        location: { href: 'https://docs.google.com/document/d/test/edit' },
        Node: { ELEMENT_NODE: 1 }
    };
    sandbox.globalThis = sandbox;
    sandbox.window = {
        location: {
            hostname: 'docs.google.com',
            pathname: '/document/d/test/edit'
        },
        addEventListener() { },
        getSelection() {
            return { rangeCount: 0 };
        }
    };
    sandbox.document = {
        addEventListener() { },
        removeEventListener() { },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        activeElement: null,
        body: {}
    };
    sandbox.chrome = {
        runtime: {
            onMessage: { addListener() { } },
            async sendMessage() { }
        }
    };
    return vm.createContext(sandbox);
}

async function evaluateScript(sandbox, relativePath) {
    const source = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
    vm.runInContext(source, sandbox, { filename: relativePath });
}

async function flushMicrotasks() {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function readFileSyncSafe(absolutePath) {
    return String(readFileSync(absolutePath));
}

async function findFiles(startDir, predicate, relativePrefix = '') {
    const entries = await fs.readdir(startDir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
        const relativePath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;
        const absolutePath = path.join(startDir, entry.name);

        if (entry.isDirectory()) {
            results.push(...await findFiles(absolutePath, predicate, relativePath));
            continue;
        }

        if (predicate(relativePath)) {
            results.push(relativePath);
        }
    }

    return results;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
