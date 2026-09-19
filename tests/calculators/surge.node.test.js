import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import {
    calculateSurgePayback,
    calculateSurgeRunValue,
    simulatePrimalSurge
} from '../../js/calculators/surge.js';

describe('Primal Surge Calculator', () => {
    it('calculates mathematical EV correctly', () => {
        const expectedVal = 50 / 11;
        const result = simulatePrimalSurge(60, 10, 50);
        assertClose(result.expectedPermanents, expectedVal, 'Expected Value calculation');
    });

    it('handles edge case: 0 non-permanents (full deck)', () => {
        const resultFull = simulatePrimalSurge(60, 0, 60);
        assertClose(resultFull.expectedPermanents, 60, 'Full Deck calculation');
    });

    it('handles edge case: all non-permanents', () => {
        const resultNone = simulatePrimalSurge(60, 60, 0);
        assertClose(resultNone.expectedPermanents, 0, '0 Perms calculation');
    });

    it('counts lands and cards put into play on top of raw mana value', () => {
        const result = calculateSurgeRunValue({
            manaValue: 3,
            lands: 5,
            permanents: 8
        }, {
            threshold: 10,
            landValue: 1,
            cardValue: 0.25
        });

        assert.equal(result.effectiveValue, 10);
        assert.equal(result.paidBack, true);
    });

    it('classifies value strictly below the threshold as a whiff', () => {
        const result = calculateSurgeRunValue({
            manaValue: 3,
            lands: 5,
            permanents: 7
        }, {
            threshold: 10,
            landValue: 1,
            cardValue: 0.25
        });

        assert.equal(result.effectiveValue, 9.75);
        assert.equal(result.paidBack, false);
    });

    it('calculates exact payback odds across possible stopping positions', () => {
        const result = calculateSurgePayback([
            { cmc: 1, isLand: false, count: 2 }
        ], 1, {
            threshold: 2,
            landValue: 0,
            cardValue: 0
        });

        // The one non-permanent is equally likely to be first, second, or
        // third. Only the third position lets both one-drops enter.
        assertClose(result.paybackProbability, 1 / 3, 'Payback probability');
        assertClose(result.whiffProbability, 2 / 3, 'Whiff probability');
    });

    it('handles a no-stop library as one deterministic full-deck result', () => {
        const paid = calculateSurgePayback([
            { cmc: 0, isLand: true, count: 5 },
            { cmc: 1, isLand: false, count: 3 }
        ], 0, {
            threshold: 10,
            landValue: 1,
            cardValue: 0.25
        });

        assert.equal(paid.expectedEffectiveValue, 10);
        assert.equal(paid.paybackProbability, 1);
        assert.equal(paid.whiffProbability, 0);
    });
});
