/**
 * Mulligan Planner — view.
 * Mounted into #mulligan-tab by the shell the first time the page opens. Every
 * container is filled by js/calculators/mulligan.js.
 *
 * Ids kept for share links: mull-penalty, mull-threshold, mulligan-sample-count.
 */

export const template = `
<div class="main-grid single-column mull-layout">
    <section class="panel panel-config" aria-label="What a keepable hand needs">
        <div class="tx-h"><span>Start from</span><span class="tx-h-r" id="mull-deck-note"></span></div>
        <div class="mull-block">
            <div class="mull-templates" id="mull-templates" role="group" aria-label="Starting points built from your deck"></div>
        </div>

        <div class="tx-h"><span>A keepable hand needs</span></div>
        <div class="mull-block">
            <div id="mull-types-container"></div>
            <label class="mull-add">
                <span class="visually-hidden">Add a requirement</span>
                <select id="mull-add-type" class="field field-sm"></select>
            </label>
            <div id="mull-warnings" class="mull-warnings" role="alert"></div>
        </div>

        <div class="tx-h"><span>Your keep rule</span></div>
        <div class="mull-block">
            <div class="seg seg-sm mull-presets" role="group" aria-label="Keep rule presets">
                <button class="seg-btn" type="button" data-preset="casual" aria-pressed="false">Casual</button>
                <button class="seg-btn active" type="button" data-preset="balanced" aria-pressed="true">Balanced</button>
                <button class="seg-btn" type="button" data-preset="competitive" aria-pressed="false">Competitive</button>
            </div>

            <div class="mull-slider">
                <div class="mull-slider-head">
                    <label for="mull-threshold">Keep a seven if it gets there at least</label>
                    <output id="mull-threshold-display" for="mull-threshold">75%</output>
                </div>
                <input type="range" id="mull-threshold" value="75" min="0" max="100" step="1">
                <p class="field-hint" id="mull-threshold-desc"></p>
            </div>

            <div class="mull-slider">
                <div class="mull-slider-head">
                    <label for="mull-penalty">Lower that bar for each card you are down</label>
                    <output id="mull-penalty-display" for="mull-penalty">20%</output>
                </div>
                <input type="range" id="mull-penalty" value="20" min="0" max="100" step="1">
                <p class="field-hint" id="mull-penalty-desc"></p>
            </div>

            <p class="mull-readback" id="mull-bar-readback"></p>
        </div>

        <div class="tx-h"><span>Game</span><span class="tx-h-r" id="mull-format-label"></span></div>
        <div class="mull-block">
            <div class="seg seg-sm" id="mull-turn-order" role="group" aria-label="Turn order" hidden>
                <button class="seg-btn active" type="button" data-play="1" aria-pressed="true">On the play</button>
                <button class="seg-btn" type="button" data-play="0" aria-pressed="false">On the draw</button>
            </div>
            <label class="checkbox-label mull-check">
                <input type="checkbox" id="mull-free">
                <span>First mulligan is free</span>
            </label>
            <p class="field-hint" id="mull-format-note"></p>
        </div>
    </section>

        <section class="panel" aria-label="Mulligan plan">
            <div id="mull-summary" aria-live="polite"></div>
            <div class="tx-h mull-keep-head">
                <span>What to keep</span>
                <div class="seg seg-sm" id="mull-step-seg" role="group" aria-label="Which mulligan"></div>
            </div>
            <div id="mull-keep"></div>
            <details class="tx-collapse" id="mull-steps-details">
                <summary class="tx-collapse-head">Mulligan by mulligan</summary>
                <div class="tx-collapse-body" id="mull-steps"></div>
            </details>
            <details class="tx-collapse" id="mull-tuning-details">
                <summary class="tx-collapse-head">Is the bar right? · Deck tuning</summary>
                <div class="tx-collapse-body" id="mull-tuning"></div>
            </details>
        </section>

        <section class="panel" id="mulligan-sample-reveals" aria-label="Sample games">
            <div class="tx-h"><span>Sample games</span><span class="tx-h-r" id="mull-sim-source"></span></div>
            <div class="tx-sim-controls">
                <label for="mulligan-sample-count">Games</label>
                <input type="number" id="mulligan-sample-count" class="field field-sm" min="1" max="10000" value="500">
                <button id="mulligan-draw-reveals-btn" class="btn btn-ghost btn-sm" type="button">Shuffle again</button>
            </div>
            <div id="mulligan-reveals-display"></div>
        </section>
</div>
`;

export const styles = `
#mulligan-tab .mull-block { padding: var(--pad-y) var(--pad-x) 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
#mulligan-tab .tx-hero { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
#mulligan-tab .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Templates */
#mulligan-tab .mull-templates { display: grid; gap: 6px; }
#mulligan-tab .mull-tpl {
    display: grid; gap: 2px; width: 100%; padding: 8px 10px; text-align: left;
    font: inherit; color: var(--tx-text); background: transparent; cursor: pointer;
    border: 1px solid var(--tx-rule-hi); border-radius: var(--radius-sm);
    transition: border-color var(--transition-fast), background var(--transition-fast);
}
#mulligan-tab .mull-tpl:hover:not(:disabled) { border-color: var(--tx-dim); }
#mulligan-tab .mull-tpl:hover { background: var(--tx-panel-alt); }
#mulligan-tab .mull-tpl.active { border-color: var(--tx-accent); background: var(--accent-soft); }
#mulligan-tab .mull-tpl:disabled { opacity: 0.5; cursor: not-allowed; border-color: var(--tx-rule); }
#mulligan-tab .mull-tpl-name { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
#mulligan-tab .mull-tpl-sub { font-size: var(--t-xs); color: var(--tx-dim); }

/* Requirement rows */
#mulligan-tab .mull-type { padding: 10px 0 12px; border-bottom: 1px solid var(--tx-rule); }
#mulligan-tab .mull-type:first-child { padding-top: 0; }
#mulligan-tab .mull-type-head { display: flex; align-items: center; gap: 8px; }
#mulligan-tab .mull-dot { width: 10px; height: 10px; border-radius: var(--radius-full); flex-shrink: 0; }
#mulligan-tab .mull-type-name {
    flex: 1; min-width: 0; height: 30px; padding: 0 6px; font: inherit; font-size: var(--t-sm);
    font-weight: 600; color: var(--tx-bright); background: transparent;
    border: 1px solid transparent; border-radius: var(--radius-xs);
}
#mulligan-tab .mull-type-name:hover { border-color: var(--tx-rule); }
#mulligan-tab .mull-type-name:focus { outline: none; border-color: var(--tx-accent); background: var(--tx-bg); }
#mulligan-tab .mull-type-fields { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
#mulligan-tab .mull-type-fields label { display: grid; gap: 4px; font-size: var(--t-label); color: var(--tx-dim); }
#mulligan-tab .mull-type-fields .field { width: 100%; text-align: center; font-family: var(--font-mono); }
#mulligan-tab .mull-type-read { margin-top: 8px; font-size: var(--t-xs); line-height: 1.45; color: var(--tx-mid); }
#mulligan-tab .mull-type-read strong { color: var(--tx-text); font-weight: 600; }
#mulligan-tab .mull-src { font-size: var(--t-label); color: var(--tx-dim); white-space: nowrap; }
#mulligan-tab .mull-add .field { width: 100%; }
#mulligan-tab .mull-warnings:empty { display: none; }
#mulligan-tab .mull-warnings { font-size: var(--t-xs); color: var(--tx-bad); line-height: 1.5; display: grid; gap: 4px; }

/* Keep rule */
#mulligan-tab .mull-presets { width: 100%; }
#mulligan-tab .mull-presets .seg-btn { flex: 1; justify-content: center; }
#mulligan-tab .mull-slider { display: grid; gap: 6px; }
#mulligan-tab .mull-slider .field-hint { margin-top: 0; }
#mulligan-tab .mull-slider-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
#mulligan-tab .mull-slider-head label { font-size: var(--t-xs); color: var(--tx-text); }
#mulligan-tab .mull-slider-head output { font-family: var(--font-mono); font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
#mulligan-tab .mull-readback {
    padding: 8px 10px; border-radius: var(--radius-sm); background: var(--tx-panel-alt);
    font-size: var(--t-xs); line-height: 1.5; color: var(--tx-mid);
}
#mulligan-tab .mull-readback strong { color: var(--tx-bright); font-family: var(--font-mono); font-weight: 600; }
#mulligan-tab .mull-check { margin: 0; }

/* What to keep */
#mulligan-tab .mull-keep-head { flex-wrap: wrap; }
#mulligan-tab .mull-keep-body { padding: 14px var(--pad-x) 16px; display: grid; gap: 14px; }
#mulligan-tab .mull-keep-caption { font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.5; }
#mulligan-tab .mull-rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
#mulligan-tab .mull-rules li { display: flex; align-items: baseline; gap: 10px; font-size: var(--t-sm); color: var(--tx-text); }
#mulligan-tab .mull-rule-call {
    flex-shrink: 0; min-width: 76px; padding: 2px 8px; border-radius: var(--radius-full); text-align: center;
    font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase;
}
#mulligan-tab .is-keep .mull-rule-call { color: var(--tx-good); background: var(--good-soft); }
#mulligan-tab .is-some .mull-rule-call { color: var(--tx-warn); background: var(--warn-soft); }
#mulligan-tab .is-mull .mull-rule-call { color: var(--tx-mid); background: var(--tx-panel-alt); }
#mulligan-tab .mull-rule-label { font-weight: 600; color: var(--tx-bright); }

#mulligan-tab .mull-grid-wrap { overflow-x: auto; }
#mulligan-tab .mull-kgrid { border-collapse: separate; border-spacing: 3px; font-family: var(--font-mono); font-size: var(--t-xs); }
#mulligan-tab .mull-kgrid caption { caption-side: bottom; text-align: left; padding-top: 6px; font-family: var(--font-body); font-size: var(--t-xs); color: var(--tx-dim); }
#mulligan-tab .mull-kgrid th { padding: 2px 6px; font-weight: 500; color: var(--tx-dim); text-align: center; white-space: nowrap; }
#mulligan-tab .mull-kgrid th.mull-axis { font-family: var(--font-body); text-align: left; color: var(--tx-mid); }
#mulligan-tab .mull-kgrid td {
    position: relative; min-width: 46px; height: 34px; padding: 0 4px; text-align: center;
    color: var(--tx-dim); background: var(--tx-panel-alt); border: 1px solid var(--tx-rule); border-radius: var(--radius-xs);
}
#mulligan-tab .mull-kgrid td.is-keep { color: var(--tx-good); font-weight: 600; background: var(--good-soft); border-color: color-mix(in srgb, var(--tx-good) 35%, transparent); }
#mulligan-tab .mull-kgrid td.is-over { color: var(--tx-bad); background: var(--bad-soft); border-color: transparent; }
#mulligan-tab .mull-kgrid td.is-none { background: transparent; border-color: transparent; }
#mulligan-tab .mull-freq { position: absolute; left: 3px; bottom: 2px; height: 2px; border-radius: 2px; background: currentColor; opacity: 0.45; }
#mulligan-tab .mull-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--t-xs); color: var(--tx-dim); }
#mulligan-tab .mull-legend span::before {
    content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px;
    border-radius: var(--radius-xs); border: 1px solid var(--tx-rule); background: var(--tx-panel-alt);
}
#mulligan-tab .mull-legend .lg-keep::before { background: var(--good-soft); border-color: var(--tx-good); }
#mulligan-tab .mull-legend .lg-over::before { background: var(--bad-soft); border-color: transparent; }

#mulligan-tab .mull-table { width: 100%; border-collapse: collapse; font-size: var(--t-xs); }
#mulligan-tab .mull-table th { text-align: right; font-weight: 500; color: var(--tx-dim); padding: 6px 8px; border-bottom: 1px solid var(--tx-rule); white-space: nowrap; }
#mulligan-tab .mull-table td { text-align: right; padding: 6px 8px; font-family: var(--font-mono); color: var(--tx-text); border-bottom: 1px solid var(--tx-rule); }
#mulligan-tab .mull-table th:first-child, #mulligan-tab .mull-table td:first-child { text-align: left; font-family: var(--font-body); }
#mulligan-tab .mull-note { font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.5; margin-top: 10px; }
#mulligan-tab .mull-tune { display: grid; gap: 14px; font-size: var(--t-sm); color: var(--tx-text); line-height: 1.5; }
#mulligan-tab .mull-tune h4 { margin: 0 0 4px; font-size: var(--t-xs); font-weight: 600; color: var(--tx-mid); }
#mulligan-tab .mull-gains { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
#mulligan-tab .mull-gains li { display: flex; justify-content: space-between; gap: 12px; }
#mulligan-tab .mull-gains .num { font-family: var(--font-mono); font-weight: 600; }
#mulligan-tab .mull-gains .is-good { color: var(--tx-good); }
#mulligan-tab .mull-gains .is-flat { color: var(--tx-dim); }

/* Sample games */
#mulligan-tab .mull-sim-stats { padding: var(--pad-y) var(--pad-x); font-size: var(--t-sm); color: var(--tx-mid); line-height: 1.5; border-bottom: 1px solid var(--tx-rule); }
#mulligan-tab .mull-sim-stats strong { color: var(--tx-bright); font-family: var(--font-mono); }
#mulligan-tab .mull-games { display: grid; }
#mulligan-tab .mull-game { padding: var(--pad-y) var(--pad-x); border-bottom: 1px solid var(--tx-rule); display: grid; gap: 8px; }
#mulligan-tab .mull-game-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; font-size: var(--t-xs); color: var(--tx-mid); }
#mulligan-tab .mull-game-head strong { color: var(--tx-bright); font-weight: 600; }
#mulligan-tab .mull-result { font-weight: 600; }
#mulligan-tab .mull-result.is-good { color: var(--tx-good); }
#mulligan-tab .mull-result.is-bad { color: var(--tx-bad); }
#mulligan-tab .mull-line { display: flex; gap: 8px; align-items: flex-start; }
#mulligan-tab .mull-line-label { flex: 0 0 64px; padding-top: 3px; font-size: var(--t-label); color: var(--tx-dim); }
#mulligan-tab .mull-line.is-mulled .mull-card { color: var(--tx-dim); background: transparent; border-style: dashed; }
#mulligan-tab .mull-cards { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
#mulligan-tab .mull-card {
    display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 2px 7px;
    font-size: var(--t-xs); color: var(--tx-text); background: var(--tx-panel-alt);
    border: 1px solid var(--tx-rule); border-radius: var(--radius-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#mulligan-tab .mull-card[data-card] { cursor: zoom-in; }
#mulligan-tab .mull-card.is-other { color: var(--tx-dim); }
#mulligan-tab .mull-card.is-bottom { text-decoration: line-through; color: var(--tx-dim); background: transparent; border-style: dashed; }
#mulligan-tab .mull-card .mull-dot { width: 7px; height: 7px; }
#mulligan-tab .mull-turn { font-size: var(--t-label); color: var(--tx-dim); font-family: var(--font-mono); }
#mulligan-tab .mull-more { margin: 12px 16px 16px; }
#mulligan-tab .mull-empty { padding: 16px; font-size: var(--t-sm); color: var(--tx-dim); }

#mulligan-tab .mull-draw { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }

@container shell (max-width: 560px) {
    #mulligan-tab .mull-line { flex-direction: column; gap: 4px; }
    #mulligan-tab .mull-line-label { flex-basis: auto; padding-top: 0; }
    #mulligan-tab .mull-kgrid { border-spacing: 2px; font-size: var(--t-label); }
    #mulligan-tab .mull-kgrid td { min-width: 31px; height: 30px; padding: 0 2px; }
    #mulligan-tab .mull-kgrid th { padding: 2px 3px; }
    #mulligan-tab .mull-kgrid th.mull-axis { white-space: normal; min-width: 64px; }
    #mulligan-tab .mull-table th, #mulligan-tab .mull-table td { padding: 6px 4px; }
}
`;

export const guide = {
    intro: 'Tell the planner what an opening hand needs — enough lands, a ramp piece, an early play — and it works out exactly which sevens to keep, how often you will find one, and how often the hand you keep has everything on time. Start from a template built from your list, then adjust.',
    howToRead: [
        '<strong>Hands that get there</strong> is the chance the hand you finally keep has every requirement met by its turn, after all the mulligans your rule takes.',
        '<strong>What to keep</strong> lists your rule in plain words and shows every possible seven as a grid. Green cells are keeps; the number is that hand’s chance to get there; the thin bar shows how often you see it. Switch tabs to see how the rule loosens after each mulligan.',
        '<strong>Sevens you keep</strong> and <strong>average mulligans</strong> show what the rule costs. A strict bar finds better hands but sends you to six or five more often.',
        '<strong>Sample games</strong> shuffles your real list (or stand-in cards for counts you typed) and plays the rule out, so you can see the hands behind the numbers.'
    ],
    method: 'Exact, not simulated. Every possible seven is enumerated with the multivariate hypergeometric formula; for each, the chance of drawing what is missing before each requirement’s turn is computed turn by turn, after putting the least useful cards on the bottom. The keep rule is applied at each mulligan in turn: keep if the chance meets your bar, where the bar drops by your chosen percentage for every card the hand is down. The sample games are a separate simulation that should land close to the exact figures.',
    assumptions: [
        'London mulligan: draw seven, then put one card on the bottom per mulligan. In multiplayer Commander the first mulligan is free and everyone draws on turn one; in 60- and 40-card games the player on the play skips their first draw.',
        'Groups don’t overlap: each card counts toward the first requirement it fits. Templates use your list’s land, ramp and mana-value data; ramp is detected from rules text and can miss odd wordings.',
        '“At most” limits apply to the hand you keep, after bottoming — so a six-land seven can still become a keepable five-land six.',
        'Cards you put on the bottom are never drawn in the turns that matter. Card draw, tutors and scry are not counted.',
        'If no hand passes the bar, you keep whatever you see when you are down to one card.'
    ],
    tips: [
        'If you keep under two-thirds of your sevens, your requirements are stricter than the deck supports: loosen a deadline by a turn or add a few cards to the bottleneck group.',
        '“Is the bar right?” shows how many mulliganed hands would have been fine and how many keeps fail — if the first is large, lower the bar; if the second is, raise it.',
        'Deck tuning shows what one more card of each group (swapped for a card that counts toward nothing) is worth. Small numbers mean you have enough.'
    ],
    terms: ['mulligan', 'play', 'exact', 'hypergeometric', 'simulation', 'library']
};
