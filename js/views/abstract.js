/**
 * Abstract Performance — view.
 * Mounted into #abstract-tab by the shell; rendered by js/calculators/abstract.js.
 * No inputs: the deck as built and the opponent models are the whole answer.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel ap-answer" aria-label="Answer">
        <div id="abstract-bottom-line"></div>
        <div id="abstract-hero"></div>
    </section>

    <section class="panel" aria-label="Free spell by opponent">
        <div class="tx-h"><span>The free spell, by how your opponent picks</span><span class="tx-h-r" id="abstract-chart-meta"></span></div>
        <div class="chart-container ap-chart">
            <canvas id="abstract-chart" role="img" aria-label="Share of casts by the mana value of the free spell, for three kinds of opponent"></canvas>
        </div>
        <p class="ap-caption">How often each mana value is the best spell in the pile you keep. Amber is the realistic opponent, who sees only the face-up pile; red and green are an opponent who always picks right or always picks wrong.</p>
    </section>

    <section class="panel" aria-label="Sample casts">
        <div class="tx-h">
            <span>Sample casts</span>
            <button type="button" class="btn btn-ghost btn-sm" id="abstract-reshuffle-btn">Deal again</button>
        </div>
        <div class="ap-samples" id="abstract-samples"></div>
    </section>

    <section class="panel ap-details" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Free spell by mana value</summary>
            <div class="tx-collapse-body ap-flush" id="abstract-breakdown"></div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Your library by mana value</summary>
            <div class="tx-collapse-body" id="abstract-cmc-curve"></div>
        </details>
    </section>
</div>
`;

export const styles = `
#abstract-tab .ap-answer .tx-hero { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); border-bottom: 0; }
#abstract-tab .ap-answer .bottom-line { border-bottom: 1px solid var(--tx-rule); }

#abstract-tab .ap-chart { height: 300px; }
#abstract-tab .ap-caption {
    margin: 0;
    padding: 0 16px 14px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--tx-dim);
}
#abstract-tab .tx-collapse-body .ap-caption { padding: 0 0 10px; }

#abstract-tab .ap-samples {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 12px;
    padding: 14px 16px 16px;
}
#abstract-tab .ap-sample {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-md);
    background: var(--tx-panel-alt);
}
#abstract-tab .ap-sample-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
    font-size: var(--t-sm);
}
#abstract-tab .ap-sample-n { font-size: var(--t-xs); font-weight: 600; color: var(--tx-dim); }
#abstract-tab .ap-sample-cast.is-good { color: var(--tx-text); }
#abstract-tab .ap-sample-cast.is-bad { color: var(--tx-bad); }
#abstract-tab .ap-mv {
    margin-left: 4px;
    padding: 0 6px;
    border-radius: var(--radius-xs);
    background: var(--good-soft);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--tx-good);
}
#abstract-tab .ap-piles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
#abstract-tab .ap-pile {
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-sm);
    background: var(--tx-panel);
}
#abstract-tab .ap-pile.is-kept { border-color: var(--tx-good); }
/* Muted, not faded: opacity took the binned pile below readable contrast. */
#abstract-tab .ap-pile.is-binned { border-style: dashed; background: transparent; }
#abstract-tab .ap-pile-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
}
#abstract-tab .ap-pile.is-kept .ap-pile-fate { color: var(--tx-good); }
#abstract-tab .ap-pile-cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
}
#abstract-tab .ap-x {
    margin-left: 6px;
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-warn);
}
#abstract-tab .ap-card {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 6px;
    margin: 0 -6px;
    border-radius: var(--radius-xs);
    font-size: var(--t-xs);
    color: var(--tx-text);
}
#abstract-tab .ap-card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#abstract-tab .ap-card-mv { font-family: var(--font-mono); color: var(--tx-mid); font-feature-settings: 'tnum' 1; }
#abstract-tab .ap-card.is-land .ap-card-mv { color: var(--type-land); }
#abstract-tab .ap-card.is-cast { background: var(--good-soft); }
#abstract-tab .ap-card.is-cast .ap-card-mv { color: var(--tx-good); font-weight: 600; }
#abstract-tab .ap-why { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); }

#abstract-tab .ap-details .tx-collapse:first-child { border-top: 0; }
#abstract-tab .ap-flush { padding: 0; }

@container shell (max-width: 520px) {
    #abstract-tab .ap-piles { grid-template-columns: minmax(0, 1fr); }
}

/* Phones: two sample casts — each stacks both piles at this width. */
@container shell (max-width: 640px) {
    #abstract-tab .ap-sample:nth-child(n + 3) { display: none; }
}
`;

export const guide = {
    intro: 'Abstract Performance exiles two piles of four from the top of your library — one face down, one face up. An opponent picks one to send to your graveyard; you cast the best spell from the other for free and put the rest into your hand. This page shows what that free spell usually is in your deck, depending on how well your opponent picks.',
    howToRead: [
        '<strong>Typical free spell</strong> is the mana value of the best spell in the pile you keep, against a realistic opponent. The range under it covers the middle half of casts.',
        '<strong>If they pick right</strong> and <strong>if they pick wrong</strong> are the averages against an opponent who always bins your better pile, or always bins the worse one — the floor and ceiling of the card.',
        '<strong>Nothing to cast</strong> is how often the pile you keep has no spell in it.',
        'Sample casts deal real piles from your list and show which one the realistic opponent bins and why.'
    ],
    method: '25,000 simulated casts. Each deals two piles of four from a shuffled copy of your library. “Better” means more total mana value. The realistic opponent sees only the face-up pile: if it totals more than an average four cards from your deck they bin it (you keep the face-down pile); otherwise they bin the face-down pile and leave you the face-up one. The free spell is the highest-mana-value nonland card in the pile you keep. Simulated once per deck.',
    assumptions: [
        'Opponents judge piles by total mana value. Real opponents also weigh what the cards do — a pile with your combo piece goes to the graveyard whatever its mana value.',
        'You always cast the highest-mana-value spell in the kept pile; the other cards go to your hand.',
        'The library is your whole decklist; cards in hand or on the battlefield are not removed.',
        'X spells count at their mana value with X = 0. Free spells of mana value 10 or more are grouped as “10+” in the chart.'
    ],
    tips: [
        'The realistic opponent’s best move is to bin a strong face-up pile, so your result leans on the face-down pile: a deck with fewer lands and cheap spells makes both piles better.',
        'Big spells you can’t otherwise afford are the best outcome — Abstract Performance doesn’t care about the free spell’s cost.'
    ],
    terms: ['simulation', 'p50', 'ev', 'mv', 'library']
};
