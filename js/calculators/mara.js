/**
 * Ensnared by the Mara Calculator
 * Simulates villainous choice outcomes for opponent decks
 *
 * Card Effect:
 * Each opponent faces a villainous choice:
 * - Choice 1: Exile cards from top until nonland, you cast it free
 * - Choice 2: Exile top 4 cards, deal damage = total mana value
 */

import { createCache } from '../utils/simulation.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, generateSampleRevealsHTML } from '../utils/components.js';
import { shuffleDeck, renderCardBadge, createCollapsibleSection, TYPE_COLORS, buildDeckFromCardData } from '../utils/sampleSimulator.js';
import * as OpponentState from '../utils/opponentState.js';

const CONFIG = {
    DEFAULT_SAMPLE_SIZE: 500,
    DEFAULT_SIM_COUNT: 5000
};

let simulationCache = createCache(50);

// Stable samples for each opponent
const stableSamples = {
    opponent1: [],
    opponent2: [],
    opponent3: []
};

// Track rendered count for batch rendering per opponent
const renderedCounts = {
    opponent1: 0,
    opponent2: 0,
    opponent3: 0
};

/**
 * Render a compact horizontal bar chart (no gaps, shows all values)
 */
function renderCompactChart(data, totalSims, labelFn, barColor = '#ef4444', labelWidth = 28) {
    let html = '<div class="compact-dist-chart" style="display: flex; flex-direction: column; gap: 2px;">';

    for (let i = 0; i < data.length; i++) {
        const count = data[i] || 0;
        const pct = (count / totalSims * 100);
        const pctStr = pct.toFixed(1) + '%';

        html += `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8em;">
                <div style="width: ${labelWidth}px; text-align: right; color: var(--text-dim); white-space: nowrap;">${labelFn(i)}</div>
                <div style="flex: 1; height: 14px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: 2px;"></div>
                </div>
                <div style="width: 42px; text-align: right; color: var(--text-secondary);">${pctStr}</div>
            </div>
        `;
    }

    html += '</div>';
    return html;
}

/**
 * Simulate Choice 1: Exile until nonland
 * @param {Array} deck - Shuffled deck array
 * @returns {Object} - { cardsExiled, spellCMC, spellName, spellTypes }
 */
export function simulateChoice1(deck) {
    for (let i = 0; i < deck.length; i++) {
        if (!deck[i].types.includes('land')) {
            return {
                cardsExiled: i + 1,
                spellCMC: deck[i].cmc || 0,
                spellName: deck[i].name,
                spellTypes: deck[i].types
            };
        }
    }
    // Edge case: all lands (extremely rare but possible)
    return { cardsExiled: deck.length, spellCMC: 0, spellName: null, spellTypes: [] };
}

/**
 * Simulate Choice 2: Top 4 CMC sum as damage
 * @param {Array} deck - Shuffled deck
 * @returns {Object} - { damage, cards }
 */
export function simulateChoice2(deck) {
    const top4 = deck.slice(0, 4);
    const damage = top4.reduce((sum, card) => sum + (card.cmc || 0), 0);
    return {
        damage,
        cards: top4.map(c => ({ name: c.name, cmc: c.cmc || 0, types: c.types }))
    };
}

/**
 * Calculate Mara statistics for an opponent deck
 * @param {Object} opponentData - Opponent deck data with cardsByName
 * @param {number} numSims - Number of simulations
 * @returns {Object} - Statistics for both choices
 */
export function calculateMaraStats(opponentData, numSims = CONFIG.DEFAULT_SIM_COUNT) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) {
        return null;
    }

    // Build deck directly from passed data (works for both tests and app)
    const deck = buildDeckFromCardData(opponentData);

    if (!deck || deck.length === 0) return null;

    // Choice 1 accumulators
    let totalChoice1CMC = 0;
    let totalChoice1Exiled = 0;
    const choice1CMCDistribution = {};
    let choice1Hits5Plus = 0;

    // Choice 2 accumulators
    let totalChoice2Damage = 0;
    let minDamage = Infinity;
    let maxDamage = 0;
    const choice2DamageDistribution = {};

    for (let i = 0; i < numSims; i++) {
        const shuffled = shuffleDeck([...deck]);

        // Choice 1
        const c1 = simulateChoice1(shuffled);
        totalChoice1CMC += c1.spellCMC;
        totalChoice1Exiled += c1.cardsExiled;
        choice1CMCDistribution[c1.spellCMC] = (choice1CMCDistribution[c1.spellCMC] || 0) + 1;
        if (c1.spellCMC >= 5) choice1Hits5Plus++;

        // Choice 2
        const c2 = simulateChoice2(shuffled);
        totalChoice2Damage += c2.damage;
        minDamage = Math.min(minDamage, c2.damage);
        maxDamage = Math.max(maxDamage, c2.damage);
        choice2DamageDistribution[c2.damage] = (choice2DamageDistribution[c2.damage] || 0) + 1;
    }

    return {
        choice1: {
            avgCMC: totalChoice1CMC / numSims,
            avgExiled: totalChoice1Exiled / numSims,
            pct5Plus: (choice1Hits5Plus / numSims) * 100,
            cmcDistribution: choice1CMCDistribution
        },
        choice2: {
            avgDamage: totalChoice2Damage / numSims,
            minDamage: minDamage === Infinity ? 0 : minDamage,
            maxDamage,
            damageDistribution: choice2DamageDistribution
        },
        numSims,
        deckSize: deck.length
    };
}

/**
 * Generate stable samples for an opponent
 */
function generateStableSamples(opponentKey, count) {
    const deck = OpponentState.buildOpponentDeck(opponentKey);
    if (!deck) {
        stableSamples[opponentKey] = [];
        return;
    }

    stableSamples[opponentKey] = [];
    for (let i = 0; i < count; i++) {
        stableSamples[opponentKey].push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh samples for all opponents and re-render
 */
function refreshSamples() {
    const countInput = document.getElementById('mara-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);

    for (const opp of OpponentState.getActiveOpponents()) {
        if (OpponentState.getOpponentData(opp)?.cardsByName &&
            Object.keys(OpponentState.getOpponentData(opp).cardsByName).length > 0) {
            generateStableSamples(opp, numSims);
        }
    }

    runSampleReveals();
}

/**
 * Render results for all active opponents
 */
function renderResults() {
    const resultsContainer = document.getElementById('mara-results');
    if (!resultsContainer) return;

    const opponentsWithData = OpponentState.getOpponentsWithData();

    if (opponentsWithData.length === 0) {
        resultsContainer.innerHTML = `
            <h2>Results</h2>
            <p style="color: var(--text-dim); text-align: center; padding: 20px;">
                Import at least one opponent's decklist to see analysis.
            </p>
        `;
        return;
    }

    // Calculate totals for summary
    let totalFreeCastCMC = 0;
    let totalDamage = 0;
    const allStats = [];

    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        const stats = calculateMaraStats(data);
        if (stats) {
            allStats.push({ opp, data, stats });
            totalFreeCastCMC += stats.choice1.avgCMC;
            totalDamage += stats.choice2.avgDamage;
        }
    }

    let html = '<h2>Choice Analysis</h2>';

    // Summary section
    if (allStats.length > 0) {
        html += `
            <div class="summary-stats-box">
                <h3>Summary: Your Expected Gains</h3>
                <div class="summary-stats-grid">
                    <div class="summary-stat purple">
                        <div class="stat-label">If All Choose Free Cast</div>
                        <div class="stat-value">${totalFreeCastCMC.toFixed(1)}</div>
                        <div class="stat-unit">total CMC value</div>
                    </div>
                    <div class="summary-stat red">
                        <div class="stat-label">If All Choose Damage</div>
                        <div class="stat-value">${totalDamage.toFixed(1)}</div>
                        <div class="stat-unit">damage total</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Individual opponent results
    for (const { opp, data, stats } of allStats) {
        html += `
            <div class="opponent-results">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm);">
                    <h3 style="color: var(--mara-primary, #dc2626);">${data.name}</h3>
                    <span style="color: var(--text-dim); font-size: 0.85em;">${stats.deckSize} cards</span>
                </div>

                <div class="choice-grid">
                    <div class="choice-card choice-purple">
                        <div class="choice-label">Choice 1: Free Cast</div>
                        <div style="display: flex; gap: var(--spacing-md); flex-wrap: wrap;">
                            <div><span style="font-size: 1.3em; font-weight: bold; color: #a855f7;">${stats.choice1.avgCMC.toFixed(1)}</span> <span style="font-size: 0.75em; color: var(--text-dim);">avg CMC</span></div>
                            <div><span style="font-size: 1.3em; font-weight: bold;">${stats.choice1.avgExiled.toFixed(1)}</span> <span style="font-size: 0.75em; color: var(--text-dim);">cards exiled</span></div>
                            <div><span style="font-size: 1.3em; font-weight: bold;">${stats.choice1.pct5Plus.toFixed(0)}%</span> <span style="font-size: 0.75em; color: var(--text-dim);">CMC 5+</span></div>
                        </div>
                    </div>

                    <div class="choice-card choice-red">
                        <div class="choice-label">Choice 2: Damage</div>
                        <div style="display: flex; gap: var(--spacing-md); flex-wrap: wrap;">
                            <div><span style="font-size: 1.3em; font-weight: bold; color: #ef4444;">${stats.choice2.avgDamage.toFixed(1)}</span> <span style="font-size: 0.75em; color: var(--text-dim);">avg dmg</span></div>
                            <div><span style="font-size: 1.3em; font-weight: bold;">${stats.choice2.minDamage}-${stats.choice2.maxDamage}</span> <span style="font-size: 0.75em; color: var(--text-dim);">range</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    resultsContainer.innerHTML = html;
}

/**
 * Run sample reveals
 */
export function runSampleReveals() {
    const displayContainer = document.getElementById('mara-reveals-display');
    if (!displayContainer) return;

    const opponentsWithData = OpponentState.getOpponentsWithData();

    if (opponentsWithData.length === 0) {
        displayContainer.innerHTML = '<p style="color: var(--text-dim);">Please import opponent decklists to run simulations.</p>';
        return;
    }

    const countInput = document.getElementById('mara-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);

    // Ensure we have stable samples for all opponents
    for (const opp of opponentsWithData) {
        if (!stableSamples[opp] || stableSamples[opp].length < numSims) {
            generateStableSamples(opp, numSims);
        }
    }

    let fullHTML = '';

    // Process each opponent
    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        const samples = stableSamples[opp];

        // Stats loop
        let totalChoice1CMC = 0;
        let totalChoice2Damage = 0;
        const choice1CMCDist = {};
        const choice2DamageDist = {};
        let maxCMC = 0;
        let maxDamage = 0;

        for (let i = 0; i < numSims; i++) {
            const shuffled = samples[i];
            const c1 = simulateChoice1(shuffled);
            const c2 = simulateChoice2(shuffled);

            totalChoice1CMC += c1.spellCMC;
            totalChoice2Damage += c2.damage;

            choice1CMCDist[c1.spellCMC] = (choice1CMCDist[c1.spellCMC] || 0) + 1;
            choice2DamageDist[c2.damage] = (choice2DamageDist[c2.damage] || 0) + 1;

            if (c1.spellCMC > maxCMC) maxCMC = c1.spellCMC;
            if (c2.damage > maxDamage) maxDamage = c2.damage;
        }

        // Convert to arrays
        const cmcDistArray = new Array(Math.min(maxCMC + 1, 12)).fill(0);
        for (const [cmc, freq] of Object.entries(choice1CMCDist)) {
            const idx = Math.min(parseInt(cmc), 11);
            cmcDistArray[idx] = (cmcDistArray[idx] || 0) + freq;
        }

        // Bin damage
        const damageBins = [0, 0, 0, 0, 0, 0, 0];
        const damageBinLabels = ['0-3', '4-6', '7-9', '10-12', '13-15', '16-18', '19+'];
        for (const [dmg, freq] of Object.entries(choice2DamageDist)) {
            const d = parseInt(dmg);
            let binIdx;
            if (d <= 3) binIdx = 0;
            else if (d <= 6) binIdx = 1;
            else if (d <= 9) binIdx = 2;
            else if (d <= 12) binIdx = 3;
            else if (d <= 15) binIdx = 4;
            else if (d <= 18) binIdx = 5;
            else binIdx = 6;
            damageBins[binIdx] += freq;
        }

        const avgCMC = (totalChoice1CMC / numSims).toFixed(1);
        const avgDamage = (totalChoice2Damage / numSims).toFixed(1);

        // Build UI
        let oppHTML = `<div style="margin-bottom: var(--spacing-lg); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md); border: 1px solid var(--glass-border);">`;
        oppHTML += `<h4 style="margin-top: 0; color: var(--mara-primary, #dc2626);">${data.name}</h4>`;

        // Stats summary
        oppHTML += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-md); margin-bottom: var(--spacing-md);">`;
        oppHTML += `<div style="text-align: center; padding: var(--spacing-sm); background: rgba(168, 85, 247, 0.1); border-radius: var(--radius-sm);">`;
        oppHTML += `<small style="color: var(--text-dim);">Avg Free Spell CMC</small><br>`;
        oppHTML += `<strong style="color: #a855f7; font-size: 1.4em;">${avgCMC}</strong>`;
        oppHTML += `</div>`;
        oppHTML += `<div style="text-align: center; padding: var(--spacing-sm); background: rgba(239, 68, 68, 0.1); border-radius: var(--radius-sm);">`;
        oppHTML += `<small style="color: var(--text-dim);">Avg Damage (Top 4)</small><br>`;
        oppHTML += `<strong style="color: #ef4444; font-size: 1.4em;">${avgDamage}</strong>`;
        oppHTML += `</div></div>`;

        // Distribution charts
        oppHTML += `<div style="margin-bottom: var(--spacing-md);">`;
        oppHTML += `<h5 style="margin: 0 0 var(--spacing-sm) 0; color: #a855f7;">Choice 1: Free Spell CMC</h5>`;
        oppHTML += renderCompactChart(cmcDistArray, numSims, (idx) => `${idx}`, '#a855f7');
        oppHTML += `</div>`;

        oppHTML += `<div style="margin-bottom: var(--spacing-md);">`;
        oppHTML += `<h5 style="margin: 0 0 var(--spacing-sm) 0; color: #f87171;">Choice 2: Damage</h5>`;
        oppHTML += renderCompactChart(damageBins, numSims, (idx) => damageBinLabels[idx] || `${idx}`, '#ef4444', 36);
        oppHTML += `</div>`;

        // Sample list
        const listId = `mara-${opp}-samples-list`;
        const btnId = `mara-${opp}-load-more`;
        const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: var(--spacing-md); display: none;">Load More</button>`;

        oppHTML += createCollapsibleSection('Show/Hide Sample Simulations', listHTML, false);
        oppHTML += `</div>`;
        fullHTML += oppHTML;
    }

    displayContainer.innerHTML = fullHTML;

    // Batch render samples
    for (const opp of opponentsWithData) {
        const listContainer = document.getElementById(`mara-${opp}-samples-list`);
        const loadMoreBtn = document.getElementById(`mara-${opp}-load-more`);
        const samples = stableSamples[opp];

        renderedCounts[opp] = 0;

        const renderBatch = (batchSize) => {
            const start = renderedCounts[opp];
            const end = Math.min(start + batchSize, numSims);
            let html = '';

            for (let i = start; i < end; i++) {
                const shuffled = samples[i];
                const c1 = simulateChoice1(shuffled);
                const c2 = simulateChoice2(shuffled);

                const revealedCards = shuffled.slice(0, c1.cardsExiled);
                const revealHtml = revealedCards.map(card => renderCardBadge(card)).join(' ');

                const top4Html = c2.cards.map(card =>
                    `<span class="cmc-badge" style="background: ${card.types.includes('land') ? TYPE_COLORS.land : 'var(--mara-primary, #dc2626)'};">${card.cmc}</span>`
                ).join(' ');

                const isGoodCast = c1.spellCMC >= 4;

                html += `<div class="sample-reveal ${isGoodCast ? 'free-spell' : 'whiff'}" style="padding: var(--spacing-sm); margin-bottom: var(--spacing-xs); background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); font-size: 0.85em;">`;
                html += `<div style="margin-bottom: var(--spacing-xs);"><strong>Sample ${i + 1}:</strong></div>`;
                html += `<div style="margin-bottom: var(--spacing-xs);">`;
                html += `<span style="color: #a855f7; font-weight: 600;">C1:</span> ${revealHtml}`;
                html += c1.spellName
                    ? ` → <span style="color: var(--success); font-weight: 600;">${c1.spellName}</span> <span style="color: var(--text-dim);">(${c1.spellCMC} CMC)</span>`
                    : ` → <span style="color: var(--danger);">All lands!</span>`;
                html += `</div>`;
                html += `<div>`;
                html += `<span style="color: var(--danger); font-weight: 600;">C2:</span> ${top4Html} = <span style="color: var(--danger); font-weight: bold;">${c2.damage} damage</span>`;
                html += `</div>`;
                html += `</div>`;
            }

            if (listContainer) {
                listContainer.insertAdjacentHTML('beforeend', html);
            }

            renderedCounts[opp] = end;

            if (loadMoreBtn) {
                if (renderedCounts[opp] < numSims) {
                    loadMoreBtn.style.display = 'block';
                    loadMoreBtn.textContent = `Load More (Showing ${renderedCounts[opp]}/${numSims})`;
                } else {
                    loadMoreBtn.style.display = 'none';
                }
            }
        };

        renderBatch(20);

        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => renderBatch(50));
        }
    }
}

/**
 * Main calculation function
 */
export function calculate() {
    const results = {};

    for (const opp of OpponentState.getActiveOpponents()) {
        const data = OpponentState.getOpponentData(opp);
        if (data?.cardsByName && Object.keys(data.cardsByName).length > 0) {
            const cacheKey = `mara-${opp}-${data.deckSize}-${Object.keys(data.cardsByName).length}`;
            const cached = simulationCache.get(cacheKey);
            if (cached) {
                results[opp] = cached;
            } else {
                const stats = calculateMaraStats(data);
                if (stats) {
                    simulationCache.set(cacheKey, stats);
                    results[opp] = stats;
                }
            }
        }
    }

    return results;
}

/**
 * Update UI
 */
export function updateUI() {
    renderResults();

    const hasAnyDeckData = OpponentState.hasAnyDeckData();

    const sampleBtn = document.getElementById('mara-draw-reveals-btn');
    const importNote = document.querySelector('#mara-sample-reveals .sim-import-note');
    if (sampleBtn) {
        sampleBtn.disabled = !hasAnyDeckData;
    }
    if (importNote) {
        importNote.style.display = hasAnyDeckData ? 'none' : 'inline';
    }

    if (hasAnyDeckData) {
        runSampleReveals();
    }
}

/**
 * Initialize the calculator
 */
export function init() {
    // Register for opponent data changes
    OpponentState.onOpponentChange(() => {
        simulationCache.clear();
        // Clear stable samples when opponent data changes
        for (const key of Object.keys(stableSamples)) {
            stableSamples[key] = [];
        }
        updateUI();
    });

    registerCalculator({
        name: 'mara',
        calculate,
        updateUI,
        init: () => {
            const sampleContainer = document.getElementById('mara-sample-reveals');
            if (sampleContainer) {
                sampleContainer.innerHTML = generateSampleRevealsHTML('mara', 'Sample Mara Reveals', { requiresImport: true });
            }

            const sampleBtn = document.getElementById('mara-draw-reveals-btn');
            if (sampleBtn) {
                sampleBtn.addEventListener('click', refreshSamples);
            }

            updateUI();
        }
    });
}

/**
 * Get opponent deck URLs (for share.js) - delegates to shared state
 */
export function getOpponentUrls() {
    return OpponentState.getOpponentUrls();
}

/**
 * Set opponent deck URL (for share.js restore) - delegates to shared state
 */
export async function setOpponentUrl(opponentKey, url) {
    return OpponentState.setOpponentUrl(opponentKey, url);
}
