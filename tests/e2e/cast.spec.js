import { expect, test } from '@playwright/test';
import { isolateNetwork } from './helpers/network.js';

/**
 * "Cast it" on Primal Surge and Genesis Wave (js/utils/castAnimation.js):
 * one shuffle resolved card by card, skippable, keyboard-friendly, and never
 * left showing another deck's cards.
 */

test.beforeEach(async ({ page }) => {
    await isolateNetwork(page);
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('__e2e_init')) {
            localStorage.clear();
            sessionStorage.setItem('__e2e_init', '1');
        }
    });
});

test('Skip lands every card turned over so far, even one still mid-flight', async ({ page }) => {
    await page.goto('/?tab=surge');
    await expect(page.locator('#surge-tab .bottom-line')).toBeVisible();

    // Skip at the exact moment a card has turned over but not yet landed in
    // its row: the observer runs right after the step that turns the card.
    const result = await page.evaluate(() => new Promise(resolve => {
        const stage = document.getElementById('surge-cast');
        document.getElementById('surge-cast-btn').click();
        const library = Number.parseInt(stage.querySelector('.cast-left').textContent, 10);
        const status = stage.querySelector('.cast-status');
        new MutationObserver((_, observer) => {
            if (!status.querySelector('strong')) return;
            observer.disconnect();
            stage.querySelector('[data-cast="skip"]').click();
            const left = Number.parseInt(stage.querySelector('.cast-left').textContent, 10);
            const more = [...stage.querySelectorAll('.cast-more')]
                .reduce((sum, el) => sum + Number.parseInt(el.textContent.replace(/\D/g, ''), 10), 0);
            resolve({ revealed: library - left, placed: stage.querySelectorAll('.cast-mini').length + more });
        }).observe(status, { childList: true, subtree: true });
    }));

    expect(result.revealed).toBeGreaterThan(0);
    expect(result.placed).toBe(result.revealed);
});

test('keyboard focus stays on a live button through Skip and Cast again', async ({ page }) => {
    await page.goto('/?tab=surge');
    await expect(page.locator('#surge-tab .bottom-line')).toBeVisible();
    const stage = page.locator('#surge-cast');

    await page.locator('#surge-cast-btn').focus();
    await page.keyboard.press('Enter');
    await expect(stage.locator('[data-cast="skip"]')).toBeVisible();
    await stage.locator('[data-cast="skip"]').focus();
    await page.keyboard.press('Enter');
    await expect(stage.locator('.cast')).toHaveAttribute('data-state', 'done');
    await expect(stage.locator('[data-cast="again"]')).toBeFocused();

    // "Cast again" rebuilds the panel; focus moves to its new controls.
    await page.keyboard.press('Enter');
    await expect.poll(() => stage.evaluate(el => el.contains(document.activeElement))).toBe(true);
    // Let it finish on its own: a focused Skip hands focus to Cast again.
    await expect(stage.locator('.cast')).toHaveAttribute('data-state', 'done', { timeout: 5000 });
    await expect(stage.locator('[data-cast="again"]')).toBeFocused();
});

test('a cast closes when the deck changes', async ({ page }) => {
    await page.goto('/?tab=wave&waveX=6');
    await expect(page.locator('#wave-stats')).not.toBeEmpty();
    const stage = page.locator('#wave-cast');
    await page.locator('#wave-cast-btn').click();
    await expect(stage).toBeVisible();

    await page.locator('#deck-btn').click();
    await page.locator('#deck-tab-manual').click();
    await page.locator('#deck-lands').fill('20');
    await page.keyboard.press('Escape');

    await expect(page.locator('#deck-switcher-meta')).toContainText('counts only');
    await expect(stage).toBeHidden();
    await expect(stage).toBeEmpty();
});
