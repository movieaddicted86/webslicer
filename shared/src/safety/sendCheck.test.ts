/**
 * The send gate (S1-b, T-026): which print host may receive which G-code.
 *
 * The rules are the contract of the 409 the server answers and of what the send dialog shows, so
 * they are pinned here once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingIssues, checkSend, normalizePresetName, presetLineage, sendMatch, type PresetLink } from './sendCheck.js';

const MK4S = 'Original Prusa MK4S HF0.4 nozzle';
const MINI = 'Original Prusa MINI+ 0.4 nozzle';
const job = (printer = MK4S) => ({ presets: { printer } });
const host = (presetName?: string, name = 'Workshop MK4S') => ({ id: 'p1', name, presetName });

/** The system presets with the aliases PrusaSlicer derives from their "@variant" suffix. */
const SYSTEM: PresetLink[] = [
  { name: MK4S, alias: 'Original Prusa MK4S' },
  { name: MINI, alias: 'Original Prusa MINI+' },
];

test('a matching printer preset has no issues', () => {
  assert.deepEqual(checkSend(job(), host(MK4S)), []);
  assert.deepEqual(checkSend(job(), host(MK4S), { presets: SYSTEM }), []);
  // the alias is the same profile, not a relative of it
  assert.deepEqual(checkSend(job(), host('Original Prusa MK4S'), { presets: SYSTEM }), []);
  assert.equal(sendMatch(MK4S, 'Original Prusa MK4S', { presets: SYSTEM }), 'exact');
});

test('a different printer preset blocks with a stable rule id', () => {
  const issues = checkSend(job(), host(MINI));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'send.preset_mismatch');
  assert.equal(issues[0].severity, 'block');
  assert.match(issues[0].message, /Original Prusa MK4S HF0\.4 nozzle/);
  assert.match(issues[0].message, /Original Prusa MINI\+ 0\.4 nozzle/);
  assert.match(issues[0].message, /Workshop MK4S/);
  assert.equal(blockingIssues(issues).length, 1);
});

test('an unbound printer warns instead of blocking', () => {
  const issues = checkSend(job(), host(undefined, 'Spare host'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'send.no_binding');
  assert.equal(issues[0].severity, 'warn');
  assert.match(issues[0].message, /Spare host/);
  assert.equal(blockingIssues(issues).length, 0);
  // an empty name is as unbound as a missing one
  assert.equal(checkSend(job(), host('   '))[0].rule, 'send.no_binding');
});

test('an empty job preset does not silently pass a bound printer', () => {
  const issues = checkSend(job(''), host(MK4S));
  assert.equal(issues[0].rule, 'send.preset_mismatch');
  assert.equal(issues[0].severity, 'block');
});

test('preset names are compared trimmed and case-insensitively, spacing collapses', () => {
  assert.equal(normalizePresetName('  Original   Prusa MK4S  '), 'original prusa mk4s');
  assert.deepEqual(checkSend(job(MK4S), host(' original prusa  mk4s hf0.4 NOZZLE ')), []);
  // different profiles of the same model stay different: spacing is not the only difference
  assert.equal(checkSend(job(MK4S), host('Original Prusa MK4S HF0.6 nozzle'))[0].severity, 'block');
});

test('a user preset derived from the job preset warns, in both directions', () => {
  const presets: PresetLink[] = [...SYSTEM, { name: 'Workshop MK4S', inherits: MK4S }];
  // the host runs a preset derived from the one the G-code was sliced for
  const issues = checkSend(job(MK4S), host('Workshop MK4S', 'Bench host'), { presets });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'send.preset_derived');
  assert.equal(issues[0].severity, 'warn');
  assert.equal(blockingIssues(issues).length, 0, 'a derived preset does not stop the send');
  assert.match(issues[0].message, /"Bench host" is set up for the printer preset "Workshop MK4S", which is derived from/);
  assert.match(issues[0].message, /nozzle/);
  // the other way round: the job runs the user preset on the system preset's host
  const other = checkSend(job('Workshop MK4S'), host(MK4S, 'Bench host'), { presets });
  assert.equal(other[0].rule, 'send.preset_derived');
  assert.equal(other[0].severity, 'warn');
  assert.match(other[0].message, /"Workshop MK4S", which is derived from "Original Prusa MK4S HF0\.4 nozzle"/);
  // the alias of the parent is the parent
  assert.equal(sendMatch('Workshop MK4S', 'Original Prusa MK4S', { presets }), 'derived');
});

test('two presets that only share an ancestor are a mismatch, not a match', () => {
  const presets: PresetLink[] = [
    ...SYSTEM,
    { name: 'My MK4S A', inherits: MK4S },
    { name: 'My MK4S B', inherits: MK4S },
    { name: 'My MK4S 0.6', inherits: 'Original Prusa MK4S HF0.6 nozzle' },
    { name: 'Original Prusa MK4S HF0.6 nozzle', inherits: MK4S },
  ];
  const siblings = checkSend(job('My MK4S A'), host('My MK4S B'), { presets });
  assert.equal(siblings[0].rule, 'send.preset_mismatch');
  assert.equal(siblings[0].severity, 'block');
  // two variants of one base are siblings as well
  assert.equal(sendMatch('My MK4S A', 'Original Prusa MK4S HF0.6 nozzle', { presets }), 'none');
  assert.equal(sendMatch('My MK4S A', 'My MK4S 0.6', { presets }), 'none');
});

test('a two-level chain is derived, and so is its top', () => {
  const presets: PresetLink[] = [...SYSTEM, { name: 'Middle', inherits: MK4S }, { name: 'Top', inherits: 'Middle' }];
  assert.equal(sendMatch('Top', MK4S, { presets }), 'derived');
  assert.equal(sendMatch(MK4S, 'Top', { presets }), 'derived');
  assert.equal(sendMatch('Top', 'Middle', { presets }), 'derived');
  // a sibling below a common middle is not
  assert.equal(sendMatch('Top', 'Original Prusa MINI+ 0.4 nozzle', { presets }), 'none');
});

test('presetLineage walks the chain without cycling and keeps the alias with its preset', () => {
  const presets: PresetLink[] = [
    { name: 'Child', inherits: 'Parent' },
    { name: 'Parent', inherits: 'Child' },
    { name: MK4S, alias: 'Original Prusa MK4S' },
    { name: 'Workshop MK4S', inherits: MK4S },
  ];
  assert.deepEqual(presetLineage('Child', presets), { self: ['Child'], ancestors: ['Parent'] });
  assert.deepEqual(presetLineage('Workshop MK4S', presets), {
    self: ['Workshop MK4S'],
    ancestors: [MK4S, 'Original Prusa MK4S'],
  });
  assert.deepEqual(presetLineage('Unknown preset', presets), { self: ['Unknown preset'], ancestors: [] });
  assert.deepEqual(presetLineage('', presets), { self: [], ancestors: [] });
});

test('a second, unrelated user preset is still a mismatch', () => {
  const presets: PresetLink[] = [...SYSTEM, { name: 'Workshop MK4S', inherits: MK4S }, { name: 'Garage MINI', inherits: MINI }];
  const issues = checkSend(job(MK4S), host('Garage MINI'), { presets });
  assert.equal(issues[0].rule, 'send.preset_mismatch');
  assert.equal(issues[0].severity, 'block');
});

test('the check is built to take S1-c preflight issues into the same list', () => {
  // one job, one target, one list: a caller concatenates the preflight findings with these
  const issues = [...checkSend(job(), host('Other')), { rule: 'preflight.forbidden_gcode', severity: 'block' as const, message: 'M500' }];
  assert.equal(blockingIssues(issues).length, 2);
});
