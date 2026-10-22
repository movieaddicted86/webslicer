/**
 * B7: the JSON stores used to answer "empty list" for any read error and then write a fresh file on
 * the next save – one corrupt `physical_printers.json` lost every printer, one corrupt token file
 * silently turned the MCP endpoint off. And a plain `writeFile` could leave a truncated file that the
 * next start could not parse at all.
 *
 * Now every store goes through `services/jsonStore.ts`: writes are temp + rename, an unparseable file
 * is moved aside as `*.corrupt-<timestamp>` and logged, so the data survives and can be recovered.
 *
 * The tests drive the real stores (printers, projects, tokens, installed printers), not just the
 * helper, so a store that skips the helper fails here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-jsonstore-'));
process.env.DATA_DIR = DATA_DIR;

const { config, ensureDirs } = await import('../config.js');
const { writeJson } = await import('./jsonStore.js');
const { listPrinters, upsertPrinter } = await import('./printers.js');
const { loadProject } = await import('./projects.js');
const { loadTokens, saveTokens } = await import('../mcp/tokens.js');
const { getInstalledPrinters, setInstalledPrinters } = await import('../slicer/presets.js');

/** The files the store moved aside for `file`, newest first (one per corrupt read). */
function corruptCopies(file: string): string[] {
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.corrupt-`))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Run `fn` with `console.error` captured; the store reports there, not to the client. */
function captureErrors(fn: () => void | Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = original;
    })
    .then(() => errors);
}

before(() => ensureDirs());
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('B7: a corrupt printer store is moved aside, not treated as empty and then overwritten', async () => {
  const file = path.join(config.dataDir, 'physical_printers.json');
  const original = '{ "printers": [ { "id": "p1", "name": "Vor';
  fs.writeFileSync(file, original);

  const errors = await captureErrors(async () => {
    assert.deepEqual(await listPrinters(), [], 'the read still answers empty');

    const copies = corruptCopies(file);
    assert.equal(copies.length, 1, 'the corrupt file was kept as *.corrupt-<ts>');
    assert.equal(fs.readFileSync(copies[0], 'utf8'), original, 'the old content is still readable');

    // the next save starts from a clean file and must not destroy the copy of the old data
    await upsertPrinter({ name: 'New printer', host: 'printer.local' });
    assert.equal(fs.readFileSync(copies[0], 'utf8'), original, 'the quarantined copy survives the save');
  });

  assert.match(errors.join('\n'), /physical_printers\.json is corrupt/, 'the problem is reported in the log');
  assert.equal((await listPrinters()).length, 1, 'the save after the quarantine wrote the new list');
  assert.equal(fs.existsSync(file), true);
});

test('B7: a write is atomic – no temp file left behind and a failed write keeps the old file', async () => {
  const file = path.join(config.dataDir, 'atomic-test.json');
  const leftovers = () => fs.readdirSync(config.dataDir).filter((f) => f.startsWith('atomic-test.json.tmp-'));

  await writeJson(file, { printers: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { printers: 2 });
  assert.deepEqual(leftovers(), [], 'the temp file was renamed away');

  // a value that cannot be serialized fails before the target is touched
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(() => writeJson(file, circular), /circular/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { printers: 2 }, 'the previous content is intact');
  assert.deepEqual(leftovers(), []);
});

test('B7: a corrupt installed-printer list is quarantined and the next list starts clean', async () => {
  const file = path.join(config.dataDir, 'installed_printers.json');
  fs.writeFileSync(file, '[{"vendorId":');

  const errors = await captureErrors(() => {
    assert.deepEqual(getInstalledPrinters(), []);
  });
  assert.equal(corruptCopies(file).length, 1);
  assert.match(errors.join('\n'), /installed_printers\.json is corrupt/);

  setInstalledPrinters([{ vendorId: 'prusa', modelId: 'MK4', variant: '0.4' }] as never);
  assert.deepEqual(getInstalledPrinters(), [{ vendorId: 'prusa', modelId: 'MK4', variant: '0.4' }]);
  assert.equal(corruptCopies(file).length, 1, 'the copy is untouched by the save');
});

test('B7: a corrupt project file is moved aside instead of vanishing silently', async () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const file = path.join(config.projectsDir, `${id}.json`);
  fs.mkdirSync(config.projectsDir, { recursive: true });
  fs.writeFileSync(file, 'not a project');

  const errors = await captureErrors(async () => {
    assert.equal(await loadProject(id), undefined);
  });
  assert.equal(corruptCopies(file).length, 1);
  assert.match(errors.join('\n'), new RegExp(`${id}\\.json is corrupt`));
});

test('B7: a corrupt token store is quarantined and the file stays private', async () => {
  const file = config.mcpTokensFile;
  fs.writeFileSync(file, '{oops');

  const errors = await captureErrors(() => {
    assert.deepEqual(loadTokens(), []);
  });
  assert.equal(corruptCopies(file).length, 1);
  assert.match(errors.join('\n'), /mcp-tokens\.json is corrupt/);

  saveTokens([{ id: 't1', name: 'test', owner: 'admin', hash: 'sha256$aa', createdAt: '2026-01-01T00:00:00.000Z' }]);
  assert.equal(loadTokens().length, 1, 'the store is usable again');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'token file mode is 0600');
  assert.equal(corruptCopies(file).length, 1, 'the copy is untouched by the save');
});
