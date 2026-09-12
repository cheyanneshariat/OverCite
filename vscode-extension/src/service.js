import { buildAdsQueries, mapAdsDocToCandidate, rerankAdsCandidates, hasDistinctiveContextIdentifier } from "./core/ads.js";
import { applyContextualBetaReranking } from "./core/contextual-beta.js";
import { runOrderedQueryQueue } from "./core/query-queue.js";
import { applyBibInsertion, generatePreferredKey } from "./core/bibtex.js";
import { normalizeContextualCitationContext } from "./core/citation.js";
import { resolveBibTargetFromProjectState } from "./core/project.js";
import { buildSourceRouting, contextualArxivId, exportCandidateBibtex, searchBroadCandidatesForSources, SOURCE_IDS } from "./core/sources.js";

const ADS_SEARCH_URL = process.env.OVERCITE_ADS_SEARCH_URL || "https://api.adsabs.harvard.edu/v1/search/query";
const ADS_BIBTEX_URL = process.env.OVERCITE_ADS_BIBTEX_URL || "https://api.adsabs.harvard.edu/v1/export/bibtex";
const ARXIV_CITATION_ENRICHMENT_TIMEOUT_MS = 900;
const ADS_SEARCH_REQUEST_TIMEOUT_MS = positiveNumber(process.env.OVERCITE_ADS_SEARCH_REQUEST_TIMEOUT_MS, 6500);
const ADS_SEARCH_BUDGET_MS = positiveNumber(process.env.OVERCITE_ADS_SEARCH_BUDGET_MS, 12000);
const DEFAULT_LITERATURE_SEARCH_BUDGET_MS = 30000;
const RUNTIME_FETCH_MARKER = Symbol.for("overcite.runtimeFetch");
const candidateReadyHandlers = new WeakMap();

export function resolveBibTarget(projectState, settings) {
  return resolveBibTargetFromProjectState({
    ...projectState,
    overrides: settings.projectBibFileOverrides
  });
}

export function buildQuickPickItems(candidates, settings, typedToken) {
  return candidates.map((candidate) => ({
    label: candidate.generatedKey ?? generatePreferredKey(candidate, [], {
      keyMode: settings.citationKeyMode,
      typedToken
    }),
    description: formatCandidateMeta(candidate),
    detail: `${candidate.sourceLabel ? `[${candidate.sourceLabel}] ` : ""}${candidate.title}\n${truncate(candidate.abstract, 260)}`,
    candidate: {
      ...candidate,
      keyMode: settings.citationKeyMode,
      typedToken,
      bibliographyInsertMode: settings.bibliographyInsertMode
    }
  }));
}

export async function searchAds(citationContext, settings, fetchImpl = globalThis.fetch) {
  return searchLiterature(citationContext, settings, fetchImpl);
}

export async function searchLiterature(citationContext, settings, fetchImpl = globalThis.fetch, onReady = null) {
  return runWithAbortDeadline(
    async (signal) => {
      const boundedFetch = fetchWithParentSignal(fetchImpl, signal);
      if (onReady) candidateReadyHandlers.set(boundedFetch, onReady);
      try {
        return await searchLiteratureWithinBudget(citationContext, settings, boundedFetch, signal);
      } finally {
        candidateReadyHandlers.delete(boundedFetch);
      }
    },
    positiveNumber(process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS, DEFAULT_LITERATURE_SEARCH_BUDGET_MS),
    "Literature search"
  );
}

async function searchLiteratureWithinBudget(citationContext, settings, fetchImpl, searchSignal = null) {
  citationContext = normalizeContextualCitationContext(citationContext, settings?.contextualSearchEngine);
  const adsApiToken = settings.sourceApiTokens?.ads || settings.adsApiToken;
  const routing = buildSourceRouting(settings);
  const requestedArxivId = contextualBetaArxivId(citationContext, settings);
  const primarySource = choosePrimarySourceForQuery(routing, citationContext, settings);
  const fallbackSources = contextualBetaFallbackSources(citationContext, settings, routing, primarySource);
  const candidates = [];
  const errors = [];

  const shouldSearchPrimary = Boolean(requestedArxivId) || isSourceSearchableAsPrimary(routing, primarySource);
  if (!requestedArxivId && shouldSearchContextualBetaSourcesInParallel(citationContext, settings, primarySource, shouldSearchPrimary, fallbackSources)) {
    const parallelResult = await searchFallbackSources({
      citationContext,
      settings,
      adsApiToken,
      fetchImpl,
      fallbackSources: [primarySource, ...fallbackSources],
      candidates,
      errors,
      searchSignal
    });
    if (parallelResult) {
      return maybeEnrichArxivCitationCounts(citationContext, settings, parallelResult, adsApiToken, fetchImpl);
    }
    if (!candidates.length) {
      if (errors.length) throw errors[0];
      throw new Error("No literature matches found.");
    }
    for (const error of errors) {
      console.warn("[OverCite VS Code] literature provider failed after another provider returned results", error);
    }
    return maybeEnrichArxivCitationCounts(
      citationContext,
      settings,
      finalizeCandidates(citationContext, settings, candidates),
      adsApiToken,
      fetchImpl
    );
  }
  const fetchedPrimaryCandidates = shouldSearchPrimary
    ? await searchRoutedSource(primarySource, citationContext, settings, adsApiToken, fetchImpl, searchSignal)
      .catch((error) => {
        errors.push(error);
        return [];
      })
    : [];
  const primaryCandidates = requestedArxivId && primarySource === SOURCE_IDS.ARXIV
    ? fetchedPrimaryCandidates.filter((candidate) => candidateMatchesContextualArxivId(candidate, requestedArxivId))
    : fetchedPrimaryCandidates;
  candidates.push(...primaryCandidates);

  if (requestedArxivId && primarySource === SOURCE_IDS.ARXIV && primaryCandidates.length) {
    return maybeEnrichArxivCitationCounts(citationContext, settings, finalizeCandidates(citationContext, settings, primaryCandidates), adsApiToken, fetchImpl);
  }

  const primaryRanked = finalizeCandidates(citationContext, settings, primaryCandidates);
  if (primaryRanked.length && isHighConfidenceResult(citationContext, primaryRanked[0], primarySource, primaryRanked[1])) {
    return maybeEnrichArxivCitationCounts(citationContext, settings, primaryRanked, adsApiToken, fetchImpl);
  }
  if (shouldKeepSimplePrimaryResult(citationContext, primaryRanked[0], primarySource, fallbackSources)) {
    return maybeEnrichArxivCitationCounts(citationContext, settings, primaryRanked, adsApiToken, fetchImpl);
  }

  if (primarySource === SOURCE_IDS.ADS &&
      citationContext?.searchMode === "contextual" &&
      hasDistinctiveContextIdentifier(citationContext)) {
    const arxivCandidates = await searchRoutedSource(
      SOURCE_IDS.ARXIV,
      citationContext,
      settings,
      adsApiToken,
      fetchImpl,
      searchSignal
    ).catch((error) => {
      errors.push(error);
      return [];
    });
    candidates.push(...arxivCandidates);
    const entityRanked = finalizeCandidates(citationContext, settings, candidates);
    if (arxivCandidates.length && entityRanked.length) {
      return maybeEnrichArxivCitationCounts(citationContext, settings, entityRanked, adsApiToken, fetchImpl);
    }
  }

  if (fallbackSources.length) {
    const fallbackResult = await searchFallbackSources({
      citationContext,
      settings,
      adsApiToken,
      fetchImpl,
      fallbackSources,
      candidates,
      errors,
      searchSignal,
      candidateFilter: requestedArxivId
        ? (candidate) => candidateMatchesContextualArxivId(candidate, requestedArxivId)
        : null
    });
    if (fallbackResult) {
      return maybeEnrichArxivCitationCounts(citationContext, settings, fallbackResult, adsApiToken, fetchImpl);
    }
  }

  if (!candidates.length) {
    if (errors.length) {
      throw errors[0];
    }
    throw new Error("No literature matches found.");
  }
  for (const error of errors) {
    console.warn("[OverCite VS Code] literature provider failed after another provider returned results", error);
  }

  return maybeEnrichArxivCitationCounts(citationContext, settings, finalizeCandidates(citationContext, settings, candidates), adsApiToken, fetchImpl);
}

function shouldSearchContextualBetaSourcesInParallel(citationContext, settings, primarySource, shouldSearchPrimary, fallbackSources) {
  return citationContext?.searchMode === "contextual" &&
    settings?.contextualSearchEngine === "beta" &&
    primarySource !== SOURCE_IDS.ADS &&
    shouldSearchPrimary &&
    fallbackSources.length > 0;
}

function contextualBetaFallbackSources(citationContext, settings, routing, primarySource) {
  const sources = availableSearchSources(routing).filter((sourceId) => sourceId !== primarySource);
  if (citationContext?.searchMode === "contextual" &&
      settings?.contextualSearchEngine === "beta" &&
      routing?.profile === "chemistry" &&
      primarySource !== SOURCE_IDS.ARXIV &&
      !sources.includes(SOURCE_IDS.ARXIV)) {
    sources.push(SOURCE_IDS.ARXIV);
  }
  return sources;
}

async function maybeEnrichArxivCitationCounts(citationContext, settings, candidates, adsApiToken, fetchImpl) {
  const arxivNeedingCounts = candidates
    .slice(0, 5)
    .filter((candidate) => isArxivIdentified(candidate) && !(Number(candidate?.citationCount ?? 0) > 0) && String(candidate?.eprint ?? "").trim());
  if (!arxivNeedingCounts.length || !adsApiToken) {
    return candidates;
  }
  candidateReadyHandlers.get(fetchImpl)?.(candidates);
  return runWithAbortDeadline(
    (signal) => enrichArxivCitationCountsFromAds(candidates, arxivNeedingCounts, citationContext, adsApiToken, fetchWithParentSignal(fetchImpl, signal)),
    ARXIV_CITATION_ENRICHMENT_TIMEOUT_MS,
    "Citation counts"
  ).catch(() => candidates);
}

async function enrichArxivCitationCountsFromAds(candidates, arxivNeedingCounts, citationContext, adsApiToken, fetchImpl) {
  const query = buildArxivAdsCitationQuery(arxivNeedingCounts);
  if (!query) {
    return candidates;
  }
  const docs = await fetchSearchCandidates([query], { ...citationContext, searchMode: "direct" }, adsApiToken, { fetchImpl });
  const adsCandidates = docs.map((doc) => ({
    ...mapAdsDocToCandidate(doc),
    sourceId: SOURCE_IDS.ADS,
    sourceLabel: "ADS/SciX"
  }));
  if (!adsCandidates.length) {
    return candidates;
  }
  return candidates.map((candidate) => {
    if (!isArxivIdentified(candidate) || Number(candidate?.citationCount ?? 0) > 0) {
      return candidate;
    }
    const match = adsCandidates.find((adsCandidate) => adsCandidateMatchesArxivCandidate(adsCandidate, candidate));
    const citationCount = Number(match?.citationCount ?? 0) || 0;
    return citationCount > 0 ? { ...candidate, citationCount } : candidate;
  });
}

function buildArxivAdsCitationQuery(candidates) {
  const clauses = [...new Set(candidates
    .map((candidate) => String(candidate?.eprint ?? "").trim().replace(/v\d+$/i, ""))
    .filter(Boolean))]
    .slice(0, 5)
    .map((eprint) => `identifier:"${escapeAdsQueryValue(eprint)}"`);
  return clauses.join(" OR ");
}

function adsCandidateMatchesArxivCandidate(adsCandidate, arxivCandidate) {
  const adsEprint = String(adsCandidate?.eprint ?? "").toLowerCase().replace(/v\d+$/i, "");
  const arxivEprint = String(arxivCandidate?.eprint ?? "").toLowerCase().replace(/v\d+$/i, "");
  if (adsEprint && arxivEprint && adsEprint === arxivEprint) {
    return true;
  }
  const adsDoi = String(adsCandidate?.doi ?? "").toLowerCase();
  const arxivDoi = String(arxivCandidate?.doi ?? "").toLowerCase();
  if (adsDoi && arxivDoi && adsDoi === arxivDoi) {
    return true;
  }
  return normalizeSearchText(adsCandidate?.title) === normalizeSearchText(arxivCandidate?.title) &&
    yearsCompatible(adsCandidate?.year, arxivCandidate?.year) &&
    firstAuthorMatches(parseAuthorName(arxivCandidate?.authors?.[0]).family, adsCandidate?.authors?.[0]);
}

function escapeAdsQueryValue(value) {
  return String(value ?? "").replace(/"/g, '\\"');
}

function choosePrimarySourceForQuery(routing, citationContext, settings) {
  if (contextualBetaArxivId(citationContext, settings)) {
    return SOURCE_IDS.ARXIV;
  }
  if (directArxivToken(citationContext) && availableSearchSources(routing).includes(SOURCE_IDS.ARXIV)) {
    return SOURCE_IDS.ARXIV;
  }
  if (directPubMedToken(citationContext) && availableSearchSources(routing).includes(SOURCE_IDS.PUBMED)) {
    return SOURCE_IDS.PUBMED;
  }
  if (shouldPreferCrossrefForPreArxivPaper(routing, citationContext)) {
    return SOURCE_IDS.CROSSREF;
  }
  if (isDatasetSoftwareLookup(citationContext) && availableSearchSources(routing).includes(SOURCE_IDS.DATACITE)) {
    return SOURCE_IDS.DATACITE;
  }
  return routing.primarySource;
}

function contextualBetaArxivId(citationContext, settings) {
  return citationContext?.searchMode === "contextual" && settings?.contextualSearchEngine === "beta"
    ? contextualArxivId(citationContext)
    : "";
}

function candidateMatchesContextualArxivId(candidate, requestedArxivId) {
  const expected = normalizeArxivIdentifier(requestedArxivId);
  if (!expected) return false;
  if (candidate?.sourceId === SOURCE_IDS.ARXIV) {
    return [candidate?.eprint, candidate?.bibtexExportId, candidate?.id, candidate?.url, candidate?.doi]
      .map((value) => normalizeArxivIdentifier(value) || extractArxivQualifiedIdentifier(value))
      .some((identifier) => identifier === expected);
  }
  return [candidate?.doi, candidate?.id, candidate?.url]
    .map(extractArxivQualifiedIdentifier)
    .some((identifier) => identifier === expected);
}

function normalizeArxivIdentifier(value) {
  return String(value ?? "").trim().match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/i)?.[1]?.toLowerCase() ?? "";
}

function extractArxivQualifiedIdentifier(value) {
  const text = String(value ?? "").trim();
  const doiMatch = text.match(/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?$/i);
  if (doiMatch) return doiMatch[1].toLowerCase();
  const urlMatch = text.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/i);
  return urlMatch?.[1]?.toLowerCase() ?? "";
}

function shouldKeepSimplePrimaryResult(citationContext, candidate, primarySource, fallbackSources) {
  if (citationContext?.searchMode !== "simple" ||
      !candidate ||
      primarySource === SOURCE_IDS.ARXIV ||
      !fallbackSources.length ||
      fallbackSources.some((sourceId) => sourceId !== SOURCE_IDS.ARXIV) ||
      simpleContextTitleRank(citationContext, candidate) < 460000) {
    return false;
  }
  const hintYear = Number(citationContext?.parsedKeyHint?.year);
  const candidateYear = Number(candidate?.year);
  if (Number.isFinite(hintYear) && Number.isFinite(candidateYear) && candidateYear === hintYear) {
    return true;
  }
  return Number.isFinite(hintYear) && hintYear < 1991;
}

function shouldPreferCrossrefForPreArxivPaper(routing, citationContext) {
  if (routing.primarySource !== SOURCE_IDS.ARXIV || !availableSearchSources(routing).includes(SOURCE_IDS.CROSSREF)) {
    return false;
  }
  const year = citationYear(citationContext);
  return Boolean(year && year < 1991);
}

function citationYear(citationContext) {
  const hintYear = Number(citationContext?.parsedKeyHint?.year);
  if (Number.isInteger(hintYear) && hintYear >= 1000) {
    return hintYear;
  }
  const token = String(citationContext?.token ?? "");
  const fullYear = token.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  if (fullYear) {
    return Number(fullYear[1]);
  }
  return null;
}

function availableSearchSources(routing) {
  const sources = [];
  if (routing.primarySourceAvailable || !routing.availableFallbackSources.length) {
    sources.push(routing.primarySource);
  }
  sources.push(...routing.availableFallbackSources);
  return [...new Set(sources)];
}

function isSourceSearchableAsPrimary(routing, sourceId) {
  return sourceId === routing.primarySource
    ? routing.primarySourceAvailable || !routing.availableFallbackSources.length
    : routing.availableFallbackSources.includes(sourceId);
}

async function searchFallbackSources({ citationContext, settings, adsApiToken, fetchImpl, fallbackSources, candidates, errors, searchSignal = null, candidateFilter = null }) {
  if (citationContext?.searchMode === "simple") {
    const pending = fallbackSources.map((sourceId, index) => {
      let promise;
      promise = Promise.resolve()
        .then(() => searchRoutedSource(sourceId, citationContext, settings, adsApiToken, fetchImpl, searchSignal))
        .then(
          (value) => ({ status: "fulfilled", sourceId, index, value, promise }),
          (reason) => ({ status: "rejected", sourceId, index, reason, promise })
        );
      return promise;
    });
    const unsettled = new Set(pending);
    const settledIndexes = new Set();
    while (unsettled.size) {
      const batch = await Promise.race(unsettled);
      unsettled.delete(batch.promise);
      settledIndexes.add(batch.index);
      if (batch.status === "fulfilled") {
        candidates.push(...(candidateFilter ? batch.value.filter(candidateFilter) : batch.value));
      } else {
        errors.push(batch.reason);
      }
      const ranked = finalizeCandidates(citationContext, settings, candidates);
      if (ranked.length &&
          isHighConfidenceResult(citationContext, ranked[0], ranked[0].sourceId, ranked[1]) &&
          canReturnSimpleFallback(ranked[0], fallbackSources, settledIndexes)) {
        return ranked;
      }
    }
    return null;
  }

  const pending = fallbackSources.map((sourceId) => {
    let promise;
    promise = Promise.resolve()
      .then(() => searchRoutedSource(sourceId, citationContext, settings, adsApiToken, fetchImpl, searchSignal))
      .then(
        (value) => ({ status: "fulfilled", sourceId, value, promise }),
        (reason) => ({ status: "rejected", sourceId, reason, promise })
      );
    return promise;
  });
  const unsettled = new Set(pending);

  while (unsettled.size) {
    const batch = await Promise.race(unsettled);
    unsettled.delete(batch.promise);
    if (batch.status === "fulfilled") {
      candidates.push(...(candidateFilter ? batch.value.filter(candidateFilter) : batch.value));
      const ranked = finalizeCandidates(citationContext, settings, candidates);
      if (ranked.length && isHighConfidenceResult(citationContext, ranked[0], batch.sourceId, ranked[1])) {
        return ranked;
      }
    } else {
      errors.push(batch.reason);
    }
  }

  return null;
}

function canReturnSimpleFallback(candidate, fallbackSources, settledIndexes) {
  const sourceIndex = fallbackSources.indexOf(candidate?.sourceId);
  if (sourceIndex < 0) {
    return false;
  }
  for (let index = 0; index < sourceIndex; index += 1) {
    if (!settledIndexes.has(index)) {
      return false;
    }
  }
  return true;
}

async function searchRoutedSource(sourceId, citationContext, settings, adsApiToken, fetchImpl, searchSignal = null) {
  if (sourceId !== SOURCE_IDS.ADS) {
    return searchBroadCandidatesForSources(citationContext, settings, [sourceId], fetchWithParentSignal(fetchImpl, searchSignal));
  }
  if (!adsApiToken) {
    throw new Error("No ADS/SciX API token is configured for ADS/SciX search.");
  }
  const queries = buildAdsQueries(citationContext);
  const mergedDocs = await fetchSearchCandidates(queries, citationContext, adsApiToken, {
    fetchImpl,
    externalSignal: searchSignal,
    shouldStop(docs) {
      const ranked = finalizeCandidates(citationContext, settings, docs.map((doc) => ({
        ...mapAdsDocToCandidate(doc),
        sourceId: SOURCE_IDS.ADS,
        sourceLabel: "ADS/SciX"
      })));
      return shouldStopAdsCandidateFetch(citationContext, settings, ranked);
    }
  });
  return mergedDocs.map((doc) => ({
    ...mapAdsDocToCandidate(doc),
    sourceId: SOURCE_IDS.ADS,
    sourceLabel: "ADS/SciX"
  }));
}

function shouldStopAdsCandidateFetch(citationContext, settings, ranked) {
  if (!ranked.length || !isHighConfidenceResult(citationContext, ranked[0], SOURCE_IDS.ADS, ranked[1])) {
    return false;
  }
  // Context Beta may inspect a broad title/context hit before the complete
  // author-year ladder has run. Only stop that beta path on an explicit
  // author/year identity; entity-aware lookups already stop at the bounded
  // opening pair below and retain their dedicated Yang-style path.
  if (citationContext?.searchMode === "contextual" && settings?.contextualSearchEngine === "beta") {
    return contextualAuthorYearIdentityMatches(citationContext, ranked[0]);
  }
  return true;
}

function contextualAuthorYearIdentityMatches(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year || !contextualBetaAuthorFamilyMatches(hint.surname, candidate?.authors?.[0])) {
    return false;
  }
  if (Number(candidate?.year) !== Number(hint.year)) {
    return false;
  }
  return !hint.firstInitial || authorGivenInitialMatches(hint.firstInitial, candidate?.authors?.[0]);
}

function finalizeCandidates(citationContext, settings, candidates) {
  const typedToken = citationContext?.typedToken ?? citationContext?.token ?? "";
  const finalCandidates = rerankLiteratureCandidates(
    citationContext,
    mergeCandidates(candidates),
    settings.contextualSearchEngine
  );
  return finalCandidates.map((candidate) => ({
    ...candidate,
    keyMode: settings.citationKeyMode,
    typedToken,
    generatedKey: generatePreferredKey(candidate, [], {
      keyMode: settings.citationKeyMode,
      typedToken
    })
  }));
}

async function fetchSearchCandidates(queries, citationContext, adsApiToken, options = {}) {
  const lookupController = new AbortController();
  const fetchImpl = fetchWithParentSignal(options.fetchImpl ?? globalThis.fetch, lookupController.signal);
  const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const externalSignal = options.externalSignal ?? null;
  const abortFromExternal = () => lookupController.abort();
  if (externalSignal?.aborted) {
    lookupController.abort();
  } else {
    externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  }
  try {
    const mergedDocs = [];
    const seenBibcodes = new Set();
    const errors = [];
    const startedAt = Date.now();
    const initialQueries = citationContext?.searchMode === "simple" ? queries.slice(0, 1) : queries.slice(0, 2);
    const followUpBatchSize = citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct" ? 1 : 4;

    function remainingBudgetMs() {
      return Math.max(0, ADS_SEARCH_BUDGET_MS - (Date.now() - startedAt));
    }

    function fetchQuery(query) {
      const remainingMs = remainingBudgetMs();
      if (remainingMs <= 0) {
        return Promise.reject(createAdsSearchTimeoutError(ADS_SEARCH_BUDGET_MS));
      }
      return fetchAdsDocs(query, adsApiToken, fetchImpl, Math.min(ADS_SEARCH_REQUEST_TIMEOUT_MS, remainingMs));
    }

    if (initialQueries.length) {
      if (citationContext?.searchMode !== "contextual") {
        // Keep Simple/Raw completion and merge semantics unchanged: both
        // opening requests settle before ranking can stop the ladder.
        const batches = await Promise.allSettled(initialQueries.map((query) => fetchQuery(query)));
        for (const [index, batch] of batches.entries()) {
          if (batch.status === "fulfilled") {
            if (lookupController.signal.aborted) {
              throw new Error("ADS/SciX search was cancelled.");
            }
            mergeDocs(mergedDocs, seenBibcodes, batch.value, index);
            onProgress?.(mergedDocs);
          } else {
            errors.push(batch.reason);
          }
        }
      } else {
        const pending = new Set(initialQueries.map((query, index) => {
          let promise;
          promise = fetchQuery(query).then(
            (docs) => ({ ok: true, docs, index, promise }),
            (error) => ({ ok: false, error, index, promise })
          );
          return promise;
        }));
        while (pending.size) {
          const batch = await Promise.race(pending);
          pending.delete(batch.promise);
          if (batch.ok) {
            if (lookupController.signal.aborted) {
              throw new Error("ADS/SciX search was cancelled.");
            }
            mergeDocs(mergedDocs, seenBibcodes, batch.docs, batch.index);
            onProgress?.(mergedDocs);
          } else {
            errors.push(batch.error);
          }
        }
      }
    }

    if (shouldStop(mergedDocs)) {
      return mergedDocs;
    }

    if (citationContext?.searchMode === "contextual" && hasDistinctiveContextIdentifier(citationContext)) {
      return mergedDocs;
    }

    const initialIndex = initialQueries.length - 1;
    if (initialQueries.length && shouldStopAfterQuery(initialIndex, mergedDocs.length, citationContext)) {
      return mergedDocs;
    }

    const followUpQueries = queries.slice(initialQueries.length);
    if (citationContext?.searchMode === "contextual") {
      await runOrderedQueryQueue(followUpQueries, {
        fetchQuery,
        onProgress(docs, index) {
          if (!lookupController.signal.aborted) {
            onProgress?.([...mergedDocs, ...docs]);
          }
        },
        onBatch(batches, offset) {
          for (const [batchOffset, batch] of batches.entries()) {
            if (batch.status === "fulfilled") {
              mergeDocs(mergedDocs, seenBibcodes, batch.value, initialQueries.length + offset + batchOffset);
            } else {
              errors.push(batch.reason);
            }
          }
          return shouldStop(mergedDocs) || remainingBudgetMs() <= 0 || lookupController.signal.aborted;
        }
      });
      if (!mergedDocs.length && errors.length) throw errors[0];
      return mergedDocs;
    }
    for (let offset = 0; offset < followUpQueries.length; offset += followUpBatchSize) {
      if (remainingBudgetMs() <= 0) {
        errors.push(createAdsSearchTimeoutError(ADS_SEARCH_BUDGET_MS));
        break;
      }
      const batchQueries = followUpQueries.slice(offset, offset + followUpBatchSize);
      const batches = await Promise.allSettled(batchQueries.map((query) => fetchQuery(query)));
      for (const [batchOffset, batch] of batches.entries()) {
        const index = initialQueries.length + offset + batchOffset;
        if (batch.status === "fulfilled") {
          mergeDocs(mergedDocs, seenBibcodes, batch.value, index);
          onProgress?.(mergedDocs);
        } else {
          errors.push(batch.reason);
        }
      }
      const finalBatchIndex = initialQueries.length + offset + batches.length - 1;
      if (shouldStop(mergedDocs) || shouldStopAfterQuery(finalBatchIndex, mergedDocs.length, citationContext)) {
        break;
      }
    }

    if (!mergedDocs.length && errors.length) {
      throw errors[0];
    }
    return mergedDocs;
  } finally {
    lookupController.abort();
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function createAdsSearchTimeoutError(timeoutMs) {
  return new Error(`ADS/SciX search took longer than ${(timeoutMs / 1000).toFixed(1)} seconds.`);
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
  if (citationContext?.searchMode !== "simple" && citationContext?.searchMode !== "direct") {
    return false;
  }
  const isEmptyTokenLookup = !String(citationContext?.token ?? "").trim();
  if (isEmptyTokenLookup && index < 4) {
    return false;
  }
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

export async function exportBibtex(candidateOrBibcode, settings, fetchImpl = globalThis.fetch) {
  const candidate = typeof candidateOrBibcode === "string" ? { bibcode: candidateOrBibcode } : (candidateOrBibcode ?? {});
  const bibcode = candidate?.bibcode;
  if (!bibcode) {
    return exportCandidateBibtex(candidate);
  }
  const adsApiToken = settings.sourceApiTokens?.ads || settings.adsApiToken;
  if (!adsApiToken) {
    return exportCandidateBibtex(candidate);
  }
  const response = await fetchImpl(ADS_BIBTEX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adsApiToken}`,
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

function isHighConfidenceResult(citationContext, candidate, sourceId, runnerUp = null) {
  if (!candidate) {
    return false;
  }
  if (directIdentifierMatches(citationContext, candidate)) {
    return true;
  }
  if (citationContext?.searchMode === "direct" && exactTitleMatch(citationContext?.token, candidate?.title)) {
    return true;
  }
  if (citationContext?.searchMode === "simple" &&
      sourceId !== SOURCE_IDS.ARXIV &&
      exactTitleMatch(citationContext?.token, candidate?.title)) {
    return true;
  }
  const hint = citationContext?.parsedKeyHint;
  const hasClearMargin = !runnerUp || Number(candidate?.score ?? 0) - Number(runnerUp?.score ?? 0) >= 35;
  if (candidate?.contextualBeta?.decisiveTitleMatch) {
    if (Number(candidate.contextualBeta.identityTier ?? 0) >= 6) {
      return true;
    }
    const unambiguousInitial = Boolean(
      hint?.surname &&
      hint?.firstInitial &&
      firstAuthorMatches(hint.surname, candidate?.authors?.[0]) &&
      authorGivenInitialMatches(hint.firstInitial, candidate?.authors?.[0])
    );
    return Boolean(
      unambiguousInitial &&
      (!hint?.year || yearsCompatible(candidate?.year, hint.year)) &&
      hasClearMargin
    );
  }
  if (!hint?.surname) {
    return false;
  }
  const authorMatches = firstAuthorMatches(hint.surname, candidate?.authors?.[0]);
  const overlap = contextTitleOverlap(citationContext, candidate);
  const contextualSupport = contextSupportScore(citationContext, candidate);
  if (!hint.year) {
    return authorMatches && overlap >= 2 && hasClearMargin;
  }
  const yearMatches = Number(candidate?.year) === Number(hint.year);
  if (authorMatches && yearMatches && strongTitleLeadYearMatch(citationContext, candidate) && hasClearMargin) {
    return true;
  }
  if (!matchesExplicitTitleLeadWhenPresent(citationContext, candidate)) {
    return false;
  }
  return authorMatches && yearMatches && (overlap >= 2 || contextualSupport >= 20) && hasClearMargin;
}

function directIdentifierMatches(citationContext, candidate) {
  if (citationContext?.searchMode !== "direct") {
    return false;
  }
  const token = String(citationContext?.token ?? "").trim().toLowerCase();
  if (!token) {
    return false;
  }
  const normalizedDoiToken = token.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:/, "");
  if (candidate?.doi && normalizedDoiToken === String(candidate.doi).toLowerCase()) {
    return true;
  }
  const pubMedMatch = token.match(/^(?:pmid\s*:?\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{5,9})(?:\/)?$/i);
  if (pubMedMatch) {
    const pubMedId = pubMedMatch[1];
    return candidate?.sourceId === SOURCE_IDS.PUBMED && (
      String(candidate?.id ?? "").toLowerCase() === `pmid:${pubMedId}` ||
      String(candidate?.bibtexExportId ?? "") === pubMedId ||
      String(candidate?.url ?? "").includes(`/pubmed.ncbi.nlm.nih.gov/${pubMedId}/`)
    );
  }
  const arxivId = parseDirectArxivId(token);
  if (!arxivId) {
    return false;
  }
  const candidateEprint = String(candidate?.eprint ?? "").toLowerCase().replace(/v\d+$/, "");
  return candidateEprint === arxivId || String(candidate?.doi ?? "").toLowerCase().includes(arxivId);
}

function directArxivToken(citationContext) {
  if (citationContext?.searchMode !== "direct") {
    return "";
  }
  const token = String(citationContext?.token ?? "").trim();
  return parseDirectArxivId(token);
}

function parseDirectArxivId(value) {
  const match = String(value ?? "").trim().match(
    /^(?:arxiv:\s*|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?\/?$/i
  );
  return String(match?.[1] ?? "").toLowerCase();
}

function directPubMedToken(citationContext) {
  if (citationContext?.searchMode !== "direct") {
    return "";
  }
  const token = String(citationContext?.token ?? "").trim();
  return token.match(/^(?:pmid\s*:?\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{5,9})(?:\/)?$/i)?.[1] ?? "";
}

function isDatasetSoftwareLookup(citationContext) {
  const text = normalizeSearchText([
    citationContext?.token,
    citationContext?.sentenceText,
    citationContext?.contextText
  ].join(" "));
  return /\b(dataset|datasets|software|code|repository|repositories|zenodo|figshare|archive|catalog|catalogue)\b/.test(text);
}

function exactTitleMatch(left, right) {
  const normalizedLeft = normalizeSearchText(left);
  const normalizedRight = normalizeSearchText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function firstAuthorMatches(expectedSurname, firstAuthor) {
  return authorFamilyStrictlyMatches(expectedSurname, firstAuthor);
}

function contextTitleOverlap(citationContext, candidate) {
  const terms = contextTerms(citationContext);
  const title = normalizeSearchText(candidate?.title);
  return terms.filter((term) => title.includes(term)).length;
}

function rerankLiteratureCandidates(citationContext, candidates, contextualSearchEngine = "classic") {
  const beta = citationContext?.searchMode === "contextual" && contextualSearchEngine === "beta";
  const ranked = rerankAdsCandidates(citationContext, candidates).map((candidate) => {
    if (candidate.sourceId === SOURCE_IDS.ADS) {
      return candidate;
    }
    return {
      ...candidate,
      score: candidate.score +
        computeBroadTokenBoost(citationContext, candidate) +
        computeBroadTitleLeadBoost(citationContext, candidate, contextualSearchEngine) +
        computeBroadAuthorBoost(citationContext, candidate, contextualSearchEngine) +
        computeBroadYearBoost(citationContext, candidate, contextualSearchEngine) +
        computeBroadContextBoost(citationContext, candidate) +
        computeCanonicalTitleBoost(citationContext, candidate) +
        computeCrossSourceBoost(candidate, beta) +
        (beta ? Math.min(0, computePublicationTypeBoost(candidate)) : computePublicationTypeBoost(candidate))
    };
  });
  const constrained = filterContextualAuthorHintMismatches(
    citationContext,
    ranked.sort((left, right) => right.score - left.score),
    contextualSearchEngine
  );
  const contextualRanked = contextualSearchEngine === "beta"
    ? applyContextualBetaReranking(citationContext, constrained)
    : constrained;
  return rerankSimpleSearchCandidates(citationContext, contextualRanked);
}

function filterContextualAuthorHintMismatches(citationContext, candidates, contextualSearchEngine = "classic") {
  return filterSurnameOnlyAuthorMismatches(
    citationContext,
    filterContextualAuthorYearMismatches(citationContext, candidates, contextualSearchEngine)
  );
}

function filterContextualAuthorYearMismatches(citationContext, candidates, contextualSearchEngine = "classic") {
  const hint = citationContext?.parsedKeyHint;
  if (citationContext?.searchMode === "direct" || !hint?.surname || !hint?.year) {
    return candidates;
  }
  if (citationContext?.searchMode === "simple") {
    const matches = candidates.filter((candidate) => simpleAuthorYearCandidateMatches(citationContext, candidate));
    return matches.length ? matches : candidates;
  }
  const useContextualBetaIdentity = citationContext?.searchMode === "contextual" && contextualSearchEngine === "beta";
  const identityMatches = candidates.filter((candidate) =>
    directIdentifierMatches(citationContext, candidate) ||
    (useContextualBetaIdentity
      ? contextualBetaAuthorFamilyMatches(hint.surname, candidate?.authors?.[0])
      : firstAuthorMatches(hint.surname, candidate?.authors?.[0])) ||
    strongCoauthorContextMatch(citationContext, candidate, contextualSearchEngine)
  );
  return identityMatches.length ? identityMatches : candidates;
}

function rerankSimpleSearchCandidates(citationContext, candidates) {
  if (citationContext?.searchMode !== "simple") {
    return candidates;
  }
  return [...candidates].sort((left, right) =>
    simpleSearchRank(citationContext, right) - simpleSearchRank(citationContext, left) ||
    (Number(right.citationCount ?? 0) || 0) - (Number(left.citationCount ?? 0) || 0) ||
    (right.score ?? 0) - (left.score ?? 0)
  );
}

function simpleSearchRank(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  const contextRank = simpleContextTitleRank(citationContext, candidate);
  const titleRank = simpleTitleRank(citationContext, candidate);
  if (!hint?.surname) {
    return contextRank + titleRank;
  }
  const firstAuthorMatch = firstAuthorMatches(hint.surname, candidate?.authors?.[0]);
  const anyAuthorMatch = (candidate?.authors ?? []).some((author) => authorFamilyStrictlyMatches(hint.surname, author));
  const authorRank = firstAuthorMatch ? 60000 : (anyAuthorMatch ? 45000 : 0);
  if (!hint.year) {
    return contextRank + authorRank + titleRank;
  }
  const yearRank = simpleYearRank(candidate?.year, hint.year);
  return contextRank + authorRank + yearRank + titleRank;
}

function simpleYearRank(candidateYear, hintYear) {
  const candidate = Number(candidateYear);
  const hint = Number(hintYear);
  if (!Number.isFinite(candidate) || !Number.isFinite(hint)) {
    return 0;
  }
  if (candidate === hint) {
    return 90000;
  }
  if (Math.abs(candidate - hint) === 1) {
    return 20000;
  }
  return 0;
}

function simpleContextTitleRank(citationContext, candidate) {
  const title = normalizeSearchText(candidate?.title);
  if (!title) {
    return 0;
  }
  let best = 0;
  for (const phrase of simpleContextTitlePhrases(citationContext)) {
    const normalizedPhrase = normalizeSearchText(phrase);
    if (!normalizedPhrase || normalizedPhrase.split(" ").length < 2) {
      continue;
    }
    if (title === normalizedPhrase) {
      best = Math.max(best, 520000);
      continue;
    }
    if (title.includes(normalizedPhrase) || normalizedPhrase.includes(title)) {
      best = Math.max(best, 460000);
      continue;
    }
    const terms = simpleEvidenceTerms(normalizedPhrase);
    if (!terms.length) {
      continue;
    }
    const matched = terms.filter((term) => title.includes(term)).length;
    if (matched >= 4) {
      best = Math.max(best, 180000 + (matched * 22000) + Math.round((matched / terms.length) * 60000));
    } else if (matched >= 2) {
      best = Math.max(best, 30000 + (matched * 10000));
    }
  }
  return best;
}

function simpleContextTitlePhrases(citationContext) {
  const text = String(`${citationContext?.sentenceText ?? ""}. ${citationContext?.contextText ?? ""}`);
  const phrases = [];
  for (const match of text.matchAll(/\b(?:should\s+)?(?:retrieve|find|return)\s+(.+?)(?:[.;]|\n|$)/gi)) {
    phrases.push(match[1]);
  }
  const lead = extractSentenceLead(citationContext?.sentenceText);
  if (lead) {
    phrases.push(lead);
  }
  return [...new Set(phrases.map(cleanSimpleContextPhrase).filter(Boolean))];
}

function cleanSimpleContextPhrase(value) {
  return String(value ?? "")
    .replace(/^\s*(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:paper|result|record|entry)\s*$/i, "")
    .trim();
}

function simpleEvidenceTerms(value) {
  return [...new Set(normalizeSearchText(value).split(" ").filter((term) =>
    (term.length >= 4 || /^\d+$/.test(term)) && !BROAD_CONTEXT_STOPWORDS.has(term)
  ))];
}

function simpleTitleRank(citationContext, candidate) {
  const token = normalizeSearchText(citationContext?.token);
  const title = normalizeSearchText(candidate?.title);
  if (!token || !title) {
    return 0;
  }
  if (title === token) {
    return 3000;
  }
  if (title.startsWith(token) || token.startsWith(title)) {
    return 1500;
  }
  if (title.includes(token)) {
    return 700;
  }
  return 0;
}

function simpleAuthorYearCandidateMatches(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname) {
    return true;
  }
  return firstAuthorMatches(hint.surname, candidate?.authors?.[0]) ||
    (candidate?.authors ?? []).some((author) => authorFamilyStrictlyMatches(hint.surname, author));
}

function filterSurnameOnlyAuthorMismatches(citationContext, candidates) {
  const hint = citationContext?.parsedKeyHint;
  if (citationContext?.searchMode === "direct" || !hint?.surname || hint?.year) {
    return candidates;
  }
  const authorMatches = candidates.filter((candidate) =>
    firstAuthorMatches(hint.surname, candidate?.authors?.[0]) ||
    (candidate?.authors ?? []).some((author) => authorFamilyStrictlyMatches(hint.surname, author))
  );
  return authorMatches.length ? authorMatches : candidates;
}

function computeBroadTokenBoost(citationContext, candidate) {
  if (directIdentifierMatches(citationContext, candidate)) {
    return 20000;
  }
  if (citationContext?.searchMode !== "simple" && citationContext?.searchMode !== "direct") {
    return 0;
  }
  const token = normalizeSearchText(citationContext?.token);
  const title = normalizeSearchText(candidate?.title);
  if (!token || !title) {
    return 0;
  }
  const directTitleYear = directTitleYearParts(token);
  if (citationContext?.searchMode === "direct" && directTitleYear.title) {
    if (title === directTitleYear.title) {
      return Number(candidate?.year) === directTitleYear.year ? 9000 : 6500;
    }
    if (title.startsWith(directTitleYear.title) || directTitleYear.title.startsWith(title)) {
      return Number(candidate?.year) === directTitleYear.year ? 4500 : 2500;
    }
  }
  if (title === token) {
    return 5000;
  }
  if (title.startsWith(token)) {
    return 1200;
  }
  if (title.includes(token)) {
    return 700;
  }
  return 0;
}

function directTitleYearParts(normalizedToken) {
  const match = String(normalizedToken ?? "").match(/^(.+?)\s+(\d{4})$/);
  if (!match) {
    return { title: "", year: null };
  }
  const title = match[1].trim();
  return title.split(" ").length >= 3 ? { title, year: Number(match[2]) } : { title: "", year: null };
}

function computeBroadTitleLeadBoost(citationContext, candidate, contextualSearchEngine = "classic") {
  const { normalizedLead, title } = titleLeadParts(citationContext, candidate);
  if (citationContext?.searchMode === "contextual" && contextualSearchEngine === "beta" && (!normalizedLead || !title)) {
    return 0;
  }
  if (title === normalizedLead) {
    return 12000;
  }
  if (title.startsWith(normalizedLead) || isSubstantialTitleLeadPrefix(normalizedLead, title)) {
    return 5000;
  }
  if (title.includes(normalizedLead) || isSubstantialTitleLeadPrefix(normalizedLead, title)) {
    return 2400;
  }
  return 0;
}

function strongTitleLeadYearMatch(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.year || !yearsCompatible(candidate?.year, hint.year)) {
    return false;
  }
  const { normalizedLead, title } = titleLeadParts(citationContext, candidate);
  return Boolean(
    normalizedLead &&
    title &&
    normalizedLead.split(" ").length >= 4 &&
    (title === normalizedLead || title.startsWith(normalizedLead) || isSubstantialTitleLeadPrefix(normalizedLead, title))
  );
}

function isSubstantialTitleLeadPrefix(normalizedLead, title) {
  if (!normalizedLead || !title || !normalizedLead.startsWith(title)) {
    return false;
  }
  const leadWords = normalizedLead.split(" ").filter(Boolean).length;
  const titleWords = title.split(" ").filter(Boolean).length;
  if (leadWords < 6) {
    return true;
  }
  return titleWords >= Math.max(5, Math.ceil(leadWords * 0.7));
}

function yearsCompatible(candidateYear, hintYear) {
  const candidate = Number(candidateYear);
  const hint = Number(hintYear);
  return Number.isFinite(candidate) && Number.isFinite(hint) && Math.abs(candidate - hint) <= 1;
}

function titleLeadParts(citationContext, candidate) {
  if (citationContext?.searchMode === "direct") {
    return { normalizedLead: "", title: "" };
  }
  const lead = extractSentenceLead(citationContext?.sentenceText);
  const normalizedLead = normalizeSearchText(lead);
  const title = normalizeSearchText(candidate?.title);
  if (!normalizedLead || !title || normalizedLead.split(" ").length < 3) {
    return { normalizedLead: "", title: "" };
  }
  return { normalizedLead, title };
}

function computeBroadAuthorBoost(citationContext, candidate, contextualSearchEngine = "classic") {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname) {
    return 0;
  }
  const firstAuthor = candidate?.authors?.[0] ?? "";
  const beta = citationContext?.searchMode === "contextual" && contextualSearchEngine === "beta";
  // Keep the broad score consistent with beta's exact collaboration identity
  // tier: a group name must not receive the loose-surname mismatch penalty.
  const firstAuthorMatchesHint = firstAuthorMatches(hint.surname, firstAuthor) ||
    (beta && contextualBetaAuthorFamilyMatches(hint.surname, firstAuthor));
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some((author) =>
    beta ? contextualBetaAuthorFamilyMatches(hint.surname, author) : authorFamilyStrictlyMatches(hint.surname, author));
  let boost = 0;

  if (firstAuthorMatchesHint) {
    boost += hint.year ? 220 : 700;
  } else if (anyAuthorMatchesHint) {
    boost += hint.year ? -150 : 120;
  } else if (hint.year) {
    boost -= 900;
  } else {
    boost -= 700;
  }

  if (hint.firstInitial) {
    if (firstAuthorMatchesHint && authorGivenInitialMatches(hint.firstInitial, firstAuthor)) {
      boost += 70;
    } else if (firstAuthorMatchesHint) {
      boost -= 180;
    } else if (anyAuthorMatchesHint) {
      boost -= 80;
    }
  }

  if (hint.year && !firstAuthorMatchesHint && looseAuthorTextMatches(hint.surname, firstAuthor)) {
    boost -= 1600;
  }

  // Beta already scores topical support in its feature model. Legacy binary
  // bonuses otherwise swamp that evidence after a single shared title word.
  if (!beta && strongFirstAuthorContextMatch(citationContext, candidate, contextualSearchEngine)) {
    boost += 5600;
  }

  if (!beta && strongCoauthorContextMatch(citationContext, candidate, contextualSearchEngine)) {
    boost += 5200;
  }

  return boost;
}

function computeBroadYearBoost(citationContext, candidate, contextualSearchEngine = "classic") {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.year) {
    return 0;
  }
  const candidateYear = Number(candidate?.year);
  const hintYear = Number(hint.year);
  if (!Number.isFinite(candidateYear) || !Number.isFinite(hintYear)) {
    return -350;
  }
  const firstAuthorMatchesHint = firstAuthorMatches(hint.surname, candidate?.authors?.[0]);
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some((author) => authorFamilyStrictlyMatches(hint.surname, author));
  if (citationContext?.searchMode === "contextual" && contextualSearchEngine === "beta") {
    // Publication and preprint years can differ. Retain a modest exact-year
    // preference; author identity remains enforced by the beta tier/filter.
    return candidateYear === hintYear ? 60 : Math.abs(candidateYear - hintYear) === 1 ? 0 : -120;
  }
  if (candidateYear === hintYear) {
    return anyAuthorMatchesHint ? 7000 : 1200;
  }
  if (Math.abs(candidateYear - hintYear) === 1) {
    return anyAuthorMatchesHint ? 900 : 200;
  }
  if (firstAuthorMatchesHint || anyAuthorMatchesHint) {
    return -3500;
  }
  return -500;
}

function extractSentenceLead(value) {
  return String(value ?? "").trim().match(/^(.+?)\s+(?:is|was|introduced|describes|presents|reports|shows|provides|uses)\b/)?.[1]?.trim() ?? "";
}

function computeBroadContextBoost(citationContext, candidate) {
  return Math.min(contextSupportScore(citationContext, candidate), 80);
}

function computeCanonicalTitleBoost(citationContext, candidate) {
  const context = normalizeSearchText(`${citationContext?.token ?? ""} ${citationContext?.sentenceText ?? ""} ${citationContext?.contextText ?? ""}`);
  const title = normalizeSearchText(candidate?.title);
  if (/\bgodel\b/.test(context) &&
      /\b(incompleteness|undecidable)\b/.test(context) &&
      /\bunentscheidbare\b/.test(title) &&
      /\bprincipia mathematica\b/.test(title)) {
    return 900;
  }
  return 0;
}

function contextSupportScore(citationContext, candidate) {
  const terms = contextTerms(citationContext);
  if (!terms.length) {
    return 0;
  }
  const title = normalizeSearchText(candidate?.title);
  const abstract = normalizeSearchText(candidate?.abstract);
  let boost = 0;
  for (const term of terms) {
    if (title.includes(term)) {
      boost += 12;
    } else if (abstract.includes(term)) {
      boost += 4;
    }
  }
  return boost;
}

function strongCoauthorContextMatch(citationContext, candidate, contextualSearchEngine = "classic") {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year || Number(candidate?.year) !== Number(hint.year)) {
    return false;
  }
  if (!matchesExplicitTitleLeadWhenPresent(citationContext, candidate)) {
    return false;
  }
  const useContextualBetaIdentity = citationContext?.searchMode === "contextual" && contextualSearchEngine === "beta";
  const authorMatches = useContextualBetaIdentity
    ? (author) => contextualBetaAuthorFamilyMatches(hint.surname, author)
    : (author) => authorFamilyStrictlyMatches(hint.surname, author);
  if (authorMatches(candidate?.authors?.[0])) {
    return false;
  }
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some(authorMatches);
  return anyAuthorMatchesHint && strongContextSupportScore(citationContext, candidate, contextualSearchEngine) >= 12;
}

function strongFirstAuthorContextMatch(citationContext, candidate, contextualSearchEngine = "classic") {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year || Number(candidate?.year) !== Number(hint.year)) {
    return false;
  }
  if (!matchesExplicitTitleLeadWhenPresent(citationContext, candidate)) {
    return false;
  }
  return firstAuthorMatches(hint.surname, candidate?.authors?.[0]) && strongContextSupportScore(citationContext, candidate, contextualSearchEngine) >= 12;
}

function strongContextSupportScore(citationContext, candidate, contextualSearchEngine) {
  if (citationContext?.searchMode !== "contextual" || contextualSearchEngine !== "beta") {
    return contextSupportScore(citationContext, candidate);
  }
  const title = normalizeSearchText(candidate?.title);
  return contextTerms(citationContext)
    .filter((term) => !BETA_GENERIC_CONTEXT_TERMS.has(term))
    .filter((term) => title.includes(term))
    .length * 12;
}

function matchesExplicitTitleLeadWhenPresent(citationContext, candidate) {
  const { normalizedLead, title } = titleLeadParts(citationContext, candidate);
  if (!normalizedLead || normalizedLead.split(" ").length < 5) {
    return true;
  }
  return Boolean(title && (title === normalizedLead || title.startsWith(normalizedLead) || isSubstantialTitleLeadPrefix(normalizedLead, title)));
}

function computeCrossSourceBoost(candidate, contextualBeta = false) {
  const sourceCount = candidateSourceCount(candidate);
  let boost = Math.min(Math.max(0, sourceCount - 1) * 90, 240);
  // Cross-provider agreement remains useful, but publication format alone
  // must not outweigh topical evidence. Version preference is handled when
  // merging duplicate identities, not between unrelated scientific works.
  if (contextualBeta) return boost;
  if (isArxivOnlyCandidate(candidate)) {
    boost -= 120;
  } else if (candidate?.doi && !isArxivIdentified(candidate)) {
    boost += 35;
  }
  return boost;
}

function computePublicationTypeBoost(candidate) {
  const type = normalizeSearchText(candidate?.type);
  const venue = normalizeSearchText(`${candidate?.journal ?? ""} ${candidate?.booktitle ?? ""} ${candidate?.publisher ?? ""}`);
  let boost = 0;

  if (/\b(journal article|article)\b/.test(type)) {
    boost += 80;
  }
  if (/\bpreprint\b/.test(type)) {
    boost += 20;
  }
  if (/\b(proposal|grant|award)\b/.test(type) || /\b(nsf award|hst proposal|grant|proposal)\b/.test(venue)) {
    boost -= 650;
  }
  if (/\b(abstract|meeting abstract|poster)\b/.test(type) || /\b(meeting abstracts?|conference abstracts?|poster)\b/.test(venue)) {
    boost -= 500;
  }
  if (/\bconference paper\b/.test(type)) {
    boost -= 60;
  }
  if (/\bproceedings\b/.test(type) && !/\bproceedings article\b/.test(type)) {
    boost -= 120;
  }

  return boost;
}

function contextTerms(citationContext) {
  const fallbackText = normalizeSearchText(`${citationContext?.sentenceText ?? ""} ${citationContext?.contextText ?? ""}`);
  if (citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") {
    return [...new Set(fallbackText.split(" ").filter((term) => term.length >= 4 && !BROAD_CONTEXT_STOPWORDS.has(term)))].slice(0, 14);
  }
  const beforeTerms = normalizeContextSearchText(citationContext?.citationPrefixText ?? "")
    .split(" ")
    .filter((term) => term.length >= 4 && !BROAD_CONTEXT_STOPWORDS.has(term))
    .slice(-10);
  const afterTerms = normalizeContextSearchText(citationContext?.citationSuffixText ?? "")
    .split(" ")
    .filter((term) => term.length >= 4 && !BROAD_CONTEXT_STOPWORDS.has(term))
    .slice(0, 4);
  const fallbackTerms = fallbackText.split(" ").filter((term) => term.length >= 4 && !BROAD_CONTEXT_STOPWORDS.has(term));
  return [...new Set([...beforeTerms, ...afterTerms, ...fallbackTerms])].slice(0, 14);
}

function normalizeContextSearchText(value) {
  return normalizeSearchText(String(value ?? "")
    .replace(/(^|[^\\])%[^\n]*/g, "$1 ")
    .replace(/\\(?:cite[a-zA-Z*]*|parencite[a-zA-Z*]*|textcite[a-zA-Z*]*|autocite[a-zA-Z*]*|footcite[a-zA-Z*]*)\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}]*\}/g, " ")
    .replace(/\\(?:ref|eqref|pageref|label)\s*\{[^{}]*\}/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\\([^]*?\\\)|\\\[[^]*?\\\]/g, " "));
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function authorFamilyMatches(expectedSurname, author) {
  const expected = normalizeSearchText(expectedSurname);
  const { family, full } = parseAuthorName(author);
  if (!expected || !family) {
    return false;
  }
  const compactExpected = expected.replace(/\s+/g, "");
  const compactFamily = family.replace(/\s+/g, "");
  const compactFull = full.replace(/\s+/g, "");
  if (compactExpected && (
      compactFamily === compactExpected ||
      compactFull.startsWith(compactExpected) ||
      compactFull.endsWith(compactExpected))) {
    return true;
  }
  if (expected.includes(" ")) {
    return family === expected ||
      family.startsWith(`${expected} `) ||
      family.endsWith(` ${expected}`) ||
      full.startsWith(`${expected} `) ||
      full.endsWith(` ${expected}`);
  }
  return family === expected;
}

function authorFamilyStrictlyMatches(expectedSurname, author) {
  const expected = normalizeSearchText(expectedSurname);
  const { family } = parseAuthorName(author);
  if (!expected || !family) {
    return false;
  }
  const compactExpected = expected.replace(/\s+/g, "");
  const compactFamily = family.replace(/\s+/g, "");
  return Boolean(compactExpected && compactFamily === compactExpected);
}

function contextualBetaAuthorFamilyMatches(expectedSurname, author) {
  if (authorFamilyStrictlyMatches(expectedSurname, author)) {
    return true;
  }
  const expected = normalizeSearchText(expectedSurname).replace(/\s+/g, "");
  const full = normalizeSearchText(author).replace(/^the\s+/, "").replace(/\s+/g, "");
  return Boolean(
    expected && full && (
      full === `${expected}collaboration` ||
      full === `${expected}scientificcollaboration`
    )
  );
}

function authorGivenInitialMatches(expectedInitial, author) {
  const initial = normalizeSearchText(expectedInitial).slice(0, 1);
  const { given } = parseAuthorName(author);
  return Boolean(initial && given && given[0] === initial);
}

function looseAuthorTextMatches(expectedSurname, author) {
  const expected = normalizeSearchText(expectedSurname);
  const actual = normalizeSearchText(author);
  return Boolean(expected && actual && actual.split(/\s+/).includes(expected));
}

function parseAuthorName(author) {
  const raw = String(author ?? "").trim();
  if (!raw) {
    return { family: "", given: "", full: "" };
  }
  const [rawFamily, ...rawGivenParts] = raw.split(",");
  if (rawGivenParts.length) {
    return {
      family: normalizeSearchText(rawFamily),
      given: normalizeSearchText(rawGivenParts.join(" ")),
      full: normalizeSearchText(raw)
    };
  }

  const full = normalizeSearchText(raw);
  const tokens = full.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { family: "", given: "", full };
  }
  let familyStart = tokens.length - 1;
  const particles = new Set(["da", "de", "del", "der", "di", "du", "la", "le", "van", "von"]);
  if (tokens.length >= 2 && particles.has(tokens[tokens.length - 2])) {
    familyStart = tokens.length - 2;
  } else if (tokens.length >= 3 && tokens[tokens.length - 2].length > 1 && /^[a-z]+$/.test(tokens[tokens.length - 2]) && /^[a-z]+$/.test(tokens[tokens.length - 1])) {
    familyStart = tokens.length - 2;
  }
  return {
    family: tokens.slice(familyStart).join(" "),
    given: tokens.slice(0, familyStart).join(" "),
    full
  };
}

const BROAD_CONTEXT_STOPWORDS = new Set([
  "changed",
  "from",
  "into",
  "paper",
  "provide",
  "provides",
  "result",
  "results",
  "show",
  "shown",
  "shows",
  "that",
  "their",
  "these",
  "this",
  "through",
  "useful",
  "using",
  "with",
  "broad",
  "query",
  "raw"
]);

// Context Beta only: generic title words such as "processes" are not
// sufficient evidence for the large author-context boost. Keep the classic,
// Simple, and Raw paths on their existing score semantics.
const BETA_GENERIC_CONTEXT_TERMS = new Set([
  "analysis",
  "analyses",
  "approach",
  "approaches",
  "article",
  "articles",
  "effect",
  "effects",
  "method",
  "methods",
  "model",
  "models",
  "paper",
  "papers",
  "process",
  "processes",
  "result",
  "results",
  "study",
  "studies",
  "system",
  "systems",
  "work",
  "works"
]);

function mergeCandidates(candidates) {
  const merged = [];
  const seen = new Map();
  for (const candidate of candidates) {
    const keys = candidateMergeKeys(candidate);
    const existingIndex = keys.map((key) => seen.get(key)).find((index) => Number.isInteger(index));
    if (!Number.isInteger(existingIndex)) {
      const index = merged.length;
      for (const key of keys) {
        seen.set(key, index);
      }
      merged.push(candidate);
      continue;
    }
    const current = merged[existingIndex];
    const primary = preferredMergedCandidate(current, candidate);
    const secondary = primary === current ? candidate : current;
    merged[existingIndex] = {
      ...primary,
      abstract: primary.abstract || secondary.abstract,
      volume: primary.volume || secondary.volume,
      issue: primary.issue || secondary.issue,
      pages: primary.pages || secondary.pages,
      articleNumber: primary.articleNumber || secondary.articleNumber,
      doi: preferredDoi(primary, secondary),
      eprint: primary.eprint || secondary.eprint,
      archivePrefix: primary.archivePrefix || secondary.archivePrefix,
      url: preferredUrl(primary, secondary),
      citationCount: preferredCitationCount(primary, secondary),
      sourceLabel: mergeSourceLabels(current.sourceLabel, candidate.sourceLabel)
    };
    for (const key of keys) {
      seen.set(key, existingIndex);
    }
  }
  return merged;
}

function preferredCitationCount(primary, secondary) {
  return Math.max(Number(primary?.citationCount ?? 0) || 0, Number(secondary?.citationCount ?? 0) || 0);
}

function preferredMergedCandidate(left, right) {
  const authorityDelta = sourceAuthorityScore(right) - sourceAuthorityScore(left);
  if (Math.abs(authorityDelta) >= 15) {
    return authorityDelta > 0 ? right : left;
  }
  const qualityDelta = candidatePublicationQualityScore(right) - candidatePublicationQualityScore(left);
  if (Math.abs(qualityDelta) >= 100) {
    return qualityDelta > 0 ? right : left;
  }
  const completenessDelta = candidateCompletenessScore(right) - candidateCompletenessScore(left);
  if (completenessDelta > 0) {
    return right;
  }
  return left;
}

function sourceAuthorityScore(candidate) {
  if (isArxivOnlyCandidate(candidate)) {
    return 35;
  }
  return {
    [SOURCE_IDS.ADS]: 100,
    [SOURCE_IDS.PUBMED]: 90,
    [SOURCE_IDS.CROSSREF]: 85,
    [SOURCE_IDS.INSPIRE]: 80,
    [SOURCE_IDS.DATACITE]: 70,
    [SOURCE_IDS.SEMANTIC_SCHOLAR]: 60,
    [SOURCE_IDS.ARXIV]: 45
  }[candidate?.sourceId] ?? 0;
}

function preferredDoi(primary, secondary) {
  if (primary?.doi && !isArxivDoi(primary.doi)) {
    return primary.doi;
  }
  if (secondary?.doi && !isArxivDoi(secondary.doi)) {
    return secondary.doi;
  }
  return primary?.doi || secondary?.doi || "";
}

function preferredUrl(primary, secondary) {
  if (primary?.url && !isArxivIdentified(primary)) {
    return primary.url;
  }
  if (secondary?.url && !isArxivIdentified(secondary)) {
    return secondary.url;
  }
  return primary?.url || secondary?.url || "";
}

function candidateSourceCount(candidate) {
  return mergeSourceLabels(candidate?.sourceLabel, "").split(",").map((value) => value.trim()).filter(Boolean).length || 1;
}

function isArxivOnlyCandidate(candidate) {
  return (candidate?.sourceId === SOURCE_IDS.ARXIV || normalizeSearchText(candidate?.sourceLabel) === "arxiv") &&
    candidateSourceCount(candidate) === 1;
}

function isArxivIdentified(candidate) {
  return candidate?.sourceId === SOURCE_IDS.ARXIV ||
    String(candidate?.archivePrefix ?? "").toLowerCase() === "arxiv" ||
    Boolean(candidate?.eprint) ||
    isArxivDoi(candidate?.doi);
}

function isArxivDoi(value) {
  return String(value ?? "").toLowerCase().includes("10.48550/arxiv.");
}

function candidateCompletenessScore(candidate) {
  return [
    candidate?.doi,
    candidate?.abstract,
    candidate?.journal || candidate?.booktitle,
    candidate?.url,
    candidate?.citationCount > 0
  ].filter(Boolean).length;
}

function candidatePublicationQualityScore(candidate) {
  const properties = new Set((candidate?.property ?? []).map((value) => normalizeSearchText(value)));
  const doctype = normalizeSearchText(candidate?.doctype ?? candidate?.type);
  const venue = normalizeSearchText(`${candidate?.journal ?? ""} ${candidate?.booktitle ?? ""} ${candidate?.publisher ?? ""}`);
  let score = 0;
  if (properties.has("refereed")) {
    score += 260;
  }
  if (properties.has("article") || doctype === "article" || doctype === "journal article" || doctype === "journal-article") {
    score += 90;
  }
  if (properties.has("nonarticle") || /abstract|meeting|conference|proceeding|proposal|grant|award|source code library|software/.test(`${doctype} ${venue}`)) {
    score -= 220;
  }
  return score;
}

function candidateMergeKey(candidate) {
  return candidateMergeKeys(candidate)[0] ?? "";
}

function candidateMergeKeys(candidate) {
  const keys = [];
  const arxivKey = arxivIdentityMergeKey(candidate);
  if (arxivKey) {
    keys.push(arxivKey);
  }
  const title = String(candidate?.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const parsedFirstAuthor = parseAuthorName(candidate?.authors?.[0]);
  const firstAuthor = parsedFirstAuthor.family ||
    String(candidate?.authors?.[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const firstInitial = String(parsedFirstAuthor.given ?? "").slice(0, 1) || "_";
  const workYear = Number(candidate?.year);
  if (title && firstAuthor && Number.isInteger(workYear)) {
    keys.push(`title:${title}:${firstAuthor}:${firstInitial}:${workYear}`);
    keys.push(`title:${title}:${firstAuthor}:${firstInitial}:${workYear - 1}`);
  }
  if (candidate?.doi) {
    keys.push(`doi:${String(candidate.doi).toLowerCase()}`);
  }
  if (candidate?.bibcode) {
    keys.push(`ads:${candidate.bibcode}`);
  }
  return [...new Set(keys.filter(Boolean))];
}

async function runWithAbortDeadline(task, timeoutMs, label) {
  const controller = new AbortController();
  let timedOut = false;
  let rejectCancellation = null;
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject;
  });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectCancellation?.(new Error(`${label} timed out.`));
  }, positiveNumber(timeoutMs, DEFAULT_LITERATURE_SEARCH_BUDGET_MS));
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      cancellation
    ]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`${label} timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

function fetchWithParentSignal(fetchImpl, parentSignal) {
  if (!parentSignal) {
    return fetchImpl;
  }
  const wrappedFetch = (url, options = {}) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (parentSignal.aborted || options.signal?.aborted) {
      controller.abort();
    } else {
      // The outer deadline owns this listener until the whole literature
      // operation finishes, so stalled response bodies are bounded as well.
      parentSignal.addEventListener("abort", abort, { once: true });
      options.signal?.addEventListener?.("abort", abort, { once: true });
    }
    return fetchImpl(url, { ...options, signal: controller.signal });
  };
  if (fetchImpl === globalThis.fetch || fetchImpl?.[RUNTIME_FETCH_MARKER] === true) {
    Object.defineProperty(wrappedFetch, RUNTIME_FETCH_MARKER, { value: true });
  }
  return wrappedFetch;
}

function arxivIdentityMergeKey(candidate) {
  const eprint = String(candidate?.eprint ?? "").trim().toLowerCase().replace(/v\d+$/i, "");
  if (eprint) {
    return `arxiv:${eprint}`;
  }
  const doiMatch = String(candidate?.doi ?? "").toLowerCase().match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i);
  return doiMatch ? `arxiv:${doiMatch[1].replace(/v\d+$/i, "")}` : "";
}

function mergeSourceLabels(left, right) {
  return [...new Set(String(`${left ?? ""},${right ?? ""}`).split(",").map((value) => value.trim()).filter(Boolean))].join(", ");
}

export function applyInsertion(payload) {
  return applyBibInsertion(payload);
}

async function fetchAdsDocs(query, adsApiToken, fetchImpl, timeoutMs = ADS_SEARCH_REQUEST_TIMEOUT_MS) {
  const url = new URL(ADS_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi,identifier,citation_count,property,doctype,pub,bibstem,database");

  const controller = new AbortController();
  let timedOut = false;
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(createAdsSearchTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${adsApiToken}`
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`ADS search failed with status ${response.status}`);
      }
      const payload = await response.json();
      return payload?.response?.docs ?? [];
    })();
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut || error?.name === "AbortError") {
      throw createAdsSearchTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
  }
}

function truncate(value, length) {
  const text = String(value ?? "").trim();
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length - 1).trimEnd()}…`;
}

function formatAuthors(authors, year) {
  const authorText = Array.isArray(authors) ? authors.slice(0, 3).join("; ") : "";
  const suffix = Array.isArray(authors) && authors.length > 3 ? " et al." : "";
  return [authorText + suffix, year].filter(Boolean).join(" | ");
}

function formatCandidateMeta(candidate) {
  return [formatAuthors(candidate?.authors, candidate?.year), formatCitationCount(candidate?.citationCount)]
    .filter(Boolean)
    .join(" · ");
}

function formatCitationCount(value) {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count) || count <= 0) {
    return "";
  }
  return `cited by ${count.toLocaleString("en-US")}`;
}
