// Keep final confidence checkpoints in query order, while refilling free
// network slots. Speculation is limited to one checkpoint ahead (at most four
// extra requests), and never changes the candidates at an earlier checkpoint.
export async function runOrderedQueryQueue(queries, { fetchQuery, onBatch, onProgress = () => {}, batchSize = 4 }) {
  const slots = new Map();
  let next = 0;
  let active = 0;
  let checkpoint = 0;
  let stopped = false;

  function pump() {
    const limit = Math.min(queries.length, checkpoint + 2 * batchSize);
    while (!stopped && active < batchSize && next < limit) {
      const index = next++;
      active += 1;
      const result = Promise.resolve().then(() => fetchQuery(queries[index])).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason })
      );
      slots.set(index, result);
      void result.then((batch) => {
        active -= 1;
        try {
          if (!stopped && index < checkpoint + batchSize && batch.status === "fulfilled") {
            onProgress(batch.value, index);
          }
        } finally {
          pump();
        }
      }).catch(() => {});
    }
  }

  try {
    pump();
    while (checkpoint < queries.length) {
      const end = Math.min(queries.length, checkpoint + batchSize);
      const batches = [];
      for (let index = checkpoint; index < end; index += 1) {
        batches.push(await slots.get(index));
      }
      if (await onBatch(batches, checkpoint)) break;
      for (let index = checkpoint; index < end; index += 1) slots.delete(index);
      checkpoint = end;
      pump();
    }
  } finally {
    stopped = true;
    // The caller owns request cancellation and aborts outstanding fetches.
  }
}
