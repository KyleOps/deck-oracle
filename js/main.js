/**
 * Main Application Entry Point
 * Initializes calculators, event listeners, and manages tab switching
 */

import * as Portent from './calculators/portent.js';
import * as Surge from './calculators/surge.js';
import * as Wave from './calculators/wave.js';
import * as Vow from './calculators/vow.js';
import * as Vortex from './calculators/vortex.js';
import * as Lands from './calculators/lands.js';
import * as Rashmi from './calculators/rashmi.js';
import * as Lumra from './calculators/lumra.js';
import * as Mulligan from './calculators/mulligan.js';
import * as Share from './utils/share.js';
import { debounce } from './utils/simulation.js';
import * as Components from './utils/components.js';
import * as DeckConfig from './utils/deckConfig.js';

// Current active tab
let currentTab = 'portent';

// Calculator metadata
const calculators = {
    portent: { icon: '⚡', name: 'Portent of Calamity' },
    surge: { icon: '🌿', name: 'Primal Surge' },
    wave: { icon: '🌊', name: 'Genesis Wave' },
    vow: { icon: '🌱', name: 'Kamahl\'s Druidic Vow' },
    vortex: { icon: '🌀', name: 'Monstrous Vortex' },
    rashmi: { icon: '🌌', name: 'Rashmi' },
    lumra: { icon: '🐻', name: 'Lumra' },
    lands: { icon: '🏔️', name: 'Land Drops' },
    mulligan: { icon: '🃏', name: 'Mulligan Strategy' }
};

/**
 * Switch between calculator tabs
 * @param {string} tab - Tab name (portent, surge, wave, vortex, lands, rashmi)
 */
function switchTab(tab) {
    // Update body theme
    document.body.className = 'theme-' + tab;

    // Update dropdown selector (Unified)
    const selectorIcon = document.querySelector('.selector-icon');
    const selectorName = document.querySelector('.selector-name');
    if (selectorIcon && selectorName && calculators[tab]) {
        selectorIcon.textContent = calculators[tab].icon;
        selectorName.textContent = calculators[tab].name;
    }

    // Update dropdown options
    document.querySelectorAll('.selector-option').forEach(option => {
        option.classList.toggle('active', option.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tab}-tab`).classList.add('active');

    currentTab = tab;

    // Close dropdown if open
    const selector = document.getElementById('calculator-selector');
    if (selector && selector.classList.contains('open')) {
        selector.classList.remove('open');
        document.getElementById('selector-button').setAttribute('aria-expanded', 'false');
    }

    // Update the respective calculator
    if (tab === 'portent') {
        Portent.updateUI();
    } else if (tab === 'surge') {
        Surge.updateUI();
    } else if (tab === 'wave') {
        Wave.updateUI();
    } else if (tab === 'vow') {
        Vow.updateUI();
    } else if (tab === 'vortex') {
        Vortex.updateUI();
    } else if (tab === 'lands') {
        Lands.updateUI();
    } else if (tab === 'rashmi') {
        Rashmi.updateUI();
    } else if (tab === 'lumra') {
        Lumra.updateUI();
    } else if (tab === 'mulligan') {
        Mulligan.updateUI();
    }
}

/**
 * Initialize tab navigation
 */
function initTabNavigation() {
    // Unified dropdown selector
    const selectorButton = document.getElementById('selector-button');
    const selector = document.getElementById('calculator-selector');
    const dropdown = document.getElementById('selector-dropdown');

    if (selectorButton && selector && dropdown) {
        // Toggle dropdown
        selectorButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = selector.classList.toggle('open');
            selectorButton.setAttribute('aria-expanded', isOpen);
        });

        // Handle option clicks
        document.querySelectorAll('.selector-option').forEach(option => {
            option.addEventListener('click', () => {
                switchTab(option.dataset.tab);
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!selector.contains(e.target)) {
                selector.classList.remove('open');
                selectorButton.setAttribute('aria-expanded', 'false');
            }
        });

        // Close dropdown on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && selector.classList.contains('open')) {
                selector.classList.remove('open');
                selectorButton.setAttribute('aria-expanded', 'false');
                selectorButton.focus();
            }
        });
    }
}


/**
 * Initialize Portent calculator inputs
 */
function initPortentInputs() {
    Portent.init();
}

/**
 * Initialize Surge calculator inputs
 */
function initSurgeInputs() {
    Surge.init();
}

/**
 * Initialize Wave calculator inputs
 */
function initWaveInputs() {
    Wave.init();
}

/**
 * Initialize Vow calculator inputs
 */
function initVowInputs() {
    Vow.init();
}

/**
 * Initialize Vortex calculator inputs
 */
function initVortexInputs() {
    Vortex.init();
}

/**
 * Initialize Lands calculator inputs
 */
function initLandsInputs() {
    Lands.init();
}

/**
 * Initialize Rashmi calculator inputs
 */
function initRashmiInputs() {
    Rashmi.init();
}

/**
 * Initialize Lumra calculator inputs
 */
function initLumraInputs() {
    Lumra.init();
}

/**
 * Initialize Mulligan calculator inputs
 */
function initMulliganInputs() {
    Mulligan.init();
}


/**
 * Initialize service worker for offline support
 */
function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            // Get the correct path for service worker based on deployment
            const swPath = window.location.pathname.includes('/deck-oracle/')
                ? '/deck-oracle/sw.js'
                : '/sw.js';

            navigator.serviceWorker.register(swPath)
                .then(registration => {
                    console.log('ServiceWorker registered:', registration);
                })
                .catch(error => {
                    console.log('ServiceWorker registration failed (optional):', error);
                });
        });
    }
}

/**
 * Initialize UX enhancements
 */
function initUXEnhancements() {
    // Initialize collapsible panels
    Components.initCollapsiblePanels();

    // Auto-collapse config on mobile after calculations
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 900) {
            Components.autoCollapseOnMobile();
        }
    });
}

/**
 * Initialize PWA Installation logic
 */
function initPWAInstall() {
    let deferredPrompt;
    const installBtn = document.getElementById('install-button');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Update UI to notify the user they can add to home screen
        if (installBtn) {
            installBtn.style.display = 'flex';
        }
    });

    if (installBtn) {
        installBtn.addEventListener('click', (e) => {
            // hide our user interface that shows our A2HS button
            installBtn.style.display = 'none';
            // Show the prompt
            if (deferredPrompt) {
                deferredPrompt.prompt();
                // Wait for the user to respond to the prompt
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('User accepted the A2HS prompt');
                    } else {
                        console.log('User dismissed the A2HS prompt');
                    }
                    deferredPrompt = null;
                });
            }
        });
    }
}

/**
 * Initialize application
 */
function init() {
    // Initialize shared deck configuration first
    DeckConfig.initDeckConfig();

    // Initialize all components
    initTabNavigation();
    initPortentInputs();
    initSurgeInputs();
    initWaveInputs();
    initVowInputs();
    initVortexInputs();
    initLandsInputs();
    initRashmiInputs();
    initLumraInputs();
    initMulliganInputs();
    initServiceWorker();
    initUXEnhancements();
    initPWAInstall();

    // Share Button Logic
    const shareBtn = document.getElementById('share-button');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const url = Share.getShareUrl();
            navigator.clipboard.writeText(url).then(() => {
                const originalText = shareBtn.innerHTML;
                shareBtn.innerHTML = '✅'; // Checkmark
                setTimeout(() => {
                    shareBtn.innerHTML = originalText;
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy URL:', err);
                alert('Failed to copy URL. Please copy it manually from the address bar.');
            });
        });
    }

    // Check for share link parameters and auto-load if present
    // Must be called AFTER all inputs are initialized so listeners are ready
    Share.parseShareUrl();

    // Initial render
    Portent.updateUI();

    // Add keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Alt+1/2/3/4/5/6 to switch tabs
        if (e.altKey) {
            if (e.key === '1') switchTab('portent');
            else if (e.key === '2') switchTab('surge');
            else if (e.key === '3') switchTab('wave');
            else if (e.key === '4') switchTab('vow');
            else if (e.key === '5') switchTab('vortex');
            else if (e.key === '6') switchTab('lands');
            else if (e.key === '7') switchTab('rashmi');
            else if (e.key === '8') switchTab('lumra');
        }
    });

    // Mark as visited
    if (!localStorage.getItem('visited')) {
        localStorage.setItem('visited', 'true');
    }

    console.log('Deck Oracle initialized');
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
