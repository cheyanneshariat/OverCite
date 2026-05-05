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
        generatedKey: "Shariat25_test"
      }
    ],
    {
      citationKeyMode: "informative",
      bibliographyInsertMode: "append"
    },
    "Shariat25"
  );

  assert.equal(items[0].label, "Shariat25_test");
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

test("searchAds stops explicit-year contextual lookups after first-author year results are sufficient", async () => {
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

  assert.equal(calls.length, 4);
  assert.match(calls[3], /\(\(first_author:"Shariat"\) OR \(author:"Shariat Collaboration"\) OR \(author:"Shariat Scientific Collaboration"\)\) year:2025|first_author:"Shariat" year:2025/);
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
  assert.match(results[0].sourceLabel, /Crossref/);
  assert.match(results[0].sourceLabel, /arXiv/);
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
      primarySource: "inspire",
      fallbackSources: ["crossref"],
      sourceApiTokens: {},
      citationKeyMode: "authoryear"
    },
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://inspirehep.net/api/literature")) {
        return jsonResponse({ hits: { hits: [] } });
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

  assert.ok(calls.some((url) => url.startsWith("https://inspirehep.net/api/literature")));
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
    property: overrides.property,
    doctype: overrides.doctype,
    pub: overrides.pub,
    bibstem: overrides.bibstem,
    database: overrides.database
  };
}

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
