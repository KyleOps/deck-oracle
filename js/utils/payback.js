/**
 * Shared value/payback helpers for spells that put cards onto the battlefield.
 */

export const PAYBACK_VALUE_STEP = 0.25;

function finiteNonNegative(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function toUnits(value) {
    return Math.round(finiteNonNegative(value) / PAYBACK_VALUE_STEP);
}

function choose(n, k) {
    if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0 || k > n) return 0;
    const smaller = Math.min(k, n - k);
    let result = 1;
    for (let i = 1; i <= smaller; i++) {
        result *= (n - smaller + i) / i;
    }
    return result;
}

/**
 * Score one battlefield result using printed mana value plus optional utility bonuses.
 * @param {{manaValue?:number, lands?:number, cards?:number}} run
 * @param {{landValue?:number, cardValue?:number, threshold?:number}} settings
 */
export function scoreBattlefieldValue(run = {}, settings = {}) {
    const manaValue = finiteNonNegative(run?.manaValue);
    const lands = finiteNonNegative(run?.lands);
    const cards = finiteNonNegative(run?.cards);
    const landValue = finiteNonNegative(settings?.landValue);
    const cardValue = finiteNonNegative(settings?.cardValue);
    const threshold = finiteNonNegative(settings?.threshold);
    const effectiveValue = manaValue + (lands * landValue) + (cards * cardValue);

    return {
        manaValue,
        effectiveValue,
        paidForItself: effectiveValue >= threshold
    };
}

/**
 * Calculate an exact payback probability for a fixed-size reveal without replacement.
 * Values are quantized to quarter-mana units and totals at/above the threshold are
 * folded into a single paid state, keeping the dynamic program compact.
 *
 * @param {Array<{count?:number, cmc?:number, isLand?:boolean, eligible?:boolean}>} cards
 * @param {number} draws
 * @param {{landValue?:number, cardValue?:number, threshold?:number}} settings
 */
export function calculateFixedDrawPayback(cards = [], draws = 0, settings = {}) {
    const normalized = [];
    let deckSize = 0;
    let totalValue = 0;
    let totalManaValue = 0;
    let eligibleCards = 0;
    let eligibleLands = 0;
    const landValue = finiteNonNegative(settings?.landValue);
    const cardValue = finiteNonNegative(settings?.cardValue);
    const threshold = finiteNonNegative(settings?.threshold);

    for (const card of cards ?? []) {
        const count = Math.max(0, Math.floor(finiteNonNegative(card?.count)));
        if (count === 0) continue;
        const eligible = card?.eligible === true;
        const value = eligible
            ? finiteNonNegative(card?.cmc) + cardValue + (card?.isLand === true ? landValue : 0)
            : 0;
        const units = toUnits(value);
        deckSize += count;
        totalValue += count * value;
        if (eligible) {
            totalManaValue += count * finiteNonNegative(card?.cmc);
            eligibleCards += count;
            if (card?.isLand === true) eligibleLands += count;
        }
        for (let i = 0; i < count; i++) normalized.push(units);
    }

    const drawCount = Math.min(deckSize, Math.max(0, Math.floor(finiteNonNegative(draws))));
    const expectedEffectiveValue = deckSize > 0 ? drawCount * (totalValue / deckSize) : 0;
    const expectedManaValue = deckSize > 0 ? drawCount * (totalManaValue / deckSize) : 0;
    const expectedCards = deckSize > 0 ? drawCount * (eligibleCards / deckSize) : 0;
    const expectedLands = deckSize > 0 ? drawCount * (eligibleLands / deckSize) : 0;
    const thresholdUnits = toUnits(threshold);

    if (thresholdUnits === 0) {
        return { paybackProbability: 1, whiffProbability: 0, expectedEffectiveValue, expectedManaValue, expectedCards, expectedLands, drawCount, deckSize };
    }
    if (deckSize === 0 || drawCount === 0) {
        return { paybackProbability: 0, whiffProbability: 1, expectedEffectiveValue, expectedManaValue, expectedCards, expectedLands, drawCount, deckSize };
    }

    const dp = Array.from({ length: drawCount + 1 }, () => new Float64Array(thresholdUnits + 1));
    dp[0][0] = 1;
    let processed = 0;

    for (const units of normalized) {
        const maxDraw = Math.min(drawCount, processed + 1);
        for (let selected = maxDraw; selected >= 1; selected--) {
            for (let sum = 0; sum <= thresholdUnits; sum++) {
                const ways = dp[selected - 1][sum];
                if (ways === 0) continue;
                dp[selected][Math.min(thresholdUnits, sum + units)] += ways;
            }
        }
        processed++;
    }

    const totalWays = choose(deckSize, drawCount);
    const paidWays = dp[drawCount][thresholdUnits];
    const paybackProbability = totalWays > 0 ? Math.min(1, Math.max(0, paidWays / totalWays)) : 0;

    return {
        paybackProbability,
        whiffProbability: 1 - paybackProbability,
        expectedEffectiveValue,
        expectedManaValue,
        expectedCards,
        expectedLands,
        drawCount,
        deckSize
    };
}
