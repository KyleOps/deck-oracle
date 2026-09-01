/**
 * Rashmi, Eternities Crafter Calculator
 * Calculates probability of getting a free spell when casting with Rashmi
 */

import { createCache, formatNumber, formatPercentage, debounce } from '../utils/simulation.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { generateSampleRevealsHTML, renderHeroStats, renderRecommendation, renderInsightBox, renderVerdictBadge, renderSweepTable, pBarCell, renderSimulationSummary } from '../utils/components.js';
import { probabilityVerdict, formatDelta, deltaColor, recommendThresholdX } from '../utils/analysis.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, 
    createCollapsibleSection, extractCardTypes
} from '../utils/sampleSimulator.js';

const CONFIG = {
    CMC_RANGE_BEFORE: 2,
    CMC_RANGE_AFTER: 4,
    MAX_TRACKED_CMC: 20,
    DEFAULT_SAMPLE_SIZE: 500
};

// Simulation state
let lastDeckHash = '';
let chart = null;
let simulationCache = createCache(50);

// Stable samples state
let stableSamples = [];
let lastSampleDeckHash = '';
let renderedCount = 0;

/**
 * Check if a card is an X spell
 */
function isXSpell(manaCost) {
    return manaCost ? /\{X\}/i.test(manaCost) : false;
}

/**
 * Generate stable samples from the deck
 * @param {Array} deck - The source deck
 * @param {number} count - Number of samples to generate
 */
function generateStableSamples(deck, count) {
    stableSamples = [];
    // We generate enough independent samples
    // For each sample, we shuffle a copy of the deck (simulation of independent draws)
    // Optimization: For single card draws, we can just pick a random card, but 
    // full shuffle preserves the "draw from deck" semantics if we ever expand to "draw 2".
    // For single card reveal, simple random pick is O(1).
    
    // To match previous behavior (shuffleDeck), we'll do full shuffles or robust sampling.
    // Given the deck size is small (100), full shuffle is fine.
    
    for (let i = 0; i < Math.max(count, CONFIG.DEFAULT_SAMPLE_SIZE); i++) {
        // We use a light copy and shuffle
        const shuffled = shuffleDeck([...deck]);
        stableSamples.push(shuffled[0]);
    }
}

/**
 * Prepare the simulation state based on current config
 */
function prepareSimulationState() {
    const config = DeckConfig.getDeckConfig();
    const cardData = DeckConfig.getImportedCardData();
    const hasImportedData = cardData?.cardsByName && Object.keys(cardData.cardsByName).length > 0;

    const excludeCheckbox = document.getElementById('rashmi-exclude-x');
    const excludeXSpells = excludeCheckbox ? excludeCheckbox.checked : false;

    // Check if we can reuse the cached calculation state
    // We need to construct a hash that captures all inputs that affect the distribution
    const rawDeckHash = JSON.stringify({ 
        cards: hasImportedData ? Object.keys(cardData.cardsByName).length : 0, // Quick check
        configLands: config.lands,
        exclude: excludeXSpells
    });

    // We also need to check if the specific card counts/details changed if we want to be 100% robust,
    // but usually checking the imported data reference or a simplified hash is enough.
    // For now, we'll rebuild the distribution if the simple hash changes, 
    // but strictly speaking, we should verify the content if the user edits counts.
    // Since DeckConfig.getImportedCardData returns the same object unless changed,
    // and we built a hash, we are relatively safe.
    
    // However, to optimize properly, we want to AVOID the loop below if possible.
    // Let's check our module-level cache.
    
    let state = simulationCache.get(rawDeckHash);
    
    if (!state) {
        let cmcDistribution = {};
        let xSpells = [];
        let deckSize = config.lands;
        let preparedDeck = [];
        
        // CDF and Prefix Sum Arrays
        // cdf[i] = count of cards with CMC <= i
        // prefixSumCmc[i] = sum of (CMC * count) for cards with CMC <= i
        const cdf = new Array(CONFIG.MAX_TRACKED_CMC + 1).fill(0);
        const prefixSumCmc = new Array(CONFIG.MAX_TRACKED_CMC + 1).fill(0);

        if (hasImportedData) {
            preparedDeck = buildDeckFromCardData(cardData);
            deckSize = preparedDeck.length;

            // 1. Build Frequency Map
            Object.values(cardData.cardsByName).forEach(card => {
                const types = extractCardTypes(card);
                const isLand = types.includes('land');
                
                if (!isLand) {
                    const cmc = card.cmc !== undefined ? Math.floor(card.cmc) : 0;
                    const isX = isXSpell(card.mana_cost);

                    if (isX) {
                        xSpells.push({
                            name: card.name,
                            count: card.count,
                            cmc: cmc,
                            manaCost: card.mana_cost
                        });
                    }

                    if (!excludeXSpells || !isX) {
                        const effectiveCmc = Math.min(cmc, CONFIG.MAX_TRACKED_CMC);
                        cmcDistribution[effectiveCmc] = (cmcDistribution[effectiveCmc] || 0) + card.count;
                    }
                }
            });

            // 2. Build CDF and Prefix Sums
            let runningCount = 0;
            let runningSum = 0;
            for (let i = 0; i <= CONFIG.MAX_TRACKED_CMC; i++) {
                const count = cmcDistribution[i] || 0;
                runningCount += count;
                runningSum += count * i;
                
                cdf[i] = runningCount;
                prefixSumCmc[i] = runningSum;
            }
        }

        state = {
            deckSize,
            cmcDistribution,
            cdf,
            prefixSumCmc,
            xSpells,
            excludeXSpells,
            hasImportedData,
            preparedDeck,
            lands: config.lands,
            rawDeckHash 
        };

        simulationCache.set(rawDeckHash, state);
    }
    
    // Check if we need to regenerate samples (only if deck content changed)
    if (state.hasImportedData && state.rawDeckHash !== lastSampleDeckHash) {
        generateStableSamples(state.preparedDeck, 20); // Default count
        lastSampleDeckHash = state.rawDeckHash;
    }

    // Mix in the dynamic castCmc which doesn't affect the deck distribution
    return {
        ...state,
        castCmc: parseInt(document.getElementById('rashmi-cmcValue').value) || 4
    };
}

/**
 * Calculate probabilities for a given cast CMC using O(1) lookups
 */
function calculateRashmiProbability(state, castCmc) {
    const { deckSize, cdf, prefixSumCmc } = state;
    
    if (deckSize === 0 || castCmc === 0) {
        return { probFreeSpell: 0, probWhiff: 0, expectedCmc: 0 };
    }

    // Rashmi triggers for a spell with CMC < castCmc.
    // So we want the cumulative count for (castCmc - 1).
    const targetIndex = Math.min(Math.max(0, castCmc - 1), CONFIG.MAX_TRACKED_CMC);
    
    const countFree = cdf[targetIndex];
    const sumCmc = prefixSumCmc[targetIndex];

    const probFreeSpell = countFree / deckSize;
    const expectedCmc = countFree > 0 ? sumCmc / countFree : 0;

    return {
        probFreeSpell,
        probWhiff: 1 - probFreeSpell,
        expectedCmc
    };
}

/**
 * Calculate results for current deck configuration
 */
export function calculate() {
    const state = prepareSimulationState();

    if (state.deckSize === 0 || !state.hasImportedData) {
        return { config: state, results: {} };
    }

    const results = {};
    const minCmc = Math.max(1, state.castCmc - CONFIG.CMC_RANGE_BEFORE);
    const maxCmc = Math.min(state.castCmc + CONFIG.CMC_RANGE_AFTER, 15);

    for (let testCmc = minCmc; testCmc <= maxCmc; testCmc++) {
        results[testCmc] = calculateRashmiProbability(state, testCmc);
    }

    return { config: state, results };
}

/**
 * Update chart visualization
 */
function updateChart(config, results) {
    const cmcValues = Object.keys(results).map(Number).sort((a, b) => a - b);
    const probFreeSpellData = cmcValues.map(cmc => results[cmc].probFreeSpell * 100);
    const expectedCmcData = cmcValues.map(cmc => results[cmc].expectedCmc);

    chart = createOrUpdateChart(chart, 'rashmi-chart', {
        type: 'line',
        data: {
            labels: cmcValues.map(cmc => 'CMC ' + cmc),
            datasets: [
                {
                    label: 'P(Free Spell) %',
                    data: probFreeSpellData,
                    borderColor: '#55c97f',
                    backgroundColor: 'rgba(85, 201, 127, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: cmcValues.map(cmc => cmc === config.castCmc ? 8 : 4),
                    pointBackgroundColor: cmcValues.map(cmc => cmc === config.castCmc ? '#fff' : '#55c97f'),
                    yAxisID: 'yProb'
                },
                {
                    label: 'Expected Free CMC',
                    data: expectedCmcData,
                    borderColor: '#5b8db8',
                    backgroundColor: 'rgba(91, 141, 184, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: cmcValues.map(cmc => cmc === config.castCmc ? 8 : 4),
                    pointBackgroundColor: cmcValues.map(cmc => cmc === config.castCmc ? '#fff' : '#5b8db8'),
                    yAxisID: 'yCmc'
                }
            ]
        },
        options: {
            scales: {
                yProb: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    max: 100,
                    title: { display: true, text: 'P(Free Spell) %', color: '#55c97f' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#55c97f' }
                },
                yCmc: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Expected Free CMC', color: '#5b8db8' },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#5b8db8' }
                }
            }
        }
    });
}

/**
 * Compute P(free spell) across the full cast-CMC range for the sweep table and
 * the reliability recommendation.
 * @returns {Array<{x:number, prob:number, expectedCmc:number}>}
 */
function computeSweep(config) {
    const sweep = [];
    for (let cmc = 1; cmc <= 15; cmc++) {
        const r = calculateRashmiProbability(config, cmc);
        sweep.push({ x: cmc, prob: r.probFreeSpell, expectedCmc: r.expectedCmc });
    }
    return sweep;
}

/**
 * Render the cast-CMC sweep table.
 */
function updateTable(config) {
    const sweep = computeSweep(config);
    const rec = recommendThresholdX(sweep.map(p => ({ x: p.x, value: p.prob })), { target: 0.7 });
    const recommended = rec && rec.reason === 'threshold' ? rec.x : null;

    let prev = null;
    const rows = sweep.map(p => {
        const delta = prev != null ? p.prob - prev : null;
        prev = p.prob;
        return { ...p, delta };
    });

    renderSweepTable('rashmi-comparisonTable', {
        current: config.castCmc,
        recommended,
        rows,
        columns: [
            { label: 'CAST CMC', align: 'left', render: r => `${r.x}` },
            { label: 'P(FREE)', render: r => `<span style="color:var(--tx-green);">${formatPercentage(r.prob)}</span>` },
            { label: 'CHANCE', align: 'left', render: r => pBarCell(r.prob, 'var(--tx-green)') },
            { label: 'AVG FREE MV', render: r => `<span style="color:var(--tx-blue);">${formatNumber(r.expectedCmc, 2)}</span>` },
            { label: 'Δp', render: r => r.delta == null ? '—' : `<span style="color:${deltaColor(r.delta, 0.005)};">${formatDelta(r.delta * 100, 1, '%')}</span>` },
            { label: 'VERDICT', render: r => { const v = probabilityVerdict(r.prob); return `<span style="color:${v.color}; font-weight:600; letter-spacing:0.06em;">${v.label}</span>`; } }
        ]
    });
}

/**
 * Render hero numerics + verdict + recommendation for the current cast CMC.
 */
function updateStats(config, results) {
    const heroPanel = document.getElementById('rashmi-hero');
    const currentResult = results[config.castCmc];
    if (!heroPanel || !currentResult) return;

    const prob = currentResult.probFreeSpell;
    const next = results[config.castCmc + 1];
    const marginal = next ? next.probFreeSpell - prob : null;
    const verdict = probabilityVerdict(prob);

    const hero = renderHeroStats([
        { label: 'P(FREE SPELL)', value: formatPercentage(prob), sub: `casting CMC ${config.castCmc}`, color: 'var(--tx-green)', size: 'big' },
        { label: 'AVG FREE MV', value: formatNumber(currentResult.expectedCmc, 1), sub: 'value when it hits', color: 'var(--tx-blue)' },
        { label: 'WHIFF', value: formatPercentage(currentResult.probWhiff), sub: 'draw only', color: 'var(--tx-amber)' },
        { label: 'MARGINAL +1 CMC', value: marginal != null ? formatDelta(marginal * 100, 1, '%') : '—', sub: 'Δ trigger chance', color: marginal != null ? deltaColor(marginal, 0.001) : 'var(--tx-dim)' }
    ]);

    const sweep = computeSweep(config);
    const rec = recommendThresholdX(sweep.map(p => ({ x: p.x, value: p.prob })), { target: 0.7 });
    let recBanner = '';
    if (rec && rec.reason === 'threshold') {
        recBanner = renderRecommendation(`Rashmi reliably triggers (≥70%) once you cast <strong>CMC ${rec.x}+</strong> spells. Build your curve so your payoff spells sit above that line.`);
    } else if (rec) {
        recBanner = renderRecommendation(`Even your most expensive spells top out at <strong>${formatPercentage(rec.value)}</strong> — add more cheap spells to make Rashmi consistent.`);
    }

    const insight = renderInsightBox('', `Casting a CMC ${config.castCmc} spell flips the top card; a free cast needs a non-land with CMC &lt; ${config.castCmc}. ${renderVerdictBadge(verdict)} ${verdict.advice}`);

    heroPanel.innerHTML = hero + recBanner + insight;
}

/**
 * Update CMC distribution breakdown table
 */
function updateCMCBreakdown(config) {
    const cmcs = Object.keys(config.cmcDistribution).map(Number).sort((a, b) => a - b);
    let breakdownHTML = '<h2>Deck CMC Distribution</h2>';

    if (config.xSpells && config.xSpells.length > 0) {
        const totalXSpells = config.xSpells.reduce((sum, spell) => sum + spell.count, 0);
        const statusText = config.excludeXSpells ? 'excluded from calculation' : `counted at their base CMC`;

        breakdownHTML += `
            <div style="margin-bottom: var(--spacing-md); padding: var(--spacing-md); background: rgba(240, 169, 44, 0.08); border: 1px solid rgba(240, 169, 44, 0.28); border-radius: var(--radius-md);">
                <strong style="color: #f0a92c;">▲ X spells detected (${totalXSpells} cards ${statusText}):</strong><br>
                <small style="color: var(--text-dim); display: block; margin-top: 4px; font-style: italic;">
                    Note: When revealed from library, X=0, so these can't be cast for free with Rashmi
                </small>
            </div>
        `;
    }

    breakdownHTML += '<div class="table-wrapper"><table class="comparison-table">';
    breakdownHTML += '<tr><th>CMC</th><th>Cards</th><th>% of Deck</th><th>Can Cast Free?</th></tr>';

    cmcs.forEach(cmc => {
        const count = config.cmcDistribution[cmc];
        const canCast = cmc < config.castCmc;
        const canCastClass = canCast ? 'marginal-positive' : 'marginal-negative';
        const canCastText = canCast ? '✓ Yes' : '✗ No';

        breakdownHTML += `
            <tr>
                <td>${cmc}</td>
                <td>${count}</td>
                <td>${formatPercentage(count / config.deckSize)}</td>
                <td class="${canCastClass}">${canCastText}</td>
            </tr>
        `;
    });

    breakdownHTML += '</table></div>';
    document.getElementById('rashmi-breakdown').innerHTML = breakdownHTML;
}

/**
 * Force refresh of stable samples (e.g., when user clicks Redraw)
 */
function refreshSamples() {
    const config = prepareSimulationState();
    if (config.hasImportedData && config.preparedDeck.length > 0) {
        const countInput = document.getElementById('rashmi-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        generateStableSamples(config.preparedDeck, numSims);
        runSampleReveals(); // Re-render
    }
}

/**
 * Run sample Rashmi reveals using stable samples
 */
export function runSampleReveals() {
    const config = prepareSimulationState();

    if (!config.hasImportedData) {
        const display = document.getElementById('rashmi-reveals-display');
        if (display) display.innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('rashmi-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
    
    // Ensure we have enough samples if the user increased the count
    if (stableSamples.length < numSims) {
        generateStableSamples(config.preparedDeck, numSims);
    }

    let revealsHTML = '';
    let hitCount = 0;
    let totalFreeCMC = 0;
    const freeCmcDist = [];

    // 1. STATS LOOP (Full Simulation)
    // Use the stable samples!
    for (let i = 0; i < numSims; i++) {
        const revealedCard = stableSamples[i];
        
        // Safety check if something went wrong
        if (!revealedCard) continue;

        const cardCmc = revealedCard.cmc || 0;
        const isX = isXSpell(revealedCard.mana_cost);
        const isLand = revealedCard.types.includes('land');
        
        let isFree = !isLand && cardCmc < config.castCmc;
        if (isFree && isX && config.excludeXSpells) isFree = false;

        if (isFree) {
            hitCount++;
            totalFreeCMC += cardCmc;
            freeCmcDist[cardCmc] = (freeCmcDist[cardCmc] || 0) + 1;
        }
    }

    // 2. Build Summary UI
    const hitPct = (hitCount / numSims * 100).toFixed(1);
    const missPct = (100 - parseFloat(hitPct)).toFixed(1);
    
    for (let i = 0; i < freeCmcDist.length; i++) if (!freeCmcDist[i]) freeCmcDist[i] = 0;
    const avgFreeCMC = hitCount > 0 ? (totalFreeCMC / hitCount).toFixed(2) : '—';

    const distributionHTML = renderSimulationSummary({
        title: `Free cast at MV ${config.castCmc}`,
        runs: numSims,
        metrics: [
            { label: 'Free cast rate', value: `${hitPct}%`, sub: 'triggers that cast something', color: probabilityVerdict(hitCount / numSims).color },
            { label: 'Avg free MV', value: avgFreeCMC, sub: 'mana value cheated', color: 'var(--tx-accent)' },
            { label: 'Draw only', value: `${missPct}%`, sub: 'no free spell', color: 'var(--tx-mid)' }
        ],
        distribution: hitCount > 0 ? {
            title: 'Free cast mana value — distribution',
            counts: freeCmcDist,
            totalSims: numSims,
            labelFn: (i) => `MV ${i}`,
            markerFn: () => null
        } : null,
        outcomes: [
            { label: 'Free spell cast', value: hitCount / numSims, good: true },
            { label: 'Draw only', value: (numSims - hitCount) / numSims, good: false }
        ]
    });


    // 3. Prepare List Container
    const listId = 'rashmi-samples-list';
    const btnId = 'rashmi-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(`Show/Hide Individual Reveals (${numSims} simulations)`, listHTML, true);
    document.getElementById('rashmi-reveals-display').innerHTML = distributionHTML + revealsSectionHTML;

    // 4. Render Batch Function
    const listContainer = document.getElementById(listId);
    const loadMoreBtn = document.getElementById(btnId);
    renderedCount = 0;

    const renderBatch = (batchSize) => {
        const start = renderedCount;
        const end = Math.min(start + batchSize, numSims);
        let html = '';

        for (let i = start; i < end; i++) {
            const revealedCard = stableSamples[i];
            if (!revealedCard) continue;

            const cardCmc = revealedCard.cmc || 0;
            const isX = isXSpell(revealedCard.mana_cost);
            const isLand = revealedCard.types.includes('land');
            
            let isFree = !isLand && cardCmc < config.castCmc;
            if (isFree && isX && config.excludeXSpells) isFree = false;

            html += `<div class="sample-reveal ${isFree ? 'free-spell' : 'whiff'}">`;
            html += `<div><strong>Reveal ${i + 1}:</strong></div>`;
            html += '<div style="margin: 8px 0;">';
            html += renderCardBadge(revealedCard);
            
            if (isFree) {
                html += `<span style="margin-left: 8px; color: #55c97f; font-weight: bold;">CAST FREE!${isX ? ' (X=0)' : ''}</span>`;
            } else {
                let reason = isLand ? '(Land)' : (cardCmc >= config.castCmc ? `(CMC ${cardCmc} too high)` : '(X Spell excluded)');
                html += `<span style="margin-left: 8px; color: #e8635c;">Draw card ${reason}</span>`;
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
    const { results, config } = calculate();
    const importWarning = document.getElementById('rashmi-import-warning');
    const statsSection = document.getElementById('rashmi-stats');
    const breakdownSection = document.getElementById('rashmi-breakdown');
    const heroSection = document.getElementById('rashmi-hero');

    if (!config.hasImportedData) {
        if (importWarning) importWarning.style.display = 'block';
        if (statsSection) statsSection.style.display = 'none';
        if (breakdownSection) breakdownSection.style.display = 'none';
        if (heroSection) heroSection.style.display = 'none';
        if (chart) { chart.destroy(); chart = null; }
        const table = document.getElementById('rashmi-comparisonTable');
        if (table) table.innerHTML = '';
        return;
    }

    if (importWarning) importWarning.style.display = 'none';
    if (statsSection) statsSection.style.display = 'block';
    if (breakdownSection) breakdownSection.style.display = 'block';
    if (heroSection) heroSection.style.display = 'block';

    if (config.deckSize === 0 || Object.keys(results).length === 0) {
        if (chart) chart.destroy();
        const table = document.getElementById('rashmi-comparisonTable');
        if (table) table.innerHTML = '';
        return;
    }

    updateStats(config, results);
    updateChart(config, results);
    updateTable(config);
    updateCMCBreakdown(config);

    if (document.getElementById('rashmi-reveals-display')) {
        runSampleReveals();
    }
}

/**
 * Initialize Rashmi calculator
 */
export function init() {
    registerCalculator({
        name: 'rashmi',
        calculate,
        updateUI,
        inputs: ['cmc'],
        init: (debouncedUpdate) => {
            const container = document.getElementById('rashmi-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('rashmi', 'Sample Cast Triggers');
            }
            const excludeCheckbox = document.getElementById('rashmi-exclude-x');
            if (excludeCheckbox) excludeCheckbox.addEventListener('change', () => debouncedUpdate());

            const revealBtn = document.getElementById('rashmi-draw-reveals-btn');
            // Changed to call refreshSamples instead of runSampleReveals directly
            if (revealBtn) revealBtn.addEventListener('click', () => refreshSamples());
        }
    });
}