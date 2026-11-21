/**
 * Deck comparison — two decks (or two versions of one deck) side by side.
 *
 * Pure: takes DeckConfig- or library-snapshot-shaped decks and returns
 * metrics, a card diff and a plain-language summary. Every metric is exact
 * (see deckStats.js), so differences are real, not simulation noise.
 */

import { analyzeDeckStats } from './deckStats.js';
import { resolveFormat } from './format.js';
import { readCommanders, commanderLabel, commandZoneExtras } from './commanders.js';
import { pct, plural } from './text.js';

/**
 * Metric definitions. `better` says which direction is an improvement:
 * 'up', 'down', or null for neutral counts (shown, never judged).
 */
export const METRICS = Object.freeze([
    // Counted as players count a deck: the library plus its commanders.
    { key: 'cards', label: 'Cards', better: null, fmt: 'int', get: (s, deck) => s.deckSize + (deck?.commandZone ?? 0) },
    { key: 'lands', label: 'Lands', better: null, fmt: 'int', get: s => s.lands },
    { key: 'landGap', label: 'Lands vs typical', better: 'closer', fmt: 'signed', get: s => s.lands - s.landRec.recommended, hint: 'Your land count minus the count Frank Karsten’s regression suggests for this curve. Closer to zero is more typical.' },
    { key: 'avgMV', label: 'Average mana value', better: 'down', fmt: 'dec2', get: s => s.curve.average, hint: 'Nonland cards only. Lower means a faster, cheaper curve.' },
    { key: 'keepable', label: 'Keepable openers (2–4 lands)', better: 'up', fmt: 'pct', get: s => s.odds.keepable },
    { key: 'drop3', label: 'All land drops by turn 3', better: 'up', fmt: 'pct', get: s => s.odds.dropsBy[3] },
    { key: 'drop5', label: 'All land drops by turn 5', better: 'up', fmt: 'pct', get: s => s.odds.dropsBy[5] },
    { key: 'colors', label: 'Weakest colour on curve', better: 'up', fmt: 'pct', get: s => weakestColor(s), hint: 'The hardest-to-cast card of your weakest colour: chance its colours are there on curve, given your land drops.' },
    { key: 'ramp', label: 'Ramp', better: null, fmt: 'int', get: s => s.tags.counts.ramp ?? 0 },
    { key: 'draw', label: 'Card draw', better: null, fmt: 'int', get: s => s.tags.counts.draw ?? 0 },
    { key: 'removal', label: 'Removal', better: null, fmt: 'int', get: s => s.tags.counts.removal ?? 0 },
    { key: 'wipe', label: 'Board wipes', better: null, fmt: 'int', get: s => s.tags.counts.wipe ?? 0 }
]);

function weakestColor(stats) {
    const values = stats.colors.map(c => c.onCurve).filter(v => typeof v === 'number');
    return values.length ? Math.min(...values) : null;
}

/**
 * Normalise a library snapshot or DeckConfig object to what analyzeDeckStats
 * reads. Old snapshots with a single `commanderName` work too.
 */
export function toDeck(deck = {}) {
    const commanders = readCommanders(deck);
    const cardsByName = deck.cardsByName ?? {};
    return {
        name: deck.name ?? deck.deckName ?? commanderLabel(commanders) ?? 'Untitled deck',
        commanders,
        commanderName: commanders[0]?.name ?? null,
        // Commanders not already in the list (they start in the command zone).
        commandZone: commandZoneExtras(commanders, cardsByName),
        format: deck.format ?? 'auto',
        cardsByName,
        actualCardCount: deck.actualCardCount ?? null,
        lands: deck.counts?.lands ?? deck.lands ?? 0
    };
}

function cardCount(cardsByName = {}) {
    return Object.values(cardsByName).reduce((s, c) => s + (Number(c?.count) || 0), 0);
}

/**
 * Card-level diff by name.
 * @returns {{onlyA:Array<{name,count}>, onlyB:Array<{name,count}>, changed:Array<{name,a,b}>, shared:number}}
 */
export function diffCards(a = {}, b = {}) {
    const byName = cards => {
        const map = new Map();
        for (const c of Object.values(cards)) {
            if (c?.name && Number(c.count) > 0) map.set(c.name, (map.get(c.name) ?? 0) + Number(c.count));
        }
        return map;
    };
    const A = byName(a);
    const B = byName(b);
    const onlyA = [];
    const onlyB = [];
    const changed = [];
    let shared = 0;
    for (const [name, count] of A) {
        if (!B.has(name)) onlyA.push({ name, count });
        else if (B.get(name) !== count) changed.push({ name, a: count, b: B.get(name) });
        else shared += count;
    }
    for (const [name, count] of B) if (!A.has(name)) onlyB.push({ name, count });
    const byNameSort = (x, y) => x.name.localeCompare(y.name);
    return { onlyA: onlyA.sort(byNameSort), onlyB: onlyB.sort(byNameSort), changed: changed.sort(byNameSort), shared };
}

/**
 * Compare two decks.
 * @param {Object} deckA
 * @param {Object} deckB
 * @param {{onPlay?:boolean}} [opts]
 */
export function compareDecks(deckA, deckB, { onPlay = true } = {}) {
    const a = toDeck(deckA);
    const b = toDeck(deckB);
    const fmtA = resolveFormat(a.format, { deckSize: a.actualCardCount ?? cardCount(a.cardsByName), commanders: a.commanders });
    const fmtB = resolveFormat(b.format, { deckSize: b.actualCardCount ?? cardCount(b.cardsByName), commanders: b.commanders });
    const statsA = analyzeDeckStats(a, { format: fmtA, onPlay });
    const statsB = analyzeDeckStats(b, { format: fmtB, onPlay });

    const metrics = METRICS.map(m => {
        const va = m.get(statsA, a);
        const vb = m.get(statsB, b);
        const both = typeof va === 'number' && typeof vb === 'number';
        let winner = null;
        if (both && m.better) {
            const score = v => (m.better === 'up' ? v : m.better === 'down' ? -v : -Math.abs(v));
            const diff = score(vb) - score(va);
            const epsilon = m.fmt === 'pct' ? 0.005 : m.fmt === 'dec2' ? 0.02 : 0.5;
            if (Math.abs(diff) > epsilon) winner = diff > 0 ? 'B' : 'A';
        }
        return { ...m, a: va, b: vb, delta: both ? vb - va : null, winner };
    });

    return {
        a: { ...a, format: fmtA, stats: statsA },
        b: { ...b, format: fmtB, stats: statsB },
        metrics,
        diff: diffCards(a.cardsByName, b.cardsByName),
        sameFormat: fmtA.key === fmtB.key
    };
}

/**
 * Plain-language summary of the most important differences.
 * @param {ReturnType<typeof compareDecks>} result
 * @param {{nameA?:string, nameB?:string}} [names]
 * @returns {{html:string, tone:'good'|'flat'}}
 */
export function summarizeComparison(result, { nameA = 'Deck A', nameB = 'Deck B' } = {}) {
    if (!result) return { html: '', tone: 'flat' };
    const { diff } = result;
    const judged = result.metrics.filter(m => m.winner);
    if (judged.length === 0) {
        return {
            html: `<strong>${nameA}</strong> and <strong>${nameB}</strong> play almost identically on every check here${diff.onlyA.length + diff.onlyB.length ? ` — they differ by ${plural(diff.onlyA.length + diff.onlyB.length, 'card')}` : ''}.`,
            tone: 'flat'
        };
    }
    // Rank by how big each difference is relative to its scale.
    const size = m => (m.fmt === 'pct' ? Math.abs(m.delta) * 100 : m.fmt === 'dec2' ? Math.abs(m.delta) * 20 : Math.abs(m.delta) * 6);
    const top = judged.slice().sort((x, y) => size(y) - size(x)).slice(0, 2);
    const phrase = m => {
        const who = m.winner === 'B' ? nameB : nameA;
        const [win, lose] = m.winner === 'B' ? [m.b, m.a] : [m.a, m.b];
        switch (m.key) {
            case 'keepable': return `<strong>${who}</strong> keeps more opening hands (${pct(win)} vs ${pct(lose)})`;
            case 'drop3': return `<strong>${who}</strong> hits its early land drops more often (${pct(win)} vs ${pct(lose)} through turn 3)`;
            case 'drop5': return `<strong>${who}</strong> is likelier to make every land drop to turn 5 (${pct(win)} vs ${pct(lose)})`;
            case 'colors': return `<strong>${who}</strong> has the steadier mana (${pct(win)} vs ${pct(lose)} for its weakest colour)`;
            case 'avgMV': return `<strong>${who}</strong> curves lower (average ${win.toFixed(2)} vs ${lose.toFixed(2)})`;
            case 'landGap': return `<strong>${who}</strong>’s land count is closer to typical for its curve`;
            default: return `<strong>${who}</strong> does better on ${m.label.toLowerCase()}`;
        }
    };
    const changes = diff.onlyA.length + diff.onlyB.length + diff.changed.length;
    const tail = changes > 0 && changes <= 30
        ? ` The lists differ by ${plural(changes, 'card')}.`
        : '';
    return { html: `${top.map(phrase).join('; ')}.${tail}`, tone: 'good' };
}
