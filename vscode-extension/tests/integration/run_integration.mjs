import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { runTests } from "@vscode/test-electron";

const repoRoot = "/Users/bijan1339/Desktop/Caltech/Notebooks/OverCite";
const extensionDevelopmentPath = path.join(repoRoot, "vscode-extension");
const extensionTestsPath = path.join(extensionDevelopmentPath, "tests", "integration", "suite.cjs");
const workspaceDir = path.join(repoRoot, "local_testing", "vscode-smoke");
const mainTexPath = path.join(workspaceDir, "main.tex");
const referencesPath = path.join(workspaceDir, "references.bib");
const resultPath = path.join(workspaceDir, "artifacts", "integration-result.json");
const vscodeExecutablePath = "/Users/bijan1339/Downloads/Visual Studio Code.app/Contents/MacOS/Electron";
const testUserDataDir = "/tmp/overcite-vscode-user";
const testExtensionsDir = "/tmp/overcite-vscode-exts";

await fs.writeFile(
  mainTexPath,
  "\\documentclass{article}\n\\begin{document}\nTriple star systems are very common, as revealed by Gaia \\citep{Shariat25}.\n\\bibliography{references}\n\\end{document}\n"
);
await fs.writeFile(
  referencesPath,
  "@ARTICLE{Existing24_demo,\n  author = {{Someone}, Demo},\n  title = {An Existing Demo Entry},\n  year = {2024}\n}\n"
);
await fs.mkdir(path.dirname(resultPath), { recursive: true });
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

const mockWideBinariesBibtex = `@ARTICLE{2025ApJ...999..123S,
       author = {{Shariat}, Cheyanne and {El-Badry}, Kareem and {Gennaro}, Mario},
        title = "{Wide Binaries in an Ultra-faint Dwarf Galaxy: Discovery, Population Modeling, and A Nail in the Coffin of Primordial black hole Dark Matter}",
      journal = {\\apj},
         year = 2025,
          doi = {10.0000/mock-wide-binaries},
       adsurl = {https://ui.adsabs.harvard.edu/abs/2025ApJ...999..123S}
}`;

const mockServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/v1/search/query") {
    const query = url.searchParams.get("q") ?? "";
    const docs = query.includes("primordial") || query.includes("wide binaries")
      ? [
          {
            bibcode: "2025ApJ...999..123S",
            title: ["Wide Binaries in an Ultra-faint Dwarf Galaxy: Discovery, Population Modeling, and A Nail in the Coffin of Primordial black hole Dark Matter"],
            author: ["Shariat, Cheyanne", "El-Badry, Kareem", "Gennaro, Mario"],
            year: "2025",
            abstract: "Wide binaries constrain primordial black hole dark matter in an ultrafaint dwarf galaxy.",
            doi: ["10.0000/mock-wide-binaries"]
          },
          {
            bibcode: "2021MNRAS.000..111E",
            title: ["A census of wide binaries from Gaia eDR3"],
            author: ["El-Badry, Kareem"],
            year: "2021",
            abstract: "A census of wide binaries from Gaia.",
            doi: ["10.0000/mock-gaia-binaries"]
          }
        ]
      : query.includes("Shariat")
      ? [
          {
            bibcode: "2025PASP..137i4201S",
            title: ["10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations"],
            author: ["Shariat, Cheyanne", "El-Badry, Kareem", "Naoz, Smadar"],
            year: "2025",
            abstract: "Resolved triples from Gaia constrain triple star populations.",
            doi: ["10.1088/1538-3873/adfb30"]
          }
        ]
      : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ response: { docs } }));
    return;
  }
  if (url.pathname === "/v1/export/bibtex") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let bibcode = "";
      try {
        const parsed = JSON.parse(body || "{}");
        bibcode = parsed?.bibcode?.[0] ?? "";
      } catch {
        bibcode = "";
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (String(bibcode).includes("2025ApJ...999..123S")) {
        res.end(JSON.stringify({ export: mockWideBinariesBibtex }));
        return;
      }
      res.end(JSON.stringify({ export: mockBibtex }));
    });
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
        workspaceDir,
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
        OVERCITE_TEST_WORKSPACE: workspaceDir,
        OVERCITE_TEST_MAIN_TEX: mainTexPath,
        OVERCITE_TEST_REFERENCES: referencesPath,
        OVERCITE_TEST_RESULT_PATH: resultPath
      }
    });
  } catch (error) {
    const result = await readResultIfPresent(resultPath);
    if (!result?.ok) {
      throw error;
    }
    console.warn("VS Code exited non-zero after integration success; treating run as passed.");
  }

  const updatedMain = await fs.readFile(mainTexPath, "utf8");
  const updatedBib = await fs.readFile(referencesPath, "utf8");
  console.log(JSON.stringify({
    ok: true,
    mainTexUpdated: updatedMain.includes("Shariat25_10k"),
    referencesUpdated: updatedBib.includes("Shariat25_10k")
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
