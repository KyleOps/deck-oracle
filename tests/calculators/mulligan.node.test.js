import { describe, it } from 'node:test';
import { assert, assertClose } from '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import {
    calculate, calcMultiTypeSuccess, runSampleReveals, getDeckConfig, getState, setCardTypes,
    getShareParams, applyShareParams, summarizeMulligan, describeRequirement, assignCards,
    simulateGames, TEMPLATES, SOURCES
} from '../../js/calculators/mulligan.js';
import { mulliganPlan, drawSchedule } from '../../js/utils/mulliganModel.js';
import { FORMATS } from '../../js/utils/format.js';

/** Small seeded PRNG so simulation checks are repeatable. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const card = (name, count, type_line, cmc = 0, oracle_text = '') => ({ name, count, type_line, cmc, oracle_text, mana_cost: '' });
const sixtyCards = {
    Forest: card('Forest', 22, 'Basic Land — Forest'),
    'Llanowar Elves': card('Llanowar Elves', 4, 'Creature — Elf Druid', 1, '{T}: Add {G}.'),
    'Arcane Signet': card('Arcane Signet', 4, 'Artifact', 2, "{T}: Add one mana of any color in your commander's color identity."),
    'Grizzly Bears': card('Grizzly Bears', 10, 'Creature — Bear', 2),
    'Craw Wurm': card('Craw Wurm', 20, 'Creature — Wurm', 6)
};

describe('Mulligan Planner — compatibility', () => {
    it('calcMultiTypeSuccess keeps its exact sequential-deadline answer', () => {
        const types = [{ id: 1, count: 1, required: 1, byTurn: 1 }, { id: 2, count: 1, required: 1, byTurn: 2 }];
        assertClose(calcMultiTypeSuccess(17, types, [0, 0]), 1 / 90, 'Sequential A(T1), B(T2)');
    });

    it('starts from the "Enough lands" template, linked to the deck', () => {
        const state = getState();
        assert.strictEqual(state.types.length, 1);
        assert.strictEqual(state.types[0].source, 'land');
        assert.ok(state.types[0].count > 30, 'counted from the example list');
        assert.match(state.types[0].color, /^#[0-9a-f]{3,8}$/i, 'share links need a hex colour');
        const { result } = calculate();
        assert.ok(result.expectedSuccess > 0 && result.expectedSuccess <= 1);
        assertClose(result.strategy.reduce((s, h) => s + h.handProb, 0), 1, 'hand probabilities sum to 1', 1e-9);
    });
});

describe('Mulligan Planner — formats', () => {
    it('Commander: 98-card library (100 less two commanders), free first mulligan, everyone draws', () => {
        const config = getDeckConfig();
        assert.strictEqual(config.format.key, 'commander');
        assert.strictEqual(config.deckSize, 98);
        assert.strictEqual(config.freeMulligan, true);
        assert.strictEqual(config.onPlay, true);
    });

    it('60-card: no free mulligan, and the plan uses on-the-play draws', () => {
        DeckConfig.updateDeck({ lands: 22, actualCardCount: 60, commanderName: null, cardsByName: sixtyCards });
        const { config, result } = calculate();
        assert.strictEqual(config.format.key, 'constructed');
        assert.strictEqual(config.deckSize, 60);
        assert.strictEqual(config.freeMulligan, false);
        assert.strictEqual(config.types[0].count, 22, 'linked land count follows the new list');
        const expected = mulliganPlan({
            deckSize: 60, types: config.types, threshold: 0.75, penalty: 0.2, freeMulligan: false,
            drawsBy: drawSchedule({ format: FORMATS.constructed, onPlay: true })
        });
        assertClose(result.success, expected.success, 'on the play', 1e-12);

        applyShareParams(new URLSearchParams('mullDraw=1'));
        const onDraw = calculate();
        assert.strictEqual(onDraw.config.onPlay, false);
        assert.ok(onDraw.result.keepSeven >= result.keepSeven, 'drawing first makes more sevens keepable');
        assert.deepStrictEqual(getShareParams(), { mullSrc: 'land', mullMax: '5', mullDraw: 1 });
    });
});

describe('Mulligan Planner — deck groups and templates', () => {
    it('assigns each card to the first group it fits', () => {
        const cards = Object.values(sixtyCards);
        const tags = { 'Llanowar Elves': ['ramp'], 'Arcane Signet': ['ramp'] };
        const ramp = assignCards([{ source: 'land' }, { source: 'ramp' }, { source: 'cheap' }], cards, tags);
        assert.deepStrictEqual(ramp.counts, [22, 8, 10]);
        const cheapFirst = assignCards([{ source: 'cheap' }, { source: 'ramp' }], cards, tags);
        assert.deepStrictEqual(cheapFirst.counts, [18, 0]);
        assert.strictEqual(cheapFirst.groupOf.get('Craw Wurm'), undefined);
    });

    it('every template row names a known group', () => {
        TEMPLATES.forEach(t => t.rows.forEach(r => assert.ok(SOURCES[r.source], `${t.key}:${r.source}`)));
    });
});

describe('Mulligan Planner — share links', () => {
    it('round-trips limits and linked groups', () => {
        DeckConfig.updateDeck({ lands: 22, actualCardCount: 60, commanderName: null, cardsByName: sixtyCards });
        setCardTypes([
            { id: 1, name: 'Lands', count: 22, required: 3, byTurn: 3, color: '#55c97f' },
            { id: 2, name: 'Bears', count: 10, required: 1, byTurn: 2, color: '#f0a92c' }
        ]);
        assert.strictEqual(getState().types[0].source, null, 'shared rows start unlinked');
        applyShareParams(new URLSearchParams('mullMax=5,&mullSrc=land,cheap'));
        const types = getState().types;
        assert.strictEqual(types[0].max, 5);
        assert.strictEqual(types[0].source, 'land', 'count matches the deck, so it re-links');
        assert.strictEqual(types[1].source, null, 'count differs from the deck (18), so it stays as shared');
        assert.strictEqual(types[1].max, null);
    });

    it('ignores out-of-range values', () => {
        setCardTypes([{ id: 1, name: 'Lands', count: 22, required: 3, byTurn: 3 }]);
        applyShareParams(new URLSearchParams('mullMax=99&mullSrc=bogus'));
        assert.strictEqual(getState().types[0].max, null);
        assert.strictEqual(getState().types[0].source, null);
    });
});

describe('Mulligan Planner — words', () => {
    it('describes a requirement in plain English', () => {
        assert.strictEqual(describeRequirement({ required: 3, byTurn: 3, max: 5 }), 'At least 3 by turn 3, no more than 5 in the hand you keep');
        assert.strictEqual(describeRequirement({ required: 1, byTurn: 0, max: null }), 'At least 1 in the opening hand');
        assert.strictEqual(describeRequirement({ required: 0, byTurn: 3, max: 4 }), 'No more than 4 in the hand you keep');
    });

    it('summarises the plan with its key numbers and a tone', () => {
        const plan = mulliganPlan({ deckSize: 99, types: [{ count: 37, required: 3, byTurn: 3, max: 5 }], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: t => t });
        const s = summarizeMulligan(plan, { names: ['Lands'], freeMulligan: true });
        assert.match(s.html, /You keep <strong>80%<\/strong> of opening sevens/);
        assert.match(s.html, /by your free mulligan <strong>96%<\/strong>/);
        assert.match(s.html, /in <strong>92%<\/strong> of games/);
        assert.strictEqual(s.tone, 'good');
        assert.strictEqual(summarizeMulligan(null).tone, 'flat');
    });

    it('names the bottleneck when the plan struggles', () => {
        const plan = mulliganPlan({ deckSize: 99, types: [{ count: 37, required: 3, byTurn: 3 }, { count: 3, required: 1, byTurn: 2 }], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: t => t });
        const s = summarizeMulligan(plan, { names: ['Lands', 'Combo piece'], freeMulligan: true });
        assert.strictEqual(s.tone, 'bad');
        assert.match(s.html, /The hard part is <strong>Combo piece<\/strong>/);
    });
});

describe('Mulligan Planner — sample games', () => {
    it('the simulation agrees with the exact plan', () => {
        const types = [{ count: 37, required: 3, byTurn: 3, max: 5 }, { count: 11, required: 1, byTurn: 3, max: null }];
        const drawsBy = drawSchedule({ format: FORMATS.commander });
        const plan = mulliganPlan({ deckSize: 99, types, threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy });
        const pool = [];
        for (let i = 0; i < 37; i++) pool.push({ name: 'Land', group: 0 });
        for (let i = 0; i < 11; i++) pool.push({ name: 'Ramp', group: 1 });
        while (pool.length < 99) pool.push({ name: 'Other', group: -1 });
        const sim = simulateGames({ pool, plan, drawsBy, freeMulligan: true, games: 20000, detail: 5, rng: mulberry32(7) });
        assertClose(sim.stats.keptSeven, plan.keepSeven, 'kept sevens', 0.015);
        assertClose(sim.stats.success, plan.success, 'success', 0.015);
        assertClose(sim.stats.avgHandSize, plan.avgHandSize, 'hand size', 0.03);
        assert.strictEqual(sim.games.length, 5);
    });

    it('renders sample games into the page', () => {
        const display = global.document.getElementById('mulligan-reveals-display');
        display.innerHTML = '';
        runSampleReveals();
        assert.match(display.innerHTML, /shuffled games/);
    });
});
