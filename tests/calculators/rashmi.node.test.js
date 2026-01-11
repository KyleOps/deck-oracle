import { describe, it } from 'node:test';
import { assert, assertClose } from '../node-test-helper.js';
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
        global.document.getElementById('rashmi-cmcValue').value = '4';
        const { config, results } = calculate();
        const resultAt4 = results[4];
        assertClose(resultAt4.probFreeSpell, 1/3, 'Probability at CMC 4');
        assertClose(resultAt4.expectedCmc, 2.5, 'Expected CMC at CMC 4');
    });

    it('handles CMC where no spells are free', () => {
        global.document.getElementById('rashmi-cmcValue').value = '2';
        const { results } = calculate();
        const resultAt2 = results[2];
        assert.strictEqual(resultAt2.probFreeSpell, 0);
    });

    it('calculates correct probability at CMC 6', () => {
        global.document.getElementById('rashmi-cmcValue').value = '6';
        const { results } = calculate();
        const resultAt6 = results[6];
        assertClose(resultAt6.probFreeSpell, 0.5, 'Probability at CMC 6');
    });
});
