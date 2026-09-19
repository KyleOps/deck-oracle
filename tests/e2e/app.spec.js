import { expect, test } from '@playwright/test';

function capturePageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

test('starts on Wild Pair with matching navigation and content', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');

    await expect(page.locator('body')).toHaveClass('theme-wildpair');
    await expect(page.locator('.tx-tab[data-tab="wildpair"]')).toHaveClass(/active/);
    await expect(page.locator('#wildpair-tab')).toHaveClass(/active/);
    await expect(page.locator('#wildpair-total-display')).not.toHaveText('—');
    expect(errors).toEqual([]);
});

test('switches groups and renders calculators from the registry', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');

    await page.locator('.tx-group[data-group="spells"]').click();
    await page.locator('.tx-tab[data-tab="wave"]').click();

    await expect(page.locator('body')).toHaveClass('theme-wave');
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    await expect(page.locator('#wave-stats')).toContainText('PAYBACK CHANCE');

    await page.locator('.tx-group[data-group="deck-tools"]').click();
    await page.locator('.tx-tab[data-tab="lands"]').click();

    await expect(page.locator('body')).toHaveClass('theme-lands');
    await expect(page.locator('#lands-tab')).toHaveClass(/active/);
    expect(errors).toEqual([]);
});

test('restores a shared calculator and its input before the canonical render', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=wave&waveX=8');

    await expect(page.locator('body')).toHaveClass('theme-wave');
    await expect(page.locator('.tx-tab[data-tab="wave"]')).toHaveClass(/active/);
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    await expect(page.locator('#wave-xSlider')).toHaveValue('8');
    await expect(page.locator('#wave-stats')).toContainText('Genesis Wave at X=8');
    expect(errors).toEqual([]);
});

test('updates the visible calculator after a deck edit', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=wave&waveX=6');

    const before = await page.locator('#wave-stats').textContent();
    await page.locator('#deck-lands').fill('20');
    await expect.poll(async () => page.locator('#wave-stats').textContent()).not.toBe(before);

    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    expect(errors).toEqual([]);
});
