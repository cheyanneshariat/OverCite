# Changelog

## Unreleased

## 0.4.8 (Chrome and Firefox) / 0.4.6 (VS Code) — 2026-09-12

- Default unconfigured non-empty lookups to Simple Search; preserve explicit preferences. Empty citations remain contextual.
- Label Context Beta experimental; common author-year names and ambiguous prose can return incorrect or missing papers.
- Keep result cards stable, make citation counts non-blocking, and reject stale results after source or settings changes.
- Improve bibliography insertion safeguards and preserve available volume, issue, and page metadata.
- Correct citation-key/title interpretation, broad-source year/collaboration scoring, and VS Code initial keyboard selection.
- Safari 0.4.8 and TeXstudio 0.4.6 remain preview builds pending native-platform release checks.

## 0.3.12 (Chrome and Firefox) / 0.3.7 (VS Code)

- Restore citation-proximal contextual retrieval when decimal values, abbreviations, or LaTeX sentence structure confuse sentence extraction.
- Strip math, comments, references, and neighboring citation commands from contextual search evidence while keeping Simple search unchanged.
- Start contextual ADS/SciX lookup with broad exact-author recall plus focused context, then continue through the time-bounded query ladder instead of stopping on an early result count or fixed query count.
- Require author identity, year, contextual support, and a clear ranking margin before progressively returning a contextual result; strengthen wrong-author and wrong-year penalties.
- Bound VS Code ADS/SciX requests and the overall query ladder so a stalled provider cannot leave contextual search hanging indefinitely.
- Add common BibLaTeX citation commands to browser and VS Code parsing.
- Add a frozen adversarial accuracy corpus, late-correct-result coverage, and a browser/VS Code parity gate for contextual query generation and ranking.
- Keep Safari and TeXstudio unchanged in this release.

## 0.3.11 (Chrome and Firefox) / 0.3.6 (VS Code)

- Require a one-time subject-area choice before the first citation lookup after this update; no field is preselected or silently assumed.
- Apply the choice consistently across Chrome, Firefox, and VS Code, and cancel the lookup without saving when the prompt is dismissed.
- Preserve explicitly configured VS Code subject or custom-routing settings; browser users receive the one-time prompt because older browser releases did not record whether Astrophysics was chosen or inherited.
- Request only the optional browser permissions needed by the selected literature sources and keep the choice editable in settings.
- Open the browser or VS Code settings directly when an ADS-only subject choice has no API token, and replace the ineffective missing-token `Try again` action with `Open settings`.
- Explain which subject presets use API keys and add expandable, direct setup links for ADS/SciX and NCBI in browser settings; add the same official links to VS Code setting descriptions.
- Replace the one-time acknowledgment notice with a compact, local-only reminder shown at most once every 90 days after a successful insertion, with copy, snooze, and permanent opt-out actions.
- Keep TeXstudio and Safari unchanged in this release.

## 0.3.10 (Chrome and Firefox) / 0.3.5 (VS Code)

- Show a dismissible acknowledgment reminder once, after the first successful citation insertion following this update, for both new and existing users.
- Add a one-click action that copies the preferred `Shariat2026` acknowledgment text.
- Store only a versioned local shown-receipt, with no usage telemetry; storage or clipboard failures never affect citation insertion.
- Keep Safari and TeXstudio unchanged in this release.
- VS Code also includes the virtual-workspace fix below.

- VS Code: fixed indefinite citation-resolution hangs in virtual projects opened through Overleaf Workshop by using its supported filesystem API instead of unsupported workspace glob search.
- VS Code: added bounded virtual-workspace discovery, an open-`.bib` fallback, URI-safe bibliography handling, and end-to-end virtual-filesystem coverage while retaining the local-folder fast path.

## 0.3.8

- Restored automatic file switching for Overleaf's current single persistent CodeMirror editor, whose selected file tabs do not expose `aria-controls`.
- Kept delayed-transition and wrong-editor protections by requiring the editor document or identity to change after an automatic file switch and rechecking the expected document before every write.
- New browser installs without a saved or synced preference now return to the original source file after bibliography insertion by default; existing saved preferences remain unchanged.

## 0.3.7

- Bounded contextual ADS/SciX search with progressive high-confidence returns, request/body cancellation, an overall search budget, and truthful timeout messages.
- Fixed delayed Overleaf file switches by pairing each CodeMirror editor with its controlling filename, requiring verified target identity for automatic switching, and bounding file and source-recovery candidates under shared deadlines.
- Bound manual source and bibliography confirmation to the confirmed editor identity and user-navigation state, and made all source/bibliography writes idempotent when Overleaf applies a write before its response arrives.
- New browser installs now start in Simple search for non-empty citation keys. Existing saved browser preferences are preserved, and empty `\cite{}` lookups remain contextual.
- Added packaged Chrome and Firefox regressions for delayed transitions, missing filenames, wrong blank editors, manual-navigation races, collision-key late acknowledgments, empty-token mode selection, and the prior large-DOM pointer slowdown.

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
