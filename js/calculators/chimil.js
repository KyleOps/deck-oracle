/**
 * Chimil, the Inner Sun Calculator
 *
 * {6} Legendary Artifact — "Spells you control can't be countered. At the
 * beginning of your end step, discover 5."
 *
 * Discover 5 exiles from the top of your library until it exiles a NONLAND card
 * with mana value 5 or less, casts that card free (or puts it in hand), and puts
 * the rest on the bottom in a random order.
 *
 * Unlike Monstrous Vortex — which also discovers, but only when you cast a
 * qualifying creature — Chimil triggers unconditionally at every one of your end
 * steps. That makes the interesting question cumulative rather than conditional:
 * not "will it trigger?" but "how much mana does it cheat over a game, and what
 * does it hit?"
 *
 * The math here is exact, not simulated. Two observations make that possible:
 *
 *   1. In a uniformly random library, the FIRST hit encountered is a uniformly
 *      random member of the hit set. So the expected mana value of the discovered
 *      card is simply the mean mana value of all eligible cards — no ordering
 *      needs to be simulated.
 *
 *   2. The number of cards passed over before the first hit follows a negative
 *      hypergeometric distribution, whose mean is (N - H) / (H + 1) for H hits
 *      among N cards.
 *
 * Both are closed form, so results are instant and free of Monte Carlo noise.
 */

import { formatNumber, formatPercentage } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import {
    renderHeroStats, renderRecommendation,
    renderSweepTable, renderSimulationSummary, generateSampleRevealsHTML
} from '../utils/components.js';
import { formatDelta, deltaColor } from '../utils/analysis.js';
import {
    buildDeckFromCardData, shuffleDeck, createCollapsibleSection
} from '../utils/sampleSimulator.js';

/** Discover value printed on Chimil. */
export const DISCOVER_N = 5;

/** Chimil's own mana cost — the bar its output has to clear to be worth a slot. */
export const CHIMIL_COST = 6;

/** Default number of end steps with Chimil on the battlefield.
 *
 *  Note this is a real control now, not the cosmetic one it replaced. The
 *  closed-form projection is linear in turns, so dragging a horizon over *that*
 *  only stretched a straight line. Simulated games are different: more end steps
 *  means more draws from the hit distribution, a wider spread of outcomes, and a
 *  real chance of the eligible pool running dry — so the answer genuinely
 *  changes with the horizon. */
export const PROJECTION_TURNS = 10;

/** Games to simulate automatically when the calculator is opened. */
export const AUTO_SIM_GAMES = 500;

/** A hit at or below this mana value is the "just a mana dork" outcome. */
export const SMALL_HIT_MV = 2;

let chart = null;

// ==================== PURE MATH ====================

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
 * Expected number of cards exiled before the first hit.
 *
 * Negative hypergeometric: with H hits among N cards in random order, the
 * expected number of non-hits preceding the first hit is (N - H) / (H + 1).
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
 * Expected mana value of the card discover finds.
 *
 * The first eligible card in a random permutation is a uniformly random member
 * of the eligible set, so this is just their mean mana value.
 *
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
 *
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
 *
 * @param {Object} opts
 * @param {Array} opts.cardDetails
 * @param {number} opts.lands
 * @param {number} [opts.discoverN=DISCOVER_N]
 * @returns {Object} stats
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
        // Value cheated per trigger. With a non-empty pool discover always finds
        // something, so this is simply the mean eligible mana value.
        expectedFreeMV: hitRate * avgMV,
        eligibleShare: part.total > 0 ? part.hits / part.total : 0,
        distribution: hitMVDistribution(part.hitCmcs, discoverN)
    };
}

/**
 * Project cumulative value across successive end steps.
 *
 * Each trigger removes one card from the library (the discovered card) and
 * rotates the passed-over cards to the bottom, so the eligible pool shrinks
 * slowly. Modelling that depletion matters over a long game: assuming a constant
 * per-turn rate overstates a deck with a thin eligible pool.
 *
 * @param {Object} trigger - Result of analyzeTrigger
 * @param {number} turns - Number of end steps to project
 * @returns {Array<{turn:number, perTurnMV:number, cumulativeMV:number, hits:number, poolLeft:number}>}
 */
export function projectTurns(trigger, turns) {
    const rows = [];
    const n = Math.max(0, Math.min(30, Math.floor(Number.isFinite(turns) ? turns : 0)));

    let pool = trigger.hits;
    let total = trigger.total;
    let cumulative = 0;

    for (let turn = 1; turn <= n; turn++) {
        const rate = pool > 0 ? 1 : 0;
        const gained = rate * trigger.avgMV;
        cumulative += gained;
        rows.push({
            x: turn,
            turn,
            perTurnMV: gained,
            cumulativeMV: cumulative,
            hitRate: rate,
            poolLeft: pool
        });
        // The discovered card leaves the library; the rest go to the bottom.
        if (pool > 0) { pool -= 1; total -= 1; }
    }
    return rows;
}

/**
 * The first end step at which accumulated free mana value has repaid Chimil's
 * own {6} cost.
 *
 * This is the question that actually decides whether the card earns a slot:
 * spending six mana to do nothing on the turn it lands is only worth it if the
 * board pays it back quickly. Reported in whole turns because that is how the
 * decision gets made.
 *
 * @param {Array<{turn:number, cumulativeMV:number}>} rows - Output of projectTurns
 * @param {number} [cost=CHIMIL_COST]
 * @returns {number|null} Turn number, or null if never repaid within the projection
 */
export function paybackTurn(rows, cost = CHIMIL_COST) {
    if (!Array.isArray(rows)) return null;
    for (const r of rows) {
        if (Number.isFinite(r?.cumulativeMV) && r.cumulativeMV >= cost) return r.turn;
    }
    return null;
}

/**
 * Judge whether Chimil is a good fit for this specific deck.
 *
 * Three things decide it, and they trade off against each other:
 *   - how often discover finds anything worth casting (eligible share),
 *   - how much it is worth when it does (average hit mana value),
 *   - how fast that repays the six mana Chimil costs (payback turn).
 *
 * A deck can fail on any one of them: an all-cheap deck hits constantly but for
 * little, a top-heavy deck hits big but rarely and digs half the library to do
 * it, and a deck with no eligible cards at all does nothing.
 *
 * @param {Object} trigger - Result of analyzeTrigger
 * @param {number|null} payback - Result of paybackTurn
 * @returns {{tier:string, label:string, color:string, advice:string}}
 */
export function fitVerdict(trigger, payback) {
    const share = trigger?.eligibleShare ?? 0;
    const avgMV = trigger?.avgMV ?? 0;

    if (!trigger || trigger.hits === 0) {
        return {
            tier: 'unplayable', label: 'UNPLAYABLE', color: 'var(--tx-bad)',
            advice: 'No nonland card has mana value 5 or less, so discover finds nothing and exiles your library.'
        };
    }
    if (payback !== null && payback <= 2 && share >= 0.28 && avgMV >= 3) {
        return {
            tier: 'excellent', label: 'EXCELLENT FIT', color: 'var(--tx-good)',
            advice: 'Repays its cost almost immediately and keeps producing. An easy include.'
        };
    }
    if (payback !== null && payback <= 3 && share >= 0.20 && avgMV >= 2.4) {
        return {
            tier: 'good', label: 'GOOD FIT', color: 'var(--tx-good)',
            advice: 'Pays for itself quickly and generates real value each turn.'
        };
    }
    if (payback !== null && payback <= 5 && share >= 0.12) {
        return {
            tier: 'fair', label: 'FAIR FIT', color: 'var(--tx-accent)',
            advice: 'Earns its slot if the game goes long, but it is slow to break even.'
        };
    }
    return {
        tier: 'poor', label: 'POOR FIT', color: 'var(--tx-bad)',
        advice: 'Too few cheap spells to convert. Add more nonlands at mana value 5 or less, or cut it.'
    };
}

/**
 * Play out one game's worth of Chimil triggers against a real shuffled library.
 *
 * Averages hide the thing players actually feel. "3.7 mana per end step" sounds
 * strong, but the lived sequence might be a two-drop then a three-drop — which
 * is a very different card from one that flips a bomb. This walks the library
 * exactly as discover does, so the per-turn results can be shown as they happen.
 *
 * @param {Array<{name:string, cmc:number, types:string[]}>} library - Pre-shuffled
 * @param {number} turns
 * @param {number} [discoverN=DISCOVER_N]
 * @returns {Array<{turn:number, dug:number, hit:Object|null, cumulative:number}>}
 */
export function simulateGame(library, turns, discoverN = DISCOVER_N) {
    const lib = Array.isArray(library) ? [...library] : [];
    const events = [];
    let cumulative = 0;
    const n = Math.max(0, Math.floor(Number.isFinite(turns) ? turns : 0));

    for (let turn = 1; turn <= n; turn++) {
        const passed = [];
        let hit = null;

        while (lib.length > 0) {
            const card = lib.shift();
            const isLand = Array.isArray(card?.types) && card.types.includes('land');
            const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
            if (!isLand && cmc <= discoverN) { hit = card; break; }
            passed.push(card);
        }

        // Passed-over cards go to the bottom in a random order, as printed.
        for (let i = passed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [passed[i], passed[j]] = [passed[j], passed[i]];
        }
        lib.push(...passed);

        if (hit) cumulative += Number.isFinite(hit.cmc) ? hit.cmc : 0;
        events.push({ turn, dug: passed.length, hit, cumulative });
        if (!hit) break;   // nothing eligible left anywhere in the library
    }
    return events;
}

/**
 * Summarise a set of simulated games into the numbers a player actually asks
 * about: how often the hit was a cheap creature, and how the total compares to
 * simply casting a good six-drop instead.
 *
 * @param {Array<Array>} games - Output of simulateGame per game
 * @param {number} [cost=CHIMIL_COST]
 * @returns {Object}
 */
/**
 * Distribution of total mana cheated across simulated games, bucketed by whole
 * mana value. The average alone says nothing about spread — two decks can share
 * a mean while one is reliable and the other swings between whiffing and
 * cheating out half a game's worth of mana.
 *
 * @param {Array<Array>} games
 * @returns {number[]} counts indexed by total mana cheated
 */
export function cheatedDistribution(games) {
    const list = Array.isArray(games) ? games : [];
    const counts = [];
    for (const g of list) {
        const final = g.length ? (g[g.length - 1].cumulative ?? 0) : 0;
        const bucket = Math.max(0, Math.round(final));
        counts[bucket] = (counts[bucket] || 0) + 1;
    }
    for (let i = 0; i < counts.length; i++) if (!counts[i]) counts[i] = 0;
    return counts;
}

export function summariseGames(games, cost = CHIMIL_COST) {
    const list = Array.isArray(games) ? games : [];
    const hits = list.flat().filter(e => e.hit);
    const totalHits = hits.length;

    const smallHits = hits.filter(e => (e.hit.cmc ?? 0) <= SMALL_HIT_MV).length;
    const finals = list.map(g => (g.length ? g[g.length - 1].cumulative : 0));
    const beatCost = finals.filter(v => v >= cost).length;

    return {
        games: list.length,
        totalHits,
        avgHitMV: totalHits ? hits.reduce((a, e) => a + (e.hit.cmc ?? 0), 0) / totalHits : 0,
        smallHitRate: totalHits ? smallHits / totalHits : 0,
        avgFinal: list.length ? finals.reduce((a, b) => a + b, 0) / list.length : 0,
        bestFinal: finals.length ? Math.max(...finals) : 0,
        worstFinal: finals.length ? Math.min(...finals) : 0,
        beatCostRate: list.length ? beatCost / list.length : 0
    };
}

// ==================== CONFIG ====================

/**
 * Read the calculator's inputs and the shared deck state.
 * @returns {Object}
 */
export function getConfig() {
    const deck = DeckConfig.getDeckConfig();
    const turnsEl = document.getElementById('chimil-turnsValue');
    const turns = Math.max(1, Math.min(20, parseInt(turnsEl?.value, 10) || PROJECTION_TURNS));

    return {
        turns,
        lands: deck.lands ?? 0,
        cardDetails: Array.isArray(deck.cardDetails) ? deck.cardDetails : [],
        deckSize: DeckConfig.getDeckSize(true)
    };
}

/**
 * Run the analysis for the current config.
 * @returns {{config:Object, trigger:Object, rows:Array}}
 */
export function calculate() {
    const config = getConfig();
    const trigger = analyzeTrigger({ cardDetails: config.cardDetails, lands: config.lands });
    // Project past the display horizon so payback is found even if it is late.
    const payback = paybackTurn(projectTurns(trigger, 30));
    const rows = projectTurns(trigger, config.turns);
    return { config, trigger, rows, payback, fit: fitVerdict(trigger, payback) };
}

// ==================== UI ====================

function updateChart(rows) {
    if (!document.getElementById('chimil-chart')) return;

    chart = createOrUpdateChart(chart, 'chimil-chart', {
        type: 'line',
        data: {
            labels: rows.map(r => `T${r.turn}`),
            datasets: [
                {
                    label: 'Cumulative free mana value',
                    data: rows.map(r => r.cumulativeMV),
                    borderColor: TX.green,
                    backgroundColor: TX.greenFill,
                    borderWidth: 2,
                    fill: true,
                    tension: 0,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Per-turn free mana value',
                    data: rows.map(r => r.perTurnMV),
                    borderColor: TX.accent || TX.amber,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderDash: [4, 3],
                    fill: false,
                    tension: 0,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    yAxisID: 'yPer'
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
                    title: { display: true, text: 'Cumulative MV', color: TX.dim, font: { size: 9 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, font: { size: 9 } }
                },
                yPer: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Per turn', color: TX.dim, font: { size: 9 } },
                    grid: { display: false },
                    ticks: { color: TX.dim, font: { size: 9 } }
                },
                x: { grid: { color: TX.rule }, ticks: { color: TX.dim, font: { size: 9 } } }
            }
        }
    });
}

function updateSweep(rows, turns, payback) {
    renderSweepTable('chimil-sweepTable', {
        columns: [
            { label: 'TURN', align: 'left', render: r => `T${r.turn}` },
            { label: 'PER TURN', render: r => formatNumber(r.perTurnMV, 2) },
            { label: 'CUMULATIVE', render: r => `<strong style="color:var(--tx-good);">${formatNumber(r.cumulativeMV, 1)}</strong>` },
            {
                label: 'Δ VS PREV',
                render: (r, ctx) => {
                    const prev = rows[rows.indexOf(r) - 1];
                    if (!prev) return '<span style="color:var(--tx-dim);">—</span>';
                    const d = r.cumulativeMV - prev.cumulativeMV;
                    return `<span style="color:${deltaColor(d, 0.001)};">${formatDelta(d, 2)}</span>`;
                }
            },
            { label: 'POOL LEFT', render: r => r.poolLeft }
        ],
        rows,
        current: turns,
        recommended: payback ?? null,
        emptyText: 'Import a deck to project Chimil\'s output.'
    });
}

export function updateUI() {
    const { config, trigger, rows, payback, fit } = calculate();
    const last = rows[rows.length - 1];

    // Headline numbers
    const heroEl = document.getElementById('chimil-hero');
    if (heroEl) {
        heroEl.innerHTML = renderHeroStats([
            {
                label: 'FREE MV / TURN',
                value: formatNumber(trigger.expectedFreeMV, 2),
                sub: 'mana cheated each end step',
                size: 'big',
                color: 'var(--tx-good)'
            },
            {
                label: `OVER ${PROJECTION_TURNS} TURNS`,
                value: formatNumber(last ? last.cumulativeMV : 0, 1),
                sub: 'total mana value',
                color: 'var(--tx-accent)'
            },
            {
                label: 'PAYS FOR ITSELF',
                value: payback === null ? '—' : `T${payback}`,
                sub: payback === null ? `never repays {${CHIMIL_COST}}` : `end steps to repay {${CHIMIL_COST}}`,
                color: payback === null ? 'var(--tx-bad)'
                     : payback <= 2 ? 'var(--tx-good)'
                     : payback <= 4 ? 'var(--tx-accent)' : 'var(--tx-bad)'
            },
            {
                label: 'CARDS DUG',
                value: formatNumber(trigger.expectedDug, 1),
                sub: 'passed over per trigger',
                color: 'var(--tx-mid)'
            },
            {
                // No verdict badge here: probabilityVerdict's tiers answer "how
                // often does this happen", which is not what an eligible-library
                // share means. 41% eligible is healthy for Chimil but would read
                // as WEAK on that scale. The fit verdict below is the judgement.
                label: 'ELIGIBLE POOL',
                value: `${trigger.hits}`,
                sub: `${formatPercentage(trigger.eligibleShare, 0)} of library, MV ≤ ${trigger.discoverN}`,
                color: 'var(--tx-mid)'
            }
        ]);
    }

    // Verdict first: is this card worth a slot in THIS deck?
    const fitEl = document.getElementById('chimil-fit');
    if (fitEl) {
        const paybackText = payback === null
            ? `it never repays its own {${CHIMIL_COST}} within 30 turns`
            : `it repays its own {${CHIMIL_COST}} by <strong>turn ${payback}</strong>`;
        fitEl.innerHTML = `
            <div class="chimil-fit">
                <div class="chimil-fit-badge" style="color:${fit.color}; border-color:${fit.color};">${fit.label}</div>
                <div class="chimil-fit-body">
                    <div class="chimil-fit-advice">${fit.advice}</div>
                    <div class="chimil-fit-detail">At ${formatNumber(trigger.expectedFreeMV, 2)} mana per end step, ${paybackText}.</div>
                    <div class="chimil-fit-caveat">This counts mana cheated, not board impact. Chimil does nothing the turn it lands, and a six-drop that affects the board immediately can be worth more than the raw mana here suggests — check the sample games for what the hits actually look like.</div>
                </div>
            </div>`;
    }

    // Plain-English read
    const recEl = document.getElementById('chimil-recommendation');
    if (recEl) {
        let text;
        if (trigger.hits === 0) {
            text = 'No nonland cards with mana value 5 or less — Chimil would exile your whole library and find nothing. Add cheap spells before running it.';
        } else {
            const perTurn = formatNumber(trigger.expectedFreeMV, 2);
            const share = formatPercentage(trigger.eligibleShare, 0);
            text = `Chimil cheats <strong>${perTurn} mana</strong> every end step. ${trigger.hits} of your ${trigger.total} library cards are eligible (${share}), so it digs about ${formatNumber(trigger.expectedDug, 1)} cards to find one. Cards with mana value 6+ are passed over — a top-heavy deck raises the dig but not the payoff.`;
        }
        recEl.innerHTML = renderRecommendation(text);
    }

    // Distribution of what it actually finds
    const distEl = document.getElementById('chimil-distribution');
    if (distEl) {
        distEl.innerHTML = trigger.hits > 0
            ? renderSimulationSummary({
                title: 'What Chimil finds',
                metrics: [
                    { label: 'Avg hit MV', value: formatNumber(trigger.avgMV, 2), sub: 'mana value discovered', color: 'var(--tx-good)' },
                    { label: 'Eligible', value: trigger.hits, sub: `MV ≤ ${trigger.discoverN}, nonland`, color: 'var(--tx-accent)' },
                    { label: 'Passed over', value: trigger.misses + trigger.lands, sub: `${trigger.lands} lands + ${trigger.misses} MV 6+`, color: 'var(--tx-mid)' }
                ],
                distribution: {
                    title: `Discovered card mana value (${trigger.hits} eligible cards)`,
                    counts: trigger.distribution,
                    totalSims: trigger.hits,
                    labelFn: (i) => `MV ${i}`,
                    markerFn: (i) => (i === trigger.discoverN ? 'MAX' : null)
                }
            })
            : '<div class="tx-empty">Import a deck with nonland cards of mana value 5 or less.</div>';
    }

    updateChart(rows);
    updateSweep(rows, config.turns, payback);

    // Left-rail readout
    const poolPct = document.getElementById('chimil-share-display');
    if (poolPct) poolPct.textContent = formatPercentage(trigger.eligibleShare, 0);
    const turnsOut = document.getElementById('chimil-turns-display');
    if (turnsOut) turnsOut.textContent = config.turns;

    maybeAutoRun(config);
    const poolEl = document.getElementById('chimil-pool-display');
    if (poolEl) poolEl.textContent = `${trigger.hits} / ${trigger.total}`;
}

/**
 * Run and render sample games. Each row is one game's actual sequence of
 * discovers, so a player can see the shape of a real game rather than only its
 * mean — the difference between "3.7 mana a turn" and "a two-drop, then a
 * three-drop" is the whole question.
 */
let lastSimKey = '';

/**
 * Simulate automatically when the calculator is opened with a deck loaded, so
 * the sample games are there to read rather than behind a button press. Keyed on
 * deck and horizon so switching tabs does not re-run the same simulation.
 */
function maybeAutoRun(config) {
    const cardData = DeckConfig.getImportedCardData();
    const names = Object.keys(cardData?.cardsByName || {});
    if (names.length === 0) return;

    const key = `${names.length}-${config.turns}-${config.lands}`;
    if (key === lastSimKey) return;
    lastSimKey = key;
    runSampleReveals();
}

export function runSampleReveals() {
    const display = document.getElementById('chimil-reveals-display');
    if (!display) return;

    const cardData = DeckConfig.getImportedCardData();
    if (!cardData?.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        display.innerHTML = '<div class="tx-empty">Import a decklist to simulate games.</div>';
        return;
    }

    const countEl = document.getElementById('chimil-sample-count');
    const games = Math.max(1, Math.min(5000, parseInt(countEl?.value, 10) || AUTO_SIM_GAMES));
    const shown = Math.min(games, 8);
    const turns = getConfig().turns;

    const base = buildDeckFromCardData(cardData);
    const played = [];
    for (let g = 0; g < games; g++) {
        played.push(simulateGame(shuffleDeck([...base]), turns));
    }
    const summary = summariseGames(played);

    // Headline: the "is this actually good" read, from played games not formulas.
    const summaryHTML = renderSimulationSummary({
        title: `${games.toLocaleString('en-US')} simulated games · ${turns} end step${turns === 1 ? '' : 's'} each`,
        runs: games,
        distribution: {
            title: `Total mana cheated per game, over ${turns} end step${turns === 1 ? '' : 's'}`,
            counts: cheatedDistribution(played),
            totalSims: games,
            labelFn: (i) => `${i} mana`,
            markerFn: (i) => (i === Math.round(summary.avgFinal) ? 'AVG' : (i === CHIMIL_COST ? `= {${CHIMIL_COST}} COST` : null)),
            toneFn: (i) => (i < CHIMIL_COST ? 'bad' : null)
        },
        metrics: [
            { label: 'Avg total cheated', value: formatNumber(summary.avgFinal, 1), sub: `over ${turns} turn${turns === 1 ? '' : 's'}`, color: 'var(--tx-good)' },
            { label: 'Hits of MV ≤ 2', value: formatPercentage(summary.smallHitRate, 0), sub: 'the "just a mana dork" outcome', color: summary.smallHitRate > 0.4 ? 'var(--tx-bad)' : 'var(--tx-mid)' },
            { label: `Beat its own {${CHIMIL_COST}}`, value: formatPercentage(summary.beatCostRate, 0), sub: 'of games', color: summary.beatCostRate > 0.9 ? 'var(--tx-good)' : 'var(--tx-accent)' },
            { label: 'Range', value: `${formatNumber(summary.worstFinal, 0)}–${formatNumber(summary.bestFinal, 0)}`, sub: 'worst to best game', color: 'var(--tx-mid)' }
        ]
    });

    // Individual games, so the sequence is visible.
    let listHTML = '';
    for (let i = 0; i < shown; i++) {
        const g = played[i];
        const final = g.length ? g[g.length - 1].cumulative : 0;
        const chips = g.map(e => {
            if (!e.hit) return `<span class="chimil-hit is-miss" title="No eligible card left">T${e.turn}: nothing</span>`;
            const mv = Number.isFinite(e.hit.cmc) ? e.hit.cmc : 0;
            const cls = mv <= SMALL_HIT_MV ? ' is-small' : '';
            return `<span class="chimil-hit${cls}" title="Turn ${e.turn} · dug ${e.dug} card${e.dug === 1 ? '' : 's'}">
                        <span class="chimil-hit-turn">T${e.turn}</span>
                        <span class="chimil-hit-name">${e.hit.name}</span>
                        <span class="chimil-hit-mv">${mv}</span>
                    </span>`;
        }).join('');
        listHTML += `
            <div class="chimil-game">
                <div class="chimil-game-head">
                    <span>Game ${i + 1}</span>
                    <span class="chimil-game-total" style="color:${final >= CHIMIL_COST ? 'var(--tx-good)' : 'var(--tx-bad)'};">
                        ${formatNumber(final, 0)} mana cheated
                    </span>
                </div>
                <div class="chimil-game-chips">${chips}</div>
            </div>`;
    }

    display.innerHTML = summaryHTML + createCollapsibleSection(
        `Show/hide individual games (${shown} of ${games.toLocaleString('en-US')})`,
        listHTML,
        true
    );
}

export function init() {
    const sampleSection = document.getElementById('chimil-sample-reveals');
    if (sampleSection) {
        sampleSection.innerHTML = generateSampleRevealsHTML('chimil', 'Sample games', { requiresImport: false });
    }

    registerCalculator({
        name: 'chimil',
        calculate,
        updateUI,
        inputs: ['turns']
    });

    const btn = document.getElementById('chimil-draw-reveals-btn');
    if (btn) btn.addEventListener('click', runSampleReveals);
    DeckConfig.onDeckUpdate(() => { updateUI(); });

    updateUI();
}
