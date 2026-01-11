/**
 * Test Helper for MTG Calculator
 * Standardizes mocks and assertions for Node.js test execution
 */

// Test Stats
export const stats = {
    passed: 0,
    failed: 0,
    suites: 0
};

// Mock Global Document
global.document = {
    _elements: {},
    getElementById: function(id) {
        if (!this._elements[id]) {
            this._elements[id] = {
                value: '',
                checked: false,
                innerHTML: '',
                style: {},
                addEventListener: () => {},
                querySelectorAll: () => [],
                parentNode: { innerHTML: '' },
                dispatchEvent: () => {},
                setAttribute: () => {},
                getAttribute: () => null,
                insertAdjacentHTML: () => {},
                classList: {
                    add: () => {},
                    remove: () => {},
                    toggle: () => {},
                    contains: () => false
                }
            };
        }
        return this._elements[id];
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({
        style: {},
        appendChild: () => {},
        addEventListener: () => {},
        insertAdjacentHTML: () => {},
        classList: { add: () => {} }
    })
};

// Mock Global Window
global.window = {
    location: {
        search: '',
        pathname: '/'
    },
    addEventListener: () => {},
    localStorage: {
        getItem: () => null,
        setItem: () => {}
    },
    navigator: {
        clipboard: {
            writeText: () => Promise.resolve()
        }
    }
};

// Mock Chart.js
global.Chart = class Chart {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.data = config?.data || {};
        this.options = config?.options || {};
    }

    destroy() {}
    update() {}
    resize() {}

    static register(...args) {}
};

// Mock Global Navigator safely
if (typeof global.navigator === 'undefined') {
    global.navigator = global.window.navigator;
} else {
    try {
        Object.defineProperty(global, 'navigator', {
            value: global.window.navigator,
            configurable: true,
            enumerable: true,
            writable: true
        });
    } catch (e) {
        // Fallback for environments where global.navigator is strictly read-only
        Object.assign(global.navigator, global.window.navigator);
    }
}

// Simple Assertion Helper
export function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        stats.passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        stats.failed++;
        process.exitCode = 1;
    }
}

export function assertClose(actual, expected, message, tolerance = 0.0001) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
        console.log(`  ✅ PASS: ${message} (Expected: ${expected.toFixed(4)}, Got: ${actual.toFixed(4)})`);
        stats.passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        console.error(`     Expected: ${expected.toFixed(4)}`);
        console.error(`     Got:      ${actual.toFixed(4)}`);
        stats.failed++;
        process.exitCode = 1;
    }
}

export function describe(name, fn) {
    console.log(`\n📦 ${name}`);
    stats.suites++;
    fn();
}

export function it(name, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`  ❌ ERROR: ${name}`);
        console.error(error);
        stats.failed++;
        process.exitCode = 1;
    }
}