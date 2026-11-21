/**
 * Command palette (Ctrl/Cmd+K or "/"): one search box over calculators, the
 * cards in your deck, saved decks, and app actions.
 *
 * Results are ranked by a small fuzzy scorer (word-start and consecutive-run
 * bonuses), so "gw" finds Genesis Wave and "draw odds" finds Draw Odds.
 */

import { CALCULATORS, getGroup } from '../utils/calculatorRegistry.js';
import * as DeckConfig from '../utils/deckConfig.js';
import * as Library from '../utils/deckLibrary.js';
import { escapeHtml } from '../data/glossary.js';

let dialog;
let input;
let listEl;
let items = [];
let results = [];
let selected = 0;
let actions = {};

/**
 * Fuzzy match score; 0 = no match. Exported for tests.
 * @param {string} query
 * @param {string} text
 */
export function fuzzyScore(query, text) {
    const q = String(query).toLowerCase().trim();
    const t = String(text).toLowerCase();
    if (!q) return 1;
    if (t === q) return 1000;
    const idx = t.indexOf(q);
    if (idx === 0) return 800 - t.length;
    if (idx > 0) return (/\W/.test(t[idx - 1]) ? 600 : 400) - t.length;

    // Subsequence with bonuses
    let score = 0;
    let ti = 0;
    let run = 0;
    for (const ch of q) {
        if (ch === ' ') { run = 0; continue; }
        const found = t.indexOf(ch, ti);
        if (found < 0) return 0;
        const wordStart = found === 0 || /\W/.test(t[found - 1]);
        run = found === ti ? run + 1 : 0;
        score += 10 + (wordStart ? 25 : 0) + run * 8 - Math.min(found - ti, 10);
        ti = found + 1;
    }
    return Math.max(1, score);
}

function buildItems() {
    const out = [];
    for (const [key, c] of Object.entries(CALCULATORS)) {
        out.push({
            kind: 'Calculator',
            label: c.name,
            sub: c.question,
            hint: getGroup(c.group)?.label ?? '',
            search: [c.name, c.short, c.card ?? '', ...(c.keywords ?? [])].join(' '),
            run: () => actions.navigate?.(key)
        });
    }
    out.push(
        { kind: 'Action', label: 'Load a deck from a link', sub: 'Moxfield or Archidekt URL', search: 'import moxfield archidekt url link load deck', run: () => actions.openDeck?.('link') },
        { kind: 'Action', label: 'Paste a decklist', sub: 'MTGO, Arena or plain text', search: 'paste decklist text import arena mtgo', run: () => actions.openDeck?.('paste') },
        { kind: 'Action', label: 'Enter deck counts by hand', sub: 'No list needed', search: 'manual counts type numbers', run: () => actions.openDeck?.('manual') },
        { kind: 'Action', label: 'Switch theme', sub: 'Light or dark', search: 'theme dark light mode toggle', run: () => actions.toggleTheme?.() },
        { kind: 'Action', label: 'Copy share link', sub: 'This page with the current deck', search: 'share copy link url', run: () => actions.share?.() },
        { kind: 'Action', label: 'Keyboard shortcuts', sub: '', search: 'keyboard shortcuts help keys', run: () => actions.shortcuts?.() }
    );

    for (const d of Library.listDecks()) {
        out.push({
            kind: 'Saved deck',
            label: d.name,
            sub: `${d.cardCount} cards`,
            search: `${d.name} ${d.commanderName ?? ''} deck saved switch`,
            run: () => actions.loadDeck?.(d.id)
        });
    }

    const cards = Object.values(DeckConfig.getDeckConfig().cardsByName ?? {})
        .filter(c => c?.name && Number(c.count) > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    for (const card of cards) {
        out.push({
            kind: 'Card',
            label: card.name,
            sub: `Odds of drawing it${Number(card.count) > 1 ? ` (${card.count} copies)` : ''}`,
            hint: card.type_line ?? '',
            card: card.name,
            search: card.name,
            run: () => actions.cardOdds?.(card.name)
        });
    }
    return out;
}

const KIND_ORDER = { Calculator: 0, Action: 1, 'Saved deck': 2, Card: 3 };

function filter(query) {
    const q = query.trim();
    if (!q) {
        // Empty query: calculators first, then actions — cards would drown them.
        return items.filter(i => i.kind === 'Calculator' || i.kind === 'Action').slice(0, 40);
    }
    return items
        .map(item => ({ item, score: fuzzyScore(q, item.search) + (item.kind === 'Calculator' ? 30 : 0) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind])
        .slice(0, 40)
        .map(r => r.item);
}

function render() {
    if (results.length === 0) {
        listEl.innerHTML = '<li class="palette-empty">No matches. Try a card name, a calculator, or “import”.</li>';
        input.removeAttribute('aria-activedescendant');
        return;
    }
    let lastKind = null;
    listEl.innerHTML = results.map((r, i) => {
        const header = r.kind !== lastKind ? `<li class="palette-section" role="presentation">${escapeHtml(r.kind === 'Card' ? 'Cards in your deck' : r.kind === 'Calculator' ? 'Calculators' : r.kind === 'Saved deck' ? 'Saved decks' : 'Actions')}</li>` : '';
        lastKind = r.kind;
        return `${header}
            <li class="palette-item${i === selected ? ' selected' : ''}" role="option" id="pal-${i}" data-index="${i}" aria-selected="${i === selected}" ${r.card ? `data-card="${escapeHtml(r.card)}"` : ''}>
                <span class="palette-item-main">
                    <span class="palette-item-label">${escapeHtml(r.label)}</span>
                    ${r.sub ? `<span class="palette-item-sub">${escapeHtml(r.sub)}</span>` : ''}
                </span>
                ${r.hint ? `<span class="palette-item-hint">${escapeHtml(r.hint)}</span>` : ''}
            </li>`;
    }).join('');
    input.setAttribute('aria-activedescendant', `pal-${selected}`);
    listEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

/** Move the highlight without rebuilding the list (keeps hover state stable). */
function highlight(index) {
    selected = Math.max(0, Math.min(results.length - 1, index));
    listEl.querySelectorAll('.palette-item').forEach(li => {
        const on = Number(li.dataset.index) === selected;
        li.classList.toggle('selected', on);
        li.setAttribute('aria-selected', String(on));
        if (on) li.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', `pal-${selected}`);
}

function update() {
    results = filter(input.value);
    selected = 0;
    render();
}

function choose(index) {
    const item = results[index];
    if (!item) return;
    close();
    item.run();
}

export function openPalette(prefill = '') {
    if (!dialog) return;
    items = buildItems();
    input.value = prefill;
    update();
    if (!dialog.open) dialog.showModal();
    input.focus();
    input.select();
}

function close() {
    if (dialog?.open) dialog.close();
}

/**
 * @param {{navigate:Function, openDeck:Function, toggleTheme:Function, share:Function, shortcuts:Function, loadDeck:Function, cardOdds:Function}} handlers
 */
export function initPalette(handlers) {
    actions = handlers;
    dialog = document.getElementById('palette');
    input = document.getElementById('palette-input');
    listEl = document.getElementById('palette-list');
    if (!dialog || !input || !listEl) return;

    input.addEventListener('input', update);
    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight(selected + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(selected - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(selected); }
    });
    listEl.addEventListener('click', e => {
        const li = e.target.closest('.palette-item');
        if (li) choose(Number(li.dataset.index));
    });
    listEl.addEventListener('mousemove', e => {
        const li = e.target.closest('.palette-item');
        if (!li) return;
        const i = Number(li.dataset.index);
        if (i !== selected) highlight(i);
    });
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    document.getElementById('search-btn')?.addEventListener('click', () => openPalette());

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const kbd = document.getElementById('search-kbd');
    if (kbd && isMac) kbd.textContent = '⌘K';
}
