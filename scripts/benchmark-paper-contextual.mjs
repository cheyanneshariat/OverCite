import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseBenchmarkBbl, splitBenchmarkAuthors } from "./benchmark-bbl.mjs";

const coreRoot = path.resolve(process.env.OVERCITE_CORE_ROOT ?? "extension/src/core");
const { findCitationAtCursor } = await import(pathToFileURL(path.join(coreRoot, "citation.js")));
const { buildAdsQueries, rerankAdsCandidates } = await import(pathToFileURL(path.join(coreRoot, "ads.js")));
const { applyContextualBetaReranking } = await import(pathToFileURL(path.join(coreRoot, "contextual-beta.js")));
const contextualEngine = String(process.env.OVERCITE_CONTEXTUAL_ENGINE ?? "classic").trim().toLowerCase();

const [texPath, bibPath, outputPath = ""] = process.argv.slice(2);
if (!texPath || !bibPath) {
  throw new Error("Usage: node scripts/benchmark-paper-contextual.mjs MAIN.tex REFS.bib [REPORT.json]");
}

const [source, bibtex] = await Promise.all([
  readFile(path.resolve(texPath), "utf8"),
  readFile(path.resolve(bibPath), "utf8")
]);

const bibliography = parseBibtex(bibtex);
const candidates = bibliography.map(toCandidate);
const byKey = new Map(bibliography.map((entry) => [entry.key, entry]));
const occurrences = findCitationOccurrences(source);
const results = [];
const timingMs = [];
const keyTitles = new Map();
for (const entry of bibliography) {
  if (!keyTitles.has(entry.key)) keyTitles.set(entry.key, new Set());
  keyTitles.get(entry.key).add(normalize(entry.fields.title || ""));
}

for (const occurrence of occurrences) {
  const expected = byKey.get(occurrence.key);
  if (keyTitles.get(occurrence.key)?.size > 1) {
    results.push({ key: occurrence.key, line: lineNumberAt(source, occurrence.cursor), groupKeys: occurrence.groupKeys, status: "ambiguous-bibliography-key" });
    continue;
  }
  if (!expected) {
    results.push({
      key: occurrence.key,
      line: lineNumberAt(source, occurrence.cursor),
      status: "missing-bibliography-entry",
      groupKeys: occurrence.groupKeys
    });
    continue;
  }

  if (!cleanLatex(expected.fields.title)) {
    results.push({ key: occurrence.key, line: lineNumberAt(source, occurrence.cursor), groupKeys: occurrence.groupKeys, status: "missing-bibliography-title" });
    continue;
  }

  const localStartedAt = performance.now();
  const context = findCitationAtCursor(source, occurrence.cursor);
  if (!context || context.token !== occurrence.key) {
    results.push({
      key: occurrence.key,
      line: lineNumberAt(source, occurrence.cursor),
      status: "citation-parser-failure",
      parsedToken: context?.token ?? null,
      groupKeys: occurrence.groupKeys
    });
    continue;
  }

  context.searchMode = "contextual";
  const baselineRanked = rerankAdsCandidates(context, candidates);
  const ranked = contextualEngine === "beta"
    ? applyContextualBetaReranking(context, baselineRanked)
    : baselineRanked;
  const rank = ranked.findIndex((candidate) => candidate.bibcode === occurrence.key) + 1;
  const rankedExpected = ranked[rank - 1];
  const queries = buildAdsQueries(context);
  timingMs.push(performance.now() - localStartedAt);
  const expectedCandidate = toCandidate(expected);
  const hint = context.parsedKeyHint;
  const expectedFirstAuthor = expectedCandidate.authors[0] ?? "";
  const retrievalHintAligned = Boolean(
    hint?.surname &&
    hint?.year &&
    Number(hint.year) === Number(expectedCandidate.year) &&
    normalize(expectedFirstAuthor).includes(normalize(hint.surname))
  );

  results.push({
    key: occurrence.key,
    line: lineNumberAt(source, occurrence.cursor),
    groupKeys: occurrence.groupKeys,
    status: rank > 0 ? "ranked" : "missing-candidate",
    rank,
    expected: summarizeCandidate(rankedExpected ?? expectedCandidate),
    top3: ranked.slice(0, 3).map(summarizeCandidate),
    parsedHint: hint,
    retrievalHintAligned,
    queryCount: queries.length,
    openingQueries: queries.slice(0, 2),
    sentenceText: context.sentenceText,
    citationPrefixText: context.citationPrefixText,
    citationSuffixText: context.citationSuffixText
  });
}

const rankedResults = results.filter((result) => result.status === "ranked");
const singleCitationResults = rankedResults.filter((result) => result.groupKeys.length === 1);
const uniqueKeys = new Set(rankedResults.map((result) => result.key));
const uniqueBest = new Map();
for (const result of rankedResults) {
  const previous = uniqueBest.get(result.key);
  if (!previous || result.rank < previous.rank) {
    uniqueBest.set(result.key, result);
  }
}

const summary = {
  citationCommands: countCitationCommands(source),
  citationKeyOccurrences: occurrences.length,
  uniqueCitationKeys: new Set(occurrences.map((occurrence) => occurrence.key)).size,
  bibliographyEntries: bibliography.length,
  duplicateBibliographyKeys: duplicateKeys(bibliography),
  evaluatedOccurrences: rankedResults.length,
  top1Occurrences: countWhere(rankedResults, (result) => result.rank === 1),
  top3Occurrences: countWhere(rankedResults, (result) => result.rank <= 3),
  top10Occurrences: countWhere(rankedResults, (result) => result.rank <= 10),
  meanReciprocalRank: average(rankedResults.map((result) => 1 / result.rank)),
  singleCitationOccurrences: singleCitationResults.length,
  singleCitationTop1Occurrences: countWhere(singleCitationResults, (result) => result.rank === 1),
  singleCitationTop3Occurrences: countWhere(singleCitationResults, (result) => result.rank <= 3),
  singleCitationMeanReciprocalRank: average(singleCitationResults.map((result) => 1 / result.rank)),
  retrievalHintAlignedOccurrences: countWhere(rankedResults, (result) => result.retrievalHintAligned),
  missingBibliographyOccurrences: countWhere(results, (result) => result.status === "missing-bibliography-entry"),
  missingBibliographyTitleOccurrences: countWhere(results, (result) => result.status === "missing-bibliography-title"),
  ambiguousBibliographyOccurrences: countWhere(results, (result) => result.status === "ambiguous-bibliography-key"),
  parserFailures: countWhere(results, (result) => result.status === "citation-parser-failure"),
  uniqueEvaluatedKeys: uniqueBest.size,
  uniqueTop1Keys: countWhere([...uniqueBest.values()], (result) => result.rank === 1),
  uniqueTop3Keys: countWhere([...uniqueBest.values()], (result) => result.rank <= 3)
};

const report = {
  generatedAt: new Date().toISOString(),
  texPath: path.resolve(texPath),
  bibPath: path.resolve(bibPath),
  methodology: "Offline contextual ranking against every parseable entry in the supplied bibliography; provider retrieval and live citation counts are not simulated.",
  contextualEngine,
  timing: { kind: "Local citation parsing, ranking, and query construction only; no network", samples: timingMs.length, medianMs: percentile(timingMs, 0.5), p95Ms: percentile(timingMs, 0.95), maxMs: Math.max(0, ...timingMs) },
  summary,
  failures: results
    .filter((result) => result.status !== "ranked" || result.rank > 1)
    .sort((left, right) => (right.rank ?? Number.MAX_SAFE_INTEGER) - (left.rank ?? Number.MAX_SAFE_INTEGER)),
  results
};

console.log(JSON.stringify(summary, null, 2));
console.log("\nWorst contextual ranks:");
for (const result of report.failures.slice(0, 30)) {
  console.log(JSON.stringify({
    key: result.key,
    line: result.line,
    status: result.status,
    rank: result.rank,
    expected: result.expected,
    top3: result.top3,
    hint: result.parsedHint,
    sentence: result.sentenceText
  }));
}

if (outputPath) {
  await writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
}

function findCitationOccurrences(text) {
  const visible = maskComments(text);
  const regex = /\\(?:cite[a-zA-Z*]*|parencite\*?|textcite\*?|autocite\*?|footcite\*?|smartcite\*?)\s*(?:\[[^[\]]*]\s*){0,2}\{/g;
  const found = [];
  let match;
  while ((match = regex.exec(visible)) !== null) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = findBraceClose(visible, open);
    if (close < 0) continue;
    const inside = visible.slice(open + 1, close);
    const groupKeys = inside.split(",").map((rawToken) => rawToken.trim()).filter(Boolean);
    let offset = 0;
    for (const rawToken of inside.split(",")) {
      const leading = rawToken.search(/\S|$/);
      const key = rawToken.trim();
      if (key) {
        found.push({ key, cursor: open + 1 + offset + leading + Math.floor(key.length / 2), groupKeys });
      }
      offset += rawToken.length + 1;
    }
    regex.lastIndex = close + 1;
  }
  return found;
}

function maskComments(text) {
  return text.split("\n").map((line) => {
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "%" && (index === 0 || line[index - 1] !== "\\")) {
        return `${line.slice(0, index)}${" ".repeat(line.length - index)}`;
      }
    }
    return line;
  }).join("\n");
}

function countCitationCommands(text) {
  return [...maskComments(text).matchAll(/\\(?:cite[a-zA-Z*]*|parencite\*?|textcite\*?|autocite\*?|footcite\*?|smartcite\*?)\s*(?:\[[^[\]]*]\s*){0,2}\{/g)].length;
}

function parseBibtex(text) {
  if (/\\bibitem(?:\s|\[|\{)/.test(text)) {
    return parseBenchmarkBbl(text);
  }
  const entries = [];
  const header = /@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,/g;
  let match;
  while ((match = header.exec(text)) !== null) {
    const open = text.indexOf("{", match.index);
    const close = findBraceClose(text, open);
    if (close < 0) break;
    const bodyStart = match.index + match[0].length;
    entries.push({
      type: match[1].toLowerCase(),
      key: match[2].trim(),
      fields: parseFields(text.slice(bodyStart, close))
    });
    header.lastIndex = close + 1;
  }
  return entries;
}

function parseBblEntries(text) {
  const entries = [];
  const header = /\\bibitem(?:\[([\s\S]*?)\])?\s*\{([^{}]+)\}/g;
  const matches = [...text.matchAll(header)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const segmentStart = Number(match.index ?? 0) + match[0].length;
    const segmentEnd = index + 1 < matches.length
      ? Number(matches[index + 1].index ?? text.length)
      : text.indexOf("\\end{thebibliography}", segmentStart) >= 0
        ? text.indexOf("\\end{thebibliography}", segmentStart)
        : text.length;
    const segment = text.slice(segmentStart, segmentEnd);
    const preamble = segment.split(/\\newblock\s*/)[0] ?? "";
    const blocks = segment.split(/\\newblock\s*/).slice(1);
    const preambleLines = preamble.split(/\\\\/).map(cleanLatex).filter(Boolean);
    const title = preambleLines.length >= 2
      ? preambleLines.slice(1).join(" ")
      : cleanLatex(blocks[0] ?? "");
    const years = `${match[1] ?? ""} ${segment}`.match(/(?:18|19|20)\d{2}/g) ?? [];
    entries.push({
      type: "article",
      key: match[2].trim(),
      fields: {
        author: firstBblAuthor(match[1], segment),
        title,
        year: years[0] ?? ""
      }
    });
  }
  return entries.filter((entry) => entry.key && entry.fields.title);
}

function firstBblAuthor(optionalLabel, segment) {
  const label = cleanLatex(optionalLabel ?? "")
    .replace(/\bet\s+al\.?[\s\S]*$/i, "")
    .replace(/\band\b[\s\S]*$/i, "")
    .replace(/\([\s\S]*$/i, "")
    .trim();
  if (label) return `${label},`;
  const raw = cleanLatex(segment.split(/\\newblock\s*/)[0] ?? "")
    .replace(/\bet\s+al\.?[\s\S]*$/i, "")
    .replace(/\band\b[\s\S]*$/i, "")
    .replace(/[.,]\s*$/, "")
    .trim();
  const firstAuthor = raw.split(",")[0]?.trim() ?? raw;
  const family = firstAuthor.split(/\s+/).at(-1) ?? firstAuthor;
  return family ? `${family},` : "";
}

function parseFields(body) {
  const fields = {};
  let index = 0;
  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index])) index += 1;
    const nameMatch = body.slice(index).match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/);
    if (!nameMatch) break;
    const name = nameMatch[1].toLowerCase();
    index += nameMatch[0].length;
    const parsed = parseFieldValue(body, index);
    fields[name] = parsed.value;
    index = parsed.end;
  }
  return fields;
}

function parseFieldValue(text, start) {
  if (text[start] === "{") {
    const close = findBraceClose(text, start);
    return { value: text.slice(start + 1, close), end: close + 1 };
  }
  if (text[start] === '"') {
    let index = start + 1;
    while (index < text.length) {
      if (text[index] === '"' && text[index - 1] !== "\\") break;
      index += 1;
    }
    return { value: text.slice(start + 1, index), end: index + 1 };
  }
  let end = start;
  while (end < text.length && text[end] !== "," && text[end] !== "\n") end += 1;
  return { value: text.slice(start, end).trim(), end };
}

function findBraceClose(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function toCandidate(entry) {
  const fields = entry.fields;
  const title = cleanLatex(fields.title ?? "");
  const authors = splitBenchmarkAuthors(fields.author ?? "").map(cleanLatex);
  const adsBibcode = String(fields.adsurl ?? "").match(/\/abs\/([^/?#]+)/)?.[1];
  const refereed = ["article", "inproceedings"].includes(entry.type);
  return {
    bibcode: entry.key,
    adsBibcode,
    title,
    authors,
    year: Number(String(fields.year ?? "").match(/\d{4}/)?.[0]) || null,
    abstract: cleanLatex(fields.abstract ?? ""),
    doi: cleanLatex(fields.doi ?? "") || null,
    eprint: cleanLatex(fields.eprint ?? ""),
    archivePrefix: cleanLatex(fields.archiveprefix ?? ""),
    citationCount: 0,
    property: refereed ? ["ARTICLE", "REFEREED"] : [],
    doctype: refereed ? "article" : entry.type,
    pub: cleanLatex(fields.journal ?? fields.booktitle ?? ""),
    bibstem: [],
    database: [],
    score: 0,
    generatedKey: null
  };
}

function splitAuthors(text) {
  const authors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    if (depth === 0 && text.slice(index, index + 5).toLowerCase() === " and ") {
      authors.push(text.slice(start, index));
      start = index + 5;
      index += 4;
    }
  }
  authors.push(text.slice(start));
  return authors.map((author) => author.trim()).filter(Boolean);
}

function cleanLatex(value) {
  return String(value ?? "")
    .replace(/\\['"`^~=.]\s*\{?([A-Za-z])\}?/g, "$1")
    .replace(/\\(?:textit|textbf|emph|mathrm|rm|it)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[A-Za-z]+\*?/g, " ")
    .replace(/[{}$]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeCandidate(candidate) {
  return {
    key: candidate.bibcode,
    title: candidate.title,
    firstAuthor: candidate.authors[0] ?? "",
    year: candidate.year,
    score: candidate.score,
    contextualBeta: candidate.contextualBeta ?? null
  };
}

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function duplicateKeys(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
}

function countWhere(values, predicate) {
  return values.reduce((count, value) => count + Number(predicate(value)), 0);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
