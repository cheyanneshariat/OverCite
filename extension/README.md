# OverCite

OverCite is a Chromium extension for Overleaf that searches NASA ADS from inside a `\cite{...}` command, previews likely matches, and inserts BibTeX into your project.

## What is implemented

- Manifest V3 extension scaffold
- Overleaf content script with an OverCite overlay
- ADS search and BibTeX export via service worker
- Citation parsing, key generation, BibTeX dedupe, and bibliography resolution
- Options page for ADS token, theme preference, return-to-source behavior, and project-level `.bib` overrides
- Node test suite covering parser, ranking, key generation, dedupe, and an example-TeX harness

## Current editor strategy

OverCite uses two layers:

- A page bridge injected into Overleaf to read and edit the active CodeMirror 6 document
- DOM automation in the content script to switch files and update the bibliography file

This keeps v1 on the client side without depending on undocumented Overleaf backend APIs. Overleaf's page structure can change, so the DOM selectors are intentionally defensive and include graceful fallbacks.

## Load the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `/Users/bijan1339/Desktop/Caltech/Notebooks/OverCite/extension`
5. Open the extension options page and paste your ADS API token

## Trigger inside Overleaf

- Open your target bibliography file such as `references.bib`, `refs.bib`, or any other `.bib` file as an editor tab once before using OverCite
- Put the cursor inside a citation command such as `\citep{Shariat25}`
- Press `Alt+Shift+E`, or remap the `OverCite` command in Chrome extension shortcuts
- Pick the ADS record you want

## Test

```bash
npm test
```
