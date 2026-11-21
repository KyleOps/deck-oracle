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
 * Exact distribution of the value a fixed-size reveal puts onto the
 * battlefield: the same draw-without-replacement count as
 * calculateFixedDrawPayback, but over every total instead of folding totals
 * at the threshold. Values are in quarter-mana steps.
 *
 * @param {Array<{count?:number, cmc?:number, isLand?:boolean, eligible?:boolean}>} cards
 * @param {number} draws
 * @param {{landValue?:number, cardValue?:number}} settings
 * @returns {Array<{value:number, p:number}>} ascending by value
 */
export function fixedDrawValuePmf(cards = [], draws = 0, settings = {}) {
    const { units, deckSize } = revealUnits(cards, settings);
    const drawCount = Math.min(deckSize, Math.max(0, Math.floor(finiteNonNegative(draws))));
    if (deckSize === 0 || drawCount === 0) return [{ value: 0, p: 1 }];

    // Cards worth nothing only change how many valuable cards fit in the
    // reveal, so they are counted combinatorially; the dynamic program runs
    // over the valuable cards alone.
    const positive = units.filter(u => u > 0);
    const zeros = deckSize - positive.length;
    const maxUnits = positive.slice().sort((a, b) => b - a).slice(0, drawCount).reduce((a, b) => a + b, 0);
    const dp = subsetSums(positive, Math.min(drawCount, positive.length), maxUnits);
    const pmf = new Float64Array(maxUnits + 1);
    dp.forEach((row, picked) => {
        const fill = choose(zeros, drawCount - picked);
        if (!fill) return;
        for (let sum = 0; sum <= maxUnits; sum++) if (row[sum]) pmf[sum] += row[sum] * fill;
    });
    const totalWays = choose(deckSize, drawCount);
    const out = [];
    pmf.forEach((ways, sum) => {
        if (ways > 0) out.push({ value: sum * PAYBACK_VALUE_STEP, p: ways / totalWays });
    });
    return out;
}

/**
 * For each number of hits k (eligible cards revealed), the exact share of
 * k-hit reveals that reach the payback threshold. A k-hit reveal is an equally
 * likely pick of any k eligible cards, so this is a capped subset-sum count
 * over the eligible cards.
 *
 * @param {Array<{count?:number, cmc?:number, isLand?:boolean, eligible?:boolean}>} cards
 * @param {number} draws
 * @param {{landValue?:number, cardValue?:number, threshold?:number}} settings
 * @returns {number[]} index = hits (0..min(draws, eligible cards))
 */
export function paybackShareByHits(cards = [], draws = 0, settings = {}) {
    const { eligibleUnits, deckSize } = revealUnits(cards, settings);
    const drawCount = Math.min(deckSize, Math.max(0, Math.floor(finiteNonNegative(draws))));
    const maxHits = Math.min(drawCount, eligibleUnits.length);
    const thresholdUnits = toUnits(settings?.threshold);
    if (thresholdUnits === 0) return new Array(maxHits + 1).fill(1);
    const dp = subsetSums(eligibleUnits, maxHits, thresholdUnits, true);
    return dp.map((row, k) => {
        const total = choose(eligibleUnits.length, k);
        return total > 0 ? Math.min(1, row[thresholdUnits] / total) : 0;
    });
}

/** Cards → value units, plus the units of eligible cards alone. */
function revealUnits(cards, settings) {
    const landValue = finiteNonNegative(settings?.landValue);
    const cardValue = finiteNonNegative(settings?.cardValue);
    const units = [];
    const eligibleUnits = [];
    for (const card of cards ?? []) {
        const count = Math.max(0, Math.floor(finiteNonNegative(card?.count)));
        const eligible = card?.eligible === true;
        const u = eligible ? toUnits(finiteNonNegative(card?.cmc) + cardValue + (card?.isLand === true ? landValue : 0)) : 0;
        for (let i = 0; i < count; i++) {
            units.push(u);
            if (eligible) eligibleUnits.push(u);
        }
    }
    return { units, eligibleUnits, deckSize: units.length };
}

/**
 * ways[k][s]: the number of k-card picks from `units` totalling s. With
 * `capped`, totals at or above `limit` fold into ways[k][limit].
 */
function subsetSums(units, maxPick, limit, capped = false) {
    const ways = Array.from({ length: maxPick + 1 }, () => new Float64Array(limit + 1));
    ways[0][0] = 1;
    let reach = 0;
    units.forEach((u, processed) => {
        for (let picked = Math.min(maxPick, processed + 1); picked >= 1; picked--) {
            const previous = ways[picked - 1];
            const current = ways[picked];
            for (let sum = Math.min(reach, limit); sum >= 0; sum--) {
                const w = previous[sum];
                if (!w) continue;
                const to = sum + u;
                if (to <= limit) current[to] += w;
                else if (capped) current[limit] += w;
            }
        }
        reach = Math.min(limit, reach + u);
    });
    return ways;
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
