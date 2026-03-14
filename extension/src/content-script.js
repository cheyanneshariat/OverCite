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

  const REQUEST_EVENT = "EZCITE_PAGE_REQUEST";
  const RESPONSE_EVENT = "EZCITE_PAGE_RESPONSE";
  let overlay = null;
  let overlayState = null;
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
        padding: 15px 16px 11px;
        border-bottom: 1px solid var(--ez-panel-border);
        background: linear-gradient(180deg, var(--ez-soft-panel), transparent);
      }

      .ezcite-kicker {
        margin: 0 0 8px;
        font-size: 1.45rem;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: var(--ez-muted);
      }

      .ezcite-title {
        margin: 0;
        font-size: 1.08rem;
        font-weight: 800;
        letter-spacing: 0.01em;
      }

      .ezcite-subtitle {
        margin: 7px 0 0;
        color: var(--ez-meta);
        font-size: 0.86rem;
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
        border-radius: 999px;
        background: rgba(24, 33, 42, 0.92);
        color: white;
        font: 600 0.86rem/1.3 "Avenir Next", "Gill Sans", "Trebuchet MS", sans-serif;
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
          <h2 class="ezcite-title">NASA ADS Lookup</h2>
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
      button.addEventListener("click", () => selectCandidate(candidate));
      body.appendChild(button);
    }

    footer.innerHTML = `<span>Pick a paper to rewrite the cite key and update your bibliography.</span><span><strong>Trigger:</strong> ${escapeHtml(shortcutText)}</span>`;
  }

  async function startLookup(searchMode) {
    const settings = await callRuntime({ type: MESSAGE_TYPES.GET_SETTINGS });
    const resolvedSearchMode = normalizeSearchMode(searchMode, settings.defaultSearchMode);
    const editorState = await getEditorStateWithRetry();
    const citationContext = findCitationAtCursor(editorState.text, editorState.from, settings.contextWindowChars);
    if (!citationContext) {
      throw new Error("Place the cursor inside a \\cite{...} command before triggering OverCite.");
    }

    overlayState = {
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

    renderOverlay({
      subtitle: `${citationContext.command}{${citationContext.token || "..."}}`,
      status: resolvedSearchMode === "simple" ? "Running simple ADS search..." : "Searching NASA ADS...",
      shortcutText: settings.shortcutHelpText,
      actions: buildSearchModeActions(citationContext, resolvedSearchMode)
    });
    applyOverlayTheme(settings.themeMode ?? "auto");

    const results = await callRuntime({
      type: MESSAGE_TYPES.SEARCH_ADS,
      citationContext: { ...citationContext, searchMode: resolvedSearchMode }
    });

    overlayState.results = results;
    if (!results.length) {
      renderOverlay({
        subtitle: `${citationContext.command}{${citationContext.token || "..."}}`,
        status: resolvedSearchMode === "simple"
          ? "No ADS records matched the simple token-only search."
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
      if (normalized === "contextual" || normalized === "simple") {
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
        }
      ];
    }
    return [
      {
        label: "Simple search",
        kind: "tertiary",
        onClick: () => startLookup("simple").catch((error) => toast(error.message, "error"))
      }
    ];
  }

  async function selectCandidate(candidate) {
    if (!overlayState) {
      return;
    }
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

    const originalFileName = overlayState.originalFileName || readActiveFileName();
    const originalRange = {
      from: overlayState.citationContext.tokenStart,
      to: overlayState.citationContext.tokenEnd
    };
    const optimisticKey = candidate.generatedKey || overlayState.citationContext.token || "citation";
    diagnostics.step(`Writing cite key in ${originalFileName || "current file"}...`);
    await timed("replaceRange:optimisticKey", () => pageRequest("replaceRange", {
      from: originalRange.from,
      to: originalRange.to,
      insert: optimisticKey
    }), diagnostics);
    const optimisticRange = {
      from: originalRange.from,
      to: originalRange.from + optimisticKey.length
    };

    const switchedToBib = originalFileName !== bibTarget.target;
    if (switchedToBib) {
      diagnostics.step(`Opening ${bibTarget.target}...`);
      try {
        await timed(`openProjectFile:${bibTarget.target}`, () => openProjectFile(bibTarget.target, { preferTabsOnly: false }), diagnostics);
      } catch {
        await waitForManualFileSwitch(bibTarget.target, candidate.title, overlayState.settings.shortcutHelpText);
      }
    }

    diagnostics.step(`Reading ${bibTarget.target}...`);
    const bibEditorState = switchedToBib
      ? await timed("getEditorState:bib", () => getEditorStateWithRetry(), diagnostics)
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
      await timed(`replaceDocument:${bibTarget.target}`, () => pageRequest("replaceDocument", { text: insertion.updatedBibText }, 12000), diagnostics);
      const focusAction = overlayState.settings.bibliographyInsertMode === "alphabetical"
        ? () => pageRequest("focusDocumentAnchor", { anchor: insertion.cursorAnchor }, 5000)
        : () => pageRequest("focusDocumentEnd", {}, 5000);
      const focusLabel = overlayState.settings.bibliographyInsertMode === "alphabetical"
        ? `focusDocumentAnchor:${bibTarget.target}`
        : `focusDocumentEnd:${bibTarget.target}`;
      await timed(focusLabel, focusAction, diagnostics);
    }

    const shouldReturnToSource = Boolean(overlayState.settings.returnToSourceAfterInsert) || insertion.finalKey !== optimisticKey;
    if (switchedToBib && shouldReturnToSource) {
      diagnostics.step(`Returning to ${originalFileName}...`);
      try {
        await timed(`openProjectFile:${originalFileName}`, () => openProjectFile(originalFileName, { preferTabsOnly: true }), diagnostics);
      } catch {
        await waitForManualFileSwitch(originalFileName, candidate.title, overlayState.settings.shortcutHelpText);
      }
    }

    if (shouldReturnToSource || insertion.finalKey !== optimisticKey) {
      diagnostics.step(`Finalizing cite key in ${originalFileName || "current file"}...`);
      await timed("replaceRange:finalKey", () => pageRequest("replaceRange", {
        from: optimisticRange.from,
        to: optimisticRange.to,
        insert: insertion.finalKey
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
      ".tab.active"
    ];
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  async function openProjectFile(fileName, options = {}) {
    const { preferTabsOnly = false } = options;
    const candidates = findOpenableElementsByText(fileName, preferTabsOnly);
    if (!candidates.length) {
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
        return;
      } catch (error) {
        if (!preferTabsOnly && isLikelyFileTreeCandidate(candidate)) {
          await sleep(450);
          return;
        }
        lastError = error;
        await sleep(200);
      }
    }
    if (lastError) {
      throw lastError;
    }
  }

  function findOpenableElementsByText(targetText, preferTabsOnly = false) {
    const normalizedTarget = String(targetText ?? "").trim();
    const tabSelectors = [
      "[role='tab']",
      "[data-testid*='tab']",
      ".file-tab",
      ".tab"
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
        if (!text || text !== targetText) {
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
        const candidate = element.closest("[role='treeitem'], [role='button'], button, a, div, span") || element;
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

  function pageRequest(action, payload = {}, timeoutMs = 5000) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener(RESPONSE_EVENT, listener);
        const bridgeReady = Boolean(window.__OVERCITE_PAGE_BRIDGE_READY__);
        console.error("[OverCite content] page action timeout", {
          action,
          requestId,
          bridgeReady
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
          resolve(event.detail.result);
        } else {
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
        return await pageRequest("getActiveEditorState", {}, 4000);
      } catch (error) {
        lastError = error;
        await sleep(delayMs);
      }
    }
    throw lastError ?? new Error("Could not read the active Overleaf editor state.");
  }

  function closeOverlay() {
    if (overlay) {
      overlay.hidden = true;
    }
    overlayState = null;
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

  function toast(message, kind = "info") {
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
    } else {
      toastNode.style.background = "rgba(24, 33, 42, 0.92)";
    }
    window.clearTimeout(toastNode._timeoutId);
    toastNode._timeoutId = window.setTimeout(() => {
      toastNode.classList.remove("visible");
    }, 2600);
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
    let continueHandler = null;
    const waitForContinue = new Promise((resolve) => {
      continueHandler = async () => {
        toast(`Continuing with the current editor as ${fileName}.`);
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
    const authorText = Array.isArray(authors) ? authors.slice(0, 3).join(", ") : "";
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
