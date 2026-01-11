import { describe, it } from 'node:test';
import { assertClose } from '../node-test-helper.js';
import { calculate } from '../../js/calculators/vortex.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Monstrous Vortex Calculator', () => {
    // Setup Deck
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
        global.document.getElementById('vortex-cmcValue').value = '6';
        const { results } = calculate();
        const result6 = results[6];
        assertClose(result6.avgFreeMana, 5.0, 'Avg Free Mana Value');
        assertClose(result6.avgSpellsPerTrigger, 1.5, 'Avg Spells Cast');
    });
});
