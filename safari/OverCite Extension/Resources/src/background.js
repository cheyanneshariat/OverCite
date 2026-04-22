import { mapAdsDocToCandidate, buildAdsQueries, rerankAdsCandidates } from "./core/ads.js";
import { applyBibInsertion, generatePreferredKey } from "./core/bibtex.js";
import { DEFAULT_SETTINGS, MESSAGE_TYPES } from "./core/constants.js";
import { resolveBibTargetFromProjectState } from "./core/project.js";
import { getSettings, saveSettings } from "./core/settings.js";

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
  if (!tab?.id || !tab.url?.startsWith("https://www.overleaf.com/project/")) {
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
  const settings = await getSettings();
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Open OverCite settings and add one.");
  }

  const queries = buildAdsQueries(citationContext);
  const mergedDocs = await fetchSearchCandidates(queries, citationContext, settings.adsApiToken);

  const candidates = mergedDocs.map(mapAdsDocToCandidate);
  const finalCandidates = rerankAdsCandidates(citationContext, candidates);
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

async function exportBibtex(bibcode) {
  const settings = await getSettings();
  if (!settings.adsApiToken) {
    throw new Error("No ADS API token is configured. Open OverCite settings and add one.");
  }
  if (!bibcode) {
    throw new Error("Missing ADS bibcode.");
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
  return payload.export?.trim?.() ?? "";
}

async function fetchAdsDocs(query, adsApiToken) {
  const url = new URL("https://api.adsabs.harvard.edu/v1/search/query");
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "12");
  url.searchParams.set("fl", "bibcode,title,author,year,abstract,doi,citation_count");

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
