/**
 * Deck statistics — the format-agnostic numbers behind the Deck Overview and
 * the generic calculators (Draw Odds, Mana Base, Opening Hands).
 *
 * Everything is exact (hypergeometric), deterministic, and pure, so it is cheap
 * enough to recompute on every deck change and fully unit-tested.
 */

import { choose, drawType, drawTypeMin } from './hypergeometric.js';
import { COLORS, parseManaCost, landColors, deckColorIdentity } from './mana.js';
import { asLibrary, commandersOf, isLand, isLibrary, unlistedCopies } from './library.js';
import { tagDeck } from './cardTags.js';
import { FORMATS, cardsSeenByTurn } from './format.js';
import { readCommanders, commanderLabel } from './commanders.js';
import { pct, plural } from './text.js';

const TYPE_ORDER = ['creatures', 'planeswalkers', 'battles', 'artifacts', 'enchantments', 'instants', 'sorceries', 'lands'];

/**
 * The library's counted records, skipping empty rows. Commanders are never in
 * the library (see library.js): pass a DeckConfig snapshot for that, a bare
 * cardsByName map has no command zone.
 * @param {Object} deck - a DeckConfig snapshot, a Library, or a cardsByName map
 * @param {Object} [opts] - libraryOf() options
 * @returns {ReadonlyArray<Object>}
 */
export function deckCards(deck = {}, opts) {
    return asLibrary(deck, opts).cards;
}

/** The command zone's records of a snapshot (none for a Library or a bare map). */
function commanderCardsOf(deck) {
    return isLibrary(deck) ? [] : commandersOf(deck).map(c => c.card).filter(Boolean);
}

/**
 * The card that best represents a deck visually: its (first) commander, else
 * its most expensive legendary creature, else its most expensive nonland card.
 * @param {{commanders?:Array, commanderName?:string, cardsByName?:Object}} deck
 * @returns {string|null}
 */
export function featuredCardName(deck = {}) {
    const commander = readCommanders(deck)[0]?.name;
    if (commander) return commander;
    const cards = deckCards(deck.cardsByName).filter(c => !isLand(c));
    const byCost = (a, b) => (Number(b.cmc) || 0) - (Number(a.cmc) || 0) || a.name.localeCompare(b.name);
    const legend = cards.filter(c => /legendary creature/i.test(c.type_line ?? '')).sort(byCost)[0];
    return (legend ?? cards.sort(byCost)[0])?.name ?? null;
}

/**
 * Mana curve of nonland cards, bucketed 0…6 and 7+, split by primary type.
 * @returns {{buckets: Array<{mv:string, total:number, byType:Record<string,number>}>, average:number, median:number, nonlandCount:number}}
 */
export function manaCurve(cardsByName = {}) {
    const buckets = Array.from({ length: 8 }, (_, i) => ({ mv: i === 7 ? '7+' : String(i), total: 0, byType: {} }));
    const values = [];
    for (const card of deckCards(cardsByName)) {
        if (isLand(card)) continue;
        const copies = Number(card.count);
        const mv = Math.max(0, Math.floor(Number(card.cmc) || 0));
        const b = buckets[Math.min(7, mv)];
        const type = card.category ?? (card.allCategories?.[0]) ?? 'other';
        b.total += copies;
        b.byType[type] = (b.byType[type] ?? 0) + copies;
        for (let i = 0; i < copies; i++) values.push(mv);
    }
    values.sort((a, b) => a - b);
    const nonlandCount = values.length;
    const average = nonlandCount ? values.reduce((s, v) => s + v, 0) / nonlandCount : 0;
    const median = nonlandCount
        ? (nonlandCount % 2 ? values[(nonlandCount - 1) / 2] : (values[nonlandCount / 2 - 1] + values[nonlandCount / 2]) / 2)
        : 0;
    return { buckets, average, median, nonlandCount };
}

/**
 * Composition by primary type (each card counted once).
 * @returns {Array<{type:string, count:number}>}
 */
export function typeComposition(cardsByName = {}) {
    const counts = {};
    for (const card of deckCards(cardsByName)) {
        const type = isLand(card) ? 'lands' : (card.category ?? card.allCategories?.[0] ?? 'other');
        counts[type] = (counts[type] ?? 0) + Number(card.count);
    }
    return TYPE_ORDER.filter(t => counts[t] > 0).map(t => ({ type: t, count: counts[t] }))
        .concat(Object.keys(counts).filter(t => !TYPE_ORDER.includes(t)).map(t => ({ type: t, count: counts[t] })));
}

/**
 * Colour demand (pips on nonland cards) and supply (lands that make each colour).
 * The identity includes the commanders' even though they are not in the library.
 * @param {Object} deck - a DeckConfig snapshot, a Library, or a cardsByName map
 * @param {{commanderCards?:Array<Object|null>}} [opts] - default: the snapshot's command zone
 * @returns {{identity:string[], colors: Array<{color:string, pips:number, cards:number, sources:number, heaviest:{name:string, pips:number, mv:number}|null}>, colorlessLands:number}}
 */
export function colorProfile(deck = {}, { commanderCards = commanderCardsOf(deck) } = {}) {
    const cards = deckCards(deck);
    const identity = deckColorIdentity(cards, commanderCards);
    const out = Object.fromEntries(COLORS.map(c => [c, { color: c, pips: 0, cards: 0, sources: 0, heaviest: null }]));
    let colorlessLands = 0;

    // Basic-fetchers (Evolving Wilds) can only find the basics the deck runs.
    const basicColors = [...new Set(cards
        .filter(c => isLand(c) && /\bbasic\b/i.test(String(c.type_line ?? '').split('//')[0]))
        .flatMap(c => landColors(c, identity)))];

    for (const card of cards) {
        const copies = Number(card.count);
        if (isLand(card)) {
            const colors = landColors(card, identity, basicColors);
            if (colors.length === 0) colorlessLands += copies;
            colors.forEach(c => { out[c].sources += copies; });
            continue;
        }
        const { pips, x } = parseManaCost(card.mana_cost);
        // X spells are judged at X = 1: at X = 0 every X spell would look like
        // the hardest card of its colour, which nobody casts it as.
        const mv = Math.floor(Number(card.cmc) || 0) + x;
        for (const c of COLORS) {
            if (pips[c] <= 0) continue;
            out[c].pips += pips[c] * copies;
            out[c].cards += copies;
            // "Heaviest" = the card that is hardest to cast on curve: most pips,
            // then lowest mana value (fewer cards seen to find the sources).
            const h = out[c].heaviest;
            if (!h || pips[c] > h.pips || (pips[c] === h.pips && mv < h.mv)) {
                out[c].heaviest = { name: card.name, pips: pips[c], mv };
            }
        }
    }

    const colors = COLORS.filter(c => identity.includes(c) || out[c].pips > 0).map(c => out[c]);
    return { identity, colors, colorlessLands };
}

/**
 * Exact probability of having at least `pips` sources of a colour AND at least
 * `landsNeeded` lands among `seen` cards, plus the same conditioned on hitting
 * the land drops (Karsten's convention: "if you have the lands, are they the
 * right colours?").
 *
 * @param {{deckSize:number, lands:number, sources:number, pips:number, landsNeeded:number, seen:number}} p
 * @returns {{joint:number, conditional:number, landsOk:number}}
 */
export function colorCastProbability({ deckSize, lands, sources, pips, landsNeeded, seen }) {
    const N = Math.max(0, Math.floor(deckSize));
    const L = Math.min(N, Math.max(0, Math.floor(lands)));
    const S = Math.min(L, Math.max(0, Math.floor(sources)));
    const n = Math.min(N, Math.max(0, Math.floor(seen)));
    const need = Math.max(0, Math.floor(landsNeeded));
    const k = Math.max(0, Math.floor(pips));
    const total = choose(N, n);
    if (total === 0) return { joint: 0, conditional: 0, landsOk: 0 };

    let joint = 0;
    let landsOk = 0;
    for (let s = 0; s <= Math.min(S, n); s++) {
        const ws = choose(S, s);
        if (ws === 0) continue;
        for (let o = 0; o <= Math.min(L - S, n - s); o++) {
            const rest = n - s - o;
            const w = ws * choose(L - S, o) * choose(N - L, rest);
            if (w === 0) continue;
            if (s + o >= need) {
                landsOk += w;
                if (s >= k) joint += w;
            }
        }
    }
    joint /= total;
    landsOk /= total;
    return { joint, conditional: landsOk > 0 ? joint / landsOk : 0, landsOk };
}

/**
 * Smallest number of sources that reaches `target` conditional castability.
 * @returns {number|null} null if even all lands are not enough
 */
export function sourcesNeeded({ deckSize, lands, pips, landsNeeded, seen, target = 0.9 }) {
    for (let s = pips; s <= lands; s++) {
        if (colorCastProbability({ deckSize, lands, sources: s, pips, landsNeeded, seen }).conditional >= target) return s;
    }
    return null;
}

/**
 * Recommended land count from Frank Karsten's regressions (2022 Commander
 * article; 60-card version from his constructed analysis). These are fits to
 * many real decklists, so they are a starting point, not a rule.
 *
 * @param {{format:object, averageMV:number, cheapAccel:number}} p
 *   cheapAccel = ramp pieces plus card draw costing 2 or less
 * @returns {{recommended:number, low:number, high:number}}
 */
export function recommendedLands({ format = FORMATS.commander, averageMV = 3, cheapAccel = 0 }) {
    // The regressions were fit on decks averaging roughly 2–4.5 mana value.
    // Extrapolating a linear fit past that recommends absurd land counts for
    // big-spell ramp decks, so clamp the input and say so.
    const fitMV = Math.min(FIT_RANGE.max, Math.max(FIT_RANGE.min, averageMV));
    let value;
    if (format.key === 'commander') {
        value = 31.42 + 3.13 * fitMV - 0.28 * cheapAccel;
    } else {
        value = 19.59 + 1.90 * fitMV - 0.28 * cheapAccel;
        if (format.key === 'limited') value *= 40 / 60;
    }
    const recommended = Math.round(value);
    return { recommended, low: recommended - 1, high: recommended + 1, raw: value, extrapolated: fitMV !== averageMV };
}

/** Average mana values the land regressions were fit on. */
export const FIT_RANGE = Object.freeze({ min: 2, max: 4.5 });

/**
 * Opening-hand land distribution and land-drop odds.
 * @param {{deckSize:number, lands:number, format?:object, onPlay?:boolean}} p
 */
export function landOdds({ deckSize, lands, format = FORMATS.commander, onPlay = true }) {
    const hand = format.openingHand ?? 7;
    const openingDist = Array.from({ length: hand + 1 }, (_, k) => drawType(deckSize, lands, hand, k));
    const keepable = openingDist.slice(2, 5).reduce((s, p) => s + p, 0);
    const dropsBy = turn => drawTypeMin(deckSize, lands, cardsSeenByTurn(turn, { format, onPlay }), turn);
    return {
        openingDist,
        keepable,
        expectedInHand: deckSize > 0 ? hand * lands / deckSize : 0,
        dropsBy: { 2: dropsBy(2), 3: dropsBy(3), 4: dropsBy(4), 5: dropsBy(5), 6: dropsBy(6) }
    };
}

/** Commander role guidelines — soft community ranges, not rules. */
export const COMMANDER_GUIDELINES = Object.freeze({
    ramp: { low: 8, high: 14 },
    draw: { low: 8, high: 14 },
    removal: { low: 6, high: 12 },
    wipe: { low: 1, high: 4 }
});

/**
 * Full deck analysis for the overview: the library (commanders are never in
 * it — see library.js), with the commanders' colours in the identity.
 * @param {Object} deck - DeckConfig snapshot (needs cardsByName, actualCardCount, lands, commanderName / commanders)
 * @param {{format:object, onPlay?:boolean}} opts
 */
export function analyzeDeckStats(deck = {}, { format = FORMATS.commander, onPlay = true } = {}) {
    const library = asLibrary(deck, { format });
    const cards = library.cards;
    const hasCards = cards.length > 0;
    const deckSize = hasCards
        ? library.size + unlistedCopies(library, deck.actualCardCount)
        : (Number(deck.actualCardCount) || 0);
    const lands = hasCards
        ? cards.filter(isLand).reduce((s, c) => s + Number(c.count), 0)
        : (Number(deck.lands) || 0);

    const curve = manaCurve(library);
    const composition = typeComposition(library);
    const tags = tagDeck(cards);
    const color = colorProfile(library, { commanderCards: commanderCardsOf(deck) });

    const cheapAccel = cards.reduce((s, c) => {
        const t = tags.byCard[c.name] ?? [];
        // Karsten's coefficient is for CHEAP acceleration: rocks, dorks and
        // early ramp spells, plus card draw costing two or less.
        const mv = Number(c.cmc) || 0;
        return s + (((t.includes('ramp') && mv <= 3) || (t.includes('draw') && mv <= 2)) ? Number(c.count) : 0);
    }, 0);
    const heavyRamp = cards.reduce((s, c) =>
        s + ((tags.byCard[c.name] ?? []).includes('ramp') && (Number(c.cmc) || 0) > 3 ? Number(c.count) : 0), 0);
    const landRec = recommendedLands({ format, averageMV: curve.average, cheapAccel });
    const odds = landOdds({ deckSize, lands, format, onPlay });

    // Per-colour castability of the hardest card of each colour, on curve.
    const colors = color.colors.map(c => {
        if (!c.heaviest) return { ...c, onCurve: null, needed: null };
        const turn = Math.max(1, c.heaviest.mv);
        const seen = cardsSeenByTurn(turn, { format, onPlay });
        const p = colorCastProbability({ deckSize, lands, sources: c.sources, pips: c.heaviest.pips, landsNeeded: turn, seen });
        const needed = sourcesNeeded({ deckSize, lands, pips: c.heaviest.pips, landsNeeded: turn, seen });
        return { ...c, onCurve: p.conditional, needed };
    });

    return {
        deckSize,
        lands,
        nonlands: deckSize - lands,
        curve,
        composition,
        tags,
        identity: color.identity,
        colors,
        colorlessLands: color.colorlessLands,
        cheapAccel,
        heavyRamp,
        landRec,
        odds
    };
}

/**
 * Turn the analysis into plain-language findings.
 * Each finding: { id, status: 'good'|'warn'|'bad'|'info', title, detail, value }
 */
export function healthChecks(stats, { format = FORMATS.commander } = {}) {
    const findings = [];
    if (!stats || stats.deckSize === 0) return findings;

    // Land count against the regression
    const diff = stats.lands - stats.landRec.recommended;
    let landStatus = Math.abs(diff) <= 2 ? 'good' : Math.abs(diff) <= 4 ? 'warn' : 'bad';
    // Expensive ramp is real acceleration the regression has no term for, and
    // an extrapolated fit is not evidence enough for a red flag.
    const heavyRamp = stats.heavyRamp ?? 0;
    if (landStatus === 'bad' && (stats.landRec.extrapolated || (diff < 0 && heavyRamp >= 6))) landStatus = 'warn';
    findings.push({
        id: 'lands',
        status: landStatus,
        title: Math.abs(diff) <= 1 ? `${stats.lands} lands — right in the typical range`
            : diff > 0 ? `${stats.lands} lands — ${diff} above typical`
                : `${stats.lands} lands — ${-diff} below typical`,
        detail: `Decks with an average mana value of ${stats.curve.average.toFixed(2)} and ${stats.cheapAccel} cheap ramp or draw pieces usually run about ${stats.landRec.recommended} lands (Frank Karsten's regression).`
            + (diff < 0 && heavyRamp >= 6 ? ` You also run ${heavyRamp} ramp pieces costing 4 or more, which the formula does not count.` : '')
            + (stats.landRec.extrapolated ? ' Your curve is outside the range the formula was fit on, so treat this one loosely.' : ''),
        value: `${stats.lands} / ~${stats.landRec.recommended}`
    });

    // Opening hands
    const keep = stats.odds.keepable;
    findings.push({
        id: 'opener',
        status: keep >= 0.72 ? 'good' : keep >= 0.62 ? 'warn' : 'bad',
        title: `${pct(keep)} of opening hands have 2–4 lands`,
        detail: `On average you see ${stats.odds.expectedInHand.toFixed(1)} lands in your opening seven. Hands outside 2–4 lands are usually mulligans.`,
        value: pct(keep)
    });

    // Colours
    for (const c of stats.colors) {
        if (c.onCurve == null || !c.heaviest) continue;
        const p = c.onCurve;
        findings.push({
            id: `color-${c.color}`,
            color: c.color,
            status: p >= 0.88 ? 'good' : p >= 0.78 ? 'warn' : 'bad',
            title: plural(c.sources, `${colorWord(c.color).toLowerCase()} source`),
            detail: `Your most demanding ${colorWord(c.color).toLowerCase()} card is ${c.heaviest.name} (${plural(c.heaviest.pips, 'pip')} at mana value ${c.heaviest.mv}). With your lands it has the colours on curve ${pct(p)} of the time${c.needed != null && c.needed > c.sources ? `; about ${c.needed} sources would reach 90%` : ''}.`,
            value: pct(p)
        });
    }

    // Roles (Commander only — the guideline ranges are Commander ranges)
    if (format.key === 'commander') {
        for (const [tag, range] of Object.entries(COMMANDER_GUIDELINES)) {
            const n = stats.tags.counts[tag] ?? 0;
            const status = n >= range.low && n <= range.high ? 'good' : n < range.low ? (n < range.low - 3 ? 'bad' : 'warn') : 'info';
            const label = {
                ramp: n === 1 ? 'ramp piece' : 'ramp pieces',
                draw: n === 1 ? 'card draw source' : 'card draw sources',
                removal: 'targeted removal',
                wipe: n === 1 ? 'board wipe' : 'board wipes'
            }[tag];
            findings.push({
                id: `role-${tag}`,
                status,
                title: `${n} ${label}`,
                detail: `Many Commander players aim for ${range.low}–${range.high}. Detected from rules text, so unusual wordings can be missed.`,
                value: String(n)
            });
        }
    }

    return findings;
}

function colorWord(c) {
    return { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }[c] ?? c;
}

/** Community names for every colour combination, keyed in WUBRG order. */
const COMBO_NAMES = Object.freeze({
    '': 'Colourless', W: 'Mono-White', U: 'Mono-Blue', B: 'Mono-Black', R: 'Mono-Red', G: 'Mono-Green',
    WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', WG: 'Selesnya',
    WB: 'Orzhov', UR: 'Izzet', BG: 'Golgari', WR: 'Boros', UG: 'Simic',
    WUB: 'Esper', UBR: 'Grixis', BRG: 'Jund', WRG: 'Naya', WUG: 'Bant',
    WBG: 'Abzan', WUR: 'Jeskai', UBG: 'Sultai', WBR: 'Mardu', URG: 'Temur',
    WUBRG: 'Five-colour'
});

/** "Simic", "Mono-Red", "Four-colour" … for a WUBRG-ordered identity. */
export function colorComboName(identity = []) {
    const key = identity.join('');
    return COMBO_NAMES[key] ?? (identity.length === 4 ? 'Four-colour' : 'Multicolour');
}

/**
 * A readable default name for a deck that arrived without one (pasted lists):
 * its commanders ("Tymna the Weaver + Kraum, Ludevic's Opus"), else its
 * colours ("Mono-Red deck").
 * @param {{cardsByName?:Object, commanders?:Array, commanderName?:string|null}} deck
 */
export function suggestDeckName(deck = {}) {
    return commanderLabel(readCommanders(deck)) ?? `${colorComboName(deckColorIdentity(deck.cardsByName ?? {}))} deck`;
}
