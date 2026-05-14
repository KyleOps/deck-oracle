// GRIMOIRE — printed-book / compendium direction.
// Cream parchment, fine serif, marginalia, ruled tables with dotted leaders,
// chart engraved as a "plate". Game-neutral throughout.

const GrimoireColors = {
  paper:   '#f0e4c8',
  paperHi: '#f7eed5',
  paperLo: '#e3d4b2',
  ink:     '#1a140d',
  ink2:    '#3c2f1d',
  inkDim:  '#7a6442',
  rule:    'rgba(26,20,13,0.22)',
  ruleHi:  'rgba(26,20,13,0.55)',
  red:     '#8a1d1a',
  redDim:  '#a8492a',
  gold:    '#a07e22',
};

const gcss = `
.gx { font-family: 'EB Garamond', 'Cormorant Garamond', 'Hoefler Text', Garamond, serif; color: ${GrimoireColors.ink}; font-feature-settings: 'liga' 1, 'kern' 1, 'onum' 1; }
.gx-disp { font-family: 'EB Garamond', 'Cormorant Garamond', serif; font-weight: 500; letter-spacing: 0.02em; }
.gx-sc { font-variant-caps: all-small-caps; letter-spacing: 0.18em; font-weight: 500; }
.gx-italic { font-style: italic; }
.gx-lining { font-feature-settings: 'lnum' 1, 'tnum' 1; }
.gx-rule { border: 0; border-top: 0.5px solid ${GrimoireColors.ruleHi}; margin: 0; }
.gx-rule-d { border: 0; border-top: 0.5px dashed ${GrimoireColors.rule}; }
.gx-rule-hair { border: 0; border-top: 0.5px solid ${GrimoireColors.rule}; }
.gx-double { border-top: 0.5px solid ${GrimoireColors.ruleHi}; border-bottom: 0.5px solid ${GrimoireColors.ruleHi}; height: 4px; }
.gx-drop { float: left; font-size: 4.6em; line-height: 0.82; padding: 0.08em 0.08em 0 0; font-weight: 500; color: ${GrimoireColors.red}; font-family: inherit; }
.gx-leader { display: flex; align-items: baseline; }
.gx-leader > span:first-child { flex: 0 0 auto; padding-right: 6px; }
.gx-leader > span:last-child { flex: 0 0 auto; padding-left: 6px; }
.gx-leader > .gx-leader-dots { flex: 1 1 auto; border-bottom: 1px dotted ${GrimoireColors.ruleHi}; margin: 0 0 4px 0; transform: translateY(-4px); }
.gx-folio-num { font-feature-settings: 'lnum' 1, 'tnum' 1; font-variant-numeric: oldstyle-nums; }
.gx-marg { color: ${GrimoireColors.ink2}; font-size: 12px; line-height: 1.55; font-style: italic; }
.gx-marg b { font-style: normal; font-variant-caps: all-small-caps; letter-spacing: 0.18em; color: ${GrimoireColors.red}; font-size: 11px; display: block; margin-bottom: 4px; }
.gx-num-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; border: 0.5px solid ${GrimoireColors.rule}; padding: 0 6px; cursor: pointer; font-feature-settings: 'lnum' 1; transition: background .12s; }
.gx-num-chip:hover { background: ${GrimoireColors.paperHi}; }
.gx-num-chip.on { background: ${GrimoireColors.ink}; color: ${GrimoireColors.paper}; border-color: ${GrimoireColors.ink}; }
.gx-ornament { color: ${GrimoireColors.gold}; letter-spacing: 0.5em; text-align: center; font-size: 18px; }
.gx-input { background: transparent; border: 0; border-bottom: 0.5px solid ${GrimoireColors.ruleHi}; padding: 4px 0; font-family: inherit; font-size: 15px; color: ${GrimoireColors.ink}; outline: none; width: 100%; }
.gx-input:focus { border-bottom-color: ${GrimoireColors.red}; }
.gx-btn { background: ${GrimoireColors.ink}; color: ${GrimoireColors.paper}; padding: 8px 16px; border: 0; font-family: inherit; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; font-variant-caps: all-small-caps; font-weight: 500; }
.gx-btn:hover { background: ${GrimoireColors.red}; }
.gx-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 1px; background: ${GrimoireColors.ruleHi}; outline: none; }
.gx-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 6px; height: 18px; background: ${GrimoireColors.red}; cursor: ew-resize; border-radius: 0; border: 0; }
.gx-slider::-moz-range-thumb { width: 6px; height: 18px; background: ${GrimoireColors.red}; cursor: ew-resize; border-radius: 0; border: 0; }
.gx-stamp { display: inline-block; border: 1.5px solid ${GrimoireColors.red}; padding: 4px 10px; color: ${GrimoireColors.red}; font-variant-caps: all-small-caps; letter-spacing: 0.18em; transform: rotate(-2deg); font-size: 11px; }
`;
if (typeof document !== 'undefined' && !document.getElementById('gx-style')) {
  const s = document.createElement('style'); s.id = 'gx-style'; s.textContent = gcss; document.head.appendChild(s);
}

const GTYPE_GLYPH = {
  Creature: '◆', Instant: '✦', Sorcery: '✺', Artifact: '◇',
  Enchantment: '✧', Planeswalker: '✱', Land: '◼', Battle: '※',
};

// Roman numerals helper, capped at XL (40)
function roman(n) {
  if (n < 1) return '';
  const map = [['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
  let r = '', x = n;
  for (const [s, v] of map) { while (x >= v) { r += s; x -= v; } }
  return r;
}

// Engraved-plate chart
function GxChart({ table, xValue, width = 760, height = 320 }) {
  const padL = 50, padR = 36, padT = 24, padB = 40;
  const W = width - padL - padR, H = height - padT - padB;
  const xs = table.map((r) => r.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xMap = (x) => padL + ((x - xMin) / (xMax - xMin)) * W;
  const yMap = (p) => padT + (1 - p) * H;
  const eMax = Math.max(...table.map((r) => r.eCards), 1);

  // Build smooth-ish polyline
  const pPts = table.map((r) => [xMap(r.x), yMap(r.pFree)]);
  const ePts = table.map((r) => [xMap(r.x), yMap(r.eCards / eMax)]);
  const pPath = `M ${pPts.map((p) => p.join(',')).join(' L ')}`;
  const ePath = `M ${ePts.map((p) => p.join(',')).join(' L ')}`;
  // Area under p curve, for hatching clip
  const areaPath = `${pPath} L ${xMap(xMax)},${padT + H} L ${xMap(xMin)},${padT + H} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <pattern id="gx-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={GrimoireColors.ink} strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <clipPath id="gx-clip"><path d={areaPath} /></clipPath>
      </defs>

      {/* Plate border */}
      <rect x={padL} y={padT} width={W} height={H} fill="none" stroke={GrimoireColors.ink} strokeWidth="0.6" />

      {/* Horizontal grid (dotted, sparse) */}
      {[0.25, 0.5, 0.75].map((p) => (
        <line key={p} x1={padL} y1={yMap(p)} x2={padL + W} y2={yMap(p)} stroke={GrimoireColors.ink} strokeWidth="0.3" strokeDasharray="1 4" opacity="0.5" />
      ))}

      {/* Hatched area under P curve */}
      <rect x={padL} y={padT} width={W} height={H} fill="url(#gx-hatch)" clipPath="url(#gx-clip)" />

      {/* P(free) ink curve */}
      <path d={pPath} fill="none" stroke={GrimoireColors.ink} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* E[cards] curve — red ink, dashed */}
      <path d={ePath} fill="none" stroke={GrimoireColors.red} strokeWidth="1.0" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />

      {/* Points: P curve as filled diamonds */}
      {pPts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="2.4" fill={GrimoireColors.paper} stroke={GrimoireColors.ink} strokeWidth="0.8" />
        </g>
      ))}

      {/* Current X marker */}
      <line x1={xMap(xValue)} y1={padT} x2={xMap(xValue)} y2={padT + H} stroke={GrimoireColors.red} strokeWidth="0.6" />
      <circle cx={xMap(xValue)} cy={yMap(table.find((r) => r.x === xValue)?.pFree ?? 0)} r="5" fill={GrimoireColors.red} />

      {/* Y-axis ticks (left, P%) */}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={padL - 4} y1={yMap(p)} x2={padL} y2={yMap(p)} stroke={GrimoireColors.ink} strokeWidth="0.6" />
          <text x={padL - 8} y={yMap(p) + 4} fontSize="11" textAnchor="end" fill={GrimoireColors.ink} fontFamily="EB Garamond, serif" fontStyle="italic">{Math.round(p * 100)}</text>
        </g>
      ))}
      {/* Y-axis right E[cards] */}
      {[0, 0.5, 1].map((p) => (
        <g key={p}>
          <line x1={padL + W} y1={yMap(p)} x2={padL + W + 4} y2={yMap(p)} stroke={GrimoireColors.red} strokeWidth="0.6" />
          <text x={padL + W + 8} y={yMap(p) + 4} fontSize="11" fill={GrimoireColors.red} fontFamily="EB Garamond, serif" fontStyle="italic">{(p * eMax).toFixed(0)}</text>
        </g>
      ))}
      {/* X-axis labels */}
      {table.map((r) => (
        <g key={r.x}>
          <line x1={xMap(r.x)} y1={padT + H} x2={xMap(r.x)} y2={padT + H + 3} stroke={GrimoireColors.ink} strokeWidth="0.4" />
          {r.x % 2 === 1 && <text x={xMap(r.x)} y={padT + H + 16} fontSize="11" textAnchor="middle" fill={GrimoireColors.ink} fontFamily="EB Garamond, serif">{r.x}</text>}
        </g>
      ))}
      {/* Axis titles */}
      <text x={padL - 38} y={padT + H / 2} fontSize="11" fill={GrimoireColors.ink} fontFamily="EB Garamond, serif" fontStyle="italic" transform={`rotate(-90, ${padL - 38}, ${padT + H / 2})`} textAnchor="middle">probability — per cent.</text>
      <text x={padL + W + 36} y={padT + H / 2} fontSize="11" fill={GrimoireColors.red} fontFamily="EB Garamond, serif" fontStyle="italic" transform={`rotate(90, ${padL + W + 36}, ${padT + H / 2})`} textAnchor="middle">expected cards</text>
      <text x={padL + W / 2} y={padT + H + 32} fontSize="11" fill={GrimoireColors.ink} fontFamily="EB Garamond, serif" fontStyle="italic" textAnchor="middle">X · the number of cards uncovered</text>
    </svg>
  );
}

function GxLeader({ left, right, dotted = true }) {
  return (
    <div className="gx-leader" style={{ fontSize: 14, marginBottom: 6 }}>
      <span>{left}</span>
      <span className={dotted ? 'gx-leader-dots' : ''} style={!dotted ? { flex: 1 } : {}}></span>
      <span className="gx-lining" style={{ fontWeight: 500 }}>{right}</span>
    </div>
  );
}

// === DESKTOP ARTBOARD ===
function GrimoireView() {
  const deck = PortentMath.DEFAULT_DECK;
  const total = Object.values(deck).reduce((a, b) => a + b, 0);
  const [x, setX] = React.useState(7);
  const table = React.useMemo(() => PortentMath.table(deck, 1, 20), []);
  const cur = React.useMemo(() => PortentMath.simulate(deck, x), [x]);
  const [seed, setSeed] = React.useState(0);
  const reveals = React.useMemo(() => Array.from({ length: 3 }, () => PortentMath.sampleReveal(deck, x)), [x, seed]);

  return (
    <div className="gx" style={{ width: 1280, minHeight: 2300, background: GrimoireColors.paper, padding: 0, position: 'relative', overflow: 'hidden', boxSizing: 'border-box' }}>
      {/* Subtle paper texture */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `radial-gradient(${GrimoireColors.paperLo} 1px, transparent 1px), radial-gradient(${GrimoireColors.paperHi} 1px, transparent 1px)`, backgroundSize: '13px 13px, 7px 7px', backgroundPosition: '0 0, 4px 6px', opacity: 0.5 }}></div>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse at 30% 10%, transparent 40%, rgba(80,50,20,0.06) 100%)` }}></div>

      <div style={{ position: 'relative', padding: '40px 80px 60px' }}>
        {/* === FOLIO HEADER === */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'baseline', marginBottom: 6 }}>
          <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.ink2 }}>Deck Oracle</div>
          <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.ink2 }}>A Compendium of Probabilities for the Builder of Decks</div>
          <div className="gx-sc gx-folio-num" style={{ fontSize: 11, color: GrimoireColors.ink2, textAlign: 'right' }}>Folio · XII</div>
        </div>
        <hr className="gx-rule" />
        <hr className="gx-rule-hair" style={{ marginTop: 2 }} />

        {/* === Calculator Navigation === */}
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 4, padding: '14px 0', marginBottom: 8 }}>
          {[
            ['I', 'Portent', true], ['II', 'Wave'], ['III', 'Surge'], ['IV', 'Vow'], ['V', 'Vortex'],
            ['VI', 'Rashmi'], ['VII', 'Lumra'], ['VIII', 'Lands'], ['IX', 'Mulligan'], ['X', 'Mara'], ['XI', 'Dream Harvest'],
          ].map(([num, name, on]) => (
            <div key={num} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '3px 12px', borderRight: `0.5px solid ${GrimoireColors.rule}`, cursor: 'pointer', color: on ? GrimoireColors.red : GrimoireColors.ink2 }}>
              <span className="gx-sc" style={{ fontSize: 10 }}>{num}</span>
              <span style={{ fontSize: 14, fontStyle: on ? 'italic' : 'normal', textDecoration: on ? 'underline' : 'none', textUnderlineOffset: 4 }}>{name}</span>
            </div>
          ))}
        </div>

        {/* === DECK INPUT === */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, padding: '10px 0 24px', borderTop: `0.5px solid ${GrimoireColors.rule}`, borderBottom: `0.5px solid ${GrimoireColors.rule}` }}>
          <div>
            <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red, marginBottom: 8 }}>§ The Catalogue</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="gx-italic" style={{ fontSize: 13, color: GrimoireColors.ink2, flex: '0 0 auto' }}>from URL —</span>
              <input className="gx-input" defaultValue="moxfield.com / archidekt / decks of any kind" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <span className="gx-italic" style={{ fontSize: 13, color: GrimoireColors.ink2, flex: '0 0 auto' }}>or transcribed —</span>
              <input className="gx-input" defaultValue="paste a decklist plainly written…" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <button className="gx-btn">Inscribe ▸</button>
              <span className="gx-italic gx-folio-num" style={{ fontSize: 12, color: GrimoireColors.ink2 }}>Last received MMXXVI · v · xiv — <span className="gx-sc" style={{ fontSize: 10 }}>Aetherveil Control</span> · {total} cards</span>
            </div>
          </div>
          <div>
            <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red, marginBottom: 8 }}>§ Of the Forms therein</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 24px' }}>
              {PortentMath.TYPES.filter((t) => deck[t] > 0).map((t) => (
                <GxLeader key={t} left={<><span style={{ color: GrimoireColors.gold, marginRight: 6 }}>{GTYPE_GLYPH[t]}</span>{t}{deck[t] !== 1 ? 's' : ''}</>} right={deck[t]} />
              ))}
            </div>
          </div>
        </div>

        <div className="gx-ornament" style={{ margin: '36px 0 18px' }}>❦ &nbsp; ⁂ &nbsp; ❦</div>

        {/* === TITLE === */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div className="gx-sc" style={{ fontSize: 13, color: GrimoireColors.red, marginBottom: 12 }}>§ I · The First Working</div>
          <h1 className="gx-disp" style={{ fontSize: 76, margin: 0, fontWeight: 500, letterSpacing: '0.01em', color: GrimoireColors.ink }}>
            On the <span className="gx-italic" style={{ fontWeight: 400 }}>Calamitous Portent</span>
          </h1>
          <div className="gx-italic" style={{ fontSize: 19, color: GrimoireColors.ink2, marginTop: 12, fontWeight: 400 }}>Being the chance of a Free Working, when X cards are uncovered &amp; <span className="gx-sc" style={{ fontSize: 13 }}>four distinct Forms</span> appear among them.</div>
          <div style={{ marginTop: 22, fontSize: 13, color: GrimoireColors.inkDim }}>—— set by hand · <span className="gx-folio-num">N = {total}</span> · trials, three thousand ——</div>
        </div>

        {/* === MAIN BODY GRID: marginalia | content | marginalia === */}
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 200px', gap: 32, marginTop: 24 }}>
          {/* LEFT MARGIN */}
          <div style={{ paddingTop: 8 }}>
            <div className="gx-marg">
              <b>Note · a</b>
              The <span style={{ fontStyle: 'normal', fontVariantCaps: 'all-small-caps', letterSpacing: '0.16em' }}>portent</span> succeeds when at least four <em>distinct</em> forms appear in the reveal. A library balanced across many forms answers better than one of monastic discipline.
            </div>
            <hr className="gx-rule-d" style={{ margin: '20px 0' }} />
            <div className="gx-marg">
              <b>Note · b</b>
              Of nine mana paid, expect to recover the working only when <span className="gx-italic">p</span> &gt; 0.55. Below this, the price exceeds the prize.
            </div>
            <hr className="gx-rule-d" style={{ margin: '20px 0' }} />
            <div className="gx-marg">
              <b>Method</b>
              By <em>Monte-Carlo</em> simulation: the library is set anew three thousand times, X uncovered, and the forms therein counted. The cited figures are observed, not derived.
            </div>
          </div>

          {/* CENTER COLUMN */}
          <div>
            <p style={{ fontSize: 17, lineHeight: 1.65, margin: 0, color: GrimoireColors.ink, textAlign: 'justify', textIndent: 0 }}>
              <span className="gx-drop">U</span>pon the uttering of the Portent, the diviner uncovers <span className="gx-italic">X</span> cards from atop the library. Should four or more distinct forms appear among the cards so uncovered, the working is cast for no mana, and the cards are gathered into the hand of the diviner. If less, the cards remain, and the labour is spent.
            </p>

            {/* X SETTER */}
            <div style={{ margin: '28px 0', padding: '18px 22px', border: `0.5px solid ${GrimoireColors.ruleHi}`, background: GrimoireColors.paperHi }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 14 }}>
                <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red }}>Let X be</div>
                <div className="gx-disp gx-folio-num" style={{ fontSize: 64, lineHeight: 1, color: GrimoireColors.ink }}>{x}</div>
                <span className="gx-italic" style={{ fontSize: 14, color: GrimoireColors.ink2 }}>cards · being {roman(x)} of {total}</span>
                <span style={{ flex: 1 }}></span>
                <span className="gx-italic gx-folio-num" style={{ fontSize: 13, color: GrimoireColors.inkDim }}>{((x / total) * 100).toFixed(1)}% of the catalogue</span>
              </div>
              <input className="gx-slider" type="range" min="1" max="20" step="1" value={x} onChange={(e) => setX(+e.target.value)} />
              <div style={{ display: 'flex', gap: 4, marginTop: 12, flexWrap: 'wrap' }}>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <span key={n} className={`gx-num-chip gx-folio-num ${n === x ? 'on' : ''}`} onClick={() => setX(n)} style={{ fontSize: 13 }}>{n}</span>
                ))}
              </div>
            </div>

            {/* HERO FIGURES */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, padding: '20px 0', borderTop: `0.5px solid ${GrimoireColors.ruleHi}`, borderBottom: `0.5px solid ${GrimoireColors.ruleHi}` }}>
              <div>
                <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red, marginBottom: 8 }}>I · The Chance of Triumph</div>
                <div className="gx-disp gx-folio-num" style={{ fontSize: 92, lineHeight: 1, color: GrimoireColors.ink, letterSpacing: '-0.02em' }}>
                  {(cur.pFree * 100).toFixed(1)}<span style={{ fontSize: 36, color: GrimoireColors.ink2 }}>%</span>
                </div>
                <div className="gx-italic" style={{ fontSize: 15, color: GrimoireColors.ink2, marginTop: 10 }}>
                  or roughly <span className="gx-folio-num">{Math.round(cur.pFree * 16)}</span> in <span className="gx-folio-num">16</span> uncoverings.
                </div>
              </div>
              <div>
                <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red, marginBottom: 8 }}>II · The Expected Yield</div>
                <div className="gx-disp gx-folio-num" style={{ fontSize: 92, lineHeight: 1, color: GrimoireColors.ink, letterSpacing: '-0.02em' }}>
                  {cur.eCards.toFixed(2)}<span style={{ fontSize: 36, color: GrimoireColors.ink2 }}> cards</span>
                </div>
                <div className="gx-italic" style={{ fontSize: 15, color: GrimoireColors.ink2, marginTop: 10 }}>
                  drawn into the hand, on the average; against <span className="gx-folio-num">9</span> mana paid.
                </div>
              </div>
            </div>

            {/* PLATE I — CHART */}
            <figure style={{ margin: '40px 0 12px', padding: 0 }}>
              <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red, textAlign: 'center', marginBottom: 4 }}>Plate I</div>
              <div className="gx-italic" style={{ fontSize: 14, color: GrimoireColors.ink2, textAlign: 'center', marginBottom: 16 }}>The Curve of Probability, with the Yield in Red, against the Value of X.</div>
              <GxChart table={table} xValue={x} width={760} height={320} />
              <figcaption className="gx-italic" style={{ fontSize: 12, color: GrimoireColors.inkDim, textAlign: 'center', marginTop: 14 }}>
                — engraved from {Object.values(deck).reduce((a, b) => a + b, 0)} cards in three thousand workings —
              </figcaption>
            </figure>
          </div>

          {/* RIGHT MARGIN: Sample reveals + small notes */}
          <div style={{ paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
              <span className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red }}>Visions</span>
              <span className="gx-italic" style={{ fontSize: 12, color: GrimoireColors.inkDim }}>three foreseen</span>
              <span style={{ flex: 1 }}></span>
              <span className="gx-sc" style={{ fontSize: 10, color: GrimoireColors.ink2, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => setSeed((s) => s + 1)}>↻ Re-cast</span>
            </div>
            {reveals.map((rev, i) => (
              <div key={i} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <span className="gx-sc gx-folio-num" style={{ fontSize: 10, color: GrimoireColors.ink2 }}>vision {roman(i + 1)}</span>
                  <span style={{ flex: 1, borderBottom: `0.5px dotted ${GrimoireColors.rule}`, marginBottom: 4 }}></span>
                  <span className="gx-italic gx-folio-num" style={{ fontSize: 12, color: rev.free ? GrimoireColors.ink : GrimoireColors.red }}>
                    {rev.distinctTypes} of 8 forms
                  </span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: GrimoireColors.ink, fontStyle: 'italic' }}>
                  {rev.reveal.slice(0, 6).map((c, j) => (
                    <span key={j}>
                      <span style={{ color: GrimoireColors.gold, fontStyle: 'normal' }}>{GTYPE_GLYPH[c.type]}</span>
                      {' '}{c.name}{j < Math.min(rev.reveal.length, 6) - 1 ? ', ' : ''}
                    </span>
                  ))}
                  {rev.reveal.length > 6 && <span className="gx-italic">, &amp; {rev.reveal.length - 6} more.</span>}
                </div>
                <div className="gx-sc" style={{ fontSize: 10, color: rev.free ? GrimoireColors.ink : GrimoireColors.red, marginTop: 6, textAlign: 'right' }}>
                  {rev.free ? '✓ the working triumphs' : '✗ the working fails'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="gx-ornament" style={{ margin: '40px 0 28px' }}>⁂</div>

        {/* === TABLE OF VALUES === */}
        <div style={{ marginTop: 12 }}>
          <div className="gx-sc" style={{ fontSize: 12, color: GrimoireColors.red, marginBottom: 4 }}>§ II · The Table of Values</div>
          <h2 className="gx-disp" style={{ fontSize: 32, margin: '0 0 8px', fontWeight: 500 }}>An <span className="gx-italic">Index</span> of all Uncoverings, with their Chances and Yields.</h2>
          <hr className="gx-rule" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, marginTop: 18 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">X</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">Probability</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">Yield</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">Verdict</th>
                </tr>
              </thead>
              <tbody className="gx-folio-num">
                {table.slice(2, 11).map((r) => {
                  const verdict = r.pFree < 0.4 ? 'thin' : r.pFree < 0.7 ? 'fair' : r.pFree < 0.9 ? 'sound' : 'certain';
                  const vc = verdict === 'thin' ? GrimoireColors.red : verdict === 'certain' ? GrimoireColors.ink : GrimoireColors.ink2;
                  const hi = r.x === x;
                  return (
                    <tr key={r.x} onClick={() => setX(r.x)} style={{ cursor: 'pointer', background: hi ? GrimoireColors.paperHi : 'transparent', color: hi ? GrimoireColors.ink : GrimoireColors.ink2 }}>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}` }}>{hi && <span style={{ color: GrimoireColors.red, marginRight: 4 }}>›</span>}{r.x} · {roman(r.x)}</td>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}`, textAlign: 'right' }}>{(r.pFree * 100).toFixed(1)}%</td>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}`, textAlign: 'right' }}>{r.eCards.toFixed(2)}</td>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}`, textAlign: 'right', color: vc, fontStyle: 'italic' }}>{verdict}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">X</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">Probability</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">Yield</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: `1px solid ${GrimoireColors.ruleHi}`, fontWeight: 500 }} className="gx-sc">Verdict</th>
                </tr>
              </thead>
              <tbody className="gx-folio-num">
                {table.slice(11, 20).map((r) => {
                  const verdict = r.pFree < 0.4 ? 'thin' : r.pFree < 0.7 ? 'fair' : r.pFree < 0.9 ? 'sound' : 'certain';
                  const vc = verdict === 'thin' ? GrimoireColors.red : verdict === 'certain' ? GrimoireColors.ink : GrimoireColors.ink2;
                  const hi = r.x === x;
                  return (
                    <tr key={r.x} onClick={() => setX(r.x)} style={{ cursor: 'pointer', background: hi ? GrimoireColors.paperHi : 'transparent', color: hi ? GrimoireColors.ink : GrimoireColors.ink2 }}>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}` }}>{hi && <span style={{ color: GrimoireColors.red, marginRight: 4 }}>›</span>}{r.x} · {roman(r.x)}</td>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}`, textAlign: 'right' }}>{(r.pFree * 100).toFixed(1)}%</td>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}`, textAlign: 'right' }}>{r.eCards.toFixed(2)}</td>
                      <td style={{ padding: '7px 0', borderBottom: `0.5px dotted ${GrimoireColors.rule}`, textAlign: 'right', color: vc, fontStyle: 'italic' }}>{verdict}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* === FOOTER === */}
        <hr className="gx-rule" style={{ marginTop: 48 }} />
        <hr className="gx-rule-hair" style={{ marginTop: 2 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'baseline', marginTop: 14 }}>
          <div className="gx-italic" style={{ fontSize: 12, color: GrimoireColors.inkDim }}>— set by the Oracle in the Anno of MMXXVI —</div>
          <div className="gx-sc gx-folio-num" style={{ fontSize: 11, color: GrimoireColors.inkDim }}>· {x === 7 ? 'VII' : roman(x)} ·</div>
          <div className="gx-italic" style={{ fontSize: 12, color: GrimoireColors.inkDim, textAlign: 'right' }}>continued in §III, of the Genesis Wave →</div>
        </div>
      </div>
    </div>
  );
}

// === MOBILE ARTBOARD ===
function GrimoireMobile() {
  const deck = PortentMath.DEFAULT_DECK;
  const total = Object.values(deck).reduce((a, b) => a + b, 0);
  const [x, setX] = React.useState(7);
  const table = React.useMemo(() => PortentMath.table(deck, 1, 20), []);
  const cur = React.useMemo(() => PortentMath.simulate(deck, x), [x]);
  const [seed, setSeed] = React.useState(0);
  const reveals = React.useMemo(() => [PortentMath.sampleReveal(deck, x)], [x, seed]);

  return (
    <div className="gx" style={{ width: 412, minHeight: 1320, background: GrimoireColors.paper, padding: '24px 24px 40px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }} className="gx-sc">
        <span style={{ fontSize: 10, color: GrimoireColors.ink2 }}>Deck Oracle</span>
        <span className="gx-folio-num" style={{ fontSize: 10, color: GrimoireColors.ink2 }}>Folio XII</span>
      </div>
      <hr className="gx-rule" style={{ marginTop: 4 }} />
      <hr className="gx-rule-hair" style={{ marginTop: 2 }} />

      <div style={{ display: 'flex', overflowX: 'auto', gap: 12, padding: '10px 0', borderBottom: `0.5px solid ${GrimoireColors.rule}` }}>
        {[['I', 'Portent', true], ['II', 'Wave'], ['III', 'Surge'], ['IV', 'Vow'], ['V', 'Vortex'], ['VI', 'Rashmi']].map(([n, name, on]) => (
          <div key={n} style={{ display: 'inline-flex', gap: 4, color: on ? GrimoireColors.red : GrimoireColors.ink2, flex: '0 0 auto' }}>
            <span className="gx-sc" style={{ fontSize: 10 }}>{n}</span>
            <span style={{ fontSize: 13, fontStyle: on ? 'italic' : 'normal', textDecoration: on ? 'underline' : 'none', textUnderlineOffset: 3 }}>{name}</span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', margin: '24px 0 16px' }}>
        <div className="gx-sc" style={{ fontSize: 11, color: GrimoireColors.red }}>§ I</div>
        <h1 className="gx-disp" style={{ fontSize: 38, margin: '8px 0 4px', fontWeight: 500, lineHeight: 1.05 }}>
          On the<br /><span className="gx-italic">Calamitous Portent</span>
        </h1>
        <div className="gx-italic" style={{ fontSize: 13, color: GrimoireColors.ink2, marginTop: 8 }}>The chance of four distinct forms<br />in X uncovered cards.</div>
      </div>

      <div className="gx-ornament" style={{ margin: '12px 0 20px', fontSize: 14 }}>⁂</div>

      <div style={{ padding: 14, border: `0.5px solid ${GrimoireColors.ruleHi}`, background: GrimoireColors.paperHi, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
          <span className="gx-sc" style={{ fontSize: 10, color: GrimoireColors.red }}>Let X be</span>
          <span className="gx-disp gx-folio-num" style={{ fontSize: 36, lineHeight: 1 }}>{x}</span>
          <span className="gx-italic" style={{ fontSize: 12, color: GrimoireColors.ink2 }}>· {roman(x)}</span>
          <span style={{ flex: 1 }}></span>
          <span className="gx-italic gx-folio-num" style={{ fontSize: 11, color: GrimoireColors.inkDim }}>of {total}</span>
        </div>
        <input className="gx-slider" type="range" min="1" max="20" step="1" value={x} onChange={(e) => setX(+e.target.value)} />
      </div>

      <div style={{ textAlign: 'center', padding: '20px 0', borderTop: `0.5px solid ${GrimoireColors.ruleHi}`, borderBottom: `0.5px solid ${GrimoireColors.ruleHi}` }}>
        <div className="gx-sc" style={{ fontSize: 10, color: GrimoireColors.red, marginBottom: 6 }}>The Chance of Triumph</div>
        <div className="gx-disp gx-folio-num" style={{ fontSize: 72, lineHeight: 1, letterSpacing: '-0.02em' }}>
          {(cur.pFree * 100).toFixed(1)}<span style={{ fontSize: 26, color: GrimoireColors.ink2 }}>%</span>
        </div>
        <div className="gx-italic" style={{ fontSize: 13, color: GrimoireColors.ink2, marginTop: 8 }}>
          and a <span className="gx-folio-num">{cur.eCards.toFixed(2)}</span>-card yield, on the average.
        </div>
      </div>

      <figure style={{ margin: '24px 0' }}>
        <div className="gx-sc" style={{ fontSize: 10, color: GrimoireColors.red, textAlign: 'center' }}>Plate I</div>
        <div className="gx-italic" style={{ fontSize: 11, color: GrimoireColors.ink2, textAlign: 'center', marginBottom: 8 }}>P &amp; Yield against X.</div>
        <GxChart table={table} xValue={x} width={360} height={220} />
      </figure>

      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span className="gx-sc" style={{ fontSize: 10, color: GrimoireColors.red }}>§ Vision</span>
          <span style={{ flex: 1, borderBottom: `0.5px dotted ${GrimoireColors.rule}`, marginBottom: 4 }}></span>
          <span className="gx-sc" style={{ fontSize: 10, color: GrimoireColors.ink2, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => setSeed((s) => s + 1)}>↻ re-cast</span>
        </div>
        {reveals.map((rev, i) => (
          <div key={i}>
            <div className="gx-italic" style={{ fontSize: 13, color: GrimoireColors.ink, lineHeight: 1.55 }}>
              {rev.reveal.map((c, j) => (
                <span key={j}><span style={{ color: GrimoireColors.gold, fontStyle: 'normal' }}>{GTYPE_GLYPH[c.type]}</span> {c.name}{j < rev.reveal.length - 1 ? ', ' : '.'} </span>
              ))}
            </div>
            <div className="gx-sc" style={{ fontSize: 10, color: rev.free ? GrimoireColors.ink : GrimoireColors.red, marginTop: 8, textAlign: 'right' }}>
              {rev.distinctTypes} of 8 forms · {rev.free ? '✓ triumphs' : '✗ fails'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { GrimoireView, GrimoireMobile });
