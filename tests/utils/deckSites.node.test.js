/**
 * Deck sites: which links are accepted, and each site's JSON read into one
 * neutral shape (fixtures follow the real Moxfield v3 and Archidekt APIs).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckInput, deckApiUrl, readMoxfieldDeck, readArchidektDeck, fetchDeck, PROXY_URL } from '../../js/utils/deckSites.js';
import { ARCHIDEKT_DECK, MOXFIELD_DECK } from '../fixtures/deckSites.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe('parseDeckInput', () => {
    it('accepts Moxfield and Archidekt deck links', () => {
        assert.deepEqual(parseDeckInput('https://www.moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg'), { site: 'moxfield', id: 'BdgPCOK4IUyNd2287K2mvg' });
        assert.deepEqual(parseDeckInput('moxfield.com/decks/abcdefgh12/primer'), { site: 'moxfield', id: 'abcdefgh12' });
        assert.deepEqual(parseDeckInput('https://moxfield.com/decks/abcdefgh12?tab=stats'), { site: 'moxfield', id: 'abcdefgh12' });
        assert.deepEqual(parseDeckInput(' https://archidekt.com/decks/27125481/the_ninth_doctor '), { site: 'archidekt', id: '27125481' });
        assert.deepEqual(parseDeckInput('abcdefgh12'), { site: 'moxfield', id: 'abcdefgh12' }, 'a bare id is Moxfield’s');
    });

    it('rejects everything else', () => {
        for (const bad of ['', null, 42, 'https://example.com/decks/abc', 'https://moxfield.com.evil.test/decks/abcdefgh12',
            'https://archidekt.com/decks/notanumber', 'x'.repeat(201), 'short']) {
            assert.deepEqual(parseDeckInput(bad), { site: null, id: null }, String(bad).slice(0, 40));
        }
    });

    it('builds each site’s API URL', () => {
        assert.equal(deckApiUrl('moxfield', 'abc'), 'https://api2.moxfield.com/v3/decks/all/abc');
        assert.equal(deckApiUrl('archidekt', '42'), 'https://archidekt.com/api/decks/42/');
    });
});

describe('readMoxfieldDeck', () => {
    it('keeps every commander and the mainboard; counts the sideboard', () => {
        const deck = readMoxfieldDeck(MOXFIELD_DECK);
        assert.deepEqual(deck.commanders.map(c => c.name), ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
        assert.equal(deck.cards.reduce((s, c) => s + c.count, 0), 33);
        assert.equal(deck.sideboardCount, 2);
        assert.equal(deck.deckName, 'Tymna Kraum Blitz');
        assert.ok(!deck.cards.some(c => /Lurrus|Mana Crypt|Swords/.test(c.name)));
    });

    it('survives an empty or odd answer', () => {
        assert.deepEqual(readMoxfieldDeck({}), { deckName: null, cards: [], commanders: [], sideboardCount: 0 });
        assert.deepEqual(readMoxfieldDeck(null).cards, []);
        assert.deepEqual(readMoxfieldDeck({ boards: { mainboard: { cards: { a: { quantity: 2 } } } } }).cards, []);
    });
});

describe('readArchidektDeck', () => {
    it('keeps every "Commander" card and leaves out excluded categories', () => {
        const deck = readArchidektDeck(ARCHIDEKT_DECK);
        assert.deepEqual(deck.commanders.map(c => c.name), ['The Ninth Doctor', 'Clara Oswald']);
        assert.equal(deck.commanders[0].raw.scryfallId, '74785b3b-44df-4555-a036-082572b7f4e7', 'the printing carries the Scryfall id');
        assert.deepEqual(deck.cards.map(c => `${c.count} ${c.name}`), [
            '30 Island', '1 Sol Ring', '1 Esika, God of the Tree // The Prismatic Bridge', '2 Island'
        ]);
        assert.equal(deck.sideboardCount, 1);
    });

    it('leaves out companions and sideboards even when the deck lacks category settings', () => {
        const deck = readArchidektDeck({
            name: 'Bare',
            cards: [
                { quantity: 1, categories: ['Sideboard'], card: { oracleCard: { name: 'A' } } },
                { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'B' } } },
                { quantity: 1, categories: [], companion: true, card: { oracleCard: { name: 'Lurrus of the Dream-Den' } } },
                { quantity: 3, categories: [], card: { name: 'Plain old card' } },
                { quantity: 1, categories: [], card: {} }
            ]
        });
        assert.deepEqual(deck.cards.map(c => `${c.count} ${c.name}`), ['3 Plain old card']);
        assert.equal(deck.sideboardCount, 1);
        assert.deepEqual(readArchidektDeck(undefined).cards, []);
    });
});

describe('fetchDeck', () => {
    it('fetches through the proxy and reads the site’s shape', async () => {
        const seen = [];
        globalThis.fetch = async url => { seen.push(String(url)); return { ok: true, status: 200, json: async () => ARCHIDEKT_DECK }; };
        const deck = await fetchDeck('https://archidekt.com/decks/1234567');
        assert.equal(deck.site, 'archidekt');
        assert.equal(deck.commanders.length, 2);
        assert.equal(seen[0], `${PROXY_URL}?url=${encodeURIComponent('https://archidekt.com/api/decks/1234567/')}`);
    });

    it('refuses links it does not know', async () => {
        await assert.rejects(fetchDeck('https://example.com/deck'), /Invalid URL/);
    });
});
