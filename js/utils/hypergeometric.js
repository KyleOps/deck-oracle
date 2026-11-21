/**
 * Hypergeometric Probability Utilities
 * Mathematical functions for MTG probability calculations
 */

/**
 * Binomial coefficient (n choose k) with memoization
 * @param {number} n - Total items
 * @param {number} k - Items to choose
 * @returns {number} - Number of combinations
 */
const chooseCache = new Map();

export function choose(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;

    // Use the smaller of k and n-k for efficiency
    k = Math.min(k, n - k);

    const key = (n << 16) | k; // Simple hash for typical deck sizes (n < 65536)
    if (chooseCache.has(key)) {
        return chooseCache.get(key);
    }

    let result = 1;
    for (let i = 0; i < k; i++) {
        result *= (n - i);
        result /= (i + 1);
    }

    chooseCache.set(key, result);
    return result;
}

/**
 * Hypergeometric probability - exactly X successes
 * P(X = typeDrawn | allTotal, typeTotal, allDrawn)
 *
 * @param {number} allTotal - Total cards in population
 * @param {number} typeTotal - Total success cards in population
 * @param {number} allDrawn - Cards drawn
 * @param {number} typeDrawn - Success cards drawn
 * @returns {number} - Probability of exactly typeDrawn successes
 */
export function drawType(allTotal, typeTotal, allDrawn, typeDrawn) {
    if (typeDrawn < 0 || typeDrawn > typeTotal) return 0;
    if (typeDrawn > allDrawn) return 0;
    if (allDrawn - typeDrawn > allTotal - typeTotal) return 0;

    const numerator = choose(typeTotal, typeDrawn) * choose(allTotal - typeTotal, allDrawn - typeDrawn);
    const denominator = choose(allTotal, allDrawn);

    return numerator / denominator;
}

/**
 * Hypergeometric probability - at least X successes
 * P(X >= typeDrawn | allTotal, typeTotal, allDrawn)
 *
 * @param {number} allTotal - Total cards in population
 * @param {number} typeTotal - Total success cards in population
 * @param {number} allDrawn - Cards drawn
 * @param {number} typeDrawn - Minimum success cards drawn
 * @returns {number} - Probability of at least typeDrawn successes
 */
export function drawTypeMin(allTotal, typeTotal, allDrawn, typeDrawn) {
    let prob = 0;
    const maxPossible = Math.min(typeTotal, allDrawn);

    for (let i = typeDrawn; i <= maxPossible; i++) {
        prob += drawType(allTotal, typeTotal, allDrawn, i);
    }

    return prob;
}

// ── Whole distributions ──────────────────────────────────────────────────────

const LOG_FACTORIAL = [0];

function logFactorial(n) {
    for (let i = LOG_FACTORIAL.length; i <= n; i++) {
        LOG_FACTORIAL[i] = LOG_FACTORIAL[i - 1] + Math.log(i);
    }
    return LOG_FACTORIAL[n];
}

function logChoose(n, k) {
    return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * Exact distribution of successes when drawing without replacement.
 * @param {number} population - cards in the library
 * @param {number} successes - cards that count as a hit
 * @param {number} draws - cards looked at
 * @returns {number[]} pmf, index = number of hits (length draws + 1)
 */
export function hypergeometricPmf(population, successes, draws) {
    const N = Math.max(0, Math.floor(Number(population) || 0));
    const K = Math.min(N, Math.max(0, Math.floor(Number(successes) || 0)));
    const n = Math.min(N, Math.max(0, Math.floor(Number(draws) || 0)));
    const pmf = new Array(n + 1).fill(0);
    const lo = Math.max(0, n - (N - K));
    const hi = Math.min(n, K);
    const denominator = logChoose(N, n);
    for (let k = lo; k <= hi; k++) {
        pmf[k] = Math.exp(logChoose(K, k) + logChoose(N - K, n - k) - denominator);
    }
    return pmf;
}
