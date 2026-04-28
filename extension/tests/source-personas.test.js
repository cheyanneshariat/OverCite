import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceRouting,
  exportCandidateBibtex,
  searchBroadCandidatesForSources,
  SOURCE_IDS
} from "../src/core/sources.js";

const PERSONAS = [
  {
    id: "physicist",
    settings: {
      sourceProfile: "astro-physics",
      sourceApiTokens: { ads: "ads-token" }
    },
    expectedPrimary: SOURCE_IDS.ADS,
    expectedFallbacks: [SOURCE_IDS.ARXIV, SOURCE_IDS.INSPIRE, SOURCE_IDS.CROSSREF],
    sources: [SOURCE_IDS.ARXIV, SOURCE_IDS.INSPIRE, SOURCE_IDS.CROSSREF]
  },
  {
    id: "biologist",
    settings: {
      sourceProfile: "life-sciences",
      sourceApiTokens: {}
    },
    expectedPrimary: SOURCE_IDS.PUBMED,
    expectedFallbacks: [SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE],
    sources: [SOURCE_IDS.PUBMED, SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE]
  },
  {
    id: "cs_researcher",
    settings: {
      sourceProfile: "computer-science",
      sourceApiTokens: {}
    },
    expectedPrimary: SOURCE_IDS.ARXIV,
    expectedFallbacks: [SOURCE_IDS.CROSSREF],
    sources: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF]
  },
  {
    id: "astro_cs_researcher",
    settings: {
      sourceProfile: "custom",
      primarySource: SOURCE_IDS.ADS,
      fallbackSources: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE],
      sourceApiTokens: { ads: "ads-token" }
    },
    expectedPrimary: SOURCE_IDS.ADS,
    expectedFallbacks: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE],
    sources: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF, SOURCE_IDS.DATACITE]
  }
];

test("persona source presets handle at least 100 unique broad lookup cases each", async () => {
  for (const persona of PERSONAS) {
    const routing = buildSourceRouting(persona.settings);
    assert.equal(routing.primarySource, persona.expectedPrimary, `${persona.id} primary source`);
    assert.deepEqual(routing.availableFallbackSources, persona.expectedFallbacks, `${persona.id} fallback sources`);

    const cases = buildPersonaCases(persona);
    assert.equal(new Set(cases.map((testCase) => testCase.id)).size, cases.length, `${persona.id} unique case ids`);
    assert.ok(cases.length >= 100, `${persona.id} should have at least 100 cases`);

    const started = performance.now();
    for (const testCase of cases) {
      const fetchCalls = [];
      const candidates = await searchBroadCandidatesForSources(
        testCase.context,
        persona.settings,
        [testCase.source],
        fakeProviderFetch(testCase, fetchCalls)
      );
      assert.equal(candidates.length, 1, `${testCase.id} candidate count`);
      assert.equal(candidates[0].sourceId, testCase.source, `${testCase.id} source`);
      assert.equal(candidates[0].title, testCase.title, `${testCase.id} title`);
      assert.equal(candidates[0].year, testCase.year, `${testCase.id} year`);
      assert.ok(fetchCalls.every((url) => url.includes(expectedHost(testCase.source))), `${testCase.id} provider isolation`);

      const bibtex = exportCandidateBibtex({
        ...candidates[0],
        generatedKey: testCase.key
      });
      assert.match(bibtex, /^@(article|inproceedings|misc)\{[A-Za-z0-9_.:-]+,/, `${testCase.id} BibTeX type/key`);
      assert.match(bibtex, /title = \{[^}]+\}/, `${testCase.id} BibTeX title`);
      assert.match(bibtex, /year = \{\d{4}\}/, `${testCase.id} BibTeX year`);
    }

    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 4000, `${persona.id} deterministic matrix should stay fast; got ${Math.round(elapsedMs)} ms`);
  }
});

function buildPersonaCases(persona) {
  const topics = topicSet(persona.id);
  const modes = ["contextual", "simple", "direct-title", "direct-id"];
  const cases = [];
  for (const [topicIndex, topic] of topics.entries()) {
    for (const [modeIndex, mode] of modes.entries()) {
      const source = persona.sources[(topicIndex + modeIndex) % persona.sources.length];
      cases.push(buildCase(persona.id, topic, topicIndex, mode, source));
    }
  }
  return cases;
}

function buildCase(personaId, topic, topicIndex, mode, source) {
  const year = 2000 + (topicIndex % 26);
  const sourceLabel = source.replace(/[^a-z]/gi, "").toLowerCase();
  const title = `${topic.title} ${sourceLabel} benchmark ${topicIndex + 1}`;
  const doi = `10.5555/${personaId}.${sourceLabel}.${topicIndex + 1}`;
  const arxivId = `${String(year % 100).padStart(2, "0")}${String(topicIndex % 12 + 1).padStart(2, "0")}.${String(topicIndex + 1).padStart(5, "0")}`;
  const key = `${topic.key}${String(year).slice(2)}_${sourceLabel}_${mode.replace(/[^a-z]/g, "")}`;
  const contextBase = `${title} studies ${topic.context} using reproducible ${topic.kind}.`;
  const dataContext = `${contextBase} The dataset software repository is archived for reuse.`;
  const token = mode === "direct-title"
    ? title
    : mode === "direct-id"
      ? directTokenForSource(source, doi, arxivId, title)
      : `${topic.key}${String(year).slice(2)}`;

  return {
    id: `${personaId}_${sourceLabel}_${topicIndex}_${mode}`,
    source,
    title,
    doi,
    arxivId,
    key,
    year,
    authors: [`${topic.author}, Example`, "Collaborator, Test"],
    journal: topic.journal,
    type: source === SOURCE_IDS.DATACITE || topic.kind === "software" || topic.kind === "dataset" ? "Dataset" : topic.type,
    context: {
      token,
      searchMode: mode === "simple" ? "simple" : mode.startsWith("direct") ? "direct" : "contextual",
      parsedKeyHint: mode.startsWith("direct") ? null : {
        surname: topic.key,
        year,
        suffix: "",
        firstInitial: ""
      },
      sentenceText: source === SOURCE_IDS.DATACITE ? dataContext : contextBase,
      contextText: `${contextBase} ${topic.extra}`
    }
  };
}

function directTokenForSource(source, doi, arxivId, title) {
  if (source === SOURCE_IDS.ARXIV) {
    return `arXiv:${arxivId}`;
  }
  if (source === SOURCE_IDS.CROSSREF || source === SOURCE_IDS.DATACITE) {
    return doi;
  }
  return title;
}

function fakeProviderFetch(testCase, fetchCalls) {
  return async (url, options = {}) => {
    fetchCalls.push(url);
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
      return jsonResponse({ esearchresult: { idlist: [testCase.key] } });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
      return jsonResponse({
        result: {
          uids: [testCase.key],
          [testCase.key]: pubmedSummary(testCase)
        }
      });
    }
    if (url.startsWith("https://api.crossref.org/works/")) {
      return jsonResponse({ message: crossrefWork(testCase) });
    }
    if (url.startsWith("https://api.crossref.org/works")) {
      return jsonResponse({ message: { items: [crossrefWork(testCase)] } });
    }
    if (url.startsWith("https://api.datacite.org/dois/")) {
      return jsonResponse({ data: dataciteWork(testCase) });
    }
    if (url.startsWith("https://api.datacite.org/dois")) {
      return jsonResponse({ data: [dataciteWork(testCase)] });
    }
    if (url.startsWith("https://export.arxiv.org/api/query")) {
      return textResponse(arxivFeed(testCase));
    }
    if (url.startsWith("https://inspirehep.net/api/literature")) {
      return jsonResponse({ hits: { hits: [inspireRecord(testCase)] } });
    }
    if (url.startsWith("https://inspirehep.net/api/doi/") || url.startsWith("https://inspirehep.net/api/arxiv/")) {
      return jsonResponse(inspireRecord(testCase));
    }
    throw new Error(`Unexpected provider URL for ${testCase.id}: ${url}`);
  };
}

function crossrefWork(testCase) {
  return {
    DOI: testCase.doi,
    title: [testCase.title],
    author: testCase.authors.map((name) => {
      const [family, given = ""] = name.split(",").map((part) => part.trim());
      return { family, given };
    }),
    issued: { "date-parts": [[testCase.year]] },
    "container-title": [testCase.journal],
    abstract: testCase.context.contextText,
    "is-referenced-by-count": 42,
    type: testCase.type,
    URL: `https://doi.org/${testCase.doi}`
  };
}

function pubmedSummary(testCase) {
  return {
    uid: testCase.key,
    title: testCase.title,
    pubdate: String(testCase.year),
    fulljournalname: testCase.journal,
    source: testCase.journal,
    authors: testCase.authors.map((name) => ({ name })),
    articleids: [{ idtype: "doi", value: testCase.doi }],
    elocationid: `doi: ${testCase.doi}`
  };
}

function dataciteWork(testCase) {
  return {
    id: testCase.doi,
    attributes: {
      doi: testCase.doi,
      titles: [{ title: testCase.title }],
      creators: testCase.authors.map((name) => ({ name })),
      publicationYear: testCase.year,
      descriptions: [{ descriptionType: "Abstract", description: testCase.context.contextText }],
      publisher: "OverCite Test Archive",
      types: { resourceTypeGeneral: testCase.type },
      url: `https://example.test/${testCase.key}`
    }
  };
}

function arxivFeed(testCase) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/${testCase.arxivId}v1</id>
        <published>${testCase.year}-01-15T00:00:00Z</published>
        <title>${escapeXml(testCase.title)}</title>
        <summary>${escapeXml(testCase.context.contextText)}</summary>
        ${testCase.authors.map((author) => `<author><name>${escapeXml(author)}</name></author>`).join("")}
        <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.DL"/>
      </entry>
    </feed>`;
}

function expectedHost(source) {
  return {
    [SOURCE_IDS.PUBMED]: "eutils.ncbi.nlm.nih.gov",
    [SOURCE_IDS.ARXIV]: "export.arxiv.org",
    [SOURCE_IDS.INSPIRE]: "inspirehep.net",
    [SOURCE_IDS.CROSSREF]: "api.crossref.org",
    [SOURCE_IDS.DATACITE]: "api.datacite.org"
  }[source];
}

function inspireRecord(testCase) {
  return {
    id: testCase.key,
    metadata: {
      titles: [{ title: testCase.title }],
      authors: testCase.authors.map((fullName) => ({ full_name: fullName })),
      publication_info: [{ journal_title: testCase.journal, year: testCase.year }],
      dois: [{ value: testCase.doi }],
      arxiv_eprints: [{ value: testCase.arxivId, categories: ["hep-ph"] }],
      abstracts: [{ value: testCase.context.contextText }],
      earliest_date: `${testCase.year}-01-15`,
      citation_count: 101,
      document_type: [testCase.type],
      texkeys: [testCase.key]
    }
  };
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

function topicSet(personaId) {
  const shared = [
    ["Li", "short surname ranking", "short names and high citation ambiguity", "Journal of Edge Cases", "journal-article", "paper"],
    ["Wang", "common surname disambiguation", "author year ranking under common surnames", "Journal of Edge Cases", "journal-article", "paper"],
    ["De Mink", "lowercase surname prefix binaries", "multi word surnames and binary evolution", "Astronomy Tests", "journal-article", "paper"],
    ["Van der Waals", "multi word surname materials", "prefix surnames in condensed matter", "Physics Tests", "journal-article", "paper"],
    ["El-Badry", "hyphenated surname wide binaries", "hyphenated authors and Gaia binaries", "Astronomy Tests", "journal-article", "paper"]
  ];
  const personaTopics = {
    physicist: [
      ["Shariat", "resolved stellar triples", "Gaia triples and stellar multiplicity", "Astrophysical Tests", "journal-article", "paper"],
      ["Perlmutter", "supernova cosmology constraints", "type Ia supernova cosmology", "Physics Letters", "journal-article", "paper"],
      ["Abbott", "gravitational wave detection", "binary black hole gravitational waves", "Physical Review Tests", "journal-article", "paper"],
      ["Onsager", "two dimensional Ising model", "statistical mechanics phase transitions", "Physics Tests", "journal-article", "paper"],
      ["Wilson", "renormalization group critical phenomena", "quantum field theory scaling", "Physics Tests", "journal-article", "paper"],
      ["Peebles", "large scale structure", "cosmological perturbation growth", "Cosmology Tests", "journal-article", "paper"],
      ["Bardeen", "black hole accretion disks", "relativistic disk astrophysics", "Astrophysical Tests", "journal-article", "paper"],
      ["Planck", "cosmic microwave background parameters", "precision cosmology and CMB", "Astronomy Tests", "journal-article", "paper"],
      ["Kitaev", "topological quantum computation", "anyon models and quantum phases", "Quantum Tests", "journal-article", "paper"],
      ["Hohenberg", "density functional theory", "many body electronic structure", "Physics Tests", "journal-article", "paper"],
      ["Madau", "cosmic star formation history", "galaxy evolution at high redshift", "Astronomy Tests", "journal-article", "paper"],
      ["Navarro", "dark matter halo profiles", "cosmological simulations", "Astrophysical Tests", "journal-article", "paper"],
      ["Press", "numerical recipes methods", "scientific computing in physics", "Computing Tests", "book", "software"],
      ["Kroupa", "stellar initial mass function", "stellar populations and clusters", "Astronomy Tests", "journal-article", "paper"],
      ["Salpeter", "initial mass function", "stellar evolution populations", "Astronomy Tests", "journal-article", "paper"],
      ["Genzel", "galactic center black hole", "stellar orbits near Sgr A", "Astrophysical Tests", "journal-article", "paper"],
      ["Riess", "accelerating universe evidence", "supernova distances and dark energy", "Cosmology Tests", "journal-article", "paper"],
      ["Schlegel", "dust extinction maps", "galactic reddening correction maps", "Astronomy Tests", "journal-article", "dataset"],
      ["Gaia", "astrometric data release", "catalog archive and parallaxes", "Astronomy Data Tests", "Dataset", "dataset"],
      ["Astropy", "astronomy Python package", "software package for astronomy", "Software Tests", "Software", "software"]
    ],
    biologist: [
      ["Jumper", "AlphaFold protein structures", "protein folding and structural biology", "Nature Tests", "journal-article", "paper"],
      ["Watson", "DNA molecular structure", "nucleic acid double helix", "Biology Tests", "journal-article", "paper"],
      ["Sanger", "DNA sequencing method", "chain termination sequencing", "Biology Tests", "journal-article", "paper"],
      ["Hochberg", "false discovery rate", "multiple testing in genomics", "Statistics Tests", "journal-article", "paper"],
      ["Love", "RNA sequencing differential expression", "DESeq2 count models", "Bioinformatics Tests", "journal-article", "software"],
      ["McKenna", "genome analysis toolkit", "variant calling software", "Genomics Tests", "journal-article", "software"],
      ["Altschul", "BLAST sequence alignment", "local alignment search", "Bioinformatics Tests", "journal-article", "software"],
      ["Edgar", "MUSCLE multiple alignment", "protein sequence alignment", "Bioinformatics Tests", "journal-article", "software"],
      ["Van Rossum", "Python reference software", "scientific Python workflows", "Software Tests", "Software", "software"],
      ["Consortium", "human genome reference", "reference genome assembly dataset", "Genome Data Tests", "Dataset", "dataset"],
      ["Fisher", "iris flower dataset", "classic species measurement data", "Data Tests", "Dataset", "dataset"],
      ["Benjamini", "false discovery control", "multiple hypotheses in biology", "Statistics Tests", "journal-article", "paper"],
      ["Dobin", "STAR RNA aligner", "RNA sequencing alignment software", "Bioinformatics Tests", "journal-article", "software"],
      ["Trapnell", "transcript assembly quantification", "RNA sequencing transcripts", "Bioinformatics Tests", "journal-article", "software"],
      ["Satija", "single cell genomics integration", "single cell RNA analysis", "Cell Tests", "journal-article", "paper"],
      ["Kanehisa", "KEGG pathway database", "pathway database archive", "Bioinformatics Data Tests", "Dataset", "dataset"],
      ["Ashburner", "gene ontology consortium", "ontology annotation database", "Bioinformatics Data Tests", "Dataset", "dataset"],
      ["Langmead", "Bowtie aligner", "short read alignment software", "Bioinformatics Tests", "journal-article", "software"],
      ["McCarthy", "edgeR count models", "RNA count statistical models", "Bioinformatics Tests", "journal-article", "software"],
      ["Subramanian", "gene set enrichment analysis", "pathway enrichment method", "Biology Tests", "journal-article", "paper"]
    ],
    cs_researcher: [
      ["Vaswani", "attention transformer architecture", "sequence models and attention", "Machine Learning Tests", "inproceedings", "paper"],
      ["Devlin", "BERT language representation", "pretraining transformer encoders", "NLP Tests", "inproceedings", "paper"],
      ["He", "deep residual learning", "image recognition networks", "Computer Vision Tests", "inproceedings", "paper"],
      ["Krizhevsky", "ImageNet convolutional networks", "deep learning vision benchmark", "Machine Learning Tests", "inproceedings", "paper"],
      ["Kingma", "Adam optimization method", "stochastic gradient optimization", "Machine Learning Tests", "inproceedings", "paper"],
      ["Ho", "diffusion probabilistic models", "generative models and denoising", "Machine Learning Tests", "inproceedings", "paper"],
      ["Radford", "language model unsupervised multitask", "large language model pretraining", "AI Tests", "journal-article", "paper"],
      ["LeCun", "gradient based learning", "document recognition neural networks", "Machine Learning Tests", "journal-article", "paper"],
      ["Harris", "NumPy array programming", "scientific Python array software", "Software Tests", "journal-article", "software"],
      ["Hunter", "Matplotlib graphics environment", "plotting software for Python", "Software Tests", "journal-article", "software"],
      ["Pedregosa", "scikit learn machine learning", "Python machine learning software", "Software Tests", "journal-article", "software"],
      ["Paszke", "PyTorch tensor library", "deep learning software framework", "Software Tests", "inproceedings", "software"],
      ["Abadi", "TensorFlow machine learning systems", "distributed machine learning software", "Software Tests", "inproceedings", "software"],
      ["Deng", "ImageNet database", "large visual recognition dataset", "Data Tests", "Dataset", "dataset"],
      ["Lin", "Microsoft COCO dataset", "image captioning detection dataset", "Data Tests", "Dataset", "dataset"],
      ["Brown", "language models few shot learners", "large language model scaling", "AI Tests", "inproceedings", "paper"],
      ["Mikolov", "word vector representations", "distributed representations language", "NLP Tests", "inproceedings", "paper"],
      ["Goodfellow", "generative adversarial networks", "adversarial generative modeling", "Machine Learning Tests", "inproceedings", "paper"],
      ["Silver", "AlphaGo reinforcement learning", "deep reinforcement learning search", "AI Tests", "journal-article", "paper"],
      ["Tibshirani", "lasso regression selection", "statistical learning shrinkage", "Statistics Tests", "journal-article", "paper"]
    ],
    astro_cs_researcher: [
      ["Astropy", "astronomy Python ecosystem", "astronomy software package", "Software Tests", "Software", "software"],
      ["Gaia", "data release astrometry archive", "large astrometric catalog dataset", "Astronomy Data Tests", "Dataset", "dataset"],
      ["Ivezic", "LSST survey overview", "survey data management astronomy", "Astronomy Tests", "journal-article", "paper"],
      ["Bailer-Jones", "Gaia distance inference", "Bayesian distances and catalog methods", "Astronomy Tests", "journal-article", "paper"],
      ["Barbary", "sncosmo supernova software", "Python light curve fitting software", "Software Tests", "Software", "software"],
      ["Foreman-Mackey", "emcee MCMC sampler", "affine invariant sampling software", "Software Tests", "journal-article", "software"],
      ["Hogg", "data analysis recipes", "probabilistic modeling astronomy", "Astronomy Tests", "journal-article", "paper"],
      ["Breiman", "random forests classifier", "machine learning classification", "Statistics Tests", "journal-article", "paper"],
      ["Scargle", "Lomb Scargle periodogram", "time series period detection", "Astronomy Tests", "journal-article", "paper"],
      ["VanderPlas", "periodograms and astroML", "machine learning for astronomy", "Astronomy Tests", "journal-article", "software"],
      ["Zwicky", "transient facility survey", "time domain survey data", "Astronomy Data Tests", "Dataset", "dataset"],
      ["Bellm", "ZTF system overview", "astronomical survey operations", "Astronomy Tests", "journal-article", "paper"],
      ["Price-Whelan", "gala dynamics software", "galactic dynamics Python package", "Software Tests", "Software", "software"],
      ["Bradbury", "JAX transformations", "accelerated scientific computing software", "Software Tests", "Software", "software"],
      ["Virtanen", "SciPy algorithms", "scientific computing software", "Software Tests", "journal-article", "software"],
      ["Jones", "Kaggle astronomy challenge", "machine learning classification dataset", "Data Tests", "Dataset", "dataset"],
      ["Narayan", "photometric classification challenge", "supernova classification benchmark", "Astronomy Data Tests", "Dataset", "dataset"],
      ["Chollet", "Keras deep learning API", "neural network software interface", "Software Tests", "Software", "software"],
      ["Pedregosa", "scikit learn astronomy pipeline", "machine learning software pipeline", "Software Tests", "journal-article", "software"],
      ["Shariat", "Gaia stellar triples software", "stellar multiplicity and Python analysis", "Astronomy Tests", "journal-article", "paper"]
    ]
  };
  return [...shared, ...personaTopics[personaId]];
}
