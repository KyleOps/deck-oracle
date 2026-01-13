/**
 * Primal Surge Calculator
 * Simulates permanents played with Primal Surge
 */

import { formatNumber, formatPercentage, createCache, debounce } from '../utils/simulation.js';
import { renderMultiColumnTable } from '../utils/tableUtils.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';
import { compareBigSpells, renderComparison } from '../utils/bigSpellComparison.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, renderDistributionChart,
    createCollapsibleSection, extractCardTypes
} from '../utils/sampleSimulator.js';

const CONFIG = {
    // Legacy iterations removed, using formula now
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
    // For Primal Surge, a "sample" is a full run through the deck until we hit a non-permanent.
    // So we need full shuffles.
    
    for (let i = 0; i < Math.max(count, CONFIG.DEFAULT_SAMPLE_SIZE); i++) {
        const shuffled = shuffleDeck([...deck]);
        stableSamples.push(shuffled);
    }
}

/**
 * Calculate Primal Surge Stats mathematically
 * Uses Negative Hypergeometric Distribution mean: E = (N-K)/(K+1)
 * where N = Total Cards, K = Non-Permanents
 * 
 * @param {number} deckSize - Total cards in library
 * @param {number} nonPermanents - Number of non-permanent cards
 * @param {number} permanents - Number of permanent cards
 * @returns {Object} - Simulation results
 */
export function simulatePrimalSurge(deckSize, nonPermanents, permanents) {
    // Check cache first
    const cacheKey = `${deckSize}-${nonPermanents}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    let expectedPermanents;
    
    // Formula: E = P / (NP + 1)
    // where P = permanents count, NP = non-permanents count
    // Logic: The NP cards partition the P cards into NP+1 regions.
    // By symmetry, the expected size of the first region is P / (NP+1).
    expectedPermanents = permanents / (nonPermanents + 1);

    const result = {
        expectedPermanents: expectedPermanents,
        percentOfDeck: (expectedPermanents / deckSize) * 100
    };

    // Cache the result
    simulationCache.set(cacheKey, result);
    return result;
}

/**
 * Get current deck configuration from shared config
 * @returns {Object} - Deck configuration
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();

    // Use shared getDeckSize function to properly handle dual-typed cards
    const deckSize = DeckConfig.getDeckSize(true);  // Include non-permanents

    // For simulation purposes, count instants and sorceries as non-permanents
    const nonPermanents = config.instants + config.sorceries;
    const permanents = deckSize - nonPermanents;

    let lands = 0;
    let totalPermCMC = 0;

    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        Object.values(cardData.cardsByName).forEach(card => {
            const typeLine = (card.type_line || '').toLowerCase();
            const hasPermType = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].some(t => typeLine.includes(t));
            
            if (hasPermType) {
                if (typeLine.includes('land')) {
                    lands += card.count;
                }
                if (card.cmc) {
                    totalPermCMC += card.cmc * card.count;
                }
            }
        });
    } else {
        // Fallback for manual config
        lands = config.lands;
        // Estimate CMC from buckets (using weighted averages)
        totalPermCMC = (config.cmc0 || 0) * 0 +
                       (config.cmc2 || 0) * 2 +
                       (config.cmc3 || 0) * 3 +
                       (config.cmc4 || 0) * 4 +
                       (config.cmc5 || 0) * 5 +
                       (config.cmc6 || 0) * 7;
    }

    const deckHash = `${deckSize}-${nonPermanents}-${permanents}-${lands}-${totalPermCMC}`;
    
    // Check if we need to regenerate samples (only if deck content changed)
    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        // We use a simplified hash for samples to avoid excessive regenerating
        const sampleHash = JSON.stringify({ 
            size: deckSize, 
            np: nonPermanents,
            // Include a random key if we want to force distinct from regular hash, 
            // but here we just want to know if the deck changed.
            // Actually, we can just use the hash from above.
            deckHash
        });

        if (sampleHash !== lastSampleDeckHash) {
            const deck = buildDeckFromCardData(cardData);
            generateStableSamples(deck, 20); // Default stable count
            lastSampleDeckHash = sampleHash;
        }
    }

    // Clear cache if deck changed (for the stats calculation)
    if (deckHash !== lastDeckHash) {
        simulationCache.clear();
        lastDeckHash = deckHash;
    }

    return { deckSize, nonPermanents, permanents, cardData, lands, totalPermCMC };
}

/**
 * Calculate results for current deck configuration
 * @returns {Object} - Calculation results
 */
export function calculate() {
    const config = getDeckConfig();

    if (config.deckSize === 0) {
        return { config, result: null };
    }

    const result = simulatePrimalSurge(config.deckSize, config.nonPermanents, config.permanents);

    return { config, result };
}

/**
 * Update chart visualization
 * @param {Object} config - Deck configuration
 * @param {Object} result - Calculation result
 */
function updateChart(config, result) {
    const nonPermRange = [];
    const expectedPermsData = [];
    const expectedMVData = [];

    const avgMVPerPerm = config.permanents > 0 ? config.totalPermCMC / config.permanents : 0;

    // Show results for different numbers of non-permanents
    const maxNonPerm = Math.min(20, Math.floor(config.deckSize * 0.3));
    for (let i = 0; i <= maxNonPerm; i++) {
        const sim = simulatePrimalSurge(config.deckSize, i, config.deckSize - i);
        nonPermRange.push(i);
        expectedPermsData.push(sim.expectedPermanents);
        expectedMVData.push(sim.expectedPermanents * avgMVPerPerm);
    }

    chart = createOrUpdateChart(chart, 'surge-chart', {
        type: 'line',
        data: {
            labels: nonPermRange.map(x => x + ' non-perm'),
            datasets: [
                {
                    label: 'Expected Permanents',
                    data: expectedPermsData,
                    borderColor: '#4ade80',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: nonPermRange.map(x => x === config.nonPermanents ? 8 : 4),
                    pointBackgroundColor: nonPermRange.map(x => x === config.nonPermanents ? '#fff' : '#4ade80'),
                    yAxisID: 'yPerms'
                },
                {
                    label: 'Expected Total Mana Value',
                    data: expectedMVData,
                    borderColor: '#c084fc',
                    backgroundColor: 'rgba(192, 132, 252, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: nonPermRange.map(x => x === config.nonPermanents ? 8 : 4),
                    pointBackgroundColor: nonPermRange.map(x => x === config.nonPermanents ? '#fff' : '#c084fc'),
                    yAxisID: 'yMV'
                }
            ]
        },
        options: {
            scales: {
                yPerms: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Expected Permanents', color: '#4ade80' },
                    grid: { color: 'rgba(34, 197, 94, 0.2)' },
                    ticks: { color: '#4ade80' }
                },
                yMV: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Total Mana Value', color: '#c084fc' },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#c084fc' }
                },
                x: {
                    grid: { color: 'rgba(34, 197, 94, 0.2)' },
                    ticks: { color: '#a09090' }
                }
            }
        }
    });
}

/**
 * Update stats panel (replacing the old table)
 */
function updateStatsPanel(config, result) {
    const avgLands = config.permanents > 0 ? result.expectedPermanents * (config.lands / config.permanents) : 0;
    const avgCMC = config.permanents > 0 ? result.expectedPermanents * (config.totalPermCMC / config.permanents) : 0;
    const playDeckProb = config.nonPermanents === 0 ? 1 : 1 / config.deckSize;

    // Create interpretation
    let interpretation = '';
    if (result.expectedPermanents > 40) {
        interpretation = `<strong style="color: #22c55e;">Game Winning!</strong> You will likely play half your deck or more.`;
    } else if (result.expectedPermanents > 20) {
        interpretation = `<strong style="color: #4ade80;">Massive Value.</strong> Expect a board state explosion.`;
    } else if (result.expectedPermanents > 10) {
        interpretation = `<strong style="color: #f59e0b;">Solid.</strong> Good return on investment for 10 mana.`;
    } else {
        interpretation = `<strong style="color: #dc2626;">Risky.</strong> High chance of hitting a non-permanent early.`;
    }

    const cardsHTML = [
        renderStatCard('Expected Permanents', formatNumber(result.expectedPermanents, 1), `avg per cast`, '#4ade80'),
        renderStatCard('Avg Lands', formatNumber(avgLands, 1), 'put onto battlefield', '#a3e635'),
        renderStatCard('Avg Mana Value', formatNumber(avgCMC, 1), 'total mana cheated', '#c084fc'),
        renderStatCard('Deck Played', formatNumber(result.percentOfDeck, 1) + '%', `${config.nonPermanents} non-permanents in deck`, result.percentOfDeck > 50 ? '#22c55e' : '#f59e0b')
    ];

    // Use the stats table container for the new grid layout
    const tableElement = document.getElementById('surge-statsTable');
    const container = tableElement ? tableElement.parentNode : document.getElementById('surge-stats'); 
    
    // Actually, let's just replace the table's parent content
    if (container) {
        container.innerHTML = `
            ${renderInsightBox('🌿 Primal Surge Analysis', interpretation, '')}
            ${renderStatsGrid(cardsHTML)}
            <div style="margin-top: 12px; color: var(--text-dim); font-size: 0.9em; text-align: center;">
                Chance to play entire deck: <strong>${config.nonPermanents === 0 ? '100%' : formatPercentage(playDeckProb, 2)}</strong>
            </div>
        `;
    }
}

/**
 * Update comparison with Genesis Wave
 * @param {Object} config - Deck configuration
 * @param {Object} result - Calculation result
 */
function updateComparison(config, result) {
    // Import wave simulator to compare
    import('./wave.js').then(waveModule => {
        const waveResult = waveModule.simulateGenesisWave(config.deckSize, {
            cmc0: 0, cmc2: 0, cmc3: 0, cmc4: 0, cmc5: 0, cmc6: 0,
            lands: config.permanents,
            nonperm: config.nonPermanents
        }, 7);

        if (waveResult) {
            const surgeBetter = result.expectedPermanents > waveResult.expectedPermanents;
            const difference = Math.abs(result.expectedPermanents - waveResult.expectedPermanents);
            const percentDiff = ((difference / waveResult.expectedPermanents) * 100).toFixed(1);

            const comparisonPanel = document.getElementById('surge-comparison-panel');
            const comparisonInsight = document.getElementById('surge-comparison-insight');

            if (comparisonPanel) {
                comparisonPanel.style.display = 'block';
            }
            if (comparisonInsight) {
                const content = `
                    <p>
                        <strong>Primal Surge (10 mana):</strong> ${formatNumber(result.expectedPermanents)} expected permanents<br>
                        <strong>Genesis Wave X=7 (10 mana):</strong> ${formatNumber(waveResult.expectedPermanents)} expected permanents<br><br>
                        ${surgeBetter
                            ? `<span class="marginal-positive">✓ Primal Surge is better by ${formatNumber(difference)} permanents (${percentDiff}% more)</span>`
                            : `<span class="marginal-negative">✗ Genesis Wave X=7 is better by ${formatNumber(difference)} permanents (${percentDiff}% more)</span>`
                        }
                    </p>
                `;
                comparisonInsight.innerHTML = renderInsightBox('Comparison at 10 Mana', content);
            }
        } else {
            const comparisonPanel = document.getElementById('surge-comparison-panel');
            if (comparisonPanel) {
                comparisonPanel.style.display = 'none';
            }
        }
    });
}

/**
 * Force refresh of stable samples (e.g., when user clicks Redraw)
 */
function refreshSamples() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        const countInput = document.getElementById('surge-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
        runSampleReveals(); // Re-render
    }
}

/**
 * Run sample Primal Surge simulations and display them
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        document.getElementById('surge-reveals-display').innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    // Get number of simulations from input (no cap)
    const countInput = document.getElementById('surge-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || 10);

    // Ensure we have enough samples
    if (stableSamples.length < numSims) {
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
    }

    // 1. STATS LOOP (Full Simulation)
    let totalPermanents = 0;
    let totalManaValue = 0;
    let totalLands = 0;
    const permanentDistribution = new Array(stableSamples[0].length + 1).fill(0);

    for (let i = 0; i < numSims; i++) {
        const shuffled = stableSamples[i];
        let permanentCount = 0;
        let runManaValue = 0;
        let runLands = 0;

        for (let j = 0; j < shuffled.length; j++) {
            const card = shuffled[j];
            const isNonPermanent = card.types.includes('instant') || card.types.includes('sorcery');

            if (isNonPermanent) break;
            
            permanentCount++;
            if (card.cmc) runManaValue += card.cmc;
            if (card.types.includes('land')) runLands++;
        }

        totalPermanents += permanentCount;
        totalManaValue += runManaValue;
        totalLands += runLands;
        permanentDistribution[permanentCount]++;
    }

    // 2. Build Summary UI
    const avgPermanents = (totalPermanents / numSims).toFixed(2);
    const avgMana = (totalManaValue / numSims).toFixed(1);
    const avgLands = (totalLands / numSims).toFixed(1);

    let distributionHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md);">';
    distributionHTML += '<h4 style="margin-top: 0;">Permanent Distribution:</h4>';
    distributionHTML += renderDistributionChart(
        permanentDistribution,
        numSims,
        (count) => `${count.toString().padStart(2)} permanents`,
        (count) => {
            const deckSize = stableSamples[0].length;
            return count === deckSize ? ' ← FULL DECK' : '';
        }
    );

    distributionHTML += `<div style="margin-top: var(--spacing-md); text-align: center;">`;
    distributionHTML += `<strong>Averages:</strong> ${avgPermanents} permanents, ${avgLands} lands, ${avgMana} total CMC`;
    distributionHTML += '</div></div>';

    // 3. Prepare List Container
    const listId = 'surge-samples-list';
    const btnId = 'surge-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Reveals (${numSims} simulations)`,
        listHTML,
        true
    );

    document.getElementById('surge-reveals-display').innerHTML = distributionHTML + revealsSectionHTML;

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
            const revealedCards = [];
            let permanentCount = 0;
            let runManaValue = 0;
            let runLands = 0;

            for (let j = 0; j < shuffled.length; j++) {
                const card = shuffled[j];
                const isNonPermanent = card.types.includes('instant') || card.types.includes('sorcery');

                revealedCards.push({...card, isNonPermanent});

                if (isNonPermanent) break;
                
                permanentCount++;
                if (card.cmc) runManaValue += card.cmc;
                if (card.types.includes('land')) runLands++;
            }

            const hitNonPermanent = revealedCards[revealedCards.length - 1]?.isNonPermanent;
            html += `<div class="sample-reveal ${!hitNonPermanent ? 'free-spell' : 'whiff'}">`;
            html += `<div><strong>Reveal ${i + 1}:</strong> ${permanentCount} perms (${runLands} lands, ${runManaValue} total CMC)</div>`;
            html += '<div style="margin: 8px 0;">';

            revealedCards.forEach(card => {
                const primaryType = card.types[0] || 'land';
                html += renderCardBadge(card, primaryType);
            });

            html += '</div>';
            html += `<div class="reveal-summary ${!hitNonPermanent ? 'free-spell' : 'whiff'}">`;

            if (hitNonPermanent) {
                html += `<strong>⛔ Stopped!</strong>`;
            } else {
                html += `<strong>✓ Full Deck!</strong>`;
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

/**
 * Update all UI elements
 */
export function updateUI() {
    const { config, result } = calculate();

    if (config.deckSize === 0 || !result) {
        if (chart) chart.destroy();
        const surgeComparisonContainer = document.getElementById('big-spell-comparison-surge');
        if (surgeComparisonContainer) surgeComparisonContainer.innerHTML = '';
        return;
    }

    updateChart(config, result);
    updateStatsPanel(config, result);
    updateComparison(config, result);

    // Update big spell comparison (use X=10 as reference since Primal Surge is fixed cost)
    const surgeComparisonContainer = document.getElementById('big-spell-comparison-surge');
    if (surgeComparisonContainer) {
        const comparison = compareBigSpells(10, 'surge');
        surgeComparisonContainer.innerHTML = renderComparison(comparison);
    }

    // Draw initial sample reveals if we have card data
    if (config.cardData && config.cardData.cardsByName && Object.keys(config.cardData.cardsByName).length > 0) {
        runSampleReveals();
    }
}

/**
 * Initialize Surge calculator
 */
export function init() {
    registerCalculator({
        name: 'surge',
        calculate,
        updateUI,
        init: () => {
            const container = document.getElementById('surge-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('surge', 'Sample Primal Surge Reveals');
            }
            const btn = document.getElementById('surge-draw-reveals-btn');
            // Use refreshSamples here
            if (btn) btn.addEventListener('click', refreshSamples);
        }
    });
}