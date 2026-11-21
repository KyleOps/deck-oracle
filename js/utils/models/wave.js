/**
 * Genesis Wave — {X}{G}{G}{G} sorcery. The page's maths.
 *
 * "Reveal the top X cards of your library. You may put any number of permanent
 * cards with mana value X or less from among them onto the battlefield. Then
 * put all cards revealed this way that weren't put onto the battlefield into
 * your graveyard."
 *
 * Everything is exact: the number of hits among X revealed cards is
 * hypergeometric, and the chance the cast pays for itself is an exact dynamic
 * program over the revealed cards' values (js/utils/payback.js).
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { createCache } from '../simulation.js';
import { toneFor } from '../components.js';
import { calculateFixedDrawPayback, fixedDrawValuePmf, paybackShareByHits, scoreBattlefieldValue } from '../payback.js';
import { pmfQuantiles, splitDots } from '../viz.js';
import { hypergeometricPmf } from '../hypergeometric.js';
import { quantile } from '../stats.js';
import { isLand, isPermanent } from '../library.js';
import { avg, pct, plural } from '../text.js';
import { listSize } from './cardList.js';

/** The card this page casts: the cast copy is on the stack, not in the library. */
export const GENESIS_WAVE = 'Genesis Wave';

/** libraryOf() / deckCardList() options while it resolves (one listed copy out). */
export const ON_STACK = Object.freeze({ exclude: [GENESIS_WAVE] });

export const WAVE = Object.freeze({
    /** Genesis Wave costs X plus {G}{G}{G}. */
    EXTRA_MANA: 3,
    /** "Pays for itself 3 times in 4". */
    RELIABLE: 0.75,
    DEFAULT_LAND_VALUE: 1,
    DEFAULT_CARD_VALUE: 0.25
});

const paybackCache = createCache(256);

const spreadCache = createCache(32);

/**
 * Expected permanents for Genesis Wave at X (linearity of expectation):
 * revealed cards × the share of the library that is a permanent with MV ≤ X.
 *
 * @param {number} deckSize - cards in the library
 * @param {Object} distribution - mana value -> permanent count, plus `nonperm`
 * @param {number} x
 * @returns {{expectedPermanents:number}}
 */
export function simulateGenesisWave(deckSize, distribution, x) {
    let eligible = 0;
    for (const [key, count] of Object.entries(distribution ?? {})) {
        if (key === 'nonperm') continue;
        const mv = parseInt(key, 10);
        if (!Number.isNaN(mv) && mv <= x) eligible += count || 0;
    }
    const revealed = Math.min(Math.max(0, x), deckSize);
    return { expectedPermanents: deckSize > 0 ? revealed * eligible / deckSize : 0 };
}

/**
 * The library as Genesis Wave sees it.
 * With only type counts, permanents' mana values are unknown (cmc: null).
 */
export function buildWaveLibrary(cards = [], counts = {}) {
    if (cards.length > 0) {
        return {
            hasList: true,
            deckSize: listSize(cards),
            entries: cards.map(card => ({
                count: card.count,
                cmc: card.cmc,
                isPermanent: isPermanent(card.type_line),
                isLand: isLand(card.type_line)
            }))
        };
    }
    const n = field => Math.max(0, Math.floor(Number(counts?.[field]) || 0));
    const lands = n('lands');
    const others = n('creatures') + n('artifacts') + n('enchantments') + n('planeswalkers') + n('battles');
    const spells = n('instants') + n('sorceries');
    return {
        hasList: false,
        deckSize: lands + others + spells,
        entries: [
            { count: lands, cmc: 0, isPermanent: true, isLand: true },
            { count: others, cmc: null, isPermanent: true, isLand: false },
            { count: spells, cmc: 0, isPermanent: false, isLand: false }
        ]
    };
}

/** mana value -> permanent count (+ nonperm), the shape simulateGenesisWave takes. */
function distributionOf(library) {
    const distribution = {};
    for (const entry of library.entries) {
        if (!entry.isPermanent) {
            distribution.nonperm = (distribution.nonperm ?? 0) + entry.count;
            continue;
        }
        const mv = entry.cmc == null ? 0 : Math.floor(entry.cmc);
        distribution[mv] = (distribution[mv] ?? 0) + entry.count;
    }
    return distribution;
}

function eligibleAt(library, x) {
    return library.entries.reduce((sum, e) => sum + (e.isPermanent && (e.cmc == null || e.cmc <= x) ? e.count : 0), 0);
}

function paybackAt(library, deckKey, x, settings) {
    if (!library.hasList) return null;
    const key = `${deckKey}|${x}|${settings.landValue}|${settings.cardValue}`;
    let payback = paybackCache.get(key);
    if (!payback) {
        payback = calculateFixedDrawPayback(
            library.entries.map(e => ({ ...e, eligible: e.isPermanent && e.cmc <= x })),
            x,
            { threshold: x + WAVE.EXTRA_MANA, landValue: settings.landValue, cardValue: settings.cardValue }
        );
        paybackCache.set(key, payback);
    }
    return payback;
}

/**
 * Everything the page shows for one X. Exact; payback is cached per deck,
 * X and value settings.
 */
export function waveOutcome(library, x, settings = {}, deckKey = 'deck') {
    const revealed = Math.min(x, library.deckSize);
    const eligible = eligibleAt(library, x);
    const pmf = hypergeometricPmf(library.deckSize, eligible, revealed);
    const payback = paybackAt(library, deckKey, x, {
        landValue: settings.landValue ?? WAVE.DEFAULT_LAND_VALUE,
        cardValue: settings.cardValue ?? WAVE.DEFAULT_CARD_VALUE
    });
    return {
        x,
        mana: x + WAVE.EXTRA_MANA,
        revealed,
        eligible,
        deckSize: library.deckSize,
        expectedPermanents: simulateGenesisWave(library.deckSize, distributionOf(library), x).expectedPermanents,
        pmf,
        low: quantile(pmf, 0.1),
        high: quantile(pmf, 0.9),
        payback,
        mvKnown: library.hasList
    };
}

/**
 * waveOutcome() for every X from 1 to maxX ({} for an empty library).
 * @returns {Object<number, ReturnType<typeof waveOutcome>>}
 */
export function waveSweep(library, maxX, settings = {}, deckKey = 'deck') {
    const results = {};
    if (!library?.deckSize) return results;
    for (let x = 1; x <= maxX; x++) results[x] = waveOutcome(library, x, settings, deckKey);
    return results;
}

/**
 * @param {Object<number, ReturnType<typeof waveOutcome>>} sweep - outcome per X
 * @param {number} x
 */
export function analyze(sweep, x) {
    const xs = Object.keys(sweep ?? {}).map(Number).sort((a, b) => a - b);
    const at = sweep?.[x] ?? null;
    const next = sweep?.[x + 1] ?? null;
    const reliableX = xs.find(k => (sweep[k]?.payback?.paybackProbability ?? 0) >= WAVE.RELIABLE) ?? null;
    return {
        ...at,
        next,
        marginal: next && at ? next.expectedPermanents - at.expectedPermanents : null,
        reliableX,
        maxX: xs.length ? xs[xs.length - 1] : 0
    };
}

function rangePhrase(low, high) {
    return low === high ? `almost always ${low}` : `${low} to ${high} in 8 casts out of 10`;
}

/**
 * The page's bottom line: "How much does Genesis Wave put into play, and does
 * it pay for itself?"
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(a) {
    if (!a || !a.deckSize) return { html: 'Add cards to your deck to see what Genesis Wave does.', tone: 'flat' };
    const opener = `Genesis Wave at <strong>X=${a.x}</strong> (${a.mana} mana)`;
    if (!a.mvKnown || !a.payback) {
        return {
            html: `${opener} reveals ${plural(a.revealed, 'card')}, and about <strong>${avg(a.expectedPermanents)}</strong> of them are permanents. With card-type counts only, mana values are unknown, so this assumes every permanent costs ${a.x} or less — import your decklist for the real number and the payback odds.`,
            tone: 'flat'
        };
    }
    const p = a.payback.paybackProbability;
    const lead = `${opener} puts about <strong>${avg(a.expectedPermanents)} permanents</strong> onto the battlefield — ${rangePhrase(a.low, a.high)} — and pays for itself <strong>${pct(p)}</strong> of the time.`;
    let follow = '';
    if (p >= WAVE.RELIABLE) {
        if (a.marginal != null) follow = `Each extra point of X adds about ${avg(a.marginal)} more permanents.`;
    } else if (a.reliableX != null && a.reliableX > a.x) {
        follow = `At <strong>X=${a.reliableX}</strong> it pays for itself 3 times in 4.`;
    } else if (a.reliableX == null) {
        follow = `With these value settings it never pays back 3 times in 4, even at X=${a.maxX}.`;
    }
    return { html: follow ? `${lead} ${follow}` : lead, tone: toneFor(p) };
}

/**
 * The exact spread of one cast at X: the value it puts into play, and for
 * each number of hits the share of casts that pay for themselves. Cached per
 * deck, X and value settings.
 */
export function waveSpread(library, x, settings = {}, deckKey = 'deck') {
    if (!library?.hasList) return null;
    const landValue = settings.landValue ?? WAVE.DEFAULT_LAND_VALUE;
    const cardValue = settings.cardValue ?? WAVE.DEFAULT_CARD_VALUE;
    const key = `${deckKey}|${x}|${landValue}|${cardValue}`;
    let spread = spreadCache.get(key);
    if (!spread) {
        const entries = library.entries.map(e => ({ ...e, eligible: e.isPermanent && e.cmc <= x }));
        const revealed = Math.min(x, library.deckSize);
        const model = { landValue, cardValue, threshold: x + WAVE.EXTRA_MANA };
        spread = {
            valuePmf: fixedDrawValuePmf(entries, revealed, model),
            paidByHits: paybackShareByHits(entries, revealed, model)
        };
        spreadCache.set(key, spread);
    }
    return spread;
}

/**
 * The 100 dots for both views. Value: stacked by value, split at the mana
 * spent. Permanents: stacked by hits, each run length split by its exact
 * payback share, with the same number of solid dots as the value view.
 * @param {{pmf:number[], mana:number}} outcome - waveOutcome() at X
 * @param {{valuePmf:Array, paidByHits:number[]}|null} spread
 */
export function waveDots(outcome, spread) {
    const hits = pmfQuantiles(outcome?.pmf ?? [], 100);
    if (!spread) return { permanents: hits.map(k => ({ value: k, tone: 'flat' })), value: null };
    const threshold = outcome.mana;
    const value = pmfQuantiles(spread.valuePmf, 100).map(v => ({ value: v, tone: v >= threshold - 1e-9 ? 'good' : 'bad' }));
    const good = value.filter(d => d.tone === 'good').length;
    return { permanents: splitDots(hits, k => spread.paidByHits[k] ?? 0, good), value };
}

/**
 * One Genesis Wave resolution, card by card, for the "Cast it" animation:
 * the top X cards are revealed; permanents with mana value X or less go to
 * the battlefield, everything else to the graveyard. Pure.
 *
 * @param {Array<{name:string, cmc:number, types:string[]}>} library - shuffled
 * @param {number} x
 * @param {{landValue:number, cardValue:number}} settings
 */
export function waveCastPlan(library, x, settings = {}) {
    const threshold = x + WAVE.EXTRA_MANA;
    const revealed = (library ?? []).slice(0, Math.max(0, x));
    let permanents = 0;
    let manaValue = 0;
    let lands = 0;
    const totals = () => {
        const scored = scoreBattlefieldValue({ manaValue, lands, cards: permanents }, { ...settings, threshold });
        return {
            scored,
            list: [
                { label: 'Permanents', value: String(permanents) },
                { label: 'Value', value: `${avg(scored.effectiveValue)} <small>of ${threshold}</small>`, tone: scored.paidForItself ? 'good' : undefined }
            ]
        };
    };
    const steps = revealed.map((card, i) => {
        const types = card.types ?? [];
        const permanent = types.some(t => t !== 'instant' && t !== 'sorcery');
        const mv = card.cmc || 0;
        const hit = permanent && mv <= x;
        if (hit) {
            permanents += 1;
            manaValue += mv;
            if (types.includes('land')) lands += 1;
        }
        const count = `${i + 1} of ${x}: `;
        const note = hit
            ? `${count}${types.includes('land') ? 'a land' : `a permanent with mana value ${mv}`} — X is ${x}, so onto the battlefield.`
            : permanent
                ? `${count}mana value ${mv} is more than X (${x}) — to the graveyard.`
                : `${count}${types.includes('instant') ? 'an instant' : 'a sorcery'}, not a permanent — to the graveyard.`;
        return { name: card.name, fate: hit ? 'battlefield' : 'graveyard', note, totals: totals().list };
    });
    const end = totals().scored;
    const summary = `${plural(revealed.length, 'card')} revealed, ${plural(permanents, 'permanent')} onto the battlefield worth ${avg(end.effectiveValue)} — ${end.paidForItself ? '<strong>pays for itself</strong>' : '<strong>falls short</strong>'} of the ${threshold} mana spent.`;
    return {
        steps, permanents, value: end.effectiveValue, paidBack: end.paidForItself, summary,
        startTotals: [{ label: 'Permanents', value: '0' }, { label: 'Value', value: `0 <small>of ${threshold}</small>` }]
    };
}
