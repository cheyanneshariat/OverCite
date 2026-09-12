import test from "node:test";
import assert from "node:assert/strict";

process.env.OVERCITE_ADS_SEARCH_REQUEST_TIMEOUT_MS = "30";
process.env.OVERCITE_ADS_SEARCH_BUDGET_MS = "80";

const { searchAds } = await import(`../src/service.js?timeout-test=${Date.now()}`);

test("VS Code ADS search aborts a stalled contextual request within its deadline", async () => {
  let aborted = false;
  const startedAt = Date.now();
  const hangingFetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      aborted = true;
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }, { once: true });
  });

  await assert.rejects(
    searchAds({
      token: "Strader2019",
      searchMode: "contextual",
      citationPrefixText: "Redback pulsars appear systematically massive",
      parsedKeyHint: { surname: "Strader", year: 2019 }
    }, {
      adsApiToken: "token",
      sourceProfile: "astrophysics"
    }, hangingFetch),
    /ADS\/SciX search took longer than/
  );

  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < 250, "stalled ADS work must remain bounded");
});
