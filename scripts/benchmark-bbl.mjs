// Benchmark-only bibliography decoding. Never infer a title from the citation
// key, a journal name, or the context being evaluated (that would leak answers).
export function parseBenchmarkBbl(text) {
  const header = /\\bibitem\b\s*(?:\[([\s\S]*?)\])?\s*\{([^{}]+)\}/g;
  const matches = [...text.matchAll(header)];
  return matches.map((match, index) => {
    const segment = text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length)
      .split('\\end{thebibliography}')[0];
    const structured = field(segment, 'title');
    const quoted = segment.match(/``([\s\S]*?)''/);
    const blocks = segment.split(/\\newblock\s*/);
    const emphasized = argument(segment, /\\emph\s*\{/g);
    const lines = blocks[0].split(/\\\\/).map(cleanBenchmarkLatex).filter(Boolean);
    let rawTitle = '', style = 'missing-explicit-title', authorPrefix = '';
    if (structured) {
      rawTitle = structured.value; style = 'bibinfo';
      authorPrefix = segment.slice(0, structured.start);
    } else if (quoted) {
      rawTitle = quoted[1]; style = 'quoted'; authorPrefix = segment.slice(0, quoted.index);
    } else if (lines.length >= 2 && blocks.length > 1) {
      rawTitle = lines.slice(1).join(' '); style = 'linebreak'; authorPrefix = lines[0];
    } else if (blocks.length > 1) {
      rawTitle = blocks[1]; style = 'newblock'; authorPrefix = blocks[0];
    } else if (emphasized && !/\\bibinfo\s*\{/.test(segment)) {
      rawTitle = emphasized.value; style = 'emphasized'; authorPrefix = segment.slice(0, emphasized.start);
    }
    const family = argument(segment, /\\bibnamefont\s*\{/g)?.value;
    const author = family ? `${cleanBenchmarkLatex(family)},` : firstAuthor(authorPrefix || segment);
    const withoutUrls = segment.replace(/https?:\S+/g, '');
    const year = field(segment, 'year')?.value || (match[1] || '').match(/\b(?:18|19|20)\d{2}\b/)?.[0] || withoutUrls.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || '';
    return { type: 'article', key: match[2].trim(), fields: { title: cleanBenchmarkLatex(rawTitle).replace(/[,.;]\s*$/, ''), author, year }, benchmarkStyle: style };
  });
}

function field(text, name) {
  return argument(text, new RegExp('\\\\bibinfo\\s*\\{' + name + '\\}\\s*\\{', 'g'));
}

function argument(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return null;
  const start = pattern.lastIndex;
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return { value: text.slice(start, index), start: match.index };
  }
  return null;
}

function firstAuthor(text) {
  const raw = cleanBenchmarkLatex(text).split(/\s+and\s+|,\s*|\s+et\s+al\b/)[0].trim();
  return raw ? `${raw.replace(/[.,]\s*$/, '').split(/\s+/).at(-1)},` : '';
}

export function cleanBenchmarkLatex(value) {
  return String(value ?? '')
    .replace(/\\BIBforeignlanguage\s*\{[^{}]*\}/g, '')
    .replace(/\\['"`^~=.]\s*\{?([A-Za-z])\}?/g, '$1')
    .replace(/\\[A-Za-z]+\*?/g, ' ')
    .replace(/\\[ ,;!]/g, ' ')
    .replace(/[{}$]/g, '').replace(/~/g, ' ').replace(/\s+/g, ' ').trim();
}
// BibTeX permits whitespace (including line breaks) around author separators.
// Keep braced organizational names intact.
export function splitBenchmarkAuthors(value) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  const authors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\") { index += 1; continue; }
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    if (depth === 0 && text.slice(index, index + 5).toLowerCase() === " and ") {
      authors.push(text.slice(start, index));
      start = index + 5;
      index += 4;
    }
  }
  authors.push(text.slice(start));
  return authors.map(author => author.trim()).filter(Boolean);
}
