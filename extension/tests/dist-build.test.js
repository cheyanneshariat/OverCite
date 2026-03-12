import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

test("build script creates Chrome and Firefox manifests with browser-specific backgrounds", async () => {
  const extensionRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "overcite-ext-"));
  await execFileAsync("cp", ["-R", extensionRoot, tempDir]);

  const copiedRoot = path.join(tempDir, path.basename(extensionRoot));
  const buildScript = path.join(copiedRoot, "scripts", "build-browser-dists.mjs");
  await execFileAsync("node", [buildScript]);

  const chromeManifest = JSON.parse(
    await readFile(path.join(copiedRoot, "dist", "chrome", "manifest.json"), "utf8")
  );
  const firefoxManifest = JSON.parse(
    await readFile(path.join(copiedRoot, "dist", "firefox", "manifest.json"), "utf8")
  );

  assert.equal(chromeManifest.background.service_worker, "src/background.js");
  assert.equal(chromeManifest.background.type, "module");
  assert.ok(!("scripts" in chromeManifest.background));

  assert.equal(firefoxManifest.background.service_worker, "src/background.js");
  assert.equal(firefoxManifest.background.type, "module");
  assert.deepEqual(firefoxManifest.background.scripts, ["src/background.js"]);
});
