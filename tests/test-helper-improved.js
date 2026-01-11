/**
 * Enhanced Test Helper for MTG Calculator
 * Adds utility functions and better mocking
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
                closest: () => null,
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
        id: '',
        style: {},
        appendChild: () => {},
        addEventListener: () => {},
        insertAdjacentHTML: () => {},
        classList: { add: () => {}, remove: () => {} }
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
        Object.assign(global.navigator, global.window.navigator);
    }
}

// Assertion Helpers
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
        console.error(`     Diff:     ${diff.toFixed(6)} (tolerance: ${tolerance})`);
        stats.failed++;
        process.exitCode = 1;
    }
}

export function assertEquals(actual, expected, message) {
    if (actual === expected) {
        console.log(`  ✅ PASS: ${message}`);
        stats.passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        console.error(`     Expected: ${expected}`);
        console.error(`     Got:      ${actual}`);
        stats.failed++;
        process.exitCode = 1;
    }
}

export function assertInRange(value, min, max, message) {
    if (value >= min && value <= max) {
        console.log(`  ✅ PASS: ${message} (${value} in [${min}, ${max}])`);
        stats.passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        console.error(`     Expected: value in [${min}, ${max}]`);
        console.error(`     Got:      ${value}`);
        stats.failed++;
        process.exitCode = 1;
    }
}

export function assertThrows(fn, message) {
    try {
        fn();
        console.error(`  ❌ FAIL: ${message} (no error thrown)`);
        stats.failed++;
        process.exitCode = 1;
    } catch (error) {
        console.log(`  ✅ PASS: ${message}`);
        stats.passed++;
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

// Test Utilities
export function createMockInput(id, value) {
    const input = global.document.getElementById(id);
    input.value = value;
    return input;
}

export function createMockCheckbox(id, checked) {
    const checkbox = global.document.getElementById(id);
    checkbox.checked = checked;
    return checkbox;
}

export function resetMocks() {
    global.document._elements = {};
}

// Deck Configuration Helpers
export function createStandardDeck() {
    return {
        lands: 36,
        creatures: 20,
        instants: 15,
        sorceries: 10,
        artifacts: 8,
        enchantments: 5,
        planeswalkers: 4,
        battles: 2,
        cardsByName: {
            'Land': { name: 'Land', cmc: 0, count: 36, type_line: 'Land', mana_cost: '' },
            'Creature': { name: 'Creature', cmc: 3, count: 20, type_line: 'Creature', mana_cost: '{3}' },
            'Instant': { name: 'Instant', cmc: 2, count: 15, type_line: 'Instant', mana_cost: '{2}' },
            'Sorcery': { name: 'Sorcery', cmc: 3, count: 10, type_line: 'Sorcery', mana_cost: '{3}' },
            'Artifact': { name: 'Artifact', cmc: 2, count: 8, type_line: 'Artifact', mana_cost: '{2}' },
            'Enchantment': { name: 'Enchantment', cmc: 3, count: 5, type_line: 'Enchantment', mana_cost: '{3}' },
            'Planeswalker': { name: 'Planeswalker', cmc: 4, count: 4, type_line: 'Planeswalker', mana_cost: '{4}' },
            'Battle': { name: 'Battle', cmc: 3, count: 2, type_line: 'Battle', mana_cost: '{3}' }
        }
    };
}

export function createMinimalDeck(lands = 24, nonlands = 36) {
    return {
        lands,
        cardsByName: {
            'Land': { name: 'Land', cmc: 0, count: lands, type_line: 'Land', mana_cost: '' },
            'Spell': { name: 'Spell', cmc: 1, count: nonlands, type_line: 'Instant', mana_cost: '{1}' }
        }
    };
}
