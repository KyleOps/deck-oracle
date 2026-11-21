/**
 * Abstract Performance — {5}{U} sorcery. The page: readInputs() (the deck →
 * a plain object), the model, then rendering. The maths — three opponent
 * models over simulated piles — lives in js/utils/models/abstract.js.
 */

import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine } from '../utils/components.js';
import { renderDistributionChart } from '../utils/sampleSimulator.js';
import { libraryOf } from '../utils/library.js';
import { one, pct } from '../utils/text.js';
import { cardRef } from '../data/glossary.js';
import {
    BUCKETS, ITERATIONS, ON_STACK, buildLibrary, dealSampleCasts, mvLabel, outcomeTone, simulateAbstractPerformance, summarize
} from '../utils/models/abstract.js';

let chart = null;

// ==================== INPUTS ====================

const state = { ref: null, deck: null, isDefault: true, results: null, samples: [] };

/** The library the piles are dealt from (commanders are never in it). */
export function readInputs() {
    return { library: libraryOf(DeckConfig.getDeckConfig(), ON_STACK) };
}

/** Simulate once per deck (the deck object is replaced on every import). */
export function calculate() {
    const { library } = readInputs();
    if (state.ref !== library || !state.deck) {
        const { deck, isDefault } = buildLibrary(library);
        state.ref = library;
        state.deck = deck;
        state.isDefault = isDefault;
        state.results = simulateAbstractPerformance(deck, ITERATIONS);
        state.samples = dealSampleCasts(deck);
    }
    return state.results;
}

// ==================== RENDERING ====================

function renderHero(results) {
    const el = document.getElementById('abstract-hero');
    if (!el) return;
    const r = results.realistic;
    el.innerHTML = renderHeroStats([
        {
            label: 'Typical free spell',
            value: mvLabel(r.p50),
            sub: r.p25 === r.p75 ? 'mana value, realistic opponent' : `mana value · half of casts ${mvLabel(r.p25)}–${mvLabel(r.p75)}`,
            size: 'big',
            color: `var(--tx-${outcomeTone(r.mean)})`,
            tip: 'The median mana value of the best spell in the pile you keep, against an opponent who sees only the face-up pile.'
        },
        {
            label: 'If they pick right',
            value: one(results.worst.mean),
            sub: 'average — they bin your better pile',
            tip: 'An opponent who somehow knows both piles and always bins the one with more total mana value.'
        },
        {
            label: 'If they pick wrong',
            value: one(results.best.mean),
            sub: 'average — you keep the better pile',
            tip: 'Your best case: the opponent always bins the pile with less total mana value.'
        },
        {
            label: 'Nothing to cast',
            value: pct(r.dist[0] ?? 0),
            sub: 'kept pile has no spell',
            color: (r.dist[0] ?? 0) > 0.05 ? 'var(--tx-warn)' : 'var(--tx-bright)',
            tip: 'Casts where the pile you keep is all lands (or only zero-cost spells), realistic opponent.'
        }
    ]);
}

function updateChart(results) {
    if (!document.getElementById('abstract-chart')) return;
    const labels = Array.from({ length: BUCKETS }, (_, i) => mvLabel(i));
    const series = [
        { key: 'realistic', label: 'Realistic opponent', color: TX.amber, width: 2.5 },
        { key: 'worst', label: 'They pick right', color: TX.red, width: 1.5 },
        { key: 'best', label: 'They pick wrong', color: TX.green, width: 1.5 }
    ];
    chart = createOrUpdateChart(chart, 'abstract-chart', {
        type: 'line',
        data: {
            labels,
            datasets: series.map(s => ({
                label: s.label,
                data: results[s.key].dist.map(v => Math.round(v * 1000) / 10),
                borderColor: s.color,
                backgroundColor: s.color,
                borderWidth: s.width,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.25,
                fill: false
            }))
        },
        options: {
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: TX.mid, boxWidth: 12, boxHeight: 2, padding: 14 }
                },
                tooltip: {
                    callbacks: {
                        title: items => `Free spell of mana value ${items[0]?.label ?? ''}`,
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Mana value of the free spell', color: TX.dim } },
                y: { beginAtZero: true, ticks: { callback: v => `${v}%` }, title: { display: true, text: 'Share of casts', color: TX.dim } }
            }
        }
    });
}

function pileHTML(cards, { label, kept, cast }) {
    const rows = cards.map(card => {
        const isCast = kept && card === cast;
        const mv = card.isLand ? 'land' : String(card.cmc ?? 0);
        return `<li class="ap-card${isCast ? ' is-cast' : ''}${card.isLand ? ' is-land' : ''}">
            <span class="ap-card-name">${card.name === 'Land' || card.name === 'Spell' ? card.name : cardRef(card.name)}</span>
            <span class="ap-card-mv">${mv}</span>
        </li>`;
    }).join('');
    return `
        <div class="ap-pile ${kept ? 'is-kept' : 'is-binned'}">
            <div class="ap-pile-head"><span>${label}</span><span class="ap-pile-fate">${kept ? 'You keep' : 'Graveyard'}</span></div>
            <ul class="ap-pile-cards">${rows}</ul>
        </div>`;
}

function renderSamples() {
    const el = document.getElementById('abstract-samples');
    if (!el) return;
    if (!state.samples.length) {
        el.innerHTML = '<div class="tx-empty">Not enough cards to deal two piles.</div>';
        return;
    }
    el.innerHTML = state.samples.map((s, i) => {
        const castText = s.cast
            ? `You cast ${s.cast.name === 'Spell' ? 'a spell' : cardRef(s.cast.name)} free${s.cast.isX ? '<span class="ap-x" data-tip="Cast free, an X spell resolves with X = 0." tabindex="0">X=0</span>' : ''} <span class="ap-mv">${s.cast.cmc}</span>`
            : 'Nothing to cast — all four go to your hand';
        const why = s.binsFaceUp
            ? `The face-up pile totals ${s.faceUpMV} mana value, more than an average four cards (${one(s.expectedFourMV)}), so your opponent bins it.`
            : `The face-up pile totals ${s.faceUpMV} mana value, no more than an average four cards (${one(s.expectedFourMV)}), so your opponent bins the face-down pile instead.`;
        return `
            <article class="ap-sample">
                <div class="ap-sample-head">
                    <span class="ap-sample-n">Cast ${i + 1}</span>
                    <span class="ap-sample-cast ${s.cast ? 'is-good' : 'is-bad'}">${castText}</span>
                </div>
                <div class="ap-piles">
                    ${pileHTML(s.faceDown, { label: 'Face-down pile', kept: s.binsFaceUp, cast: s.cast })}
                    ${pileHTML(s.faceUp, { label: 'Face-up pile', kept: !s.binsFaceUp, cast: s.cast })}
                </div>
                <p class="ap-why">${why}</p>
            </article>`;
    }).join('');
}

function renderDetails(results) {
    const tableEl = document.getElementById('abstract-breakdown');
    if (tableEl) {
        const rows = Array.from({ length: BUCKETS }, (_, mv) => mv)
            .filter(mv => results.best.dist[mv] + results.realistic.dist[mv] + results.worst.dist[mv] > 0.0005);
        tableEl.innerHTML = `
            <table class="tx-sweep-table">
                <thead><tr><th class="ta-l">Free spell mana value</th><th>Realistic</th><th>They pick right</th><th>They pick wrong</th></tr></thead>
                <tbody>${rows.map(mv => `
                    <tr${mv === results.realistic.p50 ? ' class="active-row"' : ''}>
                        <td class="ta-l">${mv === 0 ? '0 (nothing)' : mvLabel(mv)}</td>
                        <td>${(results.realistic.dist[mv] * 100).toFixed(1)}%</td>
                        <td>${(results.worst.dist[mv] * 100).toFixed(1)}%</td>
                        <td>${(results.best.dist[mv] * 100).toFixed(1)}%</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    const curveEl = document.getElementById('abstract-cmc-curve');
    if (curveEl && state.deck) {
        const counts = new Array(8).fill(0);
        let lands = 0;
        for (const card of state.deck) {
            if (card.isLand) lands++;
            else counts[Math.min(card.cmc ?? 0, 7)]++;
        }
        const rows = [lands, ...counts];
        curveEl.innerHTML = `
            <p class="tx-caption">Your library of ${state.deck.length}${state.isDefault ? ' (a typical deck — no decklist loaded)' : ''}. Lands and cheap spells are what make a pile look weak.</p>
            ${renderDistributionChart(rows, state.deck.length, i => (i === 0 ? 'Lands' : i === 8 ? '7+' : `Mana value ${i - 1}`), () => null)}`;
    }
}

export function updateUI() {
    const results = calculate();
    const bottom = document.getElementById('abstract-bottom-line');
    if (bottom) bottom.innerHTML = renderBottomLine(summarize({ results, isDefault: state.isDefault }));
    const meta = document.getElementById('abstract-chart-meta');
    if (meta) meta.textContent = `${ITERATIONS.toLocaleString('en-US')} simulated casts`;
    if (!results) return;

    renderHero(results);
    updateChart(results);
    renderSamples();
    renderDetails(results);
}

export function init() {
    registerCalculator({ name: 'abstract', calculate, updateUI });
    document.getElementById('abstract-reshuffle-btn')?.addEventListener('click', () => {
        if (!state.deck) return;
        state.samples = dealSampleCasts(state.deck);
        renderSamples();
    });
}
