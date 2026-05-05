import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeVsCodeSettings } from "../../vscode-extension/src/config.js";
import { findCitationAtCursor } from "../../vscode-extension/src/core/citation.js";
import { applyInsertion, exportBibtex, resolveBibTarget, searchLiterature } from "../../vscode-extension/src/service.js";

const DEFAULT_USER_CONFIG = path.join(os.homedir(), ".overcite", "texstudio-settings.json");
const PROJECT_CONFIG_NAMES = Object.freeze([".overcite.json", ".overcite-texstudio.json"]);
const PROJECT_SCAN_LIMIT = 5000;
const PROJECT_SCAN_DIR_SKIP = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".vscode-test"
]);

export function lineColumnToIndex(text, line, column, options = {}) {
  const lineBase = Number(options.lineBase ?? 0);
  const columnBase = Number(options.columnBase ?? 0);
  const targetLine = Math.max(0, Number(line ?? 0) - lineBase);
  const targetColumn = Math.max(0, Number(column ?? 0) - columnBase);
  const source = String(text ?? "");

  let currentLine = 0;
  let lineStart = 0;
  for (let index = 0; index < source.length && currentLine < targetLine; index += 1) {
    if (source[index] === "\n") {
      currentLine += 1;
      lineStart = index + 1;
    }
  }

  let lineEnd = source.indexOf("\n", lineStart);
  if (lineEnd < 0) {
    lineEnd = source.length;
  }
  return Math.min(lineEnd, lineStart + targetColumn);
}

export function applyTextEdit(text, edit) {
  const source = String(text ?? "");
  const start = Math.max(0, Math.min(source.length, Number(edit?.start ?? 0)));
  const end = Math.max(start, Math.min(source.length, Number(edit?.end ?? start)));
  return `${source.slice(0, start)}${String(edit?.text ?? "")}${source.slice(end)}`;
}

export function normalizeSearchMode(explicitMode, defaultMode = "contextual") {
  const normalizedExplicit = normalizeModeValue(explicitMode);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }
  return normalizeModeValue(defaultMode) ?? "contextual";
}

export function normalizeTexstudioSettings(rawSettings = {}, env = process.env) {
  const sourceApiTokens = {
    ...(rawSettings.sourceApiTokens && typeof rawSettings.sourceApiTokens === "object" && !Array.isArray(rawSettings.sourceApiTokens)
      ? rawSettings.sourceApiTokens
      : {})
  };
  const adsApiToken = String(rawSettings.adsApiToken ?? sourceApiTokens.ads ?? env.OVERCITE_ADS_API_TOKEN ?? "").trim();
  const ncbiApiKey = String(rawSettings.ncbiApiKey ?? sourceApiTokens.ncbi ?? env.NCBI_API_KEY ?? "").trim();
  if (adsApiToken) {
    sourceApiTokens.ads = adsApiToken;
  }
  if (ncbiApiKey) {
    sourceApiTokens.ncbi = ncbiApiKey;
  }

  return normalizeVsCodeSettings({
    ...rawSettings,
    adsApiToken,
    ncbiApiKey,
    sourceApiTokens,
    projectBibFileOverrides: rawSettings.projectBibFileOverrides ?? rawSettings.defaultProjectBibFileOverride ?? {}
  });
}

export async function loadTexstudioSettings({
  projectDir = "",
  userConfigPath = DEFAULT_USER_CONFIG,
  requestSettings = {},
  env = process.env
} = {}) {
  const layers = [];
  const userConfig = await readJsonIfExists(userConfigPath);
  if (userConfig) {
    layers.push(userConfig);
  }

  if (projectDir) {
    for (const configName of PROJECT_CONFIG_NAMES) {
      const projectConfig = await readJsonIfExists(path.join(projectDir, configName));
      if (projectConfig) {
        layers.push(projectConfig);
      }
    }
  }

  layers.push(requestSettings ?? {});
  return normalizeTexstudioSettings(mergeSettingsLayers(layers), env);
}

export async function prepareTexstudioRequest(request = {}, options = {}) {
  const activeFilePath = resolveOptionalPath(request.activeFilePath, options.cwd);
  const rootFilePath = resolveOptionalPath(request.rootFilePath, options.cwd) || activeFilePath;
  const projectDir = resolveOptionalPath(request.projectDir, options.cwd) ||
    (rootFilePath ? path.dirname(rootFilePath) : activeFilePath ? path.dirname(activeFilePath) : process.cwd());
  const activeText = request.activeText ?? await readTextIfPath(activeFilePath);
  const rootText = request.rootText ?? (rootFilePath && rootFilePath !== activeFilePath
    ? await readTextIfPath(rootFilePath)
    : activeText);
  const settings = await loadTexstudioSettings({
    projectDir,
    userConfigPath: request.userConfigPath,
    requestSettings: request.settings,
    env: options.env ?? process.env
  });
  const cursorIndex = Number.isInteger(request.cursorIndex)
    ? request.cursorIndex
    : lineColumnToIndex(activeText, request.cursor?.line ?? 0, request.cursor?.column ?? 0, {
      lineBase: request.cursor?.lineBase ?? 0,
      columnBase: request.cursor?.columnBase ?? 0
    });
  const citationContext = request.citationContext ?? findCitationAtCursor(activeText, cursorIndex, settings.contextWindowChars);
  if (!citationContext) {
    throw new Error("Place the cursor inside a \\cite{...} command before running OverCite.");
  }

  let resolvedSearchMode = normalizeSearchMode(request.searchMode, settings.defaultSearchMode);
  if (resolvedSearchMode === "direct" && !String(citationContext.token ?? "").trim()) {
    if (normalizeModeValue(request.searchMode) === "direct") {
      throw new Error("Raw query mode requires a non-empty citation token.");
    }
    resolvedSearchMode = "contextual";
  }
  const searchContext = {
    ...citationContext,
    searchMode: resolvedSearchMode
  };

  const projectFiles = await resolveProjectFiles(request, projectDir);
  return {
    request,
    projectDir,
    activeFilePath,
    rootFilePath,
    activeText,
    rootText,
    settings,
    cursorIndex,
    citationContext: searchContext,
    projectFiles
  };
}

export async function resolveTexstudioRequest(request = {}, options = {}) {
  const prepared = await prepareTexstudioRequest(request, options);
  if (request.selectedCandidate) {
    return applySelectedCandidate(prepared, request.selectedCandidate, options);
  }

  const candidates = await searchLiterature(prepared.citationContext, prepared.settings, options.fetchImpl ?? globalThis.fetch);
  const safeCandidates = candidates.map(sanitizeCandidate);
  const responseBase = {
    status: "needs-selection",
    searchMode: prepared.citationContext.searchMode,
    citationContext: prepared.citationContext,
    candidates: safeCandidates.map((candidate, index) => ({
      ...candidate,
      index,
      choiceLabel: formatCandidateChoice(candidate)
    }))
  };

  const selectedIndex = selectedIndexFromRequest(request);
  if (selectedIndex === null) {
    return responseBase;
  }
  const selectedCandidate = safeCandidates[selectedIndex];
  if (!selectedCandidate) {
    throw new Error(`Selected candidate index ${selectedIndex} is out of range.`);
  }
  return applySelectedCandidate(prepared, selectedCandidate, options, {
    candidates: responseBase.candidates
  });
}

export async function applyTexstudioRequest(request = {}, options = {}) {
  const prepared = await prepareTexstudioRequest(request, options);
  const candidate = request.selectedCandidate ?? request.candidate;
  if (!candidate) {
    throw new Error("No selected candidate was provided.");
  }
  return applySelectedCandidate(prepared, sanitizeCandidate(candidate), options);
}

export async function listProjectFiles(projectDir, options = {}) {
  const root = resolveOptionalPath(projectDir, options.cwd);
  if (!root) {
    return [];
  }
  const files = [];
  await walkProject(root, root, files, options.maxFiles ?? PROJECT_SCAN_LIMIT);
  return files;
}

function selectedIndexFromRequest(request) {
  if (request.selectedIndex === undefined && request.selectIndex === undefined) {
    return null;
  }
  const value = Number(request.selectedIndex ?? request.selectIndex);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("selectedIndex must be a non-negative integer.");
  }
  return value;
}

async function applySelectedCandidate(prepared, selectedCandidate, options = {}, extra = {}) {
  const request = prepared.request;
  const candidate = {
    ...selectedCandidate,
    keyMode: prepared.settings.citationKeyMode,
    typedToken: prepared.citationContext.token,
    bibliographyInsertMode: prepared.settings.bibliographyInsertMode
  };
  const bibTargetResolution = resolveRequestBibTarget(prepared);
  if (bibTargetResolution.status !== "resolved") {
    return {
      status: bibTargetResolution.status,
      searchMode: prepared.citationContext.searchMode,
      citationContext: prepared.citationContext,
      candidates: extra.candidates ?? [],
      bibCandidates: bibTargetResolution.candidates,
      message: bibTargetResolution.status === "needs-choice"
        ? "Choose the bibliography file OverCite should update."
        : "No bibliography file was found for this project."
    };
  }

  const bibRelativePath = bibTargetResolution.target;
  const bibFilePath = path.resolve(prepared.projectDir, bibRelativePath);
  const existingBibText = request.bibText ?? await readTextIfPath(bibFilePath, "");
  const bibtex = await exportBibtex(candidate, prepared.settings, options.fetchImpl ?? globalThis.fetch);
  const insertion = applyInsertion({
    bibText: existingBibText,
    bibtex,
    candidate
  });
  const activeEdit = {
    start: prepared.citationContext.tokenStart,
    end: prepared.citationContext.tokenEnd,
    text: insertion.finalKey
  };
  const updatedActiveText = applyTextEdit(prepared.activeText, activeEdit);
  const shouldWriteBib = request.writeBibFile !== false;
  const shouldWriteActive = request.writeActiveFile === true;

  if (shouldWriteBib) {
    await fs.mkdir(path.dirname(bibFilePath), { recursive: true });
    await fs.writeFile(bibFilePath, insertion.updatedBibText, "utf8");
  }
  if (shouldWriteActive && prepared.activeFilePath) {
    await fs.writeFile(prepared.activeFilePath, updatedActiveText, "utf8");
  }

  return {
    status: "applied",
    searchMode: prepared.citationContext.searchMode,
    citationContext: prepared.citationContext,
    selectedCandidate: sanitizeCandidate(candidate),
    finalKey: insertion.finalKey,
    reusedExistingEntry: Boolean(insertion.match),
    bibFile: {
      path: bibFilePath,
      relativePath: bibRelativePath,
      written: shouldWriteBib,
      rewrittenBibtex: insertion.rewrittenBibtex,
      insertionRange: insertion.insertionRange,
      cursorAnchor: insertion.cursorAnchor
    },
    activeEdit,
    activeFile: {
      path: prepared.activeFilePath,
      written: shouldWriteActive,
      updatedText: updatedActiveText
    },
    candidates: extra.candidates ?? []
  };
}

function resolveRequestBibTarget(prepared) {
  const explicitTarget = String(prepared.request.bibTarget ?? "").trim();
  if (explicitTarget) {
    const target = normalizeExplicitBibTarget(prepared.projectDir, explicitTarget);
    return {
      status: "resolved",
      target,
      candidates: prepared.projectFiles.filter((name) => /\.bib$/i.test(name))
    };
  }

  return resolveBibTarget(
    {
      mainText: prepared.rootText,
      activeFileName: relativeProjectPath(prepared.projectDir, prepared.activeFilePath),
      projectFiles: prepared.projectFiles,
      projectId: prepared.projectDir
    },
    prepared.settings
  );
}

function normalizeExplicitBibTarget(projectDir, target) {
  const targetPath = path.isAbsolute(target)
    ? target
    : path.resolve(projectDir, target);
  const relative = relativeProjectPath(projectDir, targetPath);
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("The bibliography target must be inside the TeXstudio project.");
  }
  if (!/\.bib$/i.test(relative)) {
    throw new Error("The bibliography target must be a .bib file.");
  }
  return relative;
}

async function resolveProjectFiles(request, projectDir) {
  if (Array.isArray(request.projectFiles) && request.projectFiles.length) {
    return [...new Set(request.projectFiles.map((file) => normalizeProjectFile(projectDir, file)).filter(Boolean))];
  }
  return listProjectFiles(projectDir);
}

function normalizeProjectFile(projectDir, fileName) {
  const raw = String(fileName ?? "").trim();
  if (!raw) {
    return "";
  }
  if (path.isAbsolute(raw)) {
    return relativeProjectPath(projectDir, raw);
  }
  return raw.replace(/\\/g, "/");
}

function relativeProjectPath(projectDir, filePath) {
  if (!filePath) {
    return "";
  }
  return path.relative(projectDir, filePath).replace(/\\/g, "/");
}

async function walkProject(root, currentDir, files, maxFiles) {
  if (files.length >= maxFiles) {
    return;
  }
  let entries = [];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= maxFiles) {
      return;
    }
    if (entry.name.startsWith(".") && entry.name !== ".overcite.json" && entry.name !== ".overcite-texstudio.json") {
      continue;
    }
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!PROJECT_SCAN_DIR_SKIP.has(entry.name)) {
        await walkProject(root, absolute, files, maxFiles);
      }
      continue;
    }
    if (entry.isFile() && /\.(?:tex|bib)$/i.test(entry.name)) {
      files.push(path.relative(root, absolute).replace(/\\/g, "/"));
    }
  }
}

function sanitizeCandidate(candidate = {}) {
  const safe = {
    bibcode: candidate.bibcode ?? null,
    id: candidate.id ?? "",
    sourceId: candidate.sourceId ?? "",
    sourceLabel: candidate.sourceLabel ?? "",
    title: candidate.title ?? "",
    authors: Array.isArray(candidate.authors) ? candidate.authors : [],
    year: candidate.year ?? null,
    abstract: candidate.abstract ?? "",
    doi: candidate.doi ?? "",
    citationCount: candidate.citationCount ?? 0,
    journal: candidate.journal ?? "",
    booktitle: candidate.booktitle ?? "",
    publisher: candidate.publisher ?? "",
    type: candidate.type ?? "",
    url: candidate.url ?? "",
    bibtexExportId: candidate.bibtexExportId ?? "",
    eprint: candidate.eprint ?? "",
    archivePrefix: candidate.archivePrefix ?? "",
    primaryClass: candidate.primaryClass ?? "",
    score: candidate.score ?? 0,
    generatedKey: candidate.generatedKey ?? null,
    keyMode: candidate.keyMode,
    typedToken: candidate.typedToken,
    bibliographyInsertMode: candidate.bibliographyInsertMode,
    bibtex: candidate.bibtex
  };
  return Object.fromEntries(Object.entries(safe).filter(([, value]) => value !== undefined));
}

function formatCandidateChoice(candidate) {
  const key = candidate.generatedKey || candidate.bibtexExportId || candidate.bibcode || "OverCite";
  const firstAuthor = String(candidate.authors?.[0] ?? "").replace(/,\s*.*/, "");
  const source = candidate.sourceLabel ? `[${candidate.sourceLabel}] ` : "";
  const year = candidate.year ? ` (${candidate.year})` : "";
  return `${key} - ${source}${firstAuthor}${year} - ${candidate.title}`.replace(/\s+/g, " ").trim();
}

function normalizeModeValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "contextual" || normalized === "simple" || normalized === "direct") {
    return normalized;
  }
  return null;
}

function mergeSettingsLayers(layers) {
  return layers.reduce((merged, layer) => ({
    ...merged,
    ...layer,
    sourceApiTokens: {
      ...(merged.sourceApiTokens ?? {}),
      ...(layer?.sourceApiTokens ?? {})
    },
    projectBibFileOverrides: {
      ...(merged.projectBibFileOverrides ?? merged.defaultProjectBibFileOverride ?? {}),
      ...(layer?.projectBibFileOverrides ?? layer?.defaultProjectBibFileOverride ?? {})
    }
  }), {});
}

async function readJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw new Error(`Failed to read OverCite config ${filePath}: ${error.message}`);
  }
}

async function readTextIfPath(filePath, fallback = null) {
  if (!filePath) {
    if (fallback !== null) {
      return fallback;
    }
    throw new Error("No active text or file path was provided.");
  }
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (fallback !== null && error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function resolveOptionalPath(filePath, cwd = process.cwd()) {
  const raw = String(filePath ?? "").trim();
  if (!raw) {
    return "";
  }
  return path.resolve(cwd, raw);
}
