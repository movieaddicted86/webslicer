/**
 * The PrusaSlicer value codecs of `shared/src/values.ts` (R-5). These are the cases the browser's
 * and the server's copies each had to agree on, now asserted once against the one implementation:
 * the config a preset carries is parsed for the settings editor and written for the slicer CLI.
 *
 * `shared/src/plater/packing.test.ts` covers `toBool` through `arrangementSpacing`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VECTOR_TYPES,
  decodeVector,
  encodeVector,
  escapeStringCstyle,
  escapeStringsCstyle,
  isVector,
  joinVector,
  parsePoints,
  parseThumbnailSpec,
  resizeVector,
  serializePoints,
  splitVector,
  unescapeStringCstyle,
  unescapeStringsCstyle,
} from './values.js';
import type { OptionDef, OptionType } from './types/index.js';

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

test('splitVector and joinVector are the plain comma form', () => {
  assert.deepEqual(splitVector(''), []);
  assert.deepEqual(splitVector('0.4'), ['0.4']);
  assert.deepEqual(splitVector('0.4, 0.2 '), ['0.4', '0.2']);
  assert.deepEqual(splitVector('1,,2'), ['1', '', '2']);
  assert.equal(joinVector([]), '');
  assert.equal(joinVector(['0.4', '0.2']), '0.4,0.2');
  assert.deepEqual(splitVector(joinVector(['20%', '40%'])), ['20%', '40%']);
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

const def = (type: OptionType, fallback: string, extra: Partial<OptionDef> = {}): OptionDef => ({
  key: 'opt',
  label: 'opt',
  tooltip: '',
  category: 'test',
  type,
  default: fallback,
  presetTypes: ['print'],
  technology: 'any',
  ...extra,
});

test('isVector knows the vector option types', () => {
  for (const t of VECTOR_TYPES) assert.equal(isVector(def(t as OptionType, '')), true, t);
  for (const t of ['string', 'bool', 'int', 'float', 'percent', 'float_or_percent', 'enum', 'point', 'point3'] as OptionType[]) {
    assert.equal(isVector(def(t, '')), false, t);
  }
});

test('decodeVector splits a vector option and falls back to the default', () => {
  assert.deepEqual(decodeVector(def('floats', '0.4'), '0.4, 0.2 '), ['0.4', '0.2']);
  assert.deepEqual(decodeVector(def('ints', '3'), '3'), ['3']);
  assert.deepEqual(decodeVector(def('bools', '1'), '1,0'), ['1', '0']);
  assert.deepEqual(decodeVector(def('percents', '20%'), '20%,40%'), ['20%', '40%']);
  assert.deepEqual(decodeVector(def('points', '0x0'), '0x0,10x10'), ['0x0', '10x10']);
  assert.deepEqual(decodeVector(def('floats', '0.4'), ''), []);
  assert.deepEqual(decodeVector(def('floats', '0.4'), undefined), ['0.4']);
  assert.deepEqual(decodeVector(def('strings', ''), 'a;b'), ['a', 'b']);
  assert.deepEqual(decodeVector(def('strings', ''), '""'), ['']);
  assert.deepEqual(decodeVector(def('strings', ''), '#FF8000;#00FF00'), ['#FF8000', '#00FF00']);
  assert.deepEqual(decodeVector(def('string', ''), 'a\\nb'), ['a\nb']);
  assert.deepEqual(decodeVector(def('bool', '0'), '1'), ['1']);
  assert.deepEqual(decodeVector(def('enum', 'aligned'), 'nearest'), ['nearest']);
});

test('encodeVector writes what decodeVector reads back', () => {
  assert.equal(encodeVector(def('floats', ''), ['0.4', '0.2']), '0.4,0.2');
  assert.equal(encodeVector(def('ints', ''), ['3']), '3');
  assert.equal(encodeVector(def('points', ''), ['0x0', '10x10']), '0x0,10x10');
  assert.equal(encodeVector(def('strings', ''), ['a', 'b']), 'a;b');
  assert.equal(encodeVector(def('strings', ''), ['a b']), '"a b"');
  assert.equal(encodeVector(def('strings', ''), []), '');
  assert.equal(encodeVector(def('floats', ''), []), '');
  assert.equal(encodeVector(def('string', ''), ['a\n']), 'a\\n');
  assert.equal(encodeVector(def('bool', ''), ['1']), '1');
  for (const [type, values] of [
    ['floats', ['0.4', '0.2']],
    ['ints', ['1', '2', '3']],
    ['bools', ['1', '0']],
    ['percents', ['20%', '40%']],
    ['strings', ['#FF8000', 'a b', '']],
    ['string', ['a\nb']],
  ] as Array<[OptionType, string[]]>) {
    assert.deepEqual(decodeVector(def(type, ''), encodeVector(def(type, ''), values)), values, type);
  }
});

test('resizeVector repeats the last value and cuts to the extruder count', () => {
  assert.equal(resizeVector(def('floats', '0.4'), '0.4', 4), '0.4,0.4,0.4,0.4');
  assert.equal(resizeVector(def('floats', '0.4'), '0.4,0.6', 1), '0.4');
  assert.equal(resizeVector(def('floats', '0.4'), '', 2), '0.4,0.4');
  assert.equal(resizeVector(def('bools', '1'), '1,0', 3), '1,0,0');
  assert.equal(resizeVector(def('bools', ''), '', 2), '0,0');
  assert.equal(resizeVector(def('strings', ''), 'a;b', 3), 'a;b;b');
  assert.equal(resizeVector(def('ints', '1'), '2', 1), '2');
});

test('parseThumbnailSpec reads the preset option both sides render and write', () => {
  assert.deepEqual(parseThumbnailSpec('16x16/QOI, 313x173/QOI, 380x285/PNG', 'PNG'), [
    { width: 16, height: 16, format: 'QOI' },
    { width: 313, height: 173, format: 'QOI' },
    { width: 380, height: 285, format: 'PNG' },
  ]);
  assert.deepEqual(parseThumbnailSpec('16x16, 220x124', 'JPG'), [
    { width: 16, height: 16, format: 'JPG' },
    { width: 220, height: 124, format: 'JPG' },
  ]);
  assert.deepEqual(parseThumbnailSpec('', 'PNG'), []);
  assert.deepEqual(parseThumbnailSpec(undefined, undefined), []);
  // no format in the entry → `thumbnails_format`, and PNG when that is unset as well
  assert.deepEqual(parseThumbnailSpec('16x16', ''), [{ width: 16, height: 16, format: 'PNG' }]);
  assert.deepEqual(parseThumbnailSpec('16x16', 'qoi'), [{ width: 16, height: 16, format: 'QOI' }]);
  assert.deepEqual(parseThumbnailSpec(' 16 x 16 / qoi ', 'PNG'), [{ width: 16, height: 16, format: 'QOI' }]);
  assert.deepEqual(parseThumbnailSpec('220x124/JPEG, 16x16/jpg', 'PNG'), [
    { width: 220, height: 124, format: 'JPG' },
    { width: 16, height: 16, format: 'JPG' },
  ]);
  // a format written into the entry wins over `thumbnails_format`, an unknown one reads as PNG
  // rather than as the default; a malformed entry (no `NxN`, no format) is skipped
  assert.deepEqual(parseThumbnailSpec('16x16/foo, 32x32', 'PNG'), [
    { width: 16, height: 16, format: 'PNG' },
    { width: 32, height: 32, format: 'PNG' },
  ]);
  assert.deepEqual(parseThumbnailSpec('16x16/monochrome, garbage', 'QOI'), [{ width: 16, height: 16, format: 'PNG' }]);
  assert.deepEqual(parseThumbnailSpec('16x16/QOI,', 'PNG'), [{ width: 16, height: 16, format: 'QOI' }]);
});
