import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const serviceWorkerSource = readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');
const manifestSource = serviceWorkerSource.match(/const STATIC_ASSETS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
const staticAssets = [...manifestSource.matchAll(/'([^']+)'/g)].map(match => match[1]);

function listJavaScriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
        return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
    });
}

describe('service worker asset manifest', () => {
    it('uses paths relative to the service-worker scope', () => {
        const localAssets = staticAssets.filter(asset => !asset.startsWith('http'));
        assert.ok(localAssets.length > 0, 'expected local assets in the cache manifest');
        assert.equal(
            localAssets.some(asset => asset.startsWith('/')),
            false,
            'root-relative paths break when deployed beneath /deck-oracle/'
        );
    });

    it('references local files that exist', () => {
        const fileAssets = staticAssets.filter(asset => !asset.startsWith('http') && asset !== './');
        const missing = fileAssets.filter(asset => !existsSync(path.join(projectRoot, asset)));
        assert.deepEqual(missing, []);
    });

    it('pre-caches every JavaScript module', () => {
        const javascriptFiles = listJavaScriptFiles(path.join(projectRoot, 'js'))
            .map(file => path.relative(projectRoot, file).split(path.sep).join('/'));
        const missing = javascriptFiles.filter(file => !staticAssets.includes(file));

        assert.deepEqual(missing, [], `missing JavaScript assets: ${missing.join(', ')}`);
    });

    it('pre-caches both external runtime scripts from index.html', () => {
        assert.ok(staticAssets.includes('https://cdn.jsdelivr.net/npm/chart.js'));
        assert.ok(staticAssets.includes('https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js'));
    });
});
