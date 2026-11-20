/**
 * Reusable UI Components
 * Creates and manages reusable UI elements
 */

import { renderDistributionChart } from './sampleSimulator.js';
import { hasCardList } from './deckConfig.js';

/**
 * Render a horizontal hero-stat row (the big terminal numerics used across the
 * site for a calculator's headline metrics). Mirrors Portent's hero block so
 * every calculator leads with its key numbers in the same visual language.
 *
 * @param {Array<{label:string, value:string|number, sub?:string, color?:string, size?:'big'|'medium', tip?:string, term?:string}>} stats
 *   tip: plain-text explanation shown on hover/focus of the label
 *   term: a GLOSSARY key (js/data/glossary.js) — shows its definition instead
 * @returns {string} - HTML string
 */
export function renderHeroStats(stats) {
    if (!Array.isArray(stats) || stats.length === 0) return '';
    const label = s => {
        const text = s.label ?? '';
        if (s.term) return `<span class="term" data-term="${s.term}" tabindex="0">${text}</span>`;
        if (s.tip) return `<span class="term" data-tip="${String(s.tip).replace(/"/g, '&quot;')}" tabindex="0">${text}</span>`;
        return text;
    };
    const cells = stats.map(s => `
        <div class="tx-stat">
            <div class="tx-stat-label">${label(s)}</div>
            <div class="tx-stat-value ${s.size === 'big' ? '' : 'medium'}" style="color:${s.color || 'var(--tx-bright)'};">${s.value ?? '—'}</div>
            <div class="tx-stat-sub">${s.sub ?? ''}</div>
        </div>`).join('');
    return `<div class="tx-hero">${cells}</div>`;
}

/**
 * The plain-language answer to a calculator's question, shown first.
 *
 * Every calculator leads with one or two sentences a player could repeat at
 * the table ("Genesis Wave at X=8 usually puts 4–6 permanents into play and
 * pays for itself 3 times in 4"), with the numbers bolded. Tone colours the
 * marker by what the answer MEANS, never decoration.
 *
 * @param {Object} opts
 * @param {string} opts.html - the sentence(s); may contain <strong>, term(), cardRef()
 * @param {'good'|'warn'|'bad'|'flat'} [opts.tone='flat']
 * @param {string} [opts.label='Bottom line']
 * @returns {string}
 */
export function renderBottomLine({ html, tone = 'flat', label = 'Bottom line' } = {}) {
    if (!html) return '';
    const icon = { good: '✓', warn: '!', bad: '✕', flat: '→' }[tone] ?? '→';
    return `
        <div class="bottom-line tone-${tone}" role="status">
            <span class="bottom-line-icon" aria-hidden="true">${icon}</span>
            <p class="bottom-line-text"><span class="bottom-line-label">${label}</span>${html}</p>
        </div>`;
}

/**
 * Render a verdict pill (e.g. STRONG / FAIR / WEAK) from an analysis verdict object.
 * @param {{label:string, color:string}} verdict
 * @returns {string}
 */
export function renderVerdictBadge(verdict) {
    if (!verdict) return '';
    return `<span class="tx-verdict" style="color:${verdict.color}; border-color:${verdict.color};">${verdict.label}</span>`;
}

/**
 * Render a one-line recommendation banner (terminal note with a leading marker).
 * @param {string} html - Inner HTML/text of the recommendation
 * @param {Object} [opts]
 * @param {string} [opts.icon='★'] - Leading marker
 * @param {string} [opts.accent='var(--tx-amber)'] - Marker color
 * @returns {string}
 */
export function renderRecommendation(html, opts = {}) {
    const { icon = '★', accent = 'var(--tx-amber)' } = opts;
    return `<div class="tx-rec"><span class="tx-rec-icon" style="color:${accent};">${icon}</span><span>${html}</span></div>`;
}

/**
 * Build an inline probability bar cell (for sweep tables).
 * @param {number} fraction - 0..1
 * @param {string} [color='var(--tx-green)']
 * @returns {string}
 */
export function pBarCell(fraction, color = 'var(--tx-green)') {
    const pct = Math.max(0, Math.min(100, (Number.isFinite(fraction) ? fraction : 0) * 100));
    return `<span class="tx-p-bar"><span class="tx-p-fill" style="width:${pct.toFixed(1)}%; background:${color};"></span></span>`;
}

/**
 * Render a parameter-sweep table (the Portent-style "step response" view) into a
 * container. Column-config driven so each calculator can describe its own metrics
 * while sharing the same look, hover/active/recommended highlighting, and tnum
 * alignment.
 *
 * @param {string} elementId - Container element id (a div; existing <table> ids are replaced)
 * @param {Object} opts
 * @param {Array<{label:string, render:(row:Object, ctx:Object)=>string, align?:'left'|'right'}>} opts.columns
 * @param {Array<Object>} opts.rows - Row objects; each must expose `x`
 * @param {number} [opts.current] - x value to mark as the active row
 * @param {number} [opts.recommended] - x value to flag with the recommendation rail
 * @param {string} [opts.emptyText] - Shown when there are no rows
 */
export function renderSweepTable(elementId, opts = {}) {
    const container = document.getElementById(elementId);
    if (!container) return;

    const { columns = [], rows = [], current = null, recommended = null, emptyText = 'Import a deck or adjust inputs to populate.' } = opts;

    if (!Array.isArray(rows) || rows.length === 0) {
        container.innerHTML = `<div class="tx-empty">${emptyText}</div>`;
        return;
    }

    const headCells = columns.map(c => `<th class="${c.align === 'left' ? 'ta-l' : ''}">${c.label}</th>`).join('');

    const bodyRows = rows.map(row => {
        const isCurrent = current != null && row.x === current;
        const isRec = recommended != null && row.x === recommended;
        const rowClass = [isCurrent ? 'active-row' : '', isRec ? 'rec-row' : ''].filter(Boolean).join(' ');
        const ctx = { isCurrent, isRec };
        const tds = columns.map(c => `<td class="${c.align === 'left' ? 'ta-l' : ''}">${c.render(row, ctx)}</td>`).join('');
        return `<tr class="${rowClass}">${tds}</tr>`;
    }).join('');

    container.innerHTML = `<table class="tx-sweep-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * Render a 2x2 outcome matrix — the confusion-matrix view of a decision rule.
 *
 * Four separate tinted boxes hide the thing that actually matters: whether the
 * strategy's calls line up with reality. Laying the same four numbers out as a
 * matrix puts agreement on the diagonal, so accuracy is readable at a glance and
 * the two failure modes sit opposite each other.
 *
 * @param {Object} opts
 * @param {string} [opts.title] - Section title
 * @param {string} [opts.subtitle] - Right-aligned context (e.g. sample size)
 * @param {[string, string]} opts.rowLabels - Labels for the decision axis
 * @param {[string, string]} opts.colLabels - Labels for the outcome axis
 * @param {Array<Array<{label:string, value:number, note?:string, good?:boolean}>>} opts.cells
 *        2x2 grid of cells; `value` is a fraction in 0..1
 * @returns {string} - HTML string
 */
export function renderOutcomeMatrix(opts = {}) {
    const { title = '', subtitle = '', rowLabels = ['', ''], colLabels = ['', ''], cells = [] } = opts;
    if (cells.length !== 2 || cells.some(r => !Array.isArray(r) || r.length !== 2)) return '';

    const pct = (v) => `${((Number.isFinite(v) ? v : 0) * 100).toFixed(1)}%`;

    // Agreement sits on the diagonal: correct-keep and correct-mull.
    const accuracy = (cells[0][0]?.value ?? 0) + (cells[1][1]?.value ?? 0);

    const cellHTML = (cell) => {
        if (!cell) return '<td class="tx-mx-cell"></td>';
        const color = cell.good ? 'var(--tx-green)' : 'var(--tx-red)';
        return `
            <td class="tx-mx-cell ${cell.good ? 'is-good' : 'is-bad'}">
                <div class="tx-mx-mark" style="color:${color};">${cell.good ? '✓' : '✗'}</div>
                <div class="tx-mx-label">${cell.label ?? ''}</div>
                <div class="tx-mx-value" style="color:${color};">${pct(cell.value)}</div>
                ${pBarCell(cell.value, color)}
                ${cell.note ? `<div class="tx-mx-note">${cell.note}</div>` : ''}
            </td>`;
    };

    return `
        <div class="tx-matrix">
            <div class="tx-h">
                <span>${title}</span>
                <span class="tx-h-r">${subtitle}</span>
            </div>
            <table class="tx-mx-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>${colLabels[0]}</th>
                        <th>${colLabels[1]}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><th class="tx-mx-rowlabel">${rowLabels[0]}</th>${cellHTML(cells[0][0])}${cellHTML(cells[0][1])}</tr>
                    <tr><th class="tx-mx-rowlabel">${rowLabels[1]}</th>${cellHTML(cells[1][0])}${cellHTML(cells[1][1])}</tr>
                </tbody>
            </table>
            <div class="tx-mx-foot">
                <span>STRATEGY ACCURACY</span>
                <span class="tx-mx-acc">${pct(accuracy)}</span>
                <span class="tx-mx-foot-note">agreement between the rule's call and the outcome</span>
            </div>
        </div>
    `;
}

/**
 * Render a calculator's simulation summary.
 *
 * Every calculator previously hand-rolled this block with its own inline styles,
 * its own heading level, and its own metric grid — so the same information was
 * laid out differently on each tab, and several calculators showed no shape of
 * the results at all, only averages. This renders the one standard structure:
 *
 *   header (with run count) -> headline metrics -> distribution -> outcomes
 *
 * The distribution is the important part: an average tells you where the middle
 * is, but not whether the spread is tight or bimodal, which is what actually
 * decides whether a card is worth running.
 *
 * @param {Object} opts
 * @param {string} [opts.title='Simulation summary']
 * @param {number} [opts.runs] - Number of simulations; shown in the header
 * @param {Array<{label:string, value:string|number, sub?:string, color?:string}>} [opts.metrics]
 * @param {{title?:string, counts:number[], totalSims:number, labelFn:Function, markerFn?:Function}} [opts.distribution]
 * @param {Array<{label:string, value:number, good?:boolean}>} [opts.outcomes] - value is a fraction 0..1
 * @returns {string} HTML
 */
export function renderSimulationSummary(opts = {}) {
    const {
        title = 'Simulation summary',
        runs = null,
        metrics = [],
        distribution = null,
        outcomes = []
    } = opts;

    const runLabel = Number.isFinite(runs) ? `${runs.toLocaleString('en-US')} runs` : '';

    const metricsHTML = metrics.length ? `
        <div class="tx-sim-metrics">
            ${metrics.map(m => `
                <div class="tx-sim-metric">
                    <div class="tx-sim-metric-label">${m.label ?? ''}</div>
                    <div class="tx-sim-metric-value" style="color:${m.color || 'var(--tx-bright)'};">${m.value ?? '—'}</div>
                    ${m.sub ? `<div class="tx-sim-metric-sub">${m.sub}</div>` : ''}
                </div>`).join('')}
        </div>` : '';

    let distHTML = '';
    if (distribution && typeof distribution.html === 'string') {
        distHTML = `
            <div class="tx-sim-block">
                <div class="tx-sim-block-title">${distribution.title ?? 'Distribution'}</div>
                ${distribution.html}
            </div>`;
    } else if (distribution && Array.isArray(distribution.counts) && distribution.totalSims > 0) {
        const { counts, totalSims, labelFn, markerFn = () => null, toneFn = null, title: distTitle = 'Distribution' } = distribution;
        distHTML = `
            <div class="tx-sim-block">
                <div class="tx-sim-block-title">${distTitle}</div>
                ${renderDistributionChart(counts, totalSims, labelFn, markerFn, toneFn)}
            </div>`;
    }

    const outcomesHTML = outcomes.length ? `
        <div class="tx-sim-block">
            <div class="tx-sim-block-title">Outcomes</div>
            <div class="tx-sim-outcomes">
                ${outcomes.map(o => {
                    const v = Number.isFinite(o.value) ? o.value : 0;
                    const color = o.good === false ? 'var(--tx-bad)' : (o.good ? 'var(--tx-good)' : 'var(--tx-mid)');
                    const mark = o.good === false ? '✗' : (o.good ? '✓' : '·');
                    return `
                        <div class="tx-sim-outcome">
                            <span class="tx-sim-outcome-mark" style="color:${color};">${mark}</span>
                            <span class="tx-sim-outcome-label">${o.label ?? ''}</span>
                            ${pBarCell(v, color)}
                            <span class="tx-sim-outcome-value" style="color:${color};">${(v * 100).toFixed(1)}%</span>
                        </div>`;
                }).join('')}
            </div>
        </div>` : '';

    if (!metricsHTML && !distHTML && !outcomesHTML) return '';

    return `
        <div class="tx-sim">
            <div class="tx-h"><span>${title}</span><span class="tx-h-r">${runLabel}</span></div>
            ${metricsHTML}
            ${distHTML}
            ${outcomesHTML}
        </div>`;
}

/**
 * Render an insight/interpretation box
 * @param {string} title - Title (e.g. "Analysis")
 * @param {string} content - Main content
 * @param {string} footer - Optional footer text
 * @returns {string} - HTML string
 */
export function renderInsightBox(title, content, footer = '') {
    return `
        <div class="insight-box">
            ${title ? `<h3>${title}</h3>` : ''}
            <div class="insight-body">${content}</div>
            ${footer ? `<div class="insight-foot">${footer}</div>` : ''}
        </div>
    `;
}

/**
 * Generate the HTML for the Sample Reveals section
 * @param {string} prefix - ID prefix (e.g., 'portent')
 * @param {string} title - Section title (e.g., 'Sample Portent Reveals')
 * @param {Object} options - Options { requiresImport: boolean }
 * @returns {string} - HTML string
 */
export function generateSampleRevealsHTML(prefix, title, options = {}) {
    // Simulations need real card records. Decided at render time (pages mount
    // lazily, after any import) and kept in sync by main.js on deck changes.
    const { requiresImport = true } = options;
    const locked = requiresImport && !hasCardList();

    return `
        <div class="tx-h"><span>${title}</span></div>
        <div class="tx-sim-controls">
            <label for="${prefix}-sample-count">Simulations</label>
            <input type="number" id="${prefix}-sample-count" min="1" max="10000" value="500">
            <button id="${prefix}-draw-reveals-btn" class="import-btn run-sim-btn"${requiresImport ? ' data-requires-import' : ''}${locked ? ' disabled' : ''}>Run simulations</button>
            ${requiresImport ? `<span class="sim-import-note"${locked ? '' : ' hidden'}>Import a decklist to enable</span>` : ''}
            <span class="tx-sim-controls-hint">1–10,000</span>
        </div>
        <div id="${prefix}-reveals-display"></div>
    `;
}
