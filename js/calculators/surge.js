/**
 * Primal Surge Calculator
 * Simulates permanents played with Primal Surge
 */

import { formatNumber, formatPercentage, createCache } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import { simulateGenesisWave } from './wave.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderVerdictBadge, renderInsightBox, generateSampleRevealsHTML, renderSimulationSummary } from '../utils/components.js';
import { compareBigSpells, renderComparison } from '../utils/bigSpellComparison.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge,
    createCollapsibleSection
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
 * Build deck for sampling, excluding one non-permanent (Primal Surge on stack)
 * @param {Object} cardData - Card data from deck import
 * @returns {Array} - Deck array without one sorcery/instant
 */
function buildDeckExcludingSurge(cardData) {
    const deck = buildDeckFromCardData(cardData);

    // Find and remove one non-permanent (representing Surge on the stack)
    const nonPermIndex = deck.findIndex(card =>
        card.types.includes('instant') || card.types.includes('sorcery')
    );

    if (nonPermIndex !== -1) {
        deck.splice(nonPermIndex, 1);
    }

    return deck;
}

/**
 * Generate stable samples from the deck
 * @param {Array} deck - The source deck (should already exclude Surge)
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
 *
 * NOTE: This models the library state AFTER casting Primal Surge.
 * Surge is on the stack, so:
 * - Library size = deck size - 1
 * - Non-permanents in library = total non-perms - 1 (Surge itself)
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();

    // Use shared getDeckSize function to properly handle dual-typed cards
    const fullDeckSize = DeckConfig.getDeckSize(true);  // Include non-permanents

    // For simulation purposes, count instants and sorceries as non-permanents
    const totalNonPermanents = config.instants + config.sorceries;

    // Model the library AFTER casting Surge:
    // - Surge is on the stack (not in library)
    // - If deck has at least 1 non-permanent (Surge), subtract it
    const surgeOnStack = totalNonPermanents >= 1;
    const deckSize = surgeOnStack ? fullDeckSize - 1 : fullDeckSize;
    const nonPermanents = surgeOnStack ? totalNonPermanents - 1 : totalNonPermanents;
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

    // Clear formula cache if deck changed (sample cache is managed in runSampleReveals)
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
 * Calculate probability of hitting fewer than k permanents before a non-permanent
 * Uses negative hypergeometric: P(X < k) where X = permanents before first non-permanent
 *
 * P(X = x) = C(x, x) * C(N-1-x, K-1) / C(N, K) for the first non-perm at position x+1
 * Simplified: P(X = x) = C(P-1, x) * C(NP, 1) / C(N, x+1) * (x+1)/(NP)
 *
 * Actually simpler: P(exactly x permanents) = P(first x are perms) * P(next is non-perm)
 * = [P/N * (P-1)/(N-1) * ... * (P-x+1)/(N-x+1)] * [NP/(N-x)]
 *
 * @param {number} deckSize - Total cards
 * @param {number} nonPerms - Number of non-permanents
 * @param {number} threshold - Count fewer than this many permanents as "whiff"
 * @returns {number} - Probability of whiffing (0-100)
 */
function calcWhiffProbability(deckSize, nonPerms, threshold = 5) {
    if (nonPerms === 0) return 0; // Can't whiff with no non-permanents
    if (nonPerms >= deckSize) return 100; // All non-permanents = instant whiff

    const perms = deckSize - nonPerms;
    let whiffProb = 0;

    // Sum P(X = x) for x = 0 to threshold-1
    for (let x = 0; x < threshold; x++) {
        // P(exactly x permanents before first non-perm)
        // = (perms choose x) / (deck choose x+1) * (nonPerms) * (x+1)! / x!
        // Simplified: product of (P-i)/(N-i) for i=0..x-1, then * NP/(N-x)

        let prob = 1;
        for (let i = 0; i < x; i++) {
            prob *= (perms - i) / (deckSize - i);
        }
        prob *= nonPerms / (deckSize - x);

        whiffProb += prob;
    }

    return whiffProb * 100;
}

/**
 * Update chart visualization
 * @param {Object} config - Deck configuration
 * @param {Object} result - Calculation result
 */
function updateChart(config, result) {
    const nonPermRange = [];
    const expectedPermsData = [];
    const whiffRiskData = [];

    // Show results for different numbers of non-permanents
    const maxNonPerm = Math.min(20, Math.floor(config.deckSize * 0.3));
    for (let i = 0; i <= maxNonPerm; i++) {
        const sim = simulatePrimalSurge(config.deckSize, i, config.deckSize - i);
        nonPermRange.push(i);
        expectedPermsData.push(sim.expectedPermanents);
        whiffRiskData.push(calcWhiffProbability(config.deckSize, i, 5));
    }

    chart = createOrUpdateChart(chart, 'surge-chart', {
        type: 'line',
        data: {
            labels: nonPermRange.map(x => x + ' non-perm'),
            datasets: [
                {
                    label: 'Expected Permanents',
                    data: expectedPermsData,
                    borderColor: '#55c97f',
                    backgroundColor: 'rgba(85, 201, 127, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: nonPermRange.map(x => x === config.nonPermanents ? 8 : 4),
                    pointBackgroundColor: nonPermRange.map(x => x === config.nonPermanents ? '#fff' : '#55c97f'),
                    yAxisID: 'y'
                },
                {
                    label: 'Whiff Risk (<5 perms)',
                    data: whiffRiskData,
                    borderColor: '#e8635c',
                    backgroundColor: 'rgba(232, 99, 92, 0.1)',
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    pointRadius: nonPermRange.map(x => x === config.nonPermanents ? 6 : 3),
                    pointBackgroundColor: nonPermRange.map(x => x === config.nonPermanents ? '#fff' : '#e8635c'),
                    yAxisID: 'y2'
                }
            ]
        },
        options: {
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Expected Permanents', color: '#55c97f' },
                    grid: { color: 'rgba(85, 201, 127, 0.2)' },
                    ticks: { color: '#55c97f' }
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Whiff Risk %', color: '#e8635c' },
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#e8635c',
                        callback: value => value + '%'
                    }
                },
                x: {
                    grid: { color: 'rgba(85, 201, 127, 0.2)' },
                    ticks: { color: TX.dim, font: { size: 9 } }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            if (ctx.datasetIndex === 0) {
                                return `Expected: ${ctx.parsed.y.toFixed(1)} permanents`;
                            } else {
                                return `Whiff Risk: ${ctx.parsed.y.toFixed(1)}%`;
                            }
                        }
                    }
                }
            }
        }
    });
}

/**
 * Calculate probability of hitting ALL permanents before any non-permanent
 * This means all non-permanents must be in the last NP positions of the deck
 * P = C(NP, NP) / C(N, NP) = 1 / C(N, NP) = NP! * P! / N!
 *
 * For numerical stability, compute as: P/(N) * (P-1)/(N-1) * ... * 1/(N-P+1)
 */
function calcAllPermsProb(deckSize, nonPerms) {
    if (nonPerms === 0) return 1;
    if (nonPerms >= deckSize) return 0;

    const perms = deckSize - nonPerms;
    let prob = 1;

    // Probability that first P positions are all permanents
    for (let i = 0; i < perms; i++) {
        prob *= (perms - i) / (deckSize - i);
    }

    return prob;
}

/**
 * Update stats panel (replacing the old table)
 */
function updateStatsPanel(config, result) {
    const avgLands = config.permanents > 0 ? result.expectedPermanents * (config.lands / config.permanents) : 0;
    const avgCMC = config.permanents > 0 ? result.expectedPermanents * (config.totalPermCMC / config.permanents) : 0;
    const allPermsProb = calcAllPermsProb(config.deckSize, config.nonPermanents);

    // Verdict tier from expected permanents
    let verdict;
    if (result.expectedPermanents > 40) verdict = { label: 'LETHAL', color: 'var(--tx-green)', advice: 'Likely plays half your deck or more.' };
    else if (result.expectedPermanents > 20) verdict = { label: 'EXPLOSIVE', color: 'var(--tx-green)', advice: 'Expect a board-state explosion.' };
    else if (result.expectedPermanents > 10) verdict = { label: 'SOLID', color: 'var(--tx-amber)', advice: 'Good return on investment for 10 mana.' };
    else verdict = { label: 'RISKY', color: 'var(--tx-red)', advice: 'High chance of bricking on an early non-permanent.' };

    // Show non-permanents remaining in library (after Surge is cast)
    const nonPermLabel = config.nonPermanents === 0
        ? 'no other non-permanents'
        : `${config.nonPermanents} non-perm${config.nonPermanents > 1 ? 's' : ''} left`;

    const hero = renderHeroStats([
        { label: 'E[PERMANENTS]', value: formatNumber(result.expectedPermanents, 1), sub: 'hit the battlefield', color: 'var(--tx-green)', size: 'big' },
        { label: 'AVG LANDS', value: formatNumber(avgLands, 1), sub: 'onto battlefield', color: 'var(--tx-amber)' },
        { label: 'AVG MANA VALUE', value: formatNumber(avgCMC, 1), sub: 'total mana cheated', color: 'var(--tx-mid)' },
        { label: 'LIBRARY PLAYED', value: formatNumber(result.percentOfDeck, 1) + '%', sub: nonPermLabel, color: result.percentOfDeck > 50 ? 'var(--tx-green)' : 'var(--tx-amber)' }
    ]);

    const note = config.nonPermanents === 0
        ? `<strong style="color:var(--tx-green);">100% chance to play your entire library.</strong>`
        : `Chance to hit all ${config.permanents} permanents before a non-perm: <strong>${formatPercentage(allPermsProb, 2)}</strong>`;

    const insight = renderInsightBox('', `Primal Surge plays cards off the top until it reveals a non-permanent. ${renderVerdictBadge(verdict)} ${verdict.advice}<br><span style="color:var(--tx-dim);">${note}</span>`);

    const container = document.getElementById('surge-stats-container');
    if (container) container.innerHTML = hero + insight;
}

/**
 * Update comparison with Genesis Wave
 * @param {Object} config - Deck configuration
 * @param {Object} result - Calculation result
 */
function updateComparison(config, result) {
    const waveResult = simulateGenesisWave(config.deckSize, {
        cmc0: 0, cmc2: 0, cmc3: 0, cmc4: 0, cmc5: 0, cmc6: 0,
        lands: config.permanents,
        nonperm: config.nonPermanents
    }, 7);

    const comparisonPanel = document.getElementById('surge-comparison-panel');
    const comparisonInsight = document.getElementById('surge-comparison-insight');

    if (waveResult) {
        const surgeBetter = result.expectedPermanents > waveResult.expectedPermanents;
        const difference = Math.abs(result.expectedPermanents - waveResult.expectedPermanents);
        const percentDiff = ((difference / waveResult.expectedPermanents) * 100).toFixed(1);

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
    } else if (comparisonPanel) {
        comparisonPanel.style.display = 'none';
    }
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
        // Exclude Surge from samples (it's on the stack when resolving)
        const deck = buildDeckExcludingSurge(cardData);
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

    // Get number of simulations to DISPLAY from input
    const countInput = document.getElementById('surge-sample-count');
    const displayCount = Math.max(1, parseInt(countInput?.value) || 10);

    // Create hash to detect deck changes
    const currentDeckHash = `${config.deckSize}-${config.nonPermanents}`;
    const deckChanged = currentDeckHash !== lastSampleDeckHash;

    // Ensure we have enough samples - always generate at least DEFAULT_SAMPLE_SIZE for accurate stats
    const minSamplesForStats = Math.max(displayCount, CONFIG.DEFAULT_SAMPLE_SIZE);
    if (deckChanged || stableSamples.length < minSamplesForStats) {
        // Exclude Surge from samples (it's on the stack when resolving)
        const deck = buildDeckExcludingSurge(cardData);
        generateStableSamples(deck, minSamplesForStats);
        lastSampleDeckHash = currentDeckHash;
    }

    // Use all available samples for statistics (more accurate)
    const statsCount = stableSamples.length;

    // 1. STATS LOOP (Full Simulation over ALL samples for accuracy)
    let totalPermanents = 0;
    let totalManaValue = 0;
    let totalLands = 0;
    let minPermanents = Infinity;
    let maxPermanents = 0;
    const permanentCounts = [];

    for (let i = 0; i < statsCount; i++) {
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
        permanentCounts.push(permanentCount);
        minPermanents = Math.min(minPermanents, permanentCount);
        maxPermanents = Math.max(maxPermanents, permanentCount);
    }

    // Calculate percentiles and thresholds
    const deckSize = stableSamples[0].length;
    const fullDeckCount = permanentCounts.filter(c => c === deckSize).length;
    const over20Count = permanentCounts.filter(c => c >= 20).length;
    const over10Count = permanentCounts.filter(c => c >= 10).length;
    const under5Count = permanentCounts.filter(c => c < 5).length;

    // 2. Build Summary UI (using statsCount for accurate averages)
    const avgPermanents = (totalPermanents / statsCount).toFixed(1);
    const avgMana = (totalManaValue / statsCount).toFixed(0);
    const avgLands = (totalLands / statsCount).toFixed(1);

    // Bucket the permanent counts so the sample section shows the SHAPE of the
    // outcome, not just its average — a mean of 12 permanents reads very
    // differently if the spread is 10-14 versus a bimodal 2-or-25.
    const permDistribution = [];
    for (const c of permanentCounts) permDistribution[c] = (permDistribution[c] || 0) + 1;
    for (let i = 0; i < permDistribution.length; i++) if (!permDistribution[i]) permDistribution[i] = 0;

    const summaryHTML = renderSimulationSummary({
        title: 'Simulation summary',
        runs: statsCount,
        metrics: [
            { label: 'Avg permanents', value: avgPermanents, sub: `range ${minPermanents}–${maxPermanents}`, color: 'var(--tx-good)' },
            { label: 'Avg lands', value: avgLands, sub: 'onto the battlefield', color: 'var(--type-land)' },
            { label: 'Avg mana value', value: avgMana, sub: 'total MV cheated', color: 'var(--tx-accent)' }
        ],
        distribution: {
            title: 'Permanents hit — distribution',
            counts: permDistribution,
            totalSims: statsCount,
            labelFn: (i) => `${i} perm${i === 1 ? '' : 's'}`,
            markerFn: (i) => (i === deckSize ? 'FULL DECK' : (i < 5 ? 'WHIFF' : null)),
            toneFn: (i) => (i < 5 ? 'bad' : null)
        },
        outcomes: [
            { label: 'Full deck emptied', value: fullDeckCount / statsCount, good: true },
            { label: '20+ permanents', value: over20Count / statsCount, good: true },
            { label: '10+ permanents', value: over10Count / statsCount, good: true },
            { label: 'Whiffed (under 5)', value: under5Count / statsCount, good: false }
        ]
    });


    // 3. Prepare List Container (shows displayCount individual reveals)
    const listId = 'surge-samples-list';
    const btnId = 'surge-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Reveals (${displayCount} samples)`,
        listHTML,
        true
    );

    document.getElementById('surge-reveals-display').innerHTML = summaryHTML + revealsSectionHTML;

    // 4. Render Batch Function
    const listContainer = document.getElementById(listId);
    const loadMoreBtn = document.getElementById(btnId);
    renderedCount = 0;

    const renderBatch = (batchSize) => {
        const start = renderedCount;
        const end = Math.min(start + batchSize, displayCount);
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
                html += `<strong>✗ Stopped</strong>`;
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
            if (renderedCount < displayCount) {
                loadMoreBtn.style.display = 'block';
                loadMoreBtn.textContent = `Load More (Showing ${renderedCount}/${displayCount})`;
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