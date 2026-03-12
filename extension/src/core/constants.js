export const MESSAGE_TYPES = Object.freeze({
  GET_SETTINGS: "getSettings",
  SAVE_SETTINGS: "saveSettings",
  SEARCH_ADS: "searchAds",
  EXPORT_BIBTEX: "exportBibtex",
  RESOLVE_BIB_TARGET: "resolveBibTarget",
  APPLY_INSERTION: "applyInsertion",
  RECORD_SELECTION: "recordSelection"
});

export const DEFAULT_SETTINGS = Object.freeze({
  adsApiToken: "",
  defaultProjectBibFileOverride: {},
  contextWindowChars: 500,
  shortcutHelpText: "Alt+Shift+E",
  themeMode: "auto",
  returnToSourceAfterInsert: false,
  citationKeyMode: "informative",
  useSelectionMemory: true
});

export const TITLE_STOPWORDS = new Set([
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

export const CONTEXT_STOPWORDS = new Set([
  ...TITLE_STOPWORDS,
  "are",
  "be",
  "been",
  "can",
  "could",
  "did",
  "do",
  "does",
  "et",
  "find",
  "here",
  "however",
  "may",
  "near",
  "new",
  "our",
  "paper",
  "people",
  "result",
  "results",
  "show",
  "shows",
  "that",
  "their",
  "these",
  "this",
  "those",
  "via",
  "was",
  "were",
  "which"
]);
