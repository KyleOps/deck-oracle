/**
 * Regenerate build metadata from the files on disk.
 *
 * Usage: npm run sw:manifest
 *
 * 1. sw.js STATIC_ASSETS — every CSS file, every JS module and the external
 *    runtime scripts are pre-cached so the app works offline.
 * 2. index.html modulepreload hints — the static import graph of js/main.js,
 *    so the browser fetches the whole startup graph in parallel instead of
 *    discovering it one import level at a time.
 *
 * Tests (serviceWorkerAssets) fail if either falls out of date.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const EXTERNAL_ASSETS = [
    'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js'
];

function walk(dir, ext) {
    return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return walk(rel, ext);
        return entry.name.endsWith(ext) ? [rel] : [];
    }).sort();
}

export function buildAssetList() {
    return [
        './',
        'index.html',
        'manifest.json',
        'images/icon.svg',
        'images/icon-180.png',
        'images/icon-192.png',
        'images/icon-512.png',
        'images/icon-maskable-512.png',
        ...walk('css', '.css'),
        ...walk('js', '.js'),
        ...EXTERNAL_ASSETS
    ];
}

/**
 * Static (non-dynamic) import graph reachable from an entry module.
 * @param {string} entry - path relative to the repo root
 * @returns {string[]} module paths in discovery order, entry excluded
 */
export function staticImportGraph(entry = 'js/main.js') {
    const seen = new Set([entry]);
    const queue = [entry];
    const order = [];
    while (queue.length) {
        const file = queue.shift();
        const source = readFileSync(path.join(root, file), 'utf8');
        // `import … from '…'` and bare `import '…'`; dynamic import() is skipped
        for (const m of source.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
            const dep = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
            if (seen.has(dep)) continue;
            seen.add(dep);
            order.push(dep);
            queue.push(dep);
        }
    }
    return order;
}

export function preloadTags() {
    return staticImportGraph().map(f => `    <link rel="modulepreload" href="${f}">`).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const htmlPath = path.join(root, 'index.html');
    const html = readFileSync(htmlPath, 'utf8');
    writeFileSync(htmlPath, html.replace(
        /<!-- BEGIN MODULEPRELOAD -->[\s\S]*?<!-- END MODULEPRELOAD -->/,
        `<!-- BEGIN MODULEPRELOAD -->\n${preloadTags()}\n    <!-- END MODULEPRELOAD -->`
    ));
    const swPath = path.join(root, 'sw.js');
    const source = readFileSync(swPath, 'utf8');
    const list = buildAssetList().map(a => `    '${a}'`).join(',\n');
    const next = source.replace(
        /\/\/ BEGIN GENERATED ASSETS[\s\S]*?\/\/ END GENERATED ASSETS/,
        `// BEGIN GENERATED ASSETS\nconst STATIC_ASSETS = [\n${list}\n];\n// END GENERATED ASSETS`
    );
    writeFileSync(swPath, next);
    console.log(`sw.js: ${buildAssetList().length} assets`);
}
