/**
 * Shared Simulation Utilities
 * Common functions for Monte Carlo simulations
 */

/**
 * Debounce function to limit calculation frequency
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Fisher–Yates (shuffle, shuffled, partialShuffle) lives in random.js.

/**
 * Create a simple LRU cache
 * @param {number} maxSize - Maximum cache size
 * @returns {Object} - Cache object with get/set/clear methods
 */
export function createCache(maxSize = 100) {
    const cache = new Map();

    return {
        get(key) {
            if (!cache.has(key)) return undefined;

            // Move to end (most recently used)
            const value = cache.get(key);
            cache.delete(key);
            cache.set(key, value);
            return value;
        },

        set(key, value) {
            // Delete if exists (to update order)
            if (cache.has(key)) {
                cache.delete(key);
            }

            // Delete oldest if at capacity
            if (cache.size >= maxSize) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
            }

            cache.set(key, value);
        },

        clear() {
            cache.clear();
        },

        has(key) {
            return cache.has(key);
        }
    };
}

/**
 * Format number with proper precision
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted number
 */
export function formatNumber(value, decimals = 2) {
    return value.toFixed(decimals);
}

/**
 * Format percentage
 * @param {number} value - Value between 0 and 1
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted percentage with % sign
 */
export function formatPercentage(value, decimals = 1) {
    return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Clamp value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} - Clamped value
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Chart.js animation configuration for smooth transitions
 * @returns {Object} - Animation configuration object
 */
export function getChartAnimationConfig() {
    return {
        animation: {
            duration: 750,
            easing: 'easeInOutQuart'
        },
        animations: {
            tension: {
                duration: 500,
                easing: 'easeInOutCubic',
                from: 0.4,
                to: 0.3,
                loop: false
            }
        },
        transitions: {
            active: {
                animation: {
                    duration: 300
                }
            },
            resize: {
                animation: {
                    duration: 0
                }
            }
        }
    };
}
