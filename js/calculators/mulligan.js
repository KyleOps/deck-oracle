/**
 * Mulligan Strategy Calculator
 * Determines optimal mulligan decisions for any number of card types
 */

import { choose, drawTwoTypeMin, drawThreeTypeMin } from '../utils/hypergeometric.js';
import { formatNumber, formatPercentage, createCache } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { generateSampleRevealsHTML, renderHeroStats, renderOutcomeMatrix } from '../utils/components.js';
import { shuffleDeck, createCollapsibleSection } from '../utils/sampleSimulator.js';
import { probabilityVerdict } from '../utils/analysis.js';

let simulationCache = createCache(100);
let lastConfigHash = '';
let turnChart = null;

// Stable samples state
let stableSamples = [];
const SAMPLE_COUNT_DEFAULT = 10;
let renderedCount = 0;

const DEFAULT_COLORS = ['#55c97f', '#5b8db8', '#e8635c', '#f0a92c', '#9878b8', '#b8738f', '#5fa8a0', '#f0a92c'];

// Card type management
let cardTypes = [
    { id: 1, name: 'Lands', count: 39, required: 3, byTurn: 3, color: DEFAULT_COLORS[0] },
    { id: 2, name: 'Ramp', count: 14, required: 1, byTurn: 3, color: DEFAULT_COLORS[1] }
];
let nextTypeId = 3;

// ... (Hypergeometric functions remain the same) ...
/**
 * Calculate probability of drawing specific combination of multiple types
 */
function multiTypeProb(deckSize, typeCounts, drawn, typeDrawn) {
    const numTypes = typeCounts.length;
    const totalDrawn = typeDrawn.reduce((sum, n) => sum + n, 0);

    if (totalDrawn > drawn) return 0;

    const othersTotal = deckSize - typeCounts.reduce((sum, n) => sum + n, 0);
    const othersDrawn = drawn - totalDrawn;

    if (othersDrawn < 0 || othersDrawn > othersTotal) return 0;

    let numerator = choose(othersTotal, othersDrawn);
    for (let i = 0; i < numTypes; i++) {
        numerator *= choose(typeCounts[i], typeDrawn[i]);
    }

    const denominator = choose(deckSize, drawn);
    return numerator / denominator;
}

/**
 * Calculate cumulative probability: P(at least typeDrawn[i] of each type)
 * Optimized to use built-in hypergeometric functions for common cases
 */
function multiTypeProbCumulative(deckSize, typeCounts, drawn, typeDrawnMin) {
    // Fast path for common cases
    if (typeCounts.length === 2) {
        return drawTwoTypeMin(deckSize, typeCounts[0], typeCounts[1], drawn, typeDrawnMin[0], typeDrawnMin[1]);
    }
    if (typeCounts.length === 3) {
        return drawThreeTypeMin(deckSize, typeCounts[0], typeCounts[1], typeCounts[2], drawn, typeDrawnMin[0], typeDrawnMin[1], typeDrawnMin[2]);
    }

    // General case: enumerate all valid combinations
    let totalProb = 0;
    function enumerate(typeIndex, currentDrawn, remainingSlots) {
        if (typeIndex === typeCounts.length) {
            totalProb += multiTypeProb(deckSize, typeCounts, drawn, currentDrawn);
            return;
        }
        const minForType = typeDrawnMin[typeIndex];
        const maxForType = Math.min(typeCounts[typeIndex], remainingSlots);
        for (let count = minForType; count <= maxForType; count++) {
            enumerate(typeIndex + 1, [...currentDrawn, count], remainingSlots - count);
        }
    }
    enumerate(0, [], drawn);
    return totalProb;
}

/**
 * Calculate success probability for a multi-type hand
 */
/**
 * Calculate success probability for a multi-type hand with multiple deadlines.
 * Uses memoization and sequential deadlines for correctness.
 */
export function calcMultiTypeSuccess(deckSize, types, handCounts) {
    const activeTypes = types.map((t, i) => ({ ...t, index: i }));
    const unsatisfied = activeTypes.filter(t => handCounts[t.index] < t.required);

    if (unsatisfied.length === 0) return 1;

    // Sort unique deadlines
    const uniqueDeadlines = [...new Set(unsatisfied.map(t => t.byTurn))].sort((a, b) => a - b);
    
    // Check for impossible Turn 0 requirements
    if (uniqueDeadlines[0] <= 0) return 0;

    const initialCardsInDeck = deckSize - 7;
    
    // Memoization cache
    const cache = new Map();

    function solve(deadlineStep, currentCounts) {
        // If we processed all deadlines, we succeeded
        if (deadlineStep === uniqueDeadlines.length) return 1;

        const targetTurn = uniqueDeadlines[deadlineStep];
        const prevTurn = deadlineStep === 0 ? 0 : uniqueDeadlines[deadlineStep - 1];
        const cardsToDraw = targetTurn - prevTurn;
        
        if (cardsToDraw <= 0) return 0; // Should not happen if logic is correct

        const cacheKey = `${deadlineStep}:${currentCounts.join(',')}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        const currentDeckCounts = types.map((t, i) => t.count - currentCounts[i]);
        // Total cards in deck at this stage
        const currentCardsInDeck = initialCardsInDeck - prevTurn;

        let totalProb = 0;

        // Generate all possible draw combinations for this step
        function generateDraws(typeIdx, currentDraw, remainingSlots) {
            if (typeIdx === types.length) {
                const prob = multiTypeProb(
                    currentCardsInDeck,
                    currentDeckCounts,
                    cardsToDraw,
                    currentDraw
                );

                if (prob > 0) {
                    const nextCounts = currentCounts.map((c, i) => c + currentDraw[i]);
                    
                    // Check requirements for CURRENT deadline
                    const metRequirements = unsatisfied
                        .filter(t => t.byTurn === targetTurn)
                        .every(t => nextCounts[t.index] >= t.required);

                    if (metRequirements) {
                        totalProb += prob * solve(deadlineStep + 1, nextCounts);
                    }
                }
                return;
            }

            const maxDraw = Math.min(currentDeckCounts[typeIdx], remainingSlots);
            for (let c = 0; c <= maxDraw; c++) {
                generateDraws(typeIdx + 1, [...currentDraw, c], remainingSlots - c);
            }
        }

        generateDraws(0, [], cardsToDraw);

        cache.set(cacheKey, totalProb);
        return totalProb;
    }

    return solve(0, handCounts);
}

/**
 * Calculate mulligan strategy for multiple card types
 */
function mullStratMultiType(deckSize, types, penalty, freeMulligan, confidenceThreshold) {
    const strategy = [];
    let bestKeepProb = 0;
    const threshold = confidenceThreshold;

    // Generate all possible hand combinations
    function generateHandCombinations(typeIndex, currentCombination, remainingCards) {
        if (typeIndex === types.length) {
            if (currentCombination.reduce((sum, n) => sum + n, 0) <= 7) {
                // Calculate hand probability
                const handProb = multiTypeProb(
                    deckSize,
                    types.map(t => t.count),
                    7,
                    currentCombination
                );

                if (handProb > 0) {
                    const successProb = calcMultiTypeSuccess(deckSize, types, currentCombination);

                    strategy.push({
                        counts: [...currentCombination],
                        handProb,
                        successProb,
                        keep: false
                    });

                    if (successProb > bestKeepProb) {
                        bestKeepProb = successProb;
                    }
                }
            }
            return;
        }

        const maxForType = Math.min(types[typeIndex].count, remainingCards);
        for (let count = 0; count <= maxForType; count++) {
            generateHandCombinations(
                typeIndex + 1,
                [...currentCombination, count],
                remainingCards - count
            );
        }
    }

    generateHandCombinations(0, [], 7);

    // We calculate the Expected Value (EV) for each mulligan step (0 to 6)
    // London Mulligan: You always see 7 cards, penalty applies to success rate.
    const evs = new Array(8).fill(0);
    const stepStats = new Array(7).fill(null);
    
    for (let i = 6; i >= 0; i--) {
        const penaltyFactor = i === 0 ? 0 : (freeMulligan ? (i - 1) : i);
        const k = Math.pow(1 - penalty, penaltyFactor);
        const nextEV = evs[i+1];
        
        // At this step, we keep if the hand's penalized success rate meets our confidence floor
        // The floor decays with the penalty (fewer cards = lower threshold)
        // We also consider the EV of mulliganing, but confidence threshold is the primary control
        const floor = threshold * k;
        const decisionThreshold = floor;
        
        let stepEV = 0;
        let keepProbAtStep = 0;
        let successIfKeptAtStep = 0;
        
        strategy.forEach(hand => {
            const handSuccess = hand.successProb * k;
            if (handSuccess >= decisionThreshold) {
                stepEV += hand.handProb * handSuccess;
                keepProbAtStep += hand.handProb;
                successIfKeptAtStep += hand.handProb * handSuccess;
            } else {
                stepEV += hand.handProb * nextEV;
            }
        });
        
        evs[i] = stepEV;
        stepStats[i] = {
            keepProb: keepProbAtStep,
            successIfKept: keepProbAtStep > 0 ? successIfKeptAtStep / keepProbAtStep : 0,
            ev: stepEV
        };
        
        // Update the 'keep' flag for the sampler (using opening hand decision by default)
        if (i === 0) {
            strategy.forEach(hand => {
                hand.keep = (hand.successProb * k) >= decisionThreshold;
            });
        }
    }

    const expectedSuccess = evs[0];
    const keepProb = stepStats[0].keepProb;
    const expectedSuccessOnKeep = stepStats[0].successIfKept;

    return { 
        strategy, 
        expectedSuccess, 
        threshold, 
        bestKeepProb, 
        keepProb, 
        expectedSuccessOnKeep,
        stepStats 
    };
}

/**
 * Calculate marginal benefit of replacing one "other" card with each type
 * This simulates real deck tuning: swapping a card rather than increasing deck size
 */
function calculateMarginalBenefits(deckSize, types, penalty, freeMulligan, confidenceThreshold) {
    const baseResult = mullStratMultiType(deckSize, types, penalty, freeMulligan, confidenceThreshold);
    // Baseline = No Mulligan, just natural draw
    const baseBaseline = calculateNoMulliganSuccess(deckSize, types);
    const benefits = [];

    types.forEach((type, index) => {
        // Simulate replacing one "other" card with this type
        // Deck size stays the same, only the type count increases by 1
        const modifiedTypes = types.map((t, i) =>
            i === index ? { ...t, count: t.count + 1 } : t
        );
        const modifiedResult = mullStratMultiType(deckSize, modifiedTypes, penalty, freeMulligan, confidenceThreshold);
        const modifiedBaseline = calculateNoMulliganSuccess(deckSize, modifiedTypes);

        benefits.push({
            overall: modifiedResult.expectedSuccess - baseResult.expectedSuccess,
            baseline: modifiedBaseline - baseBaseline
        });
    });

    return benefits;
}

/**
 * Calculate average number of mulligans and expected cards in hand
 */
function calculateAvgMulligans(strategy, penalty, freeMulligan) {
    const keepProb = strategy.filter(h => h.keep).reduce((sum, h) => sum + h.handProb, 0);
    // Geometric distribution: E[mulligans] = (1-p) / p where p is keep probability
    const avgMulligans = keepProb > 0 ? (1 - keepProb) / keepProb : 0;

    // Expected cards in hand calculation
    let expectedCards = 0;
    
    let remainingProb = 1.0;
    let currentCards = 7;
    let mulliganCount = 0;
    let accumulatedProb = 0;
    
    // Sum the first 10 mulligan layers (sufficient precision)
    for (let i = 0; i < 10; i++) {
        // Probability of keeping at this stage
        const pKeepHere = remainingProb * keepProb;
        
        // Cards we have if we keep here
        let cardsIfKeep = 7;
        if (mulliganCount > 0) {
            if (freeMulligan) {
                cardsIfKeep = 7 - (mulliganCount - 1);
            } else {
                cardsIfKeep = 7 - mulliganCount;
            }
        }
        // Cap at 0 cards
        cardsIfKeep = Math.max(0, cardsIfKeep);
        
        expectedCards += pKeepHere * cardsIfKeep;
        accumulatedProb += pKeepHere;
        
        // Advance to next mulligan
        remainingProb *= (1 - keepProb);
        mulliganCount++;
        
        if (remainingProb < 0.0001) break;
    }
    
    // Normalize if we didn't reach 100% (truncation)
    if (accumulatedProb > 0) {
        expectedCards = expectedCards / accumulatedProb;
    }

    return { avgMulligans, expectedCards };
}

/**
 * Calculate success rate without any mulligans (baseline)
 */
function calculateNoMulliganSuccess(deckSize, types) {
    const allHands = [];

    function generateHandCombinations(typeIndex, currentCombination, remainingCards) {
        if (typeIndex === types.length) {
            if (currentCombination.reduce((sum, n) => sum + n, 0) <= 7) {
                const handProb = multiTypeProb(
                    deckSize,
                    types.map(t => t.count),
                    7,
                    currentCombination
                );

                if (handProb > 0) {
                    const successProb = calcMultiTypeSuccess(deckSize, types, currentCombination);
                    allHands.push({ handProb, successProb });
                }
            }
            return;
        }

        const maxForType = Math.min(types[typeIndex].count, remainingCards);
        for (let count = 0; count <= maxForType; count++) {
            generateHandCombinations(
                typeIndex + 1,
                [...currentCombination, count],
                remainingCards - count
            );
        }
    }

    generateHandCombinations(0, [], 7);

    // Weighted average of success probability across all possible hands
    return allHands.reduce((sum, hand) => sum + hand.handProb * hand.successProb, 0);
}

/**
 * Generate stable samples from the deck
 */
function generateStableSamples(deck, count) {
    stableSamples = [];
    for (let i = 0; i < Math.max(count, SAMPLE_COUNT_DEFAULT); i++) {
        stableSamples.push(shuffleDeck([...deck]));
    }
}

/**
 * Force refresh of stable samples
 */
function refreshSamples() {
    const config = getDeckConfig();
    
    // Always generate from the current configuration (Virtual Deck)
    // This ensures it works with the manual sliders/inputs
    const deck = createVirtualDeck(config.deckSize, config.types);
    
    const countInput = document.getElementById('mulligan-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || SAMPLE_COUNT_DEFAULT);
    
    generateStableSamples(deck, numSims);
    runSampleReveals();
}

/**
 * Run sample Opening Hand reveals with strategy decision using virtual deck
 */
export function runSampleReveals() {
    const config = getDeckConfig();
    
    // Create virtual deck from configuration
    const deck = createVirtualDeck(config.deckSize, config.types);
    const countInput = document.getElementById('mulligan-sample-count');
    const numSims = Math.max(1, parseInt(countInput?.value) || SAMPLE_COUNT_DEFAULT);

    // Ensure we have stable samples
    if (stableSamples.length < numSims) {
        generateStableSamples(deck, numSims);
    }

    // Get strategy result
    const { result } = calculate();
    if (!result) return;

    // Initialize scenarios for tracking (Decision Cheat Sheet)
    // We partition the space into independent buckets that sum to 100%
    const scenarios = [];
    
    // 1. Success (Meets or exceeds all)
    scenarios.push({
        label: '✓ Meets or exceeds',
        match: (c) => config.types.every((t, idx) => c[idx] >= t.required),
        sampleCount: 0,
        type: 'success'
    });
    
    // 2. Missing exactly 1 card of a specific type (and others are met)
    config.types.forEach((t, i) => {
        scenarios.push({
            label: `✗ Missing 1: ${t.name}`,
            match: (c) => {
                // This type is exactly 1 short
                if (c[i] !== t.required - 1) return false;
                // Every other type is met
                for (let j = 0; j < config.types.length; j++) {
                    if (i === j) continue;
                    if (c[j] < config.types[j].required) return false;
                }
                return true;
            },
            sampleCount: 0,
            type: 'fail-1',
            typeIdx: i
        });
    });

    // 3. Catch-all: Missing >1 cards (Multiple types failing OR one type failing by >1)
    scenarios.push({
        label: '💀 Missing >1 cards',
        match: (c) => {
            // It's not a success
            const isSuccess = config.types.every((t, idx) => c[idx] >= t.required);
            if (isSuccess) return false;
            
            // It's not one of the "Missing 1" scenarios
            const isMissingOne = config.types.some((t, i) => {
                if (c[i] !== t.required - 1) return false;
                for (let j = 0; j < config.types.length; j++) {
                    if (i === j) continue;
                    if (c[j] < config.types[j].required) return false;
                }
                return true;
            });
            
            return !isMissingOne;
        },
        sampleCount: 0,
        type: 'fail-many'
    });

    const HAND_SIZE = 7;
    // Determine max turns to simulate based on requirements
    const maxTurn = Math.max(...config.types.map(t => t.byTurn));
    // Simulate draws up to maxTurn
    const DRAW_COUNT = maxTurn;

    // Outcome tracking
    let instantSuccessCount = 0;
    let drawSuccessCount = 0;
    let failCount = 0;

    let correctKeepCount = 0;
    let overconfidentKeepCount = 0;
    let missedOpportunityCount = 0;
    let correctMulliganCount = 0;

    // 1. STATS LOOP (Full Simulation)
    for (let i = 0; i < numSims; i++) {
        const shuffled = stableSamples[i] ? [...stableSamples[i]] : shuffleDeck([...deck]);
        
        const hand = shuffled.slice(0, HAND_SIZE);
        const draws = shuffled.slice(HAND_SIZE, HAND_SIZE + DRAW_COUNT);

        const handCounts = config.types.map(t => 0);
        const countCard = (card, countsArray) => {
            config.types.forEach((confType, idx) => {
                if (card.typeIds && card.typeIds.includes(confType.id)) {
                    countsArray[idx]++;
                }
            });
        };

        hand.forEach(c => countCard(c, handCounts));

        // Track scenario occurrences
        scenarios.forEach(s => {
            if (s.match(handCounts)) {
                s.sampleCount++;
            }
        });

        const decision = result.strategy.find(s => 
            s.counts.every((c, idx) => c === handCounts[idx])
        );
        const keep = decision ? decision.keep : false;

        const needs = config.types.map((type, idx) => {
            const have = handCounts[idx];
            const need = type.required;
            if (have < need) return { idx, diff: need - have, name: type.name };
            return null;
        }).filter(x => x);
        
        const runningCounts = [...handCounts];
        let fixedByTurn = null;
        
        if (needs.length > 0) {
            for (let d = 0; d < draws.length; d++) {
                countCard(draws[d], runningCounts);
                const stillMissing = config.types.some((t, idx) => runningCounts[idx] < t.required);
                if (!stillMissing) {
                    fixedByTurn = d + 1;
                    break;
                }
            }
        }

        // Stats Logic
        const isSuccess = (needs.length === 0 || fixedByTurn);
        if (needs.length === 0) instantSuccessCount++;
        else if (fixedByTurn) drawSuccessCount++;
        else failCount++;

        if (keep) {
            if (isSuccess) correctKeepCount++;
            else overconfidentKeepCount++;
        } else {
            if (isSuccess) missedOpportunityCount++;
            else correctMulliganCount++;
        }
    }

    // Build Summary UI
    const pct = (val) => ((val / numSims) * 100).toFixed(1) + '%';
    
    let summaryContentHTML = '<div class="mull-summary-block">';

    // Decision-quality breakdown. The four keep/mull outcomes are a confusion
    // matrix, so render them as one — agreement lands on the diagonal and the
    // two failure modes (too greedy vs too cautious) sit opposite each other,
    // which is what tells you which slider to move.
    const frac = (v) => (numSims > 0 ? v / numSims : 0);

    summaryContentHTML += renderHeroStats([
        {
            label: 'NATURAL "GOD HANDS"',
            value: pct(instantSuccessCount),
            sub: 'meets every requirement on turn 0',
            size: 'big',
            color: 'var(--tx-green)'
        }
    ]);

    summaryContentHTML += renderOutcomeMatrix({
        title: 'DECISION QUALITY',
        subtitle: `${numSims.toLocaleString('en-US')} SIMULATED HANDS`,
        rowLabels: ['STRATEGY SAYS KEEP', 'STRATEGY SAYS MULL'],
        colLabels: ['HAND WOULD HIT', 'HAND WOULD BRICK'],
        cells: [
            [
                { label: 'Correct keep', value: frac(correctKeepCount), good: true,
                  note: 'Kept, and you got there.' },
                { label: 'Bad beat', value: frac(overconfidentKeepCount), good: false,
                  note: 'Too greedy — raise the confidence threshold.' }
            ],
            [
                { label: 'Missed opportunity', value: frac(missedOpportunityCount), good: false,
                  note: 'Too cautious — lower the confidence threshold.' },
                { label: 'Good mulligan', value: frac(correctMulliganCount), good: true,
                  note: 'Mulled away a hand that would have bricked.' }
            ]
        ]
    });

    // Scenario Table (Cheat Sheet)
    let tableHTML = `
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color); overflow-x: auto;">
            <div style="color:var(--text-dim); text-transform:uppercase; font-size:0.75em; letter-spacing:1px; margin-bottom:12px; text-align:center;">Decision Guidelines (Independent Scenarios)</div>
            <table class="comparison-table" style="width:100%; font-size:0.85em; white-space: nowrap;">
                <tr>
                    <th style="text-align:left;">Scenario</th>
                    ${config.types.map(t => `<th>${t.name}</th>`).join('')}
                    <th>Win Chance</th>
                    <th>Frequency</th>
                    <th>Sample %</th>
                    <th>Strategy</th>
                </tr>
                ${scenarios.map(s => {
                    const matchingHands = result.strategy.filter(h => s.match(h.counts));
                    const theoreticalProb = matchingHands.reduce((sum, h) => sum + h.handProb, 0);

                    if (theoreticalProb === 0 && s.sampleCount === 0) return '';

                    const avgSuccessProb = matchingHands.length > 0
                        ? matchingHands.reduce((sum, h) => sum + (h.successProb * h.handProb), 0) / theoreticalProb
                        : 0;

                    // Use actual strategy decision from matching hands (majority vote weighted by probability)
                    const keepProbability = matchingHands.length > 0
                        ? matchingHands.filter(h => h.keep).reduce((sum, h) => sum + h.handProb, 0) / theoreticalProb
                        : 0;
                    const isKeep = keepProbability > 0.5; // Majority of hands in this scenario are kept

                    // Color win chance based on the actual probability (independent of strategy decision)
                    const winChanceColor = avgSuccessProb >= 0.75 ? '#55c97f' : avgSuccessProb >= 0.5 ? '#f0a92c' : '#e8635c';

                    return `<tr>
                        <td style="text-align:left; color:var(--text-light);">${s.label}</td>
                        ${config.types.map((t, i) => {
                            if (s.type === 'success') return `<td>${t.required}+</td>`;
                            if (s.type === 'fail-1') {
                                if (s.typeIdx === i) return `<td>${t.required - 1}</td>`;
                                return `<td>${t.required}+</td>`;
                            }
                            return '<td style="color:var(--text-dim); font-style:italic;">Var.</td>';
                        }).join('')}
                        <td style="color:${winChanceColor}; font-weight:bold;">${formatPercentage(avgSuccessProb)}</td>
                        <td style="color:var(--text-dim);">${formatPercentage(theoreticalProb)}</td>
                        <td style="color:var(--text-dim);">${pct(s.sampleCount)}</td>
                        <td style="color:${isKeep ? '#55c97f' : '#e8635c'}; font-weight:bold;">${isKeep ? 'KEEP' : 'MULL'}</td>
                    </tr>`;
                }).join('')}
            </table>
        </div>
    `;
    
    summaryContentHTML += tableHTML + '</div>';

    // 2. Prepare Samples List Structure
    const listId = 'mulligan-samples-list';
    const btnId = 'mulligan-load-more';
    
    const containerHTML = `
        <div id="${listId}"></div>
        <button id="${btnId}" class="import-btn" style="width: 100%; margin-top: 12px; display: none;">
            Load More (50)
        </button>
    `;

    const revealsSectionHTML = createCollapsibleSection(
        `Show/Hide Individual Hands (${numSims} samples)`,
        containerHTML,
        true
    );

    const display = document.getElementById('mulligan-reveals-display');
    if (display) {
        display.innerHTML = summaryContentHTML + revealsSectionHTML;
        
        // 3. Render Batch Function
        const listContainer = document.getElementById(listId);
        const loadMoreBtn = document.getElementById(btnId);
        renderedCount = 0;

        const renderBatch = (batchSize) => {
            const start = renderedCount;
            const end = Math.min(start + batchSize, numSims);
            let html = '';

            for (let i = start; i < end; i++) {
                const shuffled = stableSamples[i] ? [...stableSamples[i]] : shuffleDeck([...deck]);
                
                const hand = shuffled.slice(0, HAND_SIZE);
                const draws = shuffled.slice(HAND_SIZE, HAND_SIZE + DRAW_COUNT);

                const handCounts = config.types.map(t => 0);
                const countCard = (card, countsArray) => {
                    config.types.forEach((confType, idx) => {
                        if (card.typeIds && card.typeIds.includes(confType.id)) {
                            countsArray[idx]++;
                        }
                    });
                };

                hand.forEach(c => countCard(c, handCounts));

                const decision = result.strategy.find(s => 
                    s.counts.every((c, idx) => c === handCounts[idx])
                );
                const keep = decision ? decision.keep : false;
                const successProb = decision ? decision.successProb : 0;

                const needs = config.types.map((type, idx) => {
                    const have = handCounts[idx];
                    const need = type.required;
                    if (have < need) return { idx, diff: need - have, name: type.name };
                    return null;
                }).filter(x => x);
                
                const summaryText = needs.length > 0 ? `Missing: ${needs.map(n => `${n.diff} ${n.name}`).join(', ')}` : 'Hand meets requirements';

                const runningCounts = [...handCounts];
                let fixedByTurn = null;
                
                if (needs.length > 0) {
                    for (let d = 0; d < draws.length; d++) {
                        countCard(draws[d], runningCounts);
                        const stillMissing = config.types.some((t, idx) => runningCounts[idx] < t.required);
                        if (!stillMissing) {
                            fixedByTurn = d + 1;
                            break;
                        }
                    }
                }

                const isSuccess = (needs.length === 0 || fixedByTurn);

                let label = '';
                let statusColor = '';
                let statusBg = '';
                let borderColor = '';

                if (keep) {
                    if (isSuccess) {
                        label = '✓ Correct keep';
                        statusColor = '#55c97f';
                        statusBg = 'rgba(85, 201, 127, 0.05)';
                        borderColor = 'rgba(85, 201, 127, 0.3)';
                    } else {
                        label = '✗ Bad beat';
                        statusColor = '#e8635c';
                        statusBg = 'rgba(232, 99, 92, 0.05)';
                        borderColor = 'rgba(232, 99, 92, 0.3)';
                    }
                } else {
                    if (isSuccess) {
                        label = '✗ Missed opportunity';
                        statusColor = '#f0a92c';
                        statusBg = 'rgba(240, 169, 44, 0.05)';
                        borderColor = 'rgba(240, 169, 44, 0.3)';
                    } else {
                        label = '✓ Good mulligan';
                        statusColor = '#7d8a92';
                        statusBg = 'rgba(125, 138, 146, 0.05)';
                        borderColor = 'rgba(125, 138, 146, 0.3)';
                    }
                }

                html += `<div class="sample-reveal" style="background:${statusBg}; border:1px solid ${borderColor}; padding: 12px; border-radius: 8px; margin-bottom: 12px;">`;
                
                html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="font-weight:600; color:${statusColor}; font-size:0.95em;">${label} <span style="color:var(--text-dim); font-weight:normal; font-size:0.9em;">(Sample ${i + 1})</span></div>
                    <div style="font-size:0.85em; color:var(--text-secondary);">Strategy: <span style="font-weight:bold; color:${keep ? '#55c97f' : '#e8635c'}">${keep ? 'KEEP' : 'MULL'}</span> <span style="color:var(--text-dim)">(${formatPercentage(successProb)} win chance)</span></div>
                </div>`;
                
                html += '<div style="margin: 8px 0; display: flex; flex-wrap: wrap; gap: 4px;">';
                hand.forEach(card => {
                    html += renderVirtualCard(card);
                });
                html += '</div>';
                
                let fixColor = '#e8635c';
                let fixText = '';
                if (needs.length === 0) {
                    fixText = 'Started with requirements met';
                    fixColor = '#55c97f';
                } else if (fixedByTurn) {
                    fixText = `Found missing pieces by Turn ${fixedByTurn}`;
                    fixColor = '#55c97f';
                } else {
                    fixText = `Failed to find pieces (Checked ${maxTurn} draws)`;
                    fixColor = '#e8635c';
                }

                html += `<div class="reveal-summary" style="font-size:0.85em; color:var(--text-secondary); display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:8px; border-top:1px dashed ${borderColor};">
                    <span>${summaryText}</span>
                    <span style="color:${fixColor}; font-weight:600;">${fixText}</span>
                </div>`;

                if (draws.length > 0) {
                    html += `<div style="margin-top: 8px; font-size: 0.85em; color: var(--text-dim);">Next ${draws.length} natural draws:</div>`;
                    html += '<div style="margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px; opacity: 0.9;">';
                    draws.forEach(card => {
                        html += renderVirtualCard(card);
                    });
                    html += '</div>';
                }
                
                html += '</div>';
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
}

/**
 * Create a virtual deck based on configured types
 */
function createVirtualDeck(deckSize, types) {
    const deck = [];
    let count = 0;

    // We need to handle potential overlaps if user defined them, but for simulation
    // we must create concrete cards. 
    // Assumption: Types are effectively distinct for the purpose of "filling the deck"
    // OR we create generic cards that simply have attributes.
    // To allow overlap (e.g. "Land" and "Basic Land"), we'd need a more complex UI.
    // For now, we assume the user adds disjoint types (Lands, Creatures, Ramp) 
    // or we treat them as independent counts and fill linearly.
    
    // To support the sampler properly, we create cards that "belong" to types.
    // If we have Type A (36) and Type B (10), we make 36 A's and 10 B's.
    // If they sum > deckSize, we cap.
    
    types.forEach(type => {
        for (let i = 0; i < type.count; i++) {
            if (count >= deckSize) break;
            deck.push({
                name: type.name,
                typeIds: [type.id], // Tag with type ID for easy counting
                isKnown: true,
                color: type.color
            });
            count++;
        }
    });

    // Fill remainder
    while (count < deckSize) {
        deck.push({
            name: 'Other',
            typeIds: [],
            isKnown: false
        });
        count++;
    }

    return deck;
}

/**
 * Render a virtual card badge
 */
function renderVirtualCard(card) {
    const color = card.isKnown ? (card.color || 'var(--theme-secondary)') : '#2c322e';
    const bg = card.isKnown 
        ? (card.color ? card.color + '33' : 'rgba(152, 120, 184, 0.2)') 
        : 'rgba(255, 255, 255, 0.05)';
    return `<span style="
        padding: 2px 6px; 
        border-radius: 4px; 
        background: ${bg}; 
        border: 1px solid ${color}; 
        color: var(--text-light); 
        font-size: 0.85em;
        display: inline-block;
    ">${card.name}</span>`;
}

/**
 * Get current configuration from UI
 */
export function getDeckConfig() {
    // Note: We ignore global deck config for Mulligans in favor of local overrides if needed,
    // but we respect the imported card data if available for other tabs.
    // For Mulligan Tab, we primarily use the manual inputs.
    
    const deckSizeInput = document.getElementById('mull-deck-size');
    const deckSize = parseInt(deckSizeInput?.value) || 99;

    const penalty = parseFloat(document.getElementById('mull-penalty')?.value || 20) / 100;
    const freeMulligan = document.getElementById('mull-free')?.checked === true;
    const confidenceThreshold = parseFloat(document.getElementById('mull-threshold')?.value || 75) / 100;

    // Cache key now includes confidenceThreshold to ensure preset changes trigger recalc if logic uses it
    // Or at least to track state changes.
    const newHash = `${deckSize}-${JSON.stringify(cardTypes)}-${penalty}-${freeMulligan}-${confidenceThreshold}`;
    
    if (newHash !== lastConfigHash) {
        simulationCache.clear();
        lastConfigHash = newHash;
        
        // Regenerate samples if config changed significantly
        // For virtual deck, we regenerate if counts changed.
        const deck = createVirtualDeck(deckSize, cardTypes);
        generateStableSamples(deck, SAMPLE_COUNT_DEFAULT);
    }

    return {
        deckSize,
        penalty,
        freeMulligan,
        confidenceThreshold,
        types: cardTypes
    };
}

/**
 * Calculate optimal strategy
 */
export function calculate() {
    const config = getDeckConfig();

    if (config.deckSize === 0 || config.types.length === 0) {
        return { config, result: null };
    }

    // Include confidenceThreshold in cache key
    const cacheKey = `${config.deckSize}-${JSON.stringify(config.types)}-${config.penalty}-${config.freeMulligan}-${config.confidenceThreshold}`;
    const cached = simulationCache.get(cacheKey);
    let result = cached;

    if (!result) {
        result = mullStratMultiType(config.deckSize, config.types, config.penalty, config.freeMulligan, config.confidenceThreshold);
        
        // Calculate unpenalized result (Theoretical ceiling)
        const unpenalizedResult = mullStratMultiType(config.deckSize, config.types, 0, config.freeMulligan, config.confidenceThreshold);
        result.unpenalizedSuccess = unpenalizedResult.expectedSuccess;

        const mulliganStats = calculateAvgMulligans(result.strategy, config.penalty, config.freeMulligan);
        result.avgMulligans = mulliganStats.avgMulligans;
        result.expectedCards = mulliganStats.expectedCards;
        result.baselineSuccess = calculateNoMulliganSuccess(config.deckSize, config.types);
        result.marginalBenefits = calculateMarginalBenefits(config.deckSize, config.types, config.penalty, config.freeMulligan, config.confidenceThreshold);
        simulationCache.set(cacheKey, result);
    }

    return { config, result };
}

/**
 * Render card type inputs
 */
function renderCardTypes() {
    const container = document.getElementById('mull-types-container');
    if (!container) return;

    container.innerHTML = cardTypes.map(t => `<div class="card-type-row" data-type-id="${t.id}">
        <div class="type-header">
            <input type="color" class="type-color-input" value="${t.color || '#ffffff'}" data-type-id="${t.id}" style="height: 38px; width: 40px; padding: 2px; background: var(--input-bg); border: 1px solid var(--theme-border); border-radius: var(--radius-md); cursor: pointer;">
            <input type="text" class="type-name-input" value="${t.name}" placeholder="Type name" data-type-id="${t.id}">
            ${cardTypes.length > 1 ? `<button class="remove-type-btn" data-type-id="${t.id}" aria-label="Remove type">✕</button>` : ''}
        </div>
        <div class="type-grid">
            <div class="type-input"><label>In deck</label><input type="number" class="type-count" value="${t.count}" min="0" data-type-id="${t.id}"></div>
            <div class="type-input"><label>Need</label><input type="number" class="type-required" value="${t.required}" min="0" max="7" data-type-id="${t.id}"></div>
            <div class="type-input"><label>By turn</label><input type="number" class="type-turn" value="${t.byTurn}" min="1" max="10" data-type-id="${t.id}"></div>
        </div>
    </div>`).join('');

    // Unified event handler
    const updateType = (selector, field, parser = v => v) => {
        container.querySelectorAll(selector).forEach(input => {
            input.addEventListener('input', e => {
                const type = cardTypes.find(t => t.id === parseInt(e.target.dataset.typeId));
                if (type) {
                    type[field] = parser(e.target.value);
                    updateUI();
                }
            });
        });
    };

    updateType('.type-name-input', 'name');
    updateType('.type-color-input', 'color');
    updateType('.type-count', 'count', v => parseInt(v) || 0);
    updateType('.type-required', 'required', v => parseInt(v) || 0);
    updateType('.type-turn', 'byTurn', v => parseInt(v) || 1);

    container.querySelectorAll('.remove-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            cardTypes = cardTypes.filter(t => t.id !== parseInt(e.target.dataset.typeId));
            renderCardTypes();
            updateUI();
        });
    });
}

/**
 * Add new card type
 */
function addCardType() {
    cardTypes.push({
        id: nextTypeId++,
        name: `Type ${cardTypes.length + 1}`,
        count: 0,
        required: 1,
        byTurn: 3,
        color: DEFAULT_COLORS[cardTypes.length % DEFAULT_COLORS.length]
    });
    renderCardTypes();
    updateUI();
}

/**
 * Update strategy table (Now merged into sampler, so we just hide the old container)
 */
function updateStrategyTable(config, result, sharedData) {
    const tableEl = document.getElementById('mull-strategyTable');
    if (!tableEl) return;
    
    // Hide the separate strategy table panel as it's now merged into the sampler summary
    const panel = tableEl.closest('.panel');
    if (panel) {
        panel.style.display = 'none';
    }
}

/**
 * Calculate mulligan breakdown (probability of each mulligan)
 */
function calculateMulliganBreakdown(result, freeMulligan, penalty) {
    const { stepStats } = result;
    const breakdown = [];
    
    let takeProbability = 1.0;
    let cumulativeKeepProb = 0;
    let cumulativeSuccessProb = 0;

    for (let i = 0; i < stepStats.length; i++) {
        const stats = stepStats[i];
        const isFree = i === 1 && freeMulligan;
        const penaltyFactor = (i === 0) ? 0 : (freeMulligan ? (i - 1) : i);
        const cards = Math.max(0, 7 - penaltyFactor);
        
        const marginalKeep = takeProbability * stats.keepProb;
        cumulativeKeepProb += marginalKeep;
        cumulativeSuccessProb += marginalKeep * stats.successIfKept;

        const label = i === 0 ? 'Opening hand (7 cards)' : 
                     (isFree ? `Mulligan ${i} - Free (see 7, keep 7)` : `Mulligan ${i} (see 7, keep ${cards})`);

        breakdown.push({ 
            label, 
            marginalKeep, 
            successIfKept: stats.successIfKept,
            conditionalKeepProb: stats.keepProb,
            cumulativeKeep: cumulativeKeepProb, 
            cumulativeSuccess: cumulativeSuccessProb,
            hasPenalty: penaltyFactor > 0 && penalty > 0
        });

        takeProbability *= (1 - stats.keepProb);
        if (takeProbability < 0.0001) break;
    }

    return breakdown;
}

/**
 * Update summary stats with clearer explanations
 */
function updateSummary(config, result, sharedData) {
    const summaryEl = document.getElementById('mull-summary');
    if (!summaryEl) return;

    // Marginal benefits helper
    const getImpact = (pct) => pct > 1.5 ? ['▲ High impact', '#55c97f'] : pct > 0.5 ? ['✓ Medium impact', '#55c97f'] : pct < 0 ? ['✗ Negative impact', '#e8635c'] : ['· Low impact', 'var(--text-dim)'];

    const marginalsHTML = result.marginalBenefits.map((b, i) => {
        const benefitPct = b.overall * 100;
        
        // Trigger "Cut/Saturation" advice if:
        // 1. Negative impact (Adding hurts)
        // 2. Saturated (High success >90% AND low benefit <0.5%)
        const isNegative = benefitPct < 0;
        const isSaturated = result.expectedSuccess > 0.90 && benefitPct < 0.5;
        
        if (isNegative || isSaturated) {
             const reason = isNegative 
                ? "Adding more reduces consistency. You likely have too many." 
                : `Diminishing returns. Adding more gives minimal gain (+${formatPercentage(Math.max(0, b.overall), 2)}).`;

             return `<li style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="color:var(--text-light);font-weight:600">Consider Cutting 1 ${config.types[i].name}</span><span style="font-size:0.85em;font-weight:bold;color:#f0a92c;background:rgba(240, 169, 44, 0.1);padding:2px 8px;border-radius:0">✗ Cut recommendation</span></div><div style="font-size:0.9em;color:var(--text-secondary)">${reason}</div></li>`;
        }

        const [label, color] = getImpact(benefitPct);
        return `<li style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="color:var(--text-light);font-weight:600">+1 ${config.types[i].name}</span>
                <span style="font-size:0.85em;font-weight:bold;color:${color};background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:0">${label}</span>
            </div>
            <div style="font-size:0.9em;color:var(--text-secondary)">
                Improves win rate by <strong style="color:${color}">${formatPercentage(Math.max(0, b.overall), 2)}</strong>
                <div style="font-size:0.85em;color:var(--text-dim);margin-top:4px;font-style:italic;">
                    (God hand rate: +${formatPercentage(Math.max(0, b.baseline), 2)} if you never mulligan)
                </div>
            </div>
        </li>`;
    }).join('');

    // Strategy Breakdown List
    const breakdownHTML = `
        <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:grid; grid-template-columns: 1.5fr 1fr 1fr; padding: 0 12px; font-size:0.75em; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.5px;">
                <span>Mulligan Step</span>
                <span style="text-align:right">Keep Chance</span>
                <span style="text-align:right">Win Rate</span>
            </div>
            ${sharedData.breakdown.map((m, idx) => {
                // Calculate average win rate for hands kept up to this point
                const avgWinRate = m.cumulativeKeep > 0 ? m.cumulativeSuccess / m.cumulativeKeep : 0;
                
                return `
                <div style="display:grid; grid-template-columns: 1.5fr 1fr 1fr; align-items:center; padding:8px 12px; background:${idx === 0 ? 'rgba(85,201,127,0.05)' : 'var(--tx-panel-alt)'}; border-radius:0; border:1px solid ${idx === 0 ? 'rgba(85,201,127,0.15)' : 'var(--tx-rule)'}">
                    <div style="font-size:0.9em; color:${idx === 0 ? '#55c97f' : 'var(--text-light)'}">
                        ${m.label.split('(')[0].trim()}
                        <div style="font-size:0.8em; color:var(--text-dim);">Keep ${7 - (m.label.includes('Opening') || m.label.includes('Free') ? 0 : idx - (config.freeMulligan ? 1 : 0))}</div>
                    </div>
                    <div style="text-align:right; font-weight:bold; color:${m.cumulativeKeep > 0.9 ? '#55c97f' : '#9878b8'}">
                        ${formatPercentage(m.cumulativeKeep)}
                    </div>
                    <div style="text-align:right; font-weight:bold; color:${avgWinRate >= config.confidenceThreshold ? '#55c97f' : '#f0a92c'}">
                        ${formatPercentage(avgWinRate)}
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div style="margin-top:12px; font-size:0.8em; color:var(--text-dim); font-style:italic;">
            * <strong>Keep Chance:</strong> Probability you find a keepable hand by this step (Cumulative).<br>
            <span style="opacity:0.8; font-size:0.9em; display:block; margin-top:2px; margin-bottom:6px; color:#939c97;">&nbsp;&nbsp;↳ Note: This uses probability math, not simple addition. (e.g. Two 50% chances = 75% total chance, not 100%).</span>
            * <strong>Win Rate:</strong> Average success rate of hands kept by this step.
        </div>
    `;

    // Colour the headline by its verdict tier rather than a fixed accent, so the
    // number itself tells you whether the plan is reliable.
    const successVerdict = probabilityVerdict(result.expectedSuccess);

    summaryEl.innerHTML = `
        ${renderHeroStats([
            { label: 'SUCCESS RATE', value: formatPercentage(result.expectedSuccess), sub: `optimal mulligans · ${formatPercentage(result.unpenalizedSuccess)} unpenalized`, color: successVerdict.color, size: 'big' },
            { label: 'AVG STARTING HAND', value: '~' + formatNumber(result.expectedCards, 1), sub: 'cards kept', color: 'var(--tx-green)' },
            { label: 'AVG MULLIGANS', value: formatNumber(result.avgMulligans, 2), sub: 'to a keepable hand', color: 'var(--tx-amber)' }
        ])}

        <div style="border:1px solid var(--tx-rule); border-top:0; background:var(--tx-panel-alt); padding:14px;">
            <h3 style="margin:0 0 12px 0; font-size:10px; color:var(--tx-dim); text-transform:uppercase; letter-spacing:0.12em;">Strategy Breakdown</h3>
            <details><summary style="cursor:pointer; color:var(--tx-mid); font-size:11px;">View step-by-step stats</summary><div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--tx-rule);">${breakdownHTML}</div></details>
        </div>

        <div style="border:1px solid var(--tx-rule); border-top:0; background:var(--tx-panel); padding:14px;">
            <h3 style="margin:0 0 16px 0; font-size:10px; color:var(--tx-dim); text-transform:uppercase; letter-spacing:0.12em;">Deck Tuning Tips</h3>
            <ul style="margin:0; padding:0; list-style:none">${marginalsHTML}</ul>
        </div>`;
}

/**
 * Common chart options generator
 */
function getChartOptions(xLabel, yLabel = 'Probability', title = null) {
    return {
        plugins: {
            ...(title && { title: { display: true, text: title, color: TX.mid, font: { size: 11, weight: 'normal' }, padding: { bottom: 15 } } }),
            legend: {
                display: true,
                position: 'top',
                labels: { color: TX.mid, font: { size: 10 }, padding: 12, boxWidth: 10, boxHeight: 2 }
            },
            tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } }
        },
        scales: {
            x: {
                grid: { color: TX.rule, drawBorder: false },
                ticks: { color: TX.dim, font: { size: 9 } },
                title: { display: true, text: xLabel, color: TX.dim, font: { size: 9 } }
            },
            y: {
                beginAtZero: true,
                max: 100,
                grid: { color: TX.rule, drawBorder: false },
                ticks: { color: TX.dim, font: { size: 9 }, callback: v => v + '%' },
                title: { display: true, text: yLabel, color: TX.dim, font: { size: 9 } }
            }
        }
    };
}

/**
 * Calculate turn-by-turn probabilities
 */
function calculateTurnProbabilities(config) {
    const maxTurn = Math.max(...config.types.map(t => t.byTurn)) + 3;
    const turnData = [];

    for (let turn = 0; turn <= maxTurn; turn++) {
        // Standard draw: Turn 0 = 7 cards. Turn N = 7 + N.
        const cardsSeen = 7 + turn;

        // Individual type probabilities
        const typeProbabilities = config.types.map(type => {
            let prob = 0;
            for (let drawn = type.required; drawn <= Math.min(type.count, cardsSeen); drawn++) {
                prob += multiTypeProb(config.deckSize, [type.count], cardsSeen, [drawn]);
            }
            return prob;
        });

        // Combined probability using cumulative function
        const combinedProb = multiTypeProbCumulative(
            config.deckSize,
            config.types.map(t => t.count),
            cardsSeen,
            config.types.map(t => t.required)
        );

        turnData.push({ turn, typeProbabilities, combinedProb });
    }

    return turnData;
}

/**
 * Update visualization charts
 */
function updateChart(config, sharedData) {
    // Turn-by-Turn Chart (compute once if not cached in sharedData)
    if (document.getElementById('mull-turn-chart')) {
        if (!sharedData.turnData) {
            sharedData.turnData = calculateTurnProbabilities(config);
        }
        // Per-type series use the colour the user picked for that row in the
        // requirements list, so the chart matches the swatches above it.
        const datasets = [
            ...config.types.map((type, i) => ({
                label: type.name,
                data: sharedData.turnData.map(d => d.typeProbabilities[i] * 100),
                borderColor: type.color || TX.series[i % TX.series.length],
                backgroundColor: 'transparent',
                borderWidth: 1,
                fill: false,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 3,
                borderDash: [4, 3]
            })),
            {
                label: 'Confidence threshold',
                data: sharedData.turnData.map(() => config.confidenceThreshold * 100),
                borderColor: TX.amber,
                borderWidth: 1,
                borderDash: [2, 2],
                pointRadius: 0,
                fill: false,
                order: 0
            },
            {
                label: 'Combined (all requirements)',
                data: sharedData.turnData.map(d => d.combinedProb * 100),
                borderColor: TX.green,
                backgroundColor: TX.greenFill,
                borderWidth: 2,
                fill: true,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointBackgroundColor: TX.green
            }
        ];

        turnChart = createOrUpdateChart(turnChart, 'mull-turn-chart', {
            type: 'line',
            data: { labels: sharedData.turnData.map(d => d.turn), datasets },
            options: getChartOptions('Turn', 'Probability', 'Natural Draw Probability (No Mulligan)')
        });
    }
}

/**
 * Update all UI elements
 */
export function updateUI() {
    const { config, result } = calculate();

    if (!result) {
        document.getElementById('mull-strategyTable').innerHTML = '<tr><td>Configure card types to see strategy</td></tr>';
        document.getElementById('mull-summary').innerHTML = '<p>Set up your card type requirements to calculate optimal mulligan strategy.</p>';
        return;
    }

    // Pre-compute shared data once
    const sharedData = {
        breakdown: calculateMulliganBreakdown(result, config.freeMulligan, config.penalty),
        totalKeepProb: result.keepProb,
        typeCounts: config.types.map(t => t.count),
        turnData: null  // Lazy computed on first use
    };

    updateChart(config, sharedData);
    updateStrategyTable(config, result, sharedData);
    updateSummary(config, result, sharedData);
    
    // Validation Warning
    const totalCards = config.types.reduce((sum, t) => sum + t.count, 0);
    const warningId = 'mull-deck-oversize-warning';
    let warningEl = document.getElementById(warningId);
    
    // Collect all errors
    const errors = [];
    if (totalCards > config.deckSize) {
        errors.push(`Total cards in types (${totalCards}) exceeds deck size (${config.deckSize}). Results will be inaccurate.`);
    }
    
    config.types.forEach(t => {
        if (t.count === 0) {
            errors.push(`Type "${t.name}" has 0 cards in deck.`);
        } else if (t.count < t.required) {
            errors.push(`Type "${t.name}" count (${t.count}) is less than required in hand (${t.required}).`);
        }
    });

    if (errors.length > 0) {
        if (!warningEl) {
             warningEl = document.createElement('div');
             warningEl.id = warningId;
             warningEl.style.color = '#e8635c';
             warningEl.style.marginTop = '16px';
             warningEl.style.marginBottom = '16px';
             warningEl.style.padding = '12px';
             warningEl.style.background = 'rgba(232, 99, 92, 0.1)';
             warningEl.style.border = '1px solid rgba(232, 99, 92, 0.3)';
             warningEl.style.borderRadius = '8px';
             warningEl.style.textAlign = 'left';
             warningEl.style.fontWeight = '600';
             warningEl.style.fontSize = '0.95em';
             
             // Insert after types container
             const container = document.getElementById('mull-types-container');
             if (container && container.parentNode) {
                 container.parentNode.insertBefore(warningEl, container.nextSibling);
             }
        }
        warningEl.innerHTML = errors.map(e => `<div>✗ Warning: ${e}</div>`).join('');
        warningEl.style.display = 'block';
    } else {
        if (warningEl) warningEl.style.display = 'none';
    }

    // Auto-run samples (virtual deck allows this without import)
    // We only run if the display element exists (it should)
    if (document.getElementById('mulligan-reveals-display')) {
        runSampleReveals();
    }
}

/**
 * Handle Preset Change
 */
function applyPreset(preset) {
    const presets = {
        casual: [50, 60],      // 50% penalty, 60% threshold
        balanced: [20, 75],    // 20% penalty, 75% threshold
        competitive: [5, 92]   // 5% penalty, 92% threshold
    };

    const [penalty, threshold] = presets[preset] || presets.balanced;
    const els = {
        penalty: document.getElementById('mull-penalty'),
        penaltyDisplay: document.getElementById('mull-penalty-display'),
        threshold: document.getElementById('mull-threshold'),
        thresholdDisplay: document.getElementById('mull-threshold-display')
    };

    if (!els.penalty || !els.threshold) return;

    els.penalty.value = penalty;
    els.penaltyDisplay.textContent = penalty + '%';
    els.threshold.value = threshold;
    els.thresholdDisplay.textContent = threshold + '%';
    
    // Update active button state — styling lives in CSS (.preset-btn.active) so
    // the buttons stay on-theme instead of carrying hard-coded inline colors.
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === preset);
    });

    updateDescriptions();
    updateUI();
}

/**
 * Update slider descriptions based on values
 */
function updateDescriptions() {
    const penalty = parseInt(document.getElementById('mull-penalty')?.value || 0);
    const threshold = parseInt(document.getElementById('mull-threshold')?.value || 0);
    
    const penaltyDesc = document.getElementById('mull-penalty-desc');
    const thresholdDesc = document.getElementById('mull-threshold-desc');

    if (penaltyDesc) {
        if (penalty <= 5) penaltyDesc.textContent = "Aggressive. You dig deep for combo pieces.";
        else if (penalty <= 25) penaltyDesc.textContent = "Standard. A balanced approach to risk.";
        else if (penalty <= 40) penaltyDesc.textContent = "Conservative. You prefer keeping 7 cards.";
        else penaltyDesc.textContent = "Very Conservative. You almost never mulligan.";
    }

    if (thresholdDesc) {
        if (threshold >= 90) thresholdDesc.textContent = "Perfectionist. You only keep amazing hands.";
        else if (threshold >= 75) thresholdDesc.textContent = "Disciplined. You want consistent strong starts.";
        else if (threshold >= 60) thresholdDesc.textContent = "Loose. You trust your topdecks.";
        else thresholdDesc.textContent = "Gambler. You keep risky hands often.";
    }
}

/**
 * Set card types programmatically (e.g. from share link)
 * @param {Array} types - Array of card type objects
 */
export function setCardTypes(types) {
    if (Array.isArray(types)) {
        cardTypes = types;
        nextTypeId = Math.max(...types.map(t => t.id), 0) + 1;
        renderCardTypes();
        updateUI();
    }
}

/**
 * Get current calculator state for sharing
 * @returns {Object} - Current state
 */
export function getState() {
    return getDeckConfig();
}

/**
 * Initialize the mulligan calculator
 */
export function init() {
    // Render initial card types
    renderCardTypes();

    const container = document.getElementById('mulligan-sample-reveals');
    if (container) {
        container.innerHTML = generateSampleRevealsHTML('mulligan', 'Sample Opening Hands', { requiresImport: false });
    }

    // Add type button
    const addBtn = document.getElementById('mull-add-type');
    if (addBtn) {
        addBtn.addEventListener('click', addCardType);
    }

    // Preset Buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            applyPreset(e.target.dataset.preset);
        });
    });

    // Sliders with unified handler
    const setupSlider = (id, displayId, formatter) => {
        const slider = document.getElementById(id);
        const display = document.getElementById(displayId);
        if (slider && display) {
            slider.addEventListener('input', () => {
                display.textContent = formatter(slider.value);
                updateDescriptions();
                updateUI();
            });
        }
    };

    setupSlider('mull-penalty', 'mull-penalty-display', v => v + '%');
    setupSlider('mull-threshold', 'mull-threshold-display', v => v + '%');

    // Checkboxes with unified handler
    ['mull-free'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.addEventListener('change', () => updateUI());
    });
    
    // Bind Sample Button
    const sampleBtn = document.getElementById('mulligan-draw-reveals-btn');
    if (sampleBtn) {
        sampleBtn.addEventListener('click', refreshSamples);
    }

    // Listen for deck configuration changes
    DeckConfig.onDeckUpdate(() => {
        updateUI();
    });

    updateDescriptions(); // Initial description set
    updateUI();
}