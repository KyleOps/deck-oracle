import { describe, it, assertClose } from '../test-helper.js';
import { calculate } from '../../js/calculators/vortex.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Monstrous Vortex Calculator', () => {
    // Setup Deck
    // Pool for Discover 6: Chain Dino (5, P5+), Small Dino (4, P4), Tiny Spell (1, P0).
    // (Big Dino is excluded because it's the one cast)
    DeckConfig.updateDeck({
        lands: 6,
        cardDetails: [
            { name: 'Big Dino', cmc: 6, power: '5', count: 1 },
            { name: 'Chain Dino', cmc: 5, power: '5', count: 1 },
            { name: 'Small Dino', cmc: 4, power: '4', count: 1 },
            { name: 'Tiny Spell', cmc: 1, power: '0', count: 1 }
        ]
    });

    it('calculates complex Discover chain probabilities correctly', () => {
        document.getElementById('vortex-cmcValue').value = '6';
        const { results } = calculate();
        const result6 = results[6];

        // Manual EV Trace:
        // E[1] = 1.0 (Only Tiny)
        // E[4] = (1 + 4) / 2 = 2.5 (Tiny, Small)
        // E[5]: Chain (5) chains into E[5]. 
        //       E[5] = (1 + 4 + 5) / (3 - 1) = 10 / 2 = 5.0
        // E[6]: Pool = {1, 4, 5+E[5]} = {1, 4, 10}. N=3.
        //       E[6] = (1 + 4 + 10) / 3 = 15 / 3 = 5.0
        assertClose(result6.avgFreeMana, 5.0, 'Avg Free Mana Value');

        // Spells Trace:
        // S[1] = 1.0
        // S[4] = (1 + 1) / 2 = 1.0
        // S[5] = (1 + 1 + 1) / (3 - 1) = 1.5
        // S[6] = (1 + 1 + (1 + 1.5)) / 3 = 4.5 / 3 = 1.5
        assertClose(result6.avgSpellsPerTrigger, 1.5, 'Avg Spells Cast');
    });
});
