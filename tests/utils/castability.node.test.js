import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    COLOR_BIT,
    colorsToMask,
    maskToColors,
    orderColors,
    joinWords,
    cardRequirement,
    castProbability,
    describeLands,
    groupLands,
    sourcesTable,
    analyzeCastability
} from '../../js/utils/castability.js';
import { colorCastProbability, sourcesNeeded } from '../../js/utils/deckStats.js';
import { FORMATS, cardsSeenByTurn } from '../../js/utils/format.js';
import { budget } from '../helpers/timing.js';

const { W, U, B, R, G } = COLOR_BIT;
// ── Brute force ──────────────────────────────────────────────────────────────

/** Can these land masks pay these pips (each pip a mask of acceptable colours)? */
function canPay(pips, lands) {
    const used = new Array(lands.length).fill(false);
    const assign = i => {
        if (i === pips.length) return true;
        for (let l = 0; l < lands.length; l++) {
            if (used[l] || (lands[l] & pips[i]) === 0) continue;
            used[l] = true;
            if (assign(i + 1)) return true;
            used[l] = false;
        }
        return false;
    };
    return assign(0);
}

/** Enumerate every n-card subset of a small explicit deck. */
function bruteForce({ deck, pips, landsNeeded, seen }) {
    let total = 0;
    let landsOk = 0;
    let joint = 0;
    const pick = [];
    const walk = start => {
        if (pick.length === seen) {
            total++;
            const lands = pick.filter(c => c !== null);
            if (lands.length >= landsNeeded) {
                landsOk++;
                if (canPay(pips, lands)) joint++;
            }
            return;
        }
        for (let i = start; i <= deck.length - (seen - pick.length); i++) {
            pick.push(deck[i]);
            walk(i + 1);
            pick.pop();
        }
    };
    walk(0);
    return { joint: joint / total, landsOk: landsOk / total, conditional: landsOk ? joint / landsOk : 0 };
}

/** Build an explicit deck: land masks, then null for each nonland. */
function explicitDeck(landGroups, deckSize) {
    const deck = [];
    for (const g of landGroups) for (let i = 0; i < g.count; i++) deck.push(g.mask);
    while (deck.length < deckSize) deck.push(null);
    return deck;
}

function expandPips(pipTypes) {
    return pipTypes.flatMap(t => Array.from({ length: t.count }, () => t.mask));
}

/** Small seeded PRNG so the random cases are the same every run. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function close(actual, expected, msg) {
    assert.ok(Math.abs(actual - expected) < 1e-10, `${msg}: ${actual} vs ${expected}`);
}

function assertMatches(p, bf, label) {
    close(p.joint, bf.joint, `${label} joint`);
    close(p.landsOk, bf.landsOk, `${label} landsOk`);
    close(p.conditional, bf.conditional, `${label} conditional`);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('castability - colour masks', () => {
    it('round-trips colours and masks in WUBRG order', () => {
        assert.strictEqual(colorsToMask(['G', 'U']), U | G);
        assert.deepStrictEqual(maskToColors(W | B | G), ['W', 'B', 'G']);
        assert.deepStrictEqual(maskToColors(0), []);
    });

    it('orders colour pairs the short way round the wheel', () => {
        assert.deepStrictEqual(orderColors(['U', 'G']), ['G', 'U']);   // Simic
        assert.deepStrictEqual(orderColors(['W', 'U']), ['W', 'U']);   // Azorius
        assert.deepStrictEqual(orderColors(['W', 'R']), ['R', 'W']);   // Boros
        assert.deepStrictEqual(orderColors(['W', 'G']), ['G', 'W']);   // Selesnya
        assert.deepStrictEqual(orderColors(['B', 'G']), ['B', 'G']);   // Golgari
        assert.deepStrictEqual(orderColors(['W', 'U', 'B']), ['W', 'U', 'B']);
    });

    it('joins words in plain English', () => {
        assert.strictEqual(joinWords(['Green']), 'Green');
        assert.strictEqual(joinWords(['Green', 'Blue']), 'Green & Blue');
        assert.strictEqual(joinWords(['White', 'Blue', 'Black']), 'White, Blue & Black');
    });
});

describe('castability - cardRequirement', () => {
    it('counts strict pips per colour and the on-curve turn', () => {
        const r = cardRequirement({ mana_cost: '{2}{G}{G}{U}', cmc: 5 });
        assert.deepStrictEqual(r.pipTypes, [{ mask: U, count: 1 }, { mask: G, count: 2 }]);
        assert.strictEqual(r.coloredPips, 3);
        assert.strictEqual(r.turn, 5);
        assert.deepStrictEqual(r.colors, ['U', 'G']);
    });

    it('treats hybrid as one pip of either colour', () => {
        const r = cardRequirement({ mana_cost: '{U/B}{U/B}{G}', cmc: 3 });
        assert.deepStrictEqual(r.pipTypes, [{ mask: G, count: 1 }, { mask: U | B, count: 2 }]);
        assert.strictEqual(r.hybrid.length, 2);
        assert.strictEqual(r.coloredPips, 3);
    });

    it('does not require phyrexian or twobrid symbols', () => {
        const phy = cardRequirement({ mana_cost: '{3}{G}{G}{G/P}{G/P}', cmc: 7 });
        assert.strictEqual(phy.coloredPips, 2);
        assert.strictEqual(phy.phyrexian, 2);
        const twobrid = cardRequirement({ mana_cost: '{2/W}{2/W}{2/W}', cmc: 6 });
        assert.strictEqual(twobrid.coloredPips, 0);
        assert.strictEqual(twobrid.twobrid, 3);
    });

    it('checks X spells with X = 1', () => {
        const r = cardRequirement({ mana_cost: '{X}{U}{U}', cmc: 2 });
        assert.strictEqual(r.mv, 2);
        assert.strictEqual(r.x, 1);
        assert.strictEqual(r.turn, 3);
        assert.strictEqual(cardRequirement({ mana_cost: '{X}{X}{X}{G}{U}', cmc: 2 }).turn, 5);
    });

    it('never checks before turn one', () => {
        assert.strictEqual(cardRequirement({ mana_cost: '{G}', cmc: 1 }).turn, 1);
        assert.strictEqual(cardRequirement({ mana_cost: '', cmc: 0 }).turn, 1);
    });
});

describe('castability - castProbability matches brute-force enumeration', () => {
    const cases = [
        {
            label: '{G}{U} with mono and dual lands',
            landGroups: [{ mask: G, count: 3 }, { mask: U, count: 2 }, { mask: G | U, count: 2 }, { mask: 0, count: 1 }],
            deckSize: 14, pipTypes: [{ mask: G, count: 1 }, { mask: U, count: 1 }], landsNeeded: 2, seen: 6
        },
        {
            label: '{G}{G}{U} where one dual cannot be both',
            landGroups: [{ mask: G, count: 2 }, { mask: U, count: 1 }, { mask: G | U, count: 3 }],
            deckSize: 13, pipTypes: [{ mask: G, count: 2 }, { mask: U, count: 1 }], landsNeeded: 3, seen: 7
        },
        {
            label: '{W}{U}{B} with a tri-land and any-colour land',
            landGroups: [{ mask: W, count: 2 }, { mask: U, count: 1 }, { mask: B, count: 2 }, { mask: W | U | B, count: 1 }, { mask: W | U | B | R | G, count: 1 }, { mask: W | B, count: 1 }],
            deckSize: 14, pipTypes: [{ mask: W, count: 1 }, { mask: U, count: 1 }, { mask: B, count: 1 }], landsNeeded: 3, seen: 7
        },
        {
            label: 'hybrid {U/B}{U/B} plus {G}',
            landGroups: [{ mask: U, count: 2 }, { mask: B, count: 1 }, { mask: G, count: 2 }, { mask: G | U, count: 1 }, { mask: 0, count: 1 }],
            deckSize: 13, pipTypes: [{ mask: U | B, count: 2 }, { mask: G, count: 1 }], landsNeeded: 3, seen: 7
        },
        {
            label: 'a colour no land makes is never castable',
            landGroups: [{ mask: G, count: 4 }, { mask: U, count: 2 }],
            deckSize: 12, pipTypes: [{ mask: R, count: 1 }], landsNeeded: 1, seen: 5
        },
        {
            label: 'needs more lands than the pips',
            landGroups: [{ mask: G, count: 3 }, { mask: 0, count: 3 }],
            deckSize: 12, pipTypes: [{ mask: G, count: 1 }], landsNeeded: 4, seen: 8
        }
    ];

    for (const c of cases) {
        it(c.label, () => {
            const p = castProbability(c);
            const bf = bruteForce({ deck: explicitDeck(c.landGroups, c.deckSize), pips: expandPips(c.pipTypes), landsNeeded: c.landsNeeded, seen: c.seen });
            assertMatches(p, bf, c.label);
        });
    }

    it('agrees on 60 random small decks and requirements', () => {
        const rand = rng(20261121);
        const pick = n => Math.floor(rand() * n);
        for (let k = 0; k < 60; k++) {
            const deckSize = 10 + pick(4);
            const landGroups = [];
            let lands = 0;
            const nGroups = 1 + pick(5);
            for (let g = 0; g < nGroups && lands < deckSize - 2; g++) {
                const count = 1 + pick(3);
                landGroups.push({ mask: pick(32), count });
                lands += count;
            }
            const pipTypes = [];
            const nTypes = 1 + pick(3);
            for (let t = 0; t < nTypes; t++) {
                const a = COLORS5[pick(5)];
                const mask = rand() < 0.25 ? a | COLORS5[pick(5)] : a;
                pipTypes.push({ mask, count: 1 + pick(2) });
            }
            const pipTotal = pipTypes.reduce((s, t) => s + t.count, 0);
            const landsNeeded = pipTotal + pick(2);
            const seen = Math.min(deckSize, 4 + pick(4));
            const p = castProbability({ deckSize, landGroups, pipTypes, landsNeeded, seen });
            const bf = bruteForce({ deck: explicitDeck(landGroups, deckSize), pips: expandPips(pipTypes), landsNeeded, seen });
            assertMatches(p, bf, `random case ${k}`);
        }
    });
});

const COLORS5 = [W, U, B, R, G];

describe('castability - castProbability matches deckStats for mono-colour cards', () => {
    const combos = [
        { deckSize: 99, lands: 37, sources: 24, pips: 2, landsNeeded: 3, seen: 9 },
        { deckSize: 99, lands: 37, sources: 18, pips: 3, landsNeeded: 6, seen: 13 },
        { deckSize: 60, lands: 24, sources: 14, pips: 1, landsNeeded: 1, seen: 7 },
        { deckSize: 60, lands: 25, sources: 20, pips: 2, landsNeeded: 2, seen: 8 },
        { deckSize: 40, lands: 17, sources: 9, pips: 3, landsNeeded: 4, seen: 10 },
        { deckSize: 40, lands: 17, sources: 0, pips: 1, landsNeeded: 2, seen: 8 }
    ];

    for (const c of combos) {
        it(`${c.deckSize} cards, ${c.lands} lands, ${c.sources} sources, ${c.pips} pips by turn ${c.landsNeeded}`, () => {
            const expected = colorCastProbability(c);
            // Spread the same sources across mono and dual lands: only "makes
            // green or not" may matter for a green-only card.
            const duals = Math.min(3, c.sources);
            const landGroups = [
                { mask: G, count: c.sources - duals },
                { mask: G | U, count: duals },
                { mask: U, count: Math.max(0, c.lands - c.sources - 1) },
                { mask: 0, count: c.lands - c.sources > 0 ? 1 : 0 }
            ];
            const p = castProbability({ deckSize: c.deckSize, landGroups, pipTypes: [{ mask: G, count: c.pips }], landsNeeded: c.landsNeeded, seen: c.seen });
            close(p.joint, expected.joint, 'joint');
            close(p.conditional, expected.conditional, 'conditional');
            close(p.landsOk, expected.landsOk, 'landsOk');
        });
    }
});

describe('castability - castProbability properties', () => {
    it('a card with no coloured pips only needs the land count', () => {
        const p = castProbability({ deckSize: 60, landGroups: [{ mask: G, count: 24 }], pipTypes: [], landsNeeded: 3, seen: 9 });
        assert.strictEqual(p.conditional, 1);
        assert.ok(p.joint > 0 && p.joint < 1);
    });

    it('the joint chance never beats either single-colour chance', () => {
        const landGroups = [{ mask: G, count: 14 }, { mask: U, count: 10 }, { mask: G | U, count: 6 }, { mask: 0, count: 6 }];
        const base = { deckSize: 99, landGroups, landsNeeded: 4, seen: 11 };
        const gu = castProbability({ ...base, pipTypes: [{ mask: G, count: 1 }, { mask: U, count: 1 }] });
        const g = castProbability({ ...base, pipTypes: [{ mask: G, count: 1 }] });
        const u = castProbability({ ...base, pipTypes: [{ mask: U, count: 1 }] });
        assert.ok(gu.joint <= Math.min(g.joint, u.joint) + 1e-12);
        assert.ok(gu.conditional > 0 && gu.conditional <= 1);
    });

    it('more sources never lowers the chance', () => {
        let previous = -1;
        for (let duals = 0; duals <= 10; duals++) {
            const p = castProbability({
                deckSize: 99,
                landGroups: [{ mask: G, count: 20 - duals }, { mask: U, count: 17 - duals }, { mask: G | U, count: duals * 2 }],
                pipTypes: [{ mask: G, count: 2 }, { mask: U, count: 2 }],
                landsNeeded: 6, seen: 13
            });
            assert.ok(p.conditional >= previous - 1e-12);
            previous = p.conditional;
        }
    });

    it('returns zeros for an empty or impossible draw', () => {
        assert.deepStrictEqual(castProbability({ deckSize: 0, landGroups: [], pipTypes: [{ mask: G, count: 1 }], landsNeeded: 1, seen: 7 }),
            { joint: 0, conditional: 0, landsOk: 0 });
        const p = castProbability({ deckSize: 60, landGroups: [{ mask: G, count: 2 }], pipTypes: [{ mask: G, count: 1 }], landsNeeded: 3, seen: 7 });
        assert.strictEqual(p.landsOk, 0);
        assert.strictEqual(p.conditional, 0);
    });

    it('stays fast for a five-colour card with two pips of every colour', () => {
        const landGroups = [];
        for (let m = 1; m < 32; m++) landGroups.push({ mask: m, count: 1 });
        landGroups.push({ mask: W | U | B | R | G, count: 6 });
        const start = performance.now();
        const p = castProbability({
            deckSize: 99, landGroups,
            pipTypes: COLORS5.map(mask => ({ mask, count: 2 })),
            landsNeeded: 10, seen: 17
        });
        assert.ok(p.conditional > 0.9 && p.conditional <= 1);
        assert.ok(performance.now() - start < budget(1500), 'Progenitus-sized costs must not stall the page');
    });
});

describe('castability - lands', () => {
    const identity = ['U', 'G'];
    const cards = [
        { name: 'Forest', count: 10, type_line: 'Basic Land — Forest', color_identity: ['G'] },
        { name: 'Island', count: 8, type_line: 'Basic Land — Island', color_identity: ['U'] },
        { name: 'Breeding Pool', count: 1, type_line: 'Land — Forest Island', color_identity: ['G', 'U'] },
        { name: 'Command Tower', count: 1, type_line: 'Land', oracle_text: "{T}: Add one mana of any color in your commander's color identity.", color_identity: [] },
        { name: 'Academy Ruins', count: 1, type_line: 'Legendary Land', produced_mana: ['C'], color_identity: ['U'] },
        { name: 'Llanowar Elves', count: 1, type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1 }
    ];

    it('describes what each land makes for this deck', () => {
        const info = describeLands(cards, identity);
        const byName = Object.fromEntries(info.map(l => [l.name, l]));
        assert.strictEqual(info.length, 5);
        assert.deepStrictEqual(byName['Breeding Pool'].colors, ['U', 'G']);
        assert.strictEqual(byName['Breeding Pool'].kind, 'colors');
        assert.strictEqual(byName['Command Tower'].kind, 'any');
        assert.deepStrictEqual(byName['Command Tower'].colors, ['U', 'G']);
        assert.strictEqual(byName['Academy Ruins'].kind, 'colorless');
    });

    it('only counts basic-fetchers for the basics the deck runs', () => {
        const wilds = { name: 'Evolving Wilds', count: 2, type_line: 'Land', oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' };
        const info = describeLands([
            { name: 'Plains', count: 3, type_line: 'Basic Land — Plains', color_identity: ['W'] },
            { name: 'Island', count: 2, type_line: 'Basic Land — Island', color_identity: ['U'] },
            wilds
        ], ['W', 'U', 'G']);
        const w = info.find(l => l.name === 'Evolving Wilds');
        assert.deepStrictEqual(w.colors, ['W', 'U']);
        assert.strictEqual(w.kind, 'colors'); // not "any colour": it cannot find green
        const all = describeLands([{ name: 'Forest', count: 1, type_line: 'Basic Land — Forest' }, { name: 'Island', count: 1, type_line: 'Basic Land — Island' }, wilds], ['U', 'G']);
        assert.strictEqual(all.find(l => l.name === 'Evolving Wilds').kind, 'any');
        const none = describeLands([wilds], ['U', 'G']);
        assert.deepStrictEqual(none[0].colors, []);
        assert.strictEqual(none[0].kind, 'colorless');
    });

    it('groups lands by what they produce, fixing first', () => {
        const groups = groupLands(describeLands(cards, identity));
        assert.deepStrictEqual(groups.map(g => g.label), ['Any colour', 'Green & Blue', 'Blue', 'Green', 'Colourless']);
        assert.deepStrictEqual(groups.find(g => g.label === 'Green').cards, [{ name: 'Forest', count: 10 }]);
        assert.strictEqual(groups.reduce((s, g) => s + g.count, 0), 21);
    });
});

describe('castability - sourcesTable', () => {
    it('matches sourcesNeeded cell by cell and marks impossible cells', () => {
        const format = FORMATS.constructed;
        const table = sourcesTable({ deckSize: 60, lands: 24, format, onPlay: true });
        assert.deepStrictEqual(table.turns, [1, 2, 3, 4, 5, 6]);
        assert.strictEqual(table.rows.length, 3);
        for (const row of table.rows) {
            for (const cell of row.cells) {
                if (row.pips > cell.turn) {
                    assert.strictEqual(cell.possible, false);
                    continue;
                }
                const seen = cardsSeenByTurn(cell.turn, { format, onPlay: true });
                assert.strictEqual(cell.needed, sourcesNeeded({ deckSize: 60, lands: 24, pips: row.pips, landsNeeded: cell.turn, seen }));
            }
        }
    });

    it('needs more sources for more pips and fewer as turns pass', () => {
        const { rows } = sourcesTable({ deckSize: 99, lands: 37, format: FORMATS.commander });
        const one = rows[0].cells.map(c => c.needed);
        for (let i = 1; i < one.length; i++) assert.ok(one[i] <= one[i - 1]);
        for (let t = 2; t < 6; t++) assert.ok(rows[1].cells[t].needed > rows[0].cells[t].needed);
    });

    it('being on the draw never needs more sources', () => {
        const play = sourcesTable({ deckSize: 60, lands: 24, format: FORMATS.constructed, onPlay: true });
        const draw = sourcesTable({ deckSize: 60, lands: 24, format: FORMATS.constructed, onPlay: false });
        play.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
            if (cell.needed != null) assert.ok(draw.rows[r].cells[c].needed <= cell.needed);
        }));
    });
});

describe('castability - analyzeCastability', () => {
    const deck = {
        Forest: { name: 'Forest', count: 9, type_line: 'Basic Land — Forest', color_identity: ['G'] },
        Island: { name: 'Island', count: 7, type_line: 'Basic Land — Island', color_identity: ['U'] },
        'Breeding Pool': { name: 'Breeding Pool', count: 4, type_line: 'Land — Forest Island', color_identity: ['G', 'U'] },
        Wastes: { name: 'Wastes', count: 2, type_line: 'Basic Land', color_identity: [] },
        'Llanowar Elves': { name: 'Llanowar Elves', count: 4, type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1, color_identity: ['G'] },
        Counterspell: { name: 'Counterspell', count: 4, type_line: 'Instant', mana_cost: '{U}{U}', cmc: 2, color_identity: ['U'] },
        'Growth Spiral': { name: 'Growth Spiral', count: 4, type_line: 'Instant', mana_cost: '{G}{U}', cmc: 2, color_identity: ['G', 'U'] },
        'Mental Misstep': { name: 'Mental Misstep', count: 1, type_line: 'Instant', mana_cost: '{U/P}', cmc: 1, color_identity: ['U'] },
        'Sol Ring': { name: 'Sol Ring', count: 1, type_line: 'Artifact', mana_cost: '{1}', cmc: 1, color_identity: [] },
        'Delver of Secrets // Insectile Aberration': { name: 'Delver of Secrets // Insectile Aberration', count: 4, type_line: 'Creature', mana_cost: '', cmc: 1, colors: ['U'] },
        Filler: { name: 'Filler', count: 20, type_line: 'Artifact', mana_cost: '{3}', cmc: 3 }
    };
    const result = analyzeCastability(deck, { deckSize: 60, format: FORMATS.constructed, onPlay: true });

    it('counts lands and sources', () => {
        assert.strictEqual(result.lands, 22);
        assert.strictEqual(result.deckSize, 60);
        assert.strictEqual(result.sources.G, 13);
        assert.strictEqual(result.sources.U, 11);
        assert.strictEqual(result.colorlessLands, 2);
        assert.deepStrictEqual(result.identity, ['U', 'G']);
    });

    it('lists only cards with coloured demands, worst first', () => {
        assert.deepStrictEqual(result.cards.map(c => c.name).sort(), ['Counterspell', 'Growth Spiral', 'Llanowar Elves']);
        for (let i = 1; i < result.cards.length; i++) assert.ok(result.cards[i].chance >= result.cards[i - 1].chance);
        assert.strictEqual(result.total, 3);
        assert.strictEqual(result.phyrexianOnly, 1);
        assert.deepStrictEqual(result.skipped, [{ name: 'Delver of Secrets // Insectile Aberration', count: 4 }]);
    });

    it('gives mono-colour cards the same answer as deckStats', () => {
        const cs = result.cards.find(c => c.name === 'Counterspell');
        const expected = colorCastProbability({ deckSize: 60, lands: 22, sources: 11, pips: 2, landsNeeded: 2, seen: 8 });
        close(cs.chance, expected.conditional, 'Counterspell');
        close(cs.overall, expected.joint, 'Counterspell overall');
    });

    it('finds each colour’s hardest card and the sources it wants', () => {
        const blue = result.colors.find(c => c.color === 'U');
        assert.strictEqual(blue.hardest.name, 'Counterspell');
        assert.strictEqual(blue.want, sourcesNeeded({ deckSize: 60, lands: 22, pips: 2, landsNeeded: 2, seen: 8 }));
        // 4 Counterspell × UU + 4 Growth Spiral × U
        assert.strictEqual(blue.pips, 12);
        assert.strictEqual(blue.cards, 2);
        assert.strictEqual(blue.gap, blue.want - 11);
    });

    it('names the colour furthest short of what its cards want', () => {
        const short = result.colors.filter(c => c.gap > 0).sort((a, b) => b.gap - a.gap);
        assert.strictEqual(result.bottleneck?.color ?? null, short[0]?.color ?? null);
        // Eleven blue sources is well short of what a turn-two UU card wants in 60 cards.
        assert.strictEqual(result.bottleneck?.color, 'U');
    });

    it('handles a deck with no cards', () => {
        const empty = analyzeCastability({}, { deckSize: 0 });
        assert.strictEqual(empty.total, 0);
        assert.strictEqual(empty.worst, null);
        assert.strictEqual(empty.average, null);
        assert.strictEqual(empty.bottleneck, null);
    });
});

describe('castability - turn strips (when a card becomes reliable)', () => {
    const deck = {
        Forest: { name: 'Forest', count: 9, type_line: 'Basic Land — Forest', color_identity: ['G'] },
        Island: { name: 'Island', count: 7, type_line: 'Basic Land — Island', color_identity: ['U'] },
        'Breeding Pool': { name: 'Breeding Pool', count: 4, type_line: 'Land — Forest Island', color_identity: ['G', 'U'] },
        Counterspell: { name: 'Counterspell', count: 4, type_line: 'Instant', mana_cost: '{U}{U}', cmc: 2, color_identity: ['U'] },
        'Growth Spiral': { name: 'Growth Spiral', count: 4, type_line: 'Instant', mana_cost: '{G}{U}', cmc: 2, color_identity: ['G', 'U'] },
        Filler: { name: 'Filler', count: 32, type_line: 'Artifact', mana_cost: '{3}', cmc: 3 }
    };
    const opts = { deckSize: 60, format: FORMATS.constructed, onPlay: true };

    it('is opt-in', () => {
        const plain = analyzeCastability(deck, opts);
        assert.strictEqual(plain.cards[0].byTurn, undefined);
        assert.strictEqual(plain.colors[0].byTurn, undefined);
    });

    it('starts on the card’s own turn with its on-curve chance, then never drops', () => {
        const result = analyzeCastability(deck, { ...opts, byTurn: 8 });
        for (const card of result.cards) {
            assert.strictEqual(card.byTurn.length, 8);
            assert.strictEqual(card.byTurn[0], null, 'nothing costing 2 is castable on turn 1');
            assert.strictEqual(card.byTurn[card.turn - 1], card.chance);
            for (let t = card.turn; t < 8; t++) assert.ok(card.byTurn[t] >= card.byTurn[t - 1] - 1e-12);
        }
    });

    it('gives each colour one strip per pip count it needs, matching the mono-colour formula', () => {
        const result = analyzeCastability(deck, { ...opts, byTurn: 6 });
        const blue = result.colors.find(c => c.color === 'U');
        assert.deepStrictEqual(blue.byTurn.map(r => r.pips), [1, 2]);
        assert.strictEqual(blue.byTurn[1].cells[0], null, 'two blue pips need two lands');
        const seen = cardsSeenByTurn(4, { format: FORMATS.constructed, onPlay: true });
        const expected = colorCastProbability({ deckSize: 60, lands: 20, sources: blue.sources, pips: 2, landsNeeded: 4, seen }).conditional;
        assert.ok(Math.abs(blue.byTurn[1].cells[3] - expected) < 1e-12);
    });
});
