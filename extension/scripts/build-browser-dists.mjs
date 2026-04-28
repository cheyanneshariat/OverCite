import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, "..");
const distRoot = path.join(extensionRoot, "dist");
const safariResourcesRoot = path.resolve(extensionRoot, "..", "safari", "OverCite Extension", "Resources");

const sharedEntries = ["src", "options.html"];
const iconEntries = [
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
  "icon-96.png",
  "icon-128.png",
  "icon-256.png",
  "icon-512.png",
  "overcite-logo-square.png"
];
const moduleImportPattern = /^\s*import\s+\{([^}]+)\}\s+from\s+"([^"]+)";\s*$/gm;

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
  await buildSafariResources(baseManifest);
}

async function buildBrowserDist(browserName, manifest) {
  const targetRoot = path.join(distRoot, browserName);
  await mkdir(targetRoot, { recursive: true });

  for (const entry of sharedEntries) {
    await cp(path.join(extensionRoot, entry), path.join(targetRoot, entry), {
      recursive: true,
      filter: (source) => !path.basename(source).startsWith(".")
    });
  }

  const targetIconsRoot = path.join(targetRoot, "icons");
  await mkdir(targetIconsRoot, { recursive: true });
  for (const iconName of iconEntries) {
    await cp(path.join(extensionRoot, "icons", iconName), path.join(targetIconsRoot, iconName));
  }

  await writeFile(
    path.join(targetRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function buildSafariResources(baseManifest) {
  try {
    await mkdir(safariResourcesRoot, { recursive: true });
  } catch {
    return;
  }

  await rm(safariResourcesRoot, { recursive: true, force: true });
  await mkdir(safariResourcesRoot, { recursive: true });

  for (const entry of sharedEntries) {
    await cp(path.join(extensionRoot, entry), path.join(safariResourcesRoot, entry), {
      recursive: true,
      filter: (source) => !path.basename(source).startsWith(".")
    });
  }

  const safariIconsRoot = path.join(safariResourcesRoot, "icons");
  await mkdir(safariIconsRoot, { recursive: true });
  for (const iconName of iconEntries) {
    await cp(path.join(extensionRoot, "icons", iconName), path.join(safariIconsRoot, iconName));
  }

  const safariManifest = structuredClone(baseManifest);
  delete safariManifest.browser_specific_settings;
  safariManifest.background = {
    service_worker: "src/background-safari.js"
  };

  await writeFile(
    path.join(safariResourcesRoot, "manifest.json"),
    `${JSON.stringify(safariManifest, null, 2)}\n`,
    "utf8"
  );

  await writeFile(path.join(safariResourcesRoot, "src", "background-safari.js"), await bundleSafariBackground(), "utf8");
}

async function bundleSafariBackground() {
  const modulePaths = [
    "src/core/constants.js",
    "src/core/project.js",
    "src/core/settings.js",
    "src/core/bibtex.js",
    "src/core/ads.js",
    "src/core/sources.js",
    "src/background.js"
  ];

  const sections = [
    "/* Safari background bundle generated from extension modules. */",
    "const __overciteSafariModules = Object.create(null);"
  ];
  for (const modulePath of modulePaths) {
    const rawSource = await readFile(path.join(extensionRoot, modulePath), "utf8");
    const { transformedSource, exportedNames } = transformSafariModule(rawSource, modulePath);
    const exportedMembers = exportedNames.join(", ");
    sections.push(
      `\n/* ${modulePath} */\n(() => {\n${indentBlock(transformedSource)}\n  __overciteSafariModules[${JSON.stringify(modulePath)}] = { exports: { ${exportedMembers} } };\n})();`
    );
  }
  return `${sections.join("\n")}\n`;
}

function transformSafariModule(rawSource, modulePath) {
  const exportedNames = [];
  const transformedSource = rawSource
    .replace(moduleImportPattern, (_, specifiers, importPath) => {
      const bindings = specifiers
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean)
        .map((specifier) => {
          const [importedName, localName] = specifier.split(/\s+as\s+/).map((part) => part.trim());
          if (!localName || importedName === localName) {
            return importedName;
          }
          return `${importedName}: ${localName}`;
        })
        .join(", ");
      return `const { ${bindings} } = __overciteSafariModules[${JSON.stringify(resolveModulePath(modulePath, importPath))}].exports;`;
    })
    .replace(/^export\s+async function\s+([A-Za-z0-9_$]+)\s*\(/gm, (_, exportName) => {
      exportedNames.push(exportName);
      return `async function ${exportName}(`;
    })
    .replace(/^export\s+function\s+([A-Za-z0-9_$]+)\s*\(/gm, (_, exportName) => {
      exportedNames.push(exportName);
      return `function ${exportName}(`;
    })
    .replace(/^export\s+const\s+([A-Za-z0-9_$]+)\s*=/gm, (_, exportName) => {
      exportedNames.push(exportName);
      return `const ${exportName} =`;
    })
    .replace(/^export\s+let\s+([A-Za-z0-9_$]+)\s*=/gm, (_, exportName) => {
      exportedNames.push(exportName);
      return `let ${exportName} =`;
    })
    .replace(/^export\s+\{([^}]+)\};?\s*$/gm, (_, specifiers) => {
      for (const specifier of specifiers.split(",").map((part) => part.trim()).filter(Boolean)) {
        const [localName, exportName] = specifier.split(/\s+as\s+/).map((part) => part.trim());
        exportedNames.push(exportName || localName);
      }
      return "";
    })
    .trim();

  return {
    transformedSource,
    exportedNames: [...new Set(exportedNames)]
  };
}

function resolveModulePath(modulePath, importPath) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(modulePath), importPath));
}

function indentBlock(source) {
  if (!source) {
    return "  ";
  }
  return source
    .split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
