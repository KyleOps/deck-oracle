import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';

import {
    VORTEX_COST, findBigCreatures, discoverPool, analyzeVortex, pointAt,
    chainPhrase, summarize, drawSamples, calculate, vortexDots
} from '../../js/calculators/vortex.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

/** A card in the simulation-deck shape (buildDeckFromCardData). */
const card = (name, cmc, types, power) => ({ name, cmc, types, power, toughness: power, type_line: types.join(' ') });
const land = (i) => card(`Forest ${i}`, 0, ['land']);
const spell = (name, cmc) => card(name, cmc, ['sorcery']);
const beast = (name, cmc, power) => card(name, cmc, ['creature'], String(power));

/**
 * The deck the old Vortex test used. Casting Big Dino (6) discovers 6 from
 * {Chain Dino 5/5 at 5, Small Dino 4/4 at 4, Tiny Spell at 1} plus lands.
 *
 * Exact answer, drawing WITHOUT replacement (each card exists once):
 *   Tiny  (1/3): 1 mana, 1 spell
 *   Small (1/3): 4 mana, 1 spell
 *   Chain (1/3): 5 mana, then discover 5 from {Small, Tiny} → 2.5 more; 2 spells
 *   mean mana = (1 + 4 + 7.5) / 3 = 4.1667, mean spells = 4/3
 *
 * The old recursion let Chain Dino discover itself again and reported 5.0.
 */
function dinoLibrary() {
    return [
        beast('Big Dino', 6, 5), beast('Chain Dino', 5, 5), beast('Small Dino', 4, 4),
        spell('Tiny Spell', 1), land(1), land(2), land(3), land(4), land(5), land(6)
    ];
}

describe('findBigCreatures', () => {
    it('lists each power-5+ creature once, with its copies, by mana value', () => {
        const lib = [beast('B', 7, 6), beast('A', 5, 5), beast('A', 5, 5), beast('Small', 2, 2), spell('S', 5)];
        const big = findBigCreatures(lib);
        assert.deepStrictEqual(big.map(c => [c.name, c.cmc, c.count]), [['A', 5, 2], ['B', 7, 1]]);
    });

    it('follows the star-power reading', () => {
        const lib = [beast('Star', 4, '*')];
        assert.strictEqual(findBigCreatures(lib, false).length, 0);
        assert.strictEqual(findBigCreatures(lib, true)[0].variable, true);
    });
});

describe('discoverPool', () => {
    it('counts nonlands at or under the discover size, minus the creature being cast', () => {
        const pool = discoverPool(dinoLibrary(), 6, 'Big Dino');
        assert.strictEqual(pool.total, 3);
        assert.strictEqual(pool.chainers, 2 - 1); // Chain Dino only; Small Dino has power 4
        assert.deepStrictEqual(pool.groups.map(g => g.mv), [5, 4, 1]);
    });
});

describe('analyzeVortex', () => {
    it('discovers without replacement: a chaining creature is found once, not forever', () => {
        const a = analyzeVortex(dinoLibrary(), { runs: 6000 });
        const big = a.creatures.find(c => c.name === 'Big Dino');
        assertClose(big.stats.avgMana, 12.5 / 3, 'average free mana', 0.15);
        assertClose(big.stats.avgSpells, 4 / 3, 'average spells', 0.05);
    });

    it('stays finite when every eligible card chains at the same mana value', () => {
        // The old recursion divided by zero here and multiplied by 100.
        const lib = [beast('Caster', 6, 6), beast('Only', 5, 5), land(1)];
        const a = analyzeVortex(lib, { runs: 200 });
        const caster = a.creatures.find(c => c.name === 'Caster');
        assert.strictEqual(caster.stats.avgMana, 5);
        assert.strictEqual(caster.stats.avgSpells, 1);
    });

    it('is reproducible: the same deck gives the same numbers every time', () => {
        const a = analyzeVortex(dinoLibrary(), { runs: 500 });
        const b = analyzeVortex(dinoLibrary(), { runs: 500 });
        assert.deepStrictEqual(a.creatures.map(c => c.stats.avgMana), b.creatures.map(c => c.stats.avgMana));
    });

    it('covers at least mana values 3 to 10, and reuses a creature’s result at its mana value', () => {
        const a = analyzeVortex(dinoLibrary(), { runs: 200 });
        assert.strictEqual(a.minMV, 3);
        assert.strictEqual(a.maxMV, 10);
        const six = a.byMV.find(r => r.mv === 6);
        assert.strictEqual(six.castName, 'Big Dino');
        assert.strictEqual(six.stats, a.creatures.find(c => c.name === 'Big Dino').stats);
    });

    it('weights the deck average by copies', () => {
        const lib = [beast('A', 5, 5), beast('A', 5, 5), beast('B', 9, 9), spell('One', 1), spell('Nine', 9)];
        const a = analyzeVortex(lib, { runs: 400 });
        const [A, B] = [a.creatures.find(c => c.name === 'A'), a.creatures.find(c => c.name === 'B')];
        assertClose(a.avgMana, (2 * A.stats.avgMana + B.stats.avgMana) / 3, 'weighted average', 1e-9);
    });

    it('notes variable-power creatures the current reading leaves out', () => {
        const a = analyzeVortex([beast('Star', 4, '*'), spell('S', 1)], { runs: 50 });
        assert.strictEqual(a.creatures.length, 0);
        assert.strictEqual(a.starSkipped, 1);
    });
});

describe('pointAt', () => {
    it('clamps into the analysed range', () => {
        const a = analyzeVortex(dinoLibrary(), { runs: 50 });
        assert.strictEqual(pointAt(a, 1).mv, 3);
        assert.strictEqual(pointAt(a, 40).mv, 10);
        assert.strictEqual(pointAt(a, 7).mv, 7);
        assert.strictEqual(pointAt(null, 6), null);
    });
});

describe('chainPhrase', () => {
    it('describes chain frequency in words', () => {
        assert.ok(/Nothing it can find/.test(chainPhrase(0)));
        assert.ok(/rare/.test(chainPhrase(0.005)));
        assert.ok(/1 trigger in 8/.test(chainPhrase(0.125)));
        assert.ok(/60%/.test(chainPhrase(0.6)));
    });
});

describe('summarize', () => {
    it('asks for a decklist when there is no library', () => {
        assert.strictEqual(summarize(analyzeVortex([])).tone, 'flat');
        assert.strictEqual(summarize(null).tone, 'flat');
    });

    it('says Vortex never triggers without big creatures, and points at the star setting', () => {
        const s = summarize(analyzeVortex([beast('Star', 4, '*'), spell('S', 1)], { runs: 50 }));
        assert.strictEqual(s.tone, 'bad');
        assert.ok(/never triggers/.test(s.html), s.html);
        assert.ok(/Count \* power/.test(s.html), s.html);
    });

    it('quotes the average and the range across big creatures, with card links', () => {
        const a = analyzeVortex(dinoLibrary(), { runs: 500 });
        const s = summarize(a);
        assert.ok(/Your <strong>2 big creatures<\/strong>/.test(s.html), s.html);
        assert.ok(s.html.includes('data-card="Chain Dino"') && s.html.includes('data-card="Big Dino"'), s.html);
        assert.ok(/chains? /.test(s.html), s.html);
    });

    it('rates against Vortex’s own cost, and warns when there are few big creatures', () => {
        const lib = [beast('Huge', 10, 10), beast('Huge 2', 10, 10), beast('Huge 3', 10, 10), beast('Huge 4', 10, 10)];
        for (let i = 0; i < 20; i++) lib.push(spell(`Seven ${i}`, 7));
        const a = analyzeVortex(lib, { runs: 300 });
        assert.ok(a.avgMana >= VORTEX_COST);
        assert.strictEqual(summarize(a).tone, 'good');

        const few = analyzeVortex([beast('Huge', 10, 10), ...lib.slice(4)], { runs: 300 });
        const s = summarize(few);
        assert.strictEqual(s.tone, 'warn');
        assert.ok(/will not trigger often/.test(s.html), s.html);
    });

    it('names a lone big creature directly', () => {
        const s = summarize(analyzeVortex([beast('Solo', 6, 6), spell('S', 2)], { runs: 100 }));
        assert.ok(/Your only big creature/.test(s.html), s.html);
    });
});

describe('drawSamples', () => {
    it('lists what each discover passed over and what it hit', () => {
        const samples = drawSamples(dinoLibrary(), 6, { castName: 'Big Dino', count: 20 });
        assert.strictEqual(samples.length, 20);
        for (const sample of samples) {
            assert.ok(sample.steps.length >= 1);
            const first = sample.steps[0];
            assert.strictEqual(first.discoverCMC, 6);
            // Discover 6 can hit every nonland here, so it only ever passes lands.
            assert.ok(first.passed.every(c => c.types.includes('land')));
            assert.ok(sample.steps.every(s => !s.hit || s.hit.name !== 'Big Dino'), 'the cast creature is never found');
        }
    });

    it('is stable for a round and changes with the next one', () => {
        const names = (round) => drawSamples(dinoLibrary(), 6, { castName: 'Big Dino', count: 8, round })
            .map(s => s.steps.map(t => t.hit?.name).join('>')).join('|');
        assert.strictEqual(names(0), names(0));
        assert.notStrictEqual(names(0), names(1));
    });
});

describe('calculate', () => {
    it('reads the shared deck and caches the analysis between renders', () => {
        DeckConfig.updateDeck({
            cardsByName: {
                'Big Dino': { name: 'Big Dino', type_line: 'Creature — Dinosaur', cmc: 6, power: '5', toughness: '5', count: 1 },
                'Tiny Spell': { name: 'Tiny Spell', type_line: 'Sorcery', cmc: 1, count: 1 },
                Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 6 }
            }
        });
        const first = calculate();
        const second = calculate();
        assert.strictEqual(first.analysis, second.analysis, 'no re-simulation when nothing changed');
        assert.strictEqual(first.analysis.creatures[0].name, 'Big Dino');
        assert.strictEqual(first.point.mv, 6);
    });
});

describe('vortexDots (out of 100 triggers)', () => {
    it('splits triggers into nothing, smaller than Vortex, and at least its cost', () => {
        const manaDist = [10, 0, 30, 0, VORTEX_COST === 4 ? 40 : 0, 20];
        const dots = vortexDots(manaDist);
        assert.strictEqual(dots.length, 100);
        assert.strictEqual(dots.filter(d => d.tone === 'bad').length, 10);
        assert.strictEqual(dots.filter(d => d.tone === 'flat').length, 30);
        assert.strictEqual(dots.filter(d => d.tone === 'good').length, 60);
    });

    it('is empty without a distribution', () => {
        assert.deepStrictEqual(vortexDots([]), []);
        assert.deepStrictEqual(vortexDots(undefined), []);
    });
});
