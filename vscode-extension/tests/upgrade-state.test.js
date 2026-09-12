import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVsCodeSettings } from "../src/config.js";
import {
  ACKNOWLEDGMENT_REMINDER_INTERVAL_MS,
  ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_VERSION,
  createCompletionNotifier
} from "../src/acknowledgment.js";

const UPGRADE_TEST_ADS_TOKEN = "upgrade-test-ads-token";
const UPGRADE_TEST_NCBI_TOKEN = "upgrade-test-ncbi-token";

test("VS Code upgrade keeps prior release token, routing and editor preferences", () => {
  const settings = normalizeVsCodeSettings({
    adsApiToken: UPGRADE_TEST_ADS_TOKEN,
    sourceProfile: "physics",
    primarySource: "ads",
    fallbackSources: ["crossref", "arxiv"],
    sourceApiTokens: { ads: UPGRADE_TEST_ADS_TOKEN, ncbi: UPGRADE_TEST_NCBI_TOKEN },
    contextWindowChars: 650,
    citationKeyMode: "informative",
    bibliographyInsertMode: "append",
    defaultSearchMode: "simple",
    contextualSearchEngine: "classic",
    projectBibFileOverrides: { "file:///upgrade-project": "refs.bib" }
  });

  assert.equal(settings.adsApiToken, UPGRADE_TEST_ADS_TOKEN);
  assert.deepEqual(settings.sourceApiTokens, {
    ads: UPGRADE_TEST_ADS_TOKEN,
    ncbi: UPGRADE_TEST_NCBI_TOKEN
  });
  assert.equal(settings.sourceProfile, "physics");
  assert.equal(settings.primarySource, "ads");
  assert.deepEqual(settings.fallbackSources, ["crossref", "arxiv"]);
  assert.equal(settings.contextWindowChars, 650);
  assert.equal(settings.citationKeyMode, "informative");
  assert.equal(settings.bibliographyInsertMode, "append");
  assert.equal(settings.defaultSearchMode, "simple");
  assert.equal(settings.contextualSearchEngine, "classic");
  assert.deepEqual(settings.projectBibFileOverrides, { "file:///upgrade-project": "refs.bib" });
});

test("VS Code upgrade mirrors the legacy ADS token when older config had no token map", () => {
  const settings = normalizeVsCodeSettings({
    adsApiToken: UPGRADE_TEST_ADS_TOKEN,
    sourceProfile: "astrophysics",
    bibliographyInsertMode: "append"
  });
  assert.deepEqual(settings.sourceApiTokens, { ads: UPGRADE_TEST_ADS_TOKEN });
  assert.equal(settings.bibliographyInsertMode, "append");
});

test("VS Code upgrade migrates legacy reminder state to a 90-day schedule", async () => {
  const currentTime = 1_800_000_000_000;
  const values = { [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: 1 };
  const events = [];
  const notifier = createCompletionNotifier({
    globalState: createGlobalState(values, events),
    async showInformationMessage() {
      events.push("show");
      return undefined;
    },
    async writeClipboard() {},
    now: () => currentTime
  });

  assert.equal(await notifier("Citation inserted."), true);
  assert.equal(values[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY], ACKNOWLEDGMENT_REMINDER_VERSION);
  assert.equal(
    values[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY],
    currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
  );
  assert.deepEqual(events.slice(0, 3), ["update", "update", "show"]);
});

test("VS Code defaults keep Beta opt-in without changing prior append compatibility", () => {
  const defaults = normalizeVsCodeSettings({});
  assert.equal(defaults.bibliographyInsertMode, "alphabetical");
  assert.equal(defaults.contextualSearchEngine, "classic");
  assert.equal(normalizeVsCodeSettings({ contextualSearchEngine: "beta" }).contextualSearchEngine, "beta");
  assert.equal(normalizeVsCodeSettings({ bibliographyInsertMode: "append" }).bibliographyInsertMode, "append");
});

function createGlobalState(values, events) {
  return {
    get(key, fallback) {
      return Object.hasOwn(values, key) ? values[key] : fallback;
    },
    async update(key, value) {
      events.push("update");
      values[key] = value;
    }
  };
}
