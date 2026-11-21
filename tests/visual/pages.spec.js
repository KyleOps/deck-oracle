import { expect, test } from '@playwright/test';
import { isolateNetwork } from '../e2e/helpers/network.js';

/**
 * Screenshot comparisons of key pages in both themes. The viewport (desktop
 * and 390 px phone) comes from the projects in playwright.visual.config.js.
 *
 * Determinism: Math.random is seeded before the app loads, CDN scripts come
 * from node_modules, card art is a fixed transparent pixel (and masked), and
 * the regions that exist to be random (sample hands and casts, simulated
 * charts) are masked as well. A page whose capture differs between two runs
 * on the same machine needs another mask here: the "Update visual
 * baselines" workflow checks exactly that before uploading.
 */

const PAGES = {
    overview: { ready: '#ov-findings .finding', mask: [] },
    // Draw Odds opens on suggested questions; answer the first one.
    odds: { ready: '#odds-tab .bottom-line', mask: [], setup: page => page.locator('#odds-empty .odds-sug').first().click() },
    manabase: { ready: '#manabase-tab .bottom-line', mask: [] },
    hands: { ready: '#hands-tab .bottom-line', mask: ['#hl-cards', '#hl-lane'] },
    wildpair: { ready: '#wildpair-tab .bottom-line', mask: [] },
    // The chart's payback line is simulated, and idle-time work shares the
    // seeded Math.random in a timing-dependent order, so it moves slightly.
    surge: { ready: '#surge-tab .bottom-line', mask: ['#surge-samples', '#surge-chart'] }
};

for (const theme of ['dark', 'light']) {
    for (const [tab, { ready, mask, setup }] of Object.entries(PAGES)) {
        test(`${tab} (${theme})`, async ({ page }) => {
            await isolateNetwork(page);
            await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
            await page.addInitScript(chosen => {
                localStorage.clear();
                localStorage.setItem('deckOracle.theme', chosen);
                // mulberry32 with a fixed seed: sample hands and simulations repeat exactly.
                let seed = 0x5eed;
                Math.random = () => {
                    seed = (seed + 0x6d2b79f5) | 0;
                    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
                    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
                };
            }, theme);

            await page.goto(`/?tab=${tab}`);
            await expect(page.locator(`#${tab}-tab`)).not.toHaveClass(/is-loading/);
            await setup?.(page);
            await expect(page.locator(ready).first()).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            expect(await page.evaluate(() => document.fonts.check('16px Geist')),
                'Geist did not load from Google Fonts; screenshots would use a fallback font').toBe(true);
            await page.evaluate(() => {
                // A canvas keeps whatever font its text was drawn with: a chart
                // drawn before the web fonts arrived shows a fallback font until
                // it redraws. Redraw every chart now that the fonts are here.
                Object.values(window.Chart?.instances ?? {}).forEach(chart => chart.update('none'));
                // Sticky bars are drawn where the page is scrolled to, so capture from the top.
                document.activeElement?.blur?.();
                window.scrollTo({ top: 0, behavior: 'instant' });
            });

            await expect(page).toHaveScreenshot(`${tab}-${theme}.png`, {
                fullPage: true,
                mask: [page.locator('img'), ...mask.map(selector => page.locator(selector))]
            });
        });
    }
}
