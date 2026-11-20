/**
 * Ensnared by the Mara — {2}{R}{R} sorcery.
 *
 * Each opponent faces a villainous choice:
 *   • they exile cards from the top of their library until they exile a
 *     nonland card, and you may cast it without paying its mana cost; or
 *   • they exile their top four cards and Mara deals damage equal to the total
 *     mana value of those cards.
 *
 * Both options are worked out EXACTLY from each opponent's list: the free spell
 * is a uniformly random nonland card of their library, and the damage is a sum
 * over every possible set of four top cards. Sample casts are real shuffles,
 * for illustration only.
 */

import { registerCalculator, updateCalculatorIfActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats } from '../utils/components.js';
import { cardRef, escapeHtml } from '../data/glossary.js';
import * as OpponentState from '../utils/opponentState.js';
import {
    libraryOf, isLandCard, createRevealer, typicalRange, formatRange, formatPct, fmt1, tailAtLeast,
    capDistribution, countWord, objectId, readOpponents, frameScheduler, opponentLabel, cardChip, miniBars,
    renderOpponentPlaceholder, renderLoadingNote, bindOpponentActions, renderDisclosure, hasRoom
} from '../utils/opponentPages.js';

/** Mara's own mana value — what the free spells are measured against. */
export const MARA_COST = 4;
/** Cards exiled by the damage option. */
const DAMAGE_CARDS = 4;
/** "Big" outcomes called out in the table. */
const BIG_SPELL_MV = 5;
const BIG_DAMAGE = 10;

const SAMPLE_BATCH = 3;
const SAMPLE_MAX = 24;

// ── Mechanics ───────────────────────────────────────────────────────────────

/**
 * Choice 1 on a shuffled library: exile until a nonland card.
 * @param {Array} deck - shuffled library (top first)
 * @returns {{cardsExiled:number, spellCMC:number, spellName:string|null, spellTypes:string[]}}
 */
export function simulateChoice1(deck) {
    for (let i = 0; i < deck.length; i++) {
        if (!isLandCard(deck[i])) {
            return {
                cardsExiled: i + 1,
                spellCMC: deck[i].cmc || 0,
                spellName: deck[i].name,
                spellTypes: deck[i].types
            };
        }
    }
    // A library of nothing but lands: everything is exiled and nothing is cast.
    return { cardsExiled: deck.length, spellCMC: 0, spellName: null, spellTypes: [] };
}

/**
 * Choice 2 on a shuffled library: the top four cards' total mana value.
 * @param {Array} deck - shuffled library (top first)
 * @returns {{damage:number, cards:Array<{name:string, cmc:number, types:string[]}>}}
 */
export function simulateChoice2(deck) {
    const top = deck.slice(0, DAMAGE_CARDS);
    return {
        damage: top.reduce((sum, card) => sum + (card.cmc || 0), 0),
        cards: top.map(c => ({ name: c.name, cmc: c.cmc || 0, types: c.types }))
    };
}

function choose(n, k) {
    if (k < 0 || k > n) return 0;
    const m = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= m; i++) r = (r * (n - m + i)) / i;
    return r;
}

/**
 * Exact distribution of the total mana value of `draw` cards taken from the top
 * of a shuffled library (drawing without replacement): counts every possible
 * set of cards by mana-value group.
 * @param {Array<{cmc:number}>} library
 * @param {number} [draw=4]
 * @returns {number[]} probability by total (index = total mana value)
 */
export function topCardsTotalDistribution(library, draw = DAMAGE_CARDS) {
    const n = library.length;
    const k = Math.min(draw, n);
    if (n === 0) return [1];

    const groups = new Map();
    for (const card of library) {
        const mv = Math.max(0, Math.round(card.cmc || 0));
        groups.set(mv, (groups.get(mv) ?? 0) + 1);
    }
    const sorted = library.map(c => Math.max(0, Math.round(c.cmc || 0))).sort((a, b) => b - a);
    const maxTotal = sorted.slice(0, k).reduce((a, b) => a + b, 0);

    // ways[picked][total] = number of ways to pick `picked` cards totalling `total`
    let ways = Array.from({ length: k + 1 }, () => new Float64Array(maxTotal + 1));
    ways[0][0] = 1;
    for (const [mv, count] of groups) {
        const next = Array.from({ length: k + 1 }, () => new Float64Array(maxTotal + 1));
        for (let picked = 0; picked <= k; picked++) {
            const row = ways[picked];
            for (let total = 0; total <= maxTotal; total++) {
                const w = row[total];
                if (!w) continue;
                for (let j = 0; j <= Math.min(count, k - picked); j++) {
                    const t = total + j * mv;
                    if (t > maxTotal) break;
                    next[picked + j][t] += w * choose(count, j);
                }
            }
        }
        ways = next;
    }
    const all = choose(n, k);
    return Array.from(ways[k], w => w / all);
}

/**
 * Exact statistics for both options against one opponent list.
 * @param {Object} opponentData - deck data with cardsByName
 * @returns {Object|null}
 */
export function calculateMaraStats(opponentData) {
    if (!opponentData?.cardsByName || Object.keys(opponentData.cardsByName).length === 0) return null;
    const library = libraryOf(opponentData);
    const n = library.length;
    if (n === 0) return null;

    const spells = library.filter(c => !c.land);
    const s = spells.length;
    const spellMvSum = spells.reduce((a, c) => a + c.cmc, 0);
    const mvProbs = [];
    for (const card of spells) {
        const mv = Math.round(card.cmc);
        mvProbs[mv] = (mvProbs[mv] ?? 0) + 1 / s;
    }
    for (let i = 0; i < mvProbs.length; i++) mvProbs[i] = mvProbs[i] ?? 0;

    const damageProbs = topCardsTotalDistribution(library, DAMAGE_CARDS);
    const k = Math.min(DAMAGE_CARDS, n);
    const allMv = library.map(c => c.cmc).sort((a, b) => a - b);
    const totalMv = allMv.reduce((a, b) => a + b, 0);

    return {
        choice1: {
            avgCMC: s ? spellMvSum / s : 0,
            // Position of the first nonland card in a shuffled library: (N + 1) / (S + 1).
            avgExiled: s ? (n + 1) / (s + 1) : n,
            pct5Plus: s ? (spells.filter(c => c.cmc >= BIG_SPELL_MV).length / s) * 100 : 0,
            mvProbs,
            typical: s ? typicalRange(mvProbs) : [0, 0]
        },
        choice2: {
            avgDamage: (k * totalMv) / n,
            minDamage: allMv.slice(0, k).reduce((a, b) => a + b, 0),
            maxDamage: allMv.slice(-k).reduce((a, b) => a + b, 0),
            damageProbs,
            pct10Plus: tailAtLeast(damageProbs, BIG_DAMAGE) * 100,
            typical: typicalRange(damageProbs)
        },
        deckSize: n,
        landCount: n - s,
        nonlandCount: s
    };
}

const statsCache = new WeakMap();
function statsFor(data) {
    if (!statsCache.has(data)) statsCache.set(data, calculateMaraStats(data));
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
    if (total >= 2 * MARA_COST) return `more than twice Mara’s ${MARA_COST}-mana cost`;
    if (total >= MARA_COST) return `more than Mara’s ${MARA_COST}-mana cost`;
    return `less than Mara’s ${MARA_COST}-mana cost`;
}

/**
 * The bottom line for a table of opponents.
 * @param {Array<{name:string, stats:Object}>} rows
 * @returns {{html:string, tone:'good'|'warn'|'flat'}}
 */
export function summarizeMara(rows) {
    const valid = (rows ?? []).filter(r => r?.stats);
    if (valid.length === 0) return { html: '', tone: 'flat' };
    const spells = valid.map(r => r.stats.choice1.avgCMC);
    const damage = valid.map(r => r.stats.choice2.avgDamage);
    const totalSpell = spells.reduce((a, b) => a + b, 0);
    const totalDamage = damage.reduce((a, b) => a + b, 0);
    const tone = totalSpell >= MARA_COST ? 'good' : 'warn';

    if (valid.length === 1) {
        return {
            tone,
            html: `Against ${escapeHtml(valid[0].name)}, Mara either hands you a free spell worth <strong>${spread(spells, 'mana')}</strong> or deals <strong>${spread(damage, 'damage')}</strong> — they choose before anything is revealed. On its own, the spell is worth ${versusCost(totalSpell)}.`
        };
    }
    return {
        tone,
        html: `Each of the ${countWord(valid.length)} opponents either hands you a free spell worth <strong>${spread(spells, 'mana')}</strong> or takes <strong>${spread(damage, 'damage')}</strong> — their choice. Across the table that’s <strong>${fmt1(totalSpell)} mana</strong> of free spells (${versusCost(totalSpell)}), <strong>${fmt1(totalDamage)} damage</strong>, or a mix.`
    };
}

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
            label: 'Free spell', size: 'big', value: fmt1(avg(s => s.choice1.avgCMC)), sub: `mana value${each}`,
            tip: 'If an opponent picks the spell: the average mana value of the first nonland card in their library — the one you cast for free.'
        },
        {
            label: 'Or damage', value: fmt1(avg(s => s.choice2.avgDamage)), sub: n > 1 ? 'average opponent' : 'average',
            tip: 'If an opponent picks damage: the average total mana value of their top four cards. Lands count as 0.'
        },
        {
            label: 'Big spell', value: formatPct(avg(s => s.choice1.pct5Plus) / 100), sub: `free spell costs ${BIG_SPELL_MV} or more`,
            tip: `Chance the free spell has mana value ${BIG_SPELL_MV} or more.`
        },
        {
            label: 'Big hit', value: formatPct(avg(s => s.choice2.pct10Plus) / 100), sub: `${BIG_DAMAGE} or more damage`,
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
            <td data-label="Free spell">${fmt1(c1.avgCMC)}<span class="opp-cell-sub">usually ${formatRange(c1.typical)} mana</span></td>
            <td data-label="Costs ${BIG_SPELL_MV}+">${formatPct(c1.pct5Plus / 100)}</td>
            <td data-label="Damage">${fmt1(c2.avgDamage)}<span class="opp-cell-sub">usually ${formatRange(c2.typical)}</span></td>
            <td data-label="${BIG_DAMAGE}+ damage">${formatPct(c2.pct10Plus / 100)}</td>
        </tr>`;
    }).join('');
    const foot = rows.length > 1 ? `<tfoot><tr>
            <td>All ${countWord(rows.length)} opponents</td>
            <td data-label="Free spells">${fmt1(rows.reduce((a, r) => a + r.stats.choice1.avgCMC, 0))}<span class="opp-cell-sub">mana if all pick the spell</span></td>
            <td data-label=""></td>
            <td data-label="Damage">${fmt1(rows.reduce((a, r) => a + r.stats.choice2.avgDamage, 0))}<span class="opp-cell-sub">if all pick damage</span></td>
            <td data-label=""></td>
        </tr></tfoot>` : '';
    return `<div class="opp-table-wrap"><table class="opp-table">
        <thead><tr>
            <th scope="col">Opponent</th>
            <th scope="col">Free spell</th>
            <th scope="col">Costs ${BIG_SPELL_MV}+</th>
            <th scope="col">Damage</th>
            <th scope="col">${BIG_DAMAGE}+ damage</th>
        </tr></thead>
        <tbody>${body}</tbody>${foot}
    </table></div>`;
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
        <p class="opp-caption">How often each outcome happens. Every opponent is drawn on the same scale, so a longer bar means more likely — compare across columns.</p>`;
}

let lastSignature = null;
let sampleRound = 0;
let samplesShown = SAMPLE_BATCH;
const sampleCache = new Map();

/** One sample cast against one library: the reveal for each option, from the same shuffle. */
function sampleCast(library) {
    const revealer = createRevealer(library);
    const seen = [];
    let spellAt = -1;
    while (spellAt < 0 || seen.length < DAMAGE_CARDS) {
        const card = revealer.reveal();
        if (!card) break;
        seen.push(card);
        if (spellAt < 0 && !card.land) spellAt = seen.length - 1;
    }
    return {
        spellRun: spellAt >= 0 ? seen.slice(0, spellAt + 1) : seen,
        spell: spellAt >= 0 ? seen[spellAt] : null,
        top: seen.slice(0, DAMAGE_CARDS)
    };
}

function samplesFor(opp) {
    const key = `${objectId(opp.data)}:${sampleRound}`;
    if (!sampleCache.has(key)) {
        const library = libraryOf(opp.data);
        sampleCache.set(key, Array.from({ length: SAMPLE_MAX }, () => sampleCast(library)));
    }
    return sampleCache.get(key);
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

function renderSamples(state) {
    const panel = document.getElementById('mara-sample-reveals');
    if (!panel) return;
    if (state.opponents.length === 0) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }
    panel.hidden = false;
    const casts = state.opponents.map(opp => samplesFor(opp));
    const games = Array.from({ length: samplesShown }, (_, g) => `
        <div class="opp-game">
            <div class="opp-game-head">Cast ${g + 1}</div>
            ${state.opponents.map((opp, i) => gameRow(opp, casts[i][g])).join('')}
        </div>`).join('');
    panel.innerHTML = `
        <div class="opp-section-head">
            <div>
                <h2 class="opp-section-title">Sample casts</h2>
                <p class="opp-section-sub">Real shuffles of each list. Both options come from the same shuffle — the opponent only gets one.</p>
            </div>
            <div class="opp-section-actions"><button type="button" class="btn btn-ghost btn-sm" data-mara-action="reshuffle">Reshuffle</button></div>
        </div>
        <div class="mara-game-cols" aria-hidden="true"><span></span><span>If they give you a spell</span><span>If they take damage</span></div>
        <div class="opp-games">${games}</div>
        ${samplesShown < SAMPLE_MAX ? '<div class="opp-more"><button type="button" class="btn btn-ghost btn-sm" data-mara-action="more">Show more casts</button></div>' : ''}`;
}

function renderResults(state) {
    const panel = document.getElementById('mara-results');
    if (!panel) return;
    if (state.opponents.length === 0) {
        panel.innerHTML = renderOpponentPlaceholder(PLACEHOLDER, state);
        return;
    }
    const rows = state.opponents.map(opp => ({ opp, name: opp.name, stats: statsFor(opp.data) })).filter(r => r.stats);
    const line = summarizeMara(rows);
    panel.innerHTML = `
        ${renderLoadingNote(state)}
        ${renderBottomLine(line)}
        ${heroStats(rows)}
        <div class="opp-section-head">
            <h2 class="opp-section-title">Opponent by opponent</h2>
            <span class="opp-section-sub">Exact odds from each list</span>
        </div>
        ${tableHtml(rows)}
        ${renderDisclosure({ id: 'mara-spread', title: 'How often each outcome happens', body: multiplesHtml(rows), open: hasRoom(panel) })}`;
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
    if (state.signature === lastSignature && document.getElementById('mara-results')?.firstElementChild) return;
    lastSignature = state.signature;
    samplesShown = SAMPLE_BATCH;
    // Keep the sample casts of decks that are still loaded; drop the rest.
    const live = new Set(state.opponents.map(o => String(objectId(o.data))));
    for (const key of sampleCache.keys()) if (!live.has(key.split(':')[0])) sampleCache.delete(key);
    renderResults(state);
    renderSamples(state);
}

export function init() {
    const scheduleRender = frameScheduler(() => updateCalculatorIfActive('mara', updateUI));
    OpponentState.onOpponentChange(scheduleRender);

    registerCalculator({
        name: 'mara',
        calculate,
        updateUI,
        init: () => {
            const root = document.getElementById('mara-tab');
            bindOpponentActions(root);
            root?.addEventListener('click', e => {
                const action = e.target.closest('[data-mara-action]')?.dataset.maraAction;
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
