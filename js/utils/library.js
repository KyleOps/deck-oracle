/**
 * The deck → library step, and the card typing every page shares.
 *
 * One rule, everywhere: **commanders are never in the library.** In
 * Commander every card in the command zone (one commander, partners, a Doctor
 * and their companion, a commander and a background) starts there, so it can
 * never be drawn, revealed, milled or discovered. A list may or may not hold
 * its commanders (imports leave them out, some pasted lists keep them in);
 * either way the library built here is the same. Other formats have no
 * command zone, so a card named as a commander there is just a card.
 *
 * Pure: no DOM, no deck state. Pages pass a DeckConfig snapshot (or a bare
 * cardsByName map plus options) and map the counted records it returns to
 * their own shapes.
 */

import { hashString } from './random.js';

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * The key two card names match on: the front face, trimmed, lower-cased.
 * "Sea Gate Restoration // Sea Gate, Reborn" and "sea gate restoration" match.
 * @param {*} name
 * @returns {string}
 */
export function nameKey(name) {
    return String(name ?? '').split('//')[0].trim().toLowerCase();
}

/** Do two card names refer to the same card (front face, any case)? */
export function sameCard(a, b) {
    const ka = nameKey(a);
    return ka !== '' && ka === nameKey(b);
}

// ── Card types ───────────────────────────────────────────────────────────────

/** Every card type a library card can have (kindred aside), in display order. */
export const CARD_TYPES = Object.freeze(['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land', 'instant', 'sorcery']);

/** Card types that make a card a permanent card. */
export const PERMANENT_TYPES = Object.freeze(['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land']);

const TYPE_PATTERNS = CARD_TYPES.map(type => [type, new RegExp(`\\b${type}\\b`)]);
const typeCache = new Map();
const TYPE_CACHE_LIMIT = 4000;

/**
 * The front face of a type line. A double-faced card in a library has only
 * its front face's characteristics, so "Sorcery // Land" is a sorcery there.
 * @param {*} typeLine
 * @returns {string} lower-cased
 */
export function frontTypeLine(typeLine) {
    return String(typeLine ?? '').split('//')[0].toLowerCase();
}

/**
 * Card types on a type line's front face, in CARD_TYPES order. Whole words
 * only, so subtypes never leak in.
 * @param {*} typeLine - e.g. "Legendary Artifact Creature — Golem"
 * @returns {ReadonlyArray<string>} keys from CARD_TYPES (frozen, shared)
 */
export function cardTypes(typeLine) {
    const key = String(typeLine ?? '');
    let types = typeCache.get(key);
    if (types) return types;
    const front = frontTypeLine(key);
    types = Object.freeze(TYPE_PATTERNS.filter(([, re]) => re.test(front)).map(([type]) => type));
    if (typeCache.size >= TYPE_CACHE_LIMIT) typeCache.clear();
    typeCache.set(key, types);
    return types;
}

/** The type line of a card record (snake_case or camelCase), or a string as-is. */
function typeLineOf(card) {
    if (typeof card === 'string') return card;
    return card?.type_line ?? card?.typeLine ?? '';
}

/**
 * Is this a land? Accepts a type line, a card record (`type_line`, or an
 * import's `category: 'lands'`), or a simulation card that already knows
 * (`land: boolean` or `types: [...]`).
 * @param {string|Object|null|undefined} card
 * @returns {boolean}
 */
export function isLand(card) {
    if (card == null) return false;
    if (typeof card === 'string') return cardTypes(card).includes('land');
    if (typeof card.land === 'boolean') return card.land;
    if (Array.isArray(card.types)) return card.types.includes('land');
    if (card.category === 'lands') return true;
    return cardTypes(typeLineOf(card)).includes('land');
}

/**
 * Is this a permanent card (creature, artifact, enchantment, planeswalker,
 * battle or land)? Accepts what isLand() accepts.
 * @param {string|Object|null|undefined} card
 * @returns {boolean}
 */
export function isPermanent(card) {
    if (card == null) return false;
    const types = typeof card !== 'string' && Array.isArray(card.types) ? card.types : cardTypes(typeLineOf(card));
    return types.some(type => PERMANENT_TYPES.includes(type));
}

// ── The library ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Library
 * @property {ReadonlyArray<Object>} cards - the deck's card records with
 *   `count` ≥ 1, in list order. Records are the deck's own objects, except
 *   that a record losing a copy (a commander or an `exclude` the list holds)
 *   is a shallow copy with the smaller count.
 * @property {number} size - copies in the library
 * @property {ReadonlyArray<string>} commanders - names kept in the command
 *   zone (always [] outside Commander)
 * @property {ReadonlyArray<string>} removed - listed cards taken out, one entry
 *   per copy (commanders the list held, then `exclude` matches)
 * @property {string} key - content signature: equal for equal libraries
 */

const cache = new WeakMap();
const EMPTY_MAP = Object.freeze({});

/** The cardsByName map of a snapshot (or the map itself). */
function cardsByNameOf(deck) {
    if (!deck || typeof deck !== 'object') return EMPTY_MAP;
    if (deck.cardsByName && typeof deck.cardsByName === 'object') return deck.cardsByName;
    // A bare map: every value is a card record. A snapshot without a list
    // (counts only) has no cardsByName and no record-shaped values.
    return isSnapshot(deck) ? EMPTY_MAP : deck;
}

const SNAPSHOT_KEYS = ['commanderName', 'commanders', 'cardDetails', 'importSource', 'actualCardCount', 'lands'];
function isSnapshot(obj) {
    return SNAPSHOT_KEYS.some(key => key in obj);
}

/** Command-zone names from a list of names or {name} records. */
function namesFrom(list) {
    if (!Array.isArray(list)) return [];
    return list.map(c => (typeof c === 'string' ? c : c?.name)).filter(n => typeof n === 'string' && n.trim() !== '');
}

/** Names in order, trimmed, each card once (by nameKey). */
function uniqueNames(names) {
    const seen = new Set();
    const out = [];
    for (const raw of names) {
        const name = raw.trim();
        const k = nameKey(name);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(name);
    }
    return out;
}

/**
 * The command zone of a deck snapshot: `commanders` ([{name}] or names) when
 * present, else `commanderName`.
 * @param {Object} deck
 * @returns {string[]}
 */
export function commanderNamesOf(deck) {
    const listed = namesFrom(deck?.commanders);
    if (listed.length) return listed;
    return typeof deck?.commanderName === 'string' && deck.commanderName.trim() ? [deck.commanderName] : [];
}

/**
 * Does this format have a command zone? Accepts a format object ({key}), a
 * key, or a DeckConfig preference ('auto' / null), where a deck with
 * commanders is Commander (exactly how format.js detects it).
 */
function commandZone(format, commanders) {
    const key = typeof format === 'string' ? format : format?.key;
    if (!key || key === 'auto') return commanders.length > 0;
    return key === 'commander';
}

/**
 * The library a deck draws from.
 *
 * @param {Object} deck - a DeckConfig snapshot (getDeckConfig(), or anything
 *   with `cardsByName`) or a bare cardsByName map
 * @param {Object} [opts]
 * @param {Object|string} [opts.format] - format object or key; default: the
 *   snapshot's `format` preference (Commander when it is 'auto' and the deck
 *   has commanders)
 * @param {Array<string|{name:string}>} [opts.commanders] - the command zone;
 *   default: the snapshot's `commanders`, else its `commanderName`
 * @param {string[]} [opts.exclude] - more cards that are elsewhere (the spell
 *   on the stack): one listed copy is removed per entry, if the list has one
 * @returns {Library} frozen; the same object for the same `cardsByName`
 *   object and options, so pages can cache on its identity
 */
export function libraryOf(deck, { format, commanders, exclude } = {}) {
    const cardsByName = cardsByNameOf(deck);
    const zone = commanders === undefined ? commanderNamesOf(deck) : namesFrom(commanders);
    const fmt = format === undefined ? deck?.format : format;
    const kept = commandZone(fmt, zone) ? uniqueNames(zone) : [];
    const extra = namesFrom(exclude).map(n => n.trim());

    const optionKey = `${kept.map(nameKey).join('\u0001')}\u0002${extra.map(nameKey).join('\u0001')}`;
    let byOptions = cache.get(cardsByName);
    if (!byOptions) {
        byOptions = new Map();
        cache.set(cardsByName, byOptions);
    }
    const hit = byOptions.get(optionKey);
    if (hit) return hit;

    const library = buildLibrary(cardsByName, kept, extra);
    byOptions.set(optionKey, library);
    return library;
}

function buildLibrary(cardsByName, commanders, exclude) {
    // Copies to take out, by name key: one per commander, one per exclude entry.
    const owed = new Map();
    for (const name of [...commanders, ...exclude]) {
        const k = nameKey(name);
        if (k) owed.set(k, (owed.get(k) ?? 0) + 1);
    }
    const commanderKeys = new Set(commanders.map(nameKey));

    const cards = [];
    const removedCommanders = [];
    const removedOther = [];
    let size = 0;
    for (const card of Object.values(cardsByName)) {
        if (!card || typeof card !== 'object' || !card.name) continue;
        let count = Math.max(0, Math.floor(Number(card.count) || 0));
        if (count <= 0) continue;
        const k = nameKey(card.name);
        const take = Math.min(count, owed.get(k) ?? 0);
        if (take > 0) {
            owed.set(k, owed.get(k) - take);
            count -= take;
            // A commander is owed first, so its copy is the one reported as such.
            const asCommander = commanderKeys.has(k) ? 1 : 0;
            for (let i = 0; i < take; i++) (i < asCommander ? removedCommanders : removedOther).push(card.name);
        }
        if (count <= 0) continue;
        cards.push(count === card.count ? card : Object.freeze({ ...card, count }));
        size += count;
    }

    const signature = cards.map(c => `${c.name}\u0001${c.count}`).sort().join('\u0002');
    return Object.freeze({
        cards: Object.freeze(cards),
        size,
        commanders: Object.freeze(commanders.slice()),
        removed: Object.freeze([...removedCommanders, ...removedOther]),
        key: `${size}:${hashString(signature).toString(36)}`
    });
}

/**
 * One entry per physical card. `map(record, copy)` builds each entry; return
 * the same object for every copy when entries are immutable.
 * @template T
 * @param {Library|ReadonlyArray<Object>} library - a Library or its `cards`
 * @param {(record:Object, copy:number) => T} [map] - default: the record itself
 * @returns {T[]}
 */
export function expandLibrary(library, map = record => record) {
    const records = Array.isArray(library) ? library : (library?.cards ?? []);
    const out = [];
    for (const record of records) {
        const count = Math.max(0, Math.floor(Number(record?.count) || 0));
        for (let i = 0; i < count; i++) out.push(map(record, i));
    }
    return out;
}

/**
 * The card record for a name in a library (exact name first, then front face
 * in any case), or null.
 * @param {Library|ReadonlyArray<Object>} library
 * @param {string} name
 */
export function findInLibrary(library, name) {
    const records = Array.isArray(library) ? library : (library?.cards ?? []);
    return records.find(c => c?.name === name)
        ?? (nameKey(name) ? records.find(c => sameCard(c?.name, name)) : null)
        ?? null;
}
