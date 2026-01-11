/**
 * Base Calculator Utility
 * Provides shared infrastructure for all calculators to reduce boilerplate.
 */

import { debounce } from './simulation.js';
import { bindInputSync } from './ui.js';
import * as DeckConfig from './deckConfig.js';

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
        // Only update if this tab is active or just initialized?
        // Actually, updating background tabs is fine if debounced, keeps them fresh.
        updateUI();
    }, 150);

    // Bind Inputs
    inputs.forEach(input => {
        if (typeof input === 'string') {
            // Check for standard slider/value pair pattern
            const sliderId = `${name}-${input}Slider`;
            const valueId = `${name}-${input}Value`;
            
            if (document.getElementById(sliderId) && document.getElementById(valueId)) {
                bindInputSync(sliderId, valueId, (val) => debouncedUpdate());
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

    // Initial Render
    // We defer this slightly to ensure DOM is fully ready if called early
    setTimeout(updateUI, 0);

    return {
        updateUI: debouncedUpdate
    };
}
