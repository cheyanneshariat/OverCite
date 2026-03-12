function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasSurnameToken(authorText, surname) {
  const normalizedAuthor = normalizeText(authorText);
  const normalizedSurname = normalizeText(surname);
  if (!normalizedAuthor || !normalizedSurname) {
    return false;
  }
  return normalizedAuthor.split(" ").includes(normalizedSurname);
}

export function buildSearchCacheKey(citationContext, settings = {}) {
  return JSON.stringify({
    token: citationContext?.token ?? "",
    sentenceText: citationContext?.sentenceText ?? "",
    contextText: citationContext?.contextText ?? "",
    parsedKeyHint: citationContext?.parsedKeyHint ?? null,
    citationKeyMode: settings?.citationKeyMode ?? "informative"
  });
}

export function shouldStopSearchEarly(citationContext, rankedCandidates = [], queryIndex = 0) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year) {
    return false;
  }
  if (queryIndex > 1) {
    return false;
  }
  const topCandidate = rankedCandidates[0];
  if (!topCandidate) {
    return false;
  }

  const firstAuthor = topCandidate.authors?.[0] ?? "";
  if (!hasSurnameToken(firstAuthor, hint.surname)) {
    return false;
  }
  if (topCandidate.year !== hint.year) {
    return false;
  }
  return Number(topCandidate.score ?? 0) >= 135;
}
