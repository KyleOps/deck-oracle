/**
 * rashmi — calculator view.
 * Mounted into #rashmi-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Rashmi, Eternities Crafter Calculator</h1>
<p class="card-text">"The simic phyrexian arena"</p>

<div class="main-grid single-column">
    <section class="panel panel-full" id="rashmi-import-warning" aria-label="Import required notice">
        <h2>Import Required</h2>
        <p style="color: var(--text-secondary); margin: 0;">
            This calculator requires decklist import to work. Please use the
            <strong style="color: var(--text-light);">📚 Deck Configuration</strong> panel above to import your decklist.
            The import will automatically detect CMC distribution for your non-land spells.
        </p>
    </section>

    <section class="panel panel-config" id="rashmi-stats" aria-label="Configuration">
        <h2>Calculation Settings</h2>
        <div class="input-group">
            <label for="rashmi-cmcValue">CMC of spell you're casting</label>
            <div class="x-slider-row">
                <input type="range" id="rashmi-cmcSlider" value="5" min="1" max="10" step="1" aria-label="Cast CMC slider">
                <input type="number" id="rashmi-cmcValue" value="5" min="1" max="15" class="x-number" aria-label="Cast CMC number input">
            </div>
        </div>
        <div class="input-group" style="margin-top: var(--spacing-md);">
            <label style="display: flex; align-items: center; gap: var(--spacing-sm); cursor: pointer; user-select: none;">
                <input type="checkbox" id="rashmi-exclude-x" style="width: auto; cursor: pointer;">
                <span>Exclude X spells from "free spell" calculation</span>
            </label>
            <small style="color: var(--text-dim); display: block; margin-top: 4px; margin-left: 24px;">
                When revealed from library, X=0, so X spells can't be cast for free with Rashmi
            </small>
        </div>
    </section>
    
    <section class="panel" id="rashmi-hero" aria-label="Current cast analysis"></section>

    <section class="panel" aria-label="Probability chart">
        <h2>Free Spell Probability vs Cast CMC</h2>
        <div class="chart-container" style="height: 320px;">
            <canvas id="rashmi-chart" role="img" aria-label="Rashmi probability chart"></canvas>
        </div>
        <div class="chart-legend">
            <span class="legend-item"><span class="legend-color" style="background: #55c97f;"></span> P(Free Spell) %</span>
            <span class="legend-item"><span class="legend-color" style="background: #6f9dc4;"></span> Expected Free CMC</span>
        </div>
    </section>

    <section class="panel" id="rashmi-breakdown" aria-label="CMC distribution">
    </section>

    <section class="panel" id="rashmi-sample-reveals" aria-label="Sample reveals">
    </section>


    <section class="panel" aria-label="CMC comparison">
        <div class="tx-h"><span>CAST CMC SWEEP · STEP RESPONSE</span><span class="tx-h-r">P(free), Δ vs prev</span></div>
        <div class="table-wrapper" id="rashmi-comparisonTable"></div>
    </section>
</div>
`;
