/**
 * Base Calculator Utility
 * Provides shared infrastructure for all calculators to reduce boilerplate.
 */

import { debounce } from './simulation.js';
import { bindInputSync } from './ui.js';
import * as DeckConfig from './deckConfig.js';

// ── Revisit stamps ───────────────────────────────────────────────────────────
// The router calls a page's updateUI() when it is shown. On a revisit that is
// wasted work (20–120 ms on a phone, plus a chart update) unless something the
// page shows has changed since it last rendered:
//   - shared state every page may read — the deck, the theme, opponents: the
//     router calls invalidateRenders() on each of their change events;
//   - the page's own inputs: they change only while it is visible, and the
//     page re-renders itself;
//   - anything that wanted to render the page while it was hidden (a deck
//     update, a finished simulation, a chart that could not be built yet):
//     isCalculatorActive() and chartHelpers record the miss with owesRender().
// A page with no stamp (never rendered by the router) always renders.

let sharedVersion = 0;
const renderedAt = new Map();
const owed = new Set();

/** Shared state changed (deck, theme, opponents): every page re-renders on its next visit. */
export function invalidateRenders() {
    sharedVersion += 1;
}

/**
 * The router is rendering `name` now; it stays current until shared state
 * changes or it owes a render. Call before updateUI(), so a miss recorded
 * during the render itself still counts.
 * @param {string} name
 */
export function markRendered(name) {
    renderedAt.set(name, sharedVersion);
    owed.delete(name);
}

/**
 * `name` missed a render: its next visit renders it again.
 * @param {string|null} name
 */
export function owesRender(name) {
    if (typeof name === 'string' && name.length > 0) owed.add(name);
}

/**
 * Does showing `name` need its updateUI()? True unless the router rendered it
 * and nothing it shows has changed since.
 * @param {string} name
 * @returns {boolean}
 */
export function needsRender(name) {
    return owed.has(name) || renderedAt.get(name) !== sharedVersion;
}

/**
 * Check whether a calculator owns the visible tab panel.
 * Hidden calculators defer rendering until the router shows their page; being
 * asked while hidden means something wanted to render, so the page owes one.
 *
 * @param {string} name - Calculator key used by `{name}-tab`
 * @returns {boolean}
 */
export function isCalculatorActive(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    const active = document.getElementById(`${name}-tab`)?.classList?.contains('active') ?? false;
    if (!active) owesRender(name);
    return active;
}

/**
 * Run a calculator render only when its tab is currently visible.
 *
 * @param {string} name - Calculator key
 * @param {Function} updateUI - Calculator render function
 * @returns {boolean} Whether a render ran
 */
export function updateCalculatorIfActive(name, updateUI) {
    if (!isCalculatorActive(name) || typeof updateUI !== 'function') return false;
    updateUI();
    return true;
}

/**
 * Register a calculator module.
 * Handles initialization, input binding, and deck updates automatically.
 * 
 * @param {Object} options - Calculator configuration
 * @param {string} options.name - Calculator name (e.g. 'portent')
 * @param {Function} options.calculate - Main calculation function
 * @param {Function} options.updateUI - UI update function
 * @param {Function} options.init - Optional custom initialization
 * @param {Array<string>} options.inputs - Array of input IDs to bind (without calculator prefix if standard pattern)
 *                                         Standard pattern: 'slider' binds `{name}-slider` and `{name}-value`
 */
export function registerCalculator(options) {
    const { name, updateUI, init, inputs = [] } = options;

    const debouncedUpdate = debounce(() => {
        updateCalculatorIfActive(name, updateUI);
    }, 150);

    // Bind Inputs
    inputs.forEach(input => {
        if (typeof input === 'string') {
            // Check for standard slider/value pair pattern
            const sliderId = `${name}-${input}Slider`;
            const valueId = `${name}-${input}Value`;
            
            if (document.getElementById(sliderId) && document.getElementById(valueId)) {
                bindInputSync(sliderId, valueId, () => debouncedUpdate());
            } else {
                // Fallback: simple change listener on single ID
                const el = document.getElementById(input.startsWith(name) ? input : `${name}-${input}`);
                if (el) {
                    el.addEventListener('change', debouncedUpdate);
                    el.addEventListener('input', debouncedUpdate);
                }
            }
        }
    });

    // Listen for deck changes
    DeckConfig.onDeckUpdate(() => {
        debouncedUpdate();
    });

    // Custom Init
    if (init) {
        init(debouncedUpdate);
    }

    return {
        updateUI: debouncedUpdate
    };
}
