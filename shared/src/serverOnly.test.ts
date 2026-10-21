/**
 * The server-only key list (SEC-1, T-024). Pinned because three places read it: the merge that drops
 * the keys, the MCP tool that refuses them with a reason, and the settings UI that labels them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_ONLY_KEYS, SERVER_ONLY_KEY_LIST, serverOnlyNote, serverOnlyReason } from './serverOnly.js';

test('the list holds exactly the keys PrusaSlicer acts on server-side', () => {
  assert.deepEqual([...SERVER_ONLY_KEYS].sort(), ['output_filename_format', 'post_process']);
  assert.deepEqual([...SERVER_ONLY_KEY_LIST], ['output_filename_format', 'post_process']);
});

test('every key has a reason and a note that names it', () => {
  for (const key of SERVER_ONLY_KEYS) {
    const reason = serverOnlyReason(key);
    assert.ok(reason.length > 0, `${key} has no reason`);
    assert.notEqual(reason, serverOnlyReason('no_such_key'), `${key} falls back to the generic reason`);
    assert.equal(serverOnlyNote(key), `Not passed to the slicer: ${reason}.`);
  }
});

test('a key that is not on the list has no note', () => {
  for (const key of ['layer_height', 'fill_density', 'start_gcode', '']) {
    assert.equal(serverOnlyNote(key), undefined, key);
  }
});
