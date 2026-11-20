/**
 * Primal Surge — {8}{G}{G} sorcery.
 *
 * "Exile the top card of your library. If it's a permanent card, you may put
 * it onto the battlefield. If you do, repeat this process."
 *
 * The run stops at the first instant or sorcery, so its length depends only on
 * where the first of those sits in a shuffled library. Everything headline is
 * exact: the run-length odds are a product of draw-without-replacement
 * fractions, and the payback chance is a subset-sum count over the permanents
 * (a run of length k is a uniformly random k-subset of your permanents).
 */

import { createCache, formatNumber, formatPercentage } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { buildDeckFromCardData, shuffleDeck } from '../utils/sampleSimulator.js';
import {
    avg, barsHTML, cardListKey, cardTypesOf, chanceTone, createSampler, deckCardList, expandCards, fade,
    isPermanentTypeLine, noticeHTML, pct, plural, renderHowItCompares, sampleCardHTML, toneColor
} from '../utils/bigSpells.js';

const CONFIG = Object.freeze({
    DEFAULT_PAYBACK_THRESHOLD: 10,
    DEFAULT_LAND_VALUE: 1,
    DEFAULT_CARD_VALUE: 0.25,
    VALUE_STEP: 0.25,
    SIM_RUNS: 500,
    SAMPLE_COUNT: 4,
    SAMPLE_ROWS: 10,
    MILESTONES: [1, 3, 5, 10, 20],
    COST: 10
});

const subsetCache = createCache(16);
const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;
let simulated = { key: null, runs: [] };

function clampNumber(value, fallback, min = 0, max = 100) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/** The value model from the page's inputs (defaults when not mounted). */
function getPaybackSettings() {
    const read = id => (typeof document !== 'undefined' ? document.getElementById(id)?.value : undefined);
    const roundToStep = value => Math.round(value / CONFIG.VALUE_STEP) * CONFIG.VALUE_STEP;
    return {
        threshold: roundToStep(clampNumber(read('surge-payback-threshold'), CONFIG.DEFAULT_PAYBACK_THRESHOLD, CONFIG.VALUE_STEP, 100)),
        landValue: roundToStep(clampNumber(read('surge-land-value'), CONFIG.DEFAULT_LAND_VALUE, 0, 20)),
        cardValue: roundToStep(clampNumber(read('surge-card-value'), CONFIG.DEFAULT_CARD_VALUE, 0, 20))
    };
}

/**
 * Score one Primal Surge run using the visible value model.
 * @param {{manaValue:number, lands:number, permanents:number}} run
 * @param {{threshold?:number, landValue?:number, cardValue?:number}} settings
 * @returns {{effectiveValue:number, paidBack:boolean}}
 */
export function calculateSurgeRunValue(run, settings = {}) {
    const threshold = clampNumber(settings.threshold, CONFIG.DEFAULT_PAYBACK_THRESHOLD, 0, 100);
    const landValue = clampNumber(settings.landValue, CONFIG.DEFAULT_LAND_VALUE, 0, 20);
    const cardValue = clampNumber(settings.cardValue, CONFIG.DEFAULT_CARD_VALUE, 0, 20);
    const manaValue = clampNumber(run?.manaValue, 0, 0, Number.MAX_SAFE_INTEGER);
    const lands = clampNumber(run?.lands, 0, 0, Number.MAX_SAFE_INTEGER);
    const permanents = clampNumber(run?.permanents, 0, 0, Number.MAX_SAFE_INTEGER);
    const effectiveValue = manaValue + (lands * landValue) + (permanents * cardValue);
    return { effectiveValue, paidBack: effectiveValue >= threshold };
}

function combination(n, k) {
    if (k < 0 || k > n) return 0;
    const smallerK = Math.min(k, n - k);
    let result = 1;
    for (let i = 1; i <= smallerK; i++) result *= (n - smallerK + i) / i;
    return result;
}

/**
 * For every subset size, how many subsets of the permanents fall short of the
 * threshold (capped subset-sum). Independent of how many instants and
 * sorceries the library has, so one table serves every "what if" count.
 */
function buildSurgeSubsets(permanentCards, settings = {}) {
    const threshold = clampNumber(settings.threshold, CONFIG.DEFAULT_PAYBACK_THRESHOLD, 0, 100);
    const landValue = clampNumber(settings.landValue, CONFIG.DEFAULT_LAND_VALUE, 0, 20);
    const cardValue = clampNumber(settings.cardValue, CONFIG.DEFAULT_CARD_VALUE, 0, 20);
    const values = [];
    for (const card of permanentCards ?? []) {
        const count = Math.max(0, Math.floor(clampNumber(card?.count, 1, 0, 500)));
        const value = clampNumber(card?.cmc, 0, 0, 100) + cardValue + (card?.isLand ? landValue : 0);
        for (let i = 0; i < count; i++) values.push(value);
    }
    const permanents = values.length;
    const totalValue = values.reduce((sum, v) => sum + v, 0);
    if (threshold <= 0) return { threshold, permanents, totalValue, shortBySize: null };

    const scale = 1 / CONFIG.VALUE_STEP;
    const thresholdUnits = Math.max(1, Math.round(threshold * scale));
    const subsetCounts = Array.from({ length: permanents + 1 }, () => new Float64Array(thresholdUnits));
    subsetCounts[0][0] = 1;
    let processed = 0;
    for (const value of values) {
        const units = Math.max(0, Math.round(value * scale));
        processed++;
        for (let size = processed; size >= 1; size--) {
            const previous = subsetCounts[size - 1];
            const current = subsetCounts[size];
            for (let sum = 0; sum + units < thresholdUnits; sum++) {
                if (previous[sum]) current[sum + units] += previous[sum];
            }
        }
    }
    // Share of size-k subsets that fall short.
    const shortBySize = subsetCounts.map((row, size) => {
        const total = combination(permanents, size);
        let short = 0;
        for (const ways of row) short += ways;
        return total > 0 ? short / total : 1;
    });
    return { threshold, permanents, totalValue, shortBySize };
}

/** Payback odds for a library with `stops` instants/sorceries, from a subset table. */
function surgePaybackFor(table, nonPermanents) {
    const stops = Math.max(0, Math.floor(clampNumber(nonPermanents, 0, 0, 500)));
    const { permanents, totalValue, shortBySize } = table;
    const expectedEffectiveValue = totalValue / (stops + 1);
    if (!shortBySize) return { paybackProbability: 1, whiffProbability: 0, expectedEffectiveValue };
    const deckSize = permanents + stops;
    if (deckSize === 0) return { paybackProbability: 0, whiffProbability: 1, expectedEffectiveValue: 0 };

    let whiffProbability = 0;
    let survivesToSize = 1;
    for (let size = 0; size <= permanents; size++) {
        const exactRun = stops === 0
            ? (size === permanents ? 1 : 0)
            : survivesToSize * (stops / (deckSize - size));
        whiffProbability += exactRun * shortBySize[size];
        if (size < permanents) survivesToSize *= (permanents - size) / (deckSize - size);
    }
    whiffProbability = Math.min(1, Math.max(0, whiffProbability));
    return { paybackProbability: 1 - whiffProbability, whiffProbability, expectedEffectiveValue };
}

/**
 * The exact chance that the permanents before the first non-permanent meet the
 * payoff threshold.
 *
 * @param {Array<{cmc:number, isLand:boolean, count?:number}>} permanentCards
 * @param {number} nonPermanents
 * @param {{threshold?:number, landValue?:number, cardValue?:number}} settings
 * @returns {{paybackProbability:number, whiffProbability:number, expectedEffectiveValue:number}}
 */
export function calculateSurgePayback(permanentCards, nonPermanents, settings = {}) {
    return surgePaybackFor(buildSurgeSubsets(permanentCards, settings), nonPermanents);
}

function cachedSubsets(deckKey, permanentCards, settings) {
    const key = `${deckKey}|${settings.threshold}|${settings.landValue}|${settings.cardValue}`;
    let table = subsetCache.get(key);
    if (!table) {
        table = buildSurgeSubsets(permanentCards, settings);
        subsetCache.set(key, table);
    }
    return table;
}

/**
 * Average permanents before the first non-permanent: the non-permanents split
 * the permanents into NP + 1 runs of equal expected length, so P / (NP + 1).
 *
 * @param {number} deckSize - cards in the library
 * @param {number} nonPermanents
 * @param {number} permanents
 * @returns {{expectedPermanents:number, percentOfDeck:number}}
 */
export function simulatePrimalSurge(deckSize, nonPermanents, permanents) {
    const expectedPermanents = Math.max(0, permanents) / (Math.max(0, nonPermanents) + 1);
    return {
        expectedPermanents,
        percentOfDeck: deckSize > 0 ? expectedPermanents / deckSize * 100 : 0
    };
}

/**
 * Exact run-length odds: atLeast[k] is the chance Surge puts at least k
 * permanents into play (k = 0..P).
 */
export function surgeRunOdds(permanents, nonPermanents) {
    const P = Math.max(0, Math.floor(permanents));
    const NP = Math.max(0, Math.floor(nonPermanents));
    const N = P + NP;
    const atLeast = new Array(P + 2).fill(0);
    atLeast[0] = 1;
    for (let k = 1; k <= P; k++) atLeast[k] = atLeast[k - 1] * (P - (k - 1)) / (N - (k - 1));
    let median = 0;
    while (median < P && atLeast[median + 1] > 0.5) median++;
    return { atLeast, median, mean: P / (NP + 1) };
}

// ── The library ──────────────────────────────────────────────────────────────

function isPrimalSurge(name) {
    return String(name ?? '').trim().toLowerCase() === 'primal surge';
}

/**
 * Build the sampled library with the cast copy of Primal Surge on the stack.
 * A list without a named copy already represents a library without Surge;
 * removing an unrelated instant or sorcery would change the stop odds.
 * @param {Object} cardData - Card data from deck import
 * @returns {Array} - Deck array without one named Primal Surge, if present
 */
export function buildDeckExcludingSurge(cardData) {
    const deck = buildDeckFromCardData(cardData);
    const surgeIndex = deck.findIndex(card => isPrimalSurge(card?.name));
    if (surgeIndex !== -1) deck.splice(surgeIndex, 1);
    return deck;
}

/**
 * The library Primal Surge resolves into, and the page's value model.
 *
 * With a decklist, the cast Surge is removed only when the list names it. With
 * type counts only, one instant or sorcery is assumed to be the Surge being
 * cast, and mana values are unknown (no payback odds).
 */
export function getDeckConfig() {
    const deck = DeckConfig.getDeckConfig();
    const cards = deckCardList(deck);
    const settings = getPaybackSettings();

    if (cards.length > 0) {
        const surgeOnStack = cards.some(card => isPrimalSurge(card.name));
        let deckSize = 0;
        let nonPermanents = 0;
        let lands = 0;
        let totalPermCMC = 0;
        const permanentCards = [];
        for (const card of cards) {
            deckSize += card.count;
            if (!isPermanentTypeLine(card.type_line)) {
                nonPermanents += card.count;
                continue;
            }
            const isLand = cardTypesOf(card.type_line).includes('land');
            permanentCards.push({ name: card.name, cmc: card.cmc, isLand, count: card.count });
            if (isLand) lands += card.count;
            totalPermCMC += card.cmc * card.count;
        }
        if (surgeOnStack) {
            deckSize -= 1;
            nonPermanents -= 1;
        }
        return {
            deckSize, nonPermanents, permanents: deckSize - nonPermanents,
            cardData: { cardsByName: deck.cardsByName }, cards, lands, totalPermCMC, permanentCards,
            surgeOnStack, mvKnown: true, settings, deckKey: cardListKey(cards)
        };
    }

    const fullDeckSize = DeckConfig.getDeckSize(true);
    const totalNonPermanents = (deck.instants ?? 0) + (deck.sorceries ?? 0);
    const surgeOnStack = totalNonPermanents >= 1;
    const deckSize = surgeOnStack ? fullDeckSize - 1 : fullDeckSize;
    const nonPermanents = surgeOnStack ? totalNonPermanents - 1 : totalNonPermanents;
    const permanents = Math.max(0, deckSize - nonPermanents);
    const lands = Math.min(deck.lands ?? 0, permanents);
    return {
        deckSize, nonPermanents, permanents, cardData: null, cards: [], lands, totalPermCMC: 0,
        permanentCards: [], surgeOnStack, mvKnown: false, settings,
        deckKey: `counts:${deckSize}:${nonPermanents}:${lands}`
    };
}

/** Exact results for the deck as built. */
export function calculate() {
    const config = getDeckConfig();
    if (config.deckSize <= 0) return { config, result: null };
    const result = simulatePrimalSurge(config.deckSize, config.nonPermanents, config.permanents);
    const odds = surgeRunOdds(config.permanents, config.nonPermanents);
    const table = config.mvKnown ? cachedSubsets(config.deckKey, config.permanentCards, config.settings) : null;
    const payback = table ? surgePaybackFor(table, config.nonPermanents) : null;
    return {
        config,
        result: {
            ...result,
            ...odds,
            payback,
            table,
            expectedManaValue: config.permanents > 0 ? result.expectedPermanents * config.totalPermCMC / config.permanents : 0,
            expectedLands: config.permanents > 0 ? result.expectedPermanents * config.lands / config.permanents : 0
        }
    };
}

// ── Plain-English answer ─────────────────────────────────────────────────────

/**
 * The page's bottom line: "How far does Primal Surge get before it hits a
 * non-permanent?"
 *
 * @param {{permanents:number, stops:number, mean:number, median:number, threshold:number,
 *          payback:number|null, cutTo?:{count:number, payback:number}|null}} a
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(a) {
    if (!a || a.permanents + a.stops <= 0) return { html: 'Add cards to your deck to see how far Primal Surge gets.', tone: 'flat' };
    if (a.permanents === 0) {
        return { html: 'Your library has no permanents, so Primal Surge stops on the first card.', tone: 'bad' };
    }
    if (a.stops === 0) {
        return {
            html: `With no other instants or sorceries in your library, Primal Surge puts <strong>all ${a.permanents} permanents</strong> onto the battlefield — every time.`,
            tone: 'good'
        };
    }
    const stopsText = plural(a.stops, 'instant or sorcery', 'instants and sorceries');
    const run = `Primal Surge stops at the first of your <strong>${stopsText}</strong>, so it puts about <strong>${avg(a.mean)} permanents</strong> into play — half the time ${a.median} or fewer`;
    if (a.payback == null) {
        return { html: `${run}. Import your decklist to see how often that pays back its mana.`, tone: 'flat' };
    }
    let html = `${run} — and pays for itself (${formatNumber(a.threshold, a.threshold % 1 ? 2 : 0)}+ value) <strong>${pct(a.payback)}</strong> of the time.`;
    if (a.cutTo && a.cutTo.payback - a.payback >= 0.03) {
        const which = a.cutTo.count === 1 ? 'that one' : `${a.cutTo.count} of them`;
        html += ` Cutting ${which} would lift that to <strong>${pct(a.cutTo.payback)}</strong>.`;
    }
    return { html, tone: chanceTone(a.payback) };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderAnswer(config, result) {
    const el = document.getElementById('surge-stats');
    if (!el) return;
    const p = result.payback?.paybackProbability ?? null;
    const cut = Math.min(5, config.nonPermanents);
    const cutTo = result.table && cut > 0
        ? { count: cut, payback: surgePaybackFor(result.table, config.nonPermanents - cut).paybackProbability }
        : null;
    const { html, tone } = summarize({
        permanents: config.permanents,
        stops: config.nonPermanents,
        mean: result.mean,
        median: result.median,
        threshold: config.settings.threshold,
        payback: p,
        cutTo
    });
    const hero = renderHeroStats([
        {
            label: 'Pays for itself', value: p == null ? '—' : pct(p), size: 'big',
            color: p == null ? 'var(--tx-dim)' : toneColor(chanceTone(p)),
            sub: p == null ? 'needs a decklist' : `reaches ${formatNumber(config.settings.threshold, config.settings.threshold % 1 ? 2 : 0)} value`,
            term: 'payback'
        },
        {
            label: 'Permanents', value: avg(result.mean),
            sub: `half the time ${result.median} or fewer`,
            tip: 'Average number of permanents Primal Surge puts onto the battlefield before it exiles an instant or sorcery (or runs out of library).'
        },
        result.payback ? {
            label: 'Value into play', value: avg(result.payback.expectedEffectiveValue),
            sub: `${avg(result.expectedManaValue)} printed mana value`,
            tip: 'The printed mana value of everything put onto the battlefield, plus the land and per-permanent credit set on the left.'
        } : null,
        {
            label: 'Cards that stop it', value: `${config.nonPermanents}`,
            sub: `instants & sorceries of ${config.deckSize}`,
            tip: config.surgeOnStack
                ? 'Instants and sorceries left in your library. The Primal Surge you are casting is on the stack, so it is not counted.'
                : 'Instants and sorceries in your library. Primal Surge stops at the first one it exiles.'
        }
    ].filter(Boolean));
    const notice = config.mvKnown ? '' : noticeHTML('Using card-type counts: run lengths are exact, but mana values are unknown, so payback isn’t shown. Import your decklist for the full answer.', 'flat');
    el.innerHTML = renderBottomLine({ html, tone }) + notice + hero;
}

function renderRunOdds(config, result) {
    const el = document.getElementById('surge-odds');
    if (!el) return;
    const P = config.permanents;
    const steps = CONFIG.MILESTONES.filter(k => k < P);
    const rows = steps.map(k => ({
        label: `${k}+ permanent${k === 1 ? '' : 's'}`,
        value: result.atLeast[k] ?? 0,
        tone: 'flat'
    }));
    if (P > 0) rows.push({ label: `Whole library (${P})`, value: result.atLeast[P] ?? 0, tone: 'good' });
    el.innerHTML = barsHTML(rows);
}

function renderChart(config, result) {
    const stops = config.nonPermanents;
    const lo = Math.max(0, stops - 10);
    const hi = stops + 6;
    const counts = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const hasPayback = Boolean(result.table);
    if (chart && chart.$hasPayback !== hasPayback) {
        // Axis options are fixed at creation; rebuild when the right axis comes or goes.
        chart.destroy();
        chart = null;
    }
    chart = createOrUpdateChart(chart, 'surge-chart', {
        type: 'bar',
        data: {
            labels: counts.map(String),
            datasets: [
                {
                    label: 'Permanents',
                    data: counts.map(s => +(config.permanents / (s + 1)).toFixed(2)),
                    backgroundColor: counts.map(s => s === stops ? TX_CHART.amber : fade(TX_CHART.blue, 0.45)),
                    hoverBackgroundColor: counts.map(s => s === stops ? TX_CHART.amber : fade(TX_CHART.blue, 0.7)),
                    borderRadius: 3,
                    maxBarThickness: 34,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Pays for itself',
                    type: 'line',
                    data: counts.map(s => hasPayback ? +(surgePaybackFor(result.table, s).paybackProbability * 100).toFixed(1) : null),
                    borderColor: TX_CHART.green,
                    backgroundColor: TX_CHART.green,
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: counts.map(s => s === stops ? 5 : 2),
                    pointBackgroundColor: counts.map(s => s === stops ? TX_CHART.green : TX_CHART.bg),
                    pointBorderColor: TX_CHART.green,
                    hidden: !hasPayback,
                    yAxisID: 'y2',
                    order: 1
                }
            ]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'Instants and sorceries in your library', color: TX_CHART.dim }, grid: { display: false } },
                y: { beginAtZero: true, title: { display: true, text: 'Permanents', color: TX_CHART.dim } },
                y2: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { stepSize: 25, callback: v => `${v}%` }, display: hasPayback }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => {
                            const s = Number(items[0].label);
                            const diff = s - stops;
                            return `${plural(s, 'instant or sorcery', 'instants and sorceries')}${diff === 0 ? ' (your deck)' : ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)})`}`;
                        },
                        label: item => item.datasetIndex === 0
                            ? `Permanents: ${avg(item.parsed.y)}`
                            : `Pays for itself: ${pct(item.parsed.y / 100)}`
                    }
                }
            }
        }
    });
    if (chart) chart.$hasPayback = hasPayback;
    document.querySelectorAll('#surge-tab [data-payback-key]').forEach(key => { key.hidden = !hasPayback; });
}

function renderSamples(config) {
    const el = document.getElementById('surge-samples');
    if (!el) return;
    if (!config.cards.length) {
        el.innerHTML = noticeHTML('Sample casts need a decklist with card names — import one from the deck menu.', 'flat');
        return;
    }
    const decks = sampler.get(config.deckKey, () => libraryCards(config.cards));
    el.innerHTML = decks.map((library, i) => {
        let permanents = 0;
        let manaValue = 0;
        let lands = 0;
        let stopper = null;
        const rows = [];
        for (const card of library) {
            if (!isPermanentTypeLine(card.type_line)) {
                stopper = card;
                break;
            }
            permanents++;
            manaValue += card.cmc;
            if (card.types.includes('land')) lands++;
            if (rows.length < CONFIG.SAMPLE_ROWS) {
                rows.push({
                    name: card.name,
                    type: card.types.includes('land') ? 'land' : card.types[0] ?? 'artifact',
                    mv: card.types.includes('land') && card.cmc === 0 ? '' : card.cmc,
                    fate: 'battlefield',
                    state: 'hit'
                });
            }
        }
        if (permanents > rows.length) rows.push({ more: `+ ${plural(permanents - rows.length, 'more permanent')}` });
        if (stopper) {
            rows.push({ name: stopper.name, type: stopper.types[0] ?? 'sorcery', mv: stopper.cmc, fate: 'stops it', state: 'miss' });
        }
        const scored = calculateSurgeRunValue({ manaValue, lands, permanents }, config.settings);
        return sampleCardHTML({
            title: `Shuffle ${i + 1}`,
            tag: stopper ? (scored.paidBack ? 'Pays for itself' : 'Falls short') : 'Whole library!',
            tone: scored.paidBack ? 'good' : 'bad',
            rows,
            footer: `<strong>${plural(permanents, 'permanent')}</strong> · value <strong>${avg(scored.effectiveValue)}</strong> of ${formatNumber(config.settings.threshold, config.settings.threshold % 1 ? 2 : 0)} needed`
        });
    }).join('');
}

/** The library with the cast Surge removed, one object per card. */
function libraryCards(cards) {
    const library = expandCards(cards);
    const at = library.findIndex(card => isPrimalSurge(card.name));
    if (at !== -1) library.splice(at, 1);
    return library;
}

/**
 * Group every sampled effective value into a small set of contiguous ranges.
 * The payback threshold is always a range boundary, so a range never mixes
 * whiffs with paid-back runs. Counts, rather than rounded percentages, drive
 * the chart and sum exactly to the number of samples.
 */
export function buildSurgeValueRanges(values, threshold) {
    const samples = (values ?? []).filter(Number.isFinite).map(value => Math.max(0, value));
    if (samples.length === 0) return [];

    const boundary = Math.max(0, Number.isFinite(threshold) ? threshold : CONFIG.DEFAULT_PAYBACK_THRESHOLD);
    const sortedValues = [...samples].sort((a, b) => a - b);
    const maxValue = sortedValues.at(-1);
    // Keep the common outcomes legible even when a rare full-library run is
    // much larger. The open-ended tail still counts every such result.
    const coreMax = sortedValues[Math.floor((sortedValues.length - 1) * 0.95)];
    const niceWidth = (span, targetBins) => {
        if (span <= 0) return 1;
        const rough = span / targetBins;
        const magnitude = 10 ** Math.floor(Math.log10(rough));
        return [1, 2, 5, 10].map(step => step * magnitude).find(width => width >= rough) ?? 10 * magnitude;
    };

    const ranges = [];
    if (boundary > 0) {
        const width = niceWidth(boundary, 4);
        for (let i = 0; i < Math.ceil(boundary / width); i++) {
            ranges.push({ start: i * width, end: Math.min(boundary, (i + 1) * width), count: 0, paidBack: false });
        }
    }

    const paidWidth = niceWidth(Math.max(0, coreMax - boundary), 7);
    const paidBins = coreMax >= boundary ? Math.floor((coreMax - boundary) / paidWidth) + 1 : 1;
    for (let i = 0; i < paidBins; i++) {
        ranges.push({ start: boundary + i * paidWidth, end: boundary + (i + 1) * paidWidth, count: 0, paidBack: true });
    }
    const tailStart = boundary + paidBins * paidWidth;
    if (maxValue >= tailStart) {
        ranges.push({ start: tailStart, end: Infinity, count: 0, paidBack: true });
    }

    for (const value of samples) {
        const range = ranges.find(item => value >= item.start && value < item.end);
        if (range) range.count++;
    }
    return ranges;
}

function renderSurgeValueRanges(ranges, total) {
    const label = range => Number.isFinite(range.end)
        ? `${formatNumber(range.start, 2)}–<${formatNumber(range.end, 2)}`
        : `${formatNumber(range.start, 2)}+`;
    const whiffs = ranges.filter(range => !range.paidBack).reduce((sum, range) => sum + range.count, 0);
    const paid = total - whiffs;
    const segments = ranges.filter(range => range.count > 0).map(range =>
        `<span class="surge-range-segment ${range.paidBack ? 'is-paid' : 'is-whiff'}" style="flex-grow:${range.count}" title="${label(range)} value: ${formatPercentage(range.count / total, 1)} (${range.count}/${total} runs)"></span>`
    ).join('');
    const legend = ranges.map(range => `
        <li class="surge-range-item ${range.paidBack ? 'is-paid' : 'is-whiff'}">
            <span class="surge-range-swatch" aria-hidden="true"></span>
            <span class="surge-range-label">${label(range)} value</span>
            <span class="surge-range-count">${range.count} runs</span>
            <strong>${formatPercentage(range.count / total, 1)}</strong>
        </li>`).join('');

    return `
        <div class="surge-range-band" aria-hidden="true">${segments}</div>
        <div class="surge-range-totals"><span class="is-whiff">Falls short ${pct(whiffs / total)}</span><span class="is-paid">Pays for itself ${pct(paid / total)}</span></div>
        <ul class="surge-range-list" aria-label="All value ranges">${legend}</ul>`;
}

/** Value spread over simulated casts (cached shuffles; rescored on setting changes). */
function renderValueSpread(config) {
    const el = document.getElementById('surge-spread');
    if (!el) return;
    if (!config.cards.length) {
        el.innerHTML = noticeHTML('Needs a decklist with mana values.', 'flat');
        return;
    }
    if (simulated.key !== config.deckKey) {
        const base = buildDeckExcludingSurge({ cardsByName: Object.fromEntries(config.cards.map(c => [c.name, c])) });
        const runs = [];
        for (let i = 0; i < CONFIG.SIM_RUNS; i++) {
            const library = shuffleDeck(base.slice());
            let permanents = 0;
            let manaValue = 0;
            let lands = 0;
            for (const card of library) {
                if (!card.types.some(t => t !== 'instant' && t !== 'sorcery')) break;
                permanents++;
                manaValue += card.cmc || 0;
                if (card.types.includes('land')) lands++;
            }
            runs.push({ permanents, manaValue, lands });
        }
        simulated = { key: config.deckKey, runs };
    }
    const values = simulated.runs.map(run => calculateSurgeRunValue(run, config.settings).effectiveValue);
    const ranges = buildSurgeValueRanges(values, config.settings.threshold);
    el.innerHTML = `<p class="bs-caption">${CONFIG.SIM_RUNS} shuffles of your list, each resolved to the end. The exact payback chance above is the one to trust; this shows how big the wins and misses are.</p>
        <div class="srg-spread">${renderSurgeValueRanges(ranges, values.length)}</div>`;
}

export function updateUI() {
    const { config, result } = calculate();
    if (!result) {
        const el = document.getElementById('surge-stats');
        if (el) el.innerHTML = renderBottomLine({ html: 'Add cards to your deck to see how far Primal Surge gets.', tone: 'flat' });
        chart?.destroy?.();
        chart = null;
        return;
    }
    renderAnswer(config, result);
    renderRunOdds(config, result);
    renderChart(config, result);
    renderSamples(config);
    renderValueSpread(config);
    renderHowItCompares('big-spell-comparison-surge', { x: CONFIG.COST, source: 'surge', deckKey: config.deckKey });
}

export function init() {
    registerCalculator({
        name: 'surge',
        calculate,
        updateUI,
        init: debouncedUpdate => {
            ['surge-payback-threshold', 'surge-land-value', 'surge-card-value'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', debouncedUpdate);
            });
            document.getElementById('surge-reshuffle-btn')?.addEventListener('click', () => {
                sampler.reshuffle();
                renderSamples(getDeckConfig());
            });
        }
    });
}
