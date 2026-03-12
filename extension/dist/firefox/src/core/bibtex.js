import { TITLE_STOPWORDS } from "./constants.js";

function toAscii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLooseText(value) {
  return toAscii(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function extractFirstAuthorFamily(authors) {
  const first = Array.isArray(authors) ? authors[0] : "";
  const raw = String(first ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (!raw.trim()) {
    return "Citation";
  }
  if (raw.includes(",")) {
    return toAscii(raw.split(",")[0]).replace(/\s+/g, "") || "Citation";
  }
  const normalized = toAscii(raw);
  const pieces = normalized.split(" ").filter(Boolean);
  return pieces[pieces.length - 1] ?? "Citation";
}

function compactLeadingNumber(numberText) {
  const digits = numberText.replace(/[^\d.]/g, "");
  const numeric = Number(digits);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return digits;
  }
  if (numeric >= 1000 && numeric % 1000 === 0) {
    return `${numeric / 1000}k`;
  }
  return String(Math.round(numeric));
}

export function buildTitleSlug(title) {
  const rawTitle = String(title ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const leadingNumberMatch = rawTitle.match(/^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)/);
  if (leadingNumberMatch) {
    return compactLeadingNumber(leadingNumberMatch[1]).toLowerCase();
  }

  const asciiTitle = toAscii(rawTitle);
  if (!asciiTitle) {
    return "";
  }

  const tokens = asciiTitle
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !TITLE_STOPWORDS.has(token));
  return tokens.slice(0, 2).join("_");
}

export function ensureUniqueKey(baseKey, existingKeys) {
  const keys = new Set(existingKeys);
  if (!keys.has(baseKey)) {
    return baseKey;
  }
  const suffixLetters = "abcdefghijklmnopqrstuvwxyz";
  for (const letter of suffixLetters) {
    const candidate = `${baseKey}${letter}`;
    if (!keys.has(candidate)) {
      return candidate;
    }
  }
  let counter = 2;
  while (keys.has(`${baseKey}${counter}`)) {
    counter += 1;
  }
  return `${baseKey}${counter}`;
}

export function generateInformativeKey(candidate, existingKeys = []) {
  const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
  const year = candidate?.year ? String(candidate.year).slice(-2) : "xx";
  const slug = buildTitleSlug(candidate?.title ?? "");
  const base = slug ? `${family}${year}_${slug}` : `${family}${year}`;
  return ensureUniqueKey(base, existingKeys);
}

function sanitizeTypedTokenKey(rawToken) {
  return String(rawToken ?? "")
    .trim()
    .replace(/[{}\s]/g, "")
    .replace(/[^A-Za-z0-9_.:-]/g, "");
}

export function generatePreferredKey(candidate, existingKeys = [], options = {}) {
  const keyMode = String(options?.keyMode ?? "informative");
  if (keyMode === "typed") {
    const typedBase = sanitizeTypedTokenKey(options?.typedToken);
    if (typedBase) {
      return ensureUniqueKey(typedBase, existingKeys);
    }
  }
  return generateInformativeKey(candidate, existingKeys);
}

function parseFieldValue(entryText, fieldName) {
  const regex = new RegExp(`${fieldName}\\s*=\\s*(\\{([^]*?)\\}|\"([^]*?)\")`, "i");
  const match = entryText.match(regex);
  if (!match) {
    return null;
  }
  return (match[2] ?? match[3] ?? "").replace(/\s+/g, " ").trim();
}

function extractBibcodeFromAdsUrl(adsUrl) {
  if (!adsUrl) {
    return null;
  }
  const match = adsUrl.match(/\/abs\/([^/?#]+)/);
  return match ? match[1] : null;
}

export function parseBibEntries(bibText) {
  const entries = [];
  let index = 0;
  while (index < bibText.length) {
    const entryStart = bibText.indexOf("@", index);
    if (entryStart < 0) {
      break;
    }
    const openBrace = bibText.indexOf("{", entryStart);
    if (openBrace < 0) {
      break;
    }
    const header = bibText.slice(entryStart + 1, openBrace).trim();
    const type = header.split(/\s+/)[0];
    const commaIndex = bibText.indexOf(",", openBrace);
    if (commaIndex < 0) {
      break;
    }
    const key = bibText.slice(openBrace + 1, commaIndex).trim();
    let depth = 1;
    let cursor = openBrace + 1;
    while (cursor < bibText.length && depth > 0) {
      const char = bibText[cursor];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
      cursor += 1;
    }
    const raw = bibText.slice(entryStart, cursor).trim();
    entries.push({
      type,
      key,
      raw,
      start: entryStart,
      end: cursor,
      doi: normalizeLooseText(parseFieldValue(raw, "doi")),
      title: normalizeLooseText(parseFieldValue(raw, "title")),
      adsurl: parseFieldValue(raw, "adsurl"),
      bibcode: normalizeLooseText(extractBibcodeFromAdsUrl(parseFieldValue(raw, "adsurl"))),
      year: parseFieldValue(raw, "year")
    });
    index = cursor;
  }
  return entries;
}

export function rewriteBibtexKey(bibtex, nextKey) {
  return bibtex.replace(/^(@[A-Za-z]+\s*[{(]\s*)([^,]+)(,)/, `$1${nextKey}$3`);
}

export function findBibMatch(entries, candidate) {
  const normalizedDoi = normalizeLooseText(candidate?.doi);
  if (normalizedDoi) {
    const doiMatch = entries.find((entry) => entry.doi && entry.doi === normalizedDoi);
    if (doiMatch) {
      return { key: doiMatch.key, reason: "doi" };
    }
  }

  const normalizedBibcode = normalizeLooseText(candidate?.bibcode);
  if (normalizedBibcode) {
    const bibcodeMatch = entries.find((entry) => entry.bibcode && entry.bibcode === normalizedBibcode);
    if (bibcodeMatch) {
      return { key: bibcodeMatch.key, reason: "bibcode" };
    }
  }

  const normalizedTitle = normalizeLooseText(candidate?.title);
  if (normalizedTitle) {
    const titleMatch = entries.find((entry) => entry.title && entry.title === normalizedTitle);
    if (titleMatch) {
      return { key: titleMatch.key, reason: "title" };
    }
  }

  return null;
}

export function appendBibtexEntry(bibText, entryText) {
  const trimmedText = bibText.trimEnd();
  const trimmedEntry = entryText.trim();
  if (!trimmedText) {
    return `${trimmedEntry}\n`;
  }
  return `${trimmedText}\n\n${trimmedEntry}\n`;
}

function compareKeys(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
}

export function insertBibtexEntryAlphabetically(bibText, entryText, finalKey) {
  const entries = parseBibEntries(bibText);
  if (!entries.length) {
    return appendBibtexEntry(bibText, entryText);
  }

  const insertBefore = entries.find((entry) => compareKeys(finalKey, entry.key) < 0);
  if (!insertBefore) {
    return appendBibtexEntry(bibText, entryText);
  }

  const trimmedEntry = entryText.trim();
  const before = bibText.slice(0, insertBefore.start).trimEnd();
  const after = bibText.slice(insertBefore.start).trimStart();

  if (!before) {
    return `${trimmedEntry}\n\n${after}\n`;
  }
  return `${before}\n\n${trimmedEntry}\n\n${after}\n`;
}

function computeInsertionResult(updatedBibText, rewrittenBibtex) {
  const normalizedEntry = String(rewrittenBibtex ?? "").trim();
  const start = updatedBibText.indexOf(normalizedEntry);
  const cursorAnchor = start >= 0 ? start + normalizedEntry.length : updatedBibText.length;
  return {
    updatedBibText,
    insertionRange: {
      start: Math.max(0, start),
      end: cursorAnchor
    },
    cursorAnchor
  };
}

export function applyBibInsertion({ bibText, bibtex, candidate }) {
  const entries = parseBibEntries(bibText);
  const match = findBibMatch(entries, candidate);
  if (match) {
    return {
      finalKey: match.key,
      match,
      updatedBibText: bibText,
      rewrittenBibtex: null,
      insertionRange: null,
      cursorAnchor: null
    };
  }

  const existingKeys = entries.map((entry) => entry.key);
  const finalKey = generatePreferredKey(candidate, existingKeys, {
    keyMode: candidate?.keyMode,
    typedToken: candidate?.typedToken
  });
  const rewrittenBibtex = rewriteBibtexKey(bibtex, finalKey);
  const insertMode = String(candidate?.bibliographyInsertMode ?? "append").toLowerCase();
  const updatedBibText = insertMode === "alphabetical"
    ? insertBibtexEntryAlphabetically(bibText, rewrittenBibtex, finalKey)
    : appendBibtexEntry(bibText, rewrittenBibtex);
  const insertionResult = computeInsertionResult(updatedBibText, rewrittenBibtex);
  return {
    finalKey,
    match: null,
    updatedBibText: insertionResult.updatedBibText,
    rewrittenBibtex,
    insertionRange: insertionResult.insertionRange,
    cursorAnchor: insertionResult.cursorAnchor
  };
}
