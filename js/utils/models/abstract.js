/**
 * Abstract Performance — {5}{U} sorcery. The page's maths.
 *
 * "Exile the top four cards of your library in a face-down pile, then exile the
 * top four cards of your library in a face-up pile. An opponent chooses one of
 * those piles. Put that pile into your graveyard. Look at the cards in the
 * other pile. You may cast a spell from among them without paying its mana
 * cost. Put the rest into your hand."
 *
 * Simulated: deal two piles of four from a shuffled copy of the library and
 * record the best spell you could cast free from the pile you keep, under three
 * opponents:
 *   - guesses right: knows both piles and bins the one with more total mana value
 *   - guesses wrong: bins the one with less (your best case)
 *   - realistic: sees only the face-up pile, and bins it when it is worth more
 *     than an average four cards; otherwise bins the unseen face-down pile
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { partialShuffle } from '../random.js';
import { asLibrary, expandLibrary, isLand } from '../library.js';
import { quantile } from '../stats.js';
import { one, pct } from '../text.js';

export const ITERATIONS = 25000;

export const PILE_SIZE = 4;

export const SAMPLE_CASTS = 4;

/** Histogram buckets: mana value 0..9, then 10+. */
export const BUCKETS = 11;

/** Fallback curve when no decklist is loaded (~99-card Commander deck). */
const DEFAULT_DIST = [
    { cmc: 0, count: 36, isLand: true },
    { cmc: 1, count: 10, isLand: false },
    { cmc: 2, count: 15, isLand: false },
    { cmc: 3, count: 12, isLand: false },
    { cmc: 4, count: 10, isLand: false },
    { cmc: 5, count: 8, isLand: false },
    { cmc: 6, count: 5, isLand: false },
    { cmc: 7, count: 3, isLand: false }
];

/**
 * The library as {name, cmc, isLand}, one entry per copy, lands included and
 * commanders left out (see library.js).
 *
 * Built from the card records (every card, with names). An earlier version
 * read `cardDetails`, which the importer fills with NONLAND cards only — so
 * every simulated pile was dealt from a deck with no lands, inflating the free
 * spell and making "all lands, nothing to cast" impossible.
 *
 * @param {Object} source - a Library from libraryOf(), or a DeckConfig snapshot
 * @returns {{deck:Array<{name:string, cmc:number, isLand:boolean}>, isDefault:boolean}}
 */
export function buildLibrary(source) {
    const library = asLibrary(source);
    if (library.size >= PILE_SIZE * 2) {
        const deck = expandLibrary(library, card => ({
            name: card.name,
            cmc: Math.max(0, Math.floor(Number(card.cmc) || 0)),
            isLand: isLand(card),
            isX: /\{X\}/i.test(card.mana_cost ?? '')
        }));
        return { deck, isDefault: false };
    }
    const deck = [];
    for (const { cmc, count, isLand: land } of DEFAULT_DIST) {
        for (let i = 0; i < count; i++) deck.push({ name: land ? 'Land' : 'Spell', cmc, isLand: land });
    }
    return { deck, isDefault: true };
}

function totalMV(pile) {
    return pile.reduce((sum, card) => sum + (card?.cmc ?? 0), 0);
}

/**
 * The highest mana value of any nonland card in the pile (0 if none).
 * @param {Array} pile
 * @returns {number}
 */
export function bestFreeCastMV(pile) {
    let max = 0;
    for (const card of pile) {
        if (!card.isLand && (card.cmc ?? 0) > max) max = card.cmc;
    }
    return max;
}

/** The card you would cast from a pile (highest mana value nonland), or null. */
export function bestFreeCast(pile) {
    let best = null;
    for (const card of pile) {
        if (card.isLand) continue;
        if (!best || (card.cmc ?? 0) > (best.cmc ?? 0)) best = card;
    }
    return best;
}

/**
 * Which pile a face-up-only opponent bins. They cannot see the face-down pile,
 * so they compare the face-up pile with an average four cards and bin it when
 * it looks better than that.
 *
 * @returns {boolean} true when they bin the face-up pile (you keep face-down)
 */
export function opponentBinsFaceUp(faceUp, expectedFourMV) {
    return totalMV(faceUp) > expectedFourMV;
}

function histogramStats(hist, sum, n) {
    return {
        mean: n ? sum / n : 0,
        dist: hist.map(c => (n ? c / n : 0)),
        p25: quantile(hist, 0.25),
        p50: quantile(hist, 0.5),
        p75: quantile(hist, 0.75)
    };
}

/**
 * Monte Carlo over the three opponent models. Means use exact mana values;
 * the distributions fold 10 and above into one "10+" bucket.
 *
 * @param {Array<{name:string, cmc:number, isLand:boolean}>} deck
 * @param {number} iterations
 * @returns {{best:Object, worst:Object, realistic:Object, deckSize:number, expectedFourMV:number}|null}
 */
export function simulateAbstractPerformance(deck, iterations) {
    const deckSize = Array.isArray(deck) ? deck.length : 0;
    if (deckSize < PILE_SIZE * 2) return null;
    const n = Math.max(0, Math.floor(Number(iterations) || 0));

    const totalDeckMV = deck.reduce((s, c) => s + (c.cmc ?? 0), 0);
    // Expected total mana value of four random cards: the realistic opponent's yardstick.
    const expectedFourMV = (totalDeckMV / deckSize) * PILE_SIZE;

    const best = new Array(BUCKETS).fill(0);
    const worst = new Array(BUCKETS).fill(0);
    const realistic = new Array(BUCKETS).fill(0);
    const sums = { best: 0, worst: 0, realistic: 0 };
    const record = (hist, key, v) => { hist[Math.min(v, BUCKETS - 1)]++; sums[key] += v; };

    // A partial Fisher–Yates over any permutation yields a uniformly random
    // ordered sample, so one working copy is reshuffled in place each time.
    const d = deck.slice();
    for (let i = 0; i < n; i++) {
        partialShuffle(d, PILE_SIZE * 2, deckSize);
        const faceDown = d.slice(0, PILE_SIZE);
        const faceUp = d.slice(PILE_SIZE, PILE_SIZE * 2);
        const mvFD = totalMV(faceDown);
        const mvFU = totalMV(faceUp);
        const richer = mvFD >= mvFU ? faceDown : faceUp;
        const poorer = richer === faceDown ? faceUp : faceDown;

        record(best, 'best', bestFreeCastMV(richer));
        record(worst, 'worst', bestFreeCastMV(poorer));
        record(realistic, 'realistic', bestFreeCastMV(mvFU > expectedFourMV ? faceDown : faceUp));
    }

    return {
        best: histogramStats(best, sums.best, n),
        worst: histogramStats(worst, sums.worst, n),
        realistic: histogramStats(realistic, sums.realistic, n),
        deckSize,
        expectedFourMV
    };
}

/**
 * Deal sample casts: both piles, which one the realistic opponent bins, and
 * what you cast from the other.
 */
export function dealSampleCasts(deck, count = SAMPLE_CASTS) {
    if (!Array.isArray(deck) || deck.length < PILE_SIZE * 2) return [];
    const expectedFourMV = (totalMV(deck) / deck.length) * PILE_SIZE;
    const d = deck.slice();
    const out = [];
    for (let i = 0; i < count; i++) {
        partialShuffle(d, PILE_SIZE * 2, d.length);
        const faceDown = d.slice(0, PILE_SIZE);
        const faceUp = d.slice(PILE_SIZE, PILE_SIZE * 2);
        const binsFaceUp = opponentBinsFaceUp(faceUp, expectedFourMV);
        const kept = binsFaceUp ? faceDown : faceUp;
        out.push({
            faceDown, faceUp, binsFaceUp, expectedFourMV,
            faceUpMV: totalMV(faceUp),
            cast: bestFreeCast(kept)
        });
    }
    return out;
}

/** "7", or "10+" for the top bucket. */
export const mvLabel = v => (v >= BUCKETS - 1 ? `${BUCKETS - 1}+` : String(v));

/** Tone of the realistic outcome: a free spell of 4+ is a strong return on six mana. */
export function outcomeTone(mean) {
    if (mean >= 4) return 'good';
    if (mean >= 2.5) return 'warn';
    return 'bad';
}

/**
 * The plain-English answer to "What will your opponent leave you from the two piles?".
 * @param {{results:Object|null, isDefault?:boolean}} input
 * @returns {{html:string, tone:string}}
 */
export function summarize({ results, isDefault = false } = {}) {
    if (!results) {
        return { tone: 'flat', html: 'Abstract Performance needs at least eight cards in your library to deal two piles.' };
    }
    const r = results.realistic;
    const range = r.p25 === r.p75 ? '' : ` (half of casts ${mvLabel(r.p25)}–${mvLabel(r.p75)})`;
    const deckWord = isDefault ? 'In a typical Commander deck, an' : 'An';
    const nothing = r.dist[0] ?? 0;
    let html = `${deckWord} opponent who can only see the face-up pile usually leaves you a free <strong>${mvLabel(r.p50)}-mana</strong> spell${range}, and the other three cards go to your hand. `
        + `If they always pick right you still average <strong>${one(results.worst.mean)}</strong>; if they pick wrong, <strong>${one(results.best.mean)}</strong>.`;
    if (nothing >= 0.005) html += ` About ${pct(nothing)} of casts leave you nothing to cast.`;
    return { html, tone: outcomeTone(r.mean) };
}
