import { describe, it } from 'node:test';
import { assertClose } from '../node-test-helper.js';
import { calculateLumraStats } from '../../js/calculators/lumra.js';

describe('Lumra Calculator', () => {
    it('calculates expected milled lands correctly (50% lands)', () => {
        const deckSize = 100;
        const landCount = 50;
        const gyLands = 0;
        
        // Expected value for hypergeometric distribution: n * (K / N)
        // 4 * (50 / 100) = 2
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 2.0, 'Expected milled should be 2.0');
        assertClose(result.totalReturned, 2.0, 'Total returned should match expected milled (0 gy)');
    });

    it('calculates expected milled lands correctly (25% lands)', () => {
        const deckSize = 100;
        const landCount = 25;
        const gyLands = 0;
        
        // 4 * (25 / 100) = 1
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 1.0, 'Expected milled should be 1.0');
    });

    it('adds graveyard lands to total', () => {
        const deckSize = 100;
        const landCount = 50;
        const gyLands = 5;
        
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 2.0, 'Expected milled still 2.0');
        assertClose(result.totalReturned, 7.0, 'Total returned should be 5 + 2 = 7');
    });

    it('handles 0 lands in deck', () => {
        const deckSize = 100;
        const landCount = 0;
        const gyLands = 3;
        
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 0.0, 'Expected milled should be 0');
        assertClose(result.totalReturned, 3.0, 'Total returned should be just GY lands');
    });

    it('handles 100% lands in deck', () => {
        const deckSize = 100;
        const landCount = 100;
        const gyLands = 0;
        
        const result = calculateLumraStats(deckSize, landCount, gyLands);
        
        assertClose(result.expectedMilled, 4.0, 'Expected milled should be 4');
    });

    it('handles multiplier (2 triggers)', () => {
        const deckSize = 100;
        const landCount = 50;
        const gyLands = 0;
        const multiplier = 2;
        
        // Expected: 8 cards milled, 50% lands -> 4 lands
        const result = calculateLumraStats(deckSize, landCount, gyLands, multiplier);
        
        assertClose(result.expectedMilled, 4.0, 'Expected milled should be 4.0 (2x trigger)');
    });
});
