// Legacy-runner copy of the core Vortex check (npm run test:legacy).
// The full suite lives in vortex.node.test.js.
import { describe, it, assertClose } from '../test-helper.js';
import { analyzeVortex } from '../../js/calculators/vortex.js';

const beast = (name, cmc, power) => ({ name, cmc, types: ['creature'], power: String(power) });
const land = (i) => ({ name: `Forest ${i}`, cmc: 0, types: ['land'] });

describe('Monstrous Vortex Calculator', () => {
    // Casting Big Dino discovers 6 from {Chain Dino 5/5, Small Dino 4/4, Tiny Spell}.
    // Without replacement: (1 + 4 + (5 + 2.5)) / 3 = 4.1667 mana, 4/3 spells.
    const library = [
        beast('Big Dino', 6, 5), beast('Chain Dino', 5, 5), beast('Small Dino', 4, 4),
        { name: 'Tiny Spell', cmc: 1, types: ['sorcery'] },
        land(1), land(2), land(3), land(4), land(5), land(6)
    ];

    it('resolves discover chains without replacement', () => {
        const big = analyzeVortex(library, { runs: 6000 }).creatures.find(c => c.name === 'Big Dino');
        assertClose(big.stats.avgMana, 12.5 / 3, 'Avg Free Mana Value', 0.15);
        assertClose(big.stats.avgSpells, 4 / 3, 'Avg Spells Cast', 0.05);
    });
});
