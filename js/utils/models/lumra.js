/**
 * Lumra, Bellow of the Woods — {4}{G}{G}. The page's maths.
 *
 * "Lumra's power and toughness are each equal to the number of lands you
 * control. When Lumra enters, mill four cards. Then return all land cards from
 * your graveyard to the battlefield tapped."
 *
 * So Lumra's size is the land drops you have made by the turn you cast it plus
 * every land the trigger brings back: the lands milled, the fetch lands you have
 * cracked, and any other lands already in your graveyard.
 *
 * Exact (hypergeometric) for the averages: land drops by turn T, lands milled,
 * fetch lands seen. Simulated for the spread and the sample games: real
 * shuffles of the decklist are dealt to turn T and then milled. The shuffles are
 * made once per deck and re-read for every setting, so moving a slider never
 * re-shuffles.
 *
 * Pure: no DOM, no deck state. The page passes the library and inputs in.
 */

import { drawType } from '../hypergeometric.js';
import { createCache } from '../simulation.js';
import { buildDeckFromCardData } from '../sampleSimulator.js';
import { isLand } from '../library.js';
import { quantileSorted as quantile } from '../stats.js';
import { one, pct } from '../text.js';

/** Cards milled per Lumra trigger. */
export const MILL_PER_TRIGGER = 4;

/** Opening hand size; one card is drawn each turn after (Commander: no skipped draw). */
export const OPENING_HAND = 7;

/** Shuffled libraries kept per deck for the spread and sample games. */
export const SIM_GAMES = 2000;

const statsCache = createCache(50);

// Name fallback for cached/third-party imports that predate stored oracle text.
const KNOWN_FETCH_LANDS = new Set([
    'arid mesa', 'bloodstained mire', 'flooded strand', 'marsh flats', 'misty rainforest',
    'polluted delta', 'scalding tarn', 'verdant catacombs', 'windswept heath', 'wooded foothills',
    'prismatic vista', 'fabled passage', 'evolving wilds', 'terramorphic expanse', 'escape tunnel',
    'promising vein', 'bad river', 'flood plain', 'grasslands', 'mountain valley', 'rocky tar pit',
    'bant panorama', 'esper panorama', 'grixis panorama', 'jund panorama', 'naya panorama',
    'brokers hideout', 'cabaretti courtyard', 'maestros theater', 'obscura storefront',
    'riveteers overlook', 'krosan verge', 'myriad landscape'
]);

/**
 * Identify a land whose own rules text sacrifices it to search for a land.
 * Covers traditional fetch lands plus Evolving Wilds, Fabled Passage and the
 * like without relying only on a name list.
 */
export function isFetchLand(card = {}) {
    const name = String(card?.name ?? '').toLowerCase();
    const facesText = Array.isArray(card?.card_faces)
        ? card.card_faces.map(face => face?.oracle_text ?? '').join(' ')
        : '';
    const oracleText = `${card?.oracle_text ?? ''} ${facesText}`.toLowerCase();
    const land = isLand(card);

    const searchesForLand = oracleText.includes('land card') ||
        /(?:plains|island|swamp|mountain|forest)(?:\s+or\s+(?:plains|island|swamp|mountain|forest))*\s+card/.test(oracleText);

    return land && (KNOWN_FETCH_LANDS.has(name) || (
        oracleText.includes('sacrifice') && oracleText.includes('search your library') && searchesForLand
    ));
}

/** Fetch-land copies in a decklist. */
export function countFetchLands(cards) {
    return Object.values(cards ?? {}).reduce((sum, card) =>
        sum + (isFetchLand(card) ? Math.max(0, Number(card?.count) || 0) : 0), 0);
}

/**
 * Fetch access by a given turn from exact without-replacement odds.
 * Cracked fetches are approximated as the fetches seen, capped at one per turn.
 */
export function calculateFetchLandSetup(deckSize, fetchCount, turn, openingHand = OPENING_HAND) {
    const size = Math.max(0, Math.floor(Number(deckSize) || 0));
    const fetches = Math.min(size, Math.max(0, Math.floor(Number(fetchCount) || 0)));
    const castTurn = Math.max(0, Math.floor(Number(turn) || 0));
    const cardsSeen = Math.min(size, Math.max(0, Math.floor(Number(openingHand) || 0)) + castTurn);

    if (size === 0 || fetches === 0 || cardsSeen === 0) {
        return { cardsSeen, probabilityAtLeastOne: 0, expectedSeen: 0, expectedCracked: 0 };
    }

    const probabilityAtLeastOne = 1 - drawType(size, fetches, cardsSeen, 0);
    const expectedSeen = cardsSeen * (fetches / size);
    const expectedCracked = Math.min(castTurn, expectedSeen);

    return { cardsSeen, probabilityAtLeastOne, expectedSeen, expectedCracked };
}

/**
 * Expected land drops made by turn T: E[min(T, lands seen)], where the lands
 * seen in the opening hand plus T draws are hypergeometric. Assumes one land a
 * turn whenever you have one, and no other ramp.
 */
export function expectedLandDrops(deckSize, lands, turn, openingHand = OPENING_HAND) {
    const N = Math.max(0, Math.floor(Number(deckSize) || 0));
    const K = Math.min(N, Math.max(0, Math.floor(Number(lands) || 0)));
    const T = Math.max(0, Math.floor(Number(turn) || 0));
    const n = Math.min(N, Math.max(0, Math.floor(Number(openingHand) || 0)) + T);
    if (N === 0 || K === 0 || T === 0) return 0;
    let expected = 0;
    for (let x = 0; x <= Math.min(K, n); x++) expected += Math.min(T, x) * drawType(N, K, n, x);
    return expected;
}

/**
 * Lands milled and returned (exact).
 * @param {number} deckSize - Cards in library
 * @param {number} landCount - Lands in library
 * @param {number} gyLands - Other lands already in the graveyard
 * @param {number} [multiplier=1] - How many times the enter trigger resolves
 * @param {number} [setupLands=0] - Expected fetch lands in the graveyard
 * @returns {{distribution:Array<{count:number, probability:number}>, expectedMilled:number, totalReturned:number, setupLands:number}}
 */
export function calculateLumraStats(deckSize, landCount, gyLands, multiplier = 1, setupLands = 0) {
    const safeSetupLands = Math.max(0, Number(setupLands) || 0);
    const cacheKey = `${deckSize}-${landCount}-${gyLands}-${multiplier}-${safeSetupLands}`;
    const cached = statsCache.get(cacheKey);
    if (cached) return cached;

    const distribution = [];
    let expectedMilled = 0;
    const millAmount = MILL_PER_TRIGGER * multiplier;
    for (let k = 0; k <= millAmount; k++) {
        const prob = drawType(deckSize, landCount, millAmount, k);
        distribution.push({ count: k, probability: prob });
        expectedMilled += k * prob;
    }

    const result = {
        distribution,
        expectedMilled,
        totalReturned: gyLands + safeSetupLands + expectedMilled,
        setupLands: safeSetupLands
    };
    statsCache.set(cacheKey, result);
    return result;
}

/**
 * Mark which library cards act as fetch lands. Detected fetch lands come
 * first; if the fetch count is overridden upward, other lands stand in for the
 * extra fetches, and downward, surplus fetches act as ordinary lands.
 *
 * @param {Array<{types:string[], isFetchCard?:boolean}>} deck - mutated: sets `isFetch`
 * @param {number} fetchCount
 * @returns {Array} the same deck
 */
export function assignFetchRoles(deck, fetchCount) {
    const lands = deck.filter(c => c.types?.includes('land'));
    const ordered = [...lands.filter(c => c.isFetchCard), ...lands.filter(c => !c.isFetchCard)];
    const n = Math.max(0, Math.floor(Number(fetchCount) || 0));
    for (const c of deck) c.isFetch = false;
    ordered.slice(0, n).forEach(c => { c.isFetch = true; });
    return deck;
}

/**
 * Play one game to Lumra: see the opening hand plus a draw a turn, make a land
 * drop each turn you can (cracking fetch lands first), then mill.
 *
 * @param {Array<{name:string, types:string[], isFetch?:boolean}>} library - shuffled, not modified
 * @param {{turn:number, multiplier?:number, openingHand?:number}} opts
 * @returns {{drops:number, cracked:number, landsMilled:number, milled:Array}}
 */
export function playToLumra(library, { turn, multiplier = 1, openingHand = OPENING_HAND }) {
    const lib = Array.isArray(library) ? library : [];
    const seen = Math.min(lib.length, openingHand + Math.max(0, turn));
    let landsSeen = 0;
    let fetchesSeen = 0;
    for (let i = 0; i < seen; i++) {
        if (lib[i].types?.includes('land')) {
            landsSeen++;
            if (lib[i].isFetch) fetchesSeen++;
        }
    }
    const drops = Math.min(turn, landsSeen);
    const cracked = Math.min(fetchesSeen, drops);

    const milled = lib.slice(seen, seen + MILL_PER_TRIGGER * Math.max(1, multiplier));
    const landsMilled = milled.filter(c => c.types?.includes('land')).length;
    return { drops, cracked, landsMilled, milled };
}

/**
 * Lumra's size across simulated games: percentiles (never the sampled
 * extremes), the size distribution, and how often the mill hits nothing.
 *
 * @param {Array<{drops:number, cracked:number, landsMilled:number}>} games
 * @param {number} gyLands
 */
export function summariseSizes(games, gyLands = 0) {
    const list = Array.isArray(games) ? games : [];
    const sizes = list.map(g => g.drops + g.cracked + g.landsMilled + gyLands).sort((a, b) => a - b);
    const counts = [];
    for (const s of sizes) counts[s] = (counts[s] || 0) + 1;
    for (let i = 0; i < counts.length; i++) if (!counts[i]) counts[i] = 0;
    return {
        games: list.length,
        p10: quantile(sizes, 0.1),
        p25: quantile(sizes, 0.25),
        p50: quantile(sizes, 0.5),
        p75: quantile(sizes, 0.75),
        p90: quantile(sizes, 0.9),
        counts,
        noLandsMilled: list.length ? list.filter(g => g.landsMilled === 0).length / list.length : 0
    };
}

/** A size as power/toughness: "6/6". */
export const pt = s => `${s}/${s}`;

/** Tone for the lands Lumra brings back. */
export function returnTone(returned) {
    if (returned >= 3) return 'good';
    if (returned >= 1) return 'warn';
    return 'bad';
}

/**
 * The plain-English answer to "How big is Lumra, and how many lands come back
 * when it enters?".
 *
 * @param {{turn:number, multiplier:number, gyLands:number, drops:number, milled:number, fetches:number, returned:number, sizes:Object|null, pNoLands:number}} r
 * @returns {{html:string, tone:string}}
 */
export function summarize(r) {
    if (!r || !Number.isFinite(r.returned)) {
        return { tone: 'flat', html: 'Import a decklist to see how big Lumra gets.' };
    }
    const mill = MILL_PER_TRIGGER * (r.multiplier ?? 1);
    const size = r.sizes ? r.sizes.p50 : Math.round(r.drops + r.returned);
    const range = r.sizes && r.sizes.p25 !== r.sizes.p75 ? ` (half of games between ${pt(r.sizes.p25)} and ${pt(r.sizes.p75)})` : '';

    const parts = [`${one(r.milled)} milled from the top ${mill}`];
    if (r.fetches > 0.05) parts.push(`${one(r.fetches)} cracked fetch land${r.fetches >= 1.05 ? 's' : ''}`);
    if (r.gyLands > 0) parts.push(`${r.gyLands} already in your graveyard`);

    let html = `Cast on turn ${r.turn}, Lumra typically enters as a <strong>${pt(size)}</strong>${range}. `
        + `About ${one(r.drops)} of that is your land drops; the trigger brings back <strong>${one(r.returned)}</strong> more on average — ${parts.join(', ')}.`;
    if (r.pNoLands >= 0.05) html += ` ${pct(r.pNoLands)} of the time the mill finds no lands.`;
    return { html, tone: returnTone(r.returned) };
}

/** The library as cards with roles; a stand-in built from counts when there is no list. */
export function buildLumraLibrary(config) {
    if (config.library?.size) {
        const fetchNames = new Set(config.library.cards.filter(isFetchLand).map(c => c.name));
        return buildDeckFromCardData(config.library).map(c => ({ ...c, isFetchCard: fetchNames.has(c.name) }));
    }
    const deck = [];
    for (let i = 0; i < config.deckSize; i++) {
        const land = i < config.landCount;
        deck.push({ name: land ? 'Land' : 'Spell', types: land ? ['land'] : [], isFetchCard: false, generic: true });
    }
    return deck;
}
