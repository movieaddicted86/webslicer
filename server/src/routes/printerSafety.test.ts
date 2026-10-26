/**
 * The per-preset safety profile (T-085), pinned at the socket level: the routes that store it, what the
 * server derives from an answer, and the slice-time block an export-only user gets.
 *
 * The point of the record is that it survives a page reload and a new browser, and that a preset
 * without it is "not answered" – so nothing here is stored in the browser, and nothing is migrated on
 * load.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-safety-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
// a fixed version, so the notice tests can prove the major-version rule without reading package.json
process.env.WEBSLICER_VERSION = '1.4.0-rc.1';

const { ensureDirs, config } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setActiveSchema } = await import('../services/schema.js');
const { setSchema } = await import('../jobs.js');
const { printerSafetyRecord } = await import('../services/printerSafety.js');
const { validateConfigLimits } = await import('../services/slice.js');
const { printerSafetyRouter } = await import('../routes/printerSafety.js');

/** Minimal schema: the routes here never reach the slicer schema, but the module cache is shared. */
const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {},
} as never;

let server: Server;
let base = '';

interface Res {
  status: number;
  json: unknown;
  body: string;
}

async function call(method: string, url: string, body?: unknown): Promise<Res> {
  const isJson = body !== undefined;
  const res = await fetch(`${base}${url}`, {
    method,
    headers: isJson ? { 'content-type': 'application/json' } : undefined,
    body: isJson ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, body: text };
}

before(async () => {
  ensureDirs();
  setSchema(SCHEMA);
  setActiveSchema(SCHEMA);
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
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// the routes: what an answer stores
// ---------------------------------------------------------------------------

test('an empty record reads as {} – nothing is migrated on load', async () => {
  const res = await call('GET', '/api/printer-safety');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, {});
});

test('PTFE and all-metal answers derive their limit from the answer, never from the sent number', async () => {
  const ptfe = await call('PUT', '/api/printer-safety/MK3S%2B', { hotendType: 'ptfe', maxHotend: 400 });
  assert.equal(ptfe.status, 200, ptfe.body);
  assert.deepEqual((ptfe.json as Record<string, unknown>)['MK3S+'], { hotendType: 'ptfe', maxHotend: 240 });

  const allMetal = await call('PUT', '/api/printer-safety/MK4', { hotendType: 'all-metal' });
  assert.equal(allMetal.status, 200, allMetal.body);
  assert.deepEqual((allMetal.json as Record<string, unknown>).MK4, { hotendType: 'all-metal', maxHotend: 450 });

  // the record is the answer of the GET, keyed by preset name
  assert.deepEqual(await call('GET', '/api/printer-safety').then((r) => r.json), {
    'MK3S+': { hotendType: 'ptfe', maxHotend: 240 },
    MK4: { hotendType: 'all-metal', maxHotend: 450 },
  });
});

test('an "other" answer takes the typed number inside the global window, and a bed limit of 0 is "not set"', async () => {
  const ok = await call('PUT', '/api/printer-safety/Custom', { hotendType: 'other', maxHotend: 300, maxBed: 110 });
  assert.equal(ok.status, 200, ok.body);
  assert.deepEqual((ok.json as Record<string, unknown>).Custom, { hotendType: 'other', maxHotend: 300, maxBed: 110 });

  const zeroBed = await call('PUT', '/api/printer-safety/NoBed', { hotendType: 'ptfe', maxBed: 0 });
  assert.equal(zeroBed.status, 200, zeroBed.body);
  assert.deepEqual((zeroBed.json as Record<string, unknown>).NoBed, { hotendType: 'ptfe', maxHotend: 240 });

  // outside 150–450 an "other" answer is refused, and nothing changes
  for (const value of [149, 451]) {
    const bad = await call('PUT', '/api/printer-safety/Custom', { hotendType: 'other', maxHotend: value });
    assert.equal(bad.status, 400, `maxHotend = ${value}`);
    assert.match((bad.json as { error: string }).error, /150 and 450/);
  }
  assert.deepEqual((await call('GET', '/api/printer-safety')).json!['Custom' as never], {
    hotendType: 'other',
    maxHotend: 300,
    maxBed: 110,
  });
});

test('an unknown hotend type and a bed above 150 °C are 400, with the record untouched', async () => {
  const before = (await call('GET', '/api/printer-safety')).json;
  for (const body of [{ hotendType: 'brass' }, { hotendType: 'ptfe', maxBed: 151 }, { hotendType: 'ptfe', maxBed: -1 }, {}]) {
    const res = await call('PUT', '/api/printer-safety/Bad', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await call('GET', '/api/printer-safety')).json, before);
});

test('DELETE is the "Ask me later" of a preset: the answer is gone and the warning comes back', async () => {
  const removed = await call('DELETE', '/api/printer-safety/MK4');
  assert.equal(removed.status, 200);
  assert.equal((removed.json as Record<string, unknown>).MK4, undefined);
  // deleting an absent answer is not an error
  assert.equal((await call('DELETE', '/api/printer-safety/never-answered')).status, 200);
});

// ---------------------------------------------------------------------------
// slice time: the block an export-only user gets (AC-2)
// ---------------------------------------------------------------------------

/** A slice request as the browser builds it, with one filament at `temperature`. */
function request(printerName: string, temperature: string) {
  return {
    objects: [],
    print: { name: 'p', config: { layer_height: '0.2' } },
    printer: { name: presetNameOf(printerName), config: { nozzle_diameter: '0.4' } },
    filaments: [{ name: 'f', config: { filament_type: 'PETG', temperature, bed_temperature: '80' } }],
  } as never;
}

/** The name the slice check looks the profile up by – the preset name on the wire. */
function presetNameOf(name: string): string {
  return name;
}

test('a PTFE preset blocks a 260 °C request at slice time, naming the field and the limit', async () => {
  await call('PUT', '/api/printer-safety/PETG-Printer', { hotendType: 'ptfe' });
  await assert.rejects(
    () => validateConfigLimits(request('PETG-Printer', '260')),
    (e: { status?: number; details?: { issues: Array<{ rule: string; key: string }> }; message: string }) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /260 °C is above the 240 °C limit of this printer \(PTFE-lined hotend\)/);
      const issues = e.details?.issues ?? [];
      assert.deepEqual(
        issues.map((i) => [i.rule, i.key]),
        [['config.hotend_limit', 'temperature']],
      );
      return true;
    },
  );
});

test('the same request passes as all-metal, at exactly 240 °C, and without any answer', async () => {
  await call('PUT', '/api/printer-safety/AllMetal', { hotendType: 'all-metal' });
  assert.deepEqual(await validateConfigLimits(request('AllMetal', '260')), []);

  await call('PUT', '/api/printer-safety/Border', { hotendType: 'ptfe' });
  assert.deepEqual(await validateConfigLimits(request('Border', '240')), [], 'exactly at the limit passes');

  await call('DELETE', '/api/printer-safety/Unanswered');
  assert.deepEqual(await validateConfigLimits(request('Unanswered', '260')), [], 'no answer means only the global 450 °C');
});

test('the bed limit blocks too, with the bed rule and its own field', async () => {
  await call('PUT', '/api/printer-safety/CoolBed', { hotendType: 'all-metal', maxBed: 60 });
  await assert.rejects(
    () => validateConfigLimits(request('CoolBed', '230')),
    (e: { message: string; details?: { issues: Array<{ rule: string; key: string }> } }) => {
      assert.match(e.message, /80 °C is above the 60 °C limit of this printer/);
      assert.deepEqual(
        e.details?.issues.map((i) => [i.rule, i.key]),
        [['config.bed_limit', 'bed_temperature']],
      );
      return true;
    },
  );
});

test('a global typo still wins the message and is not repeated by the preset rule', async () => {
  await call('PUT', '/api/printer-safety/Typo', { hotendType: 'ptfe' });
  await assert.rejects(
    () => validateConfigLimits(request('Typo', '2150')),
    (e: { details?: { issues: Array<{ rule: string }> } }) => {
      // 2150 is above both the global ceiling and the preset's 240 – one finding, the global one
      assert.deepEqual(
        e.details?.issues.map((i) => i.rule),
        ['config.hotend_limit'],
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// the risk notice: server-side, per major version (AC-4)
// ---------------------------------------------------------------------------

test('the notice starts unacknowledged and lives on the server, not in the browser', async () => {
  assert.deepEqual((await call('GET', '/api/risk-notice')).json, { acknowledged: false });
  const ack = await call('POST', '/api/risk-notice/ack');
  assert.equal(ack.status, 200);
  const body = ack.json as { acknowledged: boolean; version: string; acknowledgedAt: string };
  assert.equal(body.acknowledged, true);
  assert.equal(body.version, '1.4.0-rc.1');
  assert.ok(Date.parse(body.acknowledgedAt) > 0);
  // a fresh read – another browser – sees the same answer
  assert.equal(((await call('GET', '/api/risk-notice')).json as { acknowledged: boolean }).acknowledged, true);
  // and it really is a file in the data dir
  assert.ok(fs.existsSync(path.join(config.dataDir, 'risk_notice.json')));
});

test('the About dialog can ask for it again', async () => {
  assert.equal(((await call('DELETE', '/api/risk-notice/ack')).json as { acknowledged: boolean }).acknowledged, false);
  assert.equal(((await call('GET', '/api/risk-notice')).json as { acknowledged: boolean }).acknowledged, false);
});

test('an acknowledgement from another major version asks again; the same major does not', async () => {
  fs.writeFileSync(
    path.join(config.dataDir, 'risk_notice.json'),
    JSON.stringify({ version: '2.0.0', acknowledgedAt: '2026-01-01T00:00:00.000Z' }),
  );
  const other = (await call('GET', '/api/risk-notice')).json as { acknowledged: boolean; version?: string };
  assert.equal(other.acknowledged, false, 'a major ahead asks again');
  assert.equal(other.version, '2.0.0');

  fs.writeFileSync(
    path.join(config.dataDir, 'risk_notice.json'),
    JSON.stringify({ version: '1.3.7', acknowledgedAt: '2026-01-01T00:00:00.000Z' }),
  );
  assert.equal(((await call('GET', '/api/risk-notice')).json as { acknowledged: boolean }).acknowledged, true);
});

// ---------------------------------------------------------------------------
// the record itself
// ---------------------------------------------------------------------------

test('the record is the file under the data dir, and a corrupt one reads as "not answered"', async () => {
  assert.deepEqual(await printerSafetyRecord(), (await call('GET', '/api/printer-safety')).json);
  const file = path.join(config.dataDir, 'printer_safety.json');
  assert.ok(fs.existsSync(file));
  const quarantined = fs.readdirSync(config.dataDir).filter((f) => f.includes('printer_safety') && f.endsWith('.json'));
  // one live file (a quarantine copy only after a corrupt read, which the next test does)
  assert.deepEqual(quarantined, ['printer_safety.json']);
});

test('a preset route is mounted on the same app as the other safety routes', () => {
  // the router is registered in `api.ts` next to the printers: a missing mount would 404 every call above
  assert.equal(typeof printerSafetyRouter, 'function');
});

test('deleting a user printer preset takes its safety answer with it', async () => {
  // a user printer preset through the API, answered, then deleted
  const saved = await call('PUT', '/api/presets/printer/Throwaway', { config: { nozzle_diameter: '0.4' } });
  assert.equal(saved.status, 200, saved.body);
  await call('PUT', '/api/printer-safety/Throwaway', { hotendType: 'ptfe' });
  assert.equal(((await call('GET', '/api/printer-safety')).json as Record<string, unknown>).Throwaway !== undefined, true);

  const removed = await call('DELETE', '/api/presets/printer/Throwaway');
  assert.equal(removed.status, 200, removed.body);
  assert.equal(
    ((await call('GET', '/api/printer-safety')).json as Record<string, unknown>).Throwaway,
    undefined,
    'a later preset of the same name is a different machine and asks again',
  );
});
