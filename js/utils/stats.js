/**
 * Percentiles, defined once.
 *
 * Every page that quotes a "typical", "good turn" or "1 in 10" number uses the
 * same rule, the one the glossary states ("only 1 cast in 20 does better than
 * this"): the q-quantile is the smallest value v with P(X ≤ v) ≥ q — the
 * nearest-rank percentile. Concretely:
 *   - it is always a value that actually occurs (never interpolated, and a
 *     value with zero weight is never returned — so q = 0 is the smallest
 *     outcome seen, not 0);
 *   - q is clamped to [0, 1]; q = 1 is the largest outcome (pages quote p90,
 *     p95, p99 — never the sampled maximum);
 *   - cumulative sums are compared with a relative tolerance of 1e-9, so a
 *     probability vector that sums to 0.9999999999 still reaches q = 1 and
 *     floating-point dust never pushes an answer one value higher;
 *   - an empty (or all-zero) distribution gives 0.
 */

const EPSILON = 1e-9;

const clamp01 = q => Math.min(1, Math.max(0, Number(q) || 0));

/**
 * Quantile of a distribution held as weights indexed by value — counts,
 * fractional counts or probabilities, normalised or not.
 * @param {ArrayLike<number>} weights - weights[value]
 * @param {number} q - 0..1
 * @returns {number} a value (an index into `weights`)
 */
export function quantile(weights, q) {
    const w = weights ?? [];
    let total = 0;
    for (let v = 0; v < w.length; v++) total += w[v] || 0;
    if (!(total > 0)) return 0;
    const target = (clamp01(q) - EPSILON) * total;
    let cum = 0;
    let last = 0;
    for (let v = 0; v < w.length; v++) {
        const x = w[v] || 0;
        if (!(x > 0)) continue;
        cum += x;
        last = v;
        if (cum >= target) return v;
    }
    return last;
}

/**
 * Quantile of raw samples already sorted ascending (same rule as quantile()).
 * @param {number[]} sorted
 * @param {number} q - 0..1
 * @returns {number} one of the samples, or 0 when there are none
 */
export function quantileSorted(sorted, q) {
    const n = Array.isArray(sorted) ? sorted.length : 0;
    if (n === 0) return 0;
    const rank = Math.ceil((clamp01(q) - EPSILON) * n);
    return sorted[Math.min(n, Math.max(1, rank)) - 1];
}

/**
 * Several quantiles of one distribution, keyed by name.
 * @param {ArrayLike<number>} weights
 * @param {Record<string, number>} qs - e.g. { p25: 0.25, p50: 0.5 }
 * @returns {Record<string, number>}
 */
export function quantiles(weights, qs) {
    const out = {};
    for (const [key, q] of Object.entries(qs ?? {})) out[key] = quantile(weights, q);
    return out;
}

/**
 * The arithmetic mean of a list (0 when empty).
 * @param {number[]} values
 */
export function mean(values) {
    const list = Array.isArray(values) ? values : [];
    if (list.length === 0) return 0;
    let sum = 0;
    for (const v of list) sum += v;
    return sum / list.length;
}
