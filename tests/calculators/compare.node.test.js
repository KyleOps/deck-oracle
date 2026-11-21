import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../node-test-helper.js';
import { metricScale } from '../../js/calculators/compare.js';

describe('Compare Decks dumbbell scales', () => {
    it('draws chances on 40–100%, widening only when a value is lower', () => {
        assert.deepStrictEqual(metricScale({ key: 'keepable', fmt: 'pct', a: 0.6, b: 0.75 }), [0.4, 1]);
        assert.deepStrictEqual(metricScale({ key: 'drop5', fmt: 'pct', a: 0.12, b: 0.49 }), [0.1, 1]);
    });

    it('centres the land gap on typical', () => {
        const [lo, hi] = metricScale({ key: 'landGap', fmt: 'signed', a: 0, b: -8 });
        assert.strictEqual(lo, -hi);
        assert.ok(hi >= 9);
    });

    it('starts counts at zero with room for both values', () => {
        const [lo, hi] = metricScale({ key: 'ramp', fmt: 'int', a: 24, b: 18 });
        assert.strictEqual(lo, 0);
        assert.ok(hi >= 24);
        assert.deepStrictEqual(metricScale({ key: 'wipe', fmt: 'int', a: 0, b: 1 }), [0, 6]);
    });

    it('keeps both values of every scale inside it', () => {
        const cases = [
            { key: 'avgMV', fmt: 'dec2', a: 2.18, b: 5.61 },
            { key: 'cards', fmt: 'int', a: 60, b: 99 },
            { key: 'lands', fmt: 'int', a: 16, b: 37 }
        ];
        for (const m of cases) {
            const [lo, hi] = metricScale(m);
            assert.ok(m.a >= lo && m.a <= hi && m.b >= lo && m.b <= hi, m.key);
        }
    });

    it('falls back to a unit scale without values', () => {
        assert.deepStrictEqual(metricScale({ key: 'colors', fmt: 'pct', a: null, b: null }), [0, 1]);
    });
});
