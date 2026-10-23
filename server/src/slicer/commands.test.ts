/**
 * q2-slicer-cli, AC-1: the argument lists of every PrusaSlicer invocation are built here and pinned
 * exactly – a PrusaSlicer version change that renames a flag is one edit in one file, and an
 * accidental edit anywhere else fails this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutArgs, exportGcodeArgs, exportStlArgs, helpArgs } from './commands.js';

test('a FFF slicing job exports G-code with the merged config', () => {
  assert.deepEqual(
    exportGcodeArgs({ technology: 'FFF', configFile: 'job/config.ini', outputFile: 'job/out.gcode', modelFile: 'job/model.3mf' }),
    ['--export-gcode', '--load', 'job/config.ini', '--dont-arrange', '--loglevel', '3', '--output', 'job/out.gcode', 'job/model.3mf'],
  );
});

test('an SLA job exports SL1 with the same options', () => {
  assert.deepEqual(exportGcodeArgs({ technology: 'SLA', configFile: 'c.ini', outputFile: 'out.sl1', modelFile: 'm.3mf' }), [
    '--export-sla',
    '--load',
    'c.ini',
    '--dont-arrange',
    '--loglevel',
    '3',
    '--output',
    'out.sl1',
    'm.3mf',
  ]);
});

test('a STEP conversion exports STL without moving the model onto the bed', () => {
  assert.deepEqual(exportStlArgs({ outputFile: 'out.stl', inputFile: 'in.step' }), [
    '--export-stl',
    '--no-ensure-on-bed',
    '--output',
    'out.stl',
    'in.step',
  ]);
});

test('a cut passes the height from the lowest point and exports a 3MF', () => {
  assert.deepEqual(cutArgs({ cutZ: 10.5, outputFile: 'cut.3mf', inputFile: 'input.stl' }), [
    '--cut',
    '10.5',
    '--export-3mf',
    '--dont-arrange',
    '--no-ensure-on-bed',
    '--output',
    'cut.3mf',
    'input.stl',
  ]);
});

test('the help calls name the technology and the version call does not', () => {
  assert.deepEqual(helpArgs(), ['--help']);
  assert.deepEqual(helpArgs('fff'), ['--help-fff']);
  assert.deepEqual(helpArgs('sla'), ['--help-sla']);
});
