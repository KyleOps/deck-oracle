/**
 * Generate the bundled example deck (js/utils/defaultDeckData.js) from a
 * Moxfield API response.
 *
 * Usage: node scripts/generateDefaultDeck.js
 *
 * Reads response.json (gitignored: save https://api2.moxfield.com/v3/decks/all/<id>
 * there) and writes exactly what deck state (js/utils/deckConfig.js) reads
 * from it at startup — nothing derived, since the file is parsed on every load:
 *   - the mainboard is the list (cardsByName, type counts, actualCardCount) —
 *     commanders are NOT in it: they start in the command zone, never the
 *     library. cardDetails is derived from cardsByName by deck state;
 *   - every card in the command zone (partners, a Doctor and their companion,
 *     a commander and a background) is in `commanders: [{name, card}]`, where
 *     `card` is a full record in the same shape as the list's records;
 *   - importUrl and deckName.
 * One card record per line keeps the file small and its diffs readable.
 *
 * Moxfield has no produced_mana, and the bundled file was enriched from
 * Scryfall (oracle text, colours, produced mana, Scryfall ids). Fields the
 * previous file has for a card are kept, so regenerating never loses them.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URL = 'https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg';
const responsePath = join(__dirname, '..', 'response.json');
const outputPath = join(__dirname, '..', 'js', 'utils', 'defaultDeckData.js');

/** Fields the bundled file carries from Scryfall; kept from the previous file when present. */
const ENRICHED = ['power', 'toughness', 'oracle_text', 'colors', 'color_identity', 'produced_mana', 'scryfall_id'];

const data = JSON.parse(readFileSync(responsePath, 'utf-8'));
const previous = existsSync(outputPath)
    ? (await import(pathToFileURL(outputPath).href)).DEFAULT_DECK_DATA
    : null;
const previousRecords = new Map();
for (const card of [...Object.values(previous?.cardsByName ?? {}), ...(previous?.commanders ?? []).map(c => c.card), previous?.commanderCard]) {
    if (card?.name && !previousRecords.has(card.name)) previousRecords.set(card.name, card);
}

/** Type categories, as decklistImport.getAllCardTypes names them. */
function getAllCardTypes(typeLine) {
    const types = typeLine.toLowerCase();
    const categories = [];
    if (types.includes('creature')) categories.push('creatures');
    if (types.includes('planeswalker')) categories.push('planeswalkers');
    if (types.includes('battle')) categories.push('battles');
    if (types.includes('land')) categories.push('lands');
    if (types.includes('instant')) categories.push('instants');
    if (types.includes('sorcery')) categories.push('sorceries');
    if (types.includes('artifact')) categories.push('artifacts');
    if (types.includes('enchantment')) categories.push('enchantments');
    if (categories.length === 0) categories.push('artifacts');
    return categories;
}

/**
 * The cardsByName record for a Moxfield card (front face of double-faced
 * cards — what a card is in the library), or null without a type line.
 */
function toRecord(cardData, count) {
    const face = cardData.card_faces?.[0] ?? null;
    const typeLine = face?.type_line || cardData.type_line;
    if (!typeLine) return null;
    const allCategories = getAllCardTypes(typeLine);
    const record = {
        name: cardData.name,
        type_line: typeLine,
        cmc: face && face.cmc !== undefined ? face.cmc : cardData.cmc,
        mana_cost: cardData.mana_cost || '',
        power: face ? face.power : cardData.power,
        category: allCategories[0],
        allCategories,
        count,
        toughness: face ? face.toughness : cardData.toughness,
        oracle_text: face?.oracle_text || cardData.oracle_text || '',
        colors: face?.colors ?? cardData.colors,
        color_identity: cardData.color_identity,
        scryfall_id: cardData.scryfall_id
    };
    const before = previousRecords.get(cardData.name);
    for (const field of ENRICHED) {
        if (before?.[field] !== undefined) record[field] = before[field];
    }
    // Keep a stable key order (produced_mana sits before scryfall_id).
    const { scryfall_id: id, ...rest } = record;
    return JSON.parse(JSON.stringify({ ...rest, produced_mana: record.produced_mana, scryfall_id: id }));
}

const typeCounts = { creatures: 0, instants: 0, sorceries: 0, artifacts: 0, enchantments: 0, planeswalkers: 0, lands: 0, battles: 0 };
const cardsByName = {};
let actualCardCount = 0;

function addToList(record) {
    record.allCategories.forEach(cat => { typeCounts[cat] += record.count; });
    actualCardCount += record.count;
    cardsByName[record.name] = record;
}

// The command zone — every commander, none of them in the list.
const commanders = Object.values(data.boards?.commanders?.cards ?? {})
    .filter(entry => entry?.card)
    .map(entry => ({ name: entry.card.name, card: toRecord(entry.card, 1) }));

// The list: the mainboard.
for (const entry of Object.values(data.boards?.mainboard?.cards ?? {})) {
    if (!entry?.card) continue;
    const record = toRecord(entry.card, entry.quantity || 1);
    if (record) addToList(record);
}

const commanderKeys = new Set(commanders.map(c => c.name.toLowerCase()));
if (Object.keys(cardsByName).some(name => commanderKeys.has(name.toLowerCase()))) {
    throw new Error('A commander is also in the mainboard; the bundled list must not hold its commanders.');
}

// Exactly the fields deckConfig.js reads from DEFAULT_DECK_DATA.
const defaultDeckData = {
    creatures: typeCounts.creatures,
    instants: typeCounts.instants,
    sorceries: typeCounts.sorceries,
    artifacts: typeCounts.artifacts,
    enchantments: typeCounts.enchantments,
    planeswalkers: typeCounts.planeswalkers,
    lands: typeCounts.lands,
    battles: typeCounts.battles,
    // Cards in the list = the library (the commanders are not in it).
    actualCardCount,
    cardsByName,
    commanders,
    importUrl: SOURCE_URL,
    deckName: data.name
};

/**
 * The data as a JS literal: one line per scalar field, one line per card
 * record (cardsByName) and per commander — compact, but a changed card is a
 * one-line diff.
 */
function literal(deck) {
    const lines = Object.entries(deck).map(([key, value]) => {
        if (key === 'cardsByName') {
            const rows = Object.entries(value).map(([name, card]) => `    ${JSON.stringify(name)}: ${JSON.stringify(card)}`);
            return `  ${JSON.stringify(key)}: {\n${rows.join(',\n')}\n  }`;
        }
        if (key === 'commanders') {
            return `  ${JSON.stringify(key)}: [\n${value.map(c => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`;
        }
        return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    });
    return `{\n${lines.join(',\n')}\n}`;
}

const outputContent = `/**
 * Default Deck Data
 * Pre-loaded deck data to avoid import warnings on first load
 * Source: ${SOURCE_URL}
 * Deck: ${data.name}
 * Generated by scripts/generateDefaultDeck.js: ${new Date().toISOString()}
 * ${actualCardCount}-card list + ${commanders.length} commander${commanders.length === 1 ? '' : 's'} in \`commanders\` (never in the list).
 * Only what deck state reads: cardDetails and the rest are derived at runtime.
 * Oracle text, colours, produced mana and Scryfall ids enriched from Scryfall.
 */

export const DEFAULT_DECK_DATA = ${literal(defaultDeckData)};
`;

writeFileSync(outputPath, outputContent, 'utf-8');

console.log('Default deck data generated successfully!');
console.log(`  Deck: ${data.name}`);
console.log(`  Commanders: ${commanders.map(c => c.name).join(' + ') || 'none'}`);
console.log(`  Cards in the list (library): ${actualCardCount}`);
console.log('  Type breakdown:');
Object.entries(typeCounts).forEach(([type, count]) => {
    if (count > 0) console.log(`    ${type}: ${count}`);
});
console.log('\nOutput written to: js/utils/defaultDeckData.js');
