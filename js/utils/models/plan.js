/**
 * Game Plan — the page's model: the engine's results in words.
 *
 * The engine (planEngine.js) plays goldfish games towards a plan
 * (planSchema.js) with card rules from planRules.js. This module turns a run
 * into the page's answer — the bottom line, the reasons a plan misses, a
 * starter plan for a deck without one — and matches the deck against the
 * presets (js/data/plans/). Pure: no DOM, no deck state.
 */

import {
    buildPlanLibrary, buildPlanCountsLibrary, createPlanRun, runPlanBatch, finishPlanRun, simulatePlan,
    playScriptedPlanGame, findPlanCard, normalizeKeep, DEFAULT_KEEP, DEFAULT_GAMES, SEED, SAMPLE_GAMES, MAX_TURNS, REASON
} from '../planEngine.js';
import {
    normalizePlan, encodePlan, decodePlan, planKey, describeRequirement, stepSubject, groupNoun, article,
    MAX_TURN, MAX_MV
} from '../planSchema.js';
import { nameKey } from '../library.js';
import { renderManaCost } from '../mana.js';
import { quantile } from '../stats.js';
import { cardRef, escapeHtml } from '../../data/glossary.js';
import { pct } from '../text.js';

export {
    buildPlanLibrary, buildPlanCountsLibrary, createPlanRun, runPlanBatch, finishPlanRun, simulatePlan,
    playScriptedPlanGame, findPlanCard, normalizeKeep, DEFAULT_KEEP, DEFAULT_GAMES, SEED, SAMPLE_GAMES, MAX_TURNS, REASON,
    normalizePlan, encodePlan, decodePlan, planKey, describeRequirement
};

const COLOUR_SYMBOL = Object.freeze({ 1: 'W', 2: 'U', 4: 'B', 8: 'R', 16: 'G' });

// ── A plan for any deck ──────────────────────────────────────────────────────

/** Ramp tiers for a starter plan: the first the deck has six or more copies of. */
const STARTER_RAMP = Object.freeze([
    { turn: 2, group: { is: 'mana', mv: [0, 2] }, test: c => c.manaSource && c.mv <= 2 },
    { turn: 3, group: { is: 'ramp', mv: [0, 3] }, test: c => c.isRamp && c.mv <= 3 },
    { turn: 4, group: { is: 'ramp', mv: [0, 4] }, test: c => c.isRamp && c.mv <= 4 }
]);
const STARTER_RAMP_COPIES = 6;

/**
 * The deck's top end for a starter plan: the biggest mana value it runs
 * enough of to expect one in a game (six copies, or a tenth of its spells,
 * at that mana value or more), between 4 and 8.
 * @param {Object[]} spells - nonland plan cards, one per copy
 */
function topEnd(spells) {
    const need = Math.max(STARTER_RAMP_COPIES, Math.ceil(spells.length / 10));
    for (let mv = 8; mv >= 4; mv--) {
        if (spells.filter(c => c.mv >= mv).length >= need) return mv;
    }
    return 0;
}

/**
 * A first plan built from the deck itself: early mana when the deck has
 * enough of it (a mana 2-drop by turn 2, else cheap ramp by turn 3, else
 * ramp by turn 4), each commander on curve (a turn early after ramp), then
 * the top end (see topEnd) a turn ahead of its mana value when the deck
 * ramps. A deck of bare counts gets mana targets only.
 * @param {Object} lib - buildPlanLibrary() / buildPlanCountsLibrary() output
 * @returns {{v:number, steps:Array}}
 */
export function starterPlan(lib) {
    if (!lib || lib.placeholder || !lib.cards?.length) {
        return normalizePlan({ steps: [{ turn: 3, require: { kind: 'mana', atLeast: 3 } }, { turn: 4, require: { kind: 'mana', atLeast: 4 } }] });
    }
    const steps = [];
    const spells = lib.cards.filter(c => !c.land && !c.placeholder);
    const tier = STARTER_RAMP.find(t => spells.filter(t.test).length >= STARTER_RAMP_COPIES);
    if (tier) steps.push({ turn: tier.turn, require: { kind: 'cast', group: tier.group } });
    // A commander costing more than the ramp step's turn comes a turn early.
    const early = mv => (tier && mv > tier.turn ? 1 : 0);
    let last = 0;
    for (const c of (lib.commanders ?? []).slice().sort((a, b) => a.playMv - b.playMv)) {
        const turn = Math.min(MAX_TURN, Math.max(1, c.playMv - early(c.playMv)));
        steps.push({ turn, require: { kind: 'cast', group: { is: 'commander', names: [c.name] } } });
        last = Math.max(last, turn);
    }
    const top = topEnd(spells);
    if (top) {
        const turn = Math.min(MAX_TURN, Math.max(last, 4, top - early(top)));
        steps.push({ turn, require: { kind: 'cast', group: { is: 'any', mv: [top, MAX_MV] } } });
    }
    if (!steps.length) steps.push({ turn: 4, require: { kind: 'mana', atLeast: 4 } });
    // In turn order (stable: a ramp step stays ahead of a commander due the same turn).
    return normalizePlan({ steps: steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.turn - b.s.turn || a.i - b.i).map(x => x.s) });
}

// ── Words ────────────────────────────────────────────────────────────────────

/** A step in words with its turn: "Turn 2: cast a mana 2-drop". */
export function stepTitle(step, { html = false } = {}) {
    const text = describeRequirement(step, { name: html ? n => cardRef(n) : n => n });
    return `Turn ${step.turn}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function subjectPhrase(step, html) {
    const r = step.require;
    if (r.kind === 'cast') {
        const noun = groupNoun(r.group);
        if (noun.names.length) return noun.names.map(n => (html ? cardRef(n) : n)).join(' or ');
        return `${article(noun.one)} ${noun.one}`;
    }
    return stepSubject(step);
}

/**
 * Why a plan missed, in words: "no mana 2-drop by turn 2", "couldn't make
 * {W} on turn 3", "missed a land drop by turn 4".
 * @param {{step:number, code:number, colour:number}} reason - a finishPlanRun() reason
 * @param {{steps:Array}} plan
 * @param {{html?:boolean}} [opts] - card names as cardRef previews
 * @returns {string}
 */
export function reasonText(reason, plan, { html = false } = {}) {
    const step = plan?.steps?.[reason?.step];
    if (!step) return '';
    const T = step.turn;
    const r = step.require;
    if (r.kind === 'ramp') {
        switch (reason.code) {
            case REASON.NO_CARD: return `no ramp by turn ${T}`;
            case REASON.LAND: return `a missed land drop by turn ${T}`;
            case REASON.MANA: return `too little mana to cast ramp on turn ${T}`;
            case REASON.COLOUR: {
                const symbol = `{${COLOUR_SYMBOL[reason.colour] ?? 'C'}}`;
                return `no way to make ${html ? renderManaCost(symbol) : symbol} for ramp on turn ${T}`;
            }
            default: return `ramp that left less than ${r.atLeast} mana for turn ${T + 1}`;
        }
    }
    if (r.kind === 'spend') {
        const many = groupNoun(r.group ?? { is: 'any' }).many;
        switch (reason.code) {
            case REASON.NO_PACKAGE: return `too few ${many} in hand to spend ${r.atLeast} on turn ${T}`;
            case REASON.LAND: return `a missed land drop by turn ${T}`;
            case REASON.FIT: return `${r.atLeast}+ mana on turn ${T}, but no ${many} in hand that add up to ${r.atLeast}`;
            default: return `too little mana to spend ${r.atLeast} on turn ${T}`;
        }
    }
    switch (reason.code) {
        case REASON.NO_CARD: {
            const noun = r.kind === 'cast' ? groupNoun(r.group) : null;
            const what = noun?.names.length ? noun.names.map(n => (html ? cardRef(n) : n)).join(' or ') : noun?.one ?? 'card';
            return `no ${what}${r.paid ? ` costing ${r.paid}+` : ''} by turn ${T}`;
        }
        case REASON.NO_COPY: return `nothing to copy ${subjectPhrase(step, html)} on turn ${T}`;
        case REASON.LAND: return `a missed land drop by turn ${T}`;
        case REASON.MANA: return `too little mana for ${subjectPhrase(step, html)} on turn ${T}`;
        case REASON.COLOUR: {
            const symbol = `{${COLOUR_SYMBOL[reason.colour] ?? 'C'}}`;
            return `no way to make ${html ? renderManaCost(symbol) : symbol} for ${subjectPhrase(step, html)} on turn ${T}`;
        }
        case REASON.AFTER: {
            const noun = groupNoun(r.after);
            const what = noun.names.length ? noun.names.map(n => (html ? cardRef(n) : n)).join(' or ') : `${article(noun.one)} ${noun.one}`;
            return `${what} not out by turn ${T}`;
        }
        case REASON.NO_PACKAGE: return `too few payoffs in hand on turn ${T}`;
        case REASON.SHORT: return `less than ${r.atLeast} mana on turn ${T}`;
        default: return `${subjectPhrase(step, html)} not cast by turn ${T}`;
    }
}

/** The tone of a plan's on-time chance. */
export function planTone(p) {
    if (!Number.isFinite(p)) return 'flat';
    return p >= 0.5 ? 'good' : p >= 0.25 ? 'warn' : 'bad';
}

/**
 * The page's bottom line, built from the numbers so it can't drift from them:
 * "Wild Splendor pulls off its plan on time in 46% of games, and one turn
 * late in 22% more — the usual miss is no mana 2-drop by turn 2."
 * @param {Object|null} result - finishPlanRun() output
 * @param {{deckName?:string}} [opts]
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(result, { deckName = '' } = {}) {
    if (!result) return { html: 'Load a deck with at least seven cards to check its game plan.', tone: 'flat' };
    if (!result.steps?.length) return { html: 'Add a step to the plan to see how often this deck pulls it off.', tone: 'flat' };
    const who = deckName ? escapeHtml(deckName) : 'This deck';
    let html = `${who} pulls off its plan on time in <strong>${pct(result.onTime)}</strong> of games`;
    const lateOnly = Math.max(0, result.late - result.onTime);
    if (lateOnly >= 0.005) html += `, and one turn late in <strong>${pct(lateOnly)}</strong> more`;
    const top = result.reasons?.[0];
    html += top && result.onTime < 0.995 ? ` — the usual miss is ${reasonText(top, result.plan, { html: true })}.` : '.';
    return { html, tone: planTone(result.onTime) };
}

/**
 * The reasons a plan misses, merged by text and largest first (each a share
 * of all games; together they are every game that missed).
 * @param {Object} result - finishPlanRun() output
 * @param {{limit?:number, html?:boolean}} [opts]
 * @returns {Array<{text:string, share:number, count:number, step:number}>}
 */
export function reasonRows(result, { limit = 6, html = true } = {}) {
    const rows = new Map();
    for (const r of result?.reasons ?? []) {
        const text = reasonText(r, result.plan, { html });
        const row = rows.get(text) ?? { text, share: 0, count: 0, step: r.step };
        row.share += r.share;
        row.count += r.count;
        rows.set(text, row);
    }
    const list = [...rows.values()].sort((a, b) => b.count - a.count || a.step - b.step);
    if (list.length <= limit) return list;
    const rest = list.slice(limit - 1);
    return [...list.slice(0, limit - 1), {
        text: 'other reasons',
        share: rest.reduce((s, r) => s + r.share, 0),
        count: rest.reduce((s, r) => s + r.count, 0),
        step: -1
    }];
}

/**
 * The key turn's mana as table rows: one per value, with the top 1% folded
 * into one "N+" row so the table never ends on the sampled maximum.
 * @param {ArrayLike<number>} hist - games by mana
 * @param {number} games
 * @returns {Array<{value:number, plus:boolean, share:number, atLeast:number}>}
 */
export function manaRows(hist, games) {
    if (!(games > 0)) return [];
    const counts = Array.from(hist ?? [], n => n || 0);
    const cut = quantile(counts, 0.99);
    let folded = false;
    for (let v = cut + 1; v < counts.length; v++) {
        if (!counts[v]) continue;
        counts[cut] += counts[v];
        counts[v] = 0;
        folded = true;
    }
    const rows = [];
    let atLeast = 1;
    for (let v = 0; v <= cut; v++) {
        const share = counts[v] / games;
        if (counts[v]) rows.push({ value: v, plus: folded && v === cut, share, atLeast: Math.max(0, atLeast) });
        atLeast -= share;
    }
    return rows;
}

/**
 * The hero row: plan on time, within one turn, the usual miss and the key
 * turn's mana (percentiles only).
 * @param {Object} result - finishPlanRun() output
 * @returns {Array<Object>} renderHeroStats() input (colour left to the page)
 */
export function heroStats(result) {
    if (!result?.steps?.length) return [];
    const k = result.keyMana;
    const top = reasonRows(result, { limit: Infinity, html: false })[0];
    const stats = [
        {
            label: 'Plan on time',
            tip: 'Share of games where every step happens by its turn.',
            value: pct(result.onTime),
            tone: planTone(result.onTime),
            size: 'big',
            sub: `all ${result.steps.length === 1 ? 'of it' : `${result.steps.length} steps`} by their turns`
        },
        {
            label: 'Within one turn',
            tip: 'Share of games where every step happens by its turn or the turn after.',
            value: pct(result.late),
            tone: planTone(result.late),
            sub: `${pct(Math.max(0, result.late - result.onTime))} one turn late`
        }
    ];
    if (top && result.onTime < 0.995) {
        stats.push({
            label: 'Usual miss',
            tip: 'The most common reason a game falls off the plan, counted at the first step it missed.',
            value: pct(top.share),
            tone: 'flat',
            sub: escapeHtml(top.text.charAt(0).toUpperCase() + top.text.slice(1))
        });
    }
    stats.push({
        label: `Mana on turn ${k.turn}`,
        tip: `Everything you made on turn ${k.turn} in the typical game: what you spent plus what you could still make. Half of games fall in the range below.`,
        value: String(k.p50),
        tone: 'flat',
        sub: `${k.p25 === k.p75 ? `most games: ${k.p50}` : `half of games: ${k.p25}–${k.p75}`}${k.required != null ? ` · ${pct(k.meets)} make ${k.required}+` : ''}`
    });
    return stats;
}

// ── Presets ──────────────────────────────────────────────────────────────────

function urlKey(url) {
    return String(url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * The preset this deck looks like: same commanders (every one the preset
 * names), the same deck link, or the same deck name.
 * @param {ReadonlyArray<{id:string, commanders?:string[], deckUrl?:string|null, deckName?:string}>} presets
 * @param {{commanders?:Array<string|{name:string}>, importUrl?:string|null, deckName?:string|null}} deck
 * @returns {Object|null} the matching preset entry
 */
export function matchPreset(presets, deck) {
    const zone = new Set((deck?.commanders ?? []).map(c => nameKey(typeof c === 'string' ? c : c?.name)).filter(Boolean));
    const url = urlKey(deck?.importUrl);
    const name = nameKey(deck?.deckName);
    for (const p of presets ?? []) {
        const wants = (p.commanders ?? []).map(nameKey).filter(Boolean);
        if (wants.length && wants.every(k => zone.has(k))) return p;
        if (url && p.deckUrl && urlKey(p.deckUrl) === url) return p;
        if (name && p.deckName && nameKey(p.deckName) === name) return p;
    }
    return null;
}

/**
 * A preset module checked for the fields the page relies on: an id, a
 * title, a valid plan and a deck snapshot with cards.
 * @param {Object} mod - the preset module's exports
 * @returns {{id:string, title:string, deckUrl:string|null, commanders:string[], plan:Object, notes:string, snapshot:Object}|null}
 */
export function readPreset(mod) {
    if (!mod || typeof mod.id !== 'string' || typeof mod.title !== 'string') return null;
    const plan = normalizePlan(mod.plan);
    if (!plan.steps.length || !mod.snapshot?.cardsByName || typeof mod.snapshot.cardsByName !== 'object') return null;
    const notes = (Array.isArray(mod.notes) ? mod.notes : [mod.notes]).filter(n => typeof n === 'string' && n.trim());
    return {
        id: mod.id,
        title: mod.title,
        deckUrl: typeof mod.deckUrl === 'string' ? mod.deckUrl : null,
        commanders: Array.isArray(mod.commanders) ? mod.commanders.filter(n => typeof n === 'string') : [],
        plan,
        notes,
        snapshot: mod.snapshot
    };
}

// ── Measures beside the plan ─────────────────────────────────────────────────

/** What a step's `values` measure, in words ("mana spent on …", "the copied spell's mana value"). */
export function valueLabel(step) {
    const r = step?.require;
    if (!r) return '';
    if (r.kind === 'spend') return `Mana spent on ${groupNoun(r.group ?? { is: 'any' }).many} on turn ${step.turn}`;
    if (r.kind === 'ramp') return `Mana ready for turn ${step.turn + 1} at the end of turn ${step.turn}`;
    if (r.kind === 'cast' && r.copied) return `Mana value of the spell copied by turn ${step.turn}`;
    if (r.kind === 'cast') return `Mana value of the spell cast by turn ${step.turn}`;
    return '';
}

/**
 * A step's values as rows (value, share of the games measured, at least
 * this), the top 1% folded into "N+" so a row never is the sampled maximum.
 * @param {{hist:number[], games:number}|null} values
 */
export function valueRows(values) {
    return values ? manaRows(values.hist, values.games) : [];
}

/**
 * Information-only steps, in words: "Cast The Sixth Doctor by turn 5 — 92%
 * (95% within a turn)".
 * @param {Object} result - finishPlanRun() output
 * @returns {Array<{title:string, onTime:number, late:number, values:Object|null, label:string}>}
 */
export function infoRows(result, { html = false } = {}) {
    return (result?.info ?? []).map(s => ({
        title: stepTitle(s.step, { html }),
        onTime: s.onTime,
        late: s.late,
        values: s.values,
        label: valueLabel(s.step)
    }));
}
