/**
 * Mulligan Planner — "Which hands should I keep, and how often will I find one?"
 *
 * The maths lives in utils/mulliganModel.js (exact, pure, tested). This module
 * owns the requirement rows, the deck-built templates, rendering, and the
 * sample-game simulation. Requirement rows can be *linked* to a group of the
 * imported list (lands, ramp, cards costing 2 or less, …) so their counts
 * follow the deck, or typed by hand.
 *
 * Share links: share.js reads getState() (requirement rows) and the inputs
 * mull-penalty / mull-threshold / mulligan-sample-count; getShareParams()
 * carries the rest (turn order, free mulligan, limits, linked groups).
 */

import * as DeckConfig from '../utils/deckConfig.js';
import { registerCalculator } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor } from '../utils/components.js';
import { escapeHtml } from '../data/glossary.js';
import { tagDeck } from '../utils/cardTags.js';
import { cardTypes as typesOf, isLand, landCount, libraryOf, unlistedCopies } from '../utils/library.js';
import { shuffle } from '../utils/random.js';
import { TX_CHART } from '../utils/chartHelpers.js';
import { createCache, debounce } from '../utils/simulation.js';
import { pct } from '../utils/text.js';
import {
    HAND_SIZE, mulliganPlan, marginalGains, drawSchedule, handSuccess, keepRules,
    chooseBottom, bottomCount, keepBar
} from '../utils/mulliganModel.js';

const NAME = 'mulligan';
const SAMPLE_DEFAULT = 500;
const GAMES_SHOWN = 4;
const STEP_TABS = 4;
const PRESETS = Object.freeze({
    casual: { penalty: 50, threshold: 60 },
    balanced: { penalty: 20, threshold: 75 },
    competitive: { penalty: 5, threshold: 92 }
});

/** Groups a requirement can be counted from, in the imported list. */
export const SOURCES = Object.freeze({
    land: { label: 'Lands', name: 'Lands', unit: 'lands', test: c => isLand(c) },
    ramp: { label: 'Ramp', name: 'Ramp', unit: 'ramp', needsList: true, test: (c, tags) => !isLand(c) && tags.includes('ramp') },
    cheap: { label: 'Cards costing 2 or less', name: 'Early plays', unit: 'early plays', needsList: true, test: c => !isLand(c) && (Number(c.cmc) || 0) <= 2 },
    draw: { label: 'Card draw', name: 'Card draw', unit: 'card draw', needsList: true, test: (c, tags) => !isLand(c) && tags.includes('draw') },
    interaction: { label: 'Removal and interaction', name: 'Interaction', unit: 'interaction', needsList: true, test: (c, tags) => tags.some(t => t === 'removal' || t === 'counter' || t === 'wipe') },
    creature: { label: 'Creatures', name: 'Creatures', unit: 'creatures', needsList: true, test: c => !isLand(c) && typesOf(c.type_line).includes('creature') }
});

const LAND_ROW = Object.freeze({ source: 'land', required: 3, byTurn: 3, max: 5 });

/** One-click starting points, filled in from the deck. */
export const TEMPLATES = Object.freeze([
    { key: 'lands', name: 'Enough lands', rule: '3 lands by turn 3, no more than 5', rows: [LAND_ROW] },
    { key: 'ramp', name: 'Lands + ramp', rule: '…plus a ramp piece by turn 3', rows: [LAND_ROW, { source: 'ramp', required: 1, byTurn: 3, max: null }] },
    { key: 'cheap', name: 'Lands + an early play', rule: '…plus a card costing 2 or less by turn 2', rows: [LAND_ROW, { source: 'cheap', required: 1, byTurn: 2, max: null }] }
]);

// ── State ────────────────────────────────────────────────────────────────────

let cardTypes = [];
let nextTypeId = 1;
let templateKey = 'lands';
let onPlay = true;
let freeOverride = null;      // null = follow the format's rule
let lastFormatKey = null;
let viewStep = 0;
let shownGames = GAMES_SHOWN;
let simSeed = 0;
let sim = { key: null, data: null };
let scheduleUpdate = () => updateUI();

const planCache = createCache(40);
const gainsCache = createCache(20);
let tagCache = { ref: null, byCard: {} };
let deckVersion = 0;

const $ = id => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const sum = arr => arr.reduce((s, n) => s + n, 0);
const groupColor = i => `var(--series-${(i % 6) + 1})`;
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim());

// ── Deck groups ──────────────────────────────────────────────────────────────

/** The library (commanders are never in it — see library.js) and its tags. */
function deckData() {
    const config = DeckConfig.getDeckConfig();
    const hasList = DeckConfig.hasCardList();
    const library = hasList ? libraryOf(config) : null;
    if (tagCache.ref !== library) {
        tagCache = { ref: library, byCard: library ? tagDeck(library.cards).byCard : {} };
        deckVersion++;
    }
    const cards = library ? library.cards.slice() : [];
    return {
        hasList,
        cards,
        tags: tagCache.byCard,
        lands: library ? landCount(library) : (Number(config.lands) || 0),
        deckSize: library ? library.size + unlistedCopies(library, config.actualCardCount) : DeckConfig.getDeckSize(true)
    };
}

/**
 * Count each linked group from the list; a card goes to the first group it fits.
 * @param {Array<{source?:string|null}>} types
 * @param {Array<Object>} cards - card records with `count`
 * @param {Record<string,string[]>} tagsByCard
 * @returns {{counts:number[], groupOf:Map<string,number>}}
 */
export function assignCards(types, cards = [], tagsByCard = {}) {
    const counts = types.map(() => 0);
    const groupOf = new Map();
    for (const card of cards) {
        const tags = tagsByCard[card.name] ?? [];
        const idx = types.findIndex(t => t.source && SOURCES[t.source]?.test(card, tags));
        if (idx >= 0) {
            counts[idx] += Number(card.count) || 0;
            groupOf.set(card.name, idx);
        }
    }
    return { counts, groupOf };
}

function linkable(source, deck) {
    const s = SOURCES[source];
    if (!s) return false;
    return !s.needsList || deck.hasList;
}

/** Linked rows take their count from the deck (in place, so share links see it). */
function syncLinkedCounts(deck = deckData()) {
    if (!cardTypes.some(t => t.source)) return deck;
    const { counts } = deck.hasList ? assignCards(cardTypes, deck.cards, deck.tags) : { counts: [] };
    cardTypes.forEach((t, i) => {
        if (!t.source || !linkable(t.source, deck)) return;
        t.count = deck.hasList ? counts[i] : deck.lands;
    });
    return deck;
}

function templateCounts(tpl, deck) {
    if (!deck.hasList) return tpl.rows.map(r => (r.source === 'land' ? deck.lands : 0));
    return assignCards(tpl.rows, deck.cards, deck.tags).counts;
}

function templateAvailable(tpl, deck) {
    if (!tpl.rows.every(r => linkable(r.source, deck))) return false;
    return templateCounts(tpl, deck).every(n => n > 0);
}

function applyTemplate(key, { render = true } = {}) {
    const tpl = TEMPLATES.find(t => t.key === key) ?? TEMPLATES[0];
    cardTypes = tpl.rows.map((r, i) => ({
        id: i + 1, name: SOURCES[r.source].name, count: 0,
        required: r.required, byTurn: r.byTurn, max: r.max ?? null, source: r.source
    }));
    nextTypeId = cardTypes.length + 1;
    templateKey = tpl.key;
    viewStep = 0;
    syncLinkedCounts();
    if (render) {
        renderCardTypes();
        updateUI();
    }
}

// ── Config & calculation ─────────────────────────────────────────────────────

function readPercent(id, fallback) {
    const v = parseFloat($(id)?.value);
    return (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback) / 100;
}

/**
 * Current inputs. Deck size and format come from the active deck.
 * @returns {{deckSize:number, penalty:number, freeMulligan:boolean, confidenceThreshold:number, types:Array, format:Object, onPlay:boolean}}
 */
export function getDeckConfig() {
    const deck = syncLinkedCounts();
    const format = DeckConfig.getFormat();
    if (lastFormatKey !== null && lastFormatKey !== format.key) freeOverride = null;
    lastFormatKey = format.key;
    return {
        deckSize: deck.deckSize,
        penalty: readPercent('mull-penalty', 20),
        freeMulligan: freeOverride ?? format.freeMulligan,
        confidenceThreshold: readPercent('mull-threshold', 75),
        types: cardTypes,
        format,
        onPlay: format.firstPlayerDraws ? true : onPlay
    };
}

function planParams(config) {
    return {
        deckSize: config.deckSize,
        types: config.types,
        threshold: config.confidenceThreshold,
        penalty: config.penalty,
        freeMulligan: config.freeMulligan,
        drawsBy: drawSchedule({ format: config.format, onPlay: config.onPlay })
    };
}

function planKey(config) {
    return JSON.stringify([
        config.deckSize, config.format.key, config.onPlay, config.freeMulligan, config.penalty, config.confidenceThreshold,
        config.types.map(t => [t.count, t.required, t.byTurn, t.max ?? null])
    ]);
}

/**
 * Exact plan for the current inputs, cached by input values.
 * @returns {{config:Object, result:Object|null}}
 */
export function calculate() {
    const config = getDeckConfig();
    if (config.types.length === 0 || config.deckSize <= HAND_SIZE) return { config, result: null };
    const key = planKey(config);
    let result = planCache.get(key);
    if (!result) {
        result = mulliganPlan(planParams(config));
        result.key = key;
        // Older names, kept for callers and tests.
        result.expectedSuccess = result.success;
        result.keepProb = result.keepSeven;
        result.expectedCards = result.avgHandSize;
        result.baselineSuccess = result.noMulligan;
        result.strategy = result.hands.map((h, i) => ({
            counts: h.counts, handProb: h.p,
            successProb: result.steps[0].decisions[i].success,
            keep: result.steps[0].decisions[i].keep
        }));
        planCache.set(key, result);
    }
    return { config, result };
}

/**
 * Chance of meeting every requirement on time for a given seven (no bottoming).
 * Defaults to Commander draws (one per turn from turn 1); pass `drawsBy` for
 * other formats.
 */
export function calcMultiTypeSuccess(deckSize, types, handCounts, opts) {
    return handSuccess(deckSize, types, handCounts, opts);
}

// ── Words ────────────────────────────────────────────────────────────────────

function typeNames(types) {
    return types.map((t, i) => String(t.name ?? '').trim() || `Group ${i + 1}`);
}

/** "At least 3 by turn 3, no more than 5 in the hand you keep" */
export function describeRequirement(t) {
    const req = Number(t.required) || 0;
    const turn = Number(t.byTurn) || 0;
    const max = t.max === null || t.max === undefined || t.max === '' ? null : Number(t.max);
    const parts = [];
    if (req > 0) parts.push(turn === 0 ? `At least ${req} in the opening hand` : `At least ${req} by turn ${turn}`);
    if (max !== null) parts.push(`${parts.length ? 'no' : 'No'} more than ${max} in the hand you keep`);
    return parts.length ? parts.join(', ') : 'Nothing required';
}

/**
 * The plain-language answer.
 * @param {Object|null} plan - from mulliganPlan()
 * @param {{names?:string[], freeMulligan?:boolean}} [opts]
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarizeMulligan(plan, { names = [], freeMulligan = false } = {}) {
    if (!plan || !plan.types?.length) {
        return { html: 'Pick a starting point or add a requirement to see which hands to keep.', tone: 'flat' };
    }
    const byFirst = plan.steps[1]?.foundBy ?? plan.steps[0].foundBy;
    const first = freeMulligan ? 'your free mulligan' : 'your first mulligan';
    let html = `You keep <strong>${pct(plan.keepSeven)}</strong> of opening sevens and have a keeper by ${first} <strong>${pct(byFirst)}</strong> of the time. `
        + `The hand you keep has everything on time in <strong>${pct(plan.success)}</strong> of games.`;
    let tone = plan.success >= 0.85 ? 'good' : plan.success >= 0.65 ? 'warn' : 'bad';

    if (plan.avgHandSize < 6.2) {
        html += ` That bar is expensive — you keep <strong>${plan.avgHandSize.toFixed(1)}</strong> cards on average.`;
        if (tone === 'good') tone = 'warn';
    }
    if (plan.success < 0.65 && plan.alone?.length > 1) {
        const worst = plan.alone.indexOf(Math.min(...plan.alone));
        html += ` The hard part is <strong>${escapeHtml(names[worst] ?? `group ${worst + 1}`)}</strong>: on its own, a random seven gets it only ${pct(plan.alone[worst])} of the time.`;
    }
    return { html, tone };
}

function stepLabel(step, free) {
    if (step.step === 0) return 'Opener';
    if (free && step.step === 1) return 'Free mull';
    return `Mull to ${step.handSize}`;
}

function stepSentence(step, free) {
    if (step.step === 0) return 'your opening seven';
    if (free && step.step === 1) return 'the seven after your free mulligan';
    const n = step.step;
    const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'][n] ?? `${n}th`;
    return `a seven after your ${ord} mulligan, keeping ${step.handSize}`;
}

// ── Rail ─────────────────────────────────────────────────────────────────────

function renderTemplates(deck) {
    const el = $('mull-templates');
    if (!el) return;
    el.innerHTML = TEMPLATES.map(tpl => {
        const ok = templateAvailable(tpl, deck);
        const counts = templateCounts(tpl, deck);
        const sub = ok
            ? tpl.rows.map((r, i) => `${counts[i]} ${SOURCES[r.source].unit}`).join(' · ')
            : (deck.hasList ? `None found in this list` : 'Import a decklist to use this');
        return `
            <button type="button" class="mull-tpl${templateKey === tpl.key ? ' active' : ''}" data-template="${tpl.key}"
                aria-pressed="${templateKey === tpl.key}" ${ok ? '' : 'disabled'}>
                <span class="mull-tpl-name">${tpl.name}</span>
                <span class="mull-tpl-sub">${tpl.rule} · ${sub}</span>
            </button>`;
    }).join('');
    const note = $('mull-deck-note');
    if (note) note.textContent = deck.hasList ? 'built from your list' : 'from your land count';
}

function renderCardTypes() {
    const container = $('mull-types-container');
    if (!container) return;
    if (cardTypes.length === 0) {
        container.innerHTML = '<p class="mull-type-read">No requirements yet — pick a starting point above or add one below.</p>';
        renderAddSelect();
        return;
    }
    const deck = deckData();
    container.innerHTML = cardTypes.map((t, i) => {
        const linked = t.source && linkable(t.source, deck);
        const safeName = escapeHtml(t.name);
        return `
        <div class="mull-type" data-type-id="${t.id}">
            <div class="mull-type-head">
                <span class="mull-dot" style="background:${groupColor(i)}" aria-hidden="true"></span>
                <input type="text" class="mull-type-name" value="${safeName}" maxlength="40" data-field="name" data-type-id="${t.id}" aria-label="Group name">
                <span class="mull-src">${linked ? 'from your list' : 'set by hand'}</span>
                <button type="button" class="icon-btn icon-btn-sm" data-remove="${t.id}" aria-label="Remove ${safeName}">✕</button>
            </div>
            <div class="mull-type-fields">
                <label>Need<input type="number" class="field field-sm" data-field="required" data-type-id="${t.id}" value="${t.required}" min="0" max="20" inputmode="numeric"></label>
                <label>By turn<input type="number" class="field field-sm" data-field="byTurn" data-type-id="${t.id}" value="${t.byTurn}" min="0" max="20" inputmode="numeric"></label>
                <label>At most<input type="number" class="field field-sm" data-field="max" data-type-id="${t.id}" value="${t.max ?? ''}" min="0" max="7" placeholder="any" inputmode="numeric"></label>
                <label>In deck<input type="number" class="field field-sm" data-field="count" data-type-id="${t.id}" value="${t.count}" min="0" max="250" inputmode="numeric"></label>
            </div>
            <p class="mull-type-read" id="mull-read-${t.id}"></p>
        </div>`;
    }).join('');
    renderAddSelect(deck);
}

function renderAddSelect(deck = deckData()) {
    const select = $('mull-add-type');
    if (!select) return;
    const used = new Set(cardTypes.map(t => t.source).filter(Boolean));
    const options = Object.entries(SOURCES).filter(([key]) => !used.has(key)).map(([key, s]) => {
        if (!linkable(key, deck)) return `<option value="${key}" disabled>${s.label} — import a list to count</option>`;
        const n = deck.hasList
            ? assignCards([...cardTypes, { source: key }], deck.cards, deck.tags).counts[cardTypes.length]
            : deck.lands;
        return `<option value="${key}">${s.label} — ${n} in your deck</option>`;
    });
    select.innerHTML = `<option value="">+ Add a requirement…</option>${options.join('')}<option value="custom">Something else (type a count)</option>`;
    select.value = '';
}

function addRequirement(source) {
    const deck = deckData();
    const s = SOURCES[source];
    const id = nextTypeId++;
    cardTypes.push(s && linkable(source, deck)
        ? { id, name: s.name, count: 0, required: 1, byTurn: 3, max: null, source }
        : { id, name: `Group ${cardTypes.length + 1}`, count: 0, required: 1, byTurn: 3, max: null, source: null });
    templateKey = null;
    syncLinkedCounts(deck);
    renderCardTypes();
    updateUI();
}

function refreshRows(config, result) {
    cardTypes.forEach((t, i) => {
        const el = $(`mull-read-${t.id}`);
        if (el) {
            const alone = result?.alone?.[i];
            el.innerHTML = `${escapeHtml(describeRequirement(t))}.`
                + (Number.isFinite(alone) ? ` On its own, a random seven gets there <strong>${pct(alone)}</strong> of the time.` : '');
        }
        // Linked counts follow the deck; never overwrite a field being typed in.
        if (t.source) {
            const input = typeof document !== 'undefined'
                ? document.querySelectorAll?.(`#mull-types-container input[data-field="count"][data-type-id="${t.id}"]`)?.[0]
                : null;
            if (input && document.activeElement !== input && String(input.value) !== String(t.count)) input.value = t.count;
        }
    });

    const warnings = [];
    const total = sum(config.types.map(t => Number(t.count) || 0));
    if (total > config.deckSize) warnings.push(`Your groups add up to ${total} cards — more than the ${config.deckSize} in your deck.`);
    const deck = deckData();
    const names = typeNames(config.types);
    config.types.forEach((t, i) => {
        if (t.required > 0 && t.count < t.required) warnings.push(`${escapeHtml(names[i])}: you need ${t.required} but the deck has ${t.count}.`);
        if (t.max !== null && t.max !== undefined && t.byTurn === 0 && t.max < t.required) warnings.push(`${escapeHtml(names[i])}: the limit (${t.max}) is below what you need (${t.required}).`);
        if (t.source && !linkable(t.source, deck)) warnings.push(`${escapeHtml(names[i])}: import a decklist to count these from your cards — using the number you typed.`);
    });
    const warnEl = $('mull-warnings');
    if (warnEl) warnEl.innerHTML = warnings.map(w => `<div>${w}</div>`).join('');
}

function describeThreshold(v) {
    if (v >= 90) return 'Picky: only near-certain hands.';
    if (v >= 75) return 'Disciplined: you want a strong start most games.';
    if (v >= 60) return 'Relaxed: you trust your draws to fill gaps.';
    return 'Loose: you keep risky hands.';
}

function describePenalty(v) {
    if (v === 0) return 'Never lowered — you dig as deep as it takes.';
    if (v <= 10) return 'Barely lowered — you will go to five for the right hand.';
    if (v <= 30) return 'A typical amount: each lost card matters.';
    if (v <= 50) return 'Lowered a lot — you rarely mulligan twice.';
    return 'You take almost anything after one mulligan.';
}

function refreshRule(config) {
    const t = Math.round(config.confidenceThreshold * 100);
    const p = Math.round(config.penalty * 100);
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
    set('mull-threshold-display', `${t}%`);
    set('mull-penalty-display', `${p}%`);
    set('mull-threshold-desc', describeThreshold(t));
    set('mull-penalty-desc', describePenalty(p));

    const bars = [0, 1, 2].map(b => pct(keepBar(config.confidenceThreshold, config.penalty, b)));
    const readback = $('mull-bar-readback');
    if (readback) {
        readback.innerHTML = `Keep a seven at <strong>${bars[0]}</strong>+${config.freeMulligan ? ' (after the free mulligan too)' : ''}, `
            + `a six at <strong>${bars[1]}</strong>+, a five at <strong>${bars[2]}</strong>+.`;
    }
    const root = $(`${NAME}-tab`);
    (root?.querySelectorAll?.('[data-preset]') ?? []).forEach(btn => {
        const preset = PRESETS[btn.dataset.preset];
        const on = !!preset && preset.penalty === p && preset.threshold === t;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
}

function refreshGame(config) {
    const { format } = config;
    const label = $('mull-format-label');
    if (label) label.textContent = format.label;
    const order = $('mull-turn-order');
    if (order) {
        order.hidden = !!format.firstPlayerDraws;
        (order.querySelectorAll?.('[data-play]') ?? []).forEach(btn => {
            const on = (btn.dataset.play === '1') === config.onPlay;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', String(on));
        });
    }
    const free = $('mull-free');
    if (free) free.checked = config.freeMulligan;
    const note = $('mull-format-note');
    if (note) {
        note.textContent = format.firstPlayerDraws
            ? 'Multiplayer Commander: everyone draws on turn one, and the first mulligan is free.'
            : (config.onPlay ? 'On the play you skip your first draw, so every deadline sees one card fewer.' : 'On the draw you draw on turn one.');
    }
}

// ── Results ──────────────────────────────────────────────────────────────────

function renderSummary(config, result) {
    const el = $('mull-summary');
    if (!el) return;
    const names = typeNames(config.types);
    const { html, tone } = summarizeMulligan(result, { names, freeMulligan: config.freeMulligan });
    if (!result) {
        el.innerHTML = renderBottomLine({ html, tone });
        return;
    }
    const byFirst = result.steps[1]?.foundBy ?? result.steps[0].foundBy;
    el.innerHTML = renderBottomLine({ html, tone }) + renderHeroStats([
        {
            label: 'Hands that get there', value: pct(result.success), size: 'big', color: toneColor(tone),
            sub: 'after mulligans',
            tip: 'Chance the hand you finally keep meets every requirement by its turn, counting every mulligan your rule takes.'
        },
        {
            label: 'Sevens you keep', value: pct(result.keepSeven),
            sub: `${pct(byFirst)} within one mulligan`,
            tip: 'Share of opening sevens your rule keeps. A fresh seven after a mulligan has the same odds — only the bar changes.'
        },
        {
            label: 'Average mulligans', value: result.avgMulligans.toFixed(1),
            sub: config.freeMulligan ? 'the free one included' : 'per game', term: 'mulligan'
        },
        {
            label: 'Average hand kept', value: result.avgHandSize.toFixed(1),
            sub: 'cards, after bottoming',
            tip: 'Cards in the hand you keep, after putting cards on the bottom for each mulligan.'
        }
    ]);
}

function renderStepSeg(config, result) {
    const seg = $('mull-step-seg');
    if (!seg) return;
    if (!result) {
        seg.innerHTML = '';
        return;
    }
    const steps = result.steps.slice(0, STEP_TABS);
    if (viewStep >= steps.length) viewStep = 0;
    seg.innerHTML = steps.map((s, i) => `<button type="button" class="seg-btn${i === viewStep ? ' active' : ''}" data-step="${i}" aria-pressed="${i === viewStep}">${stepLabel(s, config.freeMulligan)}</button>`).join('');
}

function cellTip(names, counts, h, d, step) {
    const what = counts.map((c, i) => `${c} ${names[i].toLowerCase()}`).join(', ');
    if (!d.legal) return `${what}: over a limit even after bottoming — mulligan. Seen in ${pct(h.p)} of sevens.`;
    return `${what}: seen in ${pct(h.p)} of sevens; gets there ${pct(d.success)} of the time → ${d.keep ? 'keep' : 'mulligan'}${step.bottom ? ` (bottom ${step.bottom})` : ''}.`;
}

function cellHtml(h, d, step, names, maxP) {
    if (!h) return '<td class="is-none"></td>';
    const cls = !d.legal ? 'is-over' : d.keep ? 'is-keep' : '';
    const text = !d.legal ? '–' : pct(d.success);
    const w = Math.max(6, Math.round((h.p / maxP) * 92));
    return `<td class="${cls}" data-tip="${escapeHtml(cellTip(names, h.counts, h, d, step))}">${text}<span class="mull-freq" style="width:${w}%"></span></td>`;
}

function renderKeepGrid(result, step, names) {
    const n = result.types.length;
    const hands = result.hands.map((h, i) => ({ h, d: step.decisions[i] }));
    const maxP = Math.max(...result.hands.map(h => h.p));

    if (n === 1) {
        const cols = hands.filter(x => x.h.p >= 0.0005).sort((a, b) => a.h.counts[0] - b.h.counts[0]);
        return `
            <div class="mull-grid-wrap">
                <table class="mull-kgrid">
                    <thead><tr><th class="mull-axis" scope="col">${escapeHtml(names[0])} in hand</th>${cols.map(c => `<th scope="col">${c.h.counts[0]}</th>`).join('')}</tr></thead>
                    <tbody><tr><th class="mull-axis" scope="row">Gets there</th>${cols.map(c => cellHtml(c.h, c.d, step, names, maxP)).join('')}</tr></tbody>
                </table>
            </div>`;
    }

    if (n === 2) {
        const at = new Map(hands.map(x => [`${x.h.counts[0]},${x.h.counts[1]}`, x]));
        const total = (idx, v) => hands.filter(x => x.h.counts[idx] === v).reduce((s, x) => s + x.h.p, 0);
        const rows = [...new Set(hands.map(x => x.h.counts[0]))].sort((a, b) => a - b).filter(v => total(0, v) >= 0.0005);
        const cols = [...new Set(hands.map(x => x.h.counts[1]))].sort((a, b) => a - b).filter(v => total(1, v) >= 0.0005);
        return `
            <div class="mull-grid-wrap">
                <table class="mull-kgrid">
                    <thead><tr><th class="mull-axis" scope="col">${escapeHtml(names[0])} ↓ · ${escapeHtml(names[1])} →</th>${cols.map(c => `<th scope="col">${c}</th>`).join('')}</tr></thead>
                    <tbody>${rows.map(r => `<tr><th scope="row">${r}</th>${cols.map(c => {
                        const x = at.get(`${r},${c}`);
                        return x ? cellHtml(x.h, x.d, step, names, maxP) : '<td class="is-none"></td>';
                    }).join('')}</tr>`).join('')}</tbody>
                </table>
            </div>`;
    }

    // Three or more groups: the most common sevens.
    const top = hands.slice().sort((a, b) => b.h.p - a.h.p).slice(0, 12);
    return `
        <div class="mull-grid-wrap">
            <table class="mull-table">
                <thead><tr><th>Hand</th>${names.map(nm => `<th>${escapeHtml(nm)}</th>`).join('')}<th>Seen in</th><th>Gets there</th><th>Call</th></tr></thead>
                <tbody>${top.map((x, i) => `<tr>
                    <td>#${i + 1}</td>${x.h.counts.map(c => `<td>${c}</td>`).join('')}
                    <td>${pct(x.h.p)}</td><td>${x.d.legal ? pct(x.d.success) : '–'}</td>
                    <td>${!x.d.legal ? 'Mulligan (over a limit)' : x.d.keep ? 'Keep' : 'Mulligan'}</td>
                </tr>`).join('')}</tbody>
            </table>
            <p class="mull-note">The 12 most common sevens. With three or more groups the full grid has too many cells to read.</p>
        </div>`;
}

function renderKeep(config, result) {
    const el = $('mull-keep');
    if (!el) return;
    if (!result) {
        el.innerHTML = '<p class="mull-empty">Add a requirement to see the keep chart.</p>';
        return;
    }
    const step = result.steps[viewStep] ?? result.steps[0];
    const names = typeNames(config.types);
    const rules = keepRules(result, viewStep, names.map(nm => nm.toLowerCase()));
    const reachNote = step.step === 0 ? '' : ` You get here in ${pct(step.reach)} of games.`;
    const caption = step.forced
        ? `Down to one card you keep whatever you see.${reachNote}`
        : `For ${stepSentence(step, config.freeMulligan)}: keep if it gets there at least <strong>${pct(step.bar)}</strong> of the time${step.bottom ? `, after putting ${step.bottom} on the bottom` : ''}.${reachNote}`;

    el.innerHTML = `
        <div class="mull-keep-body">
            <p class="mull-keep-caption">${caption}</p>
            ${rules ? `<ul class="mull-rules">${rules.map(r => `
                <li class="is-${r.call}"><span class="mull-rule-call">${r.call === 'keep' ? 'Keep' : r.call === 'mull' ? 'Mulligan' : 'Depends'}</span>
                <span><span class="mull-rule-label">${escapeHtml(r.label)}</span>${r.call === 'some' ? ` — ${escapeHtml(r.detail)}` : ''}</span></li>`).join('')}</ul>` : ''}
            ${renderKeepGrid(result, step, names)}
            ${result.types.length <= 2 ? `<div class="mull-legend"><span class="lg-keep">Keep</span><span>Mulligan</span><span class="lg-over">Over a limit</span><span>Number: chance that hand gets there · bar: how often you see it</span></div>` : ''}
        </div>`;
}

function renderSteps(config, result) {
    const el = $('mull-steps');
    if (!el) return;
    if (!result) {
        el.innerHTML = '';
        return;
    }
    const rows = result.steps.filter(s => s.reach >= 0.0005);
    el.innerHTML = `
        <div class="mull-grid-wrap"><table class="mull-table">
            <thead><tr><th></th><th>Cards kept</th><th>Keep if at least</th><th>Keep this seven</th><th>Have a keeper by now</th><th>Kept hands get there</th></tr></thead>
            <tbody>${rows.map(s => `<tr>
                <td>${stepLabel(s, config.freeMulligan)}</td>
                <td>${s.handSize}</td>
                <td>${s.forced ? 'anything' : pct(s.bar)}</td>
                <td>${pct(s.keepChance)}</td>
                <td>${pct(s.foundBy)}</td>
                <td>${s.keepChance > 0 ? pct(s.successIfKept) : '—'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        <p class="mull-note">Every mulligan sees a fresh seven with the same odds; only the cards you must bottom and the bar change. If you never mulliganed, ${pct(result.noMulligan)} of sevens would get there.</p>`;
}

function renderTuning(config, result) {
    const el = $('mull-tuning');
    if (!el) return;
    if (!result) {
        el.innerHTML = '';
        return;
    }
    const q = result.quality;
    const mulled = q.mullGood + q.mullMissed;
    let advice = 'Your bar looks balanced for these requirements.';
    if (q.mullMissed > 0.12 && q.mullMissed > 2 * q.keepBad) advice = 'Many hands you mulligan would have been fine — try a lower bar.';
    else if (q.keepBad > 0.1 && q.keepBad > q.mullMissed) advice = 'A fair share of keeps fall short — try a higher bar or a later deadline.';

    const details = $('mull-tuning-details');
    let gainsHtml = '<p class="mull-note">Open this section to work out what one more card of each group is worth.</p>';
    if (details?.open) {
        const key = result.key;
        let gains = gainsCache.get(key);
        if (!gains) {
            gains = marginalGains(planParams(config));
            gainsCache.set(key, gains);
        }
        const names = typeNames(config.types);
        gainsHtml = `<ul class="mull-gains">${gains.map((g, i) => {
            const label = `${escapeHtml(names[i])}: ${config.types[i].count} → ${config.types[i].count + 1}`;
            if (g === null) return `<li><span>${label}</span><span class="num is-flat">no spare card to swap</span></li>`;
            const pts = g * 100;
            const cls = pts >= 0.5 ? 'is-good' : 'is-flat';
            const text = Math.abs(pts) < 0.05 ? '±0.0' : `${pts > 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)}`;
            return `<li><span>${label}</span><span class="num ${cls}">${text} pts</span></li>`;
        }).join('')}</ul>
        <p class="mull-note">Change in “hands that get there” from swapping a card that counts toward nothing for one more of each group.</p>`;
    }

    el.innerHTML = `
        <div class="mull-tune">
            <div>
                <h4>Is the bar right?</h4>
                <p>Of all opening sevens, you mulligan ${pct(mulled)}. <strong>${pct(q.mullMissed)}</strong> are mulligans that would have got there anyway; <strong>${pct(q.keepBad)}</strong> are keeps that won’t. ${advice}</p>
            </div>
            <div>
                <h4>One more card</h4>
                ${gainsHtml}
            </div>
        </div>`;
}

// ── Sample games ─────────────────────────────────────────────────────────────

/**
 * Build the card pool for sample games: the real list when every group is
 * linked to it, otherwise stand-in cards named after each group.
 */
function usesRealCards(config, deck) {
    return deck.hasList && config.types.length > 0 && config.types.every(t => t.source && linkable(t.source, deck));
}

function samplePool(config, deck) {
    const real = usesRealCards(config, deck);
    if (real) {
        const { groupOf } = assignCards(config.types, deck.cards, deck.tags);
        const pool = [];
        deck.cards.forEach(c => {
            const group = groupOf.get(c.name) ?? -1;
            for (let k = 0; k < Number(c.count); k++) pool.push({ name: c.name, group, real: true });
        });
        return { pool, real };
    }
    // Stand-ins carry no name: the group's current name is filled in when
    // rendering, so renaming a group never re-runs the simulation.
    const pool = [];
    config.types.forEach((t, i) => { for (let k = 0; k < t.count; k++) pool.push({ name: null, group: i }); });
    while (pool.length < config.deckSize) pool.push({ name: 'Other card', group: -1 });
    return { pool, real: false };
}

/**
 * Play the keep rule out on shuffled decks.
 *
 * @param {Object} p
 * @param {Array<{name:string, group:number}>} p.pool - the library, one entry per card
 * @param {Object} p.plan - from mulliganPlan()
 * @param {(turn:number)=>number} p.drawsBy
 * @param {boolean} p.freeMulligan
 * @param {number} [p.games=500]
 * @param {number} [p.detail=40] - games to keep in full for display
 * @param {() => number} [p.rng=Math.random]
 * @returns {{stats:{games:number, keptSeven:number, success:number, avgMulligans:number, avgHandSize:number}, games:Array}}
 */
export function simulateGames({ pool, plan, drawsBy, freeMulligan, games = SAMPLE_DEFAULT, detail = 40, rng = Math.random }) {
    const types = plan.types;
    const n = types.length;
    const handIndex = new Map(plan.hands.map((h, i) => [h.counts.join(','), i]));
    const due = types.map(t => drawsBy(t.byTurn));
    const lastTurn = Math.max(1, ...types.filter(t => t.required > 0).map(t => t.byTurn));
    const drawCount = Math.max(0, drawsBy(lastTurn));
    const lastStep = freeMulligan ? HAND_SIZE : HAND_SIZE - 1;
    const order = pool.map((_, i) => i);
    const out = [];
    let keptSeven = 0;
    let success = 0;
    let mulls = 0;
    let handSizes = 0;

    for (let g = 0; g < games; g++) {
        const mulled = [];
        for (let step = 0; step <= lastStep; step++) {
            shuffle(order, rng);
            const seven = order.slice(0, HAND_SIZE);
            const counts = new Array(n).fill(0);
            seven.forEach(ci => { const grp = pool[ci].group; if (grp >= 0) counts[grp]++; });
            const others = HAND_SIZE - sum(counts);
            const planStep = plan.steps[step];
            const decision = planStep?.decisions[handIndex.get(counts.join(','))];
            const keep = step === lastStep || !planStep || !!decision?.keep;
            if (!keep) {
                if (g < detail) mulled.push(seven.slice());
                continue;
            }

            const bottom = bottomCount(step, freeMulligan);
            const pick = chooseBottom(counts, others, bottom, types, decision?.cut ?? null);
            const bottomed = new Set();
            if (pick.legal) {
                let needOthers = pick.bottomOthers;
                const needType = pick.bottomByType.slice();
                for (let k = seven.length - 1; k >= 0; k--) {
                    const grp = pool[seven[k]].group;
                    if (grp < 0 && needOthers > 0) { bottomed.add(k); needOthers--; }
                    else if (grp >= 0 && needType[grp] > 0) { bottomed.add(k); needType[grp]--; }
                }
            }
            const kept = new Array(n).fill(0);
            seven.forEach((ci, k) => { const grp = pool[ci].group; if (grp >= 0 && !bottomed.has(k)) kept[grp]++; });
            const draws = order.slice(HAND_SIZE, HAND_SIZE + drawCount);
            const missing = [];
            types.forEach((t, i) => {
                if (t.required <= 0) return;
                let have = kept[i];
                for (let d = 0; d < Math.min(due[i], draws.length); d++) if (pool[draws[d]].group === i) have++;
                if (have < t.required) missing.push(i);
            });
            const ok = pick.legal && missing.length === 0;

            if (step === 0) keptSeven++;
            if (ok) success++;
            mulls += step;
            handSizes += HAND_SIZE - bottom;
            if (g < detail) {
                out.push({
                    mulled,
                    seven: seven.slice(),
                    bottomed,
                    draws,
                    step,
                    handSize: HAND_SIZE - bottom,
                    ok,
                    legal: pick.legal,
                    missing
                });
            }
            break;
        }
    }
    return {
        stats: {
            games,
            keptSeven: games ? keptSeven / games : 0,
            success: games ? success / games : 0,
            avgMulligans: games ? mulls / games : 0,
            avgHandSize: games ? handSizes / games : 0
        },
        games: out,
        drawsBy,
        lastTurn
    };
}

function sampleCount() {
    const v = parseInt($('mulligan-sample-count')?.value, 10);
    return Number.isFinite(v) ? Math.min(10000, Math.max(1, v)) : SAMPLE_DEFAULT;
}

function chip(card, names, bottomed = false) {
    const dot = card.group >= 0 ? `<span class="mull-dot" style="background:${groupColor(card.group)}" aria-hidden="true"></span>` : '';
    const cls = `mull-card${card.group < 0 ? ' is-other' : ''}${bottomed ? ' is-bottom' : ''}`;
    const attrs = card.real ? ` data-card="${escapeHtml(card.name)}" tabindex="0"` : '';
    const name = escapeHtml(card.name ?? names[card.group] ?? '');
    const label = bottomed ? `${name} (bottom)` : name;
    return `<span class="${cls}"${attrs}${bottomed ? ' title="Put on the bottom"' : ''}>${dot}${label}</span>`;
}

function renderGame(game, idx, pool, names, data, free) {
    const steps = game.mulled.map((seven, m) => `
        <div class="mull-line is-mulled"><span class="mull-line-label">${m === 0 ? 'Opener' : (free && m === 1 ? 'Free mull' : `Mull to ${HAND_SIZE - bottomCount(m, free)}`)}</span>
        <div class="mull-cards">${seven.map(ci => chip(pool[ci], names)).join('')}</div></div>`).join('');
    const keptLabel = game.step === 0 ? 'Kept' : `Kept ${game.handSize}`;
    const turns = [];
    for (let t = 1; t <= data.lastTurn; t++) {
        const from = data.drawsBy(t - 1);
        const to = data.drawsBy(t);
        for (let d = from; d < to && d < game.draws.length; d++) {
            turns.push(`<span class="mull-draw"><span class="mull-turn">T${t}</span>${chip(pool[game.draws[d]], names)}</span>`);
        }
    }
    const verdict = !game.legal
        ? 'Over a limit'
        : game.ok ? 'Everything on time' : `Missed: ${game.missing.map(i => escapeHtml(names[i].toLowerCase())).join(', ')}`;
    return `
        <article class="mull-game">
            <div class="mull-game-head">
                <span><strong>Game ${idx + 1}</strong> · ${game.step === 0 ? 'kept the opener' : `${game.step} mulligan${game.step > 1 ? 's' : ''}, kept ${game.handSize}`}</span>
                <span class="mull-result ${game.ok ? 'is-good' : 'is-bad'}">${game.ok ? '✓' : '✕'} ${verdict}</span>
            </div>
            ${steps}
            <div class="mull-line"><span class="mull-line-label">${keptLabel}</span>
                <div class="mull-cards">${game.seven.map((ci, k) => chip(pool[ci], names, game.bottomed.has(k))).join('')}</div></div>
            ${turns.length ? `<div class="mull-line"><span class="mull-line-label">Draws</span><div class="mull-cards">${turns.join('')}</div></div>` : ''}
        </article>`;
}

/**
 * Run (or reuse) the sample games and render them.
 */
export function runSampleReveals() {
    const display = $('mulligan-reveals-display');
    if (!display) return;
    const { config, result } = calculate();
    if (!result) {
        display.innerHTML = '<p class="mull-empty">Add a requirement to deal sample games.</p>';
        return;
    }
    const deck = deckData();
    const games = sampleCount();
    const key = `${result.key}|${games}|${simSeed}|${deckVersion}|${usesRealCards(config, deck)}`;
    if (sim.key !== key) {
        const { pool, real } = samplePool(config, deck);
        const drawsBy = drawSchedule({ format: config.format, onPlay: config.onPlay });
        sim = { key, pool, real, data: simulateGames({ pool, plan: result, drawsBy, freeMulligan: config.freeMulligan, games }) };
        shownGames = GAMES_SHOWN;
    }
    const { data } = sim;
    const names = typeNames(config.types);
    const source = $('mull-sim-source');
    if (source) source.textContent = sim.real ? 'shuffles of your list' : 'stand-in cards for the counts';
    const s = data.stats;
    const stats = `In ${s.games.toLocaleString('en-US')} shuffled games you kept the opener ${pct(s.keptSeven)} of the time, `
        + `averaged ${s.avgMulligans.toFixed(1)} mulligans, and the kept hand got there in <strong>${pct(s.success)}</strong> `
        + `(exact: ${pct(result.success)}).`;
    const list = data.games.slice(0, shownGames).map((g, i) => renderGame(g, i, sim.pool, names, data, config.freeMulligan)).join('');
    const more = shownGames < data.games.length
        ? `<button type="button" class="btn btn-ghost btn-sm mull-more" id="mull-more-games">Show ${Math.min(6, data.games.length - shownGames)} more games</button>`
        : '';
    display.innerHTML = `<p class="mull-sim-stats">${stats}</p><div class="mull-games">${list}</div>${more}`;
}

// ── Render all ───────────────────────────────────────────────────────────────

/** Re-render the page. Cheap when inputs are unchanged: the plan is cached. */
export function updateUI() {
    const { config, result } = calculate();
    const deck = deckData();
    renderTemplates(deck);
    refreshRows(config, result);
    refreshRule(config);
    refreshGame(config);
    renderSummary(config, result);
    renderStepSeg(config, result);
    renderKeep(config, result);
    renderSteps(config, result);
    renderTuning(config, result);
    runSampleReveals();
}

// ── Sharing & external setters ───────────────────────────────────────────────

/**
 * Replace the requirement rows (share links, tests).
 * @param {Array<{id?:number, name:string, count:number, required:number, byTurn:number, max?:number|null, source?:string|null}>} types
 */
export function setCardTypes(types) {
    if (!Array.isArray(types)) return;
    cardTypes = types.map((t, i) => ({
        id: Number.isFinite(t.id) ? t.id : i + 1,
        name: String(t.name ?? `Group ${i + 1}`).slice(0, 60),
        count: Math.max(0, Number(t.count) || 0),
        required: Math.max(0, Number(t.required) || 0),
        byTurn: Math.max(0, Number(t.byTurn) || 0),
        max: t.max === null || t.max === undefined || t.max === '' ? null : Math.max(0, Number(t.max) || 0),
        source: t.source && SOURCES[t.source] ? t.source : null
    }));
    nextTypeId = Math.max(0, ...cardTypes.map(t => t.id)) + 1;
    templateKey = null;
    viewStep = 0;
    renderCardTypes();
    updateUI();
}

/**
 * Current state for share links: the rows (with a hex colour per row, which
 * the link format requires) and the keep-rule settings.
 */
export function getState() {
    const config = getDeckConfig();
    const fallback = isHex(TX_CHART.dim) ? TX_CHART.dim : TX_CHART.series.find(isHex);
    return {
        ...config,
        types: config.types.map((t, i) => {
            const c = TX_CHART.series[i % TX_CHART.series.length];
            return { ...t, color: isHex(c) ? c.trim() : fallback };
        })
    };
}

/** Settings share.js doesn't carry on its own. */
export function getShareParams() {
    const format = DeckConfig.getFormat();
    const params = {};
    if (!format.firstPlayerDraws && !onPlay) params.mullDraw = 1;
    if (freeOverride !== null && freeOverride !== format.freeMulligan) params.mullFree = freeOverride ? 1 : 0;
    if (cardTypes.some(t => t.max !== null)) params.mullMax = cardTypes.map(t => t.max ?? '').join(',');
    if (cardTypes.some(t => t.source)) params.mullSrc = cardTypes.map(t => t.source ?? '').join(',');
    return params;
}

/** Apply the params from getShareParams(); every value is validated. */
export function applyShareParams(params) {
    if (!params?.get) return;
    if (params.get('mullDraw') === '1') onPlay = false;
    if (params.has('mullFree')) freeOverride = params.get('mullFree') === '1';
    const maxes = (params.get('mullMax') ?? '').split(',');
    const sources = (params.get('mullSrc') ?? '').split(',');
    const deck = deckData();
    const linked = deck.hasList ? assignCards(cardTypes.map((t, i) => ({ source: SOURCES[sources[i]] ? sources[i] : null })), deck.cards, deck.tags).counts : [];
    cardTypes.forEach((t, i) => {
        const m = parseInt(maxes[i], 10);
        if (Number.isFinite(m) && m >= 0 && m <= 7) t.max = m;
        const src = sources[i];
        // Re-link only when the shared count matches this deck's, so a link
        // never silently changes the numbers it was shared with.
        if (src && SOURCES[src] && linkable(src, deck)) {
            const n = deck.hasList ? linked[i] : deck.lands;
            if (n === t.count) t.source = src;
        }
    });
    renderCardTypes();
    updateUI();
}

// ── Init ─────────────────────────────────────────────────────────────────────

function setRange(id, value) {
    const el = $(id);
    if (el) el.value = value;
}

function bindEvents() {
    const root = $(`${NAME}-tab`);
    if (!root?.addEventListener) return;

    root.addEventListener('click', e => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const tpl = target.closest('[data-template]');
        if (tpl && !tpl.disabled) {
            applyTemplate(tpl.dataset.template);
            return;
        }
        const remove = target.closest('[data-remove]');
        if (remove) {
            const id = Number(remove.dataset.remove);
            cardTypes = cardTypes.filter(t => t.id !== id);
            templateKey = null;
            viewStep = 0;
            renderCardTypes();
            updateUI();
            return;
        }
        const preset = target.closest('[data-preset]');
        if (preset && PRESETS[preset.dataset.preset]) {
            const { penalty, threshold } = PRESETS[preset.dataset.preset];
            setRange('mull-penalty', penalty);
            setRange('mull-threshold', threshold);
            updateUI();
            return;
        }
        const play = target.closest('[data-play]');
        if (play) {
            onPlay = play.dataset.play === '1';
            updateUI();
            return;
        }
        const step = target.closest('[data-step]');
        if (step) {
            viewStep = Number(step.dataset.step) || 0;
            const { config, result } = calculate();
            renderStepSeg(config, result);
            renderKeep(config, result);
            return;
        }
        if (target.closest('#mull-more-games')) {
            shownGames += 6;
            runSampleReveals();
            return;
        }
        if (target.closest('#mulligan-draw-reveals-btn')) {
            simSeed++;
            runSampleReveals();
        }
    });

    root.addEventListener('input', e => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement)) return;
        if (input.id === 'mull-threshold' || input.id === 'mull-penalty') {
            refreshRule(getDeckConfig());
            scheduleUpdate();
            return;
        }
        const field = input.dataset.field;
        if (!field) return;
        const type = cardTypes.find(t => t.id === Number(input.dataset.typeId));
        if (!type) return;
        if (field === 'name') {
            type.name = input.value;
            scheduleUpdate();
            return;
        }
        const raw = input.value.trim();
        if (field === 'max') {
            type.max = raw === '' ? null : Math.min(7, Math.max(0, parseInt(raw, 10) || 0));
        } else {
            if (raw === '') return; // mid-edit: wait for a number
            const value = Math.max(0, parseInt(raw, 10) || 0);
            type[field] = value;
            if (field === 'count' && type.source) {
                type.source = null;
                const src = input.closest('.mull-type')?.querySelector('.mull-src');
                if (src) src.textContent = 'set by hand';
            }
        }
        templateKey = null;
        scheduleUpdate();
    });

    root.addEventListener('change', e => {
        const el = e.target;
        if (el?.id === 'mull-add-type' && el.value) {
            addRequirement(el.value === 'custom' ? null : el.value);
        } else if (el?.id === 'mull-free') {
            freeOverride = el.checked;
            updateUI();
        } else if (el?.id === 'mulligan-sample-count') {
            runSampleReveals();
        }
    });

    $('mull-tuning-details')?.addEventListener('toggle', () => {
        const { config, result } = calculate();
        renderTuning(config, result);
    });
}

/**
 * Initialise the page: default template from the deck, events, deck listeners.
 */
export function init() {
    const deck = deckData();
    const debounced = registerCalculator({ name: NAME, calculate, updateUI }).updateUI;
    scheduleUpdate = debounce(() => updateUI(), 120);

    // A newly loaded deck re-fills an untouched template (and drops one the
    // new deck can't support).
    DeckConfig.onDeckImport(() => {
        const now = deckData();
        if (templateKey) {
            const tpl = TEMPLATES.find(t => t.key === templateKey);
            applyTemplate(tpl && templateAvailable(tpl, now) ? templateKey : 'lands', { render: false });
        } else {
            syncLinkedCounts(now);
        }
        renderCardTypes();
        debounced();
    });

    renderAddSelect(deck);
    renderCardTypes();
    bindEvents();
}

// Default rows exist before init() so calculate() works headless (tests, share links).
applyTemplate('lands', { render: false });
