/**
 * MCP token handling: hashing, constant-time verification, the environment bootstrap and the owner
 * a token acts as. The audit log is checked here too, because both live in the same security layer.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// the data directory has to be redirected before anything reads it (config is evaluated once)
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-mcp-'));
process.env.DATA_DIR = DATA_DIR;
delete process.env.MCP_TOKEN;

const { config, ensureDirs } = await import('../config.js');
const {
  ENV_TOKEN_ID,
  authenticate,
  authenticateHeader,
  bootstrapEnvToken,
  hashToken,
  loadTokens,
  mcpEnabled,
  saveTokens,
  verifyTokenHash,
} = await import('./tokens.js');
const { appendAudit, appendAuditStrict, readAudit, sanitizeParams } = await import('../services/audit.js');

before(() => ensureDirs());
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const ENV_TOKEN = 'env-token-0123456789';
const USER_TOKEN = 'user-token-abcdefghij';

function resetTokens(env?: string): number {
  fs.rmSync(config.mcpTokensFile, { force: true });
  return bootstrapEnvToken(env);
}

test('a token is stored as a SHA-256 and checked in constant time (S9)', () => {
  const a = hashToken(USER_TOKEN);
  assert.match(a, /^sha256\$[0-9a-f]{64}$/);
  assert.equal(a, hashToken(USER_TOKEN), 'the same token gives the same record – a plain lookup');
  assert.ok(!a.includes(USER_TOKEN), 'the hash never contains the token');
  assert.equal(verifyTokenHash(USER_TOKEN, a), true);
  assert.equal(verifyTokenHash('other', a), false);
  assert.equal(verifyTokenHash('', a), false);
  // malformed and truncated records must not throw
  assert.equal(verifyTokenHash(USER_TOKEN, ''), false);
  assert.equal(verifyTokenHash(USER_TOKEN, 'plain-text'), false);
  assert.equal(verifyTokenHash(USER_TOKEN, 'sha256$abc'), false);
  assert.equal(verifyTokenHash(USER_TOKEN, `sha256$${'0'.repeat(10)}`), false);
  assert.equal(verifyTokenHash(USER_TOKEN, 'scrypt$abc$00'), false);
});

test('S9: scrypt records of older versions keep working and are migrated on first use', async () => {
  const { scryptSync } = await import('node:crypto');
  const salt = 'a'.repeat(32);
  const legacy = `scrypt$${salt}$${scryptSync(USER_TOKEN, salt, 64).toString('hex')}`;
  assert.equal(verifyTokenHash(USER_TOKEN, legacy), true, 'the legacy form still verifies');
  assert.equal(verifyTokenHash('wrong', legacy), false);

  resetTokens(ENV_TOKEN);
  const list = loadTokens();
  list.push({ id: 'legacy-1', name: 'Old client', owner: 'robert', hash: legacy, createdAt: new Date().toISOString() });
  saveTokens(list);

  const found = authenticate(USER_TOKEN);
  assert.equal(found?.id, 'legacy-1', 'the old token authenticates');
  assert.match(loadTokens().find((t) => t.id === 'legacy-1')?.hash ?? '', /^sha256\$/, 'and the record is upgraded');
  assert.equal(authenticate(USER_TOKEN)?.id, 'legacy-1', 'the migrated record still works');
});

test('the token file holds hashes only', () => {
  resetTokens(ENV_TOKEN);
  const raw = fs.readFileSync(config.mcpTokensFile, 'utf8');
  assert.ok(!raw.includes(ENV_TOKEN), 'no clear text token in the file');
  const list = loadTokens();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, ENV_TOKEN_ID);
  assert.equal(list[0].owner, 'admin');
  assert.match(list[0].hash, /^sha256\$/);
});

test('MCP_TOKEN is bootstrapped, updated in place and removed again', () => {
  assert.equal(resetTokens(ENV_TOKEN), 1);
  assert.equal(mcpEnabled(), true);

  // a new value replaces the hash but keeps the record's identity
  const before = loadTokens()[0];
  assert.equal(bootstrapEnvToken('a-completely-different-token'), 1);
  const after = loadTokens()[0];
  assert.equal(after.id, ENV_TOKEN_ID);
  assert.equal(after.createdAt, before.createdAt);
  assert.notEqual(after.hash, before.hash);
  assert.equal(authenticate(ENV_TOKEN), undefined, 'the old token is gone');
  assert.equal(authenticate('a-completely-different-token')?.owner, 'admin');

  // an unchanged value does not rewrite the record
  const stamp = fs.statSync(config.mcpTokensFile).mtimeMs;
  assert.equal(bootstrapEnvToken('a-completely-different-token'), 1);
  assert.equal(loadTokens()[0].hash, after.hash);
  assert.equal(fs.statSync(config.mcpTokensFile).mtimeMs, stamp);

  // without the variable the bootstrapped credential disappears and the endpoint is off
  assert.equal(bootstrapEnvToken(undefined), 0);
  assert.deepEqual(loadTokens(), []);
  assert.equal(mcpEnabled(), false);
  assert.equal(authenticate('a-completely-different-token'), undefined);
});

test('the bootstrap leaves tokens of other origins alone', () => {
  resetTokens(ENV_TOKEN);
  const list = loadTokens();
  list.push({ id: 'token-1', name: 'Claude Desktop', owner: 'robert', hash: hashToken(USER_TOKEN), createdAt: new Date().toISOString() });
  saveTokens(list);

  // removing the environment variable removes only the bootstrapped entry
  assert.equal(bootstrapEnvToken(undefined), 1);
  assert.deepEqual(
    loadTokens().map((t) => t.id),
    ['token-1'],
  );
  assert.equal(mcpEnabled(), true);
  assert.equal(authenticate(USER_TOKEN)?.owner, 'robert');
});

test('authenticate accepts only the right token and records its use', () => {
  resetTokens(ENV_TOKEN);
  const tokens = loadTokens();
  tokens.push({ id: 'token-2', name: 'Home Assistant', owner: 'haus', hash: hashToken(USER_TOKEN), createdAt: new Date().toISOString() });
  saveTokens(tokens);

  assert.equal(authenticate('')?.id, undefined);
  assert.equal(authenticate('nope'), undefined);
  assert.equal(authenticate(ENV_TOKEN)?.id, ENV_TOKEN_ID);
  assert.equal(authenticate(USER_TOKEN)?.owner, 'haus');
  assert.ok(loadTokens().find((t) => t.id === ENV_TOKEN_ID)?.lastUsedAt, 'the used token is stamped');

  assert.equal(authenticateHeader(`Bearer ${USER_TOKEN}`)?.id, 'token-2');
  assert.equal(authenticateHeader(`bearer   ${USER_TOKEN}`)?.id, 'token-2');
  assert.equal(authenticateHeader(`Bearer ${USER_TOKEN} `)?.id, 'token-2');
  assert.equal(authenticateHeader('Basic abc'), undefined);
  assert.equal(authenticateHeader('Bearer '), undefined);
  assert.equal(authenticateHeader(undefined), undefined);
});

test('the audit log records a call without secrets', async () => {
  fs.rmSync(config.auditLog, { force: true });
  assert.deepEqual((await readAudit()), []);

  appendAudit({
    time: 'now',
    token: ENV_TOKEN_ID,
    owner: 'admin',
    tool: 'webslicer.slice',
    params: { project_id: 'p1' },
    ok: true,
    durationMs: 3,
  });
  appendAudit({
    time: 'now',
    token: ENV_TOKEN_ID,
    owner: 'admin',
    tool: 'webslicer.add_model',
    params: { library_path: 'x.stl' },
    ok: false,
    error: 'not found',
    durationMs: 1,
  });
  const entries = await readAudit();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].tool, 'webslicer.slice');
  assert.equal(entries[1].ok, false);
  assert.equal(entries[1].error, 'not found');

  const line = fs
    .readFileSync(config.auditLog, 'utf8')
    .split('\n')
    .find((l) => l.includes('add_model'))!;
  assert.ok(!line.includes(ENV_TOKEN), 'the token itself is never logged');
});

test('audit parameters drop secret looking keys and cut long values', () => {
  assert.deepEqual(sanitizeParams({ apiKey: 'k', Authorization: 'Bearer x', nested: { token: 't', keep: 1 } }), {
    apiKey: '[redacted]',
    Authorization: '[redacted]',
    nested: { token: '[redacted]', keep: 1 },
  });
  const long = sanitizeParams({ text: 'x'.repeat(1000) }) as { text: string };
  assert.equal(long.text.length, 401);
  assert.deepEqual(sanitizeParams(null), null);
  assert.deepEqual(sanitizeParams([1, 2, 3]), [1, 2, 3]);
});

test('the fail-soft writer swallows a write error, the strict one throws (T-080, P-3)', async () => {
  const entry = { time: 'now', token: '', owner: '', tool: 'send_to_printer', ok: true, durationMs: 1 };
  // a directory where the log file should be: every append fails
  fs.rmSync(config.auditLog, { force: true });
  fs.mkdirSync(config.auditLog, { recursive: true });
  try {
    // the MCP call logging must never break the call it describes – the tool already ran
    assert.doesNotThrow(() => appendAudit(entry));
    // the send gate's override is only acceptable because it is recorded: the failure has to reach it
    assert.throws(() => appendAuditStrict(entry));
  } finally {
    fs.rmSync(config.auditLog, { recursive: true, force: true });
  }
  // with a log that can be written, both write the same line
  appendAudit({ ...entry, tool: 'webslicer.slice' });
  appendAuditStrict(entry);
  assert.deepEqual(
    (await readAudit()).map((e) => e.tool),
    ['webslicer.slice', 'send_to_printer'],
  );
});
