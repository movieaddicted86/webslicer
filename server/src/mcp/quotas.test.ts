/**
 * The per-token slicing quotas (P-6): a token may have `MCP_MAX_CONCURRENT_JOBS` jobs queued or
 * running and may start `MCP_MAX_SLICES_PER_HOUR` slices within a rolling hour; both refusals name
 * the limit. The clock and the job lookup are injected, so the window is tested without waiting.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-quotas-'));
process.env.DATA_DIR = DATA_DIR;
process.env.MCP_MAX_CONCURRENT_JOBS = '2';
process.env.MCP_MAX_SLICES_PER_HOUR = '30';

const { config } = await import('../config.js');
const { QUOTA_WINDOW_MS, quotaRefusal, recordMcpSlice, resetQuotas } = await import('./quotas.js');

before(() => resetQuotas());
after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

/** A status lookup over a plain map, standing in for the job queue. */
function statuses(map: Record<string, 'queued' | 'running' | 'done'>) {
  return (id: string) => map[id];
}

test('the limits come from the environment with the documented defaults', () => {
  assert.equal(config.mcpMaxConcurrentJobs, 2);
  assert.equal(config.mcpSlicesPerHour, 30);
  assert.equal(QUOTA_WINDOW_MS, 60 * 60 * 1000);
});

test('a token with two jobs queued or running is refused the third (AC-1)', () => {
  resetQuotas();
  const now = 1_000_000;
  const live = statuses({ job1: 'queued', job2: 'running' });
  recordMcpSlice('token-a', 'job1', now);
  recordMcpSlice('token-a', 'job2', now);
  const refusal = quotaRefusal('token-a', now, live);
  assert.ok(refusal, 'the third job is refused');
  assert.match(refusal, /2 slicing jobs queued or running \(limit 2\)/);
});

test('a finished, cancelled or vanished job frees its slot', () => {
  resetQuotas();
  const now = 1_000_000;
  const live: Record<string, 'queued' | 'running' | 'done'> = { job1: 'queued', job2: 'running' };
  recordMcpSlice('token-b', 'job1', now);
  recordMcpSlice('token-b', 'job2', now);
  live.job1 = 'done';
  delete live.job2; // deleted by its owner
  assert.equal(quotaRefusal('token-b', now, statuses(live)), undefined, 'one slot is free again');
});

test('another token is not affected by one token being at its limit', () => {
  resetQuotas();
  const now = 1_000_000;
  const live = statuses({ job1: 'queued', job2: 'queued' });
  recordMcpSlice('token-c', 'job1', now);
  recordMcpSlice('token-c', 'job2', now);
  assert.ok(quotaRefusal('token-c', now, live));
  assert.equal(quotaRefusal('token-d', now, live), undefined, 'quotas are per token, not global');
});

test('the 31st slice within the hour is refused and the window rolls (AC-1)', () => {
  resetQuotas();
  const start = 5_000_000;
  // jobs finish immediately, so the concurrency limit never fires – the hourly one has to
  for (let i = 0; i < 30; i++) recordMcpSlice('token-e', `job-${i}`, start + i);
  const done = () => 'done' as const;
  const refusal = quotaRefusal('token-e', start + 31, done);
  assert.ok(refusal, 'the 31st slice within the hour is refused');
  assert.match(refusal, /30 slices within the last hour \(limit 30\)/);

  // once the first slices have left the rolling window, the token may slice again
  assert.equal(quotaRefusal('token-e', start + QUOTA_WINDOW_MS + 31, done), undefined, 'the window rolled past the first slices');
});

test('the 29th slice is still accepted, the 30th fills the window', () => {
  resetQuotas();
  const start = 7_000_000;
  for (let i = 0; i < 29; i++) recordMcpSlice('token-g', `ok-${i}`, start + i);
  const done = () => 'done' as const;
  assert.equal(quotaRefusal('token-g', start + 30, done), undefined, '29 used, the 30th still fits');
  recordMcpSlice('token-g', 'ok-29', start + 30);
  assert.match(String(quotaRefusal('token-g', start + 31, done)), /limit 30/, '30 used, the 31st does not');
});

test('the concurrency quota is reported before the hourly one', () => {
  resetQuotas();
  const now = 9_000_000;
  for (let i = 0; i < 30; i++) recordMcpSlice('token-f', `busy-${i}`, now);
  const refusal = quotaRefusal('token-f', now, (id) => (id.startsWith('busy-') ? 'running' : 'done'));
  assert.ok(refusal);
  assert.match(refusal, /queued or running \(limit 2\)/, 'the concurrency limit answers first');
});
