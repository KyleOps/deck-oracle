/**
 * Decklist text → card entries. Pure: no network, no DOM.
 *
 * Reads the plain-text exports of Moxfield, Archidekt, MTGO, Arena and hand
 * written lists: "4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt",
 * section headers ("Commander", "Creatures (12)", "Sideboard"), printing
 * suffixes ("(M11) 146", "[C21]") and markers ("*F*", "*CMDR*", "#ramp").
 */

const MAX_DECKLIST_LENGTH = 50000; // ~50 KB
const MAX_DECKLIST_LINES = 500;
const MAX_CARD_COUNT = 100;
const MIN_CARD_COUNT = 1;
const MAX_CARD_NAME_LENGTH = 100;

/**
 * Names Scryfall can't resolve on their own (several cards share them).
 * Double-faced names need no entry: lookups use the front face.
 */
const CARD_NAME_CORRECTIONS = Object.freeze({
    Vorinclex: 'Vorinclex, Monstrous Raider'
});

const SIDEBOARD_MARKER = /^SIDEBOARD:?$/im;
// Section headers from Moxfield, Archidekt, MTGO and Arena exports. The
// section decides where the following cards go.
const SECTION_HEADER = /^(creatures?|lands?|spells?|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|battles?|commanders?|companions?|deck|main ?(deck|board)|sideboard|maybeboard|considering|tokens?|about)(\s*\(\d+\))?:?$/i;
// Companions (the keyword) start outside the game, like the sideboard.
const EXCLUDED_SECTION = /^(sideboard|maybeboard|considering|tokens?|about|companions?)/i;
const CARD_LINE = /^(\d+)x?\s+(.+)$/;
const COUNT_PREFIX = /^(\d+)x?\s+/;
const CMDR_MARKER = /\*CMDR\*/i;

/** Strip printing and marker noise: "(C21) 263", "[C21]", "*F*", "#tag", "^Have,#37d67a^". */
function cleanName(raw) {
    return raw
        .replace(/\^[^^]*\^/g, '')
        .replace(/\s+\*[A-Z]+\*/gi, '')
        .replace(/\s+\[[^\]]*\]/g, '')
        .replace(/\s+#\S+/g, '')
        .replace(/\s+\([A-Z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/i, '')
        .trim();
}

/**
 * The name to look a card up by (fixes names several cards share).
 * @param {string} name
 * @returns {string}
 */
export function correctCardName(name) {
    return CARD_NAME_CORRECTIONS[name] ?? name;
}

function countSideboard(text) {
    let count = 0;
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        const match = trimmed.match(COUNT_PREFIX);
        if (match) count += parseInt(match[1], 10);
        else if (trimmed.length > 0 && !/^SIDEBOARD:?$/i.test(trimmed)) count += 1;
    }
    return count;
}

/**
 * Parse decklist text into card entries.
 *
 * Commanders (a "Commander" section, or a "*CMDR*" marker) are reported
 * separately: they start in the command zone, not the library, the same rule
 * the Moxfield and Archidekt importers follow. Every commander is kept, so a
 * partner pair or a Doctor and their companion both arrive.
 *
 * @param {string} decklistText
 * @returns {{cards:Array<{count:number,name:string}>, commanders:Array<{count:number,name:string}>,
 *   hasSideboard:boolean, sideboardCount:number, skipped:string[]}}
 * @throws {Error} when the text is not a string, too long, or has too many lines
 */
export function parseDecklistText(decklistText) {
    if (!decklistText || typeof decklistText !== 'string') {
        throw new Error('Invalid decklist: must be a string');
    }
    if (decklistText.length > MAX_DECKLIST_LENGTH) {
        throw new Error(`Decklist too large. Maximum ${MAX_DECKLIST_LENGTH} characters.`);
    }
    if (decklistText.split('\n').length > MAX_DECKLIST_LINES) {
        throw new Error(`Decklist has too many lines. Maximum ${MAX_DECKLIST_LINES} lines.`);
    }

    const sideboardIndex = decklistText.search(SIDEBOARD_MARKER);
    const hasSideboard = sideboardIndex >= 0;
    const maindeckText = hasSideboard ? decklistText.substring(0, sideboardIndex) : decklistText;
    const sideboardCount = hasSideboard ? countSideboard(decklistText.substring(sideboardIndex)) : 0;

    const cards = [];
    const commanders = [];
    const skipped = [];
    let section = 'main';

    for (const rawLine of maindeckText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        if (SECTION_HEADER.test(line)) {
            const header = line.toLowerCase();
            section = /^commander/.test(header) ? 'commander'
                : EXCLUDED_SECTION.test(header) ? 'excluded'
                    : 'main';
            continue;
        }
        if (line.startsWith('//') || line.startsWith('#') || section === 'excluded') continue;

        const match = line.match(CARD_LINE);
        const count = match ? parseInt(match[1], 10) : 1;
        const rawName = match ? match[2].trim() : line;
        const name = cleanName(rawName);
        if (match && (count < MIN_CARD_COUNT || count > MAX_CARD_COUNT)) {
            skipped.push(line);
            continue;
        }
        if (name.length === 0 || name.length > MAX_CARD_NAME_LENGTH) {
            skipped.push(line);
            continue;
        }
        if (section === 'commander' || CMDR_MARKER.test(rawName)) commanders.push({ count, name });
        else cards.push({ count, name });
    }

    return { cards, commanders, hasSideboard, sideboardCount, skipped };
}
