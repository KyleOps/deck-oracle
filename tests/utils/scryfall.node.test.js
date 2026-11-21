/**
 * Scryfall lookups: batching, caching, fuzzy fallback, and failing fast when
 * Scryfall can't be reached.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lookupCards, CardCache, cardKey, COLLECTION_BATCH_SIZE, resetScryfallForTests } from '../../js/utils/scryfall.js';
import { collectionResponse, fuzzyCard, SCRYFALL_CARDS } from '../fixtures/deckSites.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function stub(calls) {
    return async (url, init = {}) => {
        const href = String(url);
        calls.push({ href, body: init.body ? JSON.parse(init.body) : null });
        if (href.endsWith('/cards/collection')) return json(collectionResponse(init.body));
        const fuzzy = href.match(/fuzzy=([^&]+)/);
        const card = fuzzy ? fuzzyCard(decodeURIComponent(fuzzy[1])) : null;
        return card ? json(card) : json({ details: 'No card found' }, 404);
    };
}

let calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
    calls = [];
    resetScryfallForTests();
    globalThis.fetch = stub(calls);
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('lookupCards', () => {
    it('maps each requested name to its card, front face first', async () => {
        const found = await lookupCards(['Sol Ring', 'island', 'Cultivate // Nonsense']);
        assert.equal(found.get('Sol Ring').name, 'Sol Ring');
        assert.equal(found.get('island').name, 'Island');
        assert.equal(found.get('Cultivate // Nonsense').name, 'Cultivate');
        assert.deepEqual(calls[0].body.identifiers.map(i => i.name), ['Sol Ring', 'island', 'Cultivate']);
    });

    it('answers repeat lookups from the cache', async () => {
        await lookupCards(['Sol Ring']);
        const again = await lookupCards(['Sol Ring', 'SOL RING']);
        assert.equal(again.get('SOL RING').name, 'Sol Ring');
        assert.equal(calls.length, 1);
    });

    it('falls back to a fuzzy lookup for names the collection missed', async () => {
        const found = await lookupCards(['Sol Rnig', 'Nonexistent Card']);
        assert.equal(found.get('Sol Rnig').name, 'Sol Ring');
        assert.equal(found.has('Nonexistent Card'), false);
        assert.equal(calls.filter(c => c.href.includes('fuzzy=')).length, 2);
    });

    it('batches 75 names per request, reporting progress', async () => {
        const names = Array.from({ length: COLLECTION_BATCH_SIZE + 5 }, (_, i) => `Card ${i}`).concat(Object.keys(SCRYFALL_CARDS));
        const progress = [];
        // Every name exists in this stub's world.
        globalThis.fetch = async (url, init = {}) => {
            const body = JSON.parse(init.body);
            calls.push({ href: String(url), body });
            return json({ data: body.identifiers.map(({ name }) => SCRYFALL_CARDS[name] ?? { name, type_line: 'Artifact' }), not_found: [] });
        };
        const found = await lookupCards(names, { onBatch: (done, total) => progress.push([done, total]) });
        assert.equal(found.size, names.length);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].body.identifiers.length, COLLECTION_BATCH_SIZE);
        assert.deepEqual(progress.at(-1), [names.length, names.length]);
    });

    it('throws when Scryfall is unreachable and nothing was found, without retrying each name', async () => {
        globalThis.fetch = async (url) => { calls.push({ href: String(url) }); throw new TypeError('Failed to fetch'); };
        await assert.rejects(lookupCards(['Sol Ring', 'Island']), err => err.kind === 'network');
        assert.equal(calls.length, 1, 'no per-name fuzzy retries against a dead server');
    });

    it('stops when cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(lookupCards(['Sol Ring'], { signal: controller.signal }), err => err.kind === 'aborted');
    });

    it('ignores blank names', async () => {
        const found = await lookupCards(['', null]);
        assert.equal(found.size, 0);
        assert.equal(calls.length, 0);
    });
});

describe('CardCache', () => {
    it('evicts the least recently used entry', () => {
        const cache = new CardCache(2);
        cache.set('A', { name: 'A' });
        cache.set('B', { name: 'B' });
        cache.get('a');
        cache.set('C', { name: 'C' });
        assert.equal(cache.get('B'), null);
        assert.equal(cache.get('A').name, 'A');
        assert.equal(cache.size, 2);
    });

    it('expires entries after their time to live', () => {
        let now = 0;
        const cache = new CardCache(10, 100, () => now);
        cache.set('Sol Ring', { name: 'Sol Ring' });
        now = 50;
        assert.equal(cache.get('sol ring').name, 'Sol Ring');
        now = 200;
        assert.equal(cache.get('Sol Ring'), null);
        cache.set('', { name: 'blank' });
        assert.equal(cache.size, 0);
        cache.set('X', {});
        cache.clear();
        assert.equal(cache.size, 0);
    });

    it('keys by front face, lowercased', () => {
        assert.equal(cardKey('Delver of Secrets // Insectile Aberration'), 'delver of secrets');
        assert.equal(cardKey(undefined), '');
    });
});
