/**
 * Discover — the shared mechanic model
 *
 * "Discover N: Exile cards from the top of your library until you exile a
 * nonland card with mana value N or less. Cast it without paying its mana cost
 * or put it into your hand. Put the rest on the bottom in a random order."
 *
 * Monstrous Vortex discovers X where X is the mana value of the power-5+
 * creature spell you cast — and because discover *casts* the card it finds, a
 * discovered power-5+ creature triggers Vortex again, at its own mana value.
 * That chain is the whole reason Vortex has a long tail.
 *
 * This lives outside any one calculator because more than one place needs it:
 * the Monstrous Vortex page and the Head to Head comparison both sample through
 * `discoverForCreature()`, with the same library, run count and seed, so the
 * same creature in the same deck gets the same numbers on both pages.
 */

/** Runs per sampled discover. Sized for a steady p99, not just the mean. */
export const DISCOVER_RUNS = 2000;

/**
 * Whether a printed power counts as 5 or greater.
 *
 * Variable boxes (`*`, `1+*`, `X`) are usually 0 in the library but can be huge
 * on the battlefield, and Vortex checks the spell on the stack — so which way to
 * read them is a judgement call the caller makes.
 *
 * @param {string|number|null|undefined} power
 * @param {boolean} [treatStarAs5Plus=false]
 * @returns {boolean}
 */
export function isPower5Plus(power, treatStarAs5Plus = false) {
    if (power === undefined || power === null) return false;
    const s = String(power);
    if (s.includes('*') || s.includes('X')) return treatStarAs5Plus;
    const p = parseInt(s, 10);
    return !Number.isNaN(p) && p >= 5;
}

/** True when a simulation-deck card is a power-5+ creature (what Vortex sees). */
export function isBigCreature(card, treatStarAs5Plus = false) {
    const types = Array.isArray(card?.types) ? card.types : [];
    return types.includes('creature') && isPower5Plus(card.power, treatStarAs5Plus);
}

/**
 * The one walk of a discover chain. Every caller goes through here so there is
 * exactly one definition of the mechanic.
 *
 * Positions are requested strictly in order (0, 1, 2, …), which is what lets a
 * caller hand in a lazily shuffled library (see `sampleDiscoverFrom`).
 *
 * @param {(i:number)=>Object} draw - card at library position i
 * @param {number} length - library size
 * @param {number} startCMC
 * @param {boolean} treatStarAs5Plus
 * @param {number} maxChain
 * @param {Array|null} steps - pushed to when given; null skips the bookkeeping
 * @returns {{chainCount:number, chainMana:number}}
 */
function walkChain(draw, length, startCMC, treatStarAs5Plus, maxChain, steps) {
    let discoverCMC = Number.isFinite(startCMC) ? startCMC : 0;
    let index = 0;
    let chainCount = 0;
    let chainMana = 0;

    while (chainCount < maxChain && index < length) {
        const start = index;
        let hit = null;
        let dug = 0;

        for (; index < length; index++) {
            const card = draw(index);
            const types = Array.isArray(card?.types) ? card.types : [];
            if (types.includes('land')) { dug += 1; continue; }
            const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
            if (cmc <= discoverCMC) { hit = card; index += 1; break; }
            dug += 1;
        }

        if (!hit) {
            if (steps) steps.push({ discoverCMC, start, dug, hit: null, chains: false });
            break;
        }

        const chains = isBigCreature(hit, treatStarAs5Plus);
        chainCount += 1;
        chainMana += Number.isFinite(hit.cmc) ? hit.cmc : 0;
        if (steps) steps.push({ discoverCMC, start, dug, hit, chains });

        if (!chains) break;
        discoverCMC = Number.isFinite(hit.cmc) ? hit.cmc : 0;
    }

    return { chainCount, chainMana };
}

/**
 * Walk one discover chain down a pre-shuffled library.
 *
 * The library is consumed from the top: lands and cards above the current mana
 * value are passed over, the first eligible nonland is the hit. If that hit is a
 * power-5+ creature the chain continues at its mana value, because casting it
 * triggers Vortex again.
 *
 * Takes a pre-shuffled array so it is deterministic and testable — the caller
 * owns the randomness. Each step records where it started (`start`) and how
 * many cards it passed over (`dug`), so `library.slice(start, start + dug)` is
 * exactly what that discover exiled before its hit.
 *
 * @param {Array<{name:string, cmc:number, types:string[], power?:*}>} library - Pre-shuffled
 * @param {number} startCMC - Mana value of the first discover
 * @param {Object} [opts]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @param {number} [opts.maxChain=10] - Safety cap on chain length
 * @returns {{steps:Array<{discoverCMC:number, start:number, dug:number, hit:Object|null, chains:boolean}>,
 *            chainCount:number, chainMana:number}}
 */
export function simulateDiscoverChain(library, startCMC, opts = {}) {
    const { treatStarAs5Plus = false, maxChain = 10 } = opts;
    const lib = Array.isArray(library) ? library : [];
    const steps = [];
    const { chainCount, chainMana } = walkChain(i => lib[i], lib.length, startCMC, treatStarAs5Plus, maxChain, steps);
    return { steps, chainCount, chainMana };
}

/**
 * Percentile of a distribution held as counts indexed by value.
 *
 * Used instead of the maximum wherever an outcome is random. A sampled maximum
 * is not a property of the deck — it is a property of how many samples you took,
 * and it keeps climbing as you take more. A percentile is stable, and it is the
 * number that answers "how good is a good turn".
 *
 * @param {number[]} dist - counts[value]
 * @param {number} q - 0..1
 * @returns {number} the value at that percentile, or 0 for an empty distribution
 */
export function percentileFromDist(dist, q) {
    const counts = Array.isArray(dist) ? dist : [];
    const total = counts.reduce((a, b) => a + (b || 0), 0);
    if (total === 0) return 0;
    // No ceil(): merged distributions carry FRACTIONAL weights (each sampled
    // spread is normalised to count as one cast), and with a total of 1 a
    // ceil'd target of 1 is only ever reached at the last non-empty bucket —
    // which silently turned every percentile into the maximum.
    const target = Math.min(1, Math.max(0, q)) * total;
    let seen = 0;
    for (let v = 0; v < counts.length; v++) {
        seen += counts[v] || 0;
        if (seen > 0 && seen >= target) return v;
    }
    return counts.length ? counts.length - 1 : 0;
}

/**
 * Merge count-indexed distributions, optionally weighted.
 *
 * @param {Array<{dist:number[], weight?:number}>} parts
 * @returns {number[]} counts[value]
 */
export function mergeDists(parts) {
    const out = [];
    for (const part of (parts || [])) {
        const w = Number.isFinite(part?.weight) ? part.weight : 1;
        const d = Array.isArray(part?.dist) ? part.dist : [];
        for (let v = 0; v < d.length; v++) out[v] = (out[v] || 0) + (d[v] || 0) * w;
    }
    for (let v = 0; v < out.length; v++) if (!out[v]) out[v] = 0;
    return out;
}

/**
 * Fold a distribution's far tail into one "N or more" bucket for display.
 *
 * A histogram of sampled outcomes always ends at the largest run seen, which is
 * the sampled maximum by another name — it moves with the number of shuffles.
 * Folding everything from the q-th percentile up into that bucket keeps the
 * picture honest: the last row reads "14+ mana", not "26 mana".
 *
 * @param {number[]} dist - counts[value]
 * @param {number} [q=0.99]
 * @returns {{counts:number[], cut:number, folded:boolean}} folded is true when
 *          the last bucket holds values above `cut`
 */
export function foldTail(dist, q = 0.99) {
    const counts = Array.isArray(dist) ? dist.map(v => v || 0) : [];
    if (counts.length === 0) return { counts, cut: 0, folded: false };
    const cut = percentileFromDist(counts, q);
    const tail = counts.slice(cut + 1).reduce((a, b) => a + b, 0);
    const out = counts.slice(0, cut + 1);
    out[cut] = (out[cut] || 0) + tail;
    return { counts: out, cut, folded: tail > 0 };
}

/**
 * Table rows for a sampled distribution: each value's share and the chance of
 * at least that much, with the top 1% folded into a final "N or more" row
 * (`plus`), so a table never ends on the sampled maximum.
 *
 * @param {number[]} dist - counts[value]
 * @param {number} runs - total observations
 * @returns {Array<{value:number, plus:boolean, share:number, atLeast:number}>} values with any observations
 */
export function tailRows(dist, runs) {
    if (!(runs > 0)) return [];
    const { counts, cut, folded } = foldTail(dist);
    const rows = [];
    let atLeast = 1;
    counts.forEach((n, value) => {
        const share = n / runs;
        if (n > 0) rows.push({ value, plus: folded && value === cut, share, atLeast: Math.max(0, atLeast) });
        atLeast -= share;
    });
    return rows;
}

/** Fill holes in a sparse counts array with zeros, in place. */
function densify(arr) {
    for (let i = 0; i < arr.length; i++) if (!arr[i]) arr[i] = 0;
    return arr;
}

/**
 * Accumulates chain results into the summary every caller reports.
 * @returns {{add:(r:{chainCount:number, chainMana:number})=>void, done:()=>Object}}
 */
function summariser() {
    let n = 0, totalMana = 0, totalSpells = 0, whiffs = 0, chained = 0;
    const chainDist = [];
    const manaDist = [];
    return {
        add({ chainCount, chainMana }) {
            n += 1;
            totalMana += chainMana;
            totalSpells += chainCount;
            if (chainCount === 0) whiffs += 1;
            if (chainCount >= 2) chained += 1;
            chainDist[chainCount] = (chainDist[chainCount] || 0) + 1;
            const bucket = Math.max(0, Math.round(chainMana));
            manaDist[bucket] = (manaDist[bucket] || 0) + 1;
        },
        done() {
            densify(chainDist);
            densify(manaDist);
            const runs = Math.max(1, n);
            return {
                runs: n,
                avgMana: totalMana / runs,
                avgSpells: totalSpells / runs,
                medianMana: percentileFromDist(manaDist, 0.5),
                p95Mana: percentileFromDist(manaDist, 0.95),
                p99Mana: percentileFromDist(manaDist, 0.99),
                whiffRate: whiffs / runs,
                chainRate: chained / runs,
                chainDist,
                manaDist
            };
        }
    };
}

/**
 * Run many chains from the same starting mana value and summarise them.
 *
 * Discover is genuinely random — unlike a tutor, you take what the top of the
 * library gives you — so its value has to be sampled rather than solved. The
 * spread is as much the point as the mean: a long chain is rare and enormous,
 * and an average alone hides that completely.
 *
 * @param {Function} shuffledLibrary - Called per run, returns a fresh shuffled library
 * @param {number} startCMC
 * @param {Object} [opts]
 * @param {number} [opts.runs=400]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @returns {{runs:number, avgMana:number, avgSpells:number, bestMana:number,
 *            whiffRate:number, chainRate:number, chainDist:number[], manaDist:number[]}}
 */
export function sampleDiscover(shuffledLibrary, startCMC, opts = {}) {
    const { runs = 400, treatStarAs5Plus = false } = opts;
    const n = Math.max(1, Math.floor(runs));
    const acc = summariser();
    let best = 0;

    for (let i = 0; i < n; i++) {
        const r = simulateDiscoverChain(shuffledLibrary(), startCMC, { treatStarAs5Plus });
        if (r.chainMana > best) best = r.chainMana;
        acc.add(r);
    }

    // bestMana is the largest run SEEN, not a ceiling — it grows with the
    // sample size. Never display it; quote p95/p99 instead.
    return { ...acc.done(), bestMana: best };
}

// ==================== Seeded sampling ====================

/**
 * Small, fast seeded PRNG (mulberry32). Seeding makes a page's numbers a
 * property of the deck rather than of the moment: revisit the page and nothing
 * shuffles under you.
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 32-bit FNV-1a hash of a string, for deriving seeds from stable keys. */
export function hashSeed(str) {
    let h = 0x811c9dc5;
    const s = String(str ?? '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Seeded Fisher–Yates shuffle into a new array (the input is not touched).
 * @param {Array} library
 * @param {() => number} rng
 */
export function seededShuffle(library, rng) {
    const out = Array.isArray(library) ? library.slice() : [];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
}

/**
 * The library minus one copy of a card — the creature being cast is on the
 * stack, not in the library, so discover can never find it.
 *
 * @param {Array<{name:string}>} library
 * @param {string|null|undefined} name
 * @returns {Array} a new array (or the original when there is nothing to remove)
 */
export function withoutOne(library, name) {
    const lib = Array.isArray(library) ? library : [];
    if (!name) return lib;
    const i = lib.findIndex(c => c?.name === name);
    if (i === -1) return lib;
    return [...lib.slice(0, i), ...lib.slice(i + 1)];
}

/**
 * Sample many discover chains from one library, shuffling lazily.
 *
 * A discover usually reveals only a handful of cards, so shuffling all ninety-
 * nine for every run is wasted work. This fixes library positions one at a time
 * as the walk asks for them (a partial Fisher–Yates), which gives exactly the
 * distribution of a full shuffle at a fraction of the cost — and because the
 * walk is the same `walkChain` every other caller uses, the mechanic cannot
 * drift.
 *
 * @param {Array} library - the library as it stands (not pre-shuffled)
 * @param {number} startCMC
 * @param {Object} [opts]
 * @param {number} [opts.runs=DISCOVER_RUNS]
 * @param {number} [opts.seed=1]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @param {number} [opts.maxChain=10]
 * @returns {{runs:number, avgMana:number, avgSpells:number, medianMana:number,
 *            p95Mana:number, p99Mana:number, whiffRate:number, chainRate:number,
 *            chainDist:number[], manaDist:number[]}}
 */
export function sampleDiscoverFrom(library, startCMC, opts = {}) {
    const { runs = DISCOVER_RUNS, seed = 1, treatStarAs5Plus = false, maxChain = 10 } = opts;
    const pool = Array.isArray(library) ? library.slice() : [];
    const size = pool.length;
    const rng = mulberry32(seed);
    const n = Math.max(1, Math.floor(runs));
    const acc = summariser();

    let fixed = 0;
    const draw = (i) => {
        // Positions arrive in order, so i === fixed whenever a new one is needed.
        if (i >= fixed) {
            const j = i + Math.floor(rng() * (size - i));
            const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
            fixed = i + 1;
        }
        return pool[i];
    };

    for (let r = 0; r < n; r++) {
        fixed = 0;
        acc.add(walkChain(draw, size, startCMC, treatStarAs5Plus, maxChain, null));
    }
    return acc.done();
}

/**
 * What one cast of a specific creature discovers.
 *
 * The single entry point both Vortex pages use: the creature is removed from
 * the library (it is on the stack), the discover size is its mana value, and
 * the seed is derived from the creature, so the result is reproducible and
 * identical wherever it is asked for.
 *
 * @param {Array} library - simulation-deck cards (buildDeckFromCardData shape)
 * @param {{name:string, cmc:number}} creature
 * @param {Object} [opts]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @param {number} [opts.runs=DISCOVER_RUNS]
 */
export function discoverForCreature(library, creature, opts = {}) {
    const { treatStarAs5Plus = false, runs = DISCOVER_RUNS } = opts;
    const cmc = Math.max(0, Math.round(Number(creature?.cmc) || 0));
    return sampleDiscoverFrom(withoutOne(library, creature?.name), cmc, {
        runs,
        treatStarAs5Plus,
        seed: hashSeed(`${creature?.name ?? ''}|${cmc}`)
    });
}
