/**
 * Randomness the simulations share: one seeded generator, one string hash for
 * deriving seeds and cache keys, and one Fisher–Yates.
 *
 * Every generator here is a function `() => number` uniform in [0, 1), so
 * `Math.random` and `mulberry32(seed)` are interchangeable. Seeding makes a
 * page's numbers a property of the deck rather than of the moment: revisit the
 * page and nothing shuffles under you.
 */

/**
 * Small, fast seeded PRNG (mulberry32).
 * @param {number} seed - any number; only its low 32 bits matter
 * @returns {() => number} uniform in [0, 1)
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 32-bit FNV-1a hash of a string (UTF-16 code units), for seeds and short keys.
 * @param {*} text - stringified; null and undefined hash as ''
 * @returns {number} unsigned 32-bit
 */
export function hashString(text) {
    let h = 0x811c9dc5;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Fisher–Yates shuffle, in place.
 * @template T
 * @param {T[]} array - shuffled in place (typed arrays work too)
 * @param {() => number} [rng=Math.random]
 * @returns {T[]} the same array
 */
export function shuffle(array, rng = Math.random) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = array[i];
        array[i] = array[j];
        array[j] = t;
    }
    return array;
}

/**
 * A shuffled copy; the input is not touched.
 * @template T
 * @param {T[]} array
 * @param {() => number} [rng=Math.random]
 * @returns {T[]}
 */
export function shuffled(array, rng = Math.random) {
    return shuffle(Array.isArray(array) ? array.slice() : Array.from(array ?? []), rng);
}

/**
 * Shuffle only the first `count` positions (a partial Fisher–Yates): after it,
 * positions 0…count-1 hold a uniform random draw of `count` cards from the
 * first `size`. Cheaper than a full shuffle when only the top matters.
 * @param {Array|TypedArray} array - modified in place
 * @param {number} count - cards to draw
 * @param {number} [size=array.length] - how much of the array is the library
 * @param {() => number} [rng=Math.random]
 * @returns {Array|TypedArray} the same array
 */
export function partialShuffle(array, count, size = array.length, rng = Math.random) {
    const n = Math.min(count, size);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng() * (size - i));
        const t = array[i];
        array[i] = array[j];
        array[j] = t;
    }
    return array;
}
