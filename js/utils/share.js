/**
 * Share URL Management
 * Handles deep linking for decklists and calculator settings
 */

import * as DeckConfig from './deckConfig.js';
import * as Mulligan from '../calculators/mulligan.js';

// Valid tab names whitelist
const VALID_TABS = ['portent', 'surge', 'wave', 'vow', 'vortex', 'rashmi', 'lands', 'mulligan'];

// Allowed deck import domains
const ALLOWED_DECK_HOSTS = ['moxfield.com', 'www.moxfield.com', 'archidekt.com', 'www.archidekt.com'];

/**
 * Parse URL parameters and apply settings
 */
export async function parseShareUrl() {
    const params = new URLSearchParams(window.location.search);

    // 1. Deck Import (Async) - with URL validation
    const deckUrl = params.get('deck');
    if (deckUrl) {
        try {
            // Validate URL format and domain
            const url = new URL(deckUrl);
            if (!ALLOWED_DECK_HOSTS.includes(url.hostname)) {
                console.warn('Deck URL from untrusted domain:', url.hostname);
            } else {
                console.log('Auto-importing deck from URL:', deckUrl);
                await DeckConfig.loadDeckFromUrl(deckUrl);
            }
        } catch (e) {
            console.error("Failed to load deck from share link", e);
        }
    }

    // 2. Tab Selection - with whitelist validation
    const tab = params.get('tab');
    if (tab && VALID_TABS.includes(tab)) {
        // Trigger tab switch via the selector logic in main.js
        // Since we don't have direct access to switchTab from here without circular dependency,
        // we simulate a click on the selector option.
        const tabOption = document.querySelector(`.selector-option[data-tab="${CSS.escape(tab)}"]`);
        if (tabOption) {
            tabOption.click();
        }
    }

    // 3. Mulligan Specifics - with input validation
    if (params.has('mullSims')) {
        const value = parseInt(params.get('mullSims'), 10);
        if (!isNaN(value) && value >= 1 && value <= 10000) {
            const input = document.getElementById('mulligan-sample-count');
            if (input) {
                input.value = value;
            }
        } else {
            console.warn('Invalid mullSims value, must be between 1 and 10000');
        }
    }

    const mullTypes = params.get('mullTypes');
    if (mullTypes) {
        try {
            const types = JSON.parse(decodeURIComponent(mullTypes));

            // Validate structure before using
            if (Array.isArray(types) && types.every(t =>
                t &&
                typeof t.id === 'string' &&
                typeof t.name === 'string' &&
                typeof t.count === 'number' &&
                typeof t.required === 'number' &&
                typeof t.byTurn === 'number' &&
                t.count >= 0 && t.count <= 100 &&
                t.required >= 0 && t.required <= 100 &&
                t.byTurn >= 0 && t.byTurn <= 20
            )) {
                Mulligan.setCardTypes(types);
            } else {
                console.warn('Invalid mulligan types structure');
            }
        } catch (e) {
            console.error("Failed to parse mulligan types", e);
        }
    }

    if (params.has('mullPenalty')) {
        const value = parseFloat(params.get('mullPenalty'));
        if (!isNaN(value) && value >= 0 && value <= 1) {
            const input = document.getElementById('mull-penalty');
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event('input'));
            }
        } else {
            console.warn('Invalid mullPenalty value, must be between 0 and 1');
        }
    }

    if (params.has('mullThreshold')) {
        const value = parseFloat(params.get('mullThreshold'));
        if (!isNaN(value) && value >= 0 && value <= 1) {
            const input = document.getElementById('mull-threshold');
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event('input'));
            }
        } else {
            console.warn('Invalid mullThreshold value, must be between 0 and 1');
        }
    }

    // 4. Calculator Sliders - with bounds validation
    const sliderMap = {
        'portentX': { id: 'portent-xSlider', min: 0, max: 20 },
        'waveX': { id: 'wave-xSlider', min: 0, max: 30 },
        'vowX': { id: 'vow-xSlider', min: 0, max: 30 },
        'vortexCMC': { id: 'vortex-cmcSlider', min: 5, max: 15 },
        'rashmiCMC': { id: 'rashmi-cmcSlider', min: 0, max: 15 },
        'lands': { id: 'lands-opening-slider', min: 0, max: 60 }
    };

    Object.entries(sliderMap).forEach(([param, config]) => {
        if (params.has(param)) {
            const value = parseInt(params.get(param), 10);
            if (!isNaN(value) && value >= config.min && value <= config.max) {
                const input = document.getElementById(config.id);
                if (input) {
                    input.value = value;
                    input.dispatchEvent(new Event('input'));
                }
            } else {
                console.warn(`Invalid ${param} value, must be between ${config.min} and ${config.max}`);
            }
        }
    });
}

/**
 * Generate a shareable URL based on current state
 */
export function getShareUrl() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();

    // Current Tab
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) {
        const tabId = activeTab.id.replace('-tab', '');
        params.set('tab', tabId);
    }

    // Deck URL
    const deckConfig = DeckConfig.getDeckConfig();
    if (deckConfig.importUrl) {
        params.set('deck', deckConfig.importUrl);
    }

    // Mulligan Specifics
    if (activeTab && activeTab.id === 'mulligan-tab') {
        const mullState = Mulligan.getState();
        if (mullState && mullState.types) {
            // Only serialize if custom types exist (default lands/ramp might be noise, but safer to just send all)
            const serializedTypes = JSON.stringify(mullState.types.map(t => ({
                id: t.id,
                name: t.name,
                count: t.count,
                required: t.required,
                byTurn: t.byTurn,
                color: t.color
            })));
            params.set('mullTypes', serializedTypes);
        }
        
        const penalty = document.getElementById('mull-penalty');
        if (penalty) params.set('mullPenalty', penalty.value);
        
        const threshold = document.getElementById('mull-threshold');
        if (threshold) params.set('mullThreshold', threshold.value);

        const sampleCount = document.getElementById('mulligan-sample-count');
        if (sampleCount) params.set('mullSims', sampleCount.value);
    }

    // Slider Settings (Generic)
    const sliders = [
        { id: 'portent-xSlider', param: 'portentX' },
        { id: 'wave-xSlider', param: 'waveX' },
        { id: 'vow-xSlider', param: 'vowX' },
        { id: 'vortex-cmcSlider', param: 'vortexCMC' },
        { id: 'rashmi-cmcSlider', param: 'rashmiCMC' }
    ];

    sliders.forEach(({ id, param }) => {
        const input = document.getElementById(id);
        if (input && input.offsetParent !== null) { // Only if visible? Or just save all? 
            // Better to save all relevant ones or just the active one?
            // Saving all allows switching tabs and keeping state.
            params.set(param, input.value);
        }
    });

    url.search = params.toString();
    return url.toString();
}
