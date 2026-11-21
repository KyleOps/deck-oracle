/**
 * Opening-hand lab — the pure logic behind the Opening Hands page.
 *
 * Everything here is DOM-free and deterministic given an `rng`, so the keep
 * rule, the London-mulligan bottoming choice and the mulligan simulation are
 * unit-tested in tests/utils/handLab.node.test.js.
 *
 * Cards are flattened into "lab cards": one record per physical copy, with the
 * few facts the lab needs precomputed (is it a land, which colours it makes as
 * a 5-bit mask, its mana value, its coloured pips as masks, ramp/draw tags).
 */

import { drawType } from './hypergeometric.js';
import { COLORS, landColors, parseManaCost, deckColorIdentity } from './mana.js';
import { asLibrary, cardTypes, isLand, isPermanent } from './library.js';
import { hashString, mulberry32, partialShuffle, shuffled } from './random.js';
import { inflect as plural } from './text.js';
import { tagCard } from './cardTags.js';

// Seeded randomness lives in random.js; re-exported for the pages and tests
// that import it from here.
export { mulberry32, shuffled };

// ── Colour masks ─────────────────────────────────────────────────────────────

export const COLOR_BIT = Object.freeze({ W: 1, U: 2, B: 4, R: 8, G: 16 });

export function maskOf(colors = []) {
    let m = 0;
    for (const c of colors) m |= COLOR_BIT[c] ?? 0;
    return m;
}

export function colorsOfMask(mask) {
    return COLORS.filter(c => mask & COLOR_BIT[c]);
}

function popcount(m) {
    let n = 0;
    while (m) { n += m & 1; m >>= 1; }
    return n;
}

// ── Rule ─────────────────────────────────────────────────────────────────────

/** The turn an early play must be castable by: 0 = not required. */
export const PLAY_BY_OPTIONS = Object.freeze([0, 2, 3]);

/**
 * Two to four lands — the same default the glossary's "keepable" and the Deck
 * Overview use. The early-play requirement starts off: big-spell Commander
 * decks fail it most of the time, and it's a style choice more than a rule.
 */
export const DEFAULT_RULE = Object.freeze({ minLands: 2, maxLands: 4, playBy: 0 });

/** Smallest hand the simulated player will go to: at four cards they keep anything. */
export const MIN_HAND = 4;

export const OPENING_HAND = 7;

function clampInt(value, lo, hi, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
}

/**
 * Validate a keep rule. Max lands is raised to min lands when they cross.
 * @param {{minLands?:number, maxLands?:number, playBy?:number}} [rule]
 * @returns {{minLands:number, maxLands:number, playBy:number}}
 */
export function normalizeRule(rule = {}) {
    const minLands = clampInt(rule?.minLands, 0, OPENING_HAND, DEFAULT_RULE.minLands);
    const maxLands = Math.max(minLands, clampInt(rule?.maxLands, 0, OPENING_HAND, DEFAULT_RULE.maxLands));
    const p = Number(rule?.playBy);
    const playBy = PLAY_BY_OPTIONS.includes(p) ? p : DEFAULT_RULE.playBy;
    return { minLands, maxLands, playBy };
}

// ── Library ──────────────────────────────────────────────────────────────────

const TYPE_ORDER = ['lands', 'creatures', 'planeswalkers', 'battles', 'artifacts', 'enchantments', 'instants', 'sorceries'];
const TYPE_WORD = {
    lands: 'Land', creatures: 'Creature', planeswalkers: 'Planeswalker', battles: 'Battle',
    artifacts: 'Artifact', enchantments: 'Enchantment', instants: 'Instant', sorceries: 'Sorcery'
};

function primaryType(card) {
    if (isLand(card)) return 'lands';
    const types = cardTypes(card?.type_line);
    for (const t of ['creature', 'planeswalker', 'battle', 'artifact', 'enchantment', 'instant', 'sorcery']) {
        if (types.includes(t)) return t === 'sorcery' ? 'sorceries' : `${t}s`;
    }
    return card?.category ?? card?.allCategories?.[0] ?? 'creatures';
}

/** Coloured pips as masks, most constrained first (single colours before hybrids). */
function pipMasks(cost) {
    const { pips, hybrid } = parseManaCost(cost);
    const out = [];
    for (const c of COLORS) for (let i = 0; i < pips[c]; i++) out.push(COLOR_BIT[c]);
    for (const h of hybrid) out.push(maskOf(h));
    return out.sort((a, b) => popcount(a) - popcount(b));
}

/**
 * One lab card from a Scryfall-shaped card record.
 * @param {Object} card
 * @param {number} uid - unique id of this physical copy
 * @param {string[]} identity - deck colour identity (clamps "any colour" lands)
 */
export function toLabCard(card, uid, identity) {
    const land = isLand(card);
    const type = primaryType(card);
    const tags = land ? [] : tagCard(card);
    const colors = land ? landColors(card, identity) : [];
    const mv = land ? 0 : Math.max(0, Math.floor(Number(card.cmc) || 0));
    return {
        uid,
        name: card.name,
        land,
        type,
        typeLine: card.type_line ?? TYPE_WORD[type] ?? '',
        cost: land ? '' : (card.mana_cost ?? ''),
        mv,
        // Mana to cast it as a real play: an X spell at X = 0 does nothing, so count X as 1.
        playMv: land ? 0 : mv + parseManaCost(card.mana_cost).x,
        pips: land ? [] : pipMasks(card.mana_cost),
        mask: maskOf(colors),
        permanent: land || isPermanent(String(card.type_line ?? '')),
        ramp: tags.includes('ramp'),
        draw: tags.includes('draw'),
        placeholder: false
    };
}

/**
 * The deck's colour identity: the library's cards plus every commander's.
 * @param {ReadonlyArray<Object>} libraryCards
 * @param {Array<Object|null>} [commanderCards]
 * @returns {string[]} WUBRG-ordered
 */
export function identityOf(libraryCards, commanderCards = []) {
    return deckColorIdentity(libraryCards, commanderCards);
}

/**
 * Expand a decklist into one lab card per copy.
 *
 * Commanders start in the command zone, never the library (see library.js),
 * whether or not the list holds them. They still set the deck's colour
 * identity, so pass their records as `commanderCards`.
 *
 * @param {Object} deck - a DeckConfig snapshot, a Library, or a cardsByName map
 * @param {{format?:Object|string, commanders?:string[], commanderCards?:Array<Object|null>}} [opts]
 * @returns {{cards:Object[], identity:string[], hasCosts:boolean, placeholder:boolean, commanders:ReadonlyArray<string>}}
 */
export function buildLibrary(deck = {}, { format, commanders, commanderCards = [] } = {}) {
    const library = asLibrary(deck, { format, commanders });
    const identity = identityOf(library.cards, commanderCards);
    const cards = [];
    let uid = 0;
    for (const card of library.cards) {
        // Read the card once; copies differ only by uid.
        const proto = toLabCard(card, 0, identity);
        for (let i = 0; i < card.count; i++) cards.push({ ...proto, uid: uid++ });
    }
    return { cards, identity, hasCosts: cards.length > 0, placeholder: false, commanders: library.commanders };
}

/**
 * A library of type-labelled placeholder cards for decks entered as bare
 * counts. Costs and colours are unknown, so only land counts can be judged.
 * @param {Record<string, number>} counts - DeckConfig type counts
 */
export function buildPlaceholderLibrary(counts = {}) {
    const cards = [];
    let uid = 0;
    for (const type of TYPE_ORDER) {
        const n = Math.max(0, Math.floor(Number(counts?.[type]) || 0));
        for (let i = 0; i < n; i++) {
            cards.push({
                uid: uid++,
                name: TYPE_WORD[type],
                land: type === 'lands',
                type,
                typeLine: TYPE_WORD[type],
                cost: '',
                mv: null,
                playMv: null,
                pips: [],
                mask: 0,
                permanent: !['instants', 'sorceries'].includes(type),
                ramp: false,
                draw: false,
                placeholder: true
            });
        }
    }
    return { cards, identity: [], hasCosts: false, placeholder: true, commanders: [] };
}

/** Short stable signature of a library (cache key). FNV-1a over names. */
export function libraryKey(cards = []) {
    return `${cards.length}:${hashString(cards.map(c => c.name).join('|')).toString(36)}`;
}

// ── Mana ─────────────────────────────────────────────────────────────────────

/**
 * Match each coloured pip to a distinct land that makes that colour.
 * @param {number[]} pips - colour masks, one per pip
 * @param {number[]} landMasks
 * @returns {number[]|null} land index per pip (in the given pip order), or null
 */
export function assignPips(pips, landMasks) {
    if (pips.length === 0) return [];
    if (pips.length > landMasks.length) return null;
    // Most constrained pip first keeps the search tiny; least flexible land
    // first leaves duals free for the pips that need them.
    const order = pips.map((m, i) => i).sort((a, b) => popcount(pips[a]) - popcount(pips[b]));
    const lands = landMasks.slice(0, 30).map((m, i) => i).sort((a, b) => popcount(landMasks[a]) - popcount(landMasks[b]));
    const result = new Array(pips.length).fill(-1);
    let used = 0;
    const go = k => {
        if (k === order.length) return true;
        const pip = pips[order[k]];
        for (const j of lands) {
            if ((used & (1 << j)) || !(landMasks[j] & pip)) continue;
            used |= 1 << j;
            result[order[k]] = j;
            if (go(k + 1)) return true;
            used &= ~(1 << j);
        }
        return false;
    };
    return go(0) ? result : null;
}

/**
 * Could this card be cast by `turn` using only the lands in `hand`, playing one
 * land a turn? It needs mana value ≤ lands you can have out by then, and its
 * coloured pips must be payable by distinct lands from the hand.
 * @param {Object} card - lab card
 * @param {number[]} landMasks - colour masks of the lands available
 * @param {number} mana - lands that can be in play by then
 */
export function castableWith(card, landMasks, mana, landCount = landMasks.length) {
    if (card.land || card.mv == null) return false;
    if ((card.playMv ?? card.mv) > mana || card.pips.length > landCount) return false;
    // The matcher tracks used lands in a 31-bit mask; no hand gets near that.
    return payFrom(card.pips, 0, landMasks, Math.min(landCount, 30), 0);
}

// A fixed scratch buffer keeps meetsRule allocation-free for opening hands.
const scratchMasks = new Int32Array(32);

/** Allocation-free pip matching (the simulation calls this ~100k times). */
function payFrom(pips, k, masks, count, used) {
    if (k === pips.length) return true;
    const pip = pips[k];
    for (let j = 0; j < count; j++) {
        const bit = 1 << j;
        if (!(used & bit) && (masks[j] & pip) && payFrom(pips, k + 1, masks, count, used | bit)) return true;
    }
    return false;
}

/**
 * Which untapped lands to tap for a spell: coloured pips first, then generic
 * from the least flexible lands so the colours stay open.
 * @param {Object} card - lab card
 * @param {Object[]} untapped - lab land cards
 * @returns {Object[]|null} lands to tap, or null if it can't be paid
 */
export function payFor(card, untapped) {
    if (!card || card.land || card.mv == null) return null;
    const cost = card.playMv ?? card.mv;
    if (cost > untapped.length) return null;
    const masks = untapped.map(l => l.mask);
    const assignment = assignPips(card.pips, masks);
    if (!assignment) return null;
    const chosen = new Set(assignment);
    const rest = untapped.map((l, i) => i).filter(i => !chosen.has(i))
        .sort((a, b) => popcount(masks[a]) - popcount(masks[b]));
    for (let k = 0; chosen.size < cost && k < rest.length; k++) chosen.add(rest[k]);
    return [...chosen].map(i => untapped[i]);
}

/**
 * The land to play this turn: the one that adds the most colours the spells
 * in hand still need, then the most colours overall.
 * @param {Object[]} hand
 * @param {Object[]} inPlay - lands already on the battlefield
 * @returns {Object|null}
 */
export function chooseLandToPlay(hand, inPlay = []) {
    const have = inPlay.reduce((m, l) => m | l.mask, 0);
    const need = hand.filter(c => !c.land).reduce((m, c) => c.pips.reduce((x, p) => x | p, m), 0);
    let best = null;
    let bestScore = -1;
    for (const c of hand) {
        if (!c.land) continue;
        const fresh = c.mask & ~have;
        const score = popcount(fresh & need) * 100 + popcount(fresh) * 10 + popcount(c.mask);
        if (score > bestScore) { best = c; bestScore = score; }
    }
    return best;
}

// ── Reading a hand ───────────────────────────────────────────────────────────

/**
 * Plain facts about a hand.
 * @param {Object[]} cards - lab cards
 * @param {{turns?:number[]}} [opts]
 */
export function analyzeHand(cards = [], { turns = [2, 3] } = {}) {
    const lands = cards.filter(c => c.land);
    const nonlands = cards.filter(c => !c.land);
    const landMasks = lands.map(l => l.mask);
    const colorsMask = landMasks.reduce((m, x) => m | x, 0);
    const hasCosts = cards.length > 0 && cards.every(c => !c.placeholder);
    const costed = nonlands.filter(c => c.mv != null);
    const castableBy = {};
    for (const t of turns) {
        const mana = Math.min(t, lands.length);
        castableBy[t] = hasCosts ? nonlands.filter(c => castableWith(c, landMasks, mana)) : [];
    }
    return {
        size: cards.length,
        lands,
        nonlands,
        landCount: lands.length,
        colorsMask,
        colors: colorsOfMask(colorsMask),
        colorlessOnly: lands.length > 0 && colorsMask === 0,
        averageMv: costed.length ? costed.reduce((s, c) => s + c.mv, 0) / costed.length : null,
        ramp: nonlands.filter(c => c.ramp),
        draw: nonlands.filter(c => c.draw),
        castableBy,
        hasCosts
    };
}

const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "two", "three" … for small counts, digits beyond ten. */
export function numberWord(n) {
    return SMALL[n] ?? String(n);
}

/**
 * Does a hand meet the keep rule? Fast path used by the simulation.
 * @param {Object[]} cards
 * @param {{minLands:number, maxLands:number, playBy:number}} rule
 * @param {boolean} hasCosts - false for placeholder decks (play rule can't apply)
 */
export function meetsRule(cards, rule, hasCosts = true) {
    const masks = cards.length <= scratchMasks.length ? scratchMasks : new Int32Array(cards.length);
    let lands = 0;
    for (let i = 0; i < cards.length; i++) if (cards[i].land) masks[lands++] = cards[i].mask;
    if (lands < rule.minLands || lands > rule.maxLands) return false;
    if (!rule.playBy || !hasCosts) return true;
    const mana = Math.min(rule.playBy, lands);
    for (let i = 0; i < cards.length; i++) if (castableWith(cards[i], masks, mana, lands)) return true;
    return false;
}

/**
 * Which cards to put on the bottom after a London mulligan.
 *
 * Aim for a land count in the middle of the keep range, scaled to the smaller
 * hand. Extra lands go first, least useful colours first; otherwise the most
 * expensive spells go, keeping ramp and spells the lands can actually cast.
 *
 * @param {Object[]} cards - the seven drawn
 * @param {number} count - how many go to the bottom
 * @param {{minLands:number, maxLands:number}} rule
 * @returns {{keep:Object[], bottom:Object[]}}
 */
export function chooseBottom(cards, count, rule = DEFAULT_RULE) {
    const n = Math.max(0, Math.min(cards.length, Math.floor(count) || 0));
    if (n === 0) return { keep: cards.slice(), bottom: [] };
    const size = cards.length - n;
    const lands = cards.filter(c => c.land);
    const spells = cards.filter(c => !c.land);
    const mid = (rule.minLands + rule.maxLands) / 2;
    const target = Math.min(size, Math.max(rule.minLands, Math.min(rule.maxLands, Math.round(mid * size / OPENING_HAND))));
    let landsOut = Math.max(0, Math.min(n, lands.length - target));
    let spellsOut = n - landsOut;
    if (spellsOut > spells.length) {
        spellsOut = spells.length;
        landsOut = n - spellsOut;
    }

    // Index-based and allocation-light: the simulation runs this for every
    // mulligan it takes.
    const len = cards.length;
    const out = new Uint8Array(len);
    // Lands: drop the one whose colours the other kept lands already cover.
    for (let k = 0; k < landsOut; k++) {
        let worst = -1;
        let worstScore = Infinity;
        for (let i = 0; i < len; i++) {
            if (out[i] || !cards[i].land) continue;
            let others = 0;
            for (let j = 0; j < len; j++) if (j !== i && !out[j] && cards[j].land) others |= cards[j].mask;
            const score = popcount(cards[i].mask & ~others) * 10 + popcount(cards[i].mask);
            if (score < worstScore) { worst = i; worstScore = score; }
        }
        out[worst] = 1;
    }
    // Spells: most expensive first; ramp is worth keeping, off-colour isn't.
    let keptLands = 0;
    for (let i = 0; i < len; i++) if (cards[i].land && !out[i]) bottomMasks[keptLands++] = cards[i].mask;
    const scores = new Float64Array(len);
    for (let i = 0; i < len; i++) {
        const c = cards[i];
        if (c.land) continue;
        const offColour = c.pips.length > 0 && (c.pips.length > keptLands || !payFrom(c.pips, 0, bottomMasks, Math.min(keptLands, 30), 0));
        scores[i] = (c.mv ?? 0) - (c.ramp ? 1.5 : 0) + (offColour ? 2 : 0);
    }
    for (let k = 0; k < spellsOut; k++) {
        let pick = -1;
        // Ties go to the later card, so a hand's order never changes the answer for equal cards.
        for (let i = 0; i < len; i++) {
            if (out[i] || cards[i].land) continue;
            if (pick < 0 || scores[i] >= scores[pick]) pick = i;
        }
        out[pick] = 1;
    }

    const keep = [];
    const bottom = [];
    for (let i = 0; i < len; i++) (out[i] ? bottom : keep).push(cards[i]);
    return { keep, bottom };
}

const bottomMasks = new Int32Array(32);

/**
 * The keep-or-mulligan verdict for a hand, in words.
 *
 * @param {Object[]} cards - the hand as drawn
 * @param {Object} rule
 * @param {{bottom?:number}} [opts] - cards that will go to the bottom (London)
 * @returns {{keep:boolean, headline:string, reasons:string[], analysis:Object, kept:Object[], bottomed:Object[], playTurn:number}}
 */
export function judgeHand(cards = [], rule = DEFAULT_RULE, { bottom = 0 } = {}) {
    const r = normalizeRule(rule);
    const { keep: kept, bottom: bottomed } = chooseBottom(cards, bottom, r);
    const playTurn = r.playBy || 3;
    const a = analyzeHand(kept, { turns: [2, 3] });
    const L = a.landCount;
    const plays = a.castableBy[playTurn] ?? [];
    const reasons = [];
    const landsOk = L >= r.minLands && L <= r.maxLands;
    const range = r.minLands === r.maxLands ? `${r.minLands}` : `${r.minLands}–${r.maxLands}`;
    if (!landsOk) {
        reasons.push(`${L} ${plural(L, 'land')} — your rule wants ${range}`);
    }
    const playRequired = r.playBy > 0 && a.hasCosts;
    const playOk = !playRequired || plays.length > 0;
    // With no lands at all the land reason already says it.
    if (!playOk && L > 0) reasons.push(`Nothing these lands can cast by turn ${r.playBy}`);

    const keep = landsOk && playOk;
    let headline;
    if (keep) {
        const parts = [`${L} ${plural(L, 'land')}`];
        if (a.hasCosts) {
            if (a.ramp.length) parts.push(a.ramp.length === 1 ? 'a ramp piece' : `${a.ramp.length} ramp pieces`);
            parts.push(plays.length
                ? `${numberWord(plays.length)} ${plural(plays.length, 'play')} by turn ${playTurn}`
                : `nothing to cast by turn ${playTurn}`);
        }
        headline = `Keep — ${parts.join(', ')}`;
    } else if (!landsOk) {
        headline = `Mulligan — ${L === 0 ? 'no lands' : `${L} ${plural(L, 'land')}`}`;
    } else {
        headline = `Mulligan — nothing to cast by turn ${r.playBy}`;
    }
    return { keep, headline, reasons, analysis: a, kept, bottomed, playTurn };
}

// ── Exact odds ───────────────────────────────────────────────────────────────

/**
 * Chance of exactly k lands in the opening hand, k = 0…handSize (exact).
 */
export function landDistribution(deckSize, lands, handSize = OPENING_HAND) {
    if (!(deckSize >= handSize) || lands < 0) return Array.from({ length: handSize + 1 }, () => 0);
    return Array.from({ length: handSize + 1 }, (_, k) => drawType(deckSize, lands, handSize, k));
}

/** Exact chance a seven has a land count inside the rule's range. */
export function landsInRangeChance(deckSize, lands, rule = DEFAULT_RULE) {
    const r = normalizeRule(rule);
    return landDistribution(deckSize, lands).slice(r.minLands, r.maxLands + 1).reduce((s, p) => s + p, 0);
}

// ── Simulation ───────────────────────────────────────────────────────────────

/**
 * Play out the London mulligan many times.
 *
 * Each game: draw seven; if the hand (after putting the owed cards on the
 * bottom) meets the rule, keep; otherwise shuffle and go again. The first
 * mulligan is free where the format says so. At four cards the player keeps
 * whatever they have.
 *
 * @param {Object[]} cards - lab library
 * @param {Object} rule
 * @param {{freeMulligan?:boolean, games?:number, rng?:Function, hasCosts?:boolean}} [opts]
 * @returns {{games:number, keptAt:Record<number,number>, firstKeepable:number, averageMulligans:number, atLeastSix:number, belowSix:number}|null}
 */
export function simulateMulligans(cards, rule = DEFAULT_RULE, { freeMulligan = false, games = 10000, rng = Math.random, hasCosts = true } = {}) {
    const N = cards.length;
    if (N < OPENING_HAND || games <= 0) return null;
    const r = normalizeRule(rule);
    const free = freeMulligan ? 1 : 0;
    const order = new Int32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    const keptAt = {};
    for (let s = OPENING_HAND; s >= MIN_HAND; s--) keptAt[s] = 0;
    let firstPass = 0;
    let mulligans = 0;
    const hand = new Array(OPENING_HAND);

    for (let g = 0; g < games; g++) {
        for (let m = 0; ; m++) {
            // Partial Fisher–Yates: the first seven are a uniform random sample.
            partialShuffle(order, OPENING_HAND, N, rng);
            for (let i = 0; i < OPENING_HAND; i++) hand[i] = cards[order[i]];
            const owed = Math.max(0, m - free);
            const size = OPENING_HAND - owed;
            if (size <= MIN_HAND) {
                keptAt[MIN_HAND]++;
                mulligans += m;
                break;
            }
            const pass = owed === 0
                ? meetsRule(hand, r, hasCosts)
                : meetsRule(chooseBottom(hand, owed, r).keep, r, hasCosts);
            if (m === 0 && pass) firstPass++;
            if (pass) {
                keptAt[size]++;
                mulligans += m;
                break;
            }
        }
    }
    const atLeastSix = (keptAt[7] + keptAt[6]) / games;
    return {
        games,
        keptAt,
        firstKeepable: firstPass / games,
        averageMulligans: mulligans / games,
        atLeastSix,
        belowSix: 1 - atLeastSix
    };
}

// ── A sample game ────────────────────────────────────────────────────────────
//
// The hands-on table: deal, London mulligan with a chosen bottom, then a few
// goldfish turns. Plain mutable state plus functions, so the page only renders
// and every rule here is tested.
//
// Phases: 'deciding' (looking at seven) → 'bottoming' (choosing the owed cards)
// → 'playing' (taking turns).

/** Goldfish turns stop here — the lab is about the opening, not the whole game. */
export const MAX_TURNS = 12;

/**
 * @param {Object[]} cards - lab library
 * @param {{freeMulligan?:boolean, firstPlayerDraws?:boolean, onPlay?:boolean}} [opts]
 */
export function createGame(cards = [], { freeMulligan = false, firstPlayerDraws = false, onPlay = true } = {}) {
    return {
        cards,
        freeMulligan,
        firstPlayerDraws,
        onPlay,
        dealt: [],
        library: [],
        hand: [],
        mulligans: 0,
        phase: 'deciding',
        selected: new Set(),
        bottomed: [],
        battlefield: [],
        graveyard: [],
        tapped: new Set(),
        turn: 0,
        landPlayed: false,
        kept: null,
        fresh: new Set()
    };
}

function clearTable(g) {
    g.phase = 'deciding';
    g.selected = new Set();
    g.bottomed = [];
    g.battlefield = [];
    g.graveyard = [];
    g.tapped = new Set();
    g.turn = 0;
    g.landPlayed = false;
    g.kept = null;
}

function dealFrom(g, order) {
    g.dealt = order;
    g.hand = order.slice(0, OPENING_HAND);
    g.library = order.slice(OPENING_HAND);
    clearTable(g);
    g.fresh = new Set(g.hand.map(c => c.uid));
    return g;
}

/** Can a hand be dealt at all? */
export function canDeal(g) {
    return g.cards.length >= OPENING_HAND;
}

/** Shuffle everything and deal seven. `fresh` marks the cards to animate. */
export function dealHand(g, rng = Math.random) {
    if (!canDeal(g)) {
        g.hand = [];
        g.library = g.cards.slice();
        clearTable(g);
        return g;
    }
    return dealFrom(g, shuffled(g.cards, rng));
}

/** A brand-new game: no mulligans taken. */
export function newHand(g, rng = Math.random) {
    g.mulligans = 0;
    return dealHand(g, rng);
}

/** Cards owed to the bottom if this hand is kept (London rule). */
export function owedCards(g) {
    return Math.max(0, g.mulligans - (g.freeMulligan ? 1 : 0));
}

/** You can always mulligan while deciding, as long as a card would be left. */
export function canMulligan(g) {
    if (!canDeal(g) || g.phase === 'playing') return false;
    return Math.max(0, g.mulligans + 1 - (g.freeMulligan ? 1 : 0)) < OPENING_HAND;
}

export function takeMulligan(g, rng = Math.random) {
    if (!canMulligan(g)) return false;
    g.mulligans += 1;
    dealHand(g, rng);
    return true;
}

/** Replay the current deal from the top: same seven, same library order. */
export function resetHand(g) {
    if (g.dealt.length < OPENING_HAND) return g;
    return dealFrom(g, g.dealt);
}

/**
 * Keep the seven. With cards owed this moves to choosing them; otherwise the
 * hand is kept and the game is ready for turn one.
 * @returns {boolean} whether anything changed
 */
export function keepHand(g) {
    if (g.phase !== 'deciding' || g.hand.length === 0) return false;
    if (owedCards(g) > 0) {
        g.phase = 'bottoming';
        g.selected = new Set();
        return true;
    }
    g.phase = 'playing';
    g.kept = g.hand.slice();
    return true;
}

/** Toggle a card for the bottom, never choosing more than owed. */
export function toggleBottom(g, uid) {
    if (g.phase !== 'bottoming') return false;
    if (g.selected.has(uid)) {
        g.selected.delete(uid);
        return true;
    }
    if (g.selected.size >= owedCards(g) || !g.hand.some(c => c.uid === uid)) return false;
    g.selected.add(uid);
    return true;
}

/** Choose the bottom cards the way the simulation would. */
export function suggestBottom(g, rule = DEFAULT_RULE) {
    if (g.phase !== 'bottoming') return false;
    g.selected = new Set(chooseBottom(g.hand, owedCards(g), normalizeRule(rule)).bottom.map(c => c.uid));
    return true;
}

/** Put the chosen cards on the bottom (in the order chosen) and keep the rest. */
export function confirmBottom(g) {
    if (g.phase !== 'bottoming' || g.selected.size !== owedCards(g)) return false;
    const chosen = [...g.selected].map(uid => g.hand.find(c => c.uid === uid)).filter(Boolean);
    g.hand = g.hand.filter(c => !g.selected.has(c.uid));
    g.library = g.library.concat(chosen);
    g.bottomed = chosen;
    g.selected = new Set();
    g.phase = 'playing';
    g.kept = g.hand.slice();
    return true;
}

/** Lands on the battlefield that aren't tapped this turn. */
export function untappedLands(g) {
    return g.battlefield.filter(c => c.land && !g.tapped.has(c.uid));
}

/** Cards in hand you could cast right now with your untapped lands. */
export function castableNow(g) {
    if (g.phase !== 'playing' || g.turn === 0) return [];
    const untapped = untappedLands(g);
    const masks = untapped.map(l => l.mask);
    return g.hand.filter(c => castableWith(c, masks, untapped.length));
}

/** Will "next turn" do anything? */
export function canAdvance(g) {
    return g.phase === 'playing' && g.turn < MAX_TURNS && (g.library.length > 0 || g.hand.some(c => c.land));
}

/**
 * Start the next turn: untap, draw (the starting player skips their first draw
 * where the format says so), and play the most useful land from hand.
 * @returns {{drew:Object|null, land:Object|null}|null}
 */
export function nextTurn(g) {
    if (!canAdvance(g)) return null;
    g.turn += 1;
    g.tapped = new Set();
    g.landPlayed = false;
    g.fresh = new Set();
    const skipsDraw = g.turn === 1 && g.onPlay && !g.firstPlayerDraws;
    let drew = null;
    if (!skipsDraw && g.library.length > 0) {
        drew = g.library.shift();
        g.hand.push(drew);
        g.fresh.add(drew.uid);
    }
    const land = chooseLandToPlay(g.hand, g.battlefield.filter(c => c.land));
    if (land) {
        g.hand = g.hand.filter(c => c !== land);
        g.battlefield.push(land);
        g.landPlayed = true;
    }
    return { drew, land };
}

/**
 * Cast a card from hand, tapping lands for it. Permanents go to the
 * battlefield; instants and sorceries to the graveyard.
 * @returns {Object[]|null} the lands tapped, or null if it can't be cast
 */
export function castCard(g, uid) {
    if (g.phase !== 'playing' || g.turn === 0) return null;
    const card = g.hand.find(c => c.uid === uid);
    if (!card || card.land) return null;
    const lands = payFor(card, untappedLands(g));
    if (!lands) return null;
    lands.forEach(l => g.tapped.add(l.uid));
    g.hand = g.hand.filter(c => c !== card);
    (card.permanent ? g.battlefield : g.graveyard).push(card);
    return lands;
}

// ── Words ────────────────────────────────────────────────────────────────────

/**
 * "About 3 in 4", "About half", "Nearly all", "Fewer than 1 in 20".
 * @param {number} p - 0…1
 */
export function handOdds(p) {
    if (!Number.isFinite(p)) return 'Some';
    if (p >= 0.97) return 'Nearly all';
    if (p < 0.01) return 'Fewer than 1 in 100';
    if (p < 0.05) return 'Fewer than 1 in 20';
    if (p <= 0.3) return `About 1 in ${Math.round(1 / p)}`;
    let best = null;
    for (const b of [2, 3, 4, 5, 10]) {
        for (let a = 1; a < b; a++) {
            const err = Math.abs(p - a / b);
            // Prefer the simpler fraction unless a finer one is clearly closer.
            if (!best || err < best.err - 0.015) best = { a, b, err };
        }
    }
    if (best.a * 2 === best.b) return 'About half';
    return `About ${best.a} in ${best.b}`;
}

/**
 * "fewer than 1 game in 20", "about 1 game in 8", "about 2 games in 5".
 * @param {number} p - 0…1
 */
export function gameOdds(p) {
    if (!Number.isFinite(p) || p < 0.01) return 'fewer than 1 game in 100';
    if (p < 0.05) return 'fewer than 1 game in 20';
    if (p <= 0.34) return `about 1 game in ${Math.round(1 / p)}`;
    const phrase = handOdds(p);
    if (phrase === 'Nearly all') return 'nearly every game';
    if (phrase === 'About half') return 'about half of games';
    return `${phrase.toLowerCase().replace(/ in (\d+)$/, ' games in $1')}`;
}

/**
 * The page's bottom line, built from the numbers so it can't drift from them.
 * @param {{keepable:number, belowSix:number, freeMulligan?:boolean}} s
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(s) {
    if (!s || !Number.isFinite(s.keepable) || !Number.isFinite(s.belowSix)) {
        return { html: 'Load a deck with at least seven cards to deal sample hands.', tone: 'flat' };
    }
    const html = `<strong>${handOdds(s.keepable)}</strong> opening hands are keepable as-is; `
        + `you’ll mulligan below 6 cards in <strong>${gameOdds(s.belowSix)}</strong>`
        + `${s.freeMulligan ? ', counting the free first mulligan' : ''}.`;
    const tone = s.keepable >= 0.7 && s.belowSix <= 0.08 ? 'good'
        : s.keepable < 0.5 || s.belowSix > 0.2 ? 'bad'
            : 'warn';
    return { html, tone };
}
