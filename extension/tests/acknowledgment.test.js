import assert from "node:assert/strict";
import test from "node:test";

import {
  ACKNOWLEDGMENT_REMINDER_STORAGE_KEY,
  ACKNOWLEDGMENT_REMINDER_VERSION,
  ACKNOWLEDGMENT_TEXT,
  createAcknowledgmentReminderClaim
} from "../src/core/acknowledgment.js";

test("new and upgrading browser users claim reminder version 1 exactly once", async () => {
  for (const initialState of [{}, { adsApiToken: "existing-user-token", themeMode: "dark" }]) {
    const storage = createStorage(initialState);
    const claim = createAcknowledgmentReminderClaim(storage);

    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    assert.equal(storage.state[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY], ACKNOWLEDGMENT_REMINDER_VERSION);
    assert.equal(storage.setCalls, 1);
  }
});

test("browser reminder remains suppressed after a background restart", async () => {
  const storage = createStorage({ [ACKNOWLEDGMENT_REMINDER_STORAGE_KEY]: 1 });
  assert.equal(await createAcknowledgmentReminderClaim(storage)(), false);
  assert.equal(storage.setCalls, 0);
});

test("concurrent browser claims can only show one reminder", async () => {
  const storage = createStorage({}, { getDelayMs: 15 });
  const claim = createAcknowledgmentReminderClaim(storage);
  assert.deepEqual(await Promise.all([claim(), claim(), claim()]), [true, false, false]);
  assert.equal(storage.setCalls, 1);
});

test("browser claim records the receipt before reporting that the reminder should show", async () => {
  const events = [];
  const storage = createStorage({}, { events });
  const claim = createAcknowledgmentReminderClaim(storage);
  assert.equal(await claim(), true);
  assert.deepEqual(events, ["get", "set"]);
});

test("browser read or write failure suppresses the reminder instead of repeating it", async () => {
  for (const failingMethod of ["get", "set"]) {
    const storage = {
      async get() {
        if (failingMethod === "get") {
          throw new Error("storage read unavailable");
        }
        return {};
      },
      async set() {
        if (failingMethod === "set") {
          throw new Error("storage write unavailable");
        }
        assert.fail("set should not run after get fails");
      }
    };
    const claim = createAcknowledgmentReminderClaim(storage);
    assert.equal(await claim(), false);
    assert.equal(await claim(), false);
  }
});

test("acknowledgment clipboard text stays aligned with the published guidance", () => {
  assert.equal(
    ACKNOWLEDGMENT_TEXT,
    "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX."
  );
});

function createStorage(initialState, { getDelayMs = 0, events = [] } = {}) {
  const state = { ...initialState };
  return {
    state,
    setCalls: 0,
    async get(key) {
      events.push("get");
      if (getDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, getDelayMs));
      }
      return { [key]: state[key] };
    },
    async set(values) {
      events.push("set");
      this.setCalls += 1;
      Object.assign(state, values);
    }
  };
}
