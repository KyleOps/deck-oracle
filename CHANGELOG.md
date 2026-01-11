# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-12 (PWA & Optimizations)

### Added
- **PWA Support:** The application is now a Progressive Web App (PWA).
    - Added `manifest.json` for app installability.
    - Added "Install App" button to the footer.
    - Updated `sw.js` to cache new assets and support offline functionality.
- **Icon:** Added a new custom SVG icon (hexagon with stats bars).
- **Footer:** Added a site footer with project description and GitHub link.
- **Load More:** Added pagination to sample reveals (limit 50 per batch).

### Changed
- **Mulligan Calculator:** 
    - **Significant logic improvement:** Now correctly handles sequential deadlines using conditional probabilities.
    - **Performance:** Implemented memoization for recursive calculations.
    - **Visuals:** Added unique colors for different card types.
    - **Defaults:** Improved default confidence thresholds.
- **Codebase Optimization:**
    - Refactored repetitive HTML for "Sample Reveals" into a dynamic JS utility.
    - **Repository Structure:** Moved all test files to a dedicated `tests/calculators/` directory to improve project organization and separate source code from testing logic.
- **UI/UX:** Moved the "Install" button to the footer to reduce header clutter.

## [1.0.0] - 2026-01-12 (Feature Complete)

### Added
- **Share Functionality:** Generate unique URLs to share deck configurations and calculator settings.
- **Mulligan Fixes:** Refined probability math for mulligan decisions.

## [0.9.0] - 2026-01-10 (Mobile & Stability)

### Changed
- **Design:** Switched to a mobile-first design philosophy for better usability on phones.
- **Architecture:** Moved away from Monte Carlo simulations to Hypergeometric math (exact formulas) where possible for better accuracy.

### Added
- **Testing:** Added test suite structure.

## [0.8.0] - 2026-01-09 (Cloud & New Calcs)

### Added
- **Moxfield Proxy:** Implemented a Cloudflare Worker to bypass CORS issues when importing from Moxfield.
- **Rashmi Calculator:** Added calculator for "Rashmi, Eternities Crafter" free spell probabilities.
- **Mulligan Calculator:** Initial implementation of the Mulligan Strategy calculator.
- **Samplers:** Added visual sample generators for Rashmi and Vortex.
- **Deck Import:** Added support for importing from Archidekt and Moxfield.

### Changed
- **Refactor:** Major code refactor to support serverless components.

## [0.5.0] - 2025-12-29 (Lands & Vortex)

### Added
- **Monstrous Vortex Calculator:** Initial release.
- **Land Drop Calculator:** Added opening hand and land drop consistency analysis.
- **UI:** Added smooth chart animations, improved sliders, and progress bars.

### Fixed
- **Styling:** Fixed button layouts for Vortex calculator.
- **Config:** Set a more reasonable default starting decklist.

## [0.1.0] - 2025-12-28 (Initial Release)

### Added
- **Core Calculators:** Portent of Calamity, Primal Surge, Genesis Wave.
- **Basic UI:** Theme switching and basic layout.
- **Project Structure:** Initial git init and file setup.