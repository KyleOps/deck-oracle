/**
 * Deck sites: which links we accept, fetching a deck through our proxy, and
 * reading each site's JSON into one neutral shape.
 *
 *   { deckName, cards: [{ name, count, raw }], commanders: [{ name, raw }],
 *     sideboardCount }
 *
 * `raw` is the site's own card object; decklistImport turns it into a card
 * record (and asks Scryfall when the site's data is too thin). Reading is pure,
 * so each site's quirks are tested against fixtures shaped like its real API.
 */

import { fetchJson } from './fetchJson.js';

/** Our Cloudflare Worker (serverless/worker.js): Moxfield and Archidekt send no CORS headers. */
export const PROXY_URL = 'https://hidden-river-b602.kylepettigrew.workers.dev';
const DECK_TIMEOUT_MS = 20000;
const MAX_INPUT_LENGTH = 200;

/**
 * Which site a link (or bare Moxfield id) points at.
 * @param {string} input
 * @returns {{site:'moxfield'|'archidekt'|null, id:string|null}}
 */
export function parseDeckInput(input) {
    const none = { site: null, id: null };
    if (!input || typeof input !== 'string') return none;
    const trimmed = input.trim();
    if (trimmed.length > MAX_INPUT_LENGTH) return none;

    // https://www.moxfield.com/decks/ABC123xyz_-
    const moxfield = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?moxfield\.com\/decks\/([a-zA-Z0-9_-]{8,32})(?:[/?#]|$)/);
    if (moxfield) return { site: 'moxfield', id: moxfield[1] };
    // https://archidekt.com/decks/123456/name — numeric ids only
    const archidekt = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?archidekt\.com\/decks\/(\d{1,10})(?:[/?#]|$)/);
    if (archidekt) return { site: 'archidekt', id: archidekt[1] };
    // A bare id is taken as Moxfield's (Archidekt ids are plain numbers).
    if (/^[a-zA-Z0-9_-]{8,32}$/.test(trimmed)) return { site: 'moxfield', id: trimmed };
    return none;
}

/** The API URL the proxy fetches for a deck. */
export function deckApiUrl(site, id) {
    return site === 'archidekt'
        ? `https://archidekt.com/api/decks/${id}/`
        : `https://api2.moxfield.com/v3/decks/all/${id}`;
}

// ── Moxfield ────────────────────────────────────────────────────────────────

function boardEntries(board) {
    return Object.values(board?.cards ?? {}).filter(e => e?.card?.name);
}

/**
 * Read a Moxfield v3 deck. Commanders (partners, a background, a Doctor's
 * companion: everything on the commanders board) are kept apart from the
 * mainboard; companions, the sideboard and the maybeboard are left out.
 * @param {Object} data - api2.moxfield.com/v3/decks/all/<id>
 */
export function readMoxfieldDeck(data = {}) {
    const boards = data?.boards ?? {};
    const cards = boardEntries(boards.mainboard).map(e => ({
        name: e.card.name, count: Math.max(1, Number(e.quantity) || 1), raw: e.card
    }));
    const commanders = boardEntries(boards.commanders).map(e => ({ name: e.card.name, raw: e.card }));
    const sideboardCount = boardEntries(boards.sideboard).reduce((s, e) => s + (Number(e.quantity) || 1), 0);
    return { deckName: data?.name ?? null, cards, commanders, sideboardCount };
}

// ── Archidekt ───────────────────────────────────────────────────────────────

/** Categories that are never part of the deck, whatever the deck's settings say. */
const OUT_OF_DECK = new Set(['sideboard', 'maybeboard', 'considering']);

/**
 * Read an Archidekt deck. A card is a commander when it is in the
 * "Commander" category; it is out of the deck when any of its categories is
 * a sideboard / maybeboard, or is marked "not included in deck".
 * Archidekt's card objects are camelCase (`manaCost`, `text`, `faces`), and
 * the printing (`card.uid`) carries the Scryfall id the oracle card lacks.
 * @param {Object} data - archidekt.com/api/decks/<id>/
 */
export function readArchidektDeck(data = {}) {
    const excluded = new Set((data?.categories ?? [])
        .filter(c => c?.includedInDeck === false && c.name)
        .map(c => String(c.name).toLowerCase()));
    const cards = [];
    const commanders = [];
    let sideboardCount = 0;
    for (const entry of Array.isArray(data?.cards) ? data.cards : []) {
        const oracle = entry?.card?.oracleCard ?? entry?.card;
        if (!oracle?.name) continue;
        const raw = { ...oracle, scryfallId: oracle.scryfallId ?? entry.card?.uid };
        const categories = (entry.categories ?? []).map(c => String(c).toLowerCase());
        const count = Math.max(1, Number(entry.quantity) || 1);
        if (categories.includes('commander')) {
            commanders.push({ name: oracle.name, raw });
            continue;
        }
        if (categories.some(c => OUT_OF_DECK.has(c) || excluded.has(c)) || entry.companion === true) {
            if (categories.includes('sideboard')) sideboardCount += count;
            continue;
        }
        cards.push({ name: oracle.name, count, raw });
    }
    return { deckName: data?.name ?? null, cards, commanders, sideboardCount };
}

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * Fetch a deck from a Moxfield or Archidekt link, through the proxy.
 * @param {string} input - a deck link or a bare Moxfield id
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<{site:string, deckName:string|null, cards:Array, commanders:Array, sideboardCount:number}>}
 */
export async function fetchDeck(input, { signal } = {}) {
    const { site, id } = parseDeckInput(input);
    if (!site) throw new Error('Invalid URL or ID. Supports Moxfield and Archidekt.');
    const url = `${PROXY_URL}?url=${encodeURIComponent(deckApiUrl(site, id))}`;
    const data = await fetchJson(url, { signal, timeoutMs: DECK_TIMEOUT_MS });
    const deck = site === 'archidekt' ? readArchidektDeck(data) : readMoxfieldDeck(data);
    return { site, ...deck };
}
