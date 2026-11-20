/**
 * wildpair — calculator view.
 * Mounted into #wildpair-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Wild Pair</h1>
<p class="card-text">"Whenever a creature enters, if you cast it from your hand, you may search your library for a creature card with the same total power and toughness, put it onto the battlefield, then shuffle."</p>

<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Configuration">
        <div class="tx-h"><span>Total power + toughness</span><span class="tx-h-r">the search key</span></div>
        <div style="padding:16px;">
            <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:4px;">
                <span id="wildpair-total-display" style="font-size:var(--t-display); font-weight:700; color:var(--tx-bright); line-height:1; letter-spacing:var(--track-display); font-feature-settings:'tnum' 1;">—</span>
                <span style="color:var(--tx-dim); font-size:var(--t-xs);">power + toughness</span>
            </div>
            <div id="wildpair-total-summary" style="color:var(--tx-mid); font-size:var(--t-xs); margin-bottom:12px; line-height:1.5;">—</div>
            <input class="tx-slider" type="range" id="wildpair-totalSlider" value="0" min="0" max="0" step="1" aria-label="Step through the totals in your deck">
            <div id="wildpair-total-scale" style="display:flex; justify-content:space-between; margin-top:4px; font-size:var(--t-micro); color:var(--tx-dim); font-feature-settings:'tnum' 1;">
                <span>&mdash;</span><span>&mdash;</span>
            </div>
            <div id="wildpair-total-stops" style="margin-top:6px; font-size:var(--t-micro); letter-spacing:var(--track-label); text-transform:uppercase; color:var(--tx-mid);"></div>
            <input type="number" id="wildpair-totalValue" value="0" min="0" max="40" style="position:absolute; opacity:0; pointer-events:none; width:1px; height:1px;" aria-label="Total power and toughness" tabindex="-1">
            <div style="color:var(--tx-dim); font-size:var(--t-micro); margin-top:10px; line-height:1.5;">Wild Pair matches on this number and nothing else. The slider steps through the totals your deck actually has &mdash; no empty stops. Clicking any group below moves it too.</div>
        </div>

        <div class="tx-h"><span>Your deck</span><span class="tx-h-r">as built</span></div>
        <div style="padding:16px; font-size:var(--t-xs); color:var(--tx-mid); line-height:1.55;">
            <div style="margin-bottom:6px;">Creatures that find something: <span id="wildpair-live-display" style="color:var(--tx-bright);">&mdash;</span></div>
            <div style="margin-bottom:8px;">Matched totals: <span id="wildpair-matched-display" style="color:var(--tx-bright);">&mdash;</span></div>
            <div style="color:var(--tx-dim); font-size:var(--t-micro);">A 5/5 and a 3/7 match; a 5/5 and a 5/6 never do. Creatures sharing a total are interchangeable &mdash; cast any one of them and you may search up any other.</div>
        </div>
    </section>

    <section class="panel" id="wildpair-group" aria-label="Search options at the selected total"></section>

    <section class="panel" id="wildpair-groups" aria-label="All groups"></section>

    <section class="panel" aria-label="Power and toughness spread">
        <div class="tx-h"><span>Total power + toughness spread</span><span class="tx-h-r">any column of two or more is live</span></div>
        <div class="chart-container" style="height: 300px;">
            <canvas id="wildpair-pt-chart" role="img" aria-label="Creature count by total power and toughness"></canvas>
        </div>
    </section>

    <section class="panel" aria-label="Wild Pair ceiling">
        <div class="tx-h"><span>Across the deck</span><span class="tx-h-r">per activation, exact from the decklist</span></div>
        <div id="wildpair-hero"></div>
        <div id="wildpair-fit"></div>
        <div id="wildpair-recommendation"></div>
        <div id="wildpair-datanote"></div>
    </section>

    <section class="panel" id="wildpair-pairings" aria-label="Available pairings"></section>

    <section class="panel" aria-label="Pair ladder">
        <div class="tx-h"><span>Total ladder</span><span class="tx-h-r">&#9733; marks your deepest total</span></div>
        <div id="wildpair-sweepTable"></div>
    </section>
</div>
`;
