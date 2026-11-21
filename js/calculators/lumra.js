/**
 * Lumra, Bellow of the Woods — {4}{G}{G}. The page: readInputs() (the DOM and
 * the deck → a plain object), the model, then rendering. The maths — exact
 * averages, simulated spread — lives in js/utils/models/lumra.js.
 */

import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable } from '../utils/components.js';
import { shuffleDeck, renderDistributionChart } from '../utils/sampleSimulator.js';
import { isLand, libraryOf } from '../utils/library.js';
import { one, pct } from '../utils/text.js';
import { cardRef } from '../data/glossary.js';
import {
    MILL_PER_TRIGGER, SIM_GAMES, assignFetchRoles, buildLumraLibrary, calculateFetchLandSetup, calculateLumraStats,
    countFetchLands, expectedLandDrops, handFromLibrary, ON_BATTLEFIELD, playToLumra, pt, returnTone, summariseSizes, summarize
} from '../utils/models/lumra.js';

/** Inputs share links carry as they are (js/utils/share.js). Names and ids are in links already shared: never rename them. */
export const shareInputs = Object.freeze([
    { param: 'lumraGY', id: 'lumra-gySlider', min: 0, max: 30 },
    { param: 'lumraMult', id: 'lumra-multSlider', min: 1, max: 10 },
    { param: 'lumraFetch', id: 'lumra-fetchLands', min: 0, max: 100 },
    { param: 'lumraTurn', id: 'lumra-turnSlider', min: 1, max: 20 }
]);

/** Sample games listed on the page. */
const SHOWN_GAMES = 5;

/** Defaults for the inputs. */
const DEFAULTS = { turn: 6, gyLands: 0, multiplier: 1 };

let chart = null;

// ==================== INPUTS ====================

const sim = { deckRef: null, deck: null, libraries: null, fetchCount: null };
let lastFetchDeckRef = null;

function intInput(id, fallback, min, max) {
    const raw = parseInt(document.getElementById(id)?.value, 10);
    return Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback));
}

/** Re-detect fetch lands when the deck changes (keeps a manual override until then). */
function syncFetchDetection(library) {
    if (!library || library === lastFetchDeckRef) return;
    const input = document.getElementById('lumra-fetchLands');
    const detected = countFetchLands(library.cards);
    if (input) input.value = String(detected);
    const hint = document.getElementById('lumra-fetch-hint');
    if (hint) hint.textContent = detected ? `Found ${detected} in your deck. Change it to see what more or fewer would do.` : 'None found in your deck.';
    lastFetchDeckRef = library;
}

/**
 * Current deck and inputs. With a decklist the library is the list less the
 * commanders and the Lumra being cast (see library.js); with bare counts it
 * is the counts.
 * @returns {{deckSize:number, landCount:number, gyLands:number, multiplier:number, library:Object|null, openingHand:number, fetchCount:number, turn:number, fetchSetup:Object}}
 */
export function readInputs() {
    const config = DeckConfig.getDeckConfig();
    const library = DeckConfig.hasCardList() ? libraryOf(config, ON_BATTLEFIELD) : null;
    const deckSize = library ? library.size : DeckConfig.getDeckSize(true);
    const landCount = library
        ? library.cards.reduce((n, c) => n + (isLand(c) ? c.count : 0), 0)
        : (config.lands ?? 0);
    syncFetchDetection(library);

    const openingHand = handFromLibrary(library);
    const fetchCount = intInput('lumra-fetchLands', 0, 0, deckSize);
    const turn = intInput('lumra-turn', DEFAULTS.turn, 1, 30);
    return {
        deckSize,
        landCount,
        gyLands: intInput('lumra-gyLands', DEFAULTS.gyLands, 0, 100),
        multiplier: intInput('lumra-multiplier', DEFAULTS.multiplier, 1, 10),
        library,
        openingHand,
        fetchCount,
        turn,
        fetchSetup: calculateFetchLandSetup(deckSize, fetchCount, turn, openingHand)
    };
}

/** Shuffled libraries for the current deck, made once per deck (or on demand). */
function ensureLibraries(config, force = false) {
    const ref = config.library?.size ? config.library : `${config.deckSize}:${config.landCount}`;
    if (force || sim.deckRef !== ref || !sim.libraries) {
        sim.deck = buildLumraLibrary(config);
        sim.libraries = Array.from({ length: SIM_GAMES }, () => shuffleDeck([...sim.deck]));
        sim.deckRef = ref;
        sim.fetchCount = null;
    }
    if (sim.fetchCount !== config.fetchCount) {
        assignFetchRoles(sim.deck, config.fetchCount);
        sim.fetchCount = config.fetchCount;
    }
    return sim.libraries;
}

export function calculate() {
    const config = readInputs();
    const { deckSize, landCount, gyLands, multiplier, turn } = config;
    if (deckSize === 0) return { config, results: null };

    const results = calculateLumraStats(deckSize, landCount, gyLands, multiplier, config.fetchSetup.expectedCracked);
    const drops = expectedLandDrops(deckSize, landCount, turn, config.openingHand);
    const games = ensureLibraries(config).map(lib => playToLumra(lib, { turn, multiplier, openingHand: config.openingHand }));
    const sizes = summariseSizes(games, gyLands);
    return { config, ...results, drops, games, sizes };
}

// ==================== RENDERING ====================

function renderHero(r) {
    const el = document.getElementById('lumra-stats');
    if (!el) return;
    const { config, sizes } = r;
    const mill = MILL_PER_TRIGGER * config.multiplier;
    const pNone = r.distribution[0]?.probability ?? 0;
    el.innerHTML = renderHeroStats([
        {
            label: 'Lumra’s size',
            value: pt(sizes.p50),
            sub: sizes.p25 === sizes.p75 ? `typical game, cast turn ${config.turn}` : `typical · half of games ${sizes.p25}–${sizes.p75}`,
            size: 'big',
            color: 'var(--tx-good)',
            term: 'p50'
        },
        {
            label: 'Lands brought back',
            value: one(r.totalReturned),
            sub: 'average, onto the battlefield tapped',
            color: `var(--tx-${returnTone(r.totalReturned)})`,
            term: 'ev'
        },
        {
            label: 'Lands milled',
            value: one(r.expectedMilled),
            sub: `of the top ${mill} · none ${pct(pNone)} of the time`,
            tip: 'Exact: the chance of each number of lands among the cards milled, from your land count.'
        },
        {
            label: 'Fetch lands back',
            value: one(config.fetchSetup.expectedCracked),
            sub: config.fetchCount ? `${pct(config.fetchSetup.probabilityAtLeastOne)} chance you’ve seen one` : 'no fetch lands counted',
            tip: 'Fetch lands you have played and cracked by this turn are in your graveyard, so Lumra returns them too.'
        }
    ]);
}

function renderSources(r) {
    const el = document.getElementById('lumra-sources');
    if (!el) return;
    const parts = [
        { key: 'drops', label: 'Land drops', value: r.drops },
        { key: 'gy', label: 'Already in graveyard', value: r.config.gyLands },
        { key: 'fetch', label: 'Fetch lands', value: r.config.fetchSetup.expectedCracked },
        { key: 'mill', label: 'Milled', value: r.expectedMilled }
    ].filter(p => p.value > 0.005);
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    el.innerHTML = `
        <div class="lm-band" role="img" aria-label="${parts.map(p => `${p.label} ${one(p.value)}`).join(', ')}">
            ${parts.map(p => `<span class="lm-band-seg is-${p.key}" style="width:${(p.value / total * 100).toFixed(2)}%"></span>`).join('')}
        </div>
        <ul class="tx-legend is-below">
            ${parts.map(p => `<li><span class="lm-swatch is-${p.key}"></span>${p.label}<strong>${one(p.value)}</strong></li>`).join('')}
            <li class="lm-legend-total">Average size<strong>${one(total)}</strong></li>
        </ul>`;
}

function updateChart(sizes) {
    if (!document.getElementById('lumra-chart')) return;
    const first = sizes.counts.findIndex(c => c > 0);
    const labels = [];
    const data = [];
    for (let s = Math.max(0, first); s < sizes.counts.length; s++) {
        labels.push(String(s));
        data.push(Math.round((sizes.counts[s] / sizes.games) * 1000) / 10);
    }
    const start = Math.max(0, first);
    chart = createOrUpdateChart(chart, 'lumra-chart', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Share of games',
                data,
                backgroundColor: labels.map((_, i) => (i + start === sizes.p50 ? TX.green : TX.greenFill)),
                borderColor: TX.green,
                borderWidth: 1,
                borderRadius: 3,
                maxBarThickness: 48
            }]
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => `Enters as a ${pt(items[0]?.label ?? '')}`,
                        label: ctx => ` ${ctx.parsed.y.toFixed(1)}% of games`
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Lumra’s power and toughness', color: TX.dim } },
                y: { beginAtZero: true, ticks: { callback: v => `${v}%` }, title: { display: true, text: 'Share of games', color: TX.dim } }
            }
        }
    });
}

function cardName(card) {
    return card.generic ? card.name : cardRef(card.name);
}

/** Render sample games from the shared shuffles. */
export function runSampleReveals(passed) {
    const display = document.getElementById('lumra-reveals-display');
    if (!display) return;
    const r = passed?.games ? passed : calculate();
    if (!r.games?.length) {
        display.innerHTML = '<div class="tx-empty">Import a decklist to see sample games.</div>';
        return;
    }
    const { turn, gyLands } = r.config;
    const rows = r.games.slice(0, SHOWN_GAMES).map((g, i) => {
        const size = g.drops + g.cracked + g.landsMilled + gyLands;
        const back = g.cracked + g.landsMilled + gyLands;
        const how = [
            `${g.drops} land drop${g.drops === 1 ? '' : 's'}`,
            g.cracked ? `${g.cracked} fetch cracked` : null
        ].filter(Boolean).join(', ');
        const chips = g.milled.map(c => {
            const isLand = c.types?.includes('land');
            return `<li class="lm-mill${isLand ? ' is-land' : ''}">${cardName(c)}</li>`;
        }).join('');
        return `
            <div class="lm-game">
                <div class="lm-game-head">
                    <span>Game ${i + 1}</span>
                    <span><span class="lm-game-back">${back} land${back === 1 ? '' : 's'} back</span> <span class="lm-game-size">${pt(size)}</span></span>
                </div>
                <div class="lm-game-body">
                    <span class="lm-game-how">${how} by turn ${turn}. Milled:</span>
                    <ol class="lm-mills">${chips}</ol>
                </div>
            </div>`;
    }).join('');
    display.innerHTML = `
        <div class="lm-games">${rows}</div>
        <p class="tx-caption is-below">${SHOWN_GAMES} of ${r.games.length.toLocaleString('en-US')} shuffles of your list. Highlighted cards are lands the trigger returns${gyLands ? `; the ${gyLands} graveyard land${gyLands === 1 ? '' : 's'} you set count in every game` : ''}.</p>`;
}

function renderDetails(r) {
    const millEl = document.getElementById('lumra-mill-dist');
    if (millEl) {
        const mill = MILL_PER_TRIGGER * r.config.multiplier;
        millEl.innerHTML = `
            <p class="tx-caption">Exact chance of each number of lands among the ${mill} cards milled.</p>
            ${renderDistributionChart(r.distribution.map(d => d.probability), 1, k => `${k} land${k === 1 ? '' : 's'}`, () => null, k => (k === 0 ? 'bad' : null))}`;
    }

    const { deckSize, landCount, gyLands, multiplier, fetchCount, turn, openingHand } = r.config;
    const rows = [];
    for (let t = 3; t <= 12; t++) {
        const fetch = calculateFetchLandSetup(deckSize, fetchCount, t, openingHand).expectedCracked;
        const back = calculateLumraStats(deckSize, landCount, gyLands, multiplier, fetch).totalReturned;
        const drops = expectedLandDrops(deckSize, landCount, t, openingHand);
        rows.push({ x: t, drops, back, size: drops + back });
    }
    renderSweepTable('lumra-turn-table', {
        rows,
        current: turn,
        columns: [
            { label: 'Cast on turn', align: 'left', render: row => String(row.x) },
            { label: 'Land drops', render: row => one(row.drops) },
            { label: 'Brought back', render: row => one(row.back) },
            { label: 'Average size', render: row => `<strong>${one(row.size)}</strong>` }
        ]
    });
}

export function updateUI() {
    const r = calculate();
    const bottom = document.getElementById('lumra-bottom-line');
    if (!r.distribution) {
        if (bottom) bottom.innerHTML = renderBottomLine(summarize(null));
        if (chart) { chart.destroy(); chart = null; }
        return;
    }

    if (bottom) {
        bottom.innerHTML = renderBottomLine(summarize({
            turn: r.config.turn,
            multiplier: r.config.multiplier,
            gyLands: r.config.gyLands,
            drops: r.drops,
            milled: r.expectedMilled,
            fetches: r.config.fetchSetup.expectedCracked,
            returned: r.totalReturned,
            sizes: r.sizes,
            pNoLands: r.distribution[0]?.probability ?? 0
        }));
    }
    renderHero(r);
    renderSources(r);
    updateChart(r.sizes);
    runSampleReveals(r);
    renderDetails(r);
}

/** Keep a slider and its number box in step, then re-render (debounced). */
function pair(sliderId, numberId, update) {
    const slider = document.getElementById(sliderId);
    const number = document.getElementById(numberId);
    if (!slider || !number) return;
    slider.addEventListener('input', () => { number.value = slider.value; update(); });
    number.addEventListener('input', () => {
        const v = parseInt(number.value, 10);
        if (Number.isFinite(v)) slider.value = String(Math.max(+slider.min, Math.min(+slider.max, v)));
        update();
    });
}

export function init() {
    const { updateUI: debouncedUpdate } = registerCalculator({ name: 'lumra', calculate, updateUI });
    // Detect fetch lands now, so a share link applied after mount keeps its override.
    syncFetchDetection();
    pair('lumra-gySlider', 'lumra-gyLands', debouncedUpdate);
    pair('lumra-multSlider', 'lumra-multiplier', debouncedUpdate);
    pair('lumra-turnSlider', 'lumra-turn', debouncedUpdate);
    document.getElementById('lumra-fetchLands')?.addEventListener('input', debouncedUpdate);
    document.getElementById('lumra-draw-reveals-btn')?.addEventListener('click', () => {
        if (!isCalculatorActive('lumra')) return;
        ensureLibraries(readInputs(), true);
        updateUI();
    });
}
