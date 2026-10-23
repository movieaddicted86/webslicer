/**
 * T-009: STEP conversion through the slicer CLI.
 *
 * The CLI itself is mocked (`SlicerRunner`), so these tests pin the contract around it: the output
 * is returned as bytes, a failing run becomes a 400 with the first relevant log line, a timeout is
 * reported as such, and no temp file or directory survives any of the paths.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-step-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
// a small output limit, so the size guard (q2-slicer-cli) can be tested with a tiny file
process.env.MAX_UPLOAD_BYTES = '4096';

const { config, ensureDirs } = await import('../config.js');
const { convertStep, convertStepFile, isStepFile, stepTimeoutMs } = await import('./step.js');
const { failureLine } = await import('./cli.js');
const { HttpError } = await import('../errors.js');
import type { SlicerRunner } from './step.js';

/** A tiny binary STL (two triangles) that the fake CLI "converts" to. */
function stlBytes(): Buffer {
  const n = 2;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('converted', 0, 'latin1');
  buf.writeUInt32LE(n, 80);
  return buf;
}

/** A runner that writes `bytes` to the `--output` argument and answers `code`. */
function fakeRun(bytes: Buffer | undefined, code = 0, stderr = ''): SlicerRunner {
  return async (args) => {
    const out = args[args.indexOf('--output') + 1] as string;
    if (bytes) fs.writeFileSync(out, bytes);
    return { code, stdout: '', stderr, signal: null };
  };
}

/** Everything left in the conversion cache – the temp dirs the module created. */
function leftovers(): string[] {
  try {
    return fs.readdirSync(path.join(config.cacheDir, 'step'));
  } catch {
    return [];
  }
}

ensureDirs();
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('a STEP file is converted and the STL bytes are returned', async () => {
  const stl = await convertStep(Buffer.from('ISO-10303-21;'), 'cube.step', { run: fakeRun(stlBytes()) });
  assert.deepEqual(stl, stlBytes());
  assert.deepEqual(leftovers(), [], 'the temp directory was removed');
});

test('a failing CLI run is a 400 naming the first relevant log line', async () => {
  const err = await convertStep(Buffer.from('broken'), 'cube.stp', {
    run: fakeRun(undefined, 1, '\u001b[31;1m**** ERR StepFile : Undefined Parsing: Line 6: Incorrect syntax ****\u001b[0m\n'),
  }).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(err instanceof HttpError, 'the conversion failed with a typed error');
  assert.equal(err.status, 400);
  assert.match(err.message, /Undefined Parsing/);
  assert.ok(!err.message.includes(String.fromCharCode(27)), 'the colour escapes of the CLI are stripped');
  assert.deepEqual(leftovers(), [], 'nothing is left behind after a failed conversion');
});

test('a run that exits 0 without writing a file is still a 400', async () => {
  await assert.rejects(
    convertStep(Buffer.from('x'), 'cube.step', { run: fakeRun(undefined, 0) }),
    (e: Error) => e instanceof HttpError && e.status === 400,
  );
  assert.deepEqual(leftovers(), []);
});

test('a killed run (the timeout) says so instead of leaking the signal', async () => {
  const timeoutMs = 120_000;
  const res = { code: null, stdout: '', stderr: '', signal: 'SIGKILL' as const };
  assert.match(failureLine(res, timeoutMs), /timed out after 120 s/);
  const err = await convertStep(Buffer.from('x'), 'cube.step', {
    run: async () => res,
    timeoutMs,
  }).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(err instanceof HttpError);
  assert.match(err.message, /timed out after 120 s/);
  assert.deepEqual(leftovers(), []);
});

test('the input keeps the extension of the file name: the CLI goes by it', async () => {
  let seen = '';
  await convertStep(Buffer.from('x'), 'Part.STP', {
    run: async (args) => {
      seen = args[args.length - 1] as string;
      const out = args[args.indexOf('--output') + 1] as string;
      fs.writeFileSync(out, stlBytes());
      return { code: 0, stdout: '', stderr: '', signal: null };
    },
  });
  // the CLI refuses a file without `.step`/`.stp` ("Unknown file format"), whatever its content
  assert.equal(path.extname(seen), '.stp');
});

test('a non-STEP name is refused before anything is written', async () => {
  await assert.rejects(convertStep(Buffer.from('x'), 'cube.stl'), (e: Error) => e instanceof HttpError && e.status === 400);
  assert.equal(isStepFile('a.step'), true);
  assert.equal(isStepFile('a.STP'), true);
  assert.equal(isStepFile('a.stl'), false);
  assert.equal(stepTimeoutMs(), 120_000);
});

test('a converted model larger than MAX_UPLOAD_BYTES is a 400 instead of an unbounded read', async () => {
  const err = await convertStep(Buffer.from('x'), 'huge.step', { run: fakeRun(Buffer.alloc(5000)) }).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 400);
  assert.match(err.message, /larger than the allowed size of 4096 bytes/);
  assert.deepEqual(leftovers(), [], 'the temp directory was removed');
});

test('a 400 never carries the absolute temp path of the conversion (AC-6)', async () => {
  const err = await convertStep(Buffer.from('x'), 'cube.step', {
    run: async (args) => ({ code: 1, stdout: '', stderr: `ERR cannot open ${args[args.length - 1]}`, signal: null }),
  }).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(err instanceof HttpError);
  assert.match(err.message, /<tmp>[/\\]input\.step/);
  assert.ok(!err.message.includes(DATA_DIR), 'the data directory path is masked');
});

test('an existing work directory is used and survives; only the output file is removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-step-work-'));
  const keep = path.join(dir, 'keep.txt');
  fs.writeFileSync(keep, 'x');
  const stl = await convertStepFile(path.join(dir, 'in.step'), { workDir: dir, run: fakeRun(stlBytes()) });
  assert.deepEqual(stl, stlBytes());
  assert.deepEqual(fs.readdirSync(dir), ['keep.txt'], 'the output file is gone, the caller-owned directory is untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});
