import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deckCardList, listSize, withoutCopy } from '../../js/utils/models/cardList.js';
import { libraryOf } from '../../js/utils/library.js';

const cards = [
    { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 10 },
    { name: 'Genesis Wave', type_line: 'Sorcery', cmc: 3, count: 2 },
    { name: 'Opt', type_line: 'Instant', cmc: 1, count: 1 }
];

describe('withoutCopy (the spell on the stack)', () => {
    it('takes one copy out and keeps the order', () => {
        const left = withoutCopy(cards, 'Genesis Wave');
        assert.deepStrictEqual(left.map(c => [c.name, c.count]), [['Forest', 10], ['Genesis Wave', 1], ['Opt', 1]]);
        assert.strictEqual(listSize(left), listSize(cards) - 1);
        assert.strictEqual(cards[1].count, 2, 'the list it was given is unchanged');
    });

    it('drops a card whose last copy is taken', () => {
        assert.deepStrictEqual(withoutCopy(cards, 'opt').map(c => c.name), ['Forest', 'Genesis Wave'], 'front face, any case');
    });

    it('returns the same list when the card is not named', () => {
        assert.strictEqual(withoutCopy(cards, 'Primal Surge'), cards);
        assert.deepStrictEqual(withoutCopy(null, 'Opt'), []);
    });

    it('agrees with libraryOf(..., { exclude })', () => {
        const cardsByName = Object.fromEntries(cards.map(c => [c.name, c]));
        const viaLibrary = deckCardList({ cardsByName, importSource: 'moxfield' }, { exclude: ['Genesis Wave'] });
        assert.deepStrictEqual(
            viaLibrary.map(c => [c.name, c.count]),
            withoutCopy(deckCardList({ cardsByName, importSource: 'moxfield' }), 'Genesis Wave').map(c => [c.name, c.count])
        );
        assert.strictEqual(libraryOf({ cardsByName }, { exclude: ['Genesis Wave'] }).size, listSize(cards) - 1);
    });
});
