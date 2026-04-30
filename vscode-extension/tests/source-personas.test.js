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
    id: "physics",
    settings: {
      sourceProfile: "physics",
      sourceApiTokens: {}
    },
    expectedPrimary: SOURCE_IDS.INSPIRE,
    expectedFallbacks: [SOURCE_IDS.CROSSREF],
    sources: [SOURCE_IDS.INSPIRE, SOURCE_IDS.CROSSREF]
  },
  {
    id: "math",
    settings: {
      sourceProfile: "math",
      sourceApiTokens: {}
    },
    expectedPrimary: SOURCE_IDS.ARXIV,
    expectedFallbacks: [SOURCE_IDS.CROSSREF],
    sources: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF]
  },
  {
    id: "life_sciences",
    settings: {
      sourceProfile: "life-sciences",
      sourceApiTokens: { ncbi: "ncbi-token" }
    },
    expectedPrimary: SOURCE_IDS.PUBMED,
    expectedFallbacks: [SOURCE_IDS.CROSSREF],
    sources: [SOURCE_IDS.PUBMED, SOURCE_IDS.CROSSREF]
  },
  {
    id: "computer_science",
    settings: {
      sourceProfile: "computer-science",
      sourceApiTokens: {}
    },
    expectedPrimary: SOURCE_IDS.ARXIV,
    expectedFallbacks: [SOURCE_IDS.CROSSREF],
    sources: [SOURCE_IDS.ARXIV, SOURCE_IDS.CROSSREF]
  },
  {
    id: "chemistry",
    settings: {
      sourceProfile: "chemistry",
      sourceApiTokens: {}
    },
    expectedPrimary: SOURCE_IDS.CROSSREF,
    expectedFallbacks: [],
    sources: [SOURCE_IDS.CROSSREF]
  },
  {
    id: "interdisciplinary",
    settings: {
      sourceProfile: "custom",
      primarySource: SOURCE_IDS.ADS,
      fallbackSources: [
        SOURCE_IDS.ARXIV,
        SOURCE_IDS.CROSSREF,
        SOURCE_IDS.DATACITE
      ],
      sourceApiTokens: { ads: "ads-token" }
    },
    expectedPrimary: SOURCE_IDS.ADS,
    expectedFallbacks: [
      SOURCE_IDS.ARXIV,
      SOURCE_IDS.CROSSREF,
      SOURCE_IDS.DATACITE
    ],
    sources: [
      SOURCE_IDS.ARXIV,
      SOURCE_IDS.CROSSREF,
      SOURCE_IDS.DATACITE
    ]
  }
];

test("VS Code source presets handle at least 100 broad lookup cases per research area", async () => {
  for (const persona of PERSONAS) {
    const routing = buildSourceRouting(persona.settings);
    assert.equal(routing.primarySource, persona.expectedPrimary, `${persona.id} primary source`);
    assert.deepEqual(routing.availableFallbackSources, persona.expectedFallbacks, `${persona.id} fallbacks`);

    const cases = buildPersonaCases(persona);
    assert.equal(new Set(cases.map((testCase) => testCase.id)).size, cases.length, `${persona.id} unique ids`);
    assert.ok(cases.length >= 100, `${persona.id} should have at least 100 cases`);

    const started = performance.now();
    for (const testCase of cases) {
      const fetchCalls = [];
      const candidates = await searchBroadCandidatesForSources(
        testCase.context,
        persona.settings,
        [testCase.source],
        fakeProviderFetch(testCase, persona.settings, fetchCalls)
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
      assert.match(bibtex, /^@(article|inproceedings|misc)\{[A-Za-z0-9_.:-]+,/, `${testCase.id} BibTeX header`);
      assert.match(bibtex, /title = \{[^}]+\}/, `${testCase.id} BibTeX title`);
      assert.match(bibtex, /year = \{\d{4}\}/, `${testCase.id} BibTeX year`);
    }

    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 5000, `${persona.id} matrix should stay fast; got ${Math.round(elapsedMs)} ms`);
  }
});

test("arXiv author-year lookup starts with context-aware author-year query", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "Triple star systems are common in Gaia and should resolve through arXiv.",
    contextText: "legacy ADS path words should not prevent arXiv fallback"
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const query = new URL(url).searchParams.get("search_query") ?? "";
    assert.equal(query, 'au:"Shariat" AND submittedDate:[202501010000 TO 202512312359] AND (all:"triple" OR all:"star" OR all:"systems" OR all:"common" OR all:"gaia")');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2506.16513v1</id>
          <published>2025-06-19T00:00:00Z</published>
          <title>10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations</title>
          <summary>Triple population abstract.</summary>
          <author><name>Cheyanne Shariat</name></author>
          <author><name>Kareem El-Badry</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.SR"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eprint, "2506.16513");
});

test("arXiv author-year lookup falls back to broad author-year when context is too narrow", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "This nearby systems citation should still recover when arXiv context is too narrow."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    if (fetchCalls.length === 1) {
      assert.match(new URL(url).searchParams.get("search_query") ?? "", /all:"nearby"/);
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`);
    }
    assert.equal(new URL(url).searchParams.get("search_query"), 'au:"Shariat" AND submittedDate:[202501010000 TO 202512312359]');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2506.16513v1</id>
          <published>2025-06-19T00:00:00Z</published>
          <title>10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations</title>
          <summary>Triple population abstract.</summary>
          <author><name>Cheyanne Shariat</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.SR"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates[0].eprint, "2506.16513");
});

test("arXiv author-year lookup retries prior preprint year when journal year misses first-author papers", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Foreman-Mackey2013",
    parsedKeyHint: { surname: "Foreman-Mackey", year: 2013 },
    sentenceText: "The emcee sampler is widely used for affine-invariant MCMC.",
    contextText: "The emcee sampler is widely used for affine-invariant MCMC."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const query = new URL(url).searchParams.get("search_query") ?? "";
    if (fetchCalls.length === 1) {
      assert.match(query, /submittedDate:\[201301010000 TO 201312312359\]/);
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/1310.4179v1</id>
            <published>2013-10-15T00:00:00Z</published>
            <title>A coauthored 2013 arXiv paper</title>
            <summary>Andromeda disk stars.</summary>
            <author><name>Claire Dorman</name></author>
            <author><name>Daniel Foreman-Mackey</name></author>
            <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.GA"/>
          </entry>
        </feed>`);
    }
    assert.equal(query, 'au:"Foreman-Mackey" AND submittedDate:[201201010000 TO 201312312359]');
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/1202.3665v4</id>
          <published>2012-02-16T00:00:00Z</published>
          <title>emcee: The MCMC Hammer</title>
          <summary>Affine-invariant ensemble sampling with MCMC.</summary>
          <author><name>Daniel Foreman-Mackey</name></author>
          <author><name>David W. Hogg</name></author>
          <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1086/670067</arxiv:doi>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.IM"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates.some((candidate) => candidate.eprint === "1202.3665"), true);
});

test("arXiv author-year lookup retries once after rate limiting", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 }
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    if (fetchCalls.length === 1) {
      return statusResponse(429, { "Retry-After": "0.001" });
    }
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2506.16513v1</id>
          <published>2025-06-19T00:00:00Z</published>
          <title>10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations</title>
          <summary>Triple population abstract.</summary>
          <author><name>Cheyanne Shariat</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.SR"/>
        </entry>
      </feed>`);
  });

  assert.equal(fetchCalls.length, 2);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].eprint, "2506.16513");
});

test("arXiv runtime cache reuses repeated author-year lookups", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2601.00001v1</id>
          <published>2026-01-01T00:00:00Z</published>
          <title>Cached arXiv Result</title>
          <summary>Cache test abstract.</summary>
          <author><name>Example Cache</name></author>
          <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.DL"/>
        </entry>
      </feed>`);
  };
  try {
    const citationContext = {
      token: "Cache2026",
      parsedKeyHint: { surname: "Cache", year: 2026 }
    };
    await searchBroadCandidatesForSources(citationContext, {
      sourceProfile: "custom",
      sourceApiTokens: {}
    }, [SOURCE_IDS.ARXIV]);
    const second = await searchBroadCandidatesForSources(citationContext, {
      sourceProfile: "custom",
      sourceApiTokens: {}
    }, [SOURCE_IDS.ARXIV]);

    assert.equal(fetchCalls.length, 1);
    assert.equal(second[0].eprint, "2601.00001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arXiv rate-limit text falls back to Crossref metadata", async () => {
  const fetchCalls = [];
  const candidates = await searchBroadCandidatesForSources({
    token: "Shariat2025",
    parsedKeyHint: { surname: "Shariat", year: 2025 },
    sentenceText: "Resolved triples from Gaia constrain triple star populations."
  }, {
    sourceProfile: "custom",
    sourceApiTokens: {}
  }, [SOURCE_IDS.ARXIV], async (url) => {
    fetchCalls.push(url);
    const host = new URL(url).host;
    if (host === "export.arxiv.org") {
      return rateLimitedTextResponse();
    }
    assert.equal(host, "api.crossref.org");
    return jsonResponse({
      message: {
        items: [{
          DOI: "10.1088/1538-3873/adfb30",
          title: ["10,000 Resolved Triples from Gaia: Empirical Constraints on Triple Star Populations"],
          author: [{ family: "Shariat", given: "Cheyanne" }, { family: "El-Badry", given: "Kareem" }],
          issued: { "date-parts": [[2025]] },
          "container-title": ["Publications of the Astronomical Society of the Pacific"],
          type: "journal-article",
          URL: "https://doi.org/10.1088/1538-3873/adfb30"
        }]
      }
    });
  });

  assert.equal(fetchCalls.filter((url) => new URL(url).host === "export.arxiv.org").length, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, SOURCE_IDS.CROSSREF);
  assert.equal(candidates[0].doi, "10.1088/1538-3873/adfb30");
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
  const sourceSlug = source.replace(/[^a-z]/gi, "").toLowerCase();
  const title = `${topic.title} ${sourceSlug} benchmark ${topicIndex + 1}`;
  const doi = `10.5555/${personaId}.${sourceSlug}.${topicIndex + 1}`;
  const arxivId = `${String(year % 100).padStart(2, "0")}${String((topicIndex % 12) + 1).padStart(2, "0")}.${String(topicIndex + 1).padStart(5, "0")}`;
  const key = `${topic.key}${String(year).slice(2)}_${sourceSlug}_${mode.replace(/[^a-z]/g, "")}`;
  const contextBase = `${title} studies ${topic.context} using reproducible ${topic.kind}.`;
  const dataContext = `${contextBase} The dataset software repository is archived for reuse.`;
  const token = mode === "direct-title"
    ? title
    : mode === "direct-id"
      ? directTokenForSource(source, doi, arxivId, title)
      : `${topic.key}${String(year).slice(2)}`;

  return {
    id: `${personaId}_${sourceSlug}_${topicIndex}_${mode}`,
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
      contextText: `${source === SOURCE_IDS.DATACITE ? dataContext : contextBase} ${topic.extra}`
    }
  };
}

function directTokenForSource(source, doi, arxivId, title) {
  if (source === SOURCE_IDS.ARXIV) {
    return `arXiv:${arxivId}`;
  }
  if (source === SOURCE_IDS.CROSSREF || source === SOURCE_IDS.DATACITE || source === SOURCE_IDS.PUBMED) {
    return doi;
  }
  return title;
}

function fakeProviderFetch(testCase, settings, fetchCalls) {
  return async (url, options = {}) => {
    fetchCalls.push(url);
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")) {
      assert.equal(new URL(url).searchParams.get("api_key"), settings.sourceApiTokens?.ncbi, `${testCase.id} NCBI key`);
      return jsonResponse({ esearchresult: { idlist: [testCase.key] } });
    }
    if (url.startsWith("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")) {
      assert.equal(new URL(url).searchParams.get("api_key"), settings.sourceApiTokens?.ncbi, `${testCase.id} NCBI summary key`);
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
    author: splitAuthors(testCase.authors),
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

function splitAuthors(authors) {
  return authors.map((name) => {
    const [family, given = ""] = name.split(",").map((part) => part.trim());
    return { family, given };
  });
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
    status: 200,
    headers: {
      get() {
        return null;
      }
    },
    async text() {
      return payload;
    }
  };
}

function rateLimitedTextResponse() {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "retry-after" ? "0.001" : null;
      }
    },
    async text() {
      return "Rate exceeded.";
    }
  };
}

function statusResponse(status, headers = {}) {
  return {
    ok: false,
    status,
    headers: {
      get(name) {
        return headers[name] ?? headers[String(name).toLowerCase()] ?? null;
      }
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
    ["El-Badry", "hyphenated surname wide binaries", "hyphenated authors and Gaia binaries", "Astronomy Tests", "journal-article", "paper"],
    ["Consortium", "collaboration style authors", "large team publications and author parsing", "Collaboration Tests", "journal-article", "paper"],
    ["Data", "repository lookup", "dataset software archive citation", "Data Tests", "Dataset", "dataset"],
    ["Tool", "software citation", "software package release and documentation", "Software Tests", "Software", "software"]
  ];
  const personaTopics = {
    astro_physics: [
      ["Shariat", "resolved stellar triples", "Gaia triples and stellar multiplicity", "Astrophysical Tests", "journal-article", "paper"],
      ["Perlmutter", "supernova cosmology constraints", "type Ia supernova cosmology", "Physics Letters", "journal-article", "paper"],
      ["Abbott", "gravitational wave detection", "binary black hole gravitational waves", "Physical Review Tests", "journal-article", "paper"],
      ["Onsager", "two dimensional Ising model", "statistical mechanics phase transitions", "Physics Tests", "journal-article", "paper"],
      ["Wilson", "renormalization group critical phenomena", "quantum field theory scaling", "Physics Tests", "journal-article", "paper"],
      ["Peebles", "large scale structure", "cosmological perturbation growth", "Cosmology Tests", "journal-article", "paper"],
      ["Planck", "cosmic microwave background parameters", "precision cosmology and CMB", "Astronomy Tests", "journal-article", "paper"],
      ["Kitaev", "topological quantum computation", "anyon models and quantum phases", "Quantum Tests", "journal-article", "paper"],
      ["Hohenberg", "density functional theory", "many body electronic structure", "Physics Tests", "journal-article", "paper"],
      ["Madau", "cosmic star formation history", "galaxy evolution at high redshift", "Astronomy Tests", "journal-article", "paper"],
      ["Navarro", "dark matter halo profiles", "cosmological simulations", "Astrophysical Tests", "journal-article", "paper"],
      ["Kroupa", "stellar initial mass function", "stellar populations and clusters", "Astronomy Tests", "journal-article", "paper"],
      ["Salpeter", "initial mass function", "stellar evolution populations", "Astronomy Tests", "journal-article", "paper"],
      ["Genzel", "galactic center black hole", "stellar orbits near Sgr A", "Astrophysical Tests", "journal-article", "paper"],
      ["Riess", "accelerating universe evidence", "supernova distances and dark energy", "Cosmology Tests", "journal-article", "paper"],
      ["Schlegel", "dust extinction maps", "galactic reddening correction maps", "Astronomy Tests", "journal-article", "dataset"],
      ["Gaia", "astrometric data release", "catalog archive and parallaxes", "Astronomy Data Tests", "Dataset", "dataset"],
      ["Astropy", "astronomy Python package", "software package for astronomy", "Software Tests", "Software", "software"],
      ["Scargle", "Lomb Scargle periodogram", "time series period detection", "Astronomy Tests", "journal-article", "paper"],
      ["Hogg", "data analysis recipes", "probabilistic modeling astronomy", "Astronomy Tests", "journal-article", "paper"],
      ["Foreman-Mackey", "emcee sampler", "MCMC sampler software", "Software Tests", "journal-article", "software"],
      ["Ivezic", "survey overview", "survey data management astronomy", "Astronomy Tests", "journal-article", "paper"],
      ["Bellm", "ZTF system overview", "astronomical survey operations", "Astronomy Tests", "journal-article", "paper"],
      ["Bailer-Jones", "Gaia distance inference", "Bayesian distances and catalog methods", "Astronomy Tests", "journal-article", "paper"]
    ],
    math_physics: [
      ["Euler", "graph theory paths", "combinatorics and graph structure", "Mathematics Tests", "journal-article", "paper"],
      ["Noether", "symmetry conservation theorem", "variational symmetries and physics", "Mathematical Physics Tests", "journal-article", "paper"],
      ["Wiles", "modular elliptic curves", "number theory and modularity", "Mathematics Tests", "journal-article", "paper"],
      ["Tao", "compressed sensing theory", "harmonic analysis and sparse recovery", "Mathematics Tests", "journal-article", "paper"],
      ["Perelman", "Ricci flow geometry", "geometric topology and manifolds", "Mathematics Tests", "journal-article", "paper"],
      ["Gromov", "metric structures", "geometric group theory", "Mathematics Tests", "journal-article", "paper"],
      ["Kardar", "interface growth equation", "statistical mechanics stochastic PDE", "Physics Tests", "journal-article", "paper"],
      ["Chern", "characteristic classes", "differential geometry and topology", "Mathematics Tests", "journal-article", "paper"],
      ["Lax", "hyperbolic systems", "partial differential equations", "Mathematics Tests", "journal-article", "paper"],
      ["Kolmogorov", "turbulence spectrum", "probability and fluid dynamics", "Physics Tests", "journal-article", "paper"],
      ["Hilbert", "integral equations", "functional analysis methods", "Mathematics Tests", "journal-article", "paper"],
      ["Dirac", "quantum transformation theory", "mathematical foundations of quantum mechanics", "Physics Tests", "journal-article", "paper"],
      ["Feynman", "path integral formulation", "quantum amplitudes and field theory", "Physics Tests", "journal-article", "paper"],
      ["Landau", "phase transition theory", "statistical physics phenomenology", "Physics Tests", "journal-article", "paper"],
      ["Kac", "random matrices", "probability and spectral statistics", "Mathematics Tests", "journal-article", "paper"],
      ["Bourgain", "ergodic estimates", "analysis and number theory", "Mathematics Tests", "journal-article", "paper"],
      ["Kontsevich", "deformation quantization", "geometry and mathematical physics", "Mathematical Physics Tests", "journal-article", "paper"],
      ["Seiberg", "supersymmetric gauge theory", "duality and field theory", "Physics Tests", "journal-article", "paper"],
      ["Witten", "topological quantum field", "geometry and quantum theory", "Physics Tests", "journal-article", "paper"],
      ["Villani", "optimal transport", "analysis probability and geometry", "Mathematics Tests", "journal-article", "paper"],
      ["Smale", "dynamical systems", "topology and nonlinear dynamics", "Mathematics Tests", "journal-article", "paper"],
      ["Arnold", "catastrophe theory", "singularities and mechanics", "Mathematics Tests", "journal-article", "paper"],
      ["Penrose", "twistor geometry", "relativity and complex geometry", "Physics Tests", "journal-article", "paper"],
      ["Ruelle", "thermodynamic formalism", "dynamical systems and statistical mechanics", "Physics Tests", "journal-article", "paper"]
    ],
    life_sciences: [
      ["Jumper", "AlphaFold protein structures", "protein folding and structural biology", "Nature Tests", "journal-article", "paper"],
      ["Watson", "DNA molecular structure", "nucleic acid double helix", "Biology Tests", "journal-article", "paper"],
      ["Sanger", "DNA sequencing method", "chain termination sequencing", "Biology Tests", "journal-article", "paper"],
      ["Hochberg", "false discovery rate", "multiple testing in genomics", "Statistics Tests", "journal-article", "paper"],
      ["Love", "RNA sequencing differential expression", "DESeq2 count models", "Bioinformatics Tests", "journal-article", "software"],
      ["McKenna", "genome analysis toolkit", "variant calling software", "Genomics Tests", "journal-article", "software"],
      ["Altschul", "BLAST sequence alignment", "local alignment search", "Bioinformatics Tests", "journal-article", "software"],
      ["Edgar", "MUSCLE multiple alignment", "protein sequence alignment", "Bioinformatics Tests", "journal-article", "software"],
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
      ["Subramanian", "gene set enrichment analysis", "pathway enrichment method", "Biology Tests", "journal-article", "paper"],
      ["Kozomara", "miRBase database", "microRNA annotation database", "Bioinformatics Data Tests", "Dataset", "dataset"],
      ["Finn", "Pfam protein families", "protein family database", "Bioinformatics Data Tests", "Dataset", "dataset"],
      ["Yates", "Ensembl genome browser", "genome database resource", "Bioinformatics Data Tests", "Dataset", "dataset"],
      ["Quinlan", "BEDTools software", "genomic interval software", "Bioinformatics Tests", "journal-article", "software"],
      ["Robinson", "Integrative genomics viewer", "genome visualization software", "Bioinformatics Tests", "journal-article", "software"]
    ],
    computer_science: [
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
      ["Tibshirani", "lasso regression selection", "statistical learning shrinkage", "Statistics Tests", "journal-article", "paper"],
      ["Pearl", "causal inference models", "graphical models and causality", "AI Tests", "journal-article", "paper"],
      ["Knuth", "literate programming systems", "algorithmic typesetting and software", "Computing Tests", "journal-article", "software"],
      ["Cormen", "algorithm textbook", "algorithm design and analysis", "Computing Tests", "book", "paper"],
      ["Turing", "computing machinery intelligence", "foundations of artificial intelligence", "Computing Tests", "journal-article", "paper"]
    ],
    interdisciplinary: [
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
      ["Shariat", "Gaia stellar triples software", "stellar multiplicity and Python analysis", "Astronomy Tests", "journal-article", "paper"],
      ["Robitaille", "APLpy visualization", "astronomical plotting software", "Software Tests", "Software", "software"],
      ["Bovy", "galpy dynamics", "galactic dynamics software", "Software Tests", "Software", "software"],
      ["Ricker", "TESS mission data", "exoplanet survey archive", "Astronomy Data Tests", "Dataset", "dataset"],
      ["Skrutskie", "2MASS survey", "near infrared astronomy catalog", "Astronomy Data Tests", "Dataset", "dataset"]
    ]
  };
  const topicKey = {
    astrophysics: "astro_physics",
    physics: "math_physics",
    math: "math_physics",
    chemistry: "computer_science"
  }[personaId] ?? personaId;
  return [...shared, ...(personaTopics[topicKey] ?? [])];
}
