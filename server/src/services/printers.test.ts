import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-printers-'));
const { config } = await import('../config.js');
const { listPrinters, upsertPrinter, deletePrinter, getPrinter } = await import('../services/printers.js');

const host = (name: string) => ({ name, host: `${name}.example`, type: 'octoprint' as const });
const names = async () => (await listPrinters()).map((p) => p.name).sort();

test('a printer is stored, found and removed', async () => {
  const p = await upsertPrinter(host('alpha'));
  assert.equal(p.host, 'http://alpha.example');
  assert.equal((await getPrinter(p.id))?.name, 'alpha');
  assert.equal(await deletePrinter(p.id), true);
  assert.equal(await getPrinter(p.id), undefined);
  assert.equal(await deletePrinter(p.id), false, 'removing it twice reports no removal');
});

test('concurrent changes do not lose a printer', async () => {
  // The store used to be synchronous, so its read-modify-write could not interleave. It is awaited
  // now (N-7), which is exactly what would let two upserts read the same list and write back only
  // their own addition – the chain in `printers.ts` keeps that from happening.
  await Promise.all([upsertPrinter(host('beta')), upsertPrinter(host('gamma')), upsertPrinter(host('delta'))]);
  assert.deepEqual(await names(), ['beta', 'delta', 'gamma'], 'all three concurrent adds landed');

  const gamma = (await listPrinters()).find((p) => p.name === 'gamma');
  assert.ok(gamma, 'gamma is in the store');
  await Promise.all([upsertPrinter({ ...gamma, name: 'gamma-2' }), deletePrinter(gamma.id)]);
  assert.deepEqual(await names(), ['beta', 'delta'], 'the deletion survived the update racing it');

  fs.rmSync(config.dataDir, { recursive: true, force: true });
});
