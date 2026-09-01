/**
 * Kamahl's Druidic Vow Calculator
 * Simulates hits for {X}{G}{G} Legendary Sorcery
 * "Look at the top X cards of your library. You may put any number of land and/or legendary permanent cards with mana value X or less from among them onto the battlefield. Put the rest into your graveyard."
 */

import { createCache, partialShuffle, formatNumber } from '../utils/simulation.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderRecommendation, renderInsightBox, renderVerdictBadge, renderSweepTable, pBarCell, generateSampleRevealsHTML } from '../utils/components.js';
import { efficiencyVerdict, formatDelta, deltaColor, recommendKneeX } from '../utils/analysis.js';
import { compareBigSpells, renderComparison } from '../utils/bigSpellComparison.js';

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
            bgColor: '#55c97f',
            textColor: '#0a0b0a',
            tooltip: `${baseTooltip} (Land → battlefield)`
        };
    }

    // Color 2: Legends that hit (cyan/blue) - legendary permanents with CMC ≤ X
    if (isLegendary && isPermanent && matchesX) {
        return {
            bgColor: '#5b8db8',
            textColor: '#0a0b0a',
            tooltip: `${baseTooltip} (Legendary + CMC ≤ X → battlefield)`
        };
    }

    // Color 3: Legends that missed (yellow/orange) - legendary permanents with CMC > X
    if (isLegendary && isPermanent && !matchesX) {
        return {
            bgColor: '#f0a92c',
            textColor: '#0a0b0a',
            tooltip: `${baseTooltip} (Legendary but CMC > X → graveyard)`
        };
    }

    // Color 4: Non-legends (gray/red) - everything else
    return {
        bgColor: '#808b85',
        textColor: '#0a0b0a',
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

    // Auto-check double cast for "The Sixth Doctor" commander
    const commanderName = DeckConfig.getCommanderName();
    const doubleCastCheckbox = document.getElementById('vow-doubleCast');
    if (doubleCastCheckbox && commanderName === 'The Sixth Doctor') {
        doubleCastCheckbox.checked = true;
    }
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
                    borderColor: '#55c97f',
                    backgroundColor: 'rgba(85, 201, 127, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#55c97f'),
                    yAxisID: 'y'
                },
                {
                    label: 'Cards Revealed',
                    data: cardsRevealedData,
                    borderColor: '#7d8a92',
                    backgroundColor: 'rgba(125, 138, 146, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#7d8a92'),
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            scales: {
                y: {
                    type: 'linear',
                    beginAtZero: true,
                    title: { display: true, text: 'Count', color: '#55c97f' },
                    grid: { color: 'rgba(85, 201, 127, 0.1)' },
                    ticks: { color: '#55c97f', stepSize: 1 }
                },
                x: {
                    grid: { color: 'rgba(128, 139, 133, 0.1)' },
                    ticks: { color: '#808b85' }
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
 * Compute expected hits across the full practical X range for the sweep table and
 * the diminishing-returns recommendation.
 * @returns {Array<{x:number, value:number, efficiency:number, cardsRevealed:number}>}
 */
function computeSweep(config) {
    const multiplier = config.doubleCast ? 2 : 1;
    const maxX = Math.min(config.deckSize, 20);
    const sweep = [];
    for (let x = 1; x <= maxX; x++) {
        const sim = simulateVow(config.deckSize, config.distribution, x, config.doubleCast, config.cardData);
        const cardsRevealed = x * multiplier;
        sweep.push({ x, value: sim.expectedHits, cardsRevealed, efficiency: cardsRevealed > 0 ? sim.expectedHits / cardsRevealed : 0 });
    }
    return sweep;
}

/**
 * Render the X-sweep step-response table.
 */
function updateTable(config) {
    const sweep = computeSweep(config);
    const knee = recommendKneeX(sweep.map(p => ({ x: p.x, value: p.efficiency })), { fraction: 0.92 });
    const recommended = knee ? knee.x : null;

    let prev = null;
    const rows = sweep.map(p => {
        const delta = prev != null ? p.value - prev : null;
        prev = p.value;
        return { ...p, delta };
    });

    renderSweepTable('vow-comparisonTable', {
        current: config.x,
        recommended,
        rows,
        columns: [
            { label: 'X', align: 'left', render: r => `${r.x}` },
            { label: 'E[HITS]', render: r => `<span style="color:var(--tx-green);">${formatNumber(r.value, 2)}</span>` },
            { label: 'HIT RATE', align: 'left', render: r => pBarCell(r.efficiency, 'var(--tx-green)') },
            { label: '%', render: r => `<span style="color:var(--tx-green);">${(r.efficiency * 100).toFixed(0)}%</span>` },
            { label: 'Δ HITS', render: r => r.delta == null ? '—' : `<span style="color:${deltaColor(r.delta, 0.01)};">${formatDelta(r.delta, 2)}</span>` },
            { label: 'VERDICT', render: r => { const v = efficiencyVerdict(r.efficiency); return `<span style="color:${v.color}; font-weight:600; letter-spacing:0.06em;">${v.label}</span>`; } }
        ]
    });
}

/**
 * Render hero numerics + verdict + recommendation for the current X.
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

    if (!statsPanel || !currentResult) return;

    const legendaryPercent = config.totalPermanents > 0 ? (config.totalLegendaries / config.totalPermanents) * 100 : 0;
    const cardsRevealed = currentResult.cardsRevealed;
    const efficiency = cardsRevealed > 0 ? currentResult.expectedHits / cardsRevealed : 0;
    const next = results[config.x + 1];
    const marginal = next ? next.expectedHits - currentResult.expectedHits : null;
    const verdict = efficiencyVerdict(efficiency);

    const hero = renderHeroStats([
        { label: 'E[HITS]', value: formatNumber(currentResult.expectedHits, 1), sub: `land + legend${config.doubleCast ? ' · 2×' : ''}`, color: 'var(--tx-green)', size: 'big' },
        { label: 'E[LANDS]', value: formatNumber(currentResult.expectedLands, 1), sub: 'ramp onto field', color: 'var(--tx-amber)' },
        { label: 'E[LEGENDS]', value: formatNumber(currentResult.expectedLegends, 1), sub: 'CMC ≤ X', color: 'var(--tx-blue)' },
        { label: 'MARGINAL +1X', value: marginal != null ? formatDelta(marginal, 2) : '—', sub: 'extra hits', color: marginal != null ? deltaColor(marginal, 0.001) : 'var(--tx-dim)' }
    ]);

    const knee = recommendKneeX(computeSweep(config).map(p => ({ x: p.x, value: p.efficiency })), { fraction: 0.92 });
    const rec = knee
        ? renderRecommendation(`Efficient cast at <strong>X=${knee.x}</strong> (~${(knee.value * 100).toFixed(0)}% hit rate). ${config.totalLegendaries} legendary permanents and ${formatNumber(legendaryPercent, 0)}% legendary density in the pile.`)
        : '';

    const insight = renderInsightBox('', `Kamahl's Druidic Vow at X=${config.x} reveals ${cardsRevealed} cards and expects <strong style="color:var(--tx-green);">${formatNumber(currentResult.expectedHits, 1)}</strong> lands + legends onto the battlefield. ${renderVerdictBadge(verdict)} ${verdict.advice}`);

    statsPanel.innerHTML = hero + rec + insight;
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
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #55c97f; border-radius: 3px; display: inline-block;"></span>Lands</span>';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #5b8db8; border-radius: 3px; display: inline-block;"></span>Legends (Hit)</span>';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #f0a92c; border-radius: 3px; display: inline-block;"></span>Legends (Miss)</span>';
    legendHTML += '<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 16px; height: 16px; background: #808b85; border-radius: 3px; display: inline-block;"></span>Non-Legends</span>';
    legendHTML += '</div>';

    let distributionHTML = '<div class="tx-sim">';
    distributionHTML += '<div class="tx-h"><span>Hits — distribution</span></div>';
    distributionHTML += '<div class="tx-sim-block">';

    distributionHTML += renderDistributionChart(
        hitDistribution,
        numSims,
        (count) => `${count.toString().padStart(2)} hits`,
        () => ''
    );
    distributionHTML += '</div><div class="tx-sim-block">';
    distributionHTML += `<div style="text-align: center; margin-bottom: var(--spacing-sm);"><strong>Average Results (${numSims} simulations):</strong></div>`;
    distributionHTML += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--spacing-sm); font-size: 0.9em;">`;
    distributionHTML += `<div><strong>Total Hits:</strong> ${avgHits}</div>`;
    distributionHTML += `<div><strong>Lands:</strong> <span style="color: #55c97f;">${avgLands}</span></div>`;
    distributionHTML += `<div><strong>Legends:</strong> <span style="color: #5b8db8;">${avgLegends}</span></div>`;
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
        document.getElementById('big-spell-comparison').innerHTML = '';
        return;
    }

    updateChart(config, results);
    updateStats(config, results);
    updateTable(config);

    // Update big spell comparison
    const comparisonContainer = document.getElementById('big-spell-comparison');
    if (comparisonContainer) {
        const comparison = compareBigSpells(config.x, 'vow');
        comparisonContainer.innerHTML = renderComparison(comparison);
    }

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