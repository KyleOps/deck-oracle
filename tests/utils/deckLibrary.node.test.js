import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    deckId, snapshotDeck, saveDeck, listDecks, getDeck, deleteDeck, updateDeckMeta,
    getActiveDeckId, setActiveDeckId, MAX_DECKS
} from '../../js/utils/deckLibrary.js';

function memoryStorage({ quota = Infinity } = {}) {
    const data = new Map();
    return {
        getItem: k => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => {
            if (String(v).length > quota) throw new Error('QuotaExceededError');
            data.set(k, String(v));
        },
        removeItem: k => data.delete(k)
    };
}

const deck = (name, url = null, cards = { Forest: { name: 'Forest', count: 30, category: 'lands' } }) => ({
    deckName: name, importUrl: url, importSource: url ? 'moxfield' : 'paste',
    creatures: 1, lands: 30, actualCardCount: 31, cardDetails: [], cardsByName: cards
});

describe('deckLibrary', () => {
    let storage;
    beforeEach(() => { storage = memoryStorage(); });

    it('derives stable ids from URLs and card lists', () => {
        assert.equal(deckId({ importUrl: 'https://moxfield.com/decks/ABC/' }), deckId({ importUrl: 'https://moxfield.com/decks/abc' }));
        const a = deckId(deck('a'));
        assert.match(a, /^list:/);
        assert.equal(a, deckId(deck('renamed')));
        assert.notEqual(a, deckId(deck('a', null, { X: { name: 'X', count: 1 } })));
    });

    it('snapshots only persistable fields', () => {
        const snap = snapshotDeck(deck('Test', null, { Bolt: { name: 'Bolt', count: 4, oracle_text: 'deal 3', junk: { big: true } } }));
        assert.equal(snap.name, 'Test');
        assert.equal(snap.cardsByName.Bolt.oracle_text, 'deal 3');
        assert.equal(snap.cardsByName.Bolt.junk, undefined);
    });

    it('keeps every commander’s own card record, slimmed, and none without a commander', () => {
        const doctor = {
            name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor',
            color_identity: ['G', 'U'], scryfall_id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d', prices: { usd: '1' }
        };
        const susan = { name: 'Susan Foreman', mana_cost: '{2}{U}', cmc: 3, type_line: 'Legendary Creature — Human', color_identity: ['U'] };
        const commanders = [{ name: 'The Sixth Doctor', card: doctor }, { name: 'Susan Foreman', card: susan }];
        const snap = snapshotDeck({ ...deck(null), commanders });
        assert.equal(snap.name, 'The Sixth Doctor + Susan Foreman', 'an unnamed deck is named for its commanders');
        assert.equal(snap.commanderName, 'The Sixth Doctor', 'the lead commander is kept for older readers');
        assert.equal(snap.commanders.length, 2);
        assert.equal(snap.commanders[0].card.mana_cost, '{4}{G}{U}');
        assert.deepEqual(snap.commanders[0].card.color_identity, ['G', 'U']);
        assert.equal(snap.commanders[0].card.prices, undefined);
        assert.equal(snap.commanders[1].card.cmc, 3);
        assert.equal(snap.commanderCard, undefined, 'derived data is not stored');
        assert.equal(snap.cardDetails, undefined, 'derived data is not stored');
        const id = saveDeck({ ...deck('Doctor'), commanders }, storage);
        assert.deepEqual(getDeck(id, storage).commanders.map(c => c.card.name), ['The Sixth Doctor', 'Susan Foreman']);

        // The legacy single-commander shape (getDeckConfig before multi-commander) still snapshots.
        const legacy = snapshotDeck({ ...deck('Doctor'), commanderName: 'The Sixth Doctor', commanderCard: doctor });
        assert.deepEqual(legacy.commanders.map(c => c.name), ['The Sixth Doctor']);
        assert.equal(legacy.commanders[0].card.cmc, 6);
        assert.deepEqual(snapshotDeck({ ...deck('No commander'), commanderCard: doctor }).commanders, []);
        assert.deepEqual(snapshotDeck(deck('Plain')).commanders, []);
    });

    it('lists commanders and counts them into the deck size', () => {
        const commanders = [{ name: 'Tymna the Weaver', card: null }, { name: 'Kraum, Ludevic’s Opus', card: null }];
        saveDeck({ ...deck('Blitz'), actualCardCount: 98, commanders }, storage);
        // An old snapshot: one commander, by name only, also in its own list.
        const old = {
            id: 'list:old', name: 'Old', commanderName: 'Forest', savedAt: 1, actualCardCount: 30,
            cardsByName: { Forest: { name: 'Forest', count: 30 } }
        };
        storage.setItem('deckOracle.library.v1', JSON.stringify([...JSON.parse(storage.getItem('deckOracle.library.v1')), old]));
        const [blitz, legacy] = listDecks(storage);
        assert.deepEqual(blitz.commanderNames, ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
        assert.equal(blitz.commanderName, 'Tymna the Weaver');
        assert.equal(blitz.cardCount, 100, '98 in the library + 2 commanders');
        assert.deepEqual(legacy.commanderNames, ['Forest']);
        assert.equal(legacy.cardCount, 30, 'a commander already in the list is not counted twice');
    });

    it('tells the same list apart by its commanders', () => {
        const a = deckId({ ...deck('a'), commanders: [{ name: 'Tymna the Weaver' }] });
        const b = deckId({ ...deck('a'), commanders: [{ name: 'Thrasios, Triton Hero' }] });
        assert.notEqual(a, b);
        assert.equal(deckId(deck('a')), deckId({ ...deck('a'), commanders: [] }), 'decks without commanders keep their ids');
    });

    it('saves, lists most-recent first, and re-saving updates in place', async () => {
        saveDeck(deck('First', 'https://moxfield.com/decks/1'), storage);
        await new Promise(r => setTimeout(r, 2));
        saveDeck(deck('Second', 'https://moxfield.com/decks/2'), storage);
        await new Promise(r => setTimeout(r, 2));
        saveDeck(deck('First again', 'https://moxfield.com/decks/1'), storage);
        const list = listDecks(storage);
        assert.equal(list.length, 2);
        assert.equal(list[0].name, 'First again');
        assert.equal(list[0].cardCount, 31);
    });

    it('gets, renames and deletes decks, clearing the active id', () => {
        const id = saveDeck(deck('Keep'), storage);
        setActiveDeckId(id, storage);
        assert.equal(getDeck(id, storage).name, 'Keep');
        assert.ok(updateDeckMeta(id, { format: 'limited' }, storage));
        assert.equal(getDeck(id, storage).format, 'limited');
        assert.ok(deleteDeck(id, storage));
        assert.equal(getDeck(id, storage), null);
        assert.equal(getActiveDeckId(storage), null);
    });

    it(`keeps at most ${MAX_DECKS} decks`, () => {
        for (let i = 0; i < MAX_DECKS + 5; i++) saveDeck(deck(`D${i}`, `https://moxfield.com/decks/${i}`), storage);
        assert.equal(listDecks(storage).length, MAX_DECKS);
    });

    it('evicts the oldest decks when storage is full', () => {
        const small = memoryStorage({ quota: 2500 });
        for (let i = 0; i < 10; i++) saveDeck(deck(`D${i}`, `https://moxfield.com/decks/${i}`), small);
        const list = listDecks(small);
        assert.ok(list.length > 0 && list.length < 10);
        assert.equal(list[0].name, 'D9');
    });

    it('survives missing or corrupt storage', () => {
        assert.deepEqual(listDecks(null), []);
        assert.equal(saveDeck(deck('x'), null), null);
        const broken = memoryStorage();
        broken.setItem('deckOracle.library.v1', '{not json');
        assert.deepEqual(listDecks(broken), []);
        assert.equal(getActiveDeckId({ getItem: () => { throw new Error('blocked'); } }), null);
    });
});
