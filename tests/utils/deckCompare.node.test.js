import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareDecks, diffCards, summarizeComparison, toDeck, METRICS } from '../../js/utils/deckCompare.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';

const land = (name, count, extra = {}) => ({ name, count, cmc: 0, category: 'lands', type_line: `Basic Land — ${name}`, ...extra });
const spell = (name, count, cmc, extra = {}) => ({ name, count, cmc, category: 'creatures', type_line: 'Creature', mana_cost: `{${Math.max(0, cmc - 1)}}{G}`, color_identity: ['G'], ...extra });

function sixty(lands) {
    return {
        name: `${lands} lands`,
        cardsByName: {
            Forest: land('Forest', lands),
            Bear: spell('Grizzly Bears', 60 - lands - 8, 2),
            Big: spell('Craw Wurm', 8, 6)
        }
    };
}

describe('diffCards', () => {
    it('splits cards into only-A, only-B, changed and shared', () => {
        const diff = diffCards(
            { a: { name: 'Sol Ring', count: 1 }, b: { name: 'Forest', count: 30 }, c: { name: 'Cut', count: 1 } },
            { a: { name: 'Sol Ring', count: 1 }, b: { name: 'Forest', count: 28 }, d: { name: 'New', count: 2 } }
        );
        assert.deepEqual(diff.onlyA, [{ name: 'Cut', count: 1 }]);
        assert.deepEqual(diff.onlyB, [{ name: 'New', count: 2 }]);
        assert.deepEqual(diff.changed, [{ name: 'Forest', a: 30, b: 28 }]);
        assert.equal(diff.shared, 1);
    });

    it('ignores zero-count rows', () => {
        const diff = diffCards({ a: { name: 'X', count: 0 } }, {});
        assert.deepEqual(diff.onlyA, []);
    });
});

describe('compareDecks', () => {
    it('finds the deck with more lands keeps more land-light hands and hits drops more often', () => {
        const result = compareDecks(sixty(18), sixty(25));
        const keep = result.metrics.find(m => m.key === 'drop3');
        assert.equal(keep.winner, 'B');
        assert.ok(keep.b > keep.a);
        assert.equal(result.metrics.find(m => m.key === 'cards').winner, null, 'neutral metrics are never judged');
        assert.equal(result.sameFormat, true);
        assert.equal(result.a.format.key, 'constructed');
    });

    it('reports identical decks as identical', () => {
        const result = compareDecks(sixty(24), sixty(24));
        assert.ok(result.metrics.every(m => m.winner === null));
        const summary = summarizeComparison(result);
        assert.match(summary.html, /almost identically/);
        assert.equal(summary.tone, 'flat');
    });

    it('accepts library snapshots and DeckConfig objects alike', () => {
        const snap = toDeck({ name: 'Snap', counts: { lands: 37 }, cardsByName: DEFAULT_DECK_DATA.cardsByName, actualCardCount: 99, commanderName: 'The Sixth Doctor' });
        assert.equal(snap.lands, 37);
        const result = compareDecks(snap, DEFAULT_DECK_DATA);
        assert.equal(result.a.format.key, 'commander');
        assert.equal(result.diff.onlyA.length + result.diff.onlyB.length + result.diff.changed.length, 0);
    });

    it('summarises the biggest differences in words', () => {
        const summary = summarizeComparison(compareDecks(sixty(18), sixty(25)), { nameA: 'Old', nameB: 'New' });
        assert.match(summary.html, /<strong>New<\/strong>/);
        assert.match(summary.html, /\d+% vs \d+%/);
        assert.match(summary.html, /differ by 2 cards/);
    });

    it('defines a label and direction for every metric', () => {
        METRICS.forEach(m => {
            assert.ok(m.label);
            assert.ok([null, 'up', 'down', 'closer'].includes(m.better));
        });
    });
});
