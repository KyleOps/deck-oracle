import { describe, it, assert, assertClose } from '../test-helper.js';
import { choose, drawType, drawTypeMin, drawTwoTypeMin, drawThreeTypeMin } from '../../js/utils/hypergeometric.js';

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

    describe('drawTwoTypeMin (Multivariate At Least)', () => {
        it('calculates 2+ lands AND 1+ ramp in 7 draws', () => {
            // Deck: 60 cards. 24 Lands, 8 Ramp, 28 Other.
            // This tests the nested loops in drawTwoTypeMin.
            const prob = drawTwoTypeMin(60, 24, 8, 7, 2, 1);
            // Rough expectation:
            // P(Lands>=2) is ~0.85
            // P(Ramp>=1) is ~0.65
            // Combined should be around 0.5-0.6
            assert(prob > 0.4 && prob < 0.7, `Probability ${prob.toFixed(4)} is in reasonable range`);
        });
    });

    describe('drawThreeTypeMin (Three-Type Multivariate At Least)', () => {
        it('calculates 2+ lands AND 1+ ramp AND 1+ payoff in 7 draws', () => {
            // Deck: 60 cards. 24 Lands, 10 Ramp, 8 Payoffs, 18 Other.
            // Test triple nested loops in drawThreeTypeMin.
            const prob = drawThreeTypeMin(60, 24, 10, 8, 7, 2, 1, 1);

            // Rough expectation:
            // P(Lands>=2) is ~0.85
            // P(Ramp>=1) is ~0.72
            // P(Payoffs>=1) is ~0.62
            // Combined should be around 0.35-0.50
            assert(prob > 0.25 && prob < 0.60, `Probability ${prob.toFixed(4)} is in reasonable range`);
        });

        it('handles edge case: requiring all 3 types in small sample', () => {
            // Deck: 20 cards. 10 Type A, 5 Type B, 3 Type C, 2 Other.
            // Draw 5, need at least 1 of each type.
            const prob = drawThreeTypeMin(20, 10, 5, 3, 5, 1, 1, 1);

            // This should be moderately likely (types are common)
            assert(prob > 0.15 && prob < 0.45, `Probability ${prob.toFixed(4)} is reasonable for small deck`);
        });

        it('handles case with high requirements', () => {
            // Deck: 60 cards. 30 Type A, 15 Type B, 10 Type C, 5 Other.
            // Draw 7, need 3+ A, 2+ B, 1+ C
            const prob = drawThreeTypeMin(60, 30, 15, 10, 7, 3, 2, 1);

            // With abundant types, this should be fairly likely
            assert(prob > 0.10 && prob < 0.40, `Probability ${prob.toFixed(4)} is in range`);
        });

        it('returns ~0 for impossible requirements', () => {
            // Deck: 60 cards. 1 Type A, 1 Type B, 1 Type C, 57 Other.
            // Draw 7, need 2+ A (impossible - only 1 exists)
            const prob = drawThreeTypeMin(60, 1, 1, 1, 7, 2, 1, 1);

            assertClose(prob, 0, 'Impossible requirements return ~0', 0.0001);
        });

        it('returns ~1 when all requirements are easy to meet', () => {
            // Deck: 60 cards. 40 Type A, 10 Type B, 8 Type C, 2 Other.
            // Draw 7, need 1+ A, 0+ B, 0+ C
            const prob = drawThreeTypeMin(60, 40, 10, 8, 7, 1, 0, 0);

            // Very likely to draw at least 1 from 40 cards
            assert(prob > 0.95, `Probability ${prob.toFixed(4)} is very high`);
        });

        it('handles zero draw case', () => {
            // Draw 0 cards, need 0 of each
            const prob = drawThreeTypeMin(60, 24, 10, 8, 0, 0, 0, 0);

            // Drawing 0 and needing 0 should be probability 1
            assertClose(prob, 1.0, 'Drawing 0 with 0 requirements = 1.0');
        });
    });
});
