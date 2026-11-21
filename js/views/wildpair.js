/**
 * Wild Pair — view.
 * Mounted into #wildpair-tab by the shell the first time the page is opened;
 * every container below is filled by js/calculators/wildpair.js.
 */

export const template = `
<div class="main-grid single-column">
    <section class="panel panel-config" aria-label="Pick a total">
        <div class="tx-h"><span>Total power + toughness</span></div>
        <div class="wp-rail">
            <label class="wp-label" for="wildpair-totalSlider">The one number Wild Pair matches on</label>
            <div class="wp-big">
                <span class="tx-display" id="wildpair-total-display">&mdash;</span>
                <span class="wp-big-unit">power + toughness</span>
            </div>
            <p class="wp-rail-sum" id="wildpair-total-summary">&mdash;</p>
            <input type="range" id="wildpair-totalSlider" value="0" min="0" max="0" step="1">
            <div class="wp-scale" id="wildpair-total-scale"><span>&mdash;</span><span>&mdash;</span></div>
            <p class="field-hint" id="wildpair-total-stops"></p>
            <p class="field-hint">A 5/5 and a 3/7 match; a 5/5 and a 5/6 never do. Click any group to jump to it.</p>
        </div>
    </section>

    <section class="panel" id="wildpair-answer" aria-label="What Wild Pair does for this deck"></section>

    <section class="panel" id="wildpair-group" aria-label="Creatures at the selected total"></section>

    <section class="panel" id="wildpair-groups" aria-label="Every group in the deck"></section>

    <section class="panel wp-more-panel" id="wildpair-more" aria-label="More detail">
        <details class="tx-collapse">
            <summary class="tx-collapse-head">Best line at each total</summary>
            <div class="tx-collapse-body wp-flush">
                <div class="wp-table-wrap" id="wildpair-pairings"></div>
            </div>
        </details>
        <details class="tx-collapse" id="wildpair-more-chart">
            <summary class="tx-collapse-head">Every total in the deck</summary>
            <div class="tx-collapse-body wp-flush">
                <div class="chart-container wp-chart">
                    <canvas id="wildpair-pt-chart" role="img" aria-label="Creatures at each total power and toughness"></canvas>
                </div>
                <p class="tx-caption is-below wp-caption">Each bar is one total. Green bars share it with another creature, so Wild Pair can find something; red bars are alone. Click a bar to inspect it.</p>
                <div class="wp-table-wrap" id="wildpair-sweepTable"></div>
            </div>
        </details>
    </section>
</div>
`;

export const styles = `
/* Wild Pair searches rather than reveals, so the product is the GROUPING:
   which creatures find each other, with the mana consequence second. One
   shape repeats at three scales: a fixed-width total badge, the creatures
   that share it, and what an activation there is worth. (Moved here from
   components.css: only this page uses it, and views load lazily.) */
/* --- The search pool: the full roster at the selected total --- */
/* Members of a total are interchangeable, so the roster carries printed stats
   and nothing else. Columns are fixed width and tabular so P/T and MV line up
   down the list; the bar makes the pool's mana spread readable at a glance,
   which is the thing a repeated "best find" column failed to show. */
#wildpair-tab .wp-opt-list { display: grid; list-style: none; margin: 0; padding: 0; }
#wildpair-tab .wp-opt {
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr) 62px minmax(60px, 130px) 26px;
    gap: 12px;
    align-items: center;
    border-bottom: 1px solid var(--tx-rule);
    font-size: var(--t-xs);
    padding: 8px var(--pad-x);
}
#wildpair-tab .wp-opt:last-child { border-bottom: 0; }
#wildpair-tab .wp-opt:hover { background: var(--tx-row-hi); }
#wildpair-tab .wp-opt-head {
    color: var(--tx-dim);
    background: var(--tx-panel-alt);
    font-size: var(--t-label);
    letter-spacing: 0;
    text-transform: none;
}
#wildpair-tab .wp-opt-head:hover { background: var(--tx-panel-alt); }
#wildpair-tab .wp-opt-pt { font-feature-settings: 'tnum' 1; color: var(--tx-mid); }
#wildpair-tab .wp-opt-head .wp-opt-pt, #wildpair-tab .wp-opt-head .wp-opt-mv { color: var(--tx-dim); }
#wildpair-tab .wp-opt-name { color: var(--tx-text); text-overflow: ellipsis; white-space: nowrap; overflow: visible; }

/* The two ends of the swing, marked so the headline above can be traced into
   the list. Everything between them is just as castable and just as findable. */
#wildpair-tab .wp-opt-edge { color: var(--tx-dim); text-align: right; font-size: var(--t-label); letter-spacing: 0; }
#wildpair-tab .wp-opt.is-low .wp-opt-name, #wildpair-tab .wp-opt.is-high .wp-opt-name { color: var(--tx-bright); }
#wildpair-tab .wp-opt.is-high .wp-opt-edge { color: var(--tx-good); }
#wildpair-tab .wp-opt-bar { display: block; height: 6px; background: var(--tx-rule); }
#wildpair-tab .wp-opt-bar-fill { display: block; height: 100%; background: var(--tx-mid); }
#wildpair-tab .wp-opt.is-high .wp-opt-bar-fill { background: var(--tx-good); }
#wildpair-tab .wp-opt-head .wp-opt-bar { background: transparent; }
#wildpair-tab .wp-opt-mv {
    text-align: right;
    font-feature-settings: 'tnum' 1;
    color: var(--tx-bright);
    font-weight: 600;
}
#wildpair-tab .wp-opt.is-high .wp-opt-mv { color: var(--tx-good); }

/* --- All groups: the at-a-glance grid --- */
/* Auto-fill so the grid gains COLUMNS as the shell widens rather than just
   stretching, which is the layout rule the rest of the app follows. */
/* Hairlines come from each block's outline, which overlaps its neighbour's in
   the 1px gap; a spare cell on the last row then stays panel-coloured instead
   of showing the grid's background as a solid block. */
#wildpair-tab .wp-gc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1px;
    background: transparent;
    border-bottom: 0;
}
#wildpair-tab .wp-gc {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    text-align: left;
    background: var(--tx-panel);
    border: 0;
    font-family: inherit;
    font-size: var(--t-xs);
    color: inherit;
    transition: background 0.1s;
    cursor: pointer;
    padding: var(--pad-y) var(--pad-x);
    outline: 1px solid var(--tx-rule);
}
#wildpair-tab .wp-gc:hover { background: var(--tx-panel-alt); }

/* The accent marks the one selected group — the same job it does on the active
   tab and the recommended row. */
#wildpair-tab .wp-gc.is-selected { background: var(--tx-row-hi); box-shadow: inset 2px 0 0 var(--tx-accent); }

/* Header: the total badge, the count, and the swing pinned to the right edge so
   the deltas form a straight column down the grid. */
#wildpair-tab .wp-gc-head {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
}
#wildpair-tab .wp-gc-total {
    font-size: var(--t-lg);
    font-weight: 700;
    line-height: 1;
    color: var(--tx-bright);
    font-feature-settings: 'tnum' 1;
    border: 1px solid var(--tx-rule-hi);
    padding: 5px 0;
    text-align: center;
    border-radius: var(--radius-sm);
}
#wildpair-tab .wp-gc.is-selected .wp-gc-total { border-color: var(--tx-accent); }
#wildpair-tab .wp-gc-swing {
    font-size: var(--t-body);
    font-weight: 700;
    font-feature-settings: 'tnum' 1;
    line-height: 1;
}
#wildpair-tab .wp-gc-cards {
    list-style: none;
    margin: 9px 0 0;
    padding: 9px 0 0;
    display: grid;
    gap: 4px;
    border-top: 1px solid var(--tx-rule);
}

/* Fixed side columns keep P/T and MV in straight lines across every card in the
   grid, which is what stops a wall of these reading as noise. */
#wildpair-tab .wp-gc-card {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 22px;
    gap: 10px;
    align-items: baseline;
}
#wildpair-tab .wp-gc-pt { color: var(--tx-dim); font-feature-settings: 'tnum' 1; }
#wildpair-tab .wp-gc-name { color: var(--tx-text); text-overflow: ellipsis; overflow: visible; white-space: normal; }
#wildpair-tab .wp-gc-mv { text-align: right; color: var(--tx-mid); font-feature-settings: 'tnum' 1; }
#wildpair-tab .wp-single-list { display: flex; flex-wrap: wrap; padding: var(--pad-y) var(--pad-x) 16px; gap: 6px; }
#wildpair-tab .wp-single {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 7px;
    border: 1px solid var(--tx-rule);
    background: var(--tx-panel);
    font-family: inherit;
    font-size: var(--t-xs);
    color: var(--tx-dim);
    max-width: 100%;
    overflow: hidden;
    cursor: pointer;
}
#wildpair-tab .wp-single:hover { border-color: var(--tx-rule-hi); background: var(--tx-panel-alt); }
#wildpair-tab .wp-single-total {
    color: var(--tx-bad);
    font-weight: 600;
    font-feature-settings: 'tnum' 1;
    font-family: var(--font-mono);
}
#wildpair-tab .wp-single-name { color: var(--tx-mid); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#wildpair-tab .wp-single-pt { font-feature-settings: 'tnum' 1; font-family: var(--font-mono); color: var(--tx-dim); }

/* The pair ladder carries more columns than the other sweep tables, so it is
   the one that runs out of room first. Let it scroll inside its own box rather
   than be clipped by an ancestor, and drop the P/T strip when narrow. */
#wildpair-tab #wildpair-sweepTable { overflow-x: auto; }
@container shell (max-width: 720px) {
    #wildpair-tab #wildpair-sweepTable .tx-sweep-table th:last-child, #wildpair-tab #wildpair-sweepTable .tx-sweep-table td:last-child {
        display: none;
    }
}
@container shell (max-width: 590px) {

    /* The spread bar is the first thing to go when the row gets tight — the
       printed numbers beside it say the same thing. */
    #wildpair-tab .wp-opt { grid-template-columns: 46px minmax(0, 1fr) 26px; gap: 10px; }
    #wildpair-tab .wp-opt-edge, #wildpair-tab .wp-opt-bar { display: none; }
}

/* ---- Rail ---- */
#wildpair-tab .wp-rail { padding: 16px; display: grid; gap: 8px; }
#wildpair-tab .wp-label { font-size: var(--t-xs); font-weight: 600; color: var(--tx-mid); }
#wildpair-tab .wp-big { display: flex; align-items: baseline; gap: 10px; }
#wildpair-tab .wp-big-unit { font-size: var(--t-xs); color: var(--tx-dim); }
#wildpair-tab .wp-rail-sum { margin: 0; font-size: var(--t-sm); color: var(--tx-text); }
#wildpair-tab .wp-scale {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-dim);
}

/* ---- Answer ---- */
#wildpair-tab .tx-hero .tx-stat:first-child .tx-stat-value { font-size: var(--t-xxl); }
#wildpair-tab .wp-fit-note, #wildpair-tab .wp-datanote p {
    margin: 0;
    padding: 12px 18px;
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--tx-mid);
}
#wildpair-tab .wp-fit-note strong { color: var(--tx-text); }
#wildpair-tab .wp-datanote { border-top: 1px solid var(--tx-rule); }
#wildpair-tab .wp-datanote p { padding-top: 10px; padding-bottom: 10px; color: var(--tx-warn); }
#wildpair-tab .wp-datanote p + p { padding-top: 0; }

/* ---- Selected group ---- */
#wildpair-tab .wp-sel {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 16px;
    align-items: center;
    padding: 14px var(--pad-x);
    border-bottom: 1px solid var(--tx-rule);
    background: var(--tx-panel-alt);
}
#wildpair-tab .wp-sel-key {
    min-width: 64px;
    padding: 8px 12px;
    border: 1px solid var(--tx-accent);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--t-xxl);
    font-weight: 700;
    line-height: 1;
    text-align: center;
    color: var(--tx-bright);
    font-feature-settings: 'tnum' 1;
}
#wildpair-tab .wp-sel.is-empty .wp-sel-key { border-color: var(--tx-rule-hi); color: var(--tx-dim); }
#wildpair-tab .wp-sel-lead {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--tx-text);
    text-wrap: pretty;
}
#wildpair-tab .wp-sel-lead strong { color: var(--tx-good); }
#wildpair-tab .wp-opt-name .card-ref { color: var(--tx-text); }
#wildpair-tab .wp-opt.is-high .wp-opt-name .card-ref, #wildpair-tab .wp-opt.is-low .wp-opt-name .card-ref {
    color: var(--tx-bright);
}
#wildpair-tab .wp-opt-bar, #wildpair-tab .wp-opt-bar-fill { border-radius: var(--radius-full); }
#wildpair-tab .wp-gc .wp-gc-head {
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
#wildpair-tab .wp-gc .wp-gc-head:hover { background: none; }
#wildpair-tab .wp-gc .wp-gc-head:focus-visible { outline: 2px solid var(--tx-accent); outline-offset: 4px; }
#wildpair-tab .wp-gc-n { font-size: var(--t-xs); letter-spacing: 0; text-transform: none; color: var(--tx-mid); }
#wildpair-tab .wp-gc-name .card-ref { color: var(--tx-text); }
#wildpair-tab .wp-up { color: var(--tx-dim); font-family: var(--font-mono); font-weight: 700; }
#wildpair-tab .wp-up.is-up { color: var(--tx-good); }
#wildpair-tab .wp-single-head { border-top: 0; }
#wildpair-tab .wp-gc-grid + .wp-single-head { border-top: 1px solid var(--tx-rule); }
#wildpair-tab button.wp-single {
    padding: 4px 9px;
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-full);
    background: var(--tx-panel);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--tx-mid);
}
#wildpair-tab button.wp-single:hover {
    border-color: var(--tx-rule-hi);
    background: var(--tx-panel-alt);
    color: var(--tx-text);
}
#wildpair-tab button.wp-single.is-selected { border-color: var(--tx-accent); color: var(--tx-bright); }

/* ---- Secondary detail ---- */
#wildpair-tab .wp-more-panel .tx-collapse:first-child { border-top: 0; }
#wildpair-tab .wp-more-panel .tx-collapse-body { max-height: none; }
#wildpair-tab .wp-flush { padding: 0; }
#wildpair-tab .wp-table-wrap { overflow-x: auto; }
#wildpair-tab .wp-table-wrap .tx-sweep-table { min-width: max-content; }
#wildpair-tab .wp-table-wrap tr[data-total] { cursor: pointer; }
#wildpair-tab .wp-chart { height: 260px; padding: 12px 12px 0; }
#wildpair-tab .wp-caption { border-bottom: 1px solid var(--tx-rule); }
#wildpair-tab .wp-dim { color: var(--tx-dim); }
#wildpair-tab .wp-yes { color: var(--tx-good); }
#wildpair-tab .wp-no { color: var(--tx-bad); }
@container shell (max-width: 530px) {
    #wildpair-tab .wp-opt { grid-template-columns: 40px minmax(0, 1fr) 24px; }
    #wildpair-tab .wp-opt-edge, #wildpair-tab .wp-opt-bar { display: none; }
    #wildpair-tab .wp-sel { grid-template-columns: minmax(0, 1fr); gap: 10px; }
    #wildpair-tab .wp-sel-key { justify-self: start; }
}
`;

export const guide = {
    intro: 'Wild Pair says: whenever a creature enters, if you cast it from your hand, you may search your library for a creature with the same total power and toughness and put it onto the battlefield. This page groups your creatures by that total, so you can see what each one can find.',
    howToRead: [
        'Creatures that share a total can find each other, in either direction: cast any one and you may search up any other. A creature alone at its total finds nothing.',
        '<strong>Average find</strong> is the mana value of the best creature each matched creature can search up, averaged over those creatures. It is the value of one trigger, not a game.',
        'A group’s <strong>widest swing</strong> (+N) is casting its cheapest member and fetching its priciest — how far ahead one trigger can put you.',
        'The <strong>slider</strong> only stops on totals your deck actually has. The selected group lists every member, with bars showing their mana values against the deck’s priciest creature.',
        '“More detail” keeps the best line at each total, a chart of every total, and the full table.'
    ],
    method: 'Nothing here is random: Wild Pair searches your library and you choose, so every number is read straight off your decklist. Each creature’s total is its printed power plus toughness.',
    assumptions: [
        'Creatures with a variable power or toughness (*, X) have no fixed total and are never matched. They are listed so you can see what is left out.',
        'The searched-for creature is assumed to still be in your library. Running a group dry is not modelled — Wild Pair is rarely on the battlefield long enough for it to matter.',
        'Only creatures you cast from hand trigger it. Creatures put onto the battlefield by Wild Pair itself do not chain.',
        'The fit rating weighs how many creatures find something against how big the finds are; neither alone makes it good.'
    ],
    tips: [
        'One new creature that matches a total you already play turns a dead card into a live one — and makes the old one live too.',
        'The best groups pair a cheap creature with an expensive one: the cheap one is easy to cast, the expensive one is what you fetch.'
    ],
    terms: ['mv', 'library']
};
