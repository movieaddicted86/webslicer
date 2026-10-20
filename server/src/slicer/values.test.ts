/**
 * The PrusaSlicer value codecs, pinned before R-5 merges the browser's and the server's copies into
 * `shared`: both sides write and read the same INI/preset strings, so the round trip, the vector
 * separators and the `bed_shape` point list are a contract, not an implementation detail.
 *
 * The corpus was run against the browser copy too (`web/src/values.ts`) before the move – the two
 * agreed on every input (see `.ai/reports/T-015.md`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeStringCstyle, escapeStringsCstyle, parsePoints, serializePoints, unescapeStringCstyle, unescapeStringsCstyle } from './values.js';

const STRINGS = [
  '',
  'plain',
  ' ',
  'a b',
  'üñî',
  ';',
  '"',
  '\\',
  '\r',
  '\n',
  '\t',
  'a;b',
  'a"b',
  'a\\b',
  'a\rb',
  'a\nb',
  'a\\"b',
  'x\\',
  'M900 K0.2 ; LA\n',
];

const VECTORS: string[][] = [
  [],
  [''],
  ['', ''],
  ['a'],
  ['a', 'b'],
  ['', 'a'],
  ['a', ''],
  [';'],
  ['"'],
  ['\\'],
  [' ', '  '],
  ['\t'],
  ['a\n', 'b\r'],
  ['"quoted"'],
  ['a', ';', 'b'],
  ['M900 K0.2 ; LA\n', 'plain', '', 'has "quote"'],
];

test('escapeStringCstyle round trips through unescapeStringCstyle', () => {
  for (const s of STRINGS) assert.equal(unescapeStringCstyle(escapeStringCstyle(s)), s, JSON.stringify(s));
  assert.equal(escapeStringCstyle('a"b\n'), 'a\\"b\\n');
  assert.equal(escapeStringCstyle('c:\\temp\r'), 'c:\\\\temp\\r');
});

test('escapeStringsCstyle quotes what has to be quoted', () => {
  assert.equal(escapeStringsCstyle([]), '');
  assert.equal(escapeStringsCstyle(['']), '""');
  assert.equal(escapeStringsCstyle(['a', 'b']), 'a;b');
  assert.equal(escapeStringsCstyle(['a b']), '"a b"');
  assert.equal(escapeStringsCstyle(['a;b']), '"a;b"');
  assert.equal(escapeStringsCstyle(['a\nb']), '"a\\nb"');
});

test('escapeStringsCstyle round trips through unescapeStringsCstyle', () => {
  for (const v of VECTORS) assert.deepEqual(unescapeStringsCstyle(escapeStringsCstyle(v)), v, JSON.stringify(v));
});

test('unescapeStringsCstyle reads the separators and the quoting', () => {
  assert.deepEqual(unescapeStringsCstyle(''), []);
  assert.deepEqual(unescapeStringsCstyle('a'), ['a']);
  assert.deepEqual(unescapeStringsCstyle('a;b'), ['a', 'b']);
  assert.deepEqual(unescapeStringsCstyle('a;'), ['a', '']);
  assert.deepEqual(unescapeStringsCstyle(';a'), ['', 'a']);
  assert.deepEqual(unescapeStringsCstyle('a;;b'), ['a', '', 'b']);
  assert.deepEqual(unescapeStringsCstyle('""'), ['']);
  assert.deepEqual(unescapeStringsCstyle('"a;b";c'), ['a;b', 'c']);
  assert.deepEqual(unescapeStringsCstyle('#FF8000;#00FF00'), ['#FF8000', '#00FF00']);
  // an unterminated quote keeps what it read; a quote inside a plain value is not a delimiter
  assert.deepEqual(unescapeStringsCstyle('"a'), ['a']);
  assert.deepEqual(unescapeStringsCstyle('a"b'), ['a"b']);
});

test('parsePoints reads the bed polygon and survives broken input', () => {
  assert.deepEqual(parsePoints(''), []);
  assert.deepEqual(parsePoints('0x0,200x0,200x200,0x200'), [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
  ]);
  assert.deepEqual(parsePoints(' 0x0 , 10x10 '), [
    [0, 0],
    [10, 10],
  ]);
  assert.deepEqual(parsePoints('1.5x-2.5'), [[1.5, -2.5]]);
  assert.deepEqual(parsePoints('0x0,,10x10'), [
    [0, 0],
    [10, 10],
  ]);
  assert.deepEqual(parsePoints(' , '), []);
  // broken input falls back to 0 instead of throwing – a preset with a typo must not take the app down
  assert.deepEqual(parsePoints('garbage'), [[0, 0]]);
  assert.deepEqual(parsePoints('1x'), [[1, 0]]);
  assert.deepEqual(parsePoints('x2'), [[0, 2]]);
  assert.deepEqual(parsePoints('axb'), [[0, 0]]);
  assert.deepEqual(parsePoints('1x2x3'), [[1, 2]]);
  assert.deepEqual(parsePoints('1X2'), [[0, 0]]); // PrusaSlicer spells the separator lower case
  assert.deepEqual(parsePoints('NaNx1'), [[0, 1]]);
  assert.deepEqual(parsePoints('0x0,;10x10'), [
    [0, 0],
    [0, 10],
  ]);
});

test('serializePoints writes what parsePoints reads back', () => {
  assert.equal(serializePoints([]), '');
  assert.equal(serializePoints([[1, 2]]), '1x2');
  assert.equal(
    serializePoints([
      [0, 0],
      [10, 10],
    ]),
    '0x0,10x10',
  );
  assert.equal(serializePoints([[1.5, -2.5]]), '1.5x-2.5');
  const bed: Array<[number, number]> = [
    [0, 0],
    [250, 0],
    [250, 210],
    [0, 210],
  ];
  assert.deepEqual(parsePoints(serializePoints(bed)), bed);
});
