import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    COLOR_BIT,
    DEFAULT_RULE,
    MIN_HAND,
    maskOf,
    colorsOfMask,
    normalizeRule,
    toLabCard,
    buildLibrary,
    buildPlaceholderLibrary,
    libraryKey,
    assignPips,
    castableWith,
    payFor,
    chooseLandToPlay,
    analyzeHand,
    numberWord,
    meetsRule,
    chooseBottom,
    judgeHand,
    landDistribution,
    landsInRangeChance,
    mulberry32,
    simulateMulligans,
    handOdds,
    gameOdds,
    summarize,
    MAX_TURNS,
    shuffled,
    createGame,
    canDeal,
    dealHand,
    newHand,
    owedCards,
    canMulligan,
    takeMulligan,
    resetHand,
    keepHand,
    toggleBottom,
    suggestBottom,
    confirmBottom,
    untappedLands,
    castableNow,
    canAdvance,
    nextTurn,
    castCard
} from '../../js/utils/handLab.js';
import { landOdds } from '../../js/utils/deckStats.js';
import { FORMATS } from '../../js/utils/format.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const RECORDS = {
    Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, mana_cost: '', category: 'lands', produced_mana: ['G'] },
    Island: { name: 'Island', type_line: 'Basic Land — Island', cmc: 0, mana_cost: '', category: 'lands', produced_mana: ['U'] },
    'Breeding Pool': { name: 'Breeding Pool', type_line: 'Land — Forest Island', cmc: 0, mana_cost: '', category: 'lands' },
    Wastes: { name: 'Wastes', type_line: 'Basic Land', cmc: 0, mana_cost: '', category: 'lands', produced_mana: ['C'] },
    'Llanowar Elves': { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, mana_cost: '{G}', category: 'creatures', oracle_text: '{T}: Add {G}.' },
    'Rampant Growth': { name: 'Rampant Growth', type_line: 'Sorcery', cmc: 2, mana_cost: '{1}{G}', category: 'sorceries', oracle_text: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.' },
    Counterspell: { name: 'Counterspell', type_line: 'Instant', cmc: 2, mana_cost: '{U}{U}', category: 'instants', oracle_text: 'Counter target spell.' },
    'Kitchen Finks': { name: 'Kitchen Finks', type_line: 'Creature — Ouphe', cmc: 3, mana_cost: '{1}{G/W}{G/W}', category: 'creatures' },
    'Mulldrifter': { name: 'Mulldrifter', type_line: 'Creature — Elemental', cmc: 5, mana_cost: '{4}{U}', category: 'creatures', oracle_text: 'When this creature enters, draw two cards.' },
    'Craterhoof Behemoth': { name: 'Craterhoof Behemoth', type_line: 'Creature — Beast', cmc: 8, mana_cost: '{5}{G}{G}{G}', category: 'creatures' },
    'Simic Signet': { name: 'Simic Signet', type_line: 'Artifact', cmc: 2, mana_cost: '{2}', category: 'artifacts', oracle_text: '{1}, {T}: Add {G}{U}.' },
    'Cultivate': { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, mana_cost: '{2}{G}', category: 'sorceries', oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.' }
};

let nextUid = 1000;
/** Lab cards by name, each a fresh copy with a unique uid. */
function cards(...names) {
    return names.map(n => toLabCard(RECORDS[n], nextUid++, ['G', 'U']));
}

function deck(spec) {
    const out = {};
    for (const [name, count] of Object.entries(spec)) out[name] = { ...RECORDS[name], count };
    return out;
}

const names = list => list.map(c => c.name);

// ── Rule ────────────────────────────────────────────────────────────────────

describe('normalizeRule', () => {
    it('defaults to two to four lands with no play requirement', () => {
        assert.deepStrictEqual(normalizeRule(), { minLands: 2, maxLands: 4, playBy: 0 });
        assert.deepStrictEqual(normalizeRule(DEFAULT_RULE), { ...DEFAULT_RULE });
    });

    it('clamps to 0–7 and raises max when min crosses it', () => {
        assert.deepStrictEqual(normalizeRule({ minLands: -3, maxLands: 12, playBy: 2 }), { minLands: 0, maxLands: 7, playBy: 2 });
        assert.deepStrictEqual(normalizeRule({ minLands: 5, maxLands: 3, playBy: 3 }), { minLands: 5, maxLands: 5, playBy: 3 });
    });

    it('rejects unknown play turns and junk', () => {
        assert.strictEqual(normalizeRule({ playBy: 4 }).playBy, 0);
        assert.strictEqual(normalizeRule({ minLands: 'abc' }).minLands, 2);
        assert.deepStrictEqual(normalizeRule(null), { minLands: 2, maxLands: 4, playBy: 0 });
    });
});

// ── Library ─────────────────────────────────────────────────────────────────

describe('colour masks', () => {
    it('round-trips WUBRG', () => {
        assert.strictEqual(maskOf(['G', 'U']), COLOR_BIT.G | COLOR_BIT.U);
        assert.deepStrictEqual(colorsOfMask(maskOf(['G', 'W', 'U'])), ['W', 'U', 'G']);
        assert.deepStrictEqual(colorsOfMask(0), []);
    });
});

describe('toLabCard', () => {
    it('reads lands, costs, pips and roles', () => {
        const [pool, elves, finks, drifter] = cards('Breeding Pool', 'Llanowar Elves', 'Kitchen Finks', 'Mulldrifter');
        assert.strictEqual(pool.land, true);
        assert.deepStrictEqual(colorsOfMask(pool.mask), ['U', 'G']);
        assert.strictEqual(elves.mv, 1);
        assert.strictEqual(elves.ramp, true);
        assert.strictEqual(elves.permanent, true);
        // Hybrid pips are masks of both halves
        assert.deepStrictEqual(finks.pips, [COLOR_BIT.W | COLOR_BIT.G, COLOR_BIT.W | COLOR_BIT.G]);
        assert.strictEqual(drifter.draw, true);
    });

    it('treats instants and sorceries as non-permanents', () => {
        const [counter] = cards('Counterspell');
        assert.strictEqual(counter.permanent, false);
        assert.strictEqual(counter.type, 'instants');
    });
});

describe('buildLibrary', () => {
    it('expands one lab card per copy with unique ids', () => {
        const lib = buildLibrary(deck({ Forest: 3, 'Llanowar Elves': 2 }));
        assert.strictEqual(lib.cards.length, 5);
        assert.strictEqual(new Set(lib.cards.map(c => c.uid)).size, 5);
        assert.strictEqual(lib.cards.filter(c => c.land).length, 3);
        assert.strictEqual(lib.hasCosts, true);
        assert.strictEqual(lib.placeholder, false);
    });

    it('removes one copy of the commander — it starts in the command zone', () => {
        const lib = buildLibrary(deck({ Forest: 3, 'Craterhoof Behemoth': 1 }), { commanderName: 'craterhoof behemoth' });
        assert.strictEqual(lib.cards.length, 3);
        assert.strictEqual(lib.removedCommander, true);
        const kept = buildLibrary(deck({ Forest: 3 }), { commanderName: 'Someone Else' });
        assert.strictEqual(kept.cards.length, 3);
        assert.strictEqual(kept.removedCommander, false);
    });

    it('skips empty rows', () => {
        const lib = buildLibrary({ a: { name: 'Forest', count: 0 }, b: null, c: { count: 2 } });
        assert.strictEqual(lib.cards.length, 0);
    });
});

describe('buildPlaceholderLibrary', () => {
    it('builds type-labelled cards from bare counts', () => {
        const lib = buildPlaceholderLibrary({ lands: 24, creatures: 20, instants: 16 });
        assert.strictEqual(lib.cards.length, 60);
        assert.strictEqual(lib.cards.filter(c => c.land).length, 24);
        assert.strictEqual(lib.cards.find(c => !c.land).name, 'Creature');
        assert.ok(lib.cards.every(c => c.placeholder));
        assert.strictEqual(lib.hasCosts, false);
        assert.strictEqual(lib.cards.find(c => c.type === 'instants').permanent, false);
    });

    it('ignores junk counts', () => {
        assert.strictEqual(buildPlaceholderLibrary({ lands: -4, creatures: 'x' }).cards.length, 0);
    });
});

describe('libraryKey', () => {
    it('changes with the list and is stable for the same list', () => {
        const a = buildLibrary(deck({ Forest: 3, 'Llanowar Elves': 2 })).cards;
        const b = buildLibrary(deck({ Forest: 3, 'Llanowar Elves': 2 })).cards;
        const c = buildLibrary(deck({ Forest: 2, 'Llanowar Elves': 3 })).cards;
        assert.strictEqual(libraryKey(a), libraryKey(b));
        assert.notStrictEqual(libraryKey(a), libraryKey(c));
    });
});

// ── Mana ────────────────────────────────────────────────────────────────────

describe('assignPips / castableWith', () => {
    const G = COLOR_BIT.G;
    const U = COLOR_BIT.U;

    it('needs a distinct land per pip', () => {
        assert.deepStrictEqual(assignPips([U, U], [U, G]), null);
        assert.deepStrictEqual(assignPips([U, U], [U, G, U]), [0, 2]);
        assert.deepStrictEqual(assignPips([], []), []);
    });

    it('uses a dual for whichever colour is short', () => {
        // G then U: the dual must take U, the Forest takes G
        assert.ok(assignPips([G, U], [G | U, G]));
        assert.strictEqual(assignPips([G, U], [G, G]), null);
    });

    it('checks mana value against available mana', () => {
        const [counter, hoof] = cards('Counterspell', 'Craterhoof Behemoth');
        assert.strictEqual(castableWith(counter, [U, U], 2), true);
        assert.strictEqual(castableWith(counter, [U, U], 1), false);
        assert.strictEqual(castableWith(counter, [U, G], 2), false);
        assert.strictEqual(castableWith(hoof, [G, G, G], 3), false);
    });

    it('counts X as at least 1 — an X spell at X = 0 is not a play', () => {
        const vow = toLabCard({ name: "Kamahl's Druidic Vow", type_line: 'Legendary Sorcery', cmc: 2, mana_cost: '{X}{G}{G}' }, 1, ['G']);
        assert.strictEqual(vow.mv, 2);
        assert.strictEqual(vow.playMv, 3);
        assert.strictEqual(castableWith(vow, [G, G], 2), false);
        assert.strictEqual(castableWith(vow, [G, G, U], 3), true);
        const [forest1, forest2, island] = cards('Forest', 'Forest', 'Island');
        assert.strictEqual(payFor(vow, [forest1, forest2]), null);
        assert.strictEqual(payFor(vow, [forest1, forest2, island]).length, 3);
    });

    it('never casts lands or placeholder cards', () => {
        const [forest] = cards('Forest');
        const [placeholder] = buildPlaceholderLibrary({ creatures: 1 }).cards;
        assert.strictEqual(castableWith(forest, [G], 1), false);
        assert.strictEqual(castableWith(placeholder, [G, G, G], 3), false);
    });
});

describe('payFor', () => {
    it('taps the coloured source for pips and the least flexible land for generic', () => {
        const [rampant, forest, pool, wastes] = cards('Rampant Growth', 'Forest', 'Breeding Pool', 'Wastes');
        const tapped = payFor(rampant, [pool, forest, wastes]);
        assert.strictEqual(tapped.length, 2);
        // Forest pays {G}; Wastes (no colours) pays {1}; the dual stays open
        assert.deepStrictEqual(names(tapped).sort(), ['Forest', 'Wastes']);
    });

    it('returns null when the spell cannot be paid', () => {
        const [counter, forest, island] = cards('Counterspell', 'Forest', 'Island');
        assert.strictEqual(payFor(counter, [forest, island]), null);
        assert.strictEqual(payFor(counter, [island]), null);
    });
});

describe('chooseLandToPlay', () => {
    it('plays the land that adds a colour the hand needs', () => {
        const hand = cards('Forest', 'Island', 'Counterspell');
        const inPlay = cards('Forest');
        assert.strictEqual(chooseLandToPlay(hand, inPlay).name, 'Island');
    });

    it('prefers a dual when nothing is in play yet', () => {
        const hand = cards('Forest', 'Breeding Pool', 'Mulldrifter');
        assert.strictEqual(chooseLandToPlay(hand, []).name, 'Breeding Pool');
    });

    it('returns null with no land in hand', () => {
        assert.strictEqual(chooseLandToPlay(cards('Mulldrifter'), []), null);
    });
});

// ── Reading a hand ──────────────────────────────────────────────────────────

describe('analyzeHand', () => {
    it('counts lands, colours, average mana value and early plays', () => {
        const hand = cards('Forest', 'Island', 'Forest', 'Llanowar Elves', 'Counterspell', 'Kitchen Finks', 'Craterhoof Behemoth');
        const a = analyzeHand(hand);
        assert.strictEqual(a.landCount, 3);
        assert.deepStrictEqual(a.colors, ['U', 'G']);
        assert.strictEqual(a.averageMv, (1 + 2 + 3 + 8) / 4);
        assert.deepStrictEqual(names(a.castableBy[2]), ['Llanowar Elves']); // Counterspell needs UU
        // Two Forests pay Finks' hybrid pips, the Island its generic; still only one blue for Counterspell
        assert.deepStrictEqual(names(a.castableBy[3]), ['Llanowar Elves', 'Kitchen Finks']);
        assert.deepStrictEqual(names(a.ramp), ['Llanowar Elves']);
    });

    it('lets hybrid pips use either colour', () => {
        const a = analyzeHand(cards('Forest', 'Forest', 'Island', 'Kitchen Finks'));
        assert.deepStrictEqual(names(a.castableBy[3]), ['Kitchen Finks']);
    });

    it('flags colourless-only mana and placeholder hands', () => {
        assert.strictEqual(analyzeHand(cards('Wastes', 'Mulldrifter')).colorlessOnly, true);
        const placeholder = analyzeHand(buildPlaceholderLibrary({ lands: 3, creatures: 4 }).cards);
        assert.strictEqual(placeholder.hasCosts, false);
        assert.strictEqual(placeholder.averageMv, null);
        assert.deepStrictEqual(placeholder.castableBy[3], []);
    });
});

describe('numberWord', () => {
    it('spells small counts', () => {
        assert.strictEqual(numberWord(2), 'two');
        assert.strictEqual(numberWord(0), 'no');
        assert.strictEqual(numberWord(14), '14');
    });
});

describe('judgeHand', () => {
    it('keeps a good hand and says why', () => {
        const hand = cards('Forest', 'Island', 'Forest', 'Llanowar Elves', 'Rampant Growth', 'Mulldrifter', 'Craterhoof Behemoth');
        const v = judgeHand(hand, { minLands: 2, maxLands: 4, playBy: 3 });
        assert.strictEqual(v.keep, true);
        assert.strictEqual(v.headline, 'Keep — 3 lands, 2 ramp pieces, two plays by turn 3');
        assert.deepStrictEqual(v.reasons, []);
    });

    it('uses "a ramp piece" and "one play" in the singular', () => {
        const hand = cards('Forest', 'Island', 'Forest', 'Llanowar Elves', 'Mulldrifter', 'Craterhoof Behemoth', 'Mulldrifter');
        assert.strictEqual(judgeHand(hand, DEFAULT_RULE).headline, 'Keep — 3 lands, a ramp piece, one play by turn 3');
    });

    it('mulligans a one-lander', () => {
        const hand = cards('Forest', 'Llanowar Elves', 'Rampant Growth', 'Mulldrifter', 'Craterhoof Behemoth', 'Counterspell', 'Kitchen Finks');
        const v = judgeHand(hand, DEFAULT_RULE);
        assert.strictEqual(v.keep, false);
        assert.strictEqual(v.headline, 'Mulligan — 1 land');
        assert.match(v.reasons[0], /your rule wants 2–4/);
    });

    it('mulligans "no lands" and too many lands', () => {
        assert.strictEqual(judgeHand(cards('Mulldrifter', 'Counterspell'), DEFAULT_RULE).headline, 'Mulligan — no lands');
        const flood = cards('Forest', 'Forest', 'Forest', 'Island', 'Island', 'Island', 'Mulldrifter');
        assert.strictEqual(judgeHand(flood, DEFAULT_RULE).headline, 'Mulligan — 6 lands');
    });

    it('applies the early-play requirement only when it is on', () => {
        const slow = cards('Forest', 'Island', 'Forest', 'Mulldrifter', 'Craterhoof Behemoth', 'Mulldrifter', 'Craterhoof Behemoth');
        assert.strictEqual(judgeHand(slow, { minLands: 2, maxLands: 4, playBy: 0 }).keep, true);
        const strict = judgeHand(slow, { minLands: 2, maxLands: 4, playBy: 3 });
        assert.strictEqual(strict.keep, false);
        assert.strictEqual(strict.headline, 'Mulligan — nothing to cast by turn 3');
    });

    it('cannot apply the play requirement to placeholder cards', () => {
        const hand = buildPlaceholderLibrary({ lands: 3, creatures: 4 }).cards;
        const v = judgeHand(hand, { minLands: 2, maxLands: 4, playBy: 2 });
        assert.strictEqual(v.keep, true);
        assert.strictEqual(v.headline, 'Keep — 3 lands');
    });

    it('judges the hand left after the London-mulligan bottom', () => {
        const hand = cards('Forest', 'Forest', 'Forest', 'Island', 'Island', 'Mulldrifter', 'Llanowar Elves');
        const v = judgeHand(hand, DEFAULT_RULE, { bottom: 1 });
        assert.strictEqual(v.kept.length, 6);
        assert.strictEqual(v.bottomed.length, 1);
        assert.strictEqual(v.bottomed[0].land, true);
        assert.strictEqual(v.keep, true);
    });
});

describe('chooseBottom', () => {
    it('returns the hand unchanged when nothing is owed', () => {
        const hand = cards('Forest', 'Mulldrifter');
        const r = chooseBottom(hand, 0);
        assert.deepStrictEqual(r.keep, hand);
        assert.deepStrictEqual(r.bottom, []);
    });

    it('bottoms extra lands first, keeping colour coverage', () => {
        const hand = cards('Forest', 'Forest', 'Forest', 'Island', 'Breeding Pool', 'Counterspell', 'Mulldrifter');
        const r = chooseBottom(hand, 2, DEFAULT_RULE);
        assert.deepStrictEqual(names(r.bottom), ['Forest', 'Forest']);
        assert.ok(names(r.keep).includes('Island'));
    });

    it('bottoms the most expensive spells, keeping ramp', () => {
        const hand = cards('Forest', 'Island', 'Llanowar Elves', 'Rampant Growth', 'Craterhoof Behemoth', 'Mulldrifter', 'Counterspell');
        const r = chooseBottom(hand, 2, DEFAULT_RULE);
        assert.deepStrictEqual(names(r.bottom).sort(), ['Craterhoof Behemoth', 'Mulldrifter']);
        assert.strictEqual(r.keep.length, 5);
    });

    it('prefers to bottom spells its lands cannot cast', () => {
        // Two Forests can't make UU, so Counterspell goes before the 3-drop
        const hand = cards('Forest', 'Forest', 'Counterspell', 'Kitchen Finks', 'Llanowar Elves', 'Rampant Growth', 'Cultivate');
        const r = chooseBottom(hand, 1, DEFAULT_RULE);
        assert.deepStrictEqual(names(r.bottom), ['Counterspell']);
    });

    it('keeps the hand order and never bottoms more than asked', () => {
        const hand = cards('Mulldrifter', 'Forest', 'Island', 'Craterhoof Behemoth', 'Forest', 'Counterspell', 'Llanowar Elves');
        const r = chooseBottom(hand, 3, DEFAULT_RULE);
        assert.strictEqual(r.bottom.length, 3);
        assert.deepStrictEqual(r.keep, hand.filter(c => !r.bottom.includes(c)));
    });

    it('bottoms lands when there are no spells left to give up', () => {
        const hand = cards('Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Mulldrifter');
        const r = chooseBottom(hand, 3, DEFAULT_RULE);
        assert.strictEqual(r.bottom.filter(c => c.land).length, 3);
    });
});

describe('meetsRule', () => {
    it('agrees with judgeHand', () => {
        const rng = mulberry32(11);
        const lib = buildLibrary(deck({ Forest: 10, Island: 7, 'Breeding Pool': 2, 'Llanowar Elves': 4, Counterspell: 4, 'Kitchen Finks': 4, Mulldrifter: 4, 'Craterhoof Behemoth': 4, 'Rampant Growth': 4, Cultivate: 4 })).cards;
        for (const rule of [DEFAULT_RULE, { minLands: 2, maxLands: 4, playBy: 2 }, { minLands: 3, maxLands: 5, playBy: 3 }]) {
            for (let i = 0; i < 300; i++) {
                const shuffled = lib.slice().sort(() => rng() - 0.5).slice(0, 7);
                assert.strictEqual(meetsRule(shuffled, normalizeRule(rule)), judgeHand(shuffled, rule).keep);
            }
        }
    });
});

// ── Exact odds ──────────────────────────────────────────────────────────────

describe('landDistribution', () => {
    it('sums to one and matches the Overview numbers', () => {
        const dist = landDistribution(99, 37);
        assert.strictEqual(dist.length, 8);
        assert.ok(Math.abs(dist.reduce((s, p) => s + p, 0) - 1) < 1e-9);
        const overview = landOdds({ deckSize: 99, lands: 37, format: FORMATS.commander });
        assert.ok(Math.abs(landsInRangeChance(99, 37, DEFAULT_RULE) - overview.keepable) < 1e-12);
    });

    it('returns zeros for a deck smaller than a hand', () => {
        assert.deepStrictEqual(landDistribution(5, 2), [0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('respects the rule range', () => {
        const dist = landDistribution(60, 24);
        assert.ok(Math.abs(landsInRangeChance(60, 24, { minLands: 3, maxLands: 3 }) - dist[3]) < 1e-12);
    });
});

// ── Simulation ──────────────────────────────────────────────────────────────

describe('simulateMulligans', () => {
    const sixty = buildLibrary(deck({ Forest: 12, Island: 10, 'Breeding Pool': 2, 'Llanowar Elves': 4, Counterspell: 4, 'Kitchen Finks': 4, Mulldrifter: 4, 'Craterhoof Behemoth': 4, 'Rampant Growth': 4, Cultivate: 4, 'Simic Signet': 8 })).cards;

    it('is reproducible with a seeded generator and accounts for every game', () => {
        const a = simulateMulligans(sixty, DEFAULT_RULE, { games: 2000, rng: mulberry32(1) });
        const b = simulateMulligans(sixty, DEFAULT_RULE, { games: 2000, rng: mulberry32(1) });
        assert.deepStrictEqual(a, b);
        const total = Object.values(a.keptAt).reduce((s, n) => s + n, 0);
        assert.strictEqual(total, 2000);
        assert.ok(Math.abs(a.atLeastSix + a.belowSix - 1) < 1e-12);
    });

    it('matches the exact keepable chance for a lands-only rule', () => {
        const sim = simulateMulligans(sixty, DEFAULT_RULE, { games: 20000, rng: mulberry32(2) });
        const exact = landsInRangeChance(sixty.length, sixty.filter(c => c.land).length, DEFAULT_RULE);
        assert.ok(Math.abs(sim.firstKeepable - exact) < 0.015, `${sim.firstKeepable} vs ${exact}`);
        assert.strictEqual(sim.keptAt[7] / sim.games, sim.firstKeepable);
    });

    it('a free first mulligan keeps more sevens', () => {
        const paid = simulateMulligans(sixty, DEFAULT_RULE, { games: 5000, rng: mulberry32(3) });
        const free = simulateMulligans(sixty, DEFAULT_RULE, { games: 5000, rng: mulberry32(3), freeMulligan: true });
        assert.ok(free.keptAt[7] > paid.keptAt[7]);
        assert.ok(free.belowSix < paid.belowSix);
    });

    it('always keeps when the rule accepts anything, never below four cards', () => {
        const all = simulateMulligans(sixty, { minLands: 0, maxLands: 7, playBy: 0 }, { games: 500, rng: mulberry32(4) });
        assert.strictEqual(all.keptAt[7], 500);
        assert.strictEqual(all.averageMulligans, 0);
        const impossible = simulateMulligans(sixty, { minLands: 7, maxLands: 7, playBy: 0 }, { games: 500, rng: mulberry32(5) });
        assert.ok(impossible.keptAt[MIN_HAND] > 490);
        assert.ok(Object.keys(impossible.keptAt).every(k => Number(k) >= MIN_HAND));
    });

    it('ignores the play requirement for placeholder decks', () => {
        const lib = buildPlaceholderLibrary({ lands: 24, creatures: 36 }).cards;
        const strict = simulateMulligans(lib, { minLands: 2, maxLands: 4, playBy: 2 }, { games: 3000, rng: mulberry32(6), hasCosts: false });
        const loose = simulateMulligans(lib, { minLands: 2, maxLands: 4, playBy: 0 }, { games: 3000, rng: mulberry32(6), hasCosts: false });
        assert.deepStrictEqual(strict, loose);
    });

    it('returns null for a deck smaller than a hand', () => {
        assert.strictEqual(simulateMulligans(sixty.slice(0, 6), DEFAULT_RULE), null);
    });

    it('runs 10,000 games quickly', () => {
        const t0 = performance.now();
        simulateMulligans(sixty, { minLands: 2, maxLands: 4, playBy: 2 }, { games: 10000, freeMulligan: true });
        const ms = performance.now() - t0;
        assert.ok(ms < 250, `took ${ms.toFixed(1)}ms`);
    });
});

// ── Words ───────────────────────────────────────────────────────────────────

describe('handOdds / gameOdds', () => {
    it('says simple fractions', () => {
        assert.strictEqual(handOdds(0.74), 'About 3 in 4');
        assert.strictEqual(handOdds(0.5), 'About half');
        assert.strictEqual(handOdds(0.61), 'About 3 in 5');
        assert.strictEqual(handOdds(0.98), 'Nearly all');
        assert.strictEqual(handOdds(0.03), 'Fewer than 1 in 20');
        assert.strictEqual(handOdds(0.12), 'About 1 in 8');
    });

    it('says rare events as one game in N', () => {
        assert.strictEqual(gameOdds(0.004), 'fewer than 1 game in 100');
        assert.strictEqual(gameOdds(0.03), 'fewer than 1 game in 20');
        assert.strictEqual(gameOdds(0.125), 'about 1 game in 8');
        assert.strictEqual(gameOdds(0.4), 'about 2 games in 5');
        assert.strictEqual(gameOdds(0.5), 'about half of games');
    });
});

describe('summarize', () => {
    it('leads with the keepable share and the deep-mulligan risk', () => {
        const s = summarize({ keepable: 0.75, belowSix: 0.03 });
        assert.strictEqual(s.tone, 'good');
        assert.match(s.html, /<strong>About 3 in 4<\/strong> opening hands are keepable as-is/);
        assert.match(s.html, /below 6 cards in <strong>fewer than 1 game in 20<\/strong>\./);
    });

    it('mentions the free mulligan when the format has one', () => {
        assert.match(summarize({ keepable: 0.75, belowSix: 0.01, freeMulligan: true }).html, /free first mulligan/);
    });

    it('grades the tone by what the numbers mean', () => {
        assert.strictEqual(summarize({ keepable: 0.65, belowSix: 0.1 }).tone, 'warn');
        assert.strictEqual(summarize({ keepable: 0.4, belowSix: 0.1 }).tone, 'bad');
        assert.strictEqual(summarize({ keepable: 0.8, belowSix: 0.3 }).tone, 'bad');
    });

    it('falls back when there are no numbers', () => {
        assert.strictEqual(summarize(null).tone, 'flat');
    });
});

// ── Sample game ─────────────────────────────────────────────────────────────

describe('sample game', () => {
    const lib = buildLibrary(deck({ Forest: 14, Island: 10, 'Llanowar Elves': 8, Counterspell: 8, Mulldrifter: 10, 'Rampant Growth': 10 })).cards;
    const commander = { freeMulligan: true, firstPlayerDraws: true };
    const twoPlayer = { freeMulligan: false, firstPlayerDraws: false, onPlay: true };

    it('shuffles into a new array with the same cards', () => {
        const s = shuffled(lib, mulberry32(1));
        assert.notStrictEqual(s, lib);
        assert.deepStrictEqual(s.map(c => c.uid).sort((a, b) => a - b), lib.map(c => c.uid));
    });

    it('deals seven and keeps the rest as the library', () => {
        const g = newHand(createGame(lib), mulberry32(2));
        assert.strictEqual(g.hand.length, 7);
        assert.strictEqual(g.library.length, lib.length - 7);
        assert.strictEqual(g.phase, 'deciding');
        assert.strictEqual(g.fresh.size, 7);
    });

    it('cannot deal from a deck smaller than a hand', () => {
        const g = dealHand(createGame(lib.slice(0, 5)));
        assert.strictEqual(canDeal(g), false);
        assert.strictEqual(g.hand.length, 0);
        assert.strictEqual(canMulligan(g), false);
        assert.strictEqual(keepHand(g), false);
    });

    it('makes the first mulligan free in Commander', () => {
        const g = newHand(createGame(lib, commander), mulberry32(3));
        takeMulligan(g, mulberry32(4));
        assert.strictEqual(g.mulligans, 1);
        assert.strictEqual(owedCards(g), 0);
        takeMulligan(g, mulberry32(5));
        assert.strictEqual(owedCards(g), 1);
        assert.strictEqual(g.hand.length, 7, 'London: always draw seven');
    });

    it('owes one card per mulligan in two-player formats and stops before an empty hand', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(6));
        for (let i = 0; i < 6; i++) assert.strictEqual(takeMulligan(g, mulberry32(10 + i)), true);
        assert.strictEqual(owedCards(g), 6);
        assert.strictEqual(canMulligan(g), false);
        assert.strictEqual(takeMulligan(g), false);
    });

    it('keeping with nothing owed goes straight to playing', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(7));
        assert.strictEqual(keepHand(g), true);
        assert.strictEqual(g.phase, 'playing');
        assert.strictEqual(g.kept.length, 7);
        assert.strictEqual(canMulligan(g), false);
    });

    it('keeping after a mulligan asks for the bottom cards, which go under the library', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(8));
        takeMulligan(g, mulberry32(9));
        takeMulligan(g, mulberry32(10));
        keepHand(g);
        assert.strictEqual(g.phase, 'bottoming');
        const [a, b, c] = g.hand;
        assert.strictEqual(toggleBottom(g, a.uid), true);
        assert.strictEqual(confirmBottom(g), false, 'needs exactly two');
        assert.strictEqual(toggleBottom(g, b.uid), true);
        assert.strictEqual(toggleBottom(g, c.uid), false, 'never more than owed');
        assert.strictEqual(toggleBottom(g, a.uid), true, 'click again to unselect');
        toggleBottom(g, c.uid);
        const libraryBefore = g.library.length;
        assert.strictEqual(confirmBottom(g), true);
        assert.strictEqual(g.hand.length, 5);
        assert.strictEqual(g.library.length, libraryBefore + 2);
        assert.deepStrictEqual(g.library.slice(-2).map(x => x.uid), [b.uid, c.uid]);
        assert.strictEqual(g.phase, 'playing');
    });

    it('suggests the same bottom as the simulation', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(11));
        takeMulligan(g, mulberry32(12));
        keepHand(g);
        suggestBottom(g, DEFAULT_RULE);
        const expected = chooseBottom(g.hand, 1, DEFAULT_RULE).bottom.map(c => c.uid);
        assert.deepStrictEqual([...g.selected], expected);
    });

    it('reset replays the same deal', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(13));
        const hand = g.hand.map(c => c.uid);
        keepHand(g);
        nextTurn(g);
        nextTurn(g);
        resetHand(g);
        assert.deepStrictEqual(g.hand.map(c => c.uid), hand);
        assert.strictEqual(g.phase, 'deciding');
        assert.strictEqual(g.turn, 0);
        assert.deepStrictEqual(g.battlefield, []);
    });

    it('skips the first draw on the play in two-player games, not in Commander', () => {
        const duel = newHand(createGame(lib, twoPlayer), mulberry32(14));
        keepHand(duel);
        const t1 = nextTurn(duel);
        assert.strictEqual(t1.drew, null);
        assert.strictEqual(duel.turn, 1);
        assert.ok(nextTurn(duel).drew, 'draws on turn two');

        const onDraw = newHand(createGame(lib, { ...twoPlayer, onPlay: false }), mulberry32(14));
        keepHand(onDraw);
        assert.ok(nextTurn(onDraw).drew);

        const edh = newHand(createGame(lib, commander), mulberry32(14));
        keepHand(edh);
        assert.ok(nextTurn(edh).drew);
    });

    it('plays one land a turn and untaps each turn', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(15));
        keepHand(g);
        for (let t = 1; t <= 4; t++) {
            const handLands = g.hand.filter(c => c.land).length + (g.library[0]?.land && t > 1 ? 1 : 0);
            const r = nextTurn(g);
            assert.strictEqual(Boolean(r.land), handLands > 0);
            assert.strictEqual(g.tapped.size, 0);
        }
        assert.ok(g.battlefield.filter(c => c.land).length <= 4);
    });

    it('casts castable cards, taps the lands and sends spells to the right zone', () => {
        const g = createGame(lib, twoPlayer);
        const [forest, island, elves, counter, growth] = cards('Forest', 'Island', 'Llanowar Elves', 'Counterspell', 'Rampant Growth');
        g.phase = 'playing';
        g.turn = 2;
        g.battlefield = [forest, island];
        g.hand = [elves, counter, growth];
        assert.deepStrictEqual(names(castableNow(g)), ['Llanowar Elves', 'Rampant Growth']);
        assert.strictEqual(castCard(g, counter.uid), null, 'UU with one Island');
        const tapped = castCard(g, growth.uid);
        assert.deepStrictEqual(names(tapped).sort(), ['Forest', 'Island']);
        assert.deepStrictEqual(names(g.graveyard), ['Rampant Growth']);
        assert.strictEqual(untappedLands(g).length, 0);
        assert.deepStrictEqual(castableNow(g), []);
        assert.strictEqual(castCard(g, elves.uid), null, 'out of mana');
    });

    it('stops after the turn limit', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(16));
        keepHand(g);
        let turns = 0;
        while (nextTurn(g)) turns++;
        assert.strictEqual(turns, MAX_TURNS);
        assert.strictEqual(canAdvance(g), false);
    });

    it('does not take turns before keeping', () => {
        const g = newHand(createGame(lib, twoPlayer), mulberry32(17));
        assert.strictEqual(nextTurn(g), null);
        assert.strictEqual(castCard(g, g.hand[0].uid), null);
    });
});
