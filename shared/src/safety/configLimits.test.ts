/**
 * The configuration limits (S1-d, T-032): the global typo catchers and the soft ranges by material.
 * Pinned here because the slice routes refuse a request against this module.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockingConfigIssues,
  checkConfigLimits,
  checkConfigValues,
  checkRequestConfigLimits,
  FILAMENT_SOFT_RANGES,
  GLOBAL_LIMITS,
  maxTemperaturesOf,
  printerLimitIssues,
  softRangeOf,
} from './configLimits.js';

const rulesOf = (issues: { rule: string }[]) => issues.map((i) => i.rule);
const keyOf = (issues: { key: string }[]) => issues.map((i) => i.key);

// ---------------------------------------------------------------------------
// global typo catchers
// ---------------------------------------------------------------------------

test('hotend temperatures: 0 (off) and the whole 150–450 °C window pass, both edges included', () => {
  for (const value of ['0', '150', '215', '300', '450']) {
    assert.deepEqual(checkConfigValues('filament', { temperature: value }), [], `temperature = ${value}`);
    assert.deepEqual(checkConfigValues('filament', { first_layer_temperature: value }), [], `first_layer = ${value}`);
  }
  assert.equal(GLOBAL_LIMITS.hotend.min, 150);
  assert.equal(GLOBAL_LIMITS.hotend.max, 450);
});

test('hotend temperatures: 149, 451 and a typo like 2150 block, with the key, value and limit', () => {
  for (const value of ['149', '451', '2150']) {
    const issues = checkConfigValues('filament', { temperature: value });
    assert.equal(issues.length, 1, `temperature = ${value}`);
    assert.equal(issues[0].rule, 'config.hotend_limit');
    assert.equal(issues[0].severity, 'block');
    assert.equal(issues[0].key, 'temperature');
    assert.equal(issues[0].value, value);
    assert.match(issues[0].limit, /150–450 °C/);
    assert.match(issues[0].message, /temperature = /);
  }
  // the first layer key is the same rule
  const first = checkConfigValues('filament', { first_layer_temperature: '500' });
  assert.equal(first[0].rule, 'config.hotend_limit');
  assert.equal(first[0].key, 'first_layer_temperature');
});

test('bed and chamber temperatures use their own windows', () => {
  assert.deepEqual(checkConfigValues('filament', { bed_temperature: '150', first_layer_bed_temperature: '0' }), []);
  const bed = checkConfigValues('filament', { bed_temperature: '1100' });
  assert.deepEqual(rulesOf(bed), ['config.bed_limit']);
  assert.equal(bed[0].key, 'bed_temperature');
  assert.match(bed[0].limit, /0–150 °C/);

  assert.deepEqual(checkConfigValues('filament', { chamber_temperature: '100' }), []);
  const chamber = checkConfigValues('filament', { chamber_temperature: '101', chamber_minimal_temperature: '120' });
  assert.deepEqual(rulesOf(chamber), ['config.chamber_limit', 'config.chamber_limit']);
  assert.deepEqual(keyOf(chamber), ['chamber_temperature', 'chamber_minimal_temperature']);
});

test('a per-extruder vector is checked element-wise and names the element', () => {
  const issues = checkConfigValues('filament', { temperature: '215,2150' });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].key, 'temperature[1]');
  assert.equal(issues[0].value, '2150');
  // every bad element is reported, not only the first
  const both = checkConfigValues('filament', { temperature: '2150,2150' });
  assert.deepEqual(keyOf(both), ['temperature[0]', 'temperature[1]']);
});

test('a nil element (nullable vector), a missing key and an empty value are skipped', () => {
  assert.deepEqual(checkConfigValues('filament', { temperature: 'nil' }), []);
  const skipped = checkConfigValues('filament', { temperature: 'nil,2150' });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].key, 'temperature[1]');
  assert.equal(skipped[0].value, '2150');
  assert.match(skipped[0].message, /^temperature\[1\] = 2150/);
  assert.deepEqual(checkConfigValues('filament', {}), []);
  assert.deepEqual(checkConfigValues('filament', { temperature: '' }), []);
});

test('a value that is not a number is not a temperature issue (the schema/validation owns that)', () => {
  // the hotend check only judges numbers; a percent or a stray string is left to the option schema
  assert.deepEqual(checkConfigValues('filament', { temperature: '50%' }), []);
  assert.deepEqual(checkConfigValues('filament', { temperature: 'hot' }), []);
});

test('nozzle diameter: 0.1–2.0 mm, both edges included, a string and a nil skipped', () => {
  for (const value of ['0.1', '0.4', '1.0', '2.0']) assert.deepEqual(checkConfigValues('printer', { nozzle_diameter: value }), [], value);
  const low = checkConfigValues('printer', { nozzle_diameter: '0.05' });
  assert.equal(low[0].rule, 'config.nozzle_diameter');
  assert.equal(low[0].severity, 'block');
  assert.equal(low[0].key, 'nozzle_diameter');
  const high = checkConfigValues('printer', { nozzle_diameter: '0.4,4' });
  assert.equal(high[0].key, 'nozzle_diameter[1]');
  assert.deepEqual(checkConfigValues('printer', {}), []);
});

test('layer height: > 0 and at most twice the nozzle; nil and a missing nozzle are skipped', () => {
  assert.deepEqual(checkConfigValues('print', { layer_height: '0.2' }, { nozzleDiameter: '0.4' }), []);
  assert.deepEqual(checkConfigValues('print', { layer_height: '0.4' }, { nozzleDiameter: '0.4' }), [], 'equal to the nozzle is allowed');
  // twice the nozzle is the edge: shipped drafts go up to 1.6×, a typo does not stop there
  assert.deepEqual(checkConfigValues('print', { layer_height: '0.8' }, { nozzleDiameter: '0.4' }), []);
  const zero = checkConfigValues('print', { layer_height: '0' }, { nozzleDiameter: '0.4' });
  assert.equal(zero[0].rule, 'config.layer_height');
  assert.equal(zero[0].severity, 'block');
  assert.match(zero[0].message, /greater than 0/);
  const above = checkConfigValues('print', { layer_height: '0.81' }, { nozzleDiameter: '0.4' });
  assert.equal(above[0].rule, 'config.layer_height');
  assert.match(above[0].message, /more than 2× the nozzle/);
  // the typo the rule exists for
  assert.equal(checkConfigValues('print', { layer_height: '10' }, { nozzleDiameter: '0.4' })[0].rule, 'config.layer_height');
  assert.deepEqual(checkConfigValues('print', { layer_height: '0.6' }), [], 'without a nozzle there is nothing to compare');
  assert.deepEqual(checkConfigValues('print', { layer_height: '0.6' }, { nozzleDiameter: 'nil' }), []);
  // a non-numeric layer height is blocked here: it is the one value the slicer cannot even read
  const text = checkConfigValues('print', { layer_height: 'thin' }, { nozzleDiameter: '0.4' });
  assert.equal(text[0].rule, 'config.layer_height');
});

test('an SLA print preset is checked as a print preset (layer height), not for hotend/bed', () => {
  assert.deepEqual(checkConfigValues('sla_print', { layer_height: '0.05' }), []);
  assert.equal(checkConfigValues('sla_print', { layer_height: '0' })[0].rule, 'config.layer_height');
});

// ---------------------------------------------------------------------------
// soft ranges
// ---------------------------------------------------------------------------

test('the soft range table covers the six materials of the task, with hotend and bed windows', () => {
  for (const type of ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC']) {
    assert.ok(FILAMENT_SOFT_RANGES[type], type);
    assert.ok(FILAMENT_SOFT_RANGES[type].hotend, `${type} hotend`);
    assert.ok(FILAMENT_SOFT_RANGES[type].bed, `${type} bed`);
  }
});

test('a filament type finds its range, including variants and the bundles spellings', () => {
  assert.equal(softRangeOf('PLA'), FILAMENT_SOFT_RANGES.PLA);
  assert.equal(softRangeOf(' pla '), FILAMENT_SOFT_RANGES.PLA);
  assert.equal(softRangeOf('PLA-CF'), FILAMENT_SOFT_RANGES.PLA);
  assert.equal(softRangeOf('NYLON'), FILAMENT_SOFT_RANGES.PA);
  assert.equal(softRangeOf('FLEX'), FILAMENT_SOFT_RANGES.TPU);
  assert.equal(softRangeOf('TPU98A'), FILAMENT_SOFT_RANGES.TPU);
  assert.equal(softRangeOf('PVA'), undefined);
  assert.equal(softRangeOf(''), undefined);
});

test('PLA at 265 °C warns but does not block; a value inside the window is quiet', () => {
  const usual = checkConfigValues('filament', { filament_type: 'PLA', temperature: '215', bed_temperature: '60' });
  assert.deepEqual(usual, []);
  const odd = checkConfigValues('filament', { filament_type: 'PLA', temperature: '265' });
  assert.equal(odd.length, 1);
  assert.equal(odd[0].rule, 'config.filament_temperature');
  assert.equal(odd[0].severity, 'warn');
  assert.equal(odd[0].key, 'temperature');
  assert.match(odd[0].message, /unusual for PLA/);
  assert.match(odd[0].limit, /PLA/);
});

test('the bed soft range has its own rule, and both edges of a window are quiet', () => {
  const [lo, hi] = FILAMENT_SOFT_RANGES.PLA.bed as readonly [number, number];
  assert.deepEqual(checkConfigValues('filament', { filament_type: 'PLA', bed_temperature: String(lo) }), []);
  assert.deepEqual(checkConfigValues('filament', { filament_type: 'PLA', bed_temperature: String(hi) }), []);
  const cold = checkConfigValues('filament', { filament_type: 'PLA', bed_temperature: String(lo - 1) });
  assert.deepEqual(rulesOf(cold), ['config.filament_bed_temperature']);
  assert.equal(cold[0].severity, 'warn');
});

test('an unknown material warns for no range at all, but the global catchers still apply', () => {
  assert.deepEqual(checkConfigValues('filament', { filament_type: 'PVA', temperature: '300' }), []);
  assert.equal(checkConfigValues('filament', { filament_type: 'PVA', temperature: '500' })[0].rule, 'config.hotend_limit');
});

test('a per-extruder type vector pairs each material with its own temperature', () => {
  // extruder 0 prints PLA at 215 (quiet), extruder 1 PC at 270 (inside PC's window – not PLA's)
  const both = checkConfigValues('filament', { filament_type: 'PLA,PC', temperature: '215,270' });
  assert.deepEqual(both, []);
  const mismatched = checkConfigValues('filament', { filament_type: 'PLA,PC', temperature: '215,215' });
  assert.equal(mismatched.length, 1, 'PC at 215 °C is below its window');
  assert.equal(mismatched[0].key, 'temperature[1]');
});

// ---------------------------------------------------------------------------
// the whole request
// ---------------------------------------------------------------------------

test('checkConfigLimits names the extruder of a multi-material request and leaves a single one unprefixed', () => {
  const single = checkConfigLimits({
    filaments: [{ config: { temperature: '2150' } }],
    printer: { config: { nozzle_diameter: '0.4' } },
    print: { config: { layer_height: '0.2' } },
  });
  assert.deepEqual(keyOf(single), ['temperature']);

  const multi = checkConfigLimits({
    filaments: [{ config: { temperature: '215' } }, { config: { temperature: '2150' } }],
    printer: { config: {} },
    print: { config: {} },
  });
  assert.deepEqual(keyOf(multi), ['filament[1].temperature']);

  const mixed = checkConfigLimits({
    filaments: [{ config: { temperature: '215' } }],
    printer: { config: { nozzle_diameter: '0.05' } },
    print: { config: { layer_height: '0.6' } },
  });
  assert.deepEqual(
    mixed.map((i) => `${i.rule}:${i.key}`),
    ['config.nozzle_diameter:nozzle_diameter', 'config.layer_height:layer_height'],
  );
});

test('a request without configs is quiet and a request without filaments still checks printer and print', () => {
  assert.deepEqual(checkConfigLimits({}), []);
  assert.equal(blockingConfigIssues(checkConfigLimits({})).length, 0);
  assert.deepEqual(keyOf(checkConfigLimits({ printer: { config: { nozzle_diameter: '9' } } })), ['nozzle_diameter']);
});

test('the blocking list holds the blocks only', () => {
  const issues = checkConfigLimits({
    filaments: [{ config: { filament_type: 'PLA', temperature: '2150' } }],
    printer: { config: {} },
    print: { config: {} },
  });
  assert.equal(issues.length, 1);
  assert.deepEqual(rulesOf(blockingConfigIssues(issues)), ['config.hotend_limit']);
  // a soft-range warning is part of the list but not of the blocks
  const withWarn = checkConfigLimits({
    filaments: [{ config: { filament_type: 'PLA', temperature: '2150', bed_temperature: '20' } }],
    printer: { config: {} },
    print: { config: {} },
  });
  assert.deepEqual(rulesOf(withWarn), ['config.hotend_limit', 'config.filament_bed_temperature']);
  assert.deepEqual(rulesOf(blockingConfigIssues(withWarn)), ['config.hotend_limit']);
  const warns = checkConfigLimits({ filaments: [{ config: { filament_type: 'PLA', bed_temperature: '20' } }] });
  assert.equal(warns.length, 1);
  assert.deepEqual(blockingConfigIssues(warns), []);
});

// ---------------------------------------------------------------------------
// the printer safety profile
// ---------------------------------------------------------------------------

test('a job above the target printer limits blocks; at the limit is fine', () => {
  const temps = maxTemperaturesOf({
    filaments: [{ config: { temperature: '245,250', first_layer_temperature: '255', bed_temperature: '100' } }],
  });
  assert.deepEqual(temps, { hotend: 255, bed: 100 });

  const issues = printerLimitIssues(temps, { maxHotend: 240 });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'send.printer_limit');
  assert.equal(issues[0].severity, 'block');
  assert.match(issues[0].message, /255 °C/);
  assert.match(issues[0].message, /240 °C/);

  assert.deepEqual(printerLimitIssues(temps, { maxHotend: 255 }), [], 'exactly at the limit passes');
  assert.deepEqual(printerLimitIssues(temps, { maxBed: 100 }), []);
  assert.equal(printerLimitIssues(temps, { maxBed: 90 }).length, 1);
  assert.deepEqual(printerLimitIssues(temps, {}), [], 'an empty profile has no limits');
  assert.deepEqual(printerLimitIssues(temps, undefined), []);
});

test('the maximum ignores 0 and nil, and reads every filament', () => {
  assert.deepEqual(maxTemperaturesOf({ filaments: [{ config: { temperature: '0' } }, { config: { temperature: 'nil,230' } }] }), {
    hotend: 230,
    bed: 0,
  });
});

// ---------------------------------------------------------------------------
// N3: the merged config, the printer/print sections, per-object layer heights
// ---------------------------------------------------------------------------

test('a temperature in the printer config is checked like a filament one (N3)', () => {
  const issues = checkRequestConfigLimits({
    printer: { config: { temperature: '999' } },
    print: { config: {} },
    filaments: [{ config: { filament_type: 'PLA' } }],
  });
  assert.deepEqual(rulesOf(issues), ['config.hotend_limit']);
  assert.equal(issues[0].severity, 'block');
  assert.equal(issues[0].key, 'temperature');
  assert.equal(issues[0].value, '999');
  // a print config's bed temperature is the same rule
  const bed = checkRequestConfigLimits({ print: { config: { bed_temperature: '999' } } });
  assert.deepEqual(rulesOf(bed), ['config.bed_limit']);
});

test('a value that only the merged config carries is caught (N3)', () => {
  // the preset sections are fine; the slicer would receive the merged value
  const issues = checkRequestConfigLimits({
    printer: { config: { nozzle_diameter: '0.4' } },
    print: { config: { layer_height: '0.2' } },
    filaments: [{ config: { filament_type: 'PLA', temperature: '215' } }],
    merged: { nozzle_diameter: '0.4', layer_height: '10' },
  });
  assert.deepEqual(rulesOf(issues), ['config.layer_height']);
  assert.match(issues[0].message, /layer_height = 10 mm/);
  // a legit merged config reports nothing
  assert.deepEqual(
    checkRequestConfigLimits({
      print: { config: { layer_height: '0.2' } },
      printer: { config: { nozzle_diameter: '0.4' } },
      filaments: [{ config: { temperature: '215', bed_temperature: '60', filament_type: 'PLA' } }],
      merged: { layer_height: '0.2', nozzle_diameter: '0.4', temperature: '215', bed_temperature: '60' },
    }),
    [],
  );
});

test('a finding two views produce is reported once (N3)', () => {
  const issues = checkRequestConfigLimits({
    print: { config: {} },
    printer: { config: { nozzle_diameter: '9' } },
    filaments: [{ config: { temperature: '2150', filament_type: 'PLA' } }],
    merged: { temperature: '2150', nozzle_diameter: '9' },
  });
  assert.deepEqual(rulesOf(issues), ['config.nozzle_diameter', 'config.hotend_limit']);
});

test('a per-object and per-range layer_height override is checked with the nozzle rule (N3)', () => {
  const issues = checkRequestConfigLimits({
    printer: { config: { nozzle_diameter: '0.4' } },
    print: { config: { layer_height: '0.2' } },
    objects: [
      { config: { layer_height: '0.2' } },
      { config: { layer_height: '0.9' } },
      { ranges: [{ config: { layer_height: '0.25' } }, { config: { layer_height: '5' } }] },
    ],
  });
  assert.deepEqual(
    issues.map((i) => [i.rule, i.key]),
    [
      ['config.layer_height', 'object[1].layer_height'],
      ['config.layer_height', 'object[2].range[1].layer_height'],
    ],
  );
  assert.match(issues[0].message, /object\[1\]: layer_height = 0.9 mm/);
  // an object override must not be reported on its own: the nozzle is the printer's
  assert.deepEqual(checkRequestConfigLimits({ objects: [{ config: { layer_height: '0.9' } }] }), []);
});
