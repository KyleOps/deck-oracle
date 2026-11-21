/**
 * The command zone: every commander a deck has (one, a partner pair, a Doctor
 * and their companion, a commander and a background) and the rules every page
 * uses to name and count them.
 *
 * Shape everywhere: `Array<{ name: string, card: Object|null }>`, in deck
 * order. `card` is the commander's own card record (cost, colours, type) when
 * known. Imports keep commanders out of `cardsByName`: they start the game in
 * the command zone, never in the library.
 *
 * Pure and DOM-free, so the deck state, the deck library, saved-deck lists and
 * comparisons all share one rule.
 */

/** Most commanders kept per deck: two by the rules, with room for oddities. */
export const MAX_COMMANDERS = 4;

/**
 * Front face, lowercased: how a commander is matched to a card record.
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function frontName(name) {
    return String(name ?? '').split('//')[0].trim().toLowerCase();
}

/**
 * Clean a commander list: drop blank names and duplicates (by front face),
 * and drop a card record that belongs to a different card.
 * @param {Array<string|{name?:string, card?:Object|null}>|null|undefined} list
 * @returns {Array<{name:string, card:Object|null}>}
 */
export function normalizeCommanders(list) {
    const out = [];
    const seen = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
        const name = String((typeof entry === 'string' ? entry : entry?.name ?? entry?.card?.name) ?? '').trim();
        const key = frontName(name);
        if (!key || seen.has(key) || out.length >= MAX_COMMANDERS) continue;
        seen.add(key);
        const card = entry?.card;
        out.push({ name, card: card && typeof card === 'object' && frontName(card.name) === key ? card : null });
    }
    return out;
}

/**
 * The commanders of any deck-shaped object: its `commanders` list when it has
 * one, else the single legacy `commanderName` / `commanderCard` pair (decks
 * saved before multiple commanders were kept).
 * @param {Object} [deck]
 * @returns {Array<{name:string, card:Object|null}>}
 */
export function readCommanders(deck = {}) {
    const listed = normalizeCommanders(deck?.commanders);
    if (listed.length) return listed;
    return deck?.commanderName ? normalizeCommanders([{ name: deck.commanderName, card: deck.commanderCard }]) : [];
}

/**
 * "The Sixth Doctor + Susan Foreman", or null without a commander.
 * @param {Array<string|{name:string}>} commanders
 * @returns {string|null}
 */
export function commanderLabel(commanders) {
    const names = (Array.isArray(commanders) ? commanders : [])
        .map(c => (typeof c === 'string' ? c : c?.name))
        .filter(Boolean);
    return names.length ? names.join(' + ') : null;
}

/**
 * How many commanders are not also in the library list. Imports keep the
 * command zone out of `cardsByName`; the bundled example and some pasted lists
 * keep a commander in the list too, and that copy must not count twice.
 * @param {Array} commanders
 * @param {Record<string, Object>} [cardsByName]
 * @returns {number}
 */
export function commandZoneExtras(commanders, cardsByName = {}) {
    const list = normalizeCommanders(commanders);
    if (list.length === 0) return 0;
    const inLibrary = new Set();
    for (const card of Object.values(cardsByName ?? {})) {
        if (card?.name && Number(card.count) > 0) inLibrary.add(frontName(card.name));
    }
    return list.filter(c => !inLibrary.has(frontName(c.name))).length;
}

/**
 * A deck's size the way players say it: the library plus every commander not
 * already counted in it. 98 cards and two commanders is a 100-card deck.
 * Calculators keep using the library size for the odds; this is for labels.
 * @param {number} library - cards in the library (DeckConfig.getDeckSize)
 * @param {Array} commanders
 * @param {Record<string, Object>} [cardsByName]
 * @returns {{total:number, library:number, commanders:number, label:string, detail:string|null}}
 */
export function deckSizeSummary(library, commanders, cardsByName = {}) {
    const lib = Math.max(0, Math.floor(Number(library) || 0));
    const extra = commandZoneExtras(commanders, cardsByName);
    const total = lib + extra;
    return {
        total,
        library: lib,
        commanders: extra,
        label: `${total} card${total === 1 ? '' : 's'}`,
        detail: extra ? `${lib} in the library + ${extra} commander${extra === 1 ? '' : 's'}` : null
    };
}
