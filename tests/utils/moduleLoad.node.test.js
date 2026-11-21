import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Every module in js/utils and js/data loads in plain Node (no DOM mocks:
 * each test file runs in its own process) and exports something.
 *
 * It also keeps the coverage gate honest: Node 22 reports coverage only for
 * files a test loaded, so without this a new, untested module would be
 * invisible to `npm run test:coverage` instead of lowering the numbers.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function modules(dir) {
    return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return modules(rel);
        return entry.name.endsWith('.js') ? [rel] : [];
    });
}

describe('pure modules load without a browser', () => {
    for (const file of [...modules('js/utils'), ...modules('js/data')]) {
        it(file, async () => {
            const mod = await import(pathToFileURL(path.join(root, file)).href);
            assert.ok(Object.keys(mod).length > 0, `${file} exports nothing`);
        });
    }
});
