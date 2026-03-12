import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, "..");
const distRoot = path.join(extensionRoot, "dist");

const sharedEntries = ["icons", "src", "options.html"];

async function main() {
  const baseManifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));

  await rm(distRoot, { recursive: true, force: true });
  await mkdir(distRoot, { recursive: true });

  const chromeManifest = structuredClone(baseManifest);
  chromeManifest.background = {
    service_worker: "src/background.js",
    type: "module",
    preferred_environment: ["document", "service_worker"]
  };

  const firefoxManifest = structuredClone(baseManifest);
  firefoxManifest.background = {
    scripts: ["src/background.js"],
    service_worker: "src/background.js",
    type: "module",
    preferred_environment: ["document", "service_worker"]
  };

  await buildBrowserDist("chrome", chromeManifest);
  await buildBrowserDist("firefox", firefoxManifest);
}

async function buildBrowserDist(browserName, manifest) {
  const targetRoot = path.join(distRoot, browserName);
  await mkdir(targetRoot, { recursive: true });

  for (const entry of sharedEntries) {
    await cp(path.join(extensionRoot, entry), path.join(targetRoot, entry), { recursive: true });
  }

  await writeFile(
    path.join(targetRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
