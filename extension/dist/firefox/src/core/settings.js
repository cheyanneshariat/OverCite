import { DEFAULT_SETTINGS } from "./constants.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;

function getStorageArea() {
  if (extensionApi?.storage?.sync) {
    return extensionApi.storage.sync;
  }
  return null;
}

export async function getSettings() {
  const storage = getStorageArea();
  if (!storage) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  const stored = await storage.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

export async function saveSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);
  const storage = getStorageArea();
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
  return {
    adsApiToken: String(rawSettings.adsApiToken ?? DEFAULT_SETTINGS.adsApiToken).trim(),
    defaultProjectBibFileOverride: overrides,
    contextWindowChars: Number.isFinite(contextWindowChars) ? Math.min(1200, Math.max(200, contextWindowChars)) : DEFAULT_SETTINGS.contextWindowChars,
    shortcutHelpText: String(rawSettings.shortcutHelpText ?? DEFAULT_SETTINGS.shortcutHelpText).trim() || DEFAULT_SETTINGS.shortcutHelpText,
    themeMode,
    returnToSourceAfterInsert: Boolean(rawSettings.returnToSourceAfterInsert ?? DEFAULT_SETTINGS.returnToSourceAfterInsert),
    citationKeyMode,
    bibliographyInsertMode
  };
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
  if (normalized === "informative" || normalized === "typed") {
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
