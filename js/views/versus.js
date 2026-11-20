/**
 * versus — calculator view.
 * Mounted into #versus-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Head to Head</h1>
<p class="card-text">Two payoff engines, one deck. Which is worth more when you cast a creature &mdash; and at which point in the game?</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Configuration">
        <div class="tx-h"><span>Engines</span><span class="tx-h-r">pick two</span></div>
        <div style="padding:16px;">
            <label for="versus-engine-a" style="display:block; font-size:var(--t-micro); letter-spacing:var(--track-label); text-transform:uppercase; color:var(--tx-dim); margin-bottom:5px;">Side A</label>
            <select id="versus-engine-a" class="vs-select" aria-label="First engine"></select>
            <div style="text-align:center; font-size:var(--t-micro); letter-spacing:var(--track-wide); color:var(--tx-dim); margin:10px 0;">VS</div>
            <label for="versus-engine-b" style="display:block; font-size:var(--t-micro); letter-spacing:var(--track-label); text-transform:uppercase; color:var(--tx-dim); margin-bottom:5px;">Side B</label>
            <select id="versus-engine-b" class="vs-select" aria-label="Second engine"></select>
        </div>

        <div class="tx-h"><span>Assumptions</span><span class="tx-h-r">how to read the deck</span></div>
        <div style="padding:16px;">
            <label style="display:flex; align-items:flex-start; gap:8px; font-size:var(--t-xs); color:var(--tx-mid); line-height:1.5; cursor:pointer;">
                <input type="checkbox" id="versus-star-power" style="margin-top:2px;">
                <span>Count <span style="color:var(--tx-bright);">*</span> power as 5 or greater</span>
            </label>
            <div style="color:var(--tx-dim); font-size:var(--t-micro); margin-top:8px; line-height:1.5;">A creature with a variable power box is 0 in the library but can be large on the stack. Off by default.</div>
        </div>

        <div class="tx-h"><span>This deck</span><span class="tx-h-r">as built</span></div>
        <div style="padding:16px; font-size:var(--t-xs); color:var(--tx-mid); line-height:1.55;">
            <div style="margin-bottom:6px;">Creature casts compared: <span id="versus-creatures-display" style="color:var(--tx-bright);">&mdash;</span></div>
            <div style="margin-bottom:8px;">Leader: <span id="versus-lead-display" style="color:var(--tx-bright);">&mdash;</span></div>
            <div style="color:var(--tx-dim); font-size:var(--t-micro);">Both are measured as free mana value off a single creature cast. They do not feed each other: Wild Pair never casts its creature, and a card cast off discover comes from exile, not hand.</div>
        </div>
    </section>

    <section class="panel" id="versus-scoreboard" aria-label="Scoreboard"></section>

    <section class="panel" aria-label="Value by mana value">
        <div class="tx-h"><span>Value at each point in the game</span><span class="tx-h-r">by the mana value of the creature you cast</span></div>
        <div class="chart-container" style="height: 320px;">
            <canvas id="versus-curve-chart" role="img" aria-label="Expected free mana value by cast creature mana value"></canvas>
        </div>
        <div id="versus-recommendation"></div>
    </section>

    <section class="panel" id="versus-peaks" aria-label="Peaks"></section>

    <section class="panel" aria-label="Creature by creature">
        <div class="tx-h"><span>Creature by creature</span><span class="tx-h-r">what each cast is worth to each engine</span></div>
        <div id="versus-table"></div>
    </section>
</div>
`;
