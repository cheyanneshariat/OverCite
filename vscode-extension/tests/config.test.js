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
  assert.equal(settings.contextWindowChars, 1200);
  assert.equal(settings.citationKeyMode, "authoryear");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.defaultSearchMode, "simple");
  assert.deepEqual(settings.projectBibFileOverrides, { "/tmp/project": "refs.bib" });
});

test("normalizeVsCodeSettings accepts typed and informative key modes and defaults invalid values to author-year", () => {
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "typed" }).citationKeyMode, "typed");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "informative" }).citationKeyMode, "informative");
  assert.equal(normalizeVsCodeSettings({ citationKeyMode: "other" }).citationKeyMode, "authoryear");
});

test("workspaceKeyFromFolder returns a stable string key", () => {
  assert.equal(workspaceKeyFromFolder("/tmp/project"), "/tmp/project");
});
