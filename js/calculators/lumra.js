/**
 * Lumra, Bellow of the Woods Calculator
 * Simulates mill 4 and land return triggers
 */

import { drawType } from '../utils/hypergeometric.js';
import { createCache, formatNumber, debounce } from '../utils/simulation.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, renderDistributionChart,
    createCollapsibleSection
} from '../utils/sampleSimulator.js';

const CONFIG = {
    DEFAULT_SAMPLE_SIZE: 500
};

let simulationCache = createCache(50);
let lastDeckHash = '';
let chart = null;

// Stable samples state
let stableSamples = [];
let lastSampleDeckHash = '';
let renderedCount = 0;

/**
 * Generate stable samples from the deck
 * @param {Array} deck - The source deck
 * @param {number} count - Number of samples to generate
 */
function generateStableSamples(deck, count) {
    stableSamples = [];
    for (let i = 0; i < Math.max(count, CONFIG.DEFAULT_SAMPLE_SIZE); i++) {
        stableSamples.push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh of stable samples
 */
function refreshSamples() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        const countInput = document.getElementById('lumra-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
        runSampleReveals(); // Re-render
    }
}

/**
 * Get current deck configuration
 * @returns {Object} - Deck configuration
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();

    // Use shared getDeckSize function to properly handle dual-typed cards
    const deckSize = DeckConfig.getDeckSize(true);
    
    // Get total lands from config or card data
    let landCount = config.lands;
    
    // If we have imported data, recalculate exact land count (including dual faces if handled by loader)
    if (cardData && cardData.cardsByName) {
        // Recalculate lands from scratch to be safe
        let calculatedLands = 0;
        Object.values(cardData.cardsByName).forEach(card => {
            if (card.types && card.types.includes('land')) {
                calculatedLands += card.count;
            }
        });
        if (calculatedLands > 0) landCount = calculatedLands;
    }

    // Get user input for GY lands
    const gyLandsInput = document.getElementById('lumra-gyLands');
    const gyLands = parseInt(gyLandsInput?.value) || 0;

    // Get trigger multiplier
    const multInput = document.getElementById('lumra-multiplier');
    const multiplier = Math.max(1, parseInt(multInput?.value) || 1);

    // Check for sample refresh need (using object reference check for speed)
    if (cardData && cardData.cardsByName && cardData.cardsByName !== lastSampleDeckHash) {
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, CONFIG.DEFAULT_SAMPLE_SIZE);
        lastSampleDeckHash = cardData.cardsByName;
    }

    return {
        deckSize,
        landCount,
        gyLands,
        multiplier,
        cardData
    };
}

/**
 * Calculate Lumra statistics (Pure function)
 * @param {number} deckSize - Total cards in library
 * @param {number} landCount - Total lands in library
 * @param {number} gyLands - Lands already in graveyard
 * @param {number} multiplier - Number of times the ability triggers
 * @returns {Object} - Calculation results
 */
export function calculateLumraStats(deckSize, landCount, gyLands, multiplier = 1) {
    const cacheKey = `${deckSize}-${landCount}-${gyLands}-${multiplier}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    const distribution = [];
    let expectedMilled = 0;

    // Mill 4 cards * multiplier
    const MILL_AMOUNT = 4 * multiplier;
    
    for (let k = 0; k <= MILL_AMOUNT; k++) {
        // Probability of hitting exactly k lands in N cards
        const prob = drawType(deckSize, landCount, MILL_AMOUNT, k);
        distribution.push({ count: k, probability: prob });
        expectedMilled += k * prob;
    }

    const totalReturned = gyLands + expectedMilled;

    const result = {
        distribution,
        expectedMilled,
        totalReturned
    };

    simulationCache.set(cacheKey, result);
    return result;
}

/**
 * Calculate probabilities
 * @returns {Object} - Calculation results
 */
export function calculate() {
    const config = getDeckConfig();
    const { deckSize, landCount, gyLands, multiplier } = config;

    if (deckSize === 0) {
        return { config, results: null };
    }

    const results = calculateLumraStats(deckSize, landCount, gyLands, multiplier);

    return {
        config,
        ...results
    };
}

/**
 * Update chart visualization
 */
function updateChart(config, distribution) {
    const labels = distribution.map(d => `${d.count} Land${d.count !== 1 ? 's' : ''}`);
    const data = distribution.map(d => d.probability * 100);
    
    // Highlight the most likely outcome
    const maxProb = Math.max(...data);
    const backgroundColors = data.map(p => p === maxProb ? '#65a30d' : 'rgba(101, 163, 13, 0.4)');

    chart = createOrUpdateChart(chart, 'lumra-chart', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Probability (%)',
                data,
                backgroundColor: backgroundColors,
                borderColor: '#65a30d',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Probability (%)', color: '#65a30d' },
                    grid: { color: 'rgba(101, 163, 13, 0.2)' },
                    ticks: { color: '#65a30d' }
                },
                x: {
                    grid: { color: 'rgba(101, 163, 13, 0.2)' },
                    ticks: { color: '#a09090' }
                }
            },
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
 * Update stats panel
 */
function updateStats(config, expectedMilled, totalReturned) {
    const statsPanel = document.getElementById('lumra-stats');
    
    if (statsPanel) {
        // Interpretation
        let interpretation, color;
        // Arbitrary thresholds for "good" Lumra value
        // 6 mana for a big body + ramp.
        // If you get back 4+ lands, that's insane ramp.
        if (totalReturned >= 5) {
            interpretation = `<strong style="color: #65a30d;">Massive Value!</strong> Returning ${formatNumber(totalReturned, 1)} lands is game-changing.`;
            color = '#65a30d';
        } else if (totalReturned >= 3) {
            interpretation = `<strong style="color: #84cc16;">Solid Value.</strong> Good ramp and a decent body.`;
            color = '#84cc16';
        } else {
            interpretation = `<strong style="color: #f59e0b;">Moderate Value.</strong> Consider filling your graveyard more.`;
            color = '#f59e0b';
        }

        const cardsHTML = [
            renderStatCard('Expected Milled', formatNumber(expectedMilled, 2), `lands from top ${4 * config.multiplier}`, '#84cc16'),
            renderStatCard('Total Returned', formatNumber(totalReturned, 1), 'lands to battlefield', '#65a30d'),
            renderStatCard('Lands in Deck', config.landCount, `${((config.landCount/config.deckSize)*100).toFixed(0)}% density`, '#a09090'),
            renderStatCard('Graveyard', config.gyLands, 'lands before cast', '#a09090')
        ];

        statsPanel.innerHTML = `
            ${renderInsightBox(`🐻 Lumra Analysis`, '', '')}
            ${renderStatsGrid(cardsHTML)}
            ${renderInsightBox('', interpretation, `Based on ${config.landCount} lands in ${config.deckSize} cards.`)}
        `;
    }
}

/**
 * Run sample Lumra simulations
 * @param {Object} [passedConfig] - Optional config object to avoid re-fetching
 */
export function runSampleReveals(passedConfig) {
    const config = passedConfig || getDeckConfig();
    const cardData = config.cardData;

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        document.getElementById('lumra-reveals-display').innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('lumra-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || 20);
    
    // Ensure we have stable samples
    if (stableSamples.length < numSims) {
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
    }

    const millAmount = 4 * config.multiplier;

    // 1. STATS LOOP (Full Simulation)
    let totalLandsMilled = 0;
    let totalLandsReturned = 0;
    // Map of land count -> frequency
    const landDistribution = {}; 
    let maxLandsFound = 0;

    for (let i = 0; i < numSims; i++) {
        const shuffled = stableSamples[i];
        
        // Optimized counting loop (avoids array allocation for statistics)
        let landCount = 0;
        // Safety check for deck size smaller than mill amount
        const limit = Math.min(millAmount, shuffled.length);
        
        for (let j = 0; j < limit; j++) {
            const card = shuffled[j];
            if (card.types && card.types.includes('land')) {
                landCount++;
            }
        }
        
        totalLandsMilled += landCount;
        totalLandsReturned += (config.gyLands + landCount);
        landDistribution[landCount] = (landDistribution[landCount] || 0) + 1;
        if (landCount > maxLandsFound) maxLandsFound = landCount;
    }

    // Convert map to array for chart
    const distributionArray = new Array(maxLandsFound + 1).fill(0);
    for (const [count, freq] of Object.entries(landDistribution)) {
        distributionArray[parseInt(count)] = freq;
    }

    // 2. Build Summary UI (Distribution Chart)
    const avgLands = (totalLandsMilled / numSims).toFixed(2);
    const avgReturned = (totalLandsReturned / numSims).toFixed(2);
    
    let distributionHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md);">';
    distributionHTML += '<h4 style="margin-top: 0;">Land Count Distribution (Sampler):</h4>';
    distributionHTML += renderDistributionChart(
        distributionArray,
        numSims,
        (count) => `${count} land${count !== 1 ? 's' : ''}`,
        (idx) => (idx === 0 ? ' ⚠️' : (idx >= 4 ? ' 🔥' : '')) 
    );

    distributionHTML += `<div style="margin-top: var(--spacing-md); text-align: center; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">`;
    distributionHTML += `<div><small style="color:var(--text-dim)">Avg Milled</small><br><strong>${avgLands}</strong></div>`;
    distributionHTML += `<div><small style="color:var(--text-dim)">Avg Returned</small><br><strong style="color: var(--lumra-primary);">${avgReturned}</strong></div>`;
    distributionHTML += '</div></div>';

    // 3. Prepare List Container
    const listId = 'lumra-samples-list';
    const btnId = 'lumra-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Sample Mills (Mill ${millAmount})`,
        listHTML,
        true
    );

    document.getElementById('lumra-reveals-display').innerHTML = distributionHTML + revealsSectionHTML;

    // 4. Render Batch Function
    const listContainer = document.getElementById(listId);
    const loadMoreBtn = document.getElementById(btnId);
    renderedCount = 0;

    const renderBatch = (batchSize) => {
        const start = renderedCount;
        const end = Math.min(start + batchSize, numSims);
        let html = '';

        for (let i = start; i < end; i++) {
            const shuffled = stableSamples[i];

            // Count lands efficiently without creating intermediate array
            let landCount = 0;
            const limit = Math.min(millAmount, shuffled.length);
            for (let j = 0; j < limit; j++) {
                if (shuffled[j].types && shuffled[j].types.includes('land')) {
                    landCount++;
                }
            }

            const totalReturned = config.gyLands + landCount;
            const isGood = landCount >= (2 * config.multiplier);

            html += `<div class="sample-reveal ${isGood ? 'free-spell' : 'whiff'}">`;
            html += `<div><strong>Sample ${i + 1}:</strong> Milled ${landCount} land${landCount !== 1 ? 's' : ''} (Total Return: ${totalReturned})</div>`;
            html += '<div style="margin: 8px 0;">';

            // Render cards
            for (let j = 0; j < limit; j++) {
                const card = shuffled[j];
                const isLand = card.types && card.types.includes('land');
                const color = isLand ? '#65a30d' : '#333';
                const textColor = isLand ? '#fff' : '#aaa';
                html += `<span class="reveal-card" style="background: ${color}; color: ${textColor};">${card.name}</span>`;
            }

            html += '</div></div>';
        }

        if (listContainer) {
            listContainer.insertAdjacentHTML('beforeend', html);
        }
        
        renderedCount = end;
        
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

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => renderBatch(50));
    }
}

// Debounced version of sample generator for UI updates
const runSampleRevealsDebounced = debounce(runSampleReveals, 300);

/**
 * Update all UI elements
 */
export function updateUI() {
    const { config, distribution, expectedMilled, totalReturned } = calculate();

    if (!distribution) {
        if (chart) chart.destroy();
        return;
    }

    updateChart(config, distribution);
    updateStats(config, expectedMilled, totalReturned);

    // Run samples if we have data (debounced for performance)
    if (config.cardData && config.cardData.cardsByName) {
        runSampleRevealsDebounced(config);
    }
    
    // Update dynamic headers
    const millAmount = 4 * config.multiplier;
    const chartHeader = document.getElementById('lumra-chart-header');
    if (chartHeader) {
        chartHeader.textContent = `📈 Lands Milled Distribution (Mill ${millAmount})`;
    }
    
    // Update sample reveals header if it exists
    const samplesHeader = document.querySelector('#lumra-reveals-display .collapsible-header h3');
    if (samplesHeader) {
        // Only update the text part, keep the collapse icon if it's there (usually handled by CSS or separate span)
        // The collapsible component structure: <h3>Title <span class="collapse-icon">...</span></h3>
        // We need to be careful not to wipe the icon if it's inside the h3. 
        // Let's check createCollapsibleSection in sampleSimulator.js...
        // It creates: <div class="collapsible-header"><h3>${title}</h3><span...>...</span></div>
        // So safe to update textContent of h3? No, h3 contains just text.
        
        // However, we are re-generating the whole section in runSampleReveals.
        // We just need to make sure runSampleReveals uses the correct title.
    }
}

/**
 * Initialize Lumra calculator
 */
export function init() {
    registerCalculator({
        name: 'lumra',
        calculate,
        updateUI,
        init: () => {
            const container = document.getElementById('lumra-sample-reveals');
            if (container) {
                // Initial render with default text, will be updated by updateUI/runSampleReveals
                container.innerHTML = generateSampleRevealsHTML('lumra', 'Sample Mill 4');
            }
            const btn = document.getElementById('lumra-draw-reveals-btn');
            if (btn) btn.addEventListener('click', refreshSamples);
            
            // Sync slider and input
            const slider = document.getElementById('lumra-gySlider');
            const number = document.getElementById('lumra-gyLands');
            
            if (slider && number) {
                slider.addEventListener('input', () => {
                    number.value = slider.value;
                    updateUI();
                });
                number.addEventListener('input', () => {
                    slider.value = number.value;
                    updateUI();
                });
            }

            // Sync multiplier slider and input
            const multSlider = document.getElementById('lumra-multSlider');
            const multNumber = document.getElementById('lumra-multiplier');
            
            if (multSlider && multNumber) {
                multSlider.addEventListener('input', () => {
                    multNumber.value = multSlider.value;
                    updateUI();
                });
                multNumber.addEventListener('input', () => {
                    multSlider.value = multNumber.value;
                    updateUI();
                });
            }
        }
    });
}
