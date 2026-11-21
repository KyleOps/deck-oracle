import { expect, test } from '@playwright/test';
import { CHART_URL, isolateNetwork } from './helpers/network.js';

/**
 * Performance budgets: the overview's cold load and the two heaviest
 * calculator pages.
 *
 * Every number comes from the browser's own Performance APIs (Navigation,
 * Resource and Paint Timing, Long Tasks), never from Playwright's wall clock,
 * on a hermetic network (helpers/network.js: CDN scripts from node_modules,
 * web fonts and card art stubbed), so a slow CDN can't fail a budget.
 *
 * Measured 2026-11-21 (v3.0.0, Chromium headless, desktop viewport):
 *
 *                                   measured   4× slower CPU   budget
 *   overview: JS before DCL         351 KB     —               460 KB
 *   overview: DOM nodes             895        —               1,150
 *   overview: first contentful      216 ms     360 ms          500 ms
 *   ?tab=mulligan: bottom line      277 ms     680 ms          900 ms
 *   ?tab=chimil: bottom line        290 ms     954 ms          1,250 ms
 *   either page: longest task        78 ms     411 ms          550 ms
 *
 * Sizes and counts are deterministic, so they get ~30% headroom over the
 * measurement. Timings depend on the machine, so they get ~30% headroom over
 * a run with the CPU throttled 4× — slower than any CI runner we expect —
 * which still fails a page that becomes several times slower.
 *
 * These tests are the `performance` project in playwright.config.js: they
 * run after the functional tests, one at a time, so nothing competes with
 * them for the CPU.
 *
 * Updating a budget:
 *   PERF_LOG=1 PERF_CPU=4 npx playwright test --project=performance --no-deps --repeat-each=5
 * prints every measurement (drop PERF_CPU for unthrottled numbers; the HTML
 * report also lists them as annotations). Raise a budget in the PR that
 * needs it and say why in the description; lower it when you make the app
 * faster. Keep the table above in step.
 */

const OVERVIEW = { scriptKB: 460, domNodes: 1150, fcpMs: 500 };
const PAGES = { mulligan: { bottomLineMs: 900 }, chimil: { bottomLineMs: 1250 } };
const LONGEST_TASK_MS = 550;

/** Attach a measurement to the report (and print it with PERF_LOG=1). */
function record(name, value) {
    test.info().annotations.push({ type: 'perf', description: `${name}: ${value}` });
    if (process.env.PERF_LOG) console.log(`[perf] ${test.info().title} :: ${name} = ${value}`);
}

/** Resolve once the page has had an idle moment (deferred work has run). */
const idle = page => page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve, { timeout: 2000 })));

test.beforeEach(async ({ page }) => {
    await isolateNetwork(page, { fonts: false });
    // Optional CPU throttling, only for measuring new budgets (see above).
    if (process.env.PERF_CPU) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_CPU) });
    }
    await page.addInitScript(() => {
        localStorage.clear(); // cold start: example deck, default theme
        performance.setResourceTimingBufferSize(1000);
        const perf = window.__perf = { longTasks: [], bottomLine: null };
        try {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) perf.longTasks.push(Math.round(entry.duration));
            }).observe({ type: 'longtask', buffered: true });
        } catch { /* Long Tasks API unavailable: the budget check below fails loudly */ }
        // Time from navigation start to the frame that first paints the page's answer.
        const tab = new URLSearchParams(location.search).get('tab') || 'overview';
        const watch = new MutationObserver(() => {
            if (!document.querySelector(`#${tab}-tab .bottom-line`)) return;
            watch.disconnect();
            requestAnimationFrame(() => { perf.bottomLine = performance.now(); });
        });
        watch.observe(document, { childList: true, subtree: true });
    });
});

test('overview: cold load stays light and never fetches Chart.js', async ({ page }) => {
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/');
    await expect(page.locator('.finding').first()).toBeVisible();
    await page.waitForLoadState('load');
    await idle(page);

    const m = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const scripts = performance.getEntriesByType('resource').filter(entry =>
            /\.m?js$/.test(new URL(entry.name).pathname) && entry.responseEnd <= nav.domContentLoadedEventStart);
        return {
            scriptBytes: scripts.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
            unsized: scripts.filter(entry => !entry.decodedBodySize).map(entry => entry.name),
            domNodes: document.getElementsByTagName('*').length,
            fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Infinity,
            chartGlobal: typeof window.Chart
        };
    });
    const scriptKB = m.scriptBytes / 1024;
    record('JS before DOMContentLoaded (KB)', scriptKB.toFixed(1));
    record('DOM nodes', m.domNodes);
    record('first contentful paint (ms)', Math.round(m.fcp));

    expect(requests.filter(url => url === CHART_URL || /\/chart(\.umd)?(\.min)?\.js$/.test(url)),
        'the overview draws no charts, so it must not download Chart.js').toEqual([]);
    expect(m.chartGlobal).toBe('undefined');
    expect(m.unsized, 'every script must report its size, or the byte budget undercounts').toEqual([]);
    expect(scriptKB, 'JavaScript fetched before DOMContentLoaded (KB, uncompressed)').toBeLessThanOrEqual(OVERVIEW.scriptKB);
    expect(m.domNodes, 'DOM nodes on the rendered overview').toBeLessThanOrEqual(OVERVIEW.domNodes);
    expect(m.fcp, 'first contentful paint (ms)').toBeLessThanOrEqual(OVERVIEW.fcpMs);
});

for (const [tab, budget] of Object.entries(PAGES)) {
    test(`${tab}: a cold deep link answers quickly without freezing the page`, async ({ page }) => {
        await page.goto(`/?tab=${tab}`);
        await expect(page.locator(`#${tab}-tab .bottom-line`)).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__perf.bottomLine)).not.toBeNull();
        await idle(page);

        const m = await page.evaluate(() => ({
            bottomLine: window.__perf.bottomLine,
            longTasks: window.__perf.longTasks,
            supported: PerformanceObserver.supportedEntryTypes.includes('longtask')
        }));
        const longest = Math.max(0, ...m.longTasks);
        record('bottom line painted (ms after navigation start)', Math.round(m.bottomLine));
        record('long tasks (ms)', JSON.stringify(m.longTasks));

        expect(m.supported, 'Long Tasks API').toBe(true);
        expect(m.bottomLine, 'bottom line painted (ms after navigation start)').toBeLessThanOrEqual(budget.bottomLineMs);
        expect(longest, 'longest main-thread task (ms)').toBeLessThanOrEqual(LONGEST_TASK_MS);
    });
}
