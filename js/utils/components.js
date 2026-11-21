/**
 * Reusable UI Components
 * Creates and manages reusable UI elements
 */


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
            <p class="bottom-line-text" elementtiming="bottom-line"><span class="bottom-line-label">${label}</span>${html}</p>
        </div>`;
}

/**
 * What a chance the player wants to be high means: 'good' at or above
 * `good`, 'warn' at or above `warn`, else 'bad' ('flat' for no number).
 * @param {number} p - 0..1
 * @param {{good?:number, warn?:number}} [cuts]
 * @returns {'good'|'warn'|'bad'|'flat'}
 */
export function toneFor(p, { good = 0.7, warn = 0.4 } = {}) {
    if (typeof p !== 'number' || !Number.isFinite(p)) return 'flat';
    if (p >= good) return 'good';
    if (p >= warn) return 'warn';
    return 'bad';
}

const TONE_COLORS = Object.freeze({ good: 'var(--tx-good)', warn: 'var(--tx-warn)', bad: 'var(--tx-bad)' });

/**
 * The colour token for a tone: good / warn / bad carry meaning; anything else
 * (flat, unknown) is the plain bright text colour.
 * @param {string} tone
 * @returns {string} a CSS var()
 */
export function toneColor(tone) {
    return TONE_COLORS[tone] ?? 'var(--tx-bright)';
}

/**
 * Build an inline probability bar cell (for sweep tables). The default colour
 * is neutral: a bar only turns good / warn / bad when the caller says what the
 * number means (`toneColor(toneFor(p))`).
 * @param {number} fraction - 0..1
 * @param {string} [color='var(--tx-flat)']
 * @returns {string}
 */
export function pBarCell(fraction, color = 'var(--tx-flat)') {
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
