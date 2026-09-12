# Rebuilding the maintenance candidate

This source snapshot is based on the frozen v7 candidate, not the repository's dirty working files. It excludes the subsequent common-surname experiments and adds the maintenance default/label changes, empty-citation routing fix, and literal-title Crossref routing regression fix.

Use Node.js 18 or later (validated here with 23.11.0). Install dependencies using the included lockfiles:

```sh
cd extension
npm ci
npm run build:chrome-firefox
npm test
cd ../vscode-extension
npm ci
npm run check
npm test
npx --no-install vsce package --no-dependencies
```

Browser upload ZIPs contain the contents of `extension/dist/chrome` or `extension/dist/firefox`, with `manifest.json` at the ZIP root. Do not ZIP the containing directory. VS Code uses the generated VSIX.

Browser UI checks: `npm run test:chrome` and `npm run test:firefox` in `extension`. They use local fixtures and isolated profiles, not real manuscripts. Playwright browsers and web-ext must be available; inspect the scripts for host-specific executable defaults.

VS Code integration: `npm run test:integration` in `vscode-extension`. The runner has a host-specific executable path; change only that path on another machine. It creates isolated profiles and local mock-provider fixtures.

Safari preview: `npm run build` in `extension` synchronizes Safari resources. Build the Xcode project using Xcode 16.4 or later; the local build was checked with signing disabled and `LANG=C LC_ALL=C`. A public Safari release additionally needs Apple signing, appropriate distribution validation and actual Safari insertion checks.

TeXstudio preview: run `npm run check`, `npm test`, and `npm run test:smoke` in `texstudio`. Run the installer only after putting the source at its intended permanent path. Its generated macros reference that path. Native macro/picker acceptance remains separate from the CLI smoke test.

The old `baseline-v7-manifest.json` describes the input snapshot only; it is not a checksum manifest for this modified source.
