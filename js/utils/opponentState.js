/**
 * Shared Opponent State Module
 * Manages opponent deck data shared across multiplayer calculators (Mara, Dream Harvest, etc.)
 */

import { importDeckFromUrl, importDecklistBatch } from './decklistImport.js';
import { buildDeckFromCardData, shuffleDeck } from './sampleSimulator.js';

// Shared opponent deck state
const opponentDecks = {
    opponent1: { cardsByName: {}, cardDetails: [], deckSize: 0, name: 'Opponent 1', importUrl: null },
    opponent2: { cardsByName: {}, cardDetails: [], deckSize: 0, name: 'Opponent 2', importUrl: null },
    opponent3: { cardsByName: {}, cardDetails: [], deckSize: 0, name: 'Opponent 3', importUrl: null }
};

let activeOpponents = ['opponent1'];
let currentSelectedOpponent = 'opponent1';

// Callbacks for when opponent data changes
const changeListeners = [];

/**
 * Register a callback to be notified when opponent data changes
 * @param {Function} callback - Function to call when data changes
 */
export function onOpponentChange(callback) {
    changeListeners.push(callback);
}

/**
 * Notify all listeners that opponent data has changed
 */
function notifyChange() {
    changeListeners.forEach(cb => cb());
}

/**
 * Get all opponent deck data
 * @returns {Object} - All opponent decks
 */
export function getOpponentDecks() {
    return opponentDecks;
}

/**
 * Get active opponent keys
 * @returns {Array} - Array of active opponent keys
 */
export function getActiveOpponents() {
    return [...activeOpponents];
}

/**
 * Get opponent data by key
 * @param {string} opponentKey - Opponent key (opponent1, opponent2, opponent3)
 * @returns {Object} - Opponent deck data
 */
export function getOpponentData(opponentKey) {
    return opponentDecks[opponentKey] || null;
}

/**
 * Check if any opponent has deck data
 * @returns {boolean}
 */
export function hasAnyDeckData() {
    return activeOpponents.some(opp => {
        const data = opponentDecks[opp];
        return data?.cardsByName && Object.keys(data.cardsByName).length > 0;
    });
}

/**
 * Get opponents that have deck data
 * @returns {Array} - Array of opponent keys with data
 */
export function getOpponentsWithData() {
    return activeOpponents.filter(opp => {
        const data = opponentDecks[opp];
        return data?.cardsByName && Object.keys(data.cardsByName).length > 0;
    });
}

/**
 * Build a shuffled deck from opponent data
 * @param {string} opponentKey - Opponent key
 * @returns {Array|null} - Shuffled deck array or null
 */
export function buildOpponentDeck(opponentKey) {
    const data = opponentDecks[opponentKey];
    if (!data?.cardsByName || Object.keys(data.cardsByName).length === 0) {
        return null;
    }
    return buildDeckFromCardData(data);
}

/**
 * Get a shuffled copy of opponent's deck
 * @param {string} opponentKey - Opponent key
 * @returns {Array|null} - Shuffled deck or null
 */
export function getShuffledDeck(opponentKey) {
    const deck = buildOpponentDeck(opponentKey);
    return deck ? shuffleDeck([...deck]) : null;
}

/**
 * Clear opponent deck data
 * @param {string} opponentKey - Opponent key
 */
export function clearOpponentDeck(opponentKey) {
    opponentDecks[opponentKey] = {
        cardsByName: {},
        cardDetails: [],
        deckSize: 0,
        name: opponentKey.replace('opponent', 'Opponent '),
        importUrl: null
    };
    notifyChange();
}

/**
 * Remove opponent from active list
 * @param {string} opponentKey - Opponent key to remove
 */
export function removeOpponent(opponentKey) {
    const index = activeOpponents.indexOf(opponentKey);
    if (index > -1 && activeOpponents.length > 1) {
        activeOpponents.splice(index, 1);

        // Renumber remaining opponents
        const newActiveOpponents = [];
        activeOpponents.forEach((_, i) => {
            newActiveOpponents.push(`opponent${i + 1}`);
        });

        // Move data to new keys
        const tempData = {};
        activeOpponents.forEach((oldKey, i) => {
            const newKey = `opponent${i + 1}`;
            tempData[newKey] = { ...opponentDecks[oldKey] };
        });

        // Apply remapped data and clear unused slots
        ['opponent1', 'opponent2', 'opponent3'].forEach(key => {
            if (tempData[key]) {
                opponentDecks[key] = tempData[key];
            } else {
                opponentDecks[key] = {
                    cardsByName: {},
                    cardDetails: [],
                    deckSize: 0,
                    name: key.replace('opponent', 'Opponent '),
                    importUrl: null
                };
            }
        });

        activeOpponents = newActiveOpponents;

        // Update selected opponent if needed
        if (!activeOpponents.includes(currentSelectedOpponent)) {
            currentSelectedOpponent = activeOpponents[0];
        }

        notifyChange();
    }
}

/**
 * Add a new opponent
 * @returns {string|null} - New opponent key or null if max reached
 */
export function addOpponent() {
    if (activeOpponents.length >= 3) return null;

    const nextOpp = `opponent${activeOpponents.length + 1}`;
    activeOpponents.push(nextOpp);
    currentSelectedOpponent = nextOpp;
    notifyChange();
    return nextOpp;
}

/**
 * Import a deck for a specific opponent
 * @param {string} opponentKey - Opponent key
 * @param {string} input - URL or decklist text
 * @param {boolean} isUrl - Whether input is a URL
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<Object>} - Import result
 */
export async function importOpponentDeck(opponentKey, input, isUrl = true, progressCallback = null) {
    let result;
    if (isUrl) {
        result = await importDeckFromUrl(input, progressCallback);
    } else {
        result = await importDecklistBatch(input, progressCallback);
    }

    opponentDecks[opponentKey] = {
        cardsByName: result.cardsByName,
        cardDetails: result.cardDetails,
        deckSize: result.actualCardCount,
        name: result.importMetadata?.deckName || opponentKey.replace('opponent', 'Opponent '),
        importUrl: isUrl ? input : null
    };

    notifyChange();
    return result;
}

/**
 * Get opponent URLs (for share.js)
 * @returns {Object}
 */
export function getOpponentUrls() {
    return {
        opponent1: opponentDecks.opponent1.importUrl,
        opponent2: opponentDecks.opponent2.importUrl,
        opponent3: opponentDecks.opponent3.importUrl
    };
}

/**
 * Set opponent deck URL (for share.js restore)
 * @param {string} opponentKey - Opponent key
 * @param {string} url - Deck URL
 */
export async function setOpponentUrl(opponentKey, url) {
    if (url && opponentDecks[opponentKey]) {
        if (!activeOpponents.includes(opponentKey)) {
            activeOpponents.push(opponentKey);
        }
        await importOpponentDeck(opponentKey, url, true);
    }
}

/**
 * Switch to a different opponent tab
 * @param {string} opponentKey - Opponent key
 */
export function switchOpponentTab(opponentKey) {
    currentSelectedOpponent = opponentKey;
    renderOpponentTabs();
}

/**
 * Render the shared opponent tabs UI
 */
export function renderOpponentTabs() {
    const tabsContainer = document.getElementById('shared-opponent-tabs');
    const importContainer = document.getElementById('shared-opponent-import');

    if (!tabsContainer || !importContainer) return;

    // Ensure currentSelectedOpponent is valid
    if (!activeOpponents.includes(currentSelectedOpponent)) {
        currentSelectedOpponent = activeOpponents[0];
    }

    // Render tabs
    let tabsHtml = activeOpponents.map((opp, i) => {
        const data = opponentDecks[opp];
        const hasData = data.cardsByName && Object.keys(data.cardsByName).length > 0;
        const name = hasData ? data.name : `Opponent ${i + 1}`;
        const indicator = hasData ? '<span class="import-indicator">✓</span>' : '';
        const removeBtn = activeOpponents.length > 1
            ? `<span class="opponent-remove" data-opponent="${opp}" title="Remove opponent">&times;</span>`
            : '';
        const isActive = opp === currentSelectedOpponent;
        return `<button class="opponent-tab ${isActive ? 'active' : ''}" data-opponent="${opp}">${name}${indicator}${removeBtn}</button>`;
    }).join('');

    if (activeOpponents.length < 3) {
        tabsHtml += '<button class="opponent-tab add-opponent" id="shared-add-opponent">+ Add</button>';
    }

    tabsContainer.innerHTML = tabsHtml;

    // Render import panels
    importContainer.innerHTML = activeOpponents.map((opp, i) => {
        const data = opponentDecks[opp];
        const hasData = data.cardsByName && Object.keys(data.cardsByName).length > 0;
        const isVisible = opp === currentSelectedOpponent;

        return `
        <div class="opponent-import-panel" data-opponent="${opp}" style="display: ${isVisible ? 'block' : 'none'};">
            ${hasData ? `
                <div class="opponent-deck-status">
                    <span class="deck-info"><strong>${data.name}</strong> (${data.deckSize} cards)</span>
                    <button class="clear-btn shared-clear-deck" data-opponent="${opp}">Clear</button>
                </div>
            ` : ''}
            <div class="input-group import-section" ${hasData ? 'style="opacity: 0.6;"' : ''}>
                <label>Import from Moxfield or Archidekt</label>
                <div class="import-url-row" style="display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm);">
                    <input type="text" id="shared-${opp}-url" placeholder="https://moxfield.com/decks/..." ${hasData ? 'disabled' : ''} style="flex: 1; padding: var(--spacing-md); border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: var(--input-bg); color: var(--text-light);">
                    <button class="import-btn shared-url-import" data-opponent="${opp}" ${hasData ? 'disabled' : ''}>Import</button>
                </div>
                <div style="text-align: center; margin-bottom: var(--spacing-sm); color: var(--text-dim); font-size: 0.85em;">OR PASTE TEXT</div>
                <textarea id="shared-${opp}-text" placeholder="Paste decklist..." rows="2" ${hasData ? 'disabled' : ''} style="width: 100%; padding: var(--spacing-md); border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: var(--input-bg); color: var(--text-light); resize: vertical;"></textarea>
                <button class="import-btn shared-text-import" data-opponent="${opp}" ${hasData ? 'disabled' : ''} style="margin-top: var(--spacing-sm);">Analyze Text</button>
                <div class="import-progress" id="shared-${opp}-progress" style="margin-top: var(--spacing-sm);">
                    <div class="import-progress-bar" id="shared-${opp}-progress-bar"></div>
                </div>
                <div id="shared-${opp}-status" class="import-status" style="margin-top: var(--spacing-sm);"></div>
            </div>
        </div>
    `}).join('');

    // Attach event listeners
    attachEventListeners(tabsContainer, importContainer);
}

/**
 * Attach event listeners to opponent UI elements
 */
function attachEventListeners(tabsContainer, importContainer) {
    // Tab click listeners
    tabsContainer.querySelectorAll('.opponent-tab:not(.add-opponent)').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.classList.contains('opponent-remove')) return;
            switchOpponentTab(tab.dataset.opponent);
        });
    });

    // Remove button listeners
    tabsContainer.querySelectorAll('.opponent-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeOpponent(btn.dataset.opponent);
            renderOpponentTabs();
        });
    });

    // Add opponent button
    const addBtn = document.getElementById('shared-add-opponent');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            addOpponent();
            renderOpponentTabs();
        });
    }

    // Clear deck buttons
    importContainer.querySelectorAll('.shared-clear-deck').forEach(btn => {
        btn.addEventListener('click', () => {
            clearOpponentDeck(btn.dataset.opponent);
            renderOpponentTabs();
        });
    });

    // URL import buttons
    importContainer.querySelectorAll('.shared-url-import').forEach(btn => {
        btn.addEventListener('click', async () => {
            const opp = btn.dataset.opponent;
            const urlInput = document.getElementById(`shared-${opp}-url`);
            const statusEl = document.getElementById(`shared-${opp}-status`);
            const progressBar = document.getElementById(`shared-${opp}-progress-bar`);

            if (!urlInput.value.trim()) {
                statusEl.innerHTML = '<span style="color: var(--danger);">Please enter a URL</span>';
                return;
            }

            btn.disabled = true;
            statusEl.textContent = 'Importing...';

            try {
                await importOpponentDeck(opp, urlInput.value.trim(), true, (progress) => {
                    progressBar.style.width = `${progress.percentage}%`;
                    statusEl.textContent = progress.currentCard || 'Loading...';
                });

                statusEl.innerHTML = '<span style="color: var(--success);">Success!</span>';
                renderOpponentTabs();
            } catch (error) {
                statusEl.innerHTML = `<span style="color: var(--danger);">Error: ${error.message}</span>`;
                btn.disabled = false;
            } finally {
                progressBar.style.width = '0%';
            }
        });
    });

    // Text import buttons
    importContainer.querySelectorAll('.shared-text-import').forEach(btn => {
        btn.addEventListener('click', async () => {
            const opp = btn.dataset.opponent;
            const textInput = document.getElementById(`shared-${opp}-text`);
            const statusEl = document.getElementById(`shared-${opp}-status`);
            const progressBar = document.getElementById(`shared-${opp}-progress-bar`);

            if (!textInput.value.trim()) {
                statusEl.innerHTML = '<span style="color: var(--danger);">Please paste a decklist</span>';
                return;
            }

            btn.disabled = true;
            statusEl.textContent = 'Analyzing...';

            try {
                await importOpponentDeck(opp, textInput.value.trim(), false, (progress) => {
                    progressBar.style.width = `${progress.percentage}%`;
                    statusEl.textContent = progress.currentCard || 'Analyzing...';
                });

                statusEl.innerHTML = '<span style="color: var(--success);">Success!</span>';
                renderOpponentTabs();
            } catch (error) {
                statusEl.innerHTML = `<span style="color: var(--danger);">Error: ${error.message}</span>`;
                btn.disabled = false;
            } finally {
                progressBar.style.width = '0%';
            }
        });
    });
}

/**
 * Initialize the shared opponent UI
 */
export function init() {
    renderOpponentTabs();
}
