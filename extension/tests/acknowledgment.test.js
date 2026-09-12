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
  createAcknowledgmentReminderClaim,
  disableAcknowledgmentReminder
} from "../src/core/acknowledgment.js";

test("new and upgrading browser users schedule the reminder for 90 days", async () => {
  const currentTime = 1_800_000_000_000;
  for (const initialState of [{}, { adsApiToken: "existing-user-token", acknowledgmentReminderVersion: 1 }]) {
    const storage = createStorage(initialState);
    const claim = createAcknowledgmentReminderClaim(storage, { now: () => currentTime });

    assert.equal(await claim(), true);
    assert.equal(await claim(), false);
    assert.equal(storage.state[ACKNOWLEDGMENT_REMINDER_STORAGE_KEY], ACKNOWLEDGMENT_REMINDER_VERSION);
    assert.equal(
      storage.state[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY],
      currentTime + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
    );
    assert.equal(storage.setCalls, 1);
  }
});

test("browser reminder stays suppressed until 90 days have elapsed", async () => {
  const currentTime = 1_800_000_000_000;
  const storage = createStorage({
    [ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY]: currentTime + 1
  });
  assert.equal(await createAcknowledgmentReminderClaim(storage, { now: () => currentTime })(), false);
  assert.equal(storage.setCalls, 0);

  const nextSessionClaim = createAcknowledgmentReminderClaim(storage, { now: () => currentTime + 1 });
  assert.equal(await nextSessionClaim(), true);
  assert.equal(
    storage.state[ACKNOWLEDGMENT_REMINDER_NEXT_AT_STORAGE_KEY],
    currentTime + 1 + ACKNOWLEDGMENT_REMINDER_INTERVAL_MS
  );
});

test("browser reminder respects permanent opt-out", async () => {
  const storage = createStorage({ [ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY]: true });
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
    ACKNOWLEDGMENT_REMINDER_PROMPT,
    "Publishing work that used OverCite? Please consider acknowledging it!"
  );
  assert.equal(
    ACKNOWLEDGMENT_TEXT,
    "This work made use of \\texttt{OverCite} \\citep{Shariat2026}, an in-editor citation tool for \\LaTeX."
  );
});

test("browser permanent opt-out is stored locally and fails closed", async () => {
  const storage = createStorage({});
  assert.equal(await disableAcknowledgmentReminder(storage), true);
  assert.equal(storage.state[ACKNOWLEDGMENT_REMINDER_DISABLED_STORAGE_KEY], true);
  assert.equal(await createAcknowledgmentReminderClaim(storage)(), false);

  assert.equal(await disableAcknowledgmentReminder({
    async set() {
      throw new Error("storage unavailable");
    }
  }), false);
});

function createStorage(initialState, { getDelayMs = 0, events = [] } = {}) {
  const state = { ...initialState };
  return {
    state,
    setCalls: 0,
    async get(keys) {
      events.push("get");
      if (getDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, getDelayMs));
      }
      const requestedKeys = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requestedKeys.map((key) => [key, state[key]]));
    },
    async set(values) {
      events.push("set");
      this.setCalls += 1;
      Object.assign(state, values);
    }
  };
}
