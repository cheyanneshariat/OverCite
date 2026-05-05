# TeXstudio Quick Check

This fixture tests the token-free TeXstudio path with Crossref.

1. Open `main.tex` in TeXstudio.
2. Put the cursor inside `10.1038/s41586-021-03819-2`.
3. Run `OverCite: Resolve Citation (Raw Query)`.
4. On the first run, choose `Yes, allow all calls it will ever make`.
5. Confirm the TeXstudio buffer changes to `\citep{Jumper2021}`.
6. Confirm `references.bib` contains the AlphaFold BibTeX entry.

The `.tex` file on disk changes after you save in TeXstudio. The `.bib` file is written immediately by OverCite.
