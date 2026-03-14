import test from "node:test";
import assert from "node:assert/strict";

import { findCitationAtCursor, parseCitationKeyHint } from "../src/core/citation.js";

test("findCitationAtCursor resolves the active token inside a multi-citation command", () => {
  const source = "Here is text \\citep{Goldberg24, Shariat25, Joyce20} and more.";
  const cursorIndex = source.indexOf("Shariat25") + 4;
  const result = findCitationAtCursor(source, cursorIndex, 500);
  assert.ok(result);
  assert.equal(result.command, "\\citep");
  assert.equal(result.token, "Shariat25");
  assert.deepEqual(result.tokens, ["Goldberg24", "Shariat25", "Joyce20"]);
});

test("parseCitationKeyHint understands 2-digit and 4-digit year keys", () => {
  const shortYear = parseCitationKeyHint("Shariat25");
  const longYear = parseCitationKeyHint("MacLeod2025");
  assert.equal(shortYear.surname, "Shariat");
  assert.equal(shortYear.firstInitial, null);
  assert.equal(shortYear.year, 2025);
  assert.equal(longYear.surname, "MacLeod");
  assert.equal(longYear.firstInitial, null);
  assert.equal(longYear.year, 2025);
});

test("parseCitationKeyHint can extract an optional first initial before or after the surname", () => {
  const beforeSurname = parseCitationKeyHint("JSmith05");
  const afterSurname = parseCitationKeyHint("SmithJ05");
  const shortSurname = parseCitationKeyHint("LiW25");

  assert.equal(beforeSurname.surname, "Smith");
  assert.equal(beforeSurname.firstInitial, "J");
  assert.equal(beforeSurname.year, 2005);

  assert.equal(afterSurname.surname, "Smith");
  assert.equal(afterSurname.firstInitial, "J");
  assert.equal(afterSurname.year, 2005);

  assert.equal(shortSurname.surname, "Li");
  assert.equal(shortSurname.firstInitial, "W");
  assert.equal(shortSurname.year, 2025);
});

test("parseCitationKeyHint treats surname-only tokens as author hints", () => {
  const surnameOnly = parseCitationKeyHint("El-Badry");
  assert.equal(surnameOnly.surname, "El-Badry");
  assert.equal(surnameOnly.year, null);
});

test("parseCitationKeyHint treats short common surnames as author hints", () => {
  const surnameOnly = parseCitationKeyHint("Li");
  assert.equal(surnameOnly.surname, "Li");
  assert.equal(surnameOnly.firstInitial, null);
  assert.equal(surnameOnly.year, null);
});

test("parseCitationKeyHint supports multi-word surnames with and without a year", () => {
  const surnameOnly = parseCitationKeyHint("Perez Paolino");
  const withYear = parseCitationKeyHint("Perez Paolino25");

  assert.equal(surnameOnly.surname, "Perez Paolino");
  assert.equal(surnameOnly.firstInitial, null);
  assert.equal(surnameOnly.year, null);

  assert.equal(withYear.surname, "Perez Paolino");
  assert.equal(withYear.firstInitial, null);
  assert.equal(withYear.year, 2025);
});

test("findCitationAtCursor removes the active cite token from sentence and context text", () => {
  const source = "People find that magnetic braking saturates \\citep{El-Badry}.";
  const cursorIndex = source.indexOf("El-Badry") + 4;
  const result = findCitationAtCursor(source, cursorIndex, 500);
  assert.ok(result);
  assert.equal(result.sentenceText, "People find that magnetic braking saturates .");
  assert.ok(!result.sentenceText.includes("Badry"));
  assert.ok(!result.contextText.includes("Badry"));
});

test("findCitationAtCursor returns null outside a cite command", () => {
  const source = "No citations here.";
  assert.equal(findCitationAtCursor(source, 5, 500), null);
});

test("findCitationAtCursor supports empty citation tokens for context-only lookup", () => {
  const source = "Primordial black holes have been killed by wide binaries \\citep{}.";
  const cursorIndex = source.indexOf("{}") + 1;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.token, "");
  assert.equal(result.parsedKeyHint, null);
  assert.equal(result.sentenceText, "Primordial black holes have been killed by wide binaries .");
});
