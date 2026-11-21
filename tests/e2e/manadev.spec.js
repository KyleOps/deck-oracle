import { expect, test } from '@playwright/test';

/**
 * Mana Development in a real browser: the simulation runs in slices without
 * console errors, renders every section, and answers to its settings.
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

test('mana development answers for the example Commander deck', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');
    await page.locator('.nav-item[data-tab="manadev"]').click();
    await expect(page).toHaveURL(/\?tab=manadev$/);
    const tab = page.locator('#manadev-tab');
    await expect(tab.locator('.bottom-line')).toContainText('The Sixth Doctor');
    await expect(tab.locator('.tx-stat')).toHaveCount(4);
    await expect(tab.locator('#md-grid tbody tr.is-target th')).toHaveText('6+');
    await expect(tab.locator('#md-ramp tbody tr').first()).toBeVisible();
    await expect(tab.locator('#md-samples .md-game')).toHaveCount(4);
    // Commander: no turn-order choice, everyone draws.
    await expect(tab.locator('#md-order-group')).toBeHidden();

    const before = await tab.locator('#md-samples .md-games').textContent();
    await tab.locator('#md-reshuffle').click();
    await expect.poll(() => tab.locator('#md-samples .md-games').textContent()).not.toBe(before);
    expect(errors).toEqual([]);
});

test('mana development offers turn order for a 60-card deck and shares it', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');
    await page.evaluate(async () => {
        const DeckConfig = await import('/js/utils/deckConfig.js');
        const forest = { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', category: 'lands', count: 22, color_identity: ['G'] };
        const elves = { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, mana_cost: '{G}', category: 'creatures', count: 30, oracle_text: '{T}: Add {G}.', color_identity: ['G'] };
        const hoof = { name: 'Craterhoof Behemoth', type_line: 'Creature — Beast', cmc: 8, mana_cost: '{5}{G}{G}{G}', category: 'creatures', count: 8, oracle_text: 'Haste', color_identity: ['G'] };
        DeckConfig.loadSnapshot({
            id: 'list:e2e-sixty', name: 'Sixty Elves', importSource: 'paste',
            counts: { lands: 22, creatures: 38 }, actualCardCount: 60,
            cardsByName: { Forest: forest, 'Llanowar Elves': elves, 'Craterhoof Behemoth': hoof }
        });
    });
    await page.locator('.nav-item[data-tab="manadev"]').click();
    const tab = page.locator('#manadev-tab');
    await expect(tab.locator('.bottom-line')).toContainText('top end');
    await expect(tab.locator('#md-order-group')).toBeVisible();

    const onPlay = await tab.locator('#md-grid').textContent();
    await tab.locator('[data-md-play="0"]').click();
    await expect(tab.locator('[data-md-play="0"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => tab.locator('#md-grid').textContent()).not.toBe(onPlay);

    const share = await page.evaluate(async () => (await import('/js/utils/share.js')).getShareUrl('manadev'));
    expect(share).toContain('mddraw=1');
    expect(errors).toEqual([]);
});
