# OverCite

OverCite is a browser extension for Overleaf that searches literature sources from inside a `\cite{...}` command, previews likely matches, and inserts BibTeX into your project. It defaults to fast ADS/SciX-only search and can opt into broader source presets or custom primary/fallback sources.

## What is implemented

- Manifest V3 extension scaffold
- Overleaf content script with an OverCite overlay
- Configurable source routing with ADS/SciX, arXiv, INSPIRE, Crossref, DataCite, and PubMed support
- Three search modes: contextual, simple search, and direct `Raw query`
- Citation parsing, key generation (including ADS bibcodes), BibTeX dedupe, and bibliography resolution
- Options page for source preset, primary/fallback sources, optional source tokens, theme preference, and project-level `.bib` overrides
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
5. Open the extension options page, choose a source preset, and paste your ADS/SciX API token if you want ADS/SciX results or ADS/SciX-only mode

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `manifest.json` from the local `extension/dist/firefox/` folder
4. Open the extension options page, choose a source preset, and paste your ADS/SciX API token if you want ADS/SciX results or ADS/SciX-only mode

### Safari

Safari support lives in the repository as a separate Xcode wrapper rather than a loadable browser folder. For the current local-build path, see [../safari/README.md](../safari/README.md).

## Trigger inside Overleaf

- Open your target bibliography file such as `references.bib`, `refs.bib`, or any other `.bib` file as an editor tab once before using OverCite
- Put the cursor inside a citation command such as `\citep{Perlmutter99}`
- Press `Alt+Shift+E`, or remap the `OverCite` command in your browser's extension shortcut settings
- Pick the record you want

For non-empty citation keys, the popup also exposes two small mode toggles:

- `Simple search` reruns the lookup from the typed token only
- `Raw query` sends the typed token directly to the configured sources. ADS/SciX fielded queries stay on ADS/SciX when ADS/SciX is configured.

The options page also lets you choose how inserted citation keys are written:

- `Author + Full Year` for keys like `Perlmutter1999`
- `Author_Year` for keys like `Perlmutter_1999`
- `Author:Year` for keys like `Perlmutter:1999`
- `Informative` for keys like `Perlmutter99_supernovae`
- `Bibcode` for keys like `2025PASP..137i4201S`
- `Keep Typed Key` to preserve what you entered when possible

Short examples:

- `Contextual`: `\citep{Perlmutter99}`
- `Simple search`: `\citep{Schlegel}`
- `Raw query`: `\citep{title:"emcee"}`
- `Raw query` with fields: `\citep{author:"El-Badry" year:2022 title:"magnetic braking"}`

## Test

```bash
npm run build
npm test
```
