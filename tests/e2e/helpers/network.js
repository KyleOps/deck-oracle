/**
 * Hermetic network for browser tests that measure (performance budgets) or
 * compare pixels (visual snapshots): third-party requests are answered
 * locally so a slow CDN can neither fail a timing budget nor change a picture.
 *
 * - The pinned CDN scripts (Chart.js, LZ-String) are served from node_modules
 *   when the installed version is exactly the one the app pins; otherwise the
 *   request goes to the CDN as usual (the dependency-pin test keeps them equal).
 * - Scryfall card images become one fixed transparent pixel.
 * - Google Fonts are left alone by default (visual tests want real type) and
 *   stubbed with `{ fonts: false }` (performance tests measure our own code).
 * - Anything else off-origin is aborted, so no test depends on it by accident.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = file => readFileSync(path.join(root, file), 'utf8');

/** The exact CDN URLs the app loads (read from the source, never retyped). */
export const CHART_URL = read('js/shell/vendor.js').match(/CHART_JS_URL = '([^']+)'/)?.[1];
export const LZ_URL = read('js/shell/vendor.js').match(/LZ_STRING_URL = '([^']+)'/)?.[1];

/** node_modules copy of a pinned CDN file, or null when the versions differ. */
function localCopy(url, pkg, file) {
    const pinned = url?.match(/@(\d+\.\d+\.\d+)\//)?.[1];
    try {
        const installed = JSON.parse(read(`node_modules/${pkg}/package.json`)).version;
        return pinned && installed === pinned ? read(`node_modules/${pkg}/${file}`) : null;
    } catch {
        return null;
    }
}

const MIRRORS = new Map([
    [CHART_URL, localCopy(CHART_URL, 'chart.js', 'dist/chart.umd.min.js')],
    [LZ_URL, localCopy(LZ_URL, 'lz-string', 'libs/lz-string.min.js')]
].filter(([url, body]) => url && body));

// 1×1 transparent PNG.
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

// Cross-origin scripts are loaded with crossorigin="anonymous"; Timing-Allow-
// Origin exposes their sizes to the Resource Timing API.
const OPEN_HEADERS = { 'access-control-allow-origin': '*', 'timing-allow-origin': '*' };

/**
 * Route every off-origin request of `page` as described above.
 * @param {import('@playwright/test').Page} page
 * @param {{ fonts?: boolean }} [opts] - false stubs Google Fonts with empty CSS
 */
export async function isolateNetwork(page, { fonts = true } = {}) {
    await page.route(url => !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url.href), route => {
        const url = route.request().url();
        const { hostname } = new URL(url);
        const mirrored = MIRRORS.get(url);
        if (mirrored) {
            return route.fulfill({ body: mirrored, contentType: 'application/javascript', headers: OPEN_HEADERS });
        }
        if (url.startsWith('https://cdn.jsdelivr.net/')) return route.continue();
        const scryfall = hostname === 'scryfall.io' || hostname.endsWith('.scryfall.io');
        if (scryfall || route.request().resourceType() === 'image') {
            return route.fulfill({ body: PIXEL, contentType: 'image/png', headers: OPEN_HEADERS });
        }
        if (hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com') {
            return fonts
                ? route.continue()
                : route.fulfill({ body: '', contentType: 'text/css', headers: OPEN_HEADERS });
        }
        return route.abort('blockedbyclient');
    });
}
