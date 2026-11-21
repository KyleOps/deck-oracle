/**
 * Chart.js Helper Utilities
 * Standardizes chart creation and updates across all calculators.
 */

import { owesRender } from './calculatorBase.js';

/** The page (calculator key) a canvas belongs to, or null. */
function pageOf(canvas) {
    return canvas?.closest?.('.tab-content')?.id?.replace(/-tab$/, '') || null;
}

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

// ── Theme sync ──────────────────────────────────────────────────────────────
// The palette above is the dark-theme default (and what Node tests see). In the
// browser, applyChartTheme() re-reads every value from the live CSS tokens, so
// one source of truth — css/tokens.css — drives both the DOM and the canvas,
// and switching to the light theme recolours charts too.

const TOKEN_MAP = {
    bg: '--tx-panel', rule: '--tx-rule', ruleHi: '--tx-rule-hi', dim: '--tx-dim', mid: '--tx-mid',
    text: '--tx-text', bright: '--tx-bright', green: '--tx-good', amber: '--tx-accent',
    red: '--tx-bad', blue: '--tx-flat'
};
const TYPE_KEYS = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'];

/** Bumped on every theme application; charts built under an older theme are rebuilt. */
let themeVersion = 0;

/**
 * A colour at the given opacity: `#rrggbb`, `rgb()` and `rgba()` become
 * `rgba(r, g, b, alpha)`; anything else (a name, `transparent`) is returned
 * unchanged.
 * @param {string} color
 * @param {number} alpha - 0..1
 * @returns {string}
 */
export function withAlpha(color, alpha) {
    const hex = String(color).trim().match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const n = parseInt(hex[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const rgb = String(color).match(/rgba?\(([^)]+)\)/);
    if (rgb) {
        const [r, g, b] = rgb[1].split(',').map(v => v.trim());
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
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

/**
 * Refresh TX_CHART from the CSS tokens and push it into Chart.js defaults.
 * Call after Chart.js loads and whenever the theme changes.
 */
export function applyChartTheme() {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
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
    themeVersion += 1;

    const Chart = typeof window !== 'undefined' ? window.Chart : undefined;
    if (!Chart) return;
    const mono = read('--font-mono') || 'ui-monospace, monospace';
    Chart.defaults.color = TX_CHART.dim;
    Chart.defaults.borderColor = TX_CHART.rule;
    Chart.defaults.backgroundColor = TX_CHART.bg;
    Chart.defaults.font.family = mono;
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.display = false;
    Object.assign(Chart.defaults.plugins.tooltip, {
        backgroundColor: read('--surface-raised') || TX_CHART.bg,
        borderColor: TX_CHART.ruleHi,
        borderWidth: 1,
        titleColor: TX_CHART.mid,
        bodyColor: TX_CHART.text,
        padding: 10,
        cornerRadius: 6,
        boxPadding: 4
    });
    if (Chart.defaults.scales) {
        // Merge one level deeper than a plain spread. Replacing the whole `ticks`
        // object drops Chart.js's own tick callback — on a category axis that is
        // what maps an index back to its label.
        const applyScaleDefaults = (scale = {}) => ({
            ...scale,
            grid: { ...scale.grid, color: TX_CHART.rule, drawTicks: false },
            ticks: { ...scale.ticks, color: TX_CHART.dim, font: { size: 10 } },
            border: { ...scale.border, color: TX_CHART.rule, dash: [] }
        });
        Chart.defaults.scales.linear = applyScaleDefaults(Chart.defaults.scales.linear);
        Chart.defaults.scales.category = applyScaleDefaults(Chart.defaults.scales.category);
    }
}

/**
 * Create or update a Chart.js instance.
 * @param {Object} chartInstance - The existing Chart instance (or null/undefined).
 * @param {string} canvasId - The ID of the canvas element.
 * @param {Object} config - The chart configuration object (type, data, options).
 * @returns {Object} - The created or updated Chart instance.
 */
export function createOrUpdateChart(chartInstance, canvasId, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    // Chart.js loads lazily; offline (or before it arrives) charts are skipped
    // rather than throwing and taking the rest of the calculator down. The
    // page owes a render, so its next visit tries again.
    if (typeof Chart === 'undefined') {
        owesRender(pageOf(ctx));
        return null;
    }

    // A chart built under the other theme, or whose canvas has been replaced,
    // is rebuilt from scratch — the surgical update path below deliberately
    // leaves options (and therefore colours) alone.
    if (chartInstance && (chartInstance.$themeVersion !== themeVersion
        || (chartInstance.canvas !== undefined && chartInstance.canvas !== ctx))) {
        try { chartInstance.destroy(); } catch { /* already gone */ }
        chartInstance = null;
    }

    // Defer construction until the canvas actually has a layout box. Calculators
    // render on init while their tab is still display:none, so the canvas is
    // 0x0; Chart.js would lay out at a fallback size and then animate as it
    // resized on first reveal, which reads as the plot flying in from a corner.
    // The page owes a render, so the router calls updateUI() when it is shown
    // again, and the deferred chart gets built then — at its real size.
    // Feature-detected: the headless test DOM has no getBoundingClientRect, and
    // there is nothing to defer for there.
    if (!chartInstance && typeof ctx.getBoundingClientRect === 'function'
        && ctx.getBoundingClientRect().width === 0) {
        owesRender(pageOf(ctx));
        return null;
    }

    if (!chartInstance) {
        // Create new chart
        // Merge default animation config into options
        const defaultAnimation = getChartAnimationConfig();
        const options = {
            ...defaultAnimation,
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

        // Charts are frequently constructed while their tab is still
        // display:none, so the canvas has no layout box. Chart.js lays out at a
        // fallback size, and when the tab is first shown the entry animation
        // plays as the canvas resizes — which reads as the plot flying in from a
        // corner. Build with animation off, then restore it so later data
        // changes still animate.
        const chart = new Chart(ctx, {
            type: config.type || 'line',
            data: config.data,
            options: { ...options, animation: false }
        });
        chart.$themeVersion = themeVersion;

        // Restore animation after the first static paint, so subsequent data
        // changes still animate but the initial appearance does not.
        const restoreAnimation = () => {
            chart.options.animation = options.animation ?? {};
            if (options.animations) chart.options.animations = options.animations;
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreAnimation);
        else restoreAnimation();

        return chart;
    } else {
        // Update existing chart
        // Perform surgical update to maintain animation smoothness
        
        // Update labels
        if (config.data.labels) {
            chartInstance.data.labels = config.data.labels;
        }

        // Update datasets
        if (config.data.datasets) {
            config.data.datasets.forEach((newDataset, i) => {
                const existingDataset = chartInstance.data.datasets[i];
                if (existingDataset) {
                    // Update properties in place
                    Object.assign(existingDataset, newDataset);
                } else {
                    // New dataset found (unexpected for these calculators but handled)
                    chartInstance.data.datasets.push(newDataset);
                }
            });
            
            // Handle removed datasets if any
            if (chartInstance.data.datasets.length > config.data.datasets.length) {
                chartInstance.data.datasets.length = config.data.datasets.length;
            }
        }

        // Note: We deliberately do NOT update chartInstance.options here to preserve 
        // animation state and prevent full re-renders. 
        // If dynamic option updates are needed, we can add a flag later.

        chartInstance.update();
        return chartInstance;
    }
}
