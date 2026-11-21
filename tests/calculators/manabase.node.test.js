import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
    TARGET,
    pct,
    chanceTone,
    summarize,
    commanderSentence,
    heroStats,
    filterCards,
    deckKey,
    getShareParams,
    applyShareParams,
    readInputs,
    stripCells,
    reliableFrom,
    STRIP_TURNS
} from '../../js/calculators/manabase.js';
import { analyzeCastability } from '../../js/utils/castability.js';
import { DEFAULT_DECK_DATA } from '../../js/utils/defaultDeckData.js';
import { FORMATS } from '../../js/utils/format.js';
import { budget } from '../helpers/timing.js';

const text = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function land(name, count, colors, typeLine = 'Land') {
    return { name, count, type_line: typeLine, color_identity: colors };
}
function spell(name, count, cost, cmc, colors = []) {
    return { name, count, type_line: 'Instant', mana_cost: cost, cmc, color_identity: colors };
}
function deck(cards) {
    return Object.fromEntries(cards.map(c => [c.name, c]));
}

// A Simic 60-card deck that is short on blue for its Counterspells.
const SHORT_BLUE = deck([
    land('Forest', 14, ['G'], 'Basic Land — Forest'),
    land('Island', 6, ['U'], 'Basic Land — Island'),
    land('Breeding Pool', 4, ['G', 'U'], 'Land — Forest Island'),
    spell('Llanowar Elves', 4, '{G}', 1, ['G']),
    spell('Counterspell', 4, '{U}{U}', 2, ['U']),
    spell('Growth Spiral', 4, '{G}{U}', 2, ['G', 'U']),
    spell('Rampant Growth', 4, '{1}{G}', 2, ['G']),
    spell('Filler', 20, '{3}', 3)
]);

// A mono-green 60 that casts everything comfortably.
const MONO_GREEN = deck([
    land('Forest', 24, ['G'], 'Basic Land — Forest'),
    spell('Llanowar Elves', 4, '{G}', 1, ['G']),
    spell('Rampant Growth', 4, '{1}{G}', 2, ['G']),
    spell('Filler', 28, '{3}', 3)
]);

describe('manabase - formatting', () => {
    it('rounds chances down so a shown 90% really is 90%', () => {
        assert.strictEqual(pct(0.8999), '89%');
        assert.strictEqual(pct(0.9), '90%');
        assert.strictEqual(pct(0.999), '99%');
        assert.strictEqual(pct(1), '100%');
        assert.strictEqual(pct(0), '0%');
        assert.strictEqual(pct(NaN), '—');
    });

    it('tones chances against the 90% target', () => {
        assert.strictEqual(TARGET, 0.9);
        assert.strictEqual(chanceTone(0.95), 'good');
        assert.strictEqual(chanceTone(0.9), 'good');
        assert.strictEqual(chanceTone(0.85), 'warn');
        assert.strictEqual(chanceTone(0.6), 'bad');
        assert.strictEqual(chanceTone(undefined), 'flat');
    });
});

describe('manabase - summarize', () => {
    it('names the bottleneck colour and the sources its cards want', () => {
        const result = analyzeCastability(SHORT_BLUE, { deckSize: 60, format: FORMATS.constructed });
        const { html, tone } = summarize(result);
        const line = text(html);
        assert.ok(result.under > 0);
        assert.match(line, new RegExp(`^${result.under} of your ${result.total} coloured spells (is|are) under 90% to cast on curve\\.`));
        assert.match(line, /Blue is the bottleneck: 10 sources where/);
        assert.ok(line.includes(`about ${result.bottleneck.want}`));
        assert.ok(['warn', 'bad'].includes(tone));
    });

    it('celebrates a deck with no misses', () => {
        const result = analyzeCastability(MONO_GREEN, { deckSize: 60, format: FORMATS.constructed });
        const { html, tone } = summarize(result);
        assert.strictEqual(result.under, 0);
        assert.strictEqual(tone, 'good');
        assert.match(text(html), /^All 2 of your coloured spells are at least 90% to cast on curve/);
    });

    it('explains multicolour misses when no single colour is short', () => {
        const result = {
            total: 10, under: 2, target: 0.9, bottleneck: null, colors: [],
            worst: { name: 'Growth Spiral', chance: 0.87, turn: 2 }
        };
        const line = text(summarize(result).html);
        assert.match(line, /Every colour has the sources its own cards want/);
        assert.match(line, /Growth Spiral at 87%/);
    });

    it('stays calm about a deck with no coloured spells', () => {
        const result = analyzeCastability(deck([land('Wastes', 20, []), spell('Sol Ring', 40, '{1}', 1)]), { deckSize: 60 });
        assert.strictEqual(summarize(result).tone, 'flat');
        assert.match(summarize(result).html, /None of your spells have coloured mana symbols/);
    });

    it('gives the default Commander deck a sentence that matches its numbers', () => {
        // The 98-card library; both commanders (in the command zone) set the identity.
        const commanderCards = DEFAULT_DECK_DATA.commanders.map(c => c.card);
        const result = analyzeCastability(DEFAULT_DECK_DATA, { deckSize: 98, format: FORMATS.commander, commanderCards });
        assert.ok(!result.cards.some(c => c.name === 'The Sixth Doctor' || c.name === 'Susan Foreman'), 'commanders are not library cards');
        const line = text(summarize(result).html);
        assert.ok(line.startsWith(`${result.under} of your ${result.total} coloured spells`));
        if (result.bottleneck) assert.ok(line.includes(`${result.bottleneck.sources} sources`));
        // …and a line of their own for both commanders, in deck order.
        assert.deepStrictEqual(result.commanders.map(c => [c.name, c.turn]), [['The Sixth Doctor', 6], ['Susan Foreman', 2]]);
        const [doctor, susan] = result.commanders;
        assert.ok(line.endsWith(`From the command zone, your commanders have their colours on curve: The Sixth Doctor ${pct(doctor.chance)} on turn 6 and Susan Foreman ${pct(susan.chance)} on turn 2.`), line);
    });

    it('never calls a deck all good while a commander misses', () => {
        const allGood = analyzeCastability(deck([land('Forest', 20, ['G'], 'Basic Land — Forest'), land('Island', 2, ['U'], 'Basic Land — Island'), spell('Elf', 4, '{G}', 1, ['G']), spell('Filler', 34, '{3}', 3)]),
            { deckSize: 60, format: FORMATS.constructed, commanderCards: [{ name: 'Blue Boss', type_line: 'Legendary Creature', mana_cost: '{U}{U}', cmc: 2, color_identity: ['U'] }] });
        assert.strictEqual(allGood.under, 0);
        assert.strictEqual(allGood.commandersUnder, 1);
        const s = summarize(allGood);
        assert.strictEqual(s.tone, 'warn');
        assert.match(text(s.html), /your commander has its colours on curve: Blue Boss \d+% on turn 2 — under 90%\.$/);
        // The bottleneck can be a commander, and says so.
        assert.strictEqual(allGood.bottleneck.color, 'U');
        assert.strictEqual(allGood.bottleneck.hardest.commander, true);
    });

    it('describes the command zone for one, two and three commanders', () => {
        const row = (name, chance, turn) => ({ name, chance, turn });
        const base = { target: 0.9 };
        assert.strictEqual(commanderSentence({ ...base, commanders: [] }), null);
        assert.strictEqual(commanderSentence(null), null);
        assert.match(text(commanderSentence({ ...base, commanders: [row('A', 0.5, 3), row('B', 0.4, 4)] })), /both under 90%\.$/);
        assert.match(text(commanderSentence({ ...base, commanders: [row('A', 0.95, 3), row('B', 0.4, 4), row('C', 0.99, 2)] })), /A 95% on turn 3, B 40% on turn 4 and C 99% on turn 2 — one under 90%\.$/);
        assert.match(text(commanderSentence({ ...base, commanders: [row('A', 0.5, 3), row('B', 0.4, 4), row('C', 0.2, 2)] })), /all under 90%\.$/);
    });
});

describe('manabase - heroStats', () => {
    it('uses plain-word labels with explanations', () => {
        const result = analyzeCastability(SHORT_BLUE, { deckSize: 60, format: FORMATS.constructed });
        const stats = heroStats(result);
        assert.deepStrictEqual(stats.map(s => s.label), ['At 90% or better', 'Average chance', 'Hardest to cast', 'Bottleneck']);
        stats.forEach(s => assert.ok(s.tip, `${s.label} explains itself`));
        assert.strictEqual(stats[0].sub, `${result.total - result.under} of ${result.total} coloured spells`);
        assert.strictEqual(stats[3].value, 'Blue');
        stats.forEach(s => assert.doesNotMatch(String(s.label), /P\(|E\[/));
    });

    it('says there is no bottleneck when every colour is covered', () => {
        const stats = heroStats(analyzeCastability(MONO_GREEN, { deckSize: 60, format: FORMATS.constructed }));
        assert.strictEqual(stats[3].value, 'None');
    });

    it('is empty without coloured spells', () => {
        assert.deepStrictEqual(heroStats(null), []);
    });
});

describe('manabase - filterCards', () => {
    const cards = analyzeCastability(SHORT_BLUE, { deckSize: 60, format: FORMATS.constructed }).cards;

    it('filters by colour, multicolour and name', () => {
        assert.strictEqual(filterCards(cards).length, cards.length);
        assert.deepStrictEqual(filterCards(cards, { filter: 'U' }).map(c => c.name).sort(), ['Counterspell', 'Growth Spiral']);
        assert.deepStrictEqual(filterCards(cards, { filter: 'multi' }).map(c => c.name), ['Growth Spiral']);
        assert.deepStrictEqual(filterCards(cards, { query: '  counter ' }).map(c => c.name), ['Counterspell']);
        assert.deepStrictEqual(filterCards(cards, { filter: 'G', query: 'zzz' }), []);
    });

    it('keeps the worst-first order', () => {
        const rows = filterCards(cards, { filter: 'G' });
        for (let i = 1; i < rows.length; i++) assert.ok(rows[i].chance >= rows[i - 1].chance);
    });
});

describe('manabase - caching and sharing', () => {
    it('keys the cache on the cards, format and turn order', () => {
        const config = { cardsByName: SHORT_BLUE, actualCardCount: 60 };
        const a = deckKey(config, FORMATS.constructed, true);
        assert.strictEqual(a, deckKey({ ...config }, FORMATS.constructed, true));
        assert.notStrictEqual(a, deckKey(config, FORMATS.constructed, false));
        assert.notStrictEqual(a, deckKey(config, FORMATS.limited, true));
        const edited = { ...SHORT_BLUE, Island: { ...SHORT_BLUE.Island, count: 7 } };
        assert.notStrictEqual(a, deckKey({ cardsByName: edited, actualCardCount: 60 }, FORMATS.constructed, true));
    });

    it('round-trips the turn order through share params', () => {
        assert.deepStrictEqual(getShareParams(), {});
        applyShareParams(new URLSearchParams('draw=1'));
        assert.deepStrictEqual(getShareParams(), { draw: 1 });
        applyShareParams(new URLSearchParams('draw=nope'));
        assert.deepStrictEqual(getShareParams(), { draw: 1 });
    });

    it('reads the deck and the turn order its maths uses', () => {
        const inputs = readInputs();
        assert.strictEqual(inputs.format.key, 'commander');
        assert.strictEqual(inputs.hasList, true);
        assert.strictEqual(inputs.onPlay, true, 'on the draw was chosen, but everyone draws in Commander');
    });
});

describe('manabase - performance', () => {
    it('analyses a 99-card Commander deck quickly', () => {
        analyzeCastability(DEFAULT_DECK_DATA, { deckSize: 98 }); // warm the JIT and choose() cache
        const start = performance.now();
        analyzeCastability(DEFAULT_DECK_DATA, { deckSize: 98, format: FORMATS.commander });
        // The budget is 30 ms in the browser; keep head-room for slow CI machines.
        assert.ok(performance.now() - start < budget(200));
    });
});

describe('Mana Base turn strips', () => {
    it('tones each turn against the 90% target and outlines the on-curve turn', () => {
        const cells = stripCells([null, 0.62, 0.85, 0.93], { current: 2 });
        assert.deepStrictEqual(cells.map(c => c.tone), ['flat', 'bad', 'warn', 'good']);
        assert.strictEqual(cells[0].value, null);
        assert.deepStrictEqual(cells.map(c => c.current), [false, true, false, false]);
        assert.strictEqual(cells[3].label, 'Turn 4');
    });

    it('finds the first reliable turn', () => {
        assert.strictEqual(reliableFrom([null, 0.62, 0.85, 0.93, 0.97]), 4);
        assert.strictEqual(reliableFrom([null, 0.5, 0.7]), null);
        assert.strictEqual(reliableFrom([0.9]), 1);
    });

    it('covers turns 1 to 8', () => {
        assert.strictEqual(STRIP_TURNS, 8);
    });
});
