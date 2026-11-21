/**
 * Mana development — how fast a deck's mana comes online.
 *
 * Two halves, both pure and DOM-free (tested in
 * tests/calculators/manadev.node.test.js):
 *
 *   1. A ramp classifier that reads rules text: mana rocks and dorks (how much
 *      they add, in which colours, whether they need a turn), land-fetch spells
 *      (how many lands, tapped or not, battlefield or hand), extra land drops.
 *      Rituals, cost reducers, mana doublers and triggered Treasure are
 *      recognised but deliberately NOT counted — each says so in its label.
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

import { COLORS, COLOR_NAMES } from './mana.js';
import { asLibrary, commandersOf, isLand, isLibrary } from './library.js';
import { mulberry32, shuffle } from './random.js';
import { quantile } from './stats.js';
import { inflect as plural } from './text.js';
import { tagCard } from './cardTags.js';
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

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
const BASIC_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'];

/** Basic land types as bits (same order as BASIC_TYPES), for fast type checks. */
export function typeBits(words = []) {
    let m = 0;
    BASIC_TYPES.forEach((t, i) => { if (words.includes(t)) m |= 1 << i; });
    return m;
}

function typeLineBits(typeLine) {
    const lower = String(typeLine ?? '').toLowerCase();
    return typeBits(BASIC_TYPES.filter(t => new RegExp(`\\b${t}\\b`).test(lower)));
}

/** How a land enters. */
export const TAP = Object.freeze({ UNTAPPED: 0, TAPPED: 1, FAST: 2, SLOW: 3, CHECK: 4 });

function popcount(m) {
    let n = 0;
    while (m) { n += m & 1; m >>= 1; }
    return n;
}

function stripReminder(text) {
    return String(text ?? '').replace(/\([^)]*\)/g, '').replace(/[ \t]+/g, ' ');
}

function symbolMask(symbols) {
    let m = 0;
    for (const s of symbols) m |= COLOR_BIT[s.toUpperCase()] ?? 0;
    return m;
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

function blankRamp() {
    return {
        kind: null,
        modelled: false,
        mana: 0, mask: 0, any: false, ready: 'now', variable: false, activation: 0,
        lands: 0, toHand: 0, landsTapped: false, landFilter: null, filterKind: 0, filterBits: 0, extraCost: 0, sacrificeLand: 0,
        extraDrops: 0, extraDropsOnce: 0, putLand: 0, fromTop: false,
        treasure: 0, draws: 0,
        unmodelled: null,
        label: ''
    };
}

/**
 * Amount and colours of an "add …" phrase (lower case, after the word "add").
 * @returns {{amount:number, mask:number, variable:boolean}|null}
 */
function parseAdd(phrase, idMask) {
    const p = phrase.trim();
    if (/\bfor each\b|\bequal to\b|^x mana|^an amount/.test(p)) {
        const syms = p.match(/\{([wubrgc])\}/g) ?? [];
        const mask = syms.length ? symbolMask(syms.map(s => s[1])) : idMask;
        return { amount: 1, mask, variable: true, any: !syms.length };
    }
    let m = p.match(/^((?:\{[wubrgc]\})+)((?: or \{[wubrgc]\})*)/);
    if (m) {
        const first = m[1].match(/\{([wubrgc])\}/g).map(s => s[1]);
        const alts = (m[2].match(/\{([wubrgc])\}/g) ?? []).map(s => s[1]);
        if (alts.length) return { amount: 1, mask: symbolMask([...first, ...alts]), variable: false, any: false };
        return { amount: first.length, mask: symbolMask(first), variable: false, any: false };
    }
    m = p.match(/^(one|two|three|four|five) mana (?:of any (?:one )?colou?r|in any combination of colou?rs|of the chosen colou?r|of any type)/);
    if (m) return { amount: WORDS[m[1]], mask: idMask, variable: false, any: true };
    return null;
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

const TRIGGER = /\bwhenever\b|\bat the beginning\b|\bdies\b|\battacks?\b|\blandfall\b|\bdeals combat damage\b|\bwhen [^,]*\b(leaves|is put into)\b/;

/**
 * What a nonland card does for your mana, read from its rules text.
 *
 * Counted (modelled): mana abilities on permanents (rocks, dorks, auras like
 * Utopia Sprawl, planeswalker mana abilities), land searches on spells, ETBs
 * and sacrifice abilities, extra land drops, playing lands from the top, and
 * one-shot Treasure (only when the caller turns Treasure on).
 * Recognised but not counted: rituals, mana that doesn't untap, cost reducers,
 * mana doublers, and anything that only happens on a later trigger.
 *
 * @param {Object} card - Scryfall-shaped record
 * @param {{identity?:string[]}} [opts] - deck colour identity ("any colour" means these)
 * @returns {Object|null} a ramp descriptor (see blankRamp) or null if it isn't ramp
 */
export function classifyRamp(card, { identity = COLORS } = {}) {
    if (!card || isLand(card)) return null;
    const text = stripReminder(String(card.oracle_text ?? '').toLowerCase());
    if (!text.trim()) return null;
    const typeLine = String(card.type_line ?? '').split('//')[0].toLowerCase();
    const isSpell = /\b(instant|sorcery)\b/.test(typeLine);
    const isCreature = /\bcreature\b/.test(typeLine);
    const isWalker = /\bplaneswalker\b/.test(typeLine);
    const idMask = maskOf(identity);
    const r = blankRamp();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Mana abilities on permanents — the best one counts (you tap once).
    if (!isSpell) {
        const noUntap = /doesn't untap during your untap step/.test(text);
        let best = null;
        for (const line of lines) {
            const loyalty = isWalker ? line.match(/^[+−-]?\d+: add (.+)$/) : null;
            const tapAbility = line.match(/^([^:]*\{t\}[^:]*): (.+)$/);
            let parsed = null;
            let activation = 0;
            if (loyalty) {
                parsed = parseAdd(loyalty[1], idMask);
            } else if (tapAbility) {
                const [, cost, effect] = tapAbility;
                if (/sacrifice/.test(cost)) {
                    if (/^add\b/.test(effect)) r.unmodelled = r.unmodelled ?? 'oneShot';
                    continue;
                }
                const add = effect.match(/^add (.+?)(?:\.|$)/);
                if (add) parsed = parseAdd(add[1], idMask);
                else if (/\badd (one|two|x)? ?mana\b|\badd \{/.test(effect)) parsed = { amount: 1, mask: idMask, variable: true, any: true };
                for (const s of cost.match(/\{([^}]+)\}/g) ?? []) {
                    const sym = s.slice(1, -1);
                    if (/^\d+$/.test(sym)) activation += Number(sym);
                    else if (sym !== 't' && sym !== 'q') activation += 1;
                }
            }
            if (!parsed) continue;
            // Variable mana (Selvala, Priest of Titania) counts as one more than it costs.
            if (parsed.variable) parsed.amount = Math.max(parsed.amount, activation + 1);
            const net = parsed.amount - activation;
            if (net <= 0) continue; // filters that don't add mana
            if (!best || net > best.net) best = { ...parsed, net, activation };
            else if (net === best.net) { best.mask |= parsed.mask; best.any = best.any || parsed.any; }
        }
        if (best && noUntap) {
            r.unmodelled = 'noUntap';
        } else if (best) {
            r.kind = isWalker ? 'walker' : isCreature ? 'dork' : 'rock';
            r.mana = best.net;
            r.mask = best.mask;
            r.variable = best.variable;
            r.any = best.any;
            r.activation = best.activation;
            const entersTapped = /enters tapped/.test(text);
            r.ready = entersTapped ? 'tapped' : (isCreature && !/\bhaste\b/.test(text) && !isWalker) ? 'sick' : 'now';
        }

        // Auras like Utopia Sprawl / Wild Growth: extra mana whenever the land taps.
        const aura = text.match(/whenever enchanted (?:land|forest|plains|island|swamp|mountain) is tapped for mana, its controller adds (?:an additional )?(.+?)(?:\.|$)/);
        if (!r.kind && aura) {
            const parsed = parseAdd(aura[1].replace(/^additional /, ''), idMask);
            if (parsed) {
                r.kind = 'aura';
                r.mana = parsed.amount;
                r.mask = parsed.mask;
                r.any = parsed.any;
                r.ready = 'next'; // the land usually paid for the aura this turn
            }
        }
    } else if (lines.some(l => /^add \{|^add (one|two|three|x) mana/.test(l))) {
        r.unmodelled = 'ritual';
    }

    // 2. Land searches (spells, ETBs, sacrifice abilities).
    for (const line of lines) {
        for (const sentence of line.split(/\.(?:\s|$)/)) {
            const at = sentence.indexOf('search your library for ');
            if (at < 0) continue;
            const prefix = sentence.slice(0, at);
            const linePrefix = line.slice(0, line.indexOf(sentence) + at);
            // The words before "card" are space-separated tokens ("forest," "or" "and/or"):
            // one way to split them, so text that never says "card" can't backtrack exponentially.
            const m = sentence.slice(at).match(/^search your library for (a|an|one|two|three|four|up to (?:one|two|three|four)) ((?:[a-z/,]+ )*?)(?:land )?cards?\b(.*)$/);
            if (!m) continue;
            const what = m[2];
            const isLandSearch = /\bland\b/.test(sentence.slice(at, at + 80)) && !/\bnonland\b/.test(what)
                || BASIC_TYPES.some(t => new RegExp(`\\b${t}\\b`).test(what));
            if (!isLandSearch) continue;
            const count = WORDS[m[1].replace(/^up to /, '')] ?? 1;
            const dest = searchDestination(m[3], count);
            if (!dest) continue;
            if (TRIGGER.test(linePrefix)) {
                r.unmodelled = r.unmodelled ?? 'trigger';
                continue;
            }
            const filter = /\bbasic\b/.test(what) ? 'basic'
                : BASIC_TYPES.filter(t => new RegExp(`\\b${t}\\b`).test(what));
            r.landFilter = Array.isArray(filter) && filter.length === 0 ? 'any' : filter;
            r.filterKind = r.landFilter === 'basic' ? 1 : r.landFilter === 'any' ? 0 : 2;
            r.filterBits = Array.isArray(r.landFilter) ? typeBits(r.landFilter) : 0;
            r.lands += dest.lands;
            r.toHand += dest.toHand;
            r.landsTapped = dest.tapped;
            // An activated search ("{2}, {T}, Sacrifice …:") costs its mana on top.
            const colon = prefix.lastIndexOf(':');
            if (colon >= 0) {
                for (const s of prefix.slice(0, colon).match(/\{(\d+)\}/g) ?? []) r.extraCost += Number(s.slice(1, -1));
            }
            if (!r.kind) r.kind = 'fetch';
        }
    }
    if ((r.lands || r.toHand) && /additional cost to cast this spell, sacrifice a land/.test(text)) r.sacrificeLand = 1;

    // 3. Extra land drops.
    const drops = text.match(/you may play (an|one|two|three) additional lands? on each of your turns/);
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
    for (const line of lines) {
        const at = line.search(/put a land card from your hand(?: or graveyard)? onto the battlefield/);
        if (at < 0) continue;
        if (TRIGGER.test(line.slice(0, at))) { r.unmodelled = r.unmodelled ?? 'trigger'; continue; }
        r.putLand = 1;
        if (!r.kind) r.kind = 'drops';
    }

    // 4. Treasure (one-shot mana). Counted only when the caller turns it on.
    for (const line of lines) {
        const tm = line.match(/create (a|an|one|two|three|four|five|x) (?:food token or a )?treasure tokens?/);
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

    // 5. Things recognised but not modelled.
    if (/spells? you cast [^.]*cost (\{\d+\}|\{x\}|\w+ generic mana) less|costs? \{\d+\} less to cast/.test(text)) {
        r.unmodelled = r.unmodelled ?? 'reducer';
    }
    if (/whenever you tap (?:a|an) (?:land|permanent|creature|forest|[a-z]+) for mana, (?:add|its controller adds)/.test(text) && !r.kind) {
        r.unmodelled = r.unmodelled ?? 'doubler';
    }

    // Cards drawn by the ramp spell itself (Explore, Growth Spiral, Big Score).
    if (isSpell) {
        const draw = text.match(/(?:^|\. |\n)draw (a|one|two|three) cards?/);
        if (draw) r.draws = WORDS[draw[1]] ?? 0;
    }

    r.modelled = Boolean(r.mana || r.lands || r.toHand || r.extraDrops || r.extraDropsOnce || r.putLand || r.fromTop);
    if (!r.modelled && !r.treasure && !r.unmodelled) return null;
    if (!r.kind) r.kind = r.unmodelled ?? 'other';
    r.label = describeRamp(r);
    return r;
}

/** A descriptor for a card other pages count as ramp but this model can't read. */
export function unreadRamp() {
    const r = blankRamp();
    r.kind = 'unread';
    r.unmodelled = 'unread';
    r.label = describeRamp(r);
    return r;
}

function manaWords(n, r) {
    const amount = r.variable ? `${n}+` : String(n);
    if (r.any) return `${amount} mana of any colour`;
    if (!r.mask) return `${amount} colourless mana`;
    return `${amount} ${COLORS.filter(c => r.mask & COLOR_BIT[c]).map(c => COLOR_NAMES[c].toLowerCase()).join(' or ')} mana`;
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

const UNMODELLED_LABEL = {
    ritual: 'One burst of mana for a single turn — not counted',
    oneShot: 'Sacrifice for one burst of mana — not counted',
    noUntap: 'Doesn’t untap each turn — not counted',
    trigger: 'Gets lands on a later trigger — not counted',
    treasureTrigger: 'Makes Treasure on a trigger — not counted',
    reducer: 'Makes spells cheaper — not counted',
    doubler: 'Doubles mana from your lands — not counted',
    unread: 'Tagged as ramp, but the model can’t read what it does — not counted'
};

/**
 * What the model thinks a ramp card does, in plain words — shown in the ramp
 * table so a misread is easy to spot.
 */
export function describeRamp(r) {
    const parts = [];
    if (r.mana) {
        const when = r.ready === 'now' ? 'from the turn you cast it'
            : r.ready === 'sick' ? 'from the next turn (summoning sick)'
                : r.ready === 'tapped' ? 'from the next turn (enters tapped)'
                    : 'from the next turn';
        const net = r.activation ? ` (net of its {${r.activation}} cost)` : '';
        parts.push(`Adds ${manaWords(r.mana, r)} a turn${net}, ${when}${r.variable ? ' — varies, counted as 1' : ''}`);
    }
    if (r.lands || r.toHand) {
        const where = [];
        if (r.lands) where.push(`${landWords(r.lands, r.landFilter, { article: r.lands === 1 })} onto the battlefield${r.landsTapped ? ' tapped' : ' untapped'}`);
        if (r.toHand) where.push(`${r.lands ? `${r.toHand} more` : landWords(r.toHand, r.landFilter, { article: r.toHand === 1 })} into your hand`);
        let s = `Puts ${where.join(' and ')}`;
        if (r.extraCost) s += ` (plus {${r.extraCost}} to activate)`;
        if (r.sacrificeLand) s += `, sacrificing a land`;
        parts.push(s);
    }
    if (r.extraDrops) parts.push(`Lets you play ${r.extraDrops === 1 ? 'an extra land' : `${r.extraDrops} extra lands`} each turn`);
    if (r.fromTop) parts.push('Lets you play lands from the top of your library');
    if (r.extraDropsOnce) parts.push('One extra land drop the turn you cast it');
    if (r.putLand) parts.push('Puts a land from your hand onto the battlefield');
    if (r.treasure) parts.push(`Makes ${r.treasure} Treasure — one-shot mana, counted only with Treasure on`);
    if (r.draws && parts.length) parts.push(`draws ${r.draws === 1 ? 'a card' : `${r.draws} cards`}`);
    if (!parts.length && r.unmodelled) return UNMODELLED_LABEL[r.unmodelled] ?? 'Not counted';
    let label = parts.join('; ');
    if (r.unmodelled && r.unmodelled !== 'unread' && !r.modelled) label += `. ${UNMODELLED_LABEL[r.unmodelled]}`;
    return label;
}

// ── Library ──────────────────────────────────────────────────────────────────

/**
 * Attach land and ramp behaviour to a lab card. Every card gets every field,
 * in the same order, so the simulator's hot loops see one object shape.
 */
function annotate(lab, card, identity, multiplayer) {
    const l = lab.land ? classifyLand(card, { multiplayer }) : null;
    lab.types = String(lab.typeLine ?? '').toLowerCase();
    lab.generic = lab.playMv == null ? 0 : Math.max(0, lab.playMv - lab.pips.length);
    lab.rampInfo = lab.land ? null : (classifyRamp(card, { identity }) ?? (lab.ramp ? unreadRamp() : null));
    lab.rampIndex = -1;
    lab.lmana = l ? l.mana : 0;
    lab.ltap = l ? l.tap : TAP.UNTAPPED;
    lab.lcheck = l ? l.checkTypes : null;
    lab.lcheckBits = typeBits(l?.checkTypes ?? []);
    lab.typeBits = l ? typeLineBits(lab.typeLine) : 0;
    lab.lbounce = l ? l.bounce : false;
    lab.basic = Boolean(l) && /\bbasic\b/.test(lab.types);
    return lab;
}

/**
 * The card your mana is racing towards: the commander when there is one (its
 * mana value and colours) — with partners, the more expensive of them —
 * otherwise your top end: the middle of your three most expensive spells.
 * @param {{commanderCards?:Array<Object|null>, commanderCard?:Object|null, cards?:Object[], identity?:string[]}} [opts]
 * @returns {{kind:'commander'|'top-end', name:string, mv:number, cost:string, card:Object, names:string[]}|null}
 */
export function chooseTarget({ commanderCards = [], commanderCard = null, cards = [], identity = COLORS } = {}) {
    const castable = [...(commanderCards ?? []), commanderCard]
        .filter(c => c && c.name && !isLand(c) && Number.isFinite(Number(c.cmc)))
        .map(c => ({ card: c, lab: annotate(toLabCard(c, -1, identity), c, identity, true) }));
    if (castable.length) {
        const { card, lab } = castable.reduce((best, c) => (c.lab.playMv > best.lab.playMv ? c : best));
        return { kind: 'commander', name: card.name, mv: lab.playMv, cost: lab.cost, card: lab, names: castable.map(c => c.card.name) };
    }
    const seen = new Set();
    const spells = [];
    for (const c of cards) {
        if (c.land || c.placeholder || !(c.playMv > 0) || seen.has(c.name)) continue;
        seen.add(c.name);
        spells.push(c);
    }
    if (spells.length === 0) return null;
    spells.sort((a, b) => b.playMv - a.playMv || a.name.localeCompare(b.name));
    const top = spells.slice(0, 3);
    const pick = top.length >= 3 ? top[1] : top[0];
    return { kind: 'top-end', name: pick.name, mv: pick.playMv, cost: pick.cost, card: pick, names: top.map(c => c.name) };
}

/**
 * Expand a decklist into simulator cards (one per copy) with land and ramp
 * behaviour attached. Commanders start in the command zone, never the library
 * (see library.js); their records set the colour identity and the target.
 *
 * @param {Object} deck - a DeckConfig snapshot, a Library, or a cardsByName map
 * @param {{format?:Object|string, commanders?:string[], commanderCards?:Array<Object|null>, multiplayer?:boolean}} [opts]
 *   commanderCards: the command zone's records (default: looked up on the
 *   snapshot — see commandersOf()); used only when the library has commanders
 */
export function buildManaLibrary(deck = {}, { format, commanders, commanderCards, multiplayer = true } = {}) {
    const library = asLibrary(deck, { format, commanders });
    const zone = !library.commanders.length ? []
        : (commanderCards ?? (isLibrary(deck) ? [] : commandersOf(deck).map(c => c.card))).filter(Boolean);
    const identity = identityOf(library.cards, zone);
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
    return {
        cards,
        identity,
        idMask: maskOf(identity),
        ramp,
        landCount: cards.filter(c => c.land).length,
        target: chooseTarget({ commanderCards: zone, cards, identity }),
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
        lmana: c.land ? 1 : 0, ltap: TAP.UNTAPPED, lcheck: null, lcheckBits: 0, typeBits: 0, lbounce: false, basic: c.land
    }));
    return {
        cards, identity: [], idMask: 0, ramp: [], landCount: cards.filter(c => c.land).length,
        target: null, placeholder: true, commanders: [], key: `counts:${libraryKey(cards)}`
    };
}

/** Number of ramp copies the simulator actually plays. */
export function countedRamp(lib, { treasure = false } = {}) {
    return (lib?.ramp ?? []).filter(r => r.info.modelled || (treasure && r.info.treasure)).reduce((s, r) => s + r.count, 0);
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

function landEntersTapped(card, lands) {
    switch (card.ltap) {
        case TAP.TAPPED: return true;
        case TAP.FAST: return lands.length > 2;
        case TAP.SLOW: return lands.length < 2;
        case TAP.CHECK: {
            for (let i = 0; i < lands.length; i++) if (lands[i].card.typeBits & card.lcheckBits) return false;
            return true;
        }
        default: return false;
    }
}

/** Does a library card satisfy a ramp card's search ("basic land", "Forest", "land")? */
function landMatches(card, r) {
    if (!card.land) return false;
    if (r.filterKind === 1) return card.basic;
    if (r.filterKind === 2) return (card.typeBits & r.filterBits) !== 0;
    return true;
}

/**
 * Play one goldfish game from a dealt hand.
 * @param {Object} run - simulator settings (see createRun)
 * @param {Object[]} hand0
 * @param {Object[]} library0
 * @param {boolean} rampOn - false: every ramp card is a blank (lands only)
 * @param {Object|null} log - collects a turn-by-turn record when given
 * @returns {{mana:Uint8Array, targetTurn:number, firstCast:Int8Array|null, firstSeen:Int8Array|null}}
 */
function playGame(run, hand0, library0, rampOn, log) {
    const T = SIM_TURNS;
    const target = run.target?.card ?? null;
    const targetPips = target ? target.pips.reduce((m, p) => m | p, 0) : 0;
    const hand = hand0.slice();
    const library = library0.slice();
    let top = 0;
    const lands = [];   // { card, ready }  ready = first turn it can tap
    const sources = []; // { info, ready }
    let extraDrops = 0;
    let fromTop = false;
    let treasures = 0;
    let targetTurn = 0;
    let t = 0;
    let drops = 0;
    let dropsUsed = 0;
    let floating = 0;      // a karoo's bounced land: you tap it before it leaves
    let floatingMask = 0;
    let entry = null;
    const mana = new Uint8Array(T + 1);
    const rampCount = run.rampCount;
    const firstCast = rampOn && rampCount ? new Int8Array(rampCount) : null;
    const firstSeen = rampCount ? new Int8Array(rampCount) : null;
    const treasureOn = run.treasure;

    const seen = c => {
        if (firstSeen && c.rampIndex >= 0 && !firstSeen[c.rampIndex]) firstSeen[c.rampIndex] = t;
    };
    const usable = c => c.rampInfo !== null && (c.rampInfo.modelled || (treasureOn && c.rampInfo.treasure > 0));
    const landMask = () => {
        let m = 0;
        for (let i = 0; i < lands.length; i++) m |= lands[i].card.mask;
        return m;
    };
    const neededColours = () => {
        let need = targetPips;
        for (let i = 0; i < hand.length; i++) {
            const pips = hand[i].pips;
            for (let k = 0; k < pips.length; k++) need |= pips[k];
        }
        return need;
    };
    const readyMana = () => {
        let n = treasures + floating;
        for (let i = 0; i < lands.length; i++) if (lands[i].ready <= t) n += lands[i].card.lmana;
        for (let i = 0; i < sources.length; i++) if (sources[i].ready <= t) n += sources[i].info.mana;
        return n;
    };
    const putOntoBattlefield = (card, tapped) => {
        const rec = { card, ready: tapped ? t + 1 : t };
        lands.push(rec);
        return rec;
    };

    /** Play one land from hand (or the top of the library). Returns its record or null. */
    const playLand = () => {
        const topCard = fromTop && top < library.length && library[top].land ? library[top] : null;
        let any = topCard !== null;
        let bump = topCard && !landEntersTapped(topCard, lands) && !topCard.lbounce ? topCard.lmana : 0;
        for (let i = 0; i < hand.length; i++) {
            const c = hand[i];
            if (!c.land) continue;
            any = true;
            if (!c.lbounce && !landEntersTapped(c, lands) && c.lmana > bump) bump = c.lmana;
        }
        if (!any) return null;
        // Does an untapped land's mana let you cast something this turn? If
        // not, a tapped land costs nothing — play it now and save the other.
        let matters = false;
        if (bump > 0) {
            const cap0 = readyMana();
            const hi = cap0 + bump;
            if (target && !targetTurn && target.playMv > cap0 && target.playMv <= hi) matters = true;
            for (let i = 0; i < hand.length && !matters; i++) {
                const mv = hand[i].playMv;
                if (!hand[i].land && mv != null && mv > cap0 && mv <= hi) matters = true;
            }
        }
        const have = landMask();
        const need = neededColours();
        let best = null;
        let bestScore = -Infinity;
        const consider = c => {
            if (c.lbounce && lands.length === 0) return; // would bounce itself
            const tapped = c.lbounce || landEntersTapped(c, lands);
            const fresh = c.mask & ~have;
            const score = ((tapped ? !matters : matters) ? 100000 : 0)
                + c.lmana * 1000 + BITS[fresh & need] * 100 + BITS[fresh] * 10 + BITS[c.mask]
                + (c === topCard ? 1 : 0); // a free card off the top beats one from hand
            if (score > bestScore) { best = c; bestScore = score; }
        };
        for (let i = 0; i < hand.length; i++) if (hand[i].land) consider(hand[i]);
        if (topCard) consider(topCard);
        if (!best) return null;
        if (best === topCard) top++;
        else hand.splice(hand.indexOf(best), 1);
        const rec = putOntoBattlefield(best, best.lbounce || landEntersTapped(best, lands));
        if (best.lbounce) {
            // Return the least useful other land — after tapping it for mana.
            let back = -1;
            let backScore = Infinity;
            for (let i = 0; i < lands.length - 1; i++) {
                const s = BITS[lands[i].card.mask] * 10 + lands[i].card.lmana;
                if (s < backScore) { back = i; backScore = s; }
            }
            const gone = lands.splice(back, 1)[0];
            if (gone.ready <= t) { floating += gone.card.lmana; floatingMask |= gone.card.mask; }
            hand.push(gone.card);
        }
        if (entry) entry.lands.push(best.name);
        return rec;
    };

    const checkTarget = () => {
        if (target && !targetTurn && pay(target) >= 0) {
            targetTurn = t;
            if (entry) entry.target = true;
        }
    };

    /** Fetch n lands matching the ramp card's filter, colours you need first. */
    const fetchLands = (r, n, toBattlefield, notes) => {
        for (let k = 0; k < n; k++) {
            const have = landMask();
            const need = neededColours();
            let bi = -1;
            let bs = -1;
            for (let i = top; i < library.length; i++) {
                const c = library[i];
                if (!landMatches(c, r)) continue;
                const fresh = c.mask & ~have;
                const s = BITS[fresh & need] * 100 + BITS[fresh] * 10 + BITS[c.mask];
                if (s > bs) { bs = s; bi = i; }
            }
            if (bi < 0) return;
            const c = library.splice(bi, 1)[0];
            if (toBattlefield) {
                const tapped = r.landsTapped || c.ltap === TAP.TAPPED || c.lbounce;
                putOntoBattlefield(c, tapped);
                if (!tapped) poolAdd(c.mask, c.lmana);
                notes.push(c.name);
            } else {
                hand.push(c);
                notes.push(`${c.name} to hand`);
            }
        }
    };

    /** Cast the best ramp piece you can afford. Returns false when nothing fits. */
    const castRamp = () => {
        let pick = null;
        let pickScore = -Infinity;
        let landInHand = false;
        for (let i = 0; i < hand.length; i++) if (hand[i].land) { landInHand = true; break; }
        for (let i = 0; i < hand.length; i++) {
            const c = hand[i];
            if (c.land || !usable(c)) continue;
            const r = c.rampInfo;
            let value = r.mana;
            if (r.lands || r.toHand) {
                const want = r.lands + r.toHand;
                let available = 0;
                for (let j = top; j < library.length && available < want; j++) if (landMatches(library[j], r)) available++;
                if (available === 0) continue;
                value += Math.min(r.lands, available) + Math.max(0, Math.min(r.toHand, available - r.lands)) * 0.5;
            }
            if (r.extraDrops) value += 0.6 * r.extraDrops;
            if (r.fromTop && !fromTop) value += 0.3;
            if (r.extraDropsOnce && landInHand && dropsUsed >= drops) value += 0.8;
            if (r.putLand && landInHand) value += 0.8;
            if (treasureOn && r.treasure) value += 0.5 * r.treasure;
            value -= r.sacrificeLand;
            if (value <= 0) continue;
            const cost = c.playMv + r.extraCost;
            const now = (r.mana && r.ready === 'now' ? r.mana : 0) + (r.lands && !r.landsTapped ? r.lands : 0) - cost;
            // Pieces that pay for themselves this turn first (Sol Ring), then
            // the most mana gained, then the cheapest.
            const score = (now >= 0 ? 1e6 : 0) + Math.round(value * 100) * 100 - cost;
            if (score <= pickScore) continue;
            if (pay(c, r.extraCost) < 0) continue;
            pick = c;
            pickScore = score;
        }
        if (!pick) return false;
        const r = pick.rampInfo;
        treasures -= pay(pick, r.extraCost, true);
        hand.splice(hand.indexOf(pick), 1);
        if (firstCast && pick.rampIndex >= 0 && !firstCast[pick.rampIndex]) firstCast[pick.rampIndex] = t;
        const notes = [];
        if (r.mana) {
            const ready = r.ready === 'now' ? t : t + 1;
            sources.push({ info: r, ready });
            if (ready <= t) poolAdd(r.mask, r.mana);
        }
        if (r.sacrificeLand && lands.length) {
            let worst = 0;
            for (let i = 1; i < lands.length; i++) if (BITS[lands[i].card.mask] < BITS[lands[worst].card.mask]) worst = i;
            lands.splice(worst, 1);
        }
        if (r.lands) fetchLands(r, r.lands, true, notes);
        if (r.toHand) fetchLands(r, r.toHand, false, notes);
        if (r.extraDrops) { extraDrops += r.extraDrops; drops += r.extraDrops; }
        if (r.extraDropsOnce) drops += r.extraDropsOnce;
        if (r.fromTop) fromTop = true;
        if (r.putLand) {
            const c = hand.find(x => x.land);
            if (c) {
                hand.splice(hand.indexOf(c), 1);
                const tapped = c.lbounce || landEntersTapped(c, lands);
                putOntoBattlefield(c, tapped);
                if (!tapped) poolAdd(c.mask, c.lmana);
                notes.push(c.name);
            }
        }
        if (treasureOn && r.treasure) {
            treasures += r.treasure;
            poolAdd(run.idMask, r.treasure, 1);
        }
        for (let k = 0; k < r.draws && top < library.length; k++) {
            const c = library[top++];
            hand.push(c);
            seen(c);
        }
        if (entry) entry.cast.push({ name: pick.name, notes });
        return true;
    };

    t = 1;
    for (const c of hand) seen(c);
    for (t = 1; t <= T; t++) {
        entry = log ? { turn: t, drew: null, lands: [], cast: [], mana: 0, colors: 0, target: false, landsInPlay: 0 } : null;
        floating = 0;
        floatingMask = 0;
        if (!(t === 1 && run.skipFirstDraw) && top < library.length) {
            const c = library[top++];
            hand.push(c);
            seen(c);
            if (entry) entry.drew = c.name;
        }
        drops = 1 + extraDrops;
        dropsUsed = 0;
        while (dropsUsed < drops && playLand()) dropsUsed++;

        // The pool: everything that can tap now.
        poolReset();
        for (let i = 0; i < lands.length; i++) if (lands[i].ready <= t) poolAdd(lands[i].card.mask, lands[i].card.lmana);
        for (let i = 0; i < sources.length; i++) if (sources[i].ready <= t) poolAdd(sources[i].info.mask, sources[i].info.mana);
        if (floating) poolAdd(floatingMask, floating);
        if (treasures) poolAdd(run.idMask, treasures, 1);
        mana[t] = Math.min(MAX_MANA, poolSize);
        if (entry) { entry.mana = poolSize; entry.colors = poolUnion; }
        checkTarget();

        if (rampOn) {
            for (let guard = 0; guard < 20 && castRamp(); guard++) {
                // Lands found or freed up by the ramp can still be played this turn.
                while (dropsUsed < drops) {
                    const rec = playLand();
                    if (!rec) break;
                    dropsUsed++;
                    if (rec.ready <= t) poolAdd(rec.card.mask, rec.card.lmana);
                }
                checkTarget();
            }
        }
        treasures = Math.max(0, treasures);
        if (entry) {
            entry.landsInPlay = lands.length;
            log.turns.push(entry);
        }
    }
    return { mana, targetTurn, firstCast, firstSeen };
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
    const rampCount = lib?.ramp?.length ?? 0;
    const mk = () => ({
        hist: Array.from({ length: T + 1 }, () => new Int32Array(MAX_MANA + 1)),
        // first[t][k]: games that first had k+ mana on turn t
        first: Array.from({ length: T + 1 }, () => new Int32Array(MAX_MANA + 1)),
        target: new Int32Array(T + 2)
    });
    return {
        lib,
        cards: lib?.cards ?? [],
        target: lib?.target ?? null,
        idMask: lib?.idMask ?? 0,
        rampCount,
        treasure: Boolean(treasure),
        freeMulligan: Boolean(format?.freeMulligan),
        skipFirstDraw: Boolean(onPlay) && !format?.firstPlayerDraws,
        games: Math.max(0, Math.floor(games) || 0),
        samples,
        rng: mulberry32(seed),
        idx: new Int32Array(lib?.cards?.length ?? 0),
        done: 0,
        ramp: mk(),
        lands: mk(),
        savedSum: 0,
        mulligans: 0,
        castBy3: new Int32Array(rampCount),
        castBy4: new Int32Array(rampCount),
        seenBy4: new Int32Array(rampCount),
        sampleGames: []
    };
}

function record(acc, res) {
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
}

/**
 * Play up to `count` more games. Returns true when the run is complete.
 */
export function runBatch(run, count = run.games) {
    if (run.cards.length < OPENING_HAND) { run.done = run.games; return true; }
    const end = Math.min(run.games, run.done + Math.max(1, count));
    for (let g = run.done; g < end; g++) {
        const { hand, library, mulligans } = dealOpeningHand(run.cards, run.rng, { freeMulligan: run.freeMulligan, idx: run.idx });
        run.mulligans += mulligans > (run.freeMulligan ? 1 : 0) ? 1 : 0;
        const log = run.sampleGames.length < run.samples ? { hand: hand.map(c => c.name), mulligans, turns: [] } : null;
        const withRamp = playGame(run, hand, library, true, log);
        const landsOnly = playGame(run, hand, library, false, null);
        record(run.ramp, withRamp);
        record(run.lands, landsOnly);
        const cap = SIM_TURNS + 1;
        run.savedSum += (landsOnly.targetTurn || cap) - (withRamp.targetTurn || cap);
        if (withRamp.firstCast) {
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

/** Turn the accumulated games into the page's numbers. */
export function finishRun(run) {
    const games = run.done;
    if (!games || run.cards.length < OPENING_HAND) return null;
    const lib = run.lib;
    const target = run.target;
    const ramp = (lib.ramp ?? []).map((r, i) => ({
        name: r.name,
        count: r.count,
        mv: r.mv,
        info: r.info,
        counted: r.info.modelled || (run.treasure && r.info.treasure > 0),
        castBy3: run.castBy3[i] / games,
        castBy4: run.castBy4[i] / games,
        seenBy4: run.seenBy4[i] / games
    }));
    return {
        games,
        lands: lib.landCount,
        librarySize: run.cards.length,
        placeholder: Boolean(lib.placeholder),
        rampCount: ramp.filter(r => r.counted).reduce((s, r) => s + r.count, 0),
        notCounted: ramp.filter(r => !r.counted).reduce((s, r) => s + r.count, 0),
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
 * @returns {{mana:number[], targetTurn:number, log:Object}} mana[t] for t = 1…SIM_TURNS (index 0 unused)
 */
export function playScriptedGame(lib, { hand = [], library = [], format = null, onPlay = true, treasure = false, rampOn = true } = {}) {
    const run = createRun(lib, { format, onPlay, treasure, games: 0 });
    const log = { hand: hand.map(c => c.name), mulligans: 0, turns: [] };
    const res = playGame(run, hand, library, rampOn, log);
    return { mana: Array.from(res.mana), targetTurn: res.targetTurn, log };
}

/** Run everything synchronously (tests, workers, small decks). */
export function simulateManaDevelopment(lib, opts = {}) {
    const run = createRun(lib, opts);
    runBatch(run, run.games);
    return finishRun(run);
}

// ── Words ────────────────────────────────────────────────────────────────────

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
    let tone = 'flat';
    if (t?.ramp) {
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
