const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const vscode = require("vscode");

async function run() {
  const workspaceDir = process.env.OVERCITE_TEST_WORKSPACE;
  const mainTexPath = process.env.OVERCITE_TEST_MAIN_TEX;
  const referencesPath = process.env.OVERCITE_TEST_REFERENCES;
  const resultPath = process.env.OVERCITE_TEST_RESULT_PATH;

  assert.ok(workspaceDir, "Missing OVERCITE_TEST_WORKSPACE");
  assert.ok(mainTexPath, "Missing OVERCITE_TEST_MAIN_TEX");
  assert.ok(referencesPath, "Missing OVERCITE_TEST_REFERENCES");
  assert.ok(resultPath, "Missing OVERCITE_TEST_RESULT_PATH");

  const config = vscode.workspace.getConfiguration("overcite");
  await config.update("adsApiToken", "integration-test-token", vscode.ConfigurationTarget.Workspace);
  await config.update("citationKeyMode", "informative", vscode.ConfigurationTarget.Workspace);

  await runAppendScenario(mainTexPath, referencesPath);
  await runAlphabeticalScenario(mainTexPath, referencesPath);
  await runEmptyTokenScenario(mainTexPath, referencesPath);
  await runSimpleCommandScenario(mainTexPath, referencesPath);
  await runDirectCommandScenario(mainTexPath, referencesPath);
  await runVirtualWorkspaceScenario();
  await fs.writeFile(resultPath, JSON.stringify({ ok: true }, null, 2));
}

module.exports = { run };

async function runAppendScenario(mainTexPath, referencesPath) {
  const document = await vscode.workspace.openTextDocument(mainTexPath);
  const editor = await vscode.window.showTextDocument(document);
  const source = document.getText();
  const tokenIndex = source.indexOf("Shariat25");
  assert.ok(tokenIndex >= 0, "Did not find Shariat25 in main.tex");

  const targetOffset = tokenIndex + Math.min(3, "Shariat25".length - 1);
  const targetPosition = document.positionAt(targetOffset);
  editor.selection = new vscode.Selection(targetPosition, targetPosition);
  editor.revealRange(new vscode.Range(targetPosition, targetPosition));

  await vscode.commands.executeCommand("overcite.resolveCitation");
  await waitForFileMatch(mainTexPath, /\\citep\{Shariat25_10k\}/);
  await waitForFileMatch(referencesPath, /Shariat25_10k/);

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");
  const activeEditor = vscode.window.activeTextEditor;

  assert.match(updatedMain, /\\citep\{Shariat25_10k\}/);
  assert.match(updatedBib, /Shariat25_10k/);
  assert.match(updatedBib, /10,000 Resolved Triples from Gaia/);
  assert.ok(activeEditor, "Expected an active editor after append insertion");
  assert.equal(activeEditor.document.uri.fsPath, mainTexPath);
  assertCollapsedSelectionAtText(activeEditor, "Shariat25_10k");
}

async function runAlphabeticalScenario(mainTexPath, referencesPath) {
  const config = vscode.workspace.getConfiguration("overcite");
  await config.update("bibliographyInsertMode", "alphabetical", vscode.ConfigurationTarget.Workspace);

  const document = await rewriteDocument(
    mainTexPath,
    "\\documentclass{article}\n\\begin{document}\nTriple star systems are very common, as revealed by Gaia \\citep{Shariat25}.\n\\bibliography{references}\n\\end{document}\n"
  );
  await rewriteDocument(
    referencesPath,
    "@ARTICLE{Aaa20_demo,\n  author = {{Alpha}, A.},\n  title = {Alpha Demo},\n  year = {2020}\n}\n\n@ARTICLE{Zzz30_demo,\n  author = {{Zulu}, Z.},\n  title = {Zulu Demo},\n  year = {2030}\n}\n"
  );

  const editor = await vscode.window.showTextDocument(document);
  const source = document.getText();
  const tokenIndex = source.indexOf("Shariat25");
  assert.ok(tokenIndex >= 0, "Did not find Shariat25 in main.tex for alphabetical scenario");

  const targetOffset = tokenIndex + Math.min(3, "Shariat25".length - 1);
  const targetPosition = document.positionAt(targetOffset);
  editor.selection = new vscode.Selection(targetPosition, targetPosition);
  editor.revealRange(new vscode.Range(targetPosition, targetPosition));

  await vscode.commands.executeCommand("overcite.resolveCitation");
  await waitForFileMatch(mainTexPath, /\\citep\{Shariat25_10k\}/);
  await waitForFileMatch(referencesPath, /Shariat25_10k/);

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");
  const activeEditor = vscode.window.activeTextEditor;

  assert.match(updatedMain, /\\citep\{Shariat25_10k\}/);
  assert.match(updatedBib, /Shariat25_10k/);
  assert.ok(updatedBib.indexOf("Aaa20_demo") < updatedBib.indexOf("Shariat25_10k"));
  assert.ok(updatedBib.indexOf("Shariat25_10k") < updatedBib.indexOf("Zzz30_demo"));
  assert.ok(activeEditor, "Expected an active editor after alphabetical insertion");
  assert.equal(activeEditor.document.uri.fsPath, mainTexPath);
  assertCollapsedSelectionAtText(activeEditor, "Shariat25_10k");
}

async function runEmptyTokenScenario(mainTexPath, referencesPath) {
  const config = vscode.workspace.getConfiguration("overcite");
  await config.update("bibliographyInsertMode", "append", vscode.ConfigurationTarget.Workspace);

  const document = await rewriteDocument(
    mainTexPath,
    "\\documentclass{article}\n\\begin{document}\nPrimordial black holes have been killed by wide binaries \\citep{}.\n\\bibliography{references}\n\\end{document}\n"
  );
  await rewriteDocument(
    referencesPath,
    "@ARTICLE{Existing24_demo,\n  author = {{Someone}, Demo},\n  title = {An Existing Demo Entry},\n  year = {2024}\n}\n"
  );

  const editor = await vscode.window.showTextDocument(document);
  const source = document.getText();
  const tokenIndex = source.indexOf("\\citep{}") + "\\citep{".length;
  assert.ok(tokenIndex >= 0, "Did not find empty citation in main.tex for empty-token scenario");

  const targetPosition = document.positionAt(tokenIndex);
  editor.selection = new vscode.Selection(targetPosition, targetPosition);
  editor.revealRange(new vscode.Range(targetPosition, targetPosition));

  await vscode.commands.executeCommand("overcite.resolveCitation");
  await waitForFileExcludes(mainTexPath, /\\citep\{\}/);
  await waitForFileMatch(referencesPath, /Wide Binaries in an Ultra-faint Dwarf Galaxy/);

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");
  const activeEditor = vscode.window.activeTextEditor;

  assert.doesNotMatch(updatedMain, /\\citep\{\}/);
  assert.match(updatedMain, /\\citep\{Shariat25_/);
  assert.match(updatedBib, /Wide Binaries in an Ultra-faint Dwarf Galaxy/);
  assert.match(updatedBib, /Primordial black hole Dark Matter/);
  assert.ok(activeEditor, "Expected an active editor after empty-token insertion");
  assert.equal(activeEditor.document.uri.fsPath, mainTexPath);
  assertCollapsedSelectionAtText(activeEditor, "Shariat25_");
}

async function runSimpleCommandScenario(mainTexPath, referencesPath) {
  const config = vscode.workspace.getConfiguration("overcite");
  await config.update("bibliographyInsertMode", "append", vscode.ConfigurationTarget.Workspace);
  await config.update("defaultSearchMode", "contextual", vscode.ConfigurationTarget.Workspace);

  const document = await rewriteDocument(
    mainTexPath,
    "\\documentclass{article}\n\\begin{document}\nTriple star systems are very common, as revealed by Gaia \\citep{Shariat25}.\n\\bibliography{references}\n\\end{document}\n"
  );
  await rewriteDocument(
    referencesPath,
    "@ARTICLE{Existing24_demo,\n  author = {{Someone}, Demo},\n  title = {An Existing Demo Entry},\n  year = {2024}\n}\n"
  );

  const editor = await vscode.window.showTextDocument(document);
  const source = document.getText();
  const tokenIndex = source.indexOf("Shariat25");
  assert.ok(tokenIndex >= 0, "Did not find Shariat25 in main.tex for simple-command scenario");

  const targetOffset = tokenIndex + Math.min(3, "Shariat25".length - 1);
  const targetPosition = document.positionAt(targetOffset);
  editor.selection = new vscode.Selection(targetPosition, targetPosition);
  editor.revealRange(new vscode.Range(targetPosition, targetPosition));

  await vscode.commands.executeCommand("overcite.resolveCitationSimple");
  await waitForFileMatch(mainTexPath, /\\citep\{Shariat25_/);
  await waitForFileMatch(referencesPath, /Once a Triple|10,000 Resolved Triples from Gaia/);

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");
  const activeEditor = vscode.window.activeTextEditor;

  assert.match(updatedMain, /\\citep\{Shariat25_/);
  assert.match(updatedBib, /Once a Triple|10,000 Resolved Triples from Gaia/);
  assert.ok(activeEditor, "Expected an active editor after simple-command insertion");
  assert.equal(activeEditor.document.uri.fsPath, mainTexPath);
  assertCollapsedSelectionAtText(activeEditor, "Shariat25_");
}

async function runDirectCommandScenario(mainTexPath, referencesPath) {
  const config = vscode.workspace.getConfiguration("overcite");
  await config.update("bibliographyInsertMode", "append", vscode.ConfigurationTarget.Workspace);
  await config.update("defaultSearchMode", "contextual", vscode.ConfigurationTarget.Workspace);

  const document = await rewriteDocument(
    mainTexPath,
    "\\documentclass{article}\n\\begin{document}\nPeople find that magnetic braking saturates \\citep{author:\"El-Badry\" year:2022 title:\"magnetic braking\"}.\n\\bibliography{references}\n\\end{document}\n"
  );
  await rewriteDocument(
    referencesPath,
    "@ARTICLE{Existing24_demo,\n  author = {{Someone}, Demo},\n  title = {An Existing Demo Entry},\n  year = {2024}\n}\n"
  );

  const editor = await vscode.window.showTextDocument(document);
  const source = document.getText();
  const tokenText = 'author:"El-Badry" year:2022 title:"magnetic braking"';
  const tokenIndex = source.indexOf(tokenText);
  assert.ok(tokenIndex >= 0, "Did not find direct ADS query token in main.tex for direct-command scenario");

  const targetOffset = tokenIndex + Math.min(8, tokenText.length - 1);
  const targetPosition = document.positionAt(targetOffset);
  editor.selection = new vscode.Selection(targetPosition, targetPosition);
  editor.revealRange(new vscode.Range(targetPosition, targetPosition));

  await vscode.commands.executeCommand("overcite.resolveCitationDirect");
  await waitForFileExcludes(mainTexPath, /author:"El-Badry" year:2022 title:"magnetic braking"/);
  await waitForFileMatch(mainTexPath, /\\citep\{ElBadry22/);
  await waitForFileMatch(referencesPath, /Magnetic braking saturates/i);

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");
  const activeEditor = vscode.window.activeTextEditor;

  assert.doesNotMatch(updatedMain, /author:"El-Badry" year:2022 title:"magnetic braking"/);
  assert.match(updatedMain, /\\citep\{ElBadry22/);
  assert.match(updatedBib, /Magnetic braking saturates/i);
  assert.ok(activeEditor, "Expected an active editor after direct-command insertion");
  assert.equal(activeEditor.document.uri.fsPath, mainTexPath);
  assertCollapsedSelectionAtText(activeEditor, "ElBadry22");
}

async function runVirtualWorkspaceScenario() {
  const provider = new MemoryFileSystemProvider();
  const registration = vscode.workspace.registerFileSystemProvider("overleaf-workshop", provider, {
    isCaseSensitive: true
  });
  const rootUri = vscode.Uri.parse(
    "overleaf-workshop://www.overleaf.com/Remote_Paper?user=integration-user&project=integration-project"
  );
  const mainUri = vscode.Uri.joinPath(rootUri, "main.tex");
  const referencesUri = vscode.Uri.joinPath(rootUri, "references.bib");
  provider.seed(
    mainUri,
    "\\documentclass{article}\n\\begin{document}\nTriple star systems are very common, as revealed by Gaia \\citep{Shariat25}.\n\\bibliography{references}\n\\end{document}\n"
  );
  provider.seed(
    referencesUri,
    "@ARTICLE{Existing24_demo,\n  author = {{Someone}, Demo},\n  title = {An Existing Demo Entry},\n  year = {2024}\n}\n"
  );

  const insertIndex = vscode.workspace.workspaceFolders?.length ?? 0;
  const added = vscode.workspace.updateWorkspaceFolders(insertIndex, 0, {
    uri: rootUri,
    name: "Remote Paper"
  });
  assert.ok(added, "Failed to add the virtual integration workspace");

  try {
    await waitForCondition(
      () => Boolean(vscode.workspace.getWorkspaceFolder(mainUri)),
      "virtual workspace folder registration"
    );
    const document = await vscode.workspace.openTextDocument(mainUri);
    const editor = await vscode.window.showTextDocument(document);
    const tokenIndex = document.getText().indexOf("Shariat25");
    assert.ok(tokenIndex >= 0, "Did not find Shariat25 in virtual main.tex");
    const targetPosition = document.positionAt(tokenIndex + 3);
    editor.selection = new vscode.Selection(targetPosition, targetPosition);

    await withTimeout(
      vscode.commands.executeCommand("overcite.resolveCitation"),
      10000,
      "OverCite hung while resolving a citation in a virtual workspace"
    );

    assert.match(document.getText(), /\\citep\{Shariat25_10k\}/);
    const references = await vscode.workspace.openTextDocument(referencesUri);
    assert.match(references.getText(), /Shariat25_10k/);
    assert.match(provider.readText(referencesUri), /10,000 Resolved Triples from Gaia/);
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), mainUri.toString());
    assertCollapsedSelectionAtText(vscode.window.activeTextEditor, "Shariat25_10k");
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

async function rewriteDocument(filePath, text) {
  const document = await vscode.workspace.openTextDocument(filePath);
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, text);
  const applied = await vscode.workspace.applyEdit(edit);
  assert.ok(applied, `Failed to rewrite ${filePath}`);
  await document.save();
  await new Promise((resolve) => setTimeout(resolve, 150));
  return vscode.workspace.openTextDocument(filePath);
}

function assertCollapsedSelectionAtText(editor, textPrefix) {
  assert.ok(editor.selection.isEmpty, "Expected cursor selection to be collapsed");
  const documentText = editor.document.getText();
  const expectedStart = documentText.indexOf(textPrefix);
  assert.ok(expectedStart >= 0, `Did not find ${textPrefix} in active editor`);
  const expectedEnd = expectedStart + textPrefix.length;
  const selectionOffset = editor.document.offsetAt(editor.selection.active);
  assert.ok(
    selectionOffset >= expectedEnd,
    `Expected cursor to land after ${textPrefix}, found offset ${selectionOffset} before ${expectedEnd}`
  );
}

async function waitForCondition(predicate, label, timeoutMs = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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

  watch() {
    return new vscode.Disposable(() => {});
  }

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
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const remainder = filePath.slice(prefix.length);
      const [name, ...tail] = remainder.split("/");
      entries.set(name, tail.length ? vscode.FileType.Directory : vscode.FileType.File);
    }
    return [...entries.entries()];
  }

  readFile(uri) {
    const content = this.files.get(uri.path);
    if (!content) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
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

async function waitForFileMatch(filePath, pattern, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await fs.readFile(filePath, "utf8");
    if (pattern.test(text)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const finalText = await fs.readFile(filePath, "utf8");
  assert.match(finalText, pattern);
  return finalText;
}

async function waitForFileExcludes(filePath, pattern, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await fs.readFile(filePath, "utf8");
    if (!pattern.test(text)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const finalText = await fs.readFile(filePath, "utf8");
  assert.doesNotMatch(finalText, pattern);
  return finalText;
}
