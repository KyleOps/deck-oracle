/**
 * Deck Radar Panel
 *
 * The post-import briefing: what the deck is made of, and which calculators are
 * worth opening for it. Pure-DOM (no Chart.js) so it renders instantly on import
 * and reflows cleanly on phones — the composition bar and mana curve are both
 * built from divs rather than canvas.
 *
 * Layout helpers (`buildTypeSegments`, `buildCurveBars`) are pure and unit-tested;
 * the render functions below are the only part that touches the document.
 */

import { relevantCalculators, deriveDeckFacts } from './deckRadar.js';

/** Card type → CSS custom property used for its colour swatch. */
const TYPE_COLORS = {
    creatures: 'var(--type-creature)',
    instants: 'var(--type-instant)',
    sorceries: 'var(--type-sorcery)',
    artifacts: 'var(--type-artifact)',
    enchantments: 'var(--type-enchantment)',
    planeswalkers: 'var(--type-planeswalker)',
    battles: 'var(--type-battle)',
    lands: 'var(--type-land)'
};

/** Short display labels for the composition legend. */
const TYPE_LABELS = {
    creatures: 'CREA',
    instants: 'INST',
    sorceries: 'SORC',
    artifacts: 'ARTF',
    enchantments: 'ENCH',
    planeswalkers: 'PLNS',
    battles: 'BTTL',
    lands: 'LAND'
};

// ==================== PURE LAYOUT HELPERS ====================

/**
 * Turn type counts into stacked-bar segments with percentage widths. Zero-count
 * types are dropped so the bar never contains invisible slivers.
 *
 * @param {Object} counts - { creatures: 30, lands: 36, ... }
 * @returns {Array<{key:string, label:string, count:number, pct:number, color:string}>}
 */
export function buildTypeSegments(counts = {}) {
    const entries = Object.entries(TYPE_COLORS)
        .map(([key]) => [key, Number.isFinite(counts[key]) ? counts[key] : 0])
        .filter(([, v]) => v > 0);

    const total = entries.reduce((a, [, v]) => a + v, 0);
    if (total === 0) return [];

    return entries.map(([key, count]) => ({
        key,
        label: TYPE_LABELS[key] || key.toUpperCase(),
        count,
        pct: (count / total) * 100,
        color: TYPE_COLORS[key]
    }));
}

/**
 * Turn a mana curve map into bar descriptors with heights normalized against the
 * tallest column. Always spans 0..maxCmc so gaps in the curve stay visible.
 *
 * @param {Object} curve - { 1: 12, 2: 15, ... } keyed by MV
 * @param {Object} [opts]
 * @param {number} [opts.maxCmc=7] - Highest column; anything above is folded into it
 * @returns {Array<{cmc:number, count:number, heightPct:number, label:string}>}
 */
export function buildCurveBars(curve = {}, opts = {}) {
    const { maxCmc = 7 } = opts;

    const buckets = new Array(maxCmc + 1).fill(0);
    for (const [k, v] of Object.entries(curve)) {
        const cmc = Number(k);
        const count = Number(v);
        if (!Number.isFinite(cmc) || !Number.isFinite(count) || count <= 0) continue;
        buckets[Math.min(Math.max(0, Math.round(cmc)), maxCmc)] += count;
    }

    const peak = Math.max(...buckets);
    return buckets.map((count, cmc) => ({
        cmc,
        count,
        heightPct: peak > 0 ? (count / peak) * 100 : 0,
        label: cmc === maxCmc ? `${maxCmc}+` : String(cmc)
    }));
}

// ==================== DOM RENDERING ====================

/**
 * Read a calculator's display code and name straight off its tab button, so the
 * radar never drifts out of sync with the nav.
 *
 * @param {string} tab
 * @returns {{code:string, name:string}}
 */
function tabMeta(tab) {
    const el = document.querySelector(`.tx-tab[data-tab="${tab}"]`);
    return {
        code: el?.querySelector('.tx-code')?.textContent?.trim() || tab.slice(0, 3).toUpperCase(),
        name: el?.querySelector('.tx-name')?.textContent?.trim() || tab
    };
}

/**
 * Escape text destined for innerHTML. Deck and card names come from third-party
 * APIs, so they are never trusted.
 *
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

/**
 * Build the composition column: headline numbers, stacked type bar, legend, and
 * the mana curve histogram.
 *
 * @param {Object} facts - from deriveDeckFacts
 * @returns {string} HTML
 */
function renderComposition(facts) {
    const segments = buildTypeSegments(facts.counts);
    const bars = buildCurveBars(facts.curve);
    const landPct = facts.total > 0 ? Math.round((facts.counts.lands / facts.total) * 100) : 0;

    const bar = segments.map(s =>
        `<span class="rdr-seg" style="width:${s.pct.toFixed(2)}%; background:${s.color};" title="${esc(s.label)} ${s.count}"></span>`
    ).join('');

    const legend = segments.map(s => `
        <span class="rdr-legend-item">
            <span class="rdr-swatch" style="background:${s.color};"></span>${s.label}
            <span class="rdr-legend-n">${s.count}</span>
        </span>`).join('');

    const hasCurve = bars.some(b => b.count > 0);
    const curve = hasCurve ? `
        <div class="rdr-curve-title">MANA CURVE <span class="rdr-dim">(nonland)</span></div>
        <div class="rdr-curve">
            ${bars.map(b => `
                <div class="rdr-curve-col" title="MV ${b.label}: ${b.count} cards">
                    <div class="rdr-curve-n">${b.count || ''}</div>
                    <div class="rdr-curve-bar" style="height:${Math.max(b.heightPct, b.count > 0 ? 4 : 0).toFixed(1)}%;"></div>
                    <div class="rdr-curve-x">${b.label}</div>
                </div>`).join('')}
        </div>` : '';

    return `
        <div class="rdr-metrics">
            <div class="rdr-metric"><span class="rdr-metric-n">${facts.total}</span><span class="rdr-metric-l">CARDS</span></div>
            <div class="rdr-metric"><span class="rdr-metric-n">${facts.counts.lands}</span><span class="rdr-metric-l">LANDS · ${landPct}%</span></div>
            <div class="rdr-metric"><span class="rdr-metric-n">${facts.avgCmc.toFixed(2)}</span><span class="rdr-metric-l">AVG MV</span></div>
            <div class="rdr-metric"><span class="rdr-metric-n">${Math.round(facts.permanentRatio * 100)}%</span><span class="rdr-metric-l">PERMANENTS</span></div>
        </div>
        <div class="rdr-bar">${bar}</div>
        <div class="rdr-legend">${legend}</div>
        ${curve}
    `;
}

/**
 * Build the ranked calculator list. Each row is a button that switches tabs.
 *
 * @param {Array} ranked - from relevantCalculators
 * @returns {string} HTML
 */
function renderMatches(ranked) {
    if (ranked.length === 0) {
        return `<div class="rdr-empty">No specific matches — start with Mulligan or Land Drops.</div>`;
    }

    return ranked.map(r => {
        const { code, name } = tabMeta(r.tab);
        const reason = r.reasons[0] || '';
        const extra = r.reasons.length > 1
            ? `<div class="rdr-reason rdr-reason-2">${esc(r.reasons[1])}</div>`
            : '';
        return `
            <button class="rdr-row rdr-tier-${r.tier}" data-radar-tab="${esc(r.tab)}">
                <span class="rdr-badge" style="color:${r.color}; border-color:${r.color};">${r.tierLabel}</span>
                <span class="rdr-row-main">
                    <span class="rdr-row-title"><span class="rdr-code">${esc(code)}</span> ${esc(name)}</span>
                    <span class="rdr-reason">${esc(reason)}</span>
                    ${extra}
                </span>
                <span class="rdr-go">OPEN →</span>
            </button>`;
    }).join('');
}

/**
 * Render the full radar panel for a deck and mark matching tabs.
 *
 * @param {Object} deck - DeckConfig-shaped object
 * @param {Object} [opts]
 * @param {(tab: string) => void} [opts.onSelect] - Called when a row is clicked
 * @param {string} [opts.elementId='tx-radar'] - Container element id
 * @returns {Array} the ranked matches that were rendered
 */
export function renderRadar(deck, opts = {}) {
    const { onSelect, elementId = 'tx-radar' } = opts;
    const container = document.getElementById(elementId);
    if (!container) return [];

    const facts = deriveDeckFacts(deck);
    const ranked = relevantCalculators(deck, { limit: 6 });

    const deckName = deck?.deckName ? ` · ${esc(deck.deckName)}` : '';
    const coreCount = ranked.filter(r => r.tier === 'core').length;

    container.innerHTML = `
        <div class="tx-h rdr-head">
            <span>DECK RADAR${deckName}</span>
            <span class="tx-h-r">
                ${coreCount} MATCHED · ${ranked.length} SUGGESTED
                <button class="rdr-close" id="rdr-close" aria-label="Hide deck radar">[ HIDE ✕ ]</button>
            </span>
        </div>
        <div class="rdr-body">
            <div class="rdr-col rdr-col-comp">
                <div class="rdr-col-title">COMPOSITION</div>
                ${renderComposition(facts)}
            </div>
            <div class="rdr-col rdr-col-match">
                <div class="rdr-col-title">RELEVANT CALCULATORS</div>
                <div class="rdr-rows">${renderMatches(ranked)}</div>
            </div>
        </div>
    `;
    container.style.display = 'block';

    container.querySelectorAll('[data-radar-tab]').forEach(btn => {
        btn.addEventListener('click', () => onSelect?.(btn.dataset.radarTab));
    });
    container.querySelector('#rdr-close')?.addEventListener('click', () => {
        container.style.display = 'none';
    });

    markTabs(ranked);
    return ranked;
}

/**
 * Put a relevance dot on the nav tabs so matches stay discoverable after the
 * panel is dismissed. Only `core` (card is actually in the deck) and `likely`
 * get a marker — otherwise everything lights up and the signal is lost.
 *
 * @param {Array} ranked
 */
export function markTabs(ranked = []) {
    const byTab = new Map(ranked.map(r => [r.tab, r]));
    document.querySelectorAll('.tx-tab[data-tab]').forEach(el => {
        const match = byTab.get(el.dataset.tab);
        const level = (match?.tier === 'core') ? 'core'
            : (match?.tier === 'likely') ? 'likely'
            : null;

        el.classList.toggle('tx-tab-hit', level === 'core');
        el.classList.toggle('tx-tab-maybe', level === 'likely');

        const existing = el.querySelector('.tx-tab-dot');
        if (level) {
            if (!existing) {
                const dot = document.createElement('span');
                dot.className = 'tx-tab-dot';
                el.appendChild(dot);
            }
            el.title = match.reasons[0] || '';
        } else {
            existing?.remove();
            el.removeAttribute('title');
        }
    });
}
