/**
 * Portent of Calamity — {X}{U} sorcery. The page's maths.
 *
 * "Reveal the top X cards of your library. For each card type, you may exile a
 * card of that type from among them. Put the rest into your graveyard. You may
 * cast a spell from among the exiled cards without paying its mana cost if you
 * exiled four or more cards this way. Then put the rest of the exiled cards
 * into your hand."
 *
 * A card with several types (an artifact creature) can be exiled for only one
 * of them, so the number of cards Portent exiles is a maximum matching between
 * card types and revealed cards — not simply the number of distinct types on
 * show. With at most eight types the matching is tiny, so each simulated reveal
 * grows it one card at a time with augmenting paths.
 *
 * Pure: no DOM, no deck state. The page passes the library in.
 */

import { createCache } from '../simulation.js';
import { toneFor } from '../components.js';
import { CARD_TYPES, cardTypes } from '../library.js';
import { avg, pct, plural } from '../text.js';
import { deckCardList } from './cardList.js';

/** The card this page casts: the cast copy is on the stack, not in the library. */
export const PORTENT_OF_CALAMITY = 'Portent of Calamity';

/** libraryOf() / deckCardList() options while it resolves (one listed copy out). */
export const ON_STACK = Object.freeze({ exclude: [PORTENT_OF_CALAMITY] });

export const PORTENT = Object.freeze({
    ITERATIONS: 25000,
    /** Four or more exiled cards make one of them a free spell. */
    FREE_SPELL_THRESHOLD: 4,
    /** "A near-lock": 9 in 10. */
    RELIABLE: 0.9,
    /** The largest X simulated for a deck (the slider's maximum). */
    MAX_X: 30
});

const ALL_TYPES = (1 << CARD_TYPES.length) - 1;

const COUNT_FIELDS = Object.freeze({
    creature: 'creatures', artifact: 'artifacts', enchantment: 'enchantments', planeswalker: 'planeswalkers',
    battle: 'battles', land: 'lands', instant: 'instants', sorcery: 'sorceries'
});

const resultCache = createCache(8);

/** Bitmask of a type line's card types (bit order = CARD_TYPES). */
export function typeMask(typeLine) {
    const types = cardTypes(typeLine);
    let mask = 0;
    CARD_TYPES.forEach((type, bit) => {
        if (types.includes(type)) mask |= 1 << bit;
    });
    return mask;
}

/**
 * One type mask per card in the library.
 * @param {Array<{type_line:string, count:number}>} cards - card list (may be empty)
 * @param {Object} [counts] - DeckConfig type counts, used when there is no list
 * @returns {Uint8Array}
 */
export function buildTypeMasks(cards = [], counts = {}) {
    const masks = [];
    if (cards.length > 0) {
        for (const card of cards) {
            const mask = typeMask(card.type_line);
            for (let i = 0; i < (card.count ?? 0); i++) masks.push(mask);
        }
    } else {
        CARD_TYPES.forEach((type, bit) => {
            const n = Math.max(0, Math.floor(Number(counts?.[COUNT_FIELDS[type]]) || 0));
            for (let i = 0; i < n; i++) masks.push(1 << bit);
        });
    }
    return Uint8Array.from(masks);
}

/**
 * Incremental maximum matching between card types and revealed cards.
 * add() reveals one more card and returns how many cards can now be exiled.
 */
function createMatcher(capacity) {
    const cardMask = new Uint8Array(Math.max(1, capacity));
    const owner = new Int16Array(CARD_TYPES.length).fill(-1);
    let size = 0;
    let matched = 0;
    let usedTypes = 0;
    let visited = 0;

    function augment(card) {
        let options = cardMask[card] & ~visited;
        while (options) {
            const bit = options & -options;
            options ^= bit;
            visited |= bit;
            const type = 31 - Math.clz32(bit);
            const holder = owner[type];
            if (holder < 0 || augment(holder)) {
                owner[type] = card;
                usedTypes |= bit;
                return true;
            }
        }
        return false;
    }

    return {
        reset() {
            owner.fill(-1);
            size = 0;
            matched = 0;
            usedTypes = 0;
        },
        add(mask) {
            const index = size++;
            cardMask[index] = mask;
            if (!mask || usedTypes === ALL_TYPES) return matched;
            const free = mask & ~usedTypes;
            if (free) {
                const bit = free & -free;
                owner[31 - Math.clz32(bit)] = index;
                usedTypes |= bit;
                return ++matched;
            }
            visited = 0;
            if (augment(index)) matched++;
            return matched;
        },
        /** type index -> card index (or -1) */
        owners() {
            return Array.from(owner);
        }
    };
}

/** How many cards Portent can exile from these revealed type masks. */
export function maxExiled(masks) {
    const matcher = createMatcher(masks.length);
    let exiled = 0;
    for (const mask of masks) exiled = matcher.add(mask);
    return exiled;
}

/**
 * Monte Carlo over shuffled libraries: for every X up to maxX, the distribution
 * of cards exiled. One pass per shuffle covers every X at once.
 *
 * @param {Uint8Array|number[]} masks - one type mask per library card
 * @param {number} maxX
 * @param {{iterations?:number, random?:() => number}} [opts]
 * @returns {Object<number, {x:number, dist:number[], expectedTypes:number, prob4Plus:number, expectedToHand:number}>}
 */
export function simulatePortent(masks, maxX, { iterations = PORTENT.ITERATIONS, random = Math.random } = {}) {
    const deck = Uint8Array.from(masks ?? []);
    const size = deck.length;
    const top = Math.max(0, Math.min(Math.floor(maxX) || 0, size));
    const results = {};
    if (top === 0 || iterations <= 0) return results;

    const counts = Array.from({ length: top + 1 }, () => new Uint32Array(CARD_TYPES.length + 1));
    const matcher = createMatcher(top);

    for (let iter = 0; iter < iterations; iter++) {
        matcher.reset();
        for (let i = 0; i < top; i++) {
            const pick = i + Math.floor(random() * (size - i));
            const card = deck[pick];
            deck[pick] = deck[i];
            deck[i] = card;
            counts[i + 1][matcher.add(card)]++;
        }
    }

    for (let x = 1; x <= top; x++) {
        const dist = Array.from(counts[x], c => c / iterations);
        const expectedTypes = dist.reduce((sum, p, k) => sum + p * k, 0);
        const prob4Plus = dist.slice(PORTENT.FREE_SPELL_THRESHOLD).reduce((a, b) => a + b, 0);
        results[x] = {
            x,
            dist,
            expectedTypes,
            prob4Plus,
            // One exiled card is cast instead of going to hand.
            expectedToHand: expectedTypes - prob4Plus
        };
    }
    return results;
}

/**
 * Cards of each type in a library (a dual-typed card counts for both).
 * @param {Uint8Array|number[]} masks
 * @returns {Object<string, number>} card type -> cards
 */
export function typeCounts(masks) {
    const types = {};
    CARD_TYPES.forEach((type, bit) => {
        let n = 0;
        for (const mask of masks) if (mask & (1 << bit)) n++;
        types[type] = n;
    });
    return types;
}

/** A key for a library's type mix: equal for libraries Portent can't tell apart. */
export function masksKey(masks) {
    const histogram = new Uint32Array(1 << CARD_TYPES.length);
    for (const mask of masks) histogram[mask]++;
    let key = `${masks.length}`;
    histogram.forEach((n, mask) => { if (n) key += `,${mask}:${n}`; });
    return key;
}

/** Cached simulation for a library (only the type mix matters, not names). */
export function portentResults(masks, maxX) {
    const key = `${masksKey(masks)}|${maxX}`;
    let results = resultCache.get(key);
    if (!results) {
        results = simulatePortent(masks, maxX);
        resultCache.set(key, results);
    }
    return results;
}

/**
 * Portent's outcome at one X for a deck — the entry point the big-spell
 * comparison uses.
 *
 * @param {{cards?:Array, counts?:Object, x:number}} opts - the card list,
 *   and/or the DeckConfig snapshot (its list when `cards` is not given, its
 *   type counts when there is no list)
 * @returns {{x:number, dist:number[], expectedTypes:number, prob4Plus:number, expectedToHand:number}|null}
 */
export function portentOutcomes({ cards, counts, x } = {}) {
    const masks = buildTypeMasks(cards ?? deckCardList(counts ?? {}), counts);
    if (masks.length === 0) return null;
    const want = Math.max(1, Math.floor(Number(x) || 1));
    const maxX = Math.min(masks.length, Math.max(PORTENT.MAX_X, want));
    return portentResults(masks, maxX)[Math.min(want, maxX)] ?? null;
}

/**
 * Resolve one reveal the way a player would: exile as many cards as possible,
 * making sure the costliest spell is among them, then cast it free if four or
 * more were exiled.
 *
 * @param {Array<{name:string, types:string[], cmc:number}>} revealed
 * @returns {{exiled:Array<{card:Object, type:string}>, free:Object|null, freeSpell:boolean, toHand:Object[], graveyard:Object[], fateOf:Map}}
 */
export function resolvePortent(revealed = []) {
    const isSpell = card => card.types.some(type => type !== 'land');
    // Kuhn's matching never unmatches a card once matched, so offering the
    // costliest spells first guarantees the best free cast is exiled.
    const order = revealed.map((card, i) => i).sort((a, b) => {
        const ca = revealed[a];
        const cb = revealed[b];
        if (isSpell(ca) !== isSpell(cb)) return isSpell(ca) ? -1 : 1;
        return (cb.cmc ?? 0) - (ca.cmc ?? 0) || a - b;
    });
    const matcher = createMatcher(revealed.length);
    order.forEach(i => matcher.add(revealed[i].types.reduce((m, t) => m | (1 << CARD_TYPES.indexOf(t)), 0)));

    const typeOfSlot = new Map();
    matcher.owners().forEach((slot, typeIndex) => {
        if (slot >= 0) typeOfSlot.set(slot, CARD_TYPES[typeIndex]);
    });
    const exiled = [];
    order.forEach((cardIndex, slot) => {
        if (typeOfSlot.has(slot)) exiled.push({ index: cardIndex, card: revealed[cardIndex], type: typeOfSlot.get(slot) });
    });

    const freeSpell = exiled.length >= PORTENT.FREE_SPELL_THRESHOLD;
    const castable = exiled.filter(e => isSpell(e.card)).sort((a, b) => (b.card.cmc ?? 0) - (a.card.cmc ?? 0));
    const freeEntry = freeSpell ? castable[0] ?? null : null;
    const fateOf = new Map();
    exiled.forEach(e => fateOf.set(e.index, e === freeEntry ? { fate: 'cast', type: e.type } : { fate: 'hand', type: e.type }));

    return {
        exiled: exiled.map(({ card, type }) => ({ card, type })),
        free: freeEntry?.card ?? null,
        freeSpell,
        toHand: exiled.filter(e => e !== freeEntry).map(e => e.card),
        graveyard: revealed.filter((card, i) => !fateOf.has(i)),
        fateOf
    };
}

/**
 * Pull the numbers the answer needs out of a results table.
 * @param {Object} results - simulatePortent() output
 * @param {number} x
 * @param {{typesInDeck?:number}} [deck]
 */
export function analyze(results, x, { typesInDeck = CARD_TYPES.length } = {}) {
    const xs = Object.keys(results ?? {}).map(Number).sort((a, b) => a - b);
    const maxX = xs.length ? xs[xs.length - 1] : 0;
    const at = results?.[x] ?? null;
    const reliable = xs.find(k => (results[k]?.prob4Plus ?? 0) >= PORTENT.RELIABLE) ?? null;
    return {
        x,
        mana: x + 1,
        prob: at?.prob4Plus ?? 0,
        cards: at?.expectedTypes ?? 0,
        toHand: at?.expectedToHand ?? 0,
        next: results?.[x + 1] ?? null,
        reliableX: reliable,
        maxX,
        typesInDeck
    };
}

/**
 * The bottom line for the page: a deck-specific, plain-English answer to
 * "How often does Portent reveal four card types for a free spell?"
 * @param {ReturnType<typeof analyze>} a
 * @returns {{html:string, tone:'good'|'warn'|'bad'|'flat'}}
 */
export function summarize(a) {
    if (!a || a.maxX === 0) {
        return { html: 'Add cards to your deck to see how Portent performs.', tone: 'flat' };
    }
    if (a.typesInDeck < PORTENT.FREE_SPELL_THRESHOLD) {
        return {
            html: `This deck has only <strong>${plural(a.typesInDeck, 'card type')}</strong>, so Portent can never exile four cards — it will never cast a free spell. At X=${a.x} you still keep about <strong>${avg(a.cards)} cards</strong>.`,
            tone: 'bad'
        };
    }
    const lead = `At <strong>X=${a.x}</strong> (${a.mana} mana), Portent finds four card types and casts one free <strong>${pct(a.prob)}</strong> of the time, and you keep about <strong>${avg(a.cards)} cards</strong>.`;
    let follow;
    if (a.reliableX == null) {
        follow = `Even at X=${a.maxX} it stays under 9 in 10 — the deck leans on too few card types.`;
    } else if (a.reliableX > a.x) {
        follow = `It becomes a near-lock (9 in 10) at <strong>X=${a.reliableX}</strong>.`;
    } else if (a.reliableX < a.x) {
        follow = `X=${a.reliableX} is already 9 in 10 — ${plural(a.x - a.reliableX, 'mana', 'mana')} cheaper.`;
    } else {
        follow = 'This is the cheapest X that makes it 9 in 10.';
    }
    return { html: `${lead} ${follow}`, tone: toneFor(a.prob) };
}
