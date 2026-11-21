/**
 * Game plans — the schema, its share-link codec, card groups and their words.
 *
 * A plan is an ordered list of steps, each a turn and a requirement:
 *
 *   { v: 1, steps: [
 *       { turn: 2, require: { kind: 'cast', group: { is: 'mana', mv: [0, 2] } } },
 *       { turn: 3, require: { kind: 'cast', group: { is: 'commander', names: ['Selvala, Eager Trailblazer'] } } },
 *       { turn: 4, require: { kind: 'mana', atLeast: 8 } },
 *       { turn: 4, require: { kind: 'package', options: [
 *           { count: 2, group: { is: 'any', mv: [4, 4] } },
 *           { count: 1, group: { is: 'any', mv: [7, 9] } } ] } },
 *       { turn: 6, require: { kind: 'cast', group: { is: 'historic' }, after: { is: 'named', names: ['The Sixth Doctor'] } } }
 *   ] }
 *
 * Requirements
 *   cast     Cast a card from the group by the step's turn (from your hand, or
 *            a commander from the command zone). With `after`, a permanent
 *            matching `after` must be on the battlefield when you cast it.
 *            Each cast counts towards one step only.
 *   mana     Have `atLeast` mana available on some turn by the step's turn
 *            (lands, mana creatures, rocks and triggers, counting what you
 *            cast that turn).
 *   package  Cast every card of one option in the same turn, from your hand
 *            — "two 4-drops or one 7–9-drop".
 *
 * Groups ({ is, mv?: [lo, hi], names?: [...], lands?: n }) pick nonland cards:
 *   any · mana (a mana source) · ramp (anything ramp.js counts) · landRamp
 *   (fetches `lands` or more lands) · historic (artifact, legendary or Saga)
 *   · commander (any, or the named ones) · named · creature · artifact ·
 *   enchantment · planeswalker · instant · sorcery · permanent.
 *   `mv` bounds the mana value (X counts as 0).
 *
 * Everything here is plain data in, plain data out: plans are serialisable
 * for share links, saved plans and the preset modules (js/data/plans/).
 */

import { nameKey } from './library.js';

export const PLAN_VERSION = 1;
export const MAX_TURN = 10;
export const MAX_STEPS = 8;
export const MAX_OPTIONS = 4;
export const MAX_COUNT = 4;
export const MAX_MV = 20;
export const MAX_MANA_TARGET = 40;
const MAX_NAMES = 12;
const MAX_NAME_LENGTH = 80;

/** Group kinds, in the order the editor lists them. */
export const GROUP_KINDS = Object.freeze([
    'mana', 'ramp', 'landRamp', 'commander', 'named', 'historic',
    'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery', 'permanent', 'any'
]);
export const REQUIREMENT_KINDS = Object.freeze(['cast', 'mana', 'package']);
const TYPE_KINDS = new Set(['creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery']);

// ── Validation ───────────────────────────────────────────────────────────────

const int = (value, lo, hi, fallback) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

function cleanNames(names) {
    if (!Array.isArray(names)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of names) {
        if (typeof raw !== 'string') continue;
        const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
        const key = nameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= MAX_NAMES) break;
    }
    return out;
}

/**
 * A valid group, or null. Unknown kinds become null; a named group without
 * names is null (it could match nothing).
 * @param {Object} group
 * @returns {{is:string, mv?:[number,number], names?:string[], lands?:number}|null}
 */
export function normalizeGroup(group) {
    if (!group || typeof group !== 'object') return null;
    const is = GROUP_KINDS.includes(group.is) ? group.is : null;
    if (!is) return null;
    const out = { is };
    if (Array.isArray(group.mv) && group.mv.length === 2) {
        const lo = int(group.mv[0], 0, MAX_MV, 0);
        const hi = Math.max(lo, int(group.mv[1], 0, MAX_MV, MAX_MV));
        if (lo > 0 || hi < MAX_MV) out.mv = [lo, hi];
    }
    const names = cleanNames(group.names);
    if (is === 'named' && !names.length) return null;
    if ((is === 'named' || is === 'commander') && names.length) out.names = names;
    if (is === 'landRamp') out.lands = int(group.lands, 1, 5, 1);
    return out;
}

/**
 * A valid requirement, or null.
 * @param {Object} require
 */
export function normalizeRequirement(require) {
    if (!require || typeof require !== 'object') return null;
    if (require.kind === 'mana') {
        const atLeast = int(require.atLeast, 1, MAX_MANA_TARGET, null);
        return atLeast ? { kind: 'mana', atLeast } : null;
    }
    if (require.kind === 'cast') {
        const group = normalizeGroup(require.group);
        if (!group) return null;
        const after = require.after ? normalizeGroup(require.after) : null;
        return after ? { kind: 'cast', group, after } : { kind: 'cast', group };
    }
    if (require.kind === 'package') {
        const options = (Array.isArray(require.options) ? require.options : [])
            .map(o => {
                const group = normalizeGroup(o?.group);
                return group ? { count: int(o.count, 1, MAX_COUNT, 1), group } : null;
            })
            .filter(Boolean)
            .slice(0, MAX_OPTIONS);
        return options.length ? { kind: 'package', options } : null;
    }
    return null;
}

/**
 * A valid plan: steps with a turn (1–MAX_TURN) and a valid requirement,
 * at most MAX_STEPS; invalid steps are dropped, never "fixed" into something
 * else. Always returns a plan (possibly with no steps).
 * @param {Object} plan
 * @returns {{v:number, steps:Array<{turn:number, require:Object}>}}
 */
export function normalizePlan(plan) {
    const steps = (Array.isArray(plan?.steps) ? plan.steps : [])
        .map(s => {
            const require = normalizeRequirement(s?.require);
            return require ? { turn: int(s.turn, 1, MAX_TURN, 1), require } : null;
        })
        .filter(Boolean)
        .slice(0, MAX_STEPS);
    return { v: PLAN_VERSION, steps };
}

// ── Share-link codec ─────────────────────────────────────────────────────────
//
// Compact and URL-safe: only letters, digits and `*-._`, the characters a
// query string carries unescaped. Steps are joined by `_`; a step is its
// turn, a kind letter and a body:
//   c<group>[-<after group>]      cast
//   m<n>                           mana
//   p<count>x<group>(-<count>x<group>)*   package
// A group is a kind letter, then `.`-fields: v<lo>w<hi> (mana value),
// l<n> (lands), n<name> (each name escaped so it holds no `-._`).
// "Selvala on turn 3" is `3ck.nSelvala*2C*20Eager*20Trailblazer`.

const GROUP_CODE = Object.freeze({
    any: 'a', mana: 'm', ramp: 'r', landRamp: 'l', historic: 'h', commander: 'k', named: 'n',
    creature: 'c', artifact: 't', enchantment: 'e', planeswalker: 'w', instant: 'i', sorcery: 's', permanent: 'p'
});
const CODE_GROUP = Object.freeze(Object.fromEntries(Object.entries(GROUP_CODE).map(([k, v]) => [v, k])));

function escapeName(name) {
    return encodeURIComponent(name)
        .replace(/[-_.!~*'()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/%/g, '*');
}

function unescapeName(text) {
    try {
        return decodeURIComponent(text.replace(/\*/g, '%'));
    } catch {
        return null;
    }
}

function encodeGroup(group) {
    let s = GROUP_CODE[group.is];
    if (group.mv) s += `.v${group.mv[0]}w${group.mv[1]}`;
    if (group.is === 'landRamp') s += `.l${group.lands ?? 1}`;
    for (const name of group.names ?? []) s += `.n${escapeName(name)}`;
    return s;
}

function decodeGroup(text) {
    const [code, ...fields] = String(text).split('.');
    const is = CODE_GROUP[code];
    if (!is) return null;
    const group = { is };
    for (const field of fields) {
        let m;
        if ((m = field.match(/^v(\d{1,2})w(\d{1,2})$/))) {
            group.mv = [Number(m[1]), Number(m[2])];
            if (group.mv[1] > MAX_MV || group.mv[0] > group.mv[1]) return null;
        } else if ((m = field.match(/^l([1-5])$/))) group.lands = Number(m[1]);
        else if (field[0] === 'n' && /^n[A-Za-z0-9*]{1,400}$/.test(field)) {
            const name = unescapeName(field.slice(1));
            if (name === null) return null;
            (group.names ??= []).push(name);
        } else return null;
    }
    return normalizeGroup(group);
}

/**
 * The plan as a compact URL-safe string ('' for no steps).
 * @param {Object} plan
 * @returns {string}
 */
export function encodePlan(plan) {
    return normalizePlan(plan).steps.map(({ turn, require: r }) => {
        if (r.kind === 'mana') return `${turn}m${r.atLeast}`;
        if (r.kind === 'cast') return `${turn}c${encodeGroup(r.group)}${r.after ? `-${encodeGroup(r.after)}` : ''}`;
        return `${turn}p${r.options.map(o => `${o.count}x${encodeGroup(o.group)}`).join('-')}`;
    }).join('_');
}

/**
 * Read a plan from encodePlan()'s string. Anything malformed — one bad step
 * included — gives null, so a damaged link never half-applies.
 * @param {string} text
 * @returns {{v:number, steps:Array}|null}
 */
export function decodePlan(text) {
    if (typeof text !== 'string' || !text || text.length > 2000 || !/^[A-Za-z0-9*._-]+$/.test(text)) return null;
    const steps = [];
    for (const part of text.split('_')) {
        const m = part.match(/^(\d{1,2})([cmp])(.+)$/);
        if (!m) return null;
        const turn = Number(m[1]);
        if (turn < 1 || turn > MAX_TURN) return null;
        let require;
        if (m[2] === 'm') {
            if (!/^\d{1,2}$/.test(m[3]) || Number(m[3]) < 1 || Number(m[3]) > MAX_MANA_TARGET) return null;
            require = { kind: 'mana', atLeast: Number(m[3]) };
        } else if (m[2] === 'c') {
            const [g, after, extra] = m[3].split('-');
            if (extra !== undefined) return null;
            const group = decodeGroup(g);
            const afterGroup = after === undefined ? null : decodeGroup(after);
            if (!group || (after !== undefined && !afterGroup)) return null;
            require = afterGroup ? { kind: 'cast', group, after: afterGroup } : { kind: 'cast', group };
        } else {
            const options = [];
            for (const o of m[3].split('-')) {
                const om = o.match(new RegExp(`^([1-${MAX_COUNT}])x(.+)$`));
                const group = om ? decodeGroup(om[2]) : null;
                if (!group) return null;
                options.push({ count: Number(om[1]), group });
            }
            require = { kind: 'package', options };
        }
        const valid = normalizeRequirement(require);
        if (!valid) return null;
        steps.push({ turn, require: valid });
    }
    if (steps.length > MAX_STEPS) return null;
    return normalizePlan({ steps });
}

/** A stable key for caches: equal plans give equal keys. */
export function planKey(plan) {
    return encodePlan(plan);
}

// ── Matching cards ───────────────────────────────────────────────────────────

/**
 * A predicate for a group over the engine's cards (planEngine.js
 * `toPlanCard`): `land`, `placeholder`, `mv`, `manaSource`, `isRamp`,
 * `landsFetched`, `historic`, `commander`, `key`, `permanent` and the type
 * flags. Groups only ever match nonland cards with a known cost.
 * @param {Object} group - normalizeGroup() output
 * @returns {(card:Object) => boolean}
 */
export function compileGroup(group) {
    const g = normalizeGroup(group);
    if (!g) return () => false;
    const keys = new Set((g.names ?? []).map(nameKey));
    const lo = g.mv ? g.mv[0] : 0;
    const hi = g.mv ? g.mv[1] : Infinity;
    const lands = g.lands ?? 1;
    let test;
    switch (g.is) {
        case 'any': test = () => true; break;
        case 'mana': test = c => c.manaSource === true; break;
        case 'ramp': test = c => c.isRamp === true; break;
        case 'landRamp': test = c => (c.landsFetched ?? 0) >= lands; break;
        case 'historic': test = c => c.historic === true; break;
        case 'commander': test = c => c.commander === true && (keys.size === 0 || keys.has(c.key)); break;
        case 'named': test = c => keys.has(c.key); break;
        case 'permanent': test = c => c.permanent === true; break;
        default: test = TYPE_KINDS.has(g.is) ? c => c[g.is] === true : () => false;
    }
    return card => Boolean(card) && !card.land && !card.placeholder && card.mv >= lo && card.mv <= hi && test(card);
}

/** Does a card belong to a group? (One-off checks; compile once for loops.) */
export function matchesGroup(card, group) {
    return compileGroup(group)(card);
}

// ── Words ────────────────────────────────────────────────────────────────────

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const numberWord = n => NUMBER_WORDS[n] ?? String(n);

const TYPE_NOUN = {
    creature: 'creature', artifact: 'artifact', enchantment: 'enchantment', planeswalker: 'planeswalker',
    instant: 'instant', sorcery: 'sorcery', permanent: 'permanent spell', historic: 'historic spell', ramp: 'ramp spell'
};

function rangeText(mv) {
    if (!mv) return '';
    const [lo, hi] = mv;
    if (lo === hi) return `${lo}`;
    if (hi >= MAX_MV) return `${lo}+`;
    if (lo <= 0) return `${hi} or less`;
    return `${lo}–${hi}`;
}

/** "4-drop creature" → "4-drop creatures", "spell with MV 7+" → "spells with MV 7+". */
function pluralize(noun) {
    const at = noun.indexOf(' with MV ');
    const head = at >= 0 ? noun.slice(0, at) : noun;
    const tail = at >= 0 ? noun.slice(at) : '';
    return (/sorcery$/.test(head) ? head.replace(/y$/, 'ies') : `${head}s`) + tail;
}

/**
 * A group as a noun phrase: one and many. Names are plain text (pages wrap
 * them in cardRef themselves when they want previews).
 * @param {Object} group
 * @returns {{one:string, many:string, names:string[]}}
 */
export function groupNoun(group) {
    const g = normalizeGroup(group);
    if (!g) return { one: 'card', many: 'cards', names: [] };
    const mv = g.mv;
    const r = rangeText(mv);
    const names = g.names ?? [];
    let one;
    switch (g.is) {
        case 'commander':
            if (names.length) return { one: names.join(' or '), many: names.join(' and '), names };
            return { one: 'your commander', many: 'your commanders', names };
        case 'named':
            return { one: names.length === 1 ? names[0] : `one of ${names.join(', ')}`, many: names.join(' and '), names };
        case 'mana':
            one = mv && mv[1] <= 3 && (mv[0] <= 1 || mv[0] === mv[1]) ? `mana ${mv[1]}-drop` : `mana source${r ? ` with MV ${r}` : ''}`;
            break;
        case 'landRamp': {
            const lands = `${numberWord(g.lands ?? 1)}-land`;
            one = mv && mv[0] === mv[1] ? `${mv[0]}-mana ${lands} ramp spell` : `${lands} ramp spell${r ? ` with MV ${r}` : ''}`;
            break;
        }
        case 'any':
            if (!mv) one = 'spell';
            else if (mv[0] === mv[1]) one = `${mv[0]}-drop`;
            else if (mv[0] > 0 && mv[1] < MAX_MV) one = `${mv[0]}–${mv[1]}-drop`;
            else one = `spell with MV ${r}`;
            break;
        default: {
            const noun = TYPE_NOUN[g.is] ?? 'card';
            if (mv && mv[0] === mv[1] && g.is !== 'historic' && g.is !== 'ramp' && g.is !== 'permanent') one = `${mv[0]}-drop ${noun}`;
            else one = `${noun}${r ? ` with MV ${r}` : ''}`;
        }
    }
    return { one, many: pluralize(one), names };
}

/** "a" or "an" for a noun phrase (numbers by sound: an 8-drop, an 11-drop). */
export function article(phrase) {
    return /^(?:[aeiou]|8|11|18)/i.test(String(phrase)) ? 'an' : 'a';
}

/**
 * One step in words, without its turn: "Cast a mana 2-drop", "Have 8+ mana",
 * "Cast two 4-drops or one 7–9-drop", "Cast a historic spell after The Sixth
 * Doctor is out".
 * @param {Object} step - {turn, require}
 * @param {{name?:(name:string)=>string}} [opts] - wraps card names (cardRef)
 * @returns {string}
 */
export function describeRequirement(step, { name = n => n } = {}) {
    const r = step?.require;
    if (!r) return '';
    const phrase = group => {
        const noun = groupNoun(group);
        if (noun.names.length && (group.is === 'commander' || group.is === 'named')) {
            const list = noun.names.map(name);
            return list.length === 1 ? list[0] : `${group.is === 'named' ? 'one of ' : ''}${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
        }
        return `${article(noun.one)} ${noun.one}`;
    };
    if (r.kind === 'mana') return `Have ${r.atLeast}+ mana`;
    if (r.kind === 'cast') return `Cast ${phrase(r.group)}${r.after ? ` after ${phrase(r.after)} is out` : ''}`;
    const options = r.options.map(o => {
        const noun = groupNoun(o.group);
        if (noun.names.length && (o.group.is === 'named' || o.group.is === 'commander')) return `${numberWord(o.count)} of ${noun.names.map(name).join(', ')}`;
        return `${numberWord(o.count)} ${o.count === 1 ? noun.one : noun.many}`;
    });
    return `Cast ${options.join(' or ')}`;
}

/** The step's subject for failure reasons: "mana 2-drop", "Selvala, Eager Trailblazer", "payoff". */
export function stepSubject(step) {
    const r = step?.require;
    if (!r) return '';
    if (r.kind === 'cast') {
        const noun = groupNoun(r.group);
        return noun.names.length ? noun.names.join(' or ') : noun.one;
    }
    if (r.kind === 'package') return 'payoff';
    return 'mana';
}
