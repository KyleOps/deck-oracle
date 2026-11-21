/**
 * Dream Harvest — {5}{U/B}{U/B} sorcery. The page: readInputs() (the
 * opponents → a plain object), the model, then rendering. The maths — a
 * seeded simulation per opponent list — lives in js/utils/models/dreamharvest.js.
 */

import { registerCalculator, updateCalculatorIfActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import { describeDots, dotPlot } from '../utils/viz.js';
import * as OpponentState from '../utils/opponentState.js';
import { one, pct } from '../utils/text.js';
import {
    objectId, readOpponents, frameScheduler, opponentLabel, cardChip, miniBars,
    renderOpponentPlaceholder, renderLoadingNote, bindOpponentActions, renderDisclosure, hasRoom
} from '../utils/opponentPages.js';
import { opponentLibrary, createRevealer, formatRange, countWord } from '../utils/models/opponentLibrary.js';
import {
    BIG_SPELL_MV, DREAM_HARVEST_COST, SIM_RUNS, calculateDreamHarvestStats, harvestDots, resolveDreamHarvest,
    summarizeDreamHarvest, totalStolenDistribution
} from '../utils/models/dreamharvest.js';

const SAMPLE_BATCH = 3;
const SAMPLE_MAX = 24;

// ── Inputs ──────────────────────────────────────────────────────────────────

/** The opponents with decks, their import state and a signature of both. */
export function readInputs() {
    return readOpponents();
}

const statsCache = new WeakMap();
function statsFor(data) {
    if (!statsCache.has(data)) statsCache.set(data, calculateDreamHarvestStats(data));
    return statsCache.get(data);
}

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
    const foot = rows.length > 1 ? `<tfoot><tr>
            <td>All ${countWord(rows.length)} opponents</td>
            <td data-label="Cards exiled">${one(sum(s => s.avgCardsExiled))}</td>
            <td data-label="Spells">${one(sum(s => s.avgCastable))}</td>
            <td data-label="Mana stolen">${one(sum(s => s.avgCastableMV))}</td>
            <td data-label="A ${BIG_SPELL_MV}+ spell">${pct(anyBig)}<span class="opp-cell-sub">from at least one</span></td>
        </tr></tfoot>` : '';
    return `<div class="opp-table-wrap"><table class="opp-table">
        <thead><tr>
            <th scope="col">Opponent</th>
            <th scope="col">Cards exiled</th>
            <th scope="col">Spells</th>
            <th scope="col">Mana stolen</th>
            <th scope="col">A ${BIG_SPELL_MV}+ spell</th>
        </tr></thead>
        <tbody>${body}</tbody>${foot}
    </table></div>`;
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
        <p class="opp-caption">How many spells each opponent’s pile hands you, on the same scale for every opponent. The pile always reaches mana value 5, so what varies is whether it arrives as one big spell or several small ones.</p>`;
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
        <div class="opp-section-head">
            <h2 class="opp-section-title">Out of 100 casts</h2>
            <span class="opp-section-sub">mana stolen ${who}</span>
        </div>
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
        <p class="opp-caption">Each dot is one cast in a hundred, stacked by the mana value of everything you may cast for free${rows.length > 1 ? ', added up across opponents' : ''}. Solid dots steal at least the ${DREAM_HARVEST_COST} mana Dream Harvest costs.</p>`;
}

let lastSignature = null;
let sampleRound = 0;
let samplesShown = SAMPLE_BATCH;
const sampleCache = new Map();

function samplesFor(opp) {
    const key = `${objectId(opp.data)}:${sampleRound}`;
    if (!sampleCache.has(key)) {
        const revealer = createRevealer(opponentLibrary(opp.data));
        sampleCache.set(key, Array.from({ length: SAMPLE_MAX }, () => {
            revealer.reset();
            return resolveDreamHarvest(revealer.reveal);
        }));
    }
    return sampleCache.get(key);
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

function renderSamples(state) {
    const panel = document.getElementById('dreamharvest-sample-reveals');
    if (!panel) return;
    if (state.opponents.length === 0) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }
    panel.hidden = false;
    const results = state.opponents.map(opp => samplesFor(opp));
    const games = Array.from({ length: samplesShown }, (_, g) => {
        const total = results.reduce((a, r) => a + r[g].totalCastableMV, 0);
        return `
        <div class="opp-game">
            <div class="opp-game-head tx-eyebrow">Cast ${g + 1}${state.opponents.length > 1 ? ` · ${total} mana stolen in all` : ''}</div>
            ${state.opponents.map((opp, i) => gameRow(opp, results[i][g])).join('')}
        </div>`;
    }).join('');
    panel.innerHTML = `
        <div class="opp-section-head">
            <div>
                <h2 class="opp-section-title">Sample casts</h2>
                <p class="opp-section-sub">Real shuffles of each list, in the order the cards come off the top. Lands are dimmed.</p>
            </div>
            <div class="opp-section-actions"><button type="button" class="btn btn-ghost btn-sm" data-dh-action="reshuffle">Reshuffle</button></div>
        </div>
        <div class="opp-games">${games}</div>
        ${samplesShown < SAMPLE_MAX ? '<div class="opp-more"><button type="button" class="btn btn-ghost btn-sm" data-dh-action="more">Show more casts</button></div>' : ''}`;
}

function renderResults(state) {
    const panel = document.getElementById('dreamharvest-results');
    if (!panel) return;
    if (state.opponents.length === 0) {
        panel.innerHTML = renderOpponentPlaceholder(PLACEHOLDER, state);
        return;
    }
    const rows = state.opponents.map(opp => ({ opp, name: opp.name, stats: statsFor(opp.data) })).filter(r => r.stats);
    panel.innerHTML = `
        ${renderLoadingNote(state)}
        ${renderBottomLine(summarizeDreamHarvest(rows))}
        ${heroStats(rows)}
        <div class="opp-section-head">
            <h2 class="opp-section-title">Opponent by opponent</h2>
            <span class="opp-section-sub">${SIM_RUNS.toLocaleString('en-US')} simulated casts per list</span>
        </div>
        ${tableHtml(rows)}
        ${dotsHtml(rows)}
        ${renderDisclosure({ id: 'dreamharvest-spread', title: 'Spells from each opponent', body: multiplesHtml(rows), open: hasRoom(panel) })}`;
}

/**
 * Stats for every active opponent with a deck, keyed by seat.
 * @returns {Object<string, Object>}
 */
export function calculate() {
    const results = {};
    for (const opp of readInputs().opponents) {
        const stats = statsFor(opp.data);
        if (stats) results[opp.key] = stats;
    }
    return results;
}

/** Render — only when the opponents (or their import state) changed. */
export function updateUI() {
    const state = readInputs();
    if (state.signature === lastSignature && document.getElementById('dreamharvest-results')?.firstElementChild) return;
    lastSignature = state.signature;
    samplesShown = SAMPLE_BATCH;
    const live = new Set(state.opponents.map(o => String(objectId(o.data))));
    for (const key of sampleCache.keys()) if (!live.has(key.split(':')[0])) sampleCache.delete(key);
    renderResults(state);
    renderSamples(state);
}

export function init() {
    const scheduleRender = frameScheduler(() => updateCalculatorIfActive('dreamharvest', updateUI));
    OpponentState.onOpponentChange(scheduleRender);

    registerCalculator({
        name: 'dreamharvest',
        calculate,
        updateUI,
        init: () => {
            const root = document.getElementById('dreamharvest-tab');
            bindOpponentActions(root);
            root?.addEventListener('click', e => {
                const action = e.target.closest('[data-dh-action]')?.dataset.dhAction;
                if (action === 'reshuffle') {
                    sampleRound += 1;
                    sampleCache.clear();
                    renderSamples(readInputs());
                } else if (action === 'more') {
                    samplesShown = Math.min(SAMPLE_MAX, samplesShown + SAMPLE_BATCH);
                    renderSamples(readInputs());
                }
            });
        }
    });
}
