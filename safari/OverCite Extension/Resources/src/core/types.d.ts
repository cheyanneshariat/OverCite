export interface CitationContext {
  command: string;
  token: string;
  tokenStart: number;
  tokenEnd: number;
  cursorIndex: number;
  contextText: string;
  sentenceText: string;
  tokens: string[];
  parsedKeyHint: ParsedCitationToken | null;
}

export interface ParsedCitationToken {
  raw: string;
  normalized: string;
  surname: string | null;
  year: number | null;
  suffix: string;
}

export interface AdsCandidate {
  bibcode: string;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string;
  doi: string | null;
  score: number;
  generatedKey: string | null;
}

export interface BibMatch {
  key: string;
  reason: "doi" | "bibcode" | "title";
}

export interface ResolvedInsertion {
  finalKey: string;
  match: BibMatch | null;
  updatedBibText: string;
  rewrittenBibtex: string | null;
}
