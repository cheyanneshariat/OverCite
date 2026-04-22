(function pageBridgeBootstrap() {
  const RESPONSE_EVENT = "EZCITE_PAGE_RESPONSE";
  const REQUEST_EVENT = "EZCITE_PAGE_REQUEST";
  let codeMirrorApi = null;
  window.__OVERCITE_PAGE_BRIDGE_READY__ = true;

  window.addEventListener("UNSTABLE_editor:extensions", (event) => {
    codeMirrorApi = event.detail?.CodeMirror ?? null;
  });

  window.addEventListener(REQUEST_EVENT, (event) => {
    const { requestId, action, payload } = event.detail || {};
    Promise.resolve()
      .then(() => handleAction(action, payload))
      .then((result) => emitResponse(requestId, { ok: true, result }))
      .catch((error) => emitResponse(requestId, { ok: false, error: error.message }));
  });

  function emitResponse(requestId, response) {
    window.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: { requestId, ...response }
      })
    );
  }

  function findActiveEditorView() {
    const EditorView = codeMirrorApi?.EditorView;
    if (!EditorView?.findFromDOM) {
      console.warn("[OverCite page] missing CodeMirror EditorView");
      return null;
    }
    const candidates = [
      document.activeElement?.closest?.(".cm-editor"),
      document.querySelector(".cm-editor.cm-focused"),
      ...document.querySelectorAll(".cm-editor")
    ].filter(Boolean).filter(isVisibleEditorElement);

    for (const candidate of candidates) {
      try {
        const view = EditorView.findFromDOM(candidate);
        if (view) {
          return view;
        }
      } catch {
        continue;
      }
    }
    console.warn("[OverCite page] no active .cm-editor view found");
    return null;
  }

  function isVisibleEditorElement(element) {
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

  function readActiveFileName() {
    const selectors = [
      '[role="tab"][aria-selected="true"]',
      '[role="tab"][data-active="true"]',
      '[data-testid="editor-tab-active"]',
      '.active[role="tab"]',
      '.active .tab-label',
      '.file-tab.active',
      '.cm-file-tab.active',
      '.ol-cm-breadcrumbs',
      '.ol-cm-toolbar-wrapper',
      '.cm-panels-top'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
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
    const view = findActiveEditorView();
    if (!view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    const mainSelection = view.state.selection.main;
    return {
      text: view.state.doc.toString(),
      from: mainSelection.from,
      to: mainSelection.to,
      fileName: readActiveFileName()
    };
  }

  function matchesFileName(activeFileName, targetFileName) {
    const active = String(activeFileName ?? "").trim();
    const target = String(targetFileName ?? "").trim();
    if (!active || !target) {
      return false;
    }
    return active === target || active.includes(target);
  }

  function assertExpectedActiveFile(expectedFileName) {
    const target = String(expectedFileName ?? "").trim();
    if (!target) {
      return;
    }
    const activeFileName = readActiveFileName();
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
    const view = findActiveEditorView();
    if (!view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    assertExpectedActiveFile(payload?.expectedFileName);
    assertExpectedDocumentKind(view, payload?.expectedFileName);
    assertExpectedDocument(view, payload?.expectedDocument);
    const { from, to, insert, selection } = payload || {};
    view.dispatch({
      changes: { from, to, insert },
      selection: selection ?? { anchor: from + String(insert ?? "").length }
    });
    view.focus();
    return true;
  }

  function replaceDocument(payload) {
    const view = findActiveEditorView();
    if (!view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
    assertExpectedActiveFile(payload?.expectedFileName);
    assertExpectedDocumentKind(view, payload?.expectedFileName);
    assertExpectedDocument(view, payload?.expectedDocument);
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
})();
