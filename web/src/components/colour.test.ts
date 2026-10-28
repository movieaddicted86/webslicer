import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexColourValue, isValidColour, pickerColour } from './colour.js';

test('the picker shows a hex colour in the form a native colour input wants', () => {
  assert.equal(pickerColour('#FF8000'), '#ff8000');
  assert.equal(pickerColour('ff8000'), '#ff8000');
  assert.equal(pickerColour(' #00ff00 '), '#00ff00');
  assert.equal(pickerColour(''), undefined);
  assert.equal(pickerColour('#FF8000;#00FF00'), undefined);
  assert.equal(pickerColour('orange'), undefined);
});

test('a committed hex text is stored the way the presets spell it', () => {
  assert.equal(hexColourValue('#ff8000'), '#FF8000');
  assert.equal(hexColourValue('00ff00'), '#00FF00');
  // text that is not a colour is kept as typed, so the field shows what the user wrote
  assert.equal(hexColourValue('orange'), 'orange');
});

test('a stored colour is canonical hex with the hash, or empty', () => {
  assert.equal(isValidColour('#FF8000'), true);
  assert.equal(isValidColour('FF8000'), false);
  assert.equal(isValidColour(''), true);
  assert.equal(isValidColour('#FF800'), false);
  assert.equal(isValidColour('orange'), false);
});
