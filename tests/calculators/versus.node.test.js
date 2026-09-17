import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    ENGINES,
    buildContext,
    compareEngines,
    outcomeDist,
    outcomeOdds,
    contestedOdds,
    verdict
} from '../../js/calculators/versus.js';

/** A per-copy creature entry in the cardDetails shape. */
function creature(name, cmc, power, toughness) {
    const num = (v) => {
        const s = String(v);
        return (s.includes('*') || s.includes('X')) ? null : parseInt(s, 10);
    };
    const p = num(power), t = num(toughness);
    return {
        name, cmc, type: 'creatures', allTypes: ['creatures'],
        power: String(power), toughness: String(toughness),
        totalPT: (p !== null && t !== null) ? p + t : null
    };
}

function spell(name, cmc) {
    return { name, cmc, type: 'sorceries', allTypes: ['sorceries'] };
}

/** Build the DeckConfig-ish + cardData pair the context needs. */
function makeDeck(details, extraLibrary = []) {
    const cardsByName = {};
    for (const d of details) {
        cardsByName[d.name] = {
            name: d.name,
            type_line: d.allTypes.includes('creatures') ? 'Creature — Beast' : 'Sorcery',
            cmc: d.cmc, power: d.power, toughness: d.toughness, count: 1
        };
    }
    for (const e of extraLibrary) {
        cardsByName[e.name] = { name: e.name, type_line: e.type_line, cmc: e.cmc, power: e.power, count: e.count ?? 1 };
    }
    return {
        deck: { cardDetails: details },
        cardData: { cardsByName, cardDetails: details }
    };
}

// ==================== ENGINES ====================

describe('ENGINES', () => {
    it('registers both payoff engines with the metadata the UI renders', () => {
        assert.ok(ENGINES.wildpair);
        assert.ok(ENGINES.vortex);
        for (const e of Object.values(ENGINES)) {
            assert.strictEqual(typeof e.name, 'string');
            assert.strictEqual(typeof e.cost, 'number');
            assert.strictEqual(typeof e.prepare, 'function');
            assert.strictEqual(typeof e.evaluate, 'function');
        }
    });

    it('marks Wild Pair a tutor and Monstrous Vortex a discover', () => {
        assert.strictEqual(ENGINES.wildpair.kind, 'tutor');
        assert.strictEqual(ENGINES.vortex.kind, 'discover');
    });
});

// ==================== buildContext ====================

describe('buildContext', () => {
    it('collects the creature base and its power/toughness groups', () => {
        const { deck, cardData } = makeDeck([
            creature('A', 2, 2, 2), creature('B', 6, 1, 3), spell('Ramp', 3)
        ]);
        const ctx = buildContext(deck, cardData);
        assert.strictEqual(ctx.creatures.length, 2);
        assert.strictEqual(ctx.groups.length, 1);
        assert.strictEqual(ctx.groups[0].total, 4);
    });

    it('returns null when the deck has no creatures to compare', () => {
        const { deck, cardData } = makeDeck([spell('Bolt', 1)]);
        assert.strictEqual(buildContext(deck, cardData), null);
    });

    it('survives an empty deck', () => {
        assert.doesNotThrow(() => buildContext({}, {}));
        assert.strictEqual(buildContext({}, {}), null);
    });
});

// ==================== Wild Pair engine ====================

describe('ENGINES.wildpair', () => {
    it('triggers on any creature and values the best other member of its group', () => {
        const { deck, cardData } = makeDeck([
            creature('Cheap', 2, 3, 3), creature('Big', 8, 4, 2)
        ]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.wildpair.prepare(ctx);

        const cheap = ENGINES.wildpair.evaluate(ctx.creatures[0], prepared);
        assert.strictEqual(cheap.triggers, true);
        assert.strictEqual(cheap.mean, 8);
        assert.strictEqual(cheap.certain, true);

        // Bidirectional: casting the big one finds the cheap one.
        const big = ENGINES.wildpair.evaluate(ctx.creatures[1], prepared);
        assert.strictEqual(big.mean, 2);
    });

    it('does not let a creature search up itself', () => {
        // Only one creature at this total, so casting it finds nothing.
        const { deck, cardData } = makeDeck([creature('Lonely', 5, 3, 3)]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.wildpair.prepare(ctx);
        const r = ENGINES.wildpair.evaluate(ctx.creatures[0], prepared);
        assert.strictEqual(r.triggers, false);
        assert.strictEqual(r.mean, 0);
    });

    it('finds nothing for a creature with a variable power or toughness', () => {
        const { deck, cardData } = makeDeck([
            creature('Star', 5, '*', '*'), creature('Other', 3, 2, 2)
        ]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.wildpair.prepare(ctx);
        const r = ENGINES.wildpair.evaluate(ctx.creatures[0], prepared);
        assert.strictEqual(r.triggers, false);
        assert.strictEqual(r.detail, 'no fixed total');
    });

    it('is certain — its best and worst outcome are the same card', () => {
        const { deck, cardData } = makeDeck([
            creature('A', 1, 2, 2), creature('B', 4, 3, 1), creature('C', 9, 1, 3)
        ]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.wildpair.prepare(ctx);
        const r = ENGINES.wildpair.evaluate(ctx.creatures[0], prepared);
        assert.strictEqual(r.best, r.worst);
        assert.strictEqual(r.mean, 9);
    });
});

// ==================== Vortex engine ====================

describe('ENGINES.vortex', () => {
    it('does not trigger on creatures with power under 5', () => {
        const { deck, cardData } = makeDeck([creature('Dork', 2, 1, 1)]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.vortex.prepare(ctx);
        const r = ENGINES.vortex.evaluate(ctx.creatures[0], prepared);
        assert.strictEqual(r.triggers, false);
        assert.strictEqual(r.mean, 0);
        assert.strictEqual(r.detail, 'power under 5');
    });

    it('triggers on power-5+ creatures and reports an uncertain value', () => {
        const { deck, cardData } = makeDeck([
            creature('Fatty', 6, 6, 6), creature('Small', 2, 1, 1)
        ]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.vortex.prepare(ctx);
        const r = ENGINES.vortex.evaluate(ctx.creatures[0], prepared);
        assert.strictEqual(r.triggers, true);
        assert.strictEqual(r.certain, false);
        assert.ok(r.mean > 0);
        assert.strictEqual(r.detail, 'discover 6');
    });

    it('respects the star-power reading when deciding what triggers', () => {
        const details = [creature('Star', 6, '*', '*'), creature('Small', 2, 1, 1)];
        const { deck, cardData } = makeDeck(details);

        const off = buildContext(deck, cardData, false);
        assert.strictEqual(ENGINES.vortex.evaluate(off.creatures[0], ENGINES.vortex.prepare(off)).triggers, false);

        const on = buildContext(deck, cardData, true);
        assert.strictEqual(ENGINES.vortex.evaluate(on.creatures[0], ENGINES.vortex.prepare(on)).triggers, true);
    });
});

// ==================== compareEngines ====================

describe('compareEngines', () => {
    /** A deck where Wild Pair covers everything and Vortex covers only the fatties. */
    function mixedDeck() {
        return makeDeck([
            creature('Dork A', 1, 1, 1),
            creature('Dork B', 3, 1, 1),
            creature('Fatty A', 6, 6, 6),
            creature('Fatty B', 8, 6, 6),
            spell('Ramp', 3)
        ]);
    }

    it('evaluates every creature against both engines', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        assert.strictEqual(cmp.creatures, 4);
        assert.strictEqual(cmp.rows.length, 4);
        assert.ok(cmp.rows.every(r => r.a && r.b));
    });

    it('sorts rows by mana value, so the table reads as a curve', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        const cmcs = cmp.rows.map(r => r.cmc);
        assert.deepStrictEqual(cmcs, [...cmcs].sort((a, b) => a - b));
    });

    it('counts a non-triggering cast as the zero it is when averaging per cast', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        // Vortex fires on 2 of 4 creatures.
        assert.ok(Math.abs(cmp.summary.b.coverage - 0.5) < 1e-9);
        // Per-cast is diluted by the misses; per-trigger is not.
        assert.ok(cmp.summary.b.perCast < cmp.summary.b.perTrigger);
    });

    it('reports Wild Pair as certain and Vortex as random', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        assert.strictEqual(cmp.summary.a.certain, true);
        assert.strictEqual(cmp.summary.b.certain, false);
    });

    it('builds one curve point per mana value present in the creature base', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        assert.deepStrictEqual(cmp.curve.map(p => p.cmc), [1, 3, 6, 8]);
        assert.ok(cmp.curve.every(p => p.count >= 1));
    });

    it('tallies per-creature wins, and they sum to the creature count', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        assert.strictEqual(cmp.winsA + cmp.winsB + cmp.ties, cmp.creatures);
    });

    it('gives Wild Pair the win on a small creature Vortex cannot see', () => {
        const { deck, cardData } = mixedDeck();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        const dork = cmp.rows.find(r => r.name === 'Dork A');
        assert.strictEqual(dork.b.triggers, false);
        assert.strictEqual(dork.winner, 'a');
    });

    it('returns null for a missing context or an unknown engine', () => {
        const { deck, cardData } = mixedDeck();
        const ctx = buildContext(deck, cardData);
        assert.strictEqual(compareEngines(null, 'wildpair', 'vortex'), null);
        assert.strictEqual(compareEngines(ctx, 'wildpair', 'nope'), null);
    });
});

// ==================== verdict ====================

describe('verdict', () => {
    it('reports NO DATA without a comparison', () => {
        assert.strictEqual(verdict(null).label, 'NO DATA');
        assert.strictEqual(verdict({ creatures: 0 }).label, 'NO DATA');
    });

    it('calls a dead heat rather than inventing a winner', () => {
        const cmp = {
            creatures: 4,
            summary: {
                a: { engine: ENGINES.wildpair, perCast: 3.0, coverage: 1, best: 8, p95: 8 },
                b: { engine: ENGINES.vortex, perCast: 3.1, coverage: 0.5, best: 9, p95: 9 }
            }
        };
        const v = verdict(cmp);
        assert.strictEqual(v.leader, 'tie');
        assert.strictEqual(v.label, 'TOO CLOSE TO CALL');
    });

    it('names the leader and quotes the gap per cast', () => {
        const cmp = {
            creatures: 4,
            summary: {
                a: { engine: ENGINES.wildpair, perCast: 5.0, coverage: 1, best: 8, p95: 8 },
                b: { engine: ENGINES.vortex, perCast: 2.0, coverage: 0.5, best: 9, p95: 9 }
            }
        };
        const v = verdict(cmp);
        assert.strictEqual(v.leader, 'a');
        assert.ok(v.label.includes('WILD PAIR'));
        assert.ok(/3\.00 more mana/.test(v.advice), v.advice);
    });

    it('credits the trailing engine when its good turns are still bigger', () => {
        const cmp = {
            creatures: 4,
            summary: {
                a: { engine: ENGINES.wildpair, perCast: 5.0, coverage: 1, best: 8, p95: 8 },
                b: { engine: ENGINES.vortex, perCast: 2.0, coverage: 0.5, best: 47, p95: 15 }
            }
        };
        const v = verdict(cmp);
        assert.strictEqual(v.leader, 'a');
        assert.ok(/bigger good turn/.test(v.advice), v.advice);
        // Quotes the stable percentile, never the sampled maximum.
        assert.ok(/15 mana/.test(v.advice), v.advice);
        assert.ok(!/47/.test(v.advice), v.advice);
    });

    it('does not credit a bigger ceiling that is only a sampling artefact', () => {
        // A huge single observed run but the same p95 — nothing to say about it.
        const cmp = {
            creatures: 4,
            summary: {
                a: { engine: ENGINES.wildpair, perCast: 5.0, coverage: 1, best: 8, p95: 8 },
                b: { engine: ENGINES.vortex, perCast: 2.0, coverage: 0.5, best: 47, p95: 8 }
            }
        };
        assert.ok(!/good turn/.test(verdict(cmp).advice));
    });
});

// ==================== outcomeDist / outcomeOdds ====================

describe('outcomeDist', () => {
    it('turns a certain outcome into a point mass', () => {
        const d = outcomeDist({ triggers: true, certain: true, mean: 4 });
        assert.strictEqual(d[4], 1);
        assert.strictEqual(d.reduce((a, b) => a + (b || 0), 0), 1);
    });

    it('normalises a sampled spread to sum to one', () => {
        const d = outcomeDist({
            triggers: true, certain: false,
            stats: { manaDist: [10, 30, 60], runs: 100 }
        });
        assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - 1) < 1e-9);
        assert.ok(Math.abs(d[2] - 0.6) < 1e-9);
    });

    it('returns null when the engine does not fire', () => {
        assert.strictEqual(outcomeDist({ triggers: false }), null);
        assert.strictEqual(outcomeDist(null), null);
    });
});

describe('outcomeOdds', () => {
    it('gives a certain answer when both sides are certain', () => {
        const a = outcomeDist({ triggers: true, certain: true, mean: 3 });
        const b = outcomeDist({ triggers: true, certain: true, mean: 8 });
        const o = outcomeOdds(a, b);
        assert.strictEqual(o.bWins, 1);
        assert.strictEqual(o.aWins, 0);
        assert.strictEqual(o.tie, 0);
    });

    it('calls equal certain outcomes a tie, not a win for either', () => {
        const a = outcomeDist({ triggers: true, certain: true, mean: 5 });
        const o = outcomeOdds(a, a);
        assert.strictEqual(o.tie, 1);
        assert.strictEqual(o.aWins, 0);
        assert.strictEqual(o.bWins, 0);
    });

    it('reads the random side as a tail probability against a fixed value', () => {
        // A is a certain 5. B is 2 mana 70% of the time, 9 mana 30%.
        const a = outcomeDist({ triggers: true, certain: true, mean: 5 });
        const b = outcomeDist({ triggers: true, certain: false, stats: { manaDist: [0, 0, 70, 0, 0, 0, 0, 0, 0, 30], runs: 100 } });
        const o = outcomeOdds(a, b);
        assert.ok(Math.abs(o.bWins - 0.3) < 1e-9);
        assert.ok(Math.abs(o.aWins - 0.7) < 1e-9);
        assert.strictEqual(o.tie, 0);
    });

    it('counts an exact match as a tie rather than a win', () => {
        const a = outcomeDist({ triggers: true, certain: true, mean: 5 });
        const b = outcomeDist({ triggers: true, certain: false, stats: { manaDist: [0, 0, 0, 0, 0, 50, 0, 0, 50], runs: 100 } });
        const o = outcomeOdds(a, b);
        assert.ok(Math.abs(o.tie - 0.5) < 1e-9);
        assert.ok(Math.abs(o.bWins - 0.5) < 1e-9);
    });

    it('compares two random sides as independent draws', () => {
        // Both are a fair coin over {0, 2}: B wins only when it rolls 2 and A rolls 0.
        const coin = outcomeDist({ triggers: true, certain: false, stats: { manaDist: [50, 0, 50], runs: 100 } });
        const o = outcomeOdds(coin, coin);
        assert.ok(Math.abs(o.bWins - 0.25) < 1e-9);
        assert.ok(Math.abs(o.aWins - 0.25) < 1e-9);
        assert.ok(Math.abs(o.tie - 0.5) < 1e-9);
    });

    it('always sums to one', () => {
        const a = outcomeDist({ triggers: true, certain: false, stats: { manaDist: [3, 5, 2, 9], runs: 19 } });
        const b = outcomeDist({ triggers: true, certain: false, stats: { manaDist: [1, 0, 7, 4, 8], runs: 20 } });
        const o = outcomeOdds(a, b);
        assert.ok(Math.abs(o.aWins + o.tie + o.bWins - 1) < 1e-9);
    });

    it('returns zeros for a missing distribution rather than throwing', () => {
        assert.deepStrictEqual(outcomeOdds(null, [1]), { aWins: 0, tie: 0, bWins: 0 });
        assert.deepStrictEqual(outcomeOdds([1], []), { aWins: 0, tie: 0, bWins: 0 });
    });
});

// ==================== contestedOdds ====================

describe('contestedOdds', () => {
    it('ignores casts only one engine fires on', () => {
        const rows = [
            { a: { triggers: true, certain: true, mean: 5 }, b: { triggers: false } },
            { a: { triggers: false }, b: { triggers: true, certain: true, mean: 9 } },
            {
                a: { triggers: true, certain: true, mean: 3 },
                b: { triggers: true, certain: true, mean: 8 }
            }
        ];
        const c = contestedOdds(rows);
        assert.strictEqual(c.casts, 1);
        assert.strictEqual(c.bWins, 1);
    });

    it('weights every contested cast equally, whatever its sample size', () => {
        // One cast backed by 10 samples, one by 10,000 — each counts once.
        const rows = [
            {
                a: { triggers: true, certain: true, mean: 5 },
                b: { triggers: true, certain: false, stats: { manaDist: [0, 0, 0, 0, 0, 0, 10], runs: 10 } }
            },
            {
                a: { triggers: true, certain: true, mean: 5 },
                b: { triggers: true, certain: false, stats: { manaDist: [10000], runs: 10000 } }
            }
        ];
        const c = contestedOdds(rows);
        assert.strictEqual(c.casts, 2);
        assert.ok(Math.abs(c.bWins - 0.5) < 1e-9);
        assert.ok(Math.abs(c.aWins - 0.5) < 1e-9);
    });

    it('reports nothing when the two engines never both fire', () => {
        const c = contestedOdds([{ a: { triggers: true, certain: true, mean: 4 }, b: { triggers: false } }]);
        assert.strictEqual(c.casts, 0);
        assert.strictEqual(c.bWins, 0);
    });

    it('handles missing input without throwing', () => {
        assert.doesNotThrow(() => contestedOdds(undefined));
        assert.strictEqual(contestedOdds(undefined).casts, 0);
    });

    it('produces three shares that sum to one when there is a contest', () => {
        const rows = [{
            a: { triggers: true, certain: true, mean: 6 },
            b: { triggers: true, certain: false, stats: { manaDist: [2, 3, 4, 5, 6], runs: 20 } }
        }];
        const c = contestedOdds(rows);
        assert.ok(Math.abs(c.aWins + c.tie + c.bWins - 1) < 1e-9);
    });
});

describe('compareEngines — contested casts', () => {
    it('exposes the contested odds alongside the deck-wide summary', () => {
        const { deck, cardData } = makeDeck([
            creature('Dork A', 1, 1, 1),
            creature('Dork B', 3, 1, 1),
            creature('Fatty A', 6, 6, 6),
            creature('Fatty B', 8, 6, 6)
        ]);
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        // Only the two fatties trigger both engines.
        assert.strictEqual(cmp.contested.casts, 2);
        assert.ok(Math.abs(cmp.contested.aWins + cmp.contested.tie + cmp.contested.bWins - 1) < 1e-9);
    });

    it('marks which rows are contested and attaches per-cast odds to them', () => {
        const { deck, cardData } = makeDeck([
            creature('Dork', 1, 1, 1),
            creature('Fatty A', 6, 6, 6),
            creature('Fatty B', 8, 6, 6)
        ]);
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        const dork = cmp.rows.find(r => r.name === 'Dork');
        const fatty = cmp.rows.find(r => r.name === 'Fatty A');
        assert.strictEqual(dork.contested, false);
        assert.strictEqual(dork.odds, null);
        assert.strictEqual(fatty.contested, true);
        assert.ok(fatty.odds);
        assert.ok(Math.abs(fatty.odds.aWins + fatty.odds.tie + fatty.odds.bWins - 1) < 1e-9);
    });

    it('reports no contest when the engines never overlap', () => {
        // Nothing has power 5+, so Vortex never fires anywhere.
        const { deck, cardData } = makeDeck([
            creature('Dork A', 1, 1, 1), creature('Dork B', 3, 1, 1)
        ]);
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        assert.strictEqual(cmp.contested.casts, 0);
    });
});
