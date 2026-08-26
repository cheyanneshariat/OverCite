import assert from "node:assert/strict";
import test from "node:test";

import {
  ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
  ACKNOWLEDGMENT_TEXT,
  COPY_ACKNOWLEDGMENT_ACTION,
  createCompletionNotifier
} from "../src/acknowledgment.js";

test("VS Code shows the reminder once after the first successful insertion after update", async () => {
  const events = [];
  const state = createGlobalState({}, events);
  const messages = [];
  const notify = createCompletionNotifier({
    globalState: state,
    async showInformationMessage(message, ...actions) {
      messages.push({ message, actions });
      events.push("show");
      return undefined;
    },
    async writeClipboard() {
      assert.fail("clipboard should not run when the action is ignored");
    }
  });

  assert.equal(await notify("Inserted Shariat2026 in references.bib"), true);
  assert.equal(await notify("Inserted Another2026 in references.bib"), false);
  assert.deepEqual(events.slice(0, 2), ["update", "show"], "receipt must be stored before display");
  assert.match(messages[0].message, /please consider acknowledging it/);
  assert.deepEqual(messages[0].actions, [COPY_ACKNOWLEDGMENT_ACTION]);
  assert.equal(messages[1].message, "Inserted Another2026 in references.bib");
  assert.deepEqual(messages[1].actions, []);
  assert.equal(state.values[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY], 1);
});

test("VS Code long-time users with unrelated global state see the update reminder", async () => {
  const state = createGlobalState({ existingPreference: true });
  const messages = [];
  const notify = createCompletionNotifier({
    globalState: state,
    async showInformationMessage(message) {
      messages.push(message);
    },
    async writeClipboard() {}
  });
  assert.equal(await notify("Citation inserted."), true);
  assert.equal(messages.length, 1);
});

test("VS Code suppresses a reminder already recorded by an earlier session", async () => {
  const state = createGlobalState({ [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: 1 });
  const calls = [];
  const notify = createCompletionNotifier({
    globalState: state,
    async showInformationMessage(...args) {
      calls.push(args);
    },
    async writeClipboard() {}
  });
  assert.equal(await notify("Citation inserted."), false);
  assert.deepEqual(calls, [["Citation inserted."]]);
  assert.equal(state.updateCalls, 0);
});

test("VS Code copies the canonical acknowledgment only when requested", async () => {
  const copied = [];
  const notify = createCompletionNotifier({
    globalState: createGlobalState({}),
    async showInformationMessage(_message, ...actions) {
      return actions.includes(COPY_ACKNOWLEDGMENT_ACTION)
        ? COPY_ACKNOWLEDGMENT_ACTION
        : undefined;
    },
    async writeClipboard(text) {
      copied.push(text);
    }
  });
  assert.equal(await notify("Citation inserted."), true);
  assert.deepEqual(copied, [ACKNOWLEDGMENT_TEXT]);
});

test("VS Code storage failure keeps insertion success and never repeats the prompt", async () => {
  const messages = [];
  const notify = createCompletionNotifier({
    globalState: {
      get() {
        return 0;
      },
      async update() {
        throw new Error("storage unavailable");
      }
    },
    async showInformationMessage(...args) {
      messages.push(args);
    },
    async writeClipboard() {}
  });
  assert.equal(await notify("First citation inserted."), false);
  assert.equal(await notify("Second citation inserted."), false);
  assert.deepEqual(messages, [
    ["First citation inserted."],
    ["Second citation inserted."]
  ]);
});

function createGlobalState(initialValues, events = []) {
  const values = { ...initialValues };
  return {
    values,
    updateCalls: 0,
    get(key, fallback) {
      return Object.hasOwn(values, key) ? values[key] : fallback;
    },
    async update(key, value) {
      events.push("update");
      this.updateCalls += 1;
      values[key] = value;
    }
  };
}
