import { mapAdsDocToCandidate, buildAdsQueries, rerankAdsCandidates } from "./core/ads.js";
import { applyBibInsertion, generatePreferredKey } from "./core/bibtex.js";
import { DEFAULT_SETTINGS, MESSAGE_TYPES } from "./core/constants.js";
import { resolveBibTargetFromProjectState } from "./core/project.js";
import { getSettings, saveSettings } from "./core/settings.js";
import { buildSourceRouting, exportCandidateBibtex, searchBroadCandidatesForSources, SOURCE_IDS } from "./core/sources.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;

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
    default:
      throw new Error(`Unknown OverCite message type: ${message?.type ?? "undefined"}`);
  }
}

async function searchLiterature(citationContext) {
  const settings = await getSettings();
  const adsApiToken = settings.sourceApiTokens?.ads || settings.adsApiToken;
  const routing = buildSourceRouting(settings);
  const primarySource = choosePrimarySourceForQuery(routing, citationContext);
  const candidates = [];
  const errors = [];

  const shouldSearchPrimary = isSourceSearchableAsPrimary(routing, primarySource);
  const primaryCandidates = shouldSearchPrimary
    ? await searchRoutedSource(primarySource, citationContext, settings, adsApiToken)
      .catch((error) => {
        errors.push(error);
        return [];
      })
    : [];
  candidates.push(...primaryCandidates);

  const primaryRanked = finalizeCandidates(citationContext, settings, primaryCandidates);
  if (primaryRanked.length && isHighConfidenceResult(citationContext, primaryRanked[0], primarySource)) {
    return primaryRanked;
  }

  const fallbackSources = availableSearchSources(routing).filter((sourceId) => sourceId !== primarySource);
  if (fallbackSources.length) {
    const fallbackResult = await searchFallbackSources({
      citationContext,
      settings,
      adsApiToken,
      fallbackSources,
      candidates,
      errors
    });
    if (fallbackResult) {
      return fallbackResult;
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

  return finalizeCandidates(citationContext, settings, candidates);
}

function choosePrimarySourceForQuery(routing, citationContext) {
  if (directArxivToken(citationContext) && availableSearchSources(routing).includes(SOURCE_IDS.ARXIV)) {
    return SOURCE_IDS.ARXIV;
  }
  if (isDatasetSoftwareLookup(citationContext) && availableSearchSources(routing).includes(SOURCE_IDS.DATACITE)) {
    return SOURCE_IDS.DATACITE;
  }
  return routing.primarySource;
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

async function searchFallbackSources({ citationContext, settings, adsApiToken, fallbackSources, candidates, errors }) {
  const pending = fallbackSources.map((sourceId) => {
    let promise;
    promise = Promise.resolve()
      .then(() => searchRoutedSource(sourceId, citationContext, settings, adsApiToken))
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

async function searchRoutedSource(sourceId, citationContext, settings, adsApiToken) {
  if (sourceId === SOURCE_IDS.ADS) {
    if (!adsApiToken) {
      throw new Error("No ADS/SciX API token is configured for ADS/SciX search.");
    }
    const queries = buildAdsQueries(citationContext);
    const mergedDocs = await fetchSearchCandidates(queries, citationContext, adsApiToken);
    return mergedDocs.map((doc) => ({
      ...mapAdsDocToCandidate(doc),
      sourceId: SOURCE_IDS.ADS,
      sourceLabel: "ADS/SciX"
    }));
  }
  return searchBroadCandidatesForSources(citationContext, settings, [sourceId]);
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
  return authorFamilyMatches(expectedSurname, firstAuthor);
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
        computeBroadContextBoost(citationContext, candidate) +
        computeCrossSourceBoost(candidate)
    };
  });
  return filterContextualAuthorYearMismatches(citationContext, ranked.sort((left, right) => right.score - left.score));
}

function filterContextualAuthorYearMismatches(citationContext, candidates) {
  const hint = citationContext?.parsedKeyHint;
  if (citationContext?.searchMode === "direct" || citationContext?.searchMode === "simple" || !hint?.surname || !hint?.year) {
    return candidates;
  }
  return candidates.filter((candidate) =>
    candidate.sourceId === SOURCE_IDS.ADS ||
    directIdentifierMatches(citationContext, candidate) ||
    firstAuthorMatches(hint.surname, candidate?.authors?.[0]) ||
    strongCoauthorContextMatch(citationContext, candidate)
  );
}

function computeBroadTokenBoost(citationContext, candidate) {
  if (citationContext?.searchMode !== "simple" && citationContext?.searchMode !== "direct") {
    return 0;
  }
  const token = normalizeSearchText(citationContext?.token);
  const title = normalizeSearchText(candidate?.title);
  if (!token || !title) {
    return 0;
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

function computeBroadTitleLeadBoost(citationContext, candidate) {
  if (citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") {
    return 0;
  }
  const lead = extractSentenceLead(citationContext?.sentenceText);
  const normalizedLead = normalizeSearchText(lead);
  const title = normalizeSearchText(candidate?.title);
  if (!normalizedLead || !title || normalizedLead.split(" ").length < 3) {
    return 0;
  }
  if (title === normalizedLead) {
    return 5000;
  }
  if (title.startsWith(normalizedLead) || normalizedLead.startsWith(title)) {
    return 1400;
  }
  if (title.includes(normalizedLead) || normalizedLead.includes(title)) {
    return 900;
  }
  return 0;
}

function computeBroadAuthorBoost(citationContext, candidate) {
  const hint = citationContext?.parsedKeyHint;
  if (!hint?.surname) {
    return 0;
  }
  const firstAuthor = candidate?.authors?.[0] ?? "";
  const firstAuthorMatchesHint = authorFamilyMatches(hint.surname, firstAuthor);
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some((author) => authorFamilyMatches(hint.surname, author));
  let boost = 0;

  if (firstAuthorMatchesHint) {
    boost += 220;
  } else if (anyAuthorMatchesHint) {
    boost += hint.year ? -150 : 25;
  } else if (hint.year) {
    boost -= 900;
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
    boost -= 180;
  }

  if (strongCoauthorContextMatch(citationContext, candidate)) {
    boost += 5200;
  }

  return boost;
}

function extractSentenceLead(value) {
  return String(value ?? "").trim().match(/^(.+?)\s+(?:is|was|introduced|describes|presents|reports|shows|provides|uses)\b/)?.[1]?.trim() ?? "";
}

function computeBroadContextBoost(citationContext, candidate) {
  return Math.min(contextSupportScore(citationContext, candidate), 80);
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
  if (firstAuthorMatches(hint.surname, candidate?.authors?.[0])) {
    return false;
  }
  const anyAuthorMatchesHint = (candidate?.authors ?? []).some((author) => authorFamilyMatches(hint.surname, author));
  return anyAuthorMatchesHint && contextSupportScore(citationContext, candidate) >= 12;
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
  if (expected.includes(" ")) {
    return family === expected || family.endsWith(` ${expected}`) || full.endsWith(` ${expected}`);
  }
  return family === expected;
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
    const key = candidateMergeKey(candidate);
    if (!key || !seen.has(key)) {
      seen.set(key, merged.length);
      merged.push(candidate);
      continue;
    }
    const current = merged[seen.get(key)];
    const primary = preferredMergedCandidate(current, candidate);
    const secondary = primary === current ? candidate : current;
    merged[seen.get(key)] = {
      ...primary,
      abstract: primary.abstract || secondary.abstract,
      doi: preferredDoi(primary, secondary),
      eprint: primary.eprint || secondary.eprint,
      archivePrefix: primary.archivePrefix || secondary.archivePrefix,
      url: preferredUrl(primary, secondary),
      sourceLabel: mergeSourceLabels(current.sourceLabel, candidate.sourceLabel)
    };
  }
  return merged;
}

function preferredMergedCandidate(left, right) {
  const authorityDelta = sourceAuthorityScore(right) - sourceAuthorityScore(left);
  if (Math.abs(authorityDelta) >= 15) {
    return authorityDelta > 0 ? right : left;
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
  return isArxivIdentified(candidate) && candidateSourceCount(candidate) === 1;
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

function candidateMergeKey(candidate) {
  const title = String(candidate?.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const firstAuthor = parseAuthorName(candidate?.authors?.[0]).family ||
    String(candidate?.authors?.[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (title && firstAuthor && candidate?.year) {
    return `title:${title}:${firstAuthor}:${candidate.year}`;
  }
  if (candidate?.doi) {
    return `doi:${String(candidate.doi).toLowerCase()}`;
  }
  return candidate?.bibcode ? `ads:${candidate.bibcode}` : "";
}

function mergeSourceLabels(left, right) {
  return [...new Set(String(`${left ?? ""},${right ?? ""}`).split(",").map((value) => value.trim()).filter(Boolean))].join(", ");
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

  const response = await fetch("https://api.adsabs.harvard.edu/v1/export/bibtex", {
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

async function fetchAdsDocs(query, adsApiToken) {
  const url = new URL("https://api.adsabs.harvard.edu/v1/search/query");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi,identifier,citation_count");

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
