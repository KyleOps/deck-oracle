/**
 * Game Plan page glue: what readInputs() reads (defaults when the page was
 * never mounted, a plan per deck), that calculate() is the model over it, the
 * share parameters, the presets and the page contract.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../node-test-helper.js';

import * as Page from '../../js/calculators/plan.js';
import { template, styles, guide } from '../../js/views/plan.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import * as GP from '../../js/utils/models/plan.js';
import { GLOSSARY } from '../../js/data/glossary.js';
import { CALCULATORS } from '../../js/utils/calculatorRegistry.js';
import * as Splendor from '../../js/data/plans/wild-splendor.js';

const CUSTOM = {
    steps: [
        { turn: 2, require: { kind: 'cast', group: { is: 'commander', names: ['Susan Foreman'] } } },
        { turn: 6, require: { kind: 'mana', atLeast: 9 } }
    ]
};

describe('Game Plan page', () => {
    beforeEach(() => DeckConfig.resetForTests());

    it('exports the calculator contract and is a page of its own', () => {
        for (const fn of ['init', 'updateUI', 'calculate', 'readInputs', 'getShareParams', 'applyShareParams', 'setPlan', 'tryPreset', 'usePreset']) {
            assert.equal(typeof Page[fn], 'function', fn);
        }
        const entry = CALCULATORS.plan;
        assert.equal(entry.group, 'deck');
        assert.equal(entry.method, 'simulation');
        assert.equal(entry.charts, false);
        assert.ok(entry.question.endsWith('?'));
    });

    it('reads the example deck with a starter plan built from it, before it was ever mounted', () => {
        const inputs = Page.readInputs();
        assert.deepEqual(inputs.lib.commanders.map(c => c.name), ['The Sixth Doctor', 'Susan Foreman']);
        assert.equal(inputs.lib.cards.length, 98, 'commanders are never in the library');
        assert.deepEqual(inputs.plan, GP.starterPlan(inputs.lib));
        assert.equal(inputs.onPlay, true, 'multiplayer: everyone draws, so the maths is on the play');
        assert.deepEqual(inputs.keep, GP.DEFAULT_KEEP);
        assert.match(inputs.deckName, /Doctor Whostoric/);
        assert.equal(Page.readInputs().lib, inputs.lib, 'the library is built once per deck');
    });

    it('calculates 5,000 games of the model over those inputs, cached', () => {
        const { inputs, result } = Page.calculate();
        assert.equal(result.games, GP.DEFAULT_GAMES);
        assert.equal(result.planKey, GP.encodePlan(inputs.plan));
        assert.equal(Page.calculate().result, result, 'cached');
        assert.deepEqual(result.steps.map(s => s.onTime), GP.simulatePlan(inputs.lib, inputs.plan, { format: inputs.format, onPlay: true }).steps.map(s => s.onTime));
    });

    it('keeps each deck’s own plan, and starts over from the deck', () => {
        Page.setPlan(CUSTOM);
        assert.deepEqual(Page.readInputs().plan, GP.normalizePlan(CUSTOM));
        assert.equal(Page.getSettings().source.kind, 'custom');

        DeckConfig.loadSnapshot(Splendor.snapshot, { persistActive: false });
        const other = Page.readInputs();
        assert.deepEqual(other.plan, GP.starterPlan(other.lib), 'another deck: its own starter plan');
        assert.equal(other.preset?.id, 'wild-splendor', 'and the preset made for it is suggested');

        DeckConfig.resetForTests();
        assert.deepEqual(Page.readInputs().plan, GP.normalizePlan(CUSTOM), 'back again: the plan is still there');
        Page.setPlan(GP.starterPlan(Page.readInputs().lib), { kind: 'starter' });
        assert.equal(Page.getSettings().source.kind, 'starter');
    });

    it('carries the plan, turn order and keep rule in share links, and ignores junk', () => {
        const starter = Page.readInputs().plan;
        assert.deepEqual(Page.getShareParams(), { gp: GP.encodePlan(starter) });
        Page.applyShareParams(new URLSearchParams(`gp=${GP.encodePlan(CUSTOM)}&gpdraw=1&gpkeep=l35`));
        const s = Page.getSettings();
        assert.deepEqual(s.plan, GP.normalizePlan(CUSTOM));
        assert.equal(s.source.kind, 'link');
        assert.equal(s.onPlay, false);
        assert.deepEqual(s.keep, { kind: 'lands', minLands: 3, maxLands: 5 });
        assert.deepEqual(Page.getShareParams(), { gp: GP.encodePlan(CUSTOM), gpdraw: 1, gpkeep: 'l35' });
        assert.equal(Page.readInputs().onPlay, true, 'turn order is moot in multiplayer Commander');

        Page.applyShareParams(new URLSearchParams('gp=2qq&gpkeep=x99&gpdraw=yes'));
        assert.deepEqual(Page.getSettings().plan, GP.normalizePlan(CUSTOM), 'a damaged plan changes nothing');
        assert.deepEqual(Page.getSettings().keep, { kind: 'lands', minLands: 3, maxLands: 5 });
        Page.applyShareParams(new URLSearchParams('gpkeep=p24'));
        assert.deepEqual(Page.getShareParams(), { gp: GP.encodePlan(CUSTOM), gpdraw: 1 });
    });

    it('tries a preset: its deck becomes the current deck, saved like an import, with its plan', async () => {
        assert.equal(await Page.tryPreset('wild-splendor'), true);
        const deck = DeckConfig.getDeckConfig();
        assert.equal(deck.deckName, 'Wild Splendor');
        assert.equal(deck.importSource, 'preset');
        assert.ok(deck.deckId, 'it has a library id');
        assert.equal(DeckConfig.getFormat().key, 'commander');
        const inputs = Page.readInputs();
        assert.deepEqual(inputs.plan, GP.normalizePlan(Splendor.plan));
        assert.deepEqual(Page.getSettings().source, { kind: 'preset', id: 'wild-splendor' });
        assert.equal(inputs.lib.cards.length, 99);
        assert.deepEqual(inputs.lib.commanders.map(c => c.name), ['Selvala, Eager Trailblazer']);
        assert.equal(await Page.tryPreset('no-such-preset'), false);
        assert.equal(await Page.loadPreset('wild-splendor'), await Page.loadPreset('wild-splendor'), 'loaded once');
    });

    it('uses a preset’s plan on the current deck', async () => {
        assert.equal(await Page.usePreset('wild-splendor'), true);
        assert.deepEqual(Page.readInputs().plan, GP.normalizePlan(Splendor.plan));
        assert.deepEqual(Page.getSettings().source, { kind: 'preset', id: 'wild-splendor' });
        assert.equal(await Page.usePreset('nope'), false);
    });

    it('has the containers the module renders into, scoped styles and a complete guide', () => {
        for (const id of ['gp-summary', 'gp-steps', 'gp-preset', 'gp-add-step', 'gp-reset', 'gp-keep', 'gp-keep-min', 'gp-keep-max',
            'gp-order-group', 'gp-funnel', 'gp-reasons', 'gp-mana', 'gp-samples', 'gp-reshuffle', 'gp-rules', 'gp-card-names', 'gp-about', 'gp-measures']) {
            assert.ok(template.includes(`id="${id}"`), id);
        }
        assert.ok(!/<h1/i.test(template), 'the shared header owns the title');
        const selectors = styles.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g).map(s => s.trim()).filter(s => s && !s.startsWith('@'));
        for (const sel of selectors) for (const part of sel.split(',')) assert.match(part.trim(), /^#plan-tab\b/, part);
        assert.ok(!/#[0-9a-f]{3,6}\b/i.test(styles.replace(/#plan-tab/g, '')), 'tokens only, no hex colours');
        assert.match(styles, /@container shell/);
        for (const key of ['intro', 'howToRead', 'method', 'assumptions', 'tips', 'terms']) assert.ok(guide[key], key);
        for (const t of guide.terms) assert.ok(GLOSSARY[t], `unknown glossary term ${t}`);
    });
});
