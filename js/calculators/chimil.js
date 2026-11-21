/**
 * Chimil, the Inner Sun — {6} legendary artifact. The page: readInputs() (the
 * DOM and the deck → a plain object), the model, then rendering. The maths —
 * exact per end step, simulated per game — lives in js/utils/models/chimil.js.
 */

import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable } from '../utils/components.js';
import { buildDeckFromCardData, renderDistributionChart } from '../utils/sampleSimulator.js';
import { landCount, libraryOf, withoutRemoved } from '../utils/library.js';
import { one, pct, plural } from '../utils/text.js';
import { cardRef } from '../data/glossary.js';
import { tailRows } from '../utils/discover.js';
import { describeDots, dotPlot } from '../utils/viz.js';
import {
    AUTO_SIM_GAMES, CHIMIL_COST, MAX_TURNS, ON_BATTLEFIELD, PROJECTION_TURNS, SMALL_HIT_MV, analyzeTrigger, cheatedDistribution,
    chimilDots, finalOf, fitVerdict, isXSpell, paybackTurn, projectTurns, simulateGames, summariseGames, summarize,
    truncateGames, turnBands
} from '../utils/models/chimil.js';

/** Inputs share links carry as they are (js/utils/share.js). Names and ids are in links already shared: never rename them. */
export const shareInputs = Object.freeze([
    { param: 'chimilTurns', id: 'chimil-turnsSlider', min: 1, max: 20 }
]);

/** Sample games listed on the page (fewer on a phone, where each one wraps tall). */
const SHOWN_GAMES = 6;
const NARROW_GAMES = 3;

let chart = null;

// ==================== INPUTS ====================

/** Simulated games for the current deck, at MAX_TURNS. Keyed on the deck object. */
const simState = { deckRef: null, games: null };

/**
 * Read the horizon and the shared deck state. With a decklist the library is
 * the list less the commanders (see library.js).
 * @returns {{turns:number, lands:number, cardDetails:Array, deckSize:number, library:Object|null}}
 */
export function readInputs() {
    const deck = DeckConfig.getDeckConfig();
    const slider = document.getElementById('chimil-turnsSlider');
    const raw = parseInt(slider?.value, 10);
    const turns = Math.max(1, Math.min(MAX_TURNS, Number.isFinite(raw) ? raw : PROJECTION_TURNS));
    const library = DeckConfig.hasCardList() ? libraryOf(deck, ON_BATTLEFIELD) : null;
    const details = Array.isArray(deck.cardDetails) ? deck.cardDetails : [];

    return {
        turns,
        lands: library ? landCount(library) : (deck.lands ?? 0),
        cardDetails: library ? withoutRemoved(details, library) : details,
        deckSize: library ? library.size : DeckConfig.getDeckSize(true),
        library
    };
}

/** Simulate (once per deck) and return the full-length games, or null without a decklist. */
function ensureGames(library, { force = false } = {}) {
    if (!library?.size) {
        simState.deckRef = null;
        simState.games = null;
        return null;
    }
    if (force || simState.deckRef !== library || !simState.games) {
        simState.games = simulateGames(buildDeckFromCardData(library), AUTO_SIM_GAMES, MAX_TURNS);
        simState.deckRef = library;
    }
    return simState.games;
}

/**
 * Run the analysis for the current deck and horizon.
 * @returns {{config:Object, trigger:Object, rows:Array, payback:number|null, fit:Object, games:Array|null, sim:Object|null, bands:Array}}
 */
export function calculate() {
    const config = readInputs();
    const trigger = analyzeTrigger({ cardDetails: config.cardDetails, lands: config.lands });
    // Project past the horizon so payback is found even when it is late.
    const payback = paybackTurn(projectTurns(trigger, 30));
    const rows = projectTurns(trigger, config.turns);

    const all = ensureGames(config.library);
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
        <p class="tx-caption">Each chip is one end step: the step number, the card discover cast, and its mana value. <span class="ch-key-small">Amber</span> chips are cheap hits (mana value ${SMALL_HIT_MV} or less); X spells cast free resolve with X&nbsp;=&nbsp;0.</p>
        <div class="ch-games">${rows}</div>
        <p class="tx-caption ch-caption-foot"><span class="ch-shown-wide">${SHOWN_GAMES}</span><span class="ch-shown-narrow">${NARROW_GAMES}</span> of ${AUTO_SIM_GAMES.toLocaleString('en-US')} simulated games, ${plural(turns, 'end step')} each.</p>`;
}

function renderDetails(result) {
    const { config, trigger, bands } = result;

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
            <p class="tx-caption">Mana value of the card one discover finds — every eligible card is equally likely, so this is your eligible cards by mana value.</p>
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
    // The top 1% is one "N+ mana" row: the table never ends on the sampled maximum.
    const rows = tailRows(counts, games.length)
        .map(r => [`${r.value}${r.plus ? '+' : ''} mana`, pct(r.share), pct(r.atLeast)]);
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
    ensureGames(readInputs().library, { force: true });
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
