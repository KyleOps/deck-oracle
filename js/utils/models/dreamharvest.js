/**
 * Dream Harvest — {5}{U/B}{U/B} sorcery. The page's maths.
 *
 * Each opponent exiles cards from the top of their library until they have
 * exiled cards with total mana value 5 or greater this way. Until end of turn,
 * you may cast cards exiled this way without paying their mana costs.
 *
 * Simulated: each opponent's real list is shuffled 20,000 times (seeded by the
 * list itself, so the same deck always gives the same numbers) and only as many
 * cards as the exile reaches are shuffled each time.
 *
 * Pure: no DOM, no opponent state. The page passes each opponent's deck in.
 */

import { escapeHtml } from '../../data/glossary.js';
import { pmfQuantiles } from '../viz.js';
import { isLand } from '../library.js';
import { mulberry32 } from '../random.js';
import { one } from '../text.js';
import { countWord, createRevealer, deckSeed, formatRange, opponentLibrary, spread, typicalRange, versusCost } from './opponentLibrary.js';

/** Dream Harvest's own mana value — what the stolen spells are measured against. */
export const DREAM_HARVEST_COST = 7;

/** Exile until the pile's total mana value reaches this. */
export const MV_THRESHOLD = 5;

/** "Big" stolen spell called out in the table. */
export const BIG_SPELL_MV = 5;

export const SIM_RUNS = 20000;

/**
 * Resolve Dream Harvest against one opponent, revealing cards from a source.
 * @param {() => (Object|null)} nextCard - returns the next card from the top, or null when empty
 * @returns {{cardsExiled:number, totalMV:number, exiledCards:Array, castableSpells:Array, numCastable:number, totalCastableMV:number}}
 */
export function resolveDreamHarvest(nextCard) {
    let totalMV = 0;
    const exiledCards = [];
    while (totalMV < MV_THRESHOLD) {
        const card = nextCard();
        if (!card) break;
        exiledCards.push(card);
        totalMV += card.cmc || 0;
    }
    const castableSpells = exiledCards.filter(c => !isLand(c));
    return {
        cardsExiled: exiledCards.length,
        totalMV,
        exiledCards,
        castableSpells,
        numCastable: castableSpells.length,
        totalCastableMV: castableSpells.reduce((sum, c) => sum + (c.cmc || 0), 0)
    };
}

/**
 * Dream Harvest on a shuffled library (top first).
 * @param {Array} deck
 */
export function simulateDreamHarvest(deck) {
    let i = 0;
    return resolveDreamHarvest(() => (i < deck.length ? deck[i++] : null));
}

function bump(arr, i, by = 1) {
    arr[i] = (arr[i] ?? 0) + by;
}

function normalise(counts, runs) {
    return Array.from(counts, c => (c ?? 0) / runs);
}

/**
 * Statistics for one opponent list.
 * @param {Object} opponentData - deck data with cardsByName
 * @param {number} [numSims=20000]
 * @param {number} [seed] - defaults to a hash of the list, so results are repeatable
 * @returns {Object|null}
 */
export function calculateDreamHarvestStats(opponentData, numSims = SIM_RUNS, seed = undefined) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) return null;
    const library = opponentLibrary(opponentData);
    if (library.length === 0) return null;
    const runs = Math.max(1, Math.floor(numSims) || 1);

    const revealer = createRevealer(library, mulberry32(seed ?? deckSeed(library)));
    let totalCardsExiled = 0;
    let totalMV = 0;
    let totalCastable = 0;
    let totalCastableMV = 0;
    let bigRuns = 0;
    const spellCounts = [];
    const manaCounts = [];
    const exiledCounts = [];

    for (let i = 0; i < runs; i++) {
        revealer.reset();
        const r = resolveDreamHarvest(revealer.reveal);
        totalCardsExiled += r.cardsExiled;
        totalMV += r.totalMV;
        totalCastable += r.numCastable;
        totalCastableMV += r.totalCastableMV;
        if (r.castableSpells.some(c => c.cmc >= BIG_SPELL_MV)) bigRuns += 1;
        bump(spellCounts, r.numCastable);
        bump(manaCounts, Math.round(r.totalCastableMV));
        bump(exiledCounts, r.cardsExiled);
    }

    const spellsProbs = normalise(spellCounts, runs);
    const manaProbs = normalise(manaCounts, runs);
    return {
        avgCardsExiled: totalCardsExiled / runs,
        avgTotalMV: totalMV / runs,
        avgCastable: totalCastable / runs,
        avgCastableMV: totalCastableMV / runs,
        pBigSpell: bigRuns / runs,
        spellsProbs,
        manaProbs,
        exiledProbs: normalise(exiledCounts, runs),
        typicalSpells: typicalRange(spellsProbs),
        typicalMana: typicalRange(manaProbs),
        numSims: runs,
        deckSize: library.length,
        landCount: library.filter(c => c.land).length
    };
}

/** Average several probability arrays into one (the "typical opponent"). */
export function poolDistributions(dists) {
    const length = Math.max(0, ...dists.map(d => d.length));
    const pooled = new Array(length).fill(0);
    for (const d of dists) d.forEach((p, i) => { pooled[i] += (p || 0) / dists.length; });
    return pooled;
}

/**
 * The bottom line for a table of opponents.
 * @param {Array<{name:string, stats:Object}>} rows
 * @returns {{html:string, tone:'good'|'warn'|'flat'}}
 */
export function summarizeDreamHarvest(rows) {
    const valid = (rows ?? []).filter(r => r?.stats);
    if (valid.length === 0) return { html: '', tone: 'flat' };
    const totalMana = valid.reduce((a, r) => a + r.stats.avgCastableMV, 0);
    const range = typicalRange(poolDistributions(valid.map(r => r.stats.spellsProbs)));
    const spells = `${formatRange(range)} ${range[1] === 1 ? 'spell' : 'spells'}`;
    const mana = spread(valid.map(r => r.stats.avgCastableMV), 'mana');
    const tone = totalMana >= DREAM_HARVEST_COST ? 'good' : 'warn';

    if (valid.length === 1) {
        return {
            tone,
            html: `Against ${escapeHtml(valid[0].name)}, Dream Harvest usually steals <strong>${spells}</strong> worth <strong>${mana}</strong> in all — ${versusCost(totalMana, DREAM_HARVEST_COST)}.`
        };
    }
    return {
        tone,
        html: `Against these ${countWord(valid.length)} decks, Dream Harvest usually steals <strong>${spells}</strong> worth <strong>${mana}</strong> from each opponent — <strong>${one(totalMana)} mana</strong> of free spells in all, ${versusCost(totalMana, DREAM_HARVEST_COST)}.`
    };
}

/**
 * The distribution of the TOTAL mana stolen across every opponent: each
 * opponent's pile is independent, so the per-opponent distributions convolve.
 * @param {number[][]} dists - probabilities by whole mana value, one per opponent
 * @returns {number[]} index = total mana stolen
 */
export function totalStolenDistribution(dists) {
    let total = [1];
    for (const d of dists ?? []) {
        const next = new Array(total.length + Math.max(0, (d?.length ?? 1) - 1)).fill(0);
        total.forEach((a, i) => {
            if (!a) return;
            (d ?? []).forEach((b, j) => { if (b) next[i + j] += a * b; });
        });
        total = next;
    }
    return total;
}

/**
 * "Out of 100 casts": quantile dots of the total mana stolen, solid when the
 * free spells add up to at least Dream Harvest's own cost.
 * @param {number[]} totalDist - from totalStolenDistribution
 * @returns {Array<{value:number, tone:'good'|'bad'}>}
 */
export function harvestDots(totalDist) {
    return pmfQuantiles(totalDist ?? [], 100).map(value => ({ value, tone: value >= DREAM_HARVEST_COST ? 'good' : 'bad' }));
}
