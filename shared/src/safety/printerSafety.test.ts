/**
 * The printer-preset safety profile (T-085): the three answers, the stricter-of combination with a
 * host's own limits and the warning of a preset nobody answered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_METAL_MAX_HOTEND,
  combinedSafety,
  hotendLimitOf,
  OTHER_HOTEND_MAX,
  OTHER_HOTEND_MIN,
  presetSafetyMissingIssue,
  presetSafetyOf,
  profileOf,
  PTFE_MAX_HOTEND,
} from './printerSafety.js';

// ---------------------------------------------------------------------------
// the three answers
// ---------------------------------------------------------------------------

test('PTFE answers 240 °C, all-metal the global ceiling, and the two constants sit where T-080 puts them', () => {
  assert.equal(hotendLimitOf('ptfe'), 240);
  assert.equal(hotendLimitOf('all-metal'), 450);
  assert.equal(PTFE_MAX_HOTEND, 240);
  assert.equal(ALL_METAL_MAX_HOTEND, 450);
});

test('"other" takes the typed number inside the global window and refuses the rest', () => {
  assert.equal(hotendLimitOf('other', 300), 300);
  assert.equal(hotendLimitOf('other', 150), 150);
  assert.equal(hotendLimitOf('other', 450), 450);
  assert.equal(hotendLimitOf('other', 149), undefined);
  assert.equal(hotendLimitOf('other', 451), undefined);
  assert.equal(hotendLimitOf('other'), undefined);
  assert.equal(hotendLimitOf('other', Number.NaN), undefined);
  // the window is the global hotend window, not a new one
  assert.equal(OTHER_HOTEND_MIN, 150);
  assert.equal(OTHER_HOTEND_MAX, 450);
});

// ---------------------------------------------------------------------------
// the record
// ---------------------------------------------------------------------------

test('a preset reads its own profile and no other; an empty record or name answers nothing', () => {
  const record = { 'MK3S+': { hotendType: 'ptfe', maxHotend: 240 } } as const;
  assert.deepEqual(profileOf(record, 'MK3S+'), { hotendType: 'ptfe', maxHotend: 240 });
  assert.equal(profileOf(record, 'MK4'), undefined);
  assert.equal(profileOf(record, undefined), undefined);
  assert.equal(profileOf({}, 'MK3S+'), undefined);
  // a hand-written record without a limit is "not answered", not "no limit"
  assert.equal(profileOf({ X: { hotendType: 'ptfe' } } as never, 'X'), undefined);
});

test('the profile becomes the limits the slice check compares against', () => {
  assert.deepEqual(presetSafetyOf({ profile: { hotendType: 'ptfe', maxHotend: 240 } }), { maxHotend: 240 });
  assert.deepEqual(presetSafetyOf({ profile: { hotendType: 'other', maxHotend: 300, maxBed: 100 } }), {
    maxHotend: 300,
    maxBed: 100,
  });
  assert.equal(presetSafetyOf(undefined), undefined);
  assert.equal(presetSafetyOf({}), undefined);
});

// ---------------------------------------------------------------------------
// stricter of preset and host (AC-3)
// ---------------------------------------------------------------------------

test('the stricter hotend limit wins in both directions; neither side is relaxed', () => {
  const host = { hotendType: 'other', maxHotend: 240 } as const;
  assert.deepEqual(combinedSafety({ maxHotend: 240 }, { ...host, maxHotend: 300 }), { maxHotend: 240 });
  assert.deepEqual(combinedSafety({ maxHotend: 300 }, { ...host, maxHotend: 240 }), { maxHotend: 240 });
  assert.deepEqual(combinedSafety({ maxHotend: 200 }, { ...host, maxHotend: 240 }), { maxHotend: 200 });
  // equal is equal, and a kind only one side sets is taken as it is
  assert.deepEqual(combinedSafety({ maxHotend: 240 }, { ...host }), { maxHotend: 240 });
  assert.deepEqual(combinedSafety({ maxBed: 100 }, { hotendType: 'ptfe', maxHotend: 240 }), { maxHotend: 240, maxBed: 100 });
  assert.deepEqual(combinedSafety(undefined, { hotendType: 'ptfe', maxHotend: 240 }), { maxHotend: 240 });
  assert.deepEqual(combinedSafety({ maxHotend: 240 }, undefined), { maxHotend: 240 });
  assert.equal(combinedSafety(undefined, undefined), undefined);
  // an empty host block is "not set", not a limit of zero
  assert.deepEqual(combinedSafety({}, { hotendType: 'ptfe', maxHotend: 240 }), { maxHotend: 240 });
});

// ---------------------------------------------------------------------------
// the warning of an unanswered preset (AC-2)
// ---------------------------------------------------------------------------

test('a preset nobody answered warns (never blocks); either answer ends the warning', () => {
  const missing = presetSafetyMissingIssue('MK4');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].rule, 'config.no_printer_safety');
  assert.equal(missing[0].severity, 'warn');
  assert.match(missing[0].message, /No hotend type set for this printer/);
  assert.match(missing[0].message, /450 .C ceiling/);

  assert.deepEqual(presetSafetyMissingIssue('MK4', { profile: { hotendType: 'ptfe', maxHotend: 240 } }), []);
  // the T-080 host form answers the same question, so a bound host that answered ends it too
  assert.deepEqual(presetSafetyMissingIssue('MK4', { hostAnswered: true }), []);
  assert.deepEqual(presetSafetyMissingIssue(undefined), []);
});
