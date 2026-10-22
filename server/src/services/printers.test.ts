import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

// the test host runs without a PrusaSlicer; never let a real LAN address be contacted
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-printers-'));

const { config } = await import('../config.js');
const { listPrinters, upsertPrinter, deletePrinter, getPrinter, testPrinter, uploadToPrinter, uploadTimeoutMs, PRINTER_TEST_TIMEOUT_MS } =
  await import('./printers.js');

/** Upload fixtures live outside `config.dataDir`: an earlier test removes that directory. */
const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-printers-files-'));

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

// ---------------------------------------------------------------------------
// S3: printer test / upload
// ---------------------------------------------------------------------------

/** A server that never answers, so the client's own AbortController has to end the call. */
function silentServer(): Promise<{ server: import('node:http').Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {
      /* keep the request open: no headers, no body */
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no port'));
      resolve({
        server,
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A host that answers with a status and a body the client must not see. */
function answeringServer(status: number, body: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(body);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no port'));
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

const printerAt = (port: number, type: 'octoprint' | 'moonraker' | 'prusalink' = 'octoprint') => ({
  id: 'tmp',
  name: 'tmp',
  type,
  host: `http://127.0.0.1:${port}`,
});

test('S3: a printer test times out after 5 s by default and reports only that', async () => {
  const silent = await silentServer();
  try {
    const started = Date.now();
    const result = await testPrinter(printerAt(silent.port), 300);
    assert.equal(result.ok, false);
    assert.match(result.message, /did not answer within/);
    assert.ok(Date.now() - started < 5_000);
  } finally {
    await silent.close();
  }
  assert.equal(PRINTER_TEST_TIMEOUT_MS, 5_000);
});

test('S3: a failed printer test names the status, never the remote body', async () => {
  const host = await answeringServer(500, 'internal error at http://192.168.1.99:5000 secret-path');
  try {
    const result = await testPrinter(printerAt(host.port), 2_000);
    assert.equal(result.ok, false);
    assert.equal(result.message, 'Connection failed: HTTP 500');
    assert.ok(!result.message.includes('192.168.1.99'), 'no host detail in the message');
    assert.ok(!result.message.includes('secret-path'), 'no body in the message');
  } finally {
    await host.close();
  }
});

test('S3: an unreachable host reports a generic failure without the DNS text', async () => {
  const result = await testPrinter(printerAt(1), 2_000);
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Connection test failed');
});

test('S3: the upload budget grows with the file size and is capped at 10 minutes', () => {
  assert.equal(uploadTimeoutMs(0), 60_000);
  assert.equal(uploadTimeoutMs(50_000), 61_000);
  assert.equal(uploadTimeoutMs(10 * 1024 * 1024), 60_000 + 210 * 1_000);
  assert.equal(uploadTimeoutMs(100 * 1024 * 1024), 600_000, 'hard maximum');
  assert.equal(uploadTimeoutMs(Number.NaN), 60_000);
});

test('S3: a hanging upload ends with a timeout message and no reflected body', async () => {
  const silent = await silentServer();
  const file = path.join(FIXTURES, 'cube.gcode');
  fs.writeFileSync(file, 'G28\n');
  try {
    const started = Date.now();
    const result = await uploadToPrinter(printerAt(silent.port), file, 'cube.gcode', false, 300);
    assert.equal(result.ok, false);
    assert.match(result.message, /Upload failed: octoprint did not answer within/);
    assert.ok(Date.now() - started < 3_000);
  } finally {
    await silent.close();
    fs.rmSync(file, { force: true });
  }
});

test('S3: a rejected upload names the status only', async () => {
  const host = await answeringServer(507, 'disk full on /dev/sda1 at printer.local');
  const file = path.join(FIXTURES, 'cube2.gcode');
  fs.writeFileSync(file, 'G28\n');
  try {
    const result = await uploadToPrinter(printerAt(host.port), file, 'cube2.gcode', false, 2_000);
    assert.equal(result.ok, false);
    assert.equal(result.message, 'OctoPrint upload failed: HTTP 507');
  } finally {
    await host.close();
    fs.rmSync(file, { force: true });
  }
});
