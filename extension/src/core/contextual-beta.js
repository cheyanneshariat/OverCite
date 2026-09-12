import { CONTEXT_STOPWORDS } from "./constants.js";
import { normalizeContextualCitationContext } from "./citation.js";
import { rerankAdsCandidates } from "./ads.js";

// Contextual Search Beta is a deliberately small, local feature ranker.
// It reranks provider candidates only; it never invents papers or metadata.
// Explicit identifiers and author/year constraints remain hard ordering tiers.
export const CONTEXTUAL_BETA_MODEL_VERSION = "context-hybrid-4";
const MIN_TIER_MODEL_SPREAD = 20;
const MAX_SENTENCE_CHARS = 4_000;
const MAX_PREFIX_CHARS = 4_000;
const MAX_SUFFIX_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 12_000;

const MODEL_WEIGHTS = Object.freeze({
  titleCoverage: 190,
  abstractCoverage: 58,
  titleSpecificity: 70,
  titleBigramCoverage: 72,
  abstractBigramCoverage: 18,
  identifierCoverage: 105,
  keyTitleCoverage: 155,
  softwareTitleMatch: 260,
  tokenAuthorMatch: 210,
  tokenTitleMatch: 210,
  tokenTitlePhraseMatch: 260,
  tokenTitleAcronymMatch: 260
});

const PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "el", "la", "le", "van", "von"]);
const GENERIC_CONTEXT_TERMS = new Set([
  "analysis", "approach", "data", "distribution", "model", "models", "method", "methods",
  "measurement", "measurements", "population", "populations", "sample", "samples", "system", "systems"
]);
const CITATION_BOILERPLATE_TERMS = new Set([
  "above", "article", "below", "bibliograph", "bibliographic", "bibliography", "cit",
  "citation", "detail", "discuss", "earlier", "elsewhere", "entry", "follow", "later",
  "next", "original", "paper", "previous", "prior", "record", "refer", "reference",
  "referenc", "relevant", "section", "see", "show", "shown", "source", "use", "work"
]);

export function applyContextualBetaReranking(citationContext, rankedCandidates) {
  if (citationContext?.searchMode !== "contextual" || !Array.isArray(rankedCandidates) || rankedCandidates.length === 0) {
    return rankedCandidates;
  }

  const normalizedContext = normalizeContextualCitationContext(citationContext, "beta");
  if (normalizedContext !== citationContext) {
    rankedCandidates = rerankAdsCandidates(normalizedContext, rankedCandidates);
    citationContext = normalizedContext;
  }

  const evidence = buildContextEvidence(citationContext);
  evidence.tokenTitleSignalCounts = countTokenTitleSignals(citationContext, rankedCandidates, evidence);
  const documentFrequencies = buildDocumentFrequencies(rankedCandidates);
  const ranked = rankedCandidates.map((candidate, baselineIndex) => {
    const features = contextualBetaFeatures(citationContext, candidate, evidence, documentFrequencies, rankedCandidates.length);
    const modelScore = dotModel(features);
    const decisiveTitleMatch = hasDecisiveTitleMatch(citationContext, candidate);
    const identityTier = contextualIdentityTier(citationContext, candidate, decisiveTitleMatch);
    return {
      ...candidate,
      score: Number(candidate?.score ?? 0) + modelScore,
      contextualBeta: {
        modelVersion: CONTEXTUAL_BETA_MODEL_VERSION,
        modelScore,
        identityTier,
        decisiveTitleMatch
      },
      __contextualBetaBaselineIndex: baselineIndex
    };
  });
  const tierModelSpreads = modelScoreSpreadsByTier(ranked);

  return ranked
    .sort((left, right) => {
      const tierDifference = Number(right.contextualBeta?.identityTier ?? 0) - Number(left.contextualBeta?.identityTier ?? 0);
      if (tierDifference) return tierDifference;
      const tier = Number(left.contextualBeta?.identityTier ?? 0);
      if (Number(tierModelSpreads.get(tier) ?? 0) < MIN_TIER_MODEL_SPREAD) {
        return Number(left.__contextualBetaBaselineIndex ?? 0) - Number(right.__contextualBetaBaselineIndex ?? 0);
      }
      return Number(right.score ?? 0) - Number(left.score ?? 0) ||
        Number(right.citationCount ?? 0) - Number(left.citationCount ?? 0) ||
        Number(left.__contextualBetaBaselineIndex ?? 0) - Number(right.__contextualBetaBaselineIndex ?? 0);
    })
    .map(({ __contextualBetaBaselineIndex, ...candidate }) => candidate);
}

export function contextualBetaFeatures(citationContext, candidate, suppliedEvidence = null, documentFrequencies = null, candidateCount = 1) {
  citationContext = normalizeContextualCitationContext(citationContext, "beta");
  const evidence = suppliedEvidence ?? buildContextEvidence(citationContext);
  const titleTerms = uniqueTerms(candidate?.title);
  const abstractTerms = uniqueTerms(candidate?.abstract);
  const titleSet = new Set(titleTerms);
  const abstractSet = new Set(abstractTerms);
  const frequencies = documentFrequencies ?? buildDocumentFrequencies([candidate]);
  const totalEvidenceWeight = sumEvidenceWeight(evidence.weightedTerms, frequencies, candidateCount);
  const titleCoverage = weightedEvidenceCoverage(evidence.weightedTerms, titleSet, frequencies, candidateCount, totalEvidenceWeight);
  const abstractCoverage = weightedEvidenceCoverage(evidence.weightedTerms, abstractSet, frequencies, candidateCount, totalEvidenceWeight);
  const titleSpecificity = weightedCandidateSpecificity(titleTerms, evidence.termSet, frequencies, candidateCount);
  const titleBigramCoverage = bigramCoverage(evidence.proximalTerms, titleTerms);
  const abstractBigramCoverage = bigramCoverage(evidence.proximalTerms, abstractTerms);
  const identifierCoverage = setCoverage(evidence.identifiers, new Set([
    ...titleSet,
    ...abstractSet,
    ...extractIdentifiers(candidateMetadataText(candidate))
  ]));
  const keyTerms = contextualKeyTerms(citationContext);
  const keyTitleCoverage = setCoverage(keyTerms, titleSet);
  const softwareName = softwareNameHint(citationContext);
  const normalizedTitle = normalize(candidate?.title);
  const softwareTitleMatch = softwareName && normalizedTitle.includes(softwareName) ? 1 : 0;
  const tokenTerms = evidence.hasSubstantiveProse
    ? tokenLexicalTerms(citationContext?.token)
    : new Set();
  const authorFamilies = (Array.isArray(candidate?.authors) ? candidate.authors : []).map(authorFamily).filter(Boolean);
  const tokenAuthorMatch = authorFamilies.some((family) => lexicalTermMatchesCompactValue(tokenTerms, family)) ? 1 : 0;
  const tokenTitleMatch = titleTerms.some((term) => tokenTerms.has(term)) ? 1 : 0;
  const tokenTitlePhraseMatch = evidence.hasSubstantiveProse &&
    Number(evidence.tokenTitleSignalCounts?.phrase ?? 1) === 1 &&
    titlePhraseMatchesToken(tokenTerms, titleTerms) ? 1 : 0;
  const tokenTitleAcronymMatch = evidence.hasSubstantiveProse &&
    Number(evidence.tokenTitleSignalCounts?.acronym ?? 1) === 1 &&
    titleAcronymMatchesToken(citationContext?.token, titleTerms) ? 1 : 0;

  return {
    titleCoverage,
    abstractCoverage,
    titleSpecificity,
    titleBigramCoverage,
    abstractBigramCoverage,
    identifierCoverage,
    keyTitleCoverage,
    softwareTitleMatch,
    tokenAuthorMatch,
    tokenTitleMatch,
    tokenTitlePhraseMatch,
    tokenTitleAcronymMatch
  };
}

export function contextualIdentityTier(citationContext, candidate, decisiveTitleMatch = hasDecisiveTitleMatch(citationContext, candidate)) {
  if (candidateIdentifierMatches(citationContext, candidate)) return 6;
  const hint = contextualParsedKeyHint(citationContext);
  if (!hint?.surname) {
    if (decisiveTitleMatch) return 5;
    return Number(candidate?.primaryMatchTier ?? 0);
  }
  const expectedYear = Number(hint.year);
  const candidateYear = Number(candidate?.year);
  const exactYear = Number.isFinite(expectedYear) && Number.isFinite(candidateYear) && expectedYear === candidateYear;
  const adjacentYear = Number.isFinite(expectedYear) && Number.isFinite(candidateYear) && Math.abs(expectedYear - candidateYear) === 1;
  const authors = Array.isArray(candidate?.authors) ? candidate.authors : [];
  const firstFamily = authorFamily(authors[0]);
  const allFamilies = authors.map(authorFamily).filter(Boolean);
  const normalizedHint = compact(hint.surname);
  const firstMatches = Boolean(normalizedHint && familyMatchesHint(firstFamily, normalizedHint));
  const anyMatches = Boolean(normalizedHint && allFamilies.some((family) => familyMatchesHint(family, normalizedHint)));
  const compoundMatches = compoundAuthorKeyMatches(hint.surname, allFamilies);
  const groupMatches = groupAuthorMatchesHint(authors[0], normalizedHint);
  const initialCompatible = !hint.firstInitial || !authorGivenInitial(authors[0]) ||
    compact(authorGivenInitial(authors[0])) === compact(hint.firstInitial) ||
    familyParticleInitialMatches(firstFamily, normalizedHint, hint.firstInitial);
  const strongFirstMatch = (firstMatches && initialCompatible) || compoundMatches || groupMatches;

  if (decisiveTitleMatch && strongFirstMatch &&
      (!hint.year || exactYear || adjacentYear)) {
    return 5;
  }

  if (hint.year) {
    if (exactYear && strongFirstMatch) return 4;
    // Broad-provider issue years can differ from the preprint/key year.
    // Let topical evidence order these same-author candidates together.
    if (adjacentYear && strongFirstMatch) return candidate.sourceId && candidate.sourceId !== "ads" ? 4 : 3;
    if (exactYear && anyMatches) return 2;
    if (strongFirstMatch) return 1;
    return 0;
  }
  if (strongFirstMatch) return 3;
  if (anyMatches) return 2;
  return 0;
}

function hasDecisiveTitleMatch(citationContext, candidate) {
  if (citationContext?.searchMode !== "contextual") return false;
  const lead = extractSentenceLead(boundedText(citationContext?.sentenceText, MAX_SENTENCE_CHARS));
  const normalizedLead = normalize(lead);
  const normalizedTitle = normalize(candidate?.title);
  const exactTitle = Boolean(
    normalizedLead &&
    normalizedTitle &&
    terms(normalizedLead).length >= 4 &&
    normalizedLead === normalizedTitle
  );
  if (!exactTitle) return false;
  const hint = contextualParsedKeyHint(citationContext);
  if (!hint?.surname) return true;
  const authors = Array.isArray(candidate?.authors) ? candidate.authors : [];
  const firstFamily = authorFamily(authors[0]);
  const families = authors.map(authorFamily).filter(Boolean);
  const normalizedHint = compact(hint.surname);
  const authorCompatible = familyMatchesHint(firstFamily, normalizedHint) ||
    compoundAuthorKeyMatches(hint.surname, families) ||
    groupAuthorMatchesHint(authors[0], normalizedHint);
  if (!authorCompatible) return false;
  const givenInitial = authorGivenInitial(authors[0]);
  const initialCompatible = !hint.firstInitial || !givenInitial ||
    compact(givenInitial) === compact(hint.firstInitial) ||
    familyParticleInitialMatches(firstFamily, normalizedHint, hint.firstInitial);
  if (!initialCompatible) return false;
  const expectedYear = Number(hint.year);
  const candidateYear = Number(candidate?.year);
  return !hint.year || !Number.isFinite(candidateYear) ||
    Math.abs(candidateYear - expectedYear) <= 1;
}

function extractSentenceLead(value) {
  return String(value ?? "").trim().match(/^(.+?)\s+(?:is|was|introduced|describes|presents|reports|shows|provides|uses)\b/)?.[1]?.trim() ?? "";
}

function groupAuthorMatchesHint(author, normalizedHint) {
  const normalizedAuthor = normalize(author);
  if (!normalizedAuthor || !normalizedHint || normalizedHint.length < 3) return false;
  const compactAuthor = compact(normalizedAuthor.replace(/^the\s+/, ""));
  const compactHint = compact(normalizedHint.replace(/^the\s+/, ""));
  const suffixPattern = /(collaboration|consortium|team|group)$/;
  if (!suffixPattern.test(compactAuthor)) return false;
  const authorBase = compactAuthor.replace(suffixPattern, "").replace(/scientific$/, "");
  const hintBase = compactHint.replace(suffixPattern, "").replace(/scientific$/, "");
  return Boolean(authorBase && authorBase === hintBase);
}

function dotModel(features) {
  let score = 0;
  for (const [name, weight] of Object.entries(MODEL_WEIGHTS)) {
    score += Number(features[name] ?? 0) * weight;
  }
  return Math.round(score * 1000) / 1000;
}

function buildContextEvidence(citationContext) {
  // Proximity windows intentionally span beyond the active sentence so the
  // classic search path has fallback context.  The beta ranker must not give
  // that neighbouring prose its higher proximity weight: it can describe the
  // next citation and invert two otherwise-correct same-author results.
  const prefixText = currentSentenceTail(boundedText(citationContext?.citationPrefixText, MAX_PREFIX_CHARS, true));
  const suffixText = currentSentenceHead(boundedText(citationContext?.citationSuffixText, MAX_SUFFIX_CHARS));
  const sentenceText = boundedText(citationContext?.sentenceText, MAX_SENTENCE_CHARS);
  const contextText = boundedText(citationContext?.contextText, MAX_CONTEXT_CHARS);
  const prefix = terms(prefixText).slice(-28);
  const suffix = terms(suffixText).slice(0, 10);
  const sentence = terms(sentenceText);
  const localEvidence = new Set([...prefix, ...suffix, ...sentence]);
  const context = localEvidence.size >= 3 ? [] : terms(contextText);
  const weightedTerms = new Map();
  addWeightedTerms(weightedTerms, context, 0.55);
  addWeightedTerms(weightedTerms, sentence, 1.1);
  addWeightedTerms(weightedTerms, prefix, 1.8);
  addWeightedTerms(weightedTerms, suffix, 1.35);
  const proximalTerms = [...prefix, ...suffix];
  const identifiers = new Set([
    ...extractIdentifiers(prefixText),
    ...extractIdentifiers(sentenceText),
    ...extractIdentifiers(suffixText),
    ...extractIdentifiers(contextText)
  ]);
  return {
    weightedTerms,
    proximalTerms: proximalTerms.length >= 2 ? proximalTerms : sentence,
    termSet: new Set(weightedTerms.keys()),
    identifiers,
    hasProse: Boolean(prefix.length || suffix.length || sentence.length || context.length),
    hasSubstantiveProse: isSubstantiveContext([...prefix, ...suffix, ...sentence, ...context])
  };
}

function addWeightedTerms(target, values, weight) {
  for (const value of values) {
    target.set(value, Math.max(Number(target.get(value) ?? 0), weight));
  }
}

function isSubstantiveContext(values) {
  const unique = new Set(values);
  if (unique.size < 3) return false;
  let informativeTerms = 0;
  for (const term of unique) {
    if (!CITATION_BOILERPLATE_TERMS.has(term)) informativeTerms += 1;
  }
  return informativeTerms >= 2;
}

function buildDocumentFrequencies(candidates) {
  const frequencies = new Map();
  for (const candidate of candidates) {
    const present = new Set([...uniqueTerms(candidate?.title), ...uniqueTerms(candidate?.abstract)]);
    for (const term of present) {
      frequencies.set(term, Number(frequencies.get(term) ?? 0) + 1);
    }
  }
  return frequencies;
}

function sumEvidenceWeight(weightedTerms, frequencies, candidateCount) {
  let total = 0;
  for (const [term, proximityWeight] of weightedTerms) {
    total += proximityWeight * inverseDocumentFrequency(term, frequencies, candidateCount);
  }
  return total || 1;
}

function weightedEvidenceCoverage(weightedTerms, candidateTerms, frequencies, candidateCount, denominator) {
  let matched = 0;
  for (const [term, proximityWeight] of weightedTerms) {
    if (candidateTerms.has(term)) {
      matched += proximityWeight * inverseDocumentFrequency(term, frequencies, candidateCount);
    }
  }
  return Math.min(1, matched / denominator);
}

function weightedCandidateSpecificity(candidateTerms, evidenceTerms, frequencies, candidateCount) {
  let numerator = 0;
  let denominator = 0;
  for (const term of candidateTerms) {
    const weight = inverseDocumentFrequency(term, frequencies, candidateCount);
    denominator += weight;
    if (evidenceTerms.has(term)) {
      numerator += weight;
    }
  }
  return denominator ? Math.min(1, numerator / denominator) : 0;
}

function inverseDocumentFrequency(term, frequencies, candidateCount) {
  const frequency = Number(frequencies.get(term) ?? 0);
  return Math.log((Math.max(1, candidateCount) + 1) / (frequency + 1)) + 1;
}

function bigramCoverage(contextTerms, candidateTerms) {
  const contextBigrams = bigrams(contextTerms);
  if (!contextBigrams.size) return 0;
  const candidateBigrams = bigrams(candidateTerms);
  let matches = 0;
  for (const bigram of contextBigrams) {
    if (candidateBigrams.has(bigram)) matches += 1;
  }
  return matches / contextBigrams.size;
}

function bigrams(values) {
  const output = new Set();
  for (let index = 0; index + 1 < values.length; index += 1) {
    output.add(`${values[index]} ${values[index + 1]}`);
  }
  return output;
}

function setCoverage(expected, actual) {
  if (!expected?.size) return 0;
  let matches = 0;
  for (const value of expected) {
    if (actual.has(value)) matches += 1;
  }
  return matches / expected.size;
}

function contextualKeyTerms(citationContext) {
  const hint = contextualParsedKeyHint(citationContext);
  const values = Array.isArray(hint?.keyTerms) && hint.keyTerms.length
    ? hint.keyTerms
    : splitCamelCase(hint?.suffix);
  return new Set(values.flatMap((value) => terms(value)));
}

function softwareNameHint(citationContext) {
  const token = String(citationContext?.token ?? "").trim();
  const repositoryStyle = token.match(/^([A-Za-z][A-Za-z0-9.+-]{1,30})[_:-]\d{6,}$/);
  if (repositoryStyle) return normalize(repositoryStyle[1]).replace(/\s+/g, "");
  if (/^[a-z][a-z0-9.+-]{2,24}$/.test(token) && !contextualParsedKeyHint(citationContext)?.year) {
    return normalize(token).replace(/\s+/g, "");
  }
  return "";
}

function contextualParsedKeyHint(citationContext) {
  return normalizeContextualCitationContext(citationContext, "beta")?.parsedKeyHint;
}

function tokenLexicalTerms(value) {
  const separated = String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
  return new Set(normalize(separated).split(" ").filter((term) =>
    term.length >= 3 &&
    !CONTEXT_STOPWORDS.has(term) &&
    !["dblp", "journals", "corr"].includes(term)
  ));
}

function lexicalTermMatchesCompactValue(tokenTerms, value) {
  const normalizedValue = compact(value);
  if (!normalizedValue) return false;
  return tokenTerms.has(normalizedValue);
}

function titleAcronymMatchesToken(token, titleTerms) {
  const compactToken = String(token ?? "").replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!/^[A-Z][A-Z0-9-]{2,11}$/.test(String(token ?? "")) || compactToken.length < 3 || !titleTerms.length) {
    return false;
  }
  const acronym = titleTerms.map((term) => term[0]).join("");
  return acronym.startsWith(compactToken);
}

function titlePhraseMatchesToken(tokenTerms, titleTerms) {
  if (tokenTerms.size < 2 || !titleTerms.length) return false;
  const compactTokenTerms = [...tokenTerms].map(stem).join("");
  return compactTokenTerms.length >= 6 && titleTerms.join("").includes(compactTokenTerms);
}

function countTokenTitleSignals(citationContext, candidates, evidence) {
  if (!evidence.hasSubstantiveProse) return { phrase: 0, acronym: 0 };
  const tokenTerms = tokenLexicalTerms(citationContext?.token);
  let phrase = 0;
  let acronym = 0;
  for (const candidate of candidates) {
    const titleTerms = uniqueTerms(candidate?.title);
    phrase += Number(titlePhraseMatchesToken(tokenTerms, titleTerms));
    acronym += Number(titleAcronymMatchesToken(citationContext?.token, titleTerms));
  }
  return { phrase, acronym };
}

function modelScoreSpreadsByTier(rankedCandidates) {
  const ranges = new Map();
  for (const candidate of rankedCandidates) {
    const tier = Number(candidate.contextualBeta?.identityTier ?? 0);
    const score = Number(candidate.contextualBeta?.modelScore ?? 0);
    const range = ranges.get(tier) ?? { min: score, max: score };
    range.min = Math.min(range.min, score);
    range.max = Math.max(range.max, score);
    ranges.set(tier, range);
  }
  return new Map([...ranges].map(([tier, range]) => [tier, range.max - range.min]));
}

function extractIdentifiers(value) {
  const normalized = normalize(value);
  return new Set(normalized.split(" ").filter((term) => /\d/.test(term) && term.length >= 4));
}

function candidateIdentifierMatches(citationContext, candidate) {
  const token = String(citationContext?.token ?? "").trim();
  if (!token) return false;
  const lowerToken = token.toLowerCase();
  if (/^\d{4}[a-z&.]{5}.{10}$/i.test(token) && lowerToken === String(candidate?.bibcode ?? "").toLowerCase()) {
    return true;
  }
  const doi = normalizeDoi(token);
  if (doi && doi === normalizeDoi(candidate?.doi)) return true;
  const arxivId = normalizeArxivId(token);
  if (arxivId && [candidate?.eprint, candidate?.doi].some((value) => arxivId === normalizeArxivId(value))) return true;
  return false;
}

function normalizeDoi(value) {
  const normalized = String(value ?? "").trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\/.+/.test(normalized) ? normalized : "";
}

function normalizeArxivId(value) {
  const normalized = String(value ?? "").trim().toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/^arxiv:\s*/, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^10\.48550\/arxiv\./, "")
    .replace(/\.pdf$/, "");
  return normalized.match(/^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/)?.[1] ?? "";
}

function candidateMetadataText(candidate) {
  return [
    candidate?.bibcode,
    candidate?.doi,
    candidate?.eprint,
    candidate?.id,
    candidate?.bibtexExportId,
    ...(Array.isArray(candidate?.identifier) ? candidate.identifier : [])
  ].filter(Boolean).join(" ");
}

function compoundAuthorKeyMatches(surnameHint, authorFamilies) {
  const pieces = splitCamelCase(surnameHint);
  if (pieces.length < 2 || !authorFamilies.length) return false;
  const compactFamilies = authorFamilies.map(compact);
  const firstPiece = compact(pieces[0]);
  if (!firstPiece || compactFamilies[0] !== firstPiece) return false;
  for (let split = 1; split < pieces.length; split += 1) {
    const remainder = compact(pieces.slice(split).join(""));
    if (remainder && compactFamilies.slice(1).includes(remainder)) return true;
  }
  return false;
}

function familyMatchesHint(family, normalizedHint) {
  const rawFamily = String(family ?? "").trim();
  const normalizedFamily = compact(family);
  if (!normalizedFamily || !normalizedHint) return false;
  if (normalizedFamily === normalizedHint) return true;
  // Citation-key parsers commonly interpret the leading O in names such as
  // O'Doherty as an initial. Accept that single-letter particle without making
  // broader suffix matches that could merge unrelated surnames.
  return /^[ODLodl]['’`-][A-Za-z]/.test(rawFamily) &&
    normalizedFamily.length === normalizedHint.length + 1 &&
    normalizedFamily.endsWith(normalizedHint);
}

function authorGivenInitial(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /\b(?:collaboration|consortium|team|group)\b/i.test(raw)) return "";
  const given = raw.includes(",") ? raw.split(",").slice(1).join(" ") : raw.split(/\s+/)[0];
  return normalize(given).match(/[a-z]/)?.[0] ?? "";
}

function familyParticleInitialMatches(family, normalizedHint, initial) {
  const rawFamily = String(family ?? "").trim();
  return Boolean(
    normalizedHint &&
    initial &&
    /^[ODLodl]['’`-][A-Za-z]/.test(rawFamily) &&
    compact(rawFamily).endsWith(normalizedHint) &&
    compact(rawFamily[0]) === compact(initial)
  );
}

function splitCamelCase(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
}

function authorFamily(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes(",")) return raw.split(",")[0].trim();
  const values = raw.split(/\s+/).filter(Boolean);
  if (values.length <= 1) return values[0] ?? "";
  let start = values.length - 1;
  while (start > 0 && PARTICLES.has(normalize(values[start - 1]))) start -= 1;
  return values.slice(start).join(" ");
}

function uniqueTerms(value) {
  return [...new Set(terms(value))];
}

function terms(value) {
  return normalize(value)
    .split(" ")
    .map(stem)
    .filter((term) => term.length >= 3 && !CONTEXT_STOPWORDS.has(term) && !GENERIC_CONTEXT_TERMS.has(term));
}

function stem(value) {
  if (value.length >= 6 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length >= 6 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length >= 5 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length >= 5 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ŁłØøĐđÐðÞþÆæŒœıß]/g, (letter) => ({
      Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ð: "D", ð: "d",
      Þ: "Th", þ: "th", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ı: "i", ß: "ss"
    })[letter] ?? letter)
    .replace(/(^|[^\\])%[^\n]*/g, "$1 ")
    .replace(/\\(?:cite[a-zA-Z*]*|parencite[a-zA-Z*]*|textcite[a-zA-Z*]*|autocite[a-zA-Z*]*|footcite[a-zA-Z*]*)\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}]*\}/g, " ")
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function boundedText(value, maxChars, keepEnd = false) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return keepEnd ? text.slice(-maxChars) : text.slice(0, maxChars);
}

function currentSentenceTail(value) {
  const text = String(value ?? "");
  let start = 0;
  for (const match of text.matchAll(/[.!?](?=\s+(?:[A-Z\\]|$)|$)/g)) {
    start = Number(match.index ?? -1) + 1;
  }
  return text.slice(start).trim();
}

function currentSentenceHead(value) {
  const text = String(value ?? "");
  const boundary = text.match(/[.!?](?=\s+(?:[A-Z\\]|$)|$)/);
  return text.slice(0, boundary?.index == null ? text.length : boundary.index + 1).trim();
}
