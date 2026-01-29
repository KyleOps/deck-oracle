/**
 * Dream Harvest Calculator
 * Simulates Dream Harvest outcomes for opponent decks
 *
 * Card Effect:
 * Each opponent exiles cards from the top of their library until they have
 * exiled cards with total mana value 5 or greater this way. Until end of turn,
 * you may cast cards exiled this way without paying their mana costs.
 */

import { createCache } from '../utils/simulation.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { generateSampleRevealsHTML } from '../utils/components.js';
import { shuffleDeck, renderCardBadge, createCollapsibleSection, buildDeckFromCardData } from '../utils/sampleSimulator.js';
import * as OpponentState from '../utils/opponentState.js';

const CONFIG = {
    DEFAULT_SAMPLE_SIZE: 500,
    DEFAULT_SIM_COUNT: 5000,
    MV_THRESHOLD: 5 // Exile until total MV >= 5
};

let simulationCache = createCache(50);

// Stable samples for each opponent
const stableSamples = {
    opponent1: [],
    opponent2: [],
    opponent3: []
};

// Track rendered count for batch rendering per opponent
const renderedCounts = {
    opponent1: 0,
    opponent2: 0,
    opponent3: 0
};

/**
 * Render a compact horizontal bar chart (no gaps, shows all values)
 */
function renderCompactChart(data, totalSims, labelFn, barColor = '#3b82f6', labelWidth = 28) {
    let html = '<div class="compact-dist-chart" style="display: flex; flex-direction: column; gap: 2px;">';

    for (let i = 0; i < data.length; i++) {
        const count = data[i] || 0;
        const pct = (count / totalSims * 100);
        const pctStr = pct.toFixed(1) + '%';

        html += `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8em;">
                <div style="width: ${labelWidth}px; text-align: right; color: var(--text-dim); white-space: nowrap;">${labelFn(i)}</div>
                <div style="flex: 1; height: 14px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: 2px;"></div>
                </div>
                <div style="width: 42px; text-align: right; color: var(--text-secondary);">${pctStr}</div>
            </div>
        `;
    }

    html += '</div>';
    return html;
}

/**
 * Simulate Dream Harvest: Exile until total MV >= 5
 * @param {Array} deck - Shuffled deck array
 * @returns {Object} - { cardsExiled, totalMV, exiledCards, castableSpells }
 */
export function simulateDreamHarvest(deck) {
    let totalMV = 0;
    const exiledCards = [];

    for (const card of deck) {
        exiledCards.push(card);
        totalMV += card.cmc || 0;
        if (totalMV >= CONFIG.MV_THRESHOLD) break;
    }

    const castableSpells = exiledCards.filter(c => !c.types.includes('land'));

    return {
        cardsExiled: exiledCards.length,
        totalMV,
        exiledCards,
        castableSpells,
        numCastable: castableSpells.length,
        totalCastableMV: castableSpells.reduce((sum, c) => sum + (c.cmc || 0), 0)
    };
}

/**
 * Calculate Dream Harvest statistics for an opponent deck
 * @param {Object} opponentData - Opponent deck data with cardsByName
 * @param {number} numSims - Number of simulations
 * @returns {Object} - Statistics
 */
export function calculateDreamHarvestStats(opponentData, numSims = CONFIG.DEFAULT_SIM_COUNT) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) {
        return null;
    }

    // Build deck directly from passed data (works for both tests and app)
    const deck = buildDeckFromCardData(opponentData);

    if (!deck || deck.length === 0) return null;

    let totalCardsExiled = 0;
    let totalMV = 0;
    let totalCastable = 0;
    let totalCastableMV = 0;
    const cardsExiledDist = {};
    const totalMVDist = {};

    for (let i = 0; i < numSims; i++) {
        const shuffled = shuffleDeck([...deck]);
        const result = simulateDreamHarvest(shuffled);

        totalCardsExiled += result.cardsExiled;
        totalMV += result.totalMV;
        totalCastable += result.numCastable;
        totalCastableMV += result.totalCastableMV;

        cardsExiledDist[result.cardsExiled] = (cardsExiledDist[result.cardsExiled] || 0) + 1;
        totalMVDist[result.totalMV] = (totalMVDist[result.totalMV] || 0) + 1;
    }

    return {
        avgCardsExiled: totalCardsExiled / numSims,
        avgTotalMV: totalMV / numSims,
        avgCastable: totalCastable / numSims,
        avgCastableMV: totalCastableMV / numSims,
        cardsExiledDist,
        totalMVDist,
        numSims,
        deckSize: deck.length
    };
}

/**
 * Generate stable samples for an opponent
 */
function generateStableSamples(opponentKey, count) {
    const deck = OpponentState.buildOpponentDeck(opponentKey);
    if (!deck) {
        stableSamples[opponentKey] = [];
        return;
    }

    stableSamples[opponentKey] = [];
    for (let i = 0; i < count; i++) {
        stableSamples[opponentKey].push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh samples for all opponents and re-render
 */
function refreshSamples() {
    const countInput = document.getElementById('dreamharvest-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);

    for (const opp of OpponentState.getActiveOpponents()) {
        if (OpponentState.getOpponentData(opp)?.cardsByName &&
            Object.keys(OpponentState.getOpponentData(opp).cardsByName).length > 0) {
            generateStableSamples(opp, numSims);
        }
    }

    runSampleReveals();
}

/**
 * Render results for all active opponents
 */
function renderResults() {
    const resultsContainer = document.getElementById('dreamharvest-results');
    if (!resultsContainer) return;

    const opponentsWithData = OpponentState.getOpponentsWithData();

    if (opponentsWithData.length === 0) {
        resultsContainer.innerHTML = `
            <h2>Results</h2>
            <p style="color: var(--text-dim); text-align: center; padding: 20px;">
                Import at least one opponent's decklist to see analysis.
            </p>
        `;
        return;
    }

    // Calculate totals for summary
    let totalFreeSpells = 0;
    let totalValueGained = 0;
    const allStats = [];

    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        const stats = calculateDreamHarvestStats(data);
        if (stats) {
            allStats.push({ opp, data, stats });
            totalFreeSpells += stats.avgCastable;
            totalValueGained += stats.avgCastableMV;
        }
    }

    let html = '<h2>Dream Harvest Analysis</h2>';

    // Summary section
    if (allStats.length > 0) {
        html += `
            <div class="summary-stats-box">
                <h3>Summary: Your Expected Gains</h3>
                <div class="summary-stats-grid">
                    <div class="summary-stat blue">
                        <div class="stat-label">Total Free Spells</div>
                        <div class="stat-value">${totalFreeSpells.toFixed(1)}</div>
                        <div class="stat-unit">spells cast free</div>
                    </div>
                    <div class="summary-stat dark-blue">
                        <div class="stat-label">Total Value Gained</div>
                        <div class="stat-value">${totalValueGained.toFixed(1)}</div>
                        <div class="stat-unit">mana value</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Individual opponent results
    for (const { data, stats } of allStats) {
        html += `
            <div class="opponent-results">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm);">
                    <h3 style="color: var(--dreamharvest-primary, #3b82f6);">${data.name}</h3>
                    <span style="color: var(--text-dim); font-size: 0.85em;">${stats.deckSize} cards</span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">
                    <div class="choice-card choice-blue" style="text-align: center;">
                        <div style="font-size: 0.75em; color: var(--text-dim);">Cards Exiled</div>
                        <div style="font-size: 1.3em; font-weight: bold; color: #3b82f6;">${stats.avgCardsExiled.toFixed(1)}</div>
                    </div>
                    <div class="choice-card choice-blue" style="text-align: center;">
                        <div style="font-size: 0.75em; color: var(--text-dim);">Total MV</div>
                        <div style="font-size: 1.3em; font-weight: bold; color: #3b82f6;">${stats.avgTotalMV.toFixed(1)}</div>
                    </div>
                    <div class="choice-card choice-blue" style="text-align: center;">
                        <div style="font-size: 0.75em; color: var(--text-dim);">Free Spells</div>
                        <div style="font-size: 1.3em; font-weight: bold; color: #3b82f6;">${stats.avgCastable.toFixed(1)}</div>
                    </div>
                    <div class="choice-card choice-blue" style="text-align: center;">
                        <div style="font-size: 0.75em; color: var(--text-dim);">Value Gained</div>
                        <div style="font-size: 1.3em; font-weight: bold; color: #3b82f6;">${stats.avgCastableMV.toFixed(1)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    resultsContainer.innerHTML = html;
}

/**
 * Run sample reveals
 */
export function runSampleReveals() {
    const displayContainer = document.getElementById('dreamharvest-reveals-display');
    if (!displayContainer) return;

    const opponentsWithData = OpponentState.getOpponentsWithData();

    if (opponentsWithData.length === 0) {
        displayContainer.innerHTML = '<p style="color: var(--text-dim);">Please import opponent decklists to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('dreamharvest-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);

    for (const opp of opponentsWithData) {
        if (!stableSamples[opp] || stableSamples[opp].length < numSims) {
            generateStableSamples(opp, numSims);
        }
    }

    let fullHTML = '';

    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        const samples = stableSamples[opp];

        // Stats loop
        let totalCardsExiled = 0;
        let totalMV = 0;
        let totalCastable = 0;
        const cardsExiledDist = {};
        let maxCards = 0;

        for (let i = 0; i < numSims; i++) {
            const shuffled = samples[i];
            const result = simulateDreamHarvest(shuffled);

            totalCardsExiled += result.cardsExiled;
            totalMV += result.totalMV;
            totalCastable += result.numCastable;

            cardsExiledDist[result.cardsExiled] = (cardsExiledDist[result.cardsExiled] || 0) + 1;
            if (result.cardsExiled > maxCards) maxCards = result.cardsExiled;
        }

        // Convert to array
        const cardsDistArray = new Array(Math.min(maxCards + 1, 10)).fill(0);
        for (const [cards, freq] of Object.entries(cardsExiledDist)) {
            const idx = Math.min(parseInt(cards), 9);
            cardsDistArray[idx] = (cardsDistArray[idx] || 0) + freq;
        }

        const avgCards = (totalCardsExiled / numSims).toFixed(1);
        const avgMV = (totalMV / numSims).toFixed(1);
        const avgCastable = (totalCastable / numSims).toFixed(1);

        let oppHTML = `<div style="margin-bottom: var(--spacing-lg); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md); border: 1px solid var(--glass-border);">`;
        oppHTML += `<h4 style="margin-top: 0; color: var(--dreamharvest-primary, #3b82f6);">${data.name}</h4>`;

        // Stats summary
        oppHTML += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">`;
        oppHTML += `<div style="text-align: center; padding: var(--spacing-sm); background: rgba(59, 130, 246, 0.1); border-radius: var(--radius-sm);">`;
        oppHTML += `<small style="color: var(--text-dim);">Avg Cards</small><br>`;
        oppHTML += `<strong style="color: #3b82f6; font-size: 1.2em;">${avgCards}</strong>`;
        oppHTML += `</div>`;
        oppHTML += `<div style="text-align: center; padding: var(--spacing-sm); background: rgba(59, 130, 246, 0.1); border-radius: var(--radius-sm);">`;
        oppHTML += `<small style="color: var(--text-dim);">Avg MV</small><br>`;
        oppHTML += `<strong style="color: #3b82f6; font-size: 1.2em;">${avgMV}</strong>`;
        oppHTML += `</div>`;
        oppHTML += `<div style="text-align: center; padding: var(--spacing-sm); background: rgba(59, 130, 246, 0.1); border-radius: var(--radius-sm);">`;
        oppHTML += `<small style="color: var(--text-dim);">Free Spells</small><br>`;
        oppHTML += `<strong style="color: #3b82f6; font-size: 1.2em;">${avgCastable}</strong>`;
        oppHTML += `</div></div>`;

        // Cards exiled distribution
        oppHTML += `<div style="margin-bottom: var(--spacing-md);">`;
        oppHTML += `<h5 style="margin: 0 0 var(--spacing-sm) 0; color: #3b82f6;">Cards Exiled Distribution</h5>`;
        oppHTML += renderCompactChart(cardsDistArray, numSims, (idx) => `${idx}`, '#3b82f6');
        oppHTML += `</div>`;

        // Sample list
        const listId = `dreamharvest-${opp}-samples-list`;
        const btnId = `dreamharvest-${opp}-load-more`;
        const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: var(--spacing-md); display: none;">Load More</button>`;

        oppHTML += createCollapsibleSection('Show/Hide Sample Simulations', listHTML, false);
        oppHTML += `</div>`;
        fullHTML += oppHTML;
    }

    displayContainer.innerHTML = fullHTML;

    // Batch render samples
    for (const opp of opponentsWithData) {
        const listContainer = document.getElementById(`dreamharvest-${opp}-samples-list`);
        const loadMoreBtn = document.getElementById(`dreamharvest-${opp}-load-more`);
        const samples = stableSamples[opp];

        renderedCounts[opp] = 0;

        const renderBatch = (batchSize) => {
            const start = renderedCounts[opp];
            const end = Math.min(start + batchSize, numSims);
            let html = '';

            for (let i = start; i < end; i++) {
                const shuffled = samples[i];
                const result = simulateDreamHarvest(shuffled);

                const exiledHtml = result.exiledCards.map(card => renderCardBadge(card)).join(' ');
                const castableNames = result.castableSpells.map(c => c.name).join(', ');
                const isGood = result.numCastable >= 2 || result.totalCastableMV >= 5;

                html += `<div class="sample-reveal ${isGood ? 'free-spell' : 'whiff'}" style="padding: var(--spacing-sm); margin-bottom: var(--spacing-xs); background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); font-size: 0.85em;">`;
                html += `<div style="margin-bottom: var(--spacing-xs);"><strong>Sample ${i + 1}:</strong> Exiled ${result.cardsExiled} cards (MV ${result.totalMV})</div>`;
                html += `<div style="margin-bottom: var(--spacing-xs);">${exiledHtml}</div>`;
                if (result.numCastable > 0) {
                    html += `<div style="color: #3b82f6;"><strong>Cast free:</strong> ${castableNames} <span style="color: var(--text-dim);">(${result.totalCastableMV} MV value)</span></div>`;
                } else {
                    html += `<div style="color: var(--danger);">No castable spells (all lands)</div>`;
                }
                html += `</div>`;
            }

            if (listContainer) {
                listContainer.insertAdjacentHTML('beforeend', html);
            }

            renderedCounts[opp] = end;

            if (loadMoreBtn) {
                if (renderedCounts[opp] < numSims) {
                    loadMoreBtn.style.display = 'block';
                    loadMoreBtn.textContent = `Load More (Showing ${renderedCounts[opp]}/${numSims})`;
                } else {
                    loadMoreBtn.style.display = 'none';
                }
            }
        };

        renderBatch(20);

        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => renderBatch(50));
        }
    }
}

/**
 * Main calculation function
 */
export function calculate() {
    const results = {};

    for (const opp of OpponentState.getActiveOpponents()) {
        const data = OpponentState.getOpponentData(opp);
        if (data?.cardsByName && Object.keys(data.cardsByName).length > 0) {
            const cacheKey = `dreamharvest-${opp}-${data.deckSize}-${Object.keys(data.cardsByName).length}`;
            const cached = simulationCache.get(cacheKey);
            if (cached) {
                results[opp] = cached;
            } else {
                const stats = calculateDreamHarvestStats(data);
                if (stats) {
                    simulationCache.set(cacheKey, stats);
                    results[opp] = stats;
                }
            }
        }
    }

    return results;
}

/**
 * Update UI
 */
export function updateUI() {
    renderResults();

    const hasAnyDeckData = OpponentState.hasAnyDeckData();

    const sampleBtn = document.getElementById('dreamharvest-draw-reveals-btn');
    const importNote = document.querySelector('#dreamharvest-sample-reveals .sim-import-note');
    if (sampleBtn) {
        sampleBtn.disabled = !hasAnyDeckData;
    }
    if (importNote) {
        importNote.style.display = hasAnyDeckData ? 'none' : 'inline';
    }

    if (hasAnyDeckData) {
        runSampleReveals();
    }
}

/**
 * Initialize the calculator
 */
export function init() {
    // Register for opponent data changes
    OpponentState.onOpponentChange(() => {
        simulationCache.clear();
        // Clear stable samples when opponent data changes
        for (const key of Object.keys(stableSamples)) {
            stableSamples[key] = [];
        }
        updateUI();
    });

    registerCalculator({
        name: 'dreamharvest',
        calculate,
        updateUI,
        init: () => {
            const sampleContainer = document.getElementById('dreamharvest-sample-reveals');
            if (sampleContainer) {
                sampleContainer.innerHTML = generateSampleRevealsHTML('dreamharvest', 'Sample Dream Harvest', { requiresImport: true });
            }

            const sampleBtn = document.getElementById('dreamharvest-draw-reveals-btn');
            if (sampleBtn) {
                sampleBtn.addEventListener('click', refreshSamples);
            }

            updateUI();
        }
    });
}

/**
 * Get opponent deck URLs (for share.js) - delegates to shared state
 */
export function getOpponentUrls() {
    return OpponentState.getOpponentUrls();
}

/**
 * Set opponent deck URL (for share.js restore) - delegates to shared state
 */
export async function setOpponentUrl(opponentKey, url) {
    return OpponentState.setOpponentUrl(opponentKey, url);
}
