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
  const seenBibcodes = new Set();
  const mergedDocs = [];

  for (const [index, query] of queries.entries()) {
    const docs = await fetchAdsDocs(query, settings.adsApiToken, fetchImpl);
    for (const doc of docs) {
      const bibcode = doc?.bibcode ?? `row-${index}-${mergedDocs.length}`;
      if (seenBibcodes.has(bibcode)) {
        continue;
      }
      seenBibcodes.add(bibcode);
      mergedDocs.push(doc);
    }

    const hasExplicitYear = Boolean(citationContext?.parsedKeyHint?.year);
    if (hasExplicitYear && index === 0 && mergedDocs.length >= 6) {
      break;
    }
    const isSurnameOnlyHint = Boolean(citationContext?.parsedKeyHint?.surname) && !hasExplicitYear;
    if (isSurnameOnlyHint && index < 2) {
      continue;
    }
    if (mergedDocs.length >= 12) {
      break;
    }
  }

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
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi");

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
