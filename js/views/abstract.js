/**
 * abstract — calculator view.
 * Mounted into #abstract-tab by the shell the first time the calculator is opened.
 */

export const template = `
<div class="portent-grid">

    <!-- LEFT RAIL: card info + CMC curve -->
    <div class="portent-left">
        <div class="tx-h"><span>01 · CARD INFO</span><span class="tx-h-r">{5}{U} Sorcery</span></div>
        <div style="padding:16px; font-size:10px; color:var(--tx-mid); line-height:1.6;">
            <div style="margin-bottom:8px; color:var(--tx-text);">Exile the top <span style="color:var(--tx-amber);">four cards</span> face-down, then the top <span style="color:var(--tx-amber);">four cards</span> face-up.</div>
            <div style="margin-bottom:8px;">An opponent chooses one pile. Put it into your graveyard.</div>
            <div>Look at the other pile. You may <span style="color:var(--tx-green);">cast a spell for free</span>. Put the rest into your hand.</div>
        </div>

        <div class="tx-h"><span>02 · SCENARIOS</span></div>
        <div style="padding:14px 16px; font-size:10px; line-height:1.6;">
            <div style="margin-bottom:8px; display:flex; gap:8px; align-items:baseline;">
                <span style="color:var(--tx-green); letter-spacing:0.08em; font-size:9px;">BEST</span>
                <span style="color:var(--tx-mid);">Opponent always picks the worse pile for you (sends it to GY).</span>
            </div>
            <div style="margin-bottom:8px; display:flex; gap:8px; align-items:baseline;">
                <span style="color:var(--tx-amber); letter-spacing:0.08em; font-size:9px;">REALISTIC</span>
                <span style="color:var(--tx-mid);">Opponent sees face-up pile MV. Sends it to GY if above deck average.</span>
            </div>
            <div style="display:flex; gap:8px; align-items:baseline;">
                <span style="color:var(--tx-red); letter-spacing:0.08em; font-size:9px;">WORST</span>
                <span style="color:var(--tx-mid);">Opponent always picks the better pile for you (denies it).</span>
            </div>
        </div>

        <div class="tx-h"><span>03 · CMC CURVE</span><span class="tx-h-r" id="abstract-n-label">N=99</span></div>
        <div id="abstract-cmc-curve" style="padding:14px 16px;"></div>
    </div>

    <!-- CENTER: hero stats + chart + breakdown -->
    <div class="portent-center">
        <!-- Hero numerics -->
        <div class="portent-hero" id="abstract-hero">
            <div class="tx-stat">
                <div class="tx-stat-label">BEST CASE</div>
                <div class="tx-stat-value" id="abstract-hero-best" style="color:var(--tx-green);">—</div>
                <div class="tx-stat-sub">E[free cast MV]</div>
            </div>
            <div class="tx-stat">
                <div class="tx-stat-label">REALISTIC</div>
                <div class="tx-stat-value medium" id="abstract-hero-realistic" style="color:var(--tx-amber);">—</div>
                <div class="tx-stat-sub">partial-info opp</div>
            </div>
            <div class="tx-stat" style="border-right:none;">
                <div class="tx-stat-label">WORST CASE</div>
                <div class="tx-stat-value medium" id="abstract-hero-worst" style="color:var(--tx-red);">—</div>
                <div class="tx-stat-sub">E[free cast MV]</div>
            </div>
        </div>

        <!-- Chart -->
        <div class="tx-h">
            <span>04 · FREE CAST MV DISTRIBUTION</span>
            <span class="tx-h-r">
                <span style="color:var(--tx-green);">●</span> BEST &nbsp;
                <span style="color:var(--tx-amber);">●</span> REALISTIC &nbsp;
                <span style="color:var(--tx-red);">●</span> WORST
            </span>
        </div>
        <div class="chart-container" style="height:280px; padding:0;">
            <canvas id="abstract-chart" role="img" aria-label="Abstract Performance free cast MV distribution"></canvas>
        </div>

        <!-- MV breakdown table -->
        <div class="tx-h"><span>05 · MV BREAKDOWN</span><span class="tx-h-r">% of trials per scenario</span></div>
        <div id="abstract-breakdown" style="padding:14px 16px;"></div>
    </div>

    <!-- RIGHT RAIL: sample piles -->
    <div class="portent-right">
        <div class="tx-h">
            <span>06 · SAMPLE PILES</span>
            <span class="tx-h-r" id="abstract-reshuffle-btn" style="cursor:pointer;">[ ↻ RESHUFFLE ]</span>
        </div>
        <div id="abstract-samples">
            <div style="padding:20px 16px; color:var(--tx-dim); font-size:10px;">
                Import a decklist to see sample piles.
            </div>
        </div>
    </div>

</div><!-- end portent-grid -->
`;
