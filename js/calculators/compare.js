/**
 * Compare Decks — two saved decks, or two versions of one deck, side by side.
 * Logic lives in utils/deckCompare.js; this module owns the pickers and render.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import * as Library from '../utils/deckLibrary.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { compareDecks, summarizeComparison } from '../utils/deckCompare.js';
import { renderBottomLine } from '../utils/components.js';
import { DEFAULT_DECK_DATA } from '../utils/defaultDeckData.js';
import { escapeHtml, cardRef } from '../data/glossary.js';

const NAME = 'compare';
const CURRENT = 'current';
const EXAMPLE = 'example';

let selA = CURRENT;
let selB = null;

function exampleDeck() {
    return {
        name: 'Example — Doctor Whostoric',
        commanderName: DEFAULT_DECK_DATA.commanderName,
        cardsByName: DEFAULT_DECK_DATA.cardsByName,
        actualCardCount: DEFAULT_DECK_DATA.actualCardCount,
        counts: { lands: DEFAULT_DECK_DATA.lands }
    };
}

function currentIsExample(config) {
    return !config.deckId && config.importUrl === DeckConfig.DEFAULT_DECK_URL;
}

/** Every deck the user can pick, in display order. */
function options() {
    const config = DeckConfig.getDeckConfig();
    const opts = [{ value: CURRENT, label: `Current deck — ${config.deckName || config.commanderName || 'untitled'}` }];
    for (const d of Library.listDecks()) {
        if (d.id === config.deckId) continue;
        opts.push({ value: `lib:${d.id}`, label: `${d.name} · ${d.cardCount} cards` });
    }
    if (!currentIsExample(config)) opts.push({ value: EXAMPLE, label: 'Example deck — Doctor Whostoric' });
    return opts;
}

function resolve(value) {
    if (value === CURRENT) {
        const c = DeckConfig.getDeckConfig();
        return { ...c, name: c.deckName || c.commanderName || 'Current deck' };
    }
    if (value === EXAMPLE) return exampleDeck();
    if (value?.startsWith('lib:')) return Library.getDeck(value.slice(4));
    return null;
}

function syncPickers(opts) {
    const values = opts.map(o => o.value);
    if (!values.includes(selA)) selA = CURRENT;
    if (!selB || !values.includes(selB) || selB === selA) selB = values.find(v => v !== selA) ?? null;
    for (const [id, sel] of [['cmp-deck-a', selA], ['cmp-deck-b', selB]]) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.innerHTML = opts.map(o => `<option value="${escapeHtml(o.value)}"${o.value === sel ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        el.disabled = opts.length < 2;
    }
}

const fmtValue = (m, v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    switch (m.fmt) {
        case 'pct': return `${Math.round(v * 100)}%`;
        case 'dec2': return v.toFixed(2);
        case 'signed': return v > 0 ? `+${v}` : String(v);
        default: return String(Math.round(v));
    }
};

const fmtDelta = (m) => {
    if (m.delta === null || Math.abs(m.delta) < 1e-9) return '—';
    const sign = m.delta > 0 ? '+' : '−';
    const abs = Math.abs(m.delta);
    if (m.fmt === 'pct') { const pts = Math.round(abs * 100); return `${sign}${pts} pt${pts === 1 ? '' : 's'}`; }
    if (m.fmt === 'dec2') return `${sign}${abs.toFixed(2)}`;
    return `${sign}${Math.round(abs)}`;
};

function renderTable(result) {
    const rows = result.metrics.map(m => `
        <tr>
            <td>${m.hint ? `<span class="term" data-tip="${escapeHtml(m.hint)}" tabindex="0">${escapeHtml(m.label)}</span>` : escapeHtml(m.label)}</td>
            <td class="${m.winner === 'A' ? 'is-win' : ''}">${fmtValue(m, m.a)}</td>
            <td class="${m.winner === 'B' ? 'is-win' : ''}">${fmtValue(m, m.b)}</td>
            <td><span class="cmp-delta${m.winner ? ` tone-better-${m.winner.toLowerCase()}` : ''}">${fmtDelta(m)}${m.winner ? ` · ${m.winner} better` : ''}</span></td>
        </tr>`).join('');
    return `
        <section class="cmp-card" aria-labelledby="cmp-table-title">
            <div class="cmp-card-head">
                <h3 class="cmp-card-title" id="cmp-table-title">Side by side</h3>
                <span class="cmp-card-meta">${escapeHtml(result.a.format.label)}${result.sameFormat ? '' : ` vs ${escapeHtml(result.b.format.label)}`}</span>
            </div>
            <table class="cmp-table">
                <thead><tr><th scope="col">Check</th><th scope="col">A</th><th scope="col">B</th><th scope="col">B − A</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </section>`;
}

function renderCurve(result) {
    const a = result.a.stats.curve.buckets;
    const b = result.b.stats.curve.buckets;
    // Compare shapes, not sizes: normalise each deck to its share of nonland cards.
    const share = (bucket, total) => (total > 0 ? bucket.total / total : 0);
    const totA = result.a.stats.curve.nonlandCount;
    const totB = result.b.stats.curve.nonlandCount;
    const max = Math.max(...a.map((x, i) => Math.max(share(x, totA), share(b[i], totB))), 0.01);
    const cols = a.map((x, i) => {
        const pa = share(x, totA);
        const pb = share(b[i], totB);
        return `
            <div class="cmp-col">
                <div class="cmp-pair">
                    <span class="cmp-bar cmp-bar-a" style="height:${(pa / max) * 100}%" data-tip="A: ${x.total} cards (${Math.round(pa * 100)}%) at ${x.mv}"></span>
                    <span class="cmp-bar cmp-bar-b" style="height:${(pb / max) * 100}%" data-tip="B: ${b[i].total} cards (${Math.round(pb * 100)}%) at ${x.mv}"></span>
                </div>
                <span class="cmp-col-label">${x.mv}</span>
            </div>`;
    }).join('');
    return `
        <section class="cmp-card" aria-labelledby="cmp-curve-title">
            <div class="cmp-card-head">
                <h3 class="cmp-card-title" id="cmp-curve-title">Mana curve</h3>
                <span class="cmp-card-meta">share of nonland cards at each mana value</span>
            </div>
            <div class="cmp-curve" role="img" aria-label="Mana curve comparison">${cols}</div>
            <div class="cmp-legend">
                <span><span class="cmp-dot cmp-dot-a"></span>A · average ${result.a.stats.curve.average.toFixed(2)}</span>
                <span><span class="cmp-dot cmp-dot-b"></span>B · average ${result.b.stats.curve.average.toFixed(2)}</span>
            </div>
        </section>`;
}

const LIST_LIMIT = 40;

function renderList(items, fmt) {
    if (items.length === 0) return '<p class="cmp-empty-note">None.</p>';
    const shown = items.slice(0, LIST_LIMIT).map(fmt).join('');
    const more = items.length > LIST_LIMIT ? `<li class="cmp-empty-note">…and ${items.length - LIST_LIMIT} more</li>` : '';
    return `<ul class="cmp-diff-list">${shown}${more}</ul>`;
}

function renderDiff(result) {
    const { onlyA, onlyB, changed, shared } = result.diff;
    return `
        <section class="cmp-card" aria-labelledby="cmp-diff-title">
            <div class="cmp-card-head">
                <h3 class="cmp-card-title" id="cmp-diff-title">Card differences</h3>
                <span class="cmp-card-meta">${shared} cards in common</span>
            </div>
            <div class="cmp-diff">
                <div class="cmp-diff-col">
                    <h4><span class="cmp-dot cmp-dot-a"></span>Only in A · ${onlyA.reduce((s, c) => s + c.count, 0)}</h4>
                    ${renderList(onlyA, c => `<li><span class="num">${c.count}</span>${cardRef(c.name)}</li>`)}
                </div>
                <div class="cmp-diff-col">
                    <h4><span class="cmp-dot cmp-dot-b"></span>Only in B · ${onlyB.reduce((s, c) => s + c.count, 0)}</h4>
                    ${renderList(onlyB, c => `<li><span class="num">${c.count}</span>${cardRef(c.name)}</li>`)}
                </div>
                <div class="cmp-diff-col">
                    <h4>Different copy counts · ${changed.length}</h4>
                    ${renderList(changed, c => `<li><span class="num">${c.a}→${c.b}</span>${cardRef(c.name)}</li>`)}
                </div>
            </div>
        </section>`;
}

function renderEmpty() {
    return `
        <div class="cmp-empty">
            <h3>Load a second deck to compare</h3>
            <p>Every deck you import is saved in this browser. Import another list — or a newer version of this one — and it appears in the pickers above.</p>
            <button class="btn btn-primary" type="button" data-cmp-load>Load a deck</button>
        </div>`;
}

export function calculate() {
    const deckA = resolve(selA);
    const deckB = resolve(selB);
    if (!deckA || !deckB) return null;
    return { result: compareDecks(deckA, deckB), nameA: deckA.name, nameB: deckB.name };
}

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    syncPickers(options());
    const body = document.getElementById('cmp-body');
    if (!body) return;
    const out = calculate();
    if (!out) {
        body.innerHTML = renderEmpty();
        return;
    }
    const { result, nameA, nameB } = out;
    const summary = summarizeComparison(result, { nameA: `A (${nameA})`, nameB: `B (${nameB})` });
    body.innerHTML = `
        <section class="cmp-card">${renderBottomLine({ html: summary.html, tone: summary.tone })}</section>
        ${renderTable(result)}
        ${renderCurve(result)}
        ${renderDiff(result)}`;
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    root?.addEventListener('change', e => {
        if (e.target.id === 'cmp-deck-a') selA = e.target.value;
        else if (e.target.id === 'cmp-deck-b') selB = e.target.value;
        else return;
        if (selA === selB) selB = options().map(o => o.value).find(v => v !== selA) ?? null;
        updateUI();
    });
    root?.addEventListener('click', e => {
        if (e.target.closest('#cmp-swap')) {
            [selA, selB] = [selB ?? selA, selA];
            updateUI();
        } else if (e.target.closest('[data-cmp-load]')) {
            document.getElementById('deck-switcher')?.click();
        }
    });
    registerCalculator({ name: NAME, updateUI });
    // Imports add decks to the library, which changes the pickers.
    DeckConfig.onDeckImport(() => updateUI());
}

export function getShareParams() {
    return {};
}
