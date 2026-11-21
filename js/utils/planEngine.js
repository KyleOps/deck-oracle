/**
 * Game Plan engine — goldfish games played towards a plan (planSchema.js).
 *
 * Each game: shuffle, London mulligan with a plan-aware keep rule, then turn
 * by turn: untap, draw (Commander: everyone draws on turn one; 60/40 cards:
 * not on the play), main-phase triggers, land drop(s), then the casting
 * policy until nothing more can be cast. Cards are read once into "plan
 * cards" (toPlanCard): lands through manaDevelopment's classifyLand, ramp
 * through ramp.js, and anything the board changes through a card rule
 * (planRules.js) — Selvala's different powers, Fanatic's Ferocious, Priest's
 * Elves, Bloom Tender's colours, Badgermole Cub's extra {G}, Jadzia's
 * counters, the Doctor's copies.
 *
 * Mana. Every source (land, rock, creature, Treasure, floating mana) is
 * worked out from the board at the moment you pay, so a creature cast this
 * turn (and Selvala's Mercenary) raises what the untapped sources make.
 * Paying matches each coloured pip to a distinct unit of mana (backtracking),
 * then takes generic from the least valuable units: floating mana, lands,
 * fixed sources, then sources whose output can still grow, Treasure last.
 * A tapped source's unused mana floats for the rest of the main phase.
 * Summoning sickness, haste and enters-tapped are tracked per permanent;
 * power is base + counters, so power-based rules are exact.
 *
 * "Mana on turn T" is everything you made that turn: what you spent plus
 * what you could still make, after your land drop — so a rock cast that turn
 * counts. It is what a "have X mana" step checks.
 *
 * The casting policy, each pass: the earliest unmet step that is still on
 * time (then late ones), if it can be done now; otherwise the best ramp it
 * can afford (cards a pending "package" step needs stay in hand); otherwise
 * it holds. A step met early counts as on time.
 *
 * Rules API — what card-rule hooks may call on the game (planRules.js):
 *   turn, powerOf(perm), isCreature(perm), distinctPowers(), controlsPower(n),
 *   countSubtype(word), colorsAmongPermanents(), devotion(mask),
 *   addMana(mask, n), addCounters(perm, n), createToken(spec),
 *   fetchLand(filter, {tapped, toHand}), earthbend(n), copySpell(card),
 *   oncePerTurn(perm), note(text).
 * A permanent (`perm`) has `card` (its plan card), `counters`, `tapped`,
 * `token` and `animated` (a land made a creature).
 *
 * Deterministic for a seed; pure and DOM-free (tests/models/plan.node.test.js).
 */

import { asLibrary, commandersOf, isLibrary, sameCard, nameKey, cardTypes, frontTypeLine } from './library.js';
import { mulberry32, shuffle } from './random.js';
import { quantile } from './stats.js';
import { classifyRamp, basicTypesIn, typeBits, stripReminder } from './ramp.js';
import { classifyLand, TAP } from './manaDevelopment.js';
import { toLabCard, identityOf, maskOf, assignPips, OPENING_HAND, MIN_HAND, libraryKey, buildPlaceholderLibrary } from './handLab.js';
import { cardRule, MODE, ANY } from './planRules.js';
import { normalizePlan, compileGroup, planKey } from './planSchema.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_TURNS = 12;
export const DEFAULT_GAMES = 5000;
/** Fixed seed: the same deck and plan always give the same numbers. */
export const SEED = 0x706c616e;
export const SAMPLE_GAMES = 4;
/** Mana tracked per turn; anything above counts as this much. */
export const MAX_MANA = 40;

/** The keep rule: lands in range, plus (kind 'plan') the first step within reach. */
export const DEFAULT_KEEP = Object.freeze({ kind: 'plan', minLands: 2, maxLands: 4 });

/** Why a step missed its turn (stored with the colour it lacked in bits 8+). */
export const REASON = Object.freeze({ NONE: 0, NO_CARD: 1, LAND: 2, MANA: 3, COLOUR: 4, AFTER: 5, NO_PACKAGE: 6, SHORT: 7, OTHER: 8 });

const CAST = 1;
const MANA = 2;
const PACKAGE = 3;
const KIND = Object.freeze({ cast: CAST, mana: MANA, package: PACKAGE });

const BITS = Int8Array.from({ length: 32 }, (_, m) => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; });
const lowBit = m => m & -m;

/** Validate a keep rule. */
export function normalizeKeep(keep = {}) {
    const minLands = Math.min(7, Math.max(0, Math.floor(Number(keep?.minLands ?? DEFAULT_KEEP.minLands)) || 0));
    const maxRaw = Math.floor(Number(keep?.maxLands ?? DEFAULT_KEEP.maxLands));
    const maxLands = Math.min(7, Math.max(minLands, Number.isFinite(maxRaw) ? maxRaw : DEFAULT_KEEP.maxLands));
    return { kind: keep?.kind === 'lands' ? 'lands' : 'plan', minLands, maxLands };
}

// ── Cards ────────────────────────────────────────────────────────────────────

function stat(value) {
    const s = String(value ?? '').trim();
    if (!s || /[*xX?]/.test(s)) return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
}

/** A fetchland's search: {kind 0 any | 1 basic | 2 basic types, bits, tapped} or null. */
function fetchOf(record) {
    const text = stripReminder(String(record?.oracle_text ?? '').toLowerCase());
    const m = text.match(/sacrifice (?:this land|[^:.]*?): search your library for an? ([a-z ,/]+?) cards?, put (?:it|that card) onto the battlefield( tapped)?/);
    if (!m) return null;
    const types = basicTypesIn(m[1]);
    const basic = /\bbasic\b/.test(m[1]);
    return Object.freeze({ kind: basic ? 1 : types.length ? 2 : 0, bits: typeBits(types), tapped: Boolean(m[2]) });
}

function hasKeyword(text, word) {
    return text.split('\n').some(line => new RegExp(`^(?:[a-z ]+, )*${word}(?:,|$| \\(|\\.)`).test(line.trim()));
}

/**
 * A card as the engine reads it: one object per distinct card, shared by its
 * copies. Every card has every field, in the same order.
 * @param {Object} record - Scryfall-shaped card record
 * @param {string[]} identity - deck colour identity
 * @param {{multiplayer?:boolean, commander?:boolean}} [opts]
 */
export function toPlanCard(record, identity, { multiplayer = true, commander = false } = {}) {
    const lab = toLabCard(record, 0, identity);
    const front = frontTypeLine(record?.type_line);
    const types = cardTypes(record?.type_line);
    const subtypes = ` ${(front.split(/\s[—-]\s/)[1] ?? '').trim()} `;
    const text = stripReminder(String(record?.oracle_text ?? '').toLowerCase());
    const land = lab.land;
    const l = land ? classifyLand(record, { multiplayer }) : null;
    const ramp = land ? null : classifyRamp(record, { identity });
    const rule = land ? null : cardRule(record);
    const legendary = /\blegendary\b/.test(front);
    const saga = /\bsaga\b/.test(subtypes);
    const colors = Array.isArray(record?.colors) ? maskOf(record.colors) : lab.pips.reduce((m, p) => m | p, 0);
    const manaSource = !land && Boolean(rule?.manaSource || rule?.mana || (ramp?.modelled && ramp.mana > 0));
    return {
        name: String(record?.name ?? ''),
        key: nameKey(record?.name),
        record,
        commander,
        token: false,
        treasure: false,
        placeholder: false,
        land,
        mv: lab.mv,
        playMv: lab.playMv,
        cost: lab.cost,
        pips: lab.pips,
        pipUnion: lab.pips.reduce((m, p) => m | p, 0),
        mask: lab.mask,
        colors,
        creature: types.includes('creature'),
        artifact: types.includes('artifact'),
        enchantment: types.includes('enchantment'),
        planeswalker: types.includes('planeswalker'),
        battle: types.includes('battle'),
        instant: types.includes('instant'),
        sorcery: types.includes('sorcery'),
        permanent: lab.permanent,
        legendary,
        saga,
        historic: !land && (types.includes('artifact') || legendary || saga),
        subtypes,
        power: stat(record?.power),
        toughness: stat(record?.toughness),
        haste: hasKeyword(text, 'haste') || Boolean(rule?.haste),
        lmana: l ? l.mana : 0,
        ltap: l ? l.tap : TAP.UNTAPPED,
        lcheckBits: typeBits(l?.checkTypes ?? []),
        typeBits: land ? typeBits(basicTypesIn(front)) : 0,
        basic: land && /\bbasic\b/.test(front),
        lbounce: l ? l.bounce : false,
        fetch: land ? fetchOf(record) : null,
        ramp,
        rule,
        manaSource,
        isRamp: !land && Boolean(ramp?.ramp || manaSource || rule?.rampValue > 0),
        landsFetched: ramp ? ramp.lands + ramp.toHand : 0,
        entersTapped: !land && (ramp?.ready === 'tapped' || /\benters tapped\b/.test(text))
    };
}

const tokenCache = new Map();

/** A token's card (the rules API's createToken spec → a plan card). */
function tokenCard(spec) {
    const key = `${spec.name}|${spec.power}|${spec.toughness}|${spec.colors}|${spec.types}|${spec.subtypes}`;
    let card = tokenCache.get(key);
    if (card) return card;
    const types = String(spec.types ?? 'creature').toLowerCase();
    card = {
        ...toPlanCard({ name: spec.name, type_line: `Token ${types}` }, []),
        token: true,
        creature: /\bcreature\b/.test(types),
        artifact: /\bartifact\b/.test(types),
        permanent: true,
        historic: false,
        colors: spec.colors | 0,
        subtypes: ` ${String(spec.subtypes ?? '').toLowerCase()} `,
        power: Number.isFinite(spec.power) ? spec.power : 0,
        toughness: Number.isFinite(spec.toughness) ? spec.toughness : 0,
        rule: spec.rule ?? null,
        manaSource: false,
        isRamp: false
    };
    tokenCache.set(key, card);
    return card;
}

const TREASURE = tokenCard({ name: 'Treasure', types: 'artifact', colors: 0 });
TREASURE.treasure = true;

// ── Library ──────────────────────────────────────────────────────────────────

function zoneOf(deck, library, records) {
    if (!library.commanders.length) return [];
    const known = (records ?? (isLibrary(deck) ? [] : commandersOf(deck).map(c => c.card))).filter(Boolean);
    return library.commanders.map(name => ({ name, card: known.find(c => sameCard(c.name, name)) ?? null }));
}

/**
 * The deck as the engine plays it: one plan card per copy in the library,
 * the commanders (cast from the command zone, never drawn), the colour
 * identity and a cache key.
 * @param {Object} deck - a DeckConfig snapshot, a Library, or a cardsByName map
 * @param {{format?:Object|string, commanders?:string[], commanderCards?:Array<Object|null>, multiplayer?:boolean}} [opts]
 */
export function buildPlanLibrary(deck = {}, { format, commanders, commanderCards, multiplayer = true } = {}) {
    const library = asLibrary(deck, { format, commanders });
    const zone = zoneOf(deck, library, commanderCards);
    const identity = identityOf(library.cards, zone.map(c => c.card).filter(Boolean));
    const cards = [];
    const distinct = [];
    for (const record of library.cards) {
        const card = toPlanCard(record, identity, { multiplayer });
        distinct.push(card);
        for (let i = 0; i < record.count; i++) cards.push(card);
    }
    const zoneCards = zone.filter(c => c.card && !isLandRecord(c.card)).map(c => toPlanCard(c.card, identity, { multiplayer, commander: true }));
    return {
        cards,
        distinct,
        commanders: zoneCards,
        missingCommanders: zone.filter(c => !c.card).map(c => c.name),
        identity,
        idMask: maskOf(identity),
        landCount: cards.filter(c => c.land).length,
        placeholder: false,
        key: `${library.key}|${zoneCards.map(c => c.key).join('+')}|${multiplayer ? 'm' : 's'}`
    };
}

function isLandRecord(record) {
    return cardTypes(record?.type_line).includes('land');
}

/** Stand-ins for a deck entered as bare type counts: colourless lands and costless spells. */
export function buildPlanCountsLibrary(counts = {}) {
    const built = buildPlaceholderLibrary(counts);
    const land = { ...toPlanCard({ name: 'Land', type_line: 'Land' }, []), lmana: 1, placeholder: true };
    const spell = { ...toPlanCard({ name: 'Spell', type_line: 'Sorcery' }, []), placeholder: true };
    const cards = built.cards.map(c => (c.land ? land : spell));
    return {
        cards, distinct: [land, spell], commanders: [], missingCommanders: [], identity: [], idMask: 0,
        landCount: cards.filter(c => c.land).length, placeholder: true, key: `counts:${libraryKey(built.cards)}`
    };
}

/** The plan card for a name in a built library (commanders included), or null. */
export function findPlanCard(lib, name) {
    const key = nameKey(name);
    return lib?.commanders?.find(c => c.key === key) ?? lib?.distinct?.find(c => c.key === key) ?? null;
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** A plan's steps compiled for the engine (group predicates built once). */
export function compileSteps(plan) {
    return normalizePlan(plan).steps.map((s, index) => {
        const r = s.require;
        return {
            index,
            turn: s.turn,
            kind: KIND[r.kind],
            atLeast: r.kind === 'mana' ? r.atLeast : 0,
            match: r.kind === 'cast' ? compileGroup(r.group) : null,
            after: r.kind === 'cast' && r.after ? compileGroup(r.after) : null,
            options: r.kind === 'package' ? r.options.map(o => ({ count: o.count, match: compileGroup(o.group) })) : [],
            step: s
        };
    });
}

function stepMatches(step, card) {
    if (step.kind === CAST) return step.match(card);
    if (step.kind === PACKAGE) return step.options.some(o => o.match(card));
    return false;
}

// ── Paying ───────────────────────────────────────────────────────────────────
//
// Scratch arrays shared by every game (the engine is single-threaded): the
// mana units one payment can draw on, and the pips being paid.

const UMAX = 512;
const uMask = new Int32Array(UMAX);
const uSrc = new Int32Array(UMAX);   // permanent index, or -1 - pool index
const uKey = new Int32Array(UMAX);
const uUsed = new Uint8Array(UMAX);
const uOrder = new Int32Array(UMAX);
let uLen = 0;
const chosen = new Int32Array(64);
const demand = new Int32Array(32);
const supply = new Int32Array(32);
const oneSrc = new Int32Array(64);
const oneN = new Int32Array(64);
const oneMask = new Int32Array(64);
const onePri = new Int32Array(64);
const poolNext = new Int32Array(256);

function pushUnit(mask, src, pri) {
    if (uLen >= UMAX) return;
    uMask[uLen] = mask;
    uSrc[uLen] = src;
    uKey[uLen] = pri * 64 + BITS[mask & 31];
    uUsed[uLen] = 0;
    uLen++;
}

function sortUnits() {
    for (let i = 0; i < uLen; i++) {
        const k = uKey[i];
        let j = i - 1;
        while (j >= 0 && uKey[uOrder[j]] > k) { uOrder[j + 1] = uOrder[j]; j--; }
        uOrder[j + 1] = i;
    }
}

function assignFrom(pips, k) {
    if (k === pips.length) return true;
    const pip = pips[k];
    let lastMask = -1;
    let lastKey = -1;
    for (let o = 0; o < uLen; o++) {
        const i = uOrder[o];
        if (uUsed[i] || !(uMask[i] & pip)) continue;
        if (uMask[i] === lastMask && uKey[i] === lastKey) continue;
        lastMask = uMask[i];
        lastKey = uKey[i];
        uUsed[i] = 1;
        chosen[k] = i;
        if (assignFrom(pips, k + 1)) return true;
        uUsed[i] = 0;
    }
    return false;
}

// ── The game ─────────────────────────────────────────────────────────────────

class Perm {
    constructor() {
        this.card = null;
        this.tapped = false;
        this.ready = 0;
        this.counters = 0;
        this.token = false;
        this.animated = false;
        this.dead = false;
        this.once = 0;
    }
}

/**
 * One game's state, reused across games. Hooks in planRules.js see it
 * through the rules API listed in the header.
 */
class Game {
    constructor(run) {
        this.run = run;
        this.anyMask = run.idMask || ANY;
        this.lib = [];
        this.libLen = 0;
        this.taken = new Uint8Array(0);
        this.top = 0;
        this.hand = [];
        this.command = [];
        this.perms = [];
        this.spare = [];
        this.pool = new Int32Array(256);
        this.poolLen = 0;
        this.turn = 0;
        this.spent = 0;
        this.peak = 0;
        this.turnColors = 0;
        this.availColors = 0;
        this.drops = 1;
        this.dropsUsed = 0;
        this.extraDrops = 0;
        this.fromTop = false;
        this.missedDrops = 0;
        this.landCount = 0;
        this.landTypes = 0;
        this.landMask = 0;
        this.version = 0;
        this.cacheVersion = -1;
        this.cDistinct = 0;
        this.cMaxPower = -1;
        this.cColors = 0;
        this.cBoostN = 0;
        this.cBoostMask = 0;
        this.subVersion = -1;
        this.subCounts = new Map();
        this.devVersion = -1;
        this.devCounts = new Map();
        this.castsThisTurn = [];
        this.stepTurn = new Int8Array(run.steps.length);
        this.stepReason = new Int32Array(run.steps.length);
        this.stepNeed = 0;
        this.handNeed = 0;
        this.entry = null;
        this.notes = null;
        // output() results (no allocation per call)
        this.oN = 0;
        this.oMask = 0;
        this.oMode = 0;
        this.oPri = 0;
        this.oBoost = 0;
    }

    // ── Setup ───────────────────────────────────────────────────────────────

    reset(hand, lib, libLen) {
        this.lib = lib;
        this.libLen = libLen;
        if (this.taken.length < libLen) this.taken = new Uint8Array(libLen + 16);
        this.taken.fill(0, 0, libLen);
        this.top = 0;
        this.hand.length = 0;
        for (const c of hand) this.hand.push(c);
        this.command.length = 0;
        for (const c of this.run.commanders) this.command.push(c);
        for (const p of this.perms) this.spare.push(p);
        this.perms.length = 0;
        this.poolLen = 0;
        this.turn = 0;
        this.spent = 0;
        this.peak = 0;
        this.turnColors = 0;
        this.drops = 1;
        this.dropsUsed = 0;
        this.extraDrops = 0;
        this.fromTop = false;
        this.missedDrops = 0;
        this.landCount = 0;
        this.landTypes = 0;
        this.landMask = 0;
        this.version++;
        this.castsThisTurn.length = 0;
        this.stepTurn.fill(0);
        this.stepReason.fill(0);
        this.entry = null;
        this.notes = null;
    }

    newPerm(card) {
        const p = this.spare.pop() ?? new Perm();
        p.card = card;
        p.tapped = false;
        p.ready = this.turn;
        p.counters = 0;
        p.token = false;
        p.animated = false;
        p.dead = false;
        p.once = 0;
        return p;
    }

    // ── Rules API ───────────────────────────────────────────────────────────

    note(text) {
        if (this.notes) this.notes.push(String(text));
    }

    isCreature(perm) {
        if (perm.animated) return true;
        const r = perm.card.rule;
        if (r?.creature) return Boolean(r.creature(perm, this));
        return perm.card.creature;
    }

    powerOf(perm) {
        const r = perm.card.rule;
        const base = perm.animated ? 0 : (r?.power ? r.power(perm, this) : perm.card.power ?? 0);
        return base + perm.counters;
    }

    refresh() {
        if (this.cacheVersion === this.version) return;
        this.cacheVersion = this.version;
        let powers = 0;
        let max = -1;
        let colors = 0;
        let boostN = 0;
        let boostMask = 0;
        for (const p of this.perms) {
            colors |= p.card.colors;
            const boost = p.card.rule?.tapBoost;
            if (boost) { boostN += boost.n; boostMask |= boost.mask; }
            if (!this.isCreature(p)) continue;
            const pw = this.powerOf(p);
            powers |= 1 << Math.min(30, Math.max(0, pw));
            if (pw > max) max = pw;
        }
        let n = 0;
        for (let m = powers; m; m &= m - 1) n++;
        this.cDistinct = n;
        this.cMaxPower = max;
        this.cColors = colors;
        this.cBoostN = boostN;
        this.cBoostMask = boostMask;
    }

    distinctPowers() {
        this.refresh();
        return this.cDistinct;
    }

    controlsPower(n) {
        this.refresh();
        return this.cMaxPower >= n;
    }

    colorsAmongPermanents() {
        this.refresh();
        return this.cColors;
    }

    countSubtype(word) {
        if (this.subVersion !== this.version) { this.subCounts.clear(); this.subVersion = this.version; }
        const key = String(word).toLowerCase();
        let n = this.subCounts.get(key);
        if (n === undefined) {
            n = 0;
            const needle = ` ${key} `;
            for (const p of this.perms) if (p.card.subtypes.includes(needle) && this.isCreature(p)) n++;
            this.subCounts.set(key, n);
        }
        return n;
    }

    devotion(mask) {
        if (this.devVersion !== this.version) { this.devCounts.clear(); this.devVersion = this.version; }
        let n = this.devCounts.get(mask);
        if (n === undefined) {
            n = 0;
            for (const p of this.perms) for (const pip of p.card.pips) if (pip & mask) n++;
            this.devCounts.set(mask, n);
        }
        return n;
    }

    addMana(mask, n) {
        const m = mask === ANY ? this.anyMask : mask;
        for (let i = 0; i < n && this.poolLen < this.pool.length; i++) this.pool[this.poolLen++] = m;
        this.turnColors |= m;
    }

    addCounters(perm, n) {
        perm.counters += n;
        this.version++;
    }

    createToken(spec) {
        return this.enter(tokenCard(spec), { token: true });
    }

    fetchLand(filter = {}, { tapped = true, toHand = false } = {}) {
        const types = Array.isArray(filter.types) ? filter.types : [];
        const kind = filter.kind ?? (filter.basic ? 1 : types.length ? 2 : 0);
        const bits = filter.bits ?? typeBits(types);
        // The rule writes its own note ("Karametra: Forest").
        const notes = this.notes;
        this.notes = null;
        const found = this.searchLand(kind, bits, !toHand, tapped);
        this.notes = notes;
        return found;
    }

    earthbend(n) {
        let pick = null;
        for (const p of this.perms) {
            if (!p.card.land || p.dead) continue;
            const score = (p.tapped ? 0 : 4) + (p.animated ? 0 : 2);
            if (!pick || score > pick.score) pick = { p, score };
        }
        if (!pick) return null;
        pick.p.animated = true;
        pick.p.counters += n;
        this.version++;
        return pick.p;
    }

    copySpell(card) {
        this.resolve(card, true);
    }

    oncePerTurn(perm) {
        if (perm.once === this.turn) return false;
        perm.once = this.turn;
        return true;
    }

    // ── Zones ───────────────────────────────────────────────────────────────

    advanceTop() {
        while (this.top < this.libLen && this.taken[this.top]) this.top++;
    }

    draw() {
        this.advanceTop();
        if (this.top >= this.libLen) return null;
        const c = this.lib[this.top];
        this.taken[this.top] = 1;
        this.advanceTop();
        this.hand.push(c);
        return c;
    }

    onBattlefield(match) {
        for (const p of this.perms) if (!p.dead && match(p.card)) return true;
        return false;
    }

    entersTappedLand(c) {
        switch (c.ltap) {
            case TAP.TAPPED: return true;
            case TAP.FAST: return this.landCount > 2;
            case TAP.SLOW: return this.landCount < 2;
            case TAP.CHECK: return (this.landTypes & c.lcheckBits) === 0;
            default: return false;
        }
    }

    recountLands() {
        let n = 0;
        let types = 0;
        let mask = 0;
        for (const p of this.perms) {
            if (!p.card.land) continue;
            n++;
            types |= p.card.typeBits;
            mask |= p.card.mask;
        }
        this.landCount = n;
        this.landTypes = types;
        this.landMask = mask;
    }

    /**
     * Put a land onto the battlefield (a fetchland cracks at once).
     * @param {string|null} [drop] - logged as the turn's land drop with this
     *   prefix ('' for a plain drop); null for lands a spell or trigger found
     */
    putLand(card, tapped, drop = null) {
        if (card.fetch) {
            const found = this.searchLand(card.fetch.kind, card.fetch.bits, true, card.fetch.tapped, `${drop ?? ''}${card.name} → `);
            if (found) return;
        }
        const p = this.newPerm(card);
        p.tapped = tapped;
        p.dead = Boolean(card.fetch);
        this.perms.push(p);
        this.landCount++;
        this.landTypes |= card.typeBits;
        this.landMask |= card.mask;
        this.version++;
        if (this.entry && drop !== null) this.entry.lands.push(`${drop}${card.name}`);
        if (card.lbounce) this.bounceLand(p);
    }

    bounceLand(self) {
        let back = null;
        let backScore = Infinity;
        for (const p of this.perms) {
            if (!p.card.land || p === self) continue;
            const s = BITS[p.card.mask & 31] * 10 + p.card.lmana;
            if (s < backScore) { back = p; backScore = s; }
        }
        if (!back) return;
        if (!back.tapped && !back.dead) this.addMana(back.card.mask, back.card.lmana);
        this.removePerm(back);
        this.hand.push(back.card);
    }

    removePerm(perm) {
        const i = this.perms.indexOf(perm);
        if (i >= 0) this.perms.splice(i, 1);
        this.spare.push(perm);
        if (perm.card.land) this.recountLands();
        this.version++;
    }

    /** A permanent spell (or a token, or a copy) enters. */
    enter(card, { token = false, setup = false } = {}) {
        const p = this.newPerm(card);
        p.token = token;
        const sick = this.isCreatureCard(card) && !card.haste;
        p.ready = setup ? 0 : (sick || card.ramp?.ready === 'next') ? this.turn + 1 : this.turn;
        p.tapped = !setup && card.entersTapped;
        this.perms.push(p);
        this.version++;
        if (!setup) card.rule?.onEnter?.(p, this);
        return p;
    }

    isCreatureCard(card) {
        return card.creature && !(card.rule?.creature);
    }

    needMasks() {
        let step = 0;
        let hand = 0;
        const steps = this.run.steps;
        const consider = c => {
            if (c.land) return;
            hand |= c.pipUnion;
            for (const s of steps) {
                if (this.stepTurn[s.index]) continue;
                if (stepMatches(s, c)) { step |= c.pipUnion; break; }
            }
        };
        for (const c of this.hand) consider(c);
        for (const c of this.command) consider(c);
        this.stepNeed = step;
        this.handNeed = hand;
    }

    /**
     * Find a land in the library (kind 0 any, 1 basic, 2 basic types `bits`),
     * the one adding the colours you need most; put it onto the battlefield
     * or into your hand.
     */
    searchLand(kind, bits, toBattlefield, tapped, drop = null) {
        this.needMasks();
        const have = this.landMask;
        let bi = -1;
        let bs = -1;
        for (let i = this.top; i < this.libLen; i++) {
            if (this.taken[i]) continue;
            const c = this.lib[i];
            if (!c.land || c.placeholder && kind !== 0) continue;
            if (kind === 1 && !c.basic) continue;
            if (kind === 2 && !(c.typeBits & bits)) continue;
            const fresh = c.mask & ~have;
            const s = BITS[fresh & this.stepNeed & 31] * 1000 + BITS[fresh & this.handNeed & 31] * 100 + BITS[fresh & 31] * 10 + BITS[c.mask & 31] + (c.fetch ? -5 : 0);
            if (s > bs) { bs = s; bi = i; }
        }
        if (bi < 0) return null;
        const c = this.lib[bi];
        this.taken[bi] = 1;
        if (bi === this.top) this.advanceTop();
        if (toBattlefield) {
            const t = tapped || c.lbounce || this.entersTappedLand(c);
            this.putLand(c, t, drop);
            if (drop === null && this.notes) this.notes.push(`${c.name}${t ? ' (tapped)' : ''}`);
        } else {
            this.hand.push(c);
            if (this.notes) this.notes.push(`${c.name} to hand`);
        }
        return c;
    }

    // ── Mana ────────────────────────────────────────────────────────────────

    canTap(p) {
        return !p.tapped && !p.dead && p.ready <= this.turn;
    }

    /** What a permanent's mana ability makes now (into this.o*); false if none. */
    output(p) {
        const c = p.card;
        this.oBoost = 0;
        if (c.land) {
            if (p.dead || c.lmana <= 0) return false;
            this.oN = c.lmana;
            this.oMask = c.mask;
            this.oMode = MODE.EACH;
            this.oPri = 1;
        } else if (c.treasure) {
            this.oN = 1;
            this.oMask = this.anyMask;
            this.oMode = MODE.EACH;
            this.oPri = 4;
        } else if (c.rule?.mana) {
            const o = c.rule.mana(p, this);
            if (!o || !(o.n > 0)) return false;
            this.oN = o.n;
            this.oMask = o.mask === ANY ? this.anyMask : o.mask;
            this.oMode = o.mode ?? MODE.EACH;
            this.oPri = 3;
        } else if (c.ramp?.modelled && c.ramp.mana > 0) {
            this.oN = c.ramp.mana;
            this.oMask = c.ramp.mask;
            this.oMode = MODE.EACH;
            this.oPri = 2;
        } else {
            return false;
        }
        this.refresh();
        if (this.cBoostN && this.isCreature(p)) this.oBoost = this.cBoostN;
        return true;
    }

    /**
     * Mana you could still make this turn: floating plus every untapped
     * source. Also sets availColors, the colours that mana can be.
     */
    potential() {
        let n = this.poolLen;
        let colors = 0;
        for (let i = 0; i < this.poolLen; i++) colors |= this.pool[i];
        for (const p of this.perms) {
            if (!this.canTap(p) || !this.output(p)) continue;
            n += this.oN + this.oBoost;
            colors |= this.oMask | (this.oBoost ? this.cBoostMask : 0);
        }
        this.availColors = colors;
        this.turnColors |= colors;
        return n;
    }

    /** Could the mana available now (amount, colours) possibly pay for this card? A quick filter before paying. */
    mightAfford(card, avail) {
        if (card.playMv + (card.ramp?.extraCost ?? 0) > avail) return false;
        for (const pip of card.pips) if (!(pip & this.availColors)) return false;
        return true;
    }

    updatePeak() {
        const total = this.spent + this.potential();
        if (total > this.peak) this.peak = total;
        const steps = this.run.steps;
        for (const s of steps) {
            if (s.kind === MANA && !this.stepTurn[s.index] && this.peak >= s.atLeast) this.markStep(s.index);
        }
    }

    /** Every unit of mana available now, for one payment. */
    buildUnits(pips) {
        uLen = 0;
        for (let i = 0; i < this.poolLen; i++) pushUnit(this.pool[i], -1 - i, 0);
        demand.fill(0);
        supply.fill(0);
        for (const pip of pips) if (BITS[pip & 31] === 1) demand[pip & 31]++;
        let ones = 0;
        const perms = this.perms;
        for (let j = 0; j < perms.length; j++) {
            const p = perms[j];
            if (!this.canTap(p) || !this.output(p)) continue;
            for (let b = 0; b < this.oBoost; b++) pushUnit(this.cBoostMask, j, this.oPri);
            if (this.oMode === MODE.ONE && ones < oneSrc.length) {
                oneSrc[ones] = j;
                oneN[ones] = this.oN;
                oneMask[ones] = this.oMask;
                onePri[ones] = this.oPri;
                ones++;
            } else if (this.oMode === MODE.SET) {
                for (let m = this.oMask & 31; m; m &= m - 1) pushUnit(lowBit(m), j, this.oPri);
            } else {
                for (let k = 0; k < this.oN; k++) pushUnit(this.oMask, j, this.oPri);
            }
        }
        if (ones) {
            for (let i = 0; i < uLen; i++) for (let m = uMask[i] & 31; m; m &= m - 1) supply[lowBit(m)]++;
            let need = 0;
            for (const pip of pips) need |= pip;
            for (let s = 0; s < ones; s++) {
                const mask = oneMask[s] & 31;
                let best = 0;
                let bestScore = -Infinity;
                for (let m = mask; m; m &= m - 1) {
                    const bit = lowBit(m);
                    const score = (demand[bit] - supply[bit]) * 4 + (need & bit ? 2 : 0) + (this.handNeed & bit ? 1 : 0);
                    if (score > bestScore) { best = bit; bestScore = score; }
                }
                for (let k = 0; k < oneN[s]; k++) pushUnit(best, oneSrc[s], onePri[s]);
                supply[best] += oneN[s];
            }
        }
        sortUnits();
    }

    /**
     * Pay pips + generic from what is available now. With commit the
     * sources used are tapped (their unused mana floats) and the units spent.
     * @returns {boolean}
     */
    pay(pips, generic, commit) {
        const total = pips.length + generic;
        if (pips.length > chosen.length) return false;
        this.buildUnits(pips);
        if (uLen < total) return false;
        if (pips.length && !assignFrom(pips, 0)) return false;
        let need = generic;
        for (let o = 0; o < uLen && need > 0; o++) {
            const i = uOrder[o];
            if (uUsed[i]) continue;
            uUsed[i] = 2;
            need--;
        }
        if (need > 0) return false;
        if (!commit) return true;
        // Tap every source a used unit came from; its unused units float.
        const perms = this.perms;
        const tapped = [];
        for (let i = 0; i < uLen; i++) {
            if (!uUsed[i] || uSrc[i] < 0) continue;
            const p = perms[uSrc[i]];
            if (!tapped.includes(p)) tapped.push(p);
        }
        let len = 0;
        for (let i = 0; i < uLen; i++) {
            if (uUsed[i]) continue;
            const src = uSrc[i];
            const keep = src < 0 || tapped.includes(perms[src]);
            if (keep && len < poolNext.length) poolNext[len++] = uMask[i];
        }
        this.pool.set(poolNext.subarray(0, len));
        this.poolLen = len;
        for (const p of tapped) {
            p.tapped = true;
            if (p.card.treasure) this.removePerm(p);
        }
        this.spent += total;
        return true;
    }

    payCard(card, commit) {
        const extra = card.ramp?.extraCost ?? 0;
        return this.pay(card.pips, card.playMv - card.pips.length + extra, commit);
    }

    // ── Casting ─────────────────────────────────────────────────────────────

    cast(card, fromCommand) {
        if (!this.payCard(card, true)) return false;
        const zone = fromCommand ? this.command : this.hand;
        const at = zone.indexOf(card);
        if (at >= 0) zone.splice(at, 1);
        if (!fromCommand) this.castsThisTurn.push(card);
        const record = this.entry ? { name: card.name, from: fromCommand ? 'command' : 'hand', step: -1, notes: [] } : null;
        if (record) this.entry.cast.push(record);
        const outer = this.notes;
        this.notes = record ? record.notes : null;
        // Cast triggers resolve before the spell (Selvala's token, the Doctor's copy).
        const watchers = [];
        for (const p of this.perms) if (p.card.rule?.onCast && !p.dead) watchers.push(p);
        for (const p of watchers) p.card.rule.onCast(p, card, this);
        const k = this.creditCast(card);
        if (record) record.step = k;
        this.resolve(card, false);
        this.creditPackage();
        this.notes = outer;
        return true;
    }

    /** A spell resolves (or its copy): a permanent enters; ramp does what it does. */
    resolve(card, isCopy) {
        if (card.permanent && !card.land) this.enter(card, { token: isCopy });
        const r = card.ramp;
        if (!r) return;
        if (r.sacrificeLand && this.landCount) {
            let worst = null;
            for (const p of this.perms) if (p.card.land && (!worst || BITS[p.card.mask & 31] < BITS[worst.card.mask & 31])) worst = p;
            if (worst) this.removePerm(worst);
        }
        for (let k = 0; k < r.lands; k++) if (!this.searchLand(r.filterKind, r.filterBits, true, r.landsTapped)) break;
        for (let k = 0; k < r.toHand; k++) if (!this.searchLand(r.filterKind, r.filterBits, false, false)) break;
        if (r.extraDrops && card.permanent) { this.extraDrops += r.extraDrops; this.drops += r.extraDrops; }
        if (r.extraDropsOnce) this.drops += r.extraDropsOnce;
        if (r.fromTop) this.fromTop = true;
        if (r.putLand) {
            const at = this.hand.findIndex(c => c.land && (!r.putLandBasic || c.basic));
            if (at >= 0) {
                const c = this.hand.splice(at, 1)[0];
                this.putLand(c, r.putLandTapped || c.lbounce || this.entersTappedLand(c));
                this.note(c.name);
            }
        }
        for (let k = 0; k < r.treasure; k++) this.enter(TREASURE, { token: true });
        for (let k = 0; k < r.draws; k++) this.draw();
    }

    markStep(k) {
        this.stepTurn[k] = this.turn;
        if (this.entry) this.entry.steps.push(k);
    }

    /** The first unmet cast step this card counts for (its `after` met now), or -1. */
    creditCast(card) {
        for (const s of this.run.steps) {
            if (s.kind !== CAST || this.stepTurn[s.index] || !s.match(card)) continue;
            if (s.after && !this.onBattlefield(s.after)) continue;
            this.markStep(s.index);
            return s.index;
        }
        return -1;
    }

    /** Package steps: every card of one option cast from hand this turn. */
    creditPackage() {
        for (const s of this.run.steps) {
            if (s.kind !== PACKAGE || this.stepTurn[s.index]) continue;
            for (const o of s.options) {
                let n = 0;
                for (const c of this.castsThisTurn) if (o.match(c)) n++;
                if (n >= o.count) { this.markStep(s.index); break; }
            }
        }
    }

    /** How much a ramp card adds, for choosing between them (0: not ramp now). */
    rampValue(card) {
        let v = 0;
        const r = card.ramp;
        const rule = card.rule;
        if (rule?.mana) {
            // What it would make once on the battlefield (Priest counts itself).
            const ghost = this.newPerm(card);
            this.perms.push(ghost);
            this.version++;
            const o = rule.mana(ghost, this);
            this.perms.pop();
            this.version++;
            this.spare.push(ghost);
            v += o?.n ?? 0;
        } else if (r?.modelled && r.mana > 0) {
            v += r.mana;
        }
        if (rule?.onMainPhase && rule.manaSource) v += 1;
        if (rule?.tapBoost) {
            let creatures = 1; // the land it may animate, or itself
            for (const p of this.perms) if (this.isCreature(p) && (p.card.manaSource || p.animated)) creatures++;
            v += creatures * rule.tapBoost.n;
        }
        if (v > 0 && card.creature && !card.haste) v *= 0.95;
        if (r?.lands || r?.toHand) v += r.lands + r.toHand * 0.5;
        if (r?.extraDrops) v += 0.6 * r.extraDrops;
        if (r?.extraDropsOnce && this.hand.some(c => c.land) && this.dropsUsed >= this.drops) v += 0.8;
        if (r?.putLand && this.hand.some(c => c.land && (!r.putLandBasic || c.basic))) v += 0.8;
        if (r?.treasure) v += 0.5 * r.treasure;
        if (rule?.rampValue) v += rule.rampValue;
        if (r?.sacrificeLand) v -= r.sacrificeLand;
        return v;
    }

    /** Is this card held for a package step that hasn't happened? */
    held(card) {
        for (const s of this.run.steps) {
            if (s.kind === PACKAGE && !this.stepTurn[s.index] && s.options.some(o => o.match(card))) return true;
        }
        return false;
    }

    /** Pursue the plan: one step if any can be done now. */
    tryStep() {
        const steps = this.run.steps;
        // Steps still on time first, in plan order; then the late ones.
        for (let pass = 0; pass < 2; pass++) {
            for (const s of steps) {
                if (this.stepTurn[s.index] || s.kind === MANA) continue;
                const late = s.turn < this.turn;
                if (late !== (pass === 1)) continue;
                if (s.after && !this.onBattlefield(s.after)) continue;
                if (s.kind === CAST ? this.tryCastStep(s) : this.tryPackage(s)) return true;
            }
        }
        return false;
    }

    tryCastStep(s) {
        let best = null;
        let bestCommand = false;
        let bestScore = -Infinity;
        const avail = this.potential();
        const look = (c, fromCommand) => {
            if (c.land || !s.match(c) || !this.mightAfford(c, avail)) return;
            const score = (c.manaSource ? this.rampValue(c) * 100 : 0) - c.playMv;
            if (score <= bestScore || !this.payCard(c, false)) return;
            best = c;
            bestCommand = fromCommand;
            bestScore = score;
        };
        for (const c of this.hand) look(c, false);
        for (const c of this.command) look(c, true);
        return best ? this.cast(best, bestCommand) : false;
    }

    tryPackage(s) {
        for (const o of s.options) {
            const cards = this.hand.filter(c => !c.land && o.match(c)).sort((a, b) => a.playMv - b.playMv).slice(0, o.count);
            if (cards.length < o.count) continue;
            const pips = cards.flatMap(c => c.pips).sort((a, b) => BITS[a & 31] - BITS[b & 31]);
            const generic = cards.reduce((n, c) => n + c.playMv, 0) - pips.length;
            if (!this.pay(pips, generic, false)) continue;
            // Most demanding colours first; a creature first feeds Selvala-style triggers.
            cards.sort((a, b) => b.pips.length - a.pips.length || Number(b.creature) - Number(a.creature));
            let cast = 0;
            for (const c of cards) if (this.cast(c, false)) cast++;
            if (cast) return true;
        }
        return false;
    }

    /** Cast the best ramp the mana allows (pieces that pay for themselves first). */
    tryRamp() {
        let best = null;
        let bestCommand = false;
        let bestScore = -Infinity;
        const avail = this.potential();
        const look = (c, fromCommand) => {
            if (c.land || !c.isRamp || c.playMv == null || !this.mightAfford(c, avail)) return;
            if (!fromCommand && this.held(c)) return;
            const v = this.rampValue(c);
            if (v <= 0) return;
            const r = c.ramp;
            const cost = c.playMv + (r?.extraCost ?? 0);
            const now = (r?.mana && r.ready === 'now' ? r.mana : 0) + (r?.lands && !r.landsTapped ? r.lands : 0) - cost;
            const score = (now >= 0 ? 1e6 : 0) + Math.round(v * 100) * 100 - cost;
            if (score <= bestScore || !this.payCard(c, false)) return;
            best = c;
            bestCommand = fromCommand;
            bestScore = score;
        };
        for (const c of this.hand) look(c, false);
        for (const c of this.command) look(c, true);
        return best ? this.cast(best, bestCommand) : false;
    }

    // ── Land drops ──────────────────────────────────────────────────────────

    /** Play one land from hand (or the top of the library). */
    playOneLand() {
        const topCard = this.fromTop && this.top < this.libLen && !this.taken[this.top] && this.lib[this.top].land ? this.lib[this.top] : null;
        let any = topCard !== null;
        let bump = 0;
        for (const c of this.hand) {
            if (!c.land) continue;
            any = true;
            if (!c.lbounce && !this.entersTappedLand(c) && c.lmana > bump) bump = c.lmana;
        }
        if (topCard && !topCard.lbounce && !this.entersTappedLand(topCard)) bump = Math.max(bump, topCard.lmana);
        if (!any) return false;
        this.needMasks();
        // Does an untapped land's mana let you cast something this turn? If
        // not, a tapped land costs nothing: play it now and save the other.
        let matters = false;
        if (bump > 0) {
            const cap = this.potential();
            const hi = cap + bump;
            const check = c => !c.land && c.playMv > cap && c.playMv <= hi;
            matters = this.hand.some(check) || this.command.some(check);
        }
        const score = c => {
            if (!c.land || (c.lbounce && this.landCount === 0)) return -Infinity;
            const tapped = c.lbounce || (c.fetch ? c.fetch.tapped : this.entersTappedLand(c));
            const fresh = c.mask & ~this.landMask;
            return ((tapped ? !matters : matters) ? 100000 : 0) + (c.fetch ? 1 : c.lmana) * 1000
                + BITS[fresh & this.stepNeed & 31] * 300 + BITS[fresh & this.handNeed & 31] * 100 + BITS[fresh & 31] * 10 + BITS[c.mask & 31];
        };
        let best = null;
        let bestScore = -Infinity;
        for (const c of this.hand) {
            const s = score(c);
            if (s > bestScore) { best = c; bestScore = s; }
        }
        // A free card off the top beats an equal one from hand.
        const fromTop = topCard !== null && score(topCard) + 1 > bestScore && score(topCard) > -Infinity;
        if (fromTop) best = topCard;
        if (!best) return false;
        if (fromTop) {
            this.taken[this.top] = 1;
            this.advanceTop();
        } else {
            this.hand.splice(this.hand.indexOf(best), 1);
        }
        this.putLand(best, best.lbounce || this.entersTappedLand(best), '');
        return true;
    }

    playLands() {
        let played = 0;
        while (this.dropsUsed < this.drops && this.playOneLand()) {
            this.dropsUsed++;
            played++;
        }
        return played;
    }

    // ── Turns ───────────────────────────────────────────────────────────────

    beginTurn(t, log) {
        this.turn = t;
        for (const p of this.perms) p.tapped = false;
        this.poolLen = 0;
        this.spent = 0;
        this.peak = 0;
        this.turnColors = 0;
        this.castsThisTurn.length = 0;
        const entry = log ? { turn: t, drew: null, lands: [], cast: [], notes: [], mana: 0, colors: 0, steps: [] } : null;
        this.entry = entry;
        this.notes = entry ? entry.notes : null;
        if (!(t === 1 && this.run.skipFirstDraw)) {
            const c = this.draw();
            if (entry && c) entry.drew = c.name;
        }
        // Beginning of the first main phase: triggers, then the land drop.
        const triggers = this.perms.filter(p => p.card.rule?.onMainPhase && !p.dead);
        for (const p of triggers) p.card.rule.onMainPhase(p, this);
        this.drops = 1 + this.extraDrops;
        this.dropsUsed = 0;
        if (!this.playLands() && !this.hand.some(c => c.land)) this.missedDrops++;
        this.updatePeak();
    }

    mainPhase() {
        for (let guard = 0; guard < 40; guard++) {
            if (!this.tryStep() && !this.tryRamp()) break;
            this.playLands();
            this.updatePeak();
        }
    }

    endTurn(log) {
        const t = this.turn;
        for (const s of this.run.steps) {
            if (s.turn === t && !this.stepTurn[s.index]) this.stepReason[s.index] = this.diagnose(s);
        }
        if (this.entry) {
            this.entry.mana = this.peak;
            this.entry.colors = this.turnColors & 31;
            log.turns.push(this.entry);
            this.entry = null;
        }
        this.notes = null;
    }

    /** Why step `s` missed its turn (called at the end of that turn). */
    diagnose(s) {
        const short = this.missedDrops > 0 ? REASON.LAND : REASON.MANA;
        if (s.kind === MANA) return this.missedDrops > 0 ? REASON.LAND : REASON.SHORT;
        if (s.after && !this.onBattlefield(s.after)) return REASON.AFTER;
        let cost = Infinity;
        let pips = null;
        if (s.kind === CAST) {
            for (const zone of [this.hand, this.command]) {
                for (const c of zone) {
                    if (!c.land && s.match(c) && c.playMv < cost) { cost = c.playMv; pips = c.pips; }
                }
            }
            if (!pips) return REASON.NO_CARD;
        } else {
            for (const o of s.options) {
                const cards = this.hand.filter(c => !c.land && o.match(c)).sort((a, b) => a.playMv - b.playMv).slice(0, o.count);
                if (cards.length < o.count) continue;
                const sum = cards.reduce((n, c) => n + c.playMv, 0);
                if (sum < cost) { cost = sum; pips = cards.flatMap(c => c.pips); }
            }
            if (!pips) return REASON.NO_PACKAGE;
        }
        if (this.peak < cost) return short;
        for (const pip of pips) {
            if (!(pip & this.turnColors)) return REASON.COLOUR | ((pip & 31) << 8);
        }
        return REASON.OTHER;
    }
}

// ── Opening hands ────────────────────────────────────────────────────────────

/** Does a kept hand meet the keep rule? */
function keeps(run, hand) {
    const keep = run.keep;
    let lands = 0;
    const masks = [];
    for (const c of hand) if (c.land) { lands++; masks.push(c.mask); }
    if (lands < keep.minLands || lands > keep.maxLands) return false;
    if (keep.kind !== 'plan' || !run.firstPlay) return true;
    const step = run.firstPlay;
    const reachable = c => !c.land && stepMatches(step, c) && (c.pips.length === 0 || assignPips(c.pips, masks) !== null);
    return hand.some(reachable) || run.commanders.some(reachable);
}

/**
 * Which cards go to the bottom after a London mulligan: extra lands (the
 * least useful colours) or spells, keeping the cards the plan's steps want.
 */
function bottomFor(run, seven, owed) {
    const keep = run.keep;
    const size = seven.length - owed;
    const mid = (keep.minLands + keep.maxLands) / 2;
    const target = Math.min(size, Math.max(keep.minLands, Math.min(keep.maxLands, Math.round(mid * size / OPENING_HAND))));
    const lands = seven.filter(c => c.land);
    const spells = seven.filter(c => !c.land);
    let landsOut = Math.max(0, Math.min(owed, lands.length - target));
    let spellsOut = owed - landsOut;
    if (spellsOut > spells.length) { spellsOut = spells.length; landsOut = owed - spellsOut; }
    const out = new Set();
    for (let k = 0; k < landsOut; k++) {
        let worst = null;
        let worstScore = Infinity;
        for (const c of lands) {
            if (out.has(c)) continue;
            let others = 0;
            for (const d of lands) if (d !== c && !out.has(d)) others |= d.mask;
            const score = BITS[c.mask & ~others & 31] * 10 + BITS[c.mask & 31];
            if (score < worstScore) { worst = c; worstScore = score; }
        }
        out.add(worst);
    }
    const wanted = c => run.steps.some(s => stepMatches(s, c));
    const score = c => (c.mv ?? 0) - (c.manaSource || c.isRamp ? 1.5 : 0) - (wanted(c) ? 3 : 0);
    const ranked = spells.slice().sort((a, b) => score(b) - score(a));
    for (let k = 0; k < spellsOut; k++) out.add(ranked[k]);
    // Copies are shared objects: remove by position so duplicates are counted right.
    const keepCards = [];
    const bottom = [];
    const left = new Map();
    for (const c of out) left.set(c, (left.get(c) ?? 0) + 1);
    for (const c of seven) {
        const n = left.get(c) ?? 0;
        if (n > 0) { bottom.push(c); left.set(c, n - 1); } else keepCards.push(c);
    }
    return { keep: keepCards, bottom };
}

/** Shuffle, deal and mulligan into the run's buffers; returns the mulligans taken. */
function deal(run) {
    const cards = run.cards;
    const N = cards.length;
    const ord = run.idx;
    for (let i = 0; i < N; i++) ord[i] = i;
    const free = run.freeMulligan ? 1 : 0;
    for (let m = 0; ; m++) {
        shuffle(ord, run.rng);
        const seven = [];
        for (let i = 0; i < OPENING_HAND; i++) seven.push(cards[ord[i]]);
        const owed = Math.max(0, m - free);
        let hand = seven;
        let bottom = [];
        if (owed > 0) ({ keep: hand, bottom } = bottomFor(run, seven, owed));
        if (OPENING_HAND - owed <= MIN_HAND || keeps(run, hand)) {
            let k = 0;
            for (let i = OPENING_HAND; i < N; i++) run.dealLib[k++] = cards[ord[i]];
            for (const c of bottom) run.dealLib[k++] = c;
            run.dealLen = k;
            run.dealHand = hand;
            return m;
        }
    }
}

// ── Runs ─────────────────────────────────────────────────────────────────────

/**
 * Set up a simulation; play it with runPlanBatch() (in slices, so a page can
 * yield between them) and read it with finishPlanRun().
 * @param {Object} lib - buildPlanLibrary() / buildPlanCountsLibrary() output
 * @param {Object} plan - a plan (planSchema.js)
 * @param {{format?:Object, onPlay?:boolean, keep?:Object, games?:number, seed?:number, samples?:number}} [opts]
 */
export function createPlanRun(lib, plan, { format = null, onPlay = true, keep = DEFAULT_KEEP, games = DEFAULT_GAMES, seed = SEED, samples = SAMPLE_GAMES } = {}) {
    const steps = compileSteps(plan);
    const lastStep = steps.reduce((m, s) => Math.max(m, s.turn), 0);
    const lastTurn = Math.min(MAX_TURNS, Math.max(4, lastStep + 1));
    const manaSteps = steps.filter(s => s.kind === MANA);
    const keyStep = manaSteps.length ? manaSteps[manaSteps.length - 1] : null;
    const keyTurn = keyStep ? keyStep.turn : Math.max(1, lastStep || 4);
    const cards = lib?.cards ?? [];
    const run = {
        lib,
        cards,
        commanders: lib?.commanders ?? [],
        idMask: lib?.idMask ?? 0,
        plan: normalizePlan(plan),
        planKey: planKey(plan),
        steps,
        firstPlay: steps.find(s => s.kind === CAST || s.kind === PACKAGE) ?? null,
        keep: normalizeKeep(keep),
        lastTurn,
        keyTurn,
        keyRequired: keyStep ? keyStep.atLeast : null,
        freeMulligan: Boolean(format?.freeMulligan),
        skipFirstDraw: onPlay !== false && !format?.firstPlayerDraws,
        games: Math.max(0, Math.floor(games) || 0),
        samples,
        rng: mulberry32(seed),
        idx: new Int32Array(cards.length),
        dealHand: [],
        dealLib: new Array(cards.length).fill(null),
        dealLen: 0,
        done: 0,
        mulligans: 0,
        stepWhen: steps.map(() => new Int32Array(lastTurn + 2)),
        onTime: new Int32Array(steps.length),
        late: new Int32Array(steps.length),
        prefix: new Int32Array(steps.length),
        planOnTime: 0,
        planLate: 0,
        reasons: new Map(),
        mana: Array.from({ length: lastTurn + 1 }, () => new Int32Array(MAX_MANA + 1)),
        sampleGames: []
    };
    run.game = new Game(run);
    return run;
}

/** Play one game from a dealt hand and library into the run's game. */
function playGame(run, hand, lib, libLen, log, setup = []) {
    const g = run.game;
    g.reset(hand, lib, libLen);
    for (const c of setup) {
        if (c.land) g.putLand(c, false);
        else g.enter(c, { setup: true });
    }
    const mana = new Int32Array(run.lastTurn + 1);
    for (let t = 1; t <= run.lastTurn; t++) {
        g.beginTurn(t, log);
        g.mainPhase();
        mana[t] = Math.min(MAX_MANA, g.peak);
        g.endTurn(log);
    }
    return mana;
}

function record(run, g, mana, log) {
    const steps = run.steps;
    let allOnTime = true;
    let allLate = true;
    let failed = -1;
    for (const s of steps) {
        const t = g.stepTurn[s.index];
        run.stepWhen[s.index][t]++;
        const onTime = t > 0 && t <= s.turn;
        const late = t > 0 && t <= s.turn + 1;
        if (onTime) run.onTime[s.index]++;
        if (late) run.late[s.index]++;
        if (!onTime && failed < 0) failed = s.index;
        if (!onTime) allOnTime = false;
        if (!late) allLate = false;
        if (allOnTime) run.prefix[s.index]++;
    }
    if (steps.length && allOnTime) run.planOnTime++;
    if (steps.length && allLate) run.planLate++;
    let reason = 0;
    if (failed >= 0) {
        reason = g.stepReason[failed] || REASON.OTHER;
        const key = failed * 65536 + reason;
        run.reasons.set(key, (run.reasons.get(key) ?? 0) + 1);
    }
    for (let t = 1; t <= run.lastTurn; t++) run.mana[t][mana[t]]++;
    if (log) {
        log.stepTurns = Array.from(g.stepTurn);
        log.onTime = steps.length > 0 && allOnTime;
        log.late = steps.length > 0 && allLate;
        log.failStep = failed;
        log.reason = reason;
        run.sampleGames.push(log);
    }
}

/**
 * Play up to `count` more games. Returns true when the run is complete.
 * @param {Object} run - createPlanRun() output
 * @param {number} [count]
 */
export function runPlanBatch(run, count = run.games) {
    if (run.cards.length < OPENING_HAND) { run.done = run.games; return true; }
    const end = Math.min(run.games, run.done + Math.max(1, count));
    for (let gi = run.done; gi < end; gi++) {
        const mulligans = deal(run);
        if (mulligans > (run.freeMulligan ? 1 : 0)) run.mulligans++;
        const log = run.sampleGames.length < run.samples
            ? { hand: run.dealHand.map(c => c.name), handLands: run.dealHand.filter(c => c.land).length, mulligans, turns: [] }
            : null;
        const mana = playGame(run, run.dealHand, run.dealLib, run.dealLen, log);
        record(run, run.game, mana, log);
    }
    run.done = end;
    return run.done >= run.games;
}

function turnStats(hist, games) {
    return {
        p10: quantile(hist, 0.1),
        p25: quantile(hist, 0.25),
        p50: quantile(hist, 0.5),
        p75: quantile(hist, 0.75),
        p90: quantile(hist, 0.9),
        games
    };
}

/**
 * The run's numbers.
 * @returns {Object|null} null when no game could be played
 */
export function finishPlanRun(run) {
    const games = run.done;
    if (!games || run.cards.length < OPENING_HAND) return null;
    const steps = run.steps.map((s, i) => {
        const when = run.stepWhen[i];
        // Turn distribution with "never" (index 0) moved past the last turn.
        const hist = new Int32Array(run.lastTurn + 2);
        for (let t = 1; t <= run.lastTurn; t++) hist[t] = when[t];
        hist[run.lastTurn + 1] = when[0];
        const prev = i === 0 ? games : run.prefix[i - 1];
        return {
            index: i,
            turn: s.turn,
            step: s.step,
            onTime: run.onTime[i] / games,
            late: run.late[i] / games,
            reach: run.prefix[i] / games,
            conditional: prev ? run.prefix[i] / prev : 0,
            p25: quantile(hist, 0.25),
            p50: quantile(hist, 0.5),
            p75: quantile(hist, 0.75),
            never: when[0] / games
        };
    });
    const reasons = [...run.reasons.entries()]
        .map(([key, count]) => ({ step: Math.floor(key / 65536), code: key % 256, colour: (key % 65536) >> 8, count, share: count / games }))
        .sort((a, b) => b.count - a.count || a.step - b.step || a.code - b.code);
    const keyHist = run.mana[run.keyTurn] ?? new Int32Array(MAX_MANA + 1);
    let meets = 0;
    if (run.keyRequired != null) for (let m = run.keyRequired; m <= MAX_MANA; m++) meets += keyHist[m];
    return {
        games,
        planKey: run.planKey,
        plan: run.plan,
        lastTurn: run.lastTurn,
        placeholder: Boolean(run.lib?.placeholder),
        mulliganRate: run.mulligans / games,
        steps,
        onTime: steps.length ? run.planOnTime / games : 0,
        late: steps.length ? run.planLate / games : 0,
        reasons,
        keyMana: {
            turn: run.keyTurn,
            required: run.keyRequired,
            hist: Array.from(keyHist),
            meets: run.keyRequired != null ? meets / games : null,
            ...turnStats(keyHist, games)
        },
        manaByTurn: Array.from({ length: run.lastTurn }, (_, i) => ({ turn: i + 1, ...turnStats(run.mana[i + 1], games) })),
        samples: run.sampleGames
    };
}

/** Run everything synchronously (tests, small decks). */
export function simulatePlan(lib, plan, opts = {}) {
    const run = createPlanRun(lib, plan, opts);
    runPlanBatch(run, run.games);
    return finishPlanRun(run);
}

/**
 * Play one scripted game: a given hand, library (top first) and optional
 * starting battlefield — no shuffle, no mulligan. For tests and for checking
 * what the engine does with a hand. Cards may be plan cards or names.
 * @param {Object} lib - buildPlanLibrary() output
 * @param {Object} plan
 * @param {{hand?:Array, library?:Array, battlefield?:Array, format?:Object, onPlay?:boolean, turns?:number}} [opts]
 * @returns {{mana:number[], stepTurns:number[], reasons:number[], log:Object, board:Array<{name:string, power:number|null, counters:number, token:boolean, tapped:boolean}>}}
 */
export function playScriptedPlanGame(lib, plan, { hand = [], library = [], battlefield = [], format = null, onPlay = true, turns } = {}) {
    const card = c => (typeof c === 'string' ? findPlanCard(lib, c) ?? (() => { throw new Error(`Unknown card: ${c}`); })() : c);
    const run = createPlanRun(lib, plan, { format, onPlay, games: 0, samples: 0 });
    if (Number.isFinite(turns)) {
        run.lastTurn = Math.max(1, Math.min(MAX_TURNS, turns));
        run.mana = Array.from({ length: run.lastTurn + 1 }, () => new Int32Array(MAX_MANA + 1));
    }
    const h = hand.map(card);
    const lb = library.map(card);
    const log = { hand: h.map(c => c.name), handLands: h.filter(c => c.land).length, mulligans: 0, turns: [] };
    const mana = playGame(run, h, lb, lb.length, log, battlefield.map(card));
    const g = run.game;
    return {
        mana: Array.from(mana),
        stepTurns: Array.from(g.stepTurn),
        reasons: Array.from(g.stepReason),
        log,
        board: g.perms.map(p => ({
            name: p.card.name,
            creature: g.isCreature(p),
            power: g.isCreature(p) ? g.powerOf(p) : null,
            counters: p.counters,
            token: p.token,
            animated: p.animated,
            tapped: p.tapped
        })),
        hand: g.hand.map(c => c.name)
    };
}
