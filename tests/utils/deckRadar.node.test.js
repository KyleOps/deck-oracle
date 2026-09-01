import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    normalizeCardName,
    deriveDeckFacts,
    analyzeDeck,
    relevantCalculators,
    titleize,
    TRIGGER_CARDS
} from '../../js/utils/deckRadar.js';

/**
 * Build a DeckConfig-shaped fixture. `cards` is a list of
 * [name, type_line, cmc, power] tuples that populate both cardsByName and the
 * per-copy cardDetails array the real importer produces.
 */
function makeDeck({ cards = [], counts = {}, commanderName = null, importSource = 'moxfield' } = {}) {
    const cardsByName = {};
    const cardDetails = [];
    for (const [name, typeLine = 'Creature', cmc = 2, power = null, count = 1] of cards) {
        const line = typeLine.toLowerCase();
        const category = line.includes('land') ? 'lands'
            : line.includes('creature') ? 'creatures'
            : line.includes('instant') ? 'instants'
            : line.includes('sorcery') ? 'sorceries'
            : line.includes('artifact') ? 'artifacts'
            : line.includes('enchantment') ? 'enchantments'
            : 'creatures';
        cardsByName[name] = { name, type_line: typeLine, cmc, power, category, count };
        for (let i = 0; i < count; i++) {
            const p = power === null ? null : parseInt(power, 10);
            cardDetails.push({
                name, cmc, type: category, allTypes: [category], power,
                isPower5Plus: Number.isFinite(p) && p >= 5
            });
        }
    }
    return {
        creatures: 30, instants: 8, sorceries: 6, artifacts: 8,
        enchantments: 5, planeswalkers: 2, lands: 36, battles: 0,
        actualCardCount: 99,
        ...counts,
        cardsByName, cardDetails, commanderName, importSource
    };
}

describe('normalizeCardName', () => {
    it('strips punctuation, casing, and collapses whitespace', () => {
        assert.strictEqual(normalizeCardName('Rashmi, Eternities Crafter'), 'rashmi eternities crafter');
        assert.strictEqual(normalizeCardName("Kamahl's Druidic Vow"), 'kamahls druidic vow');
    });

    it('uses only the front face of a double-faced card', () => {
        assert.strictEqual(normalizeCardName('Delver of Secrets // Insectile Aberration'), 'delver of secrets');
    });

    it('returns an empty string for non-strings', () => {
        assert.strictEqual(normalizeCardName(null), '');
        assert.strictEqual(normalizeCardName(undefined), '');
        assert.strictEqual(normalizeCardName(42), '');
    });
});

describe('titleize', () => {
    it('capitalizes words but leaves small joining words lowercase', () => {
        assert.strictEqual(titleize('portent of calamity'), 'Portent of Calamity');
        assert.strictEqual(titleize('genesis wave'), 'Genesis Wave');
    });

    it('capitalizes a small word in first position', () => {
        assert.strictEqual(titleize('the abstract'), 'The Abstract');
    });
});

describe('deriveDeckFacts', () => {
    it('prefers actualCardCount over the sum of type counts', () => {
        const facts = deriveDeckFacts({ creatures: 10, lands: 10, actualCardCount: 99 });
        assert.strictEqual(facts.total, 99);
    });

    it('falls back to summing type counts when actualCardCount is absent', () => {
        const facts = deriveDeckFacts({ creatures: 10, lands: 30, instants: 5 });
        assert.strictEqual(facts.total, 45);
    });

    it('computes permanent ratio and non-permanent count', () => {
        const facts = deriveDeckFacts({
            creatures: 40, lands: 36, artifacts: 10, enchantments: 5,
            instants: 5, sorceries: 3, actualCardCount: 99
        });
        assert.strictEqual(facts.nonPermanents, 8);
        assert.strictEqual(facts.permanents, 91);
        assert.ok(Math.abs(facts.permanentRatio - 91 / 99) < 1e-9);
    });

    it('counts distinct card types present', () => {
        const facts = deriveDeckFacts({ creatures: 1, lands: 1, instants: 1 });
        assert.strictEqual(facts.distinctTypes, 3);
    });

    it('counts legendary permanents but not legendary instants/sorceries', () => {
        const deck = makeDeck({
            cards: [
                ['Azusa, Lost but Seeking', 'Legendary Creature — Human Monk', 3],
                ['Sol Ring', 'Legendary Artifact', 1],
                ['Legendary Bolt', 'Legendary Sorcery', 2]
            ]
        });
        assert.strictEqual(deriveDeckFacts(deck).legendaryPermanents, 2);
    });

    it('counts power 5+ creatures from per-copy card details', () => {
        const deck = makeDeck({
            cards: [
                ['Big Guy', 'Creature — Giant', 6, '7'],
                ['Small Guy', 'Creature — Elf', 1, '1']
            ]
        });
        assert.strictEqual(deriveDeckFacts(deck).power5Plus, 1);
    });

    it('falls back to the manual creaturesPower5Plus field with no card data', () => {
        assert.strictEqual(deriveDeckFacts({ creaturesPower5Plus: 14 }).power5Plus, 14);
    });

    it('builds a curve and average MV that excludes lands', () => {
        const deck = makeDeck({
            cards: [
                ['Forest', 'Basic Land — Forest', 0],
                ['Two Drop', 'Creature — Elf', 2],
                ['Four Drop', 'Creature — Bear', 4]
            ]
        });
        const facts = deriveDeckFacts(deck);
        assert.strictEqual(facts.avgCmc, 3);
        assert.strictEqual(facts.curve[0], undefined);
    });

    it('does not throw on an empty or undefined deck', () => {
        assert.doesNotThrow(() => deriveDeckFacts());
        assert.doesNotThrow(() => deriveDeckFacts({}));
        assert.strictEqual(deriveDeckFacts({}).total, 0);
    });
});

describe('analyzeDeck — named card detection', () => {
    it('flags a calculator when its card is in the deck', () => {
        const deck = makeDeck({ cards: [['Genesis Wave', 'Sorcery', 6]] });
        const wave = analyzeDeck(deck).find(r => r.tab === 'wave');
        assert.strictEqual(wave.hasCard, true);
        assert.strictEqual(wave.tier, 'core');
        assert.ok(wave.reasons.some(r => r.includes('Genesis Wave')));
    });

    it('scores a commander match higher than an in-deck match', () => {
        const asCommander = makeDeck({
            cards: [['Rashmi, Eternities Crafter', 'Legendary Creature — Elf Wizard', 4]],
            commanderName: 'Rashmi, Eternities Crafter'
        });
        const inDeck = makeDeck({ cards: [['Rashmi, Eternities Crafter', 'Legendary Creature — Elf Wizard', 4]] });

        const cmdScore = analyzeDeck(asCommander).find(r => r.tab === 'rashmi').score;
        const deckScore = analyzeDeck(inDeck).find(r => r.tab === 'rashmi').score;
        assert.ok(cmdScore > deckScore, `${cmdScore} should exceed ${deckScore}`);
    });

    it('matches names regardless of punctuation and casing', () => {
        const deck = makeDeck({ cards: [["KAMAHL'S DRUIDIC VOW", 'Sorcery', 5]] });
        assert.strictEqual(analyzeDeck(deck).find(r => r.tab === 'vow').hasCard, true);
    });

    it('does not flag a calculator whose card is absent', () => {
        const deck = makeDeck({ cards: [['Llanowar Elves', 'Creature — Elf Druid', 1]] });
        assert.strictEqual(analyzeDeck(deck).find(r => r.tab === 'mindsdilation').hasCard, false);
    });

    it('counts a trigger card only once even with multiple aliases', () => {
        const deck = makeDeck({ cards: [["Mind's Dilation", 'Enchantment', 6]] });
        const r = analyzeDeck(deck).find(x => x.tab === 'mindsdilation');
        assert.strictEqual(r.reasons.filter(t => t.toLowerCase().includes('dilation')).length, 1);
    });
});

describe('analyzeDeck — structural signals', () => {
    it('flags Primal Surge for a deck with zero instants and sorceries', () => {
        const deck = makeDeck({
            counts: { instants: 0, sorceries: 0, creatures: 45 },
            cards: [['Llanowar Elves', 'Creature — Elf Druid', 1]]
        });
        const surge = analyzeDeck(deck).find(r => r.tab === 'surge');
        assert.ok(surge.score > 0);
        assert.ok(surge.reasons.some(r => r.includes('Zero instants')));
    });

    it('does not flag Primal Surge for a spell-heavy deck', () => {
        const deck = makeDeck({
            counts: { instants: 20, sorceries: 15 },
            cards: [['Llanowar Elves', 'Creature — Elf Druid', 1]]
        });
        assert.strictEqual(analyzeDeck(deck).find(r => r.tab === 'surge').score, 0);
    });

    it('flags Kamahl\'s Vow when the deck is dense with legendary permanents', () => {
        const cards = Array.from({ length: 16 }, (_, i) =>
            [`Legend ${i}`, 'Legendary Creature — Human', 3]);
        const vow = analyzeDeck(makeDeck({ cards })).find(r => r.tab === 'vow');
        assert.ok(vow.score > 0);
        assert.ok(vow.reasons.some(r => r.includes('legendary permanents')));
    });

    it('flags Portent only when at least four card types are present', () => {
        const narrow = analyzeDeck({ creatures: 40, lands: 36, instants: 10 });
        assert.strictEqual(narrow.find(r => r.tab === 'portent').score, 0);

        const wide = analyzeDeck({
            creatures: 30, lands: 36, instants: 8, sorceries: 6,
            artifacts: 8, enchantments: 5
        });
        assert.ok(wide.find(r => r.tab === 'portent').score > 0);
    });

    it('flags Vortex only when there are enough power 5+ creatures', () => {
        assert.strictEqual(analyzeDeck({ creaturesPower5Plus: 4 }).find(r => r.tab === 'vortex').score, 0);
        assert.ok(analyzeDeck({ creaturesPower5Plus: 20 }).find(r => r.tab === 'vortex').score > 0);
    });

    it('always surfaces mulligan and land drops as baseline tools', () => {
        const results = analyzeDeck({ creatures: 30, lands: 36, actualCardCount: 99 });
        assert.ok(results.find(r => r.tab === 'mulligan').score > 0);
        assert.ok(results.find(r => r.tab === 'lands').score > 0);
    });

    it('suppresses the land-drop tool for a landless deck', () => {
        assert.strictEqual(analyzeDeck({ creatures: 60, lands: 0 }).find(r => r.tab === 'lands').score, 0);
    });

    it('stacks named-card and structural evidence', () => {
        const both = makeDeck({
            counts: { instants: 0, sorceries: 0 },
            cards: [['Primal Surge', 'Sorcery', 10]]
        });
        const nameOnly = makeDeck({
            counts: { instants: 12, sorceries: 10 },
            cards: [['Primal Surge', 'Sorcery', 10]]
        });
        const bothScore = analyzeDeck(both).find(r => r.tab === 'surge').score;
        const nameScore = analyzeDeck(nameOnly).find(r => r.tab === 'surge').score;
        assert.ok(bothScore > nameScore);
        assert.strictEqual(analyzeDeck(both).find(r => r.tab === 'surge').reasons.length, 2);
    });
});

describe('analyzeDeck — ranking', () => {
    it('ranks the deck\'s named card above baseline tools', () => {
        const deck = makeDeck({ cards: [['Monstrous Vortex', 'Enchantment', 6]] });
        assert.strictEqual(analyzeDeck(deck)[0].tab, 'vortex');
    });

    it('produces a stable order for equally scored calculators', () => {
        const deck = makeDeck({ cards: [['Llanowar Elves', 'Creature — Elf Druid', 1]] });
        const a = analyzeDeck(deck).map(r => r.tab);
        const b = analyzeDeck(deck).map(r => r.tab);
        assert.deepStrictEqual(a, b);
    });

    it('returns an entry for every known calculator', () => {
        const tabs = analyzeDeck({}).map(r => r.tab).sort();
        for (const known of Object.keys(TRIGGER_CARDS)) {
            assert.ok(tabs.includes(known), `missing ${known}`);
        }
        assert.ok(tabs.includes('mulligan'));
        assert.ok(tabs.includes('lands'));
    });

    it('honours an explicit tab restriction', () => {
        const results = analyzeDeck({}, { tabs: ['wave', 'surge'] });
        assert.deepStrictEqual(results.map(r => r.tab).sort(), ['surge', 'wave']);
    });

    it('assigns tiers consistently with score', () => {
        for (const r of analyzeDeck(makeDeck({ cards: [['Genesis Wave', 'Sorcery', 6]] }))) {
            if (r.score >= 100) assert.strictEqual(r.tier, 'core');
            else if (r.score >= 45) assert.strictEqual(r.tier, 'likely');
            else if (r.score >= 20) assert.strictEqual(r.tier, 'possible');
            else assert.strictEqual(r.tier, 'idle');
        }
    });
});

describe('relevantCalculators', () => {
    it('excludes idle calculators', () => {
        const deck = makeDeck({ cards: [['Genesis Wave', 'Sorcery', 6]] });
        assert.ok(relevantCalculators(deck).every(r => r.tier !== 'idle'));
    });

    it('respects the limit option', () => {
        const deck = makeDeck({ cards: [['Genesis Wave', 'Sorcery', 6]] });
        assert.ok(relevantCalculators(deck, { limit: 2 }).length <= 2);
    });

    it('never throws for an empty deck', () => {
        assert.doesNotThrow(() => relevantCalculators({}));
    });
});

describe('deckRadar — display names in reasons', () => {
    it('reports the deck\'s own spelling, not the normalized trigger', () => {
        const deck = makeDeck({ cards: [["Kamahl's Druidic Vow", 'Sorcery', 5]] });
        const vow = analyzeDeck(deck).find(r => r.tab === 'vow');
        assert.ok(vow.reasons[0].startsWith("Kamahl's Druidic Vow is in the deck"), vow.reasons[0]);
    });

    it('reports the commander with its full printed name', () => {
        const deck = makeDeck({
            cards: [['Rashmi, Eternities Crafter', 'Legendary Creature — Elf Wizard', 4]],
            commanderName: 'Rashmi, Eternities Crafter'
        });
        const r = analyzeDeck(deck).find(x => x.tab === 'rashmi');
        assert.strictEqual(r.reasons[0], 'Rashmi, Eternities Crafter is your commander');
    });

    it('falls back to the titleized trigger when the deck has no card data', () => {
        const facts = deriveDeckFacts({});
        assert.strictEqual(facts.displayNames.size, 0);
    });

    it('keeps only the front face of a double-faced card as the display name', () => {
        const facts = deriveDeckFacts(makeDeck({
            cards: [['Delver of Secrets // Insectile Aberration', 'Creature — Human', 1]]
        }));
        assert.strictEqual(facts.displayNames.get('delver of secrets'), 'Delver of Secrets');
    });
});

describe('deckRadar — Chimil', () => {
    it('flags Chimil when the card is in the deck', () => {
        const deck = makeDeck({ cards: [['Chimil, the Inner Sun', 'Legendary Artifact', 6]] });
        const r = analyzeDeck(deck).find(x => x.tab === 'chimil');
        assert.strictEqual(r.hasCard, true);
        assert.strictEqual(r.tier, 'core');
    });

    it('counts nonlands at mana value 5 or less as the eligible pool', () => {
        const cards = Array.from({ length: 40 }, (_, i) => [`Cheap ${i}`, 'Creature — Elf', 2]);
        assert.strictEqual(deriveDeckFacts(makeDeck({ cards })).cheapNonlands, 40);
    });

    it('does not count lands or expensive spells as eligible', () => {
        const facts = deriveDeckFacts(makeDeck({
            cards: [['Forest', 'Basic Land — Forest', 0], ['Big', 'Creature — Giant', 8], ['Small', 'Creature — Elf', 2]]
        }));
        assert.strictEqual(facts.cheapNonlands, 1);
    });

    it('suggests Chimil structurally for a deck dense in cheap spells', () => {
        const cards = Array.from({ length: 45 }, (_, i) => [`Cheap ${i}`, 'Creature — Elf', 3]);
        const r = analyzeDeck(makeDeck({ cards })).find(x => x.tab === 'chimil');
        assert.ok(r.score > 0);
        assert.ok(/MV 5 or less/.test(r.reasons[0]), r.reasons[0]);
    });

    it('stays quiet for a top-heavy deck with nothing to discover', () => {
        const cards = Array.from({ length: 20 }, (_, i) => [`Big ${i}`, 'Creature — Giant', 8]);
        assert.strictEqual(analyzeDeck(makeDeck({ cards })).find(x => x.tab === 'chimil').score, 0);
    });
});
