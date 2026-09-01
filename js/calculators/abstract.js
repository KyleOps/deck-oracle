/**
 * Abstract Performance Calculator
 * Simulates the "blind pick" mechanic: face-down vs face-up pile choice
 * by opponent with partial information.
 */

import { partialShuffle, debounce } from '../utils/simulation.js';
import { createOrUpdateChart } from '../utils/chartHelpers.js';
import * as DeckConfig from '../utils/deckConfig.js';

const CONFIG = {
    ITERATIONS: 25000,
    PILE_SIZE: 4,
};

const COLORS = {
    best: '#55c97f',
    realistic: '#f0a92c',
    worst: '#e8635c',
    bestDim: 'rgba(85,201,127,0.08)',
    realisticDim: 'rgba(240,169,44,0.08)',
    worstDim: 'rgba(232,99,92,0.08)',
    text: '#808b85',
    grid: '#1e221f',
};

// Default CMC distribution for when no deck is imported (~99-card commander)
const DEFAULT_DIST = [
    { cmc: 0, count: 36, isLand: true },
    { cmc: 1, count: 10, isLand: false },
    { cmc: 2, count: 15, isLand: false },
    { cmc: 3, count: 12, isLand: false },
    { cmc: 4, count: 10, isLand: false },
    { cmc: 5, count: 8, isLand: false },
    { cmc: 6, count: 5, isLand: false },
    { cmc: 7, count: 3, isLand: false },
];

function buildDefaultDeck() {
    const deck = [];
    for (const { cmc, count, isLand } of DEFAULT_DIST) {
        for (let i = 0; i < count; i++) {
            deck.push({ name: isLand ? 'Land' : `Spell`, cmc, isLand });
        }
    }
    return deck;
}

function buildDeck(config) {
    const { cardDetails } = config;
    if (cardDetails && cardDetails.length > 0) {
        return cardDetails.map(card => ({
            name: card.name || 'Unknown',
            cmc: card.cmc ?? 0,
            isLand: (card.type || '').toLowerCase().includes('land'),
        }));
    }
    return buildDefaultDeck();
}

function totalMV(pile) {
    return pile.reduce((sum, card) => sum + (card?.cmc ?? 0), 0);
}

/**
 * Returns the highest CMC of any non-land card in the pile.
 * Returns 0 if no non-land cards exist.
 * @param {Array} pile
 * @returns {number}
 */
export function bestFreeCastMV(pile) {
    let max = 0;
    for (const card of pile) {
        if (!card.isLand && (card.cmc ?? 0) > max) {
            max = card.cmc;
        }
    }
    return max;
}

/**
 * Core Monte Carlo simulation for Abstract Performance.
 * @param {Array} deck - Array of { name, cmc, isLand }
 * @param {number} iterations
 * @returns {{ best, worst, realistic, deckSize, expectedFourMV } | null}
 */
export function simulateAbstractPerformance(deck, iterations) {
    const deckSize = deck.length;
    if (deckSize < CONFIG.PILE_SIZE * 2) return null;

    const totalDeckMV = deck.reduce((s, c) => s + (c.cmc ?? 0), 0);
    // Expected total MV of any 4 randomly drawn cards (opponent's baseline for face-down)
    const expectedFourMV = (totalDeckMV / deckSize) * CONFIG.PILE_SIZE;

    const bestArr = [];
    const worstArr = [];
    const realisticArr = [];

    for (let i = 0; i < iterations; i++) {
        const d = deck.slice(); // copy
        partialShuffle(d, CONFIG.PILE_SIZE * 2, deckSize);
        const faceDown = d.slice(0, CONFIG.PILE_SIZE);
        const faceUp = d.slice(CONFIG.PILE_SIZE, CONFIG.PILE_SIZE * 2);

        const mvFD = totalMV(faceDown);
        const mvFU = totalMV(faceUp);

        // Best case: opponent always wrong — you keep the higher-MV pile
        bestArr.push(bestFreeCastMV(mvFD >= mvFU ? faceDown : faceUp));

        // Worst case: opponent always right — you keep the lower-MV pile
        worstArr.push(bestFreeCastMV(mvFD >= mvFU ? faceUp : faceDown));

        // Realistic: opponent sees face-up, sends it to GY if it looks above expected
        // Opponent's goal: deny you the better free cast
        const realisticKept = mvFU > expectedFourMV ? faceDown : faceUp;
        realisticArr.push(bestFreeCastMV(realisticKept));
    }

    function stats(arr) {
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        // Build histogram buckets: MV 0..9, 10+
        const BUCKETS = 11;
        const hist = new Array(BUCKETS).fill(0);
        for (const v of arr) {
            hist[Math.min(v, BUCKETS - 1)]++;
        }
        const dist = hist.map(c => c / arr.length);
        return { mean, dist };
    }

    return {
        best: stats(bestArr),
        worst: stats(worstArr),
        realistic: stats(realisticArr),
        deckSize,
        expectedFourMV,
    };
}

// Module-level state
let chart = null;
let cachedResults = null;
let cachedDeck = null;
let lastDeckHash = '';
let stableSamples = [];

function getDeckHash(deck) {
    return `${deck.length}:${deck.reduce((s, c) => s + (c.cmc ?? 0), 0)}`;
}

function buildStableSamples(deck, count) {
    // Abstract Performance exiles two piles of four, so it needs at least eight
    // non-land cards. Below that, partialShuffle would index past the end of the
    // array and leave holes, and slicing the second pile then yielded undefined
    // entries — which threw and aborted the entire deck import.
    if (!Array.isArray(deck) || deck.length < CONFIG.PILE_SIZE * 2) return [];

    const totalDeckMV = deck.reduce((s, c) => s + (c.cmc ?? 0), 0);
    const expectedFourMV = (totalDeckMV / deck.length) * CONFIG.PILE_SIZE;
    const samples = [];
    for (let i = 0; i < count; i++) {
        const d = deck.slice();
        partialShuffle(d, CONFIG.PILE_SIZE * 2, deck.length);
        const faceDown = d.slice(0, CONFIG.PILE_SIZE);
        const faceUp = d.slice(CONFIG.PILE_SIZE, CONFIG.PILE_SIZE * 2);
        const mvFU = totalMV(faceUp);
        const mvFD = totalMV(faceDown);
        const opponentSendsUp = mvFU > expectedFourMV;
        samples.push({ faceDown, faceUp, mvFD, mvFU, opponentSendsUp, expectedFourMV });
    }
    return samples;
}

export function calculate() {
    const config = DeckConfig.getDeckConfig();
    const deck = buildDeck(config);
    const hash = getDeckHash(deck);

    if (hash === lastDeckHash && cachedResults) {
        return cachedResults;
    }

    lastDeckHash = hash;
    cachedDeck = deck;
    cachedResults = simulateAbstractPerformance(deck, CONFIG.ITERATIONS);
    stableSamples = buildStableSamples(deck, 20);
    return cachedResults;
}

export function updateUI() {
    const results = cachedResults || calculate();
    if (!results) return;

    updateHeroStats(results);
    updateChart(results);
    updateCMCCurve(cachedDeck || buildDeck(DeckConfig.getDeckConfig()));
    updateSamplePiles();
    updateBreakdownTable(results);
}

function updateHeroStats(results) {
    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val.toFixed(2);
    };
    setEl('abstract-hero-best', results.best.mean);
    setEl('abstract-hero-realistic', results.realistic.mean);
    setEl('abstract-hero-worst', results.worst.mean);
}

function updateChart(results) {
    const labels = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
    chart = createOrUpdateChart(chart, 'abstract-chart', {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'BEST',
                    data: results.best.dist.map(v => +(v * 100).toFixed(2)),
                    borderColor: COLORS.best,
                    backgroundColor: COLORS.bestDim,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.25,
                    fill: false,
                },
                {
                    label: 'REALISTIC',
                    data: results.realistic.dist.map(v => +(v * 100).toFixed(2)),
                    borderColor: COLORS.realistic,
                    backgroundColor: COLORS.realisticDim,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.25,
                    fill: false,
                },
                {
                    label: 'WORST',
                    data: results.worst.dist.map(v => +(v * 100).toFixed(2)),
                    borderColor: COLORS.worst,
                    backgroundColor: COLORS.worstDim,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.25,
                    fill: false,
                },
            ],
        },
        options: {
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'FREE CAST MV',
                        color: COLORS.text,
                        font: { size: 9 },
                    },
                    ticks: { color: COLORS.text },
                    grid: { color: COLORS.grid },
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: '%',
                        color: COLORS.text,
                        font: { size: 9 },
                    },
                    ticks: { color: COLORS.text, callback: v => v + '%' },
                    grid: { color: COLORS.grid },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#939c97', font: { size: 9 }, boxWidth: 10, padding: 12 },
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
                    },
                },
            },
        },
    });
}

function updateCMCCurve(deck) {
    const el = document.getElementById('abstract-cmc-curve');
    if (!el || !deck) return;

    const BUCKETS = 8;
    const counts = new Array(BUCKETS).fill(0);
    for (const card of deck) {
        counts[Math.min(card.cmc ?? 0, BUCKETS - 1)]++;
    }
    const max = Math.max(...counts, 1);

    el.innerHTML = counts.map((count, cmc) => {
        const pct = (count / max) * 100;
        const label = cmc === 0 ? 'L/0' : cmc === BUCKETS - 1 ? `${cmc}+` : String(cmc);
        return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; font-size:10px;">
            <span style="width:22px; text-align:right; color:var(--tx-dim); letter-spacing:0.05em;">${label}</span>
            <div style="flex:1; height:5px; background:var(--tx-rule); overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:var(--tx-amber); opacity:0.55; transition:width 0.2s;"></div>
            </div>
            <span style="width:22px; color:var(--tx-mid); text-align:right;">${count}</span>
        </div>`;
    }).join('');

    const nLabel = document.getElementById('abstract-n-label');
    if (nLabel) nLabel.textContent = `N=${deck.length}`;
}

function cardLabel(card) {
    if (!card) return '?';
    const name = card.name ? card.name.slice(0, 16) : 'Unknown';
    const mv = card.isLand ? 'L' : String(card.cmc ?? 0);
    return `<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</span><span style="color:var(--tx-dim); margin-left:4px;">${mv}</span>`;
}

function updateSamplePiles() {
    const container = document.getElementById('abstract-samples');
    if (!container) return;

    if (!stableSamples.length) {
        container.innerHTML = '<div style="padding:20px 16px; color:var(--tx-dim); font-size:10px;">Import a decklist to see sample piles.</div>';
        return;
    }

    const html = stableSamples.slice(0, 4).map((sample, idx) => {
        const { faceDown, faceUp, opponentSendsUp, mvFD, mvFU, expectedFourMV } = sample;
        const keptPile = opponentSendsUp ? faceDown : faceUp;
        const freeMV = bestFreeCastMV(keptPile);
        const freeCard = keptPile.find(c => !c.isLand && (c.cmc ?? 0) === freeMV);
        const freeLabel = freeMV > 0
            ? `✓ MV=${freeMV}${freeCard ? ' · ' + freeCard.name.slice(0, 10) : ''}`
            : 'FIZZ';
        const freeColor = freeMV > 0 ? 'var(--tx-green)' : 'var(--tx-dim)';

        const pileRow = (cards, faceDownStyle) => cards.map(c =>
            `<div style="display:flex; font-size:10px; padding:2px 0; color:${faceDownStyle ? 'var(--tx-mid)' : 'var(--tx-text)'}; gap:4px;">
                ${faceDownStyle
                    ? `<span style="color:var(--tx-rule);">▓▓▓▓▓▓▓▓▓▓▓▓▓▓</span>`
                    : cardLabel(c)
                }
            </div>`
        ).join('');

        const fdLabel = opponentSendsUp ? 'FACE-DOWN · KEPT' : 'FACE-DOWN → GY';
        const fuLabel = opponentSendsUp ? 'FACE-UP → GY' : 'FACE-UP · KEPT';
        const fdLabelColor = opponentSendsUp ? 'var(--tx-green)' : 'var(--tx-red)';
        const fuLabelColor = opponentSendsUp ? 'var(--tx-red)' : 'var(--tx-green)';

        return `<div style="border-bottom:1px solid var(--tx-rule); padding:12px 16px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:9px; letter-spacing:0.1em;">
                <span style="color:var(--tx-dim);">TRIAL ${idx + 1}</span>
                <span style="color:${freeColor};">${freeLabel}</span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px;">
                <div>
                    <div style="font-size:9px; color:${fdLabelColor}; letter-spacing:0.08em; margin-bottom:4px;">${fdLabel}</div>
                    ${pileRow(faceDown, opponentSendsUp)}
                </div>
                <div>
                    <div style="font-size:9px; color:${fuLabelColor}; letter-spacing:0.08em; margin-bottom:4px;">${fuLabel}</div>
                    ${pileRow(faceUp, !opponentSendsUp)}
                </div>
            </div>
            <div style="font-size:9px; border-top:1px solid var(--tx-rule); padding-top:6px; color:var(--tx-dim);">
                FU MV=${mvFU.toFixed(1)} ${opponentSendsUp ? '>' : '≤'} E[${expectedFourMV.toFixed(1)}]
                · OPP SENDS ${opponentSendsUp ? 'FACE-UP' : 'FACE-DOWN'}
            </div>
        </div>`;
    }).join('');

    container.innerHTML = html;
}

function updateBreakdownTable(results) {
    const el = document.getElementById('abstract-breakdown');
    if (!el) return;

    const rows = Array.from({ length: 11 }, (_, mv) => {
        const label = mv === 10 ? '10+' : String(mv);
        const b = (results.best.dist[mv] * 100).toFixed(1);
        const r = (results.realistic.dist[mv] * 100).toFixed(1);
        const w = (results.worst.dist[mv] * 100).toFixed(1);
        return `<tr style="border-bottom:1px solid var(--tx-rule);">
            <td style="color:var(--tx-mid); padding:3px 0;">${label}</td>
            <td style="color:var(--tx-green); text-align:right;">${b}%</td>
            <td style="color:var(--tx-amber); text-align:right;">${r}%</td>
            <td style="color:var(--tx-red); text-align:right;">${w}%</td>
        </tr>`;
    }).join('');

    el.innerHTML = `<table style="width:100%; font-size:10px; border-collapse:collapse;">
        <thead>
            <tr style="font-size:9px; letter-spacing:0.1em; border-bottom:1px solid var(--tx-rule);">
                <th style="text-align:left; padding-bottom:6px; color:var(--tx-dim);">MV</th>
                <th style="text-align:right; padding-bottom:6px; color:var(--tx-green);">BEST</th>
                <th style="text-align:right; padding-bottom:6px; color:var(--tx-amber);">REALISTIC</th>
                <th style="text-align:right; padding-bottom:6px; color:var(--tx-red);">WORST</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

export function init() {
    calculate();
    updateUI();

    DeckConfig.onDeckUpdate(() => {
        lastDeckHash = '';
        cachedResults = null;
        calculate();
        updateUI();
    });

    const reshuffleBtn = document.getElementById('abstract-reshuffle-btn');
    if (reshuffleBtn) {
        reshuffleBtn.addEventListener('click', () => {
            if (cachedDeck) {
                stableSamples = buildStableSamples(cachedDeck, 20);
                updateSamplePiles();
            }
        });
    }
}
