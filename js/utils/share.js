/**
 * Share links — deep links to a page, its deck, and its settings.
 *
 * URL shape: `?tab=<key>&deck=<moxfield/archidekt url>&<page params>`
 *
 * Calculators load lazily, so applying a link is: import the deck, mount the
 * target page, then set its inputs. Two ways a page's settings get into a link:
 *   1. SLIDERS below — legacy input ids, kept so every old link still works
 *   2. a calculator module may export `getShareParams()` → {param: value} and
 *      `applyShareParams(URLSearchParams)`; new calculators use this instead of
 *      editing this file.
 */

import * as DeckConfig from './deckConfig.js';
import * as OpponentState from './opponentState.js';
import { getCalculator, getLoadedModule } from './calculatorRegistry.js';

export const ALLOWED_DECK_HOSTS = Object.freeze(['moxfield.com', 'www.moxfield.com', 'archidekt.com', 'www.archidekt.com']);

/** Input-backed settings, by page. min/max guard against crafted links. */
export const SLIDERS = Object.freeze([
    { tab: 'portent', param: 'portentX', id: 'portent-xSlider', min: 0, max: 20 },
    { tab: 'wave', param: 'waveX', id: 'wave-xSlider', min: 0, max: 30 },
    { tab: 'wave', param: 'waveLand', id: 'wave-land-value', min: 0, max: 20, float: true },
    { tab: 'wave', param: 'waveCard', id: 'wave-card-value', min: 0, max: 20, float: true },
    { tab: 'vow', param: 'vowX', id: 'vow-xSlider', min: 0, max: 30 },
    { tab: 'vow', param: 'vowLand', id: 'vow-land-value', min: 0, max: 20, float: true },
    { tab: 'vow', param: 'vowCard', id: 'vow-card-value', min: 0, max: 20, float: true },
    { tab: 'vortex', param: 'vortexCMC', id: 'vortex-cmcSlider', min: 5, max: 15 },
    { tab: 'rashmi', param: 'rashmiCMC', id: 'rashmi-cmcSlider', min: 0, max: 15 },
    { tab: 'lumra', param: 'lumraGY', id: 'lumra-gySlider', min: 0, max: 30 },
    { tab: 'lumra', param: 'lumraMult', id: 'lumra-multSlider', min: 1, max: 10 },
    { tab: 'lumra', param: 'lumraFetch', id: 'lumra-fetchLands', min: 0, max: 100 },
    { tab: 'lumra', param: 'lumraTurn', id: 'lumra-turnSlider', min: 1, max: 20 },
    { tab: 'chimil', param: 'chimilTurns', id: 'chimil-turnsSlider', min: 1, max: 20 },
    { tab: 'wildpair', param: 'wpTotal', id: 'wildpair-totalSlider', min: 0, max: 40 },
    { tab: 'surge', param: 'surgeThreshold', id: 'surge-payback-threshold', min: 0.25, max: 100, float: true },
    { tab: 'surge', param: 'surgeLand', id: 'surge-land-value', min: 0, max: 20, float: true },
    { tab: 'surge', param: 'surgeCard', id: 'surge-card-value', min: 0, max: 20, float: true }
]);

const OPPONENT_PARAMS = [
    ['maraOpp1', 'dhOpp1', 'opp1'],
    ['maraOpp2', 'dhOpp2', 'opp2'],
    ['maraOpp3', 'dhOpp3', 'opp3']
];

function lz() {
    return typeof window !== 'undefined' ? window.LZString : undefined;
}

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

function compressMullTypes(types) {
    const minified = types.map(t => [t.id, t.name, t.count, t.required, t.byTurn, (t.color || '').replace('#', '')]);
    return lz()?.compressToEncodedURIComponent(JSON.stringify(minified)) ?? null;
}

/** Decompress and validate mulligan requirements; null if anything is off. */
export function decompressMullTypes(str, codec = lz()) {
    try {
        const decompressed = codec?.decompressFromEncodedURIComponent(str);
        if (!decompressed) return null;
        const minified = JSON.parse(decompressed);
        if (!Array.isArray(minified)) return null;
        const types = minified.map(arr => ({
            id: arr[0], name: arr[1], count: arr[2], required: arr[3], byTurn: arr[4],
            color: arr[5] ? `#${arr[5]}` : '#808b85'
        }));
        const valid = types.every(t =>
            typeof t.id === 'number' && typeof t.name === 'string' && t.name.length <= 60 &&
            typeof t.count === 'number' && typeof t.required === 'number' && typeof t.byTurn === 'number' &&
            t.count >= 0 && t.count <= 100 && t.required >= 0 && t.required <= 100 && t.byTurn >= 0 && t.byTurn <= 20 &&
            /^#[0-9a-f]{3,8}$/i.test(t.color)
        );
        return valid ? types : null;
    } catch (e) {
        console.warn('Failed to decompress mullTypes', e);
        return null;
    }
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
        applyPageParams(tab, params, record?.module);
    } catch (err) {
        console.error('Could not apply shared settings', err);
    }
    return tab;
}

function applyPageParams(tab, params, module) {
    SLIDERS.filter(s => s.tab === tab).forEach(s => {
        const value = boundedNumber(params.get(s.param), s);
        if (value !== null) setInput(s.id, value);
        else if (params.has(s.param)) console.warn(`Ignoring out-of-range ${s.param}`);
    });

    if (tab === 'mulligan') {
        const types = params.get('mullTypes') ? decompressMullTypes(params.get('mullTypes')) : null;
        if (types) module?.setCardTypes?.(types);
        const sims = boundedNumber(params.get('mullSims'), { min: 1, max: 10000 });
        if (sims !== null) setInput('mulligan-sample-count', sims);
        const penalty = boundedNumber(params.get('mullPenalty'), { min: 0, max: 100, float: true });
        if (penalty !== null) setInput('mull-penalty', penalty);
        const threshold = boundedNumber(params.get('mullThreshold'), { min: 0, max: 100, float: true });
        if (threshold !== null) setInput('mull-threshold', threshold);
    }

    try {
        module?.applyShareParams?.(params);
    } catch (err) {
        console.error(`${tab} rejected its share params`, err);
    }
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

    SLIDERS.filter(s => s.tab === tab).forEach(s => {
        const input = document.getElementById(s.id);
        if (input && input.value !== '') params.set(s.param, input.value);
    });

    const module = getLoadedModule(tab);
    if (tab === 'mulligan' && module?.getState) {
        const state = module.getState();
        if (state?.types?.length) {
            const packed = compressMullTypes(state.types);
            if (packed) params.set('mullTypes', packed);
        }
        ['mull-penalty:mullPenalty', 'mull-threshold:mullThreshold', 'mulligan-sample-count:mullSims'].forEach(pair => {
            const [id, param] = pair.split(':');
            const el = document.getElementById(id);
            if (el) params.set(param, el.value);
        });
    }

    if (getCalculator(tab)?.needsOpponents) {
        const urls = OpponentState.getOpponentUrls();
        ['opponent1', 'opponent2', 'opponent3'].forEach((key, i) => {
            if (urls[key] && isAllowedDeckUrl(urls[key])) params.set(`opp${i + 1}`, urls[key]);
        });
    }

    try {
        const extra = module?.getShareParams?.() ?? {};
        Object.entries(extra).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') params.set(k, String(v));
        });
    } catch (err) {
        console.error(`${tab} failed to build share params`, err);
    }

    url.search = params.toString();
    url.hash = '';
    return url.toString();
}
