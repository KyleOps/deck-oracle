/**
 * Shared Analysis Utilities
 *
 * Pure functions that turn raw probabilities / expected values into the kind of
 * plain-English guidance a player actually wants: verdicts, marginal value, and
 * recommended parameter values. Kept dependency-free so they're easy to unit test
 * and reuse across every calculator.
 */

/**
 * Map a probability in [0, 1] to a verdict tier with label, color, and advice.
 * Used to give every probability a consistent qualitative read across the site.
 *
 * @param {number} p - Probability (0..1)
 * @returns {{tier: string, label: string, color: string, advice: string}}
 */
export function probabilityVerdict(p) {
    const prob = Number.isFinite(p) ? p : 0;
    if (prob >= 0.90) return { tier: 'certain', label: 'CERTAIN', color: 'var(--tx-green)', advice: 'Nearly guaranteed — build around it.' };
    if (prob >= 0.70) return { tier: 'strong',  label: 'STRONG',  color: 'var(--tx-green)', advice: 'Reliable; happens most games.' };
    if (prob >= 0.45) return { tier: 'fair',    label: 'FAIR',    color: 'var(--tx-amber)', advice: 'Roughly a coin flip — usable but inconsistent.' };
    if (prob >= 0.20) return { tier: 'weak',    label: 'WEAK',    color: 'var(--tx-red)',   advice: 'Misses more often than it hits.' };
    return { tier: 'poor', label: 'POOR', color: 'var(--tx-red)', advice: 'Unreliable; needs more enablers.' };
}

/**
 * Map an efficiency ratio in [0, 1] (e.g. hits / cards-revealed) to a verdict.
 *
 * @param {number} ratio - Efficiency (0..1)
 * @returns {{tier: string, label: string, color: string, advice: string}}
 */
export function efficiencyVerdict(ratio) {
    const r = Number.isFinite(ratio) ? ratio : 0;
    if (r >= 0.70) return { tier: 'elite',  label: 'ELITE',  color: 'var(--tx-green)', advice: 'Excellent conversion rate.' };
    if (r >= 0.55) return { tier: 'good',   label: 'GOOD',   color: 'var(--tx-green)', advice: 'Solid density.' };
    if (r >= 0.40) return { tier: 'okay',   label: 'OKAY',   color: 'var(--tx-amber)', advice: 'Add more valid hits to improve.' };
    return { tier: 'thin', label: 'THIN', color: 'var(--tx-red)', advice: 'Too many dead cards in the pile.' };
}

/**
 * Format a signed delta with a leading + / - and fixed precision.
 *
 * @param {number} delta - The change
 * @param {number} [digits=2] - Decimal places
 * @param {string} [suffix=''] - Trailing unit (e.g. '%')
 * @returns {string}
 */
export function formatDelta(delta, digits = 2, suffix = '') {
    const d = Number.isFinite(delta) ? delta : 0;
    const sign = d > 0 ? '+' : (d < 0 ? '' : '±');
    return `${sign}${d.toFixed(digits)}${suffix}`;
}

/**
 * Pick a color var for a delta (green up, red down, dim flat).
 *
 * @param {number} delta
 * @param {number} [epsilon=0]
 * @returns {string} CSS color
 */
export function deltaColor(delta, epsilon = 0) {
    if (delta > epsilon) return 'var(--tx-green)';
    if (delta < -epsilon) return 'var(--tx-red)';
    return 'var(--tx-dim)';
}

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

/**
 * Recommend the "knee" of a diminishing-returns curve: the smallest x whose value
 * reaches `fraction` of the maximum value in the sweep. Useful when more is always
 * better (expected permanents/hits) but you want the efficient commitment point.
 *
 * @param {Array<{x: number, value: number}>} sweep
 * @param {Object} [opts]
 * @param {number} [opts.fraction=0.9] - Fraction of max to reach
 * @returns {{x: number, value: number}|null}
 */
export function recommendKneeX(sweep, opts = {}) {
    const { fraction = 0.9 } = opts;
    if (!Array.isArray(sweep) || sweep.length === 0) return null;
    const sorted = [...sweep].sort((a, b) => a.x - b.x);

    let max = -Infinity;
    for (const p of sorted) if (Number.isFinite(p.value) && p.value > max) max = p.value;
    if (!(max > 0)) return null;

    for (const p of sorted) {
        if (Number.isFinite(p.value) && p.value >= fraction * max) return { x: p.x, value: p.value };
    }
    const last = sorted[sorted.length - 1];
    return { x: last.x, value: last.value };
}
