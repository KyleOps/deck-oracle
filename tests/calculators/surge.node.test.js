// The Primal Surge page: readInputs() → the model. The maths is tested in
// tests/models/surge.node.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import { calculate, readInputs } from '../../js/calculators/surge.js';
import { buildDeckExcludingSurge, surgeResult, surgeSettings } from '../../js/utils/models/surge.js';

describe('Primal Surge page', () => {
    it('reads the default value model when the page is not mounted', () => {
        assert.deepStrictEqual(readInputs().settings, surgeSettings());
        assert.deepStrictEqual(surgeSettings(), { threshold: 10, landValue: 1, cardValue: 0.25 });
    });

    it('calculates the model over what it read', () => {
        const { config, result } = calculate();
        assert.ok(config.mvKnown, 'the example deck has a list');
        assert.deepStrictEqual(result, surgeResult(config));
    });

    it('keeps exact odds and sampled library sizes aligned with the named card', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            const cardsByName = {
                Cultivate: { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, count: 1 },
                Surge: { name: 'Primal Surge', type_line: 'Sorcery', cmc: 10, count: 1 },
                Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 2 }
            };
            DeckConfig.updateDeck({
                creatures: 0, artifacts: 0, enchantments: 0, planeswalkers: 0,
                battles: 0, instants: 0, sorceries: 2, lands: 2,
                actualCardCount: 4, cardsByName
            });
            assert.equal(readInputs().deckSize, buildDeckExcludingSurge({ cardsByName }).length);
            assert.equal(readInputs().nonPermanents, 1);
            assert.equal(readInputs().surgeOnStack, true);

            // A new deck is a new object (DeckConfig never edits a list in place).
            DeckConfig.updateDeck({ cardsByName: { ...cardsByName, Surge: { name: 'Impulsive Research', type_line: 'Sorcery', cmc: 4, count: 1 } } });
            assert.equal(readInputs().deckSize, 4);
            assert.equal(readInputs().nonPermanents, 2);
            assert.equal(readInputs().surgeOnStack, false);
        } finally {
            DeckConfig.updateDeck(original);
        }
    });

    it('ignores a stale card list once the counts are edited by hand', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            DeckConfig.updateDeck({
                importSource: 'manual', creatures: 30, artifacts: 0, enchantments: 0, planeswalkers: 0,
                battles: 0, instants: 5, sorceries: 5, lands: 36, actualCardCount: null
            });
            const config = readInputs();
            assert.strictEqual(config.mvKnown, false);
            assert.strictEqual(config.nonPermanents, 9, 'one sorcery is the Surge being cast');
            assert.strictEqual(config.deckSize, 75);
        } finally {
            DeckConfig.updateDeck(original);
        }
    });
});
