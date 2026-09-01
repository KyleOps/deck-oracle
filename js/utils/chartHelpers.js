/**
 * Chart.js Helper Utilities
 * Standardizes chart creation and updates across all calculators.
 */
import { getChartAnimationConfig } from './simulation.js';

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
 * Create or update a Chart.js instance.
 * @param {Object} chartInstance - The existing Chart instance (or null/undefined).
 * @param {string} canvasId - The ID of the canvas element.
 * @param {Object} config - The chart configuration object (type, data, options).
 * @returns {Object} - The created or updated Chart instance.
 */
export function createOrUpdateChart(chartInstance, canvasId, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    // Defer construction until the canvas actually has a layout box. Calculators
    // render on init while their tab is still display:none, so the canvas is
    // 0x0; Chart.js would lay out at a fallback size and then animate as it
    // resized on first reveal, which reads as the plot flying in from a corner.
    // switchTab() calls updateUI() for the tab being shown, so a deferred chart
    // gets built the moment it becomes visible — at its real size.
    // Feature-detected: the headless test DOM has no getBoundingClientRect, and
    // there is nothing to defer for there.
    if (!chartInstance && typeof ctx.getBoundingClientRect === 'function'
        && ctx.getBoundingClientRect().width === 0) {
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
