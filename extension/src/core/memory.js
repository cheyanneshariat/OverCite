import { CONTEXT_STOPWORDS } from "./constants.js";

const MAX_SELECTION_MEMORY = 200;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function keywordList(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !CONTEXT_STOPWORDS.has(token));
}

function buildSentencePhrase(sentenceText) {
  const tokens = keywordList(sentenceText);
  return tokens.slice(0, 6).join(" ");
}

function uniqueKeywords(value) {
  return [...new Set(keywordList(value))];
}

export function buildSelectionMemoryEntry({ citationContext, candidate }) {
  return {
    bibcode: String(candidate?.bibcode ?? "").trim(),
    token: normalizeText(citationContext?.token ?? ""),
    surname: normalizeText(citationContext?.parsedKeyHint?.surname ?? ""),
    sentencePhrase: buildSentencePhrase(citationContext?.sentenceText ?? ""),
    sentenceKeywords: uniqueKeywords(citationContext?.sentenceText ?? "").slice(0, 6),
    timestamp: Date.now()
  };
}

export function applySelectionMemoryBoost(citationContext, candidates, memoryEntries = []) {
  const token = normalizeText(citationContext?.token ?? "");
  const surname = normalizeText(citationContext?.parsedKeyHint?.surname ?? "");
  const sentencePhrase = buildSentencePhrase(citationContext?.sentenceText ?? "");
  const sentenceKeywords = new Set(uniqueKeywords(citationContext?.sentenceText ?? ""));

  return candidates
    .map((candidate) => {
      let memoryBoost = 0;
      for (const entry of memoryEntries) {
        if (!entry?.bibcode || entry.bibcode !== candidate.bibcode) {
          continue;
        }
        if (token && entry.token === token) {
          memoryBoost += 55;
        }
        if (surname && entry.surname === surname) {
          memoryBoost += 25;
        }
        if (sentencePhrase && entry.sentencePhrase === sentencePhrase) {
          memoryBoost += 35;
        }
        const entryKeywords = new Set(Array.isArray(entry.sentenceKeywords) ? entry.sentenceKeywords : []);
        let overlap = 0;
        for (const keyword of sentenceKeywords) {
          if (entryKeywords.has(keyword)) {
            overlap += 1;
          }
        }
        memoryBoost += Math.min(20, overlap * 5);
      }
      return {
        ...candidate,
        score: (candidate.score ?? 0) + memoryBoost,
        memoryBoost
      };
    })
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || (right.memoryBoost ?? 0) - (left.memoryBoost ?? 0));
}

export function recordSelection(memoryEntries = [], nextEntry) {
  if (!nextEntry?.bibcode) {
    return memoryEntries;
  }
  const filtered = memoryEntries.filter((entry) => {
    return !(
      entry?.bibcode === nextEntry.bibcode &&
      entry?.token === nextEntry.token &&
      entry?.sentencePhrase === nextEntry.sentencePhrase
    );
  });
  return [nextEntry, ...filtered].slice(0, MAX_SELECTION_MEMORY);
}
