# OverCite

OverCite is a browser extension for Overleaf that searches NASA ADS from inside LaTeX citation commands, shows likely paper matches, and inserts BibTeX into the correct project bibliography file. 
It can also be used as a VSCode extension for those using local TeX installations.

It supports two search modes:

- `Contextual` uses the local sentence + typed cite key
- `Simple search` simply searches author/year and sorts by citation count (no context used)

## Repository

- `extension/`: browser extension source, tests, and generated browser-specific builds
- `extension/dist/chrome/`: generated Chrome / Chromium extension folder
- `extension/dist/firefox/`: generated Firefox extension folder
- `vscode-extension/`: separate VS Code extension package for local LaTeX workflows
- `docs/`: technical report, demo assets, and PDF overview

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
6. Paste your NASA ADS API token*, click `Save Settings` at the bottom
7. Open an Overleaf project and trigger OverCite inside `\cite{...}`
8. Put the cursor inside the citation key and press `Alt+Shift+E`

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `extension/dist/firefox/manifest.json`
4. Open the OverCite options page (open `about:addons` in browser, find OverCite, click `...`, click `Preferences`)
5. Paste your NASA ADS API token*, click `Save Settings` at the bottom
6. Open an Overleaf project and trigger OverCite inside `\cite{...}`
7. Put the cursor inside the citation key and press `Alt+Shift+E`

### VS Code

1. In normal VS Code, run `Extensions: Install from VSIX...`
2. Select `vscode-extension/overcite-vscode-0.1.1.vsix`
3. Reload VS Code
4. Open a local LaTeX workspace with a `.tex` file and at least one `.bib` file
5. Open VS Code Settings:
   - Mac shortcut: `Command+,`
   - or open the Command Palette with `Command+Shift+P` and run `Preferences: Open Settings (UI)`
6. In the Settings search bar, type `OverCite`
7. Under the `Extensions` --> `OverCite` section, find `OverCite: Ads Api Token`
8. Paste your NASA ADS API token* into that field
9. Open a `.tex` file, put the cursor inside the citation key, and press `Alt+Shift+E` (or run `OverCite: Resolve Citation` in the Command Palette)
10. Review the dropdown results and choose the paper you want

*sign in to [NASA ADS](https://ui.adsabs.harvard.edu/), then go to Account --> Settings --> API Token

## Demo

- Short tech demo video: [docs/assets/OverCite_demo.mov](docs/assets/OverCite_demo.mov)

## Use OverCite

1. In Overleaf source mode, type a rough citation key such as `\citep{Shariat25}` or `\citep{Shariat}`.
2. Put the cursor inside the citation braces on the key you want OverCite to resolve.
3. Press `Alt+Shift+E` or remap the shortcut in your browser's extension shortcut settings.
4. Review the OverCite results popup, including the title and abstract snippet.
5. Click the paper you want.
6. OverCite will update the active citation key and insert the BibTeX entry into the project bibliography file.

## Examples

Recommended citation patterns, from strongest to weakest:

- `\citep{Shariat25}`: best default, combining first author and year
- `\citep{Shariat2025}`: also supported if you prefer a four-digit year
- `\citep{Shariat}`: useful when you know the author but not the year
- `\citep{}`: last resort, where OverCite searches from the local sentence context alone

If the contextual result list looks wrong for a non-empty key, use the small `Simple search` toggle in the popup, or set `Default Search Mode` in the extension settings.

## Settings

OverCite keeps the UI simple and puts the main behavior controls in the extension settings page.

![OverCite settings](docs/assets/example_settings.png)

Current settings include:

- ADS API token for NASA ADS search access
- Theme selection
- Citation key style, including keeping the typed key instead of adding an informative suffix
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

## Update

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
4. Select `vscode-extension/overcite-vscode-0.1.1.vsix`
5. Reload VS Code

## Notes

- OverCite works with arbitrary `.bib` file names and is not limited to `references.bib`.
- The current implementation is deterministic and does not require an LLM.
- For common surnames, you can optionally include a first initial in the cite key to narrow results, for example `JSmith05`, `SmithJ05`, or `LiW25`.
- Multi-word surnames such as `Smith Jane` and `Smith Jane25` are supported.
- Chrome and Firefox should be loaded from the generated `extension/dist/` folders, not directly from the source `extension/` manifest.
- Maintainers can regenerate those browser-specific `dist/` folders with `cd extension && npm run build`.
- If it gets stuck, try refreshing Overleaf and/or clicking `Reload` on the OverCite extension at `chrome://extensions/`.
