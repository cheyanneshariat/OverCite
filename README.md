# OverCite

OverCite is a citation tool for LaTeX that helps you find papers and insert their BibTeX entries without leaving the editor.

The tool queries NASA ADS/SciX, shows likely matches, and inserts the selected BibTeX entry into the project bibliography file. It's available as a browser extension for Overleaf or a VS Code extension for local LaTeX projects.

It supports two search modes:

1. `Contextual` uses typed citation key + local sentence context 
2. `Simple search` searches author/year only and sorts by citation count

Covered fields: astronomy, physics, Earth science, general-science collections, and *all papers on the arXiv*.

![OverCite workflow](docs/assets/outline.png)

## Get The Files

Before loading OverCite in Chrome, Firefox, or VSCode, get a local copy of this repository.

Option 1: Download from GitHub

1. Click the green `Code` button on GitHub.
2. Click `Download ZIP`.
3. Unzip the downloaded folder somewhere convenient.
4. Then use the committed `extension/dist/chrome/` or `extension/dist/firefox/` paths below.

Option 2: Clone with git

```bash
git clone https://github.com/cheyanneshariat/OverCite.git
cd OverCite
```

## Install

### Chrome

1. Open `chrome://extensions`
2. Turn on Developer mode (top right)
3. Click `Load unpacked`
4. Select `extension/dist/chrome/`
5. Open the OverCite options page (`Details` --> `Extension options`)
6. Paste your NASA ADS or SciX API token*, click `Save Settings` at the bottom
7. Open an Overleaf project and trigger OverCite inside `\cite{...}`
8. Put the cursor inside the citation key and press `Alt+Shift+E`
   - Mac users: `Alt` means the `Option` key

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `extension/dist/firefox/manifest.json`
4. Open the OverCite options page (open `about:addons` in browser, find OverCite, click `...`, click `Preferences`)
5. Paste your NASA ADS or SciX API token*, click `Save Settings` at the bottom
6. Open an Overleaf project and trigger OverCite inside `\cite{...}`
7. Put the cursor inside the citation key and press `Alt+Shift+E`

### VS Code

1. In normal VS Code, run `Extensions: Install from VSIX...`
2. Select `vscode-extension/overcite-vscode-0.1.2.vsix`
3. Reload VS Code
4. Open a local LaTeX workspace with a `.tex` file and at least one `.bib` file
5. Open VS Code Settings:
   - Mac shortcut: `Command+,`
   - or open the Command Palette with `Command+Shift+P` and run `Preferences: Open Settings (UI)`
6. In the Settings search bar, type `OverCite`
7. Under the `Extensions` --> `OverCite` section, find `OverCite: Ads Api Token`
8. Paste your NASA ADS or SciX API token* into that field
9. Open a `.tex` file, put the cursor inside the citation key, and press `Alt+Shift+E` (or run `OverCite: Resolve Citation` in the Command Palette)
10. If you want the VS Code version to ignore sentence context, press `Alt+Shift+S`, run `OverCite: Resolve Citation (Simple Search)`, or set `OverCite: Default Search Mode` in VS Code settings
11. Review the dropdown results and choose the paper you want

*sign in to [NASA ADS](https://ui.adsabs.harvard.edu/) or [SciX](https://scixplorer.org/), then go to your account settings and copy an API token

## Demo

- Short tech demo video: [docs/assets/OverCite_demo.mov](docs/assets/OverCite_demo.mov)

## How to use OverCite

1. In Overleaf source mode, type a rough citation key such as `\citep{Shariat25}` or `\citep{Shariat}`.
2. Put the cursor inside the citation braces on the key you want OverCite to resolve.
3. Press `Alt+Shift+E` or remap the shortcut in your browser's extension shortcut settings.
4. Review the OverCite results popup, including the title and abstract snippet.
5. Click the paper you want.
6. OverCite will update the active citation key and insert the BibTeX entry into the project bibliography file.

## Examples

Recommended citation patterns, from strongest to weakest:

- `\citep{Perlmutter99}`: best default, combining first author and year
- `\citep{Abbott2016}`: also supported if you prefer a four-digit year
- `\citep{Schlegel}`: useful when you know the author but not the year
- `\citep{}`: last resort, where OverCite searches from the local sentence context alone

If the contextual result list looks wrong for a non-empty key, try `Simple search` or set `Default Search Mode` in the extension settings.

## Scope

OverCite works best when you already know the paper, author, or result you want to cite, and want to add it without leaving the editor. It is designed to replace the interruptive workflow of stopping, searching ADS/SciX, copying BibTeX, renaming the citation key, and then returning to writing. It is *not* meant to replace broader literature exploration or paper discovery.

## Settings

OverCite keeps the UI simple and puts the main behavior controls in the extension settings page.

Current settings include:

- ADS/SciX API token for search and BibTeX export
- Theme selection
- Citation key style, including plain author-year keys like `Shariat2025`, informative keys like `Shariat25_10k`, or keeping the typed key
- Bibliography entry order, including alphabetical insertion by citation key
- Default search mode, so OverCite can open in either contextual mode or simple search first
- Project-specific bibliography file overrides when a project contains multiple `.bib` files

The popup also includes a small `Simple search` fallback for non-empty citation keys. It ignores local sentence context and reruns the lookup from the typed author/year hint alone, then orders the matching results by citation count.

## Development

```bash
cd extension
npm run build
npm test
```

The repo also keeps a local-only running benchmark suite in `local_testing/benchmarks/` for manual and scripted regression checks, including:

- standard author-year cases
- surname-only cases
- empty-token context-only cases
- minimal-context cases such as `\citep{Shariat25}.` and `See \citep{El-Badry21}.`

## Documentation

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Logic flow: [docs/OverCite_logic_flow.md](docs/OverCite_logic_flow.md)
- Ranking flow: [docs/OverCite_ranking_flow.md](docs/OverCite_ranking_flow.md)
- Technical report: [docs/OverCite_technical_report.md](docs/OverCite_technical_report.md)
- PDF report: [docs/OverCite_technical_report.pdf](docs/OverCite_technical_report.pdf)
- Privacy: [PRIVACY.md](PRIVACY.md)
- Security: [SECURITY.md](SECURITY.md)

## Updating

If you download a newer version of the repository later, the update step depends on where you use OverCite.

### Chrome

1. Replace your local repo copy with the newer one, or `git pull`
2. Open `chrome://extensions`
3. Click `Reload` on OverCite
4. Refresh your Overleaf tab

### Firefox

1. Replace your local repo copy with the newer one, or `git pull`
2. Open `about:debugging#/runtime/this-firefox`
3. Remove the old temporary add-on if needed
4. Click `Load Temporary Add-on...`
5. Select `extension/dist/firefox/manifest.json` again
6. Refresh your Overleaf tab

### VS Code

1. Replace your local repo copy with the newer one, or `git pull`
2. In VS Code, uninstall the old OverCite extension if needed
3. Run `Extensions: Install from VSIX...`
4. Select `vscode-extension/overcite-vscode-{version}.vsix`
5. Reload VS Code

## Notes

- OverCite works with arbitrary `.bib` file names and is not limited to `references.bib`.
- The current implementation is deterministic and does not require an LLM.
- For common surnames, you can optionally include a first initial in the cite key to narrow results, for example `JSmith05`, `SmithJ05`, or `LiW25`.
- Multi-word surnames such as `Smith Jane` and `Smith Jane25` are supported.
- Collaborations such as `Planck Collaboration` and `The LIGO Collaboration25` are supported.
- Chrome and Firefox should be loaded from the generated `extension/dist/` folders, not directly from the source `extension/` manifest.
- Maintainers can regenerate those browser-specific `dist/` folders with `cd extension && npm run build`.
- If the popup gets stuck, try refreshing Overleaf and/or clicking `Reload` on the OverCite extension at `chrome://extensions/`.

## Contact
I am always happy to hear your thoughts or get any feedback! Please contact [Cheyanne Shariat](https://cheyanneshariat.github.io/) at **cshariat@caltech.edu**.
