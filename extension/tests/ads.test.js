import test from "node:test";
import assert from "node:assert/strict";

import { buildAdsQueries, buildAdsQuery, rerankAdsCandidates } from "../src/core/ads.js";

test("buildAdsQuery prefers fielded author/year search from parsed key hints", () => {
  const query = buildAdsQuery({
    token: "Shariat25",
    parsedKeyHint: {
      surname: "Shariat",
      year: 2025
    }
  });
  assert.equal(query, 'author:"Shariat" year:2025');
});

test("rerankAdsCandidates prefers matching author and year", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "resolved triples from Gaia provide empirical constraints on triple star populations",
      sentenceText: "resolved triples from Gaia",
      parsedKeyHint: { surname: "Shariat", year: 2025, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations",
        authors: ["Shariat, Cheyanne", "El-Badry, Kareem"],
        year: 2025,
        abstract: "Resolved triples from Gaia constrain triple star populations.",
        doi: null
      },
      {
        bibcode: "bad",
        title: "A different paper",
        authors: ["Someone Else"],
        year: 2025,
        abstract: "No relevant words here.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "good");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("buildAdsQueries adds cautious fallbacks for surname variants and nearby years", () => {
  const queries = buildAdsQueries({
    token: "ElBadry25",
    sentenceText: "Gaia resolved triples",
    contextText: "Gaia resolved triples provide empirical constraints on stellar populations",
    parsedKeyHint: {
      surname: "ElBadry",
      year: 2025
    }
  });

  assert.ok(queries.includes('author:"ElBadry" year:2025'));
  assert.ok(queries.includes('author:"El-Badry" year:2025'));
  assert.ok(queries.includes('author:"ElBadry" year:2024'));
  assert.ok(queries.some((query) => query.includes('title:"gaia"') || query.includes('abstract:"gaia"')));
});
