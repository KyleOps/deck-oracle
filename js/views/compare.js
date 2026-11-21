/**
 * Compare Decks — view.
 * Two deck pickers, then the comparison: summary, metric table, curve
 * overlay and the card-by-card difference.
 */

export const template = `
<div class="cmp">
    <section class="cmp-pickers" aria-label="Decks to compare">
        <label class="cmp-picker cmp-picker-a">
            <span class="cmp-picker-tag">A</span>
            <select class="field" id="cmp-deck-a" aria-label="First deck"></select>
        </label>
        <button class="icon-btn cmp-swap" type="button" id="cmp-swap" aria-label="Swap decks" data-tip="Swap A and B">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>
        </button>
        <label class="cmp-picker cmp-picker-b">
            <span class="cmp-picker-tag">B</span>
            <select class="field" id="cmp-deck-b" aria-label="Second deck"></select>
        </label>
    </section>

    <div id="cmp-body"></div>
</div>
`;

export const styles = `
#compare-tab .cmp,
#compare-tab #cmp-body { display: grid; gap: 16px; }

#compare-tab .cmp-pickers {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
}

#compare-tab .cmp-picker {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--tx-panel);
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-lg);
}

#compare-tab .cmp-picker select { flex: 1; min-width: 0; background: var(--tx-bg); }

#compare-tab .cmp-picker-tag {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 50%;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: var(--t-xs);
    color: var(--tx-bg);
}

#compare-tab .cmp-picker-a .cmp-picker-tag,
#compare-tab .cmp-dot-a { background: var(--series-3); }
#compare-tab .cmp-picker-b .cmp-picker-tag,
#compare-tab .cmp-dot-b { background: var(--series-2); }

#compare-tab .cmp-card {
    background: var(--tx-panel);
    border: 1px solid var(--tx-rule);
    border-radius: var(--radius-lg);
    overflow: clip;
}

#compare-tab .cmp-card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 14px 18px 0;
}

#compare-tab .cmp-card-title { font-size: var(--t-body); font-weight: 650; }
#compare-tab .cmp-card-meta { font-size: var(--t-xs); color: var(--tx-dim); }

/* Side by side: one dumbbell per check, A and B on the same scale */
#compare-tab .cmp-key {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
    margin: 6px 0 0; padding: 0 18px; font-size: var(--t-xs); color: var(--tx-dim);
}
#compare-tab .cmp-key-dot { position: static; display: inline-block; width: 12px; height: 12px; margin: 0; }
#compare-tab .cmp-key-dot + * { margin-left: 0; }
#compare-tab .cmp-rows { margin-top: 8px; }
#compare-tab .cmp-row {
    display: grid;
    grid-template-columns: minmax(150px, 1.3fr) 64px minmax(120px, 2fr) 64px minmax(96px, 0.9fr);
    gap: 4px 14px;
    align-items: center;
    padding: 8px 18px;
    border-top: 1px solid var(--tx-rule);
}
#compare-tab .cmp-row-label { font-size: var(--t-sm); color: var(--tx-mid); }
#compare-tab .cmp-row-val { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--tx-text); text-align: right; white-space: nowrap; }
#compare-tab .cmp-row-val:nth-child(4) { text-align: left; }
#compare-tab .cmp-row-val.is-win { color: var(--tx-bright); font-weight: 600; }
#compare-tab .cmp-row-tag { display: none; margin-right: 6px; font-size: var(--t-label); color: var(--tx-dim); }
#compare-tab .cmp-row-delta { text-align: right; }
#compare-tab .cmp-delta { font-size: var(--t-xs); color: var(--tx-dim); white-space: nowrap; }
#compare-tab .cmp-delta.tone-better-a,
#compare-tab .cmp-delta.tone-better-b { color: var(--tx-good); }

#compare-tab .cmp-curve {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 10px;
    height: 200px;
    padding: 18px 18px 14px;
    align-items: end;
}

#compare-tab .cmp-col { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 100%; gap: 6px; }
#compare-tab .cmp-pair { display: flex; align-items: flex-end; gap: 3px; height: 100%; }
#compare-tab .cmp-bar {
    flex: 1;
    border-radius: 4px 4px 0 0;
    min-height: 2px;
    transition: height 0.45s var(--ease-out);
}
#compare-tab .cmp-bar-a { background: var(--series-3); }
#compare-tab .cmp-bar-b { background: var(--series-2); }
#compare-tab .cmp-col-label { text-align: center; font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-dim); }

#compare-tab .cmp-legend { display: flex; gap: 16px; padding: 0 18px 16px; font-size: var(--t-xs); color: var(--tx-mid); }
#compare-tab .cmp-legend span { display: inline-flex; align-items: center; gap: 6px; }
#compare-tab .cmp-dot { width: 10px; height: 10px; border-radius: 3px; }

#compare-tab .cmp-diff {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    margin-top: 10px;
}

#compare-tab .cmp-diff-col { padding: 12px 18px 16px; border-top: 1px solid var(--tx-rule); }
#compare-tab .cmp-diff-col + .cmp-diff-col { border-left: 1px solid var(--tx-rule); }
#compare-tab .cmp-diff-col h4 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--tx-mid);
}
#compare-tab .cmp-diff-list { list-style: none; display: grid; gap: 4px; font-size: var(--t-xs); }
#compare-tab .cmp-diff-list .num { color: var(--tx-dim); font-family: var(--font-mono); margin-right: 6px; }
#compare-tab .cmp-empty-note { font-size: var(--t-xs); color: var(--tx-dim); }

#compare-tab .cmp-empty {
    padding: 40px 24px;
    text-align: center;
    border: 1px dashed var(--tx-rule-hi);
    border-radius: var(--radius-lg);
    color: var(--tx-mid);
}
#compare-tab .cmp-empty-title { font-size: var(--t-lg); margin-bottom: 6px; color: var(--tx-bright); }
#compare-tab .cmp-empty p { margin: 0 auto 16px; max-width: 52ch; }

@container shell (max-width: 720px) {
    #compare-tab .cmp-pickers { grid-template-columns: minmax(0, 1fr); }
    #compare-tab .cmp-swap { justify-self: center; transform: rotate(90deg); }
    #compare-tab .cmp-diff { grid-template-columns: minmax(0, 1fr); }
    #compare-tab .cmp-diff-col + .cmp-diff-col { border-left: 0; }
    #compare-tab .cmp-row {
        grid-template-columns: auto minmax(0, 1fr) auto;
        padding: 10px 14px;
    }
    #compare-tab .cmp-row-label { grid-column: 1 / 3; }
    #compare-tab .cmp-row-delta { grid-column: 3; grid-row: 1; }
    #compare-tab .cmp-row-val:nth-child(4) { text-align: right; }
    #compare-tab .cmp-row-tag { display: inline; }
}
`;

export const guide = {
    intro: 'Put two decks — or two versions of the same deck — side by side. Every deck you import is saved in this browser, so you can compare a list before and after an update, or two builds of the same commander.',
    howToRead: [
        'The <strong>bottom line</strong> names the biggest real differences between the two lists.',
        '<strong>Side by side</strong> puts A and B on one scale per check, joined by a line — the longer the line, the bigger the difference. Where more (or less) is clearly better, the better deck’s dot is filled green and its number is bold. Neutral counts (ramp, draw, removal) are shown but not judged — more is not automatically better.',
        'The <strong>curve</strong> overlays both decks’ nonland cards by mana value.',
        '<strong>Card differences</strong> lists what is only in A, only in B, and what changed copy counts.'
    ],
    method: 'Both decks run through the same exact analysis as the Deck Overview: hypergeometric land and colour odds, Frank Karsten’s land regression, and rules-text role detection. No simulation, so every difference is real rather than noise.',
    assumptions: [
        'Each deck uses its own format (detected, or what you set on the overview).',
        'Turn-order dependent rows assume you are on the play in 60- and 40-card formats.'
    ],
    terms: ['exact', 'keepable', 'oncurve', 'mv']
};
