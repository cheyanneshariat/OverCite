import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("build script creates Chrome, Firefox, and Safari resources with platform-specific backgrounds", async () => {
  const extensionRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "overcite-ext-"));
  await execFileAsync("cp", ["-R", extensionRoot, tempDir]);

  const copiedRoot = path.join(tempDir, path.basename(extensionRoot));
  await mkdir(path.join(tempDir, "safari", "OverCite Extension", "Resources"), { recursive: true });
  const buildScript = path.join(copiedRoot, "scripts", "build-browser-dists.mjs");
  await execFileAsync("node", [buildScript]);

  const chromeManifest = JSON.parse(
    await readFile(path.join(copiedRoot, "dist", "chrome", "manifest.json"), "utf8")
  );
  const firefoxManifest = JSON.parse(
    await readFile(path.join(copiedRoot, "dist", "firefox", "manifest.json"), "utf8")
  );
  const safariManifest = JSON.parse(
    await readFile(path.join(tempDir, "safari", "OverCite Extension", "Resources", "manifest.json"), "utf8")
  );
  const safariBackground = await readFile(
    path.join(tempDir, "safari", "OverCite Extension", "Resources", "src", "background-safari.js"),
    "utf8"
  );

  assert.equal(chromeManifest.background.service_worker, "src/background.js");
  assert.equal(chromeManifest.background.type, "module");
  assert.ok(!("scripts" in chromeManifest.background));

  assert.equal(firefoxManifest.background.service_worker, "src/background.js");
  assert.equal(firefoxManifest.background.type, "module");
  assert.deepEqual(firefoxManifest.background.scripts, ["src/background.js"]);

  assert.equal(safariManifest.background.service_worker, "src/background-safari.js");
  assert.ok(!("browser_specific_settings" in safariManifest));
  assert.match(safariBackground, /Safari background bundle generated from extension modules/);
  assert.doesNotMatch(safariBackground, /^\s*import\s/m);
  assert.match(safariBackground, /const __overciteSafariModules = Object\.create\(null\);/);
  await execFileAsync("node", ["--check", path.join(tempDir, "safari", "OverCite Extension", "Resources", "src", "background-safari.js")]);
});
