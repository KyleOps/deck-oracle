/**
 * Third-party scripts, loaded on demand.
 *
 * Chart.js is ~200 KB and only calculators that draw charts need it, so it is
 * fetched the first time one of them opens instead of blocking first paint;
 * the page's answer does not wait for it either (chartHelpers.js builds charts
 * once it is here). LZ-String packs mulligan requirements into share links:
 * it loads before a link that carries them is applied, and otherwise once the
 * first page is up, so the share button never waits for it.
 *
 * The URLs pin exact versions: an unpinned CDN path silently upgrades the
 * library underneath every page. Bump each together with its devDependency
 * (tests/utils/cdnPins.node.test.js); npm run sw:manifest precaches both.
 */

const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js';
const LZ_STRING_URL = 'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js';

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
 * Make sure Chart.js is available and themed, and build the charts that were
 * waiting for it. Safe to call repeatedly.
 * @returns {Promise<boolean>} false when it could not be loaded (offline)
 */
export function ensureChartJs() {
    if (!chartReady) {
        const engine = typeof window !== 'undefined' && window.Chart ? Promise.resolve() : loadScript(CHART_JS_URL);
        chartReady = Promise.all([engine, import('../utils/chartHelpers.js')])
            .then(([, charts]) => {
                charts.chartEngineReady();
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

let lzReady = null;

/**
 * Make sure LZ-String (`window.LZString`, read by js/utils/share.js) is here.
 * @returns {Promise<boolean>} false when it could not be loaded (offline)
 */
export function ensureLzString() {
    if (typeof window !== 'undefined' && window.LZString) return Promise.resolve(true);
    if (!lzReady) {
        lzReady = loadScript(LZ_STRING_URL)
            .then(() => true)
            .catch(err => {
                console.warn('LZ-String unavailable — share links leave out mulligan requirements.', err);
                lzReady = null;
                return false;
            });
    }
    return lzReady;
}
