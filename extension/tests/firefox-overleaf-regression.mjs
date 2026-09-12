import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const firefoxBinary = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";
const fixturePath = new URL("./fixtures/overleaf-current-ui.html", import.meta.url);
const firefoxDistPath = new URL("../dist/firefox/", import.meta.url);
const soakCycles = readSoakCycles();
const soakWaitBudgetMs = Math.max(180000, Math.ceil((soakCycles / 30) * 180000));
const backgroundStub = `
import { applyBibInsertion } from "./core/bibtex.js";

const extensionApi = globalThis.browser ?? globalThis.chrome;
const candidate = {
  sourceId: "ads",
  sourceLabel: "ADS/SciX",
  bibcode: "2021ApJ...922...47R",
  title: "The Chandra Survey of M51",
  authors: ["Rice, Thomas S.", "Smith, Jane Q."],
  year: 2021,
  abstract: "A synthetic Rice 2021 result used only by the Firefox regression fixture.",
  citationCount: 17,
  generatedKey: "Rice2021"
};
let searchAttemptCount = 0;
const pendingPreviews = new Map();
const staleAttempts = new Set();

function settingsForSender(sender) {
  const pageUrl = new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/");
  return {
    adsApiToken: "",
    sourceProfile: "astrophysics",
    subjectAreaConfigured: pageUrl.searchParams.get("onboarding") !== "1",
    primarySource: "ads",
    fallbackSources: [],
    sourceApiTokens: {},
    defaultProjectBibFileOverride: {},
    contextWindowChars: 500,
    shortcutHelpText: "Alt+Shift+E",
    themeMode: "auto",
    returnToSourceAfterInsert: pageUrl.searchParams.get("return") === "1",
    citationKeyMode: "authoryear",
    bibliographyInsertMode: pageUrl.searchParams.get("insertmode") === "append" ? "append" : "alphabetical",
    defaultSearchMode: "simple"
  };
}

async function handleMessage(message, sender) {
  const pageUrl = new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/");
  switch (message?.type) {
    case "getSettings":
      return settingsForSender(sender);
    case "searchAds":
      if (pageUrl.searchParams.has("stale") && !staleAttempts.has(sender.tab.id)) {
        staleAttempts.add(sender.tab.id);
        await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: message.requestId, results: [candidate] });
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (pageUrl.searchParams.get("stale") === "settings") await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:settingsChanged" });
        await new Promise((resolve) => setTimeout(resolve, 400));
        await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: message.requestId, results: [{ ...candidate, title: "STALE" }] });
        return [{ ...candidate, title: "STALE" }];
      }
      if (pageUrl.searchParams.has("manyresults")) {
        return Array.from({ length: 10 }, (_, index) => ({ ...candidate, bibcode: index ? "layout-" + index : candidate.bibcode, title: candidate.title + " — readable result " + index }));
      }
      if (pageUrl.searchParams.has("abstract")) {
        return [{ ...candidate, abstract: "Full abstract content. ".repeat(30) + "<img src=x onerror=alert(1)>" }];
      }
      if (pageUrl.searchParams.has("counts")) {
        let release;
        const pending = { cancelled: false, release: () => release?.() };
        pendingPreviews.set(sender.tab.id, pending);
        const plain = { ...candidate, citationCount: 0 };
        const ready = pageUrl.searchParams.get("counts") === "refine"
          ? [{ ...plain, bibcode: "other-count-paper", generatedKey: "Other2021", title: "Refined alternative" }, plain] : [plain];
        if (ready.length > 1) await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchProgress", requestId: message.requestId, revision: 1, results: [plain] });
        await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: "stale", results: [{ ...plain, title: "STALE" }] });
        await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: message.requestId, results: ready });
        await Promise.race([new Promise((resolve) => { release = resolve; }), new Promise((resolve) => setTimeout(resolve, 1500))]);
        return ready.map((result) => ({ ...result, citationCount: 987 }));
      }
      if (pageUrl.searchParams.has("preview")) {
        let release;
        const pending = { cancelled: false, release: () => release?.() };
        pendingPreviews.set(sender.tab.id, pending);
        await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchProgress", requestId: "stale", revision: 1, results: [{ ...candidate, title: "STALE" }] });
        await extensionApi.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchProgress", requestId: message.requestId, revision: 1, results: [candidate] });
        await Promise.race([new Promise((resolve) => { release = resolve; }), new Promise((resolve) => setTimeout(resolve, 1500))]);
        if (pageUrl.searchParams.get("preview") === "fail") throw new Error("Refinement failed");
        return [{ ...candidate, bibcode: "refined-other", title: "Refined alternative", generatedKey: "Other2021" }, candidate];
      }
      if (pageUrl.searchParams.get("missingtoken") === "1") {
        throw new Error("No ADS/SciX API token is configured for ADS/SciX search.");
      }
      if (pageUrl.searchParams.get("retry") === "1" && searchAttemptCount++ === 0) {
        throw new Error("Synthetic first lookup failure");
      }
      if (message.citationContext.searchMode !== (message.citationContext.token.trim() ? "simple" : "contextual")) {
        throw new Error("Unexpected search mode: " + message.citationContext.searchMode);
      }
      return [candidate];
    case "cancelSearch": {
      const pending = pendingPreviews.get(sender.tab.id);
      if (pending) { pending.cancelled = true; pending.release(); }
      return true;
    }
    case "resolveBibTarget":
      return { status: "resolved", target: "references.bib", candidates: ["references.bib"] };
    case "exportBibtex":
      if (pageUrl.searchParams.get("counts") === "select" && !pendingPreviews.get(sender.tab.id)?.cancelled) {
        throw new Error("Selection waited for citation counts or did not cancel enrichment");
      }
      if (new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/").searchParams.get("firefoxstress") === "1") {
        await new Promise((resolve) => setTimeout(resolve, 1800));
      }
      return "@article{Rice2021,\\n  author = {Rice, Thomas S. and Smith, Jane Q.},\\n  title = {The Chandra Survey of M51},\\n  year = {2021}\\n}";
    case "applyInsertion":
      if (new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/").searchParams.get("manualrace") === "1") {
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
      return applyBibInsertion(message.payload);
    case "saveSettings":
      return message.settings;
    case "requestSourcePermissions":
      if (pageUrl.searchParams.has("permissiongesture")) throw new Error("permissions.request may only be called from a user input handler");
      return true;
    case "openOptions":
      return true;
    case "claimAcknowledgmentReminder": {
      if (pageUrl.searchParams.get("ackfail") === "1") {
        throw new Error("Synthetic acknowledgment storage failure");
      }
      const nextKey = "acknowledgmentReminderNextEligibleAt";
      const disabledKey = "acknowledgmentReminderDisabled";
      if (pageUrl.searchParams.get("ackfuture") === "1") {
        await extensionApi.storage.local.set({ [nextKey]: Date.now() + 90 * 24 * 60 * 60 * 1000 });
      }
      if (pageUrl.searchParams.get("ackdisabled") === "1") {
        await extensionApi.storage.local.set({ [disabledKey]: true });
      }
      if (pageUrl.searchParams.get("acklegacy") === "1") {
        await extensionApi.storage.local.set({ existingUserSetting: true });
      }
      const stored = await extensionApi.storage.local.get([nextKey, disabledKey]);
      const show = stored[disabledKey] !== true && Number(stored[nextKey] || 0) <= Date.now();
      if (show) {
        await extensionApi.storage.local.set({ [nextKey]: Date.now() + 90 * 24 * 60 * 60 * 1000 });
      }
      return {
        show,
        prompt: "Publishing work that used OverCite? Please consider acknowledging it!",
        acknowledgmentText: "This work made use of \\\\texttt{OverCite} \\\\citep{Shariat2026}, an in-editor citation tool for \\\\LaTeX."
      };
    }
    case "disableAcknowledgmentReminder":
      await extensionApi.storage.local.set({ acknowledgmentReminderDisabled: true });
      return true;
    default:
      throw new Error(\`Unexpected test message: \${message?.type}\`);
  }
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
`;

async function prepareExtension(root) {
  const extensionDir = join(root, "extension");
  await cp(firefoxDistPath, extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const localMatches = ["http://127.0.0.1/*"];
  manifest.host_permissions = localMatches;
  manifest.content_scripts[0].matches = localMatches;
  manifest.web_accessible_resources[0].matches = localMatches;
  manifest.background.scripts = ["src/test-background.js"];
  manifest.background.service_worker = "src/test-background.js";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(extensionDir, "src", "test-background.js"), backgroundStub);
  const contentScriptPath = join(extensionDir, "src", "content-script.js");
  const contentScriptSource = await readFile(contentScriptPath, "utf8");
  await writeFile(contentScriptPath, contentScriptSource.replace(
    "  installUserFileNavigationTracking();",
    `  installUserFileNavigationTracking();
  window.addEventListener("EZCITE_TEST_POINTER_STRESS", () => {
    const target = document.getElementById("unrelated-control");
    const startedAt = performance.now();
    for (let index = 0; index < 2000; index += 1) {
      recordUserFileNavigation({ isTrusted: true, target });
    }
    document.documentElement.dataset.overcitePointerStressMs = String(performance.now() - startedAt);
    document.documentElement.dataset.overcitePointerStressSerial = String(
      Number(document.documentElement.dataset.overcitePointerStressSerial || 0) + 1
    );
  });`
  ));
  const bridgePath = join(extensionDir, "src", "page-bridge.js");
  const bridgeSource = await readFile(bridgePath, "utf8");
  await writeFile(bridgePath, bridgeSource.replace(
    'function emitResponse(requestId, response, action = "") {',
    `async function emitResponse(requestId, response, action = "") {
    if (new URLSearchParams(location.search).get("lateack") === "1") {
      const rangeCount = action === "replaceRange"
        ? Number(document.documentElement.dataset.overciteDelayedRangeCount || 0) + 1
        : 0;
      if (rangeCount) document.documentElement.dataset.overciteDelayedRangeCount = String(rangeCount);
      const collision = new URLSearchParams(location.search).get("collision") === "1";
      const delayMs = action === "replaceRange"
        ? (collision && rangeCount > 1 ? 5200 : 3200)
        : (action === "replaceDocument" ? 5200 : 0);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }`
  ));
  return extensionDir;
}

async function startFixtureServer() {
  const fixtureHtml = await readFile(fixturePath);
  let resolveResult = null;
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/project/current-ui")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixtureHtml);
      return;
    }
    if (request.url === "/test-result" && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try {
          resolveResult?.(JSON.parse(body));
        } catch (error) {
          resolveResult?.({ ok: false, error: `Invalid Firefox fixture result: ${error.message}` });
        }
        response.writeHead(204);
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    waitForResult(timeoutMs = 25000) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for the Firefox fixture result")), timeoutMs);
        resolveResult = (result) => {
          clearTimeout(timeoutId);
          resolveResult = null;
          resolve(result);
        };
      });
    }
  };
}

async function runFirefox({ extensionDir, pageUrl, waitForResult }) {
  const args = [
    "--yes",
    "web-ext@10.6.0",
    "run",
    "--source-dir", extensionDir,
    "--firefox", firefoxBinary,
    "--no-reload",
    "--no-input",
    "--start-url", pageUrl
  ];
  const child = spawn("npx", args, {
    cwd: extensionDir,
    env: { ...process.env, MOZ_HEADLESS: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("close", (code) => resolve({ code })));
  try {
    const result = await Promise.race([
      waitForResult,
      exited.then(({ code }) => {
        throw new Error(`Firefox/web-ext exited with ${code} before the fixture completed:\n${output}`);
      })
    ]);
    return { result, output };
  } catch (error) {
    throw new Error(`${error.message}\nFirefox/web-ext output:\n${output}`, { cause: error });
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGINT");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 4000))
      ]);
      if (child.exitCode == null) {
        child.kill("SIGTERM");
      }
    }
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "overcite-firefox-regression-"));
const fixture = await startFixtureServer();
try {
  const address = fixture.server.address();
  assert.ok(address && typeof address === "object");
  const extensionDir = await prepareExtension(temporaryRoot);
  const requestedScenarioIds = new Set(
    (process.argv.find((argument) => argument.startsWith("--scenarios="))?.split("=")[1] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const scenarios = [
    { id: "soak-return", name: `${soakCycles}-cycle large bibliography session returning to source`, query: `return=1&soak=${soakCycles}`, soak:true },
    { id: "soak-stay", name: `${soakCycles}-cycle large bibliography session staying in bibliography`, query: `return=0&soak=${soakCycles}`, soak:true },
    { id: "counts-select", name: "selection does not wait for citation counts", query: "return=1&counts=select" },
    { id: "counts-finish", name: "citation count updates preserve click targets", query: "return=0&counts=finish" },
    { id: "counts-refine", name: "refined results are selectable before citation counts", query: "return=0&empty=1&counts=refine" },
    { id: "preview-select", name: "contextual search publishes a single ranked list", query: "return=0&empty=1&preview=select" },
    { id: "abstract", name: "abstract disclosure does not select a paper", query: "return=0&abstract=1" },
    { id: "many-results", name: "long result lists retain readable titles and scroll", query: "return=0&manyresults=1" },
    { id: "stale-settings", name: "settings change rejects displayed and late results", query: "return=0&stale=settings" },
    { id: "stale-context", name: "editor input rejects displayed and late results", query: "return=0&stale=context" },
    { id: "popup-settings", name: "popup header opens settings", query: "return=0&popupsettings=1", settingsRedirect: true },
    { id: "permission-gesture", name: "Firefox permission error opens settings", query: "return=0&onboarding=1&onboardastro=1&permissiongesture=1", settingsRedirect: true, automaticSettingsRedirect: true },
    { id: "preview-refine", name: "contextual refinement preserves card positions", query: "return=0&empty=1&preview=refine" },
    { id: "preview-narrow", name: "narrow contextual refinement preserves geometry", query: "return=0&empty=1&preview=refine&narrow=1" },
    { id: "preview-fail", name: "contextual refinement failure preserves selectable results", query: "return=0&empty=1&preview=fail" },
    { id: "onboarding-astro-redirect", name: "Astronomy onboarding opens token settings automatically", query: "return=0&onboarding=1&onboardastro=1", settingsRedirect: true, automaticSettingsRedirect: true },
    { id: "settings-redirect", name: "missing ADS token redirects to settings", query: "return=0&missingtoken=1&settingsredirect=1", settingsRedirect: true },
    { id: "retry", name: "Try again recovers from a failed lookup", query: "return=0&retry=1", retryLookup: true },
    { id: "default-ordering", name: "default bibliography insertion is alphabetical", query: "return=0&ordering=1", bibliographyOrder: "alphabetical" },
    { id: "append-ordering", name: "explicit append bibliography preference is preserved", query: "return=0&ordering=1&insertmode=append", bibliographyOrder: "append" },
    { id: "current-stay", name: "current Overleaf persistent editor stays in bibliography", query: "return=0&persistent=1&uncontrolled=1", persistentEditor: true, uncontrolledTabs: true },
    { id: "current-return", name: "current Overleaf persistent editor returns to source", query: "return=1&persistent=1&uncontrolled=1", persistentEditor: true, uncontrolledTabs: true },
    { id: "current-delayed", name: "current Overleaf delayed persistent editor transition", query: "return=0&persistent=1&uncontrolled=1&transition=delayed", persistentEditor: true, uncontrolledTabs: true, delayedTransition: true },
    { id: "tree-guard", name: "file-tree fallback preserves the editor-transition guard", query: "return=0&persistent=1&uncontrolled=1&treeonly=1&transition=stuck", persistentEditor: true, uncontrolledTabs: true, manualBibSwitch: true, treeOnlyTarget: true, stuckTransition: true },
    { id: "stale-blank", name: "selected bibliography tab rejects a stale blank persistent document", query: "return=0&persistent=1&uncontrolled=1&treeonly=1&transition=wrongblank", persistentEditor: true, uncontrolledTabs: true, manualBibSwitch: true, treeOnlyTarget: true, staleBlankTransition: true },
    { id: "stay", name: "stay in bibliography", query: "return=0" },
    { id: "return", name: "return to source", query: "return=1" },
    { id: "stress", name: "prior pointer-slowdown stress", query: "return=0&firefoxstress=1", pointerStress: true },
    { id: "empty", name: "empty citation uses contextual mode", query: "return=0&empty=1", emptyCitation: true },
    { id: "subject-onboarding", name: "required subject onboarding gates lookup", query: "return=0&onboarding=1", subjectOnboarding: true },
    { id: "delayed", name: "delayed CodeMirror transition", query: "return=0&transition=delayed", delayedTransition: true },
    { id: "nameless", name: "missing active filename requires confirmation", query: "return=0&nameless=1&manualbib=1", namelessTabs: true, manualBibSwitch: true },
    { id: "wrongblank", name: "unidentified blank editor requires manual target selection", query: "return=0&nameless=1&wrongblank=1", namelessTabs: true, manualBibSwitch: true, wrongBlankEditor: true },
    { id: "lateack", name: "late successful write acknowledgments are idempotent", query: "return=0&lateack=1&collision=1", lateWriteAcknowledgments: true, keyCollision: true },
    { id: "manual", name: "verified manual bibliography continuation", query: "return=0&manualbib=1", manualBibSwitch: true },
    { id: "manualrace", name: "manual bibliography identity survives navigation race", query: "return=0&nameless=1&manualrace=1", manualBibSwitch: true, manualEditorRace: true },
    { id: "ack-first", name: "first 90-day acknowledgment reminder", query: "return=1&acklegacy=1&ackexpect=show&ackdismiss=1", acknowledgmentVisible: true, acknowledgmentDismissed: true, acknowledgmentActions: true },
    { id: "ack-future", name: "acknowledgment remains suppressed before 90 days", query: "return=1&ackfuture=1&ackexpect=hide", acknowledgmentVisible: false },
    { id: "ack-never", name: "acknowledgment permanent opt-out", query: "return=1&ackexpect=show&acknever=1", acknowledgmentVisible: true, acknowledgmentOptedOut: true, acknowledgmentActions: true },
    { id: "ack-disabled", name: "disabled acknowledgment remains suppressed", query: "return=1&ackdisabled=1&ackexpect=hide", acknowledgmentVisible: false },
    { id: "ack-failure", name: "acknowledgment storage failure does not affect insertion", query: "return=1&ackfail=1&ackexpect=hide", acknowledgmentVisible: false }
  ].filter((scenario) => !requestedScenarioIds.size || requestedScenarioIds.has(scenario.id));
  assert.ok(scenarios.length > 0, "No matching Firefox regression scenarios were selected.");
  for (const scenario of scenarios) {
    const pageUrl = `http://127.0.0.1:${address.port}/project/current-ui?${scenario.query}&autorun=1`;
    const firefoxRun = await runFirefox({
      extensionDir,
      pageUrl,
      waitForResult: fixture.waitForResult(scenario.soak ? soakWaitBudgetMs : 25000)
    });
    const result = firefoxRun.result;
    assert.equal(result.ok, true, `${JSON.stringify(result, null, 2)}\nFirefox output:\n${firefoxRun.output}`);
    if (scenario.soak) {
      assert.equal(result.cycles, soakCycles);
      assert.equal(result.bibliographyEntries, 2001);
      assert.equal(result.unrelatedTextReads, 0);
      assert.deepEqual(result.unexpectedErrors, []);
      console.log(`Firefox ${scenario.name}: PASS ${JSON.stringify(result)}`);
      continue;
    }
    if (scenario.settingsRedirect) {
      assert.equal(result.settingsRedirect, true);
      assert.equal(result.retryActionAbsent, true);
      if (scenario.automaticSettingsRedirect) {
        assert.equal(result.automaticSettingsRedirect, true);
        assert.equal(result.subjectPromptVisible, true);
        assert.equal(result.lookupBlockedBeforeSubject, true);
      }
      console.log(`Firefox ${scenario.name}: PASS`);
      continue;
    }
    assert.equal(result.activeFile, scenario.query.includes("return=1") ? "main.tex" : "references.bib");
    assert.equal(result.sourceHasRice, true);
    assert.equal(result.bibliographyHasRice, true);
    assert.deepEqual(result.unexpectedErrors, []);
    const insertionLimitMs = scenario.lateWriteAcknowledgments ? 18000 : 10000;
    assert.ok(result.insertionElapsedMs < insertionLimitMs, `slow Firefox insertion: ${result.insertionElapsedMs} ms`);
    if (scenario.delayedTransition) {
      assert.equal(result.bibActivationClicks, 1);
    }
    if (scenario.persistentEditor) {
      assert.equal(result.persistentEditor, true);
    }
    if (scenario.uncontrolledTabs) {
      assert.equal(result.uncontrolledTabs, true);
    }
    if (scenario.treeOnlyTarget) {
      assert.equal(result.treeOnlyTarget, true);
    }
    if (scenario.stuckTransition) {
      assert.equal(result.stuckTransition, true);
    }
    if (scenario.staleBlankTransition) {
      assert.equal(result.staleBlankTransition, true);
      assert.equal(result.notesTextUnchanged, true);
    }
    if (scenario.namelessTabs) {
      assert.equal(result.namelessTabs, true);
    }
    if (scenario.emptyCitation) {
      assert.equal(result.emptyCitation, true);
    }
    if (scenario.subjectOnboarding) {
      assert.equal(result.subjectPromptVisible, true);
      assert.equal(result.lookupBlockedBeforeSubject, true);
    }
    if (scenario.retryLookup) {
      assert.equal(result.retryWorked, true);
      assert.deepEqual(result.retryActionLabels, ["Try again", "Contextual search", "Raw query"]);
    }
    if (scenario.bibliographyOrder) {
      assert.equal(result.orderingFixture, true);
      assert.equal(result.expectedAppendOrder, scenario.bibliographyOrder === "append");
      assert.equal(result.bibliographyOrderCorrect, true);
    }
    if (scenario.manualBibSwitch) {
      assert.equal(result.invalidManualRejected, true);
    }
    if (scenario.wrongBlankEditor) {
      assert.equal(result.notesTextUnchanged, true);
    }
    if (scenario.lateWriteAcknowledgments) {
      assert.equal(result.lateWriteAcknowledgments, true);
    }
    if (scenario.keyCollision) {
      assert.equal(result.keyCollision, true);
      assert.equal(result.delayedRangeCount, 2);
    }
    if (scenario.manualEditorRace) {
      assert.equal(result.manualEditorRace, true);
      assert.equal(result.notesTextUnchanged, true);
    }
    if (scenario.pointerStress) {
      assert.ok(result.idlePointerStressMs < 250, `slow Firefox idle pointer stress: ${result.idlePointerStressMs} ms`);
      assert.ok(result.insertionPointerStressMs < 250, `slow Firefox insertion pointer stress: ${result.insertionPointerStressMs} ms`);
    }
    if (typeof scenario.acknowledgmentVisible === "boolean") {
      assert.equal(result.acknowledgmentReminderVisible, scenario.acknowledgmentVisible);
    }
    if (scenario.acknowledgmentDismissed) {
      assert.equal(result.acknowledgmentDismissed, true);
    }
    if (scenario.acknowledgmentActions) {
      assert.deepEqual(result.acknowledgmentActionLabels, [
        "Copy acknowledgment",
        "Remind me later",
        "Never remind me"
      ]);
      assert.equal(
        result.acknowledgmentPromptText,
        "Publishing work that used OverCite? Please consider acknowledging it!"
      );
    }
    if (scenario.acknowledgmentOptedOut) {
      assert.equal(result.acknowledgmentOptedOut, true);
    }
    const stressSummary = scenario.pointerStress
      ? `; 2,000 idle calls ${result.idlePointerStressMs.toFixed(2)} ms, 2,000 insertion calls ${result.insertionPointerStressMs.toFixed(2)} ms`
      : "";
    console.log(`Firefox ${scenario.name}: PASS (${result.insertionElapsedMs} ms${stressSummary})`);
  }
} finally {
  await new Promise((resolve) => fixture.server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}

function readSoakCycles() {
  const raw = process.argv.find((argument) => argument.startsWith("--soak-cycles="))?.split("=", 2)[1] ?? "30";
  const cycles = Number(raw);
  assert.ok(Number.isSafeInteger(cycles) && cycles > 0, `--soak-cycles must be a positive integer; got ${raw}`);
  return cycles;
}
