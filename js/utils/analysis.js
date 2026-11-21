/**
 * Recommending a setting from a sweep of results. Pure and dependency-free.
 */

/**
 * Recommend a parameter value from a sweep of {x, prob} points.
 *
 * Strategy: the smallest x that reaches `target` probability (you don't need to
 * over-commit once you're reliable). If nothing reaches the target, fall back to
 * the x with the highest probability.
 *
 * @param {Array<{x: number, value: number}>} sweep - Sorted or unsorted points
 * @param {Object} [opts]
 * @param {number} [opts.target=0.7] - Probability target to clear
 * @returns {{x: number, value: number, reason: 'threshold'|'max'}|null}
 */
export function recommendThresholdX(sweep, opts = {}) {
    const { target = 0.7 } = opts;
    if (!Array.isArray(sweep) || sweep.length === 0) return null;
    const sorted = [...sweep].sort((a, b) => a.x - b.x);

    const hit = sorted.find(p => Number.isFinite(p.value) && p.value >= target);
    if (hit) return { x: hit.x, value: hit.value, reason: 'threshold' };

    let best = sorted[0];
    for (const p of sorted) {
        if ((p.value ?? -Infinity) > (best.value ?? -Infinity)) best = p;
    }
    return { x: best.x, value: best.value, reason: 'max' };
}
