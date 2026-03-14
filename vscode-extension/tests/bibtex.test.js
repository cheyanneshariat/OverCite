import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBibInsertion,
  buildTitleSlug,
  findBibMatch,
  generateInformativeKey,
  generatePreferredKey,
  insertBibtexEntryAlphabetically,
  parseBibEntries
} from "../src/core/bibtex.js";

test("buildTitleSlug turns a leading thousands number into a compact slug", () => {
  assert.equal(buildTitleSlug("10,000 Resolved Triples from Gaia"), "10k");
});

test("generateInformativeKey creates author-year-title keys", () => {
  const key = generateInformativeKey({
    authors: ["Shariat, Cheyanne"],
    year: 2025,
    title: "10,000 Resolved Triples from Gaia"
  });
  assert.equal(key, "Shariat25_10k");
});

test("findBibMatch deduplicates by DOI", () => {
  const bibText = `
@ARTICLE{Joyce20,
  title = {Standing on the Shoulders of Giants},
  doi = {10.3847/1538-4357/abb8db}
}
`;
  const entries = parseBibEntries(bibText);
  const match = findBibMatch(entries, {
    title: "Standing on the Shoulders of Giants",
    doi: "10.3847/1538-4357/abb8db"
  });
  assert.deepEqual(match, { key: "Joyce20", reason: "doi" });
});

test("applyBibInsertion reuses an existing entry instead of duplicating it", () => {
  const bibText = `
@ARTICLE{Joyce20,
  title = {Standing on the Shoulders of Giants},
  doi = {10.3847/1538-4357/abb8db}
}
`;
  const result = applyBibInsertion({
    bibText,
    bibtex: `@ARTICLE{2020ApJ...902...63J,
  title = {Standing on the Shoulders of Giants},
  doi = {10.3847/1538-4357/abb8db}
}`,
    candidate: {
      title: "Standing on the Shoulders of Giants",
      doi: "10.3847/1538-4357/abb8db",
      authors: ["Joyce, Meridith"],
      year: 2020
    }
  });
  assert.equal(result.finalKey, "Joyce20");
  assert.equal(result.updatedBibText, bibText);
});

test("generatePreferredKey can preserve the typed key", () => {
  const key = generatePreferredKey(
    {
      authors: ["Shariat, Cheyanne"],
      year: 2025,
      title: "10,000 Resolved Triples from Gaia"
    },
    [],
    { keyMode: "typed", typedToken: "Shariat25" }
  );
  assert.equal(key, "Shariat25");
});

test("applyBibInsertion can keep the typed key instead of adding a title slug", () => {
  const result = applyBibInsertion({
    bibText: "",
    bibtex: `@ARTICLE{2025PASP..137i4201S,
  title = {10,000 Resolved Triples from Gaia},
  doi = {10.1088/1538-3873/adfb30}
}`,
    candidate: {
      title: "10,000 Resolved Triples from Gaia",
      doi: "10.1088/1538-3873/adfb30",
      authors: ["Shariat, Cheyanne"],
      year: 2025,
      keyMode: "typed",
      typedToken: "Shariat25"
    }
  });
  assert.equal(result.finalKey, "Shariat25");
  assert.match(result.updatedBibText, /@ARTICLE\{Shariat25,/);
  assert.equal(result.cursorAnchor, result.updatedBibText.trimEnd().length);
});

test("insertBibtexEntryAlphabetically places a new entry before the next larger key", () => {
  const bibText = `
@ARTICLE{Goldberg24,
  title = {A Buddy for Betelgeuse},
  doi = {10.1111/example1}
}

@ARTICLE{Joyce20,
  title = {Standing on the Shoulders of Giants},
  doi = {10.1111/example2}
}
`;
  const updated = insertBibtexEntryAlphabetically(
    bibText,
    `@ARTICLE{ElBadry22,
  title = {Magnetic Braking Saturates},
  doi = {10.1111/example3}
}`,
    "ElBadry22"
  );
  const elBadryIndex = updated.indexOf("@ARTICLE{ElBadry22,");
  const goldbergIndex = updated.indexOf("@ARTICLE{Goldberg24,");
  assert.ok(elBadryIndex >= 0);
  assert.ok(goldbergIndex >= 0);
  assert.ok(elBadryIndex < goldbergIndex);
});

test("applyBibInsertion can insert new entries alphabetically by key", () => {
  const bibText = `
@ARTICLE{Goldberg24,
  title = {A Buddy for Betelgeuse},
  doi = {10.1111/example1}
}

@ARTICLE{Joyce20,
  title = {Standing on the Shoulders of Giants},
  doi = {10.1111/example2}
}
`;
  const result = applyBibInsertion({
    bibText,
    bibtex: `@ARTICLE{2022ApJ...000..000E,
  title = {Magnetic Braking Saturates},
  doi = {10.1111/example3}
}`,
    candidate: {
      title: "Magnetic Braking Saturates",
      doi: "10.1111/example3",
      authors: ["El-Badry, Kareem"],
      year: 2022,
      keyMode: "typed",
      typedToken: "ElBadry22",
      bibliographyInsertMode: "alphabetical"
    }
  });
  const elBadryIndex = result.updatedBibText.indexOf("@ARTICLE{ElBadry22,");
  const goldbergIndex = result.updatedBibText.indexOf("@ARTICLE{Goldberg24,");
  assert.ok(elBadryIndex >= 0);
  assert.ok(goldbergIndex >= 0);
  assert.ok(elBadryIndex < goldbergIndex);
  assert.equal(result.cursorAnchor, elBadryIndex + result.rewrittenBibtex.trim().length);
});
