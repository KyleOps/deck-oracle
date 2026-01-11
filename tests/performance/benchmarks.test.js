/**
 * Performance Benchmark Suite
 * Tests execution time and efficiency of calculator functions
 */

import { describe, it, assert } from '../test-helper.js';
import { choose, drawTypeMin, drawTwoTypeMin, drawThreeTypeMin } from '../../js/utils/hypergeometric.js';
import { calcMultiTypeSuccess } from '../../js/calculators/mulligan.js';
import { simulatePrimalSurge } from '../../js/calculators/surge.js';
import { simulateGenesisWave } from '../../js/calculators/wave.js';

// Performance thresholds (in milliseconds)
const THRESHOLDS = {
    INSTANT: 10,      // Should feel instant (<10ms)
    FAST: 50,         // Fast enough for UI updates (<50ms)
    ACCEPTABLE: 200,  // Acceptable for complex calculations (<200ms)
    SLOW: 1000        // Maximum acceptable (<1s)
};

// Benchmark helper
function benchmark(fn, label, threshold = THRESHOLDS.ACCEPTABLE) {
    const start = performance.now();
    const result = fn();
    const elapsed = performance.now() - start;

    const status = elapsed < threshold ? '✅' : '⚠️';
    console.log(`  ${status} ${label}: ${elapsed.toFixed(2)}ms (threshold: ${threshold}ms)`);

    assert(elapsed < threshold, `${label} completed in ${elapsed.toFixed(2)}ms (under ${threshold}ms threshold)`);

    return { elapsed, result };
}

// Benchmark with multiple iterations
function benchmarkIterations(fn, iterations, label, threshold = THRESHOLDS.ACCEPTABLE) {
    const times = [];

    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        fn();
        const elapsed = performance.now() - start;
        times.push(elapsed);
    }

    const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    const status = avg < threshold ? '✅' : '⚠️';
    console.log(`  ${status} ${label} (${iterations}x): avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`);

    assert(avg < threshold, `${label} average ${avg.toFixed(2)}ms under ${threshold}ms threshold`);

    return { avg, min, max, times };
}

describe('Performance Benchmarks', () => {

    describe('Hypergeometric Functions', () => {
        it('choose() is instant for common values', () => {
            benchmark(
                () => {
                    choose(60, 7);
                    choose(100, 7);
                    choose(250, 7);
                },
                'choose() with common deck sizes',
                THRESHOLDS.INSTANT
            );
        });

        it('choose() handles large values efficiently', () => {
            benchmark(
                () => {
                    choose(500, 10);
                    choose(1000, 15);
                },
                'choose() with large values',
                THRESHOLDS.FAST
            );
        });

        it('drawTypeMin() is fast for standard scenarios', () => {
            benchmark(
                () => {
                    // Standard MTG scenarios
                    drawTypeMin(60, 24, 7, 2);  // 2+ lands in opening hand
                    drawTypeMin(60, 36, 10, 5); // 5+ nonlands in 10 draws
                    drawTypeMin(99, 35, 7, 3);  // Commander deck
                },
                'drawTypeMin() standard scenarios',
                THRESHOLDS.FAST
            );
        });

        it('drawTwoTypeMin() is acceptable for typical use', () => {
            benchmark(
                () => {
                    // Standard two-type scenarios
                    drawTwoTypeMin(60, 24, 8, 7, 2, 1);   // Lands + Ramp
                    drawTwoTypeMin(99, 36, 10, 7, 3, 1);  // Commander
                },
                'drawTwoTypeMin() typical scenarios',
                THRESHOLDS.ACCEPTABLE
            );
        });

        it('drawThreeTypeMin() completes in reasonable time', () => {
            benchmark(
                () => {
                    // Three-type scenario (most complex)
                    drawThreeTypeMin(60, 24, 10, 8, 7, 2, 1, 1);
                    drawThreeTypeMin(99, 36, 14, 10, 7, 3, 1, 1);
                },
                'drawThreeTypeMin() complex scenarios',
                THRESHOLDS.ACCEPTABLE
            );
        });

        it('handles stress test with large deck', () => {
            benchmark(
                () => {
                    // Large EDH deck with 3 types
                    drawThreeTypeMin(250, 90, 30, 20, 10, 4, 2, 1);
                },
                'Hypergeometric stress test (250 card deck)',
                THRESHOLDS.SLOW
            );
        });
    });

    describe('Mulligan Calculator', () => {
        it('calcMultiTypeSuccess() is fast for simple cases', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 }
            ];
            const hand = [2];

            benchmark(
                () => calcMultiTypeSuccess(99, types, hand),
                'calcMultiTypeSuccess() single type',
                THRESHOLDS.FAST
            );
        });

        it('calcMultiTypeSuccess() handles two types efficiently', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 10, required: 1, byTurn: 3 }
            ];
            const hand = [2, 0];

            benchmark(
                () => calcMultiTypeSuccess(99, types, hand),
                'calcMultiTypeSuccess() two types',
                THRESHOLDS.ACCEPTABLE
            );
        });

        it('calcMultiTypeSuccess() handles three types acceptably', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 14, required: 1, byTurn: 3 },
                { id: 3, count: 10, required: 1, byTurn: 5 }
            ];
            const hand = [2, 0, 0];

            benchmark(
                () => calcMultiTypeSuccess(99, types, hand),
                'calcMultiTypeSuccess() three types',
                THRESHOLDS.ACCEPTABLE
            );
        });

        it('handles sequential deadlines efficiently', () => {
            const types = [
                { id: 1, count: 10, required: 1, byTurn: 1 },
                { id: 2, count: 10, required: 1, byTurn: 2 },
                { id: 3, count: 10, required: 1, byTurn: 3 }
            ];
            const hand = [0, 0, 0];

            benchmark(
                () => calcMultiTypeSuccess(60, types, hand),
                'Sequential deadlines (T1, T2, T3)',
                THRESHOLDS.ACCEPTABLE
            );
        });

        it('performs well with mixed deadlines', () => {
            const types = [
                { id: 1, count: 20, required: 2, byTurn: 1 },
                { id: 2, count: 15, required: 1, byTurn: 3 },
                { id: 3, count: 10, required: 1, byTurn: 5 },
                { id: 4, count: 5, required: 1, byTurn: 7 }
            ];
            const hand = [0, 0, 0, 0];

            benchmark(
                () => calcMultiTypeSuccess(99, types, hand),
                'Mixed deadlines (4 types)',
                THRESHOLDS.SLOW
            );
        });
    });

    describe('Surge Calculator', () => {
        it('simulatePrimalSurge() is instant for typical decks', () => {
            benchmark(
                () => {
                    simulatePrimalSurge(60, 10, 50);  // 10 nonperms, 50 perms
                    simulatePrimalSurge(99, 15, 84);  // Commander
                },
                'simulatePrimalSurge() typical scenarios',
                THRESHOLDS.INSTANT
            );
        });

        it('handles edge cases efficiently', () => {
            benchmark(
                () => {
                    simulatePrimalSurge(60, 0, 60);   // All perms
                    simulatePrimalSurge(60, 60, 0);   // All nonperms
                    simulatePrimalSurge(250, 30, 220); // Large deck
                },
                'simulatePrimalSurge() edge cases',
                THRESHOLDS.INSTANT
            );
        });
    });

    describe('Wave Calculator', () => {
        it('simulateGenesisWave() is instant for typical X values', () => {
            const distribution = {
                0: 30,  // Lands
                3: 20,  // 3-drops
                5: 10,  // 5-drops
                nonperm: 10
            };

            benchmark(
                () => {
                    simulateGenesisWave(60, distribution, 5);
                    simulateGenesisWave(60, distribution, 10);
                    simulateGenesisWave(60, distribution, 15);
                },
                'simulateGenesisWave() various X values',
                THRESHOLDS.INSTANT
            );
        });

        it('handles complex CMC distributions efficiently', () => {
            const complexDist = {
                0: 30,
                1: 10,
                2: 15,
                3: 12,
                4: 8,
                5: 5,
                6: 3,
                nonperm: 12
            };

            benchmark(
                () => {
                    simulateGenesisWave(95, complexDist, 8);
                    simulateGenesisWave(95, complexDist, 12);
                },
                'simulateGenesisWave() complex distribution',
                THRESHOLDS.INSTANT
            );
        });
    });

    describe('Repeated Operations (Caching/Optimization Check)', () => {
        it('repeated choose() calls benefit from memoization', () => {
            const results = benchmarkIterations(
                () => {
                    choose(60, 7);
                    choose(60, 7);  // Should be cached
                    choose(60, 7);  // Should be cached
                },
                100,
                'choose() with repeated values',
                THRESHOLDS.INSTANT
            );

            // Later iterations should not be significantly slower
            const firstHalf = results.times.slice(0, 50).reduce((sum, t) => sum + t, 0) / 50;
            const secondHalf = results.times.slice(50).reduce((sum, t) => sum + t, 0) / 50;

            assert(
                secondHalf <= firstHalf * 1.5,
                'Performance should not degrade significantly over iterations'
            );
        });

        it('consecutive drawTypeMin() calls are consistent', () => {
            benchmarkIterations(
                () => drawTypeMin(60, 24, 7, 2),
                50,
                'drawTypeMin() consistency',
                THRESHOLDS.FAST
            );
        });

        it('calcMultiTypeSuccess() maintains performance', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 14, required: 1, byTurn: 3 }
            ];
            const hand = [2, 0];

            benchmarkIterations(
                () => calcMultiTypeSuccess(99, types, hand),
                20,
                'calcMultiTypeSuccess() repeated calls',
                THRESHOLDS.ACCEPTABLE
            );
        });
    });

    describe('Comparative Performance', () => {
        it('two-type is faster than three-type calculations', () => {
            const twoTypeTime = benchmark(
                () => drawTwoTypeMin(60, 24, 10, 7, 2, 1),
                'Two-type calculation',
                THRESHOLDS.ACCEPTABLE
            ).elapsed;

            const threeTypeTime = benchmark(
                () => drawThreeTypeMin(60, 24, 10, 8, 7, 2, 1, 1),
                'Three-type calculation',
                THRESHOLDS.ACCEPTABLE
            ).elapsed;

            console.log(`  ℹ️  Three-type is ${(threeTypeTime / twoTypeTime).toFixed(2)}x slower than two-type`);

            assert(
                threeTypeTime > twoTypeTime,
                'Three-type should be slower than two-type (more complex)'
            );
        });

        it('simple hand success faster than complex hand', () => {
            const simpleTypes = [
                { id: 1, count: 36, required: 3, byTurn: 3 }
            ];
            const complexTypes = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 14, required: 1, byTurn: 3 },
                { id: 3, count: 10, required: 1, byTurn: 5 }
            ];

            const simpleTime = benchmark(
                () => calcMultiTypeSuccess(99, simpleTypes, [2]),
                'Simple hand (1 type)',
                THRESHOLDS.FAST
            ).elapsed;

            const complexTime = benchmark(
                () => calcMultiTypeSuccess(99, complexTypes, [2, 0, 0]),
                'Complex hand (3 types)',
                THRESHOLDS.ACCEPTABLE
            ).elapsed;

            console.log(`  ℹ️  Complex hand is ${(complexTime / simpleTime).toFixed(2)}x slower than simple hand`);
        });
    });

    describe('Regression Tests (Prevent Performance Degradation)', () => {
        it('choose(60, 7) completes in under 1ms', () => {
            const time = benchmark(
                () => choose(60, 7),
                'choose(60, 7) baseline',
                1  // Must be under 1ms
            ).elapsed;

            console.log(`  📊 Baseline: choose(60, 7) = ${time.toFixed(3)}ms`);
        });

        it('drawTypeMin(60, 24, 7, 2) completes in under 5ms', () => {
            const time = benchmark(
                () => drawTypeMin(60, 24, 7, 2),
                'drawTypeMin baseline',
                5  // Must be under 5ms
            ).elapsed;

            console.log(`  📊 Baseline: drawTypeMin(60, 24, 7, 2) = ${time.toFixed(3)}ms`);
        });

        it('mulligan calculation completes in under 100ms', () => {
            const types = [
                { id: 1, count: 36, required: 3, byTurn: 3 },
                { id: 2, count: 14, required: 1, byTurn: 3 }
            ];

            const time = benchmark(
                () => calcMultiTypeSuccess(99, types, [2, 0]),
                'Mulligan calculation baseline',
                100  // Must be under 100ms
            ).elapsed;

            console.log(`  📊 Baseline: mulligan (2 types) = ${time.toFixed(3)}ms`);
        });
    });
});
