/**
 * W5: the shutdown sequence. SIGTERM is what Docker, Proxmox and `docker stop` send; the sequence has
 * to stop accepting, cancel the jobs and exit with the right code – and it must not hang forever on a
 * cleanup that does not finish.
 *
 * The real signal wiring sits in `installShutdownHandlers` and is exercised by the manual check in
 * the T-040 report; here the sequence itself is tested with injected parts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shutdown } from './shutdown.js';

function deps(over: Partial<Parameters<typeof shutdown>[0]> = {}) {
  const calls: string[] = [];
  const exits: number[] = [];
  return {
    calls,
    exits,
    value: {
      closeServer: () => calls.push('close'),
      stopJobs: async () => {
        calls.push('stopJobs');
      },
      exit: (code: number) => exits.push(code),
      graceMs: 50,
      ...over,
    },
  };
}

test('a shutdown stops the listener first, then the jobs, and exits 0', async () => {
  const d = deps();
  await shutdown(d.value, 'SIGTERM');
  assert.deepEqual(d.calls, ['close', 'stopJobs'], 'the listener stops accepting before the jobs are cancelled');
  assert.deepEqual(d.exits, [0]);
});

test('a failing cleanup still exits, with 1', async () => {
  const d = deps({
    stopJobs: async () => {
      throw new Error('cleanup broke');
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    await shutdown(d.value, 'SIGINT');
  } finally {
    console.error = original;
  }
  assert.deepEqual(d.exits, [1], 'the process leaves instead of hanging');
});

test('a cleanup that never finishes is cut off by the grace timer', async () => {
  const d = deps({ stopJobs: () => new Promise(() => {}), graceMs: 20 });
  const original = console.warn;
  console.warn = () => {};
  try {
    await shutdown(d.value, 'SIGTERM');
  } finally {
    console.warn = original;
  }
  assert.deepEqual(d.exits, [1], 'the timer exits with 1');
});
