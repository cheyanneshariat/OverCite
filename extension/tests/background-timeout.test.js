import test from "node:test";
import assert from "node:assert/strict";

let cachedHarness = null;

async function loadBackgroundHarness(initialStore = {}) {
  if (cachedHarness) {
    for (const key of Object.keys(cachedHarness.store)) {
      delete cachedHarness.store[key];
    }
    Object.assign(cachedHarness.store, initialStore);
    return cachedHarness;
  }
  let installedListener = null;
  const store = { ...initialStore };
  const addListener = () => {};
  globalThis.browser = {
    runtime: {
      onInstalled: { addListener(listener) { installedListener = listener; } },
      onMessage: { addListener }
    },
    commands: { onCommand: { addListener } },
    action: { onClicked: { addListener } },
    tabs: {
      async query() { return []; },
      async sendMessage() { return true; }
    },
    storage: {
      sync: {
        async get(keys) {
          return Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]]));
        },
        async set(values) { Object.assign(store, values); }
      }
    }
  };
  globalThis.__OVERCITE_BACKGROUND_TEST__ = true;
  await import(`../src/background.js?timeout-test=${Date.now()}`);
  const hooks = globalThis.__OVERCITE_BACKGROUND_TEST_HOOKS__;
  delete globalThis.__OVERCITE_BACKGROUND_TEST__;
  delete globalThis.__OVERCITE_BACKGROUND_TEST_HOOKS__;
  cachedHarness = { hooks, installedListener, store };
  return cachedHarness;
}

async function loadBackgroundHooks() {
  return (await loadBackgroundHarness()).hooks;
}

function hangingFetch(onAbort) {
  return (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      onAbort?.();
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
}

test("progressive ADS search returns a good result and aborts a slower sibling query", async () => {
  const hooks = await loadBackgroundHooks();
  let abortCount = 0;
  const fetchImpl = (url, options = {}) => {
    const query = new URL(url).searchParams.get("q");
    if (query === "slow") {
      return hangingFetch(() => { abortCount += 1; })(url, options);
    }
    return Promise.resolve({
      ok: true,
      async json() {
        return { response: { docs: [{ bibcode: "good" }] } };
      }
    });
  };

  const startedAt = Date.now();
  const docs = await hooks.fetchSearchCandidates(
    ["raw", "slow", "unused"],
    { searchMode: "contextual", token: "VanRoestel_2021", parsedKeyHint: { year: 2021 } },
    "token",
    {
      fetchImpl,
      requestTimeoutMs: 100,
      totalTimeoutMs: 250,
      shouldStop: (candidates) => candidates.some((candidate) => candidate.bibcode === "good")
    }
  );

  assert.deepEqual(docs.map((doc) => doc.bibcode), ["good"]);
  assert.equal(abortCount, 1);
  assert.ok(Date.now() - startedAt < 200, "progressive result should not wait for the slow query deadline");
});

test("ADS requests abort within their internal deadline with a provider-specific error", async () => {
  const hooks = await loadBackgroundHooks();
  let aborted = false;
  const startedAt = Date.now();

  await assert.rejects(
    hooks.fetchSearchCandidates(
      ["slow"],
      { searchMode: "simple", token: "VanRoestel_2021", parsedKeyHint: { year: 2021 } },
      "token",
      {
        fetchImpl: hangingFetch(() => { aborted = true; }),
        requestTimeoutMs: 30,
        totalTimeoutMs: 80
      }
    ),
    /ADS\/SciX search timed out/
  );

  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < 250, "internal timeout must remain bounded");
});

test("ADS deadline remains active while the response body is being read", async () => {
  const hooks = await loadBackgroundHooks();
  let bodyAborted = false;
  const fetchImpl = async (_url, options = {}) => ({
    ok: true,
    json() {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          bodyAborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
    }
  });

  await assert.rejects(
    hooks.fetchSearchCandidates(
      ["body-stall"],
      { searchMode: "simple", token: "VanRoestel_2021", parsedKeyHint: { year: 2021 } },
      "token",
      { fetchImpl, requestTimeoutMs: 30, totalTimeoutMs: 80 }
    ),
    /ADS\/SciX search timed out/
  );
  assert.equal(bodyAborted, true);
});

test("ADS search and export report non-JSON HTTP errors without parsing their bodies", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "token",
    sourceApiTokens: { ads: "token" }
  });
  const originalFetch = globalThis.fetch;
  let jsonCalls = 0;
  const errorResponse = {
    ok: false,
    status: 503,
    async json() {
      jsonCalls += 1;
      throw new SyntaxError("Unexpected token <");
    }
  };
  try {
    await assert.rejects(
      harness.hooks.fetchAdsDocs("author:test", "token", 100, async () => errorResponse),
      /ADS search failed with status 503/
    );
    globalThis.fetch = async () => errorResponse;
    await assert.rejects(
      harness.hooks.exportBibtex({ bibcode: "2026TEST....1A" }),
      /ADS BibTeX export failed with status 503/
    );
    assert.equal(jsonCalls, 0, "error response bodies must not be parsed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background cancellation wrapper preserves the arXiv runtime cache", async () => {
  const hooks = await loadBackgroundHooks();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async text() {
        return `<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/2608.12345v1</id>
              <published>2026-08-08T00:00:00Z</published>
              <title>Wrapped Runtime Cache Test</title>
              <summary>Verifies that the background signal wrapper keeps production arXiv guards.</summary>
              <author><name>Runtime Cache</name></author>
              <category term="astro-ph.SR"/>
            </entry>
          </feed>`;
      }
    };
  };
  const citationContext = {
    token: "arXiv:2608.12345",
    searchMode: "direct",
    parsedKeyHint: null
  };
  const settings = { citationKeyMode: "authoryear" };
  try {
    const first = await hooks.searchRoutedSource("arxiv", citationContext, settings, "", new AbortController().signal);
    const second = await hooks.searchRoutedSource("arxiv", citationContext, settings, "", new AbortController().signal);
    assert.equal(first[0].eprint, "2608.12345");
    assert.equal(second[0].eprint, "2608.12345");
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background cancellation aborts a broad-source response body", async () => {
  const hooks = await loadBackgroundHooks();
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let bodyAborted = false;
  globalThis.fetch = async (_url, options = {}) => ({
    ok: true,
    text() {
      return new Promise((_resolve, reject) => {
        const abort = () => {
          bodyAborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        };
        if (options.signal?.aborted) {
          abort();
        } else {
          options.signal?.addEventListener("abort", abort, { once: true });
        }
      });
    }
  });
  try {
    const search = hooks.searchRoutedSource("arxiv", {
      token: "BodyAbort2026",
      searchMode: "contextual",
      parsedKeyHint: { surname: "BodyAbort", year: 2026 }
    }, { citationKeyMode: "authoryear" }, "", controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(search, /aborted|cancelled|failed/i);
    assert.equal(bodyAborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production contextual search returns the reported VanRoestel match without waiting for its sibling", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "token",
    sourceApiTokens: { ads: "token" },
    sourceProfile: "astrophysics"
  });
  const originalFetch = globalThis.fetch;
  let abortCount = 0;
  globalThis.fetch = (url, options = {}) => {
    const query = new URL(url).searchParams.get("q");
    if (query.includes('first_author:"VanRoestel"')) {
      return Promise.resolve({
        ok: true,
        async json() {
          return {
            response: {
              docs: [{
                bibcode: "2021A&C....3600454V",
                title: ["The ZTF Source Classification Project. I. Methods and Infrastructure"],
                author: ["van Roestel, J."],
                year: 2021,
                abstract: "Methods and infrastructure for ZTF source classification.",
                property: ["ARTICLE", "REFEREED"],
                doctype: "article"
              }]
            }
          };
        }
      });
    }
    return hangingFetch(() => { abortCount += 1; })(url, options);
  };
  try {
    const results = await harness.hooks.searchLiterature({
      token: "VanRoestel_2021",
      searchMode: "contextual",
      sentenceText: "The ZTF Source Classification Project. I. Methods and Infrastructure",
      contextText: "The ZTF Source Classification Project uses classification methods and infrastructure.",
      parsedKeyHint: { surname: "VanRoestel", year: 2021, suffix: "" }
    });
    assert.equal(results[0].bibcode, "2021A&C....3600454V");
    assert.ok(abortCount >= 1, "the slower inferred-surname sibling should be cancelled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production contextual search tries an inferred El-Badry query in the opening pair", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "token",
    sourceApiTokens: { ads: "token" },
    sourceProfile: "astrophysics"
  });
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    queries.push(query);
    const matches = query.includes('first_author:"El-Badry"');
    return {
      ok: true,
      async json() {
        return {
          response: {
            docs: matches ? [{
              bibcode: "2023MNRAS.521.4323E",
              title: ["A Sun-like star orbiting a black hole"],
              author: ["El-Badry, Kareem"],
              year: 2023,
              abstract: "A Sun-like star in a binary with a black hole.",
              property: ["ARTICLE", "REFEREED"],
              doctype: "article"
            }] : []
          }
        };
      }
    };
  };
  try {
    const results = await harness.hooks.searchLiterature({
      token: "ElBadry2023",
      searchMode: "contextual",
      sentenceText: "A Sun-like star orbiting a black hole",
      contextText: "A Sun-like star orbiting a black hole in a binary.",
      parsedKeyHint: { surname: "ElBadry", year: 2023, suffix: "" }
    });
    assert.equal(results[0].bibcode, "2023MNRAS.521.4323E");
    assert.ok(queries.slice(0, 2).some((query) => query.includes('first_author:"El-Badry"')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("install migration preserves an existing contextual preference", async () => {
  const harness = await loadBackgroundHarness({ defaultSearchMode: "contextual" });
  assert.equal(typeof harness.installedListener, "function");

  await harness.installedListener();

  assert.equal(harness.store.defaultSearchMode, "contextual");
});

test("fresh install stores the new simple-search and return-to-source defaults", async () => {
  const harness = await loadBackgroundHarness();
  await harness.installedListener();
  assert.equal(harness.store.defaultSearchMode, "simple");
  assert.equal(harness.store.returnToSourceAfterInsert, true);
});

test("install migration preserves an explicit stay-in-bibliography preference", async () => {
  const harness = await loadBackgroundHarness({ returnToSourceAfterInsert: false });
  await harness.installedListener();
  assert.equal(harness.store.returnToSourceAfterInsert, false);
});

test("install migration preserves an explicit return-to-source preference", async () => {
  const harness = await loadBackgroundHarness({ returnToSourceAfterInsert: true });
  await harness.installedListener();
  assert.equal(harness.store.returnToSourceAfterInsert, true);
});
