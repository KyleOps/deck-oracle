import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('the bundled example deck', () => {
    it('carries only what deck state reads (everything else is derived at runtime)', () => {
        assert.deepStrictEqual(Object.keys(DEFAULT_DECK_DATA).sort(), [
            ...DeckConfig.TYPE_FIELDS, 'actualCardCount', 'cardsByName', 'commanders', 'deckName', 'importUrl'
        ].sort());
    });

    it('is a 98-card list with its two commanders in the command zone', () => {
        const listed = Object.values(DEFAULT_DECK_DATA.cardsByName).reduce((n, c) => n + c.count, 0);
        assert.strictEqual(listed, 98);
        assert.strictEqual(DEFAULT_DECK_DATA.actualCardCount, 98);
        assert.deepStrictEqual(DEFAULT_DECK_DATA.commanders.map(c => c.name), ['The Sixth Doctor', 'Susan Foreman']);
        assert.ok(DEFAULT_DECK_DATA.commanders.every(c => c.card?.name === c.name), 'each commander has its card record');
    });

    it('loads as the starting deck, cardDetails derived from the list', () => {
        const config = DeckConfig.getDeckConfig();
        assert.strictEqual(config.cardsByName, DEFAULT_DECK_DATA.cardsByName);
        assert.deepStrictEqual(DeckConfig.getCommanderNames(), ['The Sixth Doctor', 'Susan Foreman']);
        assert.strictEqual(config.cardDetails.length, Object.values(DEFAULT_DECK_DATA.cardsByName)
            .filter(c => c.category !== 'lands').reduce((n, c) => n + c.count, 0));
    });
});
