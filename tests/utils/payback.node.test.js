import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import { calculateFixedDrawPayback, scoreBattlefieldValue } from '../../js/utils/payback.js';

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
