/**
 * The opponent library the multiplayer models read — Ensnared by the Mara,
 * Dream Harvest and Mind's Dilation: a compact library model (built once per
 * imported deck), deterministic random draws, and distribution helpers.
 *
 * Pure: no DOM, no opponent state. The pages pass each opponent's deck data
 * in; js/utils/opponentPages.js keeps the page state and shared markup.
 */

import { cardTypes, expandLibrary, frontTypeLine, isLand, libraryOf } from '../library.js';
import { hashString } from '../random.js';
import { quantile } from '../stats.js';
import { one } from '../text.js';

// ── Library model ───────────────────────────────────────────────────────────

const TYPE_ORDER = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land'];

/** @returns {boolean} historic = artifact, legendary or Saga (front face) */
export function isHistoricType(typeLine) {
    return /\b(artifact|legendary|saga)\b/.test(frontTypeLine(typeLine));
}

function primaryType(typeLine) {
    const types = cardTypes(typeLine);
    return TYPE_ORDER.find(t => types.includes(t)) ?? 'artifact';
}

const libraries = new WeakMap();

/**
 * An opponent's library as an array of compact, frozen card records — one per
 * physical card — built once per imported deck. Commanders are never in it
 * (see library.js): an opponent's list may name them through `commanders` /
 * `commanderName`.
 * @param {Object} data - opponent deck data with cardsByName
 * @returns {Array<{name:string, cmc:number, land:boolean, historic:boolean, type:string, types:string[]}>}
 */
export function opponentLibrary(data) {
    if (!data?.cardsByName) return [];
    const source = libraryOf(data, { format: 'commander' });
    const cached = libraries.get(source);
    if (cached) return cached;
    const library = expandLibrary(source.cards.map(card => {
        const typeLine = String(card.type_line ?? '');
        const land = isLand(typeLine);
        const type = land ? 'land' : primaryType(typeLine);
        return {
            count: card.count,
            record: Object.freeze({
                name: String(card.name ?? 'Unknown card'),
                cmc: Math.max(0, Number(card.cmc) || 0),
                land,
                historic: !land && isHistoricType(typeLine),
                type,
                types: Object.freeze([type])
            })
        };
    }), entry => entry.record);
    libraries.set(source, library);
    return library;
}

// ── Randomness ──────────────────────────────────────────────────────────────
// Seeds: hashString(); draws: mulberry32() — both in random.js.

/** A seed that depends only on the list's contents: same deck, same answer. */
export function deckSeed(library) {
    const counts = new Map();
    for (const card of library) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    return hashString([...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, c]) => `${c} ${n}`).join('\n'));
}

/**
 * Reveal cards from the top of a shuffled library one at a time, shuffling only
 * as far as the reveal goes (a lazy Fisher–Yates). Call reset() before each run;
 * the pool stays a permutation, so continuing the shuffle from it is still
 * uniform and nothing is re-allocated between runs.
 * @param {Array} cards
 * @param {Function} [rng=Math.random]
 */
export function createRevealer(cards, rng = Math.random) {
    const pool = cards.slice();
    let next = 0;
    return {
        reset() { next = 0; },
        reveal() {
            if (next >= pool.length) return null;
            const j = next + Math.floor(rng() * (pool.length - next));
            const card = pool[j];
            pool[j] = pool[next];
            pool[next] = card;
            next += 1;
            return card;
        }
    };
}

// ── Distributions & formatting ──────────────────────────────────────────────

/** The middle half of outcomes, [25th, 75th percentile] (stats.js quantile). */
export function typicalRange(dist) {
    return [quantile(dist, 0.25), quantile(dist, 0.75)];
}

/** "3" or "2–4". */
export function formatRange([lo, hi]) {
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/** P(X ≥ k) from a weight array. */
export function tailAtLeast(dist, k) {
    let total = 0;
    let tail = 0;
    dist.forEach((w, v) => {
        total += w || 0;
        if (v >= k) tail += w || 0;
    });
    return total > 0 ? tail / total : 0;
}

/** Bucket a distribution: values ≥ cap pile into the last bucket. */
export function capDistribution(dist, cap) {
    const out = new Array(cap + 1).fill(0);
    dist.forEach((w, v) => { out[Math.min(v, cap)] += w || 0; });
    return out;
}

/** "the three decks" / "this deck" style counts in prose. */
export function countWord(n) {
    return ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);
}

/**
 * Per-opponent averages in prose: "about 4.2 mana", or the range when the
 * opponents differ by half a point or more ("3.1–5.0 mana").
 * @param {number[]} values - one per opponent
 * @param {string} unit
 */
export function spread(values, unit) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.length > 1 && hi - lo >= 0.5
        ? `${one(lo)}–${one(hi)} ${unit}`
        : `about ${one(mean)} ${unit}`;
}

/**
 * A total measured against the card's own cost, in words.
 * @param {number} total - mana value gained
 * @param {number} cost - the card's mana value
 * @param {string} [owner='its'] - whose cost: "its", "Mara’s"
 */
export function versusCost(total, cost, owner = 'its') {
    if (total >= 2 * cost) return `more than twice ${owner} ${cost}-mana cost`;
    if (total >= cost) return `more than ${owner} ${cost}-mana cost`;
    return `less than ${owner} ${cost}-mana cost`;
}
