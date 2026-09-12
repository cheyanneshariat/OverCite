import test from "node:test";
import assert from "node:assert/strict";
import { runOrderedQueryQueue } from "../src/core/query-queue.js";

test("rolling queue preserves ordered checkpoints and fills idle slots", async (t) => {
  const starts = [];
  const checkpoints = [];
  let active = 0;
  let peak = 0;
  const start = performance.now();
  await runOrderedQueryQueue(Array.from({ length: 12 }, (_, i) => i), {
    async fetchQuery(index) {
      starts[index] = performance.now() - start;
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, index === 0 || index === 4 ? 100 : 5));
      active -= 1;
      if (index === 6) throw new Error("provider failure");
      return index;
    },
    onBatch(results) { checkpoints.push(results.map((item) => item.status === "fulfilled" ? item.value : "error")); }
  });
  const elapsed = performance.now() - start;
  assert.deepEqual(checkpoints, [[0, 1, 2, 3], [4, 5, "error", 7], [8, 9, 10, 11]]);
  assert.equal(peak, 4);
  assert.ok(starts[4] < 80, "the second slow query must start before the first finishes");
  t.diagnostic(`Controlled 100ms slow requests: rolling completion ${elapsed.toFixed(1)}ms; sequential batches require at least 200ms. Not a live provider measurement.`);
});

test("early confidence keeps speculative responses out of the winning checkpoint", async () => {
  const started = [];
  let winning;
  await runOrderedQueryQueue(Array.from({ length: 20 }, (_, i) => i), {
    async fetchQuery(index) {
      started.push(index);
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 30 : 1));
      return index;
    },
    onBatch(results) { winning = results.map((item) => item.value); return true; }
  });
  assert.deepEqual(winning, [0, 1, 2, 3]);
  assert.ok(started.length <= 8);
  const count = started.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(started.length, count, "a stopped queue must not start more work");
});

test("empty and short queues retain every ordered outcome", async () => {
  for (const length of [0, 1, 2, 3, 5, 7, 9, 17]) {
    const seen = [];
    await runOrderedQueryQueue(Array.from({ length }, (_, i) => i), {
      fetchQuery: async (i) => i,
      onBatch(results) { seen.push(...results.map((item) => item.value)); }
    });
    assert.deepEqual(seen, Array.from({ length }, (_, i) => i));
  }
});
