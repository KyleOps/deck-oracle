/**
 * Game Plan — how often does this deck do what it's built to do, on time?
 *
 * The maths lives in utils/planEngine.js (goldfish games towards a plan),
 * utils/planRules.js (card rules) and utils/models/plan.js (the words). This
 * module reads the deck and the plan, runs 5,000 games without blocking the
 * page (~10 ms slices), caches the result per deck + plan + settings, keeps
 * each deck's plan (localStorage), renders the editor and the evidence, and
 * owns the presets (js/data/plans/) and share links.
 */

import * as DeckConfig from '../utils/deckConfig.js';
import * as Library from '../utils/deckLibrary.js';
import { registerCalculator, isCalculatorActive } from '../utils/calculatorBase.js';
import { renderBottomLine, renderHeroStats, toneColor, pBarCell } from '../utils/components.js';
import { escapeHtml, cardRef } from '../data/glossary.js';
import { libraryOf } from '../utils/library.js';
import { pct, inflect } from '../utils/text.js';
import { debounce } from '../utils/simulation.js';
import { manaPips } from '../utils/manaDevelopment.js';
import { dotPlot, describeDots, pmfQuantiles } from '../utils/viz.js';
import { effectiveOnPlay, syncTurnOrder, turnOrderClicked } from '../utils/turnOrder.js';
import { MAX_TURN, MAX_STEPS, MAX_OPTIONS, MAX_COUNT, MAX_MV, MAX_MANA_TARGET, normalizeRequirement } from '../utils/planSchema.js';
import * as GP from '../utils/models/plan.js';
import { PLAN_PRESETS, presetEntry } from '../data/plans/index.js';

const NAME = 'plan';
const SLICE_MS = 10;
const CACHE_SIZE = 12;
/** Each deck's plan: { [deck key]: { p: encoded plan, s: preset id or null } }. */
const STORE_KEY = 'deckOracle.gamePlans.v1';
const STORE_LIMIT = 40;

let onPlay = true;
let keep = { ...GP.DEFAULT_KEEP };
let draft = null;              // the editor's plan: a step may be unfinished (named cards, no names yet)
let source = { kind: 'starter', id: null };
let deckKeyNow = null;
let editorDirty = true;
let presetPick = '';
let debouncedUpdate = null;
let runToken = 0;
let renderToken = 0;
let reshuffles = 0;
let samples = null;
let current = null;
let libMemo = null;

const cache = new Map();
const presets = new Map();
const memoryStore = {};

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));

// ── Saved plans ──────────────────────────────────────────────────────────────

function storage() {
    try {
        return typeof window !== 'undefined' ? window.localStorage ?? null : null;
    } catch {
        return null;
    }
}

function readStore() {
    let saved = {};
    try {
        const raw = storage()?.getItem(STORE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
    } catch {
        saved = {};
    }
    return { ...saved, ...memoryStore };
}

function writeStore(deckKey, entry) {
    if (!deckKey) return;
    if (entry) memoryStore[deckKey] = entry;
    else delete memoryStore[deckKey];
    try {
        const all = readStore();
        if (!entry) delete all[deckKey];
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - STORE_LIMIT))) delete all[k];
        storage()?.setItem(STORE_KEY, JSON.stringify(all));
    } catch {
        // storage unavailable: the plan lasts for this visit only
    }
}

function persist() {
    if (source.kind === 'starter') return;
    writeStore(deckKeyNow, { p: GP.encodePlan(GP.normalizePlan(draft)), s: source.kind === 'preset' ? source.id : null });
}

// ── Deck → inputs ────────────────────────────────────────────────────────────

/** A new deck: its saved plan, or a starter plan built from it. */
function adoptDeck(deckKey, lib) {
    deckKeyNow = deckKey;
    const saved = readStore()[deckKey];
    const plan = saved?.p ? GP.decodePlan(saved.p) : null;
    if (plan?.steps.length) {
        draft = clone(plan);
        source = saved.s && presetEntry(saved.s) ? { kind: 'preset', id: saved.s } : { kind: 'custom', id: null };
    } else {
        draft = clone(GP.starterPlan(lib));
        source = { kind: 'starter', id: null };
    }
    editorDirty = true;
    samples = null;
}

/**
 * Everything the page's answer depends on: the deck as the engine plays it,
 * this deck's plan and the settings. Defaults when the page was never mounted.
 */
export function readInputs() {
    const config = DeckConfig.getDeckConfig();
    const format = DeckConfig.getFormat();
    const cardList = DeckConfig.hasCardList();
    const library = cardList ? libraryOf(config, { format }) : null;
    const commanderCards = library?.commanders.length ? DeckConfig.getCommanders().map(c => c.card) : [];
    const counts = cardList ? '' : DeckConfig.TYPE_FIELDS.map(f => config[f]).join(',');
    const memoKey = [library, ...commanderCards, format.multiplayer, counts, config.actualCardCount];
    if (!libMemo || libMemo.key.length !== memoKey.length || libMemo.key.some((v, i) => v !== memoKey[i])) {
        const lib = cardList
            ? GP.buildPlanLibrary(library, { commanderCards, multiplayer: format.multiplayer })
            : GP.buildPlanCountsLibrary(config);
        libMemo = { key: memoKey, lib };
    }
    const lib = libMemo.lib;
    const deckKey = config.deckId ?? `lib:${lib.key}`;
    if (deckKey !== deckKeyNow || !draft) adoptDeck(deckKey, lib);
    return {
        config,
        format,
        lib,
        plan: GP.normalizePlan(draft),
        deckKey,
        deckName: config.deckName || lib.commanders.map(c => c.name).join(' + '),
        onPlay: effectiveOnPlay(onPlay, format),
        keep: GP.normalizeKeep(keep),
        preset: GP.matchPreset(PLAN_PRESETS, config)
    };
}

function runOptions(inputs) {
    return { format: inputs.format, onPlay: inputs.onPlay, keep: inputs.keep };
}

function cacheKey(inputs) {
    const k = inputs.keep;
    return [inputs.lib.key, GP.planKey(inputs.plan), inputs.format.key, inputs.onPlay ? 'p' : 'd', `${k.kind}${k.minLands}${k.maxLands}`].join('|');
}

function remember(key, result) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
    cache.set(key, result);
}

/**
 * The page's numbers for the current deck, plan and settings, synchronously
 * (tests, share links). The page itself runs the sliced version in updateUI().
 * @returns {{inputs:Object, result:Object|null}}
 */
export function calculate() {
    const inputs = readInputs();
    const key = cacheKey(inputs);
    if (!cache.has(key)) {
        remember(key, inputs.lib.cards.length >= 7 ? GP.simulatePlan(inputs.lib, inputs.plan, runOptions(inputs)) : null);
    }
    return { inputs, result: cache.get(key) };
}

const yieldToBrowser = () => (globalThis.scheduler?.yield
    ? globalThis.scheduler.yield()
    : new Promise(resolve => setTimeout(resolve, 0)));

/** Run the simulation in slices; resolves to the result, or undefined if superseded. */
async function runSliced(inputs, key, onProgress) {
    const token = ++runToken;
    const run = GP.createPlanRun(inputs.lib, inputs.plan, runOptions(inputs));
    const t0 = performance.now();
    let longest = 0;
    for (;;) {
        const start = performance.now();
        let done = false;
        while (!done && performance.now() - start < SLICE_MS) done = GP.runPlanBatch(run, 25);
        longest = Math.max(longest, performance.now() - start);
        if (done) break;
        onProgress?.(run.done / run.games);
        await yieldToBrowser();
        if (token !== runToken) return undefined;
    }
    const result = GP.finishPlanRun(run);
    if (result) result.timing = { total: performance.now() - t0, longestSlice: longest };
    remember(key, result);
    return result;
}

// ── The plan editor ──────────────────────────────────────────────────────────

const GROUP_LABEL = Object.freeze({
    mana: 'A mana source', ramp: 'Any ramp', landRamp: 'Land ramp', named: 'One of these cards', historic: 'A historic spell',
    creature: 'A creature', artifact: 'An artifact', enchantment: 'An enchantment', planeswalker: 'A planeswalker',
    instant: 'An instant', sorcery: 'A sorcery', permanent: 'A permanent', any: 'Any spell'
});
const KIND_LABEL = Object.freeze({ cast: 'Cast a card', mana: 'Have mana', package: 'Cast a package', spend: 'Spend mana on spells', ramp: 'Ramp for next turn' });

const opt = (value, label, selected) => `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
const numbers = (lo, hi, selected) => Array.from({ length: hi - lo + 1 }, (_, i) => opt(String(lo + i), String(lo + i), lo + i === selected)).join('');

/** The select value a group shows: 'commander:<i>' for one of this deck's commanders. */
function groupValue(group, lib) {
    if (group?.is !== 'commander') return group?.is ?? 'any';
    const names = group.names ?? [];
    if (names.length === 1) {
        const i = lib.commanders.findIndex(c => c.key === GP.findPlanCard(lib, names[0])?.key);
        if (i >= 0) return `commander:${i}`;
    }
    return 'commander';
}

function groupSelect(group, path, lib, label) {
    const value = groupValue(group, lib);
    const commanders = lib.commanders.map((c, i) => opt(`commander:${i}`, c.name, value === `commander:${i}`)).join('');
    const anyCommander = lib.commanders.length > 1 || value === 'commander' ? opt('commander', 'Any commander', value === 'commander') : '';
    const kinds = Object.entries(GROUP_LABEL).map(([k, text]) => opt(k, text, value === k)).join('');
    return `<select class="field field-sm" data-field="is" data-path="${path}" aria-label="${escapeHtml(label)}">
        ${commanders || anyCommander ? `<optgroup label="Commander">${commanders}${anyCommander}</optgroup>` : ''}
        <optgroup label="Cards">${kinds}</optgroup></select>`;
}

function groupFields(group, path, lib, label) {
    const g = group ?? { is: 'any' };
    let html = groupSelect(g, path, lib, label);
    if (g.is !== 'commander' && g.is !== 'named') {
        const [lo, hi] = g.mv ?? [0, MAX_MV];
        html += `<span>MV</span><input type="number" class="field field-sm" data-field="lo" data-path="${path}" min="0" max="${MAX_MV}" value="${lo}" aria-label="${escapeHtml(label)}: lowest mana value">
            <span>to</span><input type="number" class="field field-sm" data-field="hi" data-path="${path}" min="0" max="${MAX_MV}" value="${hi >= MAX_MV ? '' : hi}" placeholder="any" aria-label="${escapeHtml(label)}: highest mana value">`;
    }
    if (g.is === 'landRamp') {
        html += `<span>finds</span><select class="field field-sm" data-field="lands" data-path="${path}" aria-label="${escapeHtml(label)}: lands it finds">${numbers(1, 5, g.lands ?? 1)}</select><span>${inflect(g.lands ?? 1, 'land')}+</span>`;
    }
    if (g.is === 'named') {
        html += `<input type="text" class="field field-sm" data-field="names" data-path="${path}" list="gp-card-names" value="${escapeHtml((g.names ?? []).join(', '))}" placeholder="Card names, separated by commas" aria-label="${escapeHtml(label)}: card names">`;
    }
    return html;
}

function afterValue(after, lib) {
    if (!after) return '';
    return after.is === 'commander' ? groupValue(after, lib) : 'named';
}

function stepBody(step, k, lib) {
    const r = step.require;
    const label = `Step ${k + 1}`;
    const atLeast = aria => `<input type="number" class="field field-sm" data-field="atLeast" min="1" max="${MAX_MANA_TARGET}" value="${r.atLeast ?? 1}" aria-label="${label}: ${aria}">`;
    if (r.kind === 'mana') {
        return `<div class="gp-fields"><span>At least</span>${atLeast('mana needed')}<span>mana that turn</span></div>`;
    }
    if (r.kind === 'ramp') {
        return `<div class="gp-fields"><span>At least</span>${atLeast('mana ready for next turn')}<span>mana ready for next turn (your sources plus a land drop from hand)</span></div>`;
    }
    if (r.kind === 'spend') {
        return `<div class="gp-fields"><span>At least</span>${atLeast('mana to spend')}<span>mana in one turn on</span></div>
            <div class="gp-fields">${groupFields(r.group ?? { is: 'any' }, 'group', lib, label)}<span>from your hand (X spells count the X you pay)</span></div>`;
    }
    if (r.kind === 'package') {
        const options = r.options ?? [];
        const rows = options.map((o, i) => `
            <div class="gp-option" data-option="${i}">
                ${i ? '<span class="gp-or">or</span>' : ''}
                <select class="field field-sm" data-field="count" data-path="option:${i}" aria-label="${label}, choice ${i + 1}: how many">${numbers(1, MAX_COUNT, o.count ?? 1)}</select><span>×</span>
                ${groupFields(o.group, `option:${i}`, lib, `${label}, choice ${i + 1}`)}
                ${options.length > 1 ? `<button type="button" class="gp-icon-btn" data-act="remove-option" data-option="${i}" aria-label="Remove choice ${i + 1}">×</button>` : ''}
            </div>`).join('');
        const add = options.length < MAX_OPTIONS ? '<button type="button" class="btn btn-ghost btn-sm" data-act="add-option">Add another choice</button>' : '';
        return `<div class="gp-fields gp-package">${rows}${add}</div>`;
    }
    const after = afterValue(r.after, lib);
    const afterOptions = opt('', 'Any time', !after)
        + lib.commanders.map((c, i) => opt(`commander:${i}`, `After ${c.name} is out`, after === `commander:${i}`)).join('')
        + opt('named', 'After one of these is out', after === 'named');
    return `<div class="gp-fields">${groupFields(r.group, 'group', lib, label)}</div>
        <div class="gp-fields"><select class="field field-sm" data-field="after" aria-label="${label}: only after">${afterOptions}</select>
        ${after === 'named' ? `<input type="text" class="field field-sm" data-field="names" data-path="after" list="gp-card-names" value="${escapeHtml((r.after?.names ?? []).join(', '))}" placeholder="Card names, separated by commas" aria-label="${label}: after these cards">` : ''}</div>
        <div class="gp-fields"><span>Paying at least</span><input type="number" class="field field-sm" data-field="paid" min="1" max="${MAX_MANA_TARGET}" value="${r.paid ?? ''}" placeholder="any" aria-label="${label}: mana paid at least">
        <label class="gp-check"><input type="checkbox" data-field="copied"${r.copied ? ' checked' : ''}> and copied</label></div>`;
}

/** The step's readback: what the engine checks, or why it can't yet. */
function stepRead(step) {
    const valid = normalizeRequirement(step.require);
    if (!valid) return '<span class="gp-quiet">Not checked yet: name at least one card.</span>';
    return `<strong>${step.info ? 'Measures' : 'Checks'}:</strong> ${GP.stepTitle({ turn: step.turn, require: valid }, { html: true })}${step.info ? ' <span class="gp-quiet">(not part of the plan)</span>' : ''}`;
}

function renderEditor(lib) {
    const el = $('gp-steps');
    if (!el) return;
    const steps = draft?.steps ?? [];
    el.innerHTML = steps.map((step, k) => `
        <li class="gp-step${normalizeRequirement(step.require) ? '' : ' is-invalid'}" data-index="${k}">
            <div class="gp-step-head">
                <span class="gp-step-n" aria-hidden="true">${k + 1}</span>
                <select class="field field-sm" data-field="turn" aria-label="Step ${k + 1}: by turn">${Array.from({ length: MAX_TURN }, (_, i) => opt(String(i + 1), `By turn ${i + 1}`, step.turn === i + 1)).join('')}</select>
                <select class="field field-sm" data-field="kind" aria-label="Step ${k + 1}: what">${Object.entries(KIND_LABEL).map(([v, t]) => opt(v, t, step.require.kind === v)).join('')}</select>
                <label class="gp-check"><input type="checkbox" data-field="info"${step.info ? ' checked' : ''} aria-label="Step ${k + 1}: measure only, not part of the plan"> measure only</label>
                <span class="gp-step-tools">
                    <button type="button" class="gp-icon-btn" data-act="up" aria-label="Move step ${k + 1} up"${k === 0 ? ' disabled' : ''}>↑</button>
                    <button type="button" class="gp-icon-btn" data-act="down" aria-label="Move step ${k + 1} down"${k === steps.length - 1 ? ' disabled' : ''}>↓</button>
                    <button type="button" class="gp-icon-btn" data-act="remove" aria-label="Remove step ${k + 1}">×</button>
                </span>
            </div>
            ${stepBody(step, k, lib)}
            <p class="gp-step-read">${stepRead(step)}</p>
        </li>`).join('');
    const add = $('gp-add-step');
    if (add) add.disabled = steps.length >= MAX_STEPS;
    const names = $('gp-card-names');
    if (names) {
        const seen = new Set();
        names.innerHTML = [...lib.commanders, ...(lib.distinct ?? [])]
            .filter(c => !c.land && !c.placeholder && !seen.has(c.key) && seen.add(c.key))
            .map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('');
    }
    editorDirty = false;
}

function refreshReadbacks() {
    for (const li of document.querySelectorAll?.('#gp-steps .gp-step') ?? []) {
        const step = draft?.steps?.[Number(li.dataset.index)];
        if (!step) continue;
        li.classList.toggle('is-invalid', !normalizeRequirement(step.require));
        const read = li.querySelector('.gp-step-read');
        if (read) read.innerHTML = stepRead(step);
    }
}

function defaultRequirement(kind, turn) {
    if (kind === 'mana') return { kind: 'mana', atLeast: Math.min(MAX_MANA_TARGET, turn + 2) };
    if (kind === 'ramp') return { kind: 'ramp', atLeast: Math.min(MAX_MANA_TARGET, turn + 3) };
    if (kind === 'spend') return { kind: 'spend', atLeast: Math.min(MAX_MANA_TARGET, turn * 2), group: { is: 'any', mv: [4, MAX_MV] } };
    if (kind === 'package') {
        return { kind: 'package', options: [{ count: 2, group: { is: 'any', mv: [4, 4] } }, { count: 1, group: { is: 'any', mv: [7, 9] } }] };
    }
    return { kind: 'cast', group: { is: 'any' } };
}

function groupFrom(value, old, lib) {
    const m = String(value).match(/^commander:(\d+)$/);
    if (m) return { is: 'commander', names: [lib.commanders[Number(m[1])]?.name].filter(Boolean) };
    if (value === 'commander') return { is: 'commander' };
    const g = { is: value };
    if (old?.mv && old.is !== 'commander' && old.is !== 'named') g.mv = old.mv.slice();
    if (value === 'named') g.names = old?.is === 'named' ? (old.names ?? []).slice() : [];
    if (value === 'landRamp') g.lands = old?.lands ?? 2;
    return g;
}

function groupAt(step, path) {
    const r = step.require;
    if (path === 'after') return r.after;
    const m = String(path).match(/^option:(\d+)$/);
    if (m) return r.options?.[Number(m[1])]?.group;
    return r.group;
}

function setGroupAt(step, path, group) {
    const r = step.require;
    if (path === 'after') r.after = group;
    else if (/^option:\d+$/.test(path)) r.options[Number(path.slice(7))].group = group;
    else r.group = group;
}

const toInt = (value, lo, hi, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * Apply one editor field to the draft.
 * @returns {boolean} true when the step's fields changed shape (re-render the editor)
 */
function applyField(step, field, path, value, lib) {
    const r = step.require;
    switch (field) {
        case 'turn': step.turn = toInt(value, 1, MAX_TURN, step.turn); return false;
        case 'kind': step.require = defaultRequirement(value, step.turn); return true;
        case 'atLeast': r.atLeast = toInt(value, 1, MAX_MANA_TARGET, r.atLeast ?? 1); return false;
        case 'info':
            if (value) step.info = true;
            else delete step.info;
            return false;
        case 'copied':
            if (value) r.copied = true;
            else delete r.copied;
            return false;
        case 'paid':
            if (value === '' || value == null) delete r.paid;
            else r.paid = toInt(value, 1, MAX_MANA_TARGET, 1);
            return false;
        case 'after':
            if (!value) delete r.after;
            else r.after = value === 'named' ? { is: 'named', names: r.after?.is === 'named' ? r.after.names : [] } : groupFrom(value, null, lib);
            return true;
        case 'count': {
            const o = r.options?.[Number(String(path).slice(7))];
            if (o) o.count = toInt(value, 1, MAX_COUNT, o.count);
            return false;
        }
        case 'is': setGroupAt(step, path, groupFrom(value, groupAt(step, path), lib)); return true;
        case 'lo':
        case 'hi': {
            const g = groupAt(step, path);
            if (!g) return false;
            const [lo, hi] = g.mv ?? [0, MAX_MV];
            const next = field === 'lo' ? [toInt(value, 0, MAX_MV, 0), hi] : [lo, value === '' ? MAX_MV : toInt(value, 0, MAX_MV, MAX_MV)];
            if (next[1] < next[0]) next[field === 'lo' ? 1 : 0] = next[field === 'lo' ? 0 : 1];
            g.mv = next;
            return false;
        }
        case 'lands': {
            const g = groupAt(step, path);
            if (g) g.lands = toInt(value, 1, 5, 1);
            return true;
        }
        case 'names': {
            const g = groupAt(step, path);
            if (g) g.names = String(value).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
            return false;
        }
        default: return false;
    }
}

const planEdited = debounce(() => updateUI(), 250);

function edited(structural) {
    source = { kind: 'custom', id: null };
    persist();
    if (structural) editorDirty = true;
    if (editorDirty) {
        const { lib } = readInputs();
        renderEditor(lib);
    } else {
        refreshReadbacks();
    }
    planEdited();
}

function onEditorAction(act, li, button) {
    const steps = draft.steps;
    const k = Number(li?.dataset.index);
    const step = steps[k];
    if (!step) return;
    if (act === 'up' && k > 0) [steps[k - 1], steps[k]] = [steps[k], steps[k - 1]];
    else if (act === 'down' && k < steps.length - 1) [steps[k + 1], steps[k]] = [steps[k], steps[k + 1]];
    else if (act === 'remove') steps.splice(k, 1);
    else if (act === 'add-option' && step.require.options?.length < MAX_OPTIONS) step.require.options.push({ count: 1, group: { is: 'any', mv: [6, MAX_MV] } });
    else if (act === 'remove-option' && step.require.options?.length > 1) step.require.options.splice(Number(button.dataset.option), 1);
    else return;
    edited(true);
}

function addStep() {
    const steps = draft.steps;
    if (steps.length >= MAX_STEPS) return;
    const turn = Math.min(MAX_TURN, (steps[steps.length - 1]?.turn ?? 1) + 1);
    steps.push({ turn, require: defaultRequirement('cast', turn) });
    edited(true);
}

/** Replace the plan (a preset, the starter plan, a share link). */
export function setPlan(plan, from = { kind: 'custom', id: null }) {
    readInputs();
    draft = clone(GP.normalizePlan(plan));
    source = { kind: from.kind, id: from.id ?? null };
    if (source.kind === 'starter') writeStore(deckKeyNow, null);
    else persist();
    editorDirty = true;
    samples = null;
}

// ── Presets ──────────────────────────────────────────────────────────────────

/** A preset's module, checked (cached; null when it fails to load). */
export async function loadPreset(id) {
    if (presets.has(id)) return presets.get(id);
    const entry = presetEntry(id);
    if (!entry) return null;
    let preset = null;
    try {
        preset = GP.readPreset(await entry.load());
    } catch (err) {
        console.error(`Could not load the ${id} plan`, err);
    }
    presets.set(id, preset);
    return preset;
}

/** Use a preset's plan on the current deck. */
export async function usePreset(id) {
    const preset = await loadPreset(id);
    if (!preset) return false;
    setPlan(preset.plan, { kind: 'preset', id });
    updateUI();
    return true;
}

/**
 * Load a preset's bundled deck as the current deck, with its plan. It goes
 * through the deck library like an import, so it is saved with your decks.
 */
export async function tryPreset(id) {
    const preset = await loadPreset(id);
    if (!preset) return false;
    const snap = {
        ...preset.snapshot,
        name: preset.snapshot.name ?? preset.title,
        commanders: preset.snapshot.commanders ?? preset.commanders.map(name => ({ name, card: null })),
        importUrl: preset.deckUrl,
        importSource: 'preset',
        format: preset.snapshot.format ?? 'auto',
        savedAt: Date.now()
    };
    snap.id = Library.deckId(snap);
    writeStore(snap.id, { p: GP.encodePlan(preset.plan), s: preset.id });
    const saved = Library.saveDeck(snap);
    presetPick = '';
    DeckConfig.loadSnapshot(snap, { persistActive: Boolean(saved) });
    return true;
}

/** A preset's notes as paragraphs (plain text, escaped). */
function notesHTML(notes) {
    return (notes ?? []).map(n => `<p class="gp-preset-notes">${escapeHtml(n)}</p>`).join('');
}

function presetNotes(id) {
    const p = presets.get(id);
    if (!p) return '';
    const size = Object.values(p.snapshot.cardsByName ?? {}).reduce((n, c) => n + (Number(c?.count) || 0), 0) + (p.snapshot.commanders?.length ?? 0);
    return `${notesHTML(p.notes.slice(0, 1))}<p class="gp-preset-notes">Loads its ${size}-card deck as your current deck, saved with your decks.</p>`;
}

function renderPreset(inputs) {
    const el = $('gp-preset');
    if (!el) return;
    const using = source.kind === 'preset' ? presetEntry(source.id) : null;
    const match = inputs.preset;
    let html = '';
    if (using) {
        html += `<p>Plan: <strong>${escapeHtml(using.title)}</strong> — what it does and why is under “About this plan”.</p>`;
        if (!presets.has(using.id)) loadPreset(using.id).then(() => isCalculatorActive(NAME) && (renderPreset(readInputs()), renderAbout()));
    } else if (match) {
        html += `<p>This deck looks like <strong>${escapeHtml(match.title)}</strong>, which has a tuned plan.</p>
            <div class="gp-preset-row"><button type="button" class="btn btn-primary btn-sm" data-act="use-preset" data-preset="${escapeHtml(match.id)}">Use its plan</button></div>`;
    }
    if (PLAN_PRESETS.length) {
        html += `<div class="gp-preset-row">
                <label class="sr-only" for="gp-preset-select">Plans that come with a deck</label>
                <select class="field field-sm" id="gp-preset-select">${opt('', 'Plans that come with a deck…', !presetPick)}${PLAN_PRESETS.map(p => opt(p.id, p.title, presetPick === p.id)).join('')}</select>
                <button type="button" class="btn btn-sm" id="gp-preset-try"${presetPick ? '' : ' disabled'}>Try it on this deck</button>
            </div>${presetPick ? presetNotes(presetPick) : ''}`;
    }
    el.innerHTML = html;
    el.classList.toggle('is-suggested', Boolean(match && !using));
}

// ── Rendering ────────────────────────────────────────────────────────────────

const SOURCE_LABEL = { starter: 'built from this deck', custom: 'your plan', link: 'from a shared link' };

function renderRail(inputs) {
    const meta = $('gp-plan-meta');
    if (meta) meta.textContent = source.kind === 'preset' ? 'a tuned plan' : SOURCE_LABEL[source.kind] ?? '';
    renderPreset(inputs);
    if (editorDirty) renderEditor(inputs.lib);
    syncTurnOrder($('gp-order-group'), onPlay, inputs.format);
    const k = inputs.keep;
    const set = (id, value) => { const el = $(id); if (el && el.value !== value) el.value = value; };
    set('gp-keep', k.kind);
    set('gp-keep-min', String(k.minLands));
    set('gp-keep-max', String(k.maxLands));
    const hint = $('gp-keep-hint');
    if (hint) {
        hint.textContent = k.kind === 'plan'
            ? `${k.minLands}–${k.maxLands} lands, and a card for the plan’s first step that these lands can cast. London mulligan down to four cards.`
            : `${k.minLands}–${k.maxLands} lands. London mulligan down to four cards.`;
    }
    const note = $('gp-format');
    if (note) {
        const f = inputs.format;
        const parts = [f.freeMulligan
            ? `${escapeHtml(f.label)}: everyone draws on turn one and the first mulligan is free.`
            : `${escapeHtml(f.label)}: no free mulligan.`];
        if (inputs.lib.commanders.length) parts.push('Commanders are cast from the command zone, never drawn.');
        const missing = inputs.lib.missingCommanders ?? [];
        if (missing.length) parts.push(`${missing.map(escapeHtml).join(' and ')} came without ${missing.length > 1 ? 'their cards' : 'its card'} — import the deck again to plan around ${missing.length > 1 ? 'them' : 'it'}.`);
        if (inputs.lib.placeholder) parts.push('This deck is bare type counts, so only lands are played: import a decklist to plan with cards.');
        note.innerHTML = parts.join(' ');
    }
}

function heroHTML(result) {
    return renderHeroStats(GP.heroStats(result).map(s => ({ ...s, color: s.tone === 'flat' ? undefined : toneColor(s.tone) })));
}

function renderSummary(result, inputs) {
    const el = $('gp-summary');
    if (!el) return;
    el.innerHTML = renderBottomLine(GP.summarize(result, { deckName: inputs.deckName })) + (result?.steps.length ? heroHTML(result) : '');
}

function renderPending(progress = 0) {
    const el = $('gp-summary');
    if (!el) return;
    let bar = el.querySelector?.('.gp-pending-fill');
    if (!bar) {
        el.innerHTML = `
            <div class="gp-pending" role="status">
                <span>Playing ${GP.DEFAULT_GAMES.toLocaleString('en-US')} games…</span>
                <span class="gp-pending-bar"><span class="gp-pending-fill" style="width:0%"></span></span>
            </div>`;
        bar = el.querySelector?.('.gp-pending-fill');
    }
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
}

function renderFunnel(result) {
    const el = $('gp-funnel');
    const meta = $('gp-funnel-meta');
    if (!el) return;
    if (!result?.steps.length) {
        el.innerHTML = `<div class="tx-empty">${result ? 'Add a step to the plan.' : 'Load a deck with at least seven cards.'}</div>`;
        if (meta) meta.textContent = '';
        return;
    }
    if (meta) meta.textContent = `${result.games.toLocaleString('en-US')} games · ${pct(result.mulliganRate)} kept six cards or fewer`;
    const steps = result.steps;
    let weakest = -1;
    if (steps.length > 1) {
        for (const s of steps) if (weakest < 0 || s.conditional < steps[weakest].conditional) weakest = s.index;
    }
    el.innerHTML = `<ol class="gp-funnel">${steps.map((s, i) => {
        const last = i === steps.length - 1;
        const width = `${(Math.max(0, Math.min(1, s.reach)) * 100).toFixed(1)}%`;
        return `
            <li class="gp-funnel-row${last ? ' is-last' : ''}"${last ? ` style="--gp-tone:${toneColor(GP.planTone(s.reach))}"` : ''}>
                <div class="gp-funnel-label"><span class="gp-step-n">${i + 1}</span><span>${GP.stepTitle(s.step, { html: true })}</span></div>
                <div class="gp-funnel-track" role="img" aria-label="${pct(s.reach)} of games still on plan after step ${i + 1}"><span class="gp-funnel-fill" style="width:${width}"></span></div>
                <div class="gp-funnel-nums">
                    <span><strong>${pct(s.reach)}</strong> still on plan</span>
                    ${i ? `<span><strong>${pct(s.conditional)}</strong> of the games that got here</span>` : ''}
                    <span>on its own: ${pct(s.onTime)} on time, ${pct(s.late)} within a turn</span>
                    ${s.index === weakest ? '<span class="gp-weak">weakest step</span>' : ''}
                </div>
            </li>`;
    }).join('')}</ol>`;
}

function renderReasons(result) {
    const el = $('gp-reasons');
    const meta = $('gp-reasons-meta');
    if (!el) return;
    if (!result?.steps.length) {
        el.innerHTML = '';
        if (meta) meta.textContent = '';
        return;
    }
    const rows = GP.reasonRows(result, { limit: 6 });
    if (meta) meta.textContent = `${pct(1 - result.onTime)} of games miss`;
    if (!rows.length) {
        el.innerHTML = '<div class="tx-empty">Every game made every step on time.</div>';
        return;
    }
    el.innerHTML = `<ul class="gp-reasons">${rows.map(r => `
        <li class="gp-reason">
            <span class="gp-reason-text">${r.text}</span>
            <span class="gp-reason-bar">${pBarCell(r.share)}</span>
            <span class="gp-reason-share">${pct(r.share)}</span>
        </li>`).join('')}</ul>`;
}

function renderMana(result) {
    const el = $('gp-mana');
    const title = $('gp-mana-title');
    const meta = $('gp-mana-meta');
    const caption = $('gp-mana-caption');
    if (!el) return;
    if (!result?.steps.length) {
        el.innerHTML = '';
        if (caption) caption.textContent = '';
        if (meta) meta.textContent = '';
        return;
    }
    const k = result.keyMana;
    const req = k.required;
    if (title) title.textContent = `Mana on turn ${k.turn}, out of 100 games`;
    if (meta) meta.textContent = k.p25 === k.p75 ? `most games ${k.p50}` : `half of games ${k.p25}–${k.p75}`;
    const dots = pmfQuantiles(k.hist, 100).map(value => ({ value, tone: req == null ? 'flat' : value >= req ? 'good' : 'bad' }));
    const legend = req == null ? [] : [{ tone: 'good', label: `made ${req}+ mana` }, { tone: 'bad', label: 'fell short' }];
    const words = describeDots(dots, { format: v => `${v} mana`, legend });
    const rows = GP.manaRows(k.hist, result.games).map(r => [`${r.value}${r.plus ? '+' : ''} mana`, pct(r.share), pct(r.atLeast)]);
    el.innerHTML = dotPlot({
        dots,
        label: `Mana made on turn ${k.turn}, out of 100 games. ${words}`,
        unit: 'game',
        format: v => String(v),
        xLabel: `Mana made on turn ${k.turn}`,
        threshold: req,
        thresholdLabel: req != null ? `${req}+ needed` : '',
        legend,
        maxColumns: 30,
        table: { summary: `All ${result.games.toLocaleString('en-US')} games`, caption: `Share of games by mana made on turn ${k.turn}`, head: ['Mana', 'Games', 'At least this'], rows }
    });
    if (caption) {
        caption.textContent = `${words} ${req != null
            ? `The plan needs ${req} on turn ${k.turn}.`
            : `Turn ${k.turn} is the plan’s last step.`} Mana made counts what you spent and what you could still make, after your land drop.`;
    }
}

/** A preset's notes, while its plan is the one in use. */
function renderAbout() {
    const panel = $('gp-about-panel');
    const el = $('gp-about');
    if (!panel || !el) return;
    const p = source.kind === 'preset' ? presets.get(source.id) : null;
    panel.hidden = !p?.notes?.length;
    el.innerHTML = p ? notesHTML(p.notes) : '';
    const meta = $('gp-about-meta');
    if (meta) meta.textContent = p ? p.title : '';
}

/** 100 games as dots for one measured distribution. */
function measureDots(values, label) {
    const dots = pmfQuantiles(values.hist, 100).map(value => ({ value, tone: 'flat' }));
    const words = describeDots(dots, { format: v => String(v) });
    const rows = GP.valueRows(values).map(r => [`${r.value}${r.plus ? '+' : ''}`, pct(r.share), pct(r.atLeast)]);
    return dotPlot({
        dots,
        label: `${label}, out of 100 games. ${words}`,
        unit: 'game',
        format: v => String(v),
        xLabel: label,
        maxColumns: 30,
        table: { summary: `All ${values.games.toLocaleString('en-US')} games measured`, caption: label, head: ['Value', 'Games', 'At least this'], rows }
    });
}

/** Steps that measure something (values) and information-only steps. */
function renderMeasures(result) {
    const panel = $('gp-measures-panel');
    const el = $('gp-measures');
    if (!panel || !el) return;
    const measured = (result?.steps ?? []).filter(s => s.values);
    const info = GP.infoRows(result, { html: true });
    panel.hidden = !measured.length && !info.length;
    if (panel.hidden) {
        el.innerHTML = '';
        return;
    }
    const meta = $('gp-measures-meta');
    if (meta) meta.textContent = info.length ? `${info.length} measured beside the plan` : '';
    const range = v => (v.p25 === v.p75 ? `most games: ${v.p50}` : `half of games: ${v.p25}–${v.p75}`);
    const blocks = measured.map(s => {
        const label = GP.valueLabel(s.step);
        return `<div class="gp-measure">
            <div class="gp-measure-head"><span>${label}</span><span class="gp-measure-sub">${range(s.values)} · 1 in 10: ${s.values.p90}+${s.step.require.kind === 'cast' ? ` · ${s.values.games.toLocaleString('en-US')} games that made the step` : ''}</span></div>
            ${measureDots(s.values, label)}
        </div>`;
    });
    for (const row of info) {
        blocks.push(`<div class="gp-measure">
            <div class="gp-measure-head"><span>${row.title} <span class="gp-quiet">(measure only)</span></span><span><strong>${pct(row.onTime)}</strong> on time · ${pct(row.late)} within a turn</span></div>
            ${row.values && row.label ? `<p class="gp-measure-sub">${row.label}: ${range(row.values)}</p>` : ''}
        </div>`);
    }
    el.innerHTML = blocks.join('');
}

function describeTurn(e) {
    const bits = [];
    if (e.lands.length) bits.push(e.lands.map(l => l.split(' → ').map(n => cardRef(n)).join(' → ')).join(', '));
    for (const n of e.notes) bits.push(`<span class="gp-note">${escapeHtml(n)}</span>`);
    for (const c of e.cast) {
        const notes = c.notes.length ? ` <span class="gp-note">→ ${c.notes.map(escapeHtml).join(', ')}</span>` : '';
        bits.push(`${cardRef(c.name)}${notes}`);
    }
    return bits.join(' · ') || '<span class="gp-quiet">no land, nothing cast</span>';
}

function verdict(game, plan) {
    if (game.onTime) return '<span class="gp-verdict tone-good">On plan</span>';
    if (game.late) return '<span class="gp-verdict tone-warn">One turn late</span>';
    const reason = GP.reasonText({ step: game.failStep, code: game.reason & 255, colour: (game.reason >> 8) & 31 }, plan, { html: true });
    return `<span class="gp-verdict tone-bad">Missed</span>${reason ? ` — ${reason}` : ''}`;
}

function renderSamples(result) {
    const el = $('gp-samples');
    if (!el) return;
    const games = samples ?? result?.samples ?? [];
    if (!result || !games.length) {
        el.innerHTML = '<div class="tx-empty">Load a deck with at least seven cards to see sample games.</div>';
        return;
    }
    const html = games.map((g, i) => {
        const mull = g.mulligans ? `after ${g.mulligans} ${inflect(g.mulligans, 'mulligan')}` : 'no mulligan';
        const turns = g.turns.slice(0, result.lastTurn).map(e => `
            <li class="gp-turn${e.steps.length ? ' is-step' : ''}">
                <span class="gp-turn-n">T${e.turn}</span>
                <span class="gp-turn-mana" aria-label="${e.mana} mana">${e.mana}${manaPips(e.colors)}</span>
                <span class="gp-turn-what">${describeTurn(e)}${e.steps.length ? `<span class="gp-turn-flag">← step ${e.steps.map(k => k + 1).join(', ')}</span>` : ''}</span>
            </li>`).join('');
        return `
            <article class="gp-game">
                <div class="gp-game-head"><span><strong>Game ${i + 1}</strong> · kept ${g.hand.length} ${inflect(g.hand.length, 'card')}, ${g.handLands} ${inflect(g.handLands, 'land')}, ${mull}</span><span>${verdict(g, result.plan)}</span></div>
                <ol class="gp-turns">${turns}</ol>
            </article>`;
    }).join('');
    el.innerHTML = `
        <p class="tx-caption is-below">Each row is one turn: the mana made (with its colours), the land played, then what was cast — <span class="gp-note">→</span> shows what it did. The highlighted turns finished a step.</p>
        <div class="gp-games">${html}</div>
        <p class="gp-samples-foot">${games.length} of ${result.games.toLocaleString('en-US')} simulated games${reshuffles ? ', reshuffled' : ''}.</p>`;
}

function renderRules(lib) {
    const el = $('gp-rules');
    const meta = $('gp-rules-meta');
    if (!el) return;
    const seen = new Set();
    const rows = [...lib.commanders, ...(lib.distinct ?? [])].filter(c => c.rule && !seen.has(c.key) && seen.add(c.key));
    if (meta) meta.textContent = rows.length ? `${rows.length} ${inflect(rows.length, 'card')}` : '';
    el.innerHTML = rows.length
        ? `<ul class="gp-rules">${rows.map(c => `
            <li class="gp-rule">
                <span>${cardRef(c.name)}${c.commander ? ' <span class="gp-quiet">· commander</span>' : ''}</span>
                <span class="gp-rule-read">${escapeHtml(c.rule.label ?? '')}${c.rule.detected ? ' (read from its rules text)' : ''}</span>
            </li>`).join('')}</ul>`
        : '<div class="tx-empty">No card in this deck needs a rule of its own.</div>';
}

/** Run after the next paint (a task queued from requestAnimationFrame). */
const afterPaint = fn => (typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(() => setTimeout(fn, 0))
    : setTimeout(fn, 0));

/** The answer first; the evidence a frame later. */
function render(result, inputs) {
    const token = ++renderToken;
    renderSummary(result, inputs);
    afterPaint(() => {
        if (token !== renderToken || !isCalculatorActive(NAME)) return;
        renderAbout();
        renderFunnel(result);
        renderReasons(result);
        renderMana(result);
        renderMeasures(result);
        renderSamples(result);
        renderRules(inputs.lib);
    });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function updateUI() {
    if (!isCalculatorActive(NAME)) return;
    const inputs = readInputs();
    renderRail(inputs);
    const key = cacheKey(inputs);
    if (current?.key !== key) samples = null;
    if (inputs.lib.cards.length < 7) {
        current = { key, result: null, inputs };
        render(null, inputs);
        return;
    }
    if (cache.has(key)) {
        current = { key, result: cache.get(key), inputs };
        render(current.result, inputs);
        return;
    }
    renderPending(0);
    runSliced(inputs, key, renderPending).then(result => {
        if (result === undefined || !isCalculatorActive(NAME)) return;
        current = { key, result, inputs };
        render(result, inputs);
    }).catch(err => console.error('Game plan simulation failed:', err));
}

function reshuffle() {
    if (!current?.result) return;
    const { inputs } = current;
    reshuffles += 1;
    const run = GP.createPlanRun(inputs.lib, inputs.plan, { ...runOptions(inputs), games: GP.SAMPLE_GAMES, seed: GP.SEED + reshuffles * 7919 });
    GP.runPlanBatch(run);
    samples = run.sampleGames;
    renderSamples(current.result);
}

function onChange(e) {
    const t = e.target;
    if (t.id === 'gp-keep' || t.id === 'gp-keep-min' || t.id === 'gp-keep-max') {
        const next = { ...keep };
        if (t.id === 'gp-keep') next.kind = t.value;
        if (t.id === 'gp-keep-min') next.minLands = Number(t.value);
        if (t.id === 'gp-keep-max') next.maxLands = Number(t.value);
        if (t.id === 'gp-keep-min' && next.maxLands < next.minLands) next.maxLands = next.minLands;
        if (t.id === 'gp-keep-max' && next.minLands > next.maxLands) next.minLands = next.maxLands;
        keep = GP.normalizeKeep(next);
        updateUI();
        return;
    }
    if (t.id === 'gp-preset-select') {
        presetPick = t.value;
        if (presetPick) loadPreset(presetPick).then(() => renderPreset(readInputs()));
        else renderPreset(readInputs());
        return;
    }
    const li = t.closest?.('.gp-step');
    if (!li || !t.dataset?.field || !draft) return;
    const step = draft.steps[Number(li.dataset.index)];
    if (!step) return;
    const { lib } = readInputs();
    edited(applyField(step, t.dataset.field, t.dataset.path ?? 'group', t.type === 'checkbox' ? t.checked : t.value, lib));
}

function onInput(e) {
    const t = e.target;
    if (!['lo', 'hi', 'atLeast', 'names', 'paid'].includes(t.dataset?.field)) return;
    onChange(e);
}

export function init() {
    const root = document.getElementById(`${NAME}-tab`);
    if (!root) return;
    root.addEventListener('click', e => {
        const order = turnOrderClicked(e);
        if (order !== null) {
            onPlay = order;
            updateUI();
            return;
        }
        const t = e.target;
        if (t.closest?.('#gp-reshuffle')) return reshuffle();
        if (t.closest?.('#gp-add-step')) return addStep();
        if (t.closest?.('#gp-reset')) {
            const { lib } = readInputs();
            setPlan(GP.starterPlan(lib), { kind: 'starter' });
            return updateUI();
        }
        if (t.closest?.('#gp-preset-try')) {
            if (presetPick) tryPreset(presetPick);
            return;
        }
        const button = t.closest?.('[data-act]');
        if (!button) return;
        if (button.dataset.act === 'use-preset') return usePreset(button.dataset.preset);
        onEditorAction(button.dataset.act, button.closest('.gp-step'), button);
    });
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    ({ updateUI: debouncedUpdate } = registerCalculator({ name: NAME, calculate, updateUI }));
}

// ── Share links ──────────────────────────────────────────────────────────────

/** The plan (compact), turn order and keep rule when they differ from the defaults. */
export function getShareParams() {
    const inputs = readInputs();
    const out = {};
    const code = GP.encodePlan(inputs.plan);
    if (code) out.gp = code;
    if (!onPlay) out.gpdraw = 1;
    const k = GP.normalizeKeep(keep);
    const d = GP.DEFAULT_KEEP;
    if (k.kind !== d.kind || k.minLands !== d.minLands || k.maxLands !== d.maxLands) out.gpkeep = `${k.kind === 'lands' ? 'l' : 'p'}${k.minLands}${k.maxLands}`;
    return out;
}

/** Apply share params: a damaged plan is ignored whole, never half-applied. */
export function applyShareParams(params) {
    const get = k => (params?.has?.(k) ? params.get(k) : null);
    const code = get('gp');
    if (code) {
        const plan = GP.decodePlan(code);
        if (plan) setPlan(plan, { kind: 'link' });
        else console.warn('Ignoring a damaged game plan in the link');
    }
    if (get('gpdraw') === '1') onPlay = false;
    const k = get('gpkeep');
    if (k && /^[pl][0-7][0-7]$/.test(k)) keep = GP.normalizeKeep({ kind: k[0] === 'l' ? 'lands' : 'plan', minLands: Number(k[1]), maxLands: Number(k[2]) });
    debouncedUpdate?.();
}

/** Current settings and plan (for tests). */
export function getSettings() {
    return { onPlay, keep: { ...keep }, plan: GP.normalizePlan(draft), source: { ...source } };
}
