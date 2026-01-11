/**
 * Performance Benchmark Suite for Node Test Runner
 * Tests execution time and efficiency of calculator functions
 */

import { describe, it } from 'node:test';
import { assert } from '../node-test-helper.js';
import { choose, drawTypeMin, drawTwoTypeMin, drawThreeTypeMin } from '../../js/utils/hypergeometric.js';
import { calcMultiTypeSuccess } from '../../js/calculators/mulligan.js';
import { simulatePrimalSurge } from '../../js/calculators/surge.js';
import { simulateGenesisWave } from '../../js/calculators/wave.js';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
    INSTANT: 10,
    FAST: 50,
    ACCEPTABLE: 200,
    SLOW: 1000
};

function benchmark(fn, threshold) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < threshold, `Operation completed in ${elapsed.toFixed(2)}ms (threshold: ${threshold}ms)`);
    return elapsed;
}

describe('Performance Benchmarks', () => {

    describe('Hypergeometric Functions', () => {
        it('choose() is instant for common values', () => {
            benchmark(() => {
                choose(60, 7);
                choose(100, 7);
                choose(250, 7);
            }, THRESHOLDS.INSTANT);
        });

        it('drawTypeMin() is fast for standard scenarios', () => {
            benchmark(() => {
                drawTypeMin(60, 24, 7, 2);
                drawTypeMin(60, 36, 10, 5);
                drawTypeMin(99, 35, 7, 3);
            }, THRESHOLDS.FAST);
        });

        it('drawTwoTypeMin() is acceptable for typical use', () => {
            benchmark(() => {
                drawTwoTypeMin(60, 24, 8, 7, 2, 1);
                drawTwoTypeMin(99, 36, 10, 7, 3, 1);
            }, THRESHOLDS.ACCEPTABLE);
        });

        it('drawThreeTypeMin() completes in reasonable time', () => {
            benchmark(() => {
                drawThreeTypeMin(60, 24, 10, 8, 7, 2, 1, 1);
                drawThreeTypeMin(99, 36, 14, 10, 7, 3, 1, 1);
            }, THRESHOLDS.ACCEPTABLE);
        });

        it('handles stress test with large deck', () => {
            benchmark(() => {
                drawThreeTypeMin(250, 90, 30, 20, 10, 4, 2, 1);
            }, THRESHOLDS.SLOW);
        });
    });

    describe('Mulligan Calculator', () => {
        it('calcMultiTypeSuccess() is fast for simple cases', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 }
            ];
            const hand = [2];
            benchmark(() => calcMultiTypeSuccess(99, types, hand), THRESHOLDS.FAST);
        });

        it('calcMultiTypeSuccess() handles two types efficiently', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 10, required: 1, byTurn: 3 }
            ];
            const hand = [2, 0];
            benchmark(() => calcMultiTypeSuccess(99, types, hand), THRESHOLDS.ACCEPTABLE);
        });

        it('calcMultiTypeSuccess() handles three types acceptably', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 14, required: 1, byTurn: 3 },
                { id: 3, count: 10, required: 1, byTurn: 5 }
            ];
            const hand = [2, 0, 0];
            benchmark(() => calcMultiTypeSuccess(99, types, hand), THRESHOLDS.ACCEPTABLE);
        });
    });

    describe('Surge Calculator', () => {
        it('simulatePrimalSurge() is instant for typical decks', () => {
            benchmark(() => {
                simulatePrimalSurge(60, 10, 50);
                simulatePrimalSurge(99, 15, 84);
            }, THRESHOLDS.INSTANT);
        });

        it('handles edge cases efficiently', () => {
            benchmark(() => {
                simulatePrimalSurge(60, 0, 60);
                simulatePrimalSurge(60, 60, 0);
                simulatePrimalSurge(250, 30, 220);
            }, THRESHOLDS.INSTANT);
        });
    });

    describe('Wave Calculator', () => {
        it('simulateGenesisWave() is instant for typical X values', () => {
            const distribution = {
                0: 30,
                3: 20,
                5: 10,
                nonperm: 10
            };
            benchmark(() => {
                simulateGenesisWave(60, distribution, 5);
                simulateGenesisWave(60, distribution, 10);
                simulateGenesisWave(60, distribution, 15);
            }, THRESHOLDS.INSTANT);
        });
    });

    describe('Regression Baselines', () => {
        it('choose(60, 7) completes in under 1ms', () => {
            benchmark(() => choose(60, 7), 1);
        });

        it('drawTypeMin(60, 24, 7, 2) completes in under 5ms', () => {
            benchmark(() => drawTypeMin(60, 24, 7, 2), 5);
        });

        it('mulligan calculation completes in under 100ms', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 14, required: 1, byTurn: 3 }
            ];
            benchmark(() => calcMultiTypeSuccess(99, types, [2, 0]), 100);
        });
    });
});
