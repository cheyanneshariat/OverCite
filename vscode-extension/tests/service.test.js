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
