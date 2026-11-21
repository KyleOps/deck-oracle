/**
 * Rashmi, Eternities Crafter. The page: readInputs() (the DOM and the deck →
 * a plain object), the model, then rendering. The maths lives in
 * js/utils/models/rashmi.js.
 */

import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine, renderSweepTable, pBarCell, toneColor } from '../utils/components.js';
import { buildDeckFromCardData } from '../utils/sampleSimulator.js';
import { libraryOf } from '../utils/library.js';
import { one, pct } from '../utils/text.js';
import { cardRef } from '../data/glossary.js';
import {
    MAX_CAST_MV, RELIABLE_CHANCE, buildRashmiState, chanceTone, classifyReveal, curveRows, freeSpellOdds,
    oddsAround, oddsByCastMv, reliableFrom, revealBreakdown, summarize
} from '../utils/models/rashmi.js';

/** Sample reveals shown. */
export const SAMPLE_REVEALS = 12;

let chart = null;

// ==================== INPUTS ====================

const cache = { ref: null, excludeX: null, state: null, deck: null };
const samples = { deckRef: null, picks: [] };

function readCastMv() {
    const raw = parseInt(document.getElementById('rashmi-cmcValue')?.value, 10);
    return Math.max(1, Math.min(MAX_CAST_MV, Number.isFinite(raw) ? raw : 5));
}

/** The cast mana value, the X-spell setting and the library (commanders are never in it). */
export function readInputs() {
    return {
        library: libraryOf(DeckConfig.getDeckConfig()),
        excludeX: Boolean(document.getElementById('rashmi-exclude-x')?.checked),
        castMv: readCastMv()
    };
}

/**
 * Deck tables for the current list, rebuilt only when the library or the
 * X-spell setting changes (a new deck is a new library object).
 */
function currentState({ library, excludeX } = readInputs()) {
    if (cache.ref !== library || cache.excludeX !== excludeX || !cache.state) {
        cache.state = buildRashmiState(library, { excludeX });
        if (cache.ref !== library) cache.deck = null;
        cache.ref = library;
        cache.excludeX = excludeX;
    }
    return cache.state;
}

/**
 * Odds for the chosen cast mana value and its neighbours.
 * @returns {{config:Object, results:Object<number, {probFreeSpell:number, probWhiff:number, expectedCmc:number}>}}
 */
export function calculate() {
    const inputs = readInputs();
    const state = currentState(inputs);
    const config = { ...state, castCmc: inputs.castMv };
    if (!state.hasImportedData) return { config, results: {} };
    return { config, results: oddsAround(state, config.castCmc) };
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
        <ul class="rs-legend">
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
            color: toneColor(chanceTone(odds.probFreeSpell)),
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
            { label: 'Free-spell chance if cast first', render: r => `${pct(r.prob)} ${pBarCell(r.prob, toneColor(chanceTone(r.prob)))}` },
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

function ensureSamples(deck, ref, force = false) {
    if (!force && samples.deckRef === ref && samples.picks.length) return samples.picks;
    samples.picks = [];
    for (let i = 0; i < SAMPLE_REVEALS && deck.length; i++) {
        samples.picks.push(deck[Math.floor(Math.random() * deck.length)]);
    }
    samples.deckRef = ref;
    return samples.picks;
}

/**
 * Render sample reveals. Picks stay the same while the cast value changes;
 * pass force to draw new ones.
 */
export function runSampleReveals(force = false) {
    const display = document.getElementById('rashmi-reveals-display');
    if (!display) return;
    const state = currentState();
    if (!state.hasImportedData) {
        display.innerHTML = '<div class="tx-empty">Import a decklist to see sample reveals.</div>';
        return;
    }
    if (!cache.deck) cache.deck = buildDeckFromCardData(cache.ref);
    const picks = ensureSamples(cache.deck, cache.ref, force);
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
        <p class="rs-caption">${hits} of these ${picks.length} reveals would be free with a ${castMv}-mana spell. Change the mana value to see the same cards re-sorted.</p>`;
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
