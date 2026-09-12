import test from "node:test";
import assert from "node:assert/strict";

import { buildQuickPickItems, exportBibtex, resolveBibTarget, searchAds, searchLiterature } from "../src/service.js";

test("resolveBibTarget uses workspace-folder overrides", () => {
  const resolution = resolveBibTarget(
    {
      mainText: "\\bibliography{refs}",
      activeFileName: "main.tex",
      projectFiles: ["refs.bib", "other.bib"],
      projectId: "/tmp/project"
    },
    {
      projectBibFileOverrides: {
        "/tmp/project": "other.bib"
      }
    }
  );

  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.target, "other.bib");
});

test("buildQuickPickItems exposes generated keys and details", () => {
  const items = buildQuickPickItems(
    [
      {
        bibcode: "x",
        title: "Test Title",
        authors: ["Shariat, Cheyanne"],
        year: 2025,
        abstract: "A short abstract.",
        generatedKey: "Shariat25_test",
        citationCount: 4321
      }
    ],
    {
      citationKeyMode: "informative",
      bibliographyInsertMode: "append"
    },
    "Shariat25"
  );

  assert.equal(items[0].label, "Shariat25_test");
  assert.equal(items[0].description, "Shariat, Cheyanne | 2025 · cited by 4,321");
  assert.match(items[0].detail, /Test Title/);
  assert.equal(items[0].candidate.typedToken, "Shariat25");
});

test("searchAds uses ADS query ladder and returns generated keys", async () => {
  const calls = [];
  const results = await searchAds(
    {
      token: "Shariat25",
      sentenceText: "resolved triples from Gaia",
      contextText: "resolved triples from Gaia provide empirical constraints on triple star populations",
      parsedKeyHint: {
        surname: "Shariat",
        year: 2025,
        firstInitial: null,
        suffix: ""
      }
    },
    {
      adsApiToken: "token",
      citationKeyMode: "informative"
    },
    async (input) => {
      calls.push(String(input));
      return {
        ok: true,
        async json() {
          return {
            response: {
              docs: [
                {
                  bibcode: "good",
                  title: ["10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations"],
                  author: ["Shariat, Cheyanne", "El-Badry, Kareem"],
                  year: "2025",
                  abstract: "Resolved triples from Gaia constrain triple star populations.",
                  doi: ["10.1234/example"]
                }
              ]
            }
          };
        }
      };
    }
  );

  assert.match(calls[0], /first_author/i);
  assert.match(calls[0], /Shariat/);
  assert.match(calls[0], /2025/);
  assert.equal(results[0].generatedKey, "Shariat25_10k");
});

test("searchAds simple mode requests citation_count and keeps simple query ladder", async () => {
  const calls = [];
  await searchAds(
    {
      token: "Shariat25",
      searchMode: "simple",
      sentenceText: "resolved triples from Gaia",
      contextText: "resolved triples from Gaia provide empirical constraints on triple star populations",
      parsedKeyHint: {
        surname: "Shariat",
        year: 2025,
        firstInitial: null,
        suffix: ""
      }
    },
    {
      adsApiToken: "token",
      citationKeyMode: "informative"
    },
    async (input) => {
      calls.push(String(input));
      return {
        ok: true,
        async json() {
          return {
            response: {
              docs: [
                {
                  bibcode: "good",
                  title: ["Once a Triple, Not Always a Triple"],
                  author: ["Shariat, Cheyanne"],
                  year: "2025",
                  abstract: "Triples evolve.",
                  doi: ["10.1234/example"],
                  citation_count: 42
                }
              ]
            }
          };
        }
      };
    }
  );

  assert.match(calls[0], /citation_count/);
  assert.match(decodeURIComponent(calls[0]), /first_author/i);
  assert.match(decodeURIComponent(calls[0]), /year:2025/);
  assert.doesNotMatch(decodeURIComponent(calls[0]), /resolved triples from Gaia/);
});

test("searchAds direct mode performs one literal ADS query with no contextual expansion", async () => {
  const calls = [];
  const results = await searchAds(
    {
      token: 'author:"El-Badry" year:2022 title:"magnetic braking"',
      searchMode: "direct",
      sentenceText: "People find that magnetic braking saturates",
      contextText: "People find that magnetic braking saturates in close binaries from ZTF",
      parsedKeyHint: null
    },
    {
      adsApiToken: "token",
      citationKeyMode: "informative"
    },
    async (input) => {
      calls.push(String(input));
      return okResponse([
        makeDoc("direct-1", {
          title: "Magnetic braking saturates: evidence from the orbital period distribution of low-mass detached eclipsing binaries from ZTF",
          author: ["El-Badry, Kareem"],
          year: "2022",
          abstract: "Magnetic braking saturates in detached eclipsing binaries."
        })
      ]);
    }
  );

  assert.equal(calls.length, 1);
  const query = new URL(calls[0]).searchParams.get("q") ?? "";
  assert.equal(query, 'author:"El-Badry" year:2022 title:"magnetic braking"');
  assert.doesNotMatch(query, /People find that magnetic braking saturates/);
  assert.match(results[0].title, /Magnetic braking saturates/i);
});

test("searchAds contextual mode starts the first two ADS queries in parallel", async () => {
  const startedCalls = [];
  const resolvers = [];

  const resultsPromise = searchAds(
    {
      token: "Shariat25",
      sentenceText: "resolved triples from Gaia",
      contextText: "resolved triples from Gaia provide empirical constraints on triple star populations",
      parsedKeyHint: {
        surname: "Shariat",
        year: 2025,
        firstInitial: null,
        suffix: ""
      }
    },
    {
      adsApiToken: "token",
      citationKeyMode: "informative"
    },
    async (input) => {
      startedCalls.push(String(input));
      const callNumber = startedCalls.length;
      if (callNumber <= 2) {
        return await new Promise((resolve) => {
          resolvers.push(() => resolve({
            ok: true,
            async json() {
              return {
                response: {
                  docs: Array.from({ length: 6 }, (_, index) => ({
                    bibcode: `${callNumber}-${index}`,
                    title: [`Candidate ${callNumber}-${index}`],
                    author: ["Shariat, Cheyanne"],
                    year: "2025",
                    abstract: "Resolved triples from Gaia constrain triple star populations.",
                    doi: [`10.1234/example-${callNumber}-${index}`]
                  }))
                }
              };
            }
          }));
        });
      }
      return {
        ok: true,
        async json() {
          return { response: { docs: [] } };
        }
      };
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(startedCalls.length, 2);
  resolvers.forEach((resolve) => resolve());

  const results = await resultsPromise;
  assert.equal(results.length, 12);
});

test("contextual ADS keeps an author-year opening result when its context sibling errors", async () => {
  const calls = [];
  const results = await searchAds({
    token: "Example2026",
    searchMode: "contextual",
    sentenceText: "Example target title is stable.",
    contextText: "Example target title is stable.",
    parsedKeyHint: { surname: "Example", year: 2026, firstInitial: "E", suffix: "" }
  }, {
    adsApiToken: "token",
    citationKeyMode: "author-year",
    contextualSearchEngine: "beta"
  }, async (input) => {
    const query = new URL(String(input)).searchParams.get("q") ?? "";
    calls.push(query);
    if (query.includes('first_author:"Example"') && !query.includes(" AND ")) {
      return okResponse([makeDoc("opening-target", {
        title: "Example target title",
        author: ["Example, E."],
        year: "2026",
        abstract: "Example target title is stable."
      })]);
    }
    throw new Error("context sibling failed");
  });

  assert.equal(results[0].bibcode, "opening-target");
  assert.ok(calls.length >= 2, "the bounded opening pair should be attempted before contextual fallback");
});

test("VS Code contextual ADS does not invoke a ready callback after an outer timeout", async () => {
  const previousBudget = process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS;
  process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS = "30";
  let readyCalls = 0;
  try {
    await assert.rejects(() => searchLiterature({
      token: "Late2026",
      searchMode: "contextual",
      sentenceText: "A late provider response should not publish.",
      contextText: "A late provider response should not publish.",
      parsedKeyHint: { surname: "Late", year: 2026, suffix: "" }
    }, {
      adsApiToken: "token",
      sourceProfile: "astrophysics",
      citationKeyMode: "author-year",
      contextualSearchEngine: "beta"
    }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return okResponse([makeDoc("late-arxiv", {
        title: "A late provider response should not publish",
        author: ["Late, Example"],
        year: "2026",
        identifier: ["arXiv:2601.12345"]
      })]);
    }, () => { readyCalls += 1; }), /Literature search timed out/);
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(readyCalls, 0);
  } finally {
    if (previousBudget === undefined) delete process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS;
    else process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS = previousBudget;
  }
});

test("searchAds lets ambiguous contextual lookups exhaust the bounded-time query ladder", async () => {
  const calls = [];

  await searchAds(
    {
      token: "Shariat25",
      sentenceText: "resolved triples from Gaia",
      contextText: "resolved triples from Gaia provide empirical constraints on triple star populations",
      parsedKeyHint: {
        surname: "Shariat",
        year: 2025,
        firstInitial: null,
        suffix: ""
      }
    },
    {
      adsApiToken: "token",
      citationKeyMode: "informative"
    },
    async (input) => {
      const url = new URL(String(input));
      const query = decodeURIComponent(url.searchParams.get("q") ?? "");
      calls.push(query);

      if (calls.length === 1) {
        return okResponse([]);
      }
      if (calls.length === 2) {
        return okResponse([
          makeDoc("kw-1"),
          makeDoc("kw-2"),
          makeDoc("kw-3"),
          makeDoc("kw-4")
        ]);
      }
      if (calls.length === 3) {
        return okResponse([]);
      }
      if (calls.length === 4) {
        return okResponse([
          makeDoc("fy-1"),
          makeDoc("fy-2"),
          makeDoc("fy-3"),
          makeDoc("fy-4"),
          makeDoc("fy-5")
        ]);
      }
      return okResponse([makeDoc(`late-${calls.length}`)]);
    }
  );

  assert.ok(calls.length > 8);
  assert.match(calls[0], /\(\(first_author:"Shariat"\) OR \(author:"Shariat Collaboration"\) OR \(author:"Shariat Scientific Collaboration"\)\) year:2025|first_author:"Shariat" year:2025/);
});

test("searchAds does not stop before a later exact-author contextual result", async () => {
  const calls = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const results = await searchAds(
    {
      token: "Strader2019",
      searchMode: "contextual",
      sentenceText: "09 solar masses",
      citationPrefixText: "Redback pulsars appear systematically massive with a median inferred neutron star mass",
      citationSuffixText: ".",
      contextText: "Redback pulsars appear systematically massive with a median inferred neutron star mass.",
      parsedKeyHint: { surname: "Strader", year: 2019, firstInitial: null, suffix: "" }
    },
    { adsApiToken: "token", citationKeyMode: "author-year" },
    async () => {
      calls.push(calls.length + 1);
      const callNumber = calls.length;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 15));
      activeRequests -= 1;
      if (callNumber !== 9) {
        return okResponse(Array.from({ length: 6 }, (_, index) => makeDoc(`distractor-${index}`, {
          title: `Redback pulsar population study ${index}`,
          author: ["Other, Author"],
          year: "2019",
          abstract: "Redback pulsar demographics."
        })));
      }
      return okResponse([makeDoc("target", {
        title: "Optical Spectroscopy and Demographics of Redback Millisecond Pulsar Binaries",
        author: ["Strader, Jay"],
        year: "2019",
        abstract: "Redback pulsars and their neutron star mass distribution."
      })]);
    }
  );

  assert.ok(calls.length >= 10 && calls.length <= 14, "at most one extra checkpoint may be prefetched");
  assert.equal(maxActiveRequests, 4, "contextual fallback queries should run in bounded groups of four");
  assert.equal(results[0].bibcode, "target");
});

test("searchAds returns Yang2026 from the entity-aware opening pair", async () => {
  const calls = [];
  const results = await searchAds({
    token: "Yang2026",
    searchMode: "contextual",
    sentenceText: "6$ .",
    citationPrefixText: "Finding NSs in hierarchical triples can test the kick model. Recently, PSR J0435+3233 is a pulsar--white-dwarf binary with a stellar tertiary",
    citationSuffixText: ".",
    contextText: "PSR J0435+3233 is a hierarchical triple with a white dwarf and stellar tertiary.",
    parsedKeyHint: { surname: "Yang", year: 2026, firstInitial: null, suffix: "" }
  }, { adsApiToken: "token", citationKeyMode: "author-year" }, async (input) => {
    const query = new URL(String(input)).searchParams.get("q");
    calls.push(query);
    if (query.includes('full:"PSR J0435+3233"')) {
      return okResponse([makeDoc("yang-triple", {
        title: "The PSR J0435+3233 Triple System",
        author: ["Yang, Z. L.", "Han, J. L."],
        year: "2026",
        abstract: "A hierarchical triple with a white-dwarf inner binary and a distant stellar tertiary."
      })]);
    }
    return okResponse(Array.from({ length: 12 }, (_, index) => makeDoc(`yang-distractor-${index}`, {
      title: `Unrelated 2026 astronomy result ${index}`,
      author: ["Yang, Other"],
      year: "2026",
      abstract: "An unrelated astronomy result."
    })));
  });

  assert.equal(results[0].bibcode, "yang-triple");
  assert.equal(calls.length, 2);
});

test("searchAds uses a precise Yang2026 arXiv fallback when ADS has not indexed it", async () => {
  const adsQueries = [];
  const arxivQueries = [];
  const results = await searchAds({
    token: "Yang2026",
    searchMode: "contextual",
    sentenceText: "6$ .",
    citationPrefixText: "Finding NSs in hierarchical triples can test the kick model. Recently, PSR J0435+3233 is a pulsar--white-dwarf binary with a stellar tertiary",
    citationSuffixText: ".",
    contextText: "PSR J0435+3233 is a hierarchical triple with a white dwarf and stellar tertiary.",
    parsedKeyHint: { surname: "Yang", year: 2026, firstInitial: null, suffix: "" }
  }, { adsApiToken: "token", citationKeyMode: "author-year", sourceProfile: "astrophysics" }, async (input) => {
    const url = new URL(String(input));
    if (url.host === "export.arxiv.org") {
      arxivQueries.push(url.searchParams.get("search_query"));
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2608.01227v1</id>
            <published>2026-08-02T13:19:44Z</published>
            <title>The PSR J0435+3233 Triple System</title>
            <summary>A hierarchical triple with a white-dwarf inner binary and a distant stellar tertiary.</summary>
            <author><name>Z. L. Yang</name></author>
            <category term="astro-ph.HE"/>
          </entry>
        </feed>`);
    }
    const query = url.searchParams.get("q");
    if (!query.startsWith("identifier:")) {
      adsQueries.push(query);
    }
    return okResponse([]);
  });

  assert.equal(results[0].eprint, "2608.01227");
  assert.equal(adsQueries.length, 2);
  assert.equal(arxivQueries.length, 1);
  assert.match(arxivQueries[0], /au:"Yang"/);
  assert.match(arxivQueries[0], /PSR J0435\+3233/);
});

test("searchAds duplicate merge keeps the refereed ADS paper over software records", async () => {
  const results = await searchAds(
    {
      token: "Foreman-Mackey2013",
      searchMode: "contextual",
      sentenceText: "emcee: The MCMC Hammer is used for affine invariant MCMC.",
      contextText: "emcee MCMC Hammer affine invariant ensemble sampler astronomy.",
      parsedKeyHint: { surname: "Foreman-Mackey", year: 2013, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "astrophysics",
      adsApiToken: "token",
      citationKeyMode: "authoryear"
    },
    async () => okResponse([
      makeDoc("2013ascl.soft03002F", {
        title: "emcee: The MCMC Hammer",
        author: ["Foreman-Mackey, Daniel", "Conley, Alex"],
        year: "2013",
        doi: "10.1086/670067",
        property: ["NONARTICLE"],
        doctype: "software",
        pub: "Astrophysics Source Code Library"
      }),
      makeDoc("2013PASP..125..306F", {
        title: "emcee: The MCMC Hammer",
        author: ["Foreman-Mackey, Daniel", "Hogg, David W."],
        year: "2013",
        doi: "10.1086/670067",
        property: ["REFEREED", "ARTICLE"],
        doctype: "article",
        pub: "Publications of the Astronomical Society of the Pacific"
      })
    ])
  );

  assert.equal(results[0].bibcode, "2013PASP..125..306F");
  assert.equal(results[0].pub, "Publications of the Astronomical Society of the Pacific");
});

test("searchLiterature can use a broad VS Code source without ADS", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "AlphaFold",
      searchMode: "direct",
      sentenceText: "AlphaFold predicts protein structure.",
      contextText: "AlphaFold predicts protein structure."
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      calls.push(String(input));
      assert.match(String(input), /api\.crossref\.org\/works/);
      return jsonResponse({
        message: {
          items: [
            {
              DOI: "10.1038/s41586-021-03819-2",
              title: ["Highly accurate protein structure prediction with AlphaFold"],
              author: [{ family: "Jumper", given: "John" }],
              issued: { "date-parts": [[2021]] },
              "container-title": ["Nature"],
              type: "journal-article",
              URL: "https://doi.org/10.1038/s41586-021-03819-2"
            }
          ]
        }
      });
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].generatedKey, "Jumper2021");
});

test("searchLiterature applies Context Beta in the production finalization path", async () => {
  const citationContext = {
    token: "Jumper2021",
    searchMode: "contextual",
    sentenceText: "AlphaFold predicts protein structure with high accuracy.",
    citationPrefixText: "AlphaFold predicts protein structure with high accuracy ",
    citationSuffixText: ".",
    contextText: "AlphaFold predicts protein structure with high accuracy.",
    parsedKeyHint: { surname: "Jumper", year: 2021, firstInitial: "", suffix: "" }
  };
  const baseSettings = {
    sourceProfile: "custom",
    primarySource: "crossref",
    fallbackSources: [],
    sourceApiTokens: {},
    citationKeyMode: "authoryear"
  };
  const fetchImpl = async () => jsonResponse({
    message: {
      items: [
        {
          DOI: "10.1038/s41586-021-03819-2",
          title: ["Highly accurate protein structure prediction with AlphaFold"],
          author: [{ family: "Jumper", given: "John" }],
          issued: { "date-parts": [[2021]] },
          "container-title": ["Nature"],
          type: "journal-article",
          URL: "https://doi.org/10.1038/s41586-021-03819-2"
        },
        {
          DOI: "10.5555/unrelated-jumper-2021",
          title: ["A separate benchmark by the same author"],
          author: [{ family: "Jumper", given: "John" }],
          issued: { "date-parts": [[2021]] },
          "container-title": ["Test Journal"],
          type: "journal-article",
          URL: "https://doi.org/10.5555/unrelated-jumper-2021"
        }
      ]
    }
  });

  const beta = await searchLiterature(citationContext, {
    ...baseSettings,
    contextualSearchEngine: "beta"
  }, fetchImpl);
  const classic = await searchLiterature(citationContext, {
    ...baseSettings,
    contextualSearchEngine: "classic"
  }, fetchImpl);

  assert.equal(beta[0].contextualBeta.modelVersion, "context-hybrid-4");
  assert.equal(beta[0].doi, "10.1038/s41586-021-03819-2");
  assert.equal(classic[0].contextualBeta, undefined);
});

test("Context Beta keeps generic collaboration identities while classic and Simple stay strict", async () => {
  const citationContext = {
    token: "Planck2020",
    searchMode: "contextual",
    sentenceText: "The Planck 2018 results. VI. Cosmological parameters paper constrains cosmology.",
    contextText: "The Planck 2018 results. VI. Cosmological parameters paper constrains cosmology.",
    parsedKeyHint: { surname: "Planck", year: 2020, firstInitial: "", suffix: "" }
  };
  const baseSettings = {
    sourceProfile: "custom",
    primarySource: "crossref",
    fallbackSources: [],
    sourceApiTokens: {},
    citationKeyMode: "authoryear"
  };
  const fetchImpl = async () => jsonResponse({
    message: {
      items: [
        namedCrossrefWork({
          doi: "10.5555/planck-collaboration-2020",
          title: "Planck 2018 results. VI. Cosmological parameters",
          author: "Planck Collaboration",
          year: 2020,
          abstract: "Planck cosmological parameters."
        }),
        namedCrossrefWork({
          doi: "10.5555/planckman-collaboration-2020",
          title: "Planckman stellar results",
          author: "Planckman Collaboration",
          year: 2020,
          abstract: "An unrelated result."
        }),
        {
          DOI: "10.5555/max-planck-2020",
          title: ["Max Planck annual report"],
          author: [{ family: "Planck", given: "Max" }],
          issued: { "date-parts": [[2020]] },
          abstract: "An unrelated report.",
          "container-title": ["Test Journal"],
          type: "journal-article",
          URL: "https://doi.org/10.5555/max-planck-2020"
        }
      ]
    }
  });

  const beta = await searchLiterature(citationContext, {
    ...baseSettings,
    contextualSearchEngine: "beta"
  }, fetchImpl);
  assert.ok(beta.some((candidate) => candidate.title === "Planck 2018 results. VI. Cosmological parameters"));
  assert.ok(beta.every((candidate) => candidate.title !== "Planckman stellar results"));

  const classic = await searchLiterature(citationContext, {
    ...baseSettings,
    contextualSearchEngine: "classic"
  }, fetchImpl);
  assert.ok(classic.every((candidate) => candidate.title !== "Planck 2018 results. VI. Cosmological parameters"));

  const simple = await searchLiterature({
    ...citationContext,
    searchMode: "simple"
  }, {
    ...baseSettings,
    contextualSearchEngine: "beta"
  }, fetchImpl);
  assert.ok(simple.every((candidate) => candidate.title !== "Planck 2018 results. VI. Cosmological parameters"));
});

test("Context Beta accepts Scientific Collaboration as an exact generic identity", async () => {
  const results = await searchLiterature(
    {
      token: "KATRIN2025",
      searchMode: "contextual",
      sentenceText: "The KATRIN neutrino-mass limit is used as the benchmark.",
      contextText: "The KATRIN neutrino-mass limit is used as the benchmark.",
      parsedKeyHint: { surname: "KATRIN", year: 2025, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async () => jsonResponse({
      message: {
        items: [
          namedCrossrefWork({
            doi: "10.5555/katrin-scientific-2025",
            title: "KATRIN neutrino-mass limit",
            author: "KATRIN Scientific Collaboration",
            year: 2025,
            abstract: "A neutrino-mass limit."
          }),
          namedCrossrefWork({
            doi: "10.5555/katrinman-scientific-2025",
            title: "Katrinman detector study",
            author: "Katrinman Scientific Collaboration",
            year: 2025,
            abstract: "An unrelated detector study."
          })
        ]
      }
    })
  );
  assert.equal(results[0].title, "KATRIN neutrino-mass limit");
  assert.ok(results.every((candidate) => candidate.title !== "Katrinman detector study"));
});

test("Context Beta does not let generic process wording overpower a matching QCD title", async () => {
  const results = await searchLiterature(
    {
      token: "Collins:1981uk",
      searchMode: "contextual",
      sentenceText: "With the help of factorization in quantum chromodynamics (QCD), the latter are used to empirically extract TMDs through global fitting.",
      citationPrefixText: "With the help of factorization in quantum chromodynamics (QCD), the latter are used to empirically extract TMDs through global fitting ",
      citationSuffixText: ".",
      contextText: "With the help of factorization in quantum chromodynamics (QCD), the latter are used to empirically extract TMDs through global fitting.",
      parsedKeyHint: { surname: "Collins", year: 1981, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.5555/collins-magnetization",
            title: "An investigation of the magnetization distribution and magnetization processes in symmetrical 90 degree NiFe chevron elements",
            authors: ["A. Collins", "M. Husni"],
            year: 1981,
            abstract: "An investigation of magnetization processes."
          }),
          crossrefWork({
            doi: "10.5555/collins-back-to-back",
            title: "Back-to-back jets in QCD",
            authors: ["John C. Collins", "Davison E. Soper"],
            year: 1981,
            abstract: "Back-to-back jets in quantum chromodynamics."
          })
        ]
      }
    })
  );

  assert.equal(results[0].title, "Back-to-back jets in QCD");
  assert.equal(results[0].authors[0], "Collins, John C.");
});

test("production VS Code beta search removes opaque RN identity filters and preserves typed insertion", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "RN3825",
      searchMode: "contextual",
      sentenceText: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation is widely used.",
      citationPrefixText: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation",
      citationSuffixText: ".",
      contextText: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation is widely used.",
      parsedKeyHint: { surname: "R", firstInitial: "N", year: 3825, suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: [],
      adsApiToken: "opaque-key-test",
      sourceApiTokens: { ads: "opaque-key-test" },
      contextualSearchEngine: "beta",
      citationKeyMode: "typed"
    },
    async (input) => {
      const query = new URL(String(input)).searchParams.get("q") ?? "";
      calls.push(query);
      return jsonResponse({ response: { docs: [
        {
          bibcode: "target-paper",
          title: ["Brain magnetic resonance imaging with contrast dependent on blood oxygenation"],
          author: ["Ogawa, Seiji"],
          year: "1990",
          abstract: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation."
        },
        {
          bibcode: "distractor-paper",
          title: ["A General Survey"],
          author: ["R, Nora"],
          year: "3825",
          abstract: "A general survey."
        }
      ] } });
    }
  );

  assert.ok(calls.length >= 1);
  assert.ok(calls.every((query) => !/RN3825|3825|first_author|author:/.test(query)), calls.join("\n"));
  assert.equal(results[0].bibcode, "target-paper");
  assert.equal(results[0].typedToken, "RN3825");
  assert.equal(results[0].generatedKey, "RN3825");
});

test("Context Beta searches broad primary and fallback sources concurrently and returns the first exact match", async () => {
  const calls = [];
  const started = Date.now();
  const results = await searchLiterature(
    {
      token: "Vaswani2017",
      searchMode: "contextual",
      sentenceText: "Attention Is All You Need is the target publication.",
      citationPrefixText: "Attention Is All You Need",
      citationSuffixText: ".",
      contextText: "Attention Is All You Need is the target publication.",
      parsedKeyHint: { surname: "Vaswani", year: 2017, firstInitial: "A", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [{
          DOI: "10.5555/attention",
          title: ["Attention Is All You Need"],
          author: [{ family: "Vaswani", given: "Ashish" }],
          issued: { "date-parts": [[2017]] },
          type: "proceedings-article"
        }] } });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return textResponse("<?xml version=\"1.0\"?><feed></feed>");
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].title, "Attention Is All You Need");
  assert.ok(calls.some((url) => url.startsWith("https://api.crossref.org/works")));
  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
  assert.ok(Date.now() - started < 120);
});

test("Context Beta supplements chemistry with arXiv without changing the chemistry preset", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Schutt2017",
      searchMode: "contextual",
      sentenceText: "SchNet A continuous-filter convolutional neural network for modeling quantum interactions is the target publication.",
      citationPrefixText: "SchNet A continuous-filter convolutional neural network for modeling quantum interactions",
      citationSuffixText: ".",
      contextText: "SchNet models quantum interactions.",
      parsedKeyHint: { surname: "Schutt", year: 2017, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "chemistry",
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [] } });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        assert.equal(new URL(url).searchParams.get("search_query"), 'ti:"SchNet A continuous-filter convolutional neural network for modeling quantum interactions"');
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/1706.08566v5</id>
              <published>2017-06-26T00:00:00Z</published>
              <title>SchNet: A continuous-filter convolutional neural network for modeling quantum interactions</title>
              <summary>A neural network for quantum interactions.</summary>
              <author><name>Kristof T. Schütt</name></author>
              <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="stat.ML"/>
            </entry>
          </feed>`);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.ok(calls.some((url) => url.startsWith("https://api.crossref.org/works")));
  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
  assert.equal(results[0].sourceId, "arxiv");
  assert.equal(results[0].title, "SchNet: A continuous-filter convolutional neural network for modeling quantum interactions");
});

test("Context Beta does not return an unrelated chemistry record when arXiv is rate limited", async () => {
  await assert.rejects(() => searchLiterature(
    {
      token: "Schutt2017",
      searchMode: "contextual",
      sentenceText: "SchNet: A continuous-filter convolutional neural network for modeling quantum interactions is the target publication.",
      citationPrefixText: "SchNet: A continuous-filter convolutional neural network for modeling quantum interactions",
      citationSuffixText: ".",
      contextText: "SchNet models quantum interactions.",
      parsedKeyHint: { surname: "Schutt", year: 2017, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "chemistry",
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [{
          DOI: "10.23919/epe17ecceeurope.2017.8099183",
          title: ["Design and analysis of complex vector current regulators for modular multilevel converters"],
          author: [{ family: "Schutt", given: "Michael" }],
          issued: { "date-parts": [[2017]] },
          type: "proceedings-article"
        }] } });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return statusResponse(429);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  ), /arXiv is rate limiting searches/);
});

test("direct DOI tokens containing arXiv-shaped numbers stay on the DOI route", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "doi:10.1234/2401.01234",
      searchMode: "direct",
      sentenceText: "A DOI containing an arXiv-shaped suffix.",
      contextText: "A DOI containing an arXiv-shaped suffix."
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://api.crossref.org/works/10.1234%2F2401.01234") {
        return jsonResponse({ message: {
          DOI: "10.1234/2401.01234",
          title: ["A DOI With a Numeric Suffix"],
          author: [{ family: "Example", given: "A." }],
          issued: { "date-parts": [[2024]] },
          type: "journal-article"
        } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].doi, "10.1234/2401.01234");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith("https://api.crossref.org/works/"));
});

test("Context Beta routes embedded arXiv identifiers to arXiv outside the configured profile", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Smith:2401.01234",
      searchMode: "contextual",
      sentenceText: "A contextual citation with an embedded arXiv identifier.",
      contextText: "A contextual citation with an embedded arXiv identifier.",
      parsedKeyHint: { surname: "Smith", year: 2024, suffix: "" }
    },
    {
      sourceProfile: "general",
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      assert.ok(url.startsWith("https://export.arxiv.org/api/query"));
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2401.01234v2</id>
            <published>2024-01-03T00:00:00Z</published>
            <title>Embedded identifier target</title>
            <summary>The exact identifier target.</summary>
            <author><name>Jane Smith</name></author>
          </entry>
        </feed>`);
    }
  );

  assert.equal(results[0].sourceId, "arxiv");
  assert.equal(results[0].eprint, "2401.01234");
  assert.equal(calls.length, 1);
});

test("Context Beta rejects an arXiv candidate whose embedded identifier is wrong", async () => {
  await assert.rejects(() => searchLiterature(
    {
      token: "abs-2410-05229",
      searchMode: "contextual",
      sentenceText: "A citation with an explicit arXiv identifier.",
      contextText: "A citation with an explicit arXiv identifier.",
      parsedKeyHint: { surname: "Smith", year: 2024, suffix: "" }
    },
    {
      sourceProfile: "general",
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/2410.09999v1</id>
              <published>2024-10-03T00:00:00Z</published>
              <title>Wrong identifier result</title>
              <summary>Not the requested work.</summary>
              <author><name>Smith, Example</name></author>
            </entry>
          </feed>`);
      }
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [crossrefWork({
          doi: "10.5555/2410.05229",
          title: "Wrong identifier result",
          authors: ["Smith Example"],
          year: 2024,
          abstract: "Not the requested work."
        })] } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  ), /No literature matches|failed/i);
});

test("Context Beta waits for ambiguous exact-title providers and keeps distinct given names visible", async () => {
  const started = Date.now();
  const results = await searchLiterature(
    {
      token: "Vaswani2024",
      searchMode: "contextual",
      sentenceText: "Shared Exact Title for a Provider Race is the target publication.",
      contextText: "Shared Exact Title for a Provider Race is the target publication.",
      parsedKeyHint: { surname: "Vaswani", year: 2024, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [{
          DOI: "10.5555/wrong-vaswani",
          title: ["Shared Exact Title for a Provider Race"],
          author: [{ family: "Vaswani", given: "Namrata" }],
          issued: { "date-parts": [[2024]] },
          type: "journal-article"
        }] } });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        await new Promise((resolve) => setTimeout(resolve, 140));
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/2401.01234v1</id>
              <published>2024-01-03T00:00:00Z</published>
              <title>Shared Exact Title for a Provider Race</title>
              <summary>The intended record.</summary>
              <author><name>Ashish Vaswani</name></author>
            </entry>
          </feed>`);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.ok(Date.now() - started >= 120);
  assert.equal(results.length, 2);
  assert.deepEqual(new Set(results.map((candidate) => candidate.authors[0])), new Set(["Vaswani, Namrata", "Ashish Vaswani"]));
});

test("Context Beta aborts a slower provider after an unambiguous exact-title result", async () => {
  let slowerProviderAborted = false;
  const started = Date.now();
  const results = await searchLiterature(
    {
      token: "AVaswani2024",
      searchMode: "contextual",
      sentenceText: "An Unambiguous Exact Provider Title is the target publication.",
      contextText: "An Unambiguous Exact Provider Title is the target publication.",
      parsedKeyHint: { surname: "Vaswani", year: 2024, firstInitial: "A", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input, options = {}) => {
      const url = String(input);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [{
          DOI: "10.5555/right-vaswani",
          title: ["An Unambiguous Exact Provider Title"],
          author: [{ family: "Vaswani", given: "Ashish" }],
          issued: { "date-parts": [[2024]] },
          type: "journal-article"
        }] } });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return new Promise((resolve, reject) => {
          const abort = () => {
            slowerProviderAborted = true;
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].doi, "10.5555/right-vaswani");
  assert.ok(Date.now() - started < 120);
  assert.equal(slowerProviderAborted, true);
});

test("VS Code bounds stalled provider response bodies with the overall literature deadline", async () => {
  const previousBudget = process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS;
  process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS = "50";
  let aborted = false;
  try {
    await assert.rejects(() => searchLiterature(
      {
        token: "BodyHang2024",
        searchMode: "contextual",
        sentenceText: "A stalled provider response body should time out.",
        contextText: "A stalled provider response body should time out.",
        parsedKeyHint: { surname: "BodyHang", year: 2024, firstInitial: "", suffix: "" }
      },
      {
        sourceProfile: "custom",
        primarySource: "crossref",
        fallbackSources: [],
        sourceApiTokens: {},
        citationKeyMode: "authoryear",
        contextualSearchEngine: "beta"
      },
      async (_input, options = {}) => {
        options.signal?.addEventListener("abort", () => {
          aborted = true;
        }, { once: true });
        return {
          ok: true,
          status: 200,
          headers: { get() { return null; } },
          json() { return new Promise(() => {}); }
        };
      }
    ), /Literature search timed out/);
    assert.equal(aborted, true);
  } finally {
    if (previousBudget === undefined) delete process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS;
    else process.env.OVERCITE_LITERATURE_SEARCH_BUDGET_MS = previousBudget;
  }
});

test("searchLiterature returns fast when a broad fallback has a high-confidence match", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "https://doi.org/10.1038/s41586-021-03819-2",
      searchMode: "direct",
      sentenceText: "AlphaFold predicts protein structure.",
      contextText: "AlphaFold predicts protein structure."
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: ["crossref", "arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
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
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return new Promise(() => {});
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.1038/s41586-021-03819-2");
  assert.ok(calls.some((url) => url.startsWith("https://api.crossref.org/works")));
});

test("searchLiterature stops simple title search after an exact primary match", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Attention Is All You Need",
      searchMode: "simple",
      sentenceText: "Attention Is All You Need introduced transformer architectures.",
      contextText: "Attention Is All You Need introduced transformer architectures.",
      parsedKeyHint: null
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/attention-journal",
                title: ["Attention Is All You Need"],
                author: [{ family: "Vaswani", given: "Ashish" }],
                issued: { "date-parts": [[2017]] },
                "container-title": ["NeurIPS"],
                "is-referenced-by-count": 6530,
                type: "proceedings-article",
                URL: "https://doi.org/10.5555/attention-journal"
              }
            ]
          }
        });
      }
      throw new Error(`Fallback should not be called for exact simple-title match: ${url}`);
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.5555/attention-journal");
  assert.equal(results[0].citationCount, 6530);
});

test("simple ADS-first search returns ADS results before broad fallbacks", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Godel1949",
      searchMode: "simple",
      sentenceText: "The Godel incompleteness paper should retrieve the Godel incompleteness paper.",
      contextText: "The Godel incompleteness paper should retrieve the Godel incompleteness paper.",
      parsedKeyHint: {
        surname: "Godel",
        year: 1949,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: ["crossref", "arxiv"],
      sourceApiTokens: { ads: "ads-token" },
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")) {
        return jsonResponse({
          response: {
            docs: [
              makeDoc("1949Godel", {
                title: "Godel incompleteness paper",
                author: ["Godel, Kurt"],
                year: "1949",
                abstract: "Godel incompleteness paper.",
                citation_count: 1200
              })
            ]
          }
        });
      }
      throw new Error(`Simple ADS-first lookup should not call fallback URL: ${url}`);
    }
  );

  assert.ok(calls.length >= 1);
  assert.equal(calls.every((url) => url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")), true);
  assert.equal(results[0].sourceId, "ads");
  assert.equal(results[0].generatedKey, "Godel1949");
});

test("simple search suppresses wrong-author Crossref fallbacks and can use arXiv when it is the only match", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Godel1949",
      searchMode: "simple",
      sentenceText: "The Godel incompleteness paper should retrieve the Godel incompleteness paper.",
      contextText: "The Godel incompleteness paper should retrieve the Godel incompleteness paper.",
      parsedKeyHint: {
        surname: "Godel",
        year: 1949,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: ["crossref", "arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/wrong-1949",
                title: ["Automatic Paper Chromatography"],
                author: [{ family: "Muller", given: "R. H." }],
                issued: { "date-parts": [[1949]] },
                "container-title": ["Chromatography"],
                "is-referenced-by-count": 151,
                type: "journal-article",
                URL: "https://doi.org/10.5555/wrong-1949"
              }
            ]
          }
        });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/math/4910001v1</id>
              <published>1949-10-01T00:00:00Z</published>
              <title>Godel incompleteness paper</title>
              <summary>Godel incompleteness paper.</summary>
              <author><name>Kurt Godel</name></author>
              <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="math.LO"/>
            </entry>
          </feed>`);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.ok(calls[0].startsWith("https://api.crossref.org/works"));
  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
  assert.equal(results[0].sourceId, "arxiv");
  assert.equal(results[0].generatedKey, "Godel1949");
  assert.equal(results.some((candidate) => candidate.title === "Automatic Paper Chromatography"), false);
});

test("simple fallback search returns a high-confidence earlier fallback without waiting for slower later fallbacks", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Attention Is All You Need",
      searchMode: "simple",
      sentenceText: "Attention Is All You Need introduced transformer architectures.",
      contextText: "Attention Is All You Need introduced transformer architectures.",
      parsedKeyHint: null
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: ["crossref", "arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/attention",
                title: ["Attention Is All You Need"],
                author: [{ family: "Vaswani", given: "Ashish" }],
                issued: { "date-parts": [[2017]] },
                "container-title": ["NeurIPS"],
                "is-referenced-by-count": 120000,
                type: "proceedings-article",
                URL: "https://doi.org/10.5555/attention"
              }
            ]
          }
        });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return new Promise(() => {});
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].title, "Attention Is All You Need");
  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
});

test("simple ranking prefers exact author-year citation count over wrong-year and wrong-author hits", async () => {
  const results = await searchLiterature(
    {
      token: "Godel1949",
      searchMode: "simple",
      sentenceText: "The Godel incompleteness paper should retrieve the Godel incompleteness paper.",
      contextText: "The Godel incompleteness paper should retrieve the Godel incompleteness paper.",
      parsedKeyHint: {
        surname: "Godel",
        year: 1949,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["ads"],
      sourceApiTokens: { ads: "ads-token" },
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/godel-1964",
                title: ["On Formally Undecidable Propositions of Principia Mathematica and Related Systems"],
                author: [{ family: "Godel", given: "Kurt" }],
                issued: { "date-parts": [[1964]] },
                "container-title": ["Collected Works"],
                "is-referenced-by-count": 11,
                type: "journal-article",
                URL: "https://doi.org/10.5555/godel-1964"
              }
            ]
          }
        });
      }
      if (url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")) {
        return jsonResponse({
          response: {
            docs: [
              makeDoc("1949GodelExact", {
                title: "An Example of a New Type of Cosmological Solutions of Einstein's Field Equations of Gravitation",
                author: ["Godel, Kurt"],
                year: "1949",
                abstract: "Exact Godel 1949 paper.",
                citation_count: 1116
              }),
              makeDoc("2016RichterWrong", {
                title: "Enhancing photoluminescence yields in lead halide perovskites by photon recycling and light out-coupling",
                author: ["Richter, Johannes M."],
                year: "2016",
                abstract: "Wrong author paper.",
                citation_count: 351
              })
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "ads");
  assert.equal(results[0].authors[0], "Godel, Kurt");
  assert.equal(results[0].year, 1949);
  assert.equal(results.some((candidate) => candidate.authors[0] === "Richter, Johannes M."), false);
  assert.ok(results.findIndex((candidate) => candidate.year === 1949) < results.findIndex((candidate) => candidate.year === 1964));
});

test("simple ranking uses sentence title evidence before citation counts for same author-year ADS hits", async () => {
  const results = await searchLiterature(
    {
      token: "Shariat2025",
      searchMode: "simple",
      sentenceText: "The Gaia resolved-triples paper should retrieve 10,000 Resolved Triples from Gaia.",
      contextText: "The Gaia resolved-triples paper \\citep{Shariat2025} should retrieve 10,000 Resolved Triples from Gaia.",
      parsedKeyHint: {
        surname: "Shariat",
        year: 2025,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: [],
      sourceApiTokens: { ads: "ads-token" },
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")) {
        return jsonResponse({
          response: {
            docs: [
              makeDoc("2025ShariatMerge", {
                title: "Once a Triple, Not Always a Triple: The Evolution of Hierarchical Triples That Yield Mergers",
                author: ["Shariat, Cheyanne"],
                year: "2025",
                abstract: "Hierarchical triples that yield mergers.",
                citation_count: 36
              }),
              makeDoc("2025ShariatGaia", {
                title: "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations",
                author: ["Shariat, Cheyanne", "El-Badry, Kareem", "Naoz, Smadar"],
                year: "2025",
                abstract: "A catalog of resolved triple star systems from Gaia.",
                citation_count: 22
              })
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.match(results[0].title, /10,000 Resolved Triples from Gaia/);
  assert.equal(results[0].citationCount, 22);
});

test("simple ranking uses sentence title evidence before high-citation same-author physics distractors", async () => {
  const results = await searchLiterature(
    {
      token: "Lu2024",
      searchMode: "simple",
      sentenceText: "The graphene fractional quantum anomalous Hall paper should retrieve Fractional quantum anomalous Hall effect in multilayer graphene.",
      contextText: "The graphene fractional quantum anomalous Hall paper \\citep{Lu2024} should retrieve Fractional quantum anomalous Hall effect in multilayer graphene.",
      parsedKeyHint: {
        surname: "Lu",
        year: 2024,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: [],
      sourceApiTokens: { ads: "ads-token" },
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")) {
        return jsonResponse({
          response: {
            docs: [
              makeDoc("2024LuToolbox", {
                title: "A comprehensive electron wavefunction analysis toolbox for chemists, Multiwfn",
                author: ["Lu, Tian"],
                year: "2024",
                abstract: "A highly cited toolbox.",
                citation_count: 1654
              }),
              makeDoc("2024LuGraphene", {
                title: "Fractional quantum anomalous Hall effect in multilayer graphene",
                author: ["Lu, Zhengguang", "Han, Tonghang"],
                year: "2024",
                abstract: "Fractional quantum anomalous Hall effect in multilayer graphene.",
                citation_count: 509
              })
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.match(results[0].title, /Fractional quantum anomalous Hall effect/);
  assert.equal(results[0].citationCount, 509);
});

test("simple ranking lets strong biology title context beat a weak first-author key match", async () => {
  const results = await searchLiterature(
    {
      token: "Doudna2012",
      searchMode: "simple",
      sentenceText: "The CRISPR-Cas9 paper should retrieve a programmable dual-RNA-guided DNA endonuclease.",
      contextText: "The CRISPR-Cas9 paper \\citep{Doudna2012} should retrieve a programmable dual-RNA-guided DNA endonuclease.",
      parsedKeyHint: {
        surname: "Doudna",
        year: 2012,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/doudna-distractor",
                title: ["Response of Terrestrial Arthropod Assemblages to Coastal Dune Restoration"],
                author: [{ family: "Doudna", given: "Example" }],
                issued: { "date-parts": [[2012]] },
                "container-title": ["Ecology"],
                "is-referenced-by-count": 3,
                type: "journal-article",
                URL: "https://doi.org/10.5555/doudna-distractor"
              },
              {
                DOI: "10.1126/science.1225829",
                title: ["A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity"],
                author: [
                  { family: "Jinek", given: "Martin" },
                  { family: "Chylinski", given: "Krzysztof" },
                  { family: "Doudna", given: "Jennifer A." }
                ],
                issued: { "date-parts": [[2012]] },
                "container-title": ["Science"],
                "is-referenced-by-count": 15410,
                type: "journal-article",
                URL: "https://doi.org/10.1126/science.1225829"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.match(results[0].title, /Programmable Dual-RNA/);
  assert.equal(results[0].generatedKey, "Jinek2012");
  assert.equal(results[0].citationCount, 15410);
});

test("simple pre-arXiv Crossref hit does not wait for arXiv fallback", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Godel1949",
      searchMode: "simple",
      sentenceText: "The Godel incompleteness paper should retrieve the formally undecidable propositions paper.",
      contextText: "The Godel incompleteness paper \\citep{Godel1949} should retrieve the formally undecidable propositions paper.",
      parsedKeyHint: {
        surname: "Godel",
        year: 1949,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/godel-1964",
                title: ["On Formally Undecidable Propositions of Principia Mathematica and Related Systems"],
                author: [{ family: "Godel", given: "Kurt" }],
                issued: { "date-parts": [[1964]] },
                "container-title": ["Collected Works"],
                "is-referenced-by-count": 11,
                type: "journal-article",
                URL: "https://doi.org/10.5555/godel-1964"
              }
            ]
          }
        });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return new Promise(() => {});
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].generatedKey, "Godel1964");
  assert.equal(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")), false);
});

test("simple modern wrong-year Crossref title waits for arXiv fallback", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Vaswani2017",
      searchMode: "simple",
      sentenceText: "The Transformer paper should retrieve Attention Is All You Need.",
      contextText: "The Transformer paper \\citep{Vaswani2017} should retrieve Attention Is All You Need.",
      parsedKeyHint: {
        surname: "Vaswani",
        year: 2017,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/attention-reprint",
                title: ["Attention Is All You Need"],
                author: [{ family: "Vaswani", given: "Ashish" }],
                issued: { "date-parts": [[2025]] },
                "container-title": ["Reprint Collection"],
                "is-referenced-by-count": 53,
                type: "journal-article",
                URL: "https://doi.org/10.5555/attention-reprint"
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
              <summary>Transformer architecture.</summary>
              <author><name>Ashish Vaswani</name></author>
              <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
            </entry>
          </feed>`);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "arxiv");
  assert.equal(results[0].year, 2017);
  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
});

test("searchLiterature falls back when a long title lead only matches a short prefix", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Gaia2018",
      searchMode: "contextual",
      sentenceText: "Gaia Data Release 2. Summary of the contents and survey properties is the paper cited here.",
      contextText: "Gaia Data Release 2 astrometry survey contents properties.",
      parsedKeyHint: { surname: "Gaia", year: 2018, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              crossrefWork({
                doi: "10.1051/0004-6361/201832843",
                title: "Gaia Data Release 2",
                authors: ["Gaia Collaboration"],
                year: 2018,
                abstract: "A related Gaia DR2 paper."
              })
            ]
          }
        });
      }
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/1804.09365v2</id>
              <published>2018-04-25T00:00:00Z</published>
              <title>Gaia Data Release 2. Summary of the contents and survey properties</title>
              <summary>Gaia DR2 contents and survey properties.</summary>
              <author><name>Gaia Collaboration</name></author>
              <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1051/0004-6361/201833051</arxiv:doi>
              <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.GA"/>
            </entry>
          </feed>`);
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
  assert.equal(results[0].title, "Gaia Data Release 2. Summary of the contents and survey properties");
  assert.equal(results[0].eprint, "1804.09365");
});

test("searchLiterature routes dataset-like contextual lookups to DataCite first", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Horst2020",
      searchMode: "contextual",
      sentenceText: "The Palmer penguins dataset is used for ecology examples.",
      contextText: "Palmer penguins dataset repository citation.",
      parsedKeyHint: { surname: "Horst", year: 2020, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "broad",
      primarySource: "crossref",
      fallbackSources: ["arxiv", "pubmed", "datacite"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      assert.match(url, /api\.datacite\.org\/dois/);
      return jsonResponse({
        data: [
          {
            id: "10.5281/zenodo.3960218",
            attributes: {
              doi: "10.5281/zenodo.3960218",
              titles: [{ title: "allisonhorst/palmerpenguins: v0.1.0" }],
              creators: [{ name: "Horst, Allison M." }],
              publicationYear: 2020,
              publisher: "Zenodo",
              types: { resourceTypeGeneral: "Software" },
              url: "https://zenodo.org/record/3960218"
            }
          }
        ]
      });
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(results[0].sourceId, "datacite");
  assert.equal(results[0].doi, "10.5281/zenodo.3960218");
});

test("broad ranking prefers true first-author family matches over middle-name substring matches", async () => {
  const results = await searchLiterature(
    {
      token: "Shariat2025",
      searchMode: "contextual",
      sentenceText: "Triple star systems are common in Gaia \\citep{Shariat2025}.",
      contextText: "Resolved triples from Gaia constrain triple star populations.",
      parsedKeyHint: { surname: "Shariat", year: 2025, firstInitial: null, suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.5555/shariat-distractor",
            title: "Triple Star Systems from Gaia with a Middle-Name Author Match",
            authors: ["Davoud Shariat Panah", "Second Author"],
            year: 2025,
            abstract: "Triple star systems in Gaia."
          }),
          crossrefWork({
            doi: "10.5555/shariat-triples",
            title: "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations",
            authors: ["Cheyanne Shariat", "Kareem El-Badry"],
            year: 2025,
            abstract: "Resolved triples from Gaia constrain triple star populations."
          })
        ]
      }
    })
  );

  assert.equal(results[0].title, "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations");
  assert.equal(results[0].authors[0], "Shariat, Cheyanne");
});

test("broad ranking honors first initials for common surnames like LiM25", async () => {
  const results = await searchLiterature(
    {
      token: "LiM25",
      searchMode: "contextual",
      sentenceText: "Optical afterglows of gamma ray bursts are discussed in \\citep{LiM25}.",
      contextText: "Optical afterglows of gamma ray bursts.",
      parsedKeyHint: { surname: "Li", year: 2025, firstInitial: "M", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.5555/li-jinda",
            title: "Multiple Rebrightenings in the Optical Afterglow of a Gamma-Ray Burst",
            authors: ["Jin-Da Li", "Second Author"],
            year: 2025,
            abstract: "Optical afterglow of a gamma-ray burst."
          }),
          crossrefWork({
            doi: "10.5555/li-maggie",
            title: "The Nature of Optical Afterglows without Gamma-Ray Bursts",
            authors: ["Maggie L. Li", "Anna Ho"],
            year: 2025,
            abstract: "Optical afterglows without detected gamma-ray bursts."
          })
        ]
      }
    })
  );

  assert.equal(results[0].title, "The Nature of Optical Afterglows without Gamma-Ray Bursts");
  assert.equal(results[0].authors[0], "Li, Maggie L.");
});

test("broad ranking uses contextual title leads over same-author distractors", async () => {
  const results = await searchLiterature(
    {
      token: "Press1974",
      searchMode: "contextual",
      sentenceText: "Formation of Galaxies and Clusters of Galaxies by Self-Similar Gravitational Condensation is the target publication.",
      contextText: "The Press-Schechter halo mass function is central to structure formation.",
      parsedKeyHint: { surname: "Press", year: 1974, firstInitial: null, suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.5555/press-black-hole",
            title: "Perturbations of a rotating black hole",
            authors: ["William H. Press"],
            year: 1974,
            abstract: "Black hole perturbations and radiation."
          }),
          crossrefWork({
            doi: "10.5555/press-schechter",
            title: "Formation of Galaxies and Clusters of Galaxies by Self-Similar Gravitational Condensation",
            authors: ["William H. Press", "Paul Schechter"],
            year: 1974,
            abstract: "Halo mass function and structure formation."
          })
        ]
      }
    })
  );

  assert.equal(results[0].title, "Formation of Galaxies and Clusters of Galaxies by Self-Similar Gravitational Condensation");
});

test("broad ranking keeps exact author-year matches above wrong-year title matches", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Godel1931",
      searchMode: "contextual",
      sentenceText: "The Godel incompleteness paper should retrieve the formally undecidable propositions paper.",
      contextText: "Godel incompleteness theorem formally undecidable propositions Principia Mathematica.",
      parsedKeyHint: { surname: "Godel", year: 1931, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.searchParams.get("query.title") === "formal unentscheidbare satze principia mathematica") {
        return jsonResponse({
          message: {
            items: [
              crossrefWork({
                doi: "10.5555/godel-1931",
                title: "Uber formal unentscheidbare Satze der Principia Mathematica und verwandter Systeme I",
                authors: ["Kurt Godel"],
                year: 1931,
                abstract: "The original incompleteness paper on formal undecidability."
              })
            ]
          }
        });
      }
      if (url.searchParams.get("query.author") === "Godel" && String(url.searchParams.get("filter") ?? "").includes("from-pub-date:1931")) {
        return jsonResponse({
          message: {
            items: [
              crossrefWork({
                doi: "10.5555/godel-other-1931",
                title: "Die Grundlagenkrisis der griechischen Mathematik",
                authors: ["Kurt Godel"],
                year: 1931,
                abstract: "A different 1931 Godel record."
              })
            ]
          }
        });
      }
      return jsonResponse({
        message: {
          items: [
            crossrefWork({
              doi: "10.5555/godel-translation",
              title: "<i>On Formally Undecidable Propositions of Principia Mathematica and Related Systems</i>",
              authors: ["Kurt Godel", "B. Meltzer"],
              year: 1964,
              abstract: "Formally undecidable propositions of Principia Mathematica and related systems."
            })
          ]
        }
      });
    }
  );

  assert.equal(results[0].doi, "10.5555/godel-1931");
  assert.equal(results[0].title, "Uber formal unentscheidbare Satze der Principia Mathematica und verwandter Systeme I");
  assert.ok(calls.some((url) => url.searchParams.get("query.title") === "formal unentscheidbare satze principia mathematica"));
  assert.ok(calls.some((url) => url.searchParams.get("query.author") === "Godel"));
  assert.equal(results.find((result) => result.doi === "10.5555/godel-translation")?.title, "On Formally Undecidable Propositions of Principia Mathematica and Related Systems");
});

test("broad ranking lets an explicit exact title beat weak author-year coincidences", async () => {
  const results = await searchLiterature(
    {
      token: "Shannon1948",
      searchMode: "contextual",
      sentenceText: "A Mathematical Theory of Communication is discussed as the target paper.",
      contextText: "Information theory Bell System Technical Journal Shannon 1948.",
      parsedKeyHint: { surname: "Shannon", year: 1948, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.1215/00382876-47-4-459",
            title: "A Political Philosophy for an Industrial South",
            authors: ["J. B. Shannon"],
            year: 1948
          }),
          crossrefWork({
            doi: "10.1002/j.1538-7305.1948.tb01338.x",
            title: "A Mathematical Theory of Communication",
            authors: ["C. E. Shannon"],
            year: 2001
          })
        ]
      }
    })
  );

  assert.equal(results[0].doi, "10.1002/j.1538-7305.1948.tb01338.x");
});

test("direct title-year search ranks exact title and year above partial-title distractors", async () => {
  const results = await searchLiterature(
    {
      token: "Nonparametric Estimation from Incomplete Observations 1958",
      searchMode: "direct",
      sentenceText: "",
      contextText: "",
      parsedKeyHint: null
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.1080/01621459.1976.10480966",
            title: "Nonparametric Bayesian Estimation of Survival Curves from Incomplete Observations",
            authors: ["V. Susarla"],
            year: 1976
          }),
          crossrefWork({
            doi: "10.1007/978-1-4612-4380-9_25",
            title: "Nonparametric Estimation from Incomplete Observations",
            authors: ["E. L. Kaplan", "Paul Meier"],
            year: 1958
          })
        ]
      }
    })
  );

  assert.equal(results[0].doi, "10.1007/978-1-4612-4380-9_25");
});

test("surname-only broad contextual search keeps author matches above context-only matches", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Kivelson",
      searchMode: "contextual",
      sentenceText: "Critical phenomena and renormalization-group theory are reviewed in this section.",
      contextText: "Critical phenomena renormalization group scaling superconductivity.",
      parsedKeyHint: { surname: "Kivelson", year: null, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.searchParams.get("query.author") === "Kivelson") {
        return jsonResponse({
          message: {
            items: [
              crossrefWork({
                doi: "10.5555/kivelson-superconductivity",
                title: "Making high-temperature superconductors work",
                authors: ["Steven A. Kivelson", "Eduardo Fradkin"],
                year: 2003,
                abstract: "Strongly correlated superconductivity and critical fluctuations."
              })
            ]
          }
        });
      }
      return jsonResponse({
        message: {
          items: [
            crossrefWork({
              doi: "10.1016/s0370-1573(02)00219-3",
              title: "Critical phenomena and renormalization-group theory",
              authors: ["Andrea Pelissetto", "Ettore Vicari"],
              year: 2002,
              abstract: "Critical phenomena and renormalization-group theory."
            })
          ]
        }
      });
    }
  );

  assert.equal(results[0].authors[0], "Kivelson, Steven A.");
  assert.equal(results[0].doi, "10.5555/kivelson-superconductivity");
  assert.ok(calls.some((url) => url.searchParams.get("query.author") === "Kivelson"));
});

test("life sciences contextual search can use a senior coauthor key like Doudna12", async () => {
  const results = await searchLiterature(
    {
      token: "Doudna12",
      searchMode: "contextual",
      sentenceText: "RNA-guided genome editing uses CRISPR-Cas9 as described by Doudna and colleagues.",
      contextText: "Programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity CRISPR Cas9 Doudna Charpentier Jinek 2012 Science.",
      parsedKeyHint: { surname: "Doudna", year: 2012, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "life-sciences",
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
        return jsonResponse({ esearchresult: { idlist: ["22745249"] } });
      }
      if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
        return jsonResponse({
          result: {
            uids: ["22745249"],
            22745249: {
              uid: "22745249",
              title: "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity.",
              pubdate: "2012 Aug 17",
              fulljournalname: "Science",
              authors: [
                { name: "Jinek M" },
                { name: "Chylinski K" },
                { name: "Fonfara I" },
                { name: "Hauer M" },
                { name: "Doudna JA" },
                { name: "Charpentier E" }
              ],
              articleids: [{ idtype: "doi", value: "10.1126/science.1225829" }]
            }
          }
        });
      }
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.3368/er.30.1.20",
                title: ["Response of Terrestrial Arthropod Assemblages to Coastal Dune Restoration"],
                author: [{ family: "Doudna", given: "J. W." }],
                issued: { "date-parts": [[2012]] },
                "container-title": ["Ecological Restoration"],
                type: "journal-article",
                URL: "https://doi.org/10.3368/er.30.1.20"
              }
            ]
          }
        });
      }
      return jsonResponse({ message: { items: [] }, data: [] });
    }
  );

  assert.equal(results[0].doi, "10.1126/science.1225829");
  assert.equal(results[0].generatedKey, "Jinek2012");
});

test("life sciences direct search supports old PubMed records with no parsed authors", async () => {
  const results = await searchLiterature(
    {
      token: "PMID:18890300",
      searchMode: "direct",
      sentenceText: "STREPTOMYCIN treatment of pulmonary tuberculosis.",
      contextText: "The 1948 streptomycin tuberculosis randomized trial.",
      parsedKeyHint: null
    },
    {
      sourceProfile: "life-sciences",
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
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
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({ message: { items: [] } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "pubmed");
  assert.equal(results[0].title, "STREPTOMYCIN treatment of pulmonary tuberculosis.");
  assert.equal(results[0].authors.length, 0);
  assert.equal(results[0].year, 1948);
});

test("direct arXiv URLs are not misread as PubMed identifiers in mixed source settings", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "https://arxiv.org/abs/1706.03762",
      searchMode: "direct",
      sentenceText: "",
      contextText: "",
      parsedKeyHint: null
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: ["arxiv", "pubmed"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.host === "export.arxiv.org") {
        assert.equal(url.searchParams.get("id_list"), "1706.03762");
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
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "arxiv");
  assert.equal(results[0].eprint, "1706.03762");
  assert.equal(calls.length, 1);
});

test("broad ranking keeps strong first-author context above related coauthor matches", async () => {
  const results = await searchLiterature(
    {
      token: "Doudna14",
      searchMode: "contextual",
      sentenceText: "CRISPR-Cas9 genome engineering became broadly programmable after Doudna14.",
      contextText: "The new frontier of genome engineering with CRISPR-Cas9 Doudna Charpentier Science 2014.",
      parsedKeyHint: { surname: "Doudna", year: 2014, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.7554/elife.04766",
            title: "Enhanced homology-directed human genome engineering by controlled timing of CRISPR/Cas9 delivery",
            authors: ["Steven Lin", "Brett Staahl", "Jennifer Doudna"],
            year: 2014,
            abstract: "CRISPR Cas9 genome engineering."
          }),
          crossrefWork({
            doi: "10.1126/science.1258096",
            title: "The new frontier of genome engineering with CRISPR-Cas9",
            authors: ["Jennifer Doudna", "Emmanuelle Charpentier"],
            year: 2014,
            abstract: "CRISPR Cas9 genome engineering."
          })
        ]
      }
    })
  );

  assert.equal(results[0].doi, "10.1126/science.1258096");
});

test("broad ranking demotes non-paper provider records below journal articles", async () => {
  const results = await searchLiterature(
    {
      token: "El-Badry2023",
      searchMode: "contextual",
      sentenceText: "A Sun-like star orbiting a black hole is the target publication.",
      contextText: "The closest black hole is a Sun-like star orbiting a black hole in Gaia.",
      parsedKeyHint: { surname: "El-Badry", year: 2023, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.5555/elbadry-proposal",
            title: "Dormant black holes and neutron stars in stellar binaries",
            authors: ["Kareem El-Badry"],
            year: 2023,
            abstract: "Black holes and neutron stars in stellar binaries with Gaia constraints.",
            type: "grant",
            journal: "NSF Award"
          }),
          crossrefWork({
            doi: "10.1093/mnras/stac3140",
            title: "A Sun-like star orbiting a black hole",
            authors: ["Kareem El-Badry", "Hans-Walter Rix"],
            year: 2023,
            abstract: "A Sun-like star orbiting a black hole discovered using Gaia.",
            type: "journal-article",
            journal: "Monthly Notices of the Royal Astronomical Society"
          })
        ]
      }
    })
  );

  assert.equal(results[0].doi, "10.1093/mnras/stac3140");
});

test("broad ranking does not suppress real proceedings articles", async () => {
  const results = await searchLiterature(
    {
      token: "Vaswani2017",
      searchMode: "contextual",
      sentenceText: "Attention Is All You Need introduced transformer architectures.",
      contextText: "Transformer architectures use attention for sequence modeling.",
      parsedKeyHint: { surname: "Vaswani", year: 2017, firstInitial: "", suffix: "" }
    },
    {
      sourceProfile: "custom",
      primarySource: "crossref",
      fallbackSources: [],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async () => jsonResponse({
      message: {
        items: [
          crossrefWork({
            doi: "10.5555/attention-proceedings",
            title: "Attention Is All You Need",
            authors: ["Ashish Vaswani", "Noam Shazeer"],
            year: 2017,
            abstract: "Transformer architectures use attention for sequence modeling.",
            type: "proceedings-article",
            journal: "Advances in Neural Information Processing Systems"
          }),
          crossrefWork({
            doi: "10.5555/attention-poster",
            title: "Attention Is All You Need Poster Abstract",
            authors: ["Ashish Vaswani", "Noam Shazeer"],
            year: 2017,
            abstract: "Transformer architectures use attention for sequence modeling.",
            type: "abstract",
            journal: "Machine Learning Meeting Abstracts"
          })
        ]
      }
    })
  );

  assert.equal(results[0].doi, "10.5555/attention-proceedings");
});

test("broad ranking boosts records confirmed by multiple sources and preserves journal metadata", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Attention Is All You Need",
      searchMode: "simple",
      sentenceText: "Attention Is All You Need introduced transformer architectures.",
      contextText: "Transformer architectures use attention.",
      parsedKeyHint: null
    },
    {
      sourceProfile: "custom",
      primarySource: "arxiv",
      fallbackSources: ["crossref"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://export.arxiv.org/api/query")) {
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
      }
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/attention-journal",
                title: ["Attention Is All You Need"],
                author: [{ family: "Vaswani", given: "Ashish" }],
                issued: { "date-parts": [[2017]] },
                "container-title": ["NeurIPS"],
                "is-referenced-by-count": 6530,
                type: "proceedings-article",
                URL: "https://doi.org/10.5555/attention-journal"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
  assert.ok(calls.some((url) => url.startsWith("https://api.crossref.org/works")));
  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.5555/attention-journal");
  assert.equal(results[0].eprint, "1706.03762");
  assert.equal(results[0].citationCount, 6530);
  assert.match(results[0].sourceLabel, /Crossref/);
  assert.match(results[0].sourceLabel, /arXiv/);
});

test("arXiv simple results can be enriched with ADS citation counts", async () => {
  const calls = [];
  let readyCandidates;
  const results = await searchLiterature(
    {
      token: "Vaswani2017",
      searchMode: "simple",
      sentenceText: "Attention Is All You Need introduced the Transformer architecture.",
      contextText: "Attention Is All You Need introduced the Transformer architecture.",
      parsedKeyHint: {
        surname: "Vaswani",
        year: 2017,
        firstInitial: null,
        suffix: ""
      }
    },
    {
      sourceProfile: "custom",
      primarySource: "arxiv",
      fallbackSources: [],
      sourceApiTokens: { ads: "token" },
      adsApiToken: "token",
      citationKeyMode: "authoryear",
      bibliographyInsertMode: "append"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
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
      if (url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")) {
        assert.ok(readyCandidates?.length, "publish final ranking before requesting optional counts");
        assert.equal(readyCandidates[0].eprint, "1706.03762");
        await new Promise((resolve) => setTimeout(resolve, 25));
        const query = new URL(url).searchParams.get("q") ?? "";
        assert.match(query, /identifier:"1706\.03762"/);
        return okResponse([
          makeDoc("2017arXiv170603762V", {
            title: "Attention Is All You Need",
            author: ["Vaswani, Ashish", "Shazeer, Noam"],
            year: "2017",
            doi: "10.48550/arxiv.1706.03762",
            identifier: ["arXiv:1706.03762"],
            citation_count: 98765
          })
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    (candidates) => { readyCandidates = candidates; }
  );

  assert.ok(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")));
  assert.ok(calls.some((url) => url.startsWith("https://api.adsabs.harvard.edu/v1/search/query")));
  assert.equal(results[0].sourceLabel, "arXiv");
  assert.equal(results[0].eprint, "1706.03762");
  assert.equal(results[0].citationCount, 98765);
  assert.deepEqual(results.map(({ citationCount, ...candidate }) => candidate), readyCandidates.map(({ citationCount, ...candidate }) => candidate));
});

test("arXiv-primary presets try Crossref first for pre-arXiv papers", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "Turing1936",
      searchMode: "contextual",
      sentenceText: "On Computable Numbers, with an Application to the Entscheidungsproblem is the target publication.",
      contextText: "On Computable Numbers, with an Application to the Entscheidungsproblem is a foundational computer science paper.",
      parsedKeyHint: {
        surname: "Turing",
        year: 1936,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "computer-science",
      primarySource: "arxiv",
      fallbackSources: ["crossref"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.1112/plms/s2-42.1.230",
                title: ["On Computable Numbers, with an Application to the Entscheidungsproblem"],
                author: [{ family: "Turing", given: "A. M." }],
                issued: { "date-parts": [[1936]] },
                "container-title": ["Proceedings of the London Mathematical Society"],
                type: "journal-article",
                URL: "https://doi.org/10.1112/plms/s2-42.1.230"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.ok(calls[0].startsWith("https://api.crossref.org/works"));
  assert.equal(calls.some((url) => url.startsWith("https://export.arxiv.org/api/query")), false);
  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.1112/plms/s2-42.1.230");
});

test("contextual broad search keeps exact title-year matches for collaboration keys", async () => {
  const calls = [];
  const results = await searchLiterature(
    {
      token: "ATLAS2024",
      searchMode: "contextual",
      sentenceText: "Observation of quantum entanglement with top quarks at the ATLAS detector is the target publication.",
      contextText: "ATLAS Collaboration quantum entanglement top quarks detector.",
      parsedKeyHint: {
        surname: "ATLAS",
        year: 2024,
        firstInitial: "",
        suffix: ""
      }
    },
    {
      sourceProfile: "physics",
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      contextualSearchEngine: "beta"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://inspirehep.net")) {
        throw new Error(`Physics preset should not call INSPIRE: ${url}`);
      }
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.1038/s41586-024-07824-z",
                title: ["Observation of quantum entanglement with top quarks at the ATLAS detector"],
                author: [{ family: "Aad", given: "G." }],
                issued: { "date-parts": [[2024]] },
                "container-title": ["Nature"],
                type: "journal-article",
                URL: "https://doi.org/10.1038/s41586-024-07824-z"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(calls.some((url) => url.startsWith("https://inspirehep.net")), false);
  assert.ok(calls.some((url) => url.startsWith("https://api.crossref.org/works")));
  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.1038/s41586-024-07824-z");
});

test("broad ranking keeps arXiv-only matches below comparable non-arXiv records", async () => {
  const results = await searchLiterature(
    {
      token: "Shared Benchmark Title",
      searchMode: "simple",
      sentenceText: "Shared Benchmark Title is the target work.",
      contextText: "Shared Benchmark Title benchmark ranking.",
      parsedKeyHint: null
    },
    {
      sourceProfile: "custom",
      primarySource: "arxiv",
      fallbackSources: ["crossref"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      if (url.startsWith("https://export.arxiv.org/api/query")) {
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/2601.00001v1</id>
              <published>2026-01-01T00:00:00Z</published>
              <title>Shared Benchmark Title</title>
              <summary>Preprint-only abstract.</summary>
              <author><name>Preprint Author</name></author>
            </entry>
          </feed>`);
      }
      if (url.startsWith("https://api.crossref.org/works")) {
        return jsonResponse({
          message: {
            items: [
              {
                DOI: "10.5555/shared-benchmark",
                title: ["Shared Benchmark Title"],
                author: [{ family: "Journal", given: "Author" }],
                issued: { "date-parts": [[2026]] },
                "container-title": ["Journal of Benchmarks"],
                type: "journal-article",
                URL: "https://doi.org/10.5555/shared-benchmark"
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  );

  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.5555/shared-benchmark");
});

test("direct DOI fallback ignores one registry 404 and returns another registry match", async () => {
  const results = await searchLiterature(
    {
      token: "doi:10.1023/a:1026654312961",
      searchMode: "direct",
      sentenceText: "The Large-N Limit of superconformal field theories is the target publication.",
      contextText: "The Large-N Limit of superconformal field theories is the target publication."
    },
    {
      sourceProfile: "custom",
      primarySource: "datacite",
      fallbackSources: ["crossref"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
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
    }
  );

  assert.equal(results[0].sourceId, "crossref");
  assert.equal(results[0].doi, "10.1023/a:1026654312961");
});

test("arXiv-only search ranks prior-year first-author preprints over same-year coauthor matches", async () => {
  const results = await searchLiterature(
    {
      token: "Foreman-Mackey2013",
      searchMode: "contextual",
      parsedKeyHint: { surname: "Foreman-Mackey", year: 2013, firstInitial: null, suffix: "" },
      sentenceText: "The emcee sampler is widely used for affine-invariant MCMC.",
      contextText: "The emcee sampler is widely used for affine-invariant MCMC."
    },
    {
      sourceProfile: "arxiv-only",
      sourceApiTokens: {},
      citationKeyMode: "authoryear",
      bibliographyInsertMode: "append"
    },
    async (input) => {
      const url = String(input);
      if (!url.startsWith("https://export.arxiv.org/api/query")) {
        throw new Error(`Unexpected URL ${url}`);
      }
      const query = new URL(url).searchParams.get("search_query") ?? "";
      if (query.includes("201301010000")) {
        return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/1310.4179v1</id>
              <published>2013-10-15T00:00:00Z</published>
              <title>A coauthored 2013 arXiv paper</title>
              <summary>Andromeda disk stars.</summary>
              <author><name>Claire Dorman</name></author>
              <author><name>Daniel Foreman-Mackey</name></author>
            </entry>
          </feed>`);
      }
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
          </entry>
        </feed>`);
    }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].title, "emcee: The MCMC Hammer");
  assert.equal(results[0].eprint, "1202.3665");
});

test("exportBibtex emits broad candidate BibTeX without an ADS token", async () => {
  const bibtex = await exportBibtex({
    generatedKey: "Jumper2021",
    title: "Highly accurate protein structure prediction with AlphaFold",
    authors: ["Jumper, John"],
    year: 2021,
    journal: "Nature",
    doi: "10.1038/s41586-021-03819-2",
    type: "journal-article"
  }, {
    sourceProfile: "life-sciences",
    citationKeyMode: "authoryear"
  });

  assert.match(bibtex, /^@article\{Jumper2021,/);
  assert.match(bibtex, /doi = \{10.1038\/s41586-021-03819-2\}/);
});

function okResponse(docs) {
  return {
    ok: true,
    async json() {
      return { response: { docs } };
    }
  };
}

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

function makeDoc(bibcode, overrides = {}) {
  return {
    bibcode,
    title: [overrides.title ?? `Candidate ${bibcode}`],
    author: overrides.author ?? ["Shariat, Cheyanne"],
    year: overrides.year ?? "2025",
    abstract: overrides.abstract ?? "Resolved triples from Gaia constrain triple star populations.",
    doi: [overrides.doi ?? `10.1234/${bibcode}`],
    identifier: overrides.identifier,
    property: overrides.property,
    doctype: overrides.doctype,
    pub: overrides.pub,
    bibstem: overrides.bibstem,
    database: overrides.database,
    citation_count: overrides.citation_count
  };
}

test("beta broad ranking gives exact collaboration identities the same author score as personal names", async () => {
  const context = {
    token: "Aurora2020", searchMode: "contextual",
    parsedKeyHint: { surname: "Aurora", year: 2020, suffix: "" },
    sentenceText: "The Aurora cosmology paper constrains cosmological parameters.",
    contextText: "The Aurora cosmology paper constrains cosmological parameters."
  };
  const items = [
    namedCrossrefWork({ doi: "10.5555/personal", title: "Sea Ice Mass Balance", author: "Aurora, Cameron", year: 2020 }),
    namedCrossrefWork({ doi: "10.5555/group", title: "Aurora 2018 results", author: "Aurora Collaboration", year: 2020, abstract: "We present cosmological parameters from cosmic microwave background observations." })
  ];
  const result = await searchLiterature(context, {
    sourceProfile: "custom", primarySource: "crossref", fallbackSources: [],
    contextualSearchEngine: "beta", sourceApiTokens: {}, citationKeyMode: "authoryear"
  }, async () => jsonResponse({ message: { items } }));
  assert.equal(result[0].doi, "10.5555/group");
});

test("beta broad ranking does not demote a more topical preprint solely for publication format", async () => {
  const context = {
    token: "Smith2024", searchMode: "contextual",
    parsedKeyHint: { surname: "Smith", year: 2024, suffix: "" },
    sentenceText: "Quantum sensors detect dark matter signals.",
    contextText: "Quantum sensors detect dark matter signals."
  };
  const result = await searchLiterature(context, {
    sourceProfile: "custom", primarySource: "crossref", fallbackSources: ["arxiv"],
    contextualSearchEngine: "beta", sourceApiTokens: {}, citationKeyMode: "authoryear"
  }, async input => {
    if (String(input).startsWith("https://export.arxiv.org/")) return textResponse(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>http://arxiv.org/abs/2401.00001v1</id><published>2024-01-01T00:00:00Z</published>
      <title>Quantum Sensors for Dark Matter Detection</title>
      <summary>Quantum sensors detect dark matter signals.</summary>
      <author><name>Alice Smith</name></author></entry></feed>`);
    return jsonResponse({ message: { items: [crossrefWork({
      doi: "10.5555/sensors", title: "Quantum Sensors", authors: ["Smith, Alice"], year: 2024
    })] } });
  });
  assert.equal(result[0].eprint, "2401.00001");
});

test("beta broad ranking lets topical adjacent-year papers beat unrelated exact-year namesakes", async () => {
  const context = {
    token: "Smith2023quantum", searchMode: "contextual",
    parsedKeyHint: { surname: "Smith", year: 2023, suffix: "quantum" },
    sentenceText: "Quantum entanglement spectra characterize topological phases.",
    contextText: "Quantum entanglement spectra characterize topological phases."
  };
  const items = [
    crossrefWork({ doi: "10.5555/unrelated", title: "Clinical Phases of Medical Treatment", authors: ["Smith, Alice"], year: 2023 }),
    crossrefWork({ doi: "10.5555/topical", title: "Quantum Entanglement Spectra in Topological Phases", authors: ["Smith, Bob"], year: 2024 })
  ];
  for (const engine of ["beta", "classic"]) {
    const result = await searchLiterature(context, {
      sourceProfile: "general", contextualSearchEngine: engine, sourceApiTokens: {}, citationKeyMode: "authoryear"
    }, async () => jsonResponse({ message: { items } }));
    assert.equal(result[0].doi, engine === "beta" ? "10.5555/topical" : "10.5555/unrelated");
  }
});

function crossrefWork({ doi, title, authors, year, abstract, type = "journal-article", journal = "Test Journal" }) {
  return {
    DOI: doi,
    title: [title],
    author: authors.map(crossrefAuthor),
    issued: { "date-parts": [[year]] },
    abstract,
    "is-referenced-by-count": 0,
    "container-title": [journal],
    type,
    URL: `https://doi.org/${doi}`
  };
}

function namedCrossrefWork({ doi, title, author, year, abstract, type = "journal-article", journal = "Test Journal" }) {
  return {
    DOI: doi,
    title: [title],
    author: [{ name: author }],
    issued: { "date-parts": [[year]] },
    abstract,
    "is-referenced-by-count": 0,
    "container-title": [journal],
    type,
    URL: `https://doi.org/${doi}`
  };
}

function crossrefAuthor(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length <= 1) {
    return { family: name, given: "" };
  }
  return {
    family: parts.at(-1),
    given: parts.slice(0, -1).join(" ")
  };
}
