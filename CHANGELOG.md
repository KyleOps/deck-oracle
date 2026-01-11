# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-01-11

### Added
- **Rashmi Calculator:** Free spell probabilities for "Rashmi, Eternities Crafter"
- **Mulligan Strategy Calculator:** Advanced mulligan decision optimizer
  - Sequential deadline probability calculations
  - Multi-type card requirements
  - Configurable confidence thresholds
- **Deck Import:** Moxfield and Archidekt integration with Cloudflare Worker proxy
- **Sample Generators:** Visual sample reveal generators for Rashmi and Vortex
- **Share Functionality:** Generate unique URLs to share calculator configurations

## [0.2.0] - 2026-01-11

### Added
- **Land Drop Calculator:** Analyze opening hand land counts and expected turns until missing land drops
  - Probability distributions for land counts in opening hand
  - Expected turn calculation for missed land drops
  - Interactive charts

## [0.1.0] - 2026-01-11

### Added
- **Initial Release:** Core probability calculators for Magic: The Gathering
- **Calculators:**
  - Portent of Calamity - Calculate probabilities for X=4+ reveals
  - Primal Surge - Expected value calculator for permanent reveals
  - Genesis Wave - Calculate expected permanents for various X values
  - Monstrous Vortex - Multi-step Discover chain probability calculator
- **UI Features:**
  - Dark/Light theme toggle
  - Responsive mobile-first design
  - Chart.js visualizations
  - Deck configuration sidebar
