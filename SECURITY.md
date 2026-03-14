# Security

## Scope

OverCite is a local client-side tool for:

- Chrome / Chromium
- Firefox
- VS Code

It searches NASA ADS, shows ranked results, and inserts BibTeX into local or Overleaf projects.

## Security model

OverCite is designed to keep the trust boundary simple:

- no OverCite backend service
- no telemetry or analytics endpoint
- no account system
- no credential collection beyond the user-supplied NASA ADS API token

The browser extension requests access only to:

- Overleaf project pages
- the NASA ADS API

The VS Code extension operates on the open local workspace and uses the NASA ADS API.

## Data handling

Sensitive local data is intentionally minimized:

- OverCite stores settings locally
- OverCite does not persist citation-history memory
- OverCite does not collect Overleaf credentials or browser cookies
- OverCite does not upload project contents to an OverCite server

The main external data flow is direct communication with NASA ADS:

- search queries
- BibTeX export requests

## Practical limitations

This project has not undergone a formal third-party security audit.

Users should still treat it like any developer tool:

- review the source if desired
- keep API tokens private
- install updates from a trusted local copy of the repository

## Reporting a security issue

If you find a security problem, open a GitHub issue and avoid posting secrets, tokens, or private project text in the report.
