import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetDiff, shortValue, transferChanges } from './presetDiff.js';

test('presetDiff lists changed keys sorted by key', () => {
  const saved = { layer_height: '0.2', fill_density: '15%', perimeters: '2' };
  const current = { ...saved, perimeters: '4', fill_density: '40%' };
  assert.deepEqual(presetDiff(saved, current), [
    { key: 'fill_density', from: '15%', to: '40%' },
    { key: 'perimeters', from: '2', to: '4' },
  ]);
});

test('presetDiff ignores unchanged keys and empty diffs', () => {
  const cfg = { layer_height: '0.2', fill_density: '15%' };
  assert.deepEqual(presetDiff(cfg, { ...cfg }), []);
  assert.deepEqual(presetDiff({}, {}), []);
});

test('presetDiff reports added and removed keys with an empty side', () => {
  assert.deepEqual(presetDiff({ a: '1' }, { a: '1', b: '2' }), [{ key: 'b', from: '', to: '2' }]);
  assert.deepEqual(presetDiff({ a: '1', b: '2' }, { a: '1' }), [{ key: 'b', from: '2', to: '' }]);
});

test('presetDiff treats a key set to an empty value as a change', () => {
  assert.deepEqual(presetDiff({ notes: 'x' }, { notes: '' }), [{ key: 'notes', from: 'x', to: '' }]);
});

test('transferChanges applies the old changes on top of the new preset', () => {
  const oldSaved = { perimeters: '2', fill_density: '15%', layer_height: '0.2' };
  const oldCurrent = { ...oldSaved, perimeters: '4', fill_density: '40%' };
  const newSaved = { perimeters: '3', fill_density: '10%', layer_height: '0.3' };
  const valid = ['perimeters', 'fill_density', 'layer_height'];
  assert.deepEqual(transferChanges(newSaved, oldSaved, oldCurrent, valid), {
    perimeters: '4',
    fill_density: '40%',
    layer_height: '0.3', // untouched key keeps the target's own value
  });
});

test('transferChanges keeps the target values when nothing was changed', () => {
  const oldSaved = { fill_density: '15%', perimeters: '2' };
  const newSaved = { fill_density: '10%', perimeters: '3' };
  assert.deepEqual(transferChanges(newSaved, oldSaved, { ...oldSaved }, ['fill_density', 'perimeters']), newSaved);
});

test('transferChanges skips keys the schema does not know for that preset type', () => {
  const oldSaved = { fill_density: '15%', retract_length: '0.8' };
  const oldCurrent = { fill_density: '40%', retract_length: '1.2' };
  const newSaved = { fill_density: '10%' };
  // retract_length belongs to the printer, not to the print preset
  assert.deepEqual(transferChanges(newSaved, oldSaved, oldCurrent, ['fill_density']), { fill_density: '40%' });
});

test('transferChanges does not delete a target key that the old preset lacked', () => {
  const oldSaved = { perimeters: '2' };
  const oldCurrent = { perimeters: '4' };
  const newSaved = { perimeters: '3', brim_width: '5' };
  assert.deepEqual(transferChanges(newSaved, oldSaved, oldCurrent, ['perimeters', 'brim_width']), { perimeters: '4', brim_width: '5' });
});

test('transferChanges transfers a key the old preset cleared as the empty value', () => {
  const oldSaved = { perimeters: '2', idle_temperature: '190' };
  const oldCurrent = { perimeters: '2', idle_temperature: '' };
  const newSaved = { perimeters: '3', idle_temperature: '180' };
  assert.deepEqual(transferChanges(newSaved, oldSaved, oldCurrent, ['perimeters', 'idle_temperature']), { perimeters: '3', idle_temperature: '' });
});

test('transferChanges leaves the input configs untouched', () => {
  const oldSaved = { perimeters: '2' };
  const oldCurrent = { perimeters: '4' };
  const newSaved = { perimeters: '3' };
  transferChanges(newSaved, oldSaved, oldCurrent, ['perimeters']);
  assert.deepEqual(newSaved, { perimeters: '3' });
  assert.deepEqual(oldSaved, { perimeters: '2' });
  assert.deepEqual(oldCurrent, { perimeters: '4' });
});

test('shortValue collapses whitespace and cuts long values', () => {
  assert.equal(shortValue('0.2'), '0.2');
  assert.equal(shortValue(' G1 X0\n  G1 Y1\n'), 'G1 X0 G1 Y1');
  const long = shortValue('x'.repeat(100));
  assert.equal(long.length, 60);
  assert.equal(long.at(-1), '…');
});
