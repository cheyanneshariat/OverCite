/* Safari background bundle generated from extension modules. */
const extensionApi = globalThis.browser ?? globalThis.chrome;

/* src/core/constants.js */
const MESSAGE_TYPES = Object.freeze({
  GET_SETTINGS: "getSettings",
  SAVE_SETTINGS: "saveSettings",
  SEARCH_ADS: "searchAds",
  EXPORT_BIBTEX: "exportBibtex",
  RESOLVE_BIB_TARGET: "resolveBibTarget",
  APPLY_INSERTION: "applyInsertion"
});

const DEFAULT_SETTINGS = Object.freeze({
  adsApiToken: "",
  defaultProjectBibFileOverride: {},
  contextWindowChars: 500,
  shortcutHelpText: "Alt+Shift+E",
  themeMode: "auto",
  returnToSourceAfterInsert: false,
  citationKeyMode: "authoryear",
  bibliographyInsertMode: "append",
  defaultSearchMode: "contextual"
});

const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "using",
  "with",
  "without"
]);

const CONTEXT_STOPWORDS = new Set([
  ...TITLE_STOPWORDS,
  "are",
  "be",
  "been",
  "can",
  "could",
  "did",
  "do",
  "does",
  "et",
  "find",
  "have",
  "here",
  "however",
  "important",
  "kill",
  "killed",
  "may",
  "near",
  "new",
  "our",
  "paper",
  "people",
  "recent",
  "result",
  "results",
  "show",
  "shows",
  "study",
  "studies",
  "studying",
  "that",
  "their",
  "they",
  "these",
  "this",
  "those",
  "there",
  "via",
  "was",
  "were",
  "which",
  "who",
  "work",
  "works",
  "found",
  "other",
  "others",
  "also"
]);

/* src/core/ads.js */
function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function keywordSet(value) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !CONTEXT_STOPWORDS.has(token))
  );
}

function keywordList(value) {
  return [...keywordSet(value)];
}

function expandKeywordVariants(token) {
  const raw = normalizeText(token);
  if (!raw || raw.length < 3 || CONTEXT_STOPWORDS.has(raw)) {
    return [];
  }

  const variants = new Set([raw]);

  if (raw.length >= 5 && raw.endsWith("ies")) {
    variants.add(`${raw.slice(0, -3)}y`);
  } else if (raw.length >= 5 && raw.endsWith("ing")) {
    const stripped = raw.slice(0, -3);
    if (stripped.length >= 3) {
      if (stripped.endsWith("s") || stripped.endsWith("y")) {
        variants.add(stripped);
      } else if (/[kgtvz]$/.test(stripped)) {
        variants.add(`${stripped}e`);
      } else {
        variants.add(stripped);
      }
    }
  } else if (raw.length >= 4 && raw.endsWith("s") && !raw.endsWith("ss")) {
    const singular = raw.slice(0, -1);
    if (singular.length >= 3) {
      variants.add(singular);
    }
  }

  return [...variants].filter((variant) => variant.length >= 3 && !CONTEXT_STOPWORDS.has(variant));
}

function keywordConcepts(value) {
  return keywordList(value).map((token) => expandKeywordVariants(token));
}

function escapeQueryValue(value) {
  return String(value ?? "").replace(/"/g, '\\"');
}

function isAuthorLikeToken(token) {
  const normalized = String(token ?? "").trim().replace(/[{}\s]/g, "");
  return /^[A-Za-z'`.-]{3,}$/.test(normalized);
}

function buildSurnameVariants(surname) {
  const raw = String(surname ?? "").trim();
  if (!raw) {
    return [];
  }
  const variants = new Set([raw]);
  const withoutPunctuation = raw.replace(/['`.\s]/g, "");
  if (withoutPunctuation) {
    variants.add(withoutPunctuation);
  }
  if (raw.includes("-")) {
    variants.add(raw.replace(/-/g, ""));
  } else {
    const camelCaseHyphenated = raw.replace(/([a-z])([A-Z])/g, "$1-$2");
    if (camelCaseHyphenated !== raw) {
      variants.add(camelCaseHyphenated);
    }
  }
  return [...variants].filter(Boolean);
}

function buildContextKeywordQuery(citationContext) {
  const sentenceConcepts = keywordConcepts(citationContext?.sentenceText ?? "").slice(0, 5);
  const concepts = [...sentenceConcepts];
  if (concepts.length < 2) {
    const contextConcepts = keywordConcepts(citationContext?.contextText ?? "")
      .filter((concept) => !concept.some((token) => sentenceConcepts.flat().includes(token)))
      .slice(0, 4 - concepts.length);
    concepts.push(...contextConcepts);
  }
  if (concepts.length < 2) {
    return null;
  }
  return concepts
    .map((concept) => concept.map((token) => `full:"${escapeQueryValue(token)}"`).join(" OR "))
    .map((group) => conceptNeedsParens(group) ? `(${group})` : group)
    .join(" AND ");
}

function buildTitleAbstractKeywordQuery(citationContext) {
  const sentenceConcepts = keywordConcepts(citationContext?.sentenceText ?? "").slice(0, 5);
  const concepts = [...sentenceConcepts];
  if (concepts.length < 2) {
    const contextConcepts = keywordConcepts(citationContext?.contextText ?? "")
      .filter((concept) => !concept.some((token) => sentenceConcepts.flat().includes(token)))
      .slice(0, 4 - concepts.length);
    concepts.push(...contextConcepts);
  }
  if (concepts.length < 2) {
    return null;
  }
  return concepts
    .map((concept) =>
      concept
        .map((token) => `title:"${escapeQueryValue(token)}" OR abstract:"${escapeQueryValue(token)}"`)
        .join(" OR ")
    )
    .map((group) => `(${group})`)
    .join(" AND ");
}

function conceptNeedsParens(groupQuery) {
  return groupQuery.includes(" OR ");
}

function buildSentencePhrase(citationContext) {
  const tokens = keywordList(citationContext?.sentenceText ?? "");
  if (tokens.length < 2) {
    return null;
  }
  return tokens.slice(0, 6).join(" ");
}

function buildLeadingKeywordPhrase(citationContext) {
  const tokens = keywordList(citationContext?.sentenceText ?? "");
  if (tokens.length < 2) {
    return null;
  }
  return tokens.slice(0, Math.min(3, tokens.length)).join(" ");
}

function buildTrailingKeywordPhrase(citationContext) {
  const tokens = keywordList(citationContext?.sentenceText ?? "");
  if (tokens.length < 2) {
    return null;
  }
  return tokens.slice(Math.max(0, tokens.length - 2)).join(" ");
}

function buildSentencePhraseQuery(citationContext) {
  const phrase = buildSentencePhrase(citationContext);
  if (!phrase) {
    return null;
  }
  return `full:"${escapeQueryValue(phrase)}"`;
}

function buildSentenceTitleAbstractPhraseQuery(citationContext) {
  const phrase = buildSentencePhrase(citationContext);
  if (!phrase) {
    return null;
  }
  const escapedPhrase = escapeQueryValue(phrase);
  return `title:"${escapedPhrase}" OR abstract:"${escapedPhrase}"`;
}

function buildLeadingTitleAbstractPhraseQuery(citationContext) {
  const phrase = buildLeadingKeywordPhrase(citationContext);
  if (!phrase) {
    return null;
  }
  const escapedPhrase = escapeQueryValue(phrase);
  return `title:"${escapedPhrase}" OR abstract:"${escapedPhrase}"`;
}

function buildTrailingTitleAbstractPhraseQuery(citationContext) {
  const phrase = buildTrailingKeywordPhrase(citationContext);
  if (!phrase) {
    return null;
  }
  const escapedPhrase = escapeQueryValue(phrase);
  return `title:"${escapedPhrase}" OR abstract:"${escapedPhrase}"`;
}

function buildLeadTrailTitleAbstractQuery(citationContext) {
  const leadingPhrase = buildLeadingKeywordPhrase(citationContext);
  const trailingPhrase = buildTrailingKeywordPhrase(citationContext);
  if (!leadingPhrase || !trailingPhrase || leadingPhrase === trailingPhrase) {
    return null;
  }
  const escapedLeadingPhrase = escapeQueryValue(leadingPhrase);
  const escapedTrailingPhrase = escapeQueryValue(trailingPhrase);
  return `(title:"${escapedLeadingPhrase}" OR abstract:"${escapedLeadingPhrase}") AND (title:"${escapedTrailingPhrase}" OR abstract:"${escapedTrailingPhrase}")`;
}

function buildFirstAuthorYearTitleAbstractKeywordQuery(surname, year, citationContext) {
  const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
  if (!surname || !year || !keywordQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${keywordQuery}`;
}

function buildFirstAuthorYearInitialTitleAbstractKeywordQuery(surname, firstInitial, year, citationContext) {
  const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
  if (!surname || !firstInitial || !year || !keywordQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND ${keywordQuery}`;
}

function buildAuthorContextQuery(surname, citationContext) {
  const contextQuery = buildContextKeywordQuery(citationContext);
  if (!surname || !contextQuery) {
    return null;
  }
  return `author:"${escapeQueryValue(surname)}" AND ${contextQuery}`;
}

function buildAuthorTitleAbstractKeywordQuery(surname, citationContext) {
  const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
  if (!surname || !keywordQuery) {
    return null;
  }
  return `author:"${escapeQueryValue(surname)}" AND ${keywordQuery}`;
}

function buildAuthorSentencePhraseQuery(surname, citationContext) {
  const phraseQuery = buildSentencePhraseQuery(citationContext);
  if (!surname || !phraseQuery) {
    return null;
  }
  return `author:"${escapeQueryValue(surname)}" AND ${phraseQuery}`;
}

function buildAuthorTitleAbstractPhraseQuery(surname, citationContext) {
  const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
  if (!surname || !phraseQuery) {
    return null;
  }
  return `author:"${escapeQueryValue(surname)}" AND (${phraseQuery})`;
}

function buildFirstAuthorQuery(surname) {
  if (!surname) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}"`;
}

function buildCollaborationNameVariants(surname) {
  const hint = parseCollaborationHint(surname);
  const base = hint?.base ?? String(surname ?? "").trim();
  if (!base) {
    return [];
  }
  return [...new Set([
    `${base} Collaboration`,
    `${base} Scientific Collaboration`,
    hint?.explicitName ?? null
  ].filter(Boolean))];
}

function parseCollaborationHint(surname) {
  const raw = String(surname ?? "").trim();
  if (!raw) {
    return null;
  }
  const spaced = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const match = spaced.match(/^(.*?)(?:\s+(Scientific))?\s+Collaboration$/i);
  if (!match) {
    return null;
  }
  const base = String(match[1] ?? "").trim();
  if (!base) {
    return null;
  }
  const isScientific = Boolean(match[2]);
  return {
    base,
    explicitName: isScientific ? `${base} Scientific Collaboration` : `${base} Collaboration`
  };
}

function buildHintSurnameMatchVariants(surname) {
  const raw = normalizeText(surname);
  const hint = parseCollaborationHint(surname);
  if (!hint) {
    return raw ? [raw] : [];
  }
  return [...new Set([
    raw,
    normalizeText(hint.base),
    normalizeText(`${hint.base} Collaboration`),
    normalizeText(`${hint.base} Scientific Collaboration`)
  ].filter(Boolean))];
}

function buildFirstAuthorOrCollaborationYearQuery(surname, year) {
  if (!surname || !year) {
    return null;
  }
  const baseSurname = parseCollaborationHint(surname)?.base ?? surname;
  const collaborationClauses = buildCollaborationNameVariants(surname)
    .map((name) => `author:"${escapeQueryValue(name)}"`);
  const joined = [`first_author:"${escapeQueryValue(baseSurname)}"`, ...collaborationClauses]
    .filter(Boolean)
    .map((clause) => `(${clause})`)
    .join(" OR ");
  return `(${joined}) year:${year}`;
}

function buildFirstAuthorOrCollaborationQuery(surname) {
  if (!surname) {
    return null;
  }
  const baseSurname = parseCollaborationHint(surname)?.base ?? surname;
  const collaborationClauses = buildCollaborationNameVariants(surname)
    .map((name) => `author:"${escapeQueryValue(name)}"`);
  return [`first_author:"${escapeQueryValue(baseSurname)}"`, ...collaborationClauses]
    .filter(Boolean)
    .map((clause) => `(${clause})`)
    .join(" OR ");
}

function buildFirstAuthorTitleAbstractPhraseQuery(surname, citationContext) {
  const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
  if (!surname || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" AND (${phraseQuery})`;
}

function buildFirstAuthorLeadingTitleAbstractPhraseQuery(surname, citationContext) {
  const phraseQuery = buildLeadingTitleAbstractPhraseQuery(citationContext);
  if (!surname || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" AND (${phraseQuery})`;
}

function buildFirstAuthorSentencePhraseQuery(surname, citationContext) {
  const phraseQuery = buildSentencePhraseQuery(citationContext);
  if (!surname || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" AND ${phraseQuery}`;
}

function buildFirstAuthorTitleAbstractKeywordQuery(surname, citationContext) {
  const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
  if (!surname || !keywordQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" AND ${keywordQuery}`;
}

function buildFirstAuthorContextQuery(surname, citationContext) {
  const contextQuery = buildContextKeywordQuery(citationContext);
  if (!surname || !contextQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" AND ${contextQuery}`;
}

function buildFirstAuthorYearQuery(surname, year) {
  if (!surname || !year) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" year:${year}`;
}

function buildFirstAuthorYearInitialQuery(surname, firstInitial, year) {
  if (!surname || !firstInitial || !year) {
    return null;
  }
  return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year}`;
}

function buildFirstAuthorYearSentencePhraseQuery(surname, year, citationContext) {
  const phraseQuery = buildSentencePhraseQuery(citationContext);
  if (!surname || !year || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${phraseQuery}`;
}

function buildFirstAuthorYearInitialSentencePhraseQuery(surname, firstInitial, year, citationContext) {
  const phraseQuery = buildSentencePhraseQuery(citationContext);
  if (!surname || !firstInitial || !year || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND ${phraseQuery}`;
}

function buildFirstAuthorYearTitleAbstractPhraseQuery(surname, year, citationContext) {
  const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
  if (!surname || !year || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" year:${year} AND (${phraseQuery})`;
}

function buildFirstAuthorYearInitialTitleAbstractPhraseQuery(surname, firstInitial, year, citationContext) {
  const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
  if (!surname || !firstInitial || !year || !phraseQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND (${phraseQuery})`;
}

function buildFirstAuthorYearContextQuery(surname, year, citationContext) {
  const contextQuery = buildContextKeywordQuery(citationContext);
  if (!surname || !year || !contextQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${contextQuery}`;
}

function buildFirstAuthorYearInitialContextQuery(surname, firstInitial, year, citationContext) {
  const contextQuery = buildContextKeywordQuery(citationContext);
  if (!surname || !firstInitial || !year || !contextQuery) {
    return null;
  }
  return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND ${contextQuery}`;
}

function buildAdsQuery(citationContext) {
  const hint = citationContext?.parsedKeyHint;
  if (hint?.surname && hint?.year) {
    return buildFirstAuthorOrCollaborationYearQuery(hint.surname, hint.year);
  }
  if (hint?.surname) {
    return buildFirstAuthorOrCollaborationQuery(hint.surname);
  }

  const token = String(citationContext?.token ?? "").trim();
  if (!token) {
    return "property:refereed";
  }
  if (isAuthorLikeToken(token)) {
    return `author:"${escapeQueryValue(token)}"`;
  }

  const escaped = token.replace(/"/g, '\\"');
  return `title:"${escaped}" OR abstract:"${escaped}"`;
}

function buildSimpleAdsQueries(citationContext) {
  const queries = new Set();
  const hint = citationContext?.parsedKeyHint;
  const token = String(citationContext?.token ?? "").trim();

  if (hint?.surname && hint?.year) {
    if (hint.firstInitial) {
      queries.add(buildFirstAuthorYearInitialQuery(hint.surname, hint.firstInitial, hint.year));
    }
    queries.add(buildFirstAuthorOrCollaborationYearQuery(hint.surname, hint.year));
    queries.add(buildFirstAuthorYearQuery(hint.surname, hint.year));
    const surnameVariants = buildSurnameVariants(hint.surname);
    for (const surname of surnameVariants) {
      if (hint.firstInitial) {
        queries.add(buildFirstAuthorYearInitialQuery(surname, hint.firstInitial, hint.year));
      }
      queries.add(buildFirstAuthorOrCollaborationYearQuery(surname, hint.year));
      queries.add(buildFirstAuthorYearQuery(surname, hint.year));
      queries.add(`author:"${escapeQueryValue(surname)}" year:${hint.year}`);
      queries.add(`author:"${escapeQueryValue(surname)}"`);
      queries.add(buildFirstAuthorOrCollaborationQuery(surname));
      queries.add(buildFirstAuthorQuery(surname));
    }
    return [...queries].filter(Boolean);
  }

  if (hint?.surname) {
    const surnameVariants = buildSurnameVariants(hint.surname);
    for (const surname of surnameVariants) {
      queries.add(buildFirstAuthorOrCollaborationQuery(surname));
      queries.add(buildFirstAuthorQuery(surname));
      queries.add(`author:"${escapeQueryValue(surname)}"`);
    }
    return [...queries].filter(Boolean);
  }

  queries.add(buildAdsQuery(citationContext));
  if (isAuthorLikeToken(token)) {
    queries.add(`author:"${escapeQueryValue(token)}"`);
  }
  return [...queries].filter(Boolean);
}

function buildDirectAdsQueries(citationContext) {
  const token = String(citationContext?.token ?? "").trim();
  if (!token) {
    return [];
  }
  return [token];
}

function buildAdsQueries(citationContext) {
  if (citationContext?.searchMode === "direct") {
    return buildDirectAdsQueries(citationContext);
  }
  if (citationContext?.searchMode === "simple") {
    return buildSimpleAdsQueries(citationContext);
  }
  const queries = new Set();
  const hint = citationContext?.parsedKeyHint;
  const token = String(citationContext?.token ?? "").trim();
  const isEmptyTokenLookup = !token;
  const primaryQuery = buildAdsQuery(citationContext);
  const contextQuery = buildContextKeywordQuery(citationContext);
  const sentencePhraseQuery = buildSentencePhraseQuery(citationContext);
  const sentenceTitleAbstractPhraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
  const leadingTitleAbstractPhraseQuery = buildLeadingTitleAbstractPhraseQuery(citationContext);
  const trailingTitleAbstractPhraseQuery = buildTrailingTitleAbstractPhraseQuery(citationContext);
  const leadTrailTitleAbstractQuery = buildLeadTrailTitleAbstractQuery(citationContext);
  const primaryAuthorContextQuery = hint?.surname
    ? buildAuthorContextQuery(hint.surname, citationContext)
    : null;
  const primaryAuthorPhraseQuery = hint?.surname
    ? buildAuthorSentencePhraseQuery(hint.surname, citationContext)
    : null;
  const primaryAuthorTitleAbstractPhraseQuery = hint?.surname
    ? buildAuthorTitleAbstractPhraseQuery(hint.surname, citationContext)
    : null;
  const primaryFirstAuthorYearQuery = hint?.surname && hint?.year
    ? buildFirstAuthorOrCollaborationYearQuery(hint.surname, hint.year)
    : null;
  const primaryFirstAuthorYearInitialQuery = hint?.surname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialQuery(hint.surname, hint.firstInitial, hint.year)
    : null;
  const primaryFirstAuthorYearPhraseQuery = hint?.surname && hint?.year
    ? buildFirstAuthorYearSentencePhraseQuery(hint.surname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialPhraseQuery = hint?.surname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialSentencePhraseQuery(hint.surname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearTitleAbstractPhraseQuery = hint?.surname && hint?.year
    ? buildFirstAuthorYearTitleAbstractPhraseQuery(hint.surname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialTitleAbstractPhraseQuery = hint?.surname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialTitleAbstractPhraseQuery(hint.surname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearContextQuery = hint?.surname && hint?.year
    ? buildFirstAuthorYearContextQuery(hint.surname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialContextQuery = hint?.surname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialContextQuery(hint.surname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearTitleAbstractKeywordQuery = hint?.surname && hint?.year
    ? buildFirstAuthorYearTitleAbstractKeywordQuery(hint.surname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialTitleAbstractKeywordQuery = hint?.surname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialTitleAbstractKeywordQuery(hint.surname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryAuthorTitleAbstractKeywordQuery = hint?.surname
    ? buildAuthorTitleAbstractKeywordQuery(hint.surname, citationContext)
    : null;
  const primaryFirstAuthorQuery = hint?.surname
    ? buildFirstAuthorOrCollaborationQuery(hint.surname)
    : null;
  const primaryFirstAuthorPhraseQuery = hint?.surname
    ? buildFirstAuthorSentencePhraseQuery(hint.surname, citationContext)
    : null;
  const primaryFirstAuthorTitleAbstractPhraseQuery = hint?.surname
    ? buildFirstAuthorTitleAbstractPhraseQuery(hint.surname, citationContext)
    : null;
  const primaryFirstAuthorLeadingTitleAbstractPhraseQuery = hint?.surname
    ? buildFirstAuthorLeadingTitleAbstractPhraseQuery(hint.surname, citationContext)
    : null;
  const primaryFirstAuthorTitleAbstractKeywordQuery = hint?.surname
    ? buildFirstAuthorTitleAbstractKeywordQuery(hint.surname, citationContext)
    : null;
  const primaryFirstAuthorContextQuery = hint?.surname
    ? buildFirstAuthorContextQuery(hint.surname, citationContext)
    : null;
  const titleAbstractKeywordQuery = buildTitleAbstractKeywordQuery(citationContext);

  if (isEmptyTokenLookup) {
    if (leadTrailTitleAbstractQuery) {
      queries.add(leadTrailTitleAbstractQuery);
    }
    if (leadingTitleAbstractPhraseQuery) {
      queries.add(leadingTitleAbstractPhraseQuery);
    }
    if (trailingTitleAbstractPhraseQuery) {
      queries.add(trailingTitleAbstractPhraseQuery);
    }
    if (titleAbstractKeywordQuery) {
      queries.add(titleAbstractKeywordQuery);
    }
    if (sentenceTitleAbstractPhraseQuery) {
      queries.add(sentenceTitleAbstractPhraseQuery);
    }
    if (sentencePhraseQuery) {
      queries.add(sentencePhraseQuery);
    }
    if (contextQuery) {
      queries.add(contextQuery);
    }
    queries.add(primaryQuery);
  } else if (hint?.surname && hint?.year) {
    if (primaryFirstAuthorYearInitialTitleAbstractPhraseQuery) {
      queries.add(primaryFirstAuthorYearInitialTitleAbstractPhraseQuery);
    }
    if (primaryFirstAuthorYearTitleAbstractPhraseQuery) {
      queries.add(primaryFirstAuthorYearTitleAbstractPhraseQuery);
    }
    if (primaryFirstAuthorYearInitialTitleAbstractKeywordQuery) {
      queries.add(primaryFirstAuthorYearInitialTitleAbstractKeywordQuery);
    }
    if (primaryFirstAuthorYearTitleAbstractKeywordQuery) {
      queries.add(primaryFirstAuthorYearTitleAbstractKeywordQuery);
    }
    if (primaryFirstAuthorYearInitialPhraseQuery) {
      queries.add(primaryFirstAuthorYearInitialPhraseQuery);
    }
    if (primaryFirstAuthorYearPhraseQuery) {
      queries.add(primaryFirstAuthorYearPhraseQuery);
    }
    if (primaryFirstAuthorYearInitialQuery) {
      queries.add(primaryFirstAuthorYearInitialQuery);
    }
    if (primaryFirstAuthorYearQuery) {
      queries.add(primaryFirstAuthorYearQuery);
    }
    if (primaryFirstAuthorYearInitialContextQuery) {
      queries.add(primaryFirstAuthorYearInitialContextQuery);
    }
    if (primaryFirstAuthorYearContextQuery) {
      queries.add(primaryFirstAuthorYearContextQuery);
    }
    queries.add(primaryQuery);
    if (primaryAuthorTitleAbstractPhraseQuery) {
      queries.add(primaryAuthorTitleAbstractPhraseQuery);
    }
    if (primaryAuthorTitleAbstractKeywordQuery) {
      queries.add(primaryAuthorTitleAbstractKeywordQuery);
    }
    if (primaryAuthorPhraseQuery) {
      queries.add(primaryAuthorPhraseQuery);
    }
    if (primaryAuthorContextQuery) {
      queries.add(primaryAuthorContextQuery);
    }
    if (sentenceTitleAbstractPhraseQuery) {
      queries.add(sentenceTitleAbstractPhraseQuery);
    }
    if (leadingTitleAbstractPhraseQuery) {
      queries.add(leadingTitleAbstractPhraseQuery);
    }
    if (sentencePhraseQuery) {
      queries.add(sentencePhraseQuery);
    }
    if (contextQuery) {
      queries.add(contextQuery);
    }
  } else if (hint?.surname && !hint?.year && primaryAuthorPhraseQuery) {
    if (primaryFirstAuthorLeadingTitleAbstractPhraseQuery) {
      queries.add(primaryFirstAuthorLeadingTitleAbstractPhraseQuery);
    }
    if (primaryFirstAuthorTitleAbstractPhraseQuery) {
      queries.add(primaryFirstAuthorTitleAbstractPhraseQuery);
    }
    if (primaryFirstAuthorTitleAbstractKeywordQuery) {
      queries.add(primaryFirstAuthorTitleAbstractKeywordQuery);
    }
    if (primaryFirstAuthorPhraseQuery) {
      queries.add(primaryFirstAuthorPhraseQuery);
    }
    if (primaryFirstAuthorContextQuery) {
      queries.add(primaryFirstAuthorContextQuery);
    }
    if (primaryFirstAuthorQuery) {
      queries.add(primaryFirstAuthorQuery);
    }
    if (sentenceTitleAbstractPhraseQuery) {
      queries.add(sentenceTitleAbstractPhraseQuery);
    }
    if (leadingTitleAbstractPhraseQuery) {
      queries.add(leadingTitleAbstractPhraseQuery);
    }
    if (primaryAuthorTitleAbstractPhraseQuery) {
      queries.add(primaryAuthorTitleAbstractPhraseQuery);
    }
    if (primaryAuthorTitleAbstractKeywordQuery) {
      queries.add(primaryAuthorTitleAbstractKeywordQuery);
    }
    if (titleAbstractKeywordQuery) {
      queries.add(titleAbstractKeywordQuery);
    }
    queries.add(primaryAuthorPhraseQuery);
    if (sentencePhraseQuery) {
      queries.add(sentencePhraseQuery);
    }
    if (primaryAuthorContextQuery) {
      queries.add(primaryAuthorContextQuery);
    }
    queries.add(primaryQuery);
  } else {
    queries.add(primaryQuery);
    if (sentencePhraseQuery) {
      queries.add(sentencePhraseQuery);
    }
    if (contextQuery) {
      queries.add(contextQuery);
    }
  }

  if (hint?.surname) {
    const surnameVariants = buildSurnameVariants(hint.surname);
    for (const surname of surnameVariants) {
      if (!hint.year) {
        const firstAuthorLeadingTitleAbstractPhraseQuery = buildFirstAuthorLeadingTitleAbstractPhraseQuery(surname, citationContext);
        if (firstAuthorLeadingTitleAbstractPhraseQuery) {
          queries.add(firstAuthorLeadingTitleAbstractPhraseQuery);
        }
        const firstAuthorTitleAbstractPhraseQuery = buildFirstAuthorTitleAbstractPhraseQuery(surname, citationContext);
        if (firstAuthorTitleAbstractPhraseQuery) {
          queries.add(firstAuthorTitleAbstractPhraseQuery);
        }
        const firstAuthorTitleAbstractKeywordQuery = buildFirstAuthorTitleAbstractKeywordQuery(surname, citationContext);
        if (firstAuthorTitleAbstractKeywordQuery) {
          queries.add(firstAuthorTitleAbstractKeywordQuery);
        }
        const firstAuthorPhraseQuery = buildFirstAuthorSentencePhraseQuery(surname, citationContext);
        if (firstAuthorPhraseQuery) {
          queries.add(firstAuthorPhraseQuery);
        }
        const firstAuthorContextQuery = buildFirstAuthorContextQuery(surname, citationContext);
        if (firstAuthorContextQuery) {
          queries.add(firstAuthorContextQuery);
        }
        const firstAuthorQuery = buildFirstAuthorQuery(surname);
        if (firstAuthorQuery) {
          queries.add(firstAuthorQuery);
        }
      }
      const authorTitleAbstractPhraseQuery = buildAuthorTitleAbstractPhraseQuery(surname, citationContext);
      if (authorTitleAbstractPhraseQuery) {
        queries.add(authorTitleAbstractPhraseQuery);
      }
      const authorPhraseQuery = buildAuthorSentencePhraseQuery(surname, citationContext);
      if (authorPhraseQuery) {
        queries.add(authorPhraseQuery);
      }
      const authorContextQuery = buildAuthorContextQuery(surname, citationContext);
      if (authorContextQuery) {
        queries.add(authorContextQuery);
      }
      if (hint.year) {
        if (hint.firstInitial) {
          const firstAuthorYearInitialTitleAbstractPhraseQuery = buildFirstAuthorYearInitialTitleAbstractPhraseQuery(surname, hint.firstInitial, hint.year, citationContext);
          if (firstAuthorYearInitialTitleAbstractPhraseQuery) {
            queries.add(firstAuthorYearInitialTitleAbstractPhraseQuery);
          }
          const firstAuthorYearInitialPhraseQuery = buildFirstAuthorYearInitialSentencePhraseQuery(surname, hint.firstInitial, hint.year, citationContext);
          if (firstAuthorYearInitialPhraseQuery) {
            queries.add(firstAuthorYearInitialPhraseQuery);
          }
          const firstAuthorYearInitialContextQuery = buildFirstAuthorYearInitialContextQuery(surname, hint.firstInitial, hint.year, citationContext);
          if (firstAuthorYearInitialContextQuery) {
            queries.add(firstAuthorYearInitialContextQuery);
          }
          const firstAuthorYearInitialQuery = buildFirstAuthorYearInitialQuery(surname, hint.firstInitial, hint.year);
          if (firstAuthorYearInitialQuery) {
            queries.add(firstAuthorYearInitialQuery);
          }
        }
        const firstAuthorYearTitleAbstractPhraseQuery = buildFirstAuthorYearTitleAbstractPhraseQuery(surname, hint.year, citationContext);
        if (firstAuthorYearTitleAbstractPhraseQuery) {
          queries.add(firstAuthorYearTitleAbstractPhraseQuery);
        }
        const firstAuthorYearPhraseQuery = buildFirstAuthorYearSentencePhraseQuery(surname, hint.year, citationContext);
        if (firstAuthorYearPhraseQuery) {
          queries.add(firstAuthorYearPhraseQuery);
        }
        const firstAuthorYearContextQuery = buildFirstAuthorYearContextQuery(surname, hint.year, citationContext);
        if (firstAuthorYearContextQuery) {
          queries.add(firstAuthorYearContextQuery);
        }
        const years = [hint.year, hint.year - 1, hint.year + 1];
        for (const year of years) {
          const firstAuthorYearQuery = buildFirstAuthorYearQuery(surname, year);
          if (firstAuthorYearQuery) {
            queries.add(firstAuthorYearQuery);
          }
          queries.add(`author:"${escapeQueryValue(surname)}" year:${year}`);
        }
      }
      queries.add(`author:"${escapeQueryValue(surname)}"`);
    }
  }

  if (sentenceTitleAbstractPhraseQuery) {
    queries.add(sentenceTitleAbstractPhraseQuery);
  }
  if (leadingTitleAbstractPhraseQuery) {
    queries.add(leadingTitleAbstractPhraseQuery);
  }
  if (trailingTitleAbstractPhraseQuery) {
    queries.add(trailingTitleAbstractPhraseQuery);
  }
  if (leadTrailTitleAbstractQuery) {
    queries.add(leadTrailTitleAbstractQuery);
  }
  if (titleAbstractKeywordQuery) {
    queries.add(titleAbstractKeywordQuery);
  }
  if (sentencePhraseQuery) {
    queries.add(sentencePhraseQuery);
  }
  if (contextQuery) {
    queries.add(contextQuery);
  }

  return [...queries].filter(Boolean);
}

function mapAdsDocToCandidate(doc) {
  return {
    bibcode: doc.bibcode,
    title: Array.isArray(doc.title) ? doc.title[0] : String(doc.title ?? ""),
    authors: Array.isArray(doc.author) ? doc.author : [],
    year: doc.year ? Number(doc.year) : null,
    abstract: String(doc.abstract ?? ""),
    doi: Array.isArray(doc.doi) ? doc.doi[0] : doc.doi ?? null,
    citationCount: Number(doc.citation_count ?? 0) || 0,
    score: 0,
    generatedKey: null
  };
}

function rerankAdsCandidates(citationContext, candidates) {
  if (citationContext?.searchMode === "direct") {
    return rerankDirectAdsCandidates(citationContext, candidates);
  }
  if (citationContext?.searchMode === "simple") {
    return rerankSimpleAdsCandidates(citationContext, candidates);
  }
  const hint = citationContext?.parsedKeyHint;
  const token = String(citationContext?.token ?? "").trim();
  const isEmptyTokenLookup = !token;
  const contextKeywordConcepts = keywordConcepts(citationContext?.contextText ?? "");
  const sentenceKeywordConcepts = keywordConcepts(citationContext?.sentenceText ?? "");
  const sentencePhrase = normalizeText(buildSentencePhrase(citationContext) ?? "");
  const leadingPhrase = normalizeText(buildLeadingKeywordPhrase(citationContext) ?? "");
  const trailingPhrase = normalizeText(buildTrailingKeywordPhrase(citationContext) ?? "");

  return candidates
    .map((candidate) => {
      let score = 0;
      const titleText = normalizeText(candidate.title);
      const abstractText = normalizeText(candidate.abstract);
      const firstAuthor = normalizeText(candidate.authors[0] ?? "");
      const allAuthors = normalizeText(candidate.authors.join(" "));
      const collaborationFirstAuthor = /collaboration/.test(firstAuthor);

      if (hint?.surname) {
        const surnameVariants = buildHintSurnameMatchVariants(hint.surname);
        const baseSurname = normalizeText(parseCollaborationHint(hint.surname)?.base ?? hint.surname);
        const matchesFirstAuthor = surnameVariants.some((surname) => firstAuthor.includes(surname));
        const matchesAnyAuthor = surnameVariants.some((surname) => allAuthors.includes(surname));
        if (matchesFirstAuthor) {
          score += 80;
        } else if (matchesAnyAuthor) {
          score += 40;
        }
        if (collaborationFirstAuthor && baseSurname && firstAuthor.startsWith(baseSurname)) {
          score += 36;
        }
      }

      if (hint?.firstInitial) {
        const firstInitial = normalizeText(hint.firstInitial);
        if (firstInitial && firstAuthor.startsWith(`${normalizeText(hint.surname)} ${firstInitial}`)) {
          score += 22;
        } else if (firstInitial && firstAuthor.includes(` ${firstInitial}`)) {
          score += 8;
        }
      }

      if (citationContext?.parsedKeyHint?.surname && citationContext?.parsedKeyHint?.year) {
        const surnameVariants = buildHintSurnameMatchVariants(citationContext.parsedKeyHint.surname);
        if (!surnameVariants.some((surname) => firstAuthor.includes(surname))) {
          score -= 25;
        }
      }

      if (/collaboration/.test(firstAuthor) || /collaboration/.test(allAuthors)) {
        score -= 30;
      }

      if (hint?.year && candidate.year === hint.year) {
        score += 60;
      } else if (hint?.year && candidate.year && String(candidate.year).endsWith(String(hint.year).slice(-2))) {
        score += 20;
      }

      if (hint?.suffix) {
        const suffix = normalizeText(hint.suffix);
        if (suffix && titleText.includes(suffix)) {
          score += 18;
        }
      }

      if (sentencePhrase) {
        if (titleText.includes(sentencePhrase)) {
          score += 55;
        } else if (abstractText.includes(sentencePhrase)) {
          score += 14;
        }
      }

      if (leadingPhrase) {
        if (titleText.includes(leadingPhrase)) {
          score += isEmptyTokenLookup ? 32 : 16;
        } else if (abstractText.includes(leadingPhrase)) {
          score += isEmptyTokenLookup ? 10 : 5;
        }
      }

      if (trailingPhrase) {
        if (titleText.includes(trailingPhrase)) {
          score += isEmptyTokenLookup ? 32 : 16;
        } else if (abstractText.includes(trailingPhrase)) {
          score += isEmptyTokenLookup ? 10 : 5;
        }
      }

      for (const concept of contextKeywordConcepts) {
        if (concept.some((token) => titleText.includes(token))) {
          score += 6;
        } else if (concept.some((token) => abstractText.includes(token))) {
          score += 1.5;
        }
      }

      for (const concept of sentenceKeywordConcepts) {
        if (concept.some((token) => titleText.includes(token))) {
          score += 10;
        } else if (concept.some((token) => abstractText.includes(token))) {
          score += 2;
        }
      }

      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score || compareYears(right.year, left.year));
}

function rerankDirectAdsCandidates(citationContext, candidates) {
  const token = normalizeText(citationContext?.token ?? "");
  return candidates
    .map((candidate, index) => {
      let score = 0;
      const titleText = normalizeText(candidate.title);
      const abstractText = normalizeText(candidate.abstract);
      const authorsText = normalizeText(candidate.authors.join(" "));

      if (token) {
        if (titleText.includes(token)) {
          score += 6;
        }
        if (authorsText.includes(token)) {
          score += 4;
        }
        if (abstractText.includes(token)) {
          score += 2;
        }
      }

      return { ...candidate, score, originalIndex: index };
    })
    .sort((left, right) =>
      right.score - left.score ||
      left.originalIndex - right.originalIndex
    )
    .map(({ originalIndex, ...candidate }) => candidate);
}

function rerankSimpleAdsCandidates(citationContext, candidates) {
  const hint = citationContext?.parsedKeyHint;
  return candidates
    .map((candidate) => {
      let score = 0;
      const firstAuthor = normalizeText(candidate.authors[0] ?? "");
      const allAuthors = normalizeText(candidate.authors.join(" "));
      let satisfiesPrimaryAuthor = true;
      let satisfiesPrimaryYear = true;

      if (hint?.surname) {
        const surname = normalizeText(hint.surname);
        if (firstAuthor.includes(surname)) {
          score += 120;
        } else if (allAuthors.includes(surname)) {
          score += 40;
          satisfiesPrimaryAuthor = false;
        } else {
          satisfiesPrimaryAuthor = false;
        }
      }

      if (hint?.firstInitial) {
        const firstInitial = normalizeText(hint.firstInitial);
        if (firstInitial && firstAuthor.startsWith(`${normalizeText(hint.surname)} ${firstInitial}`)) {
          score += 20;
        } else {
          satisfiesPrimaryAuthor = false;
        }
      }

      if (hint?.year && candidate.year === hint.year) {
        score += 40;
      } else if (hint?.year && candidate.year && Math.abs(candidate.year - hint.year) === 1) {
        score += 10;
        satisfiesPrimaryYear = false;
      } else if (hint?.year) {
        satisfiesPrimaryYear = false;
      }

      const matchesPrimaryConstraints = satisfiesPrimaryAuthor && satisfiesPrimaryYear;
      if (!matchesPrimaryConstraints) {
        score -= 5000;
      }

      score += Math.min(candidate.citationCount || 0, 2000);
      return { ...candidate, score, matchesPrimaryConstraints };
    })
    .sort((left, right) =>
      Number(Boolean(right.matchesPrimaryConstraints)) - Number(Boolean(left.matchesPrimaryConstraints)) ||
      right.score - left.score ||
      (right.citationCount || 0) - (left.citationCount || 0) ||
      compareYears(right.year, left.year)
    );
}

function compareYears(leftYear, rightYear) {
  const left = Number(leftYear) || 0;
  const right = Number(rightYear) || 0;
  return left - right;
}

/* src/core/bibtex.js */
function toAscii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLooseText(value) {
  return toAscii(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function extractFirstAuthorFamily(authors) {
  const first = Array.isArray(authors) ? authors[0] : "";
  const raw = String(first ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (!raw.trim()) {
    return "Citation";
  }
  if (raw.includes(",")) {
    return toAscii(raw.split(",")[0]).replace(/\s+/g, "") || "Citation";
  }
  const collaborationFamily = extractCollaborationFamily(raw);
  if (collaborationFamily) {
    return collaborationFamily;
  }
  const normalized = toAscii(raw);
  const pieces = normalized.split(" ").filter(Boolean);
  return pieces[pieces.length - 1] ?? "Citation";
}

function extractCollaborationFamily(raw) {
  const normalized = toAscii(raw);
  if (!normalized) {
    return "";
  }
  const pieces = normalized.split(" ").filter(Boolean);
  const keywordIndex = pieces.findIndex((piece) => /^(collaboration|consortium|team|group)$/i.test(piece));
  if (keywordIndex <= 0) {
    return "";
  }
  const familyPieces = pieces
    .slice(0, keywordIndex)
    .filter((piece) => !/^(the|scientific)$/i.test(piece));
  return familyPieces.join("");
}

function compactLeadingNumber(numberText) {
  const digits = numberText.replace(/[^\d.]/g, "");
  const numeric = Number(digits);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return digits;
  }
  if (numeric >= 1000 && numeric % 1000 === 0) {
    return `${numeric / 1000}k`;
  }
  return String(Math.round(numeric));
}

function buildTitleSlug(title) {
  const rawTitle = String(title ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const leadingNumberMatch = rawTitle.match(/^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/);
  if (leadingNumberMatch) {
    return compactLeadingNumber(leadingNumberMatch[1]).toLowerCase();
  }

  const asciiTitle = toAscii(rawTitle);
  if (!asciiTitle) {
    return "";
  }

  const tokens = asciiTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !TITLE_STOPWORDS.has(token));
  return tokens.slice(0, 2).join("_");
}

function ensureUniqueKey(baseKey, existingKeys) {
  const keys = new Set(existingKeys);
  if (!keys.has(baseKey)) {
    return baseKey;
  }
  const suffixLetters = "abcdefghijklmnopqrstuvwxyz";
  for (const letter of suffixLetters) {
    const candidate = `${baseKey}${letter}`;
    if (!keys.has(candidate)) {
      return candidate;
    }
  }
  let counter = 2;
  while (keys.has(`${baseKey}${counter}`)) {
    counter += 1;
  }
  return `${baseKey}${counter}`;
}

function generateInformativeKey(candidate, existingKeys = []) {
  const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
  const year = candidate?.year ? String(candidate.year).slice(-2) : "xx";
  const slug = buildTitleSlug(candidate?.title ?? "");
  const base = slug ? `${family}${year}_${slug}` : `${family}${year}`;
  return ensureUniqueKey(base, existingKeys);
}

function generateAuthorYearKey(candidate, existingKeys = []) {
  const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
  const year = candidate?.year ? String(candidate.year) : "";
  const base = `${family}${year}` || "Citation";
  return ensureUniqueKey(base, existingKeys);
}

function generateBibcodeKey(candidate, existingKeys = []) {
  const bibcode = String(candidate?.bibcode ?? "").trim();
  if (!bibcode) {
    return generateAuthorYearKey(candidate, existingKeys);
  }
  return ensureUniqueKey(bibcode, existingKeys);
}

function sanitizeTypedTokenKey(rawToken) {
  return String(rawToken ?? "")
    .trim()
    .replace(/[{}\s]/g, "")
    .replace(/[^A-Za-z0-9_.:-]/g, "");
}

function generatePreferredKey(candidate, existingKeys = [], options = {}) {
  const keyMode = String(options?.keyMode ?? "authoryear");
  if (keyMode === "typed") {
    const typedBase = sanitizeTypedTokenKey(options?.typedToken);
    if (typedBase) {
      return ensureUniqueKey(typedBase, existingKeys);
    }
  }
  if (keyMode === "bibcode") {
    return generateBibcodeKey(candidate, existingKeys);
  }
  if (keyMode === "informative") {
    return generateInformativeKey(candidate, existingKeys);
  }
  if (keyMode === "authoryear") {
    return generateAuthorYearKey(candidate, existingKeys);
  }
  return generateInformativeKey(candidate, existingKeys);
}

function parseFieldValue(entryText, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*=\\s*(\\{([^]*?)\\}|\"([^]*?)\")`, "i");
  const match = entryText.match(regex);
  if (!match) {
    return null;
  }
  return (match[2] ?? match[3] ?? "").replace(/\s+/g, " ").trim();
}

function extractBibcodeFromAdsUrl(adsUrl) {
  if (!adsUrl) {
    return null;
  }
  const match = adsUrl.match(/\/abs\/([^/?#]+)/);
  return match ? match[1] : null;
}

function parseBibEntries(bibText) {
  const entries = [];
  let index = 0;
  while (index < bibText.length) {
    const entryStart = bibText.indexOf("@", index);
    if (entryStart < 0) {
      break;
    }
    const openBrace = bibText.indexOf("{", entryStart);
    if (openBrace < 0) {
      break;
    }
    const header = bibText.slice(entryStart + 1, openBrace).trim();
    const type = header.split(/\s+/)[0];
    const commaIndex = bibText.indexOf(",", openBrace);
    if (commaIndex < 0) {
      break;
    }
    const key = bibText.slice(openBrace + 1, commaIndex).trim();
    let depth = 1;
    let cursor = openBrace + 1;
    while (cursor < bibText.length && depth > 0) {
      const char = bibText[cursor];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
      cursor += 1;
    }
    const raw = bibText.slice(entryStart, cursor).trim();
    entries.push({
      type,
      key,
      raw,
      start: entryStart,
      end: cursor,
      doi: normalizeLooseText(parseFieldValue(raw, "doi")),
      title: normalizeLooseText(parseFieldValue(raw, "title")),
      adsurl: parseFieldValue(raw, "adsurl"),
      bibcode: normalizeLooseText(extractBibcodeFromAdsUrl(parseFieldValue(raw, "adsurl"))),
      year: parseFieldValue(raw, "year")
    });
    index = cursor;
  }
  return entries;
}

function rewriteBibtexKey(bibtex, nextKey) {
  return bibtex.replace(/^(@[A-Za-z]+\s*[{(]\s*)([^,]+)(,)/, `$1${nextKey}$3`);
}

function findBibMatch(entries, candidate) {
  const normalizedDoi = normalizeLooseText(candidate?.doi);
  if (normalizedDoi) {
    const doiMatch = entries.find((entry) => entry.doi && entry.doi === normalizedDoi);
    if (doiMatch) {
      return { key: doiMatch.key, reason: "doi" };
    }
  }

  const normalizedBibcode = normalizeLooseText(candidate?.bibcode);
  if (normalizedBibcode) {
    const bibcodeMatch = entries.find((entry) => entry.bibcode && entry.bibcode === normalizedBibcode);
    if (bibcodeMatch) {
      return { key: bibcodeMatch.key, reason: "bibcode" };
    }
  }

  const normalizedTitle = normalizeLooseText(candidate?.title);
  if (normalizedTitle) {
    const titleMatch = entries.find((entry) => entry.title && entry.title === normalizedTitle);
    if (titleMatch) {
      return { key: titleMatch.key, reason: "title" };
    }
  }

  return null;
}

function appendBibtexEntry(bibText, entryText) {
  const trimmedText = bibText.trimEnd();
  const trimmedEntry = entryText.trim();
  if (!trimmedText) {
    return `${trimmedEntry}\n`;
  }
  return `${trimmedText}\n\n${trimmedEntry}\n`;
}

function compareKeys(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
}

function insertBibtexEntryAlphabetically(bibText, entryText, finalKey) {
  const entries = parseBibEntries(bibText);
  if (!entries.length) {
    return appendBibtexEntry(bibText, entryText);
  }

  const insertBefore = entries.find((entry) => compareKeys(finalKey, entry.key) < 0);
  if (!insertBefore) {
    return appendBibtexEntry(bibText, entryText);
  }

  const trimmedEntry = entryText.trim();
  const before = bibText.slice(0, insertBefore.start).trimEnd();
  const after = bibText.slice(insertBefore.start).trimStart();

  if (!before) {
    return `${trimmedEntry}\n\n${after}\n`;
  }
  return `${before}\n\n${trimmedEntry}\n\n${after}\n`;
}

function computeInsertionResult(updatedBibText, rewrittenBibtex) {
  const normalizedEntry = String(rewrittenBibtex ?? "").trim();
  const start = updatedBibText.indexOf(normalizedEntry);
  const cursorAnchor = start >= 0 ? start + normalizedEntry.length : updatedBibText.length;
  return {
    updatedBibText,
    insertionRange: {
      start: Math.max(0, start),
      end: cursorAnchor
    },
    cursorAnchor
  };
}

function applyBibInsertion({ bibText, bibtex, candidate }) {
  const entries = parseBibEntries(bibText);
  const match = findBibMatch(entries, candidate);
  if (match) {
    return {
      finalKey: match.key,
      match,
      updatedBibText: bibText,
      rewrittenBibtex: null,
      insertionRange: null,
      cursorAnchor: null
    };
  }

  const existingKeys = entries.map((entry) => entry.key);
  const finalKey = generatePreferredKey(candidate, existingKeys, {
    keyMode: candidate?.keyMode,
    typedToken: candidate?.typedToken
  });
  const rewrittenBibtex = rewriteBibtexKey(bibtex, finalKey);
  const insertMode = String(candidate?.bibliographyInsertMode ?? "append").toLowerCase();
  const updatedBibText = insertMode === "alphabetical"
    ? insertBibtexEntryAlphabetically(bibText, rewrittenBibtex, finalKey)
    : appendBibtexEntry(bibText, rewrittenBibtex);
  const insertionResult = computeInsertionResult(updatedBibText, rewrittenBibtex);
  return {
    finalKey,
    match: null,
    updatedBibText: insertionResult.updatedBibText,
    rewrittenBibtex,
    insertionRange: insertionResult.insertionRange,
    cursorAnchor: insertionResult.cursorAnchor
  };
}

/* src/core/project.js */
function resolveBibTargetFromProjectState(projectState = {}) {
  const {
    mainText = "",
    activeFileName = "",
    projectFiles = [],
    projectId = "",
    overrides = {}
  } = projectState;

  const normalizedFiles = [...new Set(projectFiles.filter(Boolean))];
  const bibFiles = normalizedFiles.filter((name) => /\.bib$/i.test(name));

  const override = projectId ? overrides[projectId] : null;
  if (override && bibFiles.includes(override)) {
    return { status: "resolved", target: override, candidates: bibFiles };
  }

  const bibliographyMatches = extractBibliographyTargets(mainText);
  if (bibliographyMatches.length) {
    const directCandidates = bibliographyMatches
      .map((name) => (name.toLowerCase().endsWith(".bib") ? name : `${name}.bib`))
      .filter((name) => bibFiles.includes(name));
    if (directCandidates.length === 1) {
      return { status: "resolved", target: directCandidates[0], candidates: bibFiles };
    }
    if (directCandidates.length > 1) {
      return { status: "needs-choice", target: null, candidates: directCandidates };
    }
  }

  if (/\.bib$/i.test(activeFileName)) {
    return { status: "resolved", target: activeFileName, candidates: bibFiles };
  }

  if (bibFiles.length === 1) {
    return { status: "resolved", target: bibFiles[0], candidates: bibFiles };
  }

  const conventionalNames = bibFiles.filter((name) => /^(references|refs)\.bib$/i.test(name));
  if (conventionalNames.length === 1) {
    return { status: "resolved", target: conventionalNames[0], candidates: bibFiles };
  }

  if (bibFiles.length > 1) {
    return { status: "needs-choice", target: null, candidates: bibFiles };
  }

  return { status: "not-found", target: null, candidates: [] };
}

function extractBibliographyTargets(mainText) {
  const targets = [];
  const bibliographyRegex = /\\bibliography\s*\{([^}]+)\}/g;
  const addBibResourceRegex = /\\addbibresource\s*\{([^}]+)\}/g;

  for (const regex of [bibliographyRegex, addBibResourceRegex]) {
    let match;
    while ((match = regex.exec(mainText)) !== null) {
      const pieces = match[1].split(",").map((piece) => piece.trim()).filter(Boolean);
      targets.push(...pieces);
    }
  }

  return [...new Set(targets)];
}

/* src/core/settings.js */
function getStorageArea() {
  if (extensionApi?.storage?.sync) {
    return extensionApi.storage.sync;
  }
  return null;
}

async function getSettings() {
  const storage = getStorageArea();
  if (!storage) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const stored = await storage.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

async function saveSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);
  const storage = getStorageArea();
  if (storage) {
    await storage.set(normalized);
  }
  return normalized;
}

function normalizeSettings(rawSettings = {}) {
  let overrides = rawSettings.defaultProjectBibFileOverride ?? DEFAULT_SETTINGS.defaultProjectBibFileOverride;
  if (typeof overrides === "string") {
    try {
      overrides = JSON.parse(overrides);
    } catch {
      overrides = {};
    }
  }
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    overrides = {};
  }
  const contextWindowChars = Number(rawSettings.contextWindowChars ?? DEFAULT_SETTINGS.contextWindowChars);
  const themeMode = normalizeThemeMode(rawSettings.themeMode);
  const citationKeyMode = normalizeCitationKeyMode(rawSettings.citationKeyMode);
  const bibliographyInsertMode = normalizeBibliographyInsertMode(rawSettings.bibliographyInsertMode);
  const defaultSearchMode = normalizeDefaultSearchMode(rawSettings.defaultSearchMode);
  return {
    adsApiToken: String(rawSettings.adsApiToken ?? DEFAULT_SETTINGS.adsApiToken).trim(),
    defaultProjectBibFileOverride: overrides,
    contextWindowChars: Number.isFinite(contextWindowChars) ? Math.min(1200, Math.max(200, contextWindowChars)) : DEFAULT_SETTINGS.contextWindowChars,
    shortcutHelpText: String(rawSettings.shortcutHelpText ?? DEFAULT_SETTINGS.shortcutHelpText).trim() || DEFAULT_SETTINGS.shortcutHelpText,
    themeMode,
    returnToSourceAfterInsert: false,
    citationKeyMode,
    bibliographyInsertMode,
    defaultSearchMode
  };
}

function normalizeThemeMode(themeMode) {
  const normalized = String(themeMode ?? DEFAULT_SETTINGS.themeMode).trim().toLowerCase();
  if (normalized === "light" || normalized === "dark" || normalized === "auto") {
    return normalized;
  }
  return DEFAULT_SETTINGS.themeMode;
}

function normalizeCitationKeyMode(citationKeyMode) {
  const normalized = String(citationKeyMode ?? DEFAULT_SETTINGS.citationKeyMode).trim().toLowerCase();
  if (normalized === "authoryear" || normalized === "informative" || normalized === "typed" || normalized === "bibcode") {
    return normalized;
  }
  return DEFAULT_SETTINGS.citationKeyMode;
}

function normalizeBibliographyInsertMode(bibliographyInsertMode) {
  const normalized = String(bibliographyInsertMode ?? DEFAULT_SETTINGS.bibliographyInsertMode).trim().toLowerCase();
  if (normalized === "append" || normalized === "alphabetical") {
    return normalized;
  }
  return DEFAULT_SETTINGS.bibliographyInsertMode;
}

function normalizeDefaultSearchMode(defaultSearchMode) {
  const normalized = String(defaultSearchMode ?? DEFAULT_SETTINGS.defaultSearchMode).trim().toLowerCase();
  if (normalized === "contextual" || normalized === "simple" || normalized === "direct") {
    return normalized;
  }
  return DEFAULT_SETTINGS.defaultSearchMode;
}

/* src/background.js */
extensionApi.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await saveSettings({ ...DEFAULT_SETTINGS, ...settings });
});

extensionApi.commands.onCommand.addListener((command) => {
  if (command !== "open-ezcite") {
    return;
  }
  void openOverlayForActiveTab().catch((error) => {
    console.error("[OverCite background] openOverlayForActiveTab failed", error);
  });
});

extensionApi.action.onClicked.addListener((tab) => {
  if (!tab?.id || !tab.url?.startsWith("https://www.overleaf.com/project/")) {
    return;
  }
  void safeSendMessageToTab(tab.id, { type: "ezcite:openOverlay" }).catch((error) => {
    console.error("[OverCite background] toolbar sendMessage failed", error);
  });
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case MESSAGE_TYPES.GET_SETTINGS:
      return getSettings();
    case MESSAGE_TYPES.SAVE_SETTINGS:
      return saveSettings(message.settings);
    case MESSAGE_TYPES.SEARCH_ADS:
      return searchAds(message.citationContext);
    case MESSAGE_TYPES.EXPORT_BIBTEX:
      return exportBibtex(message.bibcode);
    case MESSAGE_TYPES.RESOLVE_BIB_TARGET: {
      const settings = await getSettings();
      return resolveBibTargetFromProjectState({
        ...message.projectState,
        overrides: settings.defaultProjectBibFileOverride
      });
    }
    case MESSAGE_TYPES.APPLY_INSERTION:
      return applyBibInsertion(message.payload);
    default:
      throw new Error(`Unknown OverCite message type: ${message?.type ?? "undefined"}`);
  }
}

async function searchAds(citationContext) {
  const settings = await getSettings();
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Open OverCite settings and add one.");
  }

  const queries = buildAdsQueries(citationContext);
  const mergedDocs = await fetchSearchCandidates(queries, citationContext, settings.adsApiToken);

  const candidates = mergedDocs.map(mapAdsDocToCandidate);
  const finalCandidates = rerankAdsCandidates(citationContext, candidates);
  return finalCandidates.map((candidate) => ({
    ...candidate,
    keyMode: settings.citationKeyMode,
    typedToken: citationContext?.token ?? "",
    generatedKey: generatePreferredKey(candidate, [], {
      keyMode: settings.citationKeyMode,
      typedToken: citationContext?.token ?? ""
    })
  }));
}

async function fetchSearchCandidates(queries, citationContext, adsApiToken) {
  const mergedDocs = [];
  const seenBibcodes = new Set();
  const initialQueries = citationContext?.searchMode === "simple" ? queries.slice(0, 1) : queries.slice(0, 2);

  if (initialQueries.length) {
    const initialBatches = await Promise.all(initialQueries.map((query) => fetchAdsDocs(query, adsApiToken)));
    for (const [index, docs] of initialBatches.entries()) {
      mergeDocs(mergedDocs, seenBibcodes, docs, index);
    }
  }

  const initialIndex = initialQueries.length - 1;
  if (initialQueries.length && shouldStopAfterQuery(initialIndex, mergedDocs.length, citationContext)) {
    return mergedDocs;
  }

  for (const [offset, query] of queries.slice(initialQueries.length).entries()) {
    const index = offset + initialQueries.length;
    const docs = await fetchAdsDocs(query, adsApiToken);
    mergeDocs(mergedDocs, seenBibcodes, docs, index);
    if (shouldStopAfterQuery(index, mergedDocs.length, citationContext)) {
      break;
    }
  }

  return mergedDocs;
}

function mergeDocs(target, seenBibcodes, docs, queryIndex) {
  for (const doc of docs) {
    const bibcode = doc?.bibcode ?? `row-${queryIndex}-${target.length}`;
    if (seenBibcodes.has(bibcode)) {
      continue;
    }
    seenBibcodes.add(bibcode);
    target.push(doc);
  }
}

function shouldStopAfterQuery(index, mergedCount, citationContext) {
  const hasExplicitYear = Boolean(citationContext?.parsedKeyHint?.year);
  if (hasExplicitYear && index === 0 && mergedCount >= 6) {
    return true;
  }
  if (hasExplicitYear && index >= 3 && mergedCount >= 6) {
    return true;
  }
  const isSurnameOnlyHint = Boolean(citationContext?.parsedKeyHint?.surname) && !hasExplicitYear;
  if (isSurnameOnlyHint && index < 2) {
    return false;
  }
  return mergedCount >= 12;
}

async function exportBibtex(bibcode) {
  const settings = await getSettings();
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Open OverCite settings and add one.");
  }
  if (!bibcode) {
    throw new Error("Missing ADS bibcode.");
  }

  const response = await fetch("https://api.adsabs.harvard.edu/v1/export/bibtex", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.adsApiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ bibcode: [bibcode] })
  });

  if (!response.ok) {
    throw new Error(`ADS BibTeX export failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload.export?.trim?.() ?? "";
}

async function fetchAdsDocs(query, adsApiToken) {
  const url = new URL("https://api.adsabs.harvard.edu/v1/search/query");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi,citation_count");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${adsApiToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`ADS search failed with status ${response.status}`);
  }

  const payload = await response.json();
  return payload?.response?.docs ?? [];
}

async function openOverlayForActiveTab() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.overleaf.com/project/")) {
    return false;
  }
  return safeSendMessageToTab(tab.id, { type: "ezcite:openOverlay" });
}

async function safeSendMessageToTab(tabId, message) {
  try {
    await extensionApi.tabs.sendMessage(tabId, message);
  } catch (error) {
    const errorMessage = String(error?.message ?? error ?? "");
    if (errorMessage.includes("Receiving end does not exist")) {
      console.warn("[OverCite background] no content script receiver for tab", {
        tabId,
        messageType: message?.type ?? null
      });
      return false;
    }
    throw error;
  }
  return true;
}

