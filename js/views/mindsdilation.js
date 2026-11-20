/**
 * mindsdilation — calculator view.
 * Mounted into #mindsdilation-tab by the shell the first time the calculator is opened.
 */

export const template = `
<div class="portent-grid">

    <!-- LEFT RAIL: card info + Sixth Doctor toggle + per-deck breakdown -->
    <div class="portent-left">
        <div class="tx-h"><span>01 · CARD INFO</span><span class="tx-h-r">{5}{U}{U} Enchantment</span></div>
        <div style="padding:16px; font-size:10px; color:var(--tx-mid); line-height:1.6;">
            <div style="margin-bottom:8px; color:var(--tx-text);">Whenever an opponent casts their <span style="color:var(--tx-amber);">first spell each turn</span>, that player exiles the top card of their library.</div>
            <div>If it's a <span style="color:var(--tx-green);">nonland card</span>, you may cast it without paying its mana cost.</div>
        </div>

        <div class="tx-h"><span>02 · SIXTH DOCTOR</span><span class="tx-h-r">modifier</span></div>
        <div style="padding:14px 16px; border-bottom:1px solid var(--tx-rule);">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-size:11px; color:var(--tx-text);">
                <input type="checkbox" id="mnds-sixth-doctor" style="width:14px; height:14px; cursor:pointer; accent-color:var(--tx-amber);">
                <span>The Sixth Doctor is in play</span>
            </label>
            <div style="margin-top:6px; font-size:9px; color:var(--tx-dim); padding-left:24px;">Doubles effective MV of historic spells (artifact, legendary, saga). Marked ★ in exile events.</div>
        </div>

        <div class="tx-h"><span>03 · DECK BREAKDOWN</span></div>
        <div id="mnds-left-content">
            <div style="padding:20px 16px; color:var(--tx-dim); font-size:10px;">Import opponent decklists to see breakdown.</div>
        </div>
    </div>

    <!-- CENTER: hero stats + per-opponent table + MV distribution chart -->
    <div class="portent-center">
        <div class="portent-hero" id="mnds-hero">
            <div class="tx-stat">
                <div class="tx-stat-label">E[MV / ROUND]</div>
                <div class="tx-stat-value" style="color:var(--tx-blue);">—</div>
                <div class="tx-stat-sub">all opponents</div>
            </div>
            <div class="tx-stat">
                <div class="tx-stat-label">E[MV / 10T]</div>
                <div class="tx-stat-value medium" style="color:var(--tx-green);">—</div>
                <div class="tx-stat-sub">projected 10 turns</div>
            </div>
            <div class="tx-stat" style="border-right:none;">
                <div class="tx-stat-label">SIXTH DOCTOR</div>
                <div class="tx-stat-value medium" style="color:var(--tx-dim);">OFF</div>
                <div class="tx-stat-sub">historic ×2 MV</div>
            </div>
        </div>

        <div class="tx-h"><span>04 · OPPONENT BREAKDOWN</span><span class="tx-h-r">per trigger EV</span></div>
        <div id="mnds-table" style="padding:14px 16px;">
            <div style="color:var(--tx-dim); font-size:10px; text-align:center; padding:20px 0;">Import opponent decklists to see analysis.</div>
        </div>

        <div class="tx-h">
            <span>05 · NONLAND MV DISTRIBUTION</span>
            <span class="tx-h-r">% of cards per MV</span>
        </div>
        <div class="chart-container" style="height:260px; padding:0;">
            <canvas id="mnds-chart" role="img" aria-label="Mind's Dilation MV distribution chart"></canvas>
        </div>
    </div>

    <!-- RIGHT RAIL: sample exile events -->
    <div class="portent-right">
        <div class="tx-h">
            <span>06 · SAMPLE EXILE EVENTS</span>
            <span class="tx-h-r" id="mnds-resample-btn" style="cursor:pointer;">[ ↻ RESAMPLE ]</span>
        </div>
        <div id="mnds-samples">
            <div style="padding:20px 16px; color:var(--tx-dim); font-size:10px;">Import opponent decklists to see sample exile events.</div>
        </div>
    </div>

</div><!-- end portent-grid -->
`;
