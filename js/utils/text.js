/**
 * Number and word formatting every page shares, so the same chance reads the
 * same everywhere ("99.7%" is ">99%" on every page, never "100%" on one).
 *
 * Pure strings: no DOM, no HTML escaping (none of these outputs contain
 * markup characters).
 */

/**
 * A chance as a percentage, with honest ends: a chance that is not certain
 * never prints as 100%, and one that is not impossible never prints as 0%.
 *
 *   pct(0) → "0%"        pct(0.003) → "<1%"     pct(0.42) → "42%"
 *   pct(0.997) → ">99%"  pct(1) → "100%"        pct(NaN) → "—"
 *   pct(0.9996, 1) → ">99.9%"
 *
 * @param {number} p - 0..1 (values outside are clamped)
 * @param {number} [digits=0] - decimal places
 * @returns {string}
 */
export function pct(p, digits = 0) {
    if (typeof p !== 'number' || !Number.isFinite(p)) return '—';
    const d = Math.max(0, Math.min(3, Math.floor(Number(digits) || 0)));
    const scale = 10 ** d;
    if (p <= 0) return '0%';
    if (p >= 1) return '100%';
    const step = 1 / scale;                       // smallest printable step, in percent
    if (p < 0.005 / scale) return `<${step}%`;
    if (p >= 1 - 0.005 / scale) return `>${(100 - step).toFixed(d)}%`;
    return `${(Math.round(p * 100 * scale) / scale).toFixed(d)}%`;
}

/**
 * A change in a probability, in percentage points: "+9 points", "no change".
 * @param {number} delta - difference of two probabilities (−1..1)
 */
export function points(delta) {
    if (!Number.isFinite(delta)) return '—';
    const rounded = Math.round(delta * 100);
    if (rounded === 0) return 'no change';
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} point${Math.abs(rounded) === 1 ? '' : 's'}`;
}

/** Compact change in a probability for tables: "+9 pts", "0". */
export function pointsShort(delta) {
    if (!Number.isFinite(delta)) return '—';
    const rounded = Math.round(delta * 100);
    if (rounded === 0) return '0';
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} pts`;
}

/**
 * An average to `digits` decimals ("—" when not a number; never "-0.0").
 * @param {number} value
 * @param {number} [digits=1]
 */
export function avg(value, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const text = value.toFixed(digits);
    return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/** One decimal place: `avg(value, 1)`. */
export function one(value) {
    return avg(value, 1);
}

/**
 * A count with its noun: "1 card", "3 cards", "2 copies".
 * @param {number} n
 * @param {string} singular
 * @param {string} [many] - defaults to singular + "s"
 */
export function plural(n, singular, many = `${singular}s`) {
    return `${n} ${inflect(n, singular, many)}`;
}

/**
 * Just the noun, agreeing with n: inflect(1, 'card') → "card", inflect(3, 'card') → "cards".
 * @param {number} n
 * @param {string} singular
 * @param {string} [many] - defaults to singular + "s"
 */
export function inflect(n, singular, many = `${singular}s`) {
    return n === 1 ? singular : many;
}
