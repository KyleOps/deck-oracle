/**
 * Lumra, Bellow of the Woods — view.
 * Mounted into #lumra-tab by the shell; rendered by js/calculators/lumra.js.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        <div class="tx-h"><span>When you cast it</span></div>
        <div class="input-group lm-input">
            <label for="lumra-turn">Turn Lumra enters</label>
            <div class="x-slider-row">
                <input type="range" id="lumra-turnSlider" value="6" min="1" max="20" step="1" aria-label="Turn Lumra enters">
                <input type="number" id="lumra-turn" value="6" min="1" max="30" class="field field-sm x-number" inputmode="numeric">
            </div>
            <small>Sets how many land drops you have made: a seven-card hand plus one draw a turn, one land a turn when you have one.</small>
        </div>

        <div class="tx-h"><span>Your graveyard</span></div>
        <div class="input-group lm-input">
            <label for="lumra-fetchLands">Fetch lands in your deck</label>
            <input type="number" id="lumra-fetchLands" value="0" min="0" max="100" step="1" class="field field-sm x-number" inputmode="numeric">
            <small id="lumra-fetch-hint">Detected from your decklist.</small>
        </div>
        <div class="input-group lm-input">
            <label for="lumra-gyLands">Other lands already in your graveyard</label>
            <div class="x-slider-row">
                <input type="range" id="lumra-gySlider" value="0" min="0" max="30" step="1" aria-label="Other lands already in your graveyard">
                <input type="number" id="lumra-gyLands" value="0" min="0" max="100" class="field field-sm x-number" inputmode="numeric">
            </div>
            <small>Lands discarded, destroyed or milled earlier. Leave at 0 for the deck as built.</small>
        </div>

        <details class="tx-collapse lm-more">
            <summary class="tx-collapse-head">Extra enter triggers</summary>
            <div class="input-group lm-input">
                <label for="lumra-multiplier">Times the trigger resolves</label>
                <div class="x-slider-row">
                    <input type="range" id="lumra-multSlider" value="1" min="1" max="5" step="1" aria-label="Times Lumra’s enter trigger resolves">
                    <input type="number" id="lumra-multiplier" value="1" min="1" max="10" class="field field-sm x-number" inputmode="numeric">
                </div>
                <small>Panharmonicon, Roaming Throne and the like make Lumra mill four more cards per extra trigger.</small>
            </div>
        </details>
    </section>

    <section class="panel lm-answer" aria-label="Answer">
        <div id="lumra-bottom-line"></div>
        <div id="lumra-stats"></div>
        <div class="lm-sources" id="lumra-sources"></div>
    </section>

    <section class="panel" aria-label="Lumra’s size">
        <div class="tx-h"><span>How big Lumra enters</span><span class="tx-h-r">2,000 shuffles of your list</span></div>
        <div class="chart-container lm-chart">
            <canvas id="lumra-chart" role="img" aria-label="Share of games by Lumra’s power and toughness when it enters"></canvas>
        </div>
        <p class="tx-caption">Each bar is one size Lumra can enter as; the solid bar is the typical game. Land drops set the floor, the mill decides how far above it you land.</p>
    </section>

    <section class="panel" id="lumra-sample-reveals" aria-label="Sample games">
        <div class="tx-h">
            <span>Sample games</span>
            <button type="button" class="btn btn-ghost btn-sm" id="lumra-draw-reveals-btn">Shuffle again</button>
        </div>
        <div id="lumra-reveals-display"></div>
    </section>

    <section class="panel lm-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">By the turn you cast it</summary>
            <div class="tx-collapse-body lm-flush"><div id="lumra-turn-table"></div></div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Lands milled, exact odds</summary>
            <div class="tx-collapse-body" id="lumra-mill-dist"></div>
        </details>
    </section>
</div>
`;

export const styles = `
#lumra-tab .lm-input { padding-top: 14px; }
#lumra-tab .lm-input small { line-height: 1.5; }
#lumra-tab .lm-more { margin-top: 4px; }
#lumra-tab .lm-more .tx-collapse-head { background: transparent; }

#lumra-tab .lm-answer .bottom-line { border-bottom: 1px solid var(--tx-rule); }

#lumra-tab .lm-sources { padding: 14px var(--pad-x) 16px; }
#lumra-tab .lm-band {
    display: flex;
    height: 12px;
    overflow: hidden;
    border-radius: var(--radius-full);
    background: var(--tx-rule);
}
#lumra-tab .lm-band-seg { height: 100%; transition: width var(--transition-slow); }
#lumra-tab .lm-band-seg + .lm-band-seg { box-shadow: inset 2px 0 0 var(--tx-panel); }
#lumra-tab .is-drops { background: var(--type-land); }
#lumra-tab .is-gy { background: var(--series-3); }
#lumra-tab .is-fetch { background: var(--series-6); }
#lumra-tab .is-mill { background: var(--tx-good); }
#lumra-tab .lm-legend-total { margin-left: auto; color: var(--tx-text); }
#lumra-tab .lm-swatch { width: 10px; height: 10px; border-radius: 3px; }

#lumra-tab .lm-chart { height: 280px; }
#lumra-tab .tx-collapse-body .tx-caption { padding: 0 0 10px; }

#lumra-tab .lm-games { display: grid; padding: 4px 16px 0; }
#lumra-tab .lm-game { padding: 10px 0; border-bottom: 1px solid var(--tx-rule); }
#lumra-tab .lm-game:last-child { border-bottom: 0; }
#lumra-tab .lm-game-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--tx-mid);
}
#lumra-tab .lm-game-size { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--tx-good); }
#lumra-tab .lm-game-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: var(--t-xs);
    color: var(--tx-dim);
}
#lumra-tab .lm-mills { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
#lumra-tab .lm-mill {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 3px 9px;
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-sm);
    background: var(--tx-panel-alt);
    color: var(--tx-mid);
}
#lumra-tab .lm-mill.is-land {
    border-color: var(--type-land);
    background: var(--good-soft);
    color: var(--tx-text);
}
#lumra-tab .lm-game-back { margin-right: 10px; font-weight: 500; color: var(--tx-dim); }
#lumra-tab .lm-games + .tx-caption { padding-top: 10px; }

#lumra-tab .lm-details .tx-collapse:first-child { border-top: 0; }
#lumra-tab .lm-flush { padding: 0; }

@container shell (max-width: 1039.98px) {
    #lumra-tab .lm-answer { order: -1; }
}
`;

export const guide = {
    intro: 'Lumra’s power and toughness equal the lands you control, and when it enters it mills four cards and returns every land card in your graveyard to the battlefield. This page shows how big that makes Lumra in your deck on the turn you cast it, and where the lands come from.',
    howToRead: [
        '<strong>Lumra’s size</strong> is the typical game: your land drops by that turn plus everything the trigger returns. The range covers the middle half of games.',
        '<strong>Lands brought back</strong> adds the lands milled, the fetch lands you have cracked, and any other lands you said are already in your graveyard.',
        'The coloured band shows where the average Lumra’s lands come from.',
        'Sample games are real shuffles of your list played to the turn you chose; highlighted milled cards are lands that come back.'
    ],
    method: 'Averages are exact. Land drops by turn T are the expected value of “lands seen, capped at T” over a seven-card hand plus T draws (hypergeometric); lands milled use the same formula over the cards milled; fetch lands in the graveyard are the fetch lands expected among the cards seen, capped at one per turn. The size spread and sample games come from 2,000 shuffles of your decklist, made once per deck and re-read whenever you change a setting.',
    assumptions: [
        'One land drop a turn whenever you have one, and no other ramp — mana rocks and land searchers make Lumra bigger than shown.',
        'Every fetch land you play is cracked before Lumra enters. The land each one fetches is not removed from your library.',
        'Commander draws: a card every turn, including the first. On the play in a two-player game you will have seen one card fewer.',
        'Extra triggers each mill four more cards before returning lands.'
    ],
    tips: [
        'Fetch lands are free value here: each one cracked before Lumra comes back as an extra land.',
        'Self-mill and discard outlets turn the “other lands in your graveyard” setting into real numbers — try a few to see the payoff.'
    ],
    terms: ['exact', 'hypergeometric', 'simulation', 'p50', 'ev']
};
