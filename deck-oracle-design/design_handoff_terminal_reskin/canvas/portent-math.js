// Portent of Calamity math + sample-reveal helpers.
// Rule: reveal X cards. If 4+ distinct card types appear, the spell is "free"
// and all revealed cards go to hand. Otherwise nothing.
// All numbers via Monte Carlo (3k trials per X) — cached on first call so
// UI sliders feel instant.

(function () {
  const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];

  // Game-neutral but plausible 99-card composition (Commander-ish)
  const DEFAULT_DECK = {
    Creature: 30, Instant: 10, Sorcery: 8, Artifact: 6,
    Enchantment: 4, Planeswalker: 2, Land: 38, Battle: 1,
  };

  // Game-neutral card names per type, used in sample reveals
  const NAMES = {
    Creature:    ['Wandering Ember', 'Stoneveiled Drake', 'Hollow Pilgrim', 'Cinder Acolyte', 'Verdant Warden', 'Tideborn Scribe', 'Salt Marsh Hierarch', 'Glasswing Sentry', 'Marrowback Hound', 'Bramble Reaver'],
    Instant:     ['Surge Counter', 'Quickening Mist', 'Pale Refusal', 'Vital Recall', 'Splinter the Veil'],
    Sorcery:     ['Pyre Cycle', 'Vault Reckoning', 'Tidesweep', 'Reap the Furrow'],
    Artifact:    ['Salt Reliquary', 'Burnished Codex', 'Iron Augur', 'Ember Censer'],
    Enchantment: ['Long Silence', 'Bramble Verdict', 'Verdant Pact'],
    Planeswalker:['Vael, Threadbinder', 'Korra of the Tide'],
    Land:        ['Shaded Path', 'Salt Marsh', 'Whispering Glade', 'Cinderfall Pass', 'Hollow Spring', 'Ironroot Vale', 'Bone Causeway', 'Glasswater Ford', 'Briar Hollow', 'Drowned Keep'],
    Battle:      ['Siege of Hollow Keep'],
  };

  function buildDeck(comp) {
    const d = [];
    Object.entries(comp).forEach(([t, n]) => { for (let i = 0; i < n; i++) d.push(t); });
    return d;
  }

  function buildNamed(comp) {
    const d = [];
    Object.entries(comp).forEach(([t, n]) => {
      const pool = NAMES[t] || [t];
      for (let i = 0; i < n; i++) d.push({ type: t, name: pool[i % pool.length] });
    });
    return d;
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const CACHE = new Map();
  function key(comp, x) { return Object.values(comp).join('|') + ':' + x; }

  function simulate(comp, x, trials = 3000) {
    const k = key(comp, x);
    if (CACHE.has(k)) return CACHE.get(k);
    const deck = buildDeck(comp);
    let free = 0;
    const typeHits = Object.fromEntries(TYPES.map((t) => [t, 0]));
    for (let t = 0; t < trials; t++) {
      const s = shuffle(deck).slice(0, x);
      const seen = new Set(s);
      if (seen.size >= 4) {
        free++;
        seen.forEach((tt) => { typeHits[tt]++; });
      }
    }
    const out = {
      pFree: free / trials,
      eCards: (x * free) / trials,
      typeOdds: Object.fromEntries(TYPES.map((t) => [t, typeHits[t] / trials])),
    };
    CACHE.set(k, out);
    return out;
  }

  function table(comp, xMin = 1, xMax = 20) {
    const out = [];
    for (let x = xMin; x <= xMax; x++) {
      const { pFree, eCards } = simulate(comp, x);
      out.push({ x, pFree, eCards });
    }
    return out;
  }

  function sampleReveal(comp, x) {
    const named = buildNamed(comp);
    const reveal = shuffle(named).slice(0, x);
    const types = new Set(reveal.map((c) => c.type));
    return { reveal, distinctTypes: types.size, free: types.size >= 4 };
  }

  // Distinct-type distribution: P(seeing exactly k distinct types)
  function distinctDist(comp, x, trials = 3000) {
    const deck = buildDeck(comp);
    const hist = new Array(9).fill(0);
    for (let t = 0; t < trials; t++) {
      const s = shuffle(deck).slice(0, x);
      hist[new Set(s).size]++;
    }
    return hist.map((c) => c / trials);
  }

  window.PortentMath = {
    TYPES, DEFAULT_DECK, NAMES,
    simulate, table, sampleReveal, distinctDist, buildNamed, shuffle,
  };
})();
