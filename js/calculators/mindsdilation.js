/**
 * Mind's Dilation — {5}{U}{U} enchantment. The exact maths lives in
 * js/utils/models/mindsdilation.js; the page itself (readInputs() → the model
 * → rendering, sample rounds) is the multiplayer family's, from
 * createOpponentPage() in js/utils/opponentPages.js. This module is the page's
 * markup and its one setting, The Sixth Doctor.
 */

import { updateCalculatorIfActive } from '../utils/calculatorBase.js';
import { renderHeroStats } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { one, pct } from '../utils/text.js';
import { createOpponentPage, opponentLabel, cardChip, opponentTableHTML, sectionHeadHTML } from '../utils/opponentPages.js';
import { opponentLibrary, createRevealer, countWord } from '../utils/models/opponentLibrary.js';
import {
    MINDS_DILATION_COST, calculateMindsDilationStats, formatRounds, roundStats, summarizeMindsDilation
} from '../utils/models/mindsdilation.js';

const SAMPLE_ROUNDS = 6;

let sixthDoctorEnabled = false;

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

function heroStats(rows, { sixthDoctor }) {
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
            tip: `Average mana value of the free spells you get each round, added up across opponents. Lands flip for nothing.${sixthDoctor ? ' Historic spells count double.' : ''}`
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
    const foot = rows.length > 1 ? `
            <td>Each round, all ${countWord(rows.length)}</td>
            <td data-label="At least one hit">${pct(r.chanceAny)}<span class="opp-cell-sub">at least one hit</span></td>
            <td data-label=""></td>
            <td data-label=""></td>
            <td data-label="Mana a round">${one(r.manaPerRound)}</td>
        ` : '';
    return opponentTableHTML({ head: ['Opponent', 'Hit chance', 'Free spell', 'Historic', 'Mana per trigger'], body, foot });
}

const BANDS = [
    { key: 'land', label: 'Land — nothing' },
    { key: 'cheap', label: 'Spell, 0–2 mana' },
    { key: 'mid', label: 'Spell, 3–4 mana' },
    { key: 'big', label: 'Spell, 5+ mana' }
];

function bandsHtml(rows, sixthDoctor) {
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
        ${sectionHeadHTML('What the top card turns out to be', sixthDoctor ? 'mana value counts historic spells double' : 'by mana value')}
        <div class="mnds-bands">${lines}</div>
        <div class="tx-legend is-panel">${legend}</div>`;
}

function effectiveMv(card, sixthDoctor) {
    return sixthDoctor && card.historic ? card.cmc * 2 : card.cmc;
}

/** One block per opponent: the card they exile on each of the next six rounds. */
function samplesHtml(opponents, samples, shown, { sixthDoctor }) {
    return opponents.map((opp, o) => {
        const cards = samples[o];
        const hits = cards.filter(c => !c.land);
        const mana = hits.reduce((a, c) => a + effectiveMv(c, sixthDoctor), 0);
        const items = cards.map((card, i) => {
            const doubled = sixthDoctor && card.historic;
            const chip = card.land
                ? `${cardChip(card, { dim: true })}<span class="opp-miss">no spell</span>`
                : cardChip(card, { mvText: doubled ? `${card.cmc} ×2` : String(card.cmc) });
            return `<li class="mnds-turn"><span class="mnds-turn-n tx-eyebrow">Round ${i + 1}</span><span class="opp-flow">${chip}</span></li>`;
        }).join('');
        return `<div class="mnds-sample">
            <div class="mnds-sample-head">${opponentLabel(opp)}<span class="mnds-sample-sum">${hits.length} of ${cards.length} hit · ${mana} mana</span></div>
            <ol class="mnds-turns">${items}</ol>
        </div>`;
    }).join('');
}

function sectionsHtml(rows, { settings }) {
    return `
        ${sectionHeadHTML('Opponent by opponent', 'Exact odds from each list')}
        ${tableHtml(rows)}
        ${bandsHtml(rows, settings.sixthDoctor)}`;
}

const page = createOpponentPage({
    key: 'mindsdilation',
    settings: () => ({ sixthDoctor: sixthDoctorEnabled }),
    stats: (data, { sixthDoctor }) => calculateMindsDilationStats(data, sixthDoctor),
    statsKey: ({ sixthDoctor }) => (sixthDoctor ? 'doctor' : 'plain'),
    summarize: (rows, { sixthDoctor }) => summarizeMindsDilation(rows, { sixthDoctor }),
    hero: heroStats,
    sections: sectionsHtml,
    placeholder: PLACEHOLDER,
    layout: { summary: 'mnds-summary', detail: 'mnds-detail', options: 'mnds-options' },
    sample: {
        panel: 'mnds-sample-panel',
        list: 'mnds-samples',
        count: SAMPLE_ROUNDS,
        draw: opp => {
            const revealer = createRevealer(opponentLibrary(opp.data));
            return Array.from({ length: SAMPLE_ROUNDS }, () => revealer.reveal()).filter(Boolean);
        },
        render: samplesHtml
    },
    bind: () => {
        const toggle = document.getElementById('mnds-sixth-doctor');
        if (!toggle) return;
        toggle.checked = sixthDoctorEnabled;
        toggle.addEventListener('change', () => {
            sixthDoctorEnabled = toggle.checked;
            page.updateUI();
        });
    }
});

/** The opponents with decks (and their import state), and whether The Sixth Doctor doubles historic spells. */
export const { readInputs, calculate, updateUI, init } = page;

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
