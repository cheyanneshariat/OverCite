import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contentScriptUrl = new URL("../src/content-script.js", import.meta.url);

async function readContentScript() {
  return readFile(contentScriptUrl, "utf8");
}

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
  assert.match(openProjectFileBody, /matchesFileName\(activeTabName, fileName\)/);
  assert.match(openProjectFileBody, /matchesFileName\(activeFileName, fileName\)/);
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

test("content-script removes overlay DOM on close", async () => {
  const source = await readContentScript();

  assert.match(
    source,
    /function closeOverlay\(\) \{\s*activeLookupGeneration \+= 1;\s*if \(overlay\) \{\s*overlay\.remove\(\);\s*overlay = null;\s*\}\s*overlayState = null;\s*\}/s
  );
});

test("content-script replaces lookup failures with retryable error UI", async () => {
  const source = await readContentScript();
  const startLookupBody = extractFunctionBody(source, "startLookup");
  const errorActionsBody = extractFunctionBody(source, "buildLookupErrorActions");

  assert.match(startLookupBody, /let results;/);
  assert.match(startLookupBody, /try \{\s*results = await callRuntime\(\{/s);
  assert.match(startLookupBody, /type: MESSAGE_TYPES\.SEARCH_ADS/);
  assert.match(startLookupBody, /catch \(error\) \{/);
  assert.match(startLookupBody, /renderOverlay\(\{\s*subtitle: `\$\{citationContext\.command\}\{\$\{citationContext\.token \|\| "\.\.\."\}\}`,[\s\S]*error: true,[\s\S]*actions: buildLookupErrorActions\(citationContext, resolvedSearchMode\)[\s\S]*\}\);/);
  assert.match(startLookupBody, /toast\(error\.message \|\| "OverCite could not complete this lookup\.", "error", \{ durationMs: 5200 \}\)/);
  assert.match(startLookupBody, /return;/);
  assert.match(errorActionsBody, /label: "Try again"/);
  assert.match(errorActionsBody, /kind: "primary"/);
  assert.match(errorActionsBody, /startLookup\(searchMode\)\.catch\(\(error\) => toast\(error\.message, "error"\)\)/);
  assert.match(errorActionsBody, /\.\.\.buildSearchModeActions\(citationContext, searchMode\)/);
});

test("content-script tells users to refresh Overleaf after background worker timeouts", async () => {
  const source = await readContentScript();
  const callRuntimeBody = extractFunctionBody(source, "callRuntime");

  assert.match(callRuntimeBody, /Timed out waiting for the OverCite background worker/);
  assert.match(callRuntimeBody, /Refresh the Overleaf page and try again/);
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
