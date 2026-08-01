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
    defaultSearchMode: "contextual"
  };
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "getSettings":
      return settingsForSender(sender);
    case "searchAds":
      return [candidate];
    case "resolveBibTarget":
      return { status: "resolved", target: "references.bib", candidates: ["references.bib"] };
    case "exportBibtex":
      if (new URL(sender?.tab?.url || sender?.url || "http://127.0.0.1/").searchParams.get("manual") === "1") {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return "@article{Rice2021,\\n  author = {Rice, Thomas S. and Smith, Jane Q.},\\n  title = {The Chandra Survey of M51},\\n  year = {2021}\\n}";
    case "applyInsertion":
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
  const manualNavigation = new URL(pageUrl).searchParams.get("manual") === "1";
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
      await page.locator("#unrelated-control").click();
      const unrelatedTextReads = await page.evaluate(() => window.__OVERCITE_UNRELATED_TEXT_READS__);
      assert.equal(
        unrelatedTextReads,
        0,
        "idle clicks in a large PDF/grammar subtree must not inspect ancestor text"
      );
      await page.evaluate(() => { window.__OVERCITE_START_REGRESSION__ = true; });
      if (manualNavigation) {
        await page.waitForFunction(
          () => Boolean(window.__OVERCITE_INSERTION_STARTED__),
          null,
          { timeout: 5000 }
        );
        await page.locator("#old-tab").click();
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
      return { payload, workers, stderr, unrelatedTextReads };
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
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}
