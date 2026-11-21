/**
 * Card role tagging — what a card DOES for the deck, read from its rules text.
 *
 * These are heuristics, deliberately conservative: a tag should mean "most
 * players would count this as ramp/draw/removal", so false positives are worse
 * than misses (a deck health check that counts Lightning Greaves as removal is
 * worse than one that misses an oddly-worded edict). Every rule is tested
 * against real card text in tests/utils/cardTags.node.test.js.
 *
 * Ramp is not decided here: it is the shared rule in ramp.js, the same
 * classifier Mana Development simulates with, so every page counts the same
 * cards as ramp (Mana Development then says which of them it can simulate).
 */

import { isLand } from './mana.js';
import { isRampCard } from './ramp.js';

/** Display metadata, in the order the overview lists them. */
export const TAGS = Object.freeze({
    ramp:       { label: 'Ramp',         hint: 'Mana rocks and dorks, land ramp, extra land drops and Treasure — the cards Mana Development reads as ramp' },
    draw:       { label: 'Card draw',    hint: 'Draws or impulse-draws extra cards' },
    removal:    { label: 'Removal',      hint: 'Destroys, exiles, bounces or damages a single target' },
    wipe:       { label: 'Board wipes',  hint: 'Hits every creature or permanent at once' },
    counter:    { label: 'Counterspells', hint: 'Counters a spell or ability' },
    tutor:      { label: 'Tutors',       hint: 'Searches the library for a nonland card' },
    recursion:  { label: 'Recursion',    hint: 'Returns cards from the graveyard' },
    protection: { label: 'Protection',   hint: 'Grants hexproof, indestructible, or phases out' }
});

const RX = {
    draw: /\bdraws? (a|an|one|two|three|four|five|six|seven|x|that many|\w+) cards?\b|\bdraw cards equal\b|\bdraw a card for each\b/,
    drawOpponentOnly: /^target opponent draws|each opponent draws/,
    impulse: /exile the top [^.]*? cards? of your library[^.]*?\. (until|you may (play|cast))/,
    investigate: /\binvestigate\b/,

    removal: /(destroy|exile) (target|up to (one|two|three|x) target|another target)(?! card[^.]* (from|in) (a|your|their|target player's) graveyard)[^.]*?(creature|permanent|artifact|enchantment|planeswalker|nonland|battle)/,
    damage: /deals? (\d+|x|damage equal to [^.]*?) damage to (any target|target creature|target (creature|planeswalker) or|target (attacking|blocking))/,
    bounce: /return (target|up to (one|two) target) (nonland )?(creature|permanent|artifact|enchantment|nonland permanent)s?[^.]*? to (its|their) owner's hand/,
    fight: /\bfights? (target|another target|up to one target)\b/,
    minus: /target creature (an opponent controls )?gets -(\d+|x)\/-(\d+|x)/,
    edict: /(each|target) (opponent|player) sacrifices (a|an|two|x)? ?(creature|permanent|nonland)/,

    wipe: /(destroy|exile) (all|each) [^.]*?(creatures|permanents|artifacts|enchantments|nonland)|all creatures get -|deals? (\d+|x) damage to each creature|return all (nonland )?(creatures|permanents)[^.]*? to (their|its) owners'? hands?|each player sacrifices (all|x|a number)/,

    counter: /\bcounter target\b/,

    tutor: /search your library for (a|an|up to (one|two|three)|two|three) (?![^.]*?\b(land|forest|island|swamp|mountain|plains) cards?\b)[^.]*?cards?\b/,

    recursion: /return (target|up to (one|two|three|x) target|all|a|an) [^.]*?cards? from (your|a) graveyard to (your hand|the battlefield)|from your graveyard (to|onto) (your hand|the battlefield)|you may (cast|play) [^.]*? from your graveyard/,

    protection: /(gains?|have|has) (hexproof|indestructible|shroud|protection from)|phases? out|can't be (countered|the target)|ward\b/
};

const NO_TAGS = Object.freeze([]);
const memo = new WeakMap();

/**
 * Tag one card. Memoised per card record (records are immutable), so tagging
 * a deck on every render reads each card once.
 * @param {Object} card - Scryfall-shaped card record
 * @returns {ReadonlyArray<string>} tag keys from TAGS (frozen, shared)
 */
export function tagCard(card) {
    if (!card || typeof card !== 'object') return NO_TAGS;
    let tags = memo.get(card);
    if (!tags) {
        tags = readTags(card);
        memo.set(card, tags);
    }
    return tags;
}

function readTags(card) {
    const text = String(card.oracle_text ?? '').toLowerCase();
    const tags = new Set();
    const land = isLand(card);

    if (!land) {
        // Ramp: the shared rule (ramp.js). One-shot rituals and cost reducers
        // are deliberately not ramp: they make one turn or one spell cheaper,
        // not the deck faster.
        if (isRampCard(card)) tags.add('ramp');

        if ((RX.draw.test(text) && !RX.drawOpponentOnly.test(text)) || RX.impulse.test(text) || RX.investigate.test(text)) {
            tags.add('draw');
        }

        if (RX.wipe.test(text)) tags.add('wipe');
        if (RX.removal.test(text) || RX.damage.test(text) || RX.bounce.test(text)
            || RX.fight.test(text) || RX.minus.test(text) || RX.edict.test(text)) {
            tags.add('removal');
        }
        if (RX.counter.test(text)) tags.add('counter');
        if (RX.tutor.test(text)) tags.add('tutor');
        if (RX.recursion.test(text)) tags.add('recursion');
        if (RX.protection.test(text) && /\b(creatures|permanents) you control\b|target (creature|permanent) you control|equipped creature|enchanted creature/.test(text)) {
            tags.add('protection');
        }
    }

    return Object.freeze(Object.keys(TAGS).filter(t => tags.has(t)));
}

/**
 * Tag a whole deck.
 * @param {Record<string, Object>} cardsByName
 * @returns {{byCard: Record<string,string[]>, counts: Record<string,number>, members: Record<string,string[]>}}
 *   counts are weighted by copies; members lists card names per tag
 */
export function tagDeck(cardsByName = {}) {
    const byCard = {};
    const counts = Object.fromEntries(Object.keys(TAGS).map(t => [t, 0]));
    const members = Object.fromEntries(Object.keys(TAGS).map(t => [t, []]));
    for (const card of Object.values(cardsByName)) {
        const copies = Number(card?.count) || 0;
        if (!card?.name || copies <= 0) continue;
        const tags = tagCard(card);
        byCard[card.name] = tags;
        tags.forEach(t => {
            counts[t] += copies;
            members[t].push(card.name);
        });
    }
    return { byCard, counts, members };
}
