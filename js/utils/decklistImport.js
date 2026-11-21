/**
 * Deck import: a pasted list or a Moxfield / Archidekt link in, one deck out.
 *
 * Every path ends in the same place: entries (name, count, the source's own
 * card data) become card records through `toCardRecord`, anything too thin is
 * looked up on Scryfall in one batch, and `assemble` builds the result. The
 * pieces live next door:
 *   decklistParse.js  text → entries (pure)
 *   deckSites.js      links → entries (proxy fetch + each site's JSON shape)
 *   scryfall.js       name lookups (batched, cached, rate limited)
 *
 * Loaded on first import (deckConfig and opponentState `import()` it), so none
 * of this is on the startup path.
 */

import { parseDecklistText, correctCardName } from './decklistParse.js';
import { fetchDeck } from './deckSites.js';
import { lookupCards } from './scryfall.js';

export { parseDecklistText } from './decklistParse.js';

const TYPE_ORDER = ['creatures', 'planeswalkers', 'battles', 'lands', 'instants', 'sorceries', 'artifacts', 'enchantments'];

/**
 * Every type bucket a type line belongs to, primary first ("Artifact Creature"
 * is a creature first). Unknown types count as artifacts.
 * @param {string} typeLine
 * @returns {string[]}
 */
export function typeCategories(typeLine) {
    const types = String(typeLine ?? '').toLowerCase();
    const singular = { creatures: 'creature', planeswalkers: 'planeswalker', battles: 'battle', lands: 'land', instants: 'instant', sorceries: 'sorcery', artifacts: 'artifact', enchantments: 'enchantment' };
    const found = TYPE_ORDER.filter(t => types.includes(singular[t]));
    return found.length ? found : ['artifacts'];
}

const COLOUR_LETTERS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };
/** Archidekt spells colours out ("Green"); everyone else uses letters. */
const colourLetter = c => (String(c).length === 1 ? String(c).toUpperCase() : COLOUR_LETTERS[String(c).toLowerCase()] ?? String(c));

const first = (obj, ...keys) => {
    for (const key of keys) {
        const value = obj?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
};

/** A type line from snake_case, camelCase, or Archidekt's type arrays. */
function typeLineOf(card) {
    const line = first(card, 'type_line', 'typeLine');
    if (line) return String(line);
    const main = [...(card?.superTypes ?? []), ...(card?.types ?? [])].join(' ');
    if (!main) return '';
    const sub = (card?.subTypes ?? []).join(' ');
    return sub ? `${main} — ${sub}` : main;
}

/** Archidekt's { W: 1, U: null, … } → ['W']. */
function producedFromMap(map) {
    if (!map || typeof map !== 'object') return undefined;
    const colours = Object.entries(map).filter(([, v]) => Number(v) > 0).map(([k]) => k.toUpperCase());
    return colours;
}

/**
 * One card record from any source's card object: Scryfall and Moxfield
 * (snake_case, `card_faces`) or Archidekt (camelCase `manaCost` / `text` /
 * `faces`, type arrays, colour names, a `manaProduction` map).
 *
 * Double-faced cards use their front face: that is the card in your library
 * and the one you cast. The record has the `cardsByName` shape every page
 * reads, with the given count.
 *
 * @param {Object|null} raw - a card object from an API
 * @param {number} [count=1]
 * @returns {Object|null} null when the data has no name or no type line (look
 *   it up on Scryfall instead)
 */
export function toCardRecord(raw, count = 1) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name) return null;
    const faces = Array.isArray(raw.card_faces) && raw.card_faces.length ? raw.card_faces
        : Array.isArray(raw.faces) && raw.faces.length ? raw.faces : null;
    const front = faces?.[0] ?? {};
    const typeLine = typeLineOf(front) || typeLineOf(raw);
    if (!typeLine) return null;

    const allCategories = typeCategories(typeLine);
    const cmc = Number(first(front, 'cmc') ?? raw.cmc);
    const record = {
        name: raw.name,
        type_line: typeLine,
        cmc: Number.isFinite(cmc) ? cmc : 0,
        mana_cost: String(first(front, 'mana_cost', 'manaCost') ?? first(raw, 'mana_cost', 'manaCost') ?? ''),
        oracle_text: String(first(front, 'oracle_text', 'oracleText', 'text') ?? first(raw, 'oracle_text', 'oracleText', 'text') ?? ''),
        category: allCategories[0],
        allCategories,
        count: Math.max(1, Math.floor(Number(count) || 1))
    };
    const power = first(front, 'power') ?? first(raw, 'power');
    const toughness = first(front, 'toughness') ?? first(raw, 'toughness');
    if (power !== undefined) record.power = power;
    if (toughness !== undefined) record.toughness = toughness;

    const colors = first(front, 'colors') ?? raw.colors;
    const identity = first(raw, 'color_identity', 'colorIdentity');
    const produced = first(raw, 'produced_mana', 'producedMana') ?? producedFromMap(raw.manaProduction);
    const id = first(raw, 'scryfall_id', 'scryfallId') ?? (raw.object === 'card' ? raw.id : undefined);
    if (Array.isArray(colors)) record.colors = colors.map(colourLetter);
    if (Array.isArray(identity)) record.color_identity = identity.map(colourLetter);
    if (Array.isArray(produced)) record.produced_mana = produced.map(colourLetter);
    if (typeof id === 'string') record.scryfall_id = id;
    return record;
}

/**
 * Build the import result from entries.
 *
 * Records come from the source's own data where it is complete; library
 * cards without a type line, and commanders without a mana cost, are looked up
 * on Scryfall in one batch. The same card listed twice (two printings) is one
 * record with the summed count. Commanders stay out of `cardsByName`.
 *
 * @param {{cards:Array<{name:string,count:number,raw?:Object|null}>, commanders:Array<{name:string,raw?:Object|null}>,
 *   deckName?:string|null, source:string, sideboardCount?:number, skipped?:string[]}} deck
 * @param {{signal?:AbortSignal, onLookup?:(done:number,total:number)=>void}} [opts]
 */
async function assemble(deck, { signal, onLookup } = {}) {
    const library = deck.cards.map(entry => ({ entry, record: toCardRecord(entry.raw, entry.count) }));
    const commanders = deck.commanders.map(entry => ({ entry, record: toCardRecord(entry.raw, 1) }));
    const wanted = new Set();
    library.forEach(({ entry, record }) => { if (!record) wanted.add(correctCardName(entry.name)); });
    commanders.forEach(({ entry, record }) => { if (!record?.mana_cost) wanted.add(correctCardName(entry.name)); });
    const looked = wanted.size ? await lookupCards([...wanted], { signal, onBatch: onLookup }) : new Map();
    const lookedUp = (entry, count) => toCardRecord(looked.get(correctCardName(entry.name)), count);

    const cardsByName = {};
    const missing = new Map();
    for (const { entry, record } of library) {
        const card = record ?? lookedUp(entry, entry.count);
        if (!card) {
            missing.set(entry.name, (missing.get(entry.name) ?? 0) + entry.count);
            continue;
        }
        if (cardsByName[card.name]) cardsByName[card.name].count += card.count;
        else cardsByName[card.name] = card;
    }

    const commanderList = commanders.map(({ entry, record }) => {
        const card = record?.mana_cost ? record : (lookedUp(entry, 1) ?? record);
        return { name: card?.name ?? entry.name, card: card ?? null };
    });

    const counts = Object.fromEntries(TYPE_ORDER.map(t => [t, 0]));
    let actualCardCount = 0;
    for (const card of Object.values(cardsByName)) {
        card.allCategories.forEach(c => { counts[c] += card.count; });
        actualCardCount += card.count;
    }
    if (actualCardCount === 0) {
        throw new Error(deck.source === 'paste'
            ? 'None of those cards were recognised. Check the spelling, one card per line.'
            : 'That deck has no cards in its main deck.');
    }

    const missingCards = [...missing].map(([name, count]) => ({ name, count }));
    const missingCardCount = missingCards.reduce((s, c) => s + c.count, 0);
    const deckName = deck.deckName ?? null;
    return {
        ...counts,
        actualCardCount,
        cardsByName,
        commanders: commanderList,
        // The first commander, for callers that only know about one.
        commanderName: commanderList[0]?.name ?? null,
        commanderCard: commanderList[0]?.card ?? null,
        deckName,
        importMetadata: {
            source: deck.source,
            deckName,
            commanderNames: commanderList.map(c => c.name),
            hasSideboard: (deck.sideboardCount ?? 0) > 0,
            sideboardCount: deck.sideboardCount ?? 0,
            skippedLines: deck.skipped ?? [],
            missingCards,
            missingCardCount,
            totalCardsAttempted: actualCardCount + missingCardCount,
            totalCardsImported: actualCardCount
        }
    };
}

const report = (onProgress, percentage, currentCard) => {
    if (typeof onProgress === 'function') onProgress({ processed: percentage, total: 100, percentage, currentCard });
};

/**
 * Import a pasted decklist.
 * @param {string} text
 * @param {Function|null} [onProgress] - ({percentage, currentCard, processed, total})
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<Object>} the deck (see `assemble`)
 */
export async function importDecklistBatch(text, onProgress = null, { signal } = {}) {
    report(onProgress, 0, 'Reading the list…');
    const parsed = parseDecklistText(text);
    if (parsed.cards.length === 0) throw new Error('No cards found in decklist');
    report(onProgress, 10, `Looking up ${parsed.cards.length + parsed.commanders.length} cards…`);
    const result = await assemble({
        cards: parsed.cards,
        commanders: parsed.commanders,
        source: 'paste',
        sideboardCount: parsed.sideboardCount,
        skipped: parsed.skipped
    }, {
        signal,
        onLookup: (done, total) => {
            if (typeof onProgress !== 'function') return;
            const percentage = Math.round(10 + (done / Math.max(1, total)) * 80);
            onProgress({ processed: done, total, percentage, currentCard: `Looking up cards… ${done}/${total}` });
        }
    });
    report(onProgress, 100, 'Done');
    return result;
}

/**
 * Import a deck from a Moxfield or Archidekt link.
 * @param {string} input - a deck link or a bare Moxfield id
 * @param {Function|null} [onProgress]
 * @param {{signal?:AbortSignal}} [opts]
 * @returns {Promise<Object>} the deck (see `assemble`)
 */
export async function importDeckFromUrl(input, onProgress = null, { signal } = {}) {
    report(onProgress, 5, 'Fetching the deck…');
    const deck = await fetchDeck(input, { signal });
    const site = deck.site === 'archidekt' ? 'Archidekt' : 'Moxfield';
    report(onProgress, 50, `Reading ${deck.cards.length} cards from ${site}…`);
    const result = await assemble({ ...deck, source: site }, {
        signal,
        onLookup: (done, total) => report(onProgress, Math.round(60 + (done / Math.max(1, total)) * 35), `Looking up ${total} cards on Scryfall…`)
    });
    report(onProgress, 100, 'Done');
    return result;
}
