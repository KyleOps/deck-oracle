/**
 * Draw Odds — view.
 *
 * Builder on the left (the turn, then up to three card groups), the answer on
 * the right (bottom line, hero numbers, chart, turn-by-turn table, group
 * members). Everything inside the containers is rendered by
 * js/calculators/odds.js; the maths lives in js/utils/drawOdds.js.
 */

export const template = `
<div class="odds">
    <aside class="odds-rail" aria-label="What you are looking for">
        <section class="panel odds-card" aria-labelledby="odds-turn-title">
            <div class="tx-h">
                <h2 class="odds-h" id="odds-turn-title">By turn</h2>
                <span class="tx-h-r" id="odds-format"></span>
            </div>
            <div class="odds-pad" id="odds-turn-box"></div>
        </section>

        <section class="panel odds-card" aria-labelledby="odds-groups-title">
            <div class="tx-h">
                <h2 class="odds-h" id="odds-groups-title">Cards to find</h2>
                <span class="tx-h-r" id="odds-groups-meta"></span>
            </div>
            <div class="odds-groups" id="odds-groups"></div>
        </section>
    </aside>

    <div class="odds-main">
        <div id="odds-empty"></div>

        <div class="odds-filled" id="odds-filled" hidden>
            <section class="panel odds-answer" id="odds-answer" aria-label="Answer" tabindex="-1"></section>

            <section class="panel" aria-labelledby="odds-chart-title">
                <div class="tx-h">
                    <h2 class="odds-h" id="odds-chart-title">Chance by turn</h2>
                    <div class="odds-legend" id="odds-legend"></div>
                </div>
                <div class="odds-chart-wrap">
                    <div class="chart-container odds-chart">
                        <canvas id="odds-chart" role="img" aria-label="Chance by turn"></canvas>
                    </div>
                </div>
                <p class="odds-caption" id="odds-caption"></p>
            </section>

            <div class="odds-pair">
                <section class="panel" aria-labelledby="odds-table-title">
                    <div class="tx-h">
                        <h2 class="odds-h" id="odds-table-title">By turn and copies needed</h2>
                        <span class="tx-h-r">exact odds</span>
                    </div>
                    <div class="odds-table-wrap" id="odds-table"></div>
                </section>

                <section class="panel" aria-labelledby="odds-members-title">
                    <div class="tx-h">
                        <h2 class="odds-h" id="odds-members-title">What’s in each group</h2>
                        <span class="tx-h-r" id="odds-members-meta"></span>
                    </div>
                    <div class="odds-members" id="odds-members"></div>
                </section>
            </div>
        </div>
    </div>
</div>
`;

export const styles = `
#odds-tab .odds {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: start;
}

@container shell (min-width: 1040px) {
    #odds-tab .odds { grid-template-columns: clamp(316px, 27cqi, 380px) minmax(0, 1fr); }
}

#odds-tab .odds-rail,
#odds-tab .odds-main,
#odds-tab .odds-filled {
    display: grid;
    gap: 16px;
    min-width: 0;
}

#odds-tab .odds-filled[hidden] { display: none; }

#odds-tab .odds-h {
    margin: 0;
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
}

#odds-tab .odds-pad { padding: 14px 16px 16px; }
#odds-tab .odds-answer:focus { outline: none; }

/* The typeahead list must be able to hang below its panel. */
#odds-tab .panel.odds-card { overflow: visible; }

/* ---------- Turn picker ---------- */
#odds-tab .odds-turn-read {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 12px;
}

#odds-tab .odds-turn-big {
    font-size: var(--t-xl);
    font-weight: 700;
    letter-spacing: var(--track-tight);
    font-variant-numeric: tabular-nums;
    color: var(--tx-bright);
}

#odds-tab .odds-turn-sub { font-size: var(--t-xs); color: var(--tx-mid); }

#odds-tab input[type="range"].odds-range {
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 6px;
    margin: 6px 0 0;
    border: 0;
    border-radius: var(--radius-full);
    background: linear-gradient(to right, var(--tx-accent) 0 var(--fill, 0%), var(--tx-rule) var(--fill, 0%) 100%);
    cursor: pointer;
}

#odds-tab input[type="range"].odds-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--tx-accent);
    border: 3px solid var(--tx-panel);
    box-shadow: 0 0 0 1px var(--tx-accent);
    cursor: grab;
}

#odds-tab input[type="range"].odds-range::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--tx-accent);
    border: 3px solid var(--tx-panel);
    box-shadow: 0 0 0 1px var(--tx-accent);
    cursor: grab;
}

#odds-tab input[type="range"].odds-range::-moz-range-track { background: transparent; border: 0; }

#odds-tab input[type="range"].odds-range:focus-visible {
    outline: 2px solid var(--tx-accent);
    outline-offset: 6px;
}

#odds-tab .odds-ticks {
    position: relative;
    height: 18px;
    margin-top: 14px;
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-dim);
}

#odds-tab .odds-ticks span {
    position: absolute;
    top: 0;
    left: calc(var(--i) / 10 * (100% - 18px) + 9px);
    transform: translateX(-50%);
}

#odds-tab .odds-ticks span.is-on { color: var(--tx-accent); font-weight: 600; }

#odds-tab .odds-order { margin-top: 12px; }
#odds-tab .odds-hint {
    margin-top: 10px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--tx-dim);
}

/* ---------- Groups ---------- */
#odds-tab .g-a { --g: var(--series-3); }
#odds-tab .g-b { --g: var(--series-5); }
#odds-tab .g-c { --g: var(--series-6); }

#odds-tab .odds-groups { display: grid; }

#odds-tab .og {
    position: relative;
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--tx-rule);
    transition: background var(--transition-fast);
}

#odds-tab .og::before {
    content: '';
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--g);
    opacity: 0.35;
}

#odds-tab .og.is-active { background: var(--tx-panel-alt); }
#odds-tab .og.is-active::before { opacity: 1; }
#odds-tab .og:not(.is-active) { cursor: pointer; }
#odds-tab .og:not(.is-active):hover { background: color-mix(in srgb, var(--tx-panel-alt) 55%, transparent); }

#odds-tab .og-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
}

#odds-tab .og-badge {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--g) 18%, transparent);
    color: var(--g);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    font-weight: 700;
    flex-shrink: 0;
}

#odds-tab input.og-name {
    width: 100%;
    height: 32px;
    padding: 0 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--tx-bright);
    font-family: var(--font-body);
    font-size: var(--t-body);
    font-weight: 600;
    transition: border-color var(--transition-fast), background var(--transition-fast);
}

#odds-tab input.og-name::placeholder { color: var(--tx-dim); font-weight: 500; }
#odds-tab input.og-name:hover { border-color: var(--tx-rule); }
#odds-tab input.og-name:focus {
    outline: none;
    background: var(--tx-bg);
    border-color: var(--tx-accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
}

#odds-tab .og-x,
#odds-tab .og-step,
#odds-tab .og-chip-x,
#odds-tab .og-more,
#odds-tab .og-preset,
#odds-tab .odds-sug,
#odds-tab .odds-rowbtn {
    font-family: inherit;
    font-size: var(--t-xs);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}

#odds-tab .og-x {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--tx-dim);
}

#odds-tab .og-x svg { width: 15px; height: 15px; }
#odds-tab .og-x:hover { color: var(--tx-bright); background: var(--tx-panel); border-color: var(--tx-rule); }

#odds-tab .og-need {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    font-size: var(--t-xs);
    color: var(--tx-mid);
}

#odds-tab .og-stepper {
    display: inline-flex;
    align-items: stretch;
    height: 30px;
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-sm);
    background: var(--tx-bg);
    overflow: hidden;
}

#odds-tab .og-stepper:focus-within { border-color: var(--tx-accent); box-shadow: 0 0 0 3px var(--accent-soft); }

#odds-tab .og-step {
    width: 28px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 0;
    color: var(--tx-mid);
    font-size: var(--t-body);
    font-weight: 600;
}

#odds-tab .og-step:hover:not(:disabled) { background: var(--tx-panel-alt); color: var(--tx-bright); }
#odds-tab .og-step:disabled { opacity: 0.35; cursor: default; }
#odds-tab .og-step:focus-visible { outline-offset: -2px; }

#odds-tab .og-stepper input[type="number"] {
    width: 34px;
    padding: 0;
    background: transparent;
    border: 0;
    border-inline: 1px solid var(--tx-rule);
    border-radius: 0;
    text-align: center;
    color: var(--tx-bright);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    font-weight: 600;
    -moz-appearance: textfield;
    appearance: textfield;
}

#odds-tab .og-stepper input[type="number"]::-webkit-outer-spin-button,
#odds-tab .og-stepper input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
#odds-tab .og-stepper input[type="number"]:focus { outline: none; }

#odds-tab .og-stepper.og-count input[type="number"] { width: 46px; }

#odds-tab .og-of strong { color: var(--tx-bright); font-family: var(--font-mono); font-weight: 600; }
#odds-tab .og-warn { color: var(--tx-bad); }

/* Members as chips */
#odds-tab .og-members {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

#odds-tab .og-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-height: 26px;
    padding: 0 2px 0 10px;
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-full);
    background: var(--tx-panel);
    font-size: var(--t-xs);
    color: var(--tx-text);
}

#odds-tab .og-chip .card-ref {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
    color: var(--tx-text);
}

#odds-tab .og-chip .card-ref:hover { color: var(--tx-bright); }
#odds-tab .og-chip-n { margin-left: 5px; font-family: var(--font-mono); font-size: var(--t-micro); color: var(--tx-dim); }
#odds-tab .og-chip.is-missing { border-style: dashed; color: var(--tx-dim); }
#odds-tab .og-chip.is-missing .og-chip-name { text-decoration: line-through; }

#odds-tab .og-chip-x {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 50%;
    color: var(--tx-dim);
    font-size: var(--t-sm);
    line-height: 1;
}

#odds-tab .og-chip-x:hover { background: var(--tx-panel-alt); color: var(--tx-bright); }

#odds-tab .og-more {
    min-height: 26px;
    padding: 0 10px;
    background: transparent;
    border: 1px dashed var(--tx-rule-hi);
    border-radius: var(--radius-full);
    color: var(--tx-mid);
    font-size: var(--t-xs);
    font-weight: 500;
}

#odds-tab .og-more:hover { color: var(--tx-bright); border-color: var(--tx-dim); background: var(--tx-panel-alt); }

#odds-tab .og-empty-note { font-size: var(--t-xs); color: var(--tx-dim); }

/* Add tools: search or presets */
#odds-tab .og-add { display: grid; gap: 10px; }
#odds-tab .og-tabs { width: 100%; }
#odds-tab .og-tabs .seg-btn { flex: 1; justify-content: center; padding: 0 6px; }

#odds-tab .og-search { position: relative; }

#odds-tab .og-search svg {
    position: absolute;
    left: 10px;
    top: 50%;
    width: 15px;
    height: 15px;
    transform: translateY(-50%);
    color: var(--tx-dim);
    pointer-events: none;
}

#odds-tab input.og-search-input {
    width: 100%;
    height: 38px;
    padding: 0 12px 0 32px;
    background: var(--tx-bg);
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-sm);
    color: var(--tx-bright);
    font-family: var(--font-body);
    font-size: var(--t-sm);
}

#odds-tab input.og-search-input::placeholder { color: var(--tx-dim); }
#odds-tab input.og-search-input:focus {
    outline: none;
    border-color: var(--tx-accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
}

#odds-tab .og-list {
    position: absolute;
    z-index: var(--z-dropdown);
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: 300px;
    overflow-y: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--surface-raised);
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
}

#odds-tab .og-list[hidden] { display: none; }

#odds-tab .og-opt {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--t-sm);
    color: var(--tx-text);
    cursor: pointer;
}

#odds-tab .og-opt.is-active { background: var(--accent-soft); color: var(--tx-bright); box-shadow: inset 2px 0 0 var(--tx-accent); }
#odds-tab .og-opt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#odds-tab .og-opt-name mark { background: none; color: var(--tx-accent); font-weight: 600; }
#odds-tab .og-opt-meta { font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; }
#odds-tab .og-opt-n { font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-mid); min-width: 22px; text-align: right; }
#odds-tab .og-opt.is-in .og-opt-n { color: var(--tx-good); }
#odds-tab .og-opt-empty { padding: 10px; font-size: var(--t-xs); color: var(--tx-dim); cursor: default; }

#odds-tab .og-presets { display: flex; flex-wrap: wrap; gap: 6px; }

#odds-tab .og-preset {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 11px;
    background: var(--tx-panel);
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-full);
    color: var(--tx-text);
    font-size: var(--t-xs);
    font-weight: 500;
    white-space: nowrap;
}

#odds-tab .og-preset span { font-family: var(--font-mono); font-size: var(--t-micro); color: var(--tx-dim); }
#odds-tab .og-preset:hover:not(:disabled) { border-color: var(--tx-dim); color: var(--tx-bright); }
#odds-tab .og-preset:hover { background: var(--tx-panel-alt); }
#odds-tab .og-preset[aria-pressed="true"] { border-color: var(--tx-accent); background: var(--accent-soft); color: var(--tx-bright); }
#odds-tab .og-preset[aria-pressed="true"] span { color: var(--tx-accent); }
#odds-tab .og-preset:disabled { opacity: 0.4; cursor: default; border-color: var(--tx-rule); }

#odds-tab .og-tip { font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.5; }
#odds-tab .og-tip kbd {
    padding: 0 4px;
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-mid);
}

#odds-tab .odds-addrow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 14px 16px 16px;
}

#odds-tab .odds-addrow .odds-hint { margin: 0; }

/* ---------- Empty state ---------- */
#odds-tab .odds-empty {
    padding: clamp(24px, 4cqi, 44px) clamp(18px, 3.4cqi, 40px);
}

#odds-tab .odds-eyebrow {
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
}

#odds-tab .odds-empty-title {
    margin: 8px 0 6px;
    font-size: var(--t-xl);
    font-weight: 600;
    letter-spacing: var(--track-tight);
    color: var(--tx-bright);
}

#odds-tab .odds-empty-text { max-width: 60ch; font-size: var(--t-sm); line-height: 1.6; color: var(--tx-mid); }

#odds-tab .odds-sugs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    gap: 12px;
    margin-top: 22px;
}

#odds-tab .odds-sug {
    display: grid;
    gap: 6px;
    align-content: start;
    min-height: 124px;
    padding: 16px;
    text-align: left;
    background: var(--tx-panel-alt);
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-lg);
    color: var(--tx-text);
}

#odds-tab .odds-sug:hover { border-color: var(--tx-rule-hi); background: var(--tx-row-hi); color: var(--tx-bright); transform: translateY(-1px); }
#odds-tab .odds-sug-pct {
    font-family: var(--font-mono);
    font-size: var(--t-xxl);
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1.05;
}
#odds-tab .odds-sug-label { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
#odds-tab .odds-sug-sub { font-size: var(--t-xs); color: var(--tx-dim); }
#odds-tab .odds-sug-go { margin-top: 4px; font-size: var(--t-xs); font-weight: 600; color: var(--tx-accent); }

#odds-tab .is-good { color: var(--tx-good); }
#odds-tab .is-warn { color: var(--tx-warn); }
#odds-tab .is-bad { color: var(--tx-bad); }

/* ---------- Answer ---------- */
#odds-tab .odds-answer .tx-hero {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 168px), 1fr));
    border-bottom: 0;
}

#odds-tab .odds-answer .tx-stat { border-right: 1px solid var(--tx-rule); border-bottom: 0; }
#odds-tab .odds-answer .tx-stat:last-child { border-right: 0; }
#odds-tab .odds-answer .tx-stat-value.medium { font-size: var(--t-xl); }
#odds-tab .odds-word { font-family: var(--font-body); font-size: 0.82em; font-weight: 700; letter-spacing: var(--track-tight); }

@container shell (max-width: 760px) {
    #odds-tab .odds-answer .tx-hero { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    #odds-tab .odds-answer .tx-stat { border-right: 0; border-bottom: 1px solid var(--tx-rule); }
    #odds-tab .odds-answer .tx-stat:nth-child(odd) { border-right: 1px solid var(--tx-rule); }
    #odds-tab .odds-answer .tx-stat:nth-last-child(-n + 2) { border-bottom: 0; }
}
#odds-tab .odds-avgs { display: inline-flex; flex-wrap: wrap; gap: 4px 14px; }
#odds-tab .odds-avg { display: inline-flex; align-items: baseline; gap: 5px; }
#odds-tab .odds-avg i {
    font-style: normal;
    font-size: var(--t-xs);
    font-weight: 700;
    color: var(--g);
}

/* ---------- Chart ---------- */
#odds-tab .odds-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px 14px;
    font-size: var(--t-label);
    font-weight: 500;
    color: var(--tx-mid);
}

#odds-tab .odds-key { display: inline-flex; align-items: center; gap: 6px; }
#odds-tab .odds-key i { width: 14px; height: 0; border-top: 2px dashed var(--g); }
#odds-tab .odds-key.is-solid i { border-top-style: solid; }
#odds-tab .odds-key.is-all { --g: var(--tx-bright); color: var(--tx-bright); }
#odds-tab .odds-key.is-all i { border-top-width: 3px; border-top-style: solid; }

#odds-tab .odds-chart-wrap { padding: 14px 12px 4px 6px; }
#odds-tab .odds-chart { height: clamp(220px, 26cqi, 300px); }

#odds-tab .odds-caption {
    padding: 4px 16px 14px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--tx-dim);
}

/* ---------- Table + members ---------- */
#odds-tab .odds-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    align-items: stretch;
}

@container shell (min-width: 1360px) {
    #odds-tab .odds-pair { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
}

#odds-tab .odds-table-wrap { overflow-x: auto; }

#odds-tab .odds-table {
    width: 100%;
    min-width: max-content;
    border-collapse: collapse;
    font-size: var(--t-xs);
}

#odds-tab .odds-table th,
#odds-tab .odds-table td {
    padding: 0 12px;
    height: 34px;
    border-bottom: 1px solid var(--tx-rule);
    text-align: right;
    white-space: nowrap;
}

#odds-tab .odds-table thead th {
    height: 32px;
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
}

#odds-tab .odds-table th:first-child,
#odds-tab .odds-table td:first-child { text-align: left; padding-left: 16px; }
#odds-tab .odds-table tr > :last-child { padding-right: 16px; }
#odds-tab .odds-table tbody tr:last-child > * { border-bottom: 0; }
#odds-tab .odds-table td { font-family: var(--font-mono); color: var(--tx-text); }
#odds-tab .odds-table td.dim { color: var(--tx-dim); }
#odds-tab .odds-table tbody tr:hover { background: var(--tx-row-hi); }
#odds-tab .odds-table tbody tr.is-sel { background: var(--accent-soft); }
#odds-tab .odds-table tbody tr.is-sel th { box-shadow: inset 3px 0 0 var(--tx-accent); }

#odds-tab .odds-rowbtn {
    padding: 4px 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-xs);
    color: var(--tx-text);
    font-size: var(--t-xs);
    font-weight: 600;
}

#odds-tab .odds-rowbtn:hover { color: var(--tx-bright); background: var(--tx-panel-alt); }
#odds-tab tr.is-sel .odds-rowbtn { color: var(--tx-bright); }

/* Heat map: turn × copies needed */
#odds-tab .odds-heat-groups { margin: 12px 16px 0; max-width: calc(100% - 32px); overflow-x: auto; }
#odds-tab .odds-heat-groups .seg-btn { gap: 7px; }
#odds-tab .odds-heat-groups .og-badge { width: 18px; height: 18px; font-size: var(--t-micro); }
#odds-tab .odds-heat-note { margin: 0; padding: 10px 16px 8px; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-dim); }
#odds-tab .odds-heat-note strong { color: var(--tx-text); font-weight: 600; }
#odds-tab .odds-heat td { padding: 2px 3px; }
#odds-tab .odds-heat td.dim { padding: 0 10px; }
#odds-tab .odds-heat th.odds-heat-need { text-align: center; min-width: 58px; }
#odds-tab .odds-heat td.odds-heat-all { padding: 0 16px 0 10px; }
#odds-tab .odds-heat-all strong { font-weight: 600; }
#odds-tab .odds-heat-all .is-good { color: var(--tx-good); }
#odds-tab .odds-heat-all .is-warn { color: var(--tx-warn); }
#odds-tab .odds-heat-all .is-bad { color: var(--tx-bad); }
#odds-tab .odds-heat tbody tr.is-sel { background: var(--accent-soft); }
#odds-tab .odds-heat tr > :last-child { padding-right: 12px; }
#odds-tab .odds-heat .odds-narrow { display: none; }

#odds-tab .odds-members { display: grid; }

#odds-tab .om { padding: 12px 16px 14px; border-bottom: 1px solid var(--tx-rule); }
#odds-tab .om:last-child { border-bottom: 0; }

#odds-tab .om-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
}

#odds-tab .om-name { font-weight: 600; color: var(--tx-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#odds-tab .om-meta { font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; }

#odds-tab .om-list {
    margin: 0;
    padding: 0;
    list-style: none;
    columns: 2 180px;
    column-gap: 18px;
    font-size: var(--t-xs);
}

#odds-tab .om-list li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 0;
    break-inside: avoid;
}

#odds-tab .om-n { min-width: 2.4ch; font-family: var(--font-mono); font-size: var(--t-micro); color: var(--tx-dim); text-align: right; }
#odds-tab .om-also {
    margin-left: auto;
    padding: 0 5px;
    border-radius: var(--radius-xs);
    background: var(--tx-rule);
    font-size: var(--t-micro);
    font-weight: 600;
    color: var(--tx-mid);
    white-space: nowrap;
}

#odds-tab .om-note {
    padding: 12px 16px 14px;
    border-top: 1px solid var(--tx-rule);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--tx-dim);
}

#odds-tab .om-note strong { color: var(--tx-text); }

@container shell (max-width: 560px) {
    #odds-tab .odds-table th,
    #odds-tab .odds-table td { padding: 0 7px; }
    #odds-tab .odds-heat td { padding: 2px; }
    #odds-tab .odds-heat td.dim { padding: 0 6px; }
    #odds-tab .odds-heat th.odds-heat-need { min-width: 48px; }
    #odds-tab .odds-heat .odds-heat-seen { display: none; }
    #odds-tab .odds-heat .odds-wide { display: none; }
    #odds-tab .odds-heat .odds-narrow { display: inline; }
    #odds-tab .odds-heat td.odds-heat-all { padding: 0 8px 0 4px; }
    #odds-tab .odds-legend { justify-content: flex-start; }
    #odds-tab .tx-h:has(.odds-legend) { flex-wrap: wrap; }
    #odds-tab .odds-sug { min-height: 0; }
}

@media (hover: none) and (pointer: coarse) {
    #odds-tab .og-x { width: 40px; height: 40px; }
    #odds-tab .og-step { width: 36px; }
    #odds-tab .og-stepper { height: 36px; }
    #odds-tab .og-chip-x { width: 30px; height: 30px; }
    #odds-tab .og-preset { height: 36px; }
}

@media (prefers-reduced-motion: reduce) {
    #odds-tab .odds-sug:hover { transform: none; }
}
`;

export const guide = {
    intro: 'Pick the cards you want — one card, a handful, or a whole slice of the deck like “your ramp” or “your lands” — and this page gives the exact chance of having them in hand by each turn. Add up to three groups to ask for several things at once, such as two lands <em>and</em> a ramp piece by turn 2.',
    howToRead: [
        'The <strong>bottom line</strong> answers for the turn you picked. Drag the turn slider, click the chart, or pick a turn in the heat map to change it.',
        '<strong>By turn and copies needed</strong> is a heat map of every question at once: each row is a turn, each column how many copies you need, and the stronger the green, the likelier. Pick a cell to make it the question the page answers. With several groups, switch which group it shows.',
        '<strong>Passes 50% / 90%</strong> is the first turn the chance reaches one in two / nine in ten. “Coin flip” and “reliable” are useful thresholds when deciding whether a card is worth its slot.',
        '<strong>Average copies seen</strong> counts every card from the group you will have seen by then, not just whether you found one.',
        'With several groups, the dashed lines show each group on its own and the solid line needs <em>all of them at once</em>. The gap between them is the cost of needing everything together.',
        '<strong>Need at least</strong> asks for that many cards from the group — “3 lands”, “2 copies of Lightning Bolt”.'
    ],
    method: 'Exact, from the hypergeometric distribution — the maths of drawing without replacement. With more than one group the library is split into overlap regions (cards in A only, in both A and B, and so on) and every combination of draws from those regions that satisfies all the requirements is added up. A card in two groups counts for both. The answer has been checked against brute-force enumeration of every possible hand.',
    assumptions: [
        'You keep a seven-card hand: mulligans are not modelled.',
        'Cards seen by your main phase: seven in the opening hand plus one draw per turn. In multiplayer Commander nobody skips their first draw; in 60- and 40-card games the player on the play does.',
        'Only natural draws count — extra card draw, tutors and scrying are not included, so real odds are a little better in decks that dig.',
        'In Commander your commander starts in the command zone and is left out of the library.',
        'Without a card list, each group is a plain copy count and groups are treated as different cards.'
    ],
    tips: [
        'A single copy in a 99-card library is only about 7% to be in your opening hand and 10% by turn 3. If a card must show up, add redundancy — cards that do the same job — or tutors.',
        'In 60-card decks, four copies of a card are about 40% in the opening hand and 45% by turn 2 on the play.',
        'Use two groups to test a combo: put each piece in its own group and the solid line is the chance of having both.'
    ],
    terms: ['exact', 'hypergeometric', 'play', 'mulligan', 'library']
};
