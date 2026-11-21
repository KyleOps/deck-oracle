import { expect, test } from '@playwright/test';

/**
 * Game Plan in a real browser: the simulation runs in slices without console
 * errors and renders every section, the editor changes the answer, the plan
 * survives a share link, and a preset loads its deck through the deck library.
 */

function capturePageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() !== 'error') return;
        if (/Failed to load resource/.test(message.text())) return;
        errors.push(message.text());
    });
    return errors;
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('__e2e_init')) {
            localStorage.clear();
            sessionStorage.setItem('__e2e_init', '1');
        }
    });
});

/** The bottom line once all games are in ('pending' while the first answer is still being refined). */
const answer = async tab => ((await tab.locator('#gp-summary .gp-pending').count()) ? 'pending' : tab.locator('.bottom-line').textContent());
const settled = async tab => {
    await expect(tab.locator('#gp-summary .gp-pending')).toHaveCount(0);
    return tab.locator('.bottom-line').textContent();
};

test('game plan answers for the example Commander deck with a plan built from it', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');
    await page.locator('.nav-item[data-tab="plan"]').click();
    await expect(page).toHaveURL(/\?tab=plan$/);
    const tab = page.locator('#plan-tab');
    await expect(tab.locator('.bottom-line')).toContainText('pulls off its plan on time in');
    await expect(tab.locator('.tx-stat')).toHaveCount(4);
    await expect(tab.locator('#gp-steps .gp-step')).toHaveCount(4);
    await expect(tab.locator('#gp-steps .gp-step-read').first()).toContainText('Susan Foreman');
    await expect(tab.locator('#gp-funnel .gp-funnel-row')).toHaveCount(4);
    await expect(tab.locator('#gp-reasons .gp-reason').first()).toBeVisible();
    await expect(tab.locator('#gp-mana .viz-dot')).not.toHaveCount(0);
    await expect(tab.locator('#gp-samples .gp-game')).toHaveCount(4);
    await expect(tab.locator('#gp-rules')).toContainText('The Sixth Doctor');
    // Commander: everyone draws, so there is no turn-order choice.
    await expect(tab.locator('#gp-order-group')).toBeHidden();

    const before = await tab.locator('#gp-samples .gp-games').textContent();
    await tab.locator('#gp-reshuffle').click();
    await expect.poll(() => tab.locator('#gp-samples .gp-games').textContent()).not.toBe(before);
    expect(errors).toEqual([]);
});

test('editing the plan changes the answer, and the plan survives a share link', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=plan');
    const tab = page.locator('#plan-tab');
    await expect(tab.locator('.bottom-line')).toContainText('on time in');
    const first = await settled(tab);

    // The Doctor a turn earlier: a harder plan, a different answer.
    await tab.locator('#gp-steps .gp-step').nth(2).locator('[data-field="turn"]').selectOption('4');
    await expect(tab.locator('#gp-steps .gp-step').nth(2).locator('.gp-step-read')).toContainText('Turn 4: cast The Sixth Doctor');
    await expect.poll(async () => { const now = await answer(tab); return now !== 'pending' && now !== first; }).toBe(true);
    await expect(tab.locator('#gp-plan-meta')).toHaveText('your plan');

    // Add a mana step, then remove the last cast step.
    await tab.locator('#gp-add-step').click();
    const added = tab.locator('#gp-steps .gp-step').nth(4);
    await added.locator('[data-field="kind"]').selectOption('mana');
    await added.locator('[data-field="atLeast"]').fill('9');
    await expect(added.locator('.gp-step-read')).toContainText('have 9+ mana');
    await tab.locator('#gp-steps .gp-step').nth(3).locator('[data-act="remove"]').click();
    await expect(tab.locator('#gp-steps .gp-step')).toHaveCount(4);
    await expect(tab.locator('#gp-funnel .gp-funnel-row')).toHaveCount(4);
    await expect(tab.locator('#gp-mana-title')).toContainText('Mana on turn 8');

    const link = await page.evaluate(async () => (await import('/js/utils/share.js')).getShareUrl('plan'));
    const gp = new URL(link).searchParams.get('gp');
    expect(gp).toMatch(/^2ck\.nSusan\*20Foreman_4cr\.v0w4_4ck\.nThe\*20Sixth\*20Doctor_8m9$/);

    // A fresh visit to the link restores the plan into the editor.
    const fresh = await page.context().newPage();
    fresh.on('pageerror', error => errors.push(error.message));
    await fresh.goto(link.replace(/^https?:\/\/[^/]+/, ''));
    const freshTab = fresh.locator('#plan-tab');
    await expect(freshTab.locator('#gp-steps .gp-step')).toHaveCount(4);
    await expect(freshTab.locator('#gp-steps .gp-step-read').nth(3)).toContainText('Turn 8: have 9+ mana');
    await expect(freshTab.locator('#gp-plan-meta')).toHaveText('from a shared link');
    await expect.poll(() => answer(freshTab)).toBe(await settled(tab));
    expect(errors).toEqual([]);
});

test('a preset loads its deck and plan, and a matching deck is offered its plan', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=plan');
    const tab = page.locator('#plan-tab');
    await expect(tab.locator('.bottom-line')).toContainText('on time in');

    // The example deck is Doctor Whostoric: its tuned plan is offered.
    await expect(tab.locator('#gp-preset')).toContainText('This deck looks like Doctor Whostoric');

    await tab.locator('#gp-preset-select').selectOption('wild-splendor');
    await expect(tab.locator('#gp-preset')).toContainText('Loads its 100-card deck');
    await tab.locator('#gp-preset-try').click();
    await expect(page.locator('#deck-switcher-name')).toHaveText('Wild Splendor');
    await expect(tab.locator('#gp-plan-meta')).toHaveText('a tuned plan');
    await expect(tab.locator('.bottom-line')).toContainText('Wild Splendor pulls off its plan');
    await expect(tab.locator('#gp-steps .gp-step')).toHaveCount(4);
    await expect(tab.locator('#gp-steps .gp-step-read').nth(2)).toContainText('spend 8+ mana');
    await expect(tab.locator('#gp-funnel .gp-funnel-row')).toHaveCount(3);
    // The notes, the measured distributions and the literal "two 4-drops or one 7–9-drop", measured beside the plan.
    await expect(tab.locator('#gp-about-panel')).toBeVisible();
    await expect(tab.locator('#gp-about p')).not.toHaveCount(0);
    await expect(tab.locator('#gp-measures')).toContainText('measure only');
    await expect(tab.locator('#gp-measures .viz-dot')).not.toHaveCount(0);
    await expect(tab.locator('#gp-rules')).toContainText('Selvala, Eager Trailblazer');
    const saved = await page.evaluate(async () => (await import('/js/utils/deckLibrary.js')).listDecks().map(d => d.name));
    expect(saved).toContain('Wild Splendor');

    // Start over: the starter plan built from this deck; the preset is offered back.
    await tab.locator('#gp-reset').click();
    await expect(tab.locator('#gp-plan-meta')).toHaveText('built from this deck');
    await expect(tab.locator('#gp-preset')).toContainText('This deck looks like');
    await tab.locator('#gp-preset [data-act="use-preset"]').click();
    await expect(tab.locator('#gp-plan-meta')).toHaveText('a tuned plan');
    expect(errors).toEqual([]);
});
