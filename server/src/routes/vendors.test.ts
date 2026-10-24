/**
 * The vendor profile update endpoints over HTTP: the status codes and JSON shapes the dialog reads,
 * the upload route for an air-gapped install, and the check that is switched off.
 *
 * The repository is a mocked `fetch` handed to the real service, so no network is touched; the route
 * layer is the thing under test here (the rule themselves are covered in
 * `services/profileUpdate.test.ts`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-vendor-routes-'));
const ENGINE = path.join(DATA_DIR, 'engine-profiles');
process.env.DATA_DIR = DATA_DIR;
process.env.PRUSASLICER_PROFILES = ENGINE;
delete process.env.PRUSASLICER_RESOURCES;

const { ensureDirs } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setProfileUpdater, createProfileUpdater } = await import('../services/profileUpdate.js');
const { loadBundles, vendorDataDir } = await import('../slicer/bundles.js');

const VENDOR = 'TestVendor';
const ORIGIN = `https://raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/${VENDOR}`;

const bundle = (version: string, ...presets: string[]) =>
  [
    '[vendor]',
    'name = Test Vendor',
    `config_version = ${version}`,
    `config_update_url = ${ORIGIN}/`,
    '',
    ...presets.flatMap((name) => [`[filament:${name}]`, 'temperature = 215', 'filament_type = PLA', '']),
  ].join('\n');

let server: Server;
let base = '';

interface Res {
  status: number;
  text: string;
  json: unknown;
}

async function call(method: string, url: string, body?: object | string): Promise<Res> {
  const isText = typeof body === 'string';
  const res = await fetch(`${base}${url}`, {
    method,
    headers: isText ? { 'content-type': 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {},
    body: isText ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, text, json };
}

/** Install an updater that answers from a table of file names; an unlisted file is a 404. */
function useRepository(files: Record<string, string | { status: number }>, enabled = true): void {
  const fetchImpl = (async (input: string | URL | Request) => {
    const name = String(input).slice(String(input).lastIndexOf('/') + 1);
    const answer = files[name];
    if (answer === undefined) return new Response('not found', { status: 404 });
    if (typeof answer !== 'string') return new Response('error', { status: answer.status });
    return new Response(answer, { status: 200 });
  }) as unknown as typeof fetch;
  setProfileUpdater(
    createProfileUpdater({
      enabled,
      engineVersion: '2.9.6',
      vendorDir: vendorDataDir(),
      cacheFile: path.join(DATA_DIR, 'vendor-updates.json'),
      fetch: fetchImpl,
      log: () => undefined,
    }),
  );
}

const served = () => loadBundles(true).vendors.find((v) => v.id === VENDOR)?.configVersion;

before(async () => {
  ensureDirs();
  fs.mkdirSync(ENGINE, { recursive: true });
  fs.writeFileSync(path.join(ENGINE, `${VENDOR}.ini`), bundle('1.0.0', 'Base Filament'));
  setProfileUpdater(undefined);
  const app: express.Express = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  setProfileUpdater(undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('GET /api/vendors/updates answers the installed vendors with their versions', async () => {
  useRepository({ 'index.idx': '1.1.0 New.\n1.0.0 Old.' });
  const res = await call('GET', '/api/vendors/updates?refresh=1');
  assert.equal(res.status, 200, res.text);
  const list = res.json as { enabled: boolean; checkedAt: string | null; vendors: Array<Record<string, unknown>> };
  assert.equal(list.enabled, true);
  assert.match(list.checkedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  const row = list.vendors.find((v) => v.id === VENDOR);
  assert.ok(row);
  assert.deepEqual(
    { installed: row.installed, available: row.available, compatible: row.compatible, update: row.update },
    { installed: '1.0.0', available: '1.1.0', compatible: true, update: true },
  );
});

test('GET /api/vendors/updates says so when the check is switched off', async () => {
  useRepository({}, false);
  const res = await call('GET', '/api/vendors/updates?refresh=1');
  assert.equal(res.status, 200, res.text);
  assert.equal((res.json as { enabled: boolean }).enabled, false);
});

test('POST /api/vendors/:id/update installs and answers the result', async () => {
  useRepository({ 'index.idx': '1.1.0 New.', '1.1.0.ini': bundle('1.1.0', 'New Filament') });
  const res = await call('POST', `/api/vendors/${VENDOR}/update`);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    { ...(res.json as object), orphaned: (res.json as { orphaned: unknown[] }).orphaned },
    { vendor: VENDOR, from: '1.0.0', to: '1.1.0', orphaned: [] },
  );
  assert.equal(served(), '1.1.0');
  assert.ok(fs.existsSync(path.join(vendorDataDir(), `${VENDOR}.ini`)));
});

test('POST /api/vendors/:id/update answers 409 with the reasons of a refused bundle', async () => {
  useRepository({
    'index.idx': '1.2.0 New.',
    '1.2.0.ini': bundle('1.2.0', 'Bad').replace('temperature = 215', 'temperature = 2150'),
  });
  const res = await call('POST', `/api/vendors/${VENDOR}/update`);
  assert.equal(res.status, 409, res.text);
  const body = res.json as { error: string; refusals: Array<{ rule: string; preset: string; message: string }> };
  assert.match(body.error, /refused/);
  assert.equal(body.refusals.length, 1);
  assert.equal(body.refusals[0].rule, 'config.hotend_limit');
  assert.equal(body.refusals[0].preset, 'Bad');
  assert.equal(served(), '1.1.0', 'the installed bundle stays');
});

test('POST /api/vendors/:id/update answers 404 for an unknown vendor and 502 for a silent repository', async () => {
  useRepository({ 'index.idx': '1.2.0 New.' });
  assert.equal((await call('POST', '/api/vendors/NoSuchVendor/update')).status, 404);
  useRepository({});
  const silent = await call('POST', `/api/vendors/${VENDOR}/update`);
  assert.equal(silent.status, 502, silent.text);
  // a server-side failure keeps its detail out of the response body
  assert.equal((silent.json as { error: string }).error, 'Internal error');
});

test('POST /api/vendors/:id/revert restores the bundle it replaced', async () => {
  useRepository({ 'index.idx': '1.3.0 New.', '1.3.0.ini': bundle('1.3.0', 'Latest Filament') });
  assert.equal((await call('POST', `/api/vendors/${VENDOR}/update`)).status, 200);
  assert.equal(served(), '1.3.0');
  const res = await call('POST', `/api/vendors/${VENDOR}/revert`);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual({ from: (res.json as { from: string }).from, to: (res.json as { to: string }).to }, { from: '1.3.0', to: '1.1.0' });
  assert.equal(served(), '1.1.0');
});

test('POST /api/vendors/install takes a bundle file, even with the check switched off', async () => {
  useRepository({}, false);
  const res = await call('POST', '/api/vendors/install', bundle('1.4.0', 'Offline Filament'));
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    { vendor: (res.json as { vendor: string }).vendor, to: (res.json as { to: string }).to },
    { vendor: VENDOR, to: '1.4.0' },
  );
  assert.equal(served(), '1.4.0');

  // a file that names no vendor is a 400
  const nameless = await call('POST', '/api/vendors/install', ['[vendor]', 'name = Nobody', 'config_version = 9.0.0'].join('\n'));
  assert.equal(nameless.status, 400, nameless.text);
  assert.match((nameless.json as { error: string }).error, /does not name a vendor/);
});
