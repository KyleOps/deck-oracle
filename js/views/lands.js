/**
 * Land Drops — view.
 * Mounted into #lands-tab by the shell the first time the page opens. Every
 * container is filled by js/calculators/lands.js. Only three settings change
 * the answer, so they sit in a strip above the turn-by-turn odds instead of a
 * side rail.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel" aria-label="Land drop odds">
        <div id="lands-summary" aria-live="polite"></div>
        <div id="lands-hero"></div>

        <div class="ld-controls" role="group" aria-label="Assumptions">
            <div class="seg seg-sm" id="lands-turn-order" role="group" aria-label="Turn order" hidden>
                <button class="seg-btn active" type="button" data-play="1" aria-pressed="true">On the play</button>
                <button class="seg-btn" type="button" data-play="0" aria-pressed="false">On the draw</button>
            </div>
            <span class="ld-format" id="lands-format-note"></span>
            <label class="checkbox-label ld-check">
                <input type="checkbox" id="lands-mull" checked>
                <span>Mulligan sevens with fewer than
                    <input type="number" id="lands-keep-min" class="field field-sm ld-num" value="2" min="0" max="7" aria-label="Fewest lands you keep">
                    or more than
                    <input type="number" id="lands-keep-max" class="field field-sm ld-num" value="5" min="0" max="7" aria-label="Most lands you keep">
                    lands</span>
            </label>
            <label class="checkbox-label ld-check" id="lands-ramp-wrap" hidden>
                <input type="checkbox" id="lands-ramp">
                <span id="lands-ramp-label">Count cheap ramp as land drops</span>
            </label>
        </div>

        <div class="tx-h"><span>Turn by turn</span><span class="tx-h-r">chance you have made every land drop so far</span></div>
        <div id="lands-ladder"></div>
    </section>

    <div class="panel-row">
        <section class="panel" aria-labelledby="lands-opening-title">
            <div class="tx-h"><span id="lands-opening-title">Lands in your opening seven</span><span class="tx-h-r" id="lands-opening-meta"></span></div>
            <div id="lands-opening"></div>
        </section>

        <section class="panel" aria-labelledby="lands-compare-title">
            <div class="tx-h"><span id="lands-compare-title">More or fewer lands</span><span class="tx-h-r">swapped for spells</span></div>
            <div id="lands-compare"></div>
        </section>
    </div>

    <section class="panel" id="lands-sample-reveals" aria-label="Sample games">
        <details class="tx-collapse ld-samples" id="lands-samples-details">
            <summary class="tx-collapse-head">Sample games from your list</summary>
            <div id="lands-reveals-display"></div>
        </details>
    </section>
</div>
`;

export const styles = `
#lands-tab .tx-hero { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }

/* Assumptions strip */
#lands-tab .ld-controls {
    display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px;
    padding: var(--pad-y) var(--pad-x); border-bottom: 1px solid var(--tx-rule); background: var(--tx-panel-alt);
}
#lands-tab .ld-format { font-size: var(--t-xs); color: var(--tx-mid); }
#lands-tab .ld-format:empty { display: none; }
#lands-tab .ld-check { margin: 0; font-size: var(--t-xs); color: var(--tx-text); line-height: 1.6; }
#lands-tab .ld-num { width: 46px; height: 26px; padding: 0 4px; text-align: center; font-family: var(--font-mono); }

/* Turn-by-turn ladder */
#lands-tab .ld-ladder { list-style: none; margin: 0; padding: 8px var(--pad-x) 14px; display: grid; }
#lands-tab .ld-row {
    display: grid; grid-template-columns: 64px minmax(80px, 1fr) 48px 150px; align-items: center; gap: 12px;
    padding: 7px 0; border-bottom: 1px solid var(--tx-rule); font-size: var(--t-sm);
}
#lands-tab .ld-row:last-child { border-bottom: 0; }
#lands-tab .ld-turn { color: var(--tx-mid); font-weight: 600; }
#lands-tab .ld-bar { position: relative; height: 10px; border-radius: var(--radius-full); background: var(--tx-rule); overflow: hidden; }
#lands-tab .ld-fill { position: absolute; inset: 0 auto 0 0; border-radius: var(--radius-full); background: var(--tx-flat); transition: width var(--transition-slow); }
#lands-tab .ld-ghost { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--tx-text); opacity: 0.55; }
#lands-tab .tone-good .ld-fill { background: var(--tx-good); }
#lands-tab .tone-warn .ld-fill { background: var(--tx-warn); }
#lands-tab .ld-pct { font-family: var(--font-mono); font-weight: 600; color: var(--tx-bright); text-align: right; }
#lands-tab .ld-words { font-size: var(--t-xs); color: var(--tx-mid); }
#lands-tab .ld-words small { display: block; font-size: var(--t-label); color: var(--tx-dim); }
#lands-tab .ld-flag { color: var(--tx-warn); font-weight: 600; }

/* Opening-seven bars */
#lands-tab .ld-dist { padding: 16px 16px 10px; }
#lands-tab .ld-cols { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; align-items: end; height: 170px; }
#lands-tab .ld-col { display: grid; grid-template-rows: auto 1fr auto; height: 100%; text-align: center; gap: 4px; }
#lands-tab .ld-col-val { font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-mid); }
#lands-tab .ld-col-track { display: flex; align-items: flex-end; min-height: 0; }
#lands-tab .ld-col-fill { width: 100%; min-height: 2px; border-radius: var(--radius-xs) var(--radius-xs) 0 0; background: var(--tx-rule-hi); }
#lands-tab .ld-col.is-keep .ld-col-fill { background: var(--type-land); }
#lands-tab .ld-col-label { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-dim); }
#lands-tab .ld-col.is-keep .ld-col-label { color: var(--tx-text); font-weight: 600; }
#lands-tab .ld-caption { padding: 0 var(--pad-x) 14px; font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.5; }

/* Land-count comparison */
#lands-tab .ld-table { width: 100%; border-collapse: collapse; font-size: var(--t-sm); }
#lands-tab .ld-table th { padding: 8px 12px; text-align: right; font-size: var(--t-xs); font-weight: 500; color: var(--tx-dim); border-bottom: 1px solid var(--tx-rule); white-space: nowrap; }
#lands-tab .ld-table td { padding: 8px 12px; text-align: right; font-family: var(--font-mono); color: var(--tx-text); border-bottom: 1px solid var(--tx-rule); white-space: nowrap; }
#lands-tab .ld-table th:first-child, #lands-tab .ld-table td:first-child { text-align: left; }
#lands-tab .ld-table tr.is-current td { background: var(--accent-soft); color: var(--tx-bright); font-weight: 600; }
#lands-tab .ld-table tr.is-current td:first-child { box-shadow: inset 3px 0 0 var(--tx-accent); }
#lands-tab .ld-table .ld-diff { display: block; font-size: var(--t-label); font-weight: 400; color: var(--tx-dim); }
#lands-tab .ld-table .ld-you { font-family: var(--font-body); font-size: var(--t-label); font-weight: 500; color: var(--tx-mid); margin-left: 6px; }
#lands-tab .ld-wrap { overflow-x: auto; }

/* Sample games */
#lands-tab .ld-samples .tx-collapse-body { max-height: none; padding: 0; }
#lands-tab .ld-games { display: grid; }
#lands-tab .ld-game { padding: var(--pad-y) var(--pad-x); border-bottom: 1px solid var(--tx-rule); display: grid; gap: 8px; }
#lands-tab .ld-game-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: var(--t-xs); color: var(--tx-mid); }
#lands-tab .ld-game-head strong { color: var(--tx-bright); }
#lands-tab .ld-result { font-weight: 600; }
#lands-tab .ld-result.is-good { color: var(--tx-good); }
#lands-tab .ld-result.is-warn { color: var(--tx-warn); }
#lands-tab .ld-line { display: flex; gap: 8px; align-items: flex-start; }
#lands-tab .ld-line-label { flex: 0 0 64px; padding-top: 3px; font-size: var(--t-label); color: var(--tx-dim); }
#lands-tab .ld-cards { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
#lands-tab .ld-card {
    display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 2px 7px; cursor: zoom-in;
    font-size: var(--t-xs); color: var(--tx-dim); background: var(--tx-panel-alt);
    border: 1px solid var(--tx-rule); border-radius: var(--radius-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#lands-tab .ld-card.is-land, #lands-tab .ld-card.is-ramp { color: var(--tx-text); }
#lands-tab .ld-card.is-bottom { text-decoration: line-through; background: transparent; border-style: dashed; color: var(--tx-dim); }
#lands-tab .ld-card-dot { width: 7px; height: 7px; border-radius: var(--radius-full); flex-shrink: 0; }
#lands-tab .ld-card.is-land .ld-card-dot { background: var(--type-land); }
#lands-tab .ld-card.is-ramp .ld-card-dot { background: var(--type-artifact); }
#lands-tab .ld-turnmark { font-family: var(--font-mono); font-size: var(--t-label); color: var(--tx-dim); }
#lands-tab .ld-drops { display: flex; flex-wrap: wrap; gap: 4px; }
#lands-tab .ld-drop { padding: 1px 6px; border-radius: var(--radius-xs); font-family: var(--font-mono); font-size: var(--t-label); }
#lands-tab .ld-drop.is-made { color: var(--tx-good); background: var(--good-soft); }
#lands-tab .ld-drop.is-missed { color: var(--tx-bad); background: var(--bad-soft); }
#lands-tab .ld-samples-foot { display: flex; gap: 8px; flex-wrap: wrap; padding: var(--pad-y) var(--pad-x) 16px; }
#lands-tab .ld-empty { padding: 16px; font-size: var(--t-sm); color: var(--tx-dim); }

#lands-tab .ld-draw { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }

@container shell (max-width: 640px) {
    #lands-tab .ld-table th, #lands-tab .ld-table td { padding: 8px 6px; }
    #lands-tab .ld-row { grid-template-columns: 56px minmax(60px, 1fr) 44px; }
    #lands-tab .ld-words { grid-column: 2 / -1; margin-top: -4px; }
    #lands-tab .ld-line { flex-direction: column; gap: 4px; }
    #lands-tab .ld-line-label { flex-basis: auto; padding-top: 0; }
}
`;

export const guide = {
    intro: 'How often you will have a land to play each turn, from your real land count. Each row is the chance you have made every land drop up to and including that turn — the moment you miss one, you are behind for the rest of the game.',
    howToRead: [
        '<strong>Turn by turn</strong>: the bar is the chance you have hit every land drop through that turn. Green is likely, amber is a coin flip or so; every deck runs out of land drops eventually, so the late turns are always low.',
        '<strong>First likely miss</strong> is the first turn by which most games have already missed a drop.',
        '<strong>Lands in your opening seven</strong> shows how many lands a random seven holds; the shaded bars are the hands you keep.',
        '<strong>More or fewer lands</strong> shows the same odds with one or two lands swapped for spells (or back), so you can see what a change buys.'
    ],
    method: 'Exact. You draw one card a turn, so having at least T lands among the cards seen by turn T means you made every drop up to T. That chance comes straight from the hypergeometric formula. With the mulligan option on, sevens outside your keep range are shuffled away (London mulligan: draw seven, spells go to the bottom first), and the odds are averaged over how often you keep at each mulligan.',
    assumptions: [
        'Commander: everyone draws on turn one and the first mulligan is free. 60- and 40-card games: the player on the play skips their first draw.',
        'Card draw, tutors, scry and land-fetching from the library aren’t counted — only lands (and, if you tick it, cheap ramp) you naturally draw.',
        'Counting ramp treats each ramp card costing 3 or less (rocks, dorks, land-fetch spells) as if it were a land. That is roughly right for keeping up with mana, but a ramp spell needs mana to cast first.',
        'Ramp is detected from rules text and can miss odd wordings.'
    ],
    tips: [
        'If turn 4 is under about 70%, one or two more lands (or cheap ramp) usually pays for itself — check the comparison table.',
        'Low-curve decks can live with lower late-turn numbers: what matters is the turn your spells need the mana.',
        'The Mulligan Planner sets keep rules beyond land counts, such as needing a ramp piece or an early play.'
    ],
    terms: ['exact', 'hypergeometric', 'play', 'mulligan', 'library']
};
