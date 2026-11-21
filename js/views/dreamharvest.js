/**
 * Dream Harvest — view.
 * Mounted into #dreamharvest-tab by the shell; js/calculators/dreamharvest.js
 * renders into the two panels.
 */

import { opponentPageStyles } from '../utils/opponentPages.js';

export const template = `
<div class="main-grid single-column">
    <section class="panel" id="dreamharvest-results" aria-label="What Dream Harvest steals"></section>
    <section class="panel" id="dreamharvest-sample-reveals" aria-label="Sample casts" hidden></section>
</div>
`;

export const styles = `
${opponentPageStyles('#dreamharvest-tab')}
#dreamharvest-tab .dh-game-row {
    display: grid;
    grid-template-columns: minmax(150px, 0.8fr) 150px minmax(0, 2.4fr);
    gap: 16px;
    align-items: start;
}
#dreamharvest-tab .dh-game-who { min-width: 0; padding-top: 1px; }
#dreamharvest-tab .dh-game-result {
    padding-top: 2px;
    font-family: var(--font-mono); font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright);
    white-space: nowrap;
}
@container shell (max-width: 760px) {
    #dreamharvest-tab .dh-game-row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding-bottom: 6px; }
    #dreamharvest-tab .dh-game-row .opp-flow { grid-column: 1 / -1; }
}
`;

export const guide = {
    intro: 'Dream Harvest makes each opponent exile cards from the top of their library until the exiled mana value reaches 5, then lets you cast those cards for free this turn. This page shows how many spells that gives you from each opponent’s real decklist, and what they are worth.',
    howToRead: [
        '<strong>Mana stolen</strong> is the total mana value of the spells you can cast, added up across opponents. Each pile always reaches at least 5, so the per-opponent figure sits a little above 5 — the overshoot is the last card’s mana value.',
        '<strong>Spells stolen</strong> counts the nonland cards exiled. Lands are exiled too but count as 0 and can’t be cast.',
        '<strong>Usually</strong> is the middle half of outcomes: one cast in four lands below the range and one in four above it.',
        'The bars show how often each outcome happens, on the same scale for every opponent. <strong>Sample casts</strong> show real shuffles, card by card.'
    ],
    method: 'Simulation: each list is shuffled 20,000 times and Dream Harvest is resolved against it — only as many cards as the exile reaches are shuffled each time. The shuffles are seeded from the list itself, so the same deck always gives the same numbers.',
    assumptions: [
        'The whole imported list is treated as the library — cards already in hand, in play or in the graveyard are not removed.',
        'Every exiled nonland card counts as a spell you cast. In practice you need targets for some, and you still pay additional costs; X is 0.',
        'Modal double-faced cards count by their front face (a spell on the front can be cast). Lands count as 0 mana value.',
        'You have the whole turn to cast them — no limit on how many you can cast is modelled.'
    ],
    tips: [
        'Dream Harvest scales with the number of opponents: against three opponents it usually steals well over twice its own cost.',
        'Decks with many lands and cheap spells hand over more, smaller spells; decks full of expensive spells often hand over one big one.',
        'Cast it with mana to spare for additional costs and with a plan for the creatures you steal — they enter under your control.'
    ],
    terms: ['simulation', 'mv', 'library', 'sample']
};
