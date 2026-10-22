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
async function addPrinter(name: string, presetName?: string): Promise<string> {
  const res = await call('POST', '/api/printers', { name, type: 'moonraker', host: mockBase.replace('http://', ''), presetName });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return (res.json as { id: string }).id;
}

function send(printerId: string, extra: Record<string, unknown> = {}, jobId = JOB_ID): Promise<Res> {
  return call('POST', `/api/jobs/${jobId}/send`, { printerId, filename: 'part.gcode', ...extra });
}

/** A finished job on disk: the record plus its output file. */
function seedJob(id: string, printerPreset: string, output?: { name: string; text: string; preflight?: unknown }): void {
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
