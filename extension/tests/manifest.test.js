import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest includes Chrome MV3 and Firefox metadata", async () => {
  const manifestText = await readFile(new URL("../manifest.json", import.meta.url), "utf8");
  const manifest = JSON.parse(manifestText);
  const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const packageJson = JSON.parse(packageText);

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.background.preferred_environment, ["document", "service_worker"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://overleaf.com/*",
    "https://www.overleaf.com/*",
    "https://api.adsabs.harvard.edu/*"
  ]);
  assert.deepEqual(manifest.optional_host_permissions, [
    "https://api.crossref.org/*",
    "https://api.datacite.org/*",
    "https://eutils.ncbi.nlm.nih.gov/*",
    "https://export.arxiv.org/*",
    "https://inspirehep.net/*"
  ]);
  assert.equal(manifest.icons["16"], "icons/icon-16.png");
  assert.equal(manifest.icons["32"], "icons/icon-32.png");
  assert.equal(manifest.icons["48"], "icons/icon-48.png");
  assert.equal(manifest.icons["96"], "icons/icon-96.png");
  assert.equal(manifest.icons["128"], "icons/icon-128.png");
  assert.equal(manifest.action.default_icon["16"], "icons/icon-16.png");
  assert.equal(manifest.action.default_icon["32"], "icons/icon-32.png");
  assert.ok(!("default_popup" in manifest.action), "toolbar action should directly trigger OverCite");
  assert.equal(manifest.commands["open-ezcite"].suggested_key.default, "Alt+Shift+E");
  assert.equal(manifest.commands["open-ezcite"].suggested_key.mac, "Alt+Shift+E");
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://overleaf.com/*",
    "https://www.overleaf.com/*"
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, ["src/content-script.js"]);
  assert.equal(manifest.browser_specific_settings.gecko.id, "overcite-addon@example.com");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["authenticationInfo", "websiteContent"]
  );
});

test("Safari wrapper keeps one internally consistent marketing version", async (context) => {
  let projectText;
  try {
    projectText = await readFile(
      new URL("../../safari/OverCite.xcodeproj/project.pbxproj", import.meta.url),
      "utf8"
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("Safari wrapper is not included in the Firefox reviewer source archive.");
      return;
    }
    throw error;
  }
  const versions = [...projectText.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]);

  assert.ok(versions.length > 0, "missing Safari MARKETING_VERSION settings");
  assert.equal(new Set(versions).size, 1);
  assert.match(versions[0], /^\d+\.\d+\.\d+$/);
});

test("background trigger path accepts Overleaf project tabs on both hostnames", async () => {
  const backgroundText = await readFile(new URL("../src/background.js", import.meta.url), "utf8");

  assert.match(backgroundText, /commands\.onCommand\.addListener\(\(command\) => \{/);
  assert.match(backgroundText, /command !== "open-ezcite"/);
  assert.match(backgroundText, /action\.onClicked\.addListener\(\(tab\) => \{/);
  assert.match(backgroundText, /safeSendMessageToTab\(tab\.id, \{ type: "ezcite:openOverlay" \}\)/);
  assert.match(backgroundText, /parsed\.hostname === "overleaf\.com" \|\| parsed\.hostname === "www\.overleaf\.com"/);
  assert.match(backgroundText, /parsed\.pathname\.startsWith\("\/project\/"\)/);
});
