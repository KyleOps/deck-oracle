/**
 * Deck import end to end: one card-record builder for every source, and
 * every commander kept, from a pasted list, a Moxfield link and an Archidekt
 * link. The network is a stubbed `fetch` answering with fixtures shaped like
 * the real APIs (tests/fixtures/deckSites.js).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toCardRecord, typeCategories, importDeckFromUrl, importDecklistBatch, parseDecklistText } from '../../js/utils/decklistImport.js';
import { resetScryfallForTests } from '../../js/utils/scryfall.js';
import { ARCHIDEKT_DECK, MOXFIELD_DECK, PASTED_DOCTOR_LIST, collectionResponse, fuzzyCard } from '../fixtures/deckSites.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** A fetch that answers like the proxy, Moxfield, Archidekt and Scryfall. */
function stubNetwork({ calls = [] } = {}) {
    return async (url, init = {}) => {
        const href = String(url);
        calls.push(href);
        if (href.includes('api2.moxfield.com')) return json(MOXFIELD_DECK);
        if (href.includes('archidekt.com%2Fapi')) return json(ARCHIDEKT_DECK);
        if (href.endsWith('/cards/collection')) return json(collectionResponse(init.body));
        const fuzzy = href.match(/cards\/named\?fuzzy=([^&]+)/);
        if (fuzzy) {
            const card = fuzzyCard(decodeURIComponent(fuzzy[1]));
            return card ? json(card) : json({ details: 'Not found' }, 404);
        }
        return json({ details: 'unexpected request' }, 500);
    };
}

let realFetch;
beforeEach(() => {
    realFetch = globalThis.fetch;
    resetScryfallForTests();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('toCardRecord — one builder for every source', () => {
    it('reads a Scryfall card, front face for double-faced cards', () => {
        const card = toCardRecord({
            object: 'card', id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d', name: 'Esika, God of the Tree // The Prismatic Bridge',
            cmc: 3, color_identity: ['W', 'U', 'B', 'R', 'G'],
            card_faces: [
                { name: 'Esika, God of the Tree', mana_cost: '{1}{G}{G}', type_line: 'Legendary Creature — God', oracle_text: 'Vigilance', power: '1', toughness: '4', colors: ['G'] },
                { name: 'The Prismatic Bridge', mana_cost: '{W}{U}{B}{R}{G}', type_line: 'Legendary Enchantment' }
            ]
        });
        assert.equal(card.mana_cost, '{1}{G}{G}');
        assert.equal(card.type_line, 'Legendary Creature — God');
        assert.equal(card.oracle_text, 'Vigilance');
        assert.equal(card.cmc, 3);
        assert.equal(card.count, 1);
        assert.equal(card.category, 'creatures');
        assert.equal(card.power, '1');
        assert.deepEqual(card.colors, ['G']);
        assert.deepEqual(card.color_identity, ['W', 'U', 'B', 'R', 'G']);
        assert.equal(card.scryfall_id, 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d');
    });

    it('reads Moxfield’s snake_case cards', () => {
        const mox = toCardRecord({
            name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor',
            oracle_text: 'Copy historic spells.', color_identity: ['G', 'U'], scryfall_id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d'
        }, 1);
        assert.equal(mox.mana_cost, '{4}{G}{U}');
        assert.deepEqual(mox.color_identity, ['G', 'U']);
    });

    it('reads Archidekt’s camelCase oracle cards: cost, rules text, colours, mana', () => {
        // Regression: Archidekt library cards used to import with no mana cost
        // and no rules text (it says manaCost / text, not mana_cost / oracle_text).
        const [sol] = ARCHIDEKT_DECK.cards.filter(e => e.card.oracleCard.name === 'Sol Ring');
        const card = toCardRecord(sol.card.oracleCard, 1);
        assert.equal(card.mana_cost, '{1}');
        assert.equal(card.oracle_text, '{T}: Add {C}{C}.');
        assert.equal(card.type_line, 'Artifact');
        assert.deepEqual(card.produced_mana, ['C']);

        const azusa = toCardRecord({
            name: 'Azusa, Lost but Seeking', manaCost: '{2}{G}', cmc: 3, text: 'You may play two additional lands on each of your turns.',
            superTypes: ['Legendary'], types: ['Creature'], subTypes: ['Human', 'Monk'], colorIdentity: ['Green'],
            scryfallId: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d'
        });
        assert.equal(azusa.type_line, 'Legendary Creature — Human Monk');
        assert.equal(azusa.mana_cost, '{2}{G}');
        assert.match(azusa.oracle_text, /two additional lands/);
        assert.deepEqual(azusa.color_identity, ['G']);
        assert.equal(azusa.scryfall_id, 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d');
    });

    it('reads an Archidekt double-faced card from its front face', () => {
        const esika = ARCHIDEKT_DECK.cards.find(e => e.card.oracleCard.layout === 'modal_dfc').card.oracleCard;
        const card = toCardRecord(esika, 2);
        assert.equal(card.mana_cost, '{1}{G}{G}');
        assert.equal(card.type_line, 'Legendary Creature — God');
        assert.match(card.oracle_text, /Vigilance/);
        assert.equal(card.power, '1');
        assert.equal(card.toughness, '4');
        assert.deepEqual(card.colors, ['G']);
        assert.equal(card.count, 2);
    });

    it('returns null when there is nothing to build from', () => {
        assert.equal(toCardRecord(null), null);
        assert.equal(toCardRecord({ name: 'Mystery' }), null);
        assert.equal(toCardRecord({ type_line: 'Creature' }), null);
    });

    it('sorts type lines into every bucket, primary first', () => {
        assert.deepEqual(typeCategories('Artifact Creature — Golem'), ['creatures', 'artifacts']);
        assert.deepEqual(typeCategories('Basic Land — Forest'), ['lands']);
        assert.deepEqual(typeCategories('Kindred Instant — Elf'), ['instants']);
        assert.deepEqual(typeCategories('Something new'), ['artifacts']);
    });

    it('re-exports the text parser', () => {
        assert.equal(typeof parseDecklistText, 'function');
    });
});

describe('importDecklistBatch — a pasted list', () => {
    it('keeps both commanders, out of the library, with their card records', async () => {
        globalThis.fetch = stubNetwork();
        const progress = [];
        const deck = await importDecklistBatch(PASTED_DOCTOR_LIST, p => progress.push(p.percentage));
        assert.deepEqual(deck.commanders.map(c => c.name), ['The Sixth Doctor', 'Susan Foreman']);
        assert.equal(deck.commanders[0].card.mana_cost, '{4}{G}{U}');
        assert.equal(deck.commanders[1].card.cmc, 3);
        assert.equal(deck.commanderName, 'The Sixth Doctor', 'the lead commander, for single-commander callers');
        assert.equal(deck.cardsByName['The Sixth Doctor'], undefined);
        assert.equal(deck.cardsByName['Susan Foreman'], undefined);
        assert.equal(deck.actualCardCount, 98);
        assert.equal(deck.lands, 95);
        assert.deepEqual(deck.importMetadata.commanderNames, ['The Sixth Doctor', 'Susan Foreman']);
        assert.equal(progress.at(-1), 100);
        assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]), 'progress only moves forward');
    });

    it('lands a typo Scryfall corrected on the line that asked for it', async () => {
        globalThis.fetch = stubNetwork();
        const deck = await importDecklistBatch(PASTED_DOCTOR_LIST);
        assert.equal(deck.cardsByName['Sol Ring']?.count, 1, '"Sol Rnig" found by the fuzzy fallback');
        assert.equal(deck.importMetadata.missingCardCount, 0);
    });

    it('reports cards Scryfall does not know, and throws when it knows none', async () => {
        globalThis.fetch = stubNetwork();
        const deck = await importDecklistBatch('1 Sol Ring\n2 Not A Real Card');
        assert.deepEqual(deck.importMetadata.missingCards, [{ name: 'Not A Real Card', count: 2 }]);
        assert.equal(deck.actualCardCount, 1);
        await assert.rejects(importDecklistBatch('1 Not A Real Card'), /None of those cards/);
        await assert.rejects(importDecklistBatch('Commander\n1 The Sixth Doctor'), /No cards found/);
    });

    it('asks Scryfall once for the library and the commanders together', async () => {
        const calls = [];
        globalThis.fetch = stubNetwork({ calls });
        await importDecklistBatch(PASTED_DOCTOR_LIST);
        assert.equal(calls.filter(u => u.endsWith('/cards/collection')).length, 1);
    });

    it('says Scryfall is unreachable instead of calling every card a typo', async () => {
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        await assert.rejects(importDecklistBatch('1 Sol Ring\n1 Island'), err => err.kind === 'network');
    });
});

describe('importDeckFromUrl — Moxfield', () => {
    it('keeps a partner pair, the mainboard only, and looks up thin cards', async () => {
        const calls = [];
        globalThis.fetch = stubNetwork({ calls });
        const deck = await importDeckFromUrl('https://moxfield.com/decks/abcdefgh12');
        assert.deepEqual(deck.commanders.map(c => c.name), ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
        assert.equal(deck.commanders[1].card.mana_cost, '{3}{U}{R}');
        assert.equal(deck.deckName, 'Tymna Kraum Blitz');
        assert.equal(deck.actualCardCount, 33, '30 Plains, Sol Ring, Delver, Arcane Signet');
        assert.equal(deck.cardsByName['Arcane Signet'].mana_cost, '{2}', 'looked up on Scryfall');
        assert.equal(deck.cardsByName['Delver of Secrets // Insectile Aberration'].mana_cost, '{U}');
        assert.equal(deck.cardsByName['Swords to Plowshares'], undefined, 'sideboard left out');
        assert.equal(deck.cardsByName['Lurrus of the Dream-Den'], undefined, 'companion left out');
        assert.equal(deck.cardsByName['Mana Crypt'], undefined, 'maybeboard left out');
        assert.equal(deck.importMetadata.sideboardCount, 2);
        assert.equal(deck.importMetadata.source, 'Moxfield');
        assert.ok(calls[0].includes(encodeURIComponent('https://api2.moxfield.com/v3/decks/all/abcdefgh12')));
        // Commanders with full data are never looked up again.
        assert.equal(calls.filter(u => u.endsWith('/cards/collection')).length, 1);
    });

    it('rejects links to other sites before fetching anything', async () => {
        const calls = [];
        globalThis.fetch = stubNetwork({ calls });
        await assert.rejects(importDeckFromUrl('https://example.com/decks/1'), /Invalid URL/);
        assert.equal(calls.length, 0);
    });

    it('passes deck-site failures on with their status', async () => {
        globalThis.fetch = async () => json({}, 404);
        await assert.rejects(importDeckFromUrl('https://moxfield.com/decks/abcdefgh12'), err => err.kind === 'http' && err.status === 404);
    });
});

describe('importDeckFromUrl — Archidekt', () => {
    it('keeps a Doctor and their companion, with costs, rules text and colours', async () => {
        globalThis.fetch = stubNetwork();
        const deck = await importDeckFromUrl('https://archidekt.com/decks/1234567/ninth_doctor');
        assert.deepEqual(deck.commanders.map(c => c.name), ['The Ninth Doctor', 'Clara Oswald']);
        assert.equal(deck.commanders[0].card.mana_cost, '{1}{U}{R}');
        assert.deepEqual(deck.commanders[0].card.color_identity, ['U', 'R']);
        assert.equal(deck.commanders[0].card.scryfall_id, '74785b3b-44df-4555-a036-082572b7f4e7', 'the printing’s id');
        assert.equal(deck.commanders[1].card.mana_cost, '{6}');

        assert.equal(deck.cardsByName.Island.count, 32, 'two printings of one card are one record');
        assert.deepEqual(deck.cardsByName.Island.produced_mana, ['U']);
        assert.equal(deck.cardsByName['Sol Ring'].mana_cost, '{1}');
        assert.equal(deck.cardsByName['Sol Ring'].oracle_text, '{T}: Add {C}{C}.');
        assert.equal(deck.cardsByName['Esika, God of the Tree // The Prismatic Bridge'].mana_cost, '{1}{G}{G}');
        assert.equal(deck.cardsByName['Mana Crypt'], undefined, 'a category left out of the deck');
        assert.equal(deck.cardsByName.Pyroblast, undefined, 'the sideboard');
        assert.equal(deck.actualCardCount, 34);
        assert.equal(deck.lands, 32);
        assert.equal(deck.importMetadata.sideboardCount, 1);
        assert.equal(deck.importMetadata.source, 'Archidekt');
    });
});
