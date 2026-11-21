/**
 * The command zone: one rule for naming and counting a deck's commanders,
 * used by the deck state, saved decks, comparisons, format detection and
 * deck names.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    frontName, normalizeCommanders, readCommanders, commanderLabel, commandZoneExtras, deckSizeSummary, MAX_COMMANDERS
} from '../../js/utils/commanders.js';
import { detectFormat, resolveFormat } from '../../js/utils/format.js';
import { suggestDeckName, featuredCardName } from '../../js/utils/deckStats.js';
import { compareDecks, toDeck } from '../../js/utils/deckCompare.js';

const DOCTOR = { name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor' };
const SUSAN = { name: 'Susan Foreman', mana_cost: '{2}{U}', cmc: 3, type_line: 'Legendary Creature — Human Time Lord' };
const PAIR = [{ name: 'The Sixth Doctor', card: DOCTOR }, { name: 'Susan Foreman', card: SUSAN }];

describe('commanders — reading and cleaning', () => {
    it('matches names by their front face, case-insensitively', () => {
        assert.equal(frontName('Esika, God of the Tree // The Prismatic Bridge'), 'esika, god of the tree');
        assert.equal(frontName(null), '');
    });

    it('drops blanks, duplicates, and a record for another card', () => {
        const list = normalizeCommanders([
            { name: ' The Sixth Doctor ', card: DOCTOR },
            { name: 'the sixth doctor', card: null },
            { name: '' },
            'Susan Foreman',
            { name: 'Tymna the Weaver', card: SUSAN },
            { card: SUSAN }
        ]);
        assert.deepEqual(list, [
            { name: 'The Sixth Doctor', card: DOCTOR },
            { name: 'Susan Foreman', card: null },
            { name: 'Tymna the Weaver', card: null }
        ]);
        assert.deepEqual(normalizeCommanders(null), []);
        assert.equal(normalizeCommanders(Array.from({ length: 9 }, (_, i) => `C${i}`)).length, MAX_COMMANDERS);
    });

    it('reads a commanders list, or the legacy single commander', () => {
        assert.deepEqual(readCommanders({ commanders: PAIR, commanderName: 'Ignored' }), PAIR);
        assert.deepEqual(readCommanders({ commanderName: 'The Sixth Doctor', commanderCard: DOCTOR }), [{ name: 'The Sixth Doctor', card: DOCTOR }]);
        assert.deepEqual(readCommanders({ commanderName: 'The Sixth Doctor', commanderCard: SUSAN }), [{ name: 'The Sixth Doctor', card: null }]);
        assert.deepEqual(readCommanders({ commanders: [], commanderName: null }), []);
        assert.deepEqual(readCommanders(undefined), []);
    });

    it('labels commanders "A + B"', () => {
        assert.equal(commanderLabel(PAIR), 'The Sixth Doctor + Susan Foreman');
        assert.equal(commanderLabel(['Tymna the Weaver']), 'Tymna the Weaver');
        assert.equal(commanderLabel([]), null);
        assert.equal(commanderLabel(undefined), null);
    });
});

describe('commanders — deck size', () => {
    it('counts the command zone on top of the library: 98 + 2 is a 100-card deck', () => {
        const size = deckSizeSummary(98, PAIR, {});
        assert.equal(size.total, 100);
        assert.equal(size.label, '100 cards');
        assert.equal(size.detail, '98 in the library + 2 commanders');
    });

    it('never counts a commander that is also in the list twice', () => {
        const cards = { Doctor: { ...DOCTOR, count: 1 } };
        assert.equal(commandZoneExtras(PAIR, cards), 1);
        assert.equal(deckSizeSummary(99, PAIR, cards).total, 100);
        assert.equal(deckSizeSummary(99, [{ name: 'The Sixth Doctor' }], cards).detail, null);
    });

    it('is just the library without commanders', () => {
        const size = deckSizeSummary(60, [], {});
        assert.deepEqual([size.total, size.label, size.detail], [60, '60 cards', null]);
        assert.equal(deckSizeSummary(1, [], {}).label, '1 card');
        assert.equal(deckSizeSummary(99, [{ name: 'Atraxa' }]).detail, '99 in the library + 1 commander');
    });
});

describe('commanders — format, names and comparisons', () => {
    it('detects Commander from any commander list', () => {
        assert.equal(detectFormat({ deckSize: 60, commanders: PAIR }), 'commander');
        assert.equal(detectFormat({ deckSize: 60, commanders: ['Tymna the Weaver'] }), 'commander');
        assert.equal(detectFormat({ deckSize: 60, commanders: [] }), 'constructed');
        assert.equal(resolveFormat('auto', { deckSize: 40, commanders: PAIR }).key, 'commander');
    });

    it('names an unnamed deck for all its commanders', () => {
        assert.equal(suggestDeckName({ commanders: PAIR }), 'The Sixth Doctor + Susan Foreman');
        assert.equal(suggestDeckName({ commanderName: 'Atraxa, Praetors’ Voice' }), 'Atraxa, Praetors’ Voice');
        assert.equal(suggestDeckName({ cardsByName: { M: { name: 'Mountain', count: 20, type_line: 'Basic Land — Mountain', color_identity: ['R'] } } }), 'Mono-Red deck');
    });

    it('features the first commander', () => {
        assert.equal(featuredCardName({ commanders: PAIR, cardsByName: {} }), 'The Sixth Doctor');
        assert.equal(featuredCardName({ commanderName: 'Atraxa', cardsByName: {} }), 'Atraxa');
    });

    it('compares decks counted with their commanders', () => {
        const cards = { Island: { name: 'Island', count: 98, cmc: 0, category: 'lands', type_line: 'Basic Land — Island' } };
        const pair = toDeck({ name: 'Pair', cardsByName: cards, actualCardCount: 98, commanders: PAIR });
        assert.equal(pair.commanderName, 'The Sixth Doctor');
        assert.equal(pair.commandZone, 2);
        assert.equal(toDeck({ cardsByName: cards, commanders: PAIR }).name, 'The Sixth Doctor + Susan Foreman');
        const legacy = toDeck({ name: 'Old', cardsByName: cards, actualCardCount: 98, commanderName: 'The Sixth Doctor' });
        const result = compareDecks(pair, legacy);
        const size = result.metrics.find(m => m.key === 'cards');
        assert.deepEqual([size.a, size.b], [100, 99]);
        assert.equal(result.a.format.key, 'commander');
        assert.equal(result.b.format.key, 'commander');
    });
});
