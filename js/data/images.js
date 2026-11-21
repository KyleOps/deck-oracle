/**
 * Scryfall image URLs.
 *
 * When a card record carries its Scryfall id (every import since v3 does),
 * build the CDN URL directly — one request, cacheable by the service worker.
 * Otherwise fall back to the API's named lookup, which answers with a
 * redirect to the same image (two round trips).
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {{name?:string, scryfall_id?:string}|string} card - record or name
 * @param {'small'|'normal'|'large'|'art_crop'} [version]
 * @returns {string} image URL ('' when there is nothing to look up)
 */
export function cardImageUrl(card, version = 'normal') {
    const record = typeof card === 'string' ? { name: card } : (card ?? {});
    const id = record.scryfall_id;
    if (typeof id === 'string' && ID.test(id)) {
        return `https://cards.scryfall.io/${version}/front/${id[0]}/${id[1]}/${id}.jpg`;
    }
    if (!record.name) return '';
    return `https://api.scryfall.com/cards/named?format=image&version=${version}&exact=${encodeURIComponent(record.name)}`;
}

/**
 * Find a card record by name in a cardsByName map (keys are not always the
 * display name, so match on the record's own name too).
 */
export function findCard(cardsByName = {}, name) {
    if (!name) return null;
    if (cardsByName[name]) return cardsByName[name];
    const lower = name.toLowerCase();
    return Object.values(cardsByName).find(c => c?.name?.toLowerCase() === lower) ?? null;
}
