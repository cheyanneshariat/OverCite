# OverCite for VS Code

This package is a separate VS Code extension that brings the OverCite citation workflow to local LaTeX projects.

## What It Does

- Detects the active `\cite{...}` token under the cursor
- Uses local sentence and context text to search NASA ADS
- Shows ranked paper matches in a VS Code quick-pick list
- Inserts or reuses the matching BibTeX entry in the target `.bib` file
- Rewrites the active citation key in the source `.tex` file

## Current Behavior

- Focus stays in the source `.tex` editor after insertion
- BibTeX updates happen directly through the VS Code workspace API
- The same citation parsing, ADS query logic, and BibTeX insertion logic used in the Overleaf extension are copied into this package so the two versions stay isolated

## Settings

- `overcite.adsApiToken`
- `overcite.contextWindowChars`
- `overcite.citationKeyMode`
- `overcite.bibliographyInsertMode`
- `overcite.projectBibFileOverrides`

## Development

```bash
cd vscode-extension
npm test
```
