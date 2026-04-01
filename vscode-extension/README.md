# OverCite for VS Code

This package is a separate VS Code extension that brings the OverCite citation workflow to local LaTeX projects.

## What It Does

- Detects the active `\cite{...}` token under the cursor
- Uses local sentence and context text to search ADS/SciX
- Also supports a simple author/year-only fallback mode
- Also supports a direct ADS query mode for the raw token inside `\cite{...}`
- Shows ranked paper matches in a VS Code quick-pick list
- Inserts or reuses the matching BibTeX entry in the target `.bib` file
- Rewrites the active citation key in the source `.tex` file

## Current Behavior

- Focus stays in the source `.tex` editor after insertion
- BibTeX updates happen directly through the VS Code workspace API
- The same citation parsing, ADS query logic, and BibTeX insertion logic used in the Overleaf extension are copied into this package so the two versions stay isolated

## Settings

- `overcite.adsApiToken` (accepts either a NASA ADS or SciX API token)
- `overcite.contextWindowChars`
- `overcite.citationKeyMode` (`authoryear`, `informative`, or `typed`)
- `overcite.bibliographyInsertMode`
- `overcite.defaultSearchMode`
- `overcite.projectBibFileOverrides`

## Commands

- `OverCite: Resolve Citation` (`Alt+Shift+E`)
- `OverCite: Resolve Citation (Simple Search)` (`Alt+Shift+S`)
- `OverCite: Resolve Citation (ADS Query)`
- `OverCite: Show Diagnostics`

## ADS Query Mode

`OverCite: Resolve Citation (ADS Query)` sends the active token inside `\cite{...}` directly to ADS/SciX as the query string.

Examples:

- `\citep{Perlmutter99}` with the normal `Resolve Citation` command for contextual mode
- `\citep{Schlegel}` with `Resolve Citation (Simple Search)` when you want author-only lookup
- `\citep{title:"emcee"}`
- `\citep{author:"El-Badry" year:2022 title:"magnetic braking"}`
- `\citep{first_author:"Hunsch" year:1998}`

This mode is useful when you already know the literal ADS query you want to run and do not want contextual expansion from the surrounding sentence.

## Custom Shortcut

There is no default keybinding for `ADS Query`, to keep the default shortcut set small. If you want one, add a VS Code keyboard shortcut for `overcite.resolveCitationDirect`, for example:

```json
{
  "key": "alt+shift+d",
  "command": "overcite.resolveCitationDirect",
  "when": "editorTextFocus"
}
```

## Development

```bash
cd vscode-extension
npm test
```
