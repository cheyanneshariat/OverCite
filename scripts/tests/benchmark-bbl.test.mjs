import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBenchmarkBbl, splitBenchmarkAuthors } from '../benchmark-bbl.mjs';

test('benchmark splits multiline authors and preserves organizational names', () => {
  assert.deepEqual(splitBenchmarkAuthors('Xing Tang and\n  Ling Chen and\r\n Hongyu Shi'), ['Xing Tang', 'Ling Chen', 'Hongyu Shi']);
  assert.deepEqual(splitBenchmarkAuthors('{Research and Development Group} and A. Example'), ['{Research and Development Group}', 'A. Example']);
  assert.deepEqual(splitBenchmarkAuthors('A. Example\tand\tB. Other'), ['A. Example', 'B. Other']);
});

test('benchmark decodes APS, IEEE and alphabetical-label bibliographies without using keys as metadata', () => {
  const text = String.raw`\bibitem [{\citenamefont{Someone}(2020)}]{opaque1}
    \bibinfo{author}{\bibfnamefont{A.}\bibnamefont{Someone}}
    \bibinfo {title} {{Quantum {Memory}}} \bibinfo {year} {2020}
    \bibitem{opaque2} J.~Example and S.~Other, \x ${String.fromCharCode(96, 96)}Nested {RNA} structures,'' \emph{Journal}, 2019.
    \bibitem[BCP97]{opaque3} W.~Bosma, J.~Cannon, \emph{The {M}agma algebra system}, 1997.
    \bibitem{misleading_title_2024} \bibnamefont{Author}\bibinfo{journal}{Not the title}\bibinfo{year}{2018}
    \end{thebibliography}`;
  const entries = parseBenchmarkBbl(text);
  assert.deepEqual(entries.map(e => e.fields.title), ['Quantum Memory', 'Nested RNA structures', 'The Magma algebra system', '']);
  assert.deepEqual(entries.map(e => e.fields.author), ['Someone,', 'Example,', 'Bosma,', 'Author,']);
  assert.deepEqual(entries.map(e => e.fields.year), ['2020','2019','1997','2018']);
});

test('benchmark preserves missing titles rather than inventing ground truth', () => {
  const [entry] = parseBenchmarkBbl(String.raw`\bibitem{Smith2024} \bibinfo{author}{\bibnamefont{Smith}}, \bibinfo{journal}{Nature} (\bibinfo{year}{2024}).`);
  assert.equal(entry.fields.title, '');
  assert.equal(entry.benchmarkStyle, 'missing-explicit-title');
});
