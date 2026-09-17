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
 * the Monstrous Vortex tab and the head-to-head comparison would otherwise each
 * carry their own copy, and two implementations that drift produce two different
 * answers for the same deck on the same site.
 */

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

/**
 * Walk one discover chain down a pre-shuffled library.
 *
 * The library is consumed from the top: lands and cards above the current mana
 * value are passed over, the first eligible nonland is the hit. If that hit is a
 * power-5+ creature the chain continues at its mana value, because casting it
 * triggers Vortex again.
 *
 * Takes a pre-shuffled array so it is deterministic and testable — the caller
 * owns the randomness.
 *
 * @param {Array<{name:string, cmc:number, types:string[], power?:*}>} library - Pre-shuffled
 * @param {number} startCMC - Mana value of the first discover
 * @param {Object} [opts]
 * @param {boolean} [opts.treatStarAs5Plus=false]
 * @param {number} [opts.maxChain=10] - Safety cap on chain length
 * @returns {{steps:Array<{discoverCMC:number, dug:number, hit:Object|null, chains:boolean}>,
 *            chainCount:number, chainMana:number}}
 */
export function simulateDiscoverChain(library, startCMC, opts = {}) {
    const { treatStarAs5Plus = false, maxChain = 10 } = opts;
    const lib = Array.isArray(library) ? library : [];

    const steps = [];
    let discoverCMC = Number.isFinite(startCMC) ? startCMC : 0;
    let index = 0;
    let chainCount = 0;
    let chainMana = 0;

    while (chainCount < maxChain && index < lib.length) {
        let hit = null;
        let dug = 0;

        for (; index < lib.length; index++) {
            const card = lib[index];
            const types = Array.isArray(card?.types) ? card.types : [];
            if (types.includes('land')) { dug += 1; continue; }
            const cmc = Number.isFinite(card?.cmc) ? card.cmc : 0;
            if (cmc <= discoverCMC) { hit = card; index += 1; break; }
            dug += 1;
        }

        if (!hit) {
            steps.push({ discoverCMC, dug, hit: null, chains: false });
            break;
        }

        const types = Array.isArray(hit.types) ? hit.types : [];
        const chains = types.includes('creature') && isPower5Plus(hit.power, treatStarAs5Plus);

        chainCount += 1;
        chainMana += Number.isFinite(hit.cmc) ? hit.cmc : 0;
        steps.push({ discoverCMC, dug, hit, chains });

        if (!chains) break;
        discoverCMC = Number.isFinite(hit.cmc) ? hit.cmc : 0;
    }

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

    let totalMana = 0;
    let totalSpells = 0;
    let best = 0;
    let whiffs = 0;
    let chained = 0;
    const chainDist = [];
    const manaDist = [];

    for (let i = 0; i < n; i++) {
        const { chainCount, chainMana } = simulateDiscoverChain(shuffledLibrary(), startCMC, { treatStarAs5Plus });
        totalMana += chainMana;
        totalSpells += chainCount;
        if (chainMana > best) best = chainMana;
        if (chainCount === 0) whiffs += 1;
        if (chainCount >= 2) chained += 1;
        chainDist[chainCount] = (chainDist[chainCount] || 0) + 1;
        const bucket = Math.max(0, Math.round(chainMana));
        manaDist[bucket] = (manaDist[bucket] || 0) + 1;
    }

    for (let i = 0; i < chainDist.length; i++) if (!chainDist[i]) chainDist[i] = 0;
    for (let i = 0; i < manaDist.length; i++) if (!manaDist[i]) manaDist[i] = 0;

    return {
        runs: n,
        avgMana: totalMana / n,
        avgSpells: totalSpells / n,
        // The largest run SEEN, not a ceiling — it grows with the sample size.
        // Callers that want a stable "good turn" figure should use p95.
        bestMana: best,
        medianMana: percentileFromDist(manaDist, 0.5),
        p95Mana: percentileFromDist(manaDist, 0.95),
        p99Mana: percentileFromDist(manaDist, 0.99),
        whiffRate: whiffs / n,
        chainRate: chained / n,
        chainDist,
        manaDist
    };
}
