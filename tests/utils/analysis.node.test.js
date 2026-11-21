import { describe, it } from 'node:test';
import assert from 'node:assert';

import { recommendThresholdX } from '../../js/utils/analysis.js';

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
