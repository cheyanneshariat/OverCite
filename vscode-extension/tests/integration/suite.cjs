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

  await runAppendScenario(mainTexPath, referencesPath);
  await runAlphabeticalScenario(mainTexPath, referencesPath);
  await runEmptyTokenScenario(mainTexPath, referencesPath);
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
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");

  assert.match(updatedMain, /\\citep\{Shariat25_10k\}/);
  assert.match(updatedBib, /Shariat25_10k/);
  assert.match(updatedBib, /10,000 Resolved Triples from Gaia/);
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
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");

  assert.match(updatedMain, /\\citep\{Shariat25_10k\}/);
  assert.match(updatedBib, /Shariat25_10k/);
  assert.ok(updatedBib.indexOf("Aaa20_demo") < updatedBib.indexOf("Shariat25_10k"));
  assert.ok(updatedBib.indexOf("Shariat25_10k") < updatedBib.indexOf("Zzz30_demo"));
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
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");

  assert.doesNotMatch(updatedMain, /\\citep\{\}/);
  assert.match(updatedMain, /\\citep\{Shariat25_/);
  assert.match(updatedBib, /Wide Binaries in an Ultra-faint Dwarf Galaxy/);
  assert.match(updatedBib, /Primordial black hole Dark Matter/);
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
