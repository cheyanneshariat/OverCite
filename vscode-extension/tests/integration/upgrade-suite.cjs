const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const workspaceDir = process.env.OVERCITE_UPGRADE_WORKSPACE;
  const resultPath = process.env.OVERCITE_UPGRADE_RESULT;
  assert.ok(workspaceDir, "Missing OVERCITE_UPGRADE_WORKSPACE");
  assert.ok(resultPath, "Missing OVERCITE_UPGRADE_RESULT");

  // These values model a pre-beta user configuration. The token is a marker
  // consumed only by the local mock server; no user credential is loaded.
  const config = vscode.workspace.getConfiguration("overcite");
  await config.update("adsApiToken", "upgrade-test-ads-token", vscode.ConfigurationTarget.Workspace);
  await config.update("sourceProfile", "astrophysics", vscode.ConfigurationTarget.Workspace);
  await config.update("bibliographyInsertMode", "append", vscode.ConfigurationTarget.Workspace);
  await config.update("defaultSearchMode", "simple", vscode.ConfigurationTarget.Workspace);
  await config.update("citationKeyMode", "informative", vscode.ConfigurationTarget.Workspace);
  await config.update("contextualSearchEngine", "classic", vscode.ConfigurationTarget.Workspace);

  const provider = new MemoryFileSystemProvider();
  const registration = vscode.workspace.registerFileSystemProvider("overleaf-workshop", provider, {
    isCaseSensitive: true
  });
  const rootUri = vscode.Uri.parse(
    "overleaf-workshop://www.overleaf.com/Remote_Paper?user=upgrade-user&project=upgrade-project"
  );
  const mainUri = vscode.Uri.joinPath(rootUri, "main.tex");
  const referencesUri = vscode.Uri.joinPath(rootUri, "references.bib");
  provider.seed(
    mainUri,
    "\\documentclass{article}\n\\begin{document}\nResolved Gaia triples are discussed in context \\citep{Shariat25}.\n\\bibliography{references}\n\\end{document}\n"
  );
  provider.seed(
    referencesUri,
    "@ARTICLE{Existing24_demo,\n  author = {{Someone}, Demo},\n  title = {An Existing Demo Entry},\n  year = {2024}\n}\n"
  );

  try {
    const insertIndex = vscode.workspace.workspaceFolders?.length ?? 0;
    assert.ok(vscode.workspace.updateWorkspaceFolders(insertIndex, 0, {
      uri: rootUri,
      name: "Overleaf Workshop upgrade fixture"
    }), "Failed to add the Overleaf Workshop virtual workspace");
    await waitForCondition(
      () => Boolean(vscode.workspace.getWorkspaceFolder(mainUri)),
      "Overleaf Workshop virtual workspace registration"
    );

    const document = await vscode.workspace.openTextDocument(mainUri);
    const editor = await vscode.window.showTextDocument(document);
    const tokenIndex = document.getText().indexOf("Shariat25");
    assert.ok(tokenIndex >= 0, "Did not find the old citation token in virtual main.tex");
    const target = document.positionAt(tokenIndex + 3);
    editor.selection = new vscode.Selection(target, target);

    await withTimeout(
      vscode.commands.executeCommand("overcite.resolveCitation"),
      15000,
      "OverCite timed out in the Overleaf Workshop virtual workspace"
    );

    assert.match(document.getText(), /\\citep\{Shariat25_10k\}/);
    const references = await vscode.workspace.openTextDocument(referencesUri);
    assert.match(references.getText(), /Shariat25_10k/);
    assert.match(provider.readText(referencesUri), /10,000 Resolved Triples from Gaia/);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), mainUri.toString());
    assertCollapsedSelectionAtText(vscode.window.activeTextEditor, "Shariat25_10k");

    await fs.mkdir(path.dirname(resultPath), { recursive: true });
    await fs.writeFile(resultPath, JSON.stringify({
      ok: true,
      scenario: "mock Overleaf Workshop virtual provider",
      providerScheme: "overleaf-workshop",
      priorPreferencesPreserved: {
        bibliographyInsertMode: "append",
        defaultSearchMode: "simple",
        citationKeyMode: "informative",
        contextualSearchEngine: "classic"
      },
      tokenSource: "synthetic local marker"
    }, null, 2));
  } finally {
    const folderIndex = vscode.workspace.workspaceFolders?.findIndex(
      (folder) => folder.uri.toString() === rootUri.toString()
    ) ?? -1;
    if (folderIndex >= 0) {
      vscode.workspace.updateWorkspaceFolders(folderIndex, 1);
    }
    registration.dispose();
  }
}

module.exports = { run };

function assertCollapsedSelectionAtText(editor, textPrefix) {
  assert.ok(editor?.selection?.isEmpty, "Expected cursor selection to be collapsed");
  const documentText = editor.document.getText();
  const expectedStart = documentText.indexOf(textPrefix);
  assert.ok(expectedStart >= 0, `Did not find ${textPrefix} in active editor`);
  assert.equal(editor.document.offsetAt(editor.selection.active), expectedStart + textPrefix.length);
}

async function waitForCondition(check, label, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

class MemoryFileSystemProvider {
  constructor() {
    this.files = new Map();
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeFile = this.changeEmitter.event;
  }

  seed(uri, text) {
    this.files.set(uri.path, Buffer.from(text, "utf8"));
  }

  readText(uri) {
    return this.files.get(uri.path)?.toString("utf8") ?? "";
  }

  watch() { return new vscode.Disposable(() => {}); }

  stat(uri) {
    if (this.files.has(uri.path)) {
      return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: this.files.get(uri.path).length };
    }
    if (this.isDirectory(uri.path)) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: Date.now(), size: 0 };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  readDirectory(uri) {
    const prefix = `${uri.path.replace(/\/$/, "")}/`;
    const entries = new Map();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const remainder = filePath.slice(prefix.length);
      const [name, ...tail] = remainder.split("/");
      entries.set(name, tail.length ? vscode.FileType.Directory : vscode.FileType.File);
    }
    return [...entries.entries()];
  }

  readFile(uri) {
    const content = this.files.get(uri.path);
    if (!content) throw vscode.FileSystemError.FileNotFound(uri);
    return content;
  }

  writeFile(uri, content) {
    this.files.set(uri.path, Buffer.from(content));
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  createDirectory() {}

  delete(uri) {
    this.files.delete(uri.path);
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri, newUri) {
    const content = this.readFile(oldUri);
    this.files.delete(oldUri.path);
    this.files.set(newUri.path, content);
    this.changeEmitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    ]);
  }

  isDirectory(directoryPath) {
    const prefix = `${directoryPath.replace(/\/$/, "")}/`;
    return [...this.files.keys()].some((filePath) => filePath.startsWith(prefix));
  }
}
