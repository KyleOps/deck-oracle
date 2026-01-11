/**
 * Shared Simulation Utilities
 * Common functions for Monte Carlo simulations
 */

/**
 * Create a hash from deck configuration for cache invalidation
 * @param {Object} config - Deck configuration object
 * @returns {string} - Hash string
 */
export function hashDeck(config) {
    return JSON.stringify(config);
}

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

/**
 * Fisher-Yates shuffle (in-place)
 * @param {Array} array - Array to shuffle
 */
export function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Partial Fisher-Yates shuffle for drawing cards
 * @param {TypedArray} deck - Deck array
 * @param {number} count - Number of cards to draw
 * @param {number} deckSize - Size of deck
 */
export function partialShuffle(deck, count, deckSize) {
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(Math.random() * (deckSize - i));
        const temp = deck[i];
        deck[i] = deck[j];
        deck[j] = temp;
    }
}

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
 * Request animation frame wrapper for non-blocking updates
 * @param {Function} callback - Callback to execute
 */
export function scheduleUpdate(callback) {
    if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(callback);
    } else {
        setTimeout(callback, 0);
    }
}

/**
 * Batch process iterations to prevent UI blocking
 * @param {number} totalIterations - Total iterations to run
 * @param {number} batchSize - Size of each batch
 * @param {Function} batchCallback - Called for each batch with (startIdx, endIdx)
 * @param {Function} completeCallback - Called when complete
 */
export async function batchProcess(totalIterations, batchSize, batchCallback, completeCallback) {
    let currentIdx = 0;

    const processBatch = () => {
        const endIdx = Math.min(currentIdx + batchSize, totalIterations);
        batchCallback(currentIdx, endIdx);
        currentIdx = endIdx;

        if (currentIdx < totalIterations) {
            scheduleUpdate(processBatch);
        } else {
            completeCallback();
        }
    };

    scheduleUpdate(processBatch);
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
