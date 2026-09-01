import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    DISCOVER_N,
    partitionLibrary,
    expectedCardsDug,
    expectedHitMV,
    hitMVDistribution,
    analyzeTrigger,
    projectTurns,
    paybackTurn,
    fitVerdict,
    CHIMIL_COST,
    PROJECTION_TURNS,
    SMALL_HIT_MV,
    simulateGame,
    summariseGames,
    cheatedDistribution,
    AUTO_SIM_GAMES
} from '../../js/calculators/chimil.js';

/** Build a per-copy cardDetails array from [cmc, count] pairs. */
function nonlands(pairs) {
    const out = [];
    for (const [cmc, count] of pairs) {
        for (let i = 0; i < count; i++) out.push({ name: `MV${cmc}-${i}`, cmc, type: 'creatures' });
    }
    return out;
}

describe('partitionLibrary', () => {
    it('splits nonlands into eligible hits and passed-over misses at MV 5', () => {
        const p = partitionLibrary(nonlands([[1, 4], [5, 3], [6, 2], [9, 1]]), 36);
        assert.strictEqual(p.hits, 7);      // MV 1 and 5
        assert.strictEqual(p.misses, 3);    // MV 6 and 9
        assert.strictEqual(p.lands, 36);
        assert.strictEqual(p.total, 46);
    });

    it('treats mana value exactly 5 as eligible', () => {
        assert.strictEqual(partitionLibrary(nonlands([[5, 1]]), 0).hits, 1);
        assert.strictEqual(partitionLibrary(nonlands([[6, 1]]), 0).hits, 0);
    });

    it('honours a custom discover threshold', () => {
        const cards = nonlands([[3, 1], [7, 1]]);
        assert.strictEqual(partitionLibrary(cards, 0, 3).hits, 1);
        assert.strictEqual(partitionLibrary(cards, 0, 7).hits, 2);
    });

    it('skips land entries that appear in card details', () => {
        const cards = [...nonlands([[2, 2]]), { name: 'Forest', cmc: 0, type: 'lands' }];
        const p = partitionLibrary(cards, 10);
        assert.strictEqual(p.hits, 2);
        assert.strictEqual(p.lands, 10);
    });

    it('handles missing or malformed input without throwing', () => {
        assert.doesNotThrow(() => partitionLibrary(undefined, undefined));
        assert.strictEqual(partitionLibrary(undefined, undefined).total, 0);
        assert.strictEqual(partitionLibrary([{ cmc: null, type: 'creatures' }], 0).hits, 1);
    });
});

describe('expectedCardsDug', () => {
    it('uses the negative hypergeometric mean (N - H) / (H + 1)', () => {
        // 99 cards, 33 eligible -> (99-33)/(33+1) = 66/34
        assert.ok(Math.abs(expectedCardsDug(99, 33) - 66 / 34) < 1e-12);
    });

    it('digs nothing when every card is eligible', () => {
        assert.strictEqual(expectedCardsDug(10, 10), 0);
    });

    it('returns 0 when no card is eligible rather than dividing by zero', () => {
        assert.strictEqual(expectedCardsDug(99, 0), 0);
    });

    it('digs deeper as the eligible pool thins', () => {
        assert.ok(expectedCardsDug(99, 5) > expectedCardsDug(99, 40));
    });

    it('is finite for non-numeric input', () => {
        assert.strictEqual(expectedCardsDug(undefined, undefined), 0);
    });
});

describe('expectedHitMV', () => {
    it('averages the eligible mana values', () => {
        assert.strictEqual(expectedHitMV([1, 2, 3]), 2);
    });

    it('returns 0 for an empty pool', () => {
        assert.strictEqual(expectedHitMV([]), 0);
        assert.strictEqual(expectedHitMV(undefined), 0);
    });

    it('is unaffected by ineligible cards, since only hits are passed in', () => {
        assert.strictEqual(expectedHitMV([5, 5, 5]), 5);
    });
});

describe('hitMVDistribution', () => {
    it('buckets eligible cards by mana value', () => {
        const d = hitMVDistribution([0, 2, 2, 5]);
        assert.strictEqual(d[0], 1);
        assert.strictEqual(d[2], 2);
        assert.strictEqual(d[5], 1);
    });

    it('spans 0..discoverN inclusive', () => {
        assert.strictEqual(hitMVDistribution([], 5).length, 6);
    });

    it('ignores values outside the eligible range', () => {
        const d = hitMVDistribution([9, -1, 3], 5);
        assert.strictEqual(d.reduce((a, b) => a + b, 0), 1);
    });
});

describe('analyzeTrigger', () => {
    const cards = nonlands([[1, 10], [3, 10], [5, 10], [7, 5]]);

    it('reports a hit whenever the eligible pool is non-empty', () => {
        const t = analyzeTrigger({ cardDetails: cards, lands: 36 });
        assert.strictEqual(t.hitRate, 1);
        assert.strictEqual(t.hits, 30);
    });

    it('expects the mean eligible mana value, since the first hit is uniform', () => {
        const t = analyzeTrigger({ cardDetails: cards, lands: 36 });
        assert.ok(Math.abs(t.avgMV - 3) < 1e-12);       // mean of 1, 3, 5
        assert.ok(Math.abs(t.expectedFreeMV - 3) < 1e-12);
    });

    it('reports zero value and no hit for a library with no eligible cards', () => {
        const t = analyzeTrigger({ cardDetails: nonlands([[8, 5]]), lands: 36 });
        assert.strictEqual(t.hitRate, 0);
        assert.strictEqual(t.expectedFreeMV, 0);
        assert.strictEqual(t.hits, 0);
    });

    it('counts lands and high-MV nonlands as passed over', () => {
        const t = analyzeTrigger({ cardDetails: cards, lands: 36 });
        assert.strictEqual(t.misses, 5);
        assert.strictEqual(t.lands, 36);
        assert.strictEqual(t.total, 71);
    });

    it('computes eligible share against the whole library', () => {
        const t = analyzeTrigger({ cardDetails: cards, lands: 36 });
        assert.ok(Math.abs(t.eligibleShare - 30 / 71) < 1e-12);
    });

    it('does not throw on an empty deck', () => {
        assert.doesNotThrow(() => analyzeTrigger({ cardDetails: [], lands: 0 }));
        const t = analyzeTrigger({ cardDetails: [], lands: 0 });
        assert.strictEqual(t.expectedFreeMV, 0);
        assert.strictEqual(t.expectedDug, 0);
    });
});

describe('projectTurns', () => {
    const trigger = analyzeTrigger({ cardDetails: nonlands([[2, 20]]), lands: 36 });

    it('produces one row per end step', () => {
        assert.strictEqual(projectTurns(trigger, 10).length, 10);
    });

    it('accumulates value monotonically', () => {
        const rows = projectTurns(trigger, 10);
        for (let i = 1; i < rows.length; i++) {
            assert.ok(rows[i].cumulativeMV >= rows[i - 1].cumulativeMV);
        }
    });

    it('matches per-turn value times turns while the pool holds out', () => {
        const rows = projectTurns(trigger, 5);
        assert.ok(Math.abs(rows[4].cumulativeMV - 5 * trigger.avgMV) < 1e-9);
    });

    it('depletes the eligible pool by one card per trigger', () => {
        const rows = projectTurns(trigger, 3);
        assert.strictEqual(rows[0].poolLeft, 20);
        assert.strictEqual(rows[1].poolLeft, 19);
        assert.strictEqual(rows[2].poolLeft, 18);
    });

    it('stops adding value once the eligible pool is exhausted', () => {
        const thin = analyzeTrigger({ cardDetails: nonlands([[2, 2]]), lands: 10 });
        const rows = projectTurns(thin, 5);
        assert.ok(rows[1].perTurnMV > 0);
        assert.strictEqual(rows[2].perTurnMV, 0);
        assert.strictEqual(rows[4].cumulativeMV, rows[2].cumulativeMV);
    });

    it('returns no rows for zero or negative turns', () => {
        assert.deepStrictEqual(projectTurns(trigger, 0), []);
        assert.deepStrictEqual(projectTurns(trigger, -3), []);
    });

    it('caps the projection so a bad input cannot loop unbounded', () => {
        assert.ok(projectTurns(trigger, 9999).length <= 30);
    });

    it('exposes an x field so the shared sweep table can mark the active row', () => {
        assert.strictEqual(projectTurns(trigger, 3)[2].x, 3);
    });
});

describe('Chimil card fidelity', () => {
    it('discovers 5, as printed', () => {
        assert.strictEqual(DISCOVER_N, 5);
    });

    it('a deck of only MV 6+ spells is a dead Chimil', () => {
        const t = analyzeTrigger({ cardDetails: nonlands([[6, 30]]), lands: 30 });
        assert.strictEqual(t.expectedFreeMV, 0);
    });

    it('a cheap deck digs less and hits sooner than a top-heavy one', () => {
        const cheap = analyzeTrigger({ cardDetails: nonlands([[2, 40]]), lands: 36 });
        const heavy = analyzeTrigger({ cardDetails: nonlands([[2, 5], [8, 35]]), lands: 36 });
        assert.ok(cheap.expectedDug < heavy.expectedDug);
    });
});

describe('paybackTurn', () => {
    const trigger = analyzeTrigger({ cardDetails: nonlands([[3, 30]]), lands: 36 });

    it('finds the first end step where cumulative value clears the cost', () => {
        // 3 MV per turn against a cost of 6 -> repaid on turn 2
        assert.strictEqual(paybackTurn(projectTurns(trigger, 10)), 2);
    });

    it('counts a turn that lands exactly on the cost', () => {
        const exact = analyzeTrigger({ cardDetails: nonlands([[2, 30]]), lands: 36 });
        assert.strictEqual(paybackTurn(projectTurns(exact, 10)), 3);   // 2+2+2 = 6
    });

    it('returns null when the projection never repays the cost', () => {
        const thin = analyzeTrigger({ cardDetails: nonlands([[1, 2]]), lands: 60 });
        assert.strictEqual(paybackTurn(projectTurns(thin, 30)), null);
    });

    it('returns null for a dead Chimil', () => {
        const dead = analyzeTrigger({ cardDetails: nonlands([[8, 20]]), lands: 36 });
        assert.strictEqual(paybackTurn(projectTurns(dead, 30)), null);
    });

    it('honours a custom cost', () => {
        assert.strictEqual(paybackTurn(projectTurns(trigger, 10), 3), 1);
        assert.strictEqual(paybackTurn(projectTurns(trigger, 10), 12), 4);
    });

    it('does not throw on bad input', () => {
        assert.strictEqual(paybackTurn(undefined), null);
        assert.strictEqual(paybackTurn([]), null);
    });

    it('uses Chimil\'s printed cost by default', () => {
        assert.strictEqual(CHIMIL_COST, 6);
    });
});

describe('fitVerdict', () => {
    const verdictFor = (cards, lands) => {
        const t = analyzeTrigger({ cardDetails: cards, lands });
        return fitVerdict(t, paybackTurn(projectTurns(t, 30)));
    };

    it('calls a deck with no eligible cards unplayable', () => {
        assert.strictEqual(verdictFor(nonlands([[7, 30]]), 36).tier, 'unplayable');
    });

    it('rates a cheap, dense deck that repays immediately as excellent', () => {
        // 40 eligible of 76, average MV 4 -> repaid on turn 2
        const v = verdictFor(nonlands([[3, 20], [5, 20]]), 36);
        assert.strictEqual(v.tier, 'excellent');
    });

    it('rates a thin eligible pool as a poor fit', () => {
        assert.strictEqual(verdictFor(nonlands([[1, 3], [8, 40]]), 36).tier, 'poor');
    });

    it('always returns a label, colour and advice', () => {
        for (const cards of [nonlands([[7, 30]]), nonlands([[3, 40]]), nonlands([[1, 4], [9, 40]])]) {
            const v = verdictFor(cards, 36);
            assert.ok(v.label && v.color && v.advice, JSON.stringify(v));
        }
    });

    it('never claims a good fit when nothing is eligible, whatever the payback', () => {
        const dead = analyzeTrigger({ cardDetails: [], lands: 99 });
        assert.strictEqual(fitVerdict(dead, 1).tier, 'unplayable');
    });

    it('does not throw on missing input', () => {
        assert.doesNotThrow(() => fitVerdict(undefined, null));
        assert.strictEqual(fitVerdict(undefined, null).tier, 'unplayable');
    });
});

describe('PROJECTION_TURNS', () => {
    it('is a fixed horizon, since cumulative value is linear in turns', () => {
        assert.strictEqual(PROJECTION_TURNS, 10);
    });
});

/** A library entry as buildDeckFromCardData produces it. */
function lib(pairs) {
    const out = [];
    for (const [name, cmc, count, isLand] of pairs) {
        for (let i = 0; i < count; i++) {
            out.push({ name, cmc, types: isLand ? ['land'] : ['creature'] });
        }
    }
    return out;
}

describe('simulateGame', () => {
    it('takes the first eligible card and reports how many it dug past', () => {
        const library = lib([['Mountain', 0, 3, true], ['Bear', 2, 1, false]]);
        const g = simulateGame(library, 1);
        assert.strictEqual(g[0].hit.name, 'Bear');
        assert.strictEqual(g[0].dug, 3);
    });

    it('skips lands and spells above the discover threshold', () => {
        const library = lib([['Titan', 8, 2, false], ['Forest', 0, 1, true], ['Elf', 1, 1, false]]);
        const g = simulateGame(library, 1);
        assert.strictEqual(g[0].hit.name, 'Elf');
        assert.strictEqual(g[0].dug, 3);
    });

    it('produces one event per end step', () => {
        assert.strictEqual(simulateGame(lib([['Elf', 1, 20, false]]), 6).length, 6);
    });

    it('accumulates the mana value of what it found', () => {
        const g = simulateGame(lib([['Three', 3, 5, false]]), 3);
        assert.strictEqual(g[2].cumulative, 9);
    });

    it('removes the discovered card, so a pool of one dries up', () => {
        const g = simulateGame(lib([['Only', 2, 1, false], ['Forest', 0, 10, true]]), 4);
        assert.strictEqual(g[0].hit.name, 'Only');
        assert.strictEqual(g[1].hit, null);
        assert.strictEqual(g.length, 2);   // stops once nothing is left
    });

    it('returns no events for a library with nothing eligible', () => {
        const g = simulateGame(lib([['Forest', 0, 30, true]]), 5);
        assert.strictEqual(g.length, 1);
        assert.strictEqual(g[0].hit, null);
    });

    it('does not mutate the library it is given', () => {
        const library = lib([['Elf', 1, 5, false]]);
        const snapshot = library.length;
        simulateGame(library, 3);
        assert.strictEqual(library.length, snapshot);
    });

    it('handles missing input without throwing', () => {
        assert.doesNotThrow(() => simulateGame(undefined, 5));
        assert.deepStrictEqual(simulateGame(undefined, 5)[0].hit, null);
    });
});

describe('summariseGames', () => {
    const games = [
        simulateGame(lib([['Two', 2, 10, false]]), 5),
        simulateGame(lib([['Five', 5, 10, false]]), 5)
    ];

    it('averages the final totals across games', () => {
        const s = summariseGames(games);
        assert.strictEqual(s.avgFinal, (10 + 25) / 2);
    });

    it('reports the best and worst game, which is what a range means', () => {
        const s = summariseGames(games);
        assert.strictEqual(s.worstFinal, 10);
        assert.strictEqual(s.bestFinal, 25);
    });

    it('measures the "just a mana dork" rate at mana value 2 or less', () => {
        assert.strictEqual(summariseGames([simulateGame(lib([['Two', 2, 10, false]]), 5)]).smallHitRate, 1);
        assert.strictEqual(summariseGames([simulateGame(lib([['Five', 5, 10, false]]), 5)]).smallHitRate, 0);
    });

    it('reports how often a game repaid Chimil\'s own cost', () => {
        // 5 turns of MV 2 = 10, clears 6; a single MV 2 hit does not
        assert.strictEqual(summariseGames([simulateGame(lib([['Two', 2, 10, false]]), 5)]).beatCostRate, 1);
        assert.strictEqual(summariseGames([simulateGame(lib([['Two', 2, 1, false]]), 5)]).beatCostRate, 0);
    });

    it('handles no games without dividing by zero', () => {
        const s = summariseGames([]);
        assert.strictEqual(s.avgFinal, 0);
        assert.strictEqual(s.smallHitRate, 0);
        assert.strictEqual(s.beatCostRate, 0);
    });

    it('uses a sensible small-hit threshold', () => {
        assert.strictEqual(SMALL_HIT_MV, 2);
    });
});

describe('cheatedDistribution', () => {
    it('buckets each game by its total mana cheated', () => {
        const games = [
            simulateGame(lib([['Two', 2, 10, false]]), 3),   // 6
            simulateGame(lib([['Two', 2, 10, false]]), 3),   // 6
            simulateGame(lib([['Five', 5, 10, false]]), 2)   // 10
        ];
        const d = cheatedDistribution(games);
        assert.strictEqual(d[6], 2);
        assert.strictEqual(d[10], 1);
    });

    it('sums to the number of games', () => {
        const games = Array.from({ length: 7 }, () => simulateGame(lib([['Three', 3, 10, false]]), 4));
        assert.strictEqual(cheatedDistribution(games).reduce((a, b) => a + b, 0), 7);
    });

    it('fills gaps with zero rather than leaving holes', () => {
        const d = cheatedDistribution([simulateGame(lib([['Five', 5, 10, false]]), 2)]);
        assert.strictEqual(d[0], 0);
        assert.strictEqual(d[5], 0);
        assert.strictEqual(d[10], 1);
    });

    it('records a whiffed game at zero', () => {
        assert.strictEqual(cheatedDistribution([simulateGame(lib([['Forest', 0, 10, true]]), 3)])[0], 1);
    });

    it('handles no games without throwing', () => {
        assert.deepStrictEqual(cheatedDistribution([]), []);
        assert.deepStrictEqual(cheatedDistribution(undefined), []);
    });
});

describe('turn horizon affects the simulated answer', () => {
    it('cheats more over more end steps', () => {
        const deck = lib([['Three', 3, 30, false], ['Forest', 0, 36, true]]);
        const short = summariseGames([simulateGame([...deck], 3)]);
        const long = summariseGames([simulateGame([...deck], 12)]);
        assert.ok(long.avgFinal > short.avgFinal);
    });

    it('can exhaust a thin pool given enough turns, which a linear projection would miss', () => {
        const g = simulateGame(lib([['Only', 2, 3, false], ['Forest', 0, 20, true]]), 10);
        assert.ok(g.length < 10);                       // stopped early
        assert.strictEqual(g[g.length - 1].hit, null);  // ran dry
    });

    it('defaults to a sensible auto-simulation size', () => {
        assert.strictEqual(AUTO_SIM_GAMES, 500);
    });
});
