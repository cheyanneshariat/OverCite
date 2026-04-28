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
  assert.equal(settings.sourceProfile, "ads-only");
  assert.equal(settings.primarySource, "ads");
  assert.deepEqual(settings.fallbackSources, []);
  assert.deepEqual(settings.sourceApiTokens, { ads: "token" });
  assert.equal(settings.contextWindowChars, 1200);
  assert.equal(settings.citationKeyMode, "authoryear");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.defaultSearchMode, "simple");
  assert.deepEqual(settings.projectBibFileOverrides, { "/tmp/project": "refs.bib" });
});

test("normalizeVsCodeSettings supports broad source presets and custom routing", () => {
  const astrophysics = normalizeVsCodeSettings({ sourceProfile: "astrophysics" });
  assert.equal(astrophysics.primarySource, "ads");
  assert.deepEqual(astrophysics.fallbackSources, []);

  const astroPhysics = normalizeVsCodeSettings({ sourceProfile: "astro-physics" });
  assert.equal(astroPhysics.primarySource, "ads");
  assert.deepEqual(astroPhysics.fallbackSources, ["arxiv", "inspire", "crossref"]);

  const mathPhysics = normalizeVsCodeSettings({ sourceProfile: "math-physics" });
  assert.equal(mathPhysics.primarySource, "arxiv");
  assert.deepEqual(mathPhysics.fallbackSources, ["inspire", "crossref", "ads"]);

  const broad = normalizeVsCodeSettings({
    sourceProfile: "broad",
    sourceApiTokens: { ads: " ads-token " }
  });
  assert.equal(broad.primarySource, "crossref");
  assert.deepEqual(broad.fallbackSources, ["arxiv", "pubmed", "datacite"]);
  assert.deepEqual(broad.sourceApiTokens, { ads: "ads-token" });

  const cs = normalizeVsCodeSettings({
    sourceProfile: "computer-science",
    sourceApiTokens: { ncbi: " ncbi " }
  });
  assert.equal(cs.primarySource, "arxiv");
  assert.deepEqual(cs.fallbackSources, ["crossref"]);
  assert.deepEqual(cs.sourceApiTokens, { ncbi: "ncbi" });

  const custom = normalizeVsCodeSettings({
    sourceProfile: "custom",
    primarySource: "pubmed",
    fallbackSources: ["crossref", "pubmed", "datacite", "bad"]
  });
  assert.equal(custom.primarySource, "pubmed");
  assert.deepEqual(custom.fallbackSources, ["crossref", "datacite"]);
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
