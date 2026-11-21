/**
 * Game Plan — view.
 * Mounted into #plan-tab by the shell; rendered by js/calculators/plan.js.
 *
 * DOM order is mobile order: answer → the plan and settings → steps → misses
 * → key-turn mana → sample games → card rules; on wide screens the plan
 * moves into the left rail.
 */

import { turnOrderHTML } from '../utils/turnOrder.js';

const landOptions = selected => Array.from({ length: 8 }, (_, n) => `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`).join('');

export const template = `
<div class="main-grid single-column gp">
    <section class="panel gp-answer" aria-label="Answer">
        <div id="gp-summary" aria-live="polite"></div>
    </section>

    <section class="panel panel-config gp-rail" aria-label="Your plan and settings">
        <div class="tx-h"><span>Your plan</span><span class="tx-h-r" id="gp-plan-meta"></span></div>
        <div class="gp-rail-body">
            <div class="gp-preset" id="gp-preset"></div>
            <ol class="gp-steps" id="gp-steps" aria-label="Plan steps"></ol>
            <div class="gp-plan-actions">
                <button type="button" class="btn btn-sm" id="gp-add-step">Add a step</button>
                <button type="button" class="btn btn-ghost btn-sm" id="gp-reset">Start over from this deck</button>
            </div>
            <p class="field-hint">Each step is checked by its turn; one done early counts as on time. A card counts towards one step only.</p>
            <datalist id="gp-card-names"></datalist>
        </div>

        <div class="tx-h"><span>Settings</span><span class="tx-h-r">only what changes the answer</span></div>
        <div class="gp-rail-body">
            ${turnOrderHTML({ id: 'gp-order-group', className: 'gp-group', label: 'Turn order', hint: 'On the play you skip your first draw, so you see one card fewer each turn.', hidden: true })}
            <div class="gp-group">
                <label class="field-label" for="gp-keep">Keep an opening hand with</label>
                <select class="field field-sm" id="gp-keep">
                    <option value="plan" selected>the right lands, and the plan’s first card</option>
                    <option value="lands">the right lands</option>
                </select>
                <div class="gp-keep-lands">
                    <label for="gp-keep-min">Lands</label>
                    <select class="field field-sm" id="gp-keep-min" aria-label="Fewest lands to keep">${landOptions(2)}</select>
                    <span aria-hidden="true">to</span>
                    <select class="field field-sm" id="gp-keep-max" aria-label="Most lands to keep">${landOptions(4)}</select>
                </div>
                <p class="field-hint" id="gp-keep-hint">London mulligan: anything else goes back, down to four cards.</p>
            </div>
            <p class="gp-format" id="gp-format"></p>
        </div>
    </section>

    <section class="panel" aria-labelledby="gp-funnel-title">
        <div class="tx-h"><span id="gp-funnel-title">Step by step</span><span class="tx-h-r" id="gp-funnel-meta"></span></div>
        <div id="gp-funnel"></div>
        <p class="tx-caption is-below">The bar is the share of games still on plan after each step — every step so far done by its turn. Under it: how many of the games that got that far make the step, and the step on its own.</p>
    </section>

    <section class="panel" aria-labelledby="gp-reasons-title">
        <div class="tx-h"><span id="gp-reasons-title">Why it misses</span><span class="tx-h-r" id="gp-reasons-meta"></span></div>
        <div id="gp-reasons"></div>
        <p class="tx-caption is-below">Each game that misses counts once, at the first step it missed, with what stopped it that turn.</p>
    </section>

    <section class="panel" aria-labelledby="gp-mana-title">
        <div class="tx-h"><span id="gp-mana-title">Mana on the key turn</span><span class="tx-h-r" id="gp-mana-meta"></span></div>
        <div id="gp-mana"></div>
        <p class="tx-caption is-below" id="gp-mana-caption"></p>
    </section>

    <section class="panel" aria-labelledby="gp-samples-title">
        <div class="tx-h">
            <span id="gp-samples-title">Sample games</span>
            <button type="button" class="btn btn-ghost btn-sm" id="gp-reshuffle">Shuffle again</button>
        </div>
        <div id="gp-samples" aria-live="polite"></div>
    </section>

    <section class="panel" aria-labelledby="gp-rules-title">
        <div class="tx-h"><span id="gp-rules-title">Cards the model reads closely</span><span class="tx-h-r" id="gp-rules-meta"></span></div>
        <div id="gp-rules"></div>
        <p class="tx-caption is-below">These cards make mana from the board, trigger on what you cast or copy spells, so the games play them by these rules. Everything else is read the way Mana Development reads it.</p>
    </section>
</div>
`;

export const styles = `
#plan-tab .gp-answer .bottom-line { border-bottom: 1px solid var(--tx-rule); }
#plan-tab .gp-answer .tx-hero { border-bottom: 0; }
#plan-tab .gp-answer .tx-hero .tx-stat:first-child .tx-stat-value { font-size: clamp(36px, 3.6vw, 52px); }
#plan-tab .gp-pending {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px;
    font-size: var(--t-sm);
    color: var(--tx-mid);
}
#plan-tab .gp-pending-bar { flex: 1; max-width: 240px; height: 6px; border-radius: 6px; background: var(--tx-rule); overflow: hidden; }
#plan-tab .gp-pending-fill { display: block; height: 100%; background: var(--tx-flat); transition: width 0.15s linear; }

/* ── Rail: the plan editor ───────────────────────────────────────── */
#plan-tab .gp-rail-body { display: grid; gap: 14px; padding: 16px; }
#plan-tab .gp-group { display: grid; gap: 8px; }
#plan-tab .gp-format { margin: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--tx-mid); }
#plan-tab .gp-format:empty, #plan-tab .gp-preset:empty { display: none; }
#plan-tab .gp-keep-lands { display: flex; align-items: center; gap: 8px; font-size: var(--t-xs); color: var(--tx-mid); }

#plan-tab .gp-preset {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-sm);
    background: var(--tx-panel-alt);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--tx-text);
}
#plan-tab .gp-preset.is-suggested { border-color: var(--tx-accent); }
#plan-tab .gp-preset p { margin: 0; }
#plan-tab .gp-preset-notes { color: var(--tx-mid); }
#plan-tab .gp-preset-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
#plan-tab .gp-preset-row .field { flex: 1 1 160px; min-width: 0; }

#plan-tab .gp-steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
#plan-tab .gp-step {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-sm);
    background: var(--tx-panel);
}
#plan-tab .gp-step.is-invalid { border-style: dashed; }
#plan-tab .gp-step-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#plan-tab .gp-step-n {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--tx-row-hi);
    font-family: var(--font-mono);
    font-size: var(--t-label);
    font-weight: 600;
    color: var(--tx-bright);
}
#plan-tab .gp-step-tools { display: inline-flex; gap: 2px; margin-left: auto; }
#plan-tab .gp-icon-btn {
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--tx-mid);
    font: inherit;
    font-size: var(--t-sm);
    line-height: 1;
    cursor: pointer;
}
#plan-tab .gp-icon-btn:hover:not(:disabled) { border-color: var(--tx-rule-hi); color: var(--tx-bright); }
#plan-tab .gp-icon-btn:focus-visible { outline: 2px solid var(--tx-accent); outline-offset: 1px; }
#plan-tab .gp-icon-btn:disabled { opacity: 0.35; cursor: default; }
#plan-tab .gp-fields { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--t-xs); color: var(--tx-mid); }
#plan-tab .gp-fields .field-sm { max-width: 100%; }
#plan-tab .gp-fields > select[data-field="is"], #plan-tab .gp-fields > select[data-field="after"] { flex: 1 1 100%; min-width: 0; }
#plan-tab .gp-option > select[data-field="is"] { flex: 1 1 140px; min-width: 0; }
#plan-tab .gp-fields input[type="number"] { width: 58px; }
#plan-tab .gp-fields input[type="text"] { flex: 1 1 100%; width: 100%; }
#plan-tab .gp-option { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-left: 8px; border-left: 2px solid var(--tx-rule); }
#plan-tab .gp-or { font-size: var(--t-label); font-weight: 600; color: var(--tx-dim); text-transform: uppercase; letter-spacing: 0.04em; }
#plan-tab .gp-step-read { margin: 0; font-size: var(--t-xs); line-height: 1.45; color: var(--tx-mid); }
#plan-tab .gp-step-read strong { color: var(--tx-bright); font-weight: 600; }
#plan-tab .gp-plan-actions { display: flex; flex-wrap: wrap; gap: 8px; }

/* ── Step funnel ─────────────────────────────────────────────────── */
#plan-tab .gp-funnel { display: grid; margin: 0; padding: 4px 0; list-style: none; }
#plan-tab .gp-funnel-row {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 6px 18px;
    align-items: center;
    padding: 12px var(--pad-x);
    border-bottom: 1px solid var(--tx-rule);
}
#plan-tab .gp-funnel-row:last-child { border-bottom: 0; }
#plan-tab .gp-funnel-label { display: flex; gap: 10px; align-items: baseline; font-size: var(--t-sm); color: var(--tx-text); min-width: 0; }
#plan-tab .gp-funnel-label .gp-step-n { flex: none; }
#plan-tab .gp-funnel-track { position: relative; height: 12px; border-radius: 6px; background: var(--tx-rule); overflow: hidden; }
#plan-tab .gp-funnel-fill { display: block; height: 100%; border-radius: 6px; background: var(--tx-flat); }
#plan-tab .gp-funnel-row.is-last .gp-funnel-fill { background: var(--gp-tone, var(--tx-flat)); }
#plan-tab .gp-funnel-nums {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#plan-tab .gp-funnel-nums strong { font-family: var(--font-mono); color: var(--tx-bright); font-feature-settings: 'tnum' 1; }
#plan-tab .gp-weak { color: var(--tx-warn); font-weight: 600; }

/* ── Reasons ─────────────────────────────────────────────────────── */
#plan-tab .gp-reasons { display: grid; margin: 0; padding: 6px 0; list-style: none; }
#plan-tab .gp-reason {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 120px 48px;
    gap: 12px;
    align-items: center;
    padding: 8px var(--pad-x);
    font-size: var(--t-sm);
    color: var(--tx-text);
}
#plan-tab .gp-reason-text::first-letter { text-transform: uppercase; }
#plan-tab .gp-reason-share { font-family: var(--font-mono); text-align: right; color: var(--tx-bright); font-feature-settings: 'tnum' 1; }
#plan-tab .gp-reason .mana-cost { vertical-align: -2px; }

/* ── Sample games ────────────────────────────────────────────────── */
#plan-tab .gp-games { display: grid; }
#plan-tab .gp-game { padding: var(--pad-y) var(--pad-x); border-bottom: 1px solid var(--tx-rule); }
#plan-tab .gp-game:last-child { border-bottom: 0; }
#plan-tab .gp-game-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
    margin-bottom: 8px;
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#plan-tab .gp-game-head strong { color: var(--tx-bright); }
#plan-tab .gp-verdict { font-weight: 600; }
#plan-tab .gp-verdict.tone-good { color: var(--tx-good); }
#plan-tab .gp-verdict.tone-warn { color: var(--tx-warn); }
#plan-tab .gp-verdict.tone-bad { color: var(--tx-bad); }
#plan-tab .gp-turns { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
#plan-tab .gp-turn {
    display: grid;
    grid-template-columns: 34px 70px minmax(0, 1fr);
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--t-xs);
    line-height: 1.5;
}
#plan-tab .gp-turn-n { font-family: var(--font-mono); color: var(--tx-dim); }
#plan-tab .gp-turn-mana { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); color: var(--tx-bright); font-weight: 600; white-space: nowrap; }
#plan-tab .gp-turn-mana .ms { width: 13px; height: 13px; font-size: 8px; }
#plan-tab .gp-turn-what { color: var(--tx-text); min-width: 0; overflow-wrap: anywhere; }
#plan-tab .gp-turn.is-step { background: var(--tx-row-hi); box-shadow: inset 3px 0 0 var(--tx-accent); }
#plan-tab .gp-turn-flag { margin-left: 6px; color: var(--tx-accent); font-weight: 600; white-space: nowrap; }
#plan-tab .gp-note, #plan-tab .gp-quiet { color: var(--tx-mid); }
#plan-tab .gp-samples-foot { margin: 0; padding: 10px var(--pad-x) 14px; font-size: var(--t-xs); color: var(--tx-dim); }

/* ── Card rules ──────────────────────────────────────────────────── */
#plan-tab .gp-rules { display: grid; margin: 0; padding: 6px 0; list-style: none; }
#plan-tab .gp-rule { display: grid; gap: 2px; padding: 8px var(--pad-x); border-bottom: 1px solid var(--tx-rule); font-size: var(--t-xs); }
#plan-tab .gp-rule:last-child { border-bottom: 0; }
#plan-tab .gp-rule .card-ref { font-weight: 600; color: var(--tx-bright); }
#plan-tab .gp-rule-read { color: var(--tx-mid); line-height: 1.45; }

@container shell (max-width: 560px) {
    #plan-tab .gp-funnel-row { grid-template-columns: minmax(0, 1fr); }
    #plan-tab .gp-funnel-nums { grid-column: 1; }
    #plan-tab .gp-reason { grid-template-columns: minmax(0, 1fr) 44px; }
    #plan-tab .gp-reason .gp-reason-bar { display: none; }
    #plan-tab .gp-turn { grid-template-columns: 26px 58px minmax(0, 1fr); gap: 6px; }
}
`;

export const guide = {
    intro: 'Write down what your deck is built to do, turn by turn — a mana creature on turn 2, the commander on turn 3, eight mana and two big spells on turn 4 — and the page plays thousands of goldfish games to see how often it happens on time, how often a turn late, and what stops it when it doesn’t.',
    howToRead: [
        '<strong>Plan on time</strong> is the share of games where every step happens by its turn. <strong>Within one turn</strong> allows each step one turn more.',
        '<strong>Step by step</strong> follows the games through the plan: the bar is how many are still on time after each step, and under it how many of those that got there make the step — the lowest of these is the weakest link.',
        '<strong>Why it misses</strong> counts each missed game once, at the first step it missed, with what stopped it on that turn: the card wasn’t there, a land drop was missed, the mana or the colour wasn’t there, or the card it had to follow wasn’t out.',
        '<strong>Mana on the key turn</strong> shows 100 games as 100 dots — each the mana that game made on the turn the plan needs it (filled when it was enough, rings when it fell short). The far end is a percentile, never the single best game.',
        '<strong>Sample games</strong> show real shuffles turn by turn: the mana made, the land played, what was cast and what it did, and which step each turn finished.'
    ],
    method: '5,000 simulated games from a fixed seed, so the same deck and plan always give the same numbers. Each game: shuffle, London mulligan (keep 2–4 lands that can start the plan by default; free first mulligan in Commander), then each turn untap, draw, main-phase triggers and land drops — the land that best serves the colours the next step needs — then the plan’s steps in order whenever they can be done, then the best ramp the mana allows. Everything else stays in hand. Mana is worked out from the board at the moment you pay, pip by pip, so creatures cast earlier in the turn count for cards like Selvala, Eager Trailblazer and Fanatic of Rhonas.',
    assumptions: [
        'Goldfish: no opponents, no removal, no counterspells, no combat. Real games are slower.',
        '“Mana on a turn” is everything you made that turn — what you spent plus what you could still make after your land drop — so ramp cast that turn counts.',
        'The casting policy is simple and greedy: it does the earliest step it can, then casts ramp, and holds the rest. It never plays around the next turn, and it never sandbags a land.',
        'Card rules: mana that depends on the board (power 4 or greater, different powers, Elves, colours among permanents), extra mana when you tap a creature, start-of-main-phase mana, triggers on casting a creature (tokens, lands), earthbend and copying historic spells are modelled for the cards listed at the bottom of the page. Other cards are read the way Mana Development reads them.',
        'Commanders are cast from the command zone, never drawn, and never die. Treasure is spent like any other mana.'
    ],
    tips: [
        'Look at the weakest step first: raising the chance of the step that most often breaks the chain moves the whole plan most.',
        'If the usual miss is a colour, the land drop is already choosing the colours your next step needs — you need more sources of that colour, not more lands.',
        'A plan that is “one turn late” much more often than “on time” usually needs one more cheap mana source, not a bigger payoff.'
    ],
    terms: ['simulation', 'mulligan', 'oncurve', 'play', 'p95']
};
