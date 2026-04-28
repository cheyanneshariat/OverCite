# Changelog

## Unreleased

## ✨ 0.3.0

- Added broader source presets with arXiv, INSPIRE, Crossref, PubMed, and DataCite.
- Kept `ADS/SciX only` as the default fast path.
- Added custom source routing with one primary database and optional backups.
- Added `Author:Year` citation keys.
- Improved broad-source ranking for first authors, duplicate records, arXiv preprints, datasets, and software.
- Renamed direct lookup wording to `Raw query`.

## 0.2.0

- Added Safari support via a Safari Web Extension wrapper and Xcode project for local installs from this repo.
- Added a `bibcode` citation-key mode so inserted citations can use ADS bibcodes such as `1975CMaPh..43..199H`.
- Fixed issues in Safari PR

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
