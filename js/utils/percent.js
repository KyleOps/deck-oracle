/**
 * Whole-number percentage for a probability, as the calculators show it.
 * Never rounds a near-certainty up to "100%" or a long shot down to "0%".
 * @param {number} p - 0..1
 * @returns {string}
 */
export function formatChance(p) {
    if (!Number.isFinite(p)) return '—';
    if (p > 0 && p < 0.005) return '<1%';
    if (p < 1 && p >= 0.995) return '>99%';
    return `${Math.round(p * 100)}%`;
}
