/**
 * Deck Radar — automatic calculator relevance detection
 *
 * Given an imported deck (the DeckConfig shape), works out which of the site's
 * calculators actually apply to it and why. Two independent evidence channels:
 *
 *   1. NAMED CARDS — the deck literally contains the card a calculator models
 *      (or runs it as the commander). This is the strongest possible signal.
 *   2. STRUCTURAL — the deck's shape makes a calculator meaningful even without
 *      the named card (e.g. a 0-instant/0-sorcery deck is a Primal Surge shell
 *      whether or not Primal Surge is currently in the 99).
 *
 * Every function here is pure and DOM-free so the whole ranking is unit-testable.
 */

// ==================== SCORING CONSTANTS ====================

const SCORE = {
    COMMANDER: 120,   // calculator's card is the commander — always in play
    IN_DECK: 100,     // calculator's card is somewhere in the 99
    STRUCTURAL: 45,   // deck shape strongly suggests this calculator
    WEAK: 20,         // deck shape mildly suggests it
    BASELINE: 30      // universally applicable tools (mulligan, land drops)
};

const TIERS = [
    { min: 100, tier: 'core',     label: 'IN DECK',   color: 'var(--tx-green)' },
    { min: 45,  tier: 'likely',   label: 'RELEVANT',  color: 'var(--tx-amber)' },
    { min: 20,  tier: 'possible', label: 'POSSIBLE',  color: 'var(--tx-blue)' },
    { min: 0,   tier: 'idle',     label: '—',         color: 'var(--tx-dim)' }
];

/**
 * Card names that pin a calculator to a deck. Written naturally here; they are
 * run through `normalizeCardName` before matching (see NORMALIZED_TRIGGERS) so
 * punctuation, casing, and double-faced "//" suffixes don't matter on either side.
 */
export const TRIGGER_CARDS = {
    portent:       ['portent of calamity'],
    surge:         ['primal surge'],
    wave:          ['genesis wave'],
    vow:           ["kamahl's druidic vow"],
    vortex:        ['monstrous vortex'],
    rashmi:        ['rashmi eternities crafter', 'rashmi and ragavan'],
    lumra:         ['lumra bellow of the woods'],
    mara:          ['ensnared by the mara'],
    dreamharvest:  ['dream harvest'],
    mindsdilation: ["mind's dilation", 'minds dilation'],
    abstract:      ['abstract performance', 'fact or fiction', 'steam augury', 'temporal cascade'],
    chimil:        ['chimil the inner sun']
};

// ==================== NORMALIZATION ====================

/**
 * Normalize a card name for comparison: front face only, lowercase, punctuation
 * stripped, whitespace collapsed. "Rashmi, Eternities Crafter" →
 * "rashmi eternities crafter".
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeCardName(name) {
    if (typeof name !== 'string') return '';
    return name
        .split('//')[0]
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * TRIGGER_CARDS with every entry normalized and de-duplicated, so lookups are a
 * plain Set membership test against normalized deck card names.
 */
const NORMALIZED_TRIGGERS = Object.fromEntries(
    Object.entries(TRIGGER_CARDS).map(([tab, names]) => [
        tab,
        [...new Set(names.map(normalizeCardName).filter(Boolean))]
    ])
);

// ==================== DECK FACTS ====================

/**
 * Reduce a raw deck config into the handful of derived facts the signal
 * functions care about. Defensive throughout — a hand-typed deck has no
 * cardsByName at all.
 *
 * @param {Object} deck - DeckConfig-shaped object
 * @returns {Object} facts
 */
export function deriveDeckFacts(deck = {}) {
    const num = (v) => (Number.isFinite(v) ? v : 0);

    const counts = {
        creatures: num(deck.creatures),
        instants: num(deck.instants),
        sorceries: num(deck.sorceries),
        artifacts: num(deck.artifacts),
        enchantments: num(deck.enchantments),
        planeswalkers: num(deck.planeswalkers),
        lands: num(deck.lands),
        battles: num(deck.battles)
    };

    const typeSum = Object.values(counts).reduce((a, b) => a + b, 0);
    const total = num(deck.actualCardCount) || typeSum;

    const permanents = counts.creatures + counts.artifacts + counts.enchantments
        + counts.planeswalkers + counts.lands + counts.battles;
    const nonPermanents = counts.instants + counts.sorceries;

    // Distinct card types actually present (Portent needs >= 4 to ever trigger)
    const distinctTypes = Object.entries(counts).filter(([, v]) => v > 0).length;

    const cardsByName = (deck.cardsByName && typeof deck.cardsByName === 'object') ? deck.cardsByName : {};
    const cardDetails = Array.isArray(deck.cardDetails) ? deck.cardDetails : [];

    // Normalized names for matching, plus the original spelling for display —
    // otherwise reasons read "Kamahls Druidic Vow" with the apostrophe stripped.
    const names = new Set();
    const displayNames = new Map();
    const addName = (raw) => {
        const key = normalizeCardName(raw);
        if (!key) return;
        names.add(key);
        if (!displayNames.has(key)) displayNames.set(key, String(raw).split('//')[0].trim());
    };
    for (const key of Object.keys(cardsByName)) addName(cardsByName[key]?.name || key);
    for (const c of cardDetails) addName(c?.name);

    const commanderName = deck.commanderName || null;
    const commander = normalizeCardName(commanderName);

    // Legendary permanent count (Kamahl's Vow hits lands + legendary permanents)
    let legendaryPermanents = 0;
    let power5Plus = 0;
    for (const card of Object.values(cardsByName)) {
        const line = (card?.type_line || '').toLowerCase();
        const n = num(card?.count) || 1;
        if (line.includes('legendary') && !line.includes('instant') && !line.includes('sorcery')) {
            legendaryPermanents += n;
        }
    }
    for (const c of cardDetails) if (c?.isPower5Plus) power5Plus += 1;

    // Nonlands castable off discover 5 (Chimil, Monstrous Vortex).
    let cheapNonlands = 0;
    for (const c of cardDetails) {
        if (c?.type === 'lands') continue;
        if ((Number.isFinite(c?.cmc) ? c.cmc : 0) <= 5) cheapNonlands += 1;
    }
    if (power5Plus === 0) power5Plus = num(deck.creaturesPower5Plus);

    // Mana curve of non-lands, from per-copy card details when available
    const curve = {};
    for (const c of cardDetails) {
        if (c?.type === 'lands') continue;
        const cmc = Math.max(0, Math.min(12, Math.round(num(c?.cmc))));
        curve[cmc] = (curve[cmc] || 0) + 1;
    }
    const curveEntries = Object.entries(curve).map(([k, v]) => [Number(k), v]);
    const curveTotal = curveEntries.reduce((a, [, v]) => a + v, 0);
    const avgCmc = curveTotal > 0
        ? curveEntries.reduce((a, [k, v]) => a + k * v, 0) / curveTotal
        : 0;

    return {
        counts,
        total,
        permanents,
        nonPermanents,
        permanentRatio: total > 0 ? permanents / total : 0,
        distinctTypes,
        names,
        displayNames,
        commanderName,
        commander,
        legendaryPermanents,
        power5Plus,
        cheapNonlands,
        curve,
        avgCmc,
        hasCardData: names.size > 0,
        imported: Boolean(deck.importSource) || names.size > 0
    };
}

// ==================== STRUCTURAL SIGNALS ====================

/**
 * Structural relevance rules, one per calculator. Each returns
 * `{ score, reason }` or null. Kept declarative so a new calculator is one
 * entry, not a new branch somewhere else.
 */
const STRUCTURAL_SIGNALS = {
    mulligan: (f) => ({
        score: SCORE.BASELINE,
        reason: `Opening-hand keep/mull math for a ${f.total}-card list`
    }),

    lands: (f) => {
        if (f.counts.lands <= 0) return null;
        const pct = f.total > 0 ? Math.round((f.counts.lands / f.total) * 100) : 0;
        return {
            score: SCORE.BASELINE,
            reason: `${f.counts.lands} lands (${pct}% of deck) — check land-drop consistency`
        };
    },

    surge: (f) => {
        if (!f.hasCardData) return null;
        if (f.nonPermanents === 0) {
            return { score: SCORE.STRUCTURAL, reason: 'Zero instants/sorceries — a natural Primal Surge shell' };
        }
        if (f.nonPermanents <= 5) {
            return { score: SCORE.WEAK, reason: `Only ${f.nonPermanents} non-permanents — Primal Surge rarely fizzles early` };
        }
        return null;
    },

    wave: (f) => {
        if (!f.hasCardData) return null;
        if (f.permanentRatio >= 0.75 && f.avgCmc <= 4.5) {
            return {
                score: SCORE.STRUCTURAL,
                reason: `${Math.round(f.permanentRatio * 100)}% permanents at avg MV ${f.avgCmc.toFixed(1)} — strong X-spell target density`
            };
        }
        return null;
    },

    vow: (f) => {
        if (f.legendaryPermanents < 8) return null;
        return {
            score: f.legendaryPermanents >= 15 ? SCORE.STRUCTURAL : SCORE.WEAK,
            reason: `${f.legendaryPermanents} legendary permanents + ${f.counts.lands} lands are live Vow hits`
        };
    },

    portent: (f) => {
        if (f.distinctTypes < 4) return null;
        return {
            score: f.distinctTypes >= 6 ? SCORE.STRUCTURAL : SCORE.WEAK,
            reason: `${f.distinctTypes} distinct card types present — enough spread to hit the 4-type clause`
        };
    },

    vortex: (f) => {
        if (f.power5Plus < 10) return null;
        return {
            score: f.power5Plus >= 18 ? SCORE.STRUCTURAL : SCORE.WEAK,
            reason: `${f.power5Plus} creatures with power 5+ — deep enough for discover chains`
        };
    },

    lumra: (f) => {
        if (!f.hasCardData) return null;
        if (f.counts.lands >= 38) {
            return { score: SCORE.WEAK, reason: `${f.counts.lands} lands — mill-4 land recursion pays off` };
        }
        return null;
    },

    rashmi: (f) => {
        if (!f.hasCardData || f.avgCmc <= 0) return null;
        if (f.avgCmc >= 3.4) {
            return { score: SCORE.WEAK, reason: `Avg MV ${f.avgCmc.toFixed(1)} — high curve makes free-cast triggers valuable` };
        }
        return null;
    },

    // Chimil discovers 5 every end step, so what matters is whether the deck
    // has enough cheap nonlands to convert those triggers into real value.
    chimil: (f) => {
        if (!f.hasCardData) return null;
        const eligible = f.cheapNonlands;
        if (eligible <= 0) return null;
        const share = f.total > 0 ? eligible / f.total : 0;
        if (share >= 0.30) {
            return { score: SCORE.STRUCTURAL, reason: `${eligible} nonlands at MV 5 or less (${Math.round(share * 100)}%) — dense enough for discover 5 every turn` };
        }
        if (share >= 0.18) {
            return { score: SCORE.WEAK, reason: `${eligible} nonlands at MV 5 or less — discover 5 converts, but digs to find them` };
        }
        return null;
    },

    abstract: () => null,
    mara: () => null,
    dreamharvest: () => null,
    mindsdilation: () => null
};

// ==================== RANKING ====================

/**
 * Score every calculator against a deck and return them ranked most-relevant
 * first. Named-card evidence and structural evidence stack, so a deck that both
 * runs Genesis Wave *and* is 80% permanents ranks above one that just runs it.
 *
 * @param {Object} deck - DeckConfig-shaped object
 * @param {Object} [opts]
 * @param {string[]} [opts.tabs] - Restrict to these calculator ids
 * @returns {Array<{tab:string, score:number, tier:string, tierLabel:string, color:string, reasons:string[], hasCard:boolean}>}
 */
export function analyzeDeck(deck = {}, opts = {}) {
    const facts = deriveDeckFacts(deck);
    const tabs = opts.tabs || Object.keys(STRUCTURAL_SIGNALS);

    const results = tabs.map(tab => {
        const reasons = [];
        let score = 0;
        let hasCard = false;

        // Channel 1: named cards
        const triggers = NORMALIZED_TRIGGERS[tab] || [];
        for (const trigger of triggers) {
            if (facts.commander && facts.commander === trigger) {
                score += SCORE.COMMANDER;
                hasCard = true;
                reasons.push(`${facts.commanderName || titleize(trigger)} is your commander`);
                break;
            }
            if (facts.names.has(trigger)) {
                score += SCORE.IN_DECK;
                hasCard = true;
                // Prefer the deck's own spelling over the normalized trigger.
                reasons.push(`${facts.displayNames.get(trigger) || titleize(trigger)} is in the deck`);
                break;
            }
        }

        // Channel 2: deck shape
        const structural = STRUCTURAL_SIGNALS[tab]?.(facts) ?? null;
        if (structural) {
            score += structural.score;
            reasons.push(structural.reason);
        }

        const tierInfo = TIERS.find(t => score >= t.min) || TIERS[TIERS.length - 1];

        return {
            tab,
            score,
            tier: tierInfo.tier,
            tierLabel: tierInfo.label,
            color: tierInfo.color,
            reasons,
            hasCard
        };
    });

    // Highest score first; ties broken by named-card evidence, then alphabetically
    // so the ordering is stable across runs.
    return results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.hasCard !== b.hasCard) return a.hasCard ? -1 : 1;
        return a.tab.localeCompare(b.tab);
    });
}

/**
 * The subset worth actually surfacing: anything above the "idle" floor.
 *
 * @param {Object} deck
 * @param {Object} [opts]
 * @param {number} [opts.limit=6]
 * @returns {Array} ranked, filtered results
 */
export function relevantCalculators(deck = {}, opts = {}) {
    const { limit = 6 } = opts;
    return analyzeDeck(deck).filter(r => r.tier !== 'idle').slice(0, limit);
}

/**
 * Title-case a normalized trigger name for display ("genesis wave" →
 * "Genesis Wave"). Small words stay lowercase except in first position.
 *
 * @param {string} s
 * @returns {string}
 */
function titleize(s) {
    const small = new Set(['of', 'the', 'and', 'by', 'or']);
    return String(s)
        .split(' ')
        .map((w, i) => (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export { titleize, SCORE, TIERS };
