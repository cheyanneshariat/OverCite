import test from "node:test";
import assert from "node:assert/strict";

import { applySelectionMemoryBoost, buildSelectionMemoryEntry, recordSelection } from "../src/core/memory.js";

test("buildSelectionMemoryEntry stores normalized token and sentence features", () => {
  const entry = buildSelectionMemoryEntry({
    citationContext: {
      token: "Shariat",
      sentenceText: "People find that magnetic braking saturates",
      parsedKeyHint: { surname: "Shariat" }
    },
    candidate: {
      bibcode: "good"
    }
  });

  assert.equal(entry.bibcode, "good");
  assert.equal(entry.token, "shariat");
  assert.equal(entry.surname, "shariat");
  assert.equal(entry.sentencePhrase, "magnetic braking saturates");
  assert.deepEqual(entry.sentenceKeywords, ["magnetic", "braking", "saturates"]);
});

test("recordSelection keeps the newest matching selection and caps the list", () => {
  const current = [
    { bibcode: "old", token: "a", sentencePhrase: "x" },
    { bibcode: "dup", token: "b", sentencePhrase: "y" }
  ];
  const updated = recordSelection(current, { bibcode: "dup", token: "b", sentencePhrase: "y", timestamp: 1 });
  assert.equal(updated.length, 2);
  assert.equal(updated[0].bibcode, "dup");
});

test("applySelectionMemoryBoost boosts previously selected bibcodes for similar context", () => {
  const citationContext = {
    token: "Shariat",
    sentenceText: "People find that magnetic braking saturates",
    parsedKeyHint: { surname: "Shariat" }
  };
  const memory = [
    buildSelectionMemoryEntry({
      citationContext,
      candidate: { bibcode: "good" }
    })
  ];
  const ranked = applySelectionMemoryBoost(
    citationContext,
    [
      { bibcode: "bad", score: 100 },
      { bibcode: "good", score: 60 }
    ],
    memory
  );

  assert.equal(ranked[0].bibcode, "good");
  assert.ok(ranked[0].memoryBoost > 0);
});
