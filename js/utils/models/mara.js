/**
 * Ensnared by the Mara — {2}{R}{R} sorcery. The page's maths.
 *
 * Each opponent faces a villainous choice:
 *   • they exile cards from the top of their library until they exile a
 *     nonland card, and you may cast it without paying its mana cost; or
 *   • they exile their top four cards and Mara deals damage equal to the total
 *     mana value of those cards.
 *
 * Both options are worked out EXACTLY from each opponent's list: the free spell
 * is a uniformly random nonland card of their library, and the damage is a sum
 * over every possible set of four top cards. Sample casts are real shuffles,
 * for illustration only.
 *
 * Pure: no DOM, no opponent state. The page passes each opponent's deck in.
 */

import { escapeHtml } from '../../data/glossary.js';
import { choose } from '../hypergeometric.js';
import { isLand } from '../library.js';
import { one } from '../text.js';
import { countWord, createRevealer, opponentLibrary, spread, tailAtLeast, typicalRange, versusCost } from './opponentLibrary.js';

/** Mara's own mana value — what the free spells are measured against. */
export const MARA_COST = 4;

/** Cards exiled by the damage option. */
export const DAMAGE_CARDS = 4;

/** "Big" outcomes called out in the table. */
export const BIG_SPELL_MV = 5;

export const BIG_DAMAGE = 10;

/**
 * Choice 1 on a shuffled library: exile until a nonland card.
 * @param {Array} deck - shuffled library (top first)
 * @returns {{cardsExiled:number, spellCMC:number, spellName:string|null, spellTypes:string[]}}
 */
export function simulateChoice1(deck) {
    for (let i = 0; i < deck.length; i++) {
        if (!isLand(deck[i])) {
            return {
                cardsExiled: i + 1,
                spellCMC: deck[i].cmc || 0,
                spellName: deck[i].name,
                spellTypes: deck[i].types
            };
        }
    }
    // A library of nothing but lands: everything is exiled and nothing is cast.
    return { cardsExiled: deck.length, spellCMC: 0, spellName: null, spellTypes: [] };
}

/**
 * Choice 2 on a shuffled library: the top four cards' total mana value.
 * @param {Array} deck - shuffled library (top first)
 * @returns {{damage:number, cards:Array<{name:string, cmc:number, types:string[]}>}}
 */
export function simulateChoice2(deck) {
    const top = deck.slice(0, DAMAGE_CARDS);
    return {
        damage: top.reduce((sum, card) => sum + (card.cmc || 0), 0),
        cards: top.map(c => ({ name: c.name, cmc: c.cmc || 0, types: c.types }))
    };
}

/**
 * Exact distribution of the total mana value of `draw` cards taken from the top
 * of a shuffled library (drawing without replacement): counts every possible
 * set of cards by mana-value group.
 * @param {Array<{cmc:number}>} library
 * @param {number} [draw=4]
 * @returns {number[]} probability by total (index = total mana value)
 */
export function topCardsTotalDistribution(library, draw = DAMAGE_CARDS) {
    const n = library.length;
    const k = Math.min(draw, n);
    if (n === 0) return [1];

    const groups = new Map();
    for (const card of library) {
        const mv = Math.max(0, Math.round(card.cmc || 0));
        groups.set(mv, (groups.get(mv) ?? 0) + 1);
    }
    const sorted = library.map(c => Math.max(0, Math.round(c.cmc || 0))).sort((a, b) => b - a);
    const maxTotal = sorted.slice(0, k).reduce((a, b) => a + b, 0);

    // ways[picked][total] = number of ways to pick `picked` cards totalling `total`
    let ways = Array.from({ length: k + 1 }, () => new Float64Array(maxTotal + 1));
    ways[0][0] = 1;
    for (const [mv, count] of groups) {
        const next = Array.from({ length: k + 1 }, () => new Float64Array(maxTotal + 1));
        for (let picked = 0; picked <= k; picked++) {
            const row = ways[picked];
            for (let total = 0; total <= maxTotal; total++) {
                const w = row[total];
                if (!w) continue;
                for (let j = 0; j <= Math.min(count, k - picked); j++) {
                    const t = total + j * mv;
                    if (t > maxTotal) break;
                    next[picked + j][t] += w * choose(count, j);
                }
            }
        }
        ways = next;
    }
    const all = choose(n, k);
    return Array.from(ways[k], w => w / all);
}

/**
 * Exact statistics for both options against one opponent list.
 * @param {Object} opponentData - deck data with cardsByName
 * @returns {Object|null}
 */
export function calculateMaraStats(opponentData) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) return null;
    const library = opponentLibrary(opponentData);
    const n = library.length;
    if (n === 0) return null;

    const spells = library.filter(c => !c.land);
    const s = spells.length;
    const spellMvSum = spells.reduce((a, c) => a + c.cmc, 0);
    const mvProbs = [];
    for (const card of spells) {
        const mv = Math.round(card.cmc);
        mvProbs[mv] = (mvProbs[mv] ?? 0) + 1 / s;
    }
    for (let i = 0; i < mvProbs.length; i++) mvProbs[i] = mvProbs[i] ?? 0;

    const damageProbs = topCardsTotalDistribution(library, DAMAGE_CARDS);
    const k = Math.min(DAMAGE_CARDS, n);
    const allMv = library.map(c => c.cmc).sort((a, b) => a - b);
    const totalMv = allMv.reduce((a, b) => a + b, 0);

    return {
        choice1: {
            avgCMC: s ? spellMvSum / s : 0,
            // Position of the first nonland card in a shuffled library: (N + 1) / (S + 1).
            avgExiled: s ? (n + 1) / (s + 1) : n,
            pct5Plus: s ? (spells.filter(c => c.cmc >= BIG_SPELL_MV).length / s) * 100 : 0,
            mvProbs,
            typical: s ? typicalRange(mvProbs) : [0, 0]
        },
        choice2: {
            avgDamage: (k * totalMv) / n,
            minDamage: allMv.slice(0, k).reduce((a, b) => a + b, 0),
            maxDamage: allMv.slice(-k).reduce((a, b) => a + b, 0),
            damageProbs,
            pct10Plus: tailAtLeast(damageProbs, BIG_DAMAGE) * 100,
            typical: typicalRange(damageProbs)
        },
        deckSize: n,
        landCount: n - s,
        nonlandCount: s
    };
}

/**
 * The bottom line for a table of opponents.
 * @param {Array<{name:string, stats:Object}>} rows
 * @returns {{html:string, tone:'good'|'warn'|'flat'}}
 */
export function summarizeMara(rows) {
    const valid = (rows ?? []).filter(r => r?.stats);
    if (valid.length === 0) return { html: '', tone: 'flat' };
    const spells = valid.map(r => r.stats.choice1.avgCMC);
    const damage = valid.map(r => r.stats.choice2.avgDamage);
    const totalSpell = spells.reduce((a, b) => a + b, 0);
    const totalDamage = damage.reduce((a, b) => a + b, 0);
    const tone = totalSpell >= MARA_COST ? 'good' : 'warn';

    if (valid.length === 1) {
        return {
            tone,
            html: `Against ${escapeHtml(valid[0].name)}, Mara either hands you a free spell worth <strong>${spread(spells, 'mana')}</strong> or deals <strong>${spread(damage, 'damage')}</strong> — they choose before anything is revealed. On its own, the spell is worth ${versusCost(totalSpell, MARA_COST, 'Mara’s')}.`
        };
    }
    return {
        tone,
        html: `Each of the ${countWord(valid.length)} opponents either hands you a free spell worth <strong>${spread(spells, 'mana')}</strong> or takes <strong>${spread(damage, 'damage')}</strong> — their choice. Across the table that’s <strong>${one(totalSpell)} mana</strong> of free spells (${versusCost(totalSpell, MARA_COST, 'Mara’s')}), <strong>${one(totalDamage)} damage</strong>, or a mix.`
    };
}

/** One sample cast against one library: the reveal for each option, from the same shuffle. */
export function sampleCast(library) {
    const revealer = createRevealer(library);
    const seen = [];
    let spellAt = -1;
    while (spellAt < 0 || seen.length < DAMAGE_CARDS) {
        const card = revealer.reveal();
        if (!card) break;
        seen.push(card);
        if (spellAt < 0 && !card.land) spellAt = seen.length - 1;
    }
    return {
        spellRun: spellAt >= 0 ? seen.slice(0, spellAt + 1) : seen,
        spell: spellAt >= 0 ? seen[spellAt] : null,
        top: seen.slice(0, DAMAGE_CARDS)
    };
}
