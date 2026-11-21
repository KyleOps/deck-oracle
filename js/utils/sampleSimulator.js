import { shuffle } from './random.js';
import { asLibrary, cardTypes, expandLibrary } from './library.js';

/**
 * Shared Sample Simulator Utility
 * Provides common functionality for running and displaying sample simulations
 */

/**
 * The library as simulation cards, one object per copy (so a page may tag
 * copies one by one). Commanders are never included — see library.js.
 *
 * @param {Object} deck - a Library from libraryOf(), or anything libraryOf()
 *   accepts (a DeckConfig snapshot; a bare `{cardsByName}` has no commanders)
 * @param {Object} [opts] - libraryOf() options when `deck` is not a Library
 * @returns {Array<{name:string, types:ReadonlyArray<string>, type_line:string, cmc:number, mana_cost:string, power:*, toughness:*}>}
 */
export function buildDeckFromCardData(deck, opts) {
    return expandLibrary(asLibrary(deck, opts), card => ({
        name: card.name,
        types: cardTypes(card.type_line),
        type_line: card.type_line,
        cmc: card.cmc !== undefined ? card.cmc : 0,
        mana_cost: card.mana_cost || '',
        power: card.power,
        toughness: card.toughness
    }));
}

/**
 * Fisher–Yates shuffle, in place.
 * @param {Array} array - modified in place
 * @param {() => number} [rng=Math.random]
 * @returns {Array} the same array
 */
export function shuffleDeck(array, rng = Math.random) {
    return shuffle(array, rng);
}

/**
 * Render type distribution chart as responsive HTML
 * @param {Array<number>} distribution - Distribution array (index = count, value = frequency)
 * @param {number} totalSims - Total simulations run
 * @param {Function} labelFn - Function to generate label for each count (e.g., "3 types")
 * @param {Function} markerFn - Function to determine if marker should be shown (e.g., free spell threshold)
 * @returns {string} - HTML string
 */
export function renderDistributionChart(distribution, totalSims, labelFn, markerFn, toneFn = null) {
    let html = '<div class="distribution-chart">';

    // Map distribution to objects with metadata
    const rows = distribution.map((count, index) => {
        const pct = (count / totalSims * 100);
        const marker = markerFn(index);
        return {
            index,
            count,
            pct,
            marker,
            label: labelFn(index)
        };
    });

    // Filter to show:
    // 1. Any row with > 0 occurrences
    // 2. Any row with a marker (even if 0 occurrences, e.g. "Max Possible")
    // 3. Always show first and last indices if range is small, but for large ranges we might skip
    let visibleRows = rows.filter(r => r.count > 0 || r.marker);

    // If we filtered out everything (e.g. 0 simulations?), show something
    if (visibleRows.length === 0 && rows.length > 0) {
        visibleRows = [rows[0]];
    }

    // If we have too many visible rows, compress
    let finalRows = visibleRows;
    const MAX_ROWS = 20;

    if (visibleRows.length > MAX_ROWS) {
        const minIndex = visibleRows[0].index;
        const maxIndex = visibleRows[visibleRows.length - 1].index;
        
        const markedIndices = new Set(visibleRows.filter(r => r.marker).map(r => r.index));
        const sortedByFreq = [...visibleRows].sort((a, b) => b.count - a.count);
        const topIndices = new Set(sortedByFreq.slice(0, 15).map(r => r.index));

        const indicesToShow = new Set([minIndex, maxIndex, ...markedIndices, ...topIndices]);
        finalRows = rows.filter(r => indicesToShow.has(r.index));
    }

    // Render HTML bars
    let lastIndex = -1;
    finalRows.forEach(row => {
        // Check for gap
        if (lastIndex !== -1 && row.index > lastIndex + 1) {
             html += `<div class="dist-gap" style="font-size: 0.8em; color: var(--tx-dim); text-align: center; margin: 2px 0;">...</div>`;
        }
        
        const pctStr = row.pct.toFixed(1) + '%';
        const markerHTML = row.marker ? `<span class="dist-marker">${row.marker}</span>` : '';
        // Optional tone lets a caller colour buckets by meaning (e.g. a whiff
        // range in red) instead of every bar reading as a neutral success.
        const tone = toneFn ? toneFn(row.index) : null;
        const toneClass = tone === 'bad' ? ' is-bad' : tone === 'warn' ? ' is-warn' : '';

        html += `
            <div class="dist-row">
                <div class="dist-label">${row.label}</div>
                <div class="dist-bar-container">
                    <div class="dist-bar${toneClass}" style="width: ${row.pct}%;"></div>
                </div>
                <div class="dist-value">${pctStr}</div>
                ${markerHTML}
            </div>
        `;
        
        lastIndex = row.index;
    });

    html += '</div>';
    return html;
}
