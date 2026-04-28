import test from "node:test";
import assert from "node:assert/strict";

import { normalizeVsCodeSettings } from "../src/config.js";
import { applyBibInsertion, generatePreferredKey, parseBibEntries } from "../src/core/bibtex.js";
import { exportCandidateBibtex, SOURCE_IDS } from "../src/core/sources.js";
import { buildQuickPickItems, searchLiterature } from "../src/service.js";

const KEY_MODES = ["authoryear", "authoryear-underscore", "authoryear-colon", "informative", "bibcode", "typed"];
const INSERT_MODES = ["append", "alphabetical"];
const SEARCH_MODES = ["contextual", "simple", "direct"];
const SOURCE_PROFILES = [
  "ads-only",
  "arxiv-only",
  "astrophysics",
  "broad",
  "astro-physics",
  "math-physics",
  "life-sciences",
  "computer-science",
  "custom"
];

test("normalizes VS Code search and API settings across a large settings matrix", () => {
  let caseCount = 0;
  for (const sourceProfile of SOURCE_PROFILES) {
    for (const defaultSearchMode of SEARCH_MODES) {
      for (const citationKeyMode of KEY_MODES) {
        for (const bibliographyInsertMode of INSERT_MODES) {
          const contextWindowChars = caseCount % 3 === 0 ? 50 : caseCount % 3 === 1 ? 500 : 5000;
          const raw = {
            adsApiToken: " ads-token ",
            sourceProfile,
            primarySource: sourceProfile === "custom" ? "pubmed" : undefined,
            fallbackSources: sourceProfile === "custom"
              ? ["crossref", "pubmed", "datacite", "bad-source", "crossref"]
              : undefined,
            sourceApiTokens: {
              ads: " ads-token ",
              ncbi: caseCount % 4 === 0 ? " ncbi-token " : ""
            },
            contextWindowChars,
            citationKeyMode,
            bibliographyInsertMode,
            defaultSearchMode,
            projectBibFileOverrides: { "/tmp/project": "refs.bib" }
          };
          const settings = normalizeVsCodeSettings(raw);

          assert.equal(settings.sourceProfile, sourceProfile, `profile ${caseCount}`);
          assert.equal(settings.citationKeyMode, citationKeyMode, `key mode ${caseCount}`);
          assert.equal(settings.bibliographyInsertMode, bibliographyInsertMode, `insert mode ${caseCount}`);
          assert.equal(settings.defaultSearchMode, defaultSearchMode, `search mode ${caseCount}`);
          assert.ok(settings.contextWindowChars >= 200 && settings.contextWindowChars <= 1200, `context clamp ${caseCount}`);
          assert.equal(settings.sourceApiTokens.ads, "ads-token", `ADS token ${caseCount}`);
          assert.deepEqual(settings.projectBibFileOverrides, { "/tmp/project": "refs.bib" }, `project overrides ${caseCount}`);

          if (sourceProfile === "custom") {
            assert.equal(settings.primarySource, "pubmed", `custom primary ${caseCount}`);
            assert.deepEqual(settings.fallbackSources, ["crossref", "datacite"], `custom fallbacks ${caseCount}`);
          }
          caseCount += 1;
        }
      }
    }
  }
  assert.ok(caseCount >= 200, `expected a large settings matrix; got ${caseCount}`);
});

test("citation key and bibliography settings work across publication types", () => {
  const publications = buildPublications();
  let caseCount = 0;
  for (const publication of publications) {
    for (const keyMode of KEY_MODES) {
      for (const insertMode of INSERT_MODES) {
        const settings = {
          citationKeyMode: keyMode,
          bibliographyInsertMode: insertMode
        };
        const typedToken = `{${publication.typedToken} demo}`;
        const [item] = buildQuickPickItems([publication], settings, typedToken);
        assert.equal(item.candidate.keyMode, keyMode, `quick pick key mode ${caseCount}`);
        assert.equal(item.candidate.bibliographyInsertMode, insertMode, `quick pick insert mode ${caseCount}`);
        assert.equal(item.candidate.typedToken, typedToken, `quick pick typed token ${caseCount}`);

        const existingBib = `@article{Zulu9999,\n  title = {A Late Existing Entry},\n  year = {9999}\n}\n`;
        const existingKeys = parseBibEntries(existingBib).map((entry) => entry.key);
        const expectedKey = generatePreferredKey(publication, existingKeys, {
          keyMode,
          typedToken
        });
        const bibtex = exportCandidateBibtex({
          ...publication,
          generatedKey: item.label
        });
        const insertion = applyBibInsertion({
          bibText: existingBib,
          bibtex,
          candidate: item.candidate
        });

        assert.equal(insertion.finalKey, expectedKey, `final key ${caseCount}`);
        assert.match(insertion.updatedBibText, new RegExp(`@(?:article|inproceedings|misc)\\{${escapeRegExp(expectedKey)},`), `rewritten key ${caseCount}`);
        assert.ok(insertion.cursorAnchor > 0, `cursor anchor ${caseCount}`);
        if (keyMode === "typed") {
          assert.doesNotMatch(insertion.finalKey, /[{}\s]/, `typed key sanitized ${caseCount}`);
        }
        if (keyMode === "bibcode" && publication.bibcode) {
          assert.equal(insertion.finalKey, publication.bibcode, `bibcode key ${caseCount}`);
        }
        if (insertMode === "alphabetical") {
          assert.ok(
            insertion.updatedBibText.indexOf(`@${bibtexType(publication)}{${expectedKey},`) <
              insertion.updatedBibText.indexOf("@article{Zulu9999,"),
            `alphabetical insertion ${caseCount}`
          );
        } else {
          assert.ok(
            insertion.updatedBibText.indexOf(`@${bibtexType(publication)}{${expectedKey},`) >
              insertion.updatedBibText.indexOf("@article{Zulu9999,"),
            `append insertion ${caseCount}`
          );
        }
        caseCount += 1;
      }
    }
  }
  assert.ok(caseCount >= 300, `expected at least 300 citation setting cases; got ${caseCount}`);
});

test("service search modes cover ADS and broad source routing with deterministic speed", async () => {
  const publications = buildPublications().slice(0, 40);
  const started = performance.now();
  let caseCount = 0;
  for (const publication of publications) {
    for (const searchMode of SEARCH_MODES) {
      const route = routeForCase(caseCount);
      const context = buildSearchContext(publication, searchMode);
      const calls = [];
      const candidates = await searchLiterature(
        context,
        {
          ...route.settings,
          citationKeyMode: KEY_MODES[caseCount % KEY_MODES.length],
          bibliographyInsertMode: INSERT_MODES[caseCount % INSERT_MODES.length]
        },
        fakeServiceFetch(publication, route.source, calls)
      );

      assert.equal(candidates[0].title, publication.title, `search title ${caseCount}`);
      assert.ok(candidates[0].generatedKey, `generated key ${caseCount}`);
      assert.ok(calls.length >= 1, `provider calls ${caseCount}`);
      if (route.source === SOURCE_IDS.ADS) {
        assert.ok(calls.every((call) => call.url.includes("api.adsabs.harvard.edu")), `ADS route ${caseCount}`);
        if (searchMode === "direct") {
          assert.equal(calls[0].query, `doi:"${context.token}"`, `direct ADS DOI query ${caseCount}`);
        }
      }
      if (route.source === SOURCE_IDS.PUBMED) {
        assert.ok(calls.some((call) => call.url.includes("api_key=ncbi-token")), `NCBI key ${caseCount}`);
      }
      caseCount += 1;
    }
  }
  const elapsedMs = performance.now() - started;
  assert.ok(caseCount >= 100, `expected at least 100 service search cases; got ${caseCount}`);
  assert.ok(elapsedMs < 8000, `service search matrix should stay fast; got ${Math.round(elapsedMs)} ms`);
});

function buildSearchContext(publication, searchMode) {
  const token = searchMode === "direct"
    ? publication.doi || publication.title
    : `${publication.keyBase}${publication.year}`;
  return {
    token,
    searchMode,
    parsedKeyHint: searchMode === "direct" ? null : {
      surname: publication.keyBase,
      year: publication.year,
      firstInitial: "",
      suffix: ""
    },
    sentenceText: `${publication.title} is discussed with ${publication.context}.`,
    contextText: `${publication.title} is discussed with ${publication.context}. Dataset software repository methods are mentioned when relevant.`
  };
}

function routeForCase(index) {
  const routes = [
    {
      source: SOURCE_IDS.ADS,
      settings: {
        sourceProfile: "ads-only",
        sourceApiTokens: { ads: "ads-token" },
        adsApiToken: "ads-token"
      }
    },
    {
      source: SOURCE_IDS.CROSSREF,
      settings: {
        sourceProfile: "custom",
        primarySource: SOURCE_IDS.CROSSREF,
        fallbackSources: [],
        sourceApiTokens: {}
      }
    },
    {
      source: SOURCE_IDS.PUBMED,
      settings: {
        sourceProfile: "life-sciences",
        primarySource: SOURCE_IDS.PUBMED,
        fallbackSources: [],
        sourceApiTokens: { ncbi: "ncbi-token" }
      }
    },
    {
      source: SOURCE_IDS.ARXIV,
      settings: {
        sourceProfile: "math-physics",
        primarySource: SOURCE_IDS.ARXIV,
        fallbackSources: [],
        sourceApiTokens: {}
      }
    },
    {
      source: SOURCE_IDS.INSPIRE,
      settings: {
        sourceProfile: "custom",
        primarySource: SOURCE_IDS.INSPIRE,
        fallbackSources: [],
        sourceApiTokens: {}
      }
    }
  ];
  return routes[index % routes.length];
}

function fakeServiceFetch(publication, source, calls) {
  return async (input, options = {}) => {
    const url = String(input);
    calls.push({
      url,
      query: new URL(url).searchParams.get("q") ?? "",
      headers: options.headers ?? {}
    });
    if (source === SOURCE_IDS.ADS && url.includes("api.adsabs.harvard.edu")) {
      return jsonResponse({
        response: {
          docs: [{
            bibcode: publication.bibcode || `${publication.year}TEST....${publication.index}A`,
            title: [publication.title],
            author: publication.authors,
            year: String(publication.year),
            abstract: publication.context,
            doi: [publication.doi],
            citation_count: 30
          }]
        }
      });
    }
    if (source === SOURCE_IDS.CROSSREF && url.includes("api.crossref.org/works/")) {
      return jsonResponse({
        message: crossrefWork(publication)
      });
    }
    if (source === SOURCE_IDS.CROSSREF && url.includes("api.crossref.org")) {
      return jsonResponse({
        message: {
          items: [crossrefWork(publication)]
        }
      });
    }
    if (source === SOURCE_IDS.PUBMED && url.includes("esearch.fcgi")) {
      return jsonResponse({ esearchresult: { idlist: [`pmid-${publication.index}`] } });
    }
    if (source === SOURCE_IDS.PUBMED && url.includes("esummary.fcgi")) {
      return jsonResponse({
        result: {
          uids: [`pmid-${publication.index}`],
          [`pmid-${publication.index}`]: {
            uid: `pmid-${publication.index}`,
            title: publication.title,
            pubdate: String(publication.year),
            fulljournalname: publication.journal,
            source: publication.journal,
            authors: publication.authors.map((name) => ({ name })),
            articleids: [{ idtype: "doi", value: publication.doi }],
            elocationid: `doi: ${publication.doi}`
          }
        }
      });
    }
    if (source === SOURCE_IDS.ARXIV && url.includes("export.arxiv.org")) {
      return textResponse(arxivFeed(publication));
    }
    if (source === SOURCE_IDS.INSPIRE && url.includes("inspirehep.net/api/literature")) {
      return jsonResponse({ hits: { hits: [inspireRecord(publication)] } });
    }
    if (source === SOURCE_IDS.INSPIRE && (url.includes("inspirehep.net/api/doi/") || url.includes("inspirehep.net/api/arxiv/"))) {
      return jsonResponse(inspireRecord(publication));
    }
    throw new Error(`Unexpected service URL for ${source}: ${url}`);
  };
}

function buildPublications() {
  const rows = [
    ["Shariat", "10,000 Resolved Triples from Gaia", "Gaia triples and stellar multiplicity", "PASP", "journal-article", "2025PASP..137i4201S"],
    ["Vaswani", "Attention Is All You Need", "transformer attention sequence modeling", "NeurIPS", "inproceedings", ""],
    ["Jumper", "Highly Accurate Protein Structure Prediction with AlphaFold", "protein folding biology", "Nature", "journal-article", ""],
    ["Tao", "Compressed Sensing and Sparse Recovery", "harmonic analysis sparse recovery", "Mathematics", "journal-article", ""],
    ["Astropy", "The Astropy Project", "astronomy Python software", "Software", "Software", ""],
    ["Gaia", "Gaia Data Release Catalog", "astrometric survey dataset", "Data", "Dataset", ""],
    ["Harris", "Array Programming with NumPy", "scientific Python software", "Nature", "journal-article", ""],
    ["Love", "Moderated Estimation for RNA-seq Differential Expression", "DESeq2 genomics software", "Genome Biology", "journal-article", ""],
    ["Abbott", "Observation of Gravitational Waves", "binary black hole signal", "Physical Review Letters", "journal-article", ""],
    ["Perelman", "Ricci Flow with Surgery", "geometric topology manifolds", "Mathematics", "journal-article", ""],
    ["Kingma", "Adam: A Method for Stochastic Optimization", "optimization machine learning", "ICLR", "inproceedings", ""],
    ["Fisher", "Iris Flower Measurements", "classic biology dataset", "Data", "Dataset", ""],
    ["Planck", "Cosmological Parameters", "cosmic microwave background", "Astronomy", "journal-article", ""],
    ["Sanger", "DNA Sequencing with Chain-Terminating Inhibitors", "genomics sequencing method", "PNAS", "journal-article", ""],
    ["Knuth", "Literate Programming", "software documentation systems", "Computing", "journal-article", ""],
    ["Wiles", "Modular Elliptic Curves and Fermat", "number theory modularity", "Mathematics", "journal-article", ""],
    ["Hunter", "Matplotlib: A 2D Graphics Environment", "plotting software Python", "Software", "journal-article", ""],
    ["Deng", "ImageNet: A Large-Scale Hierarchical Image Database", "computer vision dataset", "CVPR", "inproceedings", ""],
    ["Kanehisa", "KEGG Pathway Database", "bioinformatics pathway dataset", "Data", "Dataset", ""],
    ["Foreman-Mackey", "emcee: The MCMC Hammer", "sampling software astronomy", "PASP", "journal-article", ""],
    ["Noether", "Invariant Variation Problems", "symmetry conservation mathematics", "Mathematical Physics", "journal-article", ""],
    ["Devlin", "BERT: Pre-training of Deep Bidirectional Transformers", "natural language processing", "NAACL", "inproceedings", ""],
    ["Schlegel", "Maps of Dust Infrared Emission", "astronomy dust maps dataset", "ApJ", "journal-article", ""],
    ["Altschul", "Basic Local Alignment Search Tool", "sequence alignment biology", "JMB", "journal-article", ""],
    ["Goodfellow", "Generative Adversarial Nets", "adversarial generative modeling", "NeurIPS", "inproceedings", ""],
    ["Onsager", "Crystal Statistics and the Ising Model", "statistical mechanics", "Physical Review", "journal-article", ""],
    ["Pedregosa", "Scikit-learn: Machine Learning in Python", "machine learning software", "JMLR", "journal-article", ""],
    ["Subramanian", "Gene Set Enrichment Analysis", "pathway enrichment biology", "PNAS", "journal-article", ""],
    ["Brown", "Language Models are Few-Shot Learners", "large language model scaling", "NeurIPS", "inproceedings", ""],
    ["Virtanen", "SciPy 1.0 Fundamental Algorithms", "scientific computing software", "Nature Methods", "journal-article", ""],
    ["Riess", "Observational Evidence from Supernovae", "accelerating universe", "AJ", "journal-article", ""],
    ["Krizhevsky", "ImageNet Classification with Deep Convolutional Networks", "deep learning vision", "NeurIPS", "inproceedings", ""],
    ["Consortium", "Human Genome Reference Assembly", "genome dataset archive", "Genome Data", "Dataset", ""],
    ["Bailer-Jones", "Estimating Distances from Gaia Parallaxes", "Bayesian distance inference", "Astronomy", "journal-article", ""],
    ["McKenna", "The Genome Analysis Toolkit", "variant calling software", "Genome Research", "journal-article", ""],
    ["Witten", "Topological Quantum Field Theory", "geometry quantum field theory", "Communications in Mathematical Physics", "journal-article", ""],
    ["Silver", "Mastering the Game of Go with Deep Neural Networks", "reinforcement learning search", "Nature", "journal-article", ""],
    ["Benjamini", "Controlling the False Discovery Rate", "statistics multiple testing", "JRSS", "journal-article", ""],
    ["El-Badry", "Wide Binary Stars in Gaia", "hyphenated author astronomy", "MNRAS", "journal-article", ""],
    ["Van der Waals", "Equation of State for Fluids", "multi word surname physics", "Physics", "journal-article", ""]
  ];
  return rows.map(([keyBase, title, context, journal, type, bibcode], index) => ({
    index,
    keyBase,
    typedToken: `${keyBase.replace(/[^A-Za-z0-9]/g, "")}${2000 + (index % 26)}`,
    title,
    context,
    journal,
    type,
    bibcode,
    authors: [`${keyBase}, Example`, "Collaborator, Test"],
    year: 2000 + (index % 26),
    doi: `10.4242/overcite.${index + 1}`
  }));
}

function crossrefWork(publication) {
  return {
    DOI: publication.doi,
    title: [publication.title],
    author: publication.authors.map((name) => {
      const [family, given = ""] = name.split(",").map((part) => part.trim());
      return { family, given };
    }),
    issued: { "date-parts": [[publication.year]] },
    "container-title": [publication.journal],
    abstract: publication.context,
    "is-referenced-by-count": 42,
    type: publication.type,
    URL: `https://doi.org/${publication.doi}`
  };
}

function arxivFeed(publication) {
  const arxivId = `${String(publication.year % 100).padStart(2, "0")}01.${String(publication.index + 1).padStart(5, "0")}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/${arxivId}v1</id>
        <published>${publication.year}-01-15T00:00:00Z</published>
        <title>${escapeXml(publication.title)}</title>
        <summary>${escapeXml(publication.context)}</summary>
        ${publication.authors.map((author) => `<author><name>${escapeXml(author)}</name></author>`).join("")}
        <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.DL"/>
      </entry>
    </feed>`;
}

function inspireRecord(publication) {
  const arxivId = `${String(publication.year % 100).padStart(2, "0")}01.${String(publication.index + 1).padStart(5, "0")}`;
  return {
    id: `inspire-${publication.index}`,
    metadata: {
      titles: [{ title: publication.title }],
      authors: publication.authors.map((fullName) => ({ full_name: fullName })),
      publication_info: [{ journal_title: publication.journal, year: publication.year }],
      dois: publication.doi ? [{ value: publication.doi }] : [],
      arxiv_eprints: [{ value: arxivId, categories: ["hep-ph"] }],
      abstracts: [{ value: publication.context }],
      earliest_date: `${publication.year}-01-01`,
      citation_count: 20,
      document_type: [publication.type],
      texkeys: [`${publication.keyBase}:${publication.year}`]
    }
  };
}

function bibtexType(publication) {
  if (String(publication.type).toLowerCase().includes("proceedings")) {
    return "inproceedings";
  }
  if (String(publication.type).toLowerCase() === "software" || String(publication.type).toLowerCase() === "dataset") {
    return "misc";
  }
  return "article";
}

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

function textResponse(payload) {
  return {
    ok: true,
    async text() {
      return payload;
    }
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
