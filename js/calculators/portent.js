/**
 * Portent of Calamity Calculator
 * Simulates card type diversity for Portent of Calamity spell
 */

import { createCache, partialShuffle, formatNumber, formatPercentage, debounce } from '../utils/simulation.js';
import { renderMultiColumnTable } from '../utils/tableUtils.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { renderDistributionChart, buildDeckFromCardData, shuffleDeck, createCollapsibleSection, extractCardTypes } from '../utils/sampleSimulator.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';

const CONFIG = {
    ITERATIONS: 25000,
    X_RANGE_BEFORE: 3,
    X_RANGE_AFTER: 4,
    FREE_SPELL_THRESHOLD: 4,
    DEFAULT_SAMPLE_SIZE: 500
};

const COLORS = {
    primary: '#c084fc',
    primaryDim: 'rgba(192, 132, 252, 0.1)',
    danger: '#dc2626',
    dangerDim: 'rgba(220, 38, 38, 0.1)',
    success: '#22c55e',
    warning: '#f59e0b',
    white: '#fff',
    text: '#a09090',
    grid: 'rgba(139, 0, 0, 0.2)',
    creature: '#22c55e',
    sorcery: '#ef4444',
    instant: '#3b82f6',
    artifact: '#a8a29e',
    enchantment: '#a855f7',
    planeswalker: '#f59e0b',
    battle: '#ec4899',
    land: '#92867d'
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
        const countInput = document.getElementById('portent-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        
        // Build full deck object for visual samples
        const deck = [];
        Object.values(cardData.cardsByName).forEach(card => {
            const types = extractCardTypes(card);
            for (let i = 0; i < card.count; i++) {
                deck.push({ name: card.name, types, type_line: card.type_line });
            }
        });
        
        generateStableSamples(deck, numSims);
        runSampleReveals();
    }
}

/**
 * Build deck integer array where each card is a bitmask of its types
 */
function buildDeckIntArray(typeCounts, cardData) {
    const types = Object.keys(typeCounts).filter(t => typeCounts[t] > 0);
    const numTypes = types.length;
    const tempDeck = [];

    if (cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        Object.values(cardData.cardsByName).forEach(card => {
            if (card.type_line) {
                let typeMask = 0;
                const cardTypes = card.type_line.toLowerCase();
                types.forEach((type, idx) => {
                    if (cardTypes.includes(type)) {
                        typeMask |= (1 << idx);
                    }
                });
                for (let i = 0; i < card.count; i++) {
                    tempDeck.push(typeMask);
                }
            }
        });
    } else {
        types.forEach((type, typeIdx) => {
            const count = typeCounts[type];
            const typeMask = 1 << typeIdx;
            for (let i = 0; i < count; i++) {
                tempDeck.push(typeMask);
            }
        });
    }

    return { 
        deck: new Uint32Array(tempDeck),
        numTypes 
    };
}

/**
 * Run Batch Monte Carlo simulation for all X up to maxX
 * Optimized to calculate cumulative stats in a single pass per iteration
 */
function simulatePortentBatch(deckIntArray, numTypes, deckSize, maxX) {
    const cacheKey = `batch-${deckSize}-${maxX}-${deckIntArray.length}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    const deck = deckIntArray.slice();
    const iterations = CONFIG.ITERATIONS;
    
    const results = new Array(maxX + 1).fill(null).map(() => ({
        totalUniqueTypes: 0,
        typeDist: new Uint32Array(numTypes + 1)
    }));

    for (let iter = 0; iter < iterations; iter++) {
        let seenTypesMask = 0;
        let currentUniqueTypes = 0;

        for (let i = 0; i < maxX; i++) {
            const pick = i + Math.floor(Math.random() * (deckSize - i));
            const card = deck[pick];
            deck[pick] = deck[i];
            deck[i] = card;

            const oldMask = seenTypesMask;
            seenTypesMask |= card;
            
            if (seenTypesMask !== oldMask) {
                currentUniqueTypes = 0;
                let n = seenTypesMask;
                while (n > 0) {
                    n &= (n - 1);
                    currentUniqueTypes++;
                }
            }

            const res = results[i + 1];
            res.totalUniqueTypes += currentUniqueTypes;
            res.typeDist[currentUniqueTypes]++;
        }
    }

    const processedResults = {};
    for (let x = 1; x <= maxX; x++) {
        const r = results[x];
        const typeDist = Array.from(r.typeDist).map(c => c / iterations);
        
        processedResults[x] = {
            typeDist,
            expectedTypes: r.totalUniqueTypes / iterations,
            prob4Plus: typeDist.slice(CONFIG.FREE_SPELL_THRESHOLD).reduce((a, b) => a + b, 0),
            expectedCardsToHand: 0 
        };
    }

    simulationCache.set(cacheKey, processedResults);
    return processedResults;
}

/**
 * Get current deck configuration
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();

    const types = {
        creature: config.creatures,
        instant: config.instants,
        sorcery: config.sorceries,
        artifact: config.artifacts,
        enchantment: config.enchantments,
        planeswalker: config.planeswalkers,
        land: config.lands,
        battle: config.battles
    };

    const deckSize = DeckConfig.getDeckSize(true);

    const newHash = JSON.stringify(types);
    
    if (newHash !== lastSampleDeckHash && cardData && cardData.cardsByName && Object.keys(cardData.cardsByName).length > 0) {
        const deck = [];
        Object.values(cardData.cardsByName).forEach(card => {
            const t = extractCardTypes(card);
            for (let i = 0; i < card.count; i++) {
                deck.push({ name: card.name, types: t, type_line: card.type_line });
            }
        });
        generateStableSamples(deck, 20);
        lastSampleDeckHash = newHash;
    }

    if (newHash !== lastDeckHash) {
        simulationCache.clear();
        lastDeckHash = newHash;
    }

    const xSlider = document.getElementById('portent-xSlider');
    if (xSlider) {
        xSlider.max = Math.min(deckSize, 30);
    }

    return {
        deckSize,
        x: parseInt(document.getElementById('portent-xValue').value) || 5,
        types,
        cardData
    };
}

/**
 * Calculate probabilities
 */
export function calculate() {
    const config = getDeckConfig();

    if (config.deckSize === 0) {
        return { config, results: {} };
    }

    const { deck, numTypes } = buildDeckIntArray(config.types, config.cardData);
    const effectiveDeckSize = deck.length;

    const maxX = Math.min(config.x + CONFIG.X_RANGE_AFTER, effectiveDeckSize);
    const batchResults = simulatePortentBatch(deck, numTypes, effectiveDeckSize, maxX);

    return { config, results: batchResults };
}

function updateChart(config, results) {
    const minX = Math.max(1, config.x - CONFIG.X_RANGE_BEFORE);
    const maxX = Math.min(config.x + CONFIG.X_RANGE_AFTER, Object.keys(results).length);
    
    const xValues = [];
    for (let i = minX; i <= maxX; i++) xValues.push(i);

    const pointRadii = xValues.map(x => x === config.x ? 8 : 4);

    chart = createOrUpdateChart(chart, 'portent-combinedChart', {
        type: 'line',
        data: {
            labels: xValues.map(x => 'X=' + x),
            datasets: [
                {
                    label: 'P(Free Spell) %',
                    data: xValues.map(x => results[x].prob4Plus * 100),
                    borderColor: COLORS.primary,
                    backgroundColor: COLORS.primaryDim,
                    fill: false,
                    tension: 0.3,
                    pointRadius: pointRadii,
                    pointBackgroundColor: xValues.map(x => x === config.x ? COLORS.white : COLORS.primary),
                    yAxisID: 'yProb'
                },
                {
                    label: 'Types Exiled',
                    data: xValues.map(x => results[x].expectedTypes),
                    borderColor: COLORS.danger,
                    backgroundColor: COLORS.dangerDim,
                    fill: false,
                    tension: 0.3,
                    pointRadius: pointRadii,
                    pointBackgroundColor: xValues.map(x => x === config.x ? COLORS.white : COLORS.danger),
                    yAxisID: 'yTypes'
                }
            ]
        },
        options: {
            scales: {
                yProb: { type: 'linear', position: 'left', beginAtZero: true, max: 100, title: { display: true, text: 'P(Free Spell) %', color: COLORS.primary }, grid: { color: COLORS.grid }, ticks: { color: COLORS.primary } },
                yTypes: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'Types Exiled', color: COLORS.danger }, grid: { drawOnChartArea: false }, ticks: { color: COLORS.danger } },
                x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.datasetIndex === 0 ? `Free spell: ${ctx.parsed.y.toFixed(1)}%` : `Types exiled: ${ctx.parsed.y.toFixed(2)}`
                    }
                }
            }
        }
    });
}

function updateTable(config, results) {
    const minX = Math.max(1, config.x - CONFIG.X_RANGE_BEFORE);
    const maxX = Math.min(config.x + CONFIG.X_RANGE_AFTER, Object.keys(results).length);
    const xValues = [];
    for (let i = minX; i <= maxX; i++) xValues.push(i);

    const currentResult = results[config.x];
    
    // Header with mobile-hide classes
    const headers = [
        'X',
        'P(Free Spell)',
        { text: 'Δ Prob', class: 'mobile-hide' },
        'Types Exiled',
        { text: 'Δ Types', class: 'mobile-hide' }
    ];
    
    const rows = xValues.map(x => {
        const r = results[x];
        if (!r) return null;
        
        const deltaProb = (r.prob4Plus - currentResult.prob4Plus) * 100;
        const deltaTypes = r.expectedTypes - currentResult.expectedTypes;
        const isBaseline = x === config.x;
        const probClass = deltaProb > 0.01 ? 'marginal-positive' : (deltaProb < -0.01 ? 'marginal-negative' : '');
        const typesClass = deltaTypes > 0.001 ? 'marginal-positive' : (deltaTypes < -0.001 ? 'marginal-negative' : '');

        return {
            cells: [
                x,
                formatPercentage(r.prob4Plus),
                { value: isBaseline ? '-' : (deltaProb >= 0 ? '+' : '') + deltaProb.toFixed(1) + '%', class: `${probClass} mobile-hide` },
                formatNumber(r.expectedTypes, 2),
                { value: isBaseline ? '-' : (deltaTypes >= 0 ? '+' : '') + formatNumber(deltaTypes, 2), class: `${typesClass} mobile-hide` }
            ],
            class: isBaseline ? 'current' : ''
        };
    }).filter(r => r !== null);

    renderMultiColumnTable('portent-comparisonTable', headers, rows, { 
        highlightRowIndex: xValues.indexOf(config.x) 
    });
}

const formatMarginal = (compareResult, currentResult) => {
    if (!compareResult || !currentResult) return '<span style="color: var(--text-dim);">N/A</span>';

    const probDiff = (compareResult.prob4Plus - currentResult.prob4Plus) * 100;
    const typesDiff = compareResult.expectedTypes - currentResult.expectedTypes;
    const probColor = probDiff > 0 ? COLORS.success : COLORS.danger;
    const typesColor = typesDiff > 0 ? COLORS.success : COLORS.danger;

    return `<span style="color: ${probColor};">${probDiff >= 0 ? '+' : ''}${probDiff.toFixed(1)}%</span> free spell, <span style="color: ${typesColor};">${typesDiff >= 0 ? '+' : ''}${formatNumber(typesDiff, 2)}</span> types exiled`;
};

function updateStats(config, results) {
    const statsPanel = document.getElementById('portent-stats');
    const currentResult = results[config.x];

    if (statsPanel && currentResult) {
        const marginalUp = formatMarginal(results[config.x + 1], currentResult);
        const marginalDown = formatMarginal(results[config.x - 1], currentResult);
        const expectedTypes = currentResult.expectedTypes;
        const prob = currentResult.prob4Plus;
        
        let message, color, advice;
        if (prob >= 0.90) { message = 'Incredible!'; color = COLORS.success; advice = ' Nearly guaranteed free spell.'; }
        else if (prob >= 0.75) { message = 'Excellent!'; color = COLORS.primary; advice = ' Reliable free spell trigger.'; }
        else if (prob >= 0.60) { message = 'Good.'; color = '#38bdf8'; advice = ' Moderate consistency.'; }
        else if (prob >= 0.40) { message = 'Risky.'; color = COLORS.warning; advice = ' Often misses the free spell.'; }
        else { message = 'Poor.'; color = COLORS.danger; advice = ' Unlikely to hit free spell. Diversify types!'; }

        const cardsHTML = [
            renderStatCard('Free Spell Chance', formatPercentage(currentResult.prob4Plus), '4+ types revealed', COLORS.primary),
            renderStatCard('Types Exiled', formatNumber(expectedTypes, 1), 'avg per cast (1 per type)', COLORS.danger)
        ];

        const footer = `<strong>Marginal Value:</strong><br>• X=${config.x + 1}: ${marginalUp}<br>• X=${config.x - 1}: ${marginalDown}`;

        statsPanel.innerHTML = `
            ${renderInsightBox(`⚡ Portent of Calamity X=${config.x} Analysis`, '', '')}
            ${renderStatsGrid(cardsHTML)}
            ${renderInsightBox('', `<strong style="color: ${color};">${message}</strong> ${advice}`, footer)}
        `;
    }
}

/**
 * Run sample Portent reveals
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    const cardData = config.cardData;

    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        document.getElementById('portent-reveals-display').innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('portent-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || 10);

    // Ensure stable samples exist
    if (stableSamples.length < numSims) {
        // Build deck array
        const deck = [];
        Object.values(cardData.cardsByName).forEach(card => {
            const types = extractCardTypes(card);
            for (let i = 0; i < card.count; i++) {
                deck.push({ name: card.name, types, type_line: card.type_line });
            }
        });
        generateStableSamples(deck, numSims);
    }

    let freeSpellCount = 0;
    const typeDistribution = new Array(9).fill(0);
    let totalTypesExiled = 0;

    // 1. STATS LOOP (Full Simulation)
    for (let i = 0; i < numSims; i++) {
        const shuffled = stableSamples[i];
        
        // Reveal X cards
        const revealed = shuffled.slice(0, config.x);

        const typesRevealed = new Set();
        revealed.forEach(card => {
            card.types.forEach(type => typesRevealed.add(type));
        });

        const numTypes = typesRevealed.size;
        const freeSpell = numTypes >= CONFIG.FREE_SPELL_THRESHOLD;
        if (freeSpell) freeSpellCount++;
        typeDistribution[numTypes]++;
        totalTypesExiled += numTypes;
    }

    // 2. Build Summary UI
    const avgTypesExiled = (totalTypesExiled / numSims).toFixed(2);

    let distributionHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md);">';
    distributionHTML += '<h4 style="margin-top: 0;">Type Distribution:</h4>';
    
    distributionHTML += renderDistributionChart(
        typeDistribution,
        numSims,
        (count) => `${count} ${count === 1 ? 'type ' : 'types'}`,
        (count) => (count >= CONFIG.FREE_SPELL_THRESHOLD && typeDistribution[count] > 0) ? ' ← FREE SPELL' : ''
    );

    distributionHTML += `<div style="margin-top: var(--spacing-md); text-align: center;">`;
    distributionHTML += `<strong>Sample Result:</strong> ${freeSpellCount}/${numSims} reveals = ${((freeSpellCount / numSims) * 100).toFixed(1)}% chance of free spell<br>`;
    distributionHTML += `<strong>Average types exiled:</strong> ${avgTypesExiled}`;
    distributionHTML += '</div></div>';

    // 3. Prepare List Container
    const listId = 'portent-samples-list';
    const btnId = 'portent-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Reveals (${numSims} simulations)`,
        listHTML,
        true
    );

    document.getElementById('portent-reveals-display').innerHTML = distributionHTML + revealsSectionHTML;

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

            const typesRevealed = new Set();
            revealed.forEach(card => {
                card.types.forEach(type => typesRevealed.add(type));
            });

            const numTypes = typesRevealed.size;
            const freeSpell = numTypes >= CONFIG.FREE_SPELL_THRESHOLD;

            html += `<div class="sample-reveal ${freeSpell ? 'free-spell' : 'whiff'}">`;
            html += `<div><strong>Reveal ${i + 1} (X=${config.x}):</strong></div>`;
            html += '<div style="margin: 8px 0;">';

            revealed.forEach(card => {
                const primaryType = card.types[0] || 'land';
                const isDual = card.types.length > 1;
                html += `<span class="reveal-card ${primaryType} ${isDual ? 'dual' : ''}" title="${card.type_line}">${card.name}</span>`;
            });

            html += '</div>';
            html += `<div class="reveal-summary ${freeSpell ? 'free-spell' : 'whiff'}">`;
            html += `<strong>${freeSpell ? '✓ FREE SPELL!' : '✗ No free spell'}</strong> - `;
            html += `${numTypes} type${numTypes !== 1 ? 's' : ''} exiled: `;

            const sortedTypes = Array.from(typesRevealed).sort();
            html += sortedTypes.map(type => `<span style="color: ${COLORS[type] || COLORS.primary}; font-weight: 600;">${type}</span>`).join(', ');

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
        document.getElementById('portent-comparisonTable').innerHTML = '';
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
 * Initialize Portent calculator
 */
export function init() {
    registerCalculator({
        name: 'portent',
        calculate,
        updateUI,
        inputs: ['x'],
        init: () => {
            const container = document.getElementById('portent-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('portent', 'Sample Portent Reveals');
            }
            const btn = document.getElementById('portent-draw-reveals-btn');
            if (btn) btn.addEventListener('click', refreshSamples);
        }
    });
}