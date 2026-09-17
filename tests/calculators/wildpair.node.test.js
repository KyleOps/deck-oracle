import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    WILD_PAIR_COST,
    parsePT,
    cardTotalPT,
    isCreatureEntry,
    bucketByTotalPT,
    analyzeBucket,
    analyzeDeck,
    groupAt,
    snapToTotal,
    fitVerdict
} from '../../js/calculators/wildpair.js';

/**
 * Build a per-copy cardDetails entry for a creature.
 * @param {string} name
 * @param {number} cmc
 * @param {number|string} power
 * @param {number|string} toughness
 */
function creature(name, cmc, power, toughness) {
    const p = parsePT(power);
    const t = parsePT(toughness);
    return {
        name,
        cmc,
        type: 'creatures',
        allTypes: ['creatures'],
        power: String(power),
        toughness: String(toughness),
        totalPT: (p !== null && t !== null) ? p + t : null
    };
}

/** A non-creature card detail entry. */
function spell(name, cmc, type = 'sorceries') {
    return { name, cmc, type, allTypes: [type] };
}

/** A simulation-deck card (the `buildDeckFromCardData` shape). */
function simCard(name, cmc, types, power, toughness) {
    return { name, cmc, types, type_line: types.join(' '), power, toughness };
}

// ==================== parsePT ====================

describe('parsePT', () => {
    it('parses plain integer boxes', () => {
        assert.strictEqual(parsePT(3), 3);
        assert.strictEqual(parsePT('7'), 7);
        assert.strictEqual(parsePT('0'), 0);
    });

    it('rejects variable boxes, which have no fixed total to match on', () => {
        assert.strictEqual(parsePT('*'), null);
        assert.strictEqual(parsePT('1+*'), null);
        assert.strictEqual(parsePT('X'), null);
        assert.strictEqual(parsePT('*+1'), null);
    });

    it('returns null for missing or empty values', () => {
        assert.strictEqual(parsePT(undefined), null);
        assert.strictEqual(parsePT(null), null);
        assert.strictEqual(parsePT(''), null);
        assert.strictEqual(parsePT('   '), null);
    });

    it('handles negative toughness (e.g. -1/-1 effects printed on a card)', () => {
        assert.strictEqual(parsePT('-1'), -1);
    });
});

// ==================== cardTotalPT ====================

describe('cardTotalPT', () => {
    it('prefers the totalPT computed at import time', () => {
        assert.strictEqual(cardTotalPT({ totalPT: 9, power: '1', toughness: '1' }), 9);
    });

    it('falls back to power + toughness when totalPT is absent', () => {
        assert.strictEqual(cardTotalPT({ power: '4', toughness: '5' }), 9);
    });

    it('returns null when either box is variable or missing', () => {
        assert.strictEqual(cardTotalPT({ power: '*', toughness: '3' }), null);
        assert.strictEqual(cardTotalPT({ power: '3' }), null);
        assert.strictEqual(cardTotalPT(null), null);
    });
});

// ==================== isCreatureEntry ====================

describe('isCreatureEntry', () => {
    it('recognises every shape the app stores cards in', () => {
        assert.ok(isCreatureEntry({ allTypes: ['creatures'] }));
        assert.ok(isCreatureEntry({ allCategories: ['artifacts', 'creatures'] }));
        assert.ok(isCreatureEntry({ types: ['creature'] }));
        assert.ok(isCreatureEntry({ type: 'creatures' }));
        assert.ok(isCreatureEntry({ type_line: 'Legendary Creature — Elf Druid' }));
    });

    it('rejects non-creatures and malformed entries', () => {
        assert.ok(!isCreatureEntry({ allTypes: ['sorceries'] }));
        assert.ok(!isCreatureEntry({ type_line: 'Enchantment' }));
        assert.ok(!isCreatureEntry(null));
        assert.ok(!isCreatureEntry({}));
    });
});

// ==================== bucketByTotalPT ====================

describe('bucketByTotalPT', () => {
    it('groups creatures by total power + toughness, ignoring non-creatures', () => {
        const { groups, creatures } = bucketByTotalPT([
            creature('A', 2, 2, 2),
            creature('B', 6, 3, 1),
            creature('C', 4, 1, 3),
            spell('Ramp', 3)
        ]);
        assert.strictEqual(creatures, 3);
        assert.strictEqual(groups.length, 1);
        assert.strictEqual(groups[0].total, 4);
        assert.strictEqual(groups[0].cards.length, 3);
    });

    it('separates a 5/5 from a 5/6 but pairs it with a 3/7', () => {
        const { groups } = bucketByTotalPT([
            creature('Five Five', 5, 5, 5),
            creature('Five Six', 5, 5, 6),
            creature('Three Seven', 8, 3, 7)
        ]);
        const totals = groups.map(b => b.total);
        assert.deepStrictEqual(totals, [10, 11]);
        assert.strictEqual(groups[0].cards.length, 2);   // 5/5 + 3/7
        assert.strictEqual(groups[1].cards.length, 1);   // 5/6 alone
    });

    it('separates genuinely variable creatures from missing import data', () => {
        const res = bucketByTotalPT([
            creature('Star', 7, '*', '*'),
            { name: 'No Data', cmc: 3, type: 'creatures', allTypes: ['creatures'] }
        ]);
        assert.strictEqual(res.variable.length, 1);
        assert.strictEqual(res.missing, 1);
        assert.strictEqual(res.groups.length, 0);
        assert.strictEqual(res.creatures, 2);
    });

    it('sorts buckets by total and cards within a bucket by mana value', () => {
        const { groups } = bucketByTotalPT([
            creature('Expensive', 8, 3, 3),
            creature('Cheap', 2, 3, 3),
            creature('Other', 1, 1, 1)
        ]);
        assert.deepStrictEqual(groups.map(b => b.total), [2, 6]);
        assert.deepStrictEqual(groups[1].cards.map(c => c.name), ['Cheap', 'Expensive']);
    });

    it('handles missing or malformed input without throwing', () => {
        assert.doesNotThrow(() => bucketByTotalPT(undefined));
        assert.strictEqual(bucketByTotalPT(undefined).creatures, 0);
        assert.strictEqual(bucketByTotalPT([null, undefined]).creatures, 0);
    });
});


// ==================== analyzeBucket ====================

describe('analyzeBucket', () => {
    it('takes the widest swing in the pool: cheapest cast, dearest found', () => {
        const r = analyzeBucket({ total: 6, cards: [
            { name: 'cheap', cmc: 1 }, { name: 'mid', cmc: 4 }, { name: 'big', cmc: 9 }
        ] });
        assert.strictEqual(r.cheapest.name, 'cheap');
        assert.strictEqual(r.dearest.name, 'big');
        assert.strictEqual(r.swing, 8);
    });

    it('reports no swing when every member costs the same', () => {
        const r = analyzeBucket({ total: 6, cards: [
            { name: 'a', cmc: 4 }, { name: 'b', cmc: 4 }, { name: 'c', cmc: 4 }
        ] });
        assert.strictEqual(r.swing, 0);
    });

    it('does not strand anything — a third creature is a third live member', () => {
        const r = analyzeBucket({ total: 6, cards: [
            { name: 'a', cmc: 1 }, { name: 'b', cmc: 2 }, { name: 'c', cmc: 7 }
        ] });
        assert.strictEqual(r.count, 3);
        assert.strictEqual(r.live, true);
    });

    it('sums the best body each member could find, for the deck average', () => {
        // Two cards find the 9; the 9 itself finds the 5.
        const r = analyzeBucket({ total: 6, cards: [
            { name: 'a', cmc: 2 }, { name: 'b', cmc: 5 }, { name: 'c', cmc: 9 }
        ] });
        assert.strictEqual(r.fetchSum, 9 + 9 + 5);
        assert.ok(Math.abs(r.avgFetch - 23 / 3) < 1e-9);
    });

    it('marks a lone creature as not live, with nothing to find', () => {
        const r = analyzeBucket({ total: 4, cards: [{ name: 'only', cmc: 3 }] });
        assert.strictEqual(r.live, false);
        assert.strictEqual(r.cheapest, null);
        assert.strictEqual(r.dearest, null);
        assert.strictEqual(r.swing, 0);
        assert.strictEqual(r.fetchSum, 0);
        assert.strictEqual(r.bestLine, null);
    });

    it('exposes the swing as a direction, not a role assignment', () => {
        const r = analyzeBucket({ total: 6, cards: [
            { name: 'cheap', cmc: 1 }, { name: 'big', cmc: 9 }
        ] });
        assert.strictEqual(r.bestLine.cast.name, 'cheap');
        assert.strictEqual(r.bestLine.fetched.name, 'big');
        assert.strictEqual(r.bestLine.leverage, 8);
        // Both cards remain plain members of the pool.
        assert.deepStrictEqual(r.cards.map(c => c.name), ['cheap', 'big']);
    });

    it('exposes the group total as the sweep-table row key', () => {
        assert.strictEqual(analyzeBucket({ total: 12, cards: [] }).x, 12);
    });

    it('handles malformed groups without throwing', () => {
        assert.doesNotThrow(() => analyzeBucket({}));
        assert.strictEqual(analyzeBucket({}).count, 0);
    });
});

// ==================== CHEAT RANGE ====================

describe('analyzeBucket — cheat range', () => {
    it('spans the cheapest and dearest body the group can put onto the battlefield', () => {
        const r = analyzeBucket({ total: 6, cards: [
            { name: 'a', cmc: 2 }, { name: 'b', cmc: 5 }, { name: 'c', cmc: 8 }
        ] });
        assert.strictEqual(r.cheatMin, 2);
        assert.strictEqual(r.cheatMax, 8);
        assert.ok(Math.abs(r.cheatAvg - 5) < 1e-9);
    });

    it('collapses to a single value when every card in the group costs the same', () => {
        const r = analyzeBucket({ total: 6, cards: [{ name: 'a', cmc: 4 }, { name: 'b', cmc: 4 }] });
        assert.strictEqual(r.cheatMin, 4);
        assert.strictEqual(r.cheatMax, 4);
        assert.strictEqual(r.swing, 0);
    });

    it('reports a zeroed range for a total nothing else shares', () => {
        const r = analyzeBucket({ total: 6, cards: [{ name: 'only', cmc: 7 }] });
        assert.strictEqual(r.cheatMin, 0);
        assert.strictEqual(r.cheatMax, 0);
        assert.strictEqual(r.cheatAvg, 0);
    });
});

// ==================== analyzeDeck ====================

describe('analyzeDeck', () => {
    const deck = [
        // total 6 — four creatures, all live
        creature('Bear', 2, 3, 3),
        creature('Elk', 3, 4, 2),
        creature('Wurm', 7, 3, 3),
        creature('Titan', 9, 5, 1),
        // total 10 — three creatures, all live
        creature('Drake', 4, 5, 5),
        creature('Serpent', 6, 6, 4),
        creature('Hydra', 8, 5, 5),
        // total 2 — alone
        creature('Mouse', 1, 1, 1),
        spell('Wrath', 4)
    ];

    it('counts a creature as live whenever anything shares its total', () => {
        const a = analyzeDeck(deck);
        assert.strictEqual(a.creatures, 8);
        assert.strictEqual(a.liveCreatures, 7);
        assert.strictEqual(a.deadCreatures, 1);
        assert.ok(Math.abs(a.liveRate - 7 / 8) < 1e-9);
    });

    it('does not count an odd creature in a group as dead', () => {
        // Total 10 has three creatures; every one of them can still find another,
        // so none of them is stranded by being the odd one out.
        const a = analyzeDeck(deck);
        const g = groupAt(a, 10);
        assert.strictEqual(g.count, 3);
        assert.strictEqual(g.live, true);
        assert.strictEqual(a.deadRows.includes(g), false);
    });

    it('averages the best body each live creature can find', () => {
        const a = analyzeDeck(deck);
        // total 6: Bear/Elk/Wurm find Titan (9), Titan finds Wurm (7) -> 34
        // total 10: Drake/Serpent find Hydra (8), Hydra finds Serpent (6) -> 22
        assert.ok(Math.abs(a.avgCheat - (34 + 22) / 7) < 1e-9);
    });

    it('reports the biggest body available anywhere in the deck', () => {
        assert.strictEqual(analyzeDeck(deck).biggestFetch, 9);
    });

    it('reports the widest swing available anywhere in the deck', () => {
        // total 6 spans MV 2 to 9; total 10 spans 4 to 8.
        assert.strictEqual(analyzeDeck(deck).biggestSwing, 7);
    });

    it('gives one best line per matched total, ranked by swing', () => {
        const a = analyzeDeck(deck);
        assert.strictEqual(a.bestLines.length, 2);
        assert.strictEqual(a.bestLines[0].cast.name, 'Bear');
        assert.strictEqual(a.bestLines[0].fetched.name, 'Titan');
        assert.strictEqual(a.bestLines[0].leverage, 7);
    });

    it('picks the total with the most creatures as the deck engine', () => {
        assert.strictEqual(analyzeDeck(deck).bestBucket.total, 6);
    });

    it('splits rows into matched totals and singletons for the two panels', () => {
        const a = analyzeDeck(deck);
        assert.deepStrictEqual(a.liveRows.map(r => r.total), [6, 10]);
        assert.deepStrictEqual(a.deadRows.map(r => r.total), [2]);
    });

    it('reports nothing live when every total is unique', () => {
        const a = analyzeDeck([
            creature('A', 1, 1, 1), creature('B', 2, 2, 2), creature('C', 3, 3, 3)
        ]);
        assert.strictEqual(a.liveBuckets, 0);
        assert.strictEqual(a.liveRate, 0);
        assert.strictEqual(a.avgCheat, 0);
        assert.strictEqual(a.deadCreatures, 3);
    });

    it('flags a creature-less or empty deck as having no data', () => {
        assert.strictEqual(analyzeDeck([]).hasData, false);
        assert.strictEqual(analyzeDeck([spell('Bolt', 1)]).hasData, false);
        assert.doesNotThrow(() => analyzeDeck(undefined));
    });
});

// ==================== groupAt / snapToTotal ====================

describe('groupAt', () => {
    const analysis = analyzeDeck([
        creature('Bear', 2, 2, 2), creature('Elk', 6, 3, 1), creature('Mouse', 1, 1, 1)
    ]);

    it('finds the group at a total the deck has', () => {
        assert.strictEqual(groupAt(analysis, 4).count, 2);
    });

    it('returns null for a total the deck does not have', () => {
        assert.strictEqual(groupAt(analysis, 7), null);
    });

    it('handles a missing analysis without throwing', () => {
        assert.strictEqual(groupAt(null, 4), null);
        assert.strictEqual(groupAt({}, 4), null);
    });
});

describe('snapToTotal', () => {
    const analysis = analyzeDeck([
        creature('Mouse', 1, 1, 1),      // total 2
        creature('Bear', 2, 2, 2),       // total 4
        creature('Elk', 6, 3, 1),        // total 4
        creature('Titan', 9, 10, 10)     // total 20
    ]);

    it('leaves a total the deck actually has alone', () => {
        assert.strictEqual(snapToTotal(analysis, 4), 4);
        assert.strictEqual(snapToTotal(analysis, 20), 20);
    });

    it('snaps a total the deck lacks to the nearest one it has', () => {
        assert.strictEqual(snapToTotal(analysis, 5), 4);
        assert.strictEqual(snapToTotal(analysis, 15), 20);
        assert.strictEqual(snapToTotal(analysis, 1), 2);
        assert.strictEqual(snapToTotal(analysis, 99), 20);
    });

    it('falls back to the first total for a missing or invalid value', () => {
        assert.strictEqual(snapToTotal(analysis, NaN), 2);
        assert.strictEqual(snapToTotal(analysis, undefined), 2);
    });

    it('returns null when the deck has no creatures to step through', () => {
        assert.strictEqual(snapToTotal(analyzeDeck([]), 4), null);
        assert.strictEqual(snapToTotal(null, 4), null);
    });
});

// ==================== SELECTOR DATA ====================

describe('analyzeDeck — selector data', () => {
    it('lists the deck totals in order, so the slider can step through them', () => {
        const a = analyzeDeck([
            creature('Huge', 9, 10, 10), creature('Small', 1, 1, 1), creature('Mid', 3, 3, 3)
        ]);
        assert.deepStrictEqual(a.totals, [2, 6, 20]);
        assert.strictEqual(a.minTotal, 2);
        assert.strictEqual(a.maxTotal, 20);
    });

    it('reports an empty total list for a deck with no usable creatures', () => {
        const a = analyzeDeck([spell('Bolt', 1)]);
        assert.deepStrictEqual(a.totals, []);
        assert.strictEqual(a.minTotal, null);
    });
});

// ==================== fitVerdict ====================

describe('fitVerdict', () => {
    it('reports NO DATA before a decklist is imported', () => {
        assert.strictEqual(fitVerdict(analyzeDeck([])).label, 'NO DATA');
    });

    it('reports NO MATCHES when nothing shares a total', () => {
        const v = fitVerdict(analyzeDeck([creature('A', 1, 1, 1), creature('B', 2, 2, 2)]));
        assert.strictEqual(v.label, 'NO MATCHES');
        assert.strictEqual(v.color, 'var(--tx-bad)');
    });

    it('rates a deck of matched one-drops poorly — live everywhere, cheats nothing', () => {
        // Reach alone must not carry a verdict: this deck connects on every cast
        // and puts a single mana onto the battlefield, which is not worth {6}.
        const cheap = [];
        for (let i = 0; i < 6; i++) cheap.push(creature(`c${i}`, 1, 1, 1));
        const a = analyzeDeck(cheap);
        assert.strictEqual(a.liveRate, 1);
        assert.strictEqual(fitVerdict(a).tier, 'poor');
    });

    it('rates a narrow deck with one huge matched body as fair, not poor', () => {
        const deck = [creature('Fatty A', 9, 6, 6), creature('Fatty B', 8, 5, 7)];
        for (let i = 0; i < 12; i++) deck.push(creature(`Lonely ${i}`, 2, i + 1, 1));
        const v = fitVerdict(analyzeDeck(deck));
        assert.strictEqual(v.tier, 'fair');
    });

    it('rates a deck of matched fatties as an excellent fit', () => {
        const deck = [];
        for (let i = 0; i < 5; i++) {
            deck.push(creature(`cheap${i}`, 4, 3, 3));
            deck.push(creature(`big${i}`, 8, 4, 2));
        }
        assert.strictEqual(fitVerdict(analyzeDeck(deck)).tier, 'excellent');
    });

    it('never throws on a missing analysis', () => {
        assert.doesNotThrow(() => fitVerdict(null));
        assert.doesNotThrow(() => fitVerdict({}));
    });
});
