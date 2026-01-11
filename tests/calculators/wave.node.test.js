import { describe, it } from 'node:test';
import { assertClose } from '../node-test-helper.js';
import { simulateGenesisWave } from '../../js/calculators/wave.js';

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
});
