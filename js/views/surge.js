/**
 * surge — calculator view.
 * Mounted into #surge-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Primal Surge Calculator</h1>
<p class="card-text">"So do you win here or...?"</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Primal Surge payback model">
        <div class="tx-h"><span>Payback model</span><span class="tx-h-r">tune what value means</span></div>
        <p class="surge-value-intro">A run pays for Primal Surge when its effective value reaches your threshold.</p>
        <div class="surge-value-formula" aria-label="Effective value formula">
            <span>effective value</span>
            <strong>printed MV + land value + card value</strong>
        </div>
        <div class="surge-value-fields">
            <label class="surge-value-field" for="surge-payback-threshold">
                <span>Payback threshold</span>
                <input type="number" id="surge-payback-threshold" value="10" min="0.25" max="100" step="0.25" inputmode="decimal">
                <small>Below this is a whiff</small>
            </label>
            <label class="surge-value-field" for="surge-land-value">
                <span>Extra value per land</span>
                <input type="number" id="surge-land-value" value="1" min="0" max="20" step="0.25" inputmode="decimal">
                <small>Added on top of printed MV</small>
            </label>
            <label class="surge-value-field" for="surge-card-value">
                <span>Value per card put in play</span>
                <input type="number" id="surge-card-value" value="0.25" min="0" max="20" step="0.25" inputmode="decimal">
                <small>Deck-thinning, ETB, and board value</small>
            </label>
        </div>
        <p class="surge-value-example">Example: 5 lands + three 1-MV dorks = 3 raw MV + 5 land value + 2 card value = <strong>10 effective value</strong>.</p>
    </section>

    <section class="panel" aria-label="Expected permanents chart">
        <h2>Expected Permanents & Early-stop Risk</h2>
        <div class="chart-container" style="height: 320px;">
            <canvas id="surge-chart" role="img" aria-label="Primal Surge chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> Expected Permanents</span>
            <span class="legend-item"><span class="legend-color" style="background: #e8635c;"></span> Early stop (&lt;5 permanents)</span>
        </div>
    </section>

    <section class="panel" aria-label="Simulation results">
        <h2>Simulation Results</h2>
        <div class="table-wrapper" id="surge-stats-container">
            <!-- Stats content will be inserted here -->
        </div>
    </section>

    <section class="panel" id="big-spell-comparison-surge" aria-label="Big spell comparison">
        <!-- Comparison will be inserted here -->
    </section>

    <section class="panel" id="surge-sample-reveals" aria-label="Sample reveals">
    </section>
</div>
`;
