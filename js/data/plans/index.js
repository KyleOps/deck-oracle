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
 *   commanders  the command zone, by name ([] outside Commander)
 *   plan        the plan (js/utils/planSchema.js)
 *   notes       one or two sentences on why the plan works
 *   snapshot    the deck as deckLibrary.js saves it: { name, commanders:
 *               [{name, card}], counts, actualCardCount, cardsByName, format }
 *               with Scryfall-shaped card records
 * Add the same id, title, commanders, deckUrl and deckName here.
 */

export const PLAN_PRESETS = Object.freeze([
    Object.freeze({
        id: 'sample-green',
        title: 'Sample: green ramp (40 cards)',
        commanders: Object.freeze([]),
        deckUrl: null,
        deckName: 'Sample green ramp',
        load: () => import('./sample-green.js')
    })
]);

/** A preset's catalog entry by id, or null. */
export function presetEntry(id) {
    return PLAN_PRESETS.find(p => p.id === id) ?? null;
}
