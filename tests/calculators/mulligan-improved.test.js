/**
 * Comprehensive Mulligan Calculator Tests
 * Tests confidence threshold, penalty mechanics, and strategy decisions
 */

import { describe, it, assert, assertClose, assertEquals, assertInRange, createMockInput, createMockCheckbox, resetMocks } from '../test-helper-improved.js';
import { calculate, calcMultiTypeSuccess, getDeckConfig, setCardTypes } from '../../js/calculators/mulligan.js';

describe('Mulligan Strategy Calculator - Comprehensive', () => {

    // Setup before each test
    function setupMulligan(config = {}) {
        resetMocks();
        createMockInput('mull-deck-size', config.deckSize || 98);
        createMockInput('mull-penalty', config.penalty || 20);
        createMockInput('mull-threshold', config.threshold || 75);
        createMockCheckbox('mull-free', config.freeMulligan || false);

        const types = config.types || [
            { id: 1, name: 'Lands', count: 40, required: 3, byTurn: 3, color: '#22c55e' },
            { id: 2, name: 'Ramp', count: 16, required: 1, byTurn: 3, color: '#3b82f6' }
        ];
        setCardTypes(types);
    }

    describe('Core Math - calcMultiTypeSuccess', () => {
        it('calculates sequential deadlines correctly (A by T1, B by T2)', () => {
            const types = [
                { id: 1, count: 1, required: 1, byTurn: 1 },
                { id: 2, count: 1, required: 1, byTurn: 2 }
            ];
            const hand = [0, 0];
            const deckSize = 17;

            // Prob = (1/10) * (1/9) = 1/90
            const result = calcMultiTypeSuccess(deckSize, types, hand);
            assertClose(result, 1/90, 'Sequential A(T1), B(T2)');
        });

        it('calculates same-turn deadlines correctly (A and B by T2)', () => {
            const types = [
                { id: 1, count: 1, required: 1, byTurn: 2 },
                { id: 2, count: 1, required: 1, byTurn: 2 }
            ];
            const hand = [0, 0];
            const deckSize = 17;

            const result = calcMultiTypeSuccess(deckSize, types, hand);
            assertClose(result, 1/45, 'Same deadline A, B (T2)');
        });

        it('returns 1.0 when all requirements are met', () => {
            const types = [
                { id: 1, count: 10, required: 2, byTurn: 3 }
            ];
            const hand = [2]; // Already have 2
            const result = calcMultiTypeSuccess(60, types, hand);
            assertEquals(result, 1.0, 'Success prob is 1.0 when requirements met');
        });

        it('returns 0 for impossible Turn 0 requirements', () => {
            const types = [
                { id: 1, count: 10, required: 2, byTurn: 0 }
            ];
            const hand = [0];
            const result = calcMultiTypeSuccess(60, types, hand);
            assertEquals(result, 0, 'Turn 0 requirements are impossible');
        });
    });

    describe('Confidence Threshold Behavior', () => {
        it('keeps hands above confidence threshold with low threshold', () => {
            setupMulligan({ threshold: 50 });
            const { result } = calculate();

            // Find a hand with ~60% success rate
            const mediumHand = result.strategy.find(h =>
                h.successProb >= 0.55 && h.successProb <= 0.65
            );

            if (mediumHand) {
                assert(mediumHand.keep, `Hand with ${(mediumHand.successProb * 100).toFixed(1)}% success should be kept with 50% threshold`);
            }
        });

        it('mulligans hands below confidence threshold with high threshold', () => {
            setupMulligan({ threshold: 90 });
            const { result } = calculate();

            // Find a hand with ~70% success rate
            const mediumHand = result.strategy.find(h =>
                h.successProb >= 0.65 && h.successProb <= 0.75
            );

            if (mediumHand) {
                assert(!mediumHand.keep, `Hand with ${(mediumHand.successProb * 100).toFixed(1)}% success should be mulliganed with 90% threshold`);
            }
        });

        it('confidence threshold is the primary decision criterion', () => {
            setupMulligan({ threshold: 68, penalty: 20 });
            const { result } = calculate();

            // Find hands with success rate above threshold
            const handsAboveThreshold = result.strategy.filter(h =>
                h.successProb >= 0.68 && h.successProb < 0.95
            );

            // All hands above threshold should be kept (not mulliganed for higher EV)
            const allKept = handsAboveThreshold.every(h => h.keep);
            assert(allKept, 'All hands above confidence threshold should be kept');
        });

        it('adjusts threshold correctly across different values', () => {
            const thresholds = [50, 68, 75, 90];
            const keepRates = [];

            thresholds.forEach(threshold => {
                setupMulligan({ threshold });
                const { result } = calculate();
                const keepRate = result.strategy
                    .filter(h => h.keep)
                    .reduce((sum, h) => sum + h.handProb, 0);
                keepRates.push(keepRate);
            });

            // Higher thresholds should result in lower keep rates
            for (let i = 1; i < keepRates.length; i++) {
                assert(keepRates[i] <= keepRates[i-1],
                    `Keep rate at threshold ${thresholds[i]} should be <= threshold ${thresholds[i-1]}`);
            }
        });
    });

    describe('Penalty Mechanics', () => {
        it('applies penalty factor correctly to success rates', () => {
            setupMulligan({ penalty: 20 });
            const { result } = calculate();

            // With 20% penalty and no free mulligan, first mulligan has k = 0.8
            // A hand with 80% base success has 80% * 0.8 = 64% adjusted success
            assert(result.expectedSuccess < result.unpenalizedSuccess,
                'Penalized success should be less than unpenalized');
        });

        it('calculates expected cards correctly with penalty', () => {
            setupMulligan({ penalty: 20, freeMulligan: false });
            const { result } = calculate();

            // Expected cards should be less than 7 with mulligans
            assertInRange(result.expectedCards, 5, 7,
                'Expected cards should be between 5 and 7');
        });

        it('free mulligan affects card count correctly', () => {
            setupMulligan({ penalty: 20, freeMulligan: false });
            const { result: noFree } = calculate();

            setupMulligan({ penalty: 20, freeMulligan: true });
            const { result: withFree } = calculate();

            // Free mulligan should result in more expected cards
            assert(withFree.expectedCards >= noFree.expectedCards,
                'Free mulligan should increase expected card count');
        });
    });

    describe('Strategy Generation', () => {
        it('generates valid strategy for standard deck', () => {
            setupMulligan();
            const { result } = calculate();

            assert(result.expectedSuccess >= 0 && result.expectedSuccess <= 1,
                'Success rate is valid probability');
            assert(result.strategy.length > 0, 'Strategy entries were generated');

            // Verify probabilities sum to ~1
            const totalProb = result.strategy.reduce((sum, h) => sum + h.handProb, 0);
            assertClose(totalProb, 1.0, 'Hand probabilities sum to 1', 0.0001);
        });

        it('handles single card type', () => {
            setupMulligan({
                types: [{ id: 1, name: 'Lands', count: 40, required: 3, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();

            assert(result.strategy.length > 0, 'Strategy generated for single type');
            assert(result.expectedSuccess > 0, 'Non-zero success rate');
        });

        it('handles three card types', () => {
            setupMulligan({
                types: [
                    { id: 1, name: 'Lands', count: 36, required: 3, byTurn: 3, color: '#22c55e' },
                    { id: 2, name: 'Ramp', count: 14, required: 1, byTurn: 3, color: '#3b82f6' },
                    { id: 3, name: 'Payoffs', count: 10, required: 1, byTurn: 5, color: '#ef4444' }
                ]
            });
            const { result } = calculate();

            assert(result.strategy.length > 0, 'Strategy generated for three types');
        });

        it('calculates marginal benefits correctly', () => {
            setupMulligan();
            const { result } = calculate();

            assert(Array.isArray(result.marginalBenefits), 'Marginal benefits calculated');
            assertEquals(result.marginalBenefits.length, 2, 'Marginal benefit for each type');

            // Benefits should be small positive or negative values
            result.marginalBenefits.forEach((benefit, i) => {
                assertInRange(benefit.overall, -0.1, 0.1,
                    `Marginal benefit for type ${i} is reasonable`);
            });
        });
    });

    describe('Edge Cases', () => {
        it('handles impossible requirements gracefully', () => {
            setupMulligan({
                types: [{ id: 1, name: 'Lands', count: 5, required: 8, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();

            // Should complete without errors, success rate should be ~0
            assertClose(result.expectedSuccess, 0, 'Success rate near 0 for impossible requirements', 0.01);
        });

        it('handles very high requirements', () => {
            setupMulligan({
                types: [{ id: 1, name: 'Lands', count: 40, required: 7, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();

            // Should complete and have very low success rate
            assert(result.expectedSuccess >= 0 && result.expectedSuccess < 0.1,
                'Very high requirements result in low success rate');
        });

        it('handles very large deck sizes', () => {
            setupMulligan({
                deckSize: 250,
                types: [{ id: 1, name: 'Lands', count: 100, required: 3, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();

            assert(result.strategy.length > 0, 'Strategy generated for large deck');
        });

        it('handles early deadlines (Turn 1)', () => {
            setupMulligan({
                types: [{ id: 1, name: 'Fast Mana', count: 10, required: 1, byTurn: 1, color: '#22c55e' }]
            });
            const { result } = calculate();

            assert(result.expectedSuccess > 0, 'Non-zero success for T1 requirements');
        });

        it('handles mixed deadlines correctly', () => {
            setupMulligan({
                types: [
                    { id: 1, name: 'Early', count: 20, required: 1, byTurn: 1, color: '#22c55e' },
                    { id: 2, name: 'Mid', count: 20, required: 1, byTurn: 3, color: '#3b82f6' },
                    { id: 3, name: 'Late', count: 10, required: 1, byTurn: 5, color: '#ef4444' }
                ]
            });
            const { result } = calculate();

            assert(result.strategy.length > 0, 'Strategy handles mixed deadlines');
        });
    });

    describe('Keep Decision Verification', () => {
        it('sets keep flag correctly for good hands', () => {
            setupMulligan({ threshold: 75 });
            const { result } = calculate();

            // Find the "god hand" (all requirements met)
            const godHand = result.strategy.find(h => h.successProb === 1.0);
            if (godHand) {
                assert(godHand.keep, 'God hands should always be kept');
            }
        });

        it('sets keep flag correctly for poor hands', () => {
            setupMulligan({ threshold: 75 });
            const { result } = calculate();

            // Find hands with very low success rate
            const badHands = result.strategy.filter(h => h.successProb < 0.3);
            const allMulliganed = badHands.every(h => !h.keep);
            assert(allMulliganed, 'Hands with <30% success should be mulliganed with 75% threshold');
        });

        it('keep decisions are consistent with threshold', () => {
            setupMulligan({ threshold: 68, penalty: 0 });
            const { result } = calculate();

            // With 0 penalty, k=1, so decision should be exactly at threshold
            const keptHands = result.strategy.filter(h => h.keep);
            const allAboveThreshold = keptHands.every(h => h.successProb >= 0.68 - 0.0001);
            assert(allAboveThreshold, 'All kept hands should be above threshold');
        });
    });

    describe('Mulligan Breakdown Statistics', () => {
        it('calculates average mulligans correctly', () => {
            setupMulligan();
            const { result } = calculate();

            assertInRange(result.avgMulligans, 0, 3,
                'Average mulligans should be between 0 and 3');
        });

        it('baseline success is lower than strategy success', () => {
            setupMulligan();
            const { result } = calculate();

            assert(result.expectedSuccess >= result.baselineSuccess,
                'Strategy success should be >= baseline (no mulligan) success');
        });

        it('unpenalized success is higher than penalized', () => {
            setupMulligan({ penalty: 20 });
            const { result } = calculate();

            assert(result.unpenalizedSuccess >= result.expectedSuccess,
                'Unpenalized success should be >= penalized success');
        });
    });
});
