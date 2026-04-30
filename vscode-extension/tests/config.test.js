import test from "node:test";
import assert from "node:assert/strict";

import { normalizeVsCodeSettings, workspaceKeyFromFolder } from "../src/config.js";

test("normalizeVsCodeSettings constrains and normalizes values", () => {
  const settings = normalizeVsCodeSettings({
    adsApiToken: "  token  ",
    contextWindowChars: 5000,
    citationKeyMode: "authoryear",
    bibliographyInsertMode: "alphabetical",
    defaultSearchMode: "simple",
    projectBibFileOverrides: { "/tmp/project": "refs.bib" }
  });

  assert.equal(settings.adsApiToken, "token");
  assert.equal(settings.sourceProfile, "astrophysics");
  assert.equal(settings.primarySource, "ads");
  assert.deepEqual(settings.fallbackSources, []);
  assert.deepEqual(settings.sourceApiTokens, { ads: "token" });
  assert.equal(settings.contextWindowChars, 1200);
  assert.equal(settings.citationKeyMode, "authoryear");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.defaultSearchMode, "simple");
  assert.deepEqual(settings.projectBibFileOverrides, { "/tmp/project": "refs.bib" });
});

test("normalizeVsCodeSettings supports subject-area source presets and custom routing", () => {
  const astrophysics = normalizeVsCodeSettings({ sourceProfile: "astrophysics" });
  assert.equal(astrophysics.primarySource, "ads");
  assert.deepEqual(astrophysics.fallbackSources, []);

  const physics = normalizeVsCodeSettings({ sourceProfile: "physics" });
  assert.equal(physics.primarySource, "inspire");
  assert.deepEqual(physics.fallbackSources, ["crossref"]);

  const math = normalizeVsCodeSettings({ sourceProfile: "math" });
  assert.equal(math.primarySource, "arxiv");
  assert.deepEqual(math.fallbackSources, ["crossref"]);

  const chemistry = normalizeVsCodeSettings({
    sourceProfile: "chemistry",
    sourceApiTokens: { ads: " ads-token " }
  });
  assert.equal(chemistry.primarySource, "crossref");
  assert.deepEqual(chemistry.fallbackSources, []);
  assert.deepEqual(chemistry.sourceApiTokens, { ads: "ads-token" });

  const cs = normalizeVsCodeSettings({
    sourceProfile: "computer-science",
    sourceApiTokens: { ncbi: " ncbi " }
  });
  assert.equal(cs.primarySource, "arxiv");
  assert.deepEqual(cs.fallbackSources, ["crossref"]);
  assert.deepEqual(cs.sourceApiTokens, { ncbi: "ncbi" });

  const lifeSciences = normalizeVsCodeSettings({ sourceProfile: "life-sciences" });
  assert.equal(lifeSciences.primarySource, "pubmed");
  assert.deepEqual(lifeSciences.fallbackSources, ["crossref"]);

  const general = normalizeVsCodeSettings({ sourceProfile: "general" });
  assert.equal(general.primarySource, "crossref");
  assert.deepEqual(general.fallbackSources, ["datacite"]);

  const custom = normalizeVsCodeSettings({
    sourceProfile: "custom",
    primarySource: "pubmed",
    fallbackSources: ["crossref", "pubmed", "datacite", "bad"]
  });
  assert.equal(custom.primarySource, "pubmed");
  assert.deepEqual(custom.fallbackSources, ["crossref", "datacite"]);
});

test("normalizeVsCodeSettings maps legacy source presets to subject areas", () => {
  assert.equal(normalizeVsCodeSettings({ sourceProfile: "ads-only" }).sourceProfile, "astrophysics");
  assert.equal(normalizeVsCodeSettings({ sourceProfile: "astro-physics" }).sourceProfile, "astrophysics");
  assert.equal(normalizeVsCodeSettings({ sourceProfile: "arxiv-only" }).sourceProfile, "math");
  assert.equal(normalizeVsCodeSettings({ sourceProfile: "math-physics" }).sourceProfile, "math");
  assert.equal(normalizeVsCodeSettings({ sourceProfile: "broad" }).sourceProfile, "general");
});

test("normalizeVsCodeSettings preserves the public ADS-only upgrade path", () => {
  const settings = normalizeVsCodeSettings({
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

test("normalizeVsCodeSettings accepts direct as a valid default search mode", () => {
  assert.equal(normalizeVsCodeSettings({ defaultSearchMode: "direct" }).defaultSearchMode, "direct");
  assert.equal(normalizeVsCodeSettings({ defaultSearchMode: "other" }).defaultSearchMode, "contextual");
});

test("normalizeVsCodeSettings accepts typed and informative key modes and defaults invalid values to author-year", () => {
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "typed" }).citationKeyMode, "typed");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "informative" }).citationKeyMode, "informative");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "authoryear-underscore" }).citationKeyMode, "authoryear-underscore");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "authoryear-colon" }).citationKeyMode, "authoryear-colon");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "bibcode" }).citationKeyMode, "bibcode");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "other" }).citationKeyMode, "authoryear");
});

test("workspaceKeyFromFolder returns a stable string key", () => {
  assert.equal(workspaceKeyFromFolder("/tmp/project"), "/tmp/project");
});
