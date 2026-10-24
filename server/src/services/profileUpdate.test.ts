/**
 * The vendor profile updater against a mocked profile repository.
 *
 * The cases the task names: up to date, a newer compatible bundle, a newer one the engine cannot run
 * (min too high, max too low), a vendor the repository does not know, and a failure (offline, 403,
 * timeout) that stays silent and keeps the last result. Installing runs against a real data dir: the
 * file is written, `loadBundles` serves it, a refused bundle changes nothing, and a hostile answer
 * (path traversal in an asset name, oversize, the wrong vendor inside the file, a lower version) is
 * answered with a 4xx and writes nothing.
 *
 * The mock is a `fetch` function, so no network is touched; the timeout case is a fetch that rejects
 * the way `AbortSignal.timeout` does.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-profile-update-'));
const ENGINE = path.join(DATA_DIR, 'engine-profiles');
process.env.DATA_DIR = DATA_DIR;
process.env.PRUSASLICER_PROFILES = ENGINE;
delete process.env.PRUSASLICER_RESOURCES;

const { config } = await import('../config.js');
const { loadBundles, vendorDataDir } = await import('../slicer/bundles.js');
const { bundleFindings, createProfileUpdater, unescapeGcode } = await import('./profileUpdate.js');
const { saveUserPreset } = await import('../slicer/presets.js');

const VENDOR = 'TestVendor';
const ORIGIN = `https://raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/${VENDOR}`;
const VENDOR_DIR = vendorDataDir();
const DATA_FILE = path.join(VENDOR_DIR, `${VENDOR}.ini`);
const PREV_FILE = `${DATA_FILE}.prev`;

/** How a bundle is put together for a test; every argument is opt-in. */
interface BundleParts {
  version?: string;
  vendorId?: string;
  presets?: string[];
  assets?: string[];
  gcode?: { preset?: string; start?: string; end?: string };
}

/** A bundle the engine or the repository offers. */
function bundle(parts: BundleParts = {}): string {
  const version = parts.version ?? '1.1.0';
  const lines = ['[vendor]', 'name = Test Vendor', `config_version = ${version}`];
  if (parts.vendorId) lines.push(`vendor_id = ${parts.vendorId}`);
  lines.push(`config_update_url = ${ORIGIN}/`, '');
  for (const name of parts.presets ?? ['Bundle Filament']) {
    lines.push(
      `[filament:${name}]`,
      'temperature = 215',
      'first_layer_temperature = 215',
      'bed_temperature = 60',
      'filament_type = PLA',
      '',
    );
  }
  if (parts.gcode) {
    lines.push(`[printer:${parts.gcode.preset ?? 'Printer'}]`, 'nozzle_diameter = 0.4');
    if (parts.gcode.start) lines.push(`start_gcode = ${gcode(parts.gcode.start)}`);
    if (parts.gcode.end) lines.push(`end_gcode = ${gcode(parts.gcode.end)}`);
    lines.push('');
  }
  if (parts.assets) {
    lines.push('[printer_model:Model]', 'name = Model', 'variants = 0.4');
    lines.push(`bed_model = ${parts.assets[0]}`);
    if (parts.assets[1]) lines.push(`bed_texture = ${parts.assets[1]}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** G-code as a bundle stores it: one line, line ends as `\n`. */
const gcode = (text: string) => text.replace(/\n/g, '\\n');

const INDEX = (...lines: string[]) => lines.join('\n');

interface Answer {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  error?: Error;
}

/** A repository that answers by file name; an unlisted file is a 404. */
function repository(files: Record<string, Answer>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const answer = files[url.slice(url.lastIndexOf('/') + 1)];
    if (!answer) return new Response('not found', { status: 404 });
    if (answer.error) throw answer.error;
    return new Response(answer.body ?? '', { status: answer.status ?? 200, headers: answer.headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function updater(fetchImpl: typeof fetch, over: { enabled?: boolean; engineVersion?: string; now?: () => Date } = {}) {
  const logs: string[] = [];
  const instance = createProfileUpdater({
    enabled: over.enabled ?? true,
    engineVersion: over.engineVersion ?? '2.9.6',
    vendorDir: VENDOR_DIR,
    cacheFile: path.join(DATA_DIR, 'vendor-updates.json'),
    fetch: fetchImpl,
    now: over.now,
    log: (m) => logs.push(m),
  });
  return { instance, logs };
}

/** The row of the test vendor in a list answer. */
async function vendorRow(fetchImpl: typeof fetch, over: { enabled?: boolean; engineVersion?: string } = {}) {
  const list = await updater(fetchImpl, over).instance.list(true);
  const row = list.vendors.find((v) => v.id === VENDOR);
  assert.ok(row, `the list names ${VENDOR}`);
  return { row, list };
}

const servedVersion = () => loadBundles(true).vendors.find((v) => v.id === VENDOR)?.configVersion;

/** Write the engine's copy (the image) and reload the bundles. */
function engineShips(text: string): void {
  fs.mkdirSync(ENGINE, { recursive: true });
  fs.writeFileSync(path.join(ENGINE, `${VENDOR}.ini`), text);
  loadBundles(true);
}

before(() => engineShips(bundle({ version: '1.0.0', presets: ['Base Filament'] })));

after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

beforeEach(() => {
  fs.rmSync(DATA_FILE, { force: true });
  fs.rmSync(PREV_FILE, { force: true });
  fs.rmSync(path.join(DATA_DIR, 'vendor-updates.json'), { force: true });
  fs.rmSync(config.presetsDir, { recursive: true, force: true });
  engineShips(bundle({ version: '1.0.0', presets: ['Base Filament'] }));
});

// ---------------------------------------------------------------------------
// AC-1: the check
// ---------------------------------------------------------------------------

test('a vendor whose bundle is up to date is not offered', async () => {
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('1.0.0 The version in use.') } });
  const { row } = await vendorRow(fetchImpl);
  assert.deepEqual(
    { installed: row.installed, available: row.available, compatible: row.compatible, update: row.update, reason: row.reason },
    { installed: '1.0.0', available: '1.0.0', compatible: true, update: false, reason: 'up to date' },
  );
  assert.equal(row.url, 'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/TestVendor');
});

test('a newer compatible bundle is offered', async () => {
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('1.0.0 Old.', '1.1.0 New.') } });
  const { row } = await vendorRow(fetchImpl);
  assert.equal(row.available, '1.1.0');
  assert.equal(row.compatible, true);
  assert.equal(row.update, true);
  assert.equal(row.reason, undefined);
  assert.match(row.checkedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('a bundle whose min_slic3r_version is above the engine is listed but not offered', async () => {
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('min_slic3r_version = 3.0.0', '1.1.0 For a newer engine.') } });
  const { row } = await vendorRow(fetchImpl);
  assert.equal(row.available, '1.1.0');
  assert.equal(row.compatible, false);
  assert.equal(row.update, false);
  assert.match(row.reason ?? '', /needs PrusaSlicer 3\.0\.0/);
});

test('a bundle whose max_slic3r_version is below the engine is listed but not offered', async () => {
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('max_slic3r_version = 2.7.9', '1.1.0 Retired.') } });
  const { row } = await vendorRow(fetchImpl);
  assert.equal(row.available, '1.1.0');
  assert.equal(row.compatible, false);
  assert.equal(row.update, false);
  assert.match(row.reason ?? '', /up to 2\.7\.9/);
});

test('an older compatible bundle is not offered as an update', async () => {
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('0.9.0 Older.') } });
  const { row } = await vendorRow(fetchImpl);
  assert.equal(row.available, '0.9.0');
  assert.equal(row.update, false);
});

test('a vendor the repository does not know stays without an available version', async () => {
  const { fetchImpl, calls } = repository({});
  const { row } = await vendorRow(fetchImpl);
  assert.equal(row.installed, '1.0.0');
  assert.equal(row.available, undefined);
  assert.equal(row.update, false);
  assert.equal(row.reason, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `${ORIGIN}/index.idx`);
});

test('the check is silent on failure and keeps the last result', async () => {
  const first = repository({ 'index.idx': { body: INDEX('1.1.0 New.') } });
  await updater(first.fetchImpl).instance.list(true);

  for (const error of [new Error('offline'), new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError')]) {
    const { instance, logs } = updater(repository({ 'index.idx': { error } }).fetchImpl);
    const list = await instance.list(true);
    const row = list.vendors.find((v) => v.id === VENDOR);
    assert.equal(row?.available, '1.1.0', `kept after "${error.message}"`);
    assert.equal(row?.update, true);
    assert.ok(
      logs.some((m) => m.includes('cannot read the index')),
      'the failure is logged',
    );
  }

  const forbidden = await updater(repository({ 'index.idx': { status: 403 } }).fetchImpl).instance.list(true);
  assert.equal(forbidden.vendors.find((v) => v.id === VENDOR)?.available, '1.1.0');
});

test('once the check is enabled the answer is cached for a day', async () => {
  const { fetchImpl, calls } = repository({ 'index.idx': { body: INDEX('1.1.0 New.') } });
  const { instance } = updater(fetchImpl);
  await instance.list();
  await instance.list();
  assert.equal(calls.length, 1, 'the second list within 24 h makes no request');
  // a forced refresh asks again
  await instance.list(true);
  assert.equal(calls.length, 2);

  const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const stale = updater(fetchImpl, { now: () => later });
  await stale.instance.list();
  assert.equal(calls.length, 3, 'a day later the check runs again');
});

test('with the check switched off nothing is requested at all', async () => {
  let called = false;
  const fetchImpl = (async () => {
    called = true;
    throw new Error('the updater must not make a request');
  }) as unknown as typeof fetch;
  const { instance } = updater(fetchImpl, { enabled: false });
  const list = await instance.list(true);
  assert.equal(called, false);
  assert.equal(list.enabled, false);
  assert.equal(list.checkedAt, null);
  assert.equal(list.vendors.find((v) => v.id === VENDOR)?.available, undefined);
  // installing online is refused, not silently attempted
  await assert.rejects(instance.install(VENDOR), /disabled/);
});

// ---------------------------------------------------------------------------
// AC-2: the install
// ---------------------------------------------------------------------------

test('installing a newer bundle writes it into the data dir and reloads the bundles', async () => {
  const { fetchImpl } = repository({
    'index.idx': { body: INDEX('1.1.0 New.') },
    '1.1.0.ini': { body: bundle({ presets: ['New Filament'] }) },
  });
  const { instance, logs } = updater(fetchImpl);
  const result = await instance.install(VENDOR);

  assert.deepEqual({ from: result.from, to: result.to, vendor: result.vendor }, { from: '1.0.0', to: '1.1.0', vendor: VENDOR });
  assert.deepEqual(result.orphaned, []);
  assert.equal(servedVersion(), '1.1.0');
  assert.ok(loadBundles(true).presets.filament.some((p) => p.name === 'New Filament'));
  assert.equal(fs.readFileSync(DATA_FILE, 'utf8'), bundle({ presets: ['New Filament'] }));
  // the first install has nothing older in the data dir: the image's copy is the rollback target
  assert.equal(fs.existsSync(PREV_FILE), false);
  assert.ok(logs.some((m) => m.includes('installed 1.1.0')));
  // the temp directory of the install is gone
  assert.deepEqual(
    fs.readdirSync(VENDOR_DIR).filter((f) => f.startsWith('.install-')),
    [],
  );
});

test('a second install keeps the bundle it replaced as the rollback copy', async () => {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, bundle({ version: '1.1.0', presets: ['First update'] }));
  engineShips(bundle({ version: '1.0.0', presets: ['Base Filament'] }));
  assert.equal(servedVersion(), '1.1.0');

  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('1.2.0 New.') }, '1.2.0.ini': { body: bundle({ version: '1.2.0' }) } });
  const result = await updater(fetchImpl).instance.install(VENDOR);
  assert.deepEqual({ from: result.from, to: result.to }, { from: '1.1.0', to: '1.2.0' });
  assert.match(fs.readFileSync(PREV_FILE, 'utf8'), /config_version = 1\.1\.0/);
  assert.equal(servedVersion(), '1.2.0');
});

test('a bundle with a block-level finding is refused and nothing changes', async () => {
  const bad = bundle({ presets: ['Bad Filament'] }).replace('temperature = 215', 'temperature = 2150');
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: bad } });
  const { instance } = updater(fetchImpl);
  const error = (await instance.install(VENDOR).catch((e) => e)) as Error & {
    status?: number;
    details?: { refusals?: Array<{ rule: string; preset: string }> };
  };
  assert.equal(error.status, 409);
  assert.match(error.message, /refused/);
  const refusals = error.details?.refusals ?? [];
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].rule, 'config.hotend_limit');
  assert.equal(refusals[0].preset, 'Bad Filament');
  assert.equal(fs.existsSync(DATA_FILE), false, 'nothing written');
  assert.equal(fs.existsSync(PREV_FILE), false);
  assert.equal(servedVersion(), '1.0.0');
});

test('a bundle that trips a G-code rule the vendor already had is installed, a new one is refused', async () => {
  // the image's own bundle already writes M92, like PrusaSlicer's PrusaResearch bundle does
  engineShips(bundle({ version: '1.0.0', presets: ['Base Filament'], gcode: { start: 'G28\nM92 E140' } }));
  const same = bundle({ gcode: { start: 'G28\nM92 E140\nG1 Z5' } });
  const first = repository({ 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: same } });
  const result = await updater(first.fetchImpl).instance.install(VENDOR);
  assert.equal(result.to, '1.1.0');

  // a bundle that introduces an ordering rule the vendor never had is refused
  const homing = bundle({ version: '1.2.0', gcode: { start: 'G1 X10\nG28' } });
  const second = repository({ 'index.idx': { body: INDEX('1.2.0 New.') }, '1.2.0.ini': { body: homing } });
  const error = (await updater(second.fetchImpl)
    .instance.install(VENDOR)
    .catch((e) => e)) as Error & { details?: { refusals?: Array<{ rule: string }> } };
  assert.match(error.message, /refused/);
  assert.ok(error.details?.refusals?.some((r) => r.rule === 'gcode.no_homing'));
  assert.equal(servedVersion(), '1.1.0');
});

test('a hostile bundle is answered with a 4xx and nothing is written', async () => {
  const cases: Array<{ name: string; files: Record<string, Answer>; why: RegExp; status?: number }> = [
    {
      name: 'path traversal in an asset name',
      files: { 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: bundle({ assets: ['../../evil.stl'] }) } },
      why: /unusable asset name/,
    },
    {
      name: 'an oversize answer',
      files: { 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { headers: { 'content-length': '6000000' }, body: bundle() } },
      why: /larger than/,
    },
    {
      name: 'the wrong vendor inside the file',
      files: { 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: bundle({ vendorId: 'OtherVendor' }) } },
      why: /names the vendor "OtherVendor"/,
    },
    {
      name: 'a lower version inside the file',
      files: { 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: bundle({ version: '0.9.0' }) } },
      why: /not newer/,
    },
    {
      name: 'a bundle that is not there',
      files: { 'index.idx': { body: INDEX('1.1.0 New.') } },
      why: /could not be downloaded/,
      status: 502,
    },
    {
      name: 'an index that is not there',
      files: {},
      why: /did not answer/,
      status: 502,
    },
  ];
  for (const c of cases) {
    const { instance } = updater(repository(c.files).fetchImpl);
    const error = (await instance.install(VENDOR).catch((e) => e)) as Error & { status?: number };
    const status = error.status;
    // a bundle that is not usable is a 400/409, a repository that cannot answer is a 502
    assert.ok(status, `${c.name}: a typed error, not a crash (${error.message})`);
    if (c.status) assert.equal(status, c.status, c.name);
    else assert.ok(status < 500, `${c.name}: ${error.message}`);
    assert.match(error.message, c.why, c.name);
    assert.equal(fs.existsSync(DATA_FILE), false, `${c.name}: nothing written`);
    assert.equal(servedVersion(), '1.0.0', c.name);
  }
});

test('a downloaded asset is stored under the vendor folder, never outside it', async () => {
  const { fetchImpl } = repository({
    'index.idx': { body: INDEX('1.1.0 New.') },
    '1.1.0.ini': { body: bundle({ assets: ['model_bed.stl', 'model.svg'] }) },
    'model_bed.stl': { body: 'solid model' },
    'model.svg': { body: '<svg />' },
  });
  await updater(fetchImpl).instance.install(VENDOR);
  assert.equal(fs.readFileSync(path.join(VENDOR_DIR, VENDOR, 'model_bed.stl'), 'utf8'), 'solid model');
  assert.equal(fs.readFileSync(path.join(VENDOR_DIR, VENDOR, 'model.svg'), 'utf8'), '<svg />');
});

test('an unknown or malformed vendor is refused before any request', async () => {
  const { fetchImpl, calls } = repository({});
  const { instance } = updater(fetchImpl);
  await assert.rejects(instance.install('NoSuchVendor'), /unknown vendor/);
  await assert.rejects(instance.install('../etc'), /invalid vendor id/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// AC-3: revert and install from a file
// ---------------------------------------------------------------------------

test('revert restores the previous bundle and reports the change', async () => {
  // a first update, so the data dir holds a file and the engine's copy is the fallback
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, bundle({ version: '1.1.0', presets: ['First update'] }));
  engineShips(bundle({ version: '1.0.0', presets: ['Base Filament'] }));
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('1.2.0 New.') }, '1.2.0.ini': { body: bundle({ version: '1.2.0' }) } });
  const { instance } = updater(fetchImpl);
  await instance.install(VENDOR);
  assert.equal(servedVersion(), '1.2.0');
  assert.ok(fs.existsSync(PREV_FILE), 'the replaced bundle is kept');

  const reverted = await instance.revert(VENDOR);
  assert.deepEqual({ from: reverted.from, to: reverted.to }, { from: '1.2.0', to: '1.1.0' });
  assert.equal(servedVersion(), '1.1.0');
  assert.equal(fs.existsSync(PREV_FILE), false, 'the rollback copy is consumed');

  // no rollback copy left: the next revert drops the data-dir file and the image's bundle is used again
  await instance.revert(VENDOR);
  assert.equal(fs.existsSync(DATA_FILE), false);
  assert.equal(servedVersion(), '1.0.0');

  await assert.rejects(instance.revert(VENDOR), /no installed update to revert/);
});

test('a reverted vendor is not marked as having a rollback left', async () => {
  const { fetchImpl } = repository({ 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: bundle() } });
  const { instance } = updater(fetchImpl);
  assert.equal((await instance.list(true)).vendors.find((v) => v.id === VENDOR)?.canRevert, false);
  await instance.install(VENDOR);
  assert.equal((await instance.list()).vendors.find((v) => v.id === VENDOR)?.canRevert, true);
});

test('install from a file works with the check switched off and validates the same way', async () => {
  const { instance } = updater(repository({}).fetchImpl, { enabled: false });
  const file = path.join(DATA_DIR, 'picked.ini');
  fs.writeFileSync(file, bundle({ version: '1.2.0', presets: ['Picked Filament'] }));
  const result = await instance.installFromFile(file);
  assert.deepEqual({ vendor: result.vendor, from: result.from, to: result.to }, { vendor: VENDOR, from: '1.0.0', to: '1.2.0' });
  assert.equal(servedVersion(), '1.2.0');

  // a lower version and a block-level finding are refused; a file without a vendor is a 400
  const lower = path.join(DATA_DIR, 'lower.ini');
  fs.writeFileSync(lower, bundle({ version: '1.1.0' }));
  await assert.rejects(instance.installFromFile(lower), /not newer/);

  const bad = path.join(DATA_DIR, 'bad.ini');
  fs.writeFileSync(bad, bundle({ version: '1.3.0', presets: ['Bad'] }).replace('temperature = 215', 'temperature = 2150'));
  await assert.rejects(instance.installFromFile(bad), /refused/);

  const nameless = path.join(DATA_DIR, 'nameless.ini');
  fs.writeFileSync(nameless, ['[vendor]', 'name = Nobody', 'config_version = 9.0.0'].join('\n'));
  await assert.rejects(instance.installFromFile(nameless), /does not name a vendor/);

  assert.equal(servedVersion(), '1.2.0', 'the refused files changed nothing');
});

// ---------------------------------------------------------------------------
// User presets that lose their parent
// ---------------------------------------------------------------------------

test('a user preset that loses its system parent is reported, and renamed ones are not', async () => {
  engineShips(
    bundle({ version: '1.0.0', presets: ['Base Filament'] }) +
      '\n[print:Base print]\nlayer_height = 0.2\n\n[print:Renamed print]\nlayer_height = 0.3\n',
  );
  const before = loadBundles(true);
  assert.ok(before.presets.print.some((p) => p.name === 'Base print'));
  saveUserPreset('print', 'My print', { layer_height: '0.25' }, 'Base print');
  saveUserPreset('print', 'Still fine', { layer_height: '0.3' }, 'Renamed print');

  // the new bundle keeps "Renamed print" under a new name (its `renamed_from` alias) and drops "Base print"
  const next = `${bundle({ version: '1.1.0', presets: ['Base Filament'] })}\n[print:New print]\nrenamed_from = Renamed print\nlayer_height = 0.2\n`;
  const { instance } = updater(repository({ 'index.idx': { body: INDEX('1.1.0 New.') }, '1.1.0.ini': { body: next } }).fetchImpl);
  const result = await instance.install(VENDOR);
  assert.deepEqual(result.orphaned, [{ type: 'print', name: 'My print', parent: 'Base print' }]);
});

// ---------------------------------------------------------------------------
// The pure validation helpers
// ---------------------------------------------------------------------------

test('G-code is unescaped the way PrusaSlicer stores it', () => {
  assert.equal(unescapeGcode('G28\\nG1 Z5'), 'G28\nG1 Z5');
  assert.equal(unescapeGcode('a\\"b\\\\c\\td'), 'a"b\\c\\td');
  assert.equal(unescapeGcode('plain'), 'plain');
});

test('an end G-code that lifts Z is not an ordering finding', () => {
  const preset = {
    type: 'printer' as const,
    name: 'P',
    vendorId: VENDOR,
    vendorName: 'Test Vendor',
    config: { end_gcode: unescapeGcode('G1 Z5\\nG28') },
    renamedFrom: [],
  };
  assert.deepEqual(bundleFindings([preset]), { refusals: [], preExisting: [] });
});

test('an injected key and a lone carriage return are refused', () => {
  const preset = {
    type: 'print' as const,
    name: 'P',
    vendorId: VENDOR,
    vendorName: 'Test Vendor',
    config: { 'x\npost_process = echo pwned': '1', start_gcode: 'G28\rM500' },
    renamedFrom: [],
  };
  const { refusals } = bundleFindings([preset]);
  assert.deepEqual(refusals.map((r) => r.rule).sort(), ['bundle.invalid_key', 'bundle.lone_cr', 'gcode.forbidden_command']);
  // the lone CR hides M500, which the scanner sees once it is one line
  assert.ok(refusals.some((r) => r.rule === 'gcode.forbidden_command' && r.message.includes('M500')));
});
