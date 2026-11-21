/**
 * Kamahl's Druidic Vow — {X}{G}{G} legendary sorcery. The page's maths.
 *
 * "Look at the top X cards of your library. You may put any number of land
 * and/or legendary permanent cards with mana value X or less from among them
 * onto the battlefield. Put the rest into your graveyard."
 *
 * Exact throughout: hits among the cards looked at are hypergeometric, and the
 * chance the cast pays for itself is an exact dynamic program over the cards'
 * values (js/utils/payback.js). When the Vow is copied (The Sixth Doctor and
 * similar), the copy looks at the next X cards, so 2X cards are seen.
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { createCache } from '../simulation.js';
import { toneFor } from '../components.js';
import { calculateFixedDrawPayback } from '../payback.js';
import { hypergeometricPmf } from '../hypergeometric.js';
import { quantile } from '../stats.js';
import { frontTypeLine, isLand as isLandCard, isPermanent } from '../library.js';
import { avg, pct } from '../text.js';
import { listSize } from './cardList.js';

export const VOW = Object.freeze({
    /** The Vow costs X plus {G}{G}. */
    EXTRA_MANA: 2,
    /** "Pays for itself 3 times in 4". */
    RELIABLE: 0.75,
    DEFAULT_LAND_VALUE: 1,
    DEFAULT_CARD_VALUE: 0.25
});

/** Commanders that copy the Vow every time it is cast. */
const COPYING_COMMANDERS = new Set(['The Sixth Doctor']);

const paybackCache = createCache(256);

/** Land, or legendary permanent — the cards the Vow can put into play (front face). */
export function classifyForVow(typeLine) {
    const isLand = isLandCard(String(typeLine ?? ''));
    const isLegendary = !isLand && /\blegendary\b/.test(frontTypeLine(typeLine)) && isPermanent(String(typeLine ?? ''));
    return { isLand, isLegendary, isValid: isLand || isLegendary };
}

/**
 * Expected hits for the Vow at X (linearity of expectation).
 *
 * @param {number} deckSize - cards in the library
 * @param {Object} distribution - mana value -> count of lands/legendary permanents
 * @param {number} x
 * @param {boolean} [doubleCast=false] - copied: look at 2X cards
 * @param {{cardsByName:Object}|null} [cardData] - when given, also splits lands from legends
 * @returns {{expectedHits:number, expectedLands:number, expectedLegends:number, expectedManaValue:number}}
 */
export function simulateVow(deckSize, distribution, x, doubleCast = false, cardData = null) {
    let hits = 0;
    let lands = 0;
    let legends = 0;
    let manaValue = 0;

    if (cardData?.cardsByName) {
        for (const card of Object.values(cardData.cardsByName)) {
            const { isLand, isLegendary, isValid } = classifyForVow(card?.type_line);
            const cmc = Number(card?.cmc) || 0;
            const count = Number(card?.count) || 0;
            if (!isValid || cmc > x) continue;
            hits += count;
            manaValue += cmc * count;
            if (isLand) lands += count;
            if (isLegendary) legends += count;
        }
    } else {
        for (const [key, count] of Object.entries(distribution ?? {})) {
            const cmc = parseInt(key, 10);
            if (!Number.isNaN(cmc) && cmc <= x) {
                hits += count || 0;
                manaValue += cmc * (count || 0);
            }
        }
    }

    const seen = Math.min(Math.max(0, x) * (doubleCast ? 2 : 1), deckSize);
    const share = n => (deckSize > 0 ? seen * n / deckSize : 0);
    return {
        expectedHits: share(hits),
        expectedLands: share(lands),
        expectedLegends: share(legends),
        expectedManaValue: share(manaValue)
    };
}

/**
 * The library as the Vow sees it. With only type counts, legendary status is
 * unknown, so only lands count as hits.
 */
export function buildVowLibrary(cards = [], counts = {}) {
    if (cards.length > 0) {
        return {
            hasList: true,
            deckSize: listSize(cards),
            entries: cards.map(card => ({ name: card.name, count: card.count, cmc: card.cmc, ...classifyForVow(card.type_line) }))
        };
    }
    const n = field => Math.max(0, Math.floor(Number(counts?.[field]) || 0));
    const lands = n('lands');
    const rest = n('creatures') + n('artifacts') + n('enchantments') + n('planeswalkers') + n('battles') + n('instants') + n('sorceries');
    return {
        hasList: false,
        deckSize: lands + rest,
        entries: [
            { count: lands, cmc: 0, isLand: true, isLegendary: false, isValid: true },
            { count: rest, cmc: 0, isLand: false, isLegendary: false, isValid: false }
        ]
    };
}

/** Everything the page shows for one X. Exact; payback is cached. */
export function vowOutcome(library, x, { copies = 1, landValue = VOW.DEFAULT_LAND_VALUE, cardValue = VOW.DEFAULT_CARD_VALUE } = {}, deckKey = 'deck') {
    const seen = Math.min(x * copies, library.deckSize);
    let lands = 0;
    let legends = 0;
    for (const e of library.entries) {
        if (!e.isValid || e.cmc > x) continue;
        if (e.isLand) lands += e.count;
        else legends += e.count;
    }
    const eligible = lands + legends;
    const pmf = hypergeometricPmf(library.deckSize, eligible, seen);
    const share = n => (library.deckSize > 0 ? seen * n / library.deckSize : 0);

    const key = `${deckKey}|${x}|${copies}|${landValue}|${cardValue}`;
    let payback = paybackCache.get(key);
    if (!payback) {
        payback = calculateFixedDrawPayback(
            library.entries.map(e => ({ ...e, eligible: e.isValid && e.cmc <= x })),
            seen,
            { threshold: x + VOW.EXTRA_MANA, landValue, cardValue }
        );
        paybackCache.set(key, payback);
    }

    return {
        x,
        mana: x + VOW.EXTRA_MANA,
        copies,
        seen,
        deckSize: library.deckSize,
        eligibleLands: lands,
        eligibleLegends: legends,
        eligible,
        expectedHits: share(eligible),
        expectedLands: share(lands),
        expectedLegends: share(legends),
        pmf,
        low: quantile(pmf, 0.1),
        high: quantile(pmf, 0.9),
        payback,
        legendsKnown: library.hasList
    };
}

/**
 * vowOutcome() for every X from 1 to maxX ({} for an empty library).
 * @returns {Object<number, ReturnType<typeof vowOutcome>>}
 */
export function vowSweep(library, maxX, settings = {}, deckKey = 'deck') {
    const results = {};
    if (!library?.deckSize) return results;
    for (let x = 1; x <= maxX; x++) results[x] = vowOutcome(library, x, settings, deckKey);
    return results;
}

export function analyze(sweep, x) {
    const xs = Object.keys(sweep ?? {}).map(Number).sort((a, b) => a - b);
    const at = sweep?.[x] ?? null;
    const next = sweep?.[x + 1] ?? null;
    return {
        ...at,
        next,
        marginal: next && at ? next.expectedHits - at.expectedHits : null,
        reliableX: xs.find(k => (sweep[k]?.payback?.paybackProbability ?? 0) >= VOW.RELIABLE) ?? null,
        maxX: xs.length ? xs[xs.length - 1] : 0
    };
}

/**
 * The page's bottom line: "How many lands and legendaries will the Vow put
 * into play?"
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(a) {
    if (!a || !a.deckSize) return { html: 'Add cards to your deck to see what Kamahl’s Druidic Vow does.', tone: 'flat' };
    const copied = a.copies > 1;
    const opener = `Kamahl’s Druidic Vow at <strong>X=${a.x}</strong> (${a.mana} mana${copied ? `, copied — ${a.seen} cards seen` : ''})`;
    const p = a.payback?.paybackProbability ?? 0;
    if (!a.legendsKnown) {
        return {
            html: `${opener} puts about <strong>${avg(a.expectedHits)} lands</strong> onto the battlefield and pays for itself ${pct(p)} of the time — counting lands only. Import your decklist so the page can find your legendary permanents.`,
            tone: 'flat'
        };
    }
    const lead = `${opener} puts about <strong>${avg(a.expectedHits)} lands and legends</strong> onto the battlefield (${avg(a.expectedLands)} lands, ${avg(a.expectedLegends)} legendary permanents) and pays for itself <strong>${pct(p)}</strong> of the time.`;
    let follow = '';
    if (p >= VOW.RELIABLE) {
        if (a.marginal != null) follow = `Each extra point of X adds about ${avg(a.marginal)} more hits.`;
    } else if (a.reliableX != null && a.reliableX > a.x) {
        follow = `At <strong>X=${a.reliableX}</strong> it pays for itself 3 times in 4.`;
    } else if (a.reliableX == null) {
        follow = `With these value settings it never pays back 3 times in 4, even at X=${a.maxX}.`;
    }
    return { html: follow ? `${lead} ${follow}` : lead, tone: toneFor(p) };
}

/**
 * Does any card in the command zone copy the Vow? (Either partner counts.)
 * @param {string[]} commanders - command-zone names
 */
export function commanderCopiesVow(commanders) {
    return (commanders ?? []).some(name => COPYING_COMMANDERS.has(String(name ?? '').trim()));
}
