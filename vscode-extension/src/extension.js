import * as vscode from "vscode";

import { normalizeVsCodeSettings, workspaceKeyFromFolder } from "./config.js";
import { findCitationAtCursor } from "./core/citation.js";
import { applyInsertion, buildQuickPickItems, exportBibtex, resolveBibTarget, searchAds } from "./service.js";

export function activate(context) {
  const disposable = vscode.commands.registerCommand("overcite.resolveCitation", async () => {
    try {
      await runResolveCitation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}

async function runResolveCitation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("Open a LaTeX document and place the cursor inside a \\cite{...} token.");
  }

  const settings = readSettings();
  const sourceText = editor.document.getText();
  const cursorOffset = editor.document.offsetAt(editor.selection.active);
  const citationContext = findCitationAtCursor(sourceText, cursorOffset, settings.contextWindowChars);
  if (!citationContext) {
    throw new Error("Place the cursor inside a \\cite{...} command before running OverCite.");
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "OverCite",
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: "Searching NASA ADS..." });

      const projectState = await collectProjectState(editor.document, settings);
      let bibResolution = resolveBibTarget(projectState, settings);
      if (bibResolution.status === "not-found") {
        throw new Error("OverCite could not find any .bib files in this workspace.");
      }
      if (bibResolution.status === "needs-choice") {
        const chosen = await vscode.window.showQuickPick(bibResolution.candidates, {
          placeHolder: "Choose the bibliography file OverCite should update"
        });
        if (!chosen) {
          return;
        }
        bibResolution = { status: "resolved", target: chosen, candidates: bibResolution.candidates };
      }

      const candidates = await searchAds(citationContext, settings);
      if (!candidates.length) {
        throw new Error("No ADS records matched the current citation token and context.");
      }

      const quickPickItems = buildQuickPickItems(candidates, settings, citationContext.token);
      const picked = shouldAutoPickForTests()
        ? quickPickItems[0]
        : await vscode.window.showQuickPick(
            quickPickItems,
            {
              placeHolder: `${citationContext.command}{${citationContext.token || "..."}}`,
              matchOnDescription: true,
              matchOnDetail: true
            }
          );
      if (!picked) {
        return;
      }

      progress.report({ message: "Exporting BibTeX and updating files..." });
      const bibcode = picked.candidate.bibcode;
      const bibtex = await exportBibtex(bibcode, settings);
      const bibDoc = await openWorkspaceFile(projectState.workspaceFolder, bibResolution.target);
      const insertion = applyInsertion({
        bibText: bibDoc.getText(),
        bibtex,
        candidate: picked.candidate
      });

      const edit = new vscode.WorkspaceEdit();
      if (insertion.updatedBibText !== bibDoc.getText()) {
        const fullRange = new vscode.Range(
          bibDoc.positionAt(0),
          bibDoc.positionAt(bibDoc.getText().length)
        );
        edit.replace(bibDoc.uri, fullRange, insertion.updatedBibText);
      }

      const tokenRange = new vscode.Range(
        editor.document.positionAt(citationContext.tokenStart),
        editor.document.positionAt(citationContext.tokenEnd)
      );
      edit.replace(editor.document.uri, tokenRange, insertion.finalKey);

      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        throw new Error("VS Code could not apply the OverCite edit.");
      }

      await bibDoc.save();
      if (editor.document.uri.toString() !== bibDoc.uri.toString()) {
        await editor.document.save();
      }

      const updatedEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
      const finalOffset = citationContext.tokenStart + insertion.finalKey.length;
      const finalPosition = updatedEditor.document.positionAt(finalOffset);
      updatedEditor.selection = new vscode.Selection(finalPosition, finalPosition);
      updatedEditor.revealRange(new vscode.Range(finalPosition, finalPosition));

      const action = insertion.match ? "Reused" : "Inserted";
      void vscode.window.showInformationMessage(`${action} ${insertion.finalKey} in ${bibResolution.target}`);
    }
  );
}

function readSettings() {
  const config = vscode.workspace.getConfiguration("overcite");
  return normalizeVsCodeSettings({
    adsApiToken: config.get("adsApiToken"),
    contextWindowChars: config.get("contextWindowChars"),
    citationKeyMode: config.get("citationKeyMode"),
    bibliographyInsertMode: config.get("bibliographyInsertMode"),
    projectBibFileOverrides: config.get("projectBibFileOverrides")
  });
}

async function collectProjectState(document, settings) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    throw new Error("Open the file from a VS Code workspace folder before running OverCite.");
  }

  const bibUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, "**/*.bib"),
    "**/{node_modules,.git}/**"
  );

  return {
    mainText: document.getText(),
    activeFileName: basename(document.uri.fsPath),
    projectFiles: bibUris.map((uri) => basename(uri.fsPath)),
    projectId: workspaceKeyFromFolder(workspaceFolder.uri.fsPath),
    workspaceFolder,
    overrides: settings.projectBibFileOverrides
  };
}

async function openWorkspaceFile(workspaceFolder, fileName) {
  const matches = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, `**/${fileName}`),
    "**/{node_modules,.git}/**",
    2
  );
  if (!matches.length) {
    throw new Error(`Could not open ${fileName} in the current workspace.`);
  }
  return vscode.workspace.openTextDocument(matches[0]);
}

function basename(filePath) {
  const normalized = String(filePath ?? "").replace(/\\/g, "/");
  const pieces = normalized.split("/");
  return pieces[pieces.length - 1] ?? normalized;
}

function shouldAutoPickForTests() {
  return process.env.OVERCITE_TEST_AUTOPICK === "first";
}
