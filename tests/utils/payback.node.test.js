import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import { calculateFixedDrawPayback, fixedDrawValuePmf, paybackShareByHits, scoreBattlefieldValue } from '../../js/utils/payback.js';

describe('Payback utilities', () => {
    it('scores printed mana value, land value, and per-card value separately', () => {
        const result = scoreBattlefieldValue(
            { manaValue: 3, lands: 5, cards: 8 },
            { threshold: 10, landValue: 1, cardValue: 0.25 }
        );
        assertClose(result.effectiveValue, 10, 'effective value');
        assert.equal(result.paidForItself, true);
    });

    it('calculates an exact fixed-draw payback probability', () => {
        const result = calculateFixedDrawPayback([
            { count: 2, cmc: 5, eligible: true },
            { count: 2, cmc: 0, eligible: false }
        ], 2, { threshold: 5 });

        // Five of the six two-card combinations contain at least one 5-value hit.
        assertClose(result.paybackProbability, 5 / 6, 'payback probability');
        assertClose(result.expectedEffectiveValue, 5, 'expected value');
    });

    it('includes configurable utility value only for eligible cards', () => {
        const result = calculateFixedDrawPayback([
            { count: 1, cmc: 0, isLand: true, eligible: true },
            { count: 1, cmc: 9, isLand: false, eligible: false }
        ], 1, { threshold: 1.25, landValue: 1, cardValue: 0.25 });

        assertClose(result.paybackProbability, 0.5, 'land pays while invalid card does not');
        assertClose(result.expectedEffectiveValue, 0.625, 'expected utility value');
    });
});

/** Every k-card pick from a list of cards, as index arrays. */
function picks(n, k, start = 0, acc = []) {
    if (acc.length === k) return [acc];
    const out = [];
    for (let i = start; i < n; i++) out.push(...picks(n, k, i + 1, [...acc, i]));
    return out;
}

describe('Reveal value distribution', () => {
    const cards = [
        { count: 2, cmc: 3, eligible: true },
        { count: 1, cmc: 0, isLand: true, eligible: true },
        { count: 1, cmc: 6, eligible: false },
        { count: 2, cmc: 0, eligible: false }
    ];
    const settings = { landValue: 1, cardValue: 0.5, threshold: 4 };
    const flat = cards.flatMap(c => Array.from({ length: c.count }, () => (c.eligible ? c.cmc + settings.cardValue + (c.isLand ? settings.landValue : 0) : 0)));
    const eligibleFlags = cards.flatMap(c => Array.from({ length: c.count }, () => c.eligible));

    it('matches a brute-force count of every reveal', () => {
        const all = picks(flat.length, 3);
        const counts = new Map();
        for (const pick of all) {
            const v = pick.reduce((s, i) => s + flat[i], 0);
            counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        const pmf = fixedDrawValuePmf(cards, 3, settings);
        assertClose(pmf.reduce((s, e) => s + e.p, 0), 1, 'sums to one');
        for (const { value, p } of pmf) assertClose(p, counts.get(value) / all.length, `value ${value}`);
        const paid = pmf.filter(e => e.value >= settings.threshold).reduce((s, e) => s + e.p, 0);
        assertClose(paid, calculateFixedDrawPayback(cards, 3, settings).paybackProbability, 'agrees with the payback chance');
    });

    it('gives the payback share for each number of hits', () => {
        const shares = paybackShareByHits(cards, 3, settings);
        const all = picks(flat.length, 3);
        for (let k = 0; k < shares.length; k++) {
            const withK = all.filter(pick => pick.filter(i => eligibleFlags[i]).length === k);
            if (withK.length === 0) continue;
            const paid = withK.filter(pick => pick.reduce((s, i) => s + flat[i], 0) >= settings.threshold).length;
            assertClose(shares[k], paid / withK.length, `${k} hits`);
        }
    });

    it('handles empty reveals', () => {
        assert.deepStrictEqual(fixedDrawValuePmf([], 3, settings), [{ value: 0, p: 1 }]);
        assert.deepStrictEqual(fixedDrawValuePmf(cards, 0, settings), [{ value: 0, p: 1 }]);
    });
});
