import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBroadSearchQuery,
  buildSourceRouting,
  buildSourcePlan,
  exportCandidateBibtex,
  isFieldedAdsDirectQuery,
  searchBroadCandidates,
  searchBroadCandidatesForSources,
  SOURCE_IDS
} from "../src/core/sources.js";

test("general source profile uses Crossref with a DOI-only DataCite fallback and no required token", () => {
  const plan = buildSourcePlan({ sourceProfile: "general", sourceApiTokens: {} });

  assert.deepEqual(plan.primarySources, [SOURCE_IDS.CROSSREF]);
  assert.deepEqual(plan.optionalEnhancers, []);
  assert.deepEqual(plan.missingOptionalCredentials, []);

  const routing = buildSourceRouting({
    sourceProfile: "general",
    sourceApiTokens: { ads: "ads-token" }
  });
  assert.equal(routing.primarySource, SOURCE_IDS.CROSSREF);
  assert.deepEqual(routing.availableFallbackSources, [SOURCE_IDS.DATACITE]);
});

test("Astrophysics profile plans no broad provider calls", async () => {
  const plan = buildSourcePlan({
    sourceProfile: "astrophysics",
    sourceApiTokens: { ads: "token" }
  });

  assert.deepEqual(plan.primarySources, []);
  assert.deepEqual(plan.optionalEnhancers, [SOURCE_IDS.ADS]);
  assert.deepEqual(plan.orderedSources, [SOURCE_IDS.ADS]);

  const candidates = await searchBroadCandidates({
    token: "Shariat25",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "Triple star systems are common in Gaia.",
    contextText: "Triple star systems are common in Gaia."
  }, {
    sourceProfile: "astrophysics",
    sourceApiTokens: { ads: "token" }
  }, async () => {
    throw new Error("Astrophysics mode should not call broad providers");
  });

  assert.deepEqual(candidates, []);
});

test("Math profile uses arXiv first with Crossref fallback", () => {
  const routing = buildSourceRouting({
    sourceProfile: "math"
  });
  assert.equal(routing.primarySource, SOURCE_IDS.ARXIV);
  assert.equal(routing.primarySourceAvailable, true);
  assert.deepEqual(routing.fallbackSources, [SOURCE_IDS.CROSSREF]);
  assert.deepEqual(routing.availableFallbackSources, [SOURCE_IDS.CROSSREF]);

  const plan = buildSourcePlan({
    sourceProfile: "math",
    sourceApiTokens: {}
  });
  assert.deepEqual(plan.primarySources, [SOURCE_IDS.ARXIV]);
  assert.deepEqual(plan.optionalEnhancers, []);
});

test("astrophysics profile uses ADS/SciX only", async () => {
  const plan = buildSourcePlan({
    sourceProfile: "astrophysics",
    sourceApiTokens: { ads: "token" }
  });
  assert.deepEqual(plan.primarySources, []);
  assert.deepEqual(plan.optionalEnhancers, [SOURCE_IDS.ADS]);
  assert.deepEqual(plan.orderedSources, [SOURCE_IDS.ADS]);

  const routing = buildSourceRouting({
    sourceProfile: "astrophysics",
    sourceApiTokens: { ads: "token" }
  });
  assert.equal(routing.primarySource, SOURCE_IDS.ADS);
  assert.equal(routing.primarySourceAvailable, true);
  assert.deepEqual(routing.fallbackSources, []);

  const candidates = await searchBroadCandidates({
    token: "Shariat25",
    parsedKeyHint: { surname: "Shariat", year: 2025 }
  }, {
    sourceProfile: "astrophysics",
    sourceApiTokens: { ads: "token" }
  }, async () => {
    throw new Error("Astrophysics mode should not call broad providers");
  });
  assert.deepEqual(candidates, []);
});

test("source routing uses primary first and credential-filtered fallbacks", () => {
  const routing = buildSourceRouting({
    sourceProfile: "custom",
    primarySource: SOURCE_IDS.ARXIV,
    fallbackSources: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF, SOURCE_IDS.ADS],
    sourceApiTokens: { ads: "ads-token" }
  });

  assert.equal(routing.primarySource, SOURCE_IDS.ARXIV);
  assert.equal(routing.primarySourceAvailable, true);
  assert.deepEqual(routing.fallbackSources, [SOURCE_IDS.CROSSREF, SOURCE_IDS.ADS]);
  assert.deepEqual(routing.availableFallbackSources, [SOURCE_IDS.CROSSREF, SOURCE_IDS.ADS]);
  assert.deepEqual(routing.missingCredentialSources, []);
});

test("source routing defaults to fast Astrophysics mode", () => {
  const routing = buildSourceRouting({});

  assert.equal(routing.profile, "astrophysics");
  assert.equal(routing.primarySource, SOURCE_IDS.ADS);
  assert.equal(routing.primarySourceAvailable, false);
  assert.deepEqual(routing.fallbackSources, []);
  assert.deepEqual(routing.availableFallbackSources, []);
  assert.deepEqual(routing.missingCredentialSources, [SOURCE_IDS.ADS]);
});

test("source routing presets choose minimal field-oriented sources", () => {
  const astrophysics = buildSourceRouting({ sourceProfile: "astrophysics" });
  assert.equal(astrophysics.primarySource, SOURCE_IDS.ADS);
  assert.deepEqual(astrophysics.availableFallbackSources, []);

  const physics = buildSourceRouting({ sourceProfile: "physics" });
  assert.equal(physics.primarySource, SOURCE_IDS.INSPIRE);
  assert.deepEqual(physics.availableFallbackSources, [SOURCE_IDS.CROSSREF]);

  const math = buildSourceRouting({ sourceProfile: "math" });
  assert.equal(math.primarySource, SOURCE_IDS.ARXIV);
  assert.deepEqual(math.availableFallbackSources, [SOURCE_IDS.CROSSREF]);
  assert.deepEqual(math.missingCredentialSources, []);

  const computerScience = buildSourceRouting({ sourceProfile: "computer-science" });
  assert.equal(computerScience.primarySource, SOURCE_IDS.ARXIV);
  assert.equal(computerScience.primarySourceAvailable, true);
  assert.deepEqual(computerScience.availableFallbackSources, [SOURCE_IDS.CROSSREF]);
  assert.deepEqual(computerScience.missingCredentialSources, []);

  const lifeSciences = buildSourceRouting({ sourceProfile: "life-sciences" });
  assert.equal(lifeSciences.primarySource, SOURCE_IDS.PUBMED);
  assert.deepEqual(lifeSciences.availableFallbackSources, [SOURCE_IDS.CROSSREF]);
  assert.deepEqual(lifeSciences.missingCredentialSources, []);

  const chemistry = buildSourceRouting({ sourceProfile: "chemistry" });
  assert.equal(chemistry.primarySource, SOURCE_IDS.CROSSREF);
  assert.deepEqual(chemistry.availableFallbackSources, []);

  const general = buildSourceRouting({ sourceProfile: "general" });
  assert.equal(general.primarySource, SOURCE_IDS.CROSSREF);
  assert.deepEqual(general.availableFallbackSources, [SOURCE_IDS.DATACITE]);
});

test("source routing preserves custom fallback order while dropping duplicates and unsupported sources", () => {
  const routing = buildSourceRouting({
    sourceProfile: "custom",
    primarySource: SOURCE_IDS.ARXIV,
    fallbackSources: [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV, SOURCE_IDS.DATACITE, SOURCE_IDS.CROSSREF, SOURCE_IDS.PUBMED, "bad-source"]
  });

  assert.equal(routing.primarySource, SOURCE_IDS.ARXIV);
  assert.deepEqual(routing.fallbackSources, [SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE, SOURCE_IDS.PUBMED]);
  assert.deepEqual(routing.availableFallbackSources, [SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE, SOURCE_IDS.PUBMED]);
});

test("legacy joint profiles map to minimal subject-area presets", () => {
  const plan = buildSourcePlan({ sourceProfile: "astro-physics", sourceApiTokens: {} });

  assert.equal(plan.profile, "astrophysics");
  assert.deepEqual(plan.primarySources, []);
  assert.deepEqual(plan.optionalEnhancers, []);
  assert.deepEqual(plan.missingOptionalCredentials, [SOURCE_IDS.ADS]);

  const mathPlan = buildSourcePlan({ sourceProfile: "math-physics", sourceApiTokens: { ads: "token" } });
  assert.equal(mathPlan.profile, "math");
  assert.deepEqual(mathPlan.primarySources, [SOURCE_IDS.ARXIV]);
  assert.deepEqual(mathPlan.optionalEnhancers, []);

  const adsPlan = buildSourcePlan({ sourceProfile: "ads-only", sourceApiTokens: { ads: "token" } });
  assert.equal(adsPlan.profile, "astrophysics");
  assert.deepEqual(adsPlan.optionalEnhancers, [SOURCE_IDS.ADS]);

  const broadPlan = buildSourcePlan({ sourceProfile: "broad", sourceApiTokens: {} });
  assert.equal(broadPlan.profile, "general");
  assert.deepEqual(broadPlan.primarySources, [SOURCE_IDS.CROSSREF]);
});

test("searchBroadCandidatesForSources calls only selected broad sources", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Harris20",
    parsedKeyHint: { surname: "Harris", year: 2020 },
    sentenceText: "The NumPy array library underpins scientific Python.",
    contextText: "The NumPy array library underpins scientific Python."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.CROSSREF], async (url) => {
    fetchCalls.push(url);
    assert.ok(url.startsWith("https://api.crossref.org/works"));
    return jsonResponse({
      message: {
        items: [
          {
            DOI: "10.1038/s41586-020-2649-2",
            title: ["Array programming with NumPy"],
            author: [{ family: "Harris", given: "Charles R." }],
            issued: { "date-parts": [[2020]] },
            "container-title": ["Nature"],
            type: "journal-article",
            URL: "https://doi.org/10.1038/s41586-020-2649-2"
          }
        ]
      }
    });
  });

  assert.equal(fetchCalls.length, 3);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.CROSSREF);
  assert.equal(candidates[0].title, "Array programming with NumPy");
});

test("INSPIRE direct DOI queries use the direct literature lookup and normalize HEP metadata", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "https://doi.org/10.1103/PhysRevLett.116.061102",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.INSPIRE], async (url) => {
    fetchCalls.push(url);
    assert.equal(url, "https://inspirehep.net/api/doi/10.1103%2Fphysrevlett.116.061102");
    return jsonResponse(inspireRecord({
      id: "1421100",
      title: "Observation of Gravitational Waves from a Binary Black Hole Merger",
      authors: ["Abbott, B. P.", "Abbott, R."],
      year: 2016,
      doi: "10.1103/PhysRevLett.116.061102",
      arxivId: "1602.03837",
      citationCount: 12000,
      journal: "Phys. Rev. Lett."
    }));
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.INSPIRE);
  assert.equal(candidates[0].title, "Observation of Gravitational Waves from a Binary Black Hole Merger");
  assert.equal(candidates[0].doi, "10.1103/physrevlett.116.061102");
  assert.equal(candidates[0].eprint, "1602.03837");
  assert.equal(candidates[0].primaryClass, "gr-qc");
});

test("INSPIRE contextual author-year search tries a focused HEP query before generic search", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Maldacena98",
    parsedKeyHint: { surname: "Maldacena", year: 1998 },
    sentenceText: "The large N limit connects superconformal field theories and supergravity.",
    contextText: "AdS/CFT correspondence in high energy theory."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.INSPIRE], async (url) => {
    fetchCalls.push(url);
    const parsed = new URL(url);
    if (fetchCalls.length === 1) {
      assert.match(parsed.searchParams.get("q") ?? "", /^a Maldacena and date 1998 and /);
    }
    return jsonResponse({
      hits: {
        hits: fetchCalls.length === 1
          ? [inspireRecord({
              id: "451647",
              title: "The Large N Limit of Superconformal Field Theories and Supergravity",
              authors: ["Maldacena, Juan Martin"],
              year: 1998,
              doi: "10.1023/A:1026654312961",
              arxivId: "hep-th/9711200",
              citationCount: 25000,
              journal: "Adv. Theor. Math. Phys."
            })]
          : []
      }
    });
  });

  assert.equal(fetchCalls.length, 3);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.INSPIRE);
  assert.equal(candidates[0].authors[0], "Maldacena, Juan Martin");
  assert.equal(candidates[0].year, 1998);
});

test("raw DOI queries use Crossref direct work lookup", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "doi:10.1038/s41586-021-03819-2",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.CROSSREF], async (url) => {
    fetchCalls.push(url);
    assert.equal(url, "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2");
    return jsonResponse({
      message: {
        DOI: "10.1038/s41586-021-03819-2",
        title: ["Highly accurate protein structure prediction with AlphaFold"],
        author: [{ family: "Jumper", given: "John" }],
        issued: { "date-parts": [[2021]] },
        "container-title": ["Nature"],
        type: "journal-article",
        URL: "https://doi.org/10.1038/s41586-021-03819-2"
      }
    });
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].doi, "10.1038/s41586-021-03819-2");
  assert.equal(candidates[0].title, "Highly accurate protein structure prediction with AlphaFold");
});

test("Crossref DOI fragments are not mistaken for arXiv years", async () => {
  const candidates = await searchBroadCandidatesForSources({
    token: "doi:10.1002/j.1538-7305.1948.tb01338.x",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.CROSSREF], async () => jsonResponse({
    message: {
      DOI: "10.1002/j.1538-7305.1948.tb01338.x",
      title: ["A Mathematical Theory of Communication"],
      author: [{ family: "Shannon", given: "C. E." }],
      issued: { "date-parts": [[1948]] },
      "container-title": ["Bell System Technical Journal"],
      type: "journal-article",
      URL: "https://doi.org/10.1002/j.1538-7305.1948.tb01338.x"
    }
  }));

  assert.equal(candidates[0].year, 1948);
});

test("raw DOI queries decode copied DOI URLs and strip page suffixes", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "doi:10.1023/A%3A1022627411411.full",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.CROSSREF], async (url) => {
    fetchCalls.push(url);
    assert.equal(url, "https://api.crossref.org/works/10.1023%2Fa%3A1022627411411");
    return jsonResponse({
      message: {
        DOI: "10.1023/A:1022627411411",
        title: ["Support-Vector Networks"],
        author: [{ family: "Cortes", given: "Corinna" }],
        issued: { "date-parts": [[1995]] },
        "container-title": ["Machine Learning"],
        type: "journal-article",
        URL: "https://doi.org/10.1023/A:1022627411411"
      }
    });
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates[0].doi, "10.1023/a:1022627411411");
  assert.equal(candidates[0].title, "Support-Vector Networks");
});

test("Crossref DOI lookup retries once after rate limiting", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "doi:10.1038/s41586-021-03819-2",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.CROSSREF], async (url) => {
    fetchCalls.push(url);
    if (fetchCalls.length === 1) {
      return statusResponse(429, { "Retry-After": "0.001" });
    }
    return jsonResponse({
      message: {
        DOI: "10.1038/s41586-021-03819-2",
        title: ["Highly accurate protein structure prediction with AlphaFold"],
        author: [{ family: "Jumper", given: "John" }],
        issued: { "date-parts": [[2021]] },
        "container-title": ["Nature"],
        type: "journal-article"
      }
    });
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates[0].doi, "10.1038/s41586-021-03819-2");
});

test("raw arXiv identifier queries use arXiv id_list lookup", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "arXiv:1706.03762",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("id_list"), "1706.03762");
    assert.equal(parsed.searchParams.has("search_query"), false);
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/1706.03762v7</id>
          <published>2017-06-12T00:00:00Z</published>
          <title>Attention Is All You Need</title>
          <summary>Transformer abstract.</summary>
          <author><name>Ashish Vaswani</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eprint, "1706.03762");
  assert.equal(candidates[0].title, "Attention Is All You Need");
});

test("direct arXiv title-year queries strip the year for title search", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Mamba: Linear-Time Sequence Modeling with Selective State Spaces 2024",
    searchMode: "direct"
  }, {
    sourceProfile: "computer-science",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(new URL(url));
    assert.equal(fetchCalls[0].searchParams.get("search_query"), 'ti:"Mamba: Linear-Time Sequence Modeling with Selective State Spaces"');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2312.00752v2</id>
          <published>2023-12-01T00:00:00Z</published>
          <title>Mamba: Linear-Time Sequence Modeling with Selective State Spaces</title>
          <summary>Selective state spaces for sequence modeling.</summary>
          <author><name>Albert Gu</name></author>
          <author><name>Tri Dao</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG"/>
        </entry>
      </feed>`);
  });

  assert.equal(candidates[0].eprint, "2312.00752");
});

test("old-style arXiv identifiers use arXiv id_list lookup", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "arXiv:math/0211159",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("id_list"), "math/0211159");
    assert.equal(parsed.searchParams.has("search_query"), false);
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/math/0211159v1</id>
          <published>2002-11-11T00:00:00Z</published>
          <title>The entropy formula for the Ricci flow and its geometric applications</title>
          <summary>Ricci flow abstract.</summary>
          <author><name>Grisha Perelman</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="math.DG"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eprint, "math/0211159");
  assert.equal(candidates[0].title, "The entropy formula for the Ricci flow and its geometric applications");
});

test("arXiv author-year lookup starts with context-aware author-year query", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "Triple star systems are common in Gaia and should resolve through arXiv.",
    contextText: "legacy ADS path words should not prevent arXiv fallback"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.has("id_list"), false);
    const query = parsed.searchParams.get("search_query") ?? "";
    assert.equal(query, 'au:"Shariat" AND submittedDate:[202501010000 TO 202512312359] AND (all:"triple" OR all:"star" OR all:"systems" OR all:"common" OR all:"gaia")');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2506.16513v1</id>
          <published>2025-06-19T00:00:00Z</published>
          <title>10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations</title>
          <summary>Triple population abstract.</summary>
          <author><name>Cheyanne Shariat</name></author>
          <author><name>Kareem El-Badry</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.SR"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eprint, "2506.16513");
  assert.equal(candidates[0].title, "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations");
});

test("arXiv author-year lookup falls back to broad author-year when context is too narrow", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "This nearby systems citation should still recover when arXiv context is too narrow."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    if (fetchCalls.length === 1) {
      assert.match(new URL(url).searchParams.get("search_query") ?? "", /all:"nearby"/);
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`);
    }
    assert.equal(new URL(url).searchParams.get("search_query"), 'au:"Shariat" AND submittedDate:[202501010000 TO 202512312359]');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2506.16513v1</id>
          <published>2025-06-19T00:00:00Z</published>
          <title>10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations</title>
          <summary>Triple population abstract.</summary>
          <author><name>Cheyanne Shariat</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.SR"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates[0].eprint, "2506.16513");
});

test("arXiv author-year lookup retries prior preprint year when journal year misses first-author papers", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Foreman-Mackey2013",
    parsedKeyHint: { surname: "Foreman-Mackey", year: 2013 },
    sentenceText: "The emcee sampler is widely used for affine-invariant MCMC.",
    contextText: "The emcee sampler is widely used for affine-invariant MCMC."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const query = new URL(url).searchParams.get("search_query") ?? "";
    if (fetchCalls.length === 1) {
      assert.match(query, /submittedDate:\[201301010000 TO 201312312359\]/);
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/1310.4179v1</id>
            <published>2013-10-15T00:00:00Z</published>
            <title>A coauthored 2013 arXiv paper</title>
            <summary>Andromeda disk stars.</summary>
            <author><name>Claire Dorman</name></author>
            <author><name>Daniel Foreman-Mackey</name></author>
            <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.GA"/>
          </entry>
        </feed>`);
    }
    assert.equal(query, 'au:"Foreman-Mackey" AND submittedDate:[201201010000 TO 201312312359]');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/1202.3665v4</id>
          <published>2012-02-16T00:00:00Z</published>
          <title>emcee: The MCMC Hammer</title>
          <summary>Affine-invariant ensemble sampling with MCMC.</summary>
          <author><name>Daniel Foreman-Mackey</name></author>
          <author><name>David W. Hogg</name></author>
          <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1086/670067</arxiv:doi>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.IM"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates.some((candidate) => candidate.eprint === "1202.3665"), true);
});

test("arXiv author-year lookup retries once after rate limiting", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 }
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    if (fetchCalls.length === 1) {
      return statusResponse(429, { "Retry-After": "0.001" });
    }
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2506.16513v1</id>
          <published>2025-06-19T00:00:00Z</published>
          <title>10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations</title>
          <summary>Triple population abstract.</summary>
          <author><name>Cheyanne Shariat</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.SR"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eprint, "2506.16513");
});

test("arXiv runtime cache reuses repeated author-year lookups", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2601.00001v1</id>
          <published>2026-01-01T00:00:00Z</published>
          <title>Cached arXiv Result</title>
          <summary>Cache test abstract.</summary>
          <author><name>Example Cache</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.DL"/>
        </entry>
      </feed>`);
  };
  try {
    const citationContext = {
      token: "Cache2026",
      parsedKeyHint: { surname: "Cache", year: 2026 }
    };
    await searchBroadCandidatesForSources(citationContext, {
      sourceProfile: "custom",
      sourceApiTokens: {}
    }, [SOURCE_IDS.ARXIV]);
    const second = await searchBroadCandidatesForSources(citationContext, {
      sourceProfile: "custom",
      sourceApiTokens: {}
    }, [SOURCE_IDS.ARXIV]);

    assert.equal(fetchCalls.length, 1);
    assert.equal(second[0].eprint, "2601.00001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arXiv rate-limit text falls back to Crossref metadata", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "Resolved triples from Gaia constrain triple star populations."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const host = new URL(url).host;
    if (host === "export.arxiv.org") {
      return rateLimitedTextResponse();
    }
    assert.equal(host, "api.crossref.org");
    return jsonResponse({
      message: {
        items: [{
          DOI: "10.1088/1538-3873/adfb30",
          title: ["10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations"],
          author: [{ family: "Shariat", given: "Cheyanne" }, { family: "El-Badry", given: "Kareem" }],
          issued: { "date-parts": [[2025]] },
          "container-title": ["Publications of the Astronomical Society of the Pacific"],
          type: "journal-article",
          URL: "https://doi.org/10.1088/1538-3873/adfb30"
        }]
      }
    });
  });

  assert.equal(fetchCalls.filter((url) => new URL(url).host === "export.arxiv.org").length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.CROSSREF);
  assert.equal(candidates[0].doi, "10.1088/1538-3873/adfb30");
});

test("PubMed source uses NCBI search and summary without requiring an API key", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Jumper21",
    parsedKeyHint: { surname: "Jumper", year: 2021 },
    sentenceText: "AlphaFold predicts protein structure with high accuracy.",
    contextText: "AlphaFold predicts protein structure with high accuracy."
  }, {
    sourceProfile: "life-sciences",
    sourceApiTokens: {}
  }, [SOURCE_IDS.PUBMED], async (url) => {
    fetchCalls.push(url);
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("db"), "pubmed");
      assert.equal(parsed.searchParams.has("api_key"), false);
      return jsonResponse({ esearchresult: { idlist: ["34265844"] } });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
      return jsonResponse({
        result: {
          uids: ["34265844"],
          34265844: {
            uid: "34265844",
            title: "Highly accurate protein structure prediction with AlphaFold",
            pubdate: "2021 Jul",
            fulljournalname: "Nature",
            authors: [{ name: "Jumper J" }],
            articleids: [{ idtype: "doi", value: "10.1038/s41586-021-03819-2" }]
          }
        }
      });
    }
    throw new Error(`Unexpected PubMed URL ${url}`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.PUBMED);
  assert.equal(candidates[0].authors[0], "Jumper, J");
  assert.equal(candidates[0].doi, "10.1038/s41586-021-03819-2");
  assert.equal(candidates[0].year, 2021);
});

test("PubMed source keeps old no-author records and supports direct PMID lookup", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "PMID:18890300",
    searchMode: "direct",
    parsedKeyHint: null,
    sentenceText: "STREPTOMYCIN treatment of pulmonary tuberculosis.",
    contextText: "The 1948 streptomycin tuberculosis randomized trial."
  }, {
    sourceProfile: "life-sciences",
    sourceApiTokens: {}
  }, [SOURCE_IDS.PUBMED], async (url) => {
    fetchCalls.push(new URL(url));
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
      assert.equal(new URL(url).searchParams.get("term"), "18890300[uid]");
      return jsonResponse({ esearchresult: { idlist: ["18890300"] } });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
      return jsonResponse({
        result: {
          uids: ["18890300"],
          18890300: {
            uid: "18890300",
            title: "STREPTOMYCIN treatment of pulmonary tuberculosis.",
            pubdate: "1948 Oct 30",
            fulljournalname: "British medical journal",
            authors: [],
            articleids: [{ idtype: "pubmed", value: "18890300" }]
          }
        }
      });
    }
    throw new Error(`Unexpected PubMed URL ${url}`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.PUBMED);
  assert.equal(candidates[0].authors.length, 0);
  assert.equal(candidates[0].year, 1948);
  assert.equal(candidates[0].bibtexExportId, "18890300");
});

test("PubMed source retries one rate-limited summary request", async () => {
  let summaryAttempts = 0;
  const candidates = await searchBroadCandidatesForSources({
    token: "Jumper21",
    parsedKeyHint: { surname: "Jumper", year: 2021 },
    sentenceText: "AlphaFold predicts protein structure with high accuracy.",
    contextText: "AlphaFold predicts protein structure with high accuracy."
  }, {
    sourceProfile: "life-sciences",
    sourceApiTokens: {}
  }, [SOURCE_IDS.PUBMED], async (url) => {
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
      return jsonResponse({ esearchresult: { idlist: ["34265844"] } });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
      summaryAttempts += 1;
      if (summaryAttempts === 1) {
        return statusResponse(429, { "retry-after": "0.001" });
      }
      return jsonResponse({
        result: {
          uids: ["34265844"],
          34265844: {
            uid: "34265844",
            title: "Highly accurate protein structure prediction with AlphaFold",
            pubdate: "2021 Jul",
            fulljournalname: "Nature",
            authors: [{ name: "Jumper J" }],
            articleids: [{ idtype: "doi", value: "10.1038/s41586-021-03819-2" }]
          }
        }
      });
    }
    throw new Error(`Unexpected PubMed URL ${url}`);
  });

  assert.equal(summaryAttempts, 2);
  assert.equal(candidates[0].doi, "10.1038/s41586-021-03819-2");
});

test("buildBroadSearchQuery combines citation hints with local context", () => {
  const query = buildBroadSearchQuery({
    token: "Shariat25",
    sentenceText: "Resolved triples from Gaia provide empirical constraints.",
    contextText: "The Gaia catalog reveals hierarchical triple star populations.",
    parsedKeyHint: { surname: "Shariat", year: 2025 }
  });

  assert.equal(query, "Shariat 2025 resolved triples gaia provide empirical constraints");
});

test("buildBroadSearchQuery uses a title-like sentence lead in contextual mode", () => {
  const query = buildBroadSearchQuery({
    token: "Press1974",
    searchMode: "contextual",
    sentenceText: "Formation of Galaxies and Clusters of Galaxies by Self-Similar Gravitational Condensation is the target publication.",
    contextText: "The Press-Schechter halo mass function is central to structure formation.",
    parsedKeyHint: { surname: "Press", year: 1974 }
  });

  assert.equal(query, "Formation of Galaxies and Clusters of Galaxies by Self-Similar Gravitational Condensation");
});

test("buildBroadSearchQuery keeps long title-like tokens focused", () => {
  const query = buildBroadSearchQuery({
    token: "Attention Is All You Need",
    sentenceText: "Raw broad query for the transformer paper.",
    contextText: "Raw broad query for the transformer paper.",
    parsedKeyHint: { surname: "Attention Is All You Need" }
  });

  assert.equal(query, "Attention Is All You Need");
});

test("raw DOI and arXiv identifier queries stay literal for provider-specific lookup work", () => {
  assert.equal(buildBroadSearchQuery({
    token: "10.1038/s41586-021-03819-2",
    searchMode: "direct",
    parsedKeyHint: null,
    sentenceText: "Raw DOI query for AlphaFold.",
    contextText: "Raw DOI query for AlphaFold."
  }), "10.1038/s41586-021-03819-2");

  assert.equal(buildBroadSearchQuery({
    token: "arXiv:1706.03762",
    searchMode: "direct",
    parsedKeyHint: null,
    sentenceText: "Raw arXiv identifier query for Attention Is All You Need.",
    contextText: "Raw arXiv identifier query for Attention Is All You Need."
  }), "arXiv:1706.03762");
});

test("duplicate broad records keep arXiv identity for preprints with registry-year drift", async () => {
  const candidates = await searchBroadCandidatesForSources({
    token: "Attention Is All You Need",
    searchMode: "direct",
    parsedKeyHint: { surname: "Attention Is All You Need" },
    sentenceText: "Raw broad query for the transformer paper.",
    contextText: "Raw broad query for the transformer paper."
  }, { sourceProfile: "custom", sourceApiTokens: {} }, [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV], async (url) => {
    if (url.startsWith("https://api.crossref.org/works")) {
      return jsonResponse({
        message: {
          items: [
          {
            DOI: "10.65215/2q58a426",
            title: ["Attention Is All You Need"],
            issued: { "date-parts": [[2025]] },
            "is-referenced-by-count": 6530,
            author: [
              { family: "Vaswani", given: "Ashish" },
              { family: "Shazeer", given: "Noam" }
            ],
            "container-title": ["Conference"],
            abstract: "Transformer abstract.",
            type: "proceedings-article",
            URL: "https://doi.org/10.65215/2q58a426"
          }
          ]
        }
      });
    }
    if (url.startsWith("https://export.arxiv.org/api/query")) {
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/1706.03762v7</id>
            <published>2017-06-12T00:00:00Z</published>
            <title>Attention Is All You Need</title>
            <summary>Transformer abstract.</summary>
            <author><name>Ashish Vaswani</name></author>
            <author><name>Noam Shazeer</name></author>
            <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
          </entry>
        </feed>`);
    }
    return jsonResponse({ results: [], message: { items: [] }, data: [] });
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].year, 2017);
  assert.equal(candidates[0].doi, "10.65215/2q58a426");
  assert.equal(candidates[0].eprint, "1706.03762");
  assert.match(candidates[0].sourceLabel, /Crossref/);
  assert.match(candidates[0].sourceLabel, /arXiv/);
});

test("fielded raw ADS queries skip broad providers", async () => {
  assert.equal(isFieldedAdsDirectQuery({
    token: 'title:"emcee"',
    searchMode: "direct"
  }), true);
  assert.equal(isFieldedAdsDirectQuery({
    token: 'aff:"LAM", year:2026',
    searchMode: "direct"
  }), true);
  assert.equal(isFieldedAdsDirectQuery({
    token: "Attention Is All You Need",
    searchMode: "direct"
  }), false);
  assert.equal(isFieldedAdsDirectQuery({
    token: "doi:10.1038/s41586-021-03819-2",
    searchMode: "direct"
  }), false);

  const candidates = await searchBroadCandidates({
    token: 'author:"El-Badry" year:2022 title:"magnetic braking"',
    searchMode: "direct"
  }, { sourceProfile: "general", sourceApiTokens: {} }, async () => {
    throw new Error("general provider should not be called for fielded ADS raw queries");
  });

  assert.deepEqual(candidates, []);
});

test("direct DOI field syntax still reaches DOI-aware broad providers", async () => {
  const candidates = await searchBroadCandidatesForSources({
    token: "doi:10.1038/s41586-021-03819-2",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.CROSSREF], async (url) => {
    assert.equal(url, "https://api.crossref.org/works/10.1038%2Fs41586-021-03819-2");
    return jsonResponse({
      message: {
        DOI: "10.1038/s41586-021-03819-2",
        title: ["Highly accurate protein structure prediction with AlphaFold"],
        author: [{ family: "Jumper", given: "John" }],
        issued: { "date-parts": [[2021]] },
        "container-title": ["Nature"],
        type: "journal-article",
        URL: "https://doi.org/10.1038/s41586-021-03819-2"
      }
    });
  });

  assert.equal(candidates[0].doi, "10.1038/s41586-021-03819-2");
});

test("selected broad source searches also skip fielded ADS raw queries", async () => {
  const candidates = await searchBroadCandidatesForSources({
    token: 'author:"El-Badry" year:2022 title:"magnetic braking"',
    searchMode: "direct"
  }, { sourceProfile: "custom", sourceApiTokens: {} }, [SOURCE_IDS.CROSSREF, SOURCE_IDS.ARXIV], async () => {
    throw new Error("selected broad providers should not be called for fielded ADS raw queries");
  });

  assert.deepEqual(candidates, []);
});

test("selected broad sources map and deduplicate token-free results", async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url.startsWith("https://api.crossref.org/works")) {
      return jsonResponse({
        message: {
          items: [
            {
              DOI: "10.1234/example",
              title: ["A Broad Test Paper"],
              author: [{ family: "Doe", given: "Jane" }],
              issued: { "date-parts": [[2024]] },
              "container-title": ["Journal of Tests"],
              type: "journal-article",
              URL: "https://doi.org/10.1234/example"
            }
          ]
        }
      });
    }
    if (url.startsWith("https://api.datacite.org/dois")) {
      return jsonResponse({
        data: [
          {
            id: "10.5555/dataset",
            attributes: {
              doi: "10.5555/dataset",
              titles: [{ title: "A Broad Test Dataset" }],
              creators: [{ name: "Roe, Richard" }],
              publicationYear: 2023,
              descriptions: [{ descriptionType: "Abstract", description: "Dataset abstract." }],
              publisher: "Zenodo",
              types: { resourceTypeGeneral: "Dataset" },
              url: "https://example.test/dataset"
            }
          }
        ]
      });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
      return jsonResponse({ esearchresult: { idlist: [] } });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
      return jsonResponse({ result: { uids: [] } });
    }
    if (url.startsWith("https://export.arxiv.org/api/query")) {
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2401.00001v1</id>
            <published>2024-01-01T00:00:00Z</published>
            <title>A Broad Test Preprint</title>
            <summary>Preprint abstract.</summary>
            <author><name>Jane Doe</name></author>
            <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.DL"/>
          </entry>
        </feed>`);
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const candidates = await searchBroadCandidatesForSources({
    token: "Doe24",
    parsedKeyHint: { surname: "Doe", year: 2024 },
    sentenceText: "A broad test dataset is useful.",
    contextText: "A broad test dataset is useful."
  }, { sourceProfile: "custom", sourceApiTokens: {} }, [
    SOURCE_IDS.CROSSREF,
    SOURCE_IDS.DATACITE,
    SOURCE_IDS.ARXIV
  ], fetchImpl);

  assert.ok(fetchCalls.length >= 3);
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].doi, "10.1234/example");
  assert.match(candidates[0].sourceLabel, /Crossref/);
  assert.ok(candidates.find((candidate) => candidate.sourceId === SOURCE_IDS.DATACITE));
  const arxivCandidate = candidates.find((candidate) => candidate.sourceId === SOURCE_IDS.ARXIV);
  assert.equal(arxivCandidate?.eprint, "2401.00001");
});

test("DataCite direct DOI lookup runs even without dataset context words", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "10.57702/vmvbuu5i",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.DATACITE], async (url) => {
    fetchCalls.push(url);
    assert.equal(url, "https://api.datacite.org/dois/10.57702%2Fvmvbuu5i");
    return jsonResponse({
      data: {
        id: "10.57702/vmvbuu5i",
        attributes: {
          doi: "10.57702/vmvbuu5i",
          titles: [{ title: "MNIST database of handwritten digits" }],
          creators: [{ name: "LeCun, Y." }],
          publicationYear: 2024,
          descriptions: [{ descriptionType: "Abstract", description: "Handwritten digit benchmark." }],
          publisher: "DataCite",
          types: { resourceTypeGeneral: "Dataset" },
          url: "https://doi.org/10.57702/vmvbuu5i"
        }
      }
    });
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.DATACITE);
  assert.equal(candidates[0].doi, "10.57702/vmvbuu5i");
});

test("direct DOI 404s from one registry do not block another registry", async () => {
  const candidates = await searchBroadCandidatesForSources({
    token: "doi:10.1023/a:1026654312961",
    searchMode: "direct"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.DATACITE, SOURCE_IDS.CROSSREF], async (url) => {
    if (url.startsWith("https://api.datacite.org/dois/")) {
      return statusResponse(404);
    }
    if (url.startsWith("https://api.crossref.org/works/")) {
      return jsonResponse({
        message: {
          DOI: "10.1023/a:1026654312961",
          title: ["The Large-N Limit of Superconformal Field Theories and Supergravity"],
          author: [{ family: "Maldacena", given: "Juan Martin" }],
          issued: { "date-parts": [[1998]] },
          "container-title": ["International Journal of Theoretical Physics"],
          type: "journal-article",
          URL: "https://doi.org/10.1023/a:1026654312961"
        }
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.CROSSREF);
  assert.equal(candidates[0].doi, "10.1023/a:1026654312961");
});

test("exportCandidateBibtex creates a usable BibTeX entry for broad candidates", () => {
  const bibtex = exportCandidateBibtex({
    generatedKey: "Doe2024",
    title: "A Broad Test Paper",
    authors: ["Doe, Jane", "Roe, Richard"],
    year: 2024,
    journal: "Journal of Tests",
    doi: "10.1234/example",
    url: "https://example.test/paper",
    type: "journal-article"
  });

  assert.match(bibtex, /^@article\{Doe2024,/);
  assert.match(bibtex, /author = \{Doe, Jane and Roe, Richard\}/);
  assert.match(bibtex, /doi = \{10.1234\/example\}/);
});

test("exportCandidateBibtex creates misc entries for datasets and software", () => {
  const dataset = exportCandidateBibtex({
    generatedKey: "Fisher1936",
    title: "Iris flower data set",
    authors: ["Fisher, Ronald A."],
    year: 1936,
    publisher: "UCI Machine Learning Repository",
    doi: "10.24432/C56C76",
    type: "Dataset"
  });
  const software = exportCandidateBibtex({
    generatedKey: "Hunter2007",
    title: "Matplotlib: A 2D graphics environment",
    authors: ["Hunter, John D."],
    year: 2007,
    journal: "Computing in Science & Engineering",
    doi: "10.1109/MCSE.2007.55",
    type: "Software"
  });

  assert.match(dataset, /^@misc\{Fisher1936,/);
  assert.match(dataset, /publisher = \{UCI Machine Learning Repository\}/);
  assert.match(software, /^@misc\{Hunter2007,/);
  assert.match(software, /doi = \{10.1109\/MCSE.2007.55\}/);
});

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

function textResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: {
      get() {
        return null;
      }
    },
    async text() {
      return payload;
    }
  };
}

function rateLimitedTextResponse() {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "retry-after" ? "0.001" : null;
      }
    },
    async text() {
      return "Rate exceeded.";
    }
  };
}

function statusResponse(status, headers = {}) {
  return {
    ok: false,
    status,
    headers: {
      get(name) {
        return headers[name] ?? headers[String(name).toLowerCase()] ?? null;
      }
    }
  };
}

function inspireRecord({
  id,
  title,
  authors,
  year,
  doi,
  arxivId = "",
  citationCount = 0,
  journal = "",
  earliestDate = `${year}-01-01`
}) {
  return {
    id,
    metadata: {
      titles: [{ title }],
      authors: authors.map((fullName) => ({ full_name: fullName })),
      publication_info: [{ journal_title: journal, year }],
      dois: doi ? [{ value: doi }] : [],
      arxiv_eprints: arxivId ? [{ value: arxivId, categories: ["gr-qc"] }] : [],
      abstracts: [{ value: `${title} abstract.` }],
      earliest_date: earliestDate,
      citation_count: citationCount,
      document_type: ["article"],
      texkeys: [`${authors[0].split(",")[0]}:${year}`]
    }
  };
}
