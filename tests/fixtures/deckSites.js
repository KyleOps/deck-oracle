/**
 * Deck-site and Scryfall responses for import tests (unit and browser).
 *
 * Shapes follow the real APIs, checked against live public decks on
 * 2026-11-21: Moxfield v3 (`boards.<board>.cards.<id> = {quantity, card}`,
 * snake_case cards) and Archidekt (`cards[] = {quantity, categories,
 * companion, card: {uid, oracleCard}}`, camelCase oracle cards with
 * `manaCost`, `text`, `faces`, type arrays, colour names and a
 * `manaProduction` map). Rules text is abbreviated; only the fields the
 * importer reads matter.
 */

const NO_MANA = { W: null, U: null, B: null, R: null, G: null, C: null };

/** Archidekt: a Doctor and their companion as commanders (two "Commander" cards). */
export const ARCHIDEKT_DECK = Object.freeze({
    id: 1234567,
    name: 'Ninth Doctor and Clara',
    categories: [
        { id: 1, name: 'Commander', isPremier: true, includedInDeck: true },
        { id: 2, name: 'Land', isPremier: false, includedInDeck: true },
        { id: 3, name: 'Ramp', isPremier: false, includedInDeck: true },
        { id: 4, name: 'Considering', isPremier: false, includedInDeck: false },
        { id: 5, name: 'Sideboard', isPremier: false, includedInDeck: false }
    ],
    cards: [
        {
            quantity: 1, categories: ['Commander'], companion: false,
            card: {
                uid: '74785b3b-44df-4555-a036-082572b7f4e7',
                oracleCard: {
                    name: 'The Ninth Doctor', cmc: 3, manaCost: '{1}{U}{R}', layout: 'normal', faces: [],
                    text: 'Haste\nWhenever The Ninth Doctor untaps, you get an additional upkeep step.',
                    superTypes: ['Legendary'], types: ['Creature'], subTypes: ['Time Lord', 'Doctor'],
                    colors: ['Red', 'Blue'], colorIdentity: ['Blue', 'Red'], power: '2', toughness: '4', manaProduction: NO_MANA
                }
            }
        },
        {
            quantity: 1, categories: ['Commander'], companion: false,
            card: {
                uid: 'cd9eee5f-29c0-4f2f-996c-1ba23a55ec81',
                oracleCard: {
                    name: 'Clara Oswald', cmc: 6, manaCost: '{6}', layout: 'normal', faces: [],
                    text: 'Doctor’s companion',
                    superTypes: ['Legendary'], types: ['Creature'], subTypes: ['Human'],
                    colors: [], colorIdentity: [], power: '1', toughness: '1', manaProduction: NO_MANA
                }
            }
        },
        {
            quantity: 30, categories: ['Land'], companion: false,
            card: {
                uid: '1335d293-3dd2-4f13-bd2c-22181f4528ee',
                oracleCard: {
                    name: 'Island', cmc: 0, manaCost: '', text: '({T}: Add {U}.)', layout: 'normal', faces: [],
                    superTypes: ['Basic'], types: ['Land'], subTypes: ['Island'],
                    colors: [], colorIdentity: ['Blue'], power: '', toughness: '', manaProduction: { ...NO_MANA, U: 1 }
                }
            }
        },
        {
            quantity: 1, categories: ['Ramp'], companion: false,
            card: {
                uid: 'bd1d1f74-7ec1-4f4f-9d39-3b5b7f2d9f11',
                oracleCard: {
                    name: 'Sol Ring', cmc: 1, manaCost: '{1}', text: '{T}: Add {C}{C}.', layout: 'normal', faces: [],
                    superTypes: [], types: ['Artifact'], subTypes: [],
                    colors: [], colorIdentity: [], power: '', toughness: '', manaProduction: { ...NO_MANA, C: 2 }
                }
            }
        },
        {
            quantity: 1, categories: ['Ramp'], companion: false,
            card: {
                uid: '92023a5d-a143-4950-a71b-d736e6b8e959',
                oracleCard: {
                    name: 'Esika, God of the Tree // The Prismatic Bridge', cmc: 3, manaCost: '', text: '', layout: 'modal_dfc',
                    superTypes: ['Legendary'], types: ['Creature'], subTypes: ['God'],
                    colors: ['White', 'Blue', 'Black', 'Red', 'Green'], colorIdentity: ['White', 'Blue', 'Black', 'Red', 'Green'],
                    power: '', toughness: '', manaProduction: { W: 2, U: 2, B: 2, R: 2, G: 2, C: null },
                    faces: [
                        { name: 'Esika, God of the Tree', manaCost: '{1}{G}{G}', text: 'Vigilance\n{T}: Add one mana of any color.', superTypes: ['Legendary'], types: ['Creature'], subTypes: ['God'], colors: ['Green'], power: '1', toughness: '4' },
                        { name: 'The Prismatic Bridge', manaCost: '{W}{U}{B}{R}{G}', text: 'At the beginning of your upkeep, reveal cards.', superTypes: ['Legendary'], types: ['Enchantment'], subTypes: [], colors: ['White', 'Blue', 'Black', 'Red', 'Green'], power: '', toughness: '' }
                    ]
                }
            }
        },
        {
            // The same card listed twice (two printings): one record, counts summed.
            quantity: 2, categories: ['Land'], companion: false,
            card: { uid: '0a1b2c3d-0000-4000-8000-000000000001', oracleCard: { name: 'Island', cmc: 0, manaCost: '', text: '({T}: Add {U}.)', superTypes: ['Basic'], types: ['Land'], subTypes: ['Island'], colors: [], colorIdentity: ['Blue'], manaProduction: { ...NO_MANA, U: 1 }, faces: [] } }
        },
        {
            quantity: 2, categories: ['Considering'], companion: false,
            card: { uid: 'x', oracleCard: { name: 'Mana Crypt', cmc: 0, manaCost: '{0}', text: '', superTypes: [], types: ['Artifact'], subTypes: [], faces: [] } }
        },
        {
            quantity: 1, categories: ['Sideboard'], companion: false,
            card: { uid: 'y', oracleCard: { name: 'Pyroblast', cmc: 1, manaCost: '{R}', text: '', superTypes: [], types: ['Instant'], subTypes: [], faces: [] } }
        }
    ]
});

/** Moxfield: a partner pair, a card with too little data (looked up on Scryfall), a sideboard and a companion. */
export const MOXFIELD_DECK = Object.freeze({
    name: 'Tymna Kraum Blitz',
    boards: {
        commanders: {
            count: 2,
            cards: {
                c1: { quantity: 1, card: { name: 'Tymna the Weaver', mana_cost: '{1}{W}{B}', cmc: 3, type_line: 'Legendary Creature — Human Cleric', oracle_text: 'Lifelink\nPartner', colors: ['W', 'B'], color_identity: ['W', 'B'], power: '2', toughness: '2', scryfall_id: '7ddb8ff0-0b4d-4e64-8f2e-1b5b8a1c3001' } },
                c2: { quantity: 1, card: { name: 'Kraum, Ludevic’s Opus', mana_cost: '{3}{U}{R}', cmc: 5, type_line: 'Legendary Creature — Zombie Horror', oracle_text: 'Flying, haste\nPartner', colors: ['U', 'R'], color_identity: ['U', 'R'], power: '4', toughness: '4', scryfall_id: '7ddb8ff0-0b4d-4e64-8f2e-1b5b8a1c3002' } }
            }
        },
        mainboard: {
            count: 33,
            cards: {
                m1: { quantity: 30, card: { name: 'Plains', cmc: 0, mana_cost: '', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)', colors: [], color_identity: ['W'] } },
                m2: { quantity: 1, card: { name: 'Sol Ring', cmc: 1, mana_cost: '{1}', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', colors: [], color_identity: [] } },
                m3: { quantity: 1, card: { name: 'Delver of Secrets // Insectile Aberration', cmc: 1, type_line: 'Creature — Human Wizard // Creature — Human Insect', colors: ['U'], color_identity: ['U'], card_faces: [
                    { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'Transform it.', power: '1', toughness: '1' },
                    { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect', oracle_text: 'Flying', power: '3', toughness: '2' }
                ] } },
                // Too thin to build a record: looked up on Scryfall.
                m4: { quantity: 1, card: { name: 'Arcane Signet' } }
            }
        },
        sideboard: { count: 2, cards: { s1: { quantity: 2, card: { name: 'Swords to Plowshares', cmc: 1, mana_cost: '{W}', type_line: 'Instant' } } } },
        maybeboard: { count: 1, cards: { y1: { quantity: 1, card: { name: 'Mana Crypt', cmc: 0, type_line: 'Artifact' } } } },
        companions: { count: 1, cards: { k1: { quantity: 1, card: { name: 'Lurrus of the Dream-Den', cmc: 3, type_line: 'Legendary Creature — Cat Nightmare' } } } }
    }
});

/** Scryfall cards the stub knows, by exact name. */
export const SCRYFALL_CARDS = Object.freeze(Object.fromEntries([
    { name: 'Arcane Signet', mana_cost: '{2}', cmc: 2, type_line: 'Artifact', oracle_text: '{T}: Add one mana of any color in your commander’s color identity.', colors: [], color_identity: [], produced_mana: ['W', 'U', 'B', 'R', 'G'] },
    { name: 'Sol Ring', mana_cost: '{1}', cmc: 1, type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', colors: [], color_identity: [], produced_mana: ['C'] },
    { name: 'Island', mana_cost: '', cmc: 0, type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', colors: [], color_identity: ['U'], produced_mana: ['U'] },
    { name: 'Cultivate', mana_cost: '{2}{G}', cmc: 3, type_line: 'Sorcery', oracle_text: 'Search your library for up to two basic land cards.', colors: ['G'], color_identity: ['G'] },
    { name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor', oracle_text: 'Copy historic spells.', colors: ['G', 'U'], color_identity: ['G', 'U'], power: '3', toughness: '3' },
    { name: 'Susan Foreman', mana_cost: '{2}{U}', cmc: 3, type_line: 'Legendary Creature — Human Time Lord', oracle_text: 'Doctor’s companion', colors: ['U'], color_identity: ['U'], power: '1', toughness: '3' },
    { name: 'Tymna the Weaver', mana_cost: '{1}{W}{B}', cmc: 3, type_line: 'Legendary Creature — Human Cleric', oracle_text: 'Lifelink\nPartner', colors: ['W', 'B'], color_identity: ['W', 'B'], power: '2', toughness: '2' }
].map((card, i) => [card.name, { object: 'card', id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, ...card }])));

const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** A fuzzy match the way Scryfall's /cards/named?fuzzy= forgives a typo or two. */
export function fuzzyCard(query) {
    const q = squash(query);
    return Object.values(SCRYFALL_CARDS).find(card => {
        const name = squash(card.name);
        if (name === q) return true;
        // Same letters, one pair swapped ("Sol Rnig").
        return name.length === q.length && [...name].sort().join('') === [...q].sort().join('');
    }) ?? null;
}

/** Scryfall's /cards/collection answer for a request body. */
export function collectionResponse(body) {
    const { identifiers = [] } = typeof body === 'string' ? JSON.parse(body) : (body ?? {});
    const data = [];
    const notFound = [];
    for (const id of identifiers) {
        const card = SCRYFALL_CARDS[id.name];
        if (card) data.push(card);
        else notFound.push(id);
    }
    return { object: 'list', not_found: notFound, data };
}

/** A paste with two commanders (a Doctor and their companion) and a typo. */
export const PASTED_DOCTOR_LIST = `Commander
1 The Sixth Doctor
1 Susan Foreman

Deck
1 Sol Rnig
1 Arcane Signet
1 Cultivate
95 Island`;
