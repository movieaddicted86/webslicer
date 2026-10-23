/**
 * The hand-over from "sliced" to "done" (S1-c, T-031): the preflight scan of the finished file is
 * awaited, so it yields the event loop – a reader of the job record (the job list, `GET
 * /api/jobs/:id`, a send) can come in while it runs. It must never find `status: 'done'` with no
 * `info.preflight`: the send gate would scan the file a second time, and the preview would show a
 * finished job without its findings. The scan therefore runs **before** the status is set.
 *
 * The pin reads the record at every timer tick of the scan, so a future reordering fails here even
 * though the scan itself is green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JobRecord } from '@webslicer/shared';
import { PREFLIGHT_VERSION } from '@webslicer/shared';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-jobs-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');

const { completeJob, failureMessage } = await import('./jobs.js');

test.after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

/** A ~20 MB G-code so the scan takes long enough for the timer to look into the record. */
function bigOutput(): { file: string; size: number } {
  const dir = path.join(DATA_DIR, 'job-1');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'part.gcode');
  const line = 'G1 X12.345 Y67.890 E0.01234\n';
  fs.writeFileSync(file, line.repeat(Math.ceil((20 * 1024 * 1024) / line.length)));
  return { file, size: fs.statSync(file).size };
}

function runningJob(): JobRecord {
  return {
    id: 'job-1',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    percent: 99,
    message: 'Slicing',
    outputName: 'part.gcode',
    technology: 'FFF',
    presets: { print: '0.20mm SPEED', filaments: ['Prusament PLA'], printer: 'Original Prusa MK4S HF0.4 nozzle' },
    objectNames: ['cube'],
  };
}

test('a job that is read while its file is being scanned is never done without its info', async () => {
  const { file, size } = bigOutput();
  const job = runningJob();

  let samples = 0;
  let doneWithoutInfo = 0;
  let doneBeforeEnd = 0;
  const timer = setInterval(() => {
    samples++;
    if (job.status === 'done' && !job.info) doneWithoutInfo++;
    if (job.status === 'done') doneBeforeEnd++;
  }, 1);

  const completing = completeJob(job, file, ['a warning'], { machine_max_feedrate_x: '200,100' });
  await completing;
  clearInterval(timer);

  assert.ok(size > 15 * 1024 * 1024, `the fixture is ${size} bytes`);
  assert.ok(samples > 20, `the record was read ${samples} times during the scan`);
  assert.equal(doneWithoutInfo, 0, `a reader saw "done" without info in ${doneWithoutInfo} of ${samples} reads`);
  assert.equal(doneBeforeEnd, 0, 'the status was still "running" – so the scan really did run first');
  assert.equal(job.status, 'done');
  assert.equal(job.percent, 100);
  assert.equal(job.message, 'Done');
  assert.equal(job.info?.sizeBytes, size);
  assert.deepEqual(job.info?.warnings, ['a warning']);
  assert.equal(job.info?.preflight?.version, PREFLIGHT_VERSION);
  assert.deepEqual(job.info?.preflight?.counts, { 'gcode.no_homing': 1 }, 'the scan of this file ran, not a stub');
});

test('a job without an FFF G-code output still gets its info before it is done', async () => {
  // the size-only branch (`info = { sizeBytes, warnings, preflight }`) has the same ordering
  const file = path.join(DATA_DIR, 'part.sl1');
  fs.writeFileSync(file, 'SLA output');
  const job = { ...runningJob(), technology: 'SLA' as const, outputName: 'part.sl1' };
  await completeJob(job, file, [], {});
  assert.equal(job.status, 'done');
  assert.equal(job.info?.sizeBytes, 'SLA output'.length);
  assert.deepEqual(
    job.info?.preflight,
    { version: PREFLIGHT_VERSION, issues: [], counts: {}, maxTemperatures: { hotend: 0, bed: 0 } },
    'still scanned once, no findings here',
  );
});

test("the slicer's plate refusal reaches the user instead of a generic failure", () => {
  // T-034: PrusaSlicer 2.9 refuses these two plates without any of the usual error keywords
  assert.equal(
    failureMessage(['10 => Processing triangulated mesh', 'All objects are outside of the print volume.'], '', 0),
    'All objects are outside of the print volume.',
  );
  assert.match(
    failureMessage(['88 => Generating skirt and brim', 'gcode path conflicts found between b and a'], '', 139),
    /gcode path conflicts found between b and a/,
  );
  // and the generic path stays as it was
  assert.equal(failureMessage(['not useful'], 'boom\nrest', 1), 'boom | rest');
  assert.equal(failureMessage([], '', 3), 'Slicer exited with code 3');
});
