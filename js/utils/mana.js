/**
 * Mana cost and mana source analysis.
 *
 * Pure functions over Scryfall-shaped card records (`mana_cost`, `type_line`,
 * `oracle_text`, `color_identity`, optional `produced_mana`). Nothing here
 * touches the DOM, so every rule is unit-tested in isolation.
 */

/** The five colours in WUBRG order — the order every colour list renders in. */
export const COLORS = Object.freeze(['W', 'U', 'B', 'R', 'G']);

export const COLOR_NAMES = Object.freeze({
    W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless'
});

const BASIC_TYPE_COLOR = Object.freeze({
    plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G'
});

/**
 * Parse a printed mana cost into its components.
 *
 * Hybrid symbols ({U/B}) are kept separate from strict pips because either half
 * satisfies them — counting them as both colours would overstate a card's
 * colour demands. Phyrexian symbols ({G/P}) can be paid with life, so they are
 * tracked but never counted as a hard requirement. Twobrid ({2/W}) is treated
 * as hybrid with generic.
 *
 * @param {string} cost - e.g. "{X}{G}{G}{G}"
 * @returns {{generic:number, x:number, pips:Record<string,number>, hybrid:string[][], phyrexian:string[], colorless:number, total:number}}
 */
export function parseManaCost(cost) {
    const result = { generic: 0, x: 0, pips: { W: 0, U: 0, B: 0, R: 0, G: 0 }, hybrid: [], phyrexian: [], colorless: 0, total: 0 };
    if (typeof cost !== 'string' || cost.length === 0) return result;

    // Split faces ("{1}{U} // {3}{U}{U}") and use the front face only
    const front = cost.split('//')[0];
    const symbols = front.match(/\{[^}]+\}/g) ?? [];

    for (const raw of symbols) {
        const sym = raw.slice(1, -1).toUpperCase();
        if (/^\d+$/.test(sym)) {
            result.generic += Number(sym);
        } else if (sym === 'X' || sym === 'Y' || sym === 'Z') {
            result.x += 1;
        } else if (COLORS.includes(sym)) {
            result.pips[sym] += 1;
        } else if (sym === 'C') {
            result.colorless += 1;
        } else if (sym.includes('/')) {
            const parts = sym.split('/');
            if (parts.includes('P')) {
                const color = parts.find(p => COLORS.includes(p));
                if (color) result.phyrexian.push(color);
            } else {
                const colors = parts.filter(p => COLORS.includes(p));
                if (colors.length > 0) result.hybrid.push(colors);
            }
        }
        // {S} snow and anything unknown is ignored — neither is a colour demand.
    }

    const pipTotal = COLORS.reduce((sum, c) => sum + result.pips[c], 0);
    result.total = result.generic + pipTotal + result.colorless + result.hybrid.length + result.phyrexian.length;
    return result;
}

/**
 * Strict per-colour requirements of a cost (hybrid and phyrexian excluded).
 * @param {string} cost
 * @returns {Record<string, number>} only colours with at least one pip
 */
export function colorRequirements(cost) {
    const { pips } = parseManaCost(cost);
    const out = {};
    for (const c of COLORS) if (pips[c] > 0) out[c] = pips[c];
    return out;
}

/**
 * Is this card record a land? Uses the front face's type line.
 * @param {{type_line?:string, category?:string}} card
 */
export function isLand(card) {
    if (!card) return false;
    if (card.category === 'lands') return true;
    const front = String(card.type_line ?? '').split('//')[0];
    return /\bland\b/i.test(front);
}

/**
 * Which colours of mana can this land produce?
 *
 * Prefers Scryfall's `produced_mana` when the import supplied it. Otherwise it
 * combines three signals that are each reliable on their own:
 *   - basic land types in the type line (a "Forest Island" taps for G and U);
 *   - the land's colour identity, which for a land is exactly the mana symbols
 *     in its rules text (Breeding Pool → G, U);
 *   - rules text that produces "mana of any color" or fetches a basic type.
 * "Any colour" lands and basic-fetchers are clamped to the deck's identity,
 * because a Command Tower in a Simic deck is a green-or-blue source, not a
 * five-colour one.
 *
 * @param {Object} card - card record
 * @param {string[]} [deckIdentity] - the deck's colour identity (WUBRG subset)
 * @returns {string[]} colours in WUBRG order (may be empty for colourless lands)
 */
export function landColors(card, deckIdentity = COLORS) {
    if (!card) return [];
    const identity = deckIdentity && deckIdentity.length ? deckIdentity : COLORS;
    const found = new Set();

    if (Array.isArray(card.produced_mana) && card.produced_mana.length > 0) {
        card.produced_mana.forEach(c => { if (COLORS.includes(c)) found.add(c); });
        return COLORS.filter(c => found.has(c) && identity.includes(c));
    }

    const typeLine = String(card.type_line ?? '').split('//')[0].toLowerCase();
    for (const [type, color] of Object.entries(BASIC_TYPE_COLOR)) {
        if (new RegExp(`\\b${type}\\b`).test(typeLine)) found.add(color);
    }

    const ci = card.color_identity ?? card.colorIdentity;
    if (Array.isArray(ci)) ci.forEach(c => { if (COLORS.includes(c)) found.add(c); });

    const text = String(card.oracle_text ?? '').toLowerCase();
    // Mana symbols written in the rules text — covers imports without identity.
    for (const m of text.matchAll(/add [^.]*?(\{[wubrg]\})/g)) {
        const symbols = m[0].match(/\{([wubrg])\}/g) ?? [];
        symbols.forEach(s => found.add(s[1].toUpperCase()));
    }
    if (/mana of any (one )?colou?r|any colou?r in your commander|mana of any type/.test(text)) {
        identity.forEach(c => found.add(c));
    }
    // Fetch lands: "search your library for a Forest or Island card"
    if (/search your library for/.test(text)) {
        if (/basic land card/.test(text)) {
            identity.forEach(c => found.add(c));
        }
        for (const [type, color] of Object.entries(BASIC_TYPE_COLOR)) {
            if (new RegExp(`search your library for[^.]*\\b${type}\\b`).test(text)) found.add(color);
        }
    }

    return COLORS.filter(c => found.has(c) && identity.includes(c));
}

/**
 * The deck's colour identity: union of every card's identity (or, failing
 * that, its cost's colours), plus the commander's.
 * @param {Record<string, Object>} cardsByName
 * @returns {string[]} WUBRG-ordered
 */
export function deckColorIdentity(cardsByName = {}) {
    const found = new Set();
    for (const card of Object.values(cardsByName)) {
        if (!card || !(Number(card.count) > 0)) continue;
        const ci = card.color_identity ?? card.colorIdentity;
        if (Array.isArray(ci) && ci.length > 0) {
            ci.forEach(c => { if (COLORS.includes(c)) found.add(c); });
            continue;
        }
        if (isLand(card)) continue; // a land without identity says nothing
        const { pips, hybrid, phyrexian } = parseManaCost(card.mana_cost);
        COLORS.forEach(c => { if (pips[c] > 0) found.add(c); });
        hybrid.flat().forEach(c => found.add(c));
        phyrexian.forEach(c => found.add(c));
    }
    return COLORS.filter(c => found.has(c));
}

/**
 * Render a mana cost as accessible inline symbols (CSS draws the discs).
 * @param {string} cost
 * @returns {string} HTML
 */
export function renderManaCost(cost) {
    if (typeof cost !== 'string' || !cost) return '';
    const symbols = cost.split('//')[0].match(/\{[^}]+\}/g) ?? [];
    if (symbols.length === 0) return '';
    const items = symbols.map(raw => {
        const sym = raw.slice(1, -1).toUpperCase();
        const cls = sym.replace('/', '').toLowerCase();
        return `<span class="ms ms-${cls}" aria-hidden="true">${sym.includes('/') ? '' : sym}</span>`;
    }).join('');
    return `<span class="mana-cost" role="img" aria-label="Mana cost ${symbols.join('')}">${items}</span>`;
}
