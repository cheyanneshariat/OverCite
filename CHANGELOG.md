# Changelog

## Unreleased

## 0.1.3

- Added an optional `ADS query` mode in both the Overleaf and VS Code extensions. This mode sends the active citation token directly to ADS/SciX without contextual expansion.
- Added `OverCite: Resolve Citation (ADS Query)` in VS Code and documented how to bind a custom shortcut for it.
- Improved direct ADS-query parsing so quoted fielded queries and commas inside quoted values work correctly, including inputs such as `author:"El-Badry" year:2022 title:"magnetic braking"` and `first_author:"Smith, J" year:2020`.
- Hardened Overleaf/VS Code parity and added permanent direct-mode regression coverage in browser tests, VS Code tests, benchmark runs, and local Overleaf/VS Code smoke harnesses.
- Preserved existing contextual and simple-search behavior while expanding the direct-query diagnostics and benchmark suite.

## 0.1.2

- Added `Simple search` as a faster query option (uses no context, only citation token).
- Browser/Overleaf version now includes a popup toggle and a default search-mode setting.
- VS Code version now includes a dedicated `Resolve Citation (Simple Search)` command.
- VS Code version now supports a default search-mode setting and the `Alt+Shift+S` shortcut.

## 0.1.1

- Added Chrome, Firefox, and VS Code extension support in one repository.
- Improved citation retrieval for author-year keys, surname-only keys, multi-word surnames, and empty-token context-only lookups.
- Added alphabetical `.bib` insertion, clearer documentation, privacy/security notes, and logic-flow diagrams.
