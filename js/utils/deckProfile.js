/**
 * Deck profile — the Deck Overview's at-a-glance shape of a deck: six metrics,
 * each against a shaded typical range for the deck's format.
 *
 * Bullet rows rather than a radar: a radar's area grows with the square of
 * its values and depends on which axes happen to sit next to each other, so
 * two decks with the same numbers in a different order look different. A
 * bullet row is one value on one scale against one band — nothing to distort.
 *
 * Every range here is a GUIDELINE, stated as one in its tooltip: community
 * rules of thumb and Frank Karsten's targets, not facts about winning. Where
 * no common guideline exists (role counts outside Commander) no band is drawn.
 *
 * Pure and unit-tested; js/calculators/overview.js renders it.
 */

import { COMMANDER_GUIDELINES, deckCards } from './deckStats.js';
import { isLand } from './mana.js';
import { pct, plural } from './text.js';

/** Average mana value of nonland cards most decks of each format sit within. */
export const SPEED_GUIDE = Object.freeze({
    commander: { range: [2.8, 3.6], why: 'Most Commander decks average about 2.8–3.6 mana value across their nonland cards.' },
    constructed: { range: [1.9, 3.0], why: 'Most 60-card decks average about 1.9 (aggro) to 3.0 (control) mana value across their nonland cards.' },
    limited: { range: [2.6, 3.4], why: 'Most 40-card Limited decks average about 2.6–3.4 mana value across their nonland cards.' }
});

const ROLE_GUIDE = Object.freeze({
    ramp: { range: [COMMANDER_GUIDELINES.ramp.low, COMMANDER_GUIDELINES.ramp.high], why: `Many Commander players aim for ${COMMANDER_GUIDELINES.ramp.low}–${COMMANDER_GUIDELINES.ramp.high} ramp pieces.` },
    flow: { range: [8, 16], why: `Many Commander players aim for ${COMMANDER_GUIDELINES.draw.low}–${COMMANDER_GUIDELINES.draw.high} card-draw sources; tutors add to that.` },
    interaction: { range: [8, 16], why: `Many Commander players aim for ${COMMANDER_GUIDELINES.removal.low}–${COMMANDER_GUIDELINES.removal.high} targeted removal plus ${COMMANDER_GUIDELINES.wipe.low}–${COMMANDER_GUIDELINES.wipe.high} board wipes; counterspells can stand in for removal.` }
});

const GUIDELINE = ' A rough guideline, not a rule — your deck’s plan matters more.';
const NO_GUIDE = 'There is no common guideline for this in 60- and 40-card decks: it depends on the archetype.';


function rangeStatus(value, [lo, hi], { below = 'below typical', above = 'above typical', inside = 'typical' } = {}) {
    if (value < lo - 1e-9) return below;
    if (value > hi + 1e-9) return above;
    return inside;
}

/**
 * The six profile rows for a deck.
 * @param {ReturnType<import('./deckStats.js').analyzeDeckStats>} stats
 * @param {{key:string}} format
 * @returns {Array<{key:string, label:string, value:number, min:number, max:number, range:[number,number]|null,
 *   format:(v:number)=>string, tone:'good'|'warn'|'bad'|'flat', status:string, tip:string, rangeTip:string, sub?:string}>}
 */
export function deckProfile(stats, format = { key: 'commander' }) {
    if (!stats || !(stats.curve?.nonlandCount > 0)) return [];
    const key = format?.key in SPEED_GUIDE ? format.key : 'commander';
    const commander = key === 'commander';
    const counts = stats.tags?.counts ?? {};
    const rows = [];

    const avg = stats.curve.average;
    const speed = SPEED_GUIDE[key];
    rows.push({
        key: 'speed',
        label: 'Speed',
        value: avg,
        min: 1,
        max: Math.max(6, Math.ceil(avg + 0.5)),
        range: speed.range,
        format: v => v.toFixed(2),
        tone: 'flat',
        status: rangeStatus(avg, speed.range, { below: 'faster than typical', above: 'slower than typical' }),
        tip: 'Average mana value of your nonland cards. Lower is faster; a high average suits ramp decks that plan for it.',
        rangeTip: `${speed.why}${GUIDELINE}`
    });

    const keep = stats.odds?.keepable ?? 0;
    const drop4 = stats.odds?.dropsBy?.[4];
    rows.push({
        key: 'consistency',
        label: 'Consistency',
        value: keep,
        min: 0.4,
        max: 1,
        range: [0.72, 0.82],
        format: p => pct(p),
        tone: keep >= 0.72 ? 'good' : keep >= 0.62 ? 'warn' : 'bad',
        status: keep >= 0.72 ? 'keepable' : keep >= 0.62 ? 'a little low' : 'low',
        tip: 'Opening hands with two to four lands — the usual keeps.',
        rangeTip: `Well-built decks usually keep about 72–82% of their opening sevens on land count alone.${GUIDELINE}`,
        sub: Number.isFinite(drop4) ? `${pct(drop4)} make every land drop to turn 4` : ''
    });

    const colors = (stats.colors ?? []).filter(c => Number.isFinite(c.onCurve) && c.heaviest);
    if (colors.length) {
        const weakest = colors.reduce((w, c) => (c.onCurve < w.onCurve ? c : w));
        const p = weakest.onCurve;
        rows.push({
            key: 'mana',
            label: 'Mana',
            value: p,
            min: 0.5,
            max: 1,
            range: [0.9, 1],
            format: p => pct(p),
            tone: p >= 0.88 ? 'good' : p >= 0.78 ? 'warn' : 'bad',
            status: p >= 0.88 ? 'on target' : 'short',
            tip: 'The weakest colour: how often your lands can pay its most demanding card on curve, if you hit your land drops.',
            rangeTip: `Frank Karsten’s target is 90% for the cards that matter.${GUIDELINE}`,
            sub: `${weakest.heaviest.name}, turn ${Math.max(1, weakest.heaviest.mv)}`,
            card: weakest.heaviest.name,
            turn: Math.max(1, weakest.heaviest.mv),
            color: weakest.color
        });
    }

    const roleRow = (rowKey, label, value, tip, guide) => {
        const range = commander ? guide.range : null;
        const status = range ? rangeStatus(value, range) : '';
        const short = range && value < range[0];
        return {
            key: rowKey,
            label,
            value,
            min: 0,
            max: Math.max(commander ? 24 : 16, value + 2),
            range,
            format: v => String(Math.round(v)),
            tone: !range ? 'flat' : short ? (value < range[0] - 3 ? 'bad' : 'warn') : status === 'typical' ? 'good' : 'flat',
            status,
            tip: `${tip} Detected from rules text, so unusual wordings can be missed.`,
            rangeTip: range ? `${guide.why}${GUIDELINE}` : NO_GUIDE
        };
    };
    const n = tag => counts[tag] ?? 0;
    rows.push(roleRow('ramp', 'Ramp', n('ramp'), 'Mana rocks, dorks and land-fetching spells.', ROLE_GUIDE.ramp));
    rows.push({
        ...roleRow('flow', 'Card flow', n('draw') + n('tutor'), 'Card draw plus tutors.', ROLE_GUIDE.flow),
        sub: `${n('draw')} draw · ${plural(n('tutor'), 'tutor')}`
    });
    rows.push({
        ...roleRow('interaction', 'Interaction', n('removal') + n('counter') + n('wipe'), 'Targeted removal, counterspells and board wipes.', ROLE_GUIDE.interaction),
        sub: `${n('removal')} removal · ${plural(n('counter'), 'counter')} · ${plural(n('wipe'), 'wipe')}`
    });
    return rows;
}

/** Curve bucket of a card: its mana value, with 7 and up together. */
export function curveBucket(card) {
    return Math.min(7, Math.max(0, Math.floor(Number(card?.cmc) || 0)));
}

/**
 * The nonland cards in one curve bucket, grouped by primary type, most
 * copies first — what clicking a mana-curve bar lists.
 * @param {Record<string, Object>} cardsByName
 * @param {number} bucket - 0…7 (7 = 7+)
 * @returns {{total:number, groups:Array<{type:string, count:number, cards:Array<{name:string, count:number}>}>}}
 */
export function curveCards(cardsByName = {}, bucket = 0) {
    const byType = new Map();
    let total = 0;
    for (const card of deckCards(cardsByName)) {
        if (isLand(card) || curveBucket(card) !== bucket) continue;
        const type = card.category ?? card.allCategories?.[0] ?? 'other';
        const copies = Number(card.count);
        total += copies;
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push({ name: card.name, count: copies });
    }
    const order = ['creatures', 'planeswalkers', 'battles', 'artifacts', 'enchantments', 'instants', 'sorceries'];
    const rank = type => (order.includes(type) ? order.indexOf(type) : order.length);
    const groups = [...byType].map(([type, cards]) => ({
        type,
        count: cards.reduce((s, c) => s + c.count, 0),
        cards: cards.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    })).sort((a, b) => rank(a.type) - rank(b.type));
    return { total, groups };
}
