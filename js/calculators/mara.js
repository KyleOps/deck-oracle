/**
 * Ensnared by the Mara — {2}{R}{R} sorcery. The maths — exact for both of the
 * opponent's options — lives in js/utils/models/mara.js; the page itself
 * (readInputs() → the model → rendering, sample casts) is the multiplayer
 * family's, from createOpponentPage() in js/utils/opponentPages.js. This
 * module is the page's markup.
 */

import { renderHeroStats } from '../utils/components.js';
import { cardRef } from '../data/glossary.js';
import { one, pct } from '../utils/text.js';
import {
    createOpponentPage, opponentLabel, cardChip, miniBars, renderDisclosure, hasRoom,
    opponentTableHTML, sampleCastsHTML, sectionHeadHTML
} from '../utils/opponentPages.js';
import { opponentLibrary, formatRange, capDistribution, countWord } from '../utils/models/opponentLibrary.js';
import { BIG_DAMAGE, BIG_SPELL_MV, calculateMaraStats, sampleCast, summarizeMara } from '../utils/models/mara.js';

const SAMPLE_BATCH = 3;
const SAMPLE_MAX = 24;

// ── Rendering ───────────────────────────────────────────────────────────────

const PLACEHOLDER = {
    title: 'What will each opponent hand over?',
    lead: `${cardRef('Ensnared by the Mara')} gives every opponent a villainous choice. Load their decklists and this page works out exactly what each option is worth against them.`,
    steps: [
        {
            kicker: 'Option one · a free spell',
            text: 'They exile cards from the top until they hit a nonland card. You may cast it without paying its mana cost.',
            demo: '<span class="opp-demo-card is-land">land</span><span class="opp-demo-card is-land">land</span><span class="opp-demo-arrow">→</span><span class="opp-demo-card is-hit">3-drop, free</span>'
        },
        {
            kicker: 'Option two · damage',
            text: 'They exile their top four cards. Mara deals damage equal to those cards’ total mana value — lands count as 0.',
            demo: '<span class="opp-demo-card">2</span><span class="opp-demo-card is-land">0</span><span class="opp-demo-card">3</span><span class="opp-demo-card">4</span><span class="opp-demo-arrow">=</span><span class="opp-demo-card is-hit">9 damage</span>'
        },
        {
            kicker: 'They choose',
            text: 'Each opponent picks before anything is revealed, so neither option is known in advance. This page shows what both are worth.'
        }
    ]
};

function heroStats(rows) {
    const n = rows.length;
    const avg = f => rows.reduce((a, r) => a + f(r.stats), 0) / n;
    const each = n > 1 ? ', average opponent' : '';
    return renderHeroStats([
        {
            label: 'Free spell', size: 'big', value: one(avg(s => s.choice1.avgCMC)), sub: `mana value${each}`,
            tip: 'If an opponent picks the spell: the average mana value of the first nonland card in their library — the one you cast for free.'
        },
        {
            label: 'Or damage', value: one(avg(s => s.choice2.avgDamage)), sub: n > 1 ? 'average opponent' : 'average',
            tip: 'If an opponent picks damage: the average total mana value of their top four cards. Lands count as 0.'
        },
        {
            label: 'Big spell', value: pct(avg(s => s.choice1.pct5Plus) / 100), sub: `free spell costs ${BIG_SPELL_MV} or more`,
            tip: `Chance the free spell has mana value ${BIG_SPELL_MV} or more.`
        },
        {
            label: 'Big hit', value: pct(avg(s => s.choice2.pct10Plus) / 100), sub: `${BIG_DAMAGE} or more damage`,
            tip: `Chance the top four cards add up to ${BIG_DAMAGE} or more damage — enough to threaten a low-life opponent.`
        }
    ]);
}

function tableHtml(rows) {
    const body = rows.map(r => {
        const c1 = r.stats.choice1;
        const c2 = r.stats.choice2;
        return `<tr>
            <td>${opponentLabel(r.opp, `${r.stats.landCount} lands`)}</td>
            <td data-label="Free spell">${one(c1.avgCMC)}<span class="opp-cell-sub">usually ${formatRange(c1.typical)} mana</span></td>
            <td data-label="Costs ${BIG_SPELL_MV}+">${pct(c1.pct5Plus / 100)}</td>
            <td data-label="Damage">${one(c2.avgDamage)}<span class="opp-cell-sub">usually ${formatRange(c2.typical)}</span></td>
            <td data-label="${BIG_DAMAGE}+ damage">${pct(c2.pct10Plus / 100)}</td>
        </tr>`;
    }).join('');
    const foot = rows.length > 1 ? `
            <td>All ${countWord(rows.length)} opponents</td>
            <td data-label="Free spells">${one(rows.reduce((a, r) => a + r.stats.choice1.avgCMC, 0))}<span class="opp-cell-sub">mana if all pick the spell</span></td>
            <td data-label=""></td>
            <td data-label="Damage">${one(rows.reduce((a, r) => a + r.stats.choice2.avgDamage, 0))}<span class="opp-cell-sub">if all pick damage</span></td>
            <td data-label=""></td>
        ` : '';
    return opponentTableHTML({
        head: ['Opponent', 'Free spell', `Costs ${BIG_SPELL_MV}+`, 'Damage', `${BIG_DAMAGE}+ damage`],
        body,
        foot
    });
}

const SPELL_CAP = 7;
const DAMAGE_BIN = 4;
const DAMAGE_BINS = 6;

function damageBins(probs) {
    const bins = new Array(DAMAGE_BINS).fill(0);
    probs.forEach((p, d) => { bins[Math.min(Math.floor(d / DAMAGE_BIN), DAMAGE_BINS - 1)] += p; });
    return bins;
}

function damageBinLabel(i) {
    const lo = i * DAMAGE_BIN;
    return i === DAMAGE_BINS - 1 ? `${lo}+` : `${lo}–${lo + DAMAGE_BIN - 1}`;
}

function multiplesHtml(rows) {
    const spellDists = rows.map(r => capDistribution(r.stats.choice1.mvProbs, SPELL_CAP));
    const damageDists = rows.map(r => damageBins(r.stats.choice2.damageProbs));
    const spellMax = Math.max(...spellDists.flat());
    const damageMax = Math.max(...damageDists.flat());
    const cells = rows.map((r, i) => `
        <div class="opp-multiple">
            <div class="opp-multiple-head">${opponentLabel(r.opp)}</div>
            ${miniBars({ title: 'Free spell · mana value', probs: spellDists[i], label: v => (v === SPELL_CAP ? `${v}+` : `${v}`), scaleMax: spellMax, color: r.opp.color })}
            ${miniBars({ title: 'Damage', probs: damageDists[i], label: damageBinLabel, scaleMax: damageMax, color: r.opp.color })}
        </div>`).join('');
    return `<div class="opp-multiples">${cells}</div>
        <p class="tx-caption is-below">How often each outcome happens. Every opponent is drawn on the same scale, so a longer bar means more likely — compare across columns.</p>`;
}

function gameRow(opp, cast) {
    const lands = cast.spell ? cast.spellRun.slice(0, -1) : cast.spellRun;
    const run = lands.map(c => cardChip(c)).join('')
        + (cast.spell ? `${lands.length ? '<span class="opp-arrow">→</span>' : ''}${cardChip(cast.spell)}` : '');
    const damage = cast.top.reduce((a, c) => a + c.cmc, 0);
    const top = cast.top.map(c => cardChip(c, { mvText: String(c.cmc) })).join('');
    return `<div class="mara-game-row">
        <div class="mara-game-who">${opponentLabel(opp)}</div>
        <div class="mara-game-opt" data-label="If they give you a spell">
            <div class="mara-game-result">${cast.spell ? `${cast.spell.cmc}-mana spell, free` : 'Nothing — only lands'}</div>
            <div class="opp-flow">${run}</div>
        </div>
        <div class="mara-game-opt" data-label="If they take damage">
            <div class="mara-game-result">${damage} damage</div>
            <div class="opp-flow">${top}</div>
        </div>
    </div>`;
}

function samplesHtml(opponents, casts, shown) {
    const games = Array.from({ length: shown }, (_, g) => `
        <div class="opp-game">
            <div class="opp-game-head tx-eyebrow">Cast ${g + 1}</div>
            ${opponents.map((opp, i) => gameRow(opp, casts[i][g])).join('')}
        </div>`).join('');
    return sampleCastsHTML({
        sub: 'Real shuffles of each list. Both options come from the same shuffle — the opponent only gets one.',
        before: `
        <div class="mara-game-cols" aria-hidden="true"><span></span><span>If they give you a spell</span><span>If they take damage</span></div>`,
        games,
        more: shown < SAMPLE_MAX
    });
}

function sectionsHtml(rows, { panel }) {
    return `
        ${sectionHeadHTML('Opponent by opponent', 'Exact odds from each list')}
        ${tableHtml(rows)}
        ${renderDisclosure({ id: 'mara-spread', title: 'How often each outcome happens', body: multiplesHtml(rows), open: hasRoom(panel) })}`;
}

const page = createOpponentPage({
    key: 'mara',
    stats: data => calculateMaraStats(data),
    summarize: summarizeMara,
    hero: heroStats,
    sections: sectionsHtml,
    placeholder: PLACEHOLDER,
    sample: {
        panel: 'mara-sample-reveals',
        count: SAMPLE_MAX,
        batch: SAMPLE_BATCH,
        draw: opp => {
            const library = opponentLibrary(opp.data);
            return Array.from({ length: SAMPLE_MAX }, () => sampleCast(library));
        },
        render: samplesHtml
    }
});

export const { readInputs, calculate, updateUI, init } = page;
