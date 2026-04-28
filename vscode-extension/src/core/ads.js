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
  const variants = new Set();
  const collaborationHint = parseCollaborationHint(raw);
  if (!raw.includes("-") && !/\s/.test(raw) && !collaborationHint) {
    const camelCaseHyphenated = raw.replace(/([a-z])([A-Z])/g, "$1-$2");
    if (camelCaseHyphenated !== raw) {
      variants.add(camelCaseHyphenated);
    }
  }
  variants.add(raw);
  const withoutPunctuation = raw.replace(/['`.\s]/g, "");
  if (withoutPunctuation) {
    variants.add(withoutPunctuation);
  }
  if (raw.includes("-")) {
    variants.add(raw.replace(/-/g, ""));
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

function authorNameMatchesSurnameVariant(authorText, surnameVariant) {
  const author = normalizeText(authorText);
  const surname = normalizeText(surnameVariant);
  if (!author || !surname) {
    return false;
  }
  return author === surname || author.startsWith(`${surname} `) || author.endsWith(` ${surname}`);
}

function authorNameMatchesSurnameVariants(authorText, surnameVariants) {
  return surnameVariants.some((surname) => authorNameMatchesSurnameVariant(authorText, surname));
}

function firstAuthorInitialMatches(firstAuthorText, surname, firstInitial) {
  const author = normalizeText(firstAuthorText);
  const family = normalizeText(surname);
  const initial = normalizeText(firstInitial).slice(0, 1);
  if (!author || !family || !initial) {
    return false;
  }
  const tokens = author.split(/\s+/).filter(Boolean);
  const familyTokens = family.split(/\s+/).filter(Boolean);
  if (!tokens.length || !familyTokens.length) {
    return false;
  }
  const startsWithFamily = familyTokens.every((token, index) => tokens[index] === token);
  if (startsWithFamily) {
    const given = tokens[familyTokens.length] ?? "";
    return given.startsWith(initial);
  }
  const familyStart = tokens.length - familyTokens.length;
  const endsWithFamily = familyStart > 0 && familyTokens.every((token, index) => tokens[familyStart + index] === token);
  if (endsWithFamily) {
    return tokens[0]?.startsWith(initial) ?? false;
  }
  return false;
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

export function buildAdsQuery(citationContext) {
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
  const doi = directDoiToken(token);
  if (doi) {
    return [`doi:"${escapeQueryValue(doi)}"`];
  }
  const arxivId = directArxivToken(token);
  if (arxivId) {
    return [`identifier:${arxivId}`];
  }
  if (isFieldedAdsQuery(token)) {
    return [token];
  }
  return [token];
}

function isFieldedAdsQuery(token) {
  return /\b(?:abs|abstract|author|bibcode|doi|identifier|title|year|arxiv):/i.test(token);
}

function directDoiToken(token) {
  const normalized = String(token ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : "";
}

function directArxivToken(token) {
  const value = String(token ?? "").trim();
  const modern = value.match(/^(?:arxiv:|https?:\/\/arxiv\.org\/abs\/)?(\d{4}\.\d{4,5})(?:v\d+)?$/i);
  if (modern) {
    return modern[1];
  }
  const legacy = value.match(/^(?:arxiv:|https?:\/\/arxiv\.org\/abs\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i);
  return legacy?.[1] ?? "";
}

export function buildAdsQueries(citationContext) {
  if (citationContext?.searchMode === "direct") {
    return buildDirectAdsQueries(citationContext);
  }
  if (citationContext?.searchMode === "simple") {
    return buildSimpleAdsQueries(citationContext);
  }
  const queries = new Set();
  const hint = citationContext?.parsedKeyHint;
  const primarySurname = hint?.surname
    ? (buildSurnameVariants(hint.surname)[0] ?? hint.surname)
    : null;
  const token = String(citationContext?.token ?? "").trim();
  const isEmptyTokenLookup = !token;
  const primaryQuery = buildAdsQuery(citationContext);
  const contextQuery = buildContextKeywordQuery(citationContext);
  const sentencePhraseQuery = buildSentencePhraseQuery(citationContext);
  const sentenceTitleAbstractPhraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
  const leadingTitleAbstractPhraseQuery = buildLeadingTitleAbstractPhraseQuery(citationContext);
  const trailingTitleAbstractPhraseQuery = buildTrailingTitleAbstractPhraseQuery(citationContext);
  const leadTrailTitleAbstractQuery = buildLeadTrailTitleAbstractQuery(citationContext);
  const primaryAuthorContextQuery = primarySurname
    ? buildAuthorContextQuery(primarySurname, citationContext)
    : null;
  const primaryAuthorPhraseQuery = primarySurname
    ? buildAuthorSentencePhraseQuery(primarySurname, citationContext)
    : null;
  const primaryAuthorTitleAbstractPhraseQuery = primarySurname
    ? buildAuthorTitleAbstractPhraseQuery(primarySurname, citationContext)
    : null;
  const primaryFirstAuthorYearQuery = primarySurname && hint?.year
    ? buildFirstAuthorOrCollaborationYearQuery(primarySurname, hint.year)
    : null;
  const primaryFirstAuthorYearInitialQuery = primarySurname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialQuery(primarySurname, hint.firstInitial, hint.year)
    : null;
  const primaryFirstAuthorYearPhraseQuery = primarySurname && hint?.year
    ? buildFirstAuthorYearSentencePhraseQuery(primarySurname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialPhraseQuery = primarySurname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialSentencePhraseQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearTitleAbstractPhraseQuery = primarySurname && hint?.year
    ? buildFirstAuthorYearTitleAbstractPhraseQuery(primarySurname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialTitleAbstractPhraseQuery = primarySurname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialTitleAbstractPhraseQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearContextQuery = primarySurname && hint?.year
    ? buildFirstAuthorYearContextQuery(primarySurname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialContextQuery = primarySurname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialContextQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearTitleAbstractKeywordQuery = primarySurname && hint?.year
    ? buildFirstAuthorYearTitleAbstractKeywordQuery(primarySurname, hint.year, citationContext)
    : null;
  const primaryFirstAuthorYearInitialTitleAbstractKeywordQuery = primarySurname && hint?.firstInitial && hint?.year
    ? buildFirstAuthorYearInitialTitleAbstractKeywordQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
    : null;
  const primaryAuthorTitleAbstractKeywordQuery = primarySurname
    ? buildAuthorTitleAbstractKeywordQuery(primarySurname, citationContext)
    : null;
  const primaryFirstAuthorQuery = primarySurname
    ? buildFirstAuthorOrCollaborationQuery(primarySurname)
    : null;
  const primaryFirstAuthorPhraseQuery = primarySurname
    ? buildFirstAuthorSentencePhraseQuery(primarySurname, citationContext)
    : null;
  const primaryFirstAuthorTitleAbstractPhraseQuery = primarySurname
    ? buildFirstAuthorTitleAbstractPhraseQuery(primarySurname, citationContext)
    : null;
  const primaryFirstAuthorLeadingTitleAbstractPhraseQuery = primarySurname
    ? buildFirstAuthorLeadingTitleAbstractPhraseQuery(primarySurname, citationContext)
    : null;
  const primaryFirstAuthorTitleAbstractKeywordQuery = primarySurname
    ? buildFirstAuthorTitleAbstractKeywordQuery(primarySurname, citationContext)
    : null;
  const primaryFirstAuthorContextQuery = primarySurname
    ? buildFirstAuthorContextQuery(primarySurname, citationContext)
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
  const eprint = extractAdsArxivIdentifier(doc.identifier);
  return {
    bibcode: doc.bibcode,
    title: Array.isArray(doc.title) ? doc.title[0] : String(doc.title ?? ""),
    authors: Array.isArray(doc.author) ? doc.author : [],
    year: doc.year ? Number(doc.year) : null,
    abstract: String(doc.abstract ?? ""),
    doi: Array.isArray(doc.doi) ? doc.doi[0] : doc.doi ?? null,
    eprint,
    archivePrefix: eprint ? "arXiv" : "",
    citationCount: Number(doc.citation_count ?? 0) || 0,
    score: 0,
    generatedKey: null
  };
}

function extractAdsArxivIdentifier(identifiers) {
  const values = Array.isArray(identifiers) ? identifiers : [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    const arxiv = text.match(/(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i);
    if (arxiv) {
      return arxiv[1];
    }
  }
  return "";
}

export function rerankAdsCandidates(citationContext, candidates) {
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
        const matchesFirstAuthor = authorNameMatchesSurnameVariants(firstAuthor, surnameVariants);
        const matchesAnyAuthor = candidate.authors.some((author) => authorNameMatchesSurnameVariants(author, surnameVariants));
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
        if (firstInitial && firstAuthorInitialMatches(firstAuthor, hint.surname, firstInitial)) {
          score += 22;
        } else if (firstInitial && firstAuthor.includes(` ${firstInitial}`)) {
          score += 8;
        }
      }

      if (citationContext?.parsedKeyHint?.surname && citationContext?.parsedKeyHint?.year) {
        const surnameVariants = buildHintSurnameMatchVariants(citationContext.parsedKeyHint.surname);
        if (!authorNameMatchesSurnameVariants(firstAuthor, surnameVariants)) {
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
  const token = normalizeText(citationContext?.token ?? "");
  const tokenLooksLikeTitle = !hint?.year && token.split(" ").filter(Boolean).length >= 3;
  return candidates
    .map((candidate) => {
      let score = 0;
      const titleText = normalizeText(candidate.title);
      const firstAuthor = normalizeText(candidate.authors[0] ?? "");
      const allAuthors = normalizeText(candidate.authors.join(" "));
      let satisfiesPrimaryAuthor = true;
      let satisfiesPrimaryYear = true;

      if (tokenLooksLikeTitle) {
        score += computeTitleTokenScore(token, titleText);
      }

      if (hint?.surname) {
        const surname = normalizeText(hint.surname);
        if (authorNameMatchesSurnameVariant(firstAuthor, surname)) {
          score += 120;
        } else if (candidate.authors.some((author) => authorNameMatchesSurnameVariant(author, surname))) {
          score += 40;
          satisfiesPrimaryAuthor = false;
        } else {
          satisfiesPrimaryAuthor = false;
        }
      }

      if (hint?.firstInitial) {
        const firstInitial = normalizeText(hint.firstInitial);
        if (firstInitial && firstAuthorInitialMatches(firstAuthor, hint.surname, firstInitial)) {
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

function computeTitleTokenScore(token, titleText) {
  if (!token || !titleText) {
    return 0;
  }
  if (titleText === token) {
    return 5000;
  }
  if (!titleText.includes(token)) {
    return 0;
  }
  const tokenWordCount = token.split(" ").length;
  const extraTitleWords = titleText.split(" ").length - tokenWordCount;
  if (titleText.startsWith(token)) {
    return Math.max(1200 - extraTitleWords * 80, 700);
  }
  return Math.max(700 - extraTitleWords * 60, 350);
}

function compareYears(leftYear, rightYear) {
  const left = Number(leftYear) || 0;
  const right = Number(rightYear) || 0;
  return left - right;
}
