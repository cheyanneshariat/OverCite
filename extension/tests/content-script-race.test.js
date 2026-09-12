import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { findCitationAtCursor as findCoreCitation } from "../src/core/citation.js";

const contentScriptUrl = new URL("../src/content-script.js", import.meta.url);

test("popup footer keeps its insertion instruction concise", async () => {
  const source = await readContentScript();
  assert.ok(source.includes('footerText = "Select a paper to insert its citation."'));
  assert.ok(!source.includes("Pick a paper to rewrite the cite key and update your bibliography."));
});

async function readContentScript() {
  return readFile(contentScriptUrl, "utf8");
}

test("packaged content parser uses the same automatic context as shared core", async () => {
  const source = await readContentScript();
  const parser = source.slice(source.indexOf("  function findBraceClose("), source.indexOf("  const REQUEST_EVENT"));
  const findBrowserCitation = new Function(`${parser}\nreturn findCitationAtCursor;`)();
  const sentence = String.raw`Subtle differences between device size and configurations can influence how people approach tasks and interact with virtual models \citep{Wells2022}`;
  const cases = [
    sentence,
    String.raw`\newcommand{\stellar}{Astronomy macros}
${sentence}
\title{Triple star systems}
\author{Astronomer}
\affiliation{Department of Astronomy}
\begin{document}
Unrelated neutron stars.`,
    String.raw`\section{Computer Science}
${sentence}% Ground truth hidden in a comment: astronomy galaxies

\section{Astronomy}
Unrelated stars.`,
    String.raw`Methods use 0.5 arcsec, e.g. nearby sources. This sentence cites \citep [e.g.] [Sec. 2] {Wells2022} and continues after the citation.`,
    String.raw`An empty citation about mobile interfaces \citep{} needs context.`
  ];
  for (const text of cases) {
    const token = text.includes("Wells2022") ? "Wells2022" : "}";
    const cursor = token === "}" ? text.indexOf("\\citep{") + 7 : text.indexOf(token) + 2;
    const browser = findBrowserCitation(text, cursor, 1200);
    const core = findCoreCitation(text, cursor, 200);
    assert.ok(browser && core);
    for (const key of ["token", "tokenStart", "tokenEnd", "contextText", "sentenceText", "citationPrefixText", "citationSuffixText"]) {
      assert.deepEqual(browser[key], core[key], key);
    }
  }
  const standalone = findBrowserCitation(sentence, sentence.indexOf("Wells2022") + 2);
  const template = findBrowserCitation(cases[1], cases[1].indexOf("Wells2022") + 2);
  assert.equal(template.contextText, standalone.contextText);
  assert.doesNotMatch(template.contextText, /Astronomy|Triple|neutron/);
});

test("contextual previews stay off-screen and ranked results publish only once", async () => {
  const source = await readContentScript();
  const state = { requestId: "current", lookupGeneration: 7, citationContext: { command: "citep", token: "Wells2022" }, settings: {}, searchMode: "contextual" };
  let renders = 0;
  const args = ["message", "overlayState", "insertionInProgress", "activeSearchRequestId", "isCurrentLookup", "renderOverlay", "buildSearchModeActions"];
  const progress = new Function(...args, extractFunctionBody(source, "receiveSearchProgress"));
  const ready = new Function(...args, extractFunctionBody(source, "receiveSearchReady"));
  const invoke = (fn, message) => fn(message, state, false, "current", (generation) => generation === 7, () => { renders++; }, () => []);
  invoke(progress, { requestId: "current", revision: 1, results: [{ title: "Weak preview" }] });
  assert.equal(renders, 0);
  assert.equal(state.previewResults[0].title, "Weak preview");
  invoke(ready, { requestId: "old", results: [{ title: "Stale" }] });
  assert.equal(renders, 0);
  invoke(ready, { requestId: "current", results: [{ title: "Correct paper" }] });
  invoke(ready, { requestId: "current", results: [{ title: "Late reorder" }] });
  assert.equal(renders, 1);
  assert.equal(state.results[0].title, "Correct paper");
  assert.doesNotMatch(source, /Show refined results|ezcite-footer-refinement/);
});

test("popup settings and abstract controls are independent of paper selection", async () => {
  const source = await readContentScript();
  const render = extractFunctionBody(source, "renderOverlay");
  assert.match(source, /aria-label="Open OverCite settings"/);
  assert.match(source, /ezcite-settings"\)\.addEventListener\("click", openOverCiteOptions\)/);
  assert.match(render, /createTextElement\("details", "ezcite-abstract-details"/);
  assert.match(render, /card\.appendChild\(abstractWrap\)/);
  assert.doesNotMatch(render, /button\.appendChild\(abstractWrap\)/);
  assert.doesNotMatch(render, /innerHTML/);
});

test("settings and source edits invalidate stale results without reading editor DOM text", async () => {
  const source = await readContentScript();
  const hooks = extractFunctionBody(source, "installRuntimeHooks");
  const invalidate = extractFunctionBody(source, "invalidateDisplayedSearch");
  assert.match(hooks, /storage\?\.onChanged/);
  assert.match(hooks, /ezcite:settingsChanged/);
  assert.match(invalidate, /cancelActiveSearch\(\)/);
  assert.match(invalidate, /activeLookupGeneration \+= 1/);
  assert.match(invalidate, /overlayState = null/);
  assert.doesNotMatch(invalidate, /textContent|innerText|getEditorState/);
  assert.match(extractFunctionBody(source, "selectCandidate"), /isCurrentLookup\(state.lookupGeneration\)/);
});

function extractFunctionBody(source, functionName) {
  const asyncMarker = `  async function ${functionName}`;
  const syncMarker = `  function ${functionName}`;
  const asyncStart = source.indexOf(asyncMarker);
  const syncStart = source.indexOf(syncMarker);
  const start = asyncStart !== -1 ? asyncStart : syncStart;
  assert.notEqual(start, -1, `Missing ${functionName}`);

  let parenDepth = 0;
  let openBrace = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "{" && parenDepth === 0) {
      openBrace = index;
      break;
    }
  }
  assert.notEqual(openBrace, -1, `Missing body for ${functionName}`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }
  throw new Error(`Could not extract ${functionName}`);
}

test("content-script snapshots overlay state before async insertion work", async () => {
  const source = await readContentScript();
  const selectCandidateBody = extractFunctionBody(source, "selectCandidate");
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");

  assert.match(selectCandidateBody, /const state = snapshotOverlayState\(overlayState\)/);
  assert.match(selectCandidateBody, /insertionInProgress = true/);
  assert.match(selectCandidateBody, /await insertCandidateWithState\(candidate, state\)/);
  assert.doesNotMatch(insertBody, /overlayState\./, "async insertion body must use the captured state snapshot");
});

test("content-script blocks overlapping lookup and candidate insertion attempts", async () => {
  const source = await readContentScript();
  const startLookupBody = extractFunctionBody(source, "startLookup");
  const selectCandidateBody = extractFunctionBody(source, "selectCandidate");
  const queueBody = extractFunctionBody(source, "queueLookupAfterInsertion");
  const drainBody = extractFunctionBody(source, "drainQueuedLookupAfterInsertion");

  assert.match(startLookupBody, /if \(insertionInProgress\)/);
  assert.match(startLookupBody, /queueLookupAfterInsertion\(searchMode\)/);
  assert.doesNotMatch(startLookupBody, /still finishing the previous citation/i);
  assert.match(selectCandidateBody, /if \(insertionInProgress\)/);
  assert.doesNotMatch(selectCandidateBody, /toast\(/);
  assert.match(selectCandidateBody, /state\.userFileNavigationSerialAtSelection = userFileNavigationSerial/);
  assert.match(selectCandidateBody, /finally \{\s*insertionInProgress = false;/s);
  assert.match(selectCandidateBody, /drainQueuedLookupAfterInsertion\(\)/);
  assert.match(source, /let queuedLookupAfterInsertion = null/);
  assert.doesNotMatch(source, /QUEUED_LOOKUP_NOTICE_DELAY_MS/);
  assert.match(queueBody, /queuedLookupAfterInsertion = \{ searchMode \}/);
  assert.doesNotMatch(queueBody, /toast\(/);
  assert.doesNotMatch(queueBody, /setTimeout/);
  assert.doesNotMatch(queueBody, /previous insert/i);
  assert.match(drainBody, /const \{ searchMode \} = queuedLookupAfterInsertion/);
  assert.match(drainBody, /queuedLookupAfterInsertion = null/);
  assert.match(drainBody, /startLookup\(searchMode\)\.catch\(\(error\) => toast\(error\.message, "error"\)\)/);
});

test("content-script final source rewrite only runs when the final key changes", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");

  assert.match(insertBody, /const needsManualSourceUpdate = insertion\.finalKey !== optimisticKey/);
  assert.match(insertBody, /if \(needsManualSourceUpdate && sourceReadyForFinalRewrite\)/);
  assert.match(insertBody, /expectedDocument: expectedOptimisticSourceDocument/);
  assert.match(insertBody, /source:final-write-late-ack/);
  assert.match(insertBody, /editorAlreadyHasText\(\{/);
});

test("content-script targets source and bibliography before applying the return-to-editor preference", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");
  const optimisticWriteIndex = insertBody.indexOf('pageRequest("replaceRange"');
  const bibliographyWriteIndex = insertBody.indexOf('pageRequest("replaceDocument"');
  const returnPreferenceIndex = insertBody.indexOf("const shouldReturnToSource");

  assert.ok(optimisticWriteIndex >= 0, "missing source cite-key write");
  assert.ok(bibliographyWriteIndex > optimisticWriteIndex, "bibliography write should follow source write");
  assert.ok(returnPreferenceIndex > bibliographyWriteIndex, "return preference must only control final focus");
});

test("content-script scans every selected tab and uses exact filename comparisons", async () => {
  const source = await readContentScript();
  const readActiveFileNameBody = extractFunctionBody(source, "readActiveFileName");
  const matchesFileNameBody = extractFunctionBody(source, "matchesFileName");
  const openProjectFileBody = extractFunctionBody(source, "openProjectFile");

  assert.match(readActiveFileNameBody, /document\.querySelectorAll\(selector\)/);
  assert.doesNotMatch(readActiveFileNameBody, /ol-cm-toolbar-wrapper|cm-panels-top/);
  assert.match(matchesFileNameBody, /endsWith\(`\/\$\{target\}`\)/);
  assert.doesNotMatch(matchesFileNameBody, /\.includes\(/);
  assert.match(openProjectFileBody, /Math\.min\(Date\.now\(\) \+ 5500, requestedDeadlineAt\)/);
  assert.match(openProjectFileBody, /waitForTargetEditorState/);
  assert.match(openProjectFileBody, /deadlineAt - Date\.now\(\)/);
  assert.match(openProjectFileBody, /isProjectFileActive\([\s\S]*requireEditorTransition \? editorStateBeforeClick : null/);
  assert.doesNotMatch(openProjectFileBody, /if \(matchesFileName\(activeTabName, fileName\)\)/);
});

test("content-script shares one deadline across source recovery candidates", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");
  const tabRecoveryBody = extractFunctionBody(source, "openSourceTabByContent");
  const projectRecoveryBody = extractFunctionBody(source, "openSourceFileByProjectScan");

  assert.match(insertBody, /const sourceRecoveryDeadlineAt = Date\.now\(\) \+ 7000/);
  assert.match(insertBody, /deadlineAt: sourceRecoveryDeadlineAt/);
  assert.match(tabRecoveryBody, /Date\.now\(\) >= deadlineAt/);
  assert.doesNotMatch(tabRecoveryBody, /3500/);
  assert.match(projectRecoveryBody, /Date\.now\(\) >= deadlineAt/);
  assert.match(projectRecoveryBody, /openProjectFile\(fileName, \{ preferTabsOnly: false, deadlineAt \}\)/);
});

test("content-script reopens source for final-key reconciliation even when final focus stays in bib", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");

  assert.match(
    insertBody,
    /let shouldOpenSourceForFinalKey = switchedToBib && \(shouldReturnToSource \|\| needsManualSourceUpdate\)/
  );
  assert.match(insertBody, /if \(shouldOpenSourceForFinalKey\)/);
  assert.match(insertBody, /if \(shouldOpenSourceForFinalKey && !sourceReadyForFinalRewrite\)/);
  assert.match(insertBody, /if \(!restoredManualFinalFile && switchedToBib && needsManualSourceUpdate && !shouldReturnToSource\)/);
  assert.match(insertBody, /openProjectFile\(bibTarget\.target, \{ preferTabsOnly: false \}\)/);
});

test("content-script honors user file navigation during optional return-to-source", async () => {
  const source = await readContentScript();
  const recordNavigationBody = extractFunctionBody(source, "recordUserFileNavigation");
  const extractNavigationBody = extractFunctionBody(source, "extractFileNameFromUserTarget");
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");
  const openProjectFileBody = extractFunctionBody(source, "openProjectFile");

  assert.match(source, /let userFileNavigationSerial = 0/);
  assert.match(source, /let lastUserFileNavigation = null/);
  assert.match(source, /function installUserFileNavigationTracking\(\)/);
  assert.match(source, /event\.isTrusted/);
  assert.match(recordNavigationBody, /!insertionInProgress/);
  assert.match(source, /target\.closest\("#ezcite-root"\)/);
  assert.ok(
    recordNavigationBody.indexOf("!insertionInProgress") < recordNavigationBody.indexOf("event.target"),
    "idle pointer events must return before inspecting their DOM target"
  );
  assert.match(extractNavigationBody, /target\.closest\(/);
  assert.match(extractNavigationBody, /\[role='treeitem'\]/);
  assert.match(extractNavigationBody, /\[role='tab'\]/);
  assert.doesNotMatch(extractNavigationBody, /parentElement|while \(/);
  assert.doesNotMatch(source, /function isLikelyUserFileNavigationElement\(/);
  assert.match(source, /function getUserFileNavigationAfter\(serial\)/);
  assert.match(source, /if \(serial == null\) \{\s*return null;\s*\}/s);
  assert.match(source, /function hasUserFileNavigationAwayAfter\(serial, targetFileName\)/);
  assert.match(source, /function isUserFileNavigationError\(error\)/);
  assert.match(openProjectFileBody, /cancelOnUserFileNavigationAfterSerial = null/);
  assert.match(openProjectFileBody, /hasUserFileNavigationAwayAfter\(cancelOnUserFileNavigationAfterSerial, fileName\)/);
  assert.match(openProjectFileBody, /createUserFileNavigationError\(fileName, getUserFileNavigationAfter\(cancelOnUserFileNavigationAfterSerial\)\)/);
  assert.match(insertBody, /const userFileNavigationSerialAtSelection = state\.userFileNavigationSerialAtSelection \?\? userFileNavigationSerial/);
  assert.match(insertBody, /function getManualFinalFileName\(\)/);
  assert.match(insertBody, /function shouldCancelAutomaticSourceReturn\(\)/);
  assert.match(insertBody, /let automaticReturnCancelledByUser = false/);
  assert.match(insertBody, /shouldOpenSourceForFinalKey && shouldCancelAutomaticSourceReturn\(\)/);
  assert.match(insertBody, /cancelOnUserFileNavigationAfterSerial: needsManualSourceUpdate \? null : userFileNavigationSerialAtSelection/);
  assert.match(insertBody, /isUserFileNavigationError\(error\) && !needsManualSourceUpdate/);
  assert.match(insertBody, /const manualFinalFileName = getManualFinalFileName\(\)/);
  assert.match(insertBody, /openProjectFile\(manualFinalFileName, \{ preferTabsOnly: false \}\)/);
  assert.match(insertBody, /let restoredManualFinalFile = false/);
  assert.match(insertBody, /else if \(manualFinalFileName\) \{\s*restoredManualFinalFile = true;\s*\}/s);
  assert.match(insertBody, /!automaticReturnCancelledByUser/);
});

test("content-script closes the popup before return-to-source background work", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");

  assert.match(
    insertBody,
    /function closeOverlayForBackgroundFinish\(\) \{\s*if \(!overlayClosedForBackgroundFinish\) \{\s*closeOverlay\(\);\s*overlayClosedForBackgroundFinish = true;\s*\}\s*\}/s
  );
  const closeBeforeReturnIndex = insertBody.indexOf("closeOverlayForBackgroundFinish();");
  const returnToSourceIndex = insertBody.indexOf("if (shouldOpenSourceForFinalKey)");
  const manualFallbackIndex = insertBody.indexOf("if (needsManualSourceUpdate && !sourceReadyForFinalRewrite)");
  const finalKeyRewriteIndex = insertBody.indexOf("if (needsManualSourceUpdate && sourceReadyForFinalRewrite)");

  assert.ok(closeBeforeReturnIndex >= 0, "missing return-to-source popup close");
  assert.ok(
    closeBeforeReturnIndex < returnToSourceIndex,
    "popup should close before return-to-source switching begins"
  );
  assert.ok(
    closeBeforeReturnIndex < manualFallbackIndex,
    "popup should close before manual fallback checks can show long-running success UI"
  );
  assert.ok(
    closeBeforeReturnIndex < finalKeyRewriteIndex,
    "popup should close before hidden final-key reconciliation work"
  );
  assert.match(insertBody, /if \(!overlayClosedForBackgroundFinish\) \{\s*closeOverlay\(\);\s*\}/s);
  assert.match(
    insertBody,
    /function reportInsertionProgress\(label\) \{\s*if \(overlayClosedForBackgroundFinish\) \{\s*diagnostics\.note\(label\);/s
  );
  assert.match(insertBody, /reportInsertionProgress\(`Returning to \$\{returnTargetLabel\}\.\.\.`\)/);
  assert.match(insertBody, /reportInsertionProgress\(finalizingLabel\)/);
  assert.match(insertBody, /if \(!shouldReturnToSource\) \{\s*toast\(/s);
});

test("content-script requests the acknowledgment reminder only after a completed insertion", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");
  const reminderBody = extractFunctionBody(source, "maybeShowAcknowledgmentReminder");
  const finalFinishIndex = insertBody.lastIndexOf("diagnostics.finish");
  const reminderIndex = insertBody.lastIndexOf("void maybeShowAcknowledgmentReminder()");

  assert.ok(finalFinishIndex >= 0, "missing completed-insertion marker");
  assert.ok(reminderIndex > finalFinishIndex, "reminder must follow completed insertion");
  assert.match(reminderBody, /CLAIM_ACKNOWLEDGMENT_REMINDER/);
  assert.match(reminderBody, /if \(!reminder\?\.show\)/);
  assert.match(reminderBody, /Copy acknowledgment/);
  assert.match(reminderBody, /Remind me later/);
  assert.match(reminderBody, /Never remind me/);
  assert.match(reminderBody, /DISABLE_ACKNOWLEDGMENT_REMINDER/);
  assert.match(reminderBody, /layout: "card"/);
  assert.doesNotMatch(reminderBody, /dismissible: true/);
  assert.match(reminderBody, /durationMs: 20000/);
  assert.match(source, /function copyTextToClipboard\(text\)/);
  assert.match(source, /#ezcite-toast\.card \{[\s\S]*?right: 20px;[\s\S]*?width: min\(400px/);
  assert.match(source, /\.ezcite-toast-actions \{/);
});

test("content-script removes overlay DOM on close", async () => {
  const source = await readContentScript();

  assert.match(
    source,
    /function closeOverlay\(\) \{[\s\S]*overlay\.remove\(\);\s*overlay = null;[\s\S]*overlayState = null;\s*\}/
  );
  assert.match(source, /pendingSubjectAreaPrompt\.resolve\(null\)/);
});

test("content-script replaces lookup failures with retryable error UI", async () => {
  const source = await readContentScript();
  const startLookupBody = extractFunctionBody(source, "startLookup");
  const errorActionsBody = extractFunctionBody(source, "buildLookupErrorActions");

  assert.match(startLookupBody, /let results;/);
  assert.match(startLookupBody, /try \{\s*results = await callRuntime\(\{/s);
  assert.match(startLookupBody, /type: MESSAGE_TYPES\.SEARCH_ADS/);
  assert.match(startLookupBody, /catch \(error\) \{/);
  assert.match(startLookupBody, /renderOverlay\(\{\s*subtitle: `\$\{citationContext\.command\}\{\$\{citationContext\.token \|\| "\.\.\."\}\}`,[\s\S]*error: true,[\s\S]*actions: buildLookupErrorActions\(citationContext, resolvedSearchMode, error\)[\s\S]*\}\);/);
  assert.match(startLookupBody, /toast\(error\.message \|\| "OverCite could not complete this lookup\.", "error", \{ durationMs: 5200 \}\)/);
  assert.match(startLookupBody, /return;/);
  assert.match(errorActionsBody, /label: "Try again"/);
  assert.match(errorActionsBody, /kind: "primary"/);
  assert.match(errorActionsBody, /startLookup\(searchMode\)\.catch\(\(error\) => toast\(error\.message, "error"\)\)/);
  assert.match(errorActionsBody, /\.\.\.buildSearchModeActions\(citationContext, searchMode\)/);
});

test("content-script uses operation-specific background deadlines and search guidance", async () => {
  const source = await readContentScript();
  const callRuntimeBody = extractFunctionBody(source, "callRuntime");
  const timeoutBody = extractFunctionBody(source, "runtimeTimeoutForMessage");
  const messageBody = extractFunctionBody(source, "runtimeTimeoutMessage");

  assert.match(callRuntimeBody, /runtimeTimeoutForMessage\(message\?\.type\)/);
  assert.match(callRuntimeBody, /runtimeTimeoutMessage\(message\?\.type\)/);
  assert.match(timeoutBody, /MESSAGE_TYPES\.SEARCH_ADS/);
  assert.match(timeoutBody, /40000/);
  assert.match(timeoutBody, /MESSAGE_TYPES\.EXPORT_BIBTEX/);
  assert.match(messageBody, /literature search took too long/i);
  assert.match(messageBody, /use Simple search/i);
  assert.doesNotMatch(messageBody, /background worker/i);
});

test("content-script keeps empty-token lookups contextual with a Simple default", async () => {
  const source = await readContentScript();
  const startLookupBody = extractFunctionBody(source, "startLookup");
  const normalizeBody = extractFunctionBody(source, "normalizeSearchMode");

  assert.match(startLookupBody, /resolvedSearchMode !== "contextual" && !citationContext\.token\.trim\(\)/);
  assert.match(startLookupBody, /resolvedSearchMode = "contextual"/);
  assert.match(normalizeBody, /return "simple"/);
});

test("content-script verifies manual file continuation and bounds bibliography confirmation", async () => {
  const source = await readContentScript();
  const manualBody = extractFunctionBody(source, "waitForManualFileSwitch");
  const confirmationBody = extractFunctionBody(source, "getConfirmedBibEditorState");
  const targetWaitBody = extractFunctionBody(source, "waitForTargetEditorState");
  const targetMatchBody = extractFunctionBody(source, "editorStateMatchesTarget");

  assert.match(manualBody, /getEditorStateWithRetry\(2, 120, 1200\)/);
  assert.match(manualBody, /allowUnknownFileName: true/);
  assert.match(manualBody, /return waitForContinue/);
  assert.match(manualBody, /does not appear to be/);
  assert.match(confirmationBody, /waitForTargetEditorState/);
  assert.doesNotMatch(confirmationBody, /openProjectFile|ensureProjectFileActive/);
  assert.match(targetWaitBody, /Date\.now\(\) - startedAt < timeoutMs/);
  assert.match(targetWaitBody, /getEditorStateWithRetry\(1, 0, Math\.min\(900, remainingMs\), previousRead\)/);
  assert.match(targetWaitBody, /previousRead = state/);
  assert.match(targetMatchBody, /if \(!options\.allowUnknownFileName\)/);
  assert.match(targetMatchBody, /return false/);
});

test("content-script uses a short non-blocking success notice after insertion", async () => {
  const source = await readContentScript();
  const insertBody = extractFunctionBody(source, "insertCandidateWithState");

  assert.match(source, /const MIN_TOAST_DURATION_MS = 900/);
  assert.match(source, /const SUCCESS_TOAST_DURATION_MS = 1000/);
  assert.doesNotMatch(source, /INSERTION_BUSY_TOAST_DURATION_MS/);
  assert.match(source, /Math\.max\(MIN_TOAST_DURATION_MS, options\.durationMs\)/);
  assert.match(insertBody, /\{ durationMs: SUCCESS_TOAST_DURATION_MS \}/);
  assert.match(source, /#ezcite-toast \{[\s\S]*?pointer-events: none;/);
});

test("content-script removes hidden toast nodes after they fade", async () => {
  const source = await readContentScript();
  const toastBody = extractFunctionBody(source, "toast");

  assert.match(toastBody, /window\.clearTimeout\(toastNode\._removeTimeoutId\)/);
  assert.match(toastBody, /const timeoutId = window\.setTimeout/);
  assert.match(toastBody, /toastNode\.classList\.remove\("visible"\)/);
  assert.match(toastBody, /toastNode\._removeTimeoutId = window\.setTimeout/);
  assert.match(toastBody, /toastNode\._timeoutId === timeoutId/);
  assert.match(toastBody, /toastNode\.remove\(\)/);
});

test("content-script shows citation counts as a non-wrapping result badge when available", async () => {
  const source = await readContentScript();
  const renderBody = extractFunctionBody(source, "renderOverlay");
  const formatMetaBody = extractFunctionBody(source, "formatCandidateMeta");
  const formatCitationCountBody = extractFunctionBody(source, "formatCitationCountBadge");

  assert.match(renderBody, /formatCandidateMeta\(candidate\)/);
  assert.match(renderBody, /formatCitationCountBadge\(candidate\.citationCount\)/);
  assert.match(renderBody, /ezcite-citation-count/);
  assert.match(source, /\.ezcite-source-row/);
  assert.match(source, /\.ezcite-citation-count/);
  assert.match(source, /\.ezcite-citation-count \{[\s\S]*?white-space: nowrap;/);
  assert.match(source, /\.ezcite-meta \{[\s\S]*?-webkit-line-clamp: 2;/);
  assert.doesNotMatch(formatMetaBody, /citationCount/);
  assert.match(formatCitationCountBody, /toLocaleString\("en-US"\)/);
  assert.match(formatCitationCountBody, /cited by/);
  assert.match(formatCitationCountBody, /count <= 0/);
});
