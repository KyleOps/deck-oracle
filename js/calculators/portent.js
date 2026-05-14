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
import { compareBigSpells, renderComparison } from '../utils/bigSpellComparison.js';

const CONFIG = {
    ITERATIONS: 25000,
    X_RANGE_BEFORE: 3,
    X_RANGE_AFTER: 4,
    FREE_SPELL_THRESHOLD: 4,
    DEFAULT_SAMPLE_SIZE: 500
};

const COLORS = {
    primary: '#4ade80',
    primaryDim: 'rgba(74, 222, 128, 0.08)',
    danger: '#fbbf24',
    dangerDim: 'rgba(251, 191, 36, 0.08)',
    success: '#4ade80',
    warning: '#fbbf24',
    white: '#d4dfd9',
    text: '#5a6b66',
    grid: '#1c2520',
    creature: '#4ade80',
    sorcery: '#f87171',
    instant: '#60a5fa',
    artifact: '#8b9b95',
    enchantment: '#c084fc',
    planeswalker: '#fbbf24',
    battle: '#f472b6',
    land: '#5a6b66'
};

const TX_TYPE_COLORS = {
    creature: '#4ade80',
    instant: '#60a5fa',
    sorcery: '#f87171',
    artifact: '#8b9b95',
    enchantment: '#c084fc',
    planeswalker: '#fbbf24',
    land: '#5a6b66',
    battle: '#f472b6'
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

    const maxX = Math.min(Math.max(config.x + CONFIG.X_RANGE_AFTER, 20), effectiveDeckSize);
    const batchResults = simulatePortentBatch(deck, numTypes, effectiveDeckSize, maxX);

    return { config, results: batchResults };
}

function updateChart(config, results) {
    const minX = Math.max(1, config.x - CONFIG.X_RANGE_BEFORE);
    const maxX = Math.min(config.x + CONFIG.X_RANGE_AFTER, Object.keys(results).length);

    const xValues = [];
    for (let i = minX; i <= maxX; i++) xValues.push(i);

    chart = createOrUpdateChart(chart, 'portent-combinedChart', {
        type: 'bar',
        data: {
            labels: xValues.map(x => 'x=' + x),
            datasets: [
                {
                    label: 'E[CARDS]',
                    data: xValues.map(x => results[x] ? +(x * results[x].prob4Plus).toFixed(3) : 0),
                    backgroundColor: xValues.map(x => x === config.x ? COLORS.danger : COLORS.dangerDim),
                    borderColor: 'transparent',
                    yAxisID: 'yCards',
                    order: 2
                },
                {
                    label: 'P(FREE) %',
                    data: xValues.map(x => results[x] ? +(results[x].prob4Plus * 100).toFixed(2) : 0),
                    borderColor: COLORS.primary,
                    backgroundColor: 'transparent',
                    type: 'line',
                    tension: 0.3,
                    pointRadius: xValues.map(x => x === config.x ? 6 : 3),
                    pointBackgroundColor: xValues.map(x => x === config.x ? COLORS.primary : 'transparent'),
                    pointBorderColor: COLORS.primary,
                    fill: false,
                    yAxisID: 'yProb',
                    order: 1
                }
            ]
        },
        options: {
            scales: {
                yProb: { type: 'linear', position: 'left', beginAtZero: true, max: 100,
                    grid: { color: COLORS.grid }, ticks: { color: COLORS.primary } },
                yCards: { type: 'linear', position: 'right', beginAtZero: true,
                    grid: { drawOnChartArea: false }, ticks: { color: COLORS.danger } },
                x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => ctx.datasetIndex === 1
                            ? `P(free): ${ctx.parsed.y.toFixed(1)}%`
                            : `E[cards]: ${ctx.parsed.y.toFixed(2)}`
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

function updateTerminalDisplay(config, results) {
    const x = config.x;
    const r = results[x];
    if (!r) return;

    const prob = r.prob4Plus;
    const eCards = x * prob;
    const eLoss = x * (1 - prob);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set('portent-x-display', x);
    set('portent-n-display', config.deckSize);
    set('portent-n-label', `N=${config.deckSize}`);
    set('portent-pct-display', `${(x / config.deckSize * 100).toFixed(1)}%`);
    set('portent-hero-pfree', (prob * 100).toFixed(2) + '%');
    set('portent-hero-pfree-sub', `x=${x}`);
    set('portent-hero-ecards', eCards.toFixed(2));
    set('portent-hero-loss', eLoss.toFixed(2));
    set('portent-reveal-header', `06 · SAMPLE REVEAL · X=${x}`);
}

function updateTypeBar(types, deckSize) {
    const total = deckSize || Object.values(types).reduce((a, b) => a + b, 0);
    if (total === 0) return;

    const typeBar = document.getElementById('portent-type-bar');
    const typeGrid = document.getElementById('portent-type-grid');

    const entries = Object.entries(types).filter(([, v]) => v > 0);

    if (typeBar) {
        typeBar.innerHTML = entries.map(([type, count]) => {
            const pct = (count / total * 100).toFixed(2);
            return `<span class="tx-bar-seg" style="width:${pct}%; background:${TX_TYPE_COLORS[type] || '#8b9b95'};" title="${type}: ${count}"></span>`;
        }).join('');
    }

    if (typeGrid) {
        typeGrid.innerHTML = entries.map(([type, count]) => `
            <span style="color:${TX_TYPE_COLORS[type] || '#8b9b95'}; line-height:1.8;">●</span>
            <span style="color:var(--tx-mid); text-transform:uppercase; font-size:10px; line-height:1.8;">${type.slice(0, 4)}</span>
            <span style="color:var(--tx-bright); text-align:right; line-height:1.8;">${count}</span>
            <span style="color:var(--tx-dim); text-align:right; font-size:10px; line-height:1.8;">${(count / total * 100).toFixed(0)}%</span>
        `).join('');
    }
}

function updateSweepTable(config, results) {
    const tbody = document.getElementById('portent-sweep-body');
    if (!tbody) return;

    const getVerdict = (p) => {
        if (p >= 0.85) return { text: 'CERTAIN', color: '#4ade80' };
        if (p >= 0.65) return { text: 'STRONG', color: '#22c55e' };
        if (p >= 0.40) return { text: 'FAIR', color: '#fbbf24' };
        return { text: 'WEAK', color: '#f87171' };
    };

    let prevProb = null;
    let html = '';

    for (let x = 3; x <= 20; x++) {
        const r = results[x];
        if (!r) continue;
        const prob = r.prob4Plus;
        const eCards = (x * prob).toFixed(2);

        let deltaP = '—';
        let deltaPColor = 'var(--tx-dim)';
        if (prevProb !== null) {
            const diff = (prob - prevProb) * 100;
            deltaP = (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
            deltaPColor = diff >= 0.05 ? '#4ade80' : diff < -0.05 ? '#f87171' : 'var(--tx-dim)';
        }
        prevProb = prob;

        const verdict = getVerdict(prob);
        const isCurrent = x === config.x;
        const barFill = Math.min(100, +(prob * 100).toFixed(1));
        const rowStyle = isCurrent ? ' class="current"' : '';

        html += `<tr${rowStyle}>
            <td style="text-align:left; font-weight:${isCurrent ? '700' : '400'}; color:${isCurrent ? 'var(--tx-bright)' : 'var(--tx-mid)'};">${x}</td>
            <td style="color:#4ade80;">${(prob * 100).toFixed(2)}%</td>
            <td class="p-bar-cell"><span class="tx-p-bar"><span class="tx-p-fill" style="width:${barFill}%"></span></span></td>
            <td style="color:#fbbf24;">${eCards}</td>
            <td style="color:${deltaPColor};">${deltaP}</td>
            <td style="color:${verdict.color}; font-weight:600; font-size:10px; letter-spacing:0.08em;">${verdict.text}</td>
        </tr>`;
    }

    tbody.innerHTML = html;
}

function updateTrials(config) {
    const container = document.getElementById('portent-trials-container');
    if (!container) return;

    const cardData = config.cardData;
    if (!cardData || !cardData.cardsByName || Object.keys(cardData.cardsByName).length === 0) {
        container.innerHTML = '<div class="portent-trial" style="color:var(--tx-dim); font-size:10px; padding:20px 16px;">Import a decklist to see sample reveals.</div>';
        return;
    }

    if (stableSamples.length < 4) return;

    let html = '';
    for (let t = 0; t < 4; t++) {
        const sample = stableSamples[t];
        if (!sample) continue;
        const revealed = sample.slice(0, config.x);
        const typesSet = new Set();
        revealed.forEach(card => card.types.forEach(ty => typesSet.add(ty)));
        const numTypes = typesSet.size;
        const isFree = numTypes >= CONFIG.FREE_SPELL_THRESHOLD;
        const typeList = Array.from(typesSet).sort();

        const cardDots = revealed.map(card => {
            const t = card.types[0] || 'land';
            return `<span style="color:${TX_TYPE_COLORS[t] || '#8b9b95'};" title="${card.type_line || t}">●</span> <span style="color:var(--tx-mid); font-size:10px;">${card.name}</span>`;
        }).join('<br>');

        html += `<div class="portent-trial" style="padding:0;">
            <div style="display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--tx-rule); font-size:10px; letter-spacing:0.08em;">
                <span style="color:var(--tx-mid);">TRIAL ${String(t + 1).padStart(3,'0')} · X=${config.x}</span>
                <span style="color:${isFree ? '#4ade80' : '#f87171'}; font-weight:600;">${isFree ? 'FREE ✓' : 'FIZZ ✗'}</span>
            </div>
            <div style="padding:8px 12px; font-size:11px; line-height:1.7;">${cardDots}</div>
            <div style="padding:6px 12px; border-top:1px solid var(--tx-rule); font-size:10px; color:var(--tx-dim); letter-spacing:0.06em;">
                DIST ${numTypes} TYPES · ${typeList.map(ty => `<span style="color:${TX_TYPE_COLORS[ty] || '#8b9b95'};">${ty}</span>`).join(' ')}
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

function updateLiveTape(config, results) {
    const tape = document.getElementById('portent-live-tape');
    if (!tape || !results || Object.keys(results).length === 0) return;

    const now = new Date();
    let html = '';
    const xRange = [];
    for (let x = Math.max(3, config.x - 6); x <= Math.min(20, config.x + 7); x++) {
        if (results[x]) xRange.push(x);
        if (xRange.length >= 14) break;
    }

    xRange.forEach((x, i) => {
        const r = results[x];
        if (!r) return;
        const prob = r.prob4Plus;
        const t = new Date(now.getTime() - (13 - i) * 1400);
        const ts = `${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}:${String(t.getUTCSeconds()).padStart(2,'0')}`;
        const barFillCount = Math.round(prob * 10);
        const isCurrent = x === config.x;
        const pColor = prob >= 0.65 ? '#4ade80' : prob >= 0.40 ? '#fbbf24' : '#f87171';
        const filledBar = '█'.repeat(barFillCount);
        const emptyBar = '░'.repeat(10 - barFillCount);

        html += `<div class="portent-tape-row${isCurrent ? ' current' : ''}">
            <span style="color:var(--tx-dim); font-size:9px;">${ts}</span>
            <span style="color:var(--tx-mid);">x=${x}</span>
            <span style="letter-spacing:-0.05em; font-size:10px;"><span style="color:${pColor}; opacity:0.7;">${filledBar}</span><span style="color:var(--tx-rule-hi);">${emptyBar}</span></span>
            <span style="color:${pColor}; text-align:right;">${(prob * 100).toFixed(2)}%</span>
        </div>`;
    });

    tape.innerHTML = html;
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
    updateTerminalDisplay(config, results);
    updateTypeBar(config.types, config.deckSize);
    updateSweepTable(config, results);
    updateLiveTape(config, results);

    if (config.cardData && config.cardData.cardsByName && Object.keys(config.cardData.cardsByName).length > 0) {
        runSampleReveals();
        updateTrials(config);
    }

    // Render big spell comparison
    const comparisonContainer = document.getElementById('big-spell-comparison-portent');
    if (comparisonContainer) {
        const comparison = compareBigSpells(config.x, 'portent');
        comparisonContainer.innerHTML = renderComparison(comparison);
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

            // Preset chips: clicking sets the slider and hidden input then recalcs
            document.querySelectorAll('#portent-presets .tx-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const x = parseInt(chip.dataset.x);
                    const slider = document.getElementById('portent-xSlider');
                    const hidden = document.getElementById('portent-xValue');
                    if (slider) slider.value = x;
                    if (hidden) { hidden.value = x; hidden.dispatchEvent(new Event('input')); }
                    // Mark active chip
                    document.querySelectorAll('#portent-presets .tx-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    updateUI();
                });
            });

            // Reshuffle button
            const reshuffleBtn = document.getElementById('portent-reshuffle-btn');
            if (reshuffleBtn) {
                reshuffleBtn.addEventListener('click', () => {
                    refreshSamples();
                    updateUI();
                });
            }
        }
    });
}