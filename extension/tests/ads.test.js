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
  assert.ok(queries.some((query) => query.includes('full:"gaia"')));
});

test("buildAdsQueries prioritizes immediate sentence keywords over broader context", () => {
  const queries = buildAdsQueries({
    token: "El-Badry",
    sentenceText: "magnetic braking saturates",
    contextText: "magnetic braking saturates while the broader discussion mentions Gaia triples and astrometry",
    parsedKeyHint: {
      surname: "El-Badry",
      year: null
    }
  });

  const contextQuery = queries[0];
  assert.ok(contextQuery.includes('magnetic braking saturates'));
  assert.ok(!contextQuery.includes('full:"gaia"'));
});

test("surname-only queries lead with author+phrase, then phrase-only, before author-only", () => {
  const queries = buildAdsQueries({
    token: "El-Badry",
    sentenceText: "magnetic braking saturates",
    contextText: "magnetic braking saturates while the broader discussion mentions Gaia triples and astrometry",
    parsedKeyHint: {
      surname: "El-Badry",
      year: null
    }
  });

  assert.ok(queries[0].startsWith('author:"El-Badry" AND '));
  assert.ok(queries[0].includes('magnetic braking saturates'));
  assert.equal(
    queries[1],
    'full:"magnetic braking saturates"'
  );
  assert.equal(queries[3], 'author:"El-Badry"');
});

test("surname-only queries lead with author plus sentence phrase", () => {
  const queries = buildAdsQueries({
    token: "El-Badry",
    sentenceText: "People find that magnetic braking saturates",
    contextText: "People find that magnetic braking saturates",
    parsedKeyHint: {
      surname: "El-Badry",
      year: null
    }
  });

  assert.equal(
    queries[0],
    'author:"El-Badry" AND full:"magnetic braking saturates"'
  );
});

test("buildAdsQuery prioritizes author-only search for surname-only keys", () => {
  const query = buildAdsQuery({
    token: "El-Badry",
    parsedKeyHint: {
      surname: "El-Badry",
      year: null
    }
  });
  assert.equal(query, 'author:"El-Badry"');
});

test("buildAdsQuery uses author-only search for author-like tokens even without a parsed hint", () => {
  const query = buildAdsQuery({
    token: "El-Badry",
    parsedKeyHint: {
      surname: null,
      year: null
    }
  });
  assert.equal(query, 'author:"El-Badry"');
});

test("buildAdsQuery uses title/abstract search for descriptive non-author tokens", () => {
  const query = buildAdsQuery({
    token: "magnetic_braking",
    parsedKeyHint: {
      surname: null,
      year: null
    }
  });
  assert.equal(query, 'title:"magnetic_braking" OR abstract:"magnetic_braking"');
});

test("rerankAdsCandidates prioritizes first-author matches for surname-only hints", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "magnetic braking saturates at short periods",
      sentenceText: "magnetic braking saturates",
      parsedKeyHint: { surname: "El-Badry", year: null, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "Magnetic Braking Saturates",
        authors: ["El-Badry, Kareem", "Rix, Hans-Walter"],
        year: 2022,
        abstract: "Magnetic braking saturates in rapidly rotating stars.",
        doi: null
      },
      {
        bibcode: "bad",
        title: "Magnetic braking and stellar winds",
        authors: ["Someone Else", "El-Badry, Kareem"],
        year: 2022,
        abstract: "A different paper with overlapping words.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "good");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("rerankAdsCandidates can prioritize the right author paper from sentence meaning even without a year", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "People find that magnetic braking saturates in close binaries and this affects angular momentum evolution.",
      sentenceText: "People find that magnetic braking saturates",
      parsedKeyHint: { surname: "Shariat", year: null, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "Testing whether magnetic braking saturates in close binaries",
        authors: ["Shariat, Cheyanne", "Someone Else"],
        year: 2024,
        abstract: "We find that magnetic braking saturates in close binaries.",
        doi: null
      },
      {
        bibcode: "bad1",
        title: "A population of neutron star candidates in wide orbits from Gaia astrometry",
        authors: ["Shariat, Cheyanne", "El-Badry, Kareem"],
        year: 2024,
        abstract: "Astrometric binaries from Gaia.",
        doi: null
      },
      {
        bibcode: "bad2",
        title: "Magnetic braking in stellar evolution",
        authors: ["Other, Author"],
        year: 2022,
        abstract: "Magnetic braking saturates in some regimes.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "good");
  assert.ok(candidates[0].score > candidates[1].score);
  assert.ok(candidates[0].score > candidates[2].score);
});
