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

test("findCitationAtCursor supports textual citation commands", () => {
  const source = "\\citet{Doudna2012} introduced a programmable CRISPR endonuclease.";
  const cursorIndex = source.indexOf("Doudna") + 3;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.command, "\\citet");
  assert.equal(result.token, "Doudna2012");
  assert.deepEqual(result.tokens, ["Doudna2012"]);
});

test("findCitationAtCursor supports plain cite commands with optional notes", () => {
  const source = "Transformers were introduced in \\cite[see][section 3]{Vaswani2017}.";
  const cursorIndex = source.indexOf("Vaswani") + 4;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.command, "\\cite[see][section 3]");
  assert.equal(result.token, "Vaswani2017");
  assert.deepEqual(result.tokens, ["Vaswani2017"]);
});

test("findCitationAtCursor supports starred and author/year citation variants", () => {
  const starred = "The result appears in \\citep*{Watson1953}.";
  const authorOnly = "\\citeauthor{Doudna2012} introduced a programmable CRISPR endonuclease.";
  const yearOnly = "The method was published in \\citeyearpar{Kingma2015}.";

  const starredResult = findCitationAtCursor(starred, starred.indexOf("Watson") + 3, 500);
  const authorResult = findCitationAtCursor(authorOnly, authorOnly.indexOf("Doudna") + 3, 500);
  const yearResult = findCitationAtCursor(yearOnly, yearOnly.indexOf("Kingma") + 3, 500);

  assert.ok(starredResult);
  assert.equal(starredResult.command, "\\citep*");
  assert.equal(starredResult.token, "Watson1953");

  assert.ok(authorResult);
  assert.equal(authorResult.command, "\\citeauthor");
  assert.equal(authorResult.token, "Doudna2012");

  assert.ok(yearResult);
  assert.equal(yearResult.command, "\\citeyearpar");
  assert.equal(yearResult.token, "Kingma2015");
});

test("findCitationAtCursor keeps the active repeated multi-citation token isolated", () => {
  const source = "First \\citep{Planck2020,Shariat2025}. Later \\citep{Shariat2025,Planck2020}.";
  const cursorIndex = source.lastIndexOf("Planck2020") + 3;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.token, "Planck2020");
  assert.deepEqual(result.tokens, ["Shariat2025", "Planck2020"]);
  assert.ok(!result.sentenceText.includes("Shariat2025,Planck2020"));
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

test("findCitationAtCursor supports empty citation tokens for context-only lookup", () => {
  const source = "Primordial black holes have been killed by wide binaries \\citep{}.";
  const cursorIndex = source.indexOf("{}") + 1;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.token, "");
  assert.equal(result.parsedKeyHint, null);
  assert.equal(result.sentenceText, "Primordial black holes have been killed by wide binaries .");
});
