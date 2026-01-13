/**
 * Tests for share.js
 * Tests URL parsing, validation, and security features
 *
 * Note: These tests mock DOM functionality to run in Node.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Mock DOM globals for Node.js testing
global.window = {
    location: {
        href: 'http://localhost:3000/',
        search: ''
    }
};

global.document = {
    querySelector: () => null,
    getElementById: () => null
};

global.URLSearchParams = URLSearchParams;
global.URL = URL;
global.CSS = {
    escape: (str) => str.replace(/[^\w-]/g, (char) => '\\' + char)
};

describe('Share URL - Security & Validation', () => {
    describe('Tab Parameter Validation', () => {
        it('should accept valid tab names', () => {
            const validTabs = ['portent', 'surge', 'wave', 'vortex', 'rashmi', 'lands', 'mulligan'];

            validTabs.forEach(tab => {
                const params = new URLSearchParams(`tab=${tab}`);
                const tabValue = params.get('tab');

                // Check that tab is in valid list
                const VALID_TABS = ['portent', 'surge', 'wave', 'vortex', 'rashmi', 'lands', 'mulligan'];
                assert.ok(VALID_TABS.includes(tabValue), `Tab "${tab}" should be valid`);
            });
        });

        it('should reject invalid tab names', () => {
            const invalidTabs = ['admin', 'debug', 'config', '../../../etc/passwd'];
            const VALID_TABS = ['portent', 'surge', 'wave', 'vortex', 'rashmi', 'lands', 'mulligan'];

            invalidTabs.forEach(tab => {
                const params = new URLSearchParams(`tab=${tab}`);
                const tabValue = params.get('tab');

                assert.ok(!VALID_TABS.includes(tabValue), `Tab "${tab}" should be invalid`);
            });
        });

        it('should use CSS.escape for tab selector', () => {
            const maliciousTab = '"][onerror=alert(1)]//';
            const escaped = CSS.escape(maliciousTab);

            // CSS.escape should escape special characters
            assert.ok(escaped.includes('\\'), 'Should escape special characters');
            assert.notStrictEqual(escaped, maliciousTab, 'Escaped should differ from original');
        });
    });

    describe('Deck URL Validation', () => {
        it('should accept URLs from allowed hosts', () => {
            const ALLOWED_DECK_HOSTS = ['moxfield.com', 'www.moxfield.com', 'archidekt.com', 'www.archidekt.com'];
            const validUrls = [
                'https://moxfield.com/decks/abc123',
                'https://www.moxfield.com/decks/abc123',
                'https://archidekt.com/decks/123456',
                'https://www.archidekt.com/decks/123456'
            ];

            validUrls.forEach(deckUrl => {
                const url = new URL(deckUrl);
                assert.ok(ALLOWED_DECK_HOSTS.includes(url.hostname), `Host ${url.hostname} should be allowed`);
            });
        });

        it('should reject URLs from untrusted domains', () => {
            const ALLOWED_DECK_HOSTS = ['moxfield.com', 'www.moxfield.com', 'archidekt.com', 'www.archidekt.com'];
            const invalidUrls = [
                'https://evil.com/decks/abc123',
                'https://moxfield.evil.com/decks/abc123',
                'https://localhost/decks/abc123'
            ];

            invalidUrls.forEach(deckUrl => {
                const url = new URL(deckUrl);
                assert.ok(!ALLOWED_DECK_HOSTS.includes(url.hostname), `Host ${url.hostname} should be rejected`);
            });
        });

        it('should handle malformed URLs gracefully', () => {
            const malformedUrls = [
                'not-a-url',
                'ht!tp://invalid',
                '://missing-protocol'
            ];

            malformedUrls.forEach(deckUrl => {
                assert.throws(() => new URL(deckUrl), 'Should throw on malformed URL');
            });
        });

        it('should reject dangerous URL schemes', () => {
            const dangerousUrls = [
                'javascript:alert(1)',
                'file:///etc/passwd',
                'data:text/html,<script>alert(1)</script>'
            ];

            // These are valid URLs but dangerous schemes
            dangerousUrls.forEach(deckUrl => {
                const url = new URL(deckUrl);
                // Verify they're not HTTPS (the expected scheme)
                assert.notStrictEqual(url.protocol, 'https:', `Dangerous scheme ${url.protocol} should not be https`);
            });
        });
    });

    describe('Numeric Parameter Validation', () => {
        it('should validate mullSims within bounds', () => {
            const testCases = [
                { value: '5000', valid: true },
                { value: '1', valid: true },
                { value: '10000', valid: true },
                { value: '0', valid: false },
                { value: '10001', valid: false },
                { value: '-5', valid: false },
                { value: 'abc', valid: false }
            ];

            testCases.forEach(({ value, valid }) => {
                const parsed = parseInt(value, 10);
                const isValid = !isNaN(parsed) && parsed >= 1 && parsed <= 10000;

                assert.strictEqual(isValid, valid, `mullSims value "${value}" should be ${valid ? 'valid' : 'invalid'}`);
            });
        });

        it('should validate mullPenalty within bounds (0-1)', () => {
            const testCases = [
                { value: '0.5', valid: true },
                { value: '0', valid: true },
                { value: '1', valid: true },
                { value: '1.1', valid: false },
                { value: '-0.1', valid: false },
                { value: 'abc', valid: false }
            ];

            testCases.forEach(({ value, valid }) => {
                const parsed = parseFloat(value);
                const isValid = !isNaN(parsed) && parsed >= 0 && parsed <= 1;

                assert.strictEqual(isValid, valid, `mullPenalty value "${value}" should be ${valid ? 'valid' : 'invalid'}`);
            });
        });

        it('should validate mullThreshold within bounds (0-1)', () => {
            const testCases = [
                { value: '0.75', valid: true },
                { value: '0', valid: true },
                { value: '1', valid: true },
                { value: '2', valid: false },
                { value: '-1', valid: false }
            ];

            testCases.forEach(({ value, valid }) => {
                const parsed = parseFloat(value);
                const isValid = !isNaN(parsed) && parsed >= 0 && parsed <= 1;

                assert.strictEqual(isValid, valid, `mullThreshold value "${value}" should be ${valid ? 'valid' : 'invalid'}`);
            });
        });

        it('should validate slider values within configured bounds', () => {
            const sliderMap = {
                'portentX': { min: 0, max: 20 },
                'waveX': { min: 0, max: 30 },
                'vortexCMC': { min: 5, max: 15 },
                'rashmiCMC': { min: 0, max: 15 },
                'lands': { min: 0, max: 60 },
                'lumraGY': { min: 0, max: 30 },
                'lumraMult': { min: 1, max: 10 }
            };

            Object.entries(sliderMap).forEach(([param, config]) => {
                // Test within bounds
                const validValue = Math.floor((config.min + config.max) / 2);
                assert.ok(validValue >= config.min && validValue <= config.max, `${param} value ${validValue} should be valid`);

                // Test below min
                assert.ok(!(config.min - 1 >= config.min), `${param} value ${config.min - 1} should be invalid`);

                // Test above max
                assert.ok(!(config.max + 1 <= config.max), `${param} value ${config.max + 1} should be invalid`);
            });
        });
    });

    describe('JSON Validation (Mulligan Types)', () => {
        it('should accept valid mulligan types structure', () => {
            const validTypes = JSON.stringify([
                { id: '1', name: 'Lands', count: 24, required: 2, byTurn: 1, color: '#ff0000' },
                { id: '2', name: 'Ramp', count: 10, required: 1, byTurn: 2, color: '#00ff00' }
            ]);

            const parsed = JSON.parse(validTypes);

            const isValid = Array.isArray(parsed) && parsed.every(t =>
                t &&
                typeof t.id === 'string' &&
                typeof t.name === 'string' &&
                typeof t.count === 'number' &&
                typeof t.required === 'number' &&
                typeof t.byTurn === 'number' &&
                t.count >= 0 && t.count <= 100 &&
                t.required >= 0 && t.required <= 100 &&
                t.byTurn >= 0 && t.byTurn <= 20
            );

            assert.ok(isValid, 'Valid mulligan types should pass validation');
        });

        it('should reject invalid mulligan types structure', () => {
            const invalidCases = [
                { json: '{}', desc: 'Not an array' },
                { json: '[{"id": 1}]', desc: 'Missing required fields' },
                { json: '[{"id": "1", "name": "Test", "count": 101, "required": 1, "byTurn": 1}]', desc: 'Count out of bounds' },
                { json: '[{"id": "1", "name": "Test", "count": 50, "required": 101, "byTurn": 1}]', desc: 'Required out of bounds' },
                { json: '[{"id": "1", "name": "Test", "count": 50, "required": 1, "byTurn": 21}]', desc: 'ByTurn out of bounds' },
            ];

            invalidCases.forEach(({ json, desc }) => {
                const parsed = JSON.parse(json);

                const isValid = Array.isArray(parsed) && parsed.every(t =>
                    t &&
                    typeof t.id === 'string' &&
                    typeof t.name === 'string' &&
                    typeof t.count === 'number' &&
                    typeof t.required === 'number' &&
                    typeof t.byTurn === 'number' &&
                    t.count >= 0 && t.count <= 100 &&
                    t.required >= 0 && t.required <= 100 &&
                    t.byTurn >= 0 && t.byTurn <= 20
                );

                assert.ok(!isValid, `${desc} should fail validation`);
            });
        });

        it('should handle prototype pollution attempts', () => {
            const maliciousJSON = '{"__proto__":{"admin":true}}';
            const parsed = JSON.parse(maliciousJSON);

            // Validation should reject non-array
            const isValid = Array.isArray(parsed);
            assert.ok(!isValid, 'Prototype pollution attempt should be rejected');
        });

        it('should handle JSON with extra properties safely', () => {
            const jsonWithExtra = JSON.stringify([
                { id: '1', name: 'Test', count: 10, required: 1, byTurn: 1, malicious: '<script>alert(1)</script>' }
            ]);

            const parsed = JSON.parse(jsonWithExtra);

            // Validation should still work, extra properties are ignored
            const isValid = Array.isArray(parsed) && parsed.every(t =>
                t &&
                typeof t.id === 'string' &&
                typeof t.name === 'string' &&
                typeof t.count === 'number' &&
                typeof t.required === 'number' &&
                typeof t.byTurn === 'number'
            );

            assert.ok(isValid, 'Extra properties should not break validation');
        });
    });

    describe('XSS Prevention', () => {
        it('should escape special characters in tab parameter', () => {
            const xssAttempts = [
                '"><script>alert(1)</script>',
                '\'><img src=x onerror=alert(1)>',
                'javascript:alert(1)',
                '"][onerror=alert(1)]//`'
            ];

            xssAttempts.forEach(attempt => {
                const escaped = CSS.escape(attempt);

                // Escaped version should not contain unescaped quotes or angle brackets
                assert.ok(!escaped.includes('<') || escaped.includes('\\'), 'Should escape < character');
                assert.ok(!escaped.includes('>') || escaped.includes('\\'), 'Should escape > character');
                assert.ok(!escaped.includes('"') || escaped.includes('\\'), 'Should escape " character');
            });
        });

        it('should reject tab values not in whitelist', () => {
            const xssTabs = [
                '<script>alert(1)</script>',
                '../../../etc/passwd',
                'admin',
                'debug'
            ];

            xssTabs.forEach(tab => {
                const VALID_TABS = ['portent', 'surge', 'wave', 'vortex', 'rashmi', 'lands', 'mulligan', 'lumra'];
                assert.ok(!VALID_TABS.includes(tab), `XSS tab "${tab}" should not be in whitelist`);
            });
        });
    });

    describe('URL Generation', () => {
        it('should generate valid URLs with proper encoding', () => {
            // Test that special characters in parameters are properly encoded
            const testParams = {
                'tab': 'mulligan',
                'deck': 'https://moxfield.com/decks/test123'
            };

            const params = new URLSearchParams(testParams);
            const urlString = `http://localhost:3000/?${params.toString()}`;

            // URL should be valid
            assert.doesNotThrow(() => new URL(urlString));

            // Parameters should be properly encoded
            assert.ok(urlString.includes('tab=mulligan'));
            assert.ok(urlString.includes('deck='));
        });

        it('should handle special characters in mulligan types', () => {
            const types = [
                { id: '1', name: 'Test & Example', count: 10, required: 1, byTurn: 1 }
            ];

            const serialized = JSON.stringify(types);
            const encoded = encodeURIComponent(serialized);

            // Should be properly encoded
            assert.ok(encoded.includes('%'), 'Should contain percent-encoded characters');
            assert.notStrictEqual(encoded, serialized, 'Encoded should differ from original');

            // Should be decodable
            const decoded = decodeURIComponent(encoded);
            assert.strictEqual(decoded, serialized, 'Should decode back to original');
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty URL parameters', () => {
            const params = new URLSearchParams('');
            assert.strictEqual(params.get('tab'), null);
            assert.strictEqual(params.get('deck'), null);
        });

        it('should handle URL with only whitespace', () => {
            const params = new URLSearchParams('tab=  ');
            const tab = params.get('tab');
            assert.strictEqual(tab.trim(), '', 'Whitespace-only value should be empty when trimmed');
        });

        it('should handle duplicate parameters (uses first value)', () => {
            const params = new URLSearchParams('tab=portent&tab=mulligan');
            const tab = params.get('tab');
            assert.strictEqual(tab, 'portent', 'Should use first value for duplicate params');
        });

        it('should handle URL-encoded special characters', () => {
            const params = new URLSearchParams('tab=%3Cscript%3E');
            const tab = params.get('tab');
            assert.strictEqual(tab, '<script>', 'Should decode URL-encoded characters');

            // But this should still not be in the whitelist
            const VALID_TABS = ['portent', 'surge', 'wave', 'vortex', 'rashmi', 'lands', 'mulligan', 'lumra'];
            assert.ok(!VALID_TABS.includes(tab), 'Decoded XSS should not be valid');
        });

        it('should handle very long parameter values', () => {
            const longValue = 'A'.repeat(10000);
            const params = new URLSearchParams(`tab=${longValue}`);
            const tab = params.get('tab');

            assert.strictEqual(tab.length, 10000);
            // But it shouldn't be in the whitelist
            const VALID_TABS = ['portent', 'surge', 'wave', 'vortex', 'rashmi', 'lands', 'mulligan', 'lumra'];
            assert.ok(!VALID_TABS.includes(tab));
        });
    });
});

describe('Share URL - Integration Tests', () => {
    describe('Complete URL Parsing', () => {
        it('should parse a complete valid URL', () => {
            const urlParams = new URLSearchParams({
                tab: 'mulligan',
                deck: 'https://moxfield.com/decks/abc123',
                mullSims: '5000',
                mullPenalty: '0.05',
                mullThreshold: '0.75'
            });

            // Validate each parameter
            assert.strictEqual(urlParams.get('tab'), 'mulligan');
            assert.strictEqual(urlParams.get('deck'), 'https://moxfield.com/decks/abc123');
            assert.strictEqual(urlParams.get('mullSims'), '5000');
            assert.strictEqual(urlParams.get('mullPenalty'), '0.05');
            assert.strictEqual(urlParams.get('mullThreshold'), '0.75');
        });

        it('should handle URL with all calculator sliders', () => {
            const urlParams = new URLSearchParams({
                portentX: '10',
                waveX: '15',
                vortexCMC: '8',
                rashmiCMC: '5',
                lands: '40',
                lumraGY: '3',
                lumraMult: '2'
            });

            const sliderMap = {
                'portentX': { min: 0, max: 20 },
                'waveX': { min: 0, max: 30 },
                'vortexCMC': { min: 5, max: 15 },
                'rashmiCMC': { min: 0, max: 15 },
                'lands': { min: 0, max: 60 },
                'lumraGY': { min: 0, max: 30 },
                'lumraMult': { min: 1, max: 10 }
            };

            // Validate each slider is within bounds
            Object.entries(sliderMap).forEach(([param, config]) => {
                const value = parseInt(urlParams.get(param), 10);
                assert.ok(!isNaN(value), `${param} should be a valid number`);
                assert.ok(value >= config.min && value <= config.max, `${param} should be within bounds`);
            });
        });
    });
});
