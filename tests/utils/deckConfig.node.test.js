/**
 * Deck state: the commander's own card record survives imports, saved decks
 * and manual edits the way its name does.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../node-test-helper.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

const COMMANDER = {
    name: 'Azusa, Lost but Seeking', mana_cost: '{2}{G}', cmc: 3, type_line: 'Legendary Creature — Human Monk',
    color_identity: ['G'], count: 1
};

const snapshot = (extra = {}) => ({
    id: 'list:test', name: 'Lands', commanderName: COMMANDER.name, importSource: 'paste',
    counts: { lands: 40, creatures: 59 }, actualCardCount: 99,
    cardsByName: { Forest: { name: 'Forest', count: 40, type_line: 'Basic Land — Forest' } },
    ...extra
});

describe('deckConfig commander record', () => {
    beforeEach(() => DeckConfig.resetForTests());

    it('finds the bundled example’s commander in its own list', () => {
        const card = DeckConfig.getCommanderCard();
        assert.equal(card?.name, DeckConfig.getCommanderName());
        assert.equal(card.cmc, 6);
    });

    it('restores commanderCard from a saved deck', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard().mana_cost, '{2}{G}');
        assert.equal(DeckConfig.getDeckConfig().commanderCard.name, COMMANDER.name);
    });

    it('returns null without a record, and ignores a record for a different commander', () => {
        DeckConfig.loadSnapshot(snapshot(), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard(), null);
        DeckConfig.loadSnapshot(snapshot({ commanderCard: { ...COMMANDER, name: 'Someone Else' } }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard(), null);
        DeckConfig.loadSnapshot(snapshot({ commanderName: null, commanderCard: COMMANDER }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard(), null);
    });

    it('matches a double-faced commander by its front face', () => {
        DeckConfig.loadSnapshot(snapshot({
            commanderName: 'Esika, God of the Tree',
            commanderCard: { ...COMMANDER, name: 'Esika, God of the Tree // The Prismatic Bridge' }
        }), { persistActive: false });
        assert.equal(DeckConfig.getCommanderCard().name, 'Esika, God of the Tree // The Prismatic Bridge');
    });

    it('lists the command zone: the example’s one commander, with its card', () => {
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor']);
        assert.equal(DeckConfig.getCommanders()[0].card?.cmc, 6);
    });

    it('lists a single saved commander with its record, or none at all', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        assert.deepEqual(DeckConfig.getCommanders(), [{ name: COMMANDER.name, card: COMMANDER }]);
        DeckConfig.loadSnapshot(snapshot({ commanderName: null }), { persistActive: false });
        assert.deepEqual(DeckConfig.getCommanders(), []);
    });

    it('clears the record when the deck becomes manual counts', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        DeckConfig.updateField('lands', 38);
        assert.equal(DeckConfig.getDeckConfig().commanderCard, null);
        assert.equal(DeckConfig.getCommanderCard(), null);
    });

    it('accepts null through updateDeck', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderCard: COMMANDER }), { persistActive: false });
        DeckConfig.updateDeck({ commanderCard: null });
        assert.equal(DeckConfig.getDeckConfig().commanderCard, null);
    });
});

const DOCTOR = { name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor', color_identity: ['G', 'U'], count: 1 };
const SUSAN = { name: 'Susan Foreman', mana_cost: '{2}{U}', cmc: 3, type_line: 'Legendary Creature — Human Time Lord', color_identity: ['U'], count: 1 };
const PAIR = [{ name: DOCTOR.name, card: DOCTOR }, { name: SUSAN.name, card: SUSAN }];

describe('deckConfig — every commander', () => {
    beforeEach(() => DeckConfig.resetForTests());

    it('keeps a pair from a snapshot, with the first as the lead', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderName: undefined, commanders: PAIR, actualCardCount: 98 }), { persistActive: false });
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor', 'Susan Foreman']);
        assert.deepEqual(DeckConfig.getCommanders().map(c => c.card?.cmc), [6, 3]);
        const config = DeckConfig.getDeckConfig();
        assert.equal(config.commanderName, 'The Sixth Doctor', 'derived from commanders');
        assert.equal(config.commanderCard, DOCTOR);
        assert.equal(DeckConfig.getCommanderName(), 'The Sixth Doctor');
        assert.equal(DeckConfig.getCommanderCard(), DOCTOR);
        assert.equal(DeckConfig.getFormat().key, 'commander');
    });

    it('counts the deck the way players do: 98 + 2 commanders = 100 cards', () => {
        DeckConfig.loadSnapshot(snapshot({ commanderName: undefined, commanders: PAIR, actualCardCount: 98 }), { persistActive: false });
        const total = DeckConfig.getDeckTotal();
        assert.equal(total.total, 100);
        assert.equal(total.label, '100 cards');
        assert.equal(total.detail, '98 in the library + 2 commanders');
        assert.equal(DeckConfig.getDeckSize(true), 98, 'the odds still use the library');
    });

    it('the bundled example counts its commander once', () => {
        const names = DeckConfig.getCommanderNames();
        const total = DeckConfig.getDeckTotal();
        assert.ok(names.length >= 1);
        assert.ok([99, 100].includes(total.total), `${total.total}`);
    });

    it('sets the command zone through updateDeck, old keys included', () => {
        DeckConfig.updateDeck({ commanders: PAIR });
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor', 'Susan Foreman']);
        // The same lead by name keeps the pair (getDeckConfig() round-trips).
        DeckConfig.updateDeck(DeckConfig.getDeckConfig());
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor', 'Susan Foreman']);
        DeckConfig.updateDeck({ commanderCard: { ...DOCTOR, cmc: 7 } });
        assert.equal(DeckConfig.getCommanders()[0].card.cmc, 7);
        assert.equal(DeckConfig.getCommanders()[1].name, 'Susan Foreman');
        DeckConfig.updateDeck({ commanderName: 'Atraxa, Praetors’ Voice' });
        assert.deepEqual(DeckConfig.getCommanders(), [{ name: 'Atraxa, Praetors’ Voice', card: null }]);
        DeckConfig.updateDeck({ commanderName: null });
        assert.deepEqual(DeckConfig.getCommanders(), []);
        DeckConfig.updateDeck({ commanderCard: DOCTOR });
        assert.deepEqual(DeckConfig.getCommanders(), [], 'a card alone names no commander');
    });

    it('clears every commander when the deck becomes counts only', () => {
        DeckConfig.updateDeck({ commanders: PAIR });
        DeckConfig.updateField('lands', 30);
        assert.deepEqual(DeckConfig.getCommanderNames(), []);
        assert.equal(DeckConfig.getDeckConfig().importSource, 'manual');
        DeckConfig.updateField('deckName', 'ignored');
        DeckConfig.updateField('actualCardCount', 61);
        assert.equal(DeckConfig.getDeckSize(true), 61);
    });
});

describe('deckConfig — derived card details', () => {
    beforeEach(() => DeckConfig.resetForTests());

    it('builds one entry per nonland copy from the card records', () => {
        const details = DeckConfig.cardDetailsFor({
            Forest: { name: 'Forest', count: 30, category: 'lands', allCategories: ['lands'] },
            Wurm: { name: 'Craw Wurm', count: 2, cmc: 6, category: 'creatures', allCategories: ['creatures'], power: '6', toughness: '4' },
            Tarmo: { name: 'Tarmogoyf', count: 1, cmc: 2, category: 'creatures', allCategories: ['creatures'], power: '*', toughness: '1+*' },
            Golem: { name: 'Su-Chi', count: 1, cmc: 4.5, category: 'creatures', allCategories: ['creatures', 'artifacts'], power: '4', toughness: '4' },
            Ring: { name: 'Sol Ring', count: 1, cmc: 1, category: 'artifacts', power: '9' }
        });
        assert.equal(details.length, 5);
        const wurm = details.find(d => d.name === 'Craw Wurm');
        assert.deepEqual([wurm.totalPT, wurm.isPower5Plus, wurm.type], [10, true, 'creatures']);
        assert.equal(details.find(d => d.name === 'Tarmogoyf').totalPT, null, 'variable power has no fixed total');
        const golem = details.find(d => d.name === 'Su-Chi');
        assert.deepEqual([golem.cmc, golem.allTypes], [4, ['creatures', 'artifacts']]);
        assert.equal(details.find(d => d.name === 'Sol Ring').isPower5Plus, false, 'only creatures have power');
        assert.deepEqual(DeckConfig.cardDetailsFor(undefined), []);
    });

    it('serves the same array until the cards change (pages cache on it)', () => {
        const a = DeckConfig.getDeckConfig().cardDetails;
        assert.ok(a.length > 0);
        assert.equal(DeckConfig.getImportedCardData().cardDetails, a);
        assert.equal(DeckConfig.getDeckConfig().cardDetails, a);
        DeckConfig.updateDeck({ cardsByName: { X: { name: 'X', count: 2, cmc: 1, category: 'artifacts' } }, cardDetails: [{ name: 'ignored' }] });
        const b = DeckConfig.getDeckConfig().cardDetails;
        assert.notEqual(b, a);
        assert.deepEqual(b.map(d => d.name), ['X', 'X'], 'cardDetails is derived, never taken from callers');
    });

    it('reads a saved deck’s own cardDetails (decks saved before it was derived)', () => {
        const stored = [{ name: 'Old Entry', cmc: 2, type: 'creatures', allTypes: ['creatures'] }];
        DeckConfig.loadSnapshot(snapshot({ cardDetails: stored }), { persistActive: false });
        assert.equal(DeckConfig.getDeckConfig().cardDetails, stored);
        DeckConfig.updateDeck({ cardsByName: { Y: { name: 'Y', count: 1, cmc: 3, category: 'enchantments' } } });
        assert.deepEqual(DeckConfig.getDeckConfig().cardDetails.map(d => d.name), ['Y'], 'until the cards change');
    });

    it('drops the unused legacy fields', () => {
        const config = DeckConfig.getDeckConfig();
        for (const gone of ['cmc0', 'cmc6', 'power5PlusCMC3', 'power5PlusCMC10', 'creaturesPower5Plus']) {
            assert.equal(gone in config, false, gone);
        }
    });
});

function memoryStorage() {
    const data = new Map();
    return {
        getItem: k => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: k => data.delete(k)
    };
}

describe('deckConfig — saved decks', () => {
    let original;
    beforeEach(() => {
        original = globalThis.window.localStorage;
        globalThis.window.localStorage = memoryStorage();
        DeckConfig.resetForTests();
    });
    afterEach(() => { globalThis.window.localStorage = original; });

    it('round-trips a two-commander deck through the library and restores it at startup', async () => {
        const { getDeck, saveDeck, getActiveDeckId } = await import('../../js/utils/deckLibrary.js');
        const id = saveDeck({ deckName: 'Doctor Pair', importSource: 'paste', lands: 37, actualCardCount: 98, cardsByName: { Forest: { name: 'Forest', count: 98, category: 'lands' } }, commanders: PAIR });
        assert.equal(getDeck(id).commanders.length, 2);
        assert.ok(DeckConfig.loadSavedDeck(id));
        assert.equal(getActiveDeckId(), id);
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor', 'Susan Foreman']);
        assert.equal(DeckConfig.getDeckTotal().total, 100);

        DeckConfig.renameDeck('  Renamed pair  ');
        assert.equal(getDeck(id).name, 'Renamed pair');
        assert.equal(DeckConfig.renameDeck('   '), false);
        DeckConfig.setFormatPreference('limited');
        assert.equal(getDeck(id).format, 'limited');
        assert.equal(DeckConfig.getFormat().key, 'limited');
        DeckConfig.setFormatPreference(null);
        assert.equal(DeckConfig.getDeckConfig().format, 'auto');

        DeckConfig.resetForTests();
        DeckConfig.initDeckConfig();
        assert.equal(DeckConfig.getDeckConfig().deckName, 'Renamed pair', 'restored at startup');
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor', 'Susan Foreman']);

        DeckConfig.loadExampleDeck();
        assert.equal(getActiveDeckId(), null);
        assert.equal(DeckConfig.loadSavedDeck('list:missing'), false);
        assert.equal(DeckConfig.loadSnapshot(null), false);
    });

    it('forgets an active id whose deck is gone, and restores nothing when asked not to', async () => {
        const { setActiveDeckId, getActiveDeckId } = await import('../../js/utils/deckLibrary.js');
        setActiveDeckId('list:gone');
        DeckConfig.initDeckConfig({ restore: false });
        assert.equal(getActiveDeckId(), 'list:gone');
        DeckConfig.initDeckConfig();
        assert.equal(getActiveDeckId(), null);
    });

    it('saves a hand-counted deck once the typing stops', async () => {
        const { getActiveDeckId, getDeck } = await import('../../js/utils/deckLibrary.js');
        DeckConfig.updateField('lands', 17);
        DeckConfig.updateField('creatures', 23);
        await new Promise(r => setTimeout(r, 700));
        const id = getActiveDeckId();
        assert.ok(id);
        assert.equal(getDeck(id).name, 'Custom counts');
        assert.equal(DeckConfig.getDeckConfig().deckId, id);
    });
});

describe('deckConfig — imports', () => {
    const realFetch = globalThis.fetch;
    let statuses;
    DeckConfig.onImportStatus(s => statuses?.push(s));
    const json = body => ({ ok: true, status: 200, json: async () => body });
    const scryfall = async (url, init = {}) => {
        const { identifiers = [] } = JSON.parse(init.body ?? '{}');
        const data = identifiers.map(({ name }) => ({
            name, cmc: name === 'Forest' ? 0 : 2, mana_cost: name === 'Forest' ? '' : '{1}{G}',
            type_line: name === 'Forest' ? 'Basic Land — Forest' : 'Creature — Elf', oracle_text: '', color_identity: ['G']
        }));
        return json({ data, not_found: [] });
    };

    beforeEach(() => {
        DeckConfig.resetForTests();
        statuses = [];
    });
    afterEach(() => { globalThis.fetch = realFetch; });

    it('imports a pasted list with two commanders and names it for both', async () => {
        globalThis.fetch = scryfall;
        const imports = [];
        DeckConfig.onDeckImport(c => imports.push(c));
        await DeckConfig.importDeckText('Commander\n1 Tymna the Weaver\n1 Kraum, Ludevic’s Opus\nDeck\n38 Forest\n60 Llanowar Elves');
        const config = DeckConfig.getDeckConfig();
        assert.deepEqual(DeckConfig.getCommanderNames(), ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
        assert.equal(config.deckName, 'Tymna the Weaver + Kraum, Ludevic’s Opus');
        assert.equal(config.importSource, 'paste');
        assert.equal(DeckConfig.getDeckTotal().total, 100);
        assert.equal(imports.length, 1, 'onDeckImport fires once, on the real import');
        assert.equal(statuses.at(-1).state, 'success');
        assert.equal(statuses.at(-1).message, 'Imported 100 cards.');
        assert.ok(statuses.every(s => s.kind === 'list'));
    });

    it('imports Moxfield and Archidekt links with every commander, and says what it left out', async () => {
        const { MOXFIELD_DECK, ARCHIDEKT_DECK, collectionResponse } = await import('../fixtures/deckSites.js');
        globalThis.fetch = async (url, init) => {
            const href = String(url);
            if (href.includes('archidekt.com%2Fapi')) return json(ARCHIDEKT_DECK);
            if (href.includes('workers.dev')) return json(MOXFIELD_DECK);
            if (href.includes('fuzzy=')) return { ok: false, status: 404, json: async () => ({}) };
            return json(collectionResponse(init?.body));
        };
        await DeckConfig.loadDeckFromUrl('https://moxfield.com/decks/abcdefgh12');
        const config = DeckConfig.getDeckConfig();
        assert.equal(config.importSource, 'moxfield');
        assert.equal(config.importUrl, 'https://moxfield.com/decks/abcdefgh12');
        assert.equal(config.deckName, 'Tymna Kraum Blitz');
        assert.deepEqual(DeckConfig.getCommanderNames(), ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
        assert.equal(statuses.at(-1).message, 'Imported Tymna Kraum Blitz — 35 cards.');
        assert.deepEqual(statuses.at(-1).warnings, ['Sideboard ignored (2 cards)']);

        await DeckConfig.loadDeckFromUrl('https://archidekt.com/decks/1234567');
        assert.equal(DeckConfig.getDeckConfig().importSource, 'archidekt');
        assert.deepEqual(DeckConfig.getCommanderNames(), ['The Ninth Doctor', 'Clara Oswald']);

        await DeckConfig.importDeckText('1 Sol Ring\n2 Mystery Card\n101 Island\n30 Island');
        assert.deepEqual(statuses.at(-1).warnings, ['2 cards not found: 2× Mystery Card', '1 line skipped (not a card)']);
    });

    it('a pasted list never inherits the previous deck’s commanders', async () => {
        globalThis.fetch = scryfall;
        DeckConfig.updateDeck({ commanders: PAIR });
        await DeckConfig.importDeckText('24 Forest\n36 Llanowar Elves');
        assert.deepEqual(DeckConfig.getCommanderNames(), []);
        assert.equal(DeckConfig.getFormat().key, 'constructed');
    });

    it('a pasted list replaces a link import that is still running', async () => {
        let releaseLink;
        globalThis.fetch = async (url, init) => {
            if (String(url).includes('workers.dev')) {
                // The proxy hangs until cancelled.
                return new Promise((_resolve, reject) => {
                    releaseLink = reject;
                    init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
                });
            }
            return scryfall(url, init);
        };
        const link = DeckConfig.loadDeckFromUrl('https://moxfield.com/decks/abcdefgh12');
        const keepAlive = setTimeout(() => {}, 5000);
        await new Promise(r => setTimeout(r, 10));
        assert.ok(DeckConfig.isImporting());
        const list = DeckConfig.importDeckText('20 Forest\n20 Llanowar Elves');
        await assert.rejects(link, err => err.kind === 'aborted', 'the link import was cancelled');
        const result = await list;
        clearTimeout(keepAlive);
        releaseLink?.(new Error('late'));
        assert.equal(result.actualCardCount, 40, 'the list’s own result, not the link’s');
        assert.equal(DeckConfig.getDeckSize(true), 40);
        assert.equal(DeckConfig.isImporting(), false);
        assert.ok(!statuses.some(s => s.state === 'error'), 'a superseded import reports nothing');
    });

    it('joins a repeated request for the same import (a double click)', async () => {
        let requests = 0;
        globalThis.fetch = (url, init) => { requests++; return scryfall(url, init); };
        const imports = [];
        DeckConfig.onDeckImport(c => imports.push(c));
        const list = '20 Forest\n21 Wood Elves'; // Wood Elves: not cached by an earlier test
        const [a, b] = await Promise.all([DeckConfig.importDeckText(list), DeckConfig.importDeckText(list)]);
        assert.equal(a, b);
        assert.equal(requests, 1);
        assert.equal(imports.length, 1);
    });

    it('reports failures in plain words', async () => {
        globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
        await assert.rejects(DeckConfig.loadDeckFromUrl('https://moxfield.com/decks/abcdefgh12'));
        assert.equal(statuses.at(-1).state, 'error');
        assert.match(statuses.at(-1).message, /deck site isn’t answering right now \(error 502\)/);
        assert.equal(statuses.at(-1).kind, 'link');

        await assert.rejects(DeckConfig.loadDeckFromUrl('   '), /Invalid URL/);
        await assert.rejects(DeckConfig.importDeckText(''), /Empty decklist/);
        assert.match(statuses.at(-1).message, /Paste a decklist first/);
        await assert.rejects(DeckConfig.loadDeckFromUrl('https://example.com/x'));
        assert.match(statuses.at(-1).message, /isn’t a Moxfield or Archidekt deck/);
    });
});
