/**
 * FROZEN reference copy of the Mana Development goldfish engine as it was
 * before the speed rewrite (v3.1.0, js/utils/manaDevelopment.js: the pool,
 * one game, many games). Test-only: tests/utils/manaDevelopmentEngine.node.test.js
 * plays the same libraries and seeds through this and through the live engine
 * and requires identical numbers, game for game. Do not edit or "fix" it — it
 * is the specification the fast engine must match. It reads the library
 * objects buildManaLibrary() returns; its one `target` is the live library's
 * primary target.
 */

import { mulberry32, shuffle } from '../../js/utils/random.js';
import { quantile } from '../../js/utils/stats.js';
import { meetsRule, chooseBottom, DEFAULT_RULE, MIN_HAND, OPENING_HAND } from '../../js/utils/handLab.js';
import { TAP, SIM_TURNS, SHOWN_TURNS, MAX_MANA, DEFAULT_GAMES, SEED, SAMPLE_GAMES } from '../../js/utils/manaDevelopment.js';

function popcount(m) {
    let n = 0;
    while (m) { n += m & 1; m >>= 1; }
    return n;
}

const POOL = 256;
const poolMask = new Int32Array(POOL);
const poolTreasure = new Uint8Array(POOL);
const poolUsed = new Uint8Array(POOL);
const poolKey = new Int32Array(POOL);
const order = new Int32Array(POOL);
const chosen = new Int32Array(16);
const genericIdx = new Int32Array(POOL);
const BITS = Int8Array.from({ length: 32 }, (_, m) => popcount(m));
let poolSize = 0;
let poolFreeCount = 0;
let orderDirty = true;
let poolUnion = 0;

function poolReset() {
    poolSize = 0;
    poolFreeCount = 0;
    poolUnion = 0;
    orderDirty = true;
}

function poolAdd(mask, count, treasure = 0) {
    // Non-Treasure first, then fewest colours, identical units adjacent.
    const key = treasure * 4096 + BITS[mask & 31] * 64 + mask;
    for (let i = 0; i < count && poolSize < POOL; i++) {
        poolMask[poolSize] = mask;
        poolTreasure[poolSize] = treasure;
        poolUsed[poolSize] = 0;
        poolKey[poolSize] = key;
        poolSize++;
        poolFreeCount++;
    }
    poolUnion |= mask;
    orderDirty = true;
}

function sortOrder() {
    for (let i = 0; i < poolSize; i++) {
        const k = poolKey[i];
        let j = i - 1;
        while (j >= 0 && poolKey[order[j]] > k) { order[j + 1] = order[j]; j--; }
        order[j + 1] = i;
    }
    orderDirty = false;
}

function assignPips(pips, k) {
    if (k === pips.length) return true;
    const pip = pips[k];
    let lastMask = -1;
    let lastTreasure = -1;
    for (let o = 0; o < poolSize; o++) {
        const i = order[o];
        if (poolUsed[i] || !(poolMask[i] & pip)) continue;
        // Identical units are interchangeable: if one failed, the next will too.
        if (poolMask[i] === lastMask && poolTreasure[i] === lastTreasure) continue;
        lastMask = poolMask[i];
        lastTreasure = poolTreasure[i];
        poolUsed[i] = 1;
        chosen[k] = i;
        if (assignPips(pips, k + 1)) return true;
        poolUsed[i] = 0;
    }
    return false;
}

/**
 * Can the pool pay for this card (pips + generic + extra)? With commit, the
 * units are spent; the return value is the number of Treasure used (or -1).
 */
function pay(card, extra = 0, commit = false) {
    if (card.playMv == null) return -1;
    const pips = card.pips;
    const np = pips.length;
    if (np > 15) return -1;
    const total = card.playMv + extra;
    if (total > poolFreeCount) return -1;
    for (let k = 0; k < np; k++) if (!(pips[k] & poolUnion)) return -1;
    if (orderDirty) sortOrder();
    if (np && !assignPips(pips, 0)) return -1;
    let need = total - np;
    let g = 0;
    for (let o = 0; o < poolSize && need > 0; o++) {
        const i = order[o];
        if (poolUsed[i]) continue;
        poolUsed[i] = 1;
        genericIdx[g++] = i;
        need--;
    }
    if (need > 0 || !commit) {
        for (let k = 0; k < np; k++) poolUsed[chosen[k]] = 0;
        for (let k = 0; k < g; k++) poolUsed[genericIdx[k]] = 0;
        return need > 0 ? -1 : 0;
    }
    let treasure = 0;
    for (let k = 0; k < np; k++) treasure += poolTreasure[chosen[k]];
    for (let k = 0; k < g; k++) treasure += poolTreasure[genericIdx[k]];
    poolFreeCount -= total;
    return treasure;
}

// ── One game ────────────────────────────────────────────────────────────────

/**
 * Deal and mulligan (London, the Opening Hands keep rule). At four cards the
 * player keeps whatever they have.
 * @returns {{hand:Object[], library:Object[], mulligans:number}}
 */
export function dealOpeningHand(cards, rng, { freeMulligan = false, idx = null } = {}) {
    const N = cards.length;
    const ord = idx ?? new Int32Array(N);
    for (let i = 0; i < N; i++) ord[i] = i;
    const free = freeMulligan ? 1 : 0;
    for (let m = 0; ; m++) {
        shuffle(ord.length === N ? ord : ord.subarray(0, N), rng);
        const seven = [];
        for (let i = 0; i < OPENING_HAND && i < N; i++) seven.push(cards[ord[i]]);
        const owed = Math.max(0, m - free);
        const size = OPENING_HAND - owed;
        const { keep, bottom } = owed > 0 ? chooseBottom(seven, owed, DEFAULT_RULE) : { keep: seven, bottom: [] };
        if (size <= MIN_HAND || meetsRule(keep, DEFAULT_RULE, false)) {
            const library = [];
            for (let i = OPENING_HAND; i < N; i++) library.push(cards[ord[i]]);
            for (const c of bottom) library.push(c);
            return { hand: keep, library, mulligans: m };
        }
    }
}

function landEntersTapped(card, lands) {
    switch (card.ltap) {
        case TAP.TAPPED: return true;
        case TAP.FAST: return lands.length > 2;
        case TAP.SLOW: return lands.length < 2;
        case TAP.CHECK: {
            for (let i = 0; i < lands.length; i++) if (lands[i].card.typeBits & card.lcheckBits) return false;
            return true;
        }
        default: return false;
    }
}

/** Does a library card satisfy a ramp card's search ("basic land", "Forest", "land")? */
function landMatches(card, r) {
    if (!card.land) return false;
    if (r.filterKind === 1) return card.basic;
    if (r.filterKind === 2) return (card.typeBits & r.filterBits) !== 0;
    return true;
}

/**
 * Play one goldfish game from a dealt hand.
 * @param {Object} run - simulator settings (see createRun)
 * @param {Object[]} hand0
 * @param {Object[]} library0
 * @param {boolean} rampOn - false: every ramp card is a blank (lands only)
 * @param {Object|null} log - collects a turn-by-turn record when given
 * @returns {{mana:Uint8Array, targetTurn:number, firstCast:Int8Array|null, firstSeen:Int8Array|null}}
 */
function playGame(run, hand0, library0, rampOn, log) {
    const T = SIM_TURNS;
    const target = run.target?.card ?? null;
    const targetPips = target ? target.pips.reduce((m, p) => m | p, 0) : 0;
    const hand = hand0.slice();
    const library = library0.slice();
    let top = 0;
    const lands = [];   // { card, ready }  ready = first turn it can tap
    const sources = []; // { info, ready }
    let extraDrops = 0;
    let fromTop = false;
    let treasures = 0;
    let targetTurn = 0;
    let t = 0;
    let drops = 0;
    let dropsUsed = 0;
    let floating = 0;      // a karoo's bounced land: you tap it before it leaves
    let floatingMask = 0;
    let entry = null;
    const mana = new Uint8Array(T + 1);
    const rampCount = run.rampCount;
    const firstCast = rampOn && rampCount ? new Int8Array(rampCount) : null;
    const firstSeen = rampCount ? new Int8Array(rampCount) : null;
    const treasureOn = run.treasure;

    const seen = c => {
        if (firstSeen && c.rampIndex >= 0 && !firstSeen[c.rampIndex]) firstSeen[c.rampIndex] = t;
    };
    const usable = c => c.rampInfo !== null && (c.rampInfo.modelled || (treasureOn && c.rampInfo.treasure > 0));
    const landMask = () => {
        let m = 0;
        for (let i = 0; i < lands.length; i++) m |= lands[i].card.mask;
        return m;
    };
    const neededColours = () => {
        let need = targetPips;
        for (let i = 0; i < hand.length; i++) {
            const pips = hand[i].pips;
            for (let k = 0; k < pips.length; k++) need |= pips[k];
        }
        return need;
    };
    const readyMana = () => {
        let n = treasures + floating;
        for (let i = 0; i < lands.length; i++) if (lands[i].ready <= t) n += lands[i].card.lmana;
        for (let i = 0; i < sources.length; i++) if (sources[i].ready <= t) n += sources[i].info.mana;
        return n;
    };
    const putOntoBattlefield = (card, tapped) => {
        const rec = { card, ready: tapped ? t + 1 : t };
        lands.push(rec);
        return rec;
    };

    /** Play one land from hand (or the top of the library). Returns its record or null. */
    const playLand = () => {
        const topCard = fromTop && top < library.length && library[top].land ? library[top] : null;
        let any = topCard !== null;
        let bump = topCard && !landEntersTapped(topCard, lands) && !topCard.lbounce ? topCard.lmana : 0;
        for (let i = 0; i < hand.length; i++) {
            const c = hand[i];
            if (!c.land) continue;
            any = true;
            if (!c.lbounce && !landEntersTapped(c, lands) && c.lmana > bump) bump = c.lmana;
        }
        if (!any) return null;
        // Does an untapped land's mana let you cast something this turn? If
        // not, a tapped land costs nothing — play it now and save the other.
        let matters = false;
        if (bump > 0) {
            const cap0 = readyMana();
            const hi = cap0 + bump;
            if (target && !targetTurn && target.playMv > cap0 && target.playMv <= hi) matters = true;
            for (let i = 0; i < hand.length && !matters; i++) {
                const mv = hand[i].playMv;
                if (!hand[i].land && mv != null && mv > cap0 && mv <= hi) matters = true;
            }
        }
        const have = landMask();
        const need = neededColours();
        let best = null;
        let bestScore = -Infinity;
        const consider = c => {
            if (c.lbounce && lands.length === 0) return; // would bounce itself
            const tapped = c.lbounce || landEntersTapped(c, lands);
            const fresh = c.mask & ~have;
            const score = ((tapped ? !matters : matters) ? 100000 : 0)
                + c.lmana * 1000 + BITS[fresh & need] * 100 + BITS[fresh] * 10 + BITS[c.mask]
                + (c === topCard ? 1 : 0); // a free card off the top beats one from hand
            if (score > bestScore) { best = c; bestScore = score; }
        };
        for (let i = 0; i < hand.length; i++) if (hand[i].land) consider(hand[i]);
        if (topCard) consider(topCard);
        if (!best) return null;
        if (best === topCard) top++;
        else hand.splice(hand.indexOf(best), 1);
        const rec = putOntoBattlefield(best, best.lbounce || landEntersTapped(best, lands));
        if (best.lbounce) {
            // Return the least useful other land — after tapping it for mana.
            let back = -1;
            let backScore = Infinity;
            for (let i = 0; i < lands.length - 1; i++) {
                const s = BITS[lands[i].card.mask] * 10 + lands[i].card.lmana;
                if (s < backScore) { back = i; backScore = s; }
            }
            const gone = lands.splice(back, 1)[0];
            if (gone.ready <= t) { floating += gone.card.lmana; floatingMask |= gone.card.mask; }
            hand.push(gone.card);
        }
        if (entry) entry.lands.push(best.name);
        return rec;
    };

    const checkTarget = () => {
        if (target && !targetTurn && pay(target) >= 0) {
            targetTurn = t;
            if (entry) entry.target = true;
        }
    };

    /** Fetch n lands matching the ramp card's filter, colours you need first. */
    const fetchLands = (r, n, toBattlefield, notes) => {
        for (let k = 0; k < n; k++) {
            const have = landMask();
            const need = neededColours();
            let bi = -1;
            let bs = -1;
            for (let i = top; i < library.length; i++) {
                const c = library[i];
                if (!landMatches(c, r)) continue;
                const fresh = c.mask & ~have;
                const s = BITS[fresh & need] * 100 + BITS[fresh] * 10 + BITS[c.mask];
                if (s > bs) { bs = s; bi = i; }
            }
            if (bi < 0) return;
            const c = library.splice(bi, 1)[0];
            if (toBattlefield) {
                const tapped = r.landsTapped || c.ltap === TAP.TAPPED || c.lbounce;
                putOntoBattlefield(c, tapped);
                if (!tapped) poolAdd(c.mask, c.lmana);
                notes.push(c.name);
            } else {
                hand.push(c);
                notes.push(`${c.name} to hand`);
            }
        }
    };

    /** Cast the best ramp piece you can afford. Returns false when nothing fits. */
    const castRamp = () => {
        let pick = null;
        let pickScore = -Infinity;
        let landInHand = false;
        for (let i = 0; i < hand.length; i++) if (hand[i].land) { landInHand = true; break; }
        for (let i = 0; i < hand.length; i++) {
            const c = hand[i];
            if (c.land || !usable(c)) continue;
            const r = c.rampInfo;
            let value = r.mana;
            if (r.lands || r.toHand) {
                const want = r.lands + r.toHand;
                let available = 0;
                for (let j = top; j < library.length && available < want; j++) if (landMatches(library[j], r)) available++;
                if (available === 0) continue;
                value += Math.min(r.lands, available) + Math.max(0, Math.min(r.toHand, available - r.lands)) * 0.5;
            }
            if (r.extraDrops) value += 0.6 * r.extraDrops;
            if (r.fromTop && !fromTop) value += 0.3;
            if (r.extraDropsOnce && landInHand && dropsUsed >= drops) value += 0.8;
            if (r.putLand && landInHand) value += 0.8;
            if (treasureOn && r.treasure) value += 0.5 * r.treasure;
            value -= r.sacrificeLand;
            if (value <= 0) continue;
            const cost = c.playMv + r.extraCost;
            const now = (r.mana && r.ready === 'now' ? r.mana : 0) + (r.lands && !r.landsTapped ? r.lands : 0) - cost;
            // Pieces that pay for themselves this turn first (Sol Ring), then
            // the most mana gained, then the cheapest.
            const score = (now >= 0 ? 1e6 : 0) + Math.round(value * 100) * 100 - cost;
            if (score <= pickScore) continue;
            if (pay(c, r.extraCost) < 0) continue;
            pick = c;
            pickScore = score;
        }
        if (!pick) return false;
        const r = pick.rampInfo;
        treasures -= pay(pick, r.extraCost, true);
        hand.splice(hand.indexOf(pick), 1);
        if (firstCast && pick.rampIndex >= 0 && !firstCast[pick.rampIndex]) firstCast[pick.rampIndex] = t;
        const notes = [];
        if (r.mana) {
            const ready = r.ready === 'now' ? t : t + 1;
            sources.push({ info: r, ready });
            if (ready <= t) poolAdd(r.mask, r.mana);
        }
        if (r.sacrificeLand && lands.length) {
            let worst = 0;
            for (let i = 1; i < lands.length; i++) if (BITS[lands[i].card.mask] < BITS[lands[worst].card.mask]) worst = i;
            lands.splice(worst, 1);
        }
        if (r.lands) fetchLands(r, r.lands, true, notes);
        if (r.toHand) fetchLands(r, r.toHand, false, notes);
        if (r.extraDrops) { extraDrops += r.extraDrops; drops += r.extraDrops; }
        if (r.extraDropsOnce) drops += r.extraDropsOnce;
        if (r.fromTop) fromTop = true;
        if (r.putLand) {
            const c = hand.find(x => x.land);
            if (c) {
                hand.splice(hand.indexOf(c), 1);
                const tapped = c.lbounce || landEntersTapped(c, lands);
                putOntoBattlefield(c, tapped);
                if (!tapped) poolAdd(c.mask, c.lmana);
                notes.push(c.name);
            }
        }
        if (treasureOn && r.treasure) {
            treasures += r.treasure;
            poolAdd(run.idMask, r.treasure, 1);
        }
        for (let k = 0; k < r.draws && top < library.length; k++) {
            const c = library[top++];
            hand.push(c);
            seen(c);
        }
        if (entry) entry.cast.push({ name: pick.name, notes });
        return true;
    };

    t = 1;
    for (const c of hand) seen(c);
    for (t = 1; t <= T; t++) {
        entry = log ? { turn: t, drew: null, lands: [], cast: [], mana: 0, colors: 0, target: false, landsInPlay: 0 } : null;
        floating = 0;
        floatingMask = 0;
        if (!(t === 1 && run.skipFirstDraw) && top < library.length) {
            const c = library[top++];
            hand.push(c);
            seen(c);
            if (entry) entry.drew = c.name;
        }
        drops = 1 + extraDrops;
        dropsUsed = 0;
        while (dropsUsed < drops && playLand()) dropsUsed++;

        // The pool: everything that can tap now.
        poolReset();
        for (let i = 0; i < lands.length; i++) if (lands[i].ready <= t) poolAdd(lands[i].card.mask, lands[i].card.lmana);
        for (let i = 0; i < sources.length; i++) if (sources[i].ready <= t) poolAdd(sources[i].info.mask, sources[i].info.mana);
        if (floating) poolAdd(floatingMask, floating);
        if (treasures) poolAdd(run.idMask, treasures, 1);
        mana[t] = Math.min(MAX_MANA, poolSize);
        if (entry) { entry.mana = poolSize; entry.colors = poolUnion; }
        checkTarget();

        if (rampOn) {
            for (let guard = 0; guard < 20 && castRamp(); guard++) {
                // Lands found or freed up by the ramp can still be played this turn.
                while (dropsUsed < drops) {
                    const rec = playLand();
                    if (!rec) break;
                    dropsUsed++;
                    if (rec.ready <= t) poolAdd(rec.card.mask, rec.card.lmana);
                }
                checkTarget();
            }
        }
        treasures = Math.max(0, treasures);
        if (entry) {
            entry.landsInPlay = lands.length;
            log.turns.push(entry);
        }
    }
    return { mana, targetTurn, firstCast, firstSeen };
}

// ── Many games ──────────────────────────────────────────────────────────────

/**
 * Set up a simulation. Run it in one go with simulateManaDevelopment(), or in
 * slices with runBatch() so a page can yield to the browser between them.
 *
 * @param {Object} lib - buildManaLibrary() / buildCountsLibrary() output
 * @param {{format?:Object, onPlay?:boolean, treasure?:boolean, games?:number, seed?:number, samples?:number}} [opts]
 */
export function createRun(lib, { format = null, onPlay = true, treasure = false, games = DEFAULT_GAMES, seed = SEED, samples = SAMPLE_GAMES } = {}) {
    const T = SIM_TURNS;
    const rampCount = lib?.ramp?.length ?? 0;
    const mk = () => ({
        hist: Array.from({ length: T + 1 }, () => new Int32Array(MAX_MANA + 1)),
        // first[t][k]: games that first had k+ mana on turn t
        first: Array.from({ length: T + 1 }, () => new Int32Array(MAX_MANA + 1)),
        target: new Int32Array(T + 2)
    });
    return {
        lib,
        cards: lib?.cards ?? [],
        target: lib?.target ?? null,
        idMask: lib?.idMask ?? 0,
        rampCount,
        treasure: Boolean(treasure),
        freeMulligan: Boolean(format?.freeMulligan),
        skipFirstDraw: Boolean(onPlay) && !format?.firstPlayerDraws,
        games: Math.max(0, Math.floor(games) || 0),
        samples,
        rng: mulberry32(seed),
        idx: new Int32Array(lib?.cards?.length ?? 0),
        done: 0,
        ramp: mk(),
        lands: mk(),
        savedSum: 0,
        mulligans: 0,
        castBy3: new Int32Array(rampCount),
        castBy4: new Int32Array(rampCount),
        seenBy4: new Int32Array(rampCount),
        sampleGames: []
    };
}

function record(acc, res) {
    let best = -1;
    for (let t = 1; t <= SIM_TURNS; t++) {
        const m = res.mana[t];
        acc.hist[t][m]++;
        if (m > best) {
            const row = acc.first[t];
            for (let k = best + 1; k <= m; k++) row[k]++;
            best = m;
        }
    }
    acc.target[res.targetTurn || SIM_TURNS + 1]++;
}

/**
 * Play up to `count` more games. Returns true when the run is complete.
 */
export function runBatch(run, count = run.games) {
    if (run.cards.length < OPENING_HAND) { run.done = run.games; return true; }
    const end = Math.min(run.games, run.done + Math.max(1, count));
    for (let g = run.done; g < end; g++) {
        const { hand, library, mulligans } = dealOpeningHand(run.cards, run.rng, { freeMulligan: run.freeMulligan, idx: run.idx });
        run.mulligans += mulligans > (run.freeMulligan ? 1 : 0) ? 1 : 0;
        const log = run.sampleGames.length < run.samples ? { hand: hand.map(c => c.name), mulligans, turns: [] } : null;
        const withRamp = playGame(run, hand, library, true, log);
        const landsOnly = playGame(run, hand, library, false, null);
        record(run.ramp, withRamp);
        record(run.lands, landsOnly);
        const cap = SIM_TURNS + 1;
        run.savedSum += (landsOnly.targetTurn || cap) - (withRamp.targetTurn || cap);
        if (withRamp.firstCast) {
            for (let i = 0; i < run.rampCount; i++) {
                const c = withRamp.firstCast[i];
                if (c && c <= 3) run.castBy3[i]++;
                if (c && c <= 4) run.castBy4[i]++;
                const s = withRamp.firstSeen[i];
                if (s && s <= 4) run.seenBy4[i]++;
            }
        }
        if (log) {
            log.targetTurn = withRamp.targetTurn;
            log.landsOnlyTargetTurn = landsOnly.targetTurn;
            run.sampleGames.push(log);
        }
    }
    run.done = end;
    return run.done >= run.games;
}

/**
 * Percentile of a histogram of `total` games (the shared nearest-rank rule in
 * stats.js — never the sampled maximum), or null when there are no games.
 */
export function percentile(hist, total, p) {
    if (!(total > 0)) return null;
    return quantile(hist, p);
}

function bands(acc, games) {
    const out = [];
    for (let t = 1; t <= SHOWN_TURNS; t++) {
        const h = acc.hist[t];
        out.push({
            turn: t,
            p10: percentile(h, games, 0.1),
            p25: percentile(h, games, 0.25),
            p50: percentile(h, games, 0.5),
            p75: percentile(h, games, 0.75),
            p90: percentile(h, games, 0.9)
        });
    }
    return out;
}

/** reach[t][k] = chance to have had k+ mana on some turn up to t. */
function reachTable(acc, games) {
    const out = [new Array(MAX_MANA + 1).fill(0)];
    const cum = new Int32Array(MAX_MANA + 1);
    for (let t = 1; t <= SIM_TURNS; t++) {
        for (let k = 0; k <= MAX_MANA; k++) cum[k] += acc.first[t][k];
        out.push(Array.from(cum, n => (games ? n / games : 0)));
    }
    return out;
}

/** First turn the chance of having reached k mana is at least p (null = later than simulated). */
export function turnToReach(reach, k, p = 0.5) {
    for (let t = 1; t < reach.length; t++) if ((reach[t]?.[k] ?? 0) >= p) return t;
    return null;
}

function targetStats(hist, games, mv) {
    if (!games) return null;
    const by = [0];
    let cum = 0;
    for (let t = 1; t <= SIM_TURNS + 1; t++) {
        cum += hist[t];
        by.push(cum / games);
    }
    const onCurveTurn = Math.max(1, Math.min(SIM_TURNS, mv || 1));
    return {
        castBy: by, // castBy[t] = chance it's castable by turn t (t ≤ SIM_TURNS)
        onCurveTurn,
        onCurve: by[onCurveTurn],
        p25: percentile(hist, games, 0.25),
        median: percentile(hist, games, 0.5),
        p75: percentile(hist, games, 0.75),
        p90: percentile(hist, games, 0.9),
        within: by[SIM_TURNS]
    };
}

/** Turn the accumulated games into the page's numbers. */
export function finishRun(run) {
    const games = run.done;
    if (!games || run.cards.length < OPENING_HAND) return null;
    const lib = run.lib;
    const target = run.target;
    const ramp = (lib.ramp ?? []).map((r, i) => ({
        name: r.name,
        count: r.count,
        mv: r.mv,
        info: r.info,
        counted: r.info.modelled || (run.treasure && r.info.treasure > 0),
        castBy3: run.castBy3[i] / games,
        castBy4: run.castBy4[i] / games,
        seenBy4: run.seenBy4[i] / games
    }));
    return {
        games,
        lands: lib.landCount,
        librarySize: run.cards.length,
        placeholder: Boolean(lib.placeholder),
        rampCount: ramp.filter(r => r.counted).reduce((s, r) => s + r.count, 0),
        notCounted: ramp.filter(r => !r.counted).reduce((s, r) => s + r.count, 0),
        treasure: run.treasure,
        mana: bands(run.ramp, games),
        landsOnly: bands(run.lands, games),
        reach: reachTable(run.ramp, games),
        reachLands: reachTable(run.lands, games),
        target: target ? {
            kind: target.kind,
            name: target.name,
            names: target.names,
            mv: target.mv,
            cost: target.cost,
            ramp: targetStats(run.ramp.target, games, target.mv),
            lands: targetStats(run.lands.target, games, target.mv),
            turnsSaved: run.savedSum / games
        } : null,
        mulliganRate: run.mulligans / games,
        ramp,
        samples: run.sampleGames
    };
}

/**
 * Play one scripted game from a given hand and library order — no shuffle, no
 * mulligan. For tests, and for checking what the model does with a hand.
 * @param {Object} lib - buildManaLibrary() output
 * @param {{hand:Object[], library:Object[], format?:Object, onPlay?:boolean, treasure?:boolean, rampOn?:boolean}} opts
 * @returns {{mana:number[], targetTurn:number, log:Object}} mana[t] for t = 1…SIM_TURNS (index 0 unused)
 */
export function playScriptedGame(lib, { hand = [], library = [], format = null, onPlay = true, treasure = false, rampOn = true } = {}) {
    const run = createRun(lib, { format, onPlay, treasure, games: 0 });
    const log = { hand: hand.map(c => c.name), mulligans: 0, turns: [] };
    const res = playGame(run, hand, library, rampOn, log);
    return { mana: Array.from(res.mana), targetTurn: res.targetTurn, log };
}

/** Run everything synchronously (tests, workers, small decks). */
export function simulateManaDevelopment(lib, opts = {}) {
    const run = createRun(lib, opts);
    runBatch(run, run.games);
    return finishRun(run);
}
