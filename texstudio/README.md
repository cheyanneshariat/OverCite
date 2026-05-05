# OverCite for TeXstudio

Experimental TeXstudio integration for the OverCite v0.3.0 core.

The integration is intentionally small:

- TeXstudio runs a script macro.
- The macro writes a request JSON file next to the root document.
- `node texstudio/src/cli.mjs` resolves the citation using the v0.3.0 OverCite core.
- TeXstudio shows a result picker, then applies the active cite-key edit.
- The CLI updates the target `.bib` file.

## Quick Setup

1. Install Node.js 18 or newer.
2. Download or clone OverCite.
3. From the OverCite folder, run:

```bash
./install-texstudio.sh --source-profile astrophysics
```

The installer writes ready-to-import macros to `~/.overcite/texstudio/`, creates a starter settings file at `~/.overcite/texstudio-settings.json`, and copies a local settings reference to `~/.overcite/texstudio/settings-reference.md`.

To add an ADS/SciX token during setup:

```bash
./install-texstudio.sh --source-profile astrophysics --ads-token YOUR_TOKEN
```

To open the settings file immediately after setup:

```bash
./install-texstudio.sh --source-profile astrophysics --edit-settings
```

Then in TeXstudio:

1. Open `Macros` -> `Edit Macros...`.
2. Click `Import` and choose `~/.overcite/texstudio/overcite-contextual.txsMacro`.
3. Import `~/.overcite/texstudio/overcite-open-settings.txsMacro`.
4. Use the imported default shortcut, `Alt+Shift+E`, or change it in the macro editor.
5. Use `Alt+Shift+O` to open settings from TeXstudio.
6. Optional: add `overcite-simple.txsMacro` and `overcite-raw-query.txsMacro`; they default to `Alt+Shift+S` and `Alt+Shift+R`.

On the first run, TeXstudio asks whether to trust the script before it can write request files and run Node. Choose `Yes, allow all calls it will ever make` if you want OverCite to run without repeated permission prompts.

If something does not work, run:

```bash
node texstudio/scripts/install.mjs --doctor
```

The doctor checks Node, the generated macro files, the settings JSON, and the local settings reference. On macOS it also looks for TeXstudio in `/Applications` and `~/Applications`.

## Quick Check

Use `fixtures/quick-check` to verify the token-free path after setup:

1. Open `texstudio/fixtures/quick-check/main.tex` in TeXstudio.
2. Put the cursor inside `10.1038/s41586-021-03819-2`.
3. Run `OverCite: Resolve Citation (Raw Query)`.
4. Confirm the buffer changes to `\citep{Jumper2021}` and `references.bib` contains the AlphaFold entry.

The `.tex` file is updated in the TeXstudio buffer first; save the file when you want the disk copy to change. The `.bib` file is written immediately.

## Manual Setup

If you prefer not to run the installer, add a new TeXstudio Script macro and paste the contents of `macros/overcite-resolve.txsMacro`.

Set these TeXstudio persistent values once, either in a small setup macro or by editing the macro constants:

```js
setPersistent("overciteNodePath", "node");
setPersistent("overciteCliPath", "/absolute/path/to/OverCite/texstudio/src/cli.mjs");
```

For Simple search or Raw query, copy the macro and change:

```js
var OVERCITE_MODE = "simple";
// or
var OVERCITE_MODE = "direct";
```

## Settings

The CLI loads settings in this order:

1. `~/.overcite/texstudio-settings.json`
2. project `.overcite.json`
3. project `.overcite-texstudio.json`
4. settings passed by the macro request
5. environment token fallbacks

Example:

```json
{
  "sourceProfile": "astrophysics",
  "adsApiToken": "ADS_OR_SCIX_TOKEN",
  "ncbiApiKey": "",
  "contextWindowChars": 500,
  "citationKeyMode": "authoryear",
  "bibliographyInsertMode": "append",
  "defaultSearchMode": "contextual",
  "projectBibFileOverrides": {}
}
```

Run `Macros` -> `OverCite: Open Settings` or press `Alt+Shift+O` to edit the global JSON file. For all supported settings and values, see `~/.overcite/texstudio/settings-reference.md` or [SETTINGS.md](SETTINGS.md).

The v0.3.0 source settings are supported: `sourceProfile`, `primarySource`, `fallbackSources`, `sourceApiTokens.ads`, `sourceApiTokens.ncbi`, `adsApiToken`, `ncbiApiKey`, `contextWindowChars`, `citationKeyMode`, `bibliographyInsertMode`, `defaultSearchMode`, and `projectBibFileOverrides`.

## Notes

- Save the active `.tex` file before running the macro.
- The macro edits the active TeXstudio buffer; the CLI writes the `.bib` file.
- If multiple `.bib` files are possible, the macro asks which one to update.
- If setup looks wrong, run `node texstudio/scripts/install.mjs --doctor` from the OverCite folder.
- The resolve macros use TeXstudio script APIs documented for 4.x: `editor.document().getRootDocument()`, `editor.text()`, `cursor.lineNumber()`, `writeFile`, `readFile`, `system`, `UniversalInputDialog`, and `cursor.setPosition`.
- The settings macro opens `~/.overcite/texstudio-settings.json` in the system default editor. If a platform needs a different open command, rerun the installer with `--open-command`.
- This integration deliberately follows OverCite v0.3.0 behavior, not the reverted v0.3.1 raw-query patch.

## Test

```bash
cd texstudio
npm run check
npm test
npm run test:smoke
npm run install:local -- --help
node scripts/install.mjs --output-dir tmp/doctor-macros --settings-path tmp/doctor-settings.json
node scripts/install.mjs --output-dir tmp/doctor-macros --settings-path tmp/doctor-settings.json --doctor
```

From the repository root, the same focused TeXstudio suite is:

```bash
cd texstudio && npm run check && npm test && npm run test:smoke
```

Full regression before packaging:

```bash
cd extension && npm test && npm run build
cd ../vscode-extension && npm run check && npm test
cd ../texstudio && npm run check && npm test && npm run test:smoke
```
