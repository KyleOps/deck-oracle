import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../helpers/assert.js';
import { analyze, buildWaveLibrary, simulateGenesisWave, summarize, waveCastPlan, waveDots, waveOutcome, waveSpread } from '../../js/utils/models/wave.js';
import { calculateFixedDrawPayback } from '../../js/utils/payback.js';

describe('Genesis Wave Calculator', () => {
    const distribution = {
        0: 30, // Lands
        3: 20, // Creatures
        nonperm: 10
    };
    const deckSize = 60;

    it('calculates mathematical EV correctly for X=5', () => {
        const x = 5;
        const result = simulateGenesisWave(deckSize, distribution, x);
        const expected = 5 * (50 / 60);
        assertClose(result.expectedPermanents, expected, 'EV calculation for X=5');
    });

    it('handles edge case: X=0', () => {
        const result0 = simulateGenesisWave(deckSize, distribution, 0);
        assertClose(result0.expectedPermanents, 0, 'X=0 results in 0 perms');
    });

    it('handles edge case: X=2 (Only Lands valid)', () => {
        const result2 = simulateGenesisWave(deckSize, distribution, 2);
        assertClose(result2.expectedPermanents, 1.0, 'X=2 calculation');
    });

    it('never reveals more cards than the library holds', () => {
        assertClose(simulateGenesisWave(10, { 0: 10 }, 25).expectedPermanents, 10, 'whole library');
    });
});

describe('Genesis Wave outcomes', () => {
    const cards = [
        { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
        { name: 'Bear', type_line: 'Creature — Bear', cmc: 2, count: 15 },
        { name: 'Titan', type_line: 'Creature — Giant', cmc: 6, count: 5 },
        { name: 'Opt', type_line: 'Instant', cmc: 1, count: 10 }
    ];
    const library = buildWaveLibrary(cards);

    it('matches the formula, the hypergeometric distribution and the exact payback', () => {
        const o = waveOutcome(library, 5, { landValue: 1, cardValue: 0.25 }, 'test');
        assertClose(o.expectedPermanents, 5 * 45 / 60, 'Titans cost more than 5');
        assert.strictEqual(o.eligible, 45);
        assertClose(o.pmf.reduce((a, b) => a + b, 0), 1, 'pmf sums to one');
        assertClose(o.pmf.reduce((s, p, k) => s + p * k, 0), o.expectedPermanents, 'pmf mean matches');
        assert.ok(o.low <= o.high);

        const direct = calculateFixedDrawPayback(
            library.entries.map(e => ({ ...e, eligible: e.isPermanent && e.cmc <= 5 })),
            5,
            { threshold: 8, landValue: 1, cardValue: 0.25 }
        );
        assertClose(o.payback.paybackProbability, direct.paybackProbability, 'payback uses X + 3');
    });

    it('has no payback or mana values with counts only', () => {
        const counts = buildWaveLibrary([], { lands: 30, creatures: 20, instants: 10 });
        assert.strictEqual(counts.deckSize, 60);
        const o = waveOutcome(counts, 4, {}, 'counts');
        assert.strictEqual(o.payback, null);
        assertClose(o.expectedPermanents, 4 * 50 / 60, 'every permanent assumed cheap enough');
        const { html, tone } = summarize({ ...o, ...analyze({ 4: o }, 4) });
        assert.strictEqual(tone, 'flat');
        assert.match(html, /import your decklist/i);
    });

    it('states the X, the permanents, the range and the payback chance', () => {
        const sweep = {};
        for (let x = 1; x <= 15; x++) sweep[x] = waveOutcome(library, x, { landValue: 1, cardValue: 0.25 }, 'test');
        const a = analyze(sweep, 4);
        const { html, tone } = summarize(a);
        assert.match(html, /X=4/);
        assert.match(html, /7 mana/);
        assert.match(html, new RegExp(`${a.expectedPermanents.toFixed(1)} permanents`));
        assert.match(html, /pays for itself <strong>\d+%<\/strong>/);
        assert.ok(['good', 'warn', 'bad'].includes(tone));

        // The reliable X is the first to pay back 3 times in 4.
        const reliable = Object.values(sweep).find(o => o.payback.paybackProbability >= 0.75);
        assert.strictEqual(a.reliableX, reliable?.x ?? null);
    });
});

describe('Genesis Wave out of 100 casts', () => {
    const cards = [
        { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 35 },
        { name: 'Bear', type_line: 'Creature — Bear', cmc: 2, count: 30 },
        { name: 'Giant', type_line: 'Creature — Giant', cmc: 9, count: 10 },
        { name: 'Bolt', type_line: 'Instant', cmc: 1, count: 24 }
    ];
    const library = buildWaveLibrary(cards);
    const settings = { landValue: 1, cardValue: 0.25 };

    it('agrees with the exact payback chance, in both views', () => {
        const outcome = waveOutcome(library, 7, settings, 'test-deck');
        const spread = waveSpread(library, 7, settings, 'test-deck');
        const dots = waveDots(outcome, spread);
        assert.strictEqual(dots.value.length, 100);
        assert.strictEqual(dots.permanents.length, 100);
        const good = dots.value.filter(d => d.tone === 'good').length;
        assert.ok(Math.abs(good - outcome.payback.paybackProbability * 100) <= 1, `${good} vs ${outcome.payback.paybackProbability}`);
        assert.strictEqual(dots.permanents.filter(d => d.tone === 'good').length, good);
        assert.ok(dots.value.every(d => (d.value >= outcome.mana) === (d.tone === 'good')));
    });

    it('shows neutral permanents without a card list', () => {
        const counts = buildWaveLibrary([], { lands: 35, creatures: 40, instants: 24 });
        const outcome = waveOutcome(counts, 7, settings, 'counts');
        const dots = waveDots(outcome, waveSpread(counts, 7, settings, 'counts'));
        assert.strictEqual(dots.value, null);
        assert.ok(dots.permanents.every(d => d.tone === 'flat'));
    });
});

describe('Genesis Wave cast animation plan', () => {
    const card = (name, cmc, types) => ({ name, cmc, types });
    const library = [
        card('Forest', 0, ['land']),
        card('Giant', 9, ['creature']),
        card('Bolt', 1, ['instant']),
        card('Bear', 2, ['creature']),
        card('Elk', 3, ['creature'])
    ];

    it('reveals exactly X cards and keeps only permanents with mana value X or less', () => {
        const plan = waveCastPlan(library, 4, { landValue: 1, cardValue: 0.25 });
        assert.deepStrictEqual(plan.steps.map(s => s.fate), ['battlefield', 'graveyard', 'graveyard', 'battlefield']);
        assert.match(plan.steps[1].note, /more than X \(4\)/);
        assert.match(plan.steps[2].note, /not a permanent/);
        assert.strictEqual(plan.permanents, 2);
        assert.strictEqual(plan.value, 1.25 + 2.25);
        assert.strictEqual(plan.paidBack, false, '3.5 value against 7 mana');
        assert.match(plan.summary, /4 cards revealed, 2 permanents/);
    });
});
