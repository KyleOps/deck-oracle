/**
 * Performance budgets for the deck-analysis code that runs on every deck
 * change (overview, compare, mana checks). These run synchronously on the main
 * thread, so they must stay well inside one animation frame for a 99-card deck.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeckStats, healthChecks, colorCastProbability } from '../../js/utils/deckStats.js';
import { compareDecks } from '../../js/utils/deckCompare.js';
import { tagDeck } from '../../js/utils/cardTags.js';
import { FORMATS } from '../../js/utils/format.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { budget, medianMs as timeIt } from '../helpers/timing.js';

describe('deck analysis performance budgets', () => {
    it('analyses a 99-card Commander deck in under one frame (16 ms)', () => {
        const ms = timeIt(() => healthChecks(analyzeDeckStats(DEFAULT_DECK_DATA, { format: FORMATS.commander })));
        assert.ok(ms < budget(16), `analyzeDeckStats + healthChecks took ${ms.toFixed(2)} ms`);
    });

    it('tags a whole deck in under 5 ms', () => {
        const ms = timeIt(() => tagDeck(DEFAULT_DECK_DATA.cardsByName));
        assert.ok(ms < budget(5), `tagDeck took ${ms.toFixed(2)} ms`);
    });

    it('computes a castability check in well under a millisecond', () => {
        const ms = timeIt(() => {
            for (let turn = 1; turn <= 8; turn++) {
                colorCastProbability({ deckSize: 99, lands: 37, sources: 20, pips: 3, landsNeeded: turn, seen: 7 + turn });
            }
        }) / 8;
        assert.ok(ms < budget(1), `colorCastProbability averaged ${ms.toFixed(3)} ms`);
    });

    it('compares two decks in under two frames (32 ms)', () => {
        const ms = timeIt(() => compareDecks(DEFAULT_DECK_DATA, DEFAULT_DECK_DATA));
        assert.ok(ms < budget(32), `compareDecks took ${ms.toFixed(2)} ms`);
    });
});
