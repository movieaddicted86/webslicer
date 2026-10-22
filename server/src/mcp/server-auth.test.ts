/**
 * The MCP endpoint's authentication guard (S9): wrong tokens answer 401, and the tenth wrong token
 * from one address answers 429 with `Retry-After` until the window has passed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-mcp-auth-'));
process.env.DATA_DIR = DATA_DIR;

const { ensureDirs } = await import('../config.js');
const { saveTokens, hashToken } = await import('./tokens.js');
const { resetAuthFailures } = await import('./authLimit.js');
const express = (await import('express')).default;
const { mcpRouter } = await import('./server.js');

const TOKEN = 'right-token-0123456789';
let server: http.Server;
let base = '';

before(async () => {
  ensureDirs();
  saveTokens([{ id: 't1', name: 'test', owner: 'admin', hash: hashToken(TOKEN), createdAt: new Date().toISOString() }]);
  const app = express();
  app.use('/mcp', mcpRouter());
  server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const call = (auth?: string) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

test('S9: repeated wrong tokens are answered 401, then 429 with Retry-After', async () => {
  resetAuthFailures();
  for (let i = 0; i < 10; i++) {
    const res = await call(`Bearer wrong-${i}`);
    assert.equal(res.status, 401, `attempt ${i + 1} is still 401`);
  }
  const locked = await call('Bearer wrong-10');
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0, 'the client learns when to retry');

  // the lock applies before authentication, so even the right token waits
  assert.equal((await call(`Bearer ${TOKEN}`)).status, 429);
});

test('S9: a correct token in between clears the failures', async () => {
  resetAuthFailures();
  for (let i = 0; i < 10; i++) assert.equal((await call(`Bearer wrong-${i}`)).status, 401);
  assert.equal((await call(`Bearer ${TOKEN}`)).status, 429, 'the lock is on until the window ends');
  resetAuthFailures();
  assert.equal((await call(`Bearer ${TOKEN}`)).status, 200, 'a correct token reaches the MCP endpoint');
  for (let i = 0; i < 9; i++) assert.equal((await call(`Bearer wrong-again-${i}`)).status, 401, 'the counter started again');
  assert.equal((await call('Bearer wrong-again-9')).status, 401);
  assert.equal((await call('Bearer wrong-again-10')).status, 429, 'ten new failures lock again');
});
