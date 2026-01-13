/**
 * Kamahl's Druidic Vow Calculator
 * Simulates hits for {X}{G}{G} Legendary Sorcery
 * "Look at the top X cards of your library. You may put any number of land and/or legendary permanent cards with mana value X or less from among them onto the battlefield. Put the rest into your graveyard."
 */

import { createCache, partialShuffle, formatNumber } from '../utils/simulation.js';
import { renderMultiColumnTable } from '../utils/tableUtils.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';

import {
    buildDeckFromCardData, shuffleDeck, renderDistributionChart,
    createCollapsibleSection
} from '../utils/sampleSimulator.js';

const CONFIG = {
    X_RANGE_BEFORE: 4,
    X_RANGE_AFTER: 4,
    DEFAULT_SAMPLE_SIZE: 500,
    DEFAULT_X_VALUE: 10,
    SAMPLE_BATCH_SIZE: 50,
    STABLE_SAMPLE_COUNT: 20
};

let simulationCache = createCache(50);
let lastDeckHash = '';
let chart = null;

// Stable samples state
let stableSamples = [];
let renderedCount = 0;

// Card analysis cache (cleared when deck or X changes)
const cardAnalysisCache = new Map();

/**
 * Check if a type line represents a permanent type
 * @param {string} typeLine - Card type line (case-insensitive)
 * @returns {boolean} - True if the card is a permanent type
 */
function isPermanentType(typeLine) {
    if (!typeLine) return false;
    const lower = typeLine.toLowerCase();
    return lower.includes('creature') ||
           lower.includes('artifact') ||
           lower.includes('enchantment') ||
           lower.includes('planeswalker') ||
           lower.includes('battle') ||
           lower.includes('land');
}

/**
 * Analyze card for all display purposes (single source of truth)
 * Cached per card name + X value for performance
 * @param {Object} card - Card object with type_line and cmc
 * @param {number} xValue - X value for CMC comparison
 * @returns {Object} - Comprehensive card analysis
 */
function analyzeCardForDisplay(card, xValue) {
    const cacheKey = `${card.name}-${xValue}`;

    if (cardAnalysisCache.has(cacheKey)) {
        return cardAnalysisCache.get(cacheKey);
    }

    const typeLine = card.type_line || '';
    const lower = typeLine.toLowerCase();
    const cmc = card.cmc !== undefined ? card.cmc : 0;

    const isLand = lower.includes('land');
    const isLegendary = lower.includes('legendary');
    const isPermanent = isPermanentType(typeLine);

    const isValid = isLand || (isLegendary && isPermanent);
    const matchesX = cmc <= xValue;

    const result = {
        isLand,
        isLegendary,
        isPermanent,
        cmc,
        matchesX,
        isValid,
        isHit: isValid && matchesX
    };

    cardAnalysisCache.set(cacheKey, result);
    return result;
}

/**
 * Get display styling for a card in sample reveals
 * @param {Object} analysis - Card analysis from analyzeCardForDisplay()
 * @param {string} cardTypeLine - Original type line for tooltip
 * @returns {Object} - {bgColor, textColor, tooltip}
 */
/**
 * Get display styling for a card in sample reveals
 * 4-color system:
 * 1. Lands (green) - always hit
 * 2. Legends that hit (cyan/blue) - legendary permanents with CMC ≤ X
 * 3. Legends that missed (yellow/orange) - legendary permanents with CMC > X
 * 4. Non-legends (gray/red) - all other cards
 */
function getCardDisplayStyle(analysis, cardTypeLine) {
    const { isLand, isLegendary, isPermanent, matchesX, cmc } = analysis;
    const baseTooltip = `${cardTypeLine} - CMC: ${cmc}`;

    // Color 1: Lands (green) - always hit
    if (isLand) {
        return {
            bgColor: '#22c55e',
            textColor: '#000',
            tooltip: `${baseTooltip} (Land → battlefield)`
        };
    }

    // Color 2: Legends that hit (cyan/blue) - legendary permanents with CMC ≤ X
    if (isLegendary && isPermanent && matchesX) {
        return {
            bgColor: '#3b82f6',
            textColor: '#fff',
            tooltip: `${baseTooltip} (Legendary + CMC ≤ X → battlefield)`
        };
    }

    // Color 3: Legends that missed (yellow/orange) - legendary permanents with CMC > X
    if (isLegendary && isPermanent && !matchesX) {
        return {
            bgColor: '#f59e0b',
            textColor: '#000',
            tooltip: `${baseTooltip} (Legendary but CMC > X → graveyard)`
        };
    }

    // Color 4: Non-legends (gray/red) - everything else
    return {
        bgColor: '#6b7280',
        textColor: '#fff',
        tooltip: `${baseTooltip} (Non-legendary → graveyard)`
    };
}

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
        const countInput = document.getElementById('vow-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
        runSampleReveals();
    }
}

/**
 * Create a hash for the distribution object
 */
function hashDistribution(dist) {
    return Object.entries(dist)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([k, v]) => `${k}:${v}`)
        .join('|');
}

/**
 * Check if a card is a valid hit for Kamahl's Druidic Vow
 * Must be (Land) OR (Legendary AND Permanent)
 * Note: CMC check happens during simulation/calculation against X
 * @param {Object} card
 * @returns {boolean}
 */
function isValidType(card) {
    const typeLine = card.type_line || '';
    const lower = typeLine.toLowerCase();
    const isLand = lower.includes('land');
    const isLegendary = lower.includes('legendary');
    const isPermanent = isPermanentType(typeLine);

    return isLand || (isLegendary && isPermanent);
}

/**
 * Check if a card is a Legendary Permanent (specifically)
 * @param {Object} card
 * @returns {boolean}
 */
function isLegendaryPermanent(card) {
    const typeLine = card.type_line || '';
    const lower = typeLine.toLowerCase();
    const isLegendary = lower.includes('legendary');
    const isPermanent = isPermanentType(typeLine);

    return isLegendary && isPermanent;
}

/**
 * Simulate Kamahl's Druidic Vow using Expected Value
 * @param {number} deckSize
 * @param {Object} distribution - Map of CMC -> count of VALID TYPES only
 * @param {number} x
 * @param {boolean} doubleCast - If true, copy the spell (reveal 2X cards total)
 * @param {Object} cardData - Full card data for detailed breakdown
 */
export function simulateVow(deckSize, distribution, x, doubleCast = false, cardData = null) {
    const multiplier = doubleCast ? 2 : 1;
    const cacheKey = `${deckSize}-${x}-${doubleCast}-${hashDistribution(distribution)}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    let validHitsCount = 0;
    let landCount = 0;
    let legendaryHitsCount = 0;
    let totalManaValue = 0;

    // Calculate breakdown if we have card data
    if (cardData && cardData.cardsByName) {
        Object.values(cardData.cardsByName).forEach(card => {
            const analysis = analyzeCardForDisplay(card, x);
            if (analysis.isValid && analysis.matchesX) {
                validHitsCount += card.count;
                totalManaValue += analysis.cmc * card.count;

                if (analysis.isLand) {
                    landCount += card.count;
                }
                if (analysis.isLegendary && analysis.isPermanent) {
                    legendaryHitsCount += card.count;
                }
            }
        });
    } else {
        // Fallback to simple count from distribution
        for (const [key, count] of Object.entries(distribution)) {
            const cmc = parseInt(key);
            if (!isNaN(cmc) && cmc <= x) {
                validHitsCount += (count || 0);
                totalManaValue += cmc * (count || 0);
            }
        }
    }

    // Probabilities
    const hitProbability = deckSize > 0 ? validHitsCount / deckSize : 0;
    const landProbability = deckSize > 0 ? landCount / deckSize : 0;
    const legendProbability = deckSize > 0 ? legendaryHitsCount / deckSize : 0;
    const avgManaValue = validHitsCount > 0 ? totalManaValue / validHitsCount : 0;

    const cardsRevealed = Math.min(x * multiplier, deckSize);

    const result = {
        expectedHits: cardsRevealed * hitProbability,
        expectedLands: cardsRevealed * landProbability,
        expectedLegends: cardsRevealed * legendProbability,
        expectedManaValue: cardsRevealed * hitProbability * avgManaValue
    };

    simulationCache.set(cacheKey, result);
    return result;
}

/**
 * Get current deck configuration
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();
    const deckSize = DeckConfig.getDeckSize(true);

    // Distribution map: CMC (number) -> count of VALID HITS only
    let distribution = {};
    let totalHits = 0;
    let totalLegendaries = 0;
    let totalPermanents = 0;
    
    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        Object.values(cardData.cardsByName).forEach(card => {
            const isPermanent = isPermanentType(card.type_line);

            if (isPermanent) totalPermanents += card.count;

            if (isValidType(card)) {
                const cmc = card.cmc !== undefined ? Math.floor(card.cmc) : 0;
                distribution[cmc] = (distribution[cmc] || 0) + card.count;
                totalHits += card.count;
            }

            if (isLegendaryPermanent(card)) {
                totalLegendaries += card.count;
            }
        });
    } else {
        // Fallback: assume only Lands are hits if no import
        distribution[0] = config.lands;
        totalHits = config.lands;
        totalPermanents = config.lands + config.creatures + config.artifacts + config.enchantments + config.planeswalkers;
        // Assume 0 legends in manual mode to encourage import
    }

    const newHash = hashDistribution(distribution);
    
    // Check for sample refresh need
    if (newHash !== lastDeckHash && cardData && cardData.cardsByName) {
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, CONFIG.STABLE_SAMPLE_COUNT);
    }

    if (newHash !== lastDeckHash) {
        simulationCache.clear();
        cardAnalysisCache.clear();
        lastDeckHash = newHash;
    }

    const xSlider = document.getElementById('vow-xSlider');
    if (xSlider) {
        xSlider.max = Math.min(deckSize, 30);
    }

    const doubleCastCheckbox = document.getElementById('vow-doubleCast');
    const doubleCast = doubleCastCheckbox ? doubleCastCheckbox.checked : false;

    return {
        deckSize,
        x: parseInt(document.getElementById('vow-xValue').value) || CONFIG.DEFAULT_X_VALUE,
        distribution,
        totalHits,
        totalLegendaries,
        totalPermanents,
        cardData,
        doubleCast
    };
}

/**
 * Calculate results
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
        const sim = simulateVow(config.deckSize, config.distribution, testX, config.doubleCast, config.cardData);
        const multiplier = config.doubleCast ? 2 : 1;
        results[testX] = {
            expectedHits: sim.expectedHits,
            expectedLands: sim.expectedLands,
            expectedLegends: sim.expectedLegends,
            expectedManaValue: sim.expectedManaValue,
            cardsRevealed: testX * multiplier
        };
    }

    return { config, results };
}

/**
 * Update chart visualization
 */
function updateChart(config, results) {
    const xValues = Object.keys(results).map(Number).sort((a, b) => a - b);
    const expectedHitsData = xValues.map(x => results[x].expectedHits);
    const cardsRevealedData = xValues.map(x => results[x].cardsRevealed);

    chart = createOrUpdateChart(chart, 'vow-chart', {
        type: 'line',
        data: {
            labels: xValues.map(x => 'X=' + x),
            datasets: [
                {
                    label: 'Expected Hits',
                    data: expectedHitsData,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#22c55e'),
                    yAxisID: 'y'
                },
                {
                    label: 'Cards Revealed',
                    data: cardsRevealedData,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#38bdf8'),
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            scales: {
                y: {
                    type: 'linear',
                    beginAtZero: true,
                    title: { display: true, text: 'Count', color: '#22c55e' },
                    grid: { color: 'rgba(34, 197, 94, 0.1)' },
                    ticks: { color: '#22c55e', stepSize: 1 }
                },
                x: {
                    grid: { color: 'rgba(160, 144, 144, 0.1)' },
                    ticks: { color: '#a09090' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.datasetIndex === 0 ? `Hits: ${ctx.parsed.y.toFixed(2)}` : `Cards: ${ctx.parsed.y}`
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

    const headers = ['X', 'Cards Revealed', 'Expected Hits', 'Δ Hits', 'Hit Rate'];
    
    const rows = xValues.map(x => {
        const r = results[x];
        const delta = r.expectedHits - currentResult.expectedHits;
        const rate = (r.expectedHits / r.cardsRevealed) * 100;
        const isBaseline = x === config.x;
        const deltaClass = delta > 0.01 ? 'marginal-positive' : (delta < -0.01 ? 'marginal-negative' : '');

        return {
            cells: [
                x,
                r.cardsRevealed,
                formatNumber(r.expectedHits),
                { value: isBaseline ? '-' : (delta >= 0 ? '+' : '') + formatNumber(delta), class: deltaClass },
                formatNumber(rate, 1) + '%'
            ],
            class: isBaseline ? 'current' : ''
        };
    });

    renderMultiColumnTable('vow-comparisonTable', headers, rows, {
        highlightRowIndex: xValues.indexOf(config.x)
    });
}

/**
 * Update stats panel
 */
function updateStats(config, results) {
    const statsPanel = document.getElementById('vow-stats');
    const currentResult = results[config.x];
    const warningPanel = document.getElementById('vow-import-warning');

    // Show warning if no import
    const hasImport = config.cardData && config.cardData.cardsByName && Object.keys(config.cardData.cardsByName).length > 0;
    if (warningPanel) {
        warningPanel.style.display = hasImport ? 'none' : 'block';
    }

    if (statsPanel && currentResult) {
        const legendaryPercent = config.totalPermanents > 0 ? (config.totalLegendaries / config.totalPermanents) * 100 : 0;

        // Use values already calculated by simulateVow() - no redundant calculations
        const expectedLands = currentResult.expectedLands;
        const expectedLegends = currentResult.expectedLegends;

        // Create interpretation message
        let interpretation, color;
        if (legendaryPercent >= 40) {
            interpretation = `<strong style="color: #22c55e;">Excellent!</strong> High legendary density.`;
            color = '#22c55e';
        } else if (legendaryPercent >= 25) {
            interpretation = `<strong style="color: #38bdf8;">Good!</strong> Solid legendary synergy.`;
            color = '#38bdf8';
        } else if (legendaryPercent >= 15) {
            interpretation = `<strong style="color: #f59e0b;">Decent.</strong> Consider adding more legends.`;
            color = '#f59e0b';
        } else {
            interpretation = `<strong style="color: #dc2626;">Low legendary density.</strong> Mostly likely just hitting lands.`;
            color = '#dc2626';
        }

        // Marginal value analysis with detailed breakdown
        const formatMarginal = (compareResult, baseResult) => {
            if (!compareResult || !baseResult) return '<span style="color: var(--text-dim);">N/A</span>';

            const hitsDiff = compareResult.expectedHits - baseResult.expectedHits;
            const landsDiff = compareResult.expectedLands - baseResult.expectedLands;
            const legendsDiff = compareResult.expectedLegends - baseResult.expectedLegends;
            const mvDiff = compareResult.expectedManaValue - baseResult.expectedManaValue;

            const hitsColor = hitsDiff > 0 ? '#22c55e' : '#dc2626';
            const landsColor = landsDiff > 0 ? '#22c55e' : '#dc2626';
            const legendsColor = legendsDiff > 0 ? '#3b82f6' : '#dc2626';

            let result = `<span style="color: ${hitsColor};">${hitsDiff >= 0 ? '+' : ''}${formatNumber(hitsDiff, 2)}</span> total hits`;
            result += ` (<span style="color: ${landsColor};">${landsDiff >= 0 ? '+' : ''}${formatNumber(landsDiff, 2)}</span> lands`;
            result += `, <span style="color: ${legendsColor};">${legendsDiff >= 0 ? '+' : ''}${formatNumber(legendsDiff, 2)}</span> legends`;
            result += `, <span style="color: ${hitsColor};">${mvDiff >= 0 ? '+' : ''}${formatNumber(mvDiff, 1)}</span> MV)`;

            return result;
        };

        const marginalUp = formatMarginal(results[config.x + 1], currentResult);
        const marginalDown = formatMarginal(results[config.x - 1], currentResult);

        const cardsHTML = [
            renderStatCard('Expected Lands', formatNumber(expectedLands, 1), `at X=${config.x}${config.doubleCast ? ' (2×)' : ''}`, '#22c55e'),
            renderStatCard('Expected Legends', formatNumber(expectedLegends, 1), 'CMC ≤ X', '#3b82f6'),
            renderStatCard('Total Expected Hits', formatNumber(currentResult.expectedHits, 1), 'Land/Legendary', '#10b981'),
            renderStatCard('Legendary Density', formatNumber(legendaryPercent, 0) + '%', 'of permanents', '#f59e0b')
        ];

        const footer = `<strong>Marginal Value:</strong><br>• X=${config.x + 1}: ${marginalUp}<br>• X=${config.x - 1}: ${marginalDown}<br><br>• Valid hits: Lands AND Legendary Permanents (CMC <= X)<br>• ${config.totalLegendaries} Legendary Permanents in deck`;

        statsPanel.innerHTML = `
            ${renderInsightBox(`🌱 Kamahl's Druidic Vow X=${config.x}`, '', '')}
            ${renderStatsGrid(cardsHTML)}
            ${renderInsightBox('', interpretation, footer)}
        `;
    }
}

/**
 * Run sample Vow simulations
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        document.getElementById('vow-reveals-display').innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('vow-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || 10);

    const deck = buildDeckFromCardData(cardData);
    if (stableSamples.length < numSims) {
        generateStableSamples(deck, numSims);
    }

    // 1. STATS LOOP
    const multiplier = config.doubleCast ? 2 : 1;
    const cardsToReveal = Math.min(config.x * multiplier, deck.length);
    const maxPossibleHits = cardsToReveal;

    let totalHits = 0;
    let totalLands = 0;
    let totalLegends = 0;
    let totalManaValue = 0;
    const hitDistribution = new Array(maxPossibleHits + 1).fill(0);

    for (let i = 0; i < numSims; i++) {
        const shuffled = stableSamples[i];
        const revealed = shuffled.slice(0, cardsToReveal);

        let hitsInSim = 0;
        let landsInSim = 0;
        let legendsInSim = 0;
        let manaValueInSim = 0;

        revealed.forEach(card => {
            if (isValidType(card)) {
                const cmc = card.cmc !== undefined ? card.cmc : 0;
                if (cmc <= config.x) {
                    hitsInSim++;
                    manaValueInSim += cmc;

                    const analysis = analyzeCardForDisplay(card, config.x);
                    if (analysis.isLand) landsInSim++;
                    if (analysis.isLegendary && analysis.isPermanent) legendsInSim++;
                }
            }
        });

        totalHits += hitsInSim;
        totalLands += landsInSim;
        totalLegends += legendsInSim;
        totalManaValue += manaValueInSim;
        hitDistribution[hitsInSim]++;
    }

    // 2. Build Summary UI
    const avgHits = (totalHits / numSims).toFixed(2);
    const avgLands = (totalLands / numSims).toFixed(2);
    const avgLegends = (totalLegends / numSims).toFixed(2);
    const avgManaValue = (totalManaValue / numSims).toFixed(1);

    // Add color legend
    let legendHTML = '<div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: var(--spacing-md); padding: var(--spacing-sm); background: var(--panel-bg); border-radius: var(--radius-md); font-size: 0.9em;">';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #22c55e; border-radius: 3px; display: inline-block;"></span>Lands</span>';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #3b82f6; border-radius: 3px; display: inline-block;"></span>Legends (Hit)</span>';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #f59e0b; border-radius: 3px; display: inline-block;"></span>Legends (Miss)</span>';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #6b7280; border-radius: 3px; display: inline-block;"></span>Non-Legends</span>';
    legendHTML += '</div>';

    let distributionHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md);">';
    distributionHTML += '<h4 style="margin-top: 0;">Hit Distribution:</h4>';
    distributionHTML += renderDistributionChart(
        hitDistribution,
        numSims,
        (count) => `${count.toString().padStart(2)} hits`,
        () => ''
    );
    distributionHTML += `<div style="margin-top: var(--spacing-md);">`;
    distributionHTML += `<div style="text-align: center; margin-bottom: var(--spacing-sm);"><strong>Average Results (${numSims} simulations):</strong></div>`;
    distributionHTML += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--spacing-sm); font-size: 0.9em;">`;
    distributionHTML += `<div><strong>Total Hits:</strong> ${avgHits}</div>`;
    distributionHTML += `<div><strong>Lands:</strong> <span style="color: #22c55e;">${avgLands}</span></div>`;
    distributionHTML += `<div><strong>Legends:</strong> <span style="color: #3b82f6;">${avgLegends}</span></div>`;
    distributionHTML += `<div><strong>Total MV:</strong> ${avgManaValue}</div>`;
    distributionHTML += `</div>`;
    if (config.doubleCast) {
        distributionHTML += `<div style="text-align: center; margin-top: var(--spacing-sm); color: var(--text-secondary); font-size: 0.85em;">X=${config.x}, doubled (${cardsToReveal} cards revealed)</div>`;
    } else {
        distributionHTML += `<div style="text-align: center; margin-top: var(--spacing-sm); color: var(--text-secondary); font-size: 0.85em;">${cardsToReveal} cards revealed</div>`;
    }
    distributionHTML += '</div></div>';

    // 3. Prepare List
    const listId = 'vow-samples-list';
    const btnId = 'vow-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Reveals (${numSims} simulations)`,
        listHTML,
        true
    );

    document.getElementById('vow-reveals-display').innerHTML = legendHTML + distributionHTML + revealsSectionHTML;

    // 4. Render Batch
    const listContainer = document.getElementById(listId);
    const loadMoreBtn = document.getElementById(btnId);
    renderedCount = 0;

    const renderBatch = (batchSize) => {
        const start = renderedCount;
        const end = Math.min(start + batchSize, numSims);
        let html = '';

        for (let i = start; i < end; i++) {
            const shuffled = stableSamples[i];
            const revealed = shuffled.slice(0, cardsToReveal);

            // Cache analyses for this reveal to avoid double pass
            const cardAnalyses = new Map();
            let totalManaValue = 0;
            let landCount = 0;
            let hitCount = 0;

            // Single pass: analyze all cards once and cache results
            revealed.forEach(card => {
                const analysis = analyzeCardForDisplay(card, config.x);
                cardAnalyses.set(card, analysis);

                if (analysis.isValid && analysis.matchesX) {
                    hitCount++;
                    totalManaValue += analysis.cmc;
                    if (analysis.isLand) {
                        landCount++;
                    }
                }
            });

            html += `<div class="sample-reveal ${hitCount > 0 ? 'free-spell' : 'whiff'}">`;
            html += `<div><strong>Reveal ${i + 1}`;
            if (config.doubleCast) {
                html += ` (X=${config.x}, doubled)`;
            } else {
                html += ` (X=${config.x})`;
            }
            html += `:</strong></div>`;
            html += '<div style="margin: 8px 0;">';

            // Use cached analyses for rendering
            revealed.forEach(card => {
                const analysis = cardAnalyses.get(card);
                const style = getCardDisplayStyle(analysis, card.type_line);

                html += `<span class="reveal-card" style="background: ${style.bgColor}; color: ${style.textColor};" title="${style.tooltip}">${card.name}</span>`;
            });

            html += '</div>';
            html += `<div class="reveal-summary">`;
            html += `<strong>Result:</strong> ${hitCount} hit${hitCount !== 1 ? 's' : ''} `;
            html += `| <strong>Lands:</strong> ${landCount} `;
            html += `| <strong>Total MV:</strong> ${totalManaValue}`;
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

    renderBatch(CONFIG.SAMPLE_BATCH_SIZE);
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => renderBatch(CONFIG.SAMPLE_BATCH_SIZE));
    }
}

/**
 * Update all UI elements
 */
export function updateUI() {
    const { config, results } = calculate();

    if (config.deckSize === 0 || Object.keys(results).length === 0) {
        if (chart) chart.destroy();
        document.getElementById('vow-comparisonTable').innerHTML = '';
        return;
    }

    updateChart(config, results);
    updateStats(config, results);
    updateTable(config, results);

    if (config.cardData && config.cardData.cardsByName && Object.keys(config.cardData.cardsByName).length > 0) {
        runSampleReveals();
    }
}

/**
 * Initialize Vow calculator
 */
export function init() {
    registerCalculator({
        name: 'vow',
        calculate,
        updateUI,
        inputs: ['x'],
        init: () => {
            const container = document.getElementById('vow-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('vow', 'Sample Vow Reveals');
            }
            const btn = document.getElementById('vow-draw-reveals-btn');
            if (btn) btn.addEventListener('click', refreshSamples);

            // Add event listener for double cast checkbox
            const doubleCastCheckbox = document.getElementById('vow-doubleCast');
            if (doubleCastCheckbox) {
                doubleCastCheckbox.addEventListener('change', updateUI);
            }
        }
    });
}