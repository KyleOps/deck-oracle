/**
 * Shared opponent state: seats, import lifecycle, renumbering.
 * Imports of pasted lists go through a stubbed Scryfall `fetch`; nothing here
 * touches the network.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as OpponentState from '../../js/utils/opponentState.js';

const CARDS = {
    'Sol Ring': { name: 'Sol Ring', type_line: 'Artifact', cmc: 1 },
    Counterspell: { name: 'Counterspell', type_line: 'Instant', cmc: 2 },
    Island: { name: 'Island', type_line: 'Basic Land — Island', cmc: 0 },
    Mountain: { name: 'Mountain', type_line: 'Basic Land — Mountain', cmc: 0 },
    'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 }
};

let realFetch;
before(() => {
    realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
        const { identifiers = [] } = JSON.parse(opts?.body ?? '{}');
        const data = identifiers.map(({ name }) => CARDS[name]).filter(Boolean)
            .map(c => ({ ...c, mana_cost: '', oracle_text: '', colors: [], color_identity: [], legalities: {} }));
        return { ok: true, json: async () => ({ data, not_found: [] }) };
    };
});
after(() => { globalThis.fetch = realFetch; });

describe('opponentState — pure helpers', () => {
    it('tells deck links from pasted lists', () => {
        assert.ok(OpponentState.looksLikeDeckUrl('https://moxfield.com/decks/abc123'));
        assert.ok(OpponentState.looksLikeDeckUrl('  www.archidekt.com/decks/42/foo  '));
        assert.ok(OpponentState.looksLikeDeckUrl('https://example.com/deck'));
        assert.ok(!OpponentState.looksLikeDeckUrl('1 Sol Ring\n1 Island'));
        assert.ok(!OpponentState.looksLikeDeckUrl('1 Sol Ring'));
        assert.ok(!OpponentState.looksLikeDeckUrl(''));
    });

    it('describes a list by its front faces', () => {
        const d = OpponentState.describeOpponentDeck({
            cardsByName: {
                Island: { type_line: 'Basic Land — Island', cmc: 0, count: 30 },
                Opt: { type_line: 'Instant', cmc: 1, count: 4 },
                Call: { type_line: 'Sorcery // Land', cmc: 7, count: 1 }
            }
        });
        assert.deepStrictEqual({ ...d, avgSpellMv: Number(d.avgSpellMv.toFixed(2)) }, { cards: 35, lands: 30, spells: 5, avgSpellMv: 2.2 });
    });

    it('seat colours are tokens and cycle', () => {
        assert.match(OpponentState.seatColor(0), /^var\(--series-\d\)$/);
        assert.strictEqual(OpponentState.seatColor(3), OpponentState.seatColor(0));
    });
});

describe('opponentState — seats and imports', () => {
    let notifications = 0;
    OpponentState.onOpponentChange(() => { notifications++; });

    it('starts with one empty seat', () => {
        assert.deepStrictEqual(OpponentState.getActiveOpponents(), ['opponent1']);
        assert.strictEqual(OpponentState.hasAnyDeckData(), false);
        assert.strictEqual(OpponentState.isImporting(), false);
    });

    it('imports a pasted list, reporting loading then done', async () => {
        const before = notifications;
        const job = OpponentState.importOpponentDeck('opponent1', '1 Sol Ring\n2 Counterspell\n7 Island', false);
        assert.strictEqual(OpponentState.getImportStatus('opponent1')?.state, 'loading');
        assert.ok(OpponentState.isImporting());
        await job;
        assert.strictEqual(OpponentState.getImportStatus('opponent1'), null);
        assert.ok(notifications >= before + 2, 'notified on start and on finish');
        const data = OpponentState.getOpponentData('opponent1');
        assert.strictEqual(data.deckSize, 10);
        assert.strictEqual(data.importUrl, null);
        assert.strictEqual(data.name, 'Opponent 1');
        assert.deepStrictEqual(OpponentState.getOpponentsWithData(), ['opponent1']);
    });

    it('a failed import marks the seat with a readable error and rethrows', async () => {
        await assert.rejects(OpponentState.importOpponentDeck('opponent1', '   ', false));
        const status = OpponentState.getImportStatus('opponent1');
        assert.strictEqual(status.state, 'error');
        assert.match(status.message, /No cards found/);
        assert.strictEqual(OpponentState.getOpponentData('opponent1').deckSize, 10, 'the previous deck survives a failed replace');
    });

    it('importing into seat 3 activates seats 1–3 in order (share links)', async () => {
        await OpponentState.importOpponentDeck('opponent3', '1 Lightning Bolt\n9 Mountain', false);
        assert.deepStrictEqual(OpponentState.getActiveOpponents(), ['opponent1', 'opponent2', 'opponent3']);
        assert.strictEqual(OpponentState.addOpponent(), null, 'no fourth seat');
    });

    it('removing a seat renumbers the ones after it', () => {
        OpponentState.removeOpponent('opponent2');
        assert.deepStrictEqual(OpponentState.getActiveOpponents(), ['opponent1', 'opponent2']);
        const moved = OpponentState.getOpponentData('opponent2');
        assert.strictEqual(moved.deckSize, 10);
        assert.strictEqual(moved.name, 'Opponent 2', 'an unnamed list takes its new seat number');
        assert.strictEqual(OpponentState.getOpponentData('opponent3').deckSize, 0);
    });

    it('share links only carry imported URLs', () => {
        assert.deepStrictEqual(OpponentState.getOpponentUrls(), { opponent1: null, opponent2: null, opponent3: null });
    });

    it('clearing and removing down to one seat', () => {
        OpponentState.clearOpponentDeck('opponent2');
        assert.deepStrictEqual(OpponentState.getOpponentsWithData(), ['opponent1']);
        OpponentState.removeOpponent('opponent2');
        OpponentState.removeOpponent('opponent1');
        assert.deepStrictEqual(OpponentState.getActiveOpponents(), ['opponent1'], 'the last seat is never removed');
    });
});
