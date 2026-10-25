/**
 * Pins for the Vendor profiles view (F-03a): which rows a user sees and how a version pair is read.
 *
 * The rules the finding asked for: a lower or equal remote version is "current" and shows no arrow, a
 * pre-release never counts as an update, everything current renders no list, and the default view is
 * the updates plus the user's own vendors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreRelease, repositoryUrl, summaryLine, vendorRow, vendorView } from './vendorUpdates.js';
import type { VendorUpdate } from '@webslicer/shared';

function update(over: Partial<VendorUpdate> = {}): VendorUpdate {
  return {
    id: 'Vendor',
    name: 'Vendor',
    installed: '1.0.0',
    available: '1.1.0',
    compatible: true,
    update: true,
    canRevert: false,
    url: 'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/Vendor',
    ...over,
  };
}

test('a pre-release is recognised in every spelling the repository uses', () => {
  for (const v of ['2.0.0-alpha1', '1.0.0-beta', '1.0.0-rc.3', '1.0.0-ALPHA.2']) assert.equal(isPreRelease(v), true, v);
  for (const v of ['1.0.0', '1.2.3.4', '1.0.0+build', 'nightly', 'alpha']) assert.equal(isPreRelease(v), false, v);
});

test('a newer compatible stable version is an update and shows both versions', () => {
  assert.deepEqual(vendorRow(update()), {
    id: 'Vendor',
    name: 'Vendor',
    installed: '1.0.0',
    available: '1.1.0',
    status: 'update',
    canRevert: false,
  });
});

test('an equal version is current and shows no second version', () => {
  const row = vendorRow(update({ available: '1.0.0', update: false, reason: 'up to date' }));
  assert.deepEqual(row, { id: 'Vendor', name: 'Vendor', installed: '1.0.0', status: 'current', canRevert: false });
});

test('a lower remote version is current – no arrow towards a downgrade', () => {
  // the server reports the newest incompatible/pre-release entry; 1.1.0 -> 0.1.0 must not show
  assert.deepEqual(vendorRow(update({ available: '0.1.0', update: false, reason: 'up to date' })).status, 'current');
  assert.equal(vendorRow(update({ available: '0.1.0', update: false })).available, undefined);
  // also when the server still calls it compatible, the comparison decides
  assert.equal(vendorRow(update({ available: '1.0.0', compatible: true })).status, 'current');
  assert.equal(vendorRow(update({ available: '0.9.9', compatible: true })).available, undefined);
});

test('a pre-release remote version is never an update', () => {
  const row = vendorRow(update({ available: '1.0.0-alpha0', compatible: true }));
  assert.equal(row.status, 'prerelease');
  assert.equal(row.available, '1.0.0-alpha0');
  // even when it is numerically newer than the installed release
  assert.equal(vendorRow(update({ installed: '0.9.0', available: '1.0.0-rc.2' })).status, 'prerelease');
  assert.equal(vendorView([update({ available: '2.0.0-beta' })], { relevant: new Set(), showAll: false }).updates.length, 0);
});

test('a newer bundle outside the engine range is listed with the reason, never offered', () => {
  const row = vendorRow(update({ update: false, compatible: false, reason: 'the newest bundle (1.1.0) needs PrusaSlicer 3.0.0' }));
  assert.equal(row.status, 'incompatible');
  assert.equal(row.available, '1.1.0');
  assert.match(row.reason ?? '', /3\.0\.0/);
});

test('a vendor without an upstream version is current and shows no version', () => {
  assert.deepEqual(vendorRow(update({ available: undefined, update: false, compatible: false })), {
    id: 'Vendor',
    name: 'Vendor',
    installed: '1.0.0',
    status: 'current',
    canRevert: false,
  });
});

test('everything current means no rows at all', () => {
  const view = vendorView([update({ available: '1.0.0', update: false }), update({ id: 'Other', name: 'Other', available: undefined })], {
    relevant: new Set(['Vendor']),
    showAll: false,
  });
  assert.deepEqual(view.rows, []);
  assert.equal(view.hidden, 2);
  assert.equal(summaryLine(view.updates.length), 'All vendor profiles are up to date');
});

test('the default view keeps the updates plus the user’s own vendors', () => {
  const vendors = [
    update({ id: 'Mine', name: 'Mine', available: '1.0.0', update: false }),
    update({ id: 'Updated', name: 'Updated' }),
    update({ id: 'Foreign', name: 'Foreign', available: '1.0.0', update: false }),
    update({ id: 'Foreign2', name: 'Foreign2', available: undefined }),
  ];
  const view = vendorView(vendors, { relevant: new Set(['Mine']), showAll: false });
  assert.deepEqual(
    view.rows.map((r) => r.id),
    ['Mine', 'Updated'],
  );
  assert.deepEqual(
    view.updates.map((r) => r.id),
    ['Updated'],
  );
  assert.equal(view.hidden, 2);
  assert.equal(summaryLine(view.updates.length), '1 vendor has an update');
});

test('"Show all vendors" lists every vendor, pre-releases included', () => {
  const vendors = [update({ id: 'A', name: 'A' }), update({ id: 'B', name: 'B', available: '2.0.0-beta' }), update({ id: 'C', name: 'C' })];
  const view = vendorView(vendors, { relevant: new Set(), showAll: true });
  assert.equal(view.rows.length, 3);
  assert.equal(view.hidden, 0);
  assert.equal(view.rows.find((r) => r.id === 'B')?.status, 'prerelease');
  assert.equal(summaryLine(2), '2 vendors have updates');
});

test('the source link is the repository folder, not a vendor page', () => {
  assert.equal(
    repositoryUrl('https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/PrusaResearch'),
    'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live',
  );
  assert.equal(
    repositoryUrl('https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/PrusaResearch/'),
    'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live',
  );
  assert.equal(repositoryUrl('https://example.com/live/PrusaResearch'), undefined);
  assert.equal(repositoryUrl(undefined), undefined);
});
