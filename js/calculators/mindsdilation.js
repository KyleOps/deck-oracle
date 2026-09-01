/**
 * Mind's Dilation Calculator
 * Computes expected mana value returned per turn from Mind's Dilation triggers.
 *
 * Card effect: Whenever an opponent casts their first spell each turn, that player
 * exiles the top card of their library. If it's a nonland card, you may cast it
 * without paying its mana cost.
 *
 * Optional modifier: The Sixth Doctor — double the effective MV of all historic
 * (artifact, legendary, or saga) spells.
 */

import * as OpponentState from '../utils/opponentState.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { buildDeckFromCardData } from '../utils/sampleSimulator.js';

// Example opponents for quick load
export const EXAMPLE_OPPONENTS = [
    'https://moxfield.com/decks/NVsnEkQ3y02ATHYk6n1pTA',
    'https://moxfield.com/decks/Vpiz7R8Rfk-0J7yX0AUQtA',
    'https://moxfield.com/decks/KP_jB2nYqUmQHVjYQeldyA'
];

let sixthDoctorEnabled = false;

// Stable sample exile events per opponent (seeded on import, reshuffled on demand)
const stableSamples = {
    opponent1: [],
    opponent2: [],
    opponent3: []
};

/**
 * Check if a card type_line is historic (artifact, legendary, or saga)
 */
function isHistoric(typeLine) {
    const lower = (typeLine || '').toLowerCase();
    return lower.includes('artifact') || lower.includes('legendary') || lower.includes('saga');
}

/**
 * Calculate Mind's Dilation analytical stats for one opponent deck.
 * No Monte Carlo needed — top card is uniform random, so we integrate analytically.
 * @param {Object} opponentData - Deck data with cardsByName
 * @param {boolean} sixthDoctor - Whether to double effective MV of historic spells
 * @returns {Object|null}
 */
export function calculateMindsDilationStats(opponentData, sixthDoctor = false) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) {
        return null;
    }

    const { cardsByName } = opponentData;

    let landCount = 0;
    let nonlandCount = 0;
    let historicCount = 0;
    let totalHistoricMV = 0;
    let totalNonHistoricMV = 0;
    const mvBuckets = {}; // effective MV bucket → card count

    for (const card of Object.values(cardsByName)) {
        const count = card.count || 1;
        const typeLower = (card.type_line || '').toLowerCase();
        const cmc = card.cmc ?? 0;

        if (typeLower.includes('land')) {
            landCount += count;
        } else {
            nonlandCount += count;
            const historic = isHistoric(card.type_line);
            const effectiveMV = sixthDoctor && historic ? cmc * 2 : cmc;

            if (historic) {
                historicCount += count;
                totalHistoricMV += cmc * count;
            } else {
                totalNonHistoricMV += cmc * count;
            }

            const bucket = Math.min(Math.round(effectiveMV), 14);
            mvBuckets[bucket] = (mvBuckets[bucket] || 0) + count;
        }
    }

    const total = landCount + nonlandCount;
    const pNonland = total > 0 ? nonlandCount / total : 0;

    const totalEffectiveMV = sixthDoctor
        ? (totalHistoricMV * 2 + totalNonHistoricMV)
        : (totalHistoricMV + totalNonHistoricMV);
    const avgEffectiveMV = nonlandCount > 0 ? totalEffectiveMV / nonlandCount : 0;
    const evPerTrigger = pNonland * avgEffectiveMV;

    return {
        pNonland,
        avgEffectiveMV,
        evPerTrigger,
        landCount,
        nonlandCount,
        historicCount,
        mvBuckets,
        deckSize: total
    };
}

/**
 * Generate or reuse stable sample exile events for one opponent.
 * Returns an array of card objects from the deck.
 */
function getSampleExiles(opponentKey, count = 7) {
    const data = OpponentState.getOpponentData(opponentKey);
    if (!data?.cardsByName) return [];

    if (!stableSamples[opponentKey] || stableSamples[opponentKey].length === 0) {
        const deck = buildDeckFromCardData(data);
        if (!deck || deck.length === 0) return [];
        stableSamples[opponentKey] = [];
        for (let i = 0; i < count; i++) {
            stableSamples[opponentKey].push(deck[Math.floor(Math.random() * deck.length)]);
        }
    }
    return stableSamples[opponentKey].slice(0, count);
}

/**
 * Regenerate stable samples for all opponents with data.
 */
function refreshSamples() {
    for (const key of Object.keys(stableSamples)) {
        stableSamples[key] = [];
    }
    updateUI();
}

// ==================== UI RENDERING ====================

export function updateUI() {
    renderLeft();
    renderCenter();
    renderRight();
}

function renderLeft() {
    const el = document.getElementById('mnds-left-content');
    if (!el) return;

    const opponentsWithData = OpponentState.getOpponentsWithData();

    let html = '';

    if (opponentsWithData.length === 0) {
        html += `<div style="padding:20px 16px; color:var(--tx-dim); font-size:10px;">
            Import opponent decklists to see per-deck breakdown.
        </div>`;
        el.innerHTML = html;
        return;
    }

    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        const stats = calculateMindsDilationStats(data, sixthDoctorEnabled);
        if (!stats) continue;

        const historicPct = stats.nonlandCount > 0
            ? (stats.historicCount / stats.nonlandCount * 100).toFixed(0)
            : '0';

        html += `<div style="padding:12px 16px; border-bottom:1px solid var(--tx-rule);">
            <div style="font-size:9px; letter-spacing:0.1em; color:var(--tx-amber); margin-bottom:6px;">${data.name.toUpperCase()}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; font-size:10px;">
                <div style="color:var(--tx-dim);">DECK <span style="color:var(--tx-text);">${stats.deckSize}</span></div>
                <div style="color:var(--tx-dim);">LANDS <span style="color:var(--tx-text);">${stats.landCount}</span></div>
                <div style="color:var(--tx-dim);">NONLAND <span style="color:var(--tx-text);">${stats.nonlandCount}</span></div>
                <div style="color:var(--tx-dim);">HISTORIC <span style="color:var(--tx-text);">${historicPct}%</span></div>
                <div style="color:var(--tx-dim);">P(HIT) <span style="color:var(--tx-green);">${(stats.pNonland * 100).toFixed(1)}%</span></div>
                <div style="color:var(--tx-dim);">AVG MV <span style="color:var(--tx-blue);">${stats.avgEffectiveMV.toFixed(2)}</span></div>
            </div>
        </div>`;
    }

    el.innerHTML = html;
}

let mndChart = null;

function renderCenter() {
    const heroContainer = document.getElementById('mnds-hero');
    const tableContainer = document.getElementById('mnds-table');

    const opponentsWithData = OpponentState.getOpponentsWithData();

    let totalEVPerRound = 0;
    const allStats = [];

    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        const stats = calculateMindsDilationStats(data, sixthDoctorEnabled);
        if (stats) {
            allStats.push({ data, stats });
            totalEVPerRound += stats.evPerTrigger;
        }
    }

    if (heroContainer) {
        if (allStats.length === 0) {
            heroContainer.innerHTML = `
                <div class="tx-stat"><div class="tx-stat-label">E[MV / ROUND]</div><div class="tx-stat-value" style="color:var(--tx-blue);">—</div><div class="tx-stat-sub">all opponents</div></div>
                <div class="tx-stat"><div class="tx-stat-label">E[MV / 10T]</div><div class="tx-stat-value medium" style="color:var(--tx-green);">—</div><div class="tx-stat-sub">projected 10 turns</div></div>
                <div class="tx-stat" style="border-right:none;"><div class="tx-stat-label">SIXTH DOCTOR</div><div class="tx-stat-value medium" style="color:var(--tx-dim);">OFF</div><div class="tx-stat-sub">historic ×2 MV</div></div>
            `;
        } else {
            heroContainer.innerHTML = `
                <div class="tx-stat"><div class="tx-stat-label">E[MV / ROUND]</div><div class="tx-stat-value" style="color:var(--tx-blue);">${totalEVPerRound.toFixed(2)}</div><div class="tx-stat-sub">all opponents</div></div>
                <div class="tx-stat"><div class="tx-stat-label">E[MV / 10T]</div><div class="tx-stat-value medium" style="color:var(--tx-green);">${(totalEVPerRound * 10).toFixed(1)}</div><div class="tx-stat-sub">projected 10 turns</div></div>
                <div class="tx-stat" style="border-right:none;"><div class="tx-stat-label">SIXTH DOCTOR</div><div class="tx-stat-value medium" style="color:${sixthDoctorEnabled ? 'var(--tx-amber)' : 'var(--tx-dim)'};">${sixthDoctorEnabled ? 'ON' : 'OFF'}</div><div class="tx-stat-sub">historic ×2 MV</div></div>
            `;
        }
    }

    if (tableContainer) {
        if (allStats.length === 0) {
            tableContainer.innerHTML = `<div style="padding:20px; color:var(--tx-dim); font-size:10px; text-align:center;">Import opponent decklists to see analysis.</div>`;
        } else {
            let rows = '';
            for (const { data, stats } of allStats) {
                const name = data.name.length > 18 ? data.name.slice(0, 17) + '…' : data.name;
                rows += `<tr style="border-bottom:1px solid var(--tx-rule);">
                    <td style="padding:5px 8px; color:var(--tx-amber);">${name}</td>
                    <td style="padding:5px 8px; text-align:center;">${(stats.pNonland * 100).toFixed(1)}%</td>
                    <td style="padding:5px 8px; text-align:center; color:var(--tx-blue);">${stats.avgEffectiveMV.toFixed(2)}</td>
                    <td style="padding:5px 8px; text-align:center; color:var(--tx-green);">${stats.evPerTrigger.toFixed(2)}</td>
                    <td style="padding:5px 8px; text-align:center; color:var(--tx-green);">${(stats.evPerTrigger * 10).toFixed(1)}</td>
                </tr>`;
            }
            rows += `<tr style="border-top:1px solid var(--tx-rule); color:var(--tx-bright); font-weight:500;">
                <td style="padding:5px 8px;">TOTAL</td>
                <td></td><td></td>
                <td style="padding:5px 8px; text-align:center; color:var(--tx-green);">${totalEVPerRound.toFixed(2)}</td>
                <td style="padding:5px 8px; text-align:center; color:var(--tx-green);">${(totalEVPerRound * 10).toFixed(1)}</td>
            </tr>`;

            tableContainer.innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:10px; font-family:inherit;">
                <thead><tr style="color:var(--tx-dim); border-bottom:1px solid var(--tx-rule);">
                    <th style="text-align:left; padding:5px 8px; font-weight:500; letter-spacing:0.08em;">OPPONENT</th>
                    <th style="padding:5px 8px; font-weight:500; letter-spacing:0.08em;">P(HIT)</th>
                    <th style="padding:5px 8px; font-weight:500; letter-spacing:0.08em;">AVG MV</th>
                    <th style="padding:5px 8px; font-weight:500; letter-spacing:0.08em;">E[MV/T]</th>
                    <th style="padding:5px 8px; font-weight:500; letter-spacing:0.08em;">×10T</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        }
    }

    renderChart(allStats);
}

function renderChart(allStats) {
    const canvas = document.getElementById('mnds-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (mndChart) {
        mndChart.destroy();
        mndChart = null;
    }

    if (allStats.length === 0) return;

    const colorValues = ['#7d8a92', '#55c97f', '#f0a92c'];
    const labels = Array.from({ length: 13 }, (_, i) => i === 12 ? '12+' : String(i));

    const datasets = allStats.map(({ data, stats }, idx) => {
        const buckets = new Array(13).fill(0);
        for (const [mv, count] of Object.entries(stats.mvBuckets)) {
            buckets[Math.min(parseInt(mv), 12)] += count;
        }
        const total = buckets.reduce((a, b) => a + b, 0);
        const pctData = buckets.map(c => total > 0 ? parseFloat((c / total * 100).toFixed(2)) : 0);
        const color = colorValues[idx % colorValues.length];

        return {
            label: data.name,
            data: pctData,
            borderColor: color,
            backgroundColor: color + '18',
            borderWidth: 1.5,
            tension: 0.25,
            pointRadius: 2.5,
            pointHoverRadius: 4
        };
    });

    mndChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: allStats.length > 1,
                    labels: { color: '#939c97', font: { size: 9 }, boxWidth: 12 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'mana value', color: '#808b85', font: { size: 9 } }
                },
                y: {
                    title: { display: true, text: '% of nonland cards', color: '#808b85', font: { size: 9 } },
                    ticks: { callback: (v) => v.toFixed(0) + '%' }
                }
            }
        }
    });
}

function renderRight() {
    const el = document.getElementById('mnds-samples');
    if (!el) return;

    const opponentsWithData = OpponentState.getOpponentsWithData();

    if (opponentsWithData.length === 0) {
        el.innerHTML = `<div style="padding:20px 16px; color:var(--tx-dim); font-size:10px;">Import opponent decklists to see sample exile events.</div>`;
        return;
    }

    let html = '';

    for (const opp of opponentsWithData) {
        const data = OpponentState.getOpponentData(opp);
        if (!data) continue;

        html += `<div style="border-bottom:1px solid var(--tx-rule); padding-bottom:4px; margin-bottom:4px;">
            <div style="padding:8px 16px 4px; font-size:9px; letter-spacing:0.1em; color:var(--tx-amber);">${data.name.toUpperCase()}</div>`;

        const samples = getSampleExiles(opp, 7);
        for (let i = 0; i < samples.length; i++) {
            const card = samples[i];
            const isLand = card.types.includes('land');
            const historic = !isLand && isHistoric(card.type_line || '');
            const rawMV = card.cmc ?? 0;
            const effectiveMV = sixthDoctorEnabled && historic ? rawMV * 2 : rawMV;
            const label = isLand ? 'LAND ✗' : 'CAST ✓';
            const labelColor = isLand ? 'var(--tx-red)' : 'var(--tx-green)';

            html += `<div style="padding:4px 16px; border-bottom:1px solid var(--tx-rule); font-size:10px; display:flex; align-items:center; gap:8px;">
                <span style="color:var(--tx-dim); font-size:9px; min-width:14px;">${i + 1}.</span>
                <span style="color:${labelColor}; font-size:9px; min-width:42px; letter-spacing:0.06em;">${label}</span>
                <span style="color:var(--tx-text); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${card.name}">${card.name}</span>
                ${!isLand ? `<span style="color:var(--tx-blue); font-size:9px; min-width:36px; text-align:right;">MV=${effectiveMV}</span>` : ''}
                ${historic && sixthDoctorEnabled ? '<span style="color:var(--tx-amber); font-size:8px; margin-left:2px;">★</span>' : ''}
            </div>`;
        }

        html += `</div>`;
    }

    el.innerHTML = html;
}

// ==================== EXPORTS ====================

export function calculate() {
    const results = {};
    for (const opp of OpponentState.getActiveOpponents()) {
        const data = OpponentState.getOpponentData(opp);
        if (data?.cardsByName && Object.keys(data.cardsByName).length > 0) {
            const stats = calculateMindsDilationStats(data, sixthDoctorEnabled);
            if (stats) results[opp] = stats;
        }
    }
    return results;
}

export function init() {
    OpponentState.onOpponentChange(() => {
        for (const key of Object.keys(stableSamples)) {
            stableSamples[key] = [];
        }
        updateUI();
    });

    registerCalculator({
        name: 'mindsdilation',
        calculate,
        updateUI,
        init: () => {
            // Sixth Doctor toggle
            const toggle = document.getElementById('mnds-sixth-doctor');
            if (toggle) {
                toggle.addEventListener('change', () => {
                    sixthDoctorEnabled = toggle.checked;
                    updateUI();
                });
            }

            // Resample button
            const reshuffleBtn = document.getElementById('mnds-resample-btn');
            if (reshuffleBtn) {
                reshuffleBtn.addEventListener('click', refreshSamples);
            }

            updateUI();
        }
    });
}

export function getOpponentUrls() {
    return OpponentState.getOpponentUrls();
}

export async function setOpponentUrl(opponentKey, url) {
    return OpponentState.setOpponentUrl(opponentKey, url);
}
