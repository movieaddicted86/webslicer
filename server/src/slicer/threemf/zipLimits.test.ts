/**
 * S7: the ZIP limits of an untrusted 3MF. A tiny archive can declare (and inflate to) gigabytes, so
 * the readers check the central directory before they decompress anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { assertZipReasonable, MAX_3MF_BYTES, MAX_3MF_ENTRIES, readZipEntryText } from './zipLimits.js';

/** An archive with `n` small entries, built lazily enough for 10 001 files. */
async function manyEntries(n: number): Promise<JSZip> {
  const zip = new JSZip();
  for (let i = 0; i < n; i++) zip.file(`f${i}.txt`, 'x');
  return JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
}

test('a normal 3MF passes the limits', async () => {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', '<model/>');
  zip.file('Metadata/Slic3r_PE.config', '; layer_height = 0.2\n');
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.doesNotThrow(() => assertZipReasonable(loaded));
  assert.equal(await readZipEntryText(loaded, 'Metadata/Slic3r_PE.config'), '; layer_height = 0.2\n');
});

test('an archive with too many entries is refused', async () => {
  const loaded = await manyEntries(MAX_3MF_ENTRIES + 1);
  assert.throws(() => assertZipReasonable(loaded), /too many entries/);
});

test('an archive that declares more uncompressed bytes than the budget is refused', async () => {
  const zip = new JSZip();
  // 1 MiB of zeros compresses to a few hundred bytes, but the directory announces the real size;
  // shrinking the budget is not possible (it is a constant), so the test lies in the directory
  zip.file('3D/3dmodel.model', 'x'.repeat(1024 * 1024));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  for (const entry of Object.values(loaded.files) as Array<{ _data: { uncompressedSize: number } }>) {
    entry._data.uncompressedSize = MAX_3MF_BYTES + 1;
  }
  assert.throws(() => assertZipReasonable(loaded), /too large uncompressed/);
  // and the single-entry read refuses the same lying entry
  await assert.rejects(() => readZipEntryText(loaded, '3D/3dmodel.model'), /too large uncompressed/);
});

test('a missing entry reads as empty text', async () => {
  const zip = await JSZip.loadAsync(await new JSZip().generateAsync({ type: 'nodebuffer' }));
  assert.equal(await readZipEntryText(zip, 'nope'), '');
});

test('the limits are decided by the central directory, without inflating anything', async () => {
  // 4 MiB of zeros: a few KiB on the wire, 4 MiB declared. The check reads the directory only, so
  // an oversized archive is refused before a single entry is decompressed.
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', new Uint8Array(4 * 1024 * 1024));
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  let inflations = 0;
  for (const entry of Object.values(loaded.files) as Array<{ async: (...a: unknown[]) => Promise<unknown> }>) {
    const realAsync = entry.async.bind(entry);
    entry.async = (...args: unknown[]) => {
      inflations++;
      return realAsync(...args);
    };
  }
  // within budget: the directory passes and nothing was inflated
  assert.doesNotThrow(() => assertZipReasonable(loaded));
  assert.equal(inflations, 0, 'assertZipReasonable must not decompress an entry');

  // over budget: still no decompression, and the archive is refused
  for (const entry of Object.values(loaded.files) as Array<{ _data: { uncompressedSize: number } }>) {
    entry._data.uncompressedSize = MAX_3MF_BYTES + 1;
  }
  assert.throws(() => assertZipReasonable(loaded), /too large uncompressed/);
  assert.equal(inflations, 0, 'the refusal happens on the directory alone');
});
