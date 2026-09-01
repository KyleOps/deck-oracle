/**
 * Lumra, Bellow of the Woods Calculator
 * Simulates mill 4 and land return triggers
 */

import { drawType } from '../utils/hypergeometric.js';
import { createCache, formatNumber, debounce } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderVerdictBadge, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';
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
    const backgroundColors = data.map(p => p === maxProb ? '#7d8f6a' : 'rgba(139, 156, 120, 0.4)');

    chart = createOrUpdateChart(chart, 'lumra-chart', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Probability (%)',
                data,
                backgroundColor: backgroundColors,
                borderColor: '#7d8f6a',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Probability (%)', color: '#7d8f6a' },
                    grid: { color: 'rgba(139, 156, 120, 0.2)' },
                    ticks: { color: '#7d8f6a' }
                },
                x: {
                    grid: { color: 'rgba(139, 156, 120, 0.2)' },
                    ticks: { color: TX.dim, font: { size: 9 } }
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
    
    if (!statsPanel) return;

    // Verdict tier from total lands returned to the battlefield
    let verdict;
    if (totalReturned >= 5) verdict = { label: 'MASSIVE', color: 'var(--tx-green)', advice: `Returning ${formatNumber(totalReturned, 1)} lands is game-changing ramp.` };
    else if (totalReturned >= 3) verdict = { label: 'SOLID', color: 'var(--tx-green)', advice: 'Good ramp and a sizeable body.' };
    else verdict = { label: 'MODERATE', color: 'var(--tx-amber)', advice: 'Fill your graveyard more to grow the bear.' };

    const density = config.deckSize > 0 ? (config.landCount / config.deckSize) * 100 : 0;

    const hero = renderHeroStats([
        { label: 'LANDS RETURNED', value: formatNumber(totalReturned, 1), sub: 'onto the battlefield', color: 'var(--tx-green)', size: 'big' },
        { label: 'MILLED LANDS', value: formatNumber(expectedMilled, 2), sub: `from top ${4 * config.multiplier}`, color: 'var(--tx-amber)' },
        { label: 'LAND DENSITY', value: `${density.toFixed(0)}%`, sub: `${config.landCount} of ${config.deckSize}`, color: 'var(--tx-blue)' },
        { label: 'GRAVEYARD', value: config.gyLands, sub: 'lands before cast', color: 'var(--tx-mid)' }
    ]);

    const insight = renderInsightBox('', `Lumra mills ${4 * config.multiplier} and returns every land milled plus those already in your graveyard. ${renderVerdictBadge(verdict)} ${verdict.advice}`);

    statsPanel.innerHTML = hero + insight;
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
    
    let distributionHTML = '<div class="tx-sim">';
    distributionHTML += '<div class="tx-h"><span>Lands milled — distribution</span></div>';
    distributionHTML += '<div class="tx-sim-block">';

    distributionHTML += renderDistributionChart(
        distributionArray,
        numSims,
        (count) => `${count} land${count !== 1 ? 's' : ''}`,
        (idx) => (idx === 0 ? ' ✗' : (idx >= 4 ? ' ▲' : '')) 
    );

    distributionHTML += '</div><div class="tx-sim-block">';
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
                const color = isLand ? 'var(--type-land)' : 'var(--tx-panel-alt)';
                const textColor = isLand ? '#0a0b0a' : 'var(--tx-mid)';
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
        chartHeader.textContent = `Lands Milled Distribution (Mill ${millAmount})`;
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
