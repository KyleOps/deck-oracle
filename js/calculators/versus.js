/**
 * Head to Head — payoff engine comparison
 *
 * Every other page asks "how good is this card in my deck". This one asks the
 * question that actually decides a slot: *given these two cards, which one does
 * more for this deck, and when?*
 *
 * The comparison is per creature cast, because that is the event both engines
 * key off and it is the unit a player thinks in — "I'm casting this thing, what
 * do I get?" Averaged across the creature base it gives the general answer;
 * plotted against the cast creature's mana value it gives the answer *at each
 * point in the game*, which is usually where the two diverge.
 *
 * The two engines are deliberately different shapes, and the comparison is built
 * so that difference survives:
 *
 *   WILD PAIR is a TUTOR. It triggers on every creature cast from hand, and you
 *   choose from the whole library — so its value is certain, capped at one body,
 *   and known before you cast. Its weakness is coverage: a creature whose total
 *   power + toughness nothing shares gets nothing at all.
 *
 *   MONSTROUS VORTEX is a DISCOVER. It only triggers on power-5+ creatures, and
 *   takes what the top of the library gives it — so its value is random, but
 *   because discover *casts* what it finds, a discovered power-5+ creature
 *   triggers it again. That chain is the long tail, and no average will show it.
 *
 * So no single number summarises the pair: each side reports how often it fires,
 * what it gives when it does, and (for the random one) its spread, and the
 * bottom line says all three.
 *
 * Note the two do not feed each other: Wild Pair puts its creature onto the
 * battlefield without casting it, so it never triggers Vortex, and a creature
 * cast off discover is cast from exile rather than from hand, so it never
 * triggers Wild Pair.
 */

import { formatNumber } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderSweepTable } from '../utils/components.js';
import { renderDistributionChart } from '../utils/sampleSimulator.js';
import { foldTail, mergeDists } from '../utils/discover.js';
import { quantile as percentileFromDist } from '../utils/stats.js';
import { libraryOf } from '../utils/library.js';
import { pct } from '../utils/text.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { ENGINES, buildContext, compareEngines, curveSplit, summarize, verdict } from '../utils/models/versus.js';

let curveChart = null;

// ==================== INPUTS ====================

/** The two engines and the star-power setting, plus the deck and library they apply to. */
export function readInputs() {
    const a = document.getElementById('versus-engine-a')?.value || 'wildpair';
    const b = document.getElementById('versus-engine-b')?.value || 'vortex';
    const star = document.getElementById('versus-star-power')?.checked || false;
    const deck = DeckConfig.getDeckConfig();
    return {
        a, b: b === a ? (a === 'wildpair' ? 'vortex' : 'wildpair') : b, treatStarAs5Plus: star,
        deck, library: libraryOf(deck)
    };
}

/** Last comparison, keyed on the deck objects and settings that produced it. */
let cache = { key: null, deck: null, cards: null, result: null };

/**
 * Compare the two engines — once per deck and settings. Revisiting the page,
 * or any re-render that changes nothing, reuses the last result instead of
 * re-sampling every big creature.
 */
export function calculate() {
    const { deck, library, ...config } = readInputs();
    const key = `${config.a}|${config.b}|${config.treatStarAs5Plus}`;

    if (cache.result && cache.key === key && cache.deck === deck.cardDetails && cache.cards === library) {
        return cache.result;
    }
    const ctx = buildContext(deck, library, config.treatStarAs5Plus);
    const cmp = ctx ? compareEngines(ctx, config.a, config.b) : null;
    const result = { config, ctx, cmp, verdict: verdict(cmp) };
    cache = { key, deck: deck.cardDetails, cards: library, result };
    return result;
}

// ==================== UI ====================

const seriesVar = (engine) => `var(--series-${engine.series ?? 1})`;
const seriesHex = (engine) => TX.series[(engine.series ?? 1) - 1] ?? TX.blue;

/** Bottom line plus the two-sided scoreboard. */
function renderAnswer(cmp, v) {
    const el = document.getElementById('versus-scoreboard');
    if (!el) return;
    const line = summarize(cmp);
    if (!cmp) { el.innerHTML = renderBottomLine(line); return; }

    const { a, b } = cmp.summary;
    const n = cmp.creatures;
    const tip = (text, label) => `<span class="term" data-tip="${escapeHtml(text)}" tabindex="0">${label}</span>`;

    const side = (s, isLeader) => `
        <div class="vs-side${isLeader ? ' is-leader' : ''}" style="--vs-engine:${seriesVar(s.engine)}">
            <div class="vs-side-top">
                <span class="vs-side-name">${escapeHtml(s.engine.name)}</span>
                ${isLeader ? '<span class="vs-lead-chip">does more</span>' : ''}
            </div>
            <div class="vs-side-kind">${s.engine.cost} mana · ${s.certain ? 'tutor — you pick' : 'discover — random, can chain'}</div>
            <div class="vs-side-value">${formatNumber(s.perCast, 1)}</div>
            <div class="vs-side-unit">${tip('Free mana value from one creature cast, averaged over every creature in the deck. A cast it does not fire on counts as zero.', 'mana per creature cast')}</div>
            <dl class="vs-side-rows">
                <div><dt>${tip('How many of your creatures trigger it when you cast them.', 'Fires on')}</dt><dd>${s.fires} of ${n} creatures</dd></div>
                <div><dt>${tip('Average free mana value on the casts where it fires.', 'When it fires')}</dt><dd>${formatNumber(s.perTrigger, 1)} mana</dd></div>
                <div><dt><span class="term" data-term="p95" tabindex="0">Good turn</span></dt><dd>${s.fires ? `${s.firedP95} mana` : '—'}</dd></div>
            </dl>
        </div>`;

    el.innerHTML = `
        ${renderBottomLine(line)}
        <div class="vs-board">
            ${side(a, v.leader === 'a')}
            <div class="vs-mid">
                <span class="vs-mid-vs">vs</span>
                <span class="vs-mid-tally"><span>${cmp.winsA}</span><span class="vs-mid-sep">–</span><span>${cmp.winsB}</span></span>
                <span class="vs-mid-label">${tip('For each creature, which engine gives more on average when you cast it.', 'creatures won')}${cmp.ties ? `<span class="vs-mid-ties">${cmp.ties} tied</span>` : ''}</span>
            </div>
            ${side(b, v.leader === 'b')}
        </div>`;
}

/**
 * The chart that answers the actual question: average free mana against the
 * mana value of the creature you cast, which is what "point in the game" means
 * in practice. Each engine keeps its identity colour; the dashed line is the
 * random engine's good turn, so the swing shows next to the average.
 */
function updateCurveChart(cmp) {
    if (!document.getElementById('versus-curve-chart') || !cmp) return;
    const { curve, summary } = cmp;
    if (curve.length === 0) return;

    const line = (s, key, extra = {}) => ({
        label: s.engine.name,
        data: curve.map(p => p[key]),
        borderColor: seriesHex(s.engine),
        backgroundColor: seriesHex(s.engine),
        borderWidth: 2,
        fill: false,
        cubicInterpolationMode: 'monotone',
        pointRadius: 3,
        pointHoverRadius: 5,
        ...extra
    });
    const random = [summary.a, summary.b].find(s => !s.certain);
    const datasets = [line(summary.a, 'a'), line(summary.b, 'b')];
    if (random) {
        datasets.push(line(random, random === summary.a ? 'aP95' : 'bP95', {
            label: `${random.engine.name} — good turn`,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0
        }));
    }

    curveChart = createOrUpdateChart(curveChart, 'versus-curve-chart', {
        type: 'line',
        data: { labels: curve.map(p => String(p.cmc)), datasets },
        options: {
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: TX.mid, font: { size: 11 }, boxWidth: 14, boxHeight: 2 }
                },
                tooltip: {
                    callbacks: {
                        title: (items) => `Casting a ${items[0]?.label ?? ''}-mana creature`,
                        label: (item) => `${item.dataset.label}: ${formatNumber(item.parsed.y, 1)} mana`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Free mana per creature cast', color: TX.dim, font: { size: 11 } },
                    grid: { color: TX.rule },
                    ticks: { color: TX.dim, precision: 0 }
                },
                x: {
                    title: { display: true, text: 'Mana value of the creature you cast', color: TX.dim, font: { size: 11 } },
                    grid: { display: false },
                    ticks: { color: TX.dim }
                }
            }
        }
    });
}

/** Early versus late, in one sentence under the chart. */
function renderCurveNote(cmp) {
    const el = document.getElementById('versus-recommendation');
    if (!el) return;
    if (!cmp) { el.innerHTML = ''; return; }
    const { a, b } = cmp.summary;
    const { early, late } = curveSplit(cmp.curve);
    const nameA = escapeHtml(a.engine.name);
    const nameB = escapeHtml(b.engine.name);
    const bits = [];
    if (early.count) bits.push(`Casting creatures of mana value 4 or less, ${nameA} gives <strong>${formatNumber(early.a, 1)}</strong> against ${nameB}’s <strong>${formatNumber(early.b, 1)}</strong>.`);
    if (late.count) {
        bits.push(`At 6 and up it is <strong>${formatNumber(late.a, 1)}</strong> against <strong>${formatNumber(late.b, 1)}</strong>.`);
        const randomLate = !b.certain ? late.b > late.a : late.a > late.b;
        bits.push(randomLate
            ? 'Discover scales with the creature you cast, while a tutor is capped by the best card in the group.'
            : `${late.a >= late.b ? nameA : nameB} holds up at the top of the curve too.`);
    }
    el.innerHTML = bits.length ? `<p class="vs-note">${bits.join(' ')}</p>` : '';
}

/**
 * The random engine's spread — the part no average can express, and the
 * direct test of "higher peaks". Shown only for a discover engine; a tutor has
 * no spread to show.
 */
function renderPeaks(cmp) {
    const el = document.getElementById('versus-peaks');
    const head = document.getElementById('versus-peaks-summary');
    if (!el) return;
    if (!cmp) { el.innerHTML = ''; return; }

    const sides = [cmp.summary.a, cmp.summary.b];
    const discoverSide = sides.find(s => s.engine.kind === 'discover');
    const tutorSide = sides.find(s => s.engine.kind === 'tutor');
    const prepared = discoverSide === cmp.summary.a ? cmp.prepared?.a : cmp.prepared?.b;
    if (!discoverSide || !prepared?.byCreature) { el.innerHTML = ''; return; }
    if (head) head.textContent = `How ${discoverSide.engine.name}’s results spread`;

    // Pool every sampled creature together: across the deck's big creatures,
    // how often does one trigger chain, and how big does it get?
    const pooled = [...prepared.byCreature.values()];
    if (pooled.length === 0) {
        el.innerHTML = `<div class="tx-empty">${escapeHtml(discoverSide.engine.name)} never triggers in this deck — no creature has power 5 or more.</div>`;
        return;
    }

    const chainDist = mergeDists(pooled.map(s => ({ dist: s.chainDist })));
    const manaDist = mergeDists(pooled.map(s => ({ dist: s.manaDist })));
    const runs = pooled.reduce((t, s) => t + s.runs, 0);
    const chained = chainDist.slice(2).reduce((t, v) => t + v, 0);
    const tutorCap = tutorSide ? tutorSide.best : 0;
    const contested = cmp.contested;
    const discoverIsB = discoverSide === cmp.summary.b;
    const discoverWins = discoverIsB ? contested.bWins : contested.aWins;
    const tutorWins = discoverIsB ? contested.aWins : contested.bWins;

    const stat = (label, value, sub, tipText) => `
        <div class="vs-peak">
            <div class="vs-peak-label">${tipText ? `<span class="term" ${tipText.startsWith('term:') ? `data-term="${tipText.slice(5)}"` : `data-tip="${escapeHtml(tipText)}"`} tabindex="0">${label}</span>` : label}</div>
            <div class="vs-peak-value">${value}</div>
            <div class="vs-peak-sub">${sub}</div>
        </div>`;

    el.innerHTML = `
        <div class="vs-peaks">
            ${tutorSide && contested.casts > 0 ? stat(
                `Beats ${escapeHtml(tutorSide.engine.name)}`,
                pct(discoverWins),
                `on the ${contested.casts} creature${contested.casts === 1 ? '' : 's'} both fire on · loses ${pct(tutorWins)}`,
                'How often the random roll comes out ahead of the tutor’s certain pick, on the casts where both trigger.'
            ) : ''}
            ${stat('Chains', pct(chained / runs), 'of triggers cast 2+ spells', 'How often the free spell is itself a power-5+ creature, which triggers Vortex again.')}
            ${stat('Good turn', percentileFromDist(manaDist, 0.95), 'mana, 1 trigger in 20', 'term:p95')}
            ${stat('Great turn', percentileFromDist(manaDist, 0.99), 'mana, 1 trigger in 100', 'term:p99')}
            ${stat('Finds nothing', pct((chainDist[0] || 0) / runs), 'of triggers', 'Triggers where nothing in the library costs little enough.')}
        </div>
        <div class="vs-dists">
            <div>
                <div class="tx-sim-block-title">Free spells per trigger</div>
                ${spellsChart(chainDist, runs)}
            </div>
            <div>
                <div class="tx-sim-block-title">Free mana per trigger${tutorSide ? ` · ${escapeHtml(tutorSide.engine.name)}’s best is ${tutorCap}` : ''}</div>
                ${manaChart(manaDist, runs, {
                    marker: (i) => (tutorSide && i === tutorCap ? `${tutorSide.engine.name} best` : null),
                    tone: (i) => (i === 0 ? 'bad' : (tutorSide && i > tutorCap ? 'warn' : null))
                })}
            </div>
        </div>
        <p class="vs-note">Pooled over ${pooled.length} big creature${pooled.length === 1 ? '' : 's'}, ${runs.toLocaleString('en-US')} shuffles. Bars past ${tutorSide ? `${escapeHtml(tutorSide.engine.name)}’s best` : 'the cap'} are turns the tutor can never match.</p>`;
}

/**
 * Spread charts with the far tail folded into one "N+" row, so the last row is
 * never the largest run seen (a sampled maximum).
 */
function spellsChart(dist, runs) {
    const { counts, cut, folded } = foldTail(dist);
    const label = (i) => `${i}${folded && i === cut ? '+' : ''} spell${i === 1 && !(folded && i === cut) ? '' : 's'}`;
    return renderDistributionChart(counts, runs, label, (i) => (i >= 2 ? 'chain' : null), (i) => (i === 0 ? 'bad' : null));
}

function manaChart(dist, runs, { marker = () => null, tone = () => null } = {}) {
    const { counts, cut, folded } = foldTail(dist);
    return renderDistributionChart(counts, runs, (i) => `${i}${folded && i === cut ? '+' : ''} mana`, marker, tone);
}

function updateTable(cmp) {
    if (!cmp) {
        renderSweepTable('versus-table', { columns: [], rows: [], emptyText: 'Import a decklist to compare creature by creature.' });
        return;
    }
    const sideA = cmp.summary.a;
    const sideB = cmp.summary.b;

    const cell = (v, s) => {
        if (!v.triggers) return `<span class="vs-detail">— ${escapeHtml(v.detail)}</span>`;
        const value = `<span class="vs-val" style="--vs-engine:${seriesVar(s.engine)}">${formatNumber(v.mean, v.certain ? 0 : 1)}</span>`;
        return v.certain
            ? `${value} <span class="vs-detail">${v.card ? cardRef(v.card.name) : escapeHtml(v.detail)}</span>`
            : `${value} <span class="vs-detail">avg · ${escapeHtml(v.detail)}</span>`;
    };

    renderSweepTable('versus-table', {
        columns: [
            { label: 'Creature', align: 'left', render: r => cardRef(r.name) },
            { label: 'MV', render: r => r.cmc },
            { label: 'P/T', render: r => `<span class="vs-pt">${escapeHtml(r.power)}/${escapeHtml(r.toughness)}</span>` },
            { label: escapeHtml(sideA.engine.name), align: 'left', render: r => cell(r.a, sideA) },
            { label: escapeHtml(sideB.engine.name), align: 'left', render: r => cell(r.b, sideB) },
            {
                // One column rather than two: where both engines fire, the odds
                // already say who wins and by how much, and where only one fires
                // there is no contest to put a percentage on.
                label: 'Better here',
                align: 'left',
                render: (r) => {
                    const named = (s) => `<span class="vs-win" style="--vs-engine:${seriesVar(s.engine)}">${escapeHtml(s.engine.name)}</span>`;
                    if (r.contested) {
                        const aAhead = r.odds.aWins >= r.odds.bWins;
                        return `${named(aAhead ? sideA : sideB)} <span class="vs-detail">${pct(aAhead ? r.odds.aWins : r.odds.bWins)} of the time</span>`;
                    }
                    if (r.a.triggers) return `${named(sideA)} <span class="vs-detail">only one that fires</span>`;
                    if (r.b.triggers) return `${named(sideB)} <span class="vs-detail">only one that fires</span>`;
                    return '<span class="vs-detail">neither fires</span>';
                }
            }
        ],
        rows: cmp.rows,
        emptyText: 'No creatures in this deck.'
    });
}

/** Show or hide the evidence panels; without a deck only the answer remains. */
function showPanels(ids, visible) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.hidden = !visible;
    }
}

export function updateUI() {
    const { cmp, verdict: v } = calculate();
    showPanels(['versus-curve-panel', 'versus-table-panel', 'versus-more-panel'], Boolean(cmp));
    renderAnswer(cmp, v);
    updateCurveChart(cmp);
    renderCurveNote(cmp);
    updateTable(cmp);
    renderPeaks(cmp);
    const count = document.getElementById('versus-table-count');
    if (count) count.textContent = cmp ? `${cmp.creatures} creatures · sorted by mana value` : '';
}

// ==================== SHARE LINKS ====================

export function getShareParams() {
    const { a, b, treatStarAs5Plus } = readInputs();
    return { vsA: a, vsB: b, vsStar: treatStarAs5Plus ? 1 : 0 };
}

export function applyShareParams(params) {
    const pick = (name, id) => {
        const value = params?.get?.(name);
        const el = document.getElementById(id);
        if (el && value && Object.prototype.hasOwnProperty.call(ENGINES, value)) el.value = value;
    };
    pick('vsA', 'versus-engine-a');
    pick('vsB', 'versus-engine-b');
    const star = params?.get?.('vsStar');
    const box = document.getElementById('versus-star-power');
    if (box && (star === '0' || star === '1')) box.checked = star === '1';
    updateUI();
}

// ==================== INIT ====================

export function init() {
    // Populate both selectors from the engine registry, so a third engine needs
    // no markup change.
    const options = Object.values(ENGINES)
        .map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
    const selA = document.getElementById('versus-engine-a');
    const selB = document.getElementById('versus-engine-b');
    if (selA && !selA.options.length) { selA.innerHTML = options; selA.value = 'wildpair'; }
    if (selB && !selB.options.length) { selB.innerHTML = options; selB.value = 'vortex'; }

    [selA, selB, document.getElementById('versus-star-power')].forEach(el => {
        el?.addEventListener('change', () => updateUI());
    });

    document.getElementById('versus-swap')?.addEventListener('click', () => {
        if (!selA || !selB) return;
        [selA.value, selB.value] = [selB.value, selA.value];
        updateUI();
    });

    registerCalculator({ name: 'versus', calculate, updateUI, inputs: [] });
}
