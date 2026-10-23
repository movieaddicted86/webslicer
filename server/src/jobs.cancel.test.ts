/**
 * B6: a job could not be cancelled while it was still preparing (the AbortController only existed
 * once the CLI was spawned, so `POST /cancel` answered 404 and the job sliced on), and deleting a
 * running job removed the directory underneath the running process. A cancel now works in every
 * stage, the CLI is never spawned after an early cancel, the temporary inputs are removed, and a
 * delete waits for the run to stop writing.
 *
 * The slicer binary is a tiny Node script that writes a progress line and then keeps running, so the
 * test drives the real queue, the real `runSlicer` and the real files without PrusaSlicer.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-cancel-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');

/** A fake slicer: reports progress, then sleeps until it is killed. */
const MARK = path.join(DATA_DIR, 'spawned.txt');
const FAKE = path.join(DATA_DIR, process.platform === 'win32' ? 'fake-slicer.js' : 'fake-slicer.sh');
if (process.platform === 'win32') {
  fs.writeFileSync(
    FAKE,
    `require('fs').appendFileSync(${JSON.stringify(MARK)}, 'x');\n` +
      `process.stdout.write('1 => Preparing\\n');\n` +
      `setInterval(() => process.stdout.write('50 => Slicing\\n'), 50);\n`,
  );
  // a .js file cannot be spawned directly on Windows; a command wrapper is the portable way
  const WRAPPER = path.join(DATA_DIR, 'fake-slicer.cmd');
  fs.writeFileSync(WRAPPER, `@node "${FAKE}" %*\r\n`);
  process.env.PRUSASLICER_BIN = WRAPPER;
} else {
  fs.writeFileSync(FAKE, `#!/bin/sh\necho x >> "${MARK}"\nwhile true; do echo '50 => Slicing'; sleep 0.05; done\n`);
  fs.chmodSync(FAKE, 0o755);
  process.env.PRUSASLICER_BIN = FAKE;
}

const { config, ensureDirs } = await import('./config.js');
const { createJob, cancelJob, deleteJob, getJob, setSchema, subscribe } = await import('./jobs.js');
const { loadJobRecords } = await import('./jobs/persistence.js');
const { parseStl, writeBinaryStl } = await import('./slicer/threemf/mesh.js');
const { IDENTITY } = await import('@webslicer/shared');
import type { SliceRequest } from '@webslicer/shared';

const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {},
} as never;

/** A minimal binary STL: two triangles that make a readable mesh. */
function stlCube(): Buffer {
  return writeBinaryStl({
    vertices: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
    indices: Uint32Array.from([0, 1, 2, 0, 3, 2]),
  });
}

function request(modelId: string): SliceRequest {
  return {
    objects: [{ modelId, name: 'cube', transform: [...IDENTITY] }],
    print: { name: 'p', config: {} },
    printer: { name: 'pr', config: {} },
    filaments: [],
    outputName: 'cube',
  } as SliceRequest;
}

async function waitFor(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(() => {
  ensureDirs();
  setSchema(SCHEMA);
  const modelId = '11111111-1111-1111-1111-111111111111';
  fs.mkdirSync(config.modelsDir, { recursive: true });
  fs.writeFileSync(path.join(config.modelsDir, `${modelId}.stl`), stlCube());
  assert.ok(parseStl(fs.readFileSync(path.join(config.modelsDir, `${modelId}.stl`))), 'the fixture is a readable STL');
});
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('B6: a cancel while the job is preparing ends it cancelled and never spawns the slicer', async () => {
  fs.rmSync(MARK, { force: true });
  const job = await createJob(request('11111111-1111-1111-1111-111111111111'), SCHEMA);
  assert.equal(job.status, 'queued', 'the listener attaches before the queue starts the job');

  // The cancel has to land *while* the run prepares, and polling `job.status` never bought that: the
  // first 20 ms tick is already past the spawn on a fast runner (CI), while on Windows the mark file
  // of the fake CLI appears only after the child has booted – so the old wait tested the timing of
  // this machine, not the queue. The job's own event removes the race: `runJob` emits `running`
  // before the config and the 3MF are written and long before the AbortController exists, and this
  // listener runs synchronously inside that emit.
  let sawRunning = false;
  let cancelAccepted = false;
  let markAtCancel = true;
  let sawCancelled = false;
  const off = subscribe(job.id, (ev) => {
    if (ev.type !== 'status') return;
    if (!sawRunning) {
      sawRunning = true;
      markAtCancel = fs.existsSync(MARK);
      cancelAccepted = cancelJob(job.id);
      return;
    }
    if (ev.job?.status === 'cancelled') sawCancelled = true;
  });

  // wait on the job's own event only – the disk write of the record happens before that emit
  await waitFor(() => sawCancelled, 'the cancelled status');
  off();

  assert.equal(sawRunning, true, 'the run reached the preparing stage, so this is the early-cancel path');
  assert.equal(cancelAccepted, true, 'a preparing job is cancellable');
  assert.equal(markAtCancel, false, 'the cancel arrived before the CLI was started');
  assert.equal(job.message, 'Cancelled');
  assert.equal(fs.existsSync(MARK), false, 'the CLI was not started for a job cancelled during preparation');
  assert.equal(fs.existsSync(path.join(config.jobsDir, job.id, 'config.ini')), false, 'the temporary config was removed');
  assert.equal(fs.existsSync(path.join(config.jobsDir, job.id, 'model.3mf')), false, 'the temporary 3MF was removed');
  const stored = (await loadJobRecords()).find((j) => j.id === job.id);
  assert.equal(stored?.status, 'cancelled', 'the record on disk says cancelled, so a restart does not resurrect it');
});

test('B6: a cancel of a running job kills the CLI and removes the temporary files', async () => {
  fs.rmSync(MARK, { force: true });
  const job = await createJob(request('11111111-1111-1111-1111-111111111111'), SCHEMA);
  await waitFor(() => fs.existsSync(MARK), 'the fake slicer to start');
  assert.equal(cancelJob(job.id), true);
  await waitFor(() => job.status === 'cancelled', 'the cancelled status');
  assert.equal(fs.existsSync(path.join(config.jobsDir, job.id, 'config.ini')), false);
  assert.equal(fs.existsSync(path.join(config.jobsDir, job.id, 'model.3mf')), false);
  // the process really is gone: no further progress lines arrive
  const percent = job.percent;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(job.percent, percent, 'the killed CLI wrote nothing more');
  assert.equal(job.finishedAt !== undefined, true);
});

test('B6: deleting a running job waits for the run and leaves no directory behind', async () => {
  fs.rmSync(MARK, { force: true });
  const job = await createJob(request('11111111-1111-1111-1111-111111111111'), SCHEMA);
  await waitFor(() => fs.existsSync(MARK), 'the fake slicer to start');
  assert.equal(await deleteJob(job.id), true);
  assert.equal(getJob(job.id), undefined, 'the job is gone from the list');
  assert.equal(fs.existsSync(path.join(config.jobsDir, job.id)), false, 'and so is its directory');
  assert.equal(job.status === 'cancelled' || job.status === 'running', true, 'it was stopped, not completed');
});
