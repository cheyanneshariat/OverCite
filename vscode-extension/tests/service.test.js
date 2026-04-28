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

function makeDoc(bibcode, overrides = {}) {
  return {
    bibcode,
    title: [overrides.title ?? `Candidate ${bibcode}`],
    author: overrides.author ?? ["Shariat, Cheyanne"],
    year: overrides.year ?? "2025",
    abstract: overrides.abstract ?? "Resolved triples from Gaia constrain triple star populations.",
    doi: [overrides.doi ?? `10.1234/${bibcode}`]
  };
}

function crossrefWork({ doi, title, authors, year, abstract }) {
  return {
    DOI: doi,
    title: [title],
    author: authors.map(crossrefAuthor),
    issued: { "date-parts": [[year]] },
    abstract,
    "is-referenced-by-count": 0,
    "container-title": ["Test Journal"],
    type: "journal-article",
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
