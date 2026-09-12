function findBraceClose(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function normalizeKeyText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ŁłØøĐđÐðÞþÆæŒœıß]/g, (letter) => ({
      Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", Ð: "D", ð: "d",
      Þ: "Th", þ: "th", Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ı: "i", ß: "ss"
    })[letter] ?? letter);
}

function looksLikeBibcode(value) {
  return value.length === 19 && /^\d{4}[A-Za-z&.]{5}.{10}$/.test(value);
}

function looksLikeDoi(value) {
  const normalized = value.toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\/.+/.test(normalized);
}

function looksLikeArxivId(value) {
  const normalized = value.toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/^arxiv:\s*/, "")
    .replace(/\.pdf$/, "");
  return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/.test(normalized);
}

// XML-exported numeric/reference-manager keys do not carry reliable
// author/year evidence. Keep this classifier deliberately narrow: it is
// consulted only by the contextual path, while the shared parser remains
// available to Simple and Direct search unchanged. The prefixes below are
// the stable forms emitted by the biology/medicine XML fixtures (and by
// common EndNote-style exports), rather than a general "contains digits"
// heuristic that could swallow real author/year keys.
export function isOpaqueCitationKey(rawToken) {
  const token = String(rawToken ?? "").trim();
  if (!token || looksLikeBibcode(token) || looksLikeDoi(token) || looksLikeArxivId(token)) {
    return false;
  }
  return /^(?:RN|bib)\d+$/i.test(token) ||
    /^r(?!19\d{2}$|20\d{2}$)\d+$/i.test(token) ||
    /^b0\d{3,}$/i.test(token) ||
    /^cpz\d+-bib-\d+$/i.test(token) ||
    /^bibr\d+-[a-z0-9]+$/i.test(token);
}

export function normalizeContextualCitationContext(citationContext, contextualSearchEngine = "classic") {
  if (String(contextualSearchEngine ?? "").trim().toLowerCase() !== "beta" ||
      citationContext?.searchMode !== "contextual") {
    return citationContext;
  }
  const token = String(citationContext?.token ?? "").trim();
  // A multi-word slug without a year is topic evidence, not a reliable
  // hyphenated surname. Retain its words for ranking and key generation.
  if (!citationContext?.parsedKeyHint?.year && /^[a-z]+(?:-[a-z]+){2,}$/.test(token) && citationContext?.parsedKeyHint?.surname) {
    return { ...citationContext, parsedKeyHint: null };
  }
  if (!isOpaqueCitationKey(token)) {
    return citationContext;
  }
  const typedToken = String(citationContext?.typedToken ?? "").trim() || token;
  return {
    ...citationContext,
    token: "",
    typedToken,
    parsedKeyHint: null
  };
}

export function parseCitationKeyHint(rawToken) {
  const normalized = String(rawToken ?? "").trim();
  if (!normalized) {
    return null;
  }
  const asciiToken = normalizeKeyText(normalized);
  const compact = asciiToken.replace(/[{}\s]/g, "");
  const spaced = asciiToken.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  const match = spaced.match(/^([A-Za-z'`.\-\s]+?)[_:]?(\d{2,4})([A-Za-z0-9_-]*)$/);
  if (!match) {
    const surnameOnlyMatch = spaced.match(/^[A-Za-z'`.\-\s]{2,}$/);
    return {
      raw: normalized,
      normalized: compact,
      surname: surnameOnlyMatch ? parseAuthorHint(spaced).surname : null,
      firstInitial: null,
      year: null,
      suffix: ""
    };
  }
  const [, rawSurname, yearText, suffix = ""] = match;
  const year = inferYear(yearText);
  const parsedAuthorHint = parseAuthorHint(rawSurname);
  return {
    raw: normalized,
    normalized: compact,
    surname: parsedAuthorHint.surname,
    firstInitial: parsedAuthorHint.firstInitial,
    year,
    suffix
  };
}

function parseAuthorHint(rawSurnameToken) {
  const preserved = normalizeKeyText(rawSurnameToken)
    .replace(/[^A-Za-z\-'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!preserved) {
    return { surname: null, firstInitial: null };
  }

  if (preserved.includes(" ")) {
    return {
      surname: preserved,
      firstInitial: null
    };
  }

  const cleaned = preserved.replace(/[^A-Za-z-]/g, "");
  if (!cleaned) {
    return { surname: null, firstInitial: null };
  }

  if (/^[A-Z][A-Z][a-z-]{2,}$/.test(cleaned)) {
    return {
      surname: cleaned.slice(1) || cleaned,
      firstInitial: cleaned[0]
    };
  }

  if (/^[A-Z][a-z-]{2,}[A-Z]$/.test(cleaned)) {
    return {
      surname: cleaned.slice(0, -1) || cleaned,
      firstInitial: cleaned.slice(-1)
    };
  }

  if (/^[A-Z][a-z]?[A-Z]$/.test(cleaned)) {
    return {
      surname: cleaned.slice(0, -1) || cleaned,
      firstInitial: cleaned.slice(-1)
    };
  }

  return {
    surname: cleaned,
    firstInitial: null
  };
}

function inferYear(yearText) {
  if (yearText.length === 4) {
    return Number(yearText);
  }
  const currentYear = new Date().getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  const yearValue = Number(yearText);
  const candidate = currentCentury + yearValue;
  if (candidate <= currentYear + 3) {
    return candidate;
  }
  return candidate - 100;
}

export function extractSentenceAroundCursor(source, cursorIndex) {
  const prepared = prepareContextSource(source);
  const sentence = sentenceAtCursor(prepared, cursorIndex);
  return sentence?.text ?? "";
}

export function extractContextWindow(source, cursorIndex, windowChars = 500) {
  const safeWindow = Math.max(200, Math.min(1200, windowChars));
  const start = Math.max(0, cursorIndex - safeWindow);
  const end = Math.min(source.length, cursorIndex + Math.round(safeWindow / 3));
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

// Contextual retrieval uses sentence structure rather than the user-facing
// character window. This keeps the high-value local evidence stable when a
// user changes the legacy context-window setting for Simple/Direct searches.
const MAX_CONTEXTUAL_CONTEXT_CHARS = 4_000;
const MAX_CONTEXTUAL_SENTENCES = 2;
const CONTEXT_SCAN_RADIUS = 8_000;

const METADATA_COMMAND_RE = /\\(?:title|subtitle|author|affiliation|altaffiliation|institute|address|thanks|date|keywords|subject|email|shorttitle|shortauthor|dedication|maketitle)\*?/gi;
const SECTION_COMMAND_RE = /\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph|subsubparagraph)\*?/gi;
// Match the complete commands, but never a longer control sequence such as
// \\footnotemark. `\\footnotetext` is detached from its placement marker and
// therefore receives no enclosing-sentence inheritance below.
const FOOTNOTE_COMMAND_RE = /\\footnote(?:text)?\*?(?![A-Za-z@])/gi;
const PREAMBLE_LINE_RE = /^\s*\\(?:documentclass|usepackage|RequirePackage|newcommand|renewcommand|providecommand|Declare[A-Za-z]+|set[A-Za-z]+|addbibresource|bibliography|bibliographystyle|graphicspath|hypersetup|geometry|newenvironment|renewenvironment|AtBeginDocument)\b/i;

function maskRange(source, start, end, boundary = false) {
  const safeStart = Math.max(0, Math.min(source.length, start));
  const safeEnd = Math.max(safeStart, Math.min(source.length, end));
  if (safeStart >= safeEnd) return source;
  return maskRanges(source, [{ start: safeStart, end: safeEnd }], boundary);
}

function maskRanges(source, ranges, boundary = false) {
  if (!ranges.length) return source;
  const chars = source.split("");
  for (const range of ranges) {
    const start = Math.max(0, Math.min(chars.length, range.start));
    const end = Math.max(start, Math.min(chars.length, range.end));
    let markers = 0;
    for (let index = start; index < end; index += 1) {
      if (chars[index] === "\r" || chars[index] === "\n") continue;
      if (boundary && markers < 2) {
        chars[index] = "\n";
        markers += 1;
      } else {
        chars[index] = " ";
      }
    }
  }
  return chars.join("");
}

function maskComments(source) {
  const ranges = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "%") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
    if (backslashes % 2) continue;
    const lineEnd = source.indexOf("\n", index);
    ranges.push({ start: index, end: lineEnd < 0 ? source.length : lineEnd });
    if (lineEnd < 0) break;
    index = lineEnd;
  }
  return maskRanges(source, ranges);
}

function skipLatexOptionalArgument(source, start) {
  let cursor = start;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  if (source[cursor] !== "[") return cursor;
  let depth = 0;
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === "[") depth += 1;
    if (source[cursor] === "]") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return source.length;
}

function commandRange(source, matchIndex, includeBracedArgument = true) {
  let cursor = skipLatexOptionalArgument(source, matchIndex);
  if (!includeBracedArgument) return cursor;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  if (source[cursor] !== "{") return cursor;
  const close = findBraceClose(source, cursor);
  return close < 0 ? source.length : close + 1;
}

function maskCommandMatches(source, commandRegex, boundary = false) {
  const ranges = [];
  commandRegex.lastIndex = 0;
  let match;
  while ((match = commandRegex.exec(source)) !== null) {
    const end = commandRange(source, match.index + match[0].length, true);
    const safeEnd = Math.max(match.index + match[0].length, end);
    ranges.push({ start: match.index, end: safeEnd });
  }
  return maskRanges(source, ranges, boundary);
}

function maskPreamble(source) {
  const ranges = [];
  const beginDocument = source.match(/\\begin\s*\{\s*document\s*\}/i);
  if (beginDocument) ranges.push({ start: beginDocument.index, end: beginDocument.index + beginDocument[0].length });
  const endDocument = source.match(/\\end\s*\{\s*document\s*\}/i);
  if (endDocument) ranges.push({ start: endDocument.index, end: endDocument.index + endDocument[0].length });
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  for (const line of lines) {
    if (PREAMBLE_LINE_RE.test(line)) ranges.push({ start: offset, end: preambleLineEnd(source, offset, offset + line.length) });
    offset += line.length;
  }
  return maskRanges(source, ranges, true);
}

function preambleLineEnd(source, start, initialEnd) {
  let depth = 0;
  for (let index = start; index < initialEnd; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth = Math.max(0, depth - 1);
  }
  if (depth === 0) return initialEnd;
  const limit = Math.min(source.length, start + 4_096);
  for (let index = initialEnd; index < limit; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth = Math.max(0, depth - 1);
    if (depth === 0) return index + 1;
    if (source[index] === "\n" && source[index + 1] === "\n") break;
  }
  return initialEnd;
}

function prepareContextSource(source, citationStart = null, citationEnd = null) {
  let output = String(source ?? "");
  output = maskComments(output);
  output = maskPreamble(output);
  // Footnote prose can describe a different claim from the enclosing sentence.
  // Main-text citations must not inherit it as local evidence; citations inside
  // a footnote are handled from the isolated body below.
  output = maskCommandMatches(output, FOOTNOTE_COMMAND_RE);
  output = maskCommandMatches(output, METADATA_COMMAND_RE, true);
  output = maskCommandMatches(output, SECTION_COMMAND_RE, true);
  output = maskCommandMatches(output, /\\par\b/gi, true);
  if (Number.isFinite(citationStart) && Number.isFinite(citationEnd)) {
    output = maskRange(output, citationStart, citationEnd);
  }
  return output;
}

function boundedCitationSource(source, citationStart, citationEnd) {
  const text = String(source ?? "");
  const start = Math.max(0, Math.min(text.length, Number(citationStart) || 0));
  const end = Math.max(start, Math.min(text.length, Number(citationEnd) || start));
  let windowStart = Math.max(0, start - CONTEXT_SCAN_RADIUS);
  let windowEnd = Math.min(text.length, end + CONTEXT_SCAN_RADIUS);
  const lineStart = text.lastIndexOf("\n", windowStart - 1) + 1;
  if (windowStart - lineStart <= 512) windowStart = lineStart;
  const lineEnd = text.indexOf("\n", windowEnd);
  if (lineEnd >= 0 && lineEnd - windowEnd <= 512) windowEnd = lineEnd + 1;
  return {
    source: text.slice(windowStart, windowEnd),
    citationStart: start - windowStart,
    citationEnd: end - windowStart
  };
}

const ABBREVIATIONS = new Set([
  "al", "approx", "capt", "cf", "dept", "dr", "e.g", "eq", "eqs", "esp", "et al",
  "fig", "figs", "i.e", "inc", "jr", "misc", "mr", "mrs", "ms", "no", "nos", "prof",
  "ref", "refs", "rev", "sec", "secs", "sr", "st", "vs"
]);

function previousWord(text, periodIndex) {
  let end = periodIndex;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[A-Za-z.'-]/.test(text[start - 1])) start -= 1;
  return text.slice(start, end).toLowerCase();
}

function isSentencePeriod(text, index) {
  const previous = text[index - 1] ?? "";
  const next = text[index + 1] ?? "";
  if (/\d/.test(previous) && /\d/.test(next)) return false;
  if (previous === "." || next === ".") return false;
  if (previous === "\\") return false;
  const word = previousWord(text, index);
  if (ABBREVIATIONS.has(word)) return false;
  if (/[A-Z]/.test(previous) && /[A-Z]/.test(next) && text[index + 2] === ".") return false;
  if (/^(?:[a-z]\.)+[a-z]?$/i.test(word)) return false;
  if (/^[a-z]$/.test(word) && /[A-Za-z]/.test(next)) return false;
  if (/^[A-Za-z]$/.test(word) && /\s+[A-Z][a-z]/.test(text.slice(index + 1, index + 8))) return false;
  if (/^[a-z]$/.test(next)) return false;
  return true;
}

function paragraphRanges(source) {
  const ranges = [];
  const boundary = /\n\s*\n/g;
  let start = 0;
  let match;
  while ((match = boundary.exec(source)) !== null) {
    ranges.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  ranges.push({ start, end: source.length });
  return ranges;
}

function sentenceRanges(source, paragraph) {
  const ranges = [];
  let start = paragraph.start;
  for (let index = paragraph.start; index < paragraph.end; index += 1) {
    const char = source[index];
    if ((char === "!" || char === "?") || (char === "." && isSentencePeriod(source, index))) {
      let end = index + 1;
      while (/[!?\.]/.test(source[end] ?? "")) end += 1;
      ranges.push({ start, end });
      start = end;
    }
  }
  ranges.push({ start, end: paragraph.end });
  return ranges.filter((range) => source.slice(range.start, range.end).trim());
}

function sentenceAtCursor(source, cursorIndex) {
  const safeCursor = Math.max(0, Math.min(source.length, Number(cursorIndex) || 0));
  for (const paragraph of paragraphRanges(source)) {
    if (safeCursor < paragraph.start || safeCursor > paragraph.end) continue;
    const sentences = sentenceRanges(source, paragraph);
    const index = sentences.findIndex((range) => safeCursor >= range.start && safeCursor <= range.end);
    if (index >= 0) {
      const range = sentences[index];
      return {
        paragraph,
        sentences,
        index,
        range,
        text: source.slice(range.start, range.end).replace(/\s+/g, " ").trim()
      };
    }
  }
  return null;
}

export function extractContextualContext(source, cursorIndex) {
  const prepared = prepareContextSource(source);
  return extractPreparedContextualContext(prepared, cursorIndex);
}

function extractPreparedContextualContext(prepared, cursorIndex) {
  const current = sentenceAtCursor(prepared, cursorIndex);
  if (!current) return "";
  const selected = [current.range];
  for (let offset = 1; offset <= MAX_CONTEXTUAL_SENTENCES; offset += 1) {
    const previous = current.sentences[current.index - offset];
    if (!previous) break;
    selected.unshift(previous);
  }
  const currentText = prepared.slice(current.range.start, current.range.end).replace(/\s+/g, " ").trim();
  const allText = selected.map((range) => prepared.slice(range.start, range.end).replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  if (allText.length <= MAX_CONTEXTUAL_CONTEXT_CHARS) return allText;
  if (currentText.length >= MAX_CONTEXTUAL_CONTEXT_CHARS) return currentText.slice(0, MAX_CONTEXTUAL_CONTEXT_CHARS).trim();
  const prefixLimit = MAX_CONTEXTUAL_CONTEXT_CHARS - currentText.length - 1;
  const prefix = allText.slice(Math.max(0, allText.length - currentText.length - prefixLimit), allText.length - currentText.length).trim();
  return `${prefix} ${currentText}`.trim();
}

export function extractCitationProximity(source, cursorIndex, beforeChars = 320, afterChars = 160) {
  const safeCursor = Math.max(0, Math.min(String(source ?? "").length, cursorIndex));
  const text = String(source ?? "");
  const paragraph = paragraphRanges(text).find((range) => safeCursor >= range.start && safeCursor <= range.end) ?? { start: 0, end: text.length };
  const left = text.slice(Math.max(paragraph.start, safeCursor - beforeChars), safeCursor);
  const right = text.slice(safeCursor, Math.min(paragraph.end, safeCursor + afterChars));
  return {
    beforeText: left.replace(/\s+/g, " ").trim(),
    afterText: right.replace(/\s+/g, " ").trim()
  };
}

function enclosingFootnoteRange(source, cursorIndex) {
  const text = String(source ?? "");
  const regex = /\\footnote(?:text)?\*?(?![A-Za-z@])/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    let open = skipLatexOptionalArgument(text, match.index + match[0].length);
    while (/\s/.test(text[open] ?? "")) open += 1;
    if (text[open] !== "{") continue;
    const close = findBraceClose(text, open);
    if (close >= 0 && cursorIndex >= match.index && cursorIndex <= close) {
      return {
        start: match.index,
        end: close + 1,
        bodyStart: open + 1,
        bodyEnd: close,
        detached: /\\footnotetext/i.test(match[0])
      };
    }
    if (close >= 0 && close > cursorIndex) break;
  }
  return null;
}

function nearestSentenceCursor(source, start, end) {
  const text = String(source ?? "");
  for (let index = start - 1; index >= 0; index -= 1) {
    if (!/\s/.test(text[index])) return index;
  }
  for (let index = end; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) return index;
  }
  return Math.max(0, Math.min(text.length, start));
}

function removeRange(source, start, end) {
  return `${source.slice(0, start)} ${source.slice(end)}`;
}

function splitCitationTokenSegments(inside) {
  const segments = [];
  let segmentStart = 0;
  let inQuotes = false;
  let escaped = false;

  for (let index = 0; index < inside.length; index += 1) {
    const char = inside[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char !== "," || inQuotes) {
      continue;
    }

    segments.push(buildCitationTokenSegment(inside, segmentStart, index));
    segmentStart = index + 1;
  }

  segments.push(buildCitationTokenSegment(inside, segmentStart, inside.length));
  return segments;
}

function buildCitationTokenSegment(source, rawStart, rawEnd) {
  let start = rawStart;
  let end = rawEnd;

  while (start < end && /\s/.test(source[start])) {
    start += 1;
  }
  while (end > start && /\s/.test(source[end - 1])) {
    end -= 1;
  }

  return {
    rawStart,
    rawEnd,
    start,
    end,
    value: source.slice(start, end)
  };
}

export function findCitationAtCursor(source, cursorIndex, windowChars = 500) {
  const citeCommandRegex = /\\(?:cite[a-zA-Z*]*|parencite\*?|textcite\*?|autocite\*?|footcite\*?|smartcite\*?)\s*(?:\[[^[\]]*]\s*){0,2}\{/g;
  let match;
  let active = null;
  while ((match = citeCommandRegex.exec(source)) !== null) {
    const openBraceIndex = match.index + match[0].lastIndexOf("{");
    const closeBraceIndex = findBraceClose(source, openBraceIndex);
    if (closeBraceIndex < 0) {
      continue;
    }
    if (cursorIndex < openBraceIndex + 1 || cursorIndex > closeBraceIndex) {
      continue;
    }
    active = {
      command: match[0].slice(0, match[0].indexOf("{")).trim(),
      matchStart: match.index,
      openBraceIndex,
      closeBraceIndex
    };
  }

  if (!active) {
    return null;
  }

  const inside = source.slice(active.openBraceIndex + 1, active.closeBraceIndex);
  const relativeCursor = Math.max(0, Math.min(inside.length, cursorIndex - active.openBraceIndex - 1));
  const segments = splitCitationTokenSegments(inside);
  const activeSegment = segments.find((segment) => relativeCursor >= segment.rawStart && relativeCursor <= segment.rawEnd)
    ?? segments.find((segment) => relativeCursor >= segment.start && relativeCursor <= segment.end)
    ?? segments[0]
    ?? { start: 0, end: 0, value: "" };
  const token = activeSegment.value;
  const tokenStartAbsolute = active.openBraceIndex + 1 + activeSegment.start;
  const tokenEndAbsolute = active.openBraceIndex + 1 + activeSegment.end;
  const tokens = segments.map((segment) => segment.value).filter(Boolean);
  const boundedSource = boundedCitationSource(source, active.matchStart, active.closeBraceIndex + 1);
  const sanitizedCursorIndex = boundedSource.citationStart;
  const footnote = enclosingFootnoteRange(boundedSource.source, sanitizedCursorIndex);
  const contextualSource = prepareContextSource(boundedSource.source, boundedSource.citationStart, boundedSource.citationEnd);
  const footnoteBody = footnote
    ? boundedSource.source.slice(footnote.bodyStart, footnote.bodyEnd)
    : "";
  const footnoteCursor = footnote ? sanitizedCursorIndex - footnote.bodyStart : -1;
  const footnoteEnd = footnote ? boundedSource.citationEnd - footnote.bodyStart : -1;
  const footnotePrepared = footnote
    ? prepareContextSource(footnoteBody, footnoteCursor, footnoteEnd)
    : "";
  const footnoteContext = footnote
    ? extractPreparedContextualContext(footnotePrepared, footnoteCursor)
    : "";
  const footnoteSentence = footnote
    ? sentenceAtCursor(footnotePrepared, footnoteCursor)?.text ?? ""
    : "";
  const footnoteProximity = footnote
    ? extractCitationProximity(footnotePrepared, footnoteCursor)
    : null;
  const parentCursor = footnote && !footnote.detached
    ? nearestSentenceCursor(contextualSource, footnote.start, footnote.end)
    : sanitizedCursorIndex;
  const parentContext = footnote && !footnote.detached
    ? extractPreparedContextualContext(contextualSource, parentCursor)
    : "";
  const citationProximity = extractCitationProximity(contextualSource, sanitizedCursorIndex);

  return {
    command: active.command,
    token,
    tokenStart: tokenStartAbsolute,
    tokenEnd: tokenEndAbsolute,
    cursorIndex,
    // Keep contextual input sentence-bounded and independent of the legacy
    // contextWindowChars setting. Simple/Direct still receive the same token,
    // command, and parsed-key fields above.
    contextText: footnote ? `${footnoteContext} ${parentContext}`.trim() : extractPreparedContextualContext(contextualSource, sanitizedCursorIndex),
    sentenceText: footnote ? footnoteSentence : sentenceAtCursor(contextualSource, sanitizedCursorIndex)?.text ?? "",
    footnoteContextInherited: Boolean(footnote),
    citationPrefixText: footnote ? footnoteProximity.beforeText : citationProximity.beforeText,
    citationSuffixText: footnote ? footnoteProximity.afterText : citationProximity.afterText,
    tokens,
    parsedKeyHint: parseCitationKeyHint(token)
  };
}
