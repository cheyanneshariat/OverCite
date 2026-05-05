import fs from "node:fs/promises";
import path from "node:path";

import { resolveTexstudioRequest } from "../src/adapter.mjs";

const texstudioRoot = path.resolve(new URL("..", import.meta.url).pathname);
const repoRoot = path.dirname(texstudioRoot);
const fixtureDir = path.join(texstudioRoot, "fixtures", "basic");
const smokeDir = path.join(texstudioRoot, "tmp", "smoke-workdir");
const artifactDir = path.join(texstudioRoot, "tmp", "smoke-artifacts");
const artifactPath = path.join(artifactDir, "integration-result.json");

await fs.rm(smokeDir, { recursive: true, force: true });
await fs.mkdir(smokeDir, { recursive: true });
await fs.cp(fixtureDir, smokeDir, { recursive: true });
await fs.mkdir(artifactDir, { recursive: true });

const activeFilePath = path.join(smokeDir, "main.tex");
const activeText = await fs.readFile(activeFilePath, "utf8");
const response = await resolveTexstudioRequest(
  {
    activeFilePath,
    activeText,
    projectDir: smokeDir,
    cursorIndex: activeText.indexOf("Shariat25") + 3,
    selectedIndex: 0,
    writeActiveFile: true,
    settings: {
      adsApiToken: "test-token",
      sourceProfile: "astrophysics",
      citationKeyMode: "authoryear",
      bibliographyInsertMode: "append"
    }
  },
  {
    fetchImpl: fakeAdsFetch()
  }
);

const updatedTex = await fs.readFile(activeFilePath, "utf8");
const updatedBib = await fs.readFile(path.join(smokeDir, "references.bib"), "utf8");
if (response.status !== "applied") {
  throw new Error(`Expected applied response, got ${response.status}`);
}
if (!updatedTex.includes("\\citep{Shariat2025}")) {
  throw new Error("Smoke test did not update the active citation key.");
}
if (!updatedBib.includes("@ARTICLE{Shariat2025,")) {
  throw new Error("Smoke test did not write the bibliography entry.");
}

const artifact = {
  ok: true,
  finalKey: response.finalKey,
  activeEdit: response.activeEdit,
  bibFile: response.bibFile.relativePath,
  activeFileWritten: response.activeFile.written,
  bibFileWritten: response.bibFile.written,
  workdir: path.relative(repoRoot, smokeDir)
};
await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, artifactPath, workdir: smokeDir }, null, 2));

function fakeAdsFetch() {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/search/query")) {
      return okJson({
        response: {
          docs: [
            {
              bibcode: "2025PASP..137i4201S",
              title: ["10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations"],
              author: ["Shariat, Cheyanne", "El-Badry, Kareem"],
              year: "2025",
              abstract: "Resolved triples from Gaia constrain triple star populations.",
              doi: ["10.1088/1538-3873/adfb30"],
              citation_count: 8,
              property: ["REFEREED"],
              doctype: "article",
              pub: "Publications of the Astronomical Society of the Pacific"
            }
          ]
        }
      });
    }
    if (url.pathname.includes("/export/bibtex")) {
      return okJson({
        export: [
          "@ARTICLE{placeholder,",
          "  author = {{Shariat}, Cheyanne and {El-Badry}, Kareem},",
          "  title = {10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations},",
          "  year = {2025},",
          "  doi = {10.1088/1538-3873/adfb30}",
          "}"
        ].join("\n")
      });
    }
    throw new Error(`Unexpected fetch URL ${url}`);
  };
}

function okJson(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
    async text() {
      return "";
    }
  };
}
