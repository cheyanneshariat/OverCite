import { mapAdsDocToCandidate, buildAdsQueries, rerankAdsCandidates } from "./core/ads.js";
import { applyBibInsertion, generatePreferredKey } from "./core/bibtex.js";
import { DEFAULT_SETTINGS, MESSAGE_TYPES } from "./core/constants.js";
import { resolveBibTargetFromProjectState } from "./core/project.js";
import { buildSearchCacheKey, shouldStopSearchEarly } from "./core/search-performance.js";
import { getSettings, saveSettings } from "./core/settings.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const adsQueryCache = new Map();
const adsSearchResultCache = new Map();
const bibtexExportCache = new Map();
console.log("[OverCite background] boot", {
  hasBrowserApi: Boolean(globalThis.browser),
  hasChromeApi: Boolean(globalThis.chrome)
});

extensionApi.runtime.onInstalled.addListener(async () => {
  console.log("[OverCite background] onInstalled");
  const settings = await getSettings();
  await saveSettings({ ...DEFAULT_SETTINGS, ...settings });
});

extensionApi.commands.onCommand.addListener((command) => {
  console.log("[OverCite background] command", command);
  if (command !== "open-ezcite") {
    return;
  }
  void openOverlayForActiveTab().catch((error) => {
    console.error("[OverCite background] openOverlayForActiveTab failed", error);
  });
});

extensionApi.action.onClicked.addListener((tab) => {
  console.log("[OverCite background] action click", { tabId: tab?.id, url: tab?.url });
  if (!tab?.id || !tab.url?.startsWith("https://www.overleaf.com/project/")) {
    return;
  }
  void safeSendMessageToTab(tab.id, { type: "ezcite:openOverlay" }).catch((error) => {
    console.error("[OverCite background] toolbar sendMessage failed", error);
  });
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[OverCite background] message", {
    type: message?.type ?? null,
    senderTabId: sender?.tab?.id ?? null,
    senderUrl: sender?.url ?? sender?.tab?.url ?? null
  });
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
      return searchAds(message.citationContext);
    case MESSAGE_TYPES.EXPORT_BIBTEX:
      return exportBibtex(message.bibcode);
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

async function searchAds(citationContext) {
  const startedAt = performance.now();
  const settings = await getSettings();
  console.log("[OverCite background] searchAds:start", {
    token: citationContext?.token ?? null,
    sentenceText: citationContext?.sentenceText ?? null
  });
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Open OverCite settings and add one.");
  }

  const searchCacheKey = buildSearchCacheKey(citationContext, settings);
  const cachedSearchResults = adsSearchResultCache.get(searchCacheKey);
  if (cachedSearchResults) {
    console.log(`[OverCite background] searchAds: cache hit (${Math.round(performance.now() - startedAt)} ms)`);
    return cachedSearchResults;
  }

  const queries = buildAdsQueries(citationContext);
  console.log("[OverCite background] ADS queries:", queries);
  const mergedDocs = [];
  const seenBibcodes = new Set();

  for (const [index, query] of queries.entries()) {
    const docs = await fetchAdsDocs(query, settings.adsApiToken);
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
    if (hasExplicitYear) {
      const rankedCandidates = rerankAdsCandidates(citationContext, mergedDocs.map(mapAdsDocToCandidate));
      if (shouldStopSearchEarly(citationContext, rankedCandidates, index)) {
        break;
      }
    }
    const isSurnameOnlyHint = Boolean(citationContext?.parsedKeyHint?.surname) && !hasExplicitYear;
    if (isSurnameOnlyHint && index < 2) {
      continue;
    }
    if (mergedDocs.length >= 12) {
      break;
    }
  }

  const candidates = mergedDocs.map(mapAdsDocToCandidate);
  const finalCandidates = rerankAdsCandidates(citationContext, candidates);
  console.log(`[OverCite background] searchAds: ${Math.round(performance.now() - startedAt)} ms`);
  const results = finalCandidates.map((candidate) => ({
    ...candidate,
    keyMode: settings.citationKeyMode,
    typedToken: citationContext?.token ?? "",
    generatedKey: generatePreferredKey(candidate, [], {
      keyMode: settings.citationKeyMode,
      typedToken: citationContext?.token ?? ""
    })
  }));
  adsSearchResultCache.set(searchCacheKey, results);
  return results;
}

async function exportBibtex(bibcode) {
  const startedAt = performance.now();
  const settings = await getSettings();
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Open OverCite settings and add one.");
  }
  if (!bibcode) {
    throw new Error("Missing ADS bibcode.");
  }

  const cachedBibtex = bibtexExportCache.get(bibcode);
  if (cachedBibtex) {
    console.log(`[OverCite background] exportBibtex: cache hit (${Math.round(performance.now() - startedAt)} ms)`);
    return cachedBibtex;
  }

  const response = await fetch("https://api.adsabs.harvard.edu/v1/export/bibtex", {
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
  const exportedBibtex = payload.export?.trim?.() ?? "";
  bibtexExportCache.set(bibcode, exportedBibtex);
  console.log(`[OverCite background] exportBibtex: ${Math.round(performance.now() - startedAt)} ms`);
  return exportedBibtex;
}

async function fetchAdsDocs(query, adsApiToken) {
  const cacheKey = `${adsApiToken}:${query}`;
  const cachedDocs = adsQueryCache.get(cacheKey);
  if (cachedDocs) {
    return cachedDocs;
  }
  const url = new URL("https://api.adsabs.harvard.edu/v1/search/query");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${adsApiToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`ADS search failed with status ${response.status}`);
  }

  const payload = await response.json();
  const docs = payload?.response?.docs ?? [];
  adsQueryCache.set(cacheKey, docs);
  return docs;
}

async function openOverlayForActiveTab() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.overleaf.com/project/")) {
    return false;
  }
  return safeSendMessageToTab(tab.id, { type: "ezcite:openOverlay" });
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
