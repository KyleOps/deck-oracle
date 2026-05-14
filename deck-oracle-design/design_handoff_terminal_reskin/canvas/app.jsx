// Root mount: build a DesignCanvas with two artboards per direction.

function DeckOracleCanvas() {
  return (
    <DesignCanvas>
      <DCSection id="terminal" title="◆ Direction A · TERMINAL" subtitle="Bloomberg-style data console. Mono, dense, live tickers, ASCII-flavored chart, sample-reveal feed.">
        <DCArtboard id="terminal-desktop" label="Desktop · 1440 × full" width={1440} height={1320} style={{ background: '#080a09' }}>
          <TerminalView />
        </DCArtboard>
        <DCArtboard id="terminal-mobile" label="Mobile · 412" width={412} height={1080} style={{ background: '#080a09' }}>
          <TerminalMobile />
        </DCArtboard>
      </DCSection>

      <DCSection id="grimoire" title="❦ Direction B · GRIMOIRE" subtitle="Printed-book compendium. Cream parchment, fine serif, marginalia, hand-set tables, engraved chart plate.">
        <DCArtboard id="grimoire-desktop" label="Desktop · 1280 × full" width={1280} height={2300} style={{ background: '#f0e4c8' }}>
          <GrimoireView />
        </DCArtboard>
        <DCArtboard id="grimoire-mobile" label="Mobile · 412" width={412} height={1400} style={{ background: '#f0e4c8' }}>
          <GrimoireMobile />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<DeckOracleCanvas />);
