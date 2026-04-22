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
    const match = spaced.match(/^([A-Za-z'`.\-\s]+?)(\d{2,4})([A-Za-z0-9_-]*)$/);
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
  injectPageBridge();
  installStyles();
  installRuntimeHooks();
  installKeybinding();

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
      button.type = "button";
      button.className = "ezcite-result";
      button.innerHTML = `
        <div class="ezcite-result-topline">
          <div class="ezcite-key">${escapeHtml(candidate.generatedKey || "citation")}</div>
          <div class="ezcite-year">${escapeHtml(formatYear(candidate.year))}</div>
        </div>
        <div class="ezcite-paper-title">${escapeHtml(candidate.title)}</div>
        <p class="ezcite-meta">${escapeHtml(formatAuthors(candidate.authors, candidate.year))}</p>
        <div class="ezcite-abstract-wrap">
          <p class="ezcite-abstract">${escapeHtml(truncate(candidate.abstract, 240))}</p>
        </div>
      `;
      button.addEventListener("click", () => {
        selectCandidate(candidate).catch((error) => {
          console.error("[OverCite content] candidate selection failed", error);
          toast(error.message, "error", { durationMs: 5200 });
        });
      });
      body.appendChild(button);
    }

    footer.innerHTML = `<span>Pick a paper to rewrite the cite key and update your bibliography.</span><span><strong>Trigger:</strong> ${escapeHtml(shortcutText)}</span>`;
  }

  async function startLookup(searchMode) {
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
    if (resolvedSearchMode === "direct" && !citationContext.token.trim()) {
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
        ? "Running simple ADS search..."
        : resolvedSearchMode === "direct"
          ? "Running ADS query..."
          : "Searching NASA ADS...",
      shortcutText: settings.shortcutHelpText,
      actions: buildSearchModeActions(citationContext, resolvedSearchMode)
    });
    applyOverlayTheme(settings.themeMode ?? "auto");

    const results = await callRuntime({
      type: MESSAGE_TYPES.SEARCH_ADS,
      citationContext: { ...citationContext, searchMode: resolvedSearchMode }
    });
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
          ? "No ADS records matched the simple token-only search."
          : resolvedSearchMode === "direct"
            ? "No ADS records matched the direct token query."
            : "No ADS records matched the current citation token and context.",
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
    return "contextual";
  }

  function buildSearchModeActions(citationContext, searchMode) {
    if (!citationContext?.token?.trim()) {
      return [];
    }
    if (searchMode === "simple") {
      return [
        {
          label: "Back to contextual",
          kind: "tertiary",
          onClick: () => startLookup("contextual").catch((error) => toast(error.message, "error"))
        },
        {
          label: "ADS query",
          kind: "tertiary",
          onClick: () => startLookup("direct").catch((error) => toast(error.message, "error"))
        }
      ];
    }
    if (searchMode === "direct") {
      return [
        {
          label: "Back to contextual",
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
        label: "ADS query",
        kind: "tertiary",
        onClick: () => startLookup("direct").catch((error) => toast(error.message, "error"))
      }
    ];
  }

  async function selectCandidate(candidate) {
    if (!overlayState) {
      return;
    }
    debugTrace("candidate:selected", {
      title: candidate.title,
      generatedKey: candidate.generatedKey,
      bibcode: candidate.bibcode
    });
    const diagnostics = createDiagnostics(candidate.title, overlayState.settings.shortcutHelpText);
    diagnostics.step("Preparing insertion...");

    const projectState = overlayState.projectState ?? await buildProjectState();
    diagnostics.step("Resolving bibliography target and exporting BibTeX...");
    let [bibTarget, exportedBibtex] = await Promise.all([
      timed("resolveBibTarget", () => callRuntime({
        type: MESSAGE_TYPES.RESOLVE_BIB_TARGET,
        projectState
      }), diagnostics),
      timed("exportBibtex", () => callRuntime({
        type: MESSAGE_TYPES.EXPORT_BIBTEX,
        bibcode: candidate.bibcode
      }), diagnostics)
    ]);

    if (bibTarget.status === "needs-choice") {
      diagnostics.step("Waiting for bibliography file selection...");
      const chosen = chooseBibTarget(bibTarget.candidates);
      if (!chosen) {
        throw new Error("No bibliography file selected.");
      }
      const overrides = {
        ...overlayState.settings.defaultProjectBibFileOverride,
        [projectState.projectId]: chosen
      };
      overlayState.settings = await callRuntime({
        type: MESSAGE_TYPES.SAVE_SETTINGS,
        settings: {
          ...overlayState.settings,
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
      originalFileName: overlayState.originalFileName || readActiveFileName()
    });

    const originalFileName = overlayState.originalFileName || readActiveFileName();
    const originalRange = {
      from: overlayState.citationContext.tokenStart,
      to: overlayState.citationContext.tokenEnd
    };
    const optimisticKey = candidate.generatedKey || overlayState.citationContext.token || "citation";
    const sourceRecoveryPayload = {
      excludeFileName: bibTarget.target,
      preferredFileName: originalFileName,
      projectFiles: overlayState.projectState?.projectFiles ?? [],
      originalText: overlayState.originalEditorState?.text ?? "",
      tokenStart: overlayState.citationContext.tokenStart,
      tokenEnd: overlayState.citationContext.tokenEnd
    };
    const expectedSourceDocument = overlayState.originalEditorState?.text != null
      ? {
        length: overlayState.originalEditorState.text.length,
        head: overlayState.originalEditorState.text.slice(0, 200),
        tail: overlayState.originalEditorState.text.slice(-200)
      }
      : null;
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
            if (recoveredFileName && recoveredFileName.includes(originalFileName)) {
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
            await waitForManualFileSwitch(originalFileName, candidate.title, overlayState.settings.shortcutHelpText);
          }
        }
      }
    } else if (overlayState.originalEditorState?.text) {
      diagnostics.step("Recovering source file...");
      try {
        await timed("openSourceFileByProjectScan", () => openSourceFileByProjectScan(sourceRecoveryPayload), diagnostics);
        await sleep(150);
        debugTrace("source:scan-recovered", {
          activeAfter: readActiveFileName()
        });
      } catch (error) {
        debugTrace("source:scan-recovery-failed", {
          message: error.message,
          activeNow: readActiveFileName()
        });
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
        expectedDocument: expectedSourceDocument
      }), diagnostics);
      debugTrace("source:write-ok", {
        activeAfter: readActiveFileName(),
        key: optimisticKey
      });
    } catch (error) {
      debugTrace("source:write-failed", {
        message: error.message,
        activeNow: readActiveFileName()
      });
      if (originalFileName) {
        await waitForManualFileSwitch(originalFileName, candidate.title, overlayState.settings.shortcutHelpText);
        diagnostics.step(`Retrying cite key in ${originalFileName}...`);
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
      } else if (overlayState.originalEditorState?.text) {
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
          await waitForManualFileSwitch(bibTarget.target, candidate.title, overlayState.settings.shortcutHelpText);
        }
      }
    }

    diagnostics.step(`Reading ${bibTarget.target}...`);
    const bibEditorState = switchedToBib
      ? await getConfirmedBibEditorState({
        fileName: bibTarget.target,
        diagnostics,
        originalText: overlayState.originalEditorState?.text ?? "",
        tokenStart: overlayState.citationContext?.tokenStart ?? 0,
        tokenEnd: overlayState.citationContext?.tokenEnd ?? 0
      })
      : (overlayState.originalEditorState ?? await timed("getEditorState:current", () => getEditorStateWithRetry(), diagnostics));
    diagnostics.step("Computing bibliography update...");
    const insertion = await timed("applyInsertion", () => callRuntime({
      type: MESSAGE_TYPES.APPLY_INSERTION,
      payload: {
        bibText: bibEditorState.text,
        bibtex: exportedBibtex,
        candidate: {
          ...candidate,
          keyMode: overlayState.settings.citationKeyMode,
          typedToken: overlayState.citationContext.token,
          bibliographyInsertMode: overlayState.settings.bibliographyInsertMode
        }
      }
    }), diagnostics);

    if (insertion.updatedBibText !== bibEditorState.text) {
      diagnostics.step(`Writing ${bibTarget.target}...`);
      if (switchedToBib) {
        await ensureProjectFileActive(bibTarget.target, diagnostics, "before-write");
      }
      debugTrace("bib:write-start", {
        target: bibTarget.target,
        activeBefore: readActiveFileName(),
        finalKey: insertion.finalKey
      });
      try {
        await timed(`replaceDocument:${bibTarget.target}`, () => pageRequest("replaceDocument", {
          text: insertion.updatedBibText,
          expectedFileName: bibTarget.target,
          expectedDocument: {
            length: bibEditorState.text.length,
            head: bibEditorState.text.slice(0, 200),
            tail: bibEditorState.text.slice(-200)
          }
        }, 12000), diagnostics);
      } catch (error) {
        if (switchedToBib) {
          await waitForManualFileSwitch(bibTarget.target, candidate.title, overlayState.settings.shortcutHelpText);
          await ensureProjectFileActive(bibTarget.target, diagnostics, "after-manual-write");
          await timed(`replaceDocument:${bibTarget.target}:retry`, () => pageRequest("replaceDocument", {
            text: insertion.updatedBibText,
            expectedFileName: bibTarget.target,
            expectedDocument: {
              length: bibEditorState.text.length,
              head: bibEditorState.text.slice(0, 200),
              tail: bibEditorState.text.slice(-200)
            }
          }, 12000), diagnostics);
        } else {
          throw error;
        }
      }
      const focusAction = overlayState.settings.bibliographyInsertMode === "alphabetical"
        ? () => pageRequest("focusDocumentAnchor", { anchor: insertion.cursorAnchor }, 5000)
        : () => pageRequest("focusDocumentEnd", {}, 5000);
      const focusLabel = overlayState.settings.bibliographyInsertMode === "alphabetical"
        ? `focusDocumentAnchor:${bibTarget.target}`
        : `focusDocumentEnd:${bibTarget.target}`;
      await timed(focusLabel, focusAction, diagnostics);
      debugTrace("bib:write-ok", {
        target: bibTarget.target,
        activeAfter: readActiveFileName(),
        finalKey: insertion.finalKey
      });
    }

    const shouldReturnToSource = Boolean(overlayState.settings.returnToSourceAfterInsert);
    const needsManualSourceUpdate = insertion.finalKey !== optimisticKey;
    let sourceReadyForFinalRewrite = !switchedToBib;
    if (switchedToBib && shouldReturnToSource) {
      const returnTargetLabel = originalFileName || "source file";
      diagnostics.step(`Returning to ${returnTargetLabel}...`);
      try {
        if (originalFileName) {
          await timed(`openProjectFile:${originalFileName}`, () => openProjectFile(originalFileName, { preferTabsOnly: true }), diagnostics);
        } else {
          throw new Error("Original source filename was unavailable.");
        }
      } catch {
        try {
          await timed("openSourceTabByContent", () => openSourceTabByContent({
            excludeFileName: bibTarget.target,
            preferredFileName: originalFileName,
            originalText: overlayState.originalEditorState?.text ?? "",
            tokenStart: overlayState.citationContext?.tokenStart ?? 0,
            tokenEnd: overlayState.citationContext?.tokenEnd ?? 0
          }), diagnostics);
        } catch {
          try {
            await timed("openSourceFileByProjectScan", () => openSourceFileByProjectScan({
              excludeFileName: bibTarget.target,
              projectFiles: projectState.projectFiles,
              originalText: overlayState.originalEditorState?.text ?? "",
              tokenStart: overlayState.citationContext?.tokenStart ?? 0,
              tokenEnd: overlayState.citationContext?.tokenEnd ?? 0
            }), diagnostics);
          } catch {
            sourceReadyForFinalRewrite = false;
          }
        }
      }
    }

    if (switchedToBib && shouldReturnToSource) {
      try {
        const activeSourceState = await timed("getEditorState:sourceCheck", () => getEditorStateWithRetry(3, 200), diagnostics);
        const activeSourceName = activeSourceState.fileName || readActiveFileName();
        const looksLikeSourceFile = originalFileName
          ? activeSourceName.includes(originalFileName)
          : Boolean(activeSourceName && activeSourceName !== bibTarget.target && /\.tex$/i.test(activeSourceName));
        if (!looksLikeSourceFile) {
          try {
            await timed("openSourceTabByContent:verify", () => openSourceTabByContent({
              excludeFileName: bibTarget.target,
              preferredFileName: originalFileName,
              originalText: overlayState.originalEditorState?.text ?? "",
              tokenStart: overlayState.citationContext?.tokenStart ?? 0,
              tokenEnd: overlayState.citationContext?.tokenEnd ?? 0
            }), diagnostics);
          } catch {
            await timed("openSourceFileByProjectScan:verify", () => openSourceFileByProjectScan({
              excludeFileName: bibTarget.target,
              projectFiles: projectState.projectFiles,
              originalText: overlayState.originalEditorState?.text ?? "",
              tokenStart: overlayState.citationContext?.tokenStart ?? 0,
              tokenEnd: overlayState.citationContext?.tokenEnd ?? 0
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
      closeOverlay();
      toast(
        `Inserted ${insertion.finalKey} into ${bibTarget.target}. Update the cite key in your source from ${optimisticKey} to ${insertion.finalKey}.`,
        "notice",
        { durationMs: 7500 }
      );
      return;
    }

    if (shouldReturnToSource || (!switchedToBib && needsManualSourceUpdate)) {
      diagnostics.step(`Finalizing cite key in ${originalFileName || "current file"}...`);
      await timed("replaceRange:finalKey", () => pageRequest("replaceRange", {
        from: optimisticRange.from,
        to: optimisticRange.to,
        insert: insertion.finalKey,
        expectedFileName: originalFileName
      }), diagnostics);
    }

    diagnostics.finish(`Finished in ${formatMs(performance.now() - diagnostics.startedAt)}`);
    closeOverlay();
    toast(
      insertion.match
        ? `Reused existing bibliography entry: ${insertion.finalKey}`
        : `Inserted ${insertion.finalKey} into ${bibTarget.target}`
    );
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
      ".active[role='tab']",
      ".file-tab.active",
      ".tab.active",
      ".ol-cm-breadcrumbs",
      ".ol-cm-toolbar-wrapper",
      ".cm-panels-top"
    ];
    for (const selector of selectors) {
      const fileName = extractLikelyEditorFileNameFromElement(document.querySelector(selector));
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
    const { preferTabsOnly = false } = options;
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
    for (const candidate of candidates) {
      try {
        candidate.scrollIntoView?.({ block: "center", inline: "nearest" });
        candidate.click();
        await sleep(250);
        await waitFor(async () => {
          const activeTabName = readActiveFileName();
          if (activeTabName.includes(fileName)) {
            return true;
          }
          const state = await getEditorStateWithRetry(3, 250);
          const activeFileName = state.fileName || activeTabName;
          return activeFileName.includes(fileName);
        }, 3500);
        debugTrace("openProjectFile:ok", {
          fileName,
          activeAfter: readActiveFileName()
        });
        return;
      } catch (error) {
        if (!preferTabsOnly && isLikelyFileTreeCandidate(candidate)) {
          await sleep(450);
          if (await isProjectFileActive(fileName)) {
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
        await sleep(200);
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
  }

  function matchesFileName(activeFileName, targetFileName) {
    const active = String(activeFileName ?? "").trim();
    const target = String(targetFileName ?? "").trim();
    if (!active || !target) {
      return false;
    }
    return active === target || active.includes(target);
  }

  async function ensureProjectFileActive(fileName, diagnostics, reasonLabel) {
    if (await isProjectFileActive(fileName)) {
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
    await waitForProjectFileActive(fileName, 2500);
  }

  async function isProjectFileActive(fileName) {
    const activeNow = readActiveFileName();
    if (matchesFileName(activeNow, fileName)) {
      return true;
    }
    try {
      const state = await getEditorStateWithRetry(1, 0);
      return matchesFileName(state.fileName || activeNow, fileName);
    } catch {
      return false;
    }
  }

  async function waitForProjectFileActive(fileName, timeoutMs = 3500) {
    await waitFor(async () => isProjectFileActive(fileName), timeoutMs);
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

  async function openSourceTabByContent({ excludeFileName = "", preferredFileName = "", originalText = "", tokenStart = 0, tokenEnd = 0 } = {}) {
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
      try {
        candidate.element.scrollIntoView?.({ block: "center", inline: "nearest" });
        candidate.element.click();
        await sleep(250);
        await waitFor(async () => {
          const state = await getEditorStateWithRetry(3, 200);
          const activeName = state.fileName || readActiveFileName();
          if (!activeName || activeName === targetExclude || !/\.tex$/i.test(activeName)) {
            return false;
          }
          return contextMatcher(state.text);
        }, 3500);
        return;
      } catch (error) {
        lastError = error;
        await sleep(200);
      }
    }

    throw lastError ?? new Error("Could not return to the source editor by content match.");
  }

  async function openSourceFileByProjectScan({ excludeFileName = "", projectFiles = [], originalText = "", tokenStart = 0, tokenEnd = 0 } = {}) {
    const targetExclude = String(excludeFileName ?? "").trim();
    const texFiles = Array.from(new Set((projectFiles ?? [])
      .map((fileName) => String(fileName ?? "").trim())
      .filter((fileName) => fileName && fileName !== targetExclude && /\.tex$/i.test(fileName))));
    if (!texFiles.length) {
      throw new Error("Could not find any candidate source .tex files in the project.");
    }

    const contextMatcher = buildSourceTextMatcher(originalText, tokenStart, tokenEnd);
    let lastError = null;
    for (const fileName of texFiles) {
      try {
        await openProjectFile(fileName, { preferTabsOnly: false });
        const state = await getEditorStateWithRetry(3, 200);
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ensureProjectFileActive(fileName, diagnostics, `before-read-${attempt + 1}`);
      const state = await timed("getEditorState:bib", () => getEditorStateWithRetry(), diagnostics);
      if (!isLikelyWrongEditorForBib(state, sourceMatcher)) {
        return state;
      }
      await timed(
        `openProjectFile:${fileName}:reconfirm:${attempt + 1}`,
        () => openProjectFile(fileName, { preferTabsOnly: false }),
        diagnostics
      );
      await sleep(200);
    }
    throw new Error(`Could not confirm that ${fileName} is the active bibliography editor.`);
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
    const response = await withTimeout(
      extensionApi.runtime.sendMessage(message),
      15000,
      "Timed out waiting for the OverCite background worker."
    );
    if (!response?.ok) {
      throw new Error(response?.error ?? "Unknown OverCite error");
    }
    return response.result;
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

  async function getEditorStateWithRetry(attempts = 5, delayMs = 150) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const state = await pageRequest("getActiveEditorState", {}, 4000);
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
      overlay.hidden = true;
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
    const durationMs = Number.isFinite(options?.durationMs) ? Math.max(1800, options.durationMs) : 2600;
    toastNode._timeoutId = window.setTimeout(() => {
      toastNode.classList.remove("visible");
    }, durationMs);
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

  async function waitForManualFileSwitch(fileName, subtitle, shortcutText) {
    debugTrace("manual-switch:prompt", {
      fileName,
      activeNow: readActiveFileName()
    });
    let continueHandler = null;
    const waitForContinue = new Promise((resolve) => {
      continueHandler = async () => {
        toast(`Continuing with the current editor as ${fileName}.`);
        debugTrace("manual-switch:continue", {
          fileName,
          activeNow: readActiveFileName()
        });
        resolve();
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
    applyOverlayTheme(overlayState?.settings?.themeMode ?? "auto");
    await waitForContinue;
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
        applyOverlayTheme(overlayState?.settings?.themeMode ?? "auto");
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function formatAuthors(authors, year) {
    const authorText = Array.isArray(authors) ? authors.slice(0, 3).join("; ") : "";
    const suffix = Array.isArray(authors) && authors.length > 3 ? " et al." : "";
    return [authorText + suffix, year].filter(Boolean).join(" | ");
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
