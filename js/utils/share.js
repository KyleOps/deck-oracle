/**
 * Share links — deep links to a page, its deck, and its settings.
 *
 * URL shape: `?tab=<key>&deck=<moxfield/archidekt url>&<page params>`
 *
 * Calculators load lazily, so applying a link is: import the deck, mount the
 * target page, then hand it its parameters. A page's settings get into a link
 * through its own module, in two ways:
 *   1. `export const shareInputs = [{ param, id, min, max, float? }]` — inputs
 *      carried as they are: share.js reads the value into the link and, on
 *      the way back, bounds it and sets the input (firing input/change, so
 *      the page reacts as if the reader had typed it). Parameter names and
 *      input ids are part of every link already shared: never rename them.
 *   2. `getShareParams()` → {param: value} and `applyShareParams(params)` for
 *      everything else (validate and clamp every value).
 * share.js itself knows no page: only the deck, the opponents and the tab.
 */

import * as DeckConfig from './deckConfig.js';
import * as OpponentState from './opponentState.js';
import { getCalculator, getLoadedModule } from './calculatorRegistry.js';

export const ALLOWED_DECK_HOSTS = Object.freeze(['moxfield.com', 'www.moxfield.com', 'archidekt.com', 'www.archidekt.com']);

/**
 * Parameters packed with LZ-String (loaded on demand): a link carrying one
 * needs it before the link is applied.
 */
export const PACKED_PARAMS = Object.freeze(['mullTypes']);

const OPPONENT_PARAMS = [
    ['maraOpp1', 'dhOpp1', 'opp1'],
    ['maraOpp2', 'dhOpp2', 'opp2'],
    ['maraOpp3', 'dhOpp3', 'opp3']
];

/** Validate an external deck URL against the import allowlist. */
export function isAllowedDeckUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ALLOWED_DECK_HOSTS.includes(url.hostname);
    } catch {
        return false;
    }
}

/** Parse a numeric param within bounds, or null. */
export function boundedNumber(raw, { min, max, float = false }) {
    if (raw === null || raw === undefined || raw === '') return null;
    const value = float ? parseFloat(raw) : parseInt(raw, 10);
    if (Number.isNaN(value) || value < min || value > max) return null;
    return value;
}

function setInput(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Apply the current URL's share parameters.
 * @param {{ensureMounted:(tab:string)=>Promise<any>}} hooks - mounts a page
 * @returns {Promise<string|null>} the requested tab, if valid
 */
export async function applyShareUrl({ ensureMounted } = {}) {
    const params = new URLSearchParams(window.location.search);

    // 1. Deck — validated against the import allowlist
    const deckUrl = params.get('deck');
    if (deckUrl) {
        if (isAllowedDeckUrl(deckUrl)) {
            try {
                await DeckConfig.loadDeckFromUrl(deckUrl);
            } catch (e) {
                console.error('Failed to load deck from share link', e);
            }
        } else {
            console.warn('Ignoring deck link from an unsupported site');
        }
    }

    // 2. Opponents (multiplayer pages)
    const oppJobs = OPPONENT_PARAMS.map((names, i) => {
        const value = names.map(n => params.get(n)).find(Boolean);
        if (!value) return null;
        if (!isAllowedDeckUrl(value)) {
            console.warn(`Ignoring opponent ${i + 1} link from an unsupported site`);
            return null;
        }
        return OpponentState.setOpponentUrl(`opponent${i + 1}`, value).catch(e =>
            console.error(`Failed to load opponent ${i + 1} deck`, e));
    }).filter(Boolean);
    await Promise.all(oppJobs);

    // 3. The page and its settings
    const tab = params.get('tab');
    if (!getCalculator(tab)) return null;
    const hasPageParams = [...params.keys()].some(k => !['tab', 'deck'].includes(k));
    if (!hasPageParams || !ensureMounted) return tab;

    try {
        const record = await ensureMounted(tab);
        applyPageParams(params, record?.module, tab);
    } catch (err) {
        console.error('Could not apply shared settings', err);
    }
    return tab;
}

/**
 * Hand a mounted page its link parameters: its `shareInputs` (bounded, out
 * of range ignored), then its own applyShareParams().
 * @param {URLSearchParams} params
 * @param {Object|null} module - the page's module
 * @param {string} [tab] - for messages
 */
export function applyPageParams(params, module, tab = 'page') {
    for (const input of module?.shareInputs ?? []) {
        const value = boundedNumber(params.get(input.param), input);
        if (value !== null) setInput(input.id, value);
        else if (params.has(input.param)) console.warn(`Ignoring out-of-range ${input.param}`);
    }
    try {
        module?.applyShareParams?.(params);
    } catch (err) {
        console.error(`${tab} rejected its share params`, err);
    }
}

/**
 * A mounted page's own link parameters: its `shareInputs` as they stand,
 * then whatever getShareParams() adds.
 * @param {Object|null} module
 * @param {string} [tab] - for messages
 * @returns {Array<[string, string]>}
 */
export function pageShareParams(module, tab = 'page') {
    const out = [];
    for (const input of module?.shareInputs ?? []) {
        const el = document.getElementById(input.id);
        if (el && el.value !== '') out.push([input.param, String(el.value)]);
    }
    try {
        Object.entries(module?.getShareParams?.() ?? {}).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') out.push([k, String(v)]);
        });
    } catch (err) {
        console.error(`${tab} failed to build share params`, err);
    }
    return out;
}

/**
 * Build a share link for a page.
 * @param {string} tab - the visible page
 */
export function getShareUrl(tab) {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);

    const deck = DeckConfig.getDeckConfig();
    if (deck.importUrl && deck.importUrl !== DeckConfig.DEFAULT_DECK_URL && isAllowedDeckUrl(deck.importUrl)) {
        params.set('deck', deck.importUrl);
    }

    if (getCalculator(tab)?.needsOpponents) {
        const urls = OpponentState.getOpponentUrls();
        ['opponent1', 'opponent2', 'opponent3'].forEach((key, i) => {
            if (urls[key] && isAllowedDeckUrl(urls[key])) params.set(`opp${i + 1}`, urls[key]);
        });
    }

    for (const [k, v] of pageShareParams(getLoadedModule(tab), tab)) params.set(k, v);

    url.search = params.toString();
    url.hash = '';
    return url.toString();
}
