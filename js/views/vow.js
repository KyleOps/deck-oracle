/**
 * Kamahl's Druidic Vow — view.
 * Mounted into #vow-tab by the shell the first time the page is opened;
 * js/calculators/vow.js fills the containers.
 */

import { sharedStyles, valueModelHTML, xControlHTML } from '../utils/bigSpells.js';

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        ${xControlHTML({
            key: 'vow',
            value: 7,
            max: 30,
            presets: [5, 7, 10, 12, 15],
            costLabel: '9 mana · {X}{G}{G}',
            label: 'Cards looked at (X)',
            hint: 'The Vow looks at X cards and puts every land and legendary permanent with mana value X or less onto the battlefield.'
        })}
        <div class="bs-field">
            <label class="bs-check" for="vow-doubleCast">
                <input type="checkbox" id="vow-doubleCast">
                <span>
                    <span class="bs-label">Copied — cast twice</span><br>
                    <span class="bs-hint">The Sixth Doctor, Magus Lucea Kane and other copy effects. The copy has the same X and looks at the next X cards. Ticked automatically for The Sixth Doctor.</span>
                </span>
            </label>
        </div>
        ${valueModelHTML({
            intro: 'A cast pays for itself when what it puts onto the battlefield is worth the mana you spent — <strong id="vow-payback-target">9 value at X=7</strong>. Value is each card’s mana value plus these credits:',
            fields: [
                { id: 'vow-land-value', label: 'Extra value per land', hint: 'Lands have mana value 0, but each is a land drop you didn’t have to make.', value: 1 },
                { id: 'vow-card-value', label: 'Value per permanent', hint: 'Credit for every card put into play, on top of its mana value.', value: 0.25 }
            ]
        })}
    </section>

    <section class="panel bs-answer" id="vow-stats" aria-label="Answer"></section>

    <section class="panel" aria-labelledby="vow-chart-title">
        <div class="tx-h">
            <h2 class="bs-h" id="vow-chart-title">What each X gets you</h2>
            <span class="tx-h-r bs-legend">
                <span class="bs-key k-flat">lands &amp; legends</span>
                <span class="bs-key is-line k-good">pays for itself</span>
            </span>
        </div>
        <div class="bs-chart">
            <canvas id="vow-chart" role="img" aria-label="Lands and legends put into play, and payback chance, for each value of X"></canvas>
        </div>
        <p class="bs-caption">Bars: average lands and legendary permanents put onto the battlefield (left axis). Line: the chance that cast pays for itself (right axis). Your X is highlighted — click a bar to try another.</p>
    </section>

    <section class="panel" aria-labelledby="vow-samples-title">
        <div class="tx-h">
            <h2 class="bs-h" id="vow-samples-title">Sample casts</h2>
            <button class="btn btn-ghost btn-sm" type="button" id="vow-reshuffle-btn">Reshuffle</button>
        </div>
        <div class="bs-samples" id="vow-samples"></div>
        <p class="bs-caption">Real shuffles of your list. Lands and legends that go into play are bright (legends highlighted); everything else goes to the graveyard.</p>
    </section>

    <section class="panel" aria-labelledby="vow-compare-title">
        <div class="tx-h">
            <h2 class="bs-h" id="vow-compare-title">How it compares</h2>
            <span class="tx-h-r">same total mana</span>
        </div>
        <div id="big-spell-comparison"><p class="bsc-empty">Comparing with the other big spells…</p></div>
    </section>

    <section class="panel bs-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Every X, side by side</summary>
            <div class="tx-collapse-body">
                <p class="bs-caption">Hit rate is the share of cards looked at that go into play. The marked row is the cheapest X that pays for itself 3 times in 4.</p>
                <div class="bs-table-wrap" id="vow-comparisonTable"></div>
            </div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">How many hits <span class="bs-sub" id="vow-dist-sub"></span></summary>
            <div class="tx-collapse-body" id="vow-dist"></div>
        </details>
    </section>
</div>
`;

export const styles = sharedStyles('#vow-tab');

export const guide = {
    intro: 'Kamahl’s Druidic Vow looks at the top X cards and puts every land and legendary permanent with mana value X or less onto the battlefield; the rest go to the graveyard. This page shows how many it hits with your list at each X, and how often that is worth the X + 2 mana.',
    howToRead: [
        '<strong>Pays for itself</strong> is the chance the value put into play reaches the mana spent. Value is each card’s mana value plus the land and per-permanent credits on the left.',
        '<strong>Lands &amp; legends</strong> is the average number put onto the battlefield, split into lands and legendary permanents.',
        'The <strong>chart</strong> shows both at every X: bars for hits, the line for payback. Click a bar to try that X.',
        'Tick <strong>Copied</strong> if your commander or another effect copies the Vow — the copy looks at the next X cards, so twice as many are seen.',
        '<strong>How it compares</strong> puts the Vow beside Genesis Wave, Primal Surge and Portent of Calamity at the same total mana.'
    ],
    method: 'Exact, no simulation. Hits among the cards looked at are hypergeometric — drawing without replacement from your real counts of lands and legendary permanents at each mana value. The payback chance is an exact count over every possible set of cards seen, scoring each with the value model in quarter-mana steps. Results are cached per deck and setting.',
    assumptions: [
        'The Vow is a legendary sorcery: you need a legendary creature or planeswalker to cast it. The page assumes you have one.',
        'Your library is the full decklist, shuffled — cards already drawn or played are not removed, and the Vow itself is not taken out.',
        'Every land and eligible legend is put onto the battlefield. A legendary land counts as a land.',
        'When copied, both copies use the same X and together look at 2X different cards.',
        'With card-type counts only, the page can’t tell which permanents are legendary, so it counts lands alone.'
    ],
    tips: [
        'Lands are free hits at any X, so the Vow is never a blank in a land-heavy deck — the legends are what make it pay off.',
        'Cheap legends hit at every X; expensive ones only once X reaches their mana value, so a low legendary curve makes small Vows count.',
        'If Genesis Wave out-performs the Vow in “How it compares”, most of your permanents probably aren’t legendary.'
    ],
    terms: ['exact', 'hypergeometric', 'payback', 'mv', 'sample']
};
