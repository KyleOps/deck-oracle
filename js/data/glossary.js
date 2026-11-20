/**
 * Plain-language definitions for the terms the calculators use.
 *
 * Any element with `data-term="<key>"` gets this definition as a tooltip (see
 * js/shell/overlays.js), so a calculator can write `term('p95', 'good turn')`
 * and the reader is one hover away from what it means.
 */

export const GLOSSARY = Object.freeze({
    exact: {
        term: 'Exact odds',
        def: 'Calculated directly from the card counts with the hypergeometric formula — no randomness, the same answer every time.'
    },
    hypergeometric: {
        term: 'Hypergeometric',
        def: 'The maths of drawing without replacement: the chance of finding k of a card group in n cards drawn from a deck. It is exact, not an estimate.'
    },
    simulation: {
        term: 'Simulation',
        def: 'The calculator shuffles your real decklist thousands of times and plays the card out each time, then reports what happened. Good for mechanics too tangled for a formula.'
    },
    sample: {
        term: 'Sample run',
        def: 'One simulated shuffle and resolution, shown in full so you can see what the averages are made of.'
    },
    ev: {
        term: 'Average (expected value)',
        def: 'What you get on a typical cast if you cast it many times. A useful centre, but it hides how swingy the results are — check the distribution too.'
    },
    median: {
        term: 'Median (typical)',
        def: 'Half of all results are below this and half above. Less pulled around by rare huge outcomes than the average.'
    },
    p50: {
        term: 'Typical result (p50)',
        def: 'The median: half of casts do at least this well.'
    },
    p95: {
        term: 'Good turn (p95)',
        def: 'Only 1 cast in 20 does better than this. A realistic “it went well” outcome, unlike the single best result ever sampled.'
    },
    p99: {
        term: 'Great turn (p99)',
        def: 'Only 1 cast in 100 does better than this.'
    },
    mv: {
        term: 'Mana value',
        def: 'The total mana in a card’s cost (formerly “converted mana cost”). X counts as 0 outside the stack; lands are 0.'
    },
    pip: {
        term: 'Pip',
        def: 'One coloured mana symbol in a cost. {1}{G}{G} has two green pips — you need two green sources to cast it.'
    },
    source: {
        term: 'Colour source',
        def: 'A land that can produce that colour of mana. A dual land counts as a source for both of its colours.'
    },
    oncurve: {
        term: 'On curve',
        def: 'Cast on the turn matching its mana value — a 3-drop on turn 3. Assumes you made every land drop up to then.'
    },
    play: {
        term: 'On the play / on the draw',
        def: 'Whoever goes first is “on the play”. In two-player games they skip their first draw; in multiplayer Commander nobody does.'
    },
    mulligan: {
        term: 'Mulligan (London)',
        def: 'Shuffle your hand away and draw a new seven, then put one card on the bottom for each mulligan taken. In multiplayer Commander the first mulligan is free.'
    },
    keepable: {
        term: 'Keepable hand',
        def: 'A hand you would keep rather than mulligan. By default that means two to four lands in the opening seven; pages that use it let you change the rule.'
    },
    whiff: {
        term: 'Whiff',
        def: 'A resolution that does not return enough value to have been worth the mana — below the payback threshold you set.'
    },
    payback: {
        term: 'Payback',
        def: 'Whether the value a spell puts onto the battlefield is at least what you paid for it, using the value assumptions shown.'
    },
    discover: {
        term: 'Discover X',
        def: 'Exile cards from the top until you hit a nonland card with mana value X or less. Cast it free or put it into your hand; the rest go to the bottom.'
    },
    library: {
        term: 'Library',
        def: 'Your deck during a game. In Commander that is 99 cards — the commander starts in the command zone.'
    },
    ci: {
        term: 'Confidence',
        def: 'How much the number could move if the simulation were run again. Exact results have none; simulated ones settle down as runs increase.'
    }
});

/** Escape text for safe insertion into HTML. */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Inline glossary term: dotted underline with a definition tooltip.
 * @param {string} key - GLOSSARY key
 * @param {string} [label] - visible text (defaults to the glossary term)
 */
export function term(key, label) {
    const entry = GLOSSARY[key];
    if (!entry) return escapeHtml(label ?? key);
    return `<span class="term" data-term="${key}" tabindex="0">${escapeHtml(label ?? entry.term)}</span>`;
}

/**
 * Inline card reference: hover or focus to preview the card image.
 * @param {string} name - exact card name
 * @param {string} [label]
 */
export function cardRef(name, label) {
    const safe = escapeHtml(name);
    return `<span class="card-ref" data-card="${safe}" tabindex="0">${escapeHtml(label ?? name)}</span>`;
}
