import test from "node:test";
import assert from "node:assert/strict";

import { getSettings, getStorageArea, normalizeSettings, saveSettings } from "../src/core/settings.js";

test("normalizeSettings accepts valid theme modes and defaults invalid ones to auto", () => {
  assert.equal(normalizeSettings({ themeMode: "dark" }).themeMode, "dark");
  assert.equal(normalizeSettings({ themeMode: "light" }).themeMode, "light");
  assert.equal(normalizeSettings({ themeMode: "auto" }).themeMode, "auto");
  assert.equal(normalizeSettings({ themeMode: "midnight" }).themeMode, "auto");
});

test("normalizeSettings defaults to staying on the bibliography tab after insert", () => {
  assert.equal(normalizeSettings({}).returnToSourceAfterInsert, false);
  assert.equal(normalizeSettings({ returnToSourceAfterInsert: true }).returnToSourceAfterInsert, false);
});

test("normalizeSettings accepts valid citation key modes and defaults invalid ones to author-year", () => {
  assert.equal(normalizeSettings({ citationKeyMode: "authoryear" }).citationKeyMode, "authoryear");
  assert.equal(normalizeSettings({ citationKeyMode: "authoryear-underscore" }).citationKeyMode, "authoryear-underscore");
  assert.equal(normalizeSettings({ citationKeyMode: "authoryear-colon" }).citationKeyMode, "authoryear-colon");
  assert.equal(normalizeSettings({ citationKeyMode: "typed" }).citationKeyMode, "typed");
  assert.equal(normalizeSettings({ citationKeyMode: "informative" }).citationKeyMode, "informative");
  assert.equal(normalizeSettings({ citationKeyMode: "bibcode" }).citationKeyMode, "bibcode");
  assert.equal(normalizeSettings({ citationKeyMode: "other" }).citationKeyMode, "authoryear");
});

test("normalizeSettings accepts valid bibliography insert modes and defaults invalid ones to append", () => {
  assert.equal(normalizeSettings({ bibliographyInsertMode: "alphabetical" }).bibliographyInsertMode, "alphabetical");
  assert.equal(normalizeSettings({ bibliographyInsertMode: "append" }).bibliographyInsertMode, "append");
  assert.equal(normalizeSettings({ bibliographyInsertMode: "other" }).bibliographyInsertMode, "append");
});

test("normalizeSettings accepts valid default search modes and defaults invalid ones to contextual", () => {
  assert.equal(normalizeSettings({ defaultSearchMode: "simple" }).defaultSearchMode, "simple");
  assert.equal(normalizeSettings({ defaultSearchMode: "direct" }).defaultSearchMode, "direct");
  assert.equal(normalizeSettings({ defaultSearchMode: "contextual" }).defaultSearchMode, "contextual");
  assert.equal(normalizeSettings({ defaultSearchMode: "other" }).defaultSearchMode, "contextual");
});

test("normalizeSettings accepts source profiles and defaults invalid ones to Astrophysics", () => {
  assert.equal(normalizeSettings({ sourceProfile: "ads-only" }).sourceProfile, "astrophysics");
  assert.equal(normalizeSettings({ sourceProfile: "arxiv-only" }).sourceProfile, "math");
  assert.equal(normalizeSettings({ sourceProfile: "broad" }).sourceProfile, "general");
  assert.equal(normalizeSettings({ sourceProfile: "astrophysics" }).sourceProfile, "astrophysics");
  assert.equal(normalizeSettings({ sourceProfile: "physics" }).sourceProfile, "physics");
  assert.equal(normalizeSettings({ sourceProfile: "math" }).sourceProfile, "math");
  assert.equal(normalizeSettings({ sourceProfile: "astro-physics" }).sourceProfile, "astrophysics");
  assert.equal(normalizeSettings({ sourceProfile: "math-physics" }).sourceProfile, "math");
  assert.equal(normalizeSettings({ sourceProfile: "life-sciences" }).sourceProfile, "life-sciences");
  assert.equal(normalizeSettings({ sourceProfile: "computer-science" }).sourceProfile, "computer-science");
  assert.equal(normalizeSettings({ sourceProfile: "chemistry" }).sourceProfile, "chemistry");
  assert.equal(normalizeSettings({ sourceProfile: "general" }).sourceProfile, "general");
  assert.equal(normalizeSettings({ sourceProfile: "other" }).sourceProfile, "astrophysics");
});

test("normalizeSettings uses Astrophysics as the default fast source routing", () => {
  const settings = normalizeSettings({});

  assert.equal(settings.sourceProfile, "astrophysics");
  assert.equal(settings.primarySource, "ads");
  assert.deepEqual(settings.fallbackSources, []);
});

test("normalizeSettings supports custom primary and fallback sources", () => {
  const settings = normalizeSettings({
    sourceProfile: "custom",
    primarySource: "pubmed",
    fallbackSources: ["arxiv", "crossref", "pubmed", "unknown", "arxiv"]
  });

  assert.equal(settings.primarySource, "pubmed");
  assert.deepEqual(settings.fallbackSources, ["arxiv", "crossref"]);
});

test("normalizeSettings drops removed routing values", () => {
  const settings = normalizeSettings({
    sourceProfile: "custom",
    primarySource: "removed-provider",
    fallbackSources: ["arxiv", "crossref", "removed-provider", "unknown", "arxiv"]
  });

  assert.equal(settings.primarySource, "ads");
  assert.deepEqual(settings.fallbackSources, ["arxiv", "crossref"]);
});

test("normalizeSettings applies field presets when routing is not customized", () => {
  const astrophysics = normalizeSettings({ sourceProfile: "astrophysics" });
  assert.equal(astrophysics.primarySource, "ads");
  assert.deepEqual(astrophysics.fallbackSources, []);

  const physics = normalizeSettings({ sourceProfile: "physics" });
  assert.equal(physics.primarySource, "inspire");
  assert.deepEqual(physics.fallbackSources, ["crossref"]);

  const math = normalizeSettings({ sourceProfile: "math" });
  assert.equal(math.primarySource, "arxiv");
  assert.deepEqual(math.fallbackSources, ["crossref"]);

  const settings = normalizeSettings({ sourceProfile: "computer-science" });

  assert.equal(settings.primarySource, "arxiv");
  assert.deepEqual(settings.fallbackSources, ["crossref"]);

  const lifeSciences = normalizeSettings({ sourceProfile: "life-sciences" });
  assert.equal(lifeSciences.primarySource, "pubmed");
  assert.deepEqual(lifeSciences.fallbackSources, ["crossref"]);

  const chemistry = normalizeSettings({ sourceProfile: "chemistry" });
  assert.equal(chemistry.primarySource, "crossref");
  assert.deepEqual(chemistry.fallbackSources, []);

  const general = normalizeSettings({ sourceProfile: "general" });
  assert.equal(general.primarySource, "crossref");
  assert.deepEqual(general.fallbackSources, ["datacite"]);
});

test("normalizeSettings trims optional source API tokens and mirrors the legacy ADS token", () => {
  const settings = normalizeSettings({
    adsApiToken: " legacy-ads ",
    sourceApiTokens: {
      ncbi: " ncbi ",
      unknown: "ignored"
    }
  });

  assert.deepEqual(settings.sourceApiTokens, {
    ads: "legacy-ads",
    ncbi: "ncbi"
  });
});

test("normalizeSettings preserves the public ADS-only upgrade path", () => {
  const settings = normalizeSettings({
    adsApiToken: " public-user-token ",
    defaultSearchMode: "contextual",
    citationKeyMode: "informative",
    bibliographyInsertMode: "alphabetical",
    contextWindowChars: 650
  });

  assert.equal(settings.adsApiToken, "public-user-token");
  assert.deepEqual(settings.sourceApiTokens, { ads: "public-user-token" });
  assert.equal(settings.sourceProfile, "astrophysics");
  assert.equal(settings.primarySource, "ads");
  assert.deepEqual(settings.fallbackSources, []);
  assert.equal(settings.defaultSearchMode, "contextual");
  assert.equal(settings.citationKeyMode, "informative");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.contextWindowChars, 650);
});

test("getStorageArea falls back to local storage when sync storage is unavailable", () => {
  const local = {
    async get() {
      return {};
    },
    async set() {}
  };

  assert.equal(getStorageArea({ storage: { local } }), local);
});

test("saveSettings and getSettings use local storage as a Safari-compatible fallback", async () => {
  const store = new Map();
  const local = {
    async get(keys) {
      const result = {};
      for (const key of keys) {
        if (store.has(key)) {
          result[key] = store.get(key);
        }
      }
      return result;
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) {
        store.set(key, value);
      }
    }
  };
  const api = { storage: { local } };

  await saveSettings({ adsApiToken: " safari-token " }, api);
  const settings = await getSettings(api);

  assert.equal(settings.adsApiToken, "safari-token");
});

test("getSettings applies source presets for partially migrated stored settings", async () => {
  const local = {
    async get() {
      return { sourceProfile: "computer-science" };
    },
    async set() {}
  };
  const settings = await getSettings({ storage: { local } });

  assert.equal(settings.sourceProfile, "computer-science");
  assert.equal(settings.primarySource, "arxiv");
  assert.deepEqual(settings.fallbackSources, ["crossref"]);
});
