import { DEFAULT_SETTINGS } from "./constants.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;

export function getStorageArea(api = extensionApi) {
  if (api?.storage?.sync) {
    return api.storage.sync;
  }
  if (api?.storage?.local) {
    return api.storage.local;
  }
  return null;
}

export async function getSettings(api = extensionApi) {
  const storage = getStorageArea(api);
  if (!storage) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const stored = await storage.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings(stored);
}

export async function saveSettings(nextSettings, api = extensionApi) {
  const normalized = normalizeSettings(nextSettings);
  const storage = getStorageArea(api);
  if (storage) {
    await storage.set(normalized);
  }
  return normalized;
}

export function normalizeSettings(rawSettings = {}) {
  let overrides = rawSettings.defaultProjectBibFileOverride ?? DEFAULT_SETTINGS.defaultProjectBibFileOverride;
  if (typeof overrides === "string") {
    try {
      overrides = JSON.parse(overrides);
    } catch {
      overrides = {};
    }
  }
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    overrides = {};
  }
  const contextWindowChars = Number(rawSettings.contextWindowChars ?? DEFAULT_SETTINGS.contextWindowChars);
  const themeMode = normalizeThemeMode(rawSettings.themeMode);
  const citationKeyMode = normalizeCitationKeyMode(rawSettings.citationKeyMode);
  const bibliographyInsertMode = normalizeBibliographyInsertMode(rawSettings.bibliographyInsertMode);
  const defaultSearchMode = normalizeDefaultSearchMode(rawSettings.defaultSearchMode);
  const adsApiToken = String(rawSettings.adsApiToken ?? DEFAULT_SETTINGS.adsApiToken).trim();
  const sourceApiTokens = normalizeSourceApiTokens(rawSettings.sourceApiTokens, adsApiToken);
  const sourceProfile = normalizeSourceProfile(rawSettings.sourceProfile);
  const primarySource = normalizePrimarySource(rawSettings.primarySource, sourceProfile);
  const fallbackSources = normalizeFallbackSources(rawSettings.fallbackSources, primarySource, sourceProfile);
  return {
    adsApiToken,
    sourceProfile,
    primarySource,
    fallbackSources,
    sourceApiTokens,
    defaultProjectBibFileOverride: overrides,
    contextWindowChars: Number.isFinite(contextWindowChars) ? Math.min(1200, Math.max(200, contextWindowChars)) : DEFAULT_SETTINGS.contextWindowChars,
    shortcutHelpText: String(rawSettings.shortcutHelpText ?? DEFAULT_SETTINGS.shortcutHelpText).trim() || DEFAULT_SETTINGS.shortcutHelpText,
    themeMode,
    returnToSourceAfterInsert: false,
    citationKeyMode,
    bibliographyInsertMode,
    defaultSearchMode
  };
}

const SOURCE_IDS = new Set(["ads", "crossref", "arxiv", "inspire", "datacite", "pubmed"]);

const SOURCE_PRESETS = Object.freeze({
  "ads-only": {
    primarySource: "ads",
    fallbackSources: []
  },
  "arxiv-only": {
    primarySource: "arxiv",
    fallbackSources: []
  },
  astrophysics: {
    primarySource: "ads",
    fallbackSources: []
  },
  broad: {
    primarySource: "crossref",
    fallbackSources: ["arxiv", "pubmed", "datacite"]
  },
  "astro-physics": {
    primarySource: "ads",
    fallbackSources: ["arxiv", "inspire", "crossref"]
  },
  "math-physics": {
    primarySource: "arxiv",
    fallbackSources: ["inspire", "crossref", "ads"]
  },
  "life-sciences": {
    primarySource: "pubmed",
    fallbackSources: ["crossref", "datacite"]
  },
  "computer-science": {
    primarySource: "arxiv",
    fallbackSources: ["crossref"]
  },
  custom: {
    primarySource: "ads",
    fallbackSources: []
  }
});

function normalizeSourceProfile(sourceProfile) {
  const normalized = String(sourceProfile ?? DEFAULT_SETTINGS.sourceProfile).trim().toLowerCase();
  return SOURCE_PRESETS[normalized] ? normalized : DEFAULT_SETTINGS.sourceProfile;
}

function normalizePrimarySource(primarySource, sourceProfile) {
  const fallbackPrimary = SOURCE_PRESETS[sourceProfile]?.primarySource ?? DEFAULT_SETTINGS.primarySource;
  const normalized = String(primarySource ?? fallbackPrimary).trim();
  return SOURCE_IDS.has(normalized) ? normalized : fallbackPrimary;
}

function normalizeFallbackSources(fallbackSources, primarySource, sourceProfile) {
  const fallbackPreset = SOURCE_PRESETS[sourceProfile]?.fallbackSources ?? DEFAULT_SETTINGS.fallbackSources;
  const rawSources = Array.isArray(fallbackSources) ? fallbackSources : fallbackPreset;
  const normalized = [];
  for (const sourceId of rawSources) {
    const normalizedSource = String(sourceId ?? "").trim();
    if (!SOURCE_IDS.has(normalizedSource) || normalizedSource === primarySource || normalized.includes(normalizedSource)) {
      continue;
    }
    normalized.push(normalizedSource);
  }
  return normalized;
}

function normalizeSourceApiTokens(rawTokens, adsApiToken) {
  const tokens = rawTokens && typeof rawTokens === "object" && !Array.isArray(rawTokens) ? rawTokens : {};
  const normalized = {
    ads: String(tokens.ads ?? adsApiToken ?? "").trim(),
    ncbi: String(tokens.ncbi ?? "").trim()
  };

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value));
}

function normalizeThemeMode(themeMode) {
  const normalized = String(themeMode ?? DEFAULT_SETTINGS.themeMode).trim().toLowerCase();
  if (normalized === "light" || normalized === "dark" || normalized === "auto") {
    return normalized;
  }
  return DEFAULT_SETTINGS.themeMode;
}

function normalizeCitationKeyMode(citationKeyMode) {
  const normalized = String(citationKeyMode ?? DEFAULT_SETTINGS.citationKeyMode).trim().toLowerCase();
  if (normalized === "authoryear" || normalized === "authoryear-underscore" || normalized === "authoryear-colon" || normalized === "informative" || normalized === "typed" || normalized === "bibcode") {
    return normalized;
  }
  return DEFAULT_SETTINGS.citationKeyMode;
}

function normalizeBibliographyInsertMode(bibliographyInsertMode) {
  const normalized = String(bibliographyInsertMode ?? DEFAULT_SETTINGS.bibliographyInsertMode).trim().toLowerCase();
  if (normalized === "append" || normalized === "alphabetical") {
    return normalized;
  }
  return DEFAULT_SETTINGS.bibliographyInsertMode;
}

function normalizeDefaultSearchMode(defaultSearchMode) {
  const normalized = String(defaultSearchMode ?? DEFAULT_SETTINGS.defaultSearchMode).trim().toLowerCase();
  if (normalized === "contextual" || normalized === "simple" || normalized === "direct") {
    return normalized;
  }
  return DEFAULT_SETTINGS.defaultSearchMode;
}
