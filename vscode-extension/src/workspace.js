const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ENTRIES = 10000;
const EXCLUDED_DIRECTORIES = new Set([".git", ".output", "node_modules"]);

export async function discoverBibliographyFiles({
  workspace,
  workspaceFolder,
  createRelativePattern,
  joinPath,
  timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  maxEntries = DEFAULT_MAX_ENTRIES
}) {
  const openFiles = collectOpenBibliographyFiles(workspace, workspaceFolder);

  if (workspaceFolder.uri.scheme === "file") {
    const uris = await withDeadline(
      () => workspace.findFiles(
        createRelativePattern(workspaceFolder, "**/*.bib"),
        "**/{node_modules,.git}/**"
      ),
      timeoutMs,
      "Timed out while scanning this workspace for bibliography files."
    );
    return mergeBibliographyFiles(workspaceFolder.uri, uris, openFiles);
  }

  try {
    const uris = await withDeadline(
      () => walkVirtualWorkspace(workspace.fs, workspaceFolder.uri, joinPath, maxEntries),
      timeoutMs,
      "Timed out while reading the virtual workspace."
    );
    return mergeBibliographyFiles(workspaceFolder.uri, uris, openFiles);
  } catch (error) {
    if (openFiles.length) {
      return openFiles;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${detail} If this is an Overleaf Workshop project, open its .bib file in VS Code and try again.`
    );
  }
}

export function uriFileName(uri) {
  const normalized = String(uri?.path || uri?.fsPath || "").replace(/\\/g, "/");
  const pieces = normalized.split("/").filter(Boolean);
  return pieces[pieces.length - 1] ?? "";
}

export function workspaceKeyFromUri(uri) {
  if (uri?.scheme === "file" && uri.fsPath) {
    return String(uri.fsPath).trim();
  }
  return String(uri?.toString?.() ?? "").trim();
}

export function relativeUriPath(rootUri, fileUri) {
  const rootPath = normalizeUriPath(rootUri?.path);
  const filePath = normalizeUriPath(fileUri?.path);
  if (filePath === rootPath) {
    return uriFileName(fileUri);
  }
  const prefix = rootPath === "/" ? "/" : `${rootPath}/`;
  return filePath.startsWith(prefix)
    ? filePath.slice(prefix.length)
    : uriFileName(fileUri);
}

export async function withDeadline(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function walkVirtualWorkspace(fileSystem, rootUri, joinPath, maxEntries) {
  const files = [];
  const pending = [rootUri];
  let visitedEntries = 0;

  while (pending.length) {
    const directoryUri = pending.shift();
    const entries = await fileSystem.readDirectory(directoryUri);
    visitedEntries += entries.length;
    if (visitedEntries > maxEntries) {
      throw new Error(`Stopped after scanning ${maxEntries} virtual-workspace entries.`);
    }

    for (const [name, type] of entries) {
      const childUri = joinPath(directoryUri, name);
      if (isDirectory(type)) {
        if (!EXCLUDED_DIRECTORIES.has(name)) {
          pending.push(childUri);
        }
      } else if (/\.bib$/i.test(name)) {
        files.push(childUri);
      }
    }
  }

  return files;
}

function collectOpenBibliographyFiles(workspace, workspaceFolder) {
  const root = workspaceFolder.uri;
  return (workspace.textDocuments ?? [])
    .filter((document) => {
      const uri = document?.uri;
      return uri
        && uri.scheme === root.scheme
        && uri.authority === root.authority
        && uri.query === root.query
        && isUriInside(root, uri)
        && /\.bib$/i.test(uriFileName(uri));
    })
    .map((document) => ({
      name: relativeUriPath(root, document.uri),
      uri: document.uri
    }));
}

function mergeBibliographyFiles(rootUri, uris, existingEntries) {
  const byUri = new Map(existingEntries.map((entry) => [entry.uri.toString(), entry.uri]));
  for (const uri of uris) {
    byUri.set(uri.toString(), uri);
  }
  const allUris = [...byUri.values()];
  const basenameCounts = new Map();
  for (const uri of allUris) {
    const name = uriFileName(uri);
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
  }
  return allUris
    .map((uri) => {
      const basename = uriFileName(uri);
      return {
        name: basenameCounts.get(basename) === 1 ? basename : relativeUriPath(rootUri, uri),
        uri
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isUriInside(rootUri, candidateUri) {
  const rootPath = normalizeUriPath(rootUri.path);
  const candidatePath = normalizeUriPath(candidateUri.path);
  return candidatePath === rootPath
    || candidatePath.startsWith(rootPath === "/" ? "/" : `${rootPath}/`);
}

function normalizeUriPath(value) {
  const normalized = `/${String(value ?? "").replace(/\\/g, "/")}`
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return normalized || "/";
}

function isDirectory(fileType) {
  return (Number(fileType) & 2) === 2;
}
