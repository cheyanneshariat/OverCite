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
    APPLY_INSERTION: "applyInsertion"
  });

  const DEFAULT_SETTINGS = Object.freeze({
    adsApiToken: "",
    sourceProfile: "ads-only",
    primarySource: "ads",
    fallbackSources: [],
    sourceApiTokens: {},
    defaultProjectBibFileOverride: {},
    contextWindowChars: 500,
    shortcutHelpText: "Alt+Shift+E",
    themeMode: "auto",
    returnToSourceAfterInsert: false,
    citationKeyMode: "authoryear",
    bibliographyInsertMode: "append",
    defaultSearchMode: "contextual"
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
    "also"
  ]);
  __overciteSafariModules["src/core/constants.js"] = { exports: { MESSAGE_TYPES, DEFAULT_SETTINGS, TITLE_STOPWORDS, CONTEXT_STOPWORDS } };
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
  __overciteSafariModules["src/core/settings.js"] = { exports: { getSettings, saveSettings, getStorageArea, normalizeSettings } };
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

  function parseBibEntries(bibText) {
    const entries = [];
    let index = 0;
    while (index < bibText.length) {
      const entryStart = bibText.indexOf("@", index);
      if (entryStart < 0) {
        break;
      }
      const openBrace = bibText.indexOf("{", entryStart);
      if (openBrace < 0) {
        break;
      }
      const header = bibText.slice(entryStart + 1, openBrace).trim();
      const type = header.split(/\s+/)[0];
      const commaIndex = bibText.indexOf(",", openBrace);
      if (commaIndex < 0) {
        break;
      }
      const key = bibText.slice(openBrace + 1, commaIndex).trim();
      let depth = 1;
      let cursor = openBrace + 1;
      while (cursor < bibText.length && depth > 0) {
        const char = bibText[cursor];
        if (char === "{") {
          depth += 1;
        } else if (char === "}") {
          depth -= 1;
        }
        cursor += 1;
      }
      const raw = bibText.slice(entryStart, cursor).trim();
      entries.push({
        type,
        key,
        raw,
        start: entryStart,
        end: cursor,
        doi: normalizeLooseText(parseFieldValue(raw, "doi")),
        title: normalizeLooseText(parseFieldValue(raw, "title")),
        adsurl: parseFieldValue(raw, "adsurl"),
        bibcode: normalizeLooseText(extractBibcodeFromAdsUrl(parseFieldValue(raw, "adsurl"))),
        year: parseFieldValue(raw, "year")
      });
      index = cursor;
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
    const trimmedEntry = entryText.trim();
    if (!trimmedText) {
      return `${trimmedEntry}\n`;
    }
    return `${trimmedText}\n\n${trimmedEntry}\n`;
  }

  function compareKeys(left, right) {
    return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
  }

  function insertBibtexEntryAlphabetically(bibText, entryText, finalKey) {
    const entries = parseBibEntries(bibText);
    if (!entries.length) {
      return appendBibtexEntry(bibText, entryText);
    }

    const insertBefore = entries.find((entry) => compareKeys(finalKey, entry.key) < 0);
    if (!insertBefore) {
      return appendBibtexEntry(bibText, entryText);
    }

    const trimmedEntry = entryText.trim();
    const before = bibText.slice(0, insertBefore.start).trimEnd();
    const after = bibText.slice(insertBefore.start).trimStart();

    if (!before) {
      return `${trimmedEntry}\n\n${after}\n`;
    }
    return `${before}\n\n${trimmedEntry}\n\n${after}\n`;
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
    const rewrittenBibtex = rewriteBibtexKey(bibtex, finalKey);
    const insertMode = String(candidate?.bibliographyInsertMode ?? "append").toLowerCase();
    const updatedBibText = insertMode === "alphabetical"
      ? insertBibtexEntryAlphabetically(bibText, rewrittenBibtex, finalKey)
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
      .replace(/\\[A-Za-z]+/g, " ")
      .replace(/[^A-Za-z0-9\s]/g, " ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function keywordSet(value) {
    return new Set(
      normalizeText(value)
        .split(" ")
        .filter((token) => token.length >= 3 && !CONTEXT_STOPWORDS.has(token))
    );
  }

  function keywordList(value) {
    return [...keywordSet(value)];
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

  function isAuthorLikeToken(token) {
    const normalized = String(token ?? "").trim().replace(/[{}\s]/g, "");
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
    const sentenceConcepts = keywordConcepts(citationContext?.sentenceText ?? "").slice(0, 5);
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
    const sentenceConcepts = keywordConcepts(citationContext?.sentenceText ?? "").slice(0, 5);
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
    const tokens = keywordList(citationContext?.sentenceText ?? "");
    if (tokens.length < 2) {
      return null;
    }
    return tokens.slice(0, 6).join(" ");
  }

  function buildLeadingKeywordPhrase(citationContext) {
    const tokens = keywordList(citationContext?.sentenceText ?? "");
    if (tokens.length < 2) {
      return null;
    }
    return tokens.slice(0, Math.min(3, tokens.length)).join(" ");
  }

  function buildTrailingKeywordPhrase(citationContext) {
    const tokens = keywordList(citationContext?.sentenceText ?? "");
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
      return raw ? [raw] : [];
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
    return author === surname || author.startsWith(`${surname} `) || author.endsWith(` ${surname}`);
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
    const queries = new Set();
    const hint = citationContext?.parsedKeyHint;
    const primarySurname = hint?.surname
      ? (buildSurnameVariants(hint.surname)[0] ?? hint.surname)
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
    const hint = citationContext?.parsedKeyHint;
    const token = String(citationContext?.token ?? "").trim();
    const normalizedToken = normalizeText(token);
    const tokenLooksLikeTitle = !hint?.year && normalizedToken.split(" ").filter(Boolean).length >= 3;
    const isEmptyTokenLookup = !token;
    const contextKeywordConcepts = keywordConcepts(citationContext?.contextText ?? "");
    const sentenceKeywordConcepts = keywordConcepts(citationContext?.sentenceText ?? "");
    const sentencePhrase = normalizeText(buildSentencePhrase(citationContext) ?? "");
    const leadingPhrase = normalizeText(buildLeadingKeywordPhrase(citationContext) ?? "");
    const trailingPhrase = normalizeText(buildTrailingKeywordPhrase(citationContext) ?? "");

    return candidates
      .map((candidate) => {
        let score = 0;
        const titleText = normalizeText(candidate.title);
        const abstractText = normalizeText(candidate.abstract);
        const firstAuthor = normalizeText(candidate.authors[0] ?? "");
        const allAuthors = normalizeText(candidate.authors.join(" "));
        const collaborationFirstAuthor = /collaboration/.test(firstAuthor);

        if (tokenLooksLikeTitle) {
          score += computeTitleTokenScore(normalizedToken, titleText);
        }

        if (hint?.surname) {
          const surnameVariants = buildHintSurnameMatchVariants(hint.surname);
          const baseSurname = normalizeText(parseCollaborationHint(hint.surname)?.base ?? hint.surname);
          const matchesFirstAuthor = authorNameMatchesSurnameVariants(firstAuthor, surnameVariants);
          const matchesAnyAuthor = candidate.authors.some((author) => authorNameMatchesSurnameVariants(author, surnameVariants));
          if (matchesFirstAuthor) {
            score += 80;
          } else if (matchesAnyAuthor) {
            score += 40;
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
          const surnameVariants = buildHintSurnameMatchVariants(citationContext.parsedKeyHint.surname);
          if (!authorNameMatchesSurnameVariants(firstAuthor, surnameVariants)) {
            score -= 25;
          }
        }

        if (/collaboration/.test(firstAuthor) || /collaboration/.test(allAuthors)) {
          score -= 30;
        }

        if (hint?.year && candidate.year === hint.year) {
          score += 60;
        } else if (hint?.year && candidate.year && String(candidate.year).endsWith(String(hint.year).slice(-2))) {
          score += 20;
        }

        if (hint?.suffix) {
          const suffix = normalizeText(hint.suffix);
          if (suffix && titleText.includes(suffix)) {
            score += 18;
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

        return { ...candidate, score };
      })
      .sort((left, right) =>
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
  __overciteSafariModules["src/core/ads.js"] = { exports: { buildAdsQuery, buildAdsQueries, mapAdsDocToCandidate, rerankAdsCandidates } };
})();

/* src/core/sources.js */
(() => {
  const SOURCE_IDS = Object.freeze({
    CROSSREF: "crossref",
    DATACITE: "datacite",
    PUBMED: "pubmed",
    ARXIV: "arxiv",
    INSPIRE: "inspire",
    ADS: "ads",
    SEMANTIC_SCHOLAR: "semanticScholar"
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
    },
    [SOURCE_IDS.SEMANTIC_SCHOLAR]: {
      label: "Semantic Scholar",
      credentialKey: "semanticScholar"
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
  const arxivTextCache = new Map();
  let lastArxivRequestAt = 0;

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
      primarySource: SOURCE_IDS.PUBMED,
      fallbackSources: [SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE]
    },
    "computer-science": {
      primarySource: SOURCE_IDS.ARXIV,
      fallbackSources: [SOURCE_IDS.CROSSREF]
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
      primary: [SOURCE_IDS.PUBMED, SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE],
      optional: []
    },
    "computer-science": {
      primary: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF],
      optional: []
    },
    custom: {
      primary: [SOURCE_IDS.CROSSREF],
      optional: []
    }
  });

  function buildSourcePlan(settings = {}) {
    const profile = SOURCE_PROFILES[settings.sourceProfile] ?? SOURCE_PROFILES.broad;
    const sourceApiTokens = settings.sourceApiTokens ?? {};
    const availableOptional = profile.optional.filter((sourceId) => hasCredential(sourceId, sourceApiTokens));
    const missingOptionalCredentials = profile.optional.filter((sourceId) => requiresCredential(sourceId) && !hasCredential(sourceId, sourceApiTokens));

    return {
      profile: SOURCE_PROFILES[settings.sourceProfile] ? settings.sourceProfile : "broad",
      primarySources: [...profile.primary],
      optionalEnhancers: availableOptional,
      missingOptionalCredentials,
      orderedSources: [...availableOptional, ...profile.primary]
    };
  }

  function buildSourceRouting(settings = {}) {
    const sourceApiTokens = settings.sourceApiTokens ?? {};
    const profile = SOURCE_ROUTING_PRESETS[settings.sourceProfile] ? settings.sourceProfile : "ads-only";
    const preset = SOURCE_ROUTING_PRESETS[profile];
    const primarySource = normalizeRoutableSource(settings.primarySource) ?? preset.primarySource;
    const rawFallbackSources = Array.isArray(settings.fallbackSources) ? settings.fallbackSources : preset.fallbackSources;
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
      parts.push(...keywordList(citationContext?.sentenceText ?? "").slice(0, 7));
      if (parts.length < 6) {
        parts.push(...keywordList(citationContext?.contextText ?? "").slice(0, 6 - parts.length));
      }
    }

    if (!parts.length) {
      parts.push(...keywordList(citationContext?.contextText ?? "").slice(0, 8));
    }
    return uniqueStrings(parts).join(" ").trim();
  }

  function buildContextOnlySearchQuery(citationContext = {}) {
    const parts = [
      ...keywordList(citationContext?.sentenceText ?? "").slice(0, 8),
      ...keywordList(citationContext?.contextText ?? "").slice(0, 8)
    ];
    return uniqueStrings(parts).slice(0, 9).join(" ").trim();
  }

  function buildArxivSearchQuery(citationContext = {}) {
    const hint = citationContext?.parsedKeyHint;
    const token = String(citationContext?.token ?? "").trim();
    if (citationContext?.searchMode === "direct" && token) {
      return `all:${quoteArxivTerm(token)}`;
    }
    if (citationContext?.searchMode === "simple" && isTitleLikeToken(token, hint)) {
      return `ti:${quoteArxivTerm(token)}`;
    }

    const clauses = [];
    if (hint?.surname && !isGenericAuthorFamily(hint.surname)) {
      clauses.push(`au:${quoteArxivTerm(hint.surname)}`);
    }

    const titleClause = buildArxivContextTitleClause(citationContext);
    if (titleClause) {
      clauses.push(titleClause);
      return clauses.join(" AND ");
    }

    if (hint?.year) {
      clauses.push(`submittedDate:[${hint.year}01010000 TO ${hint.year}12312359]`);
    }

    const contextTokens = keywordList(`${citationContext?.sentenceText ?? ""} ${citationContext?.contextText ?? ""}`)
      .filter((term) => !hint?.surname || term !== String(hint.surname).toLowerCase())
      .slice(0, 5);
    if (contextTokens.length) {
      clauses.push(`(${contextTokens.map((term) => `all:${quoteArxivTerm(term)}`).join(" OR ")})`);
    } else if (token && !hint?.surname) {
      clauses.push(`all:${quoteArxivTerm(token)}`);
    }

    return clauses.join(" AND ");
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
      return family === expected || family.endsWith(` ${expected}`);
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
    if (citationContext?.searchMode === "simple" || citationContext?.searchMode === "direct") {
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
      return searchCrossref(query, citationContext, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.DATACITE) {
      return searchDataCite(query, citationContext, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.PUBMED) {
      return searchPubMed(query, citationContext, settings, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.ARXIV) {
      return searchArxiv(citationContext, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.INSPIRE) {
      return searchInspire(query, citationContext, fetchImpl);
    }
    if (sourceId === SOURCE_IDS.SEMANTIC_SCHOLAR) {
      return searchSemanticScholar(query, settings, fetchImpl);
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

  async function searchCrossref(query, citationContext, fetchImpl) {
    const directDoi = directDoiFromContext(citationContext);
    if (directDoi) {
      const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(directDoi)}`);
      const payload = await fetchJson(url, fetchImpl, "Crossref DOI lookup", {}, { retries: 1, fallbackDelayMs: 750 });
      return [mapCrossrefWork(payload?.message)].filter(isUsableCandidate);
    }
    const urls = buildCrossrefUrls(query, citationContext);
    const payloads = await fetchJsonBatches(urls, fetchImpl, "Crossref search", {}, { retries: 1, fallbackDelayMs: 750 });
    return payloads.flatMap((payload) => payload?.message?.items ?? []).map(mapCrossrefWork).filter(isUsableCandidate);
  }

  async function searchDataCite(query, citationContext, fetchImpl) {
    const directDoi = directDoiFromContext(citationContext);
    if (directDoi) {
      const url = new URL(`https://api.datacite.org/dois/${encodeURIComponent(directDoi)}`);
      const payload = await fetchJson(url, fetchImpl, "DataCite DOI lookup");
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
    const searchTerms = uniqueStrings([
      buildPubMedSearchTerm(query, citationContext),
      buildPubMedFallbackSearchTerm(query, citationContext)
    ]).filter(Boolean);
    let ids = [];
    for (const term of searchTerms) {
      const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
      searchUrl.searchParams.set("db", "pubmed");
      searchUrl.searchParams.set("retmode", "json");
      searchUrl.searchParams.set("retmax", "12");
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

  async function searchArxiv(citationContext, fetchImpl) {
    const searchQuery = buildArxivSearchQuery(citationContext);
    const directArxivId = directArxivIdFromContext(citationContext);
    if (!searchQuery && !directArxivId) {
      return [];
    }
    const authorYearQuery = buildArxivAuthorYearFallbackQuery(citationContext);
    const preprintYearQuery = buildArxivPreprintYearFallbackQuery(citationContext);
    try {
      const firstBatch = await fetchArxivQuery({ searchQuery, directArxivId, fetchImpl });
      let candidates = firstBatch;
      if (!candidates.length && !directArxivId && authorYearQuery && authorYearQuery !== searchQuery) {
        candidates = await fetchArxivQuery({ searchQuery: authorYearQuery, fetchImpl });
      }
      if (preprintYearQuery && preprintYearQuery !== searchQuery && preprintYearQuery !== authorYearQuery && shouldTryArxivPreprintYearFallback(candidates, citationContext)) {
        const fallbackBatch = await fetchArxivQuery({ searchQuery: preprintYearQuery, fetchImpl });
        return mergeDuplicateCandidates([...candidates, ...fallbackBatch]);
      }
      if (candidates.length || directArxivId) {
        return candidates;
      }
      return [];
    } catch (error) {
      if (!isArxivRecoverableError(error) || directArxivId) {
        throw error;
      }
      return searchArxivMetadataFallback(citationContext, fetchImpl);
    }
  }

  async function searchInspire(query, citationContext, fetchImpl) {
    const directRecordUrl = buildInspireDirectRecordUrl(citationContext);
    if (directRecordUrl) {
      const record = await fetchJson(directRecordUrl, fetchImpl, "INSPIRE direct lookup");
      return [mapInspireRecord(record)].filter(isUsableCandidate);
    }

    const urls = buildInspireUrls(query, citationContext);
    const payloads = await fetchJsonBatches(urls, fetchImpl, "INSPIRE search");
    return payloads
      .flatMap((payload) => payload?.hits?.hits ?? [])
      .map(mapInspireRecord)
      .filter(isUsableCandidate);
  }

  async function fetchArxivQuery({ searchQuery = "", directArxivId = "", fetchImpl }) {
    const url = new URL("https://export.arxiv.org/api/query");
    if (directArxivId) {
      url.searchParams.set("id_list", directArxivId);
    } else {
      url.searchParams.set("search_query", searchQuery);
    }
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", "12");
    const text = await fetchArxivText(url, fetchImpl);
    return parseArxivEntries(text).map(mapArxivWork).filter(isUsableCandidate);
  }

  async function fetchArxivText(url, fetchImpl) {
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

  async function searchArxivViaSemanticScholar(citationContext, fetchImpl) {
    const queries = buildArxivMetadataFallbackQueries(citationContext);
    for (const query of queries) {
      const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
      url.searchParams.set("query", query);
      url.searchParams.set("limit", "5");
      url.searchParams.set("fields", "paperId,title,authors,year,abstract,externalIds,citationCount,venue,url,publicationTypes");
      try {
        const payload = await fetchJson(url, fetchImpl, "Semantic Scholar arXiv fallback");
        const candidates = (payload?.data ?? [])
          .map(mapSemanticScholarArxivPaper)
          .filter((candidate) => isUsableCandidate(candidate) && candidate.eprint)
          .filter((candidate) => candidateMatchesHint(candidate, citationContext?.parsedKeyHint));
        if (candidates.length) {
          return candidates;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  function buildArxivMetadataFallbackQueries(citationContext = {}) {
    const hint = citationContext?.parsedKeyHint;
    const broadQuery = buildBroadSearchQuery(citationContext);
    const authorYearQuery = [hint?.surname, hint?.year].filter(Boolean).join(" ");
    return uniqueStrings([
      broadQuery,
      authorYearQuery,
      `${authorYearQuery} ${keywordList(citationContext?.sentenceText ?? "").slice(0, 5).join(" ")}`.trim(),
      `${authorYearQuery} ${keywordList(citationContext?.contextText ?? "").slice(0, 5).join(" ")}`.trim()
    ]).filter(Boolean);
  }

  function candidateMatchesHint(candidate, hint = {}) {
    if (hint?.year && Number(candidate?.year) !== Number(hint.year)) {
      return false;
    }
    if (hint?.surname) {
      const surname = String(hint.surname).toLowerCase();
      return (candidate?.authors ?? []).some((author) => String(author).toLowerCase().includes(surname));
    }
    return true;
  }

  function shouldUseArxivRuntimeGuards(fetchImpl) {
    return fetchImpl === globalThis.fetch;
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

  async function searchSemanticScholar(query, settings, fetchImpl) {
    const apiKey = String(settings?.sourceApiTokens?.semanticScholar ?? "").trim();
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "12");
    url.searchParams.set("fields", "paperId,title,authors,year,abstract,externalIds,citationCount,venue,url,publicationTypes");
    const headers = apiKey ? { "x-api-key": apiKey } : {};
    const payload = await fetchJson(url, fetchImpl, "Semantic Scholar search", headers);
    return (payload?.data ?? []).map(mapSemanticScholarPaper).filter(isUsableCandidate);
  }

  async function fetchJson(url, fetchImpl, label, headers = {}, retryOptions = {}) {
    return fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers, retryOptions);
  }

  async function fetchJsonWithRateLimitRetry(url, fetchImpl, label, headers = {}, retryOptions = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("No fetch implementation is available.");
    }
    const response = await fetchWithTimeout(fetchImpl, url.toString(), {
      headers: {
        Accept: "application/json",
        ...headers
      }
    });
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

  async function fetchJsonBatches(urls, fetchImpl, label, headers = {}, retryOptions = {}) {
    const batches = await Promise.allSettled(urls.map((url) => fetchJson(url, fetchImpl, label, headers, retryOptions)));
    const payloads = [];
    const errors = [];
    for (const batch of batches) {
      if (batch.status === "fulfilled") {
        payloads.push(batch.value);
      } else {
        errors.push(batch.reason);
      }
    }
    if (!payloads.length && errors.length) {
      throw errors[0];
    }
    return payloads;
  }

  function buildCrossrefUrls(query, citationContext) {
    const hint = citationContext?.parsedKeyHint;
    const urls = [];
    const contextQuery = buildContextOnlySearchQuery(citationContext);
    const titleQuery = buildCrossrefTitleQuery(query, citationContext);
    if (hint?.surname && hint?.year) {
      if (titleQuery) {
        urls.push(crossrefUrl({
          title: titleQuery,
          author: hint.surname,
          year: hint.year
        }));
      } else {
        urls.push(crossrefUrl({
          bibliographic: [hint.surname, hint.year, contextQuery].filter(Boolean).join(" "),
          author: hint.surname,
          year: hint.year
        }));
      }
    } else if (titleQuery) {
      urls.push(crossrefUrl({
        title: titleQuery,
        year: hint?.year
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
    const directDoi = directDoiFromContext(citationContext);
    if (directDoi) {
      return "";
    }
    const token = String(citationContext?.token ?? "").trim();
    if (citationContext?.searchMode === "direct" && token) {
      return token;
    }
    const text = buildContextOnlySearchQuery(citationContext) || query;
    return keywordList(text).slice(0, 8).join(" ");
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
    if (titleQuery) {
      urls.push(inspireUrl(`title "${titleQuery}"`));
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

  function crossrefUrl({ bibliographic = "", title = "", author = "", year = null } = {}) {
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("rows", "12");
    url.searchParams.set("select", "DOI,title,author,published-print,published-online,published,issued,container-title,abstract,is-referenced-by-count,type,URL,publisher");
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
      url.searchParams.set("filter", `from-pub-date:${year}-01-01,until-pub-date:${year}-12-31`);
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
      title: first(work?.title),
      authors: (work?.author ?? []).map(formatCrossrefAuthor).filter(Boolean),
      year: extractCrossrefYear(work),
      abstract: stripMarkup(work?.abstract),
      doi: normalizeDoi(work?.DOI),
      citationCount: work?.["is-referenced-by-count"],
      journal: first(work?.["container-title"]),
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

  function mapSemanticScholarPaper(paper) {
    const externalIds = paper?.externalIds ?? {};
    const arxivId = stripArxivVersion(externalIds.ArXiv ?? "");
    const doi = normalizeDoi(externalIds.DOI) || (arxivId ? `10.48550/arxiv.${arxivId.toLowerCase()}` : "");
    return normalizeCandidate({
      id: paper?.paperId ? `SemanticScholar:${paper.paperId}` : paper?.url,
      sourceId: SOURCE_IDS.SEMANTIC_SCHOLAR,
      sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.SEMANTIC_SCHOLAR].label,
      title: paper?.title,
      authors: (paper?.authors ?? []).map((author) => author?.name).filter(Boolean),
      year: paper?.year,
      abstract: paper?.abstract,
      doi,
      citationCount: paper?.citationCount,
      journal: paper?.venue,
      type: Array.isArray(paper?.publicationTypes) ? paper.publicationTypes[0] : "",
      url: paper?.url,
      bibtexExportId: paper?.paperId,
      eprint: arxivId,
      archivePrefix: arxivId ? "arXiv" : "",
      raw: paper
    });
  }

  function mapSemanticScholarArxivPaper(paper) {
    const externalIds = paper?.externalIds ?? {};
    const arxivId = stripArxivVersion(externalIds.ArXiv ?? "");
    return normalizeCandidate({
      id: arxivId ? `https://arxiv.org/abs/${arxivId}` : paper?.url,
      sourceId: SOURCE_IDS.ARXIV,
      sourceLabel: SOURCE_DEFINITIONS[SOURCE_IDS.ARXIV].label,
      title: paper?.title,
      authors: (paper?.authors ?? []).map((author) => author?.name).filter(Boolean),
      year: paper?.year,
      abstract: paper?.abstract,
      doi: normalizeDoi(externalIds.DOI) || (arxivId ? `10.48550/arxiv.${arxivId.toLowerCase()}` : ""),
      citationCount: paper?.citationCount,
      journal: paper?.venue || "arXiv",
      type: "preprint",
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : paper?.url,
      bibtexExportId: arxivId,
      eprint: arxivId,
      archivePrefix: arxivId ? "arXiv" : "",
      raw: paper
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
    const inferredArxivYear = inferYearFromArxivIdentifier(doi || candidate.eprint);
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
    return Boolean(candidate?.title && candidate?.authors?.length && candidate?.year);
  }

  function mergeDuplicateCandidates(candidates) {
    const merged = [];
    const seen = new Map();
    for (const candidate of candidates) {
      const key = duplicateKey(candidate);
      if (!key || !seen.has(key)) {
        seen.set(key, merged.length);
        merged.push(candidate);
        continue;
      }
      const existing = merged[seen.get(key)];
      merged[seen.get(key)] = preferCandidate(existing, candidate);
    }
    return merged;
  }

  function duplicateKey(candidate) {
    const title = normalizeText(candidate?.title);
    const firstAuthor = firstAuthorFamilyKey(candidate?.authors?.[0]);
    if (title && firstAuthor) {
      return `work:${title}:${firstAuthor}`;
    }
    if (candidate?.doi) {
      return `doi:${candidate.doi.toLowerCase()}`;
    }
    return candidate?.id ? `${candidate.sourceId}:${candidate.id}` : "";
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
      [SOURCE_IDS.SEMANTIC_SCHOLAR]: 60,
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
      booktitle: primary.booktitle || secondary.booktitle,
      publisher: primary.publisher || secondary.publisher,
      url: preferredUrl(primary, secondary),
      eprint: primary.eprint || secondary.eprint,
      archivePrefix: primary.archivePrefix || secondary.archivePrefix,
      primaryClass: primary.primaryClass || secondary.primaryClass,
      sourceLabel: mergeSourceLabels(primary, secondary)
    };
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

  function directArxivIdFromContext(citationContext = {}) {
    if (citationContext?.searchMode !== "direct") {
      return "";
    }
    const token = String(citationContext?.token ?? "").trim();
    return arxivIdFromText(token);
  }

  function arxivIdFromText(value) {
    const match = String(value ?? "").trim().match(/(?:arxiv:|arxiv\.org\/abs\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i);
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
  __overciteSafariModules["src/core/sources.js"] = { exports: { searchBroadCandidates, searchBroadCandidatesForSources, buildSourcePlan, buildSourceRouting, isAdsOnlyProfile, isFieldedAdsDirectQuery, buildBroadSearchQuery, exportCandidateBibtex, SOURCE_IDS, SOURCE_DEFINITIONS } };
})();

/* src/background.js */
(() => {
  const { mapAdsDocToCandidate, buildAdsQueries, rerankAdsCandidates } = __overciteSafariModules["src/core/ads.js"].exports;
  const { applyBibInsertion, generatePreferredKey } = __overciteSafariModules["src/core/bibtex.js"].exports;
  const { DEFAULT_SETTINGS, MESSAGE_TYPES } = __overciteSafariModules["src/core/constants.js"].exports;
  const { resolveBibTargetFromProjectState } = __overciteSafariModules["src/core/project.js"].exports;
  const { getSettings, saveSettings } = __overciteSafariModules["src/core/settings.js"].exports;
  const { buildSourceRouting, exportCandidateBibtex, searchBroadCandidatesForSources, SOURCE_IDS } = __overciteSafariModules["src/core/sources.js"].exports;
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
  __overciteSafariModules["src/background.js"] = { exports: {  } };
})();
