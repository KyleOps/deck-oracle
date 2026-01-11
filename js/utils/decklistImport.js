/**
 * Decklist Import and Card Type Detection
 * Uses Scryfall API to fetch card types
 */

const SCRYFALL_API = 'https://api.scryfall.com';
const RATE_LIMIT_DELAY = 100; // Scryfall requests 50-100ms between requests

// Card name corrections for common issues (typos, ambiguous names, etc.)
// Note: Don't add full double-faced names here - they're handled automatically
const CARD_NAME_CORRECTIONS = {
    'Vorinclex': 'Vorinclex, Monstrous Raider', // Disambiguate multiple printings
};

// Simple in-memory cache for card data (persists during session)
const cardCache = new Map();

/**
 * Clear the card cache (useful for testing or if data becomes stale)
 */
export function clearCardCache() {
    cardCache.clear();
    console.log('Card cache cleared');
}

/**
 * Parse decklist text into card entries
 * Supports various formats:
 * - "4 Lightning Bolt"
 * - "4x Lightning Bolt"
 * - "Lightning Bolt" (assumes 1)
 * - "1 Jace, the Mind Sculptor"
 *
 * @param {string} decklistText - Raw decklist text
 * @returns {Object} - {cards: Array, hasSideboard: boolean, sideboardCount: number}
 */
export function parseDecklistText(decklistText) {
    // Detect sideboard marker
    const sideboardIndex = decklistText.search(/^SIDEBOARD:?$/im);
    const hasSideboard = sideboardIndex >= 0;
    const maindeckText = hasSideboard ? decklistText.substring(0, sideboardIndex) : decklistText;
    const sideboardText = hasSideboard ? decklistText.substring(sideboardIndex) : '';

    // Count sideboard cards
    let sideboardCount = 0;
    if (hasSideboard) {
        const sideboardLines = sideboardText.split('\n');
        for (const line of sideboardLines) {
            const match = line.match(/^(\d+)x?\s+/);
            if (match) {
                sideboardCount += parseInt(match[1]);
            } else if (line.trim().length > 0 && !line.match(/^SIDEBOARD:?$/i)) {
                sideboardCount += 1;
            }
        }
    }

    const lines = maindeckText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const cards = [];

    for (const line of lines) {
        // Skip section headers like "Creatures:", "Lands:", "SIDEBOARD:", etc.
        if (line.match(/^(creatures?|lands?|spells?|artifacts?|enchantments?|planeswalkers?|battles?|commander|sideboard):?$/i)) {
            continue;
        }

        // Skip comment lines
        if (line.startsWith('//') || line.startsWith('#')) {
            continue;
        }

        // Match formats: "4 Card Name" or "4x Card Name"
        const match = line.match(/^(\d+)x?\s+(.+)$/);

        if (match) {
            const count = parseInt(match[1]);
            const name = match[2].trim();
            cards.push({ count, name });
        } else {
            // If no count, assume 1 copy
            if (line.length > 0) {
                cards.push({ count: 1, name: line });
            }
        }
    }

    return { cards, hasSideboard, sideboardCount };
}

/**
 * Fetch card data from Scryfall API
 * @param {string} cardName - Card name to search
 * @returns {Promise<Object|null>} - Card data or null if not found
 */
async function fetchCardData(cardName) {
    try {
        // Use fuzzy search endpoint for better matching
        const url = `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
        const response = await fetch(url);

        if (!response.ok) {
            console.warn(`Card not found: ${cardName}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error(`Error fetching ${cardName}:`, error);
        return null;
    }
}

/**
 * Determine card type category from type line
 * @param {string} typeLine - Card type line (e.g., "Legendary Creature — Human Wizard")
 * @returns {string} - Primary card type category (for backward compatibility)
 */
function getCardTypeCategory(typeLine) {
    const types = typeLine.toLowerCase();

    // Check types in order of precedence
    if (types.includes('creature')) return 'creatures';
    if (types.includes('planeswalker')) return 'planeswalkers';
    if (types.includes('battle')) return 'battles';
    if (types.includes('land')) return 'lands';
    if (types.includes('instant')) return 'instants';
    if (types.includes('sorcery')) return 'sorceries';
    if (types.includes('artifact')) return 'artifacts';
    if (types.includes('enchantment')) return 'enchantments';

    // Default to artifacts for unknown types
    return 'artifacts';
}

/**
 * Get all type categories from type line (for dual-typed cards)
 * @param {string} typeLine - Card type line (e.g., "Artifact Creature — Soldier")
 * @returns {Array<string>} - Array of all matching type categories
 */
function getAllCardTypes(typeLine) {
    const types = typeLine.toLowerCase();
    const categories = [];

    // Check all types (order matters for primary type)
    if (types.includes('creature')) categories.push('creatures');
    if (types.includes('planeswalker')) categories.push('planeswalkers');
    if (types.includes('battle')) categories.push('battles');
    if (types.includes('land')) categories.push('lands');
    if (types.includes('instant')) categories.push('instants');
    if (types.includes('sorcery')) categories.push('sorceries');
    if (types.includes('artifact')) categories.push('artifacts');
    if (types.includes('enchantment')) categories.push('enchantments');

    // If no types matched, default to artifacts
    if (categories.length === 0) {
        categories.push('artifacts');
    }

    return categories;
}

/**
 * Import and analyze a decklist
 * @param {string} decklistText - Raw decklist text
 * @param {Function} progressCallback - Called with progress updates
 * @returns {Promise<Object>} - Card type counts
 */
export async function importDecklist(decklistText, progressCallback = null) {
    const cards = parseDecklistText(decklistText);

    if (cards.length === 0) {
        throw new Error('No cards found in decklist');
    }

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

    const totalCards = cards.length;
    let processed = 0;

    for (const { count, name } of cards) {
        // Fetch card data with rate limiting
        const cardData = await fetchCardData(name);

        if (cardData && cardData.type_line) {
            const category = getCardTypeCategory(cardData.type_line);
            typeCounts[category] += count;
        } else {
            // If card not found, try to guess from name
            console.warn(`Could not fetch ${name}, skipping`);
        }

        processed++;
        if (progressCallback) {
            progressCallback({
                processed,
                total: totalCards,
                currentCard: name,
                percentage: Math.round((processed / totalCards) * 100)
            });
        }

        // Rate limiting - wait between requests
        if (processed < totalCards) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
    }

    return typeCounts;
}

/**
 * Batch fetch cards using Scryfall collection endpoint (more efficient)
 * Uses cache to avoid re-fetching previously loaded cards
 * @param {Array<string>} cardNames - Array of card names
 * @returns {Promise<Array<Object>>} - Array of card data
 */
export async function batchFetchCards(cardNames) {
    const foundCards = [];
    const cardsToFetch = [];

    // Check cache first
    for (const name of cardNames) {
        const frontFace = name.split('//')[0].trim();
        const cacheKey = frontFace.toLowerCase();

        if (cardCache.has(cacheKey)) {
            foundCards.push(cardCache.get(cacheKey));
        } else {
            cardsToFetch.push(name);
        }
    }

    if (cardsToFetch.length === 0) {
        // All cards were in cache!
        return foundCards;
    }

    // For double-faced cards, use fuzzy search instead of exact name
    // Extract just the front face name (before //)
    const identifiers = cardsToFetch.map(name => {
        // If it's a double-faced card (contains //), use front face only
        const frontFace = name.split('//')[0].trim();
        return { name: frontFace };
    });

    try {
        const response = await fetch(`${SCRYFALL_API}/cards/collection`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ identifiers })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.warn('Batch fetch failed:', errorData);
            throw new Error(errorData.details || 'Batch fetch failed');
        }

        const data = await response.json();

        // Cache and add found cards
        const fetchedCards = data.data || [];
        for (const card of fetchedCards) {
            const cacheKey = card.name.split('//')[0].trim().toLowerCase();
            cardCache.set(cacheKey, card);
            foundCards.push(card);
        }

        // Handle not_found cards - retry with fuzzy search
        const notFoundIdentifiers = data.not_found || [];

        if (notFoundIdentifiers.length > 0) {
            console.log(`Retrying ${notFoundIdentifiers.length} cards with fuzzy search...`);
            // Retry failed cards one at a time with fuzzy search (with rate limiting)
            for (const identifier of notFoundIdentifiers) {
                const fuzzyCard = await fetchCardData(identifier.name);
                if (fuzzyCard) {
                    const cacheKey = fuzzyCard.name.split('//')[0].trim().toLowerCase();
                    cardCache.set(cacheKey, fuzzyCard);
                    foundCards.push(fuzzyCard);
                }
                // Rate limit fuzzy searches
                await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
            }
        }

        return foundCards;
    } catch (error) {
        console.error('Batch fetch error:', error);
        return foundCards; // Return what we have from cache
    }
}

/**
 * Import decklist using batch API (faster for large lists)
 * @param {string} decklistText - Raw decklist text
 * @param {Function} progressCallback - Called with progress updates
 * @returns {Promise<Object>} - Card type counts with import metadata
 */
export async function importDecklistBatch(decklistText, progressCallback = null) {
    // Stage 1: Parsing (0-10%)
    if (progressCallback) {
        progressCallback({
            processed: 0,
            total: 100,
            currentCard: 'Parsing decklist...',
            percentage: 0
        });
    }

    const parseResult = parseDecklistText(decklistText);
    const { cards, hasSideboard, sideboardCount } = parseResult;

    if (cards.length === 0) {
        throw new Error('No cards found in decklist');
    }

    // Create map of card names to counts (with corrections applied)
    const cardMap = new Map();
    cards.forEach(({ count, name }) => {
        // Apply name corrections if available
        const correctedName = CARD_NAME_CORRECTIONS[name] || name;

        if (cardMap.has(correctedName)) {
            cardMap.set(correctedName, cardMap.get(correctedName) + count);
        } else {
            cardMap.set(correctedName, count);
        }
    });

    const uniqueCards = Array.from(cardMap.keys());

    if (progressCallback) {
        progressCallback({
            processed: 10,
            total: 100,
            currentCard: `Found ${uniqueCards.length} unique cards`,
            percentage: 10
        });
    }

    // Stage 2: Fetching from Scryfall (10-80%)
    const BATCH_SIZE = 50;
    const allCardData = [];
    const totalBatches = Math.ceil(uniqueCards.length / BATCH_SIZE);

    for (let i = 0; i < uniqueCards.length; i += BATCH_SIZE) {
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const chunk = uniqueCards.slice(i, Math.min(i + BATCH_SIZE, uniqueCards.length));

        const chunkData = await batchFetchCards(chunk);
        allCardData.push(...chunkData);

        // Update progress: 10% to 80% range for fetching
        if (progressCallback) {
            const processedCount = Math.min(i + BATCH_SIZE, uniqueCards.length);
            const fetchProgress = (processedCount / uniqueCards.length) * 70; // 70% of total progress
            const totalProgress = 10 + fetchProgress; // Start at 10%

            progressCallback({
                processed: processedCount,
                total: uniqueCards.length,
                currentCard: `Fetching batch ${batchNum}/${totalBatches} from Scryfall...`,
                percentage: Math.round(totalProgress)
            });
        }

        // Rate limiting between batches (only if there are more batches)
        if (i + BATCH_SIZE < uniqueCards.length) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }
    }

    // Stage 3: Analyzing cards (80-90%)
    if (progressCallback) {
        progressCallback({
            processed: 80,
            total: 100,
            currentCard: 'Analyzing card types and attributes...',
            percentage: 80
        });
    }

    // Count types
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

    // Store detailed card information for each non-land card
    const cardDetails = [];

    // Store card data by name (for Rashmi and other calculators)
    const cardsByName = {};

    // Track found cards
    const foundCards = new Set();

    // Track actual card count (for deck size calculation with dual-typed cards)
    let actualCardCount = 0;

    allCardData.forEach(cardData => {
        if (cardData && cardData.name && cardData.type_line) {
            // Try to match the card by front face name
            const frontFace = cardData.name.split('//')[0].trim();

            // Look for the card in our map by trying different name variations
            let count = 0;
            let matchedKey = null;

            // Try exact match first
            if (cardMap.has(cardData.name)) {
                count = cardMap.get(cardData.name);
                matchedKey = cardData.name;
            } else {
                // Try to find by front face name
                for (const [key, value] of cardMap.entries()) {
                    const keyFrontFace = key.split('//')[0].trim();
                    if (keyFrontFace === frontFace || key === frontFace) {
                        count = value;
                        matchedKey = key;
                        break;
                    }
                }
            }

            if (count > 0 && matchedKey) {
                // For dual-faced cards, use front face data only
                let typeLine, cmc, power;

                if (cardData.card_faces && cardData.card_faces.length > 0) {
                    // Dual-faced card - use front face (index 0)
                    const frontFace = cardData.card_faces[0];
                    typeLine = frontFace.type_line;
                    cmc = frontFace.cmc !== undefined ? frontFace.cmc : cardData.cmc;
                    power = frontFace.power;
                } else {
                    // Normal single-faced card
                    typeLine = cardData.type_line;
                    cmc = cardData.cmc;
                    power = cardData.power;
                }

                // Get all type categories for dual-typed cards (e.g., "Artifact Creature")
                const allCategories = getAllCardTypes(typeLine);
                const primaryCategory = allCategories[0]; // First category is primary

                // Add count to ALL applicable categories
                allCategories.forEach(category => {
                    typeCounts[category] += count;
                });

                // Track actual card count (only count each card once for deck size)
                actualCardCount += count;

                foundCards.add(matchedKey);

                // Store card data by name for detailed lookups
                cardsByName[cardData.name] = {
                    name: cardData.name,
                    type_line: typeLine,
                    cmc: cmc,
                    mana_cost: cardData.mana_cost || '',
                    power: power,
                    category: primaryCategory,
                    allCategories: allCategories, // Store all categories
                    count: count
                };

                // Store detailed card info for non-lands
                if (primaryCategory !== 'lands' && cmc !== undefined) {
                    // Parse power (handle *, 1+*, X, etc.) for legacy/simple check, but store raw too
                    let powerNum = null;
                    if (allCategories.includes('creatures') && power !== undefined && power !== null) {
                        const pStr = String(power);
                        if (!pStr.includes('*') && !pStr.includes('X') && !isNaN(parseInt(pStr))) {
                            powerNum = parseInt(pStr);
                        }
                    }

                    // Add one entry for each copy of the card
                    for (let i = 0; i < count; i++) {
                        cardDetails.push({
                            name: cardData.name,
                            cmc: cmc,
                            type: primaryCategory,
                            allTypes: allCategories,
                            power: power, // Store raw power (e.g. "*", "5")
                            isPower5Plus: powerNum !== null && powerNum >= 5
                        });
                    }
                }
            }
        }
    });

    // Track missing cards with details
    const missingCards = uniqueCards.filter(name => !foundCards.has(name));
    const missingCardDetails = missingCards.map(name => ({
        name,
        count: cardMap.get(name) || 0
    }));
    const missingCardCount = missingCardDetails.reduce((sum, card) => sum + card.count, 0);

    if (missingCards.length > 0) {
        console.warn('Cards not found in Scryfall:', missingCards);
        console.warn(`Missing ${missingCards.length} unique cards totaling ${missingCardCount} cards`);
    }

    // Log summary
    const totalFound = Object.values(typeCounts).reduce((sum, count) => sum + count, 0);
    const totalExpected = Array.from(cardMap.values()).reduce((sum, count) => sum + count, 0);
    console.log(`Found ${totalFound}/${totalExpected} cards (${foundCards.size}/${uniqueCards.length} unique)`);
    console.log(`Card details: ${cardDetails.length} non-land cards with full CMC/power data`);

    // Stage 4: Calculating statistics (90-95%)
    if (progressCallback) {
        progressCallback({
            processed: 90,
            total: 100,
            currentCard: 'Calculating deck statistics...',
            percentage: 90
        });
    }

    // Calculate summary stats from card details
    const creaturesPower5Plus = cardDetails.filter(c => c.isPower5Plus).length;
    console.log('Creatures with power 5+:', creaturesPower5Plus);

    // Stage 5: Finalizing (95-100%)
    if (progressCallback) {
        progressCallback({
            processed: 95,
            total: 100,
            currentCard: 'Finalizing import...',
            percentage: 95
        });
    }

    return {
        ...typeCounts,
        actualCardCount,  // Actual deck size (for dual-typed cards)
        cardDetails,  // Full card-level data
        cardsByName,  // Card data indexed by name
        creaturesPower5Plus,
        // Import metadata
        importMetadata: {
            hasSideboard,
            sideboardCount,
            missingCards: missingCardDetails,
            missingCardCount,
            totalCardsAttempted: totalExpected,
            totalCardsImported: actualCardCount  // Use actual count
        }
    };
}

// ==================== WEB IMPORT (Moxfield & Archidekt) ====================

// TODO: Deploy the Cloudflare Worker in the /serverless folder and add its URL here.
// Example: 'https://mtgcalcs-proxy.yourname.workers.dev'
const CUSTOM_PROXY_URL = 'https://hidden-river-b602.kylepettigrew.workers.dev';

const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
];

/**
 * Identify URL type and extract ID
 * @param {string} input - URL or ID
 * @returns {Object} - { type: 'moxfield'|'archidekt'|null, id: string }
 */
function parseImportInput(input) {
    const trimmed = input.trim();

    // Moxfield Patterns
    const moxfieldPatterns = [
        /moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/,
        /^([a-zA-Z0-9_-]{10,})$/ // Assume generic long ID is Moxfield for now, or check length
    ];

    for (const pattern of moxfieldPatterns) {
        const match = trimmed.match(pattern);
        if (match) return { type: 'moxfield', id: match[1] };
    }

    // Archidekt Patterns
    // https://archidekt.com/decks/123456/name
    // https://archidekt.com/decks/123456
    const archidektPatterns = [
        /archidekt\.com\/decks\/(\d+)/
    ];

    for (const pattern of archidektPatterns) {
        const match = trimmed.match(pattern);
        if (match) return { type: 'archidekt', id: match[1] };
    }

    return { type: null, id: null };
}

/**
 * Fetch URL using CORS proxies with fallback
 */
async function fetchWithProxy(url, proxyIndex = 0) {
    // Priority: Use secure custom proxy if configured
    if (CUSTOM_PROXY_URL) {
        try {
            const proxyUrl = `${CUSTOM_PROXY_URL}?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                // If custom proxy fails, fall back to public ones (though they might not work for Moxfield)
                console.warn('Custom proxy failed, trying public proxies...');
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Custom proxy error:', error);
            // Fall through to public proxies
        }
    }

    if (proxyIndex >= CORS_PROXIES.length) {
        throw new Error('All CORS proxies failed. Please try again later or check your connection.');
    }

    const proxyBase = CORS_PROXIES[proxyIndex];
    const proxyUrl = proxyBase + encodeURIComponent(url);

    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn(`Proxy ${proxyIndex} (${proxyBase}) failed:`, error);
        return fetchWithProxy(url, proxyIndex + 1);
    }
}

/**
 * Process a generic card entry (from API) into our deck format
 */
function processCardEntry(cardData, count, typeCounts, cardDetails, cardsByName) {
    // Robustly get type_line, checking for snake_case, camelCase, and DFCs
    let typeLine = cardData.type_line || cardData.typeLine;
    let cmc = cardData.cmc;
    let power = cardData.power;
    const name = cardData.name;

    // DFC handling
    if (cardData.card_faces && cardData.card_faces.length > 0) {
        const face = cardData.card_faces[0];
        typeLine = face.type_line || face.typeLine || typeLine;
        cmc = face.cmc !== undefined ? face.cmc : cmc;
        power = face.power;
    }
    
    // Fallback: Construct type_line from component arrays (Archidekt style)
    if (!typeLine && (cardData.types || cardData.superTypes)) {
        const supers = cardData.superTypes || [];
        const types = cardData.types || [];
        const subs = cardData.subTypes || [];
        
        const main = [...supers, ...types].join(' ');
        const sub = subs.join(' ');
        
        if (main) {
            typeLine = sub ? `${main} — ${sub}` : main;
        }
    }

    if (!typeLine) {
        // Return false to indicate failure -> trigger Scryfall fetch
        return false;
    }

    const safeTypeLine = typeLine || '';
    const allCategories = getAllCardTypes(safeTypeLine);
    const primaryCategory = allCategories[0];

    // Add counts
    allCategories.forEach(cat => {
        typeCounts[cat] = (typeCounts[cat] || 0) + count;
    });

    // Store data
    cardsByName[name] = {
        name: name,
        type_line: safeTypeLine,
        cmc: cmc,
        mana_cost: cardData.mana_cost,
        power: power,
        category: primaryCategory,
        allCategories: allCategories,
        count: count
    };

    // Detailed info for non-lands
    if (primaryCategory !== 'lands' && cmc !== undefined) {
        let powerNum = null;
        if (allCategories.includes('creatures') && power !== undefined && power !== null) {
            const pStr = String(power);
            if (!pStr.includes('*') && !pStr.includes('X') && !isNaN(parseInt(pStr))) {
                powerNum = parseInt(pStr);
            }
        }

        for (let i = 0; i < count; i++) {
            cardDetails.push({
                name: name,
                cmc: Math.floor(cmc),
                type: primaryCategory,
                allTypes: allCategories,
                power: power, // Store raw power
                isPower5Plus: powerNum !== null && powerNum >= 5
            });
        }
    }
    
    return true;
}

/**
 * Import from Moxfield
 */
async function importFromMoxfieldInternal(deckId, progressCallback) {
    if (progressCallback) progressCallback({ processed: 10, total: 100, percentage: 10, currentCard: 'Fetching from Moxfield...' });

    const apiUrl = `https://api2.moxfield.com/v3/decks/all/${deckId}`;
    const data = await fetchWithProxy(apiUrl);

    if (progressCallback) progressCallback({ processed: 50, total: 100, percentage: 50, currentCard: 'Processing card data...' });

    const typeCounts = { creatures: 0, instants: 0, sorceries: 0, artifacts: 0, enchantments: 0, planeswalkers: 0, lands: 0, battles: 0 };
    const cardDetails = [];
    const cardsByName = {};
    const cardsToFetch = [];
    let actualCardCount = 0;

    // Process mainboard
    if (data.boards?.mainboard?.cards) {
        Object.values(data.boards.mainboard.cards).forEach(entry => {
            if (entry.card) {
                const count = entry.quantity || 1;
                actualCardCount += count;
                const success = processCardEntry(entry.card, count, typeCounts, cardDetails, cardsByName);
                if (!success) {
                    cardsToFetch.push({ name: entry.card.name, count });
                }
            }
        });
    }
    
    // Retry failed cards via Scryfall
    if (cardsToFetch.length > 0) {
        console.log(`Fetching ${cardsToFetch.length} incomplete cards from Scryfall...`);
        const names = cardsToFetch.map(c => c.name);
        const fetchedCards = await batchFetchCards(names);
        
        // Map fetched cards back to counts (since batchFetch returns unique cards)
        fetchedCards.forEach(cardData => {
            // Find count(s) for this card
            const entries = cardsToFetch.filter(c => c.name === cardData.name); // Simple match
            entries.forEach(entry => {
                processCardEntry(cardData, entry.count, typeCounts, cardDetails, cardsByName);
            });
        });
    }

    return { typeCounts, actualCardCount, cardDetails, cardsByName, deckName: data.name };
}

/**
 * Import from Archidekt
 */
async function importFromArchidektInternal(deckId, progressCallback) {
    if (progressCallback) progressCallback({ processed: 10, total: 100, percentage: 10, currentCard: 'Fetching from Archidekt...' });

    const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;
    const data = await fetchWithProxy(apiUrl);

    if (progressCallback) progressCallback({ processed: 50, total: 100, percentage: 50, currentCard: 'Processing card data...' });

    const typeCounts = { creatures: 0, instants: 0, sorceries: 0, artifacts: 0, enchantments: 0, planeswalkers: 0, lands: 0, battles: 0 };
    const cardDetails = [];
    const cardsByName = {};
    const cardsToFetch = [];
    let actualCardCount = 0;

    if (data.cards) {
        data.cards.forEach(entry => {
            const categories = entry.categories || [];
            if (categories.includes('Sideboard') || categories.includes('Maybeboard') || categories.includes('Commander')) {
                return;
            }

            const cardData = entry.card ? (entry.card.oracleCard || entry.card) : null;
            if (cardData) {
                const count = entry.quantity || 1;
                actualCardCount += count;
                const success = processCardEntry(cardData, count, typeCounts, cardDetails, cardsByName);
                if (!success) {
                    cardsToFetch.push({ name: cardData.name, count });
                }
            }
        });
    }
    
    // Retry failed cards via Scryfall
    if (cardsToFetch.length > 0) {
        if (progressCallback) progressCallback({ processed: 70, total: 100, percentage: 70, currentCard: `Fetching ${cardsToFetch.length} missing cards from Scryfall...` });
        
        // Batch fetch in chunks if needed (batchFetch handles some, but let's just pass all)
        // Note: batchFetchCards takes array of strings (names)
        const uniqueNames = [...new Set(cardsToFetch.map(c => c.name))];
        const fetchedCards = await batchFetchCards(uniqueNames);
        
        // Process fetched cards
        fetchedCards.forEach(cardData => {
            // Find all entries matching this card name
            const matchingEntries = cardsToFetch.filter(c => c.name === cardData.name); // Exact match logic from batchFetch
            matchingEntries.forEach(entry => {
                processCardEntry(cardData, entry.count, typeCounts, cardDetails, cardsByName);
            });
        });
    }

    return { typeCounts, actualCardCount, cardDetails, cardsByName, deckName: data.name };
}

/**
 * Main Import Function (Dispatcher)
 * @param {string} input - URL or ID
 * @param {Function} progressCallback - Callback
 */
export async function importDeckFromUrl(input, progressCallback = null) {
    if (progressCallback) progressCallback({ processed: 0, total: 100, percentage: 0, currentCard: 'Initializing...' });

    const { type, id } = parseImportInput(input);

    if (!type) {
        throw new Error('Invalid URL or ID. Supports Moxfield and Archidekt.');
    }

    let result;
    if (type === 'moxfield') {
        result = await importFromMoxfieldInternal(id, progressCallback);
    } else if (type === 'archidekt') {
        result = await importFromArchidektInternal(id, progressCallback);
    }

    if (progressCallback) progressCallback({ processed: 100, total: 100, percentage: 100, currentCard: 'Done!' });

    const creaturesPower5Plus = result.cardDetails.filter(c => c.isPower5Plus).length;

    return {
        ...result.typeCounts,
        actualCardCount: result.actualCardCount,
        cardDetails: result.cardDetails,
        cardsByName: result.cardsByName,
        creaturesPower5Plus,
        importMetadata: {
            hasSideboard: false, 
            sideboardCount: 0,
            missingCardCount: 0,
            totalCardsAttempted: result.actualCardCount,
            totalCardsImported: result.actualCardCount,
            source: type.charAt(0).toUpperCase() + type.slice(1),
            deckName: result.deckName
        }
    };
}

// Legacy export alias for backward compatibility (if needed)
export const importFromMoxfield = importDeckFromUrl;
