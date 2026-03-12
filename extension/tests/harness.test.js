import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findCitationAtCursor } from "../src/core/citation.js";
import { applyBibInsertion } from "../src/core/bibtex.js";
import { resolveBibTargetFromProjectState } from "../src/core/project.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");
const mainTexPath = path.join(workspaceRoot, "example_tex", "LSPs_ruwe", "main.tex");
const bibPath = path.join(workspaceRoot, "example_tex", "LSPs_ruwe", "references.bib");

test("example TeX harness resolves references.bib and generates the expected Shariat key", async () => {
  const mainText = await readFile(mainTexPath, "utf8");
  const bibText = await readFile(bibPath, "utf8");

  const syntheticSource = `${mainText}\nHere is my sentence \\citep{Shariat25}.`;
  const cursorIndex = syntheticSource.indexOf("Shariat25") + "Shariat25".length;
  const citationContext = findCitationAtCursor(syntheticSource, cursorIndex, 500);
  assert.ok(citationContext);

  const bibTarget = resolveBibTargetFromProjectState({
    mainText,
    activeFileName: "main.tex",
    projectFiles: ["main.tex", "references.bib"]
  });
  assert.equal(bibTarget.status, "resolved");
  assert.equal(bibTarget.target, "references.bib");

  const insertion = applyBibInsertion({
    bibText,
    bibtex: `@ARTICLE{2025PASP..137i4201S,
       author = {{Shariat}, Cheyanne and {El-Badry}, Kareem and {Naoz}, Smadar},
        title = "{10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations}",
      journal = {\\pasp},
         year = 2025,
          doi = {10.1088/1538-3873/adfb30},
       adsurl = {https://ui.adsabs.harvard.edu/abs/2025PASP..137i4201S}
}`,
    candidate: {
      bibcode: "2025PASP..137i4201S",
      title: "10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations",
      doi: "10.1088/1538-3873/adfb30",
      authors: ["Shariat, Cheyanne", "El-Badry, Kareem", "Naoz, Smadar"],
      year: 2025
    }
  });

  assert.equal(insertion.finalKey, "Shariat25_10k");
  assert.match(insertion.updatedBibText, /@ARTICLE\{Shariat25_10k,/);
});
