/**
 * Abstract Performance — {5}{U} Sorcery
 *
 * "Exile the top four cards of your library in a face-down pile, then exile the
 * top four cards of your library in a face-up pile. An opponent chooses one of
 * those piles. Put that pile into your graveyard. Look at the cards in the
 * other pile. You may cast a spell from among them without paying its mana
 * cost. Put the rest into your hand."
 *
 * Simulated: deal two piles of four from a shuffled copy of the library and
 * record the best spell you could cast free from the pile you keep, under three
 * opponents:
 *   - guesses right: knows both piles and bins the one with more total mana value
 *   - guesses wrong: bins the one with less (your best case)
 *   - realistic: sees only the face-up pile, and bins it when it is worth more
 *     than an average four cards; otherwise bins the unseen face-down pile
 */

import { partialShuffle } from '../utils/simulation.js';
import { createOrUpdateChart, TX_CHART as TX } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderHeroStats, renderBottomLine } from '../utils/components.js';
import { buildDeckFromCardData, renderDistributionChart } from '../utils/sampleSimulator.js';
import { percentileFromDist } from '../utils/discover.js';
import { cardRef } from '../data/glossary.js';

export const ITERATIONS = 25000;
export const PILE_SIZE = 4;
export const SAMPLE_CASTS = 4;

/** Histogram buckets: mana value 0..9, then 10+. */
const BUCKETS = 11;

/** Fallback curve when no decklist is loaded (~99-card Commander deck). */
const DEFAULT_DIST = [
    { cmc: 0, count: 36, isLand: true },
    { cmc: 1, count: 10, isLand: false },
    { cmc: 2, count: 15, isLand: false },
    { cmc: 3, count: 12, isLand: false },
    { cmc: 4, count: 10, isLand: false },
    { cmc: 5, count: 8, isLand: false },
    { cmc: 6, count: 5, isLand: false },
    { cmc: 7, count: 3, isLand: false }
];

let chart = null;

// ==================== PURE LOGIC ====================

/**
 * The library as {name, cmc, isLand}, one entry per copy, lands included.
 *
 * Built from cardsByName (every card, with names). The previous version read
 * `cardDetails`, which the importer fills with NONLAND cards only — so every
 * simulated pile was dealt from a deck with no lands, inflating the free spell
 * and making "all lands, nothing to cast" impossible.
 *
 * @param {Object} cardsByName
 * @returns {{deck:Array<{name:string, cmc:number, isLand:boolean}>, isDefault:boolean}}
 */
export function buildLibrary(cardsByName) {
    const names = Object.keys(cardsByName ?? {});
    if (names.length > 0) {
        const deck = buildDeckFromCardData({ cardsByName }).map(card => ({
            name: card.name,
            cmc: Math.max(0, Math.floor(Number(card.cmc) || 0)),
            isLand: card.types.includes('land'),
            isX: /\{X\}/i.test(card.mana_cost ?? '')
        }));
        if (deck.length >= PILE_SIZE * 2) return { deck, isDefault: false };
    }
    const deck = [];
    for (const { cmc, count, isLand } of DEFAULT_DIST) {
        for (let i = 0; i < count; i++) deck.push({ name: isLand ? 'Land' : 'Spell', cmc, isLand });
    }
    return { deck, isDefault: true };
}

function totalMV(pile) {
    return pile.reduce((sum, card) => sum + (card?.cmc ?? 0), 0);
}

/**
 * The highest mana value of any nonland card in the pile (0 if none).
 * @param {Array} pile
 * @returns {number}
 */
export function bestFreeCastMV(pile) {
    let max = 0;
    for (const card of pile) {
        if (!card.isLand && (card.cmc ?? 0) > max) max = card.cmc;
    }
    return max;
}

/** The card you would cast from a pile (highest mana value nonland), or null. */
export function bestFreeCast(pile) {
    let best = null;
    for (const card of pile) {
        if (card.isLand) continue;
        if (!best || (card.cmc ?? 0) > (best.cmc ?? 0)) best = card;
    }
    return best;
}

/**
 * Which pile a face-up-only opponent bins. They cannot see the face-down pile,
 * so they compare the face-up pile with an average four cards and bin it when
 * it looks better than that.
 *
 * @returns {boolean} true when they bin the face-up pile (you keep face-down)
 */
export function opponentBinsFaceUp(faceUp, expectedFourMV) {
    return totalMV(faceUp) > expectedFourMV;
}

function histogramStats(hist, sum, n) {
    return {
        mean: n ? sum / n : 0,
        dist: hist.map(c => (n ? c / n : 0)),
        p25: percentileFromDist(hist, 0.25),
        p50: percentileFromDist(hist, 0.5),
        p75: percentileFromDist(hist, 0.75)
    };
}

/**
 * Monte Carlo over the three opponent models. Means use exact mana values;
 * the distributions fold 10 and above into one "10+" bucket.
 *
 * @param {Array<{name:string, cmc:number, isLand:boolean}>} deck
 * @param {number} iterations
 * @returns {{best:Object, worst:Object, realistic:Object, deckSize:number, expectedFourMV:number}|null}
 */
export function simulateAbstractPerformance(deck, iterations) {
    const deckSize = Array.isArray(deck) ? deck.length : 0;
    if (deckSize < PILE_SIZE * 2) return null;
    const n = Math.max(0, Math.floor(Number(iterations) || 0));

    const totalDeckMV = deck.reduce((s, c) => s + (c.cmc ?? 0), 0);
    // Expected total mana value of four random cards: the realistic opponent's yardstick.
    const expectedFourMV = (totalDeckMV / deckSize) * PILE_SIZE;

    const best = new Array(BUCKETS).fill(0);
    const worst = new Array(BUCKETS).fill(0);
    const realistic = new Array(BUCKETS).fill(0);
    const sums = { best: 0, worst: 0, realistic: 0 };
    const record = (hist, key, v) => { hist[Math.min(v, BUCKETS - 1)]++; sums[key] += v; };

    // A partial Fisher–Yates over any permutation yields a uniformly random
    // ordered sample, so one working copy is reshuffled in place each time.
    const d = deck.slice();
    for (let i = 0; i < n; i++) {
        partialShuffle(d, PILE_SIZE * 2, deckSize);
        const faceDown = d.slice(0, PILE_SIZE);
        const faceUp = d.slice(PILE_SIZE, PILE_SIZE * 2);
        const mvFD = totalMV(faceDown);
        const mvFU = totalMV(faceUp);
        const richer = mvFD >= mvFU ? faceDown : faceUp;
        const poorer = richer === faceDown ? faceUp : faceDown;

        record(best, 'best', bestFreeCastMV(richer));
        record(worst, 'worst', bestFreeCastMV(poorer));
        record(realistic, 'realistic', bestFreeCastMV(mvFU > expectedFourMV ? faceDown : faceUp));
    }

    return {
        best: histogramStats(best, sums.best, n),
        worst: histogramStats(worst, sums.worst, n),
        realistic: histogramStats(realistic, sums.realistic, n),
        deckSize,
        expectedFourMV
    };
}

/**
 * Deal sample casts: both piles, which one the realistic opponent bins, and
 * what you cast from the other.
 */
export function dealSampleCasts(deck, count = SAMPLE_CASTS) {
    if (!Array.isArray(deck) || deck.length < PILE_SIZE * 2) return [];
    const expectedFourMV = (totalMV(deck) / deck.length) * PILE_SIZE;
    const d = deck.slice();
    const out = [];
    for (let i = 0; i < count; i++) {
        partialShuffle(d, PILE_SIZE * 2, d.length);
        const faceDown = d.slice(0, PILE_SIZE);
        const faceUp = d.slice(PILE_SIZE, PILE_SIZE * 2);
        const binsFaceUp = opponentBinsFaceUp(faceUp, expectedFourMV);
        const kept = binsFaceUp ? faceDown : faceUp;
        out.push({
            faceDown, faceUp, binsFaceUp, expectedFourMV,
            faceUpMV: totalMV(faceUp),
            cast: bestFreeCast(kept)
        });
    }
    return out;
}

const one = v => (Number.isFinite(v) ? v.toFixed(1) : '—');
const pct = v => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`;
const mvLabel = v => (v >= BUCKETS - 1 ? `${BUCKETS - 1}+` : String(v));

/** Tone of the realistic outcome: a free spell of 4+ is a strong return on six mana. */
export function outcomeTone(mean) {
    if (mean >= 4) return 'good';
    if (mean >= 2.5) return 'warn';
    return 'bad';
}

/**
 * The plain-English answer to "What will your opponent leave you from the two piles?".
 * @param {{results:Object|null, isDefault?:boolean}} input
 * @returns {{html:string, tone:string}}
 */
export function summarize({ results, isDefault = false } = {}) {
    if (!results) {
        return { tone: 'flat', html: 'Abstract Performance needs at least eight cards in your library to deal two piles.' };
    }
    const r = results.realistic;
    const range = r.p25 === r.p75 ? '' : ` (half of casts ${mvLabel(r.p25)}–${mvLabel(r.p75)})`;
    const deckWord = isDefault ? 'In a typical Commander deck, an' : 'An';
    const nothing = r.dist[0] ?? 0;
    let html = `${deckWord} opponent who can only see the face-up pile usually leaves you a free <strong>${mvLabel(r.p50)}-mana</strong> spell${range}, and the other three cards go to your hand. `
        + `If they always pick right you still average <strong>${one(results.worst.mean)}</strong>; if they pick wrong, <strong>${one(results.best.mean)}</strong>.`;
    if (nothing >= 0.005) html += ` About ${pct(nothing)} of casts leave you nothing to cast.`;
    return { html, tone: outcomeTone(r.mean) };
}

// ==================== STATE ====================

const state = { ref: null, deck: null, isDefault: true, results: null, samples: [] };

/** Simulate once per deck (the deck object is replaced on every import). */
export function calculate() {
    const cardsByName = DeckConfig.getImportedCardData()?.cardsByName ?? null;
    if (state.ref !== cardsByName || !state.deck) {
        const { deck, isDefault } = buildLibrary(cardsByName);
        state.ref = cardsByName;
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
            <p class="ap-caption">Your library of ${state.deck.length}${state.isDefault ? ' (a typical deck — no decklist loaded)' : ''}. Lands and cheap spells are what make a pile look weak.</p>
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
