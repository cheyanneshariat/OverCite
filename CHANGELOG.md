# Changelog

## Unreleased

## 0.3.6

- Fixed severe Overleaf slowdowns by keeping file-navigation tracking dormant outside citation insertion and avoiding broad ancestor text scans for PDF, editor, and grammar-tool clicks.
- Added a packaged-browser regression that verifies unrelated clicks do not inspect large DOM subtrees.

## 0.3.5

- Fixed active-editor detection for Overleaf's current multi-panel UI, where the sidebar and source editor can both expose selected tabs.
- Prevented stale or hidden CodeMirror editors from redirecting citation insertion to unrelated files such as `old_text.tex`.
- Replaced partial filename checks with exact path-aware matching before source or bibliography writes.
- Raised the Firefox minimum version to 142, matching the manifest's data-collection permission metadata.
- Replaced dynamic result-card HTML with explicit DOM construction so the Firefox package lints without warnings.
- Added end-to-end Chrome coverage for `Rice2021`, bibliography insertion, stale-editor isolation, and both return-to-source settings.

## 0.3.4

- Fixed a browser runtime error that could show `preferredCitationCount is not defined` when duplicate search results were merged across sources.
- Replaced failed lookups with a retryable popup state instead of leaving a stale spinner.
- Background-worker timeout messages now tell users to refresh the Overleaf page and try again.
- Removed hidden toast nodes after fade-out so old timeout messages do not linger in the browser accessibility tree.
- Added a regression check so browser duplicate merging keeps the best available citation count.

## 0.3.3

- Added a browser setting to return to the original source `.tex` file after Overleaf bibliography insertion.
- Closed the browser insertion popup as soon as insertion finishes when returning to the source editor, so rapid follow-up citations are not blocked by lingering UI.
- Show citation-count badges in result cards when a provider returns citation metadata.
- Enrich arXiv result citation counts from ADS/SciX when an ADS/SciX token is configured, with a short timeout so simple search stays responsive.
- Improved simple-search ranking for title/context evidence, hyphenated author keys, source duplicates, and catalog-vs-paper distractors.
- Changed the Physics source preset to ADS/SciX first when configured, then Crossref and arXiv if needed, with no INSPIRE in the preset.

## 0.3.2

- Added experimental TeXstudio support through a local script macro, Node CLI, and one-command setup helper that reuse the v0.3.0 source-routing and insertion core.
- Added a TeXstudio `Open Settings` macro and full settings reference so users can edit every supported option from the TeXstudio workflow.
- Added TeXstudio setup diagnostics with `--doctor`, clearer first-run permission guidance, a token-free quick-check fixture, and stronger macro error handling.
- Added TeXstudio coverage for settings layering, root documents, BibLaTeX targets, project `.bib` overrides, paths with spaces, stale response files, and the quick smoke flow.

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

- Added an optional direct-query mode, then named `ADS query`, in both the Overleaf and VS Code extensions.
- VS Code added a dedicated direct-query command, renamed `Resolve Citation (Raw Query)` in 0.3.0.
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
