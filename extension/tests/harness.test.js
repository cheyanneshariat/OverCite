import test from "node:test";
import assert from "node:assert/strict";

import { findCitationAtCursor } from "../src/core/citation.js";
import { applyBibInsertion } from "../src/core/bibtex.js";
import { resolveBibTargetFromProjectState } from "../src/core/project.js";
import { exportCandidateBibtex } from "../src/core/sources.js";

test("example TeX harness resolves references.bib and generates the default author-year Shariat key", async () => {
  const mainText = String.raw`\documentclass{article}
\begin{document}
Triples are common in the Galaxy, as shown by Gaia.
\bibliography{references}
\end{document}`;
  const bibText = String.raw`@ARTICLE{Joyce20,
  author = {{Joyce}, Meredith and {Leung}, Shing-Chi},
  title = "{Standing on the Shoulders of Giants}",
  year = 2020,
  doi = {10.1234/example}
}`;

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

  assert.equal(insertion.finalKey, "Shariat2025");
  assert.match(insertion.updatedBibText, /@ARTICLE\{Shariat2025,/);
});

test("broad provider candidate can generate BibTeX and insert without ADS", async () => {
  const mainText = String.raw`\documentclass{article}
\begin{document}
Transformers changed sequence modeling \citep{Vaswani17}.
\bibliography{references}
\end{document}`;
  const cursorIndex = mainText.indexOf("Vaswani17") + "Vaswani17".length;
  const citationContext = findCitationAtCursor(mainText, cursorIndex, 500);
  assert.ok(citationContext);

  const bibTarget = resolveBibTargetFromProjectState({
    mainText,
    activeFileName: "main.tex",
    projectFiles: ["main.tex", "references.bib"]
  });
  assert.equal(bibTarget.status, "resolved");

  const candidate = {
    sourceId: "crossref",
    sourceLabel: "Crossref",
    generatedKey: "Vaswani2017",
    title: "Attention Is All You Need",
    authors: ["Vaswani, Ashish", "Shazeer, Noam"],
    year: 2017,
    booktitle: "Advances in Neural Information Processing Systems",
    doi: "10.5555/3295222.3295349",
    type: "proceedings-article"
  };
  const bibtex = exportCandidateBibtex(candidate);
  const insertion = applyBibInsertion({
    bibText: "",
    bibtex,
    candidate
  });

  assert.equal(insertion.finalKey, "Vaswani2017");
  assert.match(insertion.updatedBibText, /@inproceedings\{Vaswani2017,/);
  assert.match(insertion.updatedBibText, /doi = \{10.5555\/3295222.3295349\}/);
});
