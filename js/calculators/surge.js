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

import { createCache, formatNumber } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor, toneFor } from '../utils/components.js';
import { buildDeckFromCardData } from '../utils/sampleSimulator.js';
import { describeDots, dotPlot, pmfQuantiles, splitDots } from '../utils/viz.js';
import { escapeHtml } from '../data/glossary.js';
import { cardImageUrl, findCard } from '../data/images.js';
import { closeCast, playCast, syncCast } from '../utils/castAnimation.js';
import { shuffle } from '../utils/random.js';
import { choose } from '../utils/hypergeometric.js';
import { isLand, isPermanent, libraryOf, sameCard } from '../utils/library.js';
import { avg, pct, plural } from '../utils/text.js';
import {
    cardListKey, createSampler, deckCardList, expandCards, fade,
    noticeHTML, renderHowItCompares, sampleCardHTML
} from '../utils/bigSpells.js';

const PRIMAL_SURGE = 'Primal Surge';

const CONFIG = Object.freeze({
    DEFAULT_PAYBACK_THRESHOLD: 10,
    DEFAULT_LAND_VALUE: 1,
    DEFAULT_CARD_VALUE: 0.25,
    VALUE_STEP: 0.25,
    SAMPLE_COUNT: 4,
    SAMPLE_ROWS: 10,
    COST: 10
});

const subsetCache = createCache(16);
const sampler = createSampler(CONFIG.SAMPLE_COUNT);
let chart = null;
const valueCache = createCache(16);
/** Which quantity the "out of 100 casts" dots are stacked by. */
let dotView = 'permanents';

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
        const total = choose(permanents, size);
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

/**
 * Exact chance the run is exactly k permanents long (k = 0..P): the first k
 * cards are permanents and the next is an instant or sorcery (or, with no
 * stops at all, the run is always the whole library).
 * @param {number} permanents
 * @param {number} nonPermanents
 * @returns {number[]}
 */
export function surgeRunPmf(permanents, nonPermanents) {
    const P = Math.max(0, Math.floor(permanents));
    const NP = Math.max(0, Math.floor(nonPermanents));
    const pmf = new Array(P + 1).fill(0);
    if (NP === 0) {
        pmf[P] = 1;
        return pmf;
    }
    const N = P + NP;
    let survives = 1;
    for (let k = 0; k <= P; k++) {
        pmf[k] = survives * NP / (N - k);
        if (k < P) survives *= (P - k) / (N - k);
    }
    return pmf;
}

/**
 * Exact distribution of one run's value. A run of k permanents is an equally
 * likely pick of any k of them, so for every k this counts the k-subsets at
 * each total value (an uncapped subset-sum in quarter-mana steps) and weights
 * them by the chance the run is exactly k long.
 *
 * @param {Array<{cmc:number, isLand:boolean, count?:number}>} permanentCards
 * @param {number} nonPermanents
 * @param {{landValue?:number, cardValue?:number}} [settings]
 * @returns {Array<{value:number, p:number}>} ascending by value
 */
export function surgeValuePmf(permanentCards, nonPermanents, settings = {}) {
    const landValue = clampNumber(settings.landValue, CONFIG.DEFAULT_LAND_VALUE, 0, 20);
    const cardValue = clampNumber(settings.cardValue, CONFIG.DEFAULT_CARD_VALUE, 0, 20);
    const scale = 1 / CONFIG.VALUE_STEP;
    const units = [];
    for (const card of permanentCards ?? []) {
        const count = Math.max(0, Math.floor(clampNumber(card?.count, 1, 0, 500)));
        const value = clampNumber(card?.cmc, 0, 0, 100) + cardValue + (card?.isLand ? landValue : 0);
        for (let i = 0; i < count; i++) units.push(Math.max(0, Math.round(value * scale)));
    }
    const P = units.length;
    const runPmf = surgeRunPmf(P, nonPermanents);
    const totalUnits = units.reduce((a, b) => a + b, 0);
    const ways = Array.from({ length: P + 1 }, () => new Float64Array(totalUnits + 1));
    ways[0][0] = 1;
    let reach = 0;
    units.forEach((u, i) => {
        for (let size = i + 1; size >= 1; size--) {
            const previous = ways[size - 1];
            const current = ways[size];
            for (let sum = reach; sum >= 0; sum--) {
                if (previous[sum]) current[sum + u] += previous[sum];
            }
        }
        reach += u;
    });
    const pmf = new Float64Array(totalUnits + 1);
    for (let k = 0; k <= P; k++) {
        if (!runPmf[k]) continue;
        const weight = runPmf[k] / choose(P, k);
        const row = ways[k];
        for (let sum = 0; sum <= totalUnits; sum++) if (row[sum]) pmf[sum] += row[sum] * weight;
    }
    const out = [];
    pmf.forEach((p, sum) => { if (p > 0) out.push({ value: sum / scale, p }); });
    return out;
}

const DOT_LEGEND = Object.freeze([
    { tone: 'good', label: 'paid for itself' },
    { tone: 'bad', label: 'fell short' }
]);

/**
 * The 100 "out of 100 casts" dots for either view.
 *
 * Permanents: dots stacked by run length (exact). Within a run length, the
 * share that pays for itself is exact too (subset table), and the number of
 * solid dots is fixed to match the value view, so the two views agree.
 * Value: dots stacked by the value put into play (exact), split at the target.
 *
 * @param {{permanents:number, stops:number, table?:Object|null, valuePmf?:Array|null, threshold:number}} a
 * @returns {{permanents:Array<{value:number,tone:string}>, value:Array<{value:number,tone:string}>|null}}
 */
export function surgeDots({ permanents, stops, table = null, valuePmf = null, threshold = CONFIG.DEFAULT_PAYBACK_THRESHOLD }) {
    const runs = pmfQuantiles(surgeRunPmf(permanents, stops), 100);
    const value = valuePmf ? pmfQuantiles(valuePmf, 100).map(v => ({ value: v, tone: v >= threshold - 1e-9 ? 'good' : 'bad' })) : null;
    if (!table) return { permanents: runs.map(k => ({ value: k, tone: 'flat' })), value };

    const paidShare = k => (table.shortBySize ? 1 - (table.shortBySize[k] ?? 1) : 1);
    const goodTotal = value ? value.filter(d => d.tone === 'good').length : undefined;
    return { permanents: splitDots(runs, paidShare, goodTotal), value };
}

// ── The library ──────────────────────────────────────────────────────────────

/** The library options for Primal Surge: the cast copy is on the stack. */
const ON_STACK = Object.freeze({ exclude: [PRIMAL_SURGE] });

/**
 * Build the sampled library with the cast copy of Primal Surge on the stack.
 * A list without a named copy already represents a library without Surge;
 * removing an unrelated instant or sorcery would change the stop odds.
 * Commanders are never in it (see library.js).
 * @param {Object} deck - a DeckConfig snapshot (or {cardsByName})
 * @returns {Array} - Deck array without one named Primal Surge, if present
 */
export function buildDeckExcludingSurge(deck) {
    return buildDeckFromCardData(deck, ON_STACK);
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
    const cards = deckCardList(deck, ON_STACK);
    const settings = getPaybackSettings();

    if (cards.length > 0) {
        const surgeOnStack = libraryOf(deck, ON_STACK).removed.some(name => sameCard(name, PRIMAL_SURGE));
        let deckSize = 0;
        let nonPermanents = 0;
        let lands = 0;
        let totalPermCMC = 0;
        const permanentCards = [];
        for (const card of cards) {
            deckSize += card.count;
            if (!isPermanent(card.type_line)) {
                nonPermanents += card.count;
                continue;
            }
            const land = isLand(card.type_line);
            permanentCards.push({ name: card.name, cmc: card.cmc, isLand: land, count: card.count });
            if (land) lands += card.count;
            totalPermCMC += card.cmc * card.count;
        }
        return {
            deckSize, nonPermanents, permanents: deckSize - nonPermanents,
            cards, lands, totalPermCMC, permanentCards,
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
        deckSize, nonPermanents, permanents, cards: [], lands, totalPermCMC: 0,
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
    return { html, tone: toneFor(a.payback) };
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
            color: p == null ? 'var(--tx-dim)' : toneColor(toneFor(p)),
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

function cachedValuePmf(config) {
    const { landValue, cardValue } = config.settings;
    const key = `${config.deckKey}|${config.nonPermanents}|${landValue}|${cardValue}`;
    let pmf = valueCache.get(key);
    if (!pmf) {
        pmf = surgeValuePmf(config.permanentCards, config.nonPermanents, config.settings);
        valueCache.set(key, pmf);
    }
    return pmf;
}

const valueText = v => formatNumber(v, v % 1 ? 2 : 0);

/** "Out of 100 casts": exact run lengths (or values), split by payback. */
function renderDots(config, result) {
    const el = document.getElementById('surge-dots');
    if (!el) return;
    const threshold = config.settings.threshold;
    const hasValue = Boolean(result.table);
    if (!hasValue) dotView = 'permanents';
    const valuePmf = hasValue ? cachedValuePmf(config) : null;
    const dots = surgeDots({ permanents: config.permanents, stops: config.nonPermanents, table: result.table, valuePmf, threshold });
    const legend = hasValue ? DOT_LEGEND : [];
    const byValue = dotView === 'value' && dots.value;

    document.querySelectorAll('#surge-tab [data-surge-view]').forEach(btn => {
        const on = btn.dataset.surgeView === dotView;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    const toggle = document.getElementById('surge-dots-view');
    if (toggle) toggle.hidden = !hasValue;

    const shown = byValue ? dots.value : dots.permanents;
    const format = byValue ? valueText : v => String(v);
    const summary = describeDots(shown, { unit: 'cast', format, legend });
    const label = `${byValue ? 'Value put into play' : 'Permanents put into play'}, out of 100 casts. ${summary}`;

    let table;
    if (byValue) {
        const step = Math.max(CONFIG.VALUE_STEP, threshold);
        const bands = [{ lo: 0, hi: threshold, label: `Under ${valueText(threshold)} (falls short)` }];
        for (let lo = threshold; lo < threshold + step * 4; lo += step) {
            bands.push({ lo, hi: lo + step, label: `${valueText(lo)} to under ${valueText(lo + step)}` });
        }
        bands.push({ lo: threshold + step * 4, hi: Infinity, label: `${valueText(threshold + step * 4)} or more` });
        const chance = band => valuePmf.reduce((s, e) => s + (e.value >= band.lo - 1e-9 && e.value < band.hi - 1e-9 ? e.p : 0), 0);
        table = {
            summary: 'Exact chances',
            caption: 'Exact chance of each value range',
            head: ['Value put into play', 'Chance'],
            rows: bands.filter(b => b.hi > b.lo).map(b => [escapeHtml(b.label), pct(chance(b))])
        };
    } else {
        const runPmf = surgeRunPmf(config.permanents, config.nonPermanents);
        const rows = [];
        for (let k = 0; k <= config.permanents; k++) {
            if (k > 0 && (result.atLeast[k] ?? 0) < 0.0005 && k !== config.permanents) continue;
            const paid = result.table?.shortBySize ? 1 - (result.table.shortBySize[k] ?? 1) : null;
            rows.push([
                k === config.permanents && config.permanents > 0 ? `${k} (whole library)` : String(k),
                pct(runPmf[k] ?? 0),
                pct(result.atLeast[k] ?? 0),
                ...(hasValue ? [result.table.shortBySize ? pct(paid) : '100%'] : [])
            ]);
        }
        table = {
            summary: 'Exact chances',
            caption: 'Exact chance of each run length',
            head: ['Permanents', 'Exactly', 'At least', ...(hasValue ? ['Pays for itself'] : [])],
            rows
        };
    }

    el.innerHTML = dotPlot({
        dots: shown,
        label,
        unit: 'cast',
        format,
        xLabel: byValue ? 'Value put into play (mana value + credits)' : 'Permanents put onto the battlefield',
        threshold: byValue ? threshold : null,
        thresholdLabel: byValue ? `${valueText(threshold)}+ pays for itself` : '',
        legend,
        maxColumns: byValue ? 28 : 32,
        table
    });
    const caption = document.getElementById('surge-dots-caption');
    if (caption) {
        caption.innerHTML = byValue
            ? 'Each dot is one cast in a hundred, stacked by the value it puts into play. Solid dots reach your target; rings fall short. Exact, not simulated.'
            : `Each dot is one cast in a hundred, stacked by how many permanents it puts onto the battlefield before an instant or sorcery stops it.${hasValue ? ' Solid dots paid for themselves; rings fell short.' : ''} Exact, not simulated.`;
    }
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
    const castBtn = document.getElementById('surge-cast-btn');
    if (castBtn) castBtn.hidden = !config.cards.length;
    syncCast(document.getElementById('surge-cast'), config.cards.length ? castKey(config) : null);
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
            if (!isPermanent(card.type_line)) {
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

/**
 * One Primal Surge resolution, card by card, for the "Cast it" animation:
 * permanents go to the battlefield and it repeats; the first instant or
 * sorcery stops it. Pure — the library is a shuffled list of card records.
 *
 * @param {Array<{name:string, type_line:string, cmc:number, types:string[]}>} library
 * @param {{threshold:number, landValue:number, cardValue:number}} settings
 */
export function surgeCastPlan(library, settings) {
    const threshold = settings?.threshold ?? CONFIG.DEFAULT_PAYBACK_THRESHOLD;
    const steps = [];
    let permanents = 0;
    let manaValue = 0;
    let lands = 0;
    let stopper = null;
    const totalsAt = () => {
        const { effectiveValue, paidBack } = calculateSurgeRunValue({ manaValue, lands, permanents }, settings);
        return {
            value: effectiveValue,
            paidBack,
            totals: [
                { label: 'Permanents', value: String(permanents) },
                { label: 'Value', value: `${avg(effectiveValue)} <small>of ${valueText(threshold)}</small>`, tone: paidBack ? 'good' : undefined }
            ]
        };
    };
    for (const card of library ?? []) {
        if (!isPermanent(card.type_line)) {
            stopper = card;
            const kind = (card.types ?? []).includes('instant') ? 'an instant' : 'a sorcery';
            steps.push({ name: card.name, fate: 'stop', note: `${kind}, not a permanent — Primal Surge stops here.`, totals: totalsAt().totals });
            break;
        }
        permanents += 1;
        manaValue += card.cmc || 0;
        const isLandCard = (card.types ?? []).includes('land');
        if (isLandCard) lands += 1;
        const kind = isLandCard ? 'a land' : `a permanent (mana value ${card.cmc || 0})`;
        steps.push({ name: card.name, fate: 'battlefield', note: `${kind} — onto the battlefield, and Surge exiles the next card.`, totals: totalsAt().totals });
    }
    const end = totalsAt();
    const run = `${plural(permanents, 'permanent')} onto the battlefield, worth ${avg(end.value)}`;
    const summary = stopper
        ? `${run} — ${end.paidBack ? '<strong>pays for itself</strong>' : '<strong>falls short</strong>'} of ${valueText(threshold)}. ${escapeHtml(stopper.name)} stopped it.`
        : `Every card was a permanent: ${run}. The whole library!`;
    return { steps, permanents, value: end.value, paidBack: end.paidBack, stopped: Boolean(stopper), summary, startTotals: [
        { label: 'Permanents', value: '0' },
        { label: 'Value', value: `0 <small>of ${valueText(threshold)}</small>` }
    ] };
}

/** The library (the cast Surge already out of `cards`), one object per card. */
function libraryCards(cards) {
    return expandCards(cards);
}

function imageFor(name) {
    const record = findCard(DeckConfig.getImportedCardData()?.cardsByName ?? {}, name);
    return cardImageUrl(record ?? name, 'small');
}

/** What a cast depends on: a different deck or setting closes an open cast. */
const castKey = config => `${config.deckKey}|${JSON.stringify(config.settings)}`;

/** "Cast it": a fresh shuffle resolved card by card. */
function castIt() {
    const config = getDeckConfig();
    const stage = document.getElementById('surge-cast');
    if (!stage || !config.cards.length) return;
    const library = libraryCards(config.cards);
    shuffle(library);
    const plan = surgeCastPlan(library, config.settings);
    playCast(stage, { ...plan, outLabel: 'Stopped by', librarySize: library.length, imageFor, key: castKey(config) }, castIt);
}

export function updateUI() {
    const { config, result } = calculate();
    if (!result) {
        const el = document.getElementById('surge-stats');
        if (el) el.innerHTML = renderBottomLine({ html: 'Add cards to your deck to see how far Primal Surge gets.', tone: 'flat' });
        const dots = document.getElementById('surge-dots');
        if (dots) dots.innerHTML = '';
        closeCast(document.getElementById('surge-cast'));
        chart?.destroy?.();
        chart = null;
        return;
    }
    renderAnswer(config, result);
    renderDots(config, result);
    renderChart(config, result);
    renderSamples(config);
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
            document.getElementById('surge-cast-btn')?.addEventListener('click', castIt);
            document.getElementById('surge-cast')?.addEventListener('cast-closed', () => {
                document.getElementById('surge-cast-btn')?.focus({ preventScroll: true });
            });
            document.getElementById('surge-dots-view')?.addEventListener('click', e => {
                const view = e.target.closest('[data-surge-view]')?.dataset.surgeView;
                if (!view || view === dotView) return;
                dotView = view;
                const { config, result } = calculate();
                if (result) renderDots(config, result);
            });
        }
    });
}
