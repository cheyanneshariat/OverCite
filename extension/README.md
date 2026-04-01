# OverCite

OverCite is a browser extension for Overleaf that searches ADS/SciX from inside a `\cite{...}` command, previews likely matches, and inserts BibTeX into your project.

## What is implemented

- Manifest V3 extension scaffold
- Overleaf content script with an OverCite overlay
- ADS/SciX search and BibTeX export via background worker
- Three search modes: contextual, simple search, and direct `ADS query`
- Citation parsing, key generation, BibTeX dedupe, and bibliography resolution
- Options page for ADS token, theme preference, and project-level `.bib` overrides
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
5. Open the extension options page and paste your ADS/SciX API token

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `manifest.json` from the local `extension/dist/firefox/` folder
4. Open the extension options page and paste your ADS/SciX API token

## Trigger inside Overleaf

- Open your target bibliography file such as `references.bib`, `refs.bib`, or any other `.bib` file as an editor tab once before using OverCite
- Put the cursor inside a citation command such as `\citep{Perlmutter99}`
- Press `Alt+Shift+E`, or remap the `OverCite` command in your browser's extension shortcut settings
- Pick the ADS record you want

For non-empty citation keys, the popup also exposes two small mode toggles:

- `Simple search` reruns the lookup from the typed token only
- `ADS query` sends the typed token directly to ADS/SciX

Short examples:

- `Contextual`: `\citep{Perlmutter99}`
- `Simple search`: `\citep{Schlegel}`
- `ADS query`: `\citep{title:"emcee"}`
- `ADS query` with fields: `\citep{author:"El-Badry" year:2022 title:"magnetic braking"}`

## Test

```bash
npm run build
npm test
```
