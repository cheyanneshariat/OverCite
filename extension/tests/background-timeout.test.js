import test from "node:test";
import assert from "node:assert/strict";

let cachedHarness = null;

test("final browser candidates are published before optional citation-count enrichment", async () => {
  const { hooks } = await loadBackgroundHarness({
    sourceProfile: "custom", primarySource: "arxiv", fallbackSources: [], adsApiToken: "count-test"
  });
  const originalFetch = globalThis.fetch;
  let ready;
  let countRequests = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "export.arxiv.org") {
      return { ok: true, async text() { return `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2608.99998v1</id><published>2026-08-01T00:00:00Z</published><title>Synthetic readiness timing</title><summary>Test only</summary><author><name>Example Author</name></author></entry></feed>`; } };
    }
    assert.equal(url.hostname, "api.adsabs.harvard.edu");
    assert.ok(ready?.length, "counts must not block the final ranking callback");
    countRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { ok: true, async json() { return { response: { docs: [{ bibcode: "2026TestCounts", title: ["Synthetic readiness timing"], author: ["Author, Example"], year: "2026", identifier: ["arXiv:2608.99998"], citation_count: 123 }] } }; } };
  };
  try {
    const results = await hooks.searchLiterature({ token: "arXiv:2608.99998", searchMode: "direct" }, null, null, (candidates) => { ready = candidates; });
    assert.equal(countRequests, 1);
    assert.equal(results[0].citationCount, 123);
    assert.deepEqual(results.map(({ citationCount, ...candidate }) => candidate), ready.map(({ citationCount, ...candidate }) => candidate));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function loadBackgroundHarness(initialStore = {}) {
  if (cachedHarness) {
    await cachedHarness.hooks.clearCaches();
    for (const key of Object.keys(cachedHarness.store)) {
      delete cachedHarness.store[key];
    }
    Object.assign(cachedHarness.store, initialStore);
    return cachedHarness;
  }
  let installedListener = null;
  const store = { ...initialStore };
  const sessionStore = {};
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
      },
      session: {
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested.filter((key) => key in sessionStore).map((key) => [key, sessionStore[key]]));
        },
        async set(values) { Object.assign(sessionStore, values); },
        async clear() { for (const key of Object.keys(sessionStore)) delete sessionStore[key]; }
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

test("contextual ADS waits for the opening pair before final confidence evaluation", async () => {
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
  assert.ok(Date.now() - startedAt >= 80, "final ranking must include the targeted sibling or its timeout");
});

test("controlled provider latency: contextual preview is usable before final refinement", async (t) => {
  const hooks = await loadBackgroundHooks();
  const started = performance.now();
  let firstMs;
  const docs = await hooks.fetchSearchCandidates(["fast", "slow"],
    { searchMode: "contextual", token: "Example2026" }, "test", {
      fetchImpl: async (url) => {
        const fast = new URL(url).searchParams.get("q") === "fast";
        await new Promise((resolve) => setTimeout(resolve, fast ? 120 : 1200));
        return { ok: true, async json() { return { response: { docs: [{ bibcode: fast ? "early" : "refined" }] } }; } };
      },
      onProgress() { firstMs ??= performance.now() - started; },
      shouldStop: () => true
    });
  const finalMs = performance.now() - started;
  assert.ok(firstMs < 600, `preview took ${firstMs} ms`);
  assert.ok(finalMs >= 1100, "final result must retain the slow targeted query");
  assert.deepEqual(docs.map((doc) => doc.bibcode), ["early", "refined"]);
  t.diagnostic(`Injected provider delays 120/1200 ms: first candidates ${firstMs.toFixed(1)} ms; final ${finalMs.toFixed(1)} ms. Not a live ADS measurement.`);
});

test("contextual preview arrives before a stalled opening sibling, and cancellation is scoped to tab and request", async () => {
  const { hooks } = await loadBackgroundHarness({
    adsApiToken: "preview-test", sourceProfile: "astrophysics", contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  const originalSend = globalThis.browser.tabs.sendMessage;
  let resolvePreview;
  const preview = new Promise((resolve) => { resolvePreview = resolve; });
  let aborts = 0;
  let calls = 0;
  globalThis.browser.tabs.sendMessage = async (tab, message, options) => {
    resolvePreview({ tab, message, options });
  };
  globalThis.fetch = (url, options) => {
    if (++calls > 1) return hangingFetch(() => { aborts++; })(url, options);
    return Promise.resolve({ ok: true, async json() { return { response: { docs: [{
      bibcode: "preview-paper", title: ["Redback pulsar masses"], author: ["Strader, Jay"],
      year: 2019, abstract: "Redback pulsar masses and binary demographics."
    }] } }; } });
  };
  try {
    const sender = { tab: { id: 10 }, frameId: 0 };
    const outcome = hooks.handleMessage({ type: "searchAds", requestId: "request-one", citationContext: {
      token: "Strader2019", searchMode: "contextual", parsedKeyHint: { surname: "Strader", year: 2019 },
      sentenceText: "Redback pulsar masses and binary demographics", contextText: "Redback pulsar masses and binary demographics"
    } }, sender).then((result) => ({ result }), (error) => ({ error }));
    const first = await Promise.race([preview, new Promise((_, reject) => setTimeout(() => reject(new Error("preview blocked by sibling")), 500))]);
    assert.equal(first.message.results[0].bibcode, "preview-paper");
    assert.equal(first.message.requestId, "request-one");
    assert.equal(first.tab, 10);
    assert.equal(first.options.frameId, 0);
    await hooks.handleMessage({ type: "cancelSearch", requestId: "request-one" }, { tab: { id: 11 } });
    await hooks.handleMessage({ type: "cancelSearch", requestId: "old-request" }, sender);
    assert.equal(aborts, 0);
    await hooks.handleMessage({ type: "cancelSearch", requestId: "request-one" }, sender);
    assert.match((await outcome).error.message, /cancelled/);
    assert.ok(aborts > 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.browser.tabs.sendMessage = originalSend;
  }
});

test("cancelled contextual ADS work cannot publish a late opening callback", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "late-callback-test",
    sourceProfile: "astrophysics",
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  const originalSend = globalThis.browser.tabs.sendMessage;
  const resolvers = [];
  const messages = [];
  let fetchStarted;
  globalThis.fetch = () => new Promise((resolve) => {
    resolvers.push(resolve);
    fetchStarted?.();
  });
  globalThis.browser.tabs.sendMessage = async (tab, message, options) => {
    messages.push({ tab, message, options });
  };
  try {
    const started = new Promise((resolve) => { fetchStarted = resolve; });
    const outcome = harness.hooks.handleMessage({
      type: "searchAds",
      requestId: "late-callback",
      citationContext: {
        token: "Late2026",
        searchMode: "contextual",
        sentenceText: "A late provider response should not publish.",
        contextText: "A late provider response should not publish.",
        parsedKeyHint: { surname: "Late", year: 2026, suffix: "" }
      }
    }, { tab: { id: 77 }, frameId: 0 }).then(
      (result) => ({ result }),
      (error) => ({ error })
    );
    await started;
    await harness.hooks.handleMessage({ type: "cancelSearch", requestId: "late-callback" }, { tab: { id: 77 }, frameId: 0 });
    const settled = await outcome;
    assert.ok(settled.error);
    for (const resolve of resolvers) {
      resolve({ ok: true, async json() { return { response: { docs: [{ bibcode: "late-result" }] } }; } });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(messages, [], "a provider that resolves after cancellation must not publish progress or ready results");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.browser.tabs.sendMessage = originalSend;
  }
});

test("search settings invalidate an in-flight tab search and reject its late result", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "old-token",
    sourceApiTokens: { ads: "old-token" },
    sourceProfile: "custom",
    primarySource: "ads",
    fallbackSources: [],
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  const originalSend = globalThis.browser.tabs.sendMessage;
  const messages = [];
  let fetchStarted;
  let rejectFetch;
  globalThis.fetch = (_url, options = {}) => {
    fetchStarted?.();
    return new Promise((_resolve, reject) => {
      rejectFetch = reject;
      options.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  };
  globalThis.browser.tabs.sendMessage = async (tab, message, options) => {
    messages.push({ tab, message, options });
  };
  try {
    const started = new Promise((resolve) => { fetchStarted = resolve; });
    const outcome = harness.hooks.handleMessage({
      type: "searchAds",
      requestId: "settings-race",
      citationContext: {
        token: "Example2026",
        searchMode: "simple",
        parsedKeyHint: { surname: "Example", year: 2026 }
      }
    }, { tab: { id: 42 }, frameId: 3 }).then(
      (result) => ({ result }),
      (error) => ({ error })
    );
    await started;
    await harness.hooks.handleMessage({
      type: "saveSettings",
      settings: {
        adsApiToken: "old-token",
        sourceApiTokens: { ads: "old-token" },
        sourceProfile: "custom",
        primarySource: "ads",
        fallbackSources: [],
        contextualSearchEngine: "beta"
      }
    });
    assert.deepEqual(messages, [], "an idempotent save must not invalidate the active search");
    await harness.hooks.handleMessage({
      type: "saveSettings",
      settings: {
        adsApiToken: "new-token",
        sourceApiTokens: { ads: "new-token" },
        sourceProfile: "custom",
        primarySource: "ads",
        fallbackSources: [],
        contextualSearchEngine: "beta"
      }
    });
    const settled = await outcome;
    assert.ok(settled.error, "the old request must not return a result");
    assert.match(settled.error.message, /cancelled|settings changed/i);
    assert.deepEqual(messages.map(({ message }) => message.type), ["ezcite:settingsChanged"]);
    assert.equal(messages[0].message.reason, "search-settings-changed");
    assert.equal(messages[0].options.frameId, 3);
  } finally {
    rejectFetch?.(new Error("test cleanup"));
    globalThis.fetch = originalFetch;
    globalThis.browser.tabs.sendMessage = originalSend;
  }
});

test("Simple, Raw and Classic contextual search do not emit beta previews", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { response: { docs: [{
    bibcode: "identity", title: ["Redback pulsar masses"], author: ["Strader, Jay"], year: 2019,
    abstract: "Redback pulsar masses and binary demographics."
  }] } }; } });
  try {
    for (const [searchMode, engine] of [["simple", "beta"], ["direct", "beta"], ["contextual", "classic"]]) {
      const { hooks } = await loadBackgroundHarness({
        adsApiToken: "test", sourceProfile: "astrophysics", contextualSearchEngine: engine
      });
      let previews = 0;
      const results = await hooks.searchLiterature({ token: "Strader2019", searchMode,
        parsedKeyHint: { surname: "Strader", year: 2019 },
        sentenceText: "Redback pulsar masses and binary demographics", contextText: "Redback pulsar masses and binary demographics"
      }, null, () => { previews++; });
      assert.ok(results.length);
      assert.equal(previews, 0, `${searchMode}/${engine} unexpectedly streamed`);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("Context Beta retains exact collaboration identities in ADS results", async () => {
  const originalFetch = globalThis.fetch;
  const docs = [
    {
      bibcode: "planck-collaboration-2020",
      title: ["Planck 2018 results. VI. Cosmological parameters"],
      author: ["Planck Collaboration"],
      year: 2020,
      abstract: "Planck cosmological parameters.",
      property: ["ARTICLE", "REFEREED"],
      doctype: "article"
    },
    {
      bibcode: "planckman-collaboration-2020",
      title: ["Planckman stellar results"],
      author: ["Planckman Collaboration"],
      year: 2020,
      abstract: "An unrelated result.",
      property: ["ARTICLE", "REFEREED"],
      doctype: "article"
    },
    {
      bibcode: "max-planck-2020",
      title: ["Max Planck annual report"],
      author: ["Planck, Max"],
      year: 2020,
      abstract: "An unrelated report.",
      property: ["ARTICLE", "REFEREED"],
      doctype: "article"
    }
  ];
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, "api.adsabs.harvard.edu");
    return { ok: true, async json() { return { response: { docs } }; } };
  };
  const context = {
    token: "Planck2020",
    searchMode: "contextual",
    sentenceText: "The Planck 2018 results. VI. Cosmological parameters paper constrains cosmology.",
    contextText: "The Planck 2018 results. VI. Cosmological parameters paper constrains cosmology.",
    parsedKeyHint: { surname: "Planck", year: 2020, firstInitial: "", suffix: "" }
  };
  try {
    const { hooks } = await loadBackgroundHarness({
      adsApiToken: "collaboration-test",
      sourceApiTokens: { ads: "collaboration-test" },
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: [],
      contextualSearchEngine: "beta"
    });
    const beta = await hooks.searchLiterature(context);
    assert.ok(beta.some((candidate) => candidate.bibcode === "planck-collaboration-2020"));
    assert.ok(beta.every((candidate) => candidate.bibcode !== "planckman-collaboration-2020"));

    const classicHooks = await loadBackgroundHarness({
      adsApiToken: "collaboration-test",
      sourceApiTokens: { ads: "collaboration-test" },
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: [],
      contextualSearchEngine: "classic"
    });
    const classic = await classicHooks.hooks.searchLiterature(context);
    assert.ok(classic.every((candidate) => candidate.bibcode !== "planck-collaboration-2020"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production beta search removes opaque RN identity filters before ADS and preserves typed insertion", async () => {
  const harness = await loadBackgroundHarness({
    sourceProfile: "custom",
    primarySource: "ads",
    fallbackSources: [],
    adsApiToken: "opaque-key-test",
    contextualSearchEngine: "beta",
    citationKeyMode: "typed"
  });
  const originalFetch = globalThis.fetch;
  const queries = [];
  const context = {
    token: "RN3825",
    searchMode: "contextual",
    sentenceText: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation is widely used.",
    citationPrefixText: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation",
    citationSuffixText: ".",
    contextText: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation is widely used.",
    parsedKeyHint: { surname: "R", firstInitial: "N", year: 3825, suffix: "" }
  };
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    queries.push(query);
    return {
      ok: true,
      async json() {
        return { response: { docs: [
          {
            bibcode: "target-paper",
            title: ["Brain magnetic resonance imaging with contrast dependent on blood oxygenation"],
            author: ["Ogawa, Seiji"],
            year: 1990,
            abstract: "Brain magnetic resonance imaging with contrast dependent on blood oxygenation."
          },
          {
            bibcode: "distractor-paper",
            title: ["A General Survey"],
            author: ["R, Nora"],
            year: 3825,
            abstract: "A general survey."
          }
        ] } };
      }
    };
  };
  try {
    const results = await harness.hooks.searchLiterature(context);
    assert.ok(queries.length >= 1);
    assert.ok(queries.every((query) => !/RN3825|3825|first_author|author:/.test(query)), queries.join("\n"));
    assert.equal(results[0].bibcode, "target-paper");
    assert.equal(results[0].typedToken, "RN3825");
    assert.equal(results[0].generatedKey, "RN3825");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("contextual follow-up previews do not wait for every request in the batch", async () => {
  const hooks = await loadBackgroundHooks();
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  let gotPreview;
  const preview = new Promise((resolve) => { gotPreview = resolve; });
  const response = (docs) => ({ ok: true, async json() { return { response: { docs } }; } });
  const request = hooks.fetchSearchCandidates(["empty-a", "empty-b", "hit", "slow"],
    { searchMode: "contextual", token: "Example2026" }, "test", {
      fetchImpl: async (url) => {
        const q = new URL(url).searchParams.get("q");
        if (q === "slow") { await slow; return response([]); }
        return response(q === "hit" ? [{ bibcode: "follow-up" }] : []);
      },
      onProgress(docs) { if (docs.some((doc) => doc.bibcode === "follow-up")) gotPreview(); }
    });
  try {
    await Promise.race([preview, new Promise((_, reject) => setTimeout(() => reject(new Error("preview blocked by batch")), 500))]);
  } finally { releaseSlow(); }
  assert.equal((await request)[0].bibcode, "follow-up");
});

test("ADS completed-response cache reuses identical queries and isolates credentials, expiry and empty results", async () => {
  const hooks = await loadBackgroundHooks();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async (url) => {
    calls++;
    const empty = new URL(url).searchParams.get("q") === "empty";
    return { ok: true, async json() { return { response: { docs: empty ? [] : [{ bibcode: "cached" }] } }; } };
  };
  try {
    const first = await hooks.fetchAdsDocs("query", "account-a");
    first[0].bibcode = "mutated";
    assert.equal((await hooks.fetchAdsDocs("query", "account-a"))[0].bibcode, "cached");
    assert.equal(calls, 1);
    await hooks.fetchAdsDocs("query", "account-b");
    assert.equal(calls, 2);
    now += 120001;
    await hooks.fetchAdsDocs("query", "account-a");
    assert.equal(calls, 3);
    await hooks.fetchAdsDocs("empty", "account-a");
    await hooks.fetchAdsDocs("empty", "account-a");
    assert.equal(calls, 5);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("ADS response cache excludes failed and aborted requests", async () => {
  const hooks = await loadBackgroundHooks();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: false, status: 503 };
    };
    await assert.rejects(hooks.fetchAdsDocs("failed", "cache-safety-token"), /status 503/);

    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, async json() { return { response: { docs: [{ bibcode: "recovered" }] } }; } };
    };
    assert.equal((await hooks.fetchAdsDocs("failed", "cache-safety-token"))[0].bibcode, "recovered");
    assert.equal(calls, 2, "an HTTP failure must not populate the completed-response cache");

    const controller = new AbortController();
    globalThis.fetch = (_url, options = {}) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const aborted = hooks.fetchAdsDocs("aborted", "cache-safety-token", 100, globalThis.fetch, controller.signal);
    controller.abort();
    await assert.rejects(aborted, /cancelled|aborted/i);

    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, async json() { return { response: { docs: [{ bibcode: "after-abort" }] } }; } };
    };
    assert.equal((await hooks.fetchAdsDocs("aborted", "cache-safety-token"))[0].bibcode, "after-abort");
    assert.equal(calls, 4, "an aborted request must not populate the completed-response cache");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("contextual completed cache partitions context and credential scope and reconstructs from session storage", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "context-cache-token-a",
    sourceApiTokens: { ads: "context-cache-token-a" },
    sourceProfile: "custom",
    primarySource: "ads",
    fallbackSources: [],
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const context = {
    token: "CacheAuthor2026",
    searchMode: "contextual",
    parsedKeyHint: { surname: "CacheAuthor", year: 2026 },
    sentenceText: "Cache context sentence about stellar populations.",
    citationPrefixText: "Cache context sentence about stellar populations",
    citationSuffixText: ".",
    contextText: "Cache context sentence about stellar populations."
  };
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, async json() { return { response: { docs: [{
      bibcode: "context-cache-paper",
      title: ["Cache context result"],
      author: ["Cache, Example"],
      year: 2026,
      abstract: "A public result used only for cache tests."
    }] } }; } };
  };
  try {
    const first = await harness.hooks.searchLiterature(context);
    const firstCalls = calls;
    assert.ok(first.length);
    await harness.hooks.clearContextualMemoryCache();
    const reconstructed = await harness.hooks.searchLiterature(context);
    assert.equal(calls, firstCalls, "session storage should reconstruct a completed contextual result");
    assert.equal(reconstructed[0].typedToken, context.token, "cache restore must rebuild the typed token in memory");
    const persisted = await harness.hooks.inspectContextualSessionCache();
    assert.doesNotMatch(JSON.stringify(persisted), /CacheAuthor2026/, "session cache must not persist the citation token");

    harness.hooks.clearAdsCache();
    await harness.hooks.searchLiterature({
      ...context,
      sentenceText: "A different contextual sentence.",
      citationPrefixText: "A different contextual sentence",
      contextText: "A different contextual sentence."
    });
    assert.ok(calls > firstCalls, "different context must not reuse the completed result");
    const afterContextCalls = calls;
    await harness.hooks.handleMessage({ type: "saveSettings", settings: {
      adsApiToken: "context-cache-token-b",
      sourceApiTokens: { ads: "context-cache-token-b" },
      sourceProfile: "custom",
      primarySource: "ads",
      fallbackSources: [],
      contextualSearchEngine: "beta"
    }});
    await harness.hooks.searchLiterature(context);
    assert.ok(calls > afterContextCalls, "different credentials must not reuse the completed result");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("contextual completed cache expires and excludes empty, failed, and aborted searches", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "cache-expiry-token",
    sourceApiTokens: { ads: "cache-expiry-token" },
    sourceProfile: "custom",
    primarySource: "ads",
    fallbackSources: [],
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  Date.now = () => now;
  const makeContext = (suffix) => ({
    token: `CacheExpiry${suffix}2026`,
    searchMode: "contextual",
    parsedKeyHint: { surname: `CacheExpiry${suffix}`, year: 2026 },
    sentenceText: `Cache expiry ${suffix} context sentence.`
  });
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, async json() { return { response: { docs: [{ bibcode: "expiry-paper", title: ["Expiry result"], author: ["Expiry, Example"], year: 2026 }] } }; } };
    };
    const expiryContext = makeContext("Good");
    await harness.hooks.searchLiterature(expiryContext);
    const firstCalls = calls;
    now += 120001;
    await harness.hooks.searchLiterature(expiryContext);
    assert.ok(calls > firstCalls, "expired contextual results must be refetched");

    const failedContext = makeContext("Failed");
    harness.hooks.clearAdsCache();
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: false, status: 503 };
    };
    await assert.rejects(harness.hooks.searchLiterature(failedContext), /status 503/);
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, async json() { return { response: { docs: [{ bibcode: "failed-retry", title: ["Retry result"], author: ["Retry, Example"], year: 2026 }] } }; } };
    };
    await harness.hooks.searchLiterature(failedContext);
    assert.ok(calls >= 2, "failed contextual searches must not be cached");

    const emptyContext = makeContext("Empty");
    harness.hooks.clearAdsCache();
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, async json() { return { response: { docs: [] } }; } };
    };
    await assert.rejects(harness.hooks.searchLiterature(emptyContext), /No literature matches|failed|status/i);
    const emptyFirstCalls = calls;
    await assert.rejects(harness.hooks.searchLiterature(emptyContext), /No literature matches|failed|status/i);
    assert.ok(calls > emptyFirstCalls, "empty contextual searches must not be cached");

    const abortedContext = makeContext("Aborted");
    harness.hooks.clearAdsCache();
    const controller = new AbortController();
    globalThis.fetch = (_url, options = {}) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const aborted = harness.hooks.searchLiterature(abortedContext, controller.signal);
    controller.abort();
    await assert.rejects(aborted, /cancelled|aborted/i);
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, async json() { return { response: { docs: [{ bibcode: "aborted-retry", title: ["Aborted retry"], author: ["Retry, Example"], year: 2026 }] } }; } };
    };
    await harness.hooks.searchLiterature(abortedContext);
    assert.ok(calls >= 2, "aborted contextual searches must not be cached");
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
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

test("production contextual search waits for both opening queries before accepting VanRoestel", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "token",
    sourceApiTokens: { ads: "token" },
    sourceProfile: "astrophysics"
  });
  const originalFetch = globalThis.fetch;
  let openingQueries = 0;
  globalThis.fetch = (url, options = {}) => {
    const query = new URL(url).searchParams.get("q");
    openingQueries += 1;
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
    return Promise.resolve({ ok: true, async json() { return { response: { docs: [] } }; } });
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
    assert.ok(openingQueries >= 2, "both opening retrieval paths should be considered before stopping");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production contextual search reaches the inferred El-Badry recall query", async () => {
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
    assert.ok(queries.slice(0, 4).some((query) => query.includes('first_author:"El-Badry"')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production contextual Yang2026 search returns from the entity-aware opening pair", async () => {
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
    const docs = query.includes('full:"PSR J0435+3233"')
      ? [{
        bibcode: "yang-triple",
        title: ["The PSR J0435+3233 Triple System"],
        author: ["Yang, Z. L.", "Han, J. L."],
        year: 2026,
        abstract: "A hierarchical triple with a white-dwarf inner binary and a distant stellar tertiary.",
        property: ["ARTICLE", "EPRINT_OPENACCESS"],
        doctype: "article"
      }]
      : Array.from({ length: 12 }, (_, index) => ({
        bibcode: `yang-distractor-${index}`,
        title: [`Unrelated 2026 astronomy result ${index}`],
        author: ["Yang, Other"],
        year: 2026,
        abstract: "An unrelated astronomy result.",
        property: ["ARTICLE", "REFEREED"],
        doctype: "article"
      }));
    return { ok: true, async json() { return { response: { docs } }; } };
  };
  try {
    const results = await harness.hooks.searchLiterature({
      token: "Yang2026",
      searchMode: "contextual",
      sentenceText: "6$ .",
      citationPrefixText: "Finding NSs in hierarchical triples can test the kick model. Recently, PSR J0435+3233 is a pulsar--white-dwarf binary with a stellar tertiary",
      citationSuffixText: ".",
      contextText: "PSR J0435+3233 is a hierarchical triple with a white dwarf and stellar tertiary.",
      parsedKeyHint: { surname: "Yang", year: 2026, suffix: "" }
    });
    assert.equal(results[0].bibcode, "yang-triple");
    assert.equal(queries.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser Context Beta does not let generic process wording overpower a matching QCD title", async () => {
  const harness = await loadBackgroundHarness({
    sourceProfile: "custom",
    primarySource: "crossref",
    fallbackSources: [],
    sourceApiTokens: {},
    citationKeyMode: "authoryear",
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        message: {
          items: [
            {
              DOI: "10.5555/collins-magnetization",
              title: ["An investigation of the magnetization distribution and magnetization processes in symmetrical 90 degree NiFe chevron elements"],
              author: [{ family: "Collins", given: "A." }, { family: "Husni", given: "M." }],
              issued: { "date-parts": [[1981]] },
              abstract: "An investigation of magnetization processes.",
              type: "journal-article"
            },
            {
              DOI: "10.5555/collins-back-to-back",
              title: ["Back-to-back jets in QCD"],
              author: [{ family: "Collins", given: "John C." }, { family: "Soper", given: "Davison E." }],
              issued: { "date-parts": [[1981]] },
              abstract: "Back-to-back jets in quantum chromodynamics.",
              type: "journal-article"
            }
          ]
        }
      };
    }
  });
  try {
    const results = await harness.hooks.searchLiterature({
      token: "Collins:1981uk",
      searchMode: "contextual",
      sentenceText: "With the help of factorization in quantum chromodynamics (QCD), the latter are used to empirically extract TMDs through global fitting.",
      citationPrefixText: "With the help of factorization in quantum chromodynamics (QCD), the latter are used to empirically extract TMDs through global fitting ",
      citationSuffixText: ".",
      contextText: "With the help of factorization in quantum chromodynamics (QCD), the latter are used to empirically extract TMDs through global fitting.",
      parsedKeyHint: { surname: "Collins", year: 1981, firstInitial: "", suffix: "" }
    });
    assert.equal(results[0].title, "Back-to-back jets in QCD");
    assert.equal(results[0].authors[0], "Collins, John C.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production contextual Yang2026 search uses a precise arXiv fallback when ADS has not indexed it", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "token",
    sourceApiTokens: { ads: "token" },
    sourceProfile: "astrophysics"
  });
  const originalFetch = globalThis.fetch;
  const adsQueries = [];
  const arxivQueries = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.host === "export.arxiv.org") {
      arxivQueries.push(url.searchParams.get("search_query"));
      return {
        ok: true,
        async text() {
          return `<?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <id>http://arxiv.org/abs/2608.01227v1</id>
                <published>2026-08-02T13:19:44Z</published>
                <title>The PSR J0435+3233 Triple System</title>
                <summary>A hierarchical triple with a white-dwarf inner binary and a distant stellar tertiary.</summary>
                <author><name>Z. L. Yang</name></author>
                <category term="astro-ph.HE"/>
              </entry>
            </feed>`;
        }
      };
    }
    const query = url.searchParams.get("q");
    if (!query.startsWith("identifier:")) {
      adsQueries.push(query);
    }
    return { ok: true, async json() { return { response: { docs: [] } }; } };
  };
  try {
    const results = await harness.hooks.searchLiterature({
      token: "Yang2026",
      searchMode: "contextual",
      sentenceText: "6$ .",
      citationPrefixText: "Finding NSs in hierarchical triples can test the kick model. Recently, PSR J0435+3233 is a pulsar--white-dwarf binary with a stellar tertiary",
      citationSuffixText: ".",
      contextText: "PSR J0435+3233 is a hierarchical triple with a white dwarf and stellar tertiary.",
      parsedKeyHint: { surname: "Yang", year: 2026, suffix: "" }
    });
    assert.equal(results[0].eprint, "2608.01227");
    assert.equal(adsQueries.length, 2);
    assert.equal(arxivQueries.length, 1);
    assert.match(arxivQueries[0], /au:"Yang"/);
    assert.match(arxivQueries[0], /PSR J0435\+3233/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production Context Beta routes an embedded arXiv identifier outside the profile", async () => {
  const harness = await loadBackgroundHarness({
    sourceProfile: "general",
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    assert.equal(parsed.hostname, "export.arxiv.org");
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() {
        return `<?xml version="1.0" encoding="UTF-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <id>http://arxiv.org/abs/2401.01234v2</id>
              <published>2024-01-03T00:00:00Z</published>
              <title>Embedded identifier target</title>
              <summary>The exact identifier target.</summary>
              <author><name>Jane Smith</name></author>
            </entry>
          </feed>`;
      }
    };
  };
  try {
    const results = await harness.hooks.searchLiterature({
      token: "Smith:2401.01234",
      searchMode: "contextual",
      sentenceText: "A contextual citation with an embedded arXiv identifier.",
      contextText: "A contextual citation with an embedded arXiv identifier.",
      parsedKeyHint: { surname: "Smith", year: 2024, suffix: "" }
    });
    assert.equal(results[0].sourceId, "arxiv");
    assert.equal(results[0].eprint, "2401.01234");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production Context Beta rejects a wrong Crossref DOI for an embedded arXiv identifier", async () => {
  const harness = await loadBackgroundHarness({
    sourceProfile: "general",
    contextualSearchEngine: "beta"
  });
  const originalFetch = globalThis.fetch;
  const hosts = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    hosts.push(parsed.hostname);
    if (parsed.hostname === "export.arxiv.org") {
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async text() {
          return `<?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <id>http://arxiv.org/abs/2410.09999v1</id>
                <published>2024-10-03T00:00:00Z</published>
                <title>Wrong identifier result</title>
                <summary>Not the requested work.</summary>
                <author><name>Smith, Example</name></author>
              </entry>
            </feed>`;
        }
      };
    }
    if (parsed.hostname === "api.crossref.org") {
      return {
        ok: true,
        async json() {
          return {
            message: {
              items: [{
                DOI: "10.5555/2410.05229",
                title: ["Wrong identifier result"],
                author: [{ family: "Smith", given: "Example" }],
                issued: { "date-parts": [[2024]] },
                type: "journal-article"
              }]
            }
          };
        }
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    await assert.rejects(() => harness.hooks.searchLiterature({
      token: "abs-2410-05229",
      searchMode: "contextual",
      sentenceText: "A citation with an explicit arXiv identifier.",
      contextText: "A citation with an explicit arXiv identifier.",
      parsedKeyHint: { surname: "Smith", year: 2024, suffix: "" }
    }), /No literature matches|failed/i);
    assert.ok(hosts.includes("export.arxiv.org"));
    assert.ok(hosts.includes("api.crossref.org"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production contextual search does not stop before a later exact-author result", async () => {
  const harness = await loadBackgroundHarness({
    adsApiToken: "token",
    sourceApiTokens: { ads: "token" },
    sourceProfile: "astrophysics"
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const callNumber = calls;
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 15));
    activeRequests -= 1;
    const docs = callNumber === 9
      ? [{
        bibcode: "strader-target",
        title: ["Optical Spectroscopy and Demographics of Redback Millisecond Pulsar Binaries"],
        author: ["Strader, Jay"],
        year: 2019,
        abstract: "Redback pulsars and their neutron star mass distribution.",
        property: ["ARTICLE", "REFEREED"],
        doctype: "article"
      }]
      : Array.from({ length: 6 }, (_, index) => ({
        bibcode: `distractor-${callNumber}-${index}`,
        title: [`Redback pulsar population study ${index}`],
        author: ["Other, Author"],
        year: 2019,
        abstract: "Redback pulsar demographics.",
        property: ["ARTICLE", "REFEREED"],
        doctype: "article"
      }));
    return { ok: true, async json() { return { response: { docs } }; } };
  };
  try {
    const results = await harness.hooks.searchLiterature({
      token: "Strader2019",
      searchMode: "contextual",
      sentenceText: "09 solar masses",
      citationPrefixText: "Redback pulsars appear systematically massive with a median inferred neutron star mass",
      citationSuffixText: ".",
      contextText: "Redback pulsars appear systematically massive with a median inferred neutron star mass.",
      parsedKeyHint: { surname: "Strader", year: 2019, suffix: "" }
    });
    assert.equal(results[0].bibcode, "strader-target");
    assert.ok(calls >= 10 && calls <= 14, "at most one extra checkpoint may be prefetched");
    assert.equal(maxActiveRequests, 4, "contextual fallback queries should run in bounded groups of four");
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

test("fresh install stores the simple-search, return-to-source, and alphabetical bibliography defaults", async () => {
  const harness = await loadBackgroundHarness();
  await harness.installedListener();
  assert.equal(harness.store.defaultSearchMode, "simple");
  assert.equal(harness.store.returnToSourceAfterInsert, true);
  assert.equal(harness.store.bibliographyInsertMode, "alphabetical");
});

test("install migration preserves an explicit append bibliography preference", async () => {
  const harness = await loadBackgroundHarness({ bibliographyInsertMode: "append" });
  await harness.installedListener();
  assert.equal(harness.store.bibliographyInsertMode, "append");
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
