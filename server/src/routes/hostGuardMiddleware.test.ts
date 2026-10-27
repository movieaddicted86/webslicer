/**
 * The log side of a host-guard refusal: one warn line per refused value per hour.
 *
 * A name the server does not answer on usually means a misconfigured proxy or a rebound page that
 * keeps knocking – either way the same refusal arrives hundreds of times and must not flood the log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseToLog, resetRefusalLog } from './hostGuardMiddleware.js';

test('the same refused host is logged once per hour', () => {
  resetRefusalLog();
  const t0 = 1_700_000_000_000;
  assert.equal(refuseToLog('host', 'nas:8080', t0), true);
  // the port is not part of the identity of the refusal
  assert.equal(refuseToLog('host', 'nas', t0 + 1_000), false);
  assert.equal(refuseToLog('host', 'nas:8080', t0 + 59 * 60 * 1000), false);
  assert.equal(refuseToLog('host', 'nas:8080', t0 + 60 * 60 * 1000), true);
});

test('another refused value and the other kind log on their own', () => {
  resetRefusalLog();
  const t0 = 1_700_000_000_000;
  assert.equal(refuseToLog('host', 'nas:8080', t0), true);
  assert.equal(refuseToLog('host', 'other.example', t0), true);
  // an Origin carries a scheme and a port that are part of the value, so it is its own line
  assert.equal(refuseToLog('origin', 'https://evil.example', t0), true);
  assert.equal(refuseToLog('origin', 'https://evil.example:8443', t0), true);
});
