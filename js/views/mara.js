/**
 * mara — calculator view.
 * Mounted into #mara-tab by the shell the first time the calculator is opened.
 */

export const template = `
<h1>Ensnared by the Mara Calculator</h1>
<p class="card-text">"Each opponent faces a villainous choice..."</p>

<div class="main-grid single-column">
    <section class="panel" id="mara-results" aria-label="Choice analysis">
        <h2>Results</h2>
        <p style="color: var(--text-dim); text-align: center; padding: 20px;">
            Import at least one opponent's decklist to see analysis.
        </p>
    </section>

    <section class="panel" id="mara-sample-reveals" aria-label="Sample reveals">
        <h2>Sample Reveals</h2>
        <p style="color: var(--text-dim); text-align: center; padding: 20px;">
            Import opponent decklists to see sample simulations.
        </p>
    </section>
</div>
`;
