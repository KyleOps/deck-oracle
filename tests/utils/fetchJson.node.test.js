/**
 * fetchJson: every importer request has a deadline and a typed failure;
 * friendlyImportError: one sentence per failure, the same in the deck dialog
 * and the opponent seats.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, FetchError, friendlyImportError } from '../../js/utils/fetchJson.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A fetch that never answers until its signal aborts. */
const hangingFetch = () => (_url, { signal } = {}) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
});

describe('fetchJson', () => {
    it('returns the parsed body', async () => {
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ hello: 'world' }) });
        assert.deepEqual(await fetchJson('https://example.test/a'), { hello: 'world' });
    });

    it('gives up after the deadline instead of hanging', async () => {
        globalThis.fetch = hangingFetch();
        // Node unrefs AbortSignal.timeout's timer; keep the loop alive meanwhile.
        const keepAlive = setTimeout(() => {}, 5000);
        const started = Date.now();
        try {
            await assert.rejects(fetchJson('https://example.test/slow', { timeoutMs: 30 }), err =>
                err instanceof FetchError && err.kind === 'timeout' && /No answer within/.test(err.message));
        } finally {
            clearTimeout(keepAlive);
        }
        assert.ok(Date.now() - started < 2000);
    });

    it('reports a cancelled request as aborted, not as a timeout', async () => {
        globalThis.fetch = hangingFetch();
        const controller = new AbortController();
        const job = fetchJson('https://example.test/slow', { signal: controller.signal, timeoutMs: 5000 });
        controller.abort();
        await assert.rejects(job, err => err.kind === 'aborted');
        await assert.rejects(fetchJson('https://example.test/x', { signal: controller.signal }), err => err.kind === 'aborted');
    });

    it('types HTTP errors with their status and the server’s details', async () => {
        globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ details: 'Bad gateway' }) });
        await assert.rejects(fetchJson('https://example.test/proxy'), err =>
            err.kind === 'http' && err.status === 502 && err.message === 'Bad gateway');
        globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('html'); } });
        await assert.rejects(fetchJson('https://example.test/missing'), err => err.status === 404 && err.message === 'HTTP 404');
    });

    it('types network failures and bad bodies', async () => {
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        await assert.rejects(fetchJson('https://example.test/'), err => err.kind === 'network' && err.cause instanceof TypeError);
        globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
        await assert.rejects(fetchJson('https://example.test/'), err => err.kind === 'parse');
    });

    it('passes method, headers and body through', async () => {
        let seen;
        globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => [] }; };
        await fetchJson('https://example.test/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(seen.init.method, 'POST');
        assert.equal(seen.init.body, '{}');
        assert.ok(seen.init.signal, 'every request carries a deadline signal');
    });
});

describe('friendlyImportError', () => {
    const http = status => new FetchError(`HTTP ${status}`, { kind: 'http', status });

    it('explains deck-site answers', () => {
        assert.match(friendlyImportError(http(502)), /deck site isn’t answering right now \(error 502\)/);
        assert.match(friendlyImportError(http(404)), /wasn’t found.*public/);
        assert.match(friendlyImportError(http(403)), /private/);
        assert.match(friendlyImportError(http(429)), /busy/);
        assert.match(friendlyImportError(http(418)), /error 418/);
        assert.match(friendlyImportError(http(503), { isUrl: false }), /^Scryfall isn’t answering/);
        assert.match(friendlyImportError(http(404), { isUrl: false }), /Scryfall couldn’t find/);
    });

    it('explains timeouts, network failures and odd answers', () => {
        assert.match(friendlyImportError(new FetchError('x', { kind: 'timeout' })), /deck site took too long/);
        assert.match(friendlyImportError(new FetchError('x', { kind: 'timeout' }), { isUrl: false }), /Scryfall took too long/);
        assert.match(friendlyImportError(new FetchError('x', { kind: 'network' })), /Couldn’t reach the deck site/);
        assert.match(friendlyImportError(new TypeError('Failed to fetch'), { isUrl: false }), /Couldn’t reach Scryfall/);
        assert.match(friendlyImportError(new FetchError('x', { kind: 'parse' })), /unexpected/);
    });

    it('explains list and link mistakes', () => {
        assert.match(friendlyImportError(new Error('No cards found in decklist'), { isUrl: false }), /No cards found/);
        assert.match(friendlyImportError(new Error('Invalid decklist: must be a string'), { isUrl: false }), /No cards found/);
        assert.match(friendlyImportError(new Error('None of those cards were recognised.')), /None of those cards/);
        assert.match(friendlyImportError(new Error('Invalid URL or ID. Supports Moxfield and Archidekt.')), /isn’t a Moxfield or Archidekt deck/);
    });

    it('keeps other messages, and never returns nothing', () => {
        assert.equal(friendlyImportError(new Error('Decklist too large. Maximum 50000 characters.')), 'Decklist too large. Maximum 50000 characters.');
        assert.equal(friendlyImportError(null), 'The import failed.');
        assert.equal(friendlyImportError('plain string'), 'plain string');
    });

    it('says when the browser is offline', () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
        try {
            assert.equal(friendlyImportError(http(502)), 'You appear to be offline.');
        } finally {
            if (original) Object.defineProperty(globalThis, 'navigator', original);
            else delete globalThis.navigator;
        }
    });
});
