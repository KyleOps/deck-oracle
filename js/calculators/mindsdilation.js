/**
 * Mind's Dilation — {5}{U}{U} enchantment.
 *
 * Whenever an opponent casts their first spell each turn, that player exiles
 * the top card of their library. If it's a nonland card, you may cast it
 * without paying its mana cost.
 *
 * Exact: the exiled card is a uniformly random card of the library, so the hit
 * chance is the nonland share and the value is the average spell mana value.
 *
 * Optional: The Sixth Doctor copies the first historic spell you cast each
 * turn, so a historic free spell (artifact, legendary or Saga) counts double.
 */

import * as OpponentState from '../utils/opponentState.js';
import { registerCalculator, updateCalculatorIfActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { isLand, libraryOf } from '../utils/library.js';
import { one, pct } from '../utils/text.js';
import {
    opponentLibrary, isHistoricType, createRevealer, countWord, objectId, readOpponents,
    frameScheduler, opponentLabel, cardChip, renderOpponentPlaceholder, renderLoadingNote, bindOpponentActions
} from '../utils/opponentPages.js';

/** Mind's Dilation's own mana value — the payback target. */
export const MINDS_DILATION_COST = 7;
const SAMPLE_ROUNDS = 6;

let sixthDoctorEnabled = false;

/**
 * Exact statistics for one opponent list.
 * @param {Object} opponentData - deck data with cardsByName
 * @param {boolean} [sixthDoctor=false] - count historic spells' mana value double
 * @returns {Object|null}
 */
export function calculateMindsDilationStats(opponentData, sixthDoctor = false) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) return null;

    let landCount = 0;
    let nonlandCount = 0;
    let historicCount = 0;
    let totalEffectiveMV = 0;
    const mvBuckets = {};
    const bandCounts = { cheap: 0, mid: 0, big: 0 };

    // Their library: an opponent's commanders are never in it (see library.js).
    for (const card of libraryOf(opponentData, { format: 'commander' }).cards) {
        const count = card.count;
        if (isLand(String(card.type_line ?? ''))) {
            landCount += count;
            continue;
        }
        const cmc = Math.max(0, Number(card?.cmc) || 0);
        const historic = isHistoricType(card?.type_line);
        const effective = sixthDoctor && historic ? cmc * 2 : cmc;
        nonlandCount += count;
        if (historic) historicCount += count;
        totalEffectiveMV += effective * count;
        const bucket = Math.min(Math.round(effective), 14);
        mvBuckets[bucket] = (mvBuckets[bucket] || 0) + count;
        bandCounts[effective >= 5 ? 'big' : effective >= 3 ? 'mid' : 'cheap'] += count;
    }

    const total = landCount + nonlandCount;
    if (total === 0) return null;
    const pNonland = nonlandCount / total;
    const avgEffectiveMV = nonlandCount > 0 ? totalEffectiveMV / nonlandCount : 0;

    return {
        pNonland,
        avgEffectiveMV,
        evPerTrigger: pNonland * avgEffectiveMV,
        landCount,
        nonlandCount,
        historicCount,
        historicShare: nonlandCount > 0 ? historicCount / nonlandCount : 0,
        mvBuckets,
        /** What the exiled card is, as shares of the whole library. */
        bands: {
            land: landCount / total,
            cheap: bandCounts.cheap / total,
            mid: bandCounts.mid / total,
            big: bandCounts.big / total
        },
        deckSize: total
    };
}

/**
 * One round = each opponent casts at least one spell on their turn, so each
 * triggers Mind's Dilation once.
 * @param {Object[]} statsList - from calculateMindsDilationStats
 * @returns {{spellsPerRound:number, manaPerRound:number, chanceAny:number, paybackRounds:number}}
 */
export function roundStats(statsList) {
    const list = (statsList ?? []).filter(Boolean);
    const spellsPerRound = list.reduce((a, s) => a + s.pNonland, 0);
    const manaPerRound = list.reduce((a, s) => a + s.evPerTrigger, 0);
    const chanceAny = list.length ? 1 - list.reduce((a, s) => a * (1 - s.pNonland), 1) : 0;
    return {
        spellsPerRound,
        manaPerRound,
        chanceAny,
        paybackRounds: manaPerRound > 0 ? MINDS_DILATION_COST / manaPerRound : Infinity
    };
}

/** "1.2 rounds", "1 round", "under a round", "never". */
export function formatRounds(rounds) {
    if (!Number.isFinite(rounds)) return 'never';
    if (rounds < 1) return 'under a round';
    const text = one(rounds);
    return `${text === '1.0' ? '1' : text} ${text === '1.0' ? 'round' : 'rounds'}`;
}

/**
 * The bottom line for a table of opponents.
 * @param {Array<{name:string, stats:Object}>} rows
 * @param {{sixthDoctor?:boolean}} [opts]
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarizeMindsDilation(rows, { sixthDoctor = false } = {}) {
    const valid = (rows ?? []).filter(r => r?.stats);
    if (valid.length === 0) return { html: '', tone: 'flat' };
    const r = roundStats(valid.map(v => v.stats));
    const tone = r.paybackRounds <= 2 ? 'good' : r.paybackRounds <= 4 ? 'warn' : 'bad';
    const payback = Number.isFinite(r.paybackRounds)
        ? `it pays back its ${MINDS_DILATION_COST} mana in <strong>${formatRounds(r.paybackRounds)}</strong>`
        : 'it never pays back — their library is all lands';
    const doctor = sixthDoctor ? ' Historic spells count double, for The Sixth Doctor’s copy.' : '';

    if (valid.length === 1) {
        const s = valid[0].stats;
        return {
            tone,
            html: `If ${escapeHtml(valid[0].name)} casts a spell every turn, Mind’s Dilation hands you a free spell on <strong>${pct(s.pNonland)}</strong> of their turns, worth about <strong>${one(s.avgEffectiveMV)} mana</strong> each — ${payback}.${doctor}`
        };
    }
    return {
        tone,
        html: `With ${countWord(valid.length)} opponents each casting a spell a turn, Mind’s Dilation flips about <strong>${one(r.spellsPerRound)} free spells a round</strong> (at least one <strong>${pct(r.chanceAny)}</strong> of the time) worth <strong>${one(r.manaPerRound)} mana</strong> — ${payback}.${doctor}`
    };
}

// ── Rendering ───────────────────────────────────────────────────────────────

const PLACEHOLDER = {
    title: 'How often does it pay out?',
    lead: `${cardRef("Mind's Dilation")} turns every opponent’s first spell each turn into a lottery ticket for you. Load their decklists and this page works out the odds exactly.`,
    steps: [
        {
            kicker: 'They cast',
            text: 'Each opponent’s first spell each turn triggers it — usually once per opponent every round.'
        },
        {
            kicker: 'They exile',
            text: 'That player exiles the top card of their library.',
            demo: '<span class="opp-demo-card is-land">land · miss</span><span class="opp-demo-card is-hit">spell · yours</span>'
        },
        {
            kicker: 'You cast',
            text: 'If it isn’t a land, you may cast it without paying its mana cost. Their land count sets the odds; their spells set the value.'
        }
    ]
};

const statsCache = new WeakMap();
function statsFor(data) {
    let entry = statsCache.get(data);
    if (!entry) statsCache.set(data, (entry = {}));
    const key = sixthDoctorEnabled ? 'doctor' : 'plain';
    if (!(key in entry)) entry[key] = calculateMindsDilationStats(data, sixthDoctorEnabled);
    return entry[key];
}

function heroStats(rows) {
    const n = rows.length;
    const r = roundStats(rows.map(x => x.stats));
    const avgHit = rows.reduce((a, x) => a + x.stats.pNonland, 0) / n;
    return renderHeroStats([
        {
            label: 'Free spells a round', size: 'big', value: one(r.spellsPerRound),
            sub: n > 1 ? `one trigger from each of ${countWord(n)}` : 'one trigger a round',
            tip: 'Assumes each opponent casts at least one spell on their own turn, so Mind’s Dilation triggers once per opponent each round. Instants on other turns add more.'
        },
        {
            label: 'Mana a round', value: one(r.manaPerRound), sub: 'in free spells',
            tip: `Average mana value of the free spells you get each round, added up across opponents. Lands flip for nothing.${sixthDoctorEnabled ? ' Historic spells count double.' : ''}`
        },
        {
            label: 'Hit chance', value: pct(avgHit), sub: n > 1 ? 'per trigger, average opponent' : 'per trigger',
            tip: 'Chance the exiled top card is not a land — the share of nonland cards in their library.'
        },
        {
            label: 'Pays back in', value: formatRounds(r.paybackRounds), sub: `its ${MINDS_DILATION_COST} mana`,
            tip: `Rounds of free spells until their total mana value reaches Mind’s Dilation’s own ${MINDS_DILATION_COST}.`
        }
    ]);
}

function tableHtml(rows) {
    const body = rows.map(({ opp, stats: s }) => `<tr>
            <td>${opponentLabel(opp, `${s.landCount} lands`)}</td>
            <td data-label="Hit chance">${pct(s.pNonland)}</td>
            <td data-label="Free spell">${one(s.avgEffectiveMV)}<span class="opp-cell-sub">average mana value</span></td>
            <td data-label="Historic">${pct(s.historicShare)}<span class="opp-cell-sub">of their spells</span></td>
            <td data-label="Mana per trigger">${one(s.evPerTrigger)}</td>
        </tr>`).join('');
    const r = roundStats(rows.map(x => x.stats));
    const foot = rows.length > 1 ? `<tfoot><tr>
            <td>Each round, all ${countWord(rows.length)}</td>
            <td data-label="At least one hit">${pct(r.chanceAny)}<span class="opp-cell-sub">at least one hit</span></td>
            <td data-label=""></td>
            <td data-label=""></td>
            <td data-label="Mana a round">${one(r.manaPerRound)}</td>
        </tr></tfoot>` : '';
    return `<div class="opp-table-wrap"><table class="opp-table">
        <thead><tr>
            <th scope="col">Opponent</th>
            <th scope="col">Hit chance</th>
            <th scope="col">Free spell</th>
            <th scope="col">Historic</th>
            <th scope="col">Mana per trigger</th>
        </tr></thead>
        <tbody>${body}</tbody>${foot}
    </table></div>`;
}

const BANDS = [
    { key: 'land', label: 'Land — nothing' },
    { key: 'cheap', label: 'Spell, 0–2 mana' },
    { key: 'mid', label: 'Spell, 3–4 mana' },
    { key: 'big', label: 'Spell, 5+ mana' }
];

function bandsHtml(rows) {
    const lines = rows.map(({ opp, stats }) => {
        const segs = BANDS.map(b => {
            const p = stats.bands[b.key];
            return p > 0 ? `<span class="mnds-seg is-${b.key}" style="width:${(p * 100).toFixed(2)}%" title="${b.label}: ${pct(p)}">${p >= 0.08 ? pct(p) : ''}</span>` : '';
        }).join('');
        return `<div class="mnds-band-row">
            <div class="mnds-band-who">${opponentLabel(opp)}</div>
            <div class="mnds-band" role="img" aria-label="${escapeHtml(opp.name)}: ${BANDS.map(b => `${b.label} ${pct(stats.bands[b.key])}`).join(', ')}">${segs}</div>
        </div>`;
    }).join('');
    const legend = BANDS.map(b => `<span class="mnds-key"><span class="mnds-swatch is-${b.key}"></span>${b.label}</span>`).join('');
    return `
        <div class="opp-section-head">
            <h2 class="opp-section-title">What the top card turns out to be</h2>
            <span class="opp-section-sub">${sixthDoctorEnabled ? 'mana value counts historic spells double' : 'by mana value'}</span>
        </div>
        <div class="mnds-bands">${lines}</div>
        <div class="mnds-legend">${legend}</div>`;
}

let lastSignature = null;
let sampleRound = 0;
const sampleCache = new Map();

function samplesFor(opp) {
    const key = `${objectId(opp.data)}:${sampleRound}`;
    if (!sampleCache.has(key)) {
        const revealer = createRevealer(opponentLibrary(opp.data));
        sampleCache.set(key, Array.from({ length: SAMPLE_ROUNDS }, () => revealer.reveal()).filter(Boolean));
    }
    return sampleCache.get(key);
}

function effectiveMv(card) {
    return sixthDoctorEnabled && card.historic ? card.cmc * 2 : card.cmc;
}

function renderSamples(state) {
    const panel = document.getElementById('mnds-sample-panel');
    const list = document.getElementById('mnds-samples');
    if (!panel || !list) return;
    panel.hidden = state.opponents.length === 0;
    if (panel.hidden) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = state.opponents.map(opp => {
        const cards = samplesFor(opp);
        const hits = cards.filter(c => !c.land);
        const mana = hits.reduce((a, c) => a + effectiveMv(c), 0);
        const items = cards.map((card, i) => {
            const doubled = sixthDoctorEnabled && card.historic;
            const chip = card.land
                ? `${cardChip(card, { dim: true })}<span class="opp-miss">no spell</span>`
                : cardChip(card, { mvText: doubled ? `${card.cmc} ×2` : String(card.cmc) });
            return `<li class="mnds-turn"><span class="mnds-turn-n">Round ${i + 1}</span><span class="opp-flow">${chip}</span></li>`;
        }).join('');
        return `<div class="mnds-sample">
            <div class="mnds-sample-head">${opponentLabel(opp)}<span class="mnds-sample-sum">${hits.length} of ${cards.length} hit · ${mana} mana</span></div>
            <ol class="mnds-turns">${items}</ol>
        </div>`;
    }).join('');
}

function renderResults(state) {
    const summary = document.getElementById('mnds-summary');
    const detail = document.getElementById('mnds-detail');
    const options = document.getElementById('mnds-options');
    if (!summary || !detail) return;
    if (state.opponents.length === 0) {
        summary.innerHTML = renderOpponentPlaceholder(PLACEHOLDER, state);
        detail.innerHTML = '';
        if (options) options.hidden = true;
        return;
    }
    if (options) options.hidden = false;
    const rows = state.opponents.map(opp => ({ opp, name: opp.name, stats: statsFor(opp.data) })).filter(r => r.stats);
    summary.innerHTML = `
        ${renderLoadingNote(state)}
        ${renderBottomLine(summarizeMindsDilation(rows, { sixthDoctor: sixthDoctorEnabled }))}
        ${heroStats(rows)}`;
    detail.innerHTML = `
        <div class="opp-section-head">
            <h2 class="opp-section-title">Opponent by opponent</h2>
            <span class="opp-section-sub">Exact odds from each list</span>
        </div>
        ${tableHtml(rows)}
        ${bandsHtml(rows)}`;
}

/**
 * Stats for every active opponent with a deck, keyed by seat.
 * @returns {Object<string, Object>}
 */
export function calculate() {
    const results = {};
    for (const opp of readOpponents().opponents) {
        const stats = statsFor(opp.data);
        if (stats) results[opp.key] = stats;
    }
    return results;
}

/** Render — only when the opponents, their import state or the options changed. */
export function updateUI() {
    const state = readOpponents();
    const signature = `${state.signature}|doctor:${sixthDoctorEnabled}|round:${sampleRound}`;
    if (signature === lastSignature && document.getElementById('mnds-summary')?.firstElementChild) return;
    lastSignature = signature;
    const live = new Set(state.opponents.map(o => String(objectId(o.data))));
    for (const key of sampleCache.keys()) if (!live.has(key.split(':')[0])) sampleCache.delete(key);
    renderResults(state);
    renderSamples(state);
}

/** Share-link settings. */
export function getShareParams() {
    return sixthDoctorEnabled ? { sixth: '1' } : {};
}

/** @param {URLSearchParams} params */
export function applyShareParams(params) {
    const value = params?.get?.('sixth');
    if (value !== '1' && value !== '0') return;
    sixthDoctorEnabled = value === '1';
    if (typeof document === 'undefined') return;
    const toggle = document.getElementById('mnds-sixth-doctor');
    if (toggle) toggle.checked = sixthDoctorEnabled;
    updateCalculatorIfActive('mindsdilation', updateUI);
}

export function init() {
    const scheduleRender = frameScheduler(() => updateCalculatorIfActive('mindsdilation', updateUI));
    OpponentState.onOpponentChange(scheduleRender);

    registerCalculator({
        name: 'mindsdilation',
        calculate,
        updateUI,
        init: () => {
            const root = document.getElementById('mindsdilation-tab');
            bindOpponentActions(root);

            const toggle = document.getElementById('mnds-sixth-doctor');
            if (toggle) {
                toggle.checked = sixthDoctorEnabled;
                toggle.addEventListener('change', () => {
                    sixthDoctorEnabled = toggle.checked;
                    updateUI();
                });
            }

            document.getElementById('mnds-resample-btn')?.addEventListener('click', () => {
                sampleRound += 1;
                sampleCache.clear();
                updateUI();
            });
        }
    });
}
