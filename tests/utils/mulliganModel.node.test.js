import { describe, it } from 'node:test';
import assert from 'node:assert';
import { choose, drawType, drawTypeMin } from '../../js/utils/hypergeometric.js';
import { FORMATS } from '../../js/utils/format.js';
import {
    drawSchedule, bottomCount, multiTypeProb, drawChance, openingHands, handSuccess,
    keepBar, mulliganPlan, marginalGains, keepRules, chooseBottom
} from '../../js/utils/mulliganModel.js';

const close = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const LANDS = { count: 37, required: 3, byTurn: 3, max: 5 };
const RAMP = { count: 11, required: 1, byTurn: 3, max: null };
const commanderDraws = drawSchedule({ format: FORMATS.commander });

describe('mulliganModel — draws and bottoming', () => {
    it('Commander draws on turn one; 60-card on the play skips it', () => {
        assert.deepStrictEqual([0, 1, 2, 3].map(commanderDraws), [0, 1, 2, 3]);
        const play = drawSchedule({ format: FORMATS.constructed, onPlay: true });
        const draw = drawSchedule({ format: FORMATS.constructed, onPlay: false });
        assert.deepStrictEqual([0, 1, 2, 3].map(play), [0, 0, 1, 2]);
        assert.deepStrictEqual([0, 1, 2, 3].map(draw), [0, 1, 2, 3]);
        // Multiplayer Commander ignores "on the play".
        assert.deepStrictEqual([1, 3].map(drawSchedule({ format: FORMATS.commander, onPlay: true })), [1, 3]);
    });

    it('London mulligan bottoms one card per mulligan, the first free in Commander', () => {
        assert.deepStrictEqual([0, 1, 2, 3].map(m => bottomCount(m, false)), [0, 1, 2, 3]);
        assert.deepStrictEqual([0, 1, 2, 3].map(m => bottomCount(m, true)), [0, 0, 1, 2]);
    });

    it('multiTypeProb is the multivariate hypergeometric', () => {
        close(multiTypeProb(60, [24], 7, [3]), drawType(60, 24, 7, 3), 1e-12);
        close(multiTypeProb(99, [37, 11], 7, [3, 1]), choose(37, 3) * choose(11, 1) * choose(51, 3) / choose(99, 7), 1e-12);
        assert.strictEqual(multiTypeProb(60, [24], 7, [8]), 0);
    });

    it('opening hands cover every seven exactly once', () => {
        const hands = openingHands(99, [37, 11]);
        close(hands.reduce((s, h) => s + h.p, 0), 1, 1e-9);
        hands.forEach(h => assert.strictEqual(h.counts[0] + h.counts[1] + h.others, 7));
    });
});

describe('mulliganModel — chance of finding missing cards', () => {
    it('handles sequential and shared deadlines exactly', () => {
        const a = { count: 1, required: 1, byTurn: 1 };
        const b2 = { count: 1, required: 1, byTurn: 2 };
        close(handSuccess(17, [a, b2], [0, 0]), 1 / 90);
        close(handSuccess(17, [{ ...a, byTurn: 2 }, b2], [0, 0]), 1 / 45);
    });

    it('is 1 when everything is in hand and 0 for an unmet opening-hand requirement', () => {
        assert.strictEqual(handSuccess(60, [{ count: 10, required: 2, byTurn: 3 }], [2]), 1);
        assert.strictEqual(handSuccess(60, [{ count: 10, required: 2, byTurn: 0 }], [0]), 0);
    });

    it('matches the single-group hypergeometric', () => {
        // 2 lands in hand, need a 3rd by turn 3 (3 draws) from 92 cards holding 35 lands.
        close(handSuccess(99, [LANDS], [2]), drawTypeMin(92, 35, 3, 1), 1e-12);
    });

    it('respects the turn-one draw rule', () => {
        const play = drawSchedule({ format: FORMATS.constructed, onPlay: true });
        const t = [{ count: 24, required: 3, byTurn: 3 }];
        close(handSuccess(60, t, [2], { drawsBy: play }), drawTypeMin(53, 22, 2, 1), 1e-12);
        assert.strictEqual(handSuccess(60, [{ count: 24, required: 3, byTurn: 1 }], [2], { drawsBy: play }), 0);
    });

    it('drawChance never draws more cards than the library holds', () => {
        assert.strictEqual(drawChance({ library: 2, inLibrary: [2], need: [2], draws: [10] }), 1);
    });
});

describe('mulliganModel — the plan', () => {
    const base = { deckSize: 99, types: [LANDS], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: commanderDraws };

    it('keeps a seven exactly when it meets the bar', () => {
        const plan = mulliganPlan(base);
        plan.hands.forEach((h, i) => {
            const d = plan.steps[0].decisions[i];
            assert.strictEqual(d.keep, d.legal && d.success >= 0.75 - 1e-12, `hand ${h.counts}`);
        });
    });

    it('lowers the bar per card down, not per mulligan', () => {
        const free = mulliganPlan(base);
        assert.strictEqual(free.steps[1].bar, 0.75);
        close(free.steps[2].bar, keepBar(0.75, 0.2, 1));
        const paid = mulliganPlan({ ...base, freeMulligan: false });
        close(paid.steps[1].bar, 0.6);
    });

    it('accounts for every game', () => {
        const plan = mulliganPlan(base);
        close(plan.steps[plan.steps.length - 1].foundBy, 1, 1e-6);
        assert.ok(plan.success > 0 && plan.success <= 1);
        assert.ok(plan.avgHandSize <= 7 && plan.avgHandSize > 5);
    });

    it('a free mulligan keeps more cards for the same quality of hand', () => {
        const free = mulliganPlan(base);
        const paid = mulliganPlan({ ...base, freeMulligan: false });
        assert.ok(free.avgHandSize > paid.avgHandSize);
        // Success is about the same either way (a paid mulligan lowers the bar
        // sooner, which can even admit six-landers that bottom to five)…
        close(free.success, paid.success, 0.01);
        // …but counting the cards you lose, free is clearly better.
        assert.ok(free.value > paid.value);
    });

    it('a stricter bar keeps fewer sevens', () => {
        const rates = [0.5, 0.7, 0.85, 0.95].map(threshold => mulliganPlan({ ...base, types: [LANDS, RAMP], threshold }).keepSeven);
        for (let i = 1; i < rates.length; i++) assert.ok(rates[i] <= rates[i - 1]);
    });

    it('enforces "at most" on the hand you keep, after bottoming', () => {
        const plan = mulliganPlan({ ...base, freeMulligan: false, deckSize: 60, types: [{ count: 24, required: 3, byTurn: 3, max: 5 }] });
        const seven = plan.hands.findIndex(h => h.counts[0] === 7);
        const six = plan.hands.findIndex(h => h.counts[0] === 6);
        assert.strictEqual(plan.steps[0].decisions[seven].legal, false);
        assert.strictEqual(plan.steps[1].decisions[seven].legal, false);
        assert.strictEqual(plan.steps[2].decisions[seven].legal, true);
        assert.strictEqual(plan.steps[1].decisions[six].legal, true);
        assert.strictEqual(plan.steps[1].decisions[six].success, 1);
    });

    it('bottoms spare cards first and cuts the least harmful needed card', () => {
        const plan = mulliganPlan({ ...base, freeMulligan: false, deckSize: 60, types: [{ count: 24, required: 3, byTurn: 3, max: null }] });
        const i = plan.hands.findIndex(h => h.counts[0] === 3);
        // Four spare spells absorb up to four bottoms.
        assert.strictEqual(plan.steps[4].decisions[i].success, 1);
        // The fifth must be a land: keep 2, need one more in 3 draws from 53 cards with 21 lands.
        close(plan.steps[5].decisions[i].success, 1 - choose(32, 3) / choose(53, 3), 1e-12);
    });

    it('"if you never mulliganed" is the plain average over sevens', () => {
        const plan = mulliganPlan({ ...base, types: [LANDS] });
        let expected = 0;
        for (let k = 0; k <= 5; k++) expected += drawType(99, 37, 7, k) * drawTypeMin(92, 37 - k, 3, Math.max(0, 3 - k));
        close(plan.noMulligan, expected, 1e-12);
        close(plan.alone[0], expected, 1e-12);
    });

    it('decision quality splits every seven four ways', () => {
        const q = mulliganPlan({ ...base, types: [LANDS, RAMP] }).quality;
        close(q.keepGood + q.keepBad + q.mullGood + q.mullMissed, 1, 1e-9);
    });

    it('impossible requirements end in a forced keep with no success', () => {
        const plan = mulliganPlan({ ...base, deckSize: 60, types: [{ count: 5, required: 8, byTurn: 3, max: null }] });
        close(plan.success, 0, 1e-9);
        close(plan.steps[plan.steps.length - 1].foundBy, 1, 1e-6);
    });

    it('stays fast with four groups', () => {
        const start = performance.now();
        mulliganPlan({ ...base, types: [{ ...LANDS, required: 4, byTurn: 5 }, RAMP, { count: 10, required: 1, byTurn: 6 }, { count: 8, required: 1, byTurn: 6 }] });
        assert.ok(performance.now() - start < 1500);
    });
});

describe('mulliganModel — tuning, rules, bottoming helper', () => {
    it('one more land helps a land-light deck', () => {
        const [gain] = marginalGains({ deckSize: 99, types: [{ count: 30, required: 3, byTurn: 3, max: 5 }], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: commanderDraws });
        assert.ok(gain > 0);
        const full = marginalGains({ deckSize: 10, types: [{ count: 10, required: 1, byTurn: 1 }], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: commanderDraws });
        assert.deepStrictEqual(full, [null]);
    });

    it('states a one-group rule as land ranges', () => {
        const plan = mulliganPlan({ deckSize: 99, types: [LANDS], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: commanderDraws });
        assert.deepStrictEqual(keepRules(plan, 0, ['lands']), [
            { label: '2–5 lands', call: 'keep', detail: 'keep' },
            { label: '0–1 or 6–7 lands', call: 'mull', detail: 'mulligan' }
        ]);
    });

    it('states a two-group rule with the second group as the condition', () => {
        const plan = mulliganPlan({ deckSize: 99, types: [LANDS, RAMP], threshold: 0.75, penalty: 0.2, freeMulligan: true, drawsBy: commanderDraws });
        const rules = keepRules(plan, 0, ['lands', 'ramp']);
        assert.ok(rules.some(r => r.detail === 'keep with 1+ ramp'));
        assert.strictEqual(rules[rules.length - 1].call, 'mull');
        assert.strictEqual(keepRules({ ...plan, types: [1, 2, 3] }, 0), null);
    });

    it('chooseBottom puts over-cap cards, then useless cards, then spares on the bottom', () => {
        const types = [{ count: 37, required: 3, byTurn: 3, max: 5 }, { count: 11, required: 1, byTurn: 3 }];
        assert.deepStrictEqual(chooseBottom([3, 2], 2, 3, types), { legal: true, bottomByType: [0, 1], bottomOthers: 2 });
        assert.deepStrictEqual(chooseBottom([7, 0], 0, 1, types), { legal: false, bottomByType: [7, 0], bottomOthers: 0 });
        assert.deepStrictEqual(chooseBottom([6, 1], 0, 1, types), { legal: true, bottomByType: [1, 0], bottomOthers: 0 });
    });
});
