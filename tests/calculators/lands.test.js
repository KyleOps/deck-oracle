import { describe, it, assert, assertClose } from '../test-helper.js';
import { calculate } from '../../js/calculators/lands.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

describe('Land Drop Calculator', () => {
    // Setup Deck via public API
    DeckConfig.updateDeck({
        lands: 24,
        creatures: 0,
        instants: 36,
        sorceries: 0,
        artifacts: 0,
        enchantments: 0,
        planeswalkers: 0,
        battles: 0,
        cardsByName: {
            'Land': { name: 'Land', cmc: 0, count: 24, type_line: 'Land', mana_cost: '' },
            'Spell': { name: 'Spell', cmc: 1, count: 36, type_line: 'Instant', mana_cost: '{1}' }
        }
    });

    it('calculates median opening hand lands correctly', () => {
        const { openingHands } = calculate();
        // 24/60 = 40%. 7 * 0.4 = 2.8.
        // Median should be 3
        assert(openingHands.median === 3, 'Median hand is 3');
    });

    it('calculates expected miss turn reasonably', () => {
        const { landDropMiss } = calculate();
        // With 24 lands, usually miss around turn 4-6
        assert(landDropMiss >= 4 && landDropMiss <= 6, `Land drop miss turn ${landDropMiss} is reasonable`);
    });
});