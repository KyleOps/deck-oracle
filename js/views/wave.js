/**
 * wave — calculator view.
 * Mounted into #wave-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Genesis Wave Calculator</h1>
<p class="card-text">"Best green mill spell in the game"</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Configuration">
        <h2>Calculation Settings</h2>
        <div class="input-group">
            <label for="wave-xValue">X value (cards to reveal)</label>
            <div class="x-slider-row">
                <input type="range" id="wave-xSlider" value="6" min="1" max="30" step="1" aria-label="X value slider">
                <input type="number" id="wave-xValue" value="6" min="1" max="50" class="x-number" aria-label="X value number input">
            </div>
        </div>
        <div class="payback-model" aria-label="Genesis Wave value model">
            <div class="tx-h"><span>VALUE MODEL</span><span class="tx-h-r">target = X + 3 mana</span></div>
            <div class="payback-formula">
                <span>Effective value</span>
                <strong>printed MV + land bonus + card bonus</strong>
            </div>
            <div class="payback-fields">
                <label class="payback-field" for="wave-land-value">
                    <span>Extra value per land</span>
                    <input type="number" id="wave-land-value" value="1" min="0" max="20" step="0.25" inputmode="decimal">
                    <small>Values the additional land drop beyond its printed MV of 0.</small>
                </label>
                <label class="payback-field" for="wave-card-value">
                    <span>Value per card put in play</span>
                    <input type="number" id="wave-card-value" value="0.25" min="0" max="20" step="0.25" inputmode="decimal">
                    <small>Credits deck thinning and card access separately from mana value.</small>
                </label>
            </div>
            <p class="payback-example">At the current X, Wave pays for itself at <strong id="wave-payback-target">9 effective mana</strong>.</p>
        </div>
    </section>

    <section class="panel" aria-label="Expected permanents chart">
        <h2>Expected Permanents vs X Value</h2>
        <div class="chart-container" style="height: 320px;">
            <canvas id="wave-chart" role="img" aria-label="Genesis Wave chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #7d8a92;"></span> Expected Permanents Played</span>
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> Total Cards Revealed</span>
        </div>
    </section>

    <section class="panel" id="wave-stats" aria-label="Current X analysis">
        <!-- Analysis content will be inserted here -->
    </section>

    <section class="panel" id="big-spell-comparison-wave" aria-label="Big spell comparison">
        <!-- Comparison will be inserted here -->
    </section>

    <section class="panel" id="wave-sample-reveals" aria-label="Sample reveals">
    </section>

    <section class="panel" aria-label="X value comparison">
        <div class="tx-h"><span>X SWEEP · STEP RESPONSE</span><span class="tx-h-r">E[perms], hit rate, Δ vs prev</span></div>
        <div class="table-wrapper" id="wave-comparisonTable"></div>
    </section>
</div>
`;
