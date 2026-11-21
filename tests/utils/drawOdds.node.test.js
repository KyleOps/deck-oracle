import { describe, it } from 'node:test';
import assert from 'node:assert';

import { drawTypeMin, choose } from '../../js/utils/hypergeometric.js';
import { FORMATS, cardsSeenByTurn } from '../../js/utils/format.js';
import { budget, medianMs } from '../helpers/timing.js';
import {
    MAX_NEED, MAX_TURN, SEARCH_TURN,
    normalizeName, formatPct, turnLabel,
    buildLibrary, buildManualLibrary, presetMembers, presetCounts, findCard, searchCards,
    emptyGroup, presetGroup, cardsGroup, resolveGroup, autoName, groupName,
    regionSizes, allOfWeights, allOfChance, atLeastChance, firstTurnReaching, analyzeOdds,
    describeGroup, summarize, suggestExamples, encodeGroup, decodeGroup
} from '../../js/utils/drawOdds.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function card(name, count, { type = 'Creature — Elf', cmc = 2, text = '', cats } = {}) {
    const land = /\bland\b/i.test(type);
    const categories = cats ?? (land ? ['lands']
        : [/creature/i.test(type) && 'creatures', /artifact/i.test(type) && 'artifacts', /instant/i.test(type) && 'instants',
            /sorcery/i.test(type) && 'sorceries', /enchantment/i.test(type) && 'enchantments'].filter(Boolean));
    return { name, count, type_line: type, cmc: land ? 0 : cmc, oracle_text: text, category: categories[0], allCategories: categories };
}

const RAMP_TEXT = '{T}: Add {G}.';
const WIPE_TEXT = 'Destroy all creatures.';

function commanderList() {
    return {
        'Llanowar Elves': card('Llanowar Elves', 1, { type: 'Creature — Elf Druid', cmc: 1, text: RAMP_TEXT }),
        'Sol Ring': card('Sol Ring', 1, { type: 'Artifact', cmc: 1, text: '{T}: Add {C}{C}.' }),
        'Arcane Signet': card('Arcane Signet', 1, { type: 'Artifact', cmc: 2, text: '{T}: Add one mana of any color in your commander’s color identity.' }),
        'Wrath of God': card('Wrath of God', 1, { type: 'Sorcery', cmc: 4, text: WIPE_TEXT }),
        'Grizzly Bears': card('Grizzly Bears', 1, { type: 'Creature — Bear', cmc: 2 }),
        'Craterhoof Behemoth': card('Craterhoof Behemoth', 1, { type: 'Creature — Beast', cmc: 8 }),
        'The Commander': card('The Commander', 1, { type: 'Legendary Creature — Elf', cmc: 4 }),
        Forest: card('Forest', 36, { type: 'Basic Land — Forest' }),
        Filler: card('Filler', 57, { type: 'Sorcery', cmc: 3 })
    };
}

/** Deterministic PRNG so the brute-force sweep is reproducible. */
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

/**
 * Brute force: enumerate every n-card subset of an N-card deck (each card
 * has a membership mask) and count the ones meeting every need.
 */
function bruteForce(masks, needs, n) {
    const N = masks.length;
    let hit = 0;
    let total = 0;
    for (let s = 0; s < (1 << N); s++) {
        let bits = 0;
        for (let i = 0; i < N; i++) if (s & (1 << i)) bits++;
        if (bits !== n) continue;
        total++;
        const counts = needs.map(() => 0);
        for (let i = 0; i < N; i++) {
            if (!(s & (1 << i))) continue;
            needs.forEach((_, g) => { if (masks[i] & (1 << g)) counts[g]++; });
        }
        if (counts.every((c, g) => c >= needs[g])) hit++;
    }
    return hit / total;
}

function regionsFromMasks(masks) {
    const sizes = new Map();
    masks.forEach(m => { if (m) sizes.set(m, (sizes.get(m) ?? 0) + 1); });
    return [...sizes.entries()].map(([mask, size]) => ({ mask, size }));
}

// ── Exact maths ──────────────────────────────────────────────────────────────

describe('allOfWeights / allOfChance', () => {
    it('matches brute force on random small decks with overlapping groups', () => {
        const rand = rng(42);
        let cases = 0;
        for (let trial = 0; trial < 60; trial++) {
            const N = 6 + Math.floor(rand() * 7); // 6..12
            const G = 1 + Math.floor(rand() * 3);
            // Each card is in each group with probability ~0.35 → plenty of overlaps.
            const masks = Array.from({ length: N }, () => {
                let m = 0;
                for (let g = 0; g < G; g++) if (rand() < 0.35) m |= 1 << g;
                return m;
            });
            const needs = Array.from({ length: G }, () => 1 + Math.floor(rand() * 3));
            const regions = regionsFromMasks(masks);
            const union = masks.filter(Boolean).length;
            const W = allOfWeights(regions, needs, N);
            for (let n = 0; n <= N; n++) {
                const exact = allOfChance(W, union, N, n);
                const brute = bruteForce(masks, needs, n);
                assert.ok(Math.abs(exact - brute) < 1e-9, `trial ${trial} n=${n}: ${exact} vs ${brute}`);
                cases++;
            }
        }
        assert.ok(cases > 400);
    });

    it('a card in two groups counts toward both', () => {
        // One card in both A and B, nothing else: drawing it satisfies both.
        const masks = [0b11, 0, 0, 0];
        const W = allOfWeights(regionsFromMasks(masks), [1, 1], 4);
        assert.ok(Math.abs(allOfChance(W, 1, 4, 1) - 0.25) < 1e-12);
        assert.strictEqual(allOfChance(W, 1, 4, 4), 1);
    });

    it('equals drawTypeMin for a single group', () => {
        for (const [N, K, k] of [[99, 10, 1], [99, 37, 3], [60, 4, 1], [60, 24, 2], [40, 17, 4], [99, 1, 1]]) {
            const W = allOfWeights([{ mask: 1, size: K }], [k], 27);
            for (const n of [7, 8, 10, 14, 17, 27]) {
                const expected = drawTypeMin(N, K, n, k);
                assert.ok(Math.abs(allOfChance(W, K, N, n) - expected) < 1e-12, `N=${N} K=${K} k=${k} n=${n}`);
            }
        }
    });

    it('equals the product rule for disjoint groups only when it should', () => {
        // Two disjoint groups are NOT independent (drawing without replacement),
        // so the joint chance is slightly below the product of the parts.
        const W = allOfWeights([{ mask: 1, size: 10 }, { mask: 2, size: 10 }], [1, 1], 20);
        const joint = allOfChance(W, 20, 99, 10);
        const product = drawTypeMin(99, 10, 10, 1) ** 2;
        assert.ok(joint < product && product - joint < 0.02);
        // Inclusion–exclusion gives the exact answer for need 1 / need 1.
        const none = n => choose(99 - 10, n) / choose(99, n);
        const both = 1 - 2 * none(10) + choose(99 - 20, 10) / choose(99, 10);
        assert.ok(Math.abs(joint - both) < 1e-12);
    });

    it('is zero when a need exceeds the group and one when nothing is needed', () => {
        const W = allOfWeights([{ mask: 1, size: 2 }], [3], 10);
        assert.strictEqual(allOfChance(W, 2, 60, 10), 0);
        const free = allOfWeights([{ mask: 1, size: 5 }], [0], 10);
        assert.ok(Math.abs(allOfChance(free, 5, 60, 7) - 1) < 1e-12);
    });

    it('clamps draws to the library size', () => {
        const W = allOfWeights([{ mask: 1, size: 3 }], [3], 20);
        assert.strictEqual(allOfChance(W, 3, 10, 50), 1);
        assert.strictEqual(allOfChance(W, 3, 0, 5), 0);
    });

    it('stays under 20 ms at the worst case (3 groups, max need, 20 turns)', () => {
        const regions = [1, 2, 3, 4, 5, 6, 7].map(mask => ({ mask, size: 8 }));
        const needs = [MAX_NEED, MAX_NEED, MAX_NEED];
        let W;
        const ms = medianMs(() => { W = allOfWeights(regions, needs, 27); });
        assert.ok(ms < budget(20), `took ${ms.toFixed(1)} ms`);
        assert.ok(W.every(Number.isFinite));
    });
});

describe('atLeastChance / firstTurnReaching', () => {
    it('wraps drawTypeMin with guards', () => {
        assert.strictEqual(atLeastChance(60, 4, 7, 0), 1);
        assert.strictEqual(atLeastChance(60, 2, 7, 3), 0);
        assert.strictEqual(atLeastChance(0, 2, 7, 1), 0);
        assert.ok(Math.abs(atLeastChance(60, 4, 7, 1) - drawTypeMin(60, 4, 7, 1)) < 1e-15);
        assert.strictEqual(atLeastChance(10, 10, 99, 1), 1);
    });

    it('finds the first turn at a threshold', () => {
        assert.strictEqual(firstTurnReaching([0.1, 0.4, 0.5, 0.9], 0.5), 2);
        assert.strictEqual(firstTurnReaching([0.1, 0.2], 0.5), null);
        assert.strictEqual(firstTurnReaching([0.95], 0.9), 0);
    });
});

// ── Library and groups ───────────────────────────────────────────────────────

describe('buildLibrary', () => {
    it('leaves the commander in the command zone and keeps unidentified copies', () => {
        const list = commanderList();
        const lib = buildLibrary(list, { commanderName: 'The Commander', excludeCommander: true, deckSize: 102 });
        assert.strictEqual(lib.byName.has('The Commander'), false);
        assert.strictEqual(lib.commanderExcluded, true);
        assert.strictEqual(lib.unlisted, 2);
        assert.strictEqual(lib.size, 99 + 2);
    });

    it('keeps the commander when not playing Commander', () => {
        const lib = buildLibrary(commanderList(), { commanderName: 'The Commander', excludeCommander: false });
        assert.strictEqual(lib.byName.has('The Commander'), true);
        assert.strictEqual(lib.size, 100);
    });

    it('tags roles and mana values', () => {
        const lib = buildLibrary(commanderList());
        assert.deepStrictEqual(lib.byName.get('Sol Ring').roles, ['ramp']);
        assert.ok(lib.byName.get('Wrath of God').roles.includes('wipe'));
        assert.strictEqual(lib.byName.get('Forest').land, true);
        assert.strictEqual(lib.byName.get('Forest').mv, 0);
    });

    it('ignores empty rows', () => {
        const lib = buildLibrary({ A: { name: 'A', count: 0 }, B: null, C: { count: 3 } });
        assert.strictEqual(lib.size, 0);
    });
});

describe('presets', () => {
    const lib = buildLibrary(commanderList(), { commanderName: 'The Commander', excludeCommander: true });

    it('picks cards by type, role and mana value', () => {
        assert.deepStrictEqual(presetMembers(lib, 'type', 'lands'), ['Forest']);
        assert.deepStrictEqual(presetMembers(lib, 'type', 'creatures').sort(), ['Craterhoof Behemoth', 'Grizzly Bears', 'Llanowar Elves']);
        assert.deepStrictEqual(presetMembers(lib, 'role', 'ramp').sort(), ['Arcane Signet', 'Llanowar Elves', 'Sol Ring']);
        assert.deepStrictEqual(presetMembers(lib, 'role', 'wipe'), ['Wrath of God']);
        assert.deepStrictEqual(presetMembers(lib, 'mv', 'le2').sort(), ['Arcane Signet', 'Grizzly Bears', 'Llanowar Elves', 'Sol Ring']);
        assert.deepStrictEqual(presetMembers(lib, 'mv', 'ge5'), ['Craterhoof Behemoth']);
        assert.deepStrictEqual(presetMembers(lib, 'mv', 'nope'), []);
    });

    it('counts copies per preset', () => {
        const counts = presetCounts(lib);
        assert.strictEqual(counts.type.find(p => p.key === 'lands').copies, 36);
        assert.strictEqual(counts.role.find(p => p.key === 'ramp').copies, 3);
        assert.strictEqual(counts.role.find(p => p.key === 'counter').copies, 0);
    });

    it('reads manual type counts', () => {
        const manual = buildManualLibrary({ lands: 24, creatures: 20 }, 60);
        const counts = presetCounts(manual);
        assert.strictEqual(counts.type.find(p => p.key === 'lands').copies, 24);
        assert.strictEqual(counts.role.find(p => p.key === 'ramp').copies, 0);
        assert.deepStrictEqual(presetMembers(manual, 'type', 'lands'), []);
    });
});

describe('findCard / searchCards', () => {
    const lib = buildLibrary({
        ...commanderList(),
        'Kamahl’s Druidic Vow': card('Kamahl’s Druidic Vow', 1, { type: 'Legendary Sorcery', cmc: 2 }),
        'Fire // Ice': card('Fire // Ice', 1, { type: 'Instant // Instant', cmc: 4 })
    });

    it('matches loosely', () => {
        assert.strictEqual(findCard(lib, 'Sol Ring')?.name, 'Sol Ring');
        assert.strictEqual(findCard(lib, 'sol ring')?.name, 'Sol Ring');
        assert.strictEqual(findCard(lib, "Kamahl's Druidic Vow")?.name, 'Kamahl’s Druidic Vow');
        assert.strictEqual(findCard(lib, 'Ice')?.name, 'Fire // Ice');
        assert.strictEqual(findCard(lib, 'Black Lotus'), null);
        assert.strictEqual(findCard(buildManualLibrary({}, 60), 'Sol Ring'), null);
    });

    it('ranks prefix matches first, then word starts, then substrings', () => {
        const names = searchCards(lib, 'r').map(c => c.name);
        assert.strictEqual(names[0], 'Sol Ring'); // word start beats substring
        const sig = searchCards(lib, 'arc').map(c => c.name);
        assert.deepStrictEqual(sig, ['Arcane Signet']);
        assert.deepStrictEqual(searchCards(lib, 'kamahls').map(c => c.name), ['Kamahl’s Druidic Vow']);
        assert.deepStrictEqual(searchCards(lib, '   '), []);
        assert.strictEqual(searchCards(lib, 'e', { limit: 3 }).length, 3);
    });
});

describe('groups', () => {
    const lib = buildLibrary(commanderList(), { commanderName: 'The Commander', excludeCommander: true });

    it('resolves cards, presets and manual counts', () => {
        assert.deepStrictEqual(resolveGroup(cardsGroup(['Sol Ring', 'Black Lotus']), lib), { names: ['Sol Ring'], copies: 1 });
        assert.strictEqual(resolveGroup(presetGroup('type', 'lands'), lib).copies, 36);
        assert.strictEqual(resolveGroup(emptyGroup(), lib).copies, 0);
        const manual = buildManualLibrary({ lands: 24 }, 60);
        assert.strictEqual(resolveGroup({ ...emptyGroup(true), count: 70 }, manual).copies, 60);
        assert.strictEqual(resolveGroup(presetGroup('type', 'lands'), manual).copies, 24);
        assert.strictEqual(resolveGroup(presetGroup('role', 'ramp'), manual).copies, 0);
    });

    it('names groups automatically unless named', () => {
        assert.strictEqual(autoName(cardsGroup(['Sol Ring'])), 'Sol Ring');
        assert.strictEqual(autoName(cardsGroup(['Sol Ring', 'Arcane Signet'])), 'Sol Ring or Arcane Signet');
        assert.strictEqual(autoName(cardsGroup(['Sol Ring', 'Arcane Signet', 'Mind Stone'])), 'Sol Ring + 2 more');
        assert.strictEqual(autoName(presetGroup('role', 'wipe')), 'Board wipes');
        assert.strictEqual(autoName(emptyGroup(), 1), 'Group B');
        assert.strictEqual(groupName({ ...presetGroup('role', 'ramp'), name: '  Rocks ' }), 'Rocks');
    });

    it('cuts the library into Venn regions', () => {
        const resolved = [presetGroup('role', 'ramp'), presetGroup('type', 'creatures')].map(g => resolveGroup(g, lib));
        const { regions, union } = regionSizes(resolved, lib);
        const byMask = Object.fromEntries(regions.map(r => [r.mask, r.size]));
        assert.deepStrictEqual(byMask, { 1: 2, 2: 2, 3: 1 }); // Elves is in both
        assert.strictEqual(union, 5);
    });

    it('treats manual groups as separate cards', () => {
        const manual = buildManualLibrary({}, 60);
        const { regions, union } = regionSizes([{ names: [], copies: 4 }, { names: [], copies: 0 }, { names: [], copies: 6 }], manual);
        assert.deepStrictEqual(regions, [{ mask: 1, size: 4 }, { mask: 4, size: 6 }]);
        assert.strictEqual(union, 10);
    });
});

// ── analyzeOdds ──────────────────────────────────────────────────────────────

describe('analyzeOdds', () => {
    const lib = buildLibrary(commanderList(), { commanderName: 'The Commander', excludeCommander: true });

    it('returns nothing for empty groups', () => {
        const r = analyzeOdds({ library: lib, groups: [emptyGroup()] });
        assert.strictEqual(r.groups.length, 0);
        assert.strictEqual(r.turns.length, 0);
    });

    it('gives turn 0…10 with Commander draws', () => {
        const r = analyzeOdds({ library: lib, groups: [cardsGroup(['Sol Ring'])], format: FORMATS.commander });
        assert.strictEqual(r.N, 99);
        assert.strictEqual(r.turns.length, MAX_TURN + 1);
        r.turns.forEach(t => {
            assert.strictEqual(t.seen, cardsSeenByTurn(t.turn, { format: FORMATS.commander }));
            assert.ok(Math.abs(t.all - t.seen / 99) < 1e-12); // a 1-of: seen / N
            assert.ok(Math.abs(t.avg[0] - t.seen / 99) < 1e-12);
        });
    });

    it('single group matches drawTypeMin on the play and on the draw', () => {
        const list = { Bolt: card('Bolt', 4, { type: 'Instant', cmc: 1 }), Mountain: card('Mountain', 20, { type: 'Basic Land' }), X: card('X', 36, { type: 'Creature', cmc: 2 }) };
        const lib60 = buildLibrary(list);
        for (const onPlay of [true, false]) {
            const r = analyzeOdds({ library: lib60, groups: [presetGroup('type', 'lands', 3)], format: FORMATS.constructed, onPlay });
            r.turns.forEach(t => {
                const n = cardsSeenByTurn(t.turn, { format: FORMATS.constructed, onPlay });
                assert.ok(Math.abs(t.all - drawTypeMin(60, 20, n, 3)) < 1e-12);
            });
        }
        const play = analyzeOdds({ library: lib60, groups: [cardsGroup(['Bolt'])], format: FORMATS.constructed, onPlay: true });
        const draw = analyzeOdds({ library: lib60, groups: [cardsGroup(['Bolt'])], format: FORMATS.constructed, onPlay: false });
        assert.strictEqual(play.turns[1].seen, 7);
        assert.strictEqual(draw.turns[1].seen, 8);
        assert.ok(draw.turns[1].all > play.turns[1].all);
    });

    it('combines overlapping groups exactly (vs brute-force-checked DP) and flags overlaps', () => {
        const r = analyzeOdds({ library: lib, groups: [presetGroup('role', 'ramp'), presetGroup('type', 'creatures')] });
        assert.deepStrictEqual(r.overlaps, [{ name: 'Llanowar Elves', ids: ['A', 'B'] }]);
        // Inclusion–exclusion over the three regions: A-only 2, both 1, B-only 2.
        const N = 99;
        const miss = k => (n => choose(N - k, n) / choose(N, n));
        r.turns.forEach(t => {
            const n = t.seen;
            const expected = 1 - miss(3)(n) - miss(3)(n) + miss(5)(n);
            assert.ok(Math.abs(t.all - expected) < 1e-12, `turn ${t.turn}`);
            assert.ok(t.all <= Math.min(...t.each) + 1e-12);
        });
        assert.ok(r.reach50 === null || r.turns.length <= r.reach50 || r.turns[r.reach50].all >= 0.5);
    });

    it('marks impossible needs', () => {
        const r = analyzeOdds({ library: lib, groups: [cardsGroup(['Sol Ring'], 2)] });
        assert.strictEqual(r.impossible, true);
        assert.ok(r.turns.every(t => t.all === 0));
        assert.strictEqual(r.reach50, null);
    });

    it('handles a manual deck', () => {
        const manual = buildManualLibrary({ lands: 24 }, 60);
        const r = analyzeOdds({ library: manual, groups: [presetGroup('type', 'lands', 2), { ...emptyGroup(true), count: 4 }], format: FORMATS.constructed });
        assert.strictEqual(r.groups.length, 2);
        assert.ok(r.turns[3].all > 0 && r.turns[3].all < r.turns[3].each[1]);
    });

    it('searches past the chart for the 90% turn', () => {
        const r = analyzeOdds({ library: lib, groups: [cardsGroup(['Sol Ring'])] });
        // A 1-of in 99 needs ~89 cards seen to hit 90%; never within 20 turns.
        assert.strictEqual(r.reach90, null);
        assert.ok(SEARCH_TURN >= MAX_TURN);
    });
});

// ── Words ────────────────────────────────────────────────────────────────────

describe('describeGroup / summarize', () => {
    const lib = buildLibrary(commanderList(), { commanderName: 'The Commander', excludeCommander: true });

    it('describes groups the way players say them', () => {
        const one = g => describeGroup(analyzeOdds({ library: lib, groups: [g] }).groups[0]);
        assert.match(one(cardsGroup(['Sol Ring', 'Arcane Signet'])), /data-card="Sol Ring".* or .*data-card="Arcane Signet"/);
        assert.strictEqual(one(presetGroup('role', 'wipe')), 'a board wipe');
        assert.strictEqual(one(presetGroup('type', 'lands', 3)), '3 lands');
        assert.match(one(cardsGroup(['Forest'], 2)), /^2 copies of <span class="card-ref" data-card="Forest"/);
        assert.match(one(cardsGroup(['Forest'])), /^a copy of /);
        assert.strictEqual(one(cardsGroup(['Sol Ring', 'Arcane Signet', 'Grizzly Bears', 'Wrath of God'])), 'one of the 4 cards in group A');
        assert.strictEqual(one({ ...presetGroup('role', 'ramp'), name: 'My <rocks>' }), 'a card from “My &lt;rocks&gt;”');
    });

    it('writes the bottom line from the numbers', () => {
        const r = analyzeOdds({ library: lib, groups: [cardsGroup(['Sol Ring', 'Arcane Signet'])] });
        const { html, tone } = summarize(r, 2);
        const p = r.turns[2].all;
        assert.ok(html.startsWith(`You have ${/^8|^1[18]%/.test(formatPct(p)) ? 'an' : 'a'} <strong>${formatPct(p)}</strong> chance to have `), html);
        assert.match(html, /in hand by turn 2\./);
        assert.strictEqual(tone, p >= 0.8 ? 'good' : p >= 0.5 ? 'flat' : 'warn');
        assert.match(summarize(r, 0).html, /in your opening hand\./);
    });

    it('names the bottleneck for several groups', () => {
        const r = analyzeOdds({ library: lib, groups: [presetGroup('type', 'lands', 2), presetGroup('role', 'wipe')] });
        const { html } = summarize(r, 6);
        assert.match(html, /2 lands and a board wipe in hand by turn 6/);
        assert.match(html, /The hard part is a board wipe: <strong>\d+%<\/strong> on its own/);
    });

    it('says when a need is impossible', () => {
        const r = analyzeOdds({ library: lib, groups: [cardsGroup(['Sol Ring'], 3)] });
        const { html, tone } = summarize(r, 3);
        assert.strictEqual(tone, 'bad');
        assert.match(html, /never draw <strong>3<\/strong>/);
    });

    it('has a neutral prompt with no groups', () => {
        assert.strictEqual(summarize(analyzeOdds({ library: lib, groups: [] }), 3).tone, 'flat');
    });

    it('formats chances honestly', () => {
        assert.strictEqual(formatPct(0), '0%');
        assert.strictEqual(formatPct(0.004), '<1%');
        assert.strictEqual(formatPct(0.996), '>99%');
        assert.strictEqual(formatPct(1), '100%');
        assert.strictEqual(formatPct(0.784), '78%');
        assert.strictEqual(turnLabel(0), 'Opening hand');
        assert.strictEqual(normalizeName('Æther  Vial'), 'aether vial');
        assert.strictEqual(normalizeName('Lim-Dûl’s Vault'), 'lim duls vault');
    });
});

describe('suggestExamples', () => {
    it('offers Commander staples first', () => {
        const lib = buildLibrary(commanderList(), { commanderName: 'The Commander', excludeCommander: true });
        const s = suggestExamples(lib, FORMATS.commander);
        assert.deepStrictEqual(s.map(x => x.label), ['Your ramp by turn 2', 'A board wipe by turn 6', 'Any of your 2-drops by turn 2']);
        s.forEach(x => assert.ok(resolveGroup(x.group, lib).copies > 0));
    });

    it('leads with the most-played spell in 60-card decks', () => {
        const lib = buildLibrary({
            'Lightning Bolt': card('Lightning Bolt', 4, { type: 'Instant', cmc: 1, text: 'Lightning Bolt deals 3 damage to any target.' }),
            'Goblin Guide': card('Goblin Guide', 4, { type: 'Creature — Goblin', cmc: 1 }),
            Mountain: card('Mountain', 20, { type: 'Basic Land — Mountain' })
        });
        const s = suggestExamples(lib, FORMATS.constructed);
        assert.strictEqual(s.length, 3);
        assert.strictEqual(s[0].label, 'Goblin Guide by turn 2');
        assert.strictEqual(s[1].group.key, 'le2');
    });

    it('works from manual counts', () => {
        const s = suggestExamples(buildManualLibrary({ lands: 36, creatures: 30, instants: 10 }, 99));
        assert.deepStrictEqual(s.map(x => x.turn), [0, 2, 3]);
        assert.deepStrictEqual(suggestExamples(buildManualLibrary({}, 0)), []);
    });
});

// ── Share links ──────────────────────────────────────────────────────────────

describe('encodeGroup / decodeGroup', () => {
    it('round-trips every kind', () => {
        const groups = [
            cardsGroup(['Sol Ring', 'Fire // Ice'], 2, 'Fast mana'),
            presetGroup('role', 'wipe'),
            presetGroup('mv', 'le2', 3),
            { ...emptyGroup(true), count: 12, name: 'Ramp' }
        ];
        for (const g of groups) {
            const back = decodeGroup(encodeGroup(g));
            assert.strictEqual(back.kind, g.kind);
            assert.strictEqual(back.need, g.need);
            assert.strictEqual(back.name, g.name);
            assert.deepStrictEqual(back.cards, g.cards);
            if (g.kind === 'manual') assert.strictEqual(back.count, 12);
            if (g.key) assert.strictEqual(back.key, g.key);
        }
        assert.strictEqual(encodeGroup(presetGroup('role', 'ramp')), '1~~r:ramp');
    });

    it('skips empty groups', () => {
        assert.strictEqual(encodeGroup(emptyGroup()), null);
        assert.strictEqual(encodeGroup({ ...emptyGroup(true), count: 0 }), null);
        assert.strictEqual(encodeGroup(null), null);
    });

    it('rejects and clamps hostile input', () => {
        assert.strictEqual(decodeGroup(''), null);
        assert.strictEqual(decodeGroup('1~x'), null);
        assert.strictEqual(decodeGroup('abc~~r:ramp'), null);
        assert.strictEqual(decodeGroup('1~~r:nuke'), null);
        assert.strictEqual(decodeGroup('1~~z:ramp'), null);
        assert.strictEqual(decodeGroup('1~~c:'), null);
        assert.strictEqual(decodeGroup('1~~n:-4'), null);
        assert.strictEqual(decodeGroup('x'.repeat(5000)), null);
        assert.strictEqual(decodeGroup('99~~r:ramp').need, MAX_NEED);
        assert.strictEqual(decodeGroup('0~~r:ramp').need, 1);
        const long = decodeGroup(`1~${'n'.repeat(200)}~c:${Array.from({ length: 100 }, (_, i) => `Card ${i}`).join('|')}`);
        assert.strictEqual(long.name.length, 40);
        assert.strictEqual(long.cards.length, 60);
        assert.strictEqual(decodeGroup('1~<b>~t:lands').name, '<b>'); // escaped at render time
    });
});
