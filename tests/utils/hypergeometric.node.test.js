import { describe, it } from 'node:test';
import nodeAssert from 'node:assert/strict';

const assert = (condition, message) => nodeAssert.ok(condition, message);
const assertClose = (actual, expected, message, tolerance = 0.0001) =>
    nodeAssert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
import { choose, drawType, drawTypeMin } from '../../js/utils/hypergeometric.js';

describe('Hypergeometric Utils', () => {
    describe('choose (Combinations)', () => {
        it('calculates 5 choose 2 correctly', () => {
            assert(choose(5, 2) === 10, '5C2 = 10');
        });

        it('calculates 10 choose 3 correctly', () => {
            assert(choose(10, 3) === 120, '10C3 = 120');
        });

        it('handles k=0 correctly', () => {
            assert(choose(10, 0) === 1, '10C0 = 1');
        });

        it('handles k=n correctly', () => {
            assert(choose(10, 10) === 1, '10C10 = 1');
        });

        it('returns 0 for k > n', () => {
            assert(choose(5, 6) === 0, '5C6 = 0');
        });
    });

    describe('drawType (Exactly X)', () => {
        it('calculates probability of drawing 1 land in 1 card from 60 deck with 20 lands', () => {
            // P = 20/60 = 1/3
            assertClose(drawType(60, 20, 1, 1), 1/3, '1 land in 1 draw');
        });

        it('calculates probability of drawing exactly 2 lands in opening hand (24 lands, 60 cards)', () => {
            // Calculated: (24C2 * 36C5) / 60C7
            // 24C2 = 276
            // 36C5 = 376992
            // 60C7 = 386206920
            // Prob = 104049792 / 386206920 ~= 0.2694
            assertClose(drawType(60, 24, 7, 2), 0.2694, 'Exactly 2 lands in 7 draws', 0.0001);
        });
    });

    describe('drawTypeMin (At least X)', () => {
        it('calculates at least 1 land in 7 cards (24 lands, 60 cards)', () => {
            // 1 - P(0 lands)
            // P(0 lands) = 36C7 / 60C7 = 8347680 / 386206920 ~= 0.0216
            // P(>=1) = 1 - 0.0216 = 0.9784
            assertClose(drawTypeMin(60, 24, 7, 1), 0.9784, 'At least 1 land in 7 draws', 0.0001);
        });
    });

});
