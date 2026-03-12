import test from "node:test";
import assert from "node:assert/strict";

import { resolveBibTargetFromProjectState } from "../src/core/project.js";

test("resolveBibTargetFromProjectState works with any single .bib file name", () => {
  const result = resolveBibTargetFromProjectState({
    mainText: "\\documentclass{article}\n\\begin{document}\n\\bibliography{my_library}\n\\end{document}",
    activeFileName: "main.tex",
    projectFiles: ["main.tex", "my_library.bib"]
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.target, "my_library.bib");
});

test("resolveBibTargetFromProjectState respects nonstandard bibliography directives", () => {
  const result = resolveBibTargetFromProjectState({
    mainText: "\\addbibresource{astro_refs.bib}",
    activeFileName: "paper.tex",
    projectFiles: ["paper.tex", "astro_refs.bib", "notes.bib"]
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.target, "astro_refs.bib");
});

test("resolveBibTargetFromProjectState prompts when multiple .bib files remain ambiguous", () => {
  const result = resolveBibTargetFromProjectState({
    mainText: "\\section{Test}",
    activeFileName: "main.tex",
    projectFiles: ["main.tex", "catalog.bib", "sources.bib"]
  });

  assert.equal(result.status, "needs-choice");
  assert.deepEqual(result.candidates, ["catalog.bib", "sources.bib"]);
});
