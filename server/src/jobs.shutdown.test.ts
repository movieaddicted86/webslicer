/**
 * W5: a clean stop. SIGTERM (Docker, Proxmox) used to kill the process with a slicer still running;
 * `shutdownJobs` refuses new work, ends the queued and running jobs through the normal cancel path
 * (temporary inputs removed, record saved as cancelled) and only resolves once the runners are gone.
 *
 * Like `jobs.cancel.test.ts` this drives the real queue with a fake slicer binary.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-shutdown-'));
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
  const WRAPPER = path.join(DATA_DIR, 'fake-slicer.cmd');
  fs.writeFileSync(WRAPPER, `@node "${FAKE}" %*\r\n`);
  process.env.PRUSASLICER_BIN = WRAPPER;
} else {
  fs.writeFileSync(FAKE, `#!/bin/sh\necho x >> "${MARK}"\nwhile true; do echo '50 => Slicing'; sleep 0.05; done\n`);
  fs.chmodSync(FAKE, 0o755);
  process.env.PRUSASLICER_BIN = FAKE;
}

const { config, ensureDirs } = await import('./config.js');
const { createJob, getJob, setSchema, shutdownJobs } = await import('./jobs.js');
const { loadJobRecords } = await import('./jobs/persistence.js');
const { writeBinaryStl } = await import('./slicer/threemf/mesh.js');
const { IDENTITY } = await import('@webslicer/shared');
import type { SliceRequest } from '@webslicer/shared';

const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {},
} as never;

const MODEL_ID = '11111111-1111-1111-1111-111111111111';

function request(): SliceRequest {
  return {
    objects: [{ modelId: MODEL_ID, name: 'cube', transform: [...IDENTITY] }],
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
  fs.mkdirSync(config.modelsDir, { recursive: true });
  fs.writeFileSync(
    path.join(config.modelsDir, `${MODEL_ID}.stl`),
    writeBinaryStl({
      vertices: Float32Array.from([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0]),
      indices: Uint32Array.from([0, 1, 2, 0, 3, 2]),
    }),
  );
});
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('W5: a shutdown cancels the queued job and waits for the running one to stop', async () => {
  fs.rmSync(MARK, { force: true });
  process.env.MAX_JOBS = '1';
  const runningJob = await createJob(request(), SCHEMA);
  await waitFor(() => fs.existsSync(MARK), 'the fake slicer to start');
  const queuedJob = await createJob(request(), SCHEMA);
  assert.equal(queuedJob.status, 'queued', 'the second job waits behind the first');

  await shutdownJobs();

  assert.equal(queuedJob.status, 'cancelled', 'a queued job ends cancelled');
  assert.equal(queuedJob.message, 'Server shutdown');
  assert.equal(runningJob.status, 'cancelled', 'the running job was aborted');
  assert.equal(fs.existsSync(path.join(config.jobsDir, runningJob.id, 'config.ini')), false, 'the temporary config is gone');
  assert.equal(fs.existsSync(path.join(config.jobsDir, runningJob.id, 'model.3mf')), false, 'the temporary 3MF is gone');
  const stored = (await loadJobRecords()).find((j) => j.id === queuedJob.id);
  assert.equal(stored?.status, 'cancelled', 'the queued record on disk says cancelled');

  // no work is accepted after the shutdown started
  await assert.rejects(() => createJob(request(), SCHEMA), /shutting down/);
  assert.equal(getJob(runningJob.id)?.status, 'cancelled');
});
