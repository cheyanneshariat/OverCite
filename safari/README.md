# Safari Support

This directory contains the Safari Web Extension wrapper for OverCite. Safari support is real, but it is still in source-build form.

## Structure

- `OverCite.xcodeproj` — Xcode project for the macOS container app and Safari extension
- `OverCite/` — macOS container app
- `OverCite Extension/` — bundled Safari extension resources and handler

The canonical browser extension source remains in `../extension/`. The Safari layer should stay thin. If shared search, parsing, or insertion logic drifts into a Safari-only fork, something has gone wrong.

## Local Testing

1. Open `OverCite.xcodeproj` in Xcode.
2. Select your Apple development team for both the app and extension targets if Xcode requests it.
3. Run the `OverCite` scheme.
4. Enable the extension in Safari -> Settings -> Extensions.
5. For unsigned local builds, enable unsigned extensions in Safari developer settings first.

## Signed vs Unsigned

- Unsigned builds are for local development and limited beta testing. Safari requires extra developer settings to run them.
- Signed builds are associated with an Apple developer identity and are the baseline for real distribution.
- For ordinary use from this repo, the main difference is that unsigned builds need the extra Safari developer setting.

## Current Status

Safari is currently documented and supported here as a local source build from this repository.

- The source build works and is testable from this repo right now.
- Safari should be described in the README as a local preview build, not a store install.
- Keep the Safari wrapper marketing version aligned with the browser release version when Safari behavior changes.

## Maintainer Notes

- Keep Safari wrapper metadata separate from Chrome, Firefox, and VS Code metadata. Do not assume those versions stay aligned automatically.
- Keep Safari app icon assets in sync with approved OverCite branding.
- Do not commit Xcode user data directories.
- Regenerate Safari bundled resources from `../extension/` after shared browser logic changes.

## Tested on

- macOS 15.5
- Safari 18.5
- Xcode 16.4
