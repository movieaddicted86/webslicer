/**
 * The payload schemas of R-10: the field rules of the printers, projects, presets and library bodies.
 *
 * These are *new* errors – the routes they replace read the fields by hand (`String(body.host || '')`,
 * `typeof x === 'string'`), so on `main` a body that breaks a rule was either coerced into something
 * the store or the host could not use, or crashed the handler with a 500. The messages pinned here are
 * therefore the R-10 contract, and `routes/http.test.ts` pins the status codes the routes answer with
 * them. The slice request is pinned separately (`services/slice.test.ts`), rule for rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrinter, parsePrinterTest, printerHost, installedPrintersOf, jobSendSchema } from './printers.js';
import { copiesOf, parseProjectCreate, projectModelsSchema, projectSliceSchema } from './projects.js';
import { presetBodySchema } from './presets.js';
import { libraryGcodeSchema, libraryMkdirSchema, libraryProjectSchema } from './library.js';

const UUID = '11111111-1111-1111-1111-111111111111';
const messageOf = (r: { ok: boolean; message?: string }): string => (r.ok ? '<no error>' : String(r.message));

// ---------------------------------------------------------------------------
// printers
// ---------------------------------------------------------------------------

test('a printer body may be missing entirely (the store falls back to host, then "Printer")', () => {
  for (const body of [undefined, null, {}, { name: '' }, { host: '' }]) {
    assert.equal(parsePrinter(body).ok, true, JSON.stringify(body));
  }
});

test('a printer body accepts the fields a client owns', () => {
  const parsed = parsePrinter({
    id: 'p1',
    name: 'Workshop',
    type: 'prusalink',
    host: '10.0.0.5',
    apiKey: 'secret',
    presetName: 'MK4S',
    ignoreTls: true,
    somethingElse: 1,
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.printer, {
    id: 'p1',
    name: 'Workshop',
    type: 'prusalink',
    host: '10.0.0.5',
    apiKey: 'secret',
    presetName: 'MK4S',
    ignoreTls: true,
    somethingElse: 1, // a loose object keeps what it does not know
  });
});

test('every printer field of the wrong type is named in the message', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ name: 1 }, 'invalid printer name'],
    [{ type: 'nope' }, 'invalid printer type nope'],
    [{ type: 'octoprint', host: 10 }, 'invalid host'],
    [{ apiKey: 42 }, 'invalid API key'],
    [{ id: 7 }, 'invalid printer id'],
    [{ presetName: [] }, 'invalid preset name'],
    [{ ignoreTls: 'yes' }, 'invalid ignoreTls'],
  ];
  for (const [body, expected] of cases) {
    assert.equal(messageOf(parsePrinter(body)), expected, JSON.stringify(body));
  }
});

test('the test endpoint takes the host, type, key and TLS flag only', () => {
  assert.equal(messageOf(parsePrinterTest({ name: 1 })), '<no error>'); // a field it does not own is ignored
  assert.equal(messageOf(parsePrinterTest({ host: 10 })), 'invalid host');
  assert.equal(messageOf(parsePrinterTest({ type: 'nope' })), 'invalid printer type nope');
});

test('a host gets its scheme and loses trailing slashes, the path stays', () => {
  assert.equal(printerHost('10.0.0.5'), 'http://10.0.0.5');
  assert.equal(printerHost('10.0.0.5/'), 'http://10.0.0.5');
  assert.equal(printerHost('http://10.0.0.5//'), 'http://10.0.0.5');
  assert.equal(printerHost('https://print.local/'), 'https://print.local');
  assert.equal(printerHost('print.local:7125/sub'), 'http://print.local:7125/sub');
  assert.equal(printerHost(undefined), 'http://');
});

test('the installed-printer list skips entries without a vendor or model, and survives junk', () => {
  assert.deepEqual(installedPrintersOf([{ vendorId: 'PrusaResearch', modelId: 'MK4S', variant: 'HF0.4' }]), [
    { vendorId: 'PrusaResearch', modelId: 'MK4S', variant: 'HF0.4' },
  ]);
  // a missing variant becomes an empty string, a numeric one is stringified
  assert.deepEqual(installedPrintersOf([{ vendorId: 'v', modelId: 'm' }]), [{ vendorId: 'v', modelId: 'm', variant: '' }]);
  assert.deepEqual(installedPrintersOf([{ vendorId: 'v', modelId: 'm', variant: 4 }]), [{ vendorId: 'v', modelId: 'm', variant: '4' }]);
  // one bad entry does not drop the others
  assert.deepEqual(installedPrintersOf([{ modelId: 'm' }, null, 'x', { vendorId: 'v', modelId: 'm2' }]), [
    { vendorId: 'v', modelId: 'm2', variant: '' },
  ]);
  assert.deepEqual(installedPrintersOf('nope'), []);
  assert.deepEqual(installedPrintersOf(undefined), []);
});

test('the send body reads a printer id and a file name only when they are strings', () => {
  assert.deepEqual(jobSendSchema.parse({ printerId: 'p1', filename: 'a.gcode', startPrint: 1 }), {
    printerId: 'p1',
    filename: 'a.gcode',
    startPrint: true,
  });
  // a non-string name falls back to the job's own output name (it used to crash the handler)
  assert.deepEqual(jobSendSchema.parse({ printerId: 5, filename: 7 }), { startPrint: false });
  assert.deepEqual(jobSendSchema.parse({}), { startPrint: false });
});

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

test('a project slot is a preset name or { name, config }', () => {
  const parsed = parseProjectCreate({ printer: 'MK4S', print: { name: '0.20mm', config: { infill: '20%' } } });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.printer, { name: 'MK4S', config: {} });
  assert.deepEqual(parsed.ok && parsed.print, { name: '0.20mm', config: { infill: '20%' } });
});

test('the project body names the slot that is wrong', () => {
  const cases: Array<[unknown, string]> = [
    [{ print: 'x' }, 'printer must be a preset name or { name, config }'],
    [{ printer: 1, print: 'x' }, 'printer must be a preset name or { name, config }'],
    [{ printer: 'a', print: 1 }, 'print must be a preset name or { name, config }'],
    [{ printer: { config: [] }, print: 'a' }, 'printer.config must be an object'],
    [{ printer: 'a', print: 'b', filaments: 'nope' }, 'filaments must be an array'],
    [{ printer: 'a', print: 'b', filaments: [1] }, 'filaments[0] must be a preset name or { name, config }'],
  ];
  for (const [body, expected] of cases) {
    const parsed = parseProjectCreate(body);
    assert.equal(parsed.ok ? '<no error>' : parsed.message, expected, JSON.stringify(body));
  }
});

test('a project slot name is trimmed and an owner is read as text', () => {
  const parsed = parseProjectCreate({ printer: ' MK4S ', print: 'x', owner: 42 });
  assert.deepEqual(parsed.ok && parsed.printer, { name: 'MK4S', config: {} });
  assert.equal(parsed.ok && parsed.owner, '42');
});

test('the models body needs a non-empty library path', () => {
  for (const body of [{}, { libraryPath: '   ' }, { libraryPath: 7 }, 'nope', undefined]) {
    const bad = projectModelsSchema.safeParse(body);
    assert.equal(bad.success ? '<no error>' : bad.error.issues[0].message, 'libraryPath required', JSON.stringify(body));
  }
  assert.equal(projectModelsSchema.safeParse({ libraryPath: 'samples/cube.stl' }).success, true);
});

test('copies defaults to one and is only coerced, the store checks the range', () => {
  assert.equal(copiesOf(undefined), 1);
  assert.equal(copiesOf('3'), 3);
  assert.equal(copiesOf(2), 2);
});

test('the project slice body reads a flag and a non-empty name', () => {
  assert.deepEqual(projectSliceSchema.parse({ binaryGcode: 1, outputName: '  part  ' }), { binaryGcode: true, outputName: 'part' });
  // a name that is not a usable string leaves the project's own name alone
  assert.deepEqual(projectSliceSchema.parse({ binaryGcode: false, outputName: 7 }), { binaryGcode: false });
  assert.deepEqual(projectSliceSchema.parse({}), {});
});

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

test('a preset body needs a config object and keeps the string values', () => {
  const parsed = presetBodySchema.parse({ config: { fill_density: '20%', n: 3 }, inherits: 'x' });
  assert.deepEqual(parsed.config, { fill_density: '20%' });
  assert.equal(parsed.inherits, 'x');
});

test('a preset body without a config names the field', () => {
  const parsed = presetBodySchema.safeParse({ inherits: 'x' });
  assert.equal(parsed.success ? '' : parsed.error.issues[0].message, 'config required');
  assert.equal(presetBodySchema.safeParse({ config: null }).success, false);
  assert.equal(presetBodySchema.safeParse({}).success, false);
});

// ---------------------------------------------------------------------------
// library
// ---------------------------------------------------------------------------

test('the library bodies read their text fields the way the route did', () => {
  assert.deepEqual(libraryMkdirSchema.parse({ path: 'a', name: 0 }), { path: 'a', name: '0' });
  assert.deepEqual(libraryMkdirSchema.parse({}), { path: '', name: '' });
  assert.deepEqual(libraryGcodeSchema.parse({ jobId: 'j1', path: 'in', name: 'out.gcode' }), {
    jobId: 'j1',
    path: 'in',
    name: 'out.gcode',
  });
  assert.deepEqual(libraryGcodeSchema.parse({ jobId: 5 }), { jobId: '5', path: '', name: '' });
});

test('a library project needs at least one object', () => {
  assert.equal(libraryProjectSchema.safeParse({ objects: [] }).success, false);
  assert.equal(libraryProjectSchema.safeParse({}).success, false);
  assert.equal(libraryProjectSchema.safeParse({ objects: [{ modelId: UUID }] }).success, true);
});
