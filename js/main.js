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
import * as Mara from './calculators/mara.js';
import * as DreamHarvest from './calculators/dreamharvest.js';
import * as Share from './utils/share.js';
import * as OpponentState from './utils/opponentState.js';
import { debounce } from './utils/simulation.js';
import * as Components from './utils/components.js';
import * as DeckConfig from './utils/deckConfig.js';

// Current active tab and group
let currentTab = 'mulligan';
let currentGroup = 'deck-tools';

// ==================== CHART.JS GLOBAL TERMINAL DEFAULTS ====================

// Set after Chart.js loads
function applyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#5a6b66';
    Chart.defaults.borderColor = '#1c2520';
    Chart.defaults.backgroundColor = '#0e1311';
    Chart.defaults.font.family = "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace";
    Chart.defaults.font.size = 10;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = '#0e1311';
    Chart.defaults.plugins.tooltip.borderColor = '#1c2520';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = '#8b9b95';
    Chart.defaults.plugins.tooltip.bodyColor = '#d4dfd9';
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.plugins.tooltip.cornerRadius = 0;
    Chart.defaults.scale = Chart.defaults.scale || {};
    if (Chart.defaults.scales) {
        const scaleDefaults = {
            grid: { color: '#1c2520', drawTicks: false },
            ticks: { color: '#5a6b66', font: { size: 9 } },
            border: { color: '#1c2520', dash: [] }
        };
        Chart.defaults.scales.linear = { ...Chart.defaults.scales.linear, ...scaleDefaults };
        Chart.defaults.scales.category = { ...Chart.defaults.scales.category, ...scaleDefaults };
    }
}

// Calculator metadata with groupings
const calculators = {
    portent: { icon: '⚡', name: 'Portent of Calamity', group: 'spells' },
    surge: { icon: '🌿', name: 'Primal Surge', group: 'spells' },
    wave: { icon: '🌊', name: 'Genesis Wave', group: 'spells' },
    vow: { icon: '🌱', name: 'Kamahl\'s Druidic Vow', group: 'spells' },
    vortex: { icon: '🌀', name: 'Monstrous Vortex', group: 'spells' },
    rashmi: { icon: '🌌', name: 'Rashmi', group: 'Creatures' },
    lumra: { icon: '🐻', name: 'Lumra', group: 'Creatures' },
    lands: { icon: '🏔️', name: 'Land Drops', group: 'deck-tools' },
    mulligan: { icon: '🃏', name: 'Mulligan Strategy', group: 'deck-tools' },
    mara: { icon: '🎭', name: 'Ensnared by the Mara', group: 'multiplayer' },
    dreamharvest: { icon: '🌙', name: 'Dream Harvest', group: 'multiplayer' }
};

/**
 * Switch between tab groups
 * @param {string} group - Group name (spells, Creatures, deck-tools, multiplayer)
 */
function switchGroup(group) {
    currentGroup = group;

    // Update group buttons
    document.querySelectorAll('.tab-group-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.group === group);
        btn.setAttribute('aria-selected', btn.dataset.group === group);
    });

    // Show corresponding sub-navigation
    document.querySelectorAll('.sub-nav-group').forEach(nav => {
        nav.classList.toggle('active', nav.dataset.group === group);
    });
}

/**
 * Initialize terminal chrome: clock, seed display, build date, tx-tab navigation, paste panel
 */
function initTerminalChrome() {
    // UTC clock
    const clockEl = document.getElementById('tx-clock');
    if (clockEl) {
        const updateClock = () => {
            const now = new Date();
            const hh = String(now.getUTCHours()).padStart(2, '0');
            const mm = String(now.getUTCMinutes()).padStart(2, '0');
            const ss = String(now.getUTCSeconds()).padStart(2, '0');
            clockEl.textContent = `${hh}:${mm}:${ss} UTC`;
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    // Seed display (random hex)
    const seedEl = document.getElementById('tx-seed-display');
    if (seedEl) {
        const seed = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase();
        seedEl.textContent = `SEED:${seed}`;
    }

    // Build date
    const buildDateEl = document.getElementById('tx-build-date');
    if (buildDateEl) {
        const d = new Date();
        buildDateEl.textContent = `BUILD ${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
    }

    // TX tab row click handlers
    document.querySelectorAll('.tx-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    // Paste panel toggle: clicking the paste hint input opens the panel
    const pasteHint = document.getElementById('tx-paste-hint');
    const pastePanel = document.getElementById('tx-paste-panel');
    const pastePanelClose = document.getElementById('tx-paste-panel-close');

    if (pasteHint && pastePanel) {
        pasteHint.addEventListener('click', () => {
            pastePanel.style.display = pastePanel.style.display === 'none' ? 'block' : 'none';
            if (pastePanel.style.display === 'block') {
                const textarea = pastePanel.querySelector('#decklist-input');
                if (textarea) textarea.focus();
            }
        });
    }

    if (pastePanelClose && pastePanel) {
        pastePanelClose.addEventListener('click', () => {
            pastePanel.style.display = 'none';
        });
    }

    // F key: focus moxfield URL input
    // P key: open paste panel
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'f' || e.key === 'F') {
            const moxInput = document.getElementById('moxfield-input');
            if (moxInput) { e.preventDefault(); moxInput.focus(); }
        } else if (e.key === 'p' || e.key === 'P') {
            if (pastePanel) {
                e.preventDefault();
                pastePanel.style.display = 'block';
                const textarea = pastePanel.querySelector('#decklist-input');
                if (textarea) textarea.focus();
            }
        }
    });

    // Deck-loaded pill: update when DeckConfig changes
    const updateDeckPill = () => {
        const pill = document.getElementById('tx-deck-pill');
        const hashEl = document.getElementById('tx-deck-hash');
        if (!pill) return;
        const deckConfig = window._deckConfig || null;
        const total = document.getElementById('deck-size')?.value || 99;
        const hasImport = document.getElementById('import-status')?.textContent?.includes('Loaded');
        if (hasImport) {
            pill.classList.add('loaded');
            pill.querySelector?.('.tx-dot')?.classList.add('tx-flicker');
        }
        if (hashEl) {
            const h = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
            hashEl.textContent = `#${h}`;
        }
    };

    // Poll for deck load state changes (lightweight, import is infrequent)
    const importStatus = document.getElementById('import-status');
    if (importStatus) {
        new MutationObserver(updateDeckPill).observe(importStatus, { childList: true, subtree: true, characterData: true });
    }
}

/**
 * Switch between calculator tabs
 * @param {string} tab - Tab name (portent, surge, wave, vortex, lands, rashmi, lumra, mulligan)
 */
function switchTab(tab) {
    // Update body theme
    document.body.className = 'theme-' + tab;

    // Update terminal tab row active state
    document.querySelectorAll('.tx-tab[data-tab]').forEach(txTab => {
        txTab.classList.toggle('active', txTab.dataset.tab === tab);
    });

    // Update the calculator group if needed
    if (calculators[tab] && calculators[tab].group !== currentGroup) {
        switchGroup(calculators[tab].group);
    }

    // Update ALL sub-navigation pills across all groups (not just current group)
    document.querySelectorAll('.sub-nav-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.tab === tab);
    });

    // Update dropdown selector button and options
    const selectorIcon = document.querySelector('.selector-icon');
    const selectorName = document.querySelector('.selector-name');
    if (selectorIcon && selectorName && calculators[tab]) {
        selectorIcon.textContent = calculators[tab].icon;
        selectorName.textContent = calculators[tab].name;
    }
    document.querySelectorAll('.selector-option').forEach(option => {
        option.classList.toggle('active', option.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tab}-tab`).classList.add('active');

    currentTab = tab;

    // Show/hide config panels based on calculator's group
    const deckConfig = document.getElementById('deck-config');
    const opponentsConfig = document.getElementById('opponents-config');
    const calcGroup = calculators[tab]?.group;

    if (calcGroup === 'multiplayer') {
        // Multiplayer: hide deck config, show opponents config
        if (deckConfig) deckConfig.style.display = 'none';
        if (opponentsConfig) opponentsConfig.style.display = 'block';
    } else {
        // Spells, Creatures, Tools: show deck config, hide opponents config
        if (deckConfig) deckConfig.style.display = 'block';
        if (opponentsConfig) opponentsConfig.style.display = 'none';
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
    } else if (tab === 'mara') {
        Mara.updateUI();
    } else if (tab === 'dreamharvest') {
        DreamHarvest.updateUI();
    }
}

/**
 * Initialize tab navigation
 */
function initTabNavigation() {
    // Tab group buttons
    document.querySelectorAll('.tab-group-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchGroup(btn.dataset.group);
        });
    });

    // Sub-navigation pills
    document.querySelectorAll('.sub-nav-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            switchTab(pill.dataset.tab);
        });
    });

    // Legacy dropdown selector (keep for backwards compatibility)
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
                // Auto-close dropdown after selection
                selector.classList.remove('open');
                selectorButton.setAttribute('aria-expanded', 'false');
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
 * Initialize Mara calculator inputs
 */
function initMaraInputs() {
    Mara.init();
}

/**
 * Initialize Dream Harvest calculator inputs
 */
function initDreamHarvestInputs() {
    DreamHarvest.init();
}

/**
 * Initialize navigation layout toggle
 */
function initNavLayoutToggle() {
    const navToggle = document.getElementById('nav-layout-toggle');
    const navIcon = navToggle?.querySelector('.nav-icon');
    const tabGroupNav = document.getElementById('tab-group-nav');
    const dropdownNav = document.querySelector('.calculator-selector');

    // Load saved layout preference
    const savedLayout = localStorage.getItem('navLayout') || 'tabs';
    if (savedLayout === 'dropdown') {
        tabGroupNav?.classList.add('hidden');
        dropdownNav?.classList.add('shown');
        if (navIcon) navIcon.textContent = '📑';
    }

    // Toggle layout on click
    if (navToggle) {
        navToggle.addEventListener('click', () => {
            const isTabs = !tabGroupNav?.classList.contains('hidden');

            if (isTabs) {
                // Switch to dropdown
                tabGroupNav?.classList.add('hidden');
                dropdownNav?.classList.add('shown');
                if (navIcon) navIcon.textContent = '📑';
                localStorage.setItem('navLayout', 'dropdown');
            } else {
                // Switch to tabs
                tabGroupNav?.classList.remove('hidden');
                dropdownNav?.classList.remove('shown');
                if (navIcon) navIcon.textContent = '☰';
                localStorage.setItem('navLayout', 'tabs');
            }
        });
    }
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
    // Apply terminal Chart.js defaults before any calculator renders
    applyChartDefaults();

    // Initialize shared deck configuration first
    DeckConfig.initDeckConfig();

    // Initialize shared opponent state for multiplayer calculators
    OpponentState.init();

    // Initialize terminal chrome (clock, seed, tx-tabs, paste panel)
    initTerminalChrome();

    // Initialize all components
    initTabNavigation();
    initNavLayoutToggle();
    initPortentInputs();
    initSurgeInputs();
    initWaveInputs();
    initVowInputs();
    initVortexInputs();
    initLandsInputs();
    initRashmiInputs();
    initLumraInputs();
    initMulliganInputs();
    initMaraInputs();
    initDreamHarvestInputs();
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
    Mulligan.updateUI();

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
