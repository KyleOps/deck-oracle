/**
 * Shared building blocks for the four "big spell" pages — Portent of Calamity,
 * Genesis Wave, Kamahl's Druidic Vow and Primal Surge.
 *
 * Three kinds of thing live here, none of which touches the DOM:
 *   - deck helpers (the card list, card types, a cache key for the list)
 *   - exact maths and number formatting the four pages share
 *   - markup and CSS strings the four views render, so the pages look and
 *     behave as one family
 *
 * The exceptions are the "page helpers" (X control sync, preset chips) and
 * renderHowItCompares(); each is only ever called by the page that owns the
 * elements it touches. renderHowItCompares() lazy-loads the comparison so a
 * page's first paint never waits on the other three calculators.
 */

import * as DeckConfig from './deckConfig.js';
import { shuffle } from './simulation.js';
import { cardRef, escapeHtml } from '../data/glossary.js';

// ── Card types ───────────────────────────────────────────────────────────────

/** Every card type a library card can have (kindred aside), in display order. */
export const CARD_TYPES = Object.freeze(['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land', 'instant', 'sorcery']);

/** Card types that make a card a permanent card. */
export const PERMANENT_TYPES = Object.freeze(['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land']);

const TYPE_LABELS = Object.freeze({
    creature: 'Creature', artifact: 'Artifact', enchantment: 'Enchantment', planeswalker: 'Planeswalker',
    battle: 'Battle', land: 'Land', instant: 'Instant', sorcery: 'Sorcery'
});

/** Display name for a card type key. */
export function typeLabel(type) {
    return TYPE_LABELS[type] ?? String(type ?? '');
}

/**
 * Card types on a type line. Imports store the front face of double-faced
 * cards, which is what a card has while it is in the library.
 * @param {string} typeLine
 * @returns {string[]} keys from CARD_TYPES
 */
export function cardTypesOf(typeLine) {
    const lower = String(typeLine ?? '').toLowerCase();
    return CARD_TYPES.filter(type => lower.includes(type));
}

/** Is this type line a permanent card (any permanent type)? */
export function isPermanentTypeLine(typeLine) {
    const lower = String(typeLine ?? '').toLowerCase();
    return PERMANENT_TYPES.some(type => lower.includes(type));
}

// ── The deck ─────────────────────────────────────────────────────────────────

/**
 * The deck's card records, or [] when only type counts are known.
 *
 * Hand-edited type counts no longer describe an imported list (DeckConfig
 * marks the deck 'manual'), so the counts win and the list is ignored —
 * otherwise a page would mix card odds from one deck with the size of another.
 *
 * @param {Object} [config] - a DeckConfig snapshot (defaults to the live deck)
 * @returns {Array<{name:string, type_line:string, cmc:number, count:number}>}
 */
export function deckCardList(config = DeckConfig.getDeckConfig()) {
    if (config?.importSource === 'manual') return [];
    return Object.values(config?.cardsByName ?? {})
        .filter(card => card && (Number(card.count) || 0) > 0)
        .map(card => ({
            name: String(card.name ?? ''),
            type_line: String(card.type_line ?? ''),
            cmc: Number.isFinite(Number(card.cmc)) ? Math.max(0, Number(card.cmc)) : 0,
            count: Math.max(0, Math.floor(Number(card.count) || 0))
        }));
}

/** Number of cards in a card list. */
export function listSize(cards) {
    return (cards ?? []).reduce((sum, card) => sum + (card?.count ?? 0), 0);
}

/**
 * A short, order-independent key for a card list (FNV-1a over its contents),
 * so results can be cached per deck without holding the whole list as a key.
 */
export function cardListKey(cards) {
    const text = (cards ?? [])
        .map(card => `${card.name}|${card.count}|${card.cmc}|${card.type_line}`)
        .sort()
        .join('\n');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${(cards ?? []).length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Expand a card list into one object per physical card, with its types worked
 * out once. Copies of a card share one object.
 */
export function expandCards(cards) {
    const out = [];
    for (const card of cards ?? []) {
        const record = Object.freeze({
            name: card.name,
            type_line: card.type_line,
            cmc: card.cmc ?? 0,
            types: Object.freeze(cardTypesOf(card.type_line))
        });
        for (let i = 0; i < (card.count ?? 0); i++) out.push(record);
    }
    return out;
}

/**
 * A handful of shuffled libraries that stay put until the deck changes or the
 * player asks for new ones — so moving a slider shows the same shuffles
 * resolving differently, rather than new random cards every time.
 * @param {number} [size=4]
 */
export function createSampler(size = 4) {
    let key = null;
    let decks = [];
    return {
        /**
         * @param {string} deckKey - changes whenever the library changes
         * @param {() => Array} build - builds the unshuffled library
         */
        get(deckKey, build) {
            if (deckKey !== key) {
                const base = build() ?? [];
                decks = Array.from({ length: size }, () => {
                    const copy = base.slice();
                    shuffle(copy);
                    return copy;
                });
                key = deckKey;
            }
            return decks;
        },
        reshuffle() {
            key = null;
        }
    };
}

// ── Exact maths ──────────────────────────────────────────────────────────────

const LOG_FACTORIAL = [0];

function logFactorial(n) {
    for (let i = LOG_FACTORIAL.length; i <= n; i++) {
        LOG_FACTORIAL[i] = LOG_FACTORIAL[i - 1] + Math.log(i);
    }
    return LOG_FACTORIAL[n];
}

function logChoose(n, k) {
    return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * Exact distribution of successes when drawing without replacement.
 * @param {number} population - cards in the library
 * @param {number} successes - cards that count as a hit
 * @param {number} draws - cards looked at
 * @returns {number[]} pmf, index = number of hits (length draws + 1)
 */
export function hypergeometricPmf(population, successes, draws) {
    const N = Math.max(0, Math.floor(Number(population) || 0));
    const K = Math.min(N, Math.max(0, Math.floor(Number(successes) || 0)));
    const n = Math.min(N, Math.max(0, Math.floor(Number(draws) || 0)));
    const pmf = new Array(n + 1).fill(0);
    const lo = Math.max(0, n - (N - K));
    const hi = Math.min(n, K);
    const denominator = logChoose(N, n);
    for (let k = lo; k <= hi; k++) {
        pmf[k] = Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - denominator);
    }
    return pmf;
}

/**
 * Smallest value whose cumulative probability reaches q.
 * @param {number[]} pmf - index = value
 * @param {number} q - 0..1
 */
export function quantileOf(pmf, q) {
    let cumulative = 0;
    for (let k = 0; k < pmf.length; k++) {
        cumulative += pmf[k];
        if (cumulative >= q - 1e-9) return k;
    }
    return Math.max(0, pmf.length - 1);
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * A probability as a whole percentage. Never rounds a possible result to 0%
 * or an uncertain one to 100%.
 */
export function pct(p) {
    if (!Number.isFinite(p)) return '—';
    if (p <= 0) return '0%';
    if (p >= 1) return '100%';
    if (p < 0.005) return '<1%';
    if (p >= 0.995) return '>99%';
    return `${Math.round(p * 100)}%`;
}

/** An average to one decimal place. */
export function avg(value, digits = 1) {
    if (!Number.isFinite(value)) return '—';
    const text = value.toFixed(digits);
    return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** Change in a probability, in percentage points: "+9 points". */
export function points(delta) {
    if (!Number.isFinite(delta)) return '—';
    const rounded = Math.round(delta * 100);
    if (rounded === 0) return 'no change';
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} point${Math.abs(rounded) === 1 ? '' : 's'}`;
}

/** Compact change in a probability for tables: "+9 pts". */
export function pointsShort(delta) {
    if (!Number.isFinite(delta)) return '—';
    const rounded = Math.round(delta * 100);
    if (rounded === 0) return '0';
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} pts`;
}

/** "1 card" / "3 cards". */
export function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}

/** Tone for a chance the player wants to be high. */
export function chanceTone(p, { good = 0.7, warn = 0.4 } = {}) {
    if (!Number.isFinite(p)) return 'flat';
    if (p >= good) return 'good';
    if (p >= warn) return 'warn';
    return 'bad';
}

/** CSS colour token for a tone. */
export function toneColor(tone) {
    return { good: 'var(--tx-good)', warn: 'var(--tx-warn)', bad: 'var(--tx-bad)' }[tone] ?? 'var(--tx-bright)';
}

// ── Markup (strings only) ────────────────────────────────────────────────────

/**
 * The X input every X spell uses: a big number box, a slider and preset chips.
 * Keeps the `<key>-xSlider` / `<key>-xValue` ids share links and
 * registerCalculator() bind to.
 */
export function xControlHTML({ key, label = 'Cards revealed (X)', hint = '', value = 7, max = 30, presets = [], costLabel = '' }) {
    const chips = presets.map(x =>
        `<button class="bs-chip" type="button" data-x="${x}" aria-pressed="false">X=${x}</button>`).join('');
    return `
        <div class="bs-field">
            <div class="bs-field-head">
                <label class="bs-label" for="${key}-xValue">${label}</label>
                <span class="bs-cost" id="${key}-cost">${costLabel}</span>
            </div>
            <div class="bs-x">
                <input class="field bs-x-num" type="number" id="${key}-xValue" value="${value}" min="1" max="50" inputmode="numeric" aria-describedby="${key}-x-hint">
                <input type="range" id="${key}-xSlider" value="${value}" min="1" max="${max}" step="1" aria-label="${escapeHtml(label)}">
            </div>
            ${chips ? `<div class="bs-presets" id="${key}-presets" role="group" aria-label="Common X values">${chips}</div>` : ''}
            ${hint ? `<p class="bs-hint" id="${key}-x-hint">${hint}</p>` : ''}
        </div>`;
}

/**
 * The value model inputs (what "pays for itself" means). Ids are kept from the
 * legacy pages so old share links still restore them.
 * @param {{key:string, fields:Array<{id:string,label:string,hint:string,value:number,min?:number,max?:number}>, intro?:string, footer?:string}} opts
 */
export function valueModelHTML({ fields = [], intro = '', footer = '' }) {
    const rows = fields.map(f => `
        <label class="bs-value-row" for="${f.id}">
            <span class="bs-value-name">${f.label}</span>
            <input type="number" class="field field-sm" id="${f.id}" value="${f.value}" min="${f.min ?? 0}" max="${f.max ?? 20}" step="0.25" inputmode="decimal">
            <small>${f.hint}</small>
        </label>`).join('');
    return `
        <div class="bs-field">
            <div class="bs-field-head"><span class="bs-label">What counts as paying for itself</span></div>
            ${intro ? `<p class="bs-hint">${intro}</p>` : ''}
            <div class="bs-value">${rows}</div>
            ${footer ? `<p class="bs-hint">${footer}</p>` : ''}
        </div>`;
}

/** A small type-coloured dot. */
export function typeDot(type) {
    const known = CARD_TYPES.includes(type) ? type : 'artifact';
    return `<span class="bs-dot" style="--dot: var(--type-${known})" aria-hidden="true"></span>`;
}

/**
 * One sample cast: header, the cards it looked at with what happened to each,
 * and a one-line result.
 * A row of `{ more: 'text' }` renders as a "+ N more" line inside the list.
 *
 * @param {{title:string, tag:string, tone:'good'|'bad'|'flat', rows:Array<{name?:string, type?:string, mv?:number|string, fate?:string, state?:'hit'|'miss'|'star', more?:string}>, more?:string, footer:string}} sample
 */
export function sampleCardHTML({ title, tag, tone = 'flat', rows = [], more = '', footer = '' }) {
    const items = rows.map(row => row.more ? `<li class="bs-more">${row.more}</li>` : `
        <li class="bs-card is-${row.state ?? 'hit'}">
            ${typeDot(row.type)}
            <span class="bs-card-name">${cardRef(row.name)}</span>
            <span class="bs-card-mv">${row.mv ?? ''}</span>
            <span class="bs-fate">${row.fate ?? ''}</span>
        </li>`).join('');
    return `
        <article class="bs-sample tone-${tone}">
            <header class="bs-sample-head">
                <span class="bs-sample-title">${title}</span>
                <span class="bs-tag">${tag}</span>
            </header>
            <ol class="bs-cards">${items}</ol>
            ${more ? `<p class="bs-more">${more}</p>` : ''}
            <footer class="bs-sample-foot">${footer}</footer>
        </article>`;
}

/**
 * Horizontal probability bars.
 * @param {Array<{label:string, value:number, tone?:string, note?:string, current?:boolean}>} rows
 * @param {{scale?:number}} [opts] - value that fills the bar (default 1)
 */
export function barsHTML(rows, { scale = 1, format = pct } = {}) {
    const items = rows.map(row => {
        const width = Math.max(0, Math.min(100, (Number(row.value) || 0) / (scale || 1) * 100));
        return `
            <li class="bs-bar-row${row.current ? ' is-current' : ''}">
                <span class="bs-bar-label">${row.label}</span>
                <span class="bs-bar tone-${row.tone ?? 'flat'}"><span style="width:${width.toFixed(1)}%"></span></span>
                <span class="bs-bar-value">${format(row.value)}</span>
                ${row.note ? `<span class="bs-bar-note">${row.note}</span>` : ''}
            </li>`;
    }).join('');
    return `<ol class="bs-bars">${items}</ol>`;
}

/** Empty / notice states. */
export function noticeHTML(html, tone = 'warn') {
    return `<p class="bs-notice tone-${tone}">${html}</p>`;
}

/**
 * A chart colour at reduced opacity. Takes the live TX_CHART value (hex or
 * rgb), so faded series still follow the theme.
 */
export function fade(color, alpha) {
    const value = String(color ?? '').trim();
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
    if (rgb) {
        const [r, g, b] = rgb[1].split(',').map(v => v.trim());
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return value;
}

// ── Page helpers (only ever called by the page that owns the inputs) ─────────

function byId(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

/**
 * The page's X, or the fallback when its page has not been mounted.
 * @param {string} key - calculator key
 * @param {number} fallback
 */
export function readX(key, fallback) {
    const value = parseInt(byId(`${key}-xValue`)?.value, 10);
    return Number.isFinite(value) && value >= 1 ? value : fallback;
}

/**
 * Bring the X control in line with the value actually used (clamped to the
 * library), update the cost line and the preset chips.
 */
export function syncXControl(key, x, max, costText) {
    const slider = byId(`${key}-xSlider`);
    const input = byId(`${key}-xValue`);
    if (slider) {
        if (String(slider.max) !== String(max)) slider.max = max;
        if (String(slider.value) !== String(x)) slider.value = x;
    }
    // Never rewrite the box while someone is typing in it.
    if (input && input !== document.activeElement && String(input.value) !== String(x)) input.value = x;
    const cost = byId(`${key}-cost`);
    if (cost && cost.textContent !== costText) cost.textContent = costText;
    document.querySelectorAll?.(`#${key}-presets .bs-chip`).forEach(chip => {
        chip.setAttribute('aria-pressed', String(Number(chip.dataset.x) === x));
    });
}

/** Wire the preset chips to a setter. */
export function bindXPresets(key, onPick) {
    byId(`${key}-presets`)?.addEventListener('click', event => {
        const chip = event.target.closest?.('.bs-chip');
        if (chip) onPick(Number(chip.dataset.x));
    });
}

// ── How it compares (lazy) ───────────────────────────────────────────────────

const idle = typeof requestIdleCallback === 'function'
    ? cb => requestIdleCallback(cb, { timeout: 600 })
    : cb => setTimeout(cb, 30);

/**
 * Fill the "How it compares" panel. The comparison module (which pulls in all
 * four calculators) is fetched on demand and computed when the browser is
 * idle; an unchanged comparison is not recomputed.
 *
 * @param {string} containerId
 * @param {{x:number, source:string, deckKey:string, options?:Object}} opts
 */
export function renderHowItCompares(containerId, { x, source, deckKey, options = {} }) {
    const el = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
    if (!el) return;
    const key = `${deckKey}|${x}|${source}|${JSON.stringify(options)}`;
    if (el.dataset.compareKey === key) return;
    el.dataset.compareKey = key;
    import('./bigSpellComparison.js').then(({ compareBigSpells, renderComparison }) => {
        idle(() => {
            const node = document.getElementById(containerId);
            if (!node || node.dataset.compareKey !== key) return; // superseded
            try {
                node.innerHTML = renderComparison(compareBigSpells(x, source, options), { current: source });
            } catch (err) {
                console.error('Big spell comparison failed', err);
                node.innerHTML = '';
            }
        });
    }).catch(err => {
        el.dataset.compareKey = '';
        console.error('Could not load the big spell comparison', err);
    });
}

// ── Styles ───────────────────────────────────────────────────────────────────

/**
 * Add the shared big-spell CSS to the document once, however many of those pages are opened
 * (each view calls this when it loads). A no-op outside a browser.
 * @param {Document} [doc]
 */
export function injectSharedStyles(doc = globalThis.document) {
    if (!doc?.head || doc.querySelector('style[data-owner="big-spells"]')) return;
    const style = doc.createElement('style');
    style.dataset.owner = 'big-spells';
    style.textContent = sharedStyles();
    doc.head.appendChild(style);
}

/**
 * CSS shared by the four big-spell views. Scoped under `.bs-page` (the root
 * of each view's template) rather than a page id, so one copy serves every
 * page: see injectSharedStyles().
 * @param {string} [scope]
 */
export function sharedStyles(scope = '.bs-page') {
    const s = scope;
    return `
${s} .bs-h { margin: 0; font-size: var(--t-body); font-weight: 650; letter-spacing: 0; color: var(--tx-bright); }
${s} .bs-caption { margin: 0; padding: 10px 18px 14px; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); }
${s} .bs-caption strong { color: var(--tx-mid); font-weight: 600; }

/* Rail */
${s} .bs-field { display: grid; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--tx-rule); }
${s} .bs-field:last-child { border-bottom: 0; }
${s} .bs-field-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
${s} .bs-label { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); letter-spacing: 0; text-transform: none; margin: 0; white-space: nowrap; }
${s} .bs-cost { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-mid); white-space: nowrap; }
${s} .bs-hint { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); }
${s} .bs-hint strong { color: var(--tx-text); font-weight: 600; }
${s} .bs-x { display: flex; align-items: center; gap: 14px; }
${s} .bs-x input[type="range"] { flex: 1; min-width: 0; }
${s} .bs-x-num {
    width: 76px; flex-shrink: 0; padding: 6px 4px; text-align: center;
    font-family: var(--font-mono); font-size: var(--t-xl); font-weight: 650; line-height: 1;
    border-radius: var(--radius-sm); color: var(--tx-bright);
}
${s} .bs-presets { display: flex; flex-wrap: wrap; gap: 6px; }
${s} .bs-chip {
    padding: 4px 11px; border: 1px solid var(--tx-rule-hi); border-radius: var(--radius-full);
    background: transparent; color: var(--tx-mid); font: 500 var(--t-xs)/1.4 var(--font-mono);
    cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}
${s} .bs-chip:hover { color: var(--tx-bright); border-color: var(--tx-dim); background: var(--tx-panel-alt); }
${s} .bs-chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--tx-accent); color: var(--tx-accent); }
${s} .bs-check { display: flex; gap: 10px; align-items: flex-start; font-size: var(--t-sm); color: var(--tx-text); cursor: pointer; }
${s} .bs-check input { margin-top: 3px; flex-shrink: 0; }
${s} .bs-value { display: grid; gap: 2px; }
${s} .bs-value-row { display: grid; grid-template-columns: minmax(0, 1fr) 76px; gap: 2px 12px; align-items: center; padding: 6px 0; }
${s} .bs-value-name { font-size: var(--t-sm); color: var(--tx-text); }
${s} .bs-value-row input { width: 76px; text-align: right; border-radius: var(--radius-sm); }
${s} .bs-value-row small { grid-column: 1 / -1; font-size: var(--t-label); color: var(--tx-dim); line-height: 1.4; }

/* Answer */
${s} .bs-answer .tx-hero { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); justify-content: stretch; border-bottom: 0; }
${s} .bs-answer .tx-hero .tx-stat { border-bottom: 0; }
${s} .bs-notice { margin: 0; padding: 12px 18px; font-size: var(--t-sm); line-height: 1.5; color: var(--tx-text); border-bottom: 1px solid var(--tx-rule); }
${s} .bs-notice.tone-warn { background: var(--warn-soft); }
${s} .bs-notice.tone-flat { background: var(--tx-panel-alt); }

/* Charts */
${s} .bs-chart { position: relative; height: 270px; padding: 14px 14px 4px; }
${s} .bs-legend { display: inline-flex; gap: 14px; align-items: center; flex-wrap: wrap; }
${s} .bs-key { display: inline-flex; align-items: center; gap: 6px; }
${s} .bs-key::before { content: ''; width: 10px; height: 10px; border-radius: 2px; background: var(--key, var(--tx-flat)); }
${s} .bs-key.is-line::before { height: 3px; border-radius: 2px; }
${s} .bs-key.k-accent { --key: var(--tx-accent); }
${s} .bs-key.k-good { --key: var(--tx-good); }
${s} .bs-key.k-flat { --key: var(--tx-flat); }
${s} .bs-key.k-dim { --key: var(--tx-dim); }

/* Samples */
${s} .bs-samples { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; padding: 14px var(--pad-x) 16px; }
${s} .bs-sample { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--tx-rule); border-radius: var(--radius-md); background: var(--tx-panel-alt); overflow: hidden; }
${s} .bs-sample-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--tx-rule); font-size: var(--t-xs); }
${s} .bs-sample-title { color: var(--tx-mid); }
${s} .bs-tag { font-weight: 650; text-align: right; }
${s} .bs-sample.tone-good .bs-tag { color: var(--tx-good); }
${s} .bs-sample.tone-bad .bs-tag { color: var(--tx-bad); }
${s} .bs-sample.tone-good { box-shadow: inset 3px 0 0 var(--tx-good); }
${s} .bs-sample.tone-bad { box-shadow: inset 3px 0 0 var(--tx-bad); }
${s} .bs-cards { list-style: none; margin: 0; padding: 6px 0; }
${s} .bs-card { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 3px 12px; font-size: var(--t-xs); line-height: 1.5; }
${s} .bs-card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${s} .bs-card .card-ref { color: var(--tx-text); }
${s} .bs-card.is-miss .card-ref { color: var(--tx-dim); text-decoration-color: transparent; }
${s} .bs-card.is-miss .bs-dot { opacity: 0.45; }
${s} .bs-card.is-star { background: var(--good-soft); }
${s} .bs-card.is-star .card-ref { color: var(--tx-bright); font-weight: 600; }
${s} .bs-card-mv { font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-mid); }
${s} .bs-fate { font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; text-align: right; min-width: 64px; }
${s} .bs-card.is-hit .bs-fate { color: var(--tx-mid); }
${s} .bs-card.is-star .bs-fate { color: var(--tx-good); font-weight: 600; }
${s} .bs-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }
${s} .bs-more { margin: 0; padding: 2px 12px 6px 28px; font-size: var(--t-label); color: var(--tx-dim); }
${s} .bs-sample-foot { margin-top: auto; padding: 8px 12px; border-top: 1px solid var(--tx-rule); font-size: var(--t-xs); line-height: 1.5; color: var(--tx-mid); }
${s} .bs-sample-foot strong { color: var(--tx-bright); font-weight: 600; }

/* Bars */
${s} .bs-bars { list-style: none; margin: 0; padding: 14px 18px; display: grid; gap: 8px; }
${s} .bs-bar-row { display: grid; grid-template-columns: minmax(110px, 1.1fr) minmax(60px, 2fr) 48px; align-items: center; gap: 12px; font-size: var(--t-sm); }
${s} .bs-bar-row.is-current .bs-bar-label { color: var(--tx-bright); font-weight: 600; }
${s} .bs-bar-label { color: var(--tx-mid); }
${s} .bs-bar-note { grid-column: 1 / -1; margin-top: -4px; font-size: var(--t-label); color: var(--tx-dim); }
${s} .bs-bar { height: 8px; border-radius: var(--radius-full); background: var(--tx-rule); overflow: hidden; }
${s} .bs-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--tx-flat); transition: width var(--transition-slow); }
${s} .bs-bar.tone-good > span { background: var(--tx-good); }
${s} .bs-bar.tone-warn > span { background: var(--tx-warn); }
${s} .bs-bar.tone-bad > span { background: var(--tx-bad); }
${s} .bs-bar.tone-accent > span { background: var(--tx-accent); }
${s} .bs-bar-value { font-family: var(--font-mono); font-size: var(--t-xs); text-align: right; color: var(--tx-bright); }

/* Details */
${s} .bs-details > .tx-collapse:first-of-type { border-top: 0; }
${s} .bs-details .tx-collapse-head {
    padding: 13px 18px; font-size: var(--t-sm); font-weight: 600; letter-spacing: 0; text-transform: none;
    color: var(--tx-text); background: transparent;
}
${s} .bs-details .tx-collapse-head::before {
    content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 12px 2px 2px;
    border-right: 1.5px solid var(--tx-dim); border-bottom: 1.5px solid var(--tx-dim);
    transform: rotate(-45deg); transition: transform var(--transition-fast);
}
${s} .bs-details .tx-collapse[open] > .tx-collapse-head::before { content: ''; transform: rotate(45deg); }
${s} .bs-details .tx-collapse-head:hover::before { border-color: var(--tx-accent); }
${s} .bs-details .tx-collapse-head .bs-sub { margin-left: 6px; font-weight: 400; color: var(--tx-dim); }
${s} .bs-details .tx-collapse-body { max-height: none; overflow: visible; padding: 0 0 8px; }
${s} .bs-details .tx-collapse-body > .bs-caption { padding-top: 0; }
${s} .bs-table-wrap { overflow-x: auto; }
${s} .bs-table-wrap .tx-sweep-table td,
${s} .bs-table-wrap .tx-sweep-table th { white-space: nowrap; }

/* How it compares */
${s} .bsc-lead { margin: 0; padding: 14px 18px 4px; font-size: var(--t-sm); line-height: 1.55; color: var(--tx-text); }
${s} .bsc-lead strong { color: var(--tx-bright); }
${s} .bsc-list { list-style: none; margin: 0; padding: 8px 18px 6px; display: grid; }
${s} .bsc-row {
    display: grid; grid-template-columns: minmax(0, 1.5fr) 92px minmax(0, 2.2fr); gap: 4px 16px; align-items: center;
    padding: 9px 0; border-bottom: 1px solid var(--tx-rule); font-size: var(--t-sm);
}
${s} .bsc-row:last-child { border-bottom: 0; }
${s} .bsc-name { min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--tx-text); }
${s} .bsc-name .card-ref { color: inherit; }
${s} .bsc-row.is-current .bsc-name { color: var(--tx-bright); font-weight: 600; }
${s} .bsc-badge { font-size: var(--t-label); font-weight: 500; padding: 1px 7px; border-radius: var(--radius-full); border: 1px solid var(--tx-rule-hi); color: var(--tx-dim); white-space: nowrap; }
${s} .bsc-row.is-current .bsc-badge { border-color: var(--tx-accent); color: var(--tx-accent); }
${s} .bsc-cast { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-mid); white-space: nowrap; }
${s} .bsc-result { display: grid; grid-template-columns: minmax(48px, 2fr) minmax(0, 3fr); gap: 12px; align-items: center; min-width: 0; }
${s} .bsc-result .bs-bar > span { background: var(--tx-flat); }
${s} .bsc-row.is-current .bsc-result .bs-bar > span { background: var(--tx-accent); }
${s} .bsc-value { font-size: var(--t-xs); line-height: 1.4; color: var(--tx-mid); }
${s} .bsc-value strong { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--tx-bright); font-weight: 600; }
${s} .bsc-note { margin: 0; padding: 10px 18px 14px; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); border-top: 1px solid var(--tx-rule); }
${s} .bsc-empty { margin: 0; padding: 16px 18px; font-size: var(--t-sm); color: var(--tx-dim); }

/* Narrow: lead with the answer, then the controls */
@container shell (max-width: 1039.98px) {
    ${s} .bs-answer { order: -1; }
}
@container shell (max-width: 560px) {
    ${s} .bs-samples { grid-template-columns: minmax(0, 1fr); }
    ${s} .bsc-row { grid-template-columns: minmax(0, 1fr) auto; }
    ${s} .bsc-result { grid-column: 1 / -1; }
    ${s} .bs-bar-row { grid-template-columns: minmax(92px, 1fr) minmax(48px, 1.4fr) 44px; gap: 10px; }
    ${s} .bs-chart { height: 230px; padding-inline: 8px; }
    ${s} .bs-field { padding: 14px var(--pad-x); }
}
`;
}
