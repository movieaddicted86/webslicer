/**
 * q2-slicer-cli, AC-2 and AC-3: one limiter for every PrusaSlicer process, and abort support.
 *
 * The slicer is a tiny Node script (like `jobs.cancel.test.ts`): it appends a line to a mark file
 * when it starts and then sleeps until it is killed, so a test can see exactly how many processes ran
 * at the same time and whether an aborted call ever started one.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-cli-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
// three calls, but only two may run at once (the limiter must wait)
process.env.MAX_CLI_PROCESSES = '2';

/** Every start of the fake CLI goes into this file. */
const MARK = path.join(DATA_DIR, 'starts.txt');
const FAKE = path.join(DATA_DIR, 'fake-slicer.js');
fs.writeFileSync(
  FAKE,
  `require('fs').appendFileSync(${JSON.stringify(MARK)}, 'x\\n');\n` +
    `const ms = Number(process.env.FAKE_SLICER_MS || 400);\n` +
    `setInterval(() => {}, 1000);\n` +
    `setTimeout(() => process.exit(0), ms);\n`,
);
if (process.platform === 'win32') {
  const WRAPPER = path.join(DATA_DIR, 'fake-slicer.cmd');
  fs.writeFileSync(WRAPPER, `@node "${FAKE}" %*\r\n`);
  process.env.PRUSASLICER_BIN = WRAPPER;
} else {
  fs.writeFileSync(FAKE, `#!${process.execPath}\n${fs.readFileSync(FAKE, 'utf8')}`);
  fs.chmodSync(FAKE, 0o755);
  process.env.PRUSASLICER_BIN = FAKE;
}

const { ensureDirs } = await import('../config.js');
const { activeSlicerProcesses, cliProcessLimit, runSlicer, stopRunningSlicers } = await import('./cli.js');

ensureDirs();
after(() => {
  stopRunningSlicers();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

/** How many processes the fake CLI has started so far. */
function starts(): number {
  try {
    return fs.readFileSync(MARK, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(20);
  }
}

test('the limit comes from MAX_CLI_PROCESSES', () => {
  assert.equal(cliProcessLimit(), 2);
});

test('with a limit of 2, a third call waits until one process has finished', async () => {
  fs.rmSync(MARK, { force: true });
  const a = runSlicer([], { timeoutMs: 10_000 });
  const b = runSlicer([], { timeoutMs: 10_000 });
  const c = runSlicer([], { timeoutMs: 10_000 });
  await waitFor(() => starts() === 2, 'the first two processes');
  await sleep(150);
  assert.equal(starts(), 2, 'the third call did not start while two were running');
  assert.equal(activeSlicerProcesses(), 2);
  await Promise.all([a, b]);
  await c;
  assert.equal(starts(), 3, 'the third call started once a slot was free');
  assert.equal(activeSlicerProcesses(), 0, 'every slot was released');
});

test('a call aborted while it waits never starts a process', async () => {
  fs.rmSync(MARK, { force: true });
  const a = runSlicer([], { timeoutMs: 10_000 });
  const b = runSlicer([], { timeoutMs: 10_000 });
  await waitFor(() => starts() === 2, 'the two running processes');
  const controller = new AbortController();
  const waiting = runSlicer([], { signal: controller.signal });
  controller.abort();
  const res = await waiting;
  assert.equal(res.code, null, 'an aborted waiting call resolves as aborted');
  assert.equal(res.signal, 'SIGKILL');
  await Promise.all([a, b]);
  await sleep(150);
  assert.equal(starts(), 2, 'only the two earlier calls ever started');
  assert.equal(activeSlicerProcesses(), 0);
});

test('an already aborted signal starts nothing', async () => {
  fs.rmSync(MARK, { force: true });
  const controller = new AbortController();
  controller.abort();
  const res = await runSlicer([], { signal: controller.signal });
  assert.equal(res.code, null);
  assert.equal(starts(), 0);
});

test('a running call is killed when its signal aborts and frees its slot', async () => {
  fs.rmSync(MARK, { force: true });
  // long enough that a natural exit cannot pass for the abort
  process.env.FAKE_SLICER_MS = '5000';
  const before = Date.now();
  try {
    const controller = new AbortController();
    const running = runSlicer([], { signal: controller.signal, timeoutMs: 10_000 });
    await waitFor(() => starts() === 1, 'the process to start');
    controller.abort();
    const res = await running;
    // the platform decides the shape: SIGKILL on POSIX, an exit code through the Windows wrapper
    assert.ok(res.signal === 'SIGKILL' || res.code === 0 || res.code === 1, `killed: code ${res.code}, signal ${res.signal}`);
    assert.ok(Date.now() - before < 4000, 'the process ended by the abort, not by its own timer');
    assert.equal(activeSlicerProcesses(), 0, 'the slot came back');
    // and the next call runs right away (no leaked slot)
    const again = runSlicer([], { timeoutMs: 10_000 });
    await waitFor(() => starts() === 2, 'the next process to start');
    stopRunningSlicers();
    await again;
  } finally {
    process.env.FAKE_SLICER_MS = '400';
  }
});

test('stopRunningSlicers ends a running process and empties the wait queue (shutdown, AC-4)', async () => {
  fs.rmSync(MARK, { force: true });
  const a = runSlicer([], { timeoutMs: 10_000 });
  const b = runSlicer([], { timeoutMs: 10_000 });
  const c = runSlicer([], { timeoutMs: 10_000 });
  await waitFor(() => starts() === 2, 'the two running processes');
  stopRunningSlicers();
  await Promise.all([a, b, c]);
  await sleep(150);
  assert.equal(starts(), 2, 'the waiting call was not started');
  assert.equal(activeSlicerProcesses(), 0, 'every slot was released');
});
