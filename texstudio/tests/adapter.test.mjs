import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyTextEdit,
  applyTexstudioRequest,
  lineColumnToIndex,
  listProjectFiles,
  loadTexstudioSettings,
  normalizeTexstudioSettings,
  resolveTexstudioRequest
} from "../src/adapter.mjs";

test("lineColumnToIndex converts TeXstudio-style cursor positions", () => {
  const text = "one\nsecond line\nthird";
  assert.equal(lineColumnToIndex(text, 0, 0), 0);
  assert.equal(lineColumnToIndex(text, 1, 3), text.indexOf("second") + 3);
  assert.equal(lineColumnToIndex(text, 2, 500), text.length);
  assert.equal(lineColumnToIndex(text, 1, 4, { lineBase: 1, columnBase: 1 }), 3);
});

test("normalizeTexstudioSettings preserves v0.3.0 source and key settings", () => {
  const settings = normalizeTexstudioSettings(
    {
      sourceProfile: "general",
      primarySource: "crossref",
      fallbackSources: ["datacite"],
      citationKeyMode: "authoryear-colon",
      bibliographyInsertMode: "alphabetical",
      defaultSearchMode: "direct"
    },
    {
      OVERCITE_ADS_API_TOKEN: "ads-token",
      NCBI_API_KEY: "ncbi-token"
    }
  );

  assert.equal(settings.sourceProfile, "general");
  assert.equal(settings.primarySource, "crossref");
  assert.deepEqual(settings.fallbackSources, ["datacite"]);
  assert.equal(settings.citationKeyMode, "authoryear-colon");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.defaultSearchMode, "direct");
  assert.equal(settings.sourceApiTokens.ads, "ads-token");
  assert.equal(settings.sourceApiTokens.ncbi, "ncbi-token");
});

test("resolveTexstudioRequest searches ADS v0.3.0 core and applies the selected result", async () => {
  const projectDir = await makeProject({
    "main.tex": [
      "\\documentclass{article}",
      "\\begin{document}",
      "Resolved triples from Gaia are discussed in \\citep{Shariat25}.",
      "\\bibliography{refs}",
      "\\end{document}"
    ].join("\n"),
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");
  const tokenIndex = activeText.indexOf("Shariat25") + 3;

  const response = await resolveTexstudioRequest(
    {
      activeFilePath,
      activeText,
      projectDir,
      cursorIndex: tokenIndex,
      selectedIndex: 0,
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

  assert.equal(response.status, "applied");
  assert.equal(response.searchMode, "contextual");
  assert.equal(response.finalKey, "Shariat2025");
  assert.match(response.activeFile.updatedText, /\\citep\{Shariat2025\}/);
  assert.match(await fs.readFile(path.join(projectDir, "refs.bib"), "utf8"), /@ARTICLE\{Shariat2025,/);
  assert.equal(applyTextEdit(activeText, response.activeEdit), response.activeFile.updatedText);
});

test("resolveTexstudioRequest keeps default raw query compatible with v0.3.0 behavior", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\bibliography{refs}\nContext-only target \\citep{}.",
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await resolveTexstudioRequest(
    {
      activeFilePath,
      activeText,
      projectDir,
      cursorIndex: activeText.indexOf("\\citep{}") + "\\citep{".length,
      settings: {
        sourceProfile: "general",
        primarySource: "crossref",
        fallbackSources: [],
        defaultSearchMode: "direct"
      }
    },
    {
      fetchImpl: async () => crossrefSearchResponse()
    }
  );

  assert.equal(response.status, "needs-selection");
  assert.equal(response.searchMode, "contextual");
});

test("explicit raw query mode rejects empty citation tokens", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\bibliography{refs}\nContext-only target \\citep{}.",
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  await assert.rejects(
    () => resolveTexstudioRequest({
      activeFilePath,
      activeText,
      projectDir,
      cursorIndex: activeText.indexOf("\\citep{}") + "\\citep{".length,
      searchMode: "direct",
      settings: {
        defaultSearchMode: "contextual"
      }
    }),
    /Raw query mode requires a non-empty citation token/
  );
});

test("resolveTexstudioRequest supports non-ADS v0.3.0 direct DOI lookup", async () => {
  const doi = "10.1038/s41586-021-03819-2";
  const projectDir = await makeProject({
    "main.tex": `\\bibliography{refs}\nAlphaFold is resolved with \\citep{${doi}}.`,
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await resolveTexstudioRequest(
    {
      activeFilePath,
      activeText,
      projectDir,
      cursorIndex: activeText.indexOf(doi) + 4,
      searchMode: "direct",
      selectedIndex: 0,
      settings: {
        sourceProfile: "general",
        primarySource: "crossref",
        fallbackSources: [],
        citationKeyMode: "authoryear"
      }
    },
    {
      fetchImpl: async (input) => {
        assert.match(String(input), /api\.crossref\.org\/works/);
        return crossrefWorkResponse();
      }
    }
  );

  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "Jumper2021");
  assert.match(response.activeFile.updatedText, /\\citep\{Jumper2021\}/);
  assert.match(await fs.readFile(path.join(projectDir, "refs.bib"), "utf8"), /doi = \{10\.1038\/s41586-021-03819-2\}/);
});

test("applyTexstudioRequest reuses an existing bibliography entry by DOI", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\bibliography{refs}\nExisting work \\citep{Jumper21}.",
    "refs.bib": [
      "@ARTICLE{AlphaFoldExisting,",
      "  title = {Highly accurate protein structure prediction with AlphaFold},",
      "  doi = {10.1038/s41586-021-03819-2},",
      "  year = {2021}",
      "}"
    ].join("\n")
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Jumper21") + 2,
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Highly accurate protein structure prediction with AlphaFold",
      authors: ["Jumper, John"],
      year: 2021,
      doi: "10.1038/s41586-021-03819-2",
      bibtex: "@article{candidate,title={Highly accurate protein structure prediction with AlphaFold},year={2021},doi={10.1038/s41586-021-03819-2}}"
    }
  });

  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "AlphaFoldExisting");
  assert.equal(response.reusedExistingEntry, true);
  assert.match(response.activeFile.updatedText, /\\citep\{AlphaFoldExisting\}/);
});

test("applyTexstudioRequest asks for a bibliography choice when the project is ambiguous", async () => {
  const projectDir = await makeProject({
    "main.tex": "Ambiguous project \\citep{Test2025}.",
    "alpha.bib": "",
    "beta.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Test2025") + 2,
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Test Paper",
      authors: ["Test, Author"],
      year: 2025,
      bibtex: "@article{candidate,title={Test Paper},year={2025}}"
    }
  });

  assert.equal(response.status, "needs-choice");
  assert.deepEqual(response.bibCandidates.sort(), ["alpha.bib", "beta.bib"]);
});

test("applyTexstudioRequest resolves bibliography paths from the root document", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\documentclass{article}\n\\begin{document}\n\\include{sections/intro}\n\\bibliography{bib/references}\n\\end{document}",
    "sections/intro.tex": "Nested document cite \\citep{Nested2025}.",
    "bib/references.bib": ""
  });
  const activeFilePath = path.join(projectDir, "sections", "intro.tex");
  const rootFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");
  const rootText = await fs.readFile(rootFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    rootFilePath,
    rootText,
    projectDir,
    cursorIndex: activeText.indexOf("Nested2025") + 2,
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Nested Root Bibliography",
      authors: ["Root, Riley"],
      year: 2025,
      bibtex: "@article{candidate,title={Nested Root Bibliography},author={Root, Riley},year={2025}}"
    }
  });

  assert.equal(response.status, "applied");
  assert.equal(response.bibFile.relativePath, "bib/references.bib");
  assert.match(await fs.readFile(path.join(projectDir, "bib", "references.bib"), "utf8"), /Root2025/);
});

test("loadTexstudioSettings layers user, project, TeXstudio, request, and env settings", async () => {
  const projectDir = await makeProject({
    ".overcite.json": JSON.stringify({
      sourceProfile: "math",
      citationKeyMode: "authoryear-underscore",
      sourceApiTokens: {
        ncbi: "project-ncbi"
      }
    }),
    ".overcite-texstudio.json": JSON.stringify({
      citationKeyMode: "authoryear-colon",
      fallbackSources: ["crossref"]
    })
  });
  const userConfigPath = path.join(projectDir, "user-settings.json");
  await fs.writeFile(userConfigPath, JSON.stringify({
    sourceProfile: "astrophysics",
    adsApiToken: "user-ads",
    bibliographyInsertMode: "append"
  }), "utf8");

  const settings = await loadTexstudioSettings({
    projectDir,
    userConfigPath,
    requestSettings: {
      bibliographyInsertMode: "alphabetical"
    },
    env: {
      OVERCITE_ADS_API_TOKEN: "env-ads",
      NCBI_API_KEY: "env-ncbi"
    }
  });

  assert.equal(settings.sourceProfile, "math");
  assert.equal(settings.primarySource, "arxiv");
  assert.deepEqual(settings.fallbackSources, ["crossref"]);
  assert.equal(settings.citationKeyMode, "authoryear-colon");
  assert.equal(settings.bibliographyInsertMode, "alphabetical");
  assert.equal(settings.sourceApiTokens.ads, "user-ads");
  assert.equal(settings.sourceApiTokens.ncbi, "project-ncbi");
});

test("applyTexstudioRequest honors v0.3.0 colon keys and alphabetical insertion", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\bibliography{refs}\nAlphaFold \\citep{Jumper21}.",
    "refs.bib": [
      "@ARTICLE{Zeta2020,",
      "  title = {Later Entry},",
      "  year = {2020}",
      "}"
    ].join("\n")
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Jumper21") + 2,
    settings: {
      citationKeyMode: "authoryear-colon",
      bibliographyInsertMode: "alphabetical"
    },
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Highly accurate protein structure prediction with AlphaFold",
      authors: ["Jumper, John"],
      year: 2021,
      doi: "10.1038/s41586-021-03819-2",
      bibtex: "@article{candidate,title={Highly accurate protein structure prediction with AlphaFold},author={Jumper, John},year={2021},doi={10.1038/s41586-021-03819-2}}"
    }
  });

  const bibText = await fs.readFile(path.join(projectDir, "refs.bib"), "utf8");
  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "Jumper:2021");
  assert.ok(bibText.indexOf("@article{Jumper:2021,") < bibText.indexOf("@ARTICLE{Zeta2020,"));
  assert.match(response.activeFile.updatedText, /\\citep\{Jumper:2021\}/);
});

test("applyTexstudioRequest can use line and column when TeXstudio does not send an absolute cursor index", async () => {
  const projectDir = await makeProject({
    "main.tex": [
      "\\bibliography{refs}",
      "Line-column cite \\citep{Line2025}."
    ].join("\n"),
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursor: {
      line: 1,
      column: activeText.split("\n")[1].indexOf("Line2025") + 3,
      lineBase: 0,
      columnBase: 0
    },
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Line Column Citation",
      authors: ["Column, Carol"],
      year: 2025,
      bibtex: "@article{candidate,title={Line Column Citation},author={Column, Carol},year={2025}}"
    }
  });

  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "Column2025");
  assert.match(response.activeFile.updatedText, /\\citep\{Column2025\}/);
});

test("applyTexstudioRequest updates only the active token in a multi-citation command", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\bibliography{refs}\nMulti cite \\citep{Keep2019, Replace2025, AlsoKeep2020}.",
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Replace2025") + 4,
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Replacement Citation",
      authors: ["Resolved, Riley"],
      year: 2025,
      bibtex: "@article{candidate,title={Replacement Citation},author={Resolved, Riley},year={2025}}"
    }
  });

  assert.equal(response.status, "applied");
  assert.equal(response.finalKey, "Resolved2025");
  assert.match(response.activeFile.updatedText, /\\citep\{Keep2019, Resolved2025, AlsoKeep2020\}/);
  assert.equal(
    response.activeFile.updatedText,
    activeText.replace("Replace2025", "Resolved2025")
  );
  assert.equal(response.activeEdit.start, activeText.indexOf("Replace2025"));
  assert.equal(response.activeEdit.end, activeText.indexOf("Replace2025") + "Replace2025".length);
});

test("applyTexstudioRequest honors an explicit bibliography choice", async () => {
  const projectDir = await makeProject({
    "main.tex": "Ambiguous explicit project \\citep{Choice2025}.",
    "alpha.bib": "",
    "beta.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");

  const response = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    bibTarget: "beta.bib",
    cursorIndex: activeText.indexOf("Choice2025") + 3,
    selectedCandidate: {
      sourceId: "crossref",
      sourceLabel: "Crossref",
      title: "Explicit Bibliography Choice",
      authors: ["Choice, Bea"],
      year: 2025,
      bibtex: "@article{candidate,title={Explicit Bibliography Choice},author={Choice, Bea},year={2025}}"
    }
  });

  assert.equal(response.status, "applied");
  assert.equal(response.bibFile.relativePath, "beta.bib");
  assert.equal(await fs.readFile(path.join(projectDir, "alpha.bib"), "utf8"), "");
  assert.match(await fs.readFile(path.join(projectDir, "beta.bib"), "utf8"), /Choice2025/);
});

test("applyTexstudioRequest keeps explicit bibliography choices inside the project", async () => {
  const projectDir = await makeProject({
    "main.tex": "External target \\citep{Outside2025}.",
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");
  const selectedCandidate = {
    sourceId: "crossref",
    sourceLabel: "Crossref",
    title: "Outside Target Citation",
    authors: ["Outside, Olive"],
    year: 2025,
    bibtex: "@article{candidate,title={Outside Target Citation},author={Outside, Olive},year={2025}}"
  };

  await assert.rejects(
    () => applyTexstudioRequest({
      activeFilePath,
      activeText,
      projectDir,
      bibTarget: "../outside.bib",
      cursorIndex: activeText.indexOf("Outside2025") + 3,
      selectedCandidate
    }),
    /inside the TeXstudio project/
  );
  await assert.rejects(
    () => applyTexstudioRequest({
      activeFilePath,
      activeText,
      projectDir,
      bibTarget: "notes.txt",
      cursorIndex: activeText.indexOf("Outside2025") + 3,
      selectedCandidate
    }),
    /must be a \.bib file/
  );
});

test("applyTexstudioRequest supports dry-run writes and active-file writes", async () => {
  const projectDir = await makeProject({
    "main.tex": "\\bibliography{refs}\nDry run \\citep{Dry2025}.",
    "refs.bib": ""
  });
  const activeFilePath = path.join(projectDir, "main.tex");
  const activeText = await fs.readFile(activeFilePath, "utf8");
  const selectedCandidate = {
    sourceId: "crossref",
    sourceLabel: "Crossref",
    title: "Dry Run Citation",
    authors: ["Written, Wendy"],
    year: 2025,
    bibtex: "@article{candidate,title={Dry Run Citation},author={Written, Wendy},year={2025}}"
  };

  const dryRun = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Dry2025") + 2,
    writeBibFile: false,
    selectedCandidate
  });
  assert.equal(dryRun.status, "applied");
  assert.equal(dryRun.bibFile.written, false);
  assert.equal(await fs.readFile(path.join(projectDir, "refs.bib"), "utf8"), "");
  assert.equal(await fs.readFile(activeFilePath, "utf8"), activeText);

  const writeActive = await applyTexstudioRequest({
    activeFilePath,
    activeText,
    projectDir,
    cursorIndex: activeText.indexOf("Dry2025") + 2,
    writeActiveFile: true,
    selectedCandidate
  });
  assert.equal(writeActive.activeFile.written, true);
  assert.match(await fs.readFile(activeFilePath, "utf8"), /\\citep\{Written2025\}/);
});

test("listProjectFiles scans TeX and Bib files while skipping heavy generated directories", async () => {
  const projectDir = await makeProject({
    "main.tex": "",
    "refs.bib": "",
    "sections/intro.tex": "",
    "node_modules/ignored.tex": "",
    "build/ignored.bib": "",
    "notes.txt": ""
  });

  const files = await listProjectFiles(projectDir);
  assert.deepEqual(files.sort(), ["main.tex", "refs.bib", "sections/intro.tex"]);
});

async function makeProject(files) {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "overcite-texstudio-"));
  for (const [name, text] of Object.entries(files)) {
    const filePath = path.join(projectDir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, text, "utf8");
  }
  return projectDir;
}

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

function crossrefSearchResponse() {
  return okJson({
    message: {
      items: [
        {
          DOI: "10.1038/s41586-021-03819-2",
          title: ["Highly accurate protein structure prediction with AlphaFold"],
          author: [{ family: "Jumper", given: "John" }],
          issued: { "date-parts": [[2021]] },
          type: "journal-article",
          "container-title": ["Nature"],
          publisher: "Springer Science and Business Media LLC",
          URL: "https://doi.org/10.1038/s41586-021-03819-2"
        }
      ]
    }
  });
}

function crossrefWorkResponse() {
  return okJson({
    message: {
      DOI: "10.1038/s41586-021-03819-2",
      title: ["Highly accurate protein structure prediction with AlphaFold"],
      author: [{ family: "Jumper", given: "John" }],
      issued: { "date-parts": [[2021]] },
      type: "journal-article",
      "container-title": ["Nature"],
      publisher: "Springer Science and Business Media LLC",
      URL: "https://doi.org/10.1038/s41586-021-03819-2"
    }
  });
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
