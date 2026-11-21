/**
 * Monstrous Vortex — view.
 * Mounted into #vortex-tab by the shell the first time the page is opened;
 * every container below is filled by js/calculators/vortex.js.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Settings">
        <div class="tx-h"><span>The creature you cast</span></div>
        <div class="vx-rail">
            <label class="vx-label" for="vortex-cmcSlider">Its mana value</label>
            <div class="vx-mv">
                <span class="tx-display" id="vortex-mv-display">6</span>
                <span class="vx-mv-unit">so Vortex discovers this much</span>
            </div>
            <input type="range" id="vortex-cmcSlider" value="6" min="1" max="16" step="1">
            <div class="vx-scale" id="vortex-mv-scale"><span>&mdash;</span><span>&mdash;</span></div>
            <p class="field-hint vx-who" id="vortex-mv-who"></p>
        </div>

        <div class="tx-h"><span>Variable power</span></div>
        <div class="vx-rail">
            <label class="vx-check">
                <input type="checkbox" id="vortex-star-power" checked>
                <span>Count <strong>*</strong> power as 5 or more</span>
            </label>
            <p class="field-hint">A */* creature is small in your library but usually big as you cast it &mdash; and Vortex looks at the spell being cast.</p>
        </div>
    </section>

    <section class="panel" id="vortex-answer" aria-label="What your big creatures discover"></section>

    <section class="panel" id="vortex-selected-panel" aria-label="One trigger up close">
        <div class="tx-h" id="vortex-selected-head"><span>One trigger, up close</span></div>
        <div id="vortex-stats"></div>
        <div id="vortex-dots" class="vx-dots"></div>
        <div class="chart-container vx-chart">
            <canvas id="vortex-chart" role="img" aria-label="Free mana per trigger by the mana value of the creature cast"></canvas>
        </div>
        <p class="vx-caption">Each point is one trigger from a creature of that mana value. Dots mark the mana values you have a big creature at &mdash; click one to look closer.</p>
    </section>

    <section class="panel" id="vortex-samples-panel" aria-label="Sample triggers">
        <div class="tx-h"><span>Sample triggers</span><span class="tx-h-r">real shuffles of your library</span></div>
        <div id="vortex-reveals-display"></div>
    </section>

    <section class="panel vx-more-panel" id="vortex-more-panel" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head" id="vortex-pool-summary">What it can find</summary>
            <div class="tx-collapse-body" id="vortex-pool"></div>
        </details>
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Results at every mana value</summary>
            <div class="tx-collapse-body vx-flush">
                <div class="vx-table-wrap" id="vortex-comparisonTable"></div>
            </div>
        </details>
    </section>
</div>
`;

export const styles = `
/* Four supporting numbers in one row; the bottom line above is the answer. */
#vortex-tab .tx-hero { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
#vortex-tab .vx-dots { border-top: 1px solid var(--tx-rule); }
#vortex-tab .vx-dots-head {
    display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 16px;
    padding: 12px 18px 0; font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright);
}
#vortex-tab .vx-dots-sub { font-family: var(--font-mono); font-size: var(--t-label); font-weight: 400; color: var(--tx-dim); }
#vortex-tab .vx-dots:empty { display: none; }
#vortex-tab .tx-hero .tx-stat:first-child .tx-stat-value { font-size: var(--t-xxl); }

/* Fixed marker column, so a row with a marker keeps the same bar length. */
#vortex-tab .dist-row { grid-template-columns: 76px minmax(0, 1fr) 48px 72px; }
#vortex-tab .dist-marker { white-space: nowrap; }

/* The by-mana-value table names your creatures last; let that column wrap. */
#vortex-tab #vortex-comparisonTable .tx-sweep-table { min-width: 680px; }
#vortex-tab #vortex-comparisonTable td:last-child { white-space: normal; min-width: 180px; line-height: 1.5; }

#vortex-tab .vx-rail { padding: 16px; display: grid; gap: 8px; }
#vortex-tab .vx-label {
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--tx-mid);
}
#vortex-tab .vx-mv { display: flex; align-items: baseline; gap: 10px; }
#vortex-tab .vx-mv-unit { font-size: var(--t-xs); color: var(--tx-dim); }
#vortex-tab .vx-scale {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-dim);
}
#vortex-tab .vx-who { margin-top: 2px; color: var(--tx-mid); }
#vortex-tab .vx-check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: var(--t-sm);
    color: var(--tx-text);
    cursor: pointer;
}
#vortex-tab .vx-check input { margin-top: 3px; accent-color: var(--tx-accent); }

/* Tables scroll sideways on narrow screens instead of clipping. */
#vortex-tab .vx-table-wrap { overflow-x: auto; }
#vortex-tab .vx-table-wrap .tx-sweep-table { min-width: max-content; }
#vortex-tab .vx-creatures tbody tr { cursor: pointer; }
#vortex-tab .vx-creatures tbody tr:focus-visible { outline: 2px solid var(--tx-accent); outline-offset: -2px; }
#vortex-tab .vx-creatures td.vx-strong { color: var(--tx-bright); font-weight: 600; }
#vortex-tab .vx-copies,
#vortex-tab .vx-dim { color: var(--tx-dim); }

#vortex-tab .vx-chart { height: 300px; padding: 8px 12px 0; }
#vortex-tab .vx-caption {
    margin: 0;
    padding: 8px 16px 14px;
    font-size: var(--t-xs);
    color: var(--tx-dim);
    line-height: 1.5;
}

/* Sample triggers: one card per trigger, one line per discover in its chain. */
#vortex-tab .vx-samples {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
}
#vortex-tab .vx-sample {
    padding: 10px 16px 12px;
    border-bottom: 1px solid var(--tx-rule);
    box-shadow: inset 2px 0 0 var(--tx-rule-hi);
}
#vortex-tab .vx-sample.is-chain { box-shadow: inset 2px 0 0 var(--tx-good); }
#vortex-tab .vx-sample.is-whiff { box-shadow: inset 2px 0 0 var(--tx-bad); }
#vortex-tab .vx-sample-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
}
#vortex-tab .vx-sample-n {
    font-family: var(--font-mono);
    font-size: var(--t-label);
    color: var(--tx-dim);
}
#vortex-tab .vx-sample-sum { font-size: var(--t-sm); color: var(--tx-mid); }
#vortex-tab .vx-sample-sum strong { color: var(--tx-bright); }
#vortex-tab .vx-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
}
#vortex-tab .vx-step {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
}
#vortex-tab .vx-step + .vx-step { padding-left: 14px; }
#vortex-tab .vx-step + .vx-step + .vx-step { padding-left: 28px; }
#vortex-tab .vx-step-x {
    font-family: var(--font-mono);
    font-size: var(--t-label);
    color: var(--tx-dim);
    white-space: nowrap;
}
#vortex-tab .vx-step-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
}
#vortex-tab .vx-passed { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; }
#vortex-tab .vx-passed::after { content: '→'; color: var(--tx-dim); margin: 0 2px; }
#vortex-tab .reveal-card { margin: 0; border-radius: var(--radius-xs); cursor: zoom-in; }
#vortex-tab .reveal-card.is-passed {
    color: var(--tx-mid);
    border-color: var(--tx-rule-hi);
    border-style: dashed;
}
#vortex-tab .reveal-card.is-hit { font-weight: 600; }
#vortex-tab .vx-step-mv {
    font-family: var(--font-mono);
    font-size: var(--t-label);
    color: var(--tx-bright);
}
#vortex-tab .vx-more {
    font-size: var(--t-label);
    color: var(--tx-dim);
}
#vortex-tab .vx-tag {
    display: inline-block;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    font-size: var(--t-micro);
    font-weight: 600;
    color: var(--tx-good);
    background: var(--good-soft);
}
#vortex-tab .vx-tag.is-bad { color: var(--tx-bad); background: var(--bad-soft); }
#vortex-tab .vx-sample-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
}
#vortex-tab .vx-sample-note { font-size: var(--t-xs); color: var(--tx-dim); }

/* Secondary detail */
#vortex-tab .vx-more-panel .tx-collapse:first-child { border-top: 0; }
#vortex-tab .vx-more-panel .tx-collapse-body { max-height: none; }
#vortex-tab .vx-flush { padding: 0; }
#vortex-tab .vx-pool { margin: 0; display: grid; gap: 6px; }
#vortex-tab .vx-pool-row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 10px;
    font-size: var(--t-xs);
    line-height: 1.6;
}
#vortex-tab .vx-pool-row dt {
    font-family: var(--font-mono);
    color: var(--tx-dim);
}
#vortex-tab .vx-pool-row dd { margin: 0; color: var(--tx-text); }
#vortex-tab .vx-sep { color: var(--tx-dim); margin: 0 6px; }

@media (max-width: 560px) {
    #vortex-tab .vx-step { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    #vortex-tab .vx-step + .vx-step,
    #vortex-tab .vx-step + .vx-step + .vx-step { padding-left: 10px; }
    #vortex-tab .vx-chart { height: 240px; }
}
`;

export const guide = {
    intro: 'Monstrous Vortex discovers X whenever you cast a creature spell with power 5 or more, where X is that creature’s mana value. Discover exiles cards from the top until it hits a nonland card costing X or less, and you cast it free — so if that card is another big creature, Vortex triggers again. This page shows how much free mana each of your big creatures turns up.',
    howToRead: [
        'The <strong>bottom line</strong> averages every big creature in the deck, weighted by how many copies you run.',
        '<strong>Your big creatures</strong> lists each one with what a single cast of it discovers. <strong>Average</strong> is the mean free mana, <strong>Typical</strong> is the median trigger, <strong>Good turn</strong> is the trigger only 1 in 20 beats, and <strong>Chains</strong> is how often the free spell triggers Vortex again.',
        'The <strong>slider</strong> picks a mana value to look at closely — including ones you have no creature at, so you can see what adding one would do.',
        '<strong>Out of 100 triggers</strong> shows every outcome of one trigger at the chosen mana value: each dot is one trigger in a hundred, stacked by the free mana it cast. Solid dots cast at least Vortex’s own 4 mana, rings found nothing.',
        'In the chart, the solid line is the average, the dashed line is a good turn and the dotted line is a typical trigger.',
        '<strong>Sample triggers</strong> are single real shuffles: what was passed over (lands are counted, spells named), what was cast, and whether it chained.'
    ],
    method: 'Simulation. For each big creature the page removes that creature from your library (it is on the stack), shuffles the rest 2,000 times, and resolves discover exactly as written: skip lands and anything costing more than X, cast the first hit, and if the hit is a power-5+ creature, discover again at its mana value from the cards below. The shuffles are seeded, so the same deck always shows the same numbers, and the Head to Head page uses the same model and seed.',
    assumptions: [
        'You always cast what you discover. Putting it in hand instead is never modelled.',
        'Discover walks down from the top of a freshly shuffled library: cards already drawn, played or tutored this game are not removed.',
        'A chain is capped at 10 spells. It is a safety limit that real decks essentially never reach.',
        'Mana value is the printed mana value of the front face.',
        'With “Count * power as 5 or more” on, every creature with a variable power is treated as big on the stack, both when you cast it and when it is discovered.'
    ],
    tips: [
        'Discover only hits cards at or under X, so a cheap curve makes Vortex reliable while a few big creatures in the pool make it explosive.',
        'Each extra big creature is both another trigger and another chance to chain from someone else’s trigger.'
    ],
    terms: ['discover', 'simulation', 'ev', 'p50', 'p95', 'p99', 'mv']
};
