import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { compareBigSpells, comparisonLead, renderComparison, totalManaFor } from '../../js/utils/bigSpellComparison.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';

// Mock DOM
global.document = {
    getElementById: (id) => {
        return { value: 5 }; // Default value for inputs
    }
};

describe('Big Spell Comparison Integration', () => {

    before(() => {
        // Setup default deck state
        const deckData = {
            commanderName: "None",
            creatures: 20,
            lands: 30,
            cardDetails: [
                { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
                { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, count: 20 }
            ],
            cardsByName: {
                'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
                'Llanowar Elves': { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, count: 20 }
            }
        };
        DeckConfig.updateDeck(deckData);
    });

    it('should normalize total mana cost when source is "wave"', () => {
        // Wave X=7 => Mana = 7+3 = 10
        const inputX = 7;
        const result = compareBigSpells(inputX, 'wave');

        assert.strictEqual(result.totalMana, 10, 'Total mana should be 10 for Wave X=7');
        
        const wave = result.spells.find(s => s.name === 'Genesis Wave');
        const vow = result.spells.find(s => s.name.includes("Kamahl's Druidic Vow"));
        const portent = result.spells.find(s => s.name === 'Portent of Calamity');
        
        // Wave X should be 7 (10-3)
        assert.strictEqual(wave.x, 7, 'Wave X should be 7');
        
        // Vow X should be 8 (10-2)
        assert.strictEqual(vow.x, 8, 'Vow X should be 8');
        
        // Portent X should be 9 (10-1)
        assert.strictEqual(portent.x, 9, 'Portent X should be 9');
    });

    it('should normalize total mana cost when source is "portent"', () => {
        // Portent X=7 => Mana = 7+1 = 8
        const inputX = 7;
        const result = compareBigSpells(inputX, 'portent');

        assert.strictEqual(result.totalMana, 8, 'Total mana should be 8 for Portent X=7');
        
        const wave = result.spells.find(s => s.name === 'Genesis Wave');
        const vow = result.spells.find(s => s.name.includes("Kamahl's Druidic Vow"));
        const portent = result.spells.find(s => s.name === 'Portent of Calamity');
        
        // Wave X should be 5 (8-3)
        assert.strictEqual(wave.x, 5, 'Wave X should be 5');
        
        // Vow X should be 6 (8-2)
        assert.strictEqual(vow.x, 6, 'Vow X should be 6');
        
        // Portent X should be 7 (8-1)
        assert.strictEqual(portent.x, 7, 'Portent X should be 7');
    });
    
    it('should normalize total mana cost when source is "surge"', () => {
        // Surge => Mana = 10
        const result = compareBigSpells(10, 'surge'); // input X ignored for surge usually

        assert.strictEqual(result.totalMana, 10, 'Total mana should be 10 for Surge');
        
        const wave = result.spells.find(s => s.name === 'Genesis Wave');
        
        // Wave X should be 7 (10-3)
        assert.strictEqual(wave.x, 7, 'Wave X should be 7');
    });

    it('should double Kamahl\'s Druidic Vow expected value for The Sixth Doctor', () => {
        // Setup deck state
        const deckData = {
            commanderName: "The Sixth Doctor",
            creatures: 20,
            lands: 30,
            // Mock card data structure that DeckConfig expects
            cardDetails: [
                { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
                { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, count: 20 }
            ],
            cardsByName: {
                'Forest': { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 30 },
                'Llanowar Elves': { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', cmc: 1, count: 20 }
            }
        };

        // Update DeckConfig with our test data
        DeckConfig.updateDeck(deckData);
        
        // Verify commander name was set correctly (testing the fix)
        assert.strictEqual(DeckConfig.getCommanderName(), "The Sixth Doctor", "Commander name should be preserved");

        // Run comparison with default source (generic) which uses direct X
        // Or better yet, test with a specific source to ensure doubling works WITH normalization
        // Let's use 'generic' (default) to keep it simple and match original test logic
        // But since we updated compareBigSpells to require normalization, 
        // calling with X=10 and no source implies 'generic' -> totalMana = 10 -> vowX = 8.
        // Wait, default is 'generic' -> totalMana = inputX = 10.
        // vowX = 10 - 2 = 8.
        // So Vow is calculated at X=8.
        
        const result = compareBigSpells(10);
        
        // Find Vow result
        const vow = result.spells.find(s => s.name.includes("Kamahl's Druidic Vow"));
        
        assert.ok(vow, "Vow result should exist");
        assert.ok(vow.name.includes("(×2)"), "Vow name should indicate doubling");
        
        // Reset commander to None to compare
        DeckConfig.updateDeck({ commanderName: "None" });
        const resultNormal = compareBigSpells(10);
        const vowNormal = resultNormal.spells.find(s => s.name.includes("Kamahl's Druidic Vow"));
        
        assert.ok(!vowNormal.name.includes("(×2)"), "Normal Vow should not be doubled");
        
        // The expected value should be exactly double
        assert.strictEqual(vow.expected, vowNormal.expected * 2, "Expected value should be exactly double");
    });

    it('uses the same cast-Surge library as the Surge calculator', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            const cardsByName = {
                Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 2 },
                Cultivate: { name: 'Cultivate', type_line: 'Sorcery', cmc: 3, count: 1 },
                Surge: { name: 'Primal Surge', type_line: 'Sorcery', cmc: 10, count: 1 }
            };
            DeckConfig.updateDeck({
                commanderName: 'None', creatures: 0, artifacts: 0, enchantments: 0,
                planeswalkers: 0, battles: 0, instants: 0, sorceries: 2,
                lands: 2, actualCardCount: 4, cardsByName, cardDetails: []
            });
            const withSurge = compareBigSpells(10, 'surge').spells.find(spell => spell.name === 'Primal Surge');
            assert.strictEqual(withSurge.expected, 1, 'one remaining stop among two permanents');

            cardsByName.Surge = { name: 'Impulse', type_line: 'Instant', cmc: 2, count: 1 };
            DeckConfig.updateDeck({ cardsByName });
            const withoutSurge = compareBigSpells(10, 'surge').spells.find(spell => spell.name === 'Primal Surge');
            assert.strictEqual(withoutSurge.expected, 2 / 3, 'both nonpermanents remain when Surge is absent');
        } finally {
            DeckConfig.updateDeck(original);
        }
    });
});

describe('Big Spell Comparison is DOM-free', () => {
    const cardsByName = {
        Forest: { name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0, count: 36 },
        Ragavan: { name: 'Ragavan', type_line: 'Legendary Creature — Monkey', cmc: 1, count: 10 },
        Bear: { name: 'Bear', type_line: 'Creature — Bear', cmc: 2, count: 30 },
        Rock: { name: 'Mind Stone', type_line: 'Artifact', cmc: 2, count: 8 },
        Opt: { name: 'Opt', type_line: 'Instant', cmc: 1, count: 8 },
        Ponder: { name: 'Ponder', type_line: 'Sorcery', cmc: 1, count: 7 }
    };

    function withDocument(doc, fn) {
        const saved = global.document;
        global.document = doc;
        try {
            return fn();
        } finally {
            global.document = saved;
        }
    }

    it('works when no other calculator page has been mounted (getElementById returns null)', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            DeckConfig.updateDeck({ commanderName: 'None', cardsByName, actualCardCount: 99 });
            const nullDom = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
            withDocument(nullDom, () => {
                for (const source of ['wave', 'vow', 'portent', 'surge', 'generic']) {
                    const result = compareBigSpells(7, source);
                    assert.ok(result, `${source} comparison exists`);
                    assert.strictEqual(result.spells.length, 4);
                    result.spells.forEach(spell => assert.ok(Number.isFinite(spell.expected), `${source}: ${spell.name} is a number`));
                }
            });
        } finally {
            DeckConfig.updateDeck(original);
        }
    });

    it('never touches document at all', () => {
        const original = DeckConfig.getDeckConfig();
        try {
            DeckConfig.updateDeck({ commanderName: 'None', cardsByName, actualCardCount: 99 });
            const trap = new Proxy({}, { get(_, key) { throw new Error(`compareBigSpells read document.${String(key)}`); } });
            withDocument(trap, () => {
                const result = compareBigSpells(9, 'portent');
                const portent = result.spells.find(s => s.key === 'portent');
                assert.strictEqual(portent.x, 9);
                assert.ok(portent.expected > 0);
            });
        } finally {
            DeckConfig.updateDeck(original);
        }
    });

    it('returns null without a card list and renders an import prompt', () => {
        assert.strictEqual(compareBigSpells(7, 'wave', { cards: [] }), null);
        assert.match(renderComparison(null), /Import a decklist/);
    });

    it('lets the Vow page say whether the Vow is copied', () => {
        const cards = Object.values(cardsByName);
        const plain = compareBigSpells(8, 'vow', { cards, deck: {}, vowDoubleCast: false }).spells.find(s => s.key === 'vow');
        const copied = compareBigSpells(8, 'vow', { cards, deck: {}, vowDoubleCast: true }).spells.find(s => s.key === 'vow');
        assert.strictEqual(copied.expected, plain.expected * 2);
        assert.strictEqual(copied.copied, true);
    });

    it('explains the result in one sentence and highlights the current page', () => {
        const cards = Object.values(cardsByName);
        const comparison = compareBigSpells(7, 'wave', { cards, deck: {} });
        assert.strictEqual(totalManaFor('wave', 7), 10);
        const lead = comparisonLead(comparison, 'wave');
        assert.match(lead, /For 10 mana/);
        const html = renderComparison(comparison, { current: 'wave' });
        assert.match(html, /class="bsc-row is-current"/);
        assert.match(html, /this page/);
        assert.strictEqual((html.match(/class="bsc-row/g) ?? []).length, 4);
    });

    it('does not rank Primal Surge first when the mana cannot cast it', () => {
        const cards = [
            { name: 'Forest', type_line: 'Land', cmc: 0, count: 99 }
        ];
        const comparison = compareBigSpells(3, 'wave', { cards, deck: {} }); // 6 mana
        const surge = comparison.spells.find(s => s.key === 'surge');
        assert.strictEqual(surge.affordable, false);
        assert.doesNotMatch(comparisonLead(comparison, 'wave'), /<strong>Primal Surge<\/strong> gets/);
    });
});
