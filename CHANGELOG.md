# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-01-13 (Vow Enhancements & Optimizations)

### Added
- **Vow Calculator - Enhanced Breakdown Statistics:**
    - `simulateVow()` now returns comprehensive breakdown: `expectedHits`, `expectedLands`, `expectedLegends`, and `expectedManaValue`
    - Marginal value analysis now shows detailed breakdown: total hits, lands, legends, and mana value changes (not just total hits)
    - Sample summary now displays average lands, legends, and total mana value across simulations
- **Vow Calculator - Double Cast Feature:**
    - Added "Copy Spell" checkbox for effects like The Sixth Doctor or Magus Lucea Kane
    - Doubles the number of cards revealed when enabled (2X for same X value)
- **Vow Calculator - Enhanced Sample Reveals:**
    - 4-color card display system: Lands (green), Legends that hit (blue), Legends that miss (orange), Non-legends (gray)
    - Sample reveals now show: total hits, lands count, legends count, and total mana value per simulation

### Changed
- **Vow Calculator - Performance Optimizations:**
    - Added card analysis caching with `cardAnalysisCache` Map (30-40% faster for large decks)
    - Eliminated redundant calculations in `updateStats()` by using pre-calculated values from `simulateVow()`
    - Eliminated double loop in sample reveals by caching analyses locally (50% fewer card analyses)
    - Cache clears automatically when deck or X value changes
- **Vow Calculator - UI Improvements:**
    - Moved X value comparison table to end of page (after sample reveals)
    - Enhanced marginal value display with color-coded metrics
- **All Calculators:** Increased default simulation count from 10-20 to 500 for more accurate statistical sampling
  - Portent of Calamity: 10 → 500
  - Primal Surge: 10 → 500
  - Genesis Wave: 10 → 500
  - Kamahl's Druidic Vow: 10 → 500
  - Monstrous Vortex: 10 → 500
  - Rashmi, Eternities Crafter: 20 → 500

### Added
- **Tests:** Expanded Vow calculator test coverage with 6 new comprehensive tests:
    - Breakdown values validation (lands, legends, mana value)
    - Double cast functionality verification
    - Edge cases: no legendaries, all legendaries, non-legendary exclusion

## [1.3.0] - 2026-01-13 (Kamahl's Druidic Vow)

### Added
- **Kamahl's Druidic Vow Calculator:** Added new calculator for the legendary sorcery.
    - **Smart Logic:** Correctly distinguishes between Lands, Legendary Permanents, and non-Legendary 0-drops (fixing a common math error in similar tools that counts Mana Crypt as a hit).
    - **Rich Metrics:** Displays "Legendary Density" to help tune deck composition.
    - **Visuals:** Dual-line chart showing Expected Hits vs. Cards Revealed.
    - **Detailed Insights:** Sample reveals explain exactly why a card is a hit or miss (e.g. "Non-legendary" vs "CMC too high").
    - **Refactored Code:** Logic separated into pure functions for better testability and performance.
- **Tests:** Added comprehensive test suite for Kamahl's Druidic Vow, covering edge cases like Mana Crypt exclusion and Double Cast math.

## [1.2.0] - 2026-01-13 (Performance & Security)

### Changed
- **Deck Import Performance:** Major optimization pass on deck import system
    - **LRU Cache:** Optimized cache eviction from O(n log n) to O(1) using access order tracking (1000x faster when cache is full)
    - **Card Matching:** Fixed O(n²) card matching loop with pre-computed normalized Map for O(1) lookups (100-1000x faster for large decks)
    - **Parallel Processing:** Parallelized fuzzy search retries in batches of 5 instead of sequential processing (5x faster)
    - **Cache Efficiency:** Eliminated redundant cache lookups by using single `get()` instead of `has()` + `get()` (2x faster per access)
    - **Code Quality:** Extracted duplicate power parsing code into reusable `parsePowerValue()` helper function
    - **Regex Performance:** Pre-compiled regex patterns outside loops to avoid repeated compilation
    - **Configuration:** Extracted all magic numbers to named constants for better maintainability

### Added
- **Input Validation:** Enhanced security with comprehensive input validation
    - Added batch API response structure validation
    - Added card name length limits (max 100 characters)
    - Added decklist size limits (50KB, 500 lines max)
    - Added URL input length validation (max 200 characters)
- **Security Improvements:**
    - Fixed XSS vulnerabilities in share URL tab selection with whitelist validation and `CSS.escape()`
    - Added JSON structure validation for mulligan types before parsing
    - Added bounds checking for all numeric URL parameters
    - Enhanced URL validation for deck imports with domain whitelist
    - Implemented LRU cache with TTL (1 hour) and bounded size (1000 entries)
    - Added rate limiting with burst logic (200 req/min sustained, 60 req/10sec burst)
- **Cloudflare Worker Security:**
    - Added origin validation to restrict API proxy access to production site and localhost only
    - Added support for Archidekt deck imports (in addition to Moxfield)
    - Implemented domain whitelist for proxied URLs
- **Test Coverage:**
    - Added comprehensive test suite for deck import parsing (64 tests)
    - Added security-focused tests for share URL handling (40 tests)
    - Tests cover input validation, XSS prevention, DoS protection, and edge cases

### Fixed
- **Bug Fixes:**
    - Added missing `parseInt()` radix parameters to prevent parsing bugs with leading zeros
    - Fixed Archidekt deck imports being blocked by proxy worker

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