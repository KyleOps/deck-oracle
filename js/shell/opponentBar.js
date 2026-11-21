/**
 * The "Opponent decklists" bar above the multiplayer pages (#opponents-config
 * in index.html): one tab per seat, and the selected seat's import field or
 * loaded deck.
 *
 * Loaded by main.js the first time a page that reads opponents opens, so the
 * other pages never download or render it. State lives in
 * js/utils/opponentState.js; this module owns only what the bar shows: the
 * selected seat, unsent text in each field, and which seats are being replaced.
 */

import * as OpponentState from '../utils/opponentState.js';
import { escapeHtml } from '../data/glossary.js';
import { toast } from './overlays.js';

const { MAX_OPPONENTS, hasCards, looksLikeDeckUrl, describeOpponentDeck, seatColor } = OpponentState;

/** "Load example opponents": three public Moxfield decks. */
const EXAMPLE_OPPONENTS = Object.freeze([
    'https://moxfield.com/decks/NVsnEkQ3y02ATHYk6n1pTA',
    'https://moxfield.com/decks/Vpiz7R8Rfk-0J7yX0AUQtA',
    'https://moxfield.com/decks/KP_jB2nYqUmQHVjYQeldyA'
]);

let selected = 'opponent1';
/** Unsent text in each seat's import field, so re-renders never eat what was typed. */
let drafts = {};
/** Seats showing the import form over a deck that is already loaded ("Replace"). */
let replacing = new Set();
/** Each seat's deck object at the last render: a new one means an import landed. */
const lastDecks = {};

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
    if (document.querySelector('style[data-owner="opponents"]')) return;
    const style = document.createElement('style');
    style.dataset.owner = 'opponents';
    style.textContent = BAR_STYLES;
    document.head.appendChild(style);
}

const active = () => OpponentState.getActiveOpponents();
const deckOf = key => OpponentState.getOpponentData(key);
const statusOf = key => OpponentState.getImportStatus(key);

function seatMeta(key) {
    const status = statusOf(key);
    if (status?.state === 'loading') return `Loading… ${Math.round(status.pct ?? 0)}%`;
    if (status?.state === 'error') return 'Import failed';
    const data = deckOf(key);
    if (!hasCards(data)) return 'No deck yet';
    const d = describeOpponentDeck(data);
    return `${d.cards} cards · ${d.lands} lands`;
}

function seatsHtml() {
    const seats = active().map((key, i) => {
        const data = deckOf(key);
        const status = statusOf(key)?.state;
        const loaded = hasCards(data);
        const isSelected = key === selected;
        const cls = ['opp-seat', status === 'loading' ? 'is-loading' : status === 'error' ? 'is-error' : loaded ? 'is-loaded' : 'is-empty'].join(' ');
        const name = loaded ? data.name : `Opponent ${i + 1}`;
        return `<button type="button" class="${cls}" role="tab" id="opp-seat-${key}" data-opponent="${key}"
                aria-selected="${isSelected}" aria-controls="shared-opponent-import" tabindex="${isSelected ? 0 : -1}"
                title="${escapeHtml(name)}">
            <span class="opp-seat-num" style="--seat:${seatColor(i)}" aria-hidden="true">${i + 1}</span>
            <span class="opp-seat-text">
                <span class="opp-seat-name">${escapeHtml(name)}</span>
                <span class="opp-seat-meta" data-seat-meta="${key}">${seatMeta(key)}</span>
            </span>
        </button>`;
    }).join('');
    const add = active().length < MAX_OPPONENTS
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
    const key = selected;
    const index = active().indexOf(key);
    const data = deckOf(key);
    const status = statusOf(key);
    const loading = status?.state === 'loading';
    const canRemove = active().length > 1 && !OpponentState.isImporting();

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
    return [selected, ...active().map(k =>
        `${k}:${deckOf(k).name}:${hasCards(deckOf(k))}:${statusOf(k)?.state ?? ''}`)].join('|');
}

function editorSignature() {
    const key = selected;
    const status = statusOf(key);
    return [key, active().length, OpponentState.isImporting(), deckOf(key).name, deckOf(key).deckSize,
        hasCards(deckOf(key)), replacing.has(key), status?.state ?? '', status?.state === 'error' ? status.message : ''].join('|');
}

/** Update just the live progress of one seat (called many times per import). */
function paintProgress(key) {
    const meta = document.querySelector(`[data-seat-meta="${key}"]`);
    if (meta) meta.textContent = seatMeta(key);
    if (key !== selected) return;
    const status = statusOf(key);
    const bar = document.getElementById(`shared-${key}-progress-bar`);
    if (bar) bar.style.width = `${Math.round(status?.pct ?? 0)}%`;
    const text = document.getElementById(`shared-${key}-status`);
    if (text && status?.message) text.textContent = status.message;
}

/**
 * A seat whose deck changed has finished an import (its draft is spent) or
 * been cleared (nothing left to replace).
 */
function settleFinishedImports() {
    for (const key of OpponentState.SEAT_KEYS) {
        const deck = deckOf(key);
        if (lastDecks[key] && lastDecks[key] !== deck) {
            replacing.delete(key);
            if (hasCards(deck)) delete drafts[key];
        }
        lastDecks[key] = deck;
    }
}

let queued = false;
function queueRender() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderOpponentTabs(); });
}

/**
 * Render the bar (seat row + the selected seat's editor). Only the parts
 * whose state changed are rebuilt, so typing in a seat's field is never
 * interrupted by another seat finishing its import.
 */
export function renderOpponentTabs() {
    const tabsContainer = document.getElementById('shared-opponent-tabs');
    const importContainer = document.getElementById('shared-opponent-import');
    if (!tabsContainer || !importContainer) return;

    settleFinishedImports();
    if (!active().includes(selected)) selected = active()[0];

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
        importContainer.setAttribute('aria-labelledby', `opp-seat-${selected}`);
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

/** Select a seat. */
export function switchOpponentTab(key) {
    if (!active().includes(key)) return;
    selected = key;
    renderOpponentTabs();
}

const selectedField = () => document.getElementById(`shared-${selected}-input`);

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
        await OpponentState.importOpponentDeck(key, value, looksLikeDeckUrl(value));
    } catch (err) {
        console.warn(`Opponent ${key} import failed:`, err?.message ?? err);
        renderOpponentTabs();
        if (key === selected) selectedField()?.focus();
    }
}

/** Remove a seat, carrying each later seat's draft and "replacing" flag along. */
function removeSeat(key) {
    const index = active().indexOf(key);
    const moved = OpponentState.removeOpponent(key);
    if (!moved) return;
    const nextDrafts = {};
    const nextReplacing = new Set();
    for (const [from, to] of Object.entries(moved)) {
        if (drafts[from]) nextDrafts[to] = drafts[from];
        if (replacing.has(from)) nextReplacing.add(to);
    }
    drafts = nextDrafts;
    replacing = nextReplacing;
    // The removed seat's neighbour takes the selection; any other seat keeps it.
    selected = moved[selected] ?? active()[Math.max(0, index - 1)];
    for (const k of OpponentState.SEAT_KEYS) lastDecks[k] = deckOf(k);
}

function handleBarAction(action) {
    const key = selected;
    switch (action) {
        case 'add': {
            const added = OpponentState.addOpponent();
            if (added) selected = added;
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
            OpponentState.clearImportError(key);
            renderOpponentTabs();
            break;
        case 'remove':
            removeSeat(key);
            renderOpponentTabs();
            break;
        case 'clear':
            OpponentState.clearOpponentDeck(key);
            renderOpponentTabs();
            break;
        default:
            break;
    }
}

function bindBar(tabsContainer, importContainer) {
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
        const list = active();
        const i = list.indexOf(seat.dataset.opponent);
        let next = null;
        if (e.key === 'ArrowRight') next = list[(i + 1) % list.length];
        else if (e.key === 'ArrowLeft') next = list[(i - 1 + list.length) % list.length];
        else if (e.key === 'Home') next = list[0];
        else if (e.key === 'End') next = list[list.length - 1];
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
        const key = selected;
        drafts[key] = e.target.value;
        const btn = importContainer.querySelector('.opp-import');
        if (btn && !btn.disabled) btn.textContent = importLabel(e.target.value);
        const status = document.getElementById(`shared-${key}-status`);
        if (status?.classList.contains('is-bad')) {
            status.textContent = '';
            status.classList.remove('is-bad');
        }
        if (statusOf(key)?.state === 'error') {
            // Editing clears the failure; the field itself stays put (and focused).
            OpponentState.clearImportError(key);
            lastEditorSig = editorSignature();
            renderOpponentTabs();
        }
    });

    importContainer.addEventListener('keydown', e => {
        if (!e.target.classList?.contains('opp-input')) return;
        const single = !e.target.value.includes('\n') && looksLikeDeckUrl(e.target.value);
        if (e.key === 'Enter' && ((e.ctrlKey || e.metaKey) || (single && !e.shiftKey))) {
            e.preventDefault();
            importFromField(selected);
        }
    });
}

/**
 * Bring the import field into view and focus it — the first empty seat, or a
 * new one. Pages ask through OpponentState.focusImportField().
 */
function focusImportField() {
    const toggle = document.getElementById('opponents-toggle');
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();

    const list = active();
    let target = list.find(k => !hasCards(deckOf(k)) && statusOf(k)?.state !== 'loading');
    if (!target) target = list.length < MAX_OPPONENTS ? OpponentState.addOpponent() : selected;
    selected = target;
    if (hasCards(deckOf(target))) replacing.add(target);
    renderOpponentTabs();

    const bar = document.getElementById('opponents-config');
    if (bar) {
        const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 56;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: Math.max(0, bar.getBoundingClientRect().top + window.scrollY - topbar - 12), behavior: reduce ? 'auto' : 'smooth' });
    }
    document.getElementById(`shared-${target}-input`)?.focus({ preventScroll: true });
}

async function loadExampleOpponents(button) {
    const label = button.textContent;
    button.textContent = 'Loading…';
    button.disabled = true;
    try {
        while (active().length < EXAMPLE_OPPONENTS.length && OpponentState.addOpponent()) { /* add seats */ }
        await Promise.all(EXAMPLE_OPPONENTS.map((url, i) =>
            OpponentState.importOpponentDeck(OpponentState.SEAT_KEYS[i], url, true)));
        toast('Loaded three example opponents.', { tone: 'good' });
    } catch (e) {
        console.error('Failed to load example opponents', e);
        toast('Couldn’t load the example opponents. Check your connection.', { tone: 'bad' });
    } finally {
        button.textContent = label;
        button.disabled = false;
    }
}

/**
 * Seat the bar under a page's header, so a multiplayer page opens with what
 * the card does before asking for decklists, and show it.
 * @param {Element|null} panel - the page's `#<key>-tab` element
 */
export function showBar(panel) {
    const bar = document.getElementById('opponents-config');
    if (!bar) return;
    const body = panel?.querySelector(':scope > .calc-body');
    if (body && bar.nextElementSibling !== body) body.before(bar);
    renderOpponentTabs();
    bar.hidden = false;
}

let initialised = false;

/** Wire the bar once (main.js calls this when the module first loads). */
export function initOpponentBar() {
    if (initialised) return;
    initialised = true;
    const tabsContainer = document.getElementById('shared-opponent-tabs');
    const importContainer = document.getElementById('shared-opponent-import');
    if (!tabsContainer || !importContainer) return;
    ensureStyles();
    bindBar(tabsContainer, importContainer);

    const toggle = document.getElementById('opponents-toggle');
    const body = document.getElementById('opponents-body');
    toggle?.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide' : 'Show';
        if (body) body.hidden = !open;
    });
    const exampleBtn = document.getElementById('load-example-opponents-btn');
    exampleBtn?.addEventListener('click', () => loadExampleOpponents(exampleBtn));

    OpponentState.onOpponentChange(queueRender);
    OpponentState.onImportProgress(paintProgress);
    OpponentState.setFocusImportHandler(focusImportField);
    renderOpponentTabs();
}
