/**
 * The card list the big-spell models read: one record per card in the
 * library (name, type line, mana value, copies), built once per Library.
 *
 * Pure: no DOM, no deck state. Callers pass the DeckConfig snapshot (or the
 * Library) the list is for.
 */

import { hashString } from '../random.js';
import { asLibrary, cardTypes } from '../library.js';

const cardLists = new WeakMap();

/**
 * The library's card records, or [] when only type counts are known.
 * Commanders are never in it (see library.js); `opts.exclude` takes out the
 * spell being cast when the list names it.
 *
 * Hand-edited type counts no longer describe an imported list (DeckConfig
 * marks the deck 'manual'), so the counts win and the list is ignored —
 * otherwise a page would mix card odds from one deck with the size of another.
 *
 * @param {Object} config - a DeckConfig snapshot,
 *   or a Library from libraryOf()
 * @param {Object} [opts] - libraryOf() options
 * @returns {ReadonlyArray<{name:string, type_line:string, cmc:number, count:number}>}
 *   the same (frozen) array for the same library
 */
export function deckCardList(config, opts) {
    if (config?.importSource === 'manual') return [];
    const library = asLibrary(config, opts);
    let list = cardLists.get(library);
    if (!list) {
        list = Object.freeze(library.cards.map(card => Object.freeze({
            name: String(card.name ?? ''),
            type_line: String(card.type_line ?? ''),
            cmc: Number.isFinite(Number(card.cmc)) ? Math.max(0, Number(card.cmc)) : 0,
            count: card.count
        })));
        cardLists.set(library, list);
    }
    return list;
}

/** Number of cards in a card list. */
export function listSize(cards) {
    return (cards ?? []).reduce((sum, card) => sum + (card?.count ?? 0), 0);
}

/**
 * A short, order-independent key for a card list (FNV-1a over its contents),
 * so results can be cached per deck without holding the whole list as a key.
 */
export function cardListKey(cards) {
    const text = (cards ?? [])
        .map(card => `${card.name}|${card.count}|${card.cmc}|${card.type_line}`)
        .sort()
        .join('\n');
    return `${(cards ?? []).length}:${hashString(text).toString(36)}`;
}

/**
 * Expand a card list into one object per physical card, with its types worked
 * out once. Copies of a card share one object.
 */
export function expandCards(cards) {
    const out = [];
    for (const card of cards ?? []) {
        const record = Object.freeze({
            name: card.name,
            type_line: card.type_line,
            cmc: card.cmc ?? 0,
            types: cardTypes(card.type_line)
        });
        for (let i = 0; i < (card.count ?? 0); i++) out.push(record);
    }
    return out;
}
