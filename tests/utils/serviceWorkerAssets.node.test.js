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

    it('pre-caches every stylesheet', () => {
        const cssFiles = readdirSync(path.join(projectRoot, 'css')).filter(f => f.endsWith('.css')).map(f => `css/${f}`);
        assert.deepEqual(cssFiles.filter(f => !staticAssets.includes(f)), []);
    });

    it('pre-caches the pinned external runtime scripts the app loads', () => {
        const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
        const vendor = readFileSync(path.join(projectRoot, 'js/shell/vendor.js'), 'utf8');
        const chartUrl = vendor.match(/CHART_JS_URL = '([^']+)'/)?.[1];
        assert.ok(chartUrl, 'vendor.js declares the Chart.js URL');
        assert.match(chartUrl, /@\d+\.\d+\.\d+\//, 'Chart.js must be pinned to an exact version');
        assert.ok(staticAssets.includes(chartUrl), 'pinned Chart.js is pre-cached');
        const lz = html.match(/src="(https:\/\/cdn\.jsdelivr\.net\/npm\/lz-string[^"]+)"/)?.[1];
        assert.ok(lz && staticAssets.includes(lz), 'LZ-String is pre-cached');
    });

    it('preloads the whole startup import graph (npm run sw:manifest)', async () => {
        const { preloadTags } = await import('../../scripts/update-sw-manifest.mjs');
        const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
        const block = html.match(/<!-- BEGIN MODULEPRELOAD -->\r?\n([\s\S]*?)\r?\n\s*<!-- END MODULEPRELOAD -->/)?.[1];
        assert.equal(block?.replace(/\r\n/g, '\n'), preloadTags());
    });

    it('is regenerated from disk (npm run sw:manifest)', async () => {
        const { buildAssetList } = await import('../../scripts/update-sw-manifest.mjs');
        assert.deepEqual(staticAssets, buildAssetList());
    });
});
