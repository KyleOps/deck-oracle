import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    frontFace, isLandType, isHistoricType, isLandCard, libraryOf, hashString, seededRandom, deckSeed, createRevealer,
    quantile, typicalRange, formatRange, formatPct, tailAtLeast, capDistribution, objectId, renderOpponentPlaceholder,
    miniBars
} from '../../js/utils/opponentPages.js';

describe('opponentPages — card model', () => {
    it('reads the front face of double-faced cards', () => {
        assert.strictEqual(frontFace('Sorcery // Land'), 'sorcery ');
        assert.strictEqual(isLandType('Sorcery // Land'), false);
        assert.strictEqual(isLandType('Land // Land'), true);
        assert.strictEqual(isLandType('Land Creature — Forest Dryad'), true);
        assert.strictEqual(isLandType('Creature — Elf'), false);
    });

    it('recognises historic types on the front face', () => {
        assert.ok(isHistoricType('Artifact Creature — Golem'));
        assert.ok(isHistoricType('Legendary Creature — Human'));
        assert.ok(isHistoricType('Enchantment — Saga'));
        assert.ok(!isHistoricType('Instant'));
    });

    it('isLandCard accepts both card shapes', () => {
        assert.strictEqual(isLandCard({ land: true }), true);
        assert.strictEqual(isLandCard({ types: ['land'] }), true);
        assert.strictEqual(isLandCard({ types: ['creature'] }), false);
        assert.strictEqual(isLandCard({ type_line: 'Basic Land — Island' }), true);
    });

    it('libraryOf expands counts, defaults a missing count to 1, and caches per deck object', () => {
        const data = {
            cardsByName: {
                Island: { name: 'Island', type_line: 'Basic Land — Island', cmc: 0, count: 3 },
                Opt: { name: 'Opt', type_line: 'Instant', cmc: 1 },
                Skip: { name: 'Skip', type_line: 'Instant', cmc: 1, count: 0 }
            }
        };
        const lib = libraryOf(data);
        assert.strictEqual(lib.length, 4);
        assert.strictEqual(lib.filter(c => c.land).length, 3);
        assert.strictEqual(lib.find(c => c.name === 'Opt').type, 'instant');
        assert.strictEqual(libraryOf(data), lib, 'same deck object → same array');
        assert.deepStrictEqual(libraryOf(null), []);
    });
});

describe('opponentPages — randomness', () => {
    it('seeded random is repeatable and in [0, 1)', () => {
        const a = seededRandom(42);
        const b = seededRandom(42);
        for (let i = 0; i < 100; i++) {
            const x = a();
            assert.strictEqual(x, b());
            assert.ok(x >= 0 && x < 1);
        }
        assert.notStrictEqual(seededRandom(1)(), seededRandom(2)());
    });

    it('deck seed ignores card order', () => {
        const x = [{ name: 'A' }, { name: 'B' }, { name: 'A' }];
        const y = [{ name: 'B' }, { name: 'A' }, { name: 'A' }];
        assert.strictEqual(deckSeed(x), deckSeed(y));
        assert.notStrictEqual(deckSeed(x), deckSeed([{ name: 'A' }, { name: 'B' }]));
        assert.strictEqual(hashString('abc'), hashString('abc'));
    });

    it('the revealer deals every card exactly once per run, and again after reset', () => {
        const cards = Array.from({ length: 20 }, (_, i) => i);
        const rev = createRevealer(cards, seededRandom(7));
        for (let run = 0; run < 3; run++) {
            rev.reset();
            const seen = [];
            let c;
            while ((c = rev.reveal()) !== null) seen.push(c);
            assert.deepStrictEqual([...seen].sort((p, q) => p - q), cards);
        }
        assert.deepStrictEqual(cards, Array.from({ length: 20 }, (_, i) => i), 'source array untouched');
    });

    it('the top card is uniform', () => {
        const rev = createRevealer([0, 1, 2, 3], seededRandom(99));
        const counts = [0, 0, 0, 0];
        for (let i = 0; i < 8000; i++) {
            rev.reset();
            counts[rev.reveal()]++;
        }
        counts.forEach(c => assert.ok(Math.abs(c / 8000 - 0.25) < 0.03, `count ${c}`));
    });
});

describe('opponentPages — distributions and words', () => {
    it('quantiles of a weight array', () => {
        const dist = [0.1, 0.2, 0.4, 0.2, 0.1];
        assert.strictEqual(quantile(dist, 0.25), 1);
        assert.strictEqual(quantile(dist, 0.5), 2);
        assert.deepStrictEqual(typicalRange(dist), [1, 3]);
        assert.strictEqual(quantile([], 0.5), 0);
        assert.deepStrictEqual(typicalRange([0, 0, 1]), [2, 2]);
    });

    it('quantile does not round a boundary up', () => {
        assert.strictEqual(quantile([0.25, 0.25, 0.5], 0.25), 0);
    });

    it('formats ranges and percentages', () => {
        assert.strictEqual(formatRange([2, 2]), '2');
        assert.strictEqual(formatRange([2, 4]), '2–4');
        assert.strictEqual(formatPct(0.384), '38%');
        assert.strictEqual(formatPct(0.001), '<1%');
        assert.strictEqual(formatPct(0.999), '>99%');
        assert.strictEqual(formatPct(0), '0%');
        assert.strictEqual(formatPct(1), '100%');
    });

    it('tails and capped buckets', () => {
        assert.ok(Math.abs(tailAtLeast([0.5, 0.25, 0.25], 1) - 0.5) < 1e-12);
        assert.deepStrictEqual(capDistribution([1, 2, 3, 4], 2), [1, 2, 7]);
    });

    it('object ids are stable per object', () => {
        const a = {};
        assert.strictEqual(objectId(a), objectId(a));
        assert.notStrictEqual(objectId(a), objectId({}));
    });
});

describe('opponentPages — markup', () => {
    const copy = { title: 'Title', lead: 'Lead', steps: [{ kicker: 'K', text: 'T', demo: '<b>d</b>' }] };

    it('placeholder offers examples and import', () => {
        const html = renderOpponentPlaceholder(copy, { loading: [], errors: [] });
        assert.match(html, /data-opp-page-action="examples"/);
        assert.match(html, /data-opp-page-action="import"/);
        assert.match(html, /<b>d<\/b>/);
    });

    it('placeholder becomes a loading state while imports run', () => {
        const html = renderOpponentPlaceholder(copy, { loading: ['opponent1', 'opponent2'], errors: [] });
        assert.match(html, /Loading two opponent decks/);
        assert.doesNotMatch(html, /data-opp-page-action/);
    });

    it('placeholder shows the last import error, escaped', () => {
        const html = renderOpponentPlaceholder(copy, { loading: [], errors: ['<oops>'] });
        assert.match(html, /&lt;oops&gt;/);
    });

    it('mini bars share a scale', () => {
        const html = miniBars({ title: 'T', probs: [0.25, 0.5], label: i => String(i), scaleMax: 1 });
        assert.match(html, /width:25\.0%/);
        assert.match(html, /width:50\.0%/);
    });
});
