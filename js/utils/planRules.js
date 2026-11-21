/**
 * Card rules for the Game Plan engine — what a card does beyond what ramp.js
 * reads from its rules text.
 *
 * ramp.js counts a Fanatic of Rhonas as "a dork that adds {G}" and a Selvala
 * as "variable mana, counted as one". That is the right rule for counting
 * ramp, but a plan like "Selvala on turn 3, eight mana on turn 4" lives or
 * dies on the board: Fanatic adds {G}{G}{G}{G} once you control a creature
 * with power 4 or greater, Selvala adds one mana per different power among
 * your creatures, Priest of Titania one per Elf. Those cards get a **rule**
 * here, keyed by card name (the front face, `nameKey()`), and the engine
 * (planEngine.js) asks the rule instead of the ramp descriptor.
 *
 * A rule is plain data plus small hook functions. Every field is optional:
 *
 *   label        What the model reads, in plain words (shown on the page).
 *   mana(perm, game) → {n, mask, mode} | null
 *                Its tap-for-mana ability, worked out from the board now.
 *                n units of mana; mask = the colours (W1 U2 B4 R8 G16, 0 =
 *                colourless); mode EACH (each unit any one of the colours),
 *                ONE (all n of one colour you choose) or SET (one of each
 *                colour in the mask, n = how many colours).
 *   manaSource   Counts as a mana source for plan groups ("a mana 2-drop")
 *                and the casting policy, even without a tap ability.
 *   tapBoost     {n, mask}: whenever you tap a creature for mana, add this
 *                too (Badgermole Cub). Applies to every creature you tap.
 *   onMainPhase(perm, game)   At the beginning of your first main phase.
 *   onEnter(perm, game)       When it enters the battlefield.
 *   onCast(perm, spell, game) When you cast a spell while it is on the
 *                battlefield (before the spell resolves).
 *   creature(perm, game) → boolean   Is it a creature right now (gods).
 *   power(perm, game) → number       Its base power (for creatures whose
 *                power is a star).
 *   haste        Taps for mana the turn it enters.
 *   rampValue    A number: the casting policy casts it as ramp when it can
 *                afford it (bigger first), like a mana rock.
 *
 * Hooks act on the game only through its rules API (see planEngine.js,
 * "Rules API"): `game.turn`, `powerOf(perm)`, `isCreature(perm)`,
 * `distinctPowers()`, `controlsPower(n)`, `countSubtype(word)`,
 * `colorsAmongPermanents()`, `devotion(mask)`, `addMana(mask, n)`,
 * `addCounters(perm, n)`, `createToken(spec)`, `fetchLand(filter, opts)`,
 * `earthbend(n)`, `copySpell(card)`, `oncePerTurn(perm)`, `note(text)`.
 *
 * Adding a card: `defineCardRule('Card Name', rule(ferocious('{G}', '{G}{G}')))`
 * — or extend the regex detection below when a whole wording family shares
 * one rule (every "Ferocious — {T}: Add …" dork, say). Named rules win over
 * detected ones. Pure and DOM-free; the registry is filled when this module
 * loads.
 */

import { nameKey } from './library.js';

// ── Colours and mana outputs ─────────────────────────────────────────────────

export const W = 1;
export const U = 2;
export const B = 4;
export const R = 8;
export const G = 16;
/** Any colour. The engine narrows it to the deck's colour identity. */
export const ANY = 31;

const SYMBOL_BIT = Object.freeze({ w: W, u: U, b: B, r: R, g: G, c: 0 });

/** How the units of one mana ability may be spent. */
export const MODE = Object.freeze({ EACH: 0, ONE: 1, SET: 2 });

/**
 * A mana output: `n` units of `mask` in `mode`.
 * @param {number} n
 * @param {number} mask - colour bits (0 = colourless)
 * @param {number} [mode=MODE.EACH]
 */
export function out(n, mask, mode = MODE.EACH) {
    return { n: Math.max(0, Math.floor(n) || 0), mask: mask | 0, mode };
}

/**
 * The output of a written symbol run: '{G}' → 1 green, '{G}{G}{G}{G}' → 4
 * green, '{C}{C}' → 2 colourless. Mixed runs ('{G}{U}') are two units that
 * may each be either colour — close enough for paying costs.
 * @param {string} symbols
 */
export function symbols(symbols) {
    const list = String(symbols ?? '').toLowerCase().match(/\{([wubrgc])\}/g) ?? [];
    let mask = 0;
    for (const s of list) mask |= SYMBOL_BIT[s[1]];
    return out(list.length, mask);
}

/** Two mana of any one colour (Ilysian Caryatid's boosted ability). */
export function anyOne(n) {
    return out(n, ANY, MODE.ONE);
}

/** n mana of any colour, each unit its own colour (Birds of Paradise). */
export function anyEach(n) {
    return out(n, ANY, MODE.EACH);
}

function asOutput(spec) {
    if (spec && typeof spec === 'object') return out(spec.n, spec.mask, spec.mode);
    if (typeof spec === 'string') return symbols(spec);
    return out(0, 0);
}

function words(output) {
    const n = output.n;
    if (output.mode === MODE.ONE) return `${n} mana of any one colour`;
    if (output.mask === ANY) return `${n} mana of any colour`;
    const names = [['W', W], ['U', U], ['B', B], ['R', R], ['G', G]].filter(([, bit]) => output.mask & bit).map(([c]) => `{${c}}`);
    if (!names.length) return `{C}×${n}`;
    return names.length === 1 ? names[0].repeat(n) : `${n} mana (${names.join('/')})`;
}

// ── Rule factories ───────────────────────────────────────────────────────────
//
// Each factory returns a partial rule; combine them with rule(...parts).

/** Taps for a fixed amount: tapFor('{G}'), tapFor('{C}{C}'), tapFor(anyEach(1)). */
export function tapFor(spec) {
    const output = asOutput(spec);
    return { mana: () => output, manaSource: true, label: `Taps for ${words(output)}` };
}

/**
 * Taps for more while you control a creature with power `threshold` or
 * greater (Ferocious: Fanatic of Rhonas, Whisperer of the Wilds; "add …
 * instead": Ilysian Caryatid, Raucous Audience).
 * @param {string|Object} normal - output otherwise
 * @param {string|Object} boosted - output with the big creature
 * @param {{threshold?:number}} [opts]
 */
export function ferocious(normal, boosted, { threshold = 4 } = {}) {
    const lo = asOutput(normal);
    const hi = asOutput(boosted);
    return {
        mana: (_perm, game) => (game.controlsPower(threshold) ? hi : lo),
        manaSource: true,
        label: `Taps for ${words(lo)}, or ${words(hi)} while you control a creature with power ${threshold} or greater`
    };
}

/**
 * One mana per creature of a subtype you control (Priest of Titania: "for
 * each Elf on the battlefield" — in a goldfish, yours).
 * @param {string} subtype - e.g. 'elf'
 * @param {number} mask - colour of the mana
 */
export function perSubtype(subtype, mask) {
    const word = String(subtype).toLowerCase();
    return {
        mana: (_perm, game) => out(game.countSubtype(word), mask),
        manaSource: true,
        label: `Taps for ${words(out(1, mask))} for each ${word[0].toUpperCase()}${word.slice(1)} you control`
    };
}

/** One mana of a colour you choose for each different power among your creatures (Selvala, Eager Trailblazer). */
export function distinctPowers() {
    return {
        mana: (_perm, game) => out(game.distinctPowers(), ANY, MODE.ONE),
        manaSource: true,
        label: 'Taps for one mana of a chosen colour for each different power among your creatures'
    };
}

/** One mana of each colour among permanents you control (Bloom Tender). */
export function colorsAmongPermanents() {
    return {
        mana: (_perm, game) => {
            const mask = game.colorsAmongPermanents();
            let n = 0;
            for (let m = mask; m; m &= m - 1) n++;
            return out(n, mask, MODE.SET);
        },
        manaSource: true,
        label: 'Taps for one mana of each colour among your permanents'
    };
}

/** Whenever you tap a creature for mana, add one more (Badgermole Cub). */
export function tapBoost(spec = '{G}') {
    const output = asOutput(spec);
    return { tapBoost: { n: output.n, mask: output.mask }, manaSource: true, label: `Whenever you tap a creature for mana, adds ${words(output)} more` };
}

/**
 * At the beginning of your first main phase, a +1/+1 counter on it, then one
 * mana per counter on it (Jadzia Dax, Living Legacy).
 * @param {number} mask - colour of the mana
 */
export function mainPhaseCounterMana(mask = G) {
    return {
        onMainPhase: (perm, game) => {
            game.addCounters(perm, 1);
            game.addMana(mask, perm.counters);
            game.note(`${perm.card.name}: counter ${perm.counters}, adds ${words(out(perm.counters, mask))}`);
        },
        manaSource: true,
        label: `Each turn gets a +1/+1 counter, then adds ${words(out(1, mask))} for each counter on it`
    };
}

/**
 * Whenever you cast a creature spell, create a token (Selvala, Eager
 * Trailblazer's 1/1 red Mercenary).
 * @param {{name:string, power:number, toughness:number, colors?:number, subtypes?:string}} token
 */
export function creatureCastToken(token) {
    const spec = Object.freeze({ types: 'creature', colors: 0, subtypes: '', ...token });
    return {
        onCast: (perm, spell, game) => {
            if (!spell.creature) return;
            game.createToken(spec);
            game.note(`${perm.card.name}: ${spec.power}/${spec.toughness} ${spec.name} token`);
        },
        label: `Whenever you cast a creature spell, makes a ${spec.power}/${spec.toughness} ${spec.name}`
    };
}

/**
 * Whenever you cast a creature spell, search for a land and put it onto the
 * battlefield (Karametra, God of Harvests: a Forest or Plains card, tapped).
 * @param {string[]} types - basic land types it finds (lower case)
 * @param {{tapped?:boolean}} [opts]
 */
export function creatureCastFetch(types, { tapped = true } = {}) {
    const filter = Object.freeze({ types: types.map(t => String(t).toLowerCase()) });
    return {
        onCast: (perm, spell, game) => {
            if (!spell.creature) return;
            const land = game.fetchLand(filter, { tapped });
            if (land) game.note(`${perm.card.name}: ${land.name}${tapped ? ' (tapped)' : ''}`);
        },
        rampValue: 1,
        label: `Whenever you cast a creature spell, puts a ${filter.types.join(' or ')} onto the battlefield${tapped ? ' tapped' : ''}`
    };
}

/** When it enters, earthbend n: a land becomes a 0/0 creature with haste and n +1/+1 counters. */
export function earthbendOnEnter(n = 1) {
    return {
        onEnter: (perm, game) => {
            const land = game.earthbend(n);
            if (land) game.note(`${perm.card.name}: earthbends ${land.card.name}`);
        },
        label: `When it enters, earthbend ${n} (a land becomes a creature with haste)`
    };
}

/**
 * Whenever you cast a historic spell, copy it — once each turn (The Sixth
 * Doctor). A copy of a permanent spell is a token.
 */
export function copyHistoric() {
    return {
        onCast: (perm, spell, game) => {
            if (!spell.historic || !game.oncePerTurn(perm)) return;
            game.copySpell(spell);
            game.note(`${perm.card.name} copies ${spell.name}`);
        },
        label: 'Copies the first historic spell you cast each turn (a copied permanent is a token)'
    };
}

/**
 * A god: a creature only while your devotion reaches `n` (Karametra: green
 * and white, seven).
 * @param {number} mask - the colours devotion counts
 * @param {number} n
 */
export function devotionCreature(mask, n) {
    return {
        creature: (_perm, game) => game.devotion(mask) >= n,
        label: `A creature only while your devotion is ${n} or more`
    };
}

function chain(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (...args) => { a(...args); b(...args); };
}

/**
 * Combine partial rules into one. Labels join with "; ", event hooks
 * (onCast, onEnter, onMainPhase) run in order, and any other field from a
 * later part replaces an earlier one.
 * @param {...Object} parts
 * @returns {Readonly<Object>}
 */
export function rule(...parts) {
    const merged = {};
    const labels = [];
    for (const part of parts) {
        if (!part) continue;
        for (const [key, value] of Object.entries(part)) {
            if (key === 'label') labels.push(value);
            else if (key === 'onCast' || key === 'onEnter' || key === 'onMainPhase') merged[key] = chain(merged[key], value);
            else merged[key] = value;
        }
    }
    if (labels.length) merged.label = labels.join('; ');
    return Object.freeze(merged);
}

// ── Registry ─────────────────────────────────────────────────────────────────

const NAMED = new Map();

/**
 * Give a card a rule (replacing any it had). Keys are the front face's
 * nameKey(), so "Jadzia Dax, Living Legacy" and its curly-quoted spelling
 * share one entry.
 * @param {string} name
 * @param {Object} cardRule - rule(...) output or a plain rule object
 */
export function defineCardRule(name, cardRule) {
    const key = nameKey(name);
    if (!key) throw new Error('A card rule needs a card name');
    NAMED.set(key, Object.freeze({ ...cardRule, name: String(name) }));
}

/** The named rule for a card name, or null. */
export function namedRule(name) {
    return NAMED.get(nameKey(name)) ?? null;
}

/** Every card with a named rule, in the order they were defined. */
export function ruleNames() {
    return [...NAMED.values()].map(r => r.name);
}

// ── Detection from rules text ────────────────────────────────────────────────
//
// Wording families the engine understands on any card, so a deck's own
// Ferocious dork or "Elf" counter works without a named entry. Named rules
// win; a detected rule is marked `detected: true`.

const strip = text => String(text ?? '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[ \t]+/g, ' ');

function addPhrase(phrase) {
    const p = phrase.trim();
    const m = p.match(/^((?:\{[wubrgc]\})+)/);
    if (m) return symbols(m[1]);
    const any = p.match(/^(one|two|three) mana of any (one )?colou?r/);
    if (any) {
        const n = { one: 1, two: 2, three: 3 }[any[1]];
        return any[2] || n > 1 ? anyOne(n) : anyEach(n);
    }
    return null;
}

const DETECTORS = [
    // Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.
    text => {
        const boosted = text.match(/\{t\}: add ((?:\{[wubrgc]\})+)\. activate only if you control a creature with power (\d+) or greater/);
        if (!boosted) return null;
        const normal = text.match(/(?:^|\n)\{t\}: add ((?:\{[wubrgc]\})+)\.(?!\s*activate only)/);
        return ferocious(normal ? normal[1] : out(0, 0), boosted[1], { threshold: Number(boosted[2]) });
    },
    // {T}: Add {G}. If you control a creature with power 4 or greater, add {G}{G} instead.
    text => {
        const m = text.match(/\{t\}: add ([^.]+)\. if you control a creature with power (\d+) or greater, add ([^.]+?) instead/);
        if (!m) return null;
        const lo = addPhrase(m[1]);
        const hi = addPhrase(m[3]);
        return lo && hi ? ferocious(lo, hi, { threshold: Number(m[2]) }) : null;
    },
    // {T}: Add {G} for each Elf on the battlefield / you control.
    text => {
        const m = text.match(/\{t\}: add \{([wubrgc])\} for each ([a-z]+) (?:on the battlefield|you control)/);
        return m ? perSubtype(m[2], SYMBOL_BIT[m[1]]) : null;
    },
    text => (/for each colou?r among permanents you control, add one mana of that colou?r/.test(text) ? colorsAmongPermanents() : null),
    text => (/add one mana of that colou?r for each different power among creatures you control/.test(text) ? distinctPowers() : null),
    text => {
        const m = text.match(/whenever you tap a creature for mana, add an additional \{([wubrgc])\}/);
        return m ? tapBoost(`{${m[1]}}`) : null;
    },
    text => {
        const m = text.match(/at the beginning of your (?:first|precombat) main phase, put a \+1\/\+1 counter on [^,]+, then add an amount of \{([wubrg])\} equal to the number of (?:\+1\/\+1 )?counters on/);
        return m ? mainPhaseCounterMana(SYMBOL_BIT[m[1]]) : null;
    },
    text => {
        const m = text.match(/whenever you cast a creature spell, create an? (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless)(?: and (?:white|blue|black|red|green))?) ([a-z]+) creature token/);
        if (!m) return null;
        const COLOR_WORD = { white: W, blue: U, black: B, red: R, green: G, colorless: 0 };
        const colors = m[3].split(' and ').reduce((mask, w) => mask | (COLOR_WORD[w] ?? 0), 0);
        const name = m[4][0].toUpperCase() + m[4].slice(1);
        return creatureCastToken({ name, power: Number(m[1]), toughness: Number(m[2]), colors, subtypes: m[4] });
    },
    text => {
        const m = text.match(/whenever you cast a creature spell, you may search your library for an? ([a-z]+(?: or [a-z]+)?) card, put it onto the battlefield( tapped)?/);
        if (!m) return null;
        const types = m[1].split(' or ').filter(t => ['plains', 'island', 'swamp', 'mountain', 'forest'].includes(t));
        return types.length ? creatureCastFetch(types, { tapped: Boolean(m[2]) }) : null;
    },
    text => {
        const m = text.match(/when [^.]*? enters, earthbend (\d+)/);
        return m ? earthbendOnEnter(Number(m[1])) : null;
    },
    text => (/whenever you cast a historic spell, copy it/.test(text) ? copyHistoric() : null),
    text => {
        const m = text.match(/as long as your devotion to ([a-z]+)(?: and ([a-z]+))? is less than (\w+), [^.]* isn't a creature/);
        if (!m) return null;
        const COLOR_WORD = { white: W, blue: U, black: B, red: R, green: G };
        const NUM = { five: 5, six: 6, seven: 7, eight: 8 };
        const n = NUM[m[3]] ?? Number(m[3]);
        return Number.isFinite(n) ? devotionCreature((COLOR_WORD[m[1]] ?? 0) | (COLOR_WORD[m[2]] ?? 0), n) : null;
    }
];

const detectedMemo = new WeakMap();

/**
 * The rule this card's rules text implies, from the wording families above,
 * or null. Memoised per card record.
 * @param {Object} card - Scryfall-shaped record
 * @returns {Readonly<Object>|null}
 */
export function detectCardRule(card) {
    if (!card || typeof card !== 'object') return null;
    if (detectedMemo.has(card)) return detectedMemo.get(card);
    const text = strip(card.oracle_text ?? card.card_faces?.[0]?.oracle_text);
    const parts = DETECTORS.map(detect => detect(text)).filter(Boolean);
    const found = parts.length ? Object.freeze({ ...rule(...parts), name: String(card.name ?? ''), detected: true }) : null;
    detectedMemo.set(card, found);
    return found;
}

/**
 * The rule the engine uses for a card: its named rule, else the one its
 * rules text implies, else null (ramp.js alone describes it).
 * @param {Object|string} card - a card record (or a name: named rules only)
 * @returns {Readonly<Object>|null}
 */
export function cardRule(card) {
    if (typeof card === 'string') return namedRule(card);
    return namedRule(card?.name) ?? detectCardRule(card);
}

// ── The cards the user's plans are built on ─────────────────────────────────

defineCardRule('Selvala, Eager Trailblazer', rule(
    distinctPowers(),
    creatureCastToken({ name: 'Mercenary', power: 1, toughness: 1, colors: R, subtypes: 'mercenary' })
));
defineCardRule('Fanatic of Rhonas', rule(ferocious('{G}', '{G}{G}{G}{G}')));
defineCardRule('Whisperer of the Wilds', rule(ferocious('{G}', '{G}{G}')));
defineCardRule('Ilysian Caryatid', rule(ferocious(anyEach(1), anyOne(2))));
defineCardRule('Raucous Audience', rule(ferocious('{G}', '{G}{G}')));
defineCardRule('Bloom Tender', rule(colorsAmongPermanents()));
defineCardRule('Priest of Titania', rule(perSubtype('elf', G)));
defineCardRule('Badgermole Cub', rule(earthbendOnEnter(1), tapBoost('{G}')));
defineCardRule('Jadzia Dax, Living Legacy', rule(mainPhaseCounterMana(G)));
defineCardRule('Karametra, God of Harvests', rule(devotionCreature(G | W, 7), creatureCastFetch(['forest', 'plains'], { tapped: true })));
defineCardRule('The Sixth Doctor', rule(copyHistoric()));
defineCardRule('Susan Foreman', rule(tapFor('{G}')));
