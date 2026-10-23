/**
 * `npm run e2e:docker` – build the image, start it with a throwaway copy of the fixture data, run the
 * suite against it and shut everything down again.
 *
 * The fixture directories are **copied** to a temp dir per run: the suite may create models, jobs and
 * presets, and nothing of that may land in `e2e/fixtures/` (or in a developer's `data/`). The copy is
 * removed afterwards, so two runs never see each other's state.
 *
 * The send tests upload to a **mock print host** (`e2e/mock-host`): a second container on a private
 * network with the app, reachable by name, with no published port – a real printer is never involved.
 * Its log lives in the temp dir, which is mounted into both containers (`/mock-data` in the mock,
 * `/e2e-mock` in the app is not needed – only the test process reads it).
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
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.E2E_PORT || 8080);
const IMAGE = process.env.E2E_IMAGE || 'webslicer:e2e';
const MOCK_IMAGE = process.env.E2E_MOCK_IMAGE || 'webslicer-mock-host:e2e';
const CONTAINER = `webslicer-e2e-${process.pid}`;
const MOCK = `webslicer-e2e-mock-${process.pid}`;
const NETWORK = `webslicer-e2e-net-${process.pid}`;
/** The name the app container dials, and the port the mock listens on. */
const MOCK_HOST = 'mock-host';
const MOCK_PORT = 8160;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-e2e-'));
const DATA = path.join(TMP, 'data');
const LIBRARY = path.join(TMP, 'library');
const MOCK_DATA = path.join(TMP, 'mock');
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

/**
 * Port 8080 is taken on many machines (a dev server, an earlier run). With `E2E_PORT` unset the
 * runner takes the first free port from 8080 on, so a run never collides with something it did not
 * start.
 */
async function freePort(start) {
  for (let port = start; port < start + 40; port++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`no free port from ${start} on`);
}

function cleanup() {
  docker(['rm', '-f', CONTAINER], { stdio: 'ignore' });
  docker(['rm', '-f', MOCK], { stdio: 'ignore' });
  docker(['network', 'rm', NETWORK], { stdio: 'ignore' });
  fs.rmSync(TMP, { recursive: true, force: true });
}

/** Start the mock print host: its own image, on the private network only. */
function startMockHost() {
  log(`building ${MOCK_IMAGE} …`);
  if (docker(['build', '-t', MOCK_IMAGE, path.join(ROOT, 'e2e', 'mock-host')]).status !== 0)
    throw new Error('docker build of the mock host failed');
  fs.mkdirSync(MOCK_DATA, { recursive: true });
  log(`starting ${MOCK} …`);
  const run = spawnSync(
    'docker',
    ['run', '-d', '--name', MOCK, '--network', NETWORK, '--network-alias', MOCK_HOST, '-v', mount(MOCK_DATA, '/mock-data'), MOCK_IMAGE],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) throw new Error('docker run of the mock host failed');
}

async function main() {
  if (!process.env.E2E_SKIP_BUILD) {
    log(`building ${IMAGE} …`);
    if (docker(['build', '-t', IMAGE, ROOT]).status !== 0) throw new Error('docker build failed');
  } else {
    log(`reusing ${IMAGE} (E2E_SKIP_BUILD)`);
  }

  if (docker(['network', 'create', NETWORK]).status !== 0) throw new Error('docker network create failed');
  startMockHost();

  fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'data'), DATA, { recursive: true });
  fs.mkdirSync(LIBRARY, { recursive: true });

  const port = process.env.E2E_PORT ? PORT : await freePort(PORT);
  log(`starting ${CONTAINER} on port ${port} …`);
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      CONTAINER,
      '--network',
      NETWORK,
      '-p',
      `${port}:8080`,
      '-v',
      mount(DATA, '/data'),
      '-v',
      mount(LIBRARY, '/library'),
      // T-058: the suite must not depend on GitHub (or wait for the delayed first check); the notice
      // itself is covered by `update.spec.ts` with an intercepted endpoint
      '-e',
      'WEBSLICER_UPDATE_CHECK=off',
      IMAGE,
    ],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) throw new Error('docker run failed');

  // the first start reads the vendor bundles and builds the option schema (~10 s locally)
  for (let i = 0; i < 90; i++) {
    if (await health()) {
      log('the server answers');
      break;
    }
    if (i === 89) throw new Error(`${port}/api/health did not answer; docker logs ${CONTAINER}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  log('running the suite …');
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', ...passthrough], {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_BASE_URL: `http://localhost:${port}`,
        // the address as the app container sees the mock, and the log dir on this machine
        E2E_MOCK_URL: `http://${MOCK_HOST}:${MOCK_PORT}`,
        E2E_MOCK_DIR: MOCK_DATA,
      },
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
  docker(['logs', '--tail', '50', MOCK]);
} finally {
  cleanup();
}
process.exit(exitCode);
