/**
 * Ensnared by the Mara — view.
 * Mounted into #mara-tab by the shell; js/calculators/mara.js renders into the
 * two panels.
 */

import { injectOpponentPageStyles } from '../utils/opponentPages.js';

injectOpponentPageStyles();

export const template = `
<div class="main-grid single-column opp-page">
    <section class="panel" id="mara-results" aria-label="What each choice is worth"></section>
    <section class="panel" id="mara-sample-reveals" aria-label="Sample casts" hidden></section>
</div>
`;

export const styles = `
#mara-tab .mara-game-cols,
#mara-tab .mara-game-row {
    display: grid;
    grid-template-columns: minmax(150px, 0.8fr) minmax(0, 1.2fr) minmax(0, 1.2fr);
    gap: 16px;
    align-items: start;
}
#mara-tab .mara-game-cols {
    padding: 0 16px 8px;
    font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label);
    text-transform: uppercase; color: var(--tx-dim);
}
#mara-tab .mara-game-who { min-width: 0; padding-top: 1px; }
#mara-tab .mara-game-opt { min-width: 0; display: grid; gap: 6px; }
#mara-tab .mara-game-result { font-family: var(--font-mono); font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
@container shell (max-width: 760px) {
    #mara-tab .mara-game-cols { display: none; }
    #mara-tab .mara-game-row { grid-template-columns: minmax(0, 1fr); gap: 6px; padding-bottom: 6px; }
    #mara-tab .mara-game-opt::before {
        content: attr(data-label); display: block; margin-bottom: 4px;
        font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label);
        text-transform: uppercase; color: var(--tx-dim);
    }
}
`;

export const guide = {
    intro: 'Ensnared by the Mara makes each opponent choose: hand you the first nonland card off the top of their library to cast for free, or take damage equal to the total mana value of their top four cards. This page works out what each option is worth against your opponents’ real decklists.',
    howToRead: [
        '<strong>Free spell</strong> is the average mana value of the card you would cast if an opponent picks the spell. Every nonland card in their library is equally likely to be that card, so it is simply the average cost of their spells.',
        '<strong>Damage</strong> is the average total mana value of their top four cards. Lands count as 0, so land-heavy decks hit softly.',
        '<strong>Usually</strong> is the middle half of outcomes: one cast in four lands below the range and one in four above it.',
        'The bars show how often each outcome happens, drawn on the same scale for every opponent. <strong>Sample casts</strong> are real shuffles — both options come from the same shuffle, but an opponent only ever gets one.'
    ],
    method: 'Exact. The free spell is a uniformly random nonland card from the library, so its odds are just the share of each mana value among their spells. The damage odds count every possible set of four top cards, drawn without replacement. Nothing is simulated except the sample casts.',
    assumptions: [
        'Each opponent chooses before anything is revealed. The page shows both options; it does not guess which one they will pick.',
        'The whole imported list is treated as the library — cards already in hand, in play or in the graveyard are not removed.',
        'Modal double-faced cards count by their front face (a spell on the front is a nonland card). X in a mana cost counts as 0.',
        'You may cast the free spell right away whatever its type, but you still pay any additional costs, and X is 0.'
    ],
    tips: [
        'Damage is the real threat late in the game. An opponent within reach of their own “big hit” number may have to hand you the spell instead.',
        'With three opponents, Mara usually pays for itself even if everyone hands you a spell — the damage is the upside.',
        'Lists full of lands and cheap spells shrink both options; lists of expensive spells make both options better for you.'
    ],
    terms: ['exact', 'mv', 'library', 'sample']
};
