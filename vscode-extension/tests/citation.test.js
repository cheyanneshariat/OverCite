import test from "node:test";
import assert from "node:assert/strict";

import {
  extractContextualContext,
  findCitationAtCursor,
  isOpaqueCitationKey,
  normalizeContextualCitationContext,
  parseCitationKeyHint
} from "../src/core/citation.js";

test("findCitationAtCursor resolves the active token inside a multi-citation command", () => {
  const source = "Here is text \\citep{Goldberg24, Shariat25, Joyce20} and more.";
  const cursorIndex = source.indexOf("Shariat25") + 4;
  const result = findCitationAtCursor(source, cursorIndex, 500);
  assert.ok(result);
  assert.equal(result.command, "\\citep");
  assert.equal(result.token, "Shariat25");
  assert.deepEqual(result.tokens, ["Goldberg24", "Shariat25", "Joyce20"]);
});

test("findCitationAtCursor supports common BibLaTeX citation commands", () => {
  for (const command of ["parencite", "textcite", "autocite", "footcite", "smartcite"]) {
    const source = `Contextual claim \\${command}[see][p. 2]{Shariat2025}.`;
    const result = findCitationAtCursor(source, source.indexOf("Shariat2025") + 3, 500);
    assert.ok(result, command);
    assert.equal(result.command, `\\${command}[see][p. 2]`);
    assert.equal(result.token, "Shariat2025");
  }
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

test("Context Beta treats XML numeric reference IDs as opaque", () => {
  for (const token of ["b0005", "r41", "cpz1733-bib-0007", "bibr24-02601060251395426"]) {
    assert.equal(isOpaqueCitationKey(token), true, token);
    const context = normalizeContextualCitationContext({
      token,
      searchMode: "contextual",
      parsedKeyHint: parseCitationKeyHint(token)
    }, "beta");
    assert.equal(context.token, "");
    assert.equal(context.parsedKeyHint, null);
  }
  assert.equal(isOpaqueCitationKey("B2025"), false);
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

test("parseCitationKeyHint folds common Latin letters that NFKD leaves intact", () => {
  assert.deepEqual(parseCitationKeyHint("Łukaszewicz2020"), {
    ...parseCitationKeyHint("Lukaszewicz2020"),
    raw: "Łukaszewicz2020"
  });
  assert.equal(parseCitationKeyHint("Østergaard2021").surname, "Ostergaard");
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
  assert.equal(result.citationPrefixText, "People find that magnetic braking saturates");
  assert.equal(result.citationSuffixText, ".");
  assert.ok(!result.sentenceText.includes("Badry"));
  assert.ok(!result.contextText.includes("Badry"));
});

test("findCitationAtCursor keeps citation-proximal context intact across decimals and abbreviations", () => {
  const source = "Earlier work discusses unrelated stellar populations. The median mass is 1.27 solar masses, e.g. for compact binaries governed by magnetic braking \\citep{ElBadry2024}. The next sentence is unrelated.";
  const cursorIndex = source.indexOf("ElBadry2024") + 4;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.match(result.citationPrefixText, /1\.27 solar masses, e\.g\. for compact binaries governed by magnetic braking$/);
  assert.equal(result.citationSuffixText, ". The next sentence is unrelated.");
});

test("contextual extraction is sentence-bounded and independent of the context window setting", () => {
  const source = "The first mobile-device study established the baseline. A second study used 1.27 measurements, e.g. from compact binaries. The method transfers to mobile devices \\citep [see] [p.~2] { Wells2022 } and remains useful after the citation. The next sentence is unrelated.";
  const cursorIndex = source.indexOf("Wells2022") + 3;
  const result = findCitationAtCursor(source, cursorIndex, 200);
  const wideResult = findCitationAtCursor(source, cursorIndex, 1200);

  assert.ok(result);
  assert.equal(result.contextText, wideResult.contextText);
  assert.equal(result.sentenceText, "The method transfers to mobile devices and remains useful after the citation.");
  assert.match(result.contextText, /The first mobile-device study established the baseline\./);
  assert.match(result.contextText, /A second study used 1\.27 measurements, e\.g\. from compact binaries\./);
  assert.doesNotMatch(result.contextText, /The next sentence is unrelated/);
  assert.equal(extractContextualContext("A. Previous. Current sentence.", "A. Previous. Current sentence.".indexOf("Current") + 2), "A. Previous. Current sentence.");
});

test("contextual extraction excludes LaTeX title metadata, comments, and later sections", () => {
  const source = [
    "% A commented title must not become query evidence.",
    "\\documentclass{article}",
    "\\newcommand{\\mobileterm}[1]{",
    "  metadata macro body must not become query evidence.",
    "}",
    "\\title{Astronomy title about mobile devices}",
    "\\author{Astronomy Author}",
    "\\affiliation{Astronomy Institute}",
    "Prior body sentence about stars. The mobile devices method \\citep { Wells2022 } works in practice.",
    "\\begin{document}",
    "\\section{Unrelated section}",
    "Later section content should not leak into the cited context."
  ].join("\n");
  const result = findCitationAtCursor(source, source.indexOf("Wells2022") + 2, 500);

  assert.ok(result);
  assert.equal(result.sentenceText, "The mobile devices method works in practice.");
  assert.match(result.contextText, /Prior body sentence about stars\./);
  assert.doesNotMatch(result.contextText, /Astronomy title|Astronomy Author|Astronomy Institute|commented title|metadata macro body|Later section/);
  assert.doesNotMatch(result.citationPrefixText, /Astronomy title|Astronomy Author|Astronomy Institute|commented title/);
  assert.doesNotMatch(result.citationSuffixText, /Later section/);
});

test("findCitationAtCursor returns null outside a cite command", () => {
  const source = "No citations here.";
  assert.equal(findCitationAtCursor(source, 5, 500), null);
});
