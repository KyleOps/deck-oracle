/**
 * Shared deck state — the single source of truth every calculator reads.
 *
 * Responsibilities:
 *   - hold the active deck: type counts, card records, and the command zone
 *     (`commanders`, every commander the deck has)
 *   - notify listeners on change (`onDeckUpdate`) and on real imports
 *     (`onDeckImport`, which manual count edits do NOT fire)
 *   - run imports and report progress through `onImportStatus`, so the UI that
 *     shows progress lives in the shell rather than here. The import code
 *     itself loads on the first import, not at startup.
 *   - persist imported decks to the deck library and restore the active one
 *   - resolve the deck's format (Commander / 60 / 40)
 *
 * Derived, never stored: `commanderName` / `commanderCard` (the first
 * commander, for pages that only know about one) and `cardDetails` (one entry
 * per nonland copy), so none of them can drift from what they describe.
 */

import { DEFAULT_DECK_DATA } from './defaultDeckData.js';
import { resolveFormat } from './format.js';
import * as Library from './deckLibrary.js';
import { suggestDeckName } from './deckStats.js';
import { frontName, normalizeCommanders, readCommanders, deckSizeSummary } from './commanders.js';
import { loadImporter, explainImportError } from './importLoader.js';

export const TYPE_FIELDS = Object.freeze(['creatures', 'instants', 'sorceries', 'artifacts', 'enchantments', 'planeswalkers', 'lands', 'battles']);
export const DEFAULT_DECK_URL = 'https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg';

/** Fields that hold strings or null rather than counts. */
const STRING_FIELDS = new Set(['importUrl', 'deckName', 'importSource', 'format', 'deckId']);

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

        cardsByName: DEFAULT_DECK_DATA?.cardsByName ?? {},
        // The command zone: [{ name, card }] in deck order. Imports keep
        // commanders out of cardsByName (they start in the command zone), so
        // `card` is the only place their cost and colours live.
        commanders: readCommanders(DEFAULT_DECK_DATA),
        importUrl: DEFAULT_DECK_DATA?.importUrl ?? null,
        deckName: DEFAULT_DECK_DATA?.deckName ?? null,
        importSource: DEFAULT_DECK_DATA?.importSource ?? 'moxfield', // 'moxfield' | 'archidekt' | 'paste' | 'manual'

        // 'auto' or a FORMATS key
        format: 'auto',
        // Library id of the active deck (null for the built-in example)
        deckId: null
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
 * Import progress for the UI:
 * { state: 'loading'|'success'|'error', kind: 'link'|'list', message, percentage?, warnings? }
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

// ── Derived data ─────────────────────────────────────────────────────────────

function powerNumber(value) {
    const text = String(value ?? '');
    if (!text || /[*xX]/.test(text)) return null;
    const n = parseInt(text, 10);
    return Number.isNaN(n) ? null : n;
}

/**
 * One entry per nonland copy — the shape the Wild Pair, Chimil, Head to Head
 * and Deck Radar code reads. Built from the card records, so it always
 * describes the same deck.
 * @param {Record<string, Object>} cardsByName
 * @returns {Array<{name:string, cmc:number, type:string, allTypes:string[], power:*, toughness:*, totalPT:number|null, isPower5Plus:boolean}>}
 */
export function cardDetailsFor(cardsByName = {}) {
    const details = [];
    for (const card of Object.values(cardsByName ?? {})) {
        if (!card?.name) continue;
        const allTypes = Array.isArray(card.allCategories) && card.allCategories.length
            ? card.allCategories : [card.category ?? 'artifacts'];
        const type = card.category ?? allTypes[0];
        if (type === 'lands') continue;
        const copies = Math.max(0, Math.floor(Number(card.count) || 0));
        const creature = allTypes.includes('creatures');
        const power = creature ? powerNumber(card.power) : null;
        const toughness = creature ? powerNumber(card.toughness) : null;
        const entry = {
            name: card.name,
            cmc: Math.floor(Number(card.cmc) || 0),
            type,
            allTypes,
            power: card.power,
            toughness: card.toughness,
            // Total power + toughness — what Wild Pair matches on. null when
            // either half is variable (*/X): no fixed total to pair against.
            totalPT: power !== null && toughness !== null ? power + toughness : null,
            isPower5Plus: power !== null && power >= 5
        };
        for (let i = 0; i < copies; i++) details.push({ ...entry });
    }
    return details;
}

// cardDetails is rebuilt only when the card records change, so every caller
// gets the same array (pages key their caches on it).
let detailsMemo = { cards: null, details: [] };
// Decks saved before cardDetails was derived carry their own copy: used as-is
// while that deck's records are the active ones.
let savedDetails = null;

function currentCardDetails() {
    const cards = deckState.cardsByName;
    if (savedDetails?.cards === cards) return savedDetails.details;
    if (detailsMemo.cards !== cards) detailsMemo = { cards, details: cardDetailsFor(cards) };
    return detailsMemo.details;
}

// ── Getters ──────────────────────────────────────────────────────────────────

/**
 * The whole deck: stored fields plus the derived `commanderName`,
 * `commanderCard` (the first commander) and `cardDetails`.
 */
export function getDeckConfig() {
    const lead = deckState.commanders[0] ?? null;
    return {
        ...deckState,
        commanderName: lead?.name ?? null,
        commanderCard: lead?.card ?? null,
        cardDetails: currentCardDetails()
    };
}

export function getImportedCardData() {
    return {
        cardDetails: currentCardDetails(),
        cardsByName: deckState.cardsByName
    };
}

/** The first commander's name, or null (see getCommanderNames for all of them). */
export function getCommanderName() {
    return deckState.commanders[0]?.name ?? null;
}

/**
 * Every card in the command zone — one commander, partners, a Doctor and
 * their companion, a commander and a background — in deck order.
 * `card` is the card record when known (from the import, or from the list
 * itself when the list names the commander), else null. Commanders never
 * belong in the library: build libraries without every name here.
 * @returns {Array<{name:string, card:Object|null}>}
 */
export function getCommanders() {
    const cards = Object.values(deckState.cardsByName ?? {});
    return deckState.commanders.map(({ name, card }) => {
        const target = frontName(name);
        return { name, card: card ?? cards.find(c => c && frontName(c.name) === target) ?? null };
    });
}

/** The command zone's card names (see getCommanders). */
export function getCommanderNames() {
    return deckState.commanders.map(c => c.name);
}

/**
 * The first commander's card record (mana cost, cmc, colours, type), or null.
 * Imports store it with the commander; the bundled example and some pasted
 * lists keep the commander in the list itself, so fall back to that.
 * @returns {Object|null}
 */
export function getCommanderCard() {
    return getCommanders()[0]?.card ?? null;
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

/**
 * The deck's size as players say it, for labels: the library plus every
 * commander not already in it (98 + 2 commanders = a 100-card deck).
 * Odds always use the library size (getDeckSize).
 * @returns {{total:number, library:number, commanders:number, label:string, detail:string|null}}
 */
export function getDeckTotal() {
    return deckSizeSummary(getDeckSize(true), deckState.commanders, deckState.cardsByName);
}

/** The deck's resolved format object (see format.js). */
export function getFormat() {
    return resolveFormat(deckState.format, { deckSize: getDeckSize(true), commanders: deckState.commanders });
}

/** Does the deck have real card records (an import) rather than bare counts? */
export function hasCardList() {
    return Object.keys(deckState.cardsByName ?? {}).length > 0;
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Update one numeric field (manual entry): a type count or actualCardCount. */
export function updateField(field, value) {
    if (!TYPE_FIELDS.includes(field) && field !== 'actualCardCount') return;
    deckState[field] = Math.max(0, parseInt(value, 10) || 0);
    if (TYPE_FIELDS.includes(field)) {
        // Hand-edited counts no longer describe the imported list, so the deck
        // becomes a counts-only deck. Keeping the old card records would let
        // card-based pages silently mix two different decks.
        if (deckState.importSource !== 'manual') becomeCountsOnly();
        deckState.actualCardCount = null;
        scheduleManualSave();
    }
    notifyUpdates();
}

const MANUAL_NAME = 'Custom counts';
let manualSaveTimer = 0;

function becomeCountsOnly() {
    deckState.cardsByName = {};
    deckState.commanders = [];
    deckState.importUrl = null;
    deckState.deckName = MANUAL_NAME;
    deckState.importSource = 'manual';
    deckState.format = 'auto';
    savedDetails = null;
}

/** Persist a counts-only deck (debounced — this runs on every keystroke). */
function scheduleManualSave() {
    clearTimeout(manualSaveTimer);
    manualSaveTimer = setTimeout(() => {
        const id = Library.saveDeck(getDeckConfig());
        if (id) {
            deckState.deckId = id;
            Library.setActiveDeckId(id);
        }
    }, 600);
}

/**
 * Apply `commanders`, then the legacy single-commander keys, from an
 * updateDeck() payload. Setting `commanderName` to a different card replaces
 * the command zone with that one card; null empties it.
 */
function applyCommanderUpdate(config) {
    if ('commanders' in config) deckState.commanders = normalizeCommanders(config.commanders);
    if ('commanderName' in config) {
        const name = config.commanderName;
        const lead = deckState.commanders[0];
        if (!name) deckState.commanders = [];
        else if (!lead || frontName(lead.name) !== frontName(name)) deckState.commanders = [{ name: String(name), card: null }];
    }
    if ('commanderCard' in config && deckState.commanders.length) {
        const [lead, ...rest] = deckState.commanders;
        const card = config.commanderCard;
        deckState.commanders = normalizeCommanders([{ name: lead.name, card: card && typeof card === 'object' ? card : null }, ...rest]);
    }
}

/**
 * Bulk update. Objects/arrays are taken as-is; string fields as strings.
 * `commanders` (or the legacy `commanderName` / `commanderCard`) set the
 * command zone; `cardDetails` is derived and ignored.
 */
export function updateDeck(config = {}) {
    applyCommanderUpdate(config);
    Object.keys(config).forEach(key => {
        if (!(key in deckState) || key === 'commanders') return;
        const value = config[key];
        if (STRING_FIELDS.has(key)) {
            deckState[key] = value ?? null;
        } else if (key === 'cardsByName') {
            deckState.cardsByName = value && typeof value === 'object' ? value : {};
        } else if (key === 'actualCardCount' && (value === null || value === undefined)) {
            deckState[key] = null;
        } else if (typeof value !== 'object') {
            deckState[key] = Math.max(0, parseInt(value, 10) || 0);
        }
    });
    notifyUpdates();
}

/** Rename the active deck (and its saved copy). */
export function renameDeck(name) {
    const clean = String(name ?? '').trim().slice(0, 80);
    if (!clean) return false;
    deckState.deckName = clean;
    if (deckState.deckId) Library.updateDeckMeta(deckState.deckId, { name: clean });
    notifyUpdates();
    return true;
}

/** Set the format preference ('auto' or a FORMATS key). */
export function setFormatPreference(format) {
    deckState.format = format || 'auto';
    if (deckState.deckId) Library.updateDeckMeta(deckState.deckId, { format: deckState.format });
    notifyUpdates();
}

/** Swap in a whole new deck and tell everyone. */
function replaceDeck(next, details = null) {
    clearTimeout(manualSaveTimer);
    deckState = next;
    savedDetails = details;
    notifyUpdates();
    notifyImport();
}

/**
 * Replace the whole deck from a library snapshot (or any snapshot-shaped
 * object) and fire the import listeners. Old snapshots with a single
 * `commanderName` / `commanderCard`, or a stored `cardDetails`, still load.
 */
export function loadSnapshot(snapshot, { persistActive = true } = {}) {
    if (!snapshot) return false;
    const next = initialState();
    TYPE_FIELDS.forEach(f => { next[f] = Math.max(0, Number(snapshot.counts?.[f]) || 0); });
    next.actualCardCount = snapshot.actualCardCount ?? null;
    next.cardsByName = snapshot.cardsByName ?? {};
    next.commanders = readCommanders(snapshot);
    next.importUrl = snapshot.importUrl ?? null;
    next.deckName = snapshot.name ?? snapshot.deckName ?? null;
    next.importSource = snapshot.importSource ?? null;
    next.format = snapshot.format ?? 'auto';
    next.deckId = snapshot.id ?? null;
    if (persistActive) Library.setActiveDeckId(next.deckId);
    const legacy = Array.isArray(snapshot.cardDetails) && snapshot.cardDetails.length
        ? { cards: next.cardsByName, details: snapshot.cardDetails } : null;
    replaceDeck(next, legacy);
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
    Library.setActiveDeckId(null);
    replaceDeck(initialState());
}

/**
 * Apply an import result (from decklistImport) as the active deck and save it
 * to the library.
 */
function applyImport(result, meta) {
    const next = initialState();
    TYPE_FIELDS.forEach(f => { next[f] = Number(result[f]) || 0; });
    next.actualCardCount = result.actualCardCount ?? null;
    next.cardsByName = result.cardsByName ?? {};
    // Always replaced: a list without commanders must not inherit the
    // previous deck's.
    next.commanders = readCommanders(result);
    next.importUrl = meta.importUrl ?? null;
    next.importSource = meta.source;
    next.deckName = result.deckName ?? result.importMetadata?.deckName ?? meta.deckName ?? null;
    next.format = 'auto';
    next.deckId = Library.saveDeck({ ...next });
    Library.setActiveDeckId(next.deckId);
    replaceDeck(next);
}

function importWarnings(metadata = {}) {
    const warnings = [];
    if (metadata.hasSideboard) warnings.push(`Sideboard ignored (${metadata.sideboardCount} cards)`);
    if (metadata.missingCardCount > 0) {
        const list = (metadata.missingCards ?? []).map(c => `${c.count}× ${c.name}`).join(', ');
        warnings.push(`${metadata.missingCardCount} card${metadata.missingCardCount === 1 ? '' : 's'} not found${list ? `: ${list}` : ''}`);
    }
    const skipped = metadata.skippedLines?.length ?? 0;
    if (skipped > 0) warnings.push(`${skipped} line${skipped === 1 ? '' : 's'} skipped (not a card)`);
    return warnings;
}

// ── Imports ──────────────────────────────────────────────────────────────────

/**
 * The newest import wins. Starting one supersedes (and cancels) whatever is
 * running, so a stalled link import can never block a pasted list, and a
 * slow import finishing late can never overwrite a newer deck. Asking again
 * for exactly the same import while it runs (a double click) joins it.
 */
let current = null; // { key, promise, controller }

/**
 * Run one import job with progress, newest-wins and error reporting.
 * @param {{key:string, kind:'link'|'list', start:string, run:Function, apply:Function, success:Function}} job
 */
function runImport({ key, kind, start, run, apply, success }) {
    if (current?.key === key) return current.promise;
    current?.controller.abort();
    const controller = new AbortController();
    const job = { key, controller, promise: null };
    const live = () => current === job;
    job.promise = (async () => {
        status('loading', start, { kind, percentage: 2 });
        try {
            const mod = await loadImporter();
            const result = await run(mod, controller.signal, progress => {
                if (live()) status('loading', progress.currentCard || 'Importing…', { kind, percentage: progress.percentage ?? 0 });
            });
            if (!live()) throw Object.assign(new Error('A newer import replaced this one.'), { name: 'AbortError', kind: 'aborted' });
            apply(result);
            status('success', success(result), { kind, percentage: 100, warnings: importWarnings(result.importMetadata) });
            return result;
        } catch (error) {
            if (live() && error?.kind !== 'aborted') {
                console.error('Deck import failed:', error);
                const message = await explainImportError(error, { isUrl: kind === 'link' });
                if (live()) status('error', message, { kind });
            }
            throw error;
        } finally {
            if (live()) current = null;
        }
    })();
    current = job;
    return job.promise;
}

/**
 * Import a deck from a Moxfield or Archidekt URL.
 * @returns {Promise<Object>} the import result
 */
export async function loadDeckFromUrl(url) {
    const input = String(url ?? '').trim();
    if (!input) {
        status('error', 'Paste a Moxfield or Archidekt deck link first.', { kind: 'link' });
        throw new Error('Invalid URL');
    }
    return runImport({
        key: `link:${input}`,
        kind: 'link',
        start: 'Fetching deck…',
        run: (mod, signal, onProgress) => mod.importDeckFromUrl(input, onProgress, { signal }),
        apply: result => {
            const source = /archidekt/i.test(result.importMetadata?.source ?? input) ? 'archidekt' : 'moxfield';
            applyImport(result, { importUrl: input, source });
        },
        success: result => `Imported ${result.deckName ?? 'deck'} — ${deckSizeSummary(result.actualCardCount, result.commanders, result.cardsByName).label}.`
    });
}

/**
 * Import a pasted decklist.
 * @returns {Promise<Object>} the import result
 */
export async function importDeckText(text) {
    const list = String(text ?? '').trim();
    if (!list) {
        status('error', 'Paste a decklist first.', { kind: 'list' });
        throw new Error('Empty decklist');
    }
    return runImport({
        key: `list:${list}`,
        kind: 'list',
        start: 'Reading decklist…',
        run: (mod, signal, onProgress) => mod.importDecklistBatch(list, onProgress, { signal }),
        apply: result => applyImport(result, {
            importUrl: null,
            source: 'paste',
            deckName: suggestDeckName({ cardsByName: result.cardsByName, commanders: result.commanders })
        }),
        success: result => `Imported ${deckSizeSummary(result.actualCardCount, result.commanders, result.cardsByName).label}.`
    });
}

/** Is an import running? */
export function isImporting() {
    return current !== null;
}

/**
 * Restore the active saved deck. Call once at startup, before listeners
 * subscribe (the first render reads state directly).
 * @param {{restore?:boolean}} [opts] - restore the last active deck from the library
 */
export function initDeckConfig({ restore = true } = {}) {
    if (!restore) return;
    const id = Library.getActiveDeckId();
    const snap = id ? Library.getDeck(id) : null;
    if (snap) loadSnapshot(snap, { persistActive: false });
    else if (id) Library.setActiveDeckId(null);
}

/** Test hook: reset to the built-in example without touching storage. */
export function resetForTests() {
    clearTimeout(manualSaveTimer);
    current?.controller.abort();
    current = null;
    deckState = initialState();
    savedDetails = null;
}
