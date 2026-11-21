/**
 * Deck Oracle — application bootstrap.
 *
 * Wires the shell together: deck state, router, sidebar, dialogs, overlays and
 * shortcuts. Calculators themselves are lazy-loaded by the router, so nothing
 * here imports one directly — startup cost is the shell plus the first page.
 */

import * as DeckConfig from './utils/deckConfig.js';
import * as OpponentState from './utils/opponentState.js';
import * as Share from './utils/share.js';
import { analyzeDeck } from './utils/deckRadar.js';
import { featuredCardName } from './utils/deckStats.js';
import { findCard } from './data/images.js';
import { FORMATS } from './utils/format.js';
import { debounce } from './utils/simulation.js';
import { CALCULATORS, DEFAULT_TAB } from './utils/calculatorRegistry.js';
import { initRouter, navigate, ensureMounted, currentTab, onNavigate, onNavigated, step, tabFromUrl, mountedModule, afterFirstPage } from './shell/router.js';
import { initSidebar, markRelevance, renderDeckSwitcher } from './shell/sidebar.js';
import { initGuide, openGuide, isGuideOpen, refreshPageHeader } from './shell/pageHeader.js';
import { initPalette, openPalette } from './shell/palette.js';
import { initDeckDialog, openDeckDialog, renderSavedDecks } from './shell/deckDialog.js';
import { initOverlays, toast } from './shell/overlays.js';
import { initTheme, toggleTheme } from './shell/theme.js';
import { ensureLzString } from './shell/vendor.js';

const EXAMPLE_OPPONENTS = [
    'https://moxfield.com/decks/NVsnEkQ3y02ATHYk6n1pTA',
    'https://moxfield.com/decks/Vpiz7R8Rfk-0J7yX0AUQtA',
    'https://moxfield.com/decks/KP_jB2nYqUmQHVjYQeldyA'
];

// ── Deck-dependent chrome ────────────────────────────────────────────────────

function deckSummary(config) {
    const size = DeckConfig.getDeckSize(true);
    const format = DeckConfig.getFormat();
    const name = config.deckName
        || (config.commanderName ? `${config.commanderName}` : null)
        || (config.importSource === 'manual' ? 'Custom counts' : 'Untitled deck');
    const parts = [`${size} cards`, format.label.replace(/ \(\d+\)/, '')];
    if (config.importSource === 'manual') parts.push('counts only');
    const artName = featuredCardName(config);
    return { name, meta: parts.join(' · '), artName, artCard: findCard(config.cardsByName, artName) };
}

function syncDeckChrome() {
    const config = DeckConfig.getDeckConfig();
    // Simulation buttons need card records; manual-count decks have none.
    const locked = !DeckConfig.hasCardList();
    document.querySelectorAll('.run-sim-btn[data-requires-import]').forEach(btn => {
        btn.disabled = locked;
        const note = btn.parentElement?.querySelector('.sim-import-note');
        if (note) note.hidden = !locked;
    });
    renderDeckSwitcher(deckSummary(config));
    markRelevance(analyzeDeck(config));
    const tab = currentTab();
    if (tab) refreshPageHeader(tab);
}

// ── Opponents bar (multiplayer pages) ────────────────────────────────────────

function initOpponentsBar() {
    const bar = document.getElementById('opponents-config');
    const body = document.getElementById('opponents-body');
    const toggle = document.getElementById('opponents-toggle');
    onNavigate(name => {
        if (bar) bar.hidden = CALCULATORS[name]?.group !== 'multiplayer';
    });
    // Seat the bar under the page header, so a multiplayer page opens with
    // what the card does before asking for decklists.
    onNavigated((name, panel) => {
        if (!bar || CALCULATORS[name]?.group !== 'multiplayer') return;
        const body = panel.querySelector(':scope > .calc-body');
        if (body && bar.nextElementSibling !== body) body.before(bar);
    });
    toggle?.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Hide' : 'Show';
        if (body) body.hidden = !open;
    });

    const exampleBtn = document.getElementById('load-example-opponents-btn');
    exampleBtn?.addEventListener('click', async () => {
        const label = exampleBtn.textContent;
        exampleBtn.textContent = 'Loading…';
        exampleBtn.disabled = true;
        try {
            while (OpponentState.getActiveOpponents().length < 3) OpponentState.addOpponent();
            await Promise.all(EXAMPLE_OPPONENTS.map((url, i) =>
                OpponentState.importOpponentDeck(`opponent${i + 1}`, url, true)));
            OpponentState.renderOpponentTabs();
            toast('Loaded three example opponents.', { tone: 'good' });
        } catch (e) {
            console.error('Failed to load example opponents', e);
            toast('Couldn’t load the example opponents. Check your connection.', { tone: 'bad' });
        } finally {
            exampleBtn.textContent = label;
            exampleBtn.disabled = false;
        }
    });
}

// ── Share ────────────────────────────────────────────────────────────────────

async function copyShareLink() {
    // Share links pack mulligan requirements with LZ-String. It is normally
    // here already (loaded once the first page is up); only a very early
    // click waits for it.
    await ensureLzString();
    const url = Share.getShareUrl(currentTab());
    try {
        await navigator.clipboard.writeText(url);
        toast('Link copied — it opens this page with this deck.', { tone: 'good' });
    } catch {
        window.prompt('Copy this link:', url);
    }
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function isTyping(target) {
    // Closing a dialog leaves focus on its (now hidden) input until the next
    // page has loaded; that is not typing, so shortcuts must still work.
    if (target?.closest?.('dialog:not([open])')) return false;
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

function anyDialogOpen() {
    return Boolean(document.querySelector('dialog[open]'));
}

function initShortcuts() {
    const shortcuts = document.getElementById('shortcuts-dialog');
    const openShortcuts = () => { if (shortcuts && !shortcuts.open) shortcuts.showModal(); };
    document.getElementById('open-shortcuts')?.addEventListener('click', openShortcuts);
    document.querySelectorAll('dialog [data-close-dialog]').forEach(btn =>
        btn.addEventListener('click', () => btn.closest('dialog')?.close()));
    shortcuts?.addEventListener('click', e => { if (e.target === shortcuts) shortcuts.close(); });

    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openPalette();
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || anyDialogOpen()) return;
        switch (e.key) {
            case '/': e.preventDefault(); openPalette(); break;
            case 'd': case 'D': e.preventDefault(); openDeckDialog(); break;
            case '[': step(-1); break;
            case ']': step(1); break;
            case 'o': case 'O': navigate(DEFAULT_TAB); break;
            case 'h': case 'H': if (!isGuideOpen()) openGuide(currentTab()); break;
            case 't': case 'T': toggleTheme(); break;
            case '?': openShortcuts(); break;
            default: break;
        }
    });
}

// ── PWA ──────────────────────────────────────────────────────────────────────

/** Run `task` once the window `load` event has fired (now, if it already has). */
function afterLoad(task) {
    if (document.readyState === 'complete') task();
    else window.addEventListener('load', () => task(), { once: true });
}

function initServiceWorker() {
    // Never on localhost: stale-while-revalidate would serve the previous
    // build's CSS/JS during development and every edit would appear to do nothing.
    const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(window.location.hostname);
    if (isLocal) {
        navigator.serviceWorker?.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
        return;
    }
    if (!('serviceWorker' in navigator)) return;
    // The install precaches every asset (~720 KB compressed), so it waits for
    // the landing page to finish loading, paint and go idle. The page may
    // well have loaded already by now — a plain `load` listener added here
    // would then never fire, which is how registration silently stopped.
    afterFirstPage(() => afterLoad(registerServiceWorker));
}

function registerServiceWorker() {
    const swPath = new URL('sw.js', document.baseURI).pathname;
    navigator.serviceWorker.register(swPath).then(reg => {
        // A new version installed in the background → offer a reload.
        reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    toast('A new version of Deck Oracle is ready.', {
                        timeout: 12000,
                        action: { label: 'Reload', run: () => window.location.reload() }
                    });
                }
            });
        });
    }).catch(err => console.warn('Service worker registration failed (optional):', err));
}

// ── Startup ──────────────────────────────────────────────────────────────────

async function init() {
    initTheme();
    initOverlays();

    // Restore the last active deck before anything renders. A deck in a share
    // link replaces it below once its import finishes.
    DeckConfig.initDeckConfig({ restore: true });
    OpponentState.init();

    initSidebar();
    initRouter();
    initGuide();
    initDeckDialog();
    initOpponentsBar();
    initShortcuts();
    initPalette({
        navigate: name => navigate(name, { focus: true }),
        openDeck: pane => openDeckDialog(pane),
        toggleTheme,
        share: copyShareLink,
        shortcuts: () => document.getElementById('shortcuts-dialog')?.showModal(),
        loadDeck: id => {
            if (DeckConfig.loadSavedDeck(id)) toast(`Switched to ${DeckConfig.getDeckConfig().deckName ?? 'saved deck'}.`, { tone: 'good' });
        },
        cardOdds: async name => {
            await navigate('odds', { focus: true });
            mountedModule('odds')?.focusCard?.(name);
        }
    });
    document.getElementById('share-button')?.addEventListener('click', copyShareLink);

    const refreshChrome = debounce(syncDeckChrome, 120);
    DeckConfig.onDeckUpdate(refreshChrome);
    DeckConfig.onDeckImport(() => {
        syncDeckChrome();
        renderSavedDecks();
    });
    syncDeckChrome();
    // Registers only once the first page is up (afterFirstPage), so it can be
    // wired here, before the awaits below, and still never compete with it.
    initServiceWorker();
    initPWAInstall();
    afterFirstPage(ensureLzString);

    // Shared links: import the deck and apply page settings before the first
    // render, so the landing state is the shared state. Mulligan requirements
    // are LZ-String-packed, so a link carrying them loads it first.
    const tab = tabFromUrl();
    if (window.location.search.length > 1) {
        if (new URLSearchParams(window.location.search).has('mullTypes')) await ensureLzString();
        await Share.applyShareUrl({ ensureMounted });
    }
    await navigate(tab, { history: 'replace' });

    const fmt = DeckConfig.getFormat();
    document.documentElement.dataset.format = fmt.key in FORMATS ? fmt.key : 'commander';
}

/** Offer installation at most once a month — it is an offer, not a nag. */
function initPWAInstall() {
    const KEY = 'deckOracle.installOffered';
    const MONTH = 30 * 24 * 60 * 60 * 1000;
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        let last = 0;
        try { last = Number(localStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
        if (Date.now() - last < MONTH) return;
        try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
        toast('Install Deck Oracle for offline use?', {
            timeout: 10000,
            action: { label: 'Install', run: () => e.prompt() }
        });
    }, { once: true });
}

function startApp() {
    init().catch(error => {
        console.error('Deck Oracle failed to initialise:', error);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
