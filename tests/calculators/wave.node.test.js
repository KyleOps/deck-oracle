import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import { analyze, buildWaveLibrary, simulateGenesisWave, summarize, waveOutcome } from '../../js/calculators/wave.js';
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
