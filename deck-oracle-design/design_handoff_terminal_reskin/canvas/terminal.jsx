// TERMINAL — Bloomberg-style quant data console direction.
// Dense, monospace, deck/calc encoded as ticker codes, hero numerics as
// giant readouts. Game-neutral.

const TerminalColors = {
  bg:        '#080a09',
  panel:     '#0e1311',
  panel2:    '#121815',
  rule:      '#1c2520',
  ruleHi:    '#2a3530',
  dim:       '#5a6b66',
  mid:       '#8b9b95',
  text:      '#d4dfd9',
  bright:    '#ecf2ed',
  green:     'oklch(0.78 0.18 145)',
  greenDim:  'oklch(0.45 0.12 145)',
  amber:     'oklch(0.82 0.16 80)',
  amberDim:  'oklch(0.55 0.12 80)',
  red:       'oklch(0.68 0.20 25)',
  blue:      'oklch(0.72 0.14 235)',
};

const tcss = `
.tx { font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace; color: ${TerminalColors.text}; font-feature-settings: 'tnum' 1, 'cv01' 1; letter-spacing: 0.01em; }
.tx ::selection { background: ${TerminalColors.amber}; color: #000; }
.tx-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid ${TerminalColors.rule}; border-radius: 2px; font-size: 11px; line-height: 1.4; color: ${TerminalColors.mid}; text-transform: uppercase; letter-spacing: 0.08em; background: ${TerminalColors.panel}; }
.tx-dot { width: 6px; height: 6px; border-radius: 50%; }
.tx-tab { padding: 6px 10px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: ${TerminalColors.dim}; border-right: 1px solid ${TerminalColors.rule}; cursor: pointer; transition: color .15s, background .15s; }
.tx-tab:last-child { border-right: 0; }
.tx-tab:hover { color: ${TerminalColors.text}; background: ${TerminalColors.panel2}; }
.tx-tab.on { color: ${TerminalColors.bg}; background: ${TerminalColors.amber}; }
.tx-panel { background: ${TerminalColors.panel}; border: 1px solid ${TerminalColors.rule}; }
.tx-h { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: ${TerminalColors.dim}; padding: 9px 14px; border-bottom: 1px solid ${TerminalColors.rule}; display: flex; justify-content: space-between; align-items: center; }
.tx-h .tx-h-r { color: ${TerminalColors.mid}; font-size: 10px; letter-spacing: 0.08em; }
.tx-flicker { animation: txflick 1.4s ease-in-out infinite; }
@keyframes txflick { 0%,100%{opacity:1} 50%{opacity:.45} }
.tx-input { background: ${TerminalColors.bg}; border: 1px solid ${TerminalColors.rule}; color: ${TerminalColors.bright}; padding: 8px 10px; font-family: inherit; font-size: 12px; outline: none; border-radius: 0; width: 100%; box-sizing: border-box; }
.tx-input:focus { border-color: ${TerminalColors.amber}; box-shadow: inset 0 -1px 0 ${TerminalColors.amber}; }
.tx-btn { background: transparent; border: 1px solid ${TerminalColors.amber}; color: ${TerminalColors.amber}; padding: 7px 12px; font-family: inherit; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; border-radius: 0; transition: background .15s, color .15s; }
.tx-btn:hover { background: ${TerminalColors.amber}; color: ${TerminalColors.bg}; }
.tx-row-strip { display: grid; grid-template-columns: 1fr auto; gap: 0; align-items: center; }
.tx-bar { height: 18px; display: flex; background: ${TerminalColors.bg}; border: 1px solid ${TerminalColors.rule}; }
.tx-bar-cell { height: 100%; }
.tx-mute { color: ${TerminalColors.dim}; }
.tx-mid { color: ${TerminalColors.mid}; }
.tx-amber { color: ${TerminalColors.amber}; }
.tx-green { color: ${TerminalColors.green}; }
.tx-red { color: ${TerminalColors.red}; }
.tx-rule { border-top: 1px solid ${TerminalColors.rule}; }
.tx-grid-bg { background-image: linear-gradient(${TerminalColors.rule} 1px, transparent 1px), linear-gradient(90deg, ${TerminalColors.rule} 1px, transparent 1px); }
.tx-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; background: ${TerminalColors.rule}; outline: none; border-radius: 0; }
.tx-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 18px; background: ${TerminalColors.amber}; cursor: ew-resize; border-radius: 0; border: 0; }
.tx-slider::-moz-range-thumb { width: 12px; height: 18px; background: ${TerminalColors.amber}; cursor: ew-resize; border-radius: 0; border: 0; }
`;
if (typeof document !== 'undefined' && !document.getElementById('tx-style')) {
  const s = document.createElement('style'); s.id = 'tx-style'; s.textContent = tcss; document.head.appendChild(s);
}

// --- type → color (consistent across panels) ---
const TYPE_COLOR = {
  Creature:     TerminalColors.green,
  Instant:      TerminalColors.blue,
  Sorcery:      'oklch(0.72 0.16 290)',
  Artifact:     'oklch(0.72 0.04 80)',
  Enchantment:  'oklch(0.72 0.14 60)',
  Planeswalker: 'oklch(0.68 0.20 0)',
  Land:         'oklch(0.55 0.08 110)',
  Battle:       TerminalColors.red,
};
const TYPE_CODE = {
  Creature: 'CRE', Instant: 'INS', Sorcery: 'SOR', Artifact: 'ART',
  Enchantment: 'ENC', Planeswalker: 'PWK', Land: 'LND', Battle: 'BTL',
};

// --- small helpers ---
const pad = (n, w = 2) => String(n).padStart(w, '0');
const pct = (p, d = 2) => (p * 100).toFixed(d);
const fix = (n, d = 3) => Number(n).toFixed(d);

// Live clock
function useClock() {
  const [d, setD] = React.useState(new Date());
  React.useEffect(() => { const id = setInterval(() => setD(new Date()), 1000); return () => clearInterval(id); }, []);
  const utc = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return utc;
}

// --- the big probability chart ---
function TxChart({ table, xValue, height = 280 }) {
  const w = 100, h = 100;
  const xs = table.map((r) => r.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xMap = (x) => ((x - xMin) / (xMax - xMin)) * w;
  const eMax = Math.max(...table.map((r) => r.eCards), 1);
  const pPath = table.map((r) => `${xMap(r.x).toFixed(2)},${(h - r.pFree * h).toFixed(2)}`).join(' ');
  const ePath = table.map((r) => `${xMap(r.x).toFixed(2)},${(h - (r.eCards / eMax) * h).toFixed(2)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', background: TerminalColors.bg }}>
      {/* horizontal gridlines at 25/50/75/100% */}
      {[0, 25, 50, 75, 100].map((p) => (
        <line key={p} x1="0" y1={h - p} x2={w} y2={h - p} stroke={TerminalColors.rule} strokeWidth="0.15" />
      ))}
      {/* vertical gridlines per X */}
      {table.map((r) => (
        <line key={r.x} x1={xMap(r.x)} y1="0" x2={xMap(r.x)} y2={h} stroke={TerminalColors.rule} strokeWidth="0.08" />
      ))}
      {/* expected-cards bars (amber, behind) */}
      {table.map((r, i) => {
        const x = xMap(r.x);
        const next = i < table.length - 1 ? xMap(table[i + 1].x) : x + 4;
        const bw = (next - x) * 0.7;
        const bh = (r.eCards / eMax) * h;
        return (
          <rect key={r.x} x={x - bw / 2} y={h - bh} width={bw} height={bh} fill={TerminalColors.amberDim} opacity="0.55" />
        );
      })}
      {/* P(free) step line */}
      <polyline points={pPath} fill="none" stroke={TerminalColors.green} strokeWidth="0.5" />
      {/* P points */}
      {table.map((r) => (
        <rect key={r.x} x={xMap(r.x) - 0.6} y={h - r.pFree * h - 0.6} width="1.2" height="1.2" fill={TerminalColors.green} />
      ))}
      {/* current X marker */}
      <line x1={xMap(xValue)} y1="0" x2={xMap(xValue)} y2={h} stroke={TerminalColors.amber} strokeWidth="0.3" strokeDasharray="0.5 0.5" />
    </svg>
  );
}

// Type composition strip (deck %)
function TxDeckStrip({ deck, total }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="tx-bar" style={{ height: 14, border: `1px solid ${TerminalColors.rule}` }}>
        {PortentMath.TYPES.filter((t) => deck[t] > 0).map((t) => (
          <div key={t} className="tx-bar-cell" title={`${t}: ${deck[t]}`} style={{ flex: deck[t], background: TYPE_COLOR[t] }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 12px', fontSize: 11 }}>
        {PortentMath.TYPES.filter((t) => deck[t] > 0).map((t) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="tx-dot" style={{ background: TYPE_COLOR[t] }}></span>
            <span className="tx-mid" style={{ fontSize: 10, letterSpacing: '0.06em' }}>{TYPE_CODE[t]}</span>
            <span style={{ color: TerminalColors.text, marginLeft: 'auto' }}>{deck[t]}</span>
            <span className="tx-mute" style={{ fontSize: 10 }}>{((deck[t] / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- The full TERMINAL artboard ---
function TerminalView({ scale = 1 }) {
  const utc = useClock();
  const deck = PortentMath.DEFAULT_DECK;
  const total = Object.values(deck).reduce((a, b) => a + b, 0);
  const [x, setX] = React.useState(7);
  const table = React.useMemo(() => PortentMath.table(deck, 1, 20), []);
  const cur = React.useMemo(() => PortentMath.simulate(deck, x), [x]);

  // sample reveals — refresh on Q press / button / x change
  const [seed, setSeed] = React.useState(0);
  const reveals = React.useMemo(() => {
    return Array.from({ length: 4 }, () => PortentMath.sampleReveal(deck, x));
  }, [x, seed]);

  // simulated tape: rolling p-tick history
  const tape = React.useMemo(() => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const xi = Math.max(2, Math.min(15, x + (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * 3)));
      const sim = PortentMath.simulate(deck, xi);
      out.push({ x: xi, p: sim.pFree, e: sim.eCards, t: `${pad((22 + i * 7) % 60)}` });
    }
    return out;
  }, [x, seed]);

  return (
    <div className="tx" style={{ width: 1440, minHeight: 1320, background: TerminalColors.bg, padding: '0', boxSizing: 'border-box', fontSize: 12 }}>
      {/* === STATUS BAR === */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', padding: '0 14px', borderBottom: `1px solid ${TerminalColors.rule}`, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: TerminalColors.dim, gap: 18 }}>
        <span><span className="tx-dot tx-flicker" style={{ background: TerminalColors.green, display: 'inline-block', marginRight: 6 }}></span>NET OK</span>
        <span>DECK-ORACLE://v2.4.1</span>
        <span>ENGINE: MC-3000</span>
        <span>SEED: 0x{(seed + 192837).toString(16).toUpperCase().padStart(6, '0')}</span>
        <span style={{ marginLeft: 'auto' }}>{utc} UTC</span>
        <span>FOLIO 01/01</span>
      </div>

      {/* === HEADER === */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 320px', alignItems: 'center', borderBottom: `1px solid ${TerminalColors.ruleHi}`, height: 64 }}>
        <div style={{ padding: '0 18px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.12em', color: TerminalColors.bright }}>DECK</span>
          <span style={{ fontSize: 22, fontWeight: 400, letterSpacing: '0.08em', color: TerminalColors.amber }}>ORACLE</span>
          <span className="tx-mute" style={{ fontSize: 9, marginLeft: 4 }}>◇ TERMINAL</span>
        </div>
        <div style={{ display: 'flex', borderLeft: `1px solid ${TerminalColors.rule}`, borderRight: `1px solid ${TerminalColors.rule}`, height: '100%' }}>
          {[['POR', 'Portent', true], ['WAV', 'Wave'], ['SUR', 'Surge'], ['VOR', 'Vortex'], ['RSH', 'Rashmi'], ['LMR', 'Lumra'], ['LND', 'Lands'], ['MUL', 'Mulligan'], ['MAR', 'Mara'], ['DRH', 'Dream Hvst']].map(([code, name, on]) => (
            <div key={code} className={`tx-tab ${on ? 'on' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700 }}>{code}</span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>{name}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 18px', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
          <span className="tx-pill">
            <span className="tx-dot" style={{ background: TerminalColors.green }}></span>
            DECK LOADED · N={total}
          </span>
          <span className="tx-mute" style={{ fontSize: 10 }}>0x4F2A</span>
        </div>
      </div>

      {/* === SUB BAR: deck input strip === */}
      <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12, borderBottom: `1px solid ${TerminalColors.rule}`, background: TerminalColors.panel }}>
        <span className="tx-mute" style={{ fontSize: 10, letterSpacing: '0.16em' }}>SRC&nbsp;»</span>
        <input className="tx-input" style={{ flex: '0 0 380px', padding: '5px 10px', fontSize: 11 }} defaultValue="moxfield.com/decks/3xQ-aetherveil-control" />
        <span className="tx-mute" style={{ fontSize: 10 }}>OR</span>
        <input className="tx-input" style={{ flex: '0 0 280px', padding: '5px 10px', fontSize: 11 }} defaultValue="paste decklist…" />
        <button className="tx-btn" style={{ padding: '5px 14px' }}>FETCH ↵</button>
        <span style={{ flex: 1 }}></span>
        <span className="tx-mute" style={{ fontSize: 10, letterSpacing: '0.10em' }}>LAST IMPORT 04:11:22Z · 99 cards · hash <span className="tx-amber">a9·b4·e2</span></span>
      </div>

      {/* === MAIN GRID === */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 320px', gap: 0 }}>
        {/* LEFT RAIL ── Inputs */}
        <div style={{ borderRight: `1px solid ${TerminalColors.rule}`, padding: 0 }}>
          <div className="tx-h"><span>01 · X PARAM</span><span className="tx-h-r">cards to reveal</span></div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 56, fontWeight: 700, color: TerminalColors.bright, lineHeight: 1, letterSpacing: '-0.02em' }}>{x}</span>
              <span className="tx-mute" style={{ fontSize: 11 }}>/ {total}</span>
              <span style={{ flex: 1 }}></span>
              <span className="tx-mid" style={{ fontSize: 10 }}>{((x / total) * 100).toFixed(1)}% of library</span>
            </div>
            <input className="tx-slider" type="range" min="1" max="20" step="1" value={x} onChange={(e) => setX(+e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: TerminalColors.dim }}>
              <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              {[5, 7, 9, 12, 15].map((v) => (
                <button key={v} className="tx-tab" style={{ borderRight: 0, border: `1px solid ${TerminalColors.rule}`, padding: '4px 10px', fontSize: 11, background: v === x ? TerminalColors.amber : 'transparent', color: v === x ? TerminalColors.bg : TerminalColors.mid }} onClick={() => setX(v)}>X={v}</button>
              ))}
            </div>
          </div>

          <div className="tx-h"><span>02 · LIBRARY</span><span className="tx-h-r">N={total}</span></div>
          <div style={{ padding: 16 }}>
            <TxDeckStrip deck={deck} total={total} />
          </div>

          <div className="tx-h"><span>03 · TRIGGER RULE</span><span className="tx-h-r">{'>=4 types'}</span></div>
          <div style={{ padding: 16, fontSize: 11, color: TerminalColors.mid, lineHeight: 1.55 }}>
            <div style={{ marginBottom: 8 }}>If reveal contains <span className="tx-amber">≥4 distinct types</span>, all X cards go to hand.</div>
            <div className="tx-mute" style={{ fontSize: 10 }}>Method: hypergeometric · Monte Carlo 3,000 trials · seed-stable.</div>
          </div>
        </div>

        {/* CENTER ── Hero readout + chart */}
        <div style={{ padding: 0 }}>
          {/* Hero numerics */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${TerminalColors.rule}` }}>
            <Stat label="P(FREE SPELL)" value={pct(cur.pFree, 2) + '%'} sub={`x=${x}`} accent={TerminalColors.green} big />
            <Stat label="E[CARDS TO HAND]" value={fix(cur.eCards, 2)} sub={`x · p(free)`} accent={TerminalColors.amber} big />
            <Stat label="EXPECTED LOSS" value={'¢' + fix(9 - cur.eCards, 2) + 'M'} sub={`9 mana · breakeven`} accent={TerminalColors.red} big />
          </div>

          {/* Chart */}
          <div>
            <div className="tx-h"><span>04 · KERNEL · P(FREE) AND E[CARDS] vs X</span>
              <span className="tx-h-r"><span className="tx-green">●</span> P(FREE) &nbsp; <span className="tx-amber">▮</span> E[CARDS] &nbsp; <span style={{ color: TerminalColors.dim }}>·</span> cursor x={x}</span>
            </div>
            <div style={{ padding: '14px 18px 4px', position: 'relative' }}>
              <TxChart table={table} xValue={x} height={280} />
              {/* Y axis labels (left) — P% */}
              <div style={{ position: 'absolute', top: 14, left: 0, height: 280, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 9, color: TerminalColors.dim, padding: '0 4px' }}>
                <span>100</span><span>75</span><span>50</span><span>25</span><span>0</span>
              </div>
              {/* Y axis labels (right) — E */}
              <div style={{ position: 'absolute', top: 14, right: 0, height: 280, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 9, color: TerminalColors.amber, padding: '0 4px', textAlign: 'right' }}>
                <span>20</span><span>15</span><span>10</span><span>5</span><span>0</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 28px 14px', fontSize: 9, color: TerminalColors.dim }}>
              {table.filter((_, i) => i % 2 === 0).map((r) => <span key={r.x}>{r.x}</span>)}
            </div>
          </div>

          {/* X sweep table */}
          <div>
            <div className="tx-h"><span>05 · X SWEEP · STEP RESPONSE</span><span className="tx-h-r">columns: P(FREE), E[CARDS], Δ vs prev</span></div>
            <div style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ color: TerminalColors.dim, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {['x', 'p(free)', 'p bar', 'E[cards]', 'Δp', 'verdict'].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 2 ? 'left' : 'right', padding: '8px 14px', borderBottom: `1px solid ${TerminalColors.rule}`, fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.slice(2, 16).map((r, i, arr) => {
                    const prev = i > 0 ? arr[i - 1].pFree : 0;
                    const dp = r.pFree - prev;
                    const verdict = r.pFree < 0.4 ? 'WEAK' : r.pFree < 0.7 ? 'FAIR' : r.pFree < 0.9 ? 'STRONG' : 'CERTAIN';
                    const vc = verdict === 'WEAK' ? TerminalColors.red : verdict === 'FAIR' ? TerminalColors.amber : TerminalColors.green;
                    const hi = r.x === x;
                    return (
                      <tr key={r.x} style={{ background: hi ? '#161e1a' : 'transparent', color: hi ? TerminalColors.bright : TerminalColors.text, cursor: 'pointer' }} onClick={() => setX(r.x)}>
                        <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: hi ? 700 : 400 }}>{hi && <span className="tx-amber" style={{ marginRight: 6 }}>▸</span>}{r.x}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'right' }}>{pct(r.pFree, 2)}%</td>
                        <td style={{ padding: '6px 14px', width: 240 }}>
                          <div style={{ height: 8, background: TerminalColors.bg, border: `1px solid ${TerminalColors.rule}` }}>
                            <div style={{ height: '100%', width: `${r.pFree * 100}%`, background: TerminalColors.green, opacity: hi ? 1 : 0.7 }}></div>
                          </div>
                        </td>
                        <td style={{ padding: '6px 14px', textAlign: 'right' }} className="tx-amber">{fix(r.eCards, 2)}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'right', color: dp > 0.05 ? TerminalColors.green : TerminalColors.dim }}>+{pct(dp, 1)}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'right', color: vc, fontSize: 10, letterSpacing: '0.12em' }}>{verdict}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT RAIL ── Sample reveal tape + live ticks */}
        <div style={{ borderLeft: `1px solid ${TerminalColors.rule}` }}>
          <div className="tx-h">
            <span>06 · SAMPLE REVEAL · X={x}</span>
            <span className="tx-h-r" style={{ cursor: 'pointer' }} onClick={() => setSeed((s) => s + 1)}>[ ↻ RESHUFFLE ]</span>
          </div>
          {reveals.map((rev, i) => (
            <div key={i} style={{ padding: '12px 16px', borderBottom: `1px solid ${TerminalColors.rule}`, fontSize: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                <span className="tx-mute" style={{ fontSize: 9 }}>TRIAL {pad(i + 1, 3)}</span>
                <span style={{ flex: 1 }}></span>
                <span style={{ fontSize: 9, color: TerminalColors.dim }}>DIST</span>
                <span className="tx-bright" style={{ color: rev.distinctTypes >= 4 ? TerminalColors.green : TerminalColors.red }}>{rev.distinctTypes}</span>
                <span style={{ fontSize: 9, color: rev.free ? TerminalColors.green : TerminalColors.red, letterSpacing: '0.10em' }}>{rev.free ? 'FREE ✓' : 'FIZZ ✗'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {rev.reveal.map((c, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                    <span style={{ width: 8, height: 8, background: TYPE_COLOR[c.type], flex: '0 0 8px' }}></span>
                    <span className="tx-mute" style={{ fontSize: 9, width: 26 }}>{TYPE_CODE[c.type]}</span>
                    <span style={{ flex: 1, color: TerminalColors.text, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="tx-h"><span>07 · LIVE TAPE</span><span className="tx-h-r">P-tick</span></div>
          <div style={{ fontSize: 10, fontFamily: 'inherit' }}>
            {tape.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 40px 1fr 60px', alignItems: 'center', padding: '4px 16px', borderBottom: `1px solid ${TerminalColors.rule}` }}>
                <span className="tx-mute" style={{ fontSize: 9 }}>·{t.t}</span>
                <span style={{ color: TerminalColors.bright }}>x={t.x}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ height: 4, background: TerminalColors.bg, flex: 1 }}>
                    <div style={{ height: '100%', width: `${t.p * 100}%`, background: TerminalColors.green }}></div>
                  </div>
                </div>
                <span style={{ textAlign: 'right', color: TerminalColors.green }}>{pct(t.p, 1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === FOOTER STATUS === */}
      <div style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 14px', borderTop: `1px solid ${TerminalColors.rule}`, fontSize: 9, letterSpacing: '0.12em', color: TerminalColors.dim, gap: 18, textTransform: 'uppercase' }}>
        <span>↑↓ SELECT X</span>
        <span>R RESHUFFLE</span>
        <span>F FETCH DECK</span>
        <span>/ SEARCH CALC</span>
        <span style={{ marginLeft: 'auto' }}>BUILD 2.4.1 · {new Date().toISOString().slice(0, 10)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent, big }) {
  return (
    <div style={{ padding: '20px 24px', borderRight: `1px solid ${TerminalColors.rule}` }}>
      <div style={{ fontSize: 10, letterSpacing: '0.16em', color: TerminalColors.dim, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: big ? 56 : 32, fontWeight: 600, color: accent, letterSpacing: '-0.02em', lineHeight: 1, fontFeatureSettings: "'tnum' 1" }}>{value}</div>
      <div style={{ fontSize: 10, color: TerminalColors.mid, marginTop: 8, letterSpacing: '0.08em' }}>{sub}</div>
    </div>
  );
}

// === MOBILE ARTBOARD ===
function TerminalMobile() {
  const deck = PortentMath.DEFAULT_DECK;
  const total = Object.values(deck).reduce((a, b) => a + b, 0);
  const [x, setX] = React.useState(7);
  const table = React.useMemo(() => PortentMath.table(deck, 1, 20), []);
  const cur = React.useMemo(() => PortentMath.simulate(deck, x), [x]);
  const [seed, setSeed] = React.useState(0);
  const reveals = React.useMemo(() => Array.from({ length: 2 }, () => PortentMath.sampleReveal(deck, x)), [x, seed]);
  const utc = useClock();

  return (
    <div className="tx" style={{ width: 412, minHeight: 1080, background: TerminalColors.bg, fontSize: 12 }}>
      <div style={{ height: 24, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${TerminalColors.rule}`, fontSize: 9, letterSpacing: '0.10em', color: TerminalColors.dim, gap: 10, textTransform: 'uppercase' }}>
        <span className="tx-flicker"><span className="tx-dot" style={{ background: TerminalColors.green, display: 'inline-block', marginRight: 4 }}></span>OK</span>
        <span>DECK.ORACLE</span>
        <span style={{ marginLeft: 'auto' }}>{utc}</span>
      </div>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${TerminalColors.rule}`, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.10em', color: TerminalColors.bright }}>DECK</span>
        <span style={{ fontSize: 18, color: TerminalColors.amber, letterSpacing: '0.06em' }}>ORACLE</span>
        <span style={{ flex: 1 }}></span>
        <span className="tx-pill" style={{ fontSize: 9 }}><span className="tx-dot" style={{ background: TerminalColors.green }}></span>N={total}</span>
      </div>
      <div style={{ display: 'flex', overflowX: 'auto', borderBottom: `1px solid ${TerminalColors.rule}` }}>
        {[['POR', true], ['WAV'], ['SUR'], ['VOR'], ['RSH'], ['LMR'], ['LND'], ['MUL']].map(([c, on]) => (
          <div key={c} className={`tx-tab ${on ? 'on' : ''}`} style={{ padding: '8px 12px', fontSize: 10 }}>{c}</div>
        ))}
      </div>

      <div style={{ padding: '16px 14px', borderBottom: `1px solid ${TerminalColors.rule}` }}>
        <div className="tx-mute" style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>X PARAM · cards revealed</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 48, fontWeight: 700, color: TerminalColors.bright, lineHeight: 1, letterSpacing: '-0.02em' }}>{x}</span>
          <span className="tx-mute" style={{ fontSize: 10 }}>/ {total}</span>
        </div>
        <input className="tx-slider" type="range" min="1" max="20" step="1" value={x} onChange={(e) => setX(+e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${TerminalColors.rule}` }}>
        <Stat label="P(FREE)" value={pct(cur.pFree, 1) + '%'} sub={`x=${x}`} accent={TerminalColors.green} />
        <Stat label="E[CARDS]" value={fix(cur.eCards, 2)} sub="" accent={TerminalColors.amber} />
      </div>

      <div className="tx-h"><span>KERNEL</span><span className="tx-h-r">P(FREE) vs X</span></div>
      <div style={{ padding: '10px 12px' }}>
        <TxChart table={table} xValue={x} height={180} />
      </div>

      <div className="tx-h"><span>SAMPLE REVEAL</span><span className="tx-h-r" onClick={() => setSeed((s) => s + 1)} style={{ cursor: 'pointer' }}>[ ↻ ]</span></div>
      {reveals.map((rev, i) => (
        <div key={i} style={{ padding: '10px 14px', borderBottom: `1px solid ${TerminalColors.rule}`, fontSize: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 8 }}>
            <span className="tx-mute" style={{ fontSize: 9 }}>TRIAL {pad(i + 1, 2)}</span>
            <span style={{ flex: 1 }}></span>
            <span style={{ color: TerminalColors.dim }}>DIST</span>
            <span style={{ color: rev.distinctTypes >= 4 ? TerminalColors.green : TerminalColors.red, fontWeight: 700 }}>{rev.distinctTypes}</span>
            <span style={{ fontSize: 9, color: rev.free ? TerminalColors.green : TerminalColors.red, letterSpacing: '0.10em' }}>{rev.free ? 'FREE ✓' : 'FIZZ ✗'}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {rev.reveal.map((c, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', border: `1px solid ${TerminalColors.rule}`, background: TerminalColors.panel, fontSize: 9 }}>
                <span style={{ width: 6, height: 6, background: TYPE_COLOR[c.type] }}></span>
                <span style={{ color: TerminalColors.text }}>{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { TerminalView, TerminalMobile });
