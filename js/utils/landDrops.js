/**
 * Land-drop model — exact odds of making every land drop, turn by turn.
 *
 * You draw exactly one card a turn, so "at least T lands among the cards seen
 * by turn T" already implies you made drops 1 … T−1 as well: the per-turn
 * figure is "made every land drop through turn T", with no simulation.
 *
 * Optional refinements, all still exact:
 *   - ramp: cheap ramp cards count as land drops (a rough but common rule)
 *   - keepRange: you mulligan sevens with too few / too many lands (London
 *     mulligan; spells go to the bottom first)
 *   - format / onPlay: who draws on turn one
 */

import { drawType, drawTypeMin } from './hypergeometric.js';
import { FORMATS, cardsSeenByTurn } from './format.js';
import { multiTypeProb, bottomCount } from './mulliganModel.js';
import { pct } from './text.js';

export const HAND = 7;
export const DEFAULT_KEEP = Object.freeze([2, 5]);
export const DEFAULT_TURNS = 8;
const MAX_MULLIGANS = 6;

/** Chance of each land count (0…7) in a seven-card hand. */
export function openingLands(deckSize, lands, hand = HAND) {
    return Array.from({ length: hand + 1 }, (_, k) => drawType(deckSize, lands, hand, k));
}

/**
 * Turn-by-turn chance of having made every land drop.
 *
 * @param {Object} p
 * @param {number} p.deckSize - library size
 * @param {number} p.lands
 * @param {number} [p.ramp=0] - ramp cards counted as land drops
 * @param {Object} [p.format=FORMATS.commander]
 * @param {boolean} [p.onPlay=true]
 * @param {[number, number]|null} [p.keepRange] - mulligan sevens outside this many lands
 * @param {boolean} [p.freeMulligan] - defaults to the format's rule
 * @param {number} [p.turns=8]
 * @returns {{byTurn: Array<{turn:number, seen:number, chance:number}>, keepRate:number}}
 */
export function landDropOdds({
    deckSize, lands, ramp = 0, format = FORMATS.commander, onPlay = true,
    keepRange = null, freeMulligan = format.freeMulligan, turns = DEFAULT_TURNS
}) {
    const N = Math.max(0, Math.floor(deckSize));
    const L = Math.max(0, Math.min(N, Math.floor(lands)));
    const R = Math.max(0, Math.min(N - L, Math.floor(ramp)));
    const sources = L + R;
    const seenBy = t => Math.min(N, cardsSeenByTurn(t, { format, onPlay }));
    const turnList = Array.from({ length: turns }, (_, i) => i + 1);

    if (N < HAND + 1) {
        return { byTurn: turnList.map(turn => ({ turn, seen: seenBy(turn), chance: 0 })), keepRate: 0 };
    }

    const [lo, hi] = keepRange ?? [0, HAND];
    // Opening sevens by (lands, ramp); keep decided on lands alone.
    const hands = [];
    for (let l = 0; l <= Math.min(HAND, L); l++) {
        for (let r = 0; r <= Math.min(HAND - l, R); r++) {
            const p = multiTypeProb(N, [L, R], HAND, [l, r]);
            if (p > 0) hands.push({ l, r, p, keep: l >= lo && l <= hi });
        }
    }
    const keepRate = hands.reduce((s, h) => s + (h.keep ? h.p : 0), 0);

    if (!keepRange || keepRate <= 0) {
        return {
            byTurn: turnList.map(turn => {
                const seen = seenBy(turn);
                return { turn, seen, chance: drawTypeMin(N, sources, seen, turn) };
            }),
            keepRate
        };
    }

    // Keep at mulligan m with chance (1 − q)^m · q; after a mulligan the hand
    // bottoms `b` cards, spells first. All seven seen cards leave the draw pile.
    const weights = [];
    let reach = 1;
    for (let m = 0; m <= MAX_MULLIGANS; m++) {
        weights.push({ w: reach * keepRate, bottom: bottomCount(m, freeMulligan) });
        reach *= 1 - keepRate;
    }
    const total = weights.reduce((s, x) => s + x.w, 0);

    const byTurn = turnList.map(turn => {
        const seen = seenBy(turn);
        const draws = Math.max(0, seen - HAND);
        let chance = 0;
        weights.forEach(({ w, bottom }) => {
            let s = 0;
            hands.forEach(h => {
                if (!h.keep) return;
                const spells = HAND - h.l - h.r;
                const inHand = h.l + h.r - Math.max(0, bottom - spells);
                const missing = turn - inHand;
                s += h.p * (missing <= 0 ? 1 : drawTypeMin(N - HAND, sources - h.l - h.r, draws, missing));
            });
            chance += (w / total) * (s / keepRate);
        });
        return { turn, seen, chance };
    });
    return { byTurn, keepRate };
}

/**
 * First turn by which you have more likely than not missed a land drop.
 * @returns {number|null} null when that never happens within the turns given
 */
export function firstLikelyMiss(byTurn = []) {
    return byTurn.find(t => t.chance < 0.5)?.turn ?? null;
}

/**
 * The same odds with a few more or fewer lands (swapped for spells, deck size
 * unchanged).
 * @returns {Array<{delta:number, lands:number, byTurn:Array, keepRate:number, sevens:number}>}
 */
export function landCountComparison(params, deltas = [-2, -1, 0, 1, 2]) {
    const keep = params.keepRange ?? DEFAULT_KEEP;
    return deltas
        .map(delta => ({ delta, lands: params.lands + delta }))
        .filter(row => row.lands >= 0 && row.lands + (params.ramp ?? 0) <= params.deckSize)
        .map(row => {
            const odds = landDropOdds({ ...params, lands: row.lands });
            const dist = openingLands(params.deckSize, row.lands);
            const sevens = dist.slice(keep[0], keep[1] + 1).reduce((s, p) => s + p, 0);
            return { ...row, byTurn: odds.byTurn, keepRate: odds.keepRate, sevens };
        });
}

/** Plain words for a probability. */
export function chanceWords(p) {
    if (p >= 0.95) return 'almost always';
    if (p >= 0.85) return 'very likely';
    if (p >= 0.65) return 'usually';
    if (p >= 0.45) return 'about half the time';
    if (p >= 0.25) return 'unlikely';
    return 'rarely';
}

/** What a chance MEANS for a land drop (good / warn / flat). */
export function chanceTone(p) {
    if (p >= 0.75) return 'good';
    if (p >= 0.5) return 'warn';
    return 'flat';
}

/**
 * The plain-language answer for the Land Drops page.
 *
 * @param {Object} r
 * @param {number} r.lands
 * @param {number} r.deckSize
 * @param {Array<{turn:number, chance:number}>} r.byTurn - the odds shown
 * @param {Array<{turn:number, chance:number}>|null} [r.withRamp] - odds counting ramp (when it isn't already)
 * @param {Array<{turn:number, chance:number}>|null} [r.landsOnly] - odds without ramp (when ramp is counted)
 * @param {number} [r.ramp=0] - ramp cards
 * @param {boolean} [r.countingRamp=false]
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarizeLandDrops({ lands, deckSize, byTurn, withRamp = null, landsOnly = null, ramp = 0, countingRamp = false }) {
    if (!byTurn?.length || !lands || !deckSize) {
        return { html: 'Add lands to your deck to see how reliably you hit your land drops.', tone: 'flat' };
    }
    const at = (list, turn) => list?.find(t => t.turn === turn)?.chance ?? 0;
    const t3 = at(byTurn, 3);
    const t4 = at(byTurn, 4);
    const miss = firstLikelyMiss(byTurn);
    const what = countingRamp ? `${lands} lands and ${ramp} cheap ramp cards` : `${lands} lands`;

    let html = `With ${what} in ${deckSize} cards you make every land drop through turn 3 in <strong>${pct(t3)}</strong> of games and through turn 4 in <strong>${pct(t4)}</strong>.`;
    html += miss
        ? ` Most games have missed a drop by <strong>turn ${miss}</strong>.`
        : ` You are still making drops more often than not on turn ${byTurn[byTurn.length - 1].turn}.`;

    const gain = withRamp ? at(withRamp, 4) - t4 : 0;
    if (!countingRamp && ramp > 0 && gain >= 0.03) {
        html += ` Counting your ${ramp} cheap ramp cards as land drops, turn 4 rises to <strong>${pct(at(withRamp, 4))}</strong>.`;
    } else if (countingRamp && landsOnly) {
        html += ` Lands alone: ${pct(at(landsOnly, 4))} through turn 4.`;
    }

    const tone = t4 >= 0.7 ? 'good' : t4 >= 0.55 ? 'warn' : 'bad';
    return { html, tone };
}
