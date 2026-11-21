import { expect, test } from '@playwright/test';
import { isolateNetwork } from './helpers/network.js';

/**
 * Revisits and charts.
 *
 * A revisit skips the page's updateUI() when nothing it shows has changed
 * (calculatorBase.js "Revisit stamps") — so these tests check the other half
 * just as hard: a page whose inputs changed while it was hidden must render
 * again. Charts are built after the answer has painted; one whose page was
 * left before that must still be built when the page comes back.
 */

function capturePageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

/** The bottom line element now on a page (a re-render replaces it). */
const tagBottomLine = (page, tab) => page.evaluate(tab => {
    window.__probe = document.querySelector(`#${tab}-tab .bottom-line`);
    return Boolean(window.__probe);
}, tab);
const sameBottomLine = (page, tab) => page.evaluate(tab => document.querySelector(`#${tab}-tab .bottom-line`) === window.__probe, tab);
const chartId = (page, canvas) => page.evaluate(id => window.Chart?.getChart(document.getElementById(id))?.id ?? null, canvas);

test.beforeEach(async ({ page }) => {
    await isolateNetwork(page, { fonts: false });
    await page.addInitScript(() => localStorage.clear());
});

test('a revisit re-renders only a page whose inputs changed', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=wave');
    await expect(page.locator('#wave-tab .bottom-line')).toBeVisible();
    await expect.poll(() => chartId(page, 'wave-chart')).not.toBeNull();
    const firstChart = await chartId(page, 'wave-chart');

    // Away and back with nothing changed: the same render, the same chart.
    expect(await tagBottomLine(page, 'wave')).toBe(true);
    await page.locator('.nav-item[data-tab="overview"]').click();
    await expect(page.locator('#overview-tab')).toHaveClass(/active/);
    await page.locator('.nav-item[data-tab="wave"]').click();
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    expect(await sameBottomLine(page, 'wave')).toBe(true);
    expect(await chartId(page, 'wave-chart')).toBe(firstChart);

    // The deck changes while the page is hidden: it renders again on return.
    const before = await page.locator('#wave-stats').textContent();
    await page.locator('.nav-item[data-tab="overview"]').click();
    await page.locator('#deck-btn').click();
    await page.locator('#deck-tab-manual').click();
    await page.locator('#deck-lands').fill('20');
    await page.keyboard.press('Escape');
    await page.locator('.nav-item[data-tab="wave"]').click();
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    expect(await sameBottomLine(page, 'wave')).toBe(false);
    await expect.poll(() => page.locator('#wave-stats').textContent()).not.toBe(before);

    // The theme changes while it is hidden: re-rendered, chart rebuilt in the new colours.
    expect(await tagBottomLine(page, 'wave')).toBe(true);
    const chartBefore = await chartId(page, 'wave-chart');
    await page.locator('.nav-item[data-tab="overview"]').click();
    await page.locator('#theme-toggle').click();
    await page.locator('.nav-item[data-tab="wave"]').click();
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    expect(await sameBottomLine(page, 'wave')).toBe(false);
    await expect.poll(() => chartId(page, 'wave-chart')).not.toBe(chartBefore);
    expect(errors).toEqual([]);
});

test('an input changed just before leaving still shows on return', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=wave');
    await expect(page.locator('#wave-tab .bottom-line')).toBeVisible();
    // The page re-renders on a short debounce; leave before it fires.
    await page.evaluate(async () => {
        const slider = document.getElementById('wave-xSlider');
        slider.value = '11';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const router = await import('/js/shell/router.js');
        await router.navigate('overview');
    });
    await page.waitForTimeout(400); // the debounce fires while the page is hidden
    await page.locator('.nav-item[data-tab="wave"]').click();
    await expect(page.locator('#wave-tab')).toContainText('X=11');
    expect(errors).toEqual([]);
});

test('charts are built after the answer, even when their page was left first', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=chimil');
    await expect(page.locator('#chimil-tab .bottom-line')).toBeVisible();
    await expect.poll(() => chartId(page, 'chimil-chart')).not.toBeNull();

    // Open a chart page and leave in the same task, before its chart is built.
    await page.evaluate(async () => {
        const router = await import('/js/shell/router.js');
        await router.navigate('vortex');
        await router.navigate('overview');
    });
    await page.waitForTimeout(300);
    expect(await chartId(page, 'vortex-chart')).toBeNull();
    await page.locator('.nav-item[data-tab="vortex"]').click();
    await expect(page.locator('#vortex-tab .bottom-line')).toBeVisible();
    await expect.poll(() => chartId(page, 'vortex-chart')).not.toBeNull();
    expect(errors).toEqual([]);
});
