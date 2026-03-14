export function resolveBibTargetFromProjectState(projectState = {}) {
  const {
    mainText = "",
    activeFileName = "",
    projectFiles = [],
    projectId = "",
    overrides = {}
  } = projectState;

  const normalizedFiles = [...new Set(projectFiles.filter(Boolean))];
  const bibFiles = normalizedFiles.filter((name) => /\.bib$/i.test(name));

  const override = projectId ? overrides[projectId] : null;
  if (override && bibFiles.includes(override)) {
    return { status: "resolved", target: override, candidates: bibFiles };
  }

  const bibliographyMatches = extractBibliographyTargets(mainText);
  if (bibliographyMatches.length) {
    const directCandidates = bibliographyMatches
      .map((name) => (name.toLowerCase().endsWith(".bib") ? name : `${name}.bib`))
      .filter((name) => bibFiles.includes(name));
    if (directCandidates.length === 1) {
      return { status: "resolved", target: directCandidates[0], candidates: bibFiles };
    }
    if (directCandidates.length > 1) {
      return { status: "needs-choice", target: null, candidates: directCandidates };
    }
  }

  if (/\.bib$/i.test(activeFileName)) {
    return { status: "resolved", target: activeFileName, candidates: bibFiles };
  }

  if (bibFiles.length === 1) {
    return { status: "resolved", target: bibFiles[0], candidates: bibFiles };
  }

  const conventionalNames = bibFiles.filter((name) => /^(references|refs)\.bib$/i.test(name));
  if (conventionalNames.length === 1) {
    return { status: "resolved", target: conventionalNames[0], candidates: bibFiles };
  }

  if (bibFiles.length > 1) {
    return { status: "needs-choice", target: null, candidates: bibFiles };
  }

  return { status: "not-found", target: null, candidates: [] };
}

export function extractBibliographyTargets(mainText) {
  const targets = [];
  const bibliographyRegex = /\\bibliography\s*\{([^}]+)\}/g;
  const addBibResourceRegex = /\\addbibresource\s*\{([^}]+)\}/g;

  for (const regex of [bibliographyRegex, addBibResourceRegex]) {
    let match;
    while ((match = regex.exec(mainText)) !== null) {
      const pieces = match[1].split(",").map((piece) => piece.trim()).filter(Boolean);
      targets.push(...pieces);
    }
  }

  return [...new Set(targets)];
}
