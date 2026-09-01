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
import * as Abstract from './calculators/abstract.js';
import * as MindsDilation from './calculators/mindsdilation.js';
import * as Chimil from './calculators/chimil.js';
import * as Share from './utils/share.js';
import * as OpponentState from './utils/opponentState.js';
import { debounce } from './utils/simulation.js';
import * as Components from './utils/components.js';
import * as DeckConfig from './utils/deckConfig.js';
import { renderRadar } from './utils/radarPanel.js';
import { TX_CHART as TX } from './utils/chartHelpers.js';

// Current active tab and group
let currentTab = 'mulligan';
let currentGroup = 'deck-tools';

// ==================== CHART.JS GLOBAL TERMINAL DEFAULTS ====================

// Set after Chart.js loads
function applyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = TX.dim;
    Chart.defaults.borderColor = TX.rule;
    Chart.defaults.backgroundColor = TX.bg;
    Chart.defaults.font.family = "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace";
    Chart.defaults.font.size = 10;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = TX.bg;
    Chart.defaults.plugins.tooltip.borderColor = TX.ruleHi;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = TX.mid;
    Chart.defaults.plugins.tooltip.bodyColor = TX.text;
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.plugins.tooltip.cornerRadius = 0;
    Chart.defaults.scale = Chart.defaults.scale || {};
    if (Chart.defaults.scales) {
        // Merge one level deeper than a plain spread. Replacing the whole `ticks`
        // object drops Chart.js's own tick callback — on a category axis that is
        // what maps an index back to its label, so string labels silently
        // rendered as 0, 1, 2 … instead of the labels supplied.
        const applyScaleDefaults = (scale = {}) => ({
            ...scale,
            grid: { ...scale.grid, color: TX.rule, drawTicks: false },
            ticks: { ...scale.ticks, color: TX.dim, font: { size: 9 } },
            border: { ...scale.border, color: TX.rule, dash: [] }
        });
        Chart.defaults.scales.linear = applyScaleDefaults(Chart.defaults.scales.linear);
        Chart.defaults.scales.category = applyScaleDefaults(Chart.defaults.scales.category);
    }
}

// Calculator metadata: display name + which group its tab belongs to
const calculators = {
    portent: { name: 'Portent of Calamity', group: 'spells' },
    surge: { name: 'Primal Surge', group: 'spells' },
    wave: { name: 'Genesis Wave', group: 'spells' },
    vow: { name: 'Kamahl\'s Druidic Vow', group: 'spells' },
    vortex: { name: 'Monstrous Vortex', group: 'spells' },
    rashmi: { name: 'Rashmi', group: 'Creatures' },
    lumra: { name: 'Lumra', group: 'Creatures' },
    lands: { name: 'Land Drops', group: 'deck-tools' },
    mulligan: { name: 'Mulligan Strategy', group: 'deck-tools' },
    mara: { name: 'Ensnared by the Mara', group: 'multiplayer' },
    dreamharvest: { name: 'Dream Harvest', group: 'multiplayer' },
    mindsdilation: { name: "Mind's Dilation", group: 'multiplayer' },
    abstract: { name: 'Abstract Performance', group: 'spells' },
    chimil: { name: 'Chimil, the Inner Sun', group: 'spells' }
};

/**
 * Switch between tab groups
 * @param {string} group - Group name (spells, Creatures, deck-tools, multiplayer)
 */
function switchGroup(group) {
    currentGroup = group;

    // Update new terminal group buttons
    document.querySelectorAll('.tx-group[data-group]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.group === group);
    });

    // Show/hide tx-tabs by group
    document.querySelectorAll('.tx-tab[data-group]').forEach(tab => {
        tab.classList.toggle('group-hidden', tab.dataset.group !== group);
    });

}

/**
 * Initialize terminal chrome: clock, seed display, build date, tx-tab navigation, paste panel
 */
function initTerminalChrome() {
    // TX tab row: ARIA roles + click handlers
    const tabRow = document.getElementById('tx-tab-row');
    if (tabRow) tabRow.setAttribute('role', 'tablist');
    document.querySelectorAll('.tx-tab[data-tab]').forEach(tab => {
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    // Group button click handlers — switch to first tab in group
    document.querySelectorAll('.tx-group[data-group]').forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.dataset.group;
            const firstTab = document.querySelector(`.tx-tab[data-group="${group}"]`);
            if (firstTab) switchTab(firstTab.dataset.tab);
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

    // Deck pill: update whenever DeckConfig changes (fires after every import)
    DeckConfig.onDeckUpdate((config) => {
        const pill = document.getElementById('tx-deck-pill');
        const sourceEl = document.getElementById('tx-deck-hash');
        if (!pill) return;

        const n = DeckConfig.getDeckSize(true);
        const name = config.deckName;
        const source = config.importSource;
        const url = config.importUrl;

        // Dot: a steady state marker, not an animated one
        const dot = pill.querySelector('.tx-dot');
        if (dot) dot.style.background = 'var(--tx-green)';

        // Pill label: truncated deck name or fallback
        const label = pill.childNodes[pill.childNodes.length - 1];
        const displayName = name
            ? (name.length > 22 ? name.slice(0, 21) + '…' : name)
            : 'DECK LOADED';
        if (label && label.nodeType === Node.TEXT_NODE) {
            label.textContent = ` ${displayName} · N=${n}`;
        } else {
            pill.insertAdjacentText('beforeend', ` ${displayName} · N=${n}`);
        }

        // Source tag + optional link
        if (sourceEl) {
            if (source === 'moxfield' || source === 'archidekt') {
                const label = source === 'moxfield' ? 'MOXFIELD' : 'ARCHIDEKT';
                if (url) {
                    sourceEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener" style="color:var(--tx-amber); text-decoration:none; letter-spacing:0.08em;">VIA ${label} ↗</a>`;
                } else {
                    sourceEl.textContent = `VIA ${label}`;
                    sourceEl.style.color = 'var(--tx-amber)';
                }
            } else {
                sourceEl.textContent = 'PASTED';
                sourceEl.style.color = 'var(--tx-mid)';
            }
        }
    });
}

/**
 * Initialize the Deck Radar: after every import, analyse the decklist, show the
 * composition breakdown plus the ranked list of calculators that actually apply,
 * and mark the matching tabs in the nav.
 */
function initDeckRadar() {
    DeckConfig.onDeckImport((config) => {
        renderRadar(config, { onSelect: switchTab });

        // Deliberately does NOT change tabs. Auto-navigating to the strongest
        // match reads as the app moving on its own for no visible reason —
        // especially when the match came from stale state. The radar lists the
        // matches and marks the tabs; choosing one stays the user's decision.

        const radar = document.getElementById('tx-radar');
        radar?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
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
        const isActive = txTab.dataset.tab === tab;
        txTab.classList.toggle('active', isActive);
        txTab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update the calculator group if needed
    if (calculators[tab] && calculators[tab].group !== currentGroup) {
        switchGroup(calculators[tab].group);
    }

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
    } else if (tab === 'mindsdilation') {
        MindsDilation.updateUI();
    } else if (tab === 'abstract') {
        Abstract.updateUI();
    } else if (tab === 'chimil') {
        Chimil.updateUI();
    }
}

/**
 * Initialize tab navigation
 */
function initTabNavigation() {
    // The terminal tab row and group rail are wired in initTerminalChrome().
    // The old hidden sub-nav pills and dropdown selector were removed along with
    // their markup — nothing else to bind here.
}

/**
 * Initialize keyboard navigation across calculator tabs.
 * - Left/Right arrows (and Home/End) move between tabs in the active group
 * - Alt+1..9 jumps to the Nth tab in the active group
 * Ignored while typing in inputs, and arrows only act from the tab strip or body
 * so they don't hijack scrolling or slider adjustment.
 */
function initKeyboardNav() {
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const visibleTabs = Array.from(document.querySelectorAll('.tx-tab:not(.group-hidden)'));
        if (visibleTabs.length === 0) return;
        const currentIndex = Math.max(0, visibleTabs.findIndex(t => t.dataset.tab === currentTab));

        // Alt+number → Nth tab in the active group
        if (e.altKey && /^[1-9]$/.test(e.key)) {
            const idx = parseInt(e.key, 10) - 1;
            if (idx < visibleTabs.length) {
                e.preventDefault();
                switchTab(visibleTabs[idx].dataset.tab);
            }
            return;
        }

        // Arrow / Home / End → move within the active group, but only when the tab
        // strip (or nothing) is focused, to avoid hijacking page scroll.
        const active = document.activeElement;
        const fromTabStrip = active && active.classList && active.classList.contains('tx-tab');
        const fromBody = !active || active === document.body;
        if (!fromTabStrip && !fromBody) return;

        let target = null;
        if (e.key === 'ArrowRight') target = (currentIndex + 1) % visibleTabs.length;
        else if (e.key === 'ArrowLeft') target = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
        else if (e.key === 'Home') target = 0;
        else if (e.key === 'End') target = visibleTabs.length - 1;

        if (target !== null) {
            e.preventDefault();
            const tab = visibleTabs[target];
            switchTab(tab.dataset.tab);
            tab.focus();
        }
    });
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
 * Initialize Mind's Dilation calculator inputs
 */
function initMindsDilationInputs() {
    MindsDilation.init();
}

/**
 * Initialize Abstract Performance calculator inputs
 */
function initAbstractInputs() {
    Abstract.init();
}

/**
 * Initialize Chimil calculator inputs
 */
function initChimilInputs() {
    Chimil.init();
}

/**
 * Initialize service worker for offline support
 */
function initServiceWorker() {
    // Skip on localhost. The worker is stale-while-revalidate, so during local
    // development it silently serves the previous build's CSS/JS and every edit
    // appears to do nothing until the caches are manually purged.
    const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(window.location.hostname);
    if (isLocal) {
        navigator.serviceWorker?.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
        return;
    }

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

    // Deliberately no resize handler here. This used to call
    // autoCollapseOnMobile() on every resize event, which collapses panels and
    // scrollIntoView()s the results — so dragging a window smaller repeatedly
    // yanked the user's scroll position. The layout adapts through CSS
    // container queries instead, which need no JavaScript at all.
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

    // Example opponents button — loads 3 preset decks simultaneously
    const exampleOpponentsBtn = document.getElementById('load-example-opponents-btn');
    if (exampleOpponentsBtn) {
        exampleOpponentsBtn.addEventListener('click', async () => {
            const urls = MindsDilation.EXAMPLE_OPPONENTS;
            const keys = ['opponent1', 'opponent2', 'opponent3'];
            exampleOpponentsBtn.textContent = 'LOADING…';
            exampleOpponentsBtn.disabled = true;
            try {
                // Ensure 3 opponent slots are active
                while (OpponentState.getActiveOpponents().length < 3) {
                    OpponentState.addOpponent();
                }
                await Promise.all(urls.map((url, i) =>
                    OpponentState.importOpponentDeck(keys[i], url, true)
                ));
                OpponentState.renderOpponentTabs();
                // Collapse the import panel once decks are loaded
                const opponentsPanelContent = document.querySelector('#opponents-config .panel-content');
                if (opponentsPanelContent) opponentsPanelContent.style.display = 'none';
            } catch (e) {
                console.error('Failed to load example opponents', e);
            } finally {
                exampleOpponentsBtn.textContent = 'LOAD EXAMPLES ↓';
                exampleOpponentsBtn.disabled = false;
            }
        });
    }

    // Make the opponents-config tx-h header toggleable (click to collapse/expand)
    const opponentsConfigHeader = document.querySelector('#opponents-config .tx-h');
    if (opponentsConfigHeader) {
        opponentsConfigHeader.style.cursor = 'pointer';
        opponentsConfigHeader.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const content = document.querySelector('#opponents-config .panel-content');
            if (content) {
                content.style.display = content.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    // Initialize terminal chrome (clock, seed, tx-tabs, paste panel)
    initTerminalChrome();
    initDeckRadar();

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
    initMaraInputs();
    initDreamHarvestInputs();
    initMindsDilationInputs();
    initAbstractInputs();
    initChimilInputs();
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

    // Initial render goes through switchTab so the first paint takes exactly the
    // same path as every later tab change. Calling updateUI() directly skipped
    // the panel show/hide logic, so the shared deck-config panel stayed hidden
    // until the user clicked a tab and then appeared — a visible inconsistency
    // between the landing state and every state after it.
    // currentTab is whatever parseShareUrl() resolved to, so a shared link still wins.
    switchTab(currentTab);

    // Add keyboard navigation (dynamic — follows the visible tabs in the active group)
    initKeyboardNav();

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
