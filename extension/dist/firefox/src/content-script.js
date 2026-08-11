(() => {
  const MESSAGE_TYPES = Object.freeze({
    GET_SETTINGS: "getSettings",
    SAVE_SETTINGS: "saveSettings",
    SEARCH_ADS: "searchAds",
    EXPORT_BIBTEX: "exportBibtex",
    RESOLVE_BIB_TARGET: "resolveBibTarget",
    APPLY_INSERTION: "applyInsertion"
  });
  const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
  const DEFAULT_TOAST_DURATION_MS = 2600;
  const MIN_TOAST_DURATION_MS = 900;
  const SUCCESS_TOAST_DURATION_MS = 1000;
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  function debugTrace() {
    // Temporary Overleaf live-test tracing removed. Keep the call sites as no-ops
    // so the recovery logic can stay untouched and easy to compare.
  }

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

  function parseCitationKeyHint(rawToken) {
    const normalized = String(rawToken ?? "").trim();
    if (!normalized) {
      return null;
    }
    const compact = normalized.replace(/[{}\s]/g, "");
    const spaced = normalized.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
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
    const parsedAuthorHint = parseAuthorHint(rawSurname);
    return {
      raw: normalized,
      normalized: compact,
      surname: parsedAuthorHint.surname,
      firstInitial: parsedAuthorHint.firstInitial,
      year: inferYear(yearText),
      suffix
    };
  }

  function parseAuthorHint(rawSurnameToken) {
    const preserved = String(rawSurnameToken ?? "")
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

  function extractSentenceAroundCursor(source, cursorIndex) {
    const left = source.slice(0, cursorIndex);
    const right = source.slice(cursorIndex);
    const leftBoundary = Math.max(left.lastIndexOf("."), left.lastIndexOf("!"), left.lastIndexOf("?"), left.lastIndexOf("\n\n"));
    const nearestRightBoundaryCandidates = [right.indexOf("."), right.indexOf("!"), right.indexOf("?"), right.indexOf("\n\n")].filter((value) => value >= 0);
    const rightBoundary = nearestRightBoundaryCandidates.length ? Math.min(...nearestRightBoundaryCandidates) : right.length;
    return source.slice(Math.max(0, leftBoundary + 1), cursorIndex + rightBoundary + 1).replace(/\s+/g, " ").trim();
  }

  function extractContextWindow(source, cursorIndex, windowChars = 500) {
    const safeWindow = Math.max(200, Math.min(1200, windowChars));
    const start = Math.max(0, cursorIndex - safeWindow);
    const end = Math.min(source.length, cursorIndex + Math.round(safeWindow / 3));
    return source.slice(start, end).replace(/\s+/g, " ").trim();
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

  function escapeRegex(value) {
    return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function findCitationAtCursor(source, cursorIndex, windowChars = 500) {
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
    const segments = splitCitationTokenSegments(inside);
    const activeSegment = segments.find((segment) => relativeCursor >= segment.rawStart && relativeCursor <= segment.rawEnd)
      ?? segments.find((segment) => relativeCursor >= segment.start && relativeCursor <= segment.end)
      ?? segments[0]
      ?? { start: 0, end: 0, value: "" };
    const token = activeSegment.value;
    const tokenStartAbsolute = active.openBraceIndex + 1 + activeSegment.start;
    const tokenEndAbsolute = active.openBraceIndex + 1 + activeSegment.end;
    const tokens = segments.map((segment) => segment.value).filter(Boolean);
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

  const REQUEST_EVENT = "EZCITE_PAGE_REQUEST";
  const RESPONSE_EVENT = "EZCITE_PAGE_RESPONSE";
  let overlay = null;
  let overlayState = null;
  let activeLookupGeneration = 0;
  let insertionInProgress = false;
  let insertionThemeMode = null;
  let queuedLookupAfterInsertion = null;
  let userFileNavigationSerial = 0;
  let lastUserFileNavigation = null;
  injectPageBridge();
  installStyles();
  installRuntimeHooks();
  installKeybinding();
  installUserFileNavigationTracking();

  function injectPageBridge() {
    if (document.querySelector("script[data-ezcite-page-bridge]")) {
      return;
    }
    const script = document.createElement("script");
    script.src = extensionApi.runtime.getURL("src/page-bridge.js");
    script.dataset.ezcitePageBridge = "true";
    script.onload = () => {
      script.remove();
    };
    script.onerror = () => {
      console.error("[OverCite content] page bridge failed to load");
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function installRuntimeHooks() {
    extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "ezcite:openOverlay") {
        return false;
      }
      startLookup().then(() => sendResponse({ ok: true })).catch((error) => {
        toast(error.message, "error");
        sendResponse({ ok: false, error: error.message });
      });
      return true;
    });
  }

  function installKeybinding() {
    window.addEventListener("keydown", (event) => {
      const usesMacOptionShortcut = event.altKey && event.shiftKey && event.code === "KeyE";
      const usesControlShortcut = event.ctrlKey && event.shiftKey && event.code === "KeyE";
      if (!(usesMacOptionShortcut || usesControlShortcut)) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      startLookup().catch((error) => toast(error.message, "error"));
    });
  }

  function installUserFileNavigationTracking() {
    const eventName = "PointerEvent" in window ? "pointerdown" : "mousedown";
    document.addEventListener(eventName, recordUserFileNavigation, true);
  }

  function recordUserFileNavigation(event) {
    if (!event.isTrusted || !insertionInProgress) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || target.closest("#ezcite-root")) {
      return;
    }
    const fileName = extractFileNameFromUserTarget(target);
    if (!fileName) {
      return;
    }
    userFileNavigationSerial += 1;
    lastUserFileNavigation = {
      serial: userFileNavigationSerial,
      fileName,
      timestamp: Date.now()
    };
  }

  function extractFileNameFromUserTarget(target) {
    const navigationElement = target.closest([
      "[role='treeitem']",
      "[role='tab']",
      "[data-testid='editor-tab-active']",
      "[data-testid*='editor-tab']",
      "[data-testid*='file-tree'] [role='button']",
      "[data-testid*='file-tree'] button",
      "[data-testid*='file-tree'] a",
      "[data-path]",
      ".file-tab",
      "[class~='entity']"
    ].join(","));
    if (!navigationElement || navigationElement.closest("#ezcite-root")) {
      return "";
    }
    const candidates = [
      navigationElement.getAttribute("data-path"),
      navigationElement.getAttribute("aria-label"),
      navigationElement.getAttribute("title"),
      navigationElement.textContent
    ];
    for (const candidate of candidates) {
      const fileName = extractLikelyEditorFileName(candidate);
      if (fileName) {
        return fileName;
      }
    }
    return "";
  }

  function getUserFileNavigationAfter(serial) {
    if (serial == null) {
      return null;
    }
    const baseline = Number(serial) || 0;
    if (lastUserFileNavigation && lastUserFileNavigation.serial > baseline) {
      return lastUserFileNavigation;
    }
    return null;
  }

  function hasUserFileNavigationAwayAfter(serial, targetFileName) {
    const navigation = getUserFileNavigationAfter(serial);
    return Boolean(navigation?.fileName && !matchesFileName(navigation.fileName, targetFileName));
  }

  function createUserFileNavigationError(targetFileName, navigation) {
    const error = new Error(`User selected ${navigation?.fileName || "another file"} while OverCite was switching to ${targetFileName}.`);
    error.name = "OverCiteUserFileNavigation";
    return error;
  }

  function isUserFileNavigationError(error) {
    return error?.name === "OverCiteUserFileNavigation";
  }

  function installStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #ezcite-root {
        --ez-bg:
          radial-gradient(circle at top right, rgba(236, 105, 65, 0.18), transparent 32%),
          linear-gradient(180deg, rgba(251, 248, 241, 0.98), rgba(247, 241, 232, 0.98));
        --ez-ink: #18212a;
        --ez-border: rgba(21, 32, 43, 0.18);
        --ez-panel-border: rgba(21, 32, 43, 0.12);
        --ez-muted: #5d6a78;
        --ez-status-bg: rgba(33, 79, 122, 0.08);
        --ez-status-ink: #214f7a;
        --ez-error-bg: rgba(164, 60, 39, 0.1);
        --ez-error-ink: #922816;
        --ez-card-bg: rgba(255, 255, 255, 0.78);
        --ez-card-hover: rgba(255, 255, 255, 0.96);
        --ez-key-bg: rgba(164, 60, 39, 0.12);
        --ez-key-ink: #922816;
        --ez-meta: #42505d;
        --ez-abstract: #465361;
        --ez-soft-panel: rgba(255, 255, 255, 0.46);
        --ez-close-hover: rgba(21, 32, 43, 0.08);
        --ez-scrollbar: rgba(21, 32, 43, 0.18);
        --ez-title-ink: #18212a;
        position: fixed;
        inset: auto 20px 20px auto;
        z-index: 2147483647;
        width: min(470px, calc(100vw - 24px));
        border-radius: 22px;
        border: 1px solid var(--ez-border);
        box-shadow: 0 24px 90px rgba(4, 9, 15, 0.28);
        background: var(--ez-bg);
        color: var(--ez-ink);
        font-family: "Avenir Next", "Segoe UI", "Gill Sans", "Trebuchet MS", sans-serif;
        overflow: hidden;
        backdrop-filter: blur(18px);
      }

      #ezcite-root[data-theme="dark"] {
        --ez-bg:
          radial-gradient(circle at top right, rgba(241, 138, 98, 0.16), transparent 34%),
          linear-gradient(180deg, rgba(23, 30, 40, 0.98), rgba(16, 21, 29, 0.98));
        --ez-ink: #eff4fb;
        --ez-border: rgba(222, 231, 240, 0.14);
        --ez-panel-border: rgba(222, 231, 240, 0.1);
        --ez-muted: #b7c1cf;
        --ez-status-bg: rgba(120, 170, 222, 0.14);
        --ez-status-ink: #a7d1ff;
        --ez-error-bg: rgba(241, 138, 98, 0.14);
        --ez-error-ink: #ffb398;
        --ez-card-bg: rgba(31, 38, 50, 0.86);
        --ez-card-hover: rgba(45, 55, 70, 0.98);
        --ez-key-bg: rgba(241, 138, 98, 0.16);
        --ez-key-ink: #ffb398;
        --ez-meta: #d8e0ea;
        --ez-abstract: #e4ebf3;
        --ez-soft-panel: rgba(255, 255, 255, 0.04);
        --ez-close-hover: rgba(222, 231, 240, 0.08);
        --ez-scrollbar: rgba(222, 231, 240, 0.18);
        --ez-title-ink: #f5f8fc;
      }

      #ezcite-root[hidden] {
        display: none;
      }

      .ezcite-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px 10px;
        border-bottom: 1px solid var(--ez-panel-border);
        background: linear-gradient(180deg, var(--ez-soft-panel), transparent);
      }

      .ezcite-kicker {
        margin: 0 0 3px;
        font-size: 1.32rem;
        font-weight: 800;
        letter-spacing: 0.02em;
        line-height: 1.05;
        color: var(--ez-ink);
      }

      .ezcite-subtitle {
        margin: 7px 0 0;
        color: var(--ez-meta);
        font-size: 1.08rem;
        line-height: 1.35;
      }

      .ezcite-close {
        border: 0;
        background: transparent;
        color: var(--ez-muted);
        cursor: pointer;
        inline-size: 34px;
        block-size: 34px;
        border-radius: 999px;
        font-size: 1.15rem;
        line-height: 1;
        transition: background 120ms ease, color 120ms ease;
      }

      .ezcite-close:hover,
      .ezcite-close:focus-visible {
        background: var(--ez-close-hover);
        color: var(--ez-ink);
        outline: none;
      }

      .ezcite-body {
        padding: 10px;
        display: grid;
        gap: 9px;
        max-height: 75vh;
        overflow: auto;
      }

      .ezcite-body::-webkit-scrollbar {
        width: 10px;
      }

      .ezcite-body::-webkit-scrollbar-thumb {
        background: var(--ez-scrollbar);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: content-box;
      }

      .ezcite-status {
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--ez-panel-border);
        font-size: 0.92rem;
        line-height: 1.4;
        background: var(--ez-status-bg);
        color: var(--ez-status-ink);
      }

      .ezcite-status.error {
        background: var(--ez-error-bg);
        color: var(--ez-error-ink);
      }

      .ezcite-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .ezcite-action {
        border: 1px solid var(--ez-panel-border);
        border-radius: 999px;
        padding: 10px 14px;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        color: var(--ez-ink);
        background: var(--ez-card-bg);
      }

      .ezcite-action-tertiary {
        padding: 6px 10px;
        font-size: 0.77rem;
        font-weight: 700;
        color: var(--ez-muted);
        background: var(--ez-soft-panel);
        border-color: var(--ez-panel-border);
      }

      .ezcite-action-tertiary:hover,
      .ezcite-action-tertiary:focus-visible {
        background: var(--ez-soft-panel);
        color: var(--ez-ink);
        outline: none;
      }

      .ezcite-action-primary {
        background: linear-gradient(135deg, rgba(164, 60, 39, 0.9), rgba(207, 124, 75, 0.95));
        color: white;
        border-color: rgba(164, 60, 39, 0.45);
      }

      #ezcite-root[data-theme="dark"] .ezcite-action-primary {
        background: linear-gradient(135deg, rgba(241, 138, 98, 0.94), rgba(198, 88, 61, 0.96));
        border-color: rgba(241, 138, 98, 0.38);
      }

      .ezcite-result {
        display: grid;
        gap: 10px;
        border: 1px solid var(--ez-panel-border);
        background: var(--ez-card-bg);
        border-radius: 18px;
        padding: 14px 15px;
        cursor: pointer;
        text-align: left;
        color: var(--ez-ink);
        font: inherit;
        box-shadow: 0 8px 26px rgba(9, 14, 20, 0.06);
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
      }

      .ezcite-result:hover,
      .ezcite-result:focus-visible {
        transform: translateY(-1px);
        border-color: rgba(164, 60, 39, 0.5);
        background: var(--ez-card-hover);
        box-shadow: 0 14px 34px rgba(9, 14, 20, 0.12);
        outline: none;
      }

      .ezcite-result-topline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .ezcite-year {
        color: var(--ez-muted);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .ezcite-source {
        color: var(--ez-muted);
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .ezcite-source-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .ezcite-citation-count {
        flex: 0 0 auto;
        padding: 3px 9px;
        border-radius: 999px;
        border: 1px solid rgba(96, 165, 250, 0.26);
        background: rgba(96, 165, 250, 0.14);
        color: var(--ez-title-ink);
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
      }

      .ezcite-key {
        display: inline-block;
        padding: 4px 9px;
        border-radius: 999px;
        background: var(--ez-key-bg);
        color: var(--ez-key-ink);
        font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
        font-size: 0.76rem;
        font-weight: 700;
      }

      .ezcite-paper-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 800;
        line-height: 1.32;
        text-wrap: balance;
        color: var(--ez-title-ink);
      }

      .ezcite-meta {
        margin: 0;
        color: var(--ez-meta);
        font-size: 0.84rem;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .ezcite-abstract {
        margin: 0;
        color: var(--ez-abstract);
        font-size: 0.86rem;
        line-height: 1.46;
      }

      .ezcite-abstract-wrap {
        padding-top: 8px;
        border-top: 1px solid var(--ez-panel-border);
      }

      .ezcite-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 16px 12px;
        border-top: 1px solid var(--ez-panel-border);
        background: linear-gradient(180deg, transparent, var(--ez-soft-panel));
        color: var(--ez-muted);
        font-size: 0.8rem;
      }

      .ezcite-footer strong {
        color: var(--ez-ink);
        font-weight: 700;
      }

      #ezcite-toast {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 2147483647;
        padding: 10px 14px;
        max-width: min(680px, calc(100vw - 32px));
        border-radius: 18px;
        background: rgba(24, 33, 42, 0.92);
        color: white;
        font: 600 0.86rem/1.3 "Avenir Next", "Gill Sans", "Trebuchet MS", sans-serif;
        text-align: center;
        white-space: normal;
        opacity: 0;
        pointer-events: none;
        transition: opacity 160ms ease;
      }

      #ezcite-toast.visible {
        opacity: 1;
      }

      @media (max-width: 640px) {
        #ezcite-root {
          inset: auto 12px 12px 12px;
          width: auto;
          max-height: calc(100vh - 24px);
        }

        .ezcite-header {
          padding: 16px 16px 12px;
        }

        .ezcite-footer {
          padding: 10px 16px 14px;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement("section");
    overlay.id = "ezcite-root";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ezcite-header">
        <div>
          <p class="ezcite-kicker">OverCite</p>
          <p class="ezcite-subtitle"></p>
        </div>
        <button type="button" class="ezcite-close" aria-label="Close OverCite">×</button>
      </div>
      <div class="ezcite-body"></div>
      <div class="ezcite-footer"></div>
    `;
    overlay.querySelector(".ezcite-close").addEventListener("click", closeOverlay);
    applyOverlayTheme("auto");
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderOverlay({ subtitle, status, results = [], shortcutText = "Alt+Shift+E", error = false, actions = [] }) {
    const root = ensureOverlay();
    const subtitleNode = root.querySelector(".ezcite-subtitle");
    const body = root.querySelector(".ezcite-body");
    const footer = root.querySelector(".ezcite-footer");
    subtitleNode.textContent = subtitle;
    body.textContent = "";
    root.hidden = false;

    if (status) {
      const statusNode = document.createElement("div");
      statusNode.className = `ezcite-status${error ? " error" : ""}`;
      statusNode.textContent = status;
      body.appendChild(statusNode);
    }

    if (actions.length) {
      const actionsNode = document.createElement("div");
      actionsNode.className = "ezcite-actions";
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ezcite-action ezcite-action-${action.kind ?? "secondary"}`;
        button.textContent = action.label;
        button.addEventListener("click", action.onClick);
        actionsNode.appendChild(button);
      }
      body.appendChild(actionsNode);
    }

    for (const candidate of results) {
      const button = document.createElement("button");
      const citationCountLabel = formatCitationCountBadge(candidate.citationCount);
      button.type = "button";
      button.className = "ezcite-result";
      const topLine = document.createElement("div");
      topLine.className = "ezcite-result-topline";
      topLine.append(
        createTextElement("div", "ezcite-key", candidate.generatedKey || "citation"),
        createTextElement("div", "ezcite-year", formatYear(candidate.year))
      );
      const sourceRow = document.createElement("div");
      sourceRow.className = "ezcite-source-row";
      sourceRow.append(createTextElement("div", "ezcite-source", candidate.sourceLabel || "Literature"));
      if (citationCountLabel) {
        sourceRow.append(createTextElement("div", "ezcite-citation-count", citationCountLabel));
      }
      const abstractWrap = document.createElement("div");
      abstractWrap.className = "ezcite-abstract-wrap";
      abstractWrap.append(createTextElement("p", "ezcite-abstract", truncate(candidate.abstract, 240)));
      button.append(
        topLine,
        sourceRow,
        createTextElement("div", "ezcite-paper-title", candidate.title),
        createTextElement("p", "ezcite-meta", formatCandidateMeta(candidate)),
        abstractWrap
      );
      button.addEventListener("click", () => {
        selectCandidate(candidate).catch((error) => {
          console.error("[OverCite content] candidate selection failed", error);
          toast(error.message, "error", { durationMs: 5200 });
        });
      });
      body.appendChild(button);
    }

    const footerInstruction = createTextElement(
      "span",
      "",
      "Pick a paper to rewrite the cite key and update your bibliography."
    );
    const footerTrigger = document.createElement("span");
    const footerTriggerLabel = createTextElement("strong", "", "Trigger:");
    footerTrigger.append(footerTriggerLabel, document.createTextNode(` ${shortcutText}`));
    footer.replaceChildren(footerInstruction, footerTrigger);
  }

  function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    element.textContent = String(text ?? "");
    return element;
  }

  async function startLookup(searchMode) {
    if (insertionInProgress) {
      queueLookupAfterInsertion(searchMode);
      return;
    }
    const lookupGeneration = ++activeLookupGeneration;
    debugTrace("lookup:start", {
      searchMode: normalizeSearchMode(searchMode),
      href: window.location.href
    });
    const settings = await callRuntime({ type: MESSAGE_TYPES.GET_SETTINGS });
    if (!isCurrentLookup(lookupGeneration)) {
      return;
    }
    let resolvedSearchMode = normalizeSearchMode(searchMode, settings.defaultSearchMode);
    const editorState = await getEditorStateWithRetry();
    if (!isCurrentLookup(lookupGeneration)) {
      return;
    }
    const citationContext = findCitationAtCursor(editorState.text, editorState.from, settings.contextWindowChars);
    if (!citationContext) {
      throw new Error("Place the cursor inside a \\cite{...} command before triggering OverCite.");
    }
    // Simple search intentionally ignores context, so an empty citation token
    // must retain contextual mode even when Simple is the configured default.
    if (resolvedSearchMode !== "contextual" && !citationContext.token.trim()) {
      resolvedSearchMode = "contextual";
    }

    overlayState = {
      lookupGeneration,
      settings,
      citationContext: { ...citationContext, searchMode: resolvedSearchMode },
      searchMode: resolvedSearchMode,
      originalFileName: editorState.fileName || readActiveFileName(),
      originalEditorState: editorState,
      projectState: {
        mainText: editorState.text,
        activeFileName: editorState.fileName || readActiveFileName(),
        projectFiles: collectProjectFileNames(),
        projectId: readProjectId()
      }
    };
    debugTrace("lookup:context", {
      originalFileName: overlayState.originalFileName,
      token: citationContext.token || "(empty)",
      command: citationContext.command,
      mode: resolvedSearchMode
    });

    renderOverlay({
      subtitle: `${citationContext.command}{${citationContext.token || "..."}}`,
      status: resolvedSearchMode === "simple"
        ? "Running simple search..."
        : resolvedSearchMode === "direct"
          ? "Running raw query..."
          : "Searching literature...",
      shortcutText: settings.shortcutHelpText,
      actions: buildSearchModeActions(citationContext, resolvedSearchMode)
    });
    applyOverlayTheme(settings.themeMode ?? "auto");

    let results;
    try {
      results = await callRuntime({
        type: MESSAGE_TYPES.SEARCH_ADS,
        citationContext: { ...citationContext, searchMode: resolvedSearchMode }
      });
    } catch (error) {
      if (!isCurrentLookup(lookupGeneration)) {
        return;
      }
      console.error("[OverCite content] lookup failed", error);
      renderOverlay({
        subtitle: `${citationContext.command}{${citationContext.token || "..."}}`,
        status: error.message || "OverCite could not complete this lookup.",
        shortcutText: settings.shortcutHelpText,
        error: true,
        actions: buildLookupErrorActions(citationContext, resolvedSearchMode)
      });
      toast(error.message || "OverCite could not complete this lookup.", "error", { durationMs: 5200 });
      return;
    }
    if (!isCurrentLookup(lookupGeneration)) {
      return;
    }

    overlayState.results = results;
    debugTrace("lookup:results", {
      count: results.length,
      topKey: results[0]?.generatedKey || "",
      topTitle: results[0]?.title || ""
    });
    if (!results.length) {
      renderOverlay({
        subtitle: `${citationContext.command}{${citationContext.token || "..."}}`,
        status: resolvedSearchMode === "simple"
          ? "No records matched the simple token-only search."
          : resolvedSearchMode === "direct"
            ? "No records matched the raw token query."
            : "No records matched the current citation token and context.",
        shortcutText: settings.shortcutHelpText,
        error: true,
        actions: buildSearchModeActions(citationContext, resolvedSearchMode)
      });
      return;
    }

    renderOverlay({
      subtitle: `${citationContext.command}{${citationContext.token || "..."}}`,
      results,
      shortcutText: settings.shortcutHelpText,
      actions: buildSearchModeActions(citationContext, resolvedSearchMode)
    });
  }

  function normalizeSearchMode(...candidates) {
    for (const candidate of candidates) {
      const normalized = String(candidate ?? "").trim().toLowerCase();
      if (normalized === "contextual" || normalized === "simple" || normalized === "direct") {
        return normalized;
      }
    }
    return "simple";
  }

  function buildSearchModeActions(citationContext, searchMode) {
    if (!citationContext?.token?.trim()) {
      return [];
    }
    if (searchMode === "simple") {
      return [
        {
          label: "Contextual search",
          kind: "tertiary",
          onClick: () => startLookup("contextual").catch((error) => toast(error.message, "error"))
        },
        {
          label: "Raw query",
          kind: "tertiary",
          onClick: () => startLookup("direct").catch((error) => toast(error.message, "error"))
        }
      ];
    }
    if (searchMode === "direct") {
      return [
        {
          label: "Contextual search",
          kind: "tertiary",
          onClick: () => startLookup("contextual").catch((error) => toast(error.message, "error"))
        },
        {
          label: "Simple search",
          kind: "tertiary",
          onClick: () => startLookup("simple").catch((error) => toast(error.message, "error"))
        }
      ];
    }
    return [
      {
        label: "Simple search",
        kind: "tertiary",
        onClick: () => startLookup("simple").catch((error) => toast(error.message, "error"))
      },
      {
        label: "Raw query",
        kind: "tertiary",
        onClick: () => startLookup("direct").catch((error) => toast(error.message, "error"))
      }
    ];
  }

  function buildLookupErrorActions(citationContext, searchMode) {
    return [
      {
        label: "Try again",
        kind: "primary",
        onClick: () => startLookup(searchMode).catch((error) => toast(error.message, "error"))
      },
      ...buildSearchModeActions(citationContext, searchMode)
    ];
  }

  async function selectCandidate(candidate) {
    const state = snapshotOverlayState(overlayState);
    if (!state) {
      return;
    }
    if (insertionInProgress) {
      return;
    }
    insertionInProgress = true;
    state.userFileNavigationSerialAtSelection = userFileNavigationSerial;
    insertionThemeMode = state.settings?.themeMode ?? "auto";
    try {
      await insertCandidateWithState(candidate, state);
    } finally {
      insertionInProgress = false;
      insertionThemeMode = null;
      drainQueuedLookupAfterInsertion();
    }
  }

  function queueLookupAfterInsertion(searchMode) {
    queuedLookupAfterInsertion = { searchMode };
  }

  function drainQueuedLookupAfterInsertion() {
    if (!queuedLookupAfterInsertion) {
      return;
    }
    const { searchMode } = queuedLookupAfterInsertion;
    queuedLookupAfterInsertion = null;
    setTimeout(() => {
      startLookup(searchMode).catch((error) => toast(error.message, "error"));
    }, 0);
  }

  function snapshotOverlayState(state) {
    if (!state) {
      return null;
    }
    return {
      ...state,
      settings: {
        ...state.settings,
        fallbackSources: [...(state.settings?.fallbackSources ?? [])],
        sourceApiTokens: { ...(state.settings?.sourceApiTokens ?? {}) },
        defaultProjectBibFileOverride: { ...(state.settings?.defaultProjectBibFileOverride ?? {}) }
      },
      citationContext: state.citationContext
        ? {
          ...state.citationContext,
          tokens: [...(state.citationContext.tokens ?? [])],
          parsedKeyHint: state.citationContext.parsedKeyHint
            ? { ...state.citationContext.parsedKeyHint }
            : state.citationContext.parsedKeyHint
        }
        : state.citationContext,
      originalEditorState: state.originalEditorState
        ? { ...state.originalEditorState }
        : state.originalEditorState,
      projectState: state.projectState
        ? {
          ...state.projectState,
          projectFiles: [...(state.projectState.projectFiles ?? [])]
        }
        : state.projectState,
      results: state.results ? [...state.results] : state.results
    };
  }

  function buildDocumentExpectation(text) {
    if (text == null) {
      return null;
    }
    const value = String(text);
    return {
      length: value.length,
      head: value.slice(0, 200),
      tail: value.slice(-200)
    };
  }

  function replaceTextRange(text, from, to, insert) {
    const value = String(text ?? "");
    const start = Math.max(0, Math.min(value.length, Number(from) || 0));
    const end = Math.max(start, Math.min(value.length, Number(to) || start));
    return `${value.slice(0, start)}${insert}${value.slice(end)}`;
  }

  async function insertCandidateWithState(candidate, state) {
    debugTrace("candidate:selected", {
      title: candidate.title,
      generatedKey: candidate.generatedKey,
      bibcode: candidate.bibcode,
      sourceId: candidate.sourceId
    });
    const diagnostics = createDiagnostics(candidate.title, state.settings.shortcutHelpText);
    diagnostics.step("Preparing insertion...");

    const projectState = state.projectState ?? await buildProjectState();
    diagnostics.step("Resolving bibliography target and exporting BibTeX...");
    let [bibTarget, exportedBibtex] = await Promise.all([
      timed("resolveBibTarget", () => callRuntime({
        type: MESSAGE_TYPES.RESOLVE_BIB_TARGET,
        projectState
      }), diagnostics),
      timed("exportBibtex", () => callRuntime({
        type: MESSAGE_TYPES.EXPORT_BIBTEX,
        bibcode: candidate.bibcode,
        candidate
      }), diagnostics)
    ]);

    if (bibTarget.status === "needs-choice") {
      diagnostics.step("Waiting for bibliography file selection...");
      const chosen = chooseBibTarget(bibTarget.candidates);
      if (!chosen) {
        throw new Error("No bibliography file selected.");
      }
      const overrides = {
        ...state.settings.defaultProjectBibFileOverride,
        [projectState.projectId]: chosen
      };
      state.settings = await callRuntime({
        type: MESSAGE_TYPES.SAVE_SETTINGS,
        settings: {
          ...state.settings,
          defaultProjectBibFileOverride: overrides
        }
      });
      bibTarget = { status: "resolved", target: chosen, candidates: bibTarget.candidates };
    }

    if (bibTarget.status !== "resolved") {
      throw new Error("Could not resolve the target .bib file for this Overleaf project.");
    }
    debugTrace("bib:target", {
      target: bibTarget.target,
      originalFileName: state.originalFileName || readActiveFileName()
    });

    const originalFileName = state.originalFileName || readActiveFileName();
    const originalRange = {
      from: state.citationContext.tokenStart,
      to: state.citationContext.tokenEnd
    };
    const optimisticKey = candidate.generatedKey || state.citationContext.token || "citation";
    const sourceRecoveryPayload = {
      excludeFileName: bibTarget.target,
      preferredFileName: originalFileName,
      projectFiles: projectState.projectFiles ?? [],
      originalText: state.originalEditorState?.text ?? "",
      tokenStart: state.citationContext.tokenStart,
      tokenEnd: state.citationContext.tokenEnd
    };
    const expectedSourceDocument = buildDocumentExpectation(state.originalEditorState?.text);
    const optimisticSourceText = state.originalEditorState?.text != null
      ? replaceTextRange(state.originalEditorState.text, originalRange.from, originalRange.to, optimisticKey)
      : null;
    const expectedOptimisticSourceDocument = buildDocumentExpectation(optimisticSourceText);
    let manuallyConfirmedSourceEditorState = null;
    let manuallyConfirmedBibEditorState = null;
    if (originalFileName) {
      diagnostics.step(`Returning to ${originalFileName}...`);
      if (matchesFileName(readActiveFileName(), originalFileName)) {
        debugTrace("source:return-skip", {
          target: originalFileName,
          activeNow: readActiveFileName()
        });
      } else {
        try {
          await timed(`openProjectFile:${originalFileName}`, () => openProjectFile(originalFileName, { preferTabsOnly: true }), diagnostics);
          await sleep(150);
          debugTrace("source:return-ok", {
            target: originalFileName,
            activeAfter: readActiveFileName()
          });
        } catch {
          try {
            await timed(`openProjectFile:${originalFileName}:project`, () => openProjectFile(originalFileName, { preferTabsOnly: false }), diagnostics);
            await sleep(250);
            const recoveredFileName = readActiveFileName();
            if (matchesFileName(recoveredFileName, originalFileName)) {
              debugTrace("source:return-recovered", {
                target: originalFileName,
                activeAfter: recoveredFileName
              });
            } else {
              throw new Error(`Recovered file did not match ${originalFileName}.`);
            }
          } catch {
            debugTrace("source:return-manual", {
              target: originalFileName,
              activeNow: readActiveFileName()
            });
            manuallyConfirmedSourceEditorState = await waitForManualFileSwitch(originalFileName, candidate.title, state.settings.shortcutHelpText, {
              expectedDocument: expectedSourceDocument
            });
          }
        }
      }
    }
    diagnostics.step(`Writing cite key in ${originalFileName || "current file"}...`);
    try {
      debugTrace("source:write-start", {
        target: originalFileName || "(current)",
        activeBefore: readActiveFileName(),
        from: originalRange.from,
        to: originalRange.to,
        key: optimisticKey
      });
      await timed("replaceRange:optimisticKey", () => pageRequest("replaceRange", {
        from: originalRange.from,
        to: originalRange.to,
        insert: optimisticKey,
        expectedFileName: originalFileName,
        expectedEditorIdentity: manuallyConfirmedSourceEditorState?.editorIdentity || "",
        expectedDocument: expectedSourceDocument
      }, 3000), diagnostics);
      debugTrace("source:write-ok", {
        activeAfter: readActiveFileName(),
        key: optimisticKey
      });
    } catch (error) {
      debugTrace("source:write-failed", {
        message: error.message,
        activeNow: readActiveFileName()
      });
      const sourceWriteAlreadyApplied = optimisticSourceText != null && await editorAlreadyHasText({
        fileName: originalFileName,
        expectedText: optimisticSourceText,
        allowUnknownFileName: !originalFileName,
        expectedEditorIdentity: manuallyConfirmedSourceEditorState?.editorIdentity || "",
        expectedNavigationSerial: manuallyConfirmedSourceEditorState?.manualConfirmationNavigationSerial
      });
      if (sourceWriteAlreadyApplied) {
        debugTrace("source:write-late-ack", {
          target: originalFileName || "(current)",
          key: optimisticKey
        });
      } else if (originalFileName) {
        manuallyConfirmedSourceEditorState = await waitForManualFileSwitch(originalFileName, candidate.title, state.settings.shortcutHelpText, {
          expectedDocument: expectedSourceDocument
        });
        assertManualConfirmationCurrent(manuallyConfirmedSourceEditorState);
        diagnostics.step(`Retrying cite key in ${originalFileName}...`);
        await timed("replaceRange:optimisticKey:retry", () => pageRequest("replaceRange", {
          from: originalRange.from,
          to: originalRange.to,
          insert: optimisticKey,
          expectedFileName: originalFileName,
          expectedEditorIdentity: manuallyConfirmedSourceEditorState.editorIdentity || "",
          expectedDocument: expectedSourceDocument
        }), diagnostics);
        debugTrace("source:write-retry-ok", {
          activeAfter: readActiveFileName(),
          key: optimisticKey
        });
      } else if (state.originalEditorState?.text) {
        diagnostics.step("Retrying source recovery...");
        await timed("openSourceFileByProjectScan:retry", () => openSourceFileByProjectScan(sourceRecoveryPayload), diagnostics);
        await sleep(150);
        diagnostics.step("Retrying cite key in recovered source file...");
        await timed("replaceRange:optimisticKey:retry", () => pageRequest("replaceRange", {
          from: originalRange.from,
          to: originalRange.to,
          insert: optimisticKey,
          expectedFileName: originalFileName,
          expectedDocument: expectedSourceDocument
        }), diagnostics);
        debugTrace("source:write-retry-ok", {
          activeAfter: readActiveFileName(),
          key: optimisticKey
        });
      } else {
        throw error;
      }
    }
    const optimisticRange = {
      from: originalRange.from,
      to: originalRange.from + optimisticKey.length
    };

    const switchedToBib = originalFileName !== bibTarget.target;
    if (switchedToBib) {
      diagnostics.step(`Opening ${bibTarget.target}...`);
      if (matchesFileName(readActiveFileName(), bibTarget.target)) {
        debugTrace("bib:open-skip", {
          target: bibTarget.target,
          activeNow: readActiveFileName()
        });
      } else {
        try {
          await timed(`openProjectFile:${bibTarget.target}`, () => openProjectFile(bibTarget.target, { preferTabsOnly: false }), diagnostics);
          debugTrace("bib:open-ok", {
            target: bibTarget.target,
            activeAfter: readActiveFileName()
          });
        } catch {
          debugTrace("bib:open-manual", {
            target: bibTarget.target,
            activeNow: readActiveFileName()
          });
          manuallyConfirmedBibEditorState = await waitForManualFileSwitch(
            bibTarget.target,
            candidate.title,
            state.settings.shortcutHelpText,
            {
              validate: (candidateState) => !isLikelyWrongEditorForBib(
                candidateState,
                buildSourceTextMatcher(
                  state.originalEditorState?.text ?? "",
                  state.citationContext?.tokenStart ?? 0,
                  state.citationContext?.tokenEnd ?? 0
                )
              )
            }
          );
        }
      }
    }

    diagnostics.step(`Reading ${bibTarget.target}...`);
    let bibEditorState;
    if (switchedToBib) {
      if (manuallyConfirmedBibEditorState) {
        bibEditorState = manuallyConfirmedBibEditorState;
      } else {
        try {
          bibEditorState = await getConfirmedBibEditorState({
            fileName: bibTarget.target,
            diagnostics,
            originalText: state.originalEditorState?.text ?? "",
            tokenStart: state.citationContext?.tokenStart ?? 0,
            tokenEnd: state.citationContext?.tokenEnd ?? 0
          });
        } catch {
          const sourceMatcher = buildSourceTextMatcher(
            state.originalEditorState?.text ?? "",
            state.citationContext?.tokenStart ?? 0,
            state.citationContext?.tokenEnd ?? 0
          );
          bibEditorState = await waitForManualFileSwitch(
            bibTarget.target,
            candidate.title,
            state.settings.shortcutHelpText,
            { validate: (candidateState) => !isLikelyWrongEditorForBib(candidateState, sourceMatcher) }
          );
          manuallyConfirmedBibEditorState = bibEditorState;
        }
      }
    } else {
      bibEditorState = state.originalEditorState ?? await timed("getEditorState:current", () => getEditorStateWithRetry(), diagnostics);
    }
    diagnostics.step("Computing bibliography update...");
    const insertion = await timed("applyInsertion", () => callRuntime({
      type: MESSAGE_TYPES.APPLY_INSERTION,
      payload: {
        bibText: bibEditorState.text,
        bibtex: exportedBibtex,
        candidate: {
          ...candidate,
          keyMode: state.settings.citationKeyMode,
          typedToken: state.citationContext.token,
          bibliographyInsertMode: state.settings.bibliographyInsertMode
        }
      }
    }), diagnostics);

    if (insertion.updatedBibText !== bibEditorState.text) {
      diagnostics.step(`Writing ${bibTarget.target}...`);
      if (switchedToBib && !manuallyConfirmedBibEditorState) {
        await ensureProjectFileActive(
          bibTarget.target,
          diagnostics,
          "before-write",
          buildDocumentExpectation(bibEditorState.text)
        );
      }
      debugTrace("bib:write-start", {
        target: bibTarget.target,
        activeBefore: readActiveFileName(),
        finalKey: insertion.finalKey
      });
      try {
        assertManualConfirmationCurrent(manuallyConfirmedBibEditorState);
        await timed(`replaceDocument:${bibTarget.target}`, () => pageRequest("replaceDocument", {
          text: insertion.updatedBibText,
          expectedFileName: bibTarget.target,
          expectedEditorIdentity: manuallyConfirmedBibEditorState?.editorIdentity || "",
          expectedDocument: {
            length: bibEditorState.text.length,
            head: bibEditorState.text.slice(0, 200),
            tail: bibEditorState.text.slice(-200)
          }
        }, 5000), diagnostics);
      } catch (error) {
        const bibliographyWriteAlreadyApplied = await editorAlreadyHasText({
          fileName: bibTarget.target,
          expectedText: insertion.updatedBibText,
          allowUnknownFileName: Boolean(manuallyConfirmedBibEditorState),
          expectedEditorIdentity: manuallyConfirmedBibEditorState?.editorIdentity || "",
          expectedNavigationSerial: manuallyConfirmedBibEditorState?.manualConfirmationNavigationSerial
        });
        if (bibliographyWriteAlreadyApplied) {
          debugTrace("bib:write-late-ack", {
            target: bibTarget.target,
            finalKey: insertion.finalKey
          });
        } else if (switchedToBib) {
          manuallyConfirmedBibEditorState = await waitForManualFileSwitch(bibTarget.target, candidate.title, state.settings.shortcutHelpText, {
            expectedDocument: buildDocumentExpectation(bibEditorState.text)
          });
          assertManualConfirmationCurrent(manuallyConfirmedBibEditorState);
          await timed(`replaceDocument:${bibTarget.target}:retry`, () => pageRequest("replaceDocument", {
            text: insertion.updatedBibText,
            expectedFileName: bibTarget.target,
            expectedEditorIdentity: manuallyConfirmedBibEditorState?.editorIdentity || "",
            expectedDocument: {
              length: bibEditorState.text.length,
              head: bibEditorState.text.slice(0, 200),
              tail: bibEditorState.text.slice(-200)
            }
          }, 5000), diagnostics);
        } else {
          throw error;
        }
      }
      const focusAction = state.settings.bibliographyInsertMode === "alphabetical"
        ? () => pageRequest("focusDocumentAnchor", { anchor: insertion.cursorAnchor }, 5000)
        : () => pageRequest("focusDocumentEnd", {}, 5000);
      const focusLabel = state.settings.bibliographyInsertMode === "alphabetical"
        ? `focusDocumentAnchor:${bibTarget.target}`
        : `focusDocumentEnd:${bibTarget.target}`;
      await timed(focusLabel, focusAction, diagnostics);
      debugTrace("bib:write-ok", {
        target: bibTarget.target,
        activeAfter: readActiveFileName(),
        finalKey: insertion.finalKey
      });
    }

    const shouldReturnToSource = Boolean(state.settings.returnToSourceAfterInsert);
    const needsManualSourceUpdate = insertion.finalKey !== optimisticKey;
    let shouldOpenSourceForFinalKey = switchedToBib && (shouldReturnToSource || needsManualSourceUpdate);
    const userFileNavigationSerialAtSelection = state.userFileNavigationSerialAtSelection ?? userFileNavigationSerial;
    let sourceReadyForFinalRewrite = !switchedToBib;
    let automaticReturnCancelledByUser = false;
    let overlayClosedForBackgroundFinish = false;
    function getManualFinalFileName() {
      const navigation = getUserFileNavigationAfter(userFileNavigationSerialAtSelection);
      if (!navigation?.fileName) {
        return "";
      }
      if (originalFileName && matchesFileName(navigation.fileName, originalFileName)) {
        return "";
      }
      return navigation.fileName;
    }
    function shouldCancelAutomaticSourceReturn() {
      return Boolean(shouldReturnToSource && !needsManualSourceUpdate && getManualFinalFileName());
    }
    function closeOverlayForBackgroundFinish() {
      if (!overlayClosedForBackgroundFinish) {
        closeOverlay();
        overlayClosedForBackgroundFinish = true;
      }
    }
    function reportInsertionProgress(label) {
      if (overlayClosedForBackgroundFinish) {
        diagnostics.note(label);
      } else {
        diagnostics.step(label);
      }
    }

    if (shouldReturnToSource) {
      closeOverlayForBackgroundFinish();
    }

    if (shouldOpenSourceForFinalKey && shouldCancelAutomaticSourceReturn()) {
      automaticReturnCancelledByUser = true;
      shouldOpenSourceForFinalKey = false;
    }

    const sourceRecoveryDeadlineAt = Date.now() + 7000;
    if (shouldOpenSourceForFinalKey) {
      const returnTargetLabel = originalFileName || "source file";
      reportInsertionProgress(`Returning to ${returnTargetLabel}...`);
      try {
        if (originalFileName) {
          await timed(`openProjectFile:${originalFileName}`, () => openProjectFile(originalFileName, {
            preferTabsOnly: true,
            deadlineAt: sourceRecoveryDeadlineAt,
            cancelOnUserFileNavigationAfterSerial: needsManualSourceUpdate ? null : userFileNavigationSerialAtSelection
          }), diagnostics);
          sourceReadyForFinalRewrite = true;
        } else {
          throw new Error("Original source filename was unavailable.");
        }
      } catch (error) {
        if (isUserFileNavigationError(error) && !needsManualSourceUpdate) {
          automaticReturnCancelledByUser = true;
          sourceReadyForFinalRewrite = false;
        } else if (!needsManualSourceUpdate && shouldCancelAutomaticSourceReturn()) {
          automaticReturnCancelledByUser = true;
          sourceReadyForFinalRewrite = false;
        } else {
          try {
            await timed("openSourceTabByContent", () => openSourceTabByContent({
              excludeFileName: bibTarget.target,
              preferredFileName: originalFileName,
              originalText: state.originalEditorState?.text ?? "",
              tokenStart: state.citationContext?.tokenStart ?? 0,
              tokenEnd: state.citationContext?.tokenEnd ?? 0,
              deadlineAt: sourceRecoveryDeadlineAt
            }), diagnostics);
            sourceReadyForFinalRewrite = true;
          } catch {
            if (!needsManualSourceUpdate && shouldCancelAutomaticSourceReturn()) {
              automaticReturnCancelledByUser = true;
              sourceReadyForFinalRewrite = false;
            } else {
              try {
                await timed("openSourceFileByProjectScan", () => openSourceFileByProjectScan({
                  excludeFileName: bibTarget.target,
                  projectFiles: projectState.projectFiles,
                  preferredFileName: originalFileName,
                  originalText: state.originalEditorState?.text ?? "",
                  tokenStart: state.citationContext?.tokenStart ?? 0,
                  tokenEnd: state.citationContext?.tokenEnd ?? 0,
                  deadlineAt: sourceRecoveryDeadlineAt
                }), diagnostics);
                sourceReadyForFinalRewrite = true;
              } catch {
                sourceReadyForFinalRewrite = false;
              }
            }
          }
        }
      }
    }

    if (shouldOpenSourceForFinalKey && !sourceReadyForFinalRewrite) {
      try {
        const activeSourceState = await timed("getEditorState:sourceCheck", () => getEditorStateWithRetry(2, 125, 1200), diagnostics);
        const activeSourceName = activeSourceState.fileName || readActiveFileName();
        const looksLikeSourceFile = originalFileName
          ? matchesFileName(activeSourceName, originalFileName)
          : Boolean(activeSourceName && activeSourceName !== bibTarget.target && /\.tex$/i.test(activeSourceName));
        if (!looksLikeSourceFile) {
          try {
            await timed("openSourceTabByContent:verify", () => openSourceTabByContent({
              excludeFileName: bibTarget.target,
              preferredFileName: originalFileName,
              originalText: state.originalEditorState?.text ?? "",
              tokenStart: state.citationContext?.tokenStart ?? 0,
              tokenEnd: state.citationContext?.tokenEnd ?? 0,
              deadlineAt: sourceRecoveryDeadlineAt
            }), diagnostics);
          } catch {
            await timed("openSourceFileByProjectScan:verify", () => openSourceFileByProjectScan({
              excludeFileName: bibTarget.target,
              projectFiles: projectState.projectFiles,
              preferredFileName: originalFileName,
              originalText: state.originalEditorState?.text ?? "",
              tokenStart: state.citationContext?.tokenStart ?? 0,
              tokenEnd: state.citationContext?.tokenEnd ?? 0,
              deadlineAt: sourceRecoveryDeadlineAt
            }), diagnostics);
          }
        }
        sourceReadyForFinalRewrite = true;
      } catch {
        sourceReadyForFinalRewrite = false;
      }
    }

    if (needsManualSourceUpdate && !sourceReadyForFinalRewrite) {
      diagnostics.finish(`Finished in ${formatMs(performance.now() - diagnostics.startedAt)}`);
      if (!overlayClosedForBackgroundFinish) {
        closeOverlay();
      }
      toast(
        `Inserted ${insertion.finalKey} into ${bibTarget.target}. Update the cite key in your source from ${optimisticKey} to ${insertion.finalKey}.`,
        "notice",
        { durationMs: 7500 }
      );
      return;
    }

    if (shouldReturnToSource && shouldOpenSourceForFinalKey && !sourceReadyForFinalRewrite && !automaticReturnCancelledByUser) {
      diagnostics.finish(`Finished in ${formatMs(performance.now() - diagnostics.startedAt)}`);
      toast(
        `${insertion.match ? "Reused" : "Inserted"} ${insertion.finalKey}, but OverCite could not return to ${originalFileName || "the source file"}.`,
        "notice",
        { durationMs: 4200 }
      );
      return;
    }

    if (needsManualSourceUpdate && sourceReadyForFinalRewrite) {
      const finalizingLabel = `Finalizing cite key in ${originalFileName || "current file"}...`;
      reportInsertionProgress(finalizingLabel);
      const finalSourceText = optimisticSourceText != null
        ? replaceTextRange(optimisticSourceText, optimisticRange.from, optimisticRange.to, insertion.finalKey)
        : null;
      try {
        await timed("replaceRange:finalKey", () => pageRequest("replaceRange", {
          from: optimisticRange.from,
          to: optimisticRange.to,
          insert: insertion.finalKey,
          expectedFileName: originalFileName,
          expectedDocument: expectedOptimisticSourceDocument
        }), diagnostics);
      } catch (error) {
        const finalSourceWriteAlreadyApplied = finalSourceText != null && await editorAlreadyHasText({
          fileName: originalFileName,
          expectedText: finalSourceText,
          allowUnknownFileName: !originalFileName
        });
        if (!finalSourceWriteAlreadyApplied) {
          throw error;
        }
        debugTrace("source:final-write-late-ack", {
          target: originalFileName || "(current)",
          key: insertion.finalKey
        });
      }
    }

    let restoredManualFinalFile = false;
    const manualFinalFileName = getManualFinalFileName();
    if (manualFinalFileName && !matchesFileName(readActiveFileName(), manualFinalFileName)) {
      reportInsertionProgress(`Returning to ${manualFinalFileName}...`);
      try {
        await timed(`openProjectFile:${manualFinalFileName}:manual-final`, () => openProjectFile(manualFinalFileName, { preferTabsOnly: false }), diagnostics);
        restoredManualFinalFile = true;
      } catch (error) {
        debugTrace("manual:return-after-insert-failed", {
          target: manualFinalFileName,
          message: error.message,
          activeNow: readActiveFileName()
        });
      }
    } else if (manualFinalFileName) {
      restoredManualFinalFile = true;
    }

    if (!restoredManualFinalFile && switchedToBib && needsManualSourceUpdate && !shouldReturnToSource) {
      reportInsertionProgress(`Returning to ${bibTarget.target}...`);
      try {
        await timed(`openProjectFile:${bibTarget.target}:final`, () => openProjectFile(bibTarget.target, { preferTabsOnly: false }), diagnostics);
      } catch (error) {
        debugTrace("bib:return-after-final-key-failed", {
          target: bibTarget.target,
          message: error.message,
          activeNow: readActiveFileName()
        });
      }
    }

    diagnostics.finish(`Finished in ${formatMs(performance.now() - diagnostics.startedAt)}`);
    if (!overlayClosedForBackgroundFinish) {
      closeOverlay();
    }
    if (!shouldReturnToSource) {
      toast(
        insertion.match
          ? `Reused existing bibliography entry: ${insertion.finalKey}`
          : `Inserted ${insertion.finalKey} into ${bibTarget.target}`,
        "info",
        { durationMs: SUCCESS_TOAST_DURATION_MS }
      );
    }
  }

  async function buildProjectState() {
    const editorState = await getEditorStateWithRetry();
    return {
      mainText: editorState.text,
      activeFileName: editorState.fileName || readActiveFileName(),
      projectFiles: collectProjectFileNames(),
      projectId: readProjectId()
    };
  }

  function collectProjectFileNames() {
    const names = new Set();
    const exactMatch = /\.(tex|bib)$/i;
    const selectorCandidates = [
      "[role='treeitem']",
      "[data-testid*='file-tree'] *",
      "[role='tab']",
      "button",
      "a",
      "span",
      "div"
    ];
    for (const selector of selectorCandidates) {
      for (const element of document.querySelectorAll(selector)) {
        const text = element.textContent?.trim();
        if (text && exactMatch.test(text)) {
          names.add(text);
        }
      }
    }
    return [...names];
  }

  function readProjectId() {
    const match = window.location.pathname.match(/\/project\/([^/]+)/);
    return match ? match[1] : "";
  }

  function readActiveFileName() {
    const selectors = [
      "[role='tab'][aria-selected='true']",
      "[role='tab'][data-active='true']",
      "[data-testid='editor-tab-active']",
      ".active[role='tab']",
      ".file-tab.active",
      ".tab.active"
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const fileName = extractLikelyEditorFileNameFromElement(element);
        if (fileName) {
          return fileName;
        }
      }
    }
    for (const element of document.querySelectorAll(".ol-cm-breadcrumbs")) {
      const fileName = extractLikelyEditorFileNameFromElement(element);
      if (fileName) {
        return fileName;
      }
    }
    return "";
  }

  function extractLikelyEditorFileNameFromElement(element) {
    if (!(element instanceof Element)) {
      return "";
    }
    const direct = extractLikelyEditorFileName(element.textContent?.trim() || "");
    const descendantMatches = Array.from(element.querySelectorAll("*"))
      .map((node) => extractLikelyEditorFileName(node.textContent?.trim() || ""))
      .filter(Boolean)
      .sort((left, right) => left.length - right.length);
    return descendantMatches[0] || direct;
  }

  async function openProjectFile(fileName, options = {}) {
    const { preferTabsOnly = false, cancelOnUserFileNavigationAfterSerial = null } = options;
    debugTrace("openProjectFile:start", {
      fileName,
      preferTabsOnly,
      activeBefore: readActiveFileName()
    });
    const candidates = findOpenableElementsByText(fileName, preferTabsOnly);
    if (!candidates.length) {
      debugTrace("openProjectFile:no-candidates", {
        fileName,
        preferTabsOnly
      });
      if (preferTabsOnly) {
        throw new Error(`Could not find an open editor tab for ${fileName}. Open it once in Overleaf and retry.`);
      }
      throw new Error(`Could not find ${fileName} in the current Overleaf project view.`);
    }
    let lastError = null;
    const requestedDeadlineAt = Number(options.deadlineAt);
    const deadlineAt = Number.isFinite(requestedDeadlineAt)
      ? Math.min(Date.now() + 5500, requestedDeadlineAt)
      : Date.now() + 5500;
    for (const candidate of candidates) {
      try {
        const remainingBeforeClick = deadlineAt - Date.now();
        if (remainingBeforeClick <= 0) {
          break;
        }
        if (hasUserFileNavigationAwayAfter(cancelOnUserFileNavigationAfterSerial, fileName)) {
          throw createUserFileNavigationError(fileName, getUserFileNavigationAfter(cancelOnUserFileNavigationAfterSerial));
        }
        candidate.scrollIntoView?.({ block: "center", inline: "nearest" });
        candidate.click();
        await sleep(Math.min(250, Math.max(0, deadlineAt - Date.now())));
        await waitForTargetEditorState({
          fileName,
          timeoutMs: Math.min(1800, Math.max(1, deadlineAt - Date.now())),
          beforeRead() {
            if (hasUserFileNavigationAwayAfter(cancelOnUserFileNavigationAfterSerial, fileName)) {
              throw createUserFileNavigationError(fileName, getUserFileNavigationAfter(cancelOnUserFileNavigationAfterSerial));
            }
          }
        });
        debugTrace("openProjectFile:ok", {
          fileName,
          activeAfter: readActiveFileName()
        });
        return;
      } catch (error) {
        if (isUserFileNavigationError(error)) {
          debugTrace("openProjectFile:user-navigation-abort", {
            fileName,
            activeNow: readActiveFileName()
          });
          throw error;
        }
        if (!preferTabsOnly && isLikelyFileTreeCandidate(candidate)) {
          const remainingForTree = Math.max(0, deadlineAt - Date.now());
          await sleep(Math.min(450, remainingForTree));
          const remainingForCheck = Math.max(0, deadlineAt - Date.now());
          if (remainingForCheck > 0 && await isProjectFileActive(fileName, null, remainingForCheck)) {
            debugTrace("openProjectFile:file-tree-early-return", {
              fileName,
              activeAfter: readActiveFileName()
            });
            return;
          }
        }
        lastError = error;
        debugTrace("openProjectFile:retry", {
          fileName,
          message: error.message,
          activeNow: readActiveFileName()
        });
        await sleep(Math.min(200, Math.max(0, deadlineAt - Date.now())));
      }
    }
    if (lastError) {
      debugTrace("openProjectFile:failed", {
        fileName,
        message: lastError.message,
        activeNow: readActiveFileName()
      });
      throw lastError;
    }
    throw new Error(`Timed out confirming ${fileName} as the active editor.`);
  }

  function matchesFileName(activeFileName, targetFileName) {
    const active = normalizeComparableFileName(activeFileName);
    const target = normalizeComparableFileName(targetFileName);
    if (!active || !target) {
      return false;
    }
    return active === target || active.endsWith(`/${target}`) || target.endsWith(`/${active}`);
  }

  function normalizeComparableFileName(fileName) {
    return String(fileName ?? "")
      .replace(/\\\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function ensureProjectFileActive(fileName, diagnostics, reasonLabel, expectedDocument = null) {
    if (await isProjectFileActive(fileName, expectedDocument)) {
      return;
    }
    debugTrace("openProjectFile:ensure", {
      fileName,
      reason: reasonLabel,
      activeNow: readActiveFileName()
    });
    await timed(
      `openProjectFile:${fileName}:ensure:${reasonLabel}`,
      () => openProjectFile(fileName, { preferTabsOnly: false }),
      diagnostics
    );
    await waitForProjectFileActive(fileName, 2500, expectedDocument);
  }

  async function isProjectFileActive(fileName, expectedDocument = null, requestTimeoutMs = 1000) {
    try {
      const state = await getEditorStateWithRetry(1, 0, Math.max(1, Math.min(1000, requestTimeoutMs)));
      return editorStateMatchesTarget(state, fileName, expectedDocument);
    } catch {
      return false;
    }
  }

  async function waitForProjectFileActive(fileName, timeoutMs = 3500, expectedDocument = null) {
    await waitFor(async () => isProjectFileActive(fileName, expectedDocument), timeoutMs);
  }

  async function openLikelySourceTab({ excludeFileName = "", preferredFileName = "", requireTex = false } = {}) {
    const targetExclude = String(excludeFileName ?? "").trim();
    const targetPreferred = String(preferredFileName ?? "").trim();
    const candidates = collectOpenEditorTabs()
      .filter((entry) => entry.fileName && entry.fileName !== targetExclude)
      .filter((entry) => !requireTex || /\.tex$/i.test(entry.fileName))
      .sort((left, right) => scoreSourceTab(right, targetPreferred) - scoreSourceTab(left, targetPreferred));

    if (!candidates.length) {
      throw new Error("Could not find a likely source editor tab.");
    }

    let lastError = null;
    for (const candidate of candidates) {
      try {
        candidate.element.scrollIntoView?.({ block: "center", inline: "nearest" });
        candidate.element.click();
        await sleep(250);
        await waitFor(async () => {
          const activeTabName = readActiveFileName();
          const activeFileName = extractLikelyEditorFileName(activeTabName) || activeTabName;
          if (!activeFileName || activeFileName === targetExclude) {
            return false;
          }
          if (!targetPreferred) {
            return true;
          }
          return activeFileName === targetPreferred;
        }, 3500);
        return;
      } catch (error) {
        lastError = error;
        await sleep(200);
      }
    }

    throw lastError ?? new Error("Could not switch back to a likely source editor tab.");
  }

  async function openSourceTabByContent({
    excludeFileName = "",
    preferredFileName = "",
    originalText = "",
    tokenStart = 0,
    tokenEnd = 0,
    deadlineAt = Date.now() + 7000
  } = {}) {
    const targetExclude = String(excludeFileName ?? "").trim();
    const targetPreferred = String(preferredFileName ?? "").trim();
    const candidates = collectOpenEditorTabs()
      .filter((entry) => entry.fileName && entry.fileName !== targetExclude)
      .filter((entry) => /\.tex$/i.test(entry.fileName))
      .sort((left, right) => scoreSourceTab(right, targetPreferred) - scoreSourceTab(left, targetPreferred));

    if (!candidates.length) {
      throw new Error("Could not find an open .tex editor tab.");
    }

    const contextMatcher = buildSourceTextMatcher(originalText, tokenStart, tokenEnd);
    let lastError = null;
    for (const candidate of candidates) {
      if (Date.now() >= deadlineAt) {
        break;
      }
      try {
        candidate.element.scrollIntoView?.({ block: "center", inline: "nearest" });
        candidate.element.click();
        await sleep(Math.min(250, Math.max(0, deadlineAt - Date.now())));
        while (Date.now() < deadlineAt) {
          const remainingMs = deadlineAt - Date.now();
          const state = await getEditorStateWithRetry(1, 0, Math.min(900, remainingMs));
          const activeName = state.fileName || readActiveFileName();
          if (activeName && activeName !== targetExclude && /\.tex$/i.test(activeName) && contextMatcher(state.text)) {
            return;
          }
          await sleep(Math.min(120, Math.max(0, deadlineAt - Date.now())));
        }
      } catch (error) {
        lastError = error;
        await sleep(Math.min(120, Math.max(0, deadlineAt - Date.now())));
      }
    }

    throw lastError ?? new Error("Could not return to the source editor by content match.");
  }

  async function openSourceFileByProjectScan({
    excludeFileName = "",
    preferredFileName = "",
    projectFiles = [],
    originalText = "",
    tokenStart = 0,
    tokenEnd = 0,
    deadlineAt = Date.now() + 7000
  } = {}) {
    const targetExclude = String(excludeFileName ?? "").trim();
    const targetPreferred = String(preferredFileName ?? "").trim();
    const texFiles = Array.from(new Set((projectFiles ?? [])
      .map((fileName) => String(fileName ?? "").trim())
      .filter((fileName) => fileName && fileName !== targetExclude && /\.tex$/i.test(fileName))))
      .sort((left, right) => Number(matchesFileName(right, targetPreferred)) - Number(matchesFileName(left, targetPreferred)));
    if (!texFiles.length) {
      throw new Error("Could not find any candidate source .tex files in the project.");
    }

    const contextMatcher = buildSourceTextMatcher(originalText, tokenStart, tokenEnd);
    let lastError = null;
    for (const fileName of texFiles) {
      if (Date.now() >= deadlineAt) {
        break;
      }
      try {
        await openProjectFile(fileName, { preferTabsOnly: false, deadlineAt });
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        const state = await getEditorStateWithRetry(1, 0, Math.min(900, remainingMs));
        const activeName = state.fileName || readActiveFileName();
        if (activeName && activeName !== targetExclude && /\.tex$/i.test(activeName) && contextMatcher(state.text)) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Could not recover the source file by scanning project .tex files.");
  }

  function findOpenableElementsByText(targetText, preferTabsOnly = false) {
    const normalizedTarget = String(targetText ?? "").trim();
    const tabSelectors = [
      "[role='tab']",
      "[data-testid='editor-tab-active']",
      "[data-testid*='editor-tab']",
      ".file-tab",
      "[aria-selected='true'][role='tab']"
    ];
    const treeSelectors = [
      "[role='treeitem']",
      "[data-testid*='file-tree'] [role='button']",
      "[data-testid*='file-tree'] button",
      "[data-testid*='file-tree'] a"
    ];

    const exactTabMatches = collectExactMatches(normalizedTarget, tabSelectors);
    if (exactTabMatches.length) {
      return exactTabMatches;
    }

    if (preferTabsOnly) {
      return [];
    }

    const treeMatches = collectTreeFilenameMatches(normalizedTarget, treeSelectors);
    if (treeMatches.length) {
      return treeMatches;
    }

    const broadMatches = collectBroadFilenameMatches(normalizedTarget);
    if (broadMatches.length) {
      return broadMatches;
    }

    return [];
  }

  function collectOpenEditorTabs() {
    const entries = [];
    const seen = new Set();
    const selectors = [
      "[role='tab']",
      ".file-tab",
      "[data-testid='editor-tab-active']",
      "[data-testid*='editor-tab']"
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest("#ezcite-root")) {
          continue;
        }
        if (!isVisibleElement(element)) {
          continue;
        }
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        const text = element.textContent?.trim() || "";
        const fileName = extractLikelyEditorFileName(text);
        if (!fileName) {
          continue;
        }
        entries.push({ element, text, fileName });
      }
    }
    return entries;
  }

  function scoreSourceTab(entry, preferredFileName) {
    let score = 0;
    const fileName = String(entry?.fileName ?? "");
    if (preferredFileName && fileName === preferredFileName) {
      score += 10;
    }
    if (/\.tex$/i.test(fileName)) {
      score += 6;
    }
    if (/\.bib$/i.test(fileName)) {
      score -= 10;
    }
    return score;
  }

  function buildSourceTextMatcher(originalText, tokenStart, tokenEnd) {
    const text = String(originalText ?? "");
    const leftSnippet = text.slice(Math.max(0, tokenStart - 80), tokenStart).trim();
    const rightSnippet = text.slice(tokenEnd, Math.min(text.length, tokenEnd + 80)).trim();
    return (candidateText) => {
      const haystack = String(candidateText ?? "");
      const leftOk = leftSnippet ? haystack.includes(leftSnippet) : true;
      const rightOk = rightSnippet ? haystack.includes(rightSnippet) : true;
      return leftOk && rightOk;
    };
  }

  function looksLikeTexSourceDocument(text) {
    const sample = String(text ?? "").slice(0, 4000);
    if (!sample) {
      return false;
    }
    const texMarkers = [
      "\\documentclass",
      "\\begin{document}",
      "\\section{",
      "\\subsection{",
      "\\title{",
      "\\author{",
      "\\bibliography{",
      "\\cite",
      "\\end{document}"
    ];
    return texMarkers.some((marker) => sample.includes(marker));
  }

  function documentMatchesExpectation(text, expectedDocument) {
    if (!expectedDocument || typeof expectedDocument !== "object") {
      return false;
    }
    const value = String(text ?? "");
    const expectedLength = Number(expectedDocument.length);
    const expectedHead = String(expectedDocument.head ?? "");
    const expectedTail = String(expectedDocument.tail ?? "");
    return (!Number.isFinite(expectedLength) || value.length === expectedLength) &&
      (!expectedHead || value.startsWith(expectedHead)) &&
      (!expectedTail || value.endsWith(expectedTail));
  }

  function editorStateMatchesTarget(state, fileName, expectedDocument = null, options = {}) {
    const target = String(fileName ?? "").trim();
    const activeFileName = String(state?.fileName ?? "").trim();
    const text = String(state?.text ?? "");
    if (activeFileName) {
      if (!matchesFileName(activeFileName, target)) {
        return false;
      }
      return !expectedDocument || documentMatchesExpectation(text, expectedDocument);
    }
    if (!options.allowUnknownFileName) {
      return false;
    }
    if (expectedDocument && !documentMatchesExpectation(text, expectedDocument)) {
      return false;
    }
    if (/\.bib$/i.test(target)) {
      return !looksLikeTexSourceDocument(text);
    }
    if (/\.tex$/i.test(target)) {
      return looksLikeTexSourceDocument(text) || documentMatchesExpectation(text, expectedDocument);
    }
    return Boolean(activeFileName || expectedDocument);
  }

  async function editorAlreadyHasText({
    fileName,
    expectedText,
    allowUnknownFileName = false,
    expectedEditorIdentity = "",
    expectedNavigationSerial = null
  }) {
    try {
      if (expectedNavigationSerial != null && expectedNavigationSerial !== userFileNavigationSerial) {
        return false;
      }
      const state = await getEditorStateWithRetry(2, 100, 1200);
      const expectedDocument = buildDocumentExpectation(expectedText);
      return (!expectedEditorIdentity || state.editorIdentity === expectedEditorIdentity) &&
        state.text === expectedText && editorStateMatchesTarget(
        state,
        fileName,
        expectedDocument,
        { allowUnknownFileName }
      );
    } catch {
      return false;
    }
  }

  function assertManualConfirmationCurrent(state) {
    const confirmedSerial = state?.manualConfirmationNavigationSerial;
    if (confirmedSerial != null && confirmedSerial !== userFileNavigationSerial) {
      throw new Error("The active editor changed after manual confirmation.");
    }
  }

  function isLikelyWrongEditorForBib(state, sourceMatcher) {
    const text = String(state?.text ?? "");
    if (sourceMatcher(text)) {
      return true;
    }
    return looksLikeTexSourceDocument(text);
  }

  async function getConfirmedBibEditorState({
    fileName,
    diagnostics,
    originalText = "",
    tokenStart = 0,
    tokenEnd = 0
  }) {
    const sourceMatcher = buildSourceTextMatcher(originalText, tokenStart, tokenEnd);
    return timed("getEditorState:bib", () => waitForTargetEditorState({
      fileName,
      timeoutMs: 5000,
      validate: (state) => !isLikelyWrongEditorForBib(state, sourceMatcher)
    }), diagnostics);
  }

  async function waitForTargetEditorState({ fileName, timeoutMs, validate = () => true, beforeRead = () => {}, allowUnknownFileName = false }) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      try {
        beforeRead();
        const state = await getEditorStateWithRetry(1, 0, Math.min(900, remainingMs));
        if (editorStateMatchesTarget(state, fileName, null, { allowUnknownFileName }) && validate(state)) {
          return state;
        }
      } catch (error) {
        lastError = error;
      }
      await sleep(Math.min(120, Math.max(0, remainingMs)));
    }
    throw lastError ?? new Error(`Could not confirm that ${fileName} is the active editor.`);
  }

  function collectExactMatches(targetText, selectors) {
    const matches = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest("#ezcite-root")) {
          continue;
        }
        if (!isVisibleElement(element)) {
          continue;
        }
        const text = element.textContent?.trim();
        const extractedFileName = extractLikelyEditorFileName(text);
        if (!text || (text !== targetText && extractedFileName !== targetText)) {
          continue;
        }
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        matches.push(element);
      }
      if (matches.length) {
        return matches;
      }
    }
    return matches;
  }

  function collectTreeFilenameMatches(targetText, selectors) {
    const matches = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest("#ezcite-root")) {
          continue;
        }
        if (!isVisibleElement(element)) {
          continue;
        }
        const text = element.textContent?.trim();
        if (!text || text !== targetText) {
          continue;
        }
        if (hasExactTextDescendant(element, targetText)) {
          continue;
        }
        const candidate = findPreferredTreeClickTarget(element);
        if (seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        matches.push(candidate);
      }
      if (matches.length) {
        return matches;
      }
    }
    return matches;
  }

  function findPreferredTreeClickTarget(element) {
    const directClickable = element.closest("[role='button'], button, a, [data-testid*='file']");
    if (directClickable && isVisibleElement(directClickable)) {
      return directClickable;
    }
    return element;
  }

  function collectBroadFilenameMatches(targetText) {
    const leafMatches = [];
    const seen = new Set();
    const selectors = ["span", "div", "a", "button"];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.closest("#ezcite-root")) {
          continue;
        }
        if (!isVisibleElement(element)) {
          continue;
        }
        const text = element.textContent?.trim();
        if (!text || text !== targetText) {
          continue;
        }
        if (hasExactTextDescendant(element, targetText)) {
          continue;
        }
        leafMatches.push(element);
      }
    }

    const ranked = leafMatches
      .map((leaf) => {
        const candidate = findBestClickableAncestor(leaf) || leaf;
        if (seen.has(candidate)) {
          return null;
        }
        seen.add(candidate);
        return {
          candidate,
          score: scoreClickableCandidate(candidate, targetText)
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.candidate);

    return ranked;
  }

  function findBestClickableAncestor(element) {
    const selectors = [
      "[role='treeitem']",
      "[role='button']",
      "[data-testid*='file']",
      "[data-path]",
      "button",
      "a",
      "li",
      "div"
    ];
    for (const selector of selectors) {
      const match = element.closest(selector);
      if (match && isVisibleElement(match)) {
        return match;
      }
    }
    return null;
  }

  function scoreClickableCandidate(element, targetText) {
    let score = 0;
    const text = element.textContent?.trim() || "";
    const testId = element.getAttribute?.("data-testid") || "";
    const role = element.getAttribute?.("role") || "";
    const className = typeof element.className === "string" ? element.className : "";

    if (text === targetText) {
      score += 8;
    }
    if (role === "treeitem") {
      score += 6;
    }
    if (role === "button") {
      score += 4;
    }
    if (testId.toLowerCase().includes("file")) {
      score += 5;
    }
    if (className.toLowerCase().includes("file")) {
      score += 4;
    }
    if (className.toLowerCase().includes("entity")) {
      score += 2;
    }
    if (element.tagName === "BUTTON" || element.tagName === "A") {
      score += 3;
    }

    return score;
  }

  function isLikelyFileTreeCandidate(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const role = element.getAttribute("role") || "";
    const testId = element.getAttribute("data-testid") || "";
    const className = typeof element.className === "string" ? element.className : "";
    return (
      role === "treeitem" ||
      role === "button" ||
      testId.toLowerCase().includes("file") ||
      className.toLowerCase().includes("file") ||
      className.toLowerCase().includes("entity")
    );
  }

  function hasExactTextDescendant(element, targetText) {
    for (const child of element.children) {
      if (child.textContent?.trim() === targetText) {
        return true;
      }
      if (hasExactTextDescendant(child, targetText)) {
        return true;
      }
    }
    return false;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function chooseBibTarget(candidates) {
    if (!candidates?.length) {
      return null;
    }
    return window.prompt(`OverCite found multiple .bib files. Enter the file name to use:\n${candidates.join("\n")}`, candidates[0])?.trim() || null;
  }

  async function callRuntime(message) {
    const timeoutMs = runtimeTimeoutForMessage(message?.type);
    const response = await withTimeout(
      extensionApi.runtime.sendMessage(message),
      timeoutMs,
      runtimeTimeoutMessage(message?.type)
    );
    if (!response?.ok) {
      throw new Error(response?.error ?? "Unknown OverCite error");
    }
    return response.result;
  }

  function runtimeTimeoutForMessage(messageType) {
    if (messageType === MESSAGE_TYPES.SEARCH_ADS) {
      return 40000;
    }
    if (messageType === MESSAGE_TYPES.EXPORT_BIBTEX) {
      return 16000;
    }
    return 10000;
  }

  function runtimeTimeoutMessage(messageType) {
    if (messageType === MESSAGE_TYPES.SEARCH_ADS) {
      return "The literature search took too long. Try again or use Simple search.";
    }
    if (messageType === MESSAGE_TYPES.EXPORT_BIBTEX) {
      return "Timed out exporting BibTeX from the selected source. Try again.";
    }
    return "Timed out waiting for the OverCite background process. Refresh the Overleaf page and try again.";
  }

  function extractLikelyEditorFileName(text) {
    const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    const match = normalized.match(/([A-Za-z0-9_.\-\/ ]+\.(?:tex|bib|sty|cls|bst|bbx|cbx|txt|md|csv|json|yaml|yml|py|js|ts|r|m))(?!.*\.(?:tex|bib|sty|cls|bst|bbx|cbx|txt|md|csv|json|yaml|yml|py|js|ts|r|m))/i);
    return match ? match[1].trim() : "";
  }

  function pageRequest(action, payload = {}, timeoutMs = 5000) {
    const requestId = crypto.randomUUID();
    debugTrace("pageRequest:start", {
      action,
      timeoutMs,
      activeBefore: readActiveFileName()
    });
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener(RESPONSE_EVENT, listener);
        const bridgeReady = Boolean(window.__OVERCITE_PAGE_BRIDGE_READY__);
        console.error("[OverCite content] page action timeout", {
          action,
          requestId,
          bridgeReady
        });
        debugTrace("pageRequest:timeout", {
          action,
          bridgeReady,
          activeNow: readActiveFileName()
        });
        reject(new Error(`Timed out waiting for page action: ${action}${bridgeReady ? "" : " (page bridge not ready)"}`));
      }, timeoutMs);
      const listener = (event) => {
        if (event.detail?.requestId !== requestId) {
          return;
        }
        window.clearTimeout(timeoutId);
        window.removeEventListener(RESPONSE_EVENT, listener);
        if (event.detail.ok) {
          debugTrace("pageRequest:ok", {
            action,
            activeAfter: readActiveFileName()
          });
          resolve(event.detail.result);
        } else {
          debugTrace("pageRequest:error", {
            action,
            message: event.detail.error,
            activeNow: readActiveFileName()
          });
          reject(new Error(event.detail.error));
        }
      };
      window.addEventListener(RESPONSE_EVENT, listener);
      const detail = createPageBridgeDetail({ requestId, action, payload });
      window.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail
        })
      );
    });
  }

  function createPageBridgeDetail(detail) {
    if (typeof cloneInto === "function") {
      try {
        return cloneInto(detail, window);
      } catch (error) {
        console.warn("[OverCite content] cloneInto failed, falling back to raw detail", error);
      }
    }
    return detail;
  }

  async function getEditorStateWithRetry(attempts = 4, delayMs = 125, requestTimeoutMs = 1200) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const state = await pageRequest("getActiveEditorState", {}, requestTimeoutMs);
        debugTrace("editorState:ok", {
          attempt: attempt + 1,
          fileName: state.fileName || "(none)",
          selection: `${state.from}-${state.to}`
        });
        return state;
      } catch (error) {
        lastError = error;
        debugTrace("editorState:retry", {
          attempt: attempt + 1,
          message: error.message,
          activeNow: readActiveFileName()
        });
        await sleep(delayMs);
      }
    }
    throw lastError ?? new Error("Could not read the active Overleaf editor state.");
  }

  function closeOverlay() {
    activeLookupGeneration += 1;
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    overlayState = null;
  }

  function isCurrentLookup(lookupGeneration) {
    return lookupGeneration === activeLookupGeneration;
  }

  function applyOverlayTheme(themeMode) {
    if (!overlay) {
      return;
    }
    const resolvedTheme = resolveThemeMode(themeMode);
    overlay.dataset.theme = resolvedTheme;
  }

  function resolveThemeMode(themeMode) {
    if (themeMode === "dark" || themeMode === "light") {
      return themeMode;
    }
    return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
  }

  function toast(message, kind = "info", options = {}) {
    let toastNode = document.querySelector("#ezcite-toast");
    if (!toastNode) {
      toastNode = document.createElement("div");
      toastNode.id = "ezcite-toast";
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = message;
    toastNode.className = "visible";
    if (kind === "error") {
      toastNode.style.background = "rgba(146, 40, 22, 0.95)";
    } else if (kind === "notice") {
      toastNode.style.background = "rgba(46, 72, 104, 0.96)";
    } else {
      toastNode.style.background = "rgba(24, 33, 42, 0.92)";
    }
    window.clearTimeout(toastNode._timeoutId);
    window.clearTimeout(toastNode._removeTimeoutId);
    const durationMs = Number.isFinite(options?.durationMs)
      ? Math.max(MIN_TOAST_DURATION_MS, options.durationMs)
      : DEFAULT_TOAST_DURATION_MS;
    const timeoutId = window.setTimeout(() => {
      toastNode.classList.remove("visible");
      toastNode._removeTimeoutId = window.setTimeout(() => {
        if (toastNode._timeoutId === timeoutId && !toastNode.classList.contains("visible")) {
          toastNode.remove();
        }
      }, 250);
    }, durationMs);
    toastNode._timeoutId = timeoutId;
  }

  async function waitFor(check, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error("Timed out waiting for Overleaf to switch files.");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function waitForManualFileSwitch(fileName, subtitle, shortcutText, options = {}) {
    debugTrace("manual-switch:prompt", {
      fileName,
      activeNow: readActiveFileName()
    });
    let continueHandler = null;
    const waitForContinue = new Promise((resolve) => {
      continueHandler = async () => {
        try {
          const state = await getEditorStateWithRetry(2, 120, 1200);
          if (!editorStateMatchesTarget(state, fileName, options.expectedDocument ?? null, { allowUnknownFileName: true }) ||
              (typeof options.validate === "function" && !options.validate(state))) {
            toast(`The current editor does not appear to be ${fileName}. Open it in Overleaf, then continue.`, "error", { durationMs: 4200 });
            return;
          }
          toast(`Continuing with the current editor as ${fileName}.`);
          debugTrace("manual-switch:continue", {
            fileName,
            activeNow: state.fileName || readActiveFileName()
          });
          resolve({
            ...state,
            manualConfirmationNavigationSerial: userFileNavigationSerial
          });
        } catch (error) {
          toast(`Could not read the current editor: ${error.message}`, "error", { durationMs: 4200 });
        }
      };
    });

    renderOverlay({
      subtitle,
      status: `OverCite could not switch files automatically.\nOpen ${fileName} in Overleaf yourself, then click continue.`,
      shortcutText,
      actions: [
        {
          label: `Use current editor as ${fileName}`,
          kind: "primary",
          onClick: continueHandler
        }
      ]
    });
    applyOverlayTheme(insertionThemeMode ?? overlayState?.settings?.themeMode ?? "auto");
    return waitForContinue;
  }

  function createDiagnostics(subtitle, shortcutText) {
    const startedAt = performance.now();
    let lastLabel = "Initializing";
    return {
      startedAt,
      step(label) {
        lastLabel = label;
        renderOverlay({
          subtitle,
          status: `${label}\nElapsed: ${formatMs(performance.now() - startedAt)}`,
          shortcutText
        });
        applyOverlayTheme(insertionThemeMode ?? overlayState?.settings?.themeMode ?? "auto");
      },
      note(label) {
        lastLabel = label;
      },
      finish(_label) {},
      lastLabel() {
        return lastLabel;
      }
    };
  }

  async function timed(label, task, diagnostics) {
    try {
      return await task();
    } catch (error) {
      const prefix = diagnostics ? `${diagnostics.lastLabel()} failed` : `${label} failed`;
      throw new Error(`${prefix}: ${error.message}`);
    }
  }

  function formatMs(value) {
    if (value < 1000) {
      return `${Math.round(value)} ms`;
    }
    return `${(value / 1000).toFixed(2)} s`;
  }

  function formatAuthors(authors, year) {
    const authorText = Array.isArray(authors) ? authors.slice(0, 3).join("; ") : "";
    const suffix = Array.isArray(authors) && authors.length > 3 ? " et al." : "";
    return [authorText + suffix, year].filter(Boolean).join(" | ");
  }

  function formatCandidateMeta(candidate) {
    return formatAuthors(candidate?.authors, candidate?.year);
  }

  function formatCitationCountBadge(value) {
    const count = Math.trunc(Number(value));
    if (!Number.isFinite(count) || count <= 0) {
      return "";
    }
    return `cited by ${count.toLocaleString("en-US")}`;
  }

  function formatYear(year) {
    return year ? String(year) : "No year";
  }

  function truncate(value, length) {
    const text = String(value ?? "").trim();
    if (text.length <= length) {
      return text;
    }
    return `${text.slice(0, length - 1).trimEnd()}…`;
  }
})();
