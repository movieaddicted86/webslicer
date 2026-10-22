/**
 * The startup rule of the session restore (T-035): an empty plater restores the newest autosave, a
 * plater with objects stays as it is, and a local flush that is newer than the server's file wins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSessionStart } from './sessionStart';
import type { SliceRequest } from '../api';

const request = { objects: [{ modelId: 'm' }], print: { name: 'p', config: {} } } as unknown as SliceRequest;
const server = { savedAt: '2026-10-22T10:00:00.000Z', size: 100 };

test('an empty plater with a server autosave restores it', () => {
  assert.deepEqual(decideSessionStart({ objectsPresent: false, server }), { source: 'server' });
});

test('a plater that already has objects never restores', () => {
  assert.deepEqual(decideSessionStart({ objectsPresent: true, server, cache: { savedAt: Date.now(), request } }), {
    source: 'none',
  });
});

test('nothing stored means nothing to restore', () => {
  assert.deepEqual(decideSessionStart({ objectsPresent: false }), { source: 'none' });
});

test('a local flush newer than the server file is the newer content', () => {
  const savedAt = Date.parse(server.savedAt) + 2000;
  assert.deepEqual(decideSessionStart({ objectsPresent: false, server, cache: { savedAt, request } }), {
    source: 'cache',
    request,
  });
});

test('a local flush older than the server file is stale and loses', () => {
  const savedAt = Date.parse(server.savedAt) - 2000;
  assert.deepEqual(decideSessionStart({ objectsPresent: false, server, cache: { savedAt, request } }), { source: 'server' });
});

test('a cache without a server autosave (server lost it) still restores', () => {
  assert.deepEqual(decideSessionStart({ objectsPresent: false, cache: { savedAt: 1, request } }), { source: 'cache', request });
});
