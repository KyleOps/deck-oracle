import { expect, test } from '@playwright/test';
import { CHART_URL, isolateNetwork } from './helpers/network.js';

/**
 * Performance budgets: the overview's cold load and the two heaviest
 * calculator pages.
 *
 * Every number comes from the browser's own Performance APIs (Navigation,
 * Resource, Paint and Element Timing, Long Tasks), never from Playwright's
 * wall clock, on a hermetic network (helpers/network.js: CDN scripts from
 * node_modules, web fonts and card art stubbed), so a slow CDN can't fail a
 * budget.
 *
 * "Answer painted" is when the page's answer is on screen: the Element Timing
 * render time of its bottom line (renderBottomLine() marks the text
 * elementtiming="bottom-line"). The overview leads with its findings instead,
 * so there it is the end of the first frame after they are in the DOM (a
 * task queued from requestAnimationFrame runs after that frame's style,
 * layout and paint). Stopping the clock inside the requestAnimationFrame
 * callback itself, as this file once did, misses all three: 160–390 ms of
 * real work on a 4× slower CPU.
 *
 * Measured 2026-11-21 (v3.1.0, Chromium headless, desktop viewport, median
 * of 7 runs with --workers=1):
 *
 *                                   measured   4× slower CPU   budget
 *   overview: JS before DCL         412 KB     —               530 KB
 *   overview: DOM nodes             998        —               1,150
 *   overview: first contentful      224 ms     344 ms          450 ms
 *   overview: answer painted        346 ms     1,117 ms        1,450 ms
 *   ?tab=mulligan: answer painted   244 ms     1,064 ms        1,400 ms
 *   ?tab=chimil: answer painted     256 ms     1,164 ms        1,500 ms
 *   any of them: longest task        57 ms     330 ms          450 ms
 *
 * "JS before DCL" includes the landing page's own modules, which index.html
 * preloads so they arrive alongside the shell instead of after it.
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
 * Updating a budget (one worker: repeats running side by side slow each other):
 *   PERF_LOG=1 PERF_CPU=4 npx playwright test --project=performance --no-deps --repeat-each=7 --workers=1
 * prints every measurement (drop PERF_CPU for unthrottled numbers; the HTML
 * report also lists them as annotations). Raise a budget in the PR that
 * needs it and say why in the description; lower it when you make the app
 * faster. Keep the table above in step.
 */

const OVERVIEW = { scriptKB: 530, domNodes: 1150, fcpMs: 450, answerMs: 1450 };
const PAGES = { mulligan: { answerMs: 1400 }, chimil: { answerMs: 1500 } };
const LONGEST_TASK_MS = 450;

/** Attach a measurement to the report (and print it with PERF_LOG=1). */
function record(name, value) {
    test.info().annotations.push({ type: 'perf', description: `${name}: ${value}` });
    if (process.env.PERF_LOG) console.log(`[perf] ${test.info().title} :: ${name} = ${value}`);
}

/** Resolve once the page has had an idle moment (deferred work has run). */
const idle = page => page.evaluate(() => new Promise(resolve => requestIdleCallback(resolve, { timeout: 2000 })));

/** Wait for the answer to be painted; resolves to the measurements. */
async function measure(page) {
    await expect.poll(() => page.evaluate(() => window.__perf.answer)).not.toBeNull();
    await idle(page);
    return page.evaluate(() => ({
        ...window.__perf,
        supported: ['longtask', 'element'].every(type => PerformanceObserver.supportedEntryTypes.includes(type))
    }));
}

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
        const perf = window.__perf = { longTasks: [], answer: null, answerFrame: null };
        try {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) perf.longTasks.push(Math.round(entry.duration));
            }).observe({ type: 'longtask', buffered: true });
        } catch { /* Long Tasks API unavailable: the budget check below fails loudly */ }

        const tab = new URLSearchParams(location.search).get('tab') || 'overview';
        if (tab === 'overview') {
            // First frame after the findings land (see the header).
            const watch = new MutationObserver(() => {
                if (!document.querySelector('#overview-tab .finding')) return;
                watch.disconnect();
                requestAnimationFrame(() => setTimeout(() => { perf.answer = perf.answerFrame = performance.now(); }, 0));
            });
            watch.observe(document, { childList: true, subtree: true });
            return;
        }
        try {
            new PerformanceObserver(list => {
                const entry = list.getEntries().find(e => e.identifier === 'bottom-line');
                if (entry && perf.answer === null) perf.answer = entry.renderTime || entry.loadTime;
            }).observe({ type: 'element', buffered: true });
        } catch { /* Element Timing unavailable: the support check below fails loudly */ }
        // For the report only: what the old rAF-callback clock would have said.
        const watch = new MutationObserver(() => {
            if (!document.querySelector(`#${tab}-tab .bottom-line`)) return;
            watch.disconnect();
            requestAnimationFrame(() => { perf.answerFrame = performance.now(); });
        });
        watch.observe(document, { childList: true, subtree: true });
    });
});

test('overview: cold load stays light, never fetches Chart.js and answers quickly', async ({ page }) => {
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/');
    await expect(page.locator('.finding').first()).toBeVisible();
    await page.waitForLoadState('load');
    const perf = await measure(page);

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
    const longest = Math.max(0, ...perf.longTasks);
    record('JS before DOMContentLoaded (KB)', scriptKB.toFixed(1));
    record('DOM nodes', m.domNodes);
    record('first contentful paint (ms)', Math.round(m.fcp));
    record('answer painted (ms after navigation start)', Math.round(perf.answer));
    record('long tasks (ms)', JSON.stringify(perf.longTasks));

    expect(requests.filter(url => url === CHART_URL || /\/chart(\.umd)?(\.min)?\.js$/.test(url)),
        'the overview draws no charts, so it must not download Chart.js').toEqual([]);
    expect(m.chartGlobal).toBe('undefined');
    expect(m.unsized, 'every script must report its size, or the byte budget undercounts').toEqual([]);
    expect(perf.supported, 'Long Tasks and Element Timing APIs').toBe(true);
    expect(scriptKB, 'JavaScript fetched before DOMContentLoaded (KB, uncompressed)').toBeLessThanOrEqual(OVERVIEW.scriptKB);
    expect(m.domNodes, 'DOM nodes on the rendered overview').toBeLessThanOrEqual(OVERVIEW.domNodes);
    expect(m.fcp, 'first contentful paint (ms)').toBeLessThanOrEqual(OVERVIEW.fcpMs);
    expect(perf.answer, 'answer painted (ms after navigation start)').toBeLessThanOrEqual(OVERVIEW.answerMs);
    expect(longest, 'longest main-thread task (ms)').toBeLessThanOrEqual(LONGEST_TASK_MS);
});

for (const [tab, budget] of Object.entries(PAGES)) {
    test(`${tab}: a cold deep link answers quickly without freezing the page`, async ({ page }) => {
        await page.goto(`/?tab=${tab}`);
        await expect(page.locator(`#${tab}-tab .bottom-line`)).toBeVisible();
        const perf = await measure(page);
        const longest = Math.max(0, ...perf.longTasks);
        record('answer painted (ms after navigation start)', Math.round(perf.answer));
        record('answer frame began (ms; the old, early clock)', Math.round(perf.answerFrame));
        record('long tasks (ms)', JSON.stringify(perf.longTasks));

        expect(perf.supported, 'Long Tasks and Element Timing APIs').toBe(true);
        expect(perf.answer, 'answer painted (ms after navigation start)').toBeLessThanOrEqual(budget.answerMs);
        expect(longest, 'longest main-thread task (ms)').toBeLessThanOrEqual(LONGEST_TASK_MS);
    });
}
