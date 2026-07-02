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
