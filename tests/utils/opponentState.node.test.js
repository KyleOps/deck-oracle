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
    'Lightning Bolt': { name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
    'Tymna the Weaver': { name: 'Tymna the Weaver', type_line: 'Legendary Creature — Human Cleric', cmc: 3 },
    'Kraum, Ludevic’s Opus': { name: 'Kraum, Ludevic’s Opus', type_line: 'Legendary Creature — Zombie Horror', cmc: 5 }
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
        assert.deepStrictEqual(OpponentState.removeOpponent('opponent2'), { opponent1: 'opponent1' }, 'reports where each seat went');
        assert.strictEqual(OpponentState.removeOpponent('opponent1'), null);
        assert.deepStrictEqual(OpponentState.getActiveOpponents(), ['opponent1'], 'the last seat is never removed');
    });
});

describe('opponentState — names, progress and failures', () => {
    it('names a pasted Commander list for its commanders', async () => {
        const result = await OpponentState.importOpponentDeck('opponent1', 'Commander\n1 Tymna the Weaver\n1 Kraum, Ludevic’s Opus\nDeck\n1 Sol Ring\n7 Island', false);
        assert.deepStrictEqual(result.commanders.map(c => c.name), ['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
        const data = OpponentState.getOpponentData('opponent1');
        assert.strictEqual(data.name, 'Tymna the Weaver + Kraum, Ludevic’s Opus');
        assert.strictEqual(data.deckSize, 8, 'the library: commanders start in the command zone');
        assert.strictEqual('cardDetails' in data, false, 'no derived data on seats');
    });

    it('reports progress to its own listeners, not the page listeners', async () => {
        const seen = [];
        OpponentState.onImportProgress(key => seen.push(key));
        let thrown = false;
        OpponentState.onImportProgress(() => {
            if (thrown) return;
            thrown = true;
            throw new Error('a broken listener (expected in this test)');
        });
        await OpponentState.importOpponentDeck('opponent1', '1 Sol Ring\n9 Island', false, () => {});
        assert.ok(seen.length > 0 && seen.every(k => k === 'opponent1'));
    });

    it('translates network failures and lets an edit clear them', async () => {
        const saved = globalThis.fetch;
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        try {
            await assert.rejects(OpponentState.importOpponentDeck('opponent2', '1 Brainstorm', false));
        } finally {
            globalThis.fetch = saved;
        }
        assert.strictEqual(OpponentState.getImportStatus('opponent2').message, 'Couldn’t reach Scryfall. Check your connection.');
        OpponentState.clearImportError('opponent2');
        assert.strictEqual(OpponentState.getImportStatus('opponent2'), null);
        OpponentState.clearImportError('opponent2');
    });

    it('a newer import into a seat cancels the older one', async () => {
        const saved = globalThis.fetch;
        let first = true;
        globalThis.fetch = (url, init) => {
            if (first) {
                first = false;
                return new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
            }
            return saved(url, init);
        };
        try {
            // Names no earlier test looked up, so this one really goes to the network.
            const older = OpponentState.importOpponentDeck('opponent1', '1 Ponder\n9 Swamp', false);
            await new Promise(r => setTimeout(r, 5));
            const newer = OpponentState.importOpponentDeck('opponent1', '1 Lightning Bolt\n9 Mountain', false);
            await assert.rejects(older, err => err.kind === 'aborted');
            await newer;
        } finally {
            globalThis.fetch = saved;
        }
        assert.ok(OpponentState.getOpponentData('opponent1').cardsByName['Lightning Bolt']);
        assert.strictEqual(OpponentState.getImportStatus('opponent1'), null);
    });

    it('rejects unknown seats', async () => {
        await assert.rejects(OpponentState.importOpponentDeck('opponent9', '1 Sol Ring', false), /Unknown opponent seat/);
        assert.strictEqual(OpponentState.getOpponentData('nope'), null);
        assert.strictEqual(OpponentState.defaultName('opponent2'), 'Opponent 2');
    });

    it('queues a focus request until the bar can take it', () => {
        let focused = 0;
        OpponentState.focusImportField();
        OpponentState.setFocusImportHandler(() => { focused++; });
        assert.strictEqual(focused, 1, 'the early request runs once the bar registers');
        OpponentState.focusImportField();
        assert.strictEqual(focused, 2);
        OpponentState.setFocusImportHandler(null);
    });
});
