import test from "node:test";
import assert from "node:assert/strict";

import { buildSearchCacheKey, shouldStopSearchEarly } from "../src/core/search-performance.js";

test("buildSearchCacheKey is stable for equivalent citation contexts", () => {
  const left = buildSearchCacheKey(
    {
      token: "Shariat25",
      sentenceText: "resolved triples from Gaia",
      contextText: "resolved triples from Gaia provide constraints",
      parsedKeyHint: { surname: "Shariat", year: 2025, firstInitial: null }
    },
    { citationKeyMode: "informative" }
  );
  const right = buildSearchCacheKey(
    {
      token: "Shariat25",
      sentenceText: "resolved triples from Gaia",
      contextText: "resolved triples from Gaia provide constraints",
      parsedKeyHint: { surname: "Shariat", year: 2025, firstInitial: null }
    },
    { citationKeyMode: "informative" }
  );
  assert.equal(left, right);
});

test("shouldStopSearchEarly returns true for a strong explicit first-author year match", () => {
  const shouldStop = shouldStopSearchEarly(
    {
      parsedKeyHint: { surname: "Shariat", year: 2025 }
    },
    [
      {
        authors: ["Shariat, Cheyanne", "El-Badry, Kareem"],
        year: 2025,
        score: 160
      }
    ],
    0
  );
  assert.equal(shouldStop, true);
});

test("shouldStopSearchEarly stays false for weaker or mismatched top results", () => {
  assert.equal(
    shouldStopSearchEarly(
      {
        parsedKeyHint: { surname: "Li", year: 2025 }
      },
      [
        {
          authors: ["Euclid Collaboration", "Li, Y."],
          year: 2025,
          score: 160
        }
      ],
      0
    ),
    false
  );

  assert.equal(
    shouldStopSearchEarly(
      {
        parsedKeyHint: { surname: "Li", year: 2025 }
      },
      [
        {
          authors: ["Li, Wei"],
          year: 2025,
          score: 90
        }
      ],
      0
    ),
    false
  );
});
