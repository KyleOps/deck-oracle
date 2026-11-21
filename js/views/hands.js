/**
 * Opening Hands — view.
 *
 * A hands-on lab: deal real sample hands from the shuffled library, mulligan
 * with the London rule, goldfish the first turns, and practise keep-or-
 * mulligan against a tunable rule. Everything inside the containers is
 * rendered by js/calculators/hands.js.
 *
 * DOM order is mobile order (summary → hand → rule → stats); on wide screens
 * the rule panel moves into the left rail.
 */

export const template = `
<div class="main-grid single-column hl">
    <section class="panel hl-summary" id="hl-summary" aria-label="Opening hands at a glance"></section>

    <section class="panel hl-table" aria-labelledby="hl-table-title">
        <div class="tx-h">
            <span id="hl-table-title">Sample hand</span>
            <div class="seg seg-sm" role="group" aria-label="Mode">
                <button class="seg-btn active" type="button" data-hl-mode="sample" aria-pressed="true">Deal &amp; goldfish</button>
                <button class="seg-btn" type="button" data-hl-mode="practice" aria-pressed="false">Practice</button>
            </div>
        </div>
        <div class="hl-toolbar" id="hl-toolbar"></div>
        <div class="hl-prompt" id="hl-prompt" aria-live="polite"></div>
        <div class="hl-hand" id="hl-hand">
            <div class="hl-cards" id="hl-cards" role="group" aria-label="Your hand"></div>
        </div>
        <div class="hl-field" id="hl-field" hidden>
            <div class="hl-field-head" id="hl-field-head"></div>
            <div class="hl-lane" id="hl-lane" role="group" aria-label="Battlefield"></div>
        </div>
        <div class="hl-readout" id="hl-readout" aria-live="polite"></div>
    </section>

    <section class="panel panel-config hl-rail" aria-label="Keep rule">
        <div class="tx-h"><span>Keep rule</span><span class="tx-h-r">what a keepable hand needs</span></div>
        <div class="hl-rail-body">
            <div class="hl-group">
                <span class="field-label" id="hl-lands-label">Lands in hand</span>
                <div class="hl-range" role="group" aria-labelledby="hl-lands-label">
                    <label class="hl-num-field">
                        <span>At least</span>
                        <input type="number" id="hl-min-lands" class="field field-sm" min="0" max="7" step="1" value="2" inputmode="numeric">
                    </label>
                    <label class="hl-num-field">
                        <span>At most</span>
                        <input type="number" id="hl-max-lands" class="field field-sm" min="0" max="7" step="1" value="4" inputmode="numeric">
                    </label>
                </div>
                <p class="field-hint">Hands outside this range are mulligans. After a mulligan, the cards you bottom are chosen to land inside it.</p>
            </div>

            <div class="hl-group">
                <span class="field-label" id="hl-play-label">Needs an early play</span>
                <div class="seg seg-sm" role="group" aria-labelledby="hl-play-label">
                    <button class="seg-btn active" type="button" data-hl-play="0" aria-pressed="true">Off</button>
                    <button class="seg-btn" type="button" data-hl-play="2" aria-pressed="false">By turn 2</button>
                    <button class="seg-btn" type="button" data-hl-play="3" aria-pressed="false">By turn 3</button>
                </div>
                <p class="field-hint" id="hl-play-hint">A spell or ramp piece the lands in the hand can cast by then, colours included.</p>
            </div>

            <div class="hl-group" id="hl-order-group">
                <span class="field-label" id="hl-order-label">Turn order</span>
                <div class="seg seg-sm" role="group" aria-labelledby="hl-order-label">
                    <button class="seg-btn active" type="button" data-hl-play-first="1" aria-pressed="true">On the play</button>
                    <button class="seg-btn" type="button" data-hl-play-first="0" aria-pressed="false">On the draw</button>
                </div>
                <p class="field-hint">Only changes the goldfish: the starting player skips their first draw.</p>
            </div>

            <p class="hl-format" id="hl-format"></p>

            <dl class="hl-keys" aria-label="Keyboard shortcuts">
                <div><dt><kbd>N</kbd></dt><dd>New hand</dd></div>
                <div><dt><kbd>M</kbd></dt><dd>Mulligan</dd></div>
                <div><dt><kbd>K</kbd></dt><dd>Keep</dd></div>
                <div><dt><kbd>Space</kbd></dt><dd>Draw / next turn</dd></div>
            </dl>
        </div>
    </section>

    <section class="panel hl-stats" aria-labelledby="hl-stats-title">
        <div class="tx-h"><span id="hl-stats-title">How often hands are keepable</span><span class="tx-h-r" id="hl-stats-meta"></span></div>
        <div class="hl-stats-body" id="hl-stats"></div>
    </section>
</div>
`;

export const styles = `
#hands-tab .hl-summary .bottom-line { border-bottom: 1px solid var(--tx-rule); }
#hands-tab .hl-summary .tx-hero {
    border-bottom: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
}
#hands-tab .hl-summary .tx-hero .tx-stat:first-child .tx-stat-value { font-size: clamp(36px, 3.6vw, 52px); }

/* ── Toolbar & prompt ─────────────────────────────────────────────── */
#hands-tab .hl-table { container-type: inline-size; }

#hands-tab .hl-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--tx-rule);
}

#hands-tab .hl-toolbar .btn kbd { margin-left: 2px; }
#hands-tab .hl-toolbar .btn-primary kbd {
    color: inherit;
    background: transparent;
    border-color: color-mix(in srgb, currentColor 35%, transparent);
}
#hands-tab .hl-toolbar .btn[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
#hands-tab .hl-toolbar-status {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
}
#hands-tab .hl-chip-num { font-family: var(--font-mono); color: var(--tx-bright); }

#hands-tab .hl-prompt:empty { display: none; }
#hands-tab .hl-prompt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 16px;
    font-size: var(--t-sm);
    color: var(--tx-mid);
    background: var(--tx-panel-alt);
    border-bottom: 1px solid var(--tx-rule);
}
#hands-tab .hl-prompt strong { color: var(--tx-bright); }
#hands-tab .hl-prompt-actions { display: flex; gap: 8px; margin-left: auto; }
#hands-tab .hl-prompt.is-agree { background: var(--good-soft); }
#hands-tab .hl-prompt.is-disagree { background: var(--warn-soft); }

/* ── The hand: a fan that reflows ─────────────────────────────────── */
#hands-tab .hl-hand {
    container-type: inline-size;
    padding: 26px 16px 30px;
    background:
        radial-gradient(120% 90% at 50% 0%, var(--tx-panel-alt), transparent 70%),
        var(--tx-panel);
}

#hands-tab .hl-cards {
    /* n cards overlapping by 22%, with room either side for the fan's tilt */
    --w: clamp(64px, calc((100cqi - 96px) / (var(--n, 7) * 0.78 + 0.22)), 168px);
    display: flex;
    justify-content: center;
    align-items: flex-end;
    min-height: calc(var(--w) * 1.394 + 12px);
}

#hands-tab .hl-card {
    --off: 0;
    --abs: 0;
    position: relative;
    flex: none;
    width: var(--w);
    aspect-ratio: 488 / 680;
    padding: 0;
    border: 0;
    border-radius: calc(var(--w) * 0.047);
    background: var(--tx-panel-alt);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    cursor: default;
    color: inherit;
    font: inherit;
    text-align: left;
    transition: transform var(--transition-slow), box-shadow var(--transition-fast), filter var(--transition-fast);
}

#hands-tab .hl-cards .hl-card {
    margin-left: calc(var(--w) * -0.22);
    transform-origin: 50% 130%;
    transform: translateY(calc(var(--abs) * var(--abs) * 2px)) rotate(calc(var(--off) * 2.2deg));
}
#hands-tab .hl-cards .hl-card:first-child { margin-left: 0; }

#hands-tab .hl-card:focus-visible {
    outline: 2px solid var(--tx-accent);
    outline-offset: 3px;
    z-index: 30;
}

@media (hover: hover) {
    #hands-tab .hl-cards .hl-card:hover {
        z-index: 20;
        transform: translateY(-14px) rotate(0deg);
        box-shadow: var(--shadow-lg);
    }
}

#hands-tab .hl-card.is-actionable { cursor: pointer; }

#hands-tab .hl-card.is-selected {
    filter: saturate(0.4) brightness(0.8);
    box-shadow: 0 0 0 2px var(--tx-accent), var(--shadow-md);
}
#hands-tab .hl-cards .hl-card.is-selected { transform: translateY(18px) rotate(calc(var(--off) * 2.2deg)); }

#hands-tab .hl-card.is-castable { box-shadow: 0 0 0 2px var(--tx-accent), var(--shadow-md); }

#hands-tab .hl-tag {
    position: absolute;
    left: 50%;
    bottom: 8%;
    translate: -50% 0;
    z-index: 2;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--t-label);
    font-weight: 650;
    letter-spacing: 0.02em;
    white-space: nowrap;
    background: var(--tx-accent);
    color: var(--accent-ink);
    box-shadow: var(--shadow-sm);
    pointer-events: none;
}
#hands-tab .hl-card:not(.is-selected):not(.is-castable) .hl-tag:not(.is-muted) { display: none; }
#hands-tab .hl-tag.is-muted { background: var(--surface-raised); color: var(--tx-mid); }

/* Text face: the placeholder before the image arrives, and the fallback if it never does. */
#hands-tab .hl-face {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 5%;
    padding: 8% 8% 9%;
    border: 1px solid var(--tx-rule-hi);
    border-top: 4px solid var(--type-c, var(--tx-rule-hi));
    border-radius: inherit;
    background: var(--tx-panel-alt);
    font-size: clamp(9px, calc(var(--w) * 0.074), 13px);
    line-height: 1.2;
}
#hands-tab .hl-face-head { display: flex; justify-content: space-between; gap: 4px; align-items: flex-start; }
#hands-tab .hl-face-name { font-weight: 650; color: var(--tx-bright); overflow-wrap: anywhere; }
#hands-tab .hl-face-cost .ms { min-width: 0; min-height: 0; width: 1.25em; height: 1.25em; font-size: 0.72em; }
#hands-tab .hl-face-cost .mana-cost { flex-wrap: wrap; justify-content: flex-end; gap: 1px; }
#hands-tab .hl-face-art {
    flex: 1;
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--type-c, var(--tx-flat)) 22%, transparent);
}
#hands-tab .hl-face-type { color: var(--tx-mid); font-size: 0.92em; }

#hands-tab .hl-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.18s ease;
}
#hands-tab .hl-card.is-loaded .hl-img { opacity: 1; }
#hands-tab .hl-card.is-failed .hl-img { display: none; }

/* Deal: quick drop-in, staggered; composes with the fan transform. */
@keyframes hl-deal {
    from { opacity: 0; translate: 0 -28px; scale: 0.9; }
}
#hands-tab .hl-card.is-new {
    animation: hl-deal 170ms var(--ease-out) both;
    animation-delay: calc(var(--k, 0) * 18ms);
}

@media (prefers-reduced-motion: reduce) {
    #hands-tab .hl-card,
    #hands-tab .hl-img { transition: none; }
    #hands-tab .hl-card.is-new { animation: none; }
}

/* Narrow: a tidy grid instead of a fan. */
@container (max-width: 520px) {
    #hands-tab .hl-hand { padding: 14px 12px 16px; }
    #hands-tab .hl-cards {
        --w: calc((100cqi - 24px) / 4);
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        min-height: 0;
    }
    #hands-tab .hl-cards .hl-card,
    #hands-tab .hl-cards .hl-card:first-child { width: auto; margin: 0; transform: none; }
    #hands-tab .hl-cards .hl-card.is-selected { transform: translateY(4px); }
}

/* ── Battlefield ──────────────────────────────────────────────────── */
#hands-tab .hl-field { border-top: 1px dashed var(--tx-rule-hi); }
#hands-tab .hl-field[hidden] { display: none; }
#hands-tab .hl-field-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 10px 16px 0;
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#hands-tab .hl-field-title {
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
}
#hands-tab .hl-field-head strong { font-family: var(--font-mono); color: var(--tx-bright); font-weight: 600; }
#hands-tab .hl-lane {
    --w: clamp(56px, 11cqi, 92px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 12px 16px 16px;
    min-height: calc(var(--w) * 1.394 + 28px);
}
#hands-tab .hl-lane:empty::before {
    content: 'Lands you play land here.';
    font-size: var(--t-xs);
    color: var(--tx-dim);
}
#hands-tab .hl-lane .hl-card { box-shadow: var(--shadow-sm); }
#hands-tab .hl-lane .hl-card.is-tapped {
    transform: rotate(90deg);
    margin-inline: calc(var(--w) * 0.2);
    filter: brightness(0.82);
}

/* ── Read-out ─────────────────────────────────────────────────────── */
#hands-tab .hl-readout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
    gap: 16px 28px;
    padding: 16px 18px 18px;
    border-top: 1px solid var(--tx-rule);
}
#hands-tab .hl-readout:empty { display: none; }
#hands-tab .hl-verdict { display: flex; gap: 12px; align-items: flex-start; }
#hands-tab .hl-verdict-mark {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-weight: 700;
    background: var(--tx-rule);
    color: var(--tx-mid);
}
#hands-tab .hl-verdict.tone-keep .hl-verdict-mark { background: var(--good-soft); color: var(--tx-good); }
#hands-tab .hl-verdict.tone-mull .hl-verdict-mark { background: var(--bad-soft); color: var(--tx-bad); }
#hands-tab .hl-verdict-label {
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
}
#hands-tab .hl-verdict-text {
    margin-top: 2px;
    font-size: var(--t-lg);
    font-weight: 650;
    line-height: 1.3;
    color: var(--tx-bright);
    text-wrap: balance;
}
#hands-tab .hl-verdict-why { margin-top: 6px; font-size: var(--t-xs); color: var(--tx-mid); line-height: 1.5; }
#hands-tab .hl-verdict-why li { list-style: none; }
#hands-tab .hl-hidden-note { font-size: var(--t-sm); color: var(--tx-dim); }

#hands-tab .hl-facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 7px 16px;
    font-size: var(--t-sm);
    align-content: start;
}
#hands-tab .hl-facts dt { color: var(--tx-dim); white-space: nowrap; }
#hands-tab .hl-facts dd { color: var(--tx-text); min-width: 0; }
#hands-tab .hl-facts dd .ms { width: 18px; height: 18px; font-size: 10px; margin-right: 2px; }
#hands-tab .hl-facts .hl-none { color: var(--tx-dim); }

@container (max-width: 640px) {
    #hands-tab .hl-readout { grid-template-columns: minmax(0, 1fr); }
    #hands-tab .hl-toolbar-status { margin-left: 0; justify-content: flex-start; width: 100%; }
}

/* ── Practice tally ───────────────────────────────────────────────── */
#hands-tab .hl-tally { display: flex; align-items: center; gap: 10px; font-size: var(--t-xs); color: var(--tx-mid); }
#hands-tab .hl-tally strong { font-family: var(--font-mono); }
#hands-tab .hl-dots { display: inline-flex; gap: 3px; }
#hands-tab .hl-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tx-rule-hi); }
#hands-tab .hl-dot.is-agree { background: var(--tx-good); }
#hands-tab .hl-dot.is-disagree { background: var(--tx-warn); }

/* ── Rail ─────────────────────────────────────────────────────────── */
#hands-tab .hl-rail-body { display: grid; gap: 22px; padding: 16px; }
#hands-tab .hl-group .field-hint { margin-top: 8px; }
#hands-tab .hl-range { display: flex; gap: 12px; flex-wrap: wrap; }
#hands-tab .hl-num-field { display: inline-flex; align-items: center; gap: 8px; font-size: var(--t-xs); color: var(--tx-mid); }
#hands-tab .hl-num-field .field { width: 64px; text-align: center; font-family: var(--font-mono); }
#hands-tab .hl-format { font-size: var(--t-xs); color: var(--tx-mid); line-height: 1.55; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--tx-panel-alt); }
#hands-tab .hl-format:empty { display: none; }
#hands-tab .hl-keys { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; font-size: var(--t-xs); color: var(--tx-dim); }
#hands-tab .hl-keys div { display: flex; align-items: center; gap: 8px; }
@media (hover: none) {
    #hands-tab .hl-keys,
    #hands-tab .hl-toolbar kbd { display: none; }
}

/* ── Statistics ───────────────────────────────────────────────────── */
#hands-tab .hl-stats { container-type: inline-size; }
#hands-tab .hl-stats-body { padding: 18px; }
#hands-tab .hl-stats-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 24px 32px;
    align-items: start;
}
#hands-tab .hl-stat-title { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); margin-bottom: 12px; }
#hands-tab .hl-caption { margin-top: 10px; font-size: var(--t-xs); color: var(--tx-dim); line-height: 1.55; }
#hands-tab .hl-caption strong { color: var(--tx-text); }
#hands-tab .hl-keeprows { display: grid; gap: 12px; }
#hands-tab .hl-keeprow { display: grid; grid-template-columns: 9.5em minmax(0, 1fr) 3.2em; gap: 12px; align-items: center; font-size: var(--t-sm); }
#hands-tab .hl-keeprow-label { color: var(--tx-text); }
#hands-tab .hl-keeprow-num { text-align: right; font-family: var(--font-mono); color: var(--tx-bright); }
#hands-tab .hl-empty { color: var(--tx-dim); font-size: var(--t-sm); }

@container (max-width: 640px) {
    #hands-tab .hl-stats-grid { grid-template-columns: minmax(0, 1fr); }
}
`;

export const guide = {
    intro: 'Deal real opening hands from your shuffled deck, mulligan them the way the rules say, and play out the first few turns. The numbers underneath say how often a hand is worth keeping, and practice mode lets you test your own judgement against a rule you set.',
    howToRead: [
        '<strong>New hand</strong> shuffles and deals seven. <strong>Mulligan</strong> shuffles and deals a fresh seven; when you keep, you choose one card per mulligan to put on the bottom (the first one is free in multiplayer Commander). <strong>Suggest</strong> picks them the way the simulation would.',
        '<strong>Draw</strong> plays a turn: you draw (unless you are on the play on turn one in a two-player game) and the best land in your hand is played for you. Cards you can cast with your untapped lands are outlined — click one to cast it.',
        'The <strong>read-out</strong> under the hand counts lands, the colours they make, the average mana value of your spells and what you could cast by turns 2 and 3 if you play one land a turn. The verdict applies your keep rule.',
        '<strong>Keepable</strong> is the share of opening sevens that meet your rule without a mulligan. <strong>Keep at 7 / 6 / 5 or fewer</strong> is where you end up after mulliganing until the rule is happy.',
        '<strong>Practice</strong> hides the verdict until you decide, then shows what the rule would have done and keeps a tally for the session.'
    ],
    method: 'The land-count chart is exact (hypergeometric over the cards in your library). With a lands-only rule the keepable share is exact too; once the rule needs an early play it is measured from the simulation. The keep-at numbers come from 10,000 simulated games of the London mulligan: shuffle, deal seven, put the owed cards on the bottom (extra lands first, otherwise the most expensive or off-colour spells), keep if the rule passes, otherwise mulligan again. The simulation is cached per deck and rule.',
    assumptions: [
        'Commander games: the first mulligan is free and nobody skips their first draw. 60- and 40-card decks have no free mulligan.',
        'The simulated player always keeps a four-card hand rather than going lower.',
        'Castability counts only lands: one land per turn, each land making one mana of a colour it can produce. Mana rocks, dorks and ramp spells are named in the read-out but their mana isn’t added, and lands that enter tapped are treated as untapped.',
        'Fetch lands count as the colours they can find. “Any colour” lands count as every colour in your deck.',
        'Your commander starts in the command zone, so it is never dealt. Decks entered as bare type counts get type-labelled stand-in cards and only the land rule applies.'
    ],
    tips: [
        'If fewer than about 3 in 4 sevens are keepable, look at your land count before your spells — the land range is usually what fails.',
        'Turning on “needs an early play” shows how much a high curve costs you in mulligans. A big drop means cheap ramp or interaction would make more hands keepable.',
        'Practice a dozen hands with the rule hidden. If you keep hands the rule throws back (or the reverse), either your instinct or your rule needs adjusting.'
    ],
    terms: ['keepable', 'mulligan', 'exact', 'hypergeometric', 'simulation', 'mv', 'play']
};
