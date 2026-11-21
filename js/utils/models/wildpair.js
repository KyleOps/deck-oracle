/**
 * Wild Pair — the page's maths.
 *
 * {4}{G}{G} Enchantment — "Whenever a creature enters, if you cast it from your
 * hand, you may search your library for a creature card with the same total
 * power and toughness, put it onto the battlefield, then shuffle."
 *
 * Two printed clauses decide what this calculator is:
 *
 *   1. MATCHING IS ON TOTAL POWER + TOUGHNESS, not mana value, not type. The
 *      deck partitions into groups by that one number, and a creature only ever
 *      finds something if another creature shares its group. A 5/5 and a 3/7
 *      pair; a 5/5 and a 5/6 never do.
 *
 *   2. IT IS A TUTOR, NOT A REVEAL. You search the whole library and choose, so
 *      there is nothing to simulate: no shuffle, no draw, no probability of
 *      hitting. What matters is which creatures share a total and what they
 *      cost. That is why this is a group browser rather than a Monte Carlo like
 *      the rest of the site.
 *
 * What this deliberately does NOT model is running a group dry. Wild Pair is a
 * six-mana enchantment that is not on the battlefield for most of a game, so the
 * case where you cast enough creatures at one total to exhaust it is not worth
 * planning around. The question that matters is the structural one: when you
 * cast this creature, is there something to find, and how big is it?
 *
 * That leaves one real distinction — a total with two or more creatures is live,
 * a total with exactly one is dead — and one real number per group: the range of
 * mana values an activation there can put onto the battlefield.
 *
 * Pure: no DOM, no deck state. The page passes the creature list in.
 */

import { formatNumber } from '../simulation.js';
import { cardRef } from '../../data/glossary.js';

/** Wild Pair's own mana cost — the bar a single activation is measured against. */
export const WILD_PAIR_COST = 6;

/**
 * Parse a printed power/toughness box value to an integer.
 *
 * Variable boxes (`*`, `1+*`, `X`) have no fixed total, so a creature carrying
 * one cannot be reliably matched. Returning null lets those be reported
 * separately rather than silently grouped at some wrong number.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function parsePT(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (s === '') return null;
    if (s.includes('*') || s.toUpperCase().includes('X')) return null;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? null : n;
}

/**
 * Total power + toughness for a card, preferring the value computed at import
 * time and falling back to the raw boxes (for decks imported before `totalPT`
 * existed).
 *
 * @param {Object} card
 * @returns {number|null} null when either box is variable or missing
 */
export function cardTotalPT(card) {
    if (!card) return null;
    if (Number.isFinite(card.totalPT)) return card.totalPT;
    const p = parsePT(card.power);
    const t = parsePT(card.toughness);
    return (p === null || t === null) ? null : p + t;
}

/**
 * True when a card entry is a creature, tolerating every shape the app stores.
 * @param {Object} card
 * @returns {boolean}
 */
export function isCreatureEntry(card) {
    if (!card) return false;
    if (Array.isArray(card.allTypes)) return card.allTypes.includes('creatures');
    if (Array.isArray(card.allCategories)) return card.allCategories.includes('creatures');
    if (Array.isArray(card.types)) return card.types.includes('creature');
    if (typeof card.type === 'string') return card.type === 'creatures';
    if (typeof card.type_line === 'string') return card.type_line.toLowerCase().includes('creature');
    return false;
}

/**
 * Group a deck's creatures by total power + toughness — the one number Wild
 * Pair matches on.
 *
 * @param {Array<Object>} cardDetails - One entry per copy
 * @returns {{groups: Array<{total:number, cards:Array}>, creatures:number,
 *            variable:Array<Object>, missing:number}}
 */
export function bucketByTotalPT(cardDetails) {
    const details = Array.isArray(cardDetails) ? cardDetails : [];
    const map = new Map();
    const variable = [];
    let creatures = 0;
    let missing = 0;

    for (const card of details) {
        if (!isCreatureEntry(card)) continue;
        creatures += 1;

        // A creature with no toughness recorded at all is an import-data gap,
        // which is fixable; a genuinely variable box never matches.
        const hasBoxes = card.power !== undefined && card.power !== null
            && card.toughness !== undefined && card.toughness !== null;
        const total = cardTotalPT(card);

        if (total === null) {
            if (hasBoxes) variable.push(card); else missing += 1;
            continue;
        }

        if (!map.has(total)) map.set(total, []);
        map.get(total).push({
            name: card.name,
            cmc: Number.isFinite(card.cmc) ? card.cmc : 0,
            power: card.power,
            toughness: card.toughness
        });
    }

    const groups = [...map.entries()]
        .map(([total, cards]) => ({ total, cards: cards.slice().sort((a, b) => a.cmc - b.cmc) }))
        .sort((a, b) => a.total - b.total);

    return { groups, creatures, variable, missing };
}

/**
 * Solve one group: the pool of creatures sharing a total, and what an
 * activation there is worth.
 *
 * Membership is bidirectional and undifferentiated — cast any member and you may
 * search up any other — so there is nothing per-card to say beyond its printed
 * stats. Reporting a "best find" on every row just names the same card over and
 * over. The one number that varies and matters is the group's widest spread:
 * cast its cheapest member, search up its dearest.
 *
 * @param {{total:number, cards:Array<{name:string, cmc:number}>}} group
 * @returns {Object} group analysis
 */
export function analyzeBucket(group) {
    const cards = Array.isArray(group?.cards) ? [...group.cards].sort((a, b) => a.cmc - b.cmc) : [];
    const n = cards.length;
    const live = n >= 2;

    const cheapest = live ? cards[0] : null;
    const dearest = live ? cards[n - 1] : null;
    const swing = live ? dearest.cmc - cheapest.cmc : 0;

    // Sum of the best body each member could search up. Cards are sorted
    // ascending, so every card's best other is the last one — except the last
    // card itself, whose best other is the second to last.
    const fetchSum = live ? (n - 1) * cards[n - 1].cmc + cards[n - 2].cmc : 0;

    const mvs = cards.map(c => c.cmc);

    return {
        x: group.total,          // sweep-table row key
        total: group.total,
        count: n,
        live,
        // Cheat range: the mana value of the body an activation here puts onto
        // the battlefield, from worst to best.
        cheatMin: live ? mvs[0] : 0,
        cheatMax: live ? mvs[n - 1] : 0,
        cheatAvg: live ? mvs.reduce((a, b) => a + b, 0) / n : 0,
        cheapest,
        dearest,
        swing,
        fetchSum,
        avgFetch: live ? fetchSum / n : 0,
        // The direction worth taking here. Not a role assignment — either card
        // can be the one you cast.
        bestLine: live ? { total: group.total, cast: cheapest, fetched: dearest, leverage: swing } : null,
        cards
    };
}

/**
 * Full deck-level analysis.
 *
 * @param {Array<Object>} cardDetails
 * @returns {Object} analysis
 */
export function analyzeDeck(cardDetails) {
    const { groups, creatures, variable, missing } = bucketByTotalPT(cardDetails);
    const rows = groups.map(analyzeBucket);

    const liveRows = rows.filter(r => r.live);
    const deadRows = rows.filter(r => !r.live);

    const liveCreatures = liveRows.reduce((a, r) => a + r.count, 0);
    // Alone at their total, plus the ones with no usable printed total at all.
    const deadCreatures = deadRows.length + variable.length + missing;

    // What an average live creature actually cheats: the mana value of the best
    // body it can search up. A per-activation number, not a whole-game total —
    // Wild Pair is rarely out for a whole game.
    const fetchSum = liveRows.reduce((a, r) => a + r.fetchSum, 0);
    const avgCheat = liveCreatures > 0 ? fetchSum / liveCreatures : 0;

    const bestLines = liveRows
        .map(r => r.bestLine)
        .filter(Boolean)
        .sort((a, b) => b.leverage - a.leverage || b.fetched.cmc - a.fetched.cmc);

    const biggestFetch = liveRows.reduce((m, r) => Math.max(m, r.cheatMax), 0);
    const biggestSwing = liveRows.reduce((m, r) => Math.max(m, r.swing), 0);

    // The deck's engine: the total with the most creatures, ties broken by the
    // biggest body it can produce.
    const bestBucket = liveRows.reduce((best, r) => {
        if (!best) return r;
        if (r.count > best.count) return r;
        if (r.count === best.count && r.cheatMax > best.cheatMax) return r;
        return best;
    }, null);

    return {
        rows,
        liveRows,
        deadRows,
        creatures,
        variable,
        missing,
        totals: rows.map(r => r.total),
        buckets: rows.length,
        liveBuckets: liveRows.length,
        liveCreatures,
        deadCreatures,
        liveRate: creatures > 0 ? liveCreatures / creatures : 0,
        avgCheat,
        biggestFetch,
        biggestSwing,
        bestLines,
        bestBucket,
        minTotal: rows.length ? rows[0].total : null,
        maxTotal: rows.length ? rows[rows.length - 1].total : null,
        hasData: creatures > 0 && (creatures - missing) > 0
    };
}

/**
 * Look up one group by total.
 * @param {Object} analysis
 * @param {number} total
 * @returns {Object|null}
 */
export function groupAt(analysis, total) {
    if (!analysis?.rows) return null;
    return analysis.rows.find(r => r.total === total) ?? null;
}

/**
 * Snap a total to the nearest one the deck actually has.
 *
 * The selector only ever stops on totals that exist, so there are no blank
 * positions to drag through. This also repairs a total arriving from a share
 * link that was built against a different deck.
 *
 * @param {Object} analysis
 * @param {number} total
 * @returns {number|null}
 */
export function snapToTotal(analysis, total) {
    const totals = analysis?.totals ?? [];
    if (totals.length === 0) return null;
    if (!Number.isFinite(total)) return totals[0];
    if (totals.includes(total)) return total;
    return totals.reduce((best, t) =>
        Math.abs(t - total) < Math.abs(best - total) ? t : best, totals[0]);
}

/**
 * Judge whether Wild Pair earns a slot in this deck.
 *
 * Two things decide it and they trade off: how much of the creature base finds
 * anything at all, and how big the bodies it finds are. A deck of matched
 * one-drops is live everywhere and cheats nothing; a deck with two matched
 * fatties cheats a lot on the rare turn it connects.
 *
 * @param {Object} analysis - Result of analyzeDeck
 * @returns {{tier:string, label:string, color:string, advice:string}}
 */
export function fitVerdict(analysis) {
    const liveRate = analysis?.liveRate ?? 0;
    const avgCheat = analysis?.avgCheat ?? 0;
    const liveBuckets = analysis?.liveBuckets ?? 0;
    const biggestFetch = analysis?.biggestFetch ?? 0;

    if (!analysis?.hasData) {
        return {
            tier: 'unknown', label: 'No data', tone: 'flat', color: 'var(--tx-dim)',
            advice: 'Import a decklist so power and toughness are known for every creature.'
        };
    }
    if (liveBuckets === 0) {
        return {
            tier: 'unplayable', label: 'No matches', tone: 'bad', color: 'var(--tx-bad)',
            advice: 'Every creature has a unique total power + toughness, so Wild Pair can never find anything. It is a blank six-drop in this deck.'
        };
    }
    if (liveRate >= 0.7 && avgCheat >= 5) {
        return {
            tier: 'excellent', label: 'Excellent fit', tone: 'good', color: 'var(--tx-good)',
            advice: 'Most of the creature base is matched, and the bodies it finds are big. Wild Pair pays for itself on the first trigger.'
        };
    }
    if (liveRate >= 0.5 && avgCheat >= 3.5) {
        return {
            tier: 'good', label: 'Good fit', tone: 'good', color: 'var(--tx-good)',
            advice: 'Enough matched totals that most creature casts find something worth having.'
        };
    }
    // Reach alone is not enough. A deck of matched one-drops connects on every
    // cast and cheats a single mana each time, which is not worth {6} — so the
    // fair band needs a real body behind it, either on average or as a payoff
    // big enough to build around on its own.
    if ((liveRate >= 0.3 && avgCheat >= 2.5) || biggestFetch >= WILD_PAIR_COST + 1) {
        return {
            tier: 'fair', label: 'Fair fit', tone: 'warn', color: 'var(--tx-warn)',
            advice: 'It connects often enough to matter, but plenty of creatures still find nothing. Moving more of them onto shared totals is what makes it good.'
        };
    }
    return {
        tier: 'poor', label: 'Poor fit', tone: 'bad', color: 'var(--tx-bad)',
        advice: 'The matches that exist are too small to be worth six mana. Add a big creature that matches a cheap one you already play.'
    };
}

/**
 * The bottom line: how much of the creature base Wild Pair can use, what one
 * trigger is worth, and the best line in the deck — per activation, never a
 * game total, because a six-mana enchantment is rarely out for long.
 *
 * @param {Object} analysis - Result of analyzeDeck
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat', label:string}}
 */
export function summarize(analysis) {
    const fit = fitVerdict(analysis);
    const label = fit.tier === 'unknown' ? 'Bottom line' : `Bottom line · ${fit.label}`;

    if (!analysis?.hasData) {
        return {
            label, tone: 'flat',
            html: 'Import a decklist so every creature’s power and toughness is known — that total is the only thing Wild Pair matches on.'
        };
    }
    if (analysis.liveBuckets === 0) {
        return {
            label, tone: 'bad',
            html: `None of your <strong>${analysis.creatures} creatures</strong> share a total power + toughness, so Wild Pair never finds anything here. One creature that matches a total you already play would change that.`
        };
    }

    const n = analysis.creatures;
    const live = analysis.liveCreatures;
    const dead = analysis.deadCreatures;
    let html = `<strong>${live} of your ${n} creatures</strong> share a total with another, so casting one finds a creature worth <strong>${formatNumber(analysis.avgCheat, 1)} mana</strong> on average.`;

    const top = analysis.bestLines[0];
    if (top && top.leverage > 0) {
        html += ` Best line: cast ${cardRef(top.cast.name)} (${top.cast.cmc}) and put ${cardRef(top.fetched.name)} (${top.fetched.cmc}) onto the battlefield.`;
    }
    if (dead > 0) html += ` The other ${dead} find nothing.`;

    return { label, tone: fit.tone, html };
}
