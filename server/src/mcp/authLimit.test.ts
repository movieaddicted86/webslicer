/**
 * The MCP endpoint's failed-auth limiter (S9): 10 wrong tokens per minute and address answer 429,
 * a correct token in between clears the count, and the lock expires with its window.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_FAILURE_LIMIT,
  AUTH_FAILURE_WINDOW_MS,
  authBlockedFor,
  recordAuthFailure,
  recordAuthSuccess,
  resetAuthFailures,
} from './authLimit.js';

beforeEach(() => resetAuthFailures());

test('ten failures within a minute lock the address for a minute', () => {
  const ip = '192.168.1.20';
  const t0 = 1_000_000;
  for (let i = 1; i < AUTH_FAILURE_LIMIT; i++) {
    recordAuthFailure(ip, t0 + i);
    assert.equal(authBlockedFor(ip, t0 + i), 0, `failure ${i} does not lock yet`);
  }
  recordAuthFailure(ip, t0 + 10);
  const blocked = authBlockedFor(ip, t0 + 10);
  assert.ok(blocked > 0 && blocked <= AUTH_FAILURE_WINDOW_MS, 'the tenth failure locks the address');
  assert.equal(authBlockedFor(ip, t0 + 10 + AUTH_FAILURE_WINDOW_MS), 0, 'the lock ends with its window');
});

test('a successful authentication clears the failures of that address', () => {
  const ip = '10.0.0.5';
  for (let i = 0; i < AUTH_FAILURE_LIMIT - 1; i++) recordAuthFailure(ip, 1_000 + i);
  recordAuthSuccess(ip);
  for (let i = 0; i < AUTH_FAILURE_LIMIT - 1; i++) recordAuthFailure(ip, 2_000 + i);
  assert.equal(authBlockedFor(ip, 2_000), 0, 'the count started again after the success');
});

test('failures spread over more than the window do not add up', () => {
  const ip = '10.0.0.6';
  for (let i = 0; i < AUTH_FAILURE_LIMIT; i++) recordAuthFailure(ip, i * AUTH_FAILURE_WINDOW_MS);
  assert.equal(authBlockedFor(ip, AUTH_FAILURE_WINDOW_MS * AUTH_FAILURE_LIMIT), 0);
});

test('the limiter is per address', () => {
  for (let i = 0; i < AUTH_FAILURE_LIMIT; i++) recordAuthFailure('a', 1_000 + i);
  assert.ok(authBlockedFor('a', 1_000 + AUTH_FAILURE_LIMIT) > 0);
  assert.equal(authBlockedFor('b', 1_000 + AUTH_FAILURE_LIMIT), 0);
});
