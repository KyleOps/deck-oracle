/**
 * Mulligan Strategy Calculator
 * Determines optimal mulligan decisions for any number of card types
 */

import { choose, drawTwoTypeMin, drawThreeTypeMin } from '../utils/hypergeometric.js';
import { formatNumber, formatPercentage, createCache } from '../utils/simulation.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderStatCard, renderStatsGrid, renderInsightBox, generateSampleRevealsHTML } from '../utils/components.js';
import {
    buildDeckFromCardData, shuffleDeck, renderCardBadge, renderDistributionChart,
    createCollapsibleSection, extractCardTypes
} from '../utils/sampleSimulator.js';

let simulationCache = createCache(100);
let lastConfigHash = '';
let chart = null;
let turnChart = null;

// Stable samples state
let stableSamples = [];
let lastSampleDeckHash = '';
const SAMPLE_COUNT_DEFAULT = 10;
let renderedCount = 0;

const DEFAULT_COLORS = ['#22c55e', '#3b82f6', '#ef4444', '#eab308', '#a855f7', '#ec4899', '#06b6d4', '#f97316'];

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
    
    const initialDeckCounts = types.map((t, i) => t.count - handCounts[i]);
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
        label: '✅ Meets or exceeds',
        match: (c) => config.types.every((t, idx) => c[idx] >= t.required),
        sampleCount: 0,
        type: 'success'
    });
    
    // 2. Missing exactly 1 card of a specific type (and others are met)
    config.types.forEach((t, i) => {
        scenarios.push({
            label: `⚠️ Missing 1: ${t.name}`,
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
    
    let summaryContentHTML = '<div style="margin-top: var(--spacing-md); padding: var(--spacing-md); background: var(--panel-bg-alt); border-radius: var(--radius-md); margin-bottom: var(--spacing-lg);">';
    
    // Natural Hits & Accuracy Analysis
    summaryContentHTML += `
        <div style="padding-top: 8px;">
             <!-- Natural Hit Rate -->
            <div style="margin-bottom: 20px; padding: 12px; background: rgba(192, 132, 252, 0.1); border: 1px solid rgba(192, 132, 252, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <div style="color: #c084fc; font-weight: bold; font-size: 1.1em;">Natural "God Hands"</div>
                    <div style="color: var(--text-secondary); font-size: 0.85em;">Hands meeting all requirements immediately (Turn 0)</div>
                </div>
                <div style="font-size: 1.4em; font-weight: bold; color: #fff;">${pct(instantSuccessCount)}</div>
            </div>

            <div style="color:var(--text-dim); text-transform:uppercase; font-size:0.75em; letter-spacing:1px; margin-bottom:12px; text-align:center;">Simulation vs Strategy Analysis</div>
            
            <div style="display: grid; gap: 12px;">
                <!-- 1. Correct Keep -->
                <div style="background:rgba(34,197,94,0.05); padding:10px; border-radius:6px; border:1px solid rgba(34,197,94,0.1); display:grid; grid-template-columns: 1fr auto; align-items:center;">
                    <div>
                        <div style="font-size:0.9em; color:#4ade80; font-weight:600;">Correct Keep (Won)</div>
                        <div style="font-size:0.8em; color:var(--text-dim);">Strategy said Keep, and you got there.</div>
                    </div>
                    <div style="font-size:1.2em; font-weight:bold; color:#4ade80;">${pct(correctKeepCount)}</div>
                </div>

                <!-- 2. Bad Beat -->
                <div style="background:rgba(239,68,68,0.05); padding:10px; border-radius:6px; border:1px solid rgba(239,68,68,0.1); display:grid; grid-template-columns: 1fr auto; align-items:center;">
                    <div>
                        <div style="font-size:0.9em; color:#f87171; font-weight:600;">Bad Beat (Kept & Failed)</div>
                        <div style="font-size:0.8em; color:var(--text-dim);">Strategy said Keep (High Odds), but luck failed you. <br><span style="color:var(--text-secondary);">Rule: To reduce risk, <strong>INCREASE Confidence Threshold</strong>.</span></div>
                    </div>
                    <div style="font-size:1.2em; font-weight:bold; color:#f87171;">${pct(overconfidentKeepCount)}</div>
                </div>

                <!-- 3. Missed Opportunity -->
                <div style="background:rgba(245, 158, 11, 0.05); padding:10px; border-radius:6px; border:1px solid rgba(245, 158, 11, 0.1); display:grid; grid-template-columns: 1fr auto; align-items:center;">
                    <div>
                        <div style="font-size:0.9em; color:#f59e0b; font-weight:600;">Missed Opportunity (Mulled & Succeeded)</div>
                        <div style="font-size:0.8em; color:var(--text-dim);">Strategy said Mull, but the hand would have hit. <br><span style="color:var(--text-secondary);">Rule: To be greedier, <strong>DECREASE Confidence Threshold</strong>.</span></div>
                    </div>
                    <div style="font-size:1.2em; font-weight:bold; color:#f59e0b;">${pct(missedOpportunityCount)}</div>
                </div>

                <!-- 4. Correct Mulligan -->
                <div style="background:rgba(56, 189, 248, 0.05); padding:10px; border-radius:6px; border:1px solid rgba(56, 189, 248, 0.1); display:grid; grid-template-columns: 1fr auto; align-items:center;">
                    <div>
                        <div style="font-size:0.9em; color:#38bdf8; font-weight:600;">Good Mulligan (Avoided Loss)</div>
                        <div style="font-size:0.8em; color:var(--text-dim);">Strategy said Mull, and the hand would have bricked.</div>
                    </div>
                    <div style="font-size:1.2em; font-weight:bold; color:#38bdf8;">${pct(correctMulliganCount)}</div>
                </div>
            </div>
        </div>
    `;

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
                    const winChanceColor = avgSuccessProb >= 0.75 ? '#4ade80' : avgSuccessProb >= 0.5 ? '#f59e0b' : '#f87171';

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
                        <td style="color:${isKeep ? '#4ade80' : '#f87171'}; font-weight:bold;">${isKeep ? 'KEEP' : 'MULL'}</td>
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
                        label = '✅ Correct Keep';
                        statusColor = '#4ade80';
                        statusBg = 'rgba(34, 197, 94, 0.05)';
                        borderColor = 'rgba(34, 197, 94, 0.3)';
                    } else {
                        label = '💀 Bad Beat';
                        statusColor = '#f87171';
                        statusBg = 'rgba(239, 68, 68, 0.05)';
                        borderColor = 'rgba(239, 68, 68, 0.3)';
                    }
                } else {
                    if (isSuccess) {
                        label = '⚠️ Missed Opportunity';
                        statusColor = '#f59e0b';
                        statusBg = 'rgba(245, 158, 11, 0.05)';
                        borderColor = 'rgba(245, 158, 11, 0.3)';
                    } else {
                        label = '✅ Good Mulligan';
                        statusColor = '#38bdf8';
                        statusBg = 'rgba(56, 189, 248, 0.05)';
                        borderColor = 'rgba(56, 189, 248, 0.3)';
                    }
                }

                html += `<div class="sample-reveal" style="background:${statusBg}; border:1px solid ${borderColor}; padding: 12px; border-radius: 8px; margin-bottom: 12px;">`;
                
                html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div style="font-weight:600; color:${statusColor}; font-size:0.95em;">${label} <span style="color:var(--text-dim); font-weight:normal; font-size:0.9em;">(Sample ${i + 1})</span></div>
                    <div style="font-size:0.85em; color:var(--text-secondary);">Strategy: <span style="font-weight:bold; color:${keep ? '#4ade80' : '#f87171'}">${keep ? 'KEEP' : 'MULL'}</span> <span style="color:var(--text-dim)">(${formatPercentage(successProb)} win chance)</span></div>
                </div>`;
                
                html += '<div style="margin: 8px 0; display: flex; flex-wrap: wrap; gap: 4px;">';
                hand.forEach(card => {
                    html += renderVirtualCard(card);
                });
                html += '</div>';
                
                let fixColor = '#ef4444';
                let fixText = '';
                if (needs.length === 0) {
                    fixText = 'Started with requirements met';
                    fixColor = '#4ade80';
                } else if (fixedByTurn) {
                    fixText = `Found missing pieces by Turn ${fixedByTurn}`;
                    fixColor = '#4ade80';
                } else {
                    fixText = `Failed to find pieces (Checked ${maxTurn} draws)`;
                    fixColor = '#ef4444';
                }

                html += `<div class="reveal-summary" style="font-size:0.85em; color:var(--text-secondary); display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:8px; border-top:1px dashed ${borderColor};">
                    <span>${summaryText}</span>
                    <span style="color:${fixColor}; font-weight:600;">${fixText}</span>
                </div>`;

                if (draws.length > 0) {
                    html += `<div style="margin-top: 8px; font-size: 0.85em; color: var(--text-dim);">Next ${draws.length} natural draws:</div>`;
                    html += '<div style="margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px; opacity: 0.9;">';
                    draws.forEach((card, idx) => {
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
    const color = card.isKnown ? (card.color || 'var(--theme-secondary)') : '#4b5563';
    const bg = card.isKnown 
        ? (card.color ? card.color + '33' : 'rgba(192, 132, 252, 0.2)') 
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
            <div class="type-input"><label>Cards in Deck</label><input type="number" class="type-count" value="${t.count}" min="0" data-type-id="${t.id}"></div>
            <div class="type-input"><label>Need in Hand</label><input type="number" class="type-required" value="${t.required}" min="0" max="7" data-type-id="${t.id}"></div>
            <div class="type-input"><label>By Turn</label><input type="number" class="type-turn" value="${t.byTurn}" min="1" max="10" data-type-id="${t.id}"></div>
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

    // Calculate confidence consistency using shared data
    const confidentKeepRate = result.strategy.reduce((sum, h) =>
        h.keep && h.successProb >= config.confidenceThreshold ? sum + h.handProb : sum, 0);
    const confidenceConsistency = sharedData.totalKeepProb > 0 ? confidentKeepRate / sharedData.totalKeepProb : 0;

    // Marginal benefits helper
    const getImpact = (pct) => pct > 1.5 ? ['🔥 High Impact', '#22c55e'] : pct > 0.5 ? ['✅ Medium Impact', '#4ade80'] : pct < 0 ? ['⚠️ Negative Impact', '#ef4444'] : ['Low Impact', 'var(--text-dim)'];

    const s = { // Common styles
        card: 'text-align:center;padding:16px;border-radius:12px',
        label: 'font-size:0.8em;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px',
        big: 'font-size:2.2em;font-weight:700;line-height:1',
        sub: 'color:var(--text-dim);font-size:0.8em;margin-top:4px'
    };

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

             return `<li style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="color:var(--text-light);font-weight:600">Consider Cutting 1 ${config.types[i].name}</span><span style="font-size:0.85em;font-weight:bold;color:#f59e0b;background:rgba(245, 158, 11, 0.1);padding:2px 8px;border-radius:4px">✂️ Cut Recommendation</span></div><div style="font-size:0.9em;color:var(--text-secondary)">${reason}</div></li>`;
        }

        const [label, color] = getImpact(benefitPct);
        const baselinePct = b.baseline * 100;
        return `<li style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="color:var(--text-light);font-weight:600">+1 ${config.types[i].name}</span>
                <span style="font-size:0.85em;font-weight:bold;color:${color};background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:4px">${label}</span>
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
                <div style="display:grid; grid-template-columns: 1.5fr 1fr 1fr; align-items:center; padding:8px 12px; background:${idx === 0 ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)'}; border-radius:6px; border:1px solid ${idx === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)'}">
                    <div style="font-size:0.9em; color:${idx === 0 ? '#4ade80' : 'var(--text-light)'}">
                        ${m.label.split('(')[0].trim()}
                        <div style="font-size:0.8em; color:var(--text-dim);">Keep ${7 - (m.label.includes('Opening') || m.label.includes('Free') ? 0 : idx - (config.freeMulligan ? 1 : 0))}</div>
                    </div>
                    <div style="text-align:right; font-weight:bold; color:${m.cumulativeKeep > 0.9 ? '#4ade80' : '#c084fc'}">
                        ${formatPercentage(m.cumulativeKeep)}
                    </div>
                    <div style="text-align:right; font-weight:bold; color:${avgWinRate >= config.confidenceThreshold ? '#4ade80' : '#f59e0b'}">
                        ${formatPercentage(avgWinRate)}
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div style="margin-top:12px; font-size:0.8em; color:var(--text-dim); font-style:italic;">
            * <strong>Keep Chance:</strong> Probability you find a keepable hand by this step (Cumulative).<br>
            <span style="opacity:0.8; font-size:0.9em; display:block; margin-top:2px; margin-bottom:6px; color:#9ca3af;">&nbsp;&nbsp;↳ Note: This uses probability math, not simple addition. (e.g. Two 50% chances = 75% total chance, not 100%).</span>
            * <strong>Win Rate:</strong> Average success rate of hands kept by this step.
        </div>
    `;

    summaryEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
            <div style="${s.card};background:linear-gradient(135deg,rgba(192,132,252,0.1) 0%,rgba(10,10,18,0) 100%);border:1px solid rgba(192,132,252,0.2)">
                <div style="${s.label}">Strategy Success Rate</div>
                <div style="${s.big};color:#c084fc">${formatPercentage(result.expectedSuccess)}</div>
                <div style="${s.sub}">With optimal mulligans <span style="font-size:0.9em; opacity:0.8; display:block;">(${formatPercentage(result.unpenalizedSuccess)} unpenalized)</span></div>
            </div>
            <div style="${s.card};background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2)">
                <div style="${s.label}">Starting Hand</div>
                <div style="${s.big};color:#4ade80">~${formatNumber(result.expectedCards, 1)}</div>
                <div style="${s.sub}">Average cards kept (Avg Mulls: ${formatNumber(result.avgMulligans, 2)})</div>
            </div>
        </div>
        
        <div style="background:var(--panel-bg-alt);border-radius:8px;padding:16px;margin-bottom:20px">
            <h3 style="margin:0 0 12px 0;font-size:0.95em;color:var(--text-light);text-transform:uppercase;letter-spacing:0.5px">Strategy Breakdown</h3>
            <details><summary style="cursor:pointer;color:var(--text-dim);font-size:0.85em">View Step-by-Step Stats</summary><div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color)">${breakdownHTML}</div></details>
        </div>

        <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-color);border-radius:8px;padding:16px">
            <h3 style="margin:0 0 16px 0;font-size:0.95em;color:var(--text-light);text-transform:uppercase;letter-spacing:0.5px">💡 Deck Tuning Tips</h3>
            <ul style="margin:0;padding:0;list-style:none">${marginalsHTML}</ul>
        </div>`;
}

/**
 * Common chart options generator
 */
function getChartOptions(xLabel, yLabel = 'Probability', title = null) {
    return {
        plugins: {
            ...(title && { title: { display: true, text: title, color: '#a09090', font: { size: 14, weight: 'normal' }, padding: { bottom: 15 } } }),
            legend: { display: true, position: 'top', labels: { color: '#a09090', font: { size: 11 }, padding: 12, usePointStyle: true } },
            tooltip: { mode: 'index', intersect: false, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } }
        },
        scales: {
            x: { grid: { color: 'rgba(192, 132, 252, 0.1)', drawBorder: false }, ticks: { color: '#a09090' }, title: { display: true, text: xLabel, color: '#a09090' } },
            y: { beginAtZero: true, max: 100, grid: { color: 'rgba(192, 132, 252, 0.15)', drawBorder: false }, ticks: { color: '#c084fc', callback: v => v + '%' }, title: { display: true, text: yLabel, color: '#c084fc' } }
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
        const colors = ['#a855f7', '#6b7280', '#c084fc'];

        const datasets = [
            ...config.types.map((type, i) => ({
                label: type.name,
                data: sharedData.turnData.map(d => d.typeProbabilities[i] * 100),
                borderColor: colors[i % colors.length],
                backgroundColor: colors[i % colors.length] + '30',
                borderWidth: 2,
                fill: false,
                tension: 0.3,
                pointRadius: 3,
                pointBackgroundColor: colors[i % colors.length],
                borderDash: [5, 5]
            })),
            { label: 'Confidence Threshold', data: sharedData.turnData.map(() => config.confidenceThreshold * 100), borderColor: '#22c55e', borderWidth: 2, borderDash: [2, 2], pointRadius: 0, fill: false, order: 0 },
            { label: 'Combined (ALL)', data: sharedData.turnData.map(d => d.combinedProb * 100), borderColor: '#c084fc', backgroundColor: 'rgba(192, 132, 252, 0.15)', borderWidth: 3, fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: '#c084fc', pointBorderColor: '#fff', pointBorderWidth: 2 }
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
             warningEl.style.color = '#ef4444';
             warningEl.style.marginTop = '16px';
             warningEl.style.marginBottom = '16px';
             warningEl.style.padding = '12px';
             warningEl.style.background = 'rgba(239, 68, 68, 0.1)';
             warningEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
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
        warningEl.innerHTML = errors.map(e => `<div>⚠️ Warning: ${e}</div>`).join('');
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
    
    // Update active button state
    document.querySelectorAll('.preset-btn').forEach(btn => {
        if (btn.dataset.preset === preset) {
            btn.classList.add('active');
            btn.style.border = '1px solid var(--accent)';
            btn.style.background = 'rgba(192,132,252,0.1)';
            btn.style.color = 'var(--text-light)';
        } else {
            btn.classList.remove('active');
            btn.style.border = '1px solid var(--border-color)';
            btn.style.background = 'var(--input-bg)';
            btn.style.color = 'var(--text-dim)';
        }
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