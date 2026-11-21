/**
 * Deck library — every imported deck is kept in localStorage so it survives a
 * reload and can be switched back to without re-fetching.
 *
 * Storage is injected (defaults to window.localStorage) so the module is
 * testable in Node, and every access is guarded: private windows, blocked
 * storage and quota errors degrade to "nothing saved", never to a crash.
 */

const KEY = 'deckOracle.library.v1';
const ACTIVE_KEY = 'deckOracle.activeDeck.v1';
export const MAX_DECKS = 24;

/** Card fields worth persisting; everything else is re-derivable or unused. */
const CARD_FIELDS = ['name', 'type_line', 'cmc', 'mana_cost', 'oracle_text', 'power', 'toughness',
    'category', 'allCategories', 'count', 'colors', 'color_identity', 'produced_mana', 'scryfall_id'];

function defaultStorage() {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
}

function read(storage, key, fallback) {
    try {
        const raw = storage?.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function write(storage, key, value) {
    try {
        storage?.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * Stable id for a deck: its import URL when it has one (re-importing the same
 * Moxfield deck updates the entry instead of duplicating it), otherwise a hash
 * of its card list.
 */
export function deckId(deck = {}) {
    if (deck.importUrl) return `url:${String(deck.importUrl).trim().toLowerCase().replace(/\/+$/, '')}`;
    const names = Object.values(deck.cardsByName ?? {})
        .map(c => `${c?.count ?? 0}x${c?.name ?? ''}`).sort().join('|');
    let h = 2166136261;
    for (let i = 0; i < names.length; i++) {
        h ^= names.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return `list:${(h >>> 0).toString(36)}`;
}

/**
 * Reduce a DeckConfig snapshot to what needs persisting.
 * @param {Object} deck - DeckConfig.getDeckConfig() output
 */
function slimCard(card) {
    const slim = {};
    CARD_FIELDS.forEach(f => { if (card[f] !== undefined && card[f] !== null && card[f] !== '') slim[f] = card[f]; });
    return slim;
}

export function snapshotDeck(deck = {}) {
    const cardsByName = {};
    for (const [key, card] of Object.entries(deck.cardsByName ?? {})) {
        if (!card) continue;
        cardsByName[key] = slimCard(card);
    }
    const commander = deck.commanderName && deck.commanderCard && typeof deck.commanderCard === 'object'
        ? slimCard(deck.commanderCard) : null;
    return {
        id: deckId(deck),
        name: deck.deckName || deck.commanderName || 'Untitled deck',
        commanderName: deck.commanderName ?? null,
        // The commander's own record (cost, colours, art) — it is never in cardsByName.
        commanderCard: commander?.name ? commander : null,
        importUrl: deck.importUrl ?? null,
        importSource: deck.importSource ?? null,
        format: deck.format ?? 'auto',
        counts: {
            creatures: deck.creatures, instants: deck.instants, sorceries: deck.sorceries,
            artifacts: deck.artifacts, enchantments: deck.enchantments, planeswalkers: deck.planeswalkers,
            lands: deck.lands, battles: deck.battles
        },
        actualCardCount: deck.actualCardCount ?? null,
        creaturesPower5Plus: deck.creaturesPower5Plus ?? 0,
        cardDetails: deck.cardDetails ?? [],
        cardsByName,
        savedAt: Date.now()
    };
}

/** List saved decks, most recent first (summaries only — cheap to render). */
export function listDecks(storage = defaultStorage()) {
    const decks = read(storage, KEY, []);
    if (!Array.isArray(decks)) return [];
    return decks
        .filter(d => d && d.id)
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
        .map(d => ({
            id: d.id,
            name: d.name,
            commanderName: d.commanderName,
            importSource: d.importSource,
            importUrl: d.importUrl,
            format: d.format,
            cardCount: d.actualCardCount ?? Object.values(d.cardsByName ?? {}).reduce((s, c) => s + (Number(c.count) || 0), 0),
            savedAt: d.savedAt
        }));
}

/** Full saved deck by id, or null. */
export function getDeck(id, storage = defaultStorage()) {
    const decks = read(storage, KEY, []);
    return Array.isArray(decks) ? decks.find(d => d?.id === id) ?? null : null;
}

/**
 * Save (or refresh) a deck. Oldest entries beyond MAX_DECKS are dropped, and
 * if the browser's quota is hit the oldest are evicted until it fits.
 * @returns {string|null} the saved deck id, or null when storage is unavailable
 */
export function saveDeck(deck, storage = defaultStorage()) {
    if (!storage) return null;
    const snap = deck?.cardsByName && deck.savedAt ? deck : snapshotDeck(deck);
    const decks = (read(storage, KEY, []) || []).filter(d => d?.id && d.id !== snap.id);
    decks.unshift(snap);
    let trimmed = decks.slice(0, MAX_DECKS);
    while (trimmed.length > 0 && !write(storage, KEY, trimmed)) {
        if (trimmed.length === 1) return null;
        trimmed = trimmed.slice(0, -1);
    }
    return snap.id;
}

/** Update fields on a saved deck (e.g. rename, change format). */
export function updateDeckMeta(id, patch = {}, storage = defaultStorage()) {
    const decks = read(storage, KEY, []);
    if (!Array.isArray(decks)) return false;
    const deck = decks.find(d => d?.id === id);
    if (!deck) return false;
    Object.assign(deck, patch);
    return write(storage, KEY, decks);
}

export function deleteDeck(id, storage = defaultStorage()) {
    const decks = read(storage, KEY, []);
    if (!Array.isArray(decks)) return false;
    const next = decks.filter(d => d?.id !== id);
    if (getActiveDeckId(storage) === id) setActiveDeckId(null, storage);
    return write(storage, KEY, next);
}

export function getActiveDeckId(storage = defaultStorage()) {
    try {
        return storage?.getItem(ACTIVE_KEY) ?? null;
    } catch {
        return null;
    }
}

export function setActiveDeckId(id, storage = defaultStorage()) {
    try {
        if (id) storage?.setItem(ACTIVE_KEY, id);
        else storage?.removeItem(ACTIVE_KEY);
    } catch {
        // storage unavailable — the active deck simply won't persist
    }
}
