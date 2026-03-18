import { buildAdsQueries, mapAdsDocToCandidate, rerankAdsCandidates } from "./core/ads.js";
import { applyBibInsertion, generatePreferredKey } from "./core/bibtex.js";
import { resolveBibTargetFromProjectState } from "./core/project.js";

const ADS_SEARCH_URL = process.env.OVERCITE_ADS_SEARCH_URL || "https://api.adsabs.harvard.edu/v1/search/query";
const ADS_BIBTEX_URL = process.env.OVERCITE_ADS_BIBTEX_URL || "https://api.adsabs.harvard.edu/v1/export/bibtex";

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
    description: formatAuthors(candidate.authors, candidate.year),
    detail: `${candidate.title}\n${truncate(candidate.abstract, 260)}`,
    candidate: {
      ...candidate,
      keyMode: settings.citationKeyMode,
      typedToken,
      bibliographyInsertMode: settings.bibliographyInsertMode
    }
  }));
}

export async function searchAds(citationContext, settings, fetchImpl = globalThis.fetch) {
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Set overcite.adsApiToken in VS Code settings.");
  }
  const queries = buildAdsQueries(citationContext);
  const mergedDocs = await fetchSearchCandidates(queries, citationContext, settings.adsApiToken, fetchImpl);

  const candidates = rerankAdsCandidates(citationContext, mergedDocs.map(mapAdsDocToCandidate));
  return candidates.map((candidate) => ({
    ...candidate,
    keyMode: settings.citationKeyMode,
    typedToken: citationContext?.token ?? "",
    generatedKey: generatePreferredKey(candidate, [], {
      keyMode: settings.citationKeyMode,
      typedToken: citationContext?.token ?? ""
    })
  }));
}

async function fetchSearchCandidates(queries, citationContext, adsApiToken, fetchImpl) {
  const mergedDocs = [];
  const seenBibcodes = new Set();
  const initialQueries = citationContext?.searchMode === "simple" ? queries.slice(0, 1) : queries.slice(0, 2);

  if (initialQueries.length) {
    const initialBatches = await Promise.all(initialQueries.map((query) => fetchAdsDocs(query, adsApiToken, fetchImpl)));
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
    const docs = await fetchAdsDocs(query, adsApiToken, fetchImpl);
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

export async function exportBibtex(bibcode, settings, fetchImpl = globalThis.fetch) {
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Set overcite.adsApiToken in VS Code settings.");
  }
  if (!bibcode) {
    throw new Error("Missing ADS bibcode.");
  }

  const response = await fetchImpl(ADS_BIBTEX_URL, {
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

export function applyInsertion(payload) {
  return applyBibInsertion(payload);
}

async function fetchAdsDocs(query, adsApiToken, fetchImpl) {
  const url = new URL(ADS_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi,citation_count");

  const response = await fetchImpl(url, {
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

function truncate(value, length) {
  const text = String(value ?? "").trim();
  if (text.length <= length) {
    return text;
  }
  return `${text.slice(0, length - 1).trimEnd()}…`;
}

function formatAuthors(authors, year) {
  const authorText = Array.isArray(authors) ? authors.slice(0, 3).join(", ") : "";
  const suffix = Array.isArray(authors) && authors.length > 3 ? " et al." : "";
  return [authorText + suffix, year].filter(Boolean).join(" | ");
}
