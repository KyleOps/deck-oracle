/**
 * chimil — calculator view.
 * Mounted into #chimil-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Chimil, the Inner Sun</h1>
<p class="card-text">"At the beginning of your end step, discover 5."</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Configuration">
        <div class="tx-h"><span>Turns with Chimil out</span><span class="tx-h-r">end steps</span></div>
        <div style="padding:16px;">
            <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:10px;">
                <span id="chimil-turns-display" style="font-size:var(--t-xxl); font-weight:700; color:var(--tx-bright); line-height:1; font-feature-settings:'tnum' 1;">10</span>
                <span style="color:var(--tx-dim); font-size:var(--t-xs);">end steps it survives</span>
            </div>
            <input class="tx-slider" type="range" id="chimil-turnsSlider" value="10" min="1" max="20" step="1" aria-label="End steps with Chimil on the battlefield">
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:var(--t-micro); color:var(--tx-dim);">
                <span>1</span><span>10</span><span>20</span>
            </div>
            <input type="number" id="chimil-turnsValue" value="10" min="1" max="20" style="position:absolute; opacity:0; pointer-events:none; width:1px; height:1px;" aria-label="End steps" tabindex="-1">
        </div>

        <div class="tx-h"><span>Your deck</span><span class="tx-h-r">as built</span></div>
        <div style="padding:16px;">
            <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:4px;">
                <span id="chimil-share-display" style="font-size:var(--t-xl); font-weight:700; color:var(--tx-bright); line-height:1; font-feature-settings:'tnum' 1;">—</span>
                <span style="color:var(--tx-dim); font-size:var(--t-xs);">of the library is eligible</span>
            </div>
            <div style="color:var(--tx-dim); font-size:var(--t-xs);">Everything below is computed from the decklist exactly as imported.</div>
        </div>

        <div class="tx-h"><span>Eligible pool</span><span class="tx-h-r">MV &le; 5, nonland</span></div>
        <div style="padding:16px; font-size:var(--t-xs); color:var(--tx-mid); line-height:1.55;">
            <div style="margin-bottom:8px;">Discover hits <span id="chimil-pool-display" style="color:var(--tx-bright);">—</span> cards.</div>
            <div style="color:var(--tx-dim); font-size:var(--t-micro);">Lands and spells of mana value 6 or more are exiled and put on the bottom — they cost you dig, not value. Closed-form, no simulation.</div>
        </div>
    </section>

    <section class="panel" aria-label="Chimil analysis">
        <div class="tx-h"><span>Per end step</span><span class="tx-h-r">expected value</span></div>
        <div id="chimil-hero"></div>
        <div id="chimil-fit"></div>
        <div id="chimil-recommendation"></div>
    </section>

    <section class="panel" aria-label="Value over time chart">
        <div class="tx-h"><span>Value accumulated</span><span class="tx-h-r">expected, per end step</span></div>
        <div class="chart-container" style="height: 300px;">
            <canvas id="chimil-chart" role="img" aria-label="Chimil cumulative value chart"></canvas>
        </div>
    </section>

    <section class="panel" aria-label="Discover distribution">
        <div id="chimil-distribution"></div>
    </section>

    <section class="panel" id="chimil-sample-reveals" aria-label="Sample reveals">
    </section>

    <section class="panel" aria-label="Turn sweep">
        <div class="tx-h"><span>Turn sweep</span><span class="tx-h-r">★ marks the payback turn</span></div>
        <div id="chimil-sweepTable"></div>
    </section>
</div>
`;
