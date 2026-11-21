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

test('a mulligan link made before 3.2 (a colour per row) still restores its rows and inputs', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await isolateNetwork(page, { fonts: false });
    await page.addInitScript(() => localStorage.clear());
    // [[1,'Legacy lands',30,2,2,'e2a84b'],[2,'Legacy ramp',9,1,3,'']], packed the old way.
    const legacy = 'NrCMBoCIBkFMHMCGBjAngAgDaIHYBMBnScAZgAZwAmKqWSxADgBYAjSAXXGGpgRQwBOiALYAHYgE5wEElA7sgA';
    await page.goto(`/?tab=mulligan&mullTypes=${legacy}&mullPenalty=30&mullThreshold=60&mullSims=800`);
    await expect(page.locator('#mulligan-tab .bottom-line')).toBeVisible();
    const state = await page.evaluate(async () => {
        const { types, penalty, confidenceThreshold } = (await import('/js/calculators/mulligan.js')).getState();
        return { names: types.map(t => t.name), penalty, confidenceThreshold, sims: document.getElementById('mulligan-sample-count').value };
    });
    expect(state).toEqual({ names: ['Legacy lands', 'Legacy ramp'], penalty: 0.3, confidenceThreshold: 0.6, sims: '800' });
    expect(errors).toEqual([]);
});
