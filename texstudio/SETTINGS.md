# OverCite TeXstudio Settings

TeXstudio uses a JSON settings file:

```text
~/.overcite/texstudio-settings.json
```

Open it from TeXstudio with `Macros` -> `OverCite: Open Settings`, or use the default shortcut `Alt+Shift+O`.

Settings are loaded in this order. Later layers override earlier layers:

1. `~/.overcite/texstudio-settings.json`
2. project `.overcite.json`
3. project `.overcite-texstudio.json`
4. settings sent by the macro request
5. environment token fallbacks

Use project `.overcite-texstudio.json` when one paper or project needs different settings from your global defaults.

## Common Settings

```json
{
  "sourceProfile": "astrophysics",
  "adsApiToken": "",
  "ncbiApiKey": "",
  "contextWindowChars": 500,
  "citationKeyMode": "authoryear",
  "bibliographyInsertMode": "append",
  "defaultSearchMode": "contextual",
  "projectBibFileOverrides": {}
}
```

## All Options

| Setting | Values | Meaning |
| --- | --- | --- |
| `sourceProfile` | `astrophysics`, `physics`, `math`, `computer-science`, `life-sciences`, `chemistry`, `general`, `custom` | Subject-area preset. Start here unless you know you need custom routing. |
| `primarySource` | `ads`, `pubmed`, `crossref`, `arxiv`, `inspire`, `datacite` | Primary source when `sourceProfile` is `custom`. |
| `fallbackSources` | array of `ads`, `pubmed`, `crossref`, `arxiv`, `inspire`, `datacite` | Backup sources when `sourceProfile` is `custom`. Keep this short. |
| `adsApiToken` | string | ADS/SciX token for astronomy/physics searches. |
| `ncbiApiKey` | string | Optional NCBI API key for higher-rate PubMed requests. |
| `sourceApiTokens.ads` | string | Advanced equivalent of `adsApiToken`. |
| `sourceApiTokens.ncbi` | string | Advanced equivalent of `ncbiApiKey`. |
| `contextWindowChars` | number from `200` to `1200` | Nearby text used for contextual lookups. |
| `citationKeyMode` | `authoryear`, `authoryear-underscore`, `authoryear-colon`, `informative`, `bibcode`, `typed` | Citation key style. |
| `bibliographyInsertMode` | `append`, `alphabetical` | Where new BibTeX entries are inserted. |
| `defaultSearchMode` | `contextual`, `simple`, `direct` | Mode used by the main `OverCite: Resolve Citation` macro. |
| `projectBibFileOverrides` | object | Optional project-folder-to-`.bib` mapping for unusual projects. |

## Source Profiles

| Profile | Default routing |
| --- | --- |
| `astrophysics` | ADS/SciX |
| `physics` | INSPIRE, then Crossref |
| `math` | arXiv, then Crossref |
| `computer-science` | arXiv, then Crossref |
| `life-sciences` | PubMed, then Crossref |
| `chemistry` | Crossref |
| `general` | Crossref, then DataCite |
| `custom` | Uses `primarySource` and `fallbackSources` |

## Custom Routing Example

Only use `primarySource` and `fallbackSources` with `"sourceProfile": "custom"`.

```json
{
  "sourceProfile": "custom",
  "primarySource": "crossref",
  "fallbackSources": ["arxiv", "datacite"]
}
```

## Citation Key Modes

| Mode | Example |
| --- | --- |
| `authoryear` | `Shariat2025` |
| `authoryear-underscore` | `Shariat_2025` |
| `authoryear-colon` | `Shariat:2025` |
| `informative` | `Shariat25_Triples` |
| `bibcode` | `2025PASP..137i4201S` |
| `typed` | Keeps the typed key when possible |

## Environment Fallbacks

If a token is not in the JSON file, TeXstudio also checks:

```text
OVERCITE_ADS_API_TOKEN
NCBI_API_KEY
```

The canonical settings reference is also on GitHub:

```text
https://github.com/cheyanneshariat/OverCite/blob/main/texstudio/SETTINGS.md
```
