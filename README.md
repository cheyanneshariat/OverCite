# OverCite

OverCite is a browser extension for Overleaf that searches NASA ADS from inside LaTeX citation commands, shows likely paper matches, and inserts BibTeX into the correct project bibliography file.

## Repository layout

- `extension/`: loadable browser extension source
- `docs/`: technical report, demo assets, and PDF overview

## How To

### Chrome

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Click `Load unpacked`
4. Select `extension/`
5. Open the OverCite options page
6. Paste your NASA ADS API token*
7. Open an Overleaf project and trigger OverCite inside `\cite{...}`
8. Put the cursor inside the citation key and press `Alt+Shift+E`

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `extension/manifest.json`
4. Open the OverCite options page (open `about:addons` in browser, find OverCite, click `...`, click `Preferences`)
5. Paste your NASA ADS API token*
6. Open an Overleaf project and trigger OverCite inside `\cite{...}`
7. Put the cursor inside the citation key and press `Alt+Shift+E`

*sign in to [NASA ADS](https://ui.adsabs.harvard.edu/), go to Account --> Settings --> API Token

## Demo

- Short tech demo video: [docs/assets/OverCite_demo.mov](docs/assets/OverCite_demo.mov)

## Citation Flow

1. In Overleaf source mode, type a rough citation key such as `\citep{Shariat25}` or `\citep{El-Badry}`.
2. Put the cursor inside the citation braces on the key you want OverCite to resolve.
3. Press `Alt+Shift+E` or remap the shortcut in your browser's extension shortcut settings.
4. Review the OverCite results popup, including the title and abstract snippet.
5. Click the paper you want.
6. OverCite will update the active citation key and insert the BibTeX entry into the project bibliography file.

## Settings

OverCite keeps the UI simple and puts the main behavior controls in the extension settings page.

![OverCite settings](docs/assets/example_settings.png)

Current settings include:

- ADS API token for NASA ADS search access
- Theme selection
- Citation key style, including keeping the typed key instead of adding an informative suffix
- Bibliography entry order, including alphabetical insertion by citation key
- Project-specific bibliography file overrides when a project contains multiple `.bib` files

## Local testing

```bash
cd extension
npm test
```

## Documentation

- Technical report: [docs/OverCite_technical_report.md](docs/OverCite_technical_report.md)
- PDF report: [docs/OverCite_technical_report.pdf](docs/OverCite_technical_report.pdf)

## Notes

- OverCite works with arbitrary `.bib` file names and is not limited to `references.bib`.
- The current implementation is deterministic and does not require an LLM.
- For common surnames, you can optionally include a first initial in the cite key to narrow results, for example `JSmith05`, `SmithJ05`, or `LiW25`.
- If it gets stuck, try refreshing Overleaf and/or clicking `Reload` on the OverCite extensions at `chrome://extensions/`.
