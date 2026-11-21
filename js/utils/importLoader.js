/**
 * The deck import code loads on the first import, not at startup: the deck
 * state and the opponent seats both start imports through here.
 *
 * decklistImport.js and its helpers (text parsing, deck sites, Scryfall,
 * fetchJson) are about 13 KB gzipped that most visits never use.
 */

let importer = null;

/**
 * decklistImport.js, fetched once. A failed download is retried next time.
 * @returns {Promise<typeof import('./decklistImport.js')>}
 */
export function loadImporter() {
    importer ??= import('./decklistImport.js').catch(error => {
        importer = null;
        throw error;
    });
    return importer;
}

/**
 * A failed import in one plain sentence (see fetchJson.friendlyImportError,
 * already loaded by the import that failed). If even that can't be loaded,
 * the connection is the problem.
 * @param {unknown} error
 * @param {{isUrl?:boolean}} [opts]
 * @returns {Promise<string>}
 */
export async function explainImportError(error, { isUrl = true } = {}) {
    try {
        const { friendlyImportError } = await import('./fetchJson.js');
        return friendlyImportError(error, { isUrl });
    } catch {
        return 'Couldn’t load the importer. Check your connection and try again.';
    }
}
