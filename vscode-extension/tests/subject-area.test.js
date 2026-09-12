import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  SUBJECT_AREA_CHOICES,
  SUBJECT_AREA_ONBOARDING_STORAGE_KEY,
  createSubjectAreaOnboarding,
  needsAdsTokenSetup
} from "../src/subject-area.js";

test("new VS Code users must choose a subject before lookup and are prompted only once", async () => {
  const state = createGlobalState();
  const updates = [];
  let prompts = 0;
  const ensure = createSubjectAreaOnboarding({
    globalState: state,
    inspectSourceProfile: () => ({ defaultValue: "" }),
    async showQuickPick(items, options) {
      prompts += 1;
      assert.equal(items.some((item) => item.picked), false);
      assert.match(options.placeHolder, /Choose your subject area/);
      return items.find((item) => item.profile === "computer-science");
    },
    async updateSourceProfile(profile) {
      updates.push(profile);
    }
  });

  assert.equal(await ensure(), true);
  assert.equal(await ensure(), true);
  assert.equal(prompts, 1);
  assert.deepEqual(updates, ["computer-science"]);
  assert.equal(state.values[SUBJECT_AREA_ONBOARDING_STORAGE_KEY], 1);
});

test("cancelling subject setup cancels lookup without saving a default", async () => {
  const state = createGlobalState();
  let updates = 0;
  const ensure = createSubjectAreaOnboarding({
    globalState: state,
    inspectSourceProfile: () => ({}),
    async showQuickPick() {
      return undefined;
    },
    async updateSourceProfile() {
      updates += 1;
    }
  });

  assert.equal(await ensure(), false);
  assert.equal(updates, 0);
  assert.equal(state.values[SUBJECT_AREA_ONBOARDING_STORAGE_KEY], undefined);
});

test("an explicit existing VS Code setting is preserved without a prompt", async () => {
  const state = createGlobalState();
  let prompts = 0;
  const ensure = createSubjectAreaOnboarding({
    globalState: state,
    inspectSourceProfile: () => ({ defaultValue: "", workspaceValue: "physics" }),
    async showQuickPick() {
      prompts += 1;
    },
    async updateSourceProfile() {
      assert.fail("explicit settings must not be overwritten");
    }
  });

  assert.equal(await ensure(), true);
  assert.equal(prompts, 0);
  assert.equal(state.values[SUBJECT_AREA_ONBOARDING_STORAGE_KEY], 1);
});

test("an explicit custom VS Code route is also preserved", async () => {
  const state = createGlobalState();
  const ensure = createSubjectAreaOnboarding({
    globalState: state,
    inspectSourceProfile: () => ({ globalValue: "custom" }),
    async showQuickPick() {
      assert.fail("custom routing must not trigger onboarding");
    },
    async updateSourceProfile() {
      assert.fail("custom routing must not be overwritten");
    }
  });
  assert.equal(await ensure(), true);
});

test("subject choices cover all supported disciplines without a selected default", () => {
  assert.deepEqual(SUBJECT_AREA_CHOICES.map(({ profile }) => profile), [
    "general",
    "physics",
    "computer-science",
    "math",
    "life-sciences",
    "chemistry",
    "astrophysics"
  ]);
  assert.equal(SUBJECT_AREA_CHOICES.some((choice) => Object.hasOwn(choice, "picked")), false);
});

test("concurrent VS Code commands share one subject prompt", async () => {
  const state = createGlobalState();
  let prompts = 0;
  let releasePrompt;
  const ensure = createSubjectAreaOnboarding({
    globalState: state,
    inspectSourceProfile: () => ({}),
    showQuickPick() {
      prompts += 1;
      return new Promise((resolve) => {
        releasePrompt = () => resolve({ profile: "general" });
      });
    },
    async updateSourceProfile() {}
  });
  const first = ensure();
  const second = ensure();
  assert.equal(prompts, 1);
  releasePrompt();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("VS Code redirects only ADS-only routes that lack a token", () => {
  assert.equal(needsAdsTokenSetup({ primarySource: "ads", fallbackSources: [], adsApiToken: "" }), true);
  assert.equal(needsAdsTokenSetup({ primarySource: "ads", fallbackSources: [], sourceApiTokens: { ads: "token" } }), false);
  assert.equal(needsAdsTokenSetup({ primarySource: "ads", fallbackSources: ["crossref"], adsApiToken: "" }), false);
  assert.equal(needsAdsTokenSetup({ primarySource: "crossref", fallbackSources: [], adsApiToken: "" }), false);
});

test("both VS Code entrypoints open the ADS token setting instead of blind retry", async () => {
  for (const fileName of ["extension.js", "extension.cjs"]) {
    const source = await readFile(new URL(`../src/${fileName}`, import.meta.url), "utf8");
    assert.match(source, /if \(needsAdsTokenSetup\(settings\)\)/);
    assert.match(source, /workbench\.action\.openSettings", "overcite\.adsApiToken"/);
    assert.match(source, /showErrorMessage\(message, "Open settings"\)/);
    assert.match(source, /Add your NASA ADS or SciX API token, then run OverCite again/);
  }
});

function createGlobalState(initial = {}) {
  const values = { ...initial };
  return {
    values,
    get(key, fallback) {
      return Object.hasOwn(values, key) ? values[key] : fallback;
    },
    async update(key, value) {
      values[key] = value;
    }
  };
}
