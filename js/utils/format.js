/**
 * Game formats — the handful of rules that change probability answers.
 *
 * Deck size, whether the starting player draws on turn one, and whether the
 * first mulligan is free are the only format rules any calculator here needs.
 * Keeping them in one table means a 60-card list gets 60-card answers
 * everywhere instead of every calculator assuming Commander.
 */

export const FORMATS = Object.freeze({
    commander: Object.freeze({
        key: 'commander',
        label: 'Commander',
        short: 'EDH',
        librarySize: 99,
        openingHand: 7,
        // CR 103.8c: in multiplayer games other than Two-Headed Giant, no
        // player skips the draw step of their first turn.
        firstPlayerDraws: true,
        // CR 103.5c: in multiplayer games the first mulligan is free.
        freeMulligan: true,
        multiplayer: true
    }),
    constructed: Object.freeze({
        key: 'constructed',
        label: 'Constructed (60)',
        short: '60',
        librarySize: 60,
        openingHand: 7,
        firstPlayerDraws: false,
        freeMulligan: false,
        multiplayer: false
    }),
    limited: Object.freeze({
        key: 'limited',
        label: 'Limited (40)',
        short: '40',
        librarySize: 40,
        openingHand: 7,
        firstPlayerDraws: false,
        freeMulligan: false,
        multiplayer: false
    })
});

/**
 * Infer the format from what the deck looks like: any commander (one, or a
 * pair) means Commander; otherwise the library size decides.
 * @param {{deckSize?:number, commanderName?:string|null, commanders?:Array}} deck
 * @returns {'commander'|'constructed'|'limited'}
 */
export function detectFormat({ deckSize = 0, commanderName = null, commanders = null } = {}) {
    const n = Number(deckSize) || 0;
    if (commanderName || (Array.isArray(commanders) && commanders.some(c => (typeof c === 'string' ? c : c?.name)))) return 'commander';
    if (n >= 90) return 'commander';
    if (n > 0 && n <= 45) return 'limited';
    return 'constructed';
}

/**
 * Resolve a stored preference ('auto' or a format key) to a format object.
 * @param {string|null|undefined} preference
 * @param {{deckSize?:number, commanderName?:string|null, commanders?:Array}} deck
 */
export function resolveFormat(preference, deck) {
    if (preference && preference !== 'auto' && FORMATS[preference]) return FORMATS[preference];
    return FORMATS[detectFormat(deck)];
}

/**
 * Cards seen by the start of your main phase on a given turn.
 * Turn 0 is the opening hand.
 *
 * @param {number} turn - 0 = opening hand, 1 = your first turn, …
 * @param {{format?:object, onPlay?:boolean, handSize?:number}} [opts]
 *   onPlay: you are the starting player (matters only where the starting
 *   player skips their first draw)
 * @returns {number}
 */
export function cardsSeenByTurn(turn, { format = FORMATS.commander, onPlay = true, handSize } = {}) {
    const hand = handSize ?? format.openingHand ?? 7;
    const t = Math.max(0, Math.floor(Number(turn) || 0));
    if (t === 0) return hand;
    const skipsFirstDraw = onPlay && !format.firstPlayerDraws;
    return hand + t - (skipsFirstDraw ? 1 : 0);
}
