export const SUBJECT_AREA_ONBOARDING_STORAGE_KEY = "subjectAreaOnboardingVersion";
export const SUBJECT_AREA_ONBOARDING_VERSION = 1;

export const SUBJECT_AREA_CHOICES = Object.freeze([
  { label: "General / Multidisciplinary", description: "Crossref, with DataCite for datasets", profile: "general" },
  { label: "Physics", description: "ADS/SciX, Crossref, and arXiv", profile: "physics" },
  { label: "Computer Science", description: "Crossref, then arXiv", profile: "computer-science" },
  { label: "Mathematics", description: "Crossref, then arXiv", profile: "math" },
  { label: "Biology / Medicine", description: "Crossref, then PubMed", profile: "life-sciences" },
  { label: "Chemistry", description: "Crossref / DOI", profile: "chemistry" },
  { label: "Astronomy / Astrophysics", description: "ADS/SciX", profile: "astrophysics" }
]);

const VALID_PROFILES = new Set([
  ...SUBJECT_AREA_CHOICES.map(({ profile }) => profile),
  "custom",
  "ads-only",
  "arxiv-only",
  "broad",
  "astro-physics",
  "math-physics"
]);
const EXPLICIT_VALUE_KEYS = Object.freeze([
  "globalValue",
  "workspaceValue",
  "workspaceFolderValue",
  "globalLanguageValue",
  "workspaceLanguageValue",
  "workspaceFolderLanguageValue"
]);

export function createSubjectAreaOnboarding({ globalState, inspectSourceProfile, showQuickPick, updateSourceProfile }) {
  let pendingSelection = null;

  return async function ensureSubjectAreaSelected() {
    if (pendingSelection) {
      return pendingSelection;
    }
    pendingSelection = runSubjectAreaOnboarding({ globalState, inspectSourceProfile, showQuickPick, updateSourceProfile });
    try {
      return await pendingSelection;
    } finally {
      pendingSelection = null;
    }
  };
}

export function needsAdsTokenSetup(settings) {
  const hasToken = Boolean(String(settings?.sourceApiTokens?.ads || settings?.adsApiToken || "").trim());
  const fallbacks = Array.isArray(settings?.fallbackSources) ? settings.fallbackSources : [];
  return !hasToken && settings?.primarySource === "ads" && fallbacks.length === 0;
}

async function runSubjectAreaOnboarding({ globalState, inspectSourceProfile, showQuickPick, updateSourceProfile }) {
    if (Number(globalState.get(SUBJECT_AREA_ONBOARDING_STORAGE_KEY, 0)) >= SUBJECT_AREA_ONBOARDING_VERSION) {
      return true;
    }

    const inspection = inspectSourceProfile?.() ?? {};
    if (EXPLICIT_VALUE_KEYS.some((key) => VALID_PROFILES.has(normalizeProfile(inspection[key])))) {
      await globalState.update(SUBJECT_AREA_ONBOARDING_STORAGE_KEY, SUBJECT_AREA_ONBOARDING_VERSION);
      return true;
    }

    const picked = await showQuickPick(
      SUBJECT_AREA_CHOICES.map((choice) => ({
        label: choice.label,
        description: choice.description,
        profile: choice.profile
      })),
      {
        title: "Set up OverCite",
        placeHolder: "Choose your subject area before using OverCite",
        matchOnDescription: true
      }
    );
    if (!picked) {
      return false;
    }

    await updateSourceProfile(picked.profile);
    await globalState.update(SUBJECT_AREA_ONBOARDING_STORAGE_KEY, SUBJECT_AREA_ONBOARDING_VERSION);
    return true;
}

function normalizeProfile(value) {
  return String(value ?? "").trim().toLowerCase();
}
