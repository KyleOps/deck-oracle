# MTG Probability Calculator

A comprehensive suite of probability calculators for **Magic: The Gathering**, designed to help deck builders analyze consistency, optimize land counts, and evaluate the potential value of specific spells and mechanics.

## 🌟 Features

This application includes specialized calculators for various deck building scenarios:

*   **⚡ Portent of Calamity:** Analyzes the probability of getting a "free spell" (revealing 4+ distinct card types) and the expected value of X.
*   **🌿 Primal Surge:** Simulates how much of your deck you can expect to put onto the battlefield before hitting a non-permanent.
*   **🌊 Genesis Wave:** Calculates the expected number of permanents entering the battlefield for a given X value.
*   **🌀 Monstrous Vortex:** Simulates the "Discover" mechanic value when casting power 5+ creatures, including chain reactions.
*   **🌌 Rashmi, Eternities Crafter:** Estimates the probability of casting a spell for free off the top of your library based on your deck's mana curve.
*   **🏔️ Land Drops:** Analyzes the consistency of hitting land drops on curve and the quality of opening hands.
*   **🃏 Mulligan Strategy:** Uses hypergeometric distribution to determine optimal mulligan decisions based on specific hand requirements (e.g., "Need 3 Lands and 1 Ramp spell").

## 🚀 Usage

This is a static web application.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/mtgcalcs.git
    cd mtgcalcs
    ```
2.  **Run the application:**
    *   Simply open `index.html` in your modern web browser.
    *   OR serve it using a local development server (e.g., `npx serve`, `python3 -m http.server`, or VS Code Live Server).

## 📂 Project Structure

*   `index.html`: Main entry point and layout.
*   `css/`: Stylesheets for themes, layout, and components.
*   `js/`: Application logic.
    *   `main.js`: Core initialization and tab management.
    *   `calculators/`: Individual calculator logic modules.
    *   `utils/`: Shared utility functions (Hypergeometric math, simulation helpers, chart rendering, deck parsing).

## 🛠️ Technologies

*   **Vanilla JavaScript (ES6+):** No build steps or heavy frameworks required.
*   **Chart.js:** For data visualization.
*   **CSS Variables:** For theming (Portent Purple, Surge Green, etc.).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
