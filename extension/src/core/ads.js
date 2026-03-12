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
  const sentenceKeywords = keywordList(citationContext?.sentenceText ?? "").slice(0, 3);
  const keywords = [...sentenceKeywords];
  if (keywords.length < 2) {
    const contextKeywords = keywordList(citationContext?.contextText ?? "")
      .filter((token) => !sentenceKeywords.includes(token))
      .slice(0, 2 - keywords.length);
    keywords.push(...contextKeywords);
  }
  if (keywords.length < 2) {
    return null;
  }
  return keywords
    .map((token) => `full:"${escapeQueryValue(token)}"`)
    .join(" AND ");
}

function buildSentencePhrase(citationContext) {
  const tokens = keywordList(citationContext?.sentenceText ?? "");
  if (tokens.length < 2) {
    return null;
  }
  return tokens.slice(0, 6).join(" ");
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

function buildAuthorContextQuery(surname, citationContext) {
  const contextQuery = buildContextKeywordQuery(citationContext);
  if (!surname || !contextQuery) {
    return null;
  }
  return `author:"${escapeQueryValue(surname)}" AND ${contextQuery}`;
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

export function buildAdsQueries(citationContext) {
  const queries = new Set();
  const hint = citationContext?.parsedKeyHint;
  const primaryQuery = buildAdsQuery(citationContext);
  const contextQuery = buildContextKeywordQuery(citationContext);
  const sentencePhraseQuery = buildSentencePhraseQuery(citationContext);
  const sentenceTitleAbstractPhraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
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

  if (hint?.surname && hint?.year) {
    if (primaryFirstAuthorYearInitialTitleAbstractPhraseQuery) {
      queries.add(primaryFirstAuthorYearInitialTitleAbstractPhraseQuery);
    }
    if (primaryFirstAuthorYearTitleAbstractPhraseQuery) {
      queries.add(primaryFirstAuthorYearTitleAbstractPhraseQuery);
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
    if (primaryAuthorPhraseQuery) {
      queries.add(primaryAuthorPhraseQuery);
    }
    if (primaryAuthorContextQuery) {
      queries.add(primaryAuthorContextQuery);
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
  } else if (hint?.surname && !hint?.year && primaryAuthorPhraseQuery) {
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
      const authorPhraseQuery = buildAuthorSentencePhraseQuery(surname, citationContext);
      if (authorPhraseQuery) {
        queries.add(authorPhraseQuery);
      }
      const authorTitleAbstractPhraseQuery = buildAuthorTitleAbstractPhraseQuery(surname, citationContext);
      if (authorTitleAbstractPhraseQuery) {
        queries.add(authorTitleAbstractPhraseQuery);
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
    score: 0,
    generatedKey: null
  };
}

export function rerankAdsCandidates(citationContext, candidates) {
  const hint = citationContext?.parsedKeyHint;
  const contextKeywords = keywordSet(citationContext?.contextText ?? "");
  const sentenceKeywords = keywordSet(citationContext?.sentenceText ?? "");
  const sentencePhrase = normalizeText(buildSentencePhrase(citationContext) ?? "");

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

      for (const token of contextKeywords) {
        if (titleText.includes(token)) {
          score += 6;
        } else if (abstractText.includes(token)) {
          score += 1.5;
        }
      }

      for (const token of sentenceKeywords) {
        if (titleText.includes(token)) {
          score += 10;
        } else if (abstractText.includes(token)) {
          score += 2;
        }
      }

      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score || compareYears(right.year, left.year));
}

function compareYears(leftYear, rightYear) {
  const left = Number(leftYear) || 0;
  const right = Number(rightYear) || 0;
  return left - right;
}
