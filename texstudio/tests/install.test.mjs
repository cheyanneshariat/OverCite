import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const texstudioRoot = path.resolve(__dirname, "..");
const repoRoot = path.dirname(texstudioRoot);
const installerPath = path.join(texstudioRoot, "scripts", "install.mjs");
const cliPath = path.join(texstudioRoot, "src", "cli.mjs");

test("installer generates ready-to-import macros with embedded local paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-install-"));
  const outputDir = path.join(tempDir, "macros");
  const settingsPath = path.join(tempDir, "settings.json");

  const { stdout } = await execFileAsync(process.execPath, [
    installerPath,
    "--output-dir", outputDir,
    "--settings-path", settingsPath,
    "--source-profile", "general",
    "--ads-token", "ads-test-token",
    "--ncbi-api-key", "ncbi-test-key"
  ], { cwd: repoRoot });

  assert.match(stdout, /OverCite TeXstudio setup files are ready/);
  const contextual = JSON.parse(await fs.readFile(path.join(outputDir, "overcite-contextual.txsMacro"), "utf8"));
  const simple = JSON.parse(await fs.readFile(path.join(outputDir, "overcite-simple.txsMacro"), "utf8"));
  const direct = JSON.parse(await fs.readFile(path.join(outputDir, "overcite-raw-query.txsMacro"), "utf8"));
  const contextualScript = contextual.tag.join("\n");

  assert.equal(contextual.formatVersion, 2);
  assert.equal(contextual.type, "Script");
  assert.equal(contextual.name, "OverCite: Resolve Citation");
  assert.equal(contextual.shortcut, "Alt+Shift+E");
  assert.equal(simple.shortcut, "Alt+Shift+S");
  assert.equal(direct.shortcut, "Alt+Shift+R");
  assert.doesNotMatch(contextual.tag[0], /^%SCRIPT/);
  assert.match(contextualScript, /var OVERCITE_MODE = "contextual"/);
  assert.match(simple.tag.join("\n"), /var OVERCITE_MODE = "simple"/);
  assert.match(direct.tag.join("\n"), /var OVERCITE_MODE = "direct"/);
  assert.match(contextualScript, new RegExp(escapeRegex(JSON.stringify(process.execPath))));
  assert.match(contextualScript, new RegExp(escapeRegex(JSON.stringify(cliPath))));
  assert.doesNotMatch(contextualScript, /\/absolute\/path\/to\/OverCite/);

  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(settings.sourceProfile, "general");
  assert.equal(settings.adsApiToken, "ads-test-token");
  assert.equal(settings.ncbiApiKey, "ncbi-test-key");
  assert.equal(settings.defaultSearchMode, "contextual");
});

test("installer keeps existing settings unless requested to update them", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-install-keep-"));
  const outputDir = path.join(tempDir, "macros");
  const settingsPath = path.join(tempDir, "settings.json");
  await fs.writeFile(settingsPath, JSON.stringify({
    sourceProfile: "math",
    citationKeyMode: "authoryear-colon"
  }), "utf8");

  await execFileAsync(process.execPath, [
    installerPath,
    "--output-dir", outputDir,
    "--settings-path", settingsPath
  ], { cwd: repoRoot });
  let settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(settings.sourceProfile, "math");
  assert.equal(settings.citationKeyMode, "authoryear-colon");

  await execFileAsync(process.execPath, [
    installerPath,
    "--output-dir", outputDir,
    "--settings-path", settingsPath,
    "--source-profile", "astrophysics",
    "--ads-token", "new-token"
  ], { cwd: repoRoot });
  settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.equal(settings.sourceProfile, "astrophysics");
  assert.equal(settings.citationKeyMode, "authoryear-colon");
  assert.equal(settings.adsApiToken, "new-token");
});

test("installer preserves command-name node paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-install-node-"));
  const outputDir = path.join(tempDir, "macros");
  const settingsPath = path.join(tempDir, "settings.json");

  await execFileAsync(process.execPath, [
    installerPath,
    "--output-dir", outputDir,
    "--settings-path", settingsPath,
    "--node-path", "node",
    "--skip-settings"
  ], { cwd: repoRoot });

  const contextual = JSON.parse(await fs.readFile(path.join(outputDir, "overcite-contextual.txsMacro"), "utf8"));
  assert.match(contextual.tag.join("\n"), /var OVERCITE_NODE = persistentOrDefault\("overciteNodePath", "node"\)/);
});

test("installer help documents the easy setup command", async () => {
  const { stdout } = await execFileAsync(process.execPath, [installerPath, "--help"], {
    cwd: repoRoot
  });
  assert.match(stdout, /node texstudio\/scripts\/install\.mjs/);
  assert.match(stdout, /--source-profile NAME/);
  assert.match(stdout, /--ads-token TOKEN/);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
