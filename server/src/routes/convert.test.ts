/**
 * T-009: `POST /api/convert/step`.
 *
 * The slicer binary is a tiny Node script (like `jobs.cancel.test.ts` does): it writes an STL for a
 * good file and fails with the CLI's log style for a file whose content starts with `BROKEN`. So the
 * test drives the real route, the real upload stream and the real temp handling without PrusaSlicer.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-convert-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
process.env.MAX_UPLOAD_BYTES = String(64 * 1024);

/** The converted model: a two-triangle binary STL. */
const OUT = `${path.join(DATA_DIR, 'converted.js')}`;
const CONVERTED = path.join(DATA_DIR, 'converted.stl');
fs.writeFileSync(
  CONVERTED,
  (() => {
    const buf = Buffer.alloc(84 + 2 * 50);
    buf.write('converted', 0, 'latin1');
    buf.writeUInt32LE(2, 80);
    return buf;
  })(),
);

/** The fake slicer: `--output <file> <input>`; refuses an input that starts with `BROKEN`. */
fs.writeFileSync(
  `${OUT}.cmd.js`,
  `const fs = require('fs');\n` +
    `const args = process.argv.slice(2);\n` +
    `const input = args[args.length - 1];\n` +
    `const out = args[args.indexOf('--output') + 1];\n` +
    `if (fs.readFileSync(input, 'utf8').startsWith('BROKEN')) {\n` +
    `  process.stderr.write('\\u001b[31;1m**** ERR StepFile : Undefined Parsing: Line 6: Incorrect syntax ****\\u001b[0m\\n');\n` +
    `  process.exit(1);\n` +
    `}\n` +
    `fs.writeFileSync(out, fs.readFileSync(${JSON.stringify(CONVERTED)}));\n`,
);
const FAKE = path.join(DATA_DIR, 'fake-slicer.js');
fs.renameSync(`${OUT}.cmd.js`, FAKE);
if (process.platform === 'win32') {
  const WRAPPER = path.join(DATA_DIR, 'fake-slicer.cmd');
  fs.writeFileSync(WRAPPER, `@node "${FAKE}" %*\r\n`);
  process.env.PRUSASLICER_BIN = WRAPPER;
} else {
  fs.writeFileSync(FAKE, `#!${process.execPath}\n${fs.readFileSync(FAKE, 'utf8')}`);
  fs.chmodSync(FAKE, 0o755);
  process.env.PRUSASLICER_BIN = FAKE;
}

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

async function call(method: string, url: string, body?: Buffer, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${url}`, { method, headers, body: body && new Uint8Array(body) });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes, json: () => JSON.parse(bytes.toString()) as Record<string, string> };
}

/** Temp directories of the conversion, empty when everything was cleaned up. */
function leftovers(): string[] {
  try {
    return fs.readdirSync(path.join(config.cacheDir, 'step'));
  } catch {
    return [];
  }
}

before(async () => {
  ensureDirs();
  setActiveSchema(SCHEMA);
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

test('a STEP upload is answered with the converted binary STL', async () => {
  const res = await call('POST', '/api/convert/step', Buffer.from('ISO-10303-21; CARTESIAN_POINT'), {
    'X-Filename': encodeURIComponent('cube.step'),
  });
  assert.equal(res.status, 200, res.bytes.toString());
  assert.deepEqual(res.bytes, fs.readFileSync(CONVERTED));
  assert.deepEqual(leftovers(), [], 'the temp directory was removed');
});

test('a broken STEP is a 400 with the CLI log line and leaves no temp file', async () => {
  const res = await call('POST', '/api/convert/step', Buffer.from('BROKEN ISO-10303-21;'), {
    'X-Filename': encodeURIComponent('broken.stp'),
  });
  assert.equal(res.status, 400);
  assert.match(res.json().error, /Undefined Parsing/);
  assert.deepEqual(leftovers(), []);
});

test('a name that is not .step/.stp is refused before the body is read', async () => {
  const res = await call('POST', '/api/convert/step', Buffer.from('x'), { 'X-Filename': encodeURIComponent('cube.stl') });
  assert.equal(res.status, 400);
  assert.match(res.json().error, /not a STEP file/);
});

test('an empty body is a 400 and a body over the limit a 413 – neither leaves anything behind', async () => {
  const empty = await call('POST', '/api/convert/step', undefined, { 'X-Filename': encodeURIComponent('cube.step') });
  assert.equal(empty.status, 400);
  const big = await call('POST', '/api/convert/step', Buffer.alloc(config.maxUploadBytes + 1024, 65), {
    'X-Filename': encodeURIComponent('big.step'),
  });
  assert.equal(big.status, 413);
  assert.deepEqual(leftovers(), []);
});
