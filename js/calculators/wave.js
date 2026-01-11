/**
 * Genesis Wave Calculator
 * Simulates permanents played with Genesis Wave for X
 */

import { createCache, partialShuffle, formatNumber, debounce } from '../utils/simulation.js';
import { renderMultiColumnTable } from '../utils/tableUtils.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';

import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, renderDistributionChart,
    createCollapsibleSection
} from '../utils/sampleSimulator.js';

const CONFIG = {
    // ITERATIONS removed, using math formula
    X_RANGE_BEFORE: 4,
    X_RANGE_AFTER: 4,
    DEFAULT_SAMPLE_SIZE: 10
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
    // For Genesis Wave, we need full shuffles because X can be large (up to deck size).
    for (let i = 0; i < Math.max(count, CONFIG.DEFAULT_SAMPLE_SIZE); i++) {
        stableSamples.push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh of stable samples (e.g., when user clicks Redraw)
 */
function refreshSamples() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        const countInput = document.getElementById('wave-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
        runSampleReveals(); // Re-render
    }
}

/**
 * Create a hash for the distribution object
 * @param {Object} dist - Distribution object (CMC -> count)
 * @returns {string} - Hash string
 */
function hashDistribution(dist) {
    return Object.entries(dist)
        .sort((a, b) => {
            if (a[0] === 'nonperm') return 1;
            if (b[0] === 'nonperm') return -1;
            return Number(a[0]) - Number(b[0]);
        })
        .map(([k, v]) => `${k}:${v}`)
        .join('|');
}

/**
 * Simulate Genesis Wave using Expected Value (Linearity of Expectation)
 * E = X * (ValidPerms / DeckSize)
 * 
 * @param {number} deckSize - Total cards in library
 * @param {Object} distribution - Map of CMC (or 'nonperm') to count
 * @param {number} x - X value (cards to reveal)
 * @returns {Object} - Simulation results
 */
export function simulateGenesisWave(deckSize, distribution, x) {
    const cacheKey = `${deckSize}-${x}-${hashDistribution(distribution)}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    // Calculate count of valid permanents (CMC <= X)
    let validPermanentsCount = 0;
    
    for (const [key, count] of Object.entries(distribution)) {
        if (key === 'nonperm') continue;
        const cmc = parseInt(key);
        if (!isNaN(cmc) && cmc <= x) {
            validPermanentsCount += (count || 0);
        }
    }

    // Probability of any single card being a valid permanent
    // If deckSize is 0, probability is 0
    const probability = deckSize > 0 ? validPermanentsCount / deckSize : 0;
    
    // Linearity of Expectation: E[Total] = Sum(E[Card_i]) = X * P(Card_i is valid)
    // Capped at validPermanentsCount because you can't hit more perms than exist in the deck
    // Also capped at X (can't hit more than you reveal)
    const expected = Math.min(x, Math.min(validPermanentsCount, x * probability));

    // Refinement: The simple X * P formula works perfectly for replacement.
    // For non-replacement (drawing cards), the expected value is actually exactly the same:
    // E[X] = n * (K/N), where n is sample size, K is successes, N is population.
    // So Expected Value = X * (ValidPerms / DeckSize).
    // The min() caps handle edge cases where X > DeckSize.
    
    // Correct formula for draw size > deck size?
    // You draw min(X, DeckSize).
    const drawCount = Math.min(x, deckSize);
    const resultValue = drawCount * probability;

    const result = {
        expectedPermanents: resultValue
    };

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
    const deckSize = DeckConfig.getDeckSize(true);

    // Distribution map: CMC (number) -> count, plus 'nonperm' -> count
    let distribution = {};
    
    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        // Use actual CMC data from imported cards
        Object.values(cardData.cardsByName).forEach(card => {
            const typeLine = card.type_line.toLowerCase();
            const isPermanent = typeLine.includes('creature') || 
                                typeLine.includes('artifact') || 
                                typeLine.includes('enchantment') || 
                                typeLine.includes('planeswalker') || 
                                typeLine.includes('battle') || 
                                typeLine.includes('land');

            if (!isPermanent) {
                distribution.nonperm = (distribution.nonperm || 0) + card.count;
            } else {
                const cmc = card.cmc !== undefined ? Math.floor(card.cmc) : 0;
                distribution[cmc] = (distribution[cmc] || 0) + card.count;
            }
        });
    } else {
        // Fallback for manual config
        distribution = {
            0: config.lands + config.cmc0,
            2: config.cmc2,
            3: config.cmc3,
            4: config.cmc4,
            5: config.cmc5,
            6: config.cmc6,
            nonperm: config.instants + config.sorceries
        };
    }

    // Clear cache if deck changed
    const newHash = hashDistribution(distribution);
    
    // Check for sample refresh need (simplified hash check)
    if (newHash !== lastDeckHash && cardData && cardData.cardsByName) {
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, 20); // Default size
    }

    if (newHash !== lastDeckHash) {
        simulationCache.clear();
        lastDeckHash = newHash;
    }

    const xSlider = document.getElementById('wave-xSlider');
    if (xSlider) {
        xSlider.max = Math.min(deckSize, 30);
    }

    let totalPerms = 0;
    for (const [k, v] of Object.entries(distribution)) {
        if (k !== 'nonperm') totalPerms += v;
    }
    
    const cmcCounts = {
        lands: distribution[0] || 0,
        nonperm: distribution.nonperm || 0,
    };

    return {
        deckSize,
        x: parseInt(document.getElementById('wave-xValue').value) || 10,
        distribution,
        cmcCounts,
        totalPerms,
        cardData
    };
}

/**
 * Calculate results for current deck configuration
 * @returns {Object} - Calculation results
 */
export function calculate() {
    const config = getDeckConfig();

    if (config.deckSize === 0) {
        return { config, results: {} };
    }

    const results = {};
    const minX = Math.max(1, config.x - CONFIG.X_RANGE_BEFORE);
    const maxX = Math.min(config.x + CONFIG.X_RANGE_AFTER, config.deckSize);

    for (let testX = minX; testX <= maxX; testX++) {
        const sim = simulateGenesisWave(config.deckSize, config.distribution, testX);
        results[testX] = {
            expectedPermanents: sim.expectedPermanents,
            cardsRevealed: testX
        };
    }

    return { config, results };
}

/**
 * Update chart visualization
 */
function updateChart(config, results) {
    const xValues = Object.keys(results).map(Number).sort((a, b) => a - b);
    const expectedPermsData = xValues.map(x => results[x].expectedPermanents);
    const cardsRevealedData = xValues.map(x => results[x].cardsRevealed);

    chart = createOrUpdateChart(chart, 'wave-chart', {
        type: 'line',
        data: {
            labels: xValues.map(x => 'X=' + x),
            datasets: [
                {
                    label: 'Expected Permanents',
                    data: expectedPermsData,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#38bdf8'),
                    yAxisID: 'y'
                },
                {
                    label: 'Cards Revealed',
                    data: cardsRevealedData,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#22c55e'),
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            scales: {
                y: {
                    type: 'linear',
                    beginAtZero: true,
                    title: { display: true, text: 'Count', color: '#38bdf8' },
                    grid: { color: 'rgba(14, 165, 233, 0.2)' },
                    ticks: { color: '#38bdf8', stepSize: 1 }
                },
                x: {
                    grid: { color: 'rgba(14, 165, 233, 0.2)' },
                    ticks: { color: '#a09090' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.datasetIndex === 0 ? `Permanents: ${ctx.parsed.y.toFixed(2)}` : `Cards: ${ctx.parsed.y}`
                    }
                }
            }
        }
    });
}

/**
 * Update comparison table
 */
function updateTable(config, results) {
    const xValues = Object.keys(results).map(Number).sort((a, b) => a - b);
    const currentResult = results[config.x];

    const headers = ['X', 'Cards Revealed', 'Expected Perms', 'Δ Perms', 'Efficiency'];
    
    const rows = xValues.map(x => {
        const r = results[x];
        const deltaPerms = r.expectedPermanents - currentResult.expectedPermanents;
        const efficiency = (r.expectedPermanents / r.cardsRevealed) * 100;
        const isBaseline = x === config.x;
        const deltaClass = deltaPerms > 0.01 ? 'marginal-positive' : (deltaPerms < -0.01 ? 'marginal-negative' : '');

        return {
            cells: [
                x,
                r.cardsRevealed,
                formatNumber(r.expectedPermanents),
                { value: isBaseline ? '-' : (deltaPerms >= 0 ? '+' : '') + formatNumber(deltaPerms), class: deltaClass },
                formatNumber(efficiency, 1) + '%'
            ],
            class: isBaseline ? 'current' : ''
        };
    });

    renderMultiColumnTable('wave-comparisonTable', headers, rows, {
        highlightRowIndex: xValues.indexOf(config.x)
    });
}

/**
 * Update stats panel with current X analysis using standard components
 */
function updateStats(config, results) {
    const statsPanel = document.getElementById('wave-stats');
    const currentResult = results[config.x];

    if (statsPanel && currentResult) {
        const efficiency = (currentResult.expectedPermanents / currentResult.cardsRevealed) * 100;
        const totalPerms = config.deckSize - config.cmcCounts.nonperm;
        const permPercent = (totalPerms / config.deckSize) * 100;

        // Create interpretation message
        let interpretation, color;
        if (efficiency >= 70) {
            interpretation = `<strong style="color: #22c55e;">Excellent!</strong> Very efficient conversion rate.`;
            color = '#22c55e';
        } else if (efficiency >= 60) {
            interpretation = `<strong style="color: #38bdf8;">Good!</strong> Solid permanent density.`;
            color = '#38bdf8';
        } else if (efficiency >= 50) {
            interpretation = `<strong style="color: #f59e0b;">Decent.</strong> Consider adding more permanents.`;
            color = '#f59e0b';
        } else {
            interpretation = `<strong style="color: #dc2626;">Low efficiency.</strong> Too many instants/sorceries.`;
            color = '#dc2626';
        }

        const cardsHTML = [
            renderStatCard('Cards Revealed', currentResult.cardsRevealed, `at X=${config.x}`),
            renderStatCard('Expected Perms', formatNumber(currentResult.expectedPermanents, 1), 'played for free', '#38bdf8'),
            renderStatCard('Efficiency', formatNumber(efficiency, 1) + '%', 'hits are permanents', '#22c55e'),
            renderStatCard('Deck Composition', totalPerms, `${formatNumber(permPercent, 0)}% permanents`, '#f59e0b')
        ];

        const footer = `• Average ${formatNumber(currentResult.expectedPermanents, 1)} permanents per cast<br>• Reveals ${currentResult.cardsRevealed} cards (${formatNumber((currentResult.cardsRevealed / config.deckSize) * 100, 1)}% of deck)`;

        statsPanel.innerHTML = `
            ${renderInsightBox(`🌊 Genesis Wave X=${config.x} Analysis`, '', '')}
            ${renderStatsGrid(cardsHTML)}
            ${renderInsightBox('', interpretation, footer)}
        `;
    }
}

// ... (updateComparison and runSampleReveals remain unchanged) ...
/**
 * Update comparison with Primal Surge
 * @param {Object} config - Deck configuration
 * @param {Object} results - Calculation results
 */
function updateComparison(config, results) {
    const comparisonPanel = document.getElementById('wave-comparison-panel');
    const comparisonInsight = document.getElementById('wave-comparison-insight');

    if (config.x >= 7) {
        // Import surge simulator to compare
        import('./surge.js').then(surgeModule => {
            // Use pre-calculated totalPerms if available, otherwise sum buckets (legacy fallback)
            const totalPermanents = config.totalPerms !== undefined 
                ? config.totalPerms 
                : (config.cmcCounts.lands + config.cmcCounts.cmc0 +
                   config.cmcCounts.cmc2 + config.cmcCounts.cmc3 +
                   config.cmcCounts.cmc4 + config.cmcCounts.cmc5 +
                   config.cmcCounts.cmc6);
                   
            const nonPermanents = config.cmcCounts.nonperm;

            const surgeResult = surgeModule.simulatePrimalSurge(config.deckSize, nonPermanents, totalPermanents);
            const waveResult = results[config.x];

            const waveBetter = waveResult.expectedPermanents > surgeResult.expectedPermanents;
            const difference = Math.abs(waveResult.expectedPermanents - surgeResult.expectedPermanents);
            const percentDiff = ((difference / surgeResult.expectedPermanents) * 100).toFixed(1);

            if (comparisonPanel) {
                comparisonPanel.style.display = 'block';
            }
            if (comparisonInsight) {
                comparisonInsight.innerHTML = `
                    <h3>Comparison at 10 Mana</h3>
                    <p>
                        <strong>Genesis Wave X=${config.x} (${config.x + 3} mana):</strong> ${formatNumber(waveResult.expectedPermanents)} expected permanents<br>
                        <strong>Primal Surge (10 mana):</strong> ${formatNumber(surgeResult.expectedPermanents)} expected permanents<br><br>
                        ${waveBetter
                            ? `<span class="marginal-positive">✓ Genesis Wave X=${config.x} is better by ${formatNumber(difference)} permanents (${percentDiff}% more)</span>`
                            : `<span class="marginal-negative">✗ Primal Surge is better by ${formatNumber(difference)} permanents (${percentDiff}% more)</span>`
                        }
                    </p>
                `;
            }
        });
    } else {
        const comparisonPanel = document.getElementById('wave-comparison-panel');
        if (comparisonPanel) {
            comparisonPanel.style.display = 'none';
        }
    }
}

/**
 * Run sample Genesis Wave simulations and display them
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        document.getElementById('wave-reveals-display').innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    // Get number of simulations from input (no cap)
    const countInput = document.getElementById('wave-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || 10);

    // Build deck if needed
    const deck = buildDeckFromCardData(cardData);
    
    // Ensure we have stable samples
    if (stableSamples.length < numSims) {
        generateStableSamples(deck, numSims);
    }

    // 1. STATS LOOP (Full Simulation)
    let totalPermanents = 0;
    const permanentDistribution = new Array(config.x + 1).fill(0);

    for (let i = 0; i < numSims; i++) {
        // Use stable sample
        const shuffled = stableSamples[i];

        // Reveal X cards
        const revealed = shuffled.slice(0, config.x);

        // Count permanents (Genesis Wave: all permanents with CMC <= X go to battlefield)
        const permanentsToBattlefield = [];

        revealed.forEach(card => {
            // A card is a permanent if it has any permanent type, regardless of other types (e.g. Adventures are permanents)
            const hasPermanentType = card.types.some(t => 
                ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].includes(t)
            );
            
            if (hasPermanentType) {
                // Check if CMC <= X (Genesis Wave only puts permanents with CMC <= X onto battlefield)
                const cmc = card.cmc !== undefined ? card.cmc : 0;
                if (cmc <= config.x) {
                    permanentsToBattlefield.push(card);
                }
            }
        });

        const permanentCount = permanentsToBattlefield.length;
        totalPermanents += permanentCount;
        permanentDistribution[permanentCount]++;
    }

    // 2. Build Summary UI
    const avgPermanents = (totalPermanents / numSims).toFixed(2);
    const avgPercent = ((avgPermanents / config.x) * 100).toFixed(1);

    let distributionHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md);">';
    distributionHTML += '<h4 style="margin-top: 0;">Permanent Distribution:</h4>';
    distributionHTML += renderDistributionChart(
        permanentDistribution,
        numSims,
        (count) => `${count.toString().padStart(2)} permanents`,
        (idx) => (idx === config.x && permanentDistribution[idx] > 0) ? ' ← 100% HITS' : ''
    );

    distributionHTML += `<div style="margin-top: var(--spacing-md); text-align: center;">`;
    distributionHTML += `<strong>Average permanents:</strong> ${avgPermanents} out of ${config.x} revealed (${avgPercent}%)`;
    distributionHTML += '</div></div>';

    // 3. Prepare List Container
    const listId = 'wave-samples-list';
    const btnId = 'wave-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Reveals (${numSims} simulations)`,
        listHTML,
        true
    );

    document.getElementById('wave-reveals-display').innerHTML = distributionHTML + revealsSectionHTML;

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
            const revealed = shuffled.slice(0, config.x);

            const permanentsToBattlefield = [];
            const permanentsToGraveyard = [];
            const nonPermanents = [];

            revealed.forEach(card => {
                const hasPermanentType = card.types.some(t => 
                    ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].includes(t)
                );
                
                if (!hasPermanentType) {
                    nonPermanents.push(card);
                } else {
                    const cmc = card.cmc !== undefined ? card.cmc : 0;
                    if (cmc <= config.x) {
                        permanentsToBattlefield.push(card);
                    } else {
                        permanentsToGraveyard.push(card);
                    }
                }
            });

            const permanentCount = permanentsToBattlefield.length;

            html += `<div class="sample-reveal ${permanentCount > 0 ? 'free-spell' : 'whiff'}">`;
            html += `<div><strong>Reveal ${i + 1} (X=${config.x}):</strong></div>`;
            html += '<div style="margin: 8px 0;">';

            revealed.forEach(card => {
                const hasPermanentType = card.types.some(t => 
                    ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].includes(t)
                );
                const cmc = card.cmc !== undefined ? card.cmc : 0;

                let bgColor = '';
                let textColor = '#fff';
                if (!hasPermanentType) {
                    bgColor = '#3b82f6';
                } else if (cmc <= config.x) {
                    bgColor = '#22c55e';
                    textColor = '#000';
                } else {
                    bgColor = '#dc2626';
                }

                html += `<span class="reveal-card" style="background: ${bgColor}; color: ${textColor};" title="${card.type_line} - CMC: ${cmc}">${card.name}</span>`;
            });

            html += '</div>';
            html += `<div class="reveal-summary">`;
            html += `<strong>Result:</strong> ${permanentCount} permanent${permanentCount !== 1 ? 's' : ''} to battlefield`;

            const toGraveyard = nonPermanents.length + permanentsToGraveyard.length;
            if (toGraveyard > 0) {
                html += `, ${toGraveyard} to graveyard`;
                if (permanentsToGraveyard.length > 0) {
                    html += ` (${permanentsToGraveyard.length} high-CMC permanent${permanentsToGraveyard.length !== 1 ? 's' : ''})`;
                }
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
    const { config, results } = calculate();

    if (config.deckSize === 0 || Object.keys(results).length === 0) {
        if (chart) chart.destroy();
        document.getElementById('wave-comparisonTable').innerHTML = '';
        return;
    }

    updateChart(config, results);
    updateStats(config, results);
    updateTable(config, results);
    updateComparison(config, results);

    // Draw initial sample reveals if we have card data
    if (config.cardData && config.cardData.cardsByName && Object.keys(config.cardData.cardsByName).length > 0) {
        runSampleReveals();
    }
}

/**
 * Initialize Wave calculator
 */
export function init() {
    registerCalculator({
        name: 'wave',
        calculate,
        updateUI,
        inputs: ['x'],
        init: () => {
            const container = document.getElementById('wave-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('wave', 'Sample Genesis Wave Reveals');
            }
            const btn = document.getElementById('wave-draw-reveals-btn');
            // Use refreshSamples
            if (btn) btn.addEventListener('click', refreshSamples);
        }
    });
}