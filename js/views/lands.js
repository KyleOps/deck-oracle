/**
 * lands — calculator view.
 * Mounted into #lands-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Land Drop Calculator</h1>
<p class="card-text">"Will I make my land drops?"</p>

<div class="main-grid single-column">
    <div class="panel-row">
    <section class="panel" aria-label="Opening hand distribution">
        <h2>Opening Hand Land Distribution</h2>
        <div class="chart-container" style="height: 300px;">
            <canvas id="lands-opening-chart" role="img" aria-label="Opening hand lands chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> Probability of Drawing X Lands</span>
        </div>
    </section>

    <section class="panel" aria-label="Land drop probability">
        <h2>Land Drop Probability by Turn</h2>
        <div class="chart-container" style="height: 300px;">
            <canvas id="lands-landdrop-chart" role="img" aria-label="Land drop probability chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> Make Land Drop</span>
            <span class="legend-item"><span class="legend-color" style="background: #e8635c;"></span> Miss Land Drop</span>
        </div>
    </section>
    </div>

    <section class="panel" aria-label="Statistics">
        <h2>Land Drop Statistics</h2>
        <div class="table-wrapper" id="lands-stats-container">
            <table class="comparison-table" id="lands-statsTable">
            </table>
        </div>
    </section>

    <section class="panel" id="lands-sample-reveals" aria-label="Sample reveals">
    </section>
</div>
`;
