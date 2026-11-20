/**
 * mulligan — calculator view.
 * Mounted into #mulligan-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Mulligan Strategy Calculator</h1>
<p class="card-text">"Should I keep this hand?"</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Configuration">
        <h2>Card Type Requirements</h2>
        <p style="margin-bottom: 16px;">
            Define what you need in your opening hand. Add card types (e.g. Lands, Creatures) and set your requirements.
        </p>
        
        <div class="tx-field-row">
            <label for="mull-deck-size">Deck size</label>
            <input type="number" id="mull-deck-size" value="99" min="1" max="200" style="width: 80px;">
            <small>Overrides global deck config</small>
        </div>

        <div id="mull-types-container">
            <!-- Dynamic type rows will be inserted here -->
        </div>

        <button id="mull-add-type" class="import-btn" style="margin-top: 12px; width: 100%;">
            + Add Another Card Type
        </button>

        <div style="margin-top: 24px; border-top: 1px solid var(--tx-rule); padding-top: 16px;">
             <h3>Strategy Settings</h3>

             <div class="input-group">
                <label>Mulligan Strategy Preset</label>
                <div class="preset-buttons">
                    <button class="preset-btn" data-preset="casual">Casual</button>
                    <button class="preset-btn active" data-preset="balanced">Balanced</button>
                    <button class="preset-btn" data-preset="competitive">Competitive</button>
                </div>
            </div>

            <div class="input-group" style="margin-top: 16px;">
                <label for="mull-penalty">Mulligan Penalty (Risk Tolerance)</label>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="range" id="mull-penalty" value="20" min="0" max="100" step="1" style="flex: 1;">
                    <span id="mull-penalty-display" style="min-width: 40px; text-align: right; color: var(--text-light);">20%</span>
                </div>
                <small id="mull-penalty-desc" style="color: var(--text-dim);">Standard penalty. Going down a card is bad.</small>
            </div>

            <div class="input-group" style="margin-top: 16px;">
                <label for="mull-threshold">Confidence Threshold</label>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="range" id="mull-threshold" value="75" min="0" max="100" step="1" style="flex: 1;">
                    <span id="mull-threshold-display" style="min-width: 40px; text-align: right; color: var(--text-light);">75%</span>
                </div>
                <small id="mull-threshold-desc" style="color: var(--text-dim);">You want a high chance to find your cards.</small>
            </div>

            <div class="input-group" style="margin-top: 16px; display: flex; flex-wrap: wrap; gap: 24px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                    <input type="checkbox" id="mull-free" checked>
                    <span>First Mulligan is Free</span>
                </label>
            </div>
        </div>
    </section>

    <section class="panel" aria-label="Strategy Summary">
        <h2>Strategy Summary</h2>
        <div id="mull-summary">
            <!-- Summary stats will be inserted here -->
        </div>
    </section>

    <section class="panel" id="mulligan-sample-reveals" aria-label="Sample reveals">
    </section>

    <section class="panel" aria-label="Turn-by-Turn Probability">
        <h2>Probability by Turn</h2>
        <div class="chart-container" style="height: 300px;">
            <canvas id="mull-turn-chart" role="img" aria-label="Turn probability chart"></canvas>
        </div>
    </section>

    <section class="panel" aria-label="Strategy Table">
        <h2>Hand Decision Table</h2>
        <div class="table-wrapper">
            <table class="comparison-table" id="mull-strategyTable">
            </table>
        </div>
    </section>
</div>
`;
