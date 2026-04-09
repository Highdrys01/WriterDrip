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
}

async function validatePopupHtml() {
    const popupHtml = await fs.readFile(path.join(rootDir, 'popup.html'), 'utf8');
    assert.match(
        popupHtml,
        /<script\s+src="shared\.js"><\/script>\s*<script\s+src="popup\.js"><\/script>/,
        'popup.html must load shared.js before popup.js.'
    );

    const backgroundSource = await fs.readFile(path.join(rootDir, 'background.js'), 'utf8');
    assert.match(
        backgroundSource,
        /files:\s*\[\s*'shared\.js'\s*,\s*'content\.js'\s*\]/,
        'background.js must inject shared.js before content.js.'
    );
}

async function validateSyntax() {
    for (const relativePath of scriptFiles) {
        const source = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
        new vm.Script(source, { filename: relativePath });
    }
}

async function validateRepositoryHygiene() {
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
        totalActions: 60
    });

    assert.equal(session.state, hooks.SESSION_STATES.COMPLETE, 'Completed runtime snapshots should move the session to complete.');
    assert.equal(session.activeJob, null, 'Completed runtime snapshots should clear the active job.');
    assert.equal(session.activeRunId, null, 'Completed runtime snapshots should clear the active run id.');
    assert.ok(session.lastCompletedJob, 'Completed runtime snapshots should preserve a summary of the completed job.');
}

async function validatePopupRuntime() {
    const popupSandbox = createPopupSandbox();
    await evaluateScript(popupSandbox, 'shared.js');
    await evaluateScript(popupSandbox, 'popup.js');
    await flushMicrotasks();
}

async function validatePlanner() {
    const sandbox = createContentSandbox();
    await evaluateScript(sandbox, 'shared.js');
    await evaluateScript(sandbox, 'content.js');

    const hooks = sandbox.__writerdripTestHooks;
    assert.ok(hooks, 'content.js should expose planner test hooks.');

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

    const lowercaseVariantText = 'The principal should advise the council about the weather before they alter the final effect of the plan.';
    const lowercaseVariantProfile = hooks.buildDraftMistakeProfile(Array.from(lowercaseVariantText.repeat(8)), 420 * 60, 'high');
    assert.ok(
        lowercaseVariantProfile.wordVariantChance > 0 && lowercaseVariantProfile.maxWordVariantMistakes > 0,
        'High-intensity prose should still allow lowercase word-level variants in the planner profile.'
    );

    const structuredDraftAnalysis = shared.analyzeDraftText('HTTP_STATUS=200\nCONFIG={READY:true}', 30);
    assert.equal(structuredDraftAnalysis.suggestedCorrectionIntensity, 'low', 'Structured drafts should suggest low correction intensity.');
    assert.match(structuredDraftAnalysis.suggestedCorrectionReason, /structured|technical/i, 'Structured drafts should explain why the suggestion stayed low.');

    const shortDraftAnalysis = shared.analyzeDraftText('Quick note to finish tonight.', 5);
    assert.equal(shortDraftAnalysis.suggestedCorrectionIntensity, 'low', 'Very short drafts should stay on low suggestion.');
    assert.match(shortDraftAnalysis.suggestedCorrectionReason, /short/i, 'Short drafts should explain that they are too short for stronger correction behavior.');

    const balancedDraftAnalysis = shared.analyzeDraftText(
        'This draft is long enough to feel like normal prose, but it is not massive. It has a few sentences, some commas, and a steady rhythm throughout the paragraph.',
        60
    );
    assert.equal(balancedDraftAnalysis.suggestedCorrectionIntensity, 'medium', 'Balanced prose should land on medium suggestion.');

    const longDraftAnalysis = shared.analyzeDraftText(scenarios[1].text, scenarios[1].durationMins);
    assert.equal(longDraftAnalysis.suggestedCorrectionIntensity, 'high', 'Long relaxed prose should suggest high correction intensity.');
    assert.ok(longDraftAnalysis.suggestedCorrectionSignals.length > 0, 'Suggested intensity should include explanation signals for longer prose.');

    const longChars = Array.from(scenarios[1].text);
    const lowProfile = hooks.buildDraftMistakeProfile(longChars, scenarios[1].durationMins * 60, 'low');
    const mediumProfile = hooks.buildDraftMistakeProfile(longChars, scenarios[1].durationMins * 60, 'medium');
    const highProfile = hooks.buildDraftMistakeProfile(longChars, scenarios[1].durationMins * 60, 'high');

    assert.ok(lowProfile.maxMistakes < mediumProfile.maxMistakes, 'Low intensity should budget fewer mistakes than medium on long prose.');
    assert.ok(mediumProfile.maxMistakes < highProfile.maxMistakes, 'High intensity should budget more mistakes than medium on long prose.');
    assert.ok(lowProfile.cooldownChars > mediumProfile.cooldownChars, 'Low intensity should space mistakes farther apart than medium.');
    assert.ok(mediumProfile.cooldownChars > highProfile.cooldownChars, 'High intensity should allow tighter spacing than medium.');
    assert.equal(lowProfile.wordVariantChance, 0, 'Low intensity should disable larger word-level variants.');
    assert.ok(highProfile.wordVariantChance > mediumProfile.wordVariantChance, 'High intensity should allow stronger word-level variant behavior than medium.');
    assert.ok(highProfile.vowelSlipChance > mediumProfile.vowelSlipChance, 'High intensity should allow more vowel-drift mistakes than medium.');
    assert.ok(mediumProfile.vowelSlipChance > lowProfile.vowelSlipChance, 'Medium intensity should allow more vowel-drift mistakes than low.');
    assert.ok(highProfile.softSlipChance > mediumProfile.softSlipChance, 'High intensity should allow more nearby-letter slips than medium.');
    assert.ok(highProfile.keyboardSlipChance > lowProfile.keyboardSlipChance, 'High intensity should allow more keyboard-neighbor slips than low.');
    assert.ok(highProfile.repairDepthFactor > mediumProfile.repairDepthFactor, 'High intensity should allow deeper repairs than medium.');
    assert.ok(mediumProfile.repairDepthFactor > lowProfile.repairDepthFactor, 'Medium intensity should allow deeper repairs than low.');
    assert.ok(lowProfile.cadenceProfile && mediumProfile.cadenceProfile && highProfile.cadenceProfile, 'Draft profiles should carry a cadence profile.');
    assert.ok(highProfile.cadenceProfile.connectivePauseChance >= mediumProfile.cadenceProfile.connectivePauseChance, 'Richer drafts should preserve smarter cadence settings.');

    const sampledMistakeTypes = new Map();
    for (let seed = 1; seed <= 400; seed += 1) {
        const type = hooks.selectMistakeType(() => {
            let value = seed * 9301 + 49297;
            value %= 233280;
            return value / 233280;
        }, highProfile, 'e', 'r', { recentTypes: [], segmentCounts: [], sentenceCounts: new Map(), sentenceIds: [], lastMistakeIndex: -Infinity, wordVariantCount: 0 });
        sampledMistakeTypes.set(type, (sampledMistakeTypes.get(type) || 0) + 1);
    }

    assert.ok(sampledMistakeTypes.get('key') > 0, 'High-intensity selection should still leave room for keyboard-neighbor slips.');

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
}

function createBackgroundSandbox() {
    const storageState = Object.create(null);
    const sandbox = {
        console,
        globalThis: null,
        Promise,
        Math,
        Date,
        URL,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = sandbox;
    sandbox.chrome = {
        runtime: {
            onInstalled: { addListener() { } },
            onStartup: { addListener() { } },
            onMessage: { addListener() { } }
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
            async sendMessage() { return { status: 'ok', runtime: { state: 'running', percent: 0, eta: '00:10', actionIndex: 0, totalActions: 1 } }; },
            async get(tabId) { return { id: tabId, status: 'complete', url: 'https://docs.google.com/document/d/test/edit', discarded: false }; },
            async update() { }
        },
        storage: {
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
        window: null
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.chrome = {
        runtime: {
            async sendMessage() { return { ok: true, state: {} }; }
        },
        storage: {
            onChanged: { addListener() { } },
            local: {
                async get(key) { return { [key]: storageState[key] }; },
                async set(values) { Object.assign(storageState, values); }
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
        location: { href: 'https://docs.google.com/document/d/test/edit' }
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
