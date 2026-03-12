# OverCite Technical Report

## Overview

OverCite is a Chromium extension for Overleaf that helps a user go from a rough LaTeX citation token such as `\citep{Shariat25}` to:

1. a ranked list of likely NASA ADS papers,
2. a rewritten, more informative key such as `Shariat25_10k`,
3. a BibTeX entry appended to the project bibliography,
4. and an updated citation token in the `.tex` source.

The current implementation is deterministic. It does not use an LLM. Its "context awareness" comes from:

- parsing the citation token under the cursor,
- extracting nearby TeX text around the cursor,
- building an ADS query from the typed key when possible,
- reranking returned ADS papers with lexical overlap against the local context,
- cautiously expanding the ADS search to surname variants, nearby years, and context-keyword fallback queries when needed.

This report describes how the current implementation works, what it handles well, where it is adaptive, and where it currently has limitations.

## End-to-End Flow

At a high level, OverCite does the following:

1. Detects whether the cursor is inside a `\cite...{}` command.
2. Identifies the active token within the cite list.
3. Extracts nearby context from the TeX source.
4. Parses the typed token into a surname, year, and optional suffix.
5. Builds one or more ADS search queries.
6. Fetches ADS candidates and merges unique bibcodes across fallback queries.
7. Reranks those candidates using local context.
8. Generates a proposed BibTeX key according to the current key-style setting.
9. Resolves which `.bib` file to update.
10. Exports ADS BibTeX for the selected paper.
11. Checks whether that paper is already in the bibliography.
12. Reuses an existing key if found; otherwise appends a rewritten BibTeX entry.
13. Rewrites the cite token in the `.tex` file.

## How OverCite Finds the Active Citation

OverCite looks for commands matching:

- `\cite{...}`
- `\citep{...}`
- `\citet{...}`
- other `\cite...` variants with letters or `*`
- up to two optional bracket arguments before the main `{...}`

Examples it is designed to recognize:

```tex
\cite{Shariat25}
\citep{Shariat25}
\citet[see][]{Shariat25}
\citep{Goldberg24, Shariat25, Joyce20}
```

Within a multi-citation command, it isolates only the token under the cursor.

Example:

```tex
\citep{Goldberg24, Shariat25, Joyce20}
```

If the cursor is inside `Shariat25`, OverCite uses:

- active token: `Shariat25`
- full token list: `["Goldberg24", "Shariat25", "Joyce20"]`

It does not modify the other keys in the same cite list.

## Context Extraction

OverCite uses two context views:

### 1. Sentence context

It extracts the sentence-like region around the cursor using:

- `.`
- `!`
- `?`
- blank-line boundaries

This is meant to capture the most semantically relevant local phrase.

Example:

```tex
Triples are common in the Galaxy, as shown by Gaia \citep{Shariat25}.
```

The sentence context is effectively close to:

`Triples are common in the Galaxy, as shown by Gaia \citep{Shariat25}.`

### 2. Wider context window

It also extracts a bounded character window around the cursor. The current default is:

- `contextWindowChars = 500`

The implementation clamps this to the range:

- minimum `200`
- maximum `1200`

The window is asymmetric:

- roughly 500 characters before the cursor
- roughly one third of that after the cursor

This is intended to favor the lead-in scientific context over text that follows the citation.

## Citation-Key Hint Parsing

OverCite tries to parse the current citation token into:

- `surname`
- `year`
- `suffix`

The key parser expects patterns of the form:

```text
[author-ish text][2 to 4 digits][optional suffix]
```

Its matching rule is effectively:

```text
^([A-Za-z'`.-]+?)(\d{2,4})([A-Za-z0-9_-]*)$
```

### Supported examples

| Input token | Parsed surname | Parsed year | Parsed suffix |
| --- | --- | --- | --- |
| `Shariat25` | `Shariat` | `2025` | `""` |
| `MacLeod2025` | `MacLeod` | `2025` | `""` |
| `Shariat25_10k` | `Shariat` | `2025` | `_10k` |
| `El-Badry25` | `El-Badry` | `2025` | `""` |

### Two-digit year handling

If the year has two digits, OverCite maps it into a full year in the current century, with a small future tolerance.

As of March 12, 2026:

- `25` becomes `2025`
- `26` becomes `2026`
- `29` would become `2029`
- a value too far into the future rolls back by 100 years

This is a heuristic, not a bibliography standard.

### What happens if the token does not parse

If the token does not match the expected pattern, OverCite still keeps:

- the raw token
- a normalized compact token

but sets:

- `surname = null`
- `year = null`

That means the ADS query becomes more generic.

Examples:

| Input token | Parsed surname | Parsed year | Effect |
| --- | --- | --- | --- |
| `Shariat` | `null` | `null` | Generic ADS query |
| `2025Shariat` | `null` | `null` | Generic ADS query |
| `triplepaper` | `null` | `null` | Generic ADS query |

## Hyphens, Apostrophes, and Name Formatting

This is one of the most important adaptive areas.

### Hyphenated names

Hyphens are preserved during key parsing.

Example:

- `El-Badry25` parses surname as `El-Badry`

This is good, because ADS query generation then uses:

```text
author:"El-Badry" year:2025
```

### Apostrophes and punctuation

The parser removes punctuation except hyphens when producing the parsed surname.

Examples:

| Input token | Parsed surname |
| --- | --- |
| `O'Connor25` | `OConnor` |
| `St.-Pierre25` | `St-Pierre` |

### Important limitation: hyphen omitted by the user

If the true surname is hyphenated but the user types it without the hyphen, OverCite does not fully normalize that back to the hyphenated form inside the parsed key.

Example:

- user types `ElBadry25`
- parsed surname becomes `ElBadry`
- ADS query becomes:

```text
author:"ElBadry" year:2025
```

This may still work in some ADS cases, but it is less robust than `author:"El-Badry" year:2025`.

The current version partly compensates by also trying a fallback ADS query such as:

```text
author:"El-Badry" year:2025
```

It also weakens reranking, because candidate author strings are normalized differently:

- candidate author `El-Badry, Kareem` normalizes to roughly `el badry kareem`
- typed hint `ElBadry` normalizes to roughly `elbadry`

Those do not match as well as the hyphenated form.

### Important limitation: spaces inside surnames

The parser only accepts surname text before the numeric year using letters plus punctuation. It does not explicitly support surname keys with spaces.

That means styles like:

- `Van der Marel25`
- `de Mink25`

are only usable if the user’s compact citation key omits spaces in a way that still matches the parser.

Examples:

| Input token | Likely parsed surname |
| --- | --- |
| `deMink25` | `deMink` |
| `VanDerMarel25` | `VanDerMarel` |

These will be treated literally.

## ADS Query Logic

OverCite has a primary query path plus a cautious hidden fallback strategy.

### 1. Structured author-year query

If it successfully parses both surname and year, it builds:

```text
author:"SURNAME" year:YEAR
```

Examples:

| Token | ADS query |
| --- | --- |
| `Shariat25` | `author:"Shariat" year:2025` |
| `MacLeod2025` | `author:"MacLeod" year:2025` |
| `El-Badry25` | `author:"El-Badry" year:2025` |

This is the preferred path and is the strongest query mode.

### 2. Fallback token query

If no structured surname-year hint is available, OverCite falls back to:

```text
author:"TOKEN" OR title:"TOKEN" OR abstract:"TOKEN"
```

Examples:

| Token | ADS query |
| --- | --- |
| `Shariat` | `author:"Shariat" OR title:"Shariat" OR abstract:"Shariat"` |
| `triples` | `author:"triples" OR title:"triples" OR abstract:"triples"` |

### 3. Hidden fallback query expansion

To improve robustness without changing the UI, OverCite now tries a small set of additional ADS queries when needed.

For parsed author-year keys, these can include:

- surname variants,
- adjacent years,
- author-only fallback,
- a context-keyword query built from the current sentence and local context.

Examples for a token like `ElBadry25`:

```text
author:"ElBadry" year:2025
author:"El-Badry" year:2025
author:"ElBadry" year:2024
author:"ElBadry" year:2026
author:"ElBadry"
```

If the local sentence contains words like `Gaia`, `resolved`, and `triples`, OverCite may also generate a context query of the form:

```text
(title:"gaia" OR abstract:"gaia") AND (title:"resolved" OR abstract:"resolved") AND (title:"triples" OR abstract:"triples")
```

This is still deterministic and lexical. It is intended as a safety net, not a replacement for typing a reasonable author-year hint.

### ADS fields requested

OverCite currently asks ADS for:

- `bibcode`
- `title`
- `author`
- `year`
- `abstract`
- `doi`

It currently requests up to `12` rows.

## How Reranking Works

After ADS returns candidates, OverCite reranks them locally.

This is where the nearby TeX context matters.

### Score components

Each candidate receives points from several sources.

#### Author match

- first-author match with parsed surname: `+80`
- any-author match with parsed surname: `+40`

#### Year match

- exact year match: `+60`
- weak two-digit ending match: `+20`

#### Parsed suffix overlap

If the citation token contains a suffix after the year, and that suffix appears in the title:

- suffix match in title: `+18`

Example:

- token: `Shariat25_10k`
- suffix: `_10k`
- if title contains something like `10,000`, this may help after normalization

#### Wider context keyword overlap

For each non-trivial keyword from the broader context window:

- keyword in title: `+6`
- keyword in abstract: `+1.5`

#### Sentence keyword overlap

For each non-trivial keyword from the immediate sentence:

- keyword in title: `+10`
- keyword in abstract: `+2`

This makes the sentence around the citation more influential than the general surrounding paragraph.

### Context normalization

Before matching, text is normalized by:

- Unicode decomposition
- diacritic removal
- LaTeX command stripping
- punctuation removal
- lowercasing
- whitespace collapsing

Stopwords are removed using a fixed stopword list such as:

- `the`
- `and`
- `this`
- `results`
- `paper`
- `shows`

Only tokens of length at least 3 are kept.

### Practical interpretation

This means OverCite is not doing semantic understanding in a deep sense. It is doing weighted lexical matching.

It works best when:

- the typed key already points to roughly the correct first author and year,
- the local sentence contains domain words that overlap with the target title or abstract,
- the returned ADS set is not too ambiguous.

## Worked Query and Ranking Examples

### Example 1: straightforward author-year match

Input text:

```tex
Triples are common in the Galaxy, as shown by Gaia \citep{Shariat25}.
```

Expected parse:

- surname: `Shariat`
- year: `2025`

ADS query:

```text
author:"Shariat" year:2025
```

Context keywords likely include:

- `triples`
- `galaxy`
- `gaia`

This strongly favors:

`10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations`

### Example 2: multiple citations in one command

Input:

```tex
\citep{Goldberg24, Shariat25, Joyce20}
```

If the cursor is inside `Shariat25`, only that token is queried and replaced.

Possible final result:

```tex
\citep{Goldberg24, Shariat25_10k, Joyce20}
```

### Example 3: full year

Input:

```tex
\citep{MacLeod2025}
```

Parse:

- surname: `MacLeod`
- year: `2025`

ADS query:

```text
author:"MacLeod" year:2025
```

This is handled cleanly.

### Example 4: hyphenated surname typed correctly

Input:

```tex
\citep{El-Badry25}
```

Parse:

- surname: `El-Badry`
- year: `2025`

ADS query:

```text
author:"El-Badry" year:2025
```

This is a good case for the current parser.

### Example 5: hyphenated surname typed without hyphen

Input:

```tex
\citep{ElBadry25}
```

Parse:

- surname: `ElBadry`
- year: `2025`

ADS query:

```text
author:"ElBadry" year:2025
```

This may still work if ADS search is forgiving. The current version also tries a hyphen-restored fallback query, so this case is better supported than before, but it is still weaker than typing the hyphenated surname directly.

### Example 6: vague or incomplete token

Input:

```tex
\citep{triples}
```

Parse:

- surname: `null`
- year: `null`

ADS query:

```text
author:"triples" OR title:"triples" OR abstract:"triples"
```

This is much weaker and relies more heavily on the local sentence context.

## Citation Key Generation

OverCite now supports two citation-key styles.

### 1. Informative mode

This is the default behavior.

Once the user selects a paper, OverCite proposes a BibTeX key from:

- first author family name
- last two digits of year
- one or two informative title tokens

General form:

```text
FirstAuthorYY_slug
```

### Example

For:

`10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations`

OverCite produces:

```text
Shariat25_10k
```

The title slug logic:

- keeps a leading number if it exists,
- compacts `10,000` into `10k`,
- otherwise takes the first one or two non-stopword title tokens.

Examples:

| Title | Slug |
| --- | --- |
| `10,000 Resolved Triples from Gaia...` | `10k` |
| `Standing on the Shoulders of Giants` | `standing_shoulders` |
| `A different paper` | `different_paper` |

### Duplicate key handling

If the base key already exists, OverCite tries:

- `a`, `b`, `c`, ...
- then numeric suffixes if needed

Examples:

- `Shariat25_10k`
- `Shariat25_10ka`
- `Shariat25_10kb`

### 2. Keep Typed Key mode

If the user enables `Keep Typed Key` in settings, OverCite tries to preserve the originally typed token when inserting a new BibTeX entry.

Example:

- typed token: `Shariat25`
- selected paper: `10,000 Resolved Triples from Gaia...`
- resulting key: `Shariat25`

If that key already exists, OverCite still makes it unique by appending a suffix.

Examples:

- `Shariat25`
- `Shariat25a`
- `Shariat252`

If the paper is already present in the bibliography under another key, OverCite still reuses the existing key instead of forcing the newly typed one.

## BibTeX Reuse and Deduplication

Before appending anything, OverCite checks whether the paper is already in the `.bib` file.

It deduplicates in this order:

1. DOI
2. ADS bibcode
3. normalized title

If a match is found:

- no new BibTeX is appended
- the existing key is reused

This is important because it means OverCite will not duplicate an already-inserted paper just because the user typed a rough key again.

### Example

If `references.bib` already contains the selected paper under:

```bibtex
@ARTICLE{Shariat25_10k,
  ...
}
```

and the user types:

```tex
\citep{Shariat25}
```

then OverCite should resolve to:

```tex
\citep{Shariat25_10k}
```

without appending a new entry.

## Bibliography Target Resolution

OverCite resolves the bibliography file using the following priority:

1. project override from settings
2. `\bibliography{...}` or `\addbibresource{...}` in the main TeX text
3. currently active file if it is already a `.bib`
4. the only `.bib` file in the project
5. conventional names if exactly one of `references.bib` or `refs.bib` exists
6. prompt the user if multiple candidates remain

This means OverCite is already designed to work with arbitrary `.bib` filenames such as:

- `my_library.bib`
- `astro_refs.bib`
- `catalog.bib`

It is not tied to `references.bib`. Conventional names are only used as a late fallback in ambiguous projects.

This works well for typical Overleaf projects, but it can become ambiguous in projects with many bibliographies.

## What "Adaptive" Means in the Current Version

OverCite is adaptive in a narrow but useful sense.

It adapts to:

- the token under the cursor inside a multi-citation command,
- the presence of two-digit or four-digit years,
- whether the user typed an extra suffix after the year,
- whether the user prefers informative keys or preserving the typed key,
- the scientific words in the local sentence and nearby context,
- a limited set of surname variants and adjacent-year fallback queries,
- whether the paper is already present in the bibliography,
- whether the project uses `\bibliography{...}` or `\addbibresource{...}`.

It does **not** yet adapt deeply to:

- broad misspellings of surnames,
- camel-case vs spaced family names,
- semantically equivalent but lexically different context,
- author initials or first-name disambiguation,
- multiple equally plausible papers by the same author in the same year.

## Edge Cases and Current Behavior

### Works well

- `Shariat25`
- `Shariat2025`
- `MacLeod2025`
- `El-Badry25`
- `ElBadry25` better than before because variant surname queries are now tried
- cursor inside a multi-citation list
- paper already present in `.bib`
- one obvious bibliography file

### Works but weaker

- surname only, no year
- descriptive token instead of author-year
- same-author same-year cases where context words help

### Current weak spots

- hyphenated surnames typed without hyphen
- surnames with spaces or particles if the key style is inconsistent
- apostrophe-heavy surnames where user spelling differs from the normalized form
- ambiguous author-year combinations with little contextual signal
- Overleaf UI automation for file switching, which is still the most fragile part of the pipeline

## Recommended Usage Patterns

The current version works best when the user types a rough key in one of these forms:

```tex
\citep{Shariat25}
\citep{Shariat2025}
\citep{El-Badry25}
\citep{MacLeod2025}
```

Best practices:

- include at least a recognizable family name stem,
- include a year when possible,
- trigger OverCite with the cursor inside the target key,
- keep some relevant scientific words in the local sentence,
- use a consistent author-year key style across the document.

## Limitations Worth Improving

The following upgrades would noticeably improve robustness:

### 1. Broader surname normalization variants

The current version only adds a limited set of fallback variants. It could be extended further for:

- `O'Connor` vs `OConnor`
- surname particles such as `de`, `van`, `von`
- more aggressive space and punctuation normalization

### 2. Better ambiguity handling

If many results share:

- the same first author,
- the same year,
- and weak context overlap,

the UI could surface why one candidate ranks above another.

### 3. Smarter context features

Possible improvements:

- phrase matching instead of only token matching,
- weighting nouns more strongly,
- recognizing astronomy-specific entities such as Gaia, APOGEE, TESS, Kepler, RUWE, white dwarfs, triples, etc.

## Summary

OverCite currently works as a practical, deterministic citation assistant built around:

- author-year key hint parsing,
- cautious multi-query ADS fallback search,
- nearby-text lexical reranking,
- ADS search and export,
- bibliography deduplication,
- configurable key rewriting.

Its strongest mode is when the user types a roughly correct key like:

```tex
\citep{Shariat25}
```

in a sentence whose words overlap the target paper's title or abstract.

Its weakest mode is when the user provides:

- no year,
- inconsistent surname formatting,
- or a token that is not close to an author-year key.

Even in its current form, it already handles many realistic Overleaf workflows well. The biggest remaining technical fragility is not the ranking logic itself, but the browser-side automation required to move between `main.tex` and the target `.bib` file inside Overleaf.
