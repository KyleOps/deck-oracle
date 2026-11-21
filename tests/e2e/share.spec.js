import { expect, test } from '@playwright/test';
import { LZ_URL, isolateNetwork } from './helpers/network.js';

/**
 * LZ-String packs mulligan requirements into share links. It is not loaded
 * with the app (js/shell/vendor.js loads it on demand): a link that carries
 * requirements must still restore them, and a link made on the page must
 * still carry them.
 */

const shareUrl = page => page.evaluate(async () => (await import('/js/utils/share.js')).getShareUrl('mulligan'));

test('mulligan requirements survive a share link round trip', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await isolateNetwork(page, { fonts: false });
    await page.addInitScript(() => localStorage.clear());
    const lzRequests = [];
    page.on('request', request => { if (request.url() === LZ_URL) lzRequests.push(performance.now()); });

    await page.goto('/?tab=mulligan');
    await expect(page.locator('#mulligan-tab .bottom-line')).toBeVisible();
    // Loaded once the first page is up, so the share button never waits for it.
    await expect.poll(() => page.evaluate(() => typeof window.LZString)).toBe('object');
    // Requirements of our own, so a restore can't pass by matching the defaults.
    await page.evaluate(async () => {
        const mulligan = await import('/js/calculators/mulligan.js');
        mulligan.setCardTypes(mulligan.getState().types.map((t, i) => ({ ...t, name: `Shared ${i + 1}`, byTurn: 3 })));
    });
    const link = await shareUrl(page);
    const packed = new URL(link).searchParams.get('mullTypes');
    expect(packed, 'the link carries the requirements').toBeTruthy();

    // A fresh visit to the link: LZ-String loads before the link is applied.
    const fresh = await page.context().newPage();
    fresh.on('pageerror', error => errors.push(error.message));
    await isolateNetwork(fresh, { fonts: false });
    await fresh.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    await expect(fresh.locator('#mulligan-tab .bottom-line')).toBeVisible();
    const restored = await fresh.evaluate(async () => (await import('/js/calculators/mulligan.js')).getState().types.map(t => t.name));
    expect(restored[0]).toBe('Shared 1');
    expect(new URL(await shareUrl(fresh)).searchParams.get('mullTypes')).toBe(packed);
    expect(lzRequests.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});
