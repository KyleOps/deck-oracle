/**
 * Ramp — the one rule for what counts as ramp, read from rules text.
 *
 * Every page that counts ramp asks this module: the Deck Overview's "Ramp"
 * role and health check, Lands (cheap ramp as land drops), the Mulligan
 * Planner's "ramp piece" row, Opening Hands, Draw Odds and Mana Development.
 * `classifyRamp()` reads a card once and returns a descriptor; the card is
 * **ramp** when the descriptor says so (`ramp: true`):
 *
 *   - mana permanents: rocks, dorks, mana auras, planeswalker mana abilities,
 *     mana at the start of your main phase (Jadzia Dax), creature-tap boosts
 *     that bring their own creature (Badgermole Cub's earthbent land);
 *   - land ramp: land searches (to the battlefield or your hand), revealing
 *     until you hit lands, extra land drops, playing lands from the top,
 *     putting lands from your hand;
 *   - Treasure makers;
 *   - and the ramp Mana Development can't simulate: mana that doesn't untap
 *     (Mana Vault), sacrifice-for-mana artifacts (Lotus Petal), lands or
 *     Treasure on a later trigger (Yavimaya Elder, Smothering Tithe), mana on
 *     a trigger (Lotus Cobra), mana doublers and boosts (Zendikar Resurgent),
 *     lands off the top of your library (Through the Forest Gate), lands back
 *     from your graveyard (Lumra), and mana that starts at nothing (Gyre Sage).
 *
 * Recognised but **not ramp**: rituals (one burst for one turn, the deck is no
 * faster afterwards) and cost reducers (they make spells cheaper rather than
 * add mana). Mana Development lists them as "helps your mana, not ramp".
 *
 * **Never overstated.** `mana` is what the card surely adds a turn. Mana that
 * depends on the rest of your board — "4 with a creature with power 4 or
 * greater" (Fanatic of Rhonas), "one per Elf" (Priest of Titania), "one per
 * colour among your permanents" (Bloom Tender), "one per different power"
 * (Selvala, Eager Trailblazer) — counts what the card makes on its own (it is
 * an Elf, it is green, it has a power) and describes the rest in `more`:
 *
 *   more = { words, tracks, power?, mana?, per?, equal? }
 *     words   the extra, in plain words: "4 with a power-4 creature"
 *     tracks  what it depends on: "creature power", "your other Elves" …
 *     power + mana   a threshold: `mana` instead with a creature of that power
 *     per     one more per …: "Elf on the battlefield"
 *     equal   the amount is equal to …: "your devotion to green"
 *
 * Mana Development's goldfish knows only your lands and the ramp it cast, so
 * it counts `mana` and the label says what it leaves out.
 *
 * `mana` is what the card's own mana ability adds (tap, loyalty or aura).
 * Mana that arrives another way has its own field, so a reader that handles
 * that mechanism itself never counts it twice: `phaseMana` (+`growth` a turn
 * after; Jadzia Dax) and `tapBoost.own` (Badgermole Cub's earthbent land).
 * `turnMana(info)` adds them up — what Mana Development counts a turn.
 *
 * Mana Development *counts* (simulates) a subset of ramp: `modelled` cards, and
 * Treasure when its Treasure setting is on; the rest of the ramp it lists as
 * "ramp the model can't simulate". So its counted + not-counted total is
 * exactly the ramp count every other page shows.
 *
 * Pure and DOM-free. Results are memoised per card record (records are
 * immutable), so tagging a deck on every render costs one read per card.
 */

import { COLORS, COLOR_NAMES } from './mana.js';
import { isLand } from './library.js';

const COLOR_BIT = Object.freeze({ W: 1, U: 2, B: 4, R: 8, G: 16 });
const WORDS = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
    x: 1, 'that many': 1
};
/** Number words a count can be written in (rules text spells them out). */
const NUM = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty|x|that many';
export const BASIC_TYPES = Object.freeze(['plains', 'island', 'swamp', 'mountain', 'forest']);
const BASIC_WORD = BASIC_TYPES.map(t => new RegExp(`\\b${t}\\b`));
/** Card types and the like: words a "for each …" can count that are not subtypes. */
const TYPE_WORDS = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'permanent', 'card', 'token']);

function maskOf(colors = []) {
    let m = 0;
    for (const c of colors) m |= COLOR_BIT[c] ?? 0;
    return m;
}

function symbolMask(symbols) {
    let m = 0;
    for (const s of symbols) m |= COLOR_BIT[s.toUpperCase()] ?? 0;
    return m;
}

function bitCount(m) {
    let n = 0;
    for (; m; m &= m - 1) n++;
    return n;
}

/** Basic land types as bits (same order as BASIC_TYPES), for fast type checks. */
export function typeBits(words = []) {
    let m = 0;
    BASIC_TYPES.forEach((t, i) => { if (words.includes(t)) m |= 1 << i; });
    return m;
}

/** The basic land types a phrase names ("forest or plains" → ['plains', 'forest']). */
export function basicTypesIn(text) {
    const lower = String(text ?? '').toLowerCase();
    return BASIC_TYPES.filter((t, i) => BASIC_WORD[i].test(lower));
}

/** Rules text without reminder text, spaces collapsed. */
export function stripReminder(text) {
    return String(text ?? '').replace(/\([^)]*\)/g, '').replace(/[ \t]+/g, ' ');
}

/**
 * Unmodelled kinds that are still ramp: the deck gets more mana from them,
 * Mana Development just can't simulate how much. The other kinds (ritual,
 * reducer) help your mana without being ramp.
 */
const RAMP_UNMODELLED = new Set([
    'noUntap', 'oneShot', 'trigger', 'treasureTrigger', 'manaTrigger', 'doubler', 'boost', 'topLands', 'graveyardLands', 'varies'
]);

function blankRamp() {
    return {
        kind: null,
        modelled: false,
        ramp: false,
        mana: 0, mask: 0, any: false, oneColour: false, units: null, ready: 'now', variable: false, activation: 0,
        more: null, phaseMana: 0, growth: 0, tapBoost: null,
        lands: 0, toHand: 0, landsTapped: false, landsVary: false, landFilter: null, filterKind: 0, filterBits: 0, extraCost: 0, sacrificeLand: 0,
        distinct: false, reveal: false,
        extraDrops: 0, extraDropsOnce: 0, putLand: 0, putLandTapped: false, putLandBasic: false, fromTop: false, fromGraveyard: false,
        treasure: 0, draws: 0, topCards: null, costsLess: null,
        unmodelled: null,
        label: ''
    };
}

// ── What the card itself brings ─────────────────────────────────────────────

/** The facts about the card a "for each …" or "equal to …" can count. */
function selfOf(card, typeLine) {
    const power = Number(card.power);
    const cost = String(card.mana_cost ?? '').split('//')[0].toLowerCase();
    const pips = {};
    let costMask = 0;
    for (const sym of cost.match(/\{[^}]+\}/g) ?? []) {
        for (const c of sym.match(/[wubrg]/g) ?? []) {
            pips[c] = (pips[c] ?? 0) + 1;
            costMask |= COLOR_BIT[c.toUpperCase()];
        }
    }
    const colorMask = Array.isArray(card.colors) ? maskOf(card.colors) : costMask;
    return {
        typeLine,
        creature: /\bcreature\b/.test(typeLine),
        power: Number.isFinite(power) && String(card.power ?? '').trim() !== '' ? power : null,
        pips,
        colorMask
    };
}

const PLURAL = { elves: 'elf', dwarves: 'dwarf', wolves: 'wolf' };

function singular(word) {
    return PLURAL[word] ?? word.replace(/s$/, '');
}

/** Does the card's own type line include this type or subtype? */
function isA(self, word) {
    return new RegExp(`\\b${singular(word)}\\b`).test(self.typeLine);
}

function capitalised(word) {
    return TYPE_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1);
}

/**
 * What a scaling amount ("for each …", "equal to …", "where X is …") is
 * worth from the card alone, and the rest in words.
 * @returns {{own:number|null, more:Object|null}} own = null: unknown (counted
 *   as one, the old "varies" reading)
 */
function scaling(phrase, self) {
    const p = phrase.trim();
    let m;
    if ((m = p.match(/^((?:\+1\/\+1|charge|[a-z]+) )?counters? on (?:it|this \w+|[a-z ,.'-]+?)$/))) {
        // Starts with none: nothing to count until it grows.
        const kind = m[1] ? `${m[1].trim()} ` : '';
        return { own: 0, more: { per: `${kind}counter on it`, words: `1 per ${kind}counter on it`, tracks: 'counters' } };
    }
    if (/^different power among creatures you control/.test(p)) {
        return {
            own: self.creature && self.power != null ? 1 : 0,
            more: { per: 'different power among your creatures', words: '1 per different power among your creatures', tracks: 'creature power' }
        };
    }
    if (/^(?:the )?greatest power among creatures you control/.test(p)) {
        return {
            own: self.creature && self.power != null ? self.power : null,
            more: { equal: 'the greatest power among your creatures', words: 'X = the greatest power among your creatures', tracks: 'creature power' }
        };
    }
    if (/^(?:its|this creature's|[a-z ,.'-]+'s) power$/.test(p)) {
        return { own: self.power, more: { equal: 'its power', words: 'X = its power', tracks: 'creature power' } };
    }
    if ((m = p.match(/^your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))?/))) {
        const letters = [m[1], m[2]].filter(Boolean).map(w => COLORS.find(c => COLOR_NAMES[c].toLowerCase() === w)?.toLowerCase());
        const own = letters.reduce((s, c) => s + (self.pips[c] ?? 0), 0);
        const to = `your devotion to ${[m[1], m[2]].filter(Boolean).join(' and ')}`;
        return { own, more: { equal: to, words: `X = ${to}`, tracks: 'devotion' } };
    }
    if ((m = p.match(/^(?:the number of )?([a-z]+)(?: creatures?)? (on the battlefield|you control)$/))) {
        const word = singular(m[1]);
        const where = m[2] === 'you control' ? 'you control' : 'on the battlefield';
        const own = isA(self, word) ? 1 : null;
        const name = capitalised(word);
        const many = word === 'elf' ? 'Elves' : `${name}s`;
        return { own, more: { per: `${name} ${where}`, words: `1 per ${name} ${where}`, tracks: `your ${own ? 'other ' : ''}${many}` } };
    }
    return { own: null, more: null };
}

// ── Mana abilities ──────────────────────────────────────────────────────────

/**
 * Amount and colours of an "add …" phrase (lower case, after the word "add").
 * Scaling amounts count what the card makes on its own (`own`); `legacy` marks
 * an amount it can't work out (counted as one, "varies").
 * @returns {{amount:number, mask:number, variable:boolean, any:boolean, oneColour:boolean,
 *   units:number[]|null, more:Object|null, legacy:boolean}|null}
 */
function parseAdd(phrase, idMask, self) {
    const p = phrase.trim();
    const scale = p.match(/\bfor each (.+)$|\bequal to (.+)$|\bwhere x is (.+)$/);
    if (scale || /^x mana|^an amount/.test(p)) {
        const syms = (p.match(/\{([wubrgc])\}/g) ?? []).map(s => s[1]);
        const mask = syms.length ? symbolMask(syms) : idMask;
        const { own, more } = scale ? scaling(scale[1] ?? scale[2] ?? scale[3], self) : { own: null, more: null };
        return {
            amount: own ?? 1, mask, variable: true, any: !syms.length, oneColour: /any one colou?r|that colou?r|chosen colou?r/.test(p),
            units: null, more, legacy: own == null
        };
    }
    let m = p.match(/^((?:\{[wubrgc]\})+)((?: or \{[wubrgc]\})*)/);
    if (m) {
        const first = m[1].match(/\{([wubrgc])\}/g).map(s => s[1]);
        const alts = (m[2].match(/\{([wubrgc])\}/g) ?? []).map(s => s[1]);
        const plain = { variable: false, any: false, oneColour: false, units: null, more: null, legacy: false };
        if (alts.length) return { ...plain, amount: 1, mask: symbolMask([...first, ...alts]) };
        // {G}{U}: one of each, not two of either.
        const units = new Set(first).size > 1 ? first.map(s => COLOR_BIT[s.toUpperCase()] ?? 0) : null;
        return { ...plain, amount: first.length, mask: symbolMask(first), units };
    }
    m = p.match(/^(one|two|three|four|five) mana (?:of any (one )?colou?r|in any combination of colou?rs|of (?:the chosen|that) colou?r|of any type)/);
    if (m) {
        return {
            amount: WORDS[m[1]], mask: idMask, variable: false, any: true, oneColour: Boolean(m[2]) || /chosen|that colou?r/.test(m[0]),
            units: null, more: null, legacy: false
        };
    }
    return null;
}

/** "Vivid — {T}: For each color among permanents you control, add one mana of that color." (Bloom Tender) */
function coloursAmong(self) {
    const own = bitCount(self.colorMask);
    return {
        amount: own, mask: self.colorMask, variable: true, any: false, oneColour: false, units: null, legacy: false,
        more: { per: 'colour among your permanents', words: '1 of each colour among your permanents', tracks: 'your permanents’ colours' }
    };
}

/** A threshold: "4 with a power-4 creature". */
function powerMore(mana, power, oneColour) {
    return { power, mana, words: `${mana}${oneColour ? ' of one colour' : ''} with a power-${power} creature`, tracks: 'creature power' };
}

/** Activation cost in mana ({T} and {Q} are free). */
function activationOf(cost) {
    let n = 0;
    for (const s of cost.match(/\{([^}]+)\}/g) ?? []) {
        const sym = s.slice(1, -1);
        if (/^\d+$/.test(sym)) n += Number(sym);
        else if (sym !== 't' && sym !== 'q') n += 1;
    }
    return n;
}

/** "Add X." / "Add X. If you control a creature with power N or greater, add Y instead." */
function readTapEffect(effect, idMask, self) {
    const eff = effect.replace(/^choose a colou?r\. /, '');
    let parsed = null;
    if (/^for each colou?r among permanents you control, add one mana of that colou?r/.test(eff)) {
        parsed = coloursAmong(self);
    } else {
        const add = eff.match(/^add (.+?)(?:\.|$)/);
        if (add) parsed = parseAdd(add[1], idMask, self);
        else if (/\badd (one|two|x)? ?mana\b|\badd \{/.test(eff)) {
            parsed = { amount: 1, mask: idMask, variable: true, any: true, oneColour: false, units: null, more: null, legacy: true };
        }
    }
    if (!parsed) return null;
    const instead = eff.match(/\. if you control a creature with power (\d+) or greater, add (.+?) instead\b/);
    if (instead) {
        const hi = parseAdd(instead[2], idMask, self);
        const power = Number(instead[1]);
        if (hi && self.power != null && self.power >= power) parsed = hi; // it qualifies itself
        else if (hi && hi.amount > parsed.amount) parsed = { ...parsed, variable: true, more: powerMore(hi.amount, power, hi.oneColour) };
    }
    return parsed;
}

// ── Wording families ────────────────────────────────────────────────────────

const TRIGGER = /\bwhenever\b|\bat the beginning\b|\bdies\b|\battacks?\b|\blandfall\b|\bdeals combat damage\b|\bwhen [^,]*\b(leaves|is put into)\b/;
/** "Add" after a trigger: Lotus Cobra, Carpet of Flowers. */
const TRIGGERED_ADD = /(?:^|, |\. )(?:you may )?add (?:\{[wubrgc]\}|one mana|two mana|three mana|x mana|an amount of)/;
/** Extra land drops for you (or for everyone). */
const EXTRA_DROPS = /(?:you|each player) may play (an|one|two|three) additional lands? on each of (?:your|their) turns/;
/** Lands from your hand: Growth Spiral ("a land card"), Lt. Arex ("up to three land cards"). */
const PUT_LAND = /put (an?|up to (?:one|two|three|four|x)) (basic )?land cards? from your hand(?: or graveyard)? onto the battlefield( tapped)?/;
/** Any permanent from your hand, lands included, on a trigger (Kodama of the East Tree). */
const PUT_PERMANENT = /put an? permanent card [^.]*from your hand onto the battlefield/;
/** Spells that cost less — but not "this spell costs {1} less" (Blasphemous Act). */
const REDUCER = /spells? you cast [^.]*cost (\{\d+\}|\{x\}|\w+ generic mana) less|costs? \{\d+\} less to cast/;
/** Mana when something is tapped for mana: doublers (lands, permanents) and boosts (creatures). */
const TAP_BOOST = /whenever (?:you tap|a player taps) (?:a|an) ([a-z]+) for mana, (?:that player |its controller )?adds? (?:an additional |one additional )?(.+?)(?:\.|$)|whenever an? ([a-z]+) is tapped for mana, its controller adds (?:an additional |one additional )?(.+?)(?:\.|$)/;
const TAP_MULTIPLIER = /if you tap (?:a|an) ([a-z]+) for mana, it produces (twice|three times) as much/;
/** At the beginning of your first main phase, a +1/+1 counter, then {G} per counter (Jadzia Dax, Living Legacy). */
const MAIN_PHASE_COUNTERS = /^at the beginning of your (?:first |precombat )?main phase, put an? \+1\/\+1 counter on [^,]+, then add an amount of \{([wubrgc])\} equal to the number of (?:\+1\/\+1 )?counters on /;
/** "When … enters, earthbend N": a land you control becomes a creature (with haste). */
const EARTHBEND = /when [^.]*? enters, earthbend (\d+)/;
/** Reveal until lands: U.S.S. Voyager. */
const REVEAL_UNTIL = new RegExp(`reveal cards from the top of your library until you reveal (${NUM}) (basic )?land cards?\\. put (?:that card|those land cards|those cards|them|it) (onto the battlefield( tapped)?|into your hand)`);
/** Lands off the top: Through the Forest Gate, Kamahl's Druidic Vow ("any number of land … cards"). */
const TOP_CARDS = /(?:look at|reveal) the top (\w+) cards of your library/;
const TOP_LANDS = /put any number of land\b[^.]*? cards[^.]*? from among them onto the battlefield( tapped)?/;
/** One land from among them — ramp only on a trigger (Silverback Elder), not as one card of a big spell. */
const TOP_LAND_ONE = /put an? (?:basic )?land card from among them onto the battlefield( tapped)?/;
/** Lands back from the graveyard: Lumra, Splendid Reclamation. */
const GRAVEYARD_LANDS = /return (?:all|target|up to \w+|a|an|one|two|three|x) (?:basic )?land cards? from your graveyard to the battlefield/;
/** A search into exile that a later trigger puts onto the battlefield (Omenpath Journey). */
const EXILED_LATER = /exiled with (?:this|it)\b[^.]*onto the battlefield/;

/**
 * Lines with the trigger they belong to: a modal bullet ("• Look at the top
 * five cards …") reads as part of the line that chose it.
 */
function contextLines(lines) {
    const out = [];
    let parent = '';
    for (const line of lines) {
        if (/^•/.test(line)) out.push({ line, context: `${parent} ` });
        else {
            parent = line;
            out.push({ line, context: '' });
        }
    }
    return out;
}

/**
 * What a nonland card does for your mana, read from its rules text.
 *
 * Modelled (Mana Development simulates it): mana abilities on permanents
 * (rocks, dorks, auras like Utopia Sprawl, planeswalker mana abilities,
 * main-phase counter mana), land searches on spells, ETBs and sacrifice
 * abilities, revealing until lands, extra land drops, playing lands from the
 * top, putting lands from your hand, and one-shot Treasure (only when the page
 * turns Treasure on).
 * Recognised, ramp, not modelled: mana that doesn't untap, sacrifice-for-mana,
 * lands / Treasure / mana on a later trigger, doublers and boosts, lands off
 * the top or back from the graveyard, mana that starts at nothing.
 * Recognised, not ramp: rituals and cost reducers.
 *
 * @param {Object} card - Scryfall-shaped record
 * @param {{identity?:string[]}} [opts] - deck colour identity ("any colour" means these)
 * @returns {Readonly<Object>|null} a frozen descriptor (see blankRamp and the
 *   module header for `more`), or null when the card does nothing for your mana
 */
export function classifyRamp(card, { identity = COLORS } = {}) {
    if (!card || typeof card !== 'object') return null;
    // The card is read once, with no identity: "any colour" mana keeps only the
    // colours it names plus `any`. Only those cards differ by deck, so only
    // they get a copy per identity (their colours = named | the identity's).
    let entry = memo.get(card);
    if (!entry) {
        const r = readRamp(card, 0);
        entry = { base: r ? Object.freeze(r) : null, byIdentity: null };
        memo.set(card, entry);
    }
    const base = entry.base;
    if (!base || !base.any) return base;
    const idKey = Array.isArray(identity) ? identity.join('') : '';
    entry.byIdentity ??= new Map();
    let out = entry.byIdentity.get(idKey);
    if (!out) {
        out = Object.freeze({ ...base, mask: base.mask | maskOf(identity) });
        entry.byIdentity.set(idKey, out);
    }
    return out;
}

const memo = new WeakMap();

function readRamp(card, idMask) {
    if (isLand(card)) return null;
    const text = stripReminder(String(card.oracle_text ?? '').toLowerCase());
    if (!text.trim()) return null;
    const typeLine = String(card.type_line ?? '').split('//')[0].toLowerCase();
    const isSpell = /\b(instant|sorcery)\b/.test(typeLine);
    const isCreature = /\bcreature\b/.test(typeLine);
    const isWalker = /\bplaneswalker\b/.test(typeLine);
    const self = selfOf(card, typeLine);
    const r = blankRamp();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const withContext = contextLines(lines);

    // 1. Mana abilities on permanents — the best one counts (you tap once).
    if (!isSpell) readManaAbilities(r, text, lines, { idMask, self, isCreature, isWalker });
    else if (lines.some(l => /^add \{|^add (one|two|three|x) mana/.test(l))) r.unmodelled = 'ritual';

    // 2. Land searches (spells, ETBs, sacrifice abilities) and revealing until lands.
    readSearches(r, text, withContext);

    // 3. Extra land drops and lands from your hand.
    const drops = text.match(EXTRA_DROPS);
    if (drops) {
        r.extraDrops = WORDS[drops[1]];
        if (!r.kind) r.kind = 'drops';
    }
    if (/you may play an additional land this turn/.test(text)) {
        r.extraDropsOnce = 1;
        if (!r.kind) r.kind = 'drops';
    }
    if (/you may play lands from the top of your library/.test(text)) {
        r.fromTop = true;
        if (!r.kind) r.kind = 'drops';
    }
    if (/you may play lands from your graveyard/.test(text)) r.fromGraveyard = true;
    for (const { line, context } of withContext) {
        const put = line.match(PUT_LAND);
        if (put) {
            if (TRIGGER.test(context + line.slice(0, put.index))) { r.unmodelled = r.unmodelled ?? 'trigger'; continue; }
            r.putLand = WORDS[put[1].replace(/^up to /, '')] ?? 1;
            r.putLandBasic = Boolean(put[2]);
            r.putLandTapped = Boolean(put[3]);
            if (!r.kind) r.kind = 'drops';
            continue;
        }
        const perm = line.match(PUT_PERMANENT);
        if (perm && TRIGGER.test(context + line.slice(0, perm.index))) r.unmodelled = r.unmodelled ?? 'trigger';
    }

    // 4. Lands off the top of your library, or back from the graveyard.
    for (const { line, context } of withContext) {
        const top = line.match(TOP_CARDS);
        const many = top && line.match(TOP_LANDS);
        const one = top && !many && line.match(TOP_LAND_ONE);
        if (many || one) {
            if (TRIGGER.test(context + line.slice(0, top.index))) r.unmodelled = r.unmodelled ?? 'trigger';
            else if (many) {
                r.unmodelled = r.unmodelled ?? 'topLands';
                r.topCards = top[1] === 'x' ? 'X' : top[1];
                r.landsTapped = r.landsTapped || Boolean(many[1]);
            }
        }
        const back = line.match(GRAVEYARD_LANDS);
        if (back) r.unmodelled = r.unmodelled ?? (TRIGGER.test(context + line.slice(0, back.index)) ? 'trigger' : 'graveyardLands');
    }

    // 5. Treasure (one-shot mana). Counted only when the caller turns it on.
    for (const line of lines) {
        const tm = line.match(/create (a|an|one|two|three|four|five|x) (?:tapped )?(?:food token or a )?treasure tokens?/);
        if (!tm) continue;
        const prefix = line.slice(0, tm.index);
        // Saga chapter I happens as it enters; later chapters and triggers don't count.
        const chapterOne = /^i — /.test(line);
        if (tm[1] === 'x' || (!chapterOne && (TRIGGER.test(prefix) || /^[iv]+(, [iv]+)* — /.test(line)))) {
            r.unmodelled = r.unmodelled ?? 'treasureTrigger';
            continue;
        }
        r.treasure += WORDS[tm[1]] ?? 1;
        if (!r.kind) r.kind = 'treasure';
    }

    // 6. Things recognised but not modelled, and what the card says about its own cost.
    const name = String(card.name ?? '').split('//')[0].trim().toLowerCase();
    const selfName = name ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
    const ownCost = text.match(new RegExp(`(?:^|\\n)(?:this spell|${selfName ?? 'this spell'}) costs (\\{[^}]+\\}) less to cast,? ?(?:where x is )?([^.]*)`));
    if (ownCost) r.costsLess = { by: ownCost[1].toUpperCase(), when: ownCost[2].replace(/creatures you control/, 'your creatures').trim() };
    const others = text.replace(/this spell costs [^.]*\./g, '')
        .replace(selfName ? new RegExp(`${selfName} costs [^.]*\\.`, 'g') : /$^/, '');
    if (REDUCER.test(others)) r.unmodelled = r.unmodelled ?? 'reducer';

    // Cards drawn by the ramp card itself (Explore, Growth Spiral, Big Score; Lt. Arex as it enters).
    const draw = isSpell
        ? text.match(/(?:^|\. |\n)draw (a|one|two|three) cards?/)
        : text.match(/(?:^|\n)when [^\n]*? enters, draw (a|one|two|three) cards?/);
    if (draw) r.draws = WORDS[draw[1]] ?? 0;

    r.modelled = Boolean(turnMana(r) || r.lands || r.toHand || r.extraDrops || r.extraDropsOnce || r.putLand || r.fromTop);
    if (!r.modelled && !r.treasure && !r.unmodelled) return null;
    if (!r.kind) r.kind = r.unmodelled ?? 'other';
    r.ramp = r.modelled || r.treasure > 0 || RAMP_UNMODELLED.has(r.unmodelled);
    r.label = describeRamp(r);
    return r;
}

/** Step 1 of readRamp: mana abilities, auras, main-phase mana and tap boosts. */
function readManaAbilities(r, text, lines, { idMask, self, isCreature, isWalker }) {
    const noUntap = /doesn't untap during your untap step/.test(text);
    let best = null;     // the best ability you can always use
    let boosted = null;  // the best one that needs a creature with power N or greater
    let grows = null;    // mana that starts at nothing and grows
    let counterMana = null;
    for (const line of lines) {
        const loyalty = isWalker ? line.match(/^[+−-]?\d+: add (.+)$/) : null;
        const tapAbility = line.match(/^([^:]*\{t\}[^:]*): (.+)$/);
        let parsed = null;
        let activation = 0;
        let needsPower = 0;
        if (loyalty) {
            parsed = parseAdd(loyalty[1], idMask, self);
        } else if (tapAbility) {
            const [, cost, effect] = tapAbility;
            if (/sacrifice/.test(cost)) {
                if (/^add\b/.test(effect)) r.unmodelled = r.unmodelled ?? 'oneShot';
                continue;
            }
            parsed = readTapEffect(effect, idMask, self);
            activation = activationOf(cost);
            const only = effect.match(/activate only if you control a creature with power (\d+) or greater/);
            if (only && !(self.power != null && self.power >= Number(only[1]))) needsPower = Number(only[1]);
        } else if (MAIN_PHASE_COUNTERS.test(line)) {
            counterMana = symbolMask([line.match(MAIN_PHASE_COUNTERS)[1]]);
            continue;
        } else if (TRIGGER.test(line) && TRIGGERED_ADD.test(line) && !TAP_BOOST.test(line)) {
            r.unmodelled = r.unmodelled ?? 'manaTrigger';
            continue;
        }
        if (!parsed) continue;
        // Mana nobody can work out (Rofellos' Forests) counts as one more than it costs.
        if (parsed.legacy) parsed.amount = Math.max(parsed.amount, activation + 1);
        const net = parsed.amount - activation;
        if (net <= 0) {
            // A filter adds nothing; mana that starts at nothing (Gyre Sage) may grow.
            if (parsed.more) grows = grows ?? parsed.more;
            continue;
        }
        const entry = { ...parsed, net, activation };
        if (needsPower) {
            if (!boosted || net > boosted.net) boosted = { ...entry, power: needsPower };
            continue;
        }
        if (!best || net > best.net) best = entry;
        else if (net === best.net) {
            best.mask |= parsed.mask;
            best.any = best.any || parsed.any;
            best.units = null;
        }
    }
    // Ferocious: the better ability is the "more", the always-on one the count.
    if (boosted && (!best || boosted.net > best.net)) {
        if (best) best = { ...best, variable: true, more: powerMore(boosted.net, boosted.power, boosted.oneColour) };
        else grows = grows ?? powerMore(boosted.net, boosted.power, boosted.oneColour);
    }

    if (best && noUntap) {
        r.unmodelled = 'noUntap';
    } else if (best) {
        r.kind = isWalker ? 'walker' : isCreature ? 'dork' : 'rock';
        r.mana = best.net;
        r.mask = best.mask;
        r.variable = best.variable;
        r.any = best.any;
        r.oneColour = best.oneColour;
        r.units = best.activation ? null : best.units;
        r.more = best.more;
        r.activation = best.activation;
        const entersTapped = /enters tapped/.test(text);
        r.ready = entersTapped ? 'tapped' : (isCreature && !/\bhaste\b/.test(text) && !isWalker) ? 'sick' : 'now';
    } else if (counterMana !== null) {
        // Jadzia Dax: a counter, then one mana per counter — 1, 2, 3 … from the turn after she lands.
        r.kind = isCreature ? 'dork' : 'rock';
        r.phaseMana = 1;
        r.growth = 1;
        r.mask = counterMana;
        r.ready = 'next';
    }

    // Auras like Utopia Sprawl / Wild Growth: extra mana whenever the land taps.
    const aura = text.match(/whenever enchanted (?:land|forest|plains|island|swamp|mountain) is tapped for mana, its controller adds (?:an additional )?(.+?)(?:\.|$)/);
    if (!r.kind && aura) {
        const parsed = parseAdd(aura[1].replace(/^additional /, ''), idMask, self);
        if (parsed) {
            r.kind = 'aura';
            r.mana = parsed.amount;
            r.mask = parsed.mask;
            r.any = parsed.any;
            r.ready = 'next'; // the land usually paid for the aura this turn
        }
    }

    // Whenever something is tapped for mana, more mana.
    const tap = text.match(TAP_BOOST);
    const times = text.match(TAP_MULTIPLIER);
    if (tap) {
        const on = tap[1] ?? tap[3];
        const add = parseAdd((tap[2] ?? tap[4]).replace(/^additional /, ''), idMask, self);
        const doubles = !add || /mana of any type that (?:land|permanent) produced/.test(tap[2] ?? tap[4]);
        // The land it earthbends is a creature you tap for mana every turn (Badgermole Cub).
        const own = on === 'creature' && !doubles && !r.kind && EARTHBEND.test(text) ? 1 : 0;
        r.tapBoost = { on, mana: doubles ? 0 : add.amount, mask: doubles ? 0 : add.mask, times: doubles ? 2 : 1, own };
        if (own) {
            r.kind = 'dork';
            r.mask = add.mask;
            r.ready = 'next';
            r.variable = true;
            r.more = { per: 'other creature you tap for mana', words: '1 more per other creature you tap for mana', tracks: 'your other creatures' };
        } else if (!r.kind) {
            r.unmodelled = r.unmodelled ?? (on === 'creature' ? 'boost' : 'doubler');
        }
    } else if (times) {
        r.tapBoost = { on: times[1], mana: 0, mask: 0, times: times[2] === 'twice' ? 2 : 3, own: 0 };
        if (!r.kind) r.unmodelled = r.unmodelled ?? 'doubler';
    }

    if (!r.kind && grows && !r.unmodelled) {
        r.unmodelled = 'varies';
        r.more = grows;
    }
}

/** Step 2 of readRamp: land searches, searches into exile, revealing until lands. */
function readSearches(r, text, withContext) {
    const countWords = `${NUM}|up to (?:${NUM})`;
    const SEARCH = new RegExp(`^search your library for (${countWords}) ((?:[a-z/,]+ )*?)(?:land )?cards?\\b(.*)$`);
    for (const { line, context } of withContext) {
        for (const sentence of line.split(/\.(?:\s|$)/)) {
            const at = sentence.indexOf('search your library for ');
            if (at < 0) continue;
            const prefix = sentence.slice(0, at);
            const linePrefix = context + line.slice(0, line.indexOf(sentence) + at);
            // The words before "card" are space-separated tokens ("forest," "or" "and/or"):
            // one way to split them, so text that never says "card" can't backtrack exponentially.
            const m = sentence.slice(at).match(SEARCH);
            if (!m) continue;
            const what = m[2];
            const named = basicTypesIn(what);
            const isLandSearch = /\bland\b/.test(sentence.slice(at, at + 80)) && !/\bnonland\b/.test(what) || named.length > 0;
            if (!isLandSearch) continue;
            const word = m[1].replace(/^up to /, '');
            const count = WORDS[word] ?? 1;
            const dest = searchDestination(m[3], count);
            if (!dest) {
                // Into exile now, onto the battlefield on a later trigger (Omenpath Journey).
                if (/\bexile (?:them|it)\b/.test(m[3]) && EXILED_LATER.test(text)) r.unmodelled = r.unmodelled ?? 'trigger';
                continue;
            }
            if (TRIGGER.test(linePrefix)) {
                r.unmodelled = r.unmodelled ?? 'trigger';
                continue;
            }
            const filter = /\bbasic\b/.test(what) ? 'basic' : named;
            r.landFilter = Array.isArray(filter) && filter.length === 0 ? 'any' : filter;
            r.filterKind = r.landFilter === 'basic' ? 1 : r.landFilter === 'any' ? 0 : 2;
            r.filterBits = Array.isArray(r.landFilter) ? typeBits(r.landFilter) : 0;
            r.lands += dest.lands;
            r.toHand += dest.toHand;
            r.landsTapped = dest.tapped;
            if (word === 'x') r.landsVary = true;
            if (/\b(?:with|that have) different names\b/.test(m[3])) r.distinct = true;
            // An activated search ("{2}, {T}, Sacrifice …:") costs its mana on top.
            const colon = prefix.lastIndexOf(':');
            if (colon >= 0) {
                for (const s of prefix.slice(0, colon).match(/\{(\d+)\}/g) ?? []) r.extraCost += Number(s.slice(1, -1));
            }
            if (!r.kind) r.kind = 'fetch';
        }
        // Reveal until you reveal N lands, put them onto the battlefield (U.S.S. Voyager).
        const rev = line.match(REVEAL_UNTIL);
        if (rev) {
            if (TRIGGER.test(context + line.slice(0, rev.index))) { r.unmodelled = r.unmodelled ?? 'trigger'; continue; }
            const n = WORDS[rev[1]] ?? 1;
            if (rev[1] === 'x') r.landsVary = true;
            const onto = rev[3].startsWith('onto');
            r.landFilter = rev[2] ? 'basic' : 'any';
            r.filterKind = rev[2] ? 1 : 0;
            r.filterBits = 0;
            if (onto) r.lands += n;
            else r.toHand += n;
            r.landsTapped = Boolean(rev[4]);
            r.reveal = true;
            if (!r.kind) r.kind = 'fetch';
        }
    }
    if ((r.lands || r.toHand) && /additional cost to cast this spell, sacrifice a land/.test(text)) r.sacrificeLand = 1;
}

/** "tapped"/"untapped" destination of a land search, from the clause after "card(s)". */
function searchDestination(rest, count) {
    if (/put one (of them )?onto the battlefield( tapped)? and the other into your hand/.test(rest)) {
        return { lands: 1, toHand: Math.max(0, count - 1), tapped: /onto the battlefield tapped and/.test(rest) };
    }
    const bf = rest.match(/put (?:them|it|that card|those cards|those lands|the cards?) onto the battlefield( tapped)?/);
    if (bf) return { lands: count, toHand: 0, tapped: Boolean(bf[1]) };
    if (/into your hand/.test(rest)) return { lands: 0, toHand: count, tapped: false };
    return null;
}

/**
 * Is this card ramp? The rule every page shares (see the header): rocks,
 * dorks, land ramp, extra land drops, Treasure, and the ramp Mana Development
 * can't simulate — never rituals, cost reducers or lands.
 * @param {Object} card - Scryfall-shaped record
 * @returns {boolean}
 */
export function isRampCard(card) {
    return classifyRamp(card)?.ramp === true;
}

/**
 * The mana a card is counted as adding a turn, however it arrives: its own
 * mana ability (`mana`), mana at the start of your main phase (`phaseMana`,
 * the first turn's; it grows by `growth` a turn after), and a tap boost from
 * the creatures it brings (`tapBoost.own` × `tapBoost.mana`).
 * @param {Object|null} info - classifyRamp() output
 * @returns {number}
 */
export function turnMana(info) {
    if (!info) return 0;
    return (info.mana || 0) + (info.phaseMana || 0) + (info.tapBoost?.own ?? 0) * (info.tapBoost?.mana ?? 0);
}

/**
 * How Mana Development treats a descriptor: 'counted' (simulated), 'ramp'
 * (ramp it can't simulate), 'helps' (recognised, not ramp) or null.
 * @param {Object|null} info - classifyRamp() output
 * @param {{treasure?:boolean}} [opts] - Treasure counted (the page's setting)
 */
export function rampRole(info, { treasure = false } = {}) {
    if (!info) return null;
    if (info.modelled || (treasure && info.treasure > 0)) return 'counted';
    return info.ramp ? 'ramp' : 'helps';
}

// ── Words ────────────────────────────────────────────────────────────────────

const colourName = c => COLOR_NAMES[c].toLowerCase();

function manaWords(n, r) {
    if (r.units?.length) {
        // {G}{U}: "1 blue and 1 green mana".
        const each = COLORS.map(c => [c, r.units.filter(u => u === COLOR_BIT[c]).length]).filter(([, k]) => k > 0);
        return `${each.map(([c, k]) => `${k} ${colourName(c)}`).join(' and ')} mana`;
    }
    const amount = r.variable && !r.more ? `${n}+` : String(n);
    if (r.any) return `${amount} mana of any ${r.oneColour ? 'one ' : ''}colour`;
    if (!r.mask) return `${amount} colourless mana`;
    return `${amount} ${COLORS.filter(c => r.mask & COLOR_BIT[c]).map(colourName).join(' or ')} mana`;
}

function landWords(n, filter, { article = false } = {}) {
    const types = Array.isArray(filter) ? filter.map(t => t[0].toUpperCase() + t.slice(1)) : [];
    if (types.length > 1) {
        const list = `${types.slice(0, -1).join(', ')} or ${types[types.length - 1]}`;
        return n === 1 ? `${article ? 'a' : '1'} ${list}` : `${n} lands (${list})`;
    }
    const kind = filter === 'basic' ? 'basic land' : types[0] ?? 'land';
    if (n === 1) return article ? `${/^[aeiouAEIOU]/.test(kind) ? 'an' : 'a'} ${kind}` : `1 ${kind}`;
    return `${n} ${kind}s`;
}

/** "whenever you tap a land for mana" — what a doubler or boost watches. */
function tappedWords(on) {
    if (BASIC_TYPES.includes(on)) return `a ${on[0].toUpperCase()}${on.slice(1)} is tapped`;
    return `you tap ${/^[aeiou]/.test(on) ? 'an' : 'a'} ${on}`;
}

function boostWords(b) {
    if (b.times > 1) return `${b.times === 2 ? 'Doubles' : 'Triples'} the mana from your ${b.on === 'permanent' ? 'permanents' : `${b.on}s`}`;
    const colour = b.mask ? COLORS.filter(c => b.mask & COLOR_BIT[c]).map(colourName).join(' or ') : 'colourless';
    return `Adds ${b.mana} more ${colour} mana whenever ${tappedWords(b.on)} for mana`;
}

const UNMODELLED_LABEL = {
    ritual: 'One burst of mana for a single turn — not ramp, not counted',
    oneShot: 'Sacrifice for one burst of mana — not counted',
    noUntap: 'Doesn’t untap each turn — not counted',
    trigger: 'Gets lands on a later trigger — not counted',
    treasureTrigger: 'Makes Treasure on a trigger — not counted',
    manaTrigger: 'Adds mana on a trigger — not counted',
    reducer: 'Makes spells cheaper — not ramp, not counted',
    doubler: 'Doubles mana from your lands — not counted',
    boost: 'Adds mana whenever you tap a creature for mana — not counted',
    topLands: 'Puts lands from the top of your library onto the battlefield — not counted',
    graveyardLands: 'Returns lands from your graveyard to the battlefield — not counted',
    varies: 'Makes no mana until your board grows — not counted'
};

/** The plain-words reading of an unmodelled kind, as precise as the descriptor allows. */
function unmodelledWords(r) {
    const kind = r.unmodelled;
    if ((kind === 'doubler' || kind === 'boost') && r.tapBoost) return `${boostWords(r.tapBoost)} — not counted`;
    if (kind === 'topLands' && r.topCards) {
        return `Puts lands from the top ${r.topCards} cards of your library onto the battlefield${r.landsTapped ? ' tapped' : ''} — not counted`;
    }
    if (kind === 'varies' && r.more) return `Makes no mana on its own (${r.more.words}) — not counted`;
    return UNMODELLED_LABEL[kind] ?? 'Not counted';
}

/**
 * What the model thinks a ramp card does, in plain words — shown in Mana
 * Development's ramp table so a misread is easy to spot. Mana that depends on
 * the rest of the board says what it would be and what the model counts.
 */
export function describeRamp(r) {
    const parts = [];
    const perTurn = turnMana(r);
    if (perTurn) {
        const when = r.ready === 'now' ? 'from the turn you cast it'
            : r.ready === 'sick' ? 'from the next turn (summoning sick)'
                : r.ready === 'tapped' ? 'from the next turn (enters tapped)'
                    : 'from the next turn';
        const notes = [];
        if (r.activation) notes.push(`net of its {${r.activation}} cost`);
        if (r.growth) notes.push(`${r.growth} more each turn after, as it gets a +1/+1 counter each turn`);
        let s;
        if (r.tapBoost?.own) {
            // Badgermole Cub: the boost, from the creature it brings.
            s = `${boostWords(r.tapBoost)}: ${perTurn} a turn from the land it earthbends, ${when}`;
        } else {
            if (r.more) notes.push(r.more.words);
            s = `Adds ${manaWords(perTurn, r)} a turn${notes.length ? ` (${notes.join('; ')})` : ''}, ${when}`;
        }
        if (r.more) s += ` — counted as ${perTurn}: the model doesn’t track ${r.more.tracks}`;
        else if (r.variable) s += ' — varies, counted as 1';
        parts.push(s);
    }
    if (r.lands || r.toHand) {
        const where = [];
        const names = r.distinct ? ' with different names' : '';
        if (r.lands) where.push(`${landWords(r.lands, r.landFilter, { article: r.lands === 1 })}${names} onto the battlefield${r.landsTapped ? ' tapped' : ' untapped'}`);
        if (r.toHand) where.push(`${r.lands ? `${r.toHand} more` : landWords(r.toHand, r.landFilter, { article: r.toHand === 1 })} into your hand`);
        const n = r.lands + r.toHand;
        let s = r.reveal
            ? `Reveals cards until it finds ${landWords(n, r.landFilter, { article: n === 1 })} and puts ${n === 1 ? 'it' : 'them'} ${r.lands ? `onto the battlefield${r.landsTapped ? ' tapped' : ' untapped'}` : 'into your hand'}`
            : `Puts ${where.join(' and ')}`;
        if (r.extraCost) s += ` (plus {${r.extraCost}} to activate)`;
        if (r.sacrificeLand) s += `, sacrificing a land`;
        if (r.landsVary) s += ' — varies, counted as 1';
        parts.push(s);
    }
    if (r.extraDrops) parts.push(`Lets you play ${r.extraDrops === 1 ? 'an extra land' : `${r.extraDrops} extra lands`} each turn`);
    if (r.fromTop) parts.push('Lets you play lands from the top of your library');
    if (r.extraDropsOnce) parts.push('One extra land drop the turn you cast it');
    if (r.putLand) {
        const which = r.putLandBasic ? 'basic land' : 'land';
        const lands = r.putLand === 1 ? `a ${which}` : `up to ${r.putLand} ${which}s`;
        parts.push(`Puts ${lands} from your hand onto the battlefield${r.putLandTapped ? ' tapped' : ''}`);
    }
    if (r.treasure) parts.push(`Makes ${r.treasure} Treasure — one-shot mana, counted only with Treasure on`);
    if (r.draws && parts.length) parts.push(`draws ${r.draws === 1 ? 'a card' : `${r.draws} cards`}`);
    if (r.fromGraveyard && parts.length) parts.push('also plays lands from your graveyard, which the model doesn’t');
    if (r.costsLess && parts.length) {
        const when = r.costsLess.when ? ` (${r.costsLess.by === '{X}' ? 'X = ' : ''}${r.costsLess.when}; generic mana only)` : ' (generic mana only)';
        parts.push(`costs ${r.costsLess.by} less to cast${when} — the model pays full price`);
    }
    if (!parts.length && r.unmodelled) return unmodelledWords(r);
    let label = parts.join('; ');
    if (r.unmodelled && !r.modelled) label += `. ${unmodelledWords(r)}`;
    return label;
}
