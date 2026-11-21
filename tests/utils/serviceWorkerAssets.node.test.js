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

describe('page module preloads', () => {
    const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

    it('embeds every page’s lazy module chain (npm run sw:manifest)', async () => {
        const { pageModulesTag } = await import('../../scripts/update-sw-manifest.mjs');
        const block = html.match(/<!-- BEGIN PAGE MODULES -->\r?\n([\s\S]*?)\r?\n\s*<!-- END PAGE MODULES -->/)?.[1];
        assert.equal(block, pageModulesTag());
    });

    it('lists, for every page, its calculator and view and nothing the shell already preloads', async () => {
        const { pageModuleMap, staticImportGraph } = await import('../../scripts/update-sw-manifest.mjs');
        const { CALCULATORS, DEFAULT_TAB } = await import('../../js/utils/calculatorRegistry.js');
        const map = pageModuleMap();
        const startup = new Set(['js/main.js', ...staticImportGraph('js/main.js')]);
        assert.equal(map.default, DEFAULT_TAB);
        assert.deepEqual(Object.keys(map.pages).sort(), Object.keys(CALCULATORS).sort());
        for (const [key, files] of Object.entries(map.pages)) {
            assert.ok(files.includes(`js/calculators/${key}.js`), `${key}: calculator module`);
            assert.ok(files.includes(`js/views/${key}.js`), `${key}: view module`);
            assert.deepEqual(files.filter(f => startup.has(f)), [], `${key}: duplicates the startup preloads`);
            assert.deepEqual(files.filter(f => !existsSync(path.join(projectRoot, f))), [], `${key}: missing files`);
            assert.equal(new Set(files).size, files.length, `${key}: listed twice`);
        }
    });

    it('covers each page’s whole static import graph', async () => {
        const { pageModuleMap, staticImportGraph } = await import('../../scripts/update-sw-manifest.mjs');
        const startup = new Set(['js/main.js', ...staticImportGraph('js/main.js')]);
        const { pages } = pageModuleMap();
        for (const [key, files] of Object.entries(pages)) {
            const needed = staticImportGraph(`js/calculators/${key}.js`).filter(f => !startup.has(f));
            assert.deepEqual(needed.filter(f => !files.includes(f)), [], `${key}: chain is missing modules`);
        }
    });

    it('preloads the landing page before any stylesheet can hold the script back', () => {
        const head = html.slice(0, html.indexOf('</head>'));
        const script = head.indexOf("getElementById('page-modules')");
        const firstStylesheet = head.search(/<link[^>]+rel="stylesheet"|<link[^>]+stylesheet"/);
        assert.ok(script > 0, 'inline page-module preloader');
        assert.ok(firstStylesheet > script, 'every stylesheet comes after the preloader');
        assert.ok(head.indexOf('id="page-modules"') < script, 'the map is parsed before the preloader runs');
    });

    it('reads static imports and re-exports, never dynamic imports', async () => {
        const { staticImports } = await import('../../scripts/update-sw-manifest.mjs');
        const source = [
            "import { a } from './a.js';",
            'import {',
            '    b,',
            '    c',
            "} from '../b.js';",
            "import './side-effect.js';",
            "import * as ns from './ns.js';",
            "export { d } from './d.js';",
            "export * from './e.js';",
            "const lazy = () => import('./lazy.js');",
            "    import('./also-lazy.js').then(m => m);",
            "const later = await import('./later.js');",
            "import pkg from 'bare-package';"
        ].join('\n');
        assert.deepEqual(staticImports(source), ['./a.js', '../b.js', './side-effect.js', './ns.js', './d.js', './e.js']);
    });
});

describe('service worker cache isolation', () => {
    it('never looks requests up across every cache', () => {
        // A global caches.match() also searches caches left by older workers
        // (v2 used `mtg-calc-v*`) and would serve their stale JS to v3 pages.
        assert.doesNotMatch(serviceWorkerSource, /caches\.match\(/);
    });

    it('deletes every cache that is not current on activate', () => {
        const activate = serviceWorkerSource.match(/addEventListener\('activate'[\s\S]*?\n\}\);/)?.[0] ?? '';
        assert.match(activate, /name !== CACHE_NAME && name !== IMAGE_CACHE/);
        assert.doesNotMatch(activate, /startsWith\(/, 'filtering by prefix would keep legacy caches alive');
    });
});
