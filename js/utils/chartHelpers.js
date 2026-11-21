/**
 * Chart.js helpers: the theme-synced chart palette (TX_CHART) and
 * createOrUpdateChart(), which every calculator uses to draw.
 *
 * Neither Chart.js (js/shell/vendor.js) nor this module is loaded until a page
 * that draws charts opens. New charts are built in a task of their own after
 * the page's answer has painted — constructing one takes 40–190 ms on a
 * phone, and the answer should wait neither for that nor for Chart.js to
 * download. createOrUpdateChart() hands back a placeholder in the meantime.
 */

import { owesRender } from './calculatorBase.js';

/**
 * Terminal chart palette.
 *
 * Chart.js needs concrete colour values (it draws to canvas and cannot resolve
 * CSS custom properties), so the terminal tokens are mirrored here as literals.
 * Every calculator should pull series colours from this one place rather than
 * inlining hex codes, otherwise charts drift away from the rest of the UI.
 *
 * Keep in sync with the --tx-* variables in css/base.css.
 */
export const TX_CHART = {
    bg: '#101211',
    rule: '#1e221f',
    ruleHi: '#2c322e',
    dim: '#808b85',
    mid: '#939c97',
    text: '#d2d8d4',
    bright: '#eef1ef',

    /* green/red carry meaning (likely/unlikely); amber is the brand accent;
       "blue" is now a neutral slate used only where a series needs a third
       colour without implying good or bad. */
    green: '#55c97f',
    amber: '#f0a92c',
    red: '#e8635c',
    blue: '#7d8a92',

    /* Translucent fills for area series */
    greenFill: 'rgba(85, 201, 127, 0.10)',
    amberFill: 'rgba(240, 169, 44, 0.10)',
    redFill: 'rgba(232, 99, 92, 0.10)',
    blueFill: 'rgba(125, 138, 146, 0.10)',

    /* Ordered series colours for multi-line charts */
    series: ['#55c97f', '#f0a92c', '#6f9dc4', '#e8635c', '#a68ac4', '#5fa8a0'],

    /**
     * Canonical MTG card-type colours. These are the same values as the
     * --type-* custom properties in css/base.css; canvas can't read those, so
     * the two must be edited together. Everything that colours a card type —
     * the deck radar composition bar, Portent's type chart, sample reveals —
     * pulls from one of the two mirrors so a type is always the same colour.
     */
    types: {
        creature: '#7ab77f',
        instant: '#6f9dc4',
        sorcery: '#a68ac4',
        artifact: '#9aa19d',
        enchantment: '#d2ac6b',
        planeswalker: '#c4869e',
        battle: '#c67d72',
        land: '#8b9c78'
    }
};

/**
 * A colour at the given opacity — pass live TX_CHART values, so faded series
 * follow the theme. `#rrggbb`, `rgb()` and `rgba()` become
 * `rgba(r, g, b, alpha)`; anything else (a name, `transparent`) comes back
 * trimmed but otherwise unchanged, and a missing colour as ''.
 * @param {string} color
 * @param {number} alpha - 0..1
 * @returns {string}
 */
export function withAlpha(color, alpha) {
    const value = String(color ?? '').trim();
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const rgb = value.match(/rgba?\(([^)]+)\)/);
    if (rgb) {
        const [r, g, b] = rgb[1].split(',').map(v => v.trim());
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return value;
}

/**
 * Chart.js animation options: data changes ease into place (the first draw
 * never animates — see createOrUpdateChart).
 * @returns {Object}
 */
export function getChartAnimationConfig() {
    return {
        animation: { duration: 750, easing: 'easeInOutQuart' },
        animations: {
            tension: { duration: 500, easing: 'easeInOutCubic', from: 0.4, to: 0.3, loop: false }
        },
        transitions: {
            active: { animation: { duration: 300 } },
            resize: { animation: { duration: 0 } }
        }
    };
}

// ── Theme sync ──────────────────────────────────────────────────────────────
// The palette above is the dark-theme default (and what Node tests see). In the
// browser, applyChartTheme() re-reads every value from the live CSS tokens, so
// one source of truth — css/tokens.css — drives both the DOM and the canvas,
// and switching to the light theme recolours charts too. It runs when this
// module loads, on every `themechange` event (js/shell/theme.js) and once
// Chart.js has arrived (chartEngineReady).

const TOKEN_MAP = {
    bg: '--tx-panel', rule: '--tx-rule', ruleHi: '--tx-rule-hi', dim: '--tx-dim', mid: '--tx-mid',
    text: '--tx-text', bright: '--tx-bright', green: '--tx-good', amber: '--tx-accent',
    red: '--tx-bad', blue: '--tx-flat'
};
const TYPE_KEYS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'];

/** Bumped whenever the palette changes; charts built under an older one are rebuilt. */
let themeVersion = 0;
let paletteKey = '';

function engine() {
    return typeof Chart === 'undefined' ? null : Chart;
}

/**
 * Refresh TX_CHART from the CSS tokens and push it into Chart.js defaults.
 * Safe to call at any time; charts are rebuilt only if a colour changed.
 */
export function applyChartTheme() {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.documentElement) return;
    const css = getComputedStyle(document.documentElement);
    const read = name => css.getPropertyValue(name).trim();
    for (const [key, token] of Object.entries(TOKEN_MAP)) {
        const value = read(token);
        if (value) TX_CHART[key] = value;
    }
    TX_CHART.greenFill = withAlpha(TX_CHART.green, 0.12);
    TX_CHART.amberFill = withAlpha(TX_CHART.amber, 0.12);
    TX_CHART.redFill = withAlpha(TX_CHART.red, 0.12);
    TX_CHART.blueFill = withAlpha(TX_CHART.blue, 0.12);
    const series = [1, 2, 3, 4, 5, 6].map(i => read(`--series-${i}`)).filter(Boolean);
    if (series.length === 6) TX_CHART.series = series;
    for (const type of TYPE_KEYS) {
        const value = read(`--type-${type}`);
        if (value) TX_CHART.types[type] = value;
    }
    const key = JSON.stringify(TX_CHART);
    if (key !== paletteKey) {
        paletteKey = key;
        themeVersion += 1;
    }

    const ChartJs = engine();
    if (!ChartJs) return;
    const mono = read('--font-mono') || 'ui-monospace, monospace';
    ChartJs.defaults.color = TX_CHART.dim;
    ChartJs.defaults.borderColor = TX_CHART.rule;
    ChartJs.defaults.backgroundColor = TX_CHART.bg;
    ChartJs.defaults.font.family = mono;
    ChartJs.defaults.font.size = 11;
    ChartJs.defaults.plugins.legend.display = false;
    Object.assign(ChartJs.defaults.plugins.tooltip, {
        backgroundColor: read('--surface-raised') || TX_CHART.bg,
        borderColor: TX_CHART.ruleHi,
        borderWidth: 1,
        titleColor: TX_CHART.mid,
        bodyColor: TX_CHART.text,
        padding: 10,
        cornerRadius: 6,
        boxPadding: 4
    });
    if (ChartJs.defaults.scales) {
        // Merge one level deeper than a plain spread. Replacing the whole `ticks`
        // object drops Chart.js's own tick callback — on a category axis that is
        // what maps an index back to its label.
        const applyScaleDefaults = (scale = {}) => ({
            ...scale,
            grid: { ...scale.grid, color: TX_CHART.rule, drawTicks: false },
            ticks: { ...scale.ticks, color: TX_CHART.dim, font: { size: 10 } },
            border: { ...scale.border, color: TX_CHART.rule, dash: [] }
        });
        ChartJs.defaults.scales.linear = applyScaleDefaults(ChartJs.defaults.scales.linear);
        ChartJs.defaults.scales.category = applyScaleDefaults(ChartJs.defaults.scales.category);
    }
}

// ── Charts waiting to be built ──────────────────────────────────────────────

/**
 * What createOrUpdateChart() returns for a chart that is not built yet. Pass it
 * back on the next call like a chart (it then stands for the chart it became);
 * destroy() cancels the build, or destroys the built chart.
 */
class PendingChart {
    constructor(canvasId, config, replaces = null) {
        this.canvasId = canvasId;
        this.config = config;
        this.themeVersion = themeVersion;
        /** A chart on the same canvas, kept on screen until this one replaces it. */
        this.replaces = replaces;
        this.chart = null;
        this.cancelled = false;
    }

    destroy() {
        this.cancelled = true;
        pending.delete(this);
        destroyQuietly(this.replaces);
        destroyQuietly(this.chart);
        this.replaces = null;
        this.chart = null;
    }

    update(mode) {
        this.chart?.update(mode);
    }
}

const pending = new Set();
let flushScheduled = false;

function destroyQuietly(chart) {
    try { chart?.destroy(); } catch { /* already gone */ }
}

/** The page (calculator key) a canvas belongs to, or null. */
function pageOf(canvas) {
    return canvas?.closest?.('.tab-content')?.id?.replace(/-tab$/, '') || null;
}

function schedule(handle) {
    // One build per canvas: a newer placeholder supersedes an older one.
    for (const other of pending) {
        if (other !== handle && other.canvasId === handle.canvasId) {
            pending.delete(other);
            handle.replaces ??= other.replaces;
            other.replaces = null;
            other.cancelled = true;
        }
    }
    pending.add(handle);
    if (!flushScheduled) {
        flushScheduled = true;
        // After the next frame: the page's answer paints first.
        requestAnimationFrame(() => setTimeout(flushPendingCharts, 0));
    }
    return handle;
}

/**
 * Build every chart that is waiting, if Chart.js is here. A chart whose canvas
 * has no size (its page was left before the build ran) stays waiting, and its
 * page re-renders — and so builds it — on its next visit.
 */
function flushPendingCharts() {
    flushScheduled = false;
    if (!engine()) return; // chartEngineReady() flushes once Chart.js arrives
    for (const handle of [...pending]) {
        pending.delete(handle);
        if (handle.cancelled) continue;
        const canvas = document.getElementById(handle.canvasId);
        if (!canvas) { // the page re-rendered without this chart
            destroyQuietly(handle.replaces);
            handle.replaces = null;
            continue;
        }
        // Layout is clean here (a frame has just been drawn), so this is cheap.
        if (canvas.getBoundingClientRect().width === 0) {
            owesRender(pageOf(canvas));
            continue;
        }
        destroyQuietly(handle.replaces);
        handle.replaces = null;
        try {
            handle.chart = construct(canvas, handle.config, handle.themeVersion);
        } catch (err) {
            console.error(`Chart ${handle.canvasId} failed to build:`, err);
        }
    }
}

/** Chart.js has loaded (js/shell/vendor.js): theme it and build waiting charts. */
export function chartEngineReady() {
    applyChartTheme();
    if (pending.size && !flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(() => setTimeout(flushPendingCharts, 0));
    }
}

function construct(canvas, config, version) {
    const ChartJs = engine();
    const options = {
        ...getChartAnimationConfig(),
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        ...config.options, // User options override defaults
        plugins: {
            legend: { display: false },
            ...config.options?.plugins
        },
        scales: {
            x: {
                grid: { color: TX_CHART.rule },
                ticks: { color: TX_CHART.dim },
                ...config.options?.scales?.x
            },
            y: {
                grid: { color: TX_CHART.rule },
                ticks: { color: TX_CHART.dim },
                ...config.options?.scales?.y
            },
            ...config.options?.scales
        }
    };

    // The first draw is static: animating it reads as the plot flying in from
    // a corner. Animation is restored after it, so data changes still ease.
    const chart = new ChartJs(canvas, {
        type: config.type || 'line',
        data: config.data,
        options: { ...options, animation: false }
    });
    chart.$themeVersion = version;
    const restoreAnimation = () => {
        chart.options.animation = options.animation ?? {};
        if (options.animations) chart.options.animations = options.animations;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreAnimation);
    else restoreAnimation();
    return chart;
}

/**
 * Create or update a Chart.js chart.
 *
 * Updates apply at once. A new chart (or one rebuilt for a new theme) is built
 * after the next paint, once Chart.js is here; until then the return value is
 * a placeholder to pass back on the next call, like a chart.
 *
 * @param {Object|null} chartInstance - what the previous call returned, or null
 * @param {string} canvasId - the canvas element's id
 * @param {Object} config - Chart.js configuration (type, data, options)
 * @returns {Object|null} the chart (or its placeholder); null without a canvas
 */
export function createOrUpdateChart(chartInstance, canvasId, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    if (chartInstance instanceof PendingChart) {
        if (chartInstance.chart) {
            chartInstance = chartInstance.chart;
        } else if (!chartInstance.cancelled) {
            // Still waiting: it will be built from the newest configuration.
            chartInstance.canvasId = canvasId;
            chartInstance.config = config;
            chartInstance.themeVersion = themeVersion;
            return schedule(chartInstance);
        } else {
            chartInstance = null;
        }
    }

    // A chart built under the other theme, or whose canvas has been replaced,
    // is rebuilt from scratch — the surgical update path below deliberately
    // leaves options (and therefore colours) alone.
    if (chartInstance && (chartInstance.$themeVersion !== themeVersion
        || (chartInstance.canvas !== undefined && chartInstance.canvas !== ctx))) {
        if (typeof requestAnimationFrame === 'function' && chartInstance.canvas === ctx) {
            return schedule(new PendingChart(canvasId, config, chartInstance));
        }
        destroyQuietly(chartInstance);
        chartInstance = null;
    }

    if (!chartInstance) {
        if (typeof requestAnimationFrame === 'function') return schedule(new PendingChart(canvasId, config));
        // No frames to wait for (headless tests): build now, as long as the
        // canvas has a size to build at.
        if (!engine()) return null;
        if (typeof ctx.getBoundingClientRect === 'function' && ctx.getBoundingClientRect().width === 0) return null;
        return construct(ctx, config, themeVersion);
    }

    // Update in place, keeping the animation state; options are deliberately
    // left alone (a new theme rebuilds the chart instead, above).
    if (config.data.labels) {
        chartInstance.data.labels = config.data.labels;
    }
    if (config.data.datasets) {
        config.data.datasets.forEach((newDataset, i) => {
            const existingDataset = chartInstance.data.datasets[i];
            if (existingDataset) Object.assign(existingDataset, newDataset);
            else chartInstance.data.datasets.push(newDataset);
        });
        if (chartInstance.data.datasets.length > config.data.datasets.length) {
            chartInstance.data.datasets.length = config.data.datasets.length;
        }
    }
    chartInstance.update();
    return chartInstance;
}

// Theme the palette now (a calculator reads it before Chart.js arrives), and
// again whenever the theme changes.
applyChartTheme();
if (typeof document !== 'undefined') document.addEventListener?.('themechange', applyChartTheme);
