/**
 * Audit-log rotation and the bounded tail read (P-8).
 *
 * The log used to grow forever and `readAudit` loaded the whole file. Rotation is pinned here with a
 * small limit: the current file moves to `.1` when the next append would pass the limit, the older
 * generations shift down, and reading returns the newest entries from the bounded tail.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-audit-'));
process.env.DATA_DIR = DATA_DIR;
// the limit has to be in place before the configuration is evaluated once
process.env.AUDIT_LOG_MAX_BYTES = '1000';
process.env.AUDIT_LOG_KEEP_FILES = '2';

const { config } = await import('../config.js');
const { appendAudit, appendAuditStrict, readAudit } = await import('./audit.js');

after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

function entry(tool: string) {
  return { time: new Date().toISOString(), token: 't', owner: 'admin', tool, ok: true, durationMs: 1 };
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

test('the log rotates at the size limit and keeps the configured generations', async () => {
  fs.rmSync(config.auditLog, { force: true });
  for (const n of [1, 2, 3]) fs.rmSync(`${config.auditLog}.${n}`, { force: true });
  for (let i = 1; i <= 60; i++) appendAudit(entry(`tool-${i}`));

  assert.ok(sizeOf(config.auditLog) <= config.auditMaxBytes, 'the current log stays under the limit');
  assert.ok(sizeOf(`${config.auditLog}.1`) > 0, 'the previous generation exists');
  assert.ok(sizeOf(`${config.auditLog}.2`) > 0, 'the one before that too');
  assert.equal(sizeOf(`${config.auditLog}.3`), 0, 'nothing beyond the kept generations');

  const entries = await readAudit();
  assert.ok(entries.length > 0);
  assert.equal(entries[entries.length - 1].tool, 'tool-60', 'the newest entry is the last one');
});

test('rotation drops the oldest generation once the limit is passed repeatedly', async () => {
  fs.rmSync(config.auditLog, { force: true });
  fs.rmSync(`${config.auditLog}.1`, { force: true });
  fs.rmSync(`${config.auditLog}.2`, { force: true });
  // enough entries for several rotations
  for (let i = 1; i <= 300; i++) appendAudit(entry(`again-${i}`));
  const kept = await readAudit();
  assert.equal(kept[kept.length - 1].tool, 'again-300');
  assert.equal(sizeOf(`${config.auditLog}.3`), 0, 'generation 3 is dropped, not created');
});

test('the strict writer rotates too and does not lose the entry it accepted', () => {
  fs.rmSync(config.auditLog, { force: true });
  fs.rmSync(`${config.auditLog}.1`, { force: true });
  fs.rmSync(`${config.auditLog}.2`, { force: true });
  for (let i = 1; i <= 40; i++) appendAuditStrict(entry(`send-${i}`));
  const current = fs.readFileSync(config.auditLog, 'utf8');
  assert.match(current, /send-40/, 'the last entry is in the current file after the rotation before it');
});

test('reading returns the newest entries and survives a torn first line', async () => {
  fs.rmSync(config.auditLog, { force: true });
  appendAudit(entry('one'));
  appendAudit(entry('two'));
  appendAudit(entry('three'));
  // a torn last line is skipped, the entries before it are still read
  fs.appendFileSync(config.auditLog, '{"time":"now","token":"t"');
  const entries = await readAudit();
  assert.deepEqual(
    entries.map((e) => e.tool),
    ['one', 'two', 'three'],
  );
  assert.deepEqual(
    (await readAudit(2)).map((e) => e.tool),
    ['two', 'three'],
    'a count keeps the newest ones',
  );
});

test('a missing log reads as empty and a directory in its place does not throw', async () => {
  fs.rmSync(config.auditLog, { force: true });
  assert.deepEqual(await readAudit(), []);
  fs.mkdirSync(config.auditLog, { recursive: true });
  try {
    assert.deepEqual(await readAudit(), [], 'an unreadable path is an empty log, not a crash');
  } finally {
    fs.rmSync(config.auditLog, { recursive: true, force: true });
  }
});
