/**
 * The deck dialog: import from a link, paste a list, switch between saved
 * decks, or enter type counts by hand. All imports go through DeckConfig; this
 * module only owns the UI.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import * as Library from '../utils/deckLibrary.js';
import { FORMATS } from '../utils/format.js';
import { escapeHtml } from '../data/glossary.js';
import { toast } from './overlays.js';

/** Example decks spanning formats, so "more decks" is one click to try. */
export const EXAMPLE_DECKS = Object.freeze([
    {
        id: 'example-doctor',
        label: 'Doctor Whostoric',
        meta: 'Commander · Simic big spells',
        builtIn: true
    },
    {
        id: 'example-burn',
        label: 'Mono-Red Burn',
        meta: '60 cards · aggro',
        list: `20 Mountain
4 Lightning Bolt
4 Chain Lightning
4 Lava Spike
4 Rift Bolt
4 Skewer the Critics
4 Light Up the Stage
4 Monastery Swiftspear
4 Goblin Guide
4 Eidolon of the Great Revel
4 Searing Blaze`
    },
    {
        id: 'example-elves',
        label: 'Elfball Ramp',
        meta: '60 cards · green ramp',
        list: `16 Forest
4 Llanowar Elves
4 Elvish Mystic
4 Fyndhorn Elves
4 Elvish Archdruid
4 Priest of Titania
4 Heritage Druid
2 Craterhoof Behemoth
2 Natural Order
4 Chord of Calling
4 Ezuri, Renegade Leader
4 Elvish Visionary
4 Nettle Sentinel`
    },
    {
        id: 'example-limited',
        label: 'Azorius Fliers',
        meta: '40 cards · limited',
        list: `8 Plains
9 Island
2 Suntail Hawk
2 Wind Drake
2 Pacifism
1 Serra Angel
2 Faerie Miscreant
2 Divination
2 Healer's Hawk
1 Cancel
2 Air Elemental
1 Sleep
2 Vigilant Martyr
1 Opt
1 Inspired Charge
2 Glory Seeker`
    }
]);

let dialog;
let busy = false;

function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} h ago`;
    const days = Math.round(hr / 24);
    return days < 30 ? `${days} d ago` : new Date(ts).toLocaleDateString();
}

function sourceLabel(source) {
    return { moxfield: 'Moxfield', archidekt: 'Archidekt', paste: 'Pasted list', manual: 'Manual counts' }[source] ?? 'Imported';
}

export function renderSavedDecks() {
    const list = document.getElementById('saved-decks');
    const count = document.getElementById('saved-count');
    if (!list) return;
    const decks = Library.listDecks();
    const activeId = DeckConfig.getDeckConfig().deckId;
    if (count) count.textContent = decks.length ? String(decks.length) : '';

    if (decks.length === 0) {
        list.innerHTML = `
            <li class="saved-empty">
                <strong>No saved decks yet.</strong>
                <span>Every deck you import is saved here automatically — in this browser only.</span>
            </li>`;
        return;
    }
    list.innerHTML = decks.map(d => {
        const active = d.id === activeId;
        const fmt = d.format && d.format !== 'auto' ? FORMATS[d.format]?.label : null;
        return `
            <li class="saved-deck${active ? ' active' : ''}">
                <button class="saved-deck-main" type="button" data-load-deck="${escapeHtml(d.id)}" ${active ? 'aria-current="true"' : ''}>
                    <span class="saved-deck-name">${escapeHtml(d.name)}</span>
                    <span class="saved-deck-meta">${d.cardCount} cards · ${sourceLabel(d.importSource)}${fmt ? ` · ${fmt}` : ''} · ${relativeTime(d.savedAt)}</span>
                </button>
                ${active ? '<span class="chip chip-accent">Active</span>' : ''}
                <button class="icon-btn icon-btn-sm" type="button" data-rename-deck="${escapeHtml(d.id)}" aria-label="Rename ${escapeHtml(d.name)}" data-tip="Rename">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>
                </button>
                <button class="icon-btn icon-btn-sm" type="button" data-delete-deck="${escapeHtml(d.id)}" aria-label="Remove ${escapeHtml(d.name)}" data-tip="Remove from saved decks">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
                </button>
            </li>`;
    }).join('');
}

function renderExamples() {
    const el = document.getElementById('example-decks');
    if (!el) return;
    el.innerHTML = EXAMPLE_DECKS.map(d => `
        <button class="example-deck" type="button" data-example="${d.id}">
            <span class="example-deck-name">${escapeHtml(d.label)}</span>
            <span class="example-deck-meta">${escapeHtml(d.meta)}</span>
        </button>`).join('');
}

function selectPane(pane) {
    dialog.querySelectorAll('.seg-btn[data-pane]').forEach(btn => {
        const on = btn.dataset.pane === pane;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', String(on));
        btn.tabIndex = on ? 0 : -1;
    });
    dialog.querySelectorAll('.deck-pane').forEach(p => {
        const on = p.id === `deck-pane-${pane}`;
        p.hidden = !on;
        p.classList.toggle('active', on);
    });
    if (pane === 'saved') renderSavedDecks();
}

/**
 * Open the dialog.
 * @param {'link'|'paste'|'saved'|'manual'} [pane]
 */
export function openDeckDialog(pane) {
    if (!dialog) return;
    renderSavedDecks();
    const initial = pane ?? (Library.listDecks().length > 0 ? 'saved' : 'link');
    selectPane(initial);
    clearStatus();
    if (!dialog.open) dialog.showModal();
    const focusTarget = initial === 'link' ? '#moxfield-input'
        : initial === 'paste' ? '#decklist-input'
            : '.seg-btn.active';
    dialog.querySelector(focusTarget)?.focus();
}

export function closeDeckDialog() {
    if (dialog?.open) dialog.close();
}

function clearStatus() {
    const statusEl = document.getElementById('import-status');
    const progress = document.getElementById('import-progress');
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'import-status';
    }
    progress?.classList.remove('visible');
}

function onStatus({ state, message, percentage, warnings = [] }) {
    const statusEl = document.getElementById('import-status');
    const progress = document.getElementById('import-progress');
    const bar = document.getElementById('import-progress-bar');
    if (statusEl) {
        statusEl.className = `import-status ${state}`;
        statusEl.innerHTML = escapeHtml(message)
            + (warnings.length ? `<span class="import-warnings">${warnings.map(escapeHtml).join('<br>')}</span>` : '');
    }
    if (progress && bar) {
        progress.classList.toggle('visible', state === 'loading');
        if (typeof percentage === 'number') bar.style.width = `${Math.max(2, Math.min(100, percentage))}%`;
    }
    busy = state === 'loading';
    dialog?.querySelectorAll('#moxfield-import-btn, #import-btn, [data-example]').forEach(b => { b.disabled = busy; });
    dialog?.classList.toggle('is-busy', busy);

    if (state === 'success') {
        renderSavedDecks();
        // Keep the dialog open if there were warnings the user should read.
        if (warnings.length === 0) {
            setTimeout(closeDeckDialog, 350);
            toast(message, { tone: 'good' });
        }
    }
}

/** Swap a saved deck's name for an inline input; Enter saves, Escape cancels. */
function startRename(id, row) {
    const main = row?.querySelector('.saved-deck-main');
    const snapshot = Library.getDeck(id);
    if (!main || !snapshot) return;
    const input = document.createElement('input');
    input.className = 'field field-sm saved-deck-rename';
    input.value = snapshot.name ?? '';
    input.maxLength = 80;
    input.setAttribute('aria-label', 'Deck name');
    main.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = save => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        if (save && name && name !== snapshot.name) {
            if (DeckConfig.getDeckConfig().deckId === id) DeckConfig.renameDeck(name);
            else Library.updateDeckMeta(id, { name });
        }
        renderSavedDecks();
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') {
            // Cancel the rename without closing the whole dialog.
            e.preventDefault();
            e.stopPropagation();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(true));
}

async function runExample(id) {
    const example = EXAMPLE_DECKS.find(d => d.id === id);
    if (!example) return;
    if (example.builtIn) {
        DeckConfig.loadExampleDeck();
        closeDeckDialog();
        toast(`Loaded the ${example.label} example deck.`, { tone: 'good' });
        return;
    }
    try {
        await DeckConfig.importDeckText(example.list);
    } catch {
        // status already reported
    }
}

export function initDeckDialog() {
    dialog = document.getElementById('deck-dialog');
    if (!dialog) return;
    renderExamples();
    DeckConfig.onImportStatus(onStatus);

    // Close on backdrop click, Escape is native to <dialog>
    dialog.addEventListener('click', e => {
        if (e.target === dialog) closeDeckDialog();
    });
    dialog.querySelectorAll('[data-close-dialog]').forEach(btn => btn.addEventListener('click', closeDeckDialog));

    // Segmented tabs with arrow-key roving focus
    const segBtns = [...dialog.querySelectorAll('.seg-btn[data-pane]')];
    segBtns.forEach((btn, i) => {
        btn.addEventListener('click', () => selectPane(btn.dataset.pane));
        btn.addEventListener('keydown', e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const next = segBtns[(i + (e.key === 'ArrowRight' ? 1 : -1) + segBtns.length) % segBtns.length];
            selectPane(next.dataset.pane);
            next.focus();
        });
    });

    // Link import
    const urlInput = document.getElementById('moxfield-input');
    const runUrl = () => { if (!busy) DeckConfig.loadDeckFromUrl(urlInput.value).catch(() => {}); };
    document.getElementById('moxfield-import-btn')?.addEventListener('click', runUrl);
    urlInput?.addEventListener('keydown', e => { if (e.key === 'Enter') runUrl(); });

    // Paste import (Ctrl/Cmd+Enter submits)
    const textArea = document.getElementById('decklist-input');
    const runPaste = () => { if (!busy) DeckConfig.importDeckText(textArea.value).catch(() => {}); };
    document.getElementById('import-btn')?.addEventListener('click', runPaste);
    textArea?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runPaste(); });

    // Examples, saved decks
    dialog.addEventListener('click', e => {
        const example = e.target.closest('[data-example]');
        if (example) { runExample(example.dataset.example); return; }

        const load = e.target.closest('[data-load-deck]');
        if (load) {
            if (DeckConfig.loadSavedDeck(load.dataset.loadDeck)) {
                closeDeckDialog();
                toast(`Switched to ${DeckConfig.getDeckConfig().deckName ?? 'saved deck'}.`, { tone: 'good' });
            } else {
                toast('That saved deck could not be read.', { tone: 'bad' });
                renderSavedDecks();
            }
            return;
        }

        const rename = e.target.closest('[data-rename-deck]');
        if (rename) {
            startRename(rename.dataset.renameDeck, rename.closest('.saved-deck'));
            return;
        }

        const del = e.target.closest('[data-delete-deck]');
        if (del) {
            const id = del.dataset.deleteDeck;
            const snapshot = Library.getDeck(id);
            Library.deleteDeck(id);
            renderSavedDecks();
            if (snapshot) {
                toast(`Removed ${snapshot.name}.`, {
                    action: { label: 'Undo', run: () => { Library.saveDeck({ ...snapshot }); renderSavedDecks(); } }
                });
            }
        }
    });

    // Keep the manual tab honest: editing counts there marks the deck manual.
    document.getElementById('deck-switcher')?.addEventListener('click', () => openDeckDialog());
    document.getElementById('deck-btn')?.addEventListener('click', () => openDeckDialog());
}
