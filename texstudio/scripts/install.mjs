#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const texstudioRoot = path.resolve(__dirname, "..");
const macroSourcePath = path.join(texstudioRoot, "macros", "overcite-resolve.txsMacro");
const settingsMacroSourcePath = path.join(texstudioRoot, "macros", "overcite-open-settings.txsMacro");
const settingsReferenceSourcePath = path.join(texstudioRoot, "SETTINGS.md");
const cliPath = path.join(texstudioRoot, "src", "cli.mjs");
const defaultOutputDir = path.join(os.homedir(), ".overcite", "texstudio");
const defaultSettingsPath = path.join(os.homedir(), ".overcite", "texstudio-settings.json");
const defaultSettingsReferenceFileName = "settings-reference.md";
const settingsDocsUrl = "https://github.com/cheyanneshariat/OverCite/blob/main/texstudio/SETTINGS.md";
const MODES = Object.freeze([
  ["contextual", "OverCite: Resolve Citation", "overcite-contextual.txsMacro", "Alt+Shift+E"],
  ["simple", "OverCite: Resolve Citation (Simple Search)", "overcite-simple.txsMacro", "Alt+Shift+S"],
  ["direct", "OverCite: Resolve Citation (Raw Query)", "overcite-raw-query.txsMacro", "Alt+Shift+R"]
]);

const args = parseArgs(process.argv.slice(2));

try {
  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }
  assertNodeVersion();

  const outputDir = path.resolve(String(args["output-dir"] ?? defaultOutputDir));
  const settingsPath = path.resolve(String(args["settings-path"] ?? defaultSettingsPath));
  const nodePath = resolveExecutablePath(args["node-path"], process.execPath);
  const sourceProfile = String(args["source-profile"] ?? "").trim();
  const adsToken = String(args["ads-token"] ?? "").trim();
  const ncbiApiKey = String(args["ncbi-api-key"] ?? "").trim();

  await assertFileExists(cliPath, "OverCite TeXstudio CLI");
  await assertFileExists(settingsReferenceSourcePath, "OverCite TeXstudio settings reference");
  const sourceMacro = await fs.readFile(macroSourcePath, "utf8");
  const settingsMacro = await fs.readFile(settingsMacroSourcePath, "utf8");
  await fs.mkdir(outputDir, { recursive: true });

  const macroFiles = [];
  for (const [mode, name, fileName, shortcut] of MODES) {
    const outputPath = path.join(outputDir, fileName);
    await fs.writeFile(outputPath, renderMacro(sourceMacro, { mode, name, shortcut, nodePath, cliPath }), "utf8");
    macroFiles.push({ mode, path: outputPath });
  }
  const settingsMacroPath = path.join(outputDir, "overcite-open-settings.txsMacro");
  const settingsReferencePath = path.join(outputDir, defaultSettingsReferenceFileName);
  await fs.writeFile(settingsMacroPath, renderSettingsMacro(settingsMacro, {
    settingsPath,
    settingsReferencePath,
    docsUrl: settingsDocsUrl,
    openCommandPrefix: resolveOpenCommandPrefix(args["open-command"])
  }), "utf8");
  macroFiles.push({ mode: "settings", path: settingsMacroPath });
  await fs.copyFile(settingsReferenceSourcePath, settingsReferencePath);

  const settingsResult = args["skip-settings"]
    ? { path: settingsPath, action: "skipped" }
    : await writeSettings({
      settingsPath,
      settingsReferencePath,
      docsUrl: settingsDocsUrl,
      sourceProfile,
      adsToken,
      ncbiApiKey,
      force: Boolean(args.force)
    });

  printSummary({ outputDir, macroFiles, settingsResult, settingsReferencePath });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function renderMacro(sourceMacro, { mode, name, shortcut, nodePath, cliPath }) {
  const script = sourceMacro
    .replace(/var OVERCITE_MODE = "[^"]+";/, `var OVERCITE_MODE = ${JSON.stringify(mode)};`)
    .replace(/var OVERCITE_NODE = persistentOrDefault\("overciteNodePath", "[^"]*"\);/, `var OVERCITE_NODE = persistentOrDefault("overciteNodePath", ${JSON.stringify(nodePath)});`)
    .replace(/var OVERCITE_CLI = persistentOrDefault\("overciteCliPath", "[^"]*"\);/, `var OVERCITE_CLI = persistentOrDefault("overciteCliPath", ${JSON.stringify(cliPath)});`)
    .replace(/^%SCRIPT\r?\n/, "");
  return `${JSON.stringify({
    abbrev: "",
    checkState: 2,
    description: [
      "Resolve the citation under the cursor with OverCite."
    ],
    formatVersion: 2,
    menu: "",
    name,
    shortcut,
    tag: script.split("\n"),
    trigger: "",
    type: "Script"
  }, null, 2)}\n`;
}

function renderSettingsMacro(sourceMacro, { settingsPath, settingsReferencePath, docsUrl, openCommandPrefix }) {
  const script = sourceMacro
    .replace(/var OVERCITE_SETTINGS_PATH = "[^"]*";/, `var OVERCITE_SETTINGS_PATH = ${JSON.stringify(settingsPath)};`)
    .replace(/var OVERCITE_SETTINGS_REFERENCE_PATH = "[^"]*";/, `var OVERCITE_SETTINGS_REFERENCE_PATH = ${JSON.stringify(settingsReferencePath)};`)
    .replace(/var OVERCITE_SETTINGS_DOCS_URL = "[^"]*";/, `var OVERCITE_SETTINGS_DOCS_URL = ${JSON.stringify(docsUrl)};`)
    .replace(/var OVERCITE_OPEN_COMMAND_PREFIX = "[^"]*";/, `var OVERCITE_OPEN_COMMAND_PREFIX = ${JSON.stringify(openCommandPrefix)};`)
    .replace(/^%SCRIPT\r?\n/, "");
  return `${JSON.stringify({
    abbrev: "",
    checkState: 2,
    description: [
      "Open the OverCite TeXstudio settings file."
    ],
    formatVersion: 2,
    menu: "",
    name: "OverCite: Open Settings",
    shortcut: "Alt+Shift+O",
    tag: script.split("\n"),
    trigger: "",
    type: "Script"
  }, null, 2)}\n`;
}

async function writeSettings({ settingsPath, settingsReferencePath, docsUrl, sourceProfile, adsToken, ncbiApiKey, force }) {
  const existing = await readJsonIfExists(settingsPath);
  if (existing && !force && !sourceProfile && !adsToken && !ncbiApiKey) {
    return { path: settingsPath, action: "kept" };
  }

  const settings = existing && !force
    ? { ...existing }
    : {
      _help: `Edit this file, save it, then run OverCite again. Full option reference: ${settingsReferencePath}. GitHub: ${docsUrl}`,
      sourceProfile: "astrophysics",
      adsApiToken: "",
      ncbiApiKey: "",
      contextWindowChars: 500,
      citationKeyMode: "authoryear",
      bibliographyInsertMode: "append",
      defaultSearchMode: "contextual",
      projectBibFileOverrides: {}
    };

  settings._help = settings._help || `Edit this file, save it, then run OverCite again. Full option reference: ${settingsReferencePath}. GitHub: ${docsUrl}`;
  if (sourceProfile) {
    settings.sourceProfile = sourceProfile;
  }
  if (adsToken) {
    settings.adsApiToken = adsToken;
  }
  if (ncbiApiKey) {
    settings.ncbiApiKey = ncbiApiKey;
  }

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return { path: settingsPath, action: existing ? "updated" : "created" };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(`Could not read existing settings at ${filePath}: ${error.message}`);
  }
}

async function assertFileExists(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} was not found at ${filePath}. Run this installer from a complete OverCite checkout.`);
  }
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(`OverCite for TeXstudio requires Node.js 18 or newer. Current version: ${process.version}`);
  }
}

function resolveExecutablePath(value, fallback) {
  const raw = String(value ?? fallback).trim();
  if (!raw) {
    return fallback;
  }
  if (path.isAbsolute(raw) || raw.includes("/") || raw.includes("\\")) {
    return path.resolve(raw);
  }
  return raw;
}

function resolveOpenCommandPrefix(value) {
  const raw = String(value ?? "").trim();
  if (raw) {
    return raw;
  }
  if (process.platform === "darwin") {
    return "open";
  }
  if (process.platform === "win32") {
    return "cmd /c start \"\"";
  }
  return "xdg-open";
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}". Use --help for usage.`);
    }
    const key = arg.slice(2);
    const next = rawArgs[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`OverCite TeXstudio installer

Usage:
  node texstudio/scripts/install.mjs [options]

Options:
  --output-dir PATH       Where generated TeXstudio macros are written.
  --settings-path PATH    Where the TeXstudio settings JSON is written.
  --source-profile NAME   Default source profile, for example astrophysics or general.
  --ads-token TOKEN       Optional ADS/SciX token for astronomy lookups.
  --ncbi-api-key TOKEN    Optional NCBI API key for PubMed lookups.
  --node-path PATH        Node executable path to embed in generated macros.
  --open-command COMMAND  Command prefix for the Open Settings macro.
  --force                 Recreate the settings file instead of merging.
  --skip-settings         Only generate macros.
  --help                  Show this help text.
`);
}

function printSummary({ outputDir, macroFiles, settingsResult, settingsReferencePath }) {
  process.stdout.write(`OverCite TeXstudio setup files are ready.

Generated macros:
${macroFiles.map((file) => `  - ${file.mode}: ${file.path}`).join("\n")}

Settings file: ${settingsResult.path} (${settingsResult.action})
Settings reference: ${settingsReferencePath}

Next steps:
  1. Open TeXstudio -> Macros -> Edit Macros...
  2. Import overcite-contextual.txsMacro.
  3. Import overcite-open-settings.txsMacro so users can edit settings from TeXstudio.
  4. Use Alt+Shift+E for OverCite and Alt+Shift+O to open settings.
  5. Optionally add the simple and raw-query macros too.

Generated macro folder:
  ${outputDir}
`);
}
