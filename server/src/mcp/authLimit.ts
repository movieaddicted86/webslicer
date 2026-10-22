/**
 * Failed MCP authentication limiter (S9).
 *
 * Every wrong bearer token costs no scrypt work any more, but it still lets anyone probe the
 * endpoint and fill the log. A client address that fails more than `LIMIT` times within `WINDOW_MS`
 * is answered with 429 until the window has passed. Only failures count: a correct token clears the
 * record of its address, so a busy legitimate client is never locked out.
 *
 * In memory on purpose: a restart resets the counters, and the endpoint is a single process.
 */
export const AUTH_FAILURE_LIMIT = 10;
export const AUTH_FAILURE_WINDOW_MS = 60_000;

interface Record {
  failures: number;
  firstFailureAt: number;
  blockedUntil?: number;
}

const records = new Map<string, Record>();

/** Whether this client address is currently locked out (and for how much longer). */
export function authBlockedFor(key: string, now = Date.now()): number {
  const r = records.get(key);
  if (!r?.blockedUntil) return 0;
  if (r.blockedUntil <= now) {
    records.delete(key);
    return 0;
  }
  return r.blockedUntil - now;
}

/** Count one failed attempt; the attempt that crosses the limit starts the lock-out. */
export function recordAuthFailure(key: string, now = Date.now()): void {
  const r = records.get(key);
  if (!r || now - r.firstFailureAt > AUTH_FAILURE_WINDOW_MS) {
    records.set(key, { failures: 1, firstFailureAt: now });
    return;
  }
  r.failures += 1;
  if (r.failures >= AUTH_FAILURE_LIMIT) r.blockedUntil = now + AUTH_FAILURE_WINDOW_MS;
}

/** A successful authentication clears the failures of that address. */
export function recordAuthSuccess(key: string): void {
  records.delete(key);
}

/** Test helper: forget every counter. */
export function resetAuthFailures(): void {
  records.clear();
}
