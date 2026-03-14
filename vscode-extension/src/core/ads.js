import { CONTEXT_STOPWORDS } from "./constants.js";

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

export function buildAdsQuery(citationContext) {
  const hint = citationContext?.parsedKeyHint;
  if (hint?.surname && hint?.year) {
    return buildFirstAuthorYearQuery(hint.surname, hint.year);
  }
  if (hint?.surname) {
    const escapedSurname = escapeQueryValue(hint.surname);
    return `author:"${escapedSurname}"`;
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
    queries.add(buildFirstAuthorYearQuery(hint.surname, hint.year));
    const surnameVariants = buildSurnameVariants(hint.surname);
    for (const surname of surnameVariants) {
      if (hint.firstInitial) {
        queries.add(buildFirstAuthorYearInitialQuery(surname, hint.firstInitial, hint.year));
      }
      queries.add(buildFirstAuthorYearQuery(surname, hint.year));
      queries.add(`author:"${escapeQueryValue(surname)}" year:${hint.year}`);
      queries.add(`author:"${escapeQueryValue(surname)}"`);
      queries.add(buildFirstAuthorQuery(surname));
    }
    return [...queries].filter(Boolean);
  }

  if (hint?.surname) {
    const surnameVariants = buildSurnameVariants(hint.surname);
    for (const surname of surnameVariants) {
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

export function buildAdsQueries(citationContext) {
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
    ? buildFirstAuthorYearQuery(hint.surname, hint.year)
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
    ? buildFirstAuthorQuery(hint.surname)
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

export function mapAdsDocToCandidate(doc) {
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

export function rerankAdsCandidates(citationContext, candidates) {
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

      if (hint?.surname) {
        const surname = normalizeText(hint.surname);
        if (firstAuthor.includes(surname)) {
          score += 80;
        } else if (allAuthors.includes(surname)) {
          score += 40;
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

      if (citationContext?.parsedKeyHint?.surname && citationContext?.parsedKeyHint?.year && !firstAuthor.includes(normalizeText(citationContext.parsedKeyHint.surname))) {
        score -= 25;
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
