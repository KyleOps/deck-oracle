/**
 * Mulligan model — exact London-mulligan maths for the Mulligan Planner.
 *
 * A "requirement" is a group of cards (lands, ramp, a custom count) with:
 *   required — copies you need in hand by `byTurn` (turn 0 = the opening hand)
 *   max      — optional cap on copies in the hand you keep (e.g. "no more than
 *              5 lands"), enforced after cards go to the bottom
 * Groups are disjoint: a card counts toward at most one requirement.
 *
 * London mulligan (CR 103.5): every mulligan you shuffle, draw a fresh seven
 * and put one card on the bottom per mulligan taken (the first one is free in
 * multiplayer Commander). So every step sees the same seven-card distribution;
 * only the number of cards you must bottom changes. Bottomed cards sit under
 * the library and are never drawn in the turns that matter, so draws come from
 * the other `deckSize - 7` cards.
 *
 * The keep rule is the player's own: keep a hand if its chance of having
 * everything on time is at least `threshold`, lowered by `penalty` for every
 * card the hand is down. Everything here is exact (multivariate
 * hypergeometric) and pure.
 */

import { choose } from './hypergeometric.js';
import { FORMATS, cardsSeenByTurn } from './format.js';

export const HAND_SIZE = 7;
const EPS = 1e-12;

const sum = arr => arr.reduce((s, n) => s + n, 0);

/**
 * Cards drawn after the opening hand by the main phase of a turn.
 * @param {{format?:object, onPlay?:boolean}} opts
 * @returns {(turn:number) => number}
 */
export function drawSchedule({ format = FORMATS.commander, onPlay = true } = {}) {
    const hand = format.openingHand ?? HAND_SIZE;
    return turn => Math.max(0, cardsSeenByTurn(turn, { format, onPlay }) - hand);
}

/** Cards that go to the bottom after `mulligans` mulligans. */
export function bottomCount(mulligans, freeMulligan = false) {
    if (mulligans <= 0) return 0;
    return freeMulligan ? mulligans - 1 : mulligans;
}

/**
 * Multivariate hypergeometric: chance of exactly typeDrawn[i] of each group
 * (and the rest from "everything else") in `drawn` cards.
 */
export function multiTypeProb(deckSize, typeCounts, drawn, typeDrawn) {
    const takenTypes = sum(typeDrawn);
    if (takenTypes > drawn) return 0;
    const othersTotal = deckSize - sum(typeCounts);
    const othersDrawn = drawn - takenTypes;
    if (othersDrawn < 0 || othersDrawn > othersTotal) return 0;
    let numerator = choose(othersTotal, othersDrawn);
    for (let i = 0; i < typeCounts.length; i++) {
        if (typeDrawn[i] > typeCounts[i]) return 0;
        numerator *= choose(typeCounts[i], typeDrawn[i]);
    }
    const denominator = choose(deckSize, drawn);
    return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Chance of drawing every missing card before its deadline.
 *
 * Deadlines are processed in order; at each one, every group due by then must
 * be complete. Groups already complete stop mattering, so the state is just
 * "copies still missing" per open group — small enough to memoise.
 *
 * @param {Object} p
 * @param {number} p.library - unknown cards you draw from
 * @param {number[]} p.inLibrary - copies of each group among them
 * @param {number[]} p.need - copies of each group still missing (0 = met)
 * @param {number[]} p.draws - cards drawn by each group's deadline
 * @returns {number}
 */
export function drawChance({ library, inLibrary, need, draws }) {
    const open = need.map((_, i) => i).filter(i => need[i] > 0);
    if (open.length === 0) return 1;
    const due = draws.map(d => Math.min(Math.max(0, d), Math.max(0, library)));
    for (const i of open) {
        if (due[i] <= 0 || need[i] > inLibrary[i]) return 0;
    }
    const stages = [...new Set(open.map(i => due[i]))].sort((a, b) => a - b);
    const memo = new Map();

    const solve = (s, needs) => {
        if (s === stages.length) return 1;
        const key = `${s}|${needs.join(',')}`;
        const hit = memo.get(key);
        if (hit !== undefined) return hit;

        const before = s === 0 ? 0 : stages[s - 1];
        const k = stages[s] - before;
        const left = library - before;
        const active = [];
        const counts = [];
        needs.forEach((n, j) => {
            if (n > 0) {
                active.push(j);
                // Copies drawn so far = original need − still missing (exact
                // while the group is open).
                counts.push(inLibrary[open[j]] - (need[open[j]] - n));
            }
        });

        let total = 0;
        const x = new Array(active.length).fill(0);
        const next = needs.slice();
        const rec = (a, slots) => {
            if (a === active.length) {
                const p = multiTypeProb(left, counts, k, x);
                if (p === 0) return;
                active.forEach((j, t) => { next[j] = Math.max(0, needs[j] - x[t]); });
                for (let j = 0; j < open.length; j++) {
                    if (due[open[j]] === stages[s] && next[j] > 0) return;
                }
                total += p * solve(s + 1, next.slice());
                return;
            }
            const max = Math.min(counts[a], slots);
            for (let c = 0; c <= max; c++) {
                x[a] = c;
                rec(a + 1, slots - c);
            }
            x[a] = 0;
        };
        rec(0, k);
        memo.set(key, total);
        return total;
    };

    return solve(0, open.map(i => need[i]));
}

/**
 * Every distinct opening hand (by how many of each group it holds) with its
 * probability.
 * @returns {Array<{counts:number[], others:number, p:number}>}
 */
export function openingHands(deckSize, counts, handSize = HAND_SIZE) {
    const othersTotal = deckSize - sum(counts);
    const hands = [];
    const c = new Array(counts.length).fill(0);
    const rec = (i, left) => {
        if (i === counts.length) {
            if (left > othersTotal) return;
            const p = multiTypeProb(deckSize, counts, handSize, c);
            if (p > 0) hands.push({ counts: c.slice(), others: left, p });
            return;
        }
        const max = Math.min(counts[i], left);
        for (let k = 0; k <= max; k++) {
            c[i] = k;
            rec(i + 1, left - k);
        }
        c[i] = 0;
    };
    rec(0, handSize);
    return hands;
}

/**
 * Normalise requirement rows into the numbers the maths needs.
 * @param {Array<{count:number, required:number, byTurn:number, max?:number|null}>} types
 */
export function cleanTypes(types = []) {
    return types.map(t => {
        const count = Math.max(0, Math.floor(Number(t.count) || 0));
        const required = Math.max(0, Math.floor(Number(t.required) || 0));
        const byTurn = Math.max(0, Math.floor(Number(t.byTurn) || 0));
        const rawMax = t.max === '' || t.max === null || t.max === undefined ? null : Number(t.max);
        const max = Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : null;
        return { count, required, byTurn, max };
    });
}

/**
 * Builds a memoised evaluator for "if I keep this seven with `bottom` cards
 * going under, what is the chance it has everything on time?"
 *
 * Bottoming is optimal: cards over a group's cap go first, then cards that
 * help nothing, then spare copies above a requirement; only then does it cut
 * into needed cards (choosing the cut that hurts least).
 */
function keepEvaluator({ deckSize, types, draws, handSize = HAND_SIZE }) {
    const library = deckSize - handSize;
    const shared = new Map();

    const chanceFor = (need, inLibrary) => {
        const key = need.map((n, i) => (n > 0 ? `${n}:${inLibrary[i]}` : '-')).join('|');
        let v = shared.get(key);
        if (v === undefined) {
            v = drawChance({ library, inLibrary, need, draws });
            shared.set(key, v);
        }
        return v;
    };

    return (hand, bottom) => {
        const { counts, others } = hand;
        const excess = types.map((t, i) => (t.max === null ? 0 : Math.max(0, counts[i] - t.max)));
        const forced = sum(excess);
        if (forced > bottom) return { legal: false, success: 0, cut: null };
        const after = counts.map((c, i) => c - excess[i]);
        const spare = others + sum(after.map((a, i) => Math.max(0, a - types[i].required)));
        const inLibrary = types.map((t, i) => t.count - counts[i]);
        const free = bottom - forced;

        if (free <= spare) {
            const need = types.map((t, i) => Math.max(0, t.required - after[i]));
            return { legal: true, success: chanceFor(need, inLibrary), cut: null };
        }

        // Not enough spare cards: some needed cards must go to the bottom.
        const deficit = free - spare;
        const base = after.map((a, i) => Math.min(a, types[i].required));
        let best = { legal: true, success: 0, cut: null };
        const y = new Array(types.length).fill(0);
        const rec = (i, left) => {
            if (i === types.length) {
                if (left !== 0) return;
                const need = types.map((t, j) => t.required - (base[j] - y[j]));
                const s = chanceFor(need, inLibrary);
                if (best.cut === null || s > best.success) best = { legal: true, success: s, cut: y.slice() };
                return;
            }
            for (let c = 0; c <= Math.min(base[i], left); c++) {
                y[i] = c;
                rec(i + 1, left - c);
            }
            y[i] = 0;
        };
        rec(0, deficit);
        return best;
    };
}

/**
 * Chance of meeting every requirement on time, for one hand you keep.
 * Kept for older callers: assumes the seven you see is the hand you keep.
 *
 * @param {number} deckSize
 * @param {Array<{count:number, required:number, byTurn:number}>} types
 * @param {number[]} handCounts
 * @param {{drawsBy?:(turn:number)=>number, handSize?:number}} [opts]
 *   drawsBy defaults to one draw per turn from turn 1 (Commander).
 */
export function handSuccess(deckSize, types, handCounts, { drawsBy = t => t, handSize = HAND_SIZE } = {}) {
    const clean = cleanTypes(types);
    return drawChance({
        library: deckSize - handSize,
        inLibrary: clean.map((t, i) => t.count - (handCounts[i] ?? 0)),
        need: clean.map((t, i) => Math.max(0, t.required - (handCounts[i] ?? 0))),
        draws: clean.map(t => drawsBy(t.byTurn))
    });
}

/**
 * The keep bar after `bottom` cards: threshold lowered by `penalty` per card.
 */
export function keepBar(threshold, penalty, bottom) {
    return threshold * Math.pow(1 - penalty, bottom);
}

/**
 * Evaluate the whole mulligan plan for a deck and keep rule.
 *
 * @param {Object} p
 * @param {number} p.deckSize - library size
 * @param {Array} p.types - requirement rows
 * @param {number} p.threshold - 0..1, the bar for keeping a seven
 * @param {number} p.penalty - 0..1, how much the bar drops per card down
 * @param {boolean} p.freeMulligan - first mulligan bottoms nothing
 * @param {(turn:number)=>number} [p.drawsBy] - see drawSchedule()
 * @returns {Object} plan
 */
export function mulliganPlan({ deckSize, types, threshold = 0.75, penalty = 0.2, freeMulligan = false, drawsBy = t => t }) {
    const clean = cleanTypes(types);
    const typed = sum(clean.map(t => t.count));
    const size = Math.max(Math.floor(Number(deckSize) || 0), typed, HAND_SIZE + 1);
    const draws = clean.map(t => drawsBy(t.byTurn));
    const hands = openingHands(size, clean.map(t => t.count));
    const evaluate = keepEvaluator({ deckSize: size, types: clean, draws });

    const lastStep = freeMulligan ? HAND_SIZE : HAND_SIZE - 1; // final keep is one card
    const steps = [];
    let reach = 1;
    for (let m = 0; m <= lastStep; m++) {
        const bottom = bottomCount(m, freeMulligan);
        const bar = keepBar(threshold, penalty, bottom);
        const forced = m === lastStep;
        let keep = 0;
        let keepSuccess = 0;
        const decisions = hands.map(h => {
            const e = evaluate(h, bottom);
            const kept = forced || (e.legal && e.success + EPS >= bar);
            if (kept) {
                keep += h.p;
                keepSuccess += h.p * e.success;
            }
            return { keep: kept, success: e.success, legal: e.legal, cut: e.cut };
        });
        steps.push({
            step: m, bottom, handSize: HAND_SIZE - bottom, bar, reach, forced,
            keepChance: keep,
            successIfKept: keep > 0 ? keepSuccess / keep : 0,
            decisions
        });
        reach *= (1 - keep);
        if (reach < 1e-9) break;
    }

    let success = 0;
    let value = 0;
    let avgMulligans = 0;
    let avgHandSize = 0;
    let found = 0;
    steps.forEach(s => {
        const here = s.reach * s.keepChance;
        found += here;
        s.keepHere = here;
        s.foundBy = found;
        success += here * s.successIfKept;
        value += here * s.successIfKept * Math.pow(1 - penalty, s.bottom);
        avgMulligans += here * s.step;
        avgHandSize += here * s.handSize;
    });

    // If you kept every seven: hands over a cap count as failures.
    const noMulligan = hands.reduce((s, h, i) => s + h.p * (steps[0].decisions[i].legal ? steps[0].decisions[i].success : 0), 0);

    // Decision quality for the opening seven, exact.
    const opener = steps[0];
    const quality = { keepGood: 0, keepBad: 0, mullGood: 0, mullMissed: 0 };
    hands.forEach((h, i) => {
        const d = opener.decisions[i];
        const s = d.legal ? d.success : 0;
        if (d.keep) {
            quality.keepGood += h.p * s;
            quality.keepBad += h.p * (1 - s);
        } else {
            quality.mullMissed += h.p * s;
            quality.mullGood += h.p * (1 - s);
        }
    });

    // Each requirement on its own, no mulligans — finds the bottleneck.
    const alone = clean.map((t, i) => {
        const single = [t];
        const counts = [t.count];
        const ev = keepEvaluator({ deckSize: size, types: single, draws: [draws[i]] });
        return openingHands(size, counts).reduce((s, h) => {
            const e = ev(h, 0);
            return s + h.p * (e.legal ? e.success : 0);
        }, 0);
    });

    return {
        deckSize: size,
        oversize: typed > (Math.floor(Number(deckSize) || 0)),
        types: clean,
        hands,
        steps,
        success,
        value,
        avgMulligans,
        avgHandSize,
        keepSeven: opener.keepChance,
        noMulligan,
        quality,
        alone,
        threshold,
        penalty,
        freeMulligan
    };
}

/**
 * Change in the plan's success from one more card of each group, swapped in
 * for a card that counts toward nothing (deck size unchanged).
 * @returns {Array<number|null>} percentage-point changes (null when the deck has no spare card to swap)
 */
export function marginalGains(params) {
    const base = mulliganPlan(params);
    const spare = base.deckSize - sum(base.types.map(t => t.count));
    return (params.types ?? []).map((t, i) => {
        if (spare <= 0) return null;
        const types = params.types.map((u, j) => (j === i ? { ...u, count: (Number(u.count) || 0) + 1 } : u));
        return mulliganPlan({ ...params, types }).success - base.success;
    });
}

/**
 * Exactly how the hand you keep shapes up: after bottoming, chance it meets
 * every requirement. Used by the sampler to pick which real cards to bottom.
 *
 * @param {number[]} counts - group counts in the seven you saw
 * @param {number} others - cards that count toward nothing
 * @param {number} bottom - cards to put on the bottom
 * @param {Array} types - cleaned requirement rows
 * @returns {{legal:boolean, bottomByType:number[], bottomOthers:number}}
 */
export function chooseBottom(counts, others, bottom, types, cut = null) {
    const clean = cleanTypes(types);
    const excess = clean.map((t, i) => (t.max === null ? 0 : Math.max(0, counts[i] - t.max)));
    const forced = sum(excess);
    if (forced > bottom) return { legal: false, bottomByType: counts.slice(), bottomOthers: 0 };
    let left = bottom - forced;
    const byType = excess.slice();
    const fromOthers = Math.min(others, left);
    left -= fromOthers;
    // Spare copies above each requirement next.
    clean.forEach((t, i) => {
        if (left <= 0) return;
        const spareHere = Math.max(0, counts[i] - byType[i] - t.required);
        const take = Math.min(spareHere, left);
        byType[i] += take;
        left -= take;
    });
    // Then needed cards, in the order the evaluator found least harmful.
    if (left > 0) {
        clean.forEach((t, i) => {
            const want = cut ? Math.min(cut[i] ?? 0, left) : 0;
            byType[i] += want;
            left -= want;
        });
        clean.forEach((t, i) => {
            if (left <= 0) return;
            const take = Math.min(counts[i] - byType[i], left);
            byType[i] += take;
            left -= take;
        });
    }
    return { legal: true, bottomByType: byType, bottomOthers: fromOthers };
}

/**
 * Group a step's keep/mulligan calls into plain rules, for one or two
 * requirement groups ("3–5 lands: keep", "2 lands: keep with 1+ ramp").
 *
 * @param {Object} plan - from mulliganPlan()
 * @param {number} stepIndex
 * @param {string[]} names - group names (lower-case reads best)
 * @returns {Array<{label:string, call:'keep'|'mull'|'some', detail:string}>|null} null for 3+ groups
 */
export function keepRules(plan, stepIndex, names = []) {
    const step = plan?.steps?.[stepIndex];
    if (!step || plan.types.length === 0 || plan.types.length > 2) return null;
    const nameA = names[0] ?? 'cards';
    const nameB = names[1] ?? 'cards';
    const byA = new Map();
    plan.hands.forEach((h, i) => {
        const a = h.counts[0];
        if (!byA.has(a)) byA.set(a, []);
        byA.get(a).push({ b: h.counts[1] ?? 0, keep: step.decisions[i].keep, p: h.p });
    });

    const describe = cells => {
        const kept = cells.filter(c => c.keep).map(c => c.b);
        if (kept.length === cells.length) return { call: 'keep', detail: 'keep' };
        if (kept.length === 0) return { call: 'mull', detail: 'mulligan' };
        const sorted = cells.map(c => c.b).sort((x, y) => x - y);
        const min = Math.min(...kept);
        const max = Math.max(...kept);
        const contiguous = sorted.filter(b => b >= min && b <= max).every(b => kept.includes(b));
        if (contiguous && max === sorted[sorted.length - 1]) return { call: 'some', detail: `keep with ${min}+ ${nameB}` };
        if (contiguous && min === sorted[0]) return { call: 'some', detail: `keep with at most ${max} ${nameB}` };
        if (contiguous) return { call: 'some', detail: `keep with ${min}–${max} ${nameB}` };
        return { call: 'some', detail: `keep with ${kept.join(', ')} ${nameB}` };
    };

    const rows = [...byA.keys()].sort((x, y) => x - y).map(a => ({ a, ...describe(plan.types.length === 1 ? byA.get(a).slice(0, 1) : byA.get(a)) }));
    // Merge neighbours with the same call into ranges.
    const groups = [];
    rows.forEach(r => {
        const last = groups[groups.length - 1];
        if (last && last.detail === r.detail && last.to === r.a - 1) last.to = r.a;
        else groups.push({ from: r.a, to: r.a, call: r.call, detail: r.detail });
    });
    // Join the mulligan groups (usually "too few" and "too many") into one line.
    const range = g => (g.from === g.to ? `${g.from}` : `${g.from}–${g.to}`);
    const out = [];
    const mulls = groups.filter(g => g.call === 'mull');
    groups.filter(g => g.call !== 'mull').forEach(g => out.push({ label: `${range(g)} ${nameA}`, call: g.call, detail: g.detail, from: g.from }));
    if (mulls.length) out.push({ label: `${mulls.map(range).join(' or ')} ${nameA}`, call: 'mull', detail: 'mulligan', from: Infinity });
    return out.sort((x, y) => (x.call === 'mull') - (y.call === 'mull') || x.from - y.from)
        .map(({ label, call, detail }) => ({ label, call, detail }));
}
