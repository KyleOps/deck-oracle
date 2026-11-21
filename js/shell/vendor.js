/**
 * Third-party scripts, loaded on demand.
 *
 * Chart.js is ~200 KB and only calculators that draw charts need it, so it is
 * fetched the first time one of them opens instead of blocking first paint.
 * The URL pins an exact version: an unpinned CDN path silently upgrades the
 * chart engine underneath every calculator.
 */

import { applyChartTheme } from '../utils/chartHelpers.js';

const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js';

const scripts = new Map();

/**
 * Inject a classic script once; resolves when it has executed.
 * @param {string} src
 * @returns {Promise<void>}
 */
export function loadScript(src) {
    if (!scripts.has(src)) {
        const promise = new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.async = true;
            el.crossOrigin = 'anonymous';
            el.onload = () => resolve();
            el.onerror = () => {
                scripts.delete(src);
                el.remove();
                reject(new Error(`Failed to load ${src}`));
            };
            document.head.appendChild(el);
        });
        scripts.set(src, promise);
    }
    return scripts.get(src);
}

let chartReady = null;

/**
 * Make sure Chart.js is available and themed. Safe to call repeatedly.
 * @returns {Promise<boolean>} false when it could not be loaded (offline)
 */
export function ensureChartJs() {
    if (typeof window !== 'undefined' && window.Chart) {
        applyChartTheme();
        return Promise.resolve(true);
    }
    if (!chartReady) {
        chartReady = loadScript(CHART_JS_URL)
            .then(() => {
                applyChartTheme();
                return true;
            })
            .catch(err => {
                console.warn('Chart.js unavailable — charts will be skipped.', err);
                chartReady = null;
                return false;
            });
    }
    return chartReady;
}
