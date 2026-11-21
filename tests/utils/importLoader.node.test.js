/**
 * The import code is loaded on demand, once, and failures read the same from
 * the deck dialog and the opponent seats.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadImporter, explainImportError } from '../../js/utils/importLoader.js';
import { FetchError } from '../../js/utils/fetchJson.js';

describe('importLoader', () => {
    it('loads decklistImport.js once', async () => {
        const a = await loadImporter();
        const b = await loadImporter();
        assert.equal(a, b);
        assert.equal(typeof a.importDeckFromUrl, 'function');
        assert.equal(typeof a.importDecklistBatch, 'function');
    });

    it('explains failures with the shared translator', async () => {
        assert.match(await explainImportError(new FetchError('HTTP 502', { kind: 'http', status: 502 })), /error 502/);
        assert.match(await explainImportError(new TypeError('Failed to fetch'), { isUrl: false }), /Couldn’t reach Scryfall/);
        assert.match(await explainImportError(new Error('No cards found in decklist')), /No cards found/);
    });
});
