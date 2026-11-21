/**
 * Rashmi, Eternities Crafter — the page's maths.
 *
 * "Whenever you cast your first spell each turn, reveal the top card of your
 * library. You may cast it without paying its mana cost if it's a spell with
 * lesser mana value. If you don't cast it, put it into your hand."
 *
 * The top card of a shuffled library is a uniformly random card, so every
 * number here is exact: the free-spell chance for a cast of mana value M is the
 * share of the library that is a nonland card with mana value below M. Sample
 * reveals are real random cards from the list, kept stable while the mana
 * value changes so you can watch the same reveals flip between "cast free" and
 * "to hand".
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { toneFor } from '../components.js';
import { recommendThresholdX } from '../analysis.js';
import { asLibrary, isLand } from '../library.js';
import { one, pct } from '../text.js';

/** Highest mana value tracked; anything above is folded into it. */
export const MAX_TRACKED_MV = 20;

/** Highest cast mana value offered (big X spells reach this). */
export const MAX_CAST_MV = 15;

/** "Reliable" means at least this chance of a free spell. */
export const RELIABLE_CHANCE = 0.7;

/** True for a mana cost containing {X}. */
export function isXSpell(manaCost) {
    return typeof manaCost === 'string' && /\{X\}/i.test(manaCost);
}

/**
 * Turn a decklist into the lookup tables the odds need.
 *
 * cdf[m] counts eligible nonland cards with mana value <= m and prefixMv[m]
 * sums their mana value, so any cast value is answered in O(1).
 *
 * @param {Object} deck - a Library from libraryOf(), a DeckConfig snapshot, or a
 *   cardsByName map ({name, count, cmc, type_line, mana_cost?} records);
 *   commanders are never in the library (see library.js)
 * @param {{excludeX?:boolean}} [opts] - excludeX: X spells (which resolve with X = 0) never count as free spells
 * @returns {{deckSize:number, lands:number, spells:number, cmcDistribution:Object<number,number>, cdf:number[], prefixMv:number[], xSpells:Array, xCount:number, excludeX:boolean, hasImportedData:boolean}}
 */
export function buildRashmiState(deck, { excludeX = false } = {}) {
    const cards = asLibrary(deck).cards;
    const cmcDistribution = {};
    const xSpells = [];
    const cdf = new Array(MAX_TRACKED_MV + 1).fill(0);
    const prefixMv = new Array(MAX_TRACKED_MV + 1).fill(0);
    let deckSize = 0;
    let lands = 0;
    let spells = 0;

    for (const card of cards) {
        const count = card.count;
        deckSize += count;
        if (isLand(String(card.type_line ?? ''))) { lands += count; continue; }
        spells += count;

        const mv = Math.min(MAX_TRACKED_MV, Math.max(0, Math.floor(Number(card.cmc) || 0)));
        const isX = isXSpell(card.mana_cost);
        if (isX) xSpells.push({ name: card.name, count, cmc: mv, manaCost: card.mana_cost });
        if (excludeX && isX) continue;
        cmcDistribution[mv] = (cmcDistribution[mv] || 0) + count;
    }

    let runningCount = 0;
    let runningSum = 0;
    for (let i = 0; i <= MAX_TRACKED_MV; i++) {
        const count = cmcDistribution[i] || 0;
        runningCount += count;
        runningSum += count * i;
        cdf[i] = runningCount;
        prefixMv[i] = runningSum;
    }

    return {
        deckSize,
        lands,
        spells,
        cmcDistribution,
        cdf,
        prefixMv,
        xSpells,
        xCount: xSpells.reduce((s, x) => s + x.count, 0),
        excludeX,
        hasImportedData: deckSize > 0
    };
}

/**
 * Odds for one cast: the chance the top card is a spell with lesser mana value,
 * and the average mana value of that free spell when it is one.
 *
 * @param {Object} state - buildRashmiState output
 * @param {number} castMv - mana value of the spell that triggered Rashmi
 * @returns {{probFreeSpell:number, probWhiff:number, expectedCmc:number}}
 */
export function freeSpellOdds(state, castMv) {
    const deckSize = state?.deckSize ?? 0;
    const mv = Math.floor(Number(castMv) || 0);
    if (deckSize === 0 || mv <= 0) return { probFreeSpell: 0, probWhiff: 1, expectedCmc: 0 };

    // "Lesser mana value": eligible cards have mana value <= castMv - 1.
    const index = Math.min(mv - 1, MAX_TRACKED_MV);
    const free = state.cdf[index];
    const probFreeSpell = free / deckSize;
    return {
        probFreeSpell,
        probWhiff: 1 - probFreeSpell,
        expectedCmc: free > 0 ? state.prefixMv[index] / free : 0
    };
}

/**
 * Free-spell odds for every cast mana value 1..max.
 * @returns {Array<{x:number, prob:number, expectedCmc:number, freeMana:number}>}
 */
export function oddsByCastMv(state, max = MAX_CAST_MV) {
    const rows = [];
    for (let mv = 1; mv <= max; mv++) {
        const r = freeSpellOdds(state, mv);
        rows.push({ x: mv, prob: r.probFreeSpell, expectedCmc: r.expectedCmc, freeMana: r.probFreeSpell * r.expectedCmc });
    }
    return rows;
}

/**
 * What the revealed card is, as shares of the library: a free spell, a spell
 * too big to cast free, an X spell left out, or a land. Sums to 1.
 *
 * @returns {{free:number, tooBig:number, xLeftOut:number, land:number}}
 */
export function revealBreakdown(state, castMv) {
    const deckSize = state?.deckSize ?? 0;
    if (!deckSize) return { free: 0, tooBig: 0, xLeftOut: 0, land: 0 };
    const free = freeSpellOdds(state, castMv).probFreeSpell;
    const land = state.lands / deckSize;
    const xLeftOut = state.excludeX ? state.xCount / deckSize : 0;
    return { free, tooBig: Math.max(0, 1 - free - land - xLeftOut), xLeftOut, land };
}

/**
 * The lowest cast mana value whose free-spell chance reaches `target`.
 * @returns {{mv:number|null, best:{x:number, prob:number}}}
 */
export function reliableFrom(rows, target = RELIABLE_CHANCE) {
    const rec = recommendThresholdX(rows.map(r => ({ x: r.x, value: r.prob })), { target });
    const best = rows.reduce((b, r) => (r.prob > b.prob ? r : b), { x: 0, prob: 0 });
    return { mv: rec?.reason === 'threshold' ? rec.x : null, best };
}

/**
 * Your own spells grouped by mana value, with what Rashmi does when each is the
 * first spell of a turn, plus the average across all of them.
 *
 * @returns {{rows:Array<{x:number, count:number, prob:number, expectedCmc:number}>, average:number}}
 */
export function curveRows(state) {
    const dist = state?.cmcDistribution ?? {};
    const rows = Object.keys(dist).map(Number).sort((a, b) => a - b)
        .filter(mv => dist[mv] > 0)
        .map(mv => {
            const r = freeSpellOdds(state, mv);
            return { x: mv, count: dist[mv], prob: r.probFreeSpell, expectedCmc: r.expectedCmc };
        });
    const total = rows.reduce((s, r) => s + r.count, 0);
    const average = total ? rows.reduce((s, r) => s + r.count * r.prob, 0) / total : 0;
    return { rows, average };
}

/** Tone for a free-spell chance: what the number means for the deck. */
export function chanceTone(p) {
    return toneFor(p > 0 ? p : 0, { good: 0.5, warn: 0.3 });
}

/**
 * The plain-English answer to "How often does Rashmi flip a free spell?".
 *
 * @param {{castMv:number, odds:Object, reliable:{mv:number|null, best:Object}, landShare:number, hasImportedData:boolean}} result
 * @returns {{html:string, tone:string}}
 */
export function summarize(result) {
    const { castMv, odds, reliable, landShare = 0, hasImportedData = true } = result ?? {};
    if (!hasImportedData || !odds) {
        return { tone: 'flat', html: 'Import a decklist to see what Rashmi reveals — the odds come from the mana values of your actual cards.' };
    }

    const p = odds.probFreeSpell;
    let html = p > 0
        ? `Casting a <strong>${castMv}-mana</strong> spell, Rashmi flips a free spell <strong>${pct(p)}</strong> of the time — on average a <strong>${one(odds.expectedCmc)}-mana</strong> card. Otherwise the card goes to your hand.`
        : `Casting a <strong>${castMv}-mana</strong> spell, Rashmi can’t flip a free spell — nothing in your deck costs less. The revealed card always goes to your hand.`;

    if (reliable?.mv != null) {
        html += reliable.mv <= castMv
            ? ' That is in the reliable range (7 in 10 or better).'
            : ` It reaches 7 in 10 once your first spell costs <strong>${reliable.mv}</strong> or more.`;
    } else if (reliable?.best?.prob > 0) {
        html += ` No spell reaches 7 in 10: ${pct(landShare)} of your library is lands, so even a huge spell tops out at <strong>${pct(reliable.best.prob)}</strong>.`;
    }
    return { html, tone: chanceTone(p) };
}

/**
 * Classify a revealed card for a given cast.
 * @returns {'free'|'land'|'big'|'x'}
 */
export function classifyReveal(card, castMv, excludeX = false) {
    if (isLand(card)) return 'land';
    const mv = Math.floor(Number(card?.cmc) || 0);
    if (excludeX && isXSpell(card?.mana_cost)) return 'x';
    return mv < castMv ? 'free' : 'big';
}

/**
 * freeSpellOdds() for a cast mana value and its neighbours: `before` below
 * and `after` above, within 1..MAX_CAST_MV.
 * @returns {Object<number, {probFreeSpell:number, probWhiff:number, expectedCmc:number}>}
 */
export function oddsAround(state, castMv, { before = 2, after = 4 } = {}) {
    const results = {};
    const lo = Math.max(1, castMv - before);
    const hi = Math.min(MAX_CAST_MV, castMv + after);
    for (let mv = lo; mv <= hi; mv++) results[mv] = freeSpellOdds(state, mv);
    return results;
}
