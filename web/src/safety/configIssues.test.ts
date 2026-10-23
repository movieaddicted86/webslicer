/**
 * Pins for the browser side of the configuration limits (S1-e).
 *
 * The point of the module is that there is *no* second implementation: the issues of a preset
 * combination must be the ones the server's `checkConfigLimits` produces for the same request, with
 * only the field mapping added on top. The three config sets below are the server's own scenarios
 * (S1-d, T-032): the typo catcher, the soft range and a clean preset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfigLimits, type Config, type ConfigIssue } from '@webslicer/shared';
import { configKeyOf, fieldIssueOf, issueTargetOf, limitIssuesOf, type LimitPresets } from './configIssues.js';

const PRINTER: Config = { printer_technology: 'FFF', nozzle_diameter: '0.4' };
const PRINT: Config = { layer_height: '0.2' };

function presetsOf(filament: Config, printer: Config = PRINTER, print: Config = PRINT): LimitPresets {
  return { print, printer, filaments: [filament] };
}

/** What the slice route builds for the same presets – the comparison baseline. */
function serverIssues(presets: LimitPresets): ConfigIssue[] {
  return checkConfigLimits({
    print: { config: presets.print },
    printer: { config: presets.printer },
    filaments: presets.filaments.map((config) => ({ config })),
  });
}

test('the UI issues are the shared function’s issues for three configs', () => {
  const cases: LimitPresets[] = [
    // 1: the typo catcher – a hotend that would not be reached
    presetsOf({ filament_type: 'PLA', temperature: '2150' }),
    // 2: a soft range – PLA printed unusually hot, no block
    presetsOf({ filament_type: 'PLA', temperature: '265' }),
    // 3: a clean preset plus a layer height above twice the nozzle
    presetsOf({ filament_type: 'PETG', temperature: '240' }, PRINTER, { layer_height: '1.0' }),
  ];
  for (const presets of cases) {
    assert.deepEqual(limitIssuesOf(presets, 1), serverIssues(presets));
  }
  // and the three cases really are three different outcomes
  const [typo, soft, tall] = cases.map((p) => limitIssuesOf(p, 1));
  assert.deepEqual(
    typo.map((i) => [i.rule, i.severity]),
    [['config.hotend_limit', 'block']],
  );
  assert.deepEqual(
    soft.map((i) => [i.rule, i.severity, i.key, i.limit]),
    [['config.filament_temperature', 'warn', 'temperature', '175–255 °C for PLA']],
  );
  assert.deepEqual(
    tall.map((i) => [i.rule, i.severity, i.key]),
    [['config.layer_height', 'block', 'layer_height']],
  );
});

test('only the filament slots the request carries are checked', () => {
  const presets: LimitPresets = {
    ...presetsOf({ filament_type: 'PLA', temperature: '215' }),
    filaments: [
      { filament_type: 'PLA', temperature: '215' },
      { filament_type: 'ABS', temperature: '2150' },
    ],
  };
  assert.equal(limitIssuesOf(presets, 1).length, 0, 'the second slot is not sent');
  const both = limitIssuesOf(presets, 2);
  assert.equal(both.length, 1);
  // a multi-filament request says which extruder it means; the mapping reads that back
  assert.deepEqual(issueTargetOf(both[0]), { section: 'filament', filamentIndex: 1, key: 'temperature' });
});

test('an issue maps to the settings tab and the field, without the per-extruder element', () => {
  const issues = serverIssues(presetsOf({ filament_type: 'PLA', temperature: '215,2150' }, { ...PRINTER, nozzle_diameter: '0.4,0.4,0.4' }));
  const vector = issues.find((i) => i.key.startsWith('temperature'));
  assert.ok(vector);
  assert.deepEqual(issueTargetOf(vector), { section: 'filament', filamentIndex: 0, key: 'temperature' });

  const prefixed: ConfigIssue = {
    rule: 'config.layer_height',
    severity: 'block',
    message: 'layer_height = 10 mm …',
    key: 'layer_height',
    value: '10',
    limit: '> 0 mm',
  };
  assert.deepEqual(issueTargetOf(prefixed), { section: 'print', filamentIndex: 0, key: 'layer_height' });
  assert.deepEqual(issueTargetOf({ ...prefixed, rule: 'config.nozzle_diameter', key: 'nozzle_diameter' }), {
    section: 'printer',
    filamentIndex: 0,
    key: 'nozzle_diameter',
  });
});

test('a field shows a block over a warning, and another extruder’s issue not at all', () => {
  const presets: LimitPresets = {
    ...presetsOf({ filament_type: 'PLA', temperature: '215' }),
    filaments: [
      { filament_type: 'PLA', temperature: '265' },
      { filament_type: 'PLA', temperature: '2150' },
    ],
  };
  const issues = limitIssuesOf(presets, 2);
  const first = fieldIssueOf(issues, 'filament', 'temperature', 0);
  assert.equal(first?.severity, 'warn');
  const second = fieldIssueOf(issues, 'filament', 'temperature', 1);
  assert.equal(second?.severity, 'block');
  assert.equal(fieldIssueOf(issues, 'filament', 'temperature', 2), undefined);
  assert.equal(fieldIssueOf(issues, 'print', 'temperature'), undefined);
});

test('the memo key changes with the configs and the extruder count only', () => {
  const a = presetsOf({ filament_type: 'PLA', temperature: '215' });
  const b = presetsOf({ filament_type: 'PLA', temperature: '2150' });
  assert.equal(configKeyOf(a, 1), configKeyOf(presetsOf({ filament_type: 'PLA', temperature: '215' }), 1));
  assert.notEqual(configKeyOf(a, 1), configKeyOf(b, 1));
  // the extruder count only matters while there are more slots to send
  const two = { ...a, filaments: [a.filaments[0], { filament_type: 'ABS', temperature: '250' }] };
  assert.notEqual(configKeyOf(two, 1), configKeyOf(two, 2));
});
