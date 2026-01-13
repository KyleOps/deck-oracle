/**
 * Decklist Import and Card Type Detection
 * Uses Scryfall API to fetch card types
 */

const SCRYFALL_API = 'https://api.scryfall.com';
const RATE_LIMIT_DELAY = 100; // Scryfall requests 50-100ms between requests

// Cache configuration
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 3600000; // 1 hour

// Decklist parsing limits
const MAX_DECKLIST_LENGTH = 50000; // ~50KB
const MAX_DECKLIST_LINES = 500;
const MAX_CARD_COUNT = 100;
const MIN_CARD_COUNT = 1;
const MAX_CARD_NAME_LENGTH = 100;

// Batch processing configuration
const SCRYFALL_BATCH_SIZE = 50;
const FUZZY_SEARCH_BATCH_SIZE = 5;

// URL validation
const MAX_URL_INPUT_LENGTH = 200;

// Card name corrections for common issues (typos, ambiguous names, etc.)
// Note: Don't add full double-faced names here - they're handled automatically
const CARD_NAME_CORRECTIONS = {
    'Vorinclex': 'Vorinclex, Monstrous Raider', // Disambiguate multiple printings
};

/**
 * Normalize card name for cache keys and matching
 * Extracts front face of double-faced cards and converts to lowercase
 * @param {string} cardName - Card name (may include // for double-faced cards)
 * @returns {string} - Normalized name for cache/matching
 */
function normalizeCardName(cardName) {
    if (!cardName || typeof cardName !== 'string') return '';
    return cardName.split('//')[0].trim().toLowerCase();
}

/**
 * Parse creature power value to integer
 * Handles special cases like *, X, 1+*, etc.
 * @param {string|number} power - Power value from card data
 * @returns {number|null} - Parsed power as integer, or null if not parseable
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
 * LRU Cache with TTL for card data
 * Uses an access order array for O(1) eviction instead of sorting
 */
class CardCache {
    constructor(maxSize = CACHE_MAX_SIZE, ttlMs = CACHE_TTL_MS) {
        this.cache = new Map();
        this.accessOrder = []; // Track access order for O(1) LRU eviction
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(key) {
        const normalizedKey = normalizeCardName(key);
        const entry = this.cache.get(normalizedKey);
        if (!entry) return null;

        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(normalizedKey);
            // Remove from access order
            const index = this.accessOrder.indexOf(normalizedKey);
            if (index !== -1) {
                this.accessOrder.splice(index, 1);
            }
            return null;
        }

        // Update access order - move to end (most recent)
        const index = this.accessOrder.indexOf(normalizedKey);
        if (index !== -1) {
            this.accessOrder.splice(index, 1);
        }
        this.accessOrder.push(normalizedKey);

        return entry.data;
    }

    set(key, data) {
        const normalizedKey = normalizeCardName(key);

        // If key already exists, remove from old position in access order
        if (this.cache.has(normalizedKey)) {
            const index = this.accessOrder.indexOf(normalizedKey);
            if (index !== -1) {
                this.accessOrder.splice(index, 1);
            }
        }

        // Evict oldest (first in access order) if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(normalizedKey)) {
            const oldestKey = this.accessOrder.shift(); // O(1) removal from front
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(normalizedKey, {
            data,
            timestamp: Date.now()
        });

        // Add to end of access order (most recent)
        this.accessOrder.push(normalizedKey);
    }

    has(key) {
        const entry = this.get(key);
        return entry !== null;
    }

    clear() {
        this.cache.clear();
        this.accessOrder = [];
    }
}

// Simple in-memory cache for card data (persists during session)
const cardCache = new CardCache();

/**
 * Rate Limiter for API requests
 * Scryfall allows ~10 requests/second, we'll be conservative with bursts
 * Batch API calls use batches of 50, so burst limit must accommodate
 */
const requestTracker = {
    requests: [],
    maxRequestsPerMinute: 200, // Allow ~3.3 requests/sec average
    maxBurstRequests: 60, // Allow bursts of 60 requests (> batch size of 50)
    burstWindowMs: 10000, // Within 10 second window

    canMakeRequest() {
        const now = Date.now();

        // Check burst limit (short term)
        const recentRequests = this.requests.filter(t => now - t < this.burstWindowMs);
        if (recentRequests.length >= this.maxBurstRequests) {
            return false;
        }

        // Check sustained limit (long term)
        this.requests = this.requests.filter(t => now - t < 60000);
        return this.requests.length < this.maxRequestsPerMinute;
    },

    recordRequest() {
        this.requests.push(Date.now());
    },

    waitTime() {
        if (this.canMakeRequest()) return 0;
        const now = Date.now();

        // Check if burst limited
        const recentRequests = this.requests.filter(t => now - t < this.burstWindowMs);
        if (recentRequests.length >= this.maxBurstRequests) {
            const oldest = Math.min(...recentRequests);
            return Math.max(0, this.burstWindowMs - (now - oldest));
        }

        // Otherwise minute limit
        const oldest = Math.min(...this.requests);
        return Math.max(0, 60000 - (now - oldest));
    }
};

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
    // Input validation - limit size to prevent DoS
    if (!decklistText || typeof decklistText !== 'string') {
        throw new Error('Invalid decklist: must be a string');
    }

    if (decklistText.length > MAX_DECKLIST_LENGTH) {
        throw new Error(`Decklist too large. Maximum ${MAX_DECKLIST_LENGTH} characters.`);
    }

    const allLines = decklistText.split('\n');
    if (allLines.length > MAX_DECKLIST_LINES) {
        throw new Error(`Decklist has too many lines. Maximum ${MAX_DECKLIST_LINES} lines.`);
    }

    // Pre-compile regex patterns outside loops for performance
    const SIDEBOARD_REGEX = /^SIDEBOARD:?$/i;
    const SECTION_HEADER_REGEX = /^(creatures?|lands?|spells?|artifacts?|enchantments?|planeswalkers?|battles?|commander|sideboard):?$/i;
    const CARD_COUNT_REGEX = /^(\d+)x?\s+(.+)$/;
    const CARD_COUNT_ONLY_REGEX = /^(\d+)x?\s+/;

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
            const match = line.match(CARD_COUNT_ONLY_REGEX);
            if (match) {
                sideboardCount += parseInt(match[1], 10);
            } else if (line.trim().length > 0 && !SIDEBOARD_REGEX.test(line)) {
                sideboardCount += 1;
            }
        }
    }

    const lines = maindeckText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const cards = [];

    for (const line of lines) {
        // Skip section headers like "Creatures:", "Lands:", "SIDEBOARD:", etc.
        if (SECTION_HEADER_REGEX.test(line)) {
            continue;
        }

        // Skip comment lines
        if (line.startsWith('//') || line.startsWith('#')) {
            continue;
        }

        // Match formats: "4 Card Name" or "4x Card Name"
        const match = line.match(CARD_COUNT_REGEX);

        if (match) {
            const count = parseInt(match[1], 10);
            const name = match[2].trim();

            // Validate count and name
            if (isNaN(count) || count < MIN_CARD_COUNT || count > MAX_CARD_COUNT) {
                console.warn(`Invalid card count: ${count} for ${name} (skipping)`);
                continue;
            }

            if (name.length === 0 || name.length > MAX_CARD_NAME_LENGTH) {
                console.warn(`Invalid card name length: "${name}" (skipping)`);
                continue;
            }

            cards.push({ count, name });
        } else {
            // If no count, assume 1 copy
            if (line.length > 0 && line.length <= MAX_CARD_NAME_LENGTH) {
                cards.push({ count: 1, name: line });
            } else if (line.length > MAX_CARD_NAME_LENGTH) {
                console.warn(`Card name too long: "${line.substring(0, 50)}..." (skipping)`);
            }
        }
    }

    return { cards, hasSideboard, sideboardCount };
}

/**
 * Fetch card data from Scryfall API with rate limiting
 * @param {string} cardName - Card name to search
 * @returns {Promise<Object|null>} - Card data or null if not found
 */
async function fetchCardData(cardName) {
    // Check rate limit
    if (!requestTracker.canMakeRequest()) {
        const waitMs = requestTracker.waitTime();
        throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitMs / 1000)} seconds.`);
    }

    try {
        requestTracker.recordRequest();

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

    // Check cache first - use single get() instead of has() + get()
    for (const name of cardNames) {
        const cached = cardCache.get(name);
        if (cached !== null) {
            foundCards.push(cached);
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

        // Validate response structure
        if (!data || typeof data !== 'object') {
            console.warn('Invalid batch response format');
            return foundCards;
        }

        // Cache and add found cards
        const fetchedCards = data.data || [];
        for (const card of fetchedCards) {
            if (card && card.name) {
                cardCache.set(card.name, card);
                foundCards.push(card);
            }
        }

        // Handle not_found cards - retry with fuzzy search in parallel batches
        const notFoundIdentifiers = data.not_found || [];

        if (notFoundIdentifiers.length > 0) {
            console.log(`Retrying ${notFoundIdentifiers.length} cards with fuzzy search...`);

            // Process in batches for parallel fetching (faster than sequential)
            for (let i = 0; i < notFoundIdentifiers.length; i += FUZZY_SEARCH_BATCH_SIZE) {
                const batch = notFoundIdentifiers.slice(i, i + FUZZY_SEARCH_BATCH_SIZE);

                // Fetch batch in parallel
                const batchPromises = batch.map(identifier => fetchCardData(identifier.name));
                const batchResults = await Promise.all(batchPromises);

                // Cache and add successful results
                batchResults.forEach(fuzzyCard => {
                    if (fuzzyCard) {
                        cardCache.set(fuzzyCard.name, fuzzyCard);
                        foundCards.push(fuzzyCard);
                    }
                });

                // Rate limit between batches (not between individual cards in batch)
                if (i + FUZZY_SEARCH_BATCH_SIZE < notFoundIdentifiers.length) {
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
                }
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
    const allCardData = [];
    const totalBatches = Math.ceil(uniqueCards.length / SCRYFALL_BATCH_SIZE);

    for (let i = 0; i < uniqueCards.length; i += SCRYFALL_BATCH_SIZE) {
        const batchNum = Math.floor(i / SCRYFALL_BATCH_SIZE) + 1;
        const chunk = uniqueCards.slice(i, Math.min(i + SCRYFALL_BATCH_SIZE, uniqueCards.length));

        const chunkData = await batchFetchCards(chunk);
        allCardData.push(...chunkData);

        // Update progress: 10% to 80% range for fetching
        if (progressCallback) {
            const processedCount = Math.min(i + SCRYFALL_BATCH_SIZE, uniqueCards.length);
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
        if (i + SCRYFALL_BATCH_SIZE < uniqueCards.length) {
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

    // Pre-compute normalized lookup map for O(1) matching instead of O(n²)
    const normalizedCardMap = new Map();
    for (const [key, value] of cardMap.entries()) {
        const normalizedKey = normalizeCardName(key);
        normalizedCardMap.set(normalizedKey, { originalKey: key, count: value });
        // Also store the original key directly for exact matches
        normalizedCardMap.set(key, { originalKey: key, count: value });
    }

    allCardData.forEach(cardData => {
        if (cardData && cardData.name && cardData.type_line) {
            // Try to match the card using normalized name for O(1) lookup
            let count = 0;
            let matchedKey = null;

            // Try exact match first
            const exactMatch = normalizedCardMap.get(cardData.name);
            if (exactMatch) {
                count = exactMatch.count;
                matchedKey = exactMatch.originalKey;
            } else {
                // Try normalized front face match
                const normalizedName = normalizeCardName(cardData.name);
                const normalizedMatch = normalizedCardMap.get(normalizedName);
                if (normalizedMatch) {
                    count = normalizedMatch.count;
                    matchedKey = normalizedMatch.originalKey;
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
                    // Parse power using helper function
                    const powerNum = allCategories.includes('creatures') ? parsePowerValue(power) : null;

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
// Example: 'https://deck-oracle-proxy.yourname.workers.dev'
const CUSTOM_PROXY_URL = 'https://hidden-river-b602.kylepettigrew.workers.dev';

// SECURITY: Public CORS proxies removed - only use trusted custom proxy
// Public proxies can log data, inject malicious content, or MITM attacks
const USE_PUBLIC_PROXIES = false; // Set to true only for development/testing

const CORS_PROXIES = USE_PUBLIC_PROXIES ? [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='
] : [];

/**
 * Identify URL type and extract ID with strict validation
 * @param {string} input - URL or ID
 * @returns {Object} - { type: 'moxfield'|'archidekt'|null, id: string }
 */
function parseImportInput(input) {
    if (!input || typeof input !== 'string') {
        return { type: null, id: null };
    }

    const trimmed = input.trim();

    // Limit input length to prevent abuse
    if (trimmed.length > MAX_URL_INPUT_LENGTH) {
        console.warn('Input too long');
        return { type: null, id: null };
    }

    // Moxfield - stricter pattern matching
    // Full URL: https://www.moxfield.com/decks/ABC123xyz_-
    const moxfieldUrlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?moxfield\.com\/decks\/([a-zA-Z0-9_-]{8,32})(?:\/|$)/);
    if (moxfieldUrlMatch) {
        return { type: 'moxfield', id: moxfieldUrlMatch[1] };
    }

    // Archidekt - only numeric IDs, limit to reasonable length
    // Full URL: https://archidekt.com/decks/123456
    const archidektUrlMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?archidekt\.com\/decks\/(\d{1,10})(?:\/|$)/);
    if (archidektUrlMatch) {
        return { type: 'archidekt', id: archidektUrlMatch[1] };
    }

    // Direct ID input - be conservative (only for Moxfield)
    if (/^[a-zA-Z0-9_-]{8,32}$/.test(trimmed)) {
        return { type: 'moxfield', id: trimmed };
    }

    return { type: null, id: null };
}

/**
 * Fetch URL using secure custom proxy only
 */
async function fetchWithProxy(url, proxyIndex = 0) {
    // SECURITY: Only use custom proxy - public proxies are security risks
    if (!CUSTOM_PROXY_URL) {
        throw new Error('Proxy not configured. Deck import is currently unavailable.');
    }

    // Use secure custom proxy
    try {
        const proxyUrl = `${CUSTOM_PROXY_URL}?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);

        if (!response.ok) {
            throw new Error(`Proxy error: HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Proxy error:', error);

        // Only fall back to public proxies if explicitly enabled (dev/test only)
        if (USE_PUBLIC_PROXIES && CORS_PROXIES.length > 0) {
            console.warn('Falling back to public proxy (INSECURE - dev mode only)');

            if (proxyIndex >= CORS_PROXIES.length) {
                throw new Error('All CORS proxies failed. Please try again later.');
            }

            const proxyBase = CORS_PROXIES[proxyIndex];
            const fallbackProxyUrl = proxyBase + encodeURIComponent(url);

            try {
                const response = await fetch(fallbackProxyUrl);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return await response.json();
            } catch (fallbackError) {
                console.warn(`Proxy ${proxyIndex} (${proxyBase}) failed:`, fallbackError);
                return fetchWithProxy(url, proxyIndex + 1);
            }
        }

        throw new Error('Failed to fetch deck data. Please try again later.');
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
        // Parse power using helper function
        const powerNum = allCategories.includes('creatures') ? parsePowerValue(power) : null;

        for (let i = 0; i < count; i++) {
            cardDetails.push({
                name: name,
                cmc: Math.floor(cmc), // Floor for consistency with Scryfall data
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
    let commanderName = null;

    // Capture commander from commanders board
    if (data.boards?.commanders?.cards) {
        const commanderCards = Object.values(data.boards.commanders.cards);
        if (commanderCards.length > 0 && commanderCards[0].card) {
            commanderName = commanderCards[0].card.name;
        }
    }

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

    return { typeCounts, actualCardCount, cardDetails, cardsByName, deckName: data.name, commanderName };
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
    let commanderName = null;

    if (data.cards) {
        data.cards.forEach(entry => {
            const categories = entry.categories || [];

            // Capture commander name before skipping
            if (categories.includes('Commander')) {
                const cardData = entry.card ? (entry.card.oracleCard || entry.card) : null;
                if (cardData && !commanderName) {
                    commanderName = cardData.name;
                }
                return;
            }

            if (categories.includes('Sideboard') || categories.includes('Maybeboard')) {
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

    return { typeCounts, actualCardCount, cardDetails, cardsByName, deckName: data.name, commanderName };
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
        commanderName: result.commanderName,
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
