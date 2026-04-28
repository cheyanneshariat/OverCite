import { DEFAULT_SETTINGS } from "./core/constants.js";

export function normalizeVsCodeSettings(rawSettings = {}) {
  let overrides = rawSettings.projectBibFileOverrides ?? DEFAULT_SETTINGS.defaultProjectBibFileOverride;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    overrides = {};
  }

  const contextWindowChars = Number(rawSettings.contextWindowChars ?? DEFAULT_SETTINGS.contextWindowChars);
  const citationKeyMode = String(rawSettings.citationKeyMode ?? DEFAULT_SETTINGS.citationKeyMode).trim().toLowerCase();
  const bibliographyInsertMode = String(rawSettings.bibliographyInsertMode ?? DEFAULT_SETTINGS.bibliographyInsertMode).trim().toLowerCase();
  const defaultSearchMode = String(rawSettings.defaultSearchMode ?? DEFAULT_SETTINGS.defaultSearchMode).trim().toLowerCase();
  const adsApiToken = String(rawSettings.adsApiToken ?? DEFAULT_SETTINGS.adsApiToken).trim();
  const sourceProfile = normalizeSourceProfile(rawSettings.sourceProfile);
  const primarySource = normalizePrimarySource(rawSettings.primarySource, sourceProfile);
  const fallbackSources = normalizeFallbackSources(rawSettings.fallbackSources, primarySource, sourceProfile);
  const sourceApiTokens = normalizeSourceApiTokens(rawSettings.sourceApiTokens, adsApiToken);

  return {
    adsApiToken,
    sourceProfile,
    primarySource,
    fallbackSources,
    sourceApiTokens,
    contextWindowChars: Number.isFinite(contextWindowChars)
      ? Math.min(1200, Math.max(200, contextWindowChars))
      : DEFAULT_SETTINGS.contextWindowChars,
    citationKeyMode: citationKeyMode === "typed" || citationKeyMode === "informative" || citationKeyMode === "authoryear" || citationKeyMode === "authoryear-underscore" || citationKeyMode === "authoryear-colon" || citationKeyMode === "bibcode"
      ? citationKeyMode
      : DEFAULT_SETTINGS.citationKeyMode,
    bibliographyInsertMode: bibliographyInsertMode === "alphabetical" ? "alphabetical" : "append",
    defaultSearchMode: defaultSearchMode === "simple" || defaultSearchMode === "direct" ? defaultSearchMode : "contextual",
    projectBibFileOverrides: overrides
  };
}

export function workspaceKeyFromFolder(folderPath) {
  return String(folderPath ?? "").trim();
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
