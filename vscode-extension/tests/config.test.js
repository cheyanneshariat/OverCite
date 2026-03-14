import test from "node:test";
import assert from "node:assert/strict";

import { normalizeVsCodeSettings, workspaceKeyFromFolder } from "../src/config.js";

test("normalizeVsCodeSettings constrains and normalizes values", () => {
  const settings = normalizeVsCodeSettings({
    adsApiToken: "  token  ",
    contextWindowChars: 5000,
    citationKeyMode: "typed",
    bibliographyInsertMode: "alphabetical",
    defaultSearchMode: "simple",
    projectBibFileOverrides: { "/tmp/project": "refs.bib" }
  });

  assert.equal(settings.adsApiToken, "token");
  assert.equal(settings.contextWindowChars, 1200);
  assert.equal(settings.citationKeyMode, "typed");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.defaultSearchMode, "simple");
  assert.deepEqual(settings.projectBibFileOverrides, { "/tmp/project": "refs.bib" });
});

test("workspaceKeyFromFolder returns a stable string key", () => {
  assert.equal(workspaceKeyFromFolder("/tmp/project"), "/tmp/project");
});
