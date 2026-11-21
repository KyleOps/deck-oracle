/**
 * Mana Development — view.
 * Mounted into #manadev-tab by the shell; rendered by js/calculators/manadev.js.
 *
 * DOM order is mobile order: answer → chart → settings → grid → ramp → samples;
 * on wide screens the settings rail moves into the left column.
 */

import { turnOrderHTML } from '../utils/turnOrder.js';

export const template = `
<div class="main-grid single-column md">
    <section class="panel md-answer" aria-label="Answer">
        <div id="md-summary" aria-live="polite"></div>
    </section>

    <section class="panel md-chart-panel" aria-labelledby="md-chart-title">
        <div class="tx-h"><span id="md-chart-title">Mana by turn</span><span class="tx-h-r" id="md-chart-meta"></span></div>
        <div class="chart-container md-chart">
            <canvas id="manadev-chart" role="img" aria-label="Mana available each turn: the typical game, the middle half and eight games in ten, with your lands alone for comparison"></canvas>
        </div>
        <div class="tx-legend md-legend" aria-hidden="true">
            <span class="md-key md-key-line">Typical game</span>
            <span class="md-key md-key-mid">Half of games</span>
            <span class="md-key md-key-wide">8 games in 10</span>
            <span class="md-key md-key-lands">Lands alone, typical</span>
            <span class="md-key md-key-target" id="md-key-target" hidden></span>
        </div>
        <p class="tx-caption is-below">The solid line is the typical game. The dark band holds the middle half of games and the light band eight in ten, so the bottom of the light band is a bad game and the top a good one. The dashed line is the same games with every ramp card left in hand.</p>
    </section>

    <section class="panel panel-config md-rail" aria-label="Settings and deck">
        <div class="tx-h"><span>Settings</span><span class="tx-h-r">only what changes the answer</span></div>
        <div class="md-rail-body">
            ${turnOrderHTML({ id: 'md-order-group', className: 'md-group', label: 'Turn order', hint: 'On the play you skip your first draw, so you see one card fewer each turn.', hidden: true })}
            <div class="md-group" id="md-treasure-group" hidden>
                <label class="checkbox-label" for="md-treasure">
                    <input type="checkbox" id="md-treasure">
                    <span>Count Treasure as ramp</span>
                </label>
                <p class="field-hint" id="md-treasure-hint">Treasure is one-shot mana: each token is spent the first time a ramp spell needs it.</p>
            </div>
            <p class="md-format" id="md-format"></p>
        </div>

        <div class="tx-h"><span>Your deck</span><span class="tx-h-r">as the model reads it</span></div>
        <div class="md-rail-body">
            <dl class="md-facts" id="md-facts"></dl>
            <p class="field-hint">“Mana on a turn” is what your lands and mana permanents can make that turn after your land drop, before you cast anything.</p>
        </div>
    </section>

    <section class="panel" aria-labelledby="md-grid-title">
        <div class="tx-h"><span id="md-grid-title">Chance to have this much mana by each turn</span><span class="tx-h-r" id="md-grid-meta"></span></div>
        <div class="md-scroll" id="md-grid" tabindex="0" role="region" aria-labelledby="md-grid-title"></div>
        <p class="tx-caption is-below" id="md-grid-caption">Each cell is the share of games that had at least that much mana on some turn up to that one.</p>
    </section>

    <section class="panel" aria-labelledby="md-ramp-title">
        <div class="tx-h"><span id="md-ramp-title">What your ramp does</span><span class="tx-h-r" id="md-ramp-meta"></span></div>
        <div class="md-scroll" id="md-ramp"></div>
        <p class="tx-caption is-below">Read from each card’s rules text. If a line looks wrong, the numbers above are wrong for that card too. “In hand” counts the cards you draw; “cast” needs the mana as well.</p>
    </section>

    <section class="panel" aria-labelledby="md-samples-title">
        <div class="tx-h">
            <span id="md-samples-title">Sample games</span>
            <button type="button" class="btn btn-ghost btn-sm" id="md-reshuffle">Shuffle again</button>
        </div>
        <div id="md-samples" aria-live="polite"></div>
    </section>
</div>
`;

export const styles = `
#manadev-tab .md-answer .bottom-line { border-bottom: 1px solid var(--tx-rule); }
#manadev-tab .md-answer .tx-hero { border-bottom: 0; }
#manadev-tab .md-answer .tx-hero .tx-stat:first-child .tx-stat-value { font-size: clamp(36px, 3.6vw, 52px); }
#manadev-tab .md-answer .md-scroll { border-top: 1px solid var(--tx-rule); }
#manadev-tab .md-pending {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px;
    font-size: var(--t-sm);
    color: var(--tx-mid);
}
#manadev-tab .md-pending-bar {
    flex: 1;
    max-width: 240px;
    height: 6px;
    border-radius: 6px;
    background: var(--tx-rule);
    overflow: hidden;
}
#manadev-tab .md-pending-fill { display: block; height: 100%; background: var(--tx-flat); transition: width 0.15s linear; }

/* ── Rail ─────────────────────────────────────────────────────────── */
#manadev-tab .md-rail-body { display: grid; gap: 16px; padding: 16px; }
#manadev-tab .md-group { display: grid; gap: 8px; }
#manadev-tab .md-format { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-mid); }
#manadev-tab .md-format:empty { display: none; }
#manadev-tab .md-facts { display: grid; gap: 8px; margin: 0; }
#manadev-tab .md-facts > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 6px;
    border-bottom: 1px dashed var(--tx-rule);
}
#manadev-tab .md-facts dt { font-size: var(--t-xs); color: var(--tx-mid); }
#manadev-tab .md-facts dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--tx-bright);
    font-feature-settings: 'tnum' 1;
    text-align: right;
}
#manadev-tab .md-facts dd .card-ref { font-family: var(--font-body); }
#manadev-tab .md-facts .md-fact-target { display: grid; gap: 4px; justify-items: end; }

/* ── Chart ────────────────────────────────────────────────────────── */
#manadev-tab .md-chart { height: 300px; }
#manadev-tab .md-legend { padding: 4px var(--pad-x) 0; }
#manadev-tab .md-key { display: inline-flex; align-items: center; gap: 6px; }
#manadev-tab .md-key::before { content: ''; display: inline-block; width: 16px; height: 10px; border-radius: 2px; }
#manadev-tab .md-key-line::before { height: 2px; background: var(--tx-good); }
#manadev-tab .md-key-mid::before { background: color-mix(in srgb, var(--tx-good) 30%, transparent); }
#manadev-tab .md-key-wide::before { background: color-mix(in srgb, var(--tx-good) 14%, transparent); }
#manadev-tab .md-key-lands::before { height: 0; border-top: 2px dashed var(--tx-mid); }
#manadev-tab .md-key-target::before { height: 0; border-top: 1px dashed var(--tx-accent); }

/* ── Chance grid ──────────────────────────────────────────────────── */
#manadev-tab .md-scroll { overflow-x: auto; overscroll-behavior-x: contain; }
#manadev-tab .md-scroll:focus-visible { outline: 2px solid var(--tx-accent); outline-offset: -2px; }
#manadev-tab .md-grid {
    width: 100%;
    border-collapse: separate;
    border-spacing: 2px;
    padding: 8px 10px 0;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    font-feature-settings: 'tnum' 1;
}
#manadev-tab .md-grid th {
    font-weight: 600;
    color: var(--tx-dim);
    font-size: var(--t-label);
    padding: 4px 6px;
    white-space: nowrap;
}
#manadev-tab .md-grid thead th { text-align: center; }
#manadev-tab .md-grid tbody th {
    position: sticky;
    left: 0;
    z-index: 1;
    text-align: right;
    background: var(--tx-panel);
}
#manadev-tab .md-grid td {
    min-width: 38px;
    padding: 6px 4px;
    text-align: center;
    color: var(--tx-text);
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--tx-good) var(--p, 0%), transparent);
}
#manadev-tab .md-grid td.is-low { color: var(--tx-dim); }
#manadev-tab .md-grid td.is-high { color: var(--tx-bright); font-weight: 600; }
#manadev-tab .md-grid tr.is-target th { color: var(--tx-accent); }
#manadev-tab .md-grid tr.is-target td:not(.is-none) { box-shadow: inset 0 -2px 0 var(--tx-accent); }
#manadev-tab .md-grid td.is-curve { outline: 2px solid var(--tx-accent); outline-offset: -2px; }

/* ── Ramp table ───────────────────────────────────────────────────── */
#manadev-tab .md-ramp-table { width: 100%; border-collapse: collapse; font-size: var(--t-xs); }
#manadev-tab .md-ramp-table th {
    padding: 8px 12px;
    text-align: right;
    font-size: var(--t-label);
    font-weight: 600;
    color: var(--tx-dim);
    white-space: nowrap;
    border-bottom: 1px solid var(--tx-rule);
}
#manadev-tab .md-ramp-table th:first-child { text-align: left; }
#manadev-tab .md-ramp-table td {
    padding: 8px 12px;
    vertical-align: top;
    border-bottom: 1px solid var(--tx-rule);
    color: var(--tx-text);
}
#manadev-tab .md-ramp-table tr:last-child td { border-bottom: 0; }
#manadev-tab .md-ramp-table td.num {
    text-align: right;
    font-family: var(--font-mono);
    font-feature-settings: 'tnum' 1;
    white-space: nowrap;
}
#manadev-tab .md-ramp-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
#manadev-tab .md-ramp-name .card-ref { font-weight: 600; color: var(--tx-bright); }
#manadev-tab .md-ramp-copies, #manadev-tab .md-ramp-mv { font-family: var(--font-mono); color: var(--tx-dim); }
#manadev-tab .md-ramp-read { margin-top: 3px; line-height: 1.45; color: var(--tx-mid); }
#manadev-tab .md-ramp-table tr.is-off .md-ramp-name .card-ref { color: var(--tx-mid); font-weight: 500; }
#manadev-tab .md-ramp-table tr.is-off td.num { color: var(--tx-dim); }
#manadev-tab .md-ramp-group td {
    padding-top: 14px;
    font-size: var(--t-label);
    font-weight: 600;
    color: var(--tx-dim);
}

/* ── Sample games ─────────────────────────────────────────────────── */
#manadev-tab .md-games { display: grid; }
#manadev-tab .md-game { padding: var(--pad-y) var(--pad-x); border-bottom: 1px solid var(--tx-rule); }
#manadev-tab .md-game:last-child { border-bottom: 0; }
#manadev-tab .md-game-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
    margin-bottom: 8px;
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#manadev-tab .md-game-head strong { color: var(--tx-bright); }
#manadev-tab .md-turns { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
#manadev-tab .md-turn {
    display: grid;
    grid-template-columns: 34px 70px minmax(0, 1fr);
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--t-xs);
    line-height: 1.5;
}
#manadev-tab .md-turn-n { font-family: var(--font-mono); color: var(--tx-dim); }
#manadev-tab .md-turn-mana {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    color: var(--tx-bright);
    font-weight: 600;
    white-space: nowrap;
}
#manadev-tab .md-turn-mana .ms { width: 13px; height: 13px; font-size: 8px; }
#manadev-tab .md-turn-what { color: var(--tx-text); min-width: 0; overflow-wrap: anywhere; }
#manadev-tab .md-turn.is-target { background: var(--tx-row-hi); box-shadow: inset 3px 0 0 var(--tx-accent); }
#manadev-tab .md-turn-flag { margin-left: 6px; color: var(--tx-accent); font-weight: 600; white-space: nowrap; }
#manadev-tab .md-found, #manadev-tab .md-quiet { color: var(--tx-mid); }
#manadev-tab .md-samples-foot { margin: 0; padding: 10px var(--pad-x) 14px; font-size: var(--t-xs); color: var(--tx-dim); }

@container shell (max-width: 560px) {
    #manadev-tab .md-chart { height: 240px; }
    #manadev-tab .md-grid { border-spacing: 1px; padding: 6px 4px 0; font-size: var(--t-micro); }
    #manadev-tab .md-grid td { min-width: 0; padding: 5px 1px; }
    #manadev-tab .md-grid th { padding: 4px 2px; }
    #manadev-tab .md-ramp-table th.md-col-seen, #manadev-tab .md-ramp-table td.md-col-seen { display: none; }
    #manadev-tab .md-ramp-table th, #manadev-tab .md-ramp-table td { padding: 8px 8px; }
    #manadev-tab .md-turn { grid-template-columns: 26px 58px minmax(0, 1fr); gap: 6px; }
    #manadev-tab .md-cmd-table .md-cmd-alone { display: none; }
}
`;

export const guide = {
    intro: 'Plays your deck alone thousands of times — no opponent, no interaction — and tracks how much mana you have each turn from your lands and your ramp. It answers the question every deck asks: when can I cast my commander, or my big spells, and how much is my ramp really buying me?',
    howToRead: [
        '<strong>Mana on a turn</strong> is what your lands and mana permanents can make that turn after your land drop, before you cast anything. A Sol Ring cast on turn 1 counts from turn 2.',
        'The <strong>chart</strong> shows the typical game as a line, the middle half of games as the dark band and eight games in ten as the light band. The dashed line is the same shuffles with every ramp card left uncast — the gap between the two lines is what your ramp does.',
        'The <strong>grid</strong> gives the chance to have had at least that much mana by each turn. The highlighted rows are your commanders’ mana values, and the outlined cells are casting each on curve.',
        '<strong>Turns saved</strong> compares each game with its lands-only twin and averages the difference in the turn your commander becomes castable. With two or more commanders, a table lists each one — on-curve chance, the turns it usually becomes castable, lands alone, turns saved — and a last row for all of them together.',
        'The <strong>ramp table</strong> says what the model thinks each ramp card does. If a line is wrong, that card’s effect is wrong in every number above.'
    ],
    method: '5,000 simulated games from a fixed seed, so the same deck always gives the same numbers. Each game: shuffle, London mulligan with the Opening Hands keep rule (2–4 lands; free first mulligan in Commander), then up to 12 turns of draw, land drop and ramp. The land drop plays an untapped land when the extra mana lets you cast something in hand that turn, and a tapped land when it doesn’t. Then the simulator casts the best ramp it can afford — pieces that pay for themselves first (Sol Ring), then the most mana gained, then the cheapest — until nothing fits. Colours are checked pip by pip against the lands and rocks you have. Every shuffle is played twice: once with ramp and once with every ramp card blank.',
    assumptions: [
        'Goldfish: no opponents, no removal, no counterspells. Real games are slower.',
        'Greedy ramp: every turn the simulator spends its mana on ramp before anything else, and never holds mana up. Your commander is checked before and after each ramp spell, so a Sol Ring that pays for itself still counts that turn.',
        'Counted: mana rocks and dorks (dorks from the turn after they’re cast), mana auras, planeswalker mana abilities, land searches (tapped or untapped, battlefield or hand), extra land drops and playing lands from the top of your library.',
        'Not counted, though still ramp: mana doublers, mana that doesn’t untap, sacrifice-for-mana, and anything that only happens on a later trigger (Treasure on landfall, lands when a creature dies). Treasure from a spell or as a permanent enters counts only if you turn it on. Listed but not ramp: rituals and cost reducers. Every page counts ramp by this same rule, so the overview’s ramp count is what this page counts plus what it can’t.',
        'Mana that varies (Priest of Titania, Bloom Tender) counts as one. Lands that enter tapped “unless” something are checked for the common cases (shocks, fast lands, slow lands, check lands, two or more opponents); other conditions are assumed met.',
        'Every commander is checked on its own, cast from the command zone (never drawn). With partners, a Doctor and their companion or a commander and a background, the land drop and the colours a search fetches aim at every commander you can’t cast yet. The model checks whether you could cast each one; it never spends mana on them, so “both castable” is the turn by which each has been castable at least once.',
        'Without a commander (or without any commander’s card), the target is your top end: the middle of your three most expensive spells. You only need the mana for it, not the card in hand.'
    ],
    tips: [
        'Two-mana rocks and one-mana dorks move turn 3–4 the most; four-mana land ramp mostly moves turn 5 and later.',
        'If “In hand by turn 4” is high but “Cast by turn 4” is low, the ramp is too expensive to cast on time — swap a four-drop for a two-drop.',
        'More ramp narrows the gap between a bad game and a typical one: watch the bottom of the light band, not just the line.'
    ],
    terms: ['simulation', 'median', 'oncurve', 'mulligan', 'play', 'library']
};
