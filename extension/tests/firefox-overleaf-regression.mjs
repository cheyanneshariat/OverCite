import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const firefoxBinary = process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox";
const fixturePath = new URL("./fixtures/overleaf-current-ui.html", import.meta.url);
const firefoxDistPath = new URL("../dist/firefox/", import.meta.url);
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

function settingsForSender(sender) {
  const pageUrl = new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/");
  return {
    adsApiToken: "",
    sourceProfile: "astrophysics",
    primarySource: "ads",
    fallbackSources: [],
    sourceApiTokens: {},
    defaultProjectBibFileOverride: {},
    contextWindowChars: 500,
    shortcutHelpText: "Alt+Shift+E",
    themeMode: "auto",
    returnToSourceAfterInsert: pageUrl.searchParams.get("return") === "1",
    citationKeyMode: "authoryear",
    bibliographyInsertMode: "append",
    defaultSearchMode: "simple"
  };
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "getSettings":
      return settingsForSender(sender);
    case "searchAds":
      if (message.citationContext.searchMode !== (message.citationContext.token.trim() ? "simple" : "contextual")) {
        throw new Error("Unexpected search mode: " + message.citationContext.searchMode);
      }
      return [candidate];
    case "resolveBibTarget":
      return { status: "resolved", target: "references.bib", candidates: ["references.bib"] };
    case "exportBibtex":
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
    { id: "current-stay", name: "current Overleaf persistent editor stays in bibliography", query: "return=0&persistent=1&uncontrolled=1", persistentEditor: true, uncontrolledTabs: true },
    { id: "current-return", name: "current Overleaf persistent editor returns to source", query: "return=1&persistent=1&uncontrolled=1", persistentEditor: true, uncontrolledTabs: true },
    { id: "current-delayed", name: "current Overleaf delayed persistent editor transition", query: "return=0&persistent=1&uncontrolled=1&transition=delayed", persistentEditor: true, uncontrolledTabs: true, delayedTransition: true },
    { id: "tree-guard", name: "file-tree fallback preserves the editor-transition guard", query: "return=0&persistent=1&uncontrolled=1&treeonly=1&transition=stuck", persistentEditor: true, uncontrolledTabs: true, manualBibSwitch: true, treeOnlyTarget: true, stuckTransition: true },
    { id: "stale-blank", name: "selected bibliography tab rejects a stale blank persistent document", query: "return=0&persistent=1&uncontrolled=1&treeonly=1&transition=wrongblank", persistentEditor: true, uncontrolledTabs: true, manualBibSwitch: true, treeOnlyTarget: true, staleBlankTransition: true },
    { id: "stay", name: "stay in bibliography", query: "return=0" },
    { id: "return", name: "return to source", query: "return=1" },
    { id: "stress", name: "prior pointer-slowdown stress", query: "return=0&firefoxstress=1", pointerStress: true },
    { id: "empty", name: "empty citation uses contextual mode", query: "return=0&empty=1", emptyCitation: true },
    { id: "delayed", name: "delayed CodeMirror transition", query: "return=0&transition=delayed", delayedTransition: true },
    { id: "nameless", name: "missing active filename requires confirmation", query: "return=0&nameless=1&manualbib=1", namelessTabs: true, manualBibSwitch: true },
    { id: "wrongblank", name: "unidentified blank editor requires manual target selection", query: "return=0&nameless=1&wrongblank=1", namelessTabs: true, manualBibSwitch: true, wrongBlankEditor: true },
    { id: "lateack", name: "late successful write acknowledgments are idempotent", query: "return=0&lateack=1&collision=1", lateWriteAcknowledgments: true, keyCollision: true },
    { id: "manual", name: "verified manual bibliography continuation", query: "return=0&manualbib=1", manualBibSwitch: true }
    ,{ id: "manualrace", name: "manual bibliography identity survives navigation race", query: "return=0&nameless=1&manualrace=1", manualBibSwitch: true, manualEditorRace: true }
  ].filter((scenario) => !requestedScenarioIds.size || requestedScenarioIds.has(scenario.id));
  assert.ok(scenarios.length > 0, "No matching Firefox regression scenarios were selected.");
  for (const scenario of scenarios) {
    const pageUrl = `http://127.0.0.1:${address.port}/project/current-ui?${scenario.query}&autorun=1`;
    const firefoxRun = await runFirefox({
      extensionDir,
      pageUrl,
      waitForResult: fixture.waitForResult()
    });
    const result = firefoxRun.result;
    assert.equal(result.ok, true, `${JSON.stringify(result, null, 2)}\nFirefox output:\n${firefoxRun.output}`);
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
    const stressSummary = scenario.pointerStress
      ? `; 2,000 idle calls ${result.idlePointerStressMs.toFixed(2)} ms, 2,000 insertion calls ${result.insertionPointerStressMs.toFixed(2)} ms`
      : "";
    console.log(`Firefox ${scenario.name}: PASS (${result.insertionElapsedMs} ms${stressSummary})`);
  }
} finally {
  await new Promise((resolve) => fixture.server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}
