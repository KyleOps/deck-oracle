/**
 * Mana Base — view.
 * Markup, scoped styles and the "How it works" guide. Everything inside the
 * containers is rendered by js/calculators/manabase.js.
 */

import { renderManaCost as mana } from '../utils/mana.js';

export const template = `
<div class="mb">
    <section class="panel mb-empty" id="mb-empty" aria-labelledby="mb-empty-title" hidden>
        <h2 class="mb-empty-title" id="mb-empty-title">Colour analysis needs a card list</h2>
        <p>This deck only has card-type counts, so there are no mana costs or land colours to check. Import the list from Moxfield or Archidekt, or paste it, and every coloured spell gets its on-curve odds.</p>
        <button class="btn btn-primary" type="button" data-mb-deck>Import a decklist</button>
    </section>

    <div class="mb-content" id="mb-content">
        <section class="panel mb-answer" aria-label="Answer">
            <div id="mb-bottom"></div>
            <div id="mb-hero"></div>
            <div class="mb-controls" id="mb-controls"></div>
        </section>

        <section class="panel" aria-labelledby="mb-colors-title">
            <div class="tx-h"><h2 class="mb-title" id="mb-colors-title">Colours</h2><span class="tx-h-r" id="mb-colors-meta"></span></div>
            <div class="mb-body">
                <div class="mb-colors" id="mb-colors"></div>
                <p class="mb-caption">The bar is your sources against what the colour’s hardest card wants for a 90% chance on curve. Lands that make two colours count for both.</p>
            </div>
        </section>

        <section class="panel" aria-labelledby="mb-cards-title">
            <div class="tx-h"><h2 class="mb-title" id="mb-cards-title">Every coloured spell, hardest first</h2><span class="tx-h-r" id="mb-cards-meta"></span></div>
            <div class="mb-body">
                <div class="mb-toolbar">
                    <div id="mb-filters"></div>
                    <input type="search" id="mb-search" class="field field-sm mb-search" placeholder="Find a card" aria-label="Find a card" autocomplete="off" spellcheck="false">
                </div>
                <div class="mb-table-wrap" id="mb-cards"></div>
                <p class="mb-caption" id="mb-cards-caption"></p>
            </div>
        </section>

        <section class="panel" aria-labelledby="mb-table-title">
            <div class="tx-h"><h2 class="mb-title" id="mb-table-title">Sources for 90% on curve</h2><span class="tx-h-r" id="mb-table-meta"></span></div>
            <div class="mb-body">
                <div class="mb-toolbar" id="mb-table-colors"></div>
                <div class="mb-table-wrap" id="mb-table"></div>
                <p class="mb-caption" id="mb-table-caption"></p>
            </div>
        </section>

        <section class="panel" aria-labelledby="mb-lands-title">
            <div class="tx-h"><h2 class="mb-title" id="mb-lands-title">Your lands</h2><span class="tx-h-r" id="mb-lands-meta"></span></div>
            <div class="mb-body">
                <div class="mb-lands" id="mb-lands"></div>
            </div>
        </section>
    </div>
</div>
`;

export const styles = `
#manabase-tab .mb,
#manabase-tab .mb-content { display: grid; gap: 16px; min-width: 0; }

#manabase-tab .mb-title {
    margin: 0;
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
}

#manabase-tab .mb-body {
    display: grid;
    gap: 14px;
    min-width: 0;
    padding: 16px clamp(12px, 1.4cqi, 20px);
}

#manabase-tab .mb-caption,
#manabase-tab .mb-note {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--tx-mid);
}
#manabase-tab .mb-caption { color: var(--tx-dim); }
#manabase-tab .mb-note strong,
#manabase-tab .mb-caption strong { color: var(--tx-bright); font-weight: 600; }

/* Answer panel */
#manabase-tab .mb-answer .tx-hero { background: transparent; }
#manabase-tab .mb-hero-card { font-size: var(--t-xs); }
#manabase-tab .mb-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 10px clamp(12px, 1.4cqi, 20px);
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#manabase-tab .mb-facts { display: flex; flex-wrap: wrap; gap: 4px 16px; }
#manabase-tab .mb-facts strong { font-family: var(--font-mono); font-weight: 600; color: var(--tx-bright); }

/* Colour cards */
#manabase-tab .mb-colors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
    gap: 12px;
}
#manabase-tab .mb-color {
    display: grid;
    gap: 12px;
    align-content: start;
    min-width: 0;
    padding: 14px 16px;
    background: var(--tx-panel-alt);
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-md);
}
#manabase-tab .mb-color-head { display: flex; align-items: center; gap: 8px; }
#manabase-tab .mb-color-head .ms { width: 22px; height: 22px; font-size: 11px; }
#manabase-tab .mb-color-name { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
#manabase-tab .mb-color-src { margin-left: auto; font-size: var(--t-xs); color: var(--tx-mid); white-space: nowrap; }
#manabase-tab .mb-color-src strong {
    margin-right: 4px;
    font-family: var(--font-mono);
    font-size: var(--t-xl);
    font-weight: 600;
    letter-spacing: var(--track-tight);
    color: var(--tx-bright);
}
#manabase-tab .mb-color-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--tx-mid);
}
#manabase-tab .mb-color-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
    margin: 0;
}
#manabase-tab .mb-color-facts dt {
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
}
#manabase-tab .mb-color-facts dd {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--tx-text);
}

/* Toolbars */
#manabase-tab .mb-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
}
#manabase-tab .mb-toolbar .seg { flex-wrap: wrap; }
#manabase-tab .mb-toolbar .seg-btn .ms { width: 16px; height: 16px; min-width: 16px; min-height: 16px; font-size: 9px; }
#manabase-tab .mb-search { width: min(240px, 100%); }

/* Card table */
#manabase-tab .mb-table-wrap { min-width: 0; overflow-x: auto; }
#manabase-tab .mb-table { width: 100%; border-collapse: collapse; font-size: var(--t-sm); }
#manabase-tab .mb-table th,
#manabase-tab .mb-table td {
    padding: 9px 10px;
    border-bottom: 1px solid var(--tx-rule);
    text-align: left;
    vertical-align: middle;
}
#manabase-tab .mb-table th:first-child,
#manabase-tab .mb-table td:first-child { padding-left: 0; }
#manabase-tab .mb-table th:last-child,
#manabase-tab .mb-table td:last-child { padding-right: 0; }
#manabase-tab .mb-table thead th {
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    color: var(--tx-dim);
    white-space: nowrap;
}
#manabase-tab .mb-table tbody th { font-weight: 500; color: var(--tx-text); }
#manabase-tab .mb-table tbody tr:hover { background: var(--tx-row-hi); }
#manabase-tab .mb-table .num { text-align: right; font-family: var(--font-mono); font-feature-settings: 'tnum' 1; white-space: nowrap; }
#manabase-tab .mb-table .mb-cost { white-space: nowrap; font-size: 18px; }
#manabase-tab .mb-col-chance { width: 34%; }
#manabase-tab .mb-chance {
    display: grid;
    grid-template-columns: minmax(48px, 1fr) 3.4em;
    align-items: center;
    gap: 10px;
}
#manabase-tab .mb-chance:has(.viz-strip), #manabase-tab .mb-chance-head { grid-template-columns: auto 3.4em; justify-content: start; gap: 12px; }
#manabase-tab .mb-chance-head { display: grid; align-items: end; }
#manabase-tab .mb-chance-head .term { grid-column: 1 / -1; }
#manabase-tab .mb-chance .num { color: var(--tx-bright); }
#manabase-tab .mb-chance .num.tone-good { color: var(--tx-good); }
#manabase-tab .mb-chance .num.tone-warn { color: var(--tx-warn); }
#manabase-tab .mb-chance .num.tone-bad { color: var(--tx-bad); }

/* Turn strips: when a card or colour becomes reliable */
#manabase-tab .mb-strip-axis {
    display: inline-grid;
    grid-template-columns: repeat(8, 11px);
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0;
    line-height: 1;
    text-align: center;
    text-transform: none;
    color: var(--tx-dim);
}
#manabase-tab .mb-strip-note {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px;
    margin: 0 0 4px; font-size: var(--t-xs); color: var(--tx-mid);
}
#manabase-tab .mb-strip-key { display: inline-flex; flex-wrap: wrap; gap: 6px 14px; }
#manabase-tab .mb-strip-key > span { display: inline-flex; align-items: center; gap: 6px; color: var(--tx-dim); }
#manabase-tab .mb-strip-key .viz-strip-cell { width: 11px; }
#manabase-tab .mb-color-turns { display: grid; gap: 5px; padding-top: 10px; border-top: 1px solid var(--tx-rule); }
#manabase-tab .mb-turns-row {
    display: grid;
    grid-template-columns: 58px auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    font-size: var(--t-xs);
}
#manabase-tab .mb-turns-head { font-size: var(--t-label); color: var(--tx-dim); }
#manabase-tab .mb-turns-head > span:first-child { grid-column: 1; }
#manabase-tab .mb-turns-row .mana-cost { display: inline-flex; gap: 2px; }
#manabase-tab .mb-turns-row .ms { width: 16px; height: 16px; min-width: 16px; min-height: 16px; font-size: 9px; }
#manabase-tab .mb-turns-from { color: var(--tx-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#manabase-tab .mb-overall { color: var(--tx-mid); }
#manabase-tab .mb-copies { margin-left: 6px; font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-dim); }
#manabase-tab .mb-cost-inline { display: none; }

#manabase-tab .mb-turn-short { display: none; }
#manabase-tab .mb-tag {
    display: inline-flex;
    align-items: center;
    height: 18px;
    margin-left: 6px;
    padding: 0 6px;
    border: 1px solid var(--tx-rule-hi);
    border-radius: var(--radius-full);
    font-family: var(--font-mono);
    font-size: var(--t-micro);
    color: var(--tx-mid);
    vertical-align: middle;
    cursor: help;
}
#manabase-tab .mb-more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding-top: 12px;
    font-size: var(--t-xs);
    color: var(--tx-dim);
}
#manabase-tab .mb-none { padding: 18px 0; font-size: var(--t-sm); color: var(--tx-dim); }

/* Sources-needed table */
#manabase-tab .mb-karsten {
    width: 100%;
    min-width: 420px;
    border-collapse: separate;
    border-spacing: 4px;
    font-family: var(--font-mono);
}
#manabase-tab .mb-karsten thead th {
    padding: 4px;
    font-family: var(--font-body);
    font-size: var(--t-label);
    font-weight: 600;
    letter-spacing: var(--track-label);
    text-transform: uppercase;
    text-align: center;
    color: var(--tx-dim);
}
#manabase-tab .mb-karsten thead th:first-child { text-align: left; }
#manabase-tab .mb-karsten tbody th { padding: 4px 8px 4px 0; text-align: left; white-space: nowrap; font-weight: 500; }
#manabase-tab .mb-karsten tbody th .ms { width: 18px; height: 18px; font-size: 10px; }
#manabase-tab .mb-karsten td {
    height: 52px;
    padding: 6px 4px;
    text-align: center;
    border-radius: var(--radius-sm);
    background: var(--tx-panel-alt);
    font-size: var(--t-lg);
    font-weight: 600;
    color: var(--tx-dim);
}
#manabase-tab .mb-karsten td.is-met { background: var(--good-soft); color: var(--tx-good); }
#manabase-tab .mb-karsten td.is-short.has-cards { background: var(--bad-soft); color: var(--tx-bad); }
#manabase-tab .mb-karsten td.has-cards { box-shadow: inset 0 0 0 1.5px currentColor; cursor: help; }
#manabase-tab .mb-karsten td.is-na { background: transparent; color: var(--tx-dim); font-weight: 400; }
#manabase-tab .mb-cell-cards {
    display: block;
    margin-top: 2px;
    font-family: var(--font-body);
    font-size: var(--t-micro);
    font-weight: 500;
    color: var(--tx-mid);
}
#manabase-tab .mb-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: var(--t-xs); color: var(--tx-mid); }
#manabase-tab .mb-legend-swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 6px;
    border-radius: 3px;
    vertical-align: -1px;
}
#manabase-tab .mb-legend-met { background: var(--good-soft); box-shadow: inset 0 0 0 1px var(--tx-good); }
#manabase-tab .mb-legend-short { background: var(--bad-soft); box-shadow: inset 0 0 0 1px var(--tx-bad); }

/* Lands */
#manabase-tab .mb-lands { display: grid; }
#manabase-tab .mb-land-group {
    display: grid;
    grid-template-columns: minmax(170px, 240px) minmax(0, 1fr);
    gap: 6px 20px;
    align-items: baseline;
    padding: 12px 0;
    border-bottom: 1px solid var(--tx-rule);
}
#manabase-tab .mb-land-group:first-child { padding-top: 0; }
#manabase-tab .mb-land-group:last-child { padding-bottom: 0; border-bottom: 0; }
#manabase-tab .mb-land-head { display: flex; align-items: center; gap: 8px; }
#manabase-tab .mb-land-head .mana-cost { flex-shrink: 0; }
#manabase-tab .mb-land-head .ms { width: 18px; height: 18px; font-size: 10px; }
#manabase-tab .mb-land-label { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
#manabase-tab .mb-land-count { margin-left: auto; font-family: var(--font-mono); font-size: var(--t-sm); color: var(--tx-mid); }
#manabase-tab .mb-land-cards { margin: 0; font-size: var(--t-sm); line-height: 1.75; color: var(--tx-mid); }
#manabase-tab .mb-land-cards .mb-copies { margin: 0 2px 0 0; }

/* Empty state */
#manabase-tab .mb-empty {
    display: grid;
    gap: 12px;
    justify-items: start;
    padding: clamp(20px, 4cqi, 40px);
}
#manabase-tab .mb-empty-title { margin: 0; font-size: var(--t-lg); font-weight: 600; color: var(--tx-bright); }
#manabase-tab .mb-empty p { max-width: 60ch; margin: 0; font-size: var(--t-sm); line-height: 1.6; color: var(--tx-mid); }

/* Narrow: cost and turn move under the card name; the sources table compacts. */
@container shell (max-width: 640px) {
    #manabase-tab .mb-col-overall,
    #manabase-tab .mb-col-turn,
    #manabase-tab .mb-col-cost { display: none; }
    #manabase-tab .mb-cost-inline { display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 15px; }
    #manabase-tab .mb-cost-inline .mb-copies { margin-left: 4px; }
    #manabase-tab .mb-table th,
    #manabase-tab .mb-table td { padding: 8px 6px; }
    #manabase-tab .mb-col-chance { width: 44%; }
    #manabase-tab .mb-chance { grid-template-columns: minmax(28px, 1fr) 3em; gap: 8px; }
    #manabase-tab .mb-search { width: 100%; }
    #manabase-tab .mb-land-group { grid-template-columns: minmax(0, 1fr); }
    #manabase-tab .mb-karsten { min-width: 0; border-spacing: 3px; }
    #manabase-tab .mb-karsten thead th { padding: 4px 0; letter-spacing: 0; }
    #manabase-tab .mb-karsten tbody th { padding-right: 2px; }
    #manabase-tab .mb-karsten tbody th .mana-cost { flex-direction: column; gap: 1px; }
    #manabase-tab .mb-karsten tbody th .ms { width: 14px; height: 14px; min-width: 14px; min-height: 14px; font-size: 8px; }
    #manabase-tab .mb-karsten td { height: 46px; padding: 4px 1px; font-size: var(--t-body); }
    #manabase-tab .mb-turn-word,
    #manabase-tab .mb-cell-word { display: none; }
    #manabase-tab .mb-turn-short { display: inline; }
}
`;

export const guide = {
    intro: `Every spell with coloured mana symbols is checked against your actual lands: by the turn matching its mana value, how often can your lands pay its colours? Multicolour cards are checked as a whole — a ${mana('{G}{U}')} card needs a green source and a blue source at once, and a single Breeding Pool cannot be both.`,
    howToRead: [
        '<strong>Right colours</strong> is the headline chance: if you have drawn enough lands by that turn, how often they can pay every coloured symbol. Frank Karsten aims for 90% on the cards that matter.',
        'The <strong>turn strips</strong> show <em>when</em> a card or colour becomes reliable, not just on curve: one cell per turn from 1 to 8, assuming you made every land drop. Solid is 90% or better, hatched 80–89%, a ring under 80%; the outlined cell is the card’s own turn. A dash means not enough lands yet. Hover a cell for its chance.',
        '<strong>Lands + colours</strong> also counts missed land drops, so it is always lower — for expensive cards it is mostly about land count, which more lands fix and better colours do not.',
        '<strong>Colours</strong> compares each colour’s sources with what its hardest card wants. The colour furthest short is the bottleneck.',
        '<strong>Sources for 90% on curve</strong> is a Karsten-style table worked out for your deck size and land count. Green cells are ones your sources already meet; outlined cells are where you actually have cards.',
        '<strong>Your lands</strong> groups lands by the colours they make for this deck. “Any colour” lands count as a source of every colour you play.'
    ],
    method: 'Exact, not simulated. Lands are grouped by the set of colours they make, and the chance is summed over every way the cards you have seen by that turn can split across those groups and your nonlands (the multivariate hypergeometric distribution). For each split it checks whether the lands can pay all the coloured symbols at once — each land paying one symbol of a colour it makes. The headline figure is conditional: given you have drawn at least as many lands as the turn number, the chance they are the right colours. That is Frank Karsten’s convention; it isolates colour problems from plain mana screw. Being conditional, it says nothing about how often you hit the land drops in the first place — the “Lands + colours” column does.',
    assumptions: [
        'Only lands are counted as mana sources. Mana rocks, dorks and ramp spells make real decks more reliable than these numbers.',
        `Each card is checked on the turn matching its mana value, needing that many lands. X counts as 1, so ${mana('{X}{U}{U}')} is checked on turn 3.`,
        `Hybrid symbols (${mana('{U/B}')}) are paid by either colour. Phyrexian symbols ({G/P}) are left out because you can pay 2 life instead, and twobrid ({2/W}) because two generic mana also pays it.`,
        'Lands that make any colour — Command Tower, fetches for basics — count for every colour in the deck. Lands that enter tapped are treated as untapped.',
        'Cards seen by a turn: your opening seven plus one draw per turn. In Commander everyone draws on turn one; in 60- and 40-card games the player on the play skips that draw.',
        'Double-faced cards imported without a mana cost cannot be checked and are listed under the card table.'
    ],
    tips: [
        'If one colour is the bottleneck, swapping a basic of your main colour for a dual land helps it without hurting the other colour.',
        'Cards with two or more pips of a colour on turns 2–3 are the hardest to support. If a splash colour is short, keep its cards to one pip and later in the curve.',
        'A low “Lands + colours” chance on a cheap card usually means too few lands, not the wrong ones — check Land Drops.'
    ],
    terms: ['exact', 'hypergeometric', 'mv', 'pip', 'source', 'oncurve', 'play']
};
