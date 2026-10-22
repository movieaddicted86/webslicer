import assert from 'node:assert/strict';
import test from 'node:test';
import { fmt, fmtFeatureTime, fmtLayerTime, fmtMegabytes, fmtSize, fmtTime, fmtZ } from './format';

test('fmt trims to the given decimals and drops trailing zeros', () => {
  assert.equal(fmt(1.5), '1.5');
  assert.equal(fmt(2), '2');
  assert.equal(fmt(0), '0');
  assert.equal(fmt(-3.14159), '-3.14');
  assert.equal(fmt(12.345, 1), '12.3');
  assert.equal(fmt(10, 1), '10');
  assert.equal(fmt(Number.NaN), '0');
  assert.equal(fmt(Number.POSITIVE_INFINITY), '0');
});

test('fmtZ keeps two decimals', () => {
  assert.equal(fmtZ(0.2), '0.20');
  assert.equal(fmtZ(12.345), '12.35');
});

test('fmtSize keeps the library dialog strings', () => {
  assert.equal(fmtSize(undefined), '');
  assert.equal(fmtSize(0), '0 B');
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(1024), '1.0 KB');
  assert.equal(fmtSize(2048), '2.0 KB');
  assert.equal(fmtSize(1048576), '1.0 MB');
  assert.equal(fmtSize(1_500_000), '1.4 MB');
});

test('fmtMegabytes keeps the sliced-info string', () => {
  assert.equal(fmtMegabytes(1048576), '1.0 MB');
  assert.equal(fmtMegabytes(169427), '0.2 MB');
});

test('fmtLayerTime keeps the range legend strings', () => {
  assert.equal(fmtLayerTime(8.4), '8.4 s');
  assert.equal(fmtLayerTime(59.9), '59.9 s');
  assert.equal(fmtLayerTime(60), '1m 00s');
  assert.equal(fmtLayerTime(62), '1m 02s');
  assert.equal(fmtLayerTime(125), '2m 05s');
});

test('fmtFeatureTime keeps PrusaSlicer feature legend strings', () => {
  assert.equal(fmtFeatureTime(8.4), '8.4s');
  assert.equal(fmtFeatureTime(59.9), '59.9s');
  assert.equal(fmtFeatureTime(60), '1m 00s');
  assert.equal(fmtFeatureTime(190), '3m 10s');
  assert.equal(fmtFeatureTime(3600), '1h 00m');
  assert.equal(fmtFeatureTime(3720), '1h 02m');
  assert.equal(fmtFeatureTime(86399), '23h 59m');
});

test('fmtTime keeps the sliced-info strings', () => {
  assert.equal(fmtTime(undefined), '–');
  assert.equal(fmtTime(0), '–');
  assert.equal(fmtTime(45), '45s');
  assert.equal(fmtTime(190), '3m 10s');
  assert.equal(fmtTime(3723), '1h 2m 3s');
});
