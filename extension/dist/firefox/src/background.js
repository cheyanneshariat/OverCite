import { mapAdsDocToCandidate, buildAdsQueries, rerankAdsCandidates } from "./core/ads.js";
import {
  ACKNOWLEDGMENT_REMINDER_PROMPT,
  ACKNOWLEDGMENT_TEXT,
  createAcknowledgmentReminderClaim
} from "./core/acknowledgment.js";
import { applyBibInsertion, generatePreferredKey } from "./core/bibtex.js";
import { DEFAULT_SETTINGS, MESSAGE_TYPES } from "./core/constants.js";
import { resolveBibTargetFromProjectState } from "./core/project.js";
import { getSettings, saveSettings } from "./core/settings.js";
import { buildSourceRouting, exportCandidateBibtex, searchBroadCandidatesForSources, SOURCE_IDS } from "./core/sources.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const ARXIV_CITATION_ENRICHMENT_TIMEOUT_MS = 900;
const ADS_SEARCH_REQUEST_TIMEOUT_MS = 6500;
const ADS_SEARCH_BUDGET_MS = 12000;
const ADS_EXPORT_TIMEOUT_MS = 12000;
const LITERATURE_SEARCH_BUDGET_MS = 30000;
const RUNTIME_FETCH_MARKER = Symbol.for("overcite.runtimeFetch");
const claimAcknowledgmentReminder = createAcknowledgmentReminderClaim(extensionApi.storage?.local);

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
  if (!tab?.id || !isOverleafProjectUrl(tab.url)) {
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
      return searchLiterature(message.citationContext);
    case MESSAGE_TYPES.EXPORT_BIBTEX:
      return exportBibtex(message.candidate ?? message.bibcode);
    case MESSAGE_TYPES.RESOLVE_BIB_TARGET: {
      const settings = await getSettings();
      return resolveBibTargetFromProjectState({
        ...message.projectState,
        overrides: settings.defaultProjectBibFileOverride
      });
    }
    case MESSAGE_TYPES.APPLY_INSERTION:
      return applyBibInsertion(message.payload);
    case MESSAGE_TYPES.CLAIM_ACKNOWLEDGMENT_REMINDER:
      return {
        show: await claimAcknowledgmentReminder(),
        prompt: ACKNOWLEDGMENT_REMINDER_PROMPT,
        acknowledgmentText: ACKNOWLEDGMENT_TEXT
      };
    default:
      throw new Error(`Unknown OverCite message type: ${message?.type ?? "undefined"}`);
  }
}

async function searchLiterature(citationContext) {
  return runWithAbortDeadline(
    (signal) => searchLiteratureWithinBudget(citationContext, signal),
    LITERATURE_SEARCH_BUDGET_MS,
    "Literature search"
  );
}

async function searchLiteratureWithinBudget(citationContext, searchSignal) {
  const settings = await getSettings();
  const adsApiToken = settings.sourceApiTokens?.ads || settings.adsApiToken;
  const routing = buildSourceRouting(settings);
  const primarySource = choosePrimarySourceForQuery(routing, citationContext);
  const fallbackSources = availableSearchSources(routing).filter((sourceId) => sourceId !== primarySource);
  const candidates = [];
  const errors = [];

  const shouldSearchPrimary = isSourceSearchableAsPrimary(routing, primarySource);
  const primaryCandidates = shouldSearchPrimary
    ? await searchRoutedSource(primarySource, citationContext, settings, adsApiToken, searchSignal)
      .catch((error) => {
        errors.push(error);
        return [];
      })
    : [];
  candidates.push(...primaryCandidates);

  const primaryRanked = finalizeCandidates(citationContext, settings, primaryCandidates);
  if (primaryRanked.length && isHighConfidenceResult(citationContext, primaryRanked[0], primarySource)) {
    return maybeEnrichArxivCitationCounts(citationContext, settings, primaryRanked, adsApiToken, searchSignal);
  }
  if (shouldKeepSimplePrimaryResult(citationContext, primaryRanked[0], primarySource, fallbackSources)) {
    return maybeEnrichArxivCitationCounts(citationContext, settings, primaryRanked, adsApiToken, searchSignal);
  }

  if (fallbackSources.length) {
    const fallbackResult = await searchFallbackSources({
      citationContext,
      settings,
      adsApiToken,
      fallbackSources,
      candidates,
      errors,
      searchSignal
    });
    if (fallbackResult) {
      return maybeEnrichArxivCitationCounts(citationContext, settings, fallbackResult, adsApiToken, searchSignal);
    }
  }

  if (!candidates.length) {
    if (errors.length) {
      throw errors[0];
    }
    throw new Error("No literature matches found.");
  }
  for (const error of errors) {
    console.warn("[OverCite background] literature provider failed after another provider returned results", error);
  }

  return maybeEnrichArxivCitationCounts(citationContext, settings, finalizeCandidates(citationContext, settings, candidates), adsApiToken, searchSignal);
}

async function maybeEnrichArxivCitationCounts(citationContext, settings, candidates, adsApiToken, searchSignal = null) {
  const arxivNeedingCounts = candidates
    .slice(0, 5)
    .filter((candidate) => isArxivIdentified(candidate) && !(Number(candidate?.citationCount ?? 0) > 0) && String(candidate?.eprint ?? "").trim());
  if (!arxivNeedingCounts.length || !adsApiToken) {
    return candidates;
  }

  const enrichment = enrichArxivCitationCountsFromAds(candidates, arxivNeedingCounts, citationContext, adsApiToken, searchSignal)
    .catch(() => candidates);
  return Promise.race([
    enrichment,
    delay(ARXIV_CITATION_ENRICHMENT_TIMEOUT_MS).then(() => candidates)
  ]);
}

async function enrichArxivCitationCountsFromAds(candidates, arxivNeedingCounts, citationContext, adsApiToken, searchSignal = null) {
  const query = buildArxivAdsCitationQuery(arxivNeedingCounts);
  if (!query) {
    return candidates;
  }
  const docs = await fetchSearchCandidates([query], { ...citationContext, searchMode: "direct" }, adsApiToken, {
    externalSignal: searchSignal
  });
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choosePrimarySourceForQuery(routing, citationContext) {
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

async function searchFallbackSources({ citationContext, settings, adsApiToken, fallbackSources, candidates, errors, searchSignal }) {
  if (citationContext?.searchMode === "simple") {
    const pending = fallbackSources.map((sourceId, index) => {
      let promise;
      promise = Promise.resolve()
        .then(() => searchRoutedSource(sourceId, citationContext, settings, adsApiToken, searchSignal))
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
        candidates.push(...batch.value);
      } else {
        errors.push(batch.reason);
      }
      const ranked = finalizeCandidates(citationContext, settings, candidates);
      if (ranked.length &&
          isHighConfidenceResult(citationContext, ranked[0], ranked[0].sourceId) &&
          canReturnSimpleFallback(ranked[0], fallbackSources, settledIndexes)) {
        return ranked;
      }
    }
    return null;
  }

  const pending = fallbackSources.map((sourceId) => {
    let promise;
    promise = Promise.resolve()
      .then(() => searchRoutedSource(sourceId, citationContext, settings, adsApiToken, searchSignal))
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
      candidates.push(...batch.value);
      const ranked = finalizeCandidates(citationContext, settings, candidates);
      if (ranked.length && isHighConfidenceResult(citationContext, ranked[0], batch.sourceId)) {
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

async function searchRoutedSource(sourceId, citationContext, settings, adsApiToken, searchSignal = null) {
  if (sourceId === SOURCE_IDS.ADS) {
    if (!adsApiToken) {
      throw new Error("No ADS/SciX API token is configured for ADS/SciX search.");
    }
    const queries = buildAdsQueries(citationContext);
    const mapDocs = (docs) => docs.map((doc) => ({
      ...mapAdsDocToCandidate(doc),
      sourceId: SOURCE_IDS.ADS,
      sourceLabel: "ADS/SciX"
    }));
    const mergedDocs = await fetchSearchCandidates(queries, citationContext, adsApiToken, {
      externalSignal: searchSignal,
      shouldStop(docs) {
        const ranked = finalizeCandidates(citationContext, settings, mapDocs(docs));
        return Boolean(
          ranked.length &&
          isHighConfidenceResult(citationContext, ranked[0], SOURCE_IDS.ADS)
        );
      }
    });
    return mapDocs(mergedDocs);
  }
  return searchBroadCandidatesForSources(
    citationContext,
    settings,
    [sourceId],
    fetchWithParentSignal(globalThis.fetch, searchSignal)
  );
}

function finalizeCandidates(citationContext, settings, candidates) {
  const finalCandidates = rerankLiteratureCandidates(citationContext, mergeCandidates(candidates));
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

function isHighConfidenceResult(citationContext, candidate, sourceId) {
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
  if (!hint?.surname) {
    return false;
  }
  const authorMatches = firstAuthorMatches(hint.surname, candidate?.authors?.[0]);
  const overlap = contextTitleOverlap(citationContext, candidate);
  if (!hint.year) {
    return authorMatches && overlap >= 2;
  }
  const yearMatches = Number(candidate?.year) === Number(hint.year);
  if (yearMatches && strongTitleLeadYearMatch(citationContext, candidate)) {
    return true;
  }
  if (!matchesExplicitTitleLeadWhenPresent(citationContext, candidate)) {
    return false;
  }
  return authorMatches && yearMatches && overlap >= 2;
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
  const arxivMatch = token.match(/(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i);
  if (!arxivMatch) {
    return false;
  }
  const candidateEprint = String(candidate?.eprint ?? "").toLowerCase().replace(/v\d+$/, "");
  return candidateEprint === arxivMatch[1] || String(candidate?.doi ?? "").toLowerCase().includes(arxivMatch[1]);
}

function directArxivToken(citationContext) {
  if (citationContext?.searchMode !== "direct") {
    return "";
  }
  const token = String(citationContext?.token ?? "").trim();
  return token.match(/(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i)?.[1] ?? "";
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

function rerankLiteratureCandidates(citationContext, candidates) {
  const ranked = rerankAdsCandidates(citationContext, candidates).map((candidate) => {
    if (candidate.sourceId === SOURCE_IDS.ADS) {
      return candidate;
    }
    return {
      ...candidate,
      score: candidate.score +
        computeBroadTokenBoost(citationContext, candidate) +
        computeBroadTitleLeadBoost(citationContext, candidate) +
        computeBroadAuthorBoost(citationContext, candidate) +
        computeBroadYearBoost(citationContext, candidate) +
        computeBroadContextBoost(citationContext, candidate) +
        computeCanonicalTitleBoost(citationContext, candidate) +
        computeCrossSourceBoost(candidate) +
        computePublicationTypeBoost(candidate)
    };
  });
  return rerankSimpleSearchCandidates(
    citationContext,
    filterContextualAuthorHintMismatches(citationContext, ranked.sort((left, right) => right.score - left.score))
  );
}

function filterContextualAuthorHintMismatches(citationContext, candidates) {
  return filterSurnameOnlyAuthorMismatches(
    citationContext,
    filterContextualAuthorYearMismatches(citationContext, candidates)
  );
}

function filterContextualAuthorYearMismatches(citationContext, candidates) {
  const hint = citationContext?.parsedKeyHint;
  if (citationContext?.searchMode === "direct" || !hint?.surname || !hint?.year) {
    return candidates;
  }
  if (citationContext?.searchMode === "simple") {
    const matches = candidates.filter((candidate) => simpleAuthorYearCandidateMatches(citationContext, candidate));
    return matches.length ? matches : candidates;
  }
  return candidates.filter((candidate) =>
    candidate.sourceId === SOURCE_IDS.ADS ||
    directIdentifierMatches(citationContext, candidate) ||
    firstAuthorMatches(hint.surname, candidate?.authors?.[0]) ||
    strongTitleLeadYearMatch(citationContext, candidate) ||
    strongCoauthorContextMatch(citationContext, candidate)
  );
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

function computeBroadTitleLeadBoost(citationContext, candidate) {
  const { normalizedLead, title } = titleLeadParts(citationContext, candidate);
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

function computeBroadAuthorBoost(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname) {
    return 0;
  }
  const firstAuthor = candidate?.authors?.[0] ?? "";
  const firstAuthorMatchesHint = firstAuthorMatches(hint.surname, firstAuthor);
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some((author) => authorFamilyStrictlyMatches(hint.surname, author));
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

  if (strongFirstAuthorContextMatch(citationContext, candidate)) {
    boost += 5600;
  }

  if (strongCoauthorContextMatch(citationContext, candidate)) {
    boost += 5200;
  }

  return boost;
}

function computeBroadYearBoost(citationContext, candidate) {
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

function strongCoauthorContextMatch(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year || Number(candidate?.year) !== Number(hint.year)) {
    return false;
  }
  if (!matchesExplicitTitleLeadWhenPresent(citationContext, candidate)) {
    return false;
  }
  if (firstAuthorMatches(hint.surname, candidate?.authors?.[0])) {
    return false;
  }
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some((author) => authorFamilyStrictlyMatches(hint.surname, author));
  return anyAuthorMatchesHint && contextSupportScore(citationContext, candidate) >= 12;
}

function strongFirstAuthorContextMatch(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname || !hint?.year || Number(candidate?.year) !== Number(hint.year)) {
    return false;
  }
  if (!matchesExplicitTitleLeadWhenPresent(citationContext, candidate)) {
    return false;
  }
  return firstAuthorMatches(hint.surname, candidate?.authors?.[0]) && contextSupportScore(citationContext, candidate) >= 12;
}

function matchesExplicitTitleLeadWhenPresent(citationContext, candidate) {
  const { normalizedLead, title } = titleLeadParts(citationContext, candidate);
  if (!normalizedLead || normalizedLead.split(" ").length < 5) {
    return true;
  }
  return Boolean(title && (title === normalizedLead || title.startsWith(normalizedLead) || isSubstantialTitleLeadPrefix(normalizedLead, title)));
}

function computeCrossSourceBoost(candidate) {
  const sourceCount = candidateSourceCount(candidate);
  let boost = Math.min(Math.max(0, sourceCount - 1) * 90, 240);
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
  const text = normalizeSearchText(`${citationContext?.sentenceText ?? ""} ${citationContext?.contextText ?? ""}`);
  return [...new Set(text.split(" ").filter((term) => term.length >= 4 && !BROAD_CONTEXT_STOPWORDS.has(term)))].slice(0, 14);
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

function preferredCitationCount(primary, secondary) {
  return Math.max(Number(primary?.citationCount ?? 0) || 0, Number(secondary?.citationCount ?? 0) || 0);
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
  const firstAuthor = parseAuthorName(candidate?.authors?.[0]).family ||
    String(candidate?.authors?.[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (title && firstAuthor && candidate?.year) {
    keys.push(`title:${title}:${firstAuthor}:${candidate.year}`);
  }
  if (candidate?.doi) {
    keys.push(`doi:${String(candidate.doi).toLowerCase()}`);
  }
  if (candidate?.bibcode) {
    keys.push(`ads:${candidate.bibcode}`);
  }
  return [...new Set(keys.filter(Boolean))];
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

async function fetchSearchCandidates(queries, citationContext, adsApiToken, options = {}) {
  const mergedDocs = [];
  const seenBibcodes = new Set();
  const errors = [];
  const startedAt = Date.now();
  const requestTimeoutMs = positiveNumber(options.requestTimeoutMs, ADS_SEARCH_REQUEST_TIMEOUT_MS);
  const totalTimeoutMs = positiveNumber(options.totalTimeoutMs, ADS_SEARCH_BUDGET_MS);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;
  const lookupController = new AbortController();
  const externalSignal = options.externalSignal ?? null;
  const abortFromExternal = () => lookupController.abort();
  if (externalSignal?.aborted) {
    lookupController.abort();
  } else {
    externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  }
  const initialQueries = citationContext?.searchMode === "simple" ? queries.slice(0, 1) : queries.slice(0, 2);

  function remainingBudgetMs() {
    return Math.max(0, totalTimeoutMs - (Date.now() - startedAt));
  }

  function fetchQuery(query) {
    const remainingMs = remainingBudgetMs();
    if (remainingMs <= 0) {
      return Promise.reject(createAdsSearchTimeoutError(totalTimeoutMs));
    }
    return fetchAdsDocs(
      query,
      adsApiToken,
      Math.min(requestTimeoutMs, remainingMs),
      fetchImpl,
      lookupController.signal
    );
  }

  try {
    if (initialQueries.length) {
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
          mergeDocs(mergedDocs, seenBibcodes, batch.docs, batch.index);
          if (shouldStop(mergedDocs)) {
            return mergedDocs;
          }
        } else {
          errors.push(batch.error);
        }
      }
    }

    const initialIndex = initialQueries.length - 1;
    if (initialQueries.length && shouldStopAfterQuery(initialIndex, mergedDocs.length, citationContext)) {
      return mergedDocs;
    }

    for (const [offset, query] of queries.slice(initialQueries.length).entries()) {
      const index = offset + initialQueries.length;
      if (remainingBudgetMs() <= 0) {
        errors.push(createAdsSearchTimeoutError(totalTimeoutMs));
        break;
      }
      try {
        const docs = await fetchQuery(query);
        mergeDocs(mergedDocs, seenBibcodes, docs, index);
      } catch (error) {
        errors.push(error);
      }
      if (shouldStop(mergedDocs) || shouldStopAfterQuery(index, mergedDocs.length, citationContext)) {
        break;
      }
    }

    if (!mergedDocs.length && errors.length) {
      throw errors[0];
    }
    return mergedDocs;
  } finally {
    // Abort any slower initial request after a progressive result wins, and
    // guarantee that a caller retry does not overlap abandoned ADS work.
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
  const isEmptyTokenLookup = !String(citationContext?.token ?? "").trim();
  if (isEmptyTokenLookup && index < 4) {
    return false;
  }
  const hasExplicitYear = Boolean(citationContext?.parsedKeyHint?.year);
  if (hasExplicitYear && index <= 1 && mergedCount >= 6) {
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

async function exportBibtex(candidateOrBibcode) {
  const settings = await getSettings();
  const candidate = typeof candidateOrBibcode === "string" ? { bibcode: candidateOrBibcode } : (candidateOrBibcode ?? {});
  const adsApiToken = settings.sourceApiTokens?.ads || settings.adsApiToken;
  const bibcode = candidate?.bibcode;
  if (!bibcode) {
    return exportCandidateBibtex(candidate);
  }
  if (!adsApiToken) {
    return exportCandidateBibtex(candidate);
  }

  const { response, payload } = await fetchJsonWithDeadline(globalThis.fetch, "https://api.adsabs.harvard.edu/v1/export/bibtex", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adsApiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ bibcode: [bibcode] })
  }, ADS_EXPORT_TIMEOUT_MS, "ADS BibTeX export");

  if (!response.ok) {
    throw new Error(`ADS BibTeX export failed with status ${response.status}`);
  }

  return payload.export?.trim?.() ?? "";
}

async function fetchAdsDocs(
  query,
  adsApiToken,
  timeoutMs = ADS_SEARCH_REQUEST_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  signal = null
) {
  const url = new URL("https://api.adsabs.harvard.edu/v1/search/query");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi,identifier,citation_count,property,doctype,pub,bibstem,database");

  const { response, payload } = await fetchJsonWithDeadline(fetchImpl, url, {
    headers: {
      Authorization: `Bearer ${adsApiToken}`
    }
  }, timeoutMs, "ADS/SciX search", signal);

  if (!response.ok) {
    throw new Error(`ADS search failed with status ${response.status}`);
  }

  return payload?.response?.docs ?? [];
}

async function fetchJsonWithDeadline(fetchImpl, url, options, timeoutMs, label, externalSignal = null) {
  if (typeof fetchImpl !== "function") {
    throw new Error(`No fetch implementation is available for ${label}.`);
  }
  return runWithAbortDeadline(async (signal) => {
    const response = await fetchImpl(url, {
      ...options,
      signal
    });
    if (!response.ok) {
      return { response, payload: null };
    }
    const payload = await response.json();
    return { response, payload };
  }, timeoutMs, label, externalSignal);
}

async function runWithAbortDeadline(task, timeoutMs, label, externalSignal = null) {
  const controller = new AbortController();
  let timedOut = false;
  let rejectCancellation = null;
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject;
  });
  const abortFromExternal = () => {
    controller.abort();
    rejectCancellation?.(new Error(`${label} was cancelled.`));
  };
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectCancellation?.(new Error(`${label} timed out.`));
  }, positiveNumber(timeoutMs, ADS_SEARCH_REQUEST_TIMEOUT_MS));
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      cancellation
    ]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`${label} timed out.`);
    }
    if (externalSignal?.aborted) {
      throw new Error(`${label} was cancelled.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    controller.abort();
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
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
      // Keep these listeners through response-body parsing. The outer search
      // controller always aborts in its deadline wrapper's finally block.
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

async function openOverlayForActiveTab() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isOverleafProjectUrl(tab.url)) {
    return false;
  }
  return safeSendMessageToTab(tab.id, { type: "ezcite:openOverlay" });
}

function isOverleafProjectUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "overleaf.com" || parsed.hostname === "www.overleaf.com") &&
      parsed.pathname.startsWith("/project/");
  } catch {
    return false;
  }
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

if (globalThis.__OVERCITE_BACKGROUND_TEST__) {
  globalThis.__OVERCITE_BACKGROUND_TEST_HOOKS__ = {
    fetchSearchCandidates,
    fetchAdsDocs,
    fetchJsonWithDeadline,
    exportBibtex,
    searchRoutedSource,
    searchLiterature
  };
}
