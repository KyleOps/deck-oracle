/**
 * Head to Head — view.
 * Mounted into #versus-tab by the shell the first time the page is opened;
 * every container below is filled by js/calculators/versus.js.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        <div class="tx-h"><span>Compare</span></div>
        <div class="vs-rail">
            <label class="vs-label" for="versus-engine-a">First engine</label>
            <select id="versus-engine-a" class="vs-select"></select>
            <button type="button" class="btn btn-ghost btn-sm vs-swap" id="versus-swap" aria-label="Swap the two engines">&#8645; Swap sides</button>
            <label class="vs-label" for="versus-engine-b">Second engine</label>
            <select id="versus-engine-b" class="vs-select"></select>
        </div>

        <div class="tx-h"><span>Variable power</span></div>
        <div class="vs-rail">
            <label class="vs-check">
                <input type="checkbox" id="versus-star-power">
                <span>Count <strong>*</strong> power as 5 or more</span>
            </label>
            <p class="field-hint">A */* creature is small in your library but often big as you cast it. Turn this on if yours will be &mdash; Vortex looks at the spell being cast.</p>
        </div>
    </section>

    <section class="panel" id="versus-scoreboard" aria-label="Which engine does more"></section>

    <section class="panel" id="versus-curve-panel" aria-label="Value by the mana value of the creature you cast">
        <div class="tx-h"><span>Value at each point in the game</span><span class="tx-h-r">by the mana value of the creature you cast</span></div>
        <div class="chart-container vs-chart">
            <canvas id="versus-curve-chart" role="img" aria-label="Average free mana per creature cast for each engine, by the cast creature's mana value"></canvas>
        </div>
        <div id="versus-recommendation"></div>
    </section>

    <section class="panel" id="versus-table-panel" aria-label="Creature by creature">
        <div class="tx-h"><span>Creature by creature</span><span class="tx-h-r" id="versus-table-count"></span></div>
        <div id="versus-table"></div>
    </section>

    <section class="panel vs-more-panel" id="versus-more-panel" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head" id="versus-peaks-summary">How the random engine’s results spread</summary>
            <div class="tx-collapse-body vs-flush" id="versus-peaks"></div>
        </details>
    </section>
</div>
`;

export const styles = `
/* ---- Rail ---- */
#versus-tab .vs-rail { padding: 16px; display: grid; gap: 8px; }
#versus-tab .vs-label { font-size: var(--t-xs); font-weight: 600; color: var(--tx-mid); }
#versus-tab .vs-select {
    height: 40px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    font-size: var(--t-sm);
}
#versus-tab .vs-swap { justify-self: start; }
#versus-tab .vs-check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: var(--t-sm);
    color: var(--tx-text);
    cursor: pointer;
}
#versus-tab .vs-check input { margin-top: 3px; accent-color: var(--tx-accent); }

/* ---- Scoreboard ---- */
#versus-tab .vs-side { padding: 16px 18px; gap: 0; }
#versus-tab .vs-side.is-leader { background: var(--tx-panel-alt); box-shadow: inset 0 2px 0 var(--tx-accent); }
#versus-tab .vs-side-top { display: flex; align-items: center; gap: 8px; min-height: 24px; }
#versus-tab .vs-side-name { display: inline-flex; align-items: center; gap: 8px; }
#versus-tab .vs-side-name::before {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--vs-engine, var(--tx-mid));
}
#versus-tab .vs-lead-chip {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--t-micro);
    font-weight: 600;
    color: var(--tx-accent);
    background: var(--accent-soft);
}
#versus-tab .vs-side-kind { font-size: var(--t-xs); color: var(--tx-dim); margin: 2px 0 12px; }
#versus-tab .vs-side-value { font-family: var(--font-mono); font-size: var(--t-xxl); }
#versus-tab .vs-side-unit {
    margin: 4px 0 12px;
    font-size: var(--t-xs);
    letter-spacing: 0;
    text-transform: none;
    color: var(--tx-mid);
}
#versus-tab .vs-side-rows { margin: 0; gap: 4px; }
#versus-tab .vs-side-rows > div { font-size: var(--t-sm); }
#versus-tab .vs-side-rows dt { color: var(--tx-dim); }
#versus-tab .vs-side-rows dd { margin: 0; color: var(--tx-text); font-family: var(--font-mono); font-size: var(--t-xs); }
#versus-tab .vs-mid { padding: 16px 20px; gap: 6px; }
#versus-tab .vs-mid-vs { font-size: var(--t-xs); letter-spacing: 0; color: var(--tx-dim); }
#versus-tab .vs-mid-tally { font-family: var(--font-mono); color: var(--tx-bright); }
#versus-tab .vs-mid-ties { display: block; }
#versus-tab .vs-mid-label {
    font-size: var(--t-xs);
    letter-spacing: 0;
    text-transform: none;
    line-height: 1.4;
}

/* ---- Chart ---- */
#versus-tab .vs-chart { height: 300px; padding: 8px 12px 0; }
#versus-tab .vs-note {
    margin: 0;
    padding: 10px 16px 14px;
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--tx-mid);
    text-wrap: pretty;
}
#versus-tab .vs-note strong { color: var(--tx-bright); font-family: var(--font-mono); }

/* ---- Creature table ---- */
#versus-tab .vs-val { color: var(--vs-engine, var(--tx-bright)); font-weight: 700; font-family: var(--font-mono); }
#versus-tab .vs-win { color: var(--vs-engine, var(--tx-bright)); font-weight: 600; }
#versus-tab .vs-detail { font-size: var(--t-label); }
#versus-tab .vs-detail .card-ref { color: var(--tx-mid); }

/* ---- Spread (collapsed) ---- */
#versus-tab .vs-more-panel .tx-collapse { border-top: 0; }
#versus-tab .vs-more-panel .tx-collapse-body { max-height: none; }
#versus-tab .vs-peaks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    border-bottom: 1px solid var(--tx-rule);
}
#versus-tab .vs-peak { padding: 14px 16px; }
#versus-tab .vs-peak-label { font-size: var(--t-label); letter-spacing: 0; text-transform: none; color: var(--tx-mid); }
#versus-tab .vs-peak-value { font-family: var(--font-mono); color: var(--tx-bright); }
#versus-tab .vs-peak-sub { font-size: var(--t-label); }
#versus-tab .tx-sim-block-title {
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: var(--tx-mid);
}
#versus-tab .vs-dists {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
    padding: 16px;
}
/* Fixed marker column, so a row with a marker keeps the same bar length. */
#versus-tab .dist-row { grid-template-columns: 76px minmax(0, 1fr) 48px 96px; }
#versus-tab .dist-marker { white-space: nowrap; }

@media (max-width: 720px) {
    #versus-tab .vs-mid-ties { display: inline; margin-left: 6px; }
    #versus-tab .vs-peak { border-right: 0; border-bottom: 1px solid var(--tx-rule); }
}
`;

export const guide = {
    intro: 'Wild Pair and Monstrous Vortex both pay you for casting creatures, in opposite ways. Wild Pair is a <strong>tutor</strong>: any creature you cast from hand lets you search for one with the same total power and toughness, so the result is certain but capped. Vortex is a <strong>discover</strong>: only power-5+ creatures trigger it, the result is random, and a big creature it finds triggers it again. This page compares them cast by cast for your deck.',
    howToRead: [
        'Each side of the scoreboard shows <strong>mana per creature cast</strong> — the free mana value one cast gives you, averaged over every creature in the deck, with casts it does not fire on counted as zero.',
        '<strong>Fires on</strong> is how many creatures trigger it; <strong>When it fires</strong> is the average on those casts; <strong>Good turn</strong> is the result only 1 cast in 20 beats.',
        'The two are never boiled down to one number: a certain 5 and a random 5 are different cards. The bottom line says who does more, how each gets there, and — on creatures both can use — how often Wild Pair’s pick beats Vortex’s roll.',
        'The chart plots value against the mana value of the creature you cast. Solid lines are averages; the dashed line is Vortex’s good turn.',
        '“Creatures won” counts, creature by creature, which engine gives more on average.'
    ],
    method: 'Wild Pair is read straight off the decklist: each creature finds the most expensive other creature with the same total power + toughness, or nothing. Monstrous Vortex is simulated: for each power-5+ creature, that creature is removed from your library and discover is resolved on 2,000 seeded shuffles, chaining whenever it hits another power-5+ creature. It is the same model, library and seed as the Monstrous Vortex page, so a creature’s numbers match on both pages. “Beats the roll” compares the two outcome spreads directly.',
    assumptions: [
        'Every creature is equally likely to be the one you cast. Real games favour cheaper creatures early.',
        'The two never feed each other. Wild Pair puts its creature onto the battlefield without casting it, so Vortex does not see it; a discovered creature is cast from exile, not your hand, so Wild Pair does not see it.',
        'Wild Pair always takes the most expensive match and the match is still in your library.',
        'Vortex always casts what it discovers. A chain is capped at 10 spells.',
        'Neither engine is assumed to be on the battlefield for any particular number of turns: these are per-cast figures, not game totals.'
    ],
    tips: [
        'Wild Pair rewards decks built around shared totals; Vortex rewards a high creature curve with plenty of cheap spells to find.',
        'If one engine wins on average but the other wins late, the curve chart tells you which fits the turns your deck actually plays.'
    ],
    terms: ['discover', 'simulation', 'ev', 'p95', 'p99', 'mv']
};
