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

  return {
    adsApiToken: String(rawSettings.adsApiToken ?? DEFAULT_SETTINGS.adsApiToken).trim(),
    contextWindowChars: Number.isFinite(contextWindowChars)
      ? Math.min(1200, Math.max(200, contextWindowChars))
      : DEFAULT_SETTINGS.contextWindowChars,
    citationKeyMode: citationKeyMode === "typed" || citationKeyMode === "informative" || citationKeyMode === "authoryear"
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
