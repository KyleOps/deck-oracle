/**
 * Card rules for the Game Plan engine — what a card does beyond what ramp.js
 * and Mana Development read from its rules text.
 *
 * ramp.js counts a Fanatic of Rhonas as "a dork that adds {G}" and a Selvala
 * as "variable mana, counted as one". That is the right rule for counting
 * ramp, but a plan like "Selvala on turn 3, eight mana of threats on turn 4"
 * lives or dies on the board: Fanatic adds {G}{G}{G}{G} once you control a
 * creature with power 4 or greater, Selvala adds one mana per different power
 * among your creatures, Priest of Titania one per Elf. Those cards get a
 * **rule** here, keyed by card name (the front face, `nameKey()`), and the
 * engine (planEngine.js) asks the rule instead of the generic readers. A
 * named rule that sets `ramp` (or `land`) replaces the generic reading
 * entirely, so the plans don't move when ramp.js does.
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
 *   grows        Its mana grows as you cast (Selvala, Bloom Tender, Priest):
 *                the payer taps it after everything else.
 *   manaSource   Counts as a mana source for plan groups ("a mana 2-drop")
 *                and the casting policy, even without a tap ability.
 *   ramp         A ramp descriptor (rampSpec()) that replaces ramp.js's
 *                reading; null = not ramp at all.
 *   land         Land behaviour (landRule()) replacing Mana Development's.
 *   face         An MDFC's land face (faceLand()).
 *   tapBoost     {n, mask}: whenever you tap a creature for mana, add this
 *                too (Badgermole Cub). Applies to every creature you tap.
 *   landBoost    {same, mask, n}: whenever you tap a land for mana, add one
 *                more of a type it made (same) or n of `mask` (Vorinclex,
 *                Zendikar Resurgent, Groundchuck & Dirtbag).
 *   onMainPhase(perm, game)   At the beginning of your first main phase.
 *   onEnter(perm, game)       When it enters the battlefield (cast, copied or
 *                put there).
 *   onResolve(game, ctx)      When it resolves as an instant or sorcery
 *                (ctx: {x, copy}).
 *   onCast(perm, spell, game) When you cast a spell while it is on the
 *                battlefield (before the spell resolves).
 *   onOtherEnter(perm, entered, game)  Whenever another permanent you
 *                control enters.
 *   onLandEnter(perm, land, game)      Whenever a land enters under your
 *                control (landfall).
 *   onCombat(perm, game)      Your combat (attack triggers).
 *   onEndStep(perm, game)     At the beginning of your end step.
 *   creature(perm, game) → boolean   Is it a creature right now (gods,
 *                Arixmethes).
 *   power(perm, game) → number       Its base power (for creatures whose
 *                power is a star).
 *   anthem       Other creatures you control get +n power (Elesh Norn).
 *   copies(spell) → boolean   It copies the first such spell you cast each
 *                turn (the policy casts its best target first).
 *   castable(card, game) → boolean   An extra condition to cast it (a target).
 *   discount(game) → number          Generic mana this spell costs less.
 *   discountOthers(spell, game) → number  Generic mana your spells cost less.
 *   x            {min}: an X spell; the policy pays the largest X it can.
 *   landsFromGraveyard  You may play lands from your graveyard.
 *   fromTop      {historic}: you may play such lands and cast such spells
 *                from the top of your library (Crystal Skull).
 *   haste        Taps for mana the turn it enters.
 *   rampValue    How much ramp it is, for choosing between ramp cards.
 *   landsFetched Lands it puts onto the battlefield (plan groups).
 *
 * Hooks act on the game only through its rules API (see planEngine.js,
 * "Rules API"). Adding a card:
 * `defineCardRule('Card Name', rule(ferocious('{G}', '{G}{G}')))` — or extend
 * the regex detection below when a whole wording family shares one rule
 * (every "Ferocious — {T}: Add …" dork, every battle land). Named rules win
 * over detected ones. Pure and DOM-free; the registry is filled when this
 * module loads.
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
const LETTER_BIT = Object.freeze({ W, U, B, R, G, C: 0 });

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

/** One of each listed colour: '{G}{U}' → {G} and {U} (Arixmethes). */
export function eachOf(symbolRun) {
    const s = symbols(symbolRun);
    return out(s.n, s.mask, MODE.SET);
}

function asOutput(spec) {
    if (spec && typeof spec === 'object') return out(spec.n, spec.mask, spec.mode);
    if (typeof spec === 'string') return symbols(spec);
    return out(0, 0);
}

/** Colour letters ('GW', 'C') → a mask. */
function lettersMask(letters) {
    let mask = 0;
    for (const ch of String(letters ?? '').toUpperCase()) mask |= LETTER_BIT[ch] ?? 0;
    return mask;
}

const COLOUR_NAMES = [['W', W], ['U', U], ['B', B], ['R', R], ['G', G]];

function maskWords(mask) {
    const names = COLOUR_NAMES.filter(([, bit]) => mask & bit).map(([c]) => `{${c}}`);
    return names.length ? names.join(' or ') : '{C}';
}

function words(output) {
    const n = output.n;
    if (output.mode === MODE.ONE) return `${n} mana of any one colour`;
    if (output.mode === MODE.SET) return COLOUR_NAMES.filter(([, bit]) => output.mask & bit).map(([c]) => `{${c}}`).join('');
    if (output.mask === ANY) return `${n} mana of any colour`;
    const names = COLOUR_NAMES.filter(([, bit]) => output.mask & bit).map(([c]) => `{${c}}`);
    if (!names.length) return '{C}'.repeat(n);
    return names.length === 1 ? names[0].repeat(n) : `${n} mana (${names.join('/')})`;
}

/**
 * A ramp descriptor in ramp.js's shape, for named rules that replace its
 * reading (missing fields are zero / off).
 * @param {Object} [fields]
 */
export function rampSpec(fields = {}) {
    return Object.freeze({
        kind: 'rule', modelled: true, ramp: true,
        mana: 0, mask: 0, any: false, ready: 'now', variable: false, activation: 0,
        lands: 0, toHand: 0, landsTapped: true, landsVary: false, landFilter: null, filterKind: 0, filterBits: 0, filterTown: false, distinct: false,
        extraCost: 0, sacrificeLand: 0, extraDrops: 0, extraDropsOnce: 0, putLand: 0, putLandTapped: false, putLandBasic: false, fromTop: false,
        treasure: 0, draws: 0, unmodelled: null, label: '',
        ...fields
    });
}

const BASIC_BIT = Object.freeze({ plains: 1, island: 2, swamp: 4, mountain: 8, forest: 16 });

function typeMask(types) {
    let m = 0;
    for (const t of [].concat(types ?? [])) m |= BASIC_BIT[String(t).toLowerCase()] ?? 0;
    return m;
}

// ── Rule factories ───────────────────────────────────────────────────────────
//
// Each factory returns a partial rule; combine them with rule(...parts).

/** Taps for a fixed amount: tapFor('{G}'), tapFor('{C}{C}'), tapFor(anyEach(1)), tapFor(eachOf('{G}{U}')). */
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
        grows: true,
        label: `Taps for ${words(out(1, mask))} for each ${word[0].toUpperCase()}${word.slice(1)} you control`
    };
}

/** One mana of a colour you choose for each different power among your creatures (Selvala, Eager Trailblazer). */
export function distinctPowers() {
    return {
        mana: (_perm, game) => out(game.distinctPowers(), ANY, MODE.ONE),
        manaSource: true,
        grows: true,
        label: 'Taps for one mana of a chosen colour for each different power among your creatures (0 counts)'
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
        grows: true,
        label: 'Taps for one mana of each colour among your permanents'
    };
}

/** Whenever you tap a creature for mana, add one more (Badgermole Cub). */
export function tapBoost(spec = '{G}') {
    const output = asOutput(spec);
    return { tapBoost: { n: output.n, mask: output.mask }, manaSource: true, label: `Whenever you tap a creature for mana, adds ${words(output)} more` };
}

/**
 * Whenever you tap a land for mana, add more: one of a type it made
 * (Vorinclex, Zendikar Resurgent) or n of a colour (Groundchuck & Dirtbag).
 * @param {{same?:boolean, mask?:number, n?:number}} spec
 */
export function landTapBonus({ same = false, mask = 0, n = 1 } = {}) {
    return {
        landBoost: Object.freeze({ same, mask, n }),
        manaSource: true,
        rampValue: 2,
        label: same ? 'Whenever you tap a land for mana, adds one more of a type it made' : `Whenever you tap a land for mana, adds ${words(out(n, mask))}`
    };
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
        castToken: spec,
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

/**
 * Whenever you cast a creature spell, look at the top five and put a land
 * from among them onto the battlefield tapped (Silverback Elder's mode).
 */
export function creatureCastLookForLand(n = 5) {
    return {
        onCast: (perm, spell, game) => {
            if (!spell.creature) return;
            const found = game.revealTop(n, { pick: c => c.land, max: 1, tapped: true, rest: 'bottom' });
            if (found.length) game.note(`${perm.card.name}: ${found[0].name} (tapped)`);
        },
        rampValue: 1,
        label: `Whenever you cast a creature spell, puts a land from the top ${n} onto the battlefield tapped`
    };
}

/** When it enters, earthbend n: a land becomes a 0/0 creature with haste and n +1/+1 counters. */
export function earthbendOnEnter(n = 1) {
    return {
        onEnter: (perm, game) => {
            const land = game.earthbend(n);
            if (land) game.note(`${perm.card.name}: earthbends ${land.card.name}`);
        },
        earthbend: n,
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
        copies: spell => spell.historic === true,
        label: 'Copies the first historic spell you cast each turn (a copied permanent is a token; X is kept)'
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

/** Not a creature (Arixmethes, Slumbering Isle is a land while it slumbers). */
export function notCreature(label = 'Not a creature while it slumbers') {
    return { creature: () => false, label };
}

/** Its power is worked out from the board (Lumra: lands you control). */
export function powerFrom(fn, label) {
    return { power: (perm, game) => fn(game, perm), label };
}

/** Other creatures you control get +n power (Elesh Norn, Grand Cenobite). */
export function anthem(n) {
    return { anthem: n, label: `Other creatures you control get +${n} power` };
}

/** You may play an additional land on each of your turns (n more). */
export function extraLandDrops(n = 1) {
    return {
        ramp: rampSpec({ kind: 'drops', extraDrops: n, label: `Lets you play ${n} extra land each turn` }),
        rampValue: 0.6 * n,
        label: `You may play ${n === 1 ? 'an additional land' : `${n} additional lands`} each turn`
    };
}

/** You may play lands from your graveyard (Icetill Explorer: a cracked fetchland comes back). */
export function landsFromGraveyard() {
    return { landsFromGraveyard: true, label: 'You may play lands from your graveyard' };
}

/** Landfall: mill n (Icetill Explorer). */
export function landfallMill(n = 1) {
    return {
        onLandEnter: (_perm, _land, game) => { game.mill(n); },
        label: `Whenever a land enters under your control, mill ${n}`
    };
}

/**
 * Search for lands and put them onto the battlefield (a sorcery, or the ETB
 * of a permanent).
 * @param {number} count
 * @param {{find?:'basic'|'any'|string[], tapped?:boolean, town?:boolean, distinct?:boolean}} [opts]
 *   find: 'basic', 'any', or basic land types ('forest' finds Forest cards,
 *   duals included); town: basic or Town cards; distinct: different names.
 */
export function searchLands(count, { find = 'basic', tapped = true, town = false, distinct = false } = {}) {
    const kind = find === 'basic' ? 1 : find === 'any' ? 0 : 2;
    const bits = kind === 2 ? typeMask(find) : 0;
    const what = find === 'basic' ? `basic land${town ? ' or Town' : ''}` : find === 'any' ? 'land' : `${[].concat(find).join(' or ')}`;
    return {
        ramp: rampSpec({ kind: 'fetch', lands: count, landsTapped: tapped, filterKind: kind, filterBits: bits, filterTown: town, distinct }),
        landsFetched: count,
        label: `Puts ${count === 1 ? 'a' : count} ${what}${count === 1 ? '' : 's'}${distinct ? ' with different names' : ''} onto the battlefield${tapped ? ' tapped' : ' untapped'}`
    };
}

/**
 * When it enters, reveal from the top until `count` land cards; put them onto
 * the battlefield (U.S.S. Voyager: tapped), the rest on the bottom.
 */
export function revealUntilLands(count, { tapped = true } = {}) {
    return {
        onEnter: (perm, game) => {
            const found = game.revealUntil(c => c.land, count, { tapped });
            if (found.length) game.note(`${perm.card.name}: ${found.map(c => c.name).join(', ')}${tapped ? ' (tapped)' : ''}`);
        },
        ramp: rampSpec({ kind: 'reveal' }),
        rampValue: count,
        landsFetched: count,
        label: `When it enters, reveals until ${count} lands and puts them onto the battlefield${tapped ? ' tapped' : ''}`
    };
}

/**
 * When it enters, exile up to `count` lands with different names from your
 * library; at each of your end steps one of them at random enters tapped
 * (Omenpath Journey).
 */
export function exiledLandEachEndStep(count = 5) {
    return {
        onEnter: (perm, game) => {
            perm.exiled = game.exileLands(count);
            game.note(`${perm.card.name} exiles ${perm.exiled.map(c => c.name).join(', ')}`);
        },
        onEndStep: (perm, game) => {
            if (!perm.exiled?.length) return;
            const at = Math.floor(game.random() * perm.exiled.length);
            const land = perm.exiled.splice(at, 1)[0];
            game.putLandFromEffect(land, { tapped: true });
            game.note(`${perm.card.name}: ${land.name} (tapped)`);
        },
        ramp: rampSpec({ kind: 'delayed' }),
        rampValue: 1.5,
        landsFetched: 1,
        label: `Exiles up to ${count} lands with different names; one of them enters tapped at each of your end steps`
    };
}

/**
 * An X spell that looks at the top X: lands (and permanents with mana value
 * X or less) onto the battlefield, the rest into your graveyard (Genesis
 * Wave: every permanent; Kamahl's Druidic Vow: lands and legendary ones).
 * @param {{permanents?:'all'|'legendary', min?:number}} [opts]
 */
export function lookAtTopX({ permanents = 'all', min = 1 } = {}) {
    const takes = permanents === 'legendary'
        ? (c, x) => c.land || (c.permanent && c.legendary && c.mv <= x)
        : (c, x) => c.land || (c.permanent && c.mv <= x);
    return {
        onResolve: (game, ctx) => {
            const x = ctx?.x ?? 0;
            const found = game.revealTop(x, { pick: c => takes(c, x), tapped: false, rest: 'grave' });
            game.note(`X=${x}: ${found.length ? found.map(c => c.name).join(', ') : 'nothing'}`);
        },
        x: Object.freeze({ min }),
        ramp: rampSpec({ kind: 'reveal' }),
        rampValue: 0.4,
        label: `X spell: looks at the top X and puts ${permanents === 'legendary' ? 'lands and legendary permanents' : 'lands and permanents'} with mana value X or less onto the battlefield untapped`
    };
}

/**
 * When it enters, look at the top n; you may put a creature card into your
 * hand, the rest on the bottom (Growing Rites of Itlimoc).
 */
export function lookForCreature(n = 4) {
    return {
        onEnter: (perm, game) => {
            const found = game.revealTop(n, { pick: c => c.creature && !c.land, max: 1, toHand: true, rest: 'bottom', best: c => c.mv });
            if (found.length) game.note(`${perm.card.name}: ${found[0].name} to hand`);
        },
        label: `When it enters, a creature from the top ${n} goes to your hand`
    };
}

/**
 * At your end step, if you control `creatures` or more creatures, it becomes
 * a land that taps for {G} per creature (Growing Rites → Itlimoc).
 */
export function transformsIntoItlimoc(creatures = 4) {
    return {
        onEndStep: (perm, game) => {
            if (perm.flipped || game.countCreatures() < creatures) return;
            perm.flipped = true;
            game.touch();
            game.note(`${perm.card.name} transforms into Itlimoc, Cradle of the Sun`);
        },
        mana: (perm, game) => (perm.flipped ? out(Math.max(1, game.countCreatures()), G) : null),
        manaSource: true,
        grows: true,
        label: `With ${creatures}+ creatures at your end step it becomes Itlimoc: {G} per creature you control`
    };
}

/** When it enters, mill n, then return every land card from your graveyard tapped (Lumra). */
export function millThenReturnLands(n = 4) {
    return {
        onEnter: (perm, game) => {
            game.mill(n);
            const back = game.returnLandsFromGraveyard({ tapped: true });
            if (back.length) game.note(`${perm.card.name}: ${back.map(c => c.name).join(', ')} back (tapped)`);
        },
        rampValue: 1,
        label: `When it enters, mills ${n} and returns every land card from your graveyard tapped`
    };
}

/**
 * When it enters, reveal the top n; creature and/or land cards to your hand,
 * the rest on the bottom (Torsten, Founder of Benalia).
 */
export function revealTakeCreaturesAndLands(n = 7) {
    return {
        onEnter: (perm, game) => {
            const found = game.revealTop(n, { pick: c => c.land || c.creature, toHand: true, rest: 'bottom' });
            if (found.length) game.note(`${perm.card.name}: ${found.length} cards to hand`);
        },
        label: `When it enters, creature and land cards from the top ${n} go to your hand`
    };
}

/** When it enters, draw n, then put up to `lands` lands from your hand onto the battlefield tapped (Lt. Arex). */
export function drawThenPutLands(n = 3, lands = 3) {
    return {
        onEnter: (perm, game) => {
            for (let i = 0; i < n; i++) game.drawCard();
            let put = 0;
            while (put < lands && game.putLandFromHand({ tapped: true })) put++;
            if (put) game.note(`${perm.card.name}: draws ${n}, ${put} ${put === 1 ? 'land' : 'lands'} from hand (tapped)`);
        },
        rampValue: 1.5,
        label: `When it enters, draws ${n} and puts up to ${lands} lands from your hand onto the battlefield tapped`
    };
}

/** When it enters, create a token (The Earth King's 4/4 Bear). */
export function tokenOnEnter(token) {
    const spec = Object.freeze({ types: 'creature', colors: 0, subtypes: '', ...token });
    return {
        onEnter: (perm, game) => {
            game.createToken(spec);
            game.note(`${perm.card.name}: ${spec.power}/${spec.toughness} ${spec.name} token`);
        },
        label: `When it enters, makes a ${spec.power}/${spec.toughness} ${spec.name}`
    };
}

/**
 * Whenever creatures with power `threshold`+ attack, a basic land per
 * attacker onto the battlefield tapped (The Earth King). The goldfish attacks
 * with every such creature that isn't summoning sick.
 */
export function attackFetchBasics(threshold = 4) {
    return {
        onCombat: (perm, game) => {
            const n = game.countAttackers(threshold);
            let got = 0;
            for (let i = 0; i < n; i++) if (game.fetchLand({ basic: true }, { tapped: true })) got++;
            if (got) game.note(`${perm.card.name}: ${got} basic ${got === 1 ? 'land' : 'lands'} (tapped) after attacking`);
        },
        rampValue: 1,
        label: `Whenever creatures with power ${threshold}+ attack, a basic land (tapped) for each`
    };
}

/**
 * Whenever a nontoken creature you control enters, a +1/+1 counter on it and
 * draw a card (The Great Henge).
 */
export function counterAndDrawOnCreature() {
    return {
        onOtherEnter: (perm, entered, game) => {
            if (entered.token || !game.isCreature(entered)) return;
            game.addCounters(entered, 1);
            game.drawCard();
            game.note(`${perm.card.name}: +1/+1 counter on ${entered.card.name}, draws a card`);
        },
        label: 'Whenever a nontoken creature you control enters, puts a +1/+1 counter on it and draws'
    };
}

/**
 * Whenever another permanent you control enters (not put there by this),
 * put a permanent card with equal or lesser mana value from your hand onto
 * the battlefield (Kodama of the East Tree: a land entering drops another).
 */
export function kodamaDrop() {
    return {
        onOtherEnter: (perm, entered, game) => {
            if (entered.viaKodama) return;
            const put = game.putPermanentFromHand(entered.card.land ? 0 : entered.card.mv);
            if (put) {
                put.viaKodama = true;
                game.note(`${perm.card.name}: ${put.card.name} from hand`);
            }
        },
        rampValue: 0.5,
        label: 'Whenever another permanent enters, puts a permanent card with equal or lesser mana value from your hand onto the battlefield'
    };
}

/** Explores whenever it or another creature you control enters (Captain Kathryn Janeway). */
export function exploreOnCreatures() {
    return {
        onEnter: (perm, game) => game.explore(perm),
        onOtherEnter: (_perm, entered, game) => {
            if (game.isCreature(entered)) game.explore(entered);
        },
        label: 'Whenever it or another creature you control enters, that creature explores (a land on top goes to your hand)'
    };
}

/** This spell costs {X} less, X = the greatest power among your creatures (The Great Henge). */
export function discountByGreatestPower() {
    return {
        discount: game => Math.max(0, game.greatestPower()),
        label: 'Costs {X} less, X = the greatest power among your creatures'
    };
}

/** Spells matching `test` cost n less (Ugin, the Ineffable: colourless spells, {2}). */
export function discountSpells(test, n, label) {
    return { discountOthers: spell => (test(spell) ? n : 0), label };
}

/** Castable only with a nonland permanent card in your graveyard to target (Restoration Seminar). */
export function needsGraveyardPermanent() {
    return {
        castable: (_card, game) => game.graveHas(c => !c.land && c.permanent),
        label: 'Needs a nonland permanent card in your graveyard to target'
    };
}

/** Lets you play historic lands and cast historic spells from the top of your library (Crystal Skull). */
export function historicFromTop() {
    return { fromTop: Object.freeze({ historic: true }), label: 'You may play historic lands and cast historic spells from the top of your library' };
}

// ── Lands ────────────────────────────────────────────────────────────────────

/**
 * A land's behaviour, replacing what Mana Development reads from its text.
 * @param {Object} spec
 * @param {string} [spec.produces='C'] - colour letters it can make, one at a time ('GW', 'U', 'C')
 * @param {boolean|'shock'} [spec.tapped=false] - enters tapped; 'shock': pay `life` or it enters tapped
 * @param {number} [spec.life=0] - life to pay for 'shock'
 * @param {number} [spec.unlessBasics] - untapped if you control this many basic lands
 * @param {string[]} [spec.unlessTypes] - untapped if you control a land of one of these types
 * @param {{colors:string, ifTypes:string[]}} [spec.alsoMakes] - more colours while you control such a land (the Verges)
 * @param {number} [spec.hideaway] - Hideaway n: the top n leave the top of your library as it enters
 * @param {boolean} [spec.allForests] - every land is a Forest (Yavimaya)
 */
export function landRule({ produces = 'C', tapped = false, life = 0, unlessBasics = 0, unlessTypes = null, alsoMakes = null, hideaway = 0, allForests = false } = {}) {
    const mask = lettersMask(produces);
    let tap = tapped === 'shock' ? 'shock' : tapped ? 'tapped' : 'untapped';
    if (unlessBasics) tap = 'basics';
    else if (unlessTypes?.length) tap = 'types';
    const land = Object.freeze({
        n: 1, mask, tap, life: tapped === 'shock' ? life : 0, basics: unlessBasics,
        checkBits: typeMask(unlessTypes), extraMask: alsoMakes ? lettersMask(alsoMakes.colors) : 0,
        extraBits: alsoMakes ? typeMask(alsoMakes.ifTypes) : 0, hideaway, allForests
    });
    const parts = [`Taps for ${maskWords(mask)}`];
    if (alsoMakes) parts.push(`or ${maskWords(land.extraMask)} while you control a ${[].concat(alsoMakes.ifTypes).join(' or ')}`);
    if (tap === 'tapped') parts.push('enters tapped');
    if (tap === 'shock') parts.push(`pay ${life} life or it enters tapped (paid only when the mana is needed that turn)`);
    if (tap === 'basics') parts.push(`enters tapped unless you control ${unlessBasics} or more basic lands`);
    if (tap === 'types') parts.push(`enters tapped unless you control a ${[].concat(unlessTypes).join(' or ')}`);
    if (hideaway) parts.push(`hideaway ${hideaway} (the top ${hideaway} cards leave the top of your library)`);
    if (allForests) parts.push('every land is a Forest, so every land can tap for {G}');
    return { land, label: parts.join('; ') };
}

/**
 * The land face of a modal double-faced card. `use: 'land'` plays it as a
 * land (its spell side isn't part of any plan); `use: 'either'` keeps the
 * spell and plays the land only when you would otherwise miss a land drop.
 * @param {string} name - the land face's name
 * @param {Object} spec - landRule() spec
 * @param {{use?:'land'|'either'}} [opts]
 */
export function faceLand(name, spec, { use = 'either' } = {}) {
    const land = landRule(spec);
    return {
        face: Object.freeze({ name, land: land.land, use }),
        label: use === 'land' ? `Played as ${name}: ${land.label.charAt(0).toLowerCase()}${land.label.slice(1)}` : `Played as ${name} (${land.label.charAt(0).toLowerCase()}${land.label.slice(1)}) only when it would otherwise miss a land drop`
    };
}

const CHAINED = new Set(['onCast', 'onEnter', 'onMainPhase', 'onResolve', 'onOtherEnter', 'onLandEnter', 'onCombat', 'onEndStep']);

function chain(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (...args) => { a(...args); b(...args); };
}

/**
 * Combine partial rules into one. Labels join with "; ", event hooks run in
 * order, `rampValue` adds up, and any other field from a later part replaces
 * an earlier one.
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
            else if (CHAINED.has(key)) merged[key] = chain(merged[key], value);
            else if (key === 'rampValue') merged.rampValue = (merged.rampValue ?? 0) + value;
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
// Ferocious dork, "Elf" counter or battle land works without a named entry.
// Named rules win; a detected rule is marked `detected: true`.

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

const COLOR_WORD = Object.freeze({ white: W, blue: U, black: B, red: R, green: G, colorless: 0 });
const NUMBER_WORD = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 });

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
        if (/whenever you tap a land for mana, add one mana of any type that land produced/.test(text)) return landTapBonus({ same: true });
        const m = text.match(/whenever you tap a land for mana, add \{([wubrgc])\}/);
        return m ? landTapBonus({ mask: SYMBOL_BIT[m[1]] }) : null;
    },
    text => {
        const m = text.match(/at the beginning of your (?:first|precombat) main phase, put a \+1\/\+1 counter on [^,]+, then add an amount of \{([wubrg])\} equal to the number of (?:\+1\/\+1 )?counters on/);
        return m ? mainPhaseCounterMana(SYMBOL_BIT[m[1]]) : null;
    },
    text => {
        const m = text.match(/whenever you cast a creature spell, create an? (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless)(?: and (?:white|blue|black|red|green))?) ([a-z]+) creature token/);
        if (!m) return null;
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
        const n = NUMBER_WORD[m[3]] ?? Number(m[3]);
        return Number.isFinite(n) ? devotionCreature((COLOR_WORD[m[1]] ?? 0) | (COLOR_WORD[m[2]] ?? 0), n) : null;
    }
];

/** Land wording families: battle lands, "unless you control a basic land", the Verges, shocks, hideaway, Yavimaya. */
function detectLand(text, card) {
    const produced = (Array.isArray(card?.produced_mana) ? card.produced_mana : []).join('');
    const base = text.match(/(?:^|\n)\{t\}: add \{([wubrgc])\}\.(?!\s*activate only)/);
    let produces = null;
    let spec = null;
    const verge = text.match(/\{t\}: add \{([wubrg])\}\. activate only if you control an? ([a-z]+) or an? ([a-z]+)/);
    if (verge && base) {
        produces = base[1].toUpperCase();
        spec = { alsoMakes: { colors: verge[1].toUpperCase(), ifTypes: [verge[2], verge[3]] } };
    }
    const basics = text.match(/enters tapped unless you control (two|three) or more basic lands/);
    if (basics) spec = { ...spec, unlessBasics: NUMBER_WORD[basics[1]] };
    else if (/enters tapped unless you control a basic land/.test(text)) spec = { ...spec, unlessBasics: 1 };
    const shock = text.match(/as this land enters, you may pay (\d+) life\. if you don't, it enters tapped/);
    if (shock) spec = { ...spec, tapped: 'shock', life: Number(shock[1]) };
    const hide = text.match(/hideaway (\d+)/);
    if (hide) spec = { ...spec, hideaway: Number(hide[1]), tapped: spec?.tapped ?? /this land enters tapped/.test(text) };
    if (/each land is a forest in addition to its other land types/.test(text)) spec = { ...spec, allForests: true };
    if (!spec) return null;
    if (!produces) produces = produced.replace(/[^WUBRGC]/g, '') || (base ? base[1].toUpperCase() : 'C');
    return landRule({ produces, ...spec });
}

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
    const isLandCard = /\bland\b/i.test(String(card.type_line ?? '').split('//')[0]);
    const parts = isLandCard ? [detectLand(text, card)].filter(Boolean) : DETECTORS.map(detect => detect(text)).filter(Boolean);
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
//
// Every board-dependent card in Wild Splendor (Selvala) and Doctor Whostoric
// (The Sixth Doctor + Susan Foreman), from their Oracle text and rulings.

const MERCENARY = { name: 'Mercenary', power: 1, toughness: 1, colors: R, subtypes: 'mercenary' };
const sick = rampSpec({ kind: 'dork', ready: 'sick' });
const rock = rampSpec({ kind: 'rock' });

// Commanders
defineCardRule('Selvala, Eager Trailblazer', rule(distinctPowers(), creatureCastToken(MERCENARY), { ramp: sick }));
defineCardRule('The Sixth Doctor', rule(copyHistoric(), { ramp: null }));
defineCardRule('Susan Foreman', rule(tapFor('{G}'), { ramp: sick }));

// Mana creatures and rocks
defineCardRule('Fanatic of Rhonas', rule(ferocious('{G}', '{G}{G}{G}{G}'), { ramp: sick }));
defineCardRule('Whisperer of the Wilds', rule(ferocious('{G}', '{G}{G}'), { ramp: sick }));
defineCardRule('Ilysian Caryatid', rule(ferocious(anyEach(1), anyOne(2)), { ramp: sick }));
defineCardRule('Raucous Audience', rule(ferocious('{G}', '{G}{G}'), { ramp: sick }));
defineCardRule('Bloom Tender', rule(colorsAmongPermanents(), { ramp: sick }));
defineCardRule('Priest of Titania', rule(perSubtype('elf', G), { ramp: sick }));
defineCardRule('Badgermole Cub', rule(earthbendOnEnter(1), tapBoost('{G}'), { ramp: sick }));
defineCardRule('Jadzia Dax, Living Legacy', rule(mainPhaseCounterMana(G), { ramp: sick }));
defineCardRule('Tangled Florahedron', rule(tapFor('{G}'), faceLand('Tangled Vale', { produces: 'G', tapped: true }), { ramp: sick }));
defineCardRule('Bramble Familiar', rule(tapFor('{G}'), { ramp: sick, label: 'Its adventure, Fetch Quest, is not cast: the plan casts the creature on turn 2' }));
defineCardRule('Trailtracker Scout', rule(tapFor(anyEach(1)), { ramp: sick }));
defineCardRule('The Mind Stone', rule(tapFor('{W}'), { ramp: rock }));
defineCardRule('Crystal Skull, Isu Spyglass', rule(tapFor('{U}'), historicFromTop(), { ramp: rock }));
defineCardRule('Arixmethes, Slumbering Isle', rule(tapFor(eachOf('{G}{U}')), notCreature('A land, not a creature, while it slumbers: enters tapped, then taps for {G}{U}'),
    { ramp: rampSpec({ kind: 'dork', ready: 'tapped' }), rampValue: 2, landsFetched: 0 }));
defineCardRule('Ugin, Eye of the Storms', rule(tapFor('{C}{C}{C}'), { ramp: rampSpec({ kind: 'walker' }), label: 'Its 0 ability adds {C}{C}{C} the turn it enters (a copy too)' }));
defineCardRule('The Great Henge', rule(tapFor('{G}{G}'), discountByGreatestPower(), counterAndDrawOnCreature(), { ramp: rock }));
defineCardRule('Growing Rites of Itlimoc', rule(lookForCreature(4), transformsIntoItlimoc(4), { ramp: rampSpec({ kind: 'transform' }) }));

// Land ramp
defineCardRule('Explosive Vegetation', searchLands(2, { find: 'basic' }));
defineCardRule('Migration Path', searchLands(2, { find: 'basic' }));
defineCardRule('Vastwood Surge', searchLands(2, { find: 'basic' }));
defineCardRule('Map the Frontier', searchLands(2, { find: 'basic' }));
defineCardRule('Encroaching Dragonstorm', searchLands(2, { find: 'basic' }));
defineCardRule('Invasion of Zendikar', searchLands(2, { find: 'basic' }));
defineCardRule('Reach the Horizon', searchLands(2, { find: 'basic', town: true, distinct: true }));
defineCardRule("Ranger's Path", searchLands(2, { find: ['forest'] }));
defineCardRule('Hunting Wilds', searchLands(2, { find: ['forest'] }));
defineCardRule('Skyshroud Claim', searchLands(2, { find: ['forest'], tapped: false }));
defineCardRule('Reshape the Earth', searchLands(10, { find: 'any' }));
defineCardRule('Through the Forest Gate', rule({
    onResolve: game => {
        const found = game.revealTop(20, { pick: c => c.land, tapped: true, rest: 'stay' });
        game.note(`${found.length} lands from the top 20 (tapped)`);
    },
    ramp: rampSpec({ kind: 'reveal' }), rampValue: 3, landsFetched: 3,
    label: 'Puts every land from the top 20 onto the battlefield tapped'
}));
defineCardRule('U.S.S. Voyager, Lone Wanderer', revealUntilLands(2, { tapped: true }));
defineCardRule('Omenpath Journey', exiledLandEachEndStep(5));
defineCardRule("Kamahl's Druidic Vow", lookAtTopX({ permanents: 'legendary', min: 1 }));
defineCardRule('Genesis Wave', rule(lookAtTopX({ permanents: 'all', min: 1 }), { ramp: null, rampValue: 0 }));
defineCardRule('Karametra, God of Harvests', rule(devotionCreature(G | W, 7), creatureCastFetch(['forest', 'plains'], { tapped: true }), { ramp: rampSpec({ kind: 'trigger' }) }));
defineCardRule('Silverback Elder', rule(creatureCastLookForLand(5), { ramp: rampSpec({ kind: 'trigger' }) }));
defineCardRule('Lumra, Bellow of the Woods', rule(powerFrom(game => game.landCount, 'Power = lands you control'), millThenReturnLands(4), { ramp: rampSpec({ kind: 'reveal' }) }));
defineCardRule('Lt. Arex, Ever-Adapting', rule(powerFrom(game => game.distinctLandNames(), 'Power = differently named lands you control'), drawThenPutLands(3, 3), { ramp: rampSpec({ kind: 'trigger' }) }));
defineCardRule('Kodama of the East Tree', rule(kodamaDrop(), { ramp: rampSpec({ kind: 'trigger' }) }));
defineCardRule('Torsten, Founder of Benalia', revealTakeCreaturesAndLands(7));

// Extra land drops
defineCardRule('Icetill Explorer', rule(extraLandDrops(1), landsFromGraveyard(), landfallMill(1)));
defineCardRule('Captain Kathryn Janeway', rule(extraLandDrops(1), exploreOnCreatures()));
defineCardRule('Aesi, Tyrant of Gyre Strait', rule(extraLandDrops(1), { label: 'Landfall draws are not modelled' }));
defineCardRule('The Earth King', rule(tokenOnEnter({ name: 'Bear', power: 4, toughness: 4, colors: G, subtypes: 'bear' }), attackFetchBasics(4), { ramp: rampSpec({ kind: 'trigger' }) }));

// Doublers and cost reducers
defineCardRule('Zendikar Resurgent', rule(landTapBonus({ same: true }), { ramp: rampSpec({ kind: 'doubler' }), label: 'Its creature-spell draws are not modelled' }));
defineCardRule('Vorinclex, Voice of Hunger', rule(landTapBonus({ same: true }), { ramp: rampSpec({ kind: 'doubler' }) }));
defineCardRule('Groundchuck & Dirtbag', rule(landTapBonus({ mask: G, n: 1 }), { ramp: rampSpec({ kind: 'doubler' }) }));
defineCardRule('Ugin, the Ineffable', rule(discountSpells(spell => spell.colors === 0 && !spell.land, 2, 'Colourless spells you cast cost {2} less'), { ramp: null }));

// Payoffs whose board effects change the mana
defineCardRule('Elesh Norn, Grand Cenobite', anthem(2));
defineCardRule('Restoration Seminar', needsGraveyardPermanent());

// MDFC land faces
defineCardRule('Disciple of Freyalise', faceLand('Garden of Freyalise', { produces: 'G', tapped: 'shock', life: 3 }, { use: 'land' }));
defineCardRule('Witch Enchanter', faceLand('Witch-Blessed Meadow', { produces: 'W', tapped: 'shock', life: 3 }, { use: 'either' }));
defineCardRule('Sea Gate Restoration', faceLand('Sea Gate, Reborn', { produces: 'U', tapped: 'shock', life: 3 }, { use: 'land' }));
defineCardRule('Sink into Stupor', faceLand('Soporific Springs', { produces: 'U', tapped: 'shock', life: 3 }, { use: 'land' }));

// Lands whose text Mana Development reads differently
defineCardRule('Urza\'s Cave', rule(landRule({ produces: 'C' }), { label: 'Its {3} land search is not used (it costs four mana and nets no land)' }));
defineCardRule('Lazotep Quarry', rule(landRule({ produces: 'C' }), { label: 'Its sacrifice-a-creature mana is not used' }));
defineCardRule('Talon Gates of Madara', rule(landRule({ produces: 'C' }), { label: 'Its {1} filter is not used (it nets no mana)' }));
defineCardRule('Hushwood Verge', landRule({ produces: 'G', alsoMakes: { colors: 'W', ifTypes: ['forest', 'plains'] } }));
defineCardRule('Willowrush Verge', landRule({ produces: 'U', alsoMakes: { colors: 'G', ifTypes: ['forest', 'island'] } }));
defineCardRule('Canopy Vista', landRule({ produces: 'GW', unlessBasics: 2 }));
defineCardRule('Ba Sing Se', rule(landRule({ produces: 'G', unlessBasics: 1 }), { label: 'Its earthbend ability is not used' }));
defineCardRule('Temple Garden', landRule({ produces: 'GW', tapped: 'shock', life: 2 }));
defineCardRule('Breeding Pool', landRule({ produces: 'GU', tapped: 'shock', life: 2 }));
defineCardRule('Mosswort Bridge', landRule({ produces: 'G', tapped: true, hideaway: 4 }));
defineCardRule('Windbrisk Heights', landRule({ produces: 'W', tapped: true, hideaway: 4 }));
defineCardRule('Clive\'s Hideaway', landRule({ produces: 'C', hideaway: 4 }));
defineCardRule('Yavimaya, Cradle of Growth', landRule({ produces: 'G', allForests: true }));
