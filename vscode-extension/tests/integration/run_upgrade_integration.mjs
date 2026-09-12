import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const extensionDevelopmentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.dirname(extensionDevelopmentPath);
const extensionTestsPath = path.join(extensionDevelopmentPath, "tests", "integration", "upgrade-suite.cjs");
const workspaceDir = "/tmp/overcite-vscode-upgrade-workspace";
const workspaceFilePath = "/tmp/overcite-vscode-upgrade.code-workspace";
const resultPath = "/tmp/overcite-vscode-upgrade-result.json";
const vscodeExecutablePath = "/Users/bijan1339/Downloads/Visual Studio Code.app/Contents/MacOS/Electron";
const testUserDataDir = "/tmp/overcite-vscode-upgrade-user";
const testExtensionsDir = "/tmp/overcite-vscode-upgrade-exts";

await fs.mkdir(workspaceDir, { recursive: true });
await fs.writeFile(workspaceFilePath, JSON.stringify({ folders: [{ path: workspaceDir }] }, null, 2));
await fs.rm(resultPath, { force: true });
await fs.rm(testUserDataDir, { recursive: true, force: true });
await fs.rm(testExtensionsDir, { recursive: true, force: true });

const mockBibtex = `@ARTICLE{2025PASP..137i4201S,
       author = {{Shariat}, Cheyanne and {El-Badry}, Kareem and {Naoz}, Smadar},
        title = "{10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations}",
      journal = {\\pasp},
         year = 2025,
          doi = {10.1088/1538-3873/adfb30},
       adsurl = {https://ui.adsabs.harvard.edu/abs/2025PASP..137i4201S}
}`;

const mockServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/v1/search/query") {
    const docs = [{
      bibcode: "2025PASP..137i4201S",
      title: ["10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations"],
      author: ["Shariat, Cheyanne", "El-Badry, Kareem", "Naoz, Smadar"],
      year: "2025",
      abstract: "Resolved triples from Gaia constrain triple star populations.",
      doi: ["10.1088/1538-3873/adfb30"]
    }];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ response: { docs } }));
    return;
  }
  if (url.pathname === "/v1/export/bibtex") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ export: mockBibtex }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
const { port } = mockServer.address();

try {
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceFilePath,
        `--user-data-dir=${testUserDataDir}`,
        `--extensions-dir=${testExtensionsDir}`,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--disable-gpu",
        "--disable-software-rasterizer"
      ],
      extensionTestsEnv: {
        OVERCITE_ADS_SEARCH_URL: `http://127.0.0.1:${port}/v1/search/query`,
        OVERCITE_ADS_BIBTEX_URL: `http://127.0.0.1:${port}/v1/export/bibtex`,
        OVERCITE_TEST_AUTOPICK: "first",
        OVERCITE_UPGRADE_WORKSPACE: workspaceDir,
        OVERCITE_UPGRADE_RESULT: resultPath
      }
    });
  } catch (error) {
    const result = await readResultIfPresent(resultPath);
    if (!result?.ok) throw error;
    console.warn("VS Code exited non-zero after upgrade virtual-workspace success; treating run as passed.");
  }

  const result = await readResultIfPresent(resultPath);
  if (!result?.ok) {
    throw new Error("Upgrade integration did not produce a passing result artifact.");
  }
  console.log(JSON.stringify({
    ...result,
    genuineWorkshopSession: false,
    note: "The overleaf-workshop provider was an in-process VS Code mock; no signed-in Overleaf Workshop session was exercised."
  }, null, 2));
} finally {
  await new Promise((resolve) => mockServer.close(resolve));
}

async function readResultIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}
