import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseManaCost, colorRequirements, isLand, landColors, deckColorIdentity, renderManaCost } from '../../js/utils/mana.js';

describe('parseManaCost', () => {
    it('splits generic, coloured and X symbols', () => {
        const p = parseManaCost('{X}{G}{G}{G}');
        assert.equal(p.x, 1);
        assert.equal(p.generic, 0);
        assert.deepEqual(p.pips, { W: 0, U: 0, B: 0, R: 0, G: 3 });
        assert.equal(p.total, 3);
    });

    it('keeps hybrid and phyrexian symbols out of strict pips', () => {
        const p = parseManaCost('{5}{U/B}{U/B}{G/P}');
        assert.equal(p.generic, 5);
        assert.deepEqual(p.hybrid, [['U', 'B'], ['U', 'B']]);
        assert.deepEqual(p.phyrexian, ['G']);
        assert.equal(p.pips.U + p.pips.B + p.pips.G, 0);
    });

    it('treats twobrid as a hybrid choice and colourless as its own pip', () => {
        const p = parseManaCost('{2/W}{C}{C}');
        assert.deepEqual(p.hybrid, [['W']]);
        assert.equal(p.colorless, 2);
    });

    it('reads only the front face of a split cost', () => {
        assert.deepEqual(colorRequirements('{1}{U} // {3}{R}{R}'), { U: 1 });
    });

    it('returns an empty cost for missing input', () => {
        assert.equal(parseManaCost(undefined).total, 0);
        assert.equal(parseManaCost('').total, 0);
    });
});

describe('isLand', () => {
    it('uses the category or the front-face type line', () => {
        assert.equal(isLand({ category: 'lands' }), true);
        assert.equal(isLand({ type_line: 'Basic Land — Forest' }), true);
        assert.equal(isLand({ type_line: 'Creature — Elf // Land' }), false);
        assert.equal(isLand(null), false);
    });
});

describe('landColors', () => {
    const simic = ['U', 'G'];

    it('prefers Scryfall produced_mana when present', () => {
        assert.deepEqual(landColors({ type_line: 'Land', produced_mana: ['G', 'U', 'C'] }, simic), ['U', 'G']);
    });

    it('reads basic land types from the type line', () => {
        assert.deepEqual(landColors({ type_line: 'Land — Forest Island' }, simic), ['U', 'G']);
    });

    it('uses colour identity for duals without basic types', () => {
        assert.deepEqual(landColors({ type_line: 'Land', color_identity: ['G', 'U'] }, simic), ['U', 'G']);
    });

    it('clamps any-colour lands to the deck identity', () => {
        const tower = { type_line: 'Land', oracle_text: "{T}: Add one mana of any color in your commander's color identity." };
        assert.deepEqual(landColors(tower, simic), ['U', 'G']);
    });

    it('treats basic-fetching lands as sources of the deck colours', () => {
        const wilds = { type_line: 'Land', oracle_text: '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' };
        assert.deepEqual(landColors(wilds, ['R', 'G']), ['R', 'G']);
    });

    it('reads typed fetches', () => {
        const fetch = { type_line: 'Land', oracle_text: '{T}, Pay 1 life, Sacrifice Misty Rainforest: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.' };
        assert.deepEqual(landColors(fetch, ['W', 'U', 'B', 'R', 'G']), ['U', 'G']);
    });

    it('returns nothing for colourless utility lands', () => {
        assert.deepEqual(landColors({ type_line: 'Land', oracle_text: '{T}: Add {C}.', color_identity: [] }, simic), []);
    });
});

describe('deckColorIdentity', () => {
    it('unions identities and falls back to costs, ignoring empty lands', () => {
        const identity = deckColorIdentity({
            a: { name: 'Llanowar Elves', count: 1, color_identity: ['G'] },
            b: { name: 'Counterspell', count: 1, mana_cost: '{U}{U}' },
            c: { name: 'Wastes', count: 3, type_line: 'Basic Land' },
            d: { name: 'Cut card', count: 0, color_identity: ['R'] }
        });
        assert.deepEqual(identity, ['U', 'G']);
    });
});

describe('renderManaCost', () => {
    it('renders accessible symbols', () => {
        const html = renderManaCost('{2}{G}{U/B}');
        assert.match(html, /role="img"/);
        assert.match(html, /ms-g/);
        assert.match(html, /ms-ub/);
        assert.equal(renderManaCost(''), '');
    });
});
