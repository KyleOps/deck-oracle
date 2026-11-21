/**
 * Rashmi, Eternities Crafter — view.
 * Mounted into #rashmi-tab by the shell; rendered by js/calculators/rashmi.js.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        <div class="tx-h"><span>Your first spell this turn</span></div>
        <div class="input-group rs-input">
            <label for="rashmi-cmcValue">Its mana value</label>
            <div class="x-slider-row">
                <input type="range" id="rashmi-cmcSlider" value="5" min="1" max="15" step="1" aria-label="Mana value of the spell you cast">
                <input type="number" id="rashmi-cmcValue" value="5" min="1" max="15" class="field field-sm x-number" inputmode="numeric">
            </div>
            <small>Rashmi compares the revealed card with the spell that triggered it. An X spell counts its X — Genesis Wave for X = 7 is mana value 10.</small>
        </div>
        <div class="input-group rs-input" id="rashmi-x-group" hidden>
            <label class="rs-check">
                <input type="checkbox" id="rashmi-exclude-x">
                <span>Don’t count X spells as free spells</span>
            </label>
            <small id="rashmi-x-hint"></small>
        </div>
    </section>

    <section class="panel rs-answer" aria-label="Answer">
        <div id="rashmi-bottom-line"></div>
        <div id="rashmi-hero"></div>
        <div class="rs-split" id="rashmi-split" data-needs-deck></div>
    </section>

    <section class="panel" aria-label="Free-spell chance by mana value" data-needs-deck>
        <div class="tx-h"><span>Free-spell chance by the spell you cast</span></div>
        <div class="chart-container rs-chart">
            <canvas id="rashmi-chart" role="img" aria-label="Chance Rashmi flips a free spell for each mana value of the spell you cast"></canvas>
        </div>
        <p class="tx-caption">Each bar is one mana value for your first spell of the turn; the highlighted bar is the one you picked. Bars past the dashed line hit at least 7 times in 10.</p>
    </section>

    <section class="panel" id="rashmi-sample-reveals" aria-label="Sample reveals" data-needs-deck>
        <div class="tx-h">
            <span>Sample reveals</span>
            <button type="button" class="btn btn-ghost btn-sm" id="rashmi-draw-reveals-btn">Reveal again</button>
        </div>
        <div id="rashmi-reveals-display"></div>
    </section>

    <section class="panel rs-details" aria-label="More detail" data-needs-deck>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Your spells by mana value</summary>
            <div class="tx-collapse-body rs-flush">
                <div class="table-wrapper" id="rashmi-comparisonTable"></div>
                <p class="tx-caption rs-caption-pad" id="rashmi-curve-note"></p>
            </div>
        </details>
    </section>
</div>
`;

export const styles = `
#rashmi-tab .rs-input { padding-top: 14px; }
#rashmi-tab .rs-input small { line-height: 1.5; }
#rashmi-tab .rs-check {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--t-sm);
    color: var(--tx-text);
}
#rashmi-tab .rs-check input { width: auto; margin: 0; }

#rashmi-tab .rs-answer .tx-hero { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
#rashmi-tab .rs-answer .bottom-line { border-bottom: 1px solid var(--tx-rule); }

#rashmi-tab .rs-split { padding: 14px 16px 16px; }
#rashmi-tab .rs-band {
    display: flex;
    height: 12px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--tx-rule);
}
#rashmi-tab .rs-band-seg { height: 100%; transition: width var(--transition-slow); }
#rashmi-tab .rs-band-seg + .rs-band-seg { box-shadow: inset 2px 0 0 var(--tx-panel); }
#rashmi-tab .is-free { background: var(--tx-good); }
#rashmi-tab .is-big { background: var(--tx-flat); }
#rashmi-tab .is-x { background: var(--tx-warn); }
#rashmi-tab .is-land { background: var(--type-land); }
#rashmi-tab .rs-swatch { width: 10px; height: 10px; border-radius: 3px; }

#rashmi-tab .rs-chart { height: 280px; }
#rashmi-tab .rs-caption-pad { padding-top: 12px; }

#rashmi-tab .rs-reveals {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 14px 16px;
    list-style: none;
}
#rashmi-tab .rs-reveal {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "n card" "n verdict";
    column-gap: 10px;
    align-items: center;
    padding: 8px 10px;
    border: 1px solid var(--tx-rule);
    border-left-width: 3px;
    border-radius: var(--radius-sm);
    background: var(--tx-panel-alt);
}
#rashmi-tab .rs-reveal.is-free { background: var(--good-soft); border-color: var(--tx-good); }
#rashmi-tab .rs-reveal.is-big,
#rashmi-tab .rs-reveal.is-land,
#rashmi-tab .rs-reveal.is-x { background: var(--tx-panel-alt); }
#rashmi-tab .rs-reveal.is-big { border-left-color: var(--tx-flat); }
#rashmi-tab .rs-reveal.is-land { border-left-color: var(--type-land); }
#rashmi-tab .rs-reveal.is-x { border-left-color: var(--tx-warn); }
#rashmi-tab .rs-reveal-n {
    grid-area: n;
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-dim);
}
#rashmi-tab .rs-reveal-card {
    grid-area: card;
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    font-size: var(--t-sm);
}
#rashmi-tab .rs-reveal-card .card-ref { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#rashmi-tab .rs-reveal-mv {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#rashmi-tab .rs-reveal-verdict { grid-area: verdict; font-size: var(--t-xs); color: var(--tx-dim); }
#rashmi-tab .rs-reveal.is-free .rs-reveal-verdict { color: var(--tx-good); font-weight: 600; }
#rashmi-tab .rs-reveals + .tx-caption { padding-top: 0; }

#rashmi-tab .rs-details .tx-collapse { border-top: 0; }
#rashmi-tab .rs-flush { padding: 0; }
#rashmi-tab .rs-flush .tx-sweep-table td .tx-p-bar { margin-left: 8px; width: 70px; }

@container shell (max-width: 1039.98px) {
    #rashmi-tab .rs-answer { order: -1; }
}

@container shell (max-width: 640px) {
    #rashmi-tab .rs-reveals { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 12px; }
    #rashmi-tab .rs-reveal { grid-template-areas: "card card" "verdict verdict"; padding: 7px 8px; }
    #rashmi-tab .rs-reveal-n { display: none; }
    #rashmi-tab .rs-reveal-card { font-size: var(--t-xs); }
}
`;

export const guide = {
    intro: 'Whenever you cast your first spell each turn, Rashmi reveals the top card of your library. If it is a spell with lower mana value than the one you cast, you may cast it for free; otherwise it goes to your hand, so a miss is still a card. This page shows how often that free spell happens in your deck and what it is usually worth.',
    howToRead: [
        '<strong>Free-spell chance</strong> is the chance the top card is a nonland card with lower mana value than your first spell.',
        '<strong>Average free spell</strong> is the mana value of that card when it hits; <strong>free mana per trigger</strong> multiplies the two, so misses count as zero.',
        '<strong>Reliable from</strong> is the cheapest first spell that hits at least 7 times in 10.',
        'The coloured band splits your library into what the top card can be for the spell you picked.',
        'Sample reveals are random cards from your list. They stay put while you move the slider, so you can watch the same cards switch between free and to hand.'
    ],
    method: 'Exact. The top card of a shuffled library is equally likely to be any card in it, so the chance is the number of nonland cards below your spell’s mana value divided by your library size, and the average is their mean mana value.',
    assumptions: [
        'The library is your whole decklist; cards already drawn or played are not removed.',
        'Lands, and spells at or above your spell’s mana value, go to your hand.',
        'X spells in the library have X = 0, so a free X spell resolves for nothing much. Tick the box to stop counting them as free spells.',
        'Mana value is the printed value; split and double-faced cards use their front face.'
    ],
    tips: [
        'Rashmi rewards a curve with a high top end and plenty of cheap spells: the cheap ones are what the big ones flip.',
        'Lead with your biggest spell of the turn — an X spell for a large X counts its full X and lets almost every nonland through.'
    ],
    terms: ['exact', 'mv', 'ev', 'library']
};
