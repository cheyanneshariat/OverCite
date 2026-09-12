# OverCite

Maintenance release: Classic is the default contextual engine; Context Beta requires an explicit selection and remains experimental. Explicit saved preferences are retained. Full literal titles in Simple Search now use Crossref title queries rather than author-name queries.

OverCite is a browser extension for Overleaf that searches literature sources from inside a `\cite{...}` command, previews likely matches, and inserts BibTeX into your project. Before the first lookup after this update, it requires a subject-area choice with nothing preselected; the choice selects a source preset and can be changed later.

## What is implemented

- Manifest V3 extension scaffold
- Overleaf content script with an OverCite overlay
- Configurable source routing with ADS/SciX, arXiv, INSPIRE, Crossref, DataCite, and PubMed support
- Three search modes: contextual, simple search, and raw query
- Citation parsing, key generation (including ADS bibcodes), BibTeX dedupe, and bibliography resolution
- Options page for subject-area preset, primary/fallback sources, optional source tokens, theme preference, source-return behavior, and project-level `.bib` overrides
- Node test suite covering parser, ranking, key generation, dedupe, and an example-TeX harness

## Current editor strategy

OverCite uses two layers:

- A page bridge injected into Overleaf to read and edit the active CodeMirror 6 document
- DOM automation in the content script to switch files and update the bibliography file

This keeps v1 on the client side without depending on undocumented Overleaf backend APIs. Overleaf's page structure can change, so the DOM selectors are intentionally defensive and include graceful fallbacks.

## Load the extension

### Chrome / Chromium

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the local `extension/dist/chrome/` folder from this repository
5. Trigger OverCite and choose your subject area in the one-time prompt; use the options page later to change it or add an ADS/SciX token

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `manifest.json` from the local `extension/dist/firefox/` folder
4. Trigger OverCite and choose your subject area in the one-time prompt; use the options page later to change it or add an ADS/SciX token

### Safari

Safari support lives in the repository as a separate Xcode wrapper rather than a loadable browser folder. For the current local-build path, see [../safari/README.md](../safari/README.md).

## Trigger inside Overleaf

The first trigger after installing or updating to browser v0.3.11 asks for a subject area before reading the editor or searching. Nothing is selected by default, closing the prompt cancels the lookup, and the saved choice prevents repeat prompts.

Astronomy / Astrophysics search requires a NASA ADS or SciX API token. If it is missing, OverCite opens the extension settings and focuses the token field instead of retrying the same request.
The API Keys section includes an expandable setup guide with direct token links. Physics can use ADS/SciX when a token is present but still searches Crossref and arXiv without one. PubMed works without an NCBI key; the key only improves its rate limit. The General, Computer Science, Math, and Chemistry presets require no API key.

- Open your target bibliography file such as `references.bib`, `refs.bib`, or any other `.bib` file as an editor tab once before using OverCite
- Put the cursor inside a citation command such as `\citep{Perlmutter99}`
- Press `Alt+Shift+E`, or remap the `OverCite` command in your browser's extension shortcut settings
- Pick the record you want

New browser installs start in `Simple search` for non-empty citation keys. Existing saved preferences are left unchanged, and empty `\cite{}` lookups stay contextual. Depending on the active mode, the popup exposes the other two options from:

- `Contextual search` adds nearby sentence context
- `Simple search` reruns the lookup from the typed token only
- `Raw query` sends the typed token directly to the configured sources. ADS/SciX fielded queries stay on ADS/SciX when ADS/SciX is configured.

Context Beta is experimental in v0.4.8. Common author-year names and ambiguous prose can return incorrect or missing papers; review suggestions before insertion. New non-empty lookups default to Simple Search, while saved preferences are preserved and empty citations remain contextual. Beta reranks locally using automatically selected context, and provider coverage and availability limit recovery. Simple Search and Raw Query do not use the beta ranker. Select `Classic` under `Contextual engine` to compare.

The options page also lets you choose how inserted citation keys are written:

- `Author + Full Year` for keys like `Perlmutter1999`
- `Author_Year` for keys like `Perlmutter_1999`
- `Author:Year` for keys like `Perlmutter:1999`
- `Informative` for keys like `Perlmutter99_supernovae`
- `Bibcode` for keys like `2025PASP..137i4201S`
- `Keep Typed Key` to preserve what you entered when possible

Browser users can disable `Return to source file after insert` if they prefer to remain on the bibliography after OverCite finishes updating the target `.bib` file. Without a saved or synced preference, the default returns to the original `.tex` file; the popup dismisses immediately after insertion and the editor return continues in the background.

After a successful insertion, OverCite can show an acknowledgment reminder at most once every 90 days. You can copy the preferred text, snooze for 90 days, or disable reminders permanently. The schedule is stored only in local extension storage; no usage or manuscript activity is reported.

Short examples:

- `Contextual`: `\citep{Perlmutter99}`
- `Simple search`: `\citep{Schlegel}`
- `Raw query`: `\citep{title:"emcee"}`
- `Raw query` with fields: `\citep{author:"El-Badry" year:2022 title:"magnetic braking"}`

## Test

```bash
npm run build:chrome-firefox
npm test
npm run benchmark:contextual-beta
npm run test:chrome
npm run test:firefox
```
