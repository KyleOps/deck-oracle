/**
 * portent — calculator view.
 * Mounted into #portent-tab by the shell the first time the calculator is opened.
 */

export const template = `
<div class="portent-grid">

    <!-- LEFT RAIL: inputs -->
    <div class="portent-left">
        <div class="tx-h"><span>01 · X PARAM</span><span class="tx-h-r">cards to reveal</span></div>
        <div style="padding:16px;">
            <div style="display:flex; align-items:baseline; gap:12px; margin-bottom:10px;">
                <span id="portent-x-display" style="font-size:56px; font-weight:700; color:var(--tx-bright); line-height:1; letter-spacing:-0.02em; font-feature-settings:'tnum' 1;">7</span>
                <span style="color:var(--tx-dim); font-size:11px;">/ <span id="portent-n-display">80</span></span>
                <span style="flex:1;"></span>
                <span id="portent-pct-display" style="color:var(--tx-mid); font-size:10px;"></span>
            </div>
            <input class="tx-slider" type="range" id="portent-xSlider" value="7" min="1" max="20" step="1" aria-label="X value slider">
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:9px; color:var(--tx-dim);">
                <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span>
            </div>
            <div style="display:flex; gap:6px; margin-top:12px;" id="portent-presets">
                <button class="tx-chip" data-x="5">X=5</button>
                <button class="tx-chip" data-x="7">X=7</button>
                <button class="tx-chip" data-x="9">X=9</button>
                <button class="tx-chip" data-x="12">X=12</button>
                <button class="tx-chip" data-x="15">X=15</button>
            </div>
            <!-- Hidden number input for JS compatibility -->
            <input type="number" id="portent-xValue" value="7" min="1" max="50" style="position:absolute; opacity:0; pointer-events:none; width:1px; height:1px;" aria-label="X value" tabindex="-1">
        </div>

        <div class="tx-h"><span>02 · LIBRARY</span><span class="tx-h-r" id="portent-n-label">N=80</span></div>
        <div style="padding:16px;">
            <div class="tx-bar" id="portent-type-bar"></div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:4px 12px; font-size:11px; margin-top:8px;" id="portent-type-grid"></div>
        </div>

        <div class="tx-h"><span>03 · TRIGGER RULE</span><span class="tx-h-r">&ge;4 types</span></div>
        <div style="padding:16px; font-size:11px; color:var(--tx-mid); line-height:1.55;">
            <div style="margin-bottom:8px;">If reveal contains <span style="color:var(--tx-amber);">&ge;4 distinct types</span>, all X cards go to hand.</div>
            <div style="color:var(--tx-dim); font-size:10px;">Method: hypergeometric · Monte Carlo 25,000 trials · seed-stable.</div>
        </div>

        <!-- Big spell comparison (legacy, repurposed as extra rail content) -->
        <div id="big-spell-comparison-portent"></div>

        <!-- Legacy stats panel, hidden (replaced by hero numerics) -->
        <div id="portent-stats" style="display:none;"></div>
    </div>

    <!-- CENTER: hero numerics + chart + sweep table -->
    <div class="portent-center">
        <!-- Hero numerics -->
        <div class="portent-hero" id="portent-hero">
            <div class="tx-stat">
                <div class="tx-stat-label">P(FREE SPELL)</div>
                <div class="tx-stat-value" id="portent-hero-pfree" style="color:var(--tx-green);">—</div>
                <div class="tx-stat-sub" id="portent-hero-pfree-sub">x=7</div>
            </div>
            <div class="tx-stat">
                <div class="tx-stat-label">E[TYPES EXILED]</div>
                <div class="tx-stat-value medium" id="portent-hero-types" style="color:var(--tx-amber);">—</div>
                <div class="tx-stat-sub">avg distinct types</div>
            </div>
            <div class="tx-stat" style="border-right:none;">
                <div class="tx-stat-label">MARGINAL +1X</div>
                <div class="tx-stat-value medium" id="portent-hero-marginal" style="color:var(--tx-blue);">—</div>
                <div class="tx-stat-sub" id="portent-hero-marginal-sub">Δ free spell %</div>
            </div>
        </div>

        <!-- Chart -->
        <div class="tx-h">
            <span>04 · KERNEL · P(FREE) AND E[TYPES] vs X</span>
            <span class="tx-h-r"><span style="color:var(--tx-green);">●</span> P(FREE) &nbsp; <span style="color:var(--tx-amber);">▮</span> E[TYPES]</span>
        </div>
        <div class="chart-container" style="height:280px; padding:0;">
            <canvas id="portent-combinedChart" role="img" aria-label="Portent probability chart"></canvas>
        </div>

        <!-- X sweep table -->
        <div class="tx-h"><span>05 · X SWEEP · STEP RESPONSE</span><span class="tx-h-r">P(FREE), E[CARDS], Δ vs prev</span></div>
        <div style="overflow-x:auto;">
            <table class="portent-sweep-table" id="portent-sweep-table">
                <thead>
                    <tr>
                        <th style="text-align:left;">x</th>
                        <th>p(free)</th>
                        <th class="p-bar-cell" style="text-align:left;">p bar</th>
                        <th>E[cards]</th>
                        <th>Δp</th>
                        <th>verdict</th>
                    </tr>
                </thead>
                <tbody id="portent-sweep-body">
                    <!-- Populated by portent.js -->
                </tbody>
            </table>
        </div>

        <!-- Legacy comparison table (hidden, kept for JS compatibility) -->
        <div style="display:none;">
            <table class="comparison-table" id="portent-comparisonTable"></table>
        </div>
    </div>

    <!-- RIGHT RAIL: sample reveals + live tape -->
    <div class="portent-right">
        <div class="tx-h">
            <span id="portent-reveal-header">06 · SAMPLE REVEAL · X=7</span>
            <span class="tx-h-r" id="portent-reshuffle-btn" style="cursor:pointer;">[ ↻ RESHUFFLE ]</span>
        </div>
        <div id="portent-trials-container">
            <!-- 4 trial cards populated by portent.js -->
            <div class="portent-trial" style="color:var(--tx-dim); font-size:10px; padding:20px 16px;">
                Import a decklist to see sample reveals.
            </div>
        </div>

        <div class="tx-h"><span>07 · TRIAL FEED</span><span class="tx-h-r">types · FREE / FIZZ</span></div>
        <div id="portent-live-tape">
            <!-- 14 tape rows populated by portent.js -->
        </div>

        <!-- Legacy sample reveals panel (hidden) -->
        <div id="portent-sample-reveals" style="display:none;"></div>
        <div id="portent-reveals-display" style="display:none;"></div>
        <div id="portent-sample-count" style="display:none;"></div>
    </div>

</div><!-- end portent-grid -->
`;
