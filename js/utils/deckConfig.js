/**
 * Shared deck state — the single source of truth every calculator reads.
 *
 * Responsibilities:
 *   - hold the active deck (type counts + full card records)
 *   - notify listeners on change (`onDeckUpdate`) and on real imports
 *     (`onDeckImport`, which manual count edits do NOT fire)
 *   - run imports and report progress through `onImportStatus`, so the UI that
 *     shows progress lives in the shell rather than here
 *   - persist imported decks to the deck library and restore the active one
 *   - resolve the deck's format (Commander / 60 / 40)
 */

import { importDecklistBatch, importDeckFromUrl } from './decklistImport.js';
import { DEFAULT_DECK_DATA } from './defaultDeckData.js';
import { resolveFormat } from './format.js';
import * as Library from './deckLibrary.js';

export const TYPE_FIELDS = Object.freeze(['creatures', 'instants', 'sorceries', 'artifacts', 'enchantments', 'planeswalkers', 'lands', 'battles']);
export const DEFAULT_DECK_URL = 'https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg';

/** Fields that hold strings or null rather than counts. */
const STRING_FIELDS = new Set(['commanderName', 'importUrl', 'deckName', 'importSource', 'format', 'deckId']);

function initialState() {
    return {
        creatures: DEFAULT_DECK_DATA?.creatures ?? 30,
        instants: DEFAULT_DECK_DATA?.instants ?? 10,
        sorceries: DEFAULT_DECK_DATA?.sorceries ?? 8,
        artifacts: DEFAULT_DECK_DATA?.artifacts ?? 8,
        enchantments: DEFAULT_DECK_DATA?.enchantments ?? 5,
        planeswalkers: DEFAULT_DECK_DATA?.planeswalkers ?? 2,
        lands: DEFAULT_DECK_DATA?.lands ?? 36,
        battles: DEFAULT_DECK_DATA?.battles ?? 0,

        // Real card count from an import (dual-typed cards are counted under
        // every type above, so the type sum overstates the deck). null = use the sum.
        actualCardCount: DEFAULT_DECK_DATA?.actualCardCount ?? null,

        // Legacy CMC breakdown inputs (Wave / Vortex manual mode)
        cmc0: 10, cmc1: 12, cmc2: 15, cmc3: 18, cmc4: 14, cmc5: 10, cmc6: 8,

        creaturesPower5Plus: DEFAULT_DECK_DATA?.creaturesPower5Plus ?? 12,
        cardDetails: DEFAULT_DECK_DATA?.cardDetails ?? [],
        cardsByName: DEFAULT_DECK_DATA?.cardsByName ?? {},
        commanderName: DEFAULT_DECK_DATA?.commanderName ?? null,
        importUrl: DEFAULT_DECK_DATA?.importUrl ?? null,
        deckName: DEFAULT_DECK_DATA?.deckName ?? null,
        importSource: DEFAULT_DECK_DATA?.importSource ?? 'moxfield', // 'moxfield' | 'archidekt' | 'paste' | 'manual'

        // 'auto' or a FORMATS key
        format: 'auto',
        // Library id of the active deck (null for the built-in example)
        deckId: null,

        // Deprecated per-CMC power-5 counts (kept so old share links parse)
        power5PlusCMC3: 0, power5PlusCMC4: 0, power5PlusCMC5: 0, power5PlusCMC6: 0,
        power5PlusCMC7: 0, power5PlusCMC8: 0, power5PlusCMC9: 0, power5PlusCMC10: 0
    };
}

let deckState = initialState();

const updateCallbacks = [];
const importCallbacks = [];
const statusCallbacks = [];

// ── Subscriptions ────────────────────────────────────────────────────────────

/** Fires on every change, including each manual type-count keystroke. */
export function onDeckUpdate(callback) {
    updateCallbacks.push(callback);
}

/** Fires only when a whole deck is loaded (import, example, saved deck). */
export function onDeckImport(callback) {
    importCallbacks.push(callback);
}

/**
 * Import progress for the UI: { state: 'loading'|'success'|'error', message, percentage?, warnings? }
 */
export function onImportStatus(callback) {
    statusCallbacks.push(callback);
}

function emit(list, payload, label) {
    // Isolated per listener: one calculator throwing used to abort every later
    // listener AND propagate out of updateDeck() into the import.
    list.forEach(cb => {
        try {
            cb(payload);
        } catch (err) {
            console.error(`${label} listener failed:`, err);
        }
    });
}

function notifyUpdates() {
    emit(updateCallbacks, getDeckConfig(), 'Deck update');
}

function notifyImport() {
    emit(importCallbacks, getDeckConfig(), 'Deck import');
}

function status(state, message, extra = {}) {
    emit(statusCallbacks, { state, message, ...extra }, 'Import status');
}

// ── Getters ──────────────────────────────────────────────────────────────────

export function getDeckConfig() {
    return { ...deckState };
}

export function getImportedCardData() {
    return {
        cardDetails: deckState.cardDetails,
        cardsByName: deckState.cardsByName
    };
}

export function getCommanderName() {
    return deckState.commanderName;
}

/**
 * Library size.
 * @param {boolean} includeNonPermanents - false excludes instants and sorceries
 */
export function getDeckSize(includeNonPermanents = true) {
    const { creatures, instants, sorceries, artifacts, enchantments, planeswalkers, lands, battles, actualCardCount } = deckState;
    if (actualCardCount !== null && actualCardCount !== undefined && includeNonPermanents) {
        return actualCardCount;
    }
    const permanents = creatures + artifacts + enchantments + planeswalkers + lands + battles;
    return includeNonPermanents ? permanents + instants + sorceries : permanents;
}

/** The deck's resolved format object (see format.js). */
export function getFormat() {
    return resolveFormat(deckState.format, { deckSize: getDeckSize(true), commanderName: deckState.commanderName });
}

/** Does the deck have real card records (an import) rather than bare counts? */
export function hasCardList() {
    return Object.keys(deckState.cardsByName ?? {}).length > 0;
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Update one numeric field (manual entry). */
export function updateField(field, value) {
    if (!(field in deckState) || STRING_FIELDS.has(field)) return;
    deckState[field] = Math.max(0, parseInt(value, 10) || 0);
    if (TYPE_FIELDS.includes(field)) {
        // Hand-edited counts no longer describe the imported list.
        deckState.actualCardCount = null;
        deckState.importSource = 'manual';
    }
    notifyUpdates();
}

/** Bulk update. Objects/arrays are taken as-is; string fields as strings. */
export function updateDeck(config = {}) {
    Object.keys(config).forEach(key => {
        if (!(key in deckState)) return;
        const value = config[key];
        if (STRING_FIELDS.has(key)) {
            deckState[key] = value ?? null;
        } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
            deckState[key] = value;
        } else if (key === 'actualCardCount' && (value === null || value === undefined)) {
            deckState[key] = null;
        } else {
            deckState[key] = Math.max(0, parseInt(value, 10) || 0);
        }
    });
    notifyUpdates();
}

/** Set the format preference ('auto' or a FORMATS key). */
export function setFormatPreference(format) {
    deckState.format = format || 'auto';
    if (deckState.deckId) Library.updateDeckMeta(deckState.deckId, { format: deckState.format });
    notifyUpdates();
}

function syncManualInputs() {
    if (typeof document === 'undefined') return;
    TYPE_FIELDS.forEach(field => {
        const input = document.getElementById(`deck-${field}`);
        if (input) input.value = deckState[field] ?? 0;
    });
    const totalEl = document.getElementById('deck-total');
    if (totalEl) totalEl.textContent = getDeckSize(true);
}

/**
 * Replace the whole deck from a library snapshot (or any snapshot-shaped
 * object) and fire the import listeners.
 */
export function loadSnapshot(snapshot, { persistActive = true } = {}) {
    if (!snapshot) return false;
    const next = initialState();
    Object.assign(next, snapshot.counts ?? {});
    next.actualCardCount = snapshot.actualCardCount ?? null;
    next.creaturesPower5Plus = snapshot.creaturesPower5Plus ?? 0;
    next.cardDetails = snapshot.cardDetails ?? [];
    next.cardsByName = snapshot.cardsByName ?? {};
    next.commanderName = snapshot.commanderName ?? null;
    next.importUrl = snapshot.importUrl ?? null;
    next.deckName = snapshot.name ?? snapshot.deckName ?? null;
    next.importSource = snapshot.importSource ?? null;
    next.format = snapshot.format ?? 'auto';
    next.deckId = snapshot.id ?? null;
    deckState = next;
    if (persistActive) Library.setActiveDeckId(next.deckId);
    syncManualInputs();
    notifyUpdates();
    notifyImport();
    return true;
}

/** Switch to a saved deck by id. */
export function loadSavedDeck(id) {
    const snap = Library.getDeck(id);
    if (!snap) return false;
    return loadSnapshot(snap);
}

/** Return to the built-in example deck. */
export function loadExampleDeck() {
    deckState = initialState();
    Library.setActiveDeckId(null);
    syncManualInputs();
    notifyUpdates();
    notifyImport();
}

/**
 * Apply an import result (from decklistImport) as the active deck and save it
 * to the library.
 */
function applyImport(result, meta) {
    const next = initialState();
    TYPE_FIELDS.forEach(f => { next[f] = Number(result[f]) || 0; });
    next.actualCardCount = result.actualCardCount ?? null;
    next.cardDetails = result.cardDetails ?? [];
    next.cardsByName = result.cardsByName ?? {};
    next.creaturesPower5Plus = result.creaturesPower5Plus ?? 0;
    // The paste path returns no commander, so it must be cleared explicitly or
    // the previous deck's commander leaks into this one.
    next.commanderName = result.commanderName ?? null;
    next.importUrl = meta.importUrl ?? null;
    next.importSource = meta.source;
    next.deckName = result.importMetadata?.deckName ?? meta.deckName ?? null;
    next.format = 'auto';
    deckState = next;

    const id = Library.saveDeck(getDeckConfig());
    deckState.deckId = id;
    Library.setActiveDeckId(id);

    syncManualInputs();
    notifyUpdates();
    notifyImport();
}

function importWarnings(metadata = {}) {
    const warnings = [];
    if (metadata.hasSideboard) warnings.push(`Sideboard ignored (${metadata.sideboardCount} cards)`);
    if (metadata.missingCardCount > 0) {
        const list = (metadata.missingCards ?? []).map(c => `${c.count}× ${c.name}`).join(', ');
        warnings.push(`${metadata.missingCardCount} card${metadata.missingCardCount === 1 ? '' : 's'} not found${list ? `: ${list}` : ''}`);
    }
    return warnings;
}

let importInFlight = null;

/**
 * Import a deck from a Moxfield or Archidekt URL.
 * @returns {Promise<Object>} the import result
 */
export async function loadDeckFromUrl(url) {
    const input = String(url ?? '').trim();
    if (!input) {
        status('error', 'Paste a Moxfield or Archidekt deck link first.');
        throw new Error('Invalid URL');
    }
    if (importInFlight) return importInFlight;
    importInFlight = (async () => {
        status('loading', 'Fetching deck…', { percentage: 2 });
        try {
            const result = await importDeckFromUrl(input, progress => {
                status('loading', progress.currentCard || 'Importing…', { percentage: progress.percentage ?? 0 });
            });
            const source = /archidekt/i.test(result.importMetadata?.source ?? input) ? 'archidekt' : 'moxfield';
            applyImport(result, { importUrl: input, source });
            const n = result.actualCardCount ?? 0;
            status('success', `Imported ${result.importMetadata?.deckName ?? 'deck'} — ${n} cards.`, {
                percentage: 100, warnings: importWarnings(result.importMetadata)
            });
            return result;
        } catch (error) {
            console.error('Deck import error:', error);
            status('error', error?.message ? `Couldn’t import that deck: ${error.message}` : 'Couldn’t import that deck.');
            throw error;
        } finally {
            importInFlight = null;
        }
    })();
    return importInFlight;
}

/**
 * Import a pasted decklist.
 * @returns {Promise<Object>} the import result
 */
export async function importDeckText(text) {
    const list = String(text ?? '').trim();
    if (!list) {
        status('error', 'Paste a decklist first.');
        throw new Error('Empty decklist');
    }
    if (importInFlight) return importInFlight;
    importInFlight = (async () => {
        status('loading', 'Reading decklist…', { percentage: 2 });
        try {
            const result = await importDecklistBatch(list, progress => {
                status('loading', `Looking up cards… ${progress.processed}/${progress.total}`, { percentage: progress.percentage ?? 0 });
            });
            const commander = result.importMetadata?.commanderName ?? result.commanderName ?? null;
            applyImport({ ...result, commanderName: commander }, { importUrl: null, source: 'paste', deckName: commander ? `${commander} deck` : 'Pasted deck' });
            status('success', `Imported ${result.actualCardCount ?? 0} cards.`, {
                percentage: 100, warnings: importWarnings(result.importMetadata)
            });
            return result;
        } catch (error) {
            console.error('Import error:', error);
            status('error', error?.message ? `Couldn’t read that list: ${error.message}` : 'Couldn’t read that list.');
            throw error;
        } finally {
            importInFlight = null;
        }
    })();
    return importInFlight;
}

/**
 * Bind the manual type-count inputs and restore the active saved deck.
 * Call once at startup.
 * @param {{restore?:boolean}} [opts] - restore the last active deck from the library
 */
export function initDeckConfig({ restore = true } = {}) {
    if (restore) {
        const id = Library.getActiveDeckId();
        const snap = id ? Library.getDeck(id) : null;
        if (snap) {
            // Restore silently: listeners subscribe after init, and the first
            // render reads state directly.
            loadSnapshot(snap, { persistActive: false });
        } else if (id) {
            Library.setActiveDeckId(null);
        }
    }

    if (typeof document === 'undefined') return;
    TYPE_FIELDS.forEach(field => {
        const input = document.getElementById(`deck-${field}`);
        if (!input) return;
        input.value = deckState[field];
        input.addEventListener('input', e => {
            updateField(field, e.target.value);
            const totalEl = document.getElementById('deck-total');
            if (totalEl) totalEl.textContent = getDeckSize(true);
        });
    });
    syncManualInputs();
}

/**
 * Apply a preset of type counts (legacy API).
 * @param {{config: Object}} preset
 */
export function applyPreset(preset) {
    if (!preset?.config) return;
    const mapping = {
        creature: 'creatures', instant: 'instants', sorcery: 'sorceries', artifact: 'artifacts',
        enchantment: 'enchantments', planeswalker: 'planeswalkers', land: 'lands', battle: 'battles'
    };
    Object.keys(preset.config).forEach(key => {
        const mappedKey = mapping[key] || key;
        if (mappedKey in deckState && !STRING_FIELDS.has(mappedKey)) deckState[mappedKey] = preset.config[key];
    });
    syncManualInputs();
    notifyUpdates();
}

/** Test hook: reset to the built-in example without touching storage. */
export function resetForTests() {
    deckState = initialState();
}
