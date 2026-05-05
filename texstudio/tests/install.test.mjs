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
  const openSettings = JSON.parse(await fs.readFile(path.join(outputDir, "overcite-open-settings.txsMacro"), "utf8"));
  const settingsReference = await fs.readFile(path.join(outputDir, "settings-reference.md"), "utf8");
  const contextualScript = contextual.tag.join("\n");
  const openSettingsScript = openSettings.tag.join("\n");

  assert.equal(contextual.formatVersion, 2);
  assert.equal(contextual.type, "Script");
  assert.equal(contextual.name, "OverCite: Resolve Citation");
  assert.equal(contextual.shortcut, "Alt+Shift+E");
  assert.equal(simple.shortcut, "Alt+Shift+S");
  assert.equal(direct.shortcut, "Alt+Shift+R");
  assert.equal(openSettings.name, "OverCite: Open Settings");
  assert.equal(openSettings.shortcut, "Alt+Shift+O");
  assert.doesNotMatch(contextual.tag[0], /^%SCRIPT/);
  assert.doesNotMatch(openSettings.tag[0], /^%SCRIPT/);
  assert.match(contextualScript, /var OVERCITE_MODE = "contextual"/);
  assert.match(simple.tag.join("\n"), /var OVERCITE_MODE = "simple"/);
  assert.match(direct.tag.join("\n"), /var OVERCITE_MODE = "direct"/);
  assert.match(openSettingsScript, new RegExp(escapeRegex(JSON.stringify(settingsPath))));
  assert.match(openSettingsScript, /var OVERCITE_SETTINGS_DOCS_URL = "https:\/\/github\.com\/cheyanneshariat\/OverCite\/blob\/main\/texstudio\/SETTINGS\.md"/);
  assert.match(settingsReference, /All Options/);
  assert.match(settingsReference, /citationKeyMode/);
  assert.match(contextualScript, new RegExp(escapeRegex(JSON.stringify(process.execPath))));
  assert.match(contextualScript, new RegExp(escapeRegex(JSON.stringify(cliPath))));
  assert.doesNotMatch(contextualScript, /\/absolute\/path\/to\/OverCite/);

  const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  assert.match(settings._help, /settings-reference\.md/);
  assert.equal(settings.sourceProfile, "general");
  assert.equal(settings.adsApiToken, "ads-test-token");
  assert.equal(settings.ncbiApiKey, "ncbi-test-key");
  assert.equal(settings.contextWindowChars, 500);
  assert.equal(settings.citationKeyMode, "authoryear");
  assert.equal(settings.bibliographyInsertMode, "append");
  assert.equal(settings.defaultSearchMode, "contextual");
  assert.deepEqual(settings.projectBibFileOverrides, {});
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

test("installer can customize the settings open command", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-install-open-"));
  const outputDir = path.join(tempDir, "macros");
  const settingsPath = path.join(tempDir, "settings.json");

  await execFileAsync(process.execPath, [
    installerPath,
    "--output-dir", outputDir,
    "--settings-path", settingsPath,
    "--open-command", "custom-open",
    "--skip-settings"
  ], { cwd: repoRoot });

  const openSettings = JSON.parse(await fs.readFile(path.join(outputDir, "overcite-open-settings.txsMacro"), "utf8"));
  assert.match(openSettings.tag.join("\n"), /var OVERCITE_OPEN_COMMAND_PREFIX = "custom-open"/);
});

test("installer help documents the easy setup command", async () => {
  const { stdout } = await execFileAsync(process.execPath, [installerPath, "--help"], {
    cwd: repoRoot
  });
  assert.match(stdout, /node texstudio\/scripts\/install\.mjs/);
  assert.match(stdout, /--source-profile NAME/);
  assert.match(stdout, /--ads-token TOKEN/);
  assert.match(stdout, /--open-command COMMAND/);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
