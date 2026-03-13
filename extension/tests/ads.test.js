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
  assert.equal(query, 'first_author:"Shariat" year:2025');
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

  assert.ok(queries.includes('first_author:"ElBadry" year:2025'));
  assert.ok(queries.includes('first_author:"El-Badry" year:2025'));
  assert.ok(queries.includes('author:"ElBadry" year:2024'));
  assert.ok(queries.some((query) => query.includes('full:"gaia"')));
});

test("explicit author-year queries lead with first-author year and sentence phrase", () => {
  const queries = buildAdsQueries({
    token: "Li25",
    sentenceText: "There are also other works on gamma ray burst afterglows",
    contextText: "There are also other works on gamma ray burst afterglows",
    parsedKeyHint: {
      surname: "Li",
      year: 2025
    }
  });

  assert.equal(
    queries[0],
    'first_author:"Li" year:2025 AND (title:"gamma ray burst afterglows" OR abstract:"gamma ray burst afterglows")'
  );
  assert.match(queries[1], /first_author:"Li" year:2025/);
  assert.match(queries[1], /afterglow/);
  assert.ok(queries.includes('first_author:"Li" year:2025 AND full:"gamma ray burst afterglows"'));
  assert.ok(queries.includes('first_author:"Li" year:2025'));
});

test("explicit author-year queries can use an optional first initial for common surnames", () => {
  const queries = buildAdsQueries({
    token: "LiW25",
    sentenceText: "gamma ray burst afterglows",
    contextText: "gamma ray burst afterglows",
    parsedKeyHint: {
      surname: "Li",
      firstInitial: "W",
      year: 2025
    }
  });

  assert.equal(
    queries[0],
    'first_author:"Li, W*" year:2025 AND (title:"gamma ray burst afterglows" OR abstract:"gamma ray burst afterglows")'
  );
  assert.ok(queries.includes('first_author:"Li, W*" year:2025'));
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

  assert.equal(
    queries[0],
    'author:"El-Badry" AND (title:"magnetic braking saturates" OR abstract:"magnetic braking saturates")'
  );
  assert.match(queries[1], /author:"El-Badry"/);
  assert.match(queries[1], /braking/);
  assert.match(queries[1], /saturate/);
  assert.ok(queries.includes('title:"magnetic braking saturates" OR abstract:"magnetic braking saturates"'));
  assert.ok(queries.includes('author:"El-Badry" AND full:"magnetic braking saturates"'));
  assert.ok(queries.includes('author:"El-Badry"'));
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

  assert.ok(queries.includes('author:"El-Badry" AND full:"magnetic braking saturates"'));
});

test("common-surname surname-only queries strip filler words and prioritize title phrase matching", () => {
  const queries = buildAdsQueries({
    token: "Li",
    sentenceText: "There are also others who work on optical afterglows of gamma ray bursts",
    contextText: "There are also others who work on optical afterglows of gamma ray bursts",
    parsedKeyHint: {
      surname: "Li",
      firstInitial: null,
      year: null,
      suffix: ""
    }
  });

  assert.equal(
    queries[0],
    'author:"Li" AND (title:"optical afterglows gamma ray bursts" OR abstract:"optical afterglows gamma ray bursts")'
  );
  assert.match(queries[1], /author:"Li"/);
  assert.match(queries[1], /afterglow/);
  assert.ok(queries.includes('title:"optical afterglows gamma ray bursts" OR abstract:"optical afterglows gamma ray bursts"'));
  assert.ok(queries.includes('author:"Li" AND full:"optical afterglows gamma ray bursts"'));
  assert.ok(!queries.some((query) => query.includes("others")));
  assert.ok(!queries.some((query) => query.includes("who")));
});

test("author-year queries strip generic sentence filler and add title/abstract keyword conjunctions", () => {
  const queries = buildAdsQueries({
    token: "Cheng25",
    sentenceText: "There have been recent studies on galaxy mergers using lensing",
    contextText: "There have been recent studies on galaxy mergers using lensing",
    parsedKeyHint: {
      surname: "Cheng",
      year: 2025
    }
  });

  assert.equal(
    queries[0],
    'first_author:"Cheng" year:2025 AND (title:"galaxy mergers lensing" OR abstract:"galaxy mergers lensing")'
  );
  assert.match(queries[1], /first_author:"Cheng" year:2025/);
  assert.match(queries[1], /merger/);
  assert.match(queries[1], /lens/);
  assert.ok(!queries.some((query) => query.includes("recent")));
  assert.ok(!queries.some((query) => query.includes("studies")));
  assert.ok(!queries.some((query) => query.includes("have")));
});

test("keyword morphology expands common scientific variants without broken stems", () => {
  const queries = buildAdsQueries({
    token: "Cheng25",
    sentenceText: "Recent studies on compact binaries using lensing",
    contextText: "Recent studies on compact binaries using lensing",
    parsedKeyHint: {
      surname: "Cheng",
      year: 2025
    }
  });

  const joined = queries.join("\n");
  assert.match(joined, /lens/);
  assert.match(joined, /binary/);
  assert.doesNotMatch(joined, /\bbinarie\b/);
  assert.doesNotMatch(joined, /\bbrak\b/);
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

test("buildAdsQuery preserves spaces in multi-word surnames", () => {
  const authorOnly = buildAdsQuery({
    token: "Perez Paolino",
    parsedKeyHint: {
      surname: "Perez Paolino",
      year: null
    }
  });
  const authorYear = buildAdsQuery({
    token: "Perez Paolino25",
    parsedKeyHint: {
      surname: "Perez Paolino",
      year: 2025
    }
  });

  assert.equal(authorOnly, 'author:"Perez Paolino"');
  assert.equal(authorYear, 'first_author:"Perez Paolino" year:2025');
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

test("rerankAdsCandidates penalizes collaboration papers for explicit surname-year hints", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "gamma ray burst afterglows",
      sentenceText: "gamma ray burst afterglows",
      parsedKeyHint: { surname: "Li", year: 2025, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "Gamma-ray burst afterglows in structured media",
        authors: ["Li, Wei", "Someone Else"],
        year: 2025,
        abstract: "Gamma ray burst afterglows in structured media.",
        doi: null
      },
      {
        bibcode: "bad",
        title: "Euclid: Overview of the Euclid mission",
        authors: ["Euclid Collaboration", "Li, Y."],
        year: 2025,
        abstract: "Mission overview.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "good");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("rerankAdsCandidates strongly prefers exact sentence phrase matches in titles", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "gamma ray burst afterglows",
      sentenceText: "gamma ray burst afterglows",
      parsedKeyHint: { surname: "Li", year: 2025, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "Gamma Ray Burst Afterglows from Structured Jets",
        authors: ["Li, Wei"],
        year: 2025,
        abstract: "A study of afterglow behavior.",
        doi: null
      },
      {
        bibcode: "bad",
        title: "Discovery of Ha Emission from a Protoplanet Candidate around the Young Star 2MASS",
        authors: ["Li, Wei"],
        year: 2025,
        abstract: "Young star spectroscopy.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "good");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("rerankAdsCandidates boosts matching first-author initials when provided", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "gamma ray burst afterglows",
      sentenceText: "gamma ray burst afterglows",
      parsedKeyHint: { surname: "Li", firstInitial: "W", year: 2025, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "Gamma Ray Burst Afterglows from Structured Jets",
        authors: ["Li, Wei"],
        year: 2025,
        abstract: "A study of afterglow behavior.",
        doi: null
      },
      {
        bibcode: "bad",
        title: "Gamma Ray Burst Afterglows from Structured Jets",
        authors: ["Li, Jun"],
        year: 2025,
        abstract: "A study of afterglow behavior.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "good");
  assert.ok(candidates[0].score > candidates[1].score);
});
