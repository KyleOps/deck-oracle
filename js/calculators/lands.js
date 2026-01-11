/**
 * Land Drop Calculator
 * Calculates average turn for missing land drop and opening hand land distribution
 */

import { drawType, drawTypeMin } from '../utils/hypergeometric.js';
import { formatNumber, formatPercentage, createCache, debounce } from '../utils/simulation.js';
import { renderMultiColumnTable } from '../utils/tableUtils.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, 
    createCollapsibleSection, extractCardTypes
} from '../utils/sampleSimulator.js';

let simulationCache = createCache(100);
let lastDeckHash = '';
let openingHandChart = null;
let landDropChart = null;

// Stable samples state
let stableSamples = [];
let lastSampleDeckHash = '';
const SAMPLE_COUNT_DEFAULT = 10;
let renderedCount = 0; // Track displayed samples for pagination

// Color constants
const COLORS = {
    primary: '#4ade80',
    primaryDim: 'rgba(74, 222, 128, 0.4)',
    primaryBright: 'rgba(74, 222, 128, 0.8)',
    primaryFaint: 'rgba(74, 222, 128, 0.1)',
    primaryGrid: 'rgba(34, 197, 94, 0.2)',
    danger: '#dc2626',
    dangerFaint: 'rgba(220, 38, 38, 0.1)',
    text: '#a09090',
    white: '#fff'
};

/**
 * Calculate probability of drawing new lands by a given turn
 * @param {number} deckSize - Total deck size
 * @param {number} landCount - Number of lands in deck
 * @param {number} turn - Turn number
 * @returns {number} - Probability of having enough lands
 */
function newLands(deckSize, landCount, turn) {
    // By turn N, you've drawn turn + 7 cards (7 opening hand + turn draws)
    const cardsDrawn = turn + 7;
    // Need at least turn lands to make every drop
    return 1 - drawTypeMin(deckSize, landCount, cardsDrawn, turn);
}

/**
 * Calculate the median turn for missing a land drop
 * @param {number} deckSize - Total deck size
 * @param {number} landCount - Number of lands in deck
 * @returns {number} - Expected turn for missing land drop
 */
export function calculateLandDropMiss(deckSize, landCount) {
    const cacheKey = `miss-${deckSize}-${landCount}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    if (landCount === 0) return 1;
    if (landCount >= deckSize) return Infinity;

    // Find the turn where probability of missing crosses 50%
    for (let turn = 1; turn <= 10; turn++) {
        const missProbability = newLands(deckSize, landCount, turn);
        if (missProbability > 0.5) {
            simulationCache.set(cacheKey, turn);
            return turn;
        }
    }

    // Fallback formula for late misses
    const result = Math.round(7 / (1 - landCount / deckSize));
    simulationCache.set(cacheKey, result);
    return result;
}

/**
 * Calculate distribution of lands in opening hand
 * @param {number} deckSize - Total deck size
 * @param {number} landCount - Number of lands in deck
 * @returns {Object} - Distribution and median
 */
export function calculateOpeningHands(deckSize, landCount) {
    const cacheKey = `opening-${deckSize}-${landCount}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    const distribution = [];
    let cumulative = 0;
    let median = 0;

    // Calculate probability for 0-7 lands in opening 7-card hand
    for (let numLands = 0; numLands <= 7; numLands++) {
        const prob = drawType(deckSize, landCount, 7, numLands);
        distribution.push({ lands: numLands, probability: prob });

        cumulative += prob;
        if (median === 0 && cumulative >= 0.5) {
            median = numLands;
        }
    }

    const result = { distribution, median };
    simulationCache.set(cacheKey, result);
    return result;
}

/**
 * Calculate land drop probabilities by turn
 * @param {number} deckSize - Total deck size
 * @param {number} landCount - Number of lands in deck
 * @returns {Array} - Array of {turn, probability} objects
 */
export function calculateLandDropByTurn(deckSize, landCount) {
    const cacheKey = `landdrops-${deckSize}-${landCount}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    const results = [];

    for (let turn = 1; turn <= 10; turn++) {
        const missProbability = newLands(deckSize, landCount, turn);
        const makeProbability = 1 - missProbability;
        results.push({
            turn,
            makeProbability,
            missProbability
        });
    }

    simulationCache.set(cacheKey, results);
    return results;
}

/**
 * Generate stable samples from the deck
 * @param {Array} deck - The source deck
 * @param {number} count - Number of samples to generate
 */
function generateStableSamples(deck, count) {
    stableSamples = [];
    for (let i = 0; i < Math.max(count, SAMPLE_COUNT_DEFAULT); i++) {
        stableSamples.push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh of stable samples
 */
function refreshSamples() {
    const config = getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();

    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        const countInput = document.getElementById('lands-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || SAMPLE_COUNT_DEFAULT);
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
        runSampleReveals(); // Re-render
    }
}

/**
 * Run sample Opening Hand reveals
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        const display = document.getElementById('lands-reveals-display');
        if (display) display.innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('lands-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || SAMPLE_COUNT_DEFAULT);

    // Build deck if needed for generating samples
    const deck = buildDeckFromCardData(cardData);

    // Ensure we have stable samples
    if (stableSamples.length < numSims) {
        generateStableSamples(deck, numSims);
    }

    // Reset render count
    renderedCount = 0;

    // Prepare container structure
    const samplesContainerId = 'lands-samples-list';
    const loadMoreBtnId = 'lands-load-more';
    
    const containerHTML = `
        <div id="${samplesContainerId}"></div>
        <button id="${loadMoreBtnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">
            Load More (50)
        </button>
    `;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Hands (${numSims} samples)`,
        containerHTML,
        true
    );

    const display = document.getElementById('lands-reveals-display');
    if (display) {
        display.innerHTML = revealsSectionHTML;
        
        const listContainer = document.getElementById(samplesContainerId);
        const loadMoreBtn = document.getElementById(loadMoreBtnId);
        
        // Render Batch Function
        const renderBatch = (batchSize) => {
            const start = renderedCount;
            const end = Math.min(start + batchSize, numSims);
            let html = '';
            
            const HAND_SIZE = 7;
            const DRAWS = 5;

            for (let i = start; i < end; i++) {
                const shuffled = stableSamples[i];
                const hand = shuffled.slice(0, HAND_SIZE);
                const draws = shuffled.slice(HAND_SIZE, HAND_SIZE + DRAWS);

                let landCount = 0;
                hand.forEach(c => { if (c.types.includes('land')) landCount++; });

                const keepable = landCount >= 2 && landCount <= 5;
                const statusClass = keepable ? 'free-spell' : 'whiff';
                
                html += `<div class="sample-reveal ${statusClass}">`;
                html += `<div><strong>Sample ${i + 1}:</strong> ${landCount} lands in opener</div>`;
                
                html += '<div style="margin: 8px 0; display: flex; flex-wrap: wrap; gap: 4px;">';
                hand.forEach(card => {
                    html += renderCardBadge(card);
                });
                html += '</div>';

                html += `<div style="margin-top: 8px; font-size: 0.9em; color: var(--text-dim); border-top: 1px dashed var(--border-color); padding-top: 4px;">Next ${DRAWS} draws:</div>`;
                html += '<div style="margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px; opacity: 0.9;">';
                draws.forEach(card => {
                    html += renderCardBadge(card);
                });
                html += '</div></div>';
            }

            if (listContainer) {
                // Determine if we need a temporary wrapper to append HTML string or just insertAdjacentHTML
                listContainer.insertAdjacentHTML('beforeend', html);
            }
            
            renderedCount = end;
            
            // Update Button
            if (loadMoreBtn) {
                if (renderedCount < numSims) {
                    loadMoreBtn.style.display = 'block';
                    loadMoreBtn.textContent = `Load More (Showing ${renderedCount}/${numSims})`;
                } else {
                    loadMoreBtn.style.display = 'none';
                }
            }
        };

        // Initial Render
        renderBatch(50);

        // Bind Click
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => renderBatch(50));
        }
    }
}

/**
 * Get current deck configuration
 * @returns {Object} - Deck configuration
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const deckSize = DeckConfig.getDeckSize(true);
    const landCount = config.lands;

    // Clear cache if deck changed
    const newHash = `${deckSize}-${landCount}`;
    
    // Check if we need to refresh stable samples
    const cardData = DeckConfig.getImportedCardData();
    // Use cardData hash or just the stringified config to check for deck changes
    // Ideally we check if the imported data actually changed
    const sampleHash = JSON.stringify(cardData?.cardsByName || {});
    
    if (sampleHash !== lastSampleDeckHash && cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, SAMPLE_COUNT_DEFAULT);
        lastSampleDeckHash = sampleHash;
    }

    if (newHash !== lastDeckHash) {
        simulationCache.clear();
        lastDeckHash = newHash;
    }

    return { deckSize, landCount };
}

/**
 * Calculate all results
 * @returns {Object} - All calculation results
 */
export function calculate() {
    const config = getDeckConfig();

    if (config.deckSize === 0 || config.landCount === 0) {
        return { config, openingHands: null, landDropMiss: null, landDropByTurn: null };
    }

    const openingHands = calculateOpeningHands(config.deckSize, config.landCount);
    const landDropMiss = calculateLandDropMiss(config.deckSize, config.landCount);
    const landDropByTurn = calculateLandDropByTurn(config.deckSize, config.landCount);

    return { config, openingHands, landDropMiss, landDropByTurn };
}

/**
 * Common chart scale options
 */
const getScaleOptions = () => ({
    y: { beginAtZero: true, max: 100, title: { display: true, text: 'Probability (%)', color: COLORS.primary }, grid: { color: COLORS.primaryGrid }, ticks: { color: COLORS.primary } },
    x: { grid: { color: COLORS.primaryGrid }, ticks: { color: COLORS.text } }
});

/**
 * Update opening hand chart
 */
function updateOpeningHandChart(config, openingHands) {
    const labels = openingHands.distribution.map(d => `${d.lands} land${d.lands !== 1 ? 's' : ''}`);
    const data = openingHands.distribution.map(d => d.probability * 100);
    const backgroundColors = openingHands.distribution.map(d => d.lands === openingHands.median ? COLORS.primaryBright : COLORS.primaryDim);

    openingHandChart = createOrUpdateChart(openingHandChart, 'lands-opening-chart', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Probability (%)',
                data,
                backgroundColor: backgroundColors,
                borderColor: COLORS.primary,
                borderWidth: 2
            }]
        },
        options: {
            scales: getScaleOptions(),
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => `Probability: ${ctx.parsed.y.toFixed(2)}%`
                    }
                }
            }
        }
    });
}

/**
 * Update land drop by turn chart
 */
function updateLandDropChart(config, landDropByTurn, landDropMiss) {
    const labels = landDropByTurn.map(d => `Turn ${d.turn}`);
    const pointRadii = landDropByTurn.map(d => d.turn === landDropMiss ? 8 : 4);

    landDropChart = createOrUpdateChart(landDropChart, 'lands-landdrop-chart', {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Make Land Drop',
                    data: landDropByTurn.map(d => d.makeProbability * 100),
                    borderColor: COLORS.primary,
                    backgroundColor: COLORS.primaryFaint,
                    fill: false,
                    tension: 0.3,
                    pointRadius: pointRadii,
                    pointBackgroundColor: landDropByTurn.map(d => d.turn === landDropMiss ? COLORS.white : COLORS.primary)
                },
                {
                    label: 'Miss Land Drop',
                    data: landDropByTurn.map(d => d.missProbability * 100),
                    borderColor: COLORS.danger,
                    backgroundColor: COLORS.dangerFaint,
                    fill: false,
                    tension: 0.3,
                    pointRadius: pointRadii,
                    pointBackgroundColor: landDropByTurn.map(d => d.turn === landDropMiss ? COLORS.white : COLORS.danger)
                }
            ]
        },
        options: {
            scales: getScaleOptions(),
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                    }
                }
            }
        }
    });
}

/**
 * Update stats panel (replacing the old table)
 */
function updateStatsPanel(config, openingHands, landDropMiss, landDropByTurn) {
    const expectedTurn = landDropMiss === Infinity ? 'Never' : `Turn ${landDropMiss}`;
    const medianLands = openingHands.median;
    const prob2to4 = openingHands.distribution.slice(2, 5).reduce((sum, d) => sum + d.probability, 0);
    const probTurn3 = landDropByTurn[2].makeProbability;

    // Interpretation
    let interpretation = '';
    let color = COLORS.primary; // Green
    
    if (landDropMiss >= 6) {
        interpretation = `<strong style="color: #4ade80;">Very Consistent.</strong> You reliably hit your land drops for the early to mid game.`;
    } else if (landDropMiss >= 4) {
        interpretation = `<strong style="color: #f59e0b;">Decent.</strong> You should hit your first few drops, but may stall mid-game.`;
        color = '#f59e0b';
    } else {
        interpretation = `<strong style="color: #dc2626;">Risky.</strong> High chance of missing an early land drop (Turn ${landDropMiss}). Consider adding lands or ramp.`;
        color = '#dc2626';
    }

    const cardsHTML = [
        renderStatCard('Miss Land Drop', expectedTurn, 'expected fail point', color),
        renderStatCard('Median Hand', `${medianLands} lands`, 'in opening 7', '#38bdf8'),
        renderStatCard('Keepable Hand', formatPercentage(prob2to4), '2-4 lands in opener', '#c084fc'),
        renderStatCard('Turn 3 Ready', formatPercentage(probTurn3), 'chance to have 3 lands', probTurn3 > 0.8 ? '#4ade80' : '#f59e0b')
    ];

    const container = document.getElementById('lands-stats-container');
    if (container) {
        container.innerHTML = `
            ${renderInsightBox('🏔️ Land Consistency Analysis', interpretation, '')}
            ${renderStatsGrid(cardsHTML)}
            <div style="margin-top: 12px; font-size: 0.9em; text-align: center; color: var(--text-dim);">
                Based on ${config.landCount} lands in a ${config.deckSize}-card deck (${((config.landCount / config.deckSize) * 100).toFixed(1)}%)
            </div>
        `;
    }
}

/**
 * Update all UI elements
 */
export function updateUI() {
    const { config, openingHands, landDropMiss, landDropByTurn } = calculate();

    if (!openingHands || !landDropByTurn) {
        if (openingHandChart) openingHandChart.destroy();
        if (landDropChart) landDropChart.destroy();
        const container = document.getElementById('lands-stats-container');
        if (container) container.innerHTML = '<div class="panel-content"><p style="color: var(--text-dim); text-align: center;">Configure deck with lands to see results</p></div>';
        return;
    }

    updateOpeningHandChart(config, openingHands);
    updateLandDropChart(config, landDropByTurn, landDropMiss);
    updateStatsPanel(config, openingHands, landDropMiss, landDropByTurn);
    
    // Update sample reveals if we have data
    const cardData = DeckConfig.getImportedCardData();
    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        runSampleReveals();
    }
}

/**
 * Initialize Lands calculator
 */
export function init() {
    registerCalculator({
        name: 'lands',
        calculate,
        updateUI,
        init: () => {
            const container = document.getElementById('lands-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('lands', 'Sample Opening Hands');
            }
            const btn = document.getElementById('lands-draw-reveals-btn');
            if (btn) btn.addEventListener('click', refreshSamples);
        }
    });
}