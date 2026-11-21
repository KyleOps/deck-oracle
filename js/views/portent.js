/**
 * Portent of Calamity — view.
 * Mounted into #portent-tab by the shell the first time the page is opened;
 * js/calculators/portent.js fills the containers.
 */

import { injectSharedStyles, xControlHTML } from '../utils/bigSpells.js';

injectSharedStyles();

export const template = `
<div class="main-grid single-column bs-page">
    <section class="panel panel-config" aria-label="Settings">
        ${xControlHTML({
            key: 'portent',
            value: 7,
            max: 30,
            presets: [5, 7, 9, 12, 15],
            costLabel: '8 mana · {X}{U}',
            hint: 'Portent reveals this many cards from the top of your library.'
        })}
        <div class="bs-field">
            <div class="bs-field-head">
                <span class="bs-label">Card types in your library</span>
                <span class="bs-cost" id="portent-n-label"></span>
            </div>
            <div class="por-typebar" id="portent-type-bar" aria-hidden="true"></div>
            <ul class="por-types" id="portent-type-grid" aria-label="Cards of each type"></ul>
            <p class="bs-hint">Portent needs four <strong>different</strong> card types among the cards it reveals. A card with two types, like an artifact creature, counts under both here but can fill only one of them.</p>
        </div>
    </section>

    <section class="panel bs-answer" id="portent-stats" aria-label="Answer"></section>

    <section class="panel" aria-labelledby="portent-chart-title">
        <div class="tx-h">
            <h2 class="bs-h" id="portent-chart-title">Free-spell chance by X</h2>
            <span class="tx-h-r bs-legend">
                <span class="bs-key k-accent">your X</span>
                <span class="bs-key is-line k-dim">9 in 10</span>
            </span>
        </div>
        <div class="bs-chart">
            <canvas id="portent-combinedChart" role="img" aria-label="Chance of a free spell for each value of X"></canvas>
        </div>
        <p class="tx-caption is-below">Each bar is the chance a cast exiles four or more cards at that X. Green bars clear 7 in 10, amber 4 in 10. Click a bar to try that X.</p>
    </section>

    <section class="panel" aria-labelledby="portent-reveal-header">
        <div class="tx-h">
            <h2 class="bs-h" id="portent-reveal-header">Sample casts</h2>
            <button class="btn btn-ghost btn-sm" type="button" id="portent-reshuffle-btn">Reshuffle</button>
        </div>
        <div class="bs-samples" id="portent-trials-container"></div>
        <p class="tx-caption is-below">Real shuffles of your list. Each card shows the type it was exiled for; the costliest spell is the one cast free.</p>
    </section>

    <section class="panel" aria-labelledby="portent-compare-title">
        <div class="tx-h">
            <h2 class="bs-h" id="portent-compare-title">How it compares</h2>
            <span class="tx-h-r">same total mana</span>
        </div>
        <div id="big-spell-comparison-portent"><p class="bsc-empty">Comparing with the other big spells…</p></div>
    </section>

    <section class="panel bs-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Every X, side by side</summary>
            <div class="tx-collapse-body">
                <p class="tx-caption is-below">Your X is highlighted; the marked row is the cheapest X that gets the free spell 9 times in 10.</p>
                <div class="bs-table-wrap" id="portent-sweep"></div>
            </div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">How many cards you keep <span class="bs-sub" id="portent-dist-sub"></span></summary>
            <div class="tx-collapse-body" id="portent-dist"></div>
        </details>
    </section>
</div>
`;

export const styles = `
#portent-tab .por-typebar { display: flex; gap: 2px; height: 8px; border-radius: var(--radius-full); overflow: hidden; background: var(--tx-rule); }
#portent-tab .por-typebar > span { min-width: 3px; }
#portent-tab .por-types { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 4px 18px; }
#portent-tab .por-types li { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: var(--t-xs); color: var(--tx-mid); }
#portent-tab .por-type-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#portent-tab .por-type-n { font-family: var(--font-mono); color: var(--tx-bright); text-align: right; }
`;

export const guide = {
    intro: 'Portent of Calamity reveals the top X cards and exiles one of each card type it finds. Exile four or more and you may cast one of them free; everything exiled that you don’t cast goes to your hand. This page tells you how often that free spell happens at each X with your list, and how many cards you walk away with.',
    howToRead: [
        '<strong>Free-spell chance</strong> is how often a cast exiles four or more cards — one creature, one land, one artifact, and so on.',
        '<strong>Cards you keep</strong> is the average number exiled: you keep all of them, one as the free spell when you get it.',
        'The <strong>chart</strong> shows the free-spell chance at every X. Click a bar to move your X there.',
        '<strong>Sample casts</strong> are real shuffles of your list: green cards are kept, the starred one is cast free, dimmed ones go to the graveyard.',
        '<strong>How it compares</strong> puts Portent beside Genesis Wave, Kamahl’s Druidic Vow and Primal Surge at the same total mana.'
    ],
    method: 'Simulation: your library is shuffled 25,000 times and the top 30 cards are revealed one at a time. After each card the page works out the most cards Portent could exile so far — a card with two types (an artifact creature) can be exiled for only one of them, so it solves a small matching problem rather than just counting types. One pass gives the answer for every X at once, and the results are cached per deck, so moving the slider is instant. Expect the percentages to wobble by about half a point between decks.',
    assumptions: [
        'Your library is the full decklist, shuffled — cards already drawn or played are not removed, and the Portent you are casting is not taken out.',
        'You always exile as many cards as you can, and the free spell is the costliest one exiled.',
        'The eight card types are creature, artifact, enchantment, planeswalker, battle, land, instant and sorcery. Kindred is ignored.',
        'Double-faced cards count as their front face, which is what they are in your library.',
        'With only card-type counts (no imported list) every card is treated as having a single type.'
    ],
    tips: [
        'Four types is the bar, so the cheapest wins come from spreading your nonland cards across creature, instant, sorcery, artifact and enchantment rather than piling into one.',
        'Lands count as a type — almost every reveal finds one — so you really need three more nonland types.',
        'Artifact creatures and other dual-typed cards are flexible but can only fill one slot each; they help less than their two types suggest.'
    ],
    terms: ['simulation', 'sample', 'mv', 'library']
};
