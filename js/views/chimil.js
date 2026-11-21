/**
 * Chimil, the Inner Sun — view.
 * Mounted into #chimil-tab by the shell; rendered by js/calculators/chimil.js.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        <div class="tx-h"><span>Turns with Chimil out</span></div>
        <div class="ch-rail">
            <label class="ch-big" for="chimil-turnsSlider">
                <span id="chimil-turns-display" class="ch-big-num">10</span>
                <span class="ch-big-unit">of your end steps</span>
            </label>
            <input type="range" id="chimil-turnsSlider" value="10" min="1" max="20" step="1">
            <div class="ch-scale" aria-hidden="true"><span>1</span><span>20</span></div>
            <p class="ch-hint">How long Chimil survives. More end steps means more free spells — and a wider gap between good and bad games.</p>
        </div>

        <div class="tx-h"><span>Your deck</span><span class="tx-h-r">as built</span></div>
        <div class="ch-rail">
            <dl class="ch-facts">
                <div><dt>Cards discover can hit</dt><dd id="chimil-pool-display">—</dd></div>
                <div><dt>Share of your library</dt><dd id="chimil-share-display">—</dd></div>
                <div><dt>Cards skipped per discover</dt><dd id="chimil-dug-display">—</dd></div>
            </dl>
            <p class="ch-hint">Discover 5 hits nonland cards with mana value 5 or less. Lands and bigger spells are skipped and go to the bottom.</p>
        </div>
    </section>

    <section class="panel ch-answer" aria-label="Answer">
        <div id="chimil-bottom-line"></div>
        <div id="chimil-hero"></div>
    </section>

    <section class="panel" aria-labelledby="chimil-dots-title">
        <div class="tx-h"><h2 class="ch-h" id="chimil-dots-title">Out of 100 games</h2><span class="tx-h-r">2,000 simulated games</span></div>
        <div id="chimil-dots"></div>
        <p class="tx-caption">Each dot is one game in a hundred, stacked by the total mana of free spells Chimil cast. Solid dots earned back its own six mana; rings never did. Move the slider to see a shorter or longer game.</p>
    </section>

    <section class="panel" aria-label="Free mana by end step">
        <div class="tx-h"><span>Free mana by end step</span><span class="tx-h-r" id="chimil-chart-meta"></span></div>
        <div class="chart-container ch-chart">
            <canvas id="chimil-chart" role="img" aria-label="Total free mana Chimil has cast by each end step: typical game and the range of 8 games in 10"></canvas>
        </div>
        <p class="tx-caption">The line is the typical game; the shaded band holds 8 games in 10. Where the band clears the dashed line, Chimil has paid back its own six mana in almost every game.</p>
    </section>

    <section class="panel" id="chimil-sample-reveals" aria-label="Sample games">
        <div class="tx-h">
            <span>Sample games</span>
            <button type="button" class="btn btn-ghost btn-sm" id="chimil-draw-reveals-btn">Shuffle again</button>
        </div>
        <div id="chimil-reveals-display"></div>
    </section>

    <section class="panel ch-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">End step by end step</summary>
            <div class="tx-collapse-body ch-flush"><div id="chimil-sweepTable"></div></div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">What one discover finds</summary>
            <div class="tx-collapse-body" id="chimil-distribution"></div>
        </details>
    </section>
</div>
`;

export const styles = `
#chimil-tab .ch-rail { display: grid; gap: 10px; padding: 16px; }
#chimil-tab .ch-big { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
#chimil-tab .ch-big-num {
    font-family: var(--font-mono);
    font-size: var(--t-xxl);
    font-weight: 600;
    line-height: 1;
    color: var(--tx-bright);
    font-feature-settings: 'tnum' 1;
}
#chimil-tab .ch-big-unit { font-size: var(--t-sm); color: var(--tx-mid); }
#chimil-tab .ch-scale {
    display: flex;
    justify-content: space-between;
    margin-top: -4px;
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-dim);
}
#chimil-tab .ch-hint { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); }

#chimil-tab .ch-facts { display: grid; gap: 8px; margin: 0; }
#chimil-tab .ch-facts > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 6px;
    border-bottom: 1px dashed var(--tx-rule);
}
#chimil-tab .ch-facts dt { font-size: var(--t-xs); color: var(--tx-mid); }
#chimil-tab .ch-facts dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--tx-bright);
    font-feature-settings: 'tnum' 1;
    white-space: nowrap;
}
#chimil-tab .ch-facts-row {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px 24px;
    margin-bottom: 14px;
}

#chimil-tab .ch-h { margin: 0; font: inherit; color: inherit; letter-spacing: inherit; }
#chimil-tab .ch-chart { height: 300px; }
#chimil-tab .tx-collapse-body .tx-caption { padding: 0 0 10px; }
#chimil-tab .ch-caption-foot { padding-top: 10px; }
#chimil-tab .ch-key-small { color: var(--tx-warn); font-weight: 600; }

#chimil-tab #chimil-reveals-display { padding-top: 14px; }
#chimil-tab .ch-games { display: grid; padding: 0 16px; }
#chimil-tab .ch-game { padding: 10px 0; border-bottom: 1px solid var(--tx-rule); }
#chimil-tab .ch-game:last-child { border-bottom: 0; }
#chimil-tab .ch-game-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--tx-mid);
}
#chimil-tab .ch-game-total { font-family: var(--font-mono); font-feature-settings: 'tnum' 1; }
#chimil-tab .ch-game-total.is-good { color: var(--tx-good); }
#chimil-tab .ch-game-total.is-bad { color: var(--tx-bad); }
#chimil-tab .ch-game-hits {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}
#chimil-tab .ch-hit {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    max-width: 100%;
    padding: 4px 9px 4px 4px;
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-sm);
    background: var(--tx-panel-alt);
    font-size: var(--t-xs);
    color: var(--tx-text);
}
#chimil-tab .ch-hit .card-ref { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#chimil-tab .ch-hit-step {
    min-width: 18px;
    padding: 1px 4px;
    border-radius: var(--radius-xs);
    background: var(--tx-rule);
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    text-align: center;
    color: var(--tx-mid);
}
#chimil-tab .ch-hit-mv {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--tx-good);
    font-feature-settings: 'tnum' 1;
}
#chimil-tab .ch-hit-x {
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-warn);
}
#chimil-tab .ch-hit.is-small { border-color: var(--tx-warn); background: var(--warn-soft); }
#chimil-tab .ch-hit.is-small .ch-hit-mv { color: var(--tx-warn); }
#chimil-tab .ch-hit.is-miss { border-color: var(--tx-bad); background: var(--bad-soft); color: var(--tx-bad); }

#chimil-tab .ch-answer .tx-hero { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); border-bottom: 0; }
#chimil-tab .ch-answer .bottom-line { border-bottom: 1px solid var(--tx-rule); }

#chimil-tab .ch-details .tx-collapse:first-child { border-top: 0; }
#chimil-tab .ch-flush { padding: 0; }
#chimil-tab .ch-good { color: var(--tx-good); }
#chimil-tab .ch-dim { color: var(--tx-dim); }

#chimil-tab .ch-shown-narrow { display: none; }

/* Stacked layout: the answer leads, settings follow. */
@container shell (max-width: 1039.98px) {
    #chimil-tab .ch-answer { order: -1; }
}

/* Phones: three sample games — each wraps to many lines at this width. */
@container shell (max-width: 640px) {
    #chimil-tab .ch-game:nth-child(n + 4) { display: none; }
    #chimil-tab .ch-shown-wide { display: none; }
    #chimil-tab .ch-shown-narrow { display: inline; }
}
`;

export const guide = {
    intro: 'At the beginning of each of your end steps Chimil discovers 5: it exiles cards from the top of your library until it hits a nonland card with mana value 5 or less, and you cast that card for free. This page shows how much free mana that adds up to in your deck, how soon it repays Chimil’s own six mana, and what the hits actually look like.',
    howToRead: [
        '<strong>Each end step</strong> is the average mana value of the card one discover finds.',
        '<strong>Over N end steps</strong> is the total in a typical simulated game; the range under it covers the middle half of games.',
        '<strong>Paid off by end step</strong> is when the typical game has cast at least six mana of free spells — Chimil’s own cost.',
        '<strong>Cheap hits</strong> are free spells of mana value 2 or less — the hits that feel like a waste off a six-mana artifact. They are amber in the sample games.',
        '<strong>Out of 100 games</strong> shows the whole spread for your number of end steps: each dot is one game in a hundred, stacked by its total. Solid dots paid back Chimil’s six mana; rings did not. Hover a column for its share of games.',
        'In the chart, the line is the typical game and the shaded band holds 8 games in 10. Where the band clears the dashed line, Chimil has paid for itself in almost every game.'
    ],
    method: 'The per-end-step average is exact: in a random library the first eligible card is equally likely to be any eligible card, so its expected mana value is the average of all of them. Totals, ranges, payback and sample games come from 2,000 simulated games that shuffle your decklist and resolve discover end step by end step — the cast card leaves the library and the skipped cards go to the bottom in a random order, as printed. The games are simulated once per deck; moving the slider reads more or fewer end steps from the same games.',
    assumptions: [
        'Counts mana value cast, not board impact. Chimil does nothing the turn it lands, and a six-drop that affects the board at once can be worth more than the raw mana suggests.',
        'You always cast the discovered card, and nothing else draws, mills or shuffles your library between end steps.',
        'The library is your whole decklist; cards already in hand or on the battlefield are not removed.',
        'X spells count at their mana value with X = 0.'
    ],
    tips: [
        'The average only rises when you add eligible cards above it: mana dorks and cantrips at mana value 1–2 pull every discover down.',
        'Spells of mana value 6 or more are never hit. They only make each discover dig deeper, which costs you nothing but the order of your library.'
    ],
    terms: ['discover', 'simulation', 'p50', 'ev', 'mv']
};
