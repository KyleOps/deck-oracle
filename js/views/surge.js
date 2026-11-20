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

    <section class="panel" aria-labelledby="surge-odds-title">
        <div class="tx-h">
            <h2 class="bs-h" id="surge-odds-title">How far it gets</h2>
            <span class="tx-h-r">exact odds</span>
        </div>
        <div id="surge-odds"></div>
        <p class="bs-caption">The chance Primal Surge puts at least this many permanents onto the battlefield before an instant or sorcery stops it.</p>
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

    <section class="panel bs-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">How big the wins and misses are</summary>
            <div class="tx-collapse-body" id="surge-spread"></div>
        </details>
    </section>
</div>
`;

export const styles = `
${sharedStyles('#surge-tab')}
#surge-tab .srg-spread { padding: 0 18px 10px; }
#surge-tab .srg-spread .surge-range-band { border-radius: var(--radius-full); overflow: hidden; }
`;

export const guide = {
    intro: 'Primal Surge exiles the top card of your library and, if it’s a permanent, puts it onto the battlefield — then repeats until it exiles an instant or sorcery. This page shows how far that gets with your list, and how often the run is worth the 10 mana.',
    howToRead: [
        '<strong>Pays for itself</strong> is the chance a run’s value reaches your target. Value is each permanent’s mana value plus the land and per-permanent credits on the left.',
        '<strong>Permanents</strong> is the average run length; the median under it (“half the time … or fewer”) is the more honest typical cast, because a few huge runs pull the average up.',
        '<strong>How far it gets</strong> gives the exact chance of reaching 1, 3, 5, 10 or 20 permanents, or the whole library.',
        'The <strong>chart</strong> is a deck-building what-if: the same permanents with more or fewer instants and sorceries.',
        '<strong>How it compares</strong> puts Primal Surge beside the other big spells at 10 mana.'
    ],
    method: 'Exact, no simulation. The chance Surge gets at least k permanents deep is the chance the top k cards are all permanents — a product of draw-without-replacement fractions. Because a run of k permanents is an equally likely pick of any k of your permanents, the payback chance counts, for every run length, how many of those picks reach your value target (a subset-sum count in quarter-mana steps). The value spread at the bottom is the only simulated part.',
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
