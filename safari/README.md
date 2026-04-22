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
- For broad public release outside local testing, use a signed build. For direct downloads, that should also be notarized.

## Public Release Path

Keep Safari officially unpublished until these are true:

1. The Safari wrapper version matches the browser release being shipped.
2. The app icon and extension icon surfaces use approved OverCite artwork.
3. Manual Overleaf checks pass for contextual search, simple search, ADS query, cite-key rewrite, and bibliography insertion.
4. A signed Release archive installs cleanly on a machine that has not enabled unsigned-extension development settings.

Current repo state:

- The source build works and is testable from this repo right now.
- The browser extension release version should stay aligned with the Safari wrapper marketing version once Safari is shipped publicly.
- Do not advertise Safari like a normal store install until a signed distribution path actually exists.

Two viable public distribution routes:

- Mac App Store / App Store Connect
  This is the closest Safari equivalent to the Chrome Web Store or Firefox Add-ons flow.
- Developer ID signed and notarized direct download
  This supports distribution from a website or GitHub release without requiring users to enable unsigned-extension developer settings.

## Maintainer Notes

- Keep Safari wrapper metadata separate from Chrome, Firefox, and VS Code metadata. Do not assume those versions stay aligned automatically.
- Keep Safari app icon assets in sync with approved OverCite branding.
- Do not commit Xcode user data directories.
- Regenerate Safari bundled resources from `../extension/` after shared browser logic changes.

## Tested on

- macOS 15.5
- Safari 18.5
- Xcode 16.4
