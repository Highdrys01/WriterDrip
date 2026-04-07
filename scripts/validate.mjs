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

async function validateBackgroundRuntime() {
    const backgroundSandbox = createBackgroundSandbox();
    await evaluateScript(backgroundSandbox, 'shared.js');
    await evaluateScript(backgroundSandbox, 'background.js');
    await flushMicrotasks();
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

    const longDraftAnalysis = shared.analyzeDraftText(scenarios[1].text, scenarios[1].durationMins);
    assert.notEqual(longDraftAnalysis.suggestedCorrectionIntensity, 'low', 'Long prose should not collapse to low correction intensity by default.');
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

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
