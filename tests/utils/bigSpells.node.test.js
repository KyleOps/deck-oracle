import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assertClose } from '../node-test-helper.js';
import {
    avg, barsHTML, cardListKey, cardTypesOf, chanceTone, createSampler, deckCardList, expandCards, fade,
    hypergeometricPmf, isPermanentTypeLine, pct, plural, points, pointsShort, quantileOf, sampleCardHTML,
    sharedStyles, xControlHTML
} from '../../js/utils/bigSpells.js';

describe('Big spell helpers — maths', () => {
    it('gives an exact hypergeometric distribution', () => {
        const pmf = hypergeometricPmf(60, 20, 7);
        assert.strictEqual(pmf.length, 8);
        assertClose(pmf.reduce((a, b) => a + b, 0), 1, 'sums to one');
        assertClose(pmf.reduce((s, p, k) => s + p * k, 0), 7 * 20 / 60, 'mean is nK/N');
        // P(0 hits) = C(40,7)/C(60,7)
        let p0 = 1;
        for (let i = 0; i < 7; i++) p0 *= (40 - i) / (60 - i);
        assertClose(pmf[0], p0, 'P(0)', 1e-12);
    });

    it('handles impossible and certain draws', () => {
        assert.deepStrictEqual(hypergeometricPmf(10, 10, 3), [0, 0, 0, 1]);
        assert.deepStrictEqual(hypergeometricPmf(10, 0, 3), [1, 0, 0, 0]);
        assert.deepStrictEqual(hypergeometricPmf(0, 0, 5), [1]);
    });

    it('reads quantiles off a distribution', () => {
        const pmf = [0.1, 0.2, 0.4, 0.3];
        assert.strictEqual(quantileOf(pmf, 0.1), 0);
        assert.strictEqual(quantileOf(pmf, 0.5), 2);
        assert.strictEqual(quantileOf(pmf, 0.9), 3);
    });
});

describe('Big spell helpers — formatting', () => {
    it('never rounds a possible result to 0% or an uncertain one to 100%', () => {
        assert.strictEqual(pct(0), '0%');
        assert.strictEqual(pct(0.001), '<1%');
        assert.strictEqual(pct(0.736), '74%');
        assert.strictEqual(pct(0.996), '>99%');
        assert.strictEqual(pct(1), '100%');
        assert.strictEqual(pct(NaN), '—');
    });

    it('formats averages, changes and plurals in plain words', () => {
        assert.strictEqual(avg(4.04), '4.0');
        assert.strictEqual(avg(-0.01), '0.0');
        assert.strictEqual(points(0.086), '+9 points');
        assert.strictEqual(points(-0.01), '−1 point');
        assert.strictEqual(points(0.001), 'no change');
        assert.strictEqual(pointsShort(0.21), '+21 pts');
        assert.strictEqual(plural(1, 'card'), '1 card');
        assert.strictEqual(plural(2, 'instant or sorcery', 'instants and sorceries'), '2 instants and sorceries');
    });

    it('maps chances to tones', () => {
        assert.strictEqual(chanceTone(0.8), 'good');
        assert.strictEqual(chanceTone(0.5), 'warn');
        assert.strictEqual(chanceTone(0.1), 'bad');
        assert.strictEqual(chanceTone(undefined), 'flat');
    });

    it('fades theme colours for chart fills', () => {
        assert.strictEqual(fade('#55c97f', 0.5), 'rgba(85, 201, 127, 0.5)');
        assert.strictEqual(fade('rgb(10, 20, 30)', 0.2), 'rgba(10, 20, 30, 0.2)');
    });
});

describe('Big spell helpers — deck', () => {
    it('reads card types from the front face', () => {
        assert.deepStrictEqual(cardTypesOf('Artifact Creature — Golem'), ['creature', 'artifact']);
        assert.strictEqual(isPermanentTypeLine('Legendary Land'), true);
        assert.strictEqual(isPermanentTypeLine('Kindred Instant — Elf'), false);
    });

    it('ignores a stale card list once counts are edited by hand', () => {
        const cardsByName = { Forest: { name: 'Forest', type_line: 'Land', cmc: 0, count: 3 }, Gone: { name: 'Gone', type_line: 'Instant', count: 0 } };
        assert.strictEqual(deckCardList({ cardsByName, importSource: 'moxfield' }).length, 1, 'zero-count cards are dropped');
        assert.deepStrictEqual(deckCardList({ cardsByName, importSource: 'manual' }), []);
    });

    it('keys a card list by content, not order', () => {
        const a = [{ name: 'A', type_line: 'Land', cmc: 0, count: 2 }, { name: 'B', type_line: 'Creature', cmc: 3, count: 1 }];
        assert.strictEqual(cardListKey(a), cardListKey([...a].reverse()));
        assert.notStrictEqual(cardListKey(a), cardListKey([{ ...a[0], count: 3 }, a[1]]));
    });

    it('expands counts into cards and keeps sample shuffles until asked', () => {
        const cards = [{ name: 'A', type_line: 'Land', cmc: 0, count: 5 }, { name: 'B', type_line: 'Creature', cmc: 2, count: 5 }];
        const library = expandCards(cards);
        assert.strictEqual(library.length, 10);
        assert.deepStrictEqual(library[9].types, ['creature']);

        const sampler = createSampler(3);
        const first = sampler.get('deck-1', () => library);
        assert.strictEqual(first.length, 3);
        assert.strictEqual(sampler.get('deck-1', () => library), first, 'stable while the deck is unchanged');
        assert.notStrictEqual(sampler.get('deck-2', () => library), first, 'new deck, new shuffles');
        const again = sampler.get('deck-2', () => library);
        sampler.reshuffle();
        assert.notStrictEqual(sampler.get('deck-2', () => library), again, 'reshuffle draws new ones');
    });
});

describe('Big spell helpers — markup', () => {
    it('keeps the X input ids share links and registerCalculator rely on', () => {
        const html = xControlHTML({ key: 'wave', value: 7, max: 30, presets: [5, 7] });
        assert.match(html, /id="wave-xSlider"/);
        assert.match(html, /id="wave-xValue"/);
        assert.match(html, /data-x="5"/);
    });

    it('escapes card names in samples and scales bars', () => {
        const html = sampleCardHTML({ title: 'Shuffle 1', tag: 'Free spell', tone: 'good', rows: [{ name: '<b>Evil</b>', type: 'land', fate: 'hand' }, { more: '+ 3 more' }] });
        assert.doesNotMatch(html, /<b>Evil/);
        assert.match(html, /\+ 3 more/);
        assert.match(barsHTML([{ label: 'x', value: 0.5 }], { scale: 0.5 }), /width:100\.0%/);
    });

    it('scopes every shared style rule to one page', () => {
        const css = sharedStyles('#wave-tab');
        const selectors = css.split('}').map(rule => rule.split('{')[0].trim()).filter(s => s && !s.startsWith('@') && !s.startsWith('/*'));
        selectors.forEach(selector => {
            selector.split(',').forEach(part => {
                const s = part.trim().replace(/^\/\*.*?\*\/\s*/s, '');
                if (s) assert.match(s, /^#wave-tab /, `unscoped selector: ${s}`);
            });
        });
        assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b(?!-tab)/i, 'no hard-coded hex colours');
    });
});
