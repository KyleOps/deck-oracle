// The Rashmi page: readInputs() → the model. The maths is tested in
// tests/models/rashmi.node.test.js.
import { describe, it } from 'node:test';
import { assert, assertClose } from '../node-test-helper.js';
import { calculate, readInputs } from '../../js/calculators/rashmi.js';
import { buildRashmiState, freeSpellOdds, oddsAround } from '../../js/utils/models/rashmi.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

const DECK = {
    'Card A': { name: 'Card A', cmc: 2, count: 10, type_line: 'Creature', mana_cost: '{2}' },
    'Card B': { name: 'Card B', cmc: 5, count: 10, type_line: 'Creature', mana_cost: '{5}' },
    'Card C': { name: 'Card C', cmc: 3, count: 10, type_line: 'Instant', mana_cost: '{3}' },
    'Land': { name: 'Land', cmc: 0, count: 30, type_line: 'Land', mana_cost: '' }
};

describe('Rashmi page inputs', () => {
    it('reads the cast mana value (clamped) and the X-spell setting', () => {
        global.document.getElementById('rashmi-cmcValue').value = '40';
        assert.strictEqual(readInputs().castMv, 15);
        global.document.getElementById('rashmi-cmcValue').value = '';
        assert.strictEqual(readInputs().castMv, 5, 'defaults to a 5-mana spell');
        assert.strictEqual(readInputs().excludeX, false);
    });

    it('reports the chosen mana value and its neighbours', () => {
        const state = buildRashmiState(DECK);
        const around = oddsAround(state, 5);
        assert.deepStrictEqual(Object.keys(around).map(Number), [3, 4, 5, 6, 7, 8, 9]);
        assert.deepStrictEqual(around[5], freeSpellOdds(state, 5));
        assert.deepStrictEqual(Object.keys(oddsAround(state, 1)).map(Number), [1, 2, 3, 4, 5]);
        assert.deepStrictEqual(Object.keys(oddsAround(state, 15)).map(Number), [13, 14, 15]);
    });
});

describe('Rashmi, Eternities Crafter Calculator', () => {
    DeckConfig.updateDeck({ lands: 30, cardsByName: DECK });

    it('calculates correct probability at CMC 4', () => {
        global.document.getElementById('rashmi-cmcValue').value = '4';
        const { results } = calculate();
        const resultAt4 = results[4];
        assertClose(resultAt4.probFreeSpell, 1 / 3, 'Probability at CMC 4');
        assertClose(resultAt4.expectedCmc, 2.5, 'Expected CMC at CMC 4');
    });

    it('handles CMC where no spells are free', () => {
        global.document.getElementById('rashmi-cmcValue').value = '2';
        const { results } = calculate();
        assert.strictEqual(results[2].probFreeSpell, 0);
    });

    it('calculates correct probability at CMC 6', () => {
        global.document.getElementById('rashmi-cmcValue').value = '6';
        const { results } = calculate();
        assertClose(results[6].probFreeSpell, 0.5, 'Probability at CMC 6');
    });

    it('recomputes for a new deck even when it has the same shape (regression)', () => {
        // The old cache key was "number of unique names + land count", so a
        // different deck with the same shape silently reused stale odds.
        global.document.getElementById('rashmi-cmcValue').value = '4';
        const other = {
            'Card A': { name: 'Card A', cmc: 1, count: 10, type_line: 'Creature', mana_cost: '{1}' },
            'Card B': { name: 'Card B', cmc: 1, count: 10, type_line: 'Creature', mana_cost: '{1}' },
            'Card C': { name: 'Card C', cmc: 1, count: 10, type_line: 'Instant', mana_cost: '{1}' },
            'Land': { name: 'Land', cmc: 0, count: 30, type_line: 'Land', mana_cost: '' }
        };
        DeckConfig.updateDeck({ lands: 30, cardsByName: other });
        assertClose(calculate().results[4].probFreeSpell, 0.5, 'all 30 spells are cheaper than 4');
        DeckConfig.updateDeck({ lands: 30, cardsByName: DECK });
        assertClose(calculate().results[4].probFreeSpell, 1 / 3, 'back to the first deck');
    });
});

