import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const pageBridgeUrl = new URL("../src/page-bridge.js", import.meta.url);

class FakeElement {
  constructor({ text = "", attributes = {}, children = [], view = null, parent = null } = {}) {
    this.textContent = text;
    this.attributes = new Map(Object.entries(attributes));
    this.children = children;
    this.parentElement = parent;
    this.hidden = false;
    this.cmView = view ? { rootView: { view } } : null;
    this.rect = { width: 600, height: 400 };
    this.style = { display: "block", visibility: "visible", opacity: "1" };
    for (const child of children) {
      child.parentElement = this;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  querySelectorAll(selector) {
    if (selector === "*") {
      return this.children;
    }
    if (selector === ".cm-editor") {
      return this.children.filter((child) => child.attributes.get("class") === "cm-editor");
    }
    return [];
  }

  matches(selector) {
    return selector === ".cm-editor" && this.attributes.get("class") === "cm-editor";
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

async function loadBridgeHarness({ selectorMap = new Map(), elementsById = new Map(), activeElement = null } = {}) {
  const source = await readFile(pageBridgeUrl, "utf8");
  const document = {
    activeElement,
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return selectorMap.get(selector) ?? [];
    },
    getElementById(id) {
      return elementsById.get(id) ?? null;
    }
  };
  const window = {
    addEventListener() {},
    dispatchEvent() {},
    getComputedStyle(element) {
      return element.style;
    }
  };
  const context = vm.createContext({
    console,
    CustomEvent: class CustomEvent {},
    document,
    Element: FakeElement,
    globalThis: null,
    Promise,
    Set,
    window,
    __OVERCITE_PAGE_BRIDGE_TEST__: true
  });
  context.globalThis = context;
  vm.runInContext(source, context);
  return context.__OVERCITE_PAGE_BRIDGE_TEST_HOOKS__;
}

test("page bridge skips selected non-file tabs and finds the active editor-file tab", async () => {
  const sidebarTab = new FakeElement({ text: "File tree", attributes: { role: "tab", "aria-selected": "true" } });
  const mainTab = new FakeElement({ text: "main.tex Close", attributes: { role: "tab", "aria-selected": "true" } });
  const staleBreadcrumb = new FakeElement({ text: "old_text.tex" });
  const selectorMap = new Map([
    ['[role="tab"][aria-selected="true"]', [sidebarTab, mainTab]],
    [".ol-cm-breadcrumbs", [staleBreadcrumb]]
  ]);
  const hooks = await loadBridgeHarness({ selectorMap });

  assert.equal(hooks.readActiveFileName(), "main.tex");
});

test("page bridge prefers the editor controlled by the active file tab over a stale focused editor", async () => {
  const mainView = { state: { doc: {}, selection: { main: { from: 0, to: 0 } } }, dispatch() {} };
  const staleView = { state: { doc: {}, selection: { main: { from: 0, to: 0 } } }, dispatch() {} };
  const mainEditor = new FakeElement({ attributes: { class: "cm-editor" }, view: mainView });
  const staleEditor = new FakeElement({ attributes: { class: "cm-editor" }, view: staleView });
  const mainPanel = new FakeElement({ children: [mainEditor] });
  const mainTab = new FakeElement({
    text: "main.tex Close",
    attributes: { role: "tab", "aria-selected": "true", "aria-controls": "main-panel" }
  });
  const selectorMap = new Map([
    ['[role="tab"][aria-selected="true"]', [mainTab]],
    ['[role="tabpanel"]:not([hidden]) .cm-editor', []],
    [".cm-editor.cm-focused", [staleEditor]],
    [".cm-editor", [staleEditor, mainEditor]]
  ]);
  const hooks = await loadBridgeHarness({
    selectorMap,
    elementsById: new Map([["main-panel", mainPanel]])
  });

  assert.equal(hooks.findActiveEditorView(), mainView);
});

test("page bridge filename matching is exact apart from project-path prefixes", async () => {
  const hooks = await loadBridgeHarness();

  assert.equal(hooks.matchesFileName("main.tex", "main.tex"), true);
  assert.equal(hooks.matchesFileName("sections/main.tex", "main.tex"), true);
  assert.equal(hooks.matchesFileName("old_main.tex", "main.tex"), false);
  assert.equal(hooks.matchesFileName("old_text.tex", "text.tex"), false);
});
