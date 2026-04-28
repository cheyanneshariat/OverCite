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

test("findCitationAtCursor preserves literal ADS query tokens with spaces and quotes", () => {
  const source = 'Here is text \\citep{author:"El-Badry" year:2022 title:"magnetic braking"} and more.';
  const cursorIndex = source.indexOf('El-Badry') + 2;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.token, 'author:"El-Badry" year:2022 title:"magnetic braking"');
  assert.deepEqual(result.tokens, ['author:"El-Badry" year:2022 title:"magnetic braking"']);
});

test("findCitationAtCursor does not split on commas inside quoted ADS query values", () => {
  const source = 'Here is text \\citep{first_author:"Smith, J" year:2020, Shariat25} and more.';
  const cursorIndex = source.indexOf('Smith, J') + 2;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.token, 'first_author:"Smith, J" year:2020');
  assert.deepEqual(result.tokens, ['first_author:"Smith, J" year:2020', "Shariat25"]);
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

test("parseCitationKeyHint understands underscore and colon author-year keys", () => {
  const underscore = parseCitationKeyHint("Shariat_2025");
  const colon = parseCitationKeyHint("Shariat:2025");

  assert.equal(underscore.surname, "Shariat");
  assert.equal(underscore.year, 2025);
  assert.equal(colon.surname, "Shariat");
  assert.equal(colon.year, 2025);
});

test("parseCitationKeyHint normalizes diacritics in author-year keys", () => {
  const accented = parseCitationKeyHint("Hünsch98");
  const plain = parseCitationKeyHint("Hunsch98");

  assert.equal(accented.surname, "Hunsch");
  assert.equal(accented.year, 1998);
  assert.equal(plain.surname, "Hunsch");
  assert.equal(plain.year, 1998);
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
