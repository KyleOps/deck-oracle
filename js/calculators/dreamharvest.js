/**
 * Dream Harvest — {5}{U/B}{U/B} sorcery.
 *
 * Each opponent exiles cards from the top of their library until they have
 * exiled cards with total mana value 5 or greater this way. Until end of turn,
 * you may cast cards exiled this way without paying their mana costs.
 *
 * Simulated: each opponent's real list is shuffled 20,000 times (seeded by the
 * list itself, so the same deck always gives the same numbers) and only as many
 * cards as the exile reaches are shuffled each time.
 */

import { registerCalculator, updateCalculatorIfActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import * as OpponentState from '../utils/opponentState.js';
import {
    libraryOf, isLandCard, createRevealer, seededRandom, deckSeed, typicalRange, formatRange, formatPct, fmt1,
    countWord, objectId, readOpponents, frameScheduler, opponentLabel, cardChip, miniBars,
    renderOpponentPlaceholder, renderLoadingNote, bindOpponentActions, renderDisclosure, hasRoom
} from '../utils/opponentPages.js';

/** Dream Harvest's own mana value — what the stolen spells are measured against. */
export const DREAM_HARVEST_COST = 7;
/** Exile until the pile's total mana value reaches this. */
export const MV_THRESHOLD = 5;
/** "Big" stolen spell called out in the table. */
const BIG_SPELL_MV = 5;
const SIM_RUNS = 20000;

const SAMPLE_BATCH = 3;
const SAMPLE_MAX = 24;

// ── Mechanics ───────────────────────────────────────────────────────────────

/**
 * Resolve Dream Harvest against one opponent, revealing cards from a source.
 * @param {() => (Object|null)} nextCard - returns the next card from the top, or null when empty
 * @returns {{cardsExiled:number, totalMV:number, exiledCards:Array, castableSpells:Array, numCastable:number, totalCastableMV:number}}
 */
export function resolveDreamHarvest(nextCard) {
    let totalMV = 0;
    const exiledCards = [];
    while (totalMV < MV_THRESHOLD) {
        const card = nextCard();
        if (!card) break;
        exiledCards.push(card);
        totalMV += card.cmc || 0;
    }
    const castableSpells = exiledCards.filter(c => !isLandCard(c));
    return {
        cardsExiled: exiledCards.length,
        totalMV,
        exiledCards,
        castableSpells,
        numCastable: castableSpells.length,
        totalCastableMV: castableSpells.reduce((sum, c) => sum + (c.cmc || 0), 0)
    };
}

/**
 * Dream Harvest on a shuffled library (top first).
 * @param {Array} deck
 */
export function simulateDreamHarvest(deck) {
    let i = 0;
    return resolveDreamHarvest(() => (i < deck.length ? deck[i++] : null));
}

function bump(arr, i, by = 1) {
    arr[i] = (arr[i] ?? 0) + by;
}

function normalise(counts, runs) {
    return Array.from(counts, c => (c ?? 0) / runs);
}

/**
 * Statistics for one opponent list.
 * @param {Object} opponentData - deck data with cardsByName
 * @param {number} [numSims=20000]
 * @param {number} [seed] - defaults to a hash of the list, so results are repeatable
 * @returns {Object|null}
 */
export function calculateDreamHarvestStats(opponentData, numSims = SIM_RUNS, seed = undefined) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) return null;
    const library = libraryOf(opponentData);
    if (library.length === 0) return null;
    const runs = Math.max(1, Math.floor(numSims) || 1);

    const revealer = createRevealer(library, seededRandom(seed ?? deckSeed(library)));
    let totalCardsExiled = 0;
    let totalMV = 0;
    let totalCastable = 0;
    let totalCastableMV = 0;
    let bigRuns = 0;
    const spellCounts = [];
    const manaCounts = [];
    const exiledCounts = [];

    for (let i = 0; i < runs; i++) {
        revealer.reset();
        const r = resolveDreamHarvest(revealer.reveal);
        totalCardsExiled += r.cardsExiled;
        totalMV += r.totalMV;
        totalCastable += r.numCastable;
        totalCastableMV += r.totalCastableMV;
        if (r.castableSpells.some(c => c.cmc >= BIG_SPELL_MV)) bigRuns += 1;
        bump(spellCounts, r.numCastable);
        bump(manaCounts, Math.round(r.totalCastableMV));
        bump(exiledCounts, r.cardsExiled);
    }

    const spellsProbs = normalise(spellCounts, runs);
    const manaProbs = normalise(manaCounts, runs);
    return {
        avgCardsExiled: totalCardsExiled / runs,
        avgTotalMV: totalMV / runs,
        avgCastable: totalCastable / runs,
        avgCastableMV: totalCastableMV / runs,
        pBigSpell: bigRuns / runs,
        spellsProbs,
        manaProbs,
        exiledProbs: normalise(exiledCounts, runs),
        typicalSpells: typicalRange(spellsProbs),
        typicalMana: typicalRange(manaProbs),
        numSims: runs,
        deckSize: library.length,
        landCount: library.filter(c => c.land).length
    };
}

const statsCache = new WeakMap();
function statsFor(data) {
    if (!statsCache.has(data)) statsCache.set(data, calculateDreamHarvestStats(data));
    return statsCache.get(data);
}

// ── Plain-language answer ───────────────────────────────────────────────────

function spread(values, unit) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.length > 1 && hi - lo >= 0.5
        ? `${fmt1(lo)}–${fmt1(hi)} ${unit}`
        : `about ${fmt1(mean)} ${unit}`;
}

function versusCost(total) {
    if (total >= 2 * DREAM_HARVEST_COST) return `more than twice its ${DREAM_HARVEST_COST}-mana cost`;
    if (total >= DREAM_HARVEST_COST) return `more than its ${DREAM_HARVEST_COST}-mana cost`;
    return `less than its ${DREAM_HARVEST_COST}-mana cost`;
}

/** Average several probability arrays into one (the "typical opponent"). */
export function poolDistributions(dists) {
    const length = Math.max(0, ...dists.map(d => d.length));
    const pooled = new Array(length).fill(0);
    for (const d of dists) d.forEach((p, i) => { pooled[i] += (p || 0) / dists.length; });
    return pooled;
}

/**
 * The bottom line for a table of opponents.
 * @param {Array<{name:string, stats:Object}>} rows
 * @returns {{html:string, tone:'good'|'warn'|'flat'}}
 */
export function summarizeDreamHarvest(rows) {
    const valid = (rows ?? []).filter(r => r?.stats);
    if (valid.length === 0) return { html: '', tone: 'flat' };
    const totalMana = valid.reduce((a, r) => a + r.stats.avgCastableMV, 0);
    const range = typicalRange(poolDistributions(valid.map(r => r.stats.spellsProbs)));
    const spells = `${formatRange(range)} ${range[1] === 1 ? 'spell' : 'spells'}`;
    const mana = spread(valid.map(r => r.stats.avgCastableMV), 'mana');
    const tone = totalMana >= DREAM_HARVEST_COST ? 'good' : 'warn';

    if (valid.length === 1) {
        return {
            tone,
            html: `Against ${escapeHtml(valid[0].name)}, Dream Harvest usually steals <strong>${spells}</strong> worth <strong>${mana}</strong> in all — ${versusCost(totalMana)}.`
        };
    }
    return {
        tone,
        html: `Against these ${countWord(valid.length)} decks, Dream Harvest usually steals <strong>${spells}</strong> worth <strong>${mana}</strong> from each opponent — <strong>${fmt1(totalMana)} mana</strong> of free spells in all, ${versusCost(totalMana)}.`
    };
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
            label: 'Mana stolen', size: 'big', value: fmt1(sum(s => s.avgCastableMV)),
            sub: n > 1 ? `in free spells from all ${countWord(n)}` : 'in free spells',
            tip: 'The total mana value of the spells you can cast for free, added up across opponents. Lands are exiled too but are worth nothing.'
        },
        {
            label: 'Spells stolen', value: fmt1(sum(s => s.avgCastable)), sub: 'you can cast this turn',
            tip: 'Average number of nonland cards exiled — each one is a spell you may cast without paying its mana cost.'
        },
        {
            label: 'Cards exiled', value: fmt1(sum(s => s.avgCardsExiled) / n), sub: n > 1 ? 'per opponent, lands included' : 'lands included',
            tip: 'How deep the exile digs into each library before the pile reaches mana value 5.'
        },
        {
            label: `A ${BIG_SPELL_MV}+ spell`, value: formatPct(anyBig), sub: n > 1 ? 'from at least one opponent' : 'in the pile',
            tip: `Chance that at least one stolen spell has mana value ${BIG_SPELL_MV} or more.`
        }
    ]);
}

function tableHtml(rows) {
    const body = rows.map(r => {
        const s = r.stats;
        return `<tr>
            <td>${opponentLabel(r.opp, `${s.landCount} lands`)}</td>
            <td data-label="Cards exiled">${fmt1(s.avgCardsExiled)}</td>
            <td data-label="Spells">${fmt1(s.avgCastable)}<span class="opp-cell-sub">usually ${formatRange(s.typicalSpells)}</span></td>
            <td data-label="Mana stolen">${fmt1(s.avgCastableMV)}<span class="opp-cell-sub">usually ${formatRange(s.typicalMana)}</span></td>
            <td data-label="A ${BIG_SPELL_MV}+ spell">${formatPct(s.pBigSpell)}</td>
        </tr>`;
    }).join('');
    const sum = f => rows.reduce((a, r) => a + f(r.stats), 0);
    const anyBig = 1 - rows.reduce((a, r) => a * (1 - r.stats.pBigSpell), 1);
    const foot = rows.length > 1 ? `<tfoot><tr>
            <td>All ${countWord(rows.length)} opponents</td>
            <td data-label="Cards exiled">${fmt1(sum(s => s.avgCardsExiled))}</td>
            <td data-label="Spells">${fmt1(sum(s => s.avgCastable))}</td>
            <td data-label="Mana stolen">${fmt1(sum(s => s.avgCastableMV))}</td>
            <td data-label="A ${BIG_SPELL_MV}+ spell">${formatPct(anyBig)}<span class="opp-cell-sub">from at least one</span></td>
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
const MANA_LO = MV_THRESHOLD;
const MANA_HI = 10;

/** Mana-stolen buckets: "under 5" (only when it happens), 5…9, "10+". */
function manaBuckets(probs, withUnder) {
    const out = [];
    if (withUnder) out.push(probs.slice(0, MANA_LO).reduce((a, p) => a + (p || 0), 0));
    for (let v = MANA_LO; v < MANA_HI; v++) out.push(probs[v] || 0);
    out.push(probs.slice(MANA_HI).reduce((a, p) => a + (p || 0), 0));
    return out;
}

function multiplesHtml(rows) {
    const spellDists = rows.map(r => {
        const d = new Array(SPELL_CAP + 1).fill(0);
        r.stats.spellsProbs.forEach((p, i) => { d[Math.min(i, SPELL_CAP)] += p; });
        return d;
    });
    const withUnder = rows.some(r => r.stats.manaProbs.slice(0, MANA_LO).some(p => p > 0));
    const manaDists = rows.map(r => manaBuckets(r.stats.manaProbs, withUnder));
    const manaLabel = i => {
        const v = i + MANA_LO - (withUnder ? 1 : 0);
        if (withUnder && i === 0) return `<${MANA_LO}`;
        return v >= MANA_HI ? `${MANA_HI}+` : `${v}`;
    };
    const spellMax = Math.max(...spellDists.flat());
    const manaMax = Math.max(...manaDists.flat());
    const cells = rows.map((r, i) => `
        <div class="opp-multiple">
            <div class="opp-multiple-head">${opponentLabel(r.opp)}</div>
            ${miniBars({ title: 'Spells you can cast', probs: spellDists[i], label: v => (v === SPELL_CAP ? `${v}+` : `${v}`), scaleMax: spellMax, color: r.opp.color, dimFn: v => v === 0 })}
            ${miniBars({ title: 'Mana stolen', probs: manaDists[i], label: manaLabel, scaleMax: manaMax, color: r.opp.color })}
        </div>`).join('');
    return `<div class="opp-multiples">${cells}</div>
        <p class="opp-caption">How often each outcome happens, on the same scale for every opponent. The pile always reaches mana value 5, so what varies is whether it arrives as one big spell or several small ones.</p>`;
}

let lastSignature = null;
let sampleRound = 0;
let samplesShown = SAMPLE_BATCH;
const sampleCache = new Map();

function samplesFor(opp) {
    const key = `${objectId(opp.data)}:${sampleRound}`;
    if (!sampleCache.has(key)) {
        const revealer = createRevealer(libraryOf(opp.data));
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
            <div class="opp-game-head">Cast ${g + 1}${state.opponents.length > 1 ? ` · ${total} mana stolen in all` : ''}</div>
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
        ${renderDisclosure({ id: 'dreamharvest-spread', title: 'How often each outcome happens', body: multiplesHtml(rows), open: hasRoom(panel) })}`;
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

/** Render — only when the opponents (or their import state) changed. */
export function updateUI() {
    const state = readOpponents();
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
                    renderSamples(readOpponents());
                } else if (action === 'more') {
                    samplesShown = Math.min(SAMPLE_MAX, samplesShown + SAMPLE_BATCH);
                    renderSamples(readOpponents());
                }
            });
        }
    });
}
