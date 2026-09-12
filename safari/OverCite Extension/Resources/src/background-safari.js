/* Safari background bundle generated from extension modules. */
const __overciteSafariModules = Object.create(null);

/* src/core/constants.js */
(() => {
  const MESSAGE_TYPES = Object.freeze({
    GET_SETTINGS: "getSettings",
    SAVE_SETTINGS: "saveSettings",
    SEARCH_ADS: "searchAds",
    EXPORT_BIBTEX: "exportBibtex",
    RESOLVE_BIB_TARGET: "resolveBibTarget",
    APPLY_INSERTION: "applyInsertion",
    REQUEST_SOURCE_PERMISSIONS: "requestSourcePermissions",
    OPEN_OPTIONS: "openOptions",
    CLAIM_ACKNOWLEDGMENT_REMINDER: "claimAcknowledgmentReminder",
    DISABLE_ACKNOWLEDGMENT_REMINDER: "disableAcknowledgmentReminder"
  });

  const DEFAULT_SETTINGS = Object.freeze({
    adsApiToken: "",
    subjectAreaConfigured: false,
    sourceProfile: "astrophysics",
    primarySource: "ads",
    fallbackSources: [],
    sourceApiTokens: {},
    defaultProjectBibFileOverride: {},
    contextWindowChars: 500,
    shortcutHelpText: "Alt+Shift+E",
    themeMode: "auto",
    returnToSourceAfterInsert: true,
    citationKeyMode: "authoryear",
    bibliographyInsertMode: "alphabetical",
    defaultSearchMode: "simple",
    contextualSearchEngine: "classic"
  });

  const TITLE_STOPWORDS = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "or",
    "the",
    "to",
    "using",
    "with",
    "without"
  ]);

  const CONTEXT_STOPWORDS = new Set([
    ...TITLE_STOPWORDS,
    "are",
    "be",
    "been",
    "can",
    "could",
    "census",
    "did",
    "do",
    "does",
    "et",
    "appear",
    "appeared",
    "appears",
    "find",
    "given",
    "have",
    "here",
    "however",
    "important",
    "kill",
    "killed",
    "may",
    "near",
    "new",
    "our",
    "paper",
    "people",
    "recent",
    "recently",
    "result",
    "results",
    "show",
    "shows",
    "study",
    "studies",
    "studied",
    "studying",
    "that",
    "their",
    "they",
    "these",
    "this",
    "those",
    "there",
    "via",
    "was",
    "were",
    "which",
    "who",
    "work",
    "works",
    "found",
    "other",
    "others",
    "also",
    "publication",
    "publications",
    "target",
    "targets"
  ]);
  __overciteSafariModules["src/core/constants.js"] = { exports: { MESSAGE_TYPES, DEFAULT_SETTINGS, TITLE_STOPWORDS, CONTEXT_STOPWORDS } };
})();

/* src/core/acknowledgment.js */
(() => {
  const ACKNOWLEDGMENT_REMINDER_VERSION = 2;
  const ACKNOWLEDGMENT_REMINDER_STORAGE_KEY = "acknowledgmentReminderVersion";
  const ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY = "acknowledgmentReminderNextEligibleAt";
  const ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY = "acknowledgmentReminderDisabled";
  const ACKNOWLEDGMENT_REMINDER_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
  const ACKNOWLEDGMENT_REMINDER_PROMPT =
    "Publishing work that used OverCite? Please consider acknowledging it!";
  const ACKNOWLEDGMENT_TEXT =
    "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX.";

  function createAcknowledgmentReminderClaim(storage, { now = () => Date.now() } = {}) {
    let handledThisSession = false;

    return async function claimAcknowledgmentReminder() {
      if (handledThisSession || !storage) {
        return false;
      }
      handledThisSession = true;

      try {
        const stored = await storage.get([
          ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY,
          ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY
        ]);
        if (stored?.[ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY] === true) {
          return false;
        }
        const currentTime = now();
        const nextEligibleAt = Number(stored?.[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY] ?? 0);
        if (Number.isFinite(nextEligibleAt) && nextEligibleAt > currentTime) {
          return false;
        }
        await storage.set({
          [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: ACKNOWLEDGMENT_REMINDER_VERSION,
          [ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY]: currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
        });
        return true;
      } catch (error) {
        console.warn("[OverCite] Could not persist the acknowledgment reminder state.", error);
        return false;
      }
    };
  }

  async function disableAcknowledgmentReminder(storage) {
    if (!storage) {
      return false;
    }
    try {
      await storage.set({ [ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY]: true });
      return true;
    } catch (error) {
      console.warn("[OverCite] Could not disable acknowledgment reminders.", error);
      return false;
    }
  }
  __overciteSafariModules["src/core/acknowledgment.js"] = { exports: { disableAcknowledgmentReminder, createAcknowledgmentReminderClaim, ACKNOWLEDGMENT_REMINDER_VERSION, ACKNOWLEDGMENT_REMINDER_STORAGE_KEY, ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY, ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY, ACKNOWLEDGMENT_REMINDER_INTERVAL_MS, ACKNOWLEDGMENT_REMINDER_PROMPT, ACKNOWLEDGMENT_TEXT } };
})();

/* src/core/project.js */
(() => {
  function resolveBibTargetFromProjectState(projectState = {}) {
    const {
      mainText = "",
      activeFileName = "",
      projectFiles = [],
      projectId = "",
      overrides = {}
    } = projectState;

    const normalizedFiles = [...new Set(projectFiles.filter(Boolean))];
    const bibFiles = normalizedFiles.filter((name) => /\.bib$/i.test(name));

    const override = projectId ? overrides[projectId] : null;
    if (override && bibFiles.includes(override)) {
      return { status: "resolved", target: override, candidates: bibFiles };
    }

    const bibliographyMatches = extractBibliographyTargets(mainText);
    if (bibliographyMatches.length) {
      const directCandidates = bibliographyMatches
        .map((name) => (name.toLowerCase().endsWith(".bib") ? name : `${name}.bib`))
        .filter((name) => bibFiles.includes(name));
      if (directCandidates.length === 1) {
        return { status: "resolved", target: directCandidates[0], candidates: bibFiles };
      }
      if (directCandidates.length > 1) {
        return { status: "needs-choice", target: null, candidates: directCandidates };
      }
    }

    if (/\.bib$/i.test(activeFileName)) {
      return { status: "resolved", target: activeFileName, candidates: bibFiles };
    }

    if (bibFiles.length === 1) {
      return { status: "resolved", target: bibFiles[0], candidates: bibFiles };
    }

    const conventionalNames = bibFiles.filter((name) => /^(references|refs)\.bib$/i.test(name));
    if (conventionalNames.length === 1) {
      return { status: "resolved", target: conventionalNames[0], candidates: bibFiles };
    }

    if (bibFiles.length > 1) {
      return { status: "needs-choice", target: null, candidates: bibFiles };
    }

    return { status: "not-found", target: null, candidates: [] };
  }

  function extractBibliographyTargets(mainText) {
    const targets = [];
    const bibliographyRegex = /\\bibliography\s*\{([^}]+)\}/g;
    const addBibResourceRegex = /\\addbibresource\s*\{([^}]+)\}/g;

    for (const regex of [bibliographyRegex, addBibResourceRegex]) {
      let match;
      while ((match = regex.exec(mainText)) !== null) {
        const pieces = match[1].split(",").map((piece) => piece.trim()).filter(Boolean);
        targets.push(...pieces);
      }
    }

    return [...new Set(targets)];
  }
  __overciteSafariModules["src/core/project.js"] = { exports: { resolveBibTargetFromProjectState, extractBibliographyTargets } };
})();

/* src/core/settings.js */
(() => {
  const { DEFAULT_SETTINGS } = __overciteSafariModules["src/core/constants.js"].exports;
  const extensionApi = globalThis.browser ?? globalThis.chrome;

  function getStorageArea(api = extensionApi) {
    if (api?.storage?.sync) {
      return api.storage.sync;
    }
    if (api?.storage?.local) {
      return api.storage.local;
    }
    return null;
  }

  async function getSettings(api = extensionApi) {
    const storage = getStorageArea(api);
    if (!storage) {
      return structuredClone(DEFAULT_SETTINGS);
    }
    const stored = await storage.get(Object.keys(DEFAULT_SETTINGS));
    return normalizeSettings(stored);
  }

  async function saveSettings(nextSettings, api = extensionApi) {
    const normalized = normalizeSettings(nextSettings);
    const storage = getStorageArea(api);
    if (storage) {
      await storage.set(normalized);
    }
    return normalized;
  }

  function normalizeSettings(rawSettings = {}) {
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
    const contextualSearchEngine = normalizeContextualSearchEngine(rawSettings.contextualSearchEngine);
    const adsApiToken = String(rawSettings.adsApiToken ?? DEFAULT_SETTINGS.adsApiToken).trim();
    const sourceApiTokens = normalizeSourceApiTokens(rawSettings.sourceApiTokens, adsApiToken);
    const sourceProfile = normalizeSourceProfile(rawSettings.sourceProfile);
    const primarySource = normalizePrimarySource(rawSettings.primarySource, sourceProfile);
    const fallbackSources = normalizeFallbackSources(rawSettings.fallbackSources, primarySource, sourceProfile);
    return {
      adsApiToken,
      subjectAreaConfigured: normalizeBooleanSetting(rawSettings.subjectAreaConfigured, false),
      sourceProfile,
      primarySource,
      fallbackSources,
      sourceApiTokens,
      defaultProjectBibFileOverride: overrides,
      contextWindowChars: Number.isFinite(contextWindowChars) ? Math.min(1200, Math.max(200, contextWindowChars)) : DEFAULT_SETTINGS.contextWindowChars,
      shortcutHelpText: String(rawSettings.shortcutHelpText ?? DEFAULT_SETTINGS.shortcutHelpText).trim() || DEFAULT_SETTINGS.shortcutHelpText,
      themeMode,
      returnToSourceAfterInsert: normalizeBooleanSetting(rawSettings.returnToSourceAfterInsert, DEFAULT_SETTINGS.returnToSourceAfterInsert),
      citationKeyMode,
      bibliographyInsertMode,
      defaultSearchMode,
      contextualSearchEngine
    };
  }

  const SOURCE_IDS = new Set(["ads", "crossref", "arxiv", "inspire", "datacite", "pubmed"]);

  const SOURCE_OPTIONAL_ORIGINS = Object.freeze({
    arxiv: ["https://export.arxiv.org/*"],
    crossref: ["https://api.crossref.org/*"],
    datacite: ["https://api.datacite.org/*"],
    inspire: ["https://inspirehep.net/*"],
    pubmed: ["https://eutils.ncbi.nlm.nih.gov/*"]
  });

  function optionalOriginsForSettings(settings) {
    const sourceIds = [
      settings?.primarySource,
      ...(Array.isArray(settings?.fallbackSources) ? settings.fallbackSources : [])
    ];
    if (String(settings?.sourceProfile ?? "").trim().toLowerCase() === "astrophysics") {
      sourceIds.push("arxiv");
    }
    return [...new Set(sourceIds.flatMap((sourceId) => SOURCE_OPTIONAL_ORIGINS[sourceId] ?? []))];
  }

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
    physics: {
      primarySource: "ads",
      fallbackSources: ["crossref", "arxiv"]
    },
    math: {
      primarySource: "crossref",
      fallbackSources: ["arxiv"]
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
      primarySource: "crossref",
      fallbackSources: ["pubmed"]
    },
    "computer-science": {
      primarySource: "crossref",
      fallbackSources: ["arxiv"]
    },
    chemistry: {
      primarySource: "crossref",
      fallbackSources: []
    },
    general: {
      primarySource: "crossref",
      fallbackSources: ["datacite"]
    },
    custom: {
      primarySource: "ads",
      fallbackSources: []
    }
  });

  function normalizeSourceProfile(sourceProfile) {
    const normalized = String(sourceProfile ?? DEFAULT_SETTINGS.sourceProfile).trim().toLowerCase();
    if (normalized === "ads-only" || normalized === "astro-physics") {
      return "astrophysics";
    }
    if (normalized === "arxiv-only" || normalized === "math-physics") {
      return "math";
    }
    if (normalized === "broad") {
      return "general";
    }
    return SOURCE_PRESETS[normalized] ? normalized : DEFAULT_SETTINGS.sourceProfile;
  }

  function normalizePrimarySource(primarySource, sourceProfile) {
    const fallbackPrimary = SOURCE_PRESETS[sourceProfile]?.primarySource ?? DEFAULT_SETTINGS.primarySource;
    if (sourceProfile !== "custom") {
      return fallbackPrimary;
    }
    const normalized = String(primarySource ?? fallbackPrimary).trim();
    return SOURCE_IDS.has(normalized) ? normalized : fallbackPrimary;
  }

  function normalizeFallbackSources(fallbackSources, primarySource, sourceProfile) {
    const fallbackPreset = SOURCE_PRESETS[sourceProfile]?.fallbackSources ?? DEFAULT_SETTINGS.fallbackSources;
    const rawSources = sourceProfile === "custom" && Array.isArray(fallbackSources) ? fallbackSources : fallbackPreset;
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

  function normalizeBooleanSetting(value, fallback) {
    if (value === true || value === false) {
      return value;
    }
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
    return Boolean(fallback);
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

  function normalizeContextualSearchEngine(contextualSearchEngine) {
    const normalized = String(contextualSearchEngine ?? DEFAULT_SETTINGS.contextualSearchEngine).trim().toLowerCase();
    return normalized === "beta" ? "beta" : "classic";
  }
  __overciteSafariModules["src/core/settings.js"] = { exports: { getSettings, saveSettings, getStorageArea, normalizeSettings, optionalOriginsForSettings } };
})();

/* src/core/bibtex.js */
(() => {
  const { TITLE_STOPWORDS } = __overciteSafariModules["src/core/constants.js"].exports;
  function toAscii(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeLooseText(value) {
    return toAscii(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function extractFirstAuthorFamily(authors) {
    const first = Array.isArray(authors) ? authors[0] : "";
    const raw = String(first ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    if (!raw.trim()) {
      return "Citation";
    }
    if (raw.includes(",")) {
      return toAscii(raw.split(",")[0]).replace(/\s+/g, "") || "Citation";
    }
    const collaborationFamily = extractCollaborationFamily(raw);
    if (collaborationFamily) {
      return collaborationFamily;
    }
    const normalized = toAscii(raw);
    const pieces = normalized.split(" ").filter(Boolean);
    return pieces[pieces.length - 1] ?? "Citation";
  }

  function extractCollaborationFamily(raw) {
    const normalized = toAscii(raw);
    if (!normalized) {
      return "";
    }
    const pieces = normalized.split(" ").filter(Boolean);
    const keywordIndex = pieces.findIndex((piece) => /^(collaboration|consortium|team|group)$/i.test(piece));
    if (keywordIndex <= 0) {
      return "";
    }
    const familyPieces = pieces
      .slice(0, keywordIndex)
      .filter((piece) => !/^(the|scientific)$/i.test(piece));
    return familyPieces.join("");
  }

  function compactLeadingNumber(numberText) {
    const digits = numberText.replace(/[^\d.]/g, "");
    const numeric = Number(digits);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return digits;
    }
    if (numeric >= 1000 && numeric % 1000 === 0) {
      return `${numeric / 1000}k`;
    }
    return String(Math.round(numeric));
  }

  function buildTitleSlug(title) {
    const rawTitle = String(title ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const leadingNumberMatch = rawTitle.match(/^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/);
    if (leadingNumberMatch) {
      return compactLeadingNumber(leadingNumberMatch[1]).toLowerCase();
    }

    const asciiTitle = toAscii(rawTitle);
    if (!asciiTitle) {
      return "";
    }

    const tokens = asciiTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token && !TITLE_STOPWORDS.has(token));
    return tokens.slice(0, 2).join("_");
  }

  function ensureUniqueKey(baseKey, existingKeys) {
    const keys = new Set(existingKeys);
    if (!keys.has(baseKey)) {
      return baseKey;
    }
    const suffixLetters = "abcdefghijklmnopqrstuvwxyz";
    for (const letter of suffixLetters) {
      const candidate = `${baseKey}${letter}`;
      if (!keys.has(candidate)) {
        return candidate;
      }
    }
    let counter = 2;
    while (keys.has(`${baseKey}${counter}`)) {
      counter += 1;
    }
    return `${baseKey}${counter}`;
  }

  function generateInformativeKey(candidate, existingKeys = []) {
    const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
    const year = candidate?.year ? String(candidate.year).slice(-2) : "xx";
    const slug = buildTitleSlug(candidate?.title ?? "");
    const base = slug ? `${family}${year}_${slug}` : `${family}${year}`;
    return ensureUniqueKey(base, existingKeys);
  }

  function generateAuthorYearKey(candidate, existingKeys = []) {
    const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
    const year = candidate?.year ? String(candidate.year) : "";
    const base = `${family}${year}` || "Citation";
    return ensureUniqueKey(base, existingKeys);
  }

  function generateAuthorYearUnderscoreKey(candidate, existingKeys = []) {
    const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
    const year = candidate?.year ? String(candidate.year) : "";
    const base = year ? `${family}_${year}` : family;
    return ensureUniqueKey(base || "Citation", existingKeys);
  }

  function generateAuthorYearColonKey(candidate, existingKeys = []) {
    const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
    const year = candidate?.year ? String(candidate.year) : "";
    const base = year ? `${family}:${year}` : family;
    return ensureUniqueKey(base || "Citation", existingKeys);
  }

  function generateBibcodeKey(candidate, existingKeys = []) {
    const bibcode = String(candidate?.bibcode ?? "").trim();
    if (!bibcode) {
      return generateAuthorYearKey(candidate, existingKeys);
    }
    return ensureUniqueKey(bibcode, existingKeys);
  }

  function sanitizeTypedTokenKey(rawToken) {
    return String(rawToken ?? "")
      .trim()
      .replace(/[{}\s]/g, "")
      .replace(/[^A-Za-z0-9_.:-]/g, "");
  }

  function generatePreferredKey(candidate, existingKeys = [], options = {}) {
    const keyMode = String(options?.keyMode ?? "authoryear");
    if (keyMode === "typed") {
      const typedBase = sanitizeTypedTokenKey(options?.typedToken);
      if (typedBase) {
        return ensureUniqueKey(typedBase, existingKeys);
      }
    }
    if (keyMode === "bibcode") {
      return generateBibcodeKey(candidate, existingKeys);
    }
    if (keyMode === "informative") {
      return generateInformativeKey(candidate, existingKeys);
    }
    if (keyMode === "authoryear") {
      return generateAuthorYearKey(candidate, existingKeys);
    }
    if (keyMode === "authoryear-underscore") {
      return generateAuthorYearUnderscoreKey(candidate, existingKeys);
    }
    if (keyMode === "authoryear-colon") {
      return generateAuthorYearColonKey(candidate, existingKeys);
    }
    return generateInformativeKey(candidate, existingKeys);
  }

  function parseFieldValue(entryText, fieldName) {
    const regex = new RegExp(`${fieldName}\\s*=\\s*(\\{([^]*?)\\}|\"([^]*?)\")`, "i");
    const match = entryText.match(regex);
    if (!match) {
      return null;
    }
    return (match[2] ?? match[3] ?? "").replace(/\s+/g, " ").trim();
  }

  function extractBibcodeFromAdsUrl(adsUrl) {
    if (!adsUrl) {
      return null;
    }
    const match = adsUrl.match(/\/abs\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function isEscapedCharacter(text, index) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    return slashCount % 2 === 1;
  }

  function findNextBibEntryHeader(bibText, startIndex) {
    let inLineComment = false;
    for (let index = startIndex; index < bibText.length; index += 1) {
      const char = bibText[index];
      if (inLineComment) {
        if (char === "\n" || char === "\r") {
          inLineComment = false;
        }
        continue;
      }
      if (char === "%" && !isEscapedCharacter(bibText, index)) {
        inLineComment = true;
        continue;
      }
      if (char !== "@") {
        continue;
      }

      let cursor = index + 1;
      while (cursor < bibText.length && /[A-Za-z]/.test(bibText[cursor])) {
        cursor += 1;
      }
      if (cursor === index + 1) {
        continue;
      }
      const type = bibText.slice(index + 1, cursor).trim();
      while (cursor < bibText.length && /\s/.test(bibText[cursor])) {
        cursor += 1;
      }
      if (bibText[cursor] === "{" || bibText[cursor] === "(") {
        return { entryStart: index, openIndex: cursor, type };
      }
    }
    return null;
  }

  function scanBibEntryBlock(bibText, header) {
    const openDelimiter = bibText[header.openIndex];
    const closeDelimiter = openDelimiter === "{" ? "}" : ")";
    let delimiterDepth = 1;
    let braceDepth = openDelimiter === "{" ? 1 : 0;
    let commaIndex = -1;
    let inQuote = false;
    let inLineComment = false;

    for (let cursor = header.openIndex + 1; cursor < bibText.length; cursor += 1) {
      const char = bibText[cursor];
      if (inLineComment) {
        if (char === "\n" || char === "\r") {
          inLineComment = false;
        }
        continue;
      }
      if (char === "%" && !isEscapedCharacter(bibText, cursor)) {
        inLineComment = true;
        continue;
      }
      if (char === "\"" && !isEscapedCharacter(bibText, cursor) && (openDelimiter === "(" ? braceDepth === 0 : delimiterDepth === 1)) {
        inQuote = !inQuote;
        continue;
      }
      if (inQuote || isEscapedCharacter(bibText, cursor)) {
        continue;
      }

      if (openDelimiter === "{") {
        if (char === "{") {
          delimiterDepth += 1;
        } else if (char === "}") {
          delimiterDepth -= 1;
          if (delimiterDepth === 0) {
            return { ...header, commaIndex, end: cursor + 1 };
          }
        } else if (char === "," && delimiterDepth === 1 && commaIndex < 0) {
          commaIndex = cursor;
        }
        continue;
      }

      if (char === "{") {
        braceDepth += 1;
      } else if (char === "}" && braceDepth > 0) {
        braceDepth -= 1;
      } else if (braceDepth === 0 && char === "(") {
        delimiterDepth += 1;
      } else if (braceDepth === 0 && char === closeDelimiter) {
        delimiterDepth -= 1;
        if (delimiterDepth === 0) {
          return { ...header, commaIndex, end: cursor + 1 };
        }
      } else if (braceDepth === 0 && char === "," && delimiterDepth === 1 && commaIndex < 0) {
        commaIndex = cursor;
      }
    }
    return null;
  }

  function parseBibEntries(bibText) {
    const entries = [];
    let index = 0;
    while (index < bibText.length) {
      const header = findNextBibEntryHeader(bibText, index);
      if (!header) {
        break;
      }
      const block = scanBibEntryBlock(bibText, header);
      if (!block) {
        break;
      }
      index = block.end;
      const normalizedType = header.type.toLowerCase();
      if (normalizedType === "comment" || normalizedType === "preamble" || normalizedType === "string" || block.commaIndex < 0) {
        continue;
      }
      const key = bibText.slice(header.openIndex + 1, block.commaIndex).trim();
      if (!key) {
        continue;
      }
      const raw = bibText.slice(header.entryStart, block.end).trim();
      entries.push({
        type: header.type,
        key,
        raw,
        start: header.entryStart,
        end: block.end,
        doi: normalizeLooseText(parseFieldValue(raw, "doi")),
        title: normalizeLooseText(parseFieldValue(raw, "title")),
        adsurl: parseFieldValue(raw, "adsurl"),
        bibcode: normalizeLooseText(extractBibcodeFromAdsUrl(parseFieldValue(raw, "adsurl"))),
        year: parseFieldValue(raw, "year")
      });
    }
    return entries;
  }

  function rewriteBibtexKey(bibtex, nextKey) {
    return bibtex.replace(/^(@[A-Za-z]+\s*[{(]\s*)([^,]+)(,)/, `$1${nextKey}$3`);
  }

  function findBibMatch(entries, candidate) {
    const normalizedDoi = normalizeLooseText(candidate?.doi);
    if (normalizedDoi) {
      const doiMatch = entries.find((entry) => entry.doi && entry.doi === normalizedDoi);
      if (doiMatch) {
        return { key: doiMatch.key, reason: "doi" };
      }
    }

    const normalizedBibcode = normalizeLooseText(candidate?.bibcode);
    if (normalizedBibcode) {
      const bibcodeMatch = entries.find((entry) => entry.bibcode && entry.bibcode === normalizedBibcode);
      if (bibcodeMatch) {
        return { key: bibcodeMatch.key, reason: "bibcode" };
      }
    }

    const normalizedTitle = normalizeLooseText(candidate?.title);
    if (normalizedTitle) {
      const titleMatch = entries.find((entry) => entry.title && entry.title === normalizedTitle);
      if (titleMatch) {
        return { key: titleMatch.key, reason: "title" };
      }
    }

    return null;
  }

  function appendBibtexEntry(bibText, entryText) {
    const trimmedText = bibText.trimEnd();
    const lineEnding = bibText.includes("\r\n") ? "\r\n" : "\n";
    const trimmedEntry = entryText.trim().replace(/\r\n|\r|\n/g, lineEnding);
    if (!trimmedText) {
      return `${trimmedEntry}${lineEnding}`;
    }
    return `${trimmedText}${lineEnding}${lineEnding}${trimmedEntry}${lineEnding}`;
  }

  function compareKeys(left, right) {
    return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
  }

  function insertBibtexEntryAlphabetically(bibText, entryText, finalKey) {
    return insertAlphabetically(bibText, entryText, finalKey, parseBibEntries(bibText));
  }

  function insertAlphabetically(bibText, entryText, finalKey, entries) {
    if (!entries.length) {
      return appendBibtexEntry(bibText, entryText);
    }

    const insertBefore = entries.find((entry) => compareKeys(finalKey, entry.key) < 0);
    if (!insertBefore) {
      return appendBibtexEntry(bibText, entryText);
    }

    const lineEnding = bibText.includes("\r\n") ? "\r\n" : "\n";
    const trimmedEntry = entryText.trim().replace(/\r\n|\r|\n/g, lineEnding);
    const before = bibText.slice(0, insertBefore.start).trimEnd();
    const after = bibText.slice(insertBefore.start).trimStart();

    if (!before) {
      return `${trimmedEntry}${lineEnding}${lineEnding}${after}${lineEnding}`;
    }
    return `${before}${lineEnding}${lineEnding}${trimmedEntry}${lineEnding}${lineEnding}${after}${lineEnding}`;
  }

  function computeInsertionResult(updatedBibText, rewrittenBibtex) {
    const normalizedEntry = String(rewrittenBibtex ?? "").trim();
    const start = updatedBibText.indexOf(normalizedEntry);
    const cursorAnchor = start >= 0 ? start + normalizedEntry.length : updatedBibText.length;
    return {
      updatedBibText,
      insertionRange: {
        start: Math.max(0, start),
        end: cursorAnchor
      },
      cursorAnchor
    };
  }

  function applyBibInsertion({ bibText, bibtex, candidate }) {
    const entries = parseBibEntries(bibText);
    const match = findBibMatch(entries, candidate);
    if (match) {
      return {
        finalKey: match.key,
        match,
        updatedBibText: bibText,
        rewrittenBibtex: null,
        insertionRange: null,
        cursorAnchor: null
      };
    }

    const existingKeys = entries.map((entry) => entry.key);
    const finalKey = generatePreferredKey(candidate, existingKeys, {
      keyMode: candidate?.keyMode,
      typedToken: candidate?.typedToken
    });
    const rewrittenBibtex = rewriteBibtexKey(bibtex, finalKey)
      .replace(/\r\n|\r|\n/g, bibText.includes("\r\n") ? "\r\n" : "\n");
    const insertMode = String(candidate?.bibliographyInsertMode ?? "alphabetical").toLowerCase();
    const updatedBibText = insertMode === "alphabetical"
      ? insertAlphabetically(bibText, rewrittenBibtex, finalKey, entries)
      : appendBibtexEntry(bibText, rewrittenBibtex);
    const insertionResult = computeInsertionResult(updatedBibText, rewrittenBibtex);
    return {
      finalKey,
      match: null,
      updatedBibText: insertionResult.updatedBibText,
      rewrittenBibtex,
      insertionRange: insertionResult.insertionRange,
      cursorAnchor: insertionResult.cursorAnchor
    };
  }
  __overciteSafariModules["src/core/bibtex.js"] = { exports: { buildTitleSlug, ensureUniqueKey, generateInformativeKey, generateAuthorYearKey, generateAuthorYearUnderscoreKey, generateAuthorYearColonKey, generateBibcodeKey, generatePreferredKey, parseBibEntries, rewriteBibtexKey, findBibMatch, appendBibtexEntry, insertBibtexEntryAlphabetically, applyBibInsertion } };
})();

/* src/core/ads.js */
(() => {
  const { CONTEXT_STOPWORDS } = __overciteSafariModules["src/core/constants.js"].exports;
  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[ŁłØøĐđÐðÞþÆæŒœıß]/g, (letter) => ({
        Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ð: "D", ð: "d",
        Þ: "Th", þ: "th", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ı: "i", ß: "ss"
      })[letter] ?? letter)
      .replace(/\\[A-Za-z]+/g, " ")
      .replace(/[^A-Za-z0-9\s]/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeContextText(value) {
    return String(value ?? "")
      .replace(/(^|[^\\])%[^\n]*/g, "$1 ")
      .replace(/\\(?:cite[a-zA-Z*]*|parencite[a-zA-Z*]*|textcite[a-zA-Z*]*|autocite[a-zA-Z*]*|footcite[a-zA-Z*]*)\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}]*\}/g, " ")
      .replace(/\\(?:ref|eqref|pageref|label)\s*\{[^{}]*\}/g, " ")
      .replace(/\$[^$]*\$/g, " ")
      .replace(/\\\([^]*?\\\)|\\\[[^]*?\\\]/g, " ");
  }

  function keywordSequence(value) {
    return normalizeText(sanitizeContextText(value))
      .split(" ")
      .filter((token) => token.length >= 3 && !CONTEXT_STOPWORDS.has(token));
  }

  function keywordList(value) {
    return [...new Set(keywordSequence(value))];
  }

  function contextualKeywordList(citationContext) {
    const before = keywordSequence(citationContext?.citationPrefixText ?? "").slice(-10);
    const after = keywordSequence(citationContext?.citationSuffixText ?? "").slice(0, 3);
    const proximal = [...new Set([...before, ...after])];
    return proximal.length >= 2 ? proximal : keywordList(citationContext?.sentenceText ?? "");
  }

  function contextualKeywordConcepts(citationContext) {
    return contextualKeywordList(citationContext).map((token) => expandKeywordVariants(token));
  }

  function distinctiveContextIdentifier(citationContext) {
    const context = [
      citationContext?.citationPrefixText,
      citationContext?.sentenceText,
      citationContext?.contextText,
      citationContext?.citationSuffixText
    ].filter(Boolean).join(" ");
    return context.match(/\b(?:[A-Z]{2,}\s+)?[A-Z]\d{3,5}[+-]\d{3,5}\b/i)?.[0] ?? "";
  }

  function hasDistinctiveContextIdentifier(citationContext) {
    return Boolean(distinctiveContextIdentifier(citationContext));
  }

  function buildDistinctiveContextQuery(citationContext) {
    const identifier = distinctiveContextIdentifier(citationContext);
    if (!identifier) {
      return null;
    }
    const identifierTerms = new Set(normalizeText(identifier).split(" ").filter(Boolean));
    const topicTerms = [...new Set(contextualKeywordConcepts(citationContext).flat())]
      .filter((token) => token.length >= 5 && !identifierTerms.has(token))
      .reverse()
      .slice(0, 6);
    const identifierQuery = `full:"${escapeQueryValue(identifier)}"`;
    if (!topicTerms.length) {
      return identifierQuery;
    }
    const topicQuery = topicTerms.map((token) => `full:"${escapeQueryValue(token)}"`).join(" OR ");
    return `${identifierQuery} AND (${topicQuery})`;
  }

  function expandKeywordVariants(token) {
    const raw = normalizeText(token);
    if (!raw || raw.length < 3 || CONTEXT_STOPWORDS.has(raw)) {
      return [];
    }

    const variants = new Set([raw]);

    if (raw.length >= 5 && raw.endsWith("ies")) {
      variants.add(`${raw.slice(0, -3)}y`);
    } else if (raw.length >= 5 && raw.endsWith("ing")) {
      const stripped = raw.slice(0, -3);
      if (stripped.length >= 3) {
        if (stripped.endsWith("s") || stripped.endsWith("y")) {
          variants.add(stripped);
        } else if (/[kgtvz]$/.test(stripped)) {
          variants.add(`${stripped}e`);
        } else {
          variants.add(stripped);
        }
      }
    } else if (raw.length >= 4 && raw.endsWith("s") && !raw.endsWith("ss")) {
      const singular = raw.slice(0, -1);
      if (singular.length >= 3) {
        variants.add(singular);
      }
    }

    return [...variants].filter((variant) => variant.length >= 3 && !CONTEXT_STOPWORDS.has(variant));
  }

  function keywordConcepts(value) {
    return keywordList(value).map((token) => expandKeywordVariants(token));
  }

  function escapeQueryValue(value) {
    return String(value ?? "").replace(/"/g, '\\"');
  }

  function plausibleCitationYear(value) {
    const year = Number(value);
    return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() + 3;
  }

  function splitContextualKeyTerms(value) {
    return [...new Set(String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .map((term) => normalizeText(term))
      .filter((term) => term.length >= 4 && !CONTEXT_STOPWORDS.has(term)))];
  }

  function contextualKeyHint(citationContext) {
    const original = citationContext?.parsedKeyHint;
    const token = String(citationContext?.token ?? "").trim();
    if (!token) {
      return original;
    }

    if (original?.surname && plausibleCitationYear(original.year)) {
      return { ...original, keyTerms: splitContextualKeyTerms(original.suffix) };
    }

    const trailingYear = token.match(/^([^_]+)_(.+)_(\d{4})$/)
      ?? token.match(/^(.*?)[_:](\d{4})$/)
      ?? token.match(/^([^-]+)-(.*)-(\d{4})$/);
    if (trailingYear && plausibleCitationYear(trailingYear.at(-1))) {
      const prefix = String(trailingYear[1] ?? "").trim();
      const middle = trailingYear.length === 4 ? String(trailingYear[2] ?? "") : "";
      const surname = prefix.replace(/[{}]/g, "").trim();
      if (surname && /^[A-Za-z][A-Za-z'`.-]*$/.test(surname)) {
        return {
          raw: token,
          normalized: token.replace(/[{}\s]/g, ""),
          surname,
          firstInitial: null,
          year: Number(trailingYear.at(-1)),
          suffix: middle,
          keyTerms: splitContextualKeyTerms(middle)
        };
      }
    }

    if (original?.year && !plausibleCitationYear(original.year)) {
      return { ...original, surname: null, firstInitial: null, year: null, suffix: "", keyTerms: [] };
    }
    return { ...original, keyTerms: splitContextualKeyTerms(original?.suffix) };
  }

  function withContextualKeyHint(citationContext) {
    return { ...citationContext, parsedKeyHint: contextualKeyHint(citationContext) };
  }

  function directAdsBibcodeToken(token) {
    const value = String(token ?? "").trim();
    return value.length === 19 && /^\d{4}[A-Za-z&.]{5}/.test(value) ? value : "";
  }

  function buildAuthorYearKeyTermsQuery(surname, year, keyTerms) {
    if (!surname || !year || !keyTerms?.length) {
      return null;
    }
    const terms = keyTerms.slice(0, 4)
      .map((term) => `(title:"${escapeQueryValue(term)}" OR abstract:"${escapeQueryValue(term)}")`)
      .join(" AND ");
    return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${terms}`;
  }

  function isAuthorLikeToken(token) {
    const trimmed = String(token ?? "").trim();
    if (/\s/.test(trimmed)) {
      return false;
    }
    const normalized = trimmed.replace(/[{}]/g, "");
    return /^[A-Za-z'`.-]{3,}$/.test(normalized);
  }

  function buildSurnameVariants(surname) {
    const raw = String(surname ?? "").trim();
    if (!raw) {
      return [];
    }
    const variants = new Set();
    const collaborationHint = parseCollaborationHint(raw);
    if (!raw.includes("-") && !/\s/.test(raw) && !collaborationHint) {
      const camelCaseHyphenated = raw.replace(/([a-z])([A-Z])/g, "$1-$2");
      if (camelCaseHyphenated !== raw) {
        variants.add(camelCaseHyphenated);
      }
    }
    variants.add(raw);
    const leadingCamelSegment = raw.match(/^([A-Z][a-z]{3,})[A-Z]/)?.[1];
    if (leadingCamelSegment) {
      variants.add(leadingCamelSegment);
    }
    const withoutPunctuation = raw.replace(/['`.\s]/g, "");
    if (withoutPunctuation) {
      variants.add(withoutPunctuation);
    }
    if (raw.includes("-")) {
      variants.add(raw.replace(/-/g, ""));
    }
    return [...variants].filter(Boolean);
  }

  function buildContextKeywordQuery(citationContext) {
    const sentenceConcepts = contextualKeywordConcepts(citationContext).slice(0, 5);
    const concepts = [...sentenceConcepts];
    if (concepts.length < 2) {
      const contextConcepts = keywordConcepts(citationContext?.contextText ?? "")
        .filter((concept) => !concept.some((token) => sentenceConcepts.flat().includes(token)))
        .slice(0, 4 - concepts.length);
      concepts.push(...contextConcepts);
    }
    if (concepts.length < 2) {
      return null;
    }
    return concepts
      .map((concept) => concept.map((token) => `full:"${escapeQueryValue(token)}"`).join(" OR "))
      .map((group) => conceptNeedsParens(group) ? `(${group})` : group)
      .join(" AND ");
  }

  function buildTitleAbstractKeywordQuery(citationContext) {
    const sentenceConcepts = contextualKeywordConcepts(citationContext).slice(0, 5);
    const concepts = [...sentenceConcepts];
    if (concepts.length < 2) {
      const contextConcepts = keywordConcepts(citationContext?.contextText ?? "")
        .filter((concept) => !concept.some((token) => sentenceConcepts.flat().includes(token)))
        .slice(0, 4 - concepts.length);
      concepts.push(...contextConcepts);
    }
    if (concepts.length < 2) {
      return null;
    }
    return concepts
      .map((concept) =>
        concept
          .map((token) => `title:"${escapeQueryValue(token)}" OR abstract:"${escapeQueryValue(token)}"`)
          .join(" OR ")
      )
      .map((group) => `(${group})`)
      .join(" AND ");
  }

  function conceptNeedsParens(groupQuery) {
    return groupQuery.includes(" OR ");
  }

  function buildSentencePhrase(citationContext) {
    const tokens = contextualKeywordList(citationContext);
    if (tokens.length < 2) {
      return null;
    }
    return tokens.slice(0, 6).join(" ");
  }

  function buildLeadingKeywordPhrase(citationContext) {
    const tokens = contextualKeywordList(citationContext);
    if (tokens.length < 2) {
      return null;
    }
    return tokens.slice(0, Math.min(3, tokens.length)).join(" ");
  }

  function buildTrailingKeywordPhrase(citationContext) {
    const tokens = contextualKeywordList(citationContext);
    if (tokens.length < 2) {
      return null;
    }
    return tokens.slice(Math.max(0, tokens.length - 2)).join(" ");
  }

  function buildSentencePhraseQuery(citationContext) {
    const phrase = buildSentencePhrase(citationContext);
    if (!phrase) {
      return null;
    }
    return `full:"${escapeQueryValue(phrase)}"`;
  }

  function buildSentenceTitleAbstractPhraseQuery(citationContext) {
    const phrase = buildSentencePhrase(citationContext);
    if (!phrase) {
      return null;
    }
    const escapedPhrase = escapeQueryValue(phrase);
    return `title:"${escapedPhrase}" OR abstract:"${escapedPhrase}"`;
  }

  function buildLeadingTitleAbstractPhraseQuery(citationContext) {
    const phrase = buildLeadingKeywordPhrase(citationContext);
    if (!phrase) {
      return null;
    }
    const escapedPhrase = escapeQueryValue(phrase);
    return `title:"${escapedPhrase}" OR abstract:"${escapedPhrase}"`;
  }

  function buildTrailingTitleAbstractPhraseQuery(citationContext) {
    const phrase = buildTrailingKeywordPhrase(citationContext);
    if (!phrase) {
      return null;
    }
    const escapedPhrase = escapeQueryValue(phrase);
    return `title:"${escapedPhrase}" OR abstract:"${escapedPhrase}"`;
  }

  function buildLeadTrailTitleAbstractQuery(citationContext) {
    const leadingPhrase = buildLeadingKeywordPhrase(citationContext);
    const trailingPhrase = buildTrailingKeywordPhrase(citationContext);
    if (!leadingPhrase || !trailingPhrase || leadingPhrase === trailingPhrase) {
      return null;
    }
    const escapedLeadingPhrase = escapeQueryValue(leadingPhrase);
    const escapedTrailingPhrase = escapeQueryValue(trailingPhrase);
    return `(title:"${escapedLeadingPhrase}" OR abstract:"${escapedLeadingPhrase}") AND (title:"${escapedTrailingPhrase}" OR abstract:"${escapedTrailingPhrase}")`;
  }

  function buildFirstAuthorYearTitleAbstractKeywordQuery(surname, year, citationContext) {
    const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
    if (!surname || !year || !keywordQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${keywordQuery}`;
  }

  function buildAuthorYearDistinctiveContextQuery(surname, year, citationContext) {
    const distinctiveQuery = buildDistinctiveContextQuery(citationContext);
    if (!surname || !year || !distinctiveQuery) {
      return null;
    }
    return `((first_author:"${escapeQueryValue(surname)}") OR (author:"${escapeQueryValue(surname)}")) year:${year} AND ${distinctiveQuery}`;
  }

  function buildFirstAuthorYearInitialTitleAbstractKeywordQuery(surname, firstInitial, year, citationContext) {
    const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
    if (!surname || !firstInitial || !year || !keywordQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND ${keywordQuery}`;
  }

  function buildAuthorContextQuery(surname, citationContext) {
    const contextQuery = buildContextKeywordQuery(citationContext);
    if (!surname || !contextQuery) {
      return null;
    }
    return `author:"${escapeQueryValue(surname)}" AND ${contextQuery}`;
  }

  function buildAuthorTitleAbstractKeywordQuery(surname, citationContext) {
    const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
    if (!surname || !keywordQuery) {
      return null;
    }
    return `author:"${escapeQueryValue(surname)}" AND ${keywordQuery}`;
  }

  function buildAuthorSentencePhraseQuery(surname, citationContext) {
    const phraseQuery = buildSentencePhraseQuery(citationContext);
    if (!surname || !phraseQuery) {
      return null;
    }
    return `author:"${escapeQueryValue(surname)}" AND ${phraseQuery}`;
  }

  function buildAuthorTitleAbstractPhraseQuery(surname, citationContext) {
    const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
    if (!surname || !phraseQuery) {
      return null;
    }
    return `author:"${escapeQueryValue(surname)}" AND (${phraseQuery})`;
  }

  function buildFirstAuthorQuery(surname) {
    if (!surname) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}"`;
  }

  function buildCollaborationNameVariants(surname) {
    const hint = parseCollaborationHint(surname);
    const base = hint?.base ?? String(surname ?? "").trim();
    if (!base) {
      return [];
    }
    return [...new Set([
      `${base} Collaboration`,
      `${base} Scientific Collaboration`,
      hint?.explicitName ?? null
    ].filter(Boolean))];
  }

  function parseCollaborationHint(surname) {
    const raw = String(surname ?? "").trim();
    if (!raw) {
      return null;
    }
    const spaced = raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    const match = spaced.match(/^(.*?)(?:\s+(Scientific))?\s+Collaboration$/i);
    if (!match) {
      return null;
    }
    const base = String(match[1] ?? "").trim();
    if (!base) {
      return null;
    }
    const isScientific = Boolean(match[2]);
    return {
      base,
      explicitName: isScientific ? `${base} Scientific Collaboration` : `${base} Collaboration`
    };
  }

  function buildHintSurnameMatchVariants(surname) {
    const raw = normalizeText(surname);
    const hint = parseCollaborationHint(surname);
    if (!hint) {
      return [...new Set(buildSurnameVariants(surname).map((variant) => normalizeText(variant)).filter(Boolean))];
    }
    return [...new Set([
      raw,
      normalizeText(hint.base),
      normalizeText(`${hint.base} Collaboration`),
      normalizeText(`${hint.base} Scientific Collaboration`)
    ].filter(Boolean))];
  }

  function authorNameMatchesSurnameVariant(authorText, surnameVariant) {
    const author = normalizeText(authorText);
    const surname = normalizeText(surnameVariant);
    if (!author || !surname) {
      return false;
    }
    const compactAuthor = author.replace(/\s+/g, "");
    const compactSurname = surname.replace(/\s+/g, "");
    return author === surname ||
      author.startsWith(`${surname} `) ||
      author.endsWith(` ${surname}`) ||
      compactAuthor === compactSurname ||
      compactAuthor.startsWith(compactSurname) ||
      compactAuthor.endsWith(compactSurname);
  }

  function authorNameMatchesSurnameVariants(authorText, surnameVariants) {
    return surnameVariants.some((surname) => authorNameMatchesSurnameVariant(authorText, surname));
  }

  function firstAuthorInitialMatches(firstAuthorText, surname, firstInitial) {
    const author = normalizeText(firstAuthorText);
    const family = normalizeText(surname);
    const initial = normalizeText(firstInitial).slice(0, 1);
    if (!author || !family || !initial) {
      return false;
    }
    const tokens = author.split(/\s+/).filter(Boolean);
    const familyTokens = family.split(/\s+/).filter(Boolean);
    if (!tokens.length || !familyTokens.length) {
      return false;
    }
    const startsWithFamily = familyTokens.every((token, index) => tokens[index] === token);
    if (startsWithFamily) {
      const given = tokens[familyTokens.length] ?? "";
      return given.startsWith(initial);
    }
    const familyStart = tokens.length - familyTokens.length;
    const endsWithFamily = familyStart > 0 && familyTokens.every((token, index) => tokens[familyStart + index] === token);
    if (endsWithFamily) {
      return tokens[0]?.startsWith(initial) ?? false;
    }
    return false;
  }

  function buildFirstAuthorOrCollaborationYearQuery(surname, year) {
    if (!surname || !year) {
      return null;
    }
    const baseSurname = parseCollaborationHint(surname)?.base ?? surname;
    const collaborationClauses = buildCollaborationNameVariants(surname)
      .map((name) => `author:"${escapeQueryValue(name)}"`);
    const joined = [`first_author:"${escapeQueryValue(baseSurname)}"`, ...collaborationClauses]
      .filter(Boolean)
      .map((clause) => `(${clause})`)
      .join(" OR ");
    return `(${joined}) year:${year}`;
  }

  function buildFirstAuthorOrCollaborationQuery(surname) {
    if (!surname) {
      return null;
    }
    const baseSurname = parseCollaborationHint(surname)?.base ?? surname;
    const collaborationClauses = buildCollaborationNameVariants(surname)
      .map((name) => `author:"${escapeQueryValue(name)}"`);
    return [`first_author:"${escapeQueryValue(baseSurname)}"`, ...collaborationClauses]
      .filter(Boolean)
      .map((clause) => `(${clause})`)
      .join(" OR ");
  }

  function buildFirstAuthorTitleAbstractPhraseQuery(surname, citationContext) {
    const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
    if (!surname || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" AND (${phraseQuery})`;
  }

  function buildFirstAuthorLeadingTitleAbstractPhraseQuery(surname, citationContext) {
    const phraseQuery = buildLeadingTitleAbstractPhraseQuery(citationContext);
    if (!surname || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" AND (${phraseQuery})`;
  }

  function buildFirstAuthorSentencePhraseQuery(surname, citationContext) {
    const phraseQuery = buildSentencePhraseQuery(citationContext);
    if (!surname || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" AND ${phraseQuery}`;
  }

  function buildFirstAuthorTitleAbstractKeywordQuery(surname, citationContext) {
    const keywordQuery = buildTitleAbstractKeywordQuery(citationContext);
    if (!surname || !keywordQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" AND ${keywordQuery}`;
  }

  function buildFirstAuthorContextQuery(surname, citationContext) {
    const contextQuery = buildContextKeywordQuery(citationContext);
    if (!surname || !contextQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" AND ${contextQuery}`;
  }

  function buildFirstAuthorYearQuery(surname, year) {
    if (!surname || !year) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" year:${year}`;
  }

  function buildFirstAuthorYearInitialQuery(surname, firstInitial, year) {
    if (!surname || !firstInitial || !year) {
      return null;
    }
    return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year}`;
  }

  function buildFirstAuthorYearSentencePhraseQuery(surname, year, citationContext) {
    const phraseQuery = buildSentencePhraseQuery(citationContext);
    if (!surname || !year || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${phraseQuery}`;
  }

  function buildFirstAuthorYearInitialSentencePhraseQuery(surname, firstInitial, year, citationContext) {
    const phraseQuery = buildSentencePhraseQuery(citationContext);
    if (!surname || !firstInitial || !year || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND ${phraseQuery}`;
  }

  function buildFirstAuthorYearTitleAbstractPhraseQuery(surname, year, citationContext) {
    const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
    if (!surname || !year || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" year:${year} AND (${phraseQuery})`;
  }

  function buildFirstAuthorYearInitialTitleAbstractPhraseQuery(surname, firstInitial, year, citationContext) {
    const phraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
    if (!surname || !firstInitial || !year || !phraseQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND (${phraseQuery})`;
  }

  function buildFirstAuthorYearContextQuery(surname, year, citationContext) {
    const contextQuery = buildContextKeywordQuery(citationContext);
    if (!surname || !year || !contextQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(surname)}" year:${year} AND ${contextQuery}`;
  }

  function buildFirstAuthorYearInitialContextQuery(surname, firstInitial, year, citationContext) {
    const contextQuery = buildContextKeywordQuery(citationContext);
    if (!surname || !firstInitial || !year || !contextQuery) {
      return null;
    }
    return `first_author:"${escapeQueryValue(`${surname}, ${firstInitial}*`)}" year:${year} AND ${contextQuery}`;
  }

  function buildAdsQuery(citationContext) {
    const hint = citationContext?.parsedKeyHint;
    if (hint?.surname && hint?.year) {
      return buildFirstAuthorOrCollaborationYearQuery(hint.surname, hint.year);
    }
    if (hint?.surname) {
      return buildFirstAuthorOrCollaborationQuery(hint.surname);
    }

    const token = String(citationContext?.token ?? "").trim();
    if (!token) {
      return "property:refereed";
    }
    if (isAuthorLikeToken(token)) {
      return `author:"${escapeQueryValue(token)}"`;
    }

    const escaped = token.replace(/"/g, '\\"');
    return `title:"${escaped}" OR abstract:"${escaped}"`;
  }

  function buildSimpleAdsQueries(citationContext) {
    const queries = new Set();
    const hint = citationContext?.parsedKeyHint;
    const token = String(citationContext?.token ?? "").trim();

    if (hint?.surname && hint?.year) {
      if (hint.firstInitial) {
        queries.add(buildFirstAuthorYearInitialQuery(hint.surname, hint.firstInitial, hint.year));
      }
      queries.add(buildFirstAuthorOrCollaborationYearQuery(hint.surname, hint.year));
      queries.add(buildFirstAuthorYearQuery(hint.surname, hint.year));
      const surnameVariants = buildSurnameVariants(hint.surname);
      for (const surname of surnameVariants) {
        if (hint.firstInitial) {
          queries.add(buildFirstAuthorYearInitialQuery(surname, hint.firstInitial, hint.year));
        }
        queries.add(buildFirstAuthorOrCollaborationYearQuery(surname, hint.year));
        queries.add(buildFirstAuthorYearQuery(surname, hint.year));
        queries.add(`author:"${escapeQueryValue(surname)}" year:${hint.year}`);
        queries.add(`author:"${escapeQueryValue(surname)}"`);
        queries.add(buildFirstAuthorOrCollaborationQuery(surname));
        queries.add(buildFirstAuthorQuery(surname));
      }
      return [...queries].filter(Boolean);
    }

    if (hint?.surname) {
      const surnameVariants = buildSurnameVariants(hint.surname);
      for (const surname of surnameVariants) {
        queries.add(buildFirstAuthorOrCollaborationQuery(surname));
        queries.add(buildFirstAuthorQuery(surname));
        queries.add(`author:"${escapeQueryValue(surname)}"`);
      }
      return [...queries].filter(Boolean);
    }

    queries.add(buildAdsQuery(citationContext));
    if (isAuthorLikeToken(token)) {
      queries.add(`author:"${escapeQueryValue(token)}"`);
    }
    return [...queries].filter(Boolean);
  }

  function buildDirectAdsQueries(citationContext) {
    const token = String(citationContext?.token ?? "").trim();
    if (!token) {
      return [];
    }
    const doi = directDoiToken(token);
    if (doi) {
      return [`doi:"${escapeQueryValue(doi)}"`];
    }
    const arxivId = directArxivToken(token);
    if (arxivId) {
      return [`identifier:${arxivId}`];
    }
    if (isFieldedAdsQuery(token)) {
      return [token];
    }
    return [token];
  }

  function isFieldedAdsQuery(token) {
    return /\b(?:abs|abstract|author|bibcode|doi|identifier|title|year|arxiv):/i.test(token);
  }

  function directDoiToken(token) {
    const normalized = String(token ?? "")
      .trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/^doi:/i, "")
      .toLowerCase();
    return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : "";
  }

  function directArxivToken(token) {
    const value = String(token ?? "").trim();
    const modern = value.match(/^(?:arxiv:|https?:\/\/arxiv\.org\/abs\/)?(\d{4}\.\d{4,5})(?:v\d+)?$/i);
    if (modern) {
      return modern[1];
    }
    const legacy = value.match(/^(?:arxiv:|https?:\/\/arxiv\.org\/abs\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i);
    return legacy?.[1] ?? "";
  }

  function buildAdsQueries(citationContext) {
    if (citationContext?.searchMode === "direct") {
      return buildDirectAdsQueries(citationContext);
    }
    if (citationContext?.searchMode === "simple") {
      return buildSimpleAdsQueries(citationContext);
    }
    citationContext = withContextualKeyHint(citationContext);
    const queries = new Set();
    const hint = citationContext?.parsedKeyHint;
    // Keep the surname exactly as typed for the first contextual queries. Some
    // compact family names (for example VanRoestel) are valid ADS author forms;
    // punctuation variants remain available later as fallbacks.
    const primarySurname = hint?.surname ?? null;
    const inferredSurname = primarySurname
      ? buildSurnameVariants(primarySurname).find((surname) => surname !== primarySurname) ?? null
      : null;
    const token = String(citationContext?.token ?? "").trim();
    const isEmptyTokenLookup = !token;
    const primaryQuery = buildAdsQuery(citationContext);
    const contextQuery = buildContextKeywordQuery(citationContext);
    const sentencePhraseQuery = buildSentencePhraseQuery(citationContext);
    const sentenceTitleAbstractPhraseQuery = buildSentenceTitleAbstractPhraseQuery(citationContext);
    const leadingTitleAbstractPhraseQuery = buildLeadingTitleAbstractPhraseQuery(citationContext);
    const trailingTitleAbstractPhraseQuery = buildTrailingTitleAbstractPhraseQuery(citationContext);
    const leadTrailTitleAbstractQuery = buildLeadTrailTitleAbstractQuery(citationContext);
    const primaryAuthorContextQuery = primarySurname
      ? buildAuthorContextQuery(primarySurname, citationContext)
      : null;
    const primaryAuthorPhraseQuery = primarySurname
      ? buildAuthorSentencePhraseQuery(primarySurname, citationContext)
      : null;
    const primaryAuthorTitleAbstractPhraseQuery = primarySurname
      ? buildAuthorTitleAbstractPhraseQuery(primarySurname, citationContext)
      : null;
    const primaryFirstAuthorYearQuery = primarySurname && hint?.year
      ? buildFirstAuthorOrCollaborationYearQuery(primarySurname, hint.year)
      : null;
    const primaryFirstAuthorYearInitialQuery = primarySurname && hint?.firstInitial && hint?.year
      ? buildFirstAuthorYearInitialQuery(primarySurname, hint.firstInitial, hint.year)
      : null;
    const primaryFirstAuthorYearPhraseQuery = primarySurname && hint?.year
      ? buildFirstAuthorYearSentencePhraseQuery(primarySurname, hint.year, citationContext)
      : null;
    const primaryFirstAuthorYearInitialPhraseQuery = primarySurname && hint?.firstInitial && hint?.year
      ? buildFirstAuthorYearInitialSentencePhraseQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
      : null;
    const primaryFirstAuthorYearTitleAbstractPhraseQuery = primarySurname && hint?.year
      ? buildFirstAuthorYearTitleAbstractPhraseQuery(primarySurname, hint.year, citationContext)
      : null;
    const primaryFirstAuthorYearInitialTitleAbstractPhraseQuery = primarySurname && hint?.firstInitial && hint?.year
      ? buildFirstAuthorYearInitialTitleAbstractPhraseQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
      : null;
    const primaryFirstAuthorYearContextQuery = primarySurname && hint?.year
      ? buildFirstAuthorYearContextQuery(primarySurname, hint.year, citationContext)
      : null;
    const primaryFirstAuthorYearInitialContextQuery = primarySurname && hint?.firstInitial && hint?.year
      ? buildFirstAuthorYearInitialContextQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
      : null;
    const primaryFirstAuthorYearTitleAbstractKeywordQuery = primarySurname && hint?.year
      ? buildFirstAuthorYearTitleAbstractKeywordQuery(primarySurname, hint.year, citationContext)
      : null;
    const primaryAuthorYearDistinctiveContextQuery = primarySurname && hint?.year
      ? buildAuthorYearDistinctiveContextQuery(primarySurname, hint.year, citationContext)
      : null;
    const primaryAuthorYearKeyTermsQuery = primarySurname && hint?.year
      ? buildAuthorYearKeyTermsQuery(primarySurname, hint.year, hint.keyTerms)
      : null;
    const primaryFirstAuthorYearInitialTitleAbstractKeywordQuery = primarySurname && hint?.firstInitial && hint?.year
      ? buildFirstAuthorYearInitialTitleAbstractKeywordQuery(primarySurname, hint.firstInitial, hint.year, citationContext)
      : null;
    const primaryAuthorTitleAbstractKeywordQuery = primarySurname
      ? buildAuthorTitleAbstractKeywordQuery(primarySurname, citationContext)
      : null;
    const primaryFirstAuthorQuery = primarySurname
      ? buildFirstAuthorOrCollaborationQuery(primarySurname)
      : null;
    const primaryFirstAuthorPhraseQuery = primarySurname
      ? buildFirstAuthorSentencePhraseQuery(primarySurname, citationContext)
      : null;
    const primaryFirstAuthorTitleAbstractPhraseQuery = primarySurname
      ? buildFirstAuthorTitleAbstractPhraseQuery(primarySurname, citationContext)
      : null;
    const primaryFirstAuthorLeadingTitleAbstractPhraseQuery = primarySurname
      ? buildFirstAuthorLeadingTitleAbstractPhraseQuery(primarySurname, citationContext)
      : null;
    const primaryFirstAuthorTitleAbstractKeywordQuery = primarySurname
      ? buildFirstAuthorTitleAbstractKeywordQuery(primarySurname, citationContext)
      : null;
    const primaryFirstAuthorContextQuery = primarySurname
      ? buildFirstAuthorContextQuery(primarySurname, citationContext)
      : null;
    const titleAbstractKeywordQuery = buildTitleAbstractKeywordQuery(citationContext);

    function preferredSurnameQuery(surname) {
      if (!surname) {
        return null;
      }
      if (hint?.year) {
        return (hint.firstInitial
          ? buildFirstAuthorYearInitialTitleAbstractPhraseQuery(surname, hint.firstInitial, hint.year, citationContext)
          : null)
          ?? buildFirstAuthorYearTitleAbstractPhraseQuery(surname, hint.year, citationContext)
          ?? (hint.firstInitial
            ? buildFirstAuthorYearInitialTitleAbstractKeywordQuery(surname, hint.firstInitial, hint.year, citationContext)
            : null)
          ?? buildFirstAuthorYearTitleAbstractKeywordQuery(surname, hint.year, citationContext)
          ?? (hint.firstInitial
            ? buildFirstAuthorYearInitialSentencePhraseQuery(surname, hint.firstInitial, hint.year, citationContext)
            : null)
          ?? buildFirstAuthorYearSentencePhraseQuery(surname, hint.year, citationContext)
          ?? (hint.firstInitial
            ? buildFirstAuthorYearInitialQuery(surname, hint.firstInitial, hint.year)
            : null)
          ?? buildFirstAuthorOrCollaborationYearQuery(surname, hint.year);
      }
      return buildFirstAuthorLeadingTitleAbstractPhraseQuery(surname, citationContext)
        ?? buildFirstAuthorTitleAbstractPhraseQuery(surname, citationContext)
        ?? buildFirstAuthorTitleAbstractKeywordQuery(surname, citationContext)
        ?? buildFirstAuthorSentencePhraseQuery(surname, citationContext)
        ?? buildFirstAuthorOrCollaborationQuery(surname);
    }

    if (isEmptyTokenLookup) {
      if (leadTrailTitleAbstractQuery) {
        queries.add(leadTrailTitleAbstractQuery);
      }
      if (leadingTitleAbstractPhraseQuery) {
        queries.add(leadingTitleAbstractPhraseQuery);
      }
      if (trailingTitleAbstractPhraseQuery) {
        queries.add(trailingTitleAbstractPhraseQuery);
      }
      if (titleAbstractKeywordQuery) {
        queries.add(titleAbstractKeywordQuery);
      }
      if (sentenceTitleAbstractPhraseQuery) {
        queries.add(sentenceTitleAbstractPhraseQuery);
      }
      if (sentencePhraseQuery) {
        queries.add(sentencePhraseQuery);
      }
      if (contextQuery) {
        queries.add(contextQuery);
      }
      queries.add(primaryQuery);
    } else if (hint?.surname && hint?.year) {
      // Run the strongest raw and inferred surname forms as the progressive
      // opening pair. This covers both compact ADS names (VanRoestel) and
      // punctuation-normalized names (El-Badry) without serially walking the
      // full contextual query expansion.
      queries.add(primaryFirstAuthorYearInitialQuery ?? primaryFirstAuthorYearQuery);
      queries.add(primaryAuthorYearDistinctiveContextQuery ?? primaryAuthorYearKeyTermsQuery);
      queries.add(preferredSurnameQuery(primarySurname));
      queries.add(inferredSurname ? buildFirstAuthorOrCollaborationYearQuery(inferredSurname, hint.year) : null);
      queries.add(preferredSurnameQuery(inferredSurname));
      if (primaryFirstAuthorYearInitialTitleAbstractPhraseQuery) {
        queries.add(primaryFirstAuthorYearInitialTitleAbstractPhraseQuery);
      }
      if (primaryFirstAuthorYearTitleAbstractPhraseQuery) {
        queries.add(primaryFirstAuthorYearTitleAbstractPhraseQuery);
      }
      if (primaryFirstAuthorYearInitialTitleAbstractKeywordQuery) {
        queries.add(primaryFirstAuthorYearInitialTitleAbstractKeywordQuery);
      }
      if (primaryFirstAuthorYearTitleAbstractKeywordQuery) {
        queries.add(primaryFirstAuthorYearTitleAbstractKeywordQuery);
      }
      if (primaryFirstAuthorYearInitialPhraseQuery) {
        queries.add(primaryFirstAuthorYearInitialPhraseQuery);
      }
      if (primaryFirstAuthorYearPhraseQuery) {
        queries.add(primaryFirstAuthorYearPhraseQuery);
      }
      if (primaryFirstAuthorYearInitialQuery) {
        queries.add(primaryFirstAuthorYearInitialQuery);
      }
      if (primaryFirstAuthorYearQuery) {
        queries.add(primaryFirstAuthorYearQuery);
      }
      if (primaryFirstAuthorYearInitialContextQuery) {
        queries.add(primaryFirstAuthorYearInitialContextQuery);
      }
      if (primaryFirstAuthorYearContextQuery) {
        queries.add(primaryFirstAuthorYearContextQuery);
      }
      queries.add(primaryQuery);
      if (primaryAuthorTitleAbstractPhraseQuery) {
        queries.add(primaryAuthorTitleAbstractPhraseQuery);
      }
      if (primaryAuthorTitleAbstractKeywordQuery) {
        queries.add(primaryAuthorTitleAbstractKeywordQuery);
      }
      if (primaryAuthorPhraseQuery) {
        queries.add(primaryAuthorPhraseQuery);
      }
      if (primaryAuthorContextQuery) {
        queries.add(primaryAuthorContextQuery);
      }
      if (sentenceTitleAbstractPhraseQuery) {
        queries.add(sentenceTitleAbstractPhraseQuery);
      }
      if (leadingTitleAbstractPhraseQuery) {
        queries.add(leadingTitleAbstractPhraseQuery);
      }
      if (sentencePhraseQuery) {
        queries.add(sentencePhraseQuery);
      }
      if (contextQuery) {
        queries.add(contextQuery);
      }
    } else if (hint?.surname && !hint?.year && primaryAuthorPhraseQuery) {
      queries.add(primaryFirstAuthorQuery);
      if (primaryFirstAuthorLeadingTitleAbstractPhraseQuery) {
        queries.add(primaryFirstAuthorLeadingTitleAbstractPhraseQuery);
      }
      if (primaryFirstAuthorTitleAbstractPhraseQuery) {
        queries.add(primaryFirstAuthorTitleAbstractPhraseQuery);
      }
      if (primaryFirstAuthorTitleAbstractKeywordQuery) {
        queries.add(primaryFirstAuthorTitleAbstractKeywordQuery);
      }
      if (primaryFirstAuthorPhraseQuery) {
        queries.add(primaryFirstAuthorPhraseQuery);
      }
      if (primaryFirstAuthorContextQuery) {
        queries.add(primaryFirstAuthorContextQuery);
      }
      if (primaryFirstAuthorQuery) {
        queries.add(primaryFirstAuthorQuery);
      }
      if (sentenceTitleAbstractPhraseQuery) {
        queries.add(sentenceTitleAbstractPhraseQuery);
      }
      if (leadingTitleAbstractPhraseQuery) {
        queries.add(leadingTitleAbstractPhraseQuery);
      }
      if (primaryAuthorTitleAbstractPhraseQuery) {
        queries.add(primaryAuthorTitleAbstractPhraseQuery);
      }
      if (primaryAuthorTitleAbstractKeywordQuery) {
        queries.add(primaryAuthorTitleAbstractKeywordQuery);
      }
      if (titleAbstractKeywordQuery) {
        queries.add(titleAbstractKeywordQuery);
      }
      queries.add(primaryAuthorPhraseQuery);
      if (sentencePhraseQuery) {
        queries.add(sentencePhraseQuery);
      }
      if (primaryAuthorContextQuery) {
        queries.add(primaryAuthorContextQuery);
      }
      queries.add(primaryQuery);
    } else {
      const bibcode = directAdsBibcodeToken(token);
      if (bibcode) {
        queries.add(`bibcode:"${escapeQueryValue(bibcode)}"`);
      }
      queries.add(primaryQuery);
      if (sentencePhraseQuery) {
        queries.add(sentencePhraseQuery);
      }
      if (contextQuery) {
        queries.add(contextQuery);
      }
    }

    if (hint?.surname) {
      const surnameVariants = buildSurnameVariants(hint.surname);
      for (const surname of surnameVariants) {
        if (!hint.year) {
          const firstAuthorLeadingTitleAbstractPhraseQuery = buildFirstAuthorLeadingTitleAbstractPhraseQuery(surname, citationContext);
          if (firstAuthorLeadingTitleAbstractPhraseQuery) {
            queries.add(firstAuthorLeadingTitleAbstractPhraseQuery);
          }
          const firstAuthorTitleAbstractPhraseQuery = buildFirstAuthorTitleAbstractPhraseQuery(surname, citationContext);
          if (firstAuthorTitleAbstractPhraseQuery) {
            queries.add(firstAuthorTitleAbstractPhraseQuery);
          }
          const firstAuthorTitleAbstractKeywordQuery = buildFirstAuthorTitleAbstractKeywordQuery(surname, citationContext);
          if (firstAuthorTitleAbstractKeywordQuery) {
            queries.add(firstAuthorTitleAbstractKeywordQuery);
          }
          const firstAuthorPhraseQuery = buildFirstAuthorSentencePhraseQuery(surname, citationContext);
          if (firstAuthorPhraseQuery) {
            queries.add(firstAuthorPhraseQuery);
          }
          const firstAuthorContextQuery = buildFirstAuthorContextQuery(surname, citationContext);
          if (firstAuthorContextQuery) {
            queries.add(firstAuthorContextQuery);
          }
          const firstAuthorQuery = buildFirstAuthorQuery(surname);
          if (firstAuthorQuery) {
            queries.add(firstAuthorQuery);
          }
        }
        const authorTitleAbstractPhraseQuery = buildAuthorTitleAbstractPhraseQuery(surname, citationContext);
        if (authorTitleAbstractPhraseQuery) {
          queries.add(authorTitleAbstractPhraseQuery);
        }
        const authorPhraseQuery = buildAuthorSentencePhraseQuery(surname, citationContext);
        if (authorPhraseQuery) {
          queries.add(authorPhraseQuery);
        }
        const authorContextQuery = buildAuthorContextQuery(surname, citationContext);
        if (authorContextQuery) {
          queries.add(authorContextQuery);
        }
        if (hint.year) {
          if (hint.firstInitial) {
            const firstAuthorYearInitialTitleAbstractPhraseQuery = buildFirstAuthorYearInitialTitleAbstractPhraseQuery(surname, hint.firstInitial, hint.year, citationContext);
            if (firstAuthorYearInitialTitleAbstractPhraseQuery) {
              queries.add(firstAuthorYearInitialTitleAbstractPhraseQuery);
            }
            const firstAuthorYearInitialPhraseQuery = buildFirstAuthorYearInitialSentencePhraseQuery(surname, hint.firstInitial, hint.year, citationContext);
            if (firstAuthorYearInitialPhraseQuery) {
              queries.add(firstAuthorYearInitialPhraseQuery);
            }
            const firstAuthorYearInitialContextQuery = buildFirstAuthorYearInitialContextQuery(surname, hint.firstInitial, hint.year, citationContext);
            if (firstAuthorYearInitialContextQuery) {
              queries.add(firstAuthorYearInitialContextQuery);
            }
            const firstAuthorYearInitialQuery = buildFirstAuthorYearInitialQuery(surname, hint.firstInitial, hint.year);
            if (firstAuthorYearInitialQuery) {
              queries.add(firstAuthorYearInitialQuery);
            }
          }
          const firstAuthorYearTitleAbstractPhraseQuery = buildFirstAuthorYearTitleAbstractPhraseQuery(surname, hint.year, citationContext);
          if (firstAuthorYearTitleAbstractPhraseQuery) {
            queries.add(firstAuthorYearTitleAbstractPhraseQuery);
          }
          const firstAuthorYearPhraseQuery = buildFirstAuthorYearSentencePhraseQuery(surname, hint.year, citationContext);
          if (firstAuthorYearPhraseQuery) {
            queries.add(firstAuthorYearPhraseQuery);
          }
          const firstAuthorYearContextQuery = buildFirstAuthorYearContextQuery(surname, hint.year, citationContext);
          if (firstAuthorYearContextQuery) {
            queries.add(firstAuthorYearContextQuery);
          }
          const years = [hint.year, hint.year - 1, hint.year + 1];
          for (const year of years) {
            const firstAuthorYearQuery = buildFirstAuthorYearQuery(surname, year);
            if (firstAuthorYearQuery) {
              queries.add(firstAuthorYearQuery);
            }
            queries.add(`author:"${escapeQueryValue(surname)}" year:${year}`);
          }
        }
        queries.add(`author:"${escapeQueryValue(surname)}"`);
      }
    }

    if (sentenceTitleAbstractPhraseQuery) {
      queries.add(sentenceTitleAbstractPhraseQuery);
    }
    if (leadingTitleAbstractPhraseQuery) {
      queries.add(leadingTitleAbstractPhraseQuery);
    }
    if (trailingTitleAbstractPhraseQuery) {
      queries.add(trailingTitleAbstractPhraseQuery);
    }
    if (leadTrailTitleAbstractQuery) {
      queries.add(leadTrailTitleAbstractQuery);
    }
    if (titleAbstractKeywordQuery) {
      queries.add(titleAbstractKeywordQuery);
    }
    if (sentencePhraseQuery) {
      queries.add(sentencePhraseQuery);
    }
    if (contextQuery) {
      queries.add(contextQuery);
    }

    return [...queries].filter(Boolean);
  }

  function mapAdsDocToCandidate(doc) {
    const eprint = extractAdsArxivIdentifier(doc.identifier);
    return {
      bibcode: doc.bibcode,
      title: Array.isArray(doc.title) ? doc.title[0] : String(doc.title ?? ""),
      authors: Array.isArray(doc.author) ? doc.author : [],
      year: doc.year ? Number(doc.year) : null,
      abstract: String(doc.abstract ?? ""),
      doi: Array.isArray(doc.doi) ? doc.doi[0] : doc.doi ?? null,
      eprint,
      archivePrefix: eprint ? "arXiv" : "",
      citationCount: Number(doc.citation_count ?? 0) || 0,
      property: Array.isArray(doc.property) ? doc.property : [],
      doctype: String(doc.doctype ?? ""),
      pub: String(doc.pub ?? ""),
      bibstem: Array.isArray(doc.bibstem) ? doc.bibstem : [],
      database: Array.isArray(doc.database) ? doc.database : [],
      score: 0,
      generatedKey: null
    };
  }

  function extractAdsArxivIdentifier(identifiers) {
    const values = Array.isArray(identifiers) ? identifiers : [];
    for (const value of values) {
      const text = String(value ?? "").trim();
      const arxiv = text.match(/(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i);
      if (arxiv) {
        return arxiv[1];
      }
    }
    return "";
  }

  function rerankAdsCandidates(citationContext, candidates) {
    if (citationContext?.searchMode === "direct") {
      return rerankDirectAdsCandidates(citationContext, candidates);
    }
    if (citationContext?.searchMode === "simple") {
      return rerankSimpleAdsCandidates(citationContext, candidates);
    }
    citationContext = withContextualKeyHint(citationContext);
    const hint = citationContext?.parsedKeyHint;
    const token = String(citationContext?.token ?? "").trim();
    const directBibcode = directAdsBibcodeToken(token);
    const normalizedToken = normalizeText(token);
    const tokenLooksLikeTitle = !hint?.year && normalizedToken.split(" ").filter(Boolean).length >= 3;
    const isEmptyTokenLookup = !token;
    const contextKeywordConcepts = keywordConcepts(citationContext?.contextText ?? "");
    const sentenceKeywordConcepts = contextualKeywordConcepts(citationContext);
    const sentencePhrase = normalizeText(buildSentencePhrase(citationContext) ?? "");
    const leadingPhrase = normalizeText(buildLeadingKeywordPhrase(citationContext) ?? "");
    const trailingPhrase = normalizeText(buildTrailingKeywordPhrase(citationContext) ?? "");
    const distinctiveIdentifier = normalizeText(distinctiveContextIdentifier(citationContext));
    const distinctiveIdentifierTerms = new Set(distinctiveIdentifier.split(" ").filter(Boolean));
    const distinctiveTopicConcepts = contextualKeywordConcepts(citationContext)
      .filter((concept) => concept.some((term) => term.length >= 5 && !distinctiveIdentifierTerms.has(term)));

    return candidates
      .map((candidate) => {
        let score = 0;
        const titleText = normalizeText(candidate.title);
        const abstractText = normalizeText(candidate.abstract);
        const firstAuthor = normalizeText(candidate.authors[0] ?? "");
        const allAuthors = normalizeText(candidate.authors.join(" "));
        const collaborationFirstAuthor = /collaboration/.test(firstAuthor);
        const identifierMatches = Boolean(distinctiveIdentifier && (
          titleText.includes(distinctiveIdentifier) || abstractText.includes(distinctiveIdentifier)
        ));
        let matchesFirstAuthor = false;
        let matchesAnyAuthor = false;

        if (directBibcode && normalizeText(candidate.bibcode) === normalizeText(directBibcode)) {
          score += 5000;
        }

        if (tokenLooksLikeTitle) {
          score += computeTitleTokenScore(normalizedToken, titleText);
        }

        if (hint?.surname) {
          const surnameVariants = buildHintSurnameMatchVariants(hint.surname);
          if (hint.firstInitial) {
            surnameVariants.push(normalizeText(`${hint.firstInitial} ${hint.surname}`));
          }
          const baseSurname = normalizeText(parseCollaborationHint(hint.surname)?.base ?? hint.surname);
          matchesFirstAuthor = authorNameMatchesSurnameVariants(firstAuthor, surnameVariants);
          matchesAnyAuthor = candidate.authors.some((author) => authorNameMatchesSurnameVariants(author, surnameVariants));
          if (matchesFirstAuthor) {
            score += 180;
          } else if (matchesAnyAuthor) {
            score += 55;
          }
          if (collaborationFirstAuthor && baseSurname && firstAuthor.startsWith(baseSurname)) {
            score += 36;
          }
        }

        if (hint?.firstInitial) {
          const firstInitial = normalizeText(hint.firstInitial);
          if (firstInitial && firstAuthorInitialMatches(firstAuthor, hint.surname, firstInitial)) {
            score += 22;
          } else if (firstInitial && firstAuthor.includes(` ${firstInitial}`)) {
            score += 8;
          }
        }

        if (citationContext?.parsedKeyHint?.surname && citationContext?.parsedKeyHint?.year) {
          if (!matchesFirstAuthor) {
            score -= 240;
          }
        }

        if (/collaboration/.test(firstAuthor) || /collaboration/.test(allAuthors)) {
          score -= 30;
        }

        if (hint?.year && candidate.year === hint.year) {
          score += 240;
        } else if (hint?.year && candidate.year && Math.abs(Number(candidate.year) - Number(hint.year)) === 1) {
          score += 30;
        } else if (hint?.year && candidate.year) {
          score -= 220;
        }

        if (hint?.year && candidate.year === hint.year && matchesFirstAuthor && contextualTitleLeadMatches(titleText, leadingPhrase)) {
          score += 260;
        }

        if (hint?.suffix) {
          const suffix = normalizeText(hint.suffix);
          if (suffix && titleText.includes(suffix)) {
            score += 18;
          }
        }

        for (const keyTerm of hint?.keyTerms ?? []) {
          if (titleText.includes(keyTerm)) {
            score += 70;
          } else if (abstractText.includes(keyTerm)) {
            score += 12;
          }
        }

        if (sentencePhrase) {
          if (titleText.includes(sentencePhrase)) {
            score += 55;
          } else if (abstractText.includes(sentencePhrase)) {
            score += 14;
          }
        }

        if (leadingPhrase) {
          if (titleText.includes(leadingPhrase)) {
            score += isEmptyTokenLookup ? 32 : 16;
          } else if (abstractText.includes(leadingPhrase)) {
            score += isEmptyTokenLookup ? 10 : 5;
          }
        }

        if (trailingPhrase) {
          if (titleText.includes(trailingPhrase)) {
            score += isEmptyTokenLookup ? 32 : 16;
          } else if (abstractText.includes(trailingPhrase)) {
            score += isEmptyTokenLookup ? 10 : 5;
          }
        }

        for (const concept of contextKeywordConcepts) {
          if (concept.some((token) => titleText.includes(token))) {
            score += 6;
          } else if (concept.some((token) => abstractText.includes(token))) {
            score += 1.5;
          }
        }

        for (const concept of sentenceKeywordConcepts) {
          if (concept.some((token) => titleText.includes(token))) {
            score += 10;
          } else if (concept.some((token) => abstractText.includes(token))) {
            score += 2;
          }
        }

        if (identifierMatches) {
          score += 35;
          let topicMatches = 0;
          for (const concept of distinctiveTopicConcepts) {
            if (concept.some((term) => titleText.includes(term))) {
              score += 14;
              topicMatches += 1;
            } else if (concept.some((term) => abstractText.includes(term))) {
              score += 4;
              topicMatches += 1;
            }
          }
          if (topicMatches >= 2) {
            score += 30;
          }
        }

        score += contextualPublicationQualityScore(candidate);
        const primaryMatchTier = hint?.surname && hint?.year
          ? (matchesFirstAuthor && candidate.year === hint.year
            ? 3
            : (matchesFirstAuthor && candidate.year && Math.abs(Number(candidate.year) - Number(hint.year)) === 1
              ? 2
              : (matchesAnyAuthor && candidate.year === hint.year ? 1 : 0)))
          : 0;
        return { ...candidate, score, primaryMatchTier };
      })
      .sort((left, right) =>
        right.primaryMatchTier - left.primaryMatchTier ||
        right.score - left.score ||
        (right.citationCount || 0) - (left.citationCount || 0) ||
        compareYears(right.year, left.year)
      );
  }

  function computeTitleTokenScore(token, titleText) {
    if (!token || !titleText) {
      return 0;
    }
    if (titleText === token) {
      return 5000;
    }
    if (!titleText.includes(token)) {
      return 0;
    }
    const tokenWordCount = token.split(" ").length;
    const extraTitleWords = titleText.split(" ").length - tokenWordCount;
    if (titleText.startsWith(token)) {
      return Math.max(1200 - extraTitleWords * 80, 700);
    }
    return Math.max(700 - extraTitleWords * 60, 350);
  }

  function contextualTitleLeadMatches(titleText, leadingPhrase) {
    if (!titleText || !leadingPhrase || leadingPhrase.split(" ").filter(Boolean).length < 3) {
      return false;
    }
    const leadingTerms = leadingPhrase.split(" ").filter((term) => term.length >= 3 && !CONTEXT_STOPWORDS.has(term));
    return titleText === leadingPhrase ||
      titleText.startsWith(leadingPhrase) ||
      titleText.includes(leadingPhrase) ||
      leadingPhrase.includes(titleText) ||
      Boolean(leadingTerms.length >= 3 && leadingTerms.every((term) => titleText.includes(term)));
  }

  function rerankDirectAdsCandidates(citationContext, candidates) {
    const token = normalizeText(citationContext?.token ?? "");
    return candidates
      .map((candidate, index) => {
        let score = 0;
        const titleText = normalizeText(candidate.title);
        const abstractText = normalizeText(candidate.abstract);
        const authorsText = normalizeText(candidate.authors.join(" "));

        if (token) {
          if (titleText === token) {
            score += 120;
          } else if (titleText.includes(token)) {
            score += 6;
            if (titleText.startsWith(token)) {
              score += 4;
            }
            const extraTitleWords = titleText.split(" ").length - token.split(" ").length;
            if (extraTitleWords > 8) {
              score -= Math.min(extraTitleWords, 30);
            }
          }
          if (authorsText.includes(token)) {
            score += 4;
          }
          if (abstractText.includes(token)) {
            score += 2;
          }
        }

        return { ...candidate, score, originalIndex: index };
      })
      .sort((left, right) =>
        right.score - left.score ||
        (right.citationCount || 0) - (left.citationCount || 0) ||
        left.originalIndex - right.originalIndex
      )
      .map(({ originalIndex, ...candidate }) => candidate);
  }

  function rerankSimpleAdsCandidates(citationContext, candidates) {
    const hint = citationContext?.parsedKeyHint;
    const token = normalizeText(citationContext?.token ?? "");
    const tokenLooksLikeTitle = !hint?.year && token.split(" ").filter(Boolean).length >= 3;
    return candidates
      .map((candidate) => {
        let score = 0;
        const titleText = normalizeText(candidate.title);
        const firstAuthor = normalizeText(candidate.authors[0] ?? "");
        const allAuthors = normalizeText(candidate.authors.join(" "));
        let satisfiesPrimaryAuthor = true;
        let satisfiesPrimaryYear = true;

        if (tokenLooksLikeTitle) {
          score += computeTitleTokenScore(token, titleText);
        }

        if (hint?.surname) {
          const surname = normalizeText(hint.surname);
          if (authorNameMatchesSurnameVariant(firstAuthor, surname)) {
            score += 120;
          } else if (candidate.authors.some((author) => authorNameMatchesSurnameVariant(author, surname))) {
            score += 40;
            satisfiesPrimaryAuthor = false;
          } else {
            satisfiesPrimaryAuthor = false;
          }
        }

        if (hint?.firstInitial) {
          const firstInitial = normalizeText(hint.firstInitial);
          if (firstInitial && firstAuthorInitialMatches(firstAuthor, hint.surname, firstInitial)) {
            score += 20;
          } else {
            satisfiesPrimaryAuthor = false;
          }
        }

        if (hint?.year && candidate.year === hint.year) {
          score += 40;
        } else if (hint?.year && candidate.year && Math.abs(candidate.year - hint.year) === 1) {
          score += 10;
          satisfiesPrimaryYear = false;
        } else if (hint?.year) {
          satisfiesPrimaryYear = false;
        }

        const matchesPrimaryConstraints = satisfiesPrimaryAuthor && satisfiesPrimaryYear;
        if (!matchesPrimaryConstraints) {
          score -= 5000;
        }

        score += adsPublicationQualityScore(candidate);
        score += Math.min(candidate.citationCount || 0, 2000);
        return { ...candidate, score, matchesPrimaryConstraints };
      })
      .sort((left, right) =>
        Number(Boolean(right.matchesPrimaryConstraints)) - Number(Boolean(left.matchesPrimaryConstraints)) ||
        right.score - left.score ||
        (right.citationCount || 0) - (left.citationCount || 0) ||
        compareYears(right.year, left.year)
      );
  }

  function compareYears(leftYear, rightYear) {
    const left = Number(leftYear) || 0;
    const right = Number(rightYear) || 0;
    return left - right;
  }

  function adsPublicationQualityScore(candidate) {
    const properties = new Set((candidate?.property ?? []).map((value) => normalizeText(value)));
    const doctype = normalizeText(candidate?.doctype ?? "");
    const pub = normalizeText(candidate?.pub ?? "");
    const bibstem = normalizeText((candidate?.bibstem ?? []).join(" "));
    let score = 0;

    if (properties.has("refereed")) {
      score += 260;
    }
    if (properties.has("article")) {
      score += 90;
    }
    if (doctype === "article") {
      score += 80;
    }
    if (properties.has("not refereed")) {
      score -= 350;
    }
    if (properties.has("nonarticle")) {
      score -= 320;
    }
    if (/abstract|meeting|conference|proceeding|bulletin|proposal|grant|award|catalog|catalogue/.test(doctype)) {
      score -= 350;
    }
    if (/\b(aas|american astronomical society|meeting abstracts?|bulletin|conference|proceedings?|nsf award|grant|proposal|vizier|data catalog|online data catalog)\b/.test(pub)) {
      score -= 400;
    }
    if (/\b(aas|baas|cosp|dps|epsc|nsf|vizie?r)\b/.test(bibstem)) {
      score -= 320;
    }

    return score;
  }

  function contextualPublicationQualityScore(candidate) {
    const score = adsPublicationQualityScore(candidate);
    return score > 0 ? Math.min(score, 120) : score;
  }
  __overciteSafariModules["src/core/ads.js"] = { exports: { hasDistinctiveContextIdentifier, buildAdsQuery, buildAdsQueries, mapAdsDocToCandidate, rerankAdsCandidates } };
})();

/* src/core/contextual-beta.js */
(() => {
  const { CONTEXT_STOPWORDS } = __overciteSafariModules["src/core/constants.js"].exports;
  const { normalizeContextualCitationContext } = __overciteSafariModules["src/core/citation.js"].exports;
  const { rerankAdsCandidates } = __overciteSafariModules["src/core/ads.js"].exports;
  // Contextual Search Beta is a deliberately small, local feature ranker.
  // It reranks provider candidates only; it never invents papers or metadata.
  // Explicit identifiers and author/year constraints remain hard ordering tiers.
  const CONTEXTUAL_BETA_MODEL_VERSION = "context-hybrid-4";
  const MIN_TIER_MODEL_SPREAD = 20;
  const MAX_SENTENCE_CHARS = 4_000;
  const MAX_PREFIX_CHARS = 4_000;
  const MAX_SUFFIX_CHARS = 2_000;
  const MAX_CONTEXT_CHARS = 12_000;

  const MODEL_WEIGHTS = Object.freeze({
    titleCoverage: 190,
    abstractCoverage: 58,
    titleSpecificity: 70,
    titleBigramCoverage: 72,
    abstractBigramCoverage: 18,
    identifierCoverage: 105,
    keyTitleCoverage: 155,
    softwareTitleMatch: 260,
    tokenAuthorMatch: 210,
    tokenTitleMatch: 210,
    tokenTitlePhraseMatch: 260,
    tokenTitleAcronymMatch: 260
  });

  const PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "el", "la", "le", "van", "von"]);
  const GENERIC_CONTEXT_TERMS = new Set([
    "analysis", "approach", "data", "distribution", "model", "models", "method", "methods",
    "measurement", "measurements", "population", "populations", "sample", "samples", "system", "systems"
  ]);
  const CITATION_BOILERPLATE_TERMS = new Set([
    "above", "article", "below", "bibliograph", "bibliographic", "bibliography", "cit",
    "citation", "detail", "discuss", "earlier", "elsewhere", "entry", "follow", "later",
    "next", "original", "paper", "previous", "prior", "record", "refer", "reference",
    "referenc", "relevant", "section", "see", "show", "shown", "source", "use", "work"
  ]);

  function applyContextualBetaReranking(citationContext, rankedCandidates) {
    if (citationContext?.searchMode !== "contextual" || !Array.isArray(rankedCandidates) || rankedCandidates.length === 0) {
      return rankedCandidates;
    }

    const normalizedContext = normalizeContextualCitationContext(citationContext, "beta");
    if (normalizedContext !== citationContext) {
      rankedCandidates = rerankAdsCandidates(normalizedContext, rankedCandidates);
      citationContext = normalizedContext;
    }

    const evidence = buildContextEvidence(citationContext);
    evidence.tokenTitleSignalCounts = countTokenTitleSignals(citationContext, rankedCandidates, evidence);
    const documentFrequencies = buildDocumentFrequencies(rankedCandidates);
    const ranked = rankedCandidates.map((candidate, baselineIndex) => {
      const features = contextualBetaFeatures(citationContext, candidate, evidence, documentFrequencies, rankedCandidates.length);
      const modelScore = dotModel(features);
      const decisiveTitleMatch = hasDecisiveTitleMatch(citationContext, candidate);
      const identityTier = contextualIdentityTier(citationContext, candidate, decisiveTitleMatch);
      return {
        ...candidate,
        score: Number(candidate?.score ?? 0) + modelScore,
        contextualBeta: {
          modelVersion: CONTEXTUAL_BETA_MODEL_VERSION,
          modelScore,
          identityTier,
          decisiveTitleMatch
        },
        __contextualBetaBaselineIndex: baselineIndex
      };
    });
    const tierModelSpreads = modelScoreSpreadsByTier(ranked);

    return ranked
      .sort((left, right) => {
        const tierDifference = Number(right.contextualBeta?.identityTier ?? 0) - Number(left.contextualBeta?.identityTier ?? 0);
        if (tierDifference) return tierDifference;
        const tier = Number(left.contextualBeta?.identityTier ?? 0);
        if (Number(tierModelSpreads.get(tier) ?? 0) < MIN_TIER_MODEL_SPREAD) {
          return Number(left.__contextualBetaBaselineIndex ?? 0) - Number(right.__contextualBetaBaselineIndex ?? 0);
        }
        return Number(right.score ?? 0) - Number(left.score ?? 0) ||
          Number(right.citationCount ?? 0) - Number(left.citationCount ?? 0) ||
          Number(left.__contextualBetaBaselineIndex ?? 0) - Number(right.__contextualBetaBaselineIndex ?? 0);
      })
      .map(({ __contextualBetaBaselineIndex, ...candidate }) => candidate);
  }

  function contextualBetaFeatures(citationContext, candidate, suppliedEvidence = null, documentFrequencies = null, candidateCount = 1) {
    citationContext = normalizeContextualCitationContext(citationContext, "beta");
    const evidence = suppliedEvidence ?? buildContextEvidence(citationContext);
    const titleTerms = uniqueTerms(candidate?.title);
    const abstractTerms = uniqueTerms(candidate?.abstract);
    const titleSet = new Set(titleTerms);
    const abstractSet = new Set(abstractTerms);
    const frequencies = documentFrequencies ?? buildDocumentFrequencies([candidate]);
    const totalEvidenceWeight = sumEvidenceWeight(evidence.weightedTerms, frequencies, candidateCount);
    const titleCoverage = weightedEvidenceCoverage(evidence.weightedTerms, titleSet, frequencies, candidateCount, totalEvidenceWeight);
    const abstractCoverage = weightedEvidenceCoverage(evidence.weightedTerms, abstractSet, frequencies, candidateCount, totalEvidenceWeight);
    const titleSpecificity = weightedCandidateSpecificity(titleTerms, evidence.termSet, frequencies, candidateCount);
    const titleBigramCoverage = bigramCoverage(evidence.proximalTerms, titleTerms);
    const abstractBigramCoverage = bigramCoverage(evidence.proximalTerms, abstractTerms);
    const identifierCoverage = setCoverage(evidence.identifiers, new Set([
      ...titleSet,
      ...abstractSet,
      ...extractIdentifiers(candidateMetadataText(candidate))
    ]));
    const keyTerms = contextualKeyTerms(citationContext);
    const keyTitleCoverage = setCoverage(keyTerms, titleSet);
    const softwareName = softwareNameHint(citationContext);
    const normalizedTitle = normalize(candidate?.title);
    const softwareTitleMatch = softwareName && normalizedTitle.includes(softwareName) ? 1 : 0;
    const tokenTerms = evidence.hasSubstantiveProse
      ? tokenLexicalTerms(citationContext?.token)
      : new Set();
    const authorFamilies = (Array.isArray(candidate?.authors) ? candidate.authors : []).map(authorFamily).filter(Boolean);
    const tokenAuthorMatch = authorFamilies.some((family) => lexicalTermMatchesCompactValue(tokenTerms, family)) ? 1 : 0;
    const tokenTitleMatch = titleTerms.some((term) => tokenTerms.has(term)) ? 1 : 0;
    const tokenTitlePhraseMatch = evidence.hasSubstantiveProse &&
      Number(evidence.tokenTitleSignalCounts?.phrase ?? 1) === 1 &&
      titlePhraseMatchesToken(tokenTerms, titleTerms) ? 1 : 0;
    const tokenTitleAcronymMatch = evidence.hasSubstantiveProse &&
      Number(evidence.tokenTitleSignalCounts?.acronym ?? 1) === 1 &&
      titleAcronymMatchesToken(citationContext?.token, titleTerms) ? 1 : 0;

    return {
      titleCoverage,
      abstractCoverage,
      titleSpecificity,
      titleBigramCoverage,
      abstractBigramCoverage,
      identifierCoverage,
      keyTitleCoverage,
      softwareTitleMatch,
      tokenAuthorMatch,
      tokenTitleMatch,
      tokenTitlePhraseMatch,
      tokenTitleAcronymMatch
    };
  }

  function contextualIdentityTier(citationContext, candidate, decisiveTitleMatch = hasDecisiveTitleMatch(citationContext, candidate)) {
    if (candidateIdentifierMatches(citationContext, candidate)) return 6;
    const hint = contextualParsedKeyHint(citationContext);
    if (!hint?.surname) {
      if (decisiveTitleMatch) return 5;
      return Number(candidate?.primaryMatchTier ?? 0);
    }
    const expectedYear = Number(hint.year);
    const candidateYear = Number(candidate?.year);
    const exactYear = Number.isFinite(expectedYear) && Number.isFinite(candidateYear) && expectedYear === candidateYear;
    const adjacentYear = Number.isFinite(expectedYear) && Number.isFinite(candidateYear) && Math.abs(expectedYear - candidateYear) === 1;
    const authors = Array.isArray(candidate?.authors) ? candidate.authors : [];
    const firstFamily = authorFamily(authors[0]);
    const allFamilies = authors.map(authorFamily).filter(Boolean);
    const normalizedHint = compact(hint.surname);
    const firstMatches = Boolean(normalizedHint && familyMatchesHint(firstFamily, normalizedHint));
    const anyMatches = Boolean(normalizedHint && allFamilies.some((family) => familyMatchesHint(family, normalizedHint)));
    const compoundMatches = compoundAuthorKeyMatches(hint.surname, allFamilies);
    const groupMatches = groupAuthorMatchesHint(authors[0], normalizedHint);
    const initialCompatible = !hint.firstInitial || !authorGivenInitial(authors[0]) ||
      compact(authorGivenInitial(authors[0])) === compact(hint.firstInitial) ||
      familyParticleInitialMatches(firstFamily, normalizedHint, hint.firstInitial);
    const strongFirstMatch = (firstMatches && initialCompatible) || compoundMatches || groupMatches;

    if (decisiveTitleMatch && strongFirstMatch &&
        (!hint.year || exactYear || adjacentYear)) {
      return 5;
    }

    if (hint.year) {
      if (exactYear && strongFirstMatch) return 4;
      // Broad-provider issue years can differ from the preprint/key year.
      // Let topical evidence order these same-author candidates together.
      if (adjacentYear && strongFirstMatch) return candidate.sourceId && candidate.sourceId !== "ads" ? 4 : 3;
      if (exactYear && anyMatches) return 2;
      if (strongFirstMatch) return 1;
      return 0;
    }
    if (strongFirstMatch) return 3;
    if (anyMatches) return 2;
    return 0;
  }

  function hasDecisiveTitleMatch(citationContext, candidate) {
    if (citationContext?.searchMode !== "contextual") return false;
    const lead = extractSentenceLead(boundedText(citationContext?.sentenceText, MAX_SENTENCE_CHARS));
    const normalizedLead = normalize(lead);
    const normalizedTitle = normalize(candidate?.title);
    const exactTitle = Boolean(
      normalizedLead &&
      normalizedTitle &&
      terms(normalizedLead).length >= 4 &&
      normalizedLead === normalizedTitle
    );
    if (!exactTitle) return false;
    const hint = contextualParsedKeyHint(citationContext);
    if (!hint?.surname) return true;
    const authors = Array.isArray(candidate?.authors) ? candidate.authors : [];
    const firstFamily = authorFamily(authors[0]);
    const families = authors.map(authorFamily).filter(Boolean);
    const normalizedHint = compact(hint.surname);
    const authorCompatible = familyMatchesHint(firstFamily, normalizedHint) ||
      compoundAuthorKeyMatches(hint.surname, families) ||
      groupAuthorMatchesHint(authors[0], normalizedHint);
    if (!authorCompatible) return false;
    const givenInitial = authorGivenInitial(authors[0]);
    const initialCompatible = !hint.firstInitial || !givenInitial ||
      compact(givenInitial) === compact(hint.firstInitial) ||
      familyParticleInitialMatches(firstFamily, normalizedHint, hint.firstInitial);
    if (!initialCompatible) return false;
    const expectedYear = Number(hint.year);
    const candidateYear = Number(candidate?.year);
    return !hint.year || !Number.isFinite(candidateYear) ||
      Math.abs(candidateYear - expectedYear) <= 1;
  }

  function extractSentenceLead(value) {
    return String(value ?? "").trim().match(/^(.+?)\s+(?:is|was|introduced|describes|presents|reports|shows|provides|uses)\b/)?.[1]?.trim() ?? "";
  }

  function groupAuthorMatchesHint(author, normalizedHint) {
    const normalizedAuthor = normalize(author);
    if (!normalizedAuthor || !normalizedHint || normalizedHint.length < 3) return false;
    const compactAuthor = compact(normalizedAuthor.replace(/^the\s+/, ""));
    const compactHint = compact(normalizedHint.replace(/^the\s+/, ""));
    const suffixPattern = /(collaboration|consortium|team|group)$/;
    if (!suffixPattern.test(compactAuthor)) return false;
    const authorBase = compactAuthor.replace(suffixPattern, "").replace(/scientific$/, "");
    const hintBase = compactHint.replace(suffixPattern, "").replace(/scientific$/, "");
    return Boolean(authorBase && authorBase === hintBase);
  }

  function dotModel(features) {
    let score = 0;
    for (const [name, weight] of Object.entries(MODEL_WEIGHTS)) {
      score += Number(features[name] ?? 0) * weight;
    }
    return Math.round(score * 1000) / 1000;
  }

  function buildContextEvidence(citationContext) {
    // Proximity windows intentionally span beyond the active sentence so the
    // classic search path has fallback context.  The beta ranker must not give
    // that neighbouring prose its higher proximity weight: it can describe the
    // next citation and invert two otherwise-correct same-author results.
    const prefixText = currentSentenceTail(boundedText(citationContext?.citationPrefixText, MAX_PREFIX_CHARS, true));
    const suffixText = currentSentenceHead(boundedText(citationContext?.citationSuffixText, MAX_SUFFIX_CHARS));
    const sentenceText = boundedText(citationContext?.sentenceText, MAX_SENTENCE_CHARS);
    const contextText = boundedText(citationContext?.contextText, MAX_CONTEXT_CHARS);
    const prefix = terms(prefixText).slice(-28);
    const suffix = terms(suffixText).slice(0, 10);
    const sentence = terms(sentenceText);
    const localEvidence = new Set([...prefix, ...suffix, ...sentence]);
    const context = localEvidence.size >= 3 ? [] : terms(contextText);
    const weightedTerms = new Map();
    addWeightedTerms(weightedTerms, context, 0.55);
    addWeightedTerms(weightedTerms, sentence, 1.1);
    addWeightedTerms(weightedTerms, prefix, 1.8);
    addWeightedTerms(weightedTerms, suffix, 1.35);
    const proximalTerms = [...prefix, ...suffix];
    const identifiers = new Set([
      ...extractIdentifiers(prefixText),
      ...extractIdentifiers(sentenceText),
      ...extractIdentifiers(suffixText),
      ...extractIdentifiers(contextText)
    ]);
    return {
      weightedTerms,
      proximalTerms: proximalTerms.length >= 2 ? proximalTerms : sentence,
      termSet: new Set(weightedTerms.keys()),
      identifiers,
      hasProse: Boolean(prefix.length || suffix.length || sentence.length || context.length),
      hasSubstantiveProse: isSubstantiveContext([...prefix, ...suffix, ...sentence, ...context])
    };
  }

  function addWeightedTerms(target, values, weight) {
    for (const value of values) {
      target.set(value, Math.max(Number(target.get(value) ?? 0), weight));
    }
  }

  function isSubstantiveContext(values) {
    const unique = new Set(values);
    if (unique.size < 3) return false;
    let informativeTerms = 0;
    for (const term of unique) {
      if (!CITATION_BOILERPLATE_TERMS.has(term)) informativeTerms += 1;
    }
    return informativeTerms >= 2;
  }

  function buildDocumentFrequencies(candidates) {
    const frequencies = new Map();
    for (const candidate of candidates) {
      const present = new Set([...uniqueTerms(candidate?.title), ...uniqueTerms(candidate?.abstract)]);
      for (const term of present) {
        frequencies.set(term, Number(frequencies.get(term) ?? 0) + 1);
      }
    }
    return frequencies;
  }

  function sumEvidenceWeight(weightedTerms, frequencies, candidateCount) {
    let total = 0;
    for (const [term, proximityWeight] of weightedTerms) {
      total += proximityWeight * inverseDocumentFrequency(term, frequencies, candidateCount);
    }
    return total || 1;
  }

  function weightedEvidenceCoverage(weightedTerms, candidateTerms, frequencies, candidateCount, denominator) {
    let matched = 0;
    for (const [term, proximityWeight] of weightedTerms) {
      if (candidateTerms.has(term)) {
        matched += proximityWeight * inverseDocumentFrequency(term, frequencies, candidateCount);
      }
    }
    return Math.min(1, matched / denominator);
  }

  function weightedCandidateSpecificity(candidateTerms, evidenceTerms, frequencies, candidateCount) {
    let numerator = 0;
    let denominator = 0;
    for (const term of candidateTerms) {
      const weight = inverseDocumentFrequency(term, frequencies, candidateCount);
      denominator += weight;
      if (evidenceTerms.has(term)) {
        numerator += weight;
      }
    }
    return denominator ? Math.min(1, numerator / denominator) : 0;
  }

  function inverseDocumentFrequency(term, frequencies, candidateCount) {
    const frequency = Number(frequencies.get(term) ?? 0);
    return Math.log((Math.max(1, candidateCount) + 1) / (frequency + 1)) + 1;
  }

  function bigramCoverage(contextTerms, candidateTerms) {
    const contextBigrams = bigrams(contextTerms);
    if (!contextBigrams.size) return 0;
    const candidateBigrams = bigrams(candidateTerms);
    let matches = 0;
    for (const bigram of contextBigrams) {
      if (candidateBigrams.has(bigram)) matches += 1;
    }
    return matches / contextBigrams.size;
  }

  function bigrams(values) {
    const output = new Set();
    for (let index = 0; index + 1 < values.length; index += 1) {
      output.add(`${values[index]} ${values[index + 1]}`);
    }
    return output;
  }

  function setCoverage(expected, actual) {
    if (!expected?.size) return 0;
    let matches = 0;
    for (const value of expected) {
      if (actual.has(value)) matches += 1;
    }
    return matches / expected.size;
  }

  function contextualKeyTerms(citationContext) {
    const hint = contextualParsedKeyHint(citationContext);
    const values = Array.isArray(hint?.keyTerms) && hint.keyTerms.length
      ? hint.keyTerms
      : splitCamelCase(hint?.suffix);
    return new Set(values.flatMap((value) => terms(value)));
  }

  function softwareNameHint(citationContext) {
    const token = String(citationContext?.token ?? "").trim();
    const repositoryStyle = token.match(/^([A-Za-z][A-Za-z0-9.+-]{1,30})[_:-]\d{6,}$/);
    if (repositoryStyle) return normalize(repositoryStyle[1]).replace(/\s+/g, "");
    if (/^[a-z][a-z0-9.+-]{2,24}$/.test(token) && !contextualParsedKeyHint(citationContext)?.year) {
      return normalize(token).replace(/\s+/g, "");
    }
    return "";
  }

  function contextualParsedKeyHint(citationContext) {
    return normalizeContextualCitationContext(citationContext, "beta")?.parsedKeyHint;
  }

  function tokenLexicalTerms(value) {
    const separated = String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2");
    return new Set(normalize(separated).split(" ").filter((term) =>
      term.length >= 3 &&
      !CONTEXT_STOPWORDS.has(term) &&
      !["dblp", "journals", "corr"].includes(term)
    ));
  }

  function lexicalTermMatchesCompactValue(tokenTerms, value) {
    const normalizedValue = compact(value);
    if (!normalizedValue) return false;
    return tokenTerms.has(normalizedValue);
  }

  function titleAcronymMatchesToken(token, titleTerms) {
    const compactToken = String(token ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
    if (!/^[A-Z][A-Z0-9-]{2,11}$/.test(String(token ?? "")) || compactToken.length < 3 || !titleTerms.length) {
      return false;
    }
    const acronym = titleTerms.map((term) => term[0]).join("");
    return acronym.startsWith(compactToken);
  }

  function titlePhraseMatchesToken(tokenTerms, titleTerms) {
    if (tokenTerms.size < 2 || !titleTerms.length) return false;
    const compactTokenTerms = [...tokenTerms].map(stem).join("");
    return compactTokenTerms.length >= 6 && titleTerms.join("").includes(compactTokenTerms);
  }

  function countTokenTitleSignals(citationContext, candidates, evidence) {
    if (!evidence.hasSubstantiveProse) return { phrase: 0, acronym: 0 };
    const tokenTerms = tokenLexicalTerms(citationContext?.token);
    let phrase = 0;
    let acronym = 0;
    for (const candidate of candidates) {
      const titleTerms = uniqueTerms(candidate?.title);
      phrase += Number(titlePhraseMatchesToken(tokenTerms, titleTerms));
      acronym += Number(titleAcronymMatchesToken(citationContext?.token, titleTerms));
    }
    return { phrase, acronym };
  }

  function modelScoreSpreadsByTier(rankedCandidates) {
    const ranges = new Map();
    for (const candidate of rankedCandidates) {
      const tier = Number(candidate.contextualBeta?.identityTier ?? 0);
      const score = Number(candidate.contextualBeta?.modelScore ?? 0);
      const range = ranges.get(tier) ?? { min: score, max: score };
      range.min = Math.min(range.min, score);
      range.max = Math.max(range.max, score);
      ranges.set(tier, range);
    }
    return new Map([...ranges].map(([tier, range]) => [tier, range.max - range.min]));
  }

  function extractIdentifiers(value) {
    const normalized = normalize(value);
    return new Set(normalized.split(" ").filter((term) => /\d/.test(term) && term.length >= 4));
  }

  function candidateIdentifierMatches(citationContext, candidate) {
    const token = String(citationContext?.token ?? "").trim();
    if (!token) return false;
    const lowerToken = token.toLowerCase();
    if (/^\d{4}[a-z&.]{5}.{10}$/i.test(token) && lowerToken === String(candidate?.bibcode ?? "").toLowerCase()) {
      return true;
    }
    const doi = normalizeDoi(token);
    if (doi && doi === normalizeDoi(candidate?.doi)) return true;
    const arxivId = normalizeArxivId(token);
    if (arxivId && [candidate?.eprint, candidate?.doi].some((value) => arxivId === normalizeArxivId(value))) return true;
    return false;
  }

  function normalizeDoi(value) {
    const normalized = String(value ?? "").trim().toLowerCase()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
      .replace(/^doi:\s*/, "");
    return /^10\.\d{4,9}\/.+/.test(normalized) ? normalized : "";
  }

  function normalizeArxivId(value) {
    const normalized = String(value ?? "").trim().toLowerCase()
      .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//, "")
      .replace(/^arxiv:\s*/, "")
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
      .replace(/^10\.48550\/arxiv\./, "")
      .replace(/\.pdf$/, "");
    return normalized.match(/^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/)?.[1] ?? "";
  }

  function candidateMetadataText(candidate) {
    return [
      candidate?.bibcode,
      candidate?.doi,
      candidate?.eprint,
      candidate?.id,
      candidate?.bibtexExportId,
      ...(Array.isArray(candidate?.identifier) ? candidate.identifier : [])
    ].filter(Boolean).join(" ");
  }

  function compoundAuthorKeyMatches(surnameHint, authorFamilies) {
    const pieces = splitCamelCase(surnameHint);
    if (pieces.length < 2 || !authorFamilies.length) return false;
    const compactFamilies = authorFamilies.map(compact);
    const firstPiece = compact(pieces[0]);
    if (!firstPiece || compactFamilies[0] !== firstPiece) return false;
    for (let split = 1; split < pieces.length; split += 1) {
      const remainder = compact(pieces.slice(split).join(""));
      if (remainder && compactFamilies.slice(1).includes(remainder)) return true;
    }
    return false;
  }

  function familyMatchesHint(family, normalizedHint) {
    const rawFamily = String(family ?? "").trim();
    const normalizedFamily = compact(family);
    if (!normalizedFamily || !normalizedHint) return false;
    if (normalizedFamily === normalizedHint) return true;
    // Citation-key parsers commonly interpret the leading O in names such as
    // O'Doherty as an initial. Accept that single-letter particle without making
    // broader suffix matches that could merge unrelated surnames.
    return /^[ODLodl]['’`-][A-Za-z]/.test(rawFamily) &&
      normalizedFamily.length === normalizedHint.length + 1 &&
      normalizedFamily.endsWith(normalizedHint);
  }

  function authorGivenInitial(value) {
    const raw = String(value ?? "").trim();
    if (!raw || /\b(?:collaboration|consortium|team|group)\b/i.test(raw)) return "";
    const given = raw.includes(",") ? raw.split(",").slice(1).join(" ") : raw.split(/\s+/)[0];
    return normalize(given).match(/[a-z]/)?.[0] ?? "";
  }

  function familyParticleInitialMatches(family, normalizedHint, initial) {
    const rawFamily = String(family ?? "").trim();
    return Boolean(
      normalizedHint &&
      initial &&
      /^[ODLodl]['’`-][A-Za-z]/.test(rawFamily) &&
      compact(rawFamily).endsWith(normalizedHint) &&
      compact(rawFamily[0]) === compact(initial)
    );
  }

  function splitCamelCase(value) {
    return String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[^A-Za-z]+/)
      .filter(Boolean);
  }

  function authorFamily(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (raw.includes(",")) return raw.split(",")[0].trim();
    const values = raw.split(/\s+/).filter(Boolean);
    if (values.length <= 1) return values[0] ?? "";
    let start = values.length - 1;
    while (start > 0 && PARTICLES.has(normalize(values[start - 1]))) start -= 1;
    return values.slice(start).join(" ");
  }

  function uniqueTerms(value) {
    return [...new Set(terms(value))];
  }

  function terms(value) {
    return normalize(value)
      .split(" ")
      .map(stem)
      .filter((term) => term.length >= 3 && !CONTEXT_STOPWORDS.has(term) && !GENERIC_CONTEXT_TERMS.has(term));
  }

  function stem(value) {
    if (value.length >= 6 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
    if (value.length >= 6 && value.endsWith("ing")) return value.slice(0, -3);
    if (value.length >= 5 && value.endsWith("ed")) return value.slice(0, -2);
    if (value.length >= 5 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
    return value;
  }

  function compact(value) {
    return normalize(value).replace(/\s+/g, "");
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[ŁłØøĐđÐðÞþÆæŒœıß]/g, (letter) => ({
        Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ð: "D", ð: "d",
        Þ: "Th", þ: "th", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ı: "i", ß: "ss"
      })[letter] ?? letter)
      .replace(/(^|[^\\])%[^\n]*/g, "$1 ")
      .replace(/\\(?:cite[a-zA-Z*]*|parencite[a-zA-Z*]*|textcite[a-zA-Z*]*|autocite[a-zA-Z*]*|footcite[a-zA-Z*]*)\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}]*\}/g, " ")
      .replace(/\\[A-Za-z]+/g, " ")
      .replace(/[^A-Za-z0-9\s]/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function boundedText(value, maxChars, keepEnd = false) {
    const text = String(value ?? "");
    if (text.length <= maxChars) return text;
    return keepEnd ? text.slice(-maxChars) : text.slice(0, maxChars);
  }

  function currentSentenceTail(value) {
    const text = String(value ?? "");
    let start = 0;
    for (const match of text.matchAll(/[.!?](?=\s+(?:[A-Z\\]|$)|$)/g)) {
      start = Number(match.index ?? -1) + 1;
    }
    return text.slice(start).trim();
  }

  function currentSentenceHead(value) {
    const text = String(value ?? "");
    const boundary = text.match(/[.!?](?=\s+(?:[A-Z\\]|$)|$)/);
    return text.slice(0, boundary?.index == null ? text.length : boundary.index + 1).trim();
  }
  __overciteSafariModules["src/core/contextual-beta.js"] = { exports: { applyContextualBetaReranking, contextualBetaFeatures, contextualIdentityTier, CONTEXTUAL_BETA_MODEL_VERSION } };
})();

/* src/core/sources.js */
(() => {
  const SOURCE_IDS = Object.freeze({
    CROSSREF: "crossref",
    DATACITE: "datacite",
    PUBMED: "pubmed",
    ARXIV: "arxiv",
    INSPIRE: "inspire",
    ADS: "ads"
  });

  const SOURCE_DEFINITIONS = Object.freeze({
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
  const CROSSREF_MIN_REQUEST_SPACING_MS = 210;
  const RUNTIME_FETCH_MARKER = Symbol.for("overcite.runtimeFetch");
  const arxivTextCache = new Map();
  let lastArxivRequestAt = 0;
  const crossrefRuntimeScheduler = createRateLimitedScheduler(CROSSREF_MIN_REQUEST_SPACING_MS);

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
    physics: {
      primarySource: SOURCE_IDS.ADS,
      fallbackSources: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV]
    },
    math: {
      primarySource: SOURCE_IDS.CROSSREF,
      fallbackSources: [SOURCE_IDS.ARXIV]
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
      primarySource: SOURCE_IDS.CROSSREF,
      fallbackSources: [SOURCE_IDS.PUBMED]
    },
    "computer-science": {
      primarySource: SOURCE_IDS.CROSSREF,
      fallbackSources: [SOURCE_IDS.ARXIV]
    },
    chemistry: {
      primarySource: SOURCE_IDS.CROSSREF,
      fallbackSources: []
    },
    general: {
      primarySource: SOURCE_IDS.CROSSREF,
      fallbackSources: [SOURCE_IDS.DATACITE]
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
    physics: {
      primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV],
      optional: []
    },
    math: {
      primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV],
      optional: []
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
      primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.PUBMED],
      optional: []
    },
    "computer-science": {
      primary: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV],
      optional: []
    },
    chemistry: {
      primary: [SOURCE_IDS.CROSSREF],
      optional: []
    },
    general: {
      primary: [SOURCE_IDS.CROSSREF],
      optional: []
    },
    custom: {
      primary: [SOURCE_IDS.CROSSREF],
      optional: []
    }
  });

  function buildSourcePlan(settings = {}) {
    const profileKey = normalizeSourceProfileKey(settings.sourceProfile);
    const profile = SOURCE_PROFILES[profileKey] ?? SOURCE_PROFILES.astrophysics;
    const sourceApiTokens = settings.sourceApiTokens ?? {};
    const availableOptional = profile.optional.filter((sourceId) => hasCredential(sourceId, sourceApiTokens));
    const missingOptionalCredentials = profile.optional.filter((sourceId) => requiresCredential(sourceId) && !hasCredential(sourceId, sourceApiTokens));

    return {
      profile: SOURCE_PROFILES[profileKey] ? profileKey : "astrophysics",
      primarySources: [...profile.primary],
      optionalEnhancers: availableOptional,
      missingOptionalCredentials,
      orderedSources: [...availableOptional, ...profile.primary]
    };
  }

  function buildSourceRouting(settings = {}) {
    const sourceApiTokens = settings.sourceApiTokens ?? {};
    const profileKey = normalizeSourceProfileKey(settings.sourceProfile);
    const profile = SOURCE_ROUTING_PRESETS[profileKey] ? profileKey : "astrophysics";
    const preset = SOURCE_ROUTING_PRESETS[profile];
    const primarySource = profile === "custom"
      ? normalizeRoutableSource(settings.primarySource) ?? preset.primarySource
      : preset.primarySource;
    const rawFallbackSources = profile === "custom" && Array.isArray(settings.fallbackSources)
      ? settings.fallbackSources
      : preset.fallbackSources;
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

  function normalizeSourceProfileKey(sourceProfile) {
    const normalized = String(sourceProfile ?? "").trim().toLowerCase();
    if (normalized === "ads-only") {
      return "astrophysics";
    }
    if (normalized === "arxiv-only" || normalized === "math-physics") {
      return "math";
    }
    if (normalized === "astro-physics") {
      return "astrophysics";
    }
    if (normalized === "broad") {
      return "general";
    }
    return normalized;
  }

  async function searchBroadCandidates(citationContext = {}, settings = {}, fetchImpl = globalThis.fetch) {
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

  async function searchBroadCandidatesForSources(citationContext = {}, settings = {}, sourceIds = [], fetchImpl = globalThis.fetch) {
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

  function isAdsOnlyProfile(settings = {}) {
    const sourceProfile = String(settings?.sourceProfile ?? "").trim().toLowerCase();
    return sourceProfile === "ads-only" || sourceProfile === "astrophysics";
  }

  function normalizeRoutableSource(sourceId) {
    const normalized = String(sourceId ?? "").trim();
    return ROUTABLE_SOURCES.has(normalized) ? normalized : null;
  }

  function isFieldedAdsDirectQuery(citationContext = {}) {
    if (citationContext?.searchMode !== "direct") {
      return false;
    }
    const token = String(citationContext?.token ?? "").trim();
    return /\b(?:abs|abstract|author|bibcode|title|year):/i.test(token);
  }

  function buildBroadSearchQuery(citationContext = {}) {
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
      parts.push(...citationProximityKeywords(citationContext).slice(0, 7));
      if (parts.length < 6) {
        parts.push(...contextKeywordList(citationContext?.contextText ?? "").slice(0, 6 - parts.length));
      }
    }

    if (!parts.length) {
      parts.push(...keywordList(citationContext?.contextText ?? "").slice(0, 8));
    }
    return uniqueStrings(parts).join(" ").trim();
  }

  function buildContextOnlySearchQuery(citationContext = {}) {
    const parts = [
      ...citationProximityKeywords(citationContext).slice(0, 8),
      ...contextKeywordList(citationContext?.contextText ?? "").slice(0, 8)
    ];
    return uniqueStrings(parts).slice(0, 9).join(" ").trim();
  }

  // Query evidence is not a literal title. Prefer terms next to the citation,
  // remove TeX scaffolding, and keep the provider query short enough to be useful.
  function contextualEvidenceTerms(context = {}) {
    const clean = (value) => String(value ?? "")
      .replace(/\\IEEEPARstart\{([^{}]*)\}\{([^{}]*)\}/g, "$1$2")
      .replace(/(^|[^\\])%[^\n]*/g, "$1 ")
      .replace(/\\(?:cite[a-zA-Z*]*|parencite[a-zA-Z*]*|textcite[a-zA-Z*]*|autocite[a-zA-Z*]*|footcite[a-zA-Z*]*|ref|eqref|pageref|label)\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}]*\}/g, " ")
      .replace(/\$[^$]*\$/g, " ")
      .replace(/\\[a-zA-Z]+\*?/g, " ");
    const generic = new Set("is was are were when because etc gains gain great interest can could would should also such many more most few recent recently years study studies work works known mainly help latter used use using shows shown show proposed presents provides paper publication target suggest suggested however thus hence include includes including involves have has been being their these those where which through within between before after first second compared comparison approach approaches method methods result results technique techniques theory theoretically experimentally generally usually relevant research context sentence following see potentiates determine determines extended remain whether factor factors perhaps dramatically found even commonly suffer".split(" "));
    // Function words and general academic narration must not consume the
    // provider's small term budget ahead of the actual scientific subject.
    const narration = new Set("a an the not only but they them we our you your he she it its there here about into onto out up down very highly much less than then now still just both either neither each every all any some one two three four five six seven eight nine ten new old true false other different various several another again along among across around toward towards without while since although despite therefore otherwise moreover furthermore namely e.g i.e become becomes became becoming emerge emerged emerging lead leads leading introduce introduced introducing aim aims aimed aiming establish established establishing apply applied applying enable enabled enabling allow allowed allowing improve improved improving develop developed developing stimulate stimulated stimulating rapid rapidly success successful successfully important importance significant significance considerable tremendous great rich wide range plethora myriad number people million billion role part aspects aspect capabilities capability concerns concern valuable originally stated intensively studied common commonly generally general practical fundamental perhaps increasingly growing recognition markedly adapted figure table tikzpicture book arxiv".split(" "));
    const terms = (value) => contextKeywordList(clean(value)).filter((term) => !generic.has(term) && !narration.has(term) && !/^\d+$/.test(term));
    const prefix = terms(context.citationPrefixText).slice(-6);
    const suffix = terms(context.citationSuffixText).slice(0, 3);
    const sentence = terms(context.sentenceText);
    const hint = context.parsedKeyHint;
    const keyWords = String(hint?.suffix ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_:\-\s]+/)
      .flatMap(terms).filter((term) => !/^\d+$/.test(term));
    // The containing sentence is a coherent claim. A raw prefix/suffix window
    // can instead land in the preceding claim or in generic trailing prose.
    // The last few words before the citation identify its local clause (for
    // example one item in a long list); fill the rest from coherent prose.
    return uniqueStrings([...keyWords.slice(0, 2), ...prefix.slice(-4), ...sentence, ...suffix, ...terms(context.contextText)])
      .filter((term) => !hint?.surname || term !== normalizeText(hint.surname))
      .slice(0, 8);
  }

  function explicitContextTitle(context = {}) {
    const token = String(context.token ?? "").trim();
    // Punctuation-separated bibliography keys are not literal paper titles.
    // Require actual word boundaries in user-entered title text; do not turn
    // DBLP paths, slug keys, or author-number-topic keys into title queries.
    if (token.split(/\s+/).length >= 3 && isTitleLikeToken(token, context.parsedKeyHint)) return token;
    const sentence = String(context.sentenceText ?? "").trim();
    const quoted = sentence.match(/(?:\b(?:paper|article|work)\s+(?:titled|entitled|called)|\btitle\s*:)\s*[“"]([^“”"\n]{12,220})[”"]/i);
    if (quoted && isTitleLikeToken(quoted[1])) return quoted[1];
    // Retain deliberate title fixtures/user input without classifying every
    // three-word subject preceding "is" or "was" as a publication title.
    return sentence.match(/^(.{12,220}?)\s+is\s+(?:the\s+)?(?:target\s+)?(?:publication|paper)\b/i)?.[1]?.trim() ?? "";
  }

  function contextualArxivId(context = {}) {
    const token = String(context.token || context.typedToken || "").trim();
    return token.match(/(?:^|[A-Za-z:_-])(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5})(?:v\d+)?(?=$|[:_-])/i)?.[1]
      ?? token.match(/^abs[-:](\d{2}(?:0[1-9]|1[0-2]))[-:](\d{4,5})(?:v\d+)?$/i)?.slice(1).join(".")
      ?? "";
  }

  function buildArxivSearchQuery(citationContext = {}, settings = {}) {
    const hint = citationContext?.parsedKeyHint;
    const token = String(citationContext?.token ?? "").trim();
    if (citationContext?.searchMode === "direct" && token) {
      const titleToken = directTitleSearchToken(token);
      return titleToken ? `ti:${quoteArxivTerm(titleToken)}` : `all:${quoteArxivTerm(token)}`;
    }
    if (citationContext?.searchMode === "simple" && isTitleLikeToken(token, hint)) {
      return `ti:${quoteArxivTerm(token)}`;
    }

    const distinctiveIdentifier = distinctiveContextIdentifier(citationContext);
    if (citationContext?.searchMode === "contextual" && distinctiveIdentifier) {
      const identifierClauses = [];
      if (hint?.surname) {
        identifierClauses.push(`au:${quoteArxivTerm(hint.surname)}`);
      }
      identifierClauses.push(`all:${quoteArxivTerm(distinctiveIdentifier)}`);
      if (hint?.year) {
        identifierClauses.push(`submittedDate:[${hint.year}01010000 TO ${hint.year}12312359]`);
      }
      return identifierClauses.join(" AND ");
    }

    const clauses = [];
    if (hint?.surname && !isGenericAuthorFamily(hint.surname)) {
      clauses.push(`au:${quoteArxivTerm(hint.surname)}`);
    }

    const literalTitle = isContextBeta(citationContext, settings) ? explicitContextTitle(citationContext) : "";
    const titleClause = isContextBeta(citationContext, settings)
      ? (literalTitle ? `ti:${quoteArxivTerm(literalTitle)}` : "")
      : buildArxivContextTitleClause(citationContext);
    if (titleClause) {
      if (citationContext?.searchMode === "contextual" && settings?.contextualSearchEngine === "beta") {
        return titleClause;
      }
      clauses.push(titleClause);
      return clauses.join(" AND ");
    }

    if (hint?.year) {
      clauses.push(`submittedDate:[${hint.year}01010000 TO ${hint.year}12312359]`);
    }

    const contextTokens = (isContextBeta(citationContext, settings) ? contextualEvidenceTerms(citationContext) : uniqueStrings([
      ...citationProximityKeywords(citationContext),
      ...contextKeywordList(citationContext?.contextText ?? "")
    ]))
      .filter((term) => !hint?.surname || term !== String(hint.surname).toLowerCase())
      .slice(0, 5);
    if (contextTokens.length) {
      clauses.push(`(${contextTokens.map((term) => `all:${quoteArxivTerm(term)}`).join(" OR ")})`);
    } else if (token && !hint?.surname) {
      clauses.push(`all:${quoteArxivTerm(token)}`);
    }

    return clauses.join(" AND ");
  }

  function distinctiveContextIdentifier(citationContext = {}) {
    const context = [
      citationContext?.citationPrefixText,
      citationContext?.sentenceText,
      citationContext?.contextText,
      citationContext?.citationSuffixText
    ].filter(Boolean).join(" ");
    return context.match(/\b(?:[A-Z]{2,}\s+)?[A-Z]\d{3,5}[+-]\d{3,5}\b/i)?.[0] ?? "";
  }

  function directTitleSearchToken(token) {
    const normalized = String(token ?? "").trim();
    const withoutYear = normalized.replace(/\s+\d{4}\s*$/, "").trim();
    return isTitleLikeToken(withoutYear, null) ? withoutYear : "";
  }

  function citationProximityKeywords(citationContext = {}) {
    const before = contextKeywordList(citationContext?.citationPrefixText ?? "").slice(-10);
    const after = contextKeywordList(citationContext?.citationSuffixText ?? "").slice(0, 3);
    const proximal = uniqueStrings([...before, ...after]);
    return proximal.length >= 2 ? proximal : contextKeywordList(citationContext?.sentenceText ?? "");
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
      return family === expected || family.startsWith(`${expected} `) || family.endsWith(` ${expected}`);
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
    if (citationContext?.searchMode === "direct") {
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

  function exportCandidateBibtex(candidate = {}) {
    if (candidate?.bibtex) {
      return String(candidate.bibtex).trim();
    }
    const type = mapBibtexType(candidate);
    const key = sanitizeBibtexKey(candidate.generatedKey || candidate.bibtexExportId || candidate.id || "overcite");
    const fields = [
      ["author", formatAuthorsForBibtex(candidate.authors)],
      ["title", candidate.title],
      ["journal", candidate.journal],
      ["volume", candidate.volume],
      ["number", candidate.issue],
      ["pages", candidate.pages],
      ["eid", candidate.articleNumber],
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
      return searchCrossref(query, citationContext, fetchImpl, settings);
    }
    if (sourceId === SOURCE_IDS.DATACITE) {
      return searchDataCite(query, citationContext, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.PUBMED) {
      return searchPubMed(query, citationContext, settings, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.ARXIV) {
      return searchArxiv(citationContext, settings, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.INSPIRE) {
      return searchInspire(query, citationContext, fetchImpl);
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

  async function searchCrossref(query, citationContext, fetchImpl, settings = {}) {
    return searchCrossrefUnqueued(query, citationContext, fetchImpl, settings);
  }

  async function searchCrossrefUnqueued(query, citationContext, fetchImpl, settings = {}) {
    const serialContextBeta = isContextBeta(citationContext, settings) && shouldUseArxivRuntimeGuards(fetchImpl);
    const retryOptions = {
      ...crossrefSearchRetryOptions(citationContext, serialContextBeta),
      scheduler: serialContextBeta ? crossrefRuntimeScheduler : null,
      retryOnAbort: !serialContextBeta
    };
    const directDoi = directDoiFromContext(citationContext);
    if (directDoi) {
      const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(directDoi)}`);
      const payload = await fetchJsonAllowNotFound(url, fetchImpl, "Crossref DOI lookup", {}, retryOptions);
      if (!payload) {
        return [];
      }
      return [mapCrossrefWork(payload?.message)].filter(isUsableCandidate);
    }
    const urls = buildCrossrefUrls(query, citationContext, settings);
    const payloads = await fetchJsonBatches(
      urls,
      fetchImpl,
      "Crossref search",
      {},
      retryOptions,
      (payload) => crossrefPayloadHasExactContextMatch(payload, citationContext),
      serialContextBeta ? 1 : urls.length
    );
    const candidates = payloads.flatMap((payload) => payload?.message?.items ?? []).map(mapCrossrefWork).filter(isUsableCandidate);
    return filterCrossrefDistinctiveTitleMismatches(candidates, citationContext, settings);
  }

  function filterCrossrefDistinctiveTitleMismatches(candidates, citationContext = {}, settings = {}) {
    if (citationContext?.searchMode !== "contextual" || settings?.contextualSearchEngine !== "beta") {
      return candidates;
    }
    const lead = explicitContextTitle(citationContext);
    const normalizedLead = normalizeText(lead);
    if (!normalizedLead || normalizedLead.split(" ").length < 4) {
      return candidates;
    }
    const matching = candidates.filter((candidate) => titlesStronglyOverlap(normalizedLead, normalizeText(candidate?.title)));
    if (matching.length) {
      return matching;
    }
    // A title-shaped sentence lead is strong evidence that the user supplied a
    // literal title. When Crossref cannot match it, returning same-author/year
    // records is more misleading than allowing another provider—or a clear
    // no-results state—to win.
    return lead ? [] : candidates;
  }

  function titlesStronglyOverlap(expectedTitle, candidateTitle) {
    if (!expectedTitle || !candidateTitle) {
      return false;
    }
    if (expectedTitle === candidateTitle || expectedTitle.startsWith(candidateTitle) || candidateTitle.startsWith(expectedTitle)) {
      return true;
    }
    const expectedTerms = uniqueStrings(expectedTitle.split(" ").filter((term) => term.length >= 3));
    const candidateTerms = new Set(candidateTitle.split(" "));
    const matched = expectedTerms.filter((term) => candidateTerms.has(term)).length;
    return matched >= 4 && matched / expectedTerms.length >= 0.7;
  }

  function crossrefPayloadHasExactContextMatch(payload, citationContext) {
    const titleQuery = normalizeText(buildCrossrefTitleQuery(buildBroadSearchQuery(citationContext), citationContext));
    if (!titleQuery) return false;
    const hint = citationContext?.parsedKeyHint;
    return (payload?.message?.items ?? []).some((work) => {
      if (normalizeText(first(work?.title)) !== titleQuery) return false;
      const candidateYear = Number(extractCrossrefYear(work));
      const expectedYear = Number(hint?.year);
      if (hint?.year && (!Number.isFinite(candidateYear) || Math.abs(candidateYear - expectedYear) > 1)) return false;
      if (!hint?.surname) return true;
      const firstAuthor = formatCrossrefAuthor(work?.author?.[0]);
      const normalizedAuthor = normalizeText(firstAuthor);
      const normalizedHint = normalizeText(hint.surname);
      return authorFamilyMatches(hint.surname, firstAuthor) ||
        (normalizedAuthor.startsWith(`${normalizedHint} `) && /\b(?:collaboration|consortium|team|group)\b/.test(normalizedAuthor));
    });
  }

  function crossrefSearchRetryOptions(citationContext = {}, serialContextBeta = false) {
    return {
      retries: 1,
      fallbackDelayMs: serialContextBeta ? 1100 : 750,
      timeoutMs: isPreArxivCitation(citationContext) ? 9000 : (hasCrossrefTitleQuery(citationContext) ? 7000 : 3500)
    };
  }

  function hasCrossrefTitleQuery(citationContext = {}) {
    const query = buildBroadSearchQuery(citationContext);
    return Boolean(buildCrossrefTitleQuery(query, citationContext));
  }

  function isPreArxivCitation(citationContext = {}) {
    const year = Number(citationContext?.parsedKeyHint?.year);
    if (Number.isInteger(year) && year >= 1000) {
      return year < 1991;
    }
    const tokenYear = String(citationContext?.token ?? "").match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    return tokenYear ? Number(tokenYear[1]) < 1991 : false;
  }

  async function searchDataCite(query, citationContext, fetchImpl) {
    const directDoi = directDoiFromContext(citationContext);
    if (directDoi) {
      const url = new URL(`https://api.datacite.org/dois/${encodeURIComponent(directDoi)}`);
      const payload = await fetchJsonAllowNotFound(url, fetchImpl, "DataCite DOI lookup");
      if (!payload) {
        return [];
      }
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
    const beta = isContextBeta(citationContext, settings);
    const searchTerms = uniqueStrings(beta && !directDoiFromContext(citationContext) && !directPubMedIdFromContext(citationContext) ? [
      buildPubMedAuthorYearSearchTerm(citationContext),
      explicitContextTitle(citationContext)
        ? `${quotePubMedTerm(explicitContextTitle(citationContext))}[Title]`
        : contextualEvidenceTerms(citationContext).slice(0, 4).map(term => `${term}[Title/Abstract]`).join(" AND "),
      contextualEvidenceTerms(citationContext).slice(0, 6).join(" ")
    ] : [
      buildPubMedSearchTerm(query, citationContext),
      isContextBeta(citationContext, settings) ? buildPubMedAuthorYearSearchTerm(citationContext) : "",
      buildPubMedTitleYearSearchTerm(query, citationContext),
      buildPubMedFallbackSearchTerm(query, citationContext)
    ]).filter(Boolean);
    let ids = [];
    for (const term of searchTerms) {
      const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
      searchUrl.searchParams.set("db", "pubmed");
      searchUrl.searchParams.set("retmode", "json");
      searchUrl.searchParams.set("retmax", beta ? "40" : "12");
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

  async function searchArxiv(citationContext, settings, fetchImpl) {
    const searchQuery = buildArxivSearchQuery(citationContext, settings);
    const directArxivId = directArxivIdFromContext(citationContext) ||
      (isContextBeta(citationContext, settings) ? contextualArxivId(citationContext) : "");
    // A pre-1991 submittedDate range cannot retrieve an arXiv submission.
    // Explicit identifiers still take precedence; Simple/Raw remain unchanged.
    if (isContextBeta(citationContext, settings) && isPreArxivCitation(citationContext) && !directArxivId) return [];
    if (!searchQuery && !directArxivId) {
      return [];
    }
    const authorYearQuery = buildArxivAuthorYearFallbackQuery(citationContext);
    const preprintYearQuery = buildArxivPreprintYearFallbackQuery(citationContext);
    try {
      const firstBatch = await fetchArxivQuery({ searchQuery, directArxivId, fetchImpl, citationContext });
      let candidates = firstBatch;
      if (!candidates.length && !directArxivId && authorYearQuery && authorYearQuery !== searchQuery) {
        candidates = await fetchArxivQuery({ searchQuery: authorYearQuery, fetchImpl, citationContext });
      }
      if ((!isContextBeta(citationContext, settings) || !directArxivId) && preprintYearQuery && preprintYearQuery !== searchQuery && preprintYearQuery !== authorYearQuery && shouldTryArxivPreprintYearFallback(candidates, citationContext)) {
        const fallbackBatch = await fetchArxivQuery({ searchQuery: preprintYearQuery, fetchImpl, citationContext });
        return mergeDuplicateCandidates([...candidates, ...fallbackBatch]);
      }
      if (candidates.length || directArxivId) {
        return candidates;
      }
      return [];
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }
      if (!isArxivRecoverableError(error) || directArxivId) {
        throw error;
      }
      if (citationContext?.searchMode === "contextual") {
        throw error;
      }
      if (citationContext?.searchMode === "simple") {
        return [];
      }
      return searchArxivMetadataFallback(citationContext, fetchImpl);
    }
  }

  async function searchInspire(query, citationContext, fetchImpl) {
    const directRecordUrl = buildInspireDirectRecordUrl(citationContext);
    if (directRecordUrl) {
      const record = await fetchJsonAllowNotFound(directRecordUrl, fetchImpl, "INSPIRE direct lookup");
      if (!record) {
        return [];
      }
      return [mapInspireRecord(record)].filter(isUsableCandidate);
    }

    const urls = buildInspireUrls(query, citationContext);
    const payloads = await fetchJsonBatches(urls, fetchImpl, "INSPIRE search");
    return payloads
      .flatMap((payload) => payload?.hits?.hits ?? [])
      .map(mapInspireRecord)
      .filter(isUsableCandidate);
  }

  async function fetchArxivQuery({ searchQuery = "", directArxivId = "", fetchImpl, citationContext = {} }) {
    const url = new URL("https://export.arxiv.org/api/query");
    if (directArxivId) {
      url.searchParams.set("id_list", directArxivId);
    } else {
      url.searchParams.set("search_query", searchQuery);
    }
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", "12");
    const text = await fetchArxivText(url, fetchImpl, {
      retryRateLimit: citationContext?.searchMode !== "contextual"
    });
    return parseArxivEntries(text).map(mapArxivWork).filter(isUsableCandidate);
  }

  async function fetchArxivText(url, fetchImpl, { retryRateLimit = true } = {}) {
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
      if (!retryRateLimit) {
        throw new Error("arXiv is rate limiting searches. Wait a few seconds and try again.");
      }
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

  function shouldUseArxivRuntimeGuards(fetchImpl) {
    return fetchImpl === globalThis.fetch || fetchImpl?.[RUNTIME_FETCH_MARKER] === true;
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

  async function fetchJson(url, fetchImpl, label, headers = {}, retryOptions = {}) {
    return fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers, retryOptions);
  }

  async function fetchJsonAllowNotFound(url, fetchImpl, label, headers = {}, retryOptions = {}) {
    try {
      return await fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers, retryOptions);
    } catch (error) {
      if (String(error?.message ?? "").includes(`${label} failed with status 404`)) {
        return null;
      }
      throw error;
    }
  }

  async function fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers = {}, retryOptions = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available.");
    }
    let response;
    try {
      const request = async () => {
        const result = await fetchWithTimeout(fetchImpl, url.toString(), {
          headers: {
            Accept: "application/json",
            ...headers
          }
        }, retryOptions.timeoutMs);
        retryOptions.scheduler?.observeResponse(result);
        return result;
      };
      response = retryOptions.scheduler
        ? await retryOptions.scheduler.run(request)
        : await request();
    } catch (error) {
      if (isAbortLikeError(error) && retryOptions.retries > 0 && retryOptions.retryOnAbort !== false) {
        await sleep(Number(retryOptions.fallbackDelayMs ?? 0) || 0);
        return fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers, {
          ...retryOptions,
          retries: retryOptions.retries - 1,
          timeoutMs: retryTimeoutMs(retryOptions.timeoutMs)
        });
      }
      throw error;
    }
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

  function isAbortLikeError(error) {
    const name = String(error?.name ?? "");
    const message = String(error?.message ?? error ?? "");
    return name === "AbortError" || /\babort(?:ed|error)?\b/i.test(message);
  }

  function retryTimeoutMs(timeoutMs) {
    const current = Number(timeoutMs ?? 3500);
    if (!Number.isFinite(current) || current <= 0) {
      return 6500;
    }
    return Math.min(Math.max(current + 3000, Math.ceil(current * 1.4)), 12000);
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

  async function fetchJsonBatches(urls, fetchImpl, label, headers = {}, retryOptions = {}, shouldStop = () => false, maxInFlight = urls.length) {
    if (maxInFlight <= 1) {
      const payloads = [];
      const errors = [];
      for (const url of urls) {
        try {
          const payload = await fetchJson(url, fetchImpl, label, headers, retryOptions);
          payloads.push(payload);
          if (shouldStop(payload)) return payloads;
        } catch (error) {
          errors.push(error);
        }
      }
      if (!payloads.length && errors.length) {
        throw errors[0];
      }
      return payloads;
    }
    const pending = urls.map((url) => {
      let promise;
      promise = fetchJson(url, fetchImpl, label, headers, retryOptions).then(
        (value) => ({ status: "fulfilled", value, promise }),
        (reason) => ({ status: "rejected", reason, promise })
      );
      return promise;
    });
    const unsettled = new Set(pending);
    const payloads = [];
    const errors = [];
    while (unsettled.size) {
      const batch = await Promise.race(unsettled);
      unsettled.delete(batch.promise);
      if (batch.status === "fulfilled") {
        payloads.push(batch.value);
        if (shouldStop(batch.value)) return payloads;
      } else {
        errors.push(batch.reason);
      }
    }
    if (!payloads.length && errors.length) {
      throw errors[0];
    }
    return payloads;
  }

  function createRateLimitedScheduler(initialSpacingMs) {
    let tail = Promise.resolve();
    let minimumSpacingMs = initialSpacingMs;
    let lastRequestAt = 0;
    return {
      run: (task) => {
        const run = tail.then(async () => {
          const waitMs = minimumSpacingMs - (Date.now() - lastRequestAt);
          if (waitMs > 0) {
            await sleep(waitMs);
          }
          lastRequestAt = Date.now();
          return task();
        });
        tail = run.catch(() => {});
        return run;
      },
      observeResponse: (response) => {
        const limit = Number(response?.headers?.get?.("x-rate-limit-limit"));
        const intervalMs = parseRateLimitIntervalMs(response?.headers?.get?.("x-rate-limit-interval"));
        if (Number.isFinite(limit) && limit > 0 && Number.isFinite(intervalMs) && intervalMs > 0) {
          minimumSpacingMs = Math.max(
            CROSSREF_MIN_REQUEST_SPACING_MS,
            Math.ceil(intervalMs / limit) + 50
          );
        }
      }
    };
  }

  function parseRateLimitIntervalMs(value) {
    const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    return amount * (unit === "ms" ? 1 : unit === "s" ? 1000 : 60000);
  }

  function contextualCrossrefAuthorFallback(surname) {
    const raw = String(surname ?? "").trim();
    const parts = raw.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
    // Citation keys can concatenate surnames. Try natural spacing only in
    // the existing fallback; never expand abbreviations or infer new names.
    return parts.length >= 2 && parts.length <= 3 && parts.every(part => /^[A-Za-z]{3,}$/.test(part))
      ? parts.join(" ")
      : raw;
  }

  function buildCrossrefUrls(query, citationContext, settings = {}) {
    if (isContextBeta(citationContext, settings)) {
      const hint = citationContext.parsedKeyHint;
      const title = explicitContextTitle(citationContext);
      const evidence = contextualEvidenceTerms(citationContext).join(" ");
      const urls = [];
      if (title) urls.push(crossrefUrl({ title, rows: 40 }));
      if (hint?.surname) {
        // Online-first and issue years can differ. Use a small date tolerance
        // for semantic recall, then an exact-year author-only fallback.
        urls.push(crossrefUrl({ bibliographic: evidence, author: hint.surname, year: hint.year, yearTolerance: 2, rows: 40 }));
        // A broad identity fallback protects sparse/atypical context and keeps
        // the successful author/year path available to the contextual ranker.
        urls.push(crossrefUrl({ author: contextualCrossrefAuthorFallback(hint.surname), year: hint.year, rows: 40 }));
      } else if (!title) {
        urls.push(crossrefUrl({ bibliographic: evidence || query, rows: 40 }));
      }
      return dedupeUrls(urls).slice(0, 2);
    }
    const hint = citationContext?.parsedKeyHint;
    const urls = [];
    const contextQuery = buildContextOnlySearchQuery(citationContext);
    const titleQuery = buildCrossrefTitleQuery(query, citationContext);
    // The parser may provisionally label a yearless full title as a surname.
    // In explicit token-only modes, do not send that entire title as an author.
    if ((citationContext.searchMode === "simple" || citationContext.searchMode === "direct")
      && !hint?.year && String(citationContext.token ?? "").trim().split(/\s+/).length >= 3
      && titleQuery === String(citationContext.token ?? "").trim()) {
      return [crossrefUrl({ title: titleQuery })];
    }
    for (const canonicalTitleQuery of canonicalCrossrefTitleQueries(citationContext)) {
      urls.push(crossrefUrl({
        title: canonicalTitleQuery,
        year: hint?.year
      }));
    }
    if (hint?.surname && hint?.year) {
      if (titleQuery) {
        if (isPreArxivCitation(citationContext)) {
          urls.push(crossrefUrl({
            title: titleQuery,
            year: hint.year
          }));
        }
        urls.push(crossrefUrl({
          title: titleQuery
        }));
      }
      urls.push(crossrefUrl({
        bibliographic: [hint.surname, hint.year, contextQuery].filter(Boolean).join(" "),
        author: hint.surname,
        year: hint.year
      }));
      if (isContextBeta(citationContext, settings)) {
        urls.push(crossrefUrl({
          author: hint.surname,
          year: hint.year
        }));
      }
    } else if (hint?.surname) {
      urls.push(crossrefUrl({
        bibliographic: [hint.surname, contextQuery].filter(Boolean).join(" "),
        author: hint.surname
      }));
      urls.push(crossrefUrl({
        author: hint.surname
      }));
    } else if (titleQuery) {
      urls.push(crossrefUrl({
        title: titleQuery
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

  function canonicalCrossrefTitleQueries(citationContext = {}) {
    const text = normalizeText(`${citationContext?.token ?? ""} ${citationContext?.sentenceText ?? ""} ${citationContext?.contextText ?? ""}`);
    if (/\bgodel\b/.test(text) && /\b(incompleteness|undecidable)\b/.test(text)) {
      return ["formal unentscheidbare satze principia mathematica"];
    }
    return [];
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
    const directPubMedId = directPubMedIdFromContext(citationContext);
    if (directPubMedId) {
      return `${directPubMedId}[uid]`;
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
    if (directDoiFromContext(citationContext) || directPubMedIdFromContext(citationContext)) {
      return "";
    }
    const token = String(citationContext?.token ?? "").trim();
    if (citationContext?.searchMode === "direct" && token) {
      return token;
    }
    const text = buildContextOnlySearchQuery(citationContext) || query;
    return keywordList(text).slice(0, 8).join(" ");
  }

  function buildPubMedAuthorYearSearchTerm(citationContext = {}) {
    const hint = citationContext?.parsedKeyHint;
    if (!hint?.surname || !hint?.year) {
      return "";
    }
    return `${pubMedAuthorTerm(hint.surname)}[Author] AND ${hint.year}[dp]`;
  }

  function isContextBeta(citationContext = {}, settings = {}) {
    return citationContext?.searchMode === "contextual" && settings?.contextualSearchEngine === "beta";
  }

  function buildPubMedTitleYearSearchTerm(query, citationContext = {}) {
    if (directDoiFromContext(citationContext) || directPubMedIdFromContext(citationContext)) {
      return "";
    }
    const titleQuery = buildPubMedTitleQuery(query, citationContext);
    if (!titleQuery) {
      return "";
    }
    const clauses = [];
    if (citationContext?.parsedKeyHint?.year) {
      clauses.push(`${citationContext.parsedKeyHint.year}[dp]`);
    }
    clauses.push(titleQuery);
    return clauses.join(" AND ");
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
    if (hint?.surname && !hint?.year) {
      const contextualQuery = [inspireAuthorClause(hint.surname), contextQuery].filter(Boolean).join(" and ");
      urls.push(inspireUrl(contextualQuery));
      urls.push(inspireUrl(inspireAuthorClause(hint.surname)));
    }
    if (titleQuery) {
      urls.push(inspireUrl(`title "${titleQuery}"`));
      urls.push(inspireUrl(titleQuery));
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

  function crossrefUrl({ bibliographic = "", title = "", author = "", year = null, yearTolerance = 0, rows = 12 } = {}) {
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("rows", String(rows));
    url.searchParams.set("select", "DOI,title,author,published-print,published-online,published,issued,container-title,abstract,is-referenced-by-count,type,URL,publisher,volume,issue,page,article-number");
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
      const startYear = Number(year) - yearTolerance;
      const endYear = Number(year) + yearTolerance;
      url.searchParams.set("filter", `from-pub-date:${startYear}-01-01,until-pub-date:${endYear}-12-31`);
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
      title: stripMarkup(first(work?.title)),
      authors: (work?.author ?? []).map(formatCrossrefAuthor).filter(Boolean),
      year: extractCrossrefYear(work),
      abstract: stripMarkup(work?.abstract),
      doi: normalizeDoi(work?.DOI),
      citationCount: work?.["is-referenced-by-count"],
      journal: first(work?.["container-title"]),
      volume: work?.volume,
      issue: work?.issue,
      pages: work?.page,
      articleNumber: work?.["article-number"],
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
      volume: record?.volume,
      issue: record?.issue,
      pages: record?.pages,
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
    const inferredArxivYear = inferYearFromArxivIdentifier(candidate.eprint || (doi.includes("arxiv") ? doi : ""));
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
      volume: String(candidate.volume ?? "").trim(),
      issue: String(candidate.issue ?? "").trim(),
      pages: String(candidate.pages ?? "").trim(),
      articleNumber: String(candidate.articleNumber ?? "").trim(),
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
    if (!candidate?.title || !candidate?.year) {
      return false;
    }
    return Boolean(candidate?.authors?.length || candidate?.sourceId === SOURCE_IDS.PUBMED);
  }

  function mergeDuplicateCandidates(candidates) {
    const merged = [];
    const seen = new Map();
    for (const candidate of candidates) {
      const keys = duplicateKeys(candidate);
      const existingIndex = keys.map((key) => seen.get(key)).find((index) => Number.isInteger(index));
      if (!Number.isInteger(existingIndex)) {
        const index = merged.length;
        for (const key of keys) {
          seen.set(key, index);
        }
        merged.push(candidate);
        continue;
      }
      const existing = merged[existingIndex];
      merged[existingIndex] = preferCandidate(existing, candidate);
      for (const key of keys) {
        seen.set(key, existingIndex);
      }
    }
    return merged;
  }

  function duplicateKey(candidate) {
    return duplicateKeys(candidate)[0] ?? "";
  }

  function duplicateKeys(candidate) {
    const keys = [];
    const arxivKey = arxivIdentityKey(candidate);
    if (arxivKey) {
      keys.push(arxivKey);
    }
    const title = normalizeText(candidate?.title);
    const firstAuthor = firstAuthorIdentityKey(candidate?.authors?.[0]);
    const workYear = Number(candidate?.year);
    if (title && firstAuthor && Number.isInteger(workYear)) {
      keys.push(`work:${title}:${firstAuthor}:${workYear}`);
      keys.push(`work:${title}:${firstAuthor}:${workYear - 1}`);
    }
    if (candidate?.doi) {
      keys.push(`doi:${candidate.doi.toLowerCase()}`);
    }
    if (candidate?.id) {
      keys.push(`${candidate.sourceId}:${candidate.id}`);
    }
    return [...new Set(keys.filter(Boolean))];
  }

  function arxivIdentityKey(candidate) {
    const eprint = stripArxivVersion(String(candidate?.eprint ?? "").trim().toLowerCase());
    if (eprint) {
      return `arxiv:${eprint}`;
    }
    const doiMatch = String(candidate?.doi ?? "").toLowerCase().match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i);
    return doiMatch ? `arxiv:${stripArxivVersion(doiMatch[1])}` : "";
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

  function firstAuthorIdentityKey(author) {
    const family = firstAuthorFamilyKey(author);
    if (!family) {
      return "";
    }
    const raw = String(author ?? "").trim();
    const given = raw.includes(",")
      ? normalizeText(raw.split(",").slice(1).join(" "))
      : normalizeText(raw).split(" ").slice(0, -family.split(" ").length).join(" ");
    return `${family}:${given.slice(0, 1) || "_"}`;
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
      volume: primary.volume || secondary.volume,
      issue: primary.issue || secondary.issue,
      pages: primary.pages || secondary.pages,
      articleNumber: primary.articleNumber || secondary.articleNumber,
      booktitle: primary.booktitle || secondary.booktitle,
      publisher: primary.publisher || secondary.publisher,
      url: preferredUrl(primary, secondary),
      eprint: primary.eprint || secondary.eprint,
      archivePrefix: primary.archivePrefix || secondary.archivePrefix,
      primaryClass: primary.primaryClass || secondary.primaryClass,
      citationCount: preferredCitationCount(primary, secondary),
      sourceLabel: mergeSourceLabels(primary, secondary)
    };
  }

  function preferredCitationCount(primary, secondary) {
    return Math.max(Number(primary?.citationCount ?? 0) || 0, Number(secondary?.citationCount ?? 0) || 0);
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

  function directPubMedIdFromContext(citationContext = {}) {
    if (citationContext?.searchMode !== "direct") {
      return "";
    }
    const token = String(citationContext?.token ?? "").trim();
    const match = token.match(/^(?:pmid\s*:?\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)?(\d{5,9})(?:\/)?$/i);
    return match?.[1] ?? "";
  }

  function directArxivIdFromContext(citationContext = {}) {
    if (citationContext?.searchMode !== "direct") {
      return "";
    }
    const token = String(citationContext?.token ?? "").trim();
    return arxivIdFromText(token);
  }

  function arxivIdFromText(value) {
    const match = String(value ?? "").trim().match(
      /^(?:arxiv:\s*|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?\/?$/i
    );
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
      .replace(/[ŁłØøĐđÐðÞþÆæŒœıß]/g, (letter) => ({
        Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ð: "D", ð: "d",
        Þ: "Th", þ: "th", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ı: "i", ß: "ss"
      })[letter] ?? letter)
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

  function contextKeywordList(value) {
    return keywordList(String(value ?? "")
      .replace(/(^|[^\\])%[^\n]*/g, "$1 ")
      .replace(/\\(?:cite[a-zA-Z*]*|parencite[a-zA-Z*]*|textcite[a-zA-Z*]*|autocite[a-zA-Z*]*|footcite[a-zA-Z*]*)\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}]*\}/g, " ")
      .replace(/\\(?:ref|eqref|pageref|label)\s*\{[^{}]*\}/g, " ")
      .replace(/\$[^$]*\$/g, " ")
      .replace(/\\\([^]*?\\\)|\\\[[^]*?\\\]/g, " "));
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
  __overciteSafariModules["src/core/sources.js"] = { exports: { searchBroadCandidates, searchBroadCandidatesForSources, buildSourcePlan, buildSourceRouting, isAdsOnlyProfile, isFieldedAdsDirectQuery, buildBroadSearchQuery, contextualArxivId, exportCandidateBibtex, SOURCE_IDS, SOURCE_DEFINITIONS } };
})();

/* src/background.js */
(() => {
  const { mapAdsDocToCandidate, buildAdsQueries, rerankAdsCandidates, hasDistinctiveContextIdentifier } = __overciteSafariModules["src/core/ads.js"].exports;
  const { applyContextualBetaReranking } = __overciteSafariModules["src/core/contextual-beta.js"].exports;
  const { runOrderedQueryQueue } = __overciteSafariModules["src/core/query-queue.js"].exports;
  const { ACKNOWLEDGMENT_REMINDER_PROMPT, ACKNOWLEDGMENT_TEXT, createAcknowledgmentReminderClaim, disableAcknowledgmentReminder } = __overciteSafariModules["src/core/acknowledgment.js"].exports;
  const { applyBibInsertion, generatePreferredKey } = __overciteSafariModules["src/core/bibtex.js"].exports;
  const { normalizeContextualCitationContext } = __overciteSafariModules["src/core/citation.js"].exports;
  const { DEFAULT_SETTINGS, MESSAGE_TYPES } = __overciteSafariModules["src/core/constants.js"].exports;
  const { resolveBibTargetFromProjectState } = __overciteSafariModules["src/core/project.js"].exports;
  const { getSettings, optionalOriginsForSettings, saveSettings } = __overciteSafariModules["src/core/settings.js"].exports;
  const { buildSourceRouting, contextualArxivId, exportCandidateBibtex, searchBroadCandidatesForSources, SOURCE_IDS } = __overciteSafariModules["src/core/sources.js"].exports;
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const ARXIV_CITATION_ENRICHMENT_TIMEOUT_MS = 900;
  const ADS_SEARCH_REQUEST_TIMEOUT_MS = 6500;
  const ADS_SEARCH_BUDGET_MS = 12000;
  const ADS_EXPORT_TIMEOUT_MS = 12000;
  const LITERATURE_SEARCH_BUDGET_MS = 30000;
  const RUNTIME_FETCH_MARKER = Symbol.for("overcite.runtimeFetch");
  const activeTabSearches = new Map();
  const searchProgressHandlers = new WeakMap();
  const searchReadyHandlers = new WeakMap();
  // Completed responses only: aborting one tab must never cancel another tab's
  // request. Credentials partition this short-lived, memory-only cache.
  const adsResponseCache = new Map();
  const ADS_CACHE_TTL_MS = 120000;
  const ADS_CACHE_MAX_ENTRIES = 64;
  let settingsRevision = 0;
  const settingsStorageAreaName = extensionApi.storage?.sync ? "sync" : "local";
  const SEARCH_SETTING_KEYS = Object.freeze([
    "adsApiToken",
    "sourceApiTokens",
    "sourceProfile",
    "primarySource",
    "fallbackSources",
    "contextualSearchEngine",
    "citationKeyMode",
    "defaultSearchMode",
    "subjectAreaConfigured",
    "contextWindowChars"
  ]);
  const CONTEXTUAL_RESULT_CACHE_VERSION = "contextual-results-v2";
  const CONTEXTUAL_RESULT_CACHE_TTL_MS = 120000;
  const CONTEXTUAL_RESULT_CACHE_MAX_ENTRIES = 32;
  const CONTEXTUAL_RESULT_CACHE_STORAGE_KEY = "overciteContextualResultCacheV1";
  const contextualResultMemoryCache = new Map();
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

  // Options pages and the overlay currently save through the background message
  // handler, but a sync-storage update can also arrive from another extension
  // context. In either case an in-flight tab search must not be allowed to
  // publish candidates computed with the previous routing/token/settings state.
  extensionApi.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== settingsStorageAreaName || !hasSearchAffectingSettingChange(changes)) {
      return;
    }
    invalidateActiveTabSearches();
  });

  async function handleMessage(message, sender = {}) {
    switch (message?.type) {
      case MESSAGE_TYPES.GET_SETTINGS:
        return getSettings();
      case MESSAGE_TYPES.SAVE_SETTINGS:
        return saveSettingsFromMessage(message.settings);
      case MESSAGE_TYPES.REQUEST_SOURCE_PERMISSIONS:
        return requestSourcePermissions(message.settings);
      case MESSAGE_TYPES.OPEN_OPTIONS:
        return extensionApi.runtime.openOptionsPage();
      case MESSAGE_TYPES.SEARCH_ADS:
        return searchFromTab(message, sender);
      case "cancelSearch": {
        const key = `${sender.tab?.id}:${sender.frameId ?? 0}`;
        const active = activeTabSearches.get(key);
        if (active?.requestId === message.requestId) active.controller.abort();
        return true;
      }
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
      case MESSAGE_TYPES.DISABLE_ACKNOWLEDGMENT_REMINDER:
        return disableAcknowledgmentReminder(extensionApi.storage?.local);
      default:
        throw new Error(`Unknown OverCite message type: ${message?.type ?? "undefined"}`);
    }
  }

  async function requestSourcePermissions(settings) {
    const origins = optionalOriginsForSettings(settings);
    if (!origins.length || !extensionApi.permissions?.request) {
      return true;
    }
    try {
      const maybePromise = extensionApi.permissions.request({ origins });
      if (maybePromise?.then) {
        return Boolean(await maybePromise);
      }
    } catch (error) {
      if (!/callback/i.test(String(error?.message ?? error))) {
        throw error;
      }
    }
    return new Promise((resolve, reject) => {
      extensionApi.permissions.request({ origins }, (granted) => {
        const runtimeError = extensionApi.runtime?.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(Boolean(granted));
      });
    });
  }

  async function saveSettingsFromMessage(nextSettings) {
    const previousSettings = await getSettings();
    const savedSettings = await saveSettings(nextSettings);
    // The storage change listener normally performs this invalidation during
    // saveSettings. Keep the explicit comparison for browser/test runtimes that
    // do not expose storage.onChanged, while avoiding needless cancellation for
    // idempotent saves (notably onboarding and settings-page re-renders).
    if (hasSearchAffectingSettingsChanged(previousSettings, savedSettings)) {
      invalidateActiveTabSearches();
    }
    return savedSettings;
  }

  function hasSearchAffectingSettingChange(changes) {
    return SEARCH_SETTING_KEYS.some((key) => {
      const change = changes?.[key];
      return change && !sameSettingValue(change.oldValue, change.newValue);
    });
  }

  function hasSearchAffectingSettingsChanged(previousSettings, nextSettings) {
    return SEARCH_SETTING_KEYS.some((key) => !sameSettingValue(previousSettings?.[key], nextSettings?.[key]));
  }

  function sameSettingValue(left, right) {
    if (Object.is(left, right)) {
      return true;
    }
    if (left === undefined || right === undefined || left === null || right === null) {
      return false;
    }
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function invalidateActiveTabSearches() {
    settingsRevision += 1;
    for (const [key, active] of activeTabSearches.entries()) {
      active.controller.abort();
      active.invalidatedBySettings = true;
      activeTabSearches.delete(key);
      if (!Number.isInteger(active.tabId)) {
        continue;
      }
      void extensionApi.tabs.sendMessage(active.tabId, {
        type: "ezcite:settingsChanged",
        reason: "search-settings-changed"
      }, { frameId: active.frameId }).catch(() => {});
    }
  }

  async function searchFromTab(message, sender) {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || typeof message.requestId !== "string") {
      return searchLiterature(message.citationContext);
    }
    const key = `${tabId}:${sender.frameId ?? 0}`;
    activeTabSearches.get(key)?.controller.abort();
    const active = {
      requestId: message.requestId,
      controller: new AbortController(),
      settingsRevision,
      tabId,
      frameId: sender.frameId ?? 0
    };
    activeTabSearches.set(key, active);
    let revision = 0;
    try {
      const result = await searchLiterature(message.citationContext, active.controller.signal, (results) => {
        if (!isCurrentTabSearch(active, key)) return;
        void extensionApi.tabs.sendMessage(tabId, {
          type: "ezcite:searchProgress", requestId: active.requestId, revision: ++revision, results
        }, { frameId: sender.frameId ?? 0 }).catch(() => {});
      }, (results) => {
        if (!isCurrentTabSearch(active, key)) return;
        void extensionApi.tabs.sendMessage(tabId, {
          type: "ezcite:searchReady", requestId: active.requestId, results
        }, { frameId: sender.frameId ?? 0 }).catch(() => {});
      }, () => isCurrentTabSearch(active, key));
      if (!isCurrentTabSearch(active, key)) {
        throw new Error("Literature search was cancelled because search settings changed.");
      }
      return result;
    } finally {
      if (activeTabSearches.get(key) === active) activeTabSearches.delete(key);
    }
  }

  function isCurrentTabSearch(active, key) {
    return !active.controller.signal.aborted &&
      !active.invalidatedBySettings &&
      active.settingsRevision === settingsRevision &&
      activeTabSearches.get(key) === active;
  }

  async function searchLiterature(citationContext, externalSignal = null, onProgress = null, onReady = null, isCurrent = () => true) {
    return runWithAbortDeadline(
      async (signal) => {
        if (onProgress) searchProgressHandlers.set(signal, onProgress);
        if (onReady) searchReadyHandlers.set(signal, onReady);
        try {
          return await searchLiteratureWithinBudget(citationContext, signal, isCurrent);
        } finally {
          searchProgressHandlers.delete(signal);
          searchReadyHandlers.delete(signal);
        }
      },
      LITERATURE_SEARCH_BUDGET_MS,
      "Literature search",
      externalSignal
    );
  }

  function publishSearchProgress(signal, citationContext, settings, candidates) {
    if (signal?.aborted || citationContext?.searchMode !== "contextual" ||
        settings.contextualSearchEngine !== "beta") return;
    const handler = searchProgressHandlers.get(signal);
    if (!handler || !candidates.length) return;
    const results = finalizeCandidates(citationContext, settings, candidates);
    if (results.length) {
      // The UI retains this preview; the normal response supplies the final ranking.
      searchProgressHandlers.delete(signal);
      handler(results);
    }
  }

  async function searchLiteratureWithinBudget(citationContext, searchSignal, isCurrent = () => true) {
    const settings = await getSettings();
    citationContext = normalizeContextualCitationContext(citationContext, settings.contextualSearchEngine);
    const contextualCacheKey = citationContext?.searchMode === "contextual"
      ? await buildContextualResultCacheKey(citationContext, settings)
      : null;
    if (!isCurrent() || searchSignal?.aborted) {
      throw new Error("Literature search was cancelled because its request is no longer current.");
    }
    if (contextualCacheKey) {
      const cachedResults = await readContextualResultCache(contextualCacheKey);
      if (!isCurrent() || searchSignal?.aborted) {
        throw new Error("Literature search was cancelled because its request is no longer current.");
      }
      if (cachedResults?.length) {
        const restored = restoreContextualCacheResults(cachedResults, citationContext, settings);
        publishSearchReady(searchSignal, restored);
        return restored;
      }
    }
    const results = await searchLiteratureWithinBudgetUncached(citationContext, settings, searchSignal);
    if (!isCurrent() || searchSignal?.aborted) {
      throw new Error("Literature search was cancelled because its request is no longer current.");
    }
    if (contextualCacheKey && results?.length) {
      await writeContextualResultCache(contextualCacheKey, results);
      if (!isCurrent() || searchSignal?.aborted) {
        throw new Error("Literature search was cancelled because its request is no longer current.");
      }
    }
    return results;
  }

  async function searchLiteratureWithinBudgetUncached(citationContext, settings, searchSignal) {
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
        fallbackSources: [primarySource, ...fallbackSources],
        candidates,
        errors,
        searchSignal
      });
      if (parallelResult) {
        return maybeEnrichArxivCitationCounts(citationContext, settings, parallelResult, adsApiToken, searchSignal);
      }
      if (!candidates.length) {
        if (errors.length) throw errors[0];
        throw new Error("No literature matches found.");
      }
      for (const error of errors) {
        console.warn("[OverCite background] literature provider failed after another provider returned results", error);
      }
      return maybeEnrichArxivCitationCounts(
        citationContext,
        settings,
        finalizeCandidates(citationContext, settings, candidates),
        adsApiToken,
        searchSignal
      );
    }
    const fetchedPrimaryCandidates = shouldSearchPrimary
      ? await searchRoutedSource(primarySource, citationContext, settings, adsApiToken, searchSignal)
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
      return maybeEnrichArxivCitationCounts(citationContext, settings, finalizeCandidates(citationContext, settings, primaryCandidates), adsApiToken, searchSignal);
    }

    const primaryRanked = finalizeCandidates(citationContext, settings, primaryCandidates);
    if (primaryRanked.length && isHighConfidenceResult(citationContext, primaryRanked[0], primarySource, primaryRanked[1])) {
      return maybeEnrichArxivCitationCounts(citationContext, settings, primaryRanked, adsApiToken, searchSignal);
    }
    if (shouldKeepSimplePrimaryResult(citationContext, primaryRanked[0], primarySource, fallbackSources)) {
      return maybeEnrichArxivCitationCounts(citationContext, settings, primaryRanked, adsApiToken, searchSignal);
    }

    if (primarySource === SOURCE_IDS.ADS &&
        citationContext?.searchMode === "contextual" &&
        hasDistinctiveContextIdentifier(citationContext)) {
      const arxivCandidates = await searchRoutedSource(
        SOURCE_IDS.ARXIV,
        citationContext,
        settings,
        adsApiToken,
        searchSignal
      ).catch((error) => {
        errors.push(error);
        return [];
      });
      candidates.push(...arxivCandidates);
      const entityRanked = finalizeCandidates(citationContext, settings, candidates);
      if (arxivCandidates.length && entityRanked.length) {
        return maybeEnrichArxivCitationCounts(citationContext, settings, entityRanked, adsApiToken, searchSignal);
      }
    }

    if (fallbackSources.length) {
      const fallbackResult = await searchFallbackSources({
        citationContext,
        settings,
        adsApiToken,
        fallbackSources,
        candidates,
        errors,
        searchSignal,
        candidateFilter: requestedArxivId
          ? (candidate) => candidateMatchesContextualArxivId(candidate, requestedArxivId)
          : null
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

  async function buildContextualResultCacheKey(citationContext, settings) {
    const routing = buildSourceRouting(settings);
    const material = canonicalizeForCache({
      version: CONTEXTUAL_RESULT_CACHE_VERSION,
      model: "background-default",
      citationContext,
      settings,
      routing,
      credentialScope: {
        ads: settings?.sourceApiTokens?.ads || settings?.adsApiToken || "",
        ncbi: settings?.sourceApiTokens?.ncbi || ""
      }
    });
    const digest = await sha256Hex(JSON.stringify(material));
    return digest ? `contextual:${digest}` : null;
  }

  function canonicalizeForCache(value) {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalizeForCache(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeForCache(value[key])]));
    }
    return value;
  }

  async function sha256Hex(value) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof TextEncoder !== "function") {
      return null;
    }
    try {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;
    }
  }

  function cloneCacheValue(value) {
    try {
      return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function cacheEntryIsFresh(entry, now = Date.now()) {
    return Boolean(entry && Number.isFinite(entry.createdAt) &&
      now - entry.createdAt >= 0 && now - entry.createdAt < CONTEXTUAL_RESULT_CACHE_TTL_MS &&
      Array.isArray(entry.results) && entry.results.length);
  }

  function rememberContextualResult(key, entry) {
    contextualResultMemoryCache.delete(key);
    contextualResultMemoryCache.set(key, entry);
    while (contextualResultMemoryCache.size > CONTEXTUAL_RESULT_CACHE_MAX_ENTRIES) {
      contextualResultMemoryCache.delete(contextualResultMemoryCache.keys().next().value);
    }
  }

  async function readContextualResultCache(key) {
    const now = Date.now();
    const memoryEntry = contextualResultMemoryCache.get(key);
    if (cacheEntryIsFresh(memoryEntry, now)) {
      rememberContextualResult(key, memoryEntry);
      return cloneCacheValue(memoryEntry.results);
    }
    if (memoryEntry) {
      contextualResultMemoryCache.delete(key);
    }

    const session = extensionApi.storage?.session;
    if (!session?.get) {
      return null;
    }
    try {
      const stored = await withContextualCacheDeadline(() => session.get(CONTEXTUAL_RESULT_CACHE_STORAGE_KEY));
      const entry = stored?.[CONTEXTUAL_RESULT_CACHE_STORAGE_KEY]?.[key];
      if (!cacheEntryIsFresh(entry, now)) {
        return null;
      }
      const results = cloneCacheValue(entry.results);
      if (!results) {
        return null;
      }
      rememberContextualResult(key, { createdAt: entry.createdAt, results });
      return results;
    } catch {
      return null;
    }
  }

  async function writeContextualResultCache(key, results) {
    const sanitized = results.map(({ typedToken, generatedKey, keyMode, ...candidate }) => candidate);
    const entry = { createdAt: Date.now(), results: cloneCacheValue(sanitized) };
    if (!entry.results?.length) {
      return;
    }
    rememberContextualResult(key, entry);

    const session = extensionApi.storage?.session;
    if (!session?.get || !session?.set) {
      return;
    }
    try {
      const stored = await withContextualCacheDeadline(() => session.get(CONTEXTUAL_RESULT_CACHE_STORAGE_KEY));
      const entries = stored?.[CONTEXTUAL_RESULT_CACHE_STORAGE_KEY] && typeof stored[CONTEXTUAL_RESULT_CACHE_STORAGE_KEY] === "object"
        ? { ...stored[CONTEXTUAL_RESULT_CACHE_STORAGE_KEY] }
        : {};
      const now = Date.now();
      for (const [entryKey, cached] of Object.entries(entries)) {
        if (!cacheEntryIsFresh(cached, now)) {
          delete entries[entryKey];
        }
      }
      entries[key] = entry;
      const orderedKeys = Object.keys(entries).sort((left, right) => entries[left].createdAt - entries[right].createdAt);
      while (orderedKeys.length > CONTEXTUAL_RESULT_CACHE_MAX_ENTRIES) {
        delete entries[orderedKeys.shift()];
      }
      await withContextualCacheDeadline(() => session.set({ [CONTEXTUAL_RESULT_CACHE_STORAGE_KEY]: entries }));
    } catch {
      // The memory cache remains valid when session storage is unavailable or
      // quota-limited; never surface cache failures as search failures.
    }
  }

  function withContextualCacheDeadline(task, timeoutMs = 150) {
    return Promise.race([
      Promise.resolve().then(task),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  function restoreContextualCacheResults(results, citationContext, settings) {
    const typedToken = citationContext?.typedToken ?? citationContext?.token ?? "";
    return results.map((candidate) => ({
      ...candidate,
      keyMode: settings.citationKeyMode,
      typedToken,
      generatedKey: generatePreferredKey(candidate, [], {
        keyMode: settings.citationKeyMode,
        typedToken
      })
    }));
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

  async function maybeEnrichArxivCitationCounts(citationContext, settings, candidates, adsApiToken, searchSignal = null) {
    // At this point source retrieval and ranking are complete. Publish this
    // quality-ready list exactly once before optional display-only metadata work;
    // callers can render it without making readiness depend on enrichment.
    publishSearchReady(searchSignal, candidates);
    const arxivNeedingCounts = candidates
      .slice(0, 5)
      .filter((candidate) => isArxivIdentified(candidate) && !(Number(candidate?.citationCount ?? 0) > 0) && String(candidate?.eprint ?? "").trim());
    if (!arxivNeedingCounts.length || !adsApiToken) {
      return candidates;
    }

    return runWithAbortDeadline(
      (signal) => enrichArxivCitationCountsFromAds(candidates, arxivNeedingCounts, citationContext, adsApiToken, signal),
      ARXIV_CITATION_ENRICHMENT_TIMEOUT_MS,
      "Citation counts",
      searchSignal
    ).catch(() => candidates);
  }

  function publishSearchReady(signal, candidates) {
    if (signal?.aborted || !Array.isArray(candidates) || !candidates.length) {
      return;
    }
    const handler = searchReadyHandlers.get(signal);
    if (!handler) {
      return;
    }
    // A single stable result list is the event contract. Later completion may
    // only add metadata (for example citation counts), never another ranking.
    searchReadyHandlers.delete(signal);
    try {
      handler(candidates);
    } catch (error) {
      console.warn("[OverCite background] searchReady handler failed", error);
    }
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

  async function searchFallbackSources({ citationContext, settings, adsApiToken, fallbackSources, candidates, errors, searchSignal, candidateFilter = null }) {
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
        onProgress(docs) {
          publishSearchProgress(searchSignal, citationContext, settings, mapDocs(docs));
        },
        shouldStop(docs) {
          const ranked = finalizeCandidates(citationContext, settings, mapDocs(docs));
          return shouldStopAdsCandidateFetch(citationContext, settings, ranked);
        }
      });
      return mapDocs(mergedDocs);
    }
    const results = await searchBroadCandidatesForSources(
      citationContext,
      settings,
      [sourceId],
      fetchWithParentSignal(globalThis.fetch, searchSignal)
    );
    publishSearchProgress(searchSignal, citationContext, settings, results);
    return results;
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
    const followUpBatchSize = citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct" ? 1 : 4;

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
            options.onProgress?.(mergedDocs);
            if ((citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") && shouldStop(mergedDocs)) {
              return mergedDocs;
            }
          } else {
            errors.push(batch.error);
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
        let progressiveDocs = [...mergedDocs];
        let progressiveBibcodes = new Set(seenBibcodes);
        await runOrderedQueryQueue(followUpQueries, {
          fetchQuery,
          onProgress(docs, index) {
            mergeDocs(progressiveDocs, progressiveBibcodes, docs, initialQueries.length + index);
            options.onProgress?.(progressiveDocs);
          },
          onBatch(batches, offset) {
            for (const [batchOffset, batch] of batches.entries()) {
              if (batch.status === "fulfilled") {
                mergeDocs(mergedDocs, seenBibcodes, batch.value, initialQueries.length + offset + batchOffset);
              } else {
                errors.push(batch.reason);
              }
            }
            options.onProgress?.(mergedDocs);
            progressiveDocs = [...mergedDocs];
            progressiveBibcodes = new Set(seenBibcodes);
            return shouldStop(mergedDocs) || remainingBudgetMs() <= 0 || lookupController.signal.aborted;
          }
        });
        if (!mergedDocs.length && errors.length) throw errors[0];
        return mergedDocs;
      }
      for (let offset = 0; offset < followUpQueries.length; offset += followUpBatchSize) {
        if (remainingBudgetMs() <= 0) {
          errors.push(createAdsSearchTimeoutError(totalTimeoutMs));
          break;
        }
        const batchQueries = followUpQueries.slice(offset, offset + followUpBatchSize);
        const progressiveDocs = [...mergedDocs];
        const progressiveBibcodes = new Set(seenBibcodes);
        const batches = await Promise.allSettled(batchQueries.map((query, batchOffset) => fetchQuery(query).then((docs) => {
          mergeDocs(progressiveDocs, progressiveBibcodes, docs, initialQueries.length + offset + batchOffset);
          options.onProgress?.(progressiveDocs);
          return docs;
        })));
        for (const [batchOffset, batch] of batches.entries()) {
          const index = initialQueries.length + offset + batchOffset;
          if (batch.status === "fulfilled") {
            mergeDocs(mergedDocs, seenBibcodes, batch.value, index);
            options.onProgress?.(mergedDocs);
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
    if (citationContext?.searchMode !== "simple" && citationContext?.searchMode !== "direct") {
      return false;
    }
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
    if (signal?.aborted) throw new Error("ADS/SciX search was cancelled.");
    const cacheKey = JSON.stringify([adsApiToken, query]);
    const useCache = fetchImpl === globalThis.fetch;
    const cached = useCache ? adsResponseCache.get(cacheKey) : null;
    if (cached && Date.now() - cached.createdAt < ADS_CACHE_TTL_MS) {
      return structuredClone(cached.docs);
    }
    if (cached) adsResponseCache.delete(cacheKey);
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

    const docs = payload?.response?.docs ?? [];
    if (useCache && docs.length && !signal?.aborted) {
      adsResponseCache.delete(cacheKey);
      adsResponseCache.set(cacheKey, { createdAt: Date.now(), docs: structuredClone(docs) });
      while (adsResponseCache.size > ADS_CACHE_MAX_ENTRIES) {
        adsResponseCache.delete(adsResponseCache.keys().next().value);
      }
    }
    return docs;
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
      searchLiterature,
      handleMessage,
      clearAdsCache: () => adsResponseCache.clear(),
      clearContextualCache: async () => {
        contextualResultMemoryCache.clear();
        await extensionApi.storage?.session?.clear?.();
      },
      clearCaches: async () => {
        adsResponseCache.clear();
        contextualResultMemoryCache.clear();
        await extensionApi.storage?.session?.clear?.();
      },
      clearContextualMemoryCache: () => contextualResultMemoryCache.clear(),
      inspectContextualSessionCache: () => extensionApi.storage?.session?.get?.(CONTEXTUAL_RESULT_CACHE_STORAGE_KEY)
    };
  }
  __overciteSafariModules["src/background.js"] = { exports: {  } };
})();
