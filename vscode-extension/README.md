<h1>OverCite <img src="https://raw.githubusercontent.com/cheyanneshariat/OverCite/main/extension/icons/overcite-logo-square.png" alt="OverCite logo" height="24"></h1>

OverCite helps you add LaTeX citations in VS Code without leaving the editor.

Place your cursor inside a `\cite{...}` command, press `Alt+Shift+E`, review likely matches, and insert the selected BibTeX entry directly into your project bibliography. The default is fast ADS/SciX-only lookup; broader source presets can add arXiv, INSPIRE, Crossref, DataCite, and PubMed.

If OverCite was helpful in preparing your manuscript, you can acknowledge it with:

<blockquote>
  This work made use of <a href="https://github.com/cheyanneshariat/OverCite">OverCite</a>, an in-editor citation tool for LaTeX.
</blockquote>

## Getting Started

1. Install by searching for `OverCite` in VS Code Extensions.
2. Open Settings and search for `OverCite`.
3. Choose a source preset.
4. Paste your NASA ADS or SciX API token into `OverCite: Ads Api Token` if you want ADS/SciX search.
5. That's it. Open a `.tex` file, place the cursor inside a `\cite{...}` command, and press `Alt+Shift+E` to get started.

To get an ADS/SciX token, sign in to NASA ADS or SciX and go to `Settings -> API Token`.

More details: https://github.com/cheyanneshariat/OverCite

## What It Does

- Detects the active `\cite{...}` token under the cursor
- Uses local sentence and context text to search the configured literature sources
- Also supports a simple author/year-only fallback mode
- Also supports a raw query mode for the token inside `\cite{...}`
- Shows ranked paper matches in a VS Code quick-pick list
- Inserts or reuses the matching BibTeX entry in the target `.bib` file
- Rewrites the active citation key in the source `.tex` file

## Current Behavior

- Focus stays in the source `.tex` editor after insertion
- BibTeX updates happen directly through the VS Code workspace API
- The same citation parsing, source routing, raw-query logic, and BibTeX insertion logic used in the Overleaf extension are copied into this package so the two versions stay isolated

## Settings

- `overcite.adsApiToken` (accepts either a NASA ADS or SciX API token)
- `overcite.sourceProfile` (`ads-only`, `astrophysics`, `broad`, `astro-physics`, `math-physics`, `life-sciences`, `computer-science`, or `custom`)
- `overcite.primarySource` and `overcite.fallbackSources` for custom routing
- `overcite.ncbiApiKey`
- `overcite.contextWindowChars`
- `overcite.citationKeyMode` (`authoryear`, `authoryear-underscore`, `authoryear-colon`, `informative`, `bibcode`, or `typed`)
- `overcite.bibliographyInsertMode`
- `overcite.defaultSearchMode`
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
