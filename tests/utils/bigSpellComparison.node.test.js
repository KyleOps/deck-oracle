import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { compareBigSpells } from '../../js/utils/bigSpellComparison.js';
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
});