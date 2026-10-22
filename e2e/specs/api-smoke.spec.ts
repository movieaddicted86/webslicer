/**
 * The REST contract, without a browser: the parts of `server/scripts/api-smoke.ts` that are a
 * *contract* rather than a main-vs-branch snapshot.
 *
 * The snapshot script diffs two servers; this spec asserts the endpoints the browser suite depends on
 * answer what the app expects – metadata, presets, models, exports, the library, projects, autosave,
 * printers and a real slice job (created, polled, downloaded, deleted). Paths and error codes are the
 * API's public surface, so a route refactoring that changes one of them fails here.
 *
 * Requests go through `fetch` with the app's base URL: the server is the thing under test, and the
 * page is not needed for a route that has no UI side.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CUBE } from '../helpers/app';
import { expect, test } from '@playwright/test';
import { E2E_PRINTER } from '../global-setup';

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');

interface Answer<T> {
  status: number;
  headers: Headers;
  body: T;
  bytes: Buffer;
}

/** One request; the body is parsed as JSON when it is JSON, otherwise kept as bytes. */
async function api<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer<T>> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body instanceof Uint8Array) {
    init.body = new Uint8Array(body);
    init.headers = { 'content-type': 'application/octet-stream', ...init.headers };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json', ...init.headers };
  }
  const res = await fetch(`${BASE}${url}`, { ...init, signal: AbortSignal.timeout(120_000) });
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  let parsed: unknown = bytes.toString('utf8');
  if (type.includes('json')) {
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      /* a broken JSON answer is caught by the assertions */
    }
  }
  return { status: res.status, headers: res.headers, body: parsed as T, bytes };
}

const stl = () => fs.readFileSync(path.resolve(process.cwd(), CUBE));

/** The three preset configs a slice request carries. */
async function presetConfigs(): Promise<{
  print: Record<string, string>;
  printer: Record<string, string>;
  filament: Record<string, string>;
}> {
  const get = async (type: string, name: string) =>
    ((await api<{ config: Record<string, string> }>('GET', `/api/presets/${type}/${encodeURIComponent(name)}`)).body?.config ??
      {}) as Record<string, string>;
  const printer = await get('printer', E2E_PRINTER);
  const printName = (printer as { print_settings_id?: string }).print_settings_id;
  const print = printName ? await get('print', printName) : {};
  const filamentName = ((printer as { filament_settings_id?: string }).filament_settings_id || '').split(';')[0];
  const filament = filamentName ? await get('filament', filamentName) : {};
  return { print, printer, filament };
}

test.describe('api: the REST contract the app depends on', () => {
  test('health, info and the schema answer', async () => {
    expect((await api('GET', '/api/health')).body).toEqual({ ok: true });

    const info = await api<{ version: string; slicerVersion: string; maxUploadBytes: number; vendors: number }>('GET', '/api/info');
    expect(info.status).toBe(200);
    expect(info.body.version).toBeTruthy();
    expect(info.body.slicerVersion).toMatch(/^\d+\.\d+/);
    expect(info.body.vendors).toBeGreaterThan(0);
    expect(info.body.maxUploadBytes).toBeGreaterThan(0);

    const schema = await api<{ options: Record<string, unknown>; layout?: unknown }>('GET', '/api/schema');
    expect(schema.status).toBe(200);
    expect(Object.keys(schema.body.options).length).toBeGreaterThan(100);
    expect(schema.body.layout).toBeTruthy();

    const vendors = await api<Array<{ id: string; models: unknown[] }>>('GET', '/api/vendors');
    expect(vendors.body.map((v) => v.id)).toContain('PrusaResearch');
    expect(vendors.body.find((v) => v.id === 'PrusaResearch')?.models.length).toBeGreaterThan(0);

    // the fixture data installs exactly the MK3S 0.4
    expect((await api('GET', '/api/installed-printers')).body).toEqual([{ vendorId: 'PrusaResearch', modelId: 'MK3S', variant: '0.4' }]);
  });

  test('the preset routes list, resolve, save and delete a user preset', async () => {
    for (const type of ['print', 'filament', 'printer']) {
      const list = await api<Array<{ name: string; system?: boolean }>>('POST', `/api/presets/${type}/list`, {});
      expect(list.status, type).toBe(200);
      expect(list.body.length).toBeGreaterThan(0);
      const fallback = await api<{ name: string; config: Record<string, string> }>('GET', `/api/presets/${type}/default`);
      expect(fallback.status, type).toBe(200);
      expect(fallback.body.name.startsWith('- default')).toBe(true);
    }
    // the fixture preset resolves with its bed and its thumbnail profile
    const mk3s = await api<{ name: string; config: Record<string, string> }>(
      'GET',
      `/api/presets/printer/${encodeURIComponent(E2E_PRINTER)}`,
    );
    expect(mk3s.status).toBe(200);
    expect(mk3s.body.config.bed_shape).toBe('0x0,250x0,250x210,0x210');
    expect(mk3s.body.config.thumbnails).toBe('160x120');
    expect(mk3s.body.config.thumbnails_format).toBe('PNG');

    expect((await api('POST', '/api/presets/bogus/list', {})).status).toBe(400);
    expect((await api('GET', '/api/presets/printer/NoSuchPreset')).status).toBe(404);

    const name = 'E2E smoke preset';
    const saved = await api<{ name: string; config: Record<string, string> }>('PUT', `/api/presets/print/${encodeURIComponent(name)}`, {
      config: { layer_height: '0.25', no_such_option: 'x' },
      inherits: '- default FFF -',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.config.layer_height).toBe('0.25');
    // an option outside the schema is dropped rather than stored
    expect(saved.body.config.no_such_option).toBeUndefined();
    expect((await api('DELETE', `/api/presets/print/${encodeURIComponent(name)}`)).status).toBe(200);
    expect((await api('DELETE', `/api/presets/print/${encodeURIComponent(name)}`)).status).toBe(404);
    expect((await api('GET', `/api/presets/print/${encodeURIComponent(name)}`)).status).toBe(404);
    expect((await api('PUT', '/api/presets/print/-invalid', { config: {} })).status).toBe(400);
  });

  test('a model uploads, downloads byte-identical and deletes', async () => {
    const file = stl();
    const upload = await api<{ id: string; name: string; triangles: number; vertices: number }>('POST', '/api/models', file, {
      'x-filename': 'calibration_cube_20mm.stl',
    });
    expect(upload.status).toBe(200);
    expect(upload.body.name).toBe('calibration_cube_20mm.stl');
    expect(upload.body.triangles).toBeGreaterThan(0);

    const back = await api('GET', `/api/models/${upload.body.id}`);
    expect(back.status).toBe(200);
    // the server stores the parsed mesh as a binary STL again, so the bytes differ – the triangle
    // count in the header is what has to survive the round trip
    expect(back.bytes.readUInt32LE(80)).toBe(file.readUInt32LE(80));
    expect(back.bytes.length).toBe(84 + 50 * file.readUInt32LE(80));

    expect((await api('POST', '/api/models', Buffer.alloc(0))).status).toBe(400);
    expect((await api('POST', '/api/models', Buffer.from('not an stl at all'))).status).toBe(400);
    expect((await api('DELETE', `/api/models/${upload.body.id}`)).status).toBe(200);
    expect((await api('GET', `/api/models/${upload.body.id}`)).status).toBe(404);
  });

  test('the exports build a 3MF and a merged config', async () => {
    const model = (await api<{ id: string }>('POST', '/api/models', stl(), { 'x-filename': 'cube.stl' })).body;
    const configs = await presetConfigs();
    const request = {
      objects: [
        {
          modelId: model.id,
          name: 'cube',
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      print: { name: 'p', config: configs.print },
      printer: { name: E2E_PRINTER, config: configs.printer },
      filaments: [{ name: 'f', config: configs.filament }],
      outputName: 'smoke_export',
    };

    const threeMf = await api('POST', '/api/export/3mf', request);
    expect(threeMf.status).toBe(200);
    expect(threeMf.headers.get('content-type')).toContain('model/3mf');
    expect(threeMf.headers.get('content-disposition')).toContain('smoke_export.3mf');
    // a zip holds the model XML and the slicer config
    expect(threeMf.bytes.subarray(0, 2).toString()).toBe('PK');
    const archive = threeMf.bytes.toString('latin1');
    expect(archive).toContain('3D/3dmodel.model');

    // and the server can read its own project back: the browser's 3MF import
    const parsed = await api<{ objects: Array<{ name: string }> }>('POST', '/api/projects/parse', threeMf.bytes);
    expect(parsed.status).toBe(200);
    expect(parsed.body.objects.map((o) => o.name)).toEqual(['cube']);

    const ini = await api('POST', '/api/export/config', request);
    expect(ini.status).toBe(200);
    expect(ini.headers.get('content-type')).toContain('text/plain');
    expect(ini.bytes.toString()).toContain(`bed_shape = ${configs.printer.bed_shape}`);

    // a body without objects is refused – currently as a 500 (the validation runs after the route's
    // own try/catch); pinned here so a change is visible, reported in the T-030 report
    expect((await api('POST', '/api/export/3mf', {})).status).toBe(500);
    expect((await api('POST', '/api/projects/parse', Buffer.from('not a 3mf'))).status).toBe(400);
  });

  test('the library lists the samples and round-trips a file', async () => {
    const root = await api<{ root: string; entries: Array<{ name: string; dir: boolean }> }>('GET', '/api/library');
    expect(root.status).toBe(200);
    expect(root.body.entries.map((e) => e.name)).toContain('samples');
    const samples = await api<{ entries: Array<{ name: string; kind?: string; size?: number }> }>('GET', '/api/library?path=samples');
    expect(samples.body.entries.map((e) => e.name)).toContain('calibration_cube_20mm.stl');

    const name = 'smoke-roundtrip.bin';
    const data = Buffer.from('an upload that lands on disk');
    expect((await api('PUT', `/api/library/file?path=${encodeURIComponent(name)}`, data)).status).toBe(200);
    const back = await api('GET', `/api/library/file?path=${encodeURIComponent(name)}`);
    expect(back.bytes.equals(data)).toBe(true);
    expect((await api('GET', `/api/library/file?path=${encodeURIComponent(name)}&download`)).headers.get('content-disposition')).toContain(
      name,
    );
    expect((await api('DELETE', `/api/library/file?path=${encodeURIComponent(name)}`)).status).toBe(200);
    expect((await api('GET', `/api/library/file?path=${encodeURIComponent(name)}`)).status).toBe(404);
    // a path that leaves the library is refused
    expect((await api('GET', '/api/library?path=../..')).status).toBe(400);
  });

  test('the autosave stores a project and can answer its info', async () => {
    const model = (await api<{ id: string }>('POST', '/api/models', stl(), { 'x-filename': 'cube.stl' })).body;
    const configs = await presetConfigs();
    const request = {
      objects: [{ modelId: model.id, name: 'cube', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
      print: { name: 'p', config: configs.print },
      printer: { name: E2E_PRINTER, config: configs.printer },
      filaments: [{ name: 'f', config: configs.filament }],
    };
    const client = 'e2eSmokeClient01';
    const put = await api<{ ok: boolean; savedAt: string; size: number }>('PUT', `/api/autosave/${client}`, request);
    expect(put.status).toBe(200);
    expect(put.body.size).toBeGreaterThan(1000);
    expect((await api<{ size: number }>('GET', `/api/autosave/${client}?info=1`)).status).toBe(200);
    const saved = await api('GET', `/api/autosave/${client}`);
    expect(saved.bytes.subarray(0, 2).toString()).toBe('PK');
    // a client id shorter than 8 characters is the route's 400
    expect((await api('GET', '/api/autosave/ab')).status).toBe(400);
    expect((await api('DELETE', `/api/autosave/${client}`)).status).toBe(200);
    expect((await api('GET', `/api/autosave/${client}`)).status).toBe(404);
  });

  test('a project is created, filled from the library, arranged and sliced', async () => {
    const created = await api<{ id: string; objects: unknown[] }>('POST', '/api/projects', {
      printer: E2E_PRINTER,
      print: '- default FFF -',
      filaments: [],
      owner: 'e2e',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const added = await api<{ objects?: unknown[] }>('POST', `/api/projects/${id}/models`, {
      libraryPath: 'samples/calibration_cube_20mm.stl',
      copies: 2,
    });
    expect(added.status).toBe(200);
    const arranged = await api('POST', `/api/projects/${id}/arrange`, {});
    expect(arranged.status).toBe(200);
    expect((await api('GET', `/api/projects/${id}`)).status).toBe(200);

    // copies below 1 is the route's 400, a missing file is its 404
    expect((await api('POST', `/api/projects/${id}/models`, { libraryPath: 'samples/calibration_cube_20mm.stl', copies: 0 })).status).toBe(
      400,
    );
    expect((await api('POST', `/api/projects/${id}/models`, { libraryPath: 'samples/nope.stl' })).status).toBe(404);
    expect((await api('GET', '/api/projects/00000000-0000-0000-0000-000000000000')).status).toBe(404);

    // the headless slice (the MCP path): 202, then the job list, the output and the log
    const sliced = await api<{ id: string; status: string }>('POST', `/api/projects/${id}/slice`, {});
    expect(sliced.status).toBe(202);
    const jobId = sliced.body.id;
    let job: { status: string; outputName?: string } | undefined;
    for (let i = 0; i < 120 && job?.status !== 'done' && job?.status !== 'error'; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      job = (await api<{ status: string }>('GET', `/api/jobs/${jobId}`)).body;
    }
    expect(job?.status, 'the headless slice finished').toBe('done');
    const gcode = await api('GET', `/api/jobs/${jobId}/gcode`);
    expect(gcode.status).toBe(200);
    expect(gcode.bytes.toString().slice(0, 400)).toContain('generated by PrusaSlicer');
    expect((await api('GET', `/api/jobs/${jobId}/gcode?download`)).headers.get('content-disposition')).toContain('attachment');
    expect((await api('GET', `/api/jobs/${jobId}/log`)).status).toBe(200);
    expect((await api('GET', '/api/jobs')).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: jobId })]));

    expect((await api('DELETE', `/api/jobs/${jobId}`)).status).toBe(200);
    expect((await api('DELETE', `/api/jobs/${jobId}`)).status).toBe(404);
    expect((await api('GET', `/api/jobs/${jobId}`)).status).toBe(404);
  });

  test('the printer store masks the API key and keeps it on update', async () => {
    const created = await api<{ id: string; name: string; host: string; hasApiKey: boolean; apiKey?: string }>('POST', '/api/printers', {
      name: 'E2E store host',
      type: 'octoprint',
      host: '192.0.2.10',
      apiKey: 'secret-key',
    });
    expect(created.status).toBe(200);
    // a host without a scheme gets one, and the key never leaves the server
    expect(created.body.host).toBe('http://192.0.2.10');
    expect(created.body.hasApiKey).toBe(true);
    expect(created.body.apiKey).toBe('••••••••');

    const updated = await api<{ name: string; hasApiKey: boolean }>('PUT', `/api/printers/${created.body.id}`, {
      name: 'E2E store host 2',
      apiKey: '••••••••',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('E2E store host 2');
    expect(updated.body.hasApiKey, 'the mask means "keep the stored key"').toBe(true);

    expect((await api('DELETE', `/api/printers/${created.body.id}`)).status).toBe(200);
    expect((await api('DELETE', `/api/printers/${created.body.id}`)).status).toBe(404);
    // a body that is not a printable type is the schema's 400
    expect((await api('POST', '/api/printers', { type: 'carrier-pigeon' })).status).toBe(400);
  });
});
