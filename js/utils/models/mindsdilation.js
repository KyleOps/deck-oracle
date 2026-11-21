/**
 * Mind's Dilation — {5}{U}{U} enchantment. The page's maths.
 *
 * Whenever an opponent casts their first spell each turn, that player exiles
 * the top card of their library. If it's a nonland card, you may cast it
 * without paying its mana cost.
 *
 * Exact: the exiled card is a uniformly random card of the library, so the hit
 * chance is the nonland share and the value is the average spell mana value.
 *
 * Optional: The Sixth Doctor copies the first historic spell you cast each
 * turn, so a historic free spell (artifact, legendary or Saga) counts double.
 *
 * Pure: no DOM, no opponent state. The page passes each opponent's deck in.
 */

import { escapeHtml } from '../../data/glossary.js';
import { isLand, libraryOf } from '../library.js';
import { one, pct } from '../text.js';
import { countWord, isHistoricType } from './opponentLibrary.js';

/** Mind's Dilation's own mana value — the payback target. */
export const MINDS_DILATION_COST = 7;

/**
 * Exact statistics for one opponent list.
 * @param {Object} opponentData - deck data with cardsByName
 * @param {boolean} [sixthDoctor=false] - count historic spells' mana value double
 * @returns {Object|null}
 */
export function calculateMindsDilationStats(opponentData, sixthDoctor = false) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) return null;

    let landCount = 0;
    let nonlandCount = 0;
    let historicCount = 0;
    let totalEffectiveMV = 0;
    const mvBuckets = {};
    const bandCounts = { cheap: 0, mid: 0, big: 0 };

    // Their library: an opponent's commanders are never in it (see library.js).
    for (const card of libraryOf(opponentData, { format: 'commander' }).cards) {
        const count = card.count;
        if (isLand(String(card.type_line ?? ''))) {
            landCount += count;
            continue;
        }
        const cmc = Math.max(0, Number(card?.cmc) || 0);
        const historic = isHistoricType(card?.type_line);
        const effective = sixthDoctor && historic ? cmc * 2 : cmc;
        nonlandCount += count;
        if (historic) historicCount += count;
        totalEffectiveMV += effective * count;
        const bucket = Math.min(Math.round(effective), 14);
        mvBuckets[bucket] = (mvBuckets[bucket] || 0) + count;
        bandCounts[effective >= 5 ? 'big' : effective >= 3 ? 'mid' : 'cheap'] += count;
    }

    const total = landCount + nonlandCount;
    if (total === 0) return null;
    const pNonland = nonlandCount / total;
    const avgEffectiveMV = nonlandCount > 0 ? totalEffectiveMV / nonlandCount : 0;

    return {
        pNonland,
        avgEffectiveMV,
        evPerTrigger: pNonland * avgEffectiveMV,
        landCount,
        nonlandCount,
        historicCount,
        historicShare: nonlandCount > 0 ? historicCount / nonlandCount : 0,
        mvBuckets,
        /** What the exiled card is, as shares of the whole library. */
        bands: {
            land: landCount / total,
            cheap: bandCounts.cheap / total,
            mid: bandCounts.mid / total,
            big: bandCounts.big / total
        },
        deckSize: total
    };
}

/**
 * One round = each opponent casts at least one spell on their turn, so each
 * triggers Mind's Dilation once.
 * @param {Object[]} statsList - from calculateMindsDilationStats
 * @returns {{spellsPerRound:number, manaPerRound:number, chanceAny:number, paybackRounds:number}}
 */
export function roundStats(statsList) {
    const list = (statsList ?? []).filter(Boolean);
    const spellsPerRound = list.reduce((a, s) => a + s.pNonland, 0);
    const manaPerRound = list.reduce((a, s) => a + s.evPerTrigger, 0);
    const chanceAny = list.length ? 1 - list.reduce((a, s) => a * (1 - s.pNonland), 1) : 0;
    return {
        spellsPerRound,
        manaPerRound,
        chanceAny,
        paybackRounds: manaPerRound > 0 ? MINDS_DILATION_COST / manaPerRound : Infinity
    };
}

/** "1.2 rounds", "1 round", "under a round", "never". */
export function formatRounds(rounds) {
    if (!Number.isFinite(rounds)) return 'never';
    if (rounds < 1) return 'under a round';
    const text = one(rounds);
    return `${text === '1.0' ? '1' : text} ${text === '1.0' ? 'round' : 'rounds'}`;
}

/**
 * The bottom line for a table of opponents.
 * @param {Array<{name:string, stats:Object}>} rows
 * @param {{sixthDoctor?:boolean}} [opts]
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarizeMindsDilation(rows, { sixthDoctor = false } = {}) {
    const valid = (rows ?? []).filter(r => r?.stats);
    if (valid.length === 0) return { html: '', tone: 'flat' };
    const r = roundStats(valid.map(v => v.stats));
    const tone = r.paybackRounds <= 2 ? 'good' : r.paybackRounds <= 4 ? 'warn' : 'bad';
    const payback = Number.isFinite(r.paybackRounds)
        ? `it pays back its ${MINDS_DILATION_COST} mana in <strong>${formatRounds(r.paybackRounds)}</strong>`
        : 'it never pays back — their library is all lands';
    const doctor = sixthDoctor ? ' Historic spells count double, for The Sixth Doctor’s copy.' : '';

    if (valid.length === 1) {
        const s = valid[0].stats;
        return {
            tone,
            html: `If ${escapeHtml(valid[0].name)} casts a spell every turn, Mind’s Dilation hands you a free spell on <strong>${pct(s.pNonland)}</strong> of their turns, worth about <strong>${one(s.avgEffectiveMV)} mana</strong> each — ${payback}.${doctor}`
        };
    }
    return {
        tone,
        html: `With ${countWord(valid.length)} opponents each casting a spell a turn, Mind’s Dilation flips about <strong>${one(r.spellsPerRound)} free spells a round</strong> (at least one <strong>${pct(r.chanceAny)}</strong> of the time) worth <strong>${one(r.manaPerRound)} mana</strong> — ${payback}.${doctor}`
    };
}
