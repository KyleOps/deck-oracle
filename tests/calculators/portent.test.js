import { describe, it, assert } from '../test-helper.js';
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
        document.getElementById('portent-xValue').value = '5';
        const { results } = calculate();
        const res5 = results[5];
        assert(res5.prob4Plus >= 0 && res5.prob4Plus <= 1, 'Probability X=5 is in valid range');
        assert(res5.expectedTypes > 1, 'Expected types is greater than 1');
    });

    it('returns 0 probability for X < 4', () => {
        document.getElementById('portent-xValue').value = '4';
        const { results } = calculate();
        const res2 = results[2];
        assert(res2.prob4Plus === 0, 'Probability X=2 is 0 (impossible to get 4 types)');
    });
});