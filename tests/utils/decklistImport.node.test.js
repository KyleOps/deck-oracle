/**
 * Tests for decklistImport.js
 * Tests parsing, validation, caching, and security features
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseDecklistText, toCommanderCard, importDeckFromUrl } from '../../js/utils/decklistImport.js';
import { budget, medianMs } from '../helpers/timing.js';

describe('Decklist Import - parseDecklistText', () => {
    describe('Basic Parsing', () => {
        it('parses simple decklist with counts', () => {
            const decklist = `4 Lightning Bolt
3 Counterspell
2 Sol Ring`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 3, 'Should parse 3 cards');
            assert.deepStrictEqual(result.cards[0], { count: 4, name: 'Lightning Bolt' });
            assert.deepStrictEqual(result.cards[1], { count: 3, name: 'Counterspell' });
            assert.deepStrictEqual(result.cards[2], { count: 2, name: 'Sol Ring' });
            assert.strictEqual(result.hasSideboard, false);
        });

        it('parses decklist with "x" suffix', () => {
            const decklist = `4x Lightning Bolt
3x Counterspell`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
            assert.strictEqual(result.cards[0].count, 4);
            assert.strictEqual(result.cards[0].name, 'Lightning Bolt');
        });

        it('assumes count of 1 when no number provided', () => {
            const decklist = `Lightning Bolt
Counterspell`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
            assert.strictEqual(result.cards[0].count, 1);
            assert.strictEqual(result.cards[1].count, 1);
        });

        it('handles cards with commas and special characters', () => {
            const decklist = `1 Jace, the Mind Sculptor
1 Teferi's Protection`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
            assert.strictEqual(result.cards[0].name, 'Jace, the Mind Sculptor');
            assert.strictEqual(result.cards[1].name, "Teferi's Protection");
        });
    });

    describe('Sideboard Detection', () => {
        it('detects sideboard marker', () => {
            const decklist = `4 Lightning Bolt

SIDEBOARD:
3 Surgical Extraction`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.hasSideboard, true);
            assert.strictEqual(result.sideboardCount, 3);
            assert.strictEqual(result.cards.length, 1, 'Mainboard should have 1 card');
        });

        it('handles SIDEBOARD without colon', () => {
            const decklist = `4 Lightning Bolt

SIDEBOARD
3 Surgical Extraction`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.hasSideboard, true);
            assert.strictEqual(result.sideboardCount, 3);
        });

        it('counts sideboard cards with no explicit counts', () => {
            const decklist = `4 Lightning Bolt

SIDEBOARD:
Surgical Extraction
Grafdigger's Cage`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.sideboardCount, 2);
        });
    });

    describe('Format Flexibility', () => {
        it('skips section headers', () => {
            const decklist = `Creatures:
4 Lightning Bolt
Lands:
24 Island`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
            assert.strictEqual(result.cards[0].name, 'Lightning Bolt');
            assert.strictEqual(result.cards[1].name, 'Island');
        });

        it('skips comment lines starting with //', () => {
            const decklist = `// This is a comment
4 Lightning Bolt
// Another comment
3 Counterspell`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
        });

        it('skips comment lines starting with #', () => {
            const decklist = `# This is a comment
4 Lightning Bolt`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1);
        });

        it('handles empty lines gracefully', () => {
            const decklist = `4 Lightning Bolt


3 Counterspell

`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
        });
    });

    describe('Input Validation & Security', () => {
        it('throws error for non-string input', () => {
            assert.throws(
                () => parseDecklistText(null),
                { message: 'Invalid decklist: must be a string' }
            );
        });

        it('throws error for empty string', () => {
            assert.throws(
                () => parseDecklistText(''),
                { message: 'Invalid decklist: must be a string' }
            );
        });

        it('throws error for decklist exceeding max length', () => {
            const hugeDecklist = 'A'.repeat(50001);

            assert.throws(
                () => parseDecklistText(hugeDecklist),
                { message: /Decklist too large/ }
            );
        });

        it('throws error for too many lines', () => {
            const lines = Array(501).fill('1 Lightning Bolt').join('\n');

            assert.throws(
                () => parseDecklistText(lines),
                { message: /too many lines/ }
            );
        });

        it('skips cards with invalid counts (too high)', () => {
            const decklist = `101 Lightning Bolt
4 Counterspell`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1, 'Should skip card with count > 100');
            assert.strictEqual(result.cards[0].name, 'Counterspell');
        });

        it('skips cards with invalid counts (zero)', () => {
            const decklist = `0 Lightning Bolt
4 Counterspell`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1, 'Should skip card with count = 0');
        });

        it('skips cards with names that are too long', () => {
            const longName = 'A'.repeat(101);
            const decklist = `4 ${longName}
4 Counterspell`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1, 'Should skip card with name > 100 chars');
        });

        it('handles card names at exactly 100 characters', () => {
            const exactName = 'A'.repeat(100);
            const decklist = `4 ${exactName}`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1, 'Should accept name at exactly 100 chars');
            assert.strictEqual(result.cards[0].name, exactName);
        });
    });

    describe('Edge Cases', () => {
        it('handles decklist with only whitespace lines', () => {
            const decklist = `

4 Lightning Bolt
    `;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1);
        });

        it('handles mixed case section headers', () => {
            const decklist = `CREATURES:
4 Lightning Bolt
Lands:
24 Island`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 2);
        });

        it('handles double-faced card notation', () => {
            const decklist = `1 Delver of Secrets // Insectile Aberration`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1);
            assert.strictEqual(result.cards[0].name, 'Delver of Secrets // Insectile Aberration');
        });

        it('trims whitespace from card names', () => {
            const decklist = `4   Lightning Bolt   `;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards[0].name, 'Lightning Bolt');
        });
    });

    describe('Real-World Formats', () => {
        it('parses Moxfield-style export', () => {
            const decklist = `Commander
1 Atraxa, Praetors' Voice

Creatures:
1 Eternal Witness
1 Sakura-Tribe Elder

Lands:
36 Forest
1 Command Tower`;

            const result = parseDecklistText(decklist);

            // The commander lives in the command zone: reported separately and
            // kept out of the library, matching the Moxfield/Archidekt importers.
            assert.equal(result.cards.length, 4);
            assert.deepEqual(result.commanders, [{ count: 1, name: "Atraxa, Praetors' Voice" }]);
            assert.ok(!result.cards.some(c => c.name === "Atraxa, Praetors' Voice"));
        });

        it('recognises *CMDR* markers and skips maybeboards', () => {
            const decklist = `1 Kenrith, the Returned King *CMDR*
1 Sol Ring
Maybeboard (2)
1 Mana Crypt
1 Mox Diamond`;
            const result = parseDecklistText(decklist);
            assert.deepEqual(result.cards, [{ count: 1, name: 'Sol Ring' }]);
            assert.deepEqual(result.commanders, [{ count: 1, name: 'Kenrith, the Returned King' }]);
        });

        it('parses Arena-style export', () => {
            const decklist = `Deck
4 Lightning Bolt (M11) 146
3 Counterspell (M25) 42`;

            const result = parseDecklistText(decklist);

            // "Deck" is a section header and set/collector suffixes are stripped
            assert.deepEqual(result.cards, [
                { count: 4, name: 'Lightning Bolt' },
                { count: 3, name: 'Counterspell' }
            ]);
        });

        it('strips printing and foil markers from names', () => {
            const result = parseDecklistText(['1 Sol Ring [C21] *F*', '2 Arcane Signet (CMM) 371 #ramp'].join('\n'));
            assert.deepEqual(result.cards, [
                { count: 1, name: 'Sol Ring' },
                { count: 2, name: 'Arcane Signet' }
            ]);
        });
    });

    describe('Performance & Constants', () => {
        it('respects MAX_DECKLIST_LENGTH constant', () => {
            // Test that the constant is being used
            const justUnderLimit = 'A'.repeat(50000);

            assert.doesNotThrow(() => parseDecklistText(justUnderLimit));
        });

        it('respects MAX_DECKLIST_LINES constant', () => {
            // Test that the constant is being used
            const lines = Array(500).fill('1 Lightning Bolt').join('\n');

            assert.doesNotThrow(() => parseDecklistText(lines));
        });

        it('handles large valid decklist efficiently', () => {
            // 100 unique cards, which is a large Commander deck
            const cards = Array(100).fill(0).map((_, i) => `1 Card ${i}`).join('\n');

            let result;
            const duration = medianMs(() => { result = parseDecklistText(cards); });

            assert.strictEqual(result.cards.length, 100);
            assert.ok(duration < budget(100), 'Should parse 100 cards in < 100ms');
        });
    });
});

describe('Decklist Import - Security', () => {
    describe('Injection Protection', () => {
        it('safely handles cards with special regex characters', () => {
            const decklist = `1 Card.$^*+?{}[]()`;

            const result = parseDecklistText(decklist);

            assert.strictEqual(result.cards.length, 1);
            assert.strictEqual(result.cards[0].name, 'Card.$^*+?{}[]()');
        });

        it('handles cards with newlines in quoted names (should not parse)', () => {
            const decklist = `4 "Card\nWith\nNewlines"
3 Normal Card`;

            const result = parseDecklistText(decklist);

            // The card with newlines should not parse correctly
            // and should be handled gracefully
            assert.ok(result.cards.length >= 1, 'Should parse at least the normal card');
        });

        it('handles extremely long card names gracefully', () => {
            const veryLongName = 'A'.repeat(1000);
            const decklist = `4 ${veryLongName}
3 Normal Card`;

            const result = parseDecklistText(decklist);

            // Should skip the too-long card but parse the normal one
            assert.strictEqual(result.cards.length, 1);
            assert.strictEqual(result.cards[0].name, 'Normal Card');
        });
    });

    describe('DoS Prevention', () => {
        it('rejects excessively large input quickly', () => {
            const hugeInput = 'A'.repeat(100000);

            const duration = medianMs(() => assert.throws(() => parseDecklistText(hugeInput)));

            assert.ok(duration < budget(10), 'Should reject huge input quickly (< 10ms)');
        });

        it('rejects too many lines quickly', () => {
            const manyLines = Array(10000).fill('1 Card').join('\n');

            const duration = medianMs(() => assert.throws(() => parseDecklistText(manyLines)));

            assert.ok(duration < budget(50), 'Should reject many lines quickly (< 50ms)');
        });
    });
});

describe('Decklist Import - commander record', () => {
    it('builds a record from a Scryfall card, front face for double-faced cards', () => {
        const card = toCommanderCard({
            object: 'card', id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d', name: 'Esika, God of the Tree // The Prismatic Bridge',
            cmc: 3, color_identity: ['W', 'U', 'B', 'R', 'G'],
            card_faces: [
                { name: 'Esika, God of the Tree', mana_cost: '{1}{G}{G}', type_line: 'Legendary Creature — God', oracle_text: 'Vigilance', power: '1', toughness: '4', colors: ['G'] },
                { name: 'The Prismatic Bridge', mana_cost: '{W}{U}{B}{R}{G}', type_line: 'Legendary Enchantment' }
            ]
        });
        assert.strictEqual(card.mana_cost, '{1}{G}{G}');
        assert.strictEqual(card.type_line, 'Legendary Creature — God');
        assert.strictEqual(card.cmc, 3);
        assert.strictEqual(card.count, 1);
        assert.strictEqual(card.category, 'creatures');
        assert.deepStrictEqual(card.colors, ['G']);
        assert.deepStrictEqual(card.color_identity, ['W', 'U', 'B', 'R', 'G']);
        assert.strictEqual(card.scryfall_id, 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d');
    });

    it('reads Moxfield and Archidekt shapes', () => {
        const mox = toCommanderCard({
            name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor',
            oracle_text: 'Copy historic spells.', color_identity: ['G', 'U'], scryfall_id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d'
        });
        assert.strictEqual(mox.mana_cost, '{4}{G}{U}');
        assert.deepStrictEqual(mox.color_identity, ['G', 'U']);

        const archi = toCommanderCard({
            name: 'Azusa, Lost but Seeking', manaCost: '{2}{G}', cmc: 3, text: 'You may play two additional lands on each of your turns.',
            superTypes: ['Legendary'], types: ['Creature'], subTypes: ['Human', 'Monk'], colorIdentity: ['Green'],
            scryfallId: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d'
        });
        assert.strictEqual(archi.type_line, 'Legendary Creature — Human Monk');
        assert.strictEqual(archi.mana_cost, '{2}{G}');
        assert.match(archi.oracle_text, /two additional lands/);
        assert.deepStrictEqual(archi.color_identity, ['G']);
    });

    it('returns null when there is nothing to build from', () => {
        assert.strictEqual(toCommanderCard(null), null);
        assert.strictEqual(toCommanderCard({ name: 'Mystery' }), null);
        assert.strictEqual(toCommanderCard({ type_line: 'Creature' }), null);
    });

    it('keeps the commander record on a Moxfield import', async () => {
        const deck = {
            name: 'Doctor',
            boards: {
                commanders: { cards: { a: { quantity: 1, card: {
                    name: 'The Sixth Doctor', mana_cost: '{4}{G}{U}', cmc: 6, type_line: 'Legendary Creature — Time Lord Doctor',
                    oracle_text: 'Copy historic spells.', color_identity: ['G', 'U'], scryfall_id: 'c045ccb2-28d1-4bbe-9feb-3e86988fd24d'
                } } } },
                mainboard: { cards: {
                    f: { quantity: 30, card: { name: 'Forest', cmc: 0, type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' } },
                    s: { quantity: 1, card: { name: 'Sol Ring', cmc: 1, mana_cost: '{1}', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' } }
                } }
            }
        };
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: true, json: async () => deck });
        try {
            const result = await importDeckFromUrl('https://moxfield.com/decks/abcdefgh12');
            assert.strictEqual(result.commanderName, 'The Sixth Doctor');
            assert.strictEqual(result.commanderCard.mana_cost, '{4}{G}{U}');
            assert.strictEqual(result.commanderCard.cmc, 6);
            assert.strictEqual(result.cardsByName['The Sixth Doctor'], undefined, 'the commander stays out of the library');
            assert.strictEqual(result.actualCardCount, 31);
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});
