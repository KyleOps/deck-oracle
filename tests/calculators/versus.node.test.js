import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    ENGINES,
    buildContext,
    compareEngines,
    outcomeDist,
    outcomeOdds,
    contestedOdds,
    verdict,
    summarize,
    curveSplit
} from '../../js/calculators/versus.js';
import { buildDeckFromCardData } from '../../js/utils/sampleSimulator.js';
import { discoverForCreature } from '../../js/utils/discover.js';

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

    it('finds the other member however the deck orders them', () => {
        // Group entries are sorted by mana value; the deck lists the big one
        // first. Each cast must still find the OTHER creature, never itself.
        const { deck, cardData } = makeDeck([
            creature('Big', 8, 1, 1), creature('Small', 2, 1, 1)
        ]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.wildpair.prepare(ctx);
        const big = ENGINES.wildpair.evaluate(ctx.creatures[0], prepared);
        const small = ENGINES.wildpair.evaluate(ctx.creatures[1], prepared);
        assert.strictEqual(big.mean, 2);
        assert.strictEqual(big.detail, 'Small');
        assert.strictEqual(small.mean, 8);
        assert.strictEqual(small.detail, 'Big');
    });

    it('lets one copy of a card find another copy of itself', () => {
        const twin = creature('Twin', 5, 2, 2);
        const { deck, cardData } = makeDeck([twin, { ...twin }, creature('Cheap', 1, 3, 1)]);
        const ctx = buildContext(deck, cardData);
        const prepared = ENGINES.wildpair.prepare(ctx);
        // Casting Cheap finds a Twin (5); casting a Twin finds the other Twin.
        assert.strictEqual(ENGINES.wildpair.evaluate(ctx.creatures[2], prepared).mean, 5);
        assert.strictEqual(ENGINES.wildpair.evaluate(ctx.creatures[0], prepared).mean, 5);
    });

    it('does not write onto the shared deck state', () => {
        const { deck, cardData } = makeDeck([creature('A', 2, 2, 2), creature('B', 4, 3, 1)]);
        buildContext(deck, cardData);
        assert.ok(deck.cardDetails.every(c => Object.keys(c).every(k => !k.startsWith('__'))));
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

    it('never discovers the creature being cast — it is on the stack', () => {
        // The only other card costs too much, so the cast creature is the only
        // thing discover 6 could hit if it were (wrongly) left in the library.
        const { deck, cardData } = makeDeck([creature('Fatty', 6, 6, 6), creature('Huge', 9, 1, 1)]);
        const ctx = buildContext(deck, cardData);
        const r = ENGINES.vortex.evaluate(ctx.creatures[0], ENGINES.vortex.prepare(ctx));
        assert.strictEqual(r.triggers, true);
        assert.strictEqual(r.mean, 0);
        assert.strictEqual(r.stats.whiffRate, 1);
    });

    it('matches the Monstrous Vortex page exactly for the same creature', () => {
        const { deck, cardData } = makeDeck([
            creature('Fatty', 6, 6, 6), creature('Other', 5, 5, 5), creature('Small', 2, 1, 1), spell('Ramp', 3)
        ]);
        const ctx = buildContext(deck, cardData);
        const r = ENGINES.vortex.evaluate(ctx.creatures[0], ENGINES.vortex.prepare(ctx));
        const page = discoverForCreature(buildDeckFromCardData(cardData), { name: 'Fatty', cmc: 6 });
        assert.strictEqual(r.mean, page.avgMana);
        assert.strictEqual(r.p95, page.p95Mana);
    });

    it('quotes a great turn as its best, never a sampled maximum', () => {
        const { deck, cardData } = makeDeck([creature('Fatty', 6, 6, 6), creature('Small', 2, 1, 1)]);
        const ctx = buildContext(deck, cardData);
        const r = ENGINES.vortex.evaluate(ctx.creatures[0], ENGINES.vortex.prepare(ctx));
        assert.strictEqual(r.best, r.stats.p99Mana);
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
        assert.strictEqual(verdict(null).label, 'No data');
        assert.strictEqual(verdict({ creatures: 0 }).label, 'No data');
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
        assert.strictEqual(v.label, 'Too close to call');
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
        assert.strictEqual(v.label, 'Wild Pair leads');
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

// ==================== summarize ====================

describe('summarize', () => {
    function mixed() {
        return makeDeck([
            creature('Dork A', 1, 1, 1),
            creature('Dork B', 3, 1, 1),
            creature('Fatty A', 6, 6, 6),
            creature('Fatty B', 8, 6, 6),
            spell('Ramp', 3), spell('Rampant', 2)
        ]);
    }

    it('asks for a decklist without a comparison', () => {
        assert.strictEqual(summarize(null).tone, 'flat');
        assert.ok(/Import a decklist/.test(summarize(null).html));
    });

    it('keeps the two shapes apart: how often each fires, and what it gives', () => {
        const { deck, cardData } = mixed();
        const s = summarize(compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex'));
        // Wild Pair fires on all four (two pairs); Vortex on the two fatties.
        assert.ok(/Wild Pair fires on <strong>4 of 4<\/strong>/.test(s.html), s.html);
        assert.ok(/Monstrous Vortex fires on <strong>2 of 4<\/strong>/.test(s.html), s.html);
        assert.ok(/you pick the result/.test(s.html), s.html);
        assert.ok(/rolls for it/.test(s.html), s.html);
        assert.ok(/data-term="p95"/.test(s.html), s.html);
    });

    it('names the engine that does more and by how much', () => {
        const { deck, cardData } = mixed();
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        const s = summarize(cmp);
        const v = verdict(cmp);
        assert.notStrictEqual(v.leader, 'tie');
        const leader = v.leader === 'a' ? 'Wild Pair' : 'Monstrous Vortex';
        assert.ok(s.html.includes(`<strong>${leader}</strong> does more`), s.html);
        assert.strictEqual(s.tone, 'good');
    });

    it('reports how often the certain pick beats the roll where both fire', () => {
        const { deck, cardData } = mixed();
        const s = summarize(compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex'));
        assert.ok(/Where both fire \(2 creatures\), Wild Pair’s pick beats the roll \d+% of the time/.test(s.html), s.html);
    });

    it('calls it plainly when neither engine ever fires', () => {
        const { deck, cardData } = makeDeck([creature('A', 1, 1, 1), creature('B', 2, 2, 1)]);
        const s = summarize(compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex'));
        assert.strictEqual(s.tone, 'bad');
        assert.ok(/Neither engine/.test(s.html), s.html);
    });

    it('reads as a dead heat when the averages are level', () => {
        const cmp = {
            creatures: 4,
            contested: { casts: 0 },
            summary: {
                a: { engine: ENGINES.wildpair, perCast: 3.0, coverage: 1, fires: 4, perTrigger: 3, certain: true, p95: 3 },
                b: { engine: ENGINES.vortex, perCast: 3.1, coverage: 0.5, fires: 2, perTrigger: 6.2, certain: false, firedMedian: 5, firedP95: 12, p95: 9 }
            }
        };
        const s = summarize(cmp);
        assert.strictEqual(s.tone, 'flat');
        assert.ok(/Too close to call/.test(s.html), s.html);
    });
});

// ==================== curveSplit ====================

describe('curveSplit', () => {
    it('weights each mana value by how many creatures sit there', () => {
        const split = curveSplit([
            { cmc: 2, count: 3, a: 2, b: 0 },
            { cmc: 4, count: 1, a: 6, b: 4 },
            { cmc: 5, count: 9, a: 99, b: 99 },     // the middle is in neither band
            { cmc: 7, count: 2, a: 1, b: 8 }
        ]);
        assert.strictEqual(split.early.count, 4);
        assert.strictEqual(split.early.a, 3);       // (2*3 + 6) / 4
        assert.strictEqual(split.early.b, 1);       // (0*3 + 4) / 4
        assert.deepStrictEqual(split.late, { a: 1, b: 8, count: 2 });
    });

    it('reports empty bands rather than dividing by zero', () => {
        assert.deepStrictEqual(curveSplit([]).early, { a: 0, b: 0, count: 0 });
        assert.deepStrictEqual(curveSplit(undefined).late, { a: 0, b: 0, count: 0 });
    });
});

describe('compareEngines — per-side shape', () => {
    it('reports fires as a count and the percentiles of fired casts only', () => {
        const { deck, cardData } = makeDeck([
            creature('Dork', 1, 1, 1), creature('Fatty A', 6, 6, 6), creature('Fatty B', 8, 6, 6), spell('Ramp', 2)
        ]);
        const cmp = compareEngines(buildContext(deck, cardData), 'wildpair', 'vortex');
        assert.strictEqual(cmp.summary.a.fires, 2);
        assert.strictEqual(cmp.summary.b.fires, 2);
        // Over every cast the Dork's zero drags the typical result down; over
        // fired casts only it does not.
        assert.ok(cmp.summary.a.firedMedian >= cmp.summary.a.median);
    });

    it('exposes both prepared sides, whichever side the discover engine is on', () => {
        const { deck, cardData } = makeDeck([creature('Fatty', 6, 6, 6), creature('Small', 2, 1, 1)]);
        const cmp = compareEngines(buildContext(deck, cardData), 'vortex', 'wildpair');
        assert.ok(cmp.prepared.a.byCreature instanceof Map);
        assert.ok(cmp.prepared.b.byTotal instanceof Map);
    });
});
