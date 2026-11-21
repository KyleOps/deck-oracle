/**
 * Draw odds — the exact chance of drawing cards from one or more groups by a
 * given turn, for any deck.
 *
 * A "group" is a set of cards (Sol Ring + Arcane Signet, "your ramp", "your
 * lands") plus how many of them you need. Groups may overlap — a mana dork is
 * both a creature and ramp — and a card in two groups counts toward both, so
 * the joint answer cannot multiply per-group odds. Instead the library is cut
 * into Venn regions (cards in A only, A and B, B only, …) plus everything else,
 * and a small dynamic programme walks the regions to sum the multivariate
 * hypergeometric over every way of meeting all the requirements. With three
 * groups that is seven regions; the whole turn-by-turn table costs well under
 * a millisecond for realistic requirements.
 *
 * Pure: no DOM, no deck state. The calculator (js/calculators/odds.js) feeds
 * it a library and renders what it returns.
 */

import { choose, drawTypeMin } from './hypergeometric.js';
import { FORMATS, cardsSeenByTurn } from './format.js';
import { asLibrary, isLand, unlistedCopies } from './library.js';
import { pct } from './text.js';
import { tagCard } from './cardTags.js';
import { escapeHtml, cardRef } from '../data/glossary.js';

export const GROUP_IDS = Object.freeze(['A', 'B', 'C']);
export const MAX_GROUPS = 3;
/** Last turn shown in the chart and table (turn 0 = opening hand). */
export const MAX_TURN = 10;
/** How far to look for the turn the chance passes 50% / 90%. */
export const SEARCH_TURN = 20;
/** Largest "need at least" a group can ask for. */
export const MAX_NEED = 8;
/** Share-link limits. */
export const MAX_SHARED_CARDS = 60;
export const MAX_NAME_LENGTH = 40;
const MAX_CARD_NAME = 160;
const MAX_PARAM_LENGTH = 4000;

// ── Presets ──────────────────────────────────────────────────────────────────

/**
 * Preset groups. `one`/`many` are the noun phrases the bottom line uses
 * ("a board wipe", "3 lands"), `chip` the button label, `name` the group name.
 */
export const TYPE_PRESETS = Object.freeze([
    { key: 'lands', name: 'Lands', chip: 'Lands', one: 'a land', many: 'lands' },
    { key: 'creatures', name: 'Creatures', chip: 'Creatures', one: 'a creature', many: 'creatures' },
    { key: 'instants', name: 'Instants', chip: 'Instants', one: 'an instant', many: 'instants' },
    { key: 'sorceries', name: 'Sorceries', chip: 'Sorceries', one: 'a sorcery', many: 'sorceries' },
    { key: 'artifacts', name: 'Artifacts', chip: 'Artifacts', one: 'an artifact', many: 'artifacts' },
    { key: 'enchantments', name: 'Enchantments', chip: 'Enchantments', one: 'an enchantment', many: 'enchantments' },
    { key: 'planeswalkers', name: 'Planeswalkers', chip: 'Planeswalkers', one: 'a planeswalker', many: 'planeswalkers' },
    { key: 'battles', name: 'Battles', chip: 'Battles', one: 'a battle', many: 'battles' }
]);

export const ROLE_PRESETS = Object.freeze([
    { key: 'ramp', name: 'Ramp', chip: 'Ramp', one: 'a ramp piece', many: 'ramp pieces' },
    { key: 'draw', name: 'Card draw', chip: 'Card draw', one: 'a card-draw source', many: 'card-draw sources' },
    { key: 'removal', name: 'Removal', chip: 'Removal', one: 'a removal spell', many: 'removal spells' },
    { key: 'wipe', name: 'Board wipes', chip: 'Board wipes', one: 'a board wipe', many: 'board wipes' },
    { key: 'counter', name: 'Counterspells', chip: 'Counterspells', one: 'a counterspell', many: 'counterspells' },
    { key: 'tutor', name: 'Tutors', chip: 'Tutors', one: 'a tutor', many: 'tutors' }
]);

export const MV_PRESETS = Object.freeze([
    { key: 'le2', name: 'Mana value 2 or less', chip: '2 or less', one: 'a card costing 2 or less', many: 'cards costing 2 or less', test: mv => mv <= 2 },
    { key: '3', name: '3-drops', chip: '3', one: 'a 3-drop', many: '3-drops', test: mv => mv === 3 },
    { key: '4', name: '4-drops', chip: '4', one: 'a 4-drop', many: '4-drops', test: mv => mv === 4 },
    { key: 'ge5', name: 'Mana value 5+', chip: '5 or more', one: 'a card costing 5 or more', many: 'cards costing 5 or more', test: mv => mv >= 5 }
]);

const PRESET_TABLE = { type: TYPE_PRESETS, role: ROLE_PRESETS, mv: MV_PRESETS };
const PRESET_KINDS = Object.freeze(['type', 'role', 'mv']);
const KINDS = Object.freeze(['cards', 'type', 'role', 'mv', 'manual']);

/** The preset definition for a kind + key, or null. */
export function getPreset(kind, key) {
    return PRESET_TABLE[kind]?.find(p => p.key === key) ?? null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const clampInt = (value, min, max, fallback = min) => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

/** Lowercase, accent-free, punctuation-free form of a card name for matching. */
export function normalizeName(name) {
    return String(name ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/æ/g, 'ae')
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** "Opening hand" / "Turn 3". */
export function turnLabel(turn) {
    return turn === 0 ? 'Opening hand' : `Turn ${turn}`;
}

/** "in your opening hand" / "by turn 3" — for sentences. */
export function turnPhrase(turn) {
    return turn === 0 ? 'in your opening hand' : `in hand by turn ${turn}`;
}

// ── Library ──────────────────────────────────────────────────────────────────

/**
 * The drawable library from an imported list.
 *
 * Commanders start in the command zone, so they are never in the library
 * (see library.js). Copies the import counted but could not identify
 * (`deckSize` above the listed copies) stay in the library as unnamed cards,
 * so the deck size — and every probability — matches the real list.
 *
 * @param {Object} deck - a DeckConfig snapshot, a Library from libraryOf(), or
 *   a bare cardsByName map (Scryfall-shaped records with `count`)
 * @param {{format?:Object|string, commanders?:string[], deckSize?:number|null}} [opts]
 *   format / commanders: libraryOf() options; deckSize: the import's card count
 * @returns {{manual:false, cards:Array<Object>, byName:Map<string,Object>, size:number, unlisted:number, commanders:ReadonlyArray<string>, commanderExcluded:boolean}}
 */
export function buildLibrary(deck = {}, { format, commanders, deckSize = null } = {}) {
    const source = asLibrary(deck, { format, commanders });
    const cards = [];
    for (const card of source.cards) {
        const count = card.count;
        const land = isLand(card);
        const categories = Array.isArray(card.allCategories) && card.allCategories.length
            ? card.allCategories.slice()
            : (card.category ? [card.category] : []);
        cards.push({
            name: card.name,
            count,
            land,
            mv: land ? 0 : Math.max(0, Math.floor(Number(card.cmc) || 0)),
            categories,
            roles: tagCard(card),
            typeLine: String(card.type_line ?? '')
        });
    }
    cards.sort((a, b) => a.name.localeCompare(b.name));
    const unlisted = unlistedCopies(source, deckSize);
    const size = cards.reduce((s, c) => s + c.count, 0) + unlisted;
    const byName = new Map(cards.map(c => [c.name, c]));
    const zone = source.commanders;
    return { manual: false, cards, byName, size, unlisted, commanders: zone, commanderExcluded: zone.length > 0 };
}

/**
 * A library made of bare type counts (no card list). Groups are then plain
 * copy counts and are treated as separate cards.
 * @param {Record<string, number>} typeCounts - e.g. { lands: 36, creatures: 30 }
 * @param {number} deckSize
 */
export function buildManualLibrary(typeCounts = {}, deckSize = 0) {
    const counts = {};
    TYPE_PRESETS.forEach(p => { counts[p.key] = Math.max(0, Math.floor(Number(typeCounts?.[p.key]) || 0)); });
    return { manual: true, cards: [], byName: new Map(), size: Math.max(0, Math.floor(Number(deckSize) || 0)), unlisted: 0, typeCounts: counts, commanders: [], commanderExcluded: false };
}

/** Does a library card belong to a preset? */
function inPreset(card, kind, key) {
    if (kind === 'type') return key === 'lands' ? card.land : card.categories.includes(key);
    if (kind === 'role') return card.roles.includes(key);
    if (kind === 'mv') return !card.land && Boolean(getPreset('mv', key)?.test(card.mv));
    return false;
}

/** Card names a preset picks out of the library. */
export function presetMembers(library, kind, key) {
    if (!library || library.manual || !getPreset(kind, key)) return [];
    return library.cards.filter(c => inPreset(c, kind, key)).map(c => c.name);
}

/**
 * Every preset with how many copies it covers in this library (zero-copy
 * presets included so the UI can hide or disable them).
 * @returns {{type:Array, role:Array, mv:Array}} each entry: preset + {copies, cards}
 */
export function presetCounts(library) {
    const out = {};
    for (const kind of PRESET_KINDS) {
        out[kind] = PRESET_TABLE[kind].map(p => {
            if (library?.manual) {
                const copies = kind === 'type' ? library.typeCounts[p.key] ?? 0 : 0;
                return { ...p, kind, copies, cards: 0 };
            }
            const members = (library?.cards ?? []).filter(c => inPreset(c, kind, p.key));
            return { ...p, kind, copies: members.reduce((s, c) => s + c.count, 0), cards: members.length };
        });
    }
    return out;
}

/**
 * Find a card in the library by name: exact, then normalised, then by either
 * face of a split / double-faced card.
 * @returns {Object|null} the library card
 */
export function findCard(library, name) {
    if (!library || library.manual || !name) return null;
    const exact = library.byName.get(name);
    if (exact) return exact;
    const target = normalizeName(name);
    if (!target) return null;
    return library.cards.find(c => normalizeName(c.name) === target)
        ?? library.cards.find(c => c.name.split('//').some(face => normalizeName(face) === target))
        ?? null;
}

/**
 * Typeahead search over the library's card names. Ranked: exact, prefix,
 * word prefix, then anywhere; ties by copies then name.
 * @returns {Array<Object>} library cards
 */
export function searchCards(library, query, { limit = 8 } = {}) {
    if (!library || library.manual) return [];
    const q = normalizeName(query);
    if (!q) return [];
    const ranked = [];
    for (const card of library.cards) {
        const n = normalizeName(card.name);
        let rank = -1;
        if (n === q) rank = 0;
        else if (n.startsWith(q)) rank = 1;
        else if ((' ' + n).includes(' ' + q)) rank = 2;
        else if (n.includes(q)) rank = 3;
        if (rank >= 0) ranked.push({ card, rank });
    }
    ranked.sort((a, b) => a.rank - b.rank || b.card.count - a.card.count || a.card.name.localeCompare(b.card.name));
    return ranked.slice(0, Math.max(1, limit)).map(r => r.card);
}

// ── Groups ───────────────────────────────────────────────────────────────────

/** A blank group of the right kind for the library. */
export function emptyGroup(manual = false) {
    return manual
        ? { kind: 'manual', key: null, cards: [], count: 0, need: 1, name: null }
        : { kind: 'cards', key: null, cards: [], count: 0, need: 1, name: null };
}

/** A preset group. */
export function presetGroup(kind, key, need = 1) {
    return { kind, key, cards: [], count: 0, need: clampInt(need, 1, MAX_NEED, 1), name: null };
}

/** A group of named cards. */
export function cardsGroup(names = [], need = 1, name = null) {
    return { kind: 'cards', key: null, cards: [...new Set(names)], count: 0, need: clampInt(need, 1, MAX_NEED, 1), name };
}

/**
 * Resolve a group against the library: which cards it holds and how many
 * copies. Card names not in the library are dropped.
 * @returns {{names:string[], copies:number}}
 */
export function resolveGroup(group, library) {
    if (!group || !library) return { names: [], copies: 0 };
    if (library.manual) {
        if (group.kind === 'manual') return { names: [], copies: Math.min(library.size, Math.max(0, Math.floor(Number(group.count) || 0))) };
        if (group.kind === 'type') return { names: [], copies: Math.min(library.size, library.typeCounts[group.key] ?? 0) };
        return { names: [], copies: 0 };
    }
    let names = [];
    if (group.kind === 'cards') {
        names = (group.cards ?? []).filter(n => library.byName.has(n));
    } else if (PRESET_KINDS.includes(group.kind)) {
        names = presetMembers(library, group.kind, group.key);
    }
    const copies = names.reduce((s, n) => s + (library.byName.get(n)?.count ?? 0), 0);
    return { names, copies };
}

/** The name a group shows when the user hasn't named it. */
export function autoName(group, index = 0, resolved = null) {
    const preset = getPreset(group?.kind, group?.key);
    if (preset) return preset.name;
    if (group?.kind === 'manual') return `Group ${GROUP_IDS[index] ?? ''}`.trim();
    const names = resolved?.names ?? group?.cards ?? [];
    if (names.length === 0) return `Group ${GROUP_IDS[index] ?? ''}`.trim();
    if (names.length === 1) return names[0];
    if (names.length === 2 && names[0].length + names[1].length <= 34) return `${names[0]} or ${names[1]}`;
    return `${names[0]} + ${names.length - 1} more`;
}

export function groupName(group, index = 0, resolved = null) {
    const own = typeof group?.name === 'string' ? group.name.trim() : '';
    return own || autoName(group, index, resolved);
}

// ── Exact maths ──────────────────────────────────────────────────────────────

/**
 * Split the library into Venn regions over the groups.
 *
 * With a card list every card has a membership mask (bit g set when it is in
 * group g) and copies are summed per mask. Manual groups have no card
 * identity, so each is its own region.
 *
 * @param {Array<{names:string[], copies:number}>} resolved - one per group
 * @param {Object} library
 * @returns {{regions: Array<{mask:number, size:number}>, union:number}}
 */
export function regionSizes(resolved, library) {
    const sizes = new Map();
    if (library?.manual) {
        resolved.forEach((r, g) => {
            if (r.copies > 0) sizes.set(1 << g, (sizes.get(1 << g) ?? 0) + r.copies);
        });
    } else {
        const sets = resolved.map(r => new Set(r.names));
        for (const card of library?.cards ?? []) {
            let mask = 0;
            sets.forEach((set, g) => { if (set.has(card.name)) mask |= 1 << g; });
            if (mask) sizes.set(mask, (sizes.get(mask) ?? 0) + card.count);
        }
    }
    const regions = [...sizes.entries()].map(([mask, size]) => ({ mask, size })).sort((a, b) => a.mask - b.mask);
    return { regions, union: regions.reduce((s, r) => s + r.size, 0) };
}

/**
 * Ways to draw exactly d cards from the grouped regions while meeting every
 * group's requirement, for d = 0…maxDraw.
 *
 * W[d] = Σ over region draws (x_r) with Σx_r = d and, for every group g,
 *        Σ_{r ∋ g} x_r ≥ need_g, of Π C(size_r, x_r).
 *
 * The DP state is (cards drawn from groups, per-group count capped at its
 * need), so the state space is (maxDraw+1) × Π(need_g+1) whatever the
 * region sizes.
 *
 * @param {Array<{mask:number, size:number}>} regions
 * @param {number[]} needs - per group, ≥ 0
 * @param {number} maxDraw
 * @returns {Float64Array} length maxDraw + 1
 */
export function allOfWeights(regions, needs, maxDraw) {
    const G = needs.length;
    const caps = needs.map(k => Math.max(0, Math.floor(k)));
    const strides = [];
    let block = 1;
    for (let g = 0; g < G; g++) {
        strides[g] = block;
        block *= caps[g] + 1;
    }
    const D = Math.max(0, Math.floor(maxDraw));
    const digits = Array.from({ length: block }, (_, code) => caps.map((cap, g) => Math.floor(code / strides[g]) % (cap + 1)));
    const maxCap = Math.max(0, ...caps);

    let cur = new Float64Array((D + 1) * block);
    cur[0] = 1;
    let reach = 0;
    for (const { mask, size } of regions) {
        if (!(size > 0)) continue;
        // nextCode[code * (maxCap + 1) + x]: where drawing x more from this
        // region moves the capped counts. Saturates once x passes every cap.
        const step = maxCap + 1;
        const nextCode = new Int32Array(block * step);
        for (let code = 0; code < block; code++) {
            const dg = digits[code];
            for (let x = 0; x <= maxCap; x++) {
                let c = 0;
                for (let g = 0; g < G; g++) {
                    const v = (mask >> g) & 1 ? Math.min(caps[g], dg[g] + x) : dg[g];
                    c += v * strides[g];
                }
                nextCode[code * step + x] = c;
            }
        }
        const next = new Float64Array(cur.length);
        const newReach = Math.min(D, reach + size);
        for (let d = 0; d <= reach; d++) {
            const xmax = Math.min(size, D - d);
            for (let code = 0; code < block; code++) {
                const w = cur[d * block + code];
                if (w === 0) continue;
                const base = code * step;
                for (let x = 0; x <= xmax; x++) {
                    next[(d + x) * block + nextCode[base + Math.min(x, maxCap)]] += w * choose(size, x);
                }
            }
        }
        cur = next;
        reach = newReach;
    }
    let full = 0;
    for (let g = 0; g < G; g++) full += caps[g] * strides[g];
    const W = new Float64Array(D + 1);
    for (let d = 0; d <= D; d++) W[d] = cur[d * block + full];
    return W;
}

/**
 * Chance that n cards from an N-card library meet every requirement, from
 * allOfWeights() output.
 * @param {Float64Array} W
 * @param {number} union - copies in any group
 * @param {number} N - library size
 * @param {number} n - cards seen
 */
export function allOfChance(W, union, N, n) {
    if (!(N > 0)) return 0;
    const draws = Math.max(0, Math.min(Math.floor(n), N));
    const other = Math.max(0, N - union);
    let ways = 0;
    for (let d = 0; d <= Math.min(draws, W.length - 1); d++) {
        if (W[d] !== 0) ways += W[d] * choose(other, draws - d);
    }
    const p = ways / choose(N, draws);
    return Math.min(1, Math.max(0, p));
}

/** Chance of at least `need` of `copies` cards in n draws from N. */
export function atLeastChance(N, copies, n, need) {
    if (need <= 0) return 1;
    if (!(N > 0) || copies < need) return 0;
    const draws = Math.max(0, Math.min(Math.floor(n), N));
    return Math.min(1, Math.max(0, drawTypeMin(N, Math.min(copies, N), draws, need)));
}

/** First turn at or after which `series[t] >= threshold`, else null. */
export function firstTurnReaching(series, threshold) {
    const i = series.findIndex(p => p >= threshold - 1e-12);
    return i < 0 ? null : i;
}

/**
 * The whole answer: per-group and all-together chances for every turn.
 *
 * @param {Object} opts
 * @param {Object} opts.library - from buildLibrary / buildManualLibrary
 * @param {Array<Object>} opts.groups - group specs (empty groups are skipped)
 * @param {Object} [opts.format=FORMATS.commander]
 * @param {boolean} [opts.onPlay=true]
 * @param {number} [opts.maxTurn=MAX_TURN]
 * @param {number} [opts.searchTurn=SEARCH_TURN]
 */
export function analyzeOdds({ library, groups = [], format = FORMATS.commander, onPlay = true, maxTurn = MAX_TURN, searchTurn = SEARCH_TURN } = {}) {
    const N = library?.size ?? 0;
    const active = [];
    groups.slice(0, MAX_GROUPS).forEach((group, index) => {
        const resolved = resolveGroup(group, library);
        if (resolved.copies <= 0) return;
        const need = clampInt(group.need, 1, MAX_NEED, 1);
        active.push({
            index,
            id: GROUP_IDS[index],
            kind: group.kind,
            key: group.key,
            name: groupName(group, index, resolved),
            custom: typeof group.name === 'string' && group.name.trim() !== '',
            need,
            names: resolved.names,
            cards: resolved.names.length,
            copies: resolved.copies,
            possible: need <= resolved.copies
        });
    });

    const empty = { N, groups: active, turns: [], reach50: null, reach90: null, impossible: false, overlaps: [], union: 0 };
    if (active.length === 0 || N <= 0) return empty;

    const { regions, union } = regionSizes(active.map(g => ({ names: g.names, copies: g.copies })), library);
    const lastTurn = Math.max(maxTurn, searchTurn);
    const seenAt = t => Math.min(N, cardsSeenByTurn(t, { format, onPlay }));
    const maxDraw = seenAt(lastTurn);
    const W = active.length === 1 ? null : allOfWeights(regions, active.map(g => g.need), maxDraw);

    const allSeries = [];
    const turns = [];
    for (let t = 0; t <= lastTurn; t++) {
        const seen = seenAt(t);
        const each = active.map(g => atLeastChance(N, g.copies, seen, g.need));
        const all = W ? allOfChance(W, union, N, seen) : each[0];
        allSeries.push(all);
        if (t <= maxTurn) {
            turns.push({ turn: t, seen, all, each, avg: active.map(g => (seen * g.copies) / N) });
        }
    }

    // Cards that count toward more than one group.
    const overlaps = [];
    if (!library.manual && active.length > 1) {
        const sets = active.map(g => new Set(g.names));
        for (const card of library.cards) {
            const ids = active.filter((_, i) => sets[i].has(card.name)).map(g => g.id);
            if (ids.length > 1) overlaps.push({ name: card.name, ids });
        }
    }

    return {
        N,
        groups: active,
        turns,
        reach50: firstTurnReaching(allSeries, 0.5),
        reach90: firstTurnReaching(allSeries, 0.9),
        /** The all-together chance at the last turn searched. */
        atSearch: allSeries[allSeries.length - 1] ?? 0,
        impossible: active.some(g => !g.possible),
        overlaps,
        union
    };
}

// ── Words ────────────────────────────────────────────────────────────────────

function joinWords(parts, word = 'and') {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`;
}

/**
 * The noun phrase for a group in a sentence: "Sol Ring or Arcane Signet",
 * "a board wipe", "3 lands", "2 copies of Lightning Bolt".
 * @param {Object} g - an analyzed group (from analyzeOdds)
 * @returns {string} HTML
 */
export function describeGroup(g) {
    const preset = getPreset(g.kind, g.key);
    if (preset && !g.custom) {
        return g.need === 1 ? escapeHtml(preset.one) : `${g.need} ${escapeHtml(preset.many)}`;
    }
    const names = g.names ?? [];
    if (names.length === 1) {
        if (g.need === 1) return g.copies > 1 ? `a copy of ${cardRef(names[0])}` : cardRef(names[0]);
        return `${g.need} copies of ${cardRef(names[0])}`;
    }
    if (!g.custom && g.kind === 'cards') {
        if (names.length <= 3) {
            const refs = names.map(n => cardRef(n));
            return g.need === 1 ? joinWords(refs, 'or') : `${g.need} of ${joinWords(refs, 'and')}`;
        }
        return `${g.need === 1 ? 'one' : g.need} of the ${names.length} cards in group ${g.id}`;
    }
    const label = g.custom ? `“${escapeHtml(g.name)}”` : `group ${g.id}`;
    return g.need === 1 ? `a card from ${label}` : `${g.need} cards from ${label}`;
}

/**
 * The bottom line: one sentence a player could repeat at the table, plus one
 * that says what to expect next.
 * @param {Object} result - analyzeOdds() output
 * @param {number} turn - the chosen turn
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(result, turn) {
    const groups = result?.groups ?? [];
    const row = result?.turns?.find(r => r.turn === turn) ?? null;
    if (groups.length === 0 || !row) {
        return { html: 'Pick the cards you want to find — search your list or start from a preset — and this shows the exact chance of drawing them by each turn.', tone: 'flat' };
    }

    const impossible = groups.find(g => !g.possible);
    if (impossible) {
        const what = impossible.cards === 1 && !impossible.custom && impossible.kind === 'cards'
            ? cardRef(impossible.names[0]) : `“${escapeHtml(impossible.name)}”`;
        return {
            html: `You can never draw <strong>${impossible.need}</strong> from ${what} — the deck only has <strong>${impossible.copies}</strong> ${impossible.copies === 1 ? 'copy' : 'copies'}. Lower “need at least” or add cards to the group.`,
            tone: 'bad'
        };
    }

    const p = row.all;
    const subject = joinWords(groups.map(describeGroup), 'and');
    const shown = pct(p);
    // "an 8%", "an 11%", "an 18%", "an 80–89%"
    const article = /^(8|11%|18%)/.test(shown) ? 'an' : 'a';
    let html = `You have ${article} <strong>${escapeHtml(shown)}</strong> chance to have ${subject} ${turnPhrase(turn)}.`;

    if (groups.length > 1) {
        // Name the bottleneck: the requirement that fails most often alone.
        const weakest = groups.map((g, i) => ({ g, p: row.each[i] })).sort((a, b) => a.p - b.p)[0];
        if (weakest.p < 0.995) {
            html += ` The hard part is ${describeGroup(weakest.g)}: <strong>${escapeHtml(pct(weakest.p))}</strong> on its own.`;
        }
    } else if (p < 0.9) {
        html += result.reach90 === null
            ? ` It stays under 90% even by turn ${SEARCH_TURN}.`
            : ` It passes <strong>90%</strong> ${result.reach90 === 0 ? 'in the opening hand' : `on turn ${result.reach90}`}.`;
    } else if (result.reach90 !== null && result.reach90 < turn) {
        html += ` It was already past 90% ${result.reach90 === 0 ? 'in the opening hand' : `on turn ${result.reach90}`}.`;
    }

    // A low chance is a fact about the deck, not an error: amber, never the red ✕
    // (that is reserved for impossible requests above).
    const tone = p >= 0.8 ? 'good' : p >= 0.5 ? 'flat' : 'warn';
    return { html, tone };
}

// ── Suggestions ──────────────────────────────────────────────────────────────

/**
 * Three one-click starting points that exist in this deck, each with the
 * turn it is asked by. Commander lists lead with ramp and wipes; 60- and
 * 40-card lists lead with their most-played spell.
 * @returns {Array<{label:string, turn:number, group:Object}>}
 */
export function suggestExamples(library, format = FORMATS.commander) {
    if (!library || library.size <= 0) return [];
    const counts = presetCounts(library);
    const copies = (kind, key) => counts[kind].find(p => p.key === key)?.copies ?? 0;
    const out = [];
    const add = (ok, item) => { if (ok && out.length < 3 && !out.some(o => o.label === item.label)) out.push(item); };

    if (library.manual) {
        add(copies('type', 'lands') >= 3, { label: '3 lands in your opening hand', turn: 0, group: presetGroup('type', 'lands', 3) });
        add(copies('type', 'creatures') > 0, { label: 'A creature by turn 2', turn: 2, group: presetGroup('type', 'creatures') });
        add(copies('type', 'instants') > 0, { label: 'An instant by turn 3', turn: 3, group: presetGroup('type', 'instants') });
        add(copies('type', 'artifacts') > 0, { label: 'An artifact by turn 3', turn: 3, group: presetGroup('type', 'artifacts') });
        add(copies('type', 'enchantments') > 0, { label: 'An enchantment by turn 4', turn: 4, group: presetGroup('type', 'enchantments') });
        return out;
    }

    const topSpell = library.cards
        .filter(c => !c.land && c.count > 1)
        .sort((a, b) => b.count - a.count || a.mv - b.mv || a.name.localeCompare(b.name))[0];
    const commanderish = format?.key === 'commander';
    const cand = [];
    if (!commanderish && topSpell) {
        const turn = Math.max(2, Math.min(4, topSpell.mv));
        cand.push([true, { label: `${topSpell.name} by turn ${turn}`, turn, group: cardsGroup([topSpell.name]) }]);
    }
    cand.push([copies('role', 'ramp') > 0, { label: 'Your ramp by turn 2', turn: 2, group: presetGroup('role', 'ramp') }]);
    cand.push([copies('role', 'wipe') > 0, { label: 'A board wipe by turn 6', turn: 6, group: presetGroup('role', 'wipe') }]);
    cand.push([copies('mv', 'le2') > 0, { label: 'Any of your 2-drops by turn 2', turn: 2, group: presetGroup('mv', 'le2') }]);
    cand.push([copies('role', 'removal') > 0, { label: 'Removal by turn 4', turn: 4, group: presetGroup('role', 'removal') }]);
    cand.push([copies('role', 'draw') > 0, { label: 'Card draw by turn 4', turn: 4, group: presetGroup('role', 'draw') }]);
    cand.push([copies('type', 'lands') >= 3, { label: '3 lands in your opening hand', turn: 0, group: presetGroup('type', 'lands', 3) }]);

    // Constructed lists care about the curve before ramp and wipes.
    if (!commanderish) cand.sort((a, b) => order(a[1]) - order(b[1]));
    cand.forEach(([ok, item]) => add(ok, item));
    return out;

    function order(item) {
        const key = item.group.key ?? 'card';
        return { card: 0, le2: 1, lands: 2, removal: 3, draw: 4, ramp: 5, wipe: 6 }[key] ?? 9;
    }
}

// ── Share links ──────────────────────────────────────────────────────────────

const stripSeparators = s => String(s ?? '').replace(/[~|]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Encode one group for a share link: `<need>~<name>~<source>`, where source
 * is `t:lands` / `r:ramp` / `m:le2` / `n:12` (manual copies) /
 * `c:Card One|Card Two`. An empty name means "use the automatic name".
 * @returns {string|null} null for an empty group
 */
export function encodeGroup(group) {
    if (!group || !KINDS.includes(group.kind)) return null;
    const need = clampInt(group.need, 1, MAX_NEED, 1);
    const name = typeof group.name === 'string' ? stripSeparators(group.name).slice(0, MAX_NAME_LENGTH) : '';
    let source;
    if (group.kind === 'cards') {
        const cards = (group.cards ?? []).map(stripSeparators).filter(Boolean).slice(0, MAX_SHARED_CARDS);
        if (cards.length === 0) return null;
        source = `c:${cards.join('|')}`;
    } else if (group.kind === 'manual') {
        const count = clampInt(group.count, 0, 999, 0);
        if (count <= 0) return null;
        source = `n:${count}`;
    } else {
        if (!getPreset(group.kind, group.key)) return null;
        source = `${group.kind[0]}:${group.key}`;
    }
    const out = `${need}~${name}~${source}`;
    return out.length <= MAX_PARAM_LENGTH ? out : null;
}

/**
 * Decode and validate one shared group. Never trusts the link: need, name,
 * preset keys, counts and every card name are checked and capped. Card names
 * are matched against the deck later, by the caller.
 * @returns {Object|null} a group spec
 */
export function decodeGroup(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PARAM_LENGTH) return null;
    const first = raw.indexOf('~');
    const second = first < 0 ? -1 : raw.indexOf('~', first + 1);
    if (first < 0 || second < 0) return null;
    const needRaw = raw.slice(0, first);
    if (!/^\d{1,2}$/.test(needRaw)) return null;
    const need = clampInt(needRaw, 1, MAX_NEED, 1);
    const nameRaw = stripSeparators(raw.slice(first + 1, second)).slice(0, MAX_NAME_LENGTH);
    const name = nameRaw || null;
    const source = raw.slice(second + 1);
    const colon = source.indexOf(':');
    if (colon !== 1) return null;
    const tag = source[0];
    const body = source.slice(2);
    if (tag === 'c') {
        const cards = [...new Set(body.split('|').map(s => s.trim()).filter(s => s && s.length <= MAX_CARD_NAME))].slice(0, MAX_SHARED_CARDS);
        if (cards.length === 0) return null;
        return { kind: 'cards', key: null, cards, count: 0, need, name };
    }
    if (tag === 'n') {
        if (!/^\d{1,3}$/.test(body)) return null;
        const count = clampInt(body, 0, 999, 0);
        return count > 0 ? { kind: 'manual', key: null, cards: [], count, need, name } : null;
    }
    const kind = { t: 'type', r: 'role', m: 'mv' }[tag];
    if (!kind || !getPreset(kind, body)) return null;
    return { kind, key: body, cards: [], count: 0, need, name };
}
