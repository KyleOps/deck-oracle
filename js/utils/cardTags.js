/**
 * Card role tagging — what a card DOES for the deck, read from its rules text.
 *
 * These are heuristics, deliberately conservative: a tag should mean "most
 * players would count this as ramp/draw/removal", so false positives are worse
 * than misses (a deck health check that counts Lightning Greaves as removal is
 * worse than one that misses an oddly-worded edict). Every rule is tested
 * against real card text in tests/utils/cardTags.node.test.js.
 */

import { isLand } from './mana.js';

/** Display metadata, in the order the overview lists them. */
export const TAGS = Object.freeze({
    ramp:       { label: 'Ramp',         hint: 'Mana rocks, dorks, and land-fetching spells' },
    draw:       { label: 'Card draw',    hint: 'Draws or impulse-draws extra cards' },
    removal:    { label: 'Removal',      hint: 'Destroys, exiles, bounces or damages a single target' },
    wipe:       { label: 'Board wipes',  hint: 'Hits every creature or permanent at once' },
    counter:    { label: 'Counterspells', hint: 'Counters a spell or ability' },
    tutor:      { label: 'Tutors',       hint: 'Searches the library for a nonland card' },
    recursion:  { label: 'Recursion',    hint: 'Returns cards from the graveyard' },
    protection: { label: 'Protection',   hint: 'Grants hexproof, indestructible, or phases out' }
});

const RX = {
    addMana: /\badd (\{[wubrgcs0-9x]\}|one mana|two mana|three mana|x mana|mana|an amount of)/,
    landSearch: /search your library for (a|an|up to (one|two|three|x)|two|three) [^.]*?\b(land|forest|island|swamp|mountain|plains) cards?\b/,
    landToBattlefield: /put (a|an|up to \w+) [^.]*?land cards? [^.]*?onto the battlefield/,
    extraLand: /(play|put) (an|two|one) additional lands?/,
    treasure: /create (a|an|one|two|three|x|\w+) treasure tokens?/,

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

/**
 * Tag one card.
 * @param {Object} card - Scryfall-shaped card record
 * @returns {string[]} tag keys from TAGS
 */
export function tagCard(card) {
    if (!card) return [];
    const text = String(card.oracle_text ?? '').toLowerCase();
    const typeLine = String(card.type_line ?? '').split('//')[0].toLowerCase();
    const tags = new Set();
    const land = isLand(card);

    if (!land) {
        // Ramp: mana abilities on nonland permanents, land-fetch spells, extra
        // land drops, treasure makers. "Add" inside a reminder-text-free
        // activated ability is the classic rock/dork shape.
        // One-shot rituals ("Add {B}{B}{B}" on an instant) are deliberately not
        // ramp: they accelerate a single turn, not the deck.
        const isPermanent = /\b(artifact|creature|enchantment|planeswalker)\b/.test(typeLine);
        if ((isPermanent && RX.addMana.test(text))
            || RX.landSearch.test(text)
            || RX.landToBattlefield.test(text)
            || RX.extraLand.test(text)
            || (RX.treasure.test(text) && /instant|sorcery|artifact|enchantment/.test(typeLine))) {
            tags.add('ramp');
        }

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

    return Object.keys(TAGS).filter(t => tags.has(t));
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
