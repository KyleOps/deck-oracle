/**
 * Head to Head — the page's maths: payoff engines compared per creature cast.
 *
 * Every other page asks "how good is this card in my deck". This one asks the
 * question that actually decides a slot: *given these two cards, which one does
 * more for this deck, and when?*
 *
 * The comparison is per creature cast, because that is the event both engines
 * key off and it is the unit a player thinks in — "I'm casting this thing, what
 * do I get?" Averaged across the creature base it gives the general answer;
 * plotted against the cast creature's mana value it gives the answer *at each
 * point in the game*, which is usually where the two diverge.
 *
 * The two engines are deliberately different shapes, and the comparison is built
 * so that difference survives:
 *
 *   WILD PAIR is a TUTOR. It triggers on every creature cast from hand, and you
 *   choose from the whole library — so its value is certain, capped at one body,
 *   and known before you cast. Its weakness is coverage: a creature whose total
 *   power + toughness nothing shares gets nothing at all.
 *
 *   MONSTROUS VORTEX is a DISCOVER. It only triggers on power-5+ creatures, and
 *   takes what the top of the library gives it — so its value is random, but
 *   because discover *casts* what it finds, a discovered power-5+ creature
 *   triggers it again. That chain is the long tail, and no average will show it.
 *
 * So no single number summarises the pair: each side reports how often it fires,
 * what it gives when it does, and (for the random one) its spread, and the
 * bottom line says all three.
 *
 * Note the two do not feed each other: Wild Pair puts its creature onto the
 * battlefield without casting it, so it never triggers Vortex, and a creature
 * cast off discover is cast from exile rather than from hand, so it never
 * triggers Wild Pair.
 *
 * Pure: no DOM, no deck state. The page passes the deck and library in.
 */

import { formatNumber } from '../simulation.js';
import { buildDeckFromCardData } from '../sampleSimulator.js';
import { discoverForCreature, isPower5Plus, mergeDists } from '../discover.js';
import { asLibrary, withoutRemoved } from '../library.js';
import { quantile as percentileFromDist } from '../stats.js';
import { pct } from '../text.js';
import { escapeHtml, term } from '../../data/glossary.js';
import { bucketByTotalPT, cardTotalPT, isCreatureEntry } from './wildpair.js';

/**
 * A payoff engine describes one card that pays you off when you cast creatures.
 *
 * Each exposes `prepare(ctx)` — any deck-wide precomputation — and
 * `evaluate(creature, prepared)`, which returns what casting THAT creature is
 * worth. Adding a third engine means adding one entry here, not a new branch
 * through the rendering. `series` is the engine's identity colour: an index
 * into TX_CHART.series for charts and the matching --series-N token for HTML.
 */
export const ENGINES = {
    wildpair: {
        id: 'wildpair',
        name: 'Wild Pair',
        cost: 6,
        kind: 'tutor',
        series: 3,

        prepare(ctx) {
            // One lookup from total power + toughness to the members at it.
            const byTotal = new Map();
            for (const row of ctx.groups) byTotal.set(row.total, row);
            return { byTotal, groupCardOf: ctx.groupCardOf ?? new Map() };
        },

        /**
         * Wild Pair triggers on every creature cast from hand. You search, so the
         * result is a choice rather than a draw: take the most expensive other
         * creature sharing the total. Certain, and capped at that one body.
         */
        evaluate(creature, prepared) {
            const total = cardTotalPT(creature);
            const group = total === null ? null : prepared.byTotal.get(total);
            if (!group || group.count < 2) {
                return {
                    triggers: false, mean: 0, best: 0, worst: 0, p95: 0, certain: true,
                    detail: total === null ? 'no fixed total' : 'nothing shares this total'
                };
            }
            // The best OTHER member: the dearest, unless this creature is it.
            const self = prepared.groupCardOf.get(creature);
            const others = group.cards.filter(c => c !== self);
            const pool = others.length ? others : group.cards;
            const best = pool.reduce((m, c) => (c.cmc > m.cmc ? c : m), pool[0]);
            return {
                triggers: true,
                mean: best.cmc,
                best: best.cmc,
                worst: best.cmc,
                p95: best.cmc,          // certain: every percentile is the same card
                certain: true,
                detail: best.name,
                card: best
            };
        }
    },

    vortex: {
        id: 'vortex',
        name: 'Monstrous Vortex',
        cost: 4,
        kind: 'discover',
        series: 5,

        prepare(ctx) {
            // Discover is random, so its value is sampled — once per distinct
            // creature, with that creature removed from the library (it is on
            // the stack). discoverForCreature is the same call, library and seed
            // the Monstrous Vortex page uses, so both pages agree exactly.
            const byCreature = new Map();
            for (const c of ctx.creatures) {
                if (!isPower5Plus(c.power, ctx.treatStarAs5Plus)) continue;
                const key = creatureKey(c);
                if (!byCreature.has(key)) {
                    byCreature.set(key, discoverForCreature(ctx.library, c, { treatStarAs5Plus: ctx.treatStarAs5Plus }));
                }
            }
            return { byCreature, treatStarAs5Plus: ctx.treatStarAs5Plus };
        },

        /**
         * Vortex only sees power-5+ creatures, and pays out whatever the top of
         * the library happens to hold — so this is a sampled mean with a real
         * spread behind it, not a certainty.
         */
        evaluate(creature, prepared) {
            if (!isPower5Plus(creature.power, prepared.treatStarAs5Plus)) {
                return { triggers: false, mean: 0, best: 0, worst: 0, p95: 0, certain: false, detail: 'power under 5' };
            }
            const stats = prepared.byCreature.get(creatureKey(creature));
            if (!stats) return { triggers: false, mean: 0, best: 0, worst: 0, p95: 0, certain: false, detail: 'no sample' };
            return {
                triggers: true,
                mean: stats.avgMana,
                // A great turn (p99), never the largest run seen: a sampled
                // maximum grows with the number of shuffles, not with the deck.
                best: stats.p99Mana,
                worst: 0,
                p95: stats.p95Mana,
                certain: false,
                stats,
                detail: `discover ${Math.round(creature.cmc)}`
            };
        }
    }
};

function creatureKey(c) {
    return `${c?.name ?? ''}|${Math.max(0, Math.round(Number(c?.cmc) || 0))}`;
}

/**
 * Build the shared context both engines are evaluated against.
 *
 * @param {Object} deck - DeckConfig shape (its `cardDetails`)
 * @param {Object} source - the library: a Library from libraryOf(), or anything
 *   libraryOf() accepts (getImportedCardData() shape, a snapshot). Commanders
 *   are never in it, so they are taken out of `cardDetails` too.
 * @param {boolean} treatStarAs5Plus
 * @returns {Object|null} null when there is nothing to compare
 */
export function buildContext(deck, source, treatStarAs5Plus = false) {
    const lib = asLibrary(source ?? deck);
    const details = withoutRemoved(Array.isArray(deck?.cardDetails) ? deck.cardDetails : [], lib);
    const creatures = details.filter(isCreatureEntry);

    if (creatures.length === 0) return null;

    const { groups } = bucketByTotalPT(details);

    // Link each creature copy to its own entry inside its group, so Wild Pair
    // can exclude the card being cast from its own search. Matched on name and
    // mana value, claiming each entry once, so two copies of one card link to
    // two entries. (Group entries are sorted by mana value, not deck order, so
    // linking by position paired creatures with the wrong entry and let a
    // creature search up itself.) Kept in a map rather than written onto the
    // cards, which belong to the shared deck state.
    const groupCardOf = new Map();
    const claimed = new Set();
    const byTotal = new Map(groups.map(g => [g.total, g]));
    for (const c of creatures) {
        const total = cardTotalPT(c);
        const group = total === null ? null : byTotal.get(total);
        if (!group) continue;
        const cmc = Number.isFinite(c.cmc) ? c.cmc : 0;
        const entry = group.cards.find(e => !claimed.has(e) && e.name === c.name && e.cmc === cmc) ?? null;
        if (entry) claimed.add(entry);
        groupCardOf.set(c, entry);
    }

    const library = buildDeckFromCardData(lib);

    return {
        creatures,
        groups: groups.map(g => ({ total: g.total, count: g.cards.length, cards: g.cards })),
        groupCardOf,
        library,
        treatStarAs5Plus,
        hasLibrary: library.length > 0
    };
}

/**
 * The outcome distribution of one engine on one creature cast, normalised to
 * sum to 1. A certain engine is a point mass; a random one is its sampled
 * spread.
 *
 * @param {Object} v - an engine's evaluate() result
 * @returns {number[]|null} probability by mana value, or null if it does not fire
 */
export function outcomeDist(v) {
    if (!v || !v.triggers) return null;
    if (v.certain) {
        const d = [];
        d[Math.max(0, Math.round(v.mean))] = 1;
        return d;
    }
    const raw = v.stats?.manaDist || [];
    const total = raw.reduce((a, b) => a + (b || 0), 0);
    if (total === 0) return null;
    return raw.map(n => (n || 0) / total);
}

/**
 * Odds that one engine's outcome beats the other's on the same cast.
 *
 * Both sides are treated as distributions and compared by convolution, so this
 * works whichever kinds are being compared: two certain engines give a 0/1
 * answer, a certain against a random one gives that random engine's tail
 * probability, and two random ones are compared as independent draws.
 *
 * @param {number[]} distA - probability by value for side A
 * @param {number[]} distB - probability by value for side B
 * @returns {{aWins:number, tie:number, bWins:number}}
 */
export function outcomeOdds(distA, distB) {
    const A = Array.isArray(distA) ? distA : [];
    const B = Array.isArray(distB) ? distB : [];
    if (A.length === 0 || B.length === 0) return { aWins: 0, tie: 0, bWins: 0 };

    // Prefix sums of A so each value of B is one lookup rather than a scan.
    const below = new Array(A.length + 1).fill(0);
    for (let v = 0; v < A.length; v++) below[v + 1] = below[v] + (A[v] || 0);
    const totalA = below[A.length];
    const pALess = (v) => below[Math.min(v, A.length)];
    const pAEq = (v) => (v < A.length ? (A[v] || 0) : 0);

    let aWins = 0, tie = 0, bWins = 0;
    for (let v = 0; v < B.length; v++) {
        const pB = B[v] || 0;
        if (pB === 0) continue;
        const less = pALess(v);
        const eq = pAEq(v);
        bWins += pB * less;
        tie += pB * eq;
        aWins += pB * (totalA - less - eq);
    }
    return { aWins, tie, bWins };
}

/**
 * How the two engines fare on the casts where BOTH of them fire.
 *
 * This is the comparison that isolates the actual trade-off — a random payoff
 * against a certain one — from the coverage difference that otherwise dominates
 * every deck-wide number. Casts only one engine sees are excluded, because
 * there is no contest there to win.
 *
 * @param {Array} rows - compareEngines rows
 * @returns {{casts:number, aWins:number, tie:number, bWins:number}}
 */
export function contestedOdds(rows) {
    const contested = (rows || []).filter(r => r.a?.triggers && r.b?.triggers);
    if (contested.length === 0) return { casts: 0, aWins: 0, tie: 0, bWins: 0 };

    let aWins = 0, tie = 0, bWins = 0;
    for (const r of contested) {
        // Each contested cast counts once, however many samples backed it.
        const o = outcomeOdds(outcomeDist(r.a), outcomeDist(r.b));
        aWins += o.aWins;
        tie += o.tie;
        bWins += o.bWins;
    }
    const n = contested.length;
    return { casts: n, aWins: aWins / n, tie: tie / n, bWins: bWins / n };
}

/**
 * One cast's outcome as a weighted distribution part, for pooling. A miss is a
 * zero, a certain engine a point mass, and a sampled spread is normalised to
 * weight 1 so a creature with more samples does not count for more than one cast.
 */
function castPart(v) {
    if (!v.triggers) return { dist: [1], weight: 1 };
    if (v.certain) {
        const d = [];
        d[Math.max(0, Math.round(v.mean))] = 1;
        return { dist: d, weight: 1 };
    }
    return { dist: v.stats?.manaDist || [], weight: 1 / (v.stats?.runs || 1) };
}

/** Deck-wide figures for one side of the comparison. */
function sideSummary(rows, side, engine) {
    const n = rows.length || 1;
    const fired = rows.filter(r => r[side].triggers);
    const dist = mergeDists(rows.map(r => castPart(r[side])));
    // The same spread, but only over the casts where the engine fires: "what
    // you get WHEN it goes off", without the misses dragging it to zero.
    const firedDist = mergeDists(fired.map(r => castPart(r[side])));
    return {
        engine,
        fires: fired.length,
        perCast: rows.reduce((s, r) => s + r[side].mean, 0) / n,
        perTrigger: fired.length ? fired.reduce((s, r) => s + r[side].mean, 0) / fired.length : 0,
        coverage: fired.length / n,
        // Tutor: its true best card. Discover: a great turn (p99), never a
        // sampled maximum. Kept for the peaks section's "tutor's cap" marker.
        best: rows.reduce((m, r) => Math.max(m, r[side].best), 0),
        p95: percentileFromDist(dist, 0.95),
        median: percentileFromDist(dist, 0.5),
        firedMedian: percentileFromDist(firedDist, 0.5),
        firedP95: percentileFromDist(firedDist, 0.95),
        dist,
        certain: engine.kind !== 'discover'
    };
}

/**
 * Evaluate both engines across every creature in the deck.
 *
 * @param {Object} ctx - Result of buildContext
 * @param {string} idA - Engine id
 * @param {string} idB - Engine id
 * @returns {Object} comparison
 */
export function compareEngines(ctx, idA, idB) {
    const A = ENGINES[idA];
    const B = ENGINES[idB];
    if (!ctx || !A || !B) return null;

    const preparedA = A.prepare(ctx);
    const preparedB = B.prepare(ctx);

    const rows = ctx.creatures.map(creature => {
        const a = A.evaluate(creature, preparedA);
        const b = B.evaluate(creature, preparedB);
        const contested = a.triggers && b.triggers;
        return {
            x: creature.cmc,
            creature,
            name: creature.name,
            cmc: creature.cmc,
            power: creature.power,
            toughness: creature.toughness,
            totalPT: cardTotalPT(creature),
            a,
            b,
            contested,
            // Odds on this specific cast, not on the deck-wide average.
            odds: contested ? outcomeOdds(outcomeDist(a), outcomeDist(b)) : null,
            delta: a.mean - b.mean,
            winner: Math.abs(a.mean - b.mean) < 0.05 ? 'tie' : (a.mean > b.mean ? 'a' : 'b')
        };
    }).sort((p, q) => p.cmc - q.cmc || p.name.localeCompare(q.name));

    const summary = { a: sideSummary(rows, 'a', A), b: sideSummary(rows, 'b', B) };

    // The curve that answers "at which point in the game": one point per mana
    // value present in the creature base.
    const byCMC = new Map();
    for (const r of rows) {
        const k = Math.max(0, Math.round(r.cmc));
        if (!byCMC.has(k)) byCMC.set(k, []);
        byCMC.get(k).push(r);
    }
    const groupDist = (group, side) => mergeDists(group.map(r => castPart(r[side])));

    const curve = [...byCMC.entries()]
        .sort((p, q) => p[0] - q[0])
        .map(([cmc, group]) => ({
            x: cmc,
            cmc,
            count: group.length,
            a: group.reduce((s, r) => s + r.a.mean, 0) / group.length,
            b: group.reduce((s, r) => s + r.b.mean, 0) / group.length,
            // The spread worth plotting is a percentile, not a maximum: a
            // sampled maximum bounces between identical runs and invites
            // reading structure into noise.
            aP95: percentileFromDist(groupDist(group, 'a'), 0.95),
            bP95: percentileFromDist(groupDist(group, 'b'), 0.95)
        }));

    return {
        rows,
        curve,
        summary,
        contested: contestedOdds(rows),
        winsA: rows.filter(r => r.winner === 'a').length,
        winsB: rows.filter(r => r.winner === 'b').length,
        ties: rows.filter(r => r.winner === 'tie').length,
        creatures: rows.length,
        prepared: { a: preparedA, b: preparedB }
    };
}

/**
 * The verdict behind the bottom line: which engine is worth more per cast on
 * average, weighed against how often each fires and which has the bigger
 * good turn — three things that can disagree, so a single score would hide it.
 *
 * @param {Object} cmp - Result of compareEngines
 * @returns {{leader:'a'|'b'|'tie', label:string, tone:string, color:string, advice:string}}
 */
export function verdict(cmp) {
    if (!cmp || cmp.creatures === 0) {
        return { leader: 'tie', label: 'No data', tone: 'flat', color: 'var(--tx-dim)', advice: 'Import a decklist with creatures to compare.' };
    }
    const a = cmp.summary.a;
    const b = cmp.summary.b;
    const gap = a.perCast - b.perCast;
    // Compared on p95, not on the largest run seen: a sampled maximum is a
    // property of the sample size, not of the deck.
    const ceilingGap = b.p95 - a.p95;

    if (Math.abs(gap) < 0.25) {
        return {
            leader: 'tie', label: 'Too close to call', tone: 'flat', color: 'var(--tx-flat)',
            advice: `${a.engine.name} and ${b.engine.name} produce about the same value per creature cast in this deck. Pick on shape: ${a.engine.name} is certain, ${b.engine.name} swings.`
        };
    }

    const leader = gap > 0 ? 'a' : 'b';
    const lead = gap > 0 ? a : b;
    const trail = gap > 0 ? b : a;

    let advice = `${lead.engine.name} averages ${formatNumber(Math.abs(gap), 2)} more mana per creature cast across the whole creature base`;
    advice += lead.coverage > trail.coverage
        ? `, and fires on ${pct(lead.coverage)} of casts against ${pct(trail.coverage)}.`
        : `, despite firing on only ${pct(lead.coverage)} of casts against ${pct(trail.coverage)}.`;
    if (ceilingGap > 2 && leader === 'a') {
        advice += ` ${b.engine.name} still has the bigger good turn — its top 5% of casts reach ${b.p95} mana against ${a.p95}.`;
    }
    if (cmp.contested?.casts > 0) {
        advice += ` On the ${cmp.contested.casts} casts both fire on, ${b.engine.name} out-rolls ${a.engine.name} ${pct(cmp.contested.bWins)} of the time.`;
    }

    return { leader, label: `${lead.engine.name} leads`, tone: 'good', color: 'var(--tx-good)', advice };
}

/**
 * The bottom line, in words a player could repeat at the table. Never one
 * number: it says who does more per cast, then each engine's shape — how often
 * it fires and what it gives when it does — and, where both fire, who wins.
 *
 * @param {Object} cmp - Result of compareEngines
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(cmp) {
    if (!cmp || !cmp.creatures) {
        return { tone: 'flat', html: 'Import a decklist with creatures to compare the two engines.' };
    }
    const { a, b } = cmp.summary;
    const n = cmp.creatures;
    const nameA = escapeHtml(a.engine.name);
    const nameB = escapeHtml(b.engine.name);

    if (a.fires === 0 && b.fires === 0) {
        return { tone: 'bad', html: `Neither engine does anything here: ${nameA} and ${nameB} fire on none of your ${n} creatures.` };
    }

    const v = verdict(cmp);
    const gap = Math.abs(a.perCast - b.perCast);
    let html = v.leader === 'tie'
        ? `Too close to call: both average about <strong>${formatNumber((a.perCast + b.perCast) / 2, 1)} mana</strong> per creature cast.`
        : `<strong>${v.leader === 'a' ? nameA : nameB}</strong> does more for this deck — about <strong>${formatNumber(gap, 1)} more mana</strong> per creature cast.`;

    const shape = (s, name) => {
        if (s.fires === 0) return `${name} never fires`;
        const base = `${name} fires on <strong>${s.fires} of ${n}</strong>`;
        return s.certain
            ? `${base} and you pick the result (<strong>${formatNumber(s.perTrigger, 1)} mana</strong> on average)`
            : `${base} and rolls for it — typically <strong>${s.firedMedian} mana</strong>, <strong>${s.firedP95}</strong> on a ${term('p95', 'good turn')}`;
    };
    html += ` ${shape(a, nameA)}; ${shape(b, nameB)}.`;

    const c = cmp.contested;
    if (c?.casts > 0) {
        const certainIsA = a.certain && !b.certain;
        const certainIsB = b.certain && !a.certain;
        if (certainIsA || certainIsB) {
            const sure = certainIsA ? nameA : nameB;
            const sureWins = certainIsA ? c.aWins : c.bWins;
            html += ` Where both fire (${c.casts} creature${c.casts === 1 ? '' : 's'}), ${sure}’s pick beats the roll ${pct(sureWins)} of the time.`;
        }
    }

    return { tone: v.leader === 'tie' ? 'flat' : 'good', html };
}

/**
 * Early-game versus late-game value: casts of mana value 4 or less against 6
 * or more, weighted by how many creatures sit at each mana value.
 *
 * @param {Array<{cmc:number, count:number, a:number, b:number}>} curve
 * @returns {{early:{a:number,b:number,count:number}, late:{a:number,b:number,count:number}}}
 */
export function curveSplit(curve) {
    const band = (points) => {
        const count = points.reduce((s, p) => s + p.count, 0);
        if (!count) return { a: 0, b: 0, count: 0 };
        return {
            a: points.reduce((s, p) => s + p.a * p.count, 0) / count,
            b: points.reduce((s, p) => s + p.b * p.count, 0) / count,
            count
        };
    };
    const pts = Array.isArray(curve) ? curve : [];
    return { early: band(pts.filter(p => p.cmc <= 4)), late: band(pts.filter(p => p.cmc >= 6)) };
}
