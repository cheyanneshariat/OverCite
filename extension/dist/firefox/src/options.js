import { MESSAGE_TYPES } from "./core/constants.js";
import { normalizeSettings } from "./core/settings.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const form = document.querySelector("#settings-form");
const status = document.querySelector("#status");

const tokenInput = document.querySelector("#ads-api-token");
const sourceProfileInput = document.querySelector("#source-profile");
const sourceProfileSummary = document.querySelector("#source-profile-summary");
const primarySourceInput = document.querySelector("#primary-source");
const fallbackSourceInputs = [...document.querySelectorAll("input[name='fallbackSources']")];
const ncbiTokenInput = document.querySelector("#ncbi-api-token");
const themeInput = document.querySelector("#theme-mode");
const citationKeyModeInput = document.querySelector("#citation-key-mode");
const citationKeyExample = document.querySelector("#citation-key-example");
const bibliographyInsertModeInput = document.querySelector("#bibliography-insert-mode");
const defaultSearchModeInput = document.querySelector("#default-search-mode");
const contextInput = document.querySelector("#context-window-chars");
const overridesInput = document.querySelector("#project-overrides");

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

const SOURCE_SUMMARIES = Object.freeze({
  "ads-only": "ADS/SciX only. Fastest for astronomy and physics. Needs an ADS/SciX token.",
  "arxiv-only": "arXiv only. Good for arXiv-heavy fields and preprints.",
  astrophysics: "Astrophysics. Uses ADS/SciX only.",
  broad: "Broad search. Starts with Crossref, then uses arXiv, PubMed, and DataCite when available.",
  "astro-physics": "Astro / Physics. Uses ADS/SciX first, with arXiv, INSPIRE, and Crossref as backup.",
  "math-physics": "Math / Physics. Uses arXiv first, then INSPIRE, Crossref, and ADS/SciX.",
  "life-sciences": "Life Sciences. Uses PubMed first, then Crossref and DataCite.",
  "computer-science": "Computer Science. Uses arXiv first, then Crossref.",
  custom: "Custom. Use the advanced source order below."
});

const CITATION_KEY_EXAMPLES = Object.freeze({
  authoryear: "Example: Shariat2025",
  "authoryear-underscore": "Example: Shariat_2025",
  "authoryear-colon": "Example: Shariat:2025",
  informative: "Example: Shariat25_10k",
  bibcode: "Example: 2025PASP..137i4201S",
  typed: "Example: keeps Shariat25"
});

async function callRuntime(message) {
  if (!extensionApi?.runtime?.sendMessage) {
    throw new Error("Extension runtime is unavailable");
  }
  const response = await extensionApi.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error ?? "Unknown OverCite error");
  }
  return response.result;
}

async function loadSettings() {
  const settings = await callRuntime({ type: MESSAGE_TYPES.GET_SETTINGS });
  applySettings(settings);
}

function applySettings(settings) {
  tokenInput.value = settings.adsApiToken ?? "";
  sourceProfileInput.value = settings.sourceProfile ?? "ads-only";
  primarySourceInput.value = settings.primarySource ?? "ads";
  setFallbackSources(settings.fallbackSources ?? []);
  ncbiTokenInput.value = settings.sourceApiTokens?.ncbi ?? "";
  themeInput.value = settings.themeMode ?? "auto";
  citationKeyModeInput.value = settings.citationKeyMode ?? "authoryear";
  bibliographyInsertModeInput.value = settings.bibliographyInsertMode ?? "append";
  defaultSearchModeInput.value = settings.defaultSearchMode ?? "contextual";
  contextInput.value = String(settings.contextWindowChars ?? 500);
  overridesInput.value = stringifyOverridesForField(settings.defaultProjectBibFileOverride);
  applyTheme(settings.themeMode ?? "auto");
  updateSourceProfileSummary();
  updateCitationKeyExample();
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
      sourceProfile: sourceProfileInput.value,
      primarySource: primarySourceInput.value,
      fallbackSources: fallbackSourceInputs.filter((input) => input.checked).map((input) => input.value),
      sourceApiTokens: {
        ads: tokenInput.value,
        ncbi: ncbiTokenInput.value
      },
      themeMode: themeInput.value,
      citationKeyMode: citationKeyModeInput.value,
      bibliographyInsertMode: bibliographyInsertModeInput.value,
      defaultSearchMode: defaultSearchModeInput.value,
      contextWindowChars: contextInput.value,
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

citationKeyModeInput.addEventListener("change", () => {
  updateCitationKeyExample();
});

sourceProfileInput.addEventListener("change", () => {
  const preset = SOURCE_PRESETS[sourceProfileInput.value];
  if (!preset) {
    return;
  }
  primarySourceInput.value = preset.primarySource;
  setFallbackSources(preset.fallbackSources);
  updateSourceProfileSummary();
});

primarySourceInput.addEventListener("change", () => {
  sourceProfileInput.value = "custom";
  clearPrimaryFromFallbacks();
  updateSourceProfileSummary();
});

for (const input of fallbackSourceInputs) {
  input.addEventListener("change", () => {
    sourceProfileInput.value = "custom";
    clearPrimaryFromFallbacks();
    updateSourceProfileSummary();
  });
}

function applyTheme(themeMode) {
  const resolvedTheme = themeMode === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : themeMode;
  document.documentElement.dataset.theme = resolvedTheme;
}

function setFallbackSources(sourceIds) {
  const selected = new Set(sourceIds);
  for (const input of fallbackSourceInputs) {
    input.checked = selected.has(input.value) && input.value !== primarySourceInput.value;
  }
}

function clearPrimaryFromFallbacks() {
  for (const input of fallbackSourceInputs) {
    if (input.value === primarySourceInput.value) {
      input.checked = false;
    }
  }
}

function updateSourceProfileSummary() {
  if (sourceProfileSummary) {
    sourceProfileSummary.textContent = SOURCE_SUMMARIES[sourceProfileInput.value] ?? SOURCE_SUMMARIES.custom;
  }
}

function updateCitationKeyExample() {
  if (citationKeyExample) {
    citationKeyExample.textContent = CITATION_KEY_EXAMPLES[citationKeyModeInput.value] ?? CITATION_KEY_EXAMPLES.authoryear;
  }
}

function stringifyOverridesForField(overrides) {
  const entries = overrides && typeof overrides === "object" && !Array.isArray(overrides)
    ? Object.entries(overrides).filter(([key, value]) => key && value)
    : [];
  return entries.length ? JSON.stringify(Object.fromEntries(entries), null, 2) : "";
}

loadSettings().catch((error) => {
  applySettings(normalizeSettings({}));
  if (extensionApi?.runtime?.sendMessage) {
    status.textContent = `Could not load settings: ${error.message}`;
  }
});
