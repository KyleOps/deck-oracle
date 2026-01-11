import { describe, it, assert, assertClose } from '../test-helper.js';
import { calculate } from '../../js/calculators/rashmi.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Rashmi, Eternities Crafter Calculator', () => {
    // Setup Deck
    DeckConfig.updateDeck({
        lands: 30,
        cardsByName: {
            'Card A': { name: 'Card A', cmc: 2, count: 10, type_line: 'Creature', mana_cost: '{2}' },
            'Card B': { name: 'Card B', cmc: 5, count: 10, type_line: 'Creature', mana_cost: '{5}' },
            'Card C': { name: 'Card C', cmc: 3, count: 10, type_line: 'Instant', mana_cost: '{3}' },
            'Land': { name: 'Land', cmc: 0, count: 30, type_line: 'Land', mana_cost: '' }
        }
    });

    it('calculates correct probability at CMC 4', () => {
        // Mock the input
        document.getElementById('rashmi-cmcValue').value = '4';
        const { config, results } = calculate();
        
        // Cards with CMC < 4: Card A (2, 10), Card C (3, 10). Total 20.
        // Prob = 20/60 = 1/3
        const resultAt4 = results[4];
        assertClose(resultAt4.probFreeSpell, 1/3, 'Probability at CMC 4');
        assertClose(resultAt4.expectedCmc, 2.5, 'Expected CMC at CMC 4');
    });

    it('handles CMC where no spells are free', () => {
        document.getElementById('rashmi-cmcValue').value = '2';
        const { results } = calculate();
        // Cards with CMC < 2: None
        const resultAt2 = results[2];
        assert(resultAt2.probFreeSpell === 0, 'Probability at CMC 2 is 0');
    });

    it('calculates correct probability at CMC 6', () => {
        document.getElementById('rashmi-cmcValue').value = '6';
        const { results } = calculate();
        // Cards with CMC < 6: A(2), C(3), B(5). Total 30.
        // Prob = 30/60 = 0.5
        const resultAt6 = results[6];
        assertClose(resultAt6.probFreeSpell, 0.5, 'Probability at CMC 6');
    });
});
