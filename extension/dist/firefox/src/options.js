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
  physics: {
    primarySource: "inspire",
    fallbackSources: ["crossref"]
  },
  math: {
    primarySource: "arxiv",
    fallbackSources: ["crossref"]
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
    fallbackSources: ["crossref"]
  },
  "computer-science": {
    primarySource: "arxiv",
    fallbackSources: ["crossref"]
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

const SOURCE_SUMMARIES = Object.freeze({
  "ads-only": "Astrophysics. Uses ADS/SciX only. Needs an ADS/SciX token.",
  "arxiv-only": "Math. Uses arXiv only.",
  astrophysics: "Astrophysics. Uses ADS/SciX only. Needs an ADS/SciX token.",
  physics: "Physics. Uses INSPIRE, then Crossref if needed.",
  math: "Math. Uses arXiv, then Crossref if needed.",
  broad: "General. Uses Crossref / DOI first.",
  "astro-physics": "Astrophysics. Uses ADS/SciX only. Needs an ADS/SciX token.",
  "math-physics": "Math. Uses arXiv, then Crossref if needed.",
  "life-sciences": "Biology / Medicine. Uses PubMed, then Crossref if needed.",
  "computer-science": "Computer Science. Uses arXiv, then Crossref if needed.",
  chemistry: "Chemistry. Uses Crossref / DOI only.",
  general: "General. Uses Crossref, with DataCite for dataset DOIs.",
  custom: "Custom. Use the advanced source order below."
});

const SOURCE_OPTIONAL_ORIGINS = Object.freeze({
  arxiv: ["https://export.arxiv.org/*"],
  crossref: ["https://api.crossref.org/*"],
  datacite: ["https://api.datacite.org/*"],
  inspire: ["https://inspirehep.net/*"],
  pubmed: ["https://eutils.ncbi.nlm.nih.gov/*"]
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
  sourceProfileInput.value = settings.sourceProfile ?? "astrophysics";
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

    await ensureOptionalSourcePermissions(settings);

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

async function ensureOptionalSourcePermissions(settings) {
  const origins = optionalOriginsForSettings(settings);
  if (!origins.length || !extensionApi?.permissions?.request) {
    return;
  }
  const granted = await requestPermissions({ origins });
  if (!granted) {
    throw new Error("Browser permission was not granted for the selected databases.");
  }
}

function optionalOriginsForSettings(settings) {
  const sourceIds = [
    settings.primarySource,
    ...(Array.isArray(settings.fallbackSources) ? settings.fallbackSources : [])
  ];
  const origins = [];
  for (const sourceId of sourceIds) {
    origins.push(...(SOURCE_OPTIONAL_ORIGINS[sourceId] ?? []));
  }
  return [...new Set(origins)];
}

async function requestPermissions(details) {
  const permissionsApi = extensionApi?.permissions;
  try {
    const maybePromise = permissionsApi.request(details);
    if (maybePromise?.then) {
      return Boolean(await maybePromise);
    }
    return Boolean(maybePromise);
  } catch {
    return new Promise((resolve, reject) => {
      try {
        permissionsApi.request(details, (granted) => {
          const lastError = extensionApi?.runtime?.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(Boolean(granted));
        });
      } catch (error) {
        reject(error);
      }
    });
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
