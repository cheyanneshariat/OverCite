import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSettings } from "../src/core/settings.js";

test("normalizeSettings accepts valid theme modes and defaults invalid ones to auto", () => {
  assert.equal(normalizeSettings({ themeMode: "dark" }).themeMode, "dark");
  assert.equal(normalizeSettings({ themeMode: "light" }).themeMode, "light");
  assert.equal(normalizeSettings({ themeMode: "auto" }).themeMode, "auto");
  assert.equal(normalizeSettings({ themeMode: "midnight" }).themeMode, "auto");
});

test("normalizeSettings defaults to staying on the bibliography tab after insert", () => {
  assert.equal(normalizeSettings({}).returnToSourceAfterInsert, false);
  assert.equal(normalizeSettings({ returnToSourceAfterInsert: true }).returnToSourceAfterInsert, true);
});

test("normalizeSettings accepts valid citation key modes and defaults invalid ones to informative", () => {
  assert.equal(normalizeSettings({ citationKeyMode: "typed" }).citationKeyMode, "typed");
  assert.equal(normalizeSettings({ citationKeyMode: "informative" }).citationKeyMode, "informative");
  assert.equal(normalizeSettings({ citationKeyMode: "other" }).citationKeyMode, "informative");
});

test("normalizeSettings accepts valid bibliography insert modes and defaults invalid ones to append", () => {
  assert.equal(normalizeSettings({ bibliographyInsertMode: "alphabetical" }).bibliographyInsertMode, "alphabetical");
  assert.equal(normalizeSettings({ bibliographyInsertMode: "append" }).bibliographyInsertMode, "append");
  assert.equal(normalizeSettings({ bibliographyInsertMode: "other" }).bibliographyInsertMode, "append");
});

test("normalizeSettings accepts valid default search modes and defaults invalid ones to contextual", () => {
  assert.equal(normalizeSettings({ defaultSearchMode: "simple" }).defaultSearchMode, "simple");
  assert.equal(normalizeSettings({ defaultSearchMode: "contextual" }).defaultSearchMode, "contextual");
  assert.equal(normalizeSettings({ defaultSearchMode: "other" }).defaultSearchMode, "contextual");
});
