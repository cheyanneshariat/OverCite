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
node texstudio/scripts/install.mjs --source-profile astrophysics
```

The installer writes ready-to-import macros to `~/.overcite/texstudio/` and creates a starter settings file at `~/.overcite/texstudio-settings.json`.

To add an ADS/SciX token during setup:

```bash
node texstudio/scripts/install.mjs --source-profile astrophysics --ads-token YOUR_TOKEN
```

Then in TeXstudio:

1. Open `Macros` -> `Edit Macros...`.
2. Click `Import` and choose `~/.overcite/texstudio/overcite-contextual.txsMacro`.
3. Use the imported default shortcut, `Alt+Shift+E`, or change it in the macro editor.
4. Optional: add `overcite-simple.txsMacro` and `overcite-raw-query.txsMacro`; they default to `Alt+Shift+S` and `Alt+Shift+R`.

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
  "citationKeyMode": "authoryear",
  "bibliographyInsertMode": "append",
  "defaultSearchMode": "contextual"
}
```

The v0.3.0 source settings are supported: `sourceProfile`, `primarySource`, `fallbackSources`, `sourceApiTokens.ads`, `sourceApiTokens.ncbi`, `citationKeyMode`, `bibliographyInsertMode`, and `defaultSearchMode`.

## Notes

- Save the active `.tex` file before running the macro.
- The macro edits the active TeXstudio buffer; the CLI writes the `.bib` file.
- If multiple `.bib` files are possible, the macro asks which one to update.
- The macro uses TeXstudio script APIs documented for 4.x: `editor.document().getRootDocument()`, `editor.text()`, `cursor.lineNumber()`, `writeFile`, `readFile`, `system`, `UniversalInputDialog`, and `cursor.setPosition`.
- This integration deliberately follows OverCite v0.3.0 behavior, not the reverted v0.3.1 raw-query patch.

## Test

```bash
cd texstudio
npm run check
npm test
npm run test:smoke
npm run install:local -- --help
```

Full regression before packaging:

```bash
cd extension && npm test && npm run build
cd ../vscode-extension && npm run check && npm test
cd ../texstudio && npm run check && npm test && npm run test:smoke
```
