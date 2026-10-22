/**
 * S7: uploads stream to disk with the limit enforced *while* streaming.
 *
 * `express.raw` buffered the whole body into memory first, so the limit only ever protected after the
 * RAM was already spent. These tests pin the new contract: a body within the limit arrives byte for
 * byte, a body over it is answered **413** (the status `express.raw` used to give) and leaves no file.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-uploads-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
// a small limit keeps the test from allocating half a gigabyte for the oversize case
process.env.MAX_UPLOAD_BYTES = String(64 * 1024);

const { ensureDirs, config } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setActiveSchema } = await import('../services/schema.js');

let server: Server;
let base = '';

const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {},
} as never;

/** A binary STL of `n` triangles as a Buffer (the fixtures' `cube` is a different shape). */
function cubeStl(n = 12): Buffer {
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('test', 0, 'latin1');
  buf.writeUInt32LE(n, 80);
  let o = 84;
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 3; v++) {
      const x = v === 1 ? 10 : 0;
      const y = v === 2 ? 10 : 0;
      buf.writeFloatLE(x, o + 12 + v * 12);
      buf.writeFloatLE(y, o + 16 + v * 12);
      buf.writeFloatLE(0, o + 20 + v * 12);
    }
    o += 50;
  }
  return buf;
}

async function call(
  method: string,
  url: string,
  body?: Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${url}`, { method, headers, body });
  return { status: res.status, text: await res.text() };
}

before(async () => {
  ensureDirs();
  setActiveSchema(() => SCHEMA);
  const app: express.Express = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('POST /api/models stores a streamed STL and reports its triangle count', async () => {
  const stl = cubeStl(12);
  const res = await call('POST', '/api/models', stl, { 'X-Filename': 'cube.stl' });
  assert.equal(res.status, 200, res.text);
  const json = JSON.parse(res.text) as { id: string; triangles: number };
  assert.equal(json.triangles, 12);
  // the file really landed on disk with the same bytes
  const stored = fs.readFileSync(path.join(config.modelsDir, `${json.id}.stl`));
  assert.deepEqual(stored, stl);
});

test('POST /api/models answers 413 for a body over the limit and leaves nothing behind', async () => {
  const before = fs.readdirSync(config.modelsDir).filter((f) => f.endsWith('.stl')).length;
  const big = Buffer.alloc(config.maxUploadBytes + 1024, 0);
  const res = await call('POST', '/api/models', big, { 'X-Filename': 'big.stl' });
  assert.equal(res.status, 413, res.text);
  assert.match(JSON.parse(res.text).error, /too large/i);
  // no model file and no temp file from the aborted upload
  const files = fs.readdirSync(config.modelsDir);
  assert.equal(files.filter((f) => f.endsWith('.stl')).length, before, 'the aborted upload stored no model');
  assert.deepEqual(
    files.filter((f) => f.startsWith('.upload-')),
    [],
    'the temp file of the aborted upload was removed',
  );
});

test('PUT /api/library/file streams a file into the library and reports its size', async () => {
  const body = Buffer.from('hello library\n'.repeat(100));
  const res = await call('PUT', `/api/library/file?path=sub%2Fnote.txt`, body);
  assert.equal(res.status, 200, res.text);
  const json = JSON.parse(res.text) as { path: string; size: number };
  assert.equal(json.path, 'sub/note.txt');
  assert.equal(json.size, body.length);
  assert.deepEqual(fs.readFileSync(path.join(config.libraryDir, 'sub', 'note.txt')), body);
  // no temp file is left next to the target
  assert.deepEqual(
    fs.readdirSync(path.join(config.libraryDir, 'sub')).filter((f) => f.includes('.upload-')),
    [],
  );
});

test('PUT /api/library/file answers 413 over the limit and writes no file', async () => {
  const big = Buffer.alloc(config.maxUploadBytes + 1024, 65);
  const res = await call('PUT', '/api/library/file?path=big.bin', big);
  assert.equal(res.status, 413, res.text);
  assert.equal(fs.existsSync(path.join(config.libraryDir, 'big.bin')), false);
});

test('PUT /api/library/file still refuses an escaping path before reading the body', async () => {
  const res = await call('PUT', '/api/library/file?path=..%2Fescape.bin', Buffer.from('x'));
  assert.equal(res.status, 400);
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'escape.bin')), false);
});

test('an aborted upload leaves no temp file either', async () => {
  const url = new URL(`${base}/api/library/file?path=aborted.bin`);
  await new Promise<void>((resolve) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'PUT', headers: { 'content-length': '1000000' } },
      () => resolve(),
    );
    req.on('error', () => resolve());
    req.write(Buffer.alloc(1024, 1));
    // hang up mid-body
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 50);
  });
  await new Promise((r) => setTimeout(r, 100));
  const leftovers = fs.readdirSync(config.libraryDir).filter((f) => f.includes('.upload-'));
  assert.deepEqual(leftovers, [], 'the partial temp file is removed');
});
