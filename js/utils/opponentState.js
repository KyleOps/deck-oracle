/**
 * Shared opponent decklists: state and imports.
 *
 * The multiplayer calculators (Ensnared by the Mara, Dream Harvest, Mind's
 * Dilation) all read the same up-to-three opponent libraries. This module owns
 * that state and the import lifecycle (loading / failed / loaded per seat).
 * The "Opponent decklists" bar that edits it is js/shell/opponentBar.js,
 * loaded only with the pages that use it; the import code loads on the first
 * import.
 *
 * Public API used elsewhere — keep these names and signatures:
 *   opponentPages.js → getActiveOpponents, getOpponentData, getImportStatus,
 *                      seatColor, focusImportField
 *   share.js         → getOpponentUrls, setOpponentUrl
 *   calculators      → onOpponentChange
 */

import { commanderLabel } from './commanders.js';
import { loadImporter, explainImportError } from './importLoader.js';

export const MAX_OPPONENTS = 3;
export const SEAT_KEYS = Object.freeze(['opponent1', 'opponent2', 'opponent3']);

/** Seat identity colours, shared by the bar and every per-opponent chart/table. */
const SEAT_COLORS = ['var(--series-3)', 'var(--series-5)', 'var(--series-6)'];

/**
 * The colour that identifies a seat everywhere it appears.
 * @param {number} index - 0-based seat index
 * @returns {string} a CSS colour token
 */
export function seatColor(index) {
    return SEAT_COLORS[((index % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

/** "Opponent 2" for opponent2. */
export function defaultName(key) {
    return key.replace('opponent', 'Opponent ');
}

function emptyDeck(key) {
    return { cardsByName: {}, deckSize: 0, name: defaultName(key), importUrl: null, commanders: [] };
}

const opponentDecks = Object.fromEntries(SEAT_KEYS.map(k => [k, emptyDeck(k)]));

let activeOpponents = ['opponent1'];

/** Per-seat import status: { state: 'loading'|'error', pct, message, token }. Absent = idle. */
const seatStatus = {};

const changeListeners = [];
const progressListeners = [];

// ── State queries ───────────────────────────────────────────────────────────

/** Does a seat's deck have any cards? */
export function hasCards(data) {
    return Boolean(data?.cardsByName && Object.keys(data.cardsByName).length > 0);
}

/**
 * Register a callback for any opponent change: a deck loaded or cleared, a
 * seat added or removed, or an import starting / failing. Listeners must be
 * cheap — calculators key their caches on the deck objects.
 * @param {Function} callback
 */
export function onOpponentChange(callback) {
    if (typeof callback === 'function') changeListeners.push(callback);
}

/**
 * Register a callback for import progress, called with the seat key many
 * times per import (the bar repaints one progress bar; pages need not care).
 * @param {(key:string)=>void} callback
 */
export function onImportProgress(callback) {
    if (typeof callback === 'function') progressListeners.push(callback);
}

function notify(list, arg, label) {
    for (const cb of list) {
        try {
            cb(arg);
        } catch (err) {
            // One broken page must never break the import for the others.
            console.error(`${label} listener failed:`, err);
        }
    }
}

function notifyChange() {
    notify(changeListeners, undefined, 'Opponent change');
}

/** @returns {string[]} the active seat keys, in seat order */
export function getActiveOpponents() {
    return [...activeOpponents];
}

/** @returns {Object|null} a seat's deck data */
export function getOpponentData(opponentKey) {
    return opponentDecks[opponentKey] || null;
}

/** @returns {boolean} whether any active seat has a deck */
export function hasAnyDeckData() {
    return activeOpponents.some(opp => hasCards(opponentDecks[opp]));
}

/** @returns {string[]} active seats that have a deck */
export function getOpponentsWithData() {
    return activeOpponents.filter(opp => hasCards(opponentDecks[opp]));
}

/**
 * @param {string} opponentKey
 * @returns {{state:'loading'|'error', pct?:number, message?:string}|null}
 */
export function getImportStatus(opponentKey) {
    const s = seatStatus[opponentKey];
    return s ? { state: s.state, pct: s.pct ?? 0, message: s.message ?? '' } : null;
}

/** @returns {string[]} active seats with an import in flight */
export function getImportingOpponents() {
    return activeOpponents.filter(k => seatStatus[k]?.state === 'loading');
}

/** @returns {boolean} whether any import is in flight */
export function isImporting() {
    return getImportingOpponents().length > 0;
}

/**
 * Lands / spells / average spell mana value for one imported list — what the
 * bar shows so a player can confirm the right deck landed.
 * Modal double-faced cards count by their front face (that is the card in the
 * library).
 * @param {Object} data - seat deck data
 * @returns {{cards:number, lands:number, spells:number, avgSpellMv:number}}
 */
export function describeOpponentDeck(data) {
    let lands = 0;
    let spells = 0;
    let spellMv = 0;
    for (const card of Object.values(data?.cardsByName ?? {})) {
        const count = Math.max(0, Math.floor(card?.count ?? 1));
        const front = String(card?.type_line ?? '').split('//')[0].toLowerCase();
        if (/\bland\b/.test(front)) {
            lands += count;
        } else {
            spells += count;
            spellMv += (Number(card?.cmc) || 0) * count;
        }
    }
    return { cards: lands + spells, lands, spells, avgSpellMv: spells > 0 ? spellMv / spells : 0 };
}

/**
 * Whether an import field holds a deck link rather than a pasted list.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeDeckUrl(text) {
    const value = String(text ?? '').trim();
    if (!value || /\s/.test(value)) return false;
    return /^(https?:\/\/)?([a-z0-9-]+\.)*(moxfield|archidekt)\.com\//i.test(value) || /^https?:\/\//i.test(value);
}

// ── State changes ───────────────────────────────────────────────────────────

/** Make sure seats 1..n are active (share links may restore seat 3 alone). */
function ensureSeat(opponentKey) {
    const index = SEAT_KEYS.indexOf(opponentKey);
    if (index < 0) return;
    for (let i = 0; i <= index; i++) {
        if (!activeOpponents.includes(SEAT_KEYS[i])) activeOpponents.push(SEAT_KEYS[i]);
    }
    activeOpponents.sort((a, b) => SEAT_KEYS.indexOf(a) - SEAT_KEYS.indexOf(b));
}

/** Empty a seat (cancels a pending import for it). */
export function clearOpponentDeck(opponentKey) {
    if (!opponentDecks[opponentKey]) return;
    seatStatus[opponentKey]?.controller?.abort();
    opponentDecks[opponentKey] = emptyDeck(opponentKey);
    delete seatStatus[opponentKey];
    notifyChange();
}

/**
 * Forget a seat's failed import (the player is editing the field again).
 * @param {string} opponentKey
 */
export function clearImportError(opponentKey) {
    if (seatStatus[opponentKey]?.state !== 'error') return;
    delete seatStatus[opponentKey];
    notifyChange();
}

/**
 * Remove a seat and renumber the ones after it, so seats are always 1..n.
 * @param {string} opponentKey
 * @returns {Object<string,string>|null} old key → new key for every seat that
 *   moved, or null when nothing was removed
 */
export function removeOpponent(opponentKey) {
    const index = activeOpponents.indexOf(opponentKey);
    if (index < 0 || activeOpponents.length <= 1) return null;

    const survivors = activeOpponents.filter(k => k !== opponentKey);
    const moved = survivors.map(oldKey => ({ data: { ...opponentDecks[oldKey] }, status: seatStatus[oldKey] }));
    const renamed = {};

    SEAT_KEYS.forEach((key, i) => {
        const m = moved[i];
        delete seatStatus[key];
        if (!m) {
            opponentDecks[key] = emptyDeck(key);
            return;
        }
        renamed[survivors[i]] = key;
        // A deck keeps its imported name; an unnamed seat takes its new number.
        const name = m.data.name === defaultName(survivors[i]) ? defaultName(key) : m.data.name;
        opponentDecks[key] = { ...m.data, name };
        // A renumbered seat can't keep an in-flight import: its result would
        // land under the old key. Loading seats are never removable (see the
        // bar), so only finished states move.
        if (m.status && m.status.state !== 'loading') seatStatus[key] = m.status;
    });

    activeOpponents = SEAT_KEYS.slice(0, survivors.length);
    notifyChange();
    return renamed;
}

/**
 * Add the next seat.
 * @returns {string|null} the new seat key, or null when all three are in use
 */
export function addOpponent() {
    if (activeOpponents.length >= MAX_OPPONENTS) return null;
    const nextOpp = SEAT_KEYS[activeOpponents.length];
    activeOpponents.push(nextOpp);
    notifyChange();
    return nextOpp;
}

/**
 * Import a deck into a seat. Tracks loading/error state for the seat, so every
 * page and the bar can show progress no matter who started the import (the
 * bar, "Load example opponents", or a share link). A newer import into the
 * same seat cancels this one.
 *
 * @param {string} opponentKey - opponent1 | opponent2 | opponent3
 * @param {string} input - a Moxfield/Archidekt URL, or decklist text
 * @param {boolean} [isUrl=true]
 * @param {Function} [progressCallback]
 * @returns {Promise<Object>} the importer result
 */
export async function importOpponentDeck(opponentKey, input, isUrl = true, progressCallback = null) {
    if (!opponentDecks[opponentKey]) throw new Error(`Unknown opponent seat: ${opponentKey}`);
    ensureSeat(opponentKey);

    seatStatus[opponentKey]?.controller?.abort();
    const controller = new AbortController();
    const token = {};
    seatStatus[opponentKey] = { state: 'loading', pct: 0, message: isUrl ? 'Fetching the deck…' : 'Reading the list…', token, controller };
    notifyChange();
    const live = () => seatStatus[opponentKey]?.token === token;

    const onProgress = (progress) => {
        const status = seatStatus[opponentKey];
        if (status?.token !== token) return;
        status.pct = Number(progress?.percentage) || 0;
        if (progress?.currentCard) status.message = String(progress.currentCard);
        notify(progressListeners, opponentKey, 'Opponent progress');
        if (typeof progressCallback === 'function') progressCallback(progress);
    };

    let result;
    try {
        const mod = await loadImporter();
        result = isUrl
            ? await mod.importDeckFromUrl(input, onProgress, { signal: controller.signal })
            : await mod.importDecklistBatch(input, onProgress, { signal: controller.signal });
    } catch (err) {
        if (live()) {
            const message = await explainImportError(err, { isUrl });
            if (live()) {
                seatStatus[opponentKey] = { state: 'error', message };
                notifyChange();
            }
        }
        throw err;
    }

    // The seat was cleared, removed or re-imported while this was in flight — drop it.
    if (!live()) return result;

    opponentDecks[opponentKey] = {
        cardsByName: result.cardsByName,
        deckSize: result.actualCardCount,
        name: result.deckName || commanderLabel(result.commanders) || defaultName(opponentKey),
        importUrl: isUrl ? input : null,
        commanders: result.commanders ?? []
    };
    delete seatStatus[opponentKey];
    notifyChange();
    return result;
}

/** @returns {{opponent1:string|null, opponent2:string|null, opponent3:string|null}} for share links */
export function getOpponentUrls() {
    return {
        opponent1: opponentDecks.opponent1.importUrl,
        opponent2: opponentDecks.opponent2.importUrl,
        opponent3: opponentDecks.opponent3.importUrl
    };
}

/**
 * Restore a seat from a share link.
 * @param {string} opponentKey
 * @param {string} url
 */
export async function setOpponentUrl(opponentKey, url) {
    if (url && opponentDecks[opponentKey]) {
        ensureSeat(opponentKey);
        await importOpponentDeck(opponentKey, url, true);
    }
}

// ── The bar's import field ──────────────────────────────────────────────────

let focusHandler = null;
let focusPending = false;

/**
 * Bring an import field into view and focus it — the first empty seat, or a
 * new one. Used by the pages' "Import your own" buttons. The bar does the
 * work; a request made before the bar has loaded runs when it does.
 */
export function focusImportField() {
    if (focusHandler) focusHandler();
    else focusPending = true;
}

/**
 * The bar registers how to focus its import field (see focusImportField).
 * @param {Function|null} handler
 */
export function setFocusImportHandler(handler) {
    focusHandler = typeof handler === 'function' ? handler : null;
    if (focusHandler && focusPending) {
        focusPending = false;
        focusHandler();
    }
}
