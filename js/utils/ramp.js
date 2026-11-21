/**
 * Ramp — the one rule for what counts as ramp, read from rules text.
 *
 * Every page that counts ramp asks this module: the Deck Overview's "Ramp"
 * role and health check, Lands (cheap ramp as land drops), the Mulligan
 * Planner's "ramp piece" row, Opening Hands, Draw Odds and Mana Development.
 * `classifyRamp()` reads a card once and returns a descriptor; the card is
 * **ramp** when the descriptor says so (`ramp: true`):
 *
 *   - mana permanents: rocks, dorks, mana auras, planeswalker mana abilities;
 *   - land ramp: land searches (to the battlefield or your hand), extra land
 *     drops, playing lands from the top, putting a land from your hand;
 *   - Treasure makers;
 *   - and the ramp Mana Development can't simulate: mana that doesn't untap
 *     (Mana Vault), sacrifice-for-mana artifacts (Lotus Petal), lands or
 *     Treasure on a later trigger (Yavimaya Elder, Smothering Tithe), mana on
 *     a trigger (Lotus Cobra) and mana doublers (Zendikar Resurgent).
 *
 * Recognised but **not ramp**: rituals (one burst for one turn, the deck is no
 * faster afterwards) and cost reducers (they make spells cheaper rather than
 * add mana). Mana Development lists them as "helps your mana, not ramp".
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
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, x: 1 };
export const BASIC_TYPES = Object.freeze(['plains', 'island', 'swamp', 'mountain', 'forest']);
const BASIC_WORD = BASIC_TYPES.map(t => new RegExp(`\\b${t}\\b`));

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
const RAMP_UNMODELLED = new Set(['noUntap', 'oneShot', 'trigger', 'treasureTrigger', 'manaTrigger', 'doubler']);

function blankRamp() {
    return {
        kind: null,
        modelled: false,
        ramp: false,
        mana: 0, mask: 0, any: false, ready: 'now', variable: false, activation: 0,
        lands: 0, toHand: 0, landsTapped: false, landsVary: false, landFilter: null, filterKind: 0, filterBits: 0, extraCost: 0, sacrificeLand: 0,
        extraDrops: 0, extraDropsOnce: 0, putLand: 0, putLandTapped: false, putLandBasic: false, fromTop: false,
        treasure: 0, draws: 0,
        unmodelled: null,
        label: ''
    };
}

/**
 * Amount and colours of an "add …" phrase (lower case, after the word "add").
 * @returns {{amount:number, mask:number, variable:boolean, any:boolean}|null}
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
/** "Add" after a trigger: Lotus Cobra, Carpet of Flowers. */
const TRIGGERED_ADD = /(?:^|, |\. )(?:you may )?add (?:\{[wubrgc]\}|one mana|two mana|three mana|x mana|an amount of)/;
/** Extra land drops for you (or for everyone). */
const EXTRA_DROPS = /(?:you|each player) may play (an|one|two|three) additional lands? on each of (?:your|their) turns/;
const PUT_LAND = /put an? (basic )?land card from your hand(?: or graveyard)? onto the battlefield( tapped)?/;
/** Spells that cost less — but not "this spell costs {1} less" (Blasphemous Act). */
const REDUCER = /spells? you cast [^.]*cost (\{\d+\}|\{x\}|\w+ generic mana) less|costs? \{\d+\} less to cast/;
const DOUBLER = /whenever you tap (?:a|an) (?:land|permanent|creature|forest|[a-z]+) for mana, (?:add|its controller adds)|if you tap (?:a|an) (?:land|permanent|creature|[a-z]+) for mana, it produces (?:twice|three times) as much/;

/**
 * What a nonland card does for your mana, read from its rules text.
 *
 * Modelled (Mana Development simulates it): mana abilities on permanents
 * (rocks, dorks, auras like Utopia Sprawl, planeswalker mana abilities), land
 * searches on spells, ETBs and sacrifice abilities, extra land drops, playing
 * lands from the top, putting a land from your hand, and one-shot Treasure
 * (only when the page turns Treasure on).
 * Recognised, ramp, not modelled: mana that doesn't untap, sacrifice-for-mana,
 * lands / Treasure / mana on a later trigger, mana doublers.
 * Recognised, not ramp: rituals and cost reducers.
 *
 * @param {Object} card - Scryfall-shaped record
 * @param {{identity?:string[]}} [opts] - deck colour identity ("any colour" means these)
 * @returns {Readonly<Object>|null} a frozen descriptor (see blankRamp), or null
 *   when the card does nothing for your mana
 */
export function classifyRamp(card, { identity = COLORS } = {}) {
    if (!card || typeof card !== 'object') return null;
    const idKey = Array.isArray(identity) ? identity.join('') : '';
    let byIdentity = memo.get(card);
    if (!byIdentity) memo.set(card, (byIdentity = new Map()));
    if (byIdentity.has(idKey)) return byIdentity.get(idKey);
    const r = readRamp(card, maskOf(identity));
    const out = r ? Object.freeze(r) : null;
    byIdentity.set(idKey, out);
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
            } else if (TRIGGER.test(line) && TRIGGERED_ADD.test(line) && !DOUBLER.test(line)) {
                r.unmodelled = r.unmodelled ?? 'manaTrigger';
                continue;
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
            const m = sentence.slice(at).match(/^search your library for (a|an|one|two|three|four|x|up to (?:one|two|three|four|x)) ((?:[a-z/,]+ )*?)(?:land )?cards?\b(.*)$/);
            if (!m) continue;
            const what = m[2];
            const named = basicTypesIn(what);
            const isLandSearch = /\bland\b/.test(sentence.slice(at, at + 80)) && !/\bnonland\b/.test(what) || named.length > 0;
            if (!isLandSearch) continue;
            const word = m[1].replace(/^up to /, '');
            const count = WORDS[word] ?? 1;
            const dest = searchDestination(m[3], count);
            if (!dest) continue;
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
    for (const line of lines) {
        const put = line.match(PUT_LAND);
        if (!put) continue;
        if (TRIGGER.test(line.slice(0, put.index))) { r.unmodelled = r.unmodelled ?? 'trigger'; continue; }
        r.putLand = 1;
        r.putLandBasic = Boolean(put[1]);
        r.putLandTapped = Boolean(put[2]);
        if (!r.kind) r.kind = 'drops';
    }

    // 4. Treasure (one-shot mana). Counted only when the caller turns it on.
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

    // 5. Things recognised but not modelled.
    const name = String(card.name ?? '').split('//')[0].trim().toLowerCase();
    const others = text.replace(/this spell costs [^.]*\./g, '')
        .replace(name ? new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} costs [^.]*\\.`, 'g') : /$^/, '');
    if (REDUCER.test(others)) r.unmodelled = r.unmodelled ?? 'reducer';
    if (DOUBLER.test(text) && !r.kind) r.unmodelled = r.unmodelled ?? 'doubler';

    // Cards drawn by the ramp spell itself (Explore, Growth Spiral, Big Score).
    if (isSpell) {
        const draw = text.match(/(?:^|\. |\n)draw (a|one|two|three) cards?/);
        if (draw) r.draws = WORDS[draw[1]] ?? 0;
    }

    r.modelled = Boolean(r.mana || r.lands || r.toHand || r.extraDrops || r.extraDropsOnce || r.putLand || r.fromTop);
    if (!r.modelled && !r.treasure && !r.unmodelled) return null;
    if (!r.kind) r.kind = r.unmodelled ?? 'other';
    r.ramp = r.modelled || r.treasure > 0 || RAMP_UNMODELLED.has(r.unmodelled);
    r.label = describeRamp(r);
    return r;
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
    ritual: 'One burst of mana for a single turn — not ramp, not counted',
    oneShot: 'Sacrifice for one burst of mana — not counted',
    noUntap: 'Doesn’t untap each turn — not counted',
    trigger: 'Gets lands on a later trigger — not counted',
    treasureTrigger: 'Makes Treasure on a trigger — not counted',
    manaTrigger: 'Adds mana on a trigger — not counted',
    reducer: 'Makes spells cheaper — not ramp, not counted',
    doubler: 'Doubles mana from your lands — not counted'
};

/**
 * What the model thinks a ramp card does, in plain words — shown in Mana
 * Development's ramp table so a misread is easy to spot.
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
        if (r.landsVary) s += ' — varies, counted as 1';
        parts.push(s);
    }
    if (r.extraDrops) parts.push(`Lets you play ${r.extraDrops === 1 ? 'an extra land' : `${r.extraDrops} extra lands`} each turn`);
    if (r.fromTop) parts.push('Lets you play lands from the top of your library');
    if (r.extraDropsOnce) parts.push('One extra land drop the turn you cast it');
    if (r.putLand) parts.push(`Puts ${r.putLandBasic ? 'a basic land' : 'a land'} from your hand onto the battlefield${r.putLandTapped ? ' tapped' : ''}`);
    if (r.treasure) parts.push(`Makes ${r.treasure} Treasure — one-shot mana, counted only with Treasure on`);
    if (r.draws && parts.length) parts.push(`draws ${r.draws === 1 ? 'a card' : `${r.draws} cards`}`);
    if (!parts.length && r.unmodelled) return UNMODELLED_LABEL[r.unmodelled] ?? 'Not counted';
    let label = parts.join('; ');
    if (r.unmodelled && !r.modelled) label += `. ${UNMODELLED_LABEL[r.unmodelled]}`;
    return label;
}
