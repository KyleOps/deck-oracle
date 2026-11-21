/**
 * Numeric assertions with no side effects — model tests import these instead
 * of node-test-helper.js, so they run without the DOM mocks (a model that
 * touched the DOM would fail them).
 */
import assert from 'node:assert';

export function assertClose(actual, expected, message, tolerance = 0.0001) {
    const diff = Math.abs(actual - expected);
    assert.ok(
        diff <= tolerance,
        `${message} - Expected: ${expected.toFixed(4)}, Got: ${actual.toFixed(4)}, Diff: ${diff.toFixed(6)} (tolerance: ${tolerance})`
    );
}

export function assertInRange(value, min, max, message) {
    assert.ok(
        value >= min && value <= max,
        `${message} - Expected value in [${min}, ${max}], got ${value}`
    );
}
