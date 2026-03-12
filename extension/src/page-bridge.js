(function pageBridgeBootstrap() {
  const RESPONSE_EVENT = "EZCITE_PAGE_RESPONSE";
  const REQUEST_EVENT = "EZCITE_PAGE_REQUEST";
  let codeMirrorApi = null;
  window.__OVERCITE_PAGE_BRIDGE_READY__ = true;
  console.log("[OverCite page] page bridge boot");

  window.addEventListener("UNSTABLE_editor:extensions", (event) => {
    codeMirrorApi = event.detail?.CodeMirror ?? null;
    console.log("[OverCite page] UNSTABLE_editor:extensions", {
      hasCodeMirror: Boolean(codeMirrorApi),
      hasEditorView: Boolean(codeMirrorApi?.EditorView)
    });
  });

  window.addEventListener(REQUEST_EVENT, (event) => {
    const { requestId, action, payload } = event.detail || {};
    console.log("[OverCite page] request", {
      requestId,
      action,
      hasCodeMirror: Boolean(codeMirrorApi),
      activeElementClass: document.activeElement?.className ?? null
    });
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
      document.querySelector(".cm-editor")
    ].filter(Boolean);

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
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) {
        return text;
      }
    }
    return "";
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
      default:
        throw new Error(`Unknown page bridge action: ${action}`);
    }
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

  function replaceRange(payload) {
    const view = findActiveEditorView();
    if (!view) {
      throw new Error("Could not find the active Overleaf source editor.");
    }
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
})();
