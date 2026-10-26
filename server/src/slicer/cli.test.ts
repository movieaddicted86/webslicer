/**
 * q2-slicer-cli, AC-2 and AC-3: one limiter for every PrusaSlicer process, and abort support.
 *
 * The slicer is a tiny Node script (like `jobs.cancel.test.ts`): it appends a line to a mark file
 * when it starts and then **waits for a release file**, so a test can see exactly how many processes
 * ran at the same time and whether an aborted call ever started one.
 *
 * Nothing here is timed (T-089): the fake CLI never exits on its own, so a process that ends did so
 * because the code under test killed it. The handshake the tests use instead of sleeps is
 * `waitFor(<state>, …)` – a file line for a start, `activeSlicerProcesses()` for a freed slot – and
 * the release file for "let the running calls finish". A slow machine therefore only makes a wait
 * longer, never flaky.
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
/** While this file exists, every fake CLI exits; without it they keep running. */
const RELEASE = path.join(DATA_DIR, 'release');
const FAKE = path.join(DATA_DIR, 'fake-slicer.js');
fs.writeFileSync(
  FAKE,
  `const fs = require('fs');\n` +
    `fs.appendFileSync(${JSON.stringify(MARK)}, 'x\\n');\n` +
    // the only way out: the release file. No timer, so "the process is still running" is a fact, not
    // a bet on a duration.
    `const poll = setInterval(() => {\n` +
    `  if (fs.existsSync(${JSON.stringify(RELEASE)})) { clearInterval(poll); process.exit(0); }\n` +
    `}, 10);\n`,
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

/** Let every running fake CLI exit (the tests that need one still running never create the file). */
function release(): void {
  fs.writeFileSync(RELEASE, '');
}

/** Keep the fake CLIs alive: they only end when the release file appears. */
function hold(): void {
  fs.rmSync(RELEASE, { force: true });
}

/** An empty start file for one test. */
function resetStarts(): void {
  hold();
  fs.rmSync(MARK, { force: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until a condition holds. The timeout is only a backstop against a real hang – under load the
 * condition may take seconds, and waiting longer never changes the outcome.
 */
async function waitFor(cond: () => boolean, what: string, ms = 60_000): Promise<void> {
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
  resetStarts();
  const a = runSlicer([], { timeoutMs: 60_000 });
  const b = runSlicer([], { timeoutMs: 60_000 });
  const c = runSlicer([], { timeoutMs: 60_000 });
  await waitFor(() => starts() === 2, 'the first two processes');
  // the running processes cannot end on their own, so the third call has to keep waiting
  assert.equal(starts(), 2, 'the third call did not start while two were running');
  assert.equal(activeSlicerProcesses(), 2);
  release();
  await Promise.all([a, b]);
  await c;
  assert.equal(starts(), 3, 'the third call started once a slot was free');
  assert.equal(activeSlicerProcesses(), 0, 'every slot was released');
});

test('a call aborted while it waits never starts a process', async () => {
  resetStarts();
  const a = runSlicer([], { timeoutMs: 60_000 });
  const b = runSlicer([], { timeoutMs: 60_000 });
  await waitFor(() => starts() === 2, 'the two running processes');
  const controller = new AbortController();
  const waiting = runSlicer([], { signal: controller.signal });
  controller.abort();
  const res = await waiting;
  assert.equal(res.code, null, 'an aborted waiting call resolves as aborted');
  assert.equal(res.signal, 'SIGKILL');
  // let the two running calls end: their freed slots must not reach the aborted waiter
  release();
  await Promise.all([a, b]);
  await waitFor(() => activeSlicerProcesses() === 0, 'the slots back');
  assert.equal(starts(), 2, 'only the two earlier calls ever started');
});

test('an already aborted signal starts nothing', async () => {
  resetStarts();
  const controller = new AbortController();
  controller.abort();
  const res = await runSlicer([], { signal: controller.signal });
  assert.equal(res.code, null);
  assert.equal(starts(), 0);
});

test('a running call is killed when its signal aborts and frees its slot', async () => {
  resetStarts();
  const controller = new AbortController();
  const running = runSlicer([], { signal: controller.signal, timeoutMs: 60_000 });
  await waitFor(() => starts() === 1, 'the process to start');
  controller.abort();
  const res = await running;
  // the platform decides the shape: SIGKILL on POSIX, an exit code through the Windows wrapper
  assert.ok(res.signal === 'SIGKILL' || res.code === 0 || res.code === 1, `killed: code ${res.code}, signal ${res.signal}`);
  // the fake CLI only ends when the release file appears, which no test wrote: the abort ended it
  assert.equal(fs.existsSync(RELEASE), false, 'the process cannot have ended by itself');
  assert.equal(activeSlicerProcesses(), 0, 'the slot came back');
  // and the next call runs right away (no leaked slot)
  const again = runSlicer([], { timeoutMs: 60_000 });
  await waitFor(() => starts() === 2, 'the next process to start');
  stopRunningSlicers();
  await again;
});

test('stopRunningSlicers ends a running process and empties the wait queue (shutdown, AC-4)', async () => {
  resetStarts();
  const a = runSlicer([], { timeoutMs: 60_000 });
  const b = runSlicer([], { timeoutMs: 60_000 });
  const c = runSlicer([], { timeoutMs: 60_000 });
  await waitFor(() => starts() === 2, 'the two running processes');
  stopRunningSlicers();
  await Promise.all([a, b, c]);
  await sleep(50);
  assert.equal(starts(), 2, 'the waiting call was not started');
  assert.equal(activeSlicerProcesses(), 0, 'every slot was released');
});
