/**
 * Head to Head — payoff engine comparison
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
 */

import { formatNumber, formatPercentage } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderSweepTable } from '../utils/components.js';
import { buildDeckFromCardData, renderDistributionChart } from '../utils/sampleSimulator.js';
import { discoverForCreature, isPower5Plus, percentileFromDist, mergeDists, foldTail } from '../utils/discover.js';
import { cardTotalPT, bucketByTotalPT, isCreatureEntry } from './wildpair.js';
import { cardRef, term, escapeHtml } from '../data/glossary.js';

let curveChart = null;

// ==================== ENGINES ====================

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

// ==================== ANALYSIS ====================

/**
 * Build the shared context both engines are evaluated against.
 *
 * @param {Object} deck - DeckConfig shape
 * @param {Object} cardData - getImportedCardData() shape
 * @param {boolean} treatStarAs5Plus
 * @returns {Object|null} null when there is nothing to compare
 */
export function buildContext(deck, cardData, treatStarAs5Plus = false) {
    const details = Array.isArray(deck?.cardDetails) ? deck.cardDetails : [];
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

    const library = cardData?.cardsByName ? buildDeckFromCardData(cardData) : [];

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
        ? `, and fires on ${formatPercentage(lead.coverage, 0)} of casts against ${formatPercentage(trail.coverage, 0)}.`
        : `, despite firing on only ${formatPercentage(lead.coverage, 0)} of casts against ${formatPercentage(trail.coverage, 0)}.`;
    if (ceilingGap > 2 && leader === 'a') {
        advice += ` ${b.engine.name} still has the bigger good turn — its top 5% of casts reach ${b.p95} mana against ${a.p95}.`;
    }
    if (cmp.contested?.casts > 0) {
        advice += ` On the ${cmp.contested.casts} casts both fire on, ${b.engine.name} out-rolls ${a.engine.name} ${formatPercentage(cmp.contested.bWins, 0)} of the time.`;
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
            html += ` Where both fire (${c.casts} creature${c.casts === 1 ? '' : 's'}), ${sure}’s pick beats the roll ${formatPercentage(sureWins, 0)} of the time.`;
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

// ==================== CONFIG ====================

export function getConfig() {
    const a = document.getElementById('versus-engine-a')?.value || 'wildpair';
    const b = document.getElementById('versus-engine-b')?.value || 'vortex';
    const star = document.getElementById('versus-star-power')?.checked || false;
    return { a, b: b === a ? (a === 'wildpair' ? 'vortex' : 'wildpair') : b, treatStarAs5Plus: star };
}

/** Last comparison, keyed on the deck objects and settings that produced it. */
let cache = { key: null, deck: null, cards: null, result: null };

/**
 * Compare the two engines — once per deck and settings. Revisiting the page,
 * or any re-render that changes nothing, reuses the last result instead of
 * re-sampling every big creature.
 */
export function calculate() {
    const config = getConfig();
    const deck = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();
    const key = `${config.a}|${config.b}|${config.treatStarAs5Plus}`;

    if (cache.result && cache.key === key && cache.deck === deck.cardDetails && cache.cards === cardData.cardsByName) {
        return cache.result;
    }
    const ctx = buildContext(deck, cardData, config.treatStarAs5Plus);
    const cmp = ctx ? compareEngines(ctx, config.a, config.b) : null;
    const result = { config, ctx, cmp, verdict: verdict(cmp) };
    cache = { key, deck: deck.cardDetails, cards: cardData.cardsByName, result };
    return result;
}

// ==================== UI ====================

const seriesVar = (engine) => `var(--series-${engine.series ?? 1})`;
const seriesHex = (engine) => TX.series[(engine.series ?? 1) - 1] ?? TX.blue;

/** Bottom line plus the two-sided scoreboard. */
function renderAnswer(cmp, v) {
    const el = document.getElementById('versus-scoreboard');
    if (!el) return;
    const line = summarize(cmp);
    if (!cmp) { el.innerHTML = renderBottomLine(line); return; }

    const { a, b } = cmp.summary;
    const n = cmp.creatures;
    const tip = (text, label) => `<span class="term" data-tip="${escapeHtml(text)}" tabindex="0">${label}</span>`;

    const side = (s, isLeader) => `
        <div class="vs-side${isLeader ? ' is-leader' : ''}" style="--vs-engine:${seriesVar(s.engine)}">
            <div class="vs-side-top">
                <span class="vs-side-name">${escapeHtml(s.engine.name)}</span>
                ${isLeader ? '<span class="vs-lead-chip">does more</span>' : ''}
            </div>
            <div class="vs-side-kind">${s.engine.cost} mana · ${s.certain ? 'tutor — you pick' : 'discover — random, can chain'}</div>
            <div class="vs-side-value">${formatNumber(s.perCast, 1)}</div>
            <div class="vs-side-unit">${tip('Free mana value from one creature cast, averaged over every creature in the deck. A cast it does not fire on counts as zero.', 'mana per creature cast')}</div>
            <dl class="vs-side-rows">
                <div><dt>${tip('How many of your creatures trigger it when you cast them.', 'Fires on')}</dt><dd>${s.fires} of ${n} creatures</dd></div>
                <div><dt>${tip('Average free mana value on the casts where it fires.', 'When it fires')}</dt><dd>${formatNumber(s.perTrigger, 1)} mana</dd></div>
                <div><dt><span class="term" data-term="p95" tabindex="0">Good turn</span></dt><dd>${s.fires ? `${s.firedP95} mana` : '—'}</dd></div>
            </dl>
        </div>`;

    el.innerHTML = `
        ${renderBottomLine(line)}
        <div class="vs-board">
            ${side(a, v.leader === 'a')}
            <div class="vs-mid">
                <span class="vs-mid-vs">vs</span>
                <span class="vs-mid-tally"><span>${cmp.winsA}</span><span class="vs-mid-sep">–</span><span>${cmp.winsB}</span></span>
                <span class="vs-mid-label">${tip('For each creature, which engine gives more on average when you cast it.', 'creatures won')}${cmp.ties ? `<span class="vs-mid-ties">${cmp.ties} tied</span>` : ''}</span>
            </div>
            ${side(b, v.leader === 'b')}
        </div>`;
}

/**
 * The chart that answers the actual question: average free mana against the
 * mana value of the creature you cast, which is what "point in the game" means
 * in practice. Each engine keeps its identity colour; the dashed line is the
 * random engine's good turn, so the swing shows next to the average.
 */
function updateCurveChart(cmp) {
    if (!document.getElementById('versus-curve-chart') || !cmp) return;
    const { curve, summary } = cmp;
    if (curve.length === 0) return;

    const line = (s, key, extra = {}) => ({
        label: s.engine.name,
        data: curve.map(p => p[key]),
        borderColor: seriesHex(s.engine),
        backgroundColor: seriesHex(s.engine),
        borderWidth: 2,
        fill: false,
        cubicInterpolationMode: 'monotone',
        pointRadius: 3,
        pointHoverRadius: 5,
        ...extra
    });
    const random = [summary.a, summary.b].find(s => !s.certain);
    const datasets = [line(summary.a, 'a'), line(summary.b, 'b')];
    if (random) {
        datasets.push(line(random, random === summary.a ? 'aP95' : 'bP95', {
            label: `${random.engine.name} — good turn`,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0
        }));
    }

    curveChart = createOrUpdateChart(curveChart, 'versus-curve-chart', {
        type: 'line',
        data: { labels: curve.map(p => String(p.cmc)), datasets },
        options: {
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: TX.mid, font: { size: 11 }, boxWidth: 14, boxHeight: 2 }
                },
                tooltip: {
                    callbacks: {
                        title: (items) => `Casting a ${items[0]?.label ?? ''}-mana creature`,
                        label: (item) => `${item.dataset.label}: ${formatNumber(item.parsed.y, 1)} mana`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Free mana per creature cast', color: TX.dim, font: { size: 11 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, precision: 0 }
                },
                x: {
                    title: { display: true, text: 'Mana value of the creature you cast', color: TX.dim, font: { size: 11 } },
                    grid: { display: false },
                    ticks: { color: TX.dim }
                }
            }
        }
    });
}

/** Early versus late, in one sentence under the chart. */
function renderCurveNote(cmp) {
    const el = document.getElementById('versus-recommendation');
    if (!el) return;
    if (!cmp) { el.innerHTML = ''; return; }
    const { a, b } = cmp.summary;
    const { early, late } = curveSplit(cmp.curve);
    const nameA = escapeHtml(a.engine.name);
    const nameB = escapeHtml(b.engine.name);
    const bits = [];
    if (early.count) bits.push(`Casting creatures of mana value 4 or less, ${nameA} gives <strong>${formatNumber(early.a, 1)}</strong> against ${nameB}’s <strong>${formatNumber(early.b, 1)}</strong>.`);
    if (late.count) {
        bits.push(`At 6 and up it is <strong>${formatNumber(late.a, 1)}</strong> against <strong>${formatNumber(late.b, 1)}</strong>.`);
        const randomLate = !b.certain ? late.b > late.a : late.a > late.b;
        bits.push(randomLate
            ? 'Discover scales with the creature you cast, while a tutor is capped by the best card in the group.'
            : `${late.a >= late.b ? nameA : nameB} holds up at the top of the curve too.`);
    }
    el.innerHTML = bits.length ? `<p class="vs-note">${bits.join(' ')}</p>` : '';
}

/**
 * The random engine's spread — the part no average can express, and the
 * direct test of "higher peaks". Shown only for a discover engine; a tutor has
 * no spread to show.
 */
function renderPeaks(cmp) {
    const el = document.getElementById('versus-peaks');
    const head = document.getElementById('versus-peaks-summary');
    if (!el) return;
    if (!cmp) { el.innerHTML = ''; return; }

    const sides = [cmp.summary.a, cmp.summary.b];
    const discoverSide = sides.find(s => s.engine.kind === 'discover');
    const tutorSide = sides.find(s => s.engine.kind === 'tutor');
    const prepared = discoverSide === cmp.summary.a ? cmp.prepared?.a : cmp.prepared?.b;
    if (!discoverSide || !prepared?.byCreature) { el.innerHTML = ''; return; }
    if (head) head.textContent = `How ${discoverSide.engine.name}’s results spread`;

    // Pool every sampled creature together: across the deck's big creatures,
    // how often does one trigger chain, and how big does it get?
    const pooled = [...prepared.byCreature.values()];
    if (pooled.length === 0) {
        el.innerHTML = `<div class="tx-empty">${escapeHtml(discoverSide.engine.name)} never triggers in this deck — no creature has power 5 or more.</div>`;
        return;
    }

    const chainDist = mergeDists(pooled.map(s => ({ dist: s.chainDist })));
    const manaDist = mergeDists(pooled.map(s => ({ dist: s.manaDist })));
    const runs = pooled.reduce((t, s) => t + s.runs, 0);
    const chained = chainDist.slice(2).reduce((t, v) => t + v, 0);
    const tutorCap = tutorSide ? tutorSide.best : 0;
    const contested = cmp.contested;
    const discoverIsB = discoverSide === cmp.summary.b;
    const discoverWins = discoverIsB ? contested.bWins : contested.aWins;
    const tutorWins = discoverIsB ? contested.aWins : contested.bWins;

    const stat = (label, value, sub, tipText) => `
        <div class="vs-peak">
            <div class="vs-peak-label">${tipText ? `<span class="term" ${tipText.startsWith('term:') ? `data-term="${tipText.slice(5)}"` : `data-tip="${escapeHtml(tipText)}"`} tabindex="0">${label}</span>` : label}</div>
            <div class="vs-peak-value">${value}</div>
            <div class="vs-peak-sub">${sub}</div>
        </div>`;

    el.innerHTML = `
        <div class="vs-peaks">
            ${tutorSide && contested.casts > 0 ? stat(
                `Beats ${escapeHtml(tutorSide.engine.name)}`,
                formatPercentage(discoverWins, 0),
                `on the ${contested.casts} creature${contested.casts === 1 ? '' : 's'} both fire on · loses ${formatPercentage(tutorWins, 0)}`,
                'How often the random roll comes out ahead of the tutor’s certain pick, on the casts where both trigger.'
            ) : ''}
            ${stat('Chains', formatPercentage(chained / runs, 0), 'of triggers cast 2+ spells', 'How often the free spell is itself a power-5+ creature, which triggers Vortex again.')}
            ${stat('Good turn', percentileFromDist(manaDist, 0.95), 'mana, 1 trigger in 20', 'term:p95')}
            ${stat('Great turn', percentileFromDist(manaDist, 0.99), 'mana, 1 trigger in 100', 'term:p99')}
            ${stat('Finds nothing', formatPercentage((chainDist[0] || 0) / runs, 0), 'of triggers', 'Triggers where nothing in the library costs little enough.')}
        </div>
        <div class="vs-dists">
            <div>
                <div class="tx-sim-block-title">Free spells per trigger</div>
                ${spellsChart(chainDist, runs)}
            </div>
            <div>
                <div class="tx-sim-block-title">Free mana per trigger${tutorSide ? ` · ${escapeHtml(tutorSide.engine.name)}’s best is ${tutorCap}` : ''}</div>
                ${manaChart(manaDist, runs, {
                    marker: (i) => (tutorSide && i === tutorCap ? `${tutorSide.engine.name} best` : null),
                    tone: (i) => (i === 0 ? 'bad' : (tutorSide && i > tutorCap ? 'warn' : null))
                })}
            </div>
        </div>
        <p class="vs-note">Pooled over ${pooled.length} big creature${pooled.length === 1 ? '' : 's'}, ${runs.toLocaleString('en-US')} shuffles. Bars past ${tutorSide ? `${escapeHtml(tutorSide.engine.name)}’s best` : 'the cap'} are turns the tutor can never match.</p>`;
}

/**
 * Spread charts with the far tail folded into one "N+" row, so the last row is
 * never the largest run seen (a sampled maximum).
 */
function spellsChart(dist, runs) {
    const { counts, cut, folded } = foldTail(dist);
    const label = (i) => `${i}${folded && i === cut ? '+' : ''} spell${i === 1 && !(folded && i === cut) ? '' : 's'}`;
    return renderDistributionChart(counts, runs, label, (i) => (i >= 2 ? 'chain' : null), (i) => (i === 0 ? 'bad' : null));
}

function manaChart(dist, runs, { marker = () => null, tone = () => null } = {}) {
    const { counts, cut, folded } = foldTail(dist);
    return renderDistributionChart(counts, runs, (i) => `${i}${folded && i === cut ? '+' : ''} mana`, marker, tone);
}

function updateTable(cmp) {
    if (!cmp) {
        renderSweepTable('versus-table', { columns: [], rows: [], emptyText: 'Import a decklist to compare creature by creature.' });
        return;
    }
    const sideA = cmp.summary.a;
    const sideB = cmp.summary.b;

    const cell = (v, s) => {
        if (!v.triggers) return `<span class="vs-detail">— ${escapeHtml(v.detail)}</span>`;
        const value = `<span class="vs-val" style="--vs-engine:${seriesVar(s.engine)}">${formatNumber(v.mean, v.certain ? 0 : 1)}</span>`;
        return v.certain
            ? `${value} <span class="vs-detail">${v.card ? cardRef(v.card.name) : escapeHtml(v.detail)}</span>`
            : `${value} <span class="vs-detail">avg · ${escapeHtml(v.detail)}</span>`;
    };

    renderSweepTable('versus-table', {
        columns: [
            { label: 'Creature', align: 'left', render: r => cardRef(r.name) },
            { label: 'MV', render: r => r.cmc },
            { label: 'P/T', render: r => `<span class="vs-pt">${escapeHtml(r.power)}/${escapeHtml(r.toughness)}</span>` },
            { label: escapeHtml(sideA.engine.name), align: 'left', render: r => cell(r.a, sideA) },
            { label: escapeHtml(sideB.engine.name), align: 'left', render: r => cell(r.b, sideB) },
            {
                // One column rather than two: where both engines fire, the odds
                // already say who wins and by how much, and where only one fires
                // there is no contest to put a percentage on.
                label: 'Better here',
                align: 'left',
                render: (r) => {
                    const named = (s) => `<span class="vs-win" style="--vs-engine:${seriesVar(s.engine)}">${escapeHtml(s.engine.name)}</span>`;
                    if (r.contested) {
                        const aAhead = r.odds.aWins >= r.odds.bWins;
                        return `${named(aAhead ? sideA : sideB)} <span class="vs-detail">${formatPercentage(aAhead ? r.odds.aWins : r.odds.bWins, 0)} of the time</span>`;
                    }
                    if (r.a.triggers) return `${named(sideA)} <span class="vs-detail">only one that fires</span>`;
                    if (r.b.triggers) return `${named(sideB)} <span class="vs-detail">only one that fires</span>`;
                    return '<span class="vs-detail">neither fires</span>';
                }
            }
        ],
        rows: cmp.rows,
        emptyText: 'No creatures in this deck.'
    });
}


/** Show or hide the evidence panels; without a deck only the answer remains. */
function showPanels(ids, visible) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    }
}

export function updateUI() {
    const { cmp, verdict: v } = calculate();
    showPanels(['versus-curve-panel', 'versus-table-panel', 'versus-more-panel'], Boolean(cmp));
    renderAnswer(cmp, v);
    updateCurveChart(cmp);
    renderCurveNote(cmp);
    updateTable(cmp);
    renderPeaks(cmp);
    const count = document.getElementById('versus-table-count');
    if (count) count.textContent = cmp ? `${cmp.creatures} creatures · sorted by mana value` : '';
}

// ==================== SHARE LINKS ====================

export function getShareParams() {
    const { a, b, treatStarAs5Plus } = getConfig();
    return { vsA: a, vsB: b, vsStar: treatStarAs5Plus ? 1 : 0 };
}

export function applyShareParams(params) {
    const pick = (name, id) => {
        const value = params?.get?.(name);
        const el = document.getElementById(id);
        if (el && value && Object.prototype.hasOwnProperty.call(ENGINES, value)) el.value = value;
    };
    pick('vsA', 'versus-engine-a');
    pick('vsB', 'versus-engine-b');
    const star = params?.get?.('vsStar');
    const box = document.getElementById('versus-star-power');
    if (box && (star === '0' || star === '1')) box.checked = star === '1';
    updateUI();
}

// ==================== INIT ====================

export function init() {
    // Populate both selectors from the engine registry, so a third engine needs
    // no markup change.
    const options = Object.values(ENGINES)
        .map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
    const selA = document.getElementById('versus-engine-a');
    const selB = document.getElementById('versus-engine-b');
    if (selA && !selA.options.length) { selA.innerHTML = options; selA.value = 'wildpair'; }
    if (selB && !selB.options.length) { selB.innerHTML = options; selB.value = 'vortex'; }

    [selA, selB, document.getElementById('versus-star-power')].forEach(el => {
        el?.addEventListener('change', () => updateUI());
    });

    document.getElementById('versus-swap')?.addEventListener('click', () => {
        if (!selA || !selB) return;
        [selA.value, selB.value] = [selB.value, selA.value];
        updateUI();
    });

    registerCalculator({ name: 'versus', calculate, updateUI, inputs: [] });
}
