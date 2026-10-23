/**
 * `npm run help-diff` – does the slicer in the image still produce the help output the fixtures hold?
 *
 * The fixtures in `server/src/slicer/fixtures/` are captured from one PrusaSlicer version. A version
 * bump in the Dockerfile without regenerating them leaves the schema and the pin tests describing the
 * old binary, and nothing would notice: the server starts, the pin tests pass (they read the
 * fixtures), and only a user would see the new options missing. This script reads the help output of
 * the *installed* binary and compares it byte for byte (line ends and ANSI colours normalised) with
 * the checked-in `help-fff.txt` / `help-sla.txt`.
 *
 * Usage (repository root):
 *
 *   PRUSASLICER_DOCKER_CONTAINER=e2e npm run help-diff      # docker exec into a running container
 *   PRUSASLICER_DOCKER_IMAGE=webslicer:e2e npm run help-diff # docker run --rm against an image
 *   PRUSASLICER_BIN=/path/to/prusa-slicer npm run help-diff  # a local installation
 *
 * Without an environment variable the binary is looked up where `server/src/config.ts` looks
 * (`/opt/prusaslicer/AppRun`, `/usr/bin/prusa-slicer`, …). Exit code 0 = the fixtures match,
 * 1 = they differ (the diff summary names the line), 2 = no help output could be read.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseHelp } from '../src/slicer/help.js';

const DIR = path.join(import.meta.dirname, '..', 'src', 'slicer', 'fixtures');
/** The entry point the image exposes (`PRUSASLICER_BIN` of the Dockerfile). */
const ENTRYPOINT = '/opt/prusaslicer/AppRun';
const LOCAL_CANDIDATES = [
  '/opt/prusaslicer/AppRun',
  '/opt/prusaslicer/usr/bin/prusa-slicer',
  '/usr/bin/prusa-slicer',
  '/usr/local/bin/prusa-slicer',
];

const CONTAINER = process.env.PRUSASLICER_DOCKER_CONTAINER || '';
const IMAGE = process.env.PRUSASLICER_DOCKER_IMAGE || '';

interface Tech {
  name: 'fff' | 'sla';
  flag: string;
  fixture: string;
}

const TECHNOLOGIES: Tech[] = [
  { name: 'fff', flag: '--help-fff', fixture: 'help-fff.txt' },
  { name: 'sla', flag: '--help-sla', fixture: 'help-sla.txt' },
];

function fail(message: string): never {
  console.error(`[help-diff] ${message}`);
  process.exit(2);
}

/** A local binary: `PRUSASLICER_BIN`, else the first path that exists, else the bare command. */
function localBinary(): string {
  if (process.env.PRUSASLICER_BIN) return process.env.PRUSASLICER_BIN;
  return LOCAL_CANDIDATES.find((p) => fs.existsSync(p)) || 'prusa-slicer';
}

/** The live help output of the installed slicer, from the container, the image or a local binary. */
function liveHelp(flag: string): string {
  if (CONTAINER) {
    const res = spawnSync('docker', ['exec', CONTAINER, ENTRYPOINT, flag], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (res.status !== 0)
      fail(`docker exec ${CONTAINER} ${ENTRYPOINT} ${flag} failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`);
    return res.stdout;
  }
  if (IMAGE) {
    const res = spawnSync('docker', ['run', '--rm', '--entrypoint', ENTRYPOINT, IMAGE, flag], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (res.status !== 0) fail(`docker run ${IMAGE} ${flag} failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`);
    return res.stdout;
  }
  const bin = localBinary();
  const env = { ...process.env, DISPLAY: '', WAYLAND_DISPLAY: '' };
  const res = spawnSync(bin, [flag], { encoding: 'utf8', maxBuffer: 64 << 20, env, windowsHide: true });
  if (res.error) fail(`cannot run ${bin}: ${res.error.message}`);
  if (res.status !== 0 && !res.stdout) fail(`${bin} ${flag} failed: ${(res.stderr || '').trim() || `exit ${res.status}`}`);
  return res.stdout;
}

/** Drop colour escapes and normalise line ends – the fixture is compared as text, not as bytes. */
function normalize(text: string): string {
  const esc = String.fromCharCode(27);
  return text
    .replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '');
}

/** The key set of the fixtures, used only to print an option count the way the pin test counts. */
function fixtureKeys(): Set<string> | undefined {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(DIR, 'bundle-keys.json'), 'utf8')) as Record<string, string[]>;
    const all = new Set<string>();
    for (const list of Object.values(json)) for (const k of list) all.add(k);
    return all;
  } catch {
    return undefined;
  }
}

/** First differing line of two multi-line texts, as a readable sentence. */
function firstDifference(live: string[], pinned: string[]): string {
  const at = live.findIndex((line, i) => line !== pinned[i]);
  const index = at < 0 ? Math.min(live.length, pinned.length) : at;
  return (
    `first difference at line ${index + 1}: ${live.length} live lines, ${pinned.length} fixture lines\n` +
    `  live:    ${live[index] ?? '<end of output>'}\n  fixture: ${pinned[index] ?? '<end of fixture>'}`
  );
}

const known = fixtureKeys();
let differences = 0;
for (const tech of TECHNOLOGIES) {
  const fixturePath = path.join(DIR, tech.fixture);
  if (!fs.existsSync(fixturePath)) fail(`fixture ${tech.fixture} is missing`);
  const live = normalize(liveHelp(tech.flag)).split('\n');
  const pinned = normalize(fs.readFileSync(fixturePath, 'utf8')).split('\n');
  const liveCount = parseHelp(live.join('\n'), known).length;
  const pinnedCount = parseHelp(pinned.join('\n'), known).length;
  if (live.join('\n') === pinned.join('\n')) {
    console.log(`[help-diff] ${tech.flag}: identical to ${tech.fixture} (${liveCount} options)`);
    continue;
  }
  differences++;
  console.error(`[help-diff] ${tech.flag}: differs from ${tech.fixture} (${liveCount} live options, ${pinnedCount} in the fixture)`);
  console.error(`[help-diff] ${firstDifference(live, pinned)}`);
}

if (differences) {
  console.error(
    '[help-diff] the image ships a different PrusaSlicer than the fixtures were captured from –' +
      ' run `npm run pins:update` and commit the fixtures (docs/PrusaSlicer-Upgrade.md)',
  );
  process.exit(1);
}
console.log('[help-diff] the slicer help matches the pinned fixtures');
