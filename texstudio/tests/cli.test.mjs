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
const cliPath = path.resolve(__dirname, "../src/cli.mjs");

test("CLI apply reads and writes JSON request/response files", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-cli-"));
  const activeText = "\\bibliography{refs}\nCLI smoke \\citep{Tool2025}.";
  await fs.writeFile(path.join(projectDir, "main.tex"), activeText, "utf8");
  await fs.writeFile(path.join(projectDir, "refs.bib"), "", "utf8");
  const requestPath = path.join(projectDir, "request.json");
  const responsePath = path.join(projectDir, "response.json");
  await fs.writeFile(requestPath, JSON.stringify({
    activeFilePath: path.join(projectDir, "main.tex"),
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Tool2025") + 2,
    selectedCandidate: {
      sourceId: "datacite",
      sourceLabel: "DataCite",
      title: "Example Research Software",
      authors: ["Toolmaker, Ada"],
      year: 2025,
      type: "Software",
      bibtex: "@misc{candidate,title={Example Research Software},author={Toolmaker, Ada},year={2025}}"
    }
  }), "utf8");

  await execFileAsync(process.execPath, [cliPath, "apply", "--request", requestPath, "--response", responsePath], {
    cwd: projectDir
  });

  const response = JSON.parse(await fs.readFile(responsePath, "utf8"));
  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "Toolmaker2025");
  assert.match(response.activeFile.updatedText, /\\citep\{Toolmaker2025\}/);
  assert.match(await fs.readFile(path.join(projectDir, "refs.bib"), "utf8"), /@misc\{Toolmaker2025,/);
});

test("CLI returns structured errors", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-cli-error-"));
  const requestPath = path.join(projectDir, "request.json");
  const responsePath = path.join(projectDir, "response.json");
  await fs.writeFile(responsePath, JSON.stringify({
    status: "applied",
    finalKey: "Stale2025"
  }), "utf8");
  await fs.writeFile(requestPath, JSON.stringify({
    activeText: "No citation here",
    cursorIndex: 0
  }), "utf8");

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "apply", "--request", requestPath, "--response", responsePath], {
      cwd: projectDir
    }),
    /Place the cursor inside/
  );
  const response = JSON.parse(await fs.readFile(responsePath, "utf8"));
  assert.equal(response.status, "error");
  assert.match(response.message, /Place the cursor inside/);
  assert.equal(response.finalKey, undefined);
});

test("CLI apply handles project and bibliography paths with spaces", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite texstudio cli spaced "));
  const activeFilePath = path.join(projectDir, "main file.tex");
  const activeText = "\\bibliography{references file}\nSpaced path smoke \\citep{Space2025}.";
  await fs.writeFile(activeFilePath, activeText, "utf8");
  await fs.writeFile(path.join(projectDir, "references file.bib"), "", "utf8");
  const requestPath = path.join(projectDir, "request file.json");
  const responsePath = path.join(projectDir, "response file.json");
  await fs.writeFile(requestPath, JSON.stringify({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Space2025") + 2,
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Spaced Path Citation",
      authors: ["Spacer, Sam"],
      year: 2025,
      bibtex: "@article{candidate,title={Spaced Path Citation},author={Spacer, Sam},year={2025}}"
    }
  }), "utf8");

  await execFileAsync(process.execPath, [cliPath, "apply", "--request", requestPath, "--response", responsePath], {
    cwd: projectDir
  });

  const response = JSON.parse(await fs.readFile(responsePath, "utf8"));
  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "Spacer2025");
  assert.equal(response.bibFile.relativePath, "references file.bib");
  assert.match(response.activeFile.updatedText, /\\citep\{Spacer2025\}/);
  assert.match(await fs.readFile(path.join(projectDir, "references file.bib"), "utf8"), /@article\{Spacer2025,/);
});

test("CLI rejects unknown commands with structured errors", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-cli-command-"));
  const requestPath = path.join(projectDir, "request.json");
  const responsePath = path.join(projectDir, "response.json");
  await fs.writeFile(requestPath, "{}", "utf8");

  await assert.rejects(
    () => execFileAsync(process.execPath, [cliPath, "unknown", "--request", requestPath, "--response", responsePath], {
      cwd: projectDir
    }),
    /Unknown command/
  );
  const response = JSON.parse(await fs.readFile(responsePath, "utf8"));
  assert.equal(response.status, "error");
  assert.match(response.message, /Unknown command/);
});
