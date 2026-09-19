/**
 * Head to Head — payoff engine comparison
 *
 * Every other tab asks "how good is this card in my deck". This one asks the
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
 * So a mean alone would be an unfair summary of Vortex and a misleadingly modest
 * one for Wild Pair. Both get a mean *and* a spread, and the chain distribution
 * is reported on its own.
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
import { renderHeroStats, renderRecommendation, renderSweepTable } from '../utils/components.js';
import { buildDeckFromCardData, shuffleDeck, renderDistributionChart } from '../utils/sampleSimulator.js';
import { sampleDiscover, isPower5Plus, percentileFromDist, mergeDists } from '../utils/discover.js';
import { cardTotalPT, bucketByTotalPT } from './wildpair.js';

/**
 * Discover runs per distinct mana value.
 *
 * Sized for the percentiles the UI quotes rather than for the mean. At 400 the
 * p95 was already steady to about a mana, but p99 still wandered; the maximum
 * never settles at any sample size, which is why it is no longer reported.
 */
export const DISCOVER_RUNS = 800;

let curveChart = null;

// ==================== ENGINES ====================

/**
 * A payoff engine describes one card that pays you off when you cast creatures.
 *
 * Each exposes `prepare(ctx)` — any deck-wide precomputation — and
 * `evaluate(creature, prepared)`, which returns what casting THAT creature is
 * worth. Adding a third engine means adding one entry here, not a new branch
 * through the rendering.
 */
export const ENGINES = {
    wildpair: {
        id: 'wildpair',
        name: 'Wild Pair',
        cost: 6,
        kind: 'tutor',
        trigger: 'any creature you cast from hand',
        blurb: 'Search up a creature with the same total power + toughness and put it onto the battlefield.',

        prepare(ctx) {
            // One lookup from total power + toughness to the members at it.
            const byTotal = new Map();
            for (const row of ctx.groups) byTotal.set(row.total, row);
            return { byTotal };
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
            const others = group.cards.filter(c => c !== creature.__groupCard);
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
        trigger: 'creature spells with power 5 or greater',
        blurb: 'Discover X, where X is that spell\'s mana value — and a discovered power-5+ creature discovers again.',

        prepare(ctx) {
            // Discover is random, so its value has to be sampled. Sampling is
            // keyed by the discover size (the cast creature's mana value), since
            // that is the only input the mechanic sees.
            const byCMC = new Map();
            const distinct = [...new Set(ctx.creatures
                .filter(c => isPower5Plus(c.power, ctx.treatStarAs5Plus))
                .map(c => Math.max(0, Math.round(c.cmc))))];

            for (const cmc of distinct) {
                byCMC.set(cmc, sampleDiscover(
                    () => shuffleDeck([...ctx.library]),
                    cmc,
                    { runs: DISCOVER_RUNS, treatStarAs5Plus: ctx.treatStarAs5Plus }
                ));
            }
            return { byCMC, treatStarAs5Plus: ctx.treatStarAs5Plus };
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
            const stats = prepared.byCMC.get(Math.max(0, Math.round(creature.cmc)));
            if (!stats) return { triggers: false, mean: 0, best: 0, worst: 0, p95: 0, certain: false, detail: 'no sample' };
            return {
                triggers: true,
                mean: stats.avgMana,
                best: stats.bestMana,
                worst: 0,
                p95: stats.p95Mana,
                certain: false,
                stats,
                detail: `discover ${Math.round(creature.cmc)}`
            };
        }
    }
};

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
    const creatures = details.filter(c =>
        Array.isArray(c?.allTypes) ? c.allTypes.includes('creatures') : c?.type === 'creatures');

    if (creatures.length === 0) return null;

    const { groups } = bucketByTotalPT(details);

    // Link each creature copy to its entry inside its group, so Wild Pair can
    // exclude the card being cast from its own search without matching by name
    // (a deck may run two copies with the same name).
    const cursor = new Map();
    for (const c of creatures) {
        const total = cardTotalPT(c);
        if (total === null) continue;
        const group = groups.find(g => g.total === total);
        if (!group) continue;
        const i = cursor.get(total) ?? 0;
        c.__groupCard = group.cards[i] ?? null;
        cursor.set(total, i + 1);
    }

    const library = cardData?.cardsByName ? buildDeckFromCardData(cardData) : [];

    return {
        creatures,
        groups: groups.map(g => ({ total: g.total, count: g.cards.length, cards: g.cards })),
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

    const n = rows.length || 1;
    const sum = (f) => rows.reduce((acc, r) => acc + f(r), 0);

    const trigA = rows.filter(r => r.a.triggers);
    const trigB = rows.filter(r => r.b.triggers);

    // Distribution of "value from one creature cast", pooled over the creature
    // base, for each side. Built the same way for both so the percentiles are
    // genuinely comparable: a certain engine contributes a point mass, a random
    // one contributes its whole sampled spread, and a cast that triggers nothing
    // contributes a zero.
    const distFor = (side) => mergeDists(rows.map(r => {
        const v = r[side];
        if (!v.triggers) return { dist: [1], weight: 1 };
        if (v.certain) {
            const d = [];
            d[Math.max(0, Math.round(v.mean))] = 1;
            return { dist: d, weight: 1 };
        }
        // Normalise each sampled spread to weight 1 so a creature with more
        // samples does not count for more than one cast.
        const runs = v.stats?.runs || 1;
        return { dist: v.stats?.manaDist || [], weight: 1 / runs };
    }));

    const distA = distFor('a');
    const distB = distFor('b');

    // Value per creature cast, averaged over the whole creature base — a cast
    // that triggers nothing counts as the zero it is.
    const summary = {
        a: {
            engine: A,
            perCast: sum(r => r.a.mean) / n,
            perTrigger: trigA.length ? trigA.reduce((s, r) => s + r.a.mean, 0) / trigA.length : 0,
            coverage: trigA.length / n,
            best: rows.reduce((m, r) => Math.max(m, r.a.best), 0),
            p95: percentileFromDist(distA, 0.95),
            median: percentileFromDist(distA, 0.5),
            dist: distA,
            certain: A.kind !== 'discover'
        },
        b: {
            engine: B,
            perCast: sum(r => r.b.mean) / n,
            perTrigger: trigB.length ? trigB.reduce((s, r) => s + r.b.mean, 0) / trigB.length : 0,
            coverage: trigB.length / n,
            // For a discover engine this is a SAMPLED maximum: it grows with the
            // sample size and is not monotonic in the discover size, so it must
            // not be displayed or compared against the tutor's true maximum.
            // Kept only so the tutor's genuine cap has something to be read
            // against in the peaks section.
            best: rows.reduce((m, r) => Math.max(m, r.b.best), 0),
            p95: percentileFromDist(distB, 0.95),
            median: percentileFromDist(distB, 0.5),
            dist: distB,
            certain: B.kind !== 'discover'
        }
    };

    // The curve that answers "at which point in the game": one point per mana
    // value present in the creature base.
    const byCMC = new Map();
    for (const r of rows) {
        const k = Math.max(0, Math.round(r.cmc));
        if (!byCMC.has(k)) byCMC.set(k, []);
        byCMC.get(k).push(r);
    }
    /** Pooled per-cast distribution for one side across a set of rows. */
    const groupDist = (group, side) => mergeDists(group.map(r => {
        const v = r[side];
        if (!v.triggers) return { dist: [1], weight: 1 };
        if (v.certain) {
            const d = [];
            d[Math.max(0, Math.round(v.mean))] = 1;
            return { dist: d, weight: 1 };
        }
        return { dist: v.stats?.manaDist || [], weight: 1 / (v.stats?.runs || 1) };
    }));

    const curve = [...byCMC.entries()]
        .sort((p, q) => p[0] - q[0])
        .map(([cmc, group]) => ({
            x: cmc,
            cmc,
            count: group.length,
            a: group.reduce((s, r) => s + r.a.mean, 0) / group.length,
            b: group.reduce((s, r) => s + r.b.mean, 0) / group.length,
            // The spread worth plotting is a percentile, not a maximum. Discover
            // N+1 can hit everything discover N can, so every true statistic
            // rises with the cast creature's mana value — but a sampled maximum
            // does not, and plotting it drew dips that were pure noise.
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
        preparedB
    };
}

/**
 * The plain-English read of a comparison.
 *
 * Deliberately weighs three things separately, because they can disagree and a
 * single score would hide it: which engine is worth more per cast on average,
 * which fires more often, and which has the bigger ceiling.
 *
 * @param {Object} cmp - Result of compareEngines
 * @returns {{leader:'a'|'b'|'tie', label:string, color:string, advice:string}}
 */
export function verdict(cmp) {
    if (!cmp || cmp.creatures === 0) {
        return { leader: 'tie', label: 'NO DATA', color: 'var(--tx-dim)', advice: 'Import a decklist with creatures to compare.' };
    }
    const a = cmp.summary.a;
    const b = cmp.summary.b;
    const gap = a.perCast - b.perCast;
    // Compared on p95, not on the largest run seen: a sampled maximum is a
    // property of the sample size, not of the deck.
    const ceilingGap = b.p95 - a.p95;

    if (Math.abs(gap) < 0.25) {
        return {
            leader: 'tie', label: 'TOO CLOSE TO CALL', color: 'var(--tx-accent)',
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
        const bWins = cmp.contested.bWins;
        advice += ` On the ${cmp.contested.casts} casts both fire on, ${b.engine.name} out-rolls ${a.engine.name} ${formatPercentage(bWins, 0)} of the time.`;
    }

    return {
        leader,
        label: `${lead.engine.name.toUpperCase()} LEADS`,
        color: 'var(--tx-good)',
        advice
    };
}

// ==================== CONFIG ====================

export function getConfig() {
    const a = document.getElementById('versus-engine-a')?.value || 'wildpair';
    const b = document.getElementById('versus-engine-b')?.value || 'vortex';
    const star = document.getElementById('versus-star-power')?.checked || false;
    return { a, b: b === a ? (a === 'wildpair' ? 'vortex' : 'wildpair') : b, treatStarAs5Plus: star };
}

export function calculate() {
    const config = getConfig();
    const deck = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();
    const ctx = buildContext(deck, cardData, config.treatStarAs5Plus);
    const cmp = ctx ? compareEngines(ctx, config.a, config.b) : null;
    return { config, ctx, cmp, verdict: verdict(cmp) };
}

// ==================== UI ====================

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The chart that answers the actual question: expected free mana value against
 * the mana value of the creature you cast, which is what "point in the game"
 * means in practice. The dashed line is the leader's ceiling, so the shape of
 * the swing is visible next to the average rather than only in a footnote.
 */
function updateCurveChart(cmp) {
    if (!document.getElementById('versus-curve-chart') || !cmp) return;
    const { curve, summary } = cmp;
    if (curve.length === 0) return;

    curveChart = createOrUpdateChart(curveChart, 'versus-curve-chart', {
        type: 'line',
        data: {
            labels: curve.map(p => `MV ${p.cmc}`),
            datasets: [
                {
                    label: summary.a.engine.name,
                    data: curve.map(p => p.a),
                    borderColor: TX.green,
                    backgroundColor: TX.greenFill,
                    borderWidth: 2,
                    fill: true,
                    tension: 0,
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    label: summary.b.engine.name,
                    data: curve.map(p => p.b),
                    borderColor: TX.amber,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    fill: false,
                    tension: 0,
                    pointRadius: 3,
                    pointHoverRadius: 5
                },
                {
                    // A stable percentile rather than the largest run seen. The
                    // maximum bounced by 20 mana between identical runs and was
                    // not even monotonic in the discover size, so as a line it
                    // invited reading structure into sampling noise. p95 is
                    // steady to about a mana and sits on the same scale as the
                    // means, which also removes the need for a second axis.
                    label: `${summary.b.engine.name} — good turn (top 5%)`,
                    data: curve.map(p => p.bP95),
                    borderColor: TX.amber,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderDash: [4, 3],
                    fill: false,
                    tension: 0,
                    pointRadius: 0
                }
            ]
        },
        options: {
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: TX.mid, font: { size: 10 }, boxWidth: 10, boxHeight: 2 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Free mana value from the trigger', color: TX.dim, font: { size: 9 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, font: { size: 9 } }
                },
                x: {
                    title: { display: true, text: 'Mana value of the creature you cast', color: TX.dim, font: { size: 9 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, font: { size: 9 } }
                }
            }
        }
    });
}

function renderScoreboard(cmp, v) {
    const el = document.getElementById('versus-scoreboard');
    if (!el) return;

    if (!cmp) {
        el.innerHTML = `
            <div class="tx-h"><span>Head to head</span><span class="tx-h-r">no deck</span></div>
            <div class="tx-empty">Import a decklist with creatures to compare two payoff engines.</div>`;
        return;
    }

    const { a, b } = cmp.summary;
    const side = (s, isLeader) => `
        <div class="vs-side${isLeader ? ' is-leader' : ''}">
            <div class="vs-side-name">${esc(s.engine.name)}</div>
            <div class="vs-side-cost">{${s.engine.cost}} · ${esc(s.engine.kind)}</div>
            <div class="vs-side-value">${formatNumber(s.perCast, 2)}</div>
            <div class="vs-side-unit">mana per creature cast</div>
            <div class="vs-side-rows">
                <div><span>Fires on</span><span>${formatPercentage(s.coverage, 0)} of casts</span></div>
                <div><span>When it fires</span><span>${formatNumber(s.perTrigger, 2)} mana</span></div>
                <div><span>Typical cast</span><span>${s.median} mana</span></div>
                <div><span>Good turn (top 5%)</span><span>${s.p95} mana</span></div>
                <div><span>Outcome</span><span>${s.certain ? 'you choose' : 'random'}</span></div>
            </div>
        </div>`;

    el.innerHTML = `
        <div class="tx-h">
            <span>Head to head</span>
            <span class="tx-h-r">${cmp.creatures} creature casts · averaged over the whole creature base</span>
        </div>
        <div class="vs-board">
            ${side(a, v.leader === 'a')}
            <div class="vs-mid">
                <div class="vs-mid-vs">VS</div>
                <div class="vs-mid-tally">
                    <span style="color:var(--tx-good);">${cmp.winsA}</span>
                    <span class="vs-mid-sep">/</span>
                    <span style="color:var(--tx-accent);">${cmp.winsB}</span>
                </div>
                <div class="vs-mid-label">creatures won${cmp.ties ? ` · ${cmp.ties} tied` : ''}</div>
            </div>
            ${side(b, v.leader === 'b')}
        </div>
        <div class="vs-verdict">
            <span class="vs-verdict-badge" style="color:${v.color}; border-color:${v.color};">${v.label}</span>
            <span class="vs-verdict-text">${v.advice}</span>
        </div>`;
}

/**
 * The chain distribution — the part of Vortex that no average can express, and
 * the direct test of "higher peaks". Shown only for a discover engine, because
 * a tutor has no distribution to show.
 */
function renderPeaks(cmp) {
    const el = document.getElementById('versus-peaks');
    if (!el) return;

    if (!cmp) { el.innerHTML = ''; return; }

    const discoverSide = [cmp.summary.a, cmp.summary.b].find(s => s.engine.kind === 'discover');
    const tutorSide = [cmp.summary.a, cmp.summary.b].find(s => s.engine.kind === 'tutor');
    if (!discoverSide || !cmp.preparedB?.byCMC) { el.innerHTML = ''; return; }

    // Pool every sampled discover together: across the deck's power-5+ creatures,
    // how often does one trigger chain, and how big does it get?
    const pooled = [...cmp.preparedB.byCMC.values()];
    if (pooled.length === 0) {
        el.innerHTML = `
            <div class="tx-h"><span>Peaks</span><span class="tx-h-r">no power-5+ creatures</span></div>
            <div class="tx-empty">${esc(discoverSide.engine.name)} never triggers in this deck — no creature has power 5 or greater.</div>`;
        return;
    }

    const chainDist = [];
    const manaDist = [];
    let runs = 0;
    for (const s of pooled) {
        runs += s.runs;
        s.chainDist.forEach((n, i) => { chainDist[i] = (chainDist[i] || 0) + n; });
        s.manaDist.forEach((n, i) => { manaDist[i] = (manaDist[i] || 0) + n; });
    }
    for (let i = 0; i < chainDist.length; i++) if (!chainDist[i]) chainDist[i] = 0;
    for (let i = 0; i < manaDist.length; i++) if (!manaDist[i]) manaDist[i] = 0;

    const chained = chainDist.slice(2).reduce((a, b) => a + b, 0);
    const tutorCap = tutorSide ? tutorSide.best : 0;
    const contested = cmp.contested;
    const discoverIsB = cmp.summary.b.engine.kind === 'discover';
    // Orient the odds so they always read "how often the random engine wins".
    const discoverWins = discoverIsB ? contested.bWins : contested.aWins;
    const tutorWins = discoverIsB ? contested.aWins : contested.bWins;

    el.innerHTML = `
        <div class="tx-h">
            <span>Randomness against certainty — where ${esc(discoverSide.engine.name)} actually wins</span>
            <span class="tx-h-r">${runs.toLocaleString('en-US')} sampled triggers · ${esc(tutorSide ? tutorSide.engine.name : 'the tutor')} has no spread to show</span>
        </div>
        <div class="vs-peaks-metrics">
            ${tutorSide && contested.casts > 0 ? `
            <div class="vs-peak is-headline">
                <div class="vs-peak-label">Out-rolls ${esc(tutorSide.engine.name)}</div>
                <div class="vs-peak-value" style="color:${discoverWins > 0.5 ? 'var(--tx-accent)' : 'var(--tx-mid)'};">${formatPercentage(discoverWins, 1)}</div>
                <div class="vs-peak-sub">of the ${contested.casts} casts both fire on · ${formatPercentage(tutorWins, 1)} to ${esc(tutorSide.engine.name)}${contested.tie > 0.005 ? `, ${formatPercentage(contested.tie, 1)} level` : ''}</div>
            </div>` : ''}
            <div class="vs-peak"><div class="vs-peak-label">Chains 2+ spells</div><div class="vs-peak-value" style="color:var(--tx-accent);">${formatPercentage(chained / runs, 1)}</div><div class="vs-peak-sub">of triggers</div></div>
            <div class="vs-peak"><div class="vs-peak-label">Good turn (top 5%)</div><div class="vs-peak-value" style="color:var(--tx-accent);">${discoverSide.p95}</div><div class="vs-peak-sub">mana off one cast</div></div>
            <div class="vs-peak"><div class="vs-peak-label">Great turn (top 1%)</div><div class="vs-peak-value" style="color:var(--tx-mid);">${percentileFromDist(manaDist, 0.99)}</div><div class="vs-peak-sub">mana, once in a hundred triggers</div></div>
            <div class="vs-peak"><div class="vs-peak-label">Whiffs</div><div class="vs-peak-value" style="color:var(--tx-bad);">${formatPercentage((chainDist[0] || 0) / runs, 1)}</div><div class="vs-peak-sub">find nothing at all</div></div>
        </div>
        <div class="tx-sim-block">
            <div class="tx-sim-block-title">Spells cast per trigger</div>
            ${renderDistributionChart(chainDist, runs, (i) => `${i} spell${i === 1 ? '' : 's'}`, (i) => (i >= 2 ? 'CHAIN' : null), (i) => (i === 0 ? 'bad' : null))}
        </div>
        <div class="tx-sim-block">
            <div class="tx-sim-block-title">Mana cheated per trigger${tutorSide ? ` — ${esc(tutorSide.engine.name)}'s best possible is ${tutorCap}` : ''}</div>
            ${renderDistributionChart(manaDist, runs, (i) => `${i} mana`, (i) => (tutorSide && i === tutorCap ? `${tutorSide.engine.name.toUpperCase()} CAP` : null), (i) => (i === 0 ? 'bad' : (tutorSide && i > tutorCap ? 'warn' : null)))}
        </div>`;
}

function updateTable(cmp) {
    if (!cmp) {
        renderSweepTable('versus-table', { columns: [], rows: [], emptyText: 'Import a decklist to compare creature by creature.' });
        return;
    }
    const nameA = cmp.summary.a.engine.name;
    const nameB = cmp.summary.b.engine.name;

    renderSweepTable('versus-table', {
        columns: [
            { label: 'MV', render: r => r.cmc },
            { label: 'CREATURE', align: 'left', render: r => `<span class="vs-name">${esc(r.name)}</span>` },
            { label: 'P/T', render: r => `<span class="vs-pt">${esc(r.power)}/${esc(r.toughness)}</span>` },
            {
                label: nameA.toUpperCase(),
                render: r => r.a.triggers
                    ? `<span style="color:var(--tx-good);">${formatNumber(r.a.mean, 0)}</span> <span class="vs-detail">${esc(r.a.detail)}</span>`
                    : `<span class="vs-detail">— ${esc(r.a.detail)}</span>`
            },
            {
                label: nameB.toUpperCase(),
                render: r => r.b.triggers
                    ? `<span style="color:var(--tx-accent);">${formatNumber(r.b.mean, 1)}</span> <span class="vs-detail">avg, ${esc(r.b.detail)}</span>`
                    : `<span class="vs-detail">— ${esc(r.b.detail)}</span>`
            },
            {
                // One column rather than two: where both engines fire, the odds
                // already say who wins and by how much, and where only one fires
                // there is no contest to put a percentage on.
                label: 'WINS THE CAST',
                align: 'left',
                render: (r) => {
                    if (r.contested) {
                        const aAhead = r.odds.aWins >= r.odds.bWins;
                        const name = aAhead ? nameA : nameB;
                        const share = aAhead ? r.odds.aWins : r.odds.bWins;
                        return `<span style="color:${aAhead ? 'var(--tx-good)' : 'var(--tx-accent)'};">${esc(name)}</span>`
                            + ` <span class="vs-detail">${formatPercentage(share, 0)} of the time</span>`;
                    }
                    if (r.a.triggers) return `<span style="color:var(--tx-good);">${esc(nameA)}</span> <span class="vs-detail">only it fires</span>`;
                    if (r.b.triggers) return `<span style="color:var(--tx-accent);">${esc(nameB)}</span> <span class="vs-detail">only it fires</span>`;
                    return '<span class="vs-detail">neither fires</span>';
                }
            }
        ],
        rows: cmp.rows,
        emptyText: 'No creatures in this deck.'
    });
}

export function updateUI() {
    const { cmp, verdict: v } = calculate();

    renderScoreboard(cmp, v);
    updateCurveChart(cmp);
    renderPeaks(cmp);
    updateTable(cmp);

    const recEl = document.getElementById('versus-recommendation');
    if (recEl) {
        if (!cmp) {
            recEl.innerHTML = renderRecommendation('Import a decklist to compare two payoff engines across your creature base.');
        } else {
            const { a, b } = cmp.summary;
            const cheap = cmp.curve.filter(p => p.cmc <= 4);
            const big = cmp.curve.filter(p => p.cmc >= 6);
            const cheapA = cheap.length ? cheap.reduce((s, p) => s + p.a * p.count, 0) / cheap.reduce((s, p) => s + p.count, 0) : 0;
            const cheapB = cheap.length ? cheap.reduce((s, p) => s + p.b * p.count, 0) / cheap.reduce((s, p) => s + p.count, 0) : 0;
            const bigA = big.length ? big.reduce((s, p) => s + p.a * p.count, 0) / big.reduce((s, p) => s + p.count, 0) : 0;
            const bigB = big.length ? big.reduce((s, p) => s + p.b * p.count, 0) / big.reduce((s, p) => s + p.count, 0) : 0;

            recEl.innerHTML = renderRecommendation(
                `Early, casting creatures of mana value 4 or less, ${esc(a.engine.name)} gives ${formatNumber(cheapA, 2)} against ${esc(b.engine.name)}'s ${formatNumber(cheapB, 2)}. ` +
                `Late, at mana value 6 and up, it is ${formatNumber(bigA, 2)} against ${formatNumber(bigB, 2)}. ` +
                `${bigB > bigA ? `${esc(b.engine.name)} overtakes on the big end — discover scales with the creature you cast, while a tutor is capped by the best card in the group.` : `${esc(a.engine.name)} holds up at both ends of the curve.`}`
            );
        }
    }

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('versus-creatures-display', cmp ? cmp.creatures : '—');
    setText('versus-lead-display', cmp
        ? (v.leader === 'tie' ? 'Level' : (v.leader === 'a' ? cmp.summary.a.engine.name : cmp.summary.b.engine.name))
        : '—');
}

export function init() {
    // Populate both selectors from the engine registry, so a third engine needs
    // no markup change.
    const options = Object.values(ENGINES)
        .map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    const selA = document.getElementById('versus-engine-a');
    const selB = document.getElementById('versus-engine-b');
    if (selA && !selA.options.length) { selA.innerHTML = options; selA.value = 'wildpair'; }
    if (selB && !selB.options.length) { selB.innerHTML = options; selB.value = 'vortex'; }

    [selA, selB, document.getElementById('versus-star-power')].forEach(el => {
        if (el) el.addEventListener('change', () => updateUI());
    });

    registerCalculator({ name: 'versus', calculate, updateUI, inputs: [] });
}
