/**
 * Castability — exact on-curve colour odds for every card in a deck.
 *
 * The question for each nonland card: by the turn matching its mana value, do
 * you have at least that many lands, and can those lands pay every coloured
 * symbol at once? Mono-colour cards reduce to a two-group hypergeometric
 * (deckStats.colorCastProbability). Multicolour cards do not: a {G}{U} card
 * needs a green AND a blue source, and one Breeding Pool cannot be both. So
 * lands are partitioned by the set of colours they make and the draw is
 * enumerated over those groups exactly (multivariate hypergeometric).
 *
 * "Can these lands pay these pips?" is a bipartite matching question (each land
 * pays one pip of a colour it makes). Rather than enumerate every land vector,
 * the enumeration carries a compact state — the family of pip sub-multisets the
 * lands drawn so far can cover — which is exactly what decides every future
 * outcome. Adding lands only grows that family, and it saturates after a few
 * lands, so the state space stays tiny even for five-colour decks.
 *
 * Everything here is pure and deterministic.
 */

import { choose } from './hypergeometric.js';
import { COLORS, parseManaCost, isLand, landColors, deckColorIdentity } from './mana.js';
import { colorCastProbability, sourcesNeeded } from './deckStats.js';
import { FORMATS, cardsSeenByTurn } from './format.js';

/** One bit per colour, WUBRG order. */
export const COLOR_BIT = Object.freeze({ W: 1, U: 2, B: 4, R: 8, G: 16 });

/** @param {string[]} colors @returns {number} */
export function colorsToMask(colors = []) {
    let mask = 0;
    for (const c of colors) mask |= COLOR_BIT[c] ?? 0;
    return mask;
}

/** @param {number} mask @returns {string[]} WUBRG-ordered */
export function maskToColors(mask) {
    return COLORS.filter(c => (mask & COLOR_BIT[c]) !== 0);
}

/**
 * Colours in the order cards print them. Pairs follow the colour wheel the
 * short way round (Simic is green-blue, {G}{U}; Azorius white-blue); anything
 * else stays in WUBRG order.
 * @param {string[]} colors
 */
export function orderColors(colors = []) {
    const list = COLORS.filter(c => colors.includes(c));
    if (list.length !== 2) return list;
    const [a, b] = list;
    const forward = (COLORS.indexOf(b) - COLORS.indexOf(a) + 5) % 5;
    return forward <= 2 ? [a, b] : [b, a];
}

/** Number of colours in a mask. */
export function maskSize(mask) {
    let n = 0;
    for (let m = mask; m; m &= m - 1) n++;
    return n;
}

// ── Card requirements ────────────────────────────────────────────────────────

/**
 * The coloured demands a card makes on curve.
 *
 * - Strict pips ({U}) need a source of that colour each.
 * - Hybrid ({U/B}) needs one source of either colour.
 * - Phyrexian ({G/P}) can be paid with 2 life, so it is never required.
 * - Twobrid ({2/W}) can be paid with two generic mana, which its mana value
 *   already budgets for, so on curve it is never required either.
 *
 * The turn checked is the mana value, except that each X counts as 1: X is 0
 * in the mana value, but nobody casts Wan Shi Tong for X = 0 on turn two, and
 * checking it there would make every X spell the deck's "hardest" card.
 *
 * @param {{mana_cost?:string, cmc?:number}} card
 * @returns {{mv:number, x:number, turn:number, pips:Record<string,number>, hybrid:string[][], phyrexian:number, twobrid:number,
 *            pipTypes:Array<{mask:number, count:number}>, coloredPips:number, mask:number, colors:string[]}}
 */
export function cardRequirement(card) {
    const cost = parseManaCost(card?.mana_cost);
    const mv = Math.max(0, Math.floor(Number(card?.cmc) || 0));
    const x = cost.x;
    const byMask = new Map();
    for (const c of COLORS) {
        if (cost.pips[c] > 0) byMask.set(COLOR_BIT[c], cost.pips[c]);
    }
    const hybrid = cost.hybrid.filter(h => h.length >= 2);
    for (const h of hybrid) {
        const m = colorsToMask(h);
        byMask.set(m, (byMask.get(m) ?? 0) + 1);
    }
    const pipTypes = [...byMask].map(([mask, count]) => ({ mask, count }));
    const mask = pipTypes.reduce((m, t) => m | t.mask, 0);
    return {
        mv,
        x,
        turn: Math.max(1, mv + x),
        pips: { ...cost.pips },
        hybrid,
        phyrexian: cost.phyrexian.length,
        twobrid: cost.hybrid.length - hybrid.length,
        pipTypes,
        coloredPips: pipTypes.reduce((s, t) => s + t.count, 0),
        mask,
        colors: maskToColors(mask)
    };
}

// ── The exact joint probability ──────────────────────────────────────────────

/**
 * Exact chance of being able to cast a card on a given turn from lands alone.
 *
 * @param {Object} p
 * @param {number} p.deckSize - library size
 * @param {Array<{mask:number, count:number}>} p.landGroups - lands by the colours they make (mask 0 = none)
 * @param {Array<{mask:number, count:number}>} p.pipTypes - coloured demands; each pip needs one land whose mask overlaps it
 * @param {number} p.landsNeeded - lands required in total (the mana value on curve)
 * @param {number} p.seen - cards seen by that turn
 * @returns {{joint:number, conditional:number, landsOk:number}}
 *   joint: enough lands AND the right colours; landsOk: enough lands;
 *   conditional: joint / landsOk — "if you hit your land drops, are they the right colours?"
 */
export function castProbability({ deckSize, landGroups = [], pipTypes = [], landsNeeded, seen }) {
    const groups = landGroups
        .map(g => ({ mask: Number(g.mask) & 31, count: Math.max(0, Math.floor(Number(g.count) || 0)) }))
        .filter(g => g.count > 0);
    const L = groups.reduce((s, g) => s + g.count, 0);
    const N = Math.max(L, Math.floor(Number(deckSize) || 0));
    const NL = N - L;
    const n = Math.min(N, Math.max(0, Math.floor(Number(seen) || 0)));
    const need = Math.max(0, Math.floor(Number(landsNeeded) || 0));
    const total = choose(N, n);
    if (total === 0) return { joint: 0, conditional: 0, landsOk: 0 };

    let landsOk = 0;
    for (let l = need; l <= Math.min(L, n); l++) landsOk += choose(L, l) * choose(NL, n - l);
    landsOk /= total;

    // Merge identical demands; drop empty ones.
    const merged = new Map();
    for (const t of pipTypes) {
        const mask = Number(t.mask) & 31;
        const count = Math.max(0, Math.floor(Number(t.count) || 0));
        if (mask && count) merged.set(mask, (merged.get(mask) ?? 0) + count);
    }
    const types = [...merged].map(([mask, count]) => ({ mask, count }));
    if (types.length === 0) return { joint: landsOk, conditional: landsOk > 0 ? 1 : 0, landsOk };

    // Lands that make none of the demanded colours only matter as land count.
    const reqMask = types.reduce((m, t) => m | t.mask, 0);
    const helpfulByMask = new Map();
    let L0 = 0;
    for (const g of groups) {
        const m = g.mask & reqMask;
        if (m) helpfulByMask.set(m, (helpfulByMask.get(m) ?? 0) + g.count);
        else L0 += g.count;
    }

    const lattice = buildLattice(types);
    const helpful = orderGroups([...helpfulByMask].map(([mask, count]) => ({ mask, count })), reqMask)
        .map(g => ({ ...g, moves: types.map((t, j) => ((t.mask & g.mask) ? j : -1)).filter(j => j >= 0) }));

    // A pip type is "settled" once no group still to come can pay it: from then
    // on only states that already cover it fully can succeed, so the rest are
    // dropped and equivalent states merge. Processing the groups colour by
    // colour settles colours early and keeps the state count small.
    const settledAfter = helpful.map((_, gi) => {
        const rest = helpful.slice(gi + 1).reduce((m, g) => m | g.mask, 0);
        return types.map((t, j) => ((t.mask & rest) ? -1 : j)).filter(j => j >= 0);
    });
    const settledBefore = types.map((t, j) => ((t.mask & helpful.reduce((m, g) => m | g.mask, 0)) ? -1 : j)).filter(j => j >= 0);

    // dist: state id → weights by number of helpful lands drawn so far.
    let dist = new Map();
    const startState = lattice.settle(lattice.start, settledBefore);
    if (!lattice.isEmpty(startState)) dist.set(startState, newRow(n, 0));
    helpful.forEach((g, gi) => {
        const maxX = Math.min(g.count, n);
        const coef = Array.from({ length: maxX + 1 }, (_, x) => choose(g.count, x));
        const settle = settledAfter[gi].length > (gi > 0 ? settledAfter[gi - 1].length : settledBefore.length)
            ? settledAfter[gi] : null;
        const next = new Map();
        for (const [id, row] of dist) {
            let state = id;
            for (let x = 0; x <= maxX; x++) {
                // Each extra land of this group can pay one more pip; the state
                // stops changing once the group has nothing left to add.
                if (x > 0) state = lattice.step(state, gi, g.moves);
                const landed = settle ? lattice.settle(state, settle) : state;
                if (lattice.isEmpty(landed)) continue;
                let target = next.get(landed);
                if (!target) next.set(landed, (target = newRow(n)));
                const c = coef[x];
                for (let t = 0; t + x <= n; t++) {
                    if (row[t]) target[t + x] += row[t] * c;
                }
            }
        }
        dist = next;
    });

    // Fill the rest of the draw with off-colour lands and nonlands.
    const tailOk = newRow(n);
    for (let t = 0; t <= n; t++) {
        for (let o = 0; o <= Math.min(L0, n - t); o++) {
            if (t + o >= need) tailOk[t] += choose(L0, o) * choose(NL, n - t - o);
        }
    }

    let joint = 0;
    for (const [id, row] of dist) {
        if (!lattice.covers(id)) continue;
        for (let t = 0; t <= n; t++) if (row[t]) joint += row[t] * tailOk[t];
    }
    joint /= total;
    // Guard against rounding pushing a ratio a hair past 1.
    joint = Math.min(joint, landsOk);
    return { joint, conditional: landsOk > 0 ? joint / landsOk : 0, landsOk };
}

function newRow(n, first) {
    const row = new Float64Array(n + 1);
    if (first !== undefined) row[first] = 1;
    return row;
}

/**
 * Elimination order: every group that makes the first demanded colour, then
 * every remaining group that makes the second, and so on — so each colour is
 * settled as early as possible. Within a block, wider groups go first.
 */
function orderGroups(groups, reqMask) {
    const order = COLORS.filter(c => reqMask & COLOR_BIT[c]);
    const block = g => order.findIndex(c => g.mask & COLOR_BIT[c]);
    return groups.slice().sort((a, b) => block(a) - block(b) || maskSize(b.mask) - maskSize(a.mask) || a.mask - b.mask);
}

/**
 * The lattice of pip sub-multisets and the interned "coverable family" states.
 * A state is the set of sub-multisets of the demand that the lands drawn so far
 * can pay (a down-set); adding a land of a group adds one pip it can pay to
 * every member.
 */
function buildLattice(types) {
    const radix = types.map(t => t.count + 1);
    const strides = [];
    let size = 1;
    for (const r of radix) { strides.push(size); size *= r; }
    const full = types.reduce((s, t, j) => s + t.count * strides[j], 0);
    // canGrow[a * T + j]: sub-multiset `a` still has room for another pip of type j.
    const T = types.length;
    const canGrow = new Uint8Array(size * T);
    for (let a = 0; a < size; a++) {
        for (let j = 0; j < T; j++) canGrow[a * T + j] = Math.floor(a / strides[j]) % radix[j] < types[j].count ? 1 : 0;
    }

    const states = [];
    const empty = [];
    const ids = new Map();
    const intern = bits => {
        // Pack the membership bits 30 at a time for a short map key.
        let key = '';
        for (let i = 0; i < size; i += 30) {
            let word = 0;
            for (let b = 0; b < 30 && i + b < size; b++) if (bits[i + b]) word |= 1 << b;
            key += `${word},`;
        }
        let id = ids.get(key);
        if (id === undefined) {
            id = states.length;
            states.push(bits);
            empty.push(!bits.some(Boolean));
            ids.set(key, id);
        }
        return id;
    };
    const startBits = new Uint8Array(size);
    startBits[0] = 1;
    const start = intern(startBits);

    const memo = new Map();
    const step = (id, gi, moves) => {
        const key = id * 64 + gi;
        const hit = memo.get(key);
        if (hit !== undefined) return hit;
        const bits = states[id];
        const out = bits.slice();
        for (let a = 0; a < size; a++) {
            if (!bits[a]) continue;
            for (const j of moves) if (canGrow[a * T + j]) out[a + strides[j]] = 1;
        }
        const next = intern(out);
        memo.set(key, next);
        return next;
    };

    // Keep only the members that already hold every pip of the settled types.
    const settleMemo = new Map();
    const settle = (id, settled) => {
        if (settled.length === 0) return id;
        const key = `${id}|${settled.join(',')}`;
        const hit = settleMemo.get(key);
        if (hit !== undefined) return hit;
        const bits = states[id];
        const out = new Uint8Array(size);
        for (let a = 0; a < size; a++) {
            if (!bits[a]) continue;
            let keep = 1;
            for (const j of settled) if (canGrow[a * T + j]) { keep = 0; break; }
            out[a] = keep;
        }
        const next = intern(out);
        settleMemo.set(key, next);
        return next;
    };

    const isEmpty = id => empty[id];

    return { start, step, settle, isEmpty, covers: id => states[id][full] === 1 };
}

// ── Deck-level analysis ──────────────────────────────────────────────────────

const COLOR_WORD = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

/**
 * Describe each land: the colours it makes for this deck (clamped to the
 * colour identity), and whether it makes any colour at all.
 *
 * Lands that fetch "a basic land card" can only find the basics the deck
 * actually runs, so they are clamped to those colours too: Evolving Wilds in a
 * deck with no Forests is not a green source, even if a hybrid card puts green
 * in the colour identity.
 *
 * @returns {Array<{name:string, count:number, colors:string[], mask:number, kind:'any'|'colors'|'colorless'|'offcolor'}>}
 */
export function describeLands(cards, identity) {
    const lands = cards.filter(isLand);
    const basicColors = new Set();
    for (const land of lands) {
        if (/\bbasic\b/i.test(String(land.type_line ?? '').split('//')[0])) landColors(land, identity).forEach(c => basicColors.add(c));
    }
    return lands.map(card => {
        const fetcher = fetchesAnyBasic(card);
        const colors = landColors(card, identity).filter(c => !fetcher || basicColors.has(c));
        const unclamped = landColors(card, COLORS);
        const kind = colors.length === 0
            ? (unclamped.length === 0 || fetcher ? 'colorless' : 'offcolor')
            : (unclamped.length === COLORS.length && identity.length > 1 && colors.length === identity.length ? 'any' : 'colors');
        return { name: card.name, count: Number(card.count), colors, mask: colorsToMask(colors), kind };
    });
}

/** "Search your library for a basic land card" — Evolving Wilds, Fabled Passage. */
const BASIC_FETCH = /search your library for (?:a|up to (?:one|two|three)) basic land cards?/i;

function fetchesAnyBasic(card) {
    if (Array.isArray(card.produced_mana) && card.produced_mana.length > 0) return false;
    return BASIC_FETCH.test(String(card.oracle_text ?? ''));
}

/**
 * Lands grouped for display: "Any colour", each colour combination, then
 * colourless. Multi-colour groups come first (they are the fixing).
 */
export function groupLands(landInfo) {
    const groups = new Map();
    for (const land of landInfo) {
        const key = land.kind === 'colors' ? `m${land.mask}` : land.kind;
        let g = groups.get(key);
        if (!g) {
            g = {
                key,
                kind: land.kind,
                colors: land.kind === 'colors' || land.kind === 'any' ? orderColors(land.colors) : [],
                label: groupLabel(land),
                count: 0,
                cards: []
            };
            groups.set(key, g);
        }
        g.count += land.count;
        g.cards.push({ name: land.name, count: land.count });
    }
    const rank = g => (g.kind === 'any' ? 0 : g.kind === 'colors' ? (g.colors.length > 1 ? 1 : 2) : g.kind === 'offcolor' ? 3 : 4);
    const order = g => g.colors.reduce((s, c) => s * 8 + COLORS.indexOf(c) + 1, 0);
    return [...groups.values()]
        .map(g => ({ ...g, cards: g.cards.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) }))
        .sort((a, b) => rank(a) - rank(b) || b.colors.length - a.colors.length || order(a) - order(b));
}

function groupLabel(land) {
    if (land.kind === 'any') return 'Any colour';
    if (land.kind === 'colorless') return 'Colourless';
    if (land.kind === 'offcolor') return 'Off-colour';
    return joinWords(orderColors(land.colors).map(c => COLOR_WORD[c]));
}

/** "Green", "Green & Blue", "White, Blue & Black". */
export function joinWords(words) {
    if (words.length <= 1) return words.join('');
    return `${words.slice(0, -1).join(', ')} & ${words[words.length - 1]}`;
}

/**
 * Karsten-style table: the fewest sources of one colour that give `target`
 * castability (conditioned on land drops) for 1, 2 and 3 pips at turns 1–6,
 * computed exactly for this deck size and land count.
 * @returns {{turns:number[], rows:Array<{pips:number, cells:Array<{turn:number, needed:number|null, possible:boolean}>}>}}
 */
export function sourcesTable({ deckSize, lands, format = FORMATS.commander, onPlay = true, maxTurn = 6, maxPips = 3, target = 0.9 }) {
    const turns = Array.from({ length: maxTurn }, (_, i) => i + 1);
    const rows = Array.from({ length: maxPips }, (_, i) => {
        const pips = i + 1;
        return {
            pips,
            cells: turns.map(turn => {
                if (pips > turn) return { turn, needed: null, possible: false };
                const seen = cardsSeenByTurn(turn, { format, onPlay });
                return { turn, needed: sourcesNeeded({ deckSize, lands, pips, landsNeeded: turn, seen, target }), possible: true };
            })
        };
    });
    return { turns, rows };
}

/**
 * Full castability analysis of a deck.
 *
 * @param {Record<string, Object>} cardsByName
 * @param {{deckSize?:number, format?:object, onPlay?:boolean, target?:number, byTurn?:number}} [opts]
 *   byTurn: also give every card and colour its chance on turns 1…byTurn (the
 *   "when does it become reliable" strips); 0 skips the extra work.
 */
export function analyzeCastability(cardsByName = {}, { deckSize, format = FORMATS.commander, onPlay = true, target = 0.9, byTurn = 0 } = {}) {
    const cards = Object.values(cardsByName).filter(c => c?.name && Number(c.count) > 0);
    const identity = deckColorIdentity(cardsByName);
    const landInfo = describeLands(cards, identity);
    const lands = landInfo.reduce((s, l) => s + l.count, 0);
    const counted = cards.reduce((s, c) => s + Number(c.count), 0);
    const N = Math.max(lands, Math.floor(Number(deckSize) || 0) || counted);

    const maskCounts = new Map();
    for (const l of landInfo) maskCounts.set(l.mask, (maskCounts.get(l.mask) ?? 0) + l.count);
    const landGroups = [...maskCounts].map(([mask, count]) => ({ mask, count }));
    const sources = Object.fromEntries(COLORS.map(c => [c, landInfo.reduce((s, l) => s + (l.colors.includes(c) ? l.count : 0), 0)]));

    // Many cards share a requirement ({1}{G}, {2}{G}, …): compute each once.
    const probMemo = new Map();
    const needMemo = new Map();
    const seenFor = turn => cardsSeenByTurn(turn, { format, onPlay });
    const probFor = req => {
        const key = `${req.turn}|${req.pipTypes.map(t => `${t.mask}x${t.count}`).sort().join(',')}`;
        let p = probMemo.get(key);
        if (!p) {
            p = castProbability({ deckSize: N, landGroups, pipTypes: req.pipTypes, landsNeeded: req.turn, seen: seenFor(req.turn) });
            probMemo.set(key, p);
        }
        return p;
    };
    // By turn t (with t land drops made), can the lands pay this card? Before
    // its own turn there are not enough lands, so there is no chance to give.
    const stripTurns = Math.max(0, Math.min(12, Math.floor(Number(byTurn) || 0)));
    const turnMemo = new Map();
    const stripFor = req => Array.from({ length: stripTurns }, (_, i) => {
        const t = i + 1;
        if (t < req.turn) return null;
        if (t === req.turn) return probFor(req).conditional;
        // The chance on turn t depends only on t and the pips, not on the card's own turn.
        const key = `${t}|${req.pipTypes.map(x => `${x.mask}x${x.count}`).sort().join(',')}`;
        if (!turnMemo.has(key)) {
            turnMemo.set(key, castProbability({ deckSize: N, landGroups, pipTypes: req.pipTypes, landsNeeded: t, seen: seenFor(t) }).conditional);
        }
        return turnMemo.get(key);
    });
    const neededFor = (pips, turn) => {
        const key = `${pips}|${turn}`;
        if (!needMemo.has(key)) {
            needMemo.set(key, sourcesNeeded({ deckSize: N, lands, pips, landsNeeded: turn, seen: seenFor(turn), target }));
        }
        return needMemo.get(key);
    };

    const rows = [];
    const skipped = [];
    let phyrexianOnly = 0;
    for (const card of cards) {
        if (isLand(card)) continue;
        if (!card.mana_cost) {
            // Double-faced cards from some importers arrive without a cost.
            if ((card.colors ?? card.color_identity ?? []).length > 0) skipped.push({ name: card.name, count: Number(card.count) });
            continue;
        }
        const req = cardRequirement(card);
        if (req.coloredPips === 0) {
            if (req.phyrexian > 0) phyrexianOnly++;
            continue;
        }
        const p = probFor(req);
        rows.push({
            name: card.name,
            count: Number(card.count),
            cost: card.mana_cost,
            mv: req.mv,
            x: req.x,
            turn: req.turn,
            colors: req.colors,
            multicolor: req.colors.length > 1,
            pips: req.pips,
            hybrid: req.hybrid.length,
            phyrexian: req.phyrexian,
            twobrid: req.twobrid,
            chance: p.conditional,
            overall: p.joint,
            landsOk: p.landsOk,
            ...(stripTurns ? { byTurn: stripFor(req) } : {})
        });
    }
    // Worst first; ties broken by the harder overall odds, then name.
    rows.sort((a, b) => a.chance - b.chance || a.overall - b.overall || a.name.localeCompare(b.name));

    const meets = p => p >= target - 1e-9;
    const colors = COLORS.filter(c => identity.includes(c) || rows.some(r => r.pips[c] > 0)).map(c => {
        const needing = rows.filter(r => r.pips[c] > 0 || r.colors.includes(c));
        const strict = rows.filter(r => r.pips[c] > 0);
        let hardest = null;
        for (const r of strict) {
            const needed = neededFor(r.pips[c], r.turn);
            const rank = needed ?? Infinity;
            const hRank = hardest ? (hardest.needed ?? Infinity) : -1;
            if (!hardest || rank > hRank || (rank === hRank && r.chance < hardest.chance)) {
                hardest = { name: r.name, pips: r.pips[c], turn: r.turn, mv: r.mv, chance: r.chance, needed };
            }
        }
        const peers = hardest ? strict.filter(r => r.pips[c] === hardest.pips && r.turn === hardest.turn).length : 0;
        // One strip per pip count this colour's cards ask for (up to three):
        // with t land drops made by turn t, can they pay that many symbols?
        const maxPips = Math.min(3, strict.reduce((m, r) => Math.max(m, r.pips[c]), 0));
        const strips = stripTurns ? Array.from({ length: maxPips }, (_, i) => ({
            pips: i + 1,
            cells: Array.from({ length: stripTurns }, (__, j) => {
                const t = j + 1;
                if (t < i + 1) return null;
                return colorCastProbability({ deckSize: N, lands, sources: sources[c], pips: i + 1, landsNeeded: t, seen: seenFor(t) }).conditional;
            })
        })) : undefined;
        return {
            color: c,
            sources: sources[c],
            pips: strict.reduce((s, r) => s + r.pips[c] * r.count, 0),
            cards: needing.length,
            under: needing.filter(r => !meets(r.chance)).length,
            worst: needing[0] ?? null,
            hardest,
            peers,
            want: hardest ? hardest.needed : null,
            ...(strips ? { byTurn: strips } : {}),
            gap: hardest ? (hardest.needed == null ? Infinity : hardest.needed - sources[c]) : -Infinity
        };
    });

    const short = colors.filter(c => c.gap > 0)
        .sort((a, b) => b.gap - a.gap || (a.worst?.chance ?? 1) - (b.worst?.chance ?? 1));
    const under = rows.filter(r => !meets(r.chance)).length;
    const average = rows.length ? rows.reduce((s, r) => s + r.chance, 0) / rows.length : null;

    return {
        deckSize: N,
        lands,
        identity,
        sources,
        target,
        landInfo,
        landGroups: groupLands(landInfo),
        colorlessLands: landInfo.filter(l => l.colors.length === 0).reduce((s, l) => s + l.count, 0),
        cards: rows,
        skipped,
        phyrexianOnly,
        colors,
        bottleneck: short[0] ?? null,
        under,
        total: rows.length,
        worst: rows[0] ?? null,
        average,
        table: sourcesTable({ deckSize: N, lands, format, onPlay, target })
    };
}
