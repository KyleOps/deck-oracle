/**
 * Genesis Wave — view.
 * Mounted into #wave-tab by the shell the first time the page is opened;
 * js/calculators/wave.js fills the containers.
 */

import { sharedStyles, valueModelHTML, xControlHTML } from '../utils/bigSpells.js';

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        ${xControlHTML({
            key: 'wave',
            value: 7,
            max: 30,
            presets: [5, 7, 10, 12, 15],
            costLabel: '10 mana · {X}{G}{G}{G}',
            hint: 'Genesis Wave reveals X cards and puts every permanent with mana value X or less onto the battlefield.'
        })}
        ${valueModelHTML({
            intro: 'A cast pays for itself when what it puts onto the battlefield is worth the mana you spent — <strong id="wave-payback-target">10 value at X=7</strong>. Value is each permanent’s mana value plus these credits:',
            fields: [
                { id: 'wave-land-value', label: 'Extra value per land', hint: 'Lands have mana value 0, but each is a land drop you didn’t have to make.', value: 1 },
                { id: 'wave-card-value', label: 'Value per permanent', hint: 'Credit for every card put into play, on top of its mana value.', value: 0.25 }
            ]
        })}
    </section>

    <section class="panel bs-answer" id="wave-stats" aria-label="Answer"></section>

    <section class="panel" aria-labelledby="wave-chart-title">
        <div class="tx-h">
            <h2 class="bs-h" id="wave-chart-title">What each X gets you</h2>
            <span class="tx-h-r bs-legend">
                <span class="bs-key k-flat">permanents</span>
                <span class="bs-key is-line k-good" data-payback-key>pays for itself</span>
            </span>
        </div>
        <div class="bs-chart">
            <canvas id="wave-chart" role="img" aria-label="Permanents and payback chance for each value of X"></canvas>
        </div>
        <p class="bs-caption">Bars: average permanents put onto the battlefield (left axis). Line: the chance that cast pays for itself (right axis). Your X is highlighted — click a bar to try another.</p>
    </section>

    <section class="panel" aria-labelledby="wave-samples-title">
        <div class="tx-h">
            <h2 class="bs-h" id="wave-samples-title">Sample casts</h2>
            <button class="btn btn-ghost btn-sm" type="button" id="wave-reshuffle-btn">Reshuffle</button>
        </div>
        <div class="bs-samples" id="wave-samples"></div>
        <p class="bs-caption">Real shuffles of your list. Bright cards go onto the battlefield; dimmed ones cost more than X or aren’t permanents, and go to the graveyard.</p>
    </section>

    <section class="panel" aria-labelledby="wave-compare-title">
        <div class="tx-h">
            <h2 class="bs-h" id="wave-compare-title">How it compares</h2>
            <span class="tx-h-r">same total mana</span>
        </div>
        <div id="big-spell-comparison-wave"><p class="bsc-empty">Comparing with the other big spells…</p></div>
    </section>

    <section class="panel bs-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Every X, side by side</summary>
            <div class="tx-collapse-body">
                <p class="bs-caption">Hit rate is the share of revealed cards that are hits. The marked row is the cheapest X that pays for itself 3 times in 4.</p>
                <div class="bs-table-wrap" id="wave-comparisonTable"></div>
            </div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">How many permanents <span class="bs-sub" id="wave-dist-sub"></span></summary>
            <div class="tx-collapse-body" id="wave-dist"></div>
        </details>
    </section>
</div>
`;

export const styles = sharedStyles('#wave-tab');

export const guide = {
    intro: 'Genesis Wave reveals the top X cards and puts every permanent with mana value X or less onto the battlefield; the rest go to the graveyard. This page shows how much a cast puts into play with your list at each X, and how often that is worth the X + 3 mana you paid.',
    howToRead: [
        '<strong>Pays for itself</strong> is the chance the value put into play reaches the mana spent. Value is each permanent’s mana value plus the land and per-permanent credits you set on the left.',
        '<strong>Permanents</strong> is the average number put onto the battlefield, with the range 8 casts in 10 fall inside.',
        'The <strong>chart</strong> shows both at every X: bars for permanents, the line for payback. Click a bar to try that X.',
        '<strong>Sample casts</strong> are real shuffles of your list resolved at your X.',
        '<strong>How it compares</strong> puts Genesis Wave beside Kamahl’s Druidic Vow, Primal Surge and Portent of Calamity at the same total mana.'
    ],
    method: 'Exact, no simulation. The number of hits among X cards is hypergeometric — drawing without replacement from your real counts of permanents at each mana value. The payback chance is an exact count over every possible set of X cards, scoring each with the value model in quarter-mana steps. Results are cached per deck and setting, so the slider is instant.',
    assumptions: [
        'Your library is the full decklist, shuffled — cards already drawn or played are not removed, and the Genesis Wave you are casting is not taken out.',
        'Every eligible permanent is put onto the battlefield (you never choose to leave one behind).',
        'Mana value is the printed value; X in a permanent’s own cost counts as 0. Double-faced cards count as their front face.',
        'Value is a rough exchange rate, not the card’s real impact — tune the land and per-permanent credits to taste.',
        'With card-type counts only (no imported list) mana values are unknown, so every permanent is treated as cheap enough and payback is not shown.'
    ],
    tips: [
        'Every instant and sorcery is a blank for Genesis Wave; trading a few for permanents raises both the average and the payback odds.',
        'Cheap permanents are hits at any X, so a low curve makes small Waves reliable; big permanents only start hitting once X reaches their mana value.',
        'Compare the line at your usual mana: if payback climbs steeply over the next couple of X, holding the Wave a turn longer is often worth it.'
    ],
    terms: ['exact', 'hypergeometric', 'payback', 'mv', 'sample']
};
