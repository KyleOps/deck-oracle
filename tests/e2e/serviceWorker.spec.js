import { expect, test } from '@playwright/test';

/**
 * Offline support: the service worker registers for a first-time visitor and
 * the app then reloads without a network.
 *
 * main.js keeps the worker off on localhost and 127.0.0.1 (it would serve
 * stale files during development). A `*.localhost` name still reaches the test
 * server and is a secure context, but is not on that list, so under it the
 * page behaves exactly as it does on GitHub Pages.
 *
 * Registration once waited for a `load` event that had always fired by the
 * time main.js asked for it, so the worker never registered and nothing
 * failed. This test is the one that notices.
 */

test('registers the service worker after the first page, then works offline', async ({ page, context, baseURL }) => {
    test.setTimeout(60_000);
    const origin = `http://deck-oracle.localhost:${new URL(baseURL).port}`;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // A slow network: the landing page's lazy modules arrive well after the
    // window `load` event, as they do on a phone. Third-party requests are
    // answered at once (web fonts would otherwise hold `load` back).
    await page.route(url => url.origin !== origin, route => (route.request().resourceType() === 'stylesheet'
        ? route.fulfill({ body: '', contentType: 'text/css' })
        : route.abort('blockedbyclient')));
    await page.route('**/js/views/overview.js', async route => {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await route.continue();
    });
    await page.goto(`${origin}/`);
    await expect(page.locator('.finding').first()).toBeVisible();
    await page.unrouteAll();

    // Registration waits for load + first paint + idle; the install then
    // precaches every asset and activation claims this page.
    const scope = await page.evaluate(() => Promise.race([
        navigator.serviceWorker.ready.then(reg => reg.scope),
        new Promise(resolve => setTimeout(() => resolve('no service worker after 20 s'), 20_000))
    ]));
    expect(scope).toBe(`${origin}/`);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.finding').first()).toBeVisible();
    await expect(page.locator('#deck-switcher-meta')).toContainText('100 cards');
    expect(errors).toEqual([]);
});
