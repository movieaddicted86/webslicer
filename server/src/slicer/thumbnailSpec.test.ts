/**
 * The `thumbnails` option parser, pinned before R-5 merges the browser's and the server's copies:
 * the browser renders exactly the thumbnails the preset asks for and the server writes them into
 * the G-code, so the two must read the option the same way.
 *
 * The cases run against both copies – the server's own module and `web/src/three/thumbnail.ts` –
 * while the two exist. The move into `@webslicer/shared` replaces the pairing with identity checks
 * against the shared function, which fail the moment either side grows a copy of its own again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseThumbnailSpec } from './thumbnails.js';
import { parseThumbnailSpec as webSpec } from '../../../web/src/three/thumbnail.js';

const CASES: Array<[string | undefined, string | undefined]> = [
  ['16x16/QOI, 313x173/QOI, 380x285/PNG', 'PNG'],
  ['16x16, 220x124', 'JPG'],
  ['', 'PNG'],
  [undefined, 'PNG'],
  [undefined, undefined],
  ['16x16', undefined],
  ['16x16', ''],
  ['16X16', 'png'],
  ['16 x 16 / qoi ', 'PNG'],
  ['16x16/foo', 'PNG'],
  ['garbage', 'QOI'],
  ['16x16/QOI,', 'PNG'],
  ['0x0', 'PNG'],
  ['016x016', 'PNG'],
  ['  ', 'PNG'],
];

test('the browser and the server parse the thumbnails option the same way', () => {
  for (const [spec, format] of CASES) {
    assert.deepEqual(parseThumbnailSpec(spec, format), webSpec(spec, format), `${JSON.stringify(spec)}, ${JSON.stringify(format)}`);
  }
});

test('parseThumbnailSpec', () => {
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
  // the format falls back to `thumbnails_format`, and only PNG/JPG/QOI are known
  assert.deepEqual(parseThumbnailSpec('16x16', 'QOI'), [{ width: 16, height: 16, format: 'QOI' }]);
  assert.deepEqual(parseThumbnailSpec('220x124/JPEG, 16x16/jpg', 'PNG'), [
    { width: 220, height: 124, format: 'JPG' },
    { width: 16, height: 16, format: 'JPG' },
  ]);
  // a format written into the entry wins over `thumbnails_format`, and an unknown one reads as PNG
  // rather than as the default; a malformed entry (no `NxN`, no format) is skipped
  assert.deepEqual(parseThumbnailSpec('16x16/foo, 32x32', 'PNG'), [
    { width: 16, height: 16, format: 'PNG' },
    { width: 32, height: 32, format: 'PNG' },
  ]);
  assert.deepEqual(parseThumbnailSpec('16x16/monochrome, garbage', 'QOI'), [{ width: 16, height: 16, format: 'PNG' }]);
});
