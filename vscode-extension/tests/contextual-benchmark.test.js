import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdsQueries as buildVsCodeAdsQueries,
  rerankAdsCandidates as rerankVsCodeAdsCandidates
} from "../src/core/ads.js";
import {
  buildAdsQueries as buildBrowserAdsQueries,
  rerankAdsCandidates as rerankBrowserAdsCandidates
} from "../../extension/src/core/ads.js";
import { CONTEXTUAL_RANKING_CORPUS } from "../../extension/tests/fixtures/contextual-ranking-corpus.js";

test("frozen contextual corpus meets the VS Code accuracy gate", () => {
  let reciprocalRank = 0;
  let top1 = 0;
  let top3 = 0;
  for (const example of CONTEXTUAL_RANKING_CORPUS) {
    const ranked = rerankVsCodeAdsCandidates(example.context, example.candidates);
    const rank = ranked.findIndex((candidate) => candidate.bibcode === example.expectedBibcode) + 1;
    assert.ok(rank > 0, `${example.id}: expected record disappeared`);
    reciprocalRank += 1 / rank;
    top1 += Number(rank === 1);
    top3 += Number(rank <= 3);
  }
  const count = CONTEXTUAL_RANKING_CORPUS.length;
  assert.deepEqual({ top1: top1 / count, top3: top3 / count, mrr: reciprocalRank / count }, { top1: 1, top3: 1, mrr: 1 });
});

test("browser and VS Code contextual query and ranking behavior stay identical", () => {
  for (const example of CONTEXTUAL_RANKING_CORPUS) {
    assert.deepEqual(
      buildVsCodeAdsQueries(example.context),
      buildBrowserAdsQueries(example.context),
      `${example.id}: query ladders diverged`
    );
    assert.deepEqual(
      rerankVsCodeAdsCandidates(example.context, example.candidates).map((candidate) => candidate.bibcode),
      rerankBrowserAdsCandidates(example.context, example.candidates).map((candidate) => candidate.bibcode),
      `${example.id}: ranking diverged`
    );
  }
});
