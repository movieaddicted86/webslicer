/**
 * The configuration wizard's two server-side promises, over HTTP: the filament catalogue it ticks
 * from, the list of ticked filaments that survives a reload, and the preset save that refuses a
 * temperature the limits block.
 *
 * The catalogue and the tick list have to be an ordinary API (the dialog reads and writes them like
 * the installed printers), and the refusal has to come from the server as well as the form: a client
 * that skips the UI must not be able to store a hotend at 400 °C.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

// the data directory and the vendor profiles have to be redirected before anything reads them
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-wizard-routes-'));
const PROFILES = path.join(DATA_DIR, 'engine-profiles');
process.env.DATA_DIR = DATA_DIR;
process.env.PRUSASLICER_PROFILES = PROFILES;
delete process.env.PRUSASLICER_RESOURCES;

const { config, ensureDirs } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setActiveSchema } = await import('../services/schema.js');
const { setInstalledPrinters, userPresetExists, resolvePreset } = await import('../slicer/presets.js');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'slicer', 'fixtures', 'schema.json'), 'utf8')) as never;

const VENDOR = 'TestVendor';
const PRINTER = 'Test Printer 0.4';
const FILAMENT = 'Test PLA';

/** One vendor with a printer model, a compatible and an incompatible filament, and one of each type. */
const BUNDLE = [
  '[vendor]',
  'name = Test Vendor',
  'config_version = 1.0.0',
  '',
  '[printer_model:Test Printer]',
  'name = Test Printer',
  'variants = 0.4',
  '',
  `[printer:${PRINTER}]`,
  'printer_model = Test Printer',
  'printer_variant = 0.4',
  'nozzle_diameter = 0.4',
  'bed_shape = 0x0,220x0,220x220,0x220',
  '',
  `[filament:${FILAMENT}]`,
  'filament_type = PLA',
  'temperature = 215',
  // the name list is what the selector's compatibility check reads
  `compatible_printers = ${PRINTER}`,
  '',
  '[filament:SLA only resin]',
  'filament_type = PETG',
  'temperature = 240',
  'compatible_printers = Some Other Printer',
  '',
].join('\n');

let server: Server;
let base = '';

interface Res {
  status: number;
  text: string;
  json: unknown;
}

async function call(method: string, url: string, body?: object): Promise<Res> {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

type CatalogEntry = { name: string; vendorId: string; vendorName: string; material?: string; compatible: boolean };

before(async () => {
  ensureDirs();
  setActiveSchema(SCHEMA);
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.writeFileSync(path.join(PROFILES, `${VENDOR}.ini`), BUNDLE);
  // the bundle's vendor has to be installed, or its presets are not offered at all
  setInstalledPrinters([{ vendorId: VENDOR, modelId: 'Test Printer', variant: '0.4' }]);
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

test('GET /api/presets/filaments/catalog lists the installed vendor with its material and compatibility', async () => {
  const res = await call('GET', '/api/presets/filaments/catalog');
  assert.equal(res.status, 200, res.text);
  const catalog = res.json as CatalogEntry[];
  assert.deepEqual(
    catalog.map((e) => [e.name, e.vendorId, e.vendorName, e.material]),
    [
      [FILAMENT, VENDOR, 'Test Vendor', 'PLA'],
      ['SLA only resin', VENDOR, 'Test Vendor', 'PETG'],
    ],
  );
  // without a printer nothing is marked incompatible
  assert.ok(catalog.every((e) => e.compatible));
});

test('GET /api/presets/filaments/catalog?printer= marks what the printer cannot use', async () => {
  const res = await call('GET', `/api/presets/filaments/catalog?printer=${encodeURIComponent(PRINTER)}`);
  assert.equal(res.status, 200, res.text);
  const catalog = res.json as CatalogEntry[];
  assert.deepEqual(
    catalog.map((e) => [e.name, e.compatible]),
    [
      [FILAMENT, true],
      ['SLA only resin', false],
    ],
  );
});

test('the visible filament list starts empty and comes back after a save, like the installed printers', async () => {
  assert.deepEqual((await call('GET', '/api/presets/filaments/visible')).json, { names: [] });

  const saved = await call('PUT', '/api/presets/filaments/visible', { names: [FILAMENT] });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json, { names: [FILAMENT] });
  // the file the list lives in, next to installed_printers.json
  const file = path.join(config.dataDir, 'visible_filaments.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [FILAMENT]);
  assert.deepEqual((await call('GET', '/api/presets/filaments/visible')).json, { names: [FILAMENT] });

  // an empty list is the "show all" state, not an error
  const cleared = await call('PUT', '/api/presets/filaments/visible', { names: [] });
  assert.equal(cleared.status, 200, cleared.text);
  assert.deepEqual(cleared.json, { names: [] });
});

test('PUT /api/presets/filaments/visible answers 400 without a name list', async () => {
  const res = await call('PUT', '/api/presets/filaments/visible', { names: [1] });
  assert.equal(res.status, 400);
  assert.match((res.json as { error: string }).error, /invalid filament name/);
});

test('a preset save with an absurd hotend is refused and not stored', async () => {
  // 2150 °C is the typo catcher of S1-d. 400 °C is deliberately *not* blocked: the global window is
  // 150–450 °C so a high-temperature machine stays possible, and a PLA value that far off only warns.
  const res = await call('PUT', '/api/presets/filament/Too%20hot', {
    config: { filament_type: 'PLA', temperature: '2150', first_layer_temperature: '215' },
  });
  assert.equal(res.status, 400, res.text);
  const body = res.json as { error: string; issues: Array<{ rule: string; key: string; severity: string }> };
  assert.match(body.error, /temperature = 2150 °C is outside the allowed/);
  assert.equal(body.issues[0].rule, 'config.hotend_limit');
  assert.equal(body.issues[0].key, 'temperature');
  assert.equal(userPresetExists('filament', 'Too hot'), false);
});

test('a PLA value outside its usual window is stored – the limits warn, they do not block it', async () => {
  const res = await call('PUT', '/api/presets/filament/High%20PLA', {
    config: { filament_type: 'PLA', temperature: '400', first_layer_temperature: '400' },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(resolvePreset(SCHEMA, 'filament', 'High PLA')?.config.temperature, '400');
});

test('a preset save inside the limits is stored with the values of the wizard', async () => {
  const res = await call('PUT', '/api/presets/filament/Test%20filament', {
    config: {
      temperature: '215',
      first_layer_temperature: '215',
      bed_temperature: '60',
      first_layer_bed_temperature: '60',
      filament_diameter: '1.75',
      filament_type: 'PLA',
    },
  });
  assert.equal(res.status, 200, res.text);
  const stored = resolvePreset(SCHEMA, 'filament', 'Test filament');
  assert.equal(stored?.config.temperature, '215');
  assert.equal(stored?.config.first_layer_bed_temperature, '60');
  assert.equal(stored?.config.filament_diameter, '1.75');
});

test('a bed temperature above the limit is refused too, and a soft-range value only warns', async () => {
  const bed = await call('PUT', '/api/presets/filament/Warm%20bed', { config: { bed_temperature: '160' } });
  assert.equal(bed.status, 400, bed.text);
  assert.equal((bed.json as { issues: Array<{ rule: string }> }).issues[0].rule, 'config.bed_limit');

  // 265 °C PLA is unusual, not impossible: it is stored, exactly like a slice would warn about it
  const odd = await call('PUT', '/api/presets/filament/Odd%20PLA', { config: { filament_type: 'PLA', temperature: '265' } });
  assert.equal(odd.status, 200, odd.text);
  assert.equal(resolvePreset(SCHEMA, 'filament', 'Odd PLA')?.config.temperature, '265');
});
