import test from "node:test";
import assert from "node:assert/strict";

import { buildAdsQueries, buildAdsQuery, mapAdsDocToCandidate, rerankAdsCandidates } from "../src/core/ads.js";

test("buildAdsQuery prefers fielded author/year search from parsed key hints", () => {
  const query = buildAdsQuery({
    token: "Shariat25",
    parsedKeyHint: {
      surname: "Shariat",
      year: 2025
    }
  });
  assert.equal(
    query,
    '((first_author:"Shariat") OR (author:"Shariat Collaboration") OR (author:"Shariat Scientific Collaboration")) year:2025'
  );
});

test("simple search mode uses author-year queries without contextual expansion", () => {
  const queries = buildAdsQueries({
    token: "Shariat25",
    searchMode: "simple",
    sentenceText: "Triple star systems are very common, as revealed by Gaia",
    contextText: "Triple star systems are very common, as revealed by Gaia",
    parsedKeyHint: {
      surname: "Shariat",
      year: 2025,
      suffix: ""
    }
  });

  assert.deepEqual(queries.slice(0, 4), [
    '((first_author:"Shariat") OR (author:"Shariat Collaboration") OR (author:"Shariat Scientific Collaboration")) year:2025',
    'first_author:"Shariat" year:2025',
    'author:"Shariat" year:2025',
    'author:"Shariat"'
  ]);
  assert.ok(!queries.some((query) => query.includes("triple star systems")));
});

test("direct search mode sends the raw token to ADS without author-year parsing or context expansion", () => {
  const queries = buildAdsQueries({
    token: "Hünsch98",
    searchMode: "direct",
    sentenceText: "Triple star systems are very common, as revealed by Gaia",
    contextText: "Triple star systems are very common, as revealed by Gaia",
    parsedKeyHint: {
      surname: "Hunsch",
      year: 1998,
      suffix: ""
    }
  });

  assert.deepEqual(queries, ["Hünsch98"]);
  assert.ok(!queries.some((query) => query.includes("first_author")));
  assert.ok(!queries.some((query) => query.includes("triple star systems")));
});

test("direct search mode preserves fielded ADS queries with quotes exactly", () => {
  const queries = buildAdsQueries({
    token: 'author:"Muller, S." author:"Beelen, A." aff:"LAM", year:2026',
    searchMode: "direct",
    sentenceText: "People find that magnetic braking saturates",
    contextText: "People find that magnetic braking saturates in close binaries",
    parsedKeyHint: null
  });

  assert.deepEqual(queries, ['author:"Muller, S." author:"Beelen, A." aff:"LAM", year:2026']);
});

test("direct search mode fields DOI and bare arXiv identifiers for ADS", () => {
  assert.deepEqual(buildAdsQueries({
    token: "https://doi.org/10.1086/670067",
    searchMode: "direct"
  }), ['doi:"10.1086/670067"']);
  assert.deepEqual(buildAdsQueries({
    token: "doi:10.1023/a:1026654312961",
    searchMode: "direct"
  }), ['doi:"10.1023/a:1026654312961"']);
  assert.deepEqual(buildAdsQueries({
    token: "1202.3665",
    searchMode: "direct"
  }), ["identifier:1202.3665"]);
  assert.deepEqual(buildAdsQueries({
    token: "arXiv:1706.03762v7",
    searchMode: "direct"
  }), ["identifier:1706.03762"]);
  assert.deepEqual(buildAdsQueries({
    token: "math/0211159",
    searchMode: "direct"
  }), ["identifier:math/0211159"]);
});

test("ADS candidates retain arXiv identifiers for direct cross-source ranking", () => {
  const candidate = mapAdsDocToCandidate({
    bibcode: "2025arXiv250616513S",
    title: ["10,000 Resolved Triples from Gaia"],
    author: ["Shariat, Cheyanne"],
    year: "2025",
    identifier: ["arXiv:2506.16513", "2025arXiv250616513S"],
    property: ["ARTICLE", "REFEREED"],
    doctype: "article",
    pub: "Publications of the Astronomical Society of the Pacific",
    bibstem: ["PASP"],
    database: ["astronomy"]
  });

  assert.equal(candidate.eprint, "2506.16513");
  assert.equal(candidate.archivePrefix, "arXiv");
  assert.deepEqual(candidate.property, ["ARTICLE", "REFEREED"]);
  assert.equal(candidate.doctype, "article");
  assert.equal(candidate.pub, "Publications of the Astronomical Society of the Pacific");
  assert.deepEqual(candidate.bibstem, ["PASP"]);
});

test("direct search mode returns no queries for empty-token lookups", () => {
  const queries = buildAdsQueries({
    token: "",
    searchMode: "direct",
    sentenceText: "Primordial black holes have been killed by wide binaries",
    contextText: "Primordial black holes have been killed by wide binaries",
    parsedKeyHint: null
  });

  assert.deepEqual(queries, []);
});

test("simple title search prefers exact title matches over high-overlap near matches", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations",
      searchMode: "simple",
      parsedKeyHint: null
    },
    [
      {
        bibcode: "near",
        title: "Black Hole Mergers from Hierarchical Triples in Dense Star Clusters",
        authors: ["Martinez, Miguel A. S."],
        year: 2020,
        abstract: "",
        doi: "10.3847/1538-4357/abba25",
        citationCount: 500
      },
      {
        bibcode: "exact",
        title: "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations",
        authors: ["Shariat, Cheyanne"],
        year: 2025,
        abstract: "",
        doi: "10.1088/1538-3873/adfb30",
        citationCount: 0
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "exact");
});

test("rerankAdsCandidates demotes ADS non-paper records below refereed journal articles", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "El-Badry2023",
      contextText: "The closest black hole is a Sun-like star orbiting a black hole in Gaia.",
      sentenceText: "A Sun-like star orbiting a black hole is the target publication.",
      parsedKeyHint: { surname: "El-Badry", year: 2023, suffix: "" }
    },
    [
      {
        bibcode: "2023AAS...24111701E",
        title: "Dormant black holes and neutron stars in stellar binaries",
        authors: ["El-Badry, Kareem"],
        year: 2023,
        abstract: "Black holes and neutron stars in stellar binaries are discussed with Gaia constraints.",
        citationCount: 0,
        property: ["NONARTICLE", "NOT REFEREED"],
        doctype: "abstract",
        pub: "American Astronomical Society Meeting Abstracts",
        bibstem: ["AAS"]
      },
      {
        bibcode: "2023nsf....2307232E",
        title: "Dormant black holes and neutron stars in stellar binaries",
        authors: ["El-Badry, Kareem"],
        year: 2023,
        abstract: "Black holes and neutron stars in stellar binaries are discussed with Gaia constraints.",
        citationCount: 0,
        property: ["ASSOCIATED", "ESOURCE", "NONARTICLE", "NOT REFEREED"],
        doctype: "proposal",
        pub: "NSF Award",
        bibstem: ["nsf", "nsf....23"]
      },
      {
        bibcode: "2023MNRAS.518.1057E",
        title: "A Sun-like star orbiting a black hole",
        authors: ["El-Badry, Kareem", "Rix, Hans-Walter", "Quataert, Eliot"],
        year: 2023,
        abstract: "We report discovery of a bright nearby Sun-like star orbiting a dark object using Gaia.",
        citationCount: 223,
        property: ["ARTICLE", "REFEREED"],
        doctype: "article",
        pub: "Monthly Notices of the Royal Astronomical Society",
        bibstem: ["MNRAS"]
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "2023MNRAS.518.1057E");
  assert.ok(candidates[0].score > candidates[1].score);
  assert.ok(candidates[0].score > candidates[2].score);
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

test("direct search mode applies only light token matching boosts and otherwise preserves ADS order", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "resolved triples",
      searchMode: "direct"
    },
    [
      {
        bibcode: "title-match",
        title: "10,000 Resolved Triples from Gaia",
        authors: ["Shariat, Cheyanne"],
        year: 2025,
        abstract: "",
        doi: null,
        citationCount: 1
      },
      {
        bibcode: "no-match",
        title: "A different paper",
        authors: ["Someone Else"],
        year: 2025,
        abstract: "",
        doi: null,
        citationCount: 5000
      },
      {
        bibcode: "same-score-later",
        title: "Another different paper",
        authors: ["Someone Else"],
        year: 2024,
        abstract: "",
        doi: null,
        citationCount: 0
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "title-match");
  assert.equal(candidates[1].bibcode, "no-match");
  assert.equal(candidates[2].bibcode, "same-score-later");
});

test("direct fielded ADS queries preserve ADS result order", () => {
  const candidates = rerankAdsCandidates(
    {
      token: 'author:"Muller, S." author:"Beelen, A." aff:"LAM", year:2026',
      searchMode: "direct"
    },
    [
      {
        bibcode: "ads-first",
        title: "A sub-ppm upper limit on the cosmological variations of the fine structure constant alpha",
        authors: ["Muller, S.", "Beelen, A."],
        year: 2026,
        abstract: "",
        doi: null,
        citationCount: 1
      },
      {
        bibcode: "more-cited",
        title: "A different highly cited paper",
        authors: ["Someone Else"],
        year: 2026,
        abstract: "",
        doi: null,
        citationCount: 100000
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "ads-first");
  assert.equal(candidates[1].bibcode, "more-cited");
});

test("direct search mode strongly prefers exact title matches over title-prefix matches", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "Attention Is All You Need",
      searchMode: "direct"
    },
    [
      {
        bibcode: "prefix-match",
        title: "Attention is All You Need... Unless You Are a CISO: The Inherent Incompatibility Between Transformer Architectures and Zero-Trust Environments",
        authors: ["Canale, Giuseppe"],
        year: 2026,
        abstract: "",
        doi: null,
        citationCount: 0
      },
      {
        bibcode: "exact-match",
        title: "Attention Is All You Need",
        authors: ["Vaswani, Ashish"],
        year: 2017,
        abstract: "",
        doi: "10.48550/arXiv.1706.03762",
        citationCount: 100000
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "exact-match");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("simple search mode sorts matching results primarily by citation count", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "Shariat25",
      searchMode: "simple",
      parsedKeyHint: { surname: "Shariat", year: 2025, suffix: "" }
    },
    [
      {
        bibcode: "less-cited",
        title: "10,000 Resolved Triples from Gaia",
        authors: ["Shariat, Cheyanne"],
        year: 2025,
        abstract: "",
        doi: null,
        citationCount: 5
      },
      {
        bibcode: "more-cited",
        title: "Another Shariat 2025 paper",
        authors: ["Shariat, Cheyanne", "Someone Else"],
        year: 2025,
        abstract: "",
        doi: null,
        citationCount: 500
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "more-cited");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("simple search mode still penalizes non-first-author mismatches before citation count", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "Shariat25",
      searchMode: "simple",
      parsedKeyHint: { surname: "Shariat", year: 2025, suffix: "" }
    },
    [
      {
        bibcode: "good",
        title: "10,000 Resolved Triples from Gaia",
        authors: ["Shariat, Cheyanne"],
        year: 2025,
        abstract: "",
        doi: null,
        citationCount: 5
      },
      {
        bibcode: "bad",
        title: "Very highly cited unrelated paper",
        authors: ["Someone Else", "Shariat, Cheyanne"],
        year: 2025,
        abstract: "",
        doi: null,
        citationCount: 500
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

test("collaboration-style keys add collaboration-aware query variants", () => {
  const explicitYearQueries = buildAdsQueries({
    token: "Planck18",
    sentenceText: "",
    contextText: "",
    parsedKeyHint: {
      surname: "Planck",
      year: 2018
    }
  });

  assert.equal(
    explicitYearQueries[0],
    '((first_author:"Planck") OR (author:"Planck Collaboration") OR (author:"Planck Scientific Collaboration")) year:2018'
  );
  assert.ok(explicitYearQueries.includes('author:"Planck" year:2018'));

  const surnameOnlyQueries = buildAdsQueries({
    token: "LIGO",
    sentenceText: "",
    contextText: "",
    parsedKeyHint: {
      surname: "LIGO",
      year: null
    }
  });

  assert.equal(
    surnameOnlyQueries[0],
    '(first_author:"LIGO") OR (author:"LIGO Collaboration") OR (author:"LIGO Scientific Collaboration")'
  );
  assert.ok(surnameOnlyQueries.includes('author:"LIGO"'));
});

test("explicit collaboration surnames normalize back to collaboration-aware queries", () => {
  const queries = buildAdsQueries({
    token: "PlanckCollaboration18",
    sentenceText: "",
    contextText: "",
    parsedKeyHint: {
      surname: "PlanckCollaboration",
      year: 2018
    }
  });

  assert.equal(
    queries[0],
    '((first_author:"Planck") OR (author:"Planck Collaboration") OR (author:"Planck Scientific Collaboration")) year:2018'
  );
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
    'first_author:"El-Badry" AND (title:"magnetic braking saturates" OR abstract:"magnetic braking saturates")'
  );
  assert.match(queries[1], /first_author:"El-Badry"/);
  assert.match(queries[1], /braking/);
  assert.match(queries[1], /brake/);
  assert.match(queries[2], /first_author:"El-Badry"/);
  assert.ok(queries.includes('title:"magnetic braking saturates" OR abstract:"magnetic braking saturates"'));
  assert.ok(queries.includes('author:"El-Badry" AND full:"magnetic braking saturates"'));
  assert.ok(queries.includes('author:"El-Badry"'));
  assert.ok(!queries.some((query) => /\bbrak\b/.test(query)));
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
    'first_author:"Li" AND (title:"optical afterglows gamma" OR abstract:"optical afterglows gamma")'
  );
  assert.match(queries[1], /first_author:"Li"/);
  assert.match(queries[1], /afterglow/);
  assert.ok(queries.includes('title:"optical afterglows gamma ray bursts" OR abstract:"optical afterglows gamma ray bursts"'));
  assert.ok(queries.includes('author:"Li" AND full:"optical afterglows gamma ray bursts"'));
  assert.ok(!queries.some((query) => query.includes("others")));
  assert.ok(!queries.some((query) => query.includes("who")));
});

test("multi-word surname-only queries prioritize first-author and the leading scientific phrase", () => {
  const queries = buildAdsQueries({
    token: "Perez Paolino",
    sentenceText: "Young stellar objects are important for studying stellar populations",
    contextText: "Young stellar objects are important for studying stellar populations",
    parsedKeyHint: {
      surname: "Perez Paolino",
      year: null,
      firstInitial: null,
      suffix: ""
    }
  });

  assert.equal(
    queries[0],
    'first_author:"Perez Paolino" AND (title:"young stellar objects" OR abstract:"young stellar objects")'
  );
  assert.equal(
    queries[1],
    'first_author:"Perez Paolino" AND (title:"young stellar objects populations" OR abstract:"young stellar objects populations")'
  );
  assert.ok(queries.some((query) => query === 'first_author:"Perez Paolino"'));
  assert.ok(queries.some((query) => query === 'author:"Perez Paolino"'));
});

test("author-year queries strip generic sentence filler and add title/abstract keyword conjunctions", () => {
  const queries = buildAdsQueries({
    token: "Cheng25",
    sentenceText: "There have been recent studies on the target publication for galaxy mergers using lensing",
    contextText: "There have been recent studies on the target publication for galaxy mergers using lensing",
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
  assert.ok(!queries.some((query) => query.includes("target")));
  assert.ok(!queries.some((query) => query.includes("publication")));
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
  assert.equal(query, '(first_author:"El-Badry") OR (author:"El-Badry Collaboration") OR (author:"El-Badry Scientific Collaboration")');
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

  assert.equal(authorOnly, '(first_author:"Perez Paolino") OR (author:"Perez Paolino Collaboration") OR (author:"Perez Paolino Scientific Collaboration")');
  assert.equal(authorYear, '((first_author:"Perez Paolino") OR (author:"Perez Paolino Collaboration") OR (author:"Perez Paolino Scientific Collaboration")) year:2025');
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

test("buildAdsQuery treats alphabetic multi-word titles as title searches", () => {
  const query = buildAdsQuery({
    token: "A Sun-like star orbiting a black hole",
    parsedKeyHint: {
      surname: null,
      year: null
    }
  });
  assert.equal(query, 'title:"A Sun-like star orbiting a black hole" OR abstract:"A Sun-like star orbiting a black hole"');
});

test("empty-token lookups use context-only phrase and keyword queries", () => {
  const queries = buildAdsQueries({
    token: "",
    sentenceText: "Primordial black holes have been killed by wide binaries",
    contextText: "Primordial black holes have been killed by wide binaries",
    parsedKeyHint: null
  });

  assert.equal(
    queries[0],
    '(title:"primordial black holes" OR abstract:"primordial black holes") AND (title:"wide binaries" OR abstract:"wide binaries")'
  );
  assert.ok(queries.includes('title:"primordial black holes" OR abstract:"primordial black holes"'));
  assert.ok(queries.includes('title:"wide binaries" OR abstract:"wide binaries"'));
  assert.ok(queries.includes('(title:"primordial" OR abstract:"primordial") AND (title:"black" OR abstract:"black") AND (title:"holes" OR abstract:"holes" OR title:"hole" OR abstract:"hole") AND (title:"wide" OR abstract:"wide") AND (title:"binaries" OR abstract:"binaries" OR title:"binary" OR abstract:"binary")'));
  assert.ok(!queries.some((query) => query.includes('author:"')));
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

test("rerankAdsCandidates boosts collaboration first authors for collaboration-style hints", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "",
      sentenceText: "",
      parsedKeyHint: { surname: "Planck", year: 2018, suffix: "" }
    },
    [
      {
        bibcode: "person",
        title: "Sea ice work",
        authors: ["Planck, C."],
        year: 2018,
        abstract: "",
        doi: null
      },
      {
        bibcode: "collab",
        title: "Planck intermediate results",
        authors: ["Planck Collaboration", "Someone Else"],
        year: 2018,
        abstract: "",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "collab");
});

test("rerankAdsCandidates matches explicit collaboration surnames against collaboration papers", () => {
  const candidates = rerankAdsCandidates(
    {
      contextText: "cosmological parameters from planck",
      sentenceText: "cosmological parameters from planck",
      parsedKeyHint: { surname: "PlanckCollaboration", year: 2018, suffix: "" }
    },
    [
      {
        bibcode: "person",
        title: "Sea ice work",
        authors: ["Planck, C."],
        year: 2018,
        abstract: "",
        doi: null
      },
      {
        bibcode: "collab",
        title: "Planck intermediate results",
        authors: ["Planck Collaboration", "Someone Else"],
        year: 2018,
        abstract: "Planck measured cosmological parameters.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "collab");
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

test("rerankAdsCandidates strongly prefers exact multi-word title tokens over broad prefix matches", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "Attention Is All You Need",
      sentenceText: "Raw broad query for the transformer paper",
      contextText: "Raw broad query for the transformer paper",
      parsedKeyHint: { surname: "Attention Is All You Need" }
    },
    [
      {
        bibcode: "wrong-chatgpt",
        title: "Opinion Paper: So what if ChatGPT wrote it? Multidisciplinary perspectives on opportunities, challenges and implications of generative conversational AI for research, practice and policy",
        authors: ["Dwivedi, Yogesh"],
        year: 2023,
        abstract: "Transformative artificially intelligent tools such as ChatGPT.",
        doi: null,
        citationCount: 10000
      },
      {
        bibcode: "wrong-prefix",
        title: "Attention is All You Need... Unless You Are a CISO: The Inherent Incompatibility Between Transformer Architectures and Zero-Trust Environments",
        authors: ["Canale, Giuseppe"],
        year: 2026,
        abstract: "A transformer security paper.",
        doi: null,
        citationCount: 50000
      },
      {
        bibcode: "target",
        title: "Attention Is All You Need",
        authors: ["Vaswani, Ashish", "Shazeer, Noam"],
        year: 2017,
        abstract: "The Transformer architecture.",
        doi: "10.48550/arXiv.1706.03762",
        citationCount: 1000
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "target");
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

test("rerankAdsCandidates for empty-token lookups prefers papers matching both lead and trailing phrases", () => {
  const candidates = rerankAdsCandidates(
    {
      token: "",
      contextText: "Primordial black holes have been killed by wide binaries",
      sentenceText: "Primordial black holes have been killed by wide binaries",
      parsedKeyHint: null
    },
    [
      {
        bibcode: "target",
        title: "Wide Binaries in an Ultra-faint Dwarf Galaxy: A Nail in the Coffin of Primordial black hole Dark Matter",
        authors: ["Shariat, Cheyanne", "El-Badry, Kareem"],
        year: 2025,
        abstract: "Wide binaries constrain primordial black hole dark matter.",
        doi: null
      },
      {
        bibcode: "weak",
        title: "A census of wide binaries from Gaia",
        authors: ["Someone Else"],
        year: 2021,
        abstract: "A census of wide binaries.",
        doi: null
      }
    ]
  );

  assert.equal(candidates[0].bibcode, "target");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("empty-token lookups can target A Million Binaries from Gaia from sentence context", () => {
  const citationContext = {
    token: "",
    contextText: "They found a million binaries from gaia",
    sentenceText: "They found a million binaries from gaia",
    parsedKeyHint: null
  };

  const queries = buildAdsQueries(citationContext);
  assert.ok(queries.includes('title:"million binaries gaia" OR abstract:"million binaries gaia"'));
  assert.ok(queries.includes('title:"binaries gaia" OR abstract:"binaries gaia"'));

  const candidates = rerankAdsCandidates(citationContext, [
    {
      bibcode: "target",
      title: "A Million Binaries from Gaia: Estimating the Binary Fraction",
      authors: ["El-Badry, Kareem", "Rix, Hans-Walter"],
      year: 2021,
      abstract: "A million binaries from Gaia are used to estimate the binary fraction.",
      doi: null
    },
    {
      bibcode: "weak",
      title: "Wide Binaries in an Ultra-faint Dwarf Galaxy",
      authors: ["Shariat, Cheyanne", "El-Badry, Kareem"],
      year: 2025,
      abstract: "Wide binaries constrain dark matter.",
      doi: null
    }
  ]);

  assert.equal(candidates[0].bibcode, "target");
  assert.ok(candidates[0].score > candidates[1].score);
});
