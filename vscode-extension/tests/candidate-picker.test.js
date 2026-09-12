import test from "node:test";
import assert from "node:assert/strict";
import { startCandidateSearch, showCandidatePicker } from "../src/candidate-picker.js";

test("ready candidates are usable before optional metadata, with final errors handled", async () => {
  let enrich;
  const results = [{ label: "one" }];
  const search = startCandidateSearch(async (publish) => {
    publish(results);
    return new Promise((resolve) => { enrich = resolve; });
  });
  assert.equal(await search.ready, results);
  enrich([{ label: "one", count: 50 }]);
  assert.equal((await search.final)[0].count, 50);
  const failed = startCandidateSearch(async () => { throw new Error("failed"); });
  await assert.rejects(failed.ready, /failed/);
  await assert.rejects(failed.final, /failed/);
});

test("metadata updates preserve picker items, focus and selection; late updates after close are ignored", async () => {
  let accept, hide, finishMetadata;
  let disposed = false;
  const item = { label: "paper", detail: "title", description: "2017", candidate: { title: "title" } };
  const picker = {
    activeItems: [item], selectedItems: [item], value: "paper",
    onDidAccept(fn) { accept = fn; return { dispose() {} }; },
    onDidHide(fn) { hide = fn; return { dispose() {} }; },
    show() {}, dispose() { disposed = true; }
  };
  const picked = showCandidatePicker({ createQuickPick: () => picker }, [item],
    new Promise((resolve) => { finishMetadata = resolve; }), "citation");
  finishMetadata([{ ...item, description: "2017 · 500 citations" }]);
  await Promise.resolve();
  assert.equal(picker.items[0], item);
  assert.equal(picker.activeItems[0], item);
  assert.equal(picker.selectedItems[0], item);
  assert.equal(picker.value, "paper");
  assert.match(item.description, /500/);
  accept();
  assert.equal(await picked, item);
  assert.equal(disposed, true);
  hide();
  disposed = false;
  const closed = showCandidatePicker({ createQuickPick: () => picker }, [item],
    new Promise((resolve) => { finishMetadata = resolve; }), "citation");
  hide();
  assert.equal(await closed, undefined);
  finishMetadata([{ ...item, description: "late" }]);
  await Promise.resolve();
  assert.notEqual(item.description, "late");
});

test("a settled enrichment promise preserves initial focus, Enter choice and the real QuickPick placeholder", async () => {
  let accept;
  const item = { label: "first", detail: "First paper", description: "2024" };
  const picker = {
    activeItems: [], selectedItems: [],
    onDidAccept(fn) { accept = fn; return { dispose() {} }; },
    onDidHide() { return { dispose() {} }; },
    show() {}, dispose() {}
  };
  const picked = showCandidatePicker({ createQuickPick: () => picker }, [item], Promise.resolve([{ ...item, description: "2024 · 10 citations" }]), "\\cite{Example2024}");
  await Promise.resolve();
  assert.equal(picker.placeholder, "\\cite{Example2024}");
  assert.equal(picker.placeHolder, undefined);
  assert.deepEqual(picker.activeItems, [item]);
  accept();
  assert.equal(await picked, item);
});
