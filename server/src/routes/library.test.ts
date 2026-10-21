import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-lib-'));
const { config, ensureDirs } = await import('../config.js');
const { resolveLibraryPath, listLibrary } = await import('../services/library.js');

test('library paths stay inside the library root', () => {
  ensureDirs();
  assert.equal(resolveLibraryPath(''), path.resolve(config.libraryDir));
  assert.equal(resolveLibraryPath('a/b.stl'), path.resolve(config.libraryDir, 'a', 'b.stl'));
  assert.throws(() => resolveLibraryPath('../x'), /invalid path/);
  assert.throws(() => resolveLibraryPath('a/../../x'), /invalid path/);
  assert.throws(() => resolveLibraryPath('..\\x'), /invalid path/);
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
