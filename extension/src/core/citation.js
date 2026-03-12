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

export function parseCitationKeyHint(rawToken) {
  const normalized = String(rawToken ?? "").trim();
  if (!normalized) {
    return null;
  }
  const compact = normalized.replace(/[{}\s]/g, "");
  const match = compact.match(/^([A-Za-z'`.-]+?)(\d{2,4})([A-Za-z0-9_-]*)$/);
  if (!match) {
    const surnameOnlyMatch = compact.match(/^[A-Za-z'`.-]{3,}$/);
    return {
      raw: normalized,
      normalized: compact,
      surname: surnameOnlyMatch ? compact.replace(/[^A-Za-z-]/g, "") || null : null,
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
  const cleaned = String(rawSurnameToken ?? "").replace(/[^A-Za-z-]/g, "");
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
  const left = source.slice(0, cursorIndex);
  const right = source.slice(cursorIndex);
  const leftBoundary = Math.max(left.lastIndexOf("."), left.lastIndexOf("!"), left.lastIndexOf("?"), left.lastIndexOf("\n\n"));
  const nearestRightBoundaryCandidates = [right.indexOf("."), right.indexOf("!"), right.indexOf("?"), right.indexOf("\n\n")].filter((value) => value >= 0);
  const rightBoundary = nearestRightBoundaryCandidates.length ? Math.min(...nearestRightBoundaryCandidates) : right.length;
  return source.slice(Math.max(0, leftBoundary + 1), cursorIndex + rightBoundary + 1).replace(/\s+/g, " ").trim();
}

export function extractContextWindow(source, cursorIndex, windowChars = 500) {
  const safeWindow = Math.max(200, Math.min(1200, windowChars));
  const start = Math.max(0, cursorIndex - safeWindow);
  const end = Math.min(source.length, cursorIndex + Math.round(safeWindow / 3));
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

function removeRange(source, start, end) {
  return `${source.slice(0, start)} ${source.slice(end)}`;
}

export function findCitationAtCursor(source, cursorIndex, windowChars = 500) {
  const citeCommandRegex = /\\cite[a-zA-Z*]*\s*(?:\[[^[\]]*]\s*){0,2}\{/g;
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

  let tokenStart = relativeCursor;
  while (tokenStart > 0 && inside[tokenStart - 1] !== ",") {
    tokenStart -= 1;
  }

  let tokenEnd = relativeCursor;
  while (tokenEnd < inside.length && inside[tokenEnd] !== ",") {
    tokenEnd += 1;
  }

  while (tokenStart < tokenEnd && /\s/.test(inside[tokenStart])) {
    tokenStart += 1;
  }
  while (tokenEnd > tokenStart && /\s/.test(inside[tokenEnd - 1])) {
    tokenEnd -= 1;
  }

  const token = inside.slice(tokenStart, tokenEnd);
  const tokenStartAbsolute = active.openBraceIndex + 1 + tokenStart;
  const tokenEndAbsolute = active.openBraceIndex + 1 + tokenEnd;
  const tokens = inside.split(",").map((piece) => piece.trim()).filter(Boolean);
  const sanitizedSource = removeRange(source, active.matchStart, active.closeBraceIndex + 1);
  const sanitizedCursorIndex = active.matchStart;

  return {
    command: active.command,
    token,
    tokenStart: tokenStartAbsolute,
    tokenEnd: tokenEndAbsolute,
    cursorIndex,
    contextText: extractContextWindow(sanitizedSource, sanitizedCursorIndex, windowChars),
    sentenceText: extractSentenceAroundCursor(sanitizedSource, sanitizedCursorIndex),
    tokens,
    parsedKeyHint: parseCitationKeyHint(token)
  };
}
