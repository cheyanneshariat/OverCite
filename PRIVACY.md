# Privacy

OverCite does not run its own backend service, analytics pipeline, or telemetry system.

## What OverCite stores

OverCite stores only local configuration needed to run:

- NASA ADS API token
- UI and behavior settings
- optional bibliography-file override settings

Browser extension:
- settings are stored in browser extension storage

VS Code extension:
- settings are stored in normal VS Code settings

OverCite does not persist:

- citation history
- search history
- accepted-paper memory
- project text outside normal editor files
- Overleaf credentials
- cookies

## What OverCite sends over the network

OverCite talks directly to NASA ADS for:

- search queries built from the current citation token and nearby sentence/context
- BibTeX export requests for the paper you select

That means the following can be sent to NASA ADS:

- author/year hints from the cite key
- keywords from the local sentence/context used for retrieval
- the selected ADS bibcode for BibTeX export

OverCite does not send this data to any OverCite-operated server, because there is no OverCite server.

## Local files

OverCite can edit:

- the active `.tex` file containing the citation
- the target `.bib` file in the same project/workspace

It does this only when you explicitly trigger the command and choose a paper.

## Current privacy posture

- no telemetry
- no third-party backend beyond NASA ADS
- no citation-memory feature
- no cloud sync service run by OverCite

If you are using the browser extension, note that browser extension settings may sync across your own signed-in browser profile, depending on browser behavior.
