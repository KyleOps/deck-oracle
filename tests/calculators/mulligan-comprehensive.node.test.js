/**
 * Comprehensive Mulligan Calculator Tests for Node Test Runner
 * Tests confidence threshold, penalty mechanics, and strategy decisions
 */

import { describe, it, beforeEach } from 'node:test';
import { assert, assertClose, assertInRange, createMockInput, createMockCheckbox, resetMocks } from '../node-test-helper.js';
import { calculate, calcMultiTypeSuccess, getDeckConfig, setCardTypes } from '../../js/calculators/mulligan.js';

describe('Mulligan Strategy Calculator - Comprehensive', () => {

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
            const result = calcMultiTypeSuccess(deckSize, types, hand);
            assertClose(result, 1/90, 'Sequential A(T1), B(T2)');
        });

        it('returns 1.0 when all requirements are met', () => {
            const types = [
                { id: 1, count: 10, required: 2, byTurn: 3 }
            ];
            const hand = [2];
            const result = calcMultiTypeSuccess(60, types, hand);
            assert.strictEqual(result, 1.0);
        });

        it('returns 0 for impossible Turn 0 requirements', () => {
            const types = [
                { id: 1, count: 10, required: 2, byTurn: 0 }
            ];
            const hand = [0];
            const result = calcMultiTypeSuccess(60, types, hand);
            assert.strictEqual(result, 0);
        });
    });

    describe('Confidence Threshold Behavior', () => {
        it('confidence threshold affects keep decisions', () => {
            setupMulligan({ threshold: 50 });
            const { result: low } = calculate();

            setupMulligan({ threshold: 90 });
            const { result: high } = calculate();

            const lowKeepCount = low.strategy.filter(h => h.keep).length;
            const highKeepCount = high.strategy.filter(h => h.keep).length;

            assert.ok(lowKeepCount >= highKeepCount, 'Lower threshold should keep more hands');
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

            // Higher thresholds should result in lower or equal keep rates
            for (let i = 1; i < keepRates.length; i++) {
                assert.ok(keepRates[i] <= keepRates[i-1],
                    `Keep rate at threshold ${thresholds[i]} should be <= threshold ${thresholds[i-1]}`);
            }
        });
    });

    describe('Strategy Generation', () => {
        it('generates valid strategy for standard deck', () => {
            setupMulligan();
            const { result } = calculate();

            assert.ok(result.expectedSuccess >= 0 && result.expectedSuccess <= 1,
                'Success rate should be valid probability');
            assert.ok(result.strategy.length > 0, 'Strategy entries should be generated');

            const totalProb = result.strategy.reduce((sum, h) => sum + h.handProb, 0);
            assertClose(totalProb, 1.0, 'Hand probabilities should sum to 1', 0.0001);
        });

        it('handles single card type', () => {
            setupMulligan({
                types: [{ id: 1, name: 'Lands', count: 40, required: 3, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();

            assert.ok(result.strategy.length > 0, 'Strategy should be generated for single type');
            assert.ok(result.expectedSuccess > 0, 'Should have non-zero success rate');
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

            assert.ok(result.strategy.length > 0, 'Strategy should be generated for three types');
        });
    });

    describe('Edge Cases', () => {
        it('handles impossible requirements gracefully', () => {
            setupMulligan({
                types: [{ id: 1, name: 'Lands', count: 5, required: 8, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();
            assertClose(result.expectedSuccess, 0, 'Success rate should be near 0 for impossible requirements', 0.01);
        });

        it('handles very large deck sizes', () => {
            setupMulligan({
                deckSize: 250,
                types: [{ id: 1, name: 'Lands', count: 100, required: 3, byTurn: 3, color: '#22c55e' }]
            });
            const { result } = calculate();
            assert.ok(result.strategy.length > 0, 'Strategy should be generated for large deck');
        });
    });

    describe('Mulligan Breakdown Statistics', () => {
        it('calculates average mulligans correctly', () => {
            setupMulligan();
            const { result } = calculate();
            assertInRange(result.avgMulligans, 0, 3, 'Average mulligans should be between 0 and 3');
        });

        it('baseline success is lower than or equal to strategy success', () => {
            setupMulligan();
            const { result } = calculate();
            assert.ok(result.expectedSuccess >= result.baselineSuccess,
                'Strategy success should be >= baseline (no mulligan) success');
        });

        it('unpenalized success is higher than or equal to penalized', () => {
            setupMulligan({ penalty: 20 });
            const { result } = calculate();
            assert.ok(result.unpenalizedSuccess >= result.expectedSuccess,
                'Unpenalized success should be >= penalized success');
        });
    });
});
