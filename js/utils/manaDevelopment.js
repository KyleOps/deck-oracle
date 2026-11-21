/**
 * Mana development — how fast a deck's mana comes online.
 *
 * Two halves, both pure and DOM-free (tested in
 * tests/calculators/manadev.node.test.js):
 *
 *   1. The ramp classifier (ramp.js — the rule every page counts ramp by):
 *      mana rocks and dorks (how much they add, in which colours, whether they
 *      need a turn), land-fetch spells (how many lands, tapped or not,
 *      battlefield or hand), extra land drops. Ramp it can't simulate (mana
 *      doublers, triggered Treasure …) and things that help your mana without
 *      being ramp (rituals, cost reducers) are listed but NOT counted — each
 *      says so in its label. Lands are read here (classifyLand).
 *   2. A goldfish simulator: shuffle, London mulligan with the Opening Hands
 *      keep rule, then each turn draw → play a land → greedily cast the ramp
 *      you can afford. It records the mana you can make each turn, the turn
 *      your commander (or top end) becomes castable — mana value AND colours —
 *      and the same games with every ramp card turned into a blank, so the
 *      difference is exactly what the ramp is worth.
 *
 * "Mana on turn T" means: the mana your lands and mana permanents can make on
 * turn T once you have played your land, before you cast anything.
 *
 * Deterministic for a given seed. Games are paired: each shuffle is played
 * twice, with ramp and lands-only, so "turns saved" is measured game by game.
 */

import { COLORS } from './mana.js';
import { asLibrary, commandersOf, isLand, isLibrary, sameCard } from './library.js';
import { mulberry32, shuffle } from './random.js';
import { quantile } from './stats.js';
import { inflect as plural } from './text.js';
import { BASIC_TYPES, basicTypesIn, classifyRamp, describeRamp, rampRole, stripReminder, typeBits } from './ramp.js';
import {
    toLabCard, buildPlaceholderLibrary, identityOf, libraryKey, meetsRule, chooseBottom,
    DEFAULT_RULE, MIN_HAND, OPENING_HAND, maskOf, COLOR_BIT
} from './handLab.js';
import { escapeHtml, cardRef } from '../data/glossary.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Turns the page shows. */
export const SHOWN_TURNS = 10;
/** Turns simulated — two extra so "turn 10 or later" and the averages are not clipped. */
export const SIM_TURNS = 12;
export const DEFAULT_GAMES = 5000;
/** Fixed seed: the same deck always gives the same numbers. */
export const SEED = 0x6d616e61;
/** Mana tracked per turn; anything above counts as this much. */
export const MAX_MANA = 30;
/** The turn the bottom line and the first hero stat quote. */
export const CHECK_TURN = 4;
/** Sample games kept for the page. */
export const SAMPLE_GAMES = 4;

function typeLineBits(typeLine) {
    return typeBits(basicTypesIn(typeLine));
}

/** How a land enters. */
export const TAP = Object.freeze({ UNTAPPED: 0, TAPPED: 1, FAST: 2, SLOW: 3, CHECK: 4 });

function popcount(m) {
    let n = 0;
    while (m) { n += m & 1; m >>= 1; }
    return n;
}

// ── Lands ────────────────────────────────────────────────────────────────────

/**
 * How a land behaves in the goldfish: mana per tap, how it enters, and whether
 * it bounces a land (karoo lands).
 * @param {Object} card - Scryfall-shaped record
 * @param {{multiplayer?:boolean}} [opts]
 * @returns {{mana:number, tap:number, checkTypes:string[]|null, bounce:boolean}}
 */
export function classifyLand(card, { multiplayer = true } = {}) {
    const raw = String(card?.oracle_text ?? '').toLowerCase();
    const text = stripReminder(raw);
    let mana = 1;
    for (const line of text.split('\n')) {
        const m = line.trim().match(/^\{t\}(?:, pay \d+ life)?: add ((?:\{[wubrgc]\})+)(?=[.\s]|$)/);
        if (m && !/activate only if/.test(line)) mana = Math.max(mana, (m[1].match(/\{/g) ?? []).length);
    }

    let tap = TAP.UNTAPPED;
    let checkTypes = null;
    let m;
    if (/you may pay \d+ life\. if you don't, it enters tapped/.test(text)) tap = TAP.UNTAPPED;
    else if (/enters tapped unless you have two or more opponents/.test(text)) tap = multiplayer ? TAP.UNTAPPED : TAP.TAPPED;
    else if (/enters tapped unless you control two or fewer other lands/.test(text)) tap = TAP.FAST;
    else if (/enters tapped unless you control two or more other lands/.test(text)) tap = TAP.SLOW;
    else if ((m = text.match(/enters tapped unless you control an? (\w+)(?: or an? (\w+))?/)) && BASIC_TYPES.includes(m[1])) {
        tap = TAP.CHECK;
        checkTypes = [m[1], m[2]].filter(t => BASIC_TYPES.includes(t));
    } else if (/enters tapped unless/.test(text)) tap = TAP.UNTAPPED; // other conditions: assume you meet them
    else if (/enters (the battlefield )?tapped/.test(text)) tap = TAP.TAPPED;
    // Evolving Wilds and friends: the land you fetch arrives tapped.
    else if (/sacrifice this land: search your library[^.]*onto the battlefield tapped/.test(text)) tap = TAP.TAPPED;

    const bounce = /when this land enters, return a land you control to its owner's hand/.test(text);
    return { mana, tap, checkTypes, bounce };
}

// ── Ramp ─────────────────────────────────────────────────────────────────────
//
// The classifier lives in ramp.js: it is the one rule for what counts as ramp,
// shared with the role tags every other page reads. Re-exported here for the
// page and the tests.

export { classifyRamp, describeRamp, rampRole, typeBits };

// ── Library ──────────────────────────────────────────────────────────────────

/** When the simulator casts a card: bit 1 always (modelled ramp), bit 2 with Treasure on. */
const USE_RAMP = 1;
const USE_TREASURE = 2;

function rampUseOf(info) {
    if (!info) return 0;
    return (info.modelled ? USE_RAMP : 0) | (info.treasure > 0 ? USE_TREASURE : 0);
}

/**
 * Attach land and ramp behaviour to a lab card. Every card gets every field,
 * in the same order, so the simulator's hot loops see one object shape.
 */
function annotate(lab, card, identity, multiplayer) {
    const l = lab.land ? classifyLand(card, { multiplayer }) : null;
    lab.types = String(lab.typeLine ?? '').toLowerCase();
    lab.generic = lab.playMv == null ? 0 : Math.max(0, lab.playMv - lab.pips.length);
    lab.rampInfo = lab.land ? null : classifyRamp(card, { identity });
    lab.rampIndex = -1;
    lab.lmana = l ? l.mana : 0;
    lab.ltap = l ? l.tap : TAP.UNTAPPED;
    lab.lcheck = l ? l.checkTypes : null;
    lab.lcheckBits = typeBits(l?.checkTypes ?? []);
    lab.typeBits = l ? typeLineBits(lab.typeLine) : 0;
    lab.lbounce = l ? l.bounce : false;
    lab.basic = Boolean(l) && /\bbasic\b/.test(lab.types);
    lab.pipUnion = lab.pips.reduce((m, p) => m | p, 0);
    lab.fmatch = 0; // land searches it satisfies (set per library, see assignSearchSlots)
    lab.rampUse = rampUseOf(lab.rampInfo);
    return lab;
}

/**
 * The cards your mana is racing towards.
 *
 * Every commander (one, partners, a Doctor and their companion, a commander
 * and a background) is a target of its own: its mana value AND colours, cast
 * from the command zone. The most expensive is the primary target — the one
 * the bottom line leads with (ties: the first listed). Without a commander
 * (or without any commander's card record), the one target is your top end:
 * the middle of your three most expensive spells.
 *
 * @param {{commanders?:Array<{name:string, card:Object|null}>, cards?:Object[], identity?:string[]}} [opts]
 *   commanders: the command zone in deck order, records when known
 * @returns {{targets:Array<Object>, primary:Object|null, missing:string[]}}
 *   targets: `{kind:'commander'|'top-end', name, mv, cost, card, names}` in deck
 *   order; missing: commanders whose cost can't be checked (no card record)
 */
export function chooseTargets({ commanders = [], cards = [], identity = COLORS } = {}) {
    const zone = (commanders ?? []).filter(c => c?.name);
    const castable = [];
    const missing = [];
    for (const { name, card } of zone) {
        if (card && !isLand(card) && Number.isFinite(Number(card.cmc))) castable.push({ card, lab: annotate(toLabCard(card, -1, identity), card, identity, true) });
        else missing.push(name);
    }
    if (castable.length) {
        const names = castable.map(c => c.card.name);
        const targets = castable.map(({ card, lab }) => ({ kind: 'commander', name: card.name, mv: lab.playMv, cost: lab.cost, card: lab, names }));
        const primary = targets.reduce((best, t) => (t.mv > best.mv ? t : best));
        return { targets, primary, missing };
    }
    const seen = new Set();
    const spells = [];
    for (const c of cards) {
        if (c.land || c.placeholder || !(c.playMv > 0) || seen.has(c.name)) continue;
        seen.add(c.name);
        spells.push(c);
    }
    if (spells.length === 0) return { targets: [], primary: null, missing };
    spells.sort((a, b) => b.playMv - a.playMv || a.name.localeCompare(b.name));
    const top = spells.slice(0, 3);
    const pick = top.length >= 3 ? top[1] : top[0];
    const primary = { kind: 'top-end', name: pick.name, mv: pick.playMv, cost: pick.cost, card: pick, names: top.map(c => c.name) };
    return { targets: [primary], primary, missing };
}

/**
 * The primary target alone (see chooseTargets): with partners, the more
 * expensive commander.
 * @param {{commanderCards?:Array<Object|null>, commanderCard?:Object|null, cards?:Object[], identity?:string[]}} [opts]
 * @returns {{kind:'commander'|'top-end', name:string, mv:number, cost:string, card:Object, names:string[]}|null}
 */
export function chooseTarget({ commanderCards = [], commanderCard = null, cards = [], identity = COLORS } = {}) {
    const commanders = [...(commanderCards ?? []), commanderCard].filter(c => c?.name).map(card => ({ name: card.name, card }));
    return chooseTargets({ commanders, cards, identity }).primary;
}

/**
 * The command zone as [{name, card}]: every commander the library keeps out,
 * each with its record when one of `records` (or the snapshot) has it.
 */
function zoneOf(deck, library, records) {
    if (!library.commanders.length) return [];
    const known = (records ?? (isLibrary(deck) ? [] : commandersOf(deck).map(c => c.card))).filter(Boolean);
    return library.commanders.map(name => ({ name, card: known.find(c => sameCard(c.name, name)) ?? null }));
}

/**
 * Expand a decklist into simulator cards (one per copy) with land and ramp
 * behaviour attached. Commanders start in the command zone, never the library
 * (see library.js); their records set the colour identity and the targets.
 *
 * @param {Object} deck - a DeckConfig snapshot, a Library, or a cardsByName map
 * @param {{format?:Object|string, commanders?:string[], commanderCards?:Array<Object|null>, multiplayer?:boolean}} [opts]
 *   commanderCards: the command zone's records (default: looked up on the
 *   snapshot — see commandersOf()); used only when the library has commanders.
 *   A commander without a record can't be checked: it is listed in `missing`.
 */
export function buildManaLibrary(deck = {}, { format, commanders, commanderCards, multiplayer = true } = {}) {
    const library = asLibrary(deck, { format, commanders });
    const zone = zoneOf(deck, library, commanderCards);
    const identity = identityOf(library.cards, zone.map(c => c.card).filter(Boolean));
    const cards = [];
    const rampByName = new Map();
    let uid = 0;
    for (const card of library.cards) {
        const copies = card.count;
        const proto = annotate(toLabCard(card, 0, identity), card, identity, multiplayer);
        if (proto.rampInfo) {
            if (!rampByName.has(proto.name)) rampByName.set(proto.name, { name: proto.name, count: 0, info: proto.rampInfo, mv: proto.playMv, index: rampByName.size });
            rampByName.get(proto.name).count += copies;
            proto.rampIndex = rampByName.get(proto.name).index;
        }
        for (let i = 0; i < copies; i++) cards.push({ ...proto, uid: uid++ });
    }
    const ramp = [...rampByName.values()];
    const searches = assignSearchSlots(ramp, cards);
    const { targets, primary, missing } = chooseTargets({ commanders: zone, cards, identity });
    return {
        cards,
        identity,
        idMask: maskOf(identity),
        ramp,
        searchSlot: searches.slots,
        searchMasks: searches.masks,
        landCount: cards.filter(c => c.land).length,
        target: primary,
        targets,
        missingCommanders: missing,
        placeholder: false,
        commanders: library.commanders,
        key: libraryKey(cards)
    };
}

/** A library of stand-ins for decks entered as bare type counts: lands only. */
export function buildCountsLibrary(counts = {}) {
    const built = buildPlaceholderLibrary(counts);
    const cards = built.cards.map(c => ({
        ...c, types: String(c.typeLine).toLowerCase(), generic: 0, rampInfo: null, rampIndex: -1,
        lmana: c.land ? 1 : 0, ltap: TAP.UNTAPPED, lcheck: null, lcheckBits: 0, typeBits: 0, lbounce: false, basic: c.land,
        pipUnion: 0, fmatch: 0, rampUse: 0
    }));
    return {
        cards, identity: [], idMask: 0, ramp: [], searchSlot: new Int8Array(0), searchMasks: [], landCount: cards.filter(c => c.land).length, targets: [], missingCommanders: [],
        target: null, placeholder: true, commanders: [], key: `counts:${libraryKey(cards)}`
    };
}

/** Number of ramp copies the simulator actually plays. */
export function countedRamp(lib, { treasure = false } = {}) {
    return (lib?.ramp ?? []).filter(r => rampRole(r.info, { treasure }) === 'counted').reduce((s, r) => s + r.count, 0);
}

/**
 * Ramp copies in the library by the shared rule (ramp.js) — the count every
 * other page shows: what the simulator plays plus the ramp it can't.
 */
export function rampTotal(lib) {
    return (lib?.ramp ?? []).filter(r => r.info.ramp).reduce((s, r) => s + r.count, 0);
}

// ── Paying for things ───────────────────────────────────────────────────────
//
// The mana pool for a turn is a list of one-mana "units", each with the
// colours it can be. Paying matches each coloured pip to a distinct unit (with
// backtracking), then takes generic mana from the least flexible units left,
// Treasure last. Scratch arrays keep it allocation-free.

const POOL = 256;
const poolMask = new Int32Array(POOL);
const poolTreasure = new Uint8Array(POOL);
const poolUsed = new Uint8Array(POOL);
const poolKey = new Int32Array(POOL);
const order = new Int32Array(POOL);
const chosen = new Int32Array(16);
const genericIdx = new Int32Array(POOL);
const BITS = Int8Array.from({ length: 32 }, (_, m) => popcount(m));
let poolSize = 0;
let poolFreeCount = 0;
let orderDirty = true;
let poolUnion = 0;

function poolReset() {
    poolSize = 0;
    poolFreeCount = 0;
    poolUnion = 0;
    orderDirty = true;
}

function poolAdd(mask, count, treasure = 0) {
    // Non-Treasure first, then fewest colours, identical units adjacent.
    const key = treasure * 4096 + BITS[mask & 31] * 64 + mask;
    for (let i = 0; i < count && poolSize < POOL; i++) {
        poolMask[poolSize] = mask;
        poolTreasure[poolSize] = treasure;
        poolUsed[poolSize] = 0;
        poolKey[poolSize] = key;
        poolSize++;
        poolFreeCount++;
    }
    poolUnion |= mask;
    orderDirty = true;
}

function sortOrder() {
    for (let i = 0; i < poolSize; i++) {
        const k = poolKey[i];
        let j = i - 1;
        while (j >= 0 && poolKey[order[j]] > k) { order[j + 1] = order[j]; j--; }
        order[j + 1] = i;
    }
    orderDirty = false;
}

function assignPips(pips, k) {
    if (k === pips.length) return true;
    const pip = pips[k];
    let lastMask = -1;
    let lastTreasure = -1;
    for (let o = 0; o < poolSize; o++) {
        const i = order[o];
        if (poolUsed[i] || !(poolMask[i] & pip)) continue;
        // Identical units are interchangeable: if one failed, the next will too.
        if (poolMask[i] === lastMask && poolTreasure[i] === lastTreasure) continue;
        lastMask = poolMask[i];
        lastTreasure = poolTreasure[i];
        poolUsed[i] = 1;
        chosen[k] = i;
        if (assignPips(pips, k + 1)) return true;
        poolUsed[i] = 0;
    }
    return false;
}

/**
 * Can the pool pay for this card (pips + generic + extra)? With commit, the
 * units are spent; the return value is the number of Treasure used (or -1).
 */
function pay(card, extra = 0, commit = false) {
    if (card.playMv == null) return -1;
    const pips = card.pips;
    const np = pips.length;
    if (np > 15) return -1;
    const total = card.playMv + extra;
    if (total > poolFreeCount) return -1;
    for (let k = 0; k < np; k++) if (!(pips[k] & poolUnion)) return -1;
    if (orderDirty) sortOrder();
    if (np && !assignPips(pips, 0)) return -1;
    let need = total - np;
    let g = 0;
    for (let o = 0; o < poolSize && need > 0; o++) {
        const i = order[o];
        if (poolUsed[i]) continue;
        poolUsed[i] = 1;
        genericIdx[g++] = i;
        need--;
    }
    if (need > 0 || !commit) {
        for (let k = 0; k < np; k++) poolUsed[chosen[k]] = 0;
        for (let k = 0; k < g; k++) poolUsed[genericIdx[k]] = 0;
        return need > 0 ? -1 : 0;
    }
    let treasure = 0;
    for (let k = 0; k < np; k++) treasure += poolTreasure[chosen[k]];
    for (let k = 0; k < g; k++) treasure += poolTreasure[genericIdx[k]];
    poolFreeCount -= total;
    return treasure;
}

// ── One game ────────────────────────────────────────────────────────────────
//
// The engine keeps everything a game needs in one reusable Game object (typed
// arrays and fixed-size arrays sized to the library), so playing a game
// allocates nothing unless it is logged. The library is never copied or
// spliced: a land search marks its position as taken, and per-search running
// counts of the lands still in the library answer "how many can this find?"
// without a scan. The rules are exactly those of the engine this replaced —
// tests/utils/manaDevelopmentEngine.node.test.js plays both on the same seeds.

/**
 * Deal and mulligan (London, the Opening Hands keep rule). At four cards the
 * player keeps whatever they have.
 * @returns {{hand:Object[], library:Object[], mulligans:number}}
 */
export function dealOpeningHand(cards, rng, { freeMulligan = false, idx = null } = {}) {
    const N = cards.length;
    const ord = idx ?? new Int32Array(N);
    for (let i = 0; i < N; i++) ord[i] = i;
    const free = freeMulligan ? 1 : 0;
    for (let m = 0; ; m++) {
        shuffle(ord.length === N ? ord : ord.subarray(0, N), rng);
        const seven = [];
        for (let i = 0; i < OPENING_HAND && i < N; i++) seven.push(cards[ord[i]]);
        const owed = Math.max(0, m - free);
        const size = OPENING_HAND - owed;
        const { keep, bottom } = owed > 0 ? chooseBottom(seven, owed, DEFAULT_RULE) : { keep: seven, bottom: [] };
        if (size <= MIN_HAND || meetsRule(keep, DEFAULT_RULE, false)) {
            const library = [];
            for (let i = OPENING_HAND; i < N; i++) library.push(cards[ord[i]]);
            for (const c of bottom) library.push(c);
            return { hand: keep, library, mulligans: m };
        }
    }
}

/**
 * dealOpeningHand() into the run's own buffers (no allocation on a keep of
 * seven). Same shuffles, same keep rule, same library order.
 * @returns {number} mulligans taken
 */
function dealInto(run) {
    const cards = run.cards;
    const N = cards.length;
    const ord = run.idx;
    for (let i = 0; i < N; i++) ord[i] = i;
    const free = run.freeMulligan ? 1 : 0;
    const seven = run.seven;
    for (let m = 0; ; m++) {
        shuffle(ord, run.rng);
        for (let i = 0; i < OPENING_HAND; i++) seven[i] = cards[ord[i]];
        const owed = Math.max(0, m - free);
        let keep = seven;
        let bottom = null;
        if (owed > 0) ({ keep, bottom } = chooseBottom(seven, owed, DEFAULT_RULE));
        if (OPENING_HAND - owed <= MIN_HAND || meetsRule(keep, DEFAULT_RULE, false)) {
            for (let i = 0; i < keep.length; i++) run.dealHand[i] = keep[i];
            run.dealHandLen = keep.length;
            let k = 0;
            for (let i = OPENING_HAND; i < N; i++) run.dealLib[k++] = cards[ord[i]];
            if (bottom) for (let i = 0; i < bottom.length; i++) run.dealLib[k++] = bottom[i];
            run.dealLibLen = k;
            return m;
        }
    }
}

/** Does a library card satisfy a ramp card's search ("basic land", "Forest", "land")? */
function landMatches(card, r) {
    if (!card.land) return false;
    if (r.filterKind === 1) return card.basic;
    if (r.filterKind === 2) return (card.typeBits & r.filterBits) !== 0;
    return true;
}

/** Most distinct land searches tracked with running counts (one bit each). */
const MAX_SEARCHES = 30;

/**
 * Give each distinct land search in a library ("basic land", "Forest", any
 * land …) a slot, and each card a bit mask of the searches it satisfies, so
 * the engine can keep a running count per search instead of scanning. Each
 * search also lists the colour masks of the lands it can find: the best score
 * among them is a ceiling that lets a search stop at the first land reaching it.
 * @param {Array<{info:Object}>} ramp - the library's ramp list
 * @param {Object[]} cards - simulator cards (their `fmatch` is set here)
 * @returns {{slots:Int8Array, masks:Int32Array[]}} slot per ramp entry (-1 = no
 *   land search, or too many to track) and the land colour masks per slot
 */
function assignSearchSlots(ramp, cards) {
    const searches = [];
    const slots = new Int8Array(ramp.length).fill(-1);
    ramp.forEach((r, i) => {
        const info = r.info;
        if (!(info.lands || info.toHand)) return;
        let s = searches.findIndex(f => f.filterKind === info.filterKind && f.filterBits === info.filterBits);
        if (s < 0 && searches.length < MAX_SEARCHES) {
            s = searches.length;
            searches.push({ filterKind: info.filterKind, filterBits: info.filterBits });
        }
        slots[i] = s;
    });
    const masks = searches.map(() => new Set());
    for (const c of cards) {
        let m = 0;
        for (let s = 0; s < searches.length; s++) {
            if (!landMatches(c, searches[s])) continue;
            m |= 1 << s;
            masks[s].add(c.mask);
        }
        c.fmatch = m;
    }
    return { slots, masks: masks.map(set => Int32Array.from(set)) };
}

/** Index of the lowest set bit. */
const lowBit = m => 31 - Math.clz32(m & -m);

/**
 * Everything one game changes, allocated once per run and reset per game.
 * Zones are arrays with explicit lengths; removing from one shifts the rest
 * down, so the order every rule iterates in is the order cards arrived.
 */
class Game {
    constructor(size) {
        const n = Math.max(0, size) + 16;
        this.hand = new Array(n).fill(null);
        this.handLen = 0;
        this.useMask = USE_RAMP; // which cards the simulator casts (see rampUseOf)
        this.rampInHand = 0;     // castable ramp cards in hand
        this.lib = null;       // the dealt library, read-only
        this.libLen = 0;
        this.taken = new Uint8Array(n); // library positions a search took
        this.top = 0;                   // next card to draw: never a taken position
        this.found = new Int32Array(MAX_SEARCHES); // lands left in the library, per search
        this.landCard = new Array(n).fill(null);
        this.landReady = new Int16Array(n); // first turn each land can tap
        this.landLen = 0;
        this.landMask = 0;  // colours the lands in play make
        this.landTypes = 0; // basic land types in play (check lands)
        this.srcMana = new Int32Array(n);
        this.srcMask = new Int32Array(n);
        this.srcReady = new Int16Array(n);
        this.srcLen = 0;
        this.t = 0;
        this.extraDrops = 0;
        this.drops = 0;
        this.dropsUsed = 0;
        this.fromTop = false;
        this.treasures = 0;
        this.floating = 0;      // a karoo's bounced land: you tap it before it leaves
        this.floatingMask = 0;
        this.targetTurn = 0;    // the primary target's first castable turn
        this.targetTurns = new Int8Array(MAX_TARGETS); // every target's
        this.targetsLeft = 0;   // targets not castable yet
        this.lastCard = null;   // the land playLand() just played
        this.entry = null;
        this.firstCast = null;
        this.firstSeen = null;
    }
}

/** Most targets tracked: every commander a deck can have (commanders.js MAX_COMMANDERS). */
const MAX_TARGETS = 4;

/** Per-game results, reused: the run records them before the next game. */
function newOutcome(rampCount) {
    return {
        mana: new Uint8Array(SIM_TURNS + 1),
        targetTurn: 0,
        targetTurns: new Int8Array(MAX_TARGETS),
        firstCast: new Int8Array(rampCount),
        firstSeen: new Int8Array(rampCount)
    };
}

function handPush(g, c) {
    g.hand[g.handLen++] = c;
    if (c.rampUse & g.useMask) g.rampInHand++;
}

function handRemoveAt(g, i) {
    const hand = g.hand;
    if (hand[i].rampUse & g.useMask) g.rampInHand--;
    const n = --g.handLen;
    for (let k = i; k < n; k++) hand[k] = hand[k + 1];
    hand[n] = null;
}

function seen(g, c) {
    if (g.firstSeen && c.rampIndex >= 0 && !g.firstSeen[c.rampIndex]) g.firstSeen[c.rampIndex] = g.t;
}

/** Take a card out of the library's search counts. */
function uncount(g, c) {
    for (let m = c.fmatch; m; m &= m - 1) g.found[lowBit(m)]--;
}

function nextFree(g, i) {
    const len = g.libLen;
    const taken = g.taken;
    while (i < len && taken[i]) i++;
    return i;
}

/** Draw the top card of the library (callers check g.top < g.libLen). */
function drawTop(g) {
    const c = g.lib[g.top];
    uncount(g, c);
    g.top = nextFree(g, g.top + 1);
    return c;
}

/** Take the card at library position i (a land search). */
function takeAt(g, i) {
    g.taken[i] = 1;
    uncount(g, g.lib[i]);
    if (i === g.top) g.top = nextFree(g, i + 1);
}

function putLand(g, card, tapped) {
    const i = g.landLen++;
    g.landCard[i] = card;
    g.landReady[i] = tapped ? g.t + 1 : g.t;
    g.landMask |= card.mask;
    g.landTypes |= card.typeBits;
}

function removeLandAt(g, i) {
    const n = --g.landLen;
    for (let k = i; k < n; k++) {
        g.landCard[k] = g.landCard[k + 1];
        g.landReady[k] = g.landReady[k + 1];
    }
    g.landCard[n] = null;
    let mask = 0;
    let types = 0;
    for (let k = 0; k < n; k++) {
        mask |= g.landCard[k].mask;
        types |= g.landCard[k].typeBits;
    }
    g.landMask = mask;
    g.landTypes = types;
}

function entersTapped(g, card) {
    switch (card.ltap) {
        case TAP.TAPPED: return true;
        case TAP.FAST: return g.landLen > 2;
        case TAP.SLOW: return g.landLen < 2;
        case TAP.CHECK: return (g.landTypes & card.lcheckBits) === 0;
        default: return false;
    }
}

function neededColours(run, g) {
    let need = run.targetPips;
    const hand = g.hand;
    for (let i = 0; i < g.handLen; i++) need |= hand[i].pipUnion;
    return need;
}

/** Mana the permanents in play (plus Treasure and floating mana) can make this turn. */
function readyMana(g) {
    const t = g.t;
    let n = g.treasures + g.floating;
    for (let i = 0; i < g.landLen; i++) if (g.landReady[i] <= t) n += g.landCard[i].lmana;
    for (let i = 0; i < g.srcLen; i++) if (g.srcReady[i] <= t) n += g.srcMana[i];
    return n;
}

function landScore(g, c, matters, have, need) {
    const tapped = c.lbounce || entersTapped(g, c);
    const fresh = c.mask & ~have;
    return ((tapped ? !matters : matters) ? 100000 : 0)
        + c.lmana * 1000 + BITS[fresh & need] * 100 + BITS[fresh] * 10 + BITS[c.mask];
}

/**
 * Play one land from hand (or the top of the library).
 * @returns {number} 0 none, 1 played (not ready this turn), 2 played and ready
 */
function playLand(run, g) {
    const hand = g.hand;
    const n = g.handLen;
    const topCard = g.fromTop && g.top < g.libLen && g.lib[g.top].land ? g.lib[g.top] : null;
    let any = topCard !== null;
    let bump = topCard && !entersTapped(g, topCard) && !topCard.lbounce ? topCard.lmana : 0;
    for (let i = 0; i < n; i++) {
        const c = hand[i];
        if (!c.land) continue;
        any = true;
        if (!c.lbounce && !entersTapped(g, c) && c.lmana > bump) bump = c.lmana;
    }
    if (!any) return 0;
    // Does an untapped land's mana let you cast something this turn? If
    // not, a tapped land costs nothing — play it now and save the other.
    let matters = false;
    if (bump > 0) {
        const cap0 = readyMana(g);
        const hi = cap0 + bump;
        // Every commander you can't cast yet counts, as if it were in hand.
        for (let i = 0; i < run.targetCount && !matters; i++) {
            const mv = run.targetCards[i].playMv;
            if (!g.targetTurns[i] && mv > cap0 && mv <= hi) matters = true;
        }
        for (let i = 0; i < n && !matters; i++) {
            const mv = hand[i].playMv;
            if (!hand[i].land && mv != null && mv > cap0 && mv <= hi) matters = true;
        }
    }
    const have = g.landMask;
    const need = neededColours(run, g);
    let best = null;
    let bestAt = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
        const c = hand[i];
        if (!c.land || (c.lbounce && g.landLen === 0)) continue; // a karoo would bounce itself
        const score = landScore(g, c, matters, have, need);
        if (score > bestScore) { best = c; bestAt = i; bestScore = score; }
    }
    // A free card off the top beats one from hand.
    if (topCard && !(topCard.lbounce && g.landLen === 0) && landScore(g, topCard, matters, have, need) + 1 > bestScore) {
        best = topCard;
        bestAt = -1;
    }
    if (!best) return 0;
    const tapped = best.lbounce || entersTapped(g, best);
    if (bestAt < 0) drawTop(g);
    else handRemoveAt(g, bestAt);
    putLand(g, best, tapped);
    if (best.lbounce) {
        // Return the least useful other land — after tapping it for mana.
        let back = -1;
        let backScore = Infinity;
        for (let i = 0; i < g.landLen - 1; i++) {
            const s = BITS[g.landCard[i].mask] * 10 + g.landCard[i].lmana;
            if (s < backScore) { back = i; backScore = s; }
        }
        const gone = g.landCard[back];
        if (g.landReady[back] <= g.t) { g.floating += gone.lmana; g.floatingMask |= gone.mask; }
        removeLandAt(g, back);
        handPush(g, gone);
    }
    if (g.entry) g.entry.lands.push(best.name);
    g.lastCard = best;
    return tapped ? 1 : 2;
}

/** Mark every target the pool can pay for now (each checked on its own, nothing spent). */
function checkTarget(run, g) {
    if (!g.targetsLeft) return;
    for (let i = 0; i < run.targetCount; i++) {
        if (g.targetTurns[i] || pay(run.targetCards[i]) < 0) continue;
        g.targetTurns[i] = g.t;
        g.targetsLeft--;
        if (i === run.primary) g.targetTurn = g.t;
        if (g.entry) {
            if (i === run.primary) g.entry.target = true;
            g.entry.castable.push(run.targets[i].name);
        }
    }
}

/** The running-count slot of a ramp card's land search (-1: scan instead). */
function searchSlot(run, card) {
    return run.searchSlot && card.rampIndex >= 0 ? run.searchSlot[card.rampIndex] : -1;
}

/** How much a search wants a land of these colours: new colours you need, new colours, colours. */
function fetchScore(mask, have, need) {
    const fresh = mask & ~have;
    return BITS[fresh & need] * 100 + BITS[fresh] * 10 + BITS[mask];
}

/**
 * Fetch n lands matching the ramp card's search, colours you need first; the
 * first (topmost) of the best-scoring lands. A tracked search stops scanning
 * at a land that scores the ceiling: nothing further down can beat it.
 */
function fetchLands(run, g, r, slot, n, toBattlefield, notes) {
    const lib = g.lib;
    const taken = g.taken;
    const len = g.libLen;
    for (let k = 0; k < n; k++) {
        if (slot >= 0 && g.found[slot] === 0) return;
        const have = g.landMask;
        const need = neededColours(run, g);
        const bit = slot >= 0 ? 1 << slot : 0;
        let ceiling = Infinity;
        if (slot >= 0) {
            ceiling = -1;
            const masks = run.searchMasks[slot];
            for (let j = 0; j < masks.length; j++) ceiling = Math.max(ceiling, fetchScore(masks[j], have, need));
        }
        let bi = -1;
        let bs = -1;
        for (let i = g.top; i < len; i++) {
            if (taken[i]) continue;
            const c = lib[i];
            if (slot >= 0 ? !(c.fmatch & bit) : !landMatches(c, r)) continue;
            const s = fetchScore(c.mask, have, need);
            if (s > bs) {
                bs = s;
                bi = i;
                if (s === ceiling) break;
            }
        }
        if (bi < 0) return;
        const c = lib[bi];
        takeAt(g, bi);
        if (toBattlefield) {
            const tapped = r.landsTapped || c.ltap === TAP.TAPPED || c.lbounce;
            putLand(g, c, tapped);
            if (!tapped) poolAdd(c.mask, c.lmana);
            if (notes) notes.push(c.name);
        } else {
            handPush(g, c);
            if (notes) notes.push(`${c.name} to hand`);
        }
    }
}

/** The first land (or basic land) in hand, or -1. */
function landInHandAt(g, basic) {
    for (let i = 0; i < g.handLen; i++) {
        const c = g.hand[i];
        if (c.land && (!basic || c.basic)) return i;
    }
    return -1;
}

/** Lands a search could still find, up to `want`. */
function landsAvailable(g, r, slot, want) {
    if (slot >= 0) return Math.min(want, g.found[slot]);
    let available = 0;
    for (let j = g.top; j < g.libLen && available < want; j++) if (!g.taken[j] && landMatches(g.lib[j], r)) available++;
    return available;
}

/**
 * The ramp piece to cast next: pieces that pay for themselves this turn first
 * (Sol Ring), then the most mana gained, then the cheapest — among those the
 * pool can pay for. Reads the game, changes nothing.
 * @returns {number} its index in hand, or -1 when nothing fits
 */
function pickRamp(run, g) {
    if (g.rampInHand === 0) return -1;
    const hand = g.hand;
    const n = g.handLen;
    const treasureOn = run.treasure;
    const use = g.useMask;
    let pickAt = -1;
    let pickScore = -Infinity;
    let landInHand = false;
    for (let i = 0; i < n; i++) if (hand[i].land) { landInHand = true; break; }
    for (let i = 0; i < n; i++) {
        const c = hand[i];
        if (!(c.rampUse & use)) continue;
        const r = c.rampInfo;
        let value = r.mana;
        if (r.lands || r.toHand) {
            const available = landsAvailable(g, r, searchSlot(run, c), r.lands + r.toHand);
            if (available === 0) continue;
            value += Math.min(r.lands, available) + Math.max(0, Math.min(r.toHand, available - r.lands)) * 0.5;
        }
        if (r.extraDrops) value += 0.6 * r.extraDrops;
        if (r.fromTop && !g.fromTop) value += 0.3;
        if (r.extraDropsOnce && landInHand && g.dropsUsed >= g.drops) value += 0.8;
        if (r.putLand && (r.putLandBasic ? landInHandAt(g, true) >= 0 : landInHand)) value += 0.8;
        if (treasureOn && r.treasure) value += 0.5 * r.treasure;
        value -= r.sacrificeLand;
        if (value <= 0) continue;
        const cost = c.playMv + r.extraCost;
        const now = (r.mana && r.ready === 'now' ? r.mana : 0) + (r.lands && !r.landsTapped ? r.lands : 0) - cost;
        const score = (now >= 0 ? 1e6 : 0) + Math.round(value * 100) * 100 - cost;
        if (score <= pickScore) continue;
        if (pay(c, r.extraCost) < 0) continue;
        pickAt = i;
        pickScore = score;
    }
    return pickAt;
}

/** Cast the ramp piece at hand index `at` (from pickRamp) and resolve it. */
function castRamp(run, g, at) {
    const hand = g.hand;
    const pick = hand[at];
    const r = pick.rampInfo;
    const t = g.t;
    g.treasures -= pay(pick, r.extraCost, true);
    handRemoveAt(g, at);
    if (g.firstCast && pick.rampIndex >= 0 && !g.firstCast[pick.rampIndex]) g.firstCast[pick.rampIndex] = t;
    const notes = g.entry ? [] : null;
    if (r.mana) {
        const ready = r.ready === 'now' ? t : t + 1;
        const s = g.srcLen++;
        g.srcMana[s] = r.mana;
        g.srcMask[s] = r.mask;
        g.srcReady[s] = ready;
        if (ready <= t) poolAdd(r.mask, r.mana);
    }
    if (r.sacrificeLand && g.landLen) {
        let worst = 0;
        for (let i = 1; i < g.landLen; i++) if (BITS[g.landCard[i].mask] < BITS[g.landCard[worst].mask]) worst = i;
        removeLandAt(g, worst);
    }
    if (r.lands || r.toHand) {
        const slot = searchSlot(run, pick);
        if (r.lands) fetchLands(run, g, r, slot, r.lands, true, notes);
        if (r.toHand) fetchLands(run, g, r, slot, r.toHand, false, notes);
    }
    if (r.extraDrops) { g.extraDrops += r.extraDrops; g.drops += r.extraDrops; }
    if (r.extraDropsOnce) g.drops += r.extraDropsOnce;
    if (r.fromTop) g.fromTop = true;
    if (r.putLand) {
        const landAt = landInHandAt(g, r.putLandBasic);
        if (landAt >= 0) {
            const c = hand[landAt];
            handRemoveAt(g, landAt);
            const tapped = r.putLandTapped || c.lbounce || entersTapped(g, c);
            putLand(g, c, tapped);
            if (!tapped) poolAdd(c.mask, c.lmana);
            if (notes) notes.push(c.name);
        }
    }
    if (run.treasure && r.treasure) {
        g.treasures += r.treasure;
        poolAdd(run.idMask, r.treasure, 1);
    }
    for (let k = 0; k < r.draws && g.top < g.libLen; k++) {
        const c = drawTop(g);
        handPush(g, c);
        seen(g, c);
    }
    if (g.entry) g.entry.cast.push({ name: pick.name, notes });
}

/**
 * Start a game from a dealt hand and library.
 * @param {Int32Array|null} found0 - the whole deck's search counts when the
 *   library is exactly the deck less the hand (a deal), else null to count it
 */
function resetGame(run, g, hand0, handLen, lib0, libLen, out, tracked, found0) {
    const use = run.useMask;
    let rampInHand = 0;
    for (let i = 0; i < handLen; i++) {
        g.hand[i] = hand0[i];
        if (hand0[i].rampUse & use) rampInHand++;
    }
    for (let i = handLen; i < g.handLen; i++) g.hand[i] = null;
    g.handLen = handLen;
    g.useMask = use;
    g.rampInHand = rampInHand;
    g.lib = lib0;
    g.libLen = libLen;
    g.taken.fill(0, 0, libLen);
    g.top = 0;
    if (found0) {
        g.found.set(found0);
        for (let i = 0; i < handLen; i++) uncount(g, hand0[i]);
    } else {
        g.found.fill(0);
        for (let i = 0; i < libLen; i++) for (let m = lib0[i].fmatch; m; m &= m - 1) g.found[lowBit(m)]++;
    }
    for (let i = 0; i < g.landLen; i++) g.landCard[i] = null;
    g.landLen = 0;
    g.landMask = 0;
    g.landTypes = 0;
    g.srcLen = 0;
    g.extraDrops = 0;
    g.drops = 0;
    g.dropsUsed = 0;
    g.fromTop = false;
    g.treasures = 0;
    g.floating = 0;
    g.floatingMask = 0;
    g.targetTurn = 0;
    g.targetTurns.fill(0);
    g.targetsLeft = run.targetCount;
    g.lastCard = null;
    g.entry = null;
    g.firstCast = tracked ? out.firstCast.fill(0) : null;
    g.firstSeen = tracked ? out.firstSeen.fill(0) : null;
    out.mana.fill(0);
    g.t = 1;
    for (let i = 0; i < handLen; i++) seen(g, g.hand[i]);
}

/** Copy a game mid-turn (the lands-only twin forks from the ramp game). */
function copyGame(src, dst) {
    const n = src.handLen;
    for (let i = 0; i < n; i++) dst.hand[i] = src.hand[i];
    dst.handLen = n;
    dst.useMask = src.useMask;
    dst.rampInHand = src.rampInHand;
    dst.lib = src.lib;
    dst.libLen = src.libLen;
    dst.taken.set(src.taken); // both games are sized to the same library
    dst.top = src.top;
    dst.found.set(src.found);
    const l = src.landLen;
    for (let i = 0; i < l; i++) {
        dst.landCard[i] = src.landCard[i];
        dst.landReady[i] = src.landReady[i];
    }
    dst.landLen = l;
    dst.landMask = src.landMask;
    dst.landTypes = src.landTypes;
    const s = src.srcLen;
    for (let i = 0; i < s; i++) {
        dst.srcMana[i] = src.srcMana[i];
        dst.srcMask[i] = src.srcMask[i];
        dst.srcReady[i] = src.srcReady[i];
    }
    dst.srcLen = s;
    dst.t = src.t;
    dst.extraDrops = src.extraDrops;
    dst.drops = src.drops;
    dst.dropsUsed = src.dropsUsed;
    dst.fromTop = src.fromTop;
    dst.treasures = src.treasures;
    dst.floating = src.floating;
    dst.floatingMask = src.floatingMask;
    dst.targetTurn = src.targetTurn;
    dst.targetTurns.set(src.targetTurns);
    dst.targetsLeft = src.targetsLeft;
    dst.lastCard = src.lastCard;
    dst.entry = null;
    dst.firstCast = null;
    dst.firstSeen = null;
}

/**
 * A turn up to its ramp: draw, land drops, then the pool (everything that
 * can tap now), the turn's mana and the target check.
 *
 * The pool is only built when something will pay from it this turn (the
 * target is not castable yet, or there is ramp to cast) or the turn is
 * logged; otherwise the turn's mana is just the sum it would hold.
 */
function beginTurn(run, g, t, log, mana, rampOn) {
    g.t = t;
    const entry = log ? { turn: t, drew: null, lands: [], cast: [], mana: 0, colors: 0, target: false, castable: [], landsInPlay: 0 } : null;
    g.entry = entry;
    g.floating = 0;
    g.floatingMask = 0;
    if (!(t === 1 && run.skipFirstDraw) && g.top < g.libLen) {
        const c = drawTop(g);
        handPush(g, c);
        seen(g, c);
        if (entry) entry.drew = c.name;
    }
    g.drops = 1 + g.extraDrops;
    g.dropsUsed = 0;
    while (g.dropsUsed < g.drops && playLand(run, g)) g.dropsUsed++;

    if (!entry && !g.targetsLeft && !(rampOn && g.rampInHand > 0)) {
        mana[t] = Math.min(MAX_MANA, readyMana(g));
        return;
    }
    poolReset();
    for (let i = 0; i < g.landLen; i++) if (g.landReady[i] <= t) poolAdd(g.landCard[i].mask, g.landCard[i].lmana);
    for (let i = 0; i < g.srcLen; i++) if (g.srcReady[i] <= t) poolAdd(g.srcMask[i], g.srcMana[i]);
    if (g.floating) poolAdd(g.floatingMask, g.floating);
    if (g.treasures) poolAdd(run.idMask, g.treasures, 1);
    mana[t] = Math.min(MAX_MANA, poolSize);
    if (entry) { entry.mana = poolSize; entry.colors = poolUnion; }
    checkTarget(run, g);
}

/**
 * Greedy ramp: cast until nothing fits (at most 20 pieces a turn), playing
 * any land drop the ramp found or freed up, checking the target after each.
 * @param {number} first - a pick already made for the first cast, or -2 to choose
 */
function rampPhase(run, g, first) {
    for (let guard = 0; guard < 20; guard++) {
        const at = guard === 0 && first !== -2 ? first : pickRamp(run, g);
        if (at < 0) return;
        castRamp(run, g, at);
        while (g.dropsUsed < g.drops) {
            const played = playLand(run, g);
            if (!played) break;
            g.dropsUsed++;
            if (played === 2) poolAdd(g.lastCard.mask, g.lastCard.lmana);
        }
        checkTarget(run, g);
    }
}

function endTurn(g, log) {
    g.treasures = Math.max(0, g.treasures);
    if (g.entry) {
        g.entry.landsInPlay = g.landLen;
        log.turns.push(g.entry);
        g.entry = null;
    }
}

/** Copy a finished game's target turns into its outcome. */
function settle(g, out) {
    out.targetTurn = g.targetTurn;
    out.targetTurns.set(g.targetTurns);
}

/**
 * Play one goldfish game from a dealt hand into `out`.
 * @param {Object} run - simulator settings (see createRun)
 * @param {Game} g - reusable game state
 * @param {Object[]} hand0 - the kept hand (first handLen entries)
 * @param {Object[]} lib0 - the library, top first (first libLen entries; read-only)
 * @param {boolean} rampOn - false: every ramp card is a blank (lands only)
 * @param {Object|null} log - collects a turn-by-turn record when given
 * @param {{mana:Uint8Array, targetTurn:number, firstCast:Int8Array, firstSeen:Int8Array}} out
 */
function playGame(run, g, hand0, handLen, lib0, libLen, rampOn, log, out) {
    resetGame(run, g, hand0, handLen, lib0, libLen, out, rampOn && run.rampCount > 0, null);
    for (let t = 1; t <= SIM_TURNS; t++) {
        beginTurn(run, g, t, log, out.mana, rampOn);
        if (rampOn) rampPhase(run, g, -2);
        endTurn(g, log);
    }
    settle(g, out);
    return out;
}

/**
 * The dealt game twice: with ramp into run.withRamp, lands only into
 * run.landsOnly. The two are the same game until the first ramp spell, so the
 * lands-only twin is forked from the ramp game at that moment (and is a copy
 * of it when no ramp is ever cast) instead of being replayed from turn 1.
 */
function playPair(run, log) {
    const g = run.game;
    const a = run.withRamp;
    const b = run.landsOnly;
    resetGame(run, g, run.dealHand, run.dealHandLen, run.dealLib, run.dealLibLen, a, run.rampCount > 0, run.found0);
    let fork = 0;
    for (let t = 1; t <= SIM_TURNS; t++) {
        beginTurn(run, g, t, log, a.mana, true);
        let first = -2;
        if (!fork) {
            first = pickRamp(run, g);
            if (first >= 0) {
                copyGame(g, run.twin);
                fork = t;
            }
        }
        if (first !== -1) rampPhase(run, g, first);
        endTurn(g, log);
    }
    settle(g, a);
    b.mana.set(a.mana);
    b.targetTurn = a.targetTurn;
    b.targetTurns.set(a.targetTurns);
    if (!fork) return;
    // The twin stands where the ramp game cast its first ramp spell: it ends
    // that turn without ramp and plays the rest with lands only.
    const twin = run.twin;
    endTurn(twin, null);
    for (let t = fork + 1; t <= SIM_TURNS; t++) {
        beginTurn(run, twin, t, null, b.mana, false);
        endTurn(twin, null);
    }
    settle(twin, b);
}

// ── Many games ──────────────────────────────────────────────────────────────

/**
 * Set up a simulation. Run it in one go with simulateManaDevelopment(), or in
 * slices with runBatch() so a page can yield to the browser between them.
 *
 * @param {Object} lib - buildManaLibrary() / buildCountsLibrary() output
 * @param {{format?:Object, onPlay?:boolean, treasure?:boolean, games?:number, seed?:number, samples?:number}} [opts]
 */
export function createRun(lib, { format = null, onPlay = true, treasure = false, games = DEFAULT_GAMES, seed = SEED, samples = SAMPLE_GAMES } = {}) {
    const T = SIM_TURNS;
    const cards = lib?.cards ?? [];
    const rampCount = lib?.ramp?.length ?? 0;
    // Every commander is a target; the primary one (the most expensive) leads.
    const targets = (lib?.targets?.length ? lib.targets : lib?.target ? [lib.target] : []).slice(0, MAX_TARGETS);
    const targetCards = targets.map(t => t.card);
    // Land-search counts over the whole deck: a dealt library is the deck less the hand.
    const found0 = new Int32Array(MAX_SEARCHES);
    for (const c of cards) for (let m = c.fmatch; m; m &= m - 1) found0[lowBit(m)]++;
    const mk = () => ({
        hist: Array.from({ length: T + 1 }, () => new Int32Array(MAX_MANA + 1)),
        // first[t][k]: games that first had k+ mana on turn t
        first: Array.from({ length: T + 1 }, () => new Int32Array(MAX_MANA + 1)),
        // games whose target was first castable on turn t (T + 1: not by turn T)
        target: new Int32Array(T + 2),
        targets: targets.map(() => new Int32Array(T + 2)),
        all: new Int32Array(T + 2) // …every target castable (each at least once)
    });
    return {
        lib,
        cards,
        target: lib?.target ?? null,
        targets,
        targetCards,
        targetCount: targets.length,
        primary: Math.max(0, targets.indexOf(lib?.target)),
        targetPips: targetCards.reduce((m, c) => c.pips.reduce((x, p) => x | p, m), 0),
        searchSlot: lib?.searchSlot && lib?.searchMasks ? lib.searchSlot : null,
        searchMasks: lib?.searchMasks ?? [],
        idMask: lib?.idMask ?? 0,
        rampCount,
        treasure: Boolean(treasure),
        useMask: treasure ? USE_RAMP | USE_TREASURE : USE_RAMP,
        found0,
        freeMulligan: Boolean(format?.freeMulligan),
        skipFirstDraw: Boolean(onPlay) && !format?.firstPlayerDraws,
        games: Math.max(0, Math.floor(games) || 0),
        samples,
        rng: mulberry32(seed),
        idx: new Int32Array(cards.length),
        seven: new Array(OPENING_HAND).fill(null),
        dealHand: new Array(OPENING_HAND).fill(null),
        dealHandLen: 0,
        dealLib: new Array(cards.length).fill(null),
        dealLibLen: 0,
        game: new Game(cards.length),
        twin: new Game(cards.length),
        withRamp: newOutcome(rampCount),
        landsOnly: newOutcome(rampCount),
        done: 0,
        ramp: mk(),
        lands: mk(),
        savedSum: 0,
        savedBy: new Float64Array(targets.length),
        savedAll: 0,
        mulligans: 0,
        castBy3: new Int32Array(rampCount),
        castBy4: new Int32Array(rampCount),
        seenBy4: new Int32Array(rampCount),
        sampleGames: []
    };
}

/** The turn every target had been castable by (SIM_TURNS + 1: not all of them in time). */
function allTargetsTurn(res, count) {
    let last = 0;
    for (let i = 0; i < count; i++) last = Math.max(last, res.targetTurns[i] || SIM_TURNS + 1);
    return last;
}

function record(acc, res, count) {
    let best = -1;
    for (let t = 1; t <= SIM_TURNS; t++) {
        const m = res.mana[t];
        acc.hist[t][m]++;
        if (m > best) {
            const row = acc.first[t];
            for (let k = best + 1; k <= m; k++) row[k]++;
            best = m;
        }
    }
    acc.target[res.targetTurn || SIM_TURNS + 1]++;
    for (let i = 0; i < count; i++) acc.targets[i][res.targetTurns[i] || SIM_TURNS + 1]++;
    if (count > 1) acc.all[allTargetsTurn(res, count)]++;
}

/**
 * Play up to `count` more games. Returns true when the run is complete.
 */
export function runBatch(run, count = run.games) {
    if (run.cards.length < OPENING_HAND) { run.done = run.games; return true; }
    const end = Math.min(run.games, run.done + Math.max(1, count));
    const cap = SIM_TURNS + 1;
    for (let gi = run.done; gi < end; gi++) {
        const mulligans = dealInto(run);
        run.mulligans += mulligans > (run.freeMulligan ? 1 : 0) ? 1 : 0;
        let log = null;
        if (run.sampleGames.length < run.samples) {
            const hand = [];
            for (let i = 0; i < run.dealHandLen; i++) hand.push(run.dealHand[i].name);
            log = { hand, mulligans, turns: [] };
        }
        playPair(run, log);
        const withRamp = run.withRamp;
        const landsOnly = run.landsOnly;
        const nT = run.targetCount;
        record(run.ramp, withRamp, nT);
        record(run.lands, landsOnly, nT);
        run.savedSum += (landsOnly.targetTurn || cap) - (withRamp.targetTurn || cap);
        for (let i = 0; i < nT; i++) run.savedBy[i] += (landsOnly.targetTurns[i] || cap) - (withRamp.targetTurns[i] || cap);
        if (nT > 1) run.savedAll += allTargetsTurn(landsOnly, nT) - allTargetsTurn(withRamp, nT);
        if (run.rampCount) {
            for (let i = 0; i < run.rampCount; i++) {
                const c = withRamp.firstCast[i];
                if (c && c <= 3) run.castBy3[i]++;
                if (c && c <= 4) run.castBy4[i]++;
                const s = withRamp.firstSeen[i];
                if (s && s <= 4) run.seenBy4[i]++;
            }
        }
        if (log) {
            log.targetTurn = withRamp.targetTurn;
            log.landsOnlyTargetTurn = landsOnly.targetTurn;
            log.targetTurns = Array.from(withRamp.targetTurns.subarray(0, nT));
            log.landsOnlyTargetTurns = Array.from(landsOnly.targetTurns.subarray(0, nT));
            run.sampleGames.push(log);
        }
    }
    run.done = end;
    return run.done >= run.games;
}

/**
 * Percentile of a histogram of `total` games (the shared nearest-rank rule in
 * stats.js — never the sampled maximum), or null when there are no games.
 */
export function percentile(hist, total, p) {
    if (!(total > 0)) return null;
    return quantile(hist, p);
}

function bands(acc, games) {
    const out = [];
    for (let t = 1; t <= SHOWN_TURNS; t++) {
        const h = acc.hist[t];
        out.push({
            turn: t,
            p10: percentile(h, games, 0.1),
            p25: percentile(h, games, 0.25),
            p50: percentile(h, games, 0.5),
            p75: percentile(h, games, 0.75),
            p90: percentile(h, games, 0.9)
        });
    }
    return out;
}

/** reach[t][k] = chance to have had k+ mana on some turn up to t. */
function reachTable(acc, games) {
    const out = [new Array(MAX_MANA + 1).fill(0)];
    const cum = new Int32Array(MAX_MANA + 1);
    for (let t = 1; t <= SIM_TURNS; t++) {
        for (let k = 0; k <= MAX_MANA; k++) cum[k] += acc.first[t][k];
        out.push(Array.from(cum, n => (games ? n / games : 0)));
    }
    return out;
}

/** First turn the chance of having reached k mana is at least p (null = later than simulated). */
export function turnToReach(reach, k, p = 0.5) {
    for (let t = 1; t < reach.length; t++) if ((reach[t]?.[k] ?? 0) >= p) return t;
    return null;
}

function targetStats(hist, games, mv) {
    if (!games) return null;
    const by = [0];
    let cum = 0;
    for (let t = 1; t <= SIM_TURNS + 1; t++) {
        cum += hist[t];
        by.push(cum / games);
    }
    const onCurveTurn = Math.max(1, Math.min(SIM_TURNS, mv || 1));
    return {
        castBy: by, // castBy[t] = chance it's castable by turn t (t ≤ SIM_TURNS)
        onCurveTurn,
        onCurve: by[onCurveTurn],
        p25: percentile(hist, games, 0.25),
        median: percentile(hist, games, 0.5),
        p75: percentile(hist, games, 0.75),
        p90: percentile(hist, games, 0.9),
        within: by[SIM_TURNS]
    };
}

function allStats(run, games) {
    const mv = run.targets.reduce((m, t) => Math.max(m, t.mv), 0);
    return {
        count: run.targetCount,
        mv,
        ramp: targetStats(run.ramp.all, games, mv),
        lands: targetStats(run.lands.all, games, mv),
        turnsSaved: run.savedAll / games
    };
}

/** Turn the accumulated games into the page's numbers. */
export function finishRun(run) {
    const games = run.done;
    if (!games || run.cards.length < OPENING_HAND) return null;
    const lib = run.lib;
    const target = run.target;
    const ramp = (lib.ramp ?? []).map((r, i) => {
        const role = rampRole(r.info, { treasure: run.treasure });
        return {
            name: r.name,
            count: r.count,
            mv: r.mv,
            info: r.info,
            role,
            counted: role === 'counted',
            castBy3: run.castBy3[i] / games,
            castBy4: run.castBy4[i] / games,
            seenBy4: run.seenBy4[i] / games
        };
    });
    const copies = role => ramp.filter(r => r.role === role).reduce((s, r) => s + r.count, 0);
    return {
        games,
        lands: lib.landCount,
        librarySize: run.cards.length,
        placeholder: Boolean(lib.placeholder),
        // counted + notCounted is the ramp count every other page shows.
        rampCount: copies('counted'),
        notCounted: copies('ramp'),
        notRamp: copies('helps'),
        treasure: run.treasure,
        mana: bands(run.ramp, games),
        landsOnly: bands(run.lands, games),
        reach: reachTable(run.ramp, games),
        reachLands: reachTable(run.lands, games),
        target: target ? {
            kind: target.kind,
            name: target.name,
            names: target.names,
            mv: target.mv,
            cost: target.cost,
            ramp: targetStats(run.ramp.target, games, target.mv),
            lands: targetStats(run.lands.target, games, target.mv),
            turnsSaved: run.savedSum / games
        } : null,
        // Every target (each commander), in deck order; the primary one is `target` above.
        targets: run.targets.map((t, i) => ({
            kind: t.kind,
            name: t.name,
            mv: t.mv,
            cost: t.cost,
            primary: i === run.primary,
            ramp: targetStats(run.ramp.targets[i], games, t.mv),
            lands: targetStats(run.lands.targets[i], games, t.mv),
            turnsSaved: run.savedBy[i] / games
        })),
        // Every commander castable, each at least once (two or more commanders only):
        // the per-game latest of their turns. On curve = by the most expensive one's turn.
        all: run.targetCount > 1 ? allStats(run, games) : null,
        missingCommanders: lib.missingCommanders ?? [],
        mulliganRate: run.mulligans / games,
        ramp,
        samples: run.sampleGames
    };
}

/**
 * Play one scripted game from a given hand and library order — no shuffle, no
 * mulligan. For tests, and for checking what the model does with a hand.
 * @param {Object} lib - buildManaLibrary() output
 * @param {{hand:Object[], library:Object[], format?:Object, onPlay?:boolean, treasure?:boolean, rampOn?:boolean}} opts
 * @returns {{mana:number[], targetTurn:number, targetTurns:number[], log:Object}} mana[t] for t = 1…SIM_TURNS (index 0 unused);
 *   targetTurns: each target's first castable turn (0 = not by SIM_TURNS)
 */
export function playScriptedGame(lib, { hand = [], library = [], format = null, onPlay = true, treasure = false, rampOn = true } = {}) {
    const run = createRun(lib, { format, onPlay, treasure, games: 0 });
    const log = { hand: hand.map(c => c.name), mulligans: 0, turns: [] };
    const game = new Game(hand.length + library.length + run.cards.length);
    const res = playGame(run, game, hand, hand.length, library, library.length, rampOn, log, newOutcome(run.rampCount));
    return { mana: Array.from(res.mana), targetTurn: res.targetTurn, targetTurns: Array.from(res.targetTurns.subarray(0, run.targetCount)), log };
}

/** Run everything synchronously (tests, workers, small decks). */
export function simulateManaDevelopment(lib, opts = {}) {
    const run = createRun(lib, opts);
    runBatch(run, run.games);
    return finishRun(run);
}

// ── Words ────────────────────────────────────────────────────────────────────

/**
 * One row per commander (deck order) and a last row for all of them together
 * — the page's commanders table, for decks with two or more. Each says when
 * the commander is usually castable (the middle half of games), its on-curve
 * chance, and the same for lands alone. Empty with one commander or none.
 * @param {Object|null} r - finishRun() output
 * @returns {Array<{name:string|null, cost:string, mv:number, primary:boolean, all:boolean,
 *   onCurve:number, onCurveTurn:number, when:string, landsOnCurve:number, landsWhen:string, saved:number}>}
 */
export function commanderRows(r) {
    if (!r?.all || (r.targets?.length ?? 0) < 2) return [];
    const row = (x, extra) => ({
        cost: '', primary: false, all: false, ...extra,
        mv: x.mv,
        onCurve: x.ramp.onCurve,
        onCurveTurn: x.ramp.onCurveTurn,
        when: turnRange(x.ramp.p25, x.ramp.p75),
        landsOnCurve: x.lands.onCurve,
        landsWhen: turnRange(x.lands.p25, x.lands.p75),
        saved: x.turnsSaved
    });
    return [
        ...r.targets.map(x => row(x, { name: x.name, cost: x.cost, primary: x.primary })),
        row(r.all, { name: null, all: true })
    ];
}

/** "a", "a and b", "a, b and c". */
function listWords(items) {
    return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "turn 5", "turn 5 or 6", "turns 5–7", "after turn 12". */
export function turnRange(lo, hi) {
    const cap = SIM_TURNS + 1;
    if (lo == null) return 'never';
    if (lo >= cap) return `after turn ${SIM_TURNS}`;
    if (hi == null || hi >= cap) return `turn ${lo} or later`;
    if (lo === hi) return `turn ${lo}`;
    if (hi === lo + 1) return `turn ${lo} or ${hi}`;
    return `turns ${lo}–${hi}`;
}

/** "about 1.5 turns", "about half a turn", "less than a quarter of a turn". */
export function turnsWord(x) {
    if (!Number.isFinite(x)) return '';
    if (x < 0.25) return 'less than a quarter of a turn';
    if (x < 0.75) return 'about half a turn';
    const r = Math.round(x * 2) / 2;
    return `about ${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)} turn${r === 1 ? '' : 's'}`;
}

/**
 * The page's bottom line, built from the numbers so it can't drift from them.
 * @param {Object|null} r - finishRun() output
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(r) {
    if (!r) return { html: 'Load a deck with at least seven cards to see how its mana develops.', tone: 'flat' };
    const check = r.mana[CHECK_TURN - 1];
    const typical = check?.p50 ?? 0;
    const opener = r.placeholder
        ? `With <strong>${r.lands}</strong> ${plural(r.lands, 'land')} and no decklist`
        : `With <strong>${r.lands}</strong> ${plural(r.lands, 'land')} and <strong>${r.rampCount}</strong> ${plural(r.rampCount, 'ramp piece')}`;
    let html = `${opener} you typically have <strong>${typical} mana on turn ${CHECK_TURN}</strong>`;
    const t = r.target;
    // Two or more commanders: each gets its own turn, and "both" carries the tone and the saving.
    const all = r.all?.ramp && (r.targets?.length ?? 0) > 1 ? r.all : null;
    let tone = 'flat';
    if (all) {
        const each = r.targets.slice().sort((a, b) => a.mv - b.mv).map(x => (x.ramp.median > SIM_TURNS
            ? `${cardRef(x.name)} not until after <strong>turn ${SIM_TURNS}</strong>`
            : `${cardRef(x.name)} on <strong>${turnRange(x.ramp.p25, x.ramp.p75)}</strong>`));
        html += ` and can cast ${listWords(each)}`;
        const p = all.ramp.onCurve;
        tone = p >= 0.6 ? 'good' : p >= 0.35 ? 'warn' : 'bad';
    } else if (t?.ramp) {
        const who = t.kind === 'commander' ? cardRef(t.name) : `your top end (${cardRef(t.name)}, ${t.mv} mana)`;
        const when = turnRange(t.ramp.p25, t.ramp.p75);
        html += t.ramp.median > SIM_TURNS
            ? ` and usually can’t cast ${who} by <strong>turn ${SIM_TURNS}</strong>`
            : ` and can cast ${who} on <strong>${when}</strong>`;
        const p = t.ramp.onCurve;
        tone = p >= 0.6 ? 'good' : p >= 0.35 ? 'warn' : 'bad';
    }
    if (r.placeholder) {
        html += '. Import a decklist to count ramp and colours.';
    } else if (r.rampCount === 0) {
        html += ' — the model found no ramp it can count, so this is your lands alone.';
    } else if (all) {
        const saved = all.turnsSaved;
        const them = all.count === 2 ? 'both' : `all ${all.count}`;
        html += saved >= 0.25
            ? ` — ramp has ${them} castable <strong>${turnsWord(saved)}</strong> sooner than lands alone.`
            : ` — your ramp barely changes when ${them} come down (${turnsWord(Math.max(0, saved))} sooner than lands alone).`;
    } else if (t?.ramp) {
        const saved = t.turnsSaved;
        html += saved >= 0.25
            ? ` — ramp saves you <strong>${turnsWord(saved)}</strong> over lands alone.`
            : ` — your ramp barely changes when it comes down (${turnsWord(Math.max(0, saved))} sooner than lands alone).`;
    } else {
        html += '.';
    }
    return { html, tone };
}

/** Colour mask → "G U" pips for the sample games (HTML). */
export function manaPips(mask) {
    return COLORS.filter(c => mask & COLOR_BIT[c])
        .map(c => `<span class="ms ms-${c.toLowerCase()}" aria-hidden="true">${c}</span>`).join('');
}

/** One sample-game turn as plain HTML (names through cardRef). */
export function describeTurn(entry) {
    const bits = [];
    if (entry.lands.length) bits.push(entry.lands.map(n => cardRef(n)).join(', '));
    for (const c of entry.cast) {
        const found = c.notes.length ? ` <span class="md-found">→ ${c.notes.map(n => escapeHtml(n)).join(', ')}</span>` : '';
        bits.push(`${cardRef(c.name)}${found}`);
    }
    return bits.join(' · ') || '<span class="md-quiet">no land, no ramp</span>';
}
