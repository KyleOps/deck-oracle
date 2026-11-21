/**
 * Game Plan engine — goldfish games played towards a plan (planSchema.js).
 *
 * Each game: shuffle, London mulligan with a plan-aware keep rule, then turn
 * by turn: untap, draw (Commander: everyone draws on turn one; 60/40 cards:
 * not on the play), main-phase triggers, land drop(s), then the casting
 * policy until nothing more can be cast, combat triggers and the end step.
 * Cards are read once into "plan cards" (toPlanCard): lands through
 * manaDevelopment's classifyLand, ramp through ramp.js, and anything the
 * board changes through a card rule (planRules.js) — Selvala's different
 * powers, Fanatic's Ferocious, Priest's Elves, Bloom Tender's colours,
 * Badgermole Cub's extra {G}, Jadzia's counters, the Doctor's copies, battle
 * lands, shocks, hideaway, MDFC land faces, X spells. A named rule replaces
 * the generic reading for that card.
 *
 * Zones: library (with hideaway and "to the bottom"), hand, command zone,
 * battlefield, graveyard (cracked fetchlands, milled cards, resolved
 * sorceries: Icetill Explorer replays lands from it, Restoration Seminar
 * needs a target in it) and life (fetchlands, shocks and MDFC lands paid only
 * when their mana is needed that turn).
 *
 * Mana. Every source (land, rock, creature, Treasure, floating mana) is
 * worked out from the board at the moment you pay, so a creature cast this
 * turn (and Selvala's Mercenary) raises what the untapped sources make.
 * Paying matches each coloured pip to a distinct unit of mana (backtracking),
 * then takes generic from the least valuable units: floating mana, convoking
 * creatures, lands, fixed sources, then sources whose output still grows as
 * you cast (Selvala, Bloom Tender, Priest — tapped last), Treasure last. A
 * tapped source's unused mana floats for the rest of the main phase.
 * Summoning sickness, haste and enters-tapped are tracked per permanent;
 * power is base + counters + anthems, so power-based rules are exact.
 *
 * "Mana on turn T" is everything you made that turn: what you spent plus
 * what you could still make, after your land drop — so a rock cast that turn
 * counts. It is what a "have X mana" step checks. "Available" (sample games,
 * scripted games) is what you could make before casting anything.
 *
 * The casting policy, each pass: the earliest unmet step that is still on
 * time (then late ones), if it can be done now; otherwise the best ramp it
 * can afford (cards a pending package or spend step needs stay in hand);
 * otherwise it holds. A step met early counts as on time. A spend step casts
 * the best single spell or ordered pair (creatures first, so they feed
 * Selvala-style mana before it is tapped), and only when that reaches its
 * target. A copied-cast step casts the biggest matching spell first, so the
 * copy goes to it. Information-only steps are watched, never pursued.
 *
 * Rules API — what card-rule hooks may call on the game (planRules.js):
 *   turn, landCount, life, powerOf(perm), isCreature(perm), distinctPowers(),
 *   controlsPower(n), countSubtype(word), colorsAmongPermanents(),
 *   devotion(mask), countCreatures(), greatestPower(), countAttackers(n),
 *   distinctLandNames(), addMana(mask, n), addCounters(perm, n),
 *   createToken(spec), fetchLand(filter, {tapped, toHand}), earthbend(n),
 *   copySpell(card), oncePerTurn(perm), revealTop(n, opts),
 *   revealUntil(pred, n, opts), exileLands(n), putLandFromEffect(card, opts),
 *   mill(n), returnLandsFromGraveyard(opts), drawCard(),
 *   putLandFromHand(opts), putPermanentFromHand(maxMv), explore(perm),
 *   graveHas(pred), random(), touch(), note(text).
 * A permanent (`perm`) has `card` (its plan card), `counters`, `tapped`,
 * `token` and `animated` (a land made a creature).
 *
 * Deterministic for a seed; pure and DOM-free (tests/models/plan.node.test.js).
 */

import { asLibrary, commandersOf, isLibrary, sameCard, nameKey, cardTypes, frontTypeLine } from './library.js';
import { mulberry32, shuffle } from './random.js';
import { quantile } from './stats.js';
import { classifyRamp, basicTypesIn, typeBits, stripReminder } from './ramp.js';
import { classifyLand, TAP as LAND_TAP } from './manaDevelopment.js';
import { toLabCard, identityOf, maskOf, assignPips, OPENING_HAND, MIN_HAND, libraryKey, buildPlaceholderLibrary } from './handLab.js';
import { cardRule, MODE, ANY, G as GREEN } from './planRules.js';
import { normalizePlan, compileGroup, planKey } from './planSchema.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_TURNS = 12;
export const DEFAULT_GAMES = 5000;
/** Fixed seed: the same deck and plan always give the same numbers. */
export const SEED = 0x706c616e;
export const SAMPLE_GAMES = 4;
/** Mana tracked per turn; anything above counts as this much. */
export const MAX_MANA = 40;

/**
 * The keep rule: lands in range, plus (kind 'plan') a card for the plan's
 * first step that those lands can cast — asked of seven-card hands only, so
 * the free mulligan digs for the plan and a smaller hand is kept on lands.
 */
export const DEFAULT_KEEP = Object.freeze({ kind: 'plan', minLands: 2, maxLands: 4 });

/** Why a step missed its turn (stored with the colour it lacked in bits 8+). */
export const REASON = Object.freeze({ NONE: 0, NO_CARD: 1, LAND: 2, MANA: 3, COLOUR: 4, AFTER: 5, NO_PACKAGE: 6, SHORT: 7, OTHER: 8, FIT: 9, NO_COPY: 10 });

/** How a land enters: Mana Development's kinds plus shocks and battle lands. */
export const TAP = Object.freeze({ ...LAND_TAP, SHOCK: 5, BASICS: 6 });
const TAP_OF_RULE = Object.freeze({ untapped: TAP.UNTAPPED, tapped: TAP.TAPPED, shock: TAP.SHOCK, basics: TAP.BASICS, types: TAP.CHECK });

const CAST = 1;
const MANA = 2;
const PACKAGE = 3;
const SPEND = 4;
const RAMP = 5;
const KIND = Object.freeze({ cast: CAST, mana: MANA, package: PACKAGE, spend: SPEND, ramp: RAMP });

const BITS = Int8Array.from({ length: 32 }, (_, m) => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; });
const lowBit = m => m & -m;
const FOREST_BIT = typeBits(['forest']);
/** Payment priorities: lower is spent first. */
const PRI = Object.freeze({ POOL: 0, CONVOKE: 1, LAND: 2, RAMP: 3, RULE: 4, GROWS: 5, TREASURE: 6 });

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

/**
 * A fetchland's search: {kind 0 any | 1 basic | 2 basic types, bits, tapped,
 * life} or null. Only a free sacrifice ({T}, maybe life) cracks on the turn
 * it's played: Urza's Cave's {3} search is not a fetchland.
 */
function fetchOf(record) {
    const text = stripReminder(String(record?.oracle_text ?? '').toLowerCase());
    const m = text.match(/(?:^|\n)([^\n:]*?)sacrifice (?:this land|[^:.]*?): search your library for an? ([a-z ,/]+?) cards?, put (?:it|that card) onto the battlefield( tapped)?/);
    if (!m || /\{(?!t\})[^}]*\}/.test(m[1])) return null;
    const types = basicTypesIn(m[2]);
    const basic = /\bbasic\b/.test(m[2]);
    const life = m[1].match(/pay (\d+) life/);
    return Object.freeze({ kind: basic ? 1 : types.length ? 2 : 0, bits: typeBits(types), tapped: Boolean(m[3]), life: life ? Number(life[1]) : 0 });
}

function hasKeyword(text, word) {
    return text.split('\n').some(line => new RegExp(`^(?:[a-z ]+, )*${word}(?:,|$| \\(|\\.)`).test(line.trim()));
}

/** A land rule's fields on a plan card (lands and MDFC land faces). */
function applyLandRule(card, lr) {
    card.lmana = lr.n;
    card.mask = lr.mask;
    card.ltap = TAP_OF_RULE[lr.tap] ?? TAP.UNTAPPED;
    card.lcheckBits = lr.tap === 'types' ? lr.checkBits : 0;
    card.lbasics = lr.basics ?? 0;
    card.llife = lr.life ?? 0;
    card.lextraMask = lr.extraMask ?? 0;
    card.lextraBits = lr.extraBits ?? 0;
    card.hideaway = lr.hideaway ?? 0;
    card.allForests = Boolean(lr.allForests);
    return card;
}

/** An MDFC's land face as a land plan card (`front` = its spell side, if kept). */
function faceCard(record, face, identity, multiplayer, front = null) {
    const card = toPlanCard({ name: face.name, type_line: 'Land', oracle_text: '' }, identity, { multiplayer });
    card.name = front ? face.name : String(record.name);
    card.key = nameKey(record.name);
    card.record = record;
    card.mdfc = true;
    card.front = front;
    card.rule = front ? null : cardRule(record);
    return applyLandRule(card, face.land);
}

/**
 * A card as the engine reads it: one object per distinct card, shared by its
 * copies. Every card has every field, in the same order.
 * @param {Object} record - Scryfall-shaped card record
 * @param {string[]} identity - deck colour identity
 * @param {{multiplayer?:boolean, commander?:boolean}} [opts]
 */
export function toPlanCard(record, identity, { multiplayer = true, commander = false } = {}) {
    const rule = cardRule(record);
    if (rule?.face?.use === 'land' && !commander) return faceCard(record, rule.face, identity, multiplayer);
    const lab = toLabCard(record, 0, identity);
    const front = frontTypeLine(record?.type_line);
    const types = cardTypes(record?.type_line);
    const subtypes = ` ${(front.split(/\s[—-]\s/)[1] ?? '').trim()} `;
    const text = stripReminder(String(record?.oracle_text ?? '').toLowerCase());
    const land = lab.land;
    const lr = land ? rule?.land ?? null : null;
    const l = land && !lr ? classifyLand(record, { multiplayer }) : null;
    const hasRamp = !land && rule && Object.prototype.hasOwnProperty.call(rule, 'ramp');
    const ramp = land ? null : hasRamp ? rule.ramp : classifyRamp(record, { identity });
    const legendary = /\blegendary\b/.test(front);
    const saga = /\bsaga\b/.test(subtypes);
    const colors = Array.isArray(record?.colors) ? maskOf(record.colors) : lab.pips.reduce((m, p) => m | p, 0);
    const manaSource = !land && Boolean(rule?.manaSource || rule?.mana || (ramp?.modelled && ramp.mana > 0));
    const xCount = land ? 0 : (String(record?.mana_cost ?? '').match(/\{x\}/gi) ?? []).length;
    const card = {
        name: String(record?.name ?? ''),
        key: nameKey(record?.name),
        record,
        commander,
        token: false,
        treasure: false,
        placeholder: false,
        land,
        mdfc: false,
        front: null,
        face: null,
        mv: lab.mv,
        playMv: lab.playMv,
        xCount,
        xMin: xCount ? Math.max(0, rule?.x?.min ?? 1) : 0,
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
        legendarySpell: legendary && (types.includes('sorcery') || types.includes('instant')),
        convoke: !land && hasKeyword(text, 'convoke'),
        subtypes,
        town: / town /.test(subtypes),
        power: stat(record?.power),
        toughness: stat(record?.toughness),
        haste: hasKeyword(text, 'haste') || Boolean(rule?.haste),
        lmana: l ? l.mana : 0,
        ltap: l ? l.tap : TAP.UNTAPPED,
        lcheckBits: typeBits(l?.checkTypes ?? []),
        lbasics: 0,
        llife: 0,
        lextraMask: 0,
        lextraBits: 0,
        hideaway: 0,
        allForests: false,
        typeBits: land ? typeBits(basicTypesIn(front)) : 0,
        basic: land && /\bbasic\b/.test(front),
        lbounce: l ? l.bounce : false,
        fetch: land ? fetchOf(record) : null,
        ramp,
        rule,
        manaSource,
        isRamp: !land && Boolean(ramp?.ramp || manaSource || rule?.rampValue > 0),
        landsFetched: land ? 0 : rule?.landsFetched ?? (ramp ? ramp.lands + ramp.toHand : 0),
        entersTapped: !land && (ramp?.ready === 'tapped' || /\benters tapped\b/.test(text)),
        hooked: isHooked(rule)
    };
    if (lr) applyLandRule(card, lr);
    if (rule?.face?.use === 'either') card.face = faceCard(record, rule.face, identity, multiplayer, card);
    return card;
}

const HOOKS = ['onCast', 'onOtherEnter', 'onLandEnter', 'onCombat', 'onEndStep', 'onMainPhase', 'discountOthers', 'copies', 'landsFromGraveyard', 'fromTop', 'tapBoost', 'landBoost', 'anthem'];

/** Does a rule watch the game (the engine keeps such permanents in lists)? */
function isHooked(rule) {
    return Boolean(rule) && HOOKS.some(h => rule[h]);
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
            info: s.info === true,
            kind: KIND[r.kind],
            atLeast: r.atLeast ?? 0,
            paid: r.paid ?? 0,
            copied: r.copied === true,
            match: r.kind === 'cast' ? compileGroup(r.group) : r.kind === 'spend' ? compileGroup(r.group ?? { is: 'any' }) : null,
            after: r.kind === 'cast' && r.after ? compileGroup(r.after) : null,
            options: r.kind === 'package' ? r.options.map(o => ({ count: o.count, match: compileGroup(o.group) })) : [],
            step: s
        };
    });
}

function stepMatches(step, card) {
    if (step.kind === CAST || step.kind === SPEND) return step.match(card, card.mv + (card.xCount ? Math.max(1, card.xMin) * card.xCount : 0));
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
        this.flipped = false;
        this.exiled = null;
        this.viaKodama = false;
    }
}

const NO_WATCHERS = Object.freeze({
    cast: [], other: [], land: [], combat: [], end: [], main: [], discount: [], copiers: [], graveLands: false, topHistoric: false, boosts: false
});

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
        this.grave = [];
        this.perms = [];
        this.spare = [];
        this.pool = new Int32Array(256);
        this.poolLen = 0;
        this.turn = 0;
        this.life = run.startLife;
        this.spent = 0;
        this.peak = 0;
        this.avail = 0;
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
        this.basicCount = 0;
        this.allForests = false;
        this.version = 0;
        this.permsVersion = 0;
        this.cacheVersion = -1;
        this.cDistinct = 0;
        this.cMaxPower = -1;
        this.cColors = 0;
        this.cBoostN = 0;
        this.cBoostMask = 0;
        this.cLandSame = 0;
        this.cLandN = 0;
        this.cLandMask = 0;
        this.cAnthem = 0;
        this.subVersion = -1;
        this.subCounts = new Map();
        this.devVersion = -1;
        this.devCounts = new Map();
        this.watchVersion = -1;
        this.watch = NO_WATCHERS;
        this.castsThisTurn = [];
        this.stepTurn = new Int8Array(run.steps.length);
        this.stepReason = new Int32Array(run.steps.length);
        this.stepValue = new Int32Array(run.steps.length);
        this.spend = new Int32Array(run.steps.length);
        this.stepNeed = 0;
        this.handNeed = 0;
        this.castX = 0;
        this.copiedNow = false;
        this.rampCast = 0;
        this.markViaKodama = false;
        this.entry = null;
        this.notes = null;
        // output() results (no allocation per call)
        this.oN = 0;
        this.oMask = 0;
        this.oMode = 0;
        this.oPri = 0;
        this.oBoostN = 0;
        this.oBoostMask = 0;
        // potential() cache: valid while the board, the taps and the pool are unchanged
        this.taps = 0;
        this.potVersion = -1;
        this.potTaps = -1;
        this.potPool = -1;
        this.potN = 0;
    }

    // ── Setup ───────────────────────────────────────────────────────────────

    reset(hand, lib, libLen) {
        this.lib = lib;
        this.libLen = libLen;
        if (this.taken.length < libLen + 64) this.taken = new Uint8Array(libLen + 64);
        this.taken.fill(0, 0, this.taken.length);
        this.top = 0;
        this.hand.length = 0;
        for (const c of hand) this.hand.push(c);
        this.command.length = 0;
        for (const c of this.run.commanders) this.command.push(c);
        this.grave.length = 0;
        for (const p of this.perms) this.spare.push(p);
        this.perms.length = 0;
        this.poolLen = 0;
        this.turn = 0;
        this.life = this.run.startLife;
        this.spent = 0;
        this.peak = 0;
        this.avail = 0;
        this.turnColors = 0;
        this.drops = 1;
        this.dropsUsed = 0;
        this.extraDrops = 0;
        this.fromTop = false;
        this.missedDrops = 0;
        this.landCount = 0;
        this.landTypes = 0;
        this.landMask = 0;
        this.basicCount = 0;
        this.allForests = false;
        this.version++;
        this.permsVersion++;
        this.taps++;
        this.castsThisTurn.length = 0;
        this.stepTurn.fill(0);
        this.stepReason.fill(0);
        this.stepValue.fill(-1);
        this.spend.fill(0);
        this.rampCast = 0;
        this.markViaKodama = false;
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
        p.flipped = false;
        p.exiled = null;
        p.viaKodama = this.markViaKodama;
        return p;
    }

    /** Permanents with hooks, rebuilt when the battlefield changes. */
    watchers() {
        if (this.watchVersion === this.permsVersion) return this.watch;
        this.watchVersion = this.permsVersion;
        const w = { cast: [], other: [], land: [], combat: [], end: [], main: [], discount: [], copiers: [], graveLands: false, topHistoric: false, boosts: false };
        for (const p of this.perms) {
            const r = p.card.rule;
            if (!r || p.dead) continue;
            if (r.onCast) w.cast.push(p);
            if (r.onOtherEnter) w.other.push(p);
            if (r.onLandEnter) w.land.push(p);
            if (r.onCombat) w.combat.push(p);
            if (r.onEndStep) w.end.push(p);
            if (r.onMainPhase) w.main.push(p);
            if (r.discountOthers) w.discount.push(p);
            if (r.copies) w.copiers.push(p);
            if (r.landsFromGraveyard) w.graveLands = true;
            if (r.fromTop?.historic) w.topHistoric = true;
            if (r.tapBoost || r.landBoost) w.boosts = true;
        }
        this.watch = w;
        return w;
    }

    // ── Rules API ───────────────────────────────────────────────────────────

    note(text) {
        if (this.notes) this.notes.push(String(text));
    }

    touch() {
        this.version++;
        this.permsVersion++;
    }

    random() {
        return this.run.rng();
    }

    isCreature(perm) {
        if (perm.animated) return true;
        const r = perm.card.rule;
        if (r?.creature) return Boolean(r.creature(perm, this));
        return perm.card.creature;
    }

    powerOf(perm) {
        this.refresh();
        const r = perm.card.rule;
        const base = perm.animated ? 0 : (r?.power ? r.power(perm, this) : perm.card.power ?? 0);
        return base + perm.counters + this.cAnthem - (r?.anthem && this.isCreature(perm) ? r.anthem : 0);
    }

    refresh() {
        if (this.cacheVersion === this.version) return;
        this.cacheVersion = this.version;
        let anthem = 0;
        for (const p of this.perms) if (p.card.rule?.anthem && !p.dead && this.isCreature(p)) anthem += p.card.rule.anthem;
        this.cAnthem = anthem;
        let powers = 0;
        let max = -1;
        let colors = 0;
        let boostN = 0;
        let boostMask = 0;
        let landSame = 0;
        let landN = 0;
        let landMask = 0;
        for (const p of this.perms) {
            if (p.dead) continue;
            colors |= p.card.colors;
            const r = p.card.rule;
            if (r) {
                if (r.tapBoost) { boostN += r.tapBoost.n; boostMask |= r.tapBoost.mask; }
                if (r.landBoost) {
                    if (r.landBoost.same) landSame += r.landBoost.n;
                    else { landN += r.landBoost.n; landMask |= r.landBoost.mask; }
                }
            }
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
        this.cLandSame = landSame;
        this.cLandN = landN;
        this.cLandMask = landMask;
    }

    distinctPowers() {
        this.refresh();
        return this.cDistinct;
    }

    controlsPower(n) {
        this.refresh();
        return this.cMaxPower >= n;
    }

    greatestPower() {
        this.refresh();
        return Math.max(0, this.cMaxPower);
    }

    colorsAmongPermanents() {
        this.refresh();
        return this.cColors;
    }

    countCreatures() {
        let n = 0;
        for (const p of this.perms) if (!p.dead && this.isCreature(p)) n++;
        return n;
    }

    /** Creatures with power n+ that could attack this turn (not summoning sick). */
    countAttackers(n) {
        let k = 0;
        for (const p of this.perms) {
            if (p.dead || !this.isCreature(p) || this.powerOf(p) < n) continue;
            if (p.ready <= this.turn || p.animated || p.card.haste) k++;
        }
        return k;
    }

    distinctLandNames() {
        const names = new Set();
        for (const p of this.perms) if (p.card.land && !p.dead) names.add(p.card.key);
        return names.size;
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
        this.taps++;
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
            // A land you tap every turn, untapped, not yet a creature; one making white most of all
            // (it taps for {W} and the Cub's {G}).
            const score = (p.tapped ? 0 : 8) + (p.animated ? 0 : 4) + (p.card.mask & ~GREEN ? 2 : 0) + BITS[p.card.mask & 31];
            if (!pick || score > pick.score) pick = { p, score };
        }
        if (!pick) return null;
        pick.p.animated = true;
        pick.p.counters += n;
        this.version++;
        return pick.p;
    }

    copySpell(card) {
        this.copiedNow = true;
        this.resolve(card, { x: this.castX, copy: true });
    }

    oncePerTurn(perm) {
        if (perm.once === this.turn) return false;
        perm.once = this.turn;
        return true;
    }

    drawCard() {
        return this.draw();
    }

    graveHas(pred) {
        return this.grave.some(pred);
    }

    mill(n) {
        for (let k = 0; k < n; k++) {
            this.advanceTop();
            if (this.top >= this.libLen) return;
            this.taken[this.top] = 1;
            this.grave.push(this.lib[this.top]);
            this.advanceTop();
        }
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

    topCard() {
        this.advanceTop();
        return this.top < this.libLen ? this.lib[this.top] : null;
    }

    libLeft() {
        let n = 0;
        for (let i = this.top; i < this.libLen; i++) if (!this.taken[i]) n++;
        return n;
    }

    /** Put a card on the bottom of the library. */
    toBottom(card) {
        if (this.libLen >= this.taken.length) {
            const grown = new Uint8Array(this.taken.length * 2);
            grown.set(this.taken);
            this.taken = grown;
        }
        this.lib[this.libLen] = card;
        this.taken[this.libLen] = 0;
        this.libLen++;
    }

    /** Hideaway n: the top n leave the top — one exiled, the rest to the bottom. */
    hideaway(n) {
        const picked = [];
        for (let i = this.top; i < this.libLen && picked.length < n; i++) if (!this.taken[i]) picked.push(i);
        for (const i of picked) this.taken[i] = 1;
        this.advanceTop();
        for (let k = 1; k < picked.length; k++) this.toBottom(this.lib[picked[k]]);
        if (picked.length) this.note(`hideaway: ${this.lib[picked[0]].name} exiled, ${picked.length - 1} to the bottom`);
    }

    /**
     * Look at the top n: the picked cards (best first, at most `max`) go onto
     * the battlefield or into your hand; the rest to the bottom, the
     * graveyard, or stay where they are.
     */
    revealTop(n, { pick, max = Infinity, tapped = false, toHand = false, rest = 'bottom', best = null } = {}) {
        const idx = [];
        for (let i = this.top; i < this.libLen && idx.length < n; i++) if (!this.taken[i]) idx.push(i);
        let chosenIdx = idx.filter(i => pick(this.lib[i]));
        if (best) chosenIdx.sort((a, b) => best(this.lib[b]) - best(this.lib[a]));
        if (chosenIdx.length > max) chosenIdx = chosenIdx.slice(0, max);
        const taking = new Set(chosenIdx);
        const others = idx.filter(i => !taking.has(i));
        for (const i of chosenIdx) this.taken[i] = 1;
        if (rest !== 'stay') for (const i of others) this.taken[i] = 1;
        const found = chosenIdx.map(i => this.lib[i]);
        if (rest === 'bottom') for (const i of others) this.toBottom(this.lib[i]);
        else if (rest === 'grave') for (const i of others) this.grave.push(this.lib[i]);
        this.advanceTop();
        for (const c of found) {
            if (toHand) this.hand.push(c);
            else this.putOntoBattlefield(c, tapped);
        }
        return found;
    }

    /** Reveal until n cards match: those onto the battlefield, the rest to the bottom. */
    revealUntil(pred, n, { tapped = true } = {}) {
        const found = [];
        const misses = [];
        for (let i = this.top; i < this.libLen && found.length < n; i++) {
            if (this.taken[i]) continue;
            this.taken[i] = 1;
            if (pred(this.lib[i]) && !this.lib[i].mdfc) found.push(this.lib[i]);
            else misses.push(this.lib[i]);
        }
        this.advanceTop();
        for (const c of misses) this.toBottom(c);
        for (const c of found) this.putOntoBattlefield(c, tapped);
        return found;
    }

    putOntoBattlefield(card, tapped) {
        if (card.land) this.putLand(card, tapped || card.lbounce || this.entersTappedLand(card));
        else if (card.permanent) {
            const p = this.enter(card);
            if (tapped) p.tapped = true;
        } else this.grave.push(card);
    }

    putLandFromEffect(card, { tapped = true } = {}) {
        this.putLand(card, tapped || card.lbounce || this.entersTappedLand(card));
    }

    /** Exile up to n land cards with different names from the library (best colours first). */
    exileLands(n) {
        this.needMasks();
        const out = [];
        const names = new Set();
        for (let k = 0; k < n; k++) {
            let bi = -1;
            let bs = -Infinity;
            for (let i = this.top; i < this.libLen; i++) {
                const c = this.lib[i];
                if (this.taken[i] || !c.land || c.mdfc || names.has(c.key)) continue;
                const s = BITS[c.mask & this.stepNeed & 31] * 100 + BITS[c.mask & 31] * 10 + c.lmana - (c.fetch ? 5 : 0);
                if (s > bs) { bs = s; bi = i; }
            }
            if (bi < 0) break;
            this.taken[bi] = 1;
            names.add(this.lib[bi].key);
            out.push(this.lib[bi]);
        }
        this.advanceTop();
        return out;
    }

    returnLandsFromGraveyard({ tapped = true } = {}) {
        const lands = this.grave.filter(c => c.land);
        this.grave = this.grave.filter(c => !c.land);
        for (const c of lands) this.putLand(c, tapped || this.entersTappedLand(c));
        return lands;
    }

    putLandFromHand({ tapped = true } = {}) {
        let best = -1;
        for (let i = 0; i < this.hand.length; i++) {
            const c = this.hand[i];
            if (c.land && (best < 0 || BITS[c.mask & 31] > BITS[this.hand[best].mask & 31])) best = i;
        }
        if (best < 0) return null;
        const c = this.hand.splice(best, 1)[0];
        this.putLand(c, tapped || this.entersTappedLand(c));
        return c;
    }

    /** Put the best permanent card with mana value ≤ maxMv from your hand onto the battlefield (Kodama). */
    putPermanentFromHand(maxMv) {
        let best = -1;
        let bestScore = -Infinity;
        for (let i = 0; i < this.hand.length; i++) {
            const c = this.hand[i];
            if (!c.permanent || c.mv > maxMv) continue;
            const s = c.land ? 50 + c.lmana : c.mv * 10 + (c.manaSource ? 5 : 0);
            if (s > bestScore) { bestScore = s; best = i; }
        }
        if (best < 0) return null;
        const c = this.hand.splice(best, 1)[0];
        this.markViaKodama = true;
        let perm;
        if (c.land) {
            this.putLand(c, c.lbounce || this.entersTappedLand(c));
            perm = this.perms[this.perms.length - 1] ?? null;
        } else {
            perm = this.enter(c);
        }
        this.markViaKodama = false;
        return perm;
    }

    /** It explores: a land on top goes to your hand; otherwise a +1/+1 counter, and the card stays or is milled. */
    explore(perm) {
        const c = this.topCard();
        if (!c) return;
        if (c.land && !c.mdfc) {
            this.taken[this.top] = 1;
            this.advanceTop();
            this.hand.push(c);
            this.note(`${perm.card.name} explores: ${c.name} to hand`);
            return;
        }
        this.addCounters(perm, 1);
        const keep = this.run.steps.some(s => !s.info && !this.stepTurn[s.index] && stepMatches(s, c));
        if (!keep) this.mill(1);
        this.note(`${perm.card.name} explores: +1/+1 counter${keep ? '' : `, ${c.name} milled`}`);
    }

    onBattlefield(match) {
        for (const p of this.perms) if (!p.dead && match(p.card)) return true;
        return false;
    }

    /** Would this land enter tapped now? Shocks pay life only when their mana would be used this turn. */
    entersTappedLand(c) {
        switch (c.ltap) {
            case TAP.TAPPED: return true;
            case TAP.FAST: return this.landCount > 2;
            case TAP.SLOW: return this.landCount < 2;
            case TAP.CHECK: return ((this.landTypes | (this.allForests ? FOREST_BIT : 0)) & c.lcheckBits) === 0;
            case TAP.BASICS: return this.basicCount < c.lbasics;
            case TAP.SHOCK: return !this.manaWanted(c.mask | (this.allForests ? GREEN : 0), c.lmana);
            default: return false;
        }
    }

    /**
     * Would n more mana of `mask` this turn let you cast something you can't
     * cast now? (Pay a shock's life only then.)
     */
    manaWanted(mask, n = 1) {
        const cap = this.potential();
        const colors = this.availColors;
        // The plan's card for this turn, castable now: what's left after it is what more mana would add to.
        const plan = this.planCardNow();
        // Cards held for a later turn's spend or package step won't be cast this turn either way.
        const held = c => this.hand.includes(c) && this.held(c, true);
        if (plan) {
            const left = cap - this.costOf(plan, plan.xMin);
            const more = c => c !== plan && !c.land && !c.placeholder && c.playMv > left && c.playMv <= left + n && this.canCastNow(c) && !held(c);
            return this.hand.some(more) || this.command.some(more);
        }
        const test = c => {
            if (c.land || c.placeholder || c.playMv > cap + n || held(c)) return false;
            // Affordable already (enough mana, every colour there): more mana changes nothing.
            if (c.playMv <= cap && !c.convoke) {
                let ok = true;
                for (const pip of c.pips) if (!(pip & colors)) { ok = false; break; }
                if (ok || !(c.pipUnion & mask)) return false;
            }
            if (!this.canCastNow(c) || this.payCard(c, false, c.xMin)) return false;
            const at = this.poolLen;
            for (let k = 0; k < n && this.poolLen < this.pool.length; k++) this.pool[this.poolLen++] = mask;
            const ok = this.payCard(c, false, c.xMin);
            this.poolLen = at;
            return ok;
        };
        return this.hand.some(test) || this.command.some(test);
    }

    /**
     * The card the plan casts this turn if it can already: the cheapest card
     * for the first plan step due now (or late) that is a plain cast.
     */
    planCardNow() {
        for (const s of this.run.steps) {
            if (s.info || s.kind !== CAST || this.stepTurn[s.index] || s.turn > this.turn || s.copied || s.paid) continue;
            if (s.after && !this.onBattlefield(s.after)) continue;
            let best = null;
            const look = c => {
                if (c.land || !s.match(c) || (best && c.playMv >= best.playMv) || !this.canCastNow(c)) return;
                if (this.payCard(c, false, c.xMin)) best = c;
            };
            for (const c of this.hand) look(c);
            for (const c of this.command) look(c);
            return best;
        }
        return null;
    }

    recountLands() {
        let n = 0;
        let types = 0;
        let mask = 0;
        let basics = 0;
        let forests = false;
        for (const p of this.perms) {
            if (!p.card.land) continue;
            n++;
            types |= p.card.typeBits;
            mask |= p.card.mask;
            if (p.card.basic) basics++;
            if (p.card.allForests) forests = true;
        }
        this.landCount = n;
        this.landTypes = types | (forests ? FOREST_BIT : 0);
        this.landMask = mask | (forests ? GREEN : 0);
        this.basicCount = basics;
        this.allForests = forests;
    }

    /**
     * Put a land onto the battlefield (a fetchland cracks at once).
     * @param {string|null} [drop] - logged as the turn's land drop with this
     *   prefix ('' for a plain drop); null for lands a spell or trigger found
     */
    putLand(card, tapped, drop = null) {
        if (card.fetch) {
            this.life -= card.fetch.life;
            this.grave.push(card);
            // A fetchland put onto the battlefield tapped cracks next turn: its land is no help this turn either.
            const found = this.searchLand(card.fetch.kind, card.fetch.bits, true, card.fetch.tapped || tapped, drop === null ? null : `${drop}${card.name} → `);
            if (found) return;
            this.grave.pop();
            this.life += card.fetch.life;
        }
        const p = this.newPerm(card);
        p.tapped = tapped;
        p.dead = Boolean(card.fetch);
        if (!tapped && card.ltap === TAP.SHOCK) this.life -= card.llife;
        this.perms.push(p);
        this.landCount++;
        this.landTypes |= card.typeBits | (card.allForests ? FOREST_BIT : 0);
        this.landMask |= card.mask;
        if (card.basic) this.basicCount++;
        if (card.allForests) { this.allForests = true; this.landMask |= GREEN; }
        this.version++;
        if (card.hooked) this.permsVersion++;
        if (this.entry && drop !== null) this.entry.lands.push(`${drop}${card.name}${tapped ? ' (tapped)' : ''}`);
        if (card.lbounce) this.bounceLand(p);
        if (card.hideaway) this.hideaway(card.hideaway);
        this.afterEnter(p);
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
        if (perm.card.hooked) this.permsVersion++;
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
        if (card.hooked) this.permsVersion++;
        if (!setup) {
            card.rule?.onEnter?.(p, this);
            this.afterEnter(p);
        }
        return p;
    }

    /** Triggers on another permanent entering, and landfall. */
    afterEnter(p) {
        const w = this.watchers();
        if (w.other.length) for (const q of w.other) if (q !== p && !q.dead) q.card.rule.onOtherEnter(q, p, this);
        if (p.card.land && w.land.length) for (const q of w.land) if (!q.dead) q.card.rule.onLandEnter(q, p, this);
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
                if (s.info || this.stepTurn[s.index]) continue;
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
     * the one adding the colours you need most (untapped when its mana matters
     * now); put it onto the battlefield or into your hand.
     * @param {{town?:boolean, avoid?:Set<string>}} [opts] - Town cards count as basics; names to skip
     */
    searchLand(kind, bits, toBattlefield, tapped, drop = null, opts = null) {
        this.needMasks();
        const have = this.landMask;
        const wantNow = toBattlefield && !tapped;
        let cap = -1;
        let bi = -1;
        let bs = -Infinity;
        for (let i = this.top; i < this.libLen; i++) {
            if (this.taken[i]) continue;
            const c = this.lib[i];
            if (!c.land || c.mdfc || (c.placeholder && kind !== 0)) continue;
            if (kind === 1 && !(c.basic || (opts?.town && c.town))) continue;
            if (kind === 2 && !(c.typeBits & bits)) continue;
            if (opts?.avoid?.has(c.key)) continue;
            const fresh = c.mask & ~have;
            let s = BITS[fresh & this.stepNeed & 31] * 1000 + BITS[fresh & this.handNeed & 31] * 100 + BITS[fresh & 31] * 10 + BITS[c.mask & 31] * 2 + (c.fetch ? -5 : 0);
            if (wantNow) {
                // Untapped when its mana matters this turn (a shock then costs life: a basic does the
                // same job for free); a fetchland drop takes a tapped land when the mana doesn't matter.
                const flexible = c.ltap === TAP.SHOCK;
                const slow = !flexible && (c.lbounce || this.entersTappedLand(c));
                if (cap < 0) cap = this.manaWanted(this.anyMask, 1) ? 1 : 0;
                if (slow) s += cap ? -2000 : drop !== null ? 3 : 0;
                else if (!flexible) s += 1;
                else if (cap) s -= 2;
            }
            // Ties go to the deepest copy (any copy is as likely; a scripted library keeps its next draws).
            if (s >= bs) { bs = s; bi = i; }
        }
        if (bi < 0) return null;
        const c = this.lib[bi];
        this.taken[bi] = 1;
        if (bi === this.top) this.advanceTop();
        if (toBattlefield) {
            const t = tapped || c.lbounce || this.entersTappedLand(c);
            if (drop === null && this.notes) this.notes.push(`${c.name}${t ? ' (tapped)' : ''}`);
            this.putLand(c, t, drop);
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
        this.oBoostN = 0;
        this.oBoostMask = 0;
        if (c.land) {
            if (p.dead) return false;
            let mask = c.mask;
            if (this.allForests) mask |= GREEN;
            if (c.lextraMask && (this.landTypes & c.lextraBits)) mask |= c.lextraMask;
            const n = c.lmana > 0 ? c.lmana : (this.allForests ? 1 : 0);
            if (n <= 0) return false;
            this.oN = n;
            this.oMask = mask;
            this.oMode = MODE.EACH;
            this.oPri = PRI.LAND;
            if (this.watchers().boosts) {
                this.refresh();
                this.oN += this.cLandSame;
                if (this.cLandN) { this.oBoostN = this.cLandN; this.oBoostMask = this.cLandMask; }
            }
        } else if (c.treasure) {
            this.oN = 1;
            this.oMask = this.anyMask;
            this.oMode = MODE.EACH;
            this.oPri = PRI.TREASURE;
        } else if (c.rule?.mana) {
            const o = c.rule.mana(p, this);
            if (!o || !(o.n > 0)) return false;
            this.oN = o.n;
            this.oMask = o.mask === ANY ? this.anyMask : o.mask;
            this.oMode = o.mode ?? MODE.EACH;
            this.oPri = c.rule.grows ? PRI.GROWS : PRI.RULE;
        } else if (c.ramp?.modelled && c.ramp.mana > 0) {
            this.oN = c.ramp.mana;
            this.oMask = c.ramp.mask;
            this.oMode = MODE.EACH;
            this.oPri = PRI.RAMP;
        } else {
            return false;
        }
        if (this.watchers().boosts) {
            this.refresh();
            if (this.cBoostN && this.isCreature(p)) {
                this.oBoostN += this.cBoostN;
                this.oBoostMask |= this.cBoostMask;
            }
        }
        return true;
    }

    /**
     * Mana you could still make this turn: floating plus every untapped
     * source. Also sets availColors, the colours that mana can be.
     */
    potential() {
        if (this.potVersion === this.version && this.potTaps === this.taps && this.potPool === this.poolLen) {
            this.turnColors |= this.availColors;
            return this.potN;
        }
        let n = this.poolLen;
        let colors = 0;
        for (let i = 0; i < this.poolLen; i++) colors |= this.pool[i];
        for (const p of this.perms) {
            if (!this.canTap(p) || !this.output(p)) continue;
            n += this.oN + this.oBoostN;
            colors |= this.oMask | this.oBoostMask;
        }
        this.availColors = colors;
        this.turnColors |= colors;
        this.potVersion = this.version;
        this.potTaps = this.taps;
        this.potPool = this.poolLen;
        this.potN = n;
        return n;
    }

    /** What every mana source you control makes, tapped or not (next turn's mana, ramp values). */
    capacity() {
        let n = 0;
        for (const p of this.perms) {
            if (p.dead || !this.output(p)) continue;
            n += this.oN + this.oBoostN;
        }
        return n;
    }

    /** Generic mana a spell costs less now (its own discount and your permanents'). */
    discountFor(card) {
        let d = card.rule?.discount ? card.rule.discount(this) : 0;
        const w = this.watchers();
        for (const p of w.discount) d += p.card.rule.discountOthers(card, this) || 0;
        return d;
    }

    /** Mana a spell costs with X = x, after discounts. */
    costOf(card, x = 0) {
        const generic = Math.max(0, card.mv - card.pips.length + x * card.xCount + (card.ramp?.extraCost ?? 0) - this.discountFor(card));
        return card.pips.length + generic;
    }

    /** Could the mana available now (amount, colours) possibly pay for this card? A quick filter before paying. */
    mightAfford(card, avail, x = card.xMin) {
        if (this.costOf(card, x) > avail + (card.convoke ? this.perms.length : 0)) return false;
        for (const pip of card.pips) if (!(pip & this.availColors) && !card.convoke) return false;
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
    buildUnits(pips, convoke) {
        uLen = 0;
        for (let i = 0; i < this.poolLen; i++) pushUnit(this.pool[i], -1 - i, PRI.POOL);
        demand.fill(0);
        supply.fill(0);
        for (const pip of pips) if (BITS[pip & 31] === 1) demand[pip & 31]++;
        let ones = 0;
        const perms = this.perms;
        for (let j = 0; j < perms.length; j++) {
            const p = perms[j];
            if (!this.canTap(p) || !this.output(p)) {
                // Convoke: a creature that can't tap for mana now (summoning sick, or no mana ability) pays {1} or its colour.
                if (convoke && !p.tapped && !p.dead && this.isCreature(p)) pushUnit(p.card.colors & 31, j, PRI.CONVOKE);
                continue;
            }
            for (let b = 0; b < this.oBoostN; b++) pushUnit(this.oBoostMask, j, this.oPri);
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
    pay(pips, generic, commit, convoke = false) {
        const total = pips.length + generic;
        if (pips.length > chosen.length) return false;
        this.buildUnits(pips, convoke);
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
            const keep = src < 0 || (tapped.includes(perms[src]) && uKey[i] >= PRI.LAND * 64);
            if (keep && len < poolNext.length) poolNext[len++] = uMask[i];
        }
        this.pool.set(poolNext.subarray(0, len));
        this.poolLen = len;
        this.taps++;
        for (const p of tapped) {
            p.tapped = true;
            if (p.card.treasure) this.removePerm(p);
        }
        this.spent += total;
        return true;
    }

    payCard(card, commit, x = card.xMin) {
        const generic = Math.max(0, card.mv - card.pips.length + x * card.xCount + (card.ramp?.extraCost ?? 0) - this.discountFor(card));
        return this.pay(card.pips, generic, commit, card.convoke);
    }

    /** The largest X you can pay now (from xMin), or -1. */
    chooseX(card, avail) {
        if (!card.xCount) return this.payCard(card, false, 0) ? 0 : -1;
        let x = Math.floor((avail + (card.convoke ? this.perms.length : 0) - this.costOf(card, 0)) / card.xCount);
        x = Math.min(x, this.libLeft(), 30);
        for (; x >= card.xMin; x--) if (this.payCard(card, false, x)) return x;
        return -1;
    }

    // ── Casting ─────────────────────────────────────────────────────────────

    controlsLegend() {
        for (const p of this.perms) {
            if (p.dead || !p.card.legendary || p.token) continue;
            if (this.isCreature(p) || p.card.planeswalker) return true;
        }
        return false;
    }

    /** Conditions beyond mana: a legendary sorcery needs a legend; some spells need a target. */
    canCastNow(card) {
        if (card.legendarySpell && !this.controlsLegend()) return false;
        if (card.rule?.castable && !card.rule.castable(card, this)) return false;
        return true;
    }

    /** Would a copy effect copy this spell if you cast it now? */
    wouldCopy(card) {
        for (const p of this.watchers().copiers) if (p.once !== this.turn && p.card.rule.copies(card)) return true;
        return false;
    }

    /**
     * Cast a card: pay, cast triggers (Selvala's token, the Doctor's copy),
     * credit the steps it meets, resolve.
     * @param {'hand'|'command'|'top'} from
     */
    cast(card, from = 'hand', x = card.xMin) {
        const paid = this.costOf(card, x);
        if (!this.payCard(card, true, x)) return false;
        if (from === 'top') {
            this.taken[this.top] = 1;
            this.advanceTop();
        } else {
            const zone = from === 'command' ? this.command : this.hand;
            const at = zone.indexOf(card);
            if (at >= 0) zone.splice(at, 1);
        }
        if (from === 'hand') this.castsThisTurn.push(card);
        if (card.isRamp && !card.commander) this.rampCast++;
        const stackMv = card.mv + x * card.xCount;
        const record = this.entry ? { name: card.name, from, step: -1, paid, x: card.xCount ? x : null, notes: [] } : null;
        if (record) this.entry.cast.push(record);
        const outer = this.notes;
        this.notes = record ? record.notes : null;
        // Cast triggers resolve before the spell (Selvala's token, the Doctor's copy).
        this.castX = x;
        this.copiedNow = false;
        const watchers = this.watchers().cast;
        for (const p of watchers) if (!p.dead) p.card.rule.onCast(p, card, this);
        const k = this.creditCast(card, paid, stackMv, this.copiedNow);
        if (record) record.step = k;
        this.resolve(card, { x, copy: false });
        if (!card.permanent) this.grave.push(card);
        if (from === 'hand') this.creditSpend(card, paid, stackMv);
        this.creditPackage();
        this.notes = outer;
        return true;
    }

    /** A spell resolves (or its copy): a permanent enters; ramp does what it does. */
    resolve(card, ctx) {
        if (card.permanent && !card.land) this.enter(card, { token: ctx.copy });
        else card.rule?.onResolve?.(this, ctx);
        const r = card.ramp;
        if (!r) return;
        if (r.sacrificeLand && this.landCount) {
            let worst = null;
            for (const p of this.perms) if (p.card.land && (!worst || BITS[p.card.mask & 31] < BITS[worst.card.mask & 31])) worst = p;
            if (worst) this.removePerm(worst);
        }
        if (r.lands) {
            const opts = r.distinct || r.filterTown ? { town: r.filterTown, avoid: r.distinct ? new Set() : null } : null;
            for (let k = 0; k < r.lands; k++) {
                const found = this.searchLand(r.filterKind, r.filterBits, true, r.landsTapped, null, opts);
                if (!found) break;
                opts?.avoid?.add(found.key);
            }
        }
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

    /**
     * Credit the cast steps this card meets. A cast counts towards one plan
     * step (the first it meets); information steps are credited alongside.
     * @returns {number} the plan step it met, or -1
     */
    creditCast(card, paid, stackMv, copied) {
        let met = -1;
        for (const s of this.run.steps) {
            if (s.kind !== CAST || this.stepTurn[s.index] || !s.match(card)) continue;
            if (s.after && !this.onBattlefield(s.after)) continue;
            if (s.paid && paid < s.paid) continue;
            if (s.copied && !copied) continue;
            if (!s.info && met >= 0) continue;
            this.markStep(s.index);
            // What the spell cost is worth showing only when the step is about it (copied, or paid n+).
            if (s.copied || s.paid) this.stepValue[s.index] = stackMv;
            if (!s.info) met = s.index;
        }
        return met;
    }

    /** Spend steps: mana paid this turn for matching spells from your hand. */
    creditSpend(card, paid, stackMv) {
        for (const s of this.run.steps) {
            if (s.kind !== SPEND || !s.match(card, stackMv)) continue;
            this.spend[s.index] += paid;
            if (!this.stepTurn[s.index] && this.spend[s.index] >= s.atLeast) this.markStep(s.index);
        }
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

    /** What a card adds to your mana with your commanders out too (0: not ramp now). */
    manaValueOf(card) {
        const ghosts = [];
        for (const c of this.command) if (c !== card && c.manaSource !== undefined) ghosts.push(this.newPerm(c));
        const before = this.perms.length;
        for (const g of ghosts) this.perms.push(g);
        this.version++;
        const base = this.capacity();
        const self = this.newPerm(card);
        this.perms.push(self);
        this.version++;
        const withCard = this.capacity();
        this.perms.length = before;
        this.version++;
        this.spare.push(self, ...ghosts);
        return withCard - base;
    }

    /** How much a ramp card adds, for choosing between them (0: not ramp now). */
    rampValue(card) {
        let v = 0;
        const r = card.ramp;
        const rule = card.rule;
        if (card.manaSource) {
            v += this.manaValueOf(card);
            if (rule?.onMainPhase) v += 2;
            if (rule?.earthbend && rule?.tapBoost) v += 2;
        }
        if (v > 0 && card.creature && !card.haste) v *= 0.95;
        if (r?.lands || r?.toHand) v += r.lands * (r.landsTapped ? 1 : 1.25) + r.toHand * 0.5;
        if (r?.extraDrops) v += 0.6 * r.extraDrops;
        if (r?.extraDropsOnce && this.hand.some(c => c.land) && this.dropsUsed >= this.drops) v += 0.8;
        if (r?.putLand && this.hand.some(c => c.land && (!r.putLandBasic || c.basic))) v += 0.8;
        if (r?.treasure) v += 0.5 * r.treasure;
        if (rule?.rampValue) v += rule.rampValue * (card.xCount ? Math.max(1, this.chooseX(card, this.potential())) : 1);
        if (r?.sacrificeLand) v -= r.sacrificeLand;
        return v;
    }

    /** Is this card held for a package or spend step that hasn't happened (`later`: due after this turn)? */
    held(card, later = false) {
        for (const s of this.run.steps) {
            if (s.info || this.stepTurn[s.index] || (later && s.turn <= this.turn)) continue;
            if (s.kind === PACKAGE && s.options.some(o => o.match(card))) return true;
            if (s.kind === SPEND && stepMatches(s, card)) return true;
        }
        return false;
    }

    /** Pursue the plan: one step if any can be done now. */
    tryStep() {
        const steps = this.run.steps;
        // Steps still on time first, in plan order; then the late ones.
        for (let pass = 0; pass < 2; pass++) {
            for (const s of steps) {
                if (s.info || this.stepTurn[s.index] || s.kind === MANA || s.kind === RAMP) continue;
                const late = s.turn < this.turn;
                if (late !== (pass === 1)) continue;
                if (s.after && !this.onBattlefield(s.after)) continue;
                const done = s.kind === CAST ? this.tryCastStep(s) : s.kind === PACKAGE ? this.tryPackage(s) : this.trySpend(s);
                if (done) return true;
            }
        }
        return false;
    }

    /** The library's top card, when a permanent lets you cast it (Crystal Skull: historic). */
    castableTop() {
        if (!this.watchers().topHistoric) return null;
        const c = this.topCard();
        return c && !c.land && c.historic ? c : null;
    }

    tryCastStep(s) {
        let best = null;
        let bestFrom = 'hand';
        let bestX = 0;
        let bestScore = -Infinity;
        const avail = this.potential();
        const big = s.copied || s.paid > 0;
        const look = (c, from) => {
            if (c.land || !s.match(c) || !this.mightAfford(c, avail) || !this.canCastNow(c)) return;
            if (s.copied && !this.wouldCopy(c)) return;
            const x = c.xCount ? this.chooseX(c, avail) : c.xMin;
            if (x < 0) return;
            const paid = this.costOf(c, x);
            if (s.paid && paid < s.paid) return;
            // A copied or "pays n+" step wants the biggest spell; anything else the cheapest, mana first.
            // (Same size: one that makes mana — a copied Ugin's 0 or a copied land doubler pays for more.)
            const score = big ? paid * 10 + (c.manaSource ? 5 : 0) + (c.creature ? 1 : 0) : (c.manaSource ? this.rampValue(c) * 100 : 0) - c.playMv;
            if (score <= bestScore || !this.payCard(c, false, x)) return;
            best = c;
            bestFrom = from;
            bestX = x;
            bestScore = score;
        };
        for (const c of this.hand) look(c, 'hand');
        for (const c of this.command) look(c, 'command');
        const top = this.castableTop();
        if (top) look(top, 'top');
        return best ? this.cast(best, bestFrom, bestX) : false;
    }

    tryPackage(s) {
        for (const o of s.options) {
            const cards = this.hand.filter(c => !c.land && o.match(c) && this.canCastNow(c)).sort((a, b) => a.playMv - b.playMv).slice(0, o.count);
            if (cards.length < o.count) continue;
            const pips = cards.flatMap(c => c.pips).sort((a, b) => BITS[a & 31] - BITS[b & 31]);
            const generic = cards.reduce((n, c) => n + this.costOf(c, c.xMin), 0) - pips.length;
            if (!this.pay(pips, generic, false)) continue;
            // Most demanding colours first; a creature first feeds Selvala-style triggers.
            cards.sort((a, b) => b.pips.length - a.pips.length || Number(b.creature) - Number(a.creature));
            let cast = 0;
            for (const c of cards) if (this.cast(c, 'hand')) cast++;
            if (cast) return true;
        }
        return false;
    }

    /**
     * Mana you could make after casting `card` with X = x: its permanent and
     * cast tokens join the board, and the cost is paid the way pay() pays —
     * fixed sources first, then the sources that grow (Selvala, Bloom
     * Tender), which are tapped at what they make now and grow no more.
     */
    projectAfter(card, x) {
        const cost = this.costOf(card, x);
        let fixed = this.poolLen;
        const grow = [];
        for (const p of this.perms) {
            if (!this.canTap(p) || !this.output(p)) continue;
            const n = this.oN + this.oBoostN;
            if (this.oPri === PRI.GROWS) grow.push({ p, n, next: n });
            else fixed += n;
        }
        const before = this.perms.length;
        if (card.permanent) {
            const g = this.newPerm(card);
            g.ready = this.isCreatureCard(card) && !card.haste ? this.turn + 1 : this.turn;
            g.tapped = card.entersTapped;
            this.perms.push(g);
        }
        if (card.creature) {
            for (const w of this.watchers().cast) {
                const spec = w.card.rule.castToken;
                if (spec) { const t = this.newPerm(tokenCard(spec)); t.ready = this.turn + 1; this.perms.push(t); }
            }
        }
        this.version++;
        let added = 0;
        for (const q of this.perms) {
            if (!this.canTap(q) || !this.output(q)) continue;
            const g = grow.find(o => o.p === q);
            if (g) g.next = this.oN + this.oBoostN;
            else if (q.ready === this.turn && this.perms.indexOf(q) >= before) added += this.oN + this.oBoostN;
        }
        this.potential();
        const colors = this.availColors;
        while (this.perms.length > before) this.spare.push(this.perms.pop());
        this.version++;
        this.potential();
        // Pay: fixed first, then the growers that grow least.
        let need = cost - fixed;
        let mana = fixed + added - cost;
        grow.sort((a, b) => (a.next - a.n) - (b.next - b.n));
        for (const g of grow) {
            if (need > 0) { need -= g.n; mana += g.n; } else mana += g.next;
        }
        return { mana, colors };
    }

    /**
     * A spend step: cast the best single spell or ordered pair from your hand
     * — only if it reaches the step's target this turn.
     */
    trySpend(s) {
        const need = s.atLeast - this.spend[s.index];
        const avail = this.potential();
        const cands = [];
        for (const c of this.hand) {
            if (c.land || c.placeholder || !this.canCastNow(c)) continue;
            if (!stepMatches(s, c) || !this.mightAfford(c, avail)) continue;
            const x = c.xCount ? this.chooseX(c, avail) : (this.payCard(c, false, c.xMin) ? c.xMin : -1);
            if (x < 0 || !s.match(c, c.mv + x * c.xCount)) continue;
            if (cands.some(o => o.card === c)) continue;
            cands.push({ card: c, x, paid: this.costOf(c, x) });
        }
        if (!cands.length) return false;
        let best = null;
        for (const a of cands) if (!best || a.paid > best.total) best = { first: a, total: a.paid };
        // The most mana on threats this turn: a pair beats one big spell when it adds up to more.
        for (const a of cands) {
            const after = this.projectAfter(a.card, a.x);
            for (const b of this.hand) {
                if (b === a.card || b.land || b.placeholder || !this.canCastNow(b) || !stepMatches(s, b)) continue;
                let paid;
                if (b.xCount) {
                    const x = Math.min(30, Math.floor((after.mana - this.costOf(b, 0)) / b.xCount));
                    if (x < b.xMin) continue;
                    paid = this.costOf(b, x);
                } else {
                    paid = this.costOf(b, b.xMin);
                    if (paid > after.mana) continue;
                }
                if (b.pips.some(pip => !(pip & after.colors))) continue;
                const total = a.paid + paid;
                // Same total: a creature first (it feeds Selvala-style mana).
                if (total > best.total || (total === best.total && a.card.creature && !best.first.card.creature)) best = { first: a, total };
            }
        }
        // Short of the target: still the natural play on the step's turn (your biggest threats) —
        // unless an earlier step is behind, which comes first.
        if (best.total < need && (this.turn < s.turn || this.run.steps.some(o => !o.info && o.index < s.index && !this.stepTurn[o.index]))) return false;
        return this.cast(best.first.card, 'hand', best.first.x);
    }

    /** Cast the best ramp the mana allows (pieces that pay for themselves first). */
    tryRamp() {
        let best = null;
        let bestFrom = 'hand';
        let bestX = 0;
        let bestScore = -Infinity;
        const avail = this.potential();
        const look = (c, from) => {
            if (c.land || !c.isRamp || c.playMv == null || !this.mightAfford(c, avail) || !this.canCastNow(c)) return;
            if (from === 'hand' && this.held(c)) return;
            const x = c.xCount ? this.chooseX(c, avail) : c.xMin;
            if (x < 0) return;
            const v = this.rampValue(c);
            if (v <= 0) return;
            const r = c.ramp;
            const cost = this.costOf(c, x);
            const now = (r?.mana && r.ready === 'now' ? r.mana : 0) + (c.rule?.mana && r?.ready === 'now' ? 1 : 0) + (r?.lands && !r.landsTapped ? r.lands : 0) - cost;
            const score = (now >= 0 ? 1e6 : 0) + Math.round(v * 100) * 100 - cost;
            if (score <= bestScore || !this.payCard(c, false, x)) return;
            best = c;
            bestFrom = from;
            bestX = x;
            bestScore = score;
        };
        for (const c of this.hand) look(c, 'hand');
        for (const c of this.command) look(c, 'command');
        const top = this.castableTop();
        if (top) look(top, 'top');
        return best ? this.cast(best, bestFrom, bestX) : false;
    }

    // ── Land drops ──────────────────────────────────────────────────────────

    /** Play one land: from hand, the graveyard (Icetill Explorer), the top of the library, or an MDFC's land face. */
    playOneLand() {
        const w = this.watchers();
        const top = this.topCard();
        const topCard = top && top.land && (this.fromTop || (w.topHistoric && top.legendary)) ? top : null;
        const options = [];
        for (const c of this.hand) if (c.land) options.push({ land: c, zone: 'hand', card: c });
        if (w.graveLands) for (const c of this.grave) if (c.land) options.push({ land: c, zone: 'grave', card: c });
        if (topCard) options.push({ land: topCard, zone: 'top', card: topCard });
        if (!options.length) {
            // An MDFC plays its land face only when you would otherwise miss the drop.
            for (const c of this.hand) if (c.face) options.push({ land: c.face, zone: 'face', card: c });
        }
        if (!options.length) return false;
        if (options.length === 1 && options[0].zone === 'hand') {
            const only = options[0].land;
            this.hand.splice(this.hand.indexOf(only), 1);
            this.putLand(only, only.lbounce || this.entersTappedLand(only), '');
            return true;
        }
        this.needMasks();
        let bump = 0;
        let bumpMask = 0;
        for (const o of options) {
            const c = o.land;
            if (c.lbounce || c.ltap === TAP.TAPPED || (c.ltap !== TAP.SHOCK && !c.fetch && this.entersTappedLand(c))) continue;
            bump = Math.max(bump, c.fetch ? 1 : c.lmana);
            bumpMask |= c.fetch ? this.anyMask : c.mask | c.lextraMask | (this.allForests ? GREEN : 0);
        }
        // Does an untapped land's mana let you cast something this turn? If
        // not, a tapped land costs nothing: play it now and save the other.
        const matters = bump > 0 && this.manaWanted(bumpMask, bump);
        const score = o => {
            const c = o.land;
            if (c.lbounce && this.landCount === 0) return -Infinity;
            const tapped = c.lbounce || (c.fetch ? c.fetch.tapped : c.ltap === TAP.SHOCK ? !matters : this.entersTappedLand(c));
            const fresh = c.mask & ~this.landMask;
            return ((tapped ? !matters : matters) ? 100000 : 0) + (c.fetch ? 1 : c.lmana) * 1000
                + BITS[fresh & this.stepNeed & 31] * 300 + BITS[fresh & this.handNeed & 31] * 100 + BITS[fresh & 31] * 10 + BITS[c.mask & 31]
                + (o.zone === 'top' ? 1 : 0) - (c.ltap === TAP.SHOCK && matters ? 1 : 0);
        };
        let best = null;
        let bestScore = -Infinity;
        for (const o of options) {
            const s = score(o);
            if (s > bestScore) { best = o; bestScore = s; }
        }
        if (!best || bestScore === -Infinity) return false;
        if (best.zone === 'top') {
            this.taken[this.top] = 1;
            this.advanceTop();
        } else if (best.zone === 'grave') {
            this.grave.splice(this.grave.indexOf(best.card), 1);
        } else {
            this.hand.splice(this.hand.indexOf(best.card), 1);
        }
        const land = best.land;
        const prefix = best.zone === 'grave' ? 'from the graveyard: ' : best.zone === 'top' ? 'from the top: ' : best.zone === 'face' ? `${best.card.name.split(' // ')[0]} as ` : '';
        this.putLand(land, land.lbounce || this.entersTappedLand(land), prefix);
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
        this.taps++;
        this.poolLen = 0;
        this.spent = 0;
        this.peak = 0;
        this.turnColors = 0;
        this.castsThisTurn.length = 0;
        this.spend.fill(0);
        const entry = log ? { turn: t, drew: null, lands: [], cast: [], notes: [], mana: 0, avail: 0, colors: 0, life: 0, steps: [] } : null;
        this.entry = entry;
        this.notes = entry ? entry.notes : null;
        if (!(t === 1 && this.run.skipFirstDraw)) {
            const c = this.draw();
            if (entry && c) entry.drew = c.name;
        }
        // Beginning of the first main phase: triggers, then the land drop.
        const triggers = this.watchers().main;
        for (const p of triggers) if (!p.dead) p.card.rule.onMainPhase(p, this);
        this.drops = 1 + this.extraDrops;
        this.dropsUsed = 0;
        const hadLand = this.hand.some(c => c.land || c.face) || (this.watchers().graveLands && this.grave.some(c => c.land));
        if (!this.playLands() && !hadLand) this.missedDrops++;
        this.avail = this.potential();
        if (entry) entry.avail = this.avail;
        this.updatePeak();
    }

    mainPhase() {
        for (let guard = 0; guard < 40; guard++) {
            if (!this.tryStep() && !this.tryRamp()) break;
            this.playLands();
            this.updatePeak();
        }
    }

    /** Combat (attack triggers), then the end step. */
    combatAndEnd() {
        const w = this.watchers();
        for (const p of w.combat.slice()) if (!p.dead) p.card.rule.onCombat(p, this);
        for (const p of w.end.slice()) if (!p.dead) p.card.rule.onEndStep(p, this);
    }

    /** Next turn's mana: every source you control plus your best untapped land drop from hand. */
    nextTurnMana() {
        let n = this.capacity();
        for (const p of this.perms) if (p.card.rule?.onMainPhase && p.card.manaSource && !p.dead) n += p.counters + 1;
        let drop = 0;
        for (const c of this.hand) {
            const land = c.land ? c : null;
            if (!land) continue;
            const untapped = land.fetch ? !land.fetch.tapped : land.ltap === TAP.SHOCK || !this.entersTappedLand(land);
            if (untapped) drop = Math.max(drop, land.fetch ? 1 : land.lmana);
        }
        return n + drop;
    }

    endTurn(log) {
        const t = this.turn;
        this.combatAndEnd();
        const steps = this.run.steps;
        let next = -1;
        for (const s of steps) {
            if (s.kind === RAMP && !this.stepTurn[s.index]) {
                if (next < 0) next = this.nextTurnMana();
                if (next >= s.atLeast) this.markStep(s.index);
                if (s.turn === t) this.stepValue[s.index] = next;
            }
            if (s.kind === SPEND && s.turn === t) this.stepValue[s.index] = this.spend[s.index];
            if (s.turn === t && !this.stepTurn[s.index]) this.stepReason[s.index] = this.diagnose(s);
        }
        if (this.entry) {
            this.entry.mana = this.peak;
            this.entry.colors = this.turnColors & 31;
            this.entry.life = this.life;
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
        if (s.kind === RAMP) {
            if (this.missedDrops > 0) return REASON.LAND;
            if (this.rampCast > 0) return REASON.SHORT;
            // Ramp you could have cast on curve: a card costing more than a turn's normal mana isn't the miss.
            const inHand = this.hand.filter(c => !c.land && c.isRamp && !this.held(c) && c.playMv <= s.turn + 1);
            if (!inHand.length) return REASON.NO_CARD;
            return this.colourShort(inHand, this.peak) ?? REASON.MANA;
        }
        let cost = Infinity;
        let pips = null;
        if (s.kind === CAST) {
            for (const zone of [this.hand, this.command]) {
                for (const c of zone) {
                    if (!c.land && s.match(c) && c.playMv < cost) { cost = c.playMv; pips = c.pips; }
                }
            }
            if (!pips) return REASON.NO_CARD;
            if (s.copied && !this.watchers().copiers.length) return REASON.NO_COPY;
            if (s.paid) cost = Math.max(cost, s.paid);
        } else if (s.kind === SPEND) {
            const cards = this.hand.filter(c => !c.land && stepMatches(s, c));
            let sum = 0;
            for (const c of cards) sum += c.xCount ? Math.max(c.playMv, this.peak) : c.playMv;
            if (sum + this.spend[s.index] < s.atLeast) return REASON.NO_PACKAGE;
            if (this.peak < s.atLeast) return short;
            return REASON.FIT;
        } else {
            for (const o of s.options) {
                const cards = this.hand.filter(c => !c.land && o.match(c)).sort((a, b) => a.playMv - b.playMv).slice(0, o.count);
                if (cards.length < o.count) continue;
                const sum = cards.reduce((n, c) => n + c.playMv, 0);
                if (sum < cost) { cost = sum; pips = cards.flatMap(c => c.pips); }
            }
            if (!pips) return REASON.NO_PACKAGE;
        }
        // A colour no land you have can make is the reason, whatever the amount.
        let handLands = 0;
        for (const c of this.hand) if (c.land) handLands |= c.mask;
        for (const pip of pips) {
            if (!(pip & (this.turnColors | handLands))) return REASON.COLOUR | ((pip & 31) << 8);
        }
        if (this.peak < cost) return short;
        for (const pip of pips) {
            if (!(pip & this.turnColors)) return REASON.COLOUR | ((pip & 31) << 8);
        }
        return REASON.OTHER;
    }

    colourShort(cards, peak) {
        const c = cards.slice().sort((a, b) => a.playMv - b.playMv)[0];
        if (peak < c.playMv) return null;
        for (const pip of c.pips) if (!(pip & this.turnColors)) return REASON.COLOUR | ((pip & 31) << 8);
        return null;
    }
}

// ── Opening hands ────────────────────────────────────────────────────────────

/** Does a hand meet the keep rule? The plan's first card is asked of seven-card hands only. */
function keeps(run, hand, owed = 0) {
    const keep = run.keep;
    let lands = 0;
    const masks = [];
    for (const c of hand) if (c.land) { lands++; masks.push(c.mask); }
    if (lands < keep.minLands || lands > keep.maxLands) return false;
    if (keep.kind !== 'plan' || !run.firstPlay || owed > 0) return true;
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
    const wanted = c => run.steps.some(s => !s.info && stepMatches(s, c));
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
        if (OPENING_HAND - owed <= MIN_HAND || keeps(run, hand, owed)) {
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
 * The plan's key turn and the mana it needs there, for the key-turn chart:
 * the last mana, spend or ramp step; else the last step casting one named
 * card (its cost); else the last step's turn.
 */
function keyOf(steps, lib) {
    const scored = steps.filter(s => !s.info);
    const manaLike = scored.filter(s => s.kind === MANA || s.kind === SPEND);
    if (manaLike.length) {
        const s = manaLike[manaLike.length - 1];
        return { turn: s.turn, required: s.atLeast };
    }
    for (let i = scored.length - 1; i >= 0; i--) {
        const s = scored[i];
        const names = s.kind === CAST && !s.copied ? s.step.require.group.names ?? [] : [];
        if (names.length === 1) {
            const card = findPlanCard(lib, names[0]);
            if (card && card.playMv > 0) return { turn: s.turn, required: card.playMv };
        }
    }
    const last = scored.reduce((m, s) => Math.max(m, s.turn), 0);
    return { turn: Math.max(1, last || 4), required: null };
}

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
    const key = keyOf(steps, lib);
    const cards = lib?.cards ?? [];
    const run = {
        lib,
        cards,
        commanders: lib?.commanders ?? [],
        idMask: lib?.idMask ?? 0,
        plan: normalizePlan(plan),
        planKey: planKey(plan),
        steps,
        firstPlay: steps.find(s => !s.info && (s.kind === CAST || s.kind === PACKAGE || s.kind === SPEND)) ?? null,
        keep: normalizeKeep(keep),
        lastTurn,
        keyTurn: key.turn,
        keyRequired: key.required,
        freeMulligan: Boolean(format?.freeMulligan),
        skipFirstDraw: onPlay !== false && !format?.firstPlayerDraws,
        startLife: lib?.commanders?.length || format?.freeMulligan ? 40 : 20,
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
        stepValues: steps.map(() => new Int32Array(MAX_MANA + 1)),
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
        // A commander already on the battlefield has left the command zone.
        const at = g.command.indexOf(c);
        if (at >= 0) g.command.splice(at, 1);
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
    let scored = 0;
    for (const s of steps) {
        const t = g.stepTurn[s.index];
        run.stepWhen[s.index][t]++;
        const onTime = t > 0 && t <= s.turn;
        const late = t > 0 && t <= s.turn + 1;
        if (onTime) run.onTime[s.index]++;
        if (late) run.late[s.index]++;
        const v = g.stepValue[s.index];
        if (v >= 0 && (s.kind !== CAST || onTime)) run.stepValues[s.index][Math.min(MAX_MANA, v)]++;
        if (s.info) continue;
        scored++;
        if (!onTime && failed < 0) failed = s.index;
        if (!onTime) allOnTime = false;
        if (!late) allLate = false;
        if (allOnTime) run.prefix[s.index]++;
    }
    if (scored && allOnTime) run.planOnTime++;
    if (scored && allLate) run.planLate++;
    let reason = 0;
    if (failed >= 0) {
        reason = g.stepReason[failed] || REASON.OTHER;
        const key = failed * 65536 + reason;
        run.reasons.set(key, (run.reasons.get(key) ?? 0) + 1);
    }
    for (let t = 1; t <= run.lastTurn; t++) run.mana[t][mana[t]]++;
    if (log) {
        log.stepTurns = Array.from(g.stepTurn);
        log.onTime = scored > 0 && allOnTime;
        log.late = scored > 0 && allLate;
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
 * The run's numbers. Plan steps (`steps`) and information-only steps
 * (`info`) each carry their turn distribution and, where the step measures
 * something, `values`: mana spent (spend), next turn's mana (ramp) or the
 * copied/cast spell's mana value (a cast step, games that made it on time).
 * @returns {Object|null} null when no game could be played
 */
export function finishPlanRun(run) {
    const games = run.done;
    if (!games || run.cards.length < OPENING_HAND) return null;
    let prevPrefix = games;
    const all = run.steps.map((s, i) => {
        const when = run.stepWhen[i];
        // Turn distribution with "never" (index 0) moved past the last turn.
        const hist = new Int32Array(run.lastTurn + 2);
        for (let t = 1; t <= run.lastTurn; t++) hist[t] = when[t];
        hist[run.lastTurn + 1] = when[0];
        const vh = run.stepValues[i];
        const counted = vh.reduce((a, b) => a + b, 0);
        const out = {
            index: i,
            turn: s.turn,
            step: s.step,
            info: s.info,
            onTime: run.onTime[i] / games,
            late: run.late[i] / games,
            reach: s.info ? run.onTime[i] / games : run.prefix[i] / games,
            conditional: 0,
            p25: quantile(hist, 0.25),
            p50: quantile(hist, 0.5),
            p75: quantile(hist, 0.75),
            never: when[0] / games,
            values: counted ? { hist: Array.from(vh), games: counted, ...turnStats(vh, counted) } : null
        };
        if (!s.info) {
            out.conditional = prevPrefix ? run.prefix[i] / prevPrefix : 0;
            prevPrefix = run.prefix[i];
        }
        return out;
    });
    const steps = all.filter(s => !s.info);
    const info = all.filter(s => s.info);
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
        info,
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
 * @returns {{mana:number[], avail:number[], life:number[], stepTurns:number[], stepValues:number[], reasons:number[], log:Object, board:Array<Object>, hand:string[], graveyard:string[]}}
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
        avail: [0, ...log.turns.map(e => e.avail)],
        life: [run.startLife, ...log.turns.map(e => e.life)],
        stepTurns: Array.from(g.stepTurn),
        stepValues: Array.from(g.stepValue),
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
        hand: g.hand.map(c => c.name),
        graveyard: g.grave.map(c => c.name)
    };
}
