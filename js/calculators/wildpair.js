/**
 * Wild Pair Calculator
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
 */

import { formatNumber, formatPercentage } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import {
    renderHeroStats, renderRecommendation, renderSweepTable
} from '../utils/components.js';

/** Wild Pair's own mana cost — the bar a single activation is measured against. */
export const WILD_PAIR_COST = 6;

let ptChart = null;

/**
 * Total the user is inspecting. Null means "follow the deck", which snaps to the
 * deepest group; once the user picks one their choice sticks until a different
 * deck is loaded.
 */
let selectedTotal = null;
let lastDeckKey = '';

// ==================== PURE MATH ====================

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
            tier: 'unknown', label: 'NO DATA', color: 'var(--tx-dim)',
            advice: 'Import a decklist so power and toughness are known for every creature.'
        };
    }
    if (liveBuckets === 0) {
        return {
            tier: 'unplayable', label: 'NO MATCHES', color: 'var(--tx-bad)',
            advice: 'Every creature has a unique total power + toughness, so Wild Pair can never find anything. It is a blank six-drop in this deck.'
        };
    }
    if (liveRate >= 0.7 && avgCheat >= 5) {
        return {
            tier: 'excellent', label: 'EXCELLENT FIT', color: 'var(--tx-good)',
            advice: 'Most of the creature base is matched, and the bodies it finds are big. Wild Pair pays for itself on the first trigger.'
        };
    }
    if (liveRate >= 0.5 && avgCheat >= 3.5) {
        return {
            tier: 'good', label: 'GOOD FIT', color: 'var(--tx-good)',
            advice: 'Enough matched totals that most creature casts find something worth having.'
        };
    }
    // Reach alone is not enough. A deck of matched one-drops connects on every
    // cast and cheats a single mana each time, which is not worth {6} — so the
    // fair band needs a real body behind it, either on average or as a payoff
    // big enough to build around on its own.
    if ((liveRate >= 0.3 && avgCheat >= 2.5) || biggestFetch >= WILD_PAIR_COST + 1) {
        return {
            tier: 'fair', label: 'FAIR FIT', color: 'var(--tx-accent)',
            advice: 'It connects often enough to matter, but plenty of creatures still find nothing worth the six mana. Move more of them onto shared totals.'
        };
    }
    return {
        tier: 'poor', label: 'POOR FIT', color: 'var(--tx-bad)',
        advice: 'The matches that exist are too small to be worth six mana. Add a big creature that matches a cheap one you already play.'
    };
}

// ==================== CONFIG ====================

/**
 * A signature of the deck's creature base, used to decide when the selection
 * should re-snap to the new deck's deepest group rather than keep a choice that
 * referred to a deck the user is no longer looking at.
 *
 * @param {Object} analysis
 * @returns {string}
 */
function deckKeyOf(analysis) {
    return analysis.rows.map(r => `${r.total}:${r.count}`).join('|');
}

/**
 * Read the shared deck state.
 * @returns {Object}
 */
export function getConfig() {
    const deck = DeckConfig.getDeckConfig();
    return {
        cardDetails: Array.isArray(deck.cardDetails) ? deck.cardDetails : [],
        deckSize: DeckConfig.getDeckSize(true)
    };
}

/**
 * Run the analysis and resolve which total is being inspected.
 * @returns {{config:Object, analysis:Object, fit:Object, total:number|null, group:Object|null}}
 */
export function calculate() {
    const config = getConfig();
    const analysis = analyzeDeck(config.cardDetails);

    const key = deckKeyOf(analysis);
    if (key !== lastDeckKey) {
        lastDeckKey = key;
        selectedTotal = analysis.bestBucket?.total ?? analysis.minTotal;
    }

    // Always resolve to a total the deck has, so no view can be empty.
    const total = snapToTotal(analysis, selectedTotal);
    selectedTotal = total;

    return { config, analysis, fit: fitVerdict(analysis), total, group: groupAt(analysis, total) };
}

/**
 * Set the inspected total, snapping to the nearest one the deck contains.
 * @param {number} total
 */
export function setSelectedTotal(total) {
    if (!Number.isFinite(total)) return;
    selectedTotal = Math.round(total);
    updateUI();
}

// ==================== UI ====================

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** "6–8 mana", or "6 mana" when every card in the group costs the same. */
function cheatRangeText(row) {
    if (!row || !row.live) return '—';
    return row.cheatMin === row.cheatMax
        ? `${row.cheatMin} mana`
        : `${row.cheatMin}–${row.cheatMax} mana`;
}

/**
 * The primary panel: the full pool at the selected total.
 *
 * Membership is undifferentiated, so the roster is just the cards — printed
 * stats, nothing invented. The single derived number worth stating is the
 * widest mana swing the pool allows, named with both of its endpoints, and the
 * bar on each row makes the pool's spread legible without a column of repeated
 * card names.
 */
function renderSelectedGroup(analysis, total, group) {
    const el = document.getElementById('wildpair-group');
    if (!el) return;

    if (!analysis.hasData || !group) {
        el.innerHTML = `
            <div class="tx-h"><span>Search pool</span><span class="tx-h-r">no deck</span></div>
            <div class="tx-empty">Import a decklist to group your creatures by total power and toughness.</div>`;
        return;
    }

    // Bars are scaled against the deck's most expensive creature so the spread
    // is comparable when stepping between groups, not just within one.
    const scaleMax = Math.max(1, ...analysis.rows.flatMap(r => r.cards.map(c => c.cmc)));

    const poolRows = group.cards.map(card => {
        const isLow = group.live && card === group.cheapest;
        const isHigh = group.live && card === group.dearest;
        const cls = isHigh ? ' is-high' : isLow ? ' is-low' : '';
        const edge = isHigh ? 'DEAREST' : isLow ? 'CHEAPEST' : '';
        return `
            <div class="wp-opt${cls}">
                <span class="wp-opt-pt">${esc(card.power)}/${esc(card.toughness)}</span>
                <span class="wp-opt-name">${esc(card.name)}</span>
                <span class="wp-opt-edge">${edge}</span>
                <span class="wp-opt-bar"><span class="wp-opt-bar-fill" style="width:${(card.cmc / scaleMax * 100).toFixed(1)}%;"></span></span>
                <span class="wp-opt-mv">${card.cmc}</span>
            </div>`;
    }).join('');

    const swingHTML = group.live ? `
        <div class="wp-swing">
            <span class="wp-swing-label">Biggest swing</span>
            <span class="wp-swing-value" style="color:${group.swing > 0 ? 'var(--tx-good)' : 'var(--tx-dim)'};">${group.swing > 0 ? '+' : ''}${group.swing}</span>
            <span class="wp-swing-line">
                cast <strong>${esc(group.cheapest.name)}</strong> (${group.cheapest.cmc})
                → search up <strong>${esc(group.dearest.name)}</strong> (${group.dearest.cmc})
            </span>
        </div>` : '';

    el.innerHTML = `
        <div class="tx-h">
            <span>Search pool at total ${group.total}</span>
            <span class="tx-h-r">${group.count} creature${group.count === 1 ? '' : 's'}${group.live ? ` · ${cheatRangeText(group)} · avg ${formatNumber(group.cheatAvg, 1)}` : ' · no match'}</span>
        </div>
        <div class="wp-group-detail${group.live ? '' : ' is-empty'}">
            <div class="wp-detail-key">${group.total}</div>
            <div class="wp-detail-body">
                <div class="wp-detail-headline">${group.live
                    ? 'Cast any one of these and you may search up any other.'
                    : 'Only one creature has this total, so a cast here finds nothing.'}</div>
                ${group.live
                    ? swingHTML
                    : `<div class="wp-detail-sub">Add a second creature at ${group.total} total power + toughness to make it live.</div>`}
            </div>
        </div>
        <div class="wp-opt-list">
            <div class="wp-opt wp-opt-head">
                <span class="wp-opt-pt">P/T</span>
                <span class="wp-opt-name">CREATURE</span>
                <span class="wp-opt-edge"></span>
                <span class="wp-opt-bar"></span>
                <span class="wp-opt-mv">MV</span>
            </div>
            ${poolRows}
        </div>`;
}

/**
 * The at-a-glance view: every matched total as its own block, so the deck's
 * groupings can be read in one pass. Clicking a block selects it.
 */
function renderAllGroups(analysis, total) {
    const el = document.getElementById('wildpair-groups');
    if (!el) return;

    if (!analysis.hasData) {
        el.innerHTML = '';
        return;
    }

    if (analysis.liveRows.length === 0) {
        el.innerHTML = `
            <div class="tx-h"><span>Matched totals</span><span class="tx-h-r">none</span></div>
            <div class="tx-empty">No two creatures share a total power + toughness, so Wild Pair never finds anything.</div>
            ${renderSingletons(analysis)}`;
        bindTotalButtons(el);
        return;
    }

    const cards = analysis.liveRows.map(row => {
        const members = row.cards.map(c => `
            <li class="wp-gc-card">
                <span class="wp-gc-pt">${esc(c.power)}/${esc(c.toughness)}</span>
                <span class="wp-gc-name">${esc(c.name)}</span>
                <span class="wp-gc-mv">${c.cmc}</span>
            </li>`).join('');

        return `
            <button type="button" class="wp-gc${row.total === total ? ' is-selected' : ''}" data-total="${row.total}"
                    aria-pressed="${row.total === total ? 'true' : 'false'}"
                    aria-label="Total ${row.total}, ${row.count} creatures, swing plus ${row.swing}">
                <span class="wp-gc-head">
                    <span class="wp-gc-total">${row.total}</span>
                    <span class="wp-gc-n">${row.count} creatures</span>
                    <span class="wp-gc-swing" style="color:${row.swing > 0 ? 'var(--tx-good)' : 'var(--tx-dim)'};">${row.swing > 0 ? '+' : ''}${row.swing}</span>
                </span>
                <span class="wp-gc-range">${cheatRangeText(row)}</span>
                <ul class="wp-gc-cards">${members}</ul>
            </button>`;
    }).join('');

    el.innerHTML = `
        <div class="tx-h">
            <span>Totals that can find each other</span>
            <span class="tx-h-r">${analysis.liveBuckets} matched total${analysis.liveBuckets === 1 ? '' : 's'} · Δ is the widest swing · click to inspect</span>
        </div>
        <div class="wp-gc-grid">${cards}</div>
        ${renderSingletons(analysis)}`;

    bindTotalButtons(el);
}

/**
 * The creatures that share a total with nothing. Compact, because the point is
 * only that they exist and how many there are.
 */
function renderSingletons(analysis) {
    const singles = analysis.deadRows;
    if (singles.length === 0) return '';

    const chips = singles.map(r => `
        <button type="button" class="wp-single" data-total="${r.total}" title="Total ${r.total} — nothing shares it">
            <span class="wp-single-total">${r.total}</span>
            <span class="wp-single-name">${esc(r.cards[0]?.name)}</span>
            <span class="wp-single-pt">${esc(r.cards[0]?.power)}/${esc(r.cards[0]?.toughness)}</span>
        </button>`).join('');

    return `
        <div class="tx-h wp-single-head">
            <span>No match in the deck</span>
            <span class="tx-h-r">${singles.length} creature${singles.length === 1 ? '' : 's'} alone at their total</span>
        </div>
        <div class="wp-single-list">${chips}</div>`;
}

/**
 * Wire every element carrying a data-total to select that total — the group
 * cards and the singleton chips both look clickable, so both must behave like it.
 * @param {HTMLElement} root
 */
function bindTotalButtons(root) {
    root.querySelectorAll('[data-total]').forEach(btn => {
        btn.addEventListener('click', () => setSelectedTotal(parseInt(btn.dataset.total, 10)));
    });
}

/**
 * Creature count at every total, with the selected total ringed in the accent.
 * Green versus red carries matched versus alone, so the selection cannot be
 * colour — it is an outline instead.
 */
function updatePTChart(analysis, total) {
    if (!document.getElementById('wildpair-pt-chart')) return;
    const rows = analysis.rows;
    if (rows.length === 0) return;

    const min = rows[0].total;
    const max = rows[rows.length - 1].total;
    const byTotal = new Map(rows.map(r => [r.total, r]));

    const labels = [];
    const matched = [];
    const alone = [];
    const borderColors = [];
    const borderWidths = [];
    for (let t = min; t <= max; t++) {
        const r = byTotal.get(t);
        labels.push(String(t));
        matched.push(r && r.live ? r.count : 0);
        alone.push(r && !r.live ? r.count : 0);
        borderColors.push(t === total ? TX.amber : 'transparent');
        borderWidths.push(t === total ? 2 : 0);
    }

    ptChart = createOrUpdateChart(ptChart, 'wildpair-pt-chart', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Matched creatures',
                    data: matched,
                    backgroundColor: TX.green,
                    borderColor: borderColors,
                    borderWidth: borderWidths,
                    stack: 'pt'
                },
                {
                    label: 'Alone at their total',
                    data: alone,
                    backgroundColor: TX.red,
                    borderColor: borderColors,
                    borderWidth: borderWidths,
                    stack: 'pt'
                }
            ]
        },
        options: {
            onClick: (_evt, elements) => {
                const idx = elements?.[0]?.index;
                if (Number.isInteger(idx)) setSelectedTotal(min + idx);
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: TX.mid, font: { size: 10 }, boxWidth: 10, boxHeight: 8 }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    title: { display: true, text: 'Total power + toughness', color: TX.dim, font: { size: 9 } },
                    grid: { display: false },
                    ticks: { color: TX.dim, font: { size: 9 } }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Creatures', color: TX.dim, font: { size: 9 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, font: { size: 9 }, precision: 0 }
                }
            }
        }
    });
}

function updateSweep(analysis, total) {
    renderSweepTable('wildpair-sweepTable', {
        columns: [
            { label: 'P+T', align: 'left', render: r => `<strong style="color:var(--tx-bright);">${r.total}</strong>` },
            { label: 'CREATURES', render: r => r.count },
            {
                label: 'MATCHED',
                render: r => r.live
                    ? '<span style="color:var(--tx-good);">yes</span>'
                    : '<span style="color:var(--tx-bad);">no</span>'
            },
            {
                label: 'CHEAT RANGE',
                render: r => r.live
                    ? `<span style="color:var(--tx-text);">${cheatRangeText(r)}</span>`
                    : '<span style="color:var(--tx-dim);">—</span>'
            },
            {
                label: 'AVG',
                render: r => r.live ? formatNumber(r.cheatAvg, 1) : '<span style="color:var(--tx-dim);">—</span>'
            },
            {
                label: 'BEST SWING',
                render: r => r.bestLine && r.bestLine.leverage > 0
                    ? `<span style="color:var(--tx-good);">+${r.bestLine.leverage}</span>`
                    : '<span style="color:var(--tx-dim);">—</span>'
            },
            {
                label: 'BODIES',
                align: 'left',
                render: r => `<span class="wp-mini">${r.cards.map(c => `${c.power}/${c.toughness}`).slice(0, 6).join(' ')}${r.cards.length > 6 ? ' …' : ''}</span>`
            }
        ],
        rows: analysis.rows,
        current: total,
        recommended: analysis.bestBucket?.total ?? null,
        emptyText: 'Import a decklist with creatures to build the total ladder.'
    });
}

/**
 * The best line available at each matched total. Secondary to the groups: this
 * is the mana story, once the groupings themselves are understood.
 *
 * Note these are directions, not roles. Creatures sharing a total are
 * interchangeable — either one can be the card you cast — so this simply picks
 * the direction worth taking: spend the cheapest, search up the dearest.
 */
function renderBestLines(analysis) {
    const el = document.getElementById('wildpair-pairings');
    if (!el) return;

    if (analysis.bestLines.length === 0) {
        el.innerHTML = `
            <div class="tx-h"><span>Best lines</span><span class="tx-h-r">none</span></div>
            <div class="tx-empty">No two creatures in this deck share a total power + toughness, so Wild Pair has nothing to find.</div>`;
        return;
    }

    const rowsHTML = analysis.bestLines.map(p => `
        <div class="wp-pair" data-total="${p.total}">
            <span class="wp-pair-total" title="Total power + toughness">${p.total}</span>
            <span class="wp-pair-cast">
                <span class="wp-pair-name">${esc(p.cast.name)}</span>
                <span class="wp-pair-meta">${esc(p.cast.power)}/${esc(p.cast.toughness)} · MV ${p.cast.cmc}</span>
            </span>
            <span class="wp-pair-arrow">→</span>
            <span class="wp-pair-fetch">
                <span class="wp-pair-name">${esc(p.fetched.name)}</span>
                <span class="wp-pair-meta">${esc(p.fetched.power)}/${esc(p.fetched.toughness)} · MV ${p.fetched.cmc}</span>
            </span>
            <span class="wp-pair-gain" style="color:${p.leverage > 0 ? 'var(--tx-good)' : 'var(--tx-dim)'};">
                ${p.leverage > 0 ? '+' : ''}${p.leverage}
            </span>
        </div>`).join('');

    el.innerHTML = `
        <div class="tx-h">
            <span>Best lines</span>
            <span class="tx-h-r">the direction worth taking at each total</span>
        </div>
        <div class="wp-pair-list">
            <div class="wp-pair wp-pair-head">
                <span class="wp-pair-total">P+T</span>
                <span class="wp-pair-cast">CAST FROM HAND</span>
                <span class="wp-pair-arrow"></span>
                <span class="wp-pair-fetch">PUT ONTO BATTLEFIELD</span>
                <span class="wp-pair-gain">Δ MANA</span>
            </div>
            ${rowsHTML}
        </div>`;

    bindTotalButtons(el);
}

/**
 * Keep the selector in step with the deck.
 *
 * The slider runs over the INDEX of the deck's totals rather than the totals
 * themselves, so every stop lands on a total the deck actually has — dragging
 * never passes through empty positions.
 */
function syncSlider(analysis, total) {
    const slider = document.getElementById('wildpair-totalSlider');
    const number = document.getElementById('wildpair-totalValue');
    const totals = analysis.totals;

    if (slider) {
        const last = Math.max(0, totals.length - 1);
        slider.min = '0';
        slider.max = String(last);
        slider.disabled = totals.length === 0;
        const idx = totals.indexOf(total);
        slider.value = String(idx >= 0 ? idx : 0);
        slider.setAttribute('aria-valuetext', Number.isFinite(total) ? `${total} total power and toughness` : 'no deck');
    }
    if (number && Number.isFinite(total)) number.value = String(total);

    // End labels only. A caption in the middle of this row sits directly under
    // the slider thumb, which covers it at most positions — the count goes on
    // its own line below instead.
    const scale = document.getElementById('wildpair-total-scale');
    if (scale) {
        scale.innerHTML = totals.length
            ? `<span>${totals[0]}</span><span>${totals[totals.length - 1]}</span>`
            : '<span>—</span><span>—</span>';
    }

    const stops = document.getElementById('wildpair-total-stops');
    if (stops) {
        stops.textContent = totals.length
            ? `${totals.length} total${totals.length === 1 ? '' : 's'} in this deck`
            : 'no creatures to step through';
    }
}

export function updateUI() {
    const { analysis, fit, total, group } = calculate();

    syncSlider(analysis, total);

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('wildpair-total-display', Number.isFinite(total) ? total : '—');
    setText('wildpair-live-display', `${analysis.liveCreatures} / ${analysis.creatures}`);
    setText('wildpair-matched-display', analysis.liveBuckets);

    const summaryEl = document.getElementById('wildpair-total-summary');
    if (summaryEl) {
        summaryEl.innerHTML = !analysis.hasData
            ? 'Import a decklist to browse your totals.'
            : group
                ? `${group.count} creature${group.count === 1 ? '' : 's'} here${group.live ? ` — cheats ${cheatRangeText(group)}` : ' — nothing shares this total'}`
                : '—';
    }

    // Primary: the groupings.
    renderSelectedGroup(analysis, total, group);
    renderAllGroups(analysis, total);
    updatePTChart(analysis, total);

    // Secondary: the mana story.
    const heroEl = document.getElementById('wildpair-hero');
    if (heroEl) {
        heroEl.innerHTML = renderHeroStats([
            {
                label: 'LIVE CASTS',
                value: formatPercentage(analysis.liveRate, 0),
                sub: `${analysis.liveCreatures} of ${analysis.creatures} creatures find something`,
                size: 'big',
                color: analysis.liveRate >= 0.5 ? 'var(--tx-good)' : 'var(--tx-bad)'
            },
            {
                label: 'AVG BODY FOUND',
                value: formatNumber(analysis.avgCheat, 1),
                sub: 'mana value put onto the battlefield',
                color: analysis.avgCheat >= 4 ? 'var(--tx-good)' : 'var(--tx-mid)'
            },
            {
                label: 'BIGGEST FIND',
                value: analysis.biggestFetch,
                sub: 'mana value, best case',
                color: 'var(--tx-mid)'
            },
            {
                label: 'MATCHED TOTALS',
                value: analysis.liveBuckets,
                sub: `of ${analysis.buckets} totals in the deck`,
                color: 'var(--tx-mid)'
            },
            {
                label: 'NO MATCH',
                value: analysis.deadCreatures,
                sub: 'creatures nothing can find',
                color: analysis.deadCreatures > analysis.liveCreatures ? 'var(--tx-bad)' : 'var(--tx-mid)'
            }
        ]);
    }

    const fitEl = document.getElementById('wildpair-fit');
    if (fitEl) {
        fitEl.innerHTML = `
            <div class="wp-fit">
                <div class="wp-fit-badge" style="color:${fit.color}; border-color:${fit.color};">${fit.label}</div>
                <div class="wp-fit-body">
                    <div class="wp-fit-advice">${fit.advice}</div>
                    <div class="wp-fit-detail">${analysis.liveBuckets > 0
                        ? `${formatPercentage(analysis.liveRate, 0)} of your creatures share a total with something else. When one of those is cast, Wild Pair puts an average of <strong>${formatNumber(analysis.avgCheat, 1)} mana</strong> onto the battlefield — up to ${analysis.biggestFetch} at best.`
                        : 'There is no matched total in this list.'}</div>
                    <div class="wp-fit-caveat">These are per-activation numbers, not a game total. Wild Pair costs {${WILD_PAIR_COST}} and is not on the battlefield for most of a game, so what matters is the value of a single trigger, not how many you can chain.</div>
                </div>
            </div>`;
    }

    const recEl = document.getElementById('wildpair-recommendation');
    if (recEl) {
        let text;
        if (!analysis.hasData) {
            text = 'Import a decklist to group your creatures by total power and toughness. Manual type counts are not enough — Wild Pair needs each creature\'s printed power and toughness.';
        } else if (analysis.liveBuckets === 0) {
            text = `All ${analysis.creatures} creatures have a unique total power + toughness, spread over ${analysis.buckets} different totals. Wild Pair finds nothing. Adding a single creature that matches an existing total turns a dead six-drop into a free body.`;
        } else {
            const best = analysis.bestBucket;
            const topLine = analysis.bestLines[0];
            text = `Your deepest total is <strong>${best.total}</strong> with ${best.count} creatures, cheating ${cheatRangeText(best)} an activation. The best swing in the deck is casting <strong>${esc(topLine.cast.name)}</strong> for ${topLine.cast.cmc} to put <strong>${esc(topLine.fetched.name)}</strong> (MV ${topLine.fetched.cmc}) onto the battlefield — ${topLine.leverage > 0 ? `${topLine.leverage} mana ahead` : 'an even trade'}. ${analysis.deadCreatures} creature${analysis.deadCreatures === 1 ? '' : 's'} nothing can find.`;
        }
        recEl.innerHTML = renderRecommendation(text);
    }

    // Data-quality note: */* creatures and missing toughness change the numbers
    // above, so they are named rather than silently dropped.
    const noteEl = document.getElementById('wildpair-datanote');
    if (noteEl) {
        const bits = [];
        if (analysis.variable.length > 0) {
            bits.push(`${analysis.variable.length} creature${analysis.variable.length === 1 ? ' has' : 's have'} a variable power or toughness (${analysis.variable.slice(0, 3).map(c => esc(c.name)).join(', ')}${analysis.variable.length > 3 ? ', …' : ''}) — no fixed total, so they are excluded.`);
        }
        if (analysis.missing > 0) {
            bits.push(`${analysis.missing} creature${analysis.missing === 1 ? ' is' : 's are'} missing power/toughness data. Re-import the decklist to fill it in.`);
        }
        noteEl.innerHTML = bits.length
            ? `<div class="wp-note">${bits.map(b => `<div>⚠ ${b}</div>`).join('')}</div>`
            : '';
    }

    renderBestLines(analysis);
    updateSweep(analysis, total);
}

export function init() {
    registerCalculator({ name: 'wildpair', calculate, updateUI, inputs: [] });

    // Bound directly rather than through registerCalculator's slider pairing:
    // the slider's positions are indices into the deck's own totals, so its
    // value has to be translated before it means anything.
    const slider = document.getElementById('wildpair-totalSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            const { analysis } = calculate();
            const idx = parseInt(e.target.value, 10);
            const total = analysis.totals[idx];
            if (Number.isFinite(total)) setSelectedTotal(total);
        });
    }

}
