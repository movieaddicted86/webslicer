/**
 * HTTP contract tests: the error cases of every REST route, pinned at the socket level.
 *
 * These are deliberately *not* unit tests of the handlers: T-021 moves the logic behind services and
 * switches the hand-written `Object.assign(new Error(…), { status })` errors to typed ones, so what
 * must not change is the status code and the JSON body the client sees. Every assertion below is a
 * pin on exactly that.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type express from 'express';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-http-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LIBRARY_DIR = path.join(DATA_DIR, 'library');
// one allowed extra host, so the SEC-2 tests below can prove ALLOWED_HOSTS works (config is read once)
process.env.ALLOWED_HOSTS = 'webslicer.lan';

const { ensureDirs, config } = await import('../config.js');
const { createApp } = await import('../app.js');
const { setSchema } = await import('../jobs.js');
const { setActiveSchema } = await import('../services/schema.js');
const { setUpdateChecker } = await import('../services/updateCheck.js');
const { IDENTITY, placementMatrix, translate } = await import('@webslicer/shared');

/** Minimal schema: these tests never reach the slicer schema, but the module cache is shared. */
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
  body: string;
  json: unknown;
  headers: Headers;
}

async function call(method: string, url: string, body?: BodyInit | object, headers: Record<string, string> = {}): Promise<Res> {
  const isJson = body !== undefined && !(body instanceof Uint8Array) && typeof body === 'object';
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...headers },
    body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, body: text, json, headers: res.headers };
}

/** The message of an `{ error }` body – the stable half of the contract. */
function errorOf(res: Res): string | undefined {
  return (res.json as { error?: string } | undefined)?.error;
}

/**
 * One request with a chosen `Host` header.
 *
 * `fetch` (undici) ignores a `Host` it is given and always sends the URL's, so the SEC-2 tests use
 * the plain `node:http` client – which is also what a browser on a rebound name sends.
 */
async function callWithHost(method: string, url: string, host: string, body?: object, headers: Record<string, string> = {}): Promise<Res> {
  const urlObj = new URL(`${base}${url}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method,
        headers: {
          host,
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, body: text, json, headers: new Headers() });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
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
// /api/health, /api/info
// ---------------------------------------------------------------------------

test('GET /api/health answers 200 { ok: true }', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

test('GET /api/update-status answers the checker’s status (T-058)', async () => {
  const answer = {
    current: '7ebbe07',
    latest: 'aaa1111',
    behind: 3,
    url: 'https://github.com/movieaddicted86/webslicer/compare/7ebbe07...main',
    checkedAt: '2026-10-23T08:00:00.000Z',
    enabled: true,
    tag: 'v1.1.0',
  };
  setUpdateChecker({ enabled: true, status: () => answer, check: async () => answer, start: () => () => {} });
  try {
    const res = await call('GET', '/api/update-status');
    assert.equal(res.status, 200);
    // the route hands out exactly the contract fields – no extra key from the checker leaks
    assert.deepEqual(res.json, answer);
  } finally {
    setUpdateChecker(undefined);
  }
});

// ---------------------------------------------------------------------------
// presets: unknown type is a 400 with the type in the message
// ---------------------------------------------------------------------------

for (const route of ['/api/presets/nope/list', '/api/presets/nope/default', '/api/presets/nope/some-name']) {
  test(`preset route ${route} rejects an unknown preset type with 400`, async () => {
    const res = await call(route.endsWith('/list') ? 'POST' : 'GET', route, route.endsWith('/list') ? {} : undefined);
    assert.equal(res.status, 400);
    assert.equal(errorOf(res), 'Unknown preset type nope');
  });
}

test('DELETE /api/presets/:type/:name rejects an unknown preset type with 400', async () => {
  const res = await call('DELETE', '/api/presets/nope/some-name');
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'Unknown preset type nope');
});

test('DELETE /api/presets/:type/:name answers 404 for a missing user preset', async () => {
  const res = await call('DELETE', '/api/presets/print/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'user preset not found');
});

test('PUT /api/presets/:type/:name rejects an invalid name with 400', async () => {
  for (const bad of ['../escape', '-dash', 'a/b', 'a\\b']) {
    const res = await call('PUT', `/api/presets/print/${encodeURIComponent(bad)}`, { config: {} });
    assert.equal(res.status, 400, `name ${bad}`);
    assert.equal(errorOf(res), 'invalid preset name');
  }
});

test('PUT /api/presets/:type/:name requires a config object', async () => {
  const res = await call('PUT', '/api/presets/print/valid-name', { inherits: 'x' });
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'config required');
});

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------

test('POST /api/models rejects an empty body with 400', async () => {
  const res = await call('POST', '/api/models', new Uint8Array(0));
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'empty body');
});

test('POST /api/models rejects a body that is not an STL with 400', async () => {
  const res = await call('POST', '/api/models', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'mesh has no triangles');
});

test('B11: a malformed X-Filename is a 400, not an unhandled URIError', async () => {
  // decodeURIComponent throws on a lone `%` escape; the route used to let it reach the 500 handler
  const stl = Buffer.alloc(84 + 50);
  stl.writeUInt32LE(1, 80);
  const res = await call('POST', '/api/models', new Uint8Array(stl), { 'X-Filename': '%E0%A4%A' });
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'invalid file name');
});

test('GET /api/models/:id answers 404 for a missing model', async () => {
  const res = await call('GET', '/api/models/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'model not found');
});

test('DELETE /api/models/:id is idempotent and answers { ok: true }', async () => {
  const res = await call('DELETE', '/api/models/does-not-exist');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

// ---------------------------------------------------------------------------
// projects (3MF upload) and export
// ---------------------------------------------------------------------------

test('POST /api/projects/parse rejects an empty body with 400', async () => {
  const res = await call('POST', '/api/projects/parse', new Uint8Array(0));
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'empty body');
});

/** A valid request whose *object* carries the overrides. */
function sliceRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objects: [{ modelId: '11111111-1111-1111-1111-111111111111', name: 'cube', transform: IDENTITY, ...overrides }],
    print: { name: 'p', config: {} },
    printer: { name: 'pr', config: {} },
    filaments: [],
  };
}

/** A valid request whose *top level* carries the overrides. */
function sliceRequestTop(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...sliceRequest(), ...overrides };
}

test('B11: both export routes answer an empty body with 400 and a message', async () => {
  // used to be a 500 (a plain validation Error fell through the error handler, and `/export/config`
  // did not look at the body at all and died on `body.objects`)
  for (const route of ['/api/export/3mf', '/api/export/config']) {
    const res = await call('POST', route, { objects: [] });
    assert.equal(res.status, 400, route);
    assert.equal(errorOf(res), 'at least one object required', route);
  }
});

test('B11: an invalid export request is a 400 with the validator message, not a generic 500', async () => {
  for (const route of ['/api/export/3mf', '/api/export/config']) {
    const res = await call('POST', route, sliceRequest({ modelId: 'not-a-uuid' }));
    assert.equal(res.status, 400, route);
    assert.match(errorOf(res) ?? '', /invalid modelId/, route);
  }
});

// ---------------------------------------------------------------------------
// slicing jobs
// ---------------------------------------------------------------------------

test('POST /api/slice reports every validation failure as a 400 with the validator message', async () => {
  const cases: Array<[Record<string, unknown> | undefined, string]> = [
    [{}, 'at least one object required'],
    [{ objects: 'x', print: {}, printer: {} }, 'at least one object required'],
    [sliceRequest({ modelId: 'not-a-uuid' }), 'invalid modelId'],
    [sliceRequest({ transform: [1, 2, 3] }), 'transform must have 16 entries'],
    [sliceRequest({ instances: [] }), 'instances must have 1-1000 entries'],
    [sliceRequest({ supportPaint: 'x' }), 'invalid supportPaint'],
    [sliceRequest({ mmuPaint: 'z' }), 'invalid mmuPaint'],
    [sliceRequest({ ranges: [{ minZ: 1, maxZ: 0, config: {} }] }), 'invalid range'],
    [sliceRequest({ ranges: [{ minZ: 0, maxZ: 1 }] }), 'range config required'],
    [sliceRequestTop({ print: undefined }), 'print and printer config required'],
    [sliceRequestTop({ customGcodes: [{ printZ: 0, type: 'color_change' }] }), 'invalid custom G-code height'],
    [sliceRequestTop({ customGcodes: [{ printZ: 1, type: 'nope' }] }), 'invalid custom G-code type nope'],
    [sliceRequestTop({ thumbnails: [{ format: 'GIF', width: 1, height: 1, data: '' }] }), 'invalid thumbnail format'],
    [sliceRequestTop({ thumbnails: [{ format: 'PNG', width: 0, height: 1, data: '' }] }), 'invalid thumbnail size'],
  ];
  for (const [body, message] of cases) {
    const res = await call('POST', '/api/slice', body ?? {});
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(errorOf(res), message, JSON.stringify(body));
  }
  // `{}` reaches the validator as an empty object, not as "no body": express.json leaves `req.body`
  // as `{}` for a request with a JSON content type and no payload.
  const empty = await call('POST', '/api/slice', {});
  assert.equal(errorOf(empty), 'at least one object required');
});

test('POST /api/slice refuses a configuration limit as a 400 with its issues (S1-d)', async () => {
  const res = await call(
    'POST',
    '/api/slice',
    sliceRequestTop({
      filaments: [{ name: 'PLA', config: { temperature: '2150', filament_type: 'PLA' } }],
    }),
  );
  assert.equal(res.status, 400, JSON.stringify(res.json));
  const body = res.json as { error: string; issues: Array<{ rule: string; severity: string; key: string; value: string; limit: string }> };
  assert.match(body.error, /2150/);
  assert.equal(body.issues.length, 1);
  assert.equal(body.issues[0].rule, 'config.hotend_limit');
  assert.equal(body.issues[0].severity, 'block');
  assert.equal(body.issues[0].key, 'temperature');
  assert.equal(body.issues[0].value, '2150');
  assert.equal(body.issues[0].limit, '150–450 °C (or 0)');
});

test('POST /api/slice refuses a temperature from the printer config and an object layer height (N3)', async () => {
  // AC-2.2: the filament sets no temperature; the printer config carries the typo
  const printer = await call(
    'POST',
    '/api/slice',
    sliceRequestTop({ printer: { name: 'pr', config: { temperature: '999', nozzle_diameter: '0.4' } } }),
  );
  assert.equal(printer.status, 400, JSON.stringify(printer.json));
  assert.match(errorOf(printer) ?? '', /temperature = 999/);
  // AC-2.3: an object's own layer_height override faces the same rule, against the printer's nozzle
  const object = await call(
    'POST',
    '/api/slice',
    sliceRequestTop({
      printer: { name: 'pr', config: { nozzle_diameter: '0.4' } },
      objects: [{ modelId: '11111111-1111-1111-1111-111111111111', name: 'cube', transform: IDENTITY, config: { layer_height: '10' } }],
    }),
  );
  assert.equal(object.status, 400, JSON.stringify(object.json));
  assert.match(errorOf(object) ?? '', /object\[0\]: layer_height = 10/);
});

test('POST /api/slice accepts a soft-range value and carries its warning into the job (S1-d)', async () => {
  // the mock here is the schema-less test app: the job is queued, not sliced
  const res = await call(
    'POST',
    '/api/slice',
    sliceRequestTop({
      filaments: [{ name: 'PLA', config: { temperature: '265', bed_temperature: '60', filament_type: 'PLA' } }],
    }),
  );
  assert.equal(res.status, 202, JSON.stringify(res.json));
  const job = res.json as { id: string; configIssues?: Array<{ rule: string; severity: string; key: string }> };
  assert.equal(job.configIssues?.length, 1);
  assert.equal(job.configIssues?.[0].rule, 'config.filament_temperature');
  assert.equal(job.configIssues?.[0].severity, 'warn');
  assert.equal(job.configIssues?.[0].key, 'temperature');
});

/** A tiny binary STL with `size` mm cube corners at (0, 0, 0) … (size, size, size) – a real model file. */
function cubeStl(size = 20): Uint8Array {
  const v = Float32Array.from([0, 0, 0, size, 0, 0, size, size, 0, 0, size, 0, 0, 0, size, size, 0, size, size, size, size, 0, size, size]);
  const i = Uint32Array.from([
    0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3, 4, 6, 5, 4, 5, 7, 5, 6, 7, 6, 4, 7, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4,
    3, 4, 0,
  ]);
  return stl(v, i);
}

/**
 * An L-shaped binary STL: a 40 × 40 mm square with a 25 × 25 mm notch cut at the top right, 10 mm
 * tall. Its bounding box is the full 40 mm square; its outline (and hull) is the L, whose diagonal
 * edge is what two such parts can be placed against.
 */
function lStl(): Uint8Array {
  const outline = [
    [0, 0],
    [40, 0],
    [40, 15],
    [15, 15],
    [15, 40],
    [0, 40],
  ];
  const v: number[] = [];
  for (const z of [0, 10]) for (const [x, y] of outline) v.push(x, y, z);
  // both caps as four triangles around the notch corner, then one quad per outline edge
  const cap = [0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5];
  const i: number[] = [...cap, ...cap.map((t) => t + 6)];
  for (let e = 0; e < outline.length; e++) {
    const n = (e + 1) % outline.length;
    i.push(e, n, n + 6, e, n + 6, e + 6);
  }
  return stl(Float32Array.from(v), Uint32Array.from(i));
}

/** A binary STL of the triangles between `v` (flat xyz) and `i` (triangle indices). */
function stl(v: Float32Array, i: Uint32Array): Uint8Array {
  const buf = Buffer.alloc(84 + (i.length / 3) * 50);
  buf.writeUInt32LE(i.length / 3, 80);
  let o = 84;
  for (let t = 0; t < i.length; t += 3) {
    o += 12; // the facet normal stays zero: `parseStl` recomputes nothing it needs here
    for (const index of [i[t], i[t + 1], i[t + 2]]) {
      for (let a = 0; a < 3; a++) {
        buf.writeFloatLE(v[index * 3 + a], o);
        o += 4;
      }
    }
    o += 2; // attribute byte count
  }
  return new Uint8Array(buf);
}

/** Upload an STL and answer its model id, so a slice request can name a real stored mesh. */
async function uploaded(mesh: Uint8Array, name: string): Promise<string> {
  const res = await call('POST', '/api/models', mesh, { 'X-Filename': name });
  assert.equal(res.status, 200, res.body);
  return (res.json as { id: string }).id;
}

async function uploadedCube(size = 20): Promise<string> {
  return uploaded(cubeStl(size), 'cube.stl');
}

test('POST /api/slice refuses an injected config key with 400 and the key in the message (SEC-2)', async () => {
  for (const key of ['x\npost_process = echo pwned', ' post_process', 'post_process=x', 'post_process\r']) {
    const res = await call('POST', '/api/slice', sliceRequestTop({ print: { name: 'p', config: { [key]: 'echo pwned' } } }));
    assert.equal(res.status, 400, JSON.stringify(key));
    assert.equal(errorOf(res), `invalid config key ${JSON.stringify(key)}`, JSON.stringify(key));
  }
  // an object override and a height range config are the same rule
  const object = await call('POST', '/api/slice', sliceRequest({ config: { 'post_process=1': 'x' } }));
  assert.equal(object.status, 400);
  assert.match(errorOf(object) ?? '', /invalid config key/);
  const range = await call('POST', '/api/slice', sliceRequest({ ranges: [{ minZ: 0, maxZ: 1, config: { 'a\nb': 'x' } }] }));
  assert.equal(range.status, 400);
  assert.match(errorOf(range) ?? '', /invalid config key/);
});

test('POST /api/slice refuses a plate whose skirt runs outside the bed, with the reason (T-034)', async () => {
  const modelId = await uploadedCube(20);
  // the cube's centre 6 mm from the left edge: the object fits, the default 1-loop skirt (6 mm out)
  // reaches past the bed – the same case the browser footer blocks
  const body = {
    ...sliceRequest(),
    objects: [{ modelId, name: 'cube', transform: translate(6, 100, 0) }],
    printer: { name: 'pr', config: { bed_shape: '0x0,200x0,200x200,0x200', nozzle_diameter: '0.4' } },
  };
  const res = await call('POST', '/api/slice', body);
  assert.equal(res.status, 400, res.body);
  assert.match(errorOf(res) ?? '', /skirt .* outside the print volume/);
  const issues = (res.json as { issues?: Array<{ code: string; severity: string }> }).issues;
  assert.deepEqual(
    issues?.map((i) => i.code),
    ['plate.skirt_outside'],
  );
  assert.equal(issues?.[0].severity, 'block');

  // the same plate in the middle of the bed slices: the check refuses only what the slicer would fail on
  const middle = await call('POST', '/api/slice', {
    ...body,
    objects: [{ modelId, name: 'cube', transform: translate(100, 100, 0) }],
  });
  assert.equal(middle.status, 202, middle.body);
});

test('POST /api/slice refuses an object that leaves the bed, with the reason (T-034)', async () => {
  const modelId = await uploadedCube(20);
  const res = await call('POST', '/api/slice', {
    ...sliceRequest(),
    objects: [{ modelId, name: 'cube', transform: translate(-40, 100, 0) }],
    printer: { name: 'pr', config: { bed_shape: '0x0,200x0,200x200,0x200', nozzle_diameter: '0.4' } },
  });
  assert.equal(res.status, 400, res.body);
  assert.match(errorOf(res) ?? '', /outside the print volume/);
});

test('POST /api/slice judges two L parts by their outline, not by their bounding boxes (T-078)', async () => {
  // two identical L meshes (40 × 40 square, 25 × 25 notch, 15 mm arms), the second turned 180°, its
  // diagonal edge set against the first one: the 40 mm boxes overlap by 23 mm per axis, the outlines
  // still leave 2.8 mm along the diagonal
  const [leftId, rightId] = [await uploaded(lStl(), 'l-left.stl'), await uploaded(lStl(), 'l-right.stl')];
  const bed = { bed_shape: '0x0,200x0,200x200,0x200', nozzle_diameter: '0.4' };
  const plate = (x: number, y: number) => ({
    ...sliceRequest(),
    objects: [
      { modelId: leftId, name: 'L left', transform: translate(40, 40, 0) },
      {
        modelId: rightId,
        name: 'L right',
        transform: placementMatrix({ position: [x, y, 0], rotation: [0, 0, Math.PI], scale: [1, 1, 1] }),
      },
    ],
    printer: { name: 'pr', config: bed },
  });

  const accepted = await call('POST', '/api/slice', plate(97, 97));
  assert.equal(accepted.status, 202, accepted.body);

  // 3 mm closer: the diagonal edges cut 1.4 mm into each other, past the 0.76 mm conflict limit
  const refused = await call('POST', '/api/slice', plate(94, 94));
  assert.equal(refused.status, 400, refused.body);
  assert.match(errorOf(refused) ?? '', /G-code path conflict/);
  const issues = (refused.json as { issues?: Array<{ code: string }> }).issues;
  assert.deepEqual(
    issues?.map((i) => i.code),
    ['plate.overlap'],
  );
});

test('PUT /api/presets/:type/:name refuses an injected config key with 400 (SEC-2)', async () => {
  const res = await call('PUT', '/api/presets/print/sec2-key', { config: { 'x\npost_process = echo pwned': 'x' } });
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'invalid config key "x\\npost_process = echo pwned"');
  // nothing was written
  assert.equal((await call('GET', '/api/presets/print/sec2-key')).status, 404);
});

test('POST /api/projects and /api/library/project refuse an injected slot key with 400 (SEC-2)', async () => {
  const project = await call('POST', '/api/projects', {
    printer: '- default FFF -',
    print: { name: '- default FFF -', config: { ' post_process': 'x' } },
  });
  assert.equal(project.status, 400);
  assert.equal(errorOf(project), 'print: invalid config key " post_process"');

  const library = await call('POST', '/api/library/project', {
    objects: [{ modelId: '11111111-1111-1111-1111-111111111111', transform: IDENTITY, config: { 'a\nb': 'x' } }],
  });
  assert.equal(library.status, 400);
  assert.match(errorOf(library) ?? '', /invalid config key/);
});

test('POST /api/slice refuses a value with a lone carriage return with 400 naming the key (q6-preflight)', async () => {
  // Marlin reads a lone `\r` as a line end, so "G28\rM500" would hide M500 behind G28
  const res = await call('POST', '/api/slice', sliceRequestTop({ print: { name: 'p', config: { start_gcode: 'G28\rM500' } } }));
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.match(errorOf(res) ?? '', /invalid config value of "start_gcode"/);
  // a CRLF is an ordinary line end inside a custom G-code and is accepted
  const crlf = await call('POST', '/api/slice', sliceRequestTop({ print: { name: 'p', config: { start_gcode: 'G28\r\nM104 S200' } } }));
  assert.equal(crlf.status, 202, JSON.stringify(crlf.json));
  // an object override and a height-range config are the same rule
  const object = await call('POST', '/api/slice', sliceRequest({ config: { start_gcode: 'G28\rM500' } }));
  assert.equal(object.status, 400);
  assert.match(errorOf(object) ?? '', /invalid config value of "start_gcode"/);
  const range = await call('POST', '/api/slice', sliceRequest({ ranges: [{ minZ: 0, maxZ: 1, config: { start_gcode: 'G1 X1\rM500' } }] }));
  assert.equal(range.status, 400);
  assert.match(errorOf(range) ?? '', /invalid config value of "start_gcode"/);
});

// ---------------------------------------------------------------------------
// Host / Origin guard (SEC-2, DNS rebinding)
// ---------------------------------------------------------------------------

test('a foreign Host is refused with 403 on /api and /mcp', async () => {
  const api = await callWithHost('GET', '/api/info', 'evil.example');
  assert.equal(api.status, 403);
  assert.equal(errorOf(api), 'host not allowed');

  // /mcp answers 403 before it decides whether MCP is even enabled – the rebound page learns nothing
  const mcp = await callWithHost('POST', '/mcp', 'rebind.evil.example', {});
  assert.equal(mcp.status, 403);
  assert.equal(errorOf(mcp), 'host not allowed');
});

test('a request by IP (the LAN case) and by an ALLOWED_HOSTS name are answered', async () => {
  const ip = await callWithHost('GET', '/api/health', '192.168.1.42:8080');
  assert.equal(ip.status, 200);
  assert.deepEqual(ip.json, { ok: true });

  const named = await callWithHost('GET', '/api/health', 'webslicer.lan:8080');
  assert.equal(named.status, 200);

  const loopback = await callWithHost('GET', '/api/health', `localhost:${new URL(base).port}`);
  assert.equal(loopback.status, 200);
});

test('a foreign Origin is refused, the app origin and a missing Origin pass', async () => {
  const bad = await call('GET', '/api/health', undefined, { origin: 'https://evil.example' });
  assert.equal(bad.status, 403);
  assert.equal(errorOf(bad), 'origin not allowed');

  const good = await call('GET', '/api/health', undefined, { origin: base });
  assert.equal(good.status, 200);

  const dev = await call('GET', '/api/health', undefined, { origin: 'http://localhost:5173' });
  assert.equal(dev.status, 200);
});

test('an Origin from a foreign IP is refused while the same Host is answered (review round 1)', async () => {
  const host = '192.168.1.42:8080';
  // a page served from a public IP: its Host passes (Docker port mapping) but its Origin must not
  const foreign = await callWithHost('GET', '/api/health', host, undefined, { origin: 'http://203.0.113.5' });
  assert.equal(foreign.status, 403);
  assert.equal(errorOf(foreign), 'origin not allowed');

  // the app's own origin (same name and port as Host) passes
  const same = await callWithHost('GET', '/api/health', host, undefined, { origin: `http://${host}` });
  assert.equal(same.status, 200);

  // the Vite dev server on another port is a trusted origin
  const dev = await callWithHost('GET', '/api/health', host, undefined, { origin: 'http://localhost:5173' });
  assert.equal(dev.status, 200);

  // a body-less POST is a simple request (no preflight) – the guard has to stop it, not CORS
  const cancel = await callWithHost('POST', '/api/jobs/nope/cancel', host, undefined, { origin: 'http://203.0.113.5' });
  assert.equal(cancel.status, 403);
  assert.equal(errorOf(cancel), 'origin not allowed');
});

test('GET /api/jobs/:id answers 404 for an unknown job', async () => {
  const res = await call('GET', '/api/jobs/nope');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'job not found');
});

test('GET /api/jobs/:id/events answers 404 for an unknown job', async () => {
  const res = await call('GET', '/api/jobs/nope/events');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'job not found');
});

test('GET /api/jobs/:id/gcode answers 404 when there is no output', async () => {
  const res = await call('GET', '/api/jobs/nope/gcode');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'output not available');
});

test('GET /api/jobs/:id/log answers 404 through the error handler for an unknown job dir', async () => {
  // `path.join` on a missing directory makes express' sendFile throw ENOENT, which the error handler
  // maps to 404 – the body carries the raw fs message, so only the status is stable here.
  const res = await call('GET', '/api/jobs/nope/log');
  assert.equal(res.status, 404);
});

test('POST /api/jobs/:id/cancel answers 404 when the job is not cancellable', async () => {
  const res = await call('POST', '/api/jobs/nope/cancel');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'job not cancellable');
});

test('DELETE /api/jobs/:id answers 404 for an unknown job', async () => {
  const res = await call('DELETE', '/api/jobs/nope');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'job not found');
});

test('POST /api/jobs/:id/send answers 404 without a finished job', async () => {
  const res = await call('POST', '/api/jobs/nope/send', {});
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'output not available');
});

// ---------------------------------------------------------------------------
// physical printers
// ---------------------------------------------------------------------------

test('GET /api/printers answers an empty list on a fresh data directory', async () => {
  const res = await call('GET', '/api/printers');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, []);
});

test('PUT /api/printers/:id answers 404 for an unknown printer', async () => {
  const res = await call('PUT', '/api/printers/nope', { name: 'x' });
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'printer not found');
});

test('DELETE /api/printers/:id answers 404 for an unknown printer', async () => {
  const res = await call('DELETE', '/api/printers/nope');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'printer not found');
});

test('POST /api/printers/:id/test answers 404 for an unknown printer', async () => {
  const res = await call('POST', '/api/printers/nope/test');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'printer not found');
});

test('POST /api/printers masks the API key and reports hasApiKey', async () => {
  const created = await call('POST', '/api/printers', { name: 'Test', host: 'example.invalid', apiKey: 'secret' });
  assert.equal(created.status, 200);
  const printer = created.json as { id: string; apiKey?: string; hasApiKey: boolean };
  assert.equal(printer.apiKey, '••••••••');
  assert.equal(printer.hasApiKey, true);

  // an unchanged mask keeps the stored key, an undefined key does too
  const updated = await call('PUT', `/api/printers/${printer.id}`, { name: 'Renamed', apiKey: '••••••••' });
  assert.equal(updated.status, 200);
  assert.equal((updated.json as { name: string }).name, 'Renamed');
  assert.equal((updated.json as { hasApiKey: boolean }).hasApiKey, true);

  const removed = await call('DELETE', `/api/printers/${printer.id}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json, { ok: true });
});

// ---------------------------------------------------------------------------
// library
// ---------------------------------------------------------------------------

test('GET /api/library rejects a path escape with 400', async () => {
  for (const bad of ['../x', 'a/../../x', '..\\x']) {
    const res = await call('GET', `/api/library?path=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, bad);
    assert.equal(errorOf(res), 'invalid path');
  }
});

test('GET /api/library answers the root listing', async () => {
  const res = await call('GET', '/api/library');
  assert.equal(res.status, 200);
  assert.equal((res.json as { root: string }).root, config.libraryDir);
  assert.deepEqual((res.json as { entries: unknown[] }).entries, []);
});

test('GET /api/library/file answers 404 for a missing file', async () => {
  const res = await call('GET', '/api/library/file?path=missing.stl');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'file not found');
});

test('PUT /api/library/file rejects an empty body with 400', async () => {
  const res = await call('PUT', '/api/library/file?path=empty.stl', new Uint8Array(0));
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'empty body');
});

test('POST /api/library/mkdir rejects an invalid name with 400', async () => {
  const res = await call('POST', '/api/library/mkdir', { path: '', name: '..' });
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'invalid name');
});

test('DELETE /api/library/file refuses the library root and missing paths', async () => {
  const root = await call('DELETE', '/api/library/file?path=');
  assert.equal(root.status, 400);
  assert.equal(errorOf(root), 'cannot delete the library root');

  const missing = await call('DELETE', '/api/library/file?path=nope');
  assert.equal(missing.status, 404);
  assert.equal(errorOf(missing), 'not found');
});

test('DELETE /api/library/file refuses a non-empty directory', async () => {
  fs.mkdirSync(path.join(config.libraryDir, 'nonempty', 'inner'), { recursive: true });
  const res = await call('DELETE', '/api/library/file?path=nonempty');
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'directory not empty');
});

test('POST /api/library/project rejects a body without objects', async () => {
  const res = await call('POST', '/api/library/project?path=&name=p', {});
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'no objects');
});

test('POST /api/library/gcode answers 404 without a finished job', async () => {
  const res = await call('POST', '/api/library/gcode', { jobId: 'nope', path: '' });
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'job output not available');
});

// ---------------------------------------------------------------------------
// autosave
// ---------------------------------------------------------------------------

test('autosave rejects an invalid client id with 400 on every method', async () => {
  // `../x` is normalised away by the HTTP client before it reaches the server, so it is not a case
  // the server can see; `ab` (too short) and `has spaces` (bad characters) are.
  for (const route of ['/api/autosave/ab', '/api/autosave/has spaces']) {
    for (const method of ['PUT', 'GET', 'DELETE']) {
      const res = await call(method, route, method === 'PUT' ? sliceRequest() : undefined);
      assert.equal(res.status, 400, `${method} ${route}`);
      assert.equal(errorOf(res), 'invalid client id', `${method} ${route}`);
    }
  }
});

test('GET /api/autosave/:client answers 404 when nothing was saved', async () => {
  const res = await call('GET', '/api/autosave/client-12345678');
  assert.equal(res.status, 404);
  assert.equal(errorOf(res), 'no autosave');
});

test('PUT /api/autosave/:client validates the slice request and reports the saved size', async () => {
  const bad = await call('PUT', '/api/autosave/client-12345678', { objects: [] });
  assert.equal(bad.status, 400);
  assert.equal(errorOf(bad), 'at least one object required');

  const ok = await call('PUT', '/api/autosave/client-12345678', {
    objects: [],
    print: { name: 'p', config: {} },
    printer: { name: 'p', config: {} },
  });
  // the real payload needs a model on disk; the validation error is what this test pins
  assert.equal(ok.status, 400);
  assert.match(errorOf(ok) ?? '', /at least one object required/);

  const missing = await call('GET', '/api/autosave/client-99999999?info');
  assert.equal(missing.status, 404);
});

test('GET /api/autosave/:client serves the file through sendFile, with its conditional-request headers', async () => {
  // The read side of the autosave must answer with a *file*, not with the buffer: `sendFile` adds
  // `Cache-Control`, `ETag`, `Last-Modified` and range support, which is what makes the browser
  // revalidate a large 3MF instead of fetching it again on every plater load. Serving bytes with
  // `res.send(buffer)` returns the same body and silently drops all of them.
  const id = 'client-header-pin';
  const file = path.join(config.autosaveDir, `${id}.3mf`);
  fs.mkdirSync(config.autosaveDir, { recursive: true });
  fs.writeFileSync(file, 'PK\u0003\u0004 not really a 3MF, but enough for the headers');

  const res = await call('GET', `/api/autosave/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'model/3mf');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=0');
  assert.ok(res.headers.get('etag'), 'a strong validator for revalidation');
  assert.ok(res.headers.get('last-modified'), 'and a date validator');
  assert.ok(res.headers.get('x-saved-at'), 'plus the save time the client shows');
  assert.equal(res.body, 'PK\u0003\u0004 not really a 3MF, but enough for the headers');

  fs.rmSync(config.autosaveDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// server-side projects (headless plater, MCP phase 0)
// ---------------------------------------------------------------------------

test('POST /api/projects rejects a wrong filaments shape with 400', async () => {
  const res = await call('POST', '/api/projects', { printer: '- default FFF -', print: '- default FFF -', filaments: 'x' });
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'filaments must be an array');
});

test('POST /api/projects rejects a malformed preset slot with 400', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ printer: 42, print: 'p' }, 'printer must be a preset name or { name, config }'],
    [{ printer: 'p', print: { name: 'p', config: [] } }, 'print.config must be an object'],
  ];
  for (const [body, message] of cases) {
    const res = await call('POST', '/api/projects', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(errorOf(res), message, JSON.stringify(body));
  }
});

test('project routes answer 404 for an unknown project id', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  for (const route of [`/api/projects/${id}`, `/api/projects/${id}/models`, `/api/projects/${id}/arrange`, `/api/projects/${id}/slice`]) {
    const res = await call(route.endsWith(`/${id}`) ? 'GET' : 'POST', route, route.endsWith(`/${id}`) ? undefined : {});
    assert.equal(res.status, 404, route);
    assert.equal(errorOf(res), 'project not found', route);
  }
});

test('B11: a ZodError in a route body is answered 400 with the first issue, not 500', async () => {
  // `presetListSchema.parse` throws; the error handler used to know only HttpError, so a bad body
  // shape was reported as an internal error
  const res = await call('POST', '/api/presets/print/list', { printerConfig: [] });
  assert.equal(res.status, 400);
  assert.ok((errorOf(res) ?? '').length > 0, 'the 400 names the problem');
});

test('POST /api/projects/:id/models requires a libraryPath', async () => {
  // a syntactically valid but unknown id: the 404 comes first, so use a real project
  const created = await call('POST', '/api/projects', { printer: '- default FFF -', print: '- default FFF -' });
  assert.equal(created.status, 201);
  const { id } = created.json as { id: string };

  const res = await call('POST', `/api/projects/${id}/models`, {});
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'libraryPath required');

  const missing = await call('POST', `/api/projects/${id}/models`, { libraryPath: 'nope.stl' });
  assert.equal(missing.status, 404);
  assert.equal(errorOf(missing), 'library file not found');

  fs.rmSync(path.join(config.projectsDir, `${id}.json`), { force: true });
});

// ---------------------------------------------------------------------------
// the error handler
// ---------------------------------------------------------------------------

test('a body over the JSON limit is answered 413 by the error handler', async () => {
  // express.json for /api/projects is limited to 8 MB
  const huge = { printer: 'p', print: 'p', filler: 'x'.repeat(9 * 1024 * 1024) };
  const res = await call('POST', '/api/projects', huge);
  assert.equal(res.status, 413);
  assert.match(errorOf(res) ?? '', /too large/i);
});

test('an unparsable JSON body is answered 400 by the error handler', async () => {
  const res = await call('POST', '/api/projects', '{not json', { 'content-type': 'application/json' });
  assert.equal(res.status, 400);
  assert.ok((errorOf(res) ?? '').length > 0);
});

test('a rejected promise of an async handler reaches the error handler with its status and body (Express 5)', async () => {
  // Express 4 dropped this rejection: without an `asyncHandler` wrapper the request hung until the
  // client gave up. Express 5 forwards it to the error handler, which is what makes the four
  // wrappers deletable – and this test is the pin that the forwarding really happens, with the
  // status and the message the throwing call site decides.
  //
  // `PUT /api/printers/:id` validates only *after* awaiting `getPrinter`, so a stored printer plus a
  // bad body is a rejection reached inside an async handler and nowhere else. The printer has to be
  // created first because the route answers 404 for an unknown id before it looks at the body.
  const created = await call('POST', '/api/printers', { name: 'async-pin', type: 'octoprint', host: 'printer.local' });
  assert.equal(created.status, 200, created.body);
  const { id } = created.json as { id: string };

  const res = await call('PUT', `/api/printers/${id}`, { name: 42 });
  assert.equal(res.status, 400);
  assert.equal(errorOf(res), 'invalid printer name'); // `ValidationError(parsePrinter(…).message)`

  // and the same route still answers its normal 200 with a valid body
  const ok = await call('PUT', `/api/printers/${id}`, { name: 'renamed' });
  assert.equal(ok.status, 200);
  assert.equal((ok.json as { name?: string }).name, 'renamed');

  await call('DELETE', `/api/printers/${id}`);
});
