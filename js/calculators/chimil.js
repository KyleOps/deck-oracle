/**
 * Chimil, the Inner Sun
 *
 * {6} Legendary Artifact — "Spells you control can't be countered. At the
 * beginning of your end step, discover 5."
 *
 * Discover 5 exiles from the top of your library until it exiles a NONLAND card
 * with mana value 5 or less, casts that card free (or puts it in hand), and puts
 * the rest on the bottom in a random order.
 *
 * Chimil triggers unconditionally at every one of your end steps, so the
 * question is cumulative: how much free mana does it add up to, how soon does
 * that repay its own six mana, and what do the hits actually look like?
 *
 * Two layers answer it:
 *
 *   1. Exact, per end step. In a uniformly random library the FIRST hit is a
 *      uniformly random member of the hit set, so the expected mana value of a
 *      discover is the mean mana value of the eligible cards; the cards passed
 *      over follow a negative hypergeometric distribution with mean
 *      (N - H) / (H + 1).
 *   2. Simulated, per game. Real shuffles of the decklist resolve discover end
 *      step by end step (removing each hit, bottoming the rest), which gives the
 *      spread of whole games, the payback turn, and sample games to read.
 *
 * The simulation runs once per deck at the longest horizon the slider allows;
 * a shorter horizon is just a prefix of the same games, so dragging the slider
 * never re-simulates.
 */

import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable } from '../utils/components.js';
import { buildDeckFromCardData, shuffleDeck, renderDistributionChart } from '../utils/sampleSimulator.js';
import { cardRef } from '../data/glossary.js';
import { describeDots, dotPlot, sampleQuantiles } from '../utils/viz.js';

/** Discover value printed on Chimil. */
export const DISCOVER_N = 5;

/** Chimil's own mana cost — the bar its output has to clear to be worth a slot. */
export const CHIMIL_COST = 6;

/** Default number of end steps with Chimil on the battlefield. */
export const PROJECTION_TURNS = 10;

/** Longest horizon the slider offers; games are simulated to this length once. */
export const MAX_TURNS = 20;

/** Games simulated (once per deck) when the page opens. */
export const AUTO_SIM_GAMES = 2000;

/** A hit at or below this mana value is the "just a mana dork" outcome. */
export const SMALL_HIT_MV = 2;

/** Sample games listed on the page (fewer on a phone, where each one wraps tall). */
const SHOWN_GAMES = 6;
const NARROW_GAMES = 3;

let chart = null;

// ==================== PURE MATH: ONE END STEP (EXACT) ====================

/**
 * Split a library into the three groups discover cares about.
 *
 * @param {Array<{cmc:number, type:string}>} cardDetails - One entry per copy
 * @param {number} lands - Land count (lands are skipped by discover)
 * @param {number} [discoverN=DISCOVER_N] - Mana value ceiling
 * @returns {{hits:number, misses:number, lands:number, total:number, hitCmcs:number[]}}
 */
export function partitionLibrary(cardDetails, lands, discoverN = DISCOVER_N) {
    const details = Array.isArray(cardDetails) ? cardDetails : [];
    const landCount = Math.max(0, Number.isFinite(lands) ? lands : 0);

    const hitCmcs = [];
    let misses = 0;

    for (const card of details) {
        // cardDetails excludes lands already, but guard in case that changes.
        if (card?.type === 'lands') continue;
        const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
        if (cmc <= discoverN) hitCmcs.push(cmc);
        else misses += 1;
    }

    return {
        hits: hitCmcs.length,
        misses,
        lands: landCount,
        total: hitCmcs.length + misses + landCount,
        hitCmcs
    };
}

/**
 * Expected number of cards exiled before the first hit (negative
 * hypergeometric): with H hits among N cards, (N - H) / (H + 1).
 *
 * @param {number} total - Library size N
 * @param {number} hits - Eligible cards H
 * @returns {number} Expected cards passed over (0 when nothing is eligible)
 */
export function expectedCardsDug(total, hits) {
    const N = Number.isFinite(total) ? total : 0;
    const H = Number.isFinite(hits) ? hits : 0;
    if (H <= 0) return 0;
    return (N - H) / (H + 1);
}

/**
 * Expected mana value of the card discover finds: the mean of the eligible set.
 * @param {number[]} hitCmcs
 * @returns {number}
 */
export function expectedHitMV(hitCmcs) {
    if (!Array.isArray(hitCmcs) || hitCmcs.length === 0) return 0;
    const sum = hitCmcs.reduce((a, c) => a + (Number.isFinite(c) ? c : 0), 0);
    return sum / hitCmcs.length;
}

/**
 * Distribution of the discovered card's mana value, as counts indexed by MV.
 * @param {number[]} hitCmcs
 * @param {number} [discoverN=DISCOVER_N]
 * @returns {number[]} counts[mv]
 */
export function hitMVDistribution(hitCmcs, discoverN = DISCOVER_N) {
    const counts = new Array(discoverN + 1).fill(0);
    if (!Array.isArray(hitCmcs)) return counts;
    for (const c of hitCmcs) {
        const mv = Math.round(Number.isFinite(c) ? c : 0);
        if (mv >= 0 && mv <= discoverN) counts[mv] += 1;
    }
    return counts;
}

/**
 * Full per-trigger analysis for one Chimil end step.
 * @param {{cardDetails:Array, lands:number, discoverN?:number}} opts
 * @returns {Object}
 */
export function analyzeTrigger({ cardDetails, lands, discoverN = DISCOVER_N }) {
    const part = partitionLibrary(cardDetails, lands, discoverN);
    const hitRate = part.hits > 0 ? 1 : 0;      // discover only fails on an empty pool
    const avgMV = expectedHitMV(part.hitCmcs);

    return {
        ...part,
        discoverN,
        hitRate,
        avgMV,
        expectedDug: expectedCardsDug(part.total, part.hits),
        expectedFreeMV: hitRate * avgMV,
        eligibleShare: part.total > 0 ? part.hits / part.total : 0,
        distribution: hitMVDistribution(part.hitCmcs, discoverN)
    };
}

/**
 * Project expected cumulative value across successive end steps. Each trigger
 * removes the discovered card, so the eligible pool shrinks by one per turn.
 *
 * @param {Object} trigger - Result of analyzeTrigger
 * @param {number} turns - Number of end steps to project (capped at 30)
 * @returns {Array<{x:number, turn:number, perTurnMV:number, cumulativeMV:number, hitRate:number, poolLeft:number}>}
 */
export function projectTurns(trigger, turns) {
    const rows = [];
    const n = Math.max(0, Math.min(30, Math.floor(Number.isFinite(turns) ? turns : 0)));

    let pool = trigger.hits;
    let cumulative = 0;

    for (let turn = 1; turn <= n; turn++) {
        const rate = pool > 0 ? 1 : 0;
        const gained = rate * trigger.avgMV;
        cumulative += gained;
        rows.push({ x: turn, turn, perTurnMV: gained, cumulativeMV: cumulative, hitRate: rate, poolLeft: pool });
        if (pool > 0) pool -= 1;
    }
    return rows;
}

/**
 * The first end step at which expected free mana has repaid Chimil's {6}.
 * @param {Array<{turn:number, cumulativeMV:number}>} rows - Output of projectTurns
 * @param {number} [cost=CHIMIL_COST]
 * @returns {number|null}
 */
export function paybackTurn(rows, cost = CHIMIL_COST) {
    if (!Array.isArray(rows)) return null;
    for (const r of rows) {
        if (Number.isFinite(r?.cumulativeMV) && r.cumulativeMV >= cost) return r.turn;
    }
    return null;
}

/**
 * Judge whether Chimil fits this deck from how much of the library it can hit,
 * how much each hit is worth, and how fast that repays six mana.
 *
 * @param {Object} trigger - Result of analyzeTrigger
 * @param {number|null} payback - Result of paybackTurn
 * @returns {{tier:string, label:string, tone:'good'|'warn'|'bad', advice:string}}
 */
export function fitVerdict(trigger, payback) {
    const share = trigger?.eligibleShare ?? 0;
    const avgMV = trigger?.avgMV ?? 0;

    if (!trigger || trigger.hits === 0) {
        return {
            tier: 'unplayable', label: 'Unplayable', tone: 'bad',
            advice: 'No nonland card has mana value 5 or less, so discover finds nothing.'
        };
    }
    if (payback !== null && payback <= 2 && share >= 0.28 && avgMV >= 3) {
        return { tier: 'excellent', label: 'Excellent fit', tone: 'good', advice: 'Repays its cost almost immediately and keeps producing.' };
    }
    if (payback !== null && payback <= 3 && share >= 0.20 && avgMV >= 2.4) {
        return { tier: 'good', label: 'Good fit', tone: 'good', advice: 'Pays for itself quickly and adds real value each turn.' };
    }
    if (payback !== null && payback <= 5 && share >= 0.12) {
        return { tier: 'fair', label: 'Fair fit', tone: 'warn', advice: 'Earns its slot if the game goes long, but it is slow to break even.' };
    }
    return {
        tier: 'poor', label: 'Poor fit', tone: 'bad',
        advice: 'Too few spells at mana value 5 or less for it to convert. Add more, or cut it.'
    };
}

// ==================== SIMULATION: WHOLE GAMES ====================

const isLandCard = card => Array.isArray(card?.types) && card.types.includes('land');
const isXSpell = card => /\{X\}/i.test(card?.mana_cost ?? '');

/**
 * Resolve discover once per end step against a library, mutating it. Uses a
 * moving head instead of shift() so each card costs O(1).
 * @returns {Array<{turn:number, dug:number, hit:Object|null, cumulative:number}>}
 */
function playGame(lib, turns, discoverN) {
    const events = [];
    let head = 0;
    let cumulative = 0;

    for (let turn = 1; turn <= turns; turn++) {
        const passed = [];
        let hit = null;

        while (head < lib.length) {
            const card = lib[head++];
            const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
            if (!isLandCard(card) && cmc <= discoverN) { hit = card; break; }
            passed.push(card);
        }

        // Passed-over cards go to the bottom in a random order, as printed.
        for (let i = passed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [passed[i], passed[j]] = [passed[j], passed[i]];
        }
        for (const card of passed) lib.push(card);

        if (hit) cumulative += Number.isFinite(hit.cmc) ? hit.cmc : 0;
        events.push({ turn, dug: passed.length, hit, cumulative });
        if (!hit) break;   // nothing eligible left anywhere in the library
    }
    return events;
}

/**
 * Play out one game's worth of Chimil triggers against a pre-shuffled library.
 * The library passed in is not modified.
 *
 * @param {Array<{name:string, cmc:number, types:string[]}>} library
 * @param {number} turns
 * @param {number} [discoverN=DISCOVER_N]
 * @returns {Array<{turn:number, dug:number, hit:Object|null, cumulative:number}>}
 */
export function simulateGame(library, turns, discoverN = DISCOVER_N) {
    const lib = Array.isArray(library) ? [...library] : [];
    const n = Math.max(0, Math.floor(Number.isFinite(turns) ? turns : 0));
    return playGame(lib, n, discoverN);
}

/**
 * Simulate many games from a deck, each from its own shuffle.
 * @param {Array} deck - buildDeckFromCardData output
 * @param {number} games
 * @param {number} [turns=MAX_TURNS]
 * @returns {Array<Array>} one event list per game
 */
export function simulateGames(deck, games, turns = MAX_TURNS) {
    const base = Array.isArray(deck) ? deck : [];
    const n = Math.max(0, Math.floor(Number.isFinite(games) ? games : 0));
    const out = new Array(n);
    for (let g = 0; g < n; g++) out[g] = playGame(shuffleDeck([...base]), turns, DISCOVER_N);
    return out;
}

/**
 * Cut simulated games down to a shorter horizon. A game simulated for 20 end
 * steps, read to step 8, is exactly a game simulated for 8.
 * @param {Array<Array>} games
 * @param {number} turns
 * @returns {Array<Array>}
 */
export function truncateGames(games, turns) {
    const list = Array.isArray(games) ? games : [];
    const n = Math.max(0, Math.floor(Number.isFinite(turns) ? turns : 0));
    return list.map(g => (g.length <= n ? g : g.slice(0, n)));
}

/** Nearest-rank quantile of an ascending-sorted array (0 when empty). */
export function quantile(sorted, q) {
    if (!Array.isArray(sorted) || sorted.length === 0) return 0;
    const rank = Math.ceil(Math.min(1, Math.max(0, q)) * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const finalOf = g => (g.length ? (g[g.length - 1].cumulative ?? 0) : 0);

/** Cumulative free mana by end step `t`, holding a game that ran dry at its last total. */
function cumulativeAt(g, t) {
    if (!g.length) return 0;
    return g[Math.min(t, g.length) - 1].cumulative ?? 0;
}

/** First end step at which a game has cast at least `cost`, or Infinity. */
function gamePayback(g, cost) {
    for (const e of g) if ((e.cumulative ?? 0) >= cost) return e.turn;
    return Infinity;
}

/**
 * Distribution of total mana cheated across games, bucketed by whole mana value.
 * @param {Array<Array>} games
 * @returns {number[]} counts indexed by total mana cheated
 */
export function cheatedDistribution(games) {
    const list = Array.isArray(games) ? games : [];
    const counts = [];
    for (const g of list) {
        const bucket = Math.max(0, Math.round(finalOf(g)));
        counts[bucket] = (counts[bucket] || 0) + 1;
    }
    for (let i = 0; i < counts.length; i++) if (!counts[i]) counts[i] = 0;
    return counts;
}

/**
 * "Out of 100 games": quantile dots of the total free mana per game, solid
 * once a game has cast at least Chimil's own cost.
 * @param {Array<Array>} games - already cut to the horizon
 * @param {number} [cost=CHIMIL_COST]
 * @returns {Array<{value:number, tone:'good'|'bad'}>}
 */
export function chimilDots(games, cost = CHIMIL_COST) {
    const finals = (Array.isArray(games) ? games : []).map(finalOf);
    return sampleQuantiles(finals, 100).map(value => ({ value, tone: value >= cost ? 'good' : 'bad' }));
}

/**
 * Summarise simulated games into what a player asks: the typical total and its
 * spread (percentiles, never the sampled extremes), how often a hit is a cheap
 * card, and when the typical game has repaid Chimil's cost.
 *
 * @param {Array<Array>} games
 * @param {number} [cost=CHIMIL_COST]
 * @returns {Object}
 */
export function summariseGames(games, cost = CHIMIL_COST) {
    const list = Array.isArray(games) ? games : [];
    let totalHits = 0;
    let hitMV = 0;
    let smallHits = 0;
    for (const g of list) {
        for (const e of g) {
            if (!e.hit) continue;
            const mv = e.hit.cmc ?? 0;
            totalHits += 1;
            hitMV += mv;
            if (mv <= SMALL_HIT_MV) smallHits += 1;
        }
    }

    const finals = list.map(finalOf).sort((a, b) => a - b);
    const paybacks = list.map(g => gamePayback(g, cost)).sort((a, b) => a - b);
    const medianPayback = quantile(paybacks, 0.5);

    return {
        games: list.length,
        totalHits,
        avgHitMV: totalHits ? hitMV / totalHits : 0,
        smallHitRate: totalHits ? smallHits / totalHits : 0,
        avgFinal: list.length ? finals.reduce((a, b) => a + b, 0) / list.length : 0,
        p10: quantile(finals, 0.1),
        p25: quantile(finals, 0.25),
        p50: quantile(finals, 0.5),
        p75: quantile(finals, 0.75),
        p90: quantile(finals, 0.9),
        beatCostRate: list.length ? finals.filter(v => v >= cost).length / list.length : 0,
        medianPayback: Number.isFinite(medianPayback) ? medianPayback : null
    };
}

/**
 * Per-end-step bands across games: typical total, the middle 80%, the average,
 * and the share of games that have repaid Chimil's cost by then.
 *
 * @param {Array<Array>} games
 * @param {number} turns
 * @param {number} [cost=CHIMIL_COST]
 * @returns {Array<{x:number, turn:number, p10:number, p50:number, p90:number, mean:number, repaid:number}>}
 */
export function turnBands(games, turns, cost = CHIMIL_COST) {
    const list = Array.isArray(games) ? games : [];
    const n = Math.max(0, Math.floor(Number.isFinite(turns) ? turns : 0));
    const rows = [];
    for (let t = 1; t <= n; t++) {
        const values = list.map(g => cumulativeAt(g, t)).sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        rows.push({
            x: t,
            turn: t,
            p10: quantile(values, 0.1),
            p50: quantile(values, 0.5),
            p90: quantile(values, 0.9),
            mean: values.length ? sum / values.length : 0,
            repaid: values.length ? values.filter(v => v >= cost).length / values.length : 0
        });
    }
    return rows;
}

const pct = v => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`;
const one = v => (Number.isFinite(v) ? v.toFixed(1) : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The plain-English answer to "what does Chimil discover each end step, and how
 * soon does it pay off?" for this deck.
 *
 * @param {{turns:number, trigger:Object, payback:number|null, fit:Object, sim:Object|null}} result
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(result) {
    const { turns = PROJECTION_TURNS, trigger, payback = null, fit, sim = null } = result ?? {};
    if (!trigger || trigger.hits === 0) {
        return {
            tone: 'bad',
            html: 'Chimil finds nothing in this deck: there are no nonland cards with mana value 5 or less, so every discover runs through your whole library and whiffs.'
        };
    }

    const steps = plural(turns, 'end step');
    const tone = fit?.tone ?? 'flat';
    const repay = sim ? sim.medianPayback : payback;

    let html;
    if (sim && sim.games > 0) {
        const range = sim.p25 === sim.p75 ? '' : ` (half of games ${sim.p25}–${sim.p75})`;
        html = `Over ${steps}, Chimil typically casts <strong>${sim.p50} mana</strong> of free spells${range}, about <strong>${one(trigger.avgMV)}</strong> per end step. `;
    } else {
        html = `Chimil casts about <strong>${one(trigger.avgMV)} mana</strong> of free spells per end step — roughly <strong>${Math.round(trigger.avgMV * turns)}</strong> over ${steps}. `;
    }

    html += repay === null
        ? `The typical game never earns back its own ${CHIMIL_COST} mana within ${steps}.`
        : `It has usually earned back its own ${CHIMIL_COST} mana by <strong>end step ${repay}</strong>.`;

    if (sim && sim.totalHits > 0) {
        html += ` <strong>${pct(sim.smallHitRate)}</strong> of hits are cheap cards (mana value ${SMALL_HIT_MV} or less).`;
    }
    return { html, tone };
}

// ==================== STATE ====================

/** Simulated games for the current deck, at MAX_TURNS. Keyed on the deck object. */
const simState = { deckRef: null, games: null };

/**
 * Read the horizon and the shared deck state.
 * @returns {{turns:number, lands:number, cardDetails:Array, deckSize:number}}
 */
export function getConfig() {
    const deck = DeckConfig.getDeckConfig();
    const slider = document.getElementById('chimil-turnsSlider');
    const raw = parseInt(slider?.value, 10);
    const turns = Math.max(1, Math.min(MAX_TURNS, Number.isFinite(raw) ? raw : PROJECTION_TURNS));

    return {
        turns,
        lands: deck.lands ?? 0,
        cardDetails: Array.isArray(deck.cardDetails) ? deck.cardDetails : [],
        deckSize: DeckConfig.getDeckSize(true)
    };
}

/** Simulate (once per deck) and return the full-length games, or null without a decklist. */
function ensureGames({ force = false } = {}) {
    const cardsByName = DeckConfig.getImportedCardData()?.cardsByName;
    if (!cardsByName || Object.keys(cardsByName).length === 0) {
        simState.deckRef = null;
        simState.games = null;
        return null;
    }
    if (force || simState.deckRef !== cardsByName || !simState.games) {
        const deck = buildDeckFromCardData({ cardsByName });
        simState.games = simulateGames(deck, AUTO_SIM_GAMES, MAX_TURNS);
        simState.deckRef = cardsByName;
    }
    return simState.games;
}

/**
 * Run the analysis for the current deck and horizon.
 * @returns {{config:Object, trigger:Object, rows:Array, payback:number|null, fit:Object, games:Array|null, sim:Object|null, bands:Array}}
 */
export function calculate() {
    const config = getConfig();
    const trigger = analyzeTrigger({ cardDetails: config.cardDetails, lands: config.lands });
    // Project past the horizon so payback is found even when it is late.
    const payback = paybackTurn(projectTurns(trigger, 30));
    const rows = projectTurns(trigger, config.turns);

    const all = ensureGames();
    const games = all ? truncateGames(all, config.turns) : null;
    const sim = games ? summariseGames(games) : null;
    const bands = games ? turnBands(games, config.turns) : [];

    return { config, trigger, rows, payback, fit: fitVerdict(trigger, payback), games, sim, bands };
}

// ==================== RENDERING ====================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderHero(result) {
    const el = document.getElementById('chimil-hero');
    if (!el) return;
    const { config, trigger, sim, payback } = result;
    const repay = sim ? sim.medianPayback : payback;
    const steps = plural(config.turns, 'end step');

    el.innerHTML = renderHeroStats([
        {
            label: 'Each end step',
            value: one(trigger.avgMV),
            sub: 'average mana of the free spell',
            size: 'big',
            color: trigger.hits > 0 ? 'var(--tx-good)' : 'var(--tx-bad)',
            tip: 'The average mana value of the card one discover finds. Exact: every eligible card is equally likely to be the first one hit.'
        },
        {
            label: `Over ${steps}`,
            value: sim ? String(sim.p50) : String(Math.round(trigger.avgMV * config.turns)),
            sub: sim ? (sim.p25 === sim.p75 ? 'mana in a typical game' : `mana · half of games ${sim.p25}–${sim.p75}`) : 'mana on average',
            term: sim ? 'p50' : 'ev'
        },
        {
            label: 'Paid off by end step',
            value: repay === null ? '—' : String(repay),
            sub: repay === null ? `not within ${steps}` : `earns back its ${CHIMIL_COST} mana`,
            color: repay === null ? 'var(--tx-bad)' : repay <= 2 ? 'var(--tx-good)' : repay <= 4 ? 'var(--tx-warn)' : 'var(--tx-bad)',
            tip: `The end step by which the typical game has cast at least ${CHIMIL_COST} mana of free spells — Chimil’s own cost.`
        },
        {
            label: 'Cheap hits',
            value: sim ? pct(sim.smallHitRate) : '—',
            sub: `free spells of mana value ${SMALL_HIT_MV} or less`,
            color: sim && sim.smallHitRate > 0.4 ? 'var(--tx-warn)' : 'var(--tx-bright)',
            tip: 'The hits that feel like a waste off a six-mana artifact: a mana dork or a cantrip.'
        }
    ]);
}

function renderRail(result) {
    const { config, trigger } = result;
    setText('chimil-turns-display', String(config.turns));
    setText('chimil-pool-display', `${trigger.hits} of ${trigger.total}`);
    setText('chimil-share-display', pct(trigger.eligibleShare));
    setText('chimil-dug-display', trigger.hits > 0 ? one(trigger.expectedDug) : '—');
}

function updateChart(bands) {
    const meta = document.getElementById('chimil-chart-meta');
    if (meta) meta.textContent = bands.length ? `${AUTO_SIM_GAMES.toLocaleString('en-US')} simulated games` : '';
    if (!document.getElementById('chimil-chart')) return;
    if (!bands.length) {
        if (chart) { chart.destroy(); chart = null; }
        return;
    }

    chart = createOrUpdateChart(chart, 'chimil-chart', {
        type: 'line',
        data: {
            labels: bands.map(r => String(r.turn)),
            datasets: [
                {
                    label: '8 games in 10',
                    data: bands.map(r => r.p90),
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    backgroundColor: TX.greenFill,
                    fill: '+1',
                    tension: 0
                },
                {
                    label: 'low',
                    data: bands.map(r => r.p10),
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: 'Typical game',
                    data: bands.map(r => r.p50),
                    borderColor: TX.green,
                    backgroundColor: TX.green,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: false,
                    tension: 0
                },
                {
                    label: `Chimil’s cost (${CHIMIL_COST})`,
                    data: bands.map(() => CHIMIL_COST),
                    borderColor: TX.mid,
                    borderWidth: 1,
                    borderDash: [5, 4],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            plugins: {
                tooltip: {
                    filter: item => item.datasetIndex !== 1,
                    callbacks: {
                        title: items => `End step ${items[0]?.label ?? ''}`,
                        label: (ctx) => {
                            const row = bands[ctx.dataIndex];
                            if (!row) return '';
                            if (ctx.datasetIndex === 0) return ` 8 games in 10: ${row.p10}–${row.p90} mana`;
                            if (ctx.datasetIndex === 2) return ` Typical game: ${row.p50} mana`;
                            return ` Repaid ${CHIMIL_COST} mana: ${pct(row.repaid)} of games`;
                        }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'End steps with Chimil out', color: TX.dim } },
                y: { beginAtZero: true, title: { display: true, text: 'Free mana cast, total', color: TX.dim } }
            }
        }
    });
}

function renderSamples(games, turns) {
    const display = document.getElementById('chimil-reveals-display');
    if (!display) return;
    if (!games) {
        display.innerHTML = '<div class="tx-empty">Import a decklist to see sample games.</div>';
        return;
    }

    const rows = games.slice(0, SHOWN_GAMES).map((g, i) => {
        const total = finalOf(g);
        const chips = g.map(e => {
            if (!e.hit) return `<li class="ch-hit is-miss"><span class="ch-hit-step">${e.turn}</span>nothing left</li>`;
            const mv = Number.isFinite(e.hit.cmc) ? e.hit.cmc : 0;
            const small = mv <= SMALL_HIT_MV;
            // Cast free, an X spell resolves with X = 0 — usually close to nothing.
            const xTag = isXSpell(e.hit) ? '<span class="ch-hit-x" data-tip="Cast free, an X spell resolves with X = 0." tabindex="0">X=0</span>' : '';
            return `<li class="ch-hit${small ? ' is-small' : ''}"><span class="ch-hit-step">${e.turn}</span>${cardRef(e.hit.name)}${xTag}<span class="ch-hit-mv">${mv}</span></li>`;
        }).join('');
        return `
            <div class="ch-game">
                <div class="ch-game-head">
                    <span>Game ${i + 1}</span>
                    <span class="ch-game-total ${total >= CHIMIL_COST ? 'is-good' : 'is-bad'}">${total} mana</span>
                </div>
                <ol class="ch-game-hits">${chips}</ol>
            </div>`;
    }).join('');

    display.innerHTML = `
        <p class="ch-caption">Each chip is one end step: the step number, the card discover cast, and its mana value. <span class="ch-key-small">Amber</span> chips are cheap hits (mana value ${SMALL_HIT_MV} or less); X spells cast free resolve with X&nbsp;=&nbsp;0.</p>
        <div class="ch-games">${rows}</div>
        <p class="ch-caption ch-caption-foot"><span class="ch-shown-wide">${SHOWN_GAMES}</span><span class="ch-shown-narrow">${NARROW_GAMES}</span> of ${AUTO_SIM_GAMES.toLocaleString('en-US')} simulated games, ${plural(turns, 'end step')} each.</p>`;
}

function renderDetails(result) {
    const { config, trigger, bands, games } = result;

    renderSweepTable('chimil-sweepTable', {
        columns: [
            { label: 'End step', align: 'left', render: r => String(r.turn) },
            { label: 'Typical total', render: r => `<strong>${r.p50}</strong>` },
            { label: '8 games in 10', render: r => (r.p10 === r.p90 ? String(r.p50) : `${r.p10}–${r.p90}`) },
            { label: 'Average', render: r => one(r.mean) },
            { label: `Repaid ${CHIMIL_COST} mana`, render: r => `<span class="${r.repaid >= 0.5 ? 'ch-good' : 'ch-dim'}">${pct(r.repaid)}</span>` }
        ],
        rows: bands,
        current: config.turns,
        recommended: result.sim?.medianPayback ?? null,
        emptyText: 'Import a decklist to simulate games.'
    });

    const findsEl = document.getElementById('chimil-distribution');
    if (findsEl) {
        findsEl.innerHTML = trigger.hits > 0 ? `
            <dl class="ch-facts ch-facts-row">
                <div><dt>Cards discover can hit</dt><dd>${trigger.hits}</dd></div>
                <div><dt>Skipped: lands</dt><dd>${trigger.lands}</dd></div>
                <div><dt>Skipped: mana value 6+</dt><dd>${trigger.misses}</dd></div>
                <div><dt>Cards skipped per discover</dt><dd>${one(trigger.expectedDug)}</dd></div>
            </dl>
            <p class="ch-caption">Mana value of the card one discover finds — every eligible card is equally likely, so this is your eligible cards by mana value.</p>
            ${renderDistributionChart(trigger.distribution, trigger.hits, i => `Mana value ${i}`, () => null, i => (i <= SMALL_HIT_MV ? 'warn' : null))}`
            : '<div class="tx-empty">No nonland cards with mana value 5 or less.</div>';
    }
}

const DOT_LEGEND = Object.freeze([
    { tone: 'good', label: `paid back its ${CHIMIL_COST} mana` },
    { tone: 'bad', label: 'never did' }
]);

/** "Out of 100 games" at the chosen horizon. */
function renderDots(result) {
    const el = document.getElementById('chimil-dots');
    const title = document.getElementById('chimil-dots-title');
    const { config, games } = result;
    if (title) title.textContent = `Out of 100 games, over ${plural(config.turns, 'end step')}`;
    if (!el) return;
    if (!games || games.length === 0) {
        el.innerHTML = '<div class="tx-empty">Import a decklist to simulate games.</div>';
        return;
    }
    const dots = chimilDots(games);
    const counts = cheatedDistribution(games);
    const rows = [];
    let atLeast = 1;
    counts.forEach((n, total) => {
        if (n > 0) rows.push([`${total} mana`, pct(n / games.length), pct(atLeast)]);
        atLeast -= n / games.length;
    });
    el.innerHTML = dotPlot({
        dots,
        label: `Total free mana Chimil casts over ${plural(config.turns, 'end step')}, out of 100 games. ${describeDots(dots, { format: v => `${v} mana`, legend: DOT_LEGEND })}`,
        unit: 'game',
        format: v => String(v),
        xLabel: `Free mana cast over ${plural(config.turns, 'end step')}`,
        threshold: CHIMIL_COST,
        thresholdLabel: `${CHIMIL_COST}+ paid back`,
        legend: DOT_LEGEND,
        maxColumns: 30,
        table: {
            summary: `All ${games.length.toLocaleString('en-US')} games`,
            caption: 'Share of simulated games by total free mana',
            head: ['Total', 'Games', 'At least this'],
            rows
        }
    });
}

export function updateUI() {
    const result = calculate();
    renderRail(result);

    const bottom = document.getElementById('chimil-bottom-line');
    if (bottom) bottom.innerHTML = renderBottomLine(summarize({ ...result, turns: result.config.turns }));
    renderHero(result);
    updateChart(result.bands);
    renderDots(result);
    renderSamples(result.games, result.config.turns);
    renderDetails(result);
}

/** Reshuffle: simulate a fresh set of games for the same deck. */
export function runSampleReveals() {
    ensureGames({ force: true });
    updateUI();
}

export function init() {
    const { updateUI: debouncedUpdate } = registerCalculator({ name: 'chimil', calculate, updateUI });

    const slider = document.getElementById('chimil-turnsSlider');
    slider?.addEventListener('input', () => {
        // The readout follows the thumb immediately; the page re-renders on the
        // debounce (no re-simulation — shorter horizons are prefixes).
        setText('chimil-turns-display', slider.value);
        debouncedUpdate();
    });

    document.getElementById('chimil-draw-reveals-btn')?.addEventListener('click', () => {
        if (isCalculatorActive('chimil')) runSampleReveals();
    });
}
