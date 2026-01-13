/**
 * Monstrous Vortex Calculator
 * Simulates discover value from casting creatures with power 5+
 *
 * Card text: "Whenever you cast a creature spell with power 5 or greater,
 * discover X, where X is that spell's mana value."
 */

import { createCache, formatNumber, debounce } from '../utils/simulation.js';
import { renderMultiColumnTable } from '../utils/tableUtils.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, renderDistributionChart,
    createCollapsibleSection
} from '../utils/sampleSimulator.js';

/**
 * Check if power is 5 or greater, optionally treating * or X as 5+
 * @param {string|number} powerStr - Power string (e.g. "5", "*", "1+*", "X") or number
 * @param {boolean} treatStarAs5Plus - Whether to treat * or X as 5+
 * @returns {boolean}
 */
function isCreaturePower5Plus(powerStr, treatStarAs5Plus) {
    if (powerStr === undefined || powerStr === null) return false;
    const str = String(powerStr);
    // Check for * or X
    if (str.includes('*') || str.includes('X')) {
        return treatStarAs5Plus;
    }
    const p = parseInt(str);
    return !isNaN(p) && p >= 5;
}

const CONFIG = {
    CMC_RANGE: [3, 4, 5, 6, 7, 8, 9, 10], // Test different CMCs for creatures cast
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
    // For Vortex, a sample is a full shuffle because discover goes deep into the deck.
    for (let i = 0; i < Math.max(count, CONFIG.DEFAULT_SAMPLE_SIZE); i++) {
        stableSamples.push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh of stable samples (e.g., when user clicks Redraw)
 */
function refreshSamples() {
    const config = getDeckConfig();
    const cardData = { cardsByName: DeckConfig.getImportedCardData().cardsByName };

    if (config.cardDetails && config.cardDetails.length > 0) {
        const countInput = document.getElementById('vortex-sample-count');
        const numSims = Math.max(1, parseInt(countInput?.value) || CONFIG.DEFAULT_SAMPLE_SIZE);
        const deck = buildDeckFromCardData(cardData);
        generateStableSamples(deck, numSims);
        runSampleReveals(); // Re-render
    }
}

/**
 * Run sample Discover reveals using stable samples
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    const cardData = { cardsByName: DeckConfig.getImportedCardData().cardsByName };

    if (!config.cardDetails || config.cardDetails.length === 0) {
        document.getElementById('vortex-reveals-display').innerHTML = '<p style="color: var(--text-dim);">Please import a decklist to run simulations.</p>';
        return;
    }

    // Get number of simulations
    const countInput = document.getElementById('vortex-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || 10);

    // Build deck if needed for generating samples
    const deck = buildDeckFromCardData(cardData);

    // Ensure we have stable samples
    if (stableSamples.length < numSims) {
        generateStableSamples(deck, numSims);
    }

    // 1. STATS LOOP (Full Simulation)
    let totalFreeMana = 0;
    let totalSpells = 0;
    const spellsCastDist = new Array(10).fill(0); // Track chains 0-9+

    for (let i = 0; i < numSims; i++) {
        const shuffled = stableSamples[i];
        let currentDiscoverCMC = config.creatureCMC;
        let deckIndex = 0;
        let chainCount = 0;
        let chainMana = 0;
        
        // Chain loop
        while (chainCount < 10 && deckIndex < shuffled.length) {
            // Reveal cards until hit
            let hitCard = null;

            for (; deckIndex < shuffled.length; deckIndex++) {
                const card = shuffled[deckIndex];
                
                // Determine if land (CMC 0 and type land)
                const isLand = card.types.includes('land');
                
                if (isLand) {
                    continue;
                }

                // Non-land. Check CMC.
                if (card.cmc <= currentDiscoverCMC) {
                    hitCard = card;
                    deckIndex++; // Consume this card
                    break;
                }
            }

            if (hitCard) {
                // Determine if it chains
                const treatStarAs5Plus = document.getElementById('vortex-star-power')?.checked || false;
                const isCreature = hitCard.types.includes('creature');
                const isPower5Plus = isCreature && isCreaturePower5Plus(hitCard.power, treatStarAs5Plus);

                chainCount++;
                chainMana += hitCard.cmc;
                
                if (isPower5Plus) {
                    currentDiscoverCMC = hitCard.cmc;
                } else {
                    break; // End of chain
                }

            } else {
                break;
            }
        }

        totalSpells += chainCount;
        totalFreeMana += chainMana;
        spellsCastDist[Math.min(chainCount, 9)]++;
    }

    // 2. Build Summary UI
    let distributionHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md);">';
    distributionHTML += '<h4 style="margin-top: 0;">Spells Cast Distribution:</h4>';
    
    distributionHTML += renderDistributionChart(
        spellsCastDist,
        numSims,
        (count) => `${count} ${count === 1 ? 'spell ' : 'spells'}`,
        (count) => count >= 2 ? ' ⚡ CHAIN' : ''
    );

    distributionHTML += `<div style="margin-top: var(--spacing-md); text-align: center;">`;
    distributionHTML += `<strong>Average:</strong> ${(totalSpells / numSims).toFixed(2)} spells, ${(totalFreeMana / numSims).toFixed(1)} mana per trigger`;
    distributionHTML += '</div></div>';

    // 3. Prepare List Container
    const listId = 'vortex-samples-list';
    const btnId = 'vortex-load-more';
    const listHTML = `<div id="${listId}"></div><button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">Load More (50)</button>`;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Reveals (${numSims} simulations)`,
        listHTML,
        true
    );

    document.getElementById('vortex-reveals-display').innerHTML = distributionHTML + revealsSectionHTML;

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
            let currentDiscoverCMC = config.creatureCMC;
            let deckIndex = 0;
            let chainCount = 0;
            let chainMana = 0;
            let revealStepsHTML = '';
            let openDivs = 0;
            
            // Chain loop
            while (chainCount < 10 && deckIndex < shuffled.length) {
                // Reveal cards until hit
                const revealedCards = [];
                let hitCard = null;

                for (; deckIndex < shuffled.length; deckIndex++) {
                    const card = shuffled[deckIndex];
                    
                    // Determine if land (CMC 0 and type land)
                    const isLand = card.types.includes('land');
                    
                    if (isLand) {
                        revealedCards.push({ ...card, status: 'skipped' }); // Lands skipped by discover
                        continue;
                    }

                    // Non-land. Check CMC.
                    if (card.cmc <= currentDiscoverCMC) {
                        hitCard = card;
                        deckIndex++; // Consume this card
                        break;
                    } else {
                        revealedCards.push({ ...card, status: 'skipped' }); // Too high CMC
                    }
                }

                // Render this step
                revealStepsHTML += `<div style="margin-top: 8px; border-left: 2px solid var(--accent); padding-left: 8px;">`;
                openDivs++;

                revealStepsHTML += `<div style="font-size: 0.85em; color: var(--text-dim); margin-bottom: 4px;">Discover ${currentDiscoverCMC}:</div>`;
                revealStepsHTML += `<div>`;
                
                // Show skipped cards (limit to first few and last few if too many?)
                revealedCards.forEach(c => {
                     revealStepsHTML += `<span class="reveal-card dimmed" style="opacity: 0.5; transform: scale(0.9);" title="${c.name} (Skipped)">${c.name}</span>`;
                });

                if (hitCard) {
                    // Determine if it chains
                    const treatStarAs5Plus = document.getElementById('vortex-star-power')?.checked || false;
                    const isCreature = hitCard.types.includes('creature');
                    const isPower5Plus = isCreature && isCreaturePower5Plus(hitCard.power, treatStarAs5Plus);

                    const chainClass = isPower5Plus ? 'chain-trigger' : '';
                    const chainIcon = isPower5Plus ? ' ⚡' : '';
                    
                    revealStepsHTML += renderCardBadge(hitCard);
                    revealStepsHTML += `<span style="margin-left: 8px; color: ${isPower5Plus ? '#c084fc' : '#22c55e'}; font-weight: bold;">
                        ${isPower5Plus ? 'CAST & CHAIN!' : 'CAST'}
                    </span>`;

                    chainCount++;
                    chainMana += hitCard.cmc;
                    
                    revealStepsHTML += `</div>`; // Close content div

                    if (isPower5Plus) {
                        currentDiscoverCMC = hitCard.cmc;
                        // Prepare for next nested step
                        revealStepsHTML += `<div style="margin-left: 16px; border-left: 1px dashed rgba(255,255,255,0.1);">`;
                        openDivs++;
                    } else {
                        break; // End of chain
                    }

                } else {
                    revealStepsHTML += `<span style="color: #ef4444;">Exiled rest of deck (Whiff)</span>`;
                    revealStepsHTML += `</div>`; // Close content div
                    break;
                }
            }

            // Close all open divs
            for (let k = 0; k < openDivs; k++) {
                revealStepsHTML += `</div>`;
            }

            // Reveal container
            const isWhiff = chainCount === 0;
            html += `<div class="sample-reveal ${!isWhiff ? 'free-spell' : 'whiff'}" style="margin-bottom: 16px; padding: 12px; border: 1px solid var(--border-color, #333); border-radius: 8px;">`;
            html += `<div><strong>Reveal ${i + 1}:</strong> ${chainCount} spell${chainCount !== 1 ? 's' : ''} (${chainMana} mana)</div>`;
            html += revealStepsHTML;
            html += `</div>`;
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
 * Pre-calculate Expected Values for all CMCs using Dynamic Programming
 * @param {Array} cardDetails - Full card details
 * @param {Object} castCreature - Creature being cast (to exclude)
 * @returns {Object} - Map of CMC -> Expected Value Stats
 */
function precalculateExpectedValues(cardDetails, castCreature = null) {
    // 1. Filter out the cast creature from the potential pool
    // (This mimics the "rest of deck" state)
    let pool = cardDetails;
    if (castCreature && castCreature.isPower5Plus) {
        const idx = pool.findIndex(c => 
            c.name === castCreature.name && 
            c.cmc === castCreature.cmc && 
            c.isPower5Plus
        );
        if (idx !== -1) {
            // Remove one instance
            pool = [...pool.slice(0, idx), ...pool.slice(idx + 1)];
        }
    }

    // 3. DP Table
    // We compute E[cmc] for cmc = 0 to MaxCMC
    const maxDeckCMC = pool.reduce((max, c) => Math.max(max, c.cmc), 0);
    const dp = new Array(maxDeckCMC + 1).fill(null);

    // Helper: Valid cards for Discover(X) are all non-lands with CMC <= X
    
    let validCards = [];
    
    // Iterate from 0 to Max
    for (let x = 0; x <= maxDeckCMC; x++) {
        // Update valid set: add cards with CMC == x
        const newCards = pool.filter(c => c.cmc === x);
        validCards = validCards.concat(newCards);

        const count = validCards.length;
        if (count === 0) {
            dp[x] = {
                avgFreeMana: 0,
                avgSpells: 0,
                avgSpellCMC: 0,
                probChain: 0,
                poolCount: 0,
                chainCount: 0
            };
            continue;
        }

        // Compute E[X]
        // E[X] = (1/N) * Sum( Value(c) + (IsChain(c) ? E[c.cmc] : 0) )
        // Value(c) = c.cmc (free mana) or 1 (spell count)
        
        let accumulatedMana = 0;
        let accumulatedSpells = 0;
        let accumulatedSpellCMC = 0;
        let accumulatedProbChain = 0; // Probability of >1 spell (immediate chain)
        
        let countChainAtX = 0;
        let chainManaAtX = 0; // For free mana calc loop
        let chainSpellsAtX = 0; // For spells calc loop
        
        validCards.forEach(c => {
            // Immediate values
            accumulatedMana += c.cmc;
            accumulatedSpells += 1;
            accumulatedSpellCMC += c.cmc;
            
            if (c.isPower5Plus) {
                if (c.cmc < x) {
                    // Chained into lower CMC - fully resolved
                    const nested = dp[c.cmc];
                    accumulatedMana += nested.avgFreeMana;
                    accumulatedSpells += nested.avgSpells;
                    // For probChain: if we hit a chain starter, we successfully chained.
                    accumulatedProbChain += 1; 
                } else {
                    // Chained into same CMC (c.cmc === x)
                    // We'll handle the multiplier after
                    countChainAtX++;
                    accumulatedProbChain += 1;
                    
                    // Note: E[X] includes itself?
                    // E[X] = AvgImmediate + (ChainAtX_Count/N) * E[X] + (ChainLower_Sum/N)
                    // The ChainLower_Sum is already in accumulatedMana.
                    // The Immediate Sum is already in accumulatedMana.
                    // The missing part is (ChainAtX_Count/N) * E[X].
                    // So: E[X] = (Accumulated_So_Far / N) + (CountX / N) * E[X]
                    // E[X] * (1 - CountX/N) = Accumulated / N
                    // E[X] = (Accumulated / N) / (1 - CountX/N)
                    // E[X] = Accumulated / (N - CountX)
                }
            }
        });

        const N = validCards.length;
        // Avoid division by zero if all cards are CMC X chains (N - CountX = 0)
        // If N == CountX, it means EVERY valid card triggers a chain at the same CMC.
        // Infinite loop. Cap at reasonable number.
        const divisor = (N - countChainAtX);
        const multiplier = divisor > 0 ? (1 / divisor) : 100; // if infinite loop, just return big number
        
        // E[X] = Accumulated_Non_X_Chain_Parts / (1 - p) = Accumulated / (N * (1 - CountX/N)) = Accumulated / (N - CountX)
        // Wait, accumulatedMana contains the Base Value for ALL cards (N cards).
        // Let's re-verify algebra.
        // Sum = Sum_Base + Sum_Lower_Chain_EV + Sum_Same_Chain_EV
        // Sum_Same_Chain_EV = CountX * E[X]
        // E[X] = (Sum_Base + Sum_Lower_Chain_EV + CountX * E[X]) / N
        // N * E[X] = Sum_Partial + CountX * E[X]
        // (N - CountX) * E[X] = Sum_Partial
        // E[X] = Sum_Partial / (N - CountX)
        
        // My `accumulatedMana` variable contains `Sum_Base + Sum_Lower_Chain_EV`.
        // It does NOT contain CountX * E[X].
        // So the formula `accumulatedMana / (N - CountX)` is correct.
        
        dp[x] = {
            avgFreeMana: accumulatedMana * multiplier,
            avgSpells: accumulatedSpells * multiplier,
            avgSpellCMC: accumulatedSpellCMC / N, // Average CMC of the *immediate* hit (not recursive)
            probChain: accumulatedProbChain / N, // Chance that the immediate hit triggers a chain
            poolCount: N,
            chainCount: validCards.filter(c => c.isPower5Plus).length
        };
    }
    
    return dp;
}

/**
 * Simulate discover for a given creature CMC using mathematical EV
 */
function simulateDiscoverForCMC(cardDetails, creatureCMC, lands, castCreature = null, treatStarAs5Plus = false) {
    const cacheKey = `EV-${creatureCMC}-${cardDetails.length}-${lands}-${castCreature ? castCreature.name : 'none'}-${treatStarAs5Plus}`;
    const cached = simulationCache.get(cacheKey);
    if (cached) return cached;

    const dpTable = precalculateExpectedValues(cardDetails, castCreature);
    
    // Safety for CMC > max in deck
    const safeCMC = Math.min(creatureCMC, dpTable.length - 1);
    const stats = dpTable[safeCMC] || { avgFreeMana: 0, avgSpells: 0, avgSpellCMC: 0, probChain: 0, poolCount: 0, chainCount: 0 };
    
    // Discoverable cards list (for UI breakdown)
    // We need to reconstruct this list (filtered by CMC <= creatureCMC, excluding castCreature)
    let discoverableCards = cardDetails.filter(c => c.cmc <= creatureCMC);
    if (castCreature && castCreature.isPower5Plus) {
        const idx = discoverableCards.findIndex(c => 
            c.name === castCreature.name && 
            c.cmc === castCreature.cmc && 
            c.isPower5Plus
        );
        if (idx !== -1) {
            discoverableCards = [...discoverableCards.slice(0, idx), ...discoverableCards.slice(idx + 1)];
        }
    }

    const castableCards = discoverableCards.length;
    const power5PlusInRange = discoverableCards.filter(c => c.isPower5Plus).length;
    
    // Determine successful discoveries (Hit Rate)
    // Discover always hits unless deck is empty of valid targets.
    // In math model, hit rate is 1.0 if pool > 0, else 0.
    const successfulDiscoveries = castableCards > 0 ? 20000 : 0; // Mocking iterations for compatibility

    const result = {
        avgSpellCMC: stats.avgSpellCMC,
        avgFreeMana: stats.avgFreeMana,
        avgSpellsPerTrigger: stats.avgSpells,
        multiDiscoverRate: stats.probChain, // This is approx probability of at least 1 chain
        successfulDiscoveries: successfulDiscoveries,
        castableCards: castableCards,
        power5PlusInRange: power5PlusInRange,
        discoverableCards: discoverableCards
    };

    simulationCache.set(cacheKey, result);
    return result;
}

/**
 * Get current deck configuration with card details
 */
export function getDeckConfig() {
    const config = DeckConfig.getDeckConfig();
    const treatStarAs5Plus = document.getElementById('vortex-star-power')?.checked || false;

    // Check if we have card details (new format) or need to fall back to old format
    // Map details to update isPower5Plus based on checkbox
    let cardDetails = config.cardDetails || [];
    
    if (cardDetails.length > 0) {
        cardDetails = cardDetails.map(c => ({
            ...c,
            isPower5Plus: isCreaturePower5Plus(c.power, treatStarAs5Plus)
        }));
    }

    const lands = config.lands || 0;
    // Recalculate creaturesPower5Plus count based on new logic
    const creaturesPower5Plus = cardDetails.filter(c => c.isPower5Plus).length;

    // Clear cache if deck changed
    // Include checkbox state in hash
    const newHash = JSON.stringify(cardDetails) + lands + treatStarAs5Plus;
    
    // Check if we need to refresh stable samples
    const sampleHash = newHash; // Use same hash for simplicity
    if (sampleHash !== lastSampleDeckHash && cardDetails.length > 0) {
        const deck = buildDeckFromCardData({ cardsByName: DeckConfig.getImportedCardData().cardsByName });
        generateStableSamples(deck, 20);
        lastSampleDeckHash = sampleHash;
    }

    if (newHash !== lastDeckHash) {
        simulationCache.clear();
        lastDeckHash = newHash;
    }

    // Get current creature CMC from slider
    const creatureCMC = parseInt(document.getElementById('vortex-cmcValue')?.value) || 6;

    // Find power 5+ creatures at this CMC (these could be the creature being cast)
    const power5PlusAtCMC = cardDetails.filter(c => c.cmc === creatureCMC && c.isPower5Plus);

    // If there's exactly one power 5+ creature at this CMC, use it as the cast creature
    // Otherwise, we'll simulate as if we're casting a generic power 5+ creature at this CMC
    const castCreature = power5PlusAtCMC.length > 0 ? power5PlusAtCMC[0] : null;

    return {
        cardDetails,
        lands,
        creaturesPower5Plus,
        creatureCMC,
        castCreature,
        power5PlusAtCMC, // All power 5+ creatures at this CMC
        deckSize: cardDetails.length + lands,
        treatStarAs5Plus
    };
}

/**
 * Calculate results for different creature CMCs
 */
export function calculate() {
    const config = getDeckConfig();

    if (config.deckSize === 0 || config.creaturesPower5Plus === 0 || config.cardDetails.length === 0) {
        return { config, results: {} };
    }

    const results = {};

    // Calculate for each CMC in range
    CONFIG.CMC_RANGE.forEach(cmc => {
        // Find if there's a power 5+ creature at this CMC to exclude from the pool
        const power5PlusAtThisCMC = config.cardDetails.filter(c => c.cmc === cmc && c.isPower5Plus);
        const creatureToExclude = power5PlusAtThisCMC.length > 0 ? power5PlusAtThisCMC[0] : null;

        const stats = simulateDiscoverForCMC(config.cardDetails, cmc, config.lands, creatureToExclude, config.treatStarAs5Plus);
        results[cmc] = {
            creatureCMC: cmc,
            ...stats
        };
    });

    return { config, results };
}

/**
 * Update chart visualization
 */
function updateChart(config, results) {
    const cmcValues = CONFIG.CMC_RANGE;
    const freeManaData = cmcValues.map(cmc => results[cmc]?.avgFreeMana || 0);
    const avgSpellCMCData = cmcValues.map(cmc => results[cmc]?.avgSpellCMC || 0);
    const avgSpellsCastData = cmcValues.map(cmc => results[cmc]?.avgSpellsPerTrigger || 0);

    chart = createOrUpdateChart(chart, 'vortex-chart', {
        type: 'line',
        data: {
            labels: cmcValues.map(cmc => `${cmc} CMC`),
            datasets: [
                {
                    label: 'Avg Free Mana Value',
                    data: freeManaData,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: cmcValues.map(cmc => cmc === config.creatureCMC ? 8 : 4),
                    pointBackgroundColor: cmcValues.map(cmc => cmc === config.creatureCMC ? '#fff' : '#f97316'),
                    yAxisID: 'yMana'
                },
                {
                    label: 'Avg Spell CMC Found',
                    data: avgSpellCMCData,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: cmcValues.map(cmc => cmc === config.creatureCMC ? 8 : 4),
                    pointBackgroundColor: cmcValues.map(cmc => cmc === config.creatureCMC ? '#fff' : '#22c55e'),
                    yAxisID: 'yMana'
                },
                {
                    label: 'Avg Spells Cast',
                    data: avgSpellsCastData,
                    borderColor: '#c084fc',
                    backgroundColor: 'rgba(192, 132, 252, 0.1)',
                    fill: false,
                    tension: 0.3,
                    pointRadius: cmcValues.map(cmc => cmc === config.creatureCMC ? 8 : 4),
                    pointBackgroundColor: cmcValues.map(cmc => cmc === config.creatureCMC ? '#fff' : '#c084fc'),
                    yAxisID: 'ySpells'
                }
            ]
        },
        options: {
            scales: {
                yMana: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    title: { display: true, text: 'Mana Value', color: '#f97316' },
                    grid: { color: 'rgba(249, 115, 22, 0.2)' },
                    ticks: { color: '#f97316' }
                },
                ySpells: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Spells Cast', color: '#c084fc' },
                    grid: { display: false },
                    ticks: { color: '#c084fc' }
                },
                x: {
                    grid: { color: 'rgba(249, 115, 22, 0.2)' },
                    ticks: { color: '#a09090' }
                }
            }
        }
    });
}

/**
 * Update comparison table
 */
function updateTable(config, results) {
    const cmcValues = CONFIG.CMC_RANGE;
    const headers = ['Creature CMC', 'Castable Cards', 'Avg Spell CMC', 'Avg Free Mana'];

    const rows = [];
    cmcValues.forEach((cmc) => {
        const r = results[cmc];
        if (!r) return;

        rows.push({
            cells: [
                cmc,
                r.castableCards,
                formatNumber(r.avgSpellCMC, 2),
                formatNumber(r.avgFreeMana, 2)
            ],
            class: cmc === config.creatureCMC ? 'current' : ''
        });
    });

    renderMultiColumnTable('vortex-comparisonTable', headers, rows);
}

/**
 * Update stats panel
 */
function updateStats(config, results) {
    const statsPanel = document.getElementById('vortex-stats');
    const currentResult = results[config.creatureCMC];

    if (statsPanel && currentResult) {
        const totalNonLands = config.cardDetails.length;
        const castablePercent = totalNonLands > 0 ? (currentResult.castableCards / totalNonLands) * 100 : 0;
        const hitRate = currentResult.successfulDiscoveries / 20000;

        // Build detailed breakdown with actual card names
        const discoverableCards = currentResult.discoverableCards || [];

        // Group by CMC
        const cmcGroups = {};
        discoverableCards.forEach(card => {
            if (!cmcGroups[card.cmc]) {
                cmcGroups[card.cmc] = [];
            }
            cmcGroups[card.cmc].push(card);
        });

        // Build breakdown HTML
        let castableCMCBreakdown = '';
        if (Object.keys(cmcGroups).length > 0) {
            const cmcSections = [];
            Object.keys(cmcGroups).sort((a, b) => Number(a) - Number(b)).forEach(cmc => {
                const cards = cmcGroups[cmc];
                const power5Plus = cards.filter(c => c.isPower5Plus);
                const regularCards = cards.filter(c => !c.isPower5Plus);

                let section = `<strong>${cmc} CMC (${cards.length} cards)</strong>:`;

                if (power5Plus.length > 0) {
                    const names = power5Plus.map(c => c.name).join(', ');
                    section += `<br>&nbsp;&nbsp;⚡ <span style="color: #c084fc;">Chain: ${names}</span>`;
                }

                if (regularCards.length > 0) {
                    const names = regularCards.map(c => c.name).join(', ');
                    section += `<br>&nbsp;&nbsp;• ${names}`;
                }

                cmcSections.push(section);
            });

            castableCMCBreakdown = `<br><div style="margin-top: 8px; padding-left: 8px; line-height: 1.6;">${cmcSections.join('<br>')}</div>`;
        }

        // Create interpretation message
        let interpretation = '';
        let color = '#f97316';
        if (currentResult.avgSpellsPerTrigger >= 1.5) {
             interpretation = `<strong style="color: #22c55e;">Incredible!</strong> High chain potential. You will often cast multiple spells per trigger.`;
             color = '#22c55e';
        } else if (currentResult.avgSpellsPerTrigger >= 1.25) {
            interpretation = `<strong style="color: #22c55e;">Great!</strong> You're chaining frequently and getting strong value.`;
            color = '#22c55e';
        } else if (currentResult.avgSpellsPerTrigger >= 1.10) {
            interpretation = `<strong style="color: #38bdf8;">Solid.</strong> Good discover value with occasional chains.`;
            color = '#38bdf8';
        } else if (currentResult.castableCards === 0) {
             interpretation = `<strong style="color: #dc2626;">No Targets.</strong> You have no spells with CMC ${config.creatureCMC} or less (excluding lands).`;
             color = '#dc2626';
        } else {
            interpretation = `<strong style="color: #f59e0b;">OK.</strong> Reliable hits, but chains are rare.`;
            color = '#f59e0b';
        }

        // Use the power5PlusInRange from the result
        const power5PlusInRange = currentResult.power5PlusInRange || 0;
        const chainablePercent = currentResult.castableCards > 0
            ? (power5PlusInRange / currentResult.castableCards) * 100
            : 0;

        // Check if we're excluding a creature from the pool
        const excludedCreatureNote = config.power5PlusAtCMC && config.power5PlusAtCMC.length > 0
            ? `<div style="margin-bottom: 12px; padding: 8px; background: rgba(192, 132, 252, 0.1); border-left: 3px solid #c084fc; border-radius: 4px; font-size: 0.9em;">
                ⚡ Casting <strong>${config.power5PlusAtCMC[0].name}</strong> - excluded from discover pool
               </div>`
            : '';

        const cardsHTML = [
            renderStatCard('Avg Spells', formatNumber(currentResult.avgSpellsPerTrigger, 2), 'per trigger', 'var(--text-light)'),
            renderStatCard('Avg Mana', formatNumber(currentResult.avgFreeMana, 1), 'value per trigger', '#f97316'),
            renderStatCard('Chain Prob', formatNumber(currentResult.multiDiscoverRate * 100, 1) + '%', 'chance of >1 spell', '#22c55e')
        ];

        const secondRow = `
            <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
                     <span style="color: var(--text-dim);">Discover Pool Size</span>
                     <strong>${currentResult.castableCards} cards <span style="font-weight: normal; color: var(--text-secondary); font-size: 0.9em;">(${formatNumber(castablePercent, 0)}% of non-lands)</span></strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;" title="Percentage of discoverable cards that will trigger another discover">
                     <span style="color: var(--text-dim);">Chain Density (Pool)</span>
                     <strong style="color: #c084fc;">${formatNumber(chainablePercent, 1)}% <span style="font-weight: normal; color: var(--text-secondary); font-size: 0.9em;">(${power5PlusInRange} cards)</span></strong>
                </div>
                 <div style="display: flex; justify-content: space-between;" title="Probability of finding ANY valid card (not whiffing)">
                     <span style="color: var(--text-dim);">Hit Probability</span>
                     <strong>${currentResult.castableCards > 0 ? '100%' : '0%'}</strong>
                </div>
            </div>
        `;

        const customStatsGrid = `
            <div class="stats-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;">
                ${cardsHTML.join('')}
            </div>
        `;

        statsPanel.innerHTML = `
            ${renderInsightBox(`🌀 Discover ${config.creatureCMC} Analysis`, excludedCreatureNote, '')}
            <div style="margin-top: 16px;"></div> 
            ${customStatsGrid}
            ${secondRow}
            ${renderInsightBox('', interpretation, `• Average discovered spell costs ${formatNumber(currentResult.avgSpellCMC, 1)} mana`, color)}
            <details style="margin-top: 12px; color: var(--text-dim); font-size: 0.85em;">
                <summary style="cursor: pointer; user-select: none;">📊 Discover pool breakdown (${currentResult.castableCards} cards)</summary>
                <div style="margin-top: 8px; padding-left: 8px;">
                    ${castableCMCBreakdown || 'No castable spells'}<br>
                    <strong style="color: var(--text-light);">${power5PlusInRange} of these can chain</strong> (power 5+ creatures)
                </div>
            </details>
        `;
    }
}

/**
 * Update all UI elements
 */
export function updateUI() {
    const { config, results } = calculate();

    console.log('Vortex updateUI called:', {
        deckSize: config.deckSize,
        cardDetailsLength: config.cardDetails?.length,
        creaturesPower5Plus: config.creaturesPower5Plus,
        resultsCount: Object.keys(results).length
    });

    // Show/hide import warning based on whether we have card details
    const importWarning = document.getElementById('vortex-import-warning');
    if (importWarning) {
        if (config.cardDetails.length > 0) {
            importWarning.style.display = 'none';
        } else {
            importWarning.style.display = 'block';
        }
    }

    if (config.cardDetails.length === 0 || config.creaturesPower5Plus === 0 || Object.keys(results).length === 0) {
        if (chart) chart.destroy();
        document.getElementById('vortex-comparisonTable').innerHTML = '<tr><td colspan="5">Configure your deck with creatures (power 5+) to see results</td></tr>';
        const statsPanel = document.getElementById('vortex-stats');
        if (statsPanel) {
            statsPanel.innerHTML = '<p>Import a decklist to analyze Monstrous Vortex triggers.</p>';
        }
        return;
    }

    updateChart(config, results);
    updateTable(config, results);
    updateStats(config, results);

    // Call sample reveals if container exists and we have data
    if (document.getElementById('vortex-reveals-display') && config.cardDetails.length > 0) {
         runSampleReveals();
    }
}

/**
 * Initialize Vortex calculator
 */
export function init() {
    registerCalculator({
        name: 'vortex',
        calculate,
        updateUI,
        inputs: ['cmc'], // Binds vortex-cmcSlider and vortex-cmcValue
        init: (debouncedUpdate) => {
            const container = document.getElementById('vortex-sample-reveals');
            if (container) {
                container.innerHTML = generateSampleRevealsHTML('vortex', 'Sample Discover Reveals');
            }
            const starPowerCheckbox = document.getElementById('vortex-star-power');
            if (starPowerCheckbox) {
                starPowerCheckbox.addEventListener('change', () => debouncedUpdate());
            }

            const revealBtn = document.getElementById('vortex-draw-reveals-btn');
            if (revealBtn) {
                // Use refreshSamples
                revealBtn.addEventListener('click', refreshSamples);
            }
        }
    });
}