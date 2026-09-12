import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readBackgroundSource() {
  return readFile(new URL("../src/background.js", import.meta.url), "utf8");
}

function extractFunctionBody(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }
  throw new Error(`Could not extract ${functionName}`);
}

test("background simple search uses ordered fallbacks before parallel fallback racing", async () => {
  const source = await readBackgroundSource();
  const functionIndex = source.indexOf("async function searchFallbackSources");
  const simpleBranchIndex = source.indexOf('citationContext?.searchMode === "simple"', functionIndex);
  const parallelRaceIndex = source.indexOf("Promise.race", functionIndex);
  const returnGateIndex = source.indexOf("canReturnSimpleFallback", functionIndex);

  assert.ok(functionIndex >= 0, "searchFallbackSources should exist");
  assert.ok(simpleBranchIndex >= 0, "simple search should have an ordered fallback branch");
  assert.ok(parallelRaceIndex >= 0, "simple and contextual fallbacks should race parallel provider requests");
  assert.ok(returnGateIndex >= 0, "simple fallback racing should be gated by source order");
  assert.ok(simpleBranchIndex < returnGateIndex, "simple fallback order should be checked inside the simple branch");
});

test("background simple author-year search filters wrong-author broad matches", async () => {
  const source = await readBackgroundSource();
  const body = extractFunctionBody(source, "filterContextualAuthorYearMismatches");

  assert.match(body, /citationContext\?\.searchMode === "direct"/);
  assert.match(body, /citationContext\?\.searchMode === "simple"/);
  assert.match(body, /simpleAuthorYearCandidateMatches\(citationContext, candidate\)/);
  assert.match(body, /firstAuthorMatches\(hint\.surname, candidate\?\.authors\?\.\[0\]\)/);
});

test("background merged duplicates preserve the best available citation count", async () => {
  const source = await readBackgroundSource();
  const mergeBody = extractFunctionBody(source, "mergeCandidates");
  const preferredCitationCountBody = extractFunctionBody(source, "preferredCitationCount");

  assert.match(mergeBody, /citationCount: preferredCitationCount\(primary, secondary\)/);
  assert.match(preferredCitationCountBody, /Math\.max/);
  assert.match(preferredCitationCountBody, /primary\?\.citationCount/);
  assert.match(preferredCitationCountBody, /secondary\?\.citationCount/);
});

test("background finalization applies Context Beta only through the contextual engine setting", async () => {
  const source = await readBackgroundSource();
  const body = extractFunctionBody(source, "rerankLiteratureCandidates");

  assert.match(source, /import \{ applyContextualBetaReranking \} from "\.\/core\/contextual-beta\.js"/);
  assert.match(body, /contextualSearchEngine === "beta"/);
  assert.match(body, /applyContextualBetaReranking\(citationContext, constrained\)/);
  assert.match(body, /rerankSimpleSearchCandidates\(citationContext, contextualRanked\)/);
});

test("background direct arXiv parsing is anchored and cannot capture DOI substrings", async () => {
  const source = await readBackgroundSource();
  const directBody = extractFunctionBody(source, "directArxivToken");
  const parserBody = extractFunctionBody(source, "parseDirectArxivId");

  assert.match(directBody, /parseDirectArxivId\(token\)/);
  assert.match(parserBody, /\^\(\?:arxiv:/);
  assert.match(parserBody, /\$\/i/);
});

test("background Context Beta requires unambiguous identity before an exact-title early return", async () => {
  const source = await readBackgroundSource();
  const body = extractFunctionBody(source, "isHighConfidenceResult");
  const mergeBody = extractFunctionBody(source, "candidateMergeKeys");

  assert.match(body, /contextualBeta\?\.decisiveTitleMatch/);
  assert.match(body, /unambiguousInitial/);
  assert.match(body, /authorGivenInitialMatches/);
  assert.match(mergeBody, /firstInitial/);
});
