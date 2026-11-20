/**
 * vortex — calculator view.
 * Mounted into #vortex-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Monstrous Vortex Calculator</h1>
<p class="card-text">"Big Creature, Big Value"</p>

<div class="main-grid single-column">
    <section class="panel panel-full" id="vortex-import-warning" aria-label="Import required notice">
        <h2>Import Required</h2>
        <p style="color: var(--text-secondary); margin: 0;">
            This calculator requires decklist import to work. Please use the
            <strong style="color: var(--text-light);">📚 Deck Configuration</strong> panel above to import your decklist.
            The import will automatically detect creatures with power 5+ and CMC distribution.
        </p>
    </section>

    <section class="panel panel-config" aria-label="Configuration">
        <h2>Calculation Settings</h2>
        <div class="input-group">
            <label for="vortex-cmcValue">CMC of power 5+ creature being cast</label>
            <div class="x-slider-row">
                <input type="range" id="vortex-cmcSlider" value="6" min="3" max="10" step="1" aria-label="Creature CMC slider">
                <input type="number" id="vortex-cmcValue" value="6" min="3" max="15" class="x-number" aria-label="Creature CMC number input">
            </div>
        </div>
        <div class="input-group" style="margin-top: var(--spacing-md);">
            <label style="display: flex; align-items: center; gap: var(--spacing-sm); cursor: pointer; user-select: none;">
                <input type="checkbox" id="vortex-star-power" style="width: auto; cursor: pointer;" checked>
                <span>Treat */* creatures (X/X) as Power 5+</span>
            </label>
            <small style="color: var(--text-dim); display: block; margin-top: 4px; margin-left: 24px;">
                Assume dynamic power creatures (like Lumra, Ashaya) are big enough to chain
            </small>
        </div>
    </section>


    <section class="panel" aria-label="Expected spells chart">
        <h2>Discover Value by Creature CMC</h2>
        <div class="chart-container" style="height: 320px;">
            <canvas id="vortex-chart" role="img" aria-label="Vortex discover chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #f0a92c;"></span> Avg Free Mana Value</span>
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> Avg Spell CMC Found</span>
            <span class="legend-item"><span class="legend-color" style="background: #a68ac4;"></span> Avg Spells Cast</span>
        </div>
    </section>

    <section class="panel" aria-label="Discover analysis">
        <div id="vortex-stats"></div>
    </section>

    <section class="panel" id="vortex-sample-reveals" aria-label="Sample reveals">
    </section>

    <section class="panel" aria-label="Creature comparison">
        <div class="tx-h"><span>DISCOVER SWEEP · BY CREATURE CMC</span><span class="tx-h-r">pool, free MV, chain %</span></div>
        <div class="table-wrapper" id="vortex-comparisonTable"></div>
    </section>
</div>
`;
