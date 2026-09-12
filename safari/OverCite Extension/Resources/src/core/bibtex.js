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
  const collaborationFamily = extractCollaborationFamily(raw);
  if (collaborationFamily) {
    return collaborationFamily;
  }
  const normalized = toAscii(raw);
  const pieces = normalized.split(" ").filter(Boolean);
  return pieces[pieces.length - 1] ?? "Citation";
}

function extractCollaborationFamily(raw) {
  const normalized = toAscii(raw);
  if (!normalized) {
    return "";
  }
  const pieces = normalized.split(" ").filter(Boolean);
  const keywordIndex = pieces.findIndex((piece) => /^(collaboration|consortium|team|group)$/i.test(piece));
  if (keywordIndex <= 0) {
    return "";
  }
  const familyPieces = pieces
    .slice(0, keywordIndex)
    .filter((piece) => !/^(the|scientific)$/i.test(piece));
  return familyPieces.join("");
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

export function generateAuthorYearKey(candidate, existingKeys = []) {
  const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
  const year = candidate?.year ? String(candidate.year) : "";
  const base = `${family}${year}` || "Citation";
  return ensureUniqueKey(base, existingKeys);
}

export function generateAuthorYearUnderscoreKey(candidate, existingKeys = []) {
  const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
  const year = candidate?.year ? String(candidate.year) : "";
  const base = year ? `${family}_${year}` : family;
  return ensureUniqueKey(base || "Citation", existingKeys);
}

export function generateAuthorYearColonKey(candidate, existingKeys = []) {
  const family = extractFirstAuthorFamily(candidate?.authors).replace(/[^A-Za-z0-9]/g, "") || "Citation";
  const year = candidate?.year ? String(candidate.year) : "";
  const base = year ? `${family}:${year}` : family;
  return ensureUniqueKey(base || "Citation", existingKeys);
}

export function generateBibcodeKey(candidate, existingKeys = []) {
  const bibcode = String(candidate?.bibcode ?? "").trim();
  if (!bibcode) {
    return generateAuthorYearKey(candidate, existingKeys);
  }
  return ensureUniqueKey(bibcode, existingKeys);
}

function sanitizeTypedTokenKey(rawToken) {
  return String(rawToken ?? "")
    .trim()
    .replace(/[{}\s]/g, "")
    .replace(/[^A-Za-z0-9_.:-]/g, "");
}

export function generatePreferredKey(candidate, existingKeys = [], options = {}) {
  const keyMode = String(options?.keyMode ?? "authoryear");
  if (keyMode === "typed") {
    const typedBase = sanitizeTypedTokenKey(options?.typedToken);
    if (typedBase) {
      return ensureUniqueKey(typedBase, existingKeys);
    }
  }
  if (keyMode === "bibcode") {
    return generateBibcodeKey(candidate, existingKeys);
  }
  if (keyMode === "informative") {
    return generateInformativeKey(candidate, existingKeys);
  }
  if (keyMode === "authoryear") {
    return generateAuthorYearKey(candidate, existingKeys);
  }
  if (keyMode === "authoryear-underscore") {
    return generateAuthorYearUnderscoreKey(candidate, existingKeys);
  }
  if (keyMode === "authoryear-colon") {
    return generateAuthorYearColonKey(candidate, existingKeys);
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

function isEscapedCharacter(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findNextBibEntryHeader(bibText, startIndex) {
  let inLineComment = false;
  for (let index = startIndex; index < bibText.length; index += 1) {
    const char = bibText[index];
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      continue;
    }
    if (char === "%" && !isEscapedCharacter(bibText, index)) {
      inLineComment = true;
      continue;
    }
    if (char !== "@") {
      continue;
    }

    let cursor = index + 1;
    while (cursor < bibText.length && /[A-Za-z]/.test(bibText[cursor])) {
      cursor += 1;
    }
    if (cursor === index + 1) {
      continue;
    }
    const type = bibText.slice(index + 1, cursor).trim();
    while (cursor < bibText.length && /\s/.test(bibText[cursor])) {
      cursor += 1;
    }
    if (bibText[cursor] === "{" || bibText[cursor] === "(") {
      return { entryStart: index, openIndex: cursor, type };
    }
  }
  return null;
}

function scanBibEntryBlock(bibText, header) {
  const openDelimiter = bibText[header.openIndex];
  const closeDelimiter = openDelimiter === "{" ? "}" : ")";
  let delimiterDepth = 1;
  let braceDepth = openDelimiter === "{" ? 1 : 0;
  let commaIndex = -1;
  let inQuote = false;
  let inLineComment = false;

  for (let cursor = header.openIndex + 1; cursor < bibText.length; cursor += 1) {
    const char = bibText[cursor];
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      continue;
    }
    if (char === "%" && !isEscapedCharacter(bibText, cursor)) {
      inLineComment = true;
      continue;
    }
    if (char === "\"" && !isEscapedCharacter(bibText, cursor) && (openDelimiter === "(" ? braceDepth === 0 : delimiterDepth === 1)) {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote || isEscapedCharacter(bibText, cursor)) {
      continue;
    }

    if (openDelimiter === "{") {
      if (char === "{") {
        delimiterDepth += 1;
      } else if (char === "}") {
        delimiterDepth -= 1;
        if (delimiterDepth === 0) {
          return { ...header, commaIndex, end: cursor + 1 };
        }
      } else if (char === "," && delimiterDepth === 1 && commaIndex < 0) {
        commaIndex = cursor;
      }
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (braceDepth === 0 && char === "(") {
      delimiterDepth += 1;
    } else if (braceDepth === 0 && char === closeDelimiter) {
      delimiterDepth -= 1;
      if (delimiterDepth === 0) {
        return { ...header, commaIndex, end: cursor + 1 };
      }
    } else if (braceDepth === 0 && char === "," && delimiterDepth === 1 && commaIndex < 0) {
      commaIndex = cursor;
    }
  }
  return null;
}

export function parseBibEntries(bibText) {
  const entries = [];
  let index = 0;
  while (index < bibText.length) {
    const header = findNextBibEntryHeader(bibText, index);
    if (!header) {
      break;
    }
    const block = scanBibEntryBlock(bibText, header);
    if (!block) {
      break;
    }
    index = block.end;
    const normalizedType = header.type.toLowerCase();
    if (normalizedType === "comment" || normalizedType === "preamble" || normalizedType === "string" || block.commaIndex < 0) {
      continue;
    }
    const key = bibText.slice(header.openIndex + 1, block.commaIndex).trim();
    if (!key) {
      continue;
    }
    const raw = bibText.slice(header.entryStart, block.end).trim();
    entries.push({
      type: header.type,
      key,
      raw,
      start: header.entryStart,
      end: block.end,
      doi: normalizeLooseText(parseFieldValue(raw, "doi")),
      title: normalizeLooseText(parseFieldValue(raw, "title")),
      adsurl: parseFieldValue(raw, "adsurl"),
      bibcode: normalizeLooseText(extractBibcodeFromAdsUrl(parseFieldValue(raw, "adsurl"))),
      year: parseFieldValue(raw, "year")
    });
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
  const lineEnding = bibText.includes("\r\n") ? "\r\n" : "\n";
  const trimmedEntry = entryText.trim().replace(/\r\n|\r|\n/g, lineEnding);
  if (!trimmedText) {
    return `${trimmedEntry}${lineEnding}`;
  }
  return `${trimmedText}${lineEnding}${lineEnding}${trimmedEntry}${lineEnding}`;
}

function compareKeys(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
}

export function insertBibtexEntryAlphabetically(bibText, entryText, finalKey) {
  return insertAlphabetically(bibText, entryText, finalKey, parseBibEntries(bibText));
}

function insertAlphabetically(bibText, entryText, finalKey, entries) {
  if (!entries.length) {
    return appendBibtexEntry(bibText, entryText);
  }

  const insertBefore = entries.find((entry) => compareKeys(finalKey, entry.key) < 0);
  if (!insertBefore) {
    return appendBibtexEntry(bibText, entryText);
  }

  const lineEnding = bibText.includes("\r\n") ? "\r\n" : "\n";
  const trimmedEntry = entryText.trim().replace(/\r\n|\r|\n/g, lineEnding);
  const before = bibText.slice(0, insertBefore.start).trimEnd();
  const after = bibText.slice(insertBefore.start).trimStart();

  if (!before) {
    return `${trimmedEntry}${lineEnding}${lineEnding}${after}${lineEnding}`;
  }
  return `${before}${lineEnding}${lineEnding}${trimmedEntry}${lineEnding}${lineEnding}${after}${lineEnding}`;
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
  const rewrittenBibtex = rewriteBibtexKey(bibtex, finalKey)
    .replace(/\r\n|\r|\n/g, bibText.includes("\r\n") ? "\r\n" : "\n");
  const insertMode = String(candidate?.bibliographyInsertMode ?? "alphabetical").toLowerCase();
  const updatedBibText = insertMode === "alphabetical"
    ? insertAlphabetically(bibText, rewrittenBibtex, finalKey, entries)
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
