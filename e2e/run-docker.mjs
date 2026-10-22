/**
 * `npm run e2e:docker` – build the image, start it with a throwaway copy of the fixture data, run the
 * suite against it and shut everything down again.
 *
 * The fixture directories are **copied** to a temp dir per run: the suite may create models, jobs and
 * presets, and nothing of that may land in `e2e/fixtures/` (or in a developer's `data/`). The copy is
 * removed afterwards, so two runs never see each other's state.
 *
 * Options (all optional, environment instead of flags so `npm run` stays simple):
 *   E2E_PORT     host port to publish, default 8080
 *   E2E_IMAGE    image tag, default `webslicer:e2e`
 *   E2E_SKIP_BUILD=1  reuse an existing image (a local iteration shortcut)
 * Anything after `--` goes to `playwright test` (e.g. `npm run e2e:docker -- viewer.spec.ts`).
 */
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.E2E_PORT || 8080);
const IMAGE = process.env.E2E_IMAGE || 'webslicer:e2e';
const CONTAINER = `webslicer-e2e-${process.pid}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-e2e-'));
const DATA = path.join(TMP, 'data');
const LIBRARY = path.join(TMP, 'library');
const passthrough = process.argv.slice(2);

const log = (msg) => console.log(`[e2e] ${msg}`);

/** `docker` with the arguments as an argv, so Windows path conversion cannot touch the mounts. */
function docker(args, opts = {}) {
  return spawnSync('docker', args, { stdio: 'inherit', ...opts });
}

/** `docker run` needs the directory as an absolute path of the host this process runs on. */
const mount = (hostPath, target) => (process.platform === 'win32' ? path.win32.normalize(hostPath) : hostPath) + `:${target}`;

async function health() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function cleanup() {
  docker(['rm', '-f', CONTAINER], { stdio: 'ignore' });
  fs.rmSync(TMP, { recursive: true, force: true });
}

async function main() {
  if (!process.env.E2E_SKIP_BUILD) {
    log(`building ${IMAGE} …`);
    if (docker(['build', '-t', IMAGE, ROOT]).status !== 0) throw new Error('docker build failed');
  } else {
    log(`reusing ${IMAGE} (E2E_SKIP_BUILD)`);
  }

  fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'data'), DATA, { recursive: true });
  fs.mkdirSync(LIBRARY, { recursive: true });

  log(`starting ${CONTAINER} on port ${PORT} …`);
  const run = docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-p',
    `${PORT}:8080`,
    '-v',
    mount(DATA, '/data'),
    '-v',
    mount(LIBRARY, '/library'),
    IMAGE,
  ]);
  if (run.status !== 0) throw new Error('docker run failed');

  // the first start reads the vendor bundles and builds the option schema (~10 s locally)
  for (let i = 0; i < 90; i++) {
    if (await health()) {
      log('the server answers');
      break;
    }
    if (i === 89) throw new Error(`${PORT}/api/health did not answer; docker logs ${CONTAINER}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  log('running the suite …');
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', ...passthrough], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, E2E_BASE_URL: `http://localhost:${PORT}` },
      shell: process.platform === 'win32',
    });
    child.on('close', resolve);
  });
  log(`suite finished in ${Math.round((Date.now() - started) / 1000)} s with exit code ${code}`);
  return Number(code) || 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (e) {
  console.error(`[e2e] ${e.message}`);
  docker(['logs', '--tail', '50', CONTAINER]);
} finally {
  cleanup();
}
process.exit(exitCode);
