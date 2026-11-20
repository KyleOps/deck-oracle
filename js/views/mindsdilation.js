/**
 * Mind's Dilation — view.
 * Mounted into #mindsdilation-tab by the shell; js/calculators/mindsdilation.js
 * renders the summary, detail and sample regions. The Sixth Doctor switch is
 * static markup so re-renders never steal its focus.
 */

import { cardRef } from '../data/glossary.js';
import { opponentPageStyles } from '../utils/opponentPages.js';

export const template = `
<div class="main-grid single-column">
    <section class="panel" id="mnds-results" aria-label="Free spells from Mind’s Dilation">
        <div id="mnds-summary"></div>
        <div class="mnds-options" id="mnds-options" hidden>
            <label class="mnds-switch">
                <input type="checkbox" id="mnds-sixth-doctor" role="switch">
                <span class="mnds-switch-track" aria-hidden="true"></span>
                <span class="mnds-switch-text">
                    <span class="mnds-switch-title">${cardRef('The Sixth Doctor')} is on the battlefield</span>
                    <span class="mnds-switch-hint">It copies the first historic spell you cast each turn, so free artifacts, legendaries and Sagas count double.</span>
                </span>
            </label>
        </div>
        <div id="mnds-detail"></div>
    </section>

    <section class="panel" id="mnds-sample-panel" aria-label="Sample rounds" hidden>
        <div class="opp-section-head">
            <div>
                <h2 class="opp-section-title">The next six rounds</h2>
                <p class="opp-section-sub">One real shuffle of each list — the card each opponent exiles on each of their turns.</p>
            </div>
            <div class="opp-section-actions"><button type="button" class="btn btn-ghost btn-sm" id="mnds-resample-btn">Reshuffle</button></div>
        </div>
        <div class="mnds-samples" id="mnds-samples"></div>
    </section>
</div>
`;

export const styles = `
${opponentPageStyles('#mindsdilation-tab')}
#mindsdilation-tab .mnds-options {
    padding: 12px 16px;
    border-bottom: 1px solid var(--tx-rule);
    background: var(--tx-panel-alt);
}
#mindsdilation-tab .mnds-switch { position: relative; display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
#mindsdilation-tab .mnds-switch input {
    position: absolute; left: 0; top: 2px; width: 36px; height: 20px; margin: 0; opacity: 0; cursor: pointer;
}
#mindsdilation-tab .mnds-switch-track {
    position: relative; flex: none; width: 36px; height: 20px; margin-top: 2px;
    border-radius: var(--radius-full); background: var(--tx-rule-hi);
    transition: background var(--transition-fast);
}
#mindsdilation-tab .mnds-switch-track::after {
    content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--tx-bright); box-shadow: var(--shadow-sm);
    transition: transform var(--transition-fast);
}
:root[data-theme="light"] #mindsdilation-tab .mnds-switch-track::after { background: var(--surface-raised); }
#mindsdilation-tab .mnds-switch input:checked + .mnds-switch-track { background: var(--tx-accent); }
#mindsdilation-tab .mnds-switch input:checked + .mnds-switch-track::after { transform: translateX(16px); background: var(--accent-ink); }
#mindsdilation-tab .mnds-switch input:focus-visible + .mnds-switch-track { outline: 2px solid var(--tx-accent); outline-offset: 2px; }
#mindsdilation-tab .mnds-switch-text { display: grid; gap: 2px; }
#mindsdilation-tab .mnds-switch-title { font-size: var(--t-sm); font-weight: 600; color: var(--tx-bright); }
#mindsdilation-tab .mnds-switch-hint { font-size: var(--t-xs); color: var(--tx-dim); }

#mindsdilation-tab .mnds-bands { display: grid; gap: 10px; padding: 0 16px 12px; }
#mindsdilation-tab .mnds-band-row { display: grid; grid-template-columns: minmax(150px, 280px) minmax(0, 1fr); gap: 16px; align-items: center; }
#mindsdilation-tab .mnds-band-who { min-width: 0; }
#mindsdilation-tab .mnds-band { display: flex; height: 26px; border-radius: var(--radius-sm); overflow: hidden; background: var(--tx-bg); }
#mindsdilation-tab .mnds-seg {
    display: grid; place-items: center; min-width: 0; overflow: hidden; white-space: nowrap;
    font-family: var(--font-mono); font-size: var(--t-label); font-weight: 600; color: var(--tx-bright);
}
#mindsdilation-tab .mnds-seg + .mnds-seg { box-shadow: inset 1px 0 0 var(--tx-panel); }
#mindsdilation-tab .is-land { background: var(--tx-rule-hi); }
#mindsdilation-tab .mnds-seg.is-land { color: var(--tx-mid); }
#mindsdilation-tab .is-cheap { background: color-mix(in srgb, var(--tx-good) 28%, var(--tx-panel-alt)); }
#mindsdilation-tab .is-mid { background: color-mix(in srgb, var(--tx-good) 58%, var(--tx-panel-alt)); }
#mindsdilation-tab .is-big { background: var(--tx-good); }
#mindsdilation-tab .mnds-seg.is-big { color: var(--tx-void); }
#mindsdilation-tab .mnds-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 2px 16px 16px; font-size: var(--t-xs); color: var(--tx-mid); }
#mindsdilation-tab .mnds-key { display: inline-flex; align-items: center; gap: 6px; }
#mindsdilation-tab .mnds-swatch { width: 12px; height: 12px; border-radius: 3px; }

#mindsdilation-tab .mnds-samples { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); border-top: 1px solid var(--tx-rule); }
#mindsdilation-tab .mnds-sample { min-width: 0; padding: 14px 16px; border-right: 1px solid var(--tx-rule); border-bottom: 1px solid var(--tx-rule); margin: 0 -1px -1px 0; }
#mindsdilation-tab .mnds-sample-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; margin-bottom: 12px; }
#mindsdilation-tab .mnds-sample-sum { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--tx-mid); white-space: nowrap; }
#mindsdilation-tab .mnds-turns { list-style: none; display: grid; gap: 6px; padding: 0; margin: 0; }
#mindsdilation-tab .mnds-turn { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 8px; }
#mindsdilation-tab .mnds-turn-n { font-size: var(--t-label); font-weight: 600; letter-spacing: var(--track-label); text-transform: uppercase; color: var(--tx-dim); }

@container shell (max-width: 640px) {
    #mindsdilation-tab .mnds-band-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }
}
`;

export const guide = {
    intro: 'Mind’s Dilation makes each opponent exile the top card of their library whenever they cast their first spell of a turn — and if it isn’t a land, you may cast it for free. This page works out how often that pays out against your opponents’ real decklists, and what it is worth.',
    howToRead: [
        '<strong>Hit chance</strong> is the share of nonland cards in an opponent’s library: the chance their top card is a spell you can cast.',
        '<strong>Free spells a round</strong> adds the hit chances together, assuming each opponent casts at least one spell on their own turn.',
        '<strong>Mana a round</strong> is the average mana value you get for free each round; <strong>Pays back in</strong> is how many rounds that takes to reach Mind’s Dilation’s own 7 mana.',
        'The coloured bars split each library into lands (a miss) and spells by cost. <strong>The next six rounds</strong> is one real shuffle of each list.'
    ],
    method: 'Exact. Each trigger exiles one random card from the library, so the hit chance is the nonland share and the value is the average mana value of their spells — no simulation needed. The six sample rounds are a random shuffle, for illustration.',
    assumptions: [
        'One trigger per opponent per round: everyone casts at least one spell on their own turn. Instants cast on other players’ turns trigger it again, so active tables do better than this.',
        'The whole imported list is treated as the library, and every exiled nonland card is cast. You still pay additional costs, and X is 0.',
        'Modal double-faced cards count by their front face (a spell on the front can be cast).',
        'The Sixth Doctor copies a historic spell only once each turn. Each opponent’s turn usually brings one free spell, so every historic free spell is counted double — slightly generous when several triggers land on the same turn.'
    ],
    tips: [
        'It is a seven-mana enchantment that pays out over time: the more opponents, and the longer the game, the better it gets.',
        'Opponents running few lands and expensive spells feed it best. Against land-heavy ramp decks, expect more misses.',
        'The Sixth Doctor makes artifact-heavy and legendary-heavy opponents twice as rewarding — check the Historic column.'
    ],
    terms: ['exact', 'mv', 'library', 'sample']
};
