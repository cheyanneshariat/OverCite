# Changelog

## Unreleased

- Added a `bibcode` citation-key mode so inserted citations can use ADS bibcodes such as `2024MNRAS.52711719Y`.

## 0.1.3

- Added an optional `ADS query` mode in both the Overleaf and VS Code extensions.
- VS Code now includes a dedicated `Resolve Citation (ADS Query)` command.
- Improved direct ADS-query parsing for quoted fielded queries and quoted commas.
- Expanded browser, VS Code, benchmark, and local smoke-test coverage for the new mode.

## 0.1.2

- Added `Simple search` as a faster query option (uses no context, only citation token).
- Browser/Overleaf version now includes a popup toggle and a default search-mode setting.
- VS Code version now includes a dedicated `Resolve Citation (Simple Search)` command.
- VS Code version now supports a default search-mode setting and the `Alt+Shift+S` shortcut.

## 0.1.1

- Added Chrome, Firefox, and VS Code extension support in one repository.
- Improved citation retrieval for author-year keys, surname-only keys, multi-word surnames, and empty-token context-only lookups.
- Added alphabetical `.bib` insertion, clearer documentation, privacy/security notes, and logic-flow diagrams.
