import assert from "node:assert/strict";
import test from "node:test";

import {
  getSettings,
  normalizeSettings,
  saveSettings
} from "../src/core/settings.js";
import {
  ACKNOWLEDGMENT_REMINDER_INTERVAL_MS,
  ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_VERSION,
  createAcknowledgmentReminderClaim
} from "../src/core/acknowledgment.js";

const UPGRADE_TEST_ADS_TOKEN = "upgrade-test-ads-token";
const UPGRADE_TEST_NCBI_TOKEN = "upgrade-test-ncbi-token";

test("browser upgrade keeps prior release tokens and preferences during load/save", async () => {
  const oldReleaseState = {
    adsApiToken: UPGRADE_TEST_ADS_TOKEN,
    sourceProfile: "physics",
    primarySource: "ads",
    fallbackSources: ["crossref", "arxiv"],
    sourceApiTokens: { ads: UPGRADE_TEST_ADS_TOKEN, ncbi: UPGRADE_TEST_NCBI_TOKEN },
    defaultProjectBibFileOverride: { "upgrade-project": "refs.bib" },
    contextWindowChars: 650,
    shortcutHelpText: "Alt+Shift+E",
    themeMode: "dark",
    returnToSourceAfterInsert: false,
    citationKeyMode: "informative",
    bibliographyInsertMode: "append",
    defaultSearchMode: "contextual",
    // Version 1 is the state written by the prior release's one-time reminder.
    acknowledgmentReminderVersion: 1
  };
  const storage = createStorage(oldReleaseState);

  const loaded = await getSettings({ storage: { sync: storage } });
  assert.equal(loaded.adsApiToken, UPGRADE_TEST_ADS_TOKEN);
  assert.deepEqual(loaded.sourceApiTokens, {
    ads: UPGRADE_TEST_ADS_TOKEN,
    ncbi: UPGRADE_TEST_NCBI_TOKEN
  });
  assert.equal(loaded.sourceProfile, "physics");
  assert.equal(loaded.primarySource, "ads");
  assert.deepEqual(loaded.fallbackSources, ["crossref", "arxiv"]);
  assert.deepEqual(loaded.defaultProjectBibFileOverride, { "upgrade-project": "refs.bib" });
  assert.equal(loaded.contextWindowChars, 650);
  assert.equal(loaded.themeMode, "dark");
  assert.equal(loaded.returnToSourceAfterInsert, false);
  assert.equal(loaded.citationKeyMode, "informative");
  assert.equal(loaded.bibliographyInsertMode, "append");
  assert.equal(loaded.defaultSearchMode, "contextual");
  assert.equal(loaded.contextualSearchEngine, "classic", "existing users are not opted into experimental Beta");

  const saved = await saveSettings(loaded, { storage: { sync: storage } });
  assert.deepEqual(saved, loaded);
  for (const key of [
    "adsApiToken",
    "sourceProfile",
    "primarySource",
    "fallbackSources",
    "sourceApiTokens",
    "defaultProjectBibFileOverride",
    "contextWindowChars",
    "themeMode",
    "returnToSourceAfterInsert",
    "citationKeyMode",
    "bibliographyInsertMode",
    "defaultSearchMode"
  ]) {
    assert.deepEqual(storage.state[key], oldReleaseState[key], `upgrade changed ${key}`);
  }
  assert.equal(storage.state.contextualSearchEngine, "classic");
  assert.equal(storage.state.acknowledgmentReminderVersion, 1, "pre-existing reminder state is not clobbered by settings save");
});

test("browser upgrade preserves an old ADS token when the legacy token map was absent", async () => {
  const storage = createStorage({
    adsApiToken: UPGRADE_TEST_ADS_TOKEN,
    sourceProfile: "astrophysics",
    bibliographyInsertMode: "append"
  });
  const loaded = await getSettings({ storage: { sync: storage } });
  assert.equal(loaded.adsApiToken, UPGRADE_TEST_ADS_TOKEN);
  assert.deepEqual(loaded.sourceApiTokens, { ads: UPGRADE_TEST_ADS_TOKEN });
  await saveSettings(loaded, { storage: { sync: storage } });
  assert.equal(storage.state.adsApiToken, UPGRADE_TEST_ADS_TOKEN);
  assert.deepEqual(storage.state.sourceApiTokens, { ads: UPGRADE_TEST_ADS_TOKEN });
  assert.equal(storage.state.bibliographyInsertMode, "append");
});

test("browser upgrade converts the prior one-time reminder state into a 90-day schedule", async () => {
  const currentTime = 1_800_000_000_000;
  const storage = createStorage({
    adsApiToken: UPGRADE_TEST_ADS_TOKEN,
    acknowledgmentReminderVersion: 1
  });
  const claim = createAcknowledgmentReminderClaim(storage, { now: () => currentTime });

  assert.equal(await claim(), true);
  assert.equal(storage.state[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY], ACKNOWLEDGMENT_REMINDER_VERSION);
  assert.equal(
    storage.state[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY],
    currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
  );
  assert.equal(await createAcknowledgmentReminderClaim(storage, { now: () => currentTime + 1 })(), false);
});

test("browser defaults remain explicit and do not silently inherit removed values", () => {
  const settings = normalizeSettings({});
  assert.equal(settings.defaultSearchMode, "simple");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.returnToSourceAfterInsert, true);
  assert.equal(settings.contextualSearchEngine, "classic");
});

function createStorage(initialState) {
  const state = { ...initialState };
  return {
    state,
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.filter((key) => key in state).map((key) => [key, state[key]]));
    },
    async set(values) {
      Object.assign(state, values);
    }
  };
}
