import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const macroPath = path.resolve(__dirname, "../macros/overcite-resolve.txsMacro");
const settingsMacroPath = path.resolve(__dirname, "../macros/overcite-open-settings.txsMacro");

test("TeXstudio macro uses the documented script integration surface", async () => {
  const macro = await fs.readFile(macroPath, "utf8");
  assert.match(macro, /^%SCRIPT/);
  assert.match(macro, /editor\.text\(\)/);
  assert.match(macro, /cursor\.lineNumber\(\)/);
  assert.match(macro, /writeFile\(requestPath/);
  assert.match(macro, /writeRunningResponse\(responsePath\)/);
  assert.match(macro, /structuredErrorMessage\(responsePath\) \|\| stderr/);
  assert.match(macro, /system\(cmd, workingDirectory\)/);
  assert.match(macro, /new UniversalInputDialog\(\)/);
  assert.match(macro, /if \(labels\.length == 1\) \{\n    return 0;/);
  assert.match(macro, /editor\.setText\(response\.activeFile\.updatedText\);/);
  assert.match(macro, /cursor\.setPosition\(edit\.start/);
  assert.match(macro, /cursor\.replaceSelectedText\(edit\.text\)/);
  assert.doesNotMatch(macro, /slowOperationStarted|slowOperationEnded/);
});

test("TeXstudio macro is pinned to v0.3.0 mode names", async () => {
  const macro = await fs.readFile(macroPath, "utf8");
  assert.match(macro, /OVERCITE_MODE = "contextual"/);
  assert.doesNotMatch(macro, /v0\.3\.1/);
});

test("TeXstudio macro quotes command arguments without rewriting path separators", async () => {
  const macro = await fs.readFile(macroPath, "utf8");
  const quoteArgBody = macro.match(/function quoteArg\(value\) \{([^]*?)\n\}/)?.[1] ?? "";
  assert.match(quoteArgBody, /replace\(\/"\/g/);
  assert.doesNotMatch(quoteArgBody, /replace\(\/\\\\/);
});

test("TeXstudio settings macro opens the generated settings file", async () => {
  const macro = await fs.readFile(settingsMacroPath, "utf8");
  assert.match(macro, /^%SCRIPT/);
  assert.match(macro, /OVERCITE_SETTINGS_PATH/);
  assert.match(macro, /OVERCITE_SETTINGS_REFERENCE_PATH/);
  assert.match(macro, /OVERCITE_SETTINGS_DOCS_URL/);
  assert.match(macro, /system\(cmd, dirname\(fileName\)\)/);
  assert.match(macro, /information\("Opened OverCite settings/);
});
