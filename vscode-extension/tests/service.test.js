import test from "node:test";
import assert from "node:assert/strict";

import { buildQuickPickItems, resolveBibTarget, searchAds } from "../src/service.js";

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

function okResponse(docs) {
  return {
    ok: true,
    async json() {
      return { response: { docs } };
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
