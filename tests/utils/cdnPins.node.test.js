import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app loads Chart.js and LZ-String from a CDN at pinned versions. The
 * devDependencies of the same name are local copies of those exact files:
 * unit tests import LZ-String, and the browser tests serve both instead of
 * the CDN (tests/e2e/helpers/network.js). Bumping one side alone would test
 * a different library than users run, so bump them together (Dependabot
 * leaves these two to us: see .github/dependabot.yml).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

const vendor = read('js/shell/vendor.js');
const pins = {
    'chart.js': vendor.match(/CHART_JS_URL = '[^']*\/chart\.js@(\d+\.\d+\.\d+)\//)?.[1],
    'lz-string': vendor.match(/LZ_STRING_URL = '[^']*\/lz-string@(\d+\.\d+\.\d+)\//)?.[1]
};

describe('CDN scripts and their local copies', () => {
    for (const [name, pinned] of Object.entries(pins)) {
        it(`${name}: devDependency matches the CDN pin`, () => {
            assert.ok(pinned, `could not find the pinned ${name} CDN URL`);
            assert.equal(pkg.devDependencies?.[name], pinned,
                `package.json pins ${name}@${pkg.devDependencies?.[name]} but the app loads ${pinned}; bump both (and run npm run sw:manifest)`);
        });
    }
});
