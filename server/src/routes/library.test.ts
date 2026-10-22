import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-lib-'));
const { config, ensureDirs } = await import('../config.js');
const { resolveLibraryPath, listLibrary, resolveInsideLibrary, resolveLibraryFile, writeLibraryFile, libraryTargetChecked } =
  await import('../services/library.js');

test('library paths stay inside the library root', () => {
  ensureDirs();
  assert.equal(resolveLibraryPath(''), path.resolve(config.libraryDir));
  assert.equal(resolveLibraryPath('a/b.stl'), path.resolve(config.libraryDir, 'a', 'b.stl'));
  assert.throws(() => resolveLibraryPath('../x'), /invalid path/);
  assert.throws(() => resolveLibraryPath('a/../../x'), /invalid path/);
  assert.throws(() => resolveLibraryPath('..\\x'), /invalid path/);
});

test('S10: a symlink that leaves the library root is refused', async (t) => {
  ensureDirs();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'not for the library');
  const link = path.join(config.libraryDir, 'escape');
  try {
    // a junction needs no admin rights on Windows and is the same thing for this check
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('creating a symlink is not permitted in this environment');
    return;
  }
  try {
    await assert.rejects(() => resolveInsideLibrary('escape/secret.txt'), /invalid path/);
    await assert.rejects(() => resolveLibraryFile('escape/secret.txt'), /invalid path/);
    await assert.rejects(() => listLibrary('escape'), /invalid path/);
    // a write behind the link must not create a file outside either
    await assert.rejects(() => writeLibraryFile('escape/new.txt', Buffer.from('x')), /invalid path/);
    await assert.rejects(() => libraryTargetChecked('escape', 'new', '.stl'), /invalid path/);
    // … while a normal file still works
    fs.writeFileSync(path.join(config.libraryDir, 'inside.txt'), 'ok');
    assert.ok(await resolveInsideLibrary('inside.txt'));
    fs.rmSync(path.join(config.libraryDir, 'inside.txt'), { force: true });
  } finally {
    fs.rmSync(link, { force: true, recursive: false });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('listLibrary classifies entries', async () => {
  ensureDirs();
  fs.mkdirSync(path.join(config.libraryDir, 'parts'), { recursive: true });
  fs.writeFileSync(path.join(config.libraryDir, 'cube.stl'), 'solid');
  fs.writeFileSync(path.join(config.libraryDir, 'proj.3mf'), 'PK');
  fs.writeFileSync(path.join(config.libraryDir, 'out.gcode'), ';');
  fs.writeFileSync(path.join(config.libraryDir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(config.libraryDir, '.hidden'), 'x');
  const l = await listLibrary('');
  assert.equal(l.path, '');
  assert.deepEqual(
    l.entries.map((e) => [e.name, e.dir, e.kind]),
    [
      ['parts', true, undefined],
      ['cube.stl', false, 'model'],
      ['notes.txt', false, 'other'],
      ['out.gcode', false, 'gcode'],
      ['proj.3mf', false, 'project'],
    ],
  );
  fs.rmSync(config.dataDir, { recursive: true, force: true });
});
