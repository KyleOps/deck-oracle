import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    probabilityVerdict,
    efficiencyVerdict,
    formatDelta,
    deltaColor,
    recommendThresholdX,
    recommendKneeX
} from '../../js/utils/analysis.js';

describe('probabilityVerdict', () => {
    it('maps high probabilities to CERTAIN/STRONG', () => {
        assert.strictEqual(probabilityVerdict(0.95).label, 'CERTAIN');
        assert.strictEqual(probabilityVerdict(0.75).label, 'STRONG');
    });

    it('maps mid probabilities to FAIR', () => {
        assert.strictEqual(probabilityVerdict(0.5).label, 'FAIR');
    });

    it('maps low probabilities to WEAK/POOR', () => {
        assert.strictEqual(probabilityVerdict(0.3).label, 'WEAK');
        assert.strictEqual(probabilityVerdict(0.05).label, 'POOR');
    });

    it('handles boundary values inclusively', () => {
        assert.strictEqual(probabilityVerdict(0.90).label, 'CERTAIN');
        assert.strictEqual(probabilityVerdict(0.70).label, 'STRONG');
        assert.strictEqual(probabilityVerdict(0.45).label, 'FAIR');
        assert.strictEqual(probabilityVerdict(0.20).label, 'WEAK');
    });

    it('defends against NaN', () => {
        assert.strictEqual(probabilityVerdict(NaN).label, 'POOR');
        assert.strictEqual(probabilityVerdict(undefined).label, 'POOR');
    });

    it('always returns a CSS color and advice', () => {
        const v = probabilityVerdict(0.8);
        assert.ok(v.color.startsWith('var(--'));
        assert.ok(v.advice.length > 0);
    });
});

describe('efficiencyVerdict', () => {
    it('grades conversion ratios', () => {
        assert.strictEqual(efficiencyVerdict(0.8).label, 'ELITE');
        assert.strictEqual(efficiencyVerdict(0.6).label, 'GOOD');
        assert.strictEqual(efficiencyVerdict(0.45).label, 'OKAY');
        assert.strictEqual(efficiencyVerdict(0.2).label, 'THIN');
    });
});

describe('formatDelta', () => {
    it('adds a + for positive, nothing for negative sign char', () => {
        assert.strictEqual(formatDelta(1.234, 2), '+1.23');
        assert.strictEqual(formatDelta(-1.234, 2), '-1.23');
    });

    it('marks flat values with ±', () => {
        assert.strictEqual(formatDelta(0, 2), '±0.00');
    });

    it('appends a suffix', () => {
        assert.strictEqual(formatDelta(5, 1, '%'), '+5.0%');
    });
});

describe('deltaColor', () => {
    it('greens up, reds down, dims flat', () => {
        assert.strictEqual(deltaColor(1), 'var(--tx-green)');
        assert.strictEqual(deltaColor(-1), 'var(--tx-red)');
        assert.strictEqual(deltaColor(0), 'var(--tx-dim)');
    });

    it('respects epsilon dead-band', () => {
        assert.strictEqual(deltaColor(0.005, 0.01), 'var(--tx-dim)');
    });
});

describe('recommendThresholdX', () => {
    const sweep = [
        { x: 3, value: 0.30 },
        { x: 4, value: 0.55 },
        { x: 5, value: 0.72 },
        { x: 6, value: 0.85 }
    ];

    it('picks the smallest x clearing the target', () => {
        const r = recommendThresholdX(sweep, { target: 0.7 });
        assert.strictEqual(r.x, 5);
        assert.strictEqual(r.reason, 'threshold');
    });

    it('falls back to the max when nothing clears the target', () => {
        const r = recommendThresholdX(sweep, { target: 0.99 });
        assert.strictEqual(r.x, 6);
        assert.strictEqual(r.reason, 'max');
    });

    it('returns null for empty input', () => {
        assert.strictEqual(recommendThresholdX([], { target: 0.5 }), null);
        assert.strictEqual(recommendThresholdX(null), null);
    });

    it('does not require pre-sorted input', () => {
        const shuffled = [sweep[2], sweep[0], sweep[3], sweep[1]];
        assert.strictEqual(recommendThresholdX(shuffled, { target: 0.7 }).x, 5);
    });
});

describe('recommendKneeX', () => {
    const sweep = [
        { x: 1, value: 1.0 },
        { x: 2, value: 1.9 },
        { x: 3, value: 2.7 },
        { x: 4, value: 3.0 },
        { x: 5, value: 3.05 }
    ];

    it('finds the smallest x reaching a fraction of max', () => {
        const r = recommendKneeX(sweep, { fraction: 0.9 });
        // max is 3.05; 90% = 2.745; first x reaching that is x=4 (3.0)
        assert.strictEqual(r.x, 4);
    });

    it('returns null when there is no positive value', () => {
        assert.strictEqual(recommendKneeX([{ x: 1, value: 0 }]), null);
        assert.strictEqual(recommendKneeX([]), null);
    });
});
