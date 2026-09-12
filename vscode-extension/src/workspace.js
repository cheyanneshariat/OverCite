const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ENTRIES = 10000;
const EXCLUDED_DIRECTORIES = new Set([".git", ".output", "node_modules"]);

export async function discoverBibliographyFiles({
  workspace,
  workspaceFolder,
  createRelativePattern,
  joinPath,
  createCancellationTokenSource,
  timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  maxEntries = DEFAULT_MAX_ENTRIES
}) {
  const openFiles = collectOpenBibliographyFiles(workspace, workspaceFolder);

  if (workspaceFolder.uri.scheme === "file") {
    const cancellation = createCancellationTokenSource?.();
    try {
      const uris = await withDeadline(
        () => workspace.findFiles(
          createRelativePattern(workspaceFolder, "**/*.bib"),
          "**/{node_modules,.git}/**",
          undefined,
          cancellation?.token
        ),
        timeoutMs,
        "Timed out while scanning this workspace for bibliography files.",
        () => cancellation?.cancel()
      );
      return mergeBibliographyFiles(workspaceFolder.uri, uris, openFiles);
    } finally {
      cancellation?.dispose();
    }
  }

  try {
    const uris = await withDeadline(
      (signal) => walkVirtualWorkspace(workspace.fs, workspaceFolder.uri, joinPath, maxEntries, signal),
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

export async function withDeadline(operation, timeoutMs, message, onTimeout = () => {}) {
  let timer;
  const controller = new AbortController();
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          try { onTimeout(); } catch { /* Preserve the actionable timeout. */ }
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function walkVirtualWorkspace(fileSystem, rootUri, joinPath, maxEntries, signal) {
  const files = [];
  const pending = [rootUri];
  let visitedEntries = 0;

  while (pending.length) {
    if (signal.aborted) return files;
    const directoryUri = pending.shift();
    const entries = await fileSystem.readDirectory(directoryUri);
    // VS Code FileSystem.readDirectory has no cancellation token. Do not
    // continue traversal when an outstanding provider call finishes late.
    if (signal.aborted) return files;
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
