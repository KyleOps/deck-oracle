/**
 * lumra — calculator view.
 * Mounted into #lumra-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Lumra, Bellow of the Woods</h1>
<p class="card-text">"Mill 4, return all lands. How big is the bear?"</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Configuration">
        <h2>Calculation Settings</h2>
        <div class="input-group">
            <label for="lumra-gyLands">Other lands already in Graveyard</label>
            <div class="x-slider-row">
                <input type="range" id="lumra-gySlider" value="3" min="0" max="30" step="1" aria-label="Lands in Graveyard slider">
                <input type="number" id="lumra-gyLands" value="3" min="0" max="100" class="x-number" aria-label="Lands in Graveyard number input">
            </div>
        </div>
        <div class="input-group">
            <label for="lumra-multiplier">Triggers (Panharmonicon/Roaming Throne)</label>
            <div class="x-slider-row">
                <input type="range" id="lumra-multSlider" value="1" min="1" max="5" step="1" aria-label="Trigger multiplier slider">
                <input type="number" id="lumra-multiplier" value="1" min="1" max="10" class="x-number" aria-label="Trigger multiplier number input">
            </div>
        </div>
        <div class="input-group">
            <label for="lumra-fetchLands">Fetch lands in deck</label>
            <input type="number" id="lumra-fetchLands" value="0" min="0" max="100" step="1" inputmode="numeric">
            <small>Auto-detected on deck import; you can override the count.</small>
        </div>
        <div class="input-group">
            <label for="lumra-turn">Turn Lumra enters</label>
            <div class="x-slider-row">
                <input type="range" id="lumra-turnSlider" value="6" min="1" max="20" step="1" aria-label="Lumra cast turn slider">
                <input type="number" id="lumra-turn" value="6" min="1" max="30" class="x-number" aria-label="Lumra cast turn number input">
            </div>
            <small>Assumes a seven-card opener, one draw each turn, and that fetches seen can be cracked.</small>
        </div>
    </section>

    <section class="panel" aria-label="Lands Milled Chart">
        <h2 id="lumra-chart-header">Lands Milled Distribution (Mill 4)</h2>
        <div class="chart-container" style="height: 300px;">
            <canvas id="lumra-chart" role="img" aria-label="Lumra lands milled chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #8b9c78;"></span> Probability</span>
        </div>
    </section>

    <section class="panel" id="lumra-stats" aria-label="Lumra Analysis">
        <!-- Analysis content will be inserted here -->
    </section>

    <section class="panel" id="lumra-sample-reveals" aria-label="Sample reveals">
    </section>
</div>
`;
