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

    it('keeps the commander’s own card record, slimmed, and drops it without a commander', () => {
        const commanderCard = {
            name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor',
            color_identity: ['G', 'U'], scryfall_id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d', prices: { usd: '1' }
        };
        const snap = snapshotDeck({ ...deck('Doctor'), commanderName: 'The Sixth Doctor', commanderCard });
        assert.equal(snap.commanderCard.mana_cost, '{4}{G}{U}');
        assert.equal(snap.commanderCard.cmc, 6);
        assert.deepEqual(snap.commanderCard.color_identity, ['G', 'U']);
        assert.equal(snap.commanderCard.prices, undefined);
        const id = saveDeck({ ...deck('Doctor'), commanderName: 'The Sixth Doctor', commanderCard }, storage);
        assert.equal(getDeck(id, storage).commanderCard.name, 'The Sixth Doctor');

        assert.equal(snapshotDeck({ ...deck('No commander'), commanderCard }).commanderCard, null);
        assert.equal(snapshotDeck(deck('Plain')).commanderCard, null);
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
