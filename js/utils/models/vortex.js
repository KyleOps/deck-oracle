/**
 * Monstrous Vortex — the page's maths.
 *
 * {3}{G} Enchantment — "Whenever you cast a creature spell with power 5 or
 * greater, discover X, where X is that spell's mana value."
 *
 * Discover casts what it finds, so a discovered power-5+ creature triggers
 * Vortex again at its own mana value. That chain makes the outcome genuinely
 * random with a long tail, so this page samples it rather than solving it:
 * every number comes from `discoverForCreature()` / `sampleDiscoverFrom()` in
 * js/utils/discover.js — the same model, library, run count and seed the Head
 * to Head page uses, so the same creature gets the same answer on both pages.
 *
 * The page answers "how much free mana does each big creature discover?" in
 * three layers: one line for the deck, one row per big creature, and a detailed
 * look (percentiles, value by mana value, real sample triggers) at whichever
 * mana value the slider picks.
 *
 * Earlier versions solved the average with a recursion that drew WITH
 * replacement — a chaining creature could discover itself again — and divided by
 * zero (then multiplied by 100) when every eligible card chained at the same
 * mana value. Both are gone with the move to the shared simulation.
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { formatNumber } from '../simulation.js';
import { isLand } from '../library.js';
import { hashString, mulberry32, shuffled } from '../random.js';
import { pct } from '../text.js';
import {
    DISCOVER_RUNS, isBigCreature, discoverForCreature, sampleDiscoverFrom, simulateDiscoverChain, withoutOne
} from '../discover.js';
import { cardRef, term } from '../../data/glossary.js';
import { pmfQuantiles } from '../viz.js';

/** The mana value the page opens on. */
export const DEFAULT_MV = 6;

/** Monstrous Vortex's own mana value — the bar a trigger is measured against. */
export const VORTEX_COST = 4;

/** Sample triggers shown at first, and added per "show more". */
export const SAMPLE_BATCH = 5;

/**
 * The distinct power-5+ creatures in a library, with their copy counts.
 *
 * @param {Array} library - simulation-deck cards (buildDeckFromCardData shape)
 * @param {boolean} [treatStarAs5Plus=false]
 * @returns {Array<{name:string, cmc:number, power:*, toughness:*, count:number, variable:boolean}>}
 *          sorted by mana value, then name
 */
export function findBigCreatures(library, treatStarAs5Plus = false) {
    const byName = new Map();
    for (const card of (Array.isArray(library) ? library : [])) {
        if (!isBigCreature(card, treatStarAs5Plus)) continue;
        const entry = byName.get(card.name);
        if (entry) { entry.count += 1; continue; }
        const p = String(card.power ?? '');
        byName.set(card.name, {
            name: card.name,
            cmc: Math.max(0, Math.round(Number(card.cmc) || 0)),
            power: card.power,
            toughness: card.toughness,
            count: 1,
            variable: p.includes('*') || p.includes('X')
        });
    }
    return [...byName.values()].sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name));
}

/**
 * The cards a discover of `mv` can hit: nonlands at or under it, minus the
 * creature being cast. Grouped by mana value for display.
 *
 * @param {Array} library
 * @param {number} mv
 * @param {string|null} [castName]
 * @param {boolean} [treatStarAs5Plus=false]
 * @returns {{total:number, chainers:number, groups:Array<{mv:number, cards:Array<{name:string, count:number, chains:boolean}>}>}}
 */
export function discoverPool(library, mv, castName = null, treatStarAs5Plus = false) {
    const byMv = new Map();
    let total = 0;
    let chainers = 0;
    for (const card of withoutOne(library, castName)) {
        if (isLand(card)) continue;
        const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
        if (cmc > mv) continue;
        total += 1;
        const chains = isBigCreature(card, treatStarAs5Plus);
        if (chains) chainers += 1;
        if (!byMv.has(cmc)) byMv.set(cmc, new Map());
        const names = byMv.get(cmc);
        const entry = names.get(card.name) ?? { name: card.name, count: 0, chains };
        entry.count += 1;
        names.set(card.name, entry);
    }
    const groups = [...byMv.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([cost, names]) => ({
            mv: cost,
            cards: [...names.values()].sort((a, b) => Number(b.chains) - Number(a.chains) || a.name.localeCompare(b.name))
        }));
    return { total, chainers, groups };
}

/**
 * Everything the page shows, for one library and star-power reading.
 *
 * Each big creature is sampled with itself removed from the library. Each
 * mana value on the chart reuses a deck creature's result where one exists
 * (so the chart, the table and the sample triggers agree) and samples a
 * hypothetical caster otherwise.
 *
 * @param {Array} library
 * @param {Object} [opts]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @param {number} [opts.runs=DISCOVER_RUNS]
 */
export function analyzeVortex(library, opts = {}) {
    const { treatStarAs5Plus = false, runs = DISCOVER_RUNS } = opts;
    const lib = Array.isArray(library) ? library : [];

    const creatures = findBigCreatures(lib, treatStarAs5Plus).map(c => ({
        ...c,
        stats: discoverForCreature(lib, c, { treatStarAs5Plus, runs })
    }));

    // Creatures with a variable power box that the current reading leaves out.
    const starSkipped = treatStarAs5Plus
        ? 0
        : findBigCreatures(lib, true).filter(c => c.variable).length;

    const costs = creatures.map(c => c.cmc);
    const minMV = Math.max(1, Math.min(3, ...costs));
    const maxMV = Math.max(10, ...costs);

    const byMV = [];
    for (let mv = minMV; mv <= maxMV; mv++) {
        const here = creatures.filter(c => c.cmc === mv);
        const cast = here[0] ?? null;
        const stats = cast
            ? cast.stats
            : sampleDiscoverFrom(lib, mv, { runs, treatStarAs5Plus, seed: hashString(`mv|${mv}`) });
        byMV.push({
            x: mv,
            mv,
            castName: cast?.name ?? null,
            names: here.map(c => c.name),
            pool: discoverPool(lib, mv, cast?.name ?? null, treatStarAs5Plus).total,
            stats
        });
    }

    // Deck-wide figures weight each creature by its copies.
    const copies = creatures.reduce((s, c) => s + c.count, 0);
    const weighted = (f) => copies ? creatures.reduce((s, c) => s + f(c.stats) * c.count, 0) / copies : 0;
    const byValue = [...creatures].sort((a, b) => a.stats.avgMana - b.stats.avgMana);

    return {
        hasLibrary: lib.length > 0,
        librarySize: lib.length,
        treatStarAs5Plus,
        runs,
        creatures,
        copies,
        starSkipped,
        avgMana: weighted(s => s.avgMana),
        chainRate: weighted(s => s.chainRate),
        whiffRate: weighted(s => s.whiffRate),
        worst: byValue[0] ?? null,
        best: byValue[byValue.length - 1] ?? null,
        minMV,
        maxMV,
        byMV
    };
}

/** The chart/hero point for a mana value, clamped into the analysed range. */
export function pointAt(analysis, mv) {
    const rows = analysis?.byMV ?? [];
    if (rows.length === 0) return null;
    const clamped = Math.min(analysis.maxMV, Math.max(analysis.minMV, Math.round(Number(mv) || DEFAULT_MV)));
    return rows.find(r => r.mv === clamped) ?? rows[0];
}

/**
 * "Out of 100 triggers": quantile dots of the free mana one trigger casts.
 * Rings found nothing; solid green cast at least Vortex's own mana value;
 * neutral dots cast something smaller.
 * @param {number[]} manaDist - counts by free mana (discover summary)
 * @returns {Array<{value:number, tone:'good'|'flat'|'bad'}>}
 */
export function vortexDots(manaDist) {
    return pmfQuantiles(manaDist ?? [], 100).map(value => ({
        value,
        tone: value === 0 ? 'bad' : value >= VORTEX_COST ? 'good' : 'flat'
    }));
}

/** "about 1 trigger in 8 chains…" — chain frequency in words. */
export function chainPhrase(rate) {
    if (!(rate > 0)) return 'Nothing it can find is big enough to chain into another trigger.';
    if (rate < 0.01) return 'Chains into a second free spell are rare — under 1 trigger in 100.';
    if (rate < 0.5) return `About <strong>1 trigger in ${Math.round(1 / rate)}</strong> chains into a second free spell.`;
    return `<strong>${pct(rate)}</strong> of triggers chain into a second free spell.`;
}

/**
 * The bottom line: what this deck's big creatures discover, in one or two
 * sentences, with a tone for what that means against Vortex's own cost.
 *
 * @param {ReturnType<typeof analyzeVortex>} analysis
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(analysis) {
    if (!analysis?.hasLibrary) {
        return { tone: 'flat', html: 'Import a decklist to see what your big creatures discover.' };
    }
    const n = analysis.creatures.length;
    if (n === 0) {
        const hint = analysis.starSkipped > 0
            ? ` ${analysis.starSkipped} creature${analysis.starSkipped === 1 ? ' has' : 's have'} a variable power — tick “Count * power as 5 or more” if ${analysis.starSkipped === 1 ? 'it is' : 'they are'} big when you cast ${analysis.starSkipped === 1 ? 'it' : 'them'}.`
            : ' Add creatures with power 5 or more to give it something to do.';
        return { tone: 'bad', html: `No creature in this deck has power 5 or more, so Monstrous Vortex never triggers.${hint}` };
    }

    const avg = analysis.avgMana;
    let html;
    if (n === 1) {
        const c = analysis.creatures[0];
        html = `Your only big creature, ${cardRef(c.name)}, discovers about <strong>${formatNumber(c.stats.avgMana, 1)} mana</strong> of free spells when you cast it — typically ${c.stats.medianMana}, and <strong>${c.stats.p95Mana}</strong> on a ${term('p95', 'good turn')}.`;
    } else {
        const lo = analysis.worst;
        const hi = analysis.best;
        html = `Your <strong>${n} big creatures</strong> discover about <strong>${formatNumber(avg, 1)} mana</strong> of free spells per cast — from ${formatNumber(lo.stats.avgMana, 1)} off ${cardRef(lo.name)} up to <strong>${formatNumber(hi.stats.avgMana, 1)}</strong> off ${cardRef(hi.name)}.`;
    }
    html += ` ${chainPhrase(analysis.chainRate)}`;

    let tone = avg >= VORTEX_COST ? 'good' : avg >= 2.5 ? 'warn' : 'bad';
    if (analysis.copies <= 3 && tone === 'good') {
        tone = 'warn';
        html += ` With only ${analysis.copies} to cast, though, it will not trigger often.`;
    }
    return { html, tone };
}

/**
 * Real shuffled examples of one trigger at a mana value.
 *
 * Seeded by mana value, caster and round, so a sample set is stable until the
 * player asks for a new one. Each step lists exactly what discover exiled
 * before its hit.
 *
 * @returns {Array<{chainCount:number, chainMana:number, steps:Array<{discoverCMC:number, passed:Array, hit:Object|null, chains:boolean}>}>}
 */
export function drawSamples(library, mv, { castName = null, count = SAMPLE_BATCH, round = 0, treatStarAs5Plus = false } = {}) {
    const lib = withoutOne(library, castName);
    const rng = mulberry32(hashString(`sample|${mv}|${castName ?? ''}|${round}`));
    const out = [];
    for (let i = 0; i < count; i++) {
        const order = shuffled(lib, rng);
        const r = simulateDiscoverChain(order, mv, { treatStarAs5Plus });
        out.push({
            chainCount: r.chainCount,
            chainMana: r.chainMana,
            steps: r.steps.map(s => ({
                discoverCMC: s.discoverCMC,
                passed: order.slice(s.start, s.start + s.dug),
                hit: s.hit,
                chains: s.chains
            }))
        });
    }
    return out;
}
