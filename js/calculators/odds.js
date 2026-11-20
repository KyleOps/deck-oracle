/**
 * Draw Odds — what are the chances I draw a card, or one of a group, by a
 * given turn?
 *
 * Works for any deck: Commander, 60- and 40-card lists, imported or typed in
 * as bare counts. This module only holds the page state, wires the inputs and
 * renders; the maths, presets, sentences and share-link codec live in
 * js/utils/drawOdds.js (pure and unit-tested).
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { createOrUpdateChart, TX_CHART } from '../utils/chartHelpers.js';
import { debounce } from '../utils/simulation.js';
import { cardsSeenByTurn } from '../utils/format.js';
import { escapeHtml, cardRef } from '../data/glossary.js';
import * as O from '../utils/drawOdds.js';

const NAME = 'odds';
const DEFAULT_TURN = 3;
const GROUP_CLASS = ['g-a', 'g-b', 'g-c'];
/** TX_CHART.series slots for groups A/B/C — blue, violet, teal: no good/bad or accent meaning. */
const SERIES_SLOT = [2, 4, 5];
const MEMBER_PREVIEW = 8;
const PANES = [
    { key: 'search', label: 'Search' },
    { key: 'type', label: 'Type' },
    { key: 'role', label: 'Role' },
    { key: 'mv', label: 'Mana value' }
];

const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

const state = {
    turn: DEFAULT_TURN,
    onPlay: true,
    groups: [O.emptyGroup()],
    active: 0,
    pane: 'search',
    expanded: new Set()
};

let chart = null;
let debouncedUpdate = null;
let libCache = { key: null, lib: null };
let last = null;
let suggestions = [];
const typeahead = { group: -1, items: [], index: -1 };

// ── Context ──────────────────────────────────────────────────────────────────

function getLibrary(config, format) {
    if (!DeckConfig.hasCardList()) {
        return O.buildManualLibrary(config, DeckConfig.getDeckSize(true));
    }
    const key = [config.cardsByName, format.key, config.commanderName, config.actualCardCount];
    if (libCache.lib && libCache.key.every((v, i) => v === key[i])) return libCache.lib;
    const lib = O.buildLibrary(config.cardsByName, {
        commanderName: config.commanderName,
        excludeCommander: format.key === 'commander',
        deckSize: config.actualCardCount ?? null
    });
    libCache = { key, lib };
    return lib;
}

function context() {
    const config = DeckConfig.getDeckConfig();
    const format = DeckConfig.getFormat();
    const library = getLibrary(config, format);
    const onPlay = format.firstPlayerDraws ? true : state.onPlay;
    return { config, format, library, onPlay };
}

/** Keep the groups valid for the current library (card list vs bare counts). */
function fitGroups(library) {
    state.groups = state.groups.slice(0, O.MAX_GROUPS).map(g => {
        if (library.manual) return g.kind === 'manual' || g.kind === 'type' ? g : O.emptyGroup(true);
        return g.kind === 'manual' ? O.emptyGroup(false) : g;
    });
    if (state.groups.length === 0) state.groups = [O.emptyGroup(library.manual)];
    state.active = Math.min(Math.max(0, state.active), state.groups.length - 1);
}

/** Recompute everything. Exported for tests and share links. */
export function calculate() {
    const ctx = context();
    fitGroups(ctx.library);
    const result = O.analyzeOdds({ library: ctx.library, groups: state.groups, format: ctx.format, onPlay: ctx.onPlay });
    last = { ...ctx, result };
    return last;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const toneOf = p => (p >= 0.8 ? 'good' : p >= 0.5 ? 'warn' : 'bad');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pctHtml = p => escapeHtml(O.formatPct(p));

function groupColor(index) {
    return TX_CHART.series[SERIES_SLOT[index]] ?? TX_CHART.blue;
}

function fade(color, alpha) {
    const value = String(color ?? '').trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const rgb = /rgba?\(([^)]+)\)/.exec(value);
    if (rgb) {
        const [r, g, b] = rgb[1].split(',').map(s => s.trim());
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return value;
}

function seenAt(turn, ctx = last) {
    if (!ctx) return 7;
    return Math.min(ctx.library.size, cardsSeenByTurn(turn, { format: ctx.format, onPlay: ctx.onPlay }));
}

function reachText(turn, atSearch = 0) {
    if (turn === null) {
        return { value: `<span class="odds-word">Not by turn ${O.SEARCH_TURN}</span>`, sub: `only ${pctHtml(atSearch)} by then` };
    }
    return {
        value: turn === 0 ? '<span class="odds-word">Opening hand</span>' : `Turn ${turn}`,
        sub: `${seenAt(turn)} cards seen`
    };
}

/** "of 18 cards" / "of 24 copies · 9 cards" / "of 1 copy". */
function copiesText(cards, copies) {
    if (cards > 1) return copies === cards ? plural(cards, 'card', 'cards') : `${plural(copies, 'copy', 'copies')} · ${cards} cards`;
    return plural(copies, 'copy', 'copies');
}

function setHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
    return el;
}

// ── Rail: turn picker ────────────────────────────────────────────────────────

let turnBoxKey = null;

function renderTurnBox(ctx) {
    const { format, library } = ctx;
    const key = `${format.key}|${format.firstPlayerDraws}`;
    const meta = document.getElementById('odds-format');
    if (meta) {
        const tip = library.commanderExcluded ? ' data-tip="Your commander starts in the command zone, so it is not in the library." tabindex="0"' : '';
        meta.innerHTML = `<span${tip}>${escapeHtml(format.label)} · ${library.size}-card library</span>`;
    }
    if (turnBoxKey !== key || !document.getElementById('odds-turn')) {
        turnBoxKey = key;
        const ticks = Array.from({ length: O.MAX_TURN + 1 }, (_, i) =>
            `<span style="--i:${i}" data-tick="${i}">${i === 0 ? 'Hand' : i}</span>`).join('');
        setHtml('odds-turn-box', `
            <div class="odds-turn-read" aria-hidden="true">
                <span class="odds-turn-big" id="odds-turn-big"></span>
                <span class="odds-turn-sub" id="odds-turn-sub"></span>
            </div>
            <input type="range" class="odds-range" id="odds-turn" min="0" max="${O.MAX_TURN}" step="1"
                value="${state.turn}" aria-labelledby="odds-turn-title">
            <div class="odds-ticks" aria-hidden="true">${ticks}</div>
            ${format.firstPlayerDraws ? '' : `
            <div class="seg seg-sm odds-order" role="group" aria-label="Turn order">
                <button class="seg-btn" type="button" id="odds-play" data-play="1">On the play</button>
                <button class="seg-btn" type="button" id="odds-draw" data-play="0">On the draw</button>
            </div>`}
            <p class="odds-hint" id="odds-turn-hint"></p>`);
    }
    syncTurn(ctx);
}

/** Update the turn read-out without rebuilding the slider (keeps a drag alive). */
function syncTurn(ctx = last) {
    if (!ctx) return;
    const seen = seenAt(state.turn, ctx);
    const range = document.getElementById('odds-turn');
    if (range) {
        if (Number(range.value) !== state.turn) range.value = String(state.turn);
        range.style.setProperty('--fill', `${(state.turn / O.MAX_TURN) * 100}%`);
        range.setAttribute('aria-valuetext', `${O.turnLabel(state.turn)}, ${seen} cards seen`);
    }
    const big = document.getElementById('odds-turn-big');
    if (big) big.textContent = O.turnLabel(state.turn);
    const sub = document.getElementById('odds-turn-sub');
    if (sub) sub.textContent = `${seen} cards seen`;
    document.querySelectorAll('#odds-turn-box [data-tick]').forEach(t => {
        t.classList.toggle('is-on', Number(t.dataset.tick) === state.turn);
    });
    const play = document.getElementById('odds-play');
    const draw = document.getElementById('odds-draw');
    if (play && draw) {
        play.classList.toggle('active', ctx.onPlay);
        draw.classList.toggle('active', !ctx.onPlay);
        play.setAttribute('aria-pressed', String(ctx.onPlay));
        draw.setAttribute('aria-pressed', String(!ctx.onPlay));
    }
    const hint = document.getElementById('odds-turn-hint');
    if (hint) {
        hint.textContent = ctx.format.firstPlayerDraws
            ? `Seven-card opening hand, then one draw a turn — in multiplayer nobody skips the first draw.`
            : ctx.onPlay
                ? 'Seven-card opening hand, then one draw a turn. On the play you skip your first draw.'
                : 'Seven-card opening hand, then one draw a turn, starting on turn 1.';
    }
}

// ── Rail: groups ─────────────────────────────────────────────────────────────

function chipHtml(gi, name, copies, missing, idx) {
    const label = escapeHtml(name);
    const body = missing
        ? `<span class="og-chip-name" data-tip="${missing === 'commander' ? 'Your commander starts in the command zone, so it is never drawn.' : 'Not in this deck’s library'}" tabindex="0">${label}</span>`
        : `${cardRef(name)}${copies > 1 ? `<span class="og-chip-n">×${copies}</span>` : ''}`;
    return `<span class="og-chip${missing ? ' is-missing' : ''}">${body}<button type="button" class="og-chip-x" id="odds-g${gi}-x${idx}" data-act="drop" data-name="${label}" aria-label="Remove ${label} from group ${O.GROUP_IDS[gi]}">×</button></span>`;
}

function membersHtml(gi, group, resolved, library) {
    if (library.manual) return '';
    const commander = DeckConfig.getDeckConfig().commanderName;
    const names = group.kind === 'cards' ? group.cards : resolved.names;
    if (names.length === 0) return '';
    const sorted = group.kind === 'cards' ? names : names.slice().sort((a, b) =>
        (library.byName.get(b)?.count ?? 0) - (library.byName.get(a)?.count ?? 0) || a.localeCompare(b));
    const open = state.expanded.has(gi);
    const shown = open ? sorted : sorted.slice(0, MEMBER_PREVIEW);
    const chips = shown.map((n, i) => {
        const card = library.byName.get(n);
        const missing = card ? null : (n === commander && library.commanderExcluded ? 'commander' : 'missing');
        return chipHtml(gi, n, card?.count ?? 0, missing, i);
    }).join('');
    const rest = sorted.length - shown.length;
    const more = sorted.length > MEMBER_PREVIEW
        ? `<button type="button" class="og-more" id="odds-g${gi}-more" data-act="more" aria-expanded="${open}">${open ? 'Show fewer' : `+${rest} more`}</button>`
        : '';
    return `<div class="og-members">${chips}${more}</div>`;
}

function presetPaneHtml(gi, group, kind, counts, library) {
    const list = counts[kind] ?? [];
    const buttons = list.map(p => {
        const pressed = group.kind === kind && group.key === p.key;
        const disabled = p.copies === 0 && !pressed;
        return `<button type="button" class="og-preset" id="odds-g${gi}-p-${kind}-${p.key}" data-act="preset" data-kind="${kind}" data-key="${p.key}"
            aria-pressed="${pressed}"${disabled ? ' disabled' : ''}>${escapeHtml(p.chip)} <span>${p.copies}</span></button>`;
    }).join('');
    const tip = {
        type: library.manual ? 'From the type counts you entered. Cards with two types count for both.' : 'Cards with two types — an artifact creature — count for both.',
        role: 'Detected from rules text. Odd wordings can be missed, so check the list below.',
        mv: 'Nonland cards by mana value.'
    }[kind];
    return `<div class="og-presets" role="group" aria-label="${escapeHtml(PANES.find(p => p.key === kind)?.label ?? '')} presets">${buttons}</div><p class="og-tip">${tip}</p>`;
}

function searchPaneHtml(gi) {
    return `
        <div class="og-search">
            ${ICON_SEARCH}
            <input type="text" class="og-search-input" id="odds-g${gi}-search" data-gi="${gi}"
                role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="odds-g${gi}-list"
                aria-label="Search your deck for cards to add to group ${O.GROUP_IDS[gi]}"
                placeholder="Search your deck…" autocomplete="off" spellcheck="false">
            <ul class="og-list" id="odds-g${gi}-list" role="listbox" aria-label="Matching cards" hidden></ul>
        </div>
        <p class="og-tip">Type a name, <kbd>↑</kbd><kbd>↓</kbd> to choose, <kbd>Enter</kbd> to add. Pick a card again to take it out.</p>`;
}

function groupHtml(gi, group, ctx, counts) {
    const { library } = ctx;
    const id = O.GROUP_IDS[gi];
    const resolved = O.resolveGroup(group, library);
    const active = gi === state.active;
    const name = typeof group.name === 'string' ? group.name : '';
    const placeholder = O.autoName(group, gi, resolved);
    const maxNeed = Math.max(1, Math.min(O.MAX_NEED, resolved.copies || O.MAX_NEED));
    const need = Math.max(1, Math.min(O.MAX_NEED, group.need));
    const only = resolved.copies > 0 && need > resolved.copies;
    const removeLabel = state.groups.length === 1 ? `Clear group ${id}` : `Remove group ${id}`;

    const of = library.manual
        ? `<span class="og-of">of <strong>${resolved.copies}</strong> in the deck</span>`
        : resolved.copies > 0
            ? `<span class="og-of">of ${copiesText(resolved.names.length, resolved.copies).replace(/^(\d+)/, '<strong>$1</strong>')}</span>`
            : '<span class="og-of">pick cards below</span>';

    const manualCount = library.manual ? `
        <div class="og-need">
            <label for="odds-g${gi}-count">Copies in deck</label>
            <div class="og-stepper og-count">
                <input type="number" id="odds-g${gi}-count" data-gi="${gi}" data-field="count" inputmode="numeric"
                    min="0" max="${library.size}" value="${resolved.copies}">
            </div>
        </div>` : '';

    let add = '';
    if (active) {
        const panes = library.manual ? PANES.filter(p => p.key === 'type') : PANES;
        const pane = panes.some(p => p.key === state.pane) ? state.pane : panes[0].key;
        const tabs = panes.length > 1 ? `
            <div class="seg seg-sm og-tabs" role="group" aria-label="Ways to add cards to group ${id}">
                ${panes.map(p => `<button type="button" class="seg-btn${p.key === pane ? ' active' : ''}" id="odds-g${gi}-pane-${p.key}" data-act="pane" data-pane="${p.key}" aria-pressed="${p.key === pane}">${p.label}</button>`).join('')}
            </div>` : '';
        const body = pane === 'search' ? searchPaneHtml(gi) : presetPaneHtml(gi, group, pane, counts, library);
        add = `<div class="og-add">${tabs}${body}${library.manual ? '<p class="og-tip">No card list — import a decklist to pick cards by name, role or mana value.</p>' : ''}</div>`;
    } else if (resolved.copies === 0) {
        add = `<button type="button" class="btn btn-ghost btn-sm" id="odds-g${gi}-edit" data-act="activate">Add cards to group ${id}</button>`;
    }

    return `
        <section class="og ${GROUP_CLASS[gi]}${active ? ' is-active' : ''}" data-gi="${gi}" aria-labelledby="odds-g${gi}-badge">
            <div class="og-head">
                <span class="og-badge" id="odds-g${gi}-badge" aria-label="Group ${id}">${id}</span>
                <input type="text" class="og-name" id="odds-g${gi}-name" data-gi="${gi}" data-field="name"
                    value="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}" maxlength="${O.MAX_NAME_LENGTH}"
                    aria-label="Name of group ${id}" autocomplete="off" spellcheck="false">
                <button type="button" class="og-x" id="odds-g${gi}-remove" data-act="remove" aria-label="${removeLabel}" data-tip="${removeLabel}">${ICON_X}</button>
            </div>
            ${manualCount}
            <div class="og-need">
                <label for="odds-g${gi}-need">Need at least</label>
                <div class="og-stepper">
                    <button type="button" class="og-step" id="odds-g${gi}-dec" data-act="dec" aria-label="Need one fewer"${need <= 1 ? ' disabled' : ''}>−</button>
                    <input type="number" id="odds-g${gi}-need" data-gi="${gi}" data-field="need" inputmode="numeric"
                        min="1" max="${maxNeed}" value="${need}">
                    <button type="button" class="og-step" id="odds-g${gi}-inc" data-act="inc" aria-label="Need one more"${need >= maxNeed ? ' disabled' : ''}>+</button>
                </div>
                ${of}
                ${only ? `<span class="og-warn">only ${resolved.copies} in the deck</span>` : ''}
            </div>
            ${membersHtml(gi, group, resolved, library)}
            ${add}
        </section>`;
}

function renderGroups(ctx) {
    const box = document.getElementById('odds-groups');
    if (!box) return;
    const focused = box.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id || null;
    let selection = null;
    try {
        if (focused && typeof focused.selectionStart === 'number') selection = [focused.selectionStart, focused.selectionEnd];
    } catch { /* number inputs have no selection */ }
    const searchValue = focused?.classList?.contains('og-search-input') ? focused.value : null;

    const counts = O.presetCounts(ctx.library);
    const canAdd = state.groups.length < O.MAX_GROUPS;
    const nextId = O.GROUP_IDS[state.groups.length];
    box.innerHTML = state.groups.map((g, i) => groupHtml(i, g, ctx, counts)).join('') + `
        <div class="odds-addrow">
            ${canAdd ? `<button type="button" class="btn btn-ghost btn-sm" id="odds-add-group" data-act="add-group">+ Add group ${nextId}</button>` : ''}
            <p class="odds-hint">${state.groups.length > 1 ? 'Every group must be found together — a card in two groups counts for both.' : 'Add a second group to ask for two things at once.'}</p>
        </div>`;

    const used = state.groups.filter(g => O.resolveGroup(g, ctx.library).copies > 0).length;
    const meta = document.getElementById('odds-groups-meta');
    if (meta) meta.textContent = used === 0 ? 'none yet' : `${plural(used, 'group', 'groups')}${used > 1 ? ', all together' : ''}`;

    if (focusId) {
        const el = document.getElementById(focusId)
            ?? (focusId.includes('-x') ? document.getElementById(`odds-g${state.active}-search`) : null);
        if (el) {
            el.focus({ preventScroll: true });
            if (searchValue !== null && el.classList.contains('og-search-input')) el.value = searchValue;
            if (selection) {
                try { el.setSelectionRange(selection[0], selection[1]); } catch { /* not a text field */ }
            }
            if (searchValue) openTypeahead(Number(el.dataset.gi), searchValue);
        }
    }
}

// ── Typeahead ────────────────────────────────────────────────────────────────

function highlight(name, query) {
    const q = String(query ?? '').trim().toLowerCase();
    const i = q ? name.toLowerCase().indexOf(q) : -1;
    if (i < 0) return escapeHtml(name);
    return `${escapeHtml(name.slice(0, i))}<mark>${escapeHtml(name.slice(i, i + q.length))}</mark>${escapeHtml(name.slice(i + q.length))}`;
}

function typeShort(card) {
    if (card.land) return 'Land';
    const first = (card.typeLine.split('//')[0].split('—')[0].trim().split(/\s+/).pop()) || '';
    return `${first} · ${card.mv}`;
}

function openTypeahead(gi, query) {
    const input = document.getElementById(`odds-g${gi}-search`);
    const list = document.getElementById(`odds-g${gi}-list`);
    if (!input || !list || !last) return;
    const items = O.searchCards(last.library, query, { limit: 8 });
    typeahead.group = gi;
    typeahead.items = items;
    typeahead.index = items.length ? Math.min(Math.max(typeahead.index, 0), items.length - 1) : -1;
    if (!String(query).trim()) {
        closeTypeahead(gi);
        return;
    }
    const inGroup = new Set(O.resolveGroup(state.groups[gi], last.library).names);
    list.innerHTML = items.length
        ? items.map((c, i) => `
            <li class="og-opt${i === typeahead.index ? ' is-active' : ''}${inGroup.has(c.name) ? ' is-in' : ''}" role="option"
                id="odds-g${gi}-opt-${i}" data-opt="${i}" aria-selected="${i === typeahead.index}">
                <span class="og-opt-name">${highlight(c.name, query)}${inGroup.has(c.name) ? '<span class="sr-only"> (in group, choose to remove)</span>' : ''}</span>
                <span class="og-opt-meta">${escapeHtml(typeShort(c))}</span>
                <span class="og-opt-n">${inGroup.has(c.name) ? '✓' : `×${c.count}`}</span>
            </li>`).join('')
        : `<li class="og-opt-empty" role="option" aria-disabled="true" aria-selected="false">No card matching “${escapeHtml(String(query).trim())}” in this deck</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (typeahead.index >= 0) input.setAttribute('aria-activedescendant', `odds-g${gi}-opt-${typeahead.index}`);
    else input.removeAttribute('aria-activedescendant');
}

function moveTypeahead(delta) {
    const gi = typeahead.group;
    const n = typeahead.items.length;
    if (gi < 0 || n === 0) return;
    typeahead.index = (typeahead.index + delta + n) % n;
    const list = document.getElementById(`odds-g${gi}-list`);
    list?.querySelectorAll('.og-opt').forEach((el, i) => {
        const on = i === typeahead.index;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-selected', String(on));
        if (on) el.scrollIntoView({ block: 'nearest' });
    });
    document.getElementById(`odds-g${gi}-search`)?.setAttribute('aria-activedescendant', `odds-g${gi}-opt-${typeahead.index}`);
}

function closeTypeahead(gi = typeahead.group) {
    const list = document.getElementById(`odds-g${gi}-list`);
    if (list) {
        list.hidden = true;
        list.innerHTML = '';
    }
    const input = document.getElementById(`odds-g${gi}-search`);
    input?.setAttribute('aria-expanded', 'false');
    input?.removeAttribute('aria-activedescendant');
    typeahead.items = [];
    typeahead.index = -1;
}

function chooseTypeahead(i = typeahead.index) {
    const gi = typeahead.group;
    const card = typeahead.items[i];
    if (gi < 0 || !card) return;
    toggleCard(gi, card.name);
    const input = document.getElementById(`odds-g${gi}-search`);
    if (input) {
        input.value = '';
        input.focus({ preventScroll: true });
    }
    closeTypeahead(gi);
}

// ── State changes ────────────────────────────────────────────────────────────

/** Add a card to a group, or take it out if it is already there. */
function toggleCard(gi, name) {
    const group = state.groups[gi];
    if (!group || !last) return;
    const current = group.kind === 'cards' ? group.cards.slice() : O.resolveGroup(group, last.library).names;
    // A preset that gets hand-edited keeps its name.
    const keepName = group.kind !== 'cards' && !group.name ? O.groupName(group, gi) : group.name;
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];
    state.groups[gi] = O.cardsGroup(next, group.need, keepName);
    if (next.length === 0) state.groups[gi].name = group.kind === 'cards' ? group.name : null;
    clampNeed(gi);
    refresh();
}

function clampNeed(gi) {
    const g = state.groups[gi];
    if (!g || !last) return;
    const copies = O.resolveGroup(g, last.library).copies;
    if (copies > 0 && g.need > copies) g.need = copies;
    g.need = Math.max(1, Math.min(O.MAX_NEED, g.need));
}

function setPreset(gi, kind, key) {
    const group = state.groups[gi];
    if (!group) return;
    if (group.kind === kind && group.key === key) {
        state.groups[gi] = O.emptyGroup(Boolean(last?.library?.manual));
    } else {
        state.groups[gi] = O.presetGroup(kind, key, group.need);
    }
    state.expanded.delete(gi);
    clampNeed(gi);
    refresh();
}

function removeGroup(gi) {
    if (state.groups.length <= 1) {
        state.groups = [O.emptyGroup(Boolean(last?.library?.manual))];
        state.pane = 'search';
    } else {
        state.groups.splice(gi, 1);
    }
    state.active = Math.min(state.active > gi ? state.active - 1 : state.active, state.groups.length - 1);
    state.expanded = new Set();
    refresh();
    const fallback = document.getElementById(`odds-g${Math.min(gi, state.groups.length - 1)}-name`);
    if (!document.getElementById('odds-groups')?.contains(document.activeElement)) fallback?.focus({ preventScroll: true });
}

function addGroup() {
    if (state.groups.length >= O.MAX_GROUPS) return;
    state.groups.push(O.emptyGroup(Boolean(last?.library?.manual)));
    state.active = state.groups.length - 1;
    if (!last?.library?.manual) state.pane = 'search';
    refresh();
    const gi = state.active;
    (document.getElementById(`odds-g${gi}-search`) ?? document.getElementById(`odds-g${gi}-name`))?.focus({ preventScroll: true });
}

function setTurn(turn) {
    const t = Math.max(0, Math.min(O.MAX_TURN, Math.floor(Number(turn) || 0)));
    if (t === state.turn) return;
    state.turn = t;
    if (!last) return;
    syncTurn(last);
    renderResults(last);
}

function applySuggestion(i) {
    const s = suggestions[i];
    if (!s) return;
    state.groups = [{ ...s.group, cards: s.group.cards.slice() }];
    state.turn = s.turn;
    state.active = 0;
    state.pane = s.group.kind === 'cards' ? 'search' : s.group.kind;
    state.expanded = new Set();
    refresh();
    document.getElementById('odds-answer')?.focus?.({ preventScroll: true });
}

/** Recompute and redraw both columns now (the page is visible). */
function refresh() {
    if (!isCalculatorActive(NAME)) return;
    const ctx = calculate();
    renderTurnBox(ctx);
    renderGroups(ctx);
    renderResults(ctx);
}

/** Recompute and redraw the results only (typing in a name field). */
const refreshResults = debounce(() => {
    if (!isCalculatorActive(NAME)) return;
    renderResults(calculate());
}, 150);

// ── Results ──────────────────────────────────────────────────────────────────

function renderEmpty(ctx) {
    const { library, format } = ctx;
    suggestions = O.suggestExamples(library, format);
    const cards = suggestions.map((s, i) => {
        const r = O.analyzeOdds({ library, groups: [s.group], format, onPlay: ctx.onPlay, searchTurn: O.MAX_TURN });
        const p = r.turns.find(t => t.turn === s.turn)?.all ?? 0;
        const g = r.groups[0];
        let sub = '';
        if (g) {
            if (library.manual) sub = `${g.copies} in the deck`;
            else if (g.cards === 1 && g.kind !== 'cards') sub = g.copies > 1 ? `${g.copies} copies of ${g.names[0]}` : `just ${g.names[0]}`;
            else sub = copiesText(g.cards, g.copies);
        }
        return `
            <button type="button" class="odds-sug" data-sug="${i}">
                <span class="odds-sug-pct is-${toneOf(p)}">${pctHtml(p)}</span>
                <span class="odds-sug-label">${escapeHtml(s.label)}</span>
                <span class="odds-sug-sub">${escapeHtml(sub)}</span>
                <span class="odds-sug-go" aria-hidden="true">Open →</span>
            </button>`;
    }).join('');
    const intro = library.manual
        ? 'No card list is loaded, so groups are copy counts: choose a card type on the left or type how many copies you run.'
        : 'Search your list on the left, start from a type, role or mana value — or open one of these from this deck:';
    return `
        <section class="panel odds-empty" aria-labelledby="odds-empty-title">
            <p class="odds-eyebrow">${library.size}-card library · ${escapeHtml(format.label)}</p>
            <h2 class="odds-empty-title" id="odds-empty-title">What are you hoping to draw?</h2>
            <p class="odds-empty-text">${intro}</p>
            ${cards ? `<div class="odds-sugs">${cards}</div>` : ''}
        </section>`;
}

function heroHtml(result) {
    const row = result.turns.find(t => t.turn === state.turn) ?? result.turns[0];
    const p = row.all;
    const r50 = reachText(result.reach50, result.atSearch);
    const r90 = reachText(result.reach90, result.atSearch);
    const multi = result.groups.length > 1;
    const turnWords = state.turn === 0 ? 'in the opening hand' : `by turn ${state.turn}`;
    const avg = multi
        ? `<span class="odds-avgs">${result.groups.map((g, i) => `<span class="odds-avg ${GROUP_CLASS[g.index]}"><i>${g.id}</i>${row.avg[i].toFixed(1)}</span>`).join('')}</span>`
        : row.avg[0].toFixed(1);
    const g0 = result.groups[0];
    return renderHeroStats([
        {
            label: state.turn === 0 ? 'Chance in opening hand' : `Chance by turn ${state.turn}`,
            value: pctHtml(p),
            color: `var(--tx-${toneOf(p)})`,
            size: 'big',
            sub: `${row.seen} cards seen${multi ? ' · all groups' : ''}`,
            tip: multi ? 'The chance of having every group at once.' : 'The chance of having at least the number you need.'
        },
        { label: 'Passes 50%', value: r50.value, size: 'medium', sub: r50.sub, tip: 'The first turn the chance reaches one in two — a coin flip.' },
        { label: 'Passes 90%', value: r90.value, size: 'medium', sub: r90.sub, tip: 'The first turn the chance reaches nine in ten — about as reliable as Magic gets.' },
        {
            label: 'Average copies seen',
            value: avg,
            size: 'medium',
            sub: multi ? turnWords : `of ${plural(g0.copies, 'copy', 'copies')}, ${turnWords}`,
            tip: 'How many cards from the group you will have seen on average — every copy, not just whether you found one.'
        }
    ]);
}

function legendHtml(result) {
    const multi = result.groups.length > 1;
    const keys = result.groups.map(g =>
        `<span class="odds-key ${GROUP_CLASS[g.index]}${multi ? '' : ' is-solid'}"><i></i>${g.id} · ${escapeHtml(g.name)}</span>`);
    if (multi) keys.push('<span class="odds-key is-all"><i></i>All together</span>');
    return keys.join('');
}

function renderChart(result) {
    const multi = result.groups.length > 1;
    const labels = result.turns.map(t => (t.turn === 0 ? 'Hand' : `T${t.turn}`));
    const radius = result.turns.map(t => (t.turn === state.turn ? 5 : 0));
    const pct = v => Math.round(v * 10000) / 100;
    const datasets = result.groups.map((g, i) => {
        const color = groupColor(g.index);
        return {
            label: `${g.id} · ${g.name}`,
            data: result.turns.map(t => pct(t.each[i])),
            borderColor: color,
            backgroundColor: multi ? color : fade(color, 0.14),
            fill: multi ? false : 'origin',
            borderWidth: multi ? 1.75 : 2.5,
            borderDash: multi ? [5, 4] : [],
            pointRadius: radius,
            pointHoverRadius: 5,
            pointBackgroundColor: color,
            pointBorderColor: TX_CHART.bg,
            pointBorderWidth: 2,
            tension: 0.3
        };
    });
    if (multi) {
        datasets.push({
            label: 'All together',
            data: result.turns.map(t => pct(t.all)),
            borderColor: TX_CHART.bright,
            backgroundColor: fade(TX_CHART.bright, 0.07),
            fill: 'origin',
            borderWidth: 2.75,
            borderDash: [],
            pointRadius: radius,
            pointHoverRadius: 6,
            pointBackgroundColor: TX_CHART.bright,
            pointBorderColor: TX_CHART.bg,
            pointBorderWidth: 2,
            tension: 0.3
        });
    }

    const canvas = document.getElementById('odds-chart');
    if (canvas) {
        const series = result.turns.map(t => `${t.turn === 0 ? 'opening hand' : `turn ${t.turn}`} ${O.formatPct(t.all)}`).join(', ');
        canvas.setAttribute('aria-label', `Chance by turn${multi ? ' of having every group' : ''}: ${series}.`);
    }

    chart = createOrUpdateChart(chart, 'odds-chart', {
        type: 'line',
        data: { labels, datasets },
        options: {
            scales: {
                x: { grid: { display: false }, ticks: { color: TX_CHART.dim, maxRotation: 0, autoSkip: true, autoSkipPadding: 6 } },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: TX_CHART.rule },
                    ticks: { color: TX_CHART.dim, stepSize: 25, callback: v => `${v}%` }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: items => {
                            const t = last?.result?.turns?.[items[0]?.dataIndex];
                            return t ? `${O.turnLabel(t.turn)} · ${t.seen} cards seen` : '';
                        },
                        label: item => ` ${item.dataset.label}: ${O.formatPct(item.parsed.y / 100)}`
                    }
                }
            },
            onClick: (event, _elements, instance) => {
                const points = instance.getElementsAtEventForMode(event, 'index', { intersect: false }, false);
                if (points.length) setTurn(points[0].index);
            },
            onHover: (event, elements) => {
                const target = event?.native?.target;
                if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
            }
        }
    });
}

function tableHtml(result) {
    const multi = result.groups.length > 1;
    const head = `
        <tr>
            <th scope="col">Turn</th>
            <th scope="col">Seen</th>
            ${multi ? result.groups.map(g => `<th scope="col" class="${GROUP_CLASS[g.index]}"><span class="gcol">${g.id}</span></th>`).join('') : '<th scope="col">Avg. copies</th>'}
            <th scope="col">${multi ? 'All together' : 'Chance'}</th>
        </tr>`;
    const rows = result.turns.map(t => {
        const sel = t.turn === state.turn;
        const cells = multi
            ? t.each.map(p => `<td>${pctHtml(p)}</td>`).join('')
            : `<td class="dim">${t.avg[0].toFixed(1)}</td>`;
        return `
            <tr class="${sel ? 'is-sel' : ''}">
                <th scope="row"><button type="button" class="odds-rowbtn" data-turn="${t.turn}" aria-pressed="${sel}">${O.turnLabel(t.turn)}</button></th>
                <td class="dim">${t.seen}</td>
                ${cells}
                <td><span class="odds-cell-bar"><span class="meter"><span class="meter-fill tone-${toneOf(t.all)}" style="width:${(t.all * 100).toFixed(1)}%"></span></span><strong>${pctHtml(t.all)}</strong></span></td>
            </tr>`;
    }).join('');
    return `<table class="odds-table"><caption class="sr-only">Chance by turn</caption><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function membersPanelHtml(result, library) {
    const overlapBy = new Map(result.overlaps.map(o => [o.name, o.ids]));
    const blocks = result.groups.map(g => {
        const meta = library.manual
            ? `${plural(g.copies, 'copy', 'copies')} · need ${g.need}`
            : `${plural(g.cards, 'card', 'cards')} · ${plural(g.copies, 'copy', 'copies')} · need ${g.need}`;
        let body;
        if (library.manual) {
            body = '<p class="og-empty-note">No card list — a plain count from your type numbers.</p>';
        } else {
            const names = g.names.slice().sort((a, b) =>
                (library.byName.get(b)?.count ?? 0) - (library.byName.get(a)?.count ?? 0) || a.localeCompare(b));
            body = `<ul class="om-list">${names.map(n => {
                const count = library.byName.get(n)?.count ?? 0;
                const also = (overlapBy.get(n) ?? []).filter(id => id !== g.id);
                return `<li><span class="om-n">${count > 1 ? `${count}×` : ''}</span>${cardRef(n)}${also.length ? `<span class="om-also" data-tip="Also in group ${also.join(' and ')} — it counts for both">+${also.join('')}</span>` : ''}</li>`;
            }).join('')}</ul>`;
        }
        return `
            <div class="om ${GROUP_CLASS[g.index]}">
                <div class="om-head">
                    <span class="og-badge" aria-hidden="true">${g.id}</span>
                    <span class="om-name">${escapeHtml(g.name)}</span>
                    <span class="om-meta">${meta}</span>
                </div>
                ${body}
            </div>`;
    }).join('');
    const note = result.overlaps.length
        ? `<p class="om-note"><strong>${plural(result.overlaps.length, 'card is', 'cards are')} in more than one group.</strong> Drawing ${result.overlaps.length === 1 ? 'it' : 'one'} counts toward each group it is in, which the all-together chance already accounts for.</p>`
        : '';
    return blocks + note;
}

function renderResults(ctx) {
    const { result, library } = ctx;
    const empty = document.getElementById('odds-empty');
    const filled = document.getElementById('odds-filled');
    if (!empty || !filled) return;

    if (result.groups.length === 0) {
        empty.innerHTML = renderEmpty(ctx);
        empty.hidden = false;
        filled.hidden = true;
        return;
    }
    empty.innerHTML = '';
    empty.hidden = true;
    filled.hidden = false;

    const summary = O.summarize(result, state.turn);
    setHtml('odds-answer', renderBottomLine(summary) + heroHtml(result));
    setHtml('odds-legend', legendHtml(result));
    setHtml('odds-caption', result.groups.length > 1
        ? 'Dashed lines: each group on its own. Solid line: every group at once — what the answer above uses. Click the chart to pick a turn.'
        : 'The chance of having what you need by your main phase on each turn. Click the chart to pick a turn.');
    setHtml('odds-table', tableHtml(result));
    setHtml('odds-members', membersPanelHtml(result, library));
    const membersMeta = document.getElementById('odds-members-meta');
    if (membersMeta) membersMeta.textContent = library.manual ? 'from your counts' : `${plural(result.union, 'copy', 'copies')} in play`;
    renderChart(result);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    refresh();
}

function groupIndexOf(el) {
    const host = el?.closest?.('.og[data-gi]');
    return host ? Number(host.dataset.gi) : -1;
}

function onClick(e) {
    const target = e.target;
    if (target.closest('.og-list')) return; // handled on mousedown

    const sug = target.closest('[data-sug]');
    if (sug) { applySuggestion(Number(sug.dataset.sug)); return; }

    const row = target.closest('[data-turn]');
    if (row) {
        const turn = Number(row.dataset.turn);
        setTurn(turn);
        // The table was re-rendered: keep keyboard focus on the chosen row.
        document.querySelector(`#odds-table [data-turn="${turn}"]`)?.focus({ preventScroll: true });
        return;
    }

    const play = target.closest('[data-play]');
    if (play) {
        state.onPlay = play.dataset.play === '1';
        refresh();
        return;
    }

    const act = target.closest('[data-act]');
    const gi = groupIndexOf(target);
    if (act) {
        const action = act.dataset.act;
        if (action === 'add-group') { addGroup(); return; }
        if (gi < 0) return;
        const group = state.groups[gi];
        if (action === 'remove') { removeGroup(gi); return; }
        state.active = gi;
        if (action === 'dec' || action === 'inc') {
            group.need = Math.max(1, Math.min(O.MAX_NEED, group.need + (action === 'inc' ? 1 : -1)));
            clampNeed(gi);
            refresh();
        } else if (action === 'pane') {
            state.pane = act.dataset.pane;
            refresh();
            if (state.pane === 'search') document.getElementById(`odds-g${gi}-search`)?.focus({ preventScroll: true });
        } else if (action === 'preset') {
            setPreset(gi, act.dataset.kind, act.dataset.key);
        } else if (action === 'drop') {
            toggleCard(gi, act.dataset.name);
        } else if (action === 'more') {
            if (state.expanded.has(gi)) state.expanded.delete(gi);
            else state.expanded.add(gi);
            refresh();
        } else if (action === 'activate') {
            refresh();
            (document.getElementById(`odds-g${gi}-search`) ?? document.getElementById(`odds-g${gi}-name`))?.focus({ preventScroll: true });
        }
        return;
    }

    // A click anywhere else in an inactive group opens it for editing.
    if (gi >= 0 && gi !== state.active && !target.closest('input, .card-ref, [data-tip]')) {
        state.active = gi;
        refresh();
    }
}

function onInput(e) {
    const el = e.target;
    if (el.id === 'odds-turn') {
        setTurn(el.value);
        return;
    }
    const gi = Number(el.dataset.gi);
    const group = state.groups[gi];
    if (!group) return;
    if (el.classList.contains('og-search-input')) {
        typeahead.index = 0;
        openTypeahead(gi, el.value);
        return;
    }
    const field = el.dataset.field;
    if (field === 'name') {
        group.name = el.value.slice(0, O.MAX_NAME_LENGTH) || null;
        refreshResults();
    } else if (field === 'need') {
        if (el.value === '') return;
        group.need = Math.max(1, Math.min(O.MAX_NEED, Math.floor(Number(el.value) || 1)));
        clampNeed(gi);
        renderResults(calculate());
    } else if (field === 'count') {
        const lib = last?.library;
        const count = Math.max(0, Math.min(lib?.size ?? 999, Math.floor(Number(el.value) || 0)));
        state.groups[gi] = { ...O.emptyGroup(true), need: group.need, name: group.name, count };
        renderResults(calculate());
    }
}

function onChange(e) {
    const el = e.target;
    // Re-render the rail once a number is committed so steppers and limits agree.
    if (el.dataset?.field === 'need' || el.dataset?.field === 'count') {
        state.active = Number(el.dataset.gi);
        refresh();
    }
}

function onKeydown(e) {
    const el = e.target;
    if (el.classList?.contains('og-search-input')) {
        const gi = Number(el.dataset.gi);
        const open = typeahead.group === gi && typeahead.items.length > 0 && !document.getElementById(`odds-g${gi}-list`)?.hidden;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) { typeahead.index = 0; openTypeahead(gi, el.value); return; }
            moveTypeahead(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
            if (open) {
                e.preventDefault();
                chooseTypeahead();
            }
        } else if (e.key === 'Escape') {
            if (open) {
                e.preventDefault();
                e.stopPropagation();
                closeTypeahead(gi);
            } else if (el.value) {
                e.preventDefault();
                el.value = '';
            }
        } else if (e.key === 'Home' && open) {
            e.preventDefault();
            typeahead.index = 0;
            moveTypeahead(0);
        } else if (e.key === 'End' && open) {
            e.preventDefault();
            typeahead.index = typeahead.items.length - 1;
            moveTypeahead(0);
        }
        return;
    }
    if ((el.dataset?.field === 'need') && (e.key === 'Enter')) {
        e.preventDefault();
        el.blur();
    }
}

function onMousedown(e) {
    const opt = e.target.closest?.('.og-opt[data-opt]');
    if (!opt) return;
    e.preventDefault(); // keep focus in the search box
    chooseTypeahead(Number(opt.dataset.opt));
}

function onFocusout(e) {
    const el = e.target;
    if (!el.classList?.contains('og-search-input')) return;
    const gi = Number(el.dataset.gi);
    setTimeout(() => {
        if (document.activeElement !== document.getElementById(`odds-g${gi}-search`)) closeTypeahead(gi);
    }, 120);
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    if (root && root.addEventListener) {
        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        root.addEventListener('keydown', onKeydown);
        root.addEventListener('mousedown', onMousedown);
        root.addEventListener('focusout', onFocusout);
    }
    ({ updateUI: debouncedUpdate } = registerCalculator({ name: NAME, calculate, updateUI }));
}

// ── Public hooks ─────────────────────────────────────────────────────────────

/**
 * Preselect group A as a single card and show its odds. The command palette
 * calls this for "cards in your deck".
 * @param {string} name
 */
export function focusCard(name) {
    if (typeof name !== 'string' || !name.trim()) return;
    const { library } = context();
    const card = O.findCard(library, name);
    state.groups = [library.manual ? O.emptyGroup(true) : O.cardsGroup([card?.name ?? name.trim().slice(0, 160)])];
    state.active = 0;
    state.pane = 'search';
    state.expanded = new Set();
    if (isCalculatorActive(NAME)) refresh();
    else debouncedUpdate?.();
}

/** Page settings for share links. */
export function getShareParams() {
    const out = { turn: state.turn };
    if (!state.onPlay) out.draw = 1;
    let n = 1;
    state.groups.forEach(g => {
        const encoded = O.encodeGroup(g);
        if (encoded) out[`g${n++}`] = encoded;
    });
    return out;
}

/**
 * Apply share-link settings. Every value is validated: the turn is clamped,
 * groups go through decodeGroup(), and card names are matched to this deck.
 * @param {URLSearchParams} params
 */
export function applyShareParams(params) {
    if (!params || typeof params.get !== 'function') return;
    const turn = params.get('turn');
    if (turn !== null && /^\d{1,2}$/.test(turn)) state.turn = Math.min(O.MAX_TURN, Number(turn));
    const draw = params.get('draw');
    if (draw === '1') state.onPlay = false;
    else if (draw === '0') state.onPlay = true;

    const { library } = context();
    const groups = [];
    for (const key of ['g1', 'g2', 'g3']) {
        const group = O.decodeGroup(params.get(key));
        if (!group) continue;
        if (library.manual ? !(group.kind === 'manual' || group.kind === 'type') : group.kind === 'manual') continue;
        if (group.kind === 'cards') {
            group.cards = [...new Set(group.cards.map(n => O.findCard(library, n)?.name ?? n))];
        }
        groups.push(group);
    }
    if (groups.length) {
        state.groups = groups;
        state.active = 0;
        state.pane = groups[0].kind === 'cards' ? 'search' : groups[0].kind;
        state.expanded = new Set();
    }
    if (isCalculatorActive(NAME)) refresh();
    else debouncedUpdate?.();
}

/** Read-only snapshot for tests. */
export function getState() {
    return {
        turn: state.turn,
        onPlay: state.onPlay,
        active: state.active,
        groups: state.groups.map(g => ({ ...g, cards: g.cards.slice() }))
    };
}
