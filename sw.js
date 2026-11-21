/**
 * Deck Oracle service worker — offline support.
 *
 * Strategies
 *   page navigations   network first, cached shell as the offline fallback, so
 *                      a new deploy is picked up on the next visit
 *   app assets         stale-while-revalidate from the versioned cache
 *   Scryfall images    cache first in a small bounded runtime cache, so card
 *                      art and previews keep working offline
 *   APIs (imports)     never cached
 *
 * STATIC_ASSETS is generated — run `npm run sw:manifest` after adding a file.
 * Bump CACHE_VERSION whenever shipped assets change.
 */

const CACHE_VERSION = 'v32';
const CACHE_NAME = `deck-oracle-${CACHE_VERSION}`;
const IMAGE_CACHE = 'deck-oracle-images-v1';
const IMAGE_CACHE_LIMIT = 160;

// BEGIN GENERATED ASSETS
const STATIC_ASSETS = [
    './',
    'index.html',
    'manifest.json',
    'images/icon.svg',
    'images/icon-180.png',
    'images/icon-192.png',
    'images/icon-512.png',
    'images/icon-maskable-512.png',
    'css/base.css',
    'css/components.css',
    'css/mobile.css',
    'css/shell.css',
    'css/tokens.css',
    'css/ux-enhancements.css',
    'js/calculators/abstract.js',
    'js/calculators/chimil.js',
    'js/calculators/compare.js',
    'js/calculators/dreamharvest.js',
    'js/calculators/hands.js',
    'js/calculators/lands.js',
    'js/calculators/lumra.js',
    'js/calculators/manabase.js',
    'js/calculators/manadev.js',
    'js/calculators/mara.js',
    'js/calculators/mindsdilation.js',
    'js/calculators/mulligan.js',
    'js/calculators/odds.js',
    'js/calculators/overview.js',
    'js/calculators/portent.js',
    'js/calculators/rashmi.js',
    'js/calculators/surge.js',
    'js/calculators/versus.js',
    'js/calculators/vortex.js',
    'js/calculators/vow.js',
    'js/calculators/wave.js',
    'js/calculators/wildpair.js',
    'js/data/cards.js',
    'js/data/glossary.js',
    'js/data/images.js',
    'js/main.js',
    'js/shell/deckDialog.js',
    'js/shell/overlays.js',
    'js/shell/pageHeader.js',
    'js/shell/palette.js',
    'js/shell/router.js',
    'js/shell/sidebar.js',
    'js/shell/theme.js',
    'js/shell/vendor.js',
    'js/utils/analysis.js',
    'js/utils/bigSpellComparison.js',
    'js/utils/bigSpells.js',
    'js/utils/calculatorBase.js',
    'js/utils/calculatorRegistry.js',
    'js/utils/cardTags.js',
    'js/utils/castAnimation.js',
    'js/utils/castability.js',
    'js/utils/chartHelpers.js',
    'js/utils/components.js',
    'js/utils/deckCompare.js',
    'js/utils/deckConfig.js',
    'js/utils/deckLibrary.js',
    'js/utils/deckProfile.js',
    'js/utils/deckRadar.js',
    'js/utils/deckStats.js',
    'js/utils/decklistImport.js',
    'js/utils/defaultDeckData.js',
    'js/utils/discover.js',
    'js/utils/drawOdds.js',
    'js/utils/format.js',
    'js/utils/handLab.js',
    'js/utils/hypergeometric.js',
    'js/utils/landDrops.js',
    'js/utils/mana.js',
    'js/utils/manaDevelopment.js',
    'js/utils/mulliganModel.js',
    'js/utils/opponentPages.js',
    'js/utils/opponentState.js',
    'js/utils/payback.js',
    'js/utils/percent.js',
    'js/utils/sampleSimulator.js',
    'js/utils/share.js',
    'js/utils/simulation.js',
    'js/utils/tableUtils.js',
    'js/utils/ui.js',
    'js/utils/viz.js',
    'js/views/abstract.js',
    'js/views/chimil.js',
    'js/views/compare.js',
    'js/views/dreamharvest.js',
    'js/views/hands.js',
    'js/views/lands.js',
    'js/views/lumra.js',
    'js/views/manabase.js',
    'js/views/manadev.js',
    'js/views/mara.js',
    'js/views/mindsdilation.js',
    'js/views/mulligan.js',
    'js/views/odds.js',
    'js/views/overview.js',
    'js/views/portent.js',
    'js/views/rashmi.js',
    'js/views/surge.js',
    'js/views/versus.js',
    'js/views/vortex.js',
    'js/views/vow.js',
    'js/views/wave.js',
    'js/views/wildpair.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js'
];
// END GENERATED ASSETS

const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const IMAGE_HOSTS = ['cards.scryfall.io'];

function resolveAssetUrl(asset) {
    return new URL(asset, self.registration.scope).href;
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => Promise.allSettled(
                // Individually, so one failed asset doesn't sink the install
                STATIC_ASSETS.map(asset => cache.add(resolveAssetUrl(asset)))
            ))
            .then(results => {
                const failed = results.filter(r => r.status === 'rejected').length;
                if (failed > 0) console.warn(`[SW] ${failed}/${STATIC_ASSETS.length} assets failed to cache`);
            })
    );
    // Deliberately no skipWaiting(): the page offers a reload instead, so a
    // half-updated app never runs old JS against new HTML.
});

self.addEventListener('activate', event => {
    // Delete EVERY cache that isn't current — including the v2 worker's
    // `mtg-calc-v*` caches, which would otherwise keep serving old JS.
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(names
                .filter(name => name !== CACHE_NAME && name !== IMAGE_CACHE)
                .map(name => caches.delete(name))))
            .then(() => self.clients.claim())
    );
});

/** Look a request up in ONE named cache — never across all of them. */
async function matchIn(cacheName, request) {
    const cache = await caches.open(cacheName);
    return cache.match(request);
}

async function trimCache(name, limit) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function networkFirstPage(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(resolveAssetUrl('index.html'), response.clone());
        }
        return response;
    } catch {
        return (await matchIn(CACHE_NAME, resolveAssetUrl('index.html'))) ?? Response.error();
    }
}

async function staleWhileRevalidate(event) {
    const { request } = event;
    const cached = await matchIn(CACHE_NAME, request);
    const network = fetch(request).then(response => {
        if (response.ok || response.type === 'opaque') {
            caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
    });
    if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
    }
    return network;
}

async function cacheFirstImage(event) {
    const { request } = event;
    const cached = await matchIn(IMAGE_CACHE, request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(IMAGE_CACHE);
        await cache.put(request, response.clone());
        event.waitUntil(trimCache(IMAGE_CACHE, IMAGE_CACHE_LIMIT));
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.searchParams.has('nocache')) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstPage(request));
        return;
    }
    if (IMAGE_HOSTS.includes(url.hostname)) {
        event.respondWith(cacheFirstImage(event));
        return;
    }
    if (url.origin === self.location.origin || CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(staleWhileRevalidate(event));
    }
    // Everything else (Scryfall API, Moxfield/Archidekt via the proxy) goes
    // straight to the network.
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
