
import { describe, it, assertClose } from '../test-helper.js';
import { simulatePrimalSurge } from '../../js/calculators/surge.js';

describe('Primal Surge Calculator', () => {
    // Note: Tests use direct function calls, no DeckConfig setup needed

    it('calculates mathematical EV correctly', () => {
        // E = (N - K) / (K + 1)
        // N = 60, K = 10
        // E = 50 / 11 ~= 4.5454...
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
});

