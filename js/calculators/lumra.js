/**
 * Lumra, Bellow of the Woods — {4}{G}{G}
 *
 * "Lumra's power and toughness are each equal to the number of lands you
 * control. When Lumra enters, mill four cards. Then return all land cards from
 * your graveyard to the battlefield tapped."
 *
 * So Lumra's size is the land drops you have made by the turn you cast it plus
 * every land the trigger brings back: the lands milled, the fetch lands you have
 * cracked, and any other lands already in your graveyard.
 *
 * Exact (hypergeometric) for the averages: land drops by turn T, lands milled,
 * fetch lands seen. Simulated for the spread and the sample games: real
 * shuffles of the decklist are dealt to turn T and then milled. The shuffles are
 * made once per deck and re-read for every setting, so moving a slider never
 * re-shuffles.
 */

import { drawType } from '../utils/hypergeometric.js';
import { createCache } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable } from '../utils/components.js';
import { buildDeckFromCardData, shuffleDeck, renderDistributionChart } from '../utils/sampleSimulator.js';
import { cardRef } from '../data/glossary.js';

/** Cards milled per Lumra trigger. */
export const MILL_PER_TRIGGER = 4;

/** Opening hand size; one card is drawn each turn after (Commander: no skipped draw). */
export const OPENING_HAND = 7;

/** Shuffled libraries kept per deck for the spread and sample games. */
export const SIM_GAMES = 2000;

/** Sample games listed on the page. */
const SHOWN_GAMES = 5;

/** Defaults for the inputs. */
const DEFAULTS = { turn: 6, gyLands: 0, multiplier: 1 };

const statsCache = createCache(50);
let chart = null;

// ==================== FETCH LANDS ====================

// Name fallback for cached/third-party imports that predate stored oracle text.
const KNOWN_FETCH_LANDS = new Set([
    'arid mesa', 'bloodstained mire', 'flooded strand', 'marsh flats', 'misty rainforest',
    'polluted delta', 'scalding tarn', 'verdant catacombs', 'windswept heath', 'wooded foothills',
    'prismatic vista', 'fabled passage', 'evolving wilds', 'terramorphic expanse', 'escape tunnel',
    'promising vein', 'bad river', 'flood plain', 'grasslands', 'mountain valley', 'rocky tar pit',
    'bant panorama', 'esper panorama', 'grixis panorama', 'jund panorama', 'naya panorama',
    'brokers hideout', 'cabaretti courtyard', 'maestros theater', 'obscura storefront',
    'riveteers overlook', 'krosan verge', 'myriad landscape'
]);

/**
 * Identify a land whose own rules text sacrifices it to search for a land.
 * Covers traditional fetch lands plus Evolving Wilds, Fabled Passage and the
 * like without relying only on a name list.
 */
export function isFetchLand(card = {}) {
    const name = String(card?.name ?? '').toLowerCase();
    const typeLine = String(card?.type_line ?? '').toLowerCase();
    const types = Array.isArray(card?.types) ? card.types.map(type => String(type).toLowerCase()) : [];
    const facesText = Array.isArray(card?.card_faces)
        ? card.card_faces.map(face => face?.oracle_text ?? '').join(' ')
        : '';
    const oracleText = `${card?.oracle_text ?? ''} ${facesText}`.toLowerCase();
    const isLand = typeLine.includes('land') || types.includes('land');

    const searchesForLand = oracleText.includes('land card') ||
        /(?:plains|island|swamp|mountain|forest)(?:\s+or\s+(?:plains|island|swamp|mountain|forest))*\s+card/.test(oracleText);

    return isLand && (KNOWN_FETCH_LANDS.has(name) || (
        oracleText.includes('sacrifice') && oracleText.includes('search your library') && searchesForLand
    ));
}

/** Fetch-land copies in a decklist. */
export function countFetchLands(cardsByName) {
    return Object.values(cardsByName ?? {}).reduce((sum, card) =>
        sum + (isFetchLand(card) ? Math.max(0, Number(card?.count) || 0) : 0), 0);
}

/**
 * Fetch access by a given turn from exact without-replacement odds.
 * Cracked fetches are approximated as the fetches seen, capped at one per turn.
 */
export function calculateFetchLandSetup(deckSize, fetchCount, turn, openingHand = OPENING_HAND) {
    const size = Math.max(0, Math.floor(Number(deckSize) || 0));
    const fetches = Math.min(size, Math.max(0, Math.floor(Number(fetchCount) || 0)));
    const castTurn = Math.max(0, Math.floor(Number(turn) || 0));
    const cardsSeen = Math.min(size, Math.max(0, Math.floor(Number(openingHand) || 0)) + castTurn);

    if (size === 0 || fetches === 0 || cardsSeen === 0) {
        return { cardsSeen, probabilityAtLeastOne: 0, expectedSeen: 0, expectedCracked: 0 };
    }

    const probabilityAtLeastOne = 1 - drawType(size, fetches, cardsSeen, 0);
    const expectedSeen = cardsSeen * (fetches / size);
    const expectedCracked = Math.min(castTurn, expectedSeen);

    return { cardsSeen, probabilityAtLeastOne, expectedSeen, expectedCracked };
}

// ==================== EXACT MATH ====================

/**
 * Expected land drops made by turn T: E[min(T, lands seen)], where the lands
 * seen in the opening hand plus T draws are hypergeometric. Assumes one land a
 * turn whenever you have one, and no other ramp.
 */
export function expectedLandDrops(deckSize, lands, turn, openingHand = OPENING_HAND) {
    const N = Math.max(0, Math.floor(Number(deckSize) || 0));
    const K = Math.min(N, Math.max(0, Math.floor(Number(lands) || 0)));
    const T = Math.max(0, Math.floor(Number(turn) || 0));
    const n = Math.min(N, Math.max(0, Math.floor(Number(openingHand) || 0)) + T);
    if (N === 0 || K === 0 || T === 0) return 0;
    let expected = 0;
    for (let x = 0; x <= Math.min(K, n); x++) expected += Math.min(T, x) * drawType(N, K, n, x);
    return expected;
}

/**
 * Lands milled and returned (exact).
 * @param {number} deckSize - Cards in library
 * @param {number} landCount - Lands in library
 * @param {number} gyLands - Other lands already in the graveyard
 * @param {number} [multiplier=1] - How many times the enter trigger resolves
 * @param {number} [setupLands=0] - Expected fetch lands in the graveyard
 * @returns {{distribution:Array<{count:number, probability:number}>, expectedMilled:number, totalReturned:number, setupLands:number}}
 */
export function calculateLumraStats(deckSize, landCount, gyLands, multiplier = 1, setupLands = 0) {
    const safeSetupLands = Math.max(0, Number(setupLands) || 0);
    const cacheKey = `${deckSize}-${landCount}-${gyLands}-${multiplier}-${safeSetupLands}`;
    const cached = statsCache.get(cacheKey);
    if (cached) return cached;

    const distribution = [];
    let expectedMilled = 0;
    const millAmount = MILL_PER_TRIGGER * multiplier;
    for (let k = 0; k <= millAmount; k++) {
        const prob = drawType(deckSize, landCount, millAmount, k);
        distribution.push({ count: k, probability: prob });
        expectedMilled += k * prob;
    }

    const result = {
        distribution,
        expectedMilled,
        totalReturned: gyLands + safeSetupLands + expectedMilled,
        setupLands: safeSetupLands
    };
    statsCache.set(cacheKey, result);
    return result;
}

// ==================== SIMULATION ====================

/**
 * Mark which library cards act as fetch lands. Detected fetch lands come
 * first; if the fetch count is overridden upward, other lands stand in for the
 * extra fetches, and downward, surplus fetches act as ordinary lands.
 *
 * @param {Array<{types:string[], isFetchCard?:boolean}>} deck - mutated: sets `isFetch`
 * @param {number} fetchCount
 * @returns {Array} the same deck
 */
export function assignFetchRoles(deck, fetchCount) {
    const lands = deck.filter(c => c.types?.includes('land'));
    const ordered = [...lands.filter(c => c.isFetchCard), ...lands.filter(c => !c.isFetchCard)];
    const n = Math.max(0, Math.floor(Number(fetchCount) || 0));
    for (const c of deck) c.isFetch = false;
    ordered.slice(0, n).forEach(c => { c.isFetch = true; });
    return deck;
}

/**
 * Play one game to Lumra: see the opening hand plus a draw a turn, make a land
 * drop each turn you can (cracking fetch lands first), then mill.
 *
 * @param {Array<{name:string, types:string[], isFetch?:boolean}>} library - shuffled, not modified
 * @param {{turn:number, multiplier?:number, openingHand?:number}} opts
 * @returns {{drops:number, cracked:number, landsMilled:number, milled:Array}}
 */
export function playToLumra(library, { turn, multiplier = 1, openingHand = OPENING_HAND }) {
    const lib = Array.isArray(library) ? library : [];
    const seen = Math.min(lib.length, openingHand + Math.max(0, turn));
    let landsSeen = 0;
    let fetchesSeen = 0;
    for (let i = 0; i < seen; i++) {
        if (lib[i].types?.includes('land')) {
            landsSeen++;
            if (lib[i].isFetch) fetchesSeen++;
        }
    }
    const drops = Math.min(turn, landsSeen);
    const cracked = Math.min(fetchesSeen, drops);

    const milled = lib.slice(seen, seen + MILL_PER_TRIGGER * Math.max(1, multiplier));
    const landsMilled = milled.filter(c => c.types?.includes('land')).length;
    return { drops, cracked, landsMilled, milled };
}

/** Nearest-rank quantile of an ascending-sorted array (0 when empty). */
function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const rank = Math.ceil(Math.min(1, Math.max(0, q)) * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

/**
 * Lumra's size across simulated games: percentiles (never the sampled
 * extremes), the size distribution, and how often the mill hits nothing.
 *
 * @param {Array<{drops:number, cracked:number, landsMilled:number}>} games
 * @param {number} gyLands
 */
export function summariseSizes(games, gyLands = 0) {
    const list = Array.isArray(games) ? games : [];
    const sizes = list.map(g => g.drops + g.cracked + g.landsMilled + gyLands).sort((a, b) => a - b);
    const counts = [];
    for (const s of sizes) counts[s] = (counts[s] || 0) + 1;
    for (let i = 0; i < counts.length; i++) if (!counts[i]) counts[i] = 0;
    return {
        games: list.length,
        p10: quantile(sizes, 0.1),
        p25: quantile(sizes, 0.25),
        p50: quantile(sizes, 0.5),
        p75: quantile(sizes, 0.75),
        p90: quantile(sizes, 0.9),
        counts,
        noLandsMilled: list.length ? list.filter(g => g.landsMilled === 0).length / list.length : 0
    };
}

const one = v => (Number.isFinite(v) ? v.toFixed(1) : '—');
const pct = v => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`;
const pt = s => `${s}/${s}`;

/** Tone for the lands Lumra brings back. */
export function returnTone(returned) {
    if (returned >= 3) return 'good';
    if (returned >= 1) return 'warn';
    return 'bad';
}

/**
 * The plain-English answer to "How big is Lumra, and how many lands come back
 * when it enters?".
 *
 * @param {{turn:number, multiplier:number, gyLands:number, drops:number, milled:number, fetches:number, returned:number, sizes:Object|null, pNoLands:number}} r
 * @returns {{html:string, tone:string}}
 */
export function summarize(r) {
    if (!r || !Number.isFinite(r.returned)) {
        return { tone: 'flat', html: 'Import a decklist to see how big Lumra gets.' };
    }
    const mill = MILL_PER_TRIGGER * (r.multiplier ?? 1);
    const size = r.sizes ? r.sizes.p50 : Math.round(r.drops + r.returned);
    const range = r.sizes && r.sizes.p25 !== r.sizes.p75 ? ` (half of games between ${pt(r.sizes.p25)} and ${pt(r.sizes.p75)})` : '';

    const parts = [`${one(r.milled)} milled from the top ${mill}`];
    if (r.fetches > 0.05) parts.push(`${one(r.fetches)} cracked fetch land${r.fetches >= 1.05 ? 's' : ''}`);
    if (r.gyLands > 0) parts.push(`${r.gyLands} already in your graveyard`);

    let html = `Cast on turn ${r.turn}, Lumra typically enters as a <strong>${pt(size)}</strong>${range}. `
        + `About ${one(r.drops)} of that is your land drops; the trigger brings back <strong>${one(r.returned)}</strong> more on average — ${parts.join(', ')}.`;
    if (r.pNoLands >= 0.05) html += ` ${pct(r.pNoLands)} of the time the mill finds no lands.`;
    return { html, tone: returnTone(r.returned) };
}

// ==================== STATE ====================

const sim = { deckRef: null, deck: null, libraries: null, fetchCount: null };
let lastFetchDeckRef = null;

function intInput(id, fallback, min, max) {
    const raw = parseInt(document.getElementById(id)?.value, 10);
    return Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : fallback));
}

/** Re-detect fetch lands when the deck changes (keeps a manual override until then). */
function syncFetchDetection() {
    const cardsByName = DeckConfig.getImportedCardData()?.cardsByName;
    if (!cardsByName || cardsByName === lastFetchDeckRef) return;
    const input = document.getElementById('lumra-fetchLands');
    const detected = countFetchLands(cardsByName);
    if (input) input.value = String(detected);
    const hint = document.getElementById('lumra-fetch-hint');
    if (hint) hint.textContent = detected ? `Found ${detected} in your deck. Change it to see what more or fewer would do.` : 'None found in your deck.';
    lastFetchDeckRef = cardsByName;
}

/**
 * Current deck and inputs.
 * @returns {{deckSize:number, landCount:number, gyLands:number, multiplier:number, cardData:Object, fetchCount:number, turn:number, fetchSetup:Object}}
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();
    const deckSize = DeckConfig.getDeckSize(true);
    syncFetchDetection();

    const fetchCount = intInput('lumra-fetchLands', 0, 0, deckSize);
    const turn = intInput('lumra-turn', DEFAULTS.turn, 1, 30);
    return {
        deckSize,
        landCount: config.lands ?? 0,
        gyLands: intInput('lumra-gyLands', DEFAULTS.gyLands, 0, 100),
        multiplier: intInput('lumra-multiplier', DEFAULTS.multiplier, 1, 10),
        cardData,
        fetchCount,
        turn,
        fetchSetup: calculateFetchLandSetup(deckSize, fetchCount, turn)
    };
}

/** The library as cards with roles; a stand-in built from counts when there is no list. */
function buildLibrary(config) {
    const cardsByName = config.cardData?.cardsByName;
    if (cardsByName && Object.keys(cardsByName).length) {
        const fetchNames = new Set(Object.values(cardsByName).filter(isFetchLand).map(c => c.name));
        return buildDeckFromCardData({ cardsByName }).map(c => ({ ...c, isFetchCard: fetchNames.has(c.name) }));
    }
    const deck = [];
    for (let i = 0; i < config.deckSize; i++) {
        const isLand = i < config.landCount;
        deck.push({ name: isLand ? 'Land' : 'Spell', types: isLand ? ['land'] : [], isFetchCard: false, generic: true });
    }
    return deck;
}

/** Shuffled libraries for the current deck, made once per deck (or on demand). */
function ensureLibraries(config, force = false) {
    const ref = config.cardData?.cardsByName && Object.keys(config.cardData.cardsByName).length
        ? config.cardData.cardsByName
        : `${config.deckSize}:${config.landCount}`;
    if (force || sim.deckRef !== ref || !sim.libraries) {
        sim.deck = buildLibrary(config);
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
    const config = getDeckConfig();
    const { deckSize, landCount, gyLands, multiplier, turn } = config;
    if (deckSize === 0) return { config, results: null };

    const results = calculateLumraStats(deckSize, landCount, gyLands, multiplier, config.fetchSetup.expectedCracked);
    const drops = expectedLandDrops(deckSize, landCount, turn);
    const games = ensureLibraries(config).map(lib => playToLumra(lib, { turn, multiplier }));
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
        <ul class="tx-legend">
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
        <p class="tx-caption">${SHOWN_GAMES} of ${r.games.length.toLocaleString('en-US')} shuffles of your list. Highlighted cards are lands the trigger returns${gyLands ? `; the ${gyLands} graveyard land${gyLands === 1 ? '' : 's'} you set count in every game` : ''}.</p>`;
}

function renderDetails(r) {
    const millEl = document.getElementById('lumra-mill-dist');
    if (millEl) {
        const mill = MILL_PER_TRIGGER * r.config.multiplier;
        millEl.innerHTML = `
            <p class="tx-caption">Exact chance of each number of lands among the ${mill} cards milled.</p>
            ${renderDistributionChart(r.distribution.map(d => d.probability), 1, k => `${k} land${k === 1 ? '' : 's'}`, () => null, k => (k === 0 ? 'bad' : null))}`;
    }

    const { deckSize, landCount, gyLands, multiplier, fetchCount, turn } = r.config;
    const rows = [];
    for (let t = 3; t <= 12; t++) {
        const fetch = calculateFetchLandSetup(deckSize, fetchCount, t).expectedCracked;
        const back = calculateLumraStats(deckSize, landCount, gyLands, multiplier, fetch).totalReturned;
        const drops = expectedLandDrops(deckSize, landCount, t);
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
        ensureLibraries(getDeckConfig(), true);
        updateUI();
    });
}
