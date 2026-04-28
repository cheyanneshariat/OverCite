export const SOURCE_IDS = Object.freeze({
  CROSSREF: "crossref",
  DATACITE: "datacite",
  PUBMED: "pubmed",
  ARXIV: "arxiv",
  INSPIRE: "inspire",
  ADS: "ads",
  SEMANTIC_SCHOLAR: "semanticScholar"
});

export const SOURCE_DEFINITIONS = Object.freeze({
  [SOURCE_IDS.CROSSREF]: {
    label: "Crossref",
    credentialKey: null
  },
  [SOURCE_IDS.DATACITE]: {
    label: "DataCite",
    credentialKey: null
  },
  [SOURCE_IDS.PUBMED]: {
    label: "PubMed",
    credentialKey: null
  },
  [SOURCE_IDS.ARXIV]: {
    label: "arXiv",
    credentialKey: null
  },
  [SOURCE_IDS.INSPIRE]: {
    label: "INSPIRE",
    credentialKey: null
  },
  [SOURCE_IDS.ADS]: {
    label: "ADS/SciX",
    credentialKey: "ads"
  },
  [SOURCE_IDS.SEMANTIC_SCHOLAR]: {
    label: "Semantic Scholar",
    credentialKey: "semanticScholar"
  }
});

const IMPLEMENTED_BROAD_SOURCES = new Set([
  SOURCE_IDS.CROSSREF,
  SOURCE_IDS.DATACITE,
  SOURCE_IDS.PUBMED,
  SOURCE_IDS.ARXIV,
  SOURCE_IDS.INSPIRE
]);

const ROUTABLE_SOURCES = new Set([
  SOURCE_IDS.ADS,
  ...IMPLEMENTED_BROAD_SOURCES
]);

const ARXIV_CACHE_TTL_MS = 10 * 60 * 1000;
const ARXIV_MIN_REQUEST_SPACING_MS = 3200;
const arxivTextCache = new Map();
let lastArxivRequestAt = 0;

const SOURCE_ROUTING_PRESETS = Object.freeze({
  "ads-only": {
    primarySource: SOURCE_IDS.ADS,
    fallbackSources: []
  },
  "arxiv-only": {
    primarySource: SOURCE_IDS.ARXIV,
    fallbackSources: []
  },
  astrophysics: {
    primarySource: SOURCE_IDS.ADS,
    fallbackSources: []
  },
  broad: {
    primarySource: SOURCE_IDS.CROSSREF,
    fallbackSources: [
      SOURCE_IDS.ARXIV,
      SOURCE_IDS.PUBMED,
      SOURCE_IDS.DATACITE
    ]
  },
  "astro-physics": {
    primarySource: SOURCE_IDS.ADS,
    fallbackSources: [SOURCE_IDS.ARXIV, SOURCE_IDS.INSPIRE, SOURCE_IDS.CROSSREF]
  },
  "math-physics": {
    primarySource: SOURCE_IDS.ARXIV,
    fallbackSources: [SOURCE_IDS.INSPIRE, SOURCE_IDS.CROSSREF, SOURCE_IDS.ADS]
  },
  "life-sciences": {
    primarySource: SOURCE_IDS.PUBMED,
    fallbackSources: [SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE]
  },
  "computer-science": {
    primarySource: SOURCE_IDS.ARXIV,
    fallbackSources: [SOURCE_IDS.CROSSREF]
  },
  custom: {
    primarySource: SOURCE_IDS.ADS,
    fallbackSources: []
  }
});

const SOURCE_PROFILES = Object.freeze({
  "ads-only": {
    primary: [],
    optional: [SOURCE_IDS.ADS]
  },
  "arxiv-only": {
    primary: [SOURCE_IDS.ARXIV],
    optional: []
  },
  astrophysics: {
    primary: [],
    optional: [SOURCE_IDS.ADS]
  },
  broad: {
    primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV, SOURCE_IDS.PUBMED, SOURCE_IDS.DATACITE],
    optional: []
  },
  "astro-physics": {
    primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV, SOURCE_IDS.INSPIRE],
    optional: [SOURCE_IDS.ADS]
  },
  "math-physics": {
    primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV, SOURCE_IDS.INSPIRE],
    optional: [SOURCE_IDS.ADS]
  },
  "life-sciences": {
    primary: [SOURCE_IDS.PUBMED, SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE],
    optional: []
  },
  "computer-science": {
    primary: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF],
    optional: []
  },
  custom: {
    primary: [SOURCE_IDS.CROSSREF],
    optional: []
  }
});

export function buildSourcePlan(settings = {}) {
  const profile = SOURCE_PROFILES[settings.sourceProfile] ?? SOURCE_PROFILES.broad;
  const sourceApiTokens = settings.sourceApiTokens ?? {};
  const availableOptional = profile.optional.filter((sourceId) => hasCredential(sourceId, sourceApiTokens));
  const missingOptionalCredentials = profile.optional.filter((sourceId) => requiresCredential(sourceId) && !hasCredential(sourceId, sourceApiTokens));

  return {
    profile: SOURCE_PROFILES[settings.sourceProfile] ? settings.sourceProfile : "broad",
    primarySources: [...profile.primary],
    optionalEnhancers: availableOptional,
    missingOptionalCredentials,
    orderedSources: [...availableOptional, ...profile.primary]
  };
}

export function buildSourceRouting(settings = {}) {
  const sourceApiTokens = settings.sourceApiTokens ?? {};
  const profile = SOURCE_ROUTING_PRESETS[settings.sourceProfile] ? settings.sourceProfile : "ads-only";
  const preset = SOURCE_ROUTING_PRESETS[profile];
  const primarySource = normalizeRoutableSource(settings.primarySource) ?? preset.primarySource;
  const rawFallbackSources = Array.isArray(settings.fallbackSources) ? settings.fallbackSources : preset.fallbackSources;
  const fallbackSources = uniqueStrings(rawFallbackSources)
    .map((sourceId) => normalizeRoutableSource(sourceId))
    .filter((sourceId) => sourceId && sourceId !== primarySource);

  const orderedSources = [primarySource, ...fallbackSources];
  const missingCredentialSources = orderedSources.filter((sourceId) => requiresCredential(sourceId) && !hasCredential(sourceId, sourceApiTokens));
  const availableFallbackSources = fallbackSources.filter((sourceId) => !missingCredentialSources.includes(sourceId));

  return {
    profile,
    primarySource,
    primarySourceAvailable: !missingCredentialSources.includes(primarySource),
    fallbackSources,
    availableFallbackSources,
    missingCredentialSources
  };
}

export async function searchBroadCandidates(citationContext = {}, settings = {}, fetchImpl = globalThis.fetch) {
  if (isAdsOnlyProfile(settings)) {
    return [];
  }
  if (isFieldedAdsDirectQuery(citationContext)) {
    return [];
  }
  const plan = buildSourcePlan(settings);
  const sourceIds = plan.orderedSources.filter((sourceId) => IMPLEMENTED_BROAD_SOURCES.has(sourceId) && shouldSearchSource(sourceId, citationContext));
  if (!sourceIds.length) {
    return [];
  }

  const batches = await Promise.allSettled(sourceIds.map((sourceId) => searchSource(sourceId, citationContext, settings, fetchImpl)));
  const candidates = [];
  const errors = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") {
      candidates.push(...batch.value);
    } else {
      errors.push(batch.reason);
    }
  }
  if (!candidates.length && errors.length === batches.length) {
    throw new Error(`Broad literature search failed: ${errors[0]?.message ?? "all sources failed"}`);
  }
  return mergeDuplicateCandidates(candidates);
}

export async function searchBroadCandidatesForSources(citationContext = {}, settings = {}, sourceIds = [], fetchImpl = globalThis.fetch) {
  if (isFieldedAdsDirectQuery(citationContext)) {
    return [];
  }
  const selectedSourceIds = uniqueStrings(sourceIds)
    .map((sourceId) => normalizeRoutableSource(sourceId))
    .filter((sourceId) => IMPLEMENTED_BROAD_SOURCES.has(sourceId) && shouldSearchSource(sourceId, citationContext));
  if (!selectedSourceIds.length) {
    return [];
  }

  const batches = await Promise.allSettled(selectedSourceIds.map((sourceId) => searchSource(sourceId, citationContext, settings, fetchImpl)));
  const candidates = [];
  const errors = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") {
      candidates.push(...batch.value);
    } else {
      errors.push(batch.reason);
    }
  }
  if (!candidates.length && errors.length === batches.length) {
    throw new Error(`Broad literature search failed: ${errors[0]?.message ?? "all selected sources failed"}`);
  }
  return mergeDuplicateCandidates(candidates);
}

export function isAdsOnlyProfile(settings = {}) {
  const sourceProfile = String(settings?.sourceProfile ?? "").trim().toLowerCase();
  return sourceProfile === "ads-only" || sourceProfile === "astrophysics";
}

function normalizeRoutableSource(sourceId) {
  const normalized = String(sourceId ?? "").trim();
  return ROUTABLE_SOURCES.has(normalized) ? normalized : null;
}

export function isFieldedAdsDirectQuery(citationContext = {}) {
  if (citationContext?.searchMode !== "direct") {
    return false;
  }
  const token = String(citationContext?.token ?? "").trim();
  return /\b(?:abs|abstract|author|bibcode|title|year):/i.test(token);
}

export function buildBroadSearchQuery(citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  const token = String(citationContext?.token ?? "").trim();
  if (citationContext?.searchMode === "direct" && token) {
    return token;
  }
  if (isTitleLikeToken(token, hint)) {
    return token;
  }
  const sentenceLead = extractSentenceLead(citationContext?.sentenceText);
  if (citationContext?.searchMode !== "simple" && isTitleLikeToken(sentenceLead, null) && looksLikeArxivTitleLead(sentenceLead)) {
    return sentenceLead;
  }

  const parts = [];
  if (hint?.surname) {
    parts.push(hint.surname);
  } else if (token) {
    parts.push(token);
  }
  if (hint?.year) {
    parts.push(String(hint.year));
  }

  if (citationContext?.searchMode !== "simple") {
    parts.push(...keywordList(citationContext?.sentenceText ?? "").slice(0, 7));
    if (parts.length < 6) {
      parts.push(...keywordList(citationContext?.contextText ?? "").slice(0, 6 - parts.length));
    }
  }

  if (!parts.length) {
    parts.push(...keywordList(citationContext?.contextText ?? "").slice(0, 8));
  }
  return uniqueStrings(parts).join(" ").trim();
}

function buildContextOnlySearchQuery(citationContext = {}) {
  const parts = [
    ...keywordList(citationContext?.sentenceText ?? "").slice(0, 8),
    ...keywordList(citationContext?.contextText ?? "").slice(0, 8)
  ];
  return uniqueStrings(parts).slice(0, 9).join(" ").trim();
}

function buildArxivSearchQuery(citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  const token = String(citationContext?.token ?? "").trim();
  if (citationContext?.searchMode === "direct" && token) {
    return `all:${quoteArxivTerm(token)}`;
  }
  if (citationContext?.searchMode === "simple" && isTitleLikeToken(token, hint)) {
    return `ti:${quoteArxivTerm(token)}`;
  }

  const clauses = [];
  if (hint?.surname && !isGenericAuthorFamily(hint.surname)) {
    clauses.push(`au:${quoteArxivTerm(hint.surname)}`);
  }

  const titleClause = buildArxivContextTitleClause(citationContext);
  if (titleClause) {
    clauses.push(titleClause);
    return clauses.join(" AND ");
  }

  if (hint?.year) {
    clauses.push(`submittedDate:[${hint.year}01010000 TO ${hint.year}12312359]`);
  }

  const contextTokens = keywordList(`${citationContext?.sentenceText ?? ""} ${citationContext?.contextText ?? ""}`)
    .filter((term) => !hint?.surname || term !== String(hint.surname).toLowerCase())
    .slice(0, 5);
  if (contextTokens.length) {
    clauses.push(`(${contextTokens.map((term) => `all:${quoteArxivTerm(term)}`).join(" OR ")})`);
  } else if (token && !hint?.surname) {
    clauses.push(`all:${quoteArxivTerm(token)}`);
  }

  return clauses.join(" AND ");
}

function buildArxivAuthorYearFallbackQuery(citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname && !hint?.year) {
    return "";
  }
  const clauses = [];
  if (hint?.surname && !isGenericAuthorFamily(hint.surname)) {
    clauses.push(`au:${quoteArxivTerm(hint.surname)}`);
  }
  if (hint?.year) {
    clauses.push(`submittedDate:[${hint.year}01010000 TO ${hint.year}12312359]`);
  }
  return clauses.join(" AND ");
}

function buildArxivPreprintYearFallbackQuery(citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year || isGenericAuthorFamily(hint.surname)) {
    return "";
  }
  const year = Number(hint.year);
  if (!Number.isFinite(year)) {
    return "";
  }
  return `au:${quoteArxivTerm(hint.surname)} AND submittedDate:[${year - 1}01010000 TO ${year}12312359]`;
}

function shouldTryArxivPreprintYearFallback(candidates, citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  return Boolean(
    hint?.surname &&
    hint?.year &&
    citationContext?.searchMode !== "direct" &&
    !candidates.some((candidate) => candidateFirstAuthorMatchesHint(candidate, hint))
  );
}

function candidateFirstAuthorMatchesHint(candidate, hint = {}) {
  if (!hint?.surname) {
    return false;
  }
  return authorFamilyMatches(hint.surname, candidate?.authors?.[0]);
}

function authorFamilyMatches(expectedSurname, author) {
  const expected = normalizeText(expectedSurname);
  const family = authorFamilyName(author);
  if (!expected || !family) {
    return false;
  }
  if (expected.includes(" ")) {
    return family === expected || family.endsWith(` ${expected}`);
  }
  return family === expected;
}

function authorFamilyName(author) {
  const raw = String(author ?? "").trim();
  if (!raw) {
    return "";
  }
  const [rawFamily, ...rawGivenParts] = raw.split(",");
  if (rawGivenParts.length) {
    return normalizeText(rawFamily);
  }

  const tokens = normalizeText(raw).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return "";
  }
  let familyStart = tokens.length - 1;
  const particles = new Set(["da", "de", "del", "der", "di", "du", "la", "le", "van", "von"]);
  if (tokens.length >= 2 && particles.has(tokens[tokens.length - 2])) {
    familyStart = tokens.length - 2;
  } else if (tokens.length >= 3 && tokens[tokens.length - 2].length > 1 && /^[a-z]+$/.test(tokens[tokens.length - 2]) && /^[a-z]+$/.test(tokens[tokens.length - 1])) {
    familyStart = tokens.length - 2;
  }
  return tokens.slice(familyStart).join(" ");
}

function buildArxivContextTitleClause(citationContext = {}) {
  if (citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") {
    return "";
  }
  const lead = extractSentenceLead(citationContext?.sentenceText);
  if (isTitleLikeToken(lead, null) && looksLikeArxivTitleLead(lead)) {
    return `ti:${quoteArxivTerm(lead)}`;
  }
  return "";
}

function looksLikeArxivTitleLead(value) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const commonFirstWords = new Set(["a", "an", "the", "this", "that", "these", "those", "we", "our", "it", "here"]);
  let titleishWords = 0;
  for (const [index, rawWord] of words.entries()) {
    const word = rawWord.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!word) {
      continue;
    }
    if (index === 0 && commonFirstWords.has(word.toLowerCase())) {
      continue;
    }
    if (/^\d/.test(word) || /^[A-Z]$/.test(word) || /^[A-Z][A-Za-z0-9-]{2,}$/.test(word) || /[a-z][A-Z]/.test(word)) {
      titleishWords += 1;
    }
  }
  if (commonFirstWords.has(words[0]?.toLowerCase()) && titleishWords < 2) {
    return false;
  }
  return titleishWords >= 2 || words.length >= 5 && titleishWords >= 1 || (value.includes(":") && titleishWords >= 1);
}

function extractSentenceLead(value) {
  return String(value ?? "").trim().match(/^(.+?)\s+(?:is|was|introduced|describes|presents|reports|shows|provides|uses)\b/)?.[1]?.trim() ?? "";
}

function isGenericAuthorFamily(value) {
  return /^(?:collaboration|collaborations|consortium|team|group)$/i.test(String(value ?? "").trim());
}

function quoteArxivTerm(term) {
  return `"${String(term ?? "").replace(/"/g, " ").trim()}"`;
}

export function exportCandidateBibtex(candidate = {}) {
  if (candidate?.bibtex) {
    return String(candidate.bibtex).trim();
  }
  const type = mapBibtexType(candidate);
  const key = sanitizeBibtexKey(candidate.generatedKey || candidate.bibtexExportId || candidate.id || "overcite");
  const fields = [
    ["author", formatAuthorsForBibtex(candidate.authors)],
    ["title", candidate.title],
    ["journal", candidate.journal],
    ["booktitle", candidate.booktitle],
    ["publisher", candidate.publisher],
    ["year", candidate.year ? String(candidate.year) : ""],
    ["doi", candidate.doi],
    ["url", candidate.url],
    ["eprint", candidate.eprint],
    ["archivePrefix", candidate.archivePrefix],
    ["primaryClass", candidate.primaryClass]
  ].filter(([, value]) => String(value ?? "").trim());

  const body = fields
    .map(([name, value]) => `  ${name} = {${escapeBibtexValue(value)}}`)
    .join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

async function searchSource(sourceId, citationContext, settings, fetchImpl) {
  const query = buildBroadSearchQuery(citationContext);
  if (!query) {
    return [];
  }
  if (sourceId === SOURCE_IDS.CROSSREF) {
    return searchCrossref(query, citationContext, fetchImpl);
  }
  if (sourceId === SOURCE_IDS.DATACITE) {
    return searchDataCite(query, citationContext, fetchImpl);
  }
  if (sourceId === SOURCE_IDS.PUBMED) {
    return searchPubMed(query, citationContext, settings, fetchImpl);
  }
  if (sourceId === SOURCE_IDS.ARXIV) {
    return searchArxiv(citationContext, fetchImpl);
  }
  if (sourceId === SOURCE_IDS.INSPIRE) {
    return searchInspire(query, citationContext, fetchImpl);
  }
  if (sourceId === SOURCE_IDS.SEMANTIC_SCHOLAR) {
    return searchSemanticScholar(query, settings, fetchImpl);
  }
  return [];
}

function shouldSearchSource(sourceId, citationContext) {
  if (sourceId !== SOURCE_IDS.DATACITE) {
    return true;
  }
  return isLikelyDataCiteLookup(citationContext);
}

function isLikelyDataCiteLookup(citationContext = {}) {
  if (directDoiFromContext(citationContext)) {
    return true;
  }
  const text = normalizeText([
    citationContext?.token,
    citationContext?.sentenceText,
    citationContext?.contextText
  ].join(" "));
  return /\b(data|dataset|datasets|software|code|repository|repositories|zenodo|figshare|archive|catalog|catalogue|supplement|supplementary)\b/.test(text);
}

async function searchCrossref(query, citationContext, fetchImpl) {
  const directDoi = directDoiFromContext(citationContext);
  if (directDoi) {
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(directDoi)}`);
    const payload = await fetchJson(url, fetchImpl, "Crossref DOI lookup", {}, { retries: 1, fallbackDelayMs: 750 });
    return [mapCrossrefWork(payload?.message)].filter(isUsableCandidate);
  }
  const urls = buildCrossrefUrls(query, citationContext);
  const payloads = await fetchJsonBatches(urls, fetchImpl, "Crossref search", {}, { retries: 1, fallbackDelayMs: 750 });
  return payloads.flatMap((payload) => payload?.message?.items ?? []).map(mapCrossrefWork).filter(isUsableCandidate);
}

async function searchDataCite(query, citationContext, fetchImpl) {
  const directDoi = directDoiFromContext(citationContext);
  if (directDoi) {
    const url = new URL(`https://api.datacite.org/dois/${encodeURIComponent(directDoi)}`);
    const payload = await fetchJson(url, fetchImpl, "DataCite DOI lookup");
    return [mapDataCiteWork(payload?.data)].filter(isUsableCandidate);
  }
  const dataCiteQuery = buildDataCiteQuery(query, citationContext);
  const url = new URL("https://api.datacite.org/dois");
  url.searchParams.set("query", dataCiteQuery || query);
  url.searchParams.set("page[size]", "12");
  const year = citationContext?.parsedKeyHint?.year;
  if (year && !dataCiteQuery) {
    url.searchParams.set("published", String(year));
  }
  const payload = await fetchJson(url, fetchImpl, "DataCite search");
  return (payload?.data ?? []).map(mapDataCiteWork).filter(isUsableCandidate);
}

function buildDataCiteQuery(query, citationContext = {}) {
  const token = String(citationContext?.token ?? "").trim();
  if (citationContext?.searchMode === "simple" && token) {
    return `titles.title:${quoteDataCiteTerm(token)}`;
  }
  const lead = extractSentenceLead(citationContext?.sentenceText);
  if (lead && keywordList(lead).length >= 2) {
    return `titles.title:${quoteDataCiteTerm(lead)}`;
  }
  return "";
}

function quoteDataCiteTerm(value) {
  return `"${String(value ?? "").replace(/"/g, " ").trim()}"`;
}

async function searchPubMed(query, citationContext, settings, fetchImpl) {
  const searchTerms = uniqueStrings([
    buildPubMedSearchTerm(query, citationContext),
    buildPubMedFallbackSearchTerm(query, citationContext)
  ]).filter(Boolean);
  let ids = [];
  for (const term of searchTerms) {
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", "12");
    searchUrl.searchParams.set("sort", "relevance");
    searchUrl.searchParams.set("term", term);
    appendNcbiApiKey(searchUrl, settings);

    const searchPayload = await fetchJsonWithRateLimitRetry(searchUrl, fetchImpl, "PubMed search", {}, { retries: 1, fallbackDelayMs: 750 });
    ids = searchPayload?.esearchresult?.idlist ?? [];
    if (ids.length) {
      break;
    }
  }
  if (!ids.length) {
    return [];
  }

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("id", ids.join(","));
  appendNcbiApiKey(summaryUrl, settings);

  const summaryPayload = await fetchJsonWithRateLimitRetry(summaryUrl, fetchImpl, "PubMed summary", {}, { retries: 1, fallbackDelayMs: 750 });
  return ids
    .map((id) => mapPubMedSummary(summaryPayload?.result?.[id]))
    .filter(isUsableCandidate);
}

async function searchArxiv(citationContext, fetchImpl) {
  const searchQuery = buildArxivSearchQuery(citationContext);
  const directArxivId = directArxivIdFromContext(citationContext);
  if (!searchQuery && !directArxivId) {
    return [];
  }
  const authorYearQuery = buildArxivAuthorYearFallbackQuery(citationContext);
  const preprintYearQuery = buildArxivPreprintYearFallbackQuery(citationContext);
  try {
    const firstBatch = await fetchArxivQuery({ searchQuery, directArxivId, fetchImpl });
    let candidates = firstBatch;
    if (!candidates.length && !directArxivId && authorYearQuery && authorYearQuery !== searchQuery) {
      candidates = await fetchArxivQuery({ searchQuery: authorYearQuery, fetchImpl });
    }
    if (preprintYearQuery && preprintYearQuery !== searchQuery && preprintYearQuery !== authorYearQuery && shouldTryArxivPreprintYearFallback(candidates, citationContext)) {
      const fallbackBatch = await fetchArxivQuery({ searchQuery: preprintYearQuery, fetchImpl });
      return mergeDuplicateCandidates([...candidates, ...fallbackBatch]);
    }
    if (candidates.length || directArxivId) {
      return candidates;
    }
    return [];
  } catch (error) {
    if (!isArxivRecoverableError(error) || directArxivId) {
      throw error;
    }
    return searchArxivMetadataFallback(citationContext, fetchImpl);
  }
}

async function searchInspire(query, citationContext, fetchImpl) {
  const directRecordUrl = buildInspireDirectRecordUrl(citationContext);
  if (directRecordUrl) {
    const record = await fetchJson(directRecordUrl, fetchImpl, "INSPIRE direct lookup");
    return [mapInspireRecord(record)].filter(isUsableCandidate);
  }

  const urls = buildInspireUrls(query, citationContext);
  const payloads = await fetchJsonBatches(urls, fetchImpl, "INSPIRE search");
  return payloads
    .flatMap((payload) => payload?.hits?.hits ?? [])
    .map(mapInspireRecord)
    .filter(isUsableCandidate);
}

async function fetchArxivQuery({ searchQuery = "", directArxivId = "", fetchImpl }) {
  const url = new URL("https://export.arxiv.org/api/query");
  if (directArxivId) {
    url.searchParams.set("id_list", directArxivId);
  } else {
    url.searchParams.set("search_query", searchQuery);
  }
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "12");
  const text = await fetchArxivText(url, fetchImpl);
  return parseArxivEntries(text).map(mapArxivWork).filter(isUsableCandidate);
}

async function fetchArxivText(url, fetchImpl) {
  const cacheKey = url.toString();
  const useCache = shouldUseArxivRuntimeGuards(fetchImpl);
  if (useCache) {
    const cached = arxivTextCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < ARXIV_CACHE_TTL_MS) {
      return cached.text;
    }
  }

  const firstResponse = await fetchTextResponse(url, fetchImpl);
  if (firstResponse.ok) {
    const text = await firstResponse.text();
    if (isArxivRateLimitText(text)) {
      throw new Error("arXiv is rate limiting searches. Wait a few seconds and try again.");
    }
    cacheArxivText(cacheKey, text, useCache);
    return text;
  }
  if (firstResponse.status === 429) {
    await sleep(retryDelayMs(firstResponse));
    const retryResponse = await fetchTextResponse(url, fetchImpl);
    if (retryResponse.ok) {
      const text = await retryResponse.text();
      cacheArxivText(cacheKey, text, useCache);
      return text;
    }
    if (retryResponse.status === 429) {
      throw new Error("arXiv is rate limiting searches. Wait a few seconds and try again.");
    }
    throw new Error(`arXiv search failed with status ${retryResponse.status}`);
  }
  throw new Error(`arXiv search failed with status ${firstResponse.status}`);
}

async function fetchTextResponse(url, fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available.");
  }
  if (shouldUseArxivRuntimeGuards(fetchImpl)) {
    await waitForArxivTurn();
  }
  return fetchWithTimeout(fetchImpl, url.toString(), {
    headers: {
      Accept: "application/atom+xml, application/xml, text/xml"
    }
  });
}

function retryDelayMs(response) {
  const retryAfter = response?.headers?.get?.("Retry-After");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 15000);
  }
  return 4500;
}

function rateLimitRetryDelayMs(response, fallbackDelayMs = 1000) {
  const retryAfter = response?.headers?.get?.("Retry-After");
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 15000);
  }
  return fallbackDelayMs;
}

function isArxivRateLimitText(text) {
  return /^\s*rate exceeded\.?\s*$/i.test(String(text ?? ""));
}

function isArxivRecoverableError(error) {
  const message = String(error?.message ?? error ?? "");
  return /arXiv is rate limiting|arXiv search failed with status (?:429|502|503|504)|operation was aborted|aborted|timed out/i.test(message);
}

async function searchArxivMetadataFallback(citationContext, fetchImpl) {
  return searchCrossref(buildBroadSearchQuery(citationContext), citationContext, fetchImpl);
}

async function searchArxivViaSemanticScholar(citationContext, fetchImpl) {
  const queries = buildArxivMetadataFallbackQueries(citationContext);
  for (const query of queries) {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "5");
    url.searchParams.set("fields", "paperId,title,authors,year,abstract,externalIds,citationCount,venue,url,publicationTypes");
    try {
      const payload = await fetchJson(url, fetchImpl, "Semantic Scholar arXiv fallback");
      const candidates = (payload?.data ?? [])
        .map(mapSemanticScholarArxivPaper)
        .filter((candidate) => isUsableCandidate(candidate) && candidate.eprint)
        .filter((candidate) => candidateMatchesHint(candidate, citationContext?.parsedKeyHint));
      if (candidates.length) {
        return candidates;
      }
    } catch {
      continue;
    }
  }
  return [];
}

function buildArxivMetadataFallbackQueries(citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  const broadQuery = buildBroadSearchQuery(citationContext);
  const authorYearQuery = [hint?.surname, hint?.year].filter(Boolean).join(" ");
  return uniqueStrings([
    broadQuery,
    authorYearQuery,
    `${authorYearQuery} ${keywordList(citationContext?.sentenceText ?? "").slice(0, 5).join(" ")}`.trim(),
    `${authorYearQuery} ${keywordList(citationContext?.contextText ?? "").slice(0, 5).join(" ")}`.trim()
  ]).filter(Boolean);
}

function candidateMatchesHint(candidate, hint = {}) {
  if (hint?.year && Number(candidate?.year) !== Number(hint.year)) {
    return false;
  }
  if (hint?.surname) {
    const surname = String(hint.surname).toLowerCase();
    return (candidate?.authors ?? []).some((author) => String(author).toLowerCase().includes(surname));
  }
  return true;
}

function shouldUseArxivRuntimeGuards(fetchImpl) {
  return fetchImpl === globalThis.fetch;
}

async function waitForArxivTurn() {
  const now = Date.now();
  const waitMs = Math.max(0, lastArxivRequestAt + ARXIV_MIN_REQUEST_SPACING_MS - now);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastArxivRequestAt = Date.now();
}

function cacheArxivText(cacheKey, text, useCache) {
  if (!useCache) {
    return;
  }
  arxivTextCache.set(cacheKey, {
    createdAt: Date.now(),
    text
  });
  if (arxivTextCache.size > 50) {
    const firstKey = arxivTextCache.keys().next().value;
    arxivTextCache.delete(firstKey);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchSemanticScholar(query, settings, fetchImpl) {
  const apiKey = String(settings?.sourceApiTokens?.semanticScholar ?? "").trim();
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "12");
  url.searchParams.set("fields", "paperId,title,authors,year,abstract,externalIds,citationCount,venue,url,publicationTypes");
  const headers = apiKey ? { "x-api-key": apiKey } : {};
  const payload = await fetchJson(url, fetchImpl, "Semantic Scholar search", headers);
  return (payload?.data ?? []).map(mapSemanticScholarPaper).filter(isUsableCandidate);
}

async function fetchJson(url, fetchImpl, label, headers = {}, retryOptions = {}) {
  return fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers, retryOptions);
}

async function fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers = {}, retryOptions = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available.");
  }
  const response = await fetchWithTimeout(fetchImpl, url.toString(), {
    headers: {
      Accept: "application/json",
      ...headers
    }
  });
  if (response.ok) {
    return response.json();
  }
  if (response.status === 429 && retryOptions.retries > 0) {
    await sleep(rateLimitRetryDelayMs(response, retryOptions.fallbackDelayMs));
    return fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers, {
      ...retryOptions,
      retries: retryOptions.retries - 1
    });
  }
  throw new Error(`${label} failed with status ${response.status}`);
}

async function fetchText(url, fetchImpl, label) {
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available.");
  }
  const response = await fetchWithTimeout(fetchImpl, url.toString(), {
    headers: {
      Accept: "application/atom+xml, application/xml, text/xml"
    }
  });
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}`);
  }
  return response.text();
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 3500) {
  if (typeof AbortController !== "function") {
    return fetchImpl(url, options);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonBatches(urls, fetchImpl, label, headers = {}, retryOptions = {}) {
  const batches = await Promise.allSettled(urls.map((url) => fetchJson(url, fetchImpl, label, headers, retryOptions)));
  const payloads = [];
  const errors = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") {
      payloads.push(batch.value);
    } else {
      errors.push(batch.reason);
    }
  }
  if (!payloads.length && errors.length) {
    throw errors[0];
  }
  return payloads;
}

function buildCrossrefUrls(query, citationContext) {
  const hint = citationContext?.parsedKeyHint;
  const urls = [];
  const contextQuery = buildContextOnlySearchQuery(citationContext);
  const titleQuery = buildCrossrefTitleQuery(query, citationContext);
  if (hint?.surname && hint?.year) {
    if (titleQuery) {
      urls.push(crossrefUrl({
        title: titleQuery,
        author: hint.surname,
        year: hint.year
      }));
    } else {
      urls.push(crossrefUrl({
        bibliographic: [hint.surname, hint.year, contextQuery].filter(Boolean).join(" "),
        author: hint.surname,
        year: hint.year
      }));
    }
  } else if (titleQuery) {
    urls.push(crossrefUrl({
      title: titleQuery,
      year: hint?.year
    }));
  }
  if (!titleQuery || normalizeText(titleQuery) !== normalizeText(query)) {
    urls.push(crossrefUrl({
      bibliographic: query,
      year: hint?.year
    }));
  }
  return dedupeUrls(urls);
}

function buildCrossrefTitleQuery(query, citationContext = {}) {
  const token = String(citationContext?.token ?? "").trim();
  if ((citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") && isTitleLikeToken(token, citationContext?.parsedKeyHint)) {
    return token;
  }
  const sentence = String(citationContext?.sentenceText ?? "").trim();
  const lead = extractSentenceLead(sentence);
  if (isTitleLikeToken(lead, null)) {
    return lead;
  }
  if (keywordList(sentence).length >= 5) {
    return sentence;
  }
  if (isTitleLikeToken(query, citationContext?.parsedKeyHint)) {
    return query;
  }
  return "";
}

function buildPubMedSearchTerm(query, citationContext) {
  const directDoi = directDoiFromContext(citationContext);
  if (directDoi) {
    return `${directDoi}[doi]`;
  }

  const hint = citationContext?.parsedKeyHint;
  const clauses = [];
  if (hint?.surname) {
    clauses.push(`${pubMedAuthorTerm(hint.surname)}[Author]`);
  }
  if (hint?.year) {
    clauses.push(`${hint.year}[dp]`);
  }
  const titleQuery = buildPubMedTitleQuery(query, citationContext);
  if (titleQuery) {
    clauses.push(titleQuery);
  } else {
    const textQuery = String(query ?? "").trim();
    if (textQuery) {
      clauses.push(`${quotePubMedTerm(textQuery)}[Title/Abstract]`);
    }
  }
  return clauses.length ? clauses.join(" AND ") : String(query ?? "").trim();
}

function buildPubMedFallbackSearchTerm(query, citationContext) {
  const directDoi = directDoiFromContext(citationContext);
  if (directDoi) {
    return "";
  }
  const token = String(citationContext?.token ?? "").trim();
  if (citationContext?.searchMode === "direct" && token) {
    return token;
  }
  const text = buildContextOnlySearchQuery(citationContext) || query;
  return keywordList(text).slice(0, 8).join(" ");
}

function buildPubMedTitleQuery(query, citationContext = {}) {
  const token = String(citationContext?.token ?? "").trim();
  const sentence = String(citationContext?.sentenceText ?? "").trim();
  const lead = extractSentenceLead(sentence);
  const text = isTitleLikeToken(token, citationContext?.parsedKeyHint)
    ? token
    : lead || sentence || String(query ?? "").trim();
  const terms = keywordList(text).slice(0, 7);
  return terms.length >= 2 ? terms.map((term) => `${term}[Title]`).join(" AND ") : "";
}

function buildInspireDirectRecordUrl(citationContext = {}) {
  const directDoi = directDoiFromContext(citationContext);
  if (directDoi) {
    return new URL(`https://inspirehep.net/api/doi/${encodeURIComponent(directDoi)}`);
  }
  const directArxivId = directArxivIdFromContext(citationContext);
  if (directArxivId) {
    return new URL(`https://inspirehep.net/api/arxiv/${encodeURIComponent(directArxivId)}`);
  }
  return null;
}

function buildInspireUrls(query, citationContext = {}) {
  const hint = citationContext?.parsedKeyHint;
  const token = String(citationContext?.token ?? "").trim();
  if (citationContext?.searchMode === "direct" && token) {
    return [inspireUrl(token)];
  }

  const contextQuery = buildContextOnlySearchQuery(citationContext);
  const titleQuery = buildInspireTitleQuery(query, citationContext);
  const urls = [];
  if (titleQuery) {
    urls.push(inspireUrl(`title "${titleQuery}"`));
  }
  if (hint?.surname && hint?.year) {
    const contextualQuery = [inspireAuthorClause(hint.surname), `date ${hint.year}`, contextQuery].filter(Boolean).join(" and ");
    urls.push(inspireUrl(contextualQuery));
    urls.push(inspireUrl([inspireAuthorClause(hint.surname), `date ${hint.year}`].join(" and ")));
  }
  urls.push(inspireUrl(query));
  return dedupeUrls(urls);
}

function buildInspireTitleQuery(query, citationContext = {}) {
  const token = String(citationContext?.token ?? "").trim();
  if ((citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") && isTitleLikeToken(token, citationContext?.parsedKeyHint)) {
    return token;
  }
  const sentence = String(citationContext?.sentenceText ?? "").trim();
  const lead = extractSentenceLead(sentence);
  if (isTitleLikeToken(lead, null)) {
    return lead;
  }
  if (isTitleLikeToken(query, citationContext?.parsedKeyHint)) {
    return query;
  }
  return "";
}

function inspireUrl(query) {
  const url = new URL("https://inspirehep.net/api/literature");
  url.searchParams.set("size", "12");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", [
    "titles",
    "authors.full_name",
    "abstracts.value",
    "dois.value",
    "arxiv_eprints.value",
    "arxiv_eprints.categories",
    "publication_info",
    "earliest_date",
    "citation_count",
    "document_type",
    "texkeys"
  ].join(","));
  return url;
}

function inspireAuthorClause(surname) {
  return `a ${String(surname ?? "").replace(/"/g, " ").trim()}`;
}

function quotePubMedTerm(value) {
  return `"${String(value ?? "").replace(/"/g, " ").trim()}"`;
}

function pubMedAuthorTerm(value) {
  return String(value ?? "").replace(/["[\](){}]/g, " ").replace(/\s+/g, " ").trim();
}

function appendNcbiApiKey(url, settings) {
  const apiKey = String(settings?.sourceApiTokens?.ncbi ?? "").trim();
  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
  }
}

function crossrefUrl({ bibliographic = "", title = "", author = "", year = null } = {}) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("rows", "12");
  url.searchParams.set("select", "DOI,title,author,published-print,published-online,published,issued,container-title,abstract,is-referenced-by-count,type,URL,publisher");
  if (title) {
    url.searchParams.set("query.title", title);
  }
  if (bibliographic) {
    url.searchParams.set("query.bibliographic", bibliographic);
  }
  if (author) {
    url.searchParams.set("query.author", author);
  }
  if (year) {
    url.searchParams.set("filter", `from-pub-date:${year}-01-01,until-pub-date:${year}-12-31`);
  }
  return url;
}

function dedupeUrls(urls) {
  return [...new Map(urls.map((url) => [url.toString(), url])).values()];
}

function mapCrossrefWork(work) {
  const type = String(work?.type ?? "");
  return normalizeCandidate({
    id: work?.DOI ? `https://doi.org/${work.DOI}` : work?.URL,
    sourceId: SOURCE_IDS.CROSSREF,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.CROSSREF].label,
    title: first(work?.title),
    authors: (work?.author ?? []).map(formatCrossrefAuthor).filter(Boolean),
    year: extractCrossrefYear(work),
    abstract: stripMarkup(work?.abstract),
    doi: normalizeDoi(work?.DOI),
    citationCount: work?.["is-referenced-by-count"],
    journal: first(work?.["container-title"]),
    booktitle: type.includes("proceedings") ? first(work?.["container-title"]) : "",
    publisher: work?.publisher,
    type,
    url: work?.URL,
    bibtexExportId: work?.DOI,
    raw: work
  });
}

function mapDataCiteWork(record) {
  const attributes = record?.attributes ?? {};
  const resourceType = attributes?.types?.resourceTypeGeneral ?? attributes?.types?.resourceType ?? "";
  return normalizeCandidate({
    id: attributes?.doi ? `https://doi.org/${attributes.doi}` : record?.id,
    sourceId: SOURCE_IDS.DATACITE,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.DATACITE].label,
    title: firstTitle(attributes?.titles),
    authors: (attributes?.creators ?? []).map((creator) => creator?.name).filter(Boolean),
    year: attributes?.publicationYear,
    abstract: firstDescription(attributes?.descriptions),
    doi: normalizeDoi(attributes?.doi),
    citationCount: attributes?.citationCount,
    publisher: attributes?.publisher,
    type: resourceType,
    url: attributes?.url,
    bibtexExportId: attributes?.doi,
    raw: record
  });
}

function mapPubMedSummary(record) {
  const doi = normalizeDoi(
    (record?.articleids ?? []).find((item) => String(item?.idtype ?? "").toLowerCase() === "doi")?.value ||
    String(record?.elocationid ?? "").match(/10\.\d{4,9}\/\S+/i)?.[0] ||
    ""
  );
  return normalizeCandidate({
    id: record?.uid ? `pmid:${record.uid}` : record?.title,
    sourceId: SOURCE_IDS.PUBMED,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.PUBMED].label,
    title: record?.title,
    authors: (record?.authors ?? []).map((author) => formatPubMedAuthor(author?.name)).filter(Boolean),
    year: extractPubMedYear(record?.pubdate ?? record?.epubdate ?? record?.sortpubdate),
    abstract: "",
    doi,
    citationCount: 0,
    journal: record?.fulljournalname || record?.source,
    type: "journal-article",
    url: record?.uid ? `https://pubmed.ncbi.nlm.nih.gov/${record.uid}/` : "",
    bibtexExportId: doi || record?.uid,
    raw: record
  });
}

function mapArxivWork(entry) {
  const arxivId = stripArxivVersion(String(entry.id ?? "").split("/abs/").pop() ?? entry.id ?? "");
  return normalizeCandidate({
    id: arxivId ? `https://arxiv.org/abs/${arxivId}` : entry.id,
    sourceId: SOURCE_IDS.ARXIV,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.ARXIV].label,
    title: entry.title,
    authors: entry.authors,
    year: entry.published ? Number(String(entry.published).slice(0, 4)) : null,
    abstract: entry.summary,
    doi: entry.doi || (arxivId ? `10.48550/arxiv.${arxivId.toLowerCase()}` : ""),
    citationCount: 0,
    journal: "arXiv",
    type: "preprint",
    url: arxivId ? `https://arxiv.org/abs/${arxivId}` : entry.id,
    bibtexExportId: arxivId,
    eprint: arxivId,
    archivePrefix: "arXiv",
    primaryClass: entry.primaryClass,
    raw: entry
  });
}

function mapSemanticScholarPaper(paper) {
  const externalIds = paper?.externalIds ?? {};
  const arxivId = stripArxivVersion(externalIds.ArXiv ?? "");
  const doi = normalizeDoi(externalIds.DOI) || (arxivId ? `10.48550/arxiv.${arxivId.toLowerCase()}` : "");
  return normalizeCandidate({
    id: paper?.paperId ? `SemanticScholar:${paper.paperId}` : paper?.url,
    sourceId: SOURCE_IDS.SEMANTIC_SCHOLAR,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.SEMANTIC_SCHOLAR].label,
    title: paper?.title,
    authors: (paper?.authors ?? []).map((author) => author?.name).filter(Boolean),
    year: paper?.year,
    abstract: paper?.abstract,
    doi,
    citationCount: paper?.citationCount,
    journal: paper?.venue,
    type: Array.isArray(paper?.publicationTypes) ? paper.publicationTypes[0] : "",
    url: paper?.url,
    bibtexExportId: paper?.paperId,
    eprint: arxivId,
    archivePrefix: arxivId ? "arXiv" : "",
    raw: paper
  });
}

function mapSemanticScholarArxivPaper(paper) {
  const externalIds = paper?.externalIds ?? {};
  const arxivId = stripArxivVersion(externalIds.ArXiv ?? "");
  return normalizeCandidate({
    id: arxivId ? `https://arxiv.org/abs/${arxivId}` : paper?.url,
    sourceId: SOURCE_IDS.ARXIV,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.ARXIV].label,
    title: paper?.title,
    authors: (paper?.authors ?? []).map((author) => author?.name).filter(Boolean),
    year: paper?.year,
    abstract: paper?.abstract,
    doi: normalizeDoi(externalIds.DOI) || (arxivId ? `10.48550/arxiv.${arxivId.toLowerCase()}` : ""),
    citationCount: paper?.citationCount,
    journal: paper?.venue || "arXiv",
    type: "preprint",
    url: arxivId ? `https://arxiv.org/abs/${arxivId}` : paper?.url,
    bibtexExportId: arxivId,
    eprint: arxivId,
    archivePrefix: arxivId ? "arXiv" : "",
    raw: paper
  });
}

function mapInspireRecord(record) {
  const metadata = record?.metadata ?? {};
  const doi = normalizeDoi(first((metadata?.dois ?? []).map((entry) => entry?.value).filter(Boolean)));
  const arxivEntry = (metadata?.arxiv_eprints ?? [])[0] ?? {};
  const publicationInfo = (metadata?.publication_info ?? [])[0] ?? {};
  const title = firstTitle(metadata?.titles);
  const arxivId = stripArxivVersion(arxivEntry?.value ?? "");
  return normalizeCandidate({
    id: record?.id ? `https://inspirehep.net/literature/${record.id}` : title,
    sourceId: SOURCE_IDS.INSPIRE,
    sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.INSPIRE].label,
    title,
    authors: (metadata?.authors ?? []).map((author) => author?.full_name).filter(Boolean),
    year: extractInspireYear(metadata),
    abstract: first((metadata?.abstracts ?? []).map((entry) => entry?.value).filter(Boolean)),
    doi,
    citationCount: metadata?.citation_count,
    journal: publicationInfo?.journal_title,
    type: first(metadata?.document_type),
    url: record?.id ? `https://inspirehep.net/literature/${record.id}` : "",
    bibtexExportId: first(metadata?.texkeys) || arxivId || doi || record?.id,
    eprint: arxivId,
    archivePrefix: arxivId ? "arXiv" : "",
    primaryClass: first(arxivEntry?.categories),
    raw: record
  });
}

function parseArxivEntries(xmlText) {
  return String(xmlText ?? "")
    .split(/<entry>/)
    .slice(1)
    .map((chunk) => chunk.split("</entry>")[0])
    .map((entryXml) => ({
      id: decodeXml(firstXmlText(entryXml, "id")),
      title: decodeXml(firstXmlText(entryXml, "title")).replace(/\s+/g, " ").trim(),
      summary: decodeXml(firstXmlText(entryXml, "summary")).replace(/\s+/g, " ").trim(),
      published: decodeXml(firstXmlText(entryXml, "published")),
      authors: [...entryXml.matchAll(/<author>\s*<name>([^]*?)<\/name>\s*<\/author>/g)].map((match) => decodeXml(match[1]).replace(/\s+/g, " ").trim()).filter(Boolean),
      doi: decodeXml(firstXmlText(entryXml, "arxiv:doi")),
      primaryClass: decodeXml(firstXmlAttribute(entryXml, "arxiv:primary_category", "term"))
    }));
}

function firstXmlText(xmlText, tagName) {
  const escapedTag = tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = xmlText.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([^]*?)<\\/${escapedTag}>`, "i"));
  return match?.[1] ?? "";
}

function firstXmlAttribute(xmlText, tagName, attributeName) {
  const escapedTag = tagName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const escapedAttribute = attributeName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = xmlText.match(new RegExp(`<${escapedTag}[^>]*\\s${escapedAttribute}="([^"]+)"`, "i"));
  return match?.[1] ?? "";
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripArxivVersion(arxivId) {
  return String(arxivId ?? "").trim().replace(/v\d+$/i, "");
}

function normalizeCandidate(candidate) {
  const doi = normalizeDoi(candidate.doi);
  const inferredArxivYear = inferYearFromArxivIdentifier(doi || candidate.eprint);
  return {
    bibcode: null,
    id: String(candidate.id ?? candidate.doi ?? candidate.title ?? "").trim(),
    sourceId: candidate.sourceId,
    sourceLabel: candidate.sourceLabel,
    title: String(candidate.title ?? "").replace(/\s+/g, " ").trim(),
    authors: Array.isArray(candidate.authors) ? candidate.authors.map((author) => String(author ?? "").trim()).filter(Boolean) : [],
    year: inferredArxivYear || (candidate.year ? Number(String(candidate.year).slice(0, 4)) : null),
    abstract: stripMarkup(candidate.abstract),
    doi,
    citationCount: Number(candidate.citationCount ?? 0) || 0,
    journal: String(candidate.journal ?? "").trim(),
    booktitle: String(candidate.booktitle ?? "").trim(),
    publisher: String(candidate.publisher ?? "").trim(),
    type: String(candidate.type ?? "").trim(),
    url: String(candidate.url ?? "").trim(),
    bibtexExportId: String(candidate.bibtexExportId ?? "").trim(),
    eprint: String(candidate.eprint ?? "").trim(),
    archivePrefix: String(candidate.archivePrefix ?? "").trim(),
    primaryClass: String(candidate.primaryClass ?? "").trim(),
    score: 0,
    generatedKey: null,
    raw: candidate.raw
  };
}

function isUsableCandidate(candidate) {
  return Boolean(candidate?.title && candidate?.authors?.length && candidate?.year);
}

function mergeDuplicateCandidates(candidates) {
  const merged = [];
  const seen = new Map();
  for (const candidate of candidates) {
    const key = duplicateKey(candidate);
    if (!key || !seen.has(key)) {
      seen.set(key, merged.length);
      merged.push(candidate);
      continue;
    }
    const existing = merged[seen.get(key)];
    merged[seen.get(key)] = preferCandidate(existing, candidate);
  }
  return merged;
}

function duplicateKey(candidate) {
  const title = normalizeText(candidate?.title);
  const firstAuthor = firstAuthorFamilyKey(candidate?.authors?.[0]);
  if (title && firstAuthor) {
    return `work:${title}:${firstAuthor}`;
  }
  if (candidate?.doi) {
    return `doi:${candidate.doi.toLowerCase()}`;
  }
  return candidate?.id ? `${candidate.sourceId}:${candidate.id}` : "";
}

function firstAuthorFamilyKey(author) {
  const raw = String(author ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.includes(",")) {
    return normalizeText(raw.split(",")[0]);
  }
  const normalized = normalizeText(raw);
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) {
    return "";
  }
  let familyStart = tokens.length - 1;
  const particles = new Set(["da", "de", "del", "der", "di", "du", "la", "le", "van", "von"]);
  if (tokens.length >= 2 && particles.has(tokens[tokens.length - 2])) {
    familyStart = tokens.length - 2;
  } else if (tokens.length >= 3 && tokens[tokens.length - 2].length > 1 && /^[a-z]+$/.test(tokens[tokens.length - 2]) && /^[a-z]+$/.test(tokens[tokens.length - 1])) {
    familyStart = tokens.length - 2;
  }
  return tokens.slice(familyStart).join(" ");
}

function preferCandidate(left, right) {
  const leftAuthority = sourceAuthorityScore(left);
  const rightAuthority = sourceAuthorityScore(right);
  if (Math.abs(rightAuthority - leftAuthority) >= 15) {
    return rightAuthority > leftAuthority
      ? mergeCandidateRecords(right, left)
      : mergeCandidateRecords(left, right);
  }
  const leftScore = candidateCompletenessScore(left);
  const rightScore = candidateCompletenessScore(right);
  if (rightScore > leftScore) {
    return mergeCandidateRecords(right, left);
  }
  return mergeCandidateRecords(left, right);
}

function sourceAuthorityScore(candidate) {
  const sourceId = candidate?.sourceId;
  const type = String(candidate?.type ?? "").toLowerCase();
  if (sourceId === SOURCE_IDS.DATACITE && (type.includes("dataset") || type.includes("software"))) {
    return 95;
  }
  return {
    [SOURCE_IDS.ADS]: 100,
    [SOURCE_IDS.PUBMED]: 90,
    [SOURCE_IDS.CROSSREF]: 85,
    [SOURCE_IDS.INSPIRE]: 80,
    [SOURCE_IDS.DATACITE]: 70,
    [SOURCE_IDS.SEMANTIC_SCHOLAR]: 60,
    [SOURCE_IDS.ARXIV]: 45
  }[sourceId] ?? 0;
}

function mergeCandidateRecords(primary, secondary) {
  return {
    ...primary,
    abstract: primary.abstract || secondary.abstract,
    doi: preferredDoi(primary, secondary),
    year: preferredYear(primary, secondary),
    journal: primary.journal || secondary.journal,
    booktitle: primary.booktitle || secondary.booktitle,
    publisher: primary.publisher || secondary.publisher,
    url: preferredUrl(primary, secondary),
    eprint: primary.eprint || secondary.eprint,
    archivePrefix: primary.archivePrefix || secondary.archivePrefix,
    primaryClass: primary.primaryClass || secondary.primaryClass,
    sourceLabel: mergeSourceLabels(primary, secondary)
  };
}

function preferredDoi(primary, secondary) {
  if (primary.doi && !isArxivDoi(primary.doi)) {
    return primary.doi;
  }
  if (secondary.doi && !isArxivDoi(secondary.doi)) {
    return secondary.doi;
  }
  return primary.doi || secondary.doi;
}

function preferredUrl(primary, secondary) {
  if (primary.url && !isArxivIdentified(primary)) {
    return primary.url;
  }
  if (secondary.url && !isArxivIdentified(secondary)) {
    return secondary.url;
  }
  return primary.url || secondary.url;
}

function preferredYear(primary, secondary) {
  const years = [primary.year, secondary.year]
    .map((year) => Number(year))
    .filter((year) => Number.isFinite(year) && year > 0);
  if (!years.length) {
    return null;
  }
  return Math.min(...years);
}

function isArxivIdentified(candidate) {
  return candidate?.sourceId === SOURCE_IDS.ARXIV ||
    Boolean(candidate?.eprint) ||
    String(candidate?.archivePrefix ?? "").toLowerCase() === "arxiv" ||
    isArxivDoi(candidate?.doi);
}

function isArxivDoi(value) {
  return String(value ?? "").toLowerCase().includes("10.48550/arxiv.");
}

function candidateCompletenessScore(candidate) {
  return [
    candidate.doi,
    candidate.abstract,
    candidate.journal || candidate.booktitle,
    candidate.url,
    candidate.citationCount > 0
  ].filter(Boolean).length;
}

function mergeSourceLabels(left, right) {
  return uniqueStrings(String(`${left.sourceLabel ?? ""},${right.sourceLabel ?? ""}`).split(",").map((value) => value.trim()).filter(Boolean)).join(", ");
}

function mapBibtexType(candidate) {
  const type = String(candidate?.type ?? "").toLowerCase();
  if (type.includes("dataset") || type.includes("software")) {
    return "misc";
  }
  if (type.includes("proceedings") || candidate?.booktitle) {
    return "inproceedings";
  }
  if (type.includes("book")) {
    return "book";
  }
  if (candidate?.journal || type.includes("article") || type.includes("journal")) {
    return "article";
  }
  return "misc";
}

function formatAuthorsForBibtex(authors) {
  return (Array.isArray(authors) ? authors : []).map((author) => String(author ?? "").trim()).filter(Boolean).join(" and ");
}

function escapeBibtexValue(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[{}]/g, "");
}

function sanitizeBibtexKey(value) {
  return String(value ?? "overcite").replace(/[^A-Za-z0-9_.:-]/g, "") || "overcite";
}

function normalizeDoi(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "");
  const decoded = safeDecodeURIComponent(raw);
  return decoded
    .replace(/\.(?:full|short)$/i, "")
    .toLowerCase();
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function directDoiFromContext(citationContext = {}) {
  if (citationContext?.searchMode !== "direct") {
    return "";
  }
  const token = String(citationContext?.token ?? "").trim();
  const normalized = normalizeDoi(token);
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : "";
}

function directArxivIdFromContext(citationContext = {}) {
  if (citationContext?.searchMode !== "direct") {
    return "";
  }
  const token = String(citationContext?.token ?? "").trim();
  return arxivIdFromText(token);
}

function arxivIdFromText(value) {
  const match = String(value ?? "").trim().match(/(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i);
  return stripArxivVersion(match?.[1] ?? "");
}

function inferYearFromArxivIdentifier(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const match = normalized.match(/(?:arxiv[.:/])?(\d{2})(\d{2})\.\d{4,5}/);
  if (!match) {
    return null;
  }
  const yy = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(yy) || month < 1 || month > 12) {
    return null;
  }
  return yy >= 91 ? 1900 + yy : 2000 + yy;
}

function extractCrossrefYear(work) {
  const candidates = [
    work?.["published-print"],
    work?.["published-online"],
    work?.published,
    work?.issued
  ];
  for (const candidate of candidates) {
    const year = candidate?.["date-parts"]?.[0]?.[0];
    if (year) {
      return Number(year);
    }
  }
  return null;
}

function extractPubMedYear(value) {
  const match = String(value ?? "").match(/\b(18|19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractInspireYear(metadata = {}) {
  const publicationYear = (metadata?.publication_info ?? [])
    .map((entry) => entry?.year)
    .find(Boolean);
  if (publicationYear) {
    return Number(publicationYear);
  }
  return extractPubMedYear(metadata?.earliest_date);
}

function formatCrossrefAuthor(author) {
  if (author?.family && author?.given) {
    return `${author.family}, ${author.given}`;
  }
  return author?.family ?? author?.name ?? "";
}

function formatPubMedAuthor(name) {
  const raw = String(name ?? "").trim();
  const match = raw.match(/^(.+?)\s+([A-Z](?:[A-Z])?)$/);
  if (match) {
    return `${match[1]}, ${match[2]}`;
  }
  return raw;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function firstTitle(titles) {
  return first((titles ?? []).map((title) => title?.title).filter(Boolean));
}

function firstDescription(descriptions) {
  const description = (descriptions ?? []).find((entry) => /abstract/i.test(entry?.descriptionType ?? "")) ?? descriptions?.[0];
  return description?.description ?? "";
}

function stripMarkup(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isTitleLikeToken(token, hint = null) {
  const normalized = normalizeText(token);
  if (!normalized || hint?.year) {
    return false;
  }
  return normalized.split(" ").filter(Boolean).length >= 3;
}

function keywordList(value) {
  return uniqueStrings(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !SOURCE_STOPWORDS.has(token))
  );
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

const SOURCE_STOPWORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "have",
  "into",
  "paper",
  "result",
  "results",
  "show",
  "shows",
  "study",
  "that",
  "the",
  "their",
  "these",
  "this",
  "using",
  "with",
  "without"
]);

function requiresCredential(sourceId) {
  return Boolean(SOURCE_DEFINITIONS[sourceId]?.credentialKey);
}

function hasCredential(sourceId, sourceApiTokens) {
  const credentialKey = SOURCE_DEFINITIONS[sourceId]?.credentialKey;
  if (!credentialKey) {
    return true;
  }
  return Boolean(String(sourceApiTokens?.[credentialKey] ?? "").trim());
}
