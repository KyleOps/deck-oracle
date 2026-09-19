import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker, { isAllowedOrigin, parseAllowedTarget } from '../../serverless/worker.js';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

describe('deck import proxy security', () => {
    it('requires an exact allowed origin', () => {
        assert.equal(isAllowedOrigin('https://kyleops.github.io'), true);
        assert.equal(isAllowedOrigin('https://deck-oracle.xyz'), true);
        assert.equal(isAllowedOrigin('http://localhost:3000'), true);
        assert.equal(isAllowedOrigin('https://kyleops.github.io.evil.example'), false);
        assert.equal(isAllowedOrigin('https://deck-oracle.xyz.evil.example'), false);
        assert.equal(isAllowedOrigin('https://www.deck-oracle.xyz'), false);
        assert.equal(isAllowedOrigin('https://evil.example/?next=https://kyleops.github.io'), false);
        assert.equal(isAllowedOrigin(null), false);
    });

    it('returns CORS access to the custom production domain', async () => {
        global.fetch = async () => new Response('{"ok":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

        const request = new Request(
            'https://proxy.example/?url=https%3A%2F%2Farchidekt.com%2Fapi%2Fdecks%2F1%2F',
            { headers: { Origin: 'https://deck-oracle.xyz' } }
        );
        const response = await worker.fetch(request, {});

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://deck-oracle.xyz');
    });

    it('accepts only the exact HTTPS API hosts used by deck imports', () => {
        assert.equal(parseAllowedTarget('https://api2.moxfield.com/v3/decks/all/abc')?.hostname, 'api2.moxfield.com');
        assert.equal(parseAllowedTarget('https://archidekt.com/api/decks/123/')?.hostname, 'archidekt.com');

        assert.equal(parseAllowedTarget('http://api2.moxfield.com/v3/decks/all/abc'), null);
        assert.equal(parseAllowedTarget('https://moxfield.com.evil.example/decks/abc'), null);
        assert.equal(parseAllowedTarget('https://evil.example/?url=https://moxfield.com'), null);
        assert.equal(parseAllowedTarget('https://user@moxfield.com/decks/abc'), null);
        assert.equal(parseAllowedTarget('https://archidekt.com:8443/api/decks/123/'), null);
        assert.equal(parseAllowedTarget('not a url'), null);
    });

    it('rejects disallowed requests before calling the network', async () => {
        let fetchCalled = false;
        global.fetch = async () => {
            fetchCalled = true;
            throw new Error('should not be called');
        };

        const request = new Request(
            'https://proxy.example/?url=https%3A%2F%2Fmoxfield.com.evil.example%2Fdecks%2Fabc',
            { headers: { Origin: 'https://kyleops.github.io' } }
        );
        const response = await worker.fetch(request, {});

        assert.equal(response.status, 403);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://kyleops.github.io');
        assert.equal(fetchCalled, false);
    });

    it('forwards allowed GETs with manual redirect handling and preserves status', async () => {
        let forwardedUrl;
        let forwardedOptions;
        global.fetch = async (url, options) => {
            forwardedUrl = url;
            forwardedOptions = options;
            return new Response('{"error":"missing"}', {
                status: 404,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        };

        const request = new Request(
            'https://proxy.example/?url=https%3A%2F%2Fapi2.moxfield.com%2Fv3%2Fdecks%2Fall%2Fabc',
            { headers: { Origin: 'https://kyleops.github.io' } }
        );
        const response = await worker.fetch(request, { MOXFIELD_USER_AGENT: 'Deck-Oracle-Test' });

        assert.equal(forwardedUrl, 'https://api2.moxfield.com/v3/decks/all/abc');
        assert.equal(forwardedOptions.redirect, 'manual');
        assert.equal(forwardedOptions.headers['User-Agent'], 'Deck-Oracle-Test');
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://kyleops.github.io');
        assert.equal(response.headers.get('Vary'), 'Origin');
    });

    it('follows redirects only when the destination is also allowed', async () => {
        const forwarded = [];
        global.fetch = async (url, options) => {
            forwarded.push({ url, options });
            if (forwarded.length === 1) {
                return new Response(null, {
                    status: 302,
                    headers: { Location: 'https://www.moxfield.com/decks/abc' }
                });
            }
            return new Response('{"ok":true}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        };

        const request = new Request(
            'https://proxy.example/?url=https%3A%2F%2Fapi2.moxfield.com%2Fv3%2Fdecks%2Fall%2Fabc',
            { headers: { Origin: 'https://kyleops.github.io' } }
        );
        const response = await worker.fetch(request, {});

        assert.equal(response.status, 200);
        assert.deepEqual(forwarded.map(entry => entry.url), [
            'https://api2.moxfield.com/v3/decks/all/abc',
            'https://www.moxfield.com/decks/abc'
        ]);
        assert.equal(forwarded.every(entry => entry.options.redirect === 'manual'), true);
    });

    it('blocks redirects that leave the provider allowlist', async () => {
        let fetchCalls = 0;
        const originalConsoleError = console.error;
        let loggedError = '';
        console.error = message => { loggedError = String(message); };
        global.fetch = async () => {
            fetchCalls += 1;
            return new Response(null, {
                status: 302,
                headers: { Location: 'https://evil.example/collect' }
            });
        };

        try {
            const request = new Request(
                'https://proxy.example/?url=https%3A%2F%2Fapi2.moxfield.com%2Fv3%2Fdecks%2Fall%2Fabc',
                { headers: { Origin: 'https://kyleops.github.io' } }
            );
            const response = await worker.fetch(request, {});

            assert.equal(response.status, 502);
            assert.equal(fetchCalls, 1);
            assert.match(loggedError, /Blocked upstream redirect outside the provider allowlist/);
        } finally {
            console.error = originalConsoleError;
        }
    });

    it('rejects methods other than GET and OPTIONS', async () => {
        const request = new Request('https://proxy.example/', {
            method: 'POST',
            headers: { Origin: 'https://kyleops.github.io' }
        });
        const response = await worker.fetch(request, {});

        assert.equal(response.status, 405);
        assert.equal(response.headers.get('Allow'), 'GET, OPTIONS');
    });
});
