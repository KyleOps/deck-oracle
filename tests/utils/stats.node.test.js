import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { quantile, quantileSorted, quantiles, mean } from '../../js/utils/stats.js';
import { mulberry32 } from '../../js/utils/random.js';

// The six quantile functions stats.js replaced, verbatim, so the tests can show
// they agree wherever their (differing) edge rules were not in play.

/** opponentPages.quantile */
function oppQuantile(dist, q) {
    let total = 0;
    for (const w of dist) total += w || 0;
    if (!(total > 0)) return 0;
    const target = q * total - 1e-9;
    let cum = 0;
    for (let v = 0; v < dist.length; v++) {
        cum += dist[v] || 0;
        if (cum >= target) return v;
    }
    return dist.length - 1;
}

/** discover.percentileFromDist */
function discoverPercentile(dist, q) {
    const counts = Array.isArray(dist) ? dist : [];
    const total = counts.reduce((a, b) => a + (b || 0), 0);
    if (total === 0) return 0;
    const target = Math.min(1, Math.max(0, q)) * total;
    let seen = 0;
    for (let v = 0; v < counts.length; v++) {
        seen += counts[v] || 0;
        if (seen > 0 && seen >= target) return v;
    }
    return counts.length ? counts.length - 1 : 0;
}

/** bigSpells.quantileOf (pmf summing to 1) */
function quantileOf(pmf, q) {
    let cumulative = 0;
    for (let k = 0; k < pmf.length; k++) {
        cumulative += pmf[k];
        if (cumulative >= q - 1e-9) return k;
    }
    return Math.max(0, pmf.length - 1);
}

/** manaDevelopment.percentile (integer histogram) */
function mdPercentile(hist, total, p) {
    if (!(total > 0)) return null;
    const need = Math.max(1, Math.ceil(p * total));
    let cum = 0;
    for (let v = 0; v < hist.length; v++) {
        cum += hist[v];
        if (cum >= need) return v;
    }
    return hist.length - 1;
}

/** chimil.quantile / lumra.quantile (sorted samples) */
function sortedQuantile(sorted, q) {
    if (!sorted.length) return 0;
    const rank = Math.ceil(Math.min(1, Math.max(0, q)) * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const QS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1];

/** Random integer histograms shaped like the pages' (sparse, long right tail). */
function* histograms(seed, n = 300) {
    const rng = mulberry32(seed);
    for (let i = 0; i < n; i++) {
        const len = 1 + Math.floor(rng() * 25);
        const samples = 1 + Math.floor(rng() * 400);
        const hist = new Array(len).fill(0);
        for (let s = 0; s < samples; s++) {
            const v = Math.min(len - 1, Math.floor(-Math.log(1 - rng()) * len / 4));
            hist[v]++;
        }
        yield hist;
    }
}

describe('quantile — the one definition', () => {
    it('is the smallest value with at least q of the weight at or below it', () => {
        const dist = [2, 0, 3, 0, 4, 0, 0, 0, 0, 1]; // 10 outcomes
        assert.equal(quantile(dist, 0.2), 0);
        assert.equal(quantile(dist, 0.21), 2);
        assert.equal(quantile(dist, 0.5), 2);
        assert.equal(quantile(dist, 0.51), 4);
        assert.equal(quantile(dist, 0.9), 4);
        assert.equal(quantile(dist, 0.95), 9);
        assert.equal(quantile(dist, 1), 9);
    });

    it('never returns a value with no weight: q = 0 is the smallest outcome', () => {
        assert.equal(quantile([0, 0, 5, 5], 0), 2);
        assert.equal(quantile([0, 0, 5, 5, 0, 0], 1), 3);
    });

    it('clamps q and handles empty input', () => {
        assert.equal(quantile([1, 1], -3), 0);
        assert.equal(quantile([1, 1], 7), 1);
        assert.equal(quantile([], 0.5), 0);
        assert.equal(quantile(null, 0.5), 0);
        assert.equal(quantile([0, 0], 0.5), 0);
        assert.equal(quantile([1, NaN, 1], 0.9), 2);
    });

    it('is scale-free: counts, fractions and probabilities give the same answer', () => {
        for (const hist of histograms(1, 100)) {
            const total = hist.reduce((s, x) => s + x, 0);
            const probs = hist.map(x => x / total);
            const thirds = hist.map(x => x / 3);
            for (const q of QS) {
                assert.equal(quantile(probs, q), quantile(hist, q));
                assert.equal(quantile(thirds, q), quantile(hist, q));
            }
        }
    });

    it('shrugs off floating-point dust in probability vectors', () => {
        // Sums to 0.9999999999999999, not 1.
        const pmf = [0.1, 0.2, 0.3, 0.4].map(x => x * (1 - 1e-15));
        assert.equal(quantile(pmf, 1), 3);
        assert.equal(quantile([0.1, 0.2, 0.7], 0.3), 1);
    });

    it('works on typed arrays', () => {
        assert.equal(quantile(Float64Array.from([0, 1, 1]), 0.5), 1);
    });
});

describe('quantile agrees with every function it replaced', () => {
    it('opponentPages.quantile (q > 0)', () => {
        for (const hist of histograms(2)) {
            for (const q of QS) assert.equal(quantile(hist, q), oppQuantile(hist, q), `${hist} q=${q}`);
        }
    });

    it('discover.percentileFromDist, including q = 0', () => {
        for (const hist of histograms(3)) {
            for (const q of [0, ...QS]) assert.equal(quantile(hist, q), discoverPercentile(hist, q), `${hist} q=${q}`);
        }
    });

    it('bigSpells.quantileOf on exact pmfs', () => {
        for (const hist of histograms(4)) {
            const total = hist.reduce((s, x) => s + x, 0);
            const pmf = hist.map(x => x / total);
            for (const q of QS) assert.equal(quantile(pmf, q), quantileOf(pmf, q), `${pmf} q=${q}`);
        }
    });

    it('manaDevelopment.percentile, including q = 0', () => {
        for (const hist of histograms(5)) {
            const total = hist.reduce((s, x) => s + x, 0);
            for (const q of [0, ...QS]) assert.equal(quantile(hist, q), mdPercentile(hist, total, q), `${hist} q=${q}`);
        }
    });
});

describe('quantileSorted', () => {
    it('matches the nearest-rank sorted-array helpers (Chimil, Lumra) and quantile() on the histogram', () => {
        const rng = mulberry32(6);
        for (let i = 0; i < 300; i++) {
            const n = 1 + Math.floor(rng() * 200);
            const sorted = Array.from({ length: n }, () => Math.floor(rng() * 30)).sort((a, b) => a - b);
            const hist = [];
            for (const v of sorted) hist[v] = (hist[v] ?? 0) + 1;
            for (const q of [0, ...QS]) {
                assert.equal(quantileSorted(sorted, q), sortedQuantile(sorted, q), `n=${n} q=${q}`);
                assert.equal(quantileSorted(sorted, q), quantile(hist, q), `n=${n} q=${q}`);
            }
        }
    });

    it('handles empty input and clamps q', () => {
        assert.equal(quantileSorted([], 0.5), 0);
        assert.equal(quantileSorted(null, 0.5), 0);
        assert.equal(quantileSorted([1, 2, 3], -1), 1);
        assert.equal(quantileSorted([1, 2, 3], 2), 3);
    });
});

describe('quantiles / mean', () => {
    it('reads several quantiles at once', () => {
        assert.deepEqual(quantiles([1, 1, 1, 1], { p25: 0.25, p50: 0.5, p75: 0.75 }), { p25: 0, p50: 1, p75: 2 });
        assert.deepEqual(quantiles([1], null), {});
    });

    it('averages a list (0 when empty)', () => {
        assert.equal(mean([1, 2, 3, 6]), 3);
        assert.equal(mean([]), 0);
        assert.equal(mean(undefined), 0);
    });
});
