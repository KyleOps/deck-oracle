/**
 * Reusable UI Components
 * Creates and manages reusable UI elements
 */

import { renderDistributionChart } from './sampleSimulator.js';

/**
 * Render a single statistic card
 * @param {string} label - Top label (e.g. "Expected Permanents")
 * @param {string} value - Main value (e.g. "4.5")
 * @param {string} subtext - Bottom text (e.g. "played for free")
 * @param {string} color - Color for the value (optional)
 * @returns {string} - HTML string
 */
export function renderStatCard(label, value, subtext, color = 'var(--text-light)') {
    return `
        <div class="stat-card">
            <div style="color: var(--text-dim); font-size: 0.9em; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
            <div style="font-size: 1.8em; font-weight: bold; color: ${color}; line-height: 1.2;">${value}</div>
            <div style="color: var(--text-secondary); font-size: 0.8em;">${subtext}</div>
        </div>
    `;
}

/**
 * Render a horizontal hero-stat row (the big terminal numerics used across the
 * site for a calculator's headline metrics). Mirrors Portent's hero block so
 * every calculator leads with its key numbers in the same visual language.
 *
 * @param {Array<{label:string, value:string|number, sub?:string, color?:string, size?:'big'|'medium'}>} stats
 * @returns {string} - HTML string
 */
export function renderHeroStats(stats) {
    if (!Array.isArray(stats) || stats.length === 0) return '';
    const cells = stats.map(s => `
        <div class="tx-stat">
            <div class="tx-stat-label">${s.label ?? ''}</div>
            <div class="tx-stat-value ${s.size === 'big' ? '' : 'medium'}" style="color:${s.color || 'var(--tx-bright)'};">${s.value ?? '—'}</div>
            <div class="tx-stat-sub">${s.sub ?? ''}</div>
        </div>`).join('');
    return `<div class="tx-hero">${cells}</div>`;
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
    if (distribution && Array.isArray(distribution.counts) && distribution.totalSims > 0) {
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
 * Render a grid of stat cards
 * @param {Array<string>} cardsHTML - Array of HTML strings from renderStatCard
 * @returns {string} - HTML string
 */
export function renderStatsGrid(cardsHTML) {
    return `
        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 12px; margin-bottom: 16px;">
            ${cardsHTML.join('')}
        </div>
    `;
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
            <div style="margin-bottom: 8px;">${content}</div>
            ${footer ? `<div style="color: var(--text-secondary); font-size: 0.9em; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; margin-top: 8px;">${footer}</div>` : ''}
        </div>
    `;
}

/**
 * Create a collapsible panel
 * @param {string} id - Panel ID
 * @param {string} title - Panel title
 * @param {HTMLElement} content - Content element
 * @param {boolean} startOpen - Whether to start expanded
 * @returns {HTMLElement} - Panel element
 */
export function createCollapsiblePanel(id, title, content, startOpen = true) {
    const panel = document.createElement('section');
    panel.className = `panel collapsible-panel${startOpen ? ' expanded' : ''}`;
    panel.id = id;

    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `
        <h2>${title}</h2>
        <button class="collapse-btn" aria-label="Toggle section">
            <span class="collapse-icon">${startOpen ? '▼' : '▶'}</span>
        </button>
    `;

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'panel-content';
    contentWrapper.appendChild(content);

    panel.appendChild(header);
    panel.appendChild(contentWrapper);

    // Add click handler
    header.addEventListener('click', () => togglePanel(panel));

    return panel;
}

/**
 * Toggle a collapsible panel
 * @param {HTMLElement} panel - Panel element
 */
export function togglePanel(panel) {
    const isExpanded = panel.classList.contains('expanded');
    const icon = panel.querySelector('.collapse-icon');

    panel.classList.toggle('expanded');
    if (icon) {
        icon.textContent = isExpanded ? '▶' : '▼';
    }

    // Save state to localStorage
    if (panel.id) {
        localStorage.setItem(`panel-${panel.id}`, !isExpanded);
    }
}

/**
 * Restore panel states from localStorage
 */
export function restorePanelStates() {
    document.querySelectorAll('.collapsible-panel').forEach(panel => {
        if (panel.id) {
            const savedState = localStorage.getItem(`panel-${panel.id}`);
            if (savedState === 'false') {
                togglePanel(panel);
            }
        }
    });
}

/**
 * Initialize all collapsible panels
 */
export function initCollapsiblePanels() {
    document.querySelectorAll('.panel-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't toggle if clicking on icon buttons (theme, nav, share toggles)
            if (e.target.closest('.icon-btn') && !e.target.closest('.collapse-btn')) {
                return;
            }
            const panel = header.closest('.collapsible-panel');
            if (panel) {
                togglePanel(panel);
            }
        });
    });

    // Restore saved states
    restorePanelStates();
}

/**
 * Generate the HTML for the Sample Reveals section
 * @param {string} prefix - ID prefix (e.g., 'portent')
 * @param {string} title - Section title (e.g., 'Sample Portent Reveals')
 * @param {Object} options - Options { requiresImport: boolean }
 * @returns {string} - HTML string
 */
export function generateSampleRevealsHTML(prefix, title, options = {}) {
    const { requiresImport = true } = options;
    
    return `
        <div class="tx-h"><span>${title}</span></div>
        <div class="tx-sim-controls">
            <label for="${prefix}-sample-count">Simulations</label>
            <input type="number" id="${prefix}-sample-count" min="1" max="10000" value="500">
            <button id="${prefix}-draw-reveals-btn" class="import-btn run-sim-btn" ${requiresImport ? 'disabled' : ''}>Run simulations</button>
            ${requiresImport ? `<span class="sim-import-note">Import a deck to enable</span>` : ''}
            <span class="tx-sim-controls-hint">1–10,000</span>
        </div>
        <div id="${prefix}-reveals-display"></div>
    `;
}
