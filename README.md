# OverCite

OverCite is a citation tool for LaTeX that helps you find papers and insert their BibTeX entries without leaving the editor.

The tool queries NASA ADS/SciX, shows likely matches, and inserts the selected BibTeX entry into the project bibliography file. It's available as a browser extension for Overleaf or a VS Code extension for local LaTeX projects.

It supports three search modes:

1. `Contextual` uses typed citation key + local sentence context 
2. `Simple search` searches author/year only and sorts by citation count
3. `ADS query` sends the typed token directly to ADS/SciX

Covered fields: astronomy, physics, biology, Earth science, general-science collections, and *all papers on the arXiv*.

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

<details>
  <summary>Chrome</summary>

1. Open `chrome://extensions`
2. Turn on Developer mode (top right)
3. Click `Load unpacked`
4. Select `extension/dist/chrome/`
5. Open the OverCite options page (`Details` --> `Extension options`)
6. Paste your NASA ADS or SciX API token*, click `Save Settings` at the bottom
7. Open an Overleaf project and trigger OverCite inside `\cite{...}`
8. Put the cursor inside the citation key and press `Alt+Shift+E`
   - Mac users: `Alt` means the `Option` key

</details>

<details>
  <summary>Firefox</summary>

1. Open `about:debugging#/runtime/this-firefox`
2. Click `Load Temporary Add-on...`
3. Select `extension/dist/firefox/manifest.json`
4. Open the OverCite options page (open `about:addons` in browser, find OverCite, click `...`, click `Preferences`)
5. Paste your NASA ADS or SciX API token*, click `Save Settings` at the bottom
6. Open an Overleaf project and trigger OverCite inside `\cite{...}`
7. Put the cursor inside the citation key and press `Alt+Shift+E`

</details>

<details>
  <summary>VS Code</summary>

1. In normal VS Code, run `Extensions: Install from VSIX...`
2. Select `vscode-extension/overcite-vscode-0.1.3.vsix`
3. Reload VS Code
4. Open a local LaTeX workspace with a `.tex` file and at least one `.bib` file
5. Open VS Code Settings:
   - Mac shortcut: `Command+,`
   - or open the Command Palette with `Command+Shift+P` and run `Preferences: Open Settings (UI)`
6. In the Settings search bar, type `OverCite`
7. Under the `Extensions` --> `OverCite` section, find `OverCite: Ads Api Token`
8. Paste your NASA ADS or SciX API token* into that field
9. Open a `.tex` file, put the cursor inside the citation key, and press `Alt+Shift+E`
10. Or use the Command Palette and run one of:
   - `OverCite: Resolve Citation`
   - `OverCite: Resolve Citation (Simple Search)`
   - `OverCite: Resolve Citation (ADS Query)`
11. Review the dropdown results and choose the paper you want

For custom VS Code shortcuts or more detailed VS Code examples, see [vscode-extension/README.md](vscode-extension/README.md).

</details>

*sign in to [NASA ADS](https://ui.adsabs.harvard.edu/) or [SciX](https://scixplorer.org/), then go to your account settings and copy an API token

## Demo

- Short tech demo video: [docs/assets/OverCite_demo.mov](docs/assets/OverCite_demo.mov)

## How to use OverCite

1. In Overleaf source mode, type a rough citation key such as `\citep{Perlmutter99}` or `\citep{Schlegel}`.
2. Put the cursor inside the citation braces on the key you want OverCite to resolve.
3. Press `Alt+Shift+E` or remap the shortcut in your browser's extension shortcut settings.
4. Review the OverCite results popup, including the title and abstract snippet.
5. Click the paper you want.
6. OverCite will update the active citation key and insert the BibTeX entry into the project bibliography file.

## Examples

Recommended citation patterns, from strongest to weakest:

- `\citep{Shariat25}`: best default, combining first author and year
- `\citep{Abbott2016}`: also supported if you prefer a four-digit year
- `\citep{Schlegel}`: useful when you know the author but not the year
- `\citep{}`: last resort, where OverCite searches from the local sentence context alone

Mode examples:

- `Contextual`: `Cosmic acceleration from Type Ia supernovae remains foundational \citep{Perlmutter99}.`
- `Simple search`: `Galactic dust corrections often begin with \citep{Schlegel}.`
- `ADS query`: `Sometimes, you just have to boot up the MCMC \citep{title:"emcee"}.`
- `ADS query` with fields: `People find that magnetic braking saturates \citep{author:"El-Badry" year:2022 title:"magnetic braking"}.`

If the contextual result list looks wrong for a non-empty key, try `Simple search`, try `ADS query`, or set `Default Search Mode` in the extension settings.

## Scope

OverCite works best when you already know the paper, author, or result you want to cite, and want to add it without leaving the editor. It is designed to replace the interruptive workflow of stopping, searching ADS/SciX, copying BibTeX, renaming the citation key, and then returning to writing. It is *not* meant to replace broader literature exploration or paper discovery.

## Settings

OverCite keeps the UI simple and puts the main behavior controls in the extension settings page.

Current settings include:

- ADS/SciX API token for search and BibTeX export
- Theme selection
- Citation key style, including plain author-year keys like `Perlmutter1999`, informative keys like `Perlmutter99_supernovae`, or keeping the typed key
- Bibliography entry order, including alphabetical insertion by citation key
- Default search mode, so OverCite can open in contextual mode, simple search mode, or ADS query mode first
- An optional `ADS query` mode that sends the typed token directly to ADS/SciX
- Project-specific bibliography file overrides when a project contains multiple `.bib` files

For non-empty citation keys, the popup also includes small `Simple search` and `ADS query` fallbacks. `Simple search` ignores local sentence context and reruns the lookup from the typed author/year hint alone, while `ADS query` sends the typed token directly to ADS/SciX.

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
- minimal-context cases such as `\citep{Perlmutter99}.`, `See \citep{Abbott2016}.`, and `See \citep{Schlegel}.`
- direct ADS-query cases such as `title:"magnetic braking"` and `author:"El-Badry" year:2022 title:"magnetic braking"`

## Documentation

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Logic flow: [docs/OverCite_logic_flow.md](docs/OverCite_logic_flow.md)
- Ranking flow: [docs/OverCite_ranking_flow.md](docs/OverCite_ranking_flow.md)
- Technical report: [docs/OverCite_technical_report.md](docs/OverCite_technical_report.md)
- PDF report: [docs/OverCite_technical_report.pdf](docs/OverCite_technical_report.pdf)
- Privacy policy: [PRIVACY.md](PRIVACY.md)

## Updating

If you download a newer version of the repository later, the update step depends on where you use OverCite.

<details>
  <summary>Chrome</summary>

1. Replace your local repo copy with the newer one, or `git pull`
2. Open `chrome://extensions`
3. Click `Reload` on OverCite
4. Refresh your Overleaf tab

</details>

<details>
  <summary>Firefox</summary>

1. Replace your local repo copy with the newer one, or `git pull`
2. Open `about:debugging#/runtime/this-firefox`
3. Remove the old temporary add-on if needed
4. Click `Load Temporary Add-on...`
5. Select `extension/dist/firefox/manifest.json` again
6. Refresh your Overleaf tab

</details>

<details>
  <summary>VS Code</summary>

1. Replace your local repo copy with the newer one, or `git pull`
2. In VS Code, uninstall the old OverCite extension if needed
3. Run `Extensions: Install from VSIX...`
4. Select `vscode-extension/overcite-vscode-0.1.3.vsix`
5. Reload VS Code

</details>

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
