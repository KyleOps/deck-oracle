/**
 * Fetching JSON with a deadline, and explaining what went wrong in words a
 * player can act on.
 *
 * Every network call the importers make goes through `fetchJson`, so none of
 * them can hang forever (a stalled proxy used to block every later import).
 * `friendlyImportError` turns any import failure, network or parsing, into one
 * short sentence; the deck dialog and the opponent seats both use it, so the
 * same failure reads the same everywhere.
 */

/** Default deadline for one request. */
export const DEFAULT_TIMEOUT_MS = 15000;

/**
 * A failed request. `kind` says what failed:
 *   'timeout' (no answer in time), 'aborted' (the caller cancelled),
 *   'network' (no connection / CORS / DNS), 'http' (an error status, see
 *   `status`) or 'parse' (the body was not JSON).
 */
export class FetchError extends Error {
    constructor(message, { kind, status = null, url = '', cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'FetchError';
        this.kind = kind;
        this.status = status;
        this.url = url;
    }
}

/**
 * One signal that aborts when any of the given signals does.
 * @param {Array<AbortSignal|null|undefined>} signals
 * @returns {AbortSignal|undefined}
 */
function anySignal(signals) {
    const live = signals.filter(Boolean);
    if (live.length <= 1) return live[0];
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(live);
    const controller = new AbortController();
    for (const s of live) {
        if (s.aborted) {
            controller.abort(s.reason);
            break;
        }
        s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
    }
    return controller.signal;
}

/**
 * Fetch a URL and parse its JSON body, giving up after `timeoutMs`.
 * @param {string} url
 * @param {{timeoutMs?:number, signal?:AbortSignal, method?:string, headers?:Object, body?:string}} [opts]
 * @returns {Promise<any>} the parsed body
 * @throws {FetchError}
 */
export async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = {}) {
    if (signal?.aborted) throw new FetchError('The request was cancelled.', { kind: 'aborted', url });
    const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null;
    const failure = (error, fallback) => {
        if (signal?.aborted) return new FetchError('The request was cancelled.', { kind: 'aborted', url, cause: error });
        if (timeout?.aborted || error?.name === 'TimeoutError') {
            return new FetchError(`No answer within ${Math.round(timeoutMs / 1000)} seconds.`, { kind: 'timeout', url, cause: error });
        }
        return fallback;
    };
    let response;
    try {
        response = await fetch(url, { ...init, signal: anySignal([signal, timeout]) });
    } catch (error) {
        throw failure(error, new FetchError('Failed to fetch.', { kind: 'network', url, cause: error }));
    }
    if (!response.ok) {
        // Error bodies (Scryfall's "details") are worth keeping for the log.
        const body = await response.json().catch(() => null);
        throw new FetchError(body?.details || `HTTP ${response.status}`, { kind: 'http', status: response.status, url });
    }
    try {
        return await response.json();
    } catch (error) {
        // The deadline covers the body too: a stalled stream is a timeout.
        throw failure(error, new FetchError('The answer was not valid JSON.', { kind: 'parse', url, cause: error }));
    }
}

/**
 * One short sentence for a failed import.
 * @param {unknown} error - anything an importer threw
 * @param {{isUrl?:boolean}} [opts] - true for a deck link, false for a pasted list
 * @returns {string}
 */
export function friendlyImportError(error, { isUrl = true } = {}) {
    const raw = String(error?.message ?? error ?? '').trim();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'You appear to be offline.';
    const site = isUrl ? 'the deck site' : 'Scryfall';
    if (error?.kind === 'timeout') return `${isUrl ? 'The deck site' : 'Scryfall'} took too long to answer. Try again in a moment.`;
    if (error?.kind === 'network' || /failed to fetch|networkerror|network request/i.test(raw)) {
        return isUrl ? 'Couldn’t reach the deck site. Check the link and your connection.' : 'Couldn’t reach Scryfall. Check your connection.';
    }
    if (error?.kind === 'http') {
        const status = Number(error.status);
        if (status === 404) return isUrl ? 'That deck wasn’t found. Check the link, and that the deck is public.' : 'Scryfall couldn’t find those cards.';
        if (status === 401 || status === 403) return 'That deck is private. Make it public or unlisted, then try again.';
        if (status === 429) return `${isUrl ? 'The deck site' : 'Scryfall'} is busy. Wait a minute and try again.`;
        if (status >= 500) return `${isUrl ? 'The deck site' : 'Scryfall'} isn’t answering right now (error ${status}). Try again in a minute.`;
        return `Couldn’t load from ${site} (error ${status}).`;
    }
    if (error?.kind === 'parse') return `${isUrl ? 'The deck site' : 'Scryfall'} sent something unexpected. Try again in a minute.`;
    if (/no cards found|invalid decklist/i.test(raw)) return 'No cards found. Paste one card per line, like “1 Sol Ring”.';
    if (/none of those cards/i.test(raw)) return 'None of those cards were recognised. Check the spelling, one card per line.';
    if (/invalid url|supports moxfield/i.test(raw)) return 'That link isn’t a Moxfield or Archidekt deck.';
    return raw || 'The import failed.';
}
