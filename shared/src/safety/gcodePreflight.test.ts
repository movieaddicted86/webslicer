/**
 * The G-code preflight (S1-c, T-031): every rule and its edge cases, pinned once.
 *
 * The rules are what the send gate refuses a file for and what the dialog and the preview panel
 * show, so they are tested here rather than through the UI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BED_LIMIT,
  DEFAULT_HOTEND_LIMIT,
  GcodePreflight,
  MAX_ISSUES_PER_RULE,
  preflightSendIssues,
  preflightSummary,
  scanGcodeText,
  notScannedIssue,
  currentPreflight,
  PREFLIGHT_VERSION,
} from './gcodePreflight.js';

/** The G-code PrusaSlicer 2.9.6 wrote from `samples/bridge_table.stl` – real output, not a mock. */
const FIXTURE_DIR = path.join(import.meta.dirname, 'fixtures');
const skips = (file: string) => !fs.existsSync(path.join(FIXTURE_DIR, file));

const rules = (text: string, options = {}) => scanGcodeText(text, options).issues.map((i) => i.rule);
const one = (text: string, options = {}) => scanGcodeText(text, options).issues[0];

/** The MK3S limits, as the preset defines them (`machine_max_* = normal,silent`). */
const MK3S_LIMITS = {
  machine_max_acceleration_x: '1000,960',
  machine_max_acceleration_y: '1000,960',
  machine_max_acceleration_extruding: '1250,1250',
  machine_max_acceleration_travel: '1250,1250',
  machine_max_feedrate_x: '200,100',
  machine_max_feedrate_e: '120,120',
  machine_max_jerk_x: '8,8',
  machine_max_junction_deviation: '0.01,0.01',
};

// ---------------------------------------------------------------------------
// forbidden commands
// ---------------------------------------------------------------------------

test('M500 is a block and names the line', () => {
  const issue = one('G28\nM500\n');
  assert.equal(issue.rule, 'gcode.forbidden_command');
  assert.equal(issue.severity, 'block');
  assert.equal(issue.line, 2);
  assert.equal(issue.text, 'M500');
  assert.match(issue.message, /Line 2: "M500" stores the printer's settings/);
});

test('every forbidden command is caught, with case and parameters', () => {
  for (const command of ['M500', 'M502', 'M92 X80 Y80', 'M997', 'M851 Z-1.2']) {
    assert.deepEqual(rules(`${command}\n`), ['gcode.forbidden_command'], command);
    assert.deepEqual(rules(`${command.toLowerCase()}\n`), ['gcode.forbidden_command'], `${command} in lowercase`);
    assert.deepEqual(rules(`  ${command}  ; comment\n`), ['gcode.forbidden_command'], `${command} indented`);
  }
});

test('M906/M907 are a warn, not a block – PrusaSlicer sets the extruder current itself', () => {
  // the stock MK3S preset writes "M907 E430" in start_gcode and "M907 E538" in end_gcode
  for (const command of ['M906 X800', 'M907 E430', 'M907 E538']) {
    const issue = one(`G28\n${command}\n`);
    assert.equal(issue.rule, 'gcode.motor_current', command);
    assert.equal(issue.severity, 'warn');
    assert.equal(issue.line, 2);
    assert.match(issue.message, /motor current/);
    assert.match(issue.message, /damage the printer/);
  }
});

test('M121 switches the endstops off and blocks (N4)', () => {
  assert.deepEqual(rules('M121\n'), ['gcode.forbidden_command']);
  assert.deepEqual(rules('G28\nM121 E0\n'), ['gcode.forbidden_command'], 'with parameters');
  // M1210 is not M121
  assert.deepEqual(rules('M1210\n'), []);
});

test('M302 without a limit blocks; the vendor form "M302 S155" does not (N4)', () => {
  // PrusaSlicer's own PrusaResearch presets write "M302 S155" in their start G-code – a block would
  // refuse every MK4S/XL print, so the sweep's rule is: no limit, S0 or P1 block
  for (const command of ['M302', 'M302 S0', 'M302 P1', 'M302 S0 P1']) {
    assert.deepEqual(rules(`${command}\n`), ['gcode.forbidden_command'], command);
  }
  for (const command of ['M302 S155', 'M302 S170', 'M302 P0 S155']) {
    assert.deepEqual(rules(`${command}\n`), [], command);
  }
  assert.deepEqual(rules('M3020\n'), [], 'M3020 is not M302');
});

test('Klipper SAVE_CONFIG blocks, an ordinary macro does not (N4)', () => {
  assert.deepEqual(rules('SAVE_CONFIG\n'), ['gcode.forbidden_command']);
  assert.deepEqual(rules('save_config\n'), ['gcode.forbidden_command'], 'case insensitive');
  assert.match(one('SAVE_CONFIG\n').message, /rewrites the printer configuration/);
  assert.deepEqual(rules('PRINT_START\n'), []);
  // SAVE_CONFIG is still a macro for the homing heuristic
  assert.deepEqual(rules('SAVE_CONFIG\nG1 X1\n'), ['gcode.forbidden_command', 'gcode.macro_before_move']);
});

test('M211 S0 is forbidden, M211 S1 is not', () => {
  assert.deepEqual(rules('M211 S0\n'), ['gcode.forbidden_command']);
  assert.deepEqual(rules('M211 S1\n'), []);
  assert.deepEqual(rules('M211\n'), [], 'no parameter only reports the state');
});

test('a longer command number is not the short one', () => {
  // M5000 is not M500, M9070 is not M907, M920 is not M92
  assert.deepEqual(rules('M5000 S1\n'), []);
  assert.deepEqual(rules('M9070\n'), []);
  assert.deepEqual(rules('M920 X1\n'), []);
  assert.deepEqual(rules('G500\n'), [], 'G500 is not M500');
});

test('comments and blank lines are not commands', () => {
  const text = ['; M500 in a comment is harmless', ';M907 E538', '', 'M107 ; M500 after a command is a comment too', '(M502)'].join('\n');
  assert.deepEqual(rules(text), []);
});

test('a command behind a line number and checksum is still the command', () => {
  assert.deepEqual(rules('N10 M500*42\n'), ['gcode.forbidden_command']);
});

// ---------------------------------------------------------------------------
// temperatures
// ---------------------------------------------------------------------------

test('M104/M109 above 450 °C blocks, exactly at the limit does not', () => {
  assert.deepEqual(rules(`M104 S${DEFAULT_HOTEND_LIMIT}\n`), []);
  assert.deepEqual(rules(`M109 S${DEFAULT_HOTEND_LIMIT}\n`), []);
  assert.deepEqual(rules(`M104 S${DEFAULT_HOTEND_LIMIT + 1}\n`), ['gcode.max_temp']);
  assert.deepEqual(rules(`M109 S500\n`), ['gcode.max_temp']);
  const issue = one('M104 S999\n');
  assert.equal(issue.severity, 'block');
  assert.match(issue.message, /999 °C/);
  assert.match(issue.message, /450 °C limit/);
});

test('M140/M190 above 150 °C blocks, a normal bed does not', () => {
  assert.deepEqual(rules(`M140 S${DEFAULT_BED_LIMIT}\n`), []);
  assert.deepEqual(rules(`M190 S${DEFAULT_BED_LIMIT + 1}\n`), ['gcode.max_temp']);
  assert.deepEqual(rules('M140 S60\nM190 S60\n'), [], 'ordinary bed temperatures');
});

test('a temperature in R (wait for) is checked like S', () => {
  assert.deepEqual(rules('M109 R500\n'), ['gcode.max_temp']);
  assert.deepEqual(rules('M190 R160\n'), ['gcode.max_temp']);
});

test('a cooling command is not a temperature command', () => {
  assert.deepEqual(rules('M106 S255\nM107\n'), []);
});

test('the ceilings can be lowered for a later per-printer rule set (S1-d)', () => {
  assert.deepEqual(rules('M104 S260\n', { hotendLimit: 240 }), ['gcode.max_temp']);
  assert.deepEqual(rules('M104 S230\n', { hotendLimit: 240 }), []);
});

// ---------------------------------------------------------------------------
// N4: further temperature targets
// ---------------------------------------------------------------------------

test('M303 (PID autotune) is checked against the hotend ceiling (N4)', () => {
  assert.deepEqual(rules('M303 S500\n'), ['gcode.max_temp']);
  assert.deepEqual(rules('M303 E0 S215 C8\n'), []);
  const issue = one('M303 S500\n');
  assert.equal(issue.severity, 'block');
  assert.match(issue.message, /"M303 S500".*500 °C/);
  assert.deepEqual(rules('M3030 S500\n'), [], 'M3030 is not M303');
});

test('M141/M191 are checked against the chamber ceiling (N4)', () => {
  assert.deepEqual(rules('M141 S60\n'), []);
  assert.deepEqual(rules('M191 S60\n'), []);
  assert.deepEqual(rules('M141 S150\n'), ['gcode.max_temp']);
  assert.deepEqual(rules('M191 S150\n'), ['gcode.max_temp']);
  // the chamber has no printer safety limit, so the maximum does not mix into the hotend/bed maxima
  assert.deepEqual(scanGcodeText('M141 S60\n').maxTemperatures, { hotend: 0, bed: 0 });
});

test('RRF G10 S and M568 S are hotend targets (N4)', () => {
  assert.deepEqual(rules('G10 S0\n'), [], 'G10 S0 is "tool off"');
  assert.deepEqual(rules('G10 S650\n'), ['gcode.max_temp']);
  assert.deepEqual(rules('G10 S0 P0\n'), []);
  assert.deepEqual(rules('M568 P0 S215 R170 A1\n'), []);
  assert.deepEqual(rules('M568 P0 S650\n'), ['gcode.max_temp']);
  // RRF G10 must not be mistaken for a move before homing, and G1 still is one
  assert.deepEqual(rules('G10 S215\nG1 X5\n'), ['gcode.no_homing']);
});

test('Klipper SET_HEATER_TEMPERATURE TARGET= is checked by heater (N4)', () => {
  assert.deepEqual(rules('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=260 WAIT=1\n'), []);
  assert.deepEqual(rules('SET_HEATER_TEMPERATURE HEATER=extruder TARGET=500\n'), ['gcode.max_temp']);
  assert.deepEqual(rules('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=160\n'), ['gcode.max_temp']);
  assert.deepEqual(rules('SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60\n'), []);
  assert.deepEqual(rules('SET_HEATER_TEMPERATURE HEATER=chamber TARGET=150\n'), ['gcode.max_temp']);
  // a macro without TARGET does nothing
  assert.deepEqual(rules('SET_HEATER_TEMPERATURE HEATER=extruder\n'), []);
});

test('the temperature maxima include every temperature command (N3)', () => {
  const result = scanGcodeText('G28\nM104 S220\nM140 S60\nM109 R230\nM303 S500\nG10 S400\nM191 S60\n');
  assert.deepEqual(result.maxTemperatures, { hotend: 500, bed: 60 });
  // G10 S400 is below the ceiling (recorded in the maxima, not reported); M303 S500 is above it
  assert.deepEqual(result.counts, { 'gcode.max_temp': 1 });
});

// ---------------------------------------------------------------------------
// homing
// ---------------------------------------------------------------------------

test('a move before any G28 blocks', () => {
  const issue = one('G90\nM83\nG1 X10 Y10 F3000\n');
  assert.equal(issue.rule, 'gcode.no_homing');
  assert.equal(issue.severity, 'block');
  assert.equal(issue.line, 3);
  assert.match(issue.message, /before any G28/);
  // one report is the finding, not one per move
  const result = scanGcodeText('G1 X1\nG1 X2\nG0 Y5\n');
  assert.equal(result.issues.length, 1);
  assert.equal(result.counts['gcode.no_homing'], 1);
});

test('G28 before the moves makes a clean file; G28 after them does not redeem the first move', () => {
  assert.deepEqual(rules('G28\nG1 X10 Y10\n'), []);
  assert.deepEqual(rules('G28 W ; home\nG1 Z5\n'), []);
  assert.deepEqual(rules('G1 X10\nG28\nG1 X20\n'), ['gcode.no_homing']);
});

test('a move without X/Y/Z is not a move', () => {
  // G1 F720, G1 E-2 (retraction only) and G92 E0 move no axis
  assert.deepEqual(rules('G1 F720\nG1 E-2\nG92 E0\nG4\n'), []);
  assert.deepEqual(rules('G2 I1 J1\n'), [], 'an arc needs X or Y to move');
});

test('G2/G3 with an axis before G28 blocks like G0/G1', () => {
  assert.deepEqual(rules('G2 X5 Y5 I2 J2\n'), ['gcode.no_homing']);
  assert.deepEqual(rules('G3 Z1\n'), ['gcode.no_homing']);
});

test('a Klipper macro before the first move warns instead of blocking', () => {
  for (const macro of ['PRINT_START', 'START_PRINT', 'KAMP_LAZY']) {
    const issue = one(`${macro} BED=60 EXTRUDER=215\nG1 X10 Y10\n`);
    assert.equal(issue.rule, 'gcode.macro_before_move', macro);
    assert.equal(issue.severity, 'warn');
    assert.match(issue.message, new RegExp(macro));
    assert.match(issue.message, /cannot verify/);
  }
});

test('a macro does not stop a later G28 from being recognised', () => {
  assert.deepEqual(rules('PRINT_START\nG28\nG1 X10 Y10\n'), []);
  // a macro after a homing move changes nothing: the move was fine
  assert.deepEqual(rules('G28\nPRINT_START\nG1 X10\n'), []);
});

test('a tool change is not a macro', () => {
  assert.deepEqual(rules('T0\nG1 X10\n'), ['gcode.no_homing']);
});

// ---------------------------------------------------------------------------
// firmware limits (warn)
// ---------------------------------------------------------------------------

test('M201/M203/M205 above the preset limit warn, per axis', () => {
  const issue = one('G28\nM201 X1500\n', { machineLimits: MK3S_LIMITS });
  assert.equal(issue.rule, 'gcode.firmware_limit');
  assert.equal(issue.severity, 'warn');
  assert.match(issue.message, /M201 X1500/);
  assert.match(issue.message, /machine_max_acceleration_x = 1000/);
  // exactly at the limit is allowed
  assert.deepEqual(rules('G28\nM201 X1000\n', { machineLimits: MK3S_LIMITS }), []);
  assert.deepEqual(rules('G28\nM201 Y1001\n', { machineLimits: MK3S_LIMITS }), ['gcode.firmware_limit']);
});

test('the silent column is not compared against', () => {
  // machine_max_feedrate_x = 200,100 – 150 is between the two columns and is fine
  assert.deepEqual(rules('G28\nM203 X150\n', { machineLimits: MK3S_LIMITS }), []);
  // 201 is above both
  assert.deepEqual(rules('G28\nM203 X201\n', { machineLimits: MK3S_LIMITS }), ['gcode.firmware_limit']);
});

test('a limit the preset does not define cannot fire', () => {
  // only X is defined; M201 Y…, M204, M205 find nothing to compare against
  const limits = { machine_max_acceleration_x: '1000' };
  assert.deepEqual(rules('G28\nM201 Y9000\n', { machineLimits: limits }), []);
  assert.deepEqual(rules('G28\nM204 T9000\n', { machineLimits: limits }), []);
  assert.deepEqual(rules('G28\nM205 J9\n', { machineLimits: limits }), []);
  assert.deepEqual(rules('G28\nM201 X1001\n', { machineLimits: limits }), ['gcode.firmware_limit']);
});

test('M204 and M205 compare their parameters against the preset', () => {
  assert.deepEqual(rules('G28\nM204 T2000\n', { machineLimits: MK3S_LIMITS }), ['gcode.firmware_limit']);
  assert.deepEqual(rules('G28\nM204 T1250\n', { machineLimits: MK3S_LIMITS }), []);
  assert.deepEqual(rules('G28\nM205 X9\n', { machineLimits: MK3S_LIMITS }), ['gcode.firmware_limit']);
  assert.deepEqual(rules('G28\nM205 J0.05\n', { machineLimits: MK3S_LIMITS }), ['gcode.firmware_limit']);
});

// ---------------------------------------------------------------------------
// the scan itself: chunks, caps, storage helpers
// ---------------------------------------------------------------------------

test('a line split over two chunks is still one command', () => {
  const scan = new GcodePreflight();
  scan.push('G28\nM5');
  scan.push('00\nG1 X5\n');
  const result = scan.finish();
  assert.deepEqual(
    result.issues.map((i) => i.rule),
    ['gcode.forbidden_command'],
  );
  assert.equal(result.issues[0].line, 2);
});

test('CRLF line endings and a last line without a newline', () => {
  assert.deepEqual(rules('G28\r\nG1 X1\r\nM500'), ['gcode.forbidden_command']);
  const result = scanGcodeText('G28\nM500');
  assert.equal(result.issues[0].line, 2);
});

test('a lone CR is a line end too – "G28\\rM500" hides nothing (N2)', () => {
  const result = scanGcodeText('G28\rM500\r');
  assert.deepEqual(
    result.issues.map((i) => [i.rule, i.line, i.text]),
    [['gcode.forbidden_command', 2, 'M500']],
  );
  // mixed ends in one file, and a CR at the very end of the file
  assert.deepEqual(rules('G28\nG1 X1\rM500\nG1 X2'), ['gcode.forbidden_command']);
  assert.deepEqual(rules('G28\rM500'), ['gcode.forbidden_command']);
});

test('a CRLF split over two chunks is one line end, so the line numbers stay right', () => {
  const scan = new GcodePreflight();
  scan.push('G28\r');
  scan.push('\nG1 X5\r');
  scan.push('\nM500\r\n');
  const result = scan.finish();
  assert.deepEqual(
    result.issues.map((i) => [i.rule, i.line]),
    [['gcode.forbidden_command', 3]],
  );
  // a lone CR at a chunk boundary is still a line end of its own
  const scan2 = new GcodePreflight();
  scan2.push('G28\r');
  scan2.push('M500\n');
  assert.deepEqual(
    scan2.finish().issues.map((i) => [i.rule, i.line]),
    [['gcode.forbidden_command', 2]],
  );
});

test('a blank between the command letter and its number is Marlin syntax (N2)', () => {
  for (const command of ['M 500', 'M  500', 'm 500', 'M\t500']) {
    assert.deepEqual(rules(`${command}\n`), ['gcode.forbidden_command'], JSON.stringify(command));
  }
  assert.deepEqual(rules('G 28\nM 104 S999\n'), ['gcode.max_temp'], 'a spaced G28 still homes');
  assert.deepEqual(rules('G 28\nG 1 X10\n'), [], 'the spaced G28 counts as the homing');
  // M 5000 is still 5000, not 500
  assert.deepEqual(rules('M 5000 S1\n'), []);
});

test('the issues of one rule are capped, the count is not', () => {
  const text = Array.from({ length: MAX_ISSUES_PER_RULE + 7 }, () => 'M500').join('\n');
  const result = scanGcodeText(text);
  assert.equal(result.issues.length, MAX_ISSUES_PER_RULE);
  assert.equal(result.counts['gcode.forbidden_command'], MAX_ISSUES_PER_RULE + 7);
  // the cap is an option
  assert.equal(scanGcodeText(text, { maxIssuesPerRule: 2 }).issues.length, 2);
});

test('the summary counts blocks and warnings, capped issues included', () => {
  const result = scanGcodeText('G1 X1\nM500\nM500\nM500\nM500\nM500\nM500\nM104 S500\n');
  const summary = preflightSummary(result);
  assert.equal(summary.blocking, 1 + 1 + 6, 'one no_homing, one max_temp, six forbidden commands');
  assert.equal(summary.warnings, 0);
  assert.equal(preflightSummary(scanGcodeText('PRINT_START\nG1 X1\n')).warnings, 1);
});

test('a stored result of another version is not used', () => {
  const result = scanGcodeText('M500\n');
  assert.ok(currentPreflight(result));
  const old = { ...result, version: PREFLIGHT_VERSION + 1 };
  assert.equal(currentPreflight(old), undefined);
  assert.deepEqual(preflightSendIssues(old), [], 'an outdated scan is not trusted');
  assert.deepEqual(
    preflightSendIssues(result).map((i) => i.rule),
    ['gcode.forbidden_command'],
  );
});

test('a scanned clean file has no issues at all', () => {
  const result = scanGcodeText('; generated by PrusaSlicer\nG90\nM83\nG28 W\nG1 X42 Y-4 Z5 F4800\nM104 S230\nM190 S60\nM107\n');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, {});
  assert.deepEqual(preflightSummary(result), { blocking: 0, warnings: 0 });
});

test('binary G-code is reported as not scanned', () => {
  const issue = notScannedIssue('the output is binary G-code (.bgcode)');
  assert.equal(issue.rule, 'gcode.not_scanned');
  assert.equal(issue.severity, 'warn');
  assert.match(issue.message, /did not scan/);
});

// ---------------------------------------------------------------------------
// real slicer output: PrusaSlicer 2.9.6, `samples/bridge_table.stl`
// ---------------------------------------------------------------------------

/** The `machine_max_*` of the MK3S preset, as PrusaSlicer writes them into its profiles. */
const MK3S_MACHINE = {
  machine_max_acceleration_e: '5000,5000',
  machine_max_acceleration_extruding: '1250,1250',
  machine_max_acceleration_retracting: '1250,1250',
  machine_max_acceleration_x: '1000,960',
  machine_max_acceleration_y: '1000,960',
  machine_max_acceleration_z: '200,200',
  machine_max_feedrate_e: '120,120',
  machine_max_feedrate_x: '200,100',
  machine_max_feedrate_y: '200,100',
  machine_max_feedrate_z: '12,12',
  machine_max_jerk_e: '4.5,4.5',
  machine_max_jerk_x: '8,8',
  machine_max_jerk_y: '8,8',
  machine_max_jerk_z: '0.4,0.4',
};

/** The `machine_max_*` of the MK4S HF0.4 preset. */
const MK4S_MACHINE = {
  machine_max_acceleration_e: '2500,2500',
  machine_max_acceleration_extruding: '4000,2500',
  machine_max_acceleration_retracting: '2500,2500',
  machine_max_acceleration_travel: '4000,2500',
  machine_max_acceleration_x: '4000,2500',
  machine_max_acceleration_y: '4000,2500',
  machine_max_acceleration_z: '200,200',
  machine_max_feedrate_e: '100,100',
  machine_max_feedrate_x: '300,160',
  machine_max_feedrate_y: '300,160',
  machine_max_feedrate_z: '40,40',
  machine_max_jerk_e: '10,10',
  machine_max_jerk_x: '8,8',
  machine_max_jerk_y: '8,8',
  machine_max_jerk_z: '2,2',
  machine_max_junction_deviation: '0.01,0.01',
};

test('PrusaSlicer output for the MK3S has no block; only its own M907 lines warn', { skip: skips('mk3s_bridge.gcode') }, () => {
  const text = fs.readFileSync(path.join(FIXTURE_DIR, 'mk3s_bridge.gcode'), 'utf8');
  const result = scanGcodeText(text, { machineLimits: MK3S_MACHINE });
  const summary = preflightSummary(result);
  assert.equal(summary.blocking, 0, JSON.stringify(result.issues.filter((i) => i.severity === 'block')));
  // the stock preset sets the extruder current in start_gcode and resets it in end_gcode
  assert.deepEqual(result.counts, { 'gcode.motor_current': 2 });
  assert.deepEqual(
    result.issues.map((i) => [i.rule, i.severity, i.text]),
    [
      ['gcode.motor_current', 'warn', 'M907 E430 ; set extruder motor current'],
      ['gcode.motor_current', 'warn', 'M907 E538 ; reset extruder motor current'],
    ],
  );
});

test('PrusaSlicer output for the MK4S has neither a block nor a warning', { skip: skips('mk4s_bridge.gcode') }, () => {
  const text = fs.readFileSync(path.join(FIXTURE_DIR, 'mk4s_bridge.gcode'), 'utf8');
  const result = scanGcodeText(text, { machineLimits: MK4S_MACHINE });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, {});
  assert.deepEqual(preflightSummary(result), { blocking: 0, warnings: 0 });
});

test('the chunked scan of a real file equals the one-shot scan', { skip: skips('mk3s_bridge.gcode') }, () => {
  const text = fs.readFileSync(path.join(FIXTURE_DIR, 'mk3s_bridge.gcode'), 'utf8');
  const scan = new GcodePreflight({ machineLimits: MK3S_MACHINE });
  // 4096-byte chunks put many lines across boundaries, thumbnails included
  for (let i = 0; i < text.length; i += 4096) scan.push(text.slice(i, i + 4096));
  const chunked = scan.finish();
  const oneShot = scanGcodeText(text, { machineLimits: MK3S_MACHINE });
  assert.deepEqual(chunked, oneShot);
});
