import assert from "node:assert/strict";
import test from "node:test";

import {
  ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_INTERVAL_MS,
  ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_PROMPT,
  ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_VERSION,
  ACKNOWLEDGMENT_TEXT,
  COPY_ACKNOWLEDGMENT_ACTION,
  NEVER_REMIND_ACTION,
  REMIND_LATER_ACTION,
  createCompletionNotifier
} from "../src/acknowledgment.js";

test("VS Code schedules the exact reminder for 90 days after a successful insertion", async () => {
  const currentTime = 1_800_000_000_000;
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
    },
    now: () => currentTime
  });

  assert.equal(await notify("Inserted Shariat2026 in references.bib"), true);
  assert.equal(await notify("Inserted Another2026 in references.bib"), false);
  assert.deepEqual(events.slice(0, 3), ["update", "update", "show"], "next date must be stored before display");
  assert.equal(messages[0].message, ACKNOWLEDGMENT_REMINDER_PROMPT);
  assert.deepEqual(messages[0].actions, [
    COPY_ACKNOWLEDGMENT_ACTION,
    REMIND_LATER_ACTION,
    NEVER_REMIND_ACTION
  ]);
  assert.equal(messages[1].message, "Inserted Another2026 in references.bib");
  assert.deepEqual(messages[1].actions, []);
  assert.equal(state.values[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY], ACKNOWLEDGMENT_REMINDER_VERSION);
  assert.equal(
    state.values[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY],
    currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
  );
});

test("VS Code suppresses the reminder before 90 days and shows it when due", async () => {
  const currentTime = 1_800_000_000_000;
  const state = createGlobalState({
    [ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY]: currentTime + 1
  });
  const messages = [];
  const createNotifier = (time) => createCompletionNotifier({
    globalState: state,
    async showInformationMessage(message) {
      messages.push(message);
    },
    async writeClipboard() {},
    now: () => time
  });
  assert.equal(await createNotifier(currentTime)("Citation inserted."), false);
  assert.equal(await createNotifier(currentTime + 1)("Citation inserted."), true);
  assert.deepEqual(messages, ["Citation inserted.", ACKNOWLEDGMENT_REMINDER_PROMPT]);
});

test("VS Code long-time users with legacy reminder state enter the 90-day schedule", async () => {
  const state = createGlobalState({ [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: 1 });
  const calls = [];
  const notify = createCompletionNotifier({
    globalState: state,
    async showInformationMessage(...args) {
      calls.push(args);
    },
    async writeClipboard() {}
  });
  assert.equal(await notify("Citation inserted."), true);
  assert.equal(calls[0][0], ACKNOWLEDGMENT_REMINDER_PROMPT);
  assert.equal(state.updateCalls, 2);
});

test("VS Code permanently suppresses reminders after opt-out", async () => {
  const state = createGlobalState({ [ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY]: true });
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

test("VS Code stores permanent opt-out when requested", async () => {
  const state = createGlobalState({});
  const notify = createCompletionNotifier({
    globalState: state,
    async showInformationMessage(_message, ...actions) {
      return actions.includes(NEVER_REMIND_ACTION) ? NEVER_REMIND_ACTION : undefined;
    },
    async writeClipboard() {}
  });
  assert.equal(await notify("Citation inserted."), true);
  assert.equal(state.values[ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY], true);
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

test("acknowledgment reminder wording is exact", () => {
  assert.equal(
    ACKNOWLEDGMENT_REMINDER_PROMPT,
    "Publishing work that used OverCite? Please consider acknowledging it!"
  );
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
