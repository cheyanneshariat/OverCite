import test from "node:test";
import assert from "node:assert/strict";

import {
  rerankAdsCandidates as rerankBrowserAdsCandidates
} from "../src/core/ads.js";
import {
  applyContextualBetaReranking as rerankBrowserContextualBeta,
  contextualIdentityTier
} from "../src/core/contextual-beta.js";
import {
  rerankAdsCandidates as rerankVsCodeAdsCandidates
} from "../../vscode-extension/src/core/ads.js";
import {
  applyContextualBetaReranking as rerankVsCodeContextualBeta
} from "../../vscode-extension/src/core/contextual-beta.js";
import { CONTEXTUAL_RANKING_CORPUS } from "./fixtures/contextual-ranking-corpus.js";

function metrics(ranker) {
  let reciprocalRank = 0;
  let top1 = 0;
  let top3 = 0;
  for (const example of CONTEXTUAL_RANKING_CORPUS) {
    const ranked = ranker(example.context, example.candidates);
    const rank = ranked.findIndex((candidate) => candidate.bibcode === example.expectedBibcode) + 1;
    assert.ok(rank > 0, `${example.id}: expected record disappeared`);
    reciprocalRank += 1 / rank;
    top1 += Number(rank === 1);
    top3 += Number(rank <= 3);
  }
  const count = CONTEXTUAL_RANKING_CORPUS.length;
  return { top1: top1 / count, top3: top3 / count, mrr: reciprocalRank / count };
}

test("frozen contextual corpus meets the browser accuracy gate", () => {
  assert.deepEqual(metrics(rerankBrowserAdsCandidates), { top1: 1, top3: 1, mrr: 1 });
});

test("Context Beta meets the cross-field accuracy gate in both browser and VS Code cores", () => {
  const browserRanker = (context, candidates) => rerankBrowserContextualBeta(
    context,
    rerankBrowserAdsCandidates(context, candidates)
  );
  const vscodeRanker = (context, candidates) => rerankVsCodeContextualBeta(
    context,
    rerankVsCodeAdsCandidates(context, candidates)
  );
  assert.deepEqual(metrics(browserRanker), { top1: 1, top3: 1, mrr: 1 });
  assert.deepEqual(metrics(vscodeRanker), { top1: 1, top3: 1, mrr: 1 });

  for (const example of CONTEXTUAL_RANKING_CORPUS) {
    assert.deepEqual(
      browserRanker(example.context, example.candidates).map((candidate) => candidate.bibcode),
      vscodeRanker(example.context, example.candidates).map((candidate) => candidate.bibcode),
      `${example.id}: browser and VS Code rankings diverged`
    );
  }
});

test("Context Beta cannot affect simple search or raw query ordering", () => {
  const candidates = [{ bibcode: "first" }, { bibcode: "second" }];
  for (const searchMode of ["simple", "direct"]) {
    assert.strictEqual(
      rerankBrowserContextualBeta({ searchMode }, candidates),
      candidates
    );
  }
});

test("Context Beta recognizes apostrophized family names without admitting unrelated year matches", () => {
  const context = {
    token: "ODoherty2023",
    searchMode: "contextual",
    parsedKeyHint: { surname: "Doherty", year: 2023, firstInitial: "O", suffix: "" }
  };
  assert.equal(contextualIdentityTier(context, { authors: ["O'Doherty, Tyrone"], year: 2023 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["XDoherty, Alex"], year: 2023 }), 0);
  assert.equal(contextualIdentityTier(context, { authors: ["X-Doherty, Alex"], year: 2023 }), 0);
  assert.equal(contextualIdentityTier(context, { authors: ["X'Doherty, Alex"], year: 2023 }), 0);
  assert.equal(contextualIdentityTier(context, { authors: ["Doherty, Carolyn"], year: 2017 }), 0);
});

test("Context Beta uses parsed first initials to separate same-surname records", () => {
  const context = {
    token: "SmithA2024",
    searchMode: "contextual",
    parsedKeyHint: { surname: "Smith", year: 2024, firstInitial: "A", suffix: "" }
  };
  assert.equal(contextualIdentityTier(context, { authors: ["Smith, Alice"], year: 2024 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["Smith, Bob"], year: 2024 }), 2);
});

test("Context Beta recovers author identity from irregular DBLP-style keys", () => {
  const ranked = rerankBrowserContextualBeta(
    {
      token: "DBLP:journals/corr/GidarisK15",
      searchMode: "contextual",
      sentenceText: "A multi-region CNN combines object detection with semantic segmentation.",
      citationPrefixText: "A multi-region CNN combines object detection with semantic segmentation",
      citationSuffixText: ".",
      contextText: "Multi-region object detection and semantic segmentation.",
      parsedKeyHint: { surname: "DBLP:journals/corr/GidarisK", year: 2015, firstInitial: null, suffix: "" }
    },
    [
      { bibcode: "distractor", title: "Network in Network", authors: ["Lin, Min"], year: 2013, score: 180 },
      { bibcode: "target", title: "Object Detection via a Multi-Region and Semantic Segmentation-Aware CNN Model", authors: ["Gidaris, Spyros"], year: 2015, score: 120 }
    ]
  );
  assert.equal(ranked[0].bibcode, "target");
});

test("Context Beta ignores opaque reference-manager identity hints", () => {
  const context = {
    token: "RN75",
    searchMode: "contextual",
    sentenceText: "Magnetic braking shapes the evolution of close binaries.",
    citationPrefixText: "Magnetic braking shapes the evolution of close binaries",
    citationSuffixText: ".",
    contextText: "Magnetic braking shapes the evolution of close binaries.",
    parsedKeyHint: { surname: "R", firstInitial: "N", year: 2025, suffix: "" }
  };
  assert.equal(contextualIdentityTier(context, { authors: ["R, Nora"], year: 2025 }), 0);

  const candidates = [
    { bibcode: "wrong-author", title: "A General Survey", authors: ["R, Nora"], year: 2025, score: 100 },
    { bibcode: "context-match", title: "Magnetic Braking Shapes the Evolution of Close Binaries", authors: ["Other, Alex"], year: 2019, score: 99 }
  ];
  assert.equal(rerankBrowserContextualBeta(context, candidates)[0].bibcode, "context-match");
});

test("Context Beta preserves classic order when same-tier evidence is nearly tied", () => {
  const candidates = [
    { bibcode: "classic-first", title: "A Binary Star Survey", authors: ["Smith, Alice"], year: 2024, score: 100 },
    { bibcode: "classic-second", title: "A Binary Star Census", authors: ["Smith, Alice"], year: 2024, score: 99 }
  ];
  const ranked = rerankBrowserContextualBeta(
    {
      token: "Smith2024",
      searchMode: "contextual",
      sentenceText: "Binary stars are common.",
      citationPrefixText: "Binary stars are common",
      citationSuffixText: ".",
      contextText: "Binary stars are common.",
      parsedKeyHint: { surname: "Smith", year: 2024, firstInitial: null, suffix: "" }
    },
    candidates
  );
  assert.deepEqual(ranked.map((candidate) => candidate.bibcode), ["classic-first", "classic-second"]);
});

test("Context Beta does not let the next sentence describe the wrong same-author paper", () => {
  const candidates = [
    {
      bibcode: "target",
      title: "Faster R-CNN: Towards Real-Time Object Detection with Region Proposal Networks",
      authors: ["Ren, Shaoqing"],
      year: 2015,
      score: 100
    },
    {
      bibcode: "next-paper",
      title: "Object Detection Networks on Convolutional Feature Maps",
      authors: ["Ren, Shaoqing"],
      year: 2015,
      score: 99
    }
  ];
  const ranked = rerankBrowserContextualBeta(
    {
      token: "Ren2015",
      searchMode: "contextual",
      sentenceText: "Unlike VGG-16 used in, our ResNet has no hidden fully connected layers.",
      citationPrefixText: "Earlier unrelated discussion. Unlike VGG-16 used in",
      citationSuffixText: ", our ResNet has no hidden fully connected layers. We next adopt object detection networks on convolutional feature maps.",
      contextText: "Unlike VGG-16 used in, our ResNet has no hidden fully connected layers. We next adopt object detection networks on convolutional feature maps.",
      parsedKeyHint: { surname: "Ren", year: 2015, firstInitial: null, suffix: "" }
    },
    candidates
  );
  assert.equal(ranked[0].bibcode, "target");
});

test("Context Beta does not reorder sparse token-only contexts from lexical coincidences", () => {
  const candidates = [
    { bibcode: "classic-first", title: "A Reliable Baseline", authors: ["Author, Alice"], year: 2024, score: 100 },
    { bibcode: "lexical-trap", title: "Blacksmith Networks", authors: ["Other, Bob"], year: 2024, score: 99 }
  ];
  const ranked = rerankBrowserContextualBeta({ token: "Smith2024", searchMode: "contextual" }, candidates);
  assert.deepEqual(ranked.map((candidate) => candidate.bibcode), ["classic-first", "lexical-trap"]);
});

test("Context Beta recognizes an uppercase citation key as a title acronym when prose is present", () => {
  const context = {
    token: "SCONE",
    searchMode: "contextual",
    sentenceText: "We normalized the single-cell expression matrix before clustering.",
    citationPrefixText: "We normalized the single-cell expression matrix before clustering",
    citationSuffixText: ".",
    contextText: "We normalized the single-cell expression matrix before clustering."
  };
  const candidates = [
    { bibcode: "classic-first", title: "Single Cell Analysis Benchmarks", authors: ["Other, Alice"], year: 2016, score: 100 },
    { bibcode: "target", title: "Single Cell Overview of Normalized Expression Data", authors: ["Cole, Michael"], year: 2016, score: 99 }
  ];
  for (const ranker of [rerankBrowserContextualBeta, rerankVsCodeContextualBeta]) {
    const ranked = ranker(context, candidates);
    assert.equal(ranked[0].bibcode, "target");
    assert.equal(ranked[0].contextualBeta.modelVersion, "context-hybrid-4");
  }
});

test("Context Beta does not trust an acronym key without surrounding prose", () => {
  const candidates = [
    { bibcode: "classic-first", title: "A Reliable Baseline", authors: ["Author, Alice"], year: 2024, score: 100 },
    { bibcode: "acronym-trap", title: "Sparse Context Only Never Enough", authors: ["Other, Bob"], year: 2024, score: 99 }
  ];
  const ranked = rerankBrowserContextualBeta({ token: "SCONE", searchMode: "contextual" }, candidates);
  assert.deepEqual(ranked.map((candidate) => candidate.bibcode), ["classic-first", "acronym-trap"]);
});

test("Context Beta does not trust acronym or phrase keys with citation-only boilerplate", () => {
  for (const sentence of [
    "See.",
    "See the cited reference.",
    "See the cited reference for details.",
    "As discussed above.",
    "See the next section.",
    "See the relevant article.",
    "See the original paper for details.",
    "As shown elsewhere.",
    "See the bibliographic entry.",
    "See the relevant bibliographic entry.",
    "See the cited bibliographic record."
  ]) {
    for (const [token, title] of [
      ["SCONE", "Sparse Context Only Never Enough"],
      ["neural_gpu", "Neural GPUs Learn Algorithms"]
    ]) {
      const context = {
        token,
        searchMode: "contextual",
        sentenceText: sentence,
        citationPrefixText: sentence.slice(0, -1),
        citationSuffixText: ".",
        contextText: sentence
      };
      const candidates = [
        { bibcode: "classic-first", title: "A Reliable Baseline", score: 100 },
        { bibcode: "title-trap", title, score: 99 }
      ];
      for (const ranker of [rerankBrowserContextualBeta, rerankVsCodeContextualBeta]) {
        assert.deepEqual(ranker(context, candidates).map((candidate) => candidate.bibcode), ["classic-first", "title-trap"]);
      }
    }
  }
});

test("Context Beta does not match an acronym hidden inside a longer title acronym", () => {
  const context = {
    token: "NLP",
    searchMode: "contextual",
    sentenceText: "We compare several calibration methods.",
    citationPrefixText: "We compare several calibration methods",
    citationSuffixText: ".",
    contextText: "We compare several calibration methods."
  };
  const candidates = [
    { bibcode: "classic-first", title: "A Reliable Baseline", score: 100 },
    { bibcode: "substring-trap", title: "Advanced Network Learning Physics", score: 99 }
  ];
  for (const ranker of [rerankBrowserContextualBeta, rerankVsCodeContextualBeta]) {
    assert.deepEqual(ranker(context, candidates).map((candidate) => candidate.bibcode), ["classic-first", "substring-trap"]);
  }
});

test("Context Beta recognizes a unique multi-term key phrase in a title", () => {
  const context = {
    token: "neural_gpu",
    searchMode: "contextual",
    sentenceText: "The model learns an algorithm from examples.",
    citationPrefixText: "The model learns an algorithm from examples",
    citationSuffixText: ".",
    contextText: "The model learns an algorithm from examples."
  };
  const candidates = [
    { bibcode: "classic-first", title: "A Generic Neural Algorithm", authors: ["Other, Alice"], year: 2016, score: 100 },
    { bibcode: "target", title: "Neural GPUs Learn Algorithms", authors: ["Kaiser, Lukasz"], year: 2016, score: 99 }
  ];
  for (const ranker of [rerankBrowserContextualBeta, rerankVsCodeContextualBeta]) {
    assert.equal(ranker(context, candidates)[0].bibcode, "target");
  }
});

test("Context Beta preserves existing order when an acronym expands to multiple titles", () => {
  const context = {
    token: "VQE",
    searchMode: "contextual",
    sentenceText: "We compare several optimizer implementations.",
    citationPrefixText: "We compare several optimizer implementations",
    citationSuffixText: ".",
    contextText: "We compare several optimizer implementations."
  };
  const candidates = [
    { bibcode: "classic-first", title: "A Variational Eigenvalue Solver on a Photonic Quantum Processor", score: 100 },
    { bibcode: "ambiguous-one", title: "Variational Quantum Eigensolver for Molecules", score: 99 },
    { bibcode: "ambiguous-two", title: "Variational Quantum Eigensolver with Symmetry", score: 98 }
  ];
  for (const ranker of [rerankBrowserContextualBeta, rerankVsCodeContextualBeta]) {
    assert.deepEqual(ranker(context, candidates).map((candidate) => candidate.bibcode), [
      "classic-first",
      "ambiguous-one",
      "ambiguous-two"
    ]);
  }
});

test("Context Beta derives title hints from parsed key suffixes in production-shaped contexts", () => {
  const ranked = rerankBrowserContextualBeta(
    {
      token: "Smith2024graphNeural",
      searchMode: "contextual",
      parsedKeyHint: { surname: "Smith", year: 2024, firstInitial: null, suffix: "graphNeural" }
    },
    [
      { bibcode: "classic-first", title: "A Statistical Survey", authors: ["Smith, Alice"], year: 2024, score: 100 },
      { bibcode: "target", title: "Graph Neural Networks", authors: ["Smith, Alice"], year: 2024, score: 99 }
    ]
  );
  assert.equal(ranked[0].bibcode, "target");
});

test("Context Beta bounds oversized editor context without changing nearby evidence", () => {
  const candidates = [
    { bibcode: "wrong", title: "A Generic Baseline", authors: ["Smith, Alice"], year: 2024, score: 100 },
    { bibcode: "target", title: "Quantum Error Correction with Surface Codes", authors: ["Smith, Alice"], year: 2024, score: 99 }
  ];
  const base = {
    token: "Smith2024",
    searchMode: "contextual",
    sentenceText: "Quantum error correction with surface codes improves fault tolerance.",
    citationPrefixText: "Quantum error correction with surface codes",
    citationSuffixText: ".",
    parsedKeyHint: { surname: "Smith", year: 2024, firstInitial: null, suffix: "" }
  };
  const shortRank = rerankBrowserContextualBeta({ ...base, contextText: base.sentenceText }, candidates);
  const longRank = rerankBrowserContextualBeta({
    ...base,
    contextText: `${base.sentenceText} ${"unrelated appendix material ".repeat(100_000)}`
  }, candidates);
  assert.deepEqual(longRank.map((candidate) => candidate.bibcode), shortRank.map((candidate) => candidate.bibcode));
});

test("Context Beta lets an explicit exact title override an ambiguous surname-year tier", () => {
  const ranked = rerankBrowserContextualBeta(
    {
      token: "Vaswani2017",
      searchMode: "contextual",
      sentenceText: "Attention Is All You Need is the target publication.",
      citationPrefixText: "Attention Is All You Need",
      citationSuffixText: ".",
      contextText: "Attention Is All You Need is the target publication.",
      parsedKeyHint: { surname: "Vaswani", year: 2017, firstInitial: null, suffix: "" }
    },
    [
      { bibcode: "wrong", title: "Low-Rank Phase Retrieval", authors: ["Vaswani, Namrata"], year: 2017, score: 8000 },
      { bibcode: "target", title: "Attention Is All You Need", authors: ["Vaswani, Ashish"], year: 2017, score: 1000 }
    ]
  );
  assert.equal(ranked[0].bibcode, "target");
  assert.equal(ranked[0].contextualBeta.decisiveTitleMatch, true);
  assert.equal(ranked[0].contextualBeta.identityTier, 5);
});

test("Context Beta never lets an unrelated exact sentence title override hard identity", () => {
  const ranked = rerankBrowserContextualBeta(
    {
      token: "Smith2024",
      searchMode: "contextual",
      sentenceText: "Rare Quantum Cosmic Galaxy is widely used here.",
      parsedKeyHint: { surname: "Smith", year: 2024, firstInitial: null, suffix: "" }
    },
    [
      { bibcode: "valid", title: "A Generic Survey", authors: ["Smith, Alice"], year: 2024, score: 100 },
      { bibcode: "wrong", title: "Rare Quantum Cosmic Galaxy", authors: ["Other, Author"], year: 2024, score: 1000 }
    ]
  );
  assert.equal(ranked[0].bibcode, "valid");
  assert.equal(ranked[1].contextualBeta.decisiveTitleMatch, false);
});

test("Context Beta keeps exact identifiers above title evidence", () => {
  const ranked = rerankBrowserContextualBeta(
    {
      token: "2024ApJ...123..456S",
      searchMode: "contextual",
      sentenceText: "Rare Quantum Cosmic Galaxy is widely used here."
    },
    [
      { bibcode: "2024ApJ...123..456S", title: "Exact Metadata Record", authors: ["Smith, Alice"], year: 2024, score: 100 },
      { bibcode: "wrong", title: "Rare Quantum Cosmic Galaxy", authors: ["Other, Author"], year: 2024, score: 1000 }
    ]
  );
  assert.equal(ranked[0].bibcode, "2024ApJ...123..456S");
  assert.equal(ranked[0].contextualBeta.identityTier, 6);
});

test("Context Beta accepts only complete arXiv identifiers as hard identity", () => {
  assert.equal(contextualIdentityTier({
    token: "arXiv:2401.01234v2",
    searchMode: "contextual"
  }, { eprint: "2401.01234" }), 6);
  assert.notEqual(contextualIdentityTier({
    token: "paper2401.01234draft",
    searchMode: "contextual"
  }, { eprint: "2401.01234" }), 6);
  assert.notEqual(contextualIdentityTier({
    token: "doi:10.1234/2401.01234",
    searchMode: "contextual"
  }, { eprint: "2401.01234" }), 6);
});

test("Context Beta matches ASCII citation keys to extended-Latin author metadata", () => {
  const context = {
    token: "Lukaszewicz2020",
    searchMode: "contextual",
    parsedKeyHint: { surname: "Lukaszewicz", year: 2020, firstInitial: null, suffix: "" }
  };
  assert.equal(contextualIdentityTier(context, { authors: ["Łukaszewicz, Anna"], year: 2020 }), 4);
});

test("Context Beta recognizes collaboration-style first authors", () => {
  const context = {
    token: "KATRIN2025",
    searchMode: "contextual",
    parsedKeyHint: { surname: "KATRIN", year: 2025, firstInitial: null, suffix: "" }
  };
  assert.equal(contextualIdentityTier(context, { authors: ["KATRIN Collaboration"], year: 2025 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["The KATRIN Collaboration"], year: 2025 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["Kiessling, Tim", "Katrin, Kruse"], year: 2025 }), 2);

  const planck = {
    token: "PlanckCollaboration18",
    searchMode: "contextual",
    parsedKeyHint: { surname: "PlanckCollaboration", year: 2018, firstInitial: null, suffix: "" }
  };
  assert.equal(contextualIdentityTier(planck, { authors: ["Planck Scientific Collaboration"], year: 2018 }), 4);
});

test("Context Beta keeps collaboration identity exact at the surname boundary", () => {
  const context = {
    token: "Planck2020",
    searchMode: "contextual",
    parsedKeyHint: { surname: "Planck", year: 2020, firstInitial: null, suffix: "" }
  };
  assert.equal(contextualIdentityTier(context, { authors: ["Planck Collaboration"], year: 2020 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["Planck Scientific Collaboration"], year: 2020 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["The Planck Scientific Collaboration"], year: 2020 }), 4);
  assert.equal(contextualIdentityTier(context, { authors: ["Planckman Collaboration"], year: 2020 }), 0);
  assert.equal(contextualIdentityTier(context, { authors: ["Planck, Max"], year: 2020 }), 4);
});
