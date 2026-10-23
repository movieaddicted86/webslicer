/**
 * `npm run pins:update` – take the fixtures and the pins from the installed PrusaSlicer version.
 *
 * An upgrade has two halves (docs/PrusaSlicer-Upgrade.md). This script does the first one in one run:
 *
 * 1. **Capture** what only the binary can produce into `server/src/slicer/fixtures/`:
 *    `help-fff.txt`, `help-sla.txt` (`--help-fff` / `--help-sla`) and `bundle-keys.json` (the config
 *    keys of every vendor preset, per preset type).
 * 2. **Rewrite the derived pins**: `schema.json` and `written-3mf.json`, through the existing
 *    `UPDATE_PINS=1` runs of the two pin tests.
 * 3. **Summarise the change**: options added, removed and options whose type or default changed, plus
 *    the new option counts. The counts in `schema.pin.test.ts` stay manual on purpose – a number that
 *    changed is a reason to look, not something to copy silently.
 *
 * Where the slicer comes from (first match wins):
 *
 *   PRUSASLICER_DOCKER_CONTAINER=e2e          a running container (`docker exec` / `docker cp`)
 *   PRUSASLICER_DOCKER_IMAGE=webslicer:e2e    an image (`docker create`, then `docker cp`)
 *   PRUSASLICER_BIN=/path/to/prusa-slicer     a local installation (profiles auto-detected, or
 *   PRUSASLICER_PROFILES=/path/to/profiles    given explicitly; PRUSASLICER_RESOURCES works too)
 *
 * Exit code 0 = the fixtures are current, 1 = the capture or the pin run failed, 2 = the slicer or its
 * profiles were not found.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OptionDef, PresetType, Schema } from '@webslicer/shared';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DIR = path.join(ROOT, 'server', 'src', 'slicer', 'fixtures');
/** The entry point the image exposes (`PRUSASLICER_BIN` of the Dockerfile). */
const ENTRYPOINT = '/opt/prusaslicer/AppRun';
/** Where the vendor bundle profiles live inside the image. */
const IMAGE_PROFILES = '/opt/prusaslicer/usr/resources/profiles';
const LOCAL_CANDIDATES = [
  '/opt/prusaslicer/AppRun',
  '/opt/prusaslicer/usr/bin/prusa-slicer',
  '/usr/bin/prusa-slicer',
  '/usr/local/bin/prusa-slicer',
];

const CONTAINER = process.env.PRUSASLICER_DOCKER_CONTAINER || '';
const IMAGE = process.env.PRUSASLICER_DOCKER_IMAGE || '';

function die(message: string, code = 2): never {
  console.error(`[pins] ${message}`);
  process.exit(code);
}

function run(command: string, args: string[], what: string): string {
  const res = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 << 20,
    env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' },
  });
  if (res.error) die(`cannot run ${what}: ${res.error.message}`, 1);
  if (res.status !== 0) die(`${what} failed (exit ${res.status}): ${(res.stderr || res.stdout || '').trim().slice(0, 2000)}`, 1);
  return res.stdout;
}

/** A local binary: `PRUSASLICER_BIN`, else the first path that exists, else the bare command. */
function localBinary(): string {
  if (process.env.PRUSASLICER_BIN) return process.env.PRUSASLICER_BIN;
  return LOCAL_CANDIDATES.find((p) => fs.existsSync(p)) || 'prusa-slicer';
}

/** The live help output of the installed slicer. */
function liveHelp(flag: string): string {
  if (CONTAINER) return run('docker', ['exec', CONTAINER, ENTRYPOINT, flag], `docker exec ${CONTAINER} ${ENTRYPOINT} ${flag}`);
  if (IMAGE) return run('docker', ['run', '--rm', '--entrypoint', ENTRYPOINT, IMAGE, flag], `docker run ${IMAGE} ${flag}`);
  const bin = localBinary();
  const res = spawnSync(bin, [flag], {
    encoding: 'utf8',
    maxBuffer: 128 << 20,
    env: { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' },
    windowsHide: true,
  });
  if (res.error) die(`cannot run ${bin}: ${res.error.message}`, 1);
  if (res.status !== 0 && !res.stdout) die(`${bin} ${flag} failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`, 1);
  return res.stdout;
}

/** A directory of `.ini` vendor bundles of the installed slicer. */
function profilesDir(): string {
  if (process.env.PRUSASLICER_PROFILES) return process.env.PRUSASLICER_PROFILES;
  if (process.env.PRUSASLICER_RESOURCES) return path.join(process.env.PRUSASLICER_RESOURCES, 'profiles');
  if (CONTAINER || IMAGE) {
    // `docker cp` is the only way to reach the bundles of the image from here
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-pins-'));
    let container = CONTAINER;
    if (!container) {
      container = `webslicer-pins-${process.pid}`;
      run('docker', ['create', '--name', container, IMAGE], `docker create ${IMAGE}`);
      process.on('exit', () => spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' }));
    }
    run('docker', ['cp', `${container}:${IMAGE_PROFILES}`, tmp], `docker cp ${container}:${IMAGE_PROFILES}`);
    const dir = path.join(tmp, 'profiles');
    if (!fs.existsSync(dir)) die(`the image has no profiles at ${IMAGE_PROFILES}`, 1);
    return dir;
  }
  const bin = localBinary();
  for (const p of [
    path.join(path.dirname(bin), 'usr', 'resources', 'profiles'),
    path.join(path.dirname(bin), 'resources', 'profiles'),
    path.join(path.dirname(bin), '..', 'resources', 'profiles'),
    '/usr/share/PrusaSlicer/profiles',
    '/usr/share/prusa-slicer/profiles',
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return die('no vendor bundles found – set PRUSASLICER_PROFILES', 2);
}

/** The bundle key sets the fixtures store, sorted per preset type (same shape as `bundle-keys.json`). */
async function captureBundleKeys(dir: string): Promise<Record<PresetType, string[]>> {
  // `config` and the bundle cache are evaluated at import time, so the environment is prepared first
  process.env.PRUSASLICER_PROFILES = dir;
  const { loadBundles } = await import('../src/slicer/bundles.js');
  const bundles = loadBundles(true);
  if (!bundles.vendors.length) die(`no vendor bundle could be parsed from ${dir}`, 2);
  const out = {} as Record<PresetType, string[]>;
  for (const [type, keys] of Object.entries(bundles.keys) as Array<[PresetType, Set<string>]>) out[type] = [...keys].sort();
  console.log(`[pins] bundle keys from ${bundles.vendors.length} vendor bundles in ${dir}`);
  return out;
}

/** Read a fixture, `undefined` when it does not exist yet. */
function readFixture(name: string): string | undefined {
  try {
    return fs.readFileSync(path.join(DIR, name), 'utf8');
  } catch {
    return undefined;
  }
}

function readSchemaFixture(): Schema | undefined {
  const text = readFixture('schema.json');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Schema;
  } catch {
    return undefined;
  }
}

/** What changed between the pinned schema and the rebuilt one, in the words of the runbook. */
function summarise(before: Schema | undefined, after: Schema, fffCount: number, slaCount: number): void {
  const oldOptions = before?.options ?? {};
  const newOptions = after.options;
  const added = Object.keys(newOptions)
    .filter((k) => !(k in oldOptions))
    .sort();
  const removed = Object.keys(oldOptions)
    .filter((k) => !(k in newOptions))
    .sort();
  const changed = Object.keys(newOptions)
    .filter((k) => k in oldOptions && (newOptions[k].type !== oldOptions[k].type || newOptions[k].default !== oldOptions[k].default))
    .sort();
  const line = (o: OptionDef) => `${o.key}: ${o.type} = ${JSON.stringify(o.default)}`;
  console.log('');
  console.log(`[pins] schema: ${Object.keys(newOptions).length} options (was ${Object.keys(oldOptions).length})`);
  console.log(`[pins] options added (${added.length}):`);
  for (const k of added) console.log(`  + ${line(newOptions[k])}`);
  console.log(`[pins] options removed (${removed.length}):`);
  for (const k of removed) console.log(`  - ${line(oldOptions[k])}`);
  console.log(`[pins] type or default changed (${changed.length}):`);
  for (const k of changed) {
    const a = oldOptions[k];
    const b = newOptions[k];
    const what = [
      a.type !== b.type ? `type ${a.type} → ${b.type}` : '',
      a.default !== b.default ? `default ${JSON.stringify(a.default)} → ${JSON.stringify(b.default)}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`  ~ ${k}: ${what}`);
  }
  console.log('');
  console.log(`[pins] help parse: ${fffCount} FFF / ${slaCount} SLA options`);
  console.log(`[pins] update the counts in server/src/slicer/schema.pin.test.ts by hand: assert.equal(raw.length, ${fffCount});`);
  console.log(
    `[pins]                                                              assert.equal(parseHelp(helpSla, known).length, ${slaCount});`,
  );
}

const oldFff = readFixture('help-fff.txt');
const oldSla = readFixture('help-sla.txt');
const oldSchema = readSchemaFixture();

const fff = liveHelp('--help-fff');
const sla = liveHelp('--help-sla');
const keys = await captureBundleKeys(profilesDir());

fs.writeFileSync(path.join(DIR, 'help-fff.txt'), fff);
fs.writeFileSync(path.join(DIR, 'help-sla.txt'), sla);
fs.writeFileSync(path.join(DIR, 'bundle-keys.json'), JSON.stringify(keys, null, 2) + '\n');
console.log('[pins] captured help-fff.txt, help-sla.txt, bundle-keys.json');

// The derived pins, through the tests that own them.
const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!fs.existsSync(tsx)) die('tsx is not installed – run `npm ci`', 1);
const pins = spawnSync(
  process.execPath,
  [tsx, '--test', path.join('server', 'src', 'slicer', 'schema.pin.test.ts'), path.join('server', 'src', 'slicer', 'threemf.pin.test.ts')],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, UPDATE_PINS: '1' }, maxBuffer: 128 << 20 },
);
if (pins.status !== 0)
  die(`the UPDATE_PINS run failed (exit ${pins.status}):\n${(pins.stderr || pins.stdout || '').trim().slice(0, 3000)}`, 1);
console.log('[pins] rewrote schema.json and written-3mf.json');

const newSchema = readSchemaFixture();
if (!newSchema) die('schema.json is missing after the UPDATE_PINS run', 1);

// The counts the pin test asserts, counted the way the test counts them.
const { parseHelp } = await import('../src/slicer/help.js');
const known = new Set<string>();
for (const list of Object.values(keys)) for (const k of list) known.add(k);
const fffCount = parseHelp(fff, known).length;
const slaCount = parseHelp(sla, known).length;
summarise(oldSchema, newSchema, fffCount, slaCount);
if (oldFff !== undefined && oldFff === fff && oldSla === sla) console.log('[pins] the help output did not change with this run');
