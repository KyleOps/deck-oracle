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
 * 3. index.html page-modules map — for every page, the modules it needs
 *    beyond the startup graph (its calculator, its view and their static
 *    imports). Pages are imported lazily, two or three round trips deep; an
 *    inline <head> script preloads the landing page's chain from this map,
 *    and the router preloads a page's chain before it imports it.
 *
 * Only static imports count: a module that is imported dynamically (a page,
 * or a library loaded on demand) is fetched when it is needed, not up front.
 *
 * Tests (serviceWorkerAssets) fail if any of these falls out of date.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALCULATORS, DEFAULT_TAB } from '../js/utils/calculatorRegistry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The pinned CDN scripts js/shell/vendor.js loads on demand (read, never retyped). */
export const EXTERNAL_ASSETS = [...readFileSync(path.join(root, 'js/shell/vendor.js'), 'utf8')
    .matchAll(/^const \w+_URL = '(https:\/\/[^']+)';$/gm)].map(m => m[1]);

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
 * Relative specifiers a module loads statically: `import … from '…'`, bare
 * `import '…'` and `export … from '…'`. Dynamic `import('…')` is skipped.
 * @param {string} source - module source
 * @returns {string[]} specifiers in source order
 */
export function staticImports(source) {
    const pattern = /^\s*(?:import|export)\s+(?:[^'"();]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
    return [...source.matchAll(pattern)].map(m => m[1]);
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
        for (const specifier of staticImports(source)) {
            const dep = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
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

/** The module a registry loader (`() => import('…')`) imports, relative to the repo root. */
function loaderTarget(loader) {
    const specifier = String(loader).match(/import\(\s*['"]([^'"]+)['"]\s*\)/)?.[1];
    if (!specifier) throw new Error(`Cannot read the module of loader ${loader}`);
    return path.posix.normalize(path.posix.join('js/utils', specifier));
}

/**
 * Every page's lazy module chain: its calculator and view, then their static
 * imports, minus what the startup graph (already preloaded) provides.
 * @returns {{default:string, pages:Record<string, string[]>}}
 */
export function pageModuleMap() {
    const startup = new Set(['js/main.js', ...staticImportGraph('js/main.js')]);
    const pages = {};
    for (const [key, entry] of Object.entries(CALCULATORS)) {
        const chain = [];
        for (const file of [loaderTarget(entry.load), loaderTarget(entry.view)]) {
            for (const dep of [file, ...staticImportGraph(file)]) {
                if (!startup.has(dep) && !chain.includes(dep)) chain.push(dep);
            }
        }
        pages[key] = chain;
    }
    return { default: DEFAULT_TAB, pages };
}

/**
 * The page map as a script literal (not JSON text read back from the DOM), so
 * the preloader never turns document text into a URL. Paths are our own
 * module files; the preloader and router still accept only `js/….js`.
 */
export function pageModulesTag() {
    return `    <script>window.__deckOraclePages = ${JSON.stringify(pageModuleMap())};</script>`;
}

/** The only shape a preloaded module path may take (same rule in index.html and router.js). */
export const MODULE_PATH = /^js\/[A-Za-z0-9_/-]+\.js$/;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const htmlPath = path.join(root, 'index.html');
    const html = readFileSync(htmlPath, 'utf8')
        .replace(
            /<!-- BEGIN MODULEPRELOAD -->[\s\S]*?<!-- END MODULEPRELOAD -->/,
            `<!-- BEGIN MODULEPRELOAD -->\n${preloadTags()}\n    <!-- END MODULEPRELOAD -->`
        )
        .replace(
            /<!-- BEGIN PAGE MODULES -->[\s\S]*?<!-- END PAGE MODULES -->/,
            `<!-- BEGIN PAGE MODULES -->\n${pageModulesTag()}\n    <!-- END PAGE MODULES -->`
        );
    writeFileSync(htmlPath, html);
    const swPath = path.join(root, 'sw.js');
    const source = readFileSync(swPath, 'utf8');
    const list = buildAssetList().map(a => `    '${a}'`).join(',\n');
    const next = source.replace(
        /\/\/ BEGIN GENERATED ASSETS[\s\S]*?\/\/ END GENERATED ASSETS/,
        `// BEGIN GENERATED ASSETS\nconst STATIC_ASSETS = [\n${list}\n];\n// END GENERATED ASSETS`
    );
    writeFileSync(swPath, next);
    console.log(`sw.js: ${buildAssetList().length} assets; index.html: ${staticImportGraph().length} startup preloads, page map ${pageModulesTag().length} bytes`);
}
