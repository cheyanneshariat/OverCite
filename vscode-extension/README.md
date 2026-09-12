<h1>OverCite <img src="https://raw.githubusercontent.com/cheyanneshariat/OverCite/main/extension/icons/overcite-logo-square.png" alt="OverCite logo" height="24"></h1>

Maintenance release: Classic is the default contextual engine; Context Beta requires an explicit selection and remains experimental. Explicit saved preferences are retained. Full literal titles in Simple Search now use Crossref title queries rather than author-name queries.

OverCite helps you add LaTeX citations in VS Code without leaving the editor.

Place your cursor inside a `\cite{...}` command, press `Alt+Shift+E`, choose your subject area when prompted, review likely matches, and insert the selected BibTeX entry directly into your project bibliography. Nothing is preselected. Subject-area presets route searches through ADS/SciX, arXiv, Crossref, DataCite, or PubMed, while custom routing can still use INSPIRE.

If OverCite was helpful in preparing your manuscript, you can acknowledge it with:

<blockquote>
  This work made use of <a href="https://github.com/cheyanneshariat/OverCite">OverCite</a> \citep{Shariat2026}, an in-editor citation tool for LaTeX.
</blockquote>

After a successful insertion, OverCite can show this request at most once every 90 days. You can copy the text, snooze for 90 days, or disable reminders permanently. The schedule stays only in VS Code's local extension state; no usage or manuscript activity is reported.

## Getting Started

For local release validation, install `overcite-vscode-0.4.6.vsix` using **Extensions → Install from VSIX**. Unconfigured installations start in Simple Search; explicit user and workspace search preferences are retained. Empty citations still use contextual search. Context Beta is experimental: common author-year names and ambiguous prose can return incorrect or missing papers. Review suggestions before insertion. Workspace discovery overlaps with search, and optional citation counts do not block selection.

1. Install by searching for `OverCite` in VS Code Extensions.
2. Open a `.tex` file, place the cursor inside a `\cite{...}` command, and press `Alt+Shift+E`.
3. Choose your subject area in the required first-use prompt. Closing it cancels the lookup and saves nothing.
4. Open Settings and search for `OverCite` if you want to change the choice or add a NASA ADS/SciX token.

Astronomy / Astrophysics search requires a NASA ADS or SciX API token. If it is missing, OverCite opens the relevant VS Code setting directly instead of retrying the same request.
The setting description links directly to NASA ADS and SciX token pages. Physics can fall back to Crossref and arXiv without a token. PubMed works without an NCBI key; the key only improves its rate limit. The General, Computer Science, Math, and Chemistry presets require no API key.

To get an ADS/SciX token, sign in to NASA ADS or SciX and go to `Settings -> API Token`.

More details: https://github.com/cheyanneshariat/OverCite

## What It Does

- Detects the active `\cite{...}` token under the cursor
- Uses local sentence and context text to search the configured literature sources
- Also supports a simple author/year-only fallback mode
- Supports raw query mode for the token inside `\cite{...}`
- Shows ranked paper matches in a VS Code quick-pick list
- Inserts or reuses the matching BibTeX entry in the target `.bib` file
- Rewrites the active citation key in the source `.tex` file

## Current Behavior

- Focus stays in the source `.tex` editor after insertion
- BibTeX updates happen directly through the VS Code workspace API
- Local folders and virtual projects opened through Overleaf Workshop are supported
- Virtual-workspace discovery has a bounded timeout and can use an already open `.bib` document if the provider is temporarily unable to list the project
- The same citation parsing, source routing, raw-query logic, and BibTeX insertion logic used in the Overleaf extension are copied into this package so the two versions stay isolated

## Settings

- `overcite.adsApiToken` (accepts either a NASA ADS or SciX API token)
- `overcite.sourceProfile` (`astrophysics`, `physics`, `math`, `computer-science`, `life-sciences`, `chemistry`, `general`, or `custom`)
- `overcite.primarySource` and `overcite.fallbackSources` for custom routing. 1 database is usually enough. Add 1-2 backups only for cross-field work.
- `overcite.ncbiApiKey`
- `overcite.citationKeyMode` (`authoryear`, `authoryear-underscore`, `authoryear-colon`, `informative`, `bibcode`, or `typed`)
- `overcite.bibliographyInsertMode` (default: `alphabetical`; `append` remains available)
- `overcite.defaultSearchMode`
- `overcite.contextualSearchEngine` (`beta` or `classic`; the beta also races independent broad providers and checks arXiv for Chemistry preprints; Simple search and Raw query are unaffected)
- `overcite.projectBibFileOverrides`

## Commands

- `OverCite: Resolve Citation` (`Alt+Shift+E`)
- `OverCite: Resolve Citation (Simple Search)` (`Alt+Shift+S`)
- `OverCite: Resolve Citation (Raw Query)`
- `OverCite: Show Diagnostics`

## Raw Query Mode

`OverCite: Resolve Citation (Raw Query)` sends the active token inside `\cite{...}` directly to the configured source route. Fielded ADS/SciX queries such as `title:"emcee"` stay on ADS/SciX.

Examples:

- `\citep{Perlmutter99}` with the normal `Resolve Citation` command for contextual mode
- `\citep{Schlegel}` with `Resolve Citation (Simple Search)` when you want author-only lookup
- `\citep{10.1038/s41586-021-03819-2}` for DOI lookup
- `\citep{arXiv:1706.03762}` for arXiv lookup
- `\citep{title:"emcee"}`
- `\citep{author:"El-Badry" year:2022 title:"magnetic braking"}`
- `\citep{first_author:"Hunsch" year:1998}`

This mode is useful when you already know the literal query, DOI, arXiv identifier, or ADS/SciX fielded query you want to run and do not want contextual expansion from the surrounding sentence.

## Custom Shortcut

There is no default keybinding for `Raw Query`, to keep the default shortcut set small. If you want one, add a VS Code keyboard shortcut for `overcite.resolveCitationDirect`, for example:

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
