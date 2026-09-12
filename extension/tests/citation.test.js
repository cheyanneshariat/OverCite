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

test("findCitationAtCursor supports textual citation commands", () => {
  const source = "\\citet{Doudna2012} introduced a programmable CRISPR endonuclease.";
  const cursorIndex = source.indexOf("Doudna") + 3;
  const result = findCitationAtCursor(source, cursorIndex, 500);

  assert.ok(result);
  assert.equal(result.command, "\\citet");
  assert.equal(result.token, "Doudna2012");
  assert.deepEqual(result.tokens, ["Doudna2012"]);
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

test("isOpaqueCitationKey recognizes XML/reference-manager numeric keys only", () => {
  for (const token of [
    "RN75",
    "RN3825",
    "bib26",
    "r41",
    "b0005",
    "cpz1733-bib-0007",
    "bibr24-02601060251395426"
  ]) {
    assert.equal(isOpaqueCitationKey(token), true, token);
  }

  for (const token of [
    "Shariat25",
    "R2025",
    "B2025",
    "SCONE",
    "A title-like citation key",
    "DBLP:journals/corr/GidarisK15",
    "doi:10.1234/example",
    "arXiv:2401.01234v2",
    "2024ApJ...123..456S"
  ]) {
    assert.equal(isOpaqueCitationKey(token), false, token);
  }
});

test("opaque-key classification does not change the shared author/year parser", () => {
  assert.deepEqual(parseCitationKeyHint("RN75"), {
    raw: "RN75",
    normalized: "RN75",
    surname: "R",
    firstInitial: "N",
    year: 1975,
    suffix: ""
  });
  assert.deepEqual(parseCitationKeyHint("Shariat25"), {
    raw: "Shariat25",
    normalized: "Shariat25",
    surname: "Shariat",
    firstInitial: null,
    year: 2025,
    suffix: ""
  });
});

test("beta contextual normalization clears opaque query evidence but preserves typed insertion", () => {
  const context = {
    token: "RN3825",
    searchMode: "contextual",
    parsedKeyHint: { surname: "R", firstInitial: "N", year: 3825, suffix: "" },
    sentenceText: "A contextual sentence about the target paper."
  };
  const normalized = normalizeContextualCitationContext(context, "beta");
  assert.equal(normalized.token, "");
  assert.equal(normalized.typedToken, "RN3825");
  assert.equal(normalized.parsedKeyHint, null);

  assert.equal(normalizeContextualCitationContext(context, "classic"), context);
  const simple = { ...context, searchMode: "simple" };
  assert.equal(normalizeContextualCitationContext(simple, "beta"), simple);
  const ordinary = { ...context, token: "Shariat25" };
  assert.equal(normalizeContextualCitationContext(ordinary, "beta"), ordinary);
  const doi = { ...context, token: "doi:10.1234/example" };
  assert.equal(normalizeContextualCitationContext(doi, "beta"), doi);
});

test("beta treats yearless multi-word topic slugs as evidence rather than author identities", () => {
  const context = { token: "neural-code-survey", searchMode: "contextual", parsedKeyHint: parseCitationKeyHint("neural-code-survey") };
  const normalized = normalizeContextualCitationContext(context, "beta");
  assert.equal(normalized.token, context.token);
  assert.equal(normalized.parsedKeyHint, null);
  assert.equal(normalizeContextualCitationContext(context, "classic"), context);
  const simple = { ...context, searchMode: "simple" };
  assert.equal(normalizeContextualCitationContext(simple, "beta"), simple);
  const named = { token: "Smith-Jones-Brown2024", searchMode: "contextual", parsedKeyHint: parseCitationKeyHint("Smith-Jones-Brown2024") };
  assert.equal(normalizeContextualCitationContext(named, "beta"), named);
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

test("contextual extraction keeps the complete cited sentence and nearby prior sentences", () => {
  const source = "The first mobile-device study established the baseline. A second study used 1.27 measurements, e.g. from compact binaries. The method transfers to mobile devices \\citep [see] [p.~2] { Wells2022 } and remains useful after the citation. The next sentence is unrelated.";
  const cursorIndex = source.indexOf("Wells2022") + 3;
  const result = findCitationAtCursor(source, cursorIndex, 200);
  const wideResult = findCitationAtCursor(source, cursorIndex, 1200);

  assert.ok(result);
  assert.equal(result.contextText, wideResult.contextText);
  assert.equal(result.sentenceText, "The method transfers to mobile devices and remains useful after the citation.");
  assert.match(result.contextText, /The first mobile-device study established the baseline\./);
  assert.match(result.contextText, /A second study used 1\.27 measurements, e\.g\. from compact binaries\./);
  assert.match(result.contextText, /remains useful after the citation\./);
  assert.doesNotMatch(result.contextText, /The next sentence is unrelated/);
  assert.equal(extractContextualContext("A. Previous. Current sentence.", "A. Previous. Current sentence.".indexOf("Current") + 2), "A. Previous. Current sentence.");
});

test("contextual extraction excludes LaTeX metadata, comments, and later sections", () => {
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

test("contextual extraction isolates footnote claims and adds the enclosing sentence secondarily", () => {
  const source = "Main-text Gaia binaries show low-mass companions \\footnote{Footnote topic B reports an independent calibration result with \\citep{Footnote2020}.} with no evidence of accretion \\citep{Target2024}. The next sentence is unrelated.";
  const outside = findCitationAtCursor(source, source.indexOf("Target2024") + 3, 500);
  const inside = findCitationAtCursor(source, source.indexOf("Footnote2020") + 3, 500);

  assert.ok(outside);
  assert.ok(inside);
  assert.equal(outside.footnoteContextInherited, false);
  assert.equal(inside.footnoteContextInherited, true);
  assert.doesNotMatch(outside.sentenceText, /independent calibration|Footnote2020/);
  assert.doesNotMatch(outside.contextText, /independent calibration|Footnote2020/);
  assert.match(inside.sentenceText, /Footnote topic B reports an independent calibration result/);
  assert.match(inside.contextText, /Main-text Gaia binaries show low-mass companions/);
  assert.match(inside.contextText, /Footnote topic B reports an independent calibration result/);
});

test("footnote command boundaries isolate detached footnotetext without inheriting footnotemark placement", () => {
  const source = "Main topic A has a marker\\footnotemark{} and continues with the main claim \\citep{Main2024}. \\footnotetext{Detached topic B reports an independent calibration result with \\citep{Detached2024}.}";
  const main = findCitationAtCursor(source, source.indexOf("Main2024") + 3, 500);
  const detached = findCitationAtCursor(source, source.indexOf("Detached2024") + 3, 500);

  assert.ok(main);
  assert.ok(detached);
  assert.doesNotMatch(main.contextText, /Detached topic B|Detached2024/);
  assert.equal(detached.footnoteContextInherited, true);
  assert.match(detached.sentenceText, /Detached topic B reports an independent calibration result/);
  assert.match(detached.contextText, /Detached topic B reports an independent calibration result/);
  assert.doesNotMatch(detached.contextText, /Main topic A|main claim/);
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
