/**
 * Scryfall card lookups for the importers: batched, cached, rate limited and
 * bounded in time.
 *
 * `lookupCards(names)` answers with a Map from each requested name to its card,
 * so a name Scryfall had to correct ("Sol Rnig" → Sol Ring, found by the fuzzy
 * fallback) still lands on the line that asked for it.
 */

import { fetchJson } from './fetchJson.js';

const SCRYFALL_API = 'https://api.scryfall.com';
/** Scryfall's /cards/collection takes at most 75 identifiers per request. */
export const COLLECTION_BATCH_SIZE = 75;
/** Fuzzy lookups for names the collection endpoint missed, run a few at a time. */
const FUZZY_BATCH_SIZE = 5;
/** Scryfall asks for 50–100 ms between requests. */
const REQUEST_GAP_MS = 100;
const COLLECTION_TIMEOUT_MS = 15000;
const FUZZY_TIMEOUT_MS = 10000;

const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Lookup key: front face only, lowercased.
 * @param {string} name
 * @returns {string}
 */
export function cardKey(name) {
    return typeof name === 'string' ? name.split('//')[0].trim().toLowerCase() : '';
}

/**
 * LRU cache with a time-to-live. A Map keeps insertion order, so re-inserting
 * on every hit makes the first key the least recently used.
 */
export class CardCache {
    constructor(maxSize = CACHE_MAX_SIZE, ttlMs = CACHE_TTL_MS, now = () => Date.now()) {
        this.map = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.now = now;
    }

    get(name) {
        const key = cardKey(name);
        const entry = this.map.get(key);
        if (!entry) return null;
        this.map.delete(key);
        if (this.now() - entry.at > this.ttlMs) return null;
        this.map.set(key, entry);
        return entry.card;
    }

    set(name, card) {
        const key = cardKey(name);
        if (!key) return;
        this.map.delete(key);
        if (this.map.size >= this.maxSize) this.map.delete(this.map.keys().next().value);
        this.map.set(key, { card, at: this.now() });
    }

    get size() {
        return this.map.size;
    }

    clear() {
        this.map.clear();
    }
}

const cache = new CardCache();

/** Requests in the last minute, for a sliding-window limit (Scryfall allows ~10/s). */
const rateLimit = {
    stamps: [],
    perMinute: 200,
    burst: 60,
    burstWindowMs: 10000,
    allow(now = Date.now()) {
        this.stamps = this.stamps.filter(t => now - t < 60000);
        const recent = this.stamps.filter(t => now - t < this.burstWindowMs).length;
        if (recent >= this.burst || this.stamps.length >= this.perMinute) return false;
        this.stamps.push(now);
        return true;
    }
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fuzzy single-card lookup; null when not found or not allowed right now. */
async function fuzzyLookup(name, signal) {
    if (!rateLimit.allow()) return null;
    try {
        return await fetchJson(`${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(name)}`, { signal, timeoutMs: FUZZY_TIMEOUT_MS });
    } catch (error) {
        if (error?.kind === 'aborted') throw error;
        return null;
    }
}

/**
 * Look up cards by name.
 *
 * Cached names are answered at once; the rest go to /cards/collection in
 * batches of 75, and names it misses are retried with the fuzzy endpoint.
 * A failed batch is not fatal: its names come back missing and the importer
 * reports them. Cancelling `signal` stops between requests and rejects.
 *
 * @param {string[]} names
 * @param {{signal?:AbortSignal, onBatch?:(done:number, total:number)=>void}} [opts]
 * @returns {Promise<Map<string, Object>>} requested name → Scryfall card
 */
export async function lookupCards(names, { signal, onBatch } = {}) {
    const found = new Map();
    const pending = new Map(); // front-face key → requested names
    for (const name of new Set(names)) {
        const key = cardKey(name);
        if (!key) continue;
        const cached = cache.get(name);
        if (cached) {
            found.set(name, cached);
            continue;
        }
        if (!pending.has(key)) pending.set(key, []);
        pending.get(key).push(name);
    }
    const keys = [...pending.keys()];
    const settle = (requestKey, card) => {
        for (const name of pending.get(requestKey) ?? []) {
            found.set(name, card);
            cache.set(name, card);
        }
        cache.set(card.name, card);
        pending.delete(requestKey);
    };

    let failure = null;
    const unreachable = new Set();
    for (let i = 0; i < keys.length; i += COLLECTION_BATCH_SIZE) {
        if (i > 0) await pause(REQUEST_GAP_MS);
        const batch = keys.slice(i, i + COLLECTION_BATCH_SIZE);
        // Front face only: Scryfall matches "Delver of Secrets", not the full "A // B".
        const identifiers = batch.map(key => ({ name: pending.get(key)[0].split('//')[0].trim() }));
        try {
            rateLimit.allow();
            const data = await fetchJson(`${SCRYFALL_API}/cards/collection`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifiers }),
                signal,
                timeoutMs: COLLECTION_TIMEOUT_MS
            });
            for (const card of Array.isArray(data?.data) ? data.data : []) {
                if (!card?.name) continue;
                const key = [cardKey(card.name), cardKey(card.card_faces?.[0]?.name)].find(k => pending.has(k));
                if (key) settle(key, card);
            }
        } catch (error) {
            if (error?.kind === 'aborted') throw error;
            // Scryfall is down or unreachable: retrying each name one by one
            // would only take longer to fail.
            failure = error;
            batch.forEach(key => unreachable.add(key));
        }
        onBatch?.(Math.min(i + COLLECTION_BATCH_SIZE, keys.length), keys.length);
    }

    // Whatever the collection endpoint missed (typos, odd punctuation): fuzzy.
    const missed = [...pending.keys()].filter(key => !unreachable.has(key));
    for (let i = 0; i < missed.length; i += FUZZY_BATCH_SIZE) {
        if (i > 0) await pause(REQUEST_GAP_MS);
        const batch = missed.slice(i, i + FUZZY_BATCH_SIZE);
        const cards = await Promise.all(batch.map(key => fuzzyLookup(pending.get(key)[0].split('//')[0].trim(), signal)));
        cards.forEach((card, j) => { if (card?.name) settle(batch[j], card); });
    }
    // Nothing at all came back because Scryfall couldn't be reached: say so,
    // rather than reporting every card as misspelt.
    if (failure && found.size === 0) throw failure;
    return found;
}

/** Test hook: forget cached cards and request history. */
export function resetScryfallForTests() {
    cache.clear();
    rateLimit.stamps = [];
}
