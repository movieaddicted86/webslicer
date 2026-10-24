/**
 * The preset transfer endpoints: rename, bundle download/upload and reading a preset set out of a
 * G-code file's config block.
 *
 * The tests go through HTTP because the contract lives there: the status codes (200/400/404), the
 * JSON shapes the UI reads, the upload path (a real request body, not a mocked file) and the
 * `attachment` header of the export. The service behaviour itself is unit-tested in
 * `services/presetTransfer.test.ts`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-preset-routes-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
delete process.env.PRUSASLICER_PROFILES;
delete process.env.PRUSASLICER_RESOURCES;

const { config, ensureDirs } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setActiveSchema } = await import('../services/schema.js');
const { saveUserPreset, userPresetExists } = await import('../slicer/presets.js');

const FIXTURES = path.join(import.meta.dirname, '..', 'slicer', 'fixtures');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'schema.json'), 'utf8')) as never;

let server: Server;
let base = '';

interface Res {
  status: number;
  text: string;
  json: unknown;
  headers: Headers;
}

async function call(method: string, url: string, body?: object, headers: Record<string, string> = {}): Promise<Res> {
  const isJson = body !== undefined && !(body instanceof Uint8Array);
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...headers },
    body: isJson ? JSON.stringify(body) : (body as never),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json, headers: res.headers };
}

/** A G-code upload: the bytes, as the dialog sends them. */
const upload = (file: string) => fs.readFileSync(file);

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

test('PATCH /api/presets/:type/:name renames a user preset and reports the references it updated', async () => {
  saveUserPreset('print', 'Route rename', { layer_height: '0.2' });
  const res = await call('PATCH', '/api/presets/print/Route%20rename', { name: 'Route renamed' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, {
    type: 'print',
    from: 'Route rename',
    to: 'Route renamed',
    inheritedBy: 0,
    printers: 0,
    projects: 0,
    autosaves: 0,
  });
  assert.equal(userPresetExists('print', 'Route renamed'), true);
});

test('PATCH /api/presets/:type/:name answers 409 for a name that is already taken', async () => {
  saveUserPreset('print', 'Taken', { layer_height: '0.2' });
  saveUserPreset('print', 'Taker', { layer_height: '0.2' });
  const res = await call('PATCH', '/api/presets/print/Taker', { name: 'Taken' });
  assert.equal(res.status, 409);
  assert.match((res.json as { error: string }).error, /already exists/);
});

test('PATCH /api/presets/:type/:name answers 400 for a missing or unusable name', async () => {
  saveUserPreset('print', 'Needs a name', { layer_height: '0.2' });
  assert.equal((await call('PATCH', '/api/presets/print/Needs%20a%20name', {})).status, 400);
  assert.equal((await call('PATCH', '/api/presets/print/Needs%20a%20name', { name: '   ' })).status, 400);
  assert.equal((await call('PATCH', '/api/presets/print/Needs%20a%20name', { name: '- default -' })).status, 400);
  assert.equal((await call('PATCH', '/api/presets/print/unknown%20preset', { name: 'x' })).status, 400);
});

test('GET /api/presets/bundle downloads the user presets as an attachment', async () => {
  saveUserPreset('print', 'In the bundle', { layer_height: '0.2' });
  const res = await call('GET', '/api/presets/bundle');
  assert.equal(res.status, 200, res.text);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="WebSlicer config bundle\.ini"/);
  assert.match(res.text, /\[print:Route renamed\]/);
  assert.match(res.text, /\[print:Needs a name\]/);
});

test('POST /api/presets/bundle/preview answers what the bundle holds, without writing anything', async () => {
  const bundle = ['[print:Preview only]', 'layer_height = 0.3', 'post_process = echo pwned'].join('\n');
  const res = await call('POST', '/api/presets/bundle/preview', { bundle });
  assert.equal(res.status, 200, res.text);
  const preview = res.json as { presets: Array<{ type: string; name: string }>; rejected: Array<{ key: string }>; bundle: string };
  assert.deepEqual(
    preview.presets.map((p) => [p.type, p.name]),
    [['print', 'Preview only']],
  );
  assert.deepEqual(
    preview.rejected.map((r) => r.key),
    ['post_process'],
  );
  // the text comes back so the client can send exactly what it saw
  assert.equal(preview.bundle, bundle);
  assert.equal(userPresetExists('print', 'Preview only'), false);
});

test('POST /api/presets/bundle/preview answers 400 without a bundle', async () => {
  const res = await call('POST', '/api/presets/bundle/preview', {});
  assert.equal(res.status, 400);
  assert.match((res.json as { error: string }).error, /bundle required/);
});

test('POST /api/presets/bundle/import writes the presets, with one answer per clash', async () => {
  saveUserPreset('print', 'Bundle clash', { layer_height: '0.2' });
  const bundle = ['[print:Bundle clash]', 'layer_height = 0.4', '[filament:Bundle filament]', 'temperature = 220'].join('\n');
  const res = await call('POST', '/api/presets/bundle/import', {
    bundle,
    choices: [{ type: 'print', name: 'Bundle clash', system: false, choice: 'overwrite' }],
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual((res.json as { imported: unknown[] }).imported.length, 2);
  assert.equal(userPresetExists('print', 'Bundle clash'), true);
  assert.equal(userPresetExists('filament', 'Bundle filament'), true);
});

test('POST /api/presets/bundle/import answers 400 for a clash without a choice and for a system overwrite', async () => {
  saveUserPreset('print', 'Unanswered', { layer_height: '0.2' });
  const bundle = ['[print:Unanswered]', 'layer_height = 0.4'].join('\n');
  assert.equal((await call('POST', '/api/presets/bundle/import', { bundle })).status, 400);
  const overwriteSystem = await call('POST', '/api/presets/bundle/import', {
    bundle: ['[print:- default FFF -]', 'layer_height = 0.4'].join('\n'),
    choices: [{ type: 'print', name: '- default FFF -', system: true, choice: 'overwrite' }],
  });
  assert.equal(overwriteSystem.status, 400);
});

test('POST /api/presets/bundle/import rejects an invalid clash choice', async () => {
  const res = await call('POST', '/api/presets/bundle/import', {
    bundle: '[print:x]\nlayer_height = 0.2',
    choices: [{ type: 'print', name: 'x', choice: 'ignore' }],
  });
  assert.equal(res.status, 400);
});

test('POST /api/presets/gcode/preview reads the config block of an uploaded G-code', async () => {
  const res = await call('POST', '/api/presets/gcode/preview', upload(path.join(FIXTURES, 'config-block.gcode')) as never, {
    'content-type': 'application/octet-stream',
  });
  assert.equal(res.status, 200, res.text);
  const preview = res.json as { fromGcode: boolean; presets: Array<{ type: string; name: string }>; rejected: Array<{ key: string }> };
  assert.equal(preview.fromGcode, true);
  assert.deepEqual(
    preview.presets.map((p) => [p.type, p.name]),
    [
      ['print', '0.20mm SPEED @MK4S HF0.4'],
      ['filament', 'Prusament PLA @HF0.4'],
      ['printer', 'Original Prusa MK4S HF0.4 nozzle'],
    ],
  );
  assert.deepEqual(preview.rejected.map((r) => r.key).sort(), ['output_filename_format', 'post_process']);
});

test('POST /api/presets/gcode/preview answers 400 for a file without a config block', async () => {
  const res = await call('POST', '/api/presets/gcode/preview', Buffer.from('G90\nM83\nG28\n') as never, {
    'content-type': 'application/octet-stream',
  });
  assert.equal(res.status, 400);
  assert.match((res.json as { error: string }).error, /no PrusaSlicer config block/);
});

test('the upload path leaves no temp file behind', async () => {
  await call('POST', '/api/presets/gcode/preview', upload(path.join(FIXTURES, 'hostile-config-block.gcode')) as never, {
    'content-type': 'application/octet-stream',
  });
  const leftovers = fs.readdirSync(config.cacheDir).filter((f) => f.startsWith('.upload-'));
  assert.deepEqual(leftovers, []);
});
