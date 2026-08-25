import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverBibliographyFiles,
  relativeUriPath,
  uriFileName,
  workspaceKeyFromUri
} from "../src/workspace.js";

test("local workspaces keep using the fast VS Code file search", async () => {
  const root = makeUri("file", "", "/tmp/paper", "/tmp/paper");
  const references = makeUri("file", "", "/tmp/paper/references.bib", "/tmp/paper/references.bib");
  let findCalls = 0;
  const workspace = {
    textDocuments: [],
    findFiles: async () => {
      findCalls += 1;
      return [references];
    },
    fs: {
      readDirectory: async () => assert.fail("local discovery must not walk workspace.fs")
    }
  };

  const files = await discoverBibliographyFiles({
    workspace,
    workspaceFolder: { uri: root },
    createRelativePattern: (_folder, pattern) => pattern,
    joinPath,
    timeoutMs: 100
  });

  assert.equal(findCalls, 1);
  assert.deepEqual(files.map((file) => file.name), ["references.bib"]);
  assert.equal(files[0].uri, references);
});

test("virtual workspaces use readDirectory instead of the unsupported search provider", async () => {
  const root = makeUri("overleaf-workshop", "www.overleaf.com", "/Paper");
  let findCalls = 0;
  const listings = new Map([
    ["/Paper", [["chapters", 2], ["main.tex", 1], ["refs.bib", 1], [".output", 2]]],
    ["/Paper/chapters", [["notes.bib", 1]]]
  ]);
  const workspace = {
    textDocuments: [],
    findFiles: async () => {
      findCalls += 1;
      return new Promise(() => {});
    },
    fs: {
      readDirectory: async (uri) => listings.get(uri.path) ?? []
    }
  };

  const files = await discoverBibliographyFiles({
    workspace,
    workspaceFolder: { uri: root },
    createRelativePattern: () => assert.fail("virtual discovery must not construct a search pattern"),
    joinPath,
    timeoutMs: 100
  });

  assert.equal(findCalls, 0);
  assert.deepEqual(files.map((file) => file.name), ["notes.bib", "refs.bib"]);
});

test("a stalled virtual provider falls back to an already open bibliography", async () => {
  const root = makeUri("overleaf-workshop", "www.overleaf.com", "/Paper");
  const refs = makeUri("overleaf-workshop", "www.overleaf.com", "/Paper/refs.bib");
  const workspace = {
    textDocuments: [{ uri: refs }],
    fs: { readDirectory: async () => new Promise(() => {}) }
  };

  const started = Date.now();
  const files = await discoverBibliographyFiles({
    workspace,
    workspaceFolder: { uri: root },
    createRelativePattern: () => null,
    joinPath,
    timeoutMs: 20
  });

  assert.ok(Date.now() - started < 250, "fallback should be bounded");
  assert.deepEqual(files.map((file) => file.name), ["refs.bib"]);
});

test("a stalled virtual provider produces a bounded actionable error", async () => {
  const root = makeUri("overleaf-workshop", "www.overleaf.com", "/Paper");
  const workspace = {
    textDocuments: [],
    fs: { readDirectory: async () => new Promise(() => {}) }
  };

  await assert.rejects(
    discoverBibliographyFiles({
      workspace,
      workspaceFolder: { uri: root },
      createRelativePattern: () => null,
      joinPath,
      timeoutMs: 20
    }),
    /Timed out while reading the virtual workspace.*open its \.bib file/s
  );
});

test("URI helpers avoid treating virtual paths as local filesystem paths", () => {
  const root = makeUri("overleaf-workshop", "www.overleaf.com", "/Paper");
  const refs = makeUri("overleaf-workshop", "www.overleaf.com", "/Paper/bib/refs.bib");
  assert.equal(uriFileName(refs), "refs.bib");
  assert.equal(relativeUriPath(root, refs), "bib/refs.bib");
  assert.equal(workspaceKeyFromUri(root), "overleaf-workshop://www.overleaf.com/Paper");

  const local = makeUri("file", "", "/tmp/paper", "/tmp/paper");
  assert.equal(workspaceKeyFromUri(local), "/tmp/paper");
});

function makeUri(scheme, authority, path, fsPath = path) {
  return {
    scheme,
    authority,
    path,
    fsPath,
    toString() {
      return `${scheme}://${authority}${path}`;
    }
  };
}

function joinPath(uri, ...pieces) {
  const suffix = pieces.map((piece) => String(piece).replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  const path = `${uri.path.replace(/\/$/, "")}/${suffix}`;
  return makeUri(uri.scheme, uri.authority, path, uri.scheme === "file" ? path : path);
}
