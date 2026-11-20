/**
 * Regenerate the STATIC_ASSETS list in sw.js from the files on disk.
 *
 * Usage: npm run sw:manifest
 *
 * Every CSS file, every JS module and the external runtime scripts are
 * pre-cached so the app works offline. A test (serviceWorkerAssets) fails if
 * this list falls out of date.
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
        ...walk('css', '.css'),
        ...walk('js', '.js'),
        ...EXTERNAL_ASSETS
    ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
