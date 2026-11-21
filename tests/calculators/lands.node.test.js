import { describe, it, before } from 'node:test';
import { assert, assertClose } from '../node-test-helper.js';
import { drawTypeMin } from '../../js/utils/hypergeometric.js';
import * as DeckConfig from '../../js/utils/deckConfig.js';
import {
    calculate, readInputs, calculateOpeningHands, calculateLandDropByTurn, calculateLandDropMiss,
    getShareParams, applyShareParams, dealLandGames, runSampleReveals, updateUI
} from '../../js/calculators/lands.js';
import { drawSchedule } from '../../js/utils/mulliganModel.js';
import { FORMATS } from '../../js/utils/format.js';

const card = (name, count, type_line, cmc = 0, oracle_text = '') => ({ name, count, type_line, cmc, oracle_text, mana_cost: '' });

describe('Land Drops — Commander example deck', () => {
    it('uses the 98-card library (100 less two commanders) and everyone-draws rule', () => {
        const config = readInputs();
        assert.strictEqual(config.format.key, 'commander');
        assert.strictEqual(config.deckSize, 98);
        assert.strictEqual(config.onPlay, true);
        const { odds } = calculate();
        assert.strictEqual(odds.length, 8);
        assert.ok(odds.every((t, i) => i === 0 || t.chance <= odds[i - 1].chance), 'odds only fall turn to turn');
    });
});

describe('Land Drops — 60-card deck', () => {
    before(() => DeckConfig.updateDeck({
        lands: 24, creatures: 0, instants: 36, sorceries: 0, artifacts: 0, enchantments: 0, planeswalkers: 0, battles: 0,
        actualCardCount: 60,
        commanderName: null,
        cardsByName: {
            Land: card('Land', 24, 'Land'),
            Rock: card('Rock', 6, 'Artifact', 2, '{T}: Add {C}.'),
            Spell: card('Spell', 30, 'Instant', 1)
        }
    }));

    it('reads lands and cheap ramp from the list', () => {
        const config = readInputs();
        assert.strictEqual(config.format.key, 'constructed');
        assert.strictEqual(config.landCount, 24);
        assert.strictEqual(config.ramp, 6);
    });

    it('calculates median opening hand lands correctly', () => {
        assert.strictEqual(calculate().openingHands.median, 3);
        assert.strictEqual(calculateOpeningHands(60, 24).distribution.length, 8);
    });

    it('expects the first missed drop in the mid-game', () => {
        const { landDropMiss } = calculate();
        assert.ok(landDropMiss >= 4 && landDropMiss <= 6, `Land drop miss turn ${landDropMiss} should be in range [4, 6]`);
        const raw = calculateLandDropMiss(60, 24);
        assert.ok(raw >= 4 && raw <= 6);
    });

    it('older per-turn helper is the raw hypergeometric, on the play', () => {
        calculateLandDropByTurn(60, 24).forEach(t => {
            assertClose(t.makeProbability, drawTypeMin(60, 24, 6 + t.turn, t.turn), `turn ${t.turn}`, 1e-12);
            assertClose(t.makeProbability + t.missProbability, 1, 'make + miss', 1e-12);
        });
    });

    it('share params switch to the draw, count ramp and change the keep range', () => {
        const before = calculate();
        applyShareParams(new URLSearchParams('ldDraw=1&ldRamp=1&ldKeep=3-5'));
        const config = readInputs();
        assert.strictEqual(config.onPlay, false);
        assert.strictEqual(config.countRamp, true);
        assert.deepStrictEqual(config.keepRange, [3, 5]);
        assert.deepStrictEqual(getShareParams(), { ldDraw: 1, ldRamp: 1, ldKeep: '3-5' });
        const after = calculate();
        assert.ok(after.odds[3].chance > before.odds[3].chance, 'on the draw with ramp hits more drops');
        assert.ok(after.landsOnly, 'keeps the lands-only odds for comparison');
        applyShareParams(new URLSearchParams('ldKeep=6-2&ldMull=0'));
        assert.deepStrictEqual(getShareParams().ldKeep, '3-5', 'reversed ranges are ignored');
        assert.strictEqual(readInputs().keepRange, null);
    });

    it('renders without a browser', () => {
        updateUI();
        const summary = global.document.getElementById('lands-summary');
        assert.match(summary.innerHTML, /Bottom line/);
        runSampleReveals();
        assert.match(global.document.getElementById('lands-reveals-display').innerHTML, /Game 1/);
    });
});

describe('Land Drops — sample games', () => {
    it('tracks drops the same way as the exact odds', () => {
        const pool = [];
        for (let i = 0; i < 24; i++) pool.push({ name: 'Land', kind: 'land' });
        for (let i = 0; i < 36; i++) pool.push({ name: 'Spell', kind: 'spell' });
        let seed = 11;
        const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const drawsBy = drawSchedule({ format: FORMATS.constructed, onPlay: true });
        const games = dealLandGames({ pool, drawsBy, keepRange: null, freeMulligan: false, countRamp: false, games: 6000, rng });
        const madeT4 = games.filter(g => g.drops.slice(0, 4).every(Boolean)).length / games.length;
        assertClose(madeT4, drawTypeMin(60, 24, 10, 4), 'every drop through turn 4', 0.02);
        games.slice(0, 50).forEach(g => assert.strictEqual(g.firstMiss === null, g.drops.every(Boolean)));
    });
});
