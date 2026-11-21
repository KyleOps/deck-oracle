import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, hashString, shuffle, shuffled, partialShuffle } from '../../js/utils/random.js';

/** The Fisher–Yates every page used to write inline (chimil, lands, mulligan, discover, handLab, manaDevelopment). */
function legacyShuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** simulation.partialShuffle before it took an rng. */
function legacyPartial(deck, count, deckSize, rng) {
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(rng() * (deckSize - i));
        const temp = deck[i];
        deck[i] = deck[j];
        deck[j] = temp;
    }
    return deck;
}

const range = n => Array.from({ length: n }, (_, i) => i);

describe('mulberry32', () => {
    it('is deterministic per seed and uniform in [0, 1)', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        const c = mulberry32(43);
        const xs = range(1000).map(() => a());
        assert.deepEqual(xs, range(1000).map(() => b()));
        assert.notDeepEqual(xs.slice(0, 5), range(5).map(() => c()));
        assert.ok(xs.every(x => x >= 0 && x < 1));
        const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
        assert.ok(Math.abs(mean - 0.5) < 0.05);
    });

    it('matches the published mulberry32 sequence (unchanged from the three page copies)', () => {
        const rng = mulberry32(1);
        assert.equal(rng(), 0.6270739405881613);
        assert.equal(rng(), 0.002735721180215478);
    });
});

describe('hashString', () => {
    it('is FNV-1a 32-bit', () => {
        assert.equal(hashString(''), 0x811c9dc5);
        assert.equal(hashString('a'), 0xe40c292c);
        assert.equal(hashString('foobar'), 0xbf9cf968);
    });

    it('treats null and undefined as empty, stringifies the rest', () => {
        assert.equal(hashString(null), hashString(''));
        assert.equal(hashString(undefined), hashString(''));
        assert.equal(hashString(12), hashString('12'));
    });
});

describe('shuffle', () => {
    it('is the same permutation as the inline copies it replaced, for the same seed', () => {
        for (const n of [0, 1, 2, 7, 99, 100]) {
            const mine = shuffle(range(n), mulberry32(n + 5));
            const theirs = legacyShuffle(range(n), mulberry32(n + 5));
            assert.deepEqual(mine, theirs, `n=${n}`);
        }
    });

    it('shuffles in place and returns the array; defaults to Math.random', () => {
        const arr = range(50);
        assert.equal(shuffle(arr), arr);
        assert.deepEqual([...arr].sort((a, b) => a - b), range(50));
    });

    it('works on typed arrays', () => {
        const arr = Int32Array.from(range(20));
        shuffle(arr, mulberry32(3));
        assert.deepEqual([...arr].sort((a, b) => a - b), range(20));
    });

    it('is roughly uniform', () => {
        const rng = mulberry32(9);
        const firsts = [0, 0, 0, 0];
        for (let i = 0; i < 8000; i++) firsts[shuffle([0, 1, 2, 3], rng)[0]]++;
        firsts.forEach(n => assert.ok(Math.abs(n - 2000) < 200, String(firsts)));
    });
});

describe('shuffled', () => {
    it('returns a new shuffled array and leaves the input alone', () => {
        const input = range(30);
        const out = shuffled(input, mulberry32(4));
        assert.deepEqual(input, range(30));
        assert.notEqual(out, input);
        assert.deepEqual(out, legacyShuffle(range(30), mulberry32(4)));
    });

    it('accepts iterables and nothing', () => {
        assert.deepEqual(shuffled(null), []);
        assert.deepEqual(shuffled(new Set([1])), [1]);
    });
});

describe('partialShuffle', () => {
    it('draws the same top cards as the old helper for the same seed', () => {
        const mine = partialShuffle(range(99), 10, 99, mulberry32(11));
        const theirs = legacyPartial(range(99), 10, 99, mulberry32(11));
        assert.deepEqual(mine, theirs);
    });

    it('defaults size to the array length and never draws past it', () => {
        const arr = partialShuffle(range(5), 50, undefined, mulberry32(2));
        assert.deepEqual([...arr].sort((a, b) => a - b), range(5));
    });

    it('only draws from the first `size` cards', () => {
        const arr = partialShuffle(range(10), 3, 4, mulberry32(8));
        assert.ok(arr.slice(0, 3).every(x => x < 4));
        assert.deepEqual(arr.slice(4), [4, 5, 6, 7, 8, 9]);
    });
});
