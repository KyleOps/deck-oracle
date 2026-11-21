/**
 * Wall-clock budgets in unit tests.
 *
 * One timed run is noise: a GC pause or a JIT deopt can make a 3 ms function
 * take 20 ms. `medianMs` warms the code up, times several runs and keeps the
 * median.
 *
 * Coverage instrumentation (`npm run test:coverage`, which CI runs) makes
 * tight loops several times slower: the Draw Odds worst case goes from ~3 ms
 * to ~14 ms. `budget()` scales a limit by COVERAGE_SLOWDOWN in that case, so
 * the same tests guard performance in both modes and a real regression of
 * that size still fails.
 */

/** Node sets NODE_V8_COVERAGE in every test process under --experimental-test-coverage. */
export const COVERAGE_SLOWDOWN = process.env.NODE_V8_COVERAGE ? 5 : 1;

/**
 * A time limit for the current mode.
 * @param {number} ms - the budget without coverage instrumentation
 * @returns {number}
 */
export const budget = ms => ms * COVERAGE_SLOWDOWN;

/**
 * Median duration of `fn` over several runs, after one warm-up run.
 * @param {Function} fn
 * @param {number} [runs=7]
 * @returns {number} milliseconds
 */
export function medianMs(fn, runs = 7) {
    fn();
    const times = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        fn();
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
}
