import { expect, test } from '@playwright/test';
import { isolateNetwork } from './helpers/network.js';
import { ARCHIDEKT_DECK, MOXFIELD_DECK, PASTED_DOCTOR_LIST, collectionResponse, fuzzyCard } from '../fixtures/deckSites.js';

/**
 * Deck import in the browser: every commander kept from all three sources,
 * friendly errors, the newest import winning, and the import code and the
 * opponents bar loading only when needed. Deck sites and Scryfall answer from
 * fixtures (tests/fixtures/deckSites.js); nothing leaves the machine.
 */

const PROXY_HOST = 'hidden-river-b602.kylepettigrew.workers.dev';

/** Answer the proxy and Scryfall from fixtures; `proxy` can override the deck site's answer. */
async function fakeDeckSites(page, { proxy } = {}) {
    await isolateNetwork(page, { fonts: false });
    await page.route(url => url.hostname === 'api.scryfall.com', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/cards/collection') {
            return route.fulfill({ json: collectionResponse(route.request().postData()) });
        }
        const card = url.pathname === '/cards/named' ? fuzzyCard(url.searchParams.get('fuzzy') ?? '') : null;
        return card ? route.fulfill({ json: card }) : route.fulfill({ status: 404, json: { details: 'Not found' } });
    });
    await page.route(url => url.hostname === PROXY_HOST, route => {
        if (proxy) return proxy(route);
        const target = new URL(route.request().url()).searchParams.get('url') ?? '';
        const body = target.includes('archidekt.com') ? ARCHIDEKT_DECK : MOXFIELD_DECK;
        return route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    });
}

function capturePageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

/** Module paths the page requested. */
function trackModules(page) {
    const paths = new Set();
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.endsWith('.js')) paths.add(url.pathname);
    });
    return paths;
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        if (!sessionStorage.getItem('__e2e_init')) {
            localStorage.clear();
            sessionStorage.setItem('__e2e_init', '1');
        }
    });
});

test('a pasted list keeps both commanders and counts them: 98 + 2 = 100 cards', async ({ page }) => {
    const errors = capturePageErrors(page);
    const modules = trackModules(page);
    await fakeDeckSites(page);
    await page.goto('/');
    await expect(page.locator('.finding').first()).toBeVisible();
    expect([...modules].some(p => p.endsWith('/decklistImport.js')), 'the importer is not part of startup').toBe(false);

    await page.locator('#deck-btn').click();
    await page.locator('#deck-tab-paste').click();
    await page.locator('#decklist-input').fill(PASTED_DOCTOR_LIST);
    await page.locator('#import-btn').click();

    await expect(page.locator('#deck-switcher-name')).toHaveText('The Sixth Doctor + Susan Foreman');
    await expect(page.locator('#deck-switcher-meta')).toHaveText('100 cards · Commander');
    await expect(page.locator('#deck-switcher-meta')).toHaveAttribute('title', '98 in the library + 2 commanders');
    expect([...modules].some(p => p.endsWith('/decklistImport.js')), 'loaded on the first import').toBe(true);

    // Saved decks list both commanders and the same count.
    await page.locator('#deck-btn').click();
    await page.locator('#deck-tab-saved').click();
    const saved = page.locator('.saved-deck.active .saved-deck-meta');
    await expect(saved).toContainText('100 cards');
    await expect(page.locator('.saved-deck.active .saved-deck-name')).toHaveText('The Sixth Doctor + Susan Foreman');

    // And both survive a reload.
    await page.reload();
    await expect(page.locator('#deck-switcher-name')).toHaveText('The Sixth Doctor + Susan Foreman');
    const commanders = await page.evaluate(async () => (await import('/js/utils/deckConfig.js')).getCommanderNames());
    expect(commanders).toEqual(['The Sixth Doctor', 'Susan Foreman']);
    expect(errors).toEqual([]);
});

test('Moxfield and Archidekt links keep every commander', async ({ page }) => {
    const errors = capturePageErrors(page);
    await fakeDeckSites(page);
    await page.goto('/');

    await page.locator('#deck-btn').click();
    await page.locator('#moxfield-input').fill('https://moxfield.com/decks/abcdefgh12');
    await page.locator('#moxfield-import-btn').click();
    await expect(page.locator('#deck-switcher-name')).toHaveText('Tymna Kraum Blitz');
    await expect(page.locator('#deck-switcher-meta')).toHaveText('35 cards · Commander');
    expect(await page.evaluate(async () => (await import('/js/utils/deckConfig.js')).getCommanderNames()))
        .toEqual(['Tymna the Weaver', 'Kraum, Ludevic’s Opus']);
    // The sideboard warning keeps the dialog open to be read.
    await expect(page.locator('#import-status')).toContainText('Sideboard ignored (2 cards)');

    await page.locator('#moxfield-input').fill('https://archidekt.com/decks/1234567/ninth');
    await page.locator('#moxfield-import-btn').click();
    await expect(page.locator('#deck-switcher-name')).toHaveText('Ninth Doctor and Clara');
    await expect(page.locator('#deck-switcher-meta')).toHaveText('36 cards · Commander');
    const sol = await page.evaluate(async () => {
        const DeckConfig = await import('/js/utils/deckConfig.js');
        return { names: DeckConfig.getCommanderNames(), sol: DeckConfig.getDeckConfig().cardsByName['Sol Ring'] };
    });
    expect(sol.names).toEqual(['The Ninth Doctor', 'Clara Oswald']);
    expect(sol.sol.mana_cost).toBe('{1}');
    expect(sol.sol.oracle_text).toContain('Add {C}{C}');
    expect(errors).toEqual([]);
});

test('a deck-site failure reads as a sentence, not "Proxy error: HTTP 502"', async ({ page }) => {
    await fakeDeckSites(page, { proxy: route => route.fulfill({ status: 502, body: 'Bad gateway', headers: { 'access-control-allow-origin': '*' } }) });
    await page.goto('/');
    await page.locator('#deck-btn').click();
    await page.locator('#moxfield-input').fill('https://moxfield.com/decks/abcdefgh12');
    await page.locator('#moxfield-import-btn').click();
    const status = page.locator('#import-status');
    await expect(status).toHaveClass(/error/);
    await expect(status).toHaveText('The deck site isn’t answering right now (error 502). Try again in a minute.');
    await expect(page.locator('#moxfield-import-btn')).toBeEnabled();
});

test('a stalled link import never blocks a pasted list', async ({ page }) => {
    const errors = capturePageErrors(page);
    // The proxy never answers.
    await fakeDeckSites(page, { proxy: () => new Promise(() => {}) });
    await page.goto('/');
    await page.locator('#deck-btn').click();
    await page.locator('#moxfield-input').fill('https://moxfield.com/decks/abcdefgh12');
    await page.locator('#moxfield-import-btn').click();
    await expect(page.locator('#moxfield-import-btn')).toBeDisabled();

    await page.locator('#deck-tab-paste').click();
    await expect(page.locator('#import-btn')).toBeEnabled();
    await page.locator('#decklist-input').fill('24 Island\n1 Sol Ring\n1 Arcane Signet\n34 Island');
    await page.locator('#import-btn').click();
    await expect(page.locator('#deck-switcher-meta')).toHaveText('60 cards · Constructed');
    await expect(page.locator('#moxfield-import-btn')).toBeEnabled();
    expect(errors).toEqual([]);
});

test('the opponents bar loads only with the pages that use it', async ({ page }) => {
    const errors = capturePageErrors(page);
    const modules = trackModules(page);
    await fakeDeckSites(page);
    await page.goto('/');
    await expect(page.locator('.finding').first()).toBeVisible();
    await expect(page.locator('#opponents-config')).toBeHidden();
    expect([...modules].some(p => p.endsWith('/opponentBar.js'))).toBe(false);

    await page.locator('.nav-item[data-tab="mara"]').click();
    const bar = page.locator('#opponents-config');
    await expect(bar).toBeVisible();
    await expect(page.locator('#mara-tab #opponents-config')).toHaveCount(1);
    await expect(page.locator('#opp-seat-opponent1')).toHaveAttribute('aria-selected', 'true');
    expect([...modules].some(p => p.endsWith('/opponentBar.js'))).toBe(true);

    await page.locator('#shared-opponent1-input').fill('Commander\n1 Tymna the Weaver\nDeck\n1 Sol Ring\n9 Island');
    await page.locator('.opp-import').click();
    await expect(page.locator('#opp-seat-opponent1 .opp-seat-name')).toHaveText('Tymna the Weaver');
    await expect(page.locator('#opp-seat-opponent1 .opp-seat-meta')).toHaveText('10 cards · 9 lands');

    await page.locator('.nav-item[data-tab="overview"]').click();
    await expect(bar).toBeHidden();
    await page.locator('.nav-item[data-tab="dreamharvest"]').click();
    await expect(page.locator('#dreamharvest-tab #opponents-config')).toBeVisible();
    await expect(page.locator('#opp-seat-opponent1 .opp-seat-name')).toHaveText('Tymna the Weaver');
    expect(errors).toEqual([]);
});
