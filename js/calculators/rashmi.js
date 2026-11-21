/**
 * Rashmi, Eternities Crafter
 *
 * "Whenever you cast your first spell each turn, reveal the top card of your
 * library. You may cast it without paying its mana cost if it's a spell with
 * lesser mana value. If you don't cast it, put it into your hand."
 *
 * The top card of a shuffled library is a uniformly random card, so every
 * number here is exact: the free-spell chance for a cast of mana value M is the
 * share of the library that is a nonland card with mana value below M. Sample
 * reveals are real random cards from the list, kept stable while the mana
 * value changes so you can watch the same reveals flip between "cast free" and
 * "to hand".
 */

import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable, pBarCell } from '../utils/components.js';
import { recommendThresholdX } from '../utils/analysis.js';
import { buildDeckFromCardData, extractCardTypes } from '../utils/sampleSimulator.js';
import { cardRef } from '../data/glossary.js';

/** Highest mana value tracked; anything above is folded into it. */
export const MAX_TRACKED_MV = 20;

/** Highest cast mana value offered (big X spells reach this). */
export const MAX_CAST_MV = 15;

/** "Reliable" means at least this chance of a free spell. */
export const RELIABLE_CHANCE = 0.7;

/** Sample reveals shown. */
export const SAMPLE_REVEALS = 12;

/** Mana values either side of the cast value reported by calculate(). */
const RANGE_BEFORE = 2;
const RANGE_AFTER = 4;

let chart = null;

// ==================== PURE MATH ====================

/** True for a mana cost containing {X}. */
export function isXSpell(manaCost) {
    return typeof manaCost === 'string' && /\{X\}/i.test(manaCost);
}

/**
 * Turn a decklist into the lookup tables the odds need.
 *
 * cdf[m] counts eligible nonland cards with mana value <= m and prefixMv[m]
 * sums their mana value, so any cast value is answered in O(1).
 *
 * @param {Object<string, {name:string, count:number, cmc:number, type_line:string, mana_cost?:string}>} cardsByName
 * @param {{excludeX?:boolean}} [opts] - excludeX: X spells (which resolve with X = 0) never count as free spells
 * @returns {{deckSize:number, lands:number, spells:number, cmcDistribution:Object<number,number>, cdf:number[], prefixMv:number[], xSpells:Array, xCount:number, excludeX:boolean, hasImportedData:boolean}}
 */
export function buildRashmiState(cardsByName, { excludeX = false } = {}) {
    const cards = Object.values(cardsByName ?? {});
    const cmcDistribution = {};
    const xSpells = [];
    const cdf = new Array(MAX_TRACKED_MV + 1).fill(0);
    const prefixMv = new Array(MAX_TRACKED_MV + 1).fill(0);
    let deckSize = 0;
    let lands = 0;
    let spells = 0;

    for (const card of cards) {
        const count = Math.max(0, Number(card?.count) || 0);
        if (!count) continue;
        deckSize += count;
        const isLand = extractCardTypes({ type_line: card.type_line ?? '' }).includes('land');
        if (isLand) { lands += count; continue; }
        spells += count;

        const mv = Math.min(MAX_TRACKED_MV, Math.max(0, Math.floor(Number(card.cmc) || 0)));
        const isX = isXSpell(card.mana_cost);
        if (isX) xSpells.push({ name: card.name, count, cmc: mv, manaCost: card.mana_cost });
        if (excludeX && isX) continue;
        cmcDistribution[mv] = (cmcDistribution[mv] || 0) + count;
    }

    let runningCount = 0;
    let runningSum = 0;
    for (let i = 0; i <= MAX_TRACKED_MV; i++) {
        const count = cmcDistribution[i] || 0;
        runningCount += count;
        runningSum += count * i;
        cdf[i] = runningCount;
        prefixMv[i] = runningSum;
    }

    return {
        deckSize,
        lands,
        spells,
        cmcDistribution,
        cdf,
        prefixMv,
        xSpells,
        xCount: xSpells.reduce((s, x) => s + x.count, 0),
        excludeX,
        hasImportedData: deckSize > 0
    };
}

/**
 * Odds for one cast: the chance the top card is a spell with lesser mana value,
 * and the average mana value of that free spell when it is one.
 *
 * @param {Object} state - buildRashmiState output
 * @param {number} castMv - mana value of the spell that triggered Rashmi
 * @returns {{probFreeSpell:number, probWhiff:number, expectedCmc:number}}
 */
export function freeSpellOdds(state, castMv) {
    const deckSize = state?.deckSize ?? 0;
    const mv = Math.floor(Number(castMv) || 0);
    if (deckSize === 0 || mv <= 0) return { probFreeSpell: 0, probWhiff: 1, expectedCmc: 0 };

    // "Lesser mana value": eligible cards have mana value <= castMv - 1.
    const index = Math.min(mv - 1, MAX_TRACKED_MV);
    const free = state.cdf[index];
    const probFreeSpell = free / deckSize;
    return {
        probFreeSpell,
        probWhiff: 1 - probFreeSpell,
        expectedCmc: free > 0 ? state.prefixMv[index] / free : 0
    };
}

/**
 * Free-spell odds for every cast mana value 1..max.
 * @returns {Array<{x:number, prob:number, expectedCmc:number, freeMana:number}>}
 */
export function oddsByCastMv(state, max = MAX_CAST_MV) {
    const rows = [];
    for (let mv = 1; mv <= max; mv++) {
        const r = freeSpellOdds(state, mv);
        rows.push({ x: mv, prob: r.probFreeSpell, expectedCmc: r.expectedCmc, freeMana: r.probFreeSpell * r.expectedCmc });
    }
    return rows;
}

/**
 * What the revealed card is, as shares of the library: a free spell, a spell
 * too big to cast free, an X spell left out, or a land. Sums to 1.
 *
 * @returns {{free:number, tooBig:number, xLeftOut:number, land:number}}
 */
export function revealBreakdown(state, castMv) {
    const deckSize = state?.deckSize ?? 0;
    if (!deckSize) return { free: 0, tooBig: 0, xLeftOut: 0, land: 0 };
    const free = freeSpellOdds(state, castMv).probFreeSpell;
    const land = state.lands / deckSize;
    const xLeftOut = state.excludeX ? state.xCount / deckSize : 0;
    return { free, tooBig: Math.max(0, 1 - free - land - xLeftOut), xLeftOut, land };
}

/**
 * The lowest cast mana value whose free-spell chance reaches `target`.
 * @returns {{mv:number|null, best:{x:number, prob:number}}}
 */
export function reliableFrom(rows, target = RELIABLE_CHANCE) {
    const rec = recommendThresholdX(rows.map(r => ({ x: r.x, value: r.prob })), { target });
    const best = rows.reduce((b, r) => (r.prob > b.prob ? r : b), { x: 0, prob: 0 });
    return { mv: rec?.reason === 'threshold' ? rec.x : null, best };
}

/**
 * Your own spells grouped by mana value, with what Rashmi does when each is the
 * first spell of a turn, plus the average across all of them.
 *
 * @returns {{rows:Array<{x:number, count:number, prob:number, expectedCmc:number}>, average:number}}
 */
export function curveRows(state) {
    const dist = state?.cmcDistribution ?? {};
    const rows = Object.keys(dist).map(Number).sort((a, b) => a - b)
        .filter(mv => dist[mv] > 0)
        .map(mv => {
            const r = freeSpellOdds(state, mv);
            return { x: mv, count: dist[mv], prob: r.probFreeSpell, expectedCmc: r.expectedCmc };
        });
    const total = rows.reduce((s, r) => s + r.count, 0);
    const average = total ? rows.reduce((s, r) => s + r.count * r.prob, 0) / total : 0;
    return { rows, average };
}

const pct = v => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`;
const one = v => (Number.isFinite(v) ? v.toFixed(1) : '—');

/** Tone for a free-spell chance: what the number means for the deck. */
export function chanceTone(p) {
    if (!(p > 0)) return 'bad';
    if (p >= 0.5) return 'good';
    if (p >= 0.3) return 'warn';
    return 'bad';
}

/**
 * The plain-English answer to "How often does Rashmi flip a free spell?".
 *
 * @param {{castMv:number, odds:Object, reliable:{mv:number|null, best:Object}, landShare:number, hasImportedData:boolean}} result
 * @returns {{html:string, tone:string}}
 */
export function summarize(result) {
    const { castMv, odds, reliable, landShare = 0, hasImportedData = true } = result ?? {};
    if (!hasImportedData || !odds) {
        return { tone: 'flat', html: 'Import a decklist to see what Rashmi reveals — the odds come from the mana values of your actual cards.' };
    }

    const p = odds.probFreeSpell;
    let html = p > 0
        ? `Casting a <strong>${castMv}-mana</strong> spell, Rashmi flips a free spell <strong>${pct(p)}</strong> of the time — on average a <strong>${one(odds.expectedCmc)}-mana</strong> card. Otherwise the card goes to your hand.`
        : `Casting a <strong>${castMv}-mana</strong> spell, Rashmi can’t flip a free spell — nothing in your deck costs less. The revealed card always goes to your hand.`;

    if (reliable?.mv != null) {
        html += reliable.mv <= castMv
            ? ' That is in the reliable range (7 in 10 or better).'
            : ` It reaches 7 in 10 once your first spell costs <strong>${reliable.mv}</strong> or more.`;
    } else if (reliable?.best?.prob > 0) {
        html += ` No spell reaches 7 in 10: ${pct(landShare)} of your library is lands, so even a huge spell tops out at <strong>${pct(reliable.best.prob)}</strong>.`;
    }
    return { html, tone: chanceTone(p) };
}

// ==================== STATE ====================

const cache = { ref: null, excludeX: null, state: null, deck: null };
const samples = { deckRef: null, picks: [] };

function readCastMv() {
    const raw = parseInt(document.getElementById('rashmi-cmcValue')?.value, 10);
    return Math.max(1, Math.min(MAX_CAST_MV, Number.isFinite(raw) ? raw : 5));
}

/**
 * Deck tables for the current list, rebuilt only when the deck object or the
 * X-spell setting changes (the deck object is replaced on every import).
 */
function currentState() {
    const cardsByName = DeckConfig.getImportedCardData()?.cardsByName ?? {};
    const excludeX = Boolean(document.getElementById('rashmi-exclude-x')?.checked);
    if (cache.ref !== cardsByName || cache.excludeX !== excludeX || !cache.state) {
        cache.state = buildRashmiState(cardsByName, { excludeX });
        if (cache.ref !== cardsByName) cache.deck = null;
        cache.ref = cardsByName;
        cache.excludeX = excludeX;
    }
    return cache.state;
}

/**
 * Odds for the chosen cast mana value and its neighbours.
 * @returns {{config:Object, results:Object<number, {probFreeSpell:number, probWhiff:number, expectedCmc:number}>}}
 */
export function calculate() {
    const state = currentState();
    const config = { ...state, castCmc: readCastMv() };
    if (!state.hasImportedData) return { config, results: {} };

    const results = {};
    const lo = Math.max(1, config.castCmc - RANGE_BEFORE);
    const hi = Math.min(MAX_CAST_MV, config.castCmc + RANGE_AFTER);
    for (let mv = lo; mv <= hi; mv++) results[mv] = freeSpellOdds(state, mv);
    return { config, results };
}

// ==================== RENDERING ====================

function updateChart(rows, castMv) {
    if (!document.getElementById('rashmi-chart')) return;
    chart = createOrUpdateChart(chart, 'rashmi-chart', {
        type: 'bar',
        data: {
            labels: rows.map(r => String(r.x)),
            datasets: [{
                label: 'Free-spell chance',
                data: rows.map(r => Math.round(r.prob * 1000) / 10),
                backgroundColor: rows.map(r => (r.x === castMv ? TX.amber : TX.greenFill)),
                borderColor: rows.map(r => (r.x === castMv ? TX.amber : TX.green)),
                borderWidth: 1,
                borderRadius: 3,
                maxBarThickness: 44,
                order: 2
            }, {
                type: 'line',
                label: 'Reliable: 7 in 10',
                data: rows.map(() => RELIABLE_CHANCE * 100),
                borderColor: TX.mid,
                borderWidth: 1,
                borderDash: [5, 4],
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                order: 1
            }]
        },
        options: {
            plugins: {
                tooltip: {
                    filter: item => item.datasetIndex === 0,
                    callbacks: {
                        title: items => `Casting a ${items[0]?.label}-mana spell`,
                        label: ctx => {
                            const r = rows[ctx.dataIndex];
                            return r ? [` Free spell: ${pct(r.prob)}`, ` Average free spell: ${one(r.expectedCmc)} mana`] : '';
                        }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Mana value of your first spell', color: TX.dim } },
                y: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` }, title: { display: true, text: 'Chance of a free spell', color: TX.dim } }
            }
        }
    });
}

function renderBreakdown(state, castMv) {
    const el = document.getElementById('rashmi-split');
    if (!el) return;
    const b = revealBreakdown(state, castMv);
    const parts = [
        { key: 'free', label: 'Free spell', value: b.free },
        { key: 'big', label: `Costs ${castMv} or more — to hand`, value: b.tooBig },
        { key: 'x', label: 'X spell, left out — to hand', value: b.xLeftOut },
        { key: 'land', label: 'Land — to hand', value: b.land }
    ].filter(p => p.value > 0);

    el.innerHTML = `
        <div class="rs-band" role="img" aria-label="${parts.map(p => `${p.label}: ${pct(p.value)}`).join(', ')}">
            ${parts.map(p => `<span class="rs-band-seg is-${p.key}" style="width:${(p.value * 100).toFixed(2)}%"></span>`).join('')}
        </div>
        <ul class="tx-legend">
            ${parts.map(p => `<li><span class="rs-swatch is-${p.key}"></span>${p.label}<strong>${pct(p.value)}</strong></li>`).join('')}
        </ul>`;
}

function renderHero(state, castMv, odds, reliable) {
    const el = document.getElementById('rashmi-hero');
    if (!el) return;
    el.innerHTML = renderHeroStats([
        {
            label: 'Free-spell chance',
            value: pct(odds.probFreeSpell),
            sub: `casting a ${castMv}-mana spell`,
            size: 'big',
            color: `var(--tx-${chanceTone(odds.probFreeSpell)})`,
            tip: 'The chance the top card of your library is a nonland card with lower mana value than the spell you cast. Exact, from your decklist.'
        },
        {
            label: 'Average free spell',
            value: odds.probFreeSpell > 0 ? one(odds.expectedCmc) : '—',
            sub: 'mana value, when it hits',
            tip: 'Every eligible card is equally likely to be on top, so this is the average mana value of the cards that qualify.'
        },
        {
            label: 'Free mana per trigger',
            value: one(odds.probFreeSpell * odds.expectedCmc),
            sub: 'average, counting misses',
            term: 'ev'
        },
        {
            label: 'Reliable from',
            value: reliable.mv != null ? `${reliable.mv}+` : 'Never',
            sub: reliable.mv != null ? 'mana value for 7 in 10' : `best case ${pct(reliable.best.prob)}`,
            color: reliable.mv != null ? 'var(--tx-bright)' : 'var(--tx-warn)',
            tip: 'The cheapest first spell that flips a free spell at least 7 times in 10.'
        }
    ]);
}

function renderCurveTable(state, castMv) {
    const { rows, average } = curveRows(state);
    renderSweepTable('rashmi-comparisonTable', {
        rows,
        current: castMv,
        columns: [
            { label: 'Mana value', align: 'left', render: r => String(r.x) },
            { label: 'Your spells', render: r => String(r.count) },
            { label: 'Free-spell chance if cast first', render: r => `${pct(r.prob)} ${pBarCell(r.prob, `var(--tx-${chanceTone(r.prob)})`)}` },
            { label: 'Average free spell', render: r => (r.prob > 0 ? one(r.expectedCmc) : '—') }
        ],
        emptyText: 'Import a decklist to see your spells by mana value.'
    });
    const note = document.getElementById('rashmi-curve-note');
    if (note) {
        note.innerHTML = rows.length
            ? `If every spell in your deck were equally likely to be your first of the turn, Rashmi would flip a free spell <strong>${pct(average)}</strong> of the time. In practice your first spell is often a cheap one — use the row for what you actually cast.`
            : '';
    }
}

function renderXNote(state) {
    const group = document.getElementById('rashmi-x-group');
    const hint = document.getElementById('rashmi-x-hint');
    if (group) group.hidden = state.xCount === 0;
    if (hint && state.xCount > 0) {
        const names = state.xSpells.slice(0, 3).map(x => cardRef(x.name)).join(', ');
        const more = state.xSpells.length > 3 ? ` and ${state.xSpells.length - 3} more` : '';
        hint.innerHTML = `Cast free, an X spell resolves with X = 0. Your deck has ${state.xCount}: ${names}${more}.`;
    }
}

function ensureSamples(deck, cardsByName, force = false) {
    if (!force && samples.deckRef === cardsByName && samples.picks.length) return samples.picks;
    samples.picks = [];
    for (let i = 0; i < SAMPLE_REVEALS && deck.length; i++) {
        samples.picks.push(deck[Math.floor(Math.random() * deck.length)]);
    }
    samples.deckRef = cardsByName;
    return samples.picks;
}

/**
 * Classify a revealed card for a given cast.
 * @returns {'free'|'land'|'big'|'x'}
 */
export function classifyReveal(card, castMv, excludeX = false) {
    const isLand = Array.isArray(card?.types) && card.types.includes('land');
    if (isLand) return 'land';
    const mv = Math.floor(Number(card?.cmc) || 0);
    if (excludeX && isXSpell(card?.mana_cost)) return 'x';
    return mv < castMv ? 'free' : 'big';
}

/**
 * Render sample reveals. Picks stay the same while the cast value changes;
 * pass force to draw new ones.
 */
export function runSampleReveals(force = false) {
    const display = document.getElementById('rashmi-reveals-display');
    if (!display) return;
    const cardsByName = DeckConfig.getImportedCardData()?.cardsByName ?? {};
    const state = currentState();
    if (!state.hasImportedData) {
        display.innerHTML = '<div class="tx-empty">Import a decklist to see sample reveals.</div>';
        return;
    }
    if (!cache.deck) cache.deck = buildDeckFromCardData({ cardsByName });
    const picks = ensureSamples(cache.deck, cardsByName, force);
    const castMv = readCastMv();

    const verdict = {
        free: 'Cast free',
        land: 'Land — to hand',
        big: 'Too big — to hand',
        x: 'X spell — to hand'
    };
    const hits = picks.filter(c => classifyReveal(c, castMv, state.excludeX) === 'free').length;
    display.innerHTML = `
        <ol class="rs-reveals">
            ${picks.map((card, i) => {
                const kind = classifyReveal(card, castMv, state.excludeX);
                const mv = card.types?.includes('land') ? '' : `<span class="rs-reveal-mv">${Math.floor(Number(card.cmc) || 0)}</span>`;
                return `<li class="rs-reveal is-${kind}">
                    <span class="rs-reveal-n">${i + 1}</span>
                    <span class="rs-reveal-card">${cardRef(card.name)}${mv}</span>
                    <span class="rs-reveal-verdict">${verdict[kind]}</span>
                </li>`;
            }).join('')}
        </ol>
        <p class="tx-caption">${hits} of these ${picks.length} reveals would be free with a ${castMv}-mana spell. Change the mana value to see the same cards re-sorted.</p>`;
}

export function updateUI() {
    const { config } = calculate();
    const state = currentState();
    const castMv = config.castCmc;
    renderXNote(state);

    const bottom = document.getElementById('rashmi-bottom-line');
    const evidence = document.querySelectorAll('#rashmi-tab [data-needs-deck]');
    evidence.forEach(el => { el.hidden = !state.hasImportedData; });

    if (!state.hasImportedData) {
        if (bottom) bottom.innerHTML = renderBottomLine(summarize({ hasImportedData: false }));
        const hero = document.getElementById('rashmi-hero');
        if (hero) hero.innerHTML = '';
        if (chart) { chart.destroy(); chart = null; }
        return;
    }

    const odds = freeSpellOdds(state, castMv);
    const maxMv = Math.min(MAX_CAST_MV, Math.max(10, castMv + 2, ...curveRows(state).rows.map(r => r.x + 1)));
    const rows = oddsByCastMv(state, maxMv);
    const reliable = reliableFrom(oddsByCastMv(state, MAX_CAST_MV));

    if (bottom) {
        bottom.innerHTML = renderBottomLine(summarize({
            castMv, odds, reliable, landShare: state.lands / state.deckSize, hasImportedData: true
        }));
    }
    renderHero(state, castMv, odds, reliable);
    renderBreakdown(state, castMv);
    updateChart(rows, castMv);
    runSampleReveals();
    renderCurveTable(state, castMv);
}

export function init() {
    registerCalculator({
        name: 'rashmi',
        calculate,
        updateUI,
        inputs: ['cmc'],
        init: (debouncedUpdate) => {
            document.getElementById('rashmi-exclude-x')?.addEventListener('change', () => debouncedUpdate());
            document.getElementById('rashmi-draw-reveals-btn')?.addEventListener('click', () => runSampleReveals(true));
        }
    });
}
