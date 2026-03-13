# OverCite Logic Flow

This document gives a visual overview of how OverCite goes from a rough cite token in Overleaf to a selected ADS paper and an updated BibTeX entry.

## Flowchart

```mermaid
flowchart TD
  A["Cursor is inside an active \\cite token"] --> B["Parse citation hint"]
  B --> C["Extract surname"]
  B --> D["Extract year if present"]
  B --> E["Extract optional first initial"]
  B --> F["Extract optional suffix"]

  A --> G["Extract immediate sentence context"]
  A --> H["Extract wider local context window"]

  G --> I["Build phrase and keyword concepts"]
  H --> I
  C --> J["Build ADS query ladder"]
  D --> J
  E --> J
  I --> J

  J --> K["Run ADS searches"]
  K --> L["Merge unique bibcodes"]
  L --> M["Rerank candidates"]

  M --> N["First-author preference"]
  M --> O["Year preference"]
  M --> P["Sentence phrase and keyword overlap"]
  M --> Q["Title and abstract matches"]
  M --> R["Conservative morphology variants"]
  M --> S["Collaboration penalty in explicit author-year cases"]

  M --> T["Show popup results"]
  T --> U["User selects paper"]
  U --> V["Export ADS BibTeX"]
  V --> W["Resolve target bibliography file"]
  W --> X["Deduplicate or insert BibTeX entry"]
  X --> Y["Rewrite cite key in TeX"]
```

## Short Notes

- Immediate sentence context is prioritized over the wider context window.
- Author-year keys such as `Shariat25` and `Cheng25` lead with `first_author + year` queries.
- Surname-only keys such as `El-Badry`, `Li`, and `Perez Paolino` now prefer `first_author` before broader `author` fallbacks.
- Optional first initials such as `LiW25`, `JSmith05`, and `SmithJ05` can narrow common surnames.
- Multi-word surnames such as `Perez Paolino` are supported.
- Conservative morphology expansion helps retrieval for nearby scientific wording such as:
  - `mergers -> merger`
  - `binaries -> binary`
  - `lensing -> lens`
  - `afterglows -> afterglow`
