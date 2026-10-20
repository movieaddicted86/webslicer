/**
 * The vector helpers of the settings UI, pinned before R-5 moves them into `shared` with the codecs
 * they are built on. Every option field goes through them, and a per-extruder value that resizes
 * wrongly ends up in the sliced G-code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VECTOR_TYPES, decodeVector, encodeVector, isVector, resizeVector } from './values.js';
import type { OptionDef, OptionType } from './api';

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
