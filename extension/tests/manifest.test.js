import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest includes Chrome MV3 and Firefox metadata", async () => {
  const manifestText = await readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.background.preferred_environment, ["document", "service_worker"]);
  assert.equal(manifest.icons["16"], "icons/icon-16.png");
  assert.equal(manifest.icons["32"], "icons/icon-32.png");
  assert.equal(manifest.icons["48"], "icons/icon-48.png");
  assert.equal(manifest.icons["96"], "icons/icon-96.png");
  assert.equal(manifest.icons["128"], "icons/icon-128.png");
  assert.equal(manifest.action.default_icon["16"], "icons/icon-16.png");
  assert.equal(manifest.action.default_icon["32"], "icons/icon-32.png");
  assert.equal(manifest.browser_specific_settings.gecko.id, "overcite-addon@example.com");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "121.0");
});
