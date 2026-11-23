/**
 * Game Plan presets — hand-tuned plans that come with their deck.
 *
 * This catalog is small and loads with the Game Plan page: just enough to
 * list the presets and to recognise a deck one was made for (by its
 * commanders, its deck link or its name). Each preset's data — the plan, the
 * notes and the bundled deck — is its own module, imported the first time
 * it is used.
 *
 * A preset module (js/data/plans/<id>.js) exports:
 *   id          the catalog id
 *   title       its name in the picker
 *   deckUrl     the deck's Moxfield/Archidekt link (share links carry it), or null
 *   measuredOn  the day (YYYY-MM-DD) the list was taken and the notes measured;
 *               the page says so beside the notes, and how far the deck in use
 *               is from that list
 *   commanders  the command zone, by name ([] outside Commander)
 *   plan        the plan (js/utils/planSchema.js)
 *   notes       the analysis shown with the plan: a paragraph per string
 *               (how the plan works, what carries it, what holds it back —
 *               numbers from the simulator, never guessed)
 *   snapshot    the deck as deckLibrary.js saves it: { name, commanders:
 *               [{name, card}], counts, actualCardCount, cardsByName, format }
 *               with Scryfall-shaped card records
 * Add the same id, title, commanders, deckUrl and deckName here.
 */

export const PLAN_PRESETS = Object.freeze([
    Object.freeze({
        id: 'wild-splendor',
        title: 'Wild Splendor — Selvala',
        commanders: Object.freeze(['Selvala, Eager Trailblazer']),
        deckUrl: 'https://moxfield.com/decks/oWiA7YWonEyzPMyVCiHkIw',
        deckName: 'Wild Splendor',
        load: () => import('./wild-splendor.js')
    }),
    Object.freeze({
        id: 'doctor-whostoric',
        title: 'Doctor Whostoric — The Sixth Doctor + Susan',
        commanders: Object.freeze(['The Sixth Doctor', 'Susan Foreman']),
        deckUrl: 'https://moxfield.com/decks/BdgPCOK4IUyNd2287K2mvg',
        deckName: 'Doctor Whostoric',
        load: () => import('./doctor-whostoric.js')
    })
]);

/** A preset's catalog entry by id, or null. */
export function presetEntry(id) {
    return PLAN_PRESETS.find(p => p.id === id) ?? null;
}
