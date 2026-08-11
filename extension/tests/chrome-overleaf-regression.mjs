import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const chromeBinary = process.env.CHROME_BIN || chromium.executablePath();
const fixturePath = new URL("./fixtures/overleaf-current-ui.html", import.meta.url);
const chromeDistPath = new URL("../dist/chrome/", import.meta.url);
const backgroundStub = `
import { applyBibInsertion } from "./core/bibtex.js";

const candidate = {
  sourceId: "ads",
  sourceLabel: "ADS/SciX",
  bibcode: "2021ApJ...922...47R",
  title: "The Chandra Survey of M51",
  authors: ["Rice, Thomas S.", "Smith, Jane Q."],
  year: 2021,
  abstract: "A synthetic Rice 2021 result used only by the Chrome regression fixture.",
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
      {
        const pageUrl = new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/");
        if (pageUrl.searchParams.get("manual") === "1") {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (pageUrl.searchParams.get("stress") === "1") {
          await new Promise((resolve) => setTimeout(resolve, 1800));
        }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
`;

async function prepareExtension(root) {
  const extensionDir = join(root, "extension");
  await cp(chromeDistPath, extensionDir, { recursive: true });
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const localMatches = ["http://127.0.0.1/*"];
  manifest.host_permissions = localMatches;
  manifest.content_scripts[0].matches = localMatches;
  manifest.web_accessible_resources[0].matches = localMatches;
  manifest.background.service_worker = "src/test-background.js";
  delete manifest.browser_specific_settings;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(extensionDir, "src", "test-background.js"), backgroundStub);
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
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/project/current-ui")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixtureHtml);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

async function runChrome({ extensionDir, profileDir, pageUrl }) {
  const pageParameters = new URL(pageUrl).searchParams;
  const manualNavigation = pageParameters.get("manual") === "1";
  const interactionStress = pageParameters.get("stress") === "1";
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--enable-logging=stderr",
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--window-size=1400,900",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    pageUrl
  ];
  const appleSilicon = process.platform === "darwin"
    && execFileSync("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], { encoding: "utf8" }).trim() === "1";
  const command = appleSilicon ? "/usr/bin/arch" : chromeBinary;
  const commandArgs = appleSilicon ? ["-arm64", chromeBinary, ...args] : args;
  const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let exitCode = null;
  child.once("close", (code) => { exitCode = code; });
  try {
    const portFile = join(profileDir, "DevToolsActivePort");
    const portText = await waitForValue(async () => {
      try {
        return await readFile(portFile, "utf8");
      } catch {
        if (exitCode !== null) {
          throw new Error(`Chrome exited with ${exitCode}:\n${stderr}`);
        }
        return "";
      }
    }, 10000, "Chrome DevTools port");
    const port = Number(portText.split(/\r?\n/)[0]);
    assert.ok(Number.isFinite(port), `Invalid Chrome DevTools port: ${portText}`);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      const page = await waitForValue(
        () => browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url() === pageUrl),
        10000,
        "fixture page target"
      );
      await page.waitForFunction(() => Boolean(window.__OVERCITE_PAGE_BRIDGE_READY__), null, { timeout: 10000 });
      const idleStressStartedAt = Date.now();
      const idleClickCount = interactionStress ? 75 : 1;
      for (let index = 0; index < idleClickCount; index += 1) {
        await page.locator("#unrelated-control").click();
      }
      const idleStressElapsedMs = Date.now() - idleStressStartedAt;
      let unrelatedTextReads = await page.evaluate(() => window.__OVERCITE_UNRELATED_TEXT_READS__);
      assert.equal(
        unrelatedTextReads,
        0,
        "idle clicks in a large PDF/grammar subtree must not inspect ancestor text"
      );
      await page.evaluate(() => { window.__OVERCITE_START_REGRESSION__ = true; });
      let insertionStressElapsedMs = 0;
      if (manualNavigation || interactionStress) {
        await page.waitForFunction(
          () => Boolean(window.__OVERCITE_INSERTION_STARTED__),
          null,
          { timeout: 5000 }
        );
      }
      if (manualNavigation) {
        await page.locator("#old-tab").click();
      }
      if (interactionStress) {
        const insertionStressStartedAt = Date.now();
        for (let index = 0; index < 50; index += 1) {
          await page.locator("#unrelated-control").click();
        }
        insertionStressElapsedMs = Date.now() - insertionStressStartedAt;
        unrelatedTextReads = await page.evaluate(() => window.__OVERCITE_UNRELATED_TEXT_READS__);
        assert.equal(
          unrelatedTextReads,
          0,
          "insertion-time clicks in a large PDF/grammar subtree must not inspect ancestor text"
        );
      }
      try {
        await page.waitForFunction(
          () => Boolean(document.getElementById("test-result")?.dataset.payload),
          null,
          { timeout: 25000 }
        );
      } catch (error) {
        const pageState = await page.evaluate(() => ({
          bridgeReady: Boolean(window.__OVERCITE_PAGE_BRIDGE_READY__),
          overlayText: document.getElementById("ezcite-root")?.textContent?.trim() || "",
          toastText: document.getElementById("ezcite-toast")?.textContent?.trim() || "",
          resultText: document.getElementById("test-result")?.textContent || "",
          readyState: document.readyState
        }));
        const workers = browser.contexts()
          .flatMap((context) => context.serviceWorkers())
          .map((worker) => worker.url());
        throw new Error(`${error.message}\nPage state: ${JSON.stringify(pageState)}\nService workers: ${JSON.stringify(workers)}\nChrome stderr:\n${stderr}`);
      }
      const payload = await page.locator("#test-result").getAttribute("data-payload");
      const workers = browser.contexts()
        .flatMap((context) => context.serviceWorkers())
        .map((worker) => worker.url());
      return {
        payload,
        workers,
        stderr,
        unrelatedTextReads,
        idleClickCount,
        idleStressElapsedMs,
        insertionStressElapsedMs
      };
    } finally {
      await browser.close();
    }
  } finally {
    if (exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const forceKill = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        child.once("close", () => {
          clearTimeout(forceKill);
          resolve();
        });
      });
    }
  }
}

async function waitForValue(producer, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await producer();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${label}`);
}

function parseFixtureResult(payload) {
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "overcite-chrome-regression-"));
const server = await startFixtureServer();
try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const extensionDir = await prepareExtension(temporaryRoot);
  for (const shouldReturn of [false, true]) {
    const profileDir = join(temporaryRoot, shouldReturn ? "profile-return" : "profile-stay");
    const pageUrl = `http://127.0.0.1:${address.port}/project/current-ui?return=${shouldReturn ? 1 : 0}`;
    const chromeResult = await runChrome({ extensionDir, profileDir, pageUrl });
    const result = parseFixtureResult(chromeResult.payload);
    assert.equal(result.ok, true, `${JSON.stringify(result, null, 2)}\nService workers: ${JSON.stringify(chromeResult.workers)}\nChrome stderr:\n${chromeResult.stderr}`);
    assert.equal(result.activeFile, shouldReturn ? "main.tex" : "references.bib");
    assert.equal(result.sourceHasRice, true);
    assert.equal(result.bibliographyHasRice, true);
    assert.equal(result.oldTextUnchanged, true);
    assert.deepEqual(result.observedErrors, []);
    assert.equal(chromeResult.unrelatedTextReads, 0);
    console.log(`Chrome returnToSourceAfterInsert=${shouldReturn}: PASS (${result.activeFile}; idle unrelated DOM reads=0)`);
  }
  const manualProfileDir = join(temporaryRoot, "profile-manual-navigation");
  const manualPageUrl = `http://127.0.0.1:${address.port}/project/current-ui?return=1&manual=1`;
  const manualChromeResult = await runChrome({
    extensionDir,
    profileDir: manualProfileDir,
    pageUrl: manualPageUrl
  });
  const manualResult = parseFixtureResult(manualChromeResult.payload);
  assert.equal(manualResult.ok, true, JSON.stringify(manualResult, null, 2));
  assert.equal(manualResult.manualNavigation, true);
  assert.equal(manualResult.activeFile, "old_text.tex");
  assert.equal(manualResult.sourceHasRice, true);
  assert.equal(manualResult.bibliographyHasRice, true);
  assert.deepEqual(manualResult.observedErrors, []);
  assert.equal(manualChromeResult.unrelatedTextReads, 0);
  console.log("Chrome user navigation during insertion: PASS (old_text.tex retained)");

  const transitionScenarios = [
    {
      name: "current Overleaf persistent editor stays in bibliography",
      query: "return=0&persistent=1&uncontrolled=1",
      verify(result) {
        assert.equal(result.persistentEditor, true);
        assert.equal(result.uncontrolledTabs, true);
      }
    },
    {
      name: "current Overleaf persistent editor returns to source",
      query: "return=1&persistent=1&uncontrolled=1",
      verify(result) {
        assert.equal(result.persistentEditor, true);
        assert.equal(result.uncontrolledTabs, true);
      }
    },
    {
      name: "current Overleaf delayed persistent editor transition",
      query: "return=0&persistent=1&uncontrolled=1&transition=delayed",
      verify(result) {
        assert.equal(result.persistentEditor, true);
        assert.equal(result.uncontrolledTabs, true);
        assert.equal(result.delayedTransition, true);
        assert.equal(result.bibActivationClicks, 1);
      }
    },
    {
      name: "file-tree fallback preserves the editor-transition guard",
      query: "return=0&persistent=1&uncontrolled=1&treeonly=1&transition=stuck",
      verify(result) {
        assert.equal(result.persistentEditor, true);
        assert.equal(result.uncontrolledTabs, true);
        assert.equal(result.treeOnlyTarget, true);
        assert.equal(result.stuckTransition, true);
        assert.equal(result.invalidManualRejected, true);
      }
    },
    {
      name: "selected bibliography tab rejects a stale blank persistent document",
      query: "return=0&persistent=1&uncontrolled=1&treeonly=1&transition=wrongblank",
      verify(result) {
        assert.equal(result.persistentEditor, true);
        assert.equal(result.uncontrolledTabs, true);
        assert.equal(result.treeOnlyTarget, true);
        assert.equal(result.staleBlankTransition, true);
        assert.equal(result.invalidManualRejected, true);
        assert.equal(result.notesTextUnchanged, true);
      }
    },
    {
      name: "prior idle-pointer slowdown stress",
      query: "return=0&stress=1",
      verify(result, chromeResult) {
        assert.equal(chromeResult.unrelatedTextReads, 0);
        assert.equal(chromeResult.idleClickCount, 75);
        assert.ok(chromeResult.idleStressElapsedMs < 8000, `slow idle click stress: ${chromeResult.idleStressElapsedMs} ms`);
        assert.ok(chromeResult.insertionStressElapsedMs < 8000, `slow insertion click stress: ${chromeResult.insertionStressElapsedMs} ms`);
      }
    },
    {
      name: "empty citation uses contextual mode",
      query: "return=0&empty=1",
      verify(result) {
        assert.equal(result.emptyCitation, true);
      }
    },
    {
      name: "delayed CodeMirror transition",
      query: "return=0&transition=delayed",
      verify(result) {
        assert.equal(result.delayedTransition, true);
        assert.equal(result.bibActivationClicks, 1, "a delayed editor transition must not trigger repeated file clicks");
      }
    },
    {
      name: "missing active filename",
      query: "return=0&nameless=1&manualbib=1",
      verify(result) {
        assert.equal(result.namelessTabs, true);
        assert.equal(result.invalidManualRejected, true);
      }
    },
    {
      name: "unidentified blank editor requires manual target selection",
      query: "return=0&nameless=1&wrongblank=1",
      verify(result) {
        assert.equal(result.wrongBlankEditor, true);
        assert.equal(result.invalidManualRejected, true);
        assert.equal(result.notesTextUnchanged, true);
      }
    },
    {
      name: "late successful write acknowledgments are idempotent",
      query: "return=0&lateack=1&collision=1",
      verify(result) {
        assert.equal(result.lateWriteAcknowledgments, true);
        assert.equal(result.keyCollision, true);
        assert.equal(result.delayedRangeCount, 2);
      }
    },
    {
      name: "verified manual bibliography continuation",
      query: "return=0&manualbib=1",
      verify(result) {
        assert.equal(result.manualBibSwitch, true);
        assert.equal(result.invalidManualRejected, true);
      }
    },
    {
      name: "manual bibliography identity survives navigation race",
      query: "return=0&nameless=1&manualrace=1",
      verify(result) {
        assert.equal(result.manualEditorRace, true);
        assert.equal(result.notesTextUnchanged, true);
      }
    }
  ];
  for (const scenario of transitionScenarios) {
    const scenarioProfileDir = join(temporaryRoot, `profile-${scenario.name.replace(/[^a-z]+/gi, "-").toLowerCase()}`);
    const scenarioUrl = `http://127.0.0.1:${address.port}/project/current-ui?${scenario.query}`;
    const scenarioChromeResult = await runChrome({
      extensionDir,
      profileDir: scenarioProfileDir,
      pageUrl: scenarioUrl
    });
    const scenarioResult = parseFixtureResult(scenarioChromeResult.payload);
    assert.equal(scenarioResult.ok, true, JSON.stringify(scenarioResult, null, 2));
    assert.equal(scenarioResult.activeFile, scenario.query.includes("return=1") ? "main.tex" : "references.bib");
    assert.equal(scenarioResult.sourceHasRice, true);
    assert.equal(scenarioResult.bibliographyHasRice, true);
    assert.deepEqual(scenarioResult.unexpectedErrors, []);
    const insertionLimitMs = scenario.query.includes("lateack=1") ? 18000 : 10000;
    assert.ok(scenarioResult.insertionElapsedMs < insertionLimitMs, `slow bounded insertion: ${scenarioResult.insertionElapsedMs} ms`);
    scenario.verify(scenarioResult, scenarioChromeResult);
    const stressSummary = scenario.query.includes("stress=1")
      ? `; 75 idle clicks ${scenarioChromeResult.idleStressElapsedMs} ms, 50 insertion clicks ${scenarioChromeResult.insertionStressElapsedMs} ms, DOM text reads 0`
      : "";
    console.log(`Chrome ${scenario.name}: PASS (${scenarioResult.insertionElapsedMs} ms${stressSummary})`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}
