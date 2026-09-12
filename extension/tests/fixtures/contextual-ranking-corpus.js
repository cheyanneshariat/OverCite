export const CONTEXTUAL_RANKING_CORPUS = [
  {
    id: "strader-decimal-proximity",
    expectedBibcode: "strader-target",
    context: {
      token: "Strader2019",
      searchMode: "contextual",
      sentenceText: "09~{\\rm M_\\odot}$ .",
      citationPrefixText: "Redback pulsars also appear systematically massive, with a median inferred neutron star mass of $1.78\\pm0.09~{\\rm M_\\odot}$",
      citationSuffixText: ". However, these measurements can be biased.",
      contextText: "They infer a birth-mass distribution. Redback pulsars appear systematically massive.",
      parsedKeyHint: { surname: "Strader", year: 2019, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "wrong-author-context",
        title: "The Mass Distribution of Redback Pulsars",
        authors: ["Other, Alice"],
        year: 2019,
        abstract: "Redback pulsars appear systematically massive.",
        citationCount: 80
      },
      {
        bibcode: "strader-unrelated",
        title: "Dynamical Encounters in Globular Clusters",
        authors: ["Strader, Jay"],
        year: 2019,
        abstract: "A study of cluster dynamics.",
        citationCount: 300
      },
      {
        bibcode: "strader-target",
        title: "Optical Spectroscopy and Demographics of Redback Millisecond Pulsar Binaries",
        authors: ["Strader, Jay", "Swihart, Samuel"],
        year: 2019,
        abstract: "We measure the neutron star mass distribution of redback pulsars.",
        citationCount: 35
      }
    ]
  },
  {
    id: "m51-local-context",
    expectedBibcode: "rice-m51",
    context: {
      token: "Rice2021",
      searchMode: "contextual",
      sentenceText: "This source confusion is also found in previous M51 studies.",
      citationPrefixText: "Multiple optical HST counterparts occur near individual Chandra X-ray sources in M51",
      citationSuffixText: ".",
      contextText: "M51 Chandra X-ray sources can have multiple optical HST counterpart candidates.",
      parsedKeyHint: { surname: "Rice", year: 2021, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "rice-unrelated",
        title: "Planet Formation in Dusty Disks",
        authors: ["Rice, Ken"],
        year: 2021,
        abstract: "Protoplanetary disk evolution.",
        citationCount: 120
      },
      {
        bibcode: "rice-m51",
        title: "Optical Counterparts of Chandra X-ray Sources in M51",
        authors: ["Rice, Thomas"],
        year: 2021,
        abstract: "We identify HST optical counterpart candidates in M51.",
        citationCount: 12
      }
    ]
  },
  {
    id: "wrong-author-title-distractor",
    expectedBibcode: "shariat-target",
    context: {
      token: "Shariat2025",
      searchMode: "contextual",
      sentenceText: "Resolved stellar triples from Gaia constrain the triple-star population.",
      citationPrefixText: "Resolved stellar triples from Gaia constrain the triple-star population",
      citationSuffixText: ".",
      contextText: "Resolved stellar triples from Gaia constrain the triple-star population.",
      parsedKeyHint: { surname: "Shariat", year: 2025, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "wrong-author-perfect-title",
        title: "Resolved Stellar Triples from Gaia",
        authors: ["Other, Alice"],
        year: 2025,
        abstract: "Triple-star population constraints.",
        citationCount: 900
      },
      {
        bibcode: "shariat-target",
        title: "Resolved Triple Systems from Gaia",
        authors: ["Shariat, Cheyanne"],
        year: 2025,
        abstract: "A census of resolved stellar triples and their population.",
        citationCount: 20
      }
    ]
  },
  {
    id: "same-author-year-context",
    expectedBibcode: "elbadry-braking",
    context: {
      token: "ElBadry2022",
      searchMode: "contextual",
      sentenceText: "Magnetic braking becomes inefficient in fully convective stars.",
      citationPrefixText: "Magnetic braking becomes inefficient in fully convective stars",
      citationSuffixText: ".",
      contextText: "Close binaries constrain magnetic braking in fully convective stars.",
      parsedKeyHint: { surname: "ElBadry", year: 2022, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "elbadry-other",
        title: "A Population of Dormant Black Hole Binaries",
        authors: ["El-Badry, Kareem"],
        year: 2022,
        abstract: "Gaia binaries with unseen companions.",
        citationCount: 500
      },
      {
        bibcode: "elbadry-braking",
        title: "Magnetic Braking and the Fully Convective Boundary",
        authors: ["El-Badry, Kareem"],
        year: 2022,
        abstract: "Close binaries test magnetic braking in fully convective stars.",
        citationCount: 45
      }
    ]
  },
  {
    id: "explicit-year-beats-adjacent-year",
    expectedBibcode: "vanroestel-2021",
    context: {
      token: "VanRoestel2021",
      searchMode: "contextual",
      sentenceText: "The ZTF source classification project provides a reusable infrastructure.",
      citationPrefixText: "The ZTF source classification project provides reusable methods and infrastructure",
      citationSuffixText: ".",
      contextText: "ZTF source classification methods and infrastructure.",
      parsedKeyHint: { surname: "VanRoestel", year: 2021, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "vanroestel-2020",
        title: "The ZTF Source Classification Project: Methods and Infrastructure",
        authors: ["van Roestel, Jan"],
        year: 2020,
        abstract: "ZTF classification infrastructure.",
        citationCount: 150
      },
      {
        bibcode: "vanroestel-2021",
        title: "The ZTF Source Classification Project I: Methods and Infrastructure",
        authors: ["van Roestel, Jan"],
        year: 2021,
        abstract: "ZTF classification methods and infrastructure.",
        citationCount: 60
      }
    ]
  },
  {
    id: "surname-only-context",
    expectedBibcode: "schlegel-dust",
    context: {
      token: "Schlegel",
      searchMode: "contextual",
      sentenceText: "Galactic dust maps provide extinction corrections.",
      citationPrefixText: "Galactic dust maps provide extinction corrections",
      citationSuffixText: ".",
      contextText: "We correct photometry using Galactic dust maps.",
      parsedKeyHint: { surname: "Schlegel", year: null, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "schlegel-survey",
        title: "A New Spectroscopic Galaxy Survey",
        authors: ["Schlegel, David"],
        year: 2011,
        abstract: "Survey instrumentation and galaxies.",
        citationCount: 800
      },
      {
        bibcode: "schlegel-dust",
        title: "Maps of Dust Infrared Emission for Use in Estimation of Reddening and Cosmic Microwave Background Radiation Foregrounds",
        authors: ["Schlegel, David", "Finkbeiner, Douglas", "Davis, Marc"],
        year: 1998,
        abstract: "Galactic dust maps provide extinction and reddening corrections.",
        citationCount: 10000
      }
    ]
  },
  {
    id: "empty-token-context",
    expectedBibcode: "transformers",
    context: {
      token: "",
      searchMode: "contextual",
      sentenceText: "Attention mechanisms replace recurrence for sequence transduction.",
      citationPrefixText: "Attention mechanisms replace recurrence for sequence transduction",
      citationSuffixText: ".",
      contextText: "Transformer models use self attention instead of recurrent networks.",
      parsedKeyHint: null
    },
    candidates: [
      {
        bibcode: "attention-vision",
        title: "Visual Attention for Image Captioning",
        authors: ["Xu, Kelvin"],
        year: 2015,
        abstract: "Attention for images and captions.",
        citationCount: 9000
      },
      {
        bibcode: "transformers",
        title: "Attention Is All You Need",
        authors: ["Vaswani, Ashish"],
        year: 2017,
        abstract: "Sequence transduction using self-attention without recurrent networks.",
        citationCount: 100000
      }
    ]
  },
  {
    id: "latex-noise-proximity",
    expectedBibcode: "foreman-emcee",
    context: {
      token: "ForemanMackey2013",
      searchMode: "contextual",
      sentenceText: "We sample the posterior with an affine-invariant ensemble sampler.",
      citationPrefixText: "We sample $p(\\theta\\mid d)$ with the affine-invariant ensemble sampler % old citation follows\n",
      citationSuffixText: ". See also \\citep{Other2020} and Section~\\ref{sec:methods}.",
      contextText: "Posterior sampling with an affine-invariant ensemble MCMC method.",
      parsedKeyHint: { surname: "ForemanMackey", year: 2013, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "foreman-dynamics",
        title: "Exoplanet Population Inference",
        authors: ["Foreman-Mackey, Daniel"],
        year: 2013,
        abstract: "Exoplanet demographics.",
        citationCount: 500
      },
      {
        bibcode: "foreman-emcee",
        title: "emcee: The MCMC Hammer",
        authors: ["Foreman-Mackey, Daniel"],
        year: 2013,
        abstract: "An affine-invariant ensemble sampler for Markov chain Monte Carlo.",
        citationCount: 6000
      }
    ]
  },
  {
    id: "yang-common-surname-distinctive-system",
    expectedBibcode: "yang-triple",
    context: {
      token: "Yang2026",
      searchMode: "contextual",
      sentenceText: "6$ .",
      citationPrefixText: "Finding NSs in hierarchical triples can test the proposed kick model. Recently, PSR J0435+3233, an 8-day pulsar--white-dwarf binary, was found to have a $\\sim1\\~\\msun$ tertiary with $a_2\\approx25$ au and $e_2\\approx0.6$",
      citationSuffixText: ".",
      contextText: "Finding NSs in hierarchical triples can test the proposed kick model. PSR J0435+3233 is a pulsar white-dwarf binary with a stellar tertiary.",
      parsedKeyHint: { surname: "Yang", year: 2026, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "yang-unrelated",
        title: "Gamma-Ray Timing of Millisecond Pulsars",
        authors: ["Yang, Ming-Kai"],
        year: 2026,
        abstract: "Gamma-ray pulsations and spin-down measurements.",
        citationCount: 25,
        property: ["ARTICLE", "REFEREED"],
        doctype: "article"
      },
      {
        bibcode: "identifier-distractor",
        title: "Discovery of Gamma-Ray Pulsations from PSR J0435+3233",
        authors: ["Other, Alice"],
        year: 2026,
        abstract: "Gamma-ray pulsations from the extreme-spin-down millisecond pulsar.",
        citationCount: 8
      },
      {
        bibcode: "yang-triple",
        title: "The PSR J0435+3233 Triple System",
        authors: ["Yang, Z. L.", "Han, J. L."],
        year: 2026,
        abstract: "PSR J0435+3233 is a hierarchical triple with a white-dwarf inner binary and a distant stellar tertiary.",
        citationCount: 0,
        property: ["ARTICLE", "EPRINT_OPENACCESS"],
        doctype: "article"
      }
    ]
  },
  {
    id: "physics-same-author-year-photoelectric",
    expectedBibcode: "einstein-photoelectric",
    context: {
      token: "Einstein1905",
      searchMode: "contextual",
      sentenceText: "The photoelectric effect follows from light quanta whose energy is proportional to frequency.",
      citationPrefixText: "The photoelectric effect follows from light quanta whose energy is proportional to frequency",
      citationSuffixText: ".",
      contextText: "Light quanta explain the photoelectric effect and electron emission.",
      parsedKeyHint: { surname: "Einstein", year: 1905, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "einstein-brownian",
        title: "On the Motion of Small Particles Suspended in Liquids at Rest Required by the Molecular-Kinetic Theory of Heat",
        authors: ["Einstein, Albert"],
        year: 1905,
        abstract: "Brownian motion of suspended particles and molecular kinetic theory.",
        citationCount: 9000
      },
      {
        bibcode: "einstein-photoelectric",
        title: "On a Heuristic Point of View Concerning the Production and Transformation of Light",
        authors: ["Einstein, Albert"],
        year: 1905,
        abstract: "Light quanta account for the photoelectric effect and the energy of emitted electrons.",
        citationCount: 8000
      }
    ]
  },
  {
    id: "computer-science-diffusion",
    expectedBibcode: "ho-diffusion",
    context: {
      token: "Ho2020",
      searchMode: "contextual",
      sentenceText: "Images are generated by reversing a gradual Gaussian noising process.",
      citationPrefixText: "Images are generated by reversing a gradual Gaussian noising process",
      citationSuffixText: ".",
      contextText: "Denoising diffusion probabilistic models learn the reverse process.",
      parsedKeyHint: { surname: "Ho", year: 2020, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "ho-unrelated",
        title: "Learning Representations for Graph Classification",
        authors: ["Ho, Jonathan"],
        year: 2020,
        abstract: "Graph neural network representations for classification.",
        citationCount: 1200
      },
      {
        bibcode: "ho-diffusion",
        title: "Denoising Diffusion Probabilistic Models",
        authors: ["Ho, Jonathan", "Jain, Ajay", "Abbeel, Pieter"],
        year: 2020,
        abstract: "A probabilistic model reverses a gradual Gaussian diffusion and noising process to generate images.",
        citationCount: 50000
      }
    ]
  },
  {
    id: "life-sciences-crispr-cas9",
    expectedBibcode: "jinek-crispr",
    context: {
      token: "Jinek2012",
      searchMode: "contextual",
      sentenceText: "A programmable dual-RNA-guided Cas9 nuclease enables targeted DNA cleavage.",
      citationPrefixText: "A programmable dual-RNA-guided Cas9 nuclease enables targeted DNA cleavage",
      citationSuffixText: ".",
      contextText: "CRISPR Cas9 uses guide RNA for site-specific genome editing.",
      parsedKeyHint: { surname: "Jinek", year: 2012, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "jinek-unrelated",
        title: "Structural Studies of RNA Processing Complexes",
        authors: ["Jinek, Martin"],
        year: 2012,
        abstract: "Structures of RNA processing proteins.",
        citationCount: 600
      },
      {
        bibcode: "jinek-crispr",
        title: "A Programmable Dual-RNA-Guided DNA Endonuclease in Adaptive Bacterial Immunity",
        authors: ["Jinek, Martin", "Chylinski, Krzysztof", "Doudna, Jennifer"],
        year: 2012,
        abstract: "CRISPR-associated Cas9 uses dual guide RNA to cleave target DNA.",
        citationCount: 30000
      }
    ]
  },
  {
    id: "chemistry-dispersion-correction",
    expectedBibcode: "grimme-d3",
    context: {
      token: "Grimme2010",
      searchMode: "contextual",
      sentenceText: "Long-range dispersion is included with the atom-pairwise D3 correction.",
      citationPrefixText: "Long-range dispersion is included with the atom-pairwise D3 correction",
      citationSuffixText: ".",
      contextText: "Density functional calculations use a D3 dispersion correction.",
      parsedKeyHint: { surname: "Grimme", year: 2010, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "grimme-unrelated",
        title: "Efficient Quantum Chemical Methods for Large Molecules",
        authors: ["Grimme, Stefan"],
        year: 2010,
        abstract: "Approximate quantum chemistry for molecular systems.",
        citationCount: 7000
      },
      {
        bibcode: "grimme-d3",
        title: "A Consistent and Accurate Ab Initio Parametrization of Density Functional Dispersion Correction for the 94 Elements H-Pu",
        authors: ["Grimme, Stefan", "Antony, Jens"],
        year: 2010,
        abstract: "The atom-pairwise D3 method corrects long-range dispersion in density functional theory.",
        citationCount: 40000
      }
    ]
  },
  {
    id: "mathematics-ricci-flow",
    expectedBibcode: "perelman-entropy",
    context: {
      token: "Perelman2002",
      searchMode: "contextual",
      sentenceText: "The entropy functional is monotone under Ricci flow and controls singularity formation.",
      citationPrefixText: "The entropy functional is monotone under Ricci flow and controls singularity formation",
      citationSuffixText: ".",
      contextText: "Ricci flow with surgery is used in the geometrization program.",
      parsedKeyHint: { surname: "Perelman", year: 2002, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "perelman-unrelated",
        title: "Comparison Geometry for Alexandrov Spaces",
        authors: ["Perelman, Grigori"],
        year: 2002,
        abstract: "Curvature bounds in Alexandrov geometry.",
        citationCount: 1500
      },
      {
        bibcode: "perelman-entropy",
        title: "The Entropy Formula for the Ricci Flow and Its Geometric Applications",
        authors: ["Perelman, Grigori"],
        year: 2002,
        abstract: "A monotone entropy for Ricci flow gives control of singularities and geometric applications.",
        citationCount: 20000
      }
    ]
  },
  {
    id: "general-prospect-theory",
    expectedBibcode: "kahneman-prospect",
    context: {
      token: "Kahneman1979",
      searchMode: "contextual",
      sentenceText: "People overweight small probabilities and evaluate gains and losses relative to a reference point.",
      citationPrefixText: "People overweight small probabilities and evaluate gains and losses relative to a reference point",
      citationSuffixText: ".",
      contextText: "Prospect theory describes decision making under risk and loss aversion.",
      parsedKeyHint: { surname: "Kahneman", year: 1979, firstInitial: null, suffix: "" }
    },
    candidates: [
      {
        bibcode: "kahneman-unrelated",
        title: "Judgment under Uncertainty in Organizations",
        authors: ["Kahneman, Daniel"],
        year: 1979,
        abstract: "Organizational judgment and forecasting.",
        citationCount: 1000
      },
      {
        bibcode: "kahneman-prospect",
        title: "Prospect Theory: An Analysis of Decision under Risk",
        authors: ["Kahneman, Daniel", "Tversky, Amos"],
        year: 1979,
        abstract: "Choices under risk depend on reference points, loss aversion, and probability weighting.",
        citationCount: 80000
      }
    ]
  }
];
