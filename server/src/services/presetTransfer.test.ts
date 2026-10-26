/**
 * Preset transfer: rename, bundle export/import and the rules that keep an import from widening what
 * a preset save can do (SEC-1, SEC-2, lone CR, unknown keys) – the three gaps of the task.
 *
 * The schema is the pinned PrusaSlicer 2.9.6 fixture, so "known option" means a key the real slicer
 * knows, and a tiny vendor profile supplies one system preset for the clash cases.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

// the data directory and the vendor profiles have to be redirected before anything reads them
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-transfer-'));
const PROFILES = path.join(DATA_DIR, 'vendor-profiles');
process.env.DATA_DIR = DATA_DIR;
process.env.PRUSASLICER_PROFILES = PROFILES;
delete process.env.PRUSASLICER_RESOURCES;

const { config, ensureDirs } = await import('../config.js');
const { exportBundle, filterImportedConfig, freePresetName, importBundle, previewBundle, renameUserPreset } =
  await import('./presetTransfer.js');
const { listUserPresets, saveUserPreset, userPresetExists } = await import('../slicer/presets.js');
const { listPrinters, upsertPrinter } = await import('./printers.js');
const { printerSafetyRecord, setPrinterSafety } = await import('./printerSafety.js');
const { loadProject, saveProject } = await import('./projects.js');
const { ConflictError, ValidationError } = await import('../errors.js');

const schema = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'slicer', 'fixtures', 'schema.json'), 'utf8')) as never;

const SYSTEM_PRINT = 'System Print';
const SYSTEM_PRINTER = 'System Printer';

before(() => {
  ensureDirs();
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.writeFileSync(
    path.join(PROFILES, 'Test.ini'),
    [
      '[vendor]',
      'name = Test',
      '',
      `[print:${SYSTEM_PRINT}]`,
      'layer_height = 0.3',
      '',
      `[printer:${SYSTEM_PRINTER}]`,
      'nozzle_diameter = 0.4',
      '',
    ].join('\n'),
  );
});

after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

/** Remove every user preset and print host so each test starts from an empty store. */
function emptyStore(): void {
  for (const type of ['print', 'filament', 'printer', 'sla_print', 'sla_material'] as const) {
    const dir = path.join(config.presetsDir, type);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const file of ['physical_printers.json']) fs.rmSync(path.join(config.dataDir, file), { force: true });
  fs.rmSync(config.projectsDir, { recursive: true, force: true });
  fs.rmSync(config.autosaveDir, { recursive: true, force: true });
  fs.mkdirSync(config.projectsDir, { recursive: true });
  fs.mkdirSync(config.autosaveDir, { recursive: true });
}

/** Write a user preset file directly (a bundle can carry any key, so the store must not be the writer here). */
function writePreset(type: string, name: string, body: string): void {
  const dir = path.join(config.presetsDir, type);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.ini`), body);
}

const printBody = (name: string, inherits?: string) =>
  `layer_height = 0.2\nperimeters = 3\n${inherits ? `inherits = ${inherits}\n` : ''}`.replace('NAME', name);

const bundleOf = (...sections: string[]) => ['# bundle', ...sections].join('\n');

// ---------------------------------------------------------------------------
// import: what an import may and may not do
// ---------------------------------------------------------------------------

test('a refused key is dropped and reported, the rest of the preset is imported', () => {
  emptyStore();
  const bundle = bundleOf(
    '[print:Imported print]',
    // SEC-1: PrusaSlicer would run this on the server
    'post_process = echo pwned',
    // SEC-1: it names the output file and could leave the job directory
    'output_filename_format = ../../etc/passwd',
    // SEC-2: not a well-formed config key
    'Post_Process = 1',
    // a key the installed slicer does not know
    'not_a_real_option = 1',
    // an ordinary setting survives
    'layer_height = 0.25',
  );
  const result = importBundle(bundle, [], schema);
  assert.deepEqual(result.imported, [{ type: 'print', name: 'Imported print' }]);
  const reasons = result.rejected.map((r) => r.key).sort();
  assert.deepEqual(reasons, ['Post_Process', 'not_a_real_option', 'output_filename_format', 'post_process']);
  const stored = listUserPresets('print').find((p) => p.name === 'Imported print');
  assert.deepEqual(stored?.config, { layer_height: '0.25' });
});

test('a value with a lone carriage return is refused, the preset keeps its other keys', () => {
  emptyStore();
  // a lone \r would hide "M500" from a reader that only splits on \n; `end_gcode` is a printer key
  const bundle = bundleOf('[printer:CR printer]', 'nozzle_diameter = 0.4', 'end_gcode = G28\rM500');
  const result = importBundle(bundle, [], schema);
  assert.deepEqual(
    result.rejected.map((r) => r.key),
    ['end_gcode'],
  );
  assert.match(result.rejected[0].reason, /carriage return/);
  assert.deepEqual(listUserPresets('printer').find((p) => p.name === 'CR printer')?.config, { nozzle_diameter: '0.4' });
});

test('a name clash needs an explicit answer: without one nothing is written', () => {
  emptyStore();
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  const bundle = bundleOf('[print:Mine]', 'layer_height = 0.3');
  assert.throws(
    () => importBundle(bundle, [], schema),
    (e: unknown) => e instanceof ValidationError && /already exists/.test(e.message),
  );
  assert.equal(listUserPresets('print').find((p) => p.name === 'Mine')?.config.layer_height, '0.2');
});

test('"skip" leaves the existing preset, "overwrite" replaces it', () => {
  emptyStore();
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  const bundle = bundleOf('[print:Mine]', 'layer_height = 0.3');
  const skipped = importBundle(bundle, [{ type: 'print', name: 'Mine', system: false, choice: 'skip' }], schema);
  assert.deepEqual(skipped.skipped, [{ type: 'print', name: 'Mine', system: false }]);
  assert.equal(listUserPresets('print')[0].config.layer_height, '0.2');

  const overwritten = importBundle(bundle, [{ type: 'print', name: 'Mine', system: false, choice: 'overwrite' }], schema);
  assert.deepEqual(overwritten.imported, [{ type: 'print', name: 'Mine' }]);
  assert.equal(listUserPresets('print')[0].config.layer_height, '0.3');
});

test('"keep both" stores the new preset under a free suffix', () => {
  emptyStore();
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  const result = importBundle(
    bundleOf('[print:Mine]', 'layer_height = 0.3'),
    [{ type: 'print', name: 'Mine', system: false, choice: 'keep-both' }],
    schema,
  );
  assert.deepEqual(result.imported, [{ type: 'print', name: 'Mine', storedAs: 'Mine (imported)' }]);
  assert.equal(userPresetExists('print', 'Mine'), true);
  assert.equal(userPresetExists('print', 'Mine (imported)'), true);
});

test('two "keep both" answers in one bundle do not land on the same name', () => {
  emptyStore();
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  const result = importBundle(
    bundleOf('[print:Mine]', 'layer_height = 0.3'),
    [{ type: 'print', name: 'Mine', system: false, choice: 'keep-both' }],
    schema,
  );
  assert.equal(result.imported[0].storedAs, 'Mine (imported)');
  // the second import has to see the name the first one took
  const again = importBundle(
    bundleOf('[print:Mine]', 'layer_height = 0.4'),
    [{ type: 'print', name: 'Mine', system: false, choice: 'keep-both' }],
    schema,
  );
  assert.equal(again.imported[0].storedAs, 'Mine (imported 2)');
});

test('a system preset is never overwritten – the import is refused and writes nothing', () => {
  emptyStore();
  const bundle = bundleOf(`[print:${SYSTEM_PRINT}]`, 'layer_height = 0.1', '[print:Second]', 'layer_height = 0.2');
  assert.throws(
    () => importBundle(bundle, [{ type: 'print', name: SYSTEM_PRINT, system: true, choice: 'overwrite' }], schema),
    (e: unknown) => e instanceof ValidationError && /system preset/.test(e.message),
  );
  // the preview says it is a system preset, and the second preset was not written either
  assert.deepEqual(previewBundle(bundle, schema).clashes, [{ type: 'print', name: SYSTEM_PRINT, system: true }]);
  assert.deepEqual(listUserPresets('print'), []);
});

test('a preset unstorable under its own name is reported instead of being renamed silently', () => {
  emptyStore();
  const preview = previewBundle(bundleOf('[print:- default -]', 'layer_height = 0.2', '[print:absent]', 'layer_height = 0.3'), schema);
  assert.deepEqual(
    preview.invalid.map((i) => [i.name, i.reason]),
    [['- default -', 'unusable preset name']],
  );
  assert.deepEqual(
    preview.presets.map((p) => p.name),
    ['absent'],
  );
});

test('an empty bundle and an oversized one are client errors', () => {
  assert.throws(
    () => previewBundle('   \n', schema),
    (e: unknown) => e instanceof ValidationError && /empty/.test(e.message),
  );
  assert.throws(
    () => previewBundle('x'.repeat(4 * 1024 * 1024 + 1), schema),
    (e: unknown) => e instanceof ValidationError && /too large/.test(e.message),
  );
});

test('filterImportedConfig keeps a known key with a string value', () => {
  const filtered = filterImportedConfig(schema, 'print', 'x', { layer_height: '0.2', perimeters: '3' });
  assert.deepEqual(filtered, { config: { layer_height: '0.2', perimeters: '3' }, rejected: [] });
});

test('freePresetName skips names a bundle of the same import already claimed', () => {
  emptyStore();
  assert.equal(freePresetName('print', 'A', new Set(['A', 'A (imported)'])), 'A (imported 2)');
});

// ---------------------------------------------------------------------------
// export: everything, and only what may travel
// ---------------------------------------------------------------------------

test('the export carries every user preset and no print-host credentials', async () => {
  emptyStore();
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  saveUserPreset('filament', 'My PLA', { temperature: '215' });
  saveUserPreset('printer', 'My MK4S', { nozzle_diameter: '0.4' });
  await upsertPrinter({ name: 'Garage', type: 'prusalink', host: 'http://192.168.1.50', apiKey: 'secret-key', presetName: 'My MK4S' });
  const text = await exportBundle();
  assert.match(text, /\[print:Mine\]/);
  assert.match(text, /\[filament:My PLA\]/);
  assert.match(text, /\[printer:My MK4S\]/);
  assert.match(text, /\[physical_printer:Garage\]/);
  assert.match(text, /printer_preset = My MK4S/);
  assert.doesNotMatch(text, /secret-key|192\.168\.1\.50/);
});

test('export → empty store → import gives the same presets back', async () => {
  emptyStore();
  saveUserPreset('print', 'Round trip', { layer_height: '0.2', perimeters: '3' });
  saveUserPreset('filament', 'Round trip PLA', { temperature: '215' });
  saveUserPreset('print', 'Child', { perimeters: '4' }, 'Round trip');
  const before = ['print', 'filament', 'printer'].flatMap((type) => listUserPresets(type as never).map((p) => [type, p.name, p.config]));
  const text = await exportBundle();

  emptyStore();
  const result = importBundle(text, [], schema);
  assert.equal(result.imported.length, 3);
  assert.deepEqual(result.rejected, []);
  const after = ['print', 'filament', 'printer'].flatMap((type) => listUserPresets(type as never).map((p) => [type, p.name, p.config]));
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// rename: references follow, clashes refuse, a failure changes nothing
// ---------------------------------------------------------------------------

test('rename moves the file and points inheriting presets at the new name', async () => {
  emptyStore();
  saveUserPreset('print', 'Parent', { layer_height: '0.2' });
  saveUserPreset('print', 'Child', { perimeters: '4' }, 'Parent');
  const result = await renameUserPreset('print', 'Parent', 'Renamed parent');
  assert.deepEqual(result, { type: 'print', from: 'Parent', to: 'Renamed parent', inheritedBy: 1, printers: 0, projects: 0, autosaves: 0 });
  assert.equal(userPresetExists('print', 'Parent'), false);
  assert.equal(userPresetExists('print', 'Renamed parent'), true);
  assert.equal(listUserPresets('print').find((p) => p.name === 'Child')?.config.inherits, 'Renamed parent');
});

test('rename updates the preset a print host is bound to', async () => {
  emptyStore();
  saveUserPreset('printer', 'My MK4S', { nozzle_diameter: '0.4' });
  await upsertPrinter({ name: 'Garage', type: 'prusalink', host: 'http://192.168.1.50', presetName: 'My MK4S' });
  const result = await renameUserPreset('printer', 'My MK4S', 'MK4S at home');
  assert.equal(result.printers, 1);
  assert.equal((await listPrinters())[0].presetName, 'MK4S at home');
});

test('rename carries the printer-safety answer to the new preset name (T-085)', async () => {
  emptyStore();
  saveUserPreset('printer', 'My MK4S', { nozzle_diameter: '0.4' });
  await setPrinterSafety('My MK4S', { hotendType: 'ptfe', maxHotend: 240 });
  await renameUserPreset('printer', 'My MK4S', 'MK4S at home');
  const record = await printerSafetyRecord();
  assert.deepEqual(record['MK4S at home'], { hotendType: 'ptfe', maxHotend: 240 });
  assert.equal(record['My MK4S'], undefined, 'the old key does not keep a stale answer');
});

test('a failed rename leaves the printer-safety answer where it was', async () => {
  emptyStore();
  saveUserPreset('printer', 'Mine', { nozzle_diameter: '0.4' });
  await setPrinterSafety('Mine', { hotendType: 'all-metal', maxHotend: 450 });
  // the target name is a system preset: the rename is refused after the safety step would have run
  await assert.rejects(renameUserPreset('printer', 'Mine', SYSTEM_PRINTER), (e: unknown) => e instanceof ConflictError);
  const record = await printerSafetyRecord();
  assert.deepEqual(record.Mine, { hotendType: 'all-metal', maxHotend: 450 });
});

test('rename updates the preset names of a stored project', async () => {
  emptyStore();
  saveUserPreset('print', 'Project print', { layer_height: '0.2' });
  const project = {
    id: '0b6b3d3e-3a1e-4d38-9d1e-1a2b3c4d5e6f',
    owner: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    printer: { name: '- default FFF -', config: {} },
    print: { name: 'Project print', config: {} },
    filaments: [{ name: '- default FFF -', config: {} }],
    objects: [],
  };
  await saveProject(structuredClone(project));
  const result = await renameUserPreset('print', 'Project print', 'Project print 2');
  assert.equal(result.projects, 1);
  const reloaded = await loadProject(project.id);
  assert.equal(reloaded?.print.name, 'Project print 2');
  assert.equal(reloaded?.filaments[0].name, '- default FFF -');
});

test('rename updates the settings id of a stored autosave', async () => {
  emptyStore();
  saveUserPreset('print', 'Autosaved print', { layer_height: '0.2' });
  const zip = new JSZip();
  zip.file('Metadata/Slic3r_PE.config', '; print_settings_id = Autosaved print\n; layer_height = 0.2\n');
  fs.mkdirSync(config.autosaveDir, { recursive: true });
  fs.writeFileSync(path.join(config.autosaveDir, 'browser.3mf'), await zip.generateAsync({ type: 'nodebuffer' }));
  const result = await renameUserPreset('print', 'Autosaved print', 'Autosaved print 2');
  assert.equal(result.autosaves, 1);
  const after = await JSZip.loadAsync(fs.readFileSync(path.join(config.autosaveDir, 'browser.3mf')));
  assert.match(await after.file('Metadata/Slic3r_PE.config')!.async('string'), /print_settings_id = Autosaved print 2/);
});

test('rename refuses a system preset target and an existing user preset (409), and changes nothing', async () => {
  emptyStore();
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  saveUserPreset('print', 'Other', { layer_height: '0.3' });
  await assert.rejects(renameUserPreset('print', 'Mine', SYSTEM_PRINT), (e: unknown) => e instanceof ConflictError);
  await assert.rejects(renameUserPreset('print', 'Mine', 'Other'), (e: unknown) => e instanceof ConflictError);
  assert.equal(userPresetExists('print', 'Mine'), true);
  assert.equal(listUserPresets('print').find((p) => p.name === 'Other')?.config.layer_height, '0.3');
});

test('rename refuses an unknown preset and an unusable name', async () => {
  emptyStore();
  await assert.rejects(renameUserPreset('print', 'no such preset', 'x'), (e: unknown) => e instanceof ValidationError);
  saveUserPreset('print', 'Mine', { layer_height: '0.2' });
  await assert.rejects(renameUserPreset('print', 'Mine', '- default -'), (e: unknown) => e instanceof ValidationError);
  assert.equal(userPresetExists('print', 'Mine'), true);
});

test('a rename that fails halfway puts every file back', async () => {
  emptyStore();
  // a stored cycle: the child inherits the parent, the parent inherits the child. Renaming the parent
  // makes the store's cycle check refuse the update of the child – after the file was already moved.
  writePreset('print', 'Parent', printBody('Parent', 'Child'));
  writePreset('print', 'Child', printBody('Child', 'Parent'));
  const before = listUserPresets('print');
  await assert.rejects(renameUserPreset('print', 'Parent', 'Renamed'));
  assert.deepEqual(listUserPresets('print'), before);
  assert.equal(userPresetExists('print', 'Renamed'), false);
});
