/**
 * The send gate (S1-b, T-026): which print host may receive which G-code.
 *
 * The rules are the contract of the 409 the server answers and of what the send dialog shows, so
 * they are pinned here once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingIssues, checkSend, normalizePresetName, presetEquivalents, sendMatches, type PresetLink } from './sendCheck.js';

const job = (printer = 'Original Prusa MK4S HF0.4 nozzle') => ({ presets: { printer } });
const host = (presetName?: string, name = 'Workshop MK4S') => ({ id: 'p1', name, presetName });

test('a matching printer preset has no issues', () => {
  assert.deepEqual(checkSend(job(), host('Original Prusa MK4S HF0.4 nozzle')), []);
});

test('a different printer preset blocks with a stable rule id', () => {
  const issues = checkSend(job(), host('Original Prusa MINI+ 0.4 nozzle'));
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
  const issues = checkSend(job(''), host('Original Prusa MK4S HF0.4 nozzle'));
  assert.equal(issues[0].rule, 'send.preset_mismatch');
  assert.equal(issues[0].severity, 'block');
});

test('preset names are compared trimmed and case-insensitively, spacing collapses', () => {
  assert.equal(normalizePresetName('  Original   Prusa MK4S  '), 'original prusa mk4s');
  assert.deepEqual(checkSend(job('Original Prusa MK4S HF0.4 nozzle'), host(' original prusa  mk4s hf0.4 NOZZLE ')), []);
  // different profiles of the same model stay different: spacing is not the only difference
  assert.equal(checkSend(job('Original Prusa MK4S HF0.4 nozzle'), host('Original Prusa MK4S HF0.6 nozzle'))[0].severity, 'block');
});

test('a system preset is the same machine as a user preset that inherits from it', () => {
  const presets: PresetLink[] = [
    { name: 'Workshop MK4S', inherits: 'Original Prusa MK4S HF0.4 nozzle' },
    { name: 'Original Prusa MK4S HF0.4 nozzle', alias: 'Original Prusa MK4S' },
  ];
  // the job runs the system preset, the host is bound to the user preset
  const issues = checkSend(job('Original Prusa MK4S HF0.4 nozzle'), host('Workshop MK4S'), {
    printerPresetNames: presetEquivalents('Workshop MK4S', presets),
  });
  assert.deepEqual(issues, []);
});

test('a user preset is the same machine as the system preset it inherits from (and as its alias)', () => {
  const presets: PresetLink[] = [{ name: 'Workshop MK4S', inherits: 'Original Prusa MK4S HF0.4 nozzle' }];
  assert.deepEqual(
    checkSend(job('Workshop MK4S'), host('Original Prusa MK4S HF0.4 nozzle'), {
      jobPresetNames: presetEquivalents('Workshop MK4S', presets),
    }),
    [],
  );
  // the alias of the inherited system preset comes along transitively
  const withAlias: PresetLink[] = [...presets, { name: 'Original Prusa MK4S HF0.4 nozzle', alias: 'Original Prusa MK4S' }];
  assert.deepEqual(
    checkSend(job('Workshop MK4S'), host('Original Prusa MK4S'), { jobPresetNames: presetEquivalents('Workshop MK4S', withAlias) }),
    [],
  );
});

test('presetEquivalents walks the inheritance chain without cycling', () => {
  const presets: PresetLink[] = [
    { name: 'Child', inherits: 'Parent' },
    { name: 'Parent', inherits: 'Child' },
  ];
  assert.deepEqual(presetEquivalents('Child', presets), ['Child', 'Parent']);
  assert.deepEqual(presetEquivalents('Unknown preset', presets), ['Unknown preset']);
  assert.deepEqual(presetEquivalents('', presets), []);
});

test('a second, unrelated user preset is still a mismatch', () => {
  const presets: PresetLink[] = [
    { name: 'Workshop MK4S', inherits: 'Original Prusa MK4S HF0.4 nozzle' },
    { name: 'Garage MINI', inherits: 'Original Prusa MINI+ 0.4 nozzle' },
  ];
  const issues = checkSend(job('Original Prusa MK4S HF0.4 nozzle'), host('Garage MINI'), {
    printerPresetNames: presetEquivalents('Garage MINI', presets),
  });
  assert.equal(issues[0].rule, 'send.preset_mismatch');
  assert.equal(issues[0].severity, 'block');
});

test('the check is built to take S1-c preflight issues into the same list', () => {
  // one job, one target, one list: a caller concatenates the preflight findings with these
  const issues = [...checkSend(job(), host('Other')), { rule: 'preflight.forbidden_gcode', severity: 'block' as const, message: 'M500' }];
  assert.equal(blockingIssues(issues).length, 2);
});

test('sendMatches is what the dialog preselects by: only a bound host that fits', () => {
  assert.equal(sendMatches(job(), host('Original Prusa MK4S HF0.4 nozzle')), true);
  assert.equal(sendMatches(job(), host(undefined)), false, 'an unbound host never matches');
  assert.equal(sendMatches(job(), host('Original Prusa MINI+ 0.4 nozzle')), false);
});
