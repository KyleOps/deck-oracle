import { expect, test } from '@playwright/test';

/**
 * Collect page errors and console errors. Failed loads of decorative third-party
 * images (Scryfall art) are ignored: they depend on the network, not on us.
 */
function capturePageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (/Failed to load resource/.test(text)) return;
        errors.push(text);
    });
    return errors;
}

test.beforeEach(async ({ page }) => {
    // Each test starts from a clean browser profile: no saved decks, no theme.
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('__e2e_init')) {
            localStorage.clear();
            sessionStorage.setItem('__e2e_init', '1');
        }
    });
});

test('opens on the deck overview with the example deck', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');

    await expect(page).toHaveURL(/\?tab=overview$/);
    await expect(page.locator('#overview-tab')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-tab="overview"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.ov-hero-name')).toContainText('Doctor Whostoric');
    await expect(page.locator('.finding').first()).toBeVisible();
    // The example is a 98-card list with two commanders in the command zone,
    // counted the way players count it: 98 + 2 = 100.
    await expect(page.locator('#deck-switcher-meta')).toContainText('100 cards · Commander');
    expect(errors).toEqual([]);
});

test('navigates with the sidebar, lazy-loads the page, and supports back/forward', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');

    await page.locator('.nav-item[data-tab="wave"]').click();
    await expect(page).toHaveURL(/\?tab=wave$/);
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    await expect(page.locator('#wave-tab .page-title')).toContainText('Genesis Wave');
    await expect(page.locator('#wave-tab .page-question')).toBeVisible();
    await expect(page.locator('#crumb-page')).toHaveText('Genesis Wave');

    await page.locator('.nav-item[data-tab="lands"]').click();
    await expect(page.locator('#lands-tab')).toHaveClass(/active/);

    await page.goBack();
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    await page.goBack();
    await expect(page.locator('#overview-tab')).toHaveClass(/active/);
    await page.goForward();
    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    expect(errors).toEqual([]);
});

test('restores a shared calculator and its input before the first render', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=wave&waveX=8');

    await expect(page.locator('#wave-tab')).toHaveClass(/active/);
    await expect(page.locator('#wave-xSlider')).toHaveValue('8');
    await expect(page.locator('#wave-tab')).toContainText('X=8');
    expect(errors).toEqual([]);
});

test('re-renders the visible calculator after a manual deck edit', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/?tab=wave&waveX=6');
    await expect(page.locator('#wave-stats')).not.toBeEmpty();
    const before = await page.locator('#wave-stats').textContent();

    await page.locator('#deck-btn').click();
    await page.locator('#deck-tab-manual').click();
    await page.locator('#deck-lands').fill('20');
    await page.keyboard.press('Escape');

    await expect.poll(async () => page.locator('#wave-stats').textContent()).not.toBe(before);
    await expect(page.locator('#deck-switcher-meta')).toContainText('counts only');
    expect(errors).toEqual([]);
});

test('command palette finds calculators and actions', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');

    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette')).toBeVisible();
    await page.locator('#palette-input').fill('primal');
    await page.keyboard.press('Enter');
    // Straight away, while the page is still loading: focus is still on the
    // closed palette's input, and shortcuts must not mistake that for typing.
    await page.keyboard.press('/');

    await expect(page).toHaveURL(/\?tab=surge$/);
    await expect(page.locator('#surge-tab')).toHaveClass(/active/);

    await page.locator('#palette-input').fill('paste');
    await page.keyboard.press('Enter');
    await expect(page.locator('#deck-dialog')).toBeVisible();
    await expect(page.locator('#deck-pane-paste')).toBeVisible();
    expect(errors).toEqual([]);
});

test('theme toggle switches to light and persists', async ({ page }) => {
    await page.goto('/');
    const initial = await page.locator('html').getAttribute('data-theme');
    await page.locator('#theme-toggle').click();
    const toggled = initial === 'light' ? 'dark' : 'light';
    await expect(page.locator('html')).toHaveAttribute('data-theme', toggled);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', toggled);
});

test('restores the last active saved deck on reload', async ({ page }) => {
    const errors = capturePageErrors(page);
    await page.goto('/');
    await page.evaluate(async () => {
        const Library = await import('/js/utils/deckLibrary.js');
        const DeckConfig = await import('/js/utils/deckConfig.js');
        const cards = {
            Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, category: 'lands', allCategories: ['lands'], count: 24 },
            Elves: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, mana_cost: '{G}', category: 'creatures', allCategories: ['creatures'], count: 36, oracle_text: '{T}: Add {G}.' }
        };
        const id = Library.saveDeck({
            deckName: 'Sixty Elves', importSource: 'paste', creatures: 36, lands: 24,
            actualCardCount: 60, cardDetails: [], cardsByName: cards
        });
        DeckConfig.loadSavedDeck(id);
    });
    await expect(page.locator('#deck-switcher-name')).toHaveText('Sixty Elves');

    await page.reload();
    await expect(page.locator('#deck-switcher-name')).toHaveText('Sixty Elves');
    await expect(page.locator('#deck-switcher-meta')).toContainText('60 cards');
    await expect(page.locator('#deck-switcher-meta')).toContainText('Constructed');
    expect(errors).toEqual([]);
});

test('every calculator mounts without errors', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = capturePageErrors(page);
    await page.goto('/');
    const tabs = await page.locator('.nav-item[data-tab]').evaluateAll(items => items.map(i => i.dataset.tab));
    expect(tabs.length).toBeGreaterThanOrEqual(19);
    for (const tab of tabs) {
        await page.locator(`.nav-item[data-tab="${tab}"]`).click();
        await expect(page.locator(`#${tab}-tab`)).toHaveClass(/active/);
        await expect(page.locator(`#${tab}-tab`)).not.toHaveClass(/is-loading/);
    }
    expect(errors).toEqual([]);
});

test('mobile: the sidebar is a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const sidebar = page.locator('#sidebar');
    await expect(page.locator('#nav-toggle')).toBeVisible();
    await expect(sidebar).not.toBeInViewport();

    await page.locator('#nav-toggle').click();
    await expect(sidebar).toBeInViewport();
    await page.locator('.nav-item[data-tab="lands"]').click();
    await expect(page.locator('#lands-tab')).toHaveClass(/active/);
    await expect(sidebar).not.toBeInViewport();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
