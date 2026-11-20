/**
 * Calculator catalog — the single source of truth for every page in the app.
 *
 * Each entry is plain metadata plus two lazy loaders. Nothing here imports a
 * calculator eagerly: the shell renders navigation, search and headers from the
 * metadata alone, and a calculator's code and markup are fetched the first time
 * it is opened. Adding a calculator means adding one entry here plus its
 * `js/calculators/<key>.js` and `js/views/<key>.js`.
 *
 * Entry fields
 *   name      Display name
 *   short     Three-letter code (sidebar badge, command palette)
 *   group     Key into GROUPS
 *   card      Key into CARD_META for the header art and rules text
 *   cardInDeck  true when the calculator is about one specific card the deck
 *             should contain (drives the "In your deck" badge)
 *   question  The one question the page answers, in plain words
 *   summary   One or two sentences on what it shows
 *   method    'exact' | 'simulation' | 'exact + simulation' | 'deck search'
 *   keywords  Extra search terms for the command palette
 *   charts    false when the page never draws a Chart.js canvas (skips loading it)
 *   header    false when the page renders its own masthead instead of the shared one
 */

export const GROUPS = Object.freeze([
    { key: 'deck', label: 'Your deck', blurb: 'Works with any deck' },
    { key: 'engines', label: 'Engines', blurb: 'Permanents that keep paying out' },
    { key: 'spells', label: 'Big spells', blurb: 'One-shot payoffs' },
    { key: 'multiplayer', label: 'Multiplayer', blurb: 'Cards that hit opponents' }
]);

export const DEFAULT_TAB = 'overview';

export const CALCULATORS = Object.freeze({
    // ── YOUR DECK — generic, any list ────────────────────────────────────────
    overview: {
        name: 'Deck Overview', short: 'OVR', group: 'deck', card: 'Oracle of Mul Daya',
        question: 'How healthy is this deck’s mana, curve and card mix?',
        summary: 'A plain-language health check: land count, curve, colour sources, opening hands and the roles your cards play.',
        method: 'exact', keywords: ['home', 'health', 'curve', 'stats', 'dashboard', 'summary'],
        charts: false, header: false,
        load: () => import('../calculators/overview.js'), view: () => import('../views/overview.js')
    },
    odds: {
        name: 'Draw Odds', short: 'ODD', group: 'deck', card: 'Brainstorm',
        question: 'What are the chances I draw a card — or one of a group — by a given turn?',
        summary: 'Pick any cards from your list and see the exact odds of having them in hand, turn by turn.',
        method: 'exact', keywords: ['hypergeometric', 'draw', 'probability', 'chance', 'combo', 'find', 'tutor'],
        load: () => import('../calculators/odds.js'), view: () => import('../views/odds.js')
    },
    manabase: {
        name: 'Mana Base', short: 'MNA', group: 'deck', card: 'Command Tower',
        question: 'Can my lands cast my spells on curve?',
        summary: 'Colour sources against colour demands for every card, with how many sources each colour needs.',
        method: 'exact', keywords: ['colors', 'colours', 'sources', 'karsten', 'pips', 'lands', 'castability'],
        load: () => import('../calculators/manabase.js'), view: () => import('../views/manabase.js')
    },
    hands: {
        name: 'Opening Hands', short: 'HND', group: 'deck', card: 'Ponder',
        question: 'What do my opening hands actually look like?',
        summary: 'Draw real sample hands, practice keep-or-mulligan, and see how often hands are keepable.',
        method: 'exact + simulation', keywords: ['sample hand', 'goldfish', 'draw seven', 'mulligan practice', 'opener'],
        load: () => import('../calculators/hands.js'), view: () => import('../views/hands.js')
    },
    mulligan: {
        name: 'Mulligan Planner', short: 'MUL', group: 'deck', card: 'Serum Powder',
        question: 'Which hands should I keep, and how often will I find one?',
        summary: 'Set what a keepable hand needs and get the best mulligan strategy for this deck.',
        method: 'exact + simulation', keywords: ['mulligan', 'keep', 'london', 'requirements'],
        load: () => import('../calculators/mulligan.js'), view: () => import('../views/mulligan.js')
    },
    lands: {
        name: 'Land Drops', short: 'LND', group: 'deck', card: 'Azusa, Lost but Seeking',
        question: 'How reliably will I hit a land drop every turn?',
        summary: 'Turn-by-turn odds of making each land drop, and what changing your land count does.',
        method: 'exact', keywords: ['lands', 'mana screw', 'flood', 'land count'],
        load: () => import('../calculators/lands.js'), view: () => import('../views/lands.js')
    },
    compare: {
        name: 'Compare Decks', short: 'CMP', group: 'deck', card: 'Clone',
        question: 'How do two decks — or two versions of one deck — differ?',
        summary: 'Any two saved decks side by side: health checks, curve overlay and a card-by-card diff.',
        method: 'exact', keywords: ['compare', 'diff', 'versions', 'before after', 'saved decks', 'upgrade'],
        charts: false,
        load: () => import('../calculators/compare.js'), view: () => import('../views/compare.js')
    },

    // ── ENGINES — recurring permanents ───────────────────────────────────────
    wildpair: {
        name: 'Wild Pair', short: 'WPR', group: 'engines', card: 'Wild Pair', cardInDeck: true,
        question: 'What can each creature I cast search up with Wild Pair?',
        summary: 'Your creatures grouped by total power + toughness — the only thing Wild Pair matches on.',
        method: 'deck search', keywords: ['power toughness', 'tutor', 'creature'],
        load: () => import('../calculators/wildpair.js'), view: () => import('../views/wildpair.js')
    },
    vortex: {
        name: 'Monstrous Vortex', short: 'VOR', group: 'engines', card: 'Monstrous Vortex', cardInDeck: true,
        question: 'How much free mana does each big creature discover?',
        summary: 'Discover chains from every power 5+ creature, simulated against your real library.',
        method: 'simulation', keywords: ['discover', 'power 5', 'cascade'],
        load: () => import('../calculators/vortex.js'), view: () => import('../views/vortex.js')
    },
    chimil: {
        name: 'Chimil', short: 'CHM', group: 'engines', card: 'Chimil, the Inner Sun', cardInDeck: true,
        question: 'What does Chimil discover each end step, and how soon does it pay off?',
        summary: 'Discover 5 every turn, simulated game by game, with the turn it earns back its six mana.',
        method: 'simulation', keywords: ['discover 5', 'end step', 'payback'],
        load: () => import('../calculators/chimil.js'), view: () => import('../views/chimil.js')
    },
    rashmi: {
        name: 'Rashmi', short: 'RSH', group: 'engines', card: 'Rashmi, Eternities Crafter', cardInDeck: true,
        question: 'How often does Rashmi flip a free spell?',
        summary: 'The odds the top card is a cheaper spell for each spell you cast, across your curve.',
        method: 'exact + simulation', keywords: ['free spell', 'reveal', 'top card'],
        load: () => import('../calculators/rashmi.js'), view: () => import('../views/rashmi.js')
    },
    versus: {
        name: 'Head to Head', short: 'VS', group: 'engines', card: 'Pit Fight',
        question: 'Wild Pair or Monstrous Vortex — which does more for this deck?',
        summary: 'Both engines compared cast by cast: value, how often each fires, and the ceiling.',
        method: 'simulation', keywords: ['compare', 'versus', 'wild pair', 'vortex'],
        load: () => import('../calculators/versus.js'), view: () => import('../views/versus.js')
    },

    // ── BIG SPELLS — one-shot payoffs ────────────────────────────────────────
    portent: {
        name: 'Portent of Calamity', short: 'POR', group: 'spells', card: 'Portent of Calamity', cardInDeck: true,
        question: 'How often does Portent reveal four card types for a free spell?',
        summary: 'Free-spell odds at every X, the card types you reveal, and sample reveals from your deck.',
        method: 'exact + simulation', keywords: ['card types', 'free spell', 'x spell'],
        load: () => import('../calculators/portent.js'), view: () => import('../views/portent.js')
    },
    wave: {
        name: 'Genesis Wave', short: 'WAV', group: 'spells', card: 'Genesis Wave', cardInDeck: true,
        question: 'How much does Genesis Wave put into play, and does it pay for itself?',
        summary: 'Permanents and mana value put onto the battlefield at every X, and how often it repays the cast.',
        method: 'exact + simulation', keywords: ['x spell', 'permanents', 'payback'],
        load: () => import('../calculators/wave.js'), view: () => import('../views/wave.js')
    },
    vow: {
        name: 'Kamahl’s Druidic Vow', short: 'VOW', group: 'spells', card: "Kamahl's Druidic Vow", cardInDeck: true,
        question: 'How many lands and legendaries will the Vow put into play?',
        summary: 'Hits at every X — lands plus legendary permanents — and whether it repays the mana.',
        method: 'exact + simulation', keywords: ['legendary', 'lands', 'x spell'],
        load: () => import('../calculators/vow.js'), view: () => import('../views/vow.js')
    },
    surge: {
        name: 'Primal Surge', short: 'SUR', group: 'spells', card: 'Primal Surge', cardInDeck: true,
        question: 'How far does Primal Surge get before it hits a non-permanent?',
        summary: 'Permanents put into play, the chance it stops early, and how often it pays back ten mana.',
        method: 'exact + simulation', keywords: ['permanents', 'non-permanent', 'instants sorceries'],
        load: () => import('../calculators/surge.js'), view: () => import('../views/surge.js')
    },
    abstract: {
        name: 'Abstract Performance', short: 'ABS', group: 'spells', card: 'Abstract Performance', cardInDeck: true,
        question: 'What will your opponent leave you from the two piles?',
        summary: 'The face-down and face-up piles simulated from your deck, and what each choice gives you.',
        method: 'simulation', keywords: ['piles', 'face down', 'opponent chooses'],
        load: () => import('../calculators/abstract.js'), view: () => import('../views/abstract.js')
    },
    lumra: {
        name: 'Lumra', short: 'LMR', group: 'spells', card: 'Lumra, Bellow of the Woods', cardInDeck: true,
        question: 'How big is Lumra, and how many lands come back when it enters?',
        summary: 'Lands milled and returned, plus fetch lands already in the yard by the turn you cast it.',
        method: 'exact + simulation', keywords: ['mill', 'lands', 'graveyard', 'fetch'],
        load: () => import('../calculators/lumra.js'), view: () => import('../views/lumra.js')
    },

    // ── MULTIPLAYER — opponent-facing ────────────────────────────────────────
    mara: {
        name: 'Ensnared by the Mara', short: 'MAR', group: 'multiplayer', card: 'Ensnared by the Mara', cardInDeck: true,
        question: 'What does each opponent’s villainous choice give you?',
        summary: 'Free spells versus damage for each opponent, simulated from their real decklists.',
        method: 'simulation', keywords: ['villainous choice', 'opponents', 'damage'], needsOpponents: true,
        load: () => import('../calculators/mara.js'), view: () => import('../views/mara.js')
    },
    dreamharvest: {
        name: 'Dream Harvest', short: 'DRH', group: 'multiplayer', card: 'Dream Harvest', cardInDeck: true,
        question: 'How much will Dream Harvest steal from your opponents?',
        summary: 'Cards and mana value exiled from each opponent until each pile reaches five.',
        method: 'simulation', keywords: ['steal', 'opponents', 'exile'], needsOpponents: true,
        load: () => import('../calculators/dreamharvest.js'), view: () => import('../views/dreamharvest.js')
    },
    mindsdilation: {
        name: 'Mind’s Dilation', short: 'MND', group: 'multiplayer', card: "Mind's Dilation", cardInDeck: true,
        question: 'How often will Mind’s Dilation give you a free spell?',
        summary: 'Free casts per turn cycle from your opponents’ libraries, by their land counts.',
        method: 'exact + simulation', keywords: ['opponents', 'free spell', 'exile top'], needsOpponents: true,
        load: () => import('../calculators/mindsdilation.js'), view: () => import('../views/mindsdilation.js')
    }
});

/** Calculator keys in navigation order (grouped, then declaration order). */
export const CALCULATOR_ORDER = Object.freeze(
    GROUPS.flatMap(g => Object.keys(CALCULATORS).filter(k => CALCULATORS[k].group === g.key))
);

export function getCalculator(name) {
    return Object.prototype.hasOwnProperty.call(CALCULATORS, name) ? CALCULATORS[name] : null;
}

export function getGroup(key) {
    return GROUPS.find(g => g.key === key) ?? null;
}

// ── Lazy module cache ────────────────────────────────────────────────────────
const loaded = new Map();

/**
 * The calculator module if it has already been loaded, else null. Lets shared
 * code (share links) talk to a calculator without forcing it to load.
 */
export function getLoadedModule(name) {
    return loaded.get(name)?.module ?? null;
}

/**
 * Load a calculator's code and markup (once). Resolves to { module, template }.
 * @param {string} name
 */
export function loadCalculator(name) {
    const entry = getCalculator(name);
    if (!entry) return Promise.reject(new Error(`Unknown calculator: ${name}`));
    if (!loaded.has(name)) {
        const promise = Promise.all([entry.load(), entry.view()]).then(([module, view]) => {
            const record = { module, template: view.template ?? '', styles: view.styles ?? '' };
            loaded.set(name, record);
            return record;
        });
        // Store the in-flight promise so concurrent opens share one fetch; a
        // failed load is evicted so the next open can retry.
        loaded.set(name, { promise });
        promise.catch(() => loaded.delete(name));
        return promise;
    }
    const record = loaded.get(name);
    return record.promise ?? Promise.resolve(record);
}
