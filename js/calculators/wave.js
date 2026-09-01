/**
 * Genesis Wave Calculator
 * Simulates permanents played with Genesis Wave for X
 */

import { createCache, partialShuffle, formatNumber, debounce } from '../utils/simulation.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderRecommendation, renderInsightBox, renderVerdictBadge, renderSweepTable, pBarCell, generateSampleRevealsHTML } from '../utils/components.js';
import { efficiencyVerdict, formatDelta, deltaColor, recommendKneeX } from '../utils/analysis.js';
import { compareBigSpells, renderComparison } from '../utils/bigSpellComparison.js';

import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, renderDistributionChart,
    createCollapsibleSection
} from '../utils/sampleSimulator.js';

const CONFIG = {
    // ITERATIONS removed, using math formula
    X_RANGE_BEFORE: 4,
    X_RANGE_AFTER: 4,
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
    const efficiencyData = xValues.map(x => (results[x].expectedPermanents / x) * 100);

    chart = createOrUpdateChart(chart, 'wave-chart', {
        type: 'line',
        data: {
            labels: xValues.map(x => `X=${x}`),
            datasets: [
                {
                    label: 'Expected Permanents',
                    data: expectedPermsData,
                    borderColor: '#7d8a92',
                    backgroundColor: 'rgba(125, 138, 146, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 8 : 4),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#7d8a92'),
                    yAxisID: 'y'
                },
                {
                    label: 'Hit Rate %',
                    data: efficiencyData,
                    borderColor: '#55c97f',
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 6 : 3),
                    pointBackgroundColor: xValues.map(x => x === config.x ? '#fff' : '#55c97f'),
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
                    title: { display: true, text: 'Expected Permanents', color: '#7d8a92' },
                    grid: { color: 'rgba(240, 169, 44, 0.2)' },
                    ticks: { color: '#7d8a92' }
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'Hit Rate %', color: '#55c97f' },
                    grid: { drawOnChartArea: false },
                    ticks: {
                        color: '#55c97f',
                        callback: value => value + '%'
                    }
                },
                x: {
                    grid: { color: 'rgba(240, 169, 44, 0.2)' },
                    ticks: { color: '#808b85' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            if (ctx.datasetIndex === 0) {
                                return `Expected: ${ctx.parsed.y.toFixed(2)} permanents`;
                            } else {
                                return `Hit Rate: ${ctx.parsed.y.toFixed(1)}%`;
                            }
                        }
                    }
                }
            }
        }
    });
}

/**
 * Compute expected permanents across the full practical X range, for the sweep
 * table and the diminishing-returns recommendation.
 * @returns {Array<{x:number, value:number, efficiency:number}>}
 */
function computeSweep(config) {
    const maxX = Math.min(config.deckSize, 20);
    const sweep = [];
    for (let x = 1; x <= maxX; x++) {
        const sim = simulateGenesisWave(config.deckSize, config.distribution, x);
        sweep.push({ x, value: sim.expectedPermanents, efficiency: x > 0 ? sim.expectedPermanents / x : 0 });
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

    renderSweepTable('wave-comparisonTable', {
        current: config.x,
        recommended,
        rows,
        columns: [
            { label: 'X', align: 'left', render: r => `${r.x}` },
            { label: 'E[PERMS]', render: r => `<span style="color:var(--tx-blue);">${formatNumber(r.value, 2)}</span>` },
            { label: 'HIT RATE', align: 'left', render: r => pBarCell(r.efficiency, 'var(--tx-green)') },
            { label: '%', render: r => `<span style="color:var(--tx-green);">${(r.efficiency * 100).toFixed(0)}%</span>` },
            { label: 'Δ PERMS', render: r => r.delta == null ? '—' : `<span style="color:${deltaColor(r.delta, 0.01)};">${formatDelta(r.delta, 2)}</span>` },
            { label: 'VERDICT', render: r => { const v = efficiencyVerdict(r.efficiency); return `<span style="color:${v.color}; font-weight:600; letter-spacing:0.06em;">${v.label}</span>`; } }
        ]
    });
}

/**
 * Render hero numerics + verdict + recommendation for the current X.
 */
function updateStats(config, results) {
    const statsPanel = document.getElementById('wave-stats');
    const currentResult = results[config.x];
    if (!statsPanel || !currentResult) return;

    const eperms = currentResult.expectedPermanents;
    const efficiency = config.x > 0 ? eperms / config.x : 0;
    const totalPerms = config.totalPerms ?? (config.deckSize - config.cmcCounts.nonperm);
    const permPercent = config.deckSize > 0 ? (totalPerms / config.deckSize) * 100 : 0;
    const next = results[config.x + 1];
    const marginal = next ? next.expectedPermanents - eperms : null;
    const verdict = efficiencyVerdict(efficiency);

    const hero = renderHeroStats([
        { label: 'E[PERMANENTS]', value: formatNumber(eperms, 1), sub: `at X=${config.x}`, color: 'var(--tx-blue)', size: 'big' },
        { label: 'HIT RATE', value: formatNumber(efficiency * 100, 0) + '%', sub: 'reveals that stick', color: 'var(--tx-green)' },
        { label: 'DECK PERMANENTS', value: totalPerms, sub: `${formatNumber(permPercent, 0)}% of library`, color: 'var(--tx-amber)' },
        { label: 'MARGINAL +1X', value: marginal != null ? formatDelta(marginal, 2) : '—', sub: 'extra perms per card', color: marginal != null ? deltaColor(marginal, 0.001) : 'var(--tx-dim)' }
    ]);

    const knee = recommendKneeX(computeSweep(config).map(p => ({ x: p.x, value: p.efficiency })), { fraction: 0.92 });
    const rec = knee
        ? renderRecommendation(`Efficient cast at <strong>X=${knee.x}</strong> (~${(knee.value * 100).toFixed(0)}% hit rate). Past that, extra mana mostly reveals cards you'd already expect to hit.`)
        : '';

    const insight = renderInsightBox('', `Genesis Wave at X=${config.x} reveals ${config.x} cards and expects <strong style="color:var(--tx-blue);">${formatNumber(eperms, 1)}</strong> permanents to the battlefield. ${renderVerdictBadge(verdict)} ${verdict.advice}`);

    statsPanel.innerHTML = hero + rec + insight;
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

    let distributionHTML = '<div class="tx-sim">';
    distributionHTML += '<div class="tx-h"><span>Permanents — distribution</span></div>';
    distributionHTML += '<div class="tx-sim-block">';

    distributionHTML += renderDistributionChart(
        permanentDistribution,
        numSims,
        (count) => `${count.toString().padStart(2)} permanents`,
        (idx) => (idx === config.x && permanentDistribution[idx] > 0) ? ' ← 100% HITS' : ''
    );

    distributionHTML += '</div><div class="tx-sim-block">';
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
                let textColor = '#0a0b0a';
                if (!hasPermanentType) {
                    bgColor = '#5b8db8';
                } else if (cmc <= config.x) {
                    bgColor = '#55c97f';
                    textColor = '#0a0b0a';
                } else {
                    bgColor = '#e8635c';
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
        const waveComparisonContainer = document.getElementById('big-spell-comparison-wave');
        if (waveComparisonContainer) waveComparisonContainer.innerHTML = '';
        return;
    }

    updateChart(config, results);
    updateStats(config, results);
    updateTable(config);
    updateComparison(config, results);

    // Update big spell comparison
    const waveComparisonContainer = document.getElementById('big-spell-comparison-wave');
    if (waveComparisonContainer) {
        const comparison = compareBigSpells(config.x, 'wave');
        waveComparisonContainer.innerHTML = renderComparison(comparison);
    }

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