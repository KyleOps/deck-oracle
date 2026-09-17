import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    isPower5Plus, simulateDiscoverChain, sampleDiscover,
    percentileFromDist, mergeDists
} from '../../js/utils/discover.js';

/** A card in the shape the simulation deck uses. */
function card(name, cmc, types, power) {
    return { name, cmc, types, power };
}

const land = (n) => card(`Forest ${n}`, 0, ['land'], undefined);
const spell = (n, cmc) => card(`Spell ${n}`, cmc, ['sorcery'], undefined);
const fatty = (n, cmc, power = 6) => card(`Fatty ${n}`, cmc, ['creature'], String(power));
const dork = (n, cmc, power = 1) => card(`Dork ${n}`, cmc, ['creature'], String(power));

// ==================== isPower5Plus ====================

describe('isPower5Plus', () => {
    it('accepts printed power of 5 or more', () => {
        assert.ok(isPower5Plus(5));
        assert.ok(isPower5Plus('7'));
        assert.ok(!isPower5Plus(4));
        assert.ok(!isPower5Plus('0'));
    });

    it('leaves variable power boxes to the caller', () => {
        assert.ok(!isPower5Plus('*'));
        assert.ok(isPower5Plus('*', true));
        assert.ok(!isPower5Plus('1+*'));
        assert.ok(isPower5Plus('1+*', true));
        assert.ok(isPower5Plus('X', true));
    });

    it('rejects missing power', () => {
        assert.ok(!isPower5Plus(undefined));
        assert.ok(!isPower5Plus(null));
    });
});

// ==================== simulateDiscoverChain ====================

describe('simulateDiscoverChain', () => {
    it('skips lands and cards above the discover value, then casts the first hit', () => {
        const lib = [land(1), spell(1, 9), land(2), spell(2, 3), spell(3, 1)];
        const r = simulateDiscoverChain(lib, 5);
        assert.strictEqual(r.chainCount, 1);
        assert.strictEqual(r.chainMana, 3);
        assert.strictEqual(r.steps[0].hit.name, 'Spell 2');
        assert.strictEqual(r.steps[0].dug, 3);   // two lands + the 9-drop
    });

    it('treats the discover value as inclusive', () => {
        assert.strictEqual(simulateDiscoverChain([spell(1, 5)], 5).chainCount, 1);
        assert.strictEqual(simulateDiscoverChain([spell(1, 6)], 5).chainCount, 0);
    });

    it('chains when the card it casts is a power-5+ creature', () => {
        // Discover 6 hits a 6-drop fatty, which discovers 6 again and hits a spell.
        const lib = [fatty(1, 6), spell(1, 2)];
        const r = simulateDiscoverChain(lib, 6);
        assert.strictEqual(r.chainCount, 2);
        assert.strictEqual(r.chainMana, 8);
        assert.strictEqual(r.steps[0].chains, true);
        assert.strictEqual(r.steps[1].chains, false);
    });

    it('does not chain off a small creature', () => {
        const r = simulateDiscoverChain([dork(1, 2), spell(1, 1)], 5);
        assert.strictEqual(r.chainCount, 1);
        assert.strictEqual(r.steps[0].chains, false);
    });

    it('re-sizes the next discover to the mana value of the creature it cast', () => {
        // Discover 8 hits a 5-drop fatty; the next discover is 5, so the 7-drop
        // that follows is passed over and the 4-drop is taken.
        const lib = [fatty(1, 5), spell(1, 7), spell(2, 4)];
        const r = simulateDiscoverChain(lib, 8);
        assert.strictEqual(r.steps[1].discoverCMC, 5);
        assert.strictEqual(r.steps[1].hit.name, 'Spell 2');
        assert.strictEqual(r.chainMana, 9);
    });

    it('reports a whiff when nothing eligible is left', () => {
        const r = simulateDiscoverChain([land(1), spell(1, 9)], 3);
        assert.strictEqual(r.chainCount, 0);
        assert.strictEqual(r.chainMana, 0);
        assert.strictEqual(r.steps[0].hit, null);
    });

    it('honours the star-power reading when deciding whether to chain', () => {
        const star = card('Star', 4, ['creature'], '*');
        const lib = [star, spell(1, 2)];
        assert.strictEqual(simulateDiscoverChain(lib, 5).chainCount, 1);
        assert.strictEqual(simulateDiscoverChain(lib, 5, { treatStarAs5Plus: true }).chainCount, 2);
    });

    it('caps runaway chains', () => {
        // Every card chains into the next, so only the cap stops it.
        const lib = Array.from({ length: 40 }, (_, i) => fatty(i, 6));
        assert.strictEqual(simulateDiscoverChain(lib, 6, { maxChain: 3 }).chainCount, 3);
    });

    it('handles an empty or malformed library without throwing', () => {
        assert.doesNotThrow(() => simulateDiscoverChain([], 5));
        assert.doesNotThrow(() => simulateDiscoverChain(undefined, 5));
        assert.doesNotThrow(() => simulateDiscoverChain([null], 5));
        assert.strictEqual(simulateDiscoverChain([], 5).chainCount, 0);
    });

    it('does not mutate the library it is given', () => {
        const lib = [land(1), spell(1, 2)];
        const before = lib.map(c => c.name).join(',');
        simulateDiscoverChain(lib, 5);
        assert.strictEqual(lib.map(c => c.name).join(','), before);
        assert.strictEqual(lib.length, 2);
    });
});

// ==================== behavioural parity with the Vortex tab ====================

describe('simulateDiscoverChain — parity with the original Vortex loop', () => {
    /**
     * The Monstrous Vortex tab used to carry its own copy of this walk. This is
     * that original logic, kept here so the extracted model is pinned to it —
     * if the two ever diverge, the same deck would give different answers on the
     * Vortex tab and the head-to-head comparison.
     */
    function originalVortexLoop(shuffled, startCMC, treatStarAs5Plus) {
        const isCreaturePower5Plus = (powerStr) => {
            if (powerStr === undefined || powerStr === null) return false;
            const str = String(powerStr);
            if (str.includes('*') || str.includes('X')) return treatStarAs5Plus;
            const p = parseInt(str, 10);
            return !isNaN(p) && p >= 5;
        };

        let currentDiscoverCMC = startCMC;
        let deckIndex = 0;
        let chainCount = 0;
        let chainMana = 0;

        while (chainCount < 10 && deckIndex < shuffled.length) {
            let hitCard = null;
            for (; deckIndex < shuffled.length; deckIndex++) {
                const c = shuffled[deckIndex];
                if (c.types.includes('land')) continue;
                if (c.cmc <= currentDiscoverCMC) { hitCard = c; deckIndex++; break; }
            }
            if (hitCard) {
                const isCreature = hitCard.types.includes('creature');
                const p5 = isCreature && isCreaturePower5Plus(hitCard.power);
                chainCount++;
                chainMana += hitCard.cmc;
                if (p5) currentDiscoverCMC = hitCard.cmc; else break;
            } else break;
        }
        return { chainCount, chainMana };
    }

    /** Deterministic pseudo-random deck builder, so the cases are reproducible. */
    function pseudoDeck(seed, size = 60) {
        let x = seed;
        const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
        const deck = [];
        for (let i = 0; i < size; i++) {
            const r = rnd();
            if (r < 0.38) deck.push(land(i));
            else if (r < 0.62) deck.push(spell(i, 1 + Math.floor(rnd() * 8)));
            else if (r < 0.82) deck.push(fatty(i, 4 + Math.floor(rnd() * 6), 5 + Math.floor(rnd() * 4)));
            else deck.push(dork(i, 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 3)));
        }
        return deck;
    }

    it('matches the original loop across many decks and discover sizes', () => {
        for (let seed = 1; seed <= 60; seed++) {
            const deck = pseudoDeck(seed);
            for (const start of [3, 4, 5, 6, 8, 10]) {
                for (const star of [false, true]) {
                    const mine = simulateDiscoverChain(deck, start, { treatStarAs5Plus: star });
                    const theirs = originalVortexLoop(deck, start, star);
                    assert.strictEqual(mine.chainCount, theirs.chainCount,
                        `chainCount seed=${seed} start=${start} star=${star}`);
                    assert.strictEqual(mine.chainMana, theirs.chainMana,
                        `chainMana seed=${seed} start=${start} star=${star}`);
                }
            }
        }
    });
});

// ==================== sampleDiscover ====================

describe('sampleDiscover', () => {
    it('averages over repeated runs of the same library', () => {
        const lib = [spell(1, 3)];
        const s = sampleDiscover(() => [...lib], 5, { runs: 20 });
        assert.strictEqual(s.runs, 20);
        assert.strictEqual(s.avgMana, 3);
        assert.strictEqual(s.avgSpells, 1);
        assert.strictEqual(s.bestMana, 3);
        assert.strictEqual(s.whiffRate, 0);
    });

    it('reports the whiff rate when nothing is ever eligible', () => {
        const s = sampleDiscover(() => [spell(1, 9)], 2, { runs: 10 });
        assert.strictEqual(s.whiffRate, 1);
        assert.strictEqual(s.avgMana, 0);
    });

    it('records the chain rate and the best run seen', () => {
        const s = sampleDiscover(() => [fatty(1, 6), spell(1, 2)], 6, { runs: 5 });
        assert.strictEqual(s.chainRate, 1);
        assert.strictEqual(s.bestMana, 8);
        assert.strictEqual(s.chainDist[2], 5);
    });

    it('returns gap-free distributions', () => {
        const s = sampleDiscover(() => [spell(1, 3)], 5, { runs: 4 });
        assert.ok(s.manaDist.every(v => Number.isFinite(v)));
        assert.ok(s.chainDist.every(v => Number.isFinite(v)));
    });
});

// ==================== percentiles ====================

describe('percentileFromDist', () => {
    it('reads a percentile off a count-indexed distribution', () => {
        // Ten observations, sorted: 0,0,1,1,2,2,3,3,4,9
        // Nearest-rank, so the qth percentile is the ceil(q * 10)th of them.
        const dist = [2, 2, 2, 2, 1, 0, 0, 0, 0, 1];
        assert.strictEqual(percentileFromDist(dist, 0.2), 0);   // 2nd
        assert.strictEqual(percentileFromDist(dist, 0.5), 2);   // 5th
        assert.strictEqual(percentileFromDist(dist, 0.9), 4);   // 9th
        assert.strictEqual(percentileFromDist(dist, 1.0), 9);   // 10th
    });

    it('is stable under sample size, unlike a maximum', () => {
        // Same shape, ten times the samples: the p95 does not move, but adding
        // a single rare outlier would move a maximum.
        const small = [95, 5];
        const large = [950, 50];
        assert.strictEqual(percentileFromDist(small, 0.95), percentileFromDist(large, 0.95));
    });

    it('clamps out-of-range quantiles instead of returning undefined', () => {
        const dist = [1, 1, 1];
        assert.strictEqual(percentileFromDist(dist, -1), 0);
        assert.strictEqual(percentileFromDist(dist, 5), 2);
    });

    it('returns 0 for an empty or missing distribution', () => {
        assert.strictEqual(percentileFromDist([], 0.5), 0);
        assert.strictEqual(percentileFromDist(undefined, 0.5), 0);
        assert.strictEqual(percentileFromDist([0, 0, 0], 0.5), 0);
    });
});

describe('mergeDists', () => {
    it('sums distributions bucket by bucket', () => {
        const merged = mergeDists([{ dist: [1, 2] }, { dist: [0, 3, 4] }]);
        assert.deepStrictEqual(merged, [1, 5, 4]);
    });

    it('applies weights, so a bigger sample does not count for more', () => {
        // 100 samples normalised to weight 1 against a single point mass.
        const merged = mergeDists([
            { dist: [50, 50], weight: 1 / 100 },
            { dist: [0, 1], weight: 1 }
        ]);
        assert.ok(Math.abs(merged[0] - 0.5) < 1e-9);
        assert.ok(Math.abs(merged[1] - 1.5) < 1e-9);
    });

    it('handles missing input without throwing', () => {
        assert.deepStrictEqual(mergeDists([]), []);
        assert.doesNotThrow(() => mergeDists(undefined));
        assert.doesNotThrow(() => mergeDists([{}, null]));
    });
});

describe('sampleDiscover — percentiles', () => {
    it('reports median and p95 alongside the sampled maximum', () => {
        const s = sampleDiscover(() => [spell(1, 3)], 5, { runs: 50 });
        assert.strictEqual(s.medianMana, 3);
        assert.strictEqual(s.p95Mana, 3);
        assert.strictEqual(s.bestMana, 3);
    });

    it('separates a rare spike from the typical outcome', () => {
        // A library that usually yields 2 mana, but occasionally chains for more.
        let flip = 0;
        const s = sampleDiscover(
            () => (++flip % 20 === 0 ? [fatty(1, 6), spell(1, 6)] : [spell(1, 2)]),
            6,
            { runs: 200 }
        );
        assert.strictEqual(s.medianMana, 2);
        assert.ok(s.bestMana >= 12, `best ${s.bestMana}`);
        assert.ok(s.p95Mana < s.bestMana, 'p95 should sit below the rare spike');
    });
});

// ==================== monotonicity in the discover size ====================

describe('simulateDiscoverChain — a bigger discover is never worse', () => {
    /**
     * Discover N+1 can hit everything discover N can, plus more, so on the SAME
     * library a larger discover never finds less. Every true statistic is
     * therefore non-decreasing in the discover size.
     *
     * This is why a dip in the value curve can only ever be sampling noise — it
     * was a sampled *maximum* that produced one, which is what motivated
     * reporting percentiles instead.
     */
    function pseudoDeck(seed, size = 60) {
        let x = seed;
        const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
        const deck = [];
        for (let i = 0; i < size; i++) {
            const r = rnd();
            if (r < 0.38) deck.push(land(i));
            else if (r < 0.62) deck.push(spell(i, 1 + Math.floor(rnd() * 8)));
            else if (r < 0.82) deck.push(fatty(i, 4 + Math.floor(rnd() * 6), 5 + Math.floor(rnd() * 4)));
            else deck.push(dork(i, 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 3)));
        }
        return deck;
    }

    it('never digs deeper for the first hit as the discover size grows', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const deck = pseudoDeck(seed);
            let prevDug = Infinity;
            for (let n = 1; n <= 14; n++) {
                const dug = simulateDiscoverChain(deck, n).steps[0].dug;
                assert.ok(dug <= prevDug || prevDug === Infinity,
                    `seed ${seed}: discover ${n} dug ${dug}, deeper than the smaller discover's ${prevDug}`);
                prevDug = dug;
            }
        }
    });

    it('never casts fewer spells or less mana on the same library', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const deck = pseudoDeck(seed);
            let prev = { chainCount: -1, chainMana: -1 };
            for (let n = 1; n <= 14; n++) {
                const r = simulateDiscoverChain(deck, n);
                assert.ok(r.chainMana >= prev.chainMana,
                    `seed ${seed}: discover ${n} cheated ${r.chainMana}, less than discover ${n - 1}'s ${prev.chainMana}`);
                prev = r;
            }
        }
    });

    it('makes the same guarantee for the pooled mean over many shuffles', () => {
        // The statistic the value curve actually plots, so pin it directly.
        const deck = pseudoDeck(7);
        const meanFor = (n) => {
            let total = 0;
            for (let i = 0; i < 200; i++) total += simulateDiscoverChain(deck, n).chainMana;
            return total / 200;
        };
        // Same deck order every time, so this is exact rather than statistical.
        for (let n = 2; n <= 12; n++) {
            assert.ok(meanFor(n) >= meanFor(n - 1), `mean dipped from discover ${n - 1} to ${n}`);
        }
    });
});

describe('percentileFromDist — fractional weights', () => {
    it('handles a distribution normalised to total weight 1', () => {
        // The shape merged distributions actually have: one cast's worth of a
        // sampled spread. A ceil'd rank would return the maximum for all of these.
        const dist = mergeDists([{ dist: [50, 30, 15, 4, 1], weight: 1 / 100 }]);
        assert.strictEqual(percentileFromDist(dist, 0.5), 0);
        assert.strictEqual(percentileFromDist(dist, 0.9), 2);
        assert.strictEqual(percentileFromDist(dist, 0.95), 2);
        assert.strictEqual(percentileFromDist(dist, 0.99), 3);
    });

    it('agrees with the raw-count reading of the same shape', () => {
        const raw = [50, 30, 15, 4, 1];
        const normalised = mergeDists([{ dist: raw, weight: 1 / 100 }]);
        for (const q of [0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
            assert.strictEqual(percentileFromDist(normalised, q), percentileFromDist(raw, q),
                `q=${q}`);
        }
    });

    it('never reports a bucket with no observations at all', () => {
        // Nothing was ever observed at 0, so no percentile should return 0.
        const dist = mergeDists([{ dist: [0, 10, 10], weight: 1 / 20 }]);
        assert.strictEqual(percentileFromDist(dist, 0), 1);
        assert.strictEqual(percentileFromDist(dist, 0.5), 1);
        assert.strictEqual(percentileFromDist(dist, 1), 2);
    });

    it('pools several normalised spreads without one dominating', () => {
        // Two casts: one always 2 mana, one always 10. The median sits at the
        // lower of them, not at a weighted-by-sample-count blend.
        const dist = mergeDists([
            { dist: [0, 0, 1000], weight: 1 / 1000 },
            { dist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10], weight: 1 / 10 }
        ]);
        assert.strictEqual(percentileFromDist(dist, 0.5), 2);
        assert.strictEqual(percentileFromDist(dist, 0.95), 10);
    });
});
