/**
 * Wild Pair — {4}{G}{G} enchantment. The page: readInputs() (the deck → a
 * plain object), the model, then rendering. The maths — and why it is a
 * group browser rather than a simulation — lives in js/utils/models/wildpair.js.
 */

import { formatNumber } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { libraryOf, withoutRemoved } from '../utils/library.js';
import { pct, plural } from '../utils/text.js';
import {
    WILD_PAIR_COST, analyzeDeck, fitVerdict, groupAt, snapToTotal, summarize
} from '../utils/models/wildpair.js';

// ==================== INPUTS ====================

/**
 * Total the user is inspecting. Null means "follow the deck", which snaps to the
 * deepest group; once the user picks one their choice sticks until a different
 * deck is loaded.
 */
let selectedTotal = null;
let lastDeckKey = '';
let lastTotals = [];
let ptChart = null;

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
export function readInputs() {
    const deck = DeckConfig.getDeckConfig();
    const details = Array.isArray(deck.cardDetails) ? deck.cardDetails : [];
    // Wild Pair searches the library, and commanders are never in it.
    const library = DeckConfig.hasCardList() ? libraryOf(deck) : null;
    return {
        cardDetails: library ? withoutRemoved(details, library) : details,
        deckSize: library ? library.size : DeckConfig.getDeckSize(true)
    };
}

/**
 * Run the analysis and resolve which total is being inspected. Pure reads of
 * the decklist — there is nothing random to simulate, so this is cheap enough
 * to run on every render.
 * @returns {{config:Object, analysis:Object, fit:Object, total:number|null, group:Object|null}}
 */
export function calculate() {
    const config = readInputs();
    const analysis = analyzeDeck(config.cardDetails);

    const key = deckKeyOf(analysis);
    if (key !== lastDeckKey) {
        // A total chosen before the first analysis (a share link) is kept and
        // snapped; any later deck change starts again from the deepest group.
        const keepShared = lastDeckKey === '' && Number.isFinite(selectedTotal);
        lastDeckKey = key;
        if (!keepShared) selectedTotal = analysis.bestBucket?.total ?? analysis.minTotal;
    }

    // Always resolve to a total the deck has, so no view can be empty.
    const total = snapToTotal(analysis, selectedTotal);
    selectedTotal = total;
    lastTotals = analysis.totals;

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

/** "6–8 mana", or "6 mana" when every card in the group costs the same. */
function cheatRangeText(row) {
    if (!row || !row.live) return '—';
    return row.cheatMin === row.cheatMax
        ? `${row.cheatMin} mana`
        : `${row.cheatMin}–${row.cheatMax} mana`;
}

/** Swing as signed text with a class for its colour. */
function swingHTML(swing) {
    return `<span class="wp-up${swing > 0 ? ' is-up' : ''}">${swing > 0 ? '+' : ''}${swing}</span>`;
}

/** The answer: bottom line, four supporting numbers, the fit note. */
function renderAnswer(analysis, fit) {
    const el = document.getElementById('wildpair-answer');
    if (!el) return;
    const line = summarize(analysis);

    if (!analysis.hasData || analysis.liveBuckets === 0) {
        el.innerHTML = renderBottomLine(line) + dataNoteHTML(analysis);
        return;
    }

    const biggest = analysis.liveRows.find(r => r.cheatMax === analysis.biggestFetch)?.dearest;
    el.innerHTML = `
        ${renderBottomLine(line)}
        ${renderHeroStats([
            {
                label: 'Matched creatures',
                value: pct(analysis.liveRate),
                sub: `${analysis.liveCreatures} of ${analysis.creatures} find something`,
                color: analysis.liveRate >= 0.5 ? 'var(--tx-good)' : 'var(--tx-warn)',
                tip: 'Creatures that share their total power + toughness with at least one other creature in the deck. Casting any of them gives Wild Pair something to search for.'
            },
            {
                label: 'Average find',
                value: formatNumber(analysis.avgCheat, 1),
                sub: 'mana value per trigger',
                tip: 'For each creature with a match, the mana value of the best creature it can search up — averaged. One trigger, not a whole game.'
            },
            {
                label: 'Biggest find',
                value: analysis.biggestFetch,
                sub: biggest ? `mana value · ${escapeHtml(biggest.name)}` : 'mana value',
                tip: 'The most expensive creature Wild Pair can put onto the battlefield in this deck. A tutor’s best case is certain, not luck.'
            },
            {
                label: 'Matched totals',
                value: analysis.liveBuckets,
                sub: `of ${plural(analysis.buckets, 'total')} in the deck`,
                tip: 'Distinct power + toughness totals that two or more of your creatures share.'
            }
        ])}
        <p class="wp-fit-note"><strong>${escapeHtml(fit.label)}.</strong> ${escapeHtml(fit.advice)}</p>
        ${dataNoteHTML(analysis)}`;
}

/**
 * Creatures with variable boxes or missing data change the numbers, so they
 * are named rather than silently dropped.
 */
function dataNoteHTML(analysis) {
    const bits = [];
    if (analysis.variable.length > 0) {
        const names = analysis.variable.slice(0, 3).map(c => cardRef(c.name)).join(', ');
        bits.push(`${plural(analysis.variable.length, 'creature')} with a variable power or toughness (${names}${analysis.variable.length > 3 ? ', …' : ''}) ${analysis.variable.length === 1 ? 'has' : 'have'} no fixed total, so Wild Pair can never match ${analysis.variable.length === 1 ? 'it' : 'them'}.`);
    }
    if (analysis.missing > 0) {
        bits.push(`${plural(analysis.missing, 'creature')} ${analysis.missing === 1 ? 'is' : 'are'} missing power and toughness. Re-import the decklist to fill ${analysis.missing === 1 ? 'it' : 'them'} in.`);
    }
    return bits.length ? `<div class="wp-datanote">${bits.map(b => `<p>${b}</p>`).join('')}</div>` : '';
}

/**
 * The full pool at the selected total. Membership is undifferentiated, so the
 * roster is just the cards; the one derived number is the widest swing, named
 * with both of its endpoints, and the bars make the spread legible.
 */
function renderSelectedGroup(analysis, group) {
    const el = document.getElementById('wildpair-group');
    if (!el) return;

    if (!analysis.hasData || !group) {
        el.innerHTML = `
            <div class="tx-h"><span>Search pool</span></div>
            <div class="tx-empty">Import a decklist to group your creatures by total power and toughness.</div>`;
        return;
    }

    // Bars are scaled against the deck's most expensive creature so the spread
    // is comparable when stepping between groups, not just within one.
    const scaleMax = Math.max(1, ...analysis.rows.flatMap(r => r.cards.map(c => c.cmc)));

    const roster = group.cards.map(card => {
        const isLow = group.live && group.swing > 0 && card === group.cheapest;
        const isHigh = group.live && group.swing > 0 && card === group.dearest;
        const cls = isHigh ? ' is-high' : isLow ? ' is-low' : '';
        return `
            <li class="wp-opt${cls}">
                <span class="wp-opt-pt">${escapeHtml(card.power)}/${escapeHtml(card.toughness)}</span>
                <span class="wp-opt-name">${cardRef(card.name)}</span>
                <span class="wp-opt-edge">${isHigh ? 'priciest' : isLow ? 'cheapest' : ''}</span>
                <span class="wp-opt-bar" aria-hidden="true"><span class="wp-opt-bar-fill" style="width:${(card.cmc / scaleMax * 100).toFixed(1)}%"></span></span>
                <span class="wp-opt-mv">${card.cmc}</span>
            </li>`;
    }).join('');

    const lead = group.live
        ? (group.swing > 0
            ? `Cast any one of these and you may search up any other. Widest swing: cast ${cardRef(group.cheapest.name)} for ${group.cheapest.cmc} and put ${cardRef(group.dearest.name)} (${group.dearest.cmc}) onto the battlefield — <strong>${group.swing} mana ahead</strong>.`
            : `Cast any one of these and you may search up any other. They all cost ${group.cheapest.cmc}, so every trigger here is an even trade.`)
        : `Only one creature has this total, so casting it finds nothing. A second creature at ${group.total} total power + toughness would make it live.`;

    el.innerHTML = `
        <div class="tx-h">
            <span>Creatures at total ${group.total}</span>
            <span class="tx-h-r">${plural(group.count, 'creature')}${group.live ? ` · finds ${cheatRangeText(group)}` : ' · no match'}</span>
        </div>
        <div class="wp-sel${group.live ? '' : ' is-empty'}">
            <div class="wp-sel-key" aria-hidden="true">${group.total}</div>
            <p class="wp-sel-lead">${lead}</p>
        </div>
        <ul class="wp-opt-list" aria-label="Creatures at total ${group.total}">
            <li class="wp-opt wp-opt-head" aria-hidden="true">
                <span class="wp-opt-pt">P/T</span>
                <span class="wp-opt-name">Creature</span>
                <span class="wp-opt-edge"></span>
                <span class="wp-opt-bar"></span>
                <span class="wp-opt-mv">MV</span>
            </li>
            ${roster}
        </ul>`;
}

/**
 * Every matched total as its own block, so the deck's groupings read in one
 * pass. Clicking a block (or its total) selects it.
 */
function renderAllGroups(analysis, total) {
    const el = document.getElementById('wildpair-groups');
    if (!el) return;

    if (!analysis.hasData) {
        el.innerHTML = '';
        return;
    }

    const blocks = analysis.liveRows.map(row => {
        const selected = row.total === total;
        const members = row.cards.map(c => `
            <li class="wp-gc-card">
                <span class="wp-gc-pt">${escapeHtml(c.power)}/${escapeHtml(c.toughness)}</span>
                <span class="wp-gc-name">${cardRef(c.name)}</span>
                <span class="wp-gc-mv">${c.cmc}</span>
            </li>`).join('');
        return `
            <div class="wp-gc${selected ? ' is-selected' : ''}" data-total="${row.total}">
                <button type="button" class="wp-gc-head" data-total="${row.total}" aria-pressed="${selected}"
                        aria-label="Total ${row.total}: ${plural(row.count, 'creature')}, finds ${cheatRangeText(row)}">
                    <span class="wp-gc-total">${row.total}</span>
                    <span class="wp-gc-n">${plural(row.count, 'creature')} · ${cheatRangeText(row)}</span>
                    <span class="wp-gc-swing" title="Widest swing: cheapest cast, priciest find">${swingHTML(row.swing)}</span>
                </button>
                <ul class="wp-gc-cards">${members}</ul>
            </div>`;
    }).join('');

    const singles = analysis.deadRows.map(r => `
        <button type="button" class="wp-single${r.total === total ? ' is-selected' : ''}" data-total="${r.total}" aria-pressed="${r.total === total}">
            <span class="wp-single-total">${r.total}</span>
            <span class="wp-single-name" data-card="${escapeHtml(r.cards[0]?.name)}">${escapeHtml(r.cards[0]?.name)}</span>
            <span class="wp-single-pt">${escapeHtml(r.cards[0]?.power)}/${escapeHtml(r.cards[0]?.toughness)}</span>
        </button>`).join('');

    el.innerHTML = `
        ${analysis.liveRows.length ? `
            <div class="tx-h">
                <span>Creatures that can find each other</span>
                <span class="tx-h-r">${plural(analysis.liveBuckets, 'matched total')} · +N is the widest mana swing</span>
            </div>
            <div class="wp-gc-grid">${blocks}</div>` : `
            <div class="tx-h"><span>Creatures that can find each other</span><span class="tx-h-r">none</span></div>
            <div class="tx-empty">No two creatures share a total power + toughness.</div>`}
        ${singles ? `
            <div class="tx-h wp-single-head">
                <span>Nothing to find</span>
                <span class="tx-h-r">${plural(analysis.deadRows.length, 'creature')} alone at ${analysis.deadRows.length === 1 ? 'its' : 'their'} total</span>
            </div>
            <div class="wp-single-list">${singles}</div>` : ''}`;
}

/**
 * The best line at each matched total — the mana story, once the groupings
 * themselves are understood. Directions, not roles: either creature can be the
 * one you cast; this names the one worth casting.
 */
function renderBestLines(analysis) {
    const el = document.getElementById('wildpair-pairings');
    if (!el) return;

    if (analysis.bestLines.length === 0) {
        el.innerHTML = '<div class="tx-empty">No two creatures share a total, so there is no line to take.</div>';
        return;
    }

    const rows = analysis.bestLines.map(p => `
        <tr data-total="${p.total}">
            <td>${p.total}</td>
            <td class="ta-l">${cardRef(p.cast.name)} <span class="wp-dim">${escapeHtml(p.cast.power)}/${escapeHtml(p.cast.toughness)} · ${p.cast.cmc}</span></td>
            <td class="ta-l">${cardRef(p.fetched.name)} <span class="wp-dim">${escapeHtml(p.fetched.power)}/${escapeHtml(p.fetched.toughness)} · ${p.fetched.cmc}</span></td>
            <td>${swingHTML(p.leverage)}</td>
        </tr>`).join('');

    el.innerHTML = `
        <table class="tx-sweep-table">
            <thead><tr><th>Total</th><th class="ta-l">Cast from hand</th><th class="ta-l">Put onto the battlefield</th><th>Mana ahead</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function updateSweep(analysis, total) {
    renderSweepTable('wildpair-sweepTable', {
        columns: [
            { label: 'Total', align: 'left', render: r => `<strong>${r.total}</strong>` },
            { label: 'Creatures', render: r => r.count },
            { label: 'Match', render: r => (r.live ? '<span class="wp-yes">yes</span>' : '<span class="wp-no">no</span>') },
            { label: 'Finds', render: r => (r.live ? cheatRangeText(r) : '<span class="wp-dim">—</span>') },
            { label: 'Average', render: r => (r.live ? formatNumber(r.cheatAvg, 1) : '<span class="wp-dim">—</span>') },
            { label: 'Widest swing', render: r => (r.live && r.swing > 0 ? swingHTML(r.swing) : '<span class="wp-dim">—</span>') },
            {
                label: 'Bodies',
                align: 'left',
                render: r => `<span class="wp-dim">${r.cards.slice(0, 6).map(c => `${escapeHtml(c.power)}/${escapeHtml(c.toughness)}`).join(' ')}${r.cards.length > 6 ? ' …' : ''}</span>`
            }
        ],
        rows: analysis.rows,
        current: total,
        recommended: analysis.bestBucket?.total ?? null,
        emptyText: 'Import a decklist with creatures to list every total.'
    });
}

/**
 * Creature count at every total, with the selected total ringed in the accent.
 * Green versus red carries matched versus alone, so the selection cannot be
 * colour — it is an outline instead.
 */
function updatePTChart(analysis, total) {
    const canvas = document.getElementById('wildpair-pt-chart');
    if (!canvas || analysis.rows.length === 0) return;
    // Lives inside a collapsed section; a hidden canvas has no size to draw at.
    const section = canvas.closest?.('details');
    if (section && !section.open) return;

    const rows = analysis.rows;
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
                { label: 'Share a total', data: matched, backgroundColor: TX.green, borderColor: borderColors, borderWidth: borderWidths, stack: 'pt' },
                { label: 'Alone at their total', data: alone, backgroundColor: TX.red, borderColor: borderColors, borderWidth: borderWidths, stack: 'pt' }
            ]
        },
        options: {
            onClick: (_evt, elements) => {
                const idx = elements?.[0]?.index;
                if (Number.isInteger(idx) && byTotal.has(min + idx)) setSelectedTotal(min + idx);
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: TX.mid, font: { size: 11 }, boxWidth: 10, boxHeight: 8 }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    title: { display: true, text: 'Total power + toughness', color: TX.dim, font: { size: 11 } },
                    grid: { display: false },
                    ticks: { color: TX.dim }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Creatures', color: TX.dim, font: { size: 11 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, precision: 0 }
                }
            }
        }
    });
}

/**
 * Keep the selector in step with the deck. The slider runs over the INDEX of
 * the deck's totals, so every stop lands on a total the deck actually has.
 */
function syncSlider(analysis, group, total) {
    const slider = document.getElementById('wildpair-totalSlider');
    const totals = analysis.totals;

    if (slider) {
        slider.min = '0';
        slider.max = String(Math.max(0, totals.length - 1));
        slider.disabled = totals.length === 0;
        const idx = totals.indexOf(total);
        slider.value = String(idx >= 0 ? idx : 0);
        slider.setAttribute('aria-valuetext', Number.isFinite(total) ? `total ${total}` : 'no deck');
    }

    const setHTML = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    setHTML('wildpair-total-display', Number.isFinite(total) ? String(total) : '—');
    setHTML('wildpair-total-scale', totals.length
        ? `<span>${totals[0]}</span><span>${totals[totals.length - 1]}</span>`
        : '<span>—</span><span>—</span>');
    setHTML('wildpair-total-stops', totals.length
        ? `${plural(totals.length, 'total')} in this deck — the slider only stops on these.`
        : 'No creatures to step through yet.');
    setHTML('wildpair-total-summary', !analysis.hasData
        ? 'Import a decklist to browse your totals.'
        : group
            ? (group.live
                ? `${plural(group.count, 'creature')} — each finds ${cheatRangeText(group)}`
                : 'Alone at this total — finds nothing')
            : '—');
}

/** Show or hide the evidence panels; without a deck only the answer remains. */
function showPanels(ids, visible) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    }
}

export function updateUI() {
    const { analysis, fit, total, group } = calculate();
    showPanels(['wildpair-group', 'wildpair-groups', 'wildpair-more'], analysis.hasData);

    syncSlider(analysis, group, total);
    renderAnswer(analysis, fit);
    renderSelectedGroup(analysis, group);
    renderAllGroups(analysis, total);
    renderBestLines(analysis);
    updateSweep(analysis, total);
    updatePTChart(analysis, total);
}

// ==================== SHARE LINKS ====================

/**
 * The legacy `wpTotal` param carries the slider's INDEX, which only means
 * something against the same deck. `wpPT` carries the total itself, so a link
 * opened against a different deck snaps to the nearest total that deck has.
 */
export function getShareParams() {
    return Number.isFinite(selectedTotal) ? { wpPT: selectedTotal } : {};
}

export function applyShareParams(params) {
    const raw = parseInt(params?.get?.('wpPT'), 10);
    if (Number.isFinite(raw) && raw >= -10 && raw <= 60) setSelectedTotal(raw);
}

// ==================== INIT ====================

export function init() {
    registerCalculator({ name: 'wildpair', calculate, updateUI, inputs: [] });

    // Bound directly rather than through registerCalculator's slider pairing:
    // the slider's positions are indices into the deck's own totals, so its
    // value has to be translated before it means anything.
    const slider = document.getElementById('wildpair-totalSlider');
    slider?.addEventListener('input', (e) => {
        const total = lastTotals[parseInt(e.target.value, 10)];
        if (Number.isFinite(total)) setSelectedTotal(total);
    });

    // One delegated listener for every group block, singleton and table row.
    const tab = document.getElementById('wildpair-tab');
    tab?.addEventListener('click', (e) => {
        const target = e.target.closest?.('[data-total]');
        if (target && tab.contains(target)) setSelectedTotal(parseInt(target.dataset.total, 10));
    });

    // The chart sits in a collapsed section; draw it when it is opened.
    document.getElementById('wildpair-more-chart')?.addEventListener('toggle', (e) => {
        if (e.target.open) updateUI();
    });
}

