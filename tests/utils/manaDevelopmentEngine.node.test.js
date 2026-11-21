/**
 * The Mana Development goldfish engine against a frozen copy of the engine it
 * replaced (tests/fixtures/manaDevelopmentReference.js): the same library and
 * seed must give the same numbers, game for game — mana bands, reach odds, the
 * target's turns, every ramp card's cast/seen rates, the mulligan rate and the
 * sample games turn by turn. The rewrite only changed how fast it gets there.
 *
 * Decks cover every branch of the engine: rocks, dorks, auras, tapped / fast /
 * slow / check / karoo lands, land searches to the battlefield and to hand
 * with every filter, extra and one-off land drops, playing from the top,
 * sacrificing a land, Treasure on and off, play and draw, Commander, 60 and 40.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as MD from '../../js/utils/manaDevelopment.js';
import * as REF from '../fixtures/manaDevelopmentReference.js';
import { FORMATS } from '../../js/utils/format.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { medianMs } from '../helpers/timing.js';

const CARDS = JSON.parse(readFileSync(new URL('../fixtures/ramp-cards.json', import.meta.url), 'utf8'));
const FILLER = {
    Forest: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', color_identity: ['G'] },
    Island: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)', color_identity: ['U'] },
    Mountain: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)', color_identity: ['R'] },
    Dreadmaw: { name: 'Dreadmaw', mana_cost: '{4}{G}{G}', cmc: 6, type_line: 'Creature — Dinosaur', oracle_text: 'Trample' },
    Sphinx: { name: 'Sphinx', mana_cost: '{3}{U}{U}', cmc: 5, type_line: 'Creature — Sphinx', oracle_text: 'Flying' },
    Bear: { name: 'Bear', mana_cost: '{1}{G}', cmc: 2, type_line: 'Creature — Bear', oracle_text: '' },
    Shock: { name: 'Shock', mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' },
    Hydra: { name: 'Hydra', mana_cost: '{X}{G}{G}', cmc: 2, type_line: 'Creature — Hydra', oracle_text: '' },
    'Treasure Test': { name: 'Treasure Test', mana_cost: '{1}', cmc: 1, type_line: 'Sorcery', oracle_text: 'Create two Treasure tokens.' }
};

function deckOf(counts) {
    const out = {};
    for (const [name, count] of Object.entries(counts)) out[name] = { ...(CARDS[name] ?? FILLER[name]), name, count };
    return out;
}

const RAMPY = deckOf({
    'Breeding Pool': 6, Forest: 6, Island: 3, 'Simic Growth Chamber': 2, 'Hinterland Harbor': 3, 'Thornwood Falls': 2,
    'Botanical Sanctum': 2, 'Evolving Wilds': 2, 'Ancient Tomb': 1, 'Yavimaya Coast': 1,
    'Sol Ring': 1, 'Arcane Signet': 1, 'Simic Signet': 1, 'Llanowar Elves': 3, 'Birds of Paradise': 2, 'Utopia Sprawl': 1,
    Cultivate: 2, "Kodama's Reach": 1, 'Rampant Growth': 2, 'Explosive Vegetation': 1, 'Skyshroud Claim': 1, Farseek: 1,
    Harrow: 1, 'Three Visits': 1, 'Sylvan Scrying': 1, 'Burnished Hart': 1, 'Azusa, Lost but Seeking': 1, 'Oracle of Mul Daya': 1,
    Explore: 1, 'Growth Spiral': 1, 'Big Score': 1, 'Treasure Test': 2, 'Mana Vault': 1, 'Worn Powerstone': 1,
    Dreadmaw: 4, Sphinx: 3, Hydra: 2
});

const STOMPY = deckOf({
    Forest: 9, Mountain: 6, 'Rejuvenating Springs': 2, 'Mistrise Village': 2, 'Llanowar Elves': 4, 'Elvish Mystic': 4,
    'Wild Growth': 2, Overgrowth: 1, 'Priest of Titania': 2, Bear: 8, Shock: 4, Dreadmaw: 4, 'Courser of Kruphix': 2
});

const CASES = [
    ['the example Commander deck', () => MD.buildManaLibrary(DEFAULT_DECK_DATA), { format: FORMATS.commander }],
    ['the example deck with Treasure', () => MD.buildManaLibrary(DEFAULT_DECK_DATA), { format: FORMATS.commander, treasure: true, seed: 99 }],
    ['a ramp-heavy 60 on the play', () => MD.buildManaLibrary(RAMPY, { multiplayer: false }), { format: FORMATS.constructed, onPlay: true }],
    ['a ramp-heavy 60 on the draw with Treasure', () => MD.buildManaLibrary(RAMPY, { multiplayer: false }), { format: FORMATS.constructed, onPlay: false, treasure: true, seed: 7 }],
    ['a 40-card dork deck', () => MD.buildManaLibrary(STOMPY, { multiplayer: false }), { format: FORMATS.limited, seed: 2024 }],
    ['the ramp deck as Commander, one commander', () => MD.buildManaLibrary({ cardsByName: RAMPY, commanders: [{ name: 'Sphinx', card: FILLER.Sphinx }] }), { format: FORMATS.commander, seed: 31337 }],
    // Untracked searches (a library with more distinct searches than bits) scan the library instead.
    ['land searches without running counts', () => ({ ...MD.buildManaLibrary(RAMPY, { multiplayer: false }), searchSlot: null }), { format: FORMATS.constructed, seed: 11 }],
    ['bare type counts', () => MD.buildCountsLibrary({ lands: 36, creatures: 40, sorceries: 23 }), { format: FORMATS.commander }]
];

/** What the page reads from a result (the fields both engines produce). */
function project(r) {
    if (!r) return r;
    const t = r.target;
    return {
        games: r.games, lands: r.lands, librarySize: r.librarySize, placeholder: r.placeholder,
        rampCount: r.rampCount, notCounted: r.notCounted, treasure: r.treasure,
        mana: r.mana, landsOnly: r.landsOnly, reach: r.reach, reachLands: r.reachLands,
        mulliganRate: r.mulliganRate,
        ramp: r.ramp.map(x => ({ name: x.name, count: x.count, counted: x.counted, castBy3: x.castBy3, castBy4: x.castBy4, seenBy4: x.seenBy4 })),
        target: t ? { kind: t.kind, name: t.name, mv: t.mv, cost: t.cost, ramp: t.ramp, lands: t.lands, turnsSaved: t.turnsSaved } : null,
        samples: r.samples.map(g => ({
            hand: g.hand, mulligans: g.mulligans, targetTurn: g.targetTurn, landsOnlyTargetTurn: g.landsOnlyTargetTurn,
            turns: g.turns.map(e => ({ turn: e.turn, drew: e.drew, lands: e.lands, cast: e.cast, mana: e.mana, colors: e.colors, target: e.target, landsInPlay: e.landsInPlay }))
        }))
    };
}

describe('Mana Development engine matches the reference engine', () => {
    for (const [name, build, opts] of CASES) {
        it(name, () => {
            const lib = build();
            const games = 400;
            const live = MD.simulateManaDevelopment(lib, { ...opts, games, samples: 6 });
            const ref = REF.simulateManaDevelopment(lib, { ...opts, games, samples: 6 });
            assert.ok(ref, 'the reference plays the deck');
            assert.deepEqual(project(live), project(ref));
        });
    }

    it('in slices as in one go', () => {
        const lib = MD.buildManaLibrary(RAMPY, { multiplayer: false });
        const run = MD.createRun(lib, { format: FORMATS.constructed, games: 300, seed: 5 });
        while (!MD.runBatch(run, 23)) { /* keep going */ }
        assert.deepEqual(project(MD.finishRun(run)), project(REF.simulateManaDevelopment(lib, { format: FORMATS.constructed, games: 300, seed: 5 })));
    });

    it('scripted games', () => {
        const lib = MD.buildManaLibrary(RAMPY, { multiplayer: false });
        const cards = lib.cards;
        for (let s = 0; s < 6; s++) {
            // A fixed, varied order: every sixth card from a different start.
            const order = cards.map((_, i) => cards[(i * 7 + s * 13) % cards.length]);
            const hand = order.slice(0, 7);
            const library = order.slice(7);
            for (const rampOn of [true, false]) {
                const a = MD.playScriptedGame(lib, { hand, library, format: FORMATS.constructed, rampOn, treasure: s % 2 === 0 });
                const b = REF.playScriptedGame(lib, { hand, library, format: FORMATS.constructed, rampOn, treasure: s % 2 === 0 });
                assert.deepEqual(a.mana, b.mana);
                assert.equal(a.targetTurn, b.targetTurn);
                assert.deepEqual(a.log, b.log);
            }
        }
    });

    it('is at least 30% faster than the reference on the example deck', () => {
        const lib = MD.buildManaLibrary(DEFAULT_DECK_DATA);
        const opts = { format: FORMATS.commander, games: 2000 };
        const live = medianMs(() => MD.simulateManaDevelopment(lib, opts), 5);
        const ref = medianMs(() => REF.simulateManaDevelopment(lib, opts), 5);
        assert.ok(live <= ref * 0.7, `live ${live.toFixed(1)} ms vs reference ${ref.toFixed(1)} ms`);
    });
});
