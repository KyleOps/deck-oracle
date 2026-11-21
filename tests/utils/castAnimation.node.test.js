import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CAST_BUDGET_MS, castTiming } from '../../js/utils/castAnimation.js';

describe('castTiming', () => {
    it('keeps every cast inside the time budget (well under three seconds)', () => {
        assert.ok(CAST_BUDGET_MS <= 2500);
        for (const n of [1, 2, 7, 10, 15, 30, 79, 200]) {
            const t = castTiming(n);
            assert.ok(t.total <= CAST_BUDGET_MS, `${n} cards: ${t.total} ms`);
            assert.ok(t.animated >= 1 && t.animated <= n);
        }
    });

    it('slows short casts down so each card can be read', () => {
        assert.strictEqual(castTiming(3).step, 420);
        assert.strictEqual(castTiming(3).animated, 3);
    });

    it('lands the tail of a very long run at once instead of racing through it', () => {
        const t = castTiming(79);
        assert.strictEqual(t.step, 80);
        assert.ok(t.animated < 79);
    });

    it('has nothing to play for an empty cast', () => {
        assert.deepStrictEqual(castTiming(0), { step: 0, animated: 0, total: 0 });
    });
});
