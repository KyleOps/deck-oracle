/**
 * Router — owns which page is visible, lazy-mounts calculators, and keeps the
 * URL in sync (`?tab=<key>`) so reload, back/forward and shared links all land
 * on the same page.
 *
 * Mounting a calculator = fetch its module + view (in parallel with Chart.js
 * when it draws charts), inject the shared page header and its markup, run its
 * init() once. Every later visit is just a visibility toggle plus updateUI().
 */

import { CALCULATORS, CALCULATOR_ORDER, DEFAULT_TAB, getCalculator, loadCalculator } from '../utils/calculatorRegistry.js';
import { ensureChartJs } from './vendor.js';
import { renderPageHeader, refreshPageHeader } from './pageHeader.js';

let current = null;
let navToken = 0;
const mounted = new Map();
const mounting = new Map();
const listeners = [];
const afterListeners = [];

export function currentTab() {
    return current;
}

// ── After the first page ─────────────────────────────────────────────────────
// Background work (prefetching likely pages, the service worker's precache)
// waits until the landing page has rendered, painted and gone idle. Idle alone
// is not enough: while the landing page's own modules are still downloading
// the main thread is idle too, and a prefetch then competes with them.

let firstPageSettled = false;
const settledQueue = [];

/** Run `task` when the browser is next idle (or after `timeout` ms regardless). */
export function whenIdle(task, { timeout = 3000 } = {}) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => task(), { timeout });
    else setTimeout(task, 1);
}

/** Run `task` after the next frame has been painted. */
export function afterNextPaint(task) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(task, 0));
    else setTimeout(task, 0);
}

/**
 * Run `task` once the first page has mounted, painted and the browser is idle.
 * Runs at idle straight away when that has already happened.
 * @param {Function} task
 */
export function afterFirstPage(task) {
    if (firstPageSettled) whenIdle(task);
    else settledQueue.push(task);
}

function settleFirstPage() {
    if (firstPageSettled) return;
    firstPageSettled = true;
    afterNextPaint(() => settledQueue.splice(0).forEach(task => whenIdle(() => {
        try { task(); } catch (err) { console.error('Background task failed:', err); }
    })));
}

/** Called synchronously at the start of every navigation with the new key. */
/** Called after a page has mounted and rendered: (name, panelElement). */
export function onNavigated(cb) {
    afterListeners.push(cb);
}

export function onNavigate(cb) {
    listeners.push(cb);
}

/** The loaded module of a mounted calculator, or null. */
export function mountedModule(name) {
    return mounted.get(name)?.module ?? null;
}

function mainEl() {
    return document.getElementById('main');
}

function panelFor(name) {
    let el = document.getElementById(`${name}-tab`);
    if (!el) {
        el = document.createElement('section');
        el.id = `${name}-tab`;
        el.className = 'tab-content';
        el.setAttribute('aria-label', CALCULATORS[name]?.name ?? name);
        mainEl()?.appendChild(el);
    }
    return el;
}

function skeleton() {
    return `
        <div class="page-skeleton" aria-hidden="true">
            <div class="sk sk-head"></div>
            <div class="sk-row"><div class="sk sk-rail"></div><div class="sk sk-main"></div></div>
        </div>`;
}

/**
 * Load and initialise a calculator once. Concurrent callers share one mount.
 * @returns {Promise<{module:Object}>}
 */
export function ensureMounted(name) {
    if (mounted.has(name)) return Promise.resolve(mounted.get(name));
    if (mounting.has(name)) return mounting.get(name);
    const entry = getCalculator(name);
    const job = Promise.all([
        loadCalculator(name),
        entry?.charts === false ? Promise.resolve(true) : ensureChartJs()
    ]).then(([record]) => {
        const panel = panelFor(name);
        panel.innerHTML = renderPageHeader(name) + `<div class="calc-body">${record.template}</div>`;
        if (record.styles && !document.querySelector(`style[data-calc="${name}"]`)) {
            const style = document.createElement('style');
            style.dataset.calc = name;
            style.textContent = record.styles;
            document.head.appendChild(style);
        }
        try {
            record.module.init?.();
        } catch (err) {
            console.error(`${name} failed to initialise:`, err);
        }
        mounted.set(name, record);
        mounting.delete(name);
        return record;
    }).catch(err => {
        mounting.delete(name);
        throw err;
    });
    mounting.set(name, job);
    return job;
}

function renderLoadError(panel, name, err) {
    panel.innerHTML = `
        <div class="page-error" role="alert">
            <h2>Couldn’t load ${CALCULATORS[name]?.name ?? 'this calculator'}</h2>
            <p>${navigator.onLine === false ? 'You appear to be offline.' : 'The page failed to download.'} Check your connection and try again.</p>
            <button class="btn btn-primary" type="button" data-retry>Try again</button>
        </div>`;
    panel.querySelector('[data-retry]')?.addEventListener('click', () => navigate(name, { history: 'none' }));
    console.error(err);
}

function writeHistory(name, mode) {
    if (mode === 'none' || typeof history === 'undefined') return;
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    params.set('tab', name);
    url.search = params.toString();
    url.hash = '';
    const state = { tab: name };
    if (mode === 'push' && url.href !== window.location.href) history.pushState(state, '', url);
    else history.replaceState(state, '', url);
}

/**
 * Show a page.
 * @param {string} name - calculator key
 * @param {{history?:'push'|'replace'|'none', focus?:boolean}} [opts]
 * @returns {Promise<void>}
 */
export async function navigate(name, { history: historyMode = 'push', focus = false } = {}) {
    if (!getCalculator(name)) name = DEFAULT_TAB;
    const token = ++navToken;
    const previous = current;
    current = name;

    // Copy first: removing from a live DOMTokenList while iterating skips entries.
    [...document.body.classList].filter(c => c.startsWith('theme-')).forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`theme-${name}`);
    document.body.dataset.page = name;
    document.body.dataset.group = CALCULATORS[name].group;
    document.title = name === DEFAULT_TAB
        ? 'Deck Oracle — MTG probability tools'
        : `${CALCULATORS[name].name} · Deck Oracle`;

    listeners.forEach(cb => {
        try { cb(name, previous); } catch (err) { console.error('Navigation listener failed:', err); }
    });

    const panel = panelFor(name);
    document.querySelectorAll('#main > .tab-content').forEach(el => {
        el.classList.toggle('active', el === panel);
    });
    if (historyMode !== 'none') writeHistory(name, historyMode);
    // Not on the first navigation: the page is already at the top, and the
    // call would force a layout before the page's modules are even requested.
    if (previous !== null && previous !== name) window.scrollTo({ top: 0, behavior: 'instant' });

    if (!mounted.has(name)) {
        panel.classList.add('is-loading');
        if (!panel.firstElementChild || panel.querySelector('.page-error')) panel.innerHTML = skeleton();
    }

    let record;
    try {
        record = await ensureMounted(name);
    } catch (err) {
        if (token === navToken) {
            renderLoadError(panel, name, err);
            settleFirstPage();
        }
        return;
    }
    if (token !== navToken) return; // the user moved on while this loaded

    panel.classList.remove('is-loading');
    refreshPageHeader(name);
    try {
        record.module.updateUI?.();
    } catch (err) {
        console.error(`${name} failed to render:`, err);
    }
    afterListeners.forEach(cb => {
        try { cb(name, panel); } catch (err) { console.error('Navigation listener failed:', err); }
    });
    if (focus) mainEl()?.focus({ preventScroll: true });
    settleFirstPage();
}

/** Re-render whatever is on screen (deck change, theme change). */
export function refreshCurrent() {
    if (!current || !mounted.has(current)) return;
    refreshPageHeader(current);
    try {
        mounted.get(current).module.updateUI?.();
    } catch (err) {
        console.error(`${current} failed to re-render:`, err);
    }
}

/** Step to the previous/next calculator in navigation order. */
export function step(delta) {
    const i = CALCULATOR_ORDER.indexOf(current);
    const next = CALCULATOR_ORDER[(i + delta + CALCULATOR_ORDER.length) % CALCULATOR_ORDER.length];
    return navigate(next);
}

/** Resolve the tab from the current URL. */
export function tabFromUrl() {
    const tab = new URLSearchParams(window.location.search).get('tab');
    return getCalculator(tab) ? tab : DEFAULT_TAB;
}

export function initRouter() {
    window.addEventListener('popstate', () => {
        navigate(tabFromUrl(), { history: 'none' });
    });

    // Any in-app link of the form <a data-tab-link="key"> navigates without a reload.
    document.addEventListener('click', e => {
        const link = e.target.closest?.('[data-tab-link]');
        if (!link) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // new-tab intent
        e.preventDefault();
        navigate(link.dataset.tabLink, { focus: link.closest('.nav') !== null });
    });

    // Warm the cache for likely next pages once the landing page is up, so the
    // first visit to them is instant without slowing the landing page.
    afterFirstPage(() => {
        ['odds', 'manabase', 'hands'].forEach(name => loadCalculator(name).catch(() => {}));
    });
}
