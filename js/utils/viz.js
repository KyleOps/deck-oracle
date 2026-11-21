/**
 * Small shared visualisations — pure functions that return accessible HTML.
 *
 * Every chart here is plain HTML/CSS rather than a canvas: it themes from the
 * tokens in css/tokens.css for free (no hex anywhere), renders in well under a
 * frame, has its final size the moment it is inserted (no layout shift), and
 * needs no chart library. Each one carries its own text alternative — a
 * role="img" summary sentence plus the exact numbers in a table — so nothing
 * is only visible. Styles live in the "Visualisations" section of
 * css/components.css.
 *
 * Tones are what a result MEANS ('good' | 'warn' | 'bad' | 'flat'); the accent
 * only ever marks the selected, interactive thing.
 */

import { escapeHtml } from '../data/glossary.js';

/** @typedef {'good'|'warn'|'bad'|'flat'} Tone */

const TONE_RANK = Object.freeze({ bad: 0, warn: 1, flat: 2, good: 3 });
const TONES = Object.freeze(['good', 'warn', 'bad', 'flat']);
const toneOf = tone => (TONES.includes(tone) ? tone : 'flat');
const attr = value => escapeHtml(String(value ?? ''));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp01 = value => Math.min(1, Math.max(0, finite(Number(value))));

// ── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Split `total` whole units in proportion to `weights` (largest remainder), so
 * the parts always add up exactly — 100 dots are always 100 dots.
 * @param {number[]} weights - non-negative
 * @param {number} [total=100]
 * @returns {number[]}
 */
export function allocate(weights, total = 100) {
    const w = (weights ?? []).map(v => Math.max(0, finite(Number(v))));
    const sum = w.reduce((a, b) => a + b, 0);
    const n = Math.max(0, Math.round(finite(total)));
    if (w.length === 0) return [];
    if (sum <= 0 || n === 0) return w.map(() => 0);
    const exact = w.map(v => (v / sum) * n);
    const out = exact.map(Math.floor);
    let left = n - out.reduce((a, b) => a + b, 0);
    const order = exact.map((v, i) => ({ i, r: v - Math.floor(v) }))
        .sort((a, b) => b.r - a.r || a.i - b.i);
    for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
    return out;
}

/**
 * The values of `n` quantile dots for an exact distribution: dot i sits at the
 * ((i + ½) / n) quantile, so each dot stands for 1/n of all outcomes and the
 * top dot is a percentile, never the largest result possible.
 *
 * @param {number[]|Array<{value:number, p:number}>} pmf - probabilities by value
 *   (an array indexed by value, or explicit {value, p} pairs)
 * @param {number} [n=100]
 * @returns {number[]} ascending
 */
export function pmfQuantiles(pmf, n = 100) {
    const pairs = Array.isArray(pmf) && pmf.length && typeof pmf[0] === 'object'
        ? pmf.map(e => ({ value: Number(e?.value), p: Math.max(0, finite(Number(e?.p))) }))
        : Array.from(pmf ?? [], (p, value) => ({ value, p: Math.max(0, finite(Number(p))) }));
    const items = pairs.filter(e => Number.isFinite(e.value) && e.p > 0).sort((a, b) => a.value - b.value);
    const total = items.reduce((s, e) => s + e.p, 0);
    const count = Math.max(0, Math.floor(finite(n)));
    if (items.length === 0 || total <= 0 || count === 0) return [];
    const out = [];
    let k = 0;
    let cdf = items[0].p / total;
    for (let i = 0; i < count; i++) {
        const q = (i + 0.5) / count;
        while (cdf < q - 1e-12 && k < items.length - 1) {
            k += 1;
            cdf += items[k].p / total;
        }
        out.push(items[k].value);
    }
    return out;
}

/**
 * The values of `n` quantile dots for simulated outcomes (nearest rank). With
 * a few hundred samples or more, no dot is the single best or worst sample.
 * @param {number[]} samples
 * @param {number} [n=100]
 * @returns {number[]} ascending
 */
export function sampleQuantiles(samples, n = 100) {
    const sorted = (samples ?? []).filter(Number.isFinite).slice().sort((a, b) => a - b);
    const count = Math.max(0, Math.floor(finite(n)));
    if (sorted.length === 0 || count === 0) return [];
    return Array.from({ length: count }, (_, i) => {
        const rank = Math.floor(((i + 0.5) / count) * sorted.length);
        return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
    });
}

/**
 * Tone quantile dots that share a value by an exact share: e.g. of the 12 dots
 * at "5 permanents", the share of 5-permanent casts that paid for themselves.
 * The number of good dots is fixed (`goodTotal`, normally the count another
 * view of the same casts shows) and handed out by largest remainder, so two
 * views of one distribution always agree. Within a column misses sit at the
 * bottom.
 *
 * @param {number[]} values - quantile dot values, ascending
 * @param {(value:number) => number} goodShare - 0..1 for each distinct value
 * @param {number} [goodTotal] - defaults to the rounded expected count
 * @returns {Array<{value:number, tone:'good'|'bad'}>}
 */
export function splitDots(values, goodShare, goodTotal) {
    const list = (values ?? []).filter(Number.isFinite);
    const distinct = [...new Set(list)];
    const per = distinct.map(v => list.filter(x => x === v).length);
    const expected = distinct.map((v, i) => per[i] * clamp01(goodShare(v)));
    const target = Math.min(list.length, Math.max(0, Math.round(Number.isFinite(goodTotal) ? goodTotal : expected.reduce((a, b) => a + b, 0))));
    const good = allocate(expected, target).map((g, i) => Math.min(g, per[i]));
    // A capped column can leave a dot over; hand it to the highest values.
    let left = target - good.reduce((a, b) => a + b, 0);
    for (let i = distinct.length - 1; left > 0 && i >= 0; i--) {
        const add = Math.min(per[i] - good[i], left);
        good[i] += add;
        left -= add;
    }
    const dots = [];
    distinct.forEach((v, i) => {
        for (let j = 0; j < per[i]; j++) dots.push({ value: v, tone: j < per[i] - good[i] ? 'bad' : 'good' });
    });
    return dots;
}

/** A "nice" step at least `rough`: 1, 2, 2.5 or 5 × a power of ten. */
export function niceStep(rough) {
    if (!(rough > 0)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    for (const m of [1, 2, 2.5, 5, 10]) {
        if (m * magnitude >= rough - 1e-12) return m * magnitude;
    }
    return 10 * magnitude;
}

/**
 * Group dots into the columns of a dot plot.
 *
 * Whole-number outcomes with a small range get one column per value. Anything
 * else is binned at a nice width, aligned so the threshold (when given) is a
 * column boundary — a column never mixes "below" with "at or above".
 *
 * @param {Array<{value:number, tone?:Tone}>} dots
 * @param {{threshold?:number|null, maxColumns?:number}} [opts]
 * @returns {{discrete:boolean, width:number, origin:number, columns:Array<{index:number, start:number, end:number, dots:Array}>, thresholdIndex:number|null}}
 */
export function binDots(dots, { threshold = null, maxColumns = 30 } = {}) {
    const list = (dots ?? []).filter(d => Number.isFinite(d?.value));
    const empty = { discrete: true, width: 1, origin: 0, columns: [], thresholdIndex: null };
    if (list.length === 0) return empty;
    const cap = Math.max(4, Math.floor(finite(maxColumns, 30)));
    const values = list.map(d => d.value);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const hasThreshold = Number.isFinite(threshold);
    // Stretch the axis to show a nearby threshold; one far from every dot
    // would only add empty space (the legend still says "all 100 …").
    const reach = 0.35 * Math.max(hi - lo, 1);
    const showThreshold = hasThreshold && threshold >= lo - reach && threshold <= hi + reach;
    if (showThreshold) {
        lo = Math.min(lo, threshold);
        hi = Math.max(hi, threshold);
    }

    const integers = values.every(Number.isInteger);
    let discrete = integers && Math.ceil(hi) - Math.floor(lo) + 1 <= cap;
    let width;
    let origin;
    let count;
    if (discrete) {
        width = 1;
        origin = Math.floor(lo);
        count = Math.floor(hi) - origin + 1;
        // A whole-number threshold is the left edge of its own column.
        if (hasThreshold && !Number.isInteger(threshold)) discrete = false;
    }
    if (!discrete) {
        width = niceStep(Math.max(hi - lo, 1e-9) / (cap - 1));
        if (integers) width = Math.max(1, Math.ceil(width));
        origin = hasThreshold
            ? threshold - Math.ceil((threshold - lo) / width - 1e-9) * width
            : Math.floor(lo / width) * width;
        count = Math.max(1, Math.floor((hi - origin) / width + 1e-9) + 1);
    }

    const columns = Array.from({ length: count }, (_, index) => ({
        index,
        start: origin + index * width,
        end: origin + (index + 1) * width,
        dots: []
    }));
    for (const d of list) {
        const i = Math.min(count - 1, Math.max(0, Math.floor((d.value - origin) / width + 1e-9)));
        columns[i].dots.push(d);
    }
    for (const col of columns) {
        col.dots.sort((a, b) => a.value - b.value || TONE_RANK[toneOf(a.tone)] - TONE_RANK[toneOf(b.tone)]);
    }
    const thresholdIndex = showThreshold ? Math.round((threshold - origin) / width) : null;
    return { discrete, width, origin, columns, thresholdIndex };
}

/**
 * How many dots sit side by side in a column. A few wide columns with tall
 * stacks (everything lands on 5, 6 or 7) would otherwise draw thin spikes of
 * tiny dots; wrapping a stack into blocks keeps dots large and the plot short.
 * Many narrow columns keep single stacks so the shape stays a dot plot.
 * @param {number} tallest - dots in the fullest column
 * @param {number} cols
 * @returns {number}
 */
export function stackWidth(tallest, cols) {
    const want = Math.ceil(Math.max(1, tallest) / 16);
    const room = Math.max(1, Math.floor(64 / Math.max(1, cols)));
    return Math.max(1, Math.min(want, room, 6));
}

/** Which tick positions to label so the axis never crowds (at most ~`max`). */
function tickEvery(count, max = 9) {
    for (const k of [1, 2, 5, 10, 20, 25, 50, 100]) if (count / k <= max) return k;
    return Math.ceil(count / max);
}

function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

// ── Tables (the text alternative every chart carries) ────────────────────────

/**
 * A compact data table inside a closed <details>, for the exact numbers.
 * @param {{summary?:string, caption?:string, head:string[], rows:Array<Array<string|number>>}} t
 *   cells are HTML (escape text before passing it in)
 * @returns {string}
 */
export function vizTable({ summary = 'Show the numbers', caption = '', head = [], rows = [] } = {}) {
    if (!rows.length) return '';
    return `
        <details class="viz-table">
            <summary>${escapeHtml(summary)}</summary>
            <div class="viz-table-wrap">
                <table>
                    ${caption ? `<caption class="sr-only">${escapeHtml(caption)}</caption>` : ''}
                    <thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
                    <tbody>${rows.map(r => `<tr>${r.map((c, i) => (i ? `<td class="num">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody>
                </table>
            </div>
        </details>`;
}

// ── Quantile dot plot ────────────────────────────────────────────────────────

/**
 * "Out of 100 games": a quantile dot plot. Each dot is 1% of outcomes, stacked
 * by value and coloured by what the outcome means. Unlike a bar per value, the
 * dots can be counted ("about 30 of 100 whiff"), the whole spread is visible
 * without reading an axis of percentages, and the far tail is honest because
 * the last dot is the 99.5th percentile, not the best result ever sampled.
 *
 * Whiffs are drawn as rings and good outcomes as solid dots, so the split
 * survives colour blindness and greyscale.
 *
 * @param {Object} o
 * @param {Array<{value:number, tone?:Tone}>} o.dots - usually 100 (see pmfQuantiles / sampleQuantiles)
 * @param {string} o.label - accessible summary sentence (role="img" name)
 * @param {(v:number) => string} [o.format] - value text (axis, tips)
 * @param {string} [o.xLabel] - what the axis counts
 * @param {number|null} [o.threshold] - where the good outcome starts; drawn as a line
 * @param {string} [o.thresholdLabel] - e.g. "10+ pays for itself"
 * @param {Array<{tone:Tone, label:string}>} [o.legend] - one entry per tone; the dot count is prepended
 * @param {string} [o.unit='game'] - singular noun for one dot ("cast", "trigger")
 * @param {number} [o.maxColumns=30]
 * @param {(col:Object, ctx:Object) => string} [o.columnTip] - plain-text tooltip per column
 * @param {Object|null} [o.table] - vizTable() options for the exact numbers
 * @returns {string} HTML
 */
export function dotPlot(o = {}) {
    const dots = (o.dots ?? []).filter(d => Number.isFinite(d?.value));
    if (dots.length === 0) return '';
    const format = typeof o.format === 'function' ? o.format : v => String(v);
    const unit = o.unit ?? 'game';
    const units = o.unitPlural ?? `${unit}s`;
    const total = dots.length;
    const bins = binDots(dots, { threshold: o.threshold ?? null, maxColumns: o.maxColumns ?? 30 });
    const cols = bins.columns.length;
    const tallest = Math.max(1, ...bins.columns.map(c => c.dots.length));
    const per = stackWidth(tallest, cols);
    const rows = Math.ceil(tallest / per);

    const legend = (o.legend ?? [])
        .map(l => ({ ...l, tone: toneOf(l.tone), n: dots.filter(d => toneOf(d.tone) === toneOf(l.tone)).length }))
        .filter(l => l.n > 0);
    const legendLabel = tone => legend.find(l => l.tone === tone)?.label ?? tone;
    const rangeText = col => (bins.discrete ? format(col.start) : `${format(col.start)} to under ${format(col.end)}`);
    const tipFor = col => {
        if (typeof o.columnTip === 'function') return o.columnTip(col, { rangeText: rangeText(col), total, units });
        const byTone = TONES.map(t => ({ t, n: col.dots.filter(d => toneOf(d.tone) === t).length })).filter(x => x.n > 0);
        const split = byTone.length > 1 ? ` (${byTone.map(x => `${x.n} ${legendLabel(x.t)}`).join(', ')})` : '';
        return `${rangeText(col)}: ${col.dots.length} of ${total} ${units}${split}`;
    };

    const columnsHtml = bins.columns.map(col => {
        if (col.dots.length === 0) return '<div class="viz-dots-col" aria-hidden="true"></div>';
        const marks = col.dots.map(d => `<span class="viz-dot is-${toneOf(d.tone)}"></span>`).join('');
        return `<div class="viz-dots-col" data-tip="${attr(tipFor(col))}"><div class="viz-dots-stack">${marks}</div></div>`;
    }).join('');

    // Axis ticks: centred under whole-number columns, on the boundaries for bins.
    const ticks = [];
    if (bins.discrete) {
        const every = tickEvery(cols, 12);
        bins.columns.forEach((col, i) => {
            if (col.start % every === 0 || cols <= 12) ticks.push({ left: ((i + 0.5) / cols) * 100, text: format(col.start) });
        });
    } else {
        const every = tickEvery(cols + 1, 10);
        const step = bins.width * every;
        const round = i => Math.abs((bins.origin + i * bins.width) / step - Math.round((bins.origin + i * bins.width) / step)) < 1e-9;
        const indices = Array.from({ length: cols + 1 }, (_, i) => i);
        // Prefer round numbers; a threshold-aligned grid may have none, so fall
        // back to every n-th boundary from the threshold.
        let picked = indices.filter(round);
        if (picked.length < 3) {
            const anchor = bins.thresholdIndex ?? 0;
            picked = indices.filter(i => (i - anchor) % every === 0);
        }
        if (bins.thresholdIndex != null && !picked.includes(bins.thresholdIndex)) picked.push(bins.thresholdIndex);
        // Drop a label that would sit right on top of the threshold's.
        picked = picked.filter(i => i === bins.thresholdIndex || bins.thresholdIndex == null || Math.abs(i - bins.thresholdIndex) >= Math.max(1, every / 2));
        for (const i of picked.sort((x, y) => x - y)) {
            ticks.push({ left: (i / cols) * 100, text: format(bins.origin + i * bins.width), edge: i === 0 ? 'start' : i === cols ? 'end' : '' });
        }
    }
    const ticksHtml = ticks.map(t => `<span class="viz-dots-tick${t.edge ? ` is-${t.edge}` : ''}" style="left:${t.left.toFixed(3)}%">${escapeHtml(t.text)}</span>`).join('');

    let lineHtml = '';
    let lineLabelHtml = '';
    if (bins.thresholdIndex != null && bins.thresholdIndex >= 0 && bins.thresholdIndex <= cols) {
        const left = (bins.thresholdIndex / cols) * 100;
        lineHtml = `<span class="viz-dots-line" style="left:${left.toFixed(3)}%"></span>`;
        if (o.thresholdLabel) {
            lineLabelHtml = `<span class="viz-dots-line-label${left > 58 ? ' is-left' : ''}" style="left:${left.toFixed(3)}%">${escapeHtml(o.thresholdLabel)}</span>`;
        }
    }

    const legendHtml = legend.length ? `
        <ul class="viz-legend" aria-hidden="true">
            ${legend.map(l => `<li><span class="viz-dot is-${l.tone}"></span><strong>${l.n}</strong> ${escapeHtml(l.label)}</li>`).join('')}
        </ul>` : '';

    return `
        <figure class="viz viz-dots" style="--cols:${cols};--rows:${rows};--per:${per}">
            <div class="viz-dots-chart" role="img" aria-label="${attr(o.label ?? `${total} ${units}`)}">
                ${lineLabelHtml ? `<div class="viz-dots-head">${lineLabelHtml}</div>` : ''}
                <div class="viz-dots-plot">${columnsHtml}${lineHtml}</div>
                <div class="viz-dots-axis">${ticksHtml}</div>
                ${o.xLabel ? `<div class="viz-dots-xlabel">${escapeHtml(o.xLabel)}</div>` : ''}
            </div>
            ${legendHtml}
            ${o.table ? vizTable(o.table) : ''}
        </figure>`;
}

/**
 * The plain-text summary of a set of quantile dots: how many fall in each
 * tone, and where the middle and the middle 80% sit. Built from the dots, so
 * it can never disagree with the picture.
 *
 * @param {Array<{value:number, tone?:Tone}>} dots - ascending by value
 * @param {{unit?:string, format?:(v:number)=>string, legend?:Array<{tone:Tone,label:string}>}} [opts]
 * @returns {string}
 */
export function describeDots(dots, { unit = 'game', unitPlural, format = v => String(v), legend = [] } = {}) {
    const list = (dots ?? []).filter(d => Number.isFinite(d?.value));
    if (list.length === 0) return '';
    const units = unitPlural ?? `${unit}s`;
    const sorted = list.map(d => d.value).sort((a, b) => a - b);
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const parts = legend
        .map(l => ({ label: l.label, n: list.filter(d => toneOf(d.tone) === toneOf(l.tone)).length }))
        .filter(p => p.n > 0)
        .map(p => `${p.n} ${p.label}`);
    const lo = at(0.1);
    const hi = at(0.9);
    const spread = lo === hi ? `nearly all at ${format(lo)}` : `8 in 10 between ${format(lo)} and ${format(hi)}`;
    return `Out of ${list.length} ${units}${parts.length ? `: ${parts.join(', ')}` : ''}. Typical result ${format(at(0.5))}; ${spread}.`;
}

// ── Heat cells ───────────────────────────────────────────────────────────────

/**
 * A strip of small cells, one per turn, showing WHEN something becomes
 * reliable. Cells are tone-filled by what the chance means — a ring below
 * target, hatched when close, solid once reliable — so the strip reads as
 * "filling up" even without colour. Each cell's exact chance is in its tooltip
 * and in the accessible label.
 *
 * @param {Object} o
 * @param {Array<{label:string, value:number|null, tone?:Tone, current?:boolean, note?:string}>} o.cells
 *   value null = not possible yet (drawn as a dash)
 * @param {string} o.label - accessible name prefix, e.g. "Wan Shi Tong by turn"
 * @param {(p:number)=>string} [o.format]
 * @returns {string}
 */
export function heatStrip({ cells = [], label = '', format = p => `${Math.round(p * 100)}%` } = {}) {
    if (!cells.length) return '';
    const words = cells.map(c => `${c.label} ${c.value == null ? (c.note ?? 'not yet') : format(c.value)}`).join(', ');
    const items = cells.map(c => {
        if (c.value == null) return `<span class="viz-strip-cell is-none" data-tip="${attr(`${c.label}: ${c.note ?? 'not castable yet'}`)}"></span>`;
        const tone = toneOf(c.tone);
        return `<span class="viz-strip-cell is-${tone}${c.current ? ' is-current' : ''}" data-tip="${attr(`${c.label}: ${format(c.value)}${c.current ? ' (on curve)' : ''}`)}"></span>`;
    }).join('');
    return `<span class="viz-strip" role="img" aria-label="${attr(`${label}: ${words}`)}" style="--n:${cells.length}">${items}</span>`;
}

/**
 * The CSS value for a heat-map cell's intensity (0..1) — consumed by
 * .viz-heat-cell as `--heat`. Kept here so the mapping is tested.
 * Probabilities under 2% read as empty; the ramp is gentle at the bottom so
 * likely outcomes stand out.
 * @param {number} p
 * @returns {number} 0..1, three decimals
 */
export function heatLevel(p) {
    const v = clamp01(p);
    if (v < 0.02) return 0;
    return Math.round(Math.pow(v, 1.4) * 1000) / 1000;
}

// ── Bullet chart ─────────────────────────────────────────────────────────────

/**
 * One row of a bullet chart: a value bar against a shaded guideline range.
 * Range and scale are guidelines the caller states in `rangeTip` — never
 * presented as a rule.
 *
 * @param {Object} o
 * @param {string} o.label - row label (HTML allowed; escape text)
 * @param {number} o.value
 * @param {number} o.min - scale start
 * @param {number} o.max - scale end (values past it are drawn at the end)
 * @param {[number, number]|null} [o.range] - typical range (shaded)
 * @param {(v:number)=>string} [o.format]
 * @param {Tone} [o.tone='flat'] - what the value means (status text colour)
 * @param {string} [o.status] - short words after the value ("in range", "4 below")
 * @param {string} [o.tip] - plain text: what the metric is
 * @param {string} [o.rangeTip] - plain text: where the range comes from
 * @param {string} [o.sub] - one line under the bar (HTML)
 * @returns {string}
 */
export function bulletChart(o = {}) {
    const min = finite(o.min, 0);
    const max = Math.max(min + 1e-9, finite(o.max, 1));
    const format = typeof o.format === 'function' ? o.format : v => String(v);
    const value = finite(Number(o.value), min);
    const pos = v => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
    const tone = toneOf(o.tone);
    const range = Array.isArray(o.range) && o.range.every(Number.isFinite) ? o.range : null;
    const over = value > max;
    const aria = `${stripTags(o.label)}: ${format(value)}${range ? `; typical ${format(range[0])} to ${format(range[1])} (a guideline)` : ''}${o.status ? `; ${o.status}` : ''}`;
    const band = range
        ? `<span class="viz-bullet-band" style="left:${pos(range[0]).toFixed(2)}%;width:${Math.max(0.6, pos(range[1]) - pos(range[0])).toFixed(2)}%"${o.rangeTip ? ` data-tip="${attr(o.rangeTip)}"` : ''}></span>`
        : '';
    return `
        <div class="viz-bullet">
            <div class="viz-bullet-label">${o.tip ? `<span class="term" tabindex="0" data-tip="${attr(o.tip)}">${o.label}</span>` : o.label}</div>
            <div class="viz-bullet-track" role="img" aria-label="${attr(aria)}">
                ${band}
                <span class="viz-bullet-bar${over ? ' is-over' : ''}" style="width:${pos(value).toFixed(2)}%"></span>
                <span class="viz-bullet-mark" style="left:${pos(value).toFixed(2)}%"></span>
            </div>
            <div class="viz-bullet-value"><strong>${escapeHtml(format(value))}</strong>${o.status ? `<span class="viz-bullet-status tone-${tone}">${escapeHtml(o.status)}</span>` : ''}</div>
            ${o.sub ? `<div class="viz-bullet-sub">${o.sub}</div>` : ''}
        </div>`;
}

/**
 * Several bullet rows sharing one set of columns, so every track starts and
 * ends at the same x and the rows read as one chart.
 * @param {Array<Object>} rows - bulletChart() options
 * @returns {string}
 */
export function bulletList(rows = []) {
    if (!rows.length) return '';
    return `<div class="viz-bullets"><div class="viz-bullets-grid">${rows.map(bulletChart).join('')}</div></div>`;
}

// ── Dumbbell ─────────────────────────────────────────────────────────────────

/**
 * Two values on one scale joined by a line — deck A vs deck B for a metric.
 * The end that is better for the player is filled; the other is a ring. With
 * no "better" direction both ends are neutral.
 *
 * @param {Object} o
 * @param {number} o.a
 * @param {number} o.b
 * @param {number} o.min
 * @param {number} o.max
 * @param {'higher'|'lower'|null} [o.better]
 * @param {'A'|'B'|null} [o.winner] - overrides `better` when the caller has judged it
 * @param {(v:number)=>string} [o.format]
 * @param {string} [o.label] - accessible metric name
 * @param {[string,string]} [o.names] - ['A', 'B']
 * @returns {string}
 */
export function dumbbell(o = {}) {
    const min = finite(o.min, 0);
    const max = Math.max(min + 1e-9, finite(o.max, 1));
    const format = typeof o.format === 'function' ? o.format : v => String(v);
    const [nameA, nameB] = o.names ?? ['A', 'B'];
    const a = finite(Number(o.a), min);
    const b = finite(Number(o.b), min);
    const pos = v => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100;
    const same = Math.abs(a - b) < 1e-9;
    // An explicit winner (e.g. "closer to zero") overrides the direction.
    const judged = o.winner !== undefined ? Boolean(o.winner) : Boolean(o.better);
    const aBetter = !same && (o.winner !== undefined ? o.winner === 'A' : ((o.better === 'higher' && a > b) || (o.better === 'lower' && a < b)));
    const bBetter = !same && (o.winner !== undefined ? o.winner === 'B' : ((o.better === 'higher' && b > a) || (o.better === 'lower' && b < a)));
    const left = Math.min(pos(a), pos(b));
    const width = Math.abs(pos(a) - pos(b));
    const verdict = same ? 'the same' : aBetter ? `${nameA} is better` : bBetter ? `${nameB} is better` : 'different';
    const aria = `${o.label ? `${stripTags(o.label)}: ` : ''}${nameA} ${format(a)}, ${nameB} ${format(b)}${judged ? ` — ${verdict}` : ''}`;
    const end = (v, name, isBetter, cls) =>
        `<span class="viz-db-end ${cls}${isBetter ? ' is-better' : ''}${judged && !isBetter && (aBetter || bBetter) ? ' is-worse' : ''}" style="left:${pos(v).toFixed(2)}%" data-tip="${attr(`${name}: ${format(v)}`)}"><i>${escapeHtml(name)}</i></span>`;
    return `
        <span class="viz-db" role="img" aria-label="${attr(aria)}">
            <span class="viz-db-line" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>
            ${end(a, nameA, aBetter, 'is-a')}
            ${end(b, nameB, bBetter, 'is-b')}
        </span>`;
}

function stripTags(html) {
    return String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export const __test__ = { TONE_RANK, tickEvery, stripTags, plural };
