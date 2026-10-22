/**
 * The send gate of `POST /api/jobs/:id/send` (S1-b, T-026), pinned at the socket level against a
 * **mock print host**: a tiny HTTP server that records the uploads it receives. Nothing here talks to
 * a real printer.
 *
 * The job is seeded as a finished job on disk (`loadJobsFromDisk`), so no slicer is needed; the gate
 * is what is under test, not the queue.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-send-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');

const { ensureDirs, config } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setSchema, loadJobsFromDisk } = await import('../jobs.js');
const { setActiveSchema } = await import('../services/schema.js');
const { readAudit } = await import('../mcp/audit.js');

/** Minimal schema: the routes here never reach the slicer schema, but the module cache is shared. */
const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {},
} as never;

const JOB_ID = '11111111-2222-3333-4444-555555555555';
const JOB2_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
/** A job whose G-code carries a forbidden command (S1-c). */
const JOB_BAD_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
/** A job with a stored, current preflight result: the gate must use it instead of re-scanning. */
const JOB_STORED_ID = 'cccccccc-dddd-eeee-ffff-000000000000';
/** A binary-G-code job: v1 cannot scan it, which is one warn. */
const JOB_BINARY_ID = 'dddddddd-eeee-ffff-0000-111111111111';
/** A hot job (S1-d): 250 °C hotend, 90 °C bed. */
const JOB_HOT_ID = 'ffffffff-0000-1111-2222-333333333333';
/** A hot job from before S1-d: no stored temperatures, the stored request is the source. */
const JOB_HOT_OLD_ID = '99999999-0000-1111-2222-333333333333';
const JOB_PRESET = 'Original Prusa MK4S HF0.4 nozzle';
const OTHER_PRESET = 'Original Prusa MINI+ 0.4 nozzle';

let server: Server;
let mock: Server;
let base = '';
let mockBase = '';
/** Every upload the mock host received: its path and the length of the body. */
const uploads: Array<{ path: string; bytes: number; contentType: string }> = [];

interface Res {
  status: number;
  json: unknown;
}

async function call(method: string, url: string, body?: object): Promise<Res> {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** Create a print host through the API and answer its id. */
async function addPrinter(name: string, presetName?: string, safety?: { maxHotend?: number; maxBed?: number }): Promise<string> {
  const res = await call('POST', '/api/printers', { name, type: 'moonraker', host: mockBase.replace('http://', ''), presetName, safety });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return (res.json as { id: string }).id;
}

function send(printerId: string, extra: Record<string, unknown> = {}, jobId = JOB_ID): Promise<Res> {
  return call('POST', `/api/jobs/${jobId}/send`, { printerId, filename: 'part.gcode', ...extra });
}

/** A finished job on disk: the record plus its output file, optionally its request (S1-d). */
function seedJob(
  id: string,
  printerPreset: string,
  output?: { name?: string; text?: string; preflight?: unknown; temperatures?: { hotend: number; bed: number } },
): void {
  const dir = path.join(config.jobsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'job.json'),
    JSON.stringify({
      id,
      status: 'done',
      createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:05:00.000Z',
      percent: 100,
      message: 'Done',
      outputName: output?.name ?? 'part.gcode',
      technology: 'FFF',
      presets: { print: '0.20mm SPEED', filaments: ['Prusament PLA'], printer: printerPreset },
      objectNames: ['cube'],
      temperatures: output?.temperatures,
      info: output?.preflight === undefined ? undefined : { sizeBytes: 0, preflight: output.preflight },
    }),
  );
  fs.writeFileSync(path.join(dir, output?.name ?? 'part.gcode'), output?.text ?? 'G28\nG1 X10 Y10\n');
}

before(async () => {
  ensureDirs();
  setSchema(SCHEMA);
  setActiveSchema(SCHEMA);

  // finished jobs on disk: the records plus their output files
  seedJob(JOB_ID, JOB_PRESET);
  seedJob(JOB2_ID, 'Sibling A');
  // S1-c: a forbidden command in the output, a stored scan, and a binary output
  seedJob(JOB_BAD_ID, JOB_PRESET, { text: 'G28\nM500\nG1 X10 Y10\n' });
  seedJob(JOB_STORED_ID, JOB_PRESET, {
    text: 'G28\nG1 X10 Y10\n',
    preflight: {
      version: 1,
      counts: { 'gcode.forbidden_command': 1 },
      issues: [
        {
          rule: 'gcode.forbidden_command',
          severity: 'block',
          message: 'Line 1: "M500" stores the printer\'s settings in its EEPROM – a forbidden command.',
          line: 1,
          text: 'M500',
        },
      ],
    },
  });
  seedJob(JOB_BINARY_ID, JOB_PRESET, { name: 'part.bgcode', text: 'not really binary' });
  // S1-d: a job that asks for 250 °C / 90 °C – too hot for a PTFE hotend (240 °C)
  seedJob(JOB_HOT_ID, JOB_PRESET, { temperatures: { hotend: 250, bed: 90 } });
  seedJob(JOB_HOT_OLD_ID, JOB_PRESET);
  fs.writeFileSync(
    path.join(config.jobsDir, JOB_HOT_OLD_ID, 'request.json'),
    JSON.stringify({
      objects: [],
      print: { name: 'p', config: {} },
      printer: { name: 'pr', config: {} },
      filaments: [{ name: 'ABS', config: { temperature: '250', bed_temperature: '90' } }],
    }),
  );
  await loadJobsFromDisk();

  // the mock print host: Moonraker's upload endpoint, recording what it gets
  mock = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      uploads.push({ path: req.url ?? '', bytes: Buffer.concat(chunks).length, contentType: req.headers['content-type'] ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: 'ok' }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockAddr = mock.address();
  mockBase = `http://127.0.0.1:${typeof mockAddr === 'object' && mockAddr ? mockAddr.port : 0}`;

  const app = (await createApp()) as express.Express;
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
  mock.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('a matching printer preset uploads without issues and without an audit entry', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Workshop MK4S', JOB_PRESET);
  const before = uploads.length;
  const res = await send(id);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { ok: boolean; issues: unknown[] };
  assert.equal(body.ok, true);
  assert.deepEqual(body.issues, []);
  assert.equal(uploads.length, before + 1, 'the mock host received the upload');
  assert.equal(uploads[uploads.length - 1].path, '/server/files/upload');
  assert.deepEqual(readAudit(), [], 'a send that needed no override is not audited');
});

test('a mismatched printer preset is refused with 409 and the issues, and nothing is uploaded', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Garage MINI', OTHER_PRESET);
  const before = uploads.length;
  const res = await send(id);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const body = res.json as { error: string; issues: Array<{ rule: string; severity: string; message: string }> };
  assert.match(body.error, /sliced for the printer preset/);
  assert.equal(body.issues.length, 1);
  assert.equal(body.issues[0].rule, 'send.preset_mismatch');
  assert.equal(body.issues[0].severity, 'block');
  assert.match(body.issues[0].message, /Garage MINI/);
  assert.equal(uploads.length, before, 'a blocked send never reaches the printer');
  assert.deepEqual(readAudit(), []);
});

test('an override without a reason is a 400 and still does not upload', async () => {
  const id = await addPrinter('Garage MINI 2', OTHER_PRESET);
  const before = uploads.length;
  for (const extra of [{ override: true }, { override: true, reason: '  ' }]) {
    const res = await send(id, extra);
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.equal((res.json as { error: string }).error, 'an override needs a reason');
  }
  assert.equal(uploads.length, before);
});

test('an override with a reason uploads and writes the audit entry', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Garage MINI 3', OTHER_PRESET);
  const before = uploads.length;
  const res = await send(id, { override: true, reason: '  same nozzle, tested by hand  ' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { ok: boolean; issues: Array<{ rule: string }> };
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.issues.map((i) => i.rule),
    ['send.preset_mismatch'],
    'the answer still names what was overridden',
  );
  assert.equal(uploads.length, before + 1);

  const entries = readAudit();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tool, 'send_to_printer');
  assert.equal(entries[0].ok, true);
  const params = entries[0].params as {
    jobId: string;
    printerId: string;
    printerName: string;
    issues: Array<{ rule: string }>;
    reason: string;
  };
  assert.equal(params.jobId, JOB_ID);
  assert.equal(params.printerId, id);
  assert.equal(params.printerName, 'Garage MINI 3');
  assert.deepEqual(
    params.issues.map((i) => i.rule),
    ['send.preset_mismatch'],
  );
  assert.equal(params.reason, 'same nozzle, tested by hand', 'the reason is trimmed');
});

test('a host without a printer preset warns but uploads, and is not audited as an override', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Spare host');
  const before = uploads.length;
  const res = await send(id);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { issues: Array<{ rule: string; severity: string }> };
  assert.equal(body.issues.length, 1);
  assert.equal(body.issues[0].rule, 'send.no_binding');
  assert.equal(body.issues[0].severity, 'warn');
  assert.equal(uploads.length, before + 1);
  assert.deepEqual(readAudit(), []);
});

test('a user printer preset derived from the job preset warns but uploads', async () => {
  // the preset-equivalence path: the preset list has no bundles in this test process, so the
  // inherited name is the user preset's own `inherits` line
  fs.rmSync(config.auditLog, { force: true });
  fs.mkdirSync(path.join(config.presetsDir, 'printer'), { recursive: true });
  fs.writeFileSync(path.join(config.presetsDir, 'printer', 'My MK4S.ini'), `# generated by the test\ninherits = ${JOB_PRESET}\n`);
  const id = await addPrinter('Workshop copy', 'My MK4S');
  const before = uploads.length;
  const res = await send(id);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { issues: Array<{ rule: string; severity: string }> };
  assert.deepEqual(
    body.issues.map((i) => [i.rule, i.severity]),
    [['send.preset_derived', 'warn']],
    'a derived preset is a warning, not a match and not a block',
  );
  assert.equal(uploads.length, before + 1);
  assert.deepEqual(readAudit(), [], 'a warning is not an override');
});

test('two user presets that only share an ancestor are a 409, not a match', async () => {
  fs.rmSync(config.auditLog, { force: true });
  fs.mkdirSync(path.join(config.presetsDir, 'printer'), { recursive: true });
  fs.writeFileSync(path.join(config.presetsDir, 'printer', 'Sibling A.ini'), `inherits = ${OTHER_PRESET}\n`);
  fs.writeFileSync(path.join(config.presetsDir, 'printer', 'Sibling B.ini'), `inherits = ${OTHER_PRESET}\n`);
  // JOB2 was sliced for "Sibling A"; this host runs "Sibling B" – same parent, different machine
  const id = await addPrinter('Sibling host', 'Sibling B');
  const before = uploads.length;
  const res = await send(id, {}, JOB2_ID);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const body = res.json as { issues: Array<{ rule: string; severity: string }> };
  assert.deepEqual(
    body.issues.map((i) => [i.rule, i.severity]),
    [['send.preset_mismatch', 'block']],
  );
  assert.equal(uploads.length, before);
});

// ---------------------------------------------------------------------------
// S1-c: the G-code preflight in the send gate
// ---------------------------------------------------------------------------

test('a forbidden command in the output is a 409 that names the rule, the line and the line text', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Preflight host', JOB_PRESET);
  const before = uploads.length;
  const res = await send(id, {}, JOB_BAD_ID);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const body = res.json as {
    error: string;
    issues: Array<{ rule: string; severity: string; message: string; line: number; text: string }>;
  };
  const issue = body.issues.find((i) => i.rule === 'gcode.forbidden_command');
  assert.ok(issue, 'the preflight issue is in the answer');
  assert.equal(issue.severity, 'block');
  assert.equal(issue.line, 2);
  assert.equal(issue.text, 'M500');
  assert.match(issue.message, /M500/);
  // the preset issue is absent – the host matches the job's preset
  assert.equal(body.issues.length, 1);
  assert.equal(uploads.length, before, 'a preflight block never reaches the printer');
  assert.deepEqual(readAudit(), []);
});

test('a preflight block is overridable with a reason, which is audited with the issue', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Preflight host 2', JOB_PRESET);
  const before = uploads.length;
  const res = await send(id, { override: true, reason: 'the EEPROM save is wanted here' }, JOB_BAD_ID);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { ok: boolean; issues: Array<{ rule: string }> };
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.issues.map((i) => i.rule),
    ['gcode.forbidden_command'],
  );
  assert.equal(uploads.length, before + 1);
  const entries = readAudit();
  assert.equal(entries.length, 1);
  const params = entries[0].params as { issues: Array<{ rule: string }>; reason: string };
  assert.deepEqual(
    params.issues.map((i) => i.rule),
    ['gcode.forbidden_command'],
  );
  assert.equal(params.reason, 'the EEPROM save is wanted here');
});

test('the stored preflight result is used instead of scanning the file again', async () => {
  // the file itself is clean; the record carries a block – the gate must answer with the record
  const id = await addPrinter('Stored host', JOB_PRESET);
  const res = await send(id, {}, JOB_STORED_ID);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const body = res.json as { issues: Array<{ rule: string }> };
  assert.deepEqual(
    body.issues.map((i) => i.rule),
    ['gcode.forbidden_command'],
  );
});

test('binary G-code is a warn, not a silent pass and not a block', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('Binary host', JOB_PRESET);
  const before = uploads.length;
  const res = await send(id, {}, JOB_BINARY_ID);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { issues: Array<{ rule: string; severity: string }> };
  assert.deepEqual(
    body.issues.map((i) => [i.rule, i.severity]),
    [['gcode.not_scanned', 'warn']],
  );
  assert.equal(uploads.length, before + 1);
});

test('a clean job with a matching host uploads without any issue', async () => {
  const id = await addPrinter('Clean host', JOB_PRESET);
  const res = await send(id, {}, JOB_ID);
  const body = res.json as { ok: boolean; issues: unknown[] };
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(body.issues, [], 'a clean file and a matching preset have nothing to report');
});

/**
 * The send request scans a record without a stored result (the pre-S1-c case). That read is async, so
 * the server keeps answering while the ~20 MB file is parsed: a `GET /api/health` sent during the
 * scan is answered quickly instead of after it.
 */
test('a health request is answered while the send scans a large file', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const bigId = 'eeeeeeee-ffff-0000-1111-222222222222';
  const dir = path.join(config.jobsDir, bigId);
  fs.mkdirSync(dir, { recursive: true });
  const template = fs.readFileSync(path.join(config.jobsDir, JOB_ID, 'job.json'), 'utf8');
  fs.writeFileSync(path.join(dir, 'job.json'), template.replaceAll(JOB_ID, bigId));
  // no stored preflight in the record: the gate has to scan this file itself
  const line = 'G1 X12.345 Y67.890 E0.01234\n';
  fs.writeFileSync(path.join(dir, 'part.gcode'), line.repeat(Math.ceil((20 * 1024 * 1024) / line.length)));
  await loadJobsFromDisk();

  const id = await addPrinter('Big host', JOB_PRESET);
  const started = performance.now();
  const sending = send(id, {}, bigId);
  // let the scan start, then ask the same server for its health
  await new Promise((r) => setTimeout(r, 150));
  const healthStarted = performance.now();
  const health = await fetch(`${base}/api/health`);
  const healthMs = performance.now() - healthStarted;
  const result = await sending;
  const totalMs = performance.now() - started;

  assert.equal(health.status, 200);
  assert.ok(totalMs > 400, `the scan took ${totalMs.toFixed(0)} ms – big enough to see`);
  assert.ok(healthMs < totalMs / 2, `health answered in ${healthMs.toFixed(0)} ms of a ${totalMs.toFixed(0)} ms send`);
  assert.equal(result.status, 409, 'the file starts with a move and never homes');
});

// ---------------------------------------------------------------------------
// S1-d: the safety profile of the target printer
// ---------------------------------------------------------------------------

test('a job hotter than the target printer is a 409 send.printer_limit, and nothing is uploaded', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('PTFE host', JOB_PRESET, { maxHotend: 240 });
  const before = uploads.length;
  const res = await send(id, {}, JOB_HOT_ID);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const body = res.json as { error: string; issues: Array<{ rule: string; severity: string; message: string }> };
  assert.match(body.error, /hotend to 250 °C/);
  assert.deepEqual(
    body.issues.map((i) => [i.rule, i.severity]),
    [['send.printer_limit', 'block']],
  );
  assert.match(body.issues[0].message, /limited to 240 °C/);
  assert.equal(uploads.length, before, 'a limit block never reaches the printer');
  assert.deepEqual(readAudit(), []);
});

test('a printer with a high enough limit lets the same job through', async () => {
  const id = await addPrinter('All-metal host', JOB_PRESET, { maxHotend: 300, maxBed: 100 });
  const res = await send(id, {}, JOB_HOT_ID);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual((res.json as { issues: unknown[] }).issues, []);
});

test('the bed limit is checked on its own', async () => {
  const id = await addPrinter('Small bed host', JOB_PRESET, { maxBed: 80 });
  const res = await send(id, {}, JOB_HOT_ID);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  const issues = (res.json as { issues: Array<{ rule: string; message: string }> }).issues;
  assert.deepEqual(
    issues.map((i) => i.rule),
    ['send.printer_limit'],
  );
  assert.match(issues[0].message, /bed to 90 °C/);
});

test('a limit block is overridable with a reason, which is audited', async () => {
  fs.rmSync(config.auditLog, { force: true });
  const id = await addPrinter('PTFE host 2', JOB_PRESET, { maxHotend: 240 });
  const before = uploads.length;
  const res = await send(id, { override: true, reason: 'short print, hotend replaced' }, JOB_HOT_ID);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const body = res.json as { ok: boolean; issues: Array<{ rule: string }> };
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.issues.map((i) => i.rule),
    ['send.printer_limit'],
  );
  assert.equal(uploads.length, before + 1);
  const entries = readAudit();
  assert.equal(entries.length, 1);
  const params = entries[0].params as { issues: Array<{ rule: string }>; reason: string };
  assert.deepEqual(
    params.issues.map((i) => i.rule),
    ['send.printer_limit'],
  );
  assert.equal(params.reason, 'short print, hotend replaced');
});

test('a job from before S1-d is judged on its stored request', async () => {
  const id = await addPrinter('PTFE host 3', JOB_PRESET, { maxHotend: 240 });
  const res = await send(id, {}, JOB_HOT_OLD_ID);
  assert.equal(res.status, 409, JSON.stringify(res.json));
  assert.deepEqual(
    (res.json as { issues: Array<{ rule: string }> }).issues.map((i) => i.rule),
    ['send.printer_limit'],
  );
});

test('the printer API stores and returns the safety limits, and clears them on an empty block', async () => {
  const id = await addPrinter('Limits host', JOB_PRESET, { maxHotend: 240, maxBed: 100 });
  const list = (await call('GET', '/api/printers')).json as Array<{ id: string; safety?: { maxHotend?: number; maxBed?: number } }>;
  const stored = list.find((p) => p.id === id);
  assert.deepEqual(stored?.safety, { maxHotend: 240, maxBed: 100 });

  const cleared = await call('PUT', `/api/printers/${id}`, { name: 'Limits host', host: mockBase, presetName: JOB_PRESET, safety: {} });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.equal((cleared.json as { safety?: unknown }).safety, undefined, 'an empty safety block means "no limits"');
});

test('a safety limit outside the global catcher is a 400', async () => {
  const res = await call('POST', '/api/printers', { name: 'Bad limit', host: 'x', safety: { maxHotend: 500 } });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match((res.json as { error: string }).error, /maxHotend/);
});
