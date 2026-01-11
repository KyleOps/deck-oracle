/**
 * Hypergeometric Probability Utilities
 * Mathematical functions for MTG probability calculations
 */

/**
 * Factorial with memoization
 */
const factorialCache = new Map();
export function factorial(n) {
    if (n < 0) return 0;
    if (n === 0 || n === 1) return 1;

    if (factorialCache.has(n)) {
        return factorialCache.get(n);
    }

    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }

    factorialCache.set(n, result);
    return result;
}

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

/**
 * Two-type hypergeometric - exactly A and exactly B
 *
 * @param {number} allTotal - Total cards
 * @param {number} typeATotal - Total type A cards
 * @param {number} typeBTotal - Total type B cards
 * @param {number} allDrawn - Cards drawn
 * @param {number} typeADrawn - Type A cards drawn
 * @param {number} typeBDrawn - Type B cards drawn
 * @returns {number} - Probability
 */
export function drawTwoType(allTotal, typeATotal, typeBTotal, allDrawn, typeADrawn, typeBDrawn) {
    if (typeADrawn < 0 || typeBDrawn < 0) return 0;
    if (typeADrawn + typeBDrawn > allDrawn) return 0;

    const othersTotal = allTotal - typeATotal - typeBTotal;
    const othersDrawn = allDrawn - typeADrawn - typeBDrawn;

    if (othersDrawn < 0 || othersDrawn > othersTotal) return 0;

    const numerator = choose(typeATotal, typeADrawn) *
                     choose(typeBTotal, typeBDrawn) *
                     choose(othersTotal, othersDrawn);
    const denominator = choose(allTotal, allDrawn);

    return numerator / denominator;
}

/**
 * Two-type hypergeometric - at least A and at least B
 */
export function drawTwoTypeMin(allTotal, typeATotal, typeBTotal, allDrawn, typeADrawn, typeBDrawn) {
    let prob = 0;
    const maxA = Math.min(typeATotal, allDrawn);
    const maxB = Math.min(typeBTotal, allDrawn);

    for (let a = typeADrawn; a <= maxA; a++) {
        for (let b = typeBDrawn; b <= maxB; b++) {
            if (a + b <= allDrawn) {
                prob += drawTwoType(allTotal, typeATotal, typeBTotal, allDrawn, a, b);
            }
        }
    }

    return prob;
}

/**
 * Three-type hypergeometric - exactly A, B, and C
 */
export function drawThreeType(allTotal, typeATotal, typeBTotal, typeCTotal, allDrawn, typeADrawn, typeBDrawn, typeCDrawn) {
    if (typeADrawn < 0 || typeBDrawn < 0 || typeCDrawn < 0) return 0;
    if (typeADrawn + typeBDrawn + typeCDrawn > allDrawn) return 0;

    const othersTotal = allTotal - typeATotal - typeBTotal - typeCTotal;
    const othersDrawn = allDrawn - typeADrawn - typeBDrawn - typeCDrawn;

    if (othersDrawn < 0 || othersDrawn > othersTotal) return 0;

    const numerator = choose(typeATotal, typeADrawn) *
                     choose(typeBTotal, typeBDrawn) *
                     choose(typeCTotal, typeCDrawn) *
                     choose(othersTotal, othersDrawn);
    const denominator = choose(allTotal, allDrawn);

    return numerator / denominator;
}

/**
 * Three-type hypergeometric - at least A, B, and C
 */
export function drawThreeTypeMin(allTotal, typeATotal, typeBTotal, typeCTotal, allDrawn, typeADrawn, typeBDrawn, typeCDrawn) {
    let prob = 0;
    const maxA = Math.min(typeATotal, allDrawn);
    const maxB = Math.min(typeBTotal, allDrawn);
    const maxC = Math.min(typeCTotal, allDrawn);

    for (let a = typeADrawn; a <= maxA; a++) {
        for (let b = typeBDrawn; b <= maxB; b++) {
            for (let c = typeCDrawn; c <= maxC; c++) {
                if (a + b + c <= allDrawn) {
                    prob += drawThreeType(allTotal, typeATotal, typeBTotal, typeCTotal, allDrawn, a, b, c);
                }
            }
        }
    }

    return prob;
}
