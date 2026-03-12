import { MESSAGE_TYPES } from "./core/constants.js";
import { normalizeSettings } from "./core/settings.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const form = document.querySelector("#settings-form");
const status = document.querySelector("#status");

const tokenInput = document.querySelector("#ads-api-token");
const themeInput = document.querySelector("#theme-mode");
const citationKeyModeInput = document.querySelector("#citation-key-mode");
const bibliographyInsertModeInput = document.querySelector("#bibliography-insert-mode");
const contextInput = document.querySelector("#context-window-chars");
const shortcutInput = document.querySelector("#shortcut-help-text");
const returnToSourceInput = document.querySelector("#return-to-source");
const overridesInput = document.querySelector("#project-overrides");

async function callRuntime(message) {
  const response = await extensionApi.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown OverCite error");
  }
  return response.result;
}

async function loadSettings() {
  const settings = await callRuntime({ type: MESSAGE_TYPES.GET_SETTINGS });
  tokenInput.value = settings.adsApiToken ?? "";
  themeInput.value = settings.themeMode ?? "auto";
  citationKeyModeInput.value = settings.citationKeyMode ?? "informative";
  bibliographyInsertModeInput.value = settings.bibliographyInsertMode ?? "append";
  contextInput.value = String(settings.contextWindowChars ?? 500);
  shortcutInput.value = settings.shortcutHelpText ?? "";
  returnToSourceInput.checked = Boolean(settings.returnToSourceAfterInsert);
  overridesInput.value = JSON.stringify(settings.defaultProjectBibFileOverride ?? {}, null, 2);
  applyTheme(settings.themeMode ?? "auto");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "";
  try {
    let overrides = {};
    const overridesText = overridesInput.value.trim();
    if (overridesText) {
      overrides = JSON.parse(overridesText);
    }

    const settings = normalizeSettings({
      adsApiToken: tokenInput.value,
      themeMode: themeInput.value,
      citationKeyMode: citationKeyModeInput.value,
      bibliographyInsertMode: bibliographyInsertModeInput.value,
      contextWindowChars: contextInput.value,
      shortcutHelpText: shortcutInput.value,
      returnToSourceAfterInsert: returnToSourceInput.checked,
      defaultProjectBibFileOverride: overrides
    });

    await callRuntime({
      type: MESSAGE_TYPES.SAVE_SETTINGS,
      settings
    });
    applyTheme(settings.themeMode);
    status.textContent = "Settings saved.";
  } catch (error) {
    status.textContent = `Could not save settings: ${error.message}`;
  }
});

themeInput.addEventListener("change", () => {
  applyTheme(themeInput.value);
});

function applyTheme(themeMode) {
  const resolvedTheme = themeMode === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : themeMode;
  document.documentElement.dataset.theme = resolvedTheme;
}

loadSettings().catch((error) => {
  status.textContent = `Could not load settings: ${error.message}`;
});
