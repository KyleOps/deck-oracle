/**
 * Generate Default Deck Data from Moxfield API Response
 *
 * Usage: node scripts/generateDefaultDeck.js
 *
 * Reads response.json and outputs the processed deck data for defaultDeckData.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the Moxfield response
const responsePath = join(__dirname, '..', 'response.json');
const data = JSON.parse(readFileSync(responsePath, 'utf-8'));

// Initialize counters and data structures
const typeCounts = {
    creatures: 0,
    instants: 0,
    sorceries: 0,
    artifacts: 0,
    enchantments: 0,
    planeswalkers: 0,
    lands: 0,
    battles: 0
};

const cardDetails = [];
const cardsByName = {};
let actualCardCount = 0;
let commanderName = null;

/**
 * Get all type categories from type line
 */
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

    if (categories.length === 0) {
        categories.push('artifacts');
    }

    return categories;
}

/**
 * Parse power value
 */
function parsePowerValue(power) {
    if (power === undefined || power === null) return null;
    const pStr = String(power);
    if (!pStr.includes('*') && !pStr.includes('X') && !isNaN(parseInt(pStr, 10))) {
        return parseInt(pStr, 10);
    }
    return null;
}

/**
 * Process a card entry
 */
function processCard(cardData, count) {
    let typeLine = cardData.type_line;
    let cmc = cardData.cmc;
    let power = cardData.power;
    const name = cardData.name;

    // Handle double-faced cards
    if (cardData.card_faces && cardData.card_faces.length > 0) {
        const face = cardData.card_faces[0];
        typeLine = face.type_line || typeLine;
        cmc = face.cmc !== undefined ? face.cmc : cmc;
        power = face.power;
    }

    if (!typeLine) return;

    const allCategories = getAllCardTypes(typeLine);
    const primaryCategory = allCategories[0];

    // Add counts to all applicable categories
    allCategories.forEach(cat => {
        typeCounts[cat] += count;
    });

    actualCardCount += count;

    // Store card data by name
    cardsByName[name] = {
        name: name,
        type_line: typeLine,
        cmc: cmc,
        mana_cost: cardData.mana_cost || '',
        power: power,
        category: primaryCategory,
        allCategories: allCategories,
        count: count
    };

    // Store detailed info for non-lands
    if (primaryCategory !== 'lands' && cmc !== undefined) {
        const powerNum = allCategories.includes('creatures') ? parsePowerValue(power) : null;

        for (let i = 0; i < count; i++) {
            cardDetails.push({
                name: name,
                cmc: Math.floor(cmc),
                type: primaryCategory,
                allTypes: allCategories,
                power: power,
                isPower5Plus: powerNum !== null && powerNum >= 5
            });
        }
    }
}

// Process commanders
if (data.boards?.commanders?.cards) {
    const commanderCards = Object.values(data.boards.commanders.cards);
    if (commanderCards.length > 0 && commanderCards[0].card) {
        commanderName = commanderCards[0].card.name;
        // Process commander card too (it's part of the 100)
        processCard(commanderCards[0].card, commanderCards[0].quantity || 1);
    }
}

// Process mainboard
if (data.boards?.mainboard?.cards) {
    Object.values(data.boards.mainboard.cards).forEach(entry => {
        if (entry.card) {
            processCard(entry.card, entry.quantity || 1);
        }
    });
}

const creaturesPower5Plus = cardDetails.filter(c => c.isPower5Plus).length;

// Build the output object
const defaultDeckData = {
    // Type counts
    creatures: typeCounts.creatures,
    instants: typeCounts.instants,
    sorceries: typeCounts.sorceries,
    artifacts: typeCounts.artifacts,
    enchantments: typeCounts.enchantments,
    planeswalkers: typeCounts.planeswalkers,
    lands: typeCounts.lands,
    battles: typeCounts.battles,

    // Actual card count
    actualCardCount: actualCardCount,

    // Detailed data
    cardDetails: cardDetails,
    cardsByName: cardsByName,

    // Vortex-specific
    creaturesPower5Plus: creaturesPower5Plus,

    // Commander
    commanderName: commanderName,

    // Source info
    importUrl: 'https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg',
    deckName: data.name,

    // Import metadata (to avoid warnings)
    importMetadata: {
        hasSideboard: false,
        sideboardCount: 0,
        missingCardCount: 0,
        missingCards: [],
        totalCardsAttempted: actualCardCount,
        totalCardsImported: actualCardCount,
        source: 'Moxfield',
        deckName: data.name
    }
};

// Generate the output file content
const outputContent = `/**
 * Default Deck Data
 * Pre-loaded deck data to avoid import warnings on first load
 * Source: https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg
 * Deck: ${data.name}
 * Generated: ${new Date().toISOString()}
 */

export const DEFAULT_DECK_DATA = ${JSON.stringify(defaultDeckData, null, 2)};
`;

// Write the output file
const outputPath = join(__dirname, '..', 'js', 'utils', 'defaultDeckData.js');
writeFileSync(outputPath, outputContent, 'utf-8');

console.log('Default deck data generated successfully!');
console.log(`  Deck: ${data.name}`);
console.log(`  Commander: ${commanderName}`);
console.log(`  Total cards: ${actualCardCount}`);
console.log(`  Type breakdown:`);
Object.entries(typeCounts).forEach(([type, count]) => {
    if (count > 0) console.log(`    ${type}: ${count}`);
});
console.log(`  Creatures with power 5+: ${creaturesPower5Plus}`);
console.log(`\nOutput written to: js/utils/defaultDeckData.js`);
