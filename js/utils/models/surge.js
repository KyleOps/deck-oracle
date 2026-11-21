/**
 * Primal Surge — {8}{G}{G} sorcery. The page's maths.
 *
 * "Exile the top card of your library. If it's a permanent card, you may put
 * it onto the battlefield. If you do, repeat this process."
 *
 * The run stops at the first instant or sorcery, so its length depends only on
 * where the first of those sits in a shuffled library. Everything headline is
 * exact: the run-length odds are a product of draw-without-replacement
 * fractions, and the payback chance is a subset-sum count over the permanents
 * (a run of length k is a uniformly random k-subset of your permanents).
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { createCache, formatNumber } from '../simulation.js';
import { toneFor } from '../components.js';
import { buildDeckFromCardData } from '../sampleSimulator.js';
import { pmfQuantiles, splitDots } from '../viz.js';
import { escapeHtml } from '../../data/glossary.js';
import { choose } from '../hypergeometric.js';
import { isLand, isPermanent } from '../library.js';
import { avg, pct, plural } from '../text.js';
import { cardListKey } from './cardList.js';

export const SURGE = Object.freeze({
    /** Primal Surge's mana value: what a run has to put into play to pay for itself. */
    COST: 10,
    DEFAULT_PAYBACK_THRESHOLD: 10,
    DEFAULT_LAND_VALUE: 1,
    DEFAULT_CARD_VALUE: 0.25,
    /** Values are counted in quarter-mana steps. */
    VALUE_STEP: 0.25
});

export const PRIMAL_SURGE = 'Primal Surge';

const subsetCache = createCache(16);

const valueCache = createCache(16);

function clampNumber(value, fallback, min = 0, max = 100) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/**
 * Score one Primal Surge run using the visible value model.
 * @param {{manaValue:number, lands:number, permanents:number}} run
 * @param {{threshold?:number, landValue?:number, cardValue?:number}} settings
 * @returns {{effectiveValue:number, paidBack:boolean}}
 */
export function calculateSurgeRunValue(run, settings = {}) {
    const threshold = clampNumber(settings.threshold, SURGE.DEFAULT_PAYBACK_THRESHOLD, 0, 100);
    const landValue = clampNumber(settings.landValue, SURGE.DEFAULT_LAND_VALUE, 0, 20);
    const cardValue = clampNumber(settings.cardValue, SURGE.DEFAULT_CARD_VALUE, 0, 20);
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
    const threshold = clampNumber(settings.threshold, SURGE.DEFAULT_PAYBACK_THRESHOLD, 0, 100);
    const landValue = clampNumber(settings.landValue, SURGE.DEFAULT_LAND_VALUE, 0, 20);
    const cardValue = clampNumber(settings.cardValue, SURGE.DEFAULT_CARD_VALUE, 0, 20);
    const values = [];
    for (const card of permanentCards ?? []) {
        const count = Math.max(0, Math.floor(clampNumber(card?.count, 1, 0, 500)));
        const value = clampNumber(card?.cmc, 0, 0, 100) + cardValue + (card?.isLand ? landValue : 0);
        for (let i = 0; i < count; i++) values.push(value);
    }
    const permanents = values.length;
    const totalValue = values.reduce((sum, v) => sum + v, 0);
    if (threshold <= 0) return { threshold, permanents, totalValue, shortBySize: null };

    const scale = 1 / SURGE.VALUE_STEP;
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
export function surgePaybackFor(table, nonPermanents) {
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
    const landValue = clampNumber(settings.landValue, SURGE.DEFAULT_LAND_VALUE, 0, 20);
    const cardValue = clampNumber(settings.cardValue, SURGE.DEFAULT_CARD_VALUE, 0, 20);
    const scale = 1 / SURGE.VALUE_STEP;
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
export function surgeDots({ permanents, stops, table = null, valuePmf = null, threshold = SURGE.DEFAULT_PAYBACK_THRESHOLD }) {
    const runs = pmfQuantiles(surgeRunPmf(permanents, stops), 100);
    const value = valuePmf ? pmfQuantiles(valuePmf, 100).map(v => ({ value: v, tone: v >= threshold - 1e-9 ? 'good' : 'bad' })) : null;
    if (!table) return { permanents: runs.map(k => ({ value: k, tone: 'flat' })), value };

    const paidShare = k => (table.shortBySize ? 1 - (table.shortBySize[k] ?? 1) : 1);
    const goodTotal = value ? value.filter(d => d.tone === 'good').length : undefined;
    return { permanents: splitDots(runs, paidShare, goodTotal), value };
}

/** The library options for Primal Surge: the cast copy is on the stack. */
export const ON_STACK = Object.freeze({ exclude: [PRIMAL_SURGE] });

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
 * The value model from raw input values (strings or numbers, defaults when
 * missing), clamped and rounded to the quarter-mana step the exact maths uses.
 * @param {{threshold?:*, landValue?:*, cardValue?:*}} [raw]
 * @returns {{threshold:number, landValue:number, cardValue:number}}
 */
export function surgeSettings({ threshold, landValue, cardValue } = {}) {
    const roundToStep = value => Math.round(value / SURGE.VALUE_STEP) * SURGE.VALUE_STEP;
    return {
        threshold: roundToStep(clampNumber(threshold, SURGE.DEFAULT_PAYBACK_THRESHOLD, SURGE.VALUE_STEP, 100)),
        landValue: roundToStep(clampNumber(landValue, SURGE.DEFAULT_LAND_VALUE, 0, 20)),
        cardValue: roundToStep(clampNumber(cardValue, SURGE.DEFAULT_CARD_VALUE, 0, 20))
    };
}

/**
 * The library Primal Surge resolves into, from a card list that already
 * leaves out the cast copy (deckCardList(deck, ON_STACK)).
 * @param {ReadonlyArray<{name:string, type_line:string, cmc:number, count:number}>} cards
 * @param {{surgeOnStack:boolean, settings:Object}} opts - whether the list
 *   named the cast copy, and surgeSettings()
 */
export function surgeFromList(cards, { surgeOnStack = false, settings = surgeSettings() } = {}) {
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

/**
 * The same from type counts only: one instant or sorcery is taken to be the
 * Surge being cast, and mana values are unknown (no payback odds).
 * @param {Object} counts - DeckConfig type counts (instants, sorceries, lands)
 * @param {number} fullDeckSize - cards in the library before the cast
 * @param {Object} [settings] - surgeSettings()
 */
export function surgeFromCounts(counts, fullDeckSize, settings = surgeSettings()) {
    const totalNonPermanents = (counts?.instants ?? 0) + (counts?.sorceries ?? 0);
    const surgeOnStack = totalNonPermanents >= 1;
    const deckSize = surgeOnStack ? fullDeckSize - 1 : fullDeckSize;
    const nonPermanents = surgeOnStack ? totalNonPermanents - 1 : totalNonPermanents;
    const permanents = Math.max(0, deckSize - nonPermanents);
    const lands = Math.min(counts?.lands ?? 0, permanents);
    return {
        deckSize, nonPermanents, permanents, cards: [], lands, totalPermCMC: 0,
        permanentCards: [], surgeOnStack, mvKnown: false, settings,
        deckKey: `counts:${deckSize}:${nonPermanents}:${lands}`
    };
}

/**
 * Exact results for a library from surgeFromList() / surgeFromCounts(): run
 * length, its odds, and (with mana values) the payback chance. Null for an
 * empty library.
 */
export function surgeResult(config) {
    if (!config || config.deckSize <= 0) return null;
    const result = simulatePrimalSurge(config.deckSize, config.nonPermanents, config.permanents);
    const odds = surgeRunOdds(config.permanents, config.nonPermanents);
    const table = config.mvKnown ? cachedSubsets(config.deckKey, config.permanentCards, config.settings) : null;
    const payback = table ? surgePaybackFor(table, config.nonPermanents) : null;
    return {
        ...result,
        ...odds,
        payback,
        table,
        expectedManaValue: config.permanents > 0 ? result.expectedPermanents * config.totalPermCMC / config.permanents : 0,
        expectedLands: config.permanents > 0 ? result.expectedPermanents * config.lands / config.permanents : 0
    };
}

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

/** surgeValuePmf() for a library from surgeFromList(), cached per deck, stops and values. */
export function cachedValuePmf(config) {
    const { landValue, cardValue } = config.settings;
    const key = `${config.deckKey}|${config.nonPermanents}|${landValue}|${cardValue}`;
    let pmf = valueCache.get(key);
    if (!pmf) {
        pmf = surgeValuePmf(config.permanentCards, config.nonPermanents, config.settings);
        valueCache.set(key, pmf);
    }
    return pmf;
}

export const valueText = v => formatNumber(v, v % 1 ? 2 : 0);

/**
 * One Primal Surge resolution, card by card, for the "Cast it" animation:
 * permanents go to the battlefield and it repeats; the first instant or
 * sorcery stops it. Pure — the library is a shuffled list of card records.
 *
 * @param {Array<{name:string, type_line:string, cmc:number, types:string[]}>} library
 * @param {{threshold:number, landValue:number, cardValue:number}} settings
 */
export function surgeCastPlan(library, settings) {
    const threshold = settings?.threshold ?? SURGE.DEFAULT_PAYBACK_THRESHOLD;
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
