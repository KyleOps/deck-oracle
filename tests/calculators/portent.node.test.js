import { describe, it } from 'node:test';
import { assert } from '../node-test-helper.js';
import { calculate } from '../../js/calculators/portent.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Portent of Calamity Calculator', () => {
    // Setup Deck: 4 types available.
    DeckConfig.updateDeck({
        lands: 30,
        creatures: 10,
        artifacts: 10,
        instants: 10
    });

    it('calculates valid probability for X=5', () => {
        global.document.getElementById('portent-xValue').value = '5';
        const { results } = calculate();
        const res5 = results[5];
        assert.ok(res5.prob4Plus >= 0 && res5.prob4Plus <= 1, 'Probability X=5 should be in valid range');
        assert.ok(res5.expectedTypes > 1, 'Expected types should be greater than 1');
    });

    it('returns 0 probability for X < 4', () => {
        global.document.getElementById('portent-xValue').value = '4';
        const { results } = calculate();
        const res2 = results[2];
        assert.strictEqual(res2.prob4Plus, 0);
    });
});
