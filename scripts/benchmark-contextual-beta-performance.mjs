import { performance } from "node:perf_hooks";
import { rerankAdsCandidates as rerankBrowserCandidates } from "../extension/src/core/ads.js";
import { applyContextualBetaReranking as applyBrowserBeta } from "../extension/src/core/contextual-beta.js";
import { rerankAdsCandidates as rerankVsCodeCandidates } from "../vscode-extension/src/core/ads.js";
import { applyContextualBetaReranking as applyVsCodeBeta } from "../vscode-extension/src/core/contextual-beta.js";

const candidateCount = Number(process.env.OVERCITE_PERF_CANDIDATES ?? 250);
const iterations = Number(process.env.OVERCITE_PERF_ITERATIONS ?? 200);
const p95BudgetMs = Number(process.env.OVERCITE_PERF_P95_BUDGET_MS ?? 50);

const context = {
  token: "Smith2024",
  searchMode: "contextual",
  sentenceText: "A multi-region neural network combines object detection with semantic segmentation.",
  citationPrefixText: "A multi-region neural network combines object detection with semantic segmentation",
  citationSuffixText: ".",
  contextText: "Object detection uses feature maps, region proposals, and semantic segmentation.",
  parsedKeyHint: { surname: "Smith", year: 2024, firstInitial: null, suffix: "" }
};

const candidates = Array.from({ length: candidateCount }, (_, index) => ({
  bibcode: `candidate-${index}`,
  title: index === 137
    ? "Multi-Region Neural Networks for Object Detection and Semantic Segmentation"
    : `Study ${index} of Neural Models and Scientific Data`,
  authors: [index % 9 === 0 ? "Smith, Alice" : `Author${index}, Example`],
  year: 2018 + (index % 8),
  abstract: `Candidate ${index} studies feature representations, data, and model evaluation.`,
  citationCount: candidateCount - index,
  property: ["ARTICLE", "REFEREED"],
  doctype: "article",
  score: 0
}));

const cases = [
  {
    platform: "browser",
    classic: () => rerankBrowserCandidates(context, candidates),
    beta: () => applyBrowserBeta(context, rerankBrowserCandidates(context, candidates))
  },
  {
    platform: "vscode",
    classic: () => rerankVsCodeCandidates(context, candidates),
    beta: () => applyVsCodeBeta(context, rerankVsCodeCandidates(context, candidates))
  }
];

const report = { candidateCount, iterations, p95BudgetMs, results: [] };
for (const benchmarkCase of cases) {
  for (let index = 0; index < 20; index += 1) benchmarkCase.beta();
  const classic = measure(benchmarkCase.classic, iterations);
  const beta = measure(benchmarkCase.beta, iterations);
  const result = {
    platform: benchmarkCase.platform,
    classic,
    beta,
    betaOverheadMedianMs: round(beta.medianMs - classic.medianMs),
    betaOverheadP95Ms: round(beta.p95Ms - classic.p95Ms)
  };
  report.results.push(result);
}

console.log(JSON.stringify(report, null, 2));
const failures = report.results.filter((result) => result.beta.p95Ms > p95BudgetMs);
if (failures.length) {
  throw new Error(`Context Beta exceeded the ${p95BudgetMs} ms p95 budget: ${failures.map((result) => result.platform).join(", ")}`);
}

function measure(fn, count) {
  const timings = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    fn();
    timings.push(performance.now() - started);
  }
  timings.sort((left, right) => left - right);
  return {
    medianMs: round(percentile(timings, 0.5)),
    p95Ms: round(percentile(timings, 0.95)),
    maxMs: round(timings.at(-1) ?? 0)
  };
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.floor(values.length * quantile))];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
