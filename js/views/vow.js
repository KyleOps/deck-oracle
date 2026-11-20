/**
 * vow — calculator view.
 * Mounted into #vow-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Kamahl's Druidic Vow Calculator</h1>
<p class="card-text">"For the land and the legends"</p>

<div class="main-grid single-column">
    <section class="panel panel-full" id="vow-import-warning" aria-label="Import required notice">
        <h2>Import Required</h2>
        <p style="color: var(--text-secondary); margin: 0;">
            This calculator requires decklist import to accurately identify Legendary permanents. Please use the
            <strong style="color: var(--text-light);">📚 Deck Configuration</strong> panel above to import your decklist.
        </p>
    </section>

    <section class="panel panel-config" aria-label="Configuration">
        <h2>Calculation Settings</h2>
        <div class="input-group">
            <label for="vow-xValue">X value (cards to reveal)</label>
            <div class="x-slider-row">
                <input type="range" id="vow-xSlider" value="6" min="1" max="30" step="1" aria-label="X value slider">
                <input type="number" id="vow-xValue" value="6" min="1" max="50" class="x-number" aria-label="X value number input">
            </div>
        </div>
        <div class="input-group">
            <label class="checkbox-label">
                <input type="checkbox" id="vow-doubleCast" aria-label="Double cast (Sixth Doctor, Magus Lucea Kane)">
                <span>Double Cast (Sixth Doctor / Magus Lucea Kane)</span>
            </label>
            <p class="helper-text">Copies the spell with the same X value, revealing 2X total cards</p>
        </div>
        <div class="payback-model" aria-label="Kamahl's Druidic Vow value model">
            <div class="tx-h"><span>VALUE MODEL</span><span class="tx-h-r">target = X + 2 mana</span></div>
            <div class="payback-formula">
                <span>Effective value</span>
                <strong>printed MV + land bonus + card bonus</strong>
            </div>
            <div class="payback-fields">
                <label class="payback-field" for="vow-land-value">
                    <span>Extra value per land</span>
                    <input type="number" id="vow-land-value" value="1" min="0" max="20" step="0.25" inputmode="decimal">
                    <small>Values the additional land drop beyond its printed MV of 0.</small>
                </label>
                <label class="payback-field" for="vow-card-value">
                    <span>Value per card put in play</span>
                    <input type="number" id="vow-card-value" value="0.25" min="0" max="20" step="0.25" inputmode="decimal">
                    <small>Credits deck thinning and card access separately from mana value.</small>
                </label>
            </div>
            <p class="payback-example">At the current X, Vow pays for itself at <strong id="vow-payback-target">8 effective mana</strong>.</p>
        </div>
    </section>

    <section class="panel" aria-label="Expected hits chart">
        <h2>Expected Hits vs X Value</h2>
        <div class="chart-container" style="height: 320px;">
            <canvas id="vow-chart" role="img" aria-label="Druidic Vow chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> Expected Hits (Land/Legendary)</span>
            <span class="legend-item"><span class="legend-color" style="background: #7d8a92;"></span> Cards Revealed</span>
        </div>
    </section>

    <section class="panel" id="vow-stats" aria-label="Current X analysis">
        <!-- Analysis content will be inserted here -->
    </section>

    <section class="panel" id="big-spell-comparison" aria-label="Big spell comparison">
        <!-- Comparison will be inserted here -->
    </section>

    <section class="panel" id="vow-sample-reveals" aria-label="Sample reveals">
    </section>

    <section class="panel" aria-label="X value comparison">
        <div class="tx-h"><span>X SWEEP · STEP RESPONSE</span><span class="tx-h-r">E[hits], hit rate, Δ vs prev</span></div>
        <div class="table-wrapper" id="vow-comparisonTable"></div>
    </section>
</div>
`;
