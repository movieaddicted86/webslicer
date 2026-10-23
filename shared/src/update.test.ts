/**
 * T-058: the update notice's contract and the version comparison behind it.
 *
 * The comparison decides whether a release tag is "newer" than the running version, so the semver
 * rules that matter for this project's tags (`v1.0.0-rc.2`, `1.0.0`) are pinned here rather than
 * trusted to a dependency (`AC-5`: no new runtime dependency).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isNewerVersion, parseUpdateStatus, updateAvailable, updateLabel } from './update.js';
import type { UpdateStatus } from './types/update.js';

const STATUS: UpdateStatus = {
  current: 'aaaaaaaaaaaaaaa',
  latest: 'bbbbbbbbbbbbbbb',
  behind: 3,
  url: 'https://github.com/movieaddicted86/webslicer/compare/a...main',
  checkedAt: '2026-10-23T10:00:00.000Z',
  enabled: true,
};

test('versions compare the way semver orders them', () => {
  const cases: Array<[string, string, number]> = [
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['1.0.0', '1.0.0', 0],
    ['v1.1.0', '1.0.0', 1],
    ['1.0', '1.0.0', 0],
    ['2', '1.9.9', 1],
    ['1.0.0-rc.3', '1.0.0-rc.2', 1],
    ['1.0.0', '1.0.0-rc.9', 1],
    ['1.0.0-rc.10', '1.0.0-rc.9', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0+2026', '1.0.0', 0],
  ];
  for (const [a, b, want] of cases) assert.equal(compareVersions(a, b), want, `${a} vs ${b}`);
  assert.equal(isNewerVersion('v1.0.0-rc.3', '1.0.0-rc.2'), true);
  assert.equal(isNewerVersion('v1.0.0-rc.1', '1.0.0-rc.2'), false);
  // an unreadable version never claims to be newer; the reverse ordering keeps it older
  assert.equal(isNewerVersion('nightly', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', 'nightly'), true);
});

test('the status contract accepts its own shape and drops unknown fields', () => {
  assert.deepEqual(parseUpdateStatus(STATUS), STATUS);
  assert.deepEqual(parseUpdateStatus({ ...STATUS, tag: 'v1.1.0', extra: 1 }), { ...STATUS, tag: 'v1.1.0' });
  for (const bad of [
    undefined,
    null,
    [],
    'x',
    { ...STATUS, current: '' },
    { ...STATUS, latest: 5 },
    { ...STATUS, behind: -1 },
    { ...STATUS, behind: 1.5 },
    { ...STATUS, url: 'javascript:alert(1)' },
    { ...STATUS, checkedAt: 5 },
    { ...STATUS, enabled: 'yes' },
    { ...STATUS, tag: '' },
  ]) {
    assert.equal(parseUpdateStatus(bad), undefined, JSON.stringify(bad));
  }
});

test('the notice is only "available" when enabled and something changed', () => {
  assert.equal(updateAvailable(STATUS), true);
  assert.equal(updateAvailable({ ...STATUS, behind: 0 }), false);
  assert.equal(updateAvailable({ ...STATUS, behind: 0, tag: 'v1.1.0' }), true);
  assert.equal(updateAvailable({ ...STATUS, enabled: false }), false);
});

test('the label names the tag, else the distance', () => {
  assert.equal(updateLabel(STATUS), 'Update available · 3 commits behind');
  assert.equal(updateLabel({ ...STATUS, behind: 1 }), 'Update available · 1 commit behind');
  assert.equal(updateLabel({ ...STATUS, tag: 'v1.1.0' }), 'Update available · v1.1.0');
});
