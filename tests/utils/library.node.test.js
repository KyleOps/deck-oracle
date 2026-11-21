import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    nameKey, sameCard, CARD_TYPES, PERMANENT_TYPES, frontTypeLine, cardTypes, isLand, isPermanent,
    libraryOf, commanderNamesOf, expandLibrary, findInLibrary
} from '../../js/utils/library.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { FORMATS } from '../../js/utils/format.js';

const rec = (name, count, type_line = 'Sorcery', cmc = 2) => ({ name, count, type_line, cmc });

/** A partner deck: two commanders, and a list that may or may not hold them. */
function partnerDeck({ listed = false } = {}) {
    const cardsByName = {
        Forest: rec('Forest', 30, 'Basic Land — Forest', 0),
        'Sol Ring': rec('Sol Ring', 1, 'Artifact', 1),
        'Llanowar Elves': rec('Llanowar Elves', 1, 'Creature — Elf Druid', 1),
        'Sea Gate Restoration // Sea Gate, Reborn': rec('Sea Gate Restoration // Sea Gate, Reborn', 1, 'Sorcery', 7),
        Opt: rec('Opt', 64, 'Instant', 1)
    };
    if (listed) {
        cardsByName['The Sixth Doctor'] = rec('The Sixth Doctor', 1, 'Legendary Creature — Time Lord Doctor', 6);
        cardsByName['Susan Foreman'] = rec('Susan Foreman', 1, 'Legendary Creature — Time Lord', 2);
    }
    return {
        cardsByName,
        commanderName: 'The Sixth Doctor',
        commanders: [{ name: 'The Sixth Doctor', card: null }, { name: 'Susan Foreman', card: null }],
        format: 'auto'
    };
}

describe('nameKey / sameCard', () => {
    it('matches on the front face in any case', () => {
        assert.equal(nameKey('Sea Gate Restoration // Sea Gate, Reborn'), 'sea gate restoration');
        assert.equal(nameKey('  Sol Ring '), 'sol ring');
        assert.equal(nameKey(null), '');
        assert.ok(sameCard('SOL RING', 'Sol Ring'));
        assert.ok(sameCard('Sea Gate Restoration', 'Sea Gate Restoration // Sea Gate, Reborn'));
        assert.ok(!sameCard('', ''));
        assert.ok(!sameCard('Opt', 'Optimus'));
    });
});

describe('card typing', () => {
    it('reads whole card types from the front face, in display order', () => {
        assert.deepEqual(cardTypes('Legendary Artifact Creature — Golem'), ['creature', 'artifact']);
        assert.deepEqual(cardTypes('Sorcery // Land'), ['sorcery']);
        assert.deepEqual(cardTypes('Land Creature — Forest Dryad'), ['creature', 'land']);
        assert.deepEqual(cardTypes('Kindred Instant — Elf'), ['instant']);
        assert.deepEqual(cardTypes(''), []);
        assert.deepEqual(cardTypes(undefined), []);
        assert.equal(frontTypeLine('Instant // Sorcery'), 'instant ');
    });

    it('never mistakes a subtype for a type', () => {
        assert.deepEqual(cardTypes('Creature — Island Wurm'), ['creature']);
        assert.ok(!isLand('Enchantment — Cartouche'));
    });

    it('returns a shared, frozen array per type line', () => {
        const a = cardTypes('Artifact');
        assert.equal(a, cardTypes('Artifact'));
        assert.ok(Object.isFrozen(a));
        assert.ok(CARD_TYPES.every(t => typeof t === 'string'));
        assert.ok(PERMANENT_TYPES.every(t => CARD_TYPES.includes(t)));
    });

    it('isLand accepts type lines, records and simulation cards', () => {
        assert.ok(isLand('Basic Land — Forest'));
        assert.ok(!isLand('Sorcery // Land'));
        assert.ok(isLand({ type_line: 'Artifact Land' }));
        assert.ok(isLand({ typeLine: 'Land' }));
        assert.ok(isLand({ category: 'lands' }));
        assert.ok(isLand({ land: true, type_line: 'Sorcery' }));
        assert.ok(!isLand({ land: false, type_line: 'Land' }));
        assert.ok(isLand({ types: ['land'] }));
        assert.ok(!isLand({ types: ['creature'], type_line: 'Land' }));
        assert.ok(!isLand(null));
        assert.ok(!isLand({}));
    });

    it('isPermanent covers every permanent type and nothing else', () => {
        for (const t of ['Creature', 'Artifact', 'Enchantment — Aura', 'Legendary Planeswalker — Jace', 'Battle — Siege', 'Land']) {
            assert.ok(isPermanent(t), t);
        }
        assert.ok(!isPermanent('Instant'));
        assert.ok(!isPermanent('Sorcery // Land'));
        assert.ok(isPermanent({ type_line: 'Artifact' }));
        assert.ok(isPermanent({ types: ['land'] }));
        assert.ok(!isPermanent({ types: ['sorcery'] }));
        assert.ok(!isPermanent(undefined));
    });

    it('agrees with the five helpers it replaced on every card of the example deck', () => {
        const legacyIncludes = tl => CARD_TYPES.filter(t => String(tl ?? '').toLowerCase().includes(t));
        const legacyBoundary = tl => /\bland\b/.test(String(tl ?? '').split('//')[0].toLowerCase());
        for (const card of Object.values(DEFAULT_DECK_DATA.cardsByName)) {
            assert.deepEqual([...cardTypes(card.type_line)], legacyIncludes(card.type_line), card.name);
            assert.equal(isLand(card), legacyBoundary(card.type_line), card.name);
            assert.equal(isLand(card), card.category === 'lands', card.name);
        }
    });
});

describe('commanderNamesOf', () => {
    it('reads `commanders` first, then `commanderName`', () => {
        assert.deepEqual(commanderNamesOf(partnerDeck()), ['The Sixth Doctor', 'Susan Foreman']);
        assert.deepEqual(commanderNamesOf({ commanderName: 'Atraxa' }), ['Atraxa']);
        assert.deepEqual(commanderNamesOf({ commanders: ['A', { name: 'B' }, { name: '' }, null] }), ['A', 'B']);
        assert.deepEqual(commanderNamesOf({ commanders: [], commanderName: 'Atraxa' }), ['Atraxa']);
        assert.deepEqual(commanderNamesOf({ commanderName: '  ' }), []);
        assert.deepEqual(commanderNamesOf(null), []);
    });
});

describe('libraryOf — commanders are never in the library', () => {
    it('two commanders the list does not hold: the library is the list', () => {
        const lib = libraryOf(partnerDeck());
        assert.equal(lib.size, 97);
        assert.deepEqual(lib.commanders, ['The Sixth Doctor', 'Susan Foreman']);
        assert.deepEqual(lib.removed, []);
    });

    it('two commanders the list holds: both come out, and the library is the same', () => {
        const without = libraryOf(partnerDeck());
        const withThem = libraryOf(partnerDeck({ listed: true }));
        assert.equal(withThem.size, 97);
        assert.deepEqual(withThem.removed, ['The Sixth Doctor', 'Susan Foreman']);
        assert.ok(!withThem.cards.some(c => /Doctor|Susan/.test(c.name)));
        assert.equal(withThem.key, without.key);
    });

    it('matches commanders on the front face, in any case', () => {
        const deck = partnerDeck({ listed: true });
        deck.commanders = [{ name: 'the sixth doctor' }, { name: 'SUSAN FOREMAN // whatever' }];
        assert.equal(libraryOf(deck).size, 97);
    });

    it('works with only `commanderName` (one commander) — the state before `commanders` existed', () => {
        const deck = partnerDeck({ listed: true });
        delete deck.commanders;
        const lib = libraryOf(deck);
        assert.deepEqual(lib.commanders, ['The Sixth Doctor']);
        assert.equal(lib.size, 98);
    });

    it('takes explicit options over the snapshot', () => {
        const deck = partnerDeck({ listed: true });
        const lib = libraryOf(deck.cardsByName, { format: FORMATS.commander, commanders: ['Susan Foreman'] });
        assert.equal(lib.size, 98);
        assert.deepEqual(lib.removed, ['Susan Foreman']);
        assert.equal(libraryOf(deck.cardsByName).size, 99, 'a bare map has no command zone');
        assert.equal(libraryOf(deck, { commanders: [] }).size, 99);
    });

    it('outside Commander a "commander" is just a card', () => {
        const deck = { ...partnerDeck({ listed: true }), format: 'constructed' };
        assert.equal(libraryOf(deck).size, 99);
        assert.deepEqual(libraryOf(deck).commanders, []);
        assert.equal(libraryOf(deck, { format: FORMATS.commander }).size, 97);
        assert.equal(libraryOf(partnerDeck({ listed: true }), { format: 'limited' }).size, 99);
        assert.equal(libraryOf(partnerDeck({ listed: true }), { format: 'commander' }).size, 97);
    });

    it('removes one copy per commander, not every copy', () => {
        const deck = { cardsByName: { Rats: rec('Rats', 3, 'Creature — Rat') }, commanderName: 'Rats' };
        const lib = libraryOf(deck);
        assert.equal(lib.size, 2);
        assert.equal(lib.cards[0].count, 2);
        assert.equal(deck.cardsByName.Rats.count, 3, 'the deck is not modified');
        assert.ok(Object.isFrozen(lib.cards[0]));
    });

    it('lists the same commander twice only once', () => {
        const deck = partnerDeck({ listed: true });
        deck.commanders = [{ name: 'Susan Foreman' }, { name: 'susan foreman' }];
        assert.equal(libraryOf(deck).size, 98);
    });

    it('excludes cards that are elsewhere (the spell on the stack), one copy each', () => {
        const deck = partnerDeck();
        const lib = libraryOf(deck, { exclude: ['Opt', 'opt', 'Not In Deck'] });
        assert.equal(lib.size, 95);
        assert.deepEqual(lib.removed, ['Opt', 'Opt']);
        assert.equal(lib.cards.find(c => c.name === 'Opt').count, 62);
    });

    it('skips empty rows and junk, keeps list order, and normalises counts', () => {
        const lib = libraryOf({
            a: rec('A', 2), b: rec('B', 0), c: null, d: { count: 3 }, e: rec('E', '2'), f: rec('F', 1.7)
        });
        assert.deepEqual(lib.cards.map(c => [c.name, c.count]), [['A', 2], ['E', 2], ['F', 1]]);
        assert.equal(lib.size, 5);
    });

    it('is empty for counts-only decks and nothing at all', () => {
        assert.equal(libraryOf({ cardsByName: {}, lands: 36, commanderName: null }).size, 0);
        assert.equal(libraryOf({ lands: 36, actualCardCount: 99 }).size, 0);
        assert.equal(libraryOf(null).size, 0);
        assert.equal(libraryOf(undefined, { commanders: ['X'], format: 'commander' }).size, 0);
    });

    it('caches per cardsByName object and options, and the result is frozen', () => {
        const deck = partnerDeck({ listed: true });
        const a = libraryOf(deck);
        assert.equal(libraryOf({ ...deck }), a, 'a new snapshot of the same list is the same library');
        assert.notEqual(libraryOf(deck, { format: 'constructed' }), a);
        assert.notEqual(libraryOf({ ...deck, cardsByName: { ...deck.cardsByName } }), a);
        assert.ok(Object.isFrozen(a) && Object.isFrozen(a.cards));
        assert.equal(libraryOf({ ...deck, cardsByName: { ...deck.cardsByName } }).key, a.key, 'equal contents, equal key');
        assert.notEqual(libraryOf(deck, { format: 'constructed' }).key, a.key);
    });

    it('builds the bundled example deck without its commanders', () => {
        const lib = libraryOf(DEFAULT_DECK_DATA);
        const all = Object.values(DEFAULT_DECK_DATA.cardsByName).reduce((s, c) => s + c.count, 0);
        assert.equal(lib.size, 98);
        assert.ok(lib.size <= all);
        for (const name of commanderNamesOf(DEFAULT_DECK_DATA)) {
            assert.equal(findInLibrary(lib, name), null, name);
        }
    });
});

describe('expandLibrary / findInLibrary', () => {
    it('makes one entry per copy, mapped as asked', () => {
        const lib = libraryOf({ a: rec('A', 2), b: rec('B', 1) });
        assert.deepEqual(expandLibrary(lib).map(c => c.name), ['A', 'A', 'B']);
        assert.deepEqual(expandLibrary(lib.cards, (c, i) => `${c.name}${i}`), ['A0', 'A1', 'B0']);
        assert.deepEqual(expandLibrary(null), []);
    });

    it('finds a record by exact name, then by front face', () => {
        const lib = libraryOf(partnerDeck());
        assert.equal(findInLibrary(lib, 'Sol Ring')?.name, 'Sol Ring');
        assert.equal(findInLibrary(lib, 'sea gate restoration')?.name, 'Sea Gate Restoration // Sea Gate, Reborn');
        assert.equal(findInLibrary(lib.cards, 'Opt')?.count, 64);
        assert.equal(findInLibrary(lib, 'Nope'), null);
        assert.equal(findInLibrary(lib, ''), null);
    });
});
