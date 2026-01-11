/**
 * Share URL Management
 * Handles deep linking for decklists and calculator settings
 */

import * as DeckConfig from './deckConfig.js';
import * as Mulligan from '../calculators/mulligan.js';

/**
 * Parse URL parameters and apply settings
 */
export async function parseShareUrl() {
    const params = new URLSearchParams(window.location.search);
    
    // 1. Deck Import (Async)
    const deckUrl = params.get('deck');
    if (deckUrl) {
        try {
            console.log('Auto-importing deck from URL:', deckUrl);
            await DeckConfig.loadDeckFromUrl(deckUrl);
        } catch (e) {
            console.error("Failed to load deck from share link", e);
        }
    }

    // 2. Tab Selection
    const tab = params.get('tab');
    if (tab) {
        // Trigger tab switch via the selector logic in main.js
        // Since we don't have direct access to switchTab from here without circular dependency,
        // we simulate a click on the selector option.
        const tabOption = document.querySelector(`.selector-option[data-tab="${tab}"]`);
        if (tabOption) {
            tabOption.click();
        }
    }

    // 3. Mulligan Specifics
    if (params.has('mullSims')) {
        const input = document.getElementById('mulligan-sample-count');
        if (input) {
            input.value = params.get('mullSims');
        }
    }

    const mullTypes = params.get('mullTypes');
    if (mullTypes) {
        try {
            const types = JSON.parse(decodeURIComponent(mullTypes));
            Mulligan.setCardTypes(types);
        } catch (e) {
            console.error("Failed to parse mulligan types", e);
        }
    }

    if (params.has('mullPenalty')) {
        const input = document.getElementById('mull-penalty');
        if (input) {
            input.value = params.get('mullPenalty');
            input.dispatchEvent(new Event('input'));
        }
    }
    
    if (params.has('mullThreshold')) {
        const input = document.getElementById('mull-threshold');
        if (input) {
            input.value = params.get('mullThreshold');
            input.dispatchEvent(new Event('input'));
        }
    }

    // 4. Calculator Sliders
    const sliderMap = {
        'portentX': 'portent-xSlider',
        'waveX': 'wave-xSlider',
        'vortexCMC': 'vortex-cmcSlider',
        'rashmiCMC': 'rashmi-cmcSlider',
        'lands': 'lands-opening-slider' // If lands has one
    };

    Object.entries(sliderMap).forEach(([param, id]) => {
        if (params.has(param)) {
            const input = document.getElementById(id);
            if (input) {
                input.value = params.get(param);
                input.dispatchEvent(new Event('input'));
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
