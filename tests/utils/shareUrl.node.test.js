import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import LZString from 'lz-string';
import '../node-test-helper.js';
import { isAllowedDeckUrl, boundedNumber, decompressMullTypes, SLIDERS } from '../../js/utils/share.js';
import { CALCULATORS } from '../../js/utils/calculatorRegistry.js';
import { fuzzyScore } from '../../js/shell/palette.js';

describe('share link validation', () => {
    it('accepts only https Moxfield and Archidekt deck links', () => {
        assert.ok(isAllowedDeckUrl('https://moxfield.com/decks/abc'));
        assert.ok(isAllowedDeckUrl('https://www.archidekt.com/decks/123'));
        assert.equal(isAllowedDeckUrl('http://moxfield.com/decks/abc'), false);
        assert.equal(isAllowedDeckUrl('https://moxfield.com.evil.example/decks/abc'), false);
        assert.equal(isAllowedDeckUrl('javascript:alert(1)'), false);
        assert.equal(isAllowedDeckUrl('not a url'), false);
    });

    it('bounds numeric parameters', () => {
        assert.equal(boundedNumber('8', { min: 0, max: 30 }), 8);
        assert.equal(boundedNumber('8.5', { min: 0, max: 30 }), 8);
        assert.equal(boundedNumber('0.25', { min: 0, max: 1, float: true }), 0.25);
        assert.equal(boundedNumber('31', { min: 0, max: 30 }), null);
        assert.equal(boundedNumber('-1', { min: 0, max: 30 }), null);
        assert.equal(boundedNumber('abc', { min: 0, max: 30 }), null);
        assert.equal(boundedNumber(null, { min: 0, max: 30 }), null);
    });

    it('round-trips mulligan requirements and rejects tampered ones', () => {
        const types = [[1, 'Lands', 37, 3, 3, '55c97f'], [2, 'Ramp', 12, 1, 3, '']];
        const packed = LZString.compressToEncodedURIComponent(JSON.stringify(types));
        const out = decompressMullTypes(packed, LZString);
        assert.equal(out.length, 2);
        assert.equal(out[0].name, 'Lands');
        assert.equal(out[1].color, '#808b85');

        const bad = LZString.compressToEncodedURIComponent(JSON.stringify([[1, 'X', 999, 1, 1, '']]));
        assert.equal(decompressMullTypes(bad, LZString), null);
        const injected = LZString.compressToEncodedURIComponent(JSON.stringify([[1, 'X', 1, 1, 1, 'red;background:url(x)']]));
        assert.equal(decompressMullTypes(injected, LZString), null);
        assert.equal(decompressMullTypes('garbage', LZString), null);
    });

    it('only maps sliders onto real calculators', () => {
        SLIDERS.forEach(s => {
            assert.ok(CALCULATORS[s.tab], `${s.param} points at unknown tab ${s.tab}`);
            assert.ok(s.min <= s.max);
        });
        const params = SLIDERS.map(s => s.param);
        assert.equal(new Set(params).size, params.length, 'share params must be unique');
    });
});

describe('command palette fuzzy search', () => {
    it('ranks exact and prefix matches above subsequences', () => {
        const exact = fuzzyScore('genesis wave', 'Genesis Wave');
        const prefix = fuzzyScore('gen', 'Genesis Wave');
        const word = fuzzyScore('wave', 'Genesis Wave');
        const subseq = fuzzyScore('gw', 'Genesis Wave');
        assert.ok(exact > prefix && prefix > word && word > subseq && subseq > 0);
    });

    it('rejects strings that do not contain the query in order', () => {
        assert.equal(fuzzyScore('xyz', 'Genesis Wave'), 0);
        assert.equal(fuzzyScore('wg', 'Wild'), 0);
        assert.ok(fuzzyScore('', 'anything') > 0);
    });
});
