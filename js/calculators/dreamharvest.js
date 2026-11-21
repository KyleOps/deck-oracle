/**
 * Dream Harvest — {5}{U/B}{U/B} sorcery. The maths — a seeded simulation per
 * opponent list — lives in js/utils/models/dreamharvest.js; the page itself
 * (readInputs() → the model → rendering, sample casts) is the multiplayer
 * family's, from createOpponentPage() in js/utils/opponentPages.js. This
 * module is the page's markup.
 */

import { renderHeroStats } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { describeDots, dotPlot } from '../utils/viz.js';
import { one, pct } from '../utils/text.js';
import {
    createOpponentPage, opponentLabel, cardChip, miniBars, renderDisclosure, hasRoom,
    opponentTableHTML, sampleCastsHTML, sectionHeadHTML
} from '../utils/opponentPages.js';
import { opponentLibrary, createRevealer, formatRange, countWord } from '../utils/models/opponentLibrary.js';
import {
    BIG_SPELL_MV, DREAM_HARVEST_COST, SIM_RUNS, calculateDreamHarvestStats, harvestDots, resolveDreamHarvest,
    summarizeDreamHarvest, totalStolenDistribution
} from '../utils/models/dreamharvest.js';

const SAMPLE_BATCH = 3;
const SAMPLE_MAX = 24;

// ── Rendering ───────────────────────────────────────────────────────────────

const PLACEHOLDER = {
    title: 'How much will you steal?',
    lead: `${cardRef('Dream Harvest')} raids every opponent’s library at once. Load their decklists and this page shows how many spells you get from each of them, and how much they are worth.`,
    steps: [
        {
            kicker: 'They exile',
            text: 'Each opponent exiles cards from the top of their library until the exiled cards’ mana values add up to 5 or more.',
            demo: '<span class="opp-demo-card is-land">0</span><span class="opp-demo-card">2</span><span class="opp-demo-card is-land">0</span><span class="opp-demo-card">4</span><span class="opp-demo-arrow">=</span><span class="opp-demo-card">6 · stop</span>'
        },
        {
            kicker: 'You cast',
            text: 'Until end of turn you may cast any of those cards without paying their mana costs.',
            demo: '<span class="opp-demo-card is-hit">2-drop, free</span><span class="opp-demo-card is-hit">4-drop, free</span>'
        },
        {
            kicker: 'Lands miss',
            text: 'Lands are exiled too, but they count as 0 and can’t be cast — so land-heavy decks hand over fewer spells.'
        }
    ]
};

function heroStats(rows) {
    const n = rows.length;
    const sum = f => rows.reduce((a, r) => a + f(r.stats), 0);
    const anyBig = 1 - rows.reduce((a, r) => a * (1 - r.stats.pBigSpell), 1);
    return renderHeroStats([
        {
            label: 'Mana stolen', size: 'big', value: one(sum(s => s.avgCastableMV)),
            sub: n > 1 ? `in free spells from all ${countWord(n)}` : 'in free spells',
            tip: 'The total mana value of the spells you can cast for free, added up across opponents. Lands are exiled too but are worth nothing.'
        },
        {
            label: 'Spells stolen', value: one(sum(s => s.avgCastable)), sub: 'you can cast this turn',
            tip: 'Average number of nonland cards exiled — each one is a spell you may cast without paying its mana cost.'
        },
        {
            label: 'Cards exiled', value: one(sum(s => s.avgCardsExiled) / n), sub: n > 1 ? 'per opponent, lands included' : 'lands included',
            tip: 'How deep the exile digs into each library before the pile reaches mana value 5.'
        },
        {
            label: `A ${BIG_SPELL_MV}+ spell`, value: pct(anyBig), sub: n > 1 ? 'from at least one opponent' : 'in the pile',
            tip: `Chance that at least one stolen spell has mana value ${BIG_SPELL_MV} or more.`
        }
    ]);
}

function tableHtml(rows) {
    const body = rows.map(r => {
        const s = r.stats;
        return `<tr>
            <td>${opponentLabel(r.opp, `${s.landCount} lands`)}</td>
            <td data-label="Cards exiled">${one(s.avgCardsExiled)}</td>
            <td data-label="Spells">${one(s.avgCastable)}<span class="opp-cell-sub">usually ${formatRange(s.typicalSpells)}</span></td>
            <td data-label="Mana stolen">${one(s.avgCastableMV)}<span class="opp-cell-sub">usually ${formatRange(s.typicalMana)}</span></td>
            <td data-label="A ${BIG_SPELL_MV}+ spell">${pct(s.pBigSpell)}</td>
        </tr>`;
    }).join('');
    const sum = f => rows.reduce((a, r) => a + f(r.stats), 0);
    const anyBig = 1 - rows.reduce((a, r) => a * (1 - r.stats.pBigSpell), 1);
    const foot = rows.length > 1 ? `
            <td>All ${countWord(rows.length)} opponents</td>
            <td data-label="Cards exiled">${one(sum(s => s.avgCardsExiled))}</td>
            <td data-label="Spells">${one(sum(s => s.avgCastable))}</td>
            <td data-label="Mana stolen">${one(sum(s => s.avgCastableMV))}</td>
            <td data-label="A ${BIG_SPELL_MV}+ spell">${pct(anyBig)}<span class="opp-cell-sub">from at least one</span></td>
        ` : '';
    return opponentTableHTML({
        head: ['Opponent', 'Cards exiled', 'Spells', 'Mana stolen', `A ${BIG_SPELL_MV}+ spell`],
        body,
        foot
    });
}

const SPELL_CAP = 5;

function multiplesHtml(rows) {
    const spellDists = rows.map(r => {
        const d = new Array(SPELL_CAP + 1).fill(0);
        r.stats.spellsProbs.forEach((p, i) => { d[Math.min(i, SPELL_CAP)] += p; });
        return d;
    });
    const spellMax = Math.max(...spellDists.flat());
    const cells = rows.map((r, i) => `
        <div class="opp-multiple">
            <div class="opp-multiple-head">${opponentLabel(r.opp)}</div>
            ${miniBars({ title: 'Spells you can cast', probs: spellDists[i], label: v => (v === SPELL_CAP ? `${v}+` : `${v}`), scaleMax: spellMax, color: r.opp.color, dimFn: v => v === 0 })}
        </div>`).join('');
    return `<div class="opp-multiples">${cells}</div>
        <p class="tx-caption is-below">How many spells each opponent’s pile hands you, on the same scale for every opponent. The pile always reaches mana value 5, so what varies is whether it arrives as one big spell or several small ones.</p>`;
}

const DOT_LEGEND = Object.freeze([
    { tone: 'good', label: `steal ${DREAM_HARVEST_COST}+ mana` },
    { tone: 'bad', label: 'steal less than it costs' }
]);

function dotsHtml(rows) {
    const total = totalStolenDistribution(rows.map(r => r.stats.manaProbs));
    const dots = harvestDots(total);
    if (dots.length === 0) return '';
    const who = rows.length > 1 ? `from all ${countWord(rows.length)} opponents` : `from ${escapeHtml(rows[0].name)}`;
    const tableRows = [];
    let atLeast = 1;
    total.forEach((p, mana) => {
        if (p >= 0.0005) tableRows.push([`${mana} mana`, pct(p), pct(atLeast)]);
        atLeast -= p;
    });
    return `
        ${sectionHeadHTML('Out of 100 casts', `mana stolen ${who}`)}
        ${dotPlot({
            dots,
            label: `Total mana value of the spells stolen ${rows.length > 1 ? 'from all opponents' : ''}, out of 100 casts. ${describeDots(dots, { unit: 'cast', format: v => `${v} mana`, legend: DOT_LEGEND })}`,
            unit: 'cast',
            format: v => String(v),
            xLabel: rows.length > 1 ? 'Mana stolen in all, added up across opponents' : 'Mana stolen',
            threshold: DREAM_HARVEST_COST,
            thresholdLabel: `${DREAM_HARVEST_COST}+ = its own cost`,
            legend: DOT_LEGEND.filter(l => dots.some(d => d.tone === l.tone)),
            maxColumns: 30,
            table: {
                summary: 'Shares of simulated casts',
                caption: 'Share of simulated casts by total mana stolen',
                head: ['Mana stolen', 'Casts', 'At least this'],
                rows: tableRows
            }
        })}
        <p class="tx-caption is-below">Each dot is one cast in a hundred, stacked by the mana value of everything you may cast for free${rows.length > 1 ? ', added up across opponents' : ''}. Solid dots steal at least the ${DREAM_HARVEST_COST} mana Dream Harvest costs.</p>`;
}

function gameRow(opp, result) {
    const chips = result.exiledCards.map(c => cardChip(c, { mvText: String(c.cmc), dim: c.land })).join('');
    const summary = result.numCastable
        ? `${result.numCastable} ${result.numCastable === 1 ? 'spell' : 'spells'} · ${result.totalCastableMV} mana`
        : 'Nothing to cast';
    return `<div class="dh-game-row">
        <div class="dh-game-who">${opponentLabel(opp)}</div>
        <div class="dh-game-result">${summary}</div>
        <div class="opp-flow">${chips}</div>
    </div>`;
}

function samplesHtml(opponents, results, shown) {
    const games = Array.from({ length: shown }, (_, g) => {
        const total = results.reduce((a, r) => a + r[g].totalCastableMV, 0);
        return `
        <div class="opp-game">
            <div class="opp-game-head tx-eyebrow">Cast ${g + 1}${opponents.length > 1 ? ` · ${total} mana stolen in all` : ''}</div>
            ${opponents.map((opp, i) => gameRow(opp, results[i][g])).join('')}
        </div>`;
    }).join('');
    return sampleCastsHTML({
        sub: 'Real shuffles of each list, in the order the cards come off the top. Lands are dimmed.',
        games,
        more: shown < SAMPLE_MAX
    });
}

/** One opponent's sample casts: a fresh shuffle each, resolved card by card. */
function drawSamples(opp) {
    const revealer = createRevealer(opponentLibrary(opp.data));
    return Array.from({ length: SAMPLE_MAX }, () => {
        revealer.reset();
        return resolveDreamHarvest(revealer.reveal);
    });
}

function sectionsHtml(rows, { panel }) {
    return `
        ${sectionHeadHTML('Opponent by opponent', `${SIM_RUNS.toLocaleString('en-US')} simulated casts per list`)}
        ${tableHtml(rows)}
        ${dotsHtml(rows)}
        ${renderDisclosure({ id: 'dreamharvest-spread', title: 'Spells from each opponent', body: multiplesHtml(rows), open: hasRoom(panel) })}`;
}

const page = createOpponentPage({
    key: 'dreamharvest',
    stats: data => calculateDreamHarvestStats(data),
    summarize: summarizeDreamHarvest,
    hero: heroStats,
    sections: sectionsHtml,
    placeholder: PLACEHOLDER,
    sample: { panel: 'dreamharvest-sample-reveals', count: SAMPLE_MAX, batch: SAMPLE_BATCH, draw: drawSamples, render: samplesHtml }
});

export const { readInputs, calculate, updateUI, init } = page;
