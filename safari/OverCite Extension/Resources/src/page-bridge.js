(function pageBridgeBootstrap() {
  const RESPONSE_EVENT = "EZCITE_PAGE_RESPONSE";
  const REQUEST_EVENT = "EZCITE_PAGE_REQUEST";
  const editorIdentityByView = new WeakMap();
  let nextEditorIdentity = 1;
  let codeMirrorApi = null;
  window.__OVERCITE_PAGE_BRIDGE_READY__ = true;

  window.addEventListener("UNSTABLE_editor:extensions", (event) => {
    codeMirrorApi = event.detail?.CodeMirror ?? null;
  });

  window.addEventListener(REQUEST_EVENT, (event) => {
    const { requestId, action, payload } = event.detail || {};
    Promise.resolve()
      .then(() => handleAction(action, payload))
      .then((result) => emitResponse(requestId, { ok: true, result }, action))
      .catch((error) => emitResponse(requestId, { ok: false, error: error.message }, action));
  });

  function emitResponse(requestId, response, action = "") {
    void action;
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: { requestId, ...response }
      })
    );
  }

  function findActiveEditorContext() {
    const EditorView = codeMirrorApi?.EditorView ?? globalThis.CodeMirror?.EditorView;
    const visibleEditorElements = [...new Set(
      Array.from(document.querySelectorAll(".cm-editor")).filter(isVisibleEditorElement)
    )];
    const soleVisibleEditor = visibleEditorElements.length === 1 ? visibleEditorElements[0] : null;
    const selectedFileName = soleVisibleEditor ? readActiveFileName() : "";
    const candidates = [
      ...findEditorsControlledByActiveFileTabs(),
      ...Array.from(document.querySelectorAll('[role="tabpanel"]:not([hidden]) .cm-editor')).map((element) => ({
        element,
        fileName: readFileNameForEditorElement(element)
      })),
      document.activeElement?.closest?.(".cm-editor")
        ? { element: document.activeElement.closest(".cm-editor"), fileName: readFileNameForEditorElement(document.activeElement.closest(".cm-editor")) }
        : null,
      document.querySelector(".cm-editor.cm-focused")
        ? { element: document.querySelector(".cm-editor.cm-focused"), fileName: readFileNameForEditorElement(document.querySelector(".cm-editor.cm-focused")) }
        : null,
      ...Array.from(document.querySelectorAll(".cm-editor")).map((element) => ({
        element,
        fileName: readFileNameForEditorElement(element)
      }))
    ].filter(Boolean).filter((candidate) => isVisibleEditorElement(candidate.element));
    const seen = new Set();

    for (const candidate of candidates) {
      if (seen.has(candidate.element)) {
        continue;
      }
      seen.add(candidate.element);
      const unambiguousSelectedFileName = candidate.element === soleVisibleEditor ? selectedFileName : "";
      const fallbackView = readEditorViewFromDom(candidate.element);
      if (fallbackView) {
        const fallbackFileName = candidate.fileName || unambiguousSelectedFileName;
        return {
          view: fallbackView,
          element: candidate.element,
          fileName: fallbackFileName,
          fileNameSource: candidate.fileName ? "mapped" : (fallbackFileName ? "active-tab" : "")
        };
      }
      try {
        const view = EditorView?.findFromDOM?.(candidate.element);
        if (view) {
          const fallbackFileName = candidate.fileName || unambiguousSelectedFileName;
          return {
            view,
            element: candidate.element,
            fileName: fallbackFileName,
            fileNameSource: candidate.fileName ? "mapped" : (fallbackFileName ? "active-tab" : "")
          };
        }
      } catch {
        continue;
      }
    }
    if (!EditorView?.findFromDOM) {
      console.warn("[OverCite page] missing CodeMirror EditorView");
    }
    console.warn("[OverCite page] no active .cm-editor view found");
    return null;
  }

  function findActiveEditorView() {
    return findActiveEditorContext()?.view ?? null;
  }

  function findEditorsControlledByActiveFileTabs() {
    const editors = [];
    for (const tab of findActiveFileTabElements()) {
      const controlledId = tab.getAttribute("aria-controls");
      if (!controlledId) {
        continue;
      }
      const panel = document.getElementById(controlledId);
      if (!panel) {
        continue;
      }
      const fileName = extractLikelyEditorFileNameFromElement(tab);
      if (panel.matches?.(".cm-editor")) {
        editors.push({ element: panel, fileName });
      }
      editors.push(...Array.from(panel.querySelectorAll(".cm-editor")).map((element) => ({ element, fileName })));
    }
    return editors;
  }

  function readFileNameForEditorElement(editorElement) {
    if (!(editorElement instanceof Element)) {
      return "";
    }
    for (const tab of document.querySelectorAll('[role="tab"][aria-controls]')) {
      const controlledId = tab.getAttribute("aria-controls");
      const panel = controlledId ? document.getElementById(controlledId) : null;
      if (!panel) {
        continue;
      }
      if (panel === editorElement || panel.contains?.(editorElement)) {
        return extractLikelyEditorFileNameFromElement(tab);
      }
    }
    return "";
  }

  function readEditorViewFromDom(element) {
    const cmView = element?.cmView;
    const view = cmView?.rootView?.view ?? cmView?.view ?? null;
    if (view?.state?.doc && typeof view.dispatch === "function") {
      return view;
    }
    return null;
  }

  function isVisibleEditorElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (typeof element.checkVisibility === "function") {
      try {
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
          return false;
        }
      } catch {
        // Older browsers do not accept checkVisibility options.
      }
    }
    for (let current = element; current instanceof Element; current = current.parentElement) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true" || current.hasAttribute("inert")) {
        return false;
      }
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function readActiveFileName() {
    const selectors = [
      '[role="tab"][aria-selected="true"]',
      '[role="tab"][data-active="true"]',
      '[data-testid="editor-tab-active"]',
      '.active[role="tab"]',
      '.active .tab-label',
      '.file-tab.active',
      '.cm-file-tab.active'
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const fileName = extractLikelyEditorFileNameFromElement(element);
        if (fileName) {
          return fileName;
        }
      }
    }
    for (const element of document.querySelectorAll('.ol-cm-breadcrumbs')) {
      const fileName = extractLikelyEditorFileNameFromElement(element);
      if (fileName) {
        return fileName;
      }
    }
    return "";
  }

  function findActiveFileTabElements() {
    const selectors = [
      '[role="tab"][aria-selected="true"]',
      '[role="tab"][data-active="true"]',
      '[data-testid="editor-tab-active"]',
      '.active[role="tab"]',
      '.file-tab.active',
      '.cm-file-tab.active'
    ];
    const tabs = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element) || !extractLikelyEditorFileNameFromElement(element)) {
          continue;
        }
        seen.add(element);
        tabs.push(element);
      }
    }
    return tabs;
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

  function handleAction(action, payload) {
    switch (action) {
      case "getActiveEditorState":
        return getActiveEditorState();
      case "replaceRange":
        return replaceRange(payload);
      case "replaceDocument":
        return replaceDocument(payload);
      case "focusDocumentEnd":
        return focusDocumentEnd();
      case "focusDocumentAnchor":
        return focusDocumentAnchor(payload);
      default:
        throw new Error(`Unknown page bridge action: ${action}`);
    }
  }

  function extractLikelyEditorFileName(text) {
    const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    const match = normalized.match(/([A-Za-z0-9_.\-\/ ]+\.(?:tex|bib|sty|cls|bst|bbx|cbx|txt|md|csv|json|yaml|yml|py|js|ts|r|m))(?!.*\.(?:tex|bib|sty|cls|bst|bbx|cbx|txt|md|csv|json|yaml|yml|py|js|ts|r|m))/i);
    return match ? match[1].trim() : "";
  }

  function getActiveEditorState() {
    const context = findActiveEditorContext();
    if (!context?.view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    const view = context.view;
    const mainSelection = view.state.selection.main;
    return {
      text: view.state.doc.toString(),
      from: mainSelection.from,
      to: mainSelection.to,
      fileName: context.fileName || "",
      fileNameSource: context.fileNameSource || "",
      editorIdentity: getEditorIdentity(view)
    };
  }

  function getEditorIdentity(view) {
    if (!editorIdentityByView.has(view)) {
      editorIdentityByView.set(view, `editor-${nextEditorIdentity}`);
      nextEditorIdentity += 1;
    }
    return editorIdentityByView.get(view);
  }

  function assertExpectedEditorIdentity(view, expectedEditorIdentity) {
    const expected = String(expectedEditorIdentity ?? "").trim();
    if (expected && getEditorIdentity(view) !== expected) {
      throw new Error("The active editor changed after manual confirmation.");
    }
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

  function assertExpectedActiveFile(expectedFileName, activeFileName, allowUnknown = false) {
    const target = String(expectedFileName ?? "").trim();
    if (!target) {
      return;
    }
    if (!activeFileName && allowUnknown) {
      return;
    }
    if (!matchesFileName(activeFileName, target)) {
      throw new Error(`Active editor is ${activeFileName || "unknown"} instead of ${target}.`);
    }
  }

  function assertExpectedDocument(view, expectedDocument) {
    if (!expectedDocument || typeof expectedDocument !== "object") {
      return;
    }
    const currentText = view.state.doc.toString();
    const expectedLength = Number(expectedDocument.length);
    const expectedHead = String(expectedDocument.head ?? "");
    const expectedTail = String(expectedDocument.tail ?? "");
    if (Number.isFinite(expectedLength) && currentText.length !== expectedLength) {
      throw new Error("Active editor contents changed before write.");
    }
    if (expectedHead && !currentText.startsWith(expectedHead)) {
      throw new Error("Active editor contents no longer match the expected document head.");
    }
    if (expectedTail && !currentText.endsWith(expectedTail)) {
      throw new Error("Active editor contents no longer match the expected document tail.");
    }
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

  function looksLikeBibDocument(text) {
    const sample = String(text ?? "").slice(0, 4000);
    if (!sample.trim()) {
      return true;
    }
    return /@\w+\s*\{/.test(sample) || /^\s*%(?!\s*#)/m.test(sample);
  }

  function assertExpectedDocumentKind(view, expectedFileName) {
    const target = String(expectedFileName ?? "").trim();
    if (!target) {
      return;
    }
    const currentText = view.state.doc.toString();
    if (/\.bib$/i.test(target) && looksLikeTexSourceDocument(currentText)) {
      throw new Error("Refusing to write bibliography text into a TeX source editor.");
    }
    if (/\.tex$/i.test(target) && looksLikeBibDocument(currentText) && !looksLikeTexSourceDocument(currentText)) {
      throw new Error("Refusing to write cite-key text into a bibliography editor.");
    }
  }

  function replaceRange(payload) {
    const context = findActiveEditorContext();
    if (!context?.view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    const view = context.view;
    assertExpectedEditorIdentity(view, payload?.expectedEditorIdentity);
    if (!context.fileName) {
      assertExpectedDocumentKind(view, payload?.expectedFileName);
    }
    assertExpectedDocument(view, payload?.expectedDocument);
    assertExpectedActiveFile(payload?.expectedFileName, context.fileName, Boolean(payload?.expectedDocument));
    const { from, to, insert, selection } = payload || {};
    view.dispatch({
      changes: { from, to, insert },
      selection: selection ?? { anchor: from + String(insert ?? "").length }
    });
    view.focus();
    return true;
  }

  function replaceDocument(payload) {
    const context = findActiveEditorContext();
    if (!context?.view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    const view = context.view;
    assertExpectedEditorIdentity(view, payload?.expectedEditorIdentity);
    if (!context.fileName) {
      assertExpectedDocumentKind(view, payload?.expectedFileName);
    }
    assertExpectedDocument(view, payload?.expectedDocument);
    assertExpectedActiveFile(payload?.expectedFileName, context.fileName, Boolean(payload?.expectedDocument));
    const nextText = String(payload?.text ?? "");
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: nextText
      },
      selection: { anchor: nextText.length },
      scrollIntoView: true
    });
    view.dispatch({
      selection: { anchor: nextText.length },
      scrollIntoView: true
    });
    view.focus();
    return true;
  }

  function focusDocumentEnd() {
    const view = findActiveEditorView();
    if (!view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    const end = view.state.doc.length;
    view.dispatch({
      selection: { anchor: end },
      scrollIntoView: true
    });
    view.focus();
    return true;
  }

  function focusDocumentAnchor(payload) {
    const view = findActiveEditorView();
    if (!view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    const requestedAnchor = Number(payload?.anchor);
    const anchor = Number.isFinite(requestedAnchor)
      ? Math.max(0, Math.min(view.state.doc.length, requestedAnchor))
      : view.state.doc.length;
    view.dispatch({
      selection: { anchor },
      scrollIntoView: true
    });
    view.focus();
    return true;
  }

  if (globalThis.__OVERCITE_PAGE_BRIDGE_TEST__) {
    globalThis.__OVERCITE_PAGE_BRIDGE_TEST_HOOKS__ = {
      findActiveEditorView,
      findActiveEditorContext,
      handleAction,
      matchesFileName,
      readActiveFileName
    };
  }
})();
