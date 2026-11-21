/**
 * Land Drops — "How reliably will I hit a land drop every turn?"
 *
 * The maths lives in utils/landDrops.js (exact, pure, tested). This module
 * reads the deck, applies the three settings that change the answer (turn
 * order, mulligans, counting cheap ramp), and renders. Nothing here simulates
 * except the optional sample games, which are dealt only when opened.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor } from '../utils/components.js';
import { escapeHtml } from '../data/glossary.js';
import { tagDeck } from '../utils/cardTags.js';
import { isLand, libraryOf, unlistedCopies } from '../utils/library.js';
import { shuffle } from '../utils/random.js';
import { createCache } from '../utils/simulation.js';
import {
    DEFAULT_KEEP, DEFAULT_TURNS, landDropOdds, openingLands, firstLikelyMiss,
    landCountComparison, chanceWords, chanceTone, summarizeLandDrops
} from '../utils/landDrops.js';
import { drawSchedule, bottomCount } from '../utils/mulliganModel.js';
import { pct } from '../utils/text.js';

const NAME = 'lands';
const HAND = 7;
const CHEAP_RAMP_MV = 3;
const GAMES_STEP = 4;

let onPlay = true;
let countRamp = false;
let mulligans = true;
let keepRange = [...DEFAULT_KEEP];

const cache = createCache(40);
let rampCache = { ref: null, ramp: 0, lands: 0, cards: [] };
let samples = { key: null, games: [], shown: GAMES_STEP };
let sampleSeed = 0;

const $ = id => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// ── Deck ─────────────────────────────────────────────────────────────────────

/**
 * Lands and cheap ramp in the library (cached per library). Commanders are
 * never in the library (see library.js), so a commander that ramps is not
 * counted as a card you might draw.
 */
function deckCounts(config, format) {
    const hasList = DeckConfig.hasCardList();
    const library = hasList ? libraryOf(config, { format }) : null;
    if (rampCache.ref !== library) {
        const cards = library ? library.cards.slice() : [];
        const tags = library ? tagDeck(library.cards).byCard : {};
        let lands = 0;
        let ramp = 0;
        const rampNames = new Set();
        cards.forEach(c => {
            const n = c.count;
            if (isLand(c)) lands += n;
            else if ((tags[c.name] ?? []).includes('ramp') && (Number(c.cmc) || 0) <= CHEAP_RAMP_MV) {
                ramp += n;
                rampNames.add(c.name);
            }
        });
        rampCache = { ref: library, size: library?.size ?? 0, lands, ramp, cards, rampNames };
    }
    return { hasList, ...rampCache };
}

/**
 * Deck size, land count and settings.
 * @returns {{deckSize:number, landCount:number, ramp:number, format:Object, onPlay:boolean, countRamp:boolean, keepRange:[number,number]|null, hasList:boolean}}
 */
export function readInputs() {
    const format = DeckConfig.getFormat();
    const config = DeckConfig.getDeckConfig();
    const deck = deckCounts(config, format);
    const deckSize = deck.hasList
        ? deck.size + unlistedCopies(deck.ref, config.actualCardCount)
        : DeckConfig.getDeckSize(true);
    const landCount = deck.hasList ? deck.lands : (Number(config.lands) || 0);
    return {
        deckSize,
        landCount,
        ramp: deck.hasList ? deck.ramp : 0,
        format,
        onPlay: format.firstPlayerDraws ? true : onPlay,
        countRamp: countRamp && deck.hasList && deck.ramp > 0,
        keepRange: mulligans ? keepRange.slice() : null,
        hasList: deck.hasList
    };
}

function oddsParams(config, extra = {}) {
    return {
        deckSize: config.deckSize,
        lands: config.landCount,
        ramp: config.countRamp ? config.ramp : 0,
        format: config.format,
        onPlay: config.onPlay,
        keepRange: config.keepRange,
        freeMulligan: config.format.freeMulligan,
        turns: DEFAULT_TURNS,
        ...extra
    };
}

// ── Older entry points (kept for callers and tests) ─────────────────────────

/** Opening-seven land distribution and its median. */
export function calculateOpeningHands(deckSize, landCount) {
    const dist = openingLands(deckSize, landCount);
    let cumulative = 0;
    let median = 0;
    let found = false;
    const distribution = dist.map((probability, lands) => {
        cumulative += probability;
        if (!found && cumulative >= 0.5) {
            median = lands;
            found = true;
        }
        return { lands, probability };
    });
    return { distribution, median };
}

/** Turn-by-turn chance of having made every land drop (no mulligans, current turn order). */
export function calculateLandDropByTurn(deckSize, landCount) {
    const format = DeckConfig.getFormat();
    return landDropOdds({ deckSize, lands: landCount, format, onPlay: format.firstPlayerDraws ? true : onPlay, turns: 10 })
        .byTurn.map(t => ({ turn: t.turn, makeProbability: t.chance, missProbability: 1 - t.chance }));
}

/** First turn by which you have more likely than not missed a land drop (no mulligans). */
export function calculateLandDropMiss(deckSize, landCount) {
    if (landCount <= 0) return 1;
    if (landCount >= deckSize) return Infinity;
    const byTurn = calculateLandDropByTurn(deckSize, landCount).map(t => ({ turn: t.turn, chance: t.makeProbability }));
    return firstLikelyMiss(byTurn) ?? Infinity;
}

// ── Calculation ──────────────────────────────────────────────────────────────

/**
 * Everything the page shows, cached by inputs.
 */
export function calculate() {
    const config = readInputs();
    if (config.deckSize <= HAND || config.landCount <= 0) {
        return { config, openingHands: null, landDropMiss: null, landDropByTurn: null };
    }
    const key = JSON.stringify([config.deckSize, config.landCount, config.ramp, config.format.key, config.onPlay, config.countRamp, config.keepRange]);
    const hit = cache.get(key);
    if (hit) return { ...hit, config };

    const odds = landDropOdds(oddsParams(config));
    const landsOnly = config.countRamp ? landDropOdds(oddsParams(config, { ramp: 0 })).byTurn : null;
    const withRamp = !config.countRamp && config.ramp > 0 ? landDropOdds(oddsParams(config, { ramp: config.ramp })).byTurn : null;
    // Offer the ramp switch only when ramp moves some mid-game turn by 2+ points.
    const a = landsOnly ?? odds.byTurn;
    const b = withRamp ?? odds.byTurn;
    const rampMatters = config.ramp > 0 && a.some((t, i) => t.turn >= 3 && t.turn <= 6 && Math.abs((b[i]?.chance ?? 0) - t.chance) >= 0.02);
    const compare = landCountComparison(oddsParams(config));
    const openingHands = calculateOpeningHands(config.deckSize, config.landCount);
    const firstMiss = firstLikelyMiss(odds.byTurn);
    const summary = summarizeLandDrops({
        lands: config.landCount, deckSize: config.deckSize, byTurn: odds.byTurn,
        withRamp, landsOnly, ramp: config.ramp, countingRamp: config.countRamp
    });
    const result = {
        key,
        odds: odds.byTurn,
        keepRate: odds.keepRate,
        landsOnly,
        withRamp,
        rampMatters,
        compare,
        openingHands,
        firstMiss,
        summary,
        landDropMiss: firstMiss ?? Infinity,
        landDropByTurn: odds.byTurn.map(t => ({ turn: t.turn, makeProbability: t.chance, missProbability: 1 - t.chance }))
    };
    cache.set(key, result);
    return { ...result, config };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function syncControls(config, rampMatters = false) {
    const order = $('lands-turn-order');
    if (order) {
        order.hidden = !!config.format.firstPlayerDraws;
        (order.querySelectorAll?.('[data-play]') ?? []).forEach(btn => {
            const on = (btn.dataset.play === '1') === config.onPlay;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
    }
    const note = $('lands-format-note');
    if (note) note.textContent = config.format.firstPlayerDraws ? 'Commander: everyone draws on turn one.' : '';
    const mull = $('lands-mull');
    if (mull) mull.checked = mulligans;
    const deck = deckCounts();
    const rampWrap = $('lands-ramp-wrap');
    if (rampWrap) rampWrap.hidden = !(deck.hasList && deck.ramp > 0 && (rampMatters || countRamp));
    const rampBox = $('lands-ramp');
    if (rampBox) rampBox.checked = countRamp;
    const rampLabel = $('lands-ramp-label');
    if (rampLabel) rampLabel.textContent = `Count ${deck.ramp} cheap ramp card${deck.ramp === 1 ? '' : 's'} (mana value ${CHEAP_RAMP_MV} or less) as land drops`;
}

function renderHero(config, r) {
    const el = $('lands-hero');
    if (!el) return;
    const at = turn => r.odds.find(t => t.turn === turn)?.chance ?? 0;
    const dist = r.openingHands.distribution;
    const avg = dist.reduce((s, d) => s + d.lands * d.probability, 0);
    const range = config.keepRange ?? DEFAULT_KEEP;
    const inRange = dist.slice(range[0], range[1] + 1).reduce((s, d) => s + d.probability, 0);
    el.innerHTML = renderHeroStats([
        { label: 'Through turn 4', value: pct(at(4)), size: 'big', color: toneColor(r.summary.tone), sub: 'every land drop made', tip: 'Chance you have played a land on each of your first four turns.' },
        { label: 'Through turn 3', value: pct(at(3)), sub: 'every land drop made', color: toneColor(chanceTone(at(3)) === 'flat' ? 'bad' : chanceTone(at(3))) },
        { label: 'First likely miss', value: r.firstMiss ? `Turn ${r.firstMiss}` : `After ${DEFAULT_TURNS}`, sub: 'most games have missed one by then', tip: 'The first turn by which more than half of games have missed at least one land drop.' },
        { label: 'Lands in your seven', value: avg.toFixed(1), sub: `on average · ${pct(inRange)} have ${range[0]}–${range[1]}`, tip: 'Average lands in a random opening seven, before any mulligan.' }
    ]);
}

function renderLadder(config, r) {
    const el = $('lands-ladder');
    if (!el) return;
    const compareTo = r.landsOnly ?? null;
    el.innerHTML = `<ol class="ld-ladder">${r.odds.map(t => {
        const tone = chanceTone(t.chance);
        const isMiss = r.firstMiss === t.turn;
        const ghost = compareTo?.find(x => x.turn === t.turn)?.chance;
        const words = chanceWords(t.chance);
        const note = isMiss
            ? '<small class="ld-flag">most games have missed one by now</small>'
            : (ghost !== undefined ? `<small>lands alone ${pct(ghost)}</small>` : `<small>${t.seen} cards seen</small>`);
        return `
            <li class="ld-row tone-${tone}">
                <span class="ld-turn">Turn ${t.turn}</span>
                <span class="ld-bar" role="img" aria-label="${pct(t.chance)}">
                    <span class="ld-fill" style="width:${(t.chance * 100).toFixed(1)}%"></span>
                    ${ghost !== undefined ? `<span class="ld-ghost" style="left:${(ghost * 100).toFixed(1)}%" aria-hidden="true"></span>` : ''}
                </span>
                <span class="ld-pct">${pct(t.chance)}</span>
                <span class="ld-words">${words.charAt(0).toUpperCase() + words.slice(1)}${note}</span>
            </li>`;
    }).join('')}</ol>`;
}

function renderOpening(config, r) {
    const el = $('lands-opening');
    if (!el) return;
    const dist = r.openingHands.distribution;
    const max = Math.max(...dist.map(d => d.probability), 0.0001);
    const range = config.keepRange;
    const meta = $('lands-opening-meta');
    if (meta) meta.textContent = `${config.landCount} lands in ${config.deckSize} cards`;
    el.innerHTML = `
        <div class="ld-dist">
            <div class="ld-cols" role="img" aria-label="Chance of 0 to 7 lands in an opening seven">
                ${dist.map(d => {
                    const keep = range ? d.lands >= range[0] && d.lands <= range[1] : true;
                    return `<div class="ld-col${keep ? ' is-keep' : ''}" data-tip="${d.lands} land${d.lands === 1 ? '' : 's'}: ${pct(d.probability)} of sevens">
                        <span class="ld-col-val">${pct(d.probability)}</span>
                        <span class="ld-col-track"><span class="ld-col-fill" style="height:${((d.probability / max) * 100).toFixed(1)}%"></span></span>
                        <span class="ld-col-label">${d.lands}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <p class="ld-caption">${range
            ? `Lands in a random seven. Shaded: the hands you keep (${range[0]}–${range[1]} lands) — ${pct(r.keepRate)} of sevens.`
            : 'Lands in a random seven. You are keeping every seven.'}</p>`;
}

function renderCompare(config, r) {
    const el = $('lands-compare');
    if (!el) return;
    const turns = [3, 4, 5];
    const base = r.compare.find(row => row.delta === 0);
    const range = config.keepRange ?? DEFAULT_KEEP;
    const at = (row, turn) => row.byTurn.find(t => t.turn === turn)?.chance ?? 0;
    const diff = (v, b) => {
        const pts = Math.round((v - b) * 100);
        return pts === 0 ? '±0' : `${pts > 0 ? '+' : '−'}${Math.abs(pts)}`;
    };
    el.innerHTML = `
        <div class="ld-wrap">
            <table class="ld-table">
                <thead><tr><th>Lands</th>${turns.map(t => `<th>Turn ${t}</th>`).join('')}<th>Sevens with ${range[0]}–${range[1]}</th></tr></thead>
                <tbody>${r.compare.map(row => {
                    const cur = row.delta === 0;
                    const cell = (v, b) => `${pct(v)}${cur || !base ? '' : `<span class="ld-diff">${diff(v, b)}</span>`}`;
                    return `<tr class="${cur ? 'is-current' : ''}">
                        <td>${row.lands}${cur ? '<span class="ld-you">your deck</span>' : ''}</td>
                        ${turns.map(t => `<td>${cell(at(row, t), base ? at(base, t) : 0)}</td>`).join('')}
                        <td>${cell(row.sevens, base?.sevens ?? 0)}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>
        <p class="ld-caption">Chance of making every land drop through each turn, with your settings above. Small numbers are the change in points from your deck.</p>`;
}

// ── Sample games ─────────────────────────────────────────────────────────────

/**
 * Deal sample games from a card pool and track land drops turn by turn.
 *
 * @param {Object} p
 * @param {Array<{name:string, kind:'land'|'ramp'|'spell'}>} p.pool
 * @param {(turn:number)=>number} p.drawsBy
 * @param {[number,number]|null} p.keepRange
 * @param {boolean} p.freeMulligan
 * @param {boolean} p.countRamp
 * @param {number} [p.games]
 * @param {number} [p.turns]
 * @param {() => number} [p.rng]
 */
export function dealLandGames({ pool, drawsBy, keepRange, freeMulligan, countRamp, games = 12, turns = DEFAULT_TURNS, rng = Math.random }) {
    const isSource = c => c.kind === 'land' || (countRamp && c.kind === 'ramp');
    const order = pool.map((_, i) => i);
    const out = [];
    for (let g = 0; g < games; g++) {
        let mulls = 0;
        let seven;
        for (;;) {
            shuffle(order, rng);
            seven = order.slice(0, HAND);
            const lands = seven.filter(i => pool[i].kind === 'land').length;
            if (!keepRange || (lands >= keepRange[0] && lands <= keepRange[1]) || mulls >= 6) break;
            mulls++;
        }
        // Bottom spells first, then ramp, then lands.
        const bottom = bottomCount(mulls, freeMulligan);
        const rank = i => (pool[i].kind === 'spell' ? 0 : pool[i].kind === 'ramp' ? 1 : 2);
        const bottomed = new Set(seven.map((ci, k) => ({ k, r: rank(ci) })).sort((a, b) => a.r - b.r || b.k - a.k).slice(0, bottom).map(x => x.k));
        let sources = seven.filter((ci, k) => !bottomed.has(k) && isSource(pool[ci])).length;
        const draws = order.slice(HAND, HAND + drawsBy(turns));
        const drops = [];
        let played = 0;
        let firstMiss = null;
        for (let t = 1; t <= turns; t++) {
            for (let d = drawsBy(t - 1); d < drawsBy(t); d++) if (draws[d] !== undefined && isSource(pool[draws[d]])) sources++;
            const made = sources > played;
            if (made) played++;
            else if (firstMiss === null) firstMiss = t;
            drops.push(made);
        }
        out.push({ mulls, seven, bottomed, draws, drops, firstMiss });
    }
    return out;
}

function samplePool(deck) {
    const pool = [];
    deck.cards.forEach(c => {
        const kind = isLand(c) ? 'land' : deck.rampNames?.has(c.name) ? 'ramp' : 'spell';
        for (let k = 0; k < Number(c.count); k++) pool.push({ name: c.name, kind });
    });
    return pool;
}

function card(c, bottomed = false) {
    const cls = `ld-card${c.kind !== 'spell' ? ` is-${c.kind}` : ''}${bottomed ? ' is-bottom' : ''}`;
    const dot = c.kind !== 'spell' ? '<span class="ld-card-dot" aria-hidden="true"></span>' : '';
    return `<span class="${cls}" data-card="${escapeHtml(c.name)}" tabindex="0"${bottomed ? ' title="Put on the bottom"' : ''}>${dot}${escapeHtml(c.name)}${bottomed ? ' (bottom)' : ''}</span>`;
}

/** Deal (or reuse) sample games and render them. Only runs while the section is open. */
export function runSampleReveals() {
    const display = $('lands-reveals-display');
    if (!display) return;
    const deck = deckCounts();
    if (!deck.hasList) {
        display.innerHTML = '<p class="ld-empty">Import a decklist to deal sample games from your real cards.</p>';
        return;
    }
    const details = $('lands-samples-details');
    if (details && details.open === false) return;
    const config = readInputs();
    const drawsBy = drawSchedule({ format: config.format, onPlay: config.onPlay });
    const key = JSON.stringify([config.format.key, config.onPlay, config.countRamp, config.keepRange, sampleSeed]);
    if (samples.key !== key || samples.ref !== deck.ref) {
        const pool = samplePool(deck);
        samples = {
            key, ref: deck.ref, shown: GAMES_STEP, pool,
            games: dealLandGames({ pool, drawsBy, keepRange: config.keepRange, freeMulligan: config.format.freeMulligan, countRamp: config.countRamp, games: 24 })
        };
    }
    const html = samples.games.slice(0, samples.shown).map((g, i) => {
        const turns = [];
        for (let t = 1; t <= DEFAULT_TURNS; t++) {
            for (let d = drawsBy(t - 1); d < drawsBy(t); d++) {
                if (g.draws[d] !== undefined) turns.push(`<span class="ld-draw"><span class="ld-turnmark">T${t}</span>${card(samples.pool[g.draws[d]])}</span>`);
            }
        }
        const result = g.firstMiss
            ? `<span class="ld-result is-warn">First missed drop: turn ${g.firstMiss}</span>`
            : `<span class="ld-result is-good">Every drop through turn ${DEFAULT_TURNS}</span>`;
        return `
            <article class="ld-game">
                <div class="ld-game-head"><span><strong>Game ${i + 1}</strong>${g.mulls ? ` · ${g.mulls} mulligan${g.mulls > 1 ? 's' : ''}` : ''}</span>${result}</div>
                <div class="ld-line"><span class="ld-line-label">Hand</span><div class="ld-cards">${g.seven.map((ci, k) => card(samples.pool[ci], g.bottomed.has(k))).join('')}</div></div>
                <div class="ld-line"><span class="ld-line-label">Draws</span><div class="ld-cards">${turns.join('') || '<span class="ld-turnmark">none</span>'}</div></div>
                <div class="ld-line"><span class="ld-line-label">Land drops</span><div class="ld-drops">${g.drops.map((made, t) => `<span class="ld-drop ${made ? 'is-made' : 'is-missed'}" title="Turn ${t + 1}: ${made ? 'made' : 'missed'}">T${t + 1} ${made ? '✓' : '✕'}</span>`).join('')}</div></div>
            </article>`;
    }).join('');
    display.innerHTML = `
        <div class="ld-games">${html}</div>
        <div class="ld-samples-foot">
            ${samples.shown < samples.games.length ? `<button type="button" class="btn btn-ghost btn-sm" id="lands-more-games">Deal ${GAMES_STEP} more</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" id="lands-draw-reveals-btn">Shuffle again</button>
        </div>`;
}

/** Re-render the page (cheap: results are cached by inputs). */
export function updateUI() {
    const r = calculate();
    const { config } = r;
    syncControls(config, !!r.rampMatters);
    const summary = $('lands-summary');
    if (!r.odds) {
        if (summary) summary.innerHTML = renderBottomLine({ html: 'Add lands to your deck to see how reliably you hit your land drops.', tone: 'flat' });
        ['lands-hero', 'lands-ladder', 'lands-opening', 'lands-compare'].forEach(id => { const el = $(id); if (el) el.innerHTML = ''; });
        return;
    }
    if (summary) summary.innerHTML = renderBottomLine(r.summary);
    renderHero(config, r);
    renderLadder(config, r);
    renderOpening(config, r);
    renderCompare(config, r);
    runSampleReveals();
}

// ── Sharing ──────────────────────────────────────────────────────────────────

/** Settings for share links. */
export function getShareParams() {
    const params = {};
    if (!onPlay && !DeckConfig.getFormat().firstPlayerDraws) params.ldDraw = 1;
    if (countRamp) params.ldRamp = 1;
    if (!mulligans) params.ldMull = 0;
    if (keepRange[0] !== DEFAULT_KEEP[0] || keepRange[1] !== DEFAULT_KEEP[1]) params.ldKeep = `${keepRange[0]}-${keepRange[1]}`;
    return params;
}

/** Apply getShareParams() output; every value is validated. */
export function applyShareParams(params) {
    if (!params?.get) return;
    if (params.get('ldDraw') === '1') onPlay = false;
    if (params.get('ldRamp') === '1') countRamp = true;
    if (params.get('ldMull') === '0') mulligans = false;
    const keep = /^(\d)-(\d)$/.exec(params.get('ldKeep') ?? '');
    if (keep && Number(keep[1]) <= Number(keep[2])) keepRange = [Number(keep[1]), Number(keep[2])];
    syncKeepInputs();
    updateUI();
}

function syncKeepInputs() {
    const lo = $('lands-keep-min');
    const hi = $('lands-keep-max');
    if (lo) lo.value = keepRange[0];
    if (hi) hi.value = keepRange[1];
}

// ── Init ─────────────────────────────────────────────────────────────────────

function readKeepRange() {
    const lo = parseInt($('lands-keep-min')?.value, 10);
    const hi = parseInt($('lands-keep-max')?.value, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    const a = Math.min(7, Math.max(0, lo));
    const b = Math.min(7, Math.max(0, hi));
    if (a > b) return false;
    keepRange = [a, b];
    return true;
}

function bindEvents() {
    const root = $(`${NAME}-tab`);
    if (!root?.addEventListener) return;
    root.addEventListener('click', e => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;
        const play = target.closest('[data-play]');
        if (play) {
            onPlay = play.dataset.play === '1';
            updateUI();
        } else if (target.closest('#lands-more-games')) {
            samples.shown += GAMES_STEP;
            runSampleReveals();
        } else if (target.closest('#lands-draw-reveals-btn')) {
            sampleSeed++;
            runSampleReveals();
        }
    });
    root.addEventListener('change', e => {
        const el = e.target;
        if (el?.id === 'lands-mull') {
            mulligans = el.checked;
            updateUI();
        } else if (el?.id === 'lands-ramp') {
            countRamp = el.checked;
            updateUI();
        } else if (el?.id === 'lands-keep-min' || el?.id === 'lands-keep-max') {
            if (readKeepRange()) {
                mulligans = true;
                updateUI();
            } else {
                syncKeepInputs();
            }
        }
    });
    $('lands-samples-details')?.addEventListener('toggle', () => runSampleReveals());
}

/** Initialise the page. */
export function init() {
    registerCalculator({ name: NAME, calculate, updateUI });
    syncKeepInputs();
    bindEvents();
}
