/**
 * Shared opponent decklists.
 *
 * The multiplayer calculators (Ensnared by the Mara, Dream Harvest, Mind's
 * Dilation) all read the same up-to-three opponent libraries. This module owns
 * that state, the import lifecycle (loading / failed / loaded per seat), and
 * the "Opponent decklists" bar the shell shows above those pages
 * (#shared-opponent-tabs + #shared-opponent-import in index.html).
 *
 * Public API used elsewhere — keep these names and signatures:
 *   main.js  → init, addOpponent, getActiveOpponents, importOpponentDeck, renderOpponentTabs
 *   share.js → getOpponentUrls, setOpponentUrl
 */

import { importDeckFromUrl, importDecklistBatch } from './decklistImport.js';
import { escapeHtml } from '../data/glossary.js';

export const MAX_OPPONENTS = 3;
const SEAT_KEYS = ['opponent1', 'opponent2', 'opponent3'];

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

function defaultName(key) {
    return key.replace('opponent', 'Opponent ');
}

function emptyDeck(key) {
    return { cardsByName: {}, cardDetails: [], deckSize: 0, name: defaultName(key), importUrl: null };
}

const opponentDecks = Object.fromEntries(SEAT_KEYS.map(k => [k, emptyDeck(k)]));

let activeOpponents = ['opponent1'];
let currentSelectedOpponent = 'opponent1';

/** Per-seat import status: { state: 'loading'|'error', pct, message, token }. Absent = idle. */
const seatStatus = {};
/** Unsent text in each seat's import field, so re-renders never eat what was typed. */
const drafts = {};
/** Seats showing the import form over a deck that is already loaded ("Replace"). */
const replacing = new Set();

const changeListeners = [];

// ── State queries ───────────────────────────────────────────────────────────

function hasCards(data) {
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

function notifyChange() {
    for (const cb of changeListeners) {
        try {
            cb();
        } catch (err) {
            // One broken page must never break the import for the others.
            console.error('Opponent change listener failed:', err);
        }
    }
    queueBarRender();
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
    opponentDecks[opponentKey] = emptyDeck(opponentKey);
    delete seatStatus[opponentKey];
    replacing.delete(opponentKey);
    notifyChange();
}

/**
 * Remove a seat and renumber the ones after it, so seats are always 1..n.
 * @param {string} opponentKey
 */
export function removeOpponent(opponentKey) {
    const index = activeOpponents.indexOf(opponentKey);
    if (index < 0 || activeOpponents.length <= 1) return;

    const survivors = activeOpponents.filter(k => k !== opponentKey);
    const moved = survivors.map(oldKey => ({
        data: { ...opponentDecks[oldKey] },
        status: seatStatus[oldKey],
        draft: drafts[oldKey],
        replacing: replacing.has(oldKey)
    }));

    replacing.clear();
    SEAT_KEYS.forEach((key, i) => {
        const m = moved[i];
        delete seatStatus[key];
        delete drafts[key];
        if (!m) {
            opponentDecks[key] = emptyDeck(key);
            return;
        }
        // A deck keeps its imported name; an unnamed seat takes its new number.
        const renamed = m.data.name === defaultName(survivors[i]) ? defaultName(key) : m.data.name;
        opponentDecks[key] = { ...m.data, name: renamed };
        // A renumbered seat can't keep an in-flight import: its result would
        // land under the old key. Loading seats are never removable (see UI),
        // so only finished states move.
        if (m.status && m.status.state !== 'loading') seatStatus[key] = m.status;
        if (m.draft) drafts[key] = m.draft;
        if (m.replacing) replacing.add(key);
    });

    activeOpponents = SEAT_KEYS.slice(0, survivors.length);
    if (currentSelectedOpponent === opponentKey) {
        currentSelectedOpponent = activeOpponents[Math.max(0, index - 1)];
    } else {
        const oldIndex = survivors.indexOf(currentSelectedOpponent);
        currentSelectedOpponent = activeOpponents[Math.max(0, oldIndex)];
    }
    notifyChange();
}

/**
 * Add the next seat and select it.
 * @returns {string|null} the new seat key, or null when all three are in use
 */
export function addOpponent() {
    if (activeOpponents.length >= MAX_OPPONENTS) return null;
    const nextOpp = SEAT_KEYS[activeOpponents.length];
    activeOpponents.push(nextOpp);
    currentSelectedOpponent = nextOpp;
    notifyChange();
    return nextOpp;
}

/** Turn an importer error into one short sentence for the bar. */
function friendlyError(err, isUrl) {
    const raw = String(err?.message ?? err ?? '').trim();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You appear to be offline.';
    if (/no cards found|invalid decklist/i.test(raw)) return 'No cards found — paste one card per line, like “1 Sol Ring”.';
    if (/invalid url|supports moxfield/i.test(raw)) return 'That link isn’t a Moxfield or Archidekt deck.';
    if (/failed to fetch|network/i.test(raw)) return isUrl ? 'Couldn’t reach the deck site. Check the link and your connection.' : 'Couldn’t reach Scryfall. Check your connection.';
    return raw || 'The import failed.';
}

/**
 * Import a deck into a seat. Tracks loading/error state for the seat, so every
 * page and the bar can show progress no matter who started the import (the
 * bar, "Load example opponents", or a share link).
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

    const token = {};
    seatStatus[opponentKey] = { state: 'loading', pct: 0, message: isUrl ? 'Fetching the deck…' : 'Reading the list…', token };
    notifyChange();

    const onProgress = (progress) => {
        const status = seatStatus[opponentKey];
        if (status?.token !== token) return;
        status.pct = Number(progress?.percentage) || 0;
        if (progress?.currentCard) status.message = String(progress.currentCard);
        paintProgress(opponentKey);
        if (typeof progressCallback === 'function') progressCallback(progress);
    };

    let result;
    try {
        result = isUrl
            ? await importDeckFromUrl(input, onProgress)
            : await importDecklistBatch(input, onProgress);
        // A list whose names all missed on Scryfall "succeeds" with nothing in it.
        if (!result?.cardsByName || Object.keys(result.cardsByName).length === 0) {
            throw new Error('None of those cards were recognised. Check the spelling, one card per line.');
        }
    } catch (err) {
        if (seatStatus[opponentKey]?.token === token) {
            seatStatus[opponentKey] = { state: 'error', message: friendlyError(err, isUrl) };
            notifyChange();
        }
        throw err;
    }

    // The seat was cleared or removed while this was in flight — drop it.
    if (seatStatus[opponentKey]?.token !== token) return result;

    opponentDecks[opponentKey] = {
        cardsByName: result.cardsByName,
        cardDetails: result.cardDetails,
        deckSize: result.actualCardCount,
        name: result.importMetadata?.deckName || result.commanderName || defaultName(opponentKey),
        importUrl: isUrl ? input : null
    };
    delete seatStatus[opponentKey];
    delete drafts[opponentKey];
    replacing.delete(opponentKey);
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

/** Select a seat in the bar. */
export function switchOpponentTab(opponentKey) {
    if (!activeOpponents.includes(opponentKey)) return;
    currentSelectedOpponent = opponentKey;
    renderOpponentTabs();
}

// ── The bar ─────────────────────────────────────────────────────────────────

const BAR_STYLES = `
#opponents-config .opponent-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
#opponents-config .opp-seat {
    display: inline-flex; align-items: center; gap: 10px;
    min-width: 0; max-width: min(100%, 300px);
    padding: 7px 14px 7px 8px;
    border: 1px solid var(--tx-rule-hi); border-radius: var(--radius-md);
    background: var(--tx-bg); color: var(--tx-text);
    text-align: left; cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
}
#opponents-config .opp-seat:hover { border-color: var(--tx-dim); }
#opponents-config .opp-seat[aria-selected="true"] {
    border-color: var(--tx-accent); background: var(--tx-panel-alt);
    box-shadow: 0 0 0 3px var(--accent-soft);
}
#opponents-config .opp-seat:focus-visible { outline: 2px solid var(--tx-accent); outline-offset: 2px; }
#opponents-config .opp-seat-num {
    flex: none; display: grid; place-items: center;
    width: 24px; height: 24px; border-radius: 50%;
    font-family: var(--font-mono); font-size: var(--t-label); font-weight: 700;
    color: var(--tx-bright);
    background: color-mix(in srgb, var(--seat) 24%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--seat) 65%, transparent);
}
#opponents-config .opp-seat.is-loading .opp-seat-num {
    color: transparent; background: none; box-shadow: none;
    border: 2px solid var(--tx-rule-hi); border-top-color: var(--seat);
    animation: opp-spin 0.8s linear infinite;
}
#opponents-config .opp-seat-text { display: grid; gap: 1px; min-width: 0; }
#opponents-config .opp-seat-name {
    font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#opponents-config .opp-seat.is-empty .opp-seat-name { color: var(--tx-mid); font-weight: 500; }
#opponents-config .opp-seat-meta { font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#opponents-config .opp-seat.is-loaded .opp-seat-meta::before { content: '✓ '; color: var(--tx-good); }
#opponents-config .opp-seat.is-error .opp-seat-meta { color: var(--tx-bad); }
#opponents-config .opp-add { align-self: center; border-style: dashed; }

#opponents-config .opp-editor { display: grid; gap: 8px; }
#opponents-config .opp-label {
    font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label);
    text-transform: uppercase; color: var(--tx-dim);
}
#opponents-config .opp-form-row { display: flex; gap: 8px; align-items: flex-start; }
#opponents-config .opp-input {
    flex: 1; min-width: 0;
    height: auto; min-height: 40px; max-height: 180px;
    padding: 9px 12px; line-height: 1.45;
    font-family: var(--font-mono); font-size: var(--t-xs);
    resize: vertical; field-sizing: content;
}
#opponents-config .opp-input:disabled { opacity: 0.6; }
#opponents-config .opp-hint { font-size: var(--t-xs); color: var(--tx-dim); }
#opponents-config .opp-progress {
    height: 3px; border-radius: var(--radius-full);
    background: var(--tx-rule); overflow: hidden;
}
#opponents-config .opp-progress[hidden] { display: none; }
#opponents-config .opp-progress-bar { height: 100%; background: var(--tx-accent); transition: width 0.2s ease; }
#opponents-config .opp-status { font-size: var(--t-xs); color: var(--tx-mid); }
#opponents-config .opp-status:empty { display: none; }
#opponents-config .opp-status.is-bad { color: var(--tx-bad); }

#opponents-config .opp-loaded {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--tx-rule); border-radius: var(--radius-md);
    background: var(--tx-bg);
}
#opponents-config .opp-loaded-check {
    flex: none; display: grid; place-items: center;
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--good-soft); color: var(--tx-good); font-weight: 700;
}
#opponents-config .opp-loaded-text { display: grid; gap: 2px; min-width: 0; flex: 1; }
#opponents-config .opp-loaded-name {
    font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#opponents-config .opp-loaded-meta { font-size: var(--t-xs); color: var(--tx-dim); }
#opponents-config .opp-loaded-meta a { color: var(--tx-mid); }
#opponents-config .opp-loaded-meta a:hover { color: var(--tx-accent); }
#opponents-config .opp-loaded-actions { display: flex; gap: 6px; flex: none; }

@keyframes opp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
    #opponents-config .opp-seat.is-loading .opp-seat-num { animation-duration: 2.4s; }
}
@media (max-width: 640px) {
    #opponents-config .opp-seat { flex: 1 1 0; padding-right: 10px; }
    #opponents-config .opp-seat-meta { display: none; }
    #opponents-config .opp-form-row,
    #opponents-config .opp-loaded { flex-wrap: wrap; }
    #opponents-config .opp-input { flex-basis: 100%; }
    #opponents-config .opp-form-row .btn { flex: 1; }
    #opponents-config .opp-loaded-actions { width: 100%; }
    #opponents-config .opp-loaded-actions .btn { flex: 1; }
}
`;

function ensureStyles() {
    if (typeof document === 'undefined' || document.querySelector('style[data-owner="opponents"]')) return;
    const style = document.createElement('style');
    style.dataset.owner = 'opponents';
    style.textContent = BAR_STYLES;
    document.head.appendChild(style);
}

function seatMeta(key) {
    const status = seatStatus[key];
    if (status?.state === 'loading') return `Loading… ${Math.round(status.pct ?? 0)}%`;
    if (status?.state === 'error') return 'Import failed';
    const data = opponentDecks[key];
    if (!hasCards(data)) return 'No deck yet';
    const d = describeOpponentDeck(data);
    return `${d.cards} cards · ${d.lands} lands`;
}

function seatsHtml() {
    const seats = activeOpponents.map((key, i) => {
        const data = opponentDecks[key];
        const status = seatStatus[key]?.state;
        const loaded = hasCards(data);
        const selected = key === currentSelectedOpponent;
        const cls = ['opp-seat', status === 'loading' ? 'is-loading' : status === 'error' ? 'is-error' : loaded ? 'is-loaded' : 'is-empty'].join(' ');
        const name = loaded ? data.name : `Opponent ${i + 1}`;
        return `<button type="button" class="${cls}" role="tab" id="opp-seat-${key}" data-opponent="${key}"
                aria-selected="${selected}" aria-controls="shared-opponent-import" tabindex="${selected ? 0 : -1}"
                title="${escapeHtml(name)}">
            <span class="opp-seat-num" style="--seat:${seatColor(i)}" aria-hidden="true">${i + 1}</span>
            <span class="opp-seat-text">
                <span class="opp-seat-name">${escapeHtml(name)}</span>
                <span class="opp-seat-meta" data-seat-meta="${key}">${seatMeta(key)}</span>
            </span>
        </button>`;
    }).join('');
    const add = activeOpponents.length < MAX_OPPONENTS
        ? '<button type="button" class="btn btn-ghost btn-sm opp-add" data-opp-action="add">+ Add opponent</button>'
        : '';
    return seats + add;
}

function sourceLink(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)} ↗</a>`;
    } catch {
        return '';
    }
}

function importLabel(text) {
    const value = String(text ?? '').trim();
    if (!value) return 'Import';
    return looksLikeDeckUrl(value) ? 'Import link' : 'Import list';
}

function editorHtml() {
    const key = currentSelectedOpponent;
    const index = activeOpponents.indexOf(key);
    const data = opponentDecks[key];
    const status = seatStatus[key];
    const loading = status?.state === 'loading';
    const canRemove = activeOpponents.length > 1 && !isImporting();

    if (hasCards(data) && !replacing.has(key) && !loading) {
        const d = describeOpponentDeck(data);
        const source = data.importUrl ? ` · ${sourceLink(data.importUrl)}` : ' · pasted list';
        return `
        <div class="opp-editor">
            <div class="opp-loaded">
                <span class="opp-loaded-check" aria-hidden="true">✓</span>
                <div class="opp-loaded-text">
                    <span class="opp-loaded-name" title="${escapeHtml(data.name)}">${escapeHtml(data.name)}</span>
                    <span class="opp-loaded-meta">${d.cards} cards · ${d.lands} lands · ${d.spells} spells averaging ${d.avgSpellMv.toFixed(1)} mana${source}</span>
                </div>
                <div class="opp-loaded-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-opp-action="replace">Replace</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-opp-action="${canRemove ? 'remove' : 'clear'}">${canRemove ? 'Remove' : 'Clear'}</button>
                </div>
            </div>
        </div>`;
    }

    const draft = drafts[key] ?? '';
    const error = status?.state === 'error' ? status.message : '';
    const secondary = replacing.has(key) && !loading
        ? '<button type="button" class="btn btn-ghost" data-opp-action="cancel">Cancel</button>'
        : (!hasCards(data) && canRemove && !loading ? '<button type="button" class="btn btn-ghost" data-opp-action="remove">Remove seat</button>' : '');
    return `
        <div class="opp-editor">
            <label class="opp-label" for="shared-${key}-input">Opponent ${index + 1}’s deck</label>
            <div class="opp-form-row">
                <textarea class="field opp-input" id="shared-${key}-input" rows="1" spellcheck="false" autocomplete="off"
                    placeholder="Paste a Moxfield or Archidekt link — or a whole decklist"
                    aria-describedby="shared-${key}-hint shared-${key}-status" ${loading ? 'disabled' : ''}>${escapeHtml(draft)}</textarea>
                <button type="button" class="btn opp-import" data-opp-action="import" ${loading ? 'disabled' : ''}>${loading ? 'Importing…' : importLabel(draft)}</button>
                ${secondary}
            </div>
            <p class="opp-hint" id="shared-${key}-hint">A deck link, or one card per line (“1 Sol Ring”). Press Ctrl+Enter to import.</p>
            <div class="opp-progress" id="shared-${key}-progress" ${loading ? '' : 'hidden'}>
                <div class="opp-progress-bar" id="shared-${key}-progress-bar" style="width:${Math.round(status?.pct ?? 0)}%"></div>
            </div>
            <p class="opp-status ${error ? 'is-bad' : ''}" id="shared-${key}-status" role="status" aria-live="polite">${escapeHtml(loading ? status.message : error)}</p>
        </div>`;
}

let lastSeatsSig = '';
let lastEditorSig = '';

function seatsSignature() {
    return [currentSelectedOpponent, ...activeOpponents.map(k =>
        `${k}:${opponentDecks[k].name}:${hasCards(opponentDecks[k])}:${seatStatus[k]?.state ?? ''}`)].join('|');
}

function editorSignature() {
    const key = currentSelectedOpponent;
    const status = seatStatus[key];
    return [key, activeOpponents.length, isImporting(), opponentDecks[key].name, opponentDecks[key].deckSize,
        hasCards(opponentDecks[key]), replacing.has(key), status?.state ?? '', status?.state === 'error' ? status.message : ''].join('|');
}

/** Update just the live progress of one seat (called many times per import). */
function paintProgress(key) {
    if (typeof document === 'undefined') return;
    const meta = document.querySelector(`[data-seat-meta="${key}"]`);
    if (meta) meta.textContent = seatMeta(key);
    if (key !== currentSelectedOpponent) return;
    const status = seatStatus[key];
    const bar = document.getElementById(`shared-${key}-progress-bar`);
    if (bar) bar.style.width = `${Math.round(status?.pct ?? 0)}%`;
    const text = document.getElementById(`shared-${key}-status`);
    if (text && status?.message) text.textContent = status.message;
}

let barQueued = false;
function queueBarRender() {
    if (barQueued || typeof document === 'undefined') return;
    barQueued = true;
    const run = () => { barQueued = false; renderOpponentTabs(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

/**
 * Render the opponent bar (seat row + the selected seat's editor). Only the
 * parts whose state changed are rebuilt, so typing in a seat's field is never
 * interrupted by another seat finishing its import.
 */
export function renderOpponentTabs() {
    if (typeof document === 'undefined') return;
    const tabsContainer = document.getElementById('shared-opponent-tabs');
    const importContainer = document.getElementById('shared-opponent-import');
    if (!tabsContainer || !importContainer) return;

    ensureStyles();
    bindBar(tabsContainer, importContainer);

    if (!activeOpponents.includes(currentSelectedOpponent)) currentSelectedOpponent = activeOpponents[0];

    const seatsSig = seatsSignature();
    if (seatsSig !== lastSeatsSig || !tabsContainer.firstElementChild) {
        const focusedSeat = tabsContainer.contains(document.activeElement) ? document.activeElement?.dataset?.opponent : null;
        tabsContainer.innerHTML = seatsHtml();
        lastSeatsSig = seatsSig;
        if (focusedSeat) document.getElementById(`opp-seat-${focusedSeat}`)?.focus();
    }

    const editorSig = editorSignature();
    if (editorSig !== lastEditorSig || !importContainer.firstElementChild) {
        const field = document.activeElement;
        const refocus = importContainer.contains(field) && field?.tagName === 'TEXTAREA'
            ? { id: field.id, start: field.selectionStart, end: field.selectionEnd } : null;
        importContainer.innerHTML = editorHtml();
        importContainer.setAttribute('aria-labelledby', `opp-seat-${currentSelectedOpponent}`);
        lastEditorSig = editorSig;
        if (refocus) {
            const next = document.getElementById(refocus.id);
            if (next && !next.disabled) {
                next.focus();
                try { next.setSelectionRange(refocus.start, refocus.end); } catch { /* not a text field */ }
            }
        }
    }
}

function selectedField() {
    return document.getElementById(`shared-${currentSelectedOpponent}-input`);
}

async function importFromField(key) {
    const field = document.getElementById(`shared-${key}-input`);
    const value = (field?.value ?? drafts[key] ?? '').trim();
    if (!value) {
        const status = document.getElementById(`shared-${key}-status`);
        if (status) {
            status.textContent = 'Paste a deck link or a decklist first.';
            status.classList.add('is-bad');
        }
        field?.focus();
        return;
    }
    drafts[key] = value;
    try {
        await importOpponentDeck(key, value, looksLikeDeckUrl(value));
    } catch (err) {
        console.warn(`Opponent ${key} import failed:`, err?.message ?? err);
        renderOpponentTabs();
        if (key === currentSelectedOpponent) selectedField()?.focus();
    }
}

function handleBarAction(action) {
    const key = currentSelectedOpponent;
    switch (action) {
        case 'add': {
            const added = addOpponent();
            renderOpponentTabs();
            if (added) selectedField()?.focus();
            break;
        }
        case 'import':
            importFromField(key);
            break;
        case 'replace':
            replacing.add(key);
            renderOpponentTabs();
            selectedField()?.focus();
            break;
        case 'cancel':
            replacing.delete(key);
            if (seatStatus[key]?.state === 'error') delete seatStatus[key];
            renderOpponentTabs();
            break;
        case 'remove':
            removeOpponent(key);
            renderOpponentTabs();
            break;
        case 'clear':
            clearOpponentDeck(key);
            renderOpponentTabs();
            break;
        default:
            break;
    }
}

function bindBar(tabsContainer, importContainer) {
    if (tabsContainer.dataset.bound === 'true') return;
    tabsContainer.dataset.bound = 'true';
    tabsContainer.setAttribute('role', 'tablist');
    tabsContainer.setAttribute('aria-label', 'Opponents');
    importContainer.setAttribute('role', 'tabpanel');

    tabsContainer.addEventListener('click', e => {
        const action = e.target.closest('[data-opp-action]');
        if (action) { handleBarAction(action.dataset.oppAction); return; }
        const seat = e.target.closest('.opp-seat');
        if (seat) switchOpponentTab(seat.dataset.opponent);
    });

    // Arrow keys move between seats, as in any tab list.
    tabsContainer.addEventListener('keydown', e => {
        const seat = e.target.closest('.opp-seat');
        if (!seat) return;
        const i = activeOpponents.indexOf(seat.dataset.opponent);
        let next = null;
        if (e.key === 'ArrowRight') next = activeOpponents[(i + 1) % activeOpponents.length];
        else if (e.key === 'ArrowLeft') next = activeOpponents[(i - 1 + activeOpponents.length) % activeOpponents.length];
        else if (e.key === 'Home') next = activeOpponents[0];
        else if (e.key === 'End') next = activeOpponents[activeOpponents.length - 1];
        if (!next) return;
        e.preventDefault();
        switchOpponentTab(next);
        document.getElementById(`opp-seat-${next}`)?.focus();
    });

    importContainer.addEventListener('click', e => {
        const action = e.target.closest('[data-opp-action]');
        if (action && !action.disabled) handleBarAction(action.dataset.oppAction);
    });

    importContainer.addEventListener('input', e => {
        if (!e.target.classList?.contains('opp-input')) return;
        const key = currentSelectedOpponent;
        drafts[key] = e.target.value;
        const btn = importContainer.querySelector('.opp-import');
        if (btn && !btn.disabled) btn.textContent = importLabel(e.target.value);
        const status = document.getElementById(`shared-${key}-status`);
        if (status?.classList.contains('is-bad')) {
            status.textContent = '';
            status.classList.remove('is-bad');
        }
        if (seatStatus[key]?.state === 'error') {
            // Editing clears the failure; the field itself stays put (and focused).
            delete seatStatus[key];
            lastEditorSig = editorSignature();
            renderOpponentTabs();
        }
    });

    importContainer.addEventListener('keydown', e => {
        if (!e.target.classList?.contains('opp-input')) return;
        const single = !e.target.value.includes('\n') && looksLikeDeckUrl(e.target.value);
        if (e.key === 'Enter' && ((e.ctrlKey || e.metaKey) || (single && !e.shiftKey))) {
            e.preventDefault();
            importFromField(currentSelectedOpponent);
        }
    });
}

/**
 * Bring the import field into view and focus it — the first empty seat, or a
 * new one. Used by the pages' "Import your own" buttons.
 */
export function focusImportField() {
    if (typeof document === 'undefined') return;
    const toggle = document.getElementById('opponents-toggle');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();

    let target = activeOpponents.find(k => !hasCards(opponentDecks[k]) && seatStatus[k]?.state !== 'loading');
    if (!target) target = activeOpponents.length < MAX_OPPONENTS ? addOpponent() : currentSelectedOpponent;
    currentSelectedOpponent = target;
    if (hasCards(opponentDecks[target])) replacing.add(target);
    renderOpponentTabs();

    const bar = document.getElementById('opponents-config');
    if (bar) {
        const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: Math.max(0, bar.getBoundingClientRect().top + window.scrollY - topbar - 12), behavior: reduce ? 'auto' : 'smooth' });
    }
    document.getElementById(`shared-${target}-input`)?.focus({ preventScroll: true });
}

/** Initialise the bar (main.js calls this once at startup). */
export function init() {
    renderOpponentTabs();
}
