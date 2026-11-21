/**
 * Primal Surge — view.
 * Mounted into #surge-tab by the shell the first time the page is opened;
 * js/calculators/surge.js fills the containers.
 */

import { sharedStyles, valueModelHTML } from '../utils/bigSpells.js';

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        <div class="bs-field">
            <div class="bs-field-head">
                <span class="bs-label">Primal Surge</span>
                <span class="bs-cost">10 mana · {8}{G}{G}</span>
            </div>
            <p class="bs-hint">No X to choose: it keeps putting permanents into play until it exiles an instant or sorcery. What changes the answer is your deck — and what you count as a good result.</p>
        </div>
        ${valueModelHTML({
            intro: 'A run pays for itself when its value reaches the target below. Value is each permanent’s mana value plus these credits.',
            fields: [
                { id: 'surge-payback-threshold', label: 'Pays for itself at', hint: 'Primal Surge costs 10. Raise this if a run has to do more than replace its mana.', value: 10, min: 0.25, max: 100 },
                { id: 'surge-land-value', label: 'Extra value per land', hint: 'Lands have mana value 0, but each is a land drop you didn’t have to make.', value: 1 },
                { id: 'surge-card-value', label: 'Value per permanent', hint: 'Credit for every card put into play, on top of its mana value.', value: 0.25 }
            ],
            footer: 'Example: five lands and three 1-drops = 3 mana value + 5 for lands + 2 for eight permanents = <strong>10 value</strong>.'
        })}
    </section>

    <section class="panel bs-answer" id="surge-stats" aria-label="Answer"></section>

    <section class="panel" aria-labelledby="surge-dots-title">
        <div class="tx-h">
            <h2 class="bs-h" id="surge-dots-title">Out of 100 casts</h2>
            <div class="seg seg-sm" role="group" aria-label="Stack the casts by" id="surge-dots-view">
                <button class="seg-btn active" type="button" data-surge-view="permanents" aria-pressed="true">Permanents</button>
                <button class="seg-btn" type="button" data-surge-view="value" aria-pressed="false">Value</button>
            </div>
        </div>
        <div id="surge-dots"></div>
        <p class="bs-caption" id="surge-dots-caption"></p>
    </section>

    <section class="panel" aria-labelledby="surge-chart-title">
        <div class="tx-h">
            <h2 class="bs-h" id="surge-chart-title">If you ran more or fewer instants and sorceries</h2>
            <span class="tx-h-r bs-legend">
                <span class="bs-key k-flat">permanents</span>
                <span class="bs-key is-line k-good" data-payback-key>pays for itself</span>
            </span>
        </div>
        <div class="bs-chart">
            <canvas id="surge-chart" role="img" aria-label="Permanents and payback chance for different numbers of instants and sorceries"></canvas>
        </div>
        <p class="bs-caption">Each bar keeps your permanents exactly as they are and changes only how many instants and sorceries share the library. Your deck is highlighted.</p>
    </section>

    <section class="panel" aria-labelledby="surge-samples-title">
        <div class="tx-h">
            <h2 class="bs-h" id="surge-samples-title">Sample casts</h2>
            <button class="btn btn-ghost btn-sm" type="button" id="surge-reshuffle-btn">Reshuffle</button>
        </div>
        <div class="bs-samples" id="surge-samples"></div>
        <p class="bs-caption">Real shuffles of your list, without the Primal Surge being cast. Each run ends at the dimmed card that stops it.</p>
    </section>

    <section class="panel" aria-labelledby="surge-compare-title">
        <div class="tx-h">
            <h2 class="bs-h" id="surge-compare-title">How it compares</h2>
            <span class="tx-h-r">same total mana</span>
        </div>
        <div id="big-spell-comparison-surge"><p class="bsc-empty">Comparing with the other big spells…</p></div>
    </section>
</div>
`;

export const styles = `
${sharedStyles('#surge-tab')}
`;

export const guide = {
    intro: 'Primal Surge exiles the top card of your library and, if it’s a permanent, puts it onto the battlefield — then repeats until it exiles an instant or sorcery. This page shows how far that gets with your list, and how often the run is worth the 10 mana.',
    howToRead: [
        '<strong>Pays for itself</strong> is the chance a run’s value reaches your target. Value is each permanent’s mana value plus the land and per-permanent credits on the left.',
        '<strong>Permanents</strong> is the average run length; the median under it (“half the time … or fewer”) is the more honest typical cast, because a few huge runs pull the average up.',
        '<strong>Out of 100 casts</strong> shows every outcome at once: each dot is one cast in a hundred, stacked by how many permanents it put into play (or, switched to <strong>Value</strong>, by what they were worth). Solid dots paid for themselves; rings fell short. Hover a column, or open “Exact chances”, for the numbers.',
        'The <strong>chart</strong> is a deck-building what-if: the same permanents with more or fewer instants and sorceries.',
        '<strong>How it compares</strong> puts Primal Surge beside the other big spells at 10 mana.'
    ],
    method: 'Exact, no simulation. The chance Surge gets at least k permanents deep is the chance the top k cards are all permanents — a product of draw-without-replacement fractions. Because a run of k permanents is an equally likely pick of any k of your permanents, the payback chance counts, for every run length, how many of those picks reach your value target (a subset-sum count in quarter-mana steps). The value view of the dots counts every pick at every total, so it is exact too; only the sample casts are random.',
    assumptions: [
        'The Primal Surge you are casting is on the stack, so it is removed from the library when your list names it. With card-type counts only, one instant or sorcery is assumed to be it.',
        'Your library is the full decklist, shuffled — cards already drawn or played are not removed.',
        'You put every permanent onto the battlefield; you never stop early on purpose.',
        'An instant or sorcery always stops the run. Double-faced cards count as their front face — a spell on the front stops it even if the back is a land.',
        'With card-type counts only, run lengths are exact but mana values are unknown, so payback isn’t shown.'
    ],
    tips: [
        'Every instant and sorcery you cut makes the average run longer — and the effect grows as you get close to zero.',
        'Permanents that do something the moment they enter (ramp, card draw, removal on a body) make a long run worth far more than its mana value suggests.',
        'If you want to keep a few interaction spells, prefer permanent-based answers: an enchantment or creature that removes something never stops the Surge.'
    ],
    terms: ['exact', 'payback', 'median', 'mv', 'sample']
};
