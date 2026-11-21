/**
 * Shared building blocks for the multiplayer pages — Ensnared by the Mara,
 * Dream Harvest and Mind's Dilation.
 *
 * All three read the same opponent libraries and need the same things: a
 * compact library model (built once per imported deck), deterministic random
 * draws, distribution helpers, the "no opponents yet" and "loading" states, and
 * the per-opponent markup (seat dot + name, card chips, small bar charts).
 * Keeping them here means the three pages look and behave as one family.
 */

import * as OpponentState from './opponentState.js';
import { cardRef, escapeHtml } from '../data/glossary.js';

// ── Library model ───────────────────────────────────────────────────────────

const TYPE_ORDER = ['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land'];

/**
 * The front face of a type line, lower-cased. A modal double-faced card in a
 * library has only its front face's characteristics, so "Sorcery // Land" is a
 * nonland card there.
 */
export function frontFace(typeLine) {
    return String(typeLine ?? '').split('//')[0].toLowerCase();
}

/** @returns {boolean} whether a card (by type line) is a land in the library */
export function isLandType(typeLine) {
    return /\bland\b/.test(frontFace(typeLine));
}

/** @returns {boolean} historic = artifact, legendary or Saga (front face) */
export function isHistoricType(typeLine) {
    return /\b(artifact|legendary|saga)\b/.test(frontFace(typeLine));
}

/**
 * Land test that accepts both library records ({land}) and the legacy deck
 * shape used by tests and buildDeckFromCardData ({types: [...]}).
 */
export function isLandCard(card) {
    if (typeof card?.land === 'boolean') return card.land;
    if (Array.isArray(card?.types)) return card.types.includes('land');
    return isLandType(card?.type_line);
}

function primaryType(front) {
    return TYPE_ORDER.find(t => front.includes(t)) ?? 'artifact';
}

const libraries = new WeakMap();

/**
 * An opponent's library as an array of compact, frozen card records — one per
 * physical card — built once per imported deck object.
 * @param {Object} data - opponent deck data with cardsByName
 * @returns {Array<{name:string, cmc:number, land:boolean, historic:boolean, type:string, types:string[]}>}
 */
export function libraryOf(data) {
    if (!data?.cardsByName) return [];
    const cached = libraries.get(data);
    if (cached) return cached;
    const library = [];
    for (const card of Object.values(data.cardsByName)) {
        const count = Math.max(0, Math.floor(card?.count ?? 1));
        if (!count) continue;
        const front = frontFace(card?.type_line);
        const land = isLandType(card?.type_line);
        const type = land ? 'land' : primaryType(front);
        const record = Object.freeze({
            name: String(card?.name ?? 'Unknown card'),
            cmc: Math.max(0, Number(card?.cmc) || 0),
            land,
            historic: !land && isHistoricType(card?.type_line),
            type,
            types: Object.freeze([type])
        });
        for (let i = 0; i < count; i++) library.push(record);
    }
    libraries.set(data, library);
    return library;
}

// ── Randomness ──────────────────────────────────────────────────────────────

/** 32-bit FNV-1a hash. */
export function hashString(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Small, fast seeded PRNG (mulberry32) → () => [0, 1). */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A seed that depends only on the list's contents: same deck, same answer. */
export function deckSeed(library) {
    const counts = new Map();
    for (const card of library) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    return hashString([...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, c]) => `${c} ${n}`).join('\n'));
}

/**
 * Reveal cards from the top of a shuffled library one at a time, shuffling only
 * as far as the reveal goes (a lazy Fisher–Yates). Call reset() before each run;
 * the pool stays a permutation, so continuing the shuffle from it is still
 * uniform and nothing is re-allocated between runs.
 * @param {Array} cards
 * @param {Function} [rng=Math.random]
 */
export function createRevealer(cards, rng = Math.random) {
    const pool = cards.slice();
    let next = 0;
    return {
        reset() { next = 0; },
        reveal() {
            if (next >= pool.length) return null;
            const j = next + Math.floor(rng() * (pool.length - next));
            const card = pool[j];
            pool[j] = pool[next];
            pool[next] = card;
            next += 1;
            return card;
        }
    };
}

// ── Distributions & formatting ──────────────────────────────────────────────

/**
 * Smallest value v with P(X ≤ v) ≥ q, for a distribution given as an array of
 * weights indexed by value (counts or probabilities).
 */
export function quantile(dist, q) {
    let total = 0;
    for (const w of dist) total += w || 0;
    if (!(total > 0)) return 0;
    const target = q * total - 1e-9;
    let cum = 0;
    for (let v = 0; v < dist.length; v++) {
        cum += dist[v] || 0;
        if (cum >= target) return v;
    }
    return dist.length - 1;
}

/** The middle half of outcomes, [25th, 75th percentile]. */
export function typicalRange(dist) {
    return [quantile(dist, 0.25), quantile(dist, 0.75)];
}

/** "3" or "2–4". */
export function formatRange([lo, hi]) {
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
}

/** Whole-number percentage, with honest ends: "<1%" and ">99%" instead of 0/100 for rare outcomes. */
export function formatPct(p) {
    const x = Number.isFinite(p) ? p : 0;
    if (x > 0 && x < 0.005) return '<1%';
    if (x < 1 && x > 0.995) return '>99%';
    return `${Math.round(x * 100)}%`;
}

/** One decimal. */
export function fmt1(x) {
    return (Number.isFinite(x) ? x : 0).toFixed(1);
}

/** P(X ≥ k) from a weight array. */
export function tailAtLeast(dist, k) {
    let total = 0;
    let tail = 0;
    dist.forEach((w, v) => {
        total += w || 0;
        if (v >= k) tail += w || 0;
    });
    return total > 0 ? tail / total : 0;
}

/** Bucket a distribution: values ≥ cap pile into the last bucket. */
export function capDistribution(dist, cap) {
    const out = new Array(cap + 1).fill(0);
    dist.forEach((w, v) => { out[Math.min(v, cap)] += w || 0; });
    return out;
}

/** "the three decks" / "this deck" style counts in prose. */
export function countWord(n) {
    return ['no', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);
}

// ── Page state ──────────────────────────────────────────────────────────────

const ids = new WeakMap();
let nextId = 1;

/** A stable id for an object's identity (deck objects are replaced on import). */
export function objectId(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    if (!ids.has(obj)) ids.set(obj, nextId++);
    return ids.get(obj);
}

/**
 * Everything a multiplayer page needs to decide what to show.
 * @returns {{opponents:Array<{key:string, index:number, data:Object, name:string, color:string}>, loading:string[], errors:string[], signature:string}}
 */
export function readOpponents() {
    const active = OpponentState.getActiveOpponents();
    const opponents = [];
    const loading = [];
    const errors = [];
    active.forEach((key, index) => {
        const data = OpponentState.getOpponentData(key);
        const status = OpponentState.getImportStatus(key);
        if (status?.state === 'loading') loading.push(key);
        if (status?.state === 'error') errors.push(status.message);
        if (data?.cardsByName && Object.keys(data.cardsByName).length > 0) {
            opponents.push({ key, index, data, name: data.name || `Opponent ${index + 1}`, color: OpponentState.seatColor(index) });
        }
    });
    const signature = [
        ...opponents.map(o => `${o.key}#${objectId(o.data)}`),
        `loading:${loading.join(',')}`,
        `errors:${errors.join(',')}`
    ].join('|');
    return { opponents, loading, errors, signature };
}

/**
 * Coalesce re-renders into one per frame. Several imports finishing together
 * (Load example opponents) then cost one render, not three.
 */
export function frameScheduler(fn) {
    let queued = false;
    return () => {
        if (queued) return;
        queued = true;
        const run = () => { queued = false; fn(); };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(run, 0);
    };
}

// ── Markup ──────────────────────────────────────────────────────────────────

/** Seat dot + deck name (+ optional sub line). */
export function opponentLabel(opp, sub = '') {
    return `<span class="opp-name" title="${escapeHtml(opp.name)}">
        <span class="opp-dot" style="--seat:${opp.color}" aria-hidden="true"></span>
        <span class="opp-name-text">${escapeHtml(opp.name)}</span>
        ${sub ? `<span class="opp-name-sub">${sub}</span>` : ''}
    </span>`;
}

/**
 * One revealed card as a chip: type-coloured edge, hoverable name, mana value.
 * @param {Object} card - library record
 * @param {Object} [opts]
 * @param {boolean} [opts.showMv=true]
 * @param {string} [opts.mvText] - override the mana value text
 * @param {boolean} [opts.dim] - de-emphasise (a land that gave nothing)
 */
export function cardChip(card, { showMv = true, mvText = null, dim = false } = {}) {
    const mv = mvText ?? (card.land ? '' : String(card.cmc));
    const cls = ['opp-chip', card.land ? 'is-land' : '', dim ? 'is-dim' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}" style="--chip:var(--type-${card.type})">${cardRef(card.name)}${showMv && mv !== '' ? `<span class="opp-chip-mv">${mv}</span>` : ''}</span>`;
}

/**
 * A compact bar chart (one row per value). Bars are scaled to `scaleMax` so
 * small multiples drawn side by side share one scale and compare honestly.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {number[]} opts.probs - probability per bucket (sums to 1)
 * @param {(i:number)=>string} opts.label
 * @param {number} [opts.scaleMax] - largest probability across the set
 * @param {string} [opts.color] - CSS colour for the bars
 * @param {(i:number)=>boolean} [opts.dimFn] - de-emphasise a bucket (e.g. "nothing")
 */
export function miniBars({ title, probs, label, scaleMax = null, color = 'var(--tx-flat)', dimFn = null }) {
    const max = scaleMax ?? Math.max(...probs, 0);
    const rows = probs.map((p, i) => {
        const width = max > 0 ? (p / max) * 100 : 0;
        return `<div class="opp-bar-row${dimFn?.(i) ? ' is-dim' : ''}">
            <span class="opp-bar-label">${label(i)}</span>
            <span class="opp-bar-track"><span class="opp-bar-fill" style="width:${width.toFixed(1)}%"></span></span>
            <span class="opp-bar-val">${formatPct(p)}</span>
        </div>`;
    }).join('');
    return `<div class="opp-bars" style="--bar:${color}">
        <div class="opp-bars-title">${escapeHtml(title)}</div>
        ${rows}
    </div>`;
}

/**
 * The state a multiplayer page shows before it has any opponent decks: what the
 * card does to opponents, a one-click example table, and where to import real
 * lists. While imports are running it becomes a loading state instead.
 *
 * @param {Object} copy
 * @param {string} copy.title - a short headline
 * @param {string} copy.lead - one or two sentences (may contain cardRef/term HTML)
 * @param {Array<{kicker:string, text:string, demo?:string}>} copy.steps - how the card works
 * @param {{loading:string[], errors:string[]}} state - from readOpponents()
 */
export function renderOpponentPlaceholder(copy, state) {
    if (state.loading.length > 0) {
        const n = state.loading.length;
        return `
        <div class="opp-empty is-loading" aria-busy="true">
            <div class="opp-loading-head">
                <span class="opp-spinner" aria-hidden="true"></span>
                <div>
                    <p class="opp-empty-title">Loading ${n === 1 ? 'an opponent’s deck' : `${countWord(n)} opponent decks`}…</p>
                    <p class="opp-empty-lead">Fetching the lists and their card data. The numbers appear here as soon as the first deck arrives.</p>
                </div>
            </div>
            <div class="opp-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
        </div>`;
    }

    const steps = copy.steps.map((s, i) => `
        <li class="opp-step">
            <span class="opp-step-kicker"><span class="opp-step-num">${i + 1}</span>${s.kicker}</span>
            <span class="opp-step-text">${s.text}</span>
            ${s.demo ? `<span class="opp-step-demo" aria-hidden="true">${s.demo}</span>` : ''}
        </li>`).join('');

    const error = state.errors.length
        ? `<p class="opp-error" role="alert">The last import failed: ${escapeHtml(state.errors[0])}</p>`
        : '';

    return `
        <div class="opp-empty">
            <div class="opp-empty-intro">
                <p class="opp-empty-title">${copy.title}</p>
                <p class="opp-empty-lead">${copy.lead}</p>
            </div>
            <ol class="opp-steps">${steps}</ol>
            ${error}
            <div class="opp-actions">
                <button type="button" class="btn btn-primary" data-opp-page-action="examples">Load example opponents</button>
                <button type="button" class="btn btn-ghost" data-opp-page-action="import">Import your table’s decks</button>
            </div>
            <p class="opp-foot">Paste a Moxfield or Archidekt link — or a plain decklist — into <strong>Opponent decklists</strong> above. Up to three opponents; every number on this page is worked out from their real lists.</p>
        </div>`;
}

/** A slim notice above results while more decks are still arriving. */
export function renderLoadingNote(state) {
    const n = state.loading.length;
    if (!n) return '';
    return `<p class="opp-note" role="status"><span class="opp-spinner is-small" aria-hidden="true"></span>Loading ${n === 1 ? 'one more deck' : `${countWord(n)} more decks`} — the numbers update when ${n === 1 ? 'it arrives' : 'they arrive'}.</p>`;
}

const disclosures = new Map();

/**
 * A collapsible block that remembers the reader's choice across re-renders
 * (decks arriving re-render the page; a section they closed stays closed).
 * @param {{id:string, title:string, body:string, open:boolean}} opts - `open` is the default
 */
export function renderDisclosure({ id, title, body, open }) {
    const isOpen = disclosures.has(id) ? disclosures.get(id) : open;
    return `<details class="tx-collapse opp-disclosure" data-remember="${id}"${isOpen ? ' open' : ''}>
        <summary class="tx-collapse-head">${title}</summary>
        ${body}
    </details>`;
}

/** Whether an element has room for side-by-side detail (wide layouts open it by default). */
export function hasRoom(el, min = 700) {
    const width = el?.clientWidth;
    return !width || width >= min;
}

/**
 * Wire the placeholder's buttons (event delegation; call once per page root).
 * "Load example opponents" drives the bar's own button, so there is one loader.
 */
export function bindOpponentActions(root) {
    if (!root || root.dataset.oppBound === 'true') return;
    root.dataset.oppBound = 'true';
    // <details> toggle events don't bubble — listen in the capture phase.
    root.addEventListener('toggle', e => {
        const id = e.target?.dataset?.remember;
        if (id) disclosures.set(id, e.target.open);
    }, true);
    root.addEventListener('click', e => {
        const btn = e.target.closest('[data-opp-page-action]');
        if (!btn || btn.disabled) return;
        if (btn.dataset.oppPageAction === 'examples') {
            const loader = document.getElementById('load-example-opponents-btn');
            if (!loader || loader.disabled) return;
            btn.disabled = true;
            btn.textContent = 'Loading examples…';
            loader.click();
        } else if (btn.dataset.oppPageAction === 'import') {
            OpponentState.focusImportField();
        }
    });
}

/**
 * CSS shared by the three multiplayer pages, scoped to one page root. Each
 * view's `styles` export includes it.
 * @param {string} s - scope selector, e.g. '#mara-tab'
 */
export function opponentPageStyles(s) {
    return `
${s} .opp-empty { display: grid; gap: 20px; padding: clamp(20px, 3cqi, 36px); }
${s} .opp-empty-intro { display: grid; gap: 8px; }
${s} .opp-empty-title { font-size: var(--t-xl); font-weight: 650; letter-spacing: var(--track-tight); color: var(--tx-bright); line-height: 1.25; }
${s} .opp-empty-lead { font-size: var(--t-body); color: var(--tx-mid); line-height: 1.6; max-width: 66ch; text-wrap: pretty; }
${s} .opp-steps { list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; padding: 0; margin: 0; }
${s} .opp-step {
    display: grid; gap: 8px; align-content: start;
    padding: 14px 16px;
    background: var(--tx-panel-alt); border: 1px solid var(--tx-rule); border-radius: var(--radius-md);
}
${s} .opp-step-kicker {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase; color: var(--tx-dim);
}
${s} .opp-step-num {
    display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
    background: var(--tx-rule); color: var(--tx-bright); font-family: var(--font-mono); letter-spacing: 0;
}
${s} .opp-step-text { font-size: var(--t-sm); color: var(--tx-text); line-height: 1.55; }
${s} .opp-step-demo { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 2px; font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-mid); }
${s} .opp-demo-card {
    display: inline-grid; place-items: center; min-width: 34px; height: 24px; padding: 0 6px;
    border: 1px solid var(--tx-rule-hi); border-radius: var(--radius-xs); background: var(--tx-bg); color: var(--tx-text);
}
${s} .opp-demo-card.is-land { color: var(--tx-dim); border-style: dashed; }
${s} .opp-demo-card.is-hit { border-color: var(--tx-good); color: var(--tx-good); background: var(--good-soft); }
${s} .opp-demo-arrow { color: var(--tx-dim); padding: 0 2px; }
${s} .opp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
${s} .opp-foot { font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.55; max-width: 72ch; }
${s} .opp-foot strong { color: var(--tx-mid); }
${s} .opp-error { font-size: var(--t-sm); color: var(--tx-bad); }

${s} .opp-loading-head { display: flex; gap: 14px; align-items: flex-start; }
${s} .opp-spinner {
    flex: none; width: 22px; height: 22px; margin-top: 3px; border-radius: 50%;
    border: 2px solid var(--tx-rule-hi); border-top-color: var(--tx-accent);
    animation: opp-spin 0.8s linear infinite;
}
${s} .opp-spinner.is-small { display: inline-block; width: 12px; height: 12px; margin: 0 8px 0 0; vertical-align: -1px; border-width: 2px; }
${s} .opp-skeleton { display: grid; gap: 10px; }
${s} .opp-skeleton span {
    display: block; height: 44px; border-radius: var(--radius-md);
    background: linear-gradient(90deg, var(--tx-panel-alt) 0%, var(--tx-row-hi) 50%, var(--tx-panel-alt) 100%);
    background-size: 200% 100%; animation: shimmer 1.2s ease-in-out infinite;
}
${s} .opp-skeleton span:nth-child(2) { width: 82%; }
${s} .opp-skeleton span:nth-child(3) { width: 64%; }
${s} .opp-note {
    display: flex; align-items: center; padding: 10px 16px;
    border-bottom: 1px solid var(--tx-rule); font-size: var(--t-xs); color: var(--tx-mid);
}

${s} .opp-section-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    padding: 14px 16px 10px;
}
${s} .opp-section-title { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
${s} .opp-section-sub { font-size: var(--t-xs); color: var(--tx-dim); }
${s} .opp-section-actions { display: flex; gap: 6px; }

${s} .opp-table-wrap { overflow-x: auto; }
${s} .opp-table { width: 100%; border-collapse: collapse; font-size: var(--t-sm); }
${s} .opp-table th {
    padding: 8px 16px; text-align: right; white-space: nowrap;
    font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase; color: var(--tx-dim);
    border-bottom: 1px solid var(--tx-rule);
}
${s} .opp-table td {
    padding: 12px 16px; text-align: right; white-space: nowrap; vertical-align: middle;
    font-family: var(--font-mono); font-feature-settings: 'tnum' 1; color: var(--tx-text);
    border-bottom: 1px solid var(--tx-rule);
}
${s} .opp-table th:first-child,
${s} .opp-table td:first-child { text-align: left; font-family: var(--font-body); }
${s} .opp-table tbody tr:hover td { background: var(--tx-row-hi); }
${s} .opp-table tfoot td { color: var(--tx-bright); font-weight: 600; border-bottom: 0; background: var(--tx-panel-alt); }
${s} .opp-table .opp-cell-sub { display: block; font-family: var(--font-body); font-size: var(--t-label); color: var(--tx-dim); font-weight: 400; }
${s} .opp-name { display: inline-flex; align-items: center; gap: 10px; min-width: 0; max-width: min(360px, 100%); vertical-align: middle; }
${s} .opp-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--seat); }
${s} .opp-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--tx-bright); }
${s} .opp-name-sub { flex: none; font-size: var(--t-xs); color: var(--tx-dim); font-weight: 400; }

${s} .opp-multiples { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); border-top: 1px solid var(--tx-rule); }
${s} .opp-multiple { min-width: 0; padding: 14px 16px 16px; border-right: 1px solid var(--tx-rule); border-bottom: 1px solid var(--tx-rule); margin: 0 -1px -1px 0; }
${s} .opp-multiple-head { margin-bottom: 4px; }
${s} .opp-bars { display: grid; gap: 3px; margin-top: 12px; }
${s} .opp-bars-title { font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase; color: var(--tx-dim); margin-bottom: 4px; }
${s} .opp-bar-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 40px; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: var(--t-label); }
${s} .opp-bar-label { color: var(--tx-mid); text-align: right; white-space: nowrap; }
${s} .opp-bar-track { height: 10px; border-radius: 2px; background: var(--tx-bg); overflow: hidden; }
${s} .opp-bar-fill { display: block; height: 100%; border-radius: 2px; background: var(--bar); }
${s} .opp-bar-val { color: var(--tx-text); text-align: right; }
${s} .opp-bar-row.is-dim .opp-bar-fill { background: var(--tx-rule-hi); }
${s} .opp-disclosure > .tx-collapse-head { padding: 12px 16px; }
${s} .opp-disclosure > .opp-multiples { border-top: 0; }
${s} .opp-caption { padding: 10px 16px 14px; font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.55; max-width: 90ch; }

${s} .opp-chip {
    display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
    padding: 3px 8px; border-radius: var(--radius-xs);
    border: 1px solid color-mix(in srgb, var(--chip) 55%, transparent);
    background: color-mix(in srgb, var(--chip) 12%, transparent);
    font-size: var(--t-xs); color: var(--tx-text); white-space: nowrap;
}
${s} .opp-chip .card-ref { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: inherit; }
${s} .opp-chip.is-land { color: var(--tx-dim); background: transparent; border-style: dashed; }
${s} .opp-chip.is-dim { opacity: 0.7; }
${s} .opp-chip-mv { flex: none; font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-mid); }
${s} .opp-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
${s} .opp-arrow { color: var(--tx-dim); padding: 0 2px; }
${s} .opp-total { font-family: var(--font-mono); font-weight: 600; color: var(--tx-bright); white-space: nowrap; }
${s} .opp-miss { font-size: var(--t-xs); color: var(--tx-dim); }

${s} .opp-games { display: grid; }
${s} .opp-game { display: grid; gap: 10px; padding: 14px 16px; border-top: 1px solid var(--tx-rule); }
${s} .opp-game-head { font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase; color: var(--tx-dim); }
${s} .opp-more { display: flex; justify-content: center; padding: 12px 16px 16px; border-top: 1px solid var(--tx-rule); }

@container shell (max-width: 640px) {
    ${s} .opp-table thead { display: none; }
    ${s} .opp-table, ${s} .opp-table tbody, ${s} .opp-table tfoot { display: block; }
    ${s} .opp-table tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px 16px; border-bottom: 1px solid var(--tx-rule); }
    ${s} .opp-table tfoot tr { background: var(--tx-panel-alt); }
    ${s} .opp-table td { padding: 0; border: 0; text-align: left; white-space: normal; background: none !important; }
    ${s} .opp-table td:first-child { grid-column: 1 / -1; }
    ${s} .opp-table td[data-label=""] { display: none; }
    ${s} .opp-table td[data-label]::before {
        content: attr(data-label); display: block; margin-bottom: 2px;
        font-family: var(--font-body); font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase; color: var(--tx-dim);
    }
    ${s} .opp-name { max-width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
    ${s} .opp-spinner { animation-duration: 2.4s; }
    ${s} .opp-skeleton span { animation: none; }
}
`;
}
