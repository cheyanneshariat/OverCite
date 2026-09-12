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
const soakCycles = readSoakCycles();
const soakWaitBudgetMs = Math.max(180000, Math.ceil((soakCycles / 30) * 180000));
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
        await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: message.requestId, results: [candidate] });
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (pageUrl.searchParams.get("stale") === "settings") await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:settingsChanged" });
        await new Promise((resolve) => setTimeout(resolve, 400));
        await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: message.requestId, results: [{ ...candidate, title: "STALE" }] });
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
        if (ready.length > 1) await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchProgress", requestId: message.requestId, revision: 1, results: [plain] });
        await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: "stale", results: [{ ...plain, title: "STALE" }] });
        await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchReady", requestId: message.requestId, results: ready });
        await Promise.race([new Promise((resolve) => { release = resolve; }), new Promise((resolve) => setTimeout(resolve, 1500))]);
        return ready.map((result) => ({ ...result, citationCount: 987 }));
      }
      if (pageUrl.searchParams.has("preview")) {
        let release;
        const pending = { cancelled: false, release: () => release?.() };
        pendingPreviews.set(sender.tab.id, pending);
        await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchProgress", requestId: "stale", revision: 1, results: [{ ...candidate, title: "STALE" }] });
        await chrome.tabs.sendMessage(sender.tab.id, { type: "ezcite:searchProgress", requestId: message.requestId, revision: 1, results: [candidate] });
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
        await chrome.storage.local.set({ [nextKey]: Date.now() + 90 * 24 * 60 * 60 * 1000 });
      }
      if (pageUrl.searchParams.get("ackdisabled") === "1") {
        await chrome.storage.local.set({ [disabledKey]: true });
      }
      if (pageUrl.searchParams.get("acklegacy") === "1") {
        await chrome.storage.local.set({ existingUserSetting: true });
      }
      const stored = await chrome.storage.local.get([nextKey, disabledKey]);
      const show = stored[disabledKey] !== true && Number(stored[nextKey] || 0) <= Date.now();
      if (show) {
        await chrome.storage.local.set({ [nextKey]: Date.now() + 90 * 24 * 60 * 60 * 1000 });
      }
      return {
        show,
        prompt: "Publishing work that used OverCite? Please consider acknowledging it!",
        acknowledgmentText: "This work made use of \\\\texttt{OverCite} \\\\citep{Shariat2026}, an in-editor citation tool for \\\\LaTeX."
      };
    }
    case "disableAcknowledgmentReminder":
      await chrome.storage.local.set({ acknowledgmentReminderDisabled: true });
      return true;
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
  // Opt-in, temporary-copy-only diagnostics. Never ship state tracing or source text.
  if (process.env.OVERCITE_SOAK_TRACE === "1") {
    const contentPath = join(extensionDir, "src", "content-script.js");
    let content = await readFile(contentPath, "utf8");
    const traceAnchor = /  function debugTrace\(\) \{[\s\S]*?\n  \}/;
    assert.match(content, traceAnchor);
    content = content.replace(traceAnchor, `  const soakTrace = [];
  function debugTrace(event) {
    soakTrace.push({ event, at: Math.round(performance.now()) });
    if (soakTrace.length > 200) soakTrace.shift();
    document.documentElement.dataset.overciteSoakTrace = JSON.stringify(soakTrace);
  }`);
    for (const [before, after] of [
      ['      queueLookupAfterInsertion(searchMode);', '      debugTrace("lookup:queued");\n      queueLookupAfterInsertion(searchMode);'],
      ['    insertionInProgress = true;', '    insertionInProgress = true;\n    debugTrace("insertion:start");'],
      ['      insertionInProgress = false;', '      insertionInProgress = false;\n      debugTrace("insertion:finished");']
    ]) {
      assert.ok(content.includes(before), `Missing diagnostic anchor: ${before}`);
      content = content.replace(before, after);
    }
    await writeFile(contentPath, content);
  }
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
    const browser = await waitForValue(
      () => chromium.connectOverCDP(`http://127.0.0.1:${port}`),
      10000,
      "Chrome DevTools connection"
    );
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
      if (pageParameters.has("capture") && process.env.OVERCITE_UI_SCREENSHOT_DIR) {
        await page.locator(".ezcite-abstract-details[open]").waitFor({ timeout: 10000 });
        for (const theme of ["light", "dark"]) {
          await page.locator("#ezcite-root").evaluate((root, value) => { root.dataset.theme = value; }, theme);
          await page.locator("#ezcite-root").screenshot({ path: join(process.env.OVERCITE_UI_SCREENSHOT_DIR, `popup-${theme}.png`) });
        }
        await page.evaluate(() => { window.__OVERCITE_CAPTURE_DONE__ = true; });
      }
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
          { timeout: new URL(pageUrl).searchParams.has("soak") ? soakWaitBudgetMs : 25000 }
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
      const ackExpectation = pageParameters.get("ackexpect");
      let acknowledgmentCopyResult = null;
      let acknowledgmentDismissVisible = false;
      let acknowledgmentDismissed = false;
      if (ackExpectation === "show" && pageParameters.get("acknever") !== "1") {
        const action = page.locator(".ezcite-toast-action", { hasText: "Copy acknowledgment" });
        const dismiss = page.getByRole("button", { name: "Remind me later" });
        await action.waitFor({ state: "visible", timeout: 3000 });
        await dismiss.waitFor({ state: "visible", timeout: 3000 });
        acknowledgmentDismissVisible = true;
        await browser.contexts()[0].grantPermissions(["clipboard-read", "clipboard-write"], {
          origin: new URL(pageUrl).origin
        });
        await action.click();
        await page.waitForFunction(
          () => document.querySelector(".ezcite-toast-action")?.textContent === "Copied",
          null,
          { timeout: 3000 }
        );
        acknowledgmentCopyResult = await page.evaluate(() => navigator.clipboard.readText());
        await dismiss.click();
        await dismiss.waitFor({ state: "hidden", timeout: 3000 });
        acknowledgmentDismissed = true;
      }
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
        insertionStressElapsedMs,
        acknowledgmentCopyResult,
        acknowledgmentDismissVisible,
        acknowledgmentDismissed
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
  if (process.argv.includes("--soak-only")) {
    for (const shouldReturn of [false, true]) {
      const chromeResult = await runChrome({ extensionDir, profileDir:join(temporaryRoot, `profile-soak-${shouldReturn}`), pageUrl:`http://127.0.0.1:${address.port}/project/current-ui?return=${shouldReturn?1:0}&soak=${soakCycles}` });
      const result = parseFixtureResult(chromeResult.payload);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.cycles, soakCycles);
      assert.equal(result.bibliographyEntries, 2001);
      assert.equal(result.unrelatedTextReads, 0);
      assert.deepEqual(result.unexpectedErrors, []);
      console.log(`Chrome ${soakCycles}-cycle large bibliography session return=${shouldReturn}: PASS ${JSON.stringify(result)}`);
    }
  } else {
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
    { name: "selection does not wait for citation counts", query: "return=1&counts=select" },
    { name: "citation count updates preserve click targets", query: "return=0&counts=finish" },
    { name: "refined results are selectable before citation counts", query: "return=0&empty=1&counts=refine" },
    { name: "contextual search publishes a single ranked list", query: "return=0&empty=1&preview=select" },
    { name: "abstract disclosure does not select a paper", query: "return=0&abstract=1" + (process.env.OVERCITE_UI_SCREENSHOT_DIR ? "&capture=1" : "") },
    { name: "long result lists retain readable titles and scroll", query: "return=0&manyresults=1" },
    { name: "settings change rejects displayed and late results", query: "return=0&stale=settings" },
    { name: "editor input rejects displayed and late results", query: "return=0&stale=context" },
    { name: "popup header opens settings", query: "return=0&popupsettings=1", verify(result) { assert.equal(result.settingsRedirect, true); } },
    { name: "Firefox-style permission error opens settings", query: "return=0&onboarding=1&onboardastro=1&permissiongesture=1", verify(result) { assert.equal(result.automaticSettingsRedirect, true); } },
    { name: "contextual refinement preserves card positions", query: "return=0&empty=1&preview=refine" },
    { name: "narrow contextual refinement preserves geometry", query: "return=0&empty=1&preview=refine&narrow=1" },
    { name: "contextual refinement failure preserves selectable results", query: "return=0&empty=1&preview=fail" },
    {
      name: "Astronomy onboarding opens token settings automatically",
      query: "return=0&onboarding=1&onboardastro=1",
      verify(result) {
        assert.equal(result.automaticSettingsRedirect, true);
        assert.equal(result.subjectPromptVisible, true);
        assert.equal(result.lookupBlockedBeforeSubject, true);
      }
    },
    {
      name: "missing ADS token redirects to settings",
      query: "return=0&missingtoken=1&settingsredirect=1",
      verify(result) {
        assert.equal(result.settingsRedirect, true);
        assert.equal(result.retryActionAbsent, true);
      }
    },
    {
      name: "Try again recovers from a failed lookup",
      query: "return=0&retry=1",
      verify(result) {
        assert.equal(result.retryWorked, true);
        assert.deepEqual(result.retryActionLabels, ["Try again", "Contextual search", "Raw query"]);
      }
    },
    {
      name: "default bibliography insertion is alphabetical",
      query: "return=0&ordering=1",
      verify(result) {
        assert.equal(result.orderingFixture, true);
        assert.equal(result.expectedAppendOrder, false);
        assert.equal(result.bibliographyOrderCorrect, true);
      }
    },
    {
      name: "explicit append bibliography preference is preserved",
      query: "return=0&ordering=1&insertmode=append",
      verify(result) {
        assert.equal(result.orderingFixture, true);
        assert.equal(result.expectedAppendOrder, true);
        assert.equal(result.bibliographyOrderCorrect, true);
      }
    },
    {
      name: "required subject onboarding gates lookup",
      query: "return=0&onboarding=1",
      verify(result) {
        assert.equal(result.subjectOnboarding, true);
        assert.equal(result.subjectPromptVisible, true);
        assert.equal(result.lookupBlockedBeforeSubject, true);
      }
    },
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
    if (scenarioResult.settingsRedirect) {
      scenario.verify(scenarioResult, scenarioChromeResult);
      console.log(`Chrome ${scenario.name}: PASS`);
      continue;
    }
    assert.equal(scenarioResult.activeFile, scenario.query.includes("return=1") ? "main.tex" : "references.bib");
    assert.equal(scenarioResult.sourceHasRice, true);
    assert.equal(scenarioResult.bibliographyHasRice, true);
    assert.deepEqual(scenarioResult.unexpectedErrors, []);
    const insertionLimitMs = scenario.query.includes("lateack=1") ? 18000 : 10000;
    assert.ok(scenarioResult.insertionElapsedMs < insertionLimitMs, `slow bounded insertion: ${scenarioResult.insertionElapsedMs} ms`);
    scenario.verify?.(scenarioResult, scenarioChromeResult);
    const stressSummary = scenario.query.includes("stress=1")
      ? `; 75 idle clicks ${scenarioChromeResult.idleStressElapsedMs} ms, 50 insertion clicks ${scenarioChromeResult.insertionStressElapsedMs} ms, DOM text reads 0`
      : "";
    console.log(`Chrome ${scenario.name}: PASS (${scenarioResult.insertionElapsedMs} ms${stressSummary})`);
  }

  const acknowledgmentProfileDir = join(temporaryRoot, "profile-recurring-acknowledgment");
  const acknowledgmentFirst = await runChrome({
    extensionDir,
    profileDir: acknowledgmentProfileDir,
    pageUrl: `http://127.0.0.1:${address.port}/project/current-ui?return=1&acklegacy=1&ackexpect=show`
  });
  const acknowledgmentFirstResult = parseFixtureResult(acknowledgmentFirst.payload);
  assert.equal(acknowledgmentFirstResult.ok, true);
  assert.equal(acknowledgmentFirstResult.acknowledgmentReminderVisible, true);
  assert.equal(acknowledgmentFirstResult.acknowledgmentActionLabel, "Copy acknowledgment");
  assert.deepEqual(acknowledgmentFirstResult.acknowledgmentActionLabels, [
    "Copy acknowledgment",
    "Remind me later",
    "Never remind me"
  ]);
  assert.equal(
    acknowledgmentFirstResult.acknowledgmentPromptText,
    "Publishing work that used OverCite? Please consider acknowledging it!"
  );
  assert.equal(acknowledgmentFirst.acknowledgmentDismissVisible, true);
  assert.equal(acknowledgmentFirst.acknowledgmentDismissed, true);
  assert.equal(
    acknowledgmentFirst.acknowledgmentCopyResult,
    "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX."
  );

  const acknowledgmentSecond = await runChrome({
    extensionDir,
    profileDir: join(temporaryRoot, "profile-acknowledgment-not-due"),
    pageUrl: `http://127.0.0.1:${address.port}/project/current-ui?return=1&ackfuture=1&ackexpect=hide`
  });
  const acknowledgmentSecondResult = parseFixtureResult(acknowledgmentSecond.payload);
  assert.equal(acknowledgmentSecondResult.ok, true);
  assert.equal(acknowledgmentSecondResult.acknowledgmentReminderVisible, false);

  const acknowledgmentOptOut = await runChrome({
    extensionDir,
    profileDir: join(temporaryRoot, "profile-acknowledgment-opt-out"),
    pageUrl: `http://127.0.0.1:${address.port}/project/current-ui?return=1&ackexpect=show&acknever=1`
  });
  const acknowledgmentOptOutResult = parseFixtureResult(acknowledgmentOptOut.payload);
  assert.equal(acknowledgmentOptOutResult.ok, true);
  assert.equal(acknowledgmentOptOutResult.acknowledgmentOptedOut, true);

  const acknowledgmentFailure = await runChrome({
    extensionDir,
    profileDir: join(temporaryRoot, "profile-acknowledgment-storage-failure"),
    pageUrl: `http://127.0.0.1:${address.port}/project/current-ui?return=1&ackfail=1&ackexpect=hide`
  });
  const acknowledgmentFailureResult = parseFixtureResult(acknowledgmentFailure.payload);
  assert.equal(acknowledgmentFailureResult.ok, true);
  assert.equal(acknowledgmentFailureResult.acknowledgmentReminderVisible, false);
  console.log("Chrome 90-day acknowledgment reminder: PASS (migration, copy, cadence, opt-out, storage failure)");
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}

function readSoakCycles() {
  const raw = process.argv.find((argument) => argument.startsWith("--soak-cycles="))?.split("=", 2)[1] ?? "30";
  const cycles = Number(raw);
  assert.ok(Number.isSafeInteger(cycles) && cycles > 0, `--soak-cycles must be a positive integer; got ${raw}`);
  return cycles;
}
